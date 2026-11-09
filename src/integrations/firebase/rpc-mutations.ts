import type { Actor, ListOptions, Row, Store, StoreTransaction } from './store-types';
import { audit, bounded, eq, fail, insertMessage, iso, key, moveContact, requireMember, sequence, transact, uid, updateMessage } from './rpc-common';

export type MutationInput={store:Store;actor:Actor|null;collection:string;operation:'insert'|'upsert'|'update'|'delete';values?:Row|Row[];options?:ListOptions};
const COLLECTIONS=new Set(['auditoria','conexao_eventos','conexoes','configuracao','contato_etapa_historico','contato_identificadores','contatos','contexto_versoes','conversa_eventos','conversas','convites','etapas','eventos_webhook','ia_chamadas','ia_chaves','ia_precos','membros','mensagens','motor','rodadas']);
const CONTACT_FIELDS=new Set(['nome','nome_whatsapp','telefone','email','empresa','etapa_id','observacoes']);
const STAGE_FIELDS=new Set(['nome','cor','janete_pode_mover','arquivada']);

async function authorize(tx:StoreTransaction,actor:Actor|null,collection:string,operation:string,values:Row[]):Promise<Row|null>{
  if(actor?.system)return null;
  const member=await requireMember(tx,actor);
  if(collection==='contatos'&&operation==='update') {
    if(values.some(r=>Object.keys(r).some(k=>!CONTACT_FIELDS.has(k))))fail('campo_nao_permitido');return member;
  }
  if(collection==='etapas'&&operation==='update'&&member['papel']==='admin') {
    if(values.some(r=>Object.keys(r).some(k=>!STAGE_FIELDS.has(k))))fail('campo_nao_permitido');return member;
  }
  if(collection==='mensagens'&&operation==='insert') {
    const allowed=new Set(['id','conversa_id','direcao','origem','tipo','texto','status','midia_caminho','midia_nome','midia_mime','midia_tamanho','responde_a_id','midia_duracao_s']);
    if(values.some(r=>r['direcao']!=='saida'||r['origem']!=='humano_tela'||r['status']!=='na_fila'||Object.keys(r).some(k=>!allowed.has(k))))fail('mensagem_invalida');
    return member;
  }
  return fail('sem_acesso','42501');
}

async function defaults(tx:StoreTransaction,collection:string,row:Row):Promise<Row>{
  const now=iso();
  const id=row['id']??(collection==='membros'?row['user_id']:collection==='configuracao'?1:collection==='motor'?'principal':['eventos_webhook','contexto_versoes','ia_chamadas'].includes(collection)?await sequence(tx,collection):uid());
  const common={id,criado_em:now};
  const shapes:Record<string,Row>={
    contatos:{nome:null,nome_whatsapp:null,telefone:null,email:null,empresa:null,etapa_id:null,etapa_desde:now,observacoes:null,resumo_janete:null,resumo_janete_em:null,anotacoes_janete:{},primeira_mensagem_em:null,atualizado_em:now},
    conexoes:{ativa:false,status:'desconectada',parametros:{},segredos:{},oficial:false,ultimo_erro:null,criado_por:null,atualizado_em:now},
    membros:{ativo:true,papel:'atendente',vistos:{},convidado_por:null},
    convites:{user_id:null,enviado_em:now},
    etapas:{tipo:'aberta',janete_pode_mover:false,arquivada:false,ordem:0,cor:'#f97316'},
    eventos_webhook:{recebido_em:now,processado_em:null,pego_em:null,tentativas:0,erro:null,id_evento:null,tipo:null},
    ia_chaves:{status:'ativa',chave_cifrada:null,workspace_id:null,ultimo_erro:null,ultimos4:null,validada_em:null,atualizada_em:now,atualizada_por:null},
    ia_chamadas:{custo_usd:null,custo_origem:'sem_preco',erro:null},
    configuracao:{espera_lote_s:8,espera_lote_max_s:60,onboarding_concluido_em:null,worker_visto_em:null,voz_resposta:'quando_audio',voz_id:null,voz_nome:null,voz_erro:null,atualizado_em:now},
    auditoria:{ator_membro_id:null,alvo:null,ultimos4:null,detalhe:{}},
  };
  return {...common,...shapes[collection],...row,id};
}

