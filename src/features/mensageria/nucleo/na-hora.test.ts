// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {filaConfigurada,processarNaHora} from './motor.server';

// App publicado pelo AI Studio, sem o instalador: não há fila do Cloud Tasks. O webhook roda o ciclo na hora,
// espera o agrupamento de mensagens seguidas vencer e responde, dentro do próprio pedido.
function relogio(pendencias:Array<{proximoEm:number|null;vencidoDesde:number|null}>){
 let t=1_000_000;const esperas:number[]=[];const rodadas:number[]=[];
 const deps={
  agora:()=>t,
  esperar:async(ms:number)=>{esperas.push(ms);t+=ms;},
  rodar:vi.fn(async()=>{rodadas.push(t);}),
  pendencias:vi.fn(async()=>{const p=pendencias.shift()??{proximoEm:null,vencidoDesde:null};return {proximoEm:p.proximoEm===null?null:t+p.proximoEm,vencidoDesde:p.vencidoDesde===null?null:t+p.vencidoDesde,atrasadoDesde:null};}),
  marcarVisto:vi.fn(async()=>true),
 };
 return {deps,esperas,rodadas};
}
afterEach(()=>vi.unstubAllEnvs());

describe('webhook sem fila: atendimento na hora',()=>{
 it('roda o ciclo, espera a rodada vencer (8 s de agrupamento) e roda de novo para responder',async()=>{
  const {deps,esperas}=relogio([{proximoEm:8_000,vencidoDesde:null},{proximoEm:null,vencidoDesde:null}]);
  expect(await processarNaHora(45_000,deps)).toBe('tocado');
  expect(deps.rodar).toHaveBeenCalledTimes(2);
  expect(esperas).toEqual([8_000]);
  expect(deps.marcarVisto).toHaveBeenCalled();
 });
 it('rodada que vence depois do teto fica para o próximo toque, sem prender o pedido',async()=>{
  const {deps,esperas}=relogio([{proximoEm:60_000,vencidoDesde:null}]);
  expect(await processarNaHora(45_000,deps)).toBe('tocado');
  expect(deps.rodar).toHaveBeenCalledTimes(1);
  expect(esperas).toEqual([]);
 });
 it('trabalho vencido e travado por outra execução não vira laço apertado: espera ao menos 1 s',async()=>{
  const {deps,esperas}=relogio([{proximoEm:null,vencidoDesde:-5_000},{proximoEm:null,vencidoDesde:null}]);
  await processarNaHora(45_000,deps);
  expect(esperas).toEqual([1_000]);
 });
 it('falha no ciclo responde "falhou" (o gateway reenvia e nada se perde: o evento já está gravado)',async()=>{
  const {deps}=relogio([]);
  deps.rodar.mockRejectedValueOnce(new Error('falhou'));
  vi.spyOn(console,'error').mockImplementation(()=>{});
  expect(await processarNaHora(45_000,deps)).toBe('falhou');
 });
 it('a fila só existe quando o instalador configurou local e identidade',()=>{
  expect(filaConfigurada()).toBe(false);
  vi.stubEnv('JANETE_TASKS_LOCATION','us-west1');
  expect(filaConfigurada()).toBe(false);
  vi.stubEnv('JANETE_TASKS_SERVICE_ACCOUNT','janete@example.iam.gserviceaccount.com');
  expect(filaConfigurada()).toBe(true);
 });
});
