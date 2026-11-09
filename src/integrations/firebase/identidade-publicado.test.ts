// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

// No app publicado pelo AI Studio (sem o instalador), o banco é acessado com a identidade do serviço também quando há
// alguém logado: as regras do Firestore só deixam o administrador gravar, e o atendente não conseguia enviar, assumir
// nem marcar como lida. Quem autoriza é o servidor, pelo papel do membro. Na prévia, segue o login de quem pediu.
const m=vi.hoisted(()=>({token:vi.fn()}));
vi.mock('google-auth-library',()=>({GoogleAuth:class{getAccessToken=m.token;}}));
const {getDatabaseAccessToken,requestIdentity,reiniciarIdentidadeDoServico,usaIdentidadeDoServico}=await import('./identity.server');

const atendente={actor:{uid:'u2',email:'atendente@example.test',verified:true},token:'token-do-atendente'};
const comLogin=<T>(fn:()=>Promise<T>|T)=>requestIdentity.run(atendente,fn);
beforeEach(()=>{
 vi.resetAllMocks();reiniciarIdentidadeDoServico();
 m.token.mockResolvedValue('token-do-servico');
 vi.stubEnv('JANETE_RUNTIME_SERVICE_ACCOUNT','');vi.stubEnv('JANETE_PUBLIC_URL','');vi.stubEnv('APP_URL','');
});
afterEach(()=>vi.unstubAllEnvs());

describe('identidade usada no banco',()=>{
 it('app publicado, com alguém logado: identidade do serviço',async()=>{
  vi.stubEnv('APP_URL','https://janete-123.us-west1.run.app');
  expect(await comLogin(()=>getDatabaseAccessToken())).toBe('token-do-servico');
  expect(comLogin(()=>usaIdentidadeDoServico())).toBe(true);
 });
 it('prévia do AI Studio, com alguém logado: o login de quem pediu (as regras se aplicam)',async()=>{
  vi.stubEnv('APP_URL','https://ais-dev-abc.us-west1.run.app');
  expect(await comLogin(()=>getDatabaseAccessToken())).toBe('token-do-atendente');
  expect(comLogin(()=>usaIdentidadeDoServico())).toBe(false);
  expect(m.token).not.toHaveBeenCalled();
 });
 it('sem ninguém logado (webhook, worker): identidade do serviço, publicado ou não',async()=>{
  expect(await getDatabaseAccessToken()).toBe('token-do-servico');
  expect(usaIdentidadeDoServico()).toBe(true);
 });
 it('publicado mas o serviço ficou sem identidade: volta ao login de quem pediu, e passa a seguir as regras',async()=>{
  vi.stubEnv('APP_URL','https://janete-123.us-west1.run.app');
  m.token.mockRejectedValue(new Error('sem identidade'));
  expect(await comLogin(()=>getDatabaseAccessToken())).toBe('token-do-atendente');
  expect(comLogin(()=>usaIdentidadeDoServico())).toBe(false);
 });
 it('sem login e sem identidade do serviço: erro claro, nunca um token inventado',async()=>{
  m.token.mockRejectedValue(new Error('sem identidade'));
  await expect(getDatabaseAccessToken()).rejects.toMatchObject({status:503,code:'server_identity_required'});
 });
 it('com o instalador: sempre a identidade do serviço',async()=>{
  vi.stubEnv('JANETE_RUNTIME_SERVICE_ACCOUNT','janete@demo.iam.gserviceaccount.com');
  expect(await comLogin(()=>getDatabaseAccessToken())).toBe('token-do-servico');
 });
});
