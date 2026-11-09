import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

// A prévia do AI Studio troca o corpo das respostas 403/502/503/504 por HTML, e o motivo do erro some
// (teste real de importação: o primeiro login mostrou só "Não deu para entrar agora" e a resposta era
// "<h1>403 Forbidden</h1>"). Mesma proteção do outro app AI PRO validado no AI Studio.
const ator=vi.hoisted(()=>({actor:{uid:'u1',email:'dono@example.test',name:'Dono',verified:false}}));
vi.mock('./identity.server',async original=>({
 ...(await original<typeof import('./identity.server')>()),
 identityFromRequest:async()=>({actor:ator.actor,token:'token-nao-pode-vazar'}),
}));
const {handleFirebaseRequest}=await import('./api.server');
const {interpretarRespostaApi}=await import('./client');
const {traduzirErroConta}=await import('@/features/conta/erros');

const primeiroAcesso=()=>new Request('http://localhost/api/firebase',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer token-nao-pode-vazar'},body:JSON.stringify({kind:'bootstrap'})});
let logs:string[]=[];
beforeEach(()=>{logs=[];vi.spyOn(console,'error').mockImplementation((...a:unknown[])=>{logs.push(a.join(' '));});});
afterEach(()=>{delete process.env['APPLET_ID'];vi.restoreAllMocks();});

describe('erros atravessam o proxy da prévia do AI Studio',()=>{
 it('na prévia, a recusa sai como 500 com o status original e o motivo em JSON',async()=>{
  process.env['APPLET_ID']='applet-teste';
  const resposta=(await handleFirebaseRequest(primeiroAcesso()))!;
  expect(resposta.status).toBe(500);
  const corpo=await resposta.json();
  expect(corpo.error_status).toBe(403);
  expect(corpo.error.code).toBe('operation_failed');
  expect(typeof corpo.error.message).toBe('string');
 });

 it('fora do AI Studio, o status continua o original',async()=>{
  const resposta=(await handleFirebaseRequest(primeiroAcesso()))!;
  expect(resposta.status).toBe(403);
  expect((await resposta.json()).error_status).toBeUndefined();
 });

 it('o motivo vai para o log do servidor, sem o token',async()=>{
  process.env['APPLET_ID']='applet-teste';
  await handleFirebaseRequest(primeiroAcesso());
  expect(logs.join('\n')).toMatch(/\[AI PRO Janete\] \/api\/firebase recusou \(403, sem_codigo\): Confirme seu e-mail/);
  expect(logs.join('\n')).not.toContain('token-nao-pode-vazar');
 });

 it('o navegador restaura o status e mostra a mensagem do servidor, em vez da genérica',()=>{
  const corpo=JSON.stringify({data:null,error:{message:'O Firebase recusou o acesso. Confira a instalação e as permissões desta conta.',code:'sem_acesso'},error_status:403});
  let erro:any;
  try{interpretarRespostaApi(500,false,corpo);}catch(e){erro=e;}
  expect(erro).toMatchObject({status:403,code:'sem_acesso',origem:'api'});
  expect(traduzirErroConta(erro,'entrar').mensagem).toBe('O Firebase recusou o acesso. Confira a instalação e as permissões desta conta.');
 });

 it('se ainda vier o HTML da plataforma, a tela diz que foi a prévia que recusou',()=>{
  let erro:any;
  try{interpretarRespostaApi(403,false,'<html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1></body></html>');}catch(e){erro=e;}
  expect(erro).toMatchObject({status:403,code:'resposta_invalida',origem:'api'});
  expect(traduzirErroConta(erro,'entrar').mensagem).toMatch(/prévia do Google AI Studio recusou o pedido/);
 });

 it('resposta de sucesso segue igual',()=>{
  expect(interpretarRespostaApi(200,true,JSON.stringify({data:{owner:true},error:null}))).toEqual({data:{owner:true},error:null});
 });
});
