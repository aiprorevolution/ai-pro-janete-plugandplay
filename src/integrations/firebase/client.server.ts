import {createQuery} from './query';
import {executeQuery,requireMember} from './query.server';
import {firestoreStore} from './store.server';
import {currentActor} from './identity.server';
import {storageAdapter} from './storage.server';
import type {FirebaseClient} from './client-contract';
// Only these administrative writes are performed by the server handlers after
// validation. The remote query endpoint never receives this authority.
const ADMIN_WRITES=new Set(['configuracao','ia_chaves','conexoes','auditoria']);
/** Servidor usa identidade Google própria; na prévia, contexto autenticado da requisição. */
export const firebaseAdmin:Pick<FirebaseClient,'from'|'rpc'>&{storage:typeof storageAdapter}={
 from(collection:string){return createQuery(async request=>{
  const actor=currentActor();
  if(request.operation!=='select'&&!actor.system&&ADMIN_WRITES.has(collection)){
   try{
    const member=await requireMember(firestoreStore,actor);
    if(member['papel']!=='admin')throw Object.assign(new Error('sem_acesso'),{code:'sem_acesso',status:403});
    return executeQuery(request,{actor:{...actor,system:true}});
   }catch(error){return {data:null,error,count:null};}
  }
  return executeQuery(request,{actor});
 },collection);},
 async rpc(name:string,args:any={}){try{const {dispatchRpc}=await import('./rpc.server');return {data:await dispatchRpc(name,args,{store:firestoreStore,actor:currentActor()}),error:null};}catch(error){return {data:null,error};}},
 storage:storageAdapter,
};
