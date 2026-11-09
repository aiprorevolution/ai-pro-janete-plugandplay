import {randomUUID} from 'node:crypto';
import type {Actor,Store} from './store-types';
export async function bootstrapInstallation(store:Store,actor:Actor){
 if(!actor.verified||!actor.email)throw Object.assign(new Error('Confirme seu e-mail ou entre com Google para continuar.'),{status:403});
 const email=actor.email;
 return store.runTransaction(async tx=>{
  const installation=await tx.get('instalacao','principal');
  const member=await tx.get('membros',actor.uid);
  if(installation)return {owner:installation['ownerUid']===actor.uid,member:!!member?.['ativo']};
  const now=new Date().toISOString();
  await tx.set('instalacao','principal',{id:'principal',ownerUid:actor.uid,criado_em:now,versao:1});
  await tx.set('membros',actor.uid,{id:actor.uid,user_id:actor.uid,nome:actor.name||email.split('@')[0],email,papel:'admin',ativo:true,vistos:{},criado_em:now,atualizado_em:now});
  await tx.set('configuracao',1,{id:1,espera_lote_s:8,espera_lote_max_s:60,onboarding_concluido_em:null,worker_visto_em:null,voz_resposta:'quando_audio',voz_id:null,voz_nome:null,voz_erro:null,criado_em:now,atualizado_em:now});
  const names=['Novo','Em conversa','Qualificado','Proposta','Ganho','Perdido'];
  const keys=['novo','em_conversa','qualificado','proposta','ganho','perdido'];
  for(let index=0;index<names.length;index++){const id=randomUUID();await tx.set('etapas',id,{id,nome:names[index],chave:keys[index],ordem:index,tipo:index<4?'aberta':index===4?'ganho':'perdido',cor:index===4?'verde':index===5?'vermelho':'laranja',janete_pode_mover:index<4,arquivada:false,criado_em:now});}
  return {owner:true,member:true};
 });
}