function uniqueFields(collection:string,row:Row):string[]|null {
  return collection==='eventos_webhook'&&row['id_evento']?['gateway','conexao_id','id_evento']:collection==='ia_chaves'?['finalidade']:collection==='convites'?['email']:collection==='membros'?['user_id']:collection==='contato_identificadores'?['tipo','valor',...(row['tipo']==='zernio_conversa'?['conexao_id']:[])]:null;
}
async function unique(tx:StoreTransaction,collection:string,row:Row,before:Row|null){
  const fields=uniqueFields(collection,row);
  if(!fields)return;
  const name=key(collection,...fields.map(f=>row[f]??null));
  const index=await tx.get('indices_unicos',name);
  if(index&&String(index['registro_id'])!==String(row['id']))fail('registro_duplicado','23505');
  if(before){const old=key(collection,...fields.map(f=>before[f]??null));if(old!==name)await tx.delete('indices_unicos',old);}
  await tx.set('indices_unicos',name,{id:name,colecao:collection,registro_id:row['id']});
}

/** Resumable bounded deletion; each batch commits before the next read. */
async function deleteContactBatches(store:Store,actor:Actor|null,options:ListOptions):Promise<Row[]>{
  const targets=await transact(store,async tx=>{
    if(!actor?.system)await requireMember(tx,actor,true);
    const contacts=await bounded(tx,'contatos',options,50);
    for(const c of contacts)await tx.set('contatos',c['id'],{exclusao_em:iso()},true);
    return contacts;
  });
  for(const contact of targets){
    const conversations=await bounded(store,'conversas',{filters:[eq('contato_id',contact['id'])]},100);
    for(const conversation of conversations){
      await store.set('conversas',conversation['id'],{modo:'humano',responder_apos:null,exclusao_em:iso()},true);
      for(const table of ['mensagens','rodadas','conversa_eventos','ia_chamadas']){
        for(let batch=0;batch<1000;batch++){
          const count=await transact(store,async tx=>{
            const records=await tx.list(table,{filters:[eq('conversa_id',conversation['id'])],limit:100});
            for(const record of records){
              if(table==='ia_chamadas'){await tx.set(table,record['id'],{conversa_id:null,rodada_id:null},true);continue;}
              if(table==='mensagens'&&record['id_externo'])await tx.delete('indices_unicos',key('mensagem',record['conexao_id'],record['id_externo']));
              await tx.delete(table,record['id']);
            }
            return records.length;
          });
          if(count<100)break;
          if(batch===999)fail('exclusao_em_andamento');
        }
      }
      await store.delete('conversas',conversation['id']);
    }
    for(const table of ['contato_identificadores','contato_etapa_historico']){
      for(let batch=0;batch<1000;batch++){
        const count=await transact(store,async tx=>{
          const records=await tx.list(table,{filters:[eq('contato_id',contact['id'])],limit:100});
          for(const record of records){
            if(table==='contato_identificadores')await tx.delete('indices_unicos',key(table,record['tipo'],record['valor'],...(record['tipo']==='zernio_conversa'?[record['conexao_id']]:[])));
            await tx.delete(table,record['id']);
          }
          return records.length;
        });
        if(count<100)break;if(batch===999)fail('exclusao_em_andamento');
      }
    }
    await transact(store,async tx=>{await tx.delete('indices_unicos',key('conversa',contact['id']));await tx.delete('contatos',contact['id']);});
  }
  return targets;
}

