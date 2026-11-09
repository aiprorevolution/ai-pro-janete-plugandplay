// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';

// Quem conecta o WhatsApp na prévia e depois publica: o webhook só passa a apontar para o endereço publicado dentro da
// rodada do worker, que só rodava quando chegava mensagem. O login de um membro pede o toque do motor, com a identidade
// do serviço (fora da identidade de quem entrou), e nunca impede o login.
const m=vi.hoisted(()=>({bootstrap:vi.fn(),indices:vi.fn(),toque:vi.fn(),identidadeNoToque:[] as unknown[]}));
vi.mock('./identity.server',async original=>{
 const real=await original<typeof import('./identity.server')>();
 m.toque.mockImplementation(async()=>{m.identidadeNoToque.push(real.requestIdentity.getStore());return 'tocado';});
 return {...real,identityFromRequest:async()=>({actor:{uid:'u1',email:'dono@example.test',name:'Dono',verified:true},token:'token-do-usuario'})};
});
vi.mock('./bootstrap.server',()=>({bootstrapInstallation:m.bootstrap}));
vi.mock('./indices-automaticos.server',()=>({garantirIndicesComTeto:m.indices}));
vi.mock('@/features/mensageria/nucleo/motor.server',()=>({acordarMotor:m.toque}));
const {handleFirebaseRequest}=await import('./api.server');
const {requestIdentity}=await import('./identity.server');

const entrar=()=>new Request('http://localhost/api/firebase',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer token-do-usuario'},body:JSON.stringify({kind:'bootstrap'})});
beforeEach(()=>{
 m.bootstrap.mockReset();m.indices.mockReset();m.toque.mockClear();m.identidadeNoToque.length=0;
 m.indices.mockResolvedValue(true);
 m.toque.mockImplementation(async()=>{m.identidadeNoToque.push(requestIdentity.getStore());return 'tocado';});
});

describe('login pede o toque do motor',()=>{
 it('membro que entra pede o toque, fora da identidade do usuário',async()=>{
  m.bootstrap.mockResolvedValue({owner:true,member:true});
  const resposta=(await handleFirebaseRequest(entrar()))!;
  expect(resposta.status).toBe(200);
  expect(m.toque).toHaveBeenCalledTimes(1);
  expect(m.toque).toHaveBeenCalledWith();
  expect(m.identidadeNoToque).toEqual([undefined]);
 });
 it('atendente (membro que não é dono) também pede',async()=>{
  m.bootstrap.mockResolvedValue({owner:false,member:true});
  await handleFirebaseRequest(entrar());
  expect(m.toque).toHaveBeenCalledTimes(1);
  expect(m.indices).not.toHaveBeenCalled();
 });
 it('quem não é membro não pede nada',async()=>{
  m.bootstrap.mockResolvedValue({owner:false,member:false});
  const resposta=(await handleFirebaseRequest(entrar()))!;
  expect(resposta.status).toBe(200);
  expect(m.toque).not.toHaveBeenCalled();
 });
 it('toque que falha nunca impede o login',async()=>{
  m.bootstrap.mockResolvedValue({owner:true,member:true});
  m.toque.mockRejectedValue(new Error('offline'));
  const resposta=(await handleFirebaseRequest(entrar()))!;
  expect(resposta.status).toBe(200);
  expect((await resposta.json()).data).toEqual({owner:true,member:true});
 });
});
