import {randomUUID} from 'node:crypto';
import type {Actor,Store} from './store-types';

/** Etapas iniciais do kanban: nome, chave e tipo. */
const ETAPAS=[
 {nome:'Novo',chave:'novo'},
 {nome:'Em conversa',chave:'em_conversa'},
 {nome:'Qualificado',chave:'qualificado'},
 {nome:'Proposta',chave:'proposta'},
 {nome:'Ganho',chave:'ganho'},
 {nome:'Perdido',chave:'perdido'},
];

/**
 * Primeiro acesso da instalação, em gravações pequenas.
 *
 * O Firestore de produção recusa (PERMISSION_DENIED) uma transação cujas regras façam mais de 20 consultas
 * (exists/get/getAfter), somando todas as gravações; o emulador não aplica esse limite. Gravar dono, configuração,
 * seis etapas e marcadores numa transação só passava de 30 consultas: num teste real de importação no AI Studio,
 * com as regras corretas publicadas, o primeiro login era recusado.
 *
 * 1. Transação pequena, como no outro app AI PRO validado no AI Studio: só a instalação e o membro administrador.
 *    Decide o dono uma única vez, mesmo com logins simultâneos.
 * 2. Já administrador, o dono cria o que faltar (configuração e etapas), uma gravação por vez. Se algo falhar no meio,
 *    o próximo login do dono completa. Outro login nunca reinicia nem altera o que já existe.
 */
export async function bootstrapInstallation(store:Store,actor:Actor){
 if(!actor.verified||!actor.email)throw Object.assign(new Error('Confirme seu e-mail ou entre com Google para continuar.'),{status:403});
 const email=actor.email;
 const resultado=await store.runTransaction(async tx=>{
  const installation=await tx.get('instalacao','principal');
  const member=await tx.get('membros',actor.uid);
  if(installation)return {owner:installation['ownerUid']===actor.uid,member:!!member?.['ativo']};
  const now=new Date().toISOString();
  await tx.set('instalacao','principal',{id:'principal',ownerUid:actor.uid,criado_em:now,versao:1});
  await tx.set('membros',actor.uid,{id:actor.uid,user_id:actor.uid,nome:actor.name||email.split('@')[0],email,papel:'admin',ativo:true,vistos:{},criado_em:now,atualizado_em:now});
  return {owner:true,member:true};
 });
 if(resultado.owner)await completarInstalacao(store);
 return resultado;
}

/** Cria, uma gravação por vez, a configuração e as etapas que ainda não existem. Nunca altera o que já existe. */
async function completarInstalacao(store:Store){
 const now=new Date().toISOString();
 if(!(await store.get('configuracao',1)))await store.set('configuracao',1,{id:1,espera_lote_s:8,espera_lote_max_s:60,onboarding_concluido_em:null,worker_visto_em:null,voz_resposta:'quando_audio',voz_id:null,voz_nome:null,voz_erro:null,criado_em:now,atualizado_em:now});
 const existentes=new Set((await store.list('etapas')).map(etapa=>etapa['chave']));
 for(const [index,etapa] of ETAPAS.entries()){
  if(existentes.has(etapa.chave))continue;
  const id=randomUUID();
  await store.set('etapas',id,{id,nome:etapa.nome,chave:etapa.chave,ordem:index,tipo:index<4?'aberta':index===4?'ganho':'perdido',cor:index===4?'verde':index===5?'vermelho':'laranja',janete_pode_mover:index<4,arquivada:false,criado_em:now});
 }
}
