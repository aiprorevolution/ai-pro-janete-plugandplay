// @vitest-environment node
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,type RulesTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,deleteDoc,writeBatch,updateDoc} from 'firebase/firestore';
import {FirestoreStore} from './store.server';
import {bootstrapInstallation} from './bootstrap.server';
import {createQuery} from './query';
import {executeQuery} from './query.server';
const PROJECT='demo-janete-rules';
vi.setConfig({testTimeout:30000,hookTimeout:30000});
vi.mock('./config.server',()=>({getInstallationConfig:async()=>({projectId:'demo-janete-rules',apiKey:'emulator-only',appId:'test-app',firestoreDatabaseId:'(default)',storageBucket:'',authDomain:'localhost'})}));
const hasEmulator=!!process.env['FIRESTORE_EMULATOR_HOST'];
function jwt(uid:string,email:string,verified=true){const now=Math.floor(Date.now()/1000);const b64=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url');return `${b64({alg:'none',typ:'JWT'})}.${b64({iss:`https://securetoken.google.com/${PROJECT}`,aud:PROJECT,sub:uid,user_id:uid,email,email_verified:verified,iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:'google.com',identities:{}}})}.`;}
describe.runIf(hasEmulator)('Firestore emulator: actual REST transactions and Security Rules',()=>{
 let env:RulesTestEnvironment;
 beforeAll(async()=>{const [host,port]=process.env['FIRESTORE_EMULATOR_HOST']!.split(':');if(host!=='127.0.0.1'&&host!=='localhost')throw new Error('Somente emulador local permitido.');env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host,port:Number(port),rules:readFileSync('firestore.rules','utf8')}});},30000);
 beforeEach(async()=>{await env.clearFirestore();});
 afterAll(async()=>{await env?.cleanup();});
 const owner=()=>env.authenticatedContext('owner',{email:'owner@example.test',email_verified:true}).firestore();
 const user=(uid='operator',email='operator@example.test',verified=true)=>env.authenticatedContext(uid,{email,email_verified:verified}).firestore();
 async function install(){const store=new FirestoreStore(async()=>jwt('owner','owner@example.test'));await bootstrapInstallation(store,{uid:'owner',email:'owner@example.test',name:'Dono',verified:true});return store;}
 async function invite(email='operator@example.test',role='atendente',expires=Date.now()+86400000){await assertSucceeds(setDoc(doc(owner(),'convites',email),{id:email,email,papel:role,expires_at_ms:expires,expires_at:new Date(expires).toISOString()}));}
 function accept(uid='operator',email='operator@example.test',role='atendente',verified=true){const db=user(uid,email,verified);const batch=writeBatch(db);batch.set(doc(db,'membros',uid),{id:uid,user_id:uid,nome:'Pessoa',email,papel:role,ativo:true,criado_em:new Date().toISOString(),vistos:{}});batch.delete(doc(db,'convites',email));batch.set(doc(db,'auditoria','invite-audit'),{id:'invite-audit',acao:'convite_aceito',membro_id:uid});batch.set(doc(db,'mudancas','membros'),{id:'membros',revision:'test-revision',updated_at:new Date().toISOString()});return batch.commit();}
 it('bootstraps a named installation via real Firestore REST commit',async()=>{const store=await install();expect((await store.get('instalacao','principal'))?.['ownerUid']).toBe('owner');expect((await store.list('etapas')).length).toBe(6);expect((await getDoc(doc(owner(),'mudancas','etapas'))).exists()).toBe(true);});
 it('does not let a second account overwrite ownership or create an administrator',async()=>{await install();await assertFails(setDoc(doc(user('outsider','outside@example.test'),'membros','outsider'),{id:'outsider',user_id:'outsider',nome:'Intruso',email:'outside@example.test',papel:'admin',ativo:true,criado_em:'now'}));await assertFails(updateDoc(doc(user('outsider','outside@example.test'),'instalacao','principal'),{ownerUid:'outsider'}));});
 it('allows verified invited membership plus audit and invite deletion in one commit',async()=>{await install();await invite();await assertSucceeds(accept());expect((await getDoc(doc(user(),'membros','operator'))).data()?.['papel']).toBe('atendente');expect((await getDoc(doc(owner(),'convites','operator@example.test'))).exists()).toBe(false);});
 it('rejects role escalation at invite acceptance and after acceptance',async()=>{await install();await invite();await assertFails(accept('operator','operator@example.test','admin'));await assertSucceeds(accept());await assertFails(updateDoc(doc(user(),'membros','operator'),{papel:'admin'}));});
 it('rejects expired, unverified and absent invitations',async()=>{await install();await invite('expired@example.test','atendente',Date.now()-10000);await assertFails(accept('expired','expired@example.test'));await invite();await assertFails(accept('operator','operator@example.test','atendente',false));await assertFails(accept('unknown','unknown@example.test'));});
 it('denies anonymous access and denies operators encrypted keys and encryption secrets',async()=>{const store=await install();await invite();await assertSucceeds(accept());await store.set('ia_chaves','brain',{id:'brain',chave_cifrada:'ciphertext-test'});await store.set('cofre_config','master',{secret:'A'.repeat(64),version:1,createdAt:new Date().toISOString()});await assertFails(getDoc(doc(user(),'ia_chaves','brain')));await assertFails(getDoc(doc(user(),'cofre_config','master')));await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'configuracao','1')));});
 it('preserves required member fields and prevents deleting the owner',async()=>{await install();await assertFails(setDoc(doc(owner(),'membros','owner'),{id:'owner',ativo:true}));await assertFails(deleteDoc(doc(owner(),'membros','owner')));});
 it('allows a nonmember to read their own absent membership only',async()=>{await install();await assertSucceeds(getDoc(doc(user('new','new@example.test'),'membros','new')));await assertFails(getDoc(doc(user('new','new@example.test'),'membros','owner')));});
 it('does not let a pending invitation write audit or revision records by itself',async()=>{await install();await invite();await assertFails(setDoc(doc(user(),'auditoria','forged'),{id:'forged',acao:'convite_aceito'}));await assertFails(setDoc(doc(user(),'mudancas','membros'),{id:'membros',revision:'forged',updated_at:new Date().toISOString()}));});
 it('executes the UI query shapes for media, team and unread conversations',async()=>{
  const store=await install();
  await expect(store.list('mensagens',{filters:[{field:'conversa_id',op:'eq',value:'c1'},{field:'status',op:'neq',value:'cancelada'},{field:'apagada_em',op:'is',value:null}],order:[{field:'momento',ascending:true},{field:'criado_em',ascending:true},{field:'id',ascending:true}],limit:50})).resolves.toEqual([]);
  await expect(store.list('conversas',{filters:[{field:'modo',op:'eq',value:'humano'}],or:[[{field:'responsavel_id',op:'neq',value:null}],[{field:'aguardando_humano_desde',op:'neq',value:null}]],order:[{field:'id',ascending:true}],limit:50})).resolves.toEqual([]);
  await expect(store.list('conversas',{filters:[{field:'nao_lidas',op:'gt',value:0}],order:[{field:'ultima_mensagem_em',ascending:false},{field:'criado_em',ascending:false},{field:'id',ascending:false}],limit:50})).resolves.toEqual([]);
 });
 it('deduplicates disjoint team filters and paginates their ordered union',async()=>{
  const store=await install();
  for(let index=0;index<8;index++){const id=`team-${index}`;await store.set('conversas',id,{id,modo:'humano',responsavel_id:index%2===0?'operator':null,aguardando_humano_desde:index%3===0?'2026-01-01':null});}
  const options={filters:[{field:'modo',op:'eq' as const,value:'humano'}],or:[[{field:'responsavel_id',op:'neq' as const,value:null}],[{field:'aguardando_humano_desde',op:'neq' as const,value:null}]],order:[{field:'id',ascending:true}]};
  expect((await store.list('conversas',{...options,offset:2,limit:2})).map(row=>row['id'])).toEqual(['team-3','team-4']);
  expect(await store.count('conversas',options)).toBe(5);
 });
 it('paginates large IN filters globally, including counts and OR filters',async()=>{
  const store=await install();const ids=Array.from({length:65},(_,index)=>`person-${String(index).padStart(3,'0')}`);
  await store.runTransaction(async tx=>{for(const [index,id] of ids.entries())await tx.set('contatos',id,{id,rank:index,ativo:true,nome:index%2?'impar':'par'});});
  const options={filters:[{field:'id',op:'in' as const,value:[...ids].reverse()}],order:[{field:'rank',ascending:true}],offset:25,limit:15};
  expect((await store.list('contatos',options)).map(row=>row['rank'])).toEqual(Array.from({length:15},(_,index)=>index+25));
  expect(await store.count('contatos',options)).toBe(65);
  expect((await store.list('contatos',{...options,or:[[{field:'nome',op:'eq',value:'par'}],[{field:'ativo',op:'eq',value:true}]]})).map(row=>row['rank'])).toEqual(Array.from({length:15},(_,index)=>index+25));
 });
 it('loads AI history with quoted round and timestamp filters without later incoming messages',async()=>{
  const store=await install();const cutoff='2026-01-01T10:00:01.000Z';
  const cases=[{id:'m0',direcao:'entrada',rodada_id:null,momento:'2026-01-01T10:00:00.000Z'},{id:'m1',direcao:'entrada',rodada_id:'round-1',momento:cutoff},{id:'m2',direcao:'entrada',rodada_id:null,momento:'2026-01-01T10:00:03.000Z'},{id:'m3',direcao:'saida',rodada_id:null,momento:'2026-01-01T10:00:04.000Z'},{id:'m4',direcao:'saida',rodada_id:null,momento:'2026-01-01T10:00:05.000Z',status:'cancelada'}];
  for(const row of cases)await store.set('mensagens',row.id,{conversa_id:'c1',status:'enviada',apagada_em:null,criado_em:row.momento,...row});
  const result=await createQuery(q=>executeQuery(q,{store,actor:{uid:'owner',verified:true}}),'mensagens').eq('conversa_id','c1').not('status','in','(cancelada,falhou)').is('apagada_em',null).or(`direcao.eq.saida,rodada_id.eq."round-1",momento.lte."${cutoff}"`).order('momento',{ascending:false}).order('criado_em',{ascending:false}).limit(30);
  expect(result.error).toBeNull();expect(result.data.map((row:any)=>row.id)).toEqual(['m3','m1','m0']);
 });
 it('deletes a contact and its history through the owner preview token',async()=>{
  const store=await install();await store.set('contatos','contact-delete',{id:'contact-delete',nome:'Excluir'});await store.set('conversas','conversation-delete',{id:'conversation-delete',contato_id:'contact-delete',modo:'humano'});
  for(const collection of ['mensagens','rodadas','conversa_eventos'])await store.set(collection,`${collection}-delete`,{id:`${collection}-delete`,conversa_id:'conversation-delete'});
  await store.set('contato_etapa_historico','history-delete',{id:'history-delete',contato_id:'contact-delete'});
  const result=await createQuery(q=>executeQuery(q,{store,actor:{uid:'owner',verified:true}}),'contatos').delete().eq('id','contact-delete');
  expect(result.error).toBeNull();expect(await store.get('contatos','contact-delete')).toBeNull();expect(await store.get('conversas','conversation-delete')).toBeNull();expect(await store.list('contato_etapa_historico')).toEqual([]);expect(await store.list('rodadas')).toEqual([]);
 });
});