/** All application mutations, including the effects formerly executed inside the database. */
export async function applyMutation(input:MutationInput):Promise<Row[]>{
  const {store,actor,collection,operation}=input;
  if(!COLLECTIONS.has(collection))fail('colecao_nao_permitida');
  if(collection==='contatos'&&operation==='delete')return deleteContactBatches(store,actor,input.options??{});
  const values=input.values?(Array.isArray(input.values)?input.values:[input.values]):[];
  if(values.length>200)fail('lote_grande_demais');
  return transact(store,async tx=>{
    const member=await authorize(tx,actor,collection,operation,values);
    const targets=['update','delete'].includes(operation)?await bounded(tx,collection,input.options??{},200):values;
    const output:Row[]=[];
    for(const target of targets){
      const before=['update','delete'].includes(operation)?target:target['id']!=null?await tx.get(collection,target['id']):null;
      if(operation==='delete'){
        const fields=uniqueFields(collection,target);if(fields)await tx.delete('indices_unicos',key(collection,...fields.map(f=>target[f]??null)));
        await tx.delete(collection,target['id']);
        output.push(target);continue;
      }
      if(operation==='insert'&&before)fail('registro_duplicado','23505');
      const patch=operation==='update'?(values[0]??{}):target;
      const row=before?{...before,...patch}:await defaults(tx,collection,patch);
      if(before)row['atualizado_em']=iso();
      if(collection==='mensagens'){
        output.push(before?await updateMessage(tx,before,patch):await insertMessage(tx,row,actor));continue;
      }
      if(['membros','convites'].includes(collection)){
        row['email']=String(row['email']??'').trim().toLowerCase();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row['email']))fail('email_invalido');
        if(!['admin','atendente'].includes(row['papel']))fail('papel_invalido');
      }
      if(collection==='configuracao'){
        if(row['voz_resposta']!=null&&!['quando_audio','sempre','nunca'].includes(row['voz_resposta']))fail('modo_voz_invalido');
        if(!(Number(row['espera_lote_s'])>=1&&Number(row['espera_lote_s'])<=60&&Number(row['espera_lote_max_s'])>=Number(row['espera_lote_s'])&&Number(row['espera_lote_max_s'])<=300))fail('ritmo_invalido');
      }
      if(collection==='contatos'){
        for(const field of ['nome','nome_whatsapp','telefone','email','empresa','observacoes'])if(row[field]!=null&&(typeof row[field]!=='string'||row[field].length>(field==='observacoes'?10000:500)))fail('campo_invalido');
        if(row['telefone']!=null)row['telefone']=row['telefone'].replace(/\D/g,'')||null;
        if(!row['etapa_id'])row['etapa_id']=(await tx.list('etapas',{filters:[eq('tipo','aberta'),eq('arquivada',false)],order:[{field:'ordem'}],limit:1}))[0]?.['id']??fail('sem_etapa_de_entrada');
        if(before&&before['etapa_id']!==row['etapa_id'])await moveContact(tx,before,row['etapa_id'],member?.['id']??null);
        else if(!before)await moveContact(tx,{...row,etapa_id:null},row['etapa_id'],member?.['id']??null);
        if(before?.['etapa_id']!==row['etapa_id'])row['etapa_desde']=iso();
      }
      if(collection==='etapas'){
        if(typeof row['nome']!=='string'||!row['nome'].trim())fail('nome_vazio');
        if(row['nome'].length>100||typeof row['janete_pode_mover']!=='boolean'||typeof row['arquivada']!=='boolean')fail('etapa_invalida');
        if(row['arquivada']&&!before?.['arquivada']){
          const used=await tx.list('contatos',{filters:[eq('etapa_id',row['id'])],limit:1});
          if(used.length)fail('etapa_em_uso');
          if(row['tipo']==='aberta'){
            const open=await tx.list('etapas',{filters:[eq('tipo','aberta'),eq('arquivada',false)],limit:2});
            if(open.length<2)fail('ultima_etapa_aberta');
          }
        }
      }
      if(collection==='conexoes'){
        if(row['ativa']){
          const active=await tx.list('conexoes',{filters:[eq('ativa',true)],limit:2});
          if(active.some(c=>c['id']!==row['id']))fail('conexao_ativa_ja_existe');
        }
        if(before?.['ativa']&&!row['ativa'])row['segredos']={};
        if(!before||before['ativa']!==row['ativa']||before['status']!==row['status']){
          const eventId=uid();await tx.set('conexao_eventos',eventId,{id:eventId,conexao_id:row['id'],ativa_de:before?.['ativa']??null,ativa_para:row['ativa'],status_de:before?.['status']??null,status_para:row['status'],ultimo_erro:row['ultimo_erro'],ator_membro_id:member?.['id']??null,criado_em:iso()});
        }
      }
      await unique(tx,collection,row,before);
      await tx.set(collection,row['id'],row);output.push(row);
    }
    return output;
  });
}
