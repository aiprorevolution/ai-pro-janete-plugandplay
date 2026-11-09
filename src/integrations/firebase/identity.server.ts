import {AsyncLocalStorage} from 'node:async_hooks';
import {GoogleAuth} from 'google-auth-library';
import {enderecoPublicoDoAmbiente,getInstallationConfig} from './config.server';
import type {Actor} from './store-types';
export interface IdentityContext {actor:Actor;token?:string}
export const requestIdentity=new AsyncLocalStorage<IdentityContext>();
const googleAuth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
export async function getServerAccessToken():Promise<string>{
 const token=await googleAuth.getAccessToken();
 if(!token)throw Object.assign(new Error('A identidade do servidor Google ainda não foi autorizada. Conclua a instalação e publique o aplicativo.'),{status:503,code:'server_identity_required'});
 return token;
}
/** Marcado quando o serviço publicado não conseguiu a própria identidade: os pedidos com login voltam ao token do usuário. */
let identidadeDoServicoFalhou=false;
/**
 * O banco é acessado com a identidade do serviço (as regras não se aplicam; quem autoriza é o servidor, pelo papel do
 * membro) ou com o login de quem fez o pedido (as regras do Firestore se aplicam)?
 * - Com o instalador (JANETE_RUNTIME_SERVICE_ACCOUNT) ou sem ninguém logado (webhook, worker): identidade do serviço.
 * - No app publicado pelo AI Studio: identidade do serviço também com alguém logado. As regras só deixam o administrador
 *   gravar; com o login do atendente, enviar mensagem, assumir e marcar como lida eram recusados.
 * - Na prévia (sem endereço publicado), o servidor não tem identidade com acesso: vale o login de quem pediu.
 */
export function usaIdentidadeDoServico():boolean{
 if(process.env['JANETE_RUNTIME_SERVICE_ACCOUNT'])return true;
 if(!requestIdentity.getStore()?.token)return true;
 return !!enderecoPublicoDoAmbiente()&&!identidadeDoServicoFalhou;
}
export async function getDatabaseAccessToken():Promise<string>{
 const userToken=requestIdentity.getStore()?.token;
 if(process.env['JANETE_RUNTIME_SERVICE_ACCOUNT'])return getServerAccessToken();
 if(userToken&&!usaIdentidadeDoServico())return userToken;
 // Sem ninguém logado (webhook, worker) ou no app publicado: o serviço roda com a identidade própria. Se o Google não
 // der acesso ao banco para ela, o Firestore recusa e o log mostra a operação.
 try{return await getServerAccessToken();}
 catch{
  if(userToken){identidadeDoServicoFalhou=true;return userToken;}
  throw Object.assign(new Error('Publique a Janete e conclua a identidade própria do servidor para ativar o atendimento automático.'),{status:503,code:'server_identity_required'});
 }
}
/** Só para testes. */
export function reiniciarIdentidadeDoServico(){identidadeDoServicoFalhou=false;}export function currentActor():Actor{return requestIdentity.getStore()?.actor??{uid:'service',verified:true,system:true};}
export async function verifyFirebaseToken(token:string):Promise<Actor>{
 if(!token || token.length>16384)throw Object.assign(new Error('Entre novamente na sua conta.'),{status:401});
 const config=await getInstallationConfig();
 const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token}),signal:AbortSignal.timeout(15000)});
 const payload=await response.json() as any;
 const user=payload.users?.[0];
 if(!response.ok||!user?.localId)throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'),{status:401});
 // Accounts lookup is scoped to the installation API key/project, and validates the token server-side.
 const claims=JSON.parse(Buffer.from(token.split('.')[1]??'','base64url').toString());
 const now=Math.floor(Date.now()/1000);
 if(claims.aud!==config.projectId||claims.iss!==`https://securetoken.google.com/${config.projectId}`||claims.sub!==user.localId||typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+60)throw Object.assign(new Error('Sua sessão não é válida para esta instalação. Entre novamente.'),{status:401});
 return {uid:user.localId,email:user.email??'',name:user.displayName??'',verified:user.emailVerified===true,provider:claims.firebase?.sign_in_provider??''};
}
export async function identityFromRequest(request:Request):Promise<IdentityContext>{
 const value=request.headers.get('authorization')??'';
 if(!value.startsWith('Bearer '))throw Object.assign(new Error('Entre na sua conta para continuar.'),{status:401});
 const token=value.slice(7);return {actor:await verifyFirebaseToken(token),token};
}
