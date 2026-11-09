import {describe,expect,it} from 'vitest';
import {bootstrapInstallation} from './bootstrap.server';
import {MemoryStore} from './rpc-test-store';
import type {ListOptions,Row,Store,StoreTransaction} from './store-types';

// O Firestore de produção recusa (PERMISSION_DENIED) um commit cujas regras façam mais de 20 consultas
// (exists/get/getAfter), somando as gravações. O emulador não aplica esse limite: por isso o primeiro acesso
// passava nos testes e era recusado num teste real no AI Studio, com as regras corretas publicadas.

/** Registra as coleções gravadas em cada commit, como o FirestoreStore envia ao banco. */
class StoreQueConta implements Store{
 commits:string[][]=[];
 constructor(readonly base=new MemoryStore()){}
 get(c:string,id:string|number){return this.base.get(c,id);}
 list(c:string,o?:ListOptions){return this.base.list(c,o);}
 async set(c:string,id:string|number,row:Row,merge?:boolean){await this.base.set(c,id,row,merge);this.commits.push([c]);}
 async delete(c:string,id:string|number){await this.base.delete(c,id);this.commits.push([c]);}
 async runTransaction<T>(fn:(tx:StoreTransaction)=>Promise<T>){
  const gravadas:string[]=[];
  const resultado=await this.base.runTransaction(tx=>fn({
   get:(c,id)=>tx.get(c,id),list:(c,o)=>tx.list(c,o),
   set:async(c,id,row,merge)=>{gravadas.push(c);await tx.set(c,id,row,merge);},
   delete:async(c,id)=>{gravadas.push(c);await tx.delete(c,id);},
  }));
  if(gravadas.length)this.commits.push(gravadas);
  return resultado;
 }
}

/**
 * Consultas de regra de um commit, contadas no firestore.rules. O FirestoreStore acrescenta um marcador
 * mudancas/{coleção} por coleção tocada (3 consultas cada).
 * - Antes de existir o membro (primeiro acesso): instalacao 1 (getAfter do membro), membros 2 (exists e getAfter
 *   da instalação), configuracao e etapas 3 (exists do membro, depois exists e getAfter da instalação).
 * - Já administrador: cada gravação custa 3 (exists, get e get do membro).
 */
function consultas(colecoes:string[],antesDoMembro:boolean){
 const custo=(c:string)=>antesDoMembro?({instalacao:1,membros:2} as Record<string,number>)[c]??3:3;
 const marcadores=new Set(colecoes.filter(c=>c!=='mudancas')).size;
 return colecoes.reduce((total,c)=>total+custo(c),0)+marcadores*3;
}
const dono={uid:'dono',email:'dono@example.test',name:'Dono',verified:true};

describe('primeiro acesso cabe no limite de 20 consultas de regra por commit',()=>{
 it('a transação única antiga passava do limite (por isso o PERMISSION_DENIED em produção)',()=>{
  const antiga=['instalacao','membros','configuracao',...Array(6).fill('etapas')];
  expect(consultas(antiga,true)).toBeGreaterThan(20);
 });

 it('o dono é decidido numa transação pequena e o resto vem em commits pequenos',async()=>{
  const store=new StoreQueConta();
  expect(await bootstrapInstallation(store,dono)).toEqual({owner:true,member:true});
  expect([...store.commits[0]!].sort()).toEqual(['instalacao','membros']);
  store.commits.forEach((colecoes,i)=>expect(consultas(colecoes,i===0)).toBeLessThanOrEqual(20));
  expect(await store.get('configuracao',1)).toMatchObject({espera_lote_s:8});
  expect((await store.list('etapas')).map(e=>e['chave']).sort()).toEqual(['em_conversa','ganho','novo','perdido','proposta','qualificado']);
 });

 it('se o primeiro acesso parou no meio, o próximo login do dono completa sem duplicar nem alterar',async()=>{
  const store=new StoreQueConta();
  await store.base.set('instalacao','principal',{id:'principal',ownerUid:'dono',criado_em:'x',versao:1});
  await store.base.set('membros','dono',{id:'dono',user_id:'dono',papel:'admin',ativo:true});
  await store.base.set('configuracao',1,{id:1,espera_lote_s:19});
  await store.base.set('etapas','e1',{id:'e1',chave:'novo'});
  await store.base.set('etapas','e2',{id:'e2',chave:'em_conversa'});
  await bootstrapInstallation(store,dono);
  expect((await store.get('configuracao',1))?.['espera_lote_s']).toBe(19);
  const chaves=(await store.list('etapas')).map(e=>e['chave']);
  expect(chaves).toHaveLength(6);
  expect(new Set(chaves).size).toBe(6);
 });

 it('o login de outra pessoa numa cópia pronta não grava nada',async()=>{
  const store=new StoreQueConta();
  await bootstrapInstallation(store,dono);
  const antes=store.commits.length;
  expect(await bootstrapInstallation(store,{uid:'outra',email:'outra@example.test',verified:true})).toEqual({owner:false,member:false});
  expect(store.commits.length).toBe(antes);
 });
});
