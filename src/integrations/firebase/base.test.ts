// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest';
import {normalizeConfig} from './config';
import {FirestoreStore,encodeFields,decodeFields,buildQuery} from './store.server';
import {parseOr,createQuery} from './query';
import {bootstrapInstallation} from './bootstrap.server';
import {executeQuery} from './query.server';
import type {Store,StoreTransaction,Row,ListOptions} from './store-types';
vi.mock('./config.server',()=>({getInstallationConfig:async()=>({projectId:'demo-janete-test',apiKey:'public-test',appId:'web-test',firestoreDatabaseId:'aluno-nomeado',authDomain:'demo-janete-test.firebaseapp.com',storageBucket:''})}));
vi.mock('./identity.server',()=>({getDatabaseAccessToken:async()=>{throw new Error('Rede real proibida no teste');},currentActor:()=>({uid:'service',verified:true,system:true}),requestIdentity:{getStore:()=>undefined}}));
afterEach(()=>vi.unstubAllEnvs());
class MemoryStore implements Store{
 rows=new Map<string,Row>();private chain:Promise<any>=Promise.resolve();
 async get(c:string,id:string|number){return structuredClone(this.rows.get(`${c}/${id}`)??null)}
 async list(c:string,o:ListOptions={}){const rows=[...this.rows.entries()].filter(([k])=>k.startsWith(c+'/')).map(([,v])=>structuredClone(v)).filter(r=>(o.filters??[]).every(f=>f.op==='eq'?r[f.field]===f.value:f.op==='in'?f.value.includes(r[f.field]):true));return rows.slice(o.offset??0,(o.offset??0)+(o.limit??1000));}
 async set(c:string,id:string|number,row:Row,merge=false){const key=`${c}/${id}`;this.rows.set(key,{...(merge?this.rows.get(key):{}),...structuredClone(row)});}
 async delete(c:string,id:string|number){this.rows.delete(`${c}/${id}`)}
 // Como no Firestore, a transação aplica só os documentos que ela gravou; gravações feitas por fora enquanto ela
 // rodava continuam valendo (antes, a cópia inteira substituía o banco e apagava essas gravações).
 runTransaction<T>(fn:(tx:StoreTransaction)=>Promise<T>):Promise<T>{const run=this.chain.then(async()=>{const copy=new MemoryStore();copy.rows=new Map(structuredClone([...this.rows]));const gravadas=new Set<string>();const tx:StoreTransaction={get:(c,id)=>copy.get(c,id),list:(c,o)=>copy.list(c,o),set:async(c,id,row,merge)=>{gravadas.add(`${c}/${id}`);await copy.set(c,id,row,merge);},delete:async(c,id)=>{gravadas.add(`${c}/${id}`);await copy.delete(c,id);}};const result=await fn(tx);for(const key of gravadas){const row=copy.rows.get(key);if(row===undefined)this.rows.delete(key);else this.rows.set(key,row);}return result});this.chain=run.catch(()=>{});return run;}
}
describe('Firebase installation and transport',()=>{
 it('keeps a neutral copy unconfigured and reads the named database',()=>{expect(normalizeConfig({})).toBeNull();expect(normalizeConfig({projectId:'your-project',apiKey:'YOUR_API_KEY',appId:'YOUR_APP_ID'})).toBeNull();expect(normalizeConfig({projectId:'demo-janete-test',apiKey:'public',appId:'app',firestoreDatabaseId:'aluno-123'})?.firestoreDatabaseId).toBe('aluno-123');});
 it('round trips document values without putting arrays or media into strings',()=>{const value={id:1,name:'Janete',on:true,price:1.5,nil:null,meta:{tags:['a','b']},missing:undefined};expect(decodeFields(encodeFields(value))).toEqual({id:1,name:'Janete',on:true,price:1.5,nil:null,meta:{tags:['a','b']}});});
 it('sends filtering, pagination and disjunction to Firestore',()=>{const query=buildQuery('mensagens',{filters:[{field:'conversa_id',op:'eq',value:'conv'}],or:parseOr('apagada_em.is.null,status.eq.enviada'),order:[{field:'momento',ascending:false}],limit:30,offset:30});expect(query['limit']).toBe(30);expect(query['offset']).toBe(30);expect(query['where'].compositeFilter.filters[1].compositeFilter.op).toBe('OR');});
 it('uses actual named-database REST paths and decodes responses',async()=>{const calls:string[]=[];const transport=vi.fn(async(input:any)=>{calls.push(String(input));return Response.json({fields:encodeFields({id:'u1',ativo:true})})}) as unknown as typeof fetch;const store=new FirestoreStore(async()=>'test-only',transport);expect(await store.get('membros','u1')).toEqual({id:'u1',ativo:true});expect(calls[0]).toContain('/databases/aluno-nomeado/documents/membros/u1');});
 it('a recusa do Firestore diz a operação e as coleções, sem ids nem credenciais',async()=>{const transport=vi.fn(async(input:any,init:any)=>(init?.method??'GET')==='GET'?new Response('{}',{status:404}):Response.json({error:{code:403,message:'Missing or insufficient permissions.',status:'PERMISSION_DENIED'}},{status:403})) as unknown as typeof fetch;const store=new FirestoreStore(async()=>'credencial-secreta',transport,'otimista');const erro:any=await bootstrapInstallation(store,{uid:'uid-do-dono',email:'dono@example.test',verified:true}).catch(e=>e);expect(erro).toMatchObject({code:'PERMISSION_DENIED',status:403,operacao:'POST :commit [instalacao, membros, mudancas, mudancas]'});expect(erro.operacao).not.toContain('uid-do-dono');expect(erro.operacao).not.toContain('credencial-secreta');});
 it('com o login do usuário (prévia), não abre transação no servidor: lê e grava com precondição',async()=>{
  // Teste real no AI Studio: o Firestore recusa :beginTransaction com o token do usuário (PERMISSION_DENIED).
  const chamadas:string[]=[];const commits:any[]=[];
  const transport=vi.fn(async(input:any,init:any)=>{const url=String(input);chamadas.push(url);if((init?.method??'GET')==='GET')return new Response('{}',{status:404});if(url.endsWith(':commit')){commits.push(JSON.parse(init.body));return Response.json({});}return Response.json({});}) as unknown as typeof fetch;
  const store=new FirestoreStore(async()=>'token-do-usuario',transport,'otimista');
  expect(await bootstrapInstallation(store,{uid:'dono',email:'dono@example.test',verified:true})).toEqual({owner:true,member:true});
  expect(chamadas.some(u=>u.endsWith(':beginTransaction'))).toBe(false);
  const primeiro=commits[0].writes;
  const pre=(colecao:string)=>primeiro.find((w:any)=>w.update?.name.includes(`/documents/${colecao}/`))?.currentDocument;
  expect(pre('instalacao')).toEqual({exists:false});
  expect(pre('membros')).toEqual({exists:false});
  expect(primeiro.filter((w:any)=>w.update?.name.includes('/documents/mudancas/')).every((w:any)=>!w.currentDocument)).toBe(true);
 });
 it('se outro login criou a instalação no meio, refaz e não vira dono',async()=>{
  let instalacaoExiste=false;let commits=0;
  const transport=vi.fn(async(input:any,init:any)=>{const url=String(input);
   if((init?.method??'GET')==='GET'){if(url.includes('/instalacao/principal')&&instalacaoExiste)return Response.json({name:'x',updateTime:'2026-11-09T00:00:00Z',fields:encodeFields({id:'principal',ownerUid:'outra',versao:1})});return new Response('{}',{status:404});}
   if(url.endsWith(':commit')){commits++;instalacaoExiste=true;return Response.json({error:{status:'ALREADY_EXISTS',message:'Document already exists'}},{status:409});}
   return Response.json([]);}) as unknown as typeof fetch;
  const store=new FirestoreStore(async()=>'token-do-usuario',transport,'otimista');
  expect(await bootstrapInstallation(store,{uid:'dono',email:'dono@example.test',verified:true})).toEqual({owner:false,member:false});
  expect(commits).toBe(1);
 });
 it('com identidade própria do servidor publicado, usa a transação de servidor',async()=>{
  vi.stubEnv('JANETE_RUNTIME_SERVICE_ACCOUNT','janete@example.iam.gserviceaccount.com');
  const chamadas:string[]=[];
  const transport=vi.fn(async(input:any)=>{const url=String(input);chamadas.push(url);if(url.endsWith(':beginTransaction'))return Response.json({transaction:'tx-1'});if(url.endsWith(':batchGet'))return Response.json([{missing:'x'}]);return Response.json({});}) as unknown as typeof fetch;
  await new FirestoreStore(async()=>'token-do-servico',transport).runTransaction(async tx=>{await tx.get('contatos','um');await tx.set('contatos','um',{id:'um'});});
  expect(chamadas.some(u=>u.endsWith(':beginTransaction'))).toBe(true);
 });
 it('rejects document path traversal before any request',async()=>{const transport=vi.fn();const store=new FirestoreStore(async()=>'test-only',transport);await expect(store.get('membros','../cofre')).rejects.toThrow();expect(transport).not.toHaveBeenCalled();});
 it('retries an aborted transaction and commits revision markers atomically',async()=>{let begins=0,commits=0;const bodies:any[]=[];const transport=vi.fn(async(input:any,init:any)=>{const url=String(input);const body=init?.body?JSON.parse(init.body):null;bodies.push(body);if(url.endsWith(':beginTransaction'))return Response.json({transaction:`tx${++begins}`});if(url.endsWith(':rollback'))return Response.json({});if(url.endsWith(':commit')){commits++;if(commits===1)return Response.json({error:{status:'ABORTED',message:'conflict'}},{status:409});return Response.json({});}return Response.json({fields:encodeFields({id:'one',value:1})})}) as unknown as typeof fetch;const store=new FirestoreStore(async()=>'test-only',transport,'servidor');await store.runTransaction(async tx=>{await tx.get('contatos','one');await tx.set('contatos','one',{id:'one',value:2});});expect(begins).toBe(2);expect(commits).toBe(2);expect(bodies.filter(b=>b?.writes).at(-1).writes).toHaveLength(2);});
 it('count aggregation excludes a list page limit',async()=>{let body:any;const transport=vi.fn(async(_input:any,init:any)=>{body=JSON.parse(init.body);return Response.json([{result:{aggregateFields:{total:{integerValue:'4800'}}}}])}) as unknown as typeof fetch;const store=new FirestoreStore(async()=>'test-only',transport);expect(await store.count('mensagens',{limit:30,offset:60})).toBe(4800);expect(body.structuredAggregationQuery.structuredQuery.limit).toBeUndefined();expect(body.structuredAggregationQuery.structuredQuery.offset).toBeUndefined();});
 it('fails closed if an emulator address is configured in production',async()=>{vi.stubEnv('NODE_ENV','production');vi.stubEnv('FIRESTORE_EMULATOR_HOST','127.0.0.1:18080');const transport=vi.fn();await expect(new FirestoreStore(async()=>'test-only',transport).get('contatos','one')).rejects.toThrow('somente em testes');expect(transport).not.toHaveBeenCalled();});
});
describe('installation access',()=>{
 it('makes only the first verified account owner even on concurrent attempts',async()=>{const store=new MemoryStore();const first={uid:'first',email:'first@example.test',verified:true};const second={uid:'second',email:'second@example.test',verified:true};const [a,b]=await Promise.all([bootstrapInstallation(store,first),bootstrapInstallation(store,second)]);expect(a.owner).toBe(true);expect(b.owner).toBe(false);expect(await store.get('membros','second')).toBeNull();expect((await store.list('etapas')).length).toBe(6);});
 it('never resets settings on another login',async()=>{const store=new MemoryStore();const actor={uid:'first',email:'first@example.test',verified:true};await bootstrapInstallation(store,actor);await store.set('configuracao',1,{espera_lote_s:19},true);await bootstrapInstallation(store,actor);expect((await store.get('configuracao',1))?.['espera_lote_s']).toBe(19);});
 it('refuses unverified first ownership without writing',async()=>{const store=new MemoryStore();await expect(bootstrapInstallation(store,{uid:'first',email:'first@example.test',verified:false})).rejects.toThrow();expect(store.rows.size).toBe(0);});
 it('lets an invited user inspect only their own nonexistent member record',async()=>{const store=new MemoryStore();const query=createQuery(async()=>({data:null,error:null,count:null}),'membros').eq('user_id','invited').request;const result=await executeQuery(query,{store,actor:{uid:'invited',verified:true},remote:true});expect(result.error).toBeNull();expect(result.data).toEqual([]);});
 it('blocks inactive users and unknown private collections',async()=>{const store=new MemoryStore();await store.set('membros','person',{id:'person',ativo:false,papel:'admin'});const actor={uid:'person',verified:true};const q=createQuery(async()=>({data:null,error:null,count:null}),'contatos').request;expect((await executeQuery(q,{store,actor,remote:true})).error.code).toBe('sem_acesso');await store.set('membros','person',{ativo:true},true);q.collection='cofre_config';expect((await executeQuery(q,{store,actor,remote:true})).error.code).toBe('sem_acesso');});
 it('never returns provider ciphertext even when asking for all columns',async()=>{const store=new MemoryStore();await store.set('membros','admin',{id:'admin',ativo:true,papel:'admin'});await store.set('ia_chaves','brain',{id:'brain',ultimos4:'1234',chave_cifrada:'not-a-real-key',segredos:{key:'never-return'}});const q=createQuery(async()=>({data:null,error:null,count:null}),'ia_chaves').request;const result=await executeQuery(q,{store,actor:{uid:'admin',verified:true},remote:true});expect(result.data).toEqual([{id:'brain',ultimos4:'1234'}]);});
});
