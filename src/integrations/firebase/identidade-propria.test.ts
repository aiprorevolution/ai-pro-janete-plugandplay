// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';

// Atendimento sem ninguém logado (webhook do WhatsApp) no app publicado pelo AI Studio, sem o instalador:
// o servidor tenta a identidade do próprio serviço. O diagnóstico diz, só com sim/não, se ela alcança o banco.
const google=vi.hoisted(()=>({token:null as string|null}));
vi.mock('google-auth-library',()=>({GoogleAuth:class{async getAccessToken(){if(!google.token)throw new Error('sem identidade no ambiente');return google.token;}}}));
vi.mock('./config.server',async original=>({...(await original<typeof import('./config.server')>()),getInstallationConfig:async()=>({projectId:'demo-janete',apiKey:'k',appId:'a',authDomain:'d',firestoreDatabaseId:'banco',storageBucket:''})}));
const {getDatabaseAccessToken,requestIdentity}=await import('./identity.server');
const {FirestoreStore}=await import('./store.server');
const {enderecoPublicoDoAmbiente}=await import('./config.server');
const {diagnosticarServidor}=await import('./diagnostico.server');

afterEach(()=>{google.token=null;vi.unstubAllEnvs();});

describe('identidade do servidor sem instalador',()=>{
 it('com alguém logado, continua usando o login dele (as regras valem)',async()=>{
  google.token='do-servico';
  const token=await requestIdentity.run({actor:{uid:'u',verified:true},token:'do-usuario'},()=>getDatabaseAccessToken());
  expect(token).toBe('do-usuario');
 });
 it('sem login (webhook), usa a identidade do próprio serviço publicado',async()=>{
  google.token='do-servico';
  expect(await getDatabaseAccessToken()).toBe('do-servico');
 });
 it('sem login e sem identidade no ambiente, explica que falta a identidade do servidor',async()=>{
  await expect(getDatabaseAccessToken()).rejects.toMatchObject({code:'server_identity_required',status:503});
 });
});

describe('endereço público do app',()=>{
 it('usa o APP_URL do AI Studio quando o instalador não definiu',()=>{
  vi.stubEnv('APP_URL','https://minha-janete.ai.studio/');
  expect(enderecoPublicoDoAmbiente()).toBe('https://minha-janete.ai.studio');
 });
 it('o endereço do instalador tem prioridade',()=>{
  vi.stubEnv('APP_URL','https://minha-janete.ai.studio');
  vi.stubEnv('JANETE_PUBLIC_URL','https://atendimento.example.test');
  expect(enderecoPublicoDoAmbiente()).toBe('https://atendimento.example.test');
 });
 it.each(['https://ais-dev-abc123-111.us-east1.run.app','http://minha-janete.ai.studio','https://localhost:3000','não é endereço'])('nunca usa endereço da prévia, sem https ou local: %s',valor=>{
  vi.stubEnv('APP_URL',valor);
  expect(enderecoPublicoDoAmbiente()).toBeUndefined();
 });
});

describe('diagnóstico do servidor',()=>{
 it('identidade com acesso ao banco: responde só sim/ok, sem dados',async()=>{
  vi.stubEnv('APP_URL','https://minha-janete.ai.studio');
  const resultado=await diagnosticarServidor({obterToken:async()=>'do-servico',lerInstalacao:async()=>({id:'principal',ownerUid:'segredo'})});
  expect(resultado).toEqual({aplicativo:'AI PRO Janete',identidadePropria:'sim',bancoComIdentidadePropria:'ok',enderecoPublico:'https://minha-janete.ai.studio',fila:'ausente'});
  expect(JSON.stringify(resultado)).not.toContain('segredo');
 });
 it('identidade sem permissão no banco',async()=>{
  const resultado=await diagnosticarServidor({obterToken:async()=>'do-servico',lerInstalacao:async()=>{throw Object.assign(new Error('Missing or insufficient permissions.'),{code:'PERMISSION_DENIED',status:403});}});
  expect(resultado).toMatchObject({identidadePropria:'sim',bancoComIdentidadePropria:'recusado',enderecoPublico:'ausente'});
 });
 it('sem identidade no ambiente (como na prévia)',async()=>{
  const lerInstalacao=vi.fn();
  const resultado=await diagnosticarServidor({obterToken:async()=>{throw new Error('sem');},lerInstalacao});
  expect(resultado).toMatchObject({identidadePropria:'não',bancoComIdentidadePropria:'sem identidade'});
  expect(lerInstalacao).not.toHaveBeenCalled();
 });
});

describe('modo de transação segue a identidade em uso',()=>{
 function transporte(){const urls:string[]=[];const fetcher=vi.fn(async(input:any,init:any)=>{const url=String(input);urls.push(url);if(url.endsWith(':beginTransaction'))return Response.json({transaction:'t'});if(url.endsWith(':batchGet'))return Response.json([{missing:'x'}]);if((init?.method??'GET')==='GET')return new Response('{}',{status:404});return Response.json({});}) as unknown as typeof fetch;return {urls,fetcher};}
 const transacao=(store:InstanceType<typeof FirestoreStore>)=>store.runTransaction(async tx=>{await tx.get('contatos','um');await tx.set('contatos','um',{id:'um'});});
 it('com o login de alguém (prévia): otimista, sem abrir transação no servidor',async()=>{
  const {urls,fetcher}=transporte();
  await requestIdentity.run({actor:{uid:'u',verified:true},token:'do-usuario'},()=>transacao(new FirestoreStore(async()=>'do-usuario',fetcher)));
  expect(urls.some(u=>u.endsWith(':beginTransaction'))).toBe(false);
 });
 it('sem ninguém logado (webhook): identidade do serviço, com transação de servidor',async()=>{
  const {urls,fetcher}=transporte();
  await transacao(new FirestoreStore(async()=>'do-servico',fetcher));
  expect(urls.some(u=>u.endsWith(':beginTransaction'))).toBe(true);
 });
});
