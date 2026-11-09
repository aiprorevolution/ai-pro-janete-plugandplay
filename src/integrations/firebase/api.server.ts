import {readInstallationConfig} from './config.server';
import {identityFromRequest,requestIdentity} from './identity.server';
import {firestoreStore} from './store.server';
import {bootstrapInstallation} from './bootstrap.server';
import {executeQuery,requireMember} from './query.server';
import {storageAdapter} from './storage.server';
// O proxy da prévia do AI Studio troca o corpo das respostas 403/502/503/504 por uma página HTML da plataforma,
// e o motivo do erro some. Na prévia (APPLET_ID definido), esses erros saem como HTTP 500 com o status original em
// error_status, como no outro app AI PRO validado no AI Studio; o cliente restaura o status. Nenhuma checagem de
// acesso muda, e fora do AI Studio o status é o original.
const STATUS_TROCADOS_PELA_PREVIA=new Set([403,502,503,504]);
const json=(body:unknown,status=200)=>{
 const naPrevia=!!process.env['APPLET_ID']&&STATUS_TROCADOS_PELA_PREVIA.has(status)&&!!body&&typeof body==='object'&&!Array.isArray(body);
 return Response.json(naPrevia?{...(body as object),error_status:status}:body,{status:naPrevia?500:status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
};
/** Registra no log do servidor o motivo de uma recusa: código, status e mensagem curta. Nunca o pedido nem o token. */
function registrarRecusa(onde:string,error:any,status:number){
 const codigo=typeof error?.code==='string'?error.code:'sem_codigo';
 const mensagem=typeof error?.message==='string'?error.message.replace(/\s+/g,' ').slice(0,200):'';
 const detalhe=[error?.operacao,error?.contexto].filter(x=>typeof x==='string'&&x).join(' | ');
 console.error(`[AI PRO Janete] ${onde} recusou (${status}, ${codigo}): ${mensagem}${detalhe?` | ${detalhe}`:''}`);
}
function safeError(error:any){
 const code=typeof error?.code==='string'?error.code:'operation_failed';
 const messages:Record<string,string>={PERMISSION_DENIED:'O Firebase recusou o acesso. Confira a instalação e as permissões desta conta.',FAILED_PRECONDITION:'O banco ainda precisa concluir os índices. Peça ao agente do AI Studio para executar a verificação da instalação.',RESOURCE_EXHAUSTED:'O limite de uso do Firebase foi atingido. Confira o uso e o plano do projeto.',server_identity_required:'Conclua a publicação e a identidade do servidor para usar esta função.',firebase_not_configured:'Conecte o Firebase desta cópia pelo Google AI Studio.',sem_acesso:'Sua conta não tem acesso a esta operação.'};
 if(error?.status===401)return {message:'Entre novamente na sua conta.',code};
 if(messages[code])return {message:messages[code],code};
 // Business error codes remain machine-readable; infrastructure response bodies,
 // provider error details and credentials are never copied to the browser.
 if(error?.name==='DomainError'&&/^[a-z_]{1,80}$/.test(error.message))return {message:error.message,code};
 return {message:'Não foi possível concluir agora. Confira a instalação ou tente novamente.',code};
}
let resumoLembrado:{em:number;valor:Promise<unknown>}|null=null;
/** Só para testes. */
export function esquecerDiagnostico(){resumoLembrado=null;}
/** O pedido traz o login de um administrador ativo? Qualquer falha (sem login, sessão vencida, atendente) = não. */
async function pedidoDeAdministrador(request:Request):Promise<boolean>{
 if(!request.headers.get('authorization'))return false;
 try{
  const identity=await identityFromRequest(request);
  return await requestIdentity.run(identity,async()=>(await requireMember(firestoreStore,identity.actor))['papel']==='admin');
 }catch{return false;}
}const MEDIA_PATH=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function upload(request:Request,url:URL){
 const identity=await identityFromRequest(request);
 return requestIdentity.run(identity,async()=>{
  await requireMember(firestoreStore,identity.actor);const path=url.searchParams.get('path')??'';
  if(url.searchParams.get('namespace')!=='midias'||!MEDIA_PATH.test(path))return json({error:{message:'Caminho de mídia inválido.'}},400);
  const [conversationId,messageId]=path.split('/');
  const [conversation,message]=await Promise.all([firestoreStore.get('conversas',conversationId!),firestoreStore.get('mensagens',messageId!)]);
  if(!conversation||message)return json({error:{message:'A conversa não existe ou o arquivo já está associado a uma mensagem.'}},409);
  const mime=request.headers.get('content-type')??'';
  if(!/^(image\/(png|jpeg|webp|gif)|audio\/[a-z0-9.+-]+|video\/(mp4|webm)|application\/(pdf|octet-stream|vnd\.[a-z0-9.+-]+)|text\/plain)(;.*)?$/i.test(mime))return json({error:{message:'Este tipo de arquivo não é permitido.'}},415);
  const reader=request.body?.getReader();if(!reader)return json({error:{message:'O arquivo está vazio.'}},400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>25*1024*1024){await reader.cancel();return json({error:{message:'O arquivo deve ter no máximo 25 MB.'}},413);}chunks.push(next.value);}
  if(!size)return json({error:{message:'O arquivo está vazio.'}},400);
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const result=await storageAdapter.from('midias').upload(path,bytes,{contentType:mime,upsert:false});
  return result.error?json({error:safeError(result.error)},503):json(result);
 });
}
export async function handleFirebaseRequest(request:Request):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/firebase'))return null;
 if(url.pathname==='/api/firebase/config'&&request.method==='GET')return json(await readInstallationConfig());
 // Diagnóstico: o resumo (sim/não) é público e lembrado por 1 min, para a rota não virar gasto de leituras do banco.
 // O estado do motor (horários e tipos dos últimos eventos e rodadas) só sai para um administrador logado.
 if(url.pathname==='/api/firebase/diagnostico'&&request.method==='GET'){
  const {diagnosticarServidor}=await import('./diagnostico.server');
  if(await pedidoDeAdministrador(request))return json(await diagnosticarServidor(undefined,{motor:true}));
  if(!resumoLembrado||Date.now()-resumoLembrado.em>60_000)resumoLembrado={em:Date.now(),valor:diagnosticarServidor(undefined,{motor:false})};
  return json(await resumoLembrado.valor);
 }
 // Cria os índices declarados em firestore.indexes.json que faltam, com a identidade do serviço. Idempotente; só para um
 // administrador logado. Não cria nada além do que o próprio app declara.
 if(url.pathname==='/api/firebase/diagnostico/indices'&&request.method==='POST'){if(!(await pedidoDeAdministrador(request)))return json({error:{message:'Entre como administrador para usar esta função.',code:'sem_acesso'}},401);const {diagnosticarServidor}=await import('./diagnostico.server');return json(await diagnosticarServidor(undefined,{criarIndices:true,motor:true}));}
 if(url.pathname==='/api/firebase/media-upload'&&request.method==='POST'){try{return await upload(request,url);}catch(error){return json({error:safeError(error)},(error as any)?.status??400);}}
 if(url.pathname!=='/api/firebase'||request.method!=='POST')return json({error:{message:'Rota não encontrada.'}},404);
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:{message:'Formato inválido.'}},415);
  const content=await request.text();if(content.length>1024*1024)return json({error:{message:'Pedido muito grande.'}},413);
  const body=JSON.parse(content);const identity=await identityFromRequest(request);
  return await requestIdentity.run(identity,async()=>{
   if(body.kind==='bootstrap'){
    try{
     const resultado=await bootstrapInstallation(firestoreStore,identity.actor);
     // Plug and play: no app publicado, o login do dono já prepara os índices do atendimento (nunca impede o login).
     if(resultado.owner){const {garantirIndicesComTeto}=await import('./indices-automaticos.server');await garantirIndicesComTeto(25_000).catch(()=>false);}
     // Quem conecta o WhatsApp na prévia e depois publica: o webhook só passa a apontar para o endereço publicado dentro
     // da rodada do worker, e o worker só rodava quando chegava mensagem (que não chega sem o webhook). O login de um
     // membro no app publicado pede o toque; na prévia, sem endereço publicado, não faz nada. Nunca impede o login.
     if(resultado.member){const {acordarMotor}=await import('@/features/mensageria/nucleo/motor.server');await requestIdentity.exit(()=>acordarMotor()).catch(()=>'falhou');}
     return json({data:resultado,error:null});
    }
    catch(error){
     // Para o log: como a conta chegou ao servidor (só verdadeiro/falso e provedor; nunca e-mail nem token).
     const claims=(()=>{try{return JSON.parse(Buffer.from(String(identity.token).split('.')[1]??'','base64url').toString());}catch{return {};}})();
     if(error&&typeof error==='object')Object.assign(error,{contexto:`primeiro acesso: verificado=${identity.actor.verified} token.email_verified=${claims.email_verified===true} email_confere=${!!identity.actor.email&&claims.email===identity.actor.email} provedor=${identity.actor.provider||'?'}`});
     throw error;
    }
   }
   if(body.kind==='query'){const result=await executeQuery(body.query,{actor:identity.actor,remote:true});if(result.error)registrarRecusa('consulta',result.error,result.error.status??400);return result.error?json({data:null,error:safeError(result.error)},result.error.status??400):json(result);}
   if(body.kind==='mediaUrls'){
    await requireMember(firestoreStore,identity.actor);
    if(body.namespace!=='midias'||!Array.isArray(body.paths)||body.paths.length>100||body.paths.some((p:any)=>typeof p!=='string'||!MEDIA_PATH.test(p)))return json({error:{message:'Lista de arquivos inválida.'}},400);
    const result=[];
    for(const path of body.paths){const [conversationId,messageId]=path.split('/');const message=await firestoreStore.get('mensagens',messageId);if(!message||message['conversa_id']!==conversationId||message['midia_caminho']!==path||message['apagada_em']){result.push({path,error:'Arquivo indisponível.'});continue;}const signed=await storageAdapter.from('midias').createSignedUrl(path,Math.min(3600,Math.max(1,Number(body.seconds)||300)));result.push({path,...(signed.data??{}),...(signed.error?{error:safeError(signed.error).message}:{})});}
    return json({data:result,error:null});
   }
   if(body.kind==='rpc'){
    if(typeof body.name!=='string'||body.name.startsWith('__'))return json({error:{message:'Operação inválida.'}},400);
    if(!['eh_membro','eh_admin','membro_atual'].includes(body.name))await requireMember(firestoreStore,identity.actor);
    const {dispatchRpc}=await import('./rpc.server');
    const data=await dispatchRpc(body.name,body.args??{},{store:firestoreStore,actor:identity.actor});return json({data,error:null});
   }
   return json({error:{message:'Operação inválida.'}},400);
  });
 }catch(error){const status=Math.min(599,Math.max(400,(error as any)?.status??400));registrarRecusa('/api/firebase',error,status);return json({data:null,error:safeError(error)},status);}
}
