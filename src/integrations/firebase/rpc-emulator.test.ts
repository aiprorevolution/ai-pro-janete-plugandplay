// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {FirestoreStore} from './store.server';
import {dispatchRpc} from './rpc.server';
import type {Actor,Row} from './store-types';
import {requestIdentity} from './identity.server';
import {firebaseAdmin} from './client.server';
import {executeQuery} from './query.server';
import {salvarRitmoLogica} from '@/features/mensageria/configuracao/acoes.server';
import {salvarChaveIALogica} from '@/features/mensageria/configuracao.server';
import {decifrar,aadChave} from '@/features/mensageria/nucleo/cifra';
const PROJECT='demo-janete-rpc';
vi.setConfig({testTimeout:30000,hookTimeout:30000});
vi.mock('./config.server',()=>({getInstallationConfig:async()=>({projectId:'demo-janete-rpc',apiKey:'emulator-only',appId:'test-app',firestoreDatabaseId:'(default)',storageBucket:'',authDomain:'localhost'})}));
const hasEmulator=!!process.env['FIRESTORE_EMULATOR_HOST'];
const store=new FirestoreStore(async()=> 'owner');
const actor:Actor={uid:'service',verified:true,system:true};
const rpc=(name:string,args:Row={})=>dispatchRpc(name,args,{store,actor});
describe.runIf(hasEmulator)('Domain operations through real Firestore emulator REST',()=>{
 beforeEach(async()=>{
  const host=process.env['FIRESTORE_EMULATOR_HOST'];if(!/^(localhost|127\.0\.0\.1):\d+$/.test(host??''))throw new Error('Somente emulador local.');
  const response=await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,{method:'DELETE'});expect(response.ok).toBe(true);
  await store.set('configuracao',1,{id:1,onboarding_concluido_em:new Date().toISOString(),espera_lote_s:1,espera_lote_max_s:60});
  await store.set('etapas','new',{id:'new',tipo:'aberta',arquivada:false,ordem:0,nome:'Novo',janete_pode_mover:true});
  await store.set('conexoes','conn',{id:'conn',ativa:true,oficial:false,status:'conectada'});
 });
 it('deduplicates concurrent input and preserves a single conversation and unread count',async()=>{
  const args={p_conexao:'conn',p_ids:[{tipo:'telefone',valor:'5511999999999'}],p_msg:{id_externo:'in-1',tipo:'texto',texto:'Teste isolado',momento:new Date().toISOString()}};
  const outputs=await Promise.all([rpc('registrar_entrada',args),rpc('registrar_entrada',args)]);
  expect(outputs.flat().filter(x=>x.nova)).toHaveLength(1);expect(await store.list('contatos')).toHaveLength(1);expect((await store.list('conversas'))[0]?.['nao_lidas']).toBe(1);
 });
 it('commits a full durable round, reserves one message, then records its receipt',async()=>{
  const [entry]=await rpc('registrar_entrada',{p_conexao:'conn',p_ids:[{tipo:'telefone',valor:'5511999999999'}],p_msg:{id_externo:'in-1',tipo:'texto',texto:'Teste isolado',momento:new Date().toISOString()}});
  await store.set('conversas',entry.conversa_id,{responder_apos:new Date(Date.now()-1000).toISOString()},true);
  const [round]=await rpc('pegar_rodadas',{p_limite:1});expect(round).toBeTruthy();await rpc('concluir_rodada',{p_rodada:round.id,p_respostas:[{texto:'Resposta de teste'}]});
  const [message]=await rpc('pegar_envios',{p_limite:1});expect(message.status).toBe('enviando');
  await rpc('concluir_envio',{p_msg:message.id,p_id_externo:'out-1'});await rpc('atualizar_status',{p_conexao:'conn',p_id:'out-1',p_status:'lida',p_momento:new Date().toISOString()});
  expect((await store.get('mensagens',message.id))?.['status']).toBe('lida');
  const now=new Date();const report=await rpc('dashboard_periodo',{p_de:new Date(now.getTime()-86400000).toISOString(),p_ate:new Date(now.getTime()+86400000).toISOString()});expect(report.enviadas).toBe(1);
 });
 it('authenticated admin handlers save settings and encrypted AI key; operator cannot',async()=>{
  await store.set('membros','admin',{id:'admin',user_id:'admin',ativo:true,papel:'admin',email:'admin@example.test'});
  await store.set('membros','operator',{id:'operator',user_id:'operator',ativo:true,papel:'atendente',email:'operator@example.test'});
  const keyInput={finalidade:'resposta' as const,provedor:'openai' as const,modelo:'gpt-test',chave:'sk-test-only-0000'};
  const providerFetch=vi.fn(async(url:string)=>{expect(url).toBe('https://api.openai.com/v1/models/gpt-test');return new Response(JSON.stringify({id:'gpt-test'}),{status:200,headers:{'content-type':'application/json'}});});
  await requestIdentity.run({actor:{uid:'admin',verified:true,email:'admin@example.test'},token:'owner'},async()=>{
   const ctx={firebase:firebaseAdmin,userId:'admin'};
   expect(await salvarRitmoLogica(ctx,{espera:10,teto:60})).toEqual({ok:true,espera:10,teto:60});
   expect((await store.get('configuracao',1))?.['espera_lote_s']).toBe(10);
   expect(await salvarChaveIALogica(ctx,keyInput,{fetch:providerFetch})).toEqual({ok:true,ultimos4:'0000',status:'ativa'});
   const [saved]=await store.list('ia_chaves');expect(saved).toBeTruthy();expect(saved!['chave_cifrada']).not.toBe(keyInput.chave);expect(saved!['atualizada_por']).toBe('admin');expect(await decifrar(saved!['chave_cifrada'],aadChave(saved!['id']))).toBe(keyInput.chave);
  });
  await requestIdentity.run({actor:{uid:'operator',verified:true,email:'operator@example.test'},token:'owner'},async()=>{
   const ctx={firebase:firebaseAdmin,userId:'operator'};expect(await salvarRitmoLogica(ctx,{espera:15,teto:60})).toEqual({ok:false,erro:'sem_acesso'});expect(await salvarChaveIALogica(ctx,keyInput,{fetch:providerFetch})).toEqual({ok:false,erro:'sem_acesso'});
  });
  const remote=await executeQuery({collection:'configuracao',operation:'update',columns:'id',values:{espera_lote_s:50},options:{filters:[{field:'id',op:'eq',value:1}]}},{store,actor:{uid:'admin',verified:true},remote:true});
  expect(remote.error).toBeTruthy();
  expect(providerFetch).toHaveBeenCalledTimes(1);expect((await store.get('configuracao',1))?.['espera_lote_s']).toBe(10);
 });

});
