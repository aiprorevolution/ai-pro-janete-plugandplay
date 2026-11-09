import {AsyncLocalStorage} from 'node:async_hooks';
import {GoogleAuth} from 'google-auth-library';
import {getInstallationConfig} from './config.server';
import type {Actor} from './store-types';
export interface IdentityContext {actor:Actor;token?:string}
export const requestIdentity=new AsyncLocalStorage<IdentityContext>();
const googleAuth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
export async function getServerAccessToken():Promise<string>{
 const token=await googleAuth.getAccessToken();
 if(!token)throw Object.assign(new Error('A identidade do servidor Google ainda não foi autorizada. Conclua a instalação e publique o aplicativo.'),{status:503,code:'server_identity_required'});
 return token;
}
export async function getDatabaseAccessToken():Promise<string>{
 const userToken=requestIdentity.getStore()?.token;
 if(!process.env['JANETE_RUNTIME_SERVICE_ACCOUNT']){
  if(userToken)return userToken;
  // Sem ninguém logado (webhook, fila) e sem o instalador: o app publicado pelo AI Studio roda com a identidade do
  // próprio serviço. Se o Google não der acesso ao banco para ela, o Firestore recusa e o log mostra a operação.
  try{return await getServerAccessToken();}
  catch{throw Object.assign(new Error('Publique a Janete e conclua a identidade própria do servidor para ativar o atendimento automático.'),{status:503,code:'server_identity_required'});}
 }
 return getServerAccessToken();
}
export function currentActor():Actor{return requestIdentity.getStore()?.actor??{uid:'service',verified:true,system:true};}
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
