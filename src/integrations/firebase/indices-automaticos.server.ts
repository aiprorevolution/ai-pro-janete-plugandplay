import {enderecoPublicoDoAmbiente,getInstallationConfig} from './config.server';
import {getServerAccessToken} from './identity.server';
import {apiComToken,situacaoDosIndices,type SituacaoIndices} from './indices.server';

/**
 * Plug and play: no app publicado, a Janete cria sozinha os índices que faltam, sem instalador e sem ninguém disparar.
 * Roda no login do dono no app publicado (enquanto ele configura WhatsApp e IA, o Google constrói os índices) e, por
 * garantia, antes do atendimento no webhook. Uma vez por processo: depois que todos existem, não confere de novo.
 * Na prévia e localmente não faz nada (sem endereço público, o app não está publicado).
 */
type Dependencias={
 publicado:()=>boolean;
 situacao:()=>Promise<SituacaoIndices>;
};
const padrao:Dependencias={
 publicado:()=>!!enderecoPublicoDoAmbiente(),
 situacao:async()=>{
  const [token,config]=await Promise.all([getServerAccessToken(),getInstallationConfig()]);
  return situacaoDosIndices(apiComToken(token),{projectId:config.projectId,databaseId:config.firestoreDatabaseId},true);
 },
};
let concluido=false;
let emAndamento:Promise<boolean>|null=null;

export function garantirIndicesUmaVez(deps:Dependencias=padrao):Promise<boolean>{
 if(concluido)return Promise.resolve(true);
 if(!deps.publicado())return Promise.resolve(false);
 emAndamento??=(async()=>{
  try{
   const s=await deps.situacao();
   concluido=s.faltando===0;
   if(s.criadosAgora)console.info(`[AI PRO Janete] índices: ${s.criadosAgora} criados agora; ${s.prontos} de ${s.exigidos} prontos (o Google leva alguns minutos para construir).`);
   return concluido;
  }catch(error){
   console.error(`[AI PRO Janete] não foi possível criar os índices (${(error as any)?.status??'?'}, ${(error as any)?.code??'sem_codigo'}).`);
   return false;
  }finally{emAndamento=null;}
 })();
 return emAndamento;
}
/** Só para testes. */
export function reiniciarIndicesAutomaticos(){concluido=false;emAndamento=null;}
/** Espera no máximo `ms`; o que não terminar segue em segundo plano e é conferido de novo na próxima chamada. */
export function garantirIndicesComTeto(ms:number,deps?:Dependencias):Promise<boolean>{
 return Promise.race([garantirIndicesUmaVez(deps),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),ms))]);
}
