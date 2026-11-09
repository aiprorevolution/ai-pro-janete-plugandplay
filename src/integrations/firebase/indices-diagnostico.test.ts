// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {situacaoDosIndices} from './indices.server';
import {diagnosticarServidor} from './diagnostico.server';

const projeto={projectId:'demo-janete',databaseId:'banco-da-copia'};
const indices=[
 {collectionGroup:'rodadas',queryScope:'COLLECTION',fields:[{fieldPath:'conversa_id',order:'ASCENDING'},{fieldPath:'criado_em',order:'DESCENDING'}]},
 {collectionGroup:'mensagens',queryScope:'COLLECTION',fields:[{fieldPath:'conversa_id',order:'ASCENDING'},{fieldPath:'direcao',order:'ASCENDING'}]},
];
// Como o Google devolve um índice pronto: com __name__ no fim.
const pronto={name:'projects/demo-janete/databases/banco-da-copia/collectionGroups/rodadas/indexes/i1',state:'READY',queryScope:'COLLECTION',density:'SPARSE_ALL',
 fields:[{fieldPath:'conversa_id',order:'ASCENDING'},{fieldPath:'criado_em',order:'DESCENDING'},{fieldPath:'__name__',order:'DESCENDING'}]};
function googleFalso(resposta:(url:string,init?:any)=>any){
 const chamadas:{url:string;init?:any}[]=[];
 const api=vi.fn(async(url:string,init?:any)=>{chamadas.push({url,init});return resposta(url,init);});
 return {api,chamadas};
}
const listagens=(url:string)=>url.includes('/collectionGroups/rodadas/indexes?')?{indexes:[pronto]}:url.includes('/indexes?')?{indexes:[]}:{databaseEdition:'STANDARD'};

describe('índices criados pelo próprio app publicado',()=>{
 it('só confere: conta os prontos e os que faltam, sem criar',async()=>{
  const {api,chamadas}=googleFalso(listagens);
  expect(await situacaoDosIndices(api,projeto,false,indices)).toEqual({exigidos:2,prontos:1,criando:0,faltando:1,criadosAgora:0});
  expect(chamadas.some(c=>c.init?.method==='POST')).toBe(false);
 });
 it('cria só o que falta, com o mesmo corpo do instalador, sem esperar ficar pronto',async()=>{
  const {api,chamadas}=googleFalso((url,init)=>init?.method==='POST'?{name:'op-1'}:listagens(url));
  expect(await situacaoDosIndices(api,projeto,true,indices)).toEqual({exigidos:2,prontos:1,criando:1,faltando:0,criadosAgora:1});
  const criacao=chamadas.find(c=>c.init?.method==='POST')!;
  expect(criacao.url).toContain('/databases/banco-da-copia/collectionGroups/mensagens/indexes');
  expect(criacao.init.body).toEqual({queryScope:'COLLECTION',apiScope:'ANY_API',density:'SPARSE_ALL',fields:indices[1]!.fields});
 });
 it('"já existe" (409) conta como em criação; sem permissão (403) interrompe',async()=>{
  const ja=googleFalso((url,init)=>{if(init?.method==='POST')throw Object.assign(new Error('x'),{status:409});return listagens(url);});
  expect((await situacaoDosIndices(ja.api,projeto,true,indices)).criando).toBe(1);
  const negado=googleFalso((url,init)=>{if(init?.method==='POST')throw Object.assign(new Error('x'),{status:403,code:'PERMISSION_DENIED'});return listagens(url);});
  await expect(situacaoDosIndices(negado.api,projeto,true,indices)).rejects.toMatchObject({status:403});
 });
 it('o arquivo real de índices do app é válido para o criador',async()=>{
  const {api}=googleFalso(url=>url.includes('/indexes?')?{indexes:[]}:{databaseEdition:'STANDARD'});
  const situacao=await situacaoDosIndices(api,projeto,false);
  expect(situacao.exigidos).toBeGreaterThan(100);
  expect(situacao.faltando).toBe(situacao.exigidos);
 });
});

describe('diagnóstico com motor e índices',()=>{
 const base={obterToken:async()=>'do-servico',lerInstalacao:async()=>null};
 it('mostra índices e o estado do motor, sem conteúdo de mensagem',async()=>{
  const motor={ultimaExecucao:'2026-11-09T20:00:00Z',eventos:[{recebido_em:'2026-11-09T20:00:00Z',tipo:'mensagem',processado:false,tentativas:1,erro:'falta_indice'}],rodadas:[]};
  const r=await diagnosticarServidor({...base,indices:async()=>({exigidos:110,prontos:0,criando:110,faltando:0,criadosAgora:110}),motor:async()=>motor});
  expect(r.indices).toMatchObject({exigidos:110,criando:110});
  expect(r.motor).toEqual(motor);
 });
 it('erro de permissão vira texto curto, sem detalhes',async()=>{
  const r=await diagnosticarServidor({...base,indices:async()=>{throw Object.assign(new Error('detalhe interno'),{status:403});},motor:async()=>{throw Object.assign(new Error('detalhe interno'),{code:'FAILED_PRECONDITION'});}});
  expect(r.indices).toEqual({erro:'sem permissão'});
  expect(r.motor).toEqual({erro:'falta índice'});
  expect(JSON.stringify(r)).not.toContain('detalhe interno');
 });
});
