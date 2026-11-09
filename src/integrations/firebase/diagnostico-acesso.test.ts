// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';

// O diagnóstico é uma rota pública do app publicado. O resumo (sim/não) continua aberto, lembrado por 1 min para não
// virar gasto de leituras; o estado do motor (horários e tipos dos últimos eventos) e a criação de índices só saem
// para um administrador logado.
const m=vi.hoisted(()=>({diagnosticar:vi.fn(),membro:vi.fn(),identidade:vi.fn()}));
vi.mock('./diagnostico.server',()=>({diagnosticarServidor:m.diagnosticar}));
vi.mock('./identity.server',async original=>({...(await original<typeof import('./identity.server')>()),identityFromRequest:m.identidade}));
vi.mock('./query.server',async original=>({...(await original<typeof import('./query.server')>()),requireMember:m.membro}));
const {handleFirebaseRequest,esquecerDiagnostico}=await import('./api.server');

const pedir=(caminho:string,init:RequestInit={})=>handleFirebaseRequest(new Request(`https://janete.example.test${caminho}`,init)).then(r=>r!);
const logado={headers:{authorization:'Bearer token'}};
beforeEach(()=>{
 vi.resetAllMocks();esquecerDiagnostico();
 m.diagnosticar.mockImplementation(async(_d:unknown,o:{motor?:boolean})=>({aplicativo:'AI PRO Janete',...(o?.motor?{motor:{eventos:[]}}:{})}));
 m.identidade.mockResolvedValue({actor:{uid:'u1',verified:true},token:'token'});
 m.membro.mockResolvedValue({id:'u1',papel:'admin',ativo:true});
});

describe('diagnóstico: o que é público e o que é do administrador',()=>{
 it('sem login: só o resumo, sem o estado do motor',async()=>{
  const corpo=await (await pedir('/api/firebase/diagnostico')).json();
  expect(corpo).toEqual({aplicativo:'AI PRO Janete'});
  expect(m.diagnosticar).toHaveBeenCalledWith(undefined,{motor:false});
 });
 it('sem login: pedidos seguidos usam o resumo lembrado, sem ir ao banco de novo',async()=>{
  await pedir('/api/firebase/diagnostico');await pedir('/api/firebase/diagnostico');await pedir('/api/firebase/diagnostico');
  expect(m.diagnosticar).toHaveBeenCalledTimes(1);
 });
 it('administrador logado: recebe o estado do motor, sempre atual',async()=>{
  const corpo=await (await pedir('/api/firebase/diagnostico',logado)).json();
  expect(corpo.motor).toEqual({eventos:[]});
  await pedir('/api/firebase/diagnostico',logado);
  expect(m.diagnosticar).toHaveBeenCalledTimes(2);
 });
 it('atendente logado ou sessão inválida: só o resumo',async()=>{
  m.membro.mockResolvedValue({id:'u2',papel:'atendente',ativo:true});
  expect((await (await pedir('/api/firebase/diagnostico',logado)).json()).motor).toBeUndefined();
  esquecerDiagnostico();m.identidade.mockRejectedValue(Object.assign(new Error('sessão'),{status:401}));
  expect((await (await pedir('/api/firebase/diagnostico',logado)).json()).motor).toBeUndefined();
 });
 it('criar índices: recusado sem administrador, sem tocar no banco',async()=>{
  expect((await pedir('/api/firebase/diagnostico/indices',{method:'POST'})).status).toBe(401);
  m.membro.mockResolvedValue({id:'u2',papel:'atendente',ativo:true});
  expect((await pedir('/api/firebase/diagnostico/indices',{method:'POST',...logado})).status).toBe(401);
  expect(m.diagnosticar).not.toHaveBeenCalled();
 });
 it('criar índices: administrador logado executa',async()=>{
  expect((await pedir('/api/firebase/diagnostico/indices',{method:'POST',...logado})).status).toBe(200);
  expect(m.diagnosticar).toHaveBeenCalledWith(undefined,{criarIndices:true,motor:true});
 });
});
