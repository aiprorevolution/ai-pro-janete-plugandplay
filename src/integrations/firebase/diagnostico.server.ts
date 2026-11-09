import {enderecoPublicoDoAmbiente} from './config.server';
import {getServerAccessToken} from './identity.server';
import {FirestoreStore} from './store.server';

/**
 * Diagnóstico do servidor para o atendimento sem ninguém logado (webhook do WhatsApp e fila). Responde só sim/não e
 * o endereço público, que já é público. Nunca devolve dados do banco, ids, credenciais nem o projeto.
 */
export type Diagnostico = {
 aplicativo:'AI PRO Janete';
 identidadePropria:'sim'|'não';
 bancoComIdentidadePropria:'ok'|'recusado'|'sem identidade'|'erro';
 enderecoPublico:string;
 fila:'configurada'|'ausente';
};
type Dependencias = {obterToken:()=>Promise<string>;lerInstalacao:(token:string)=>Promise<unknown>};
const padrao:Dependencias={
 obterToken:()=>Promise.race([getServerAccessToken(),new Promise<string>((_,rejeita)=>setTimeout(()=>rejeita(new Error('tempo_esgotado')),8000))]),
 lerInstalacao:token=>new FirestoreStore(async()=>token).get('instalacao','principal'),
};
export async function diagnosticarServidor(dependencias:Dependencias=padrao):Promise<Diagnostico>{
 let token:string|undefined;
 try{token=await dependencias.obterToken();}catch{token=undefined;}
 let banco:Diagnostico['bancoComIdentidadePropria']='sem identidade';
 if(token){
  try{await dependencias.lerInstalacao(token);banco='ok';}
  catch(error){banco=(error as any)?.code==='PERMISSION_DENIED'||(error as any)?.status===403?'recusado':'erro';}
 }
 const fila=process.env['JANETE_TASKS_LOCATION']&&process.env['JANETE_TASKS_SERVICE_ACCOUNT']?'configurada':'ausente';
 return {aplicativo:'AI PRO Janete',identidadePropria:token?'sim':'não',bancoComIdentidadePropria:banco,enderecoPublico:enderecoPublicoDoAmbiente()??'ausente',fila};
}
