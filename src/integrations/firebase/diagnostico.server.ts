import {enderecoPublicoDoAmbiente,getInstallationConfig} from './config.server';
import {getServerAccessToken} from './identity.server';
import {apiComToken,situacaoDosIndices,type SituacaoIndices} from './indices.server';
import {FirestoreStore} from './store.server';

/**
 * Diagnóstico do servidor para o atendimento sem ninguém logado (webhook do WhatsApp). Responde com sim/não, contagens,
 * datas e códigos de erro. Nunca devolve conteúdo de mensagens, dados de contatos, ids, credenciais nem o projeto.
 */
export type EstadoMotor={
 ultimaExecucao:string|null;
 eventos:{recebido_em:string|null;tipo:string|null;processado:boolean;tentativas:number;erro:string|null}[];
 rodadas:{criado_em:string|null;status:string|null;motivo:string|null}[];
};
export type Diagnostico={
 aplicativo:'AI PRO Janete';
 identidadePropria:'sim'|'não';
 bancoComIdentidadePropria:'ok'|'recusado'|'sem identidade'|'erro';
 enderecoPublico:string;
 fila:'configurada'|'ausente';
 indices?:SituacaoIndices|{erro:string};
 motor?:EstadoMotor|{erro:string};
};
type Dependencias={
 obterToken:()=>Promise<string>;
 lerInstalacao:(token:string)=>Promise<unknown>;
 indices?:(token:string,criar:boolean)=>Promise<SituacaoIndices>;
 motor?:(token:string)=>Promise<EstadoMotor>;
};

const texto=(v:unknown)=>typeof v==='string'?v.slice(0,200):null;
const padrao:Dependencias={
 obterToken:()=>Promise.race([getServerAccessToken(),new Promise<string>((_,rejeita)=>setTimeout(()=>rejeita(new Error('tempo_esgotado')),8000))]),
 lerInstalacao:token=>new FirestoreStore(async()=>token).get('instalacao','principal'),
 indices:async(token,criar)=>{const c=await getInstallationConfig();return situacaoDosIndices(apiComToken(token),{projectId:c.projectId,databaseId:c.firestoreDatabaseId},criar);},
 motor:async token=>{
  const store=new FirestoreStore(async()=>token);
  const [configuracao,eventos,rodadas]=await Promise.all([
   store.get('configuracao',1),
   store.list('eventos_webhook',{order:[{field:'recebido_em',ascending:false}],limit:5}),
   store.list('rodadas',{order:[{field:'criado_em',ascending:false}],limit:5}),
  ]);
  return {
   ultimaExecucao:texto(configuracao?.['worker_visto_em']),
   eventos:eventos.map(e=>({recebido_em:texto(e['recebido_em']),tipo:texto(e['tipo']),processado:!!e['processado_em'],tentativas:Number(e['tentativas']??0),erro:texto(e['erro'])})),
   rodadas:rodadas.map(r=>({criado_em:texto(r['criado_em']),status:texto(r['status']),motivo:texto(r['motivo'])})),
  };
 },
};
const motivo=(error:unknown)=>(error as any)?.status===403||(error as any)?.code==='PERMISSION_DENIED'?'sem permissão':(error as any)?.code==='FAILED_PRECONDITION'?'falta índice':'erro';

export async function diagnosticarServidor(dependencias:Dependencias=padrao,opcoes:{criarIndices?:boolean}={}):Promise<Diagnostico>{
 let token:string|undefined;
 try{token=await dependencias.obterToken();}catch{token=undefined;}
 let banco:Diagnostico['bancoComIdentidadePropria']='sem identidade';
 if(token){
  try{await dependencias.lerInstalacao(token);banco='ok';}
  catch(error){banco=(error as any)?.code==='PERMISSION_DENIED'||(error as any)?.status===403?'recusado':'erro';}
 }
 const fila=process.env['JANETE_TASKS_LOCATION']&&process.env['JANETE_TASKS_SERVICE_ACCOUNT']?'configurada':'ausente';
 const resultado:Diagnostico={aplicativo:'AI PRO Janete',identidadePropria:token?'sim':'não',bancoComIdentidadePropria:banco,enderecoPublico:enderecoPublicoDoAmbiente()??'ausente',fila};
 if(token&&banco==='ok'){
  if(dependencias.indices){try{resultado.indices=await dependencias.indices(token,!!opcoes.criarIndices);}catch(error){resultado.indices={erro:motivo(error)};}}
  if(dependencias.motor){try{resultado.motor=await dependencias.motor(token);}catch(error){resultado.motor={erro:motivo(error)};}}
 }
 return resultado;
}
