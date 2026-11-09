import type { Actor, Row, Store, StoreTransaction } from './store-types';
import { activeConnection,audit,bounded,cancelAutomation,checkWindow,conversationDefaults,eq,event,fail,insertMessage,iso,key,later,moveContact,normalize,required,requireMember,same,sequence,stamp,transact,trimmed,uid,updateMessage } from './rpc-common';

export function normalizedIds(value:unknown):Row[]{
  const out=new Map<string,Row>();
  for(const entry of Array.isArray(value)?value:[]){
    if(!entry||!['telefone','bsuid','lid','zernio_conversa'].includes(entry.tipo))continue;
    const v=entry.tipo==='telefone'?String(entry.valor??'').replace(/\D/g,''):trimmed(entry.valor);
    if(v)out.set(`${entry.tipo}:${v}`,{tipo:entry.tipo,valor:v});
  }
  return [...out.values()];
}

export async function resolveContact(tx:StoreTransaction,connectionId:string,idsValue:unknown,name:unknown):Promise<Row>{
  const ids=normalizedIds(idsValue);if(!ids.length)fail('sem_identificador');
  const lookups=await Promise.all(ids.map(async i=>({i,k:key('contato_identificadores',i['tipo'],i['valor'],...(i['tipo']==='zernio_conversa'?[connectionId]:[]))})));
  const found:string[]=[];
  for(const {k} of lookups){const index=await tx.get('indices_unicos',k);if(index){const ident=await tx.get('contato_identificadores',index['registro_id']);if(ident)found.push(ident['contato_id']);}}
  let contact:Row|null=null;
  if(found.length)contact=await tx.get('contatos',found[0]!);
  if(new Set(found).size>1)fail('identificadores_conflitantes');
  const phone=ids.find(i=>i['tipo']==='telefone')?.['valor']??null;
  // Covers contacts previously entered manually, without an identifier record.
  if(!contact&&phone)contact=(await tx.list('contatos',{filters:[eq('telefone',phone)],limit:1}))[0]??null;
  if(contact?.['exclusao_em'])fail('contato_em_exclusao');
  if(!contact){
    const stage=(await tx.list('etapas',{filters:[eq('tipo','aberta'),eq('arquivada',false)],order:[{field:'ordem'}],limit:1}))[0];
    if(!stage)fail('sem_etapa_de_entrada');
    const now=iso();contact={id:uid(),nome:null,nome_whatsapp:trimmed(name),telefone:phone,email:null,empresa:null,etapa_id:stage!['id'],etapa_desde:now,observacoes:null,resumo_janete:null,resumo_janete_em:null,anotacoes_janete:{},primeira_mensagem_em:null,criado_em:now,atualizado_em:now};
    await tx.set('contatos',contact['id'],contact);
    const history=uid();await tx.set('contato_etapa_historico',history,{id:history,contato_id:contact['id'],de_etapa_id:null,para_etapa_id:contact['etapa_id'],ator:'sistema',membro_id:null,rodada_id:null,criado_em:now});
  }else{
    contact={...contact,nome_whatsapp:trimmed(name)??contact['nome_whatsapp'],telefone:contact['telefone']??phone,atualizado_em:iso()};await tx.set('contatos',contact['id'],contact);
  }
  for(const {i,k} of lookups){const index=await tx.get('indices_unicos',k);const id=index?.['registro_id']??uid();await tx.set('contato_identificadores',id,{id,contato_id:contact['id'],tipo:i['tipo'],valor:i['valor'],conexao_id:connectionId,criado_em:iso()});await tx.set('indices_unicos',k,{id:k,colecao:'contato_identificadores',registro_id:id});}
  return contact;
}

export async function resolveConversation(tx:StoreTransaction,contactId:string,connectionId:string):Promise<Row>{
  const k=key('conversa',contactId);const index=await tx.get('indices_unicos',k);
  let conversation=index?await tx.get('conversas',index['registro_id']):null;
  if(!conversation)conversation=(await tx.list('conversas',{filters:[eq('contato_id',contactId)],limit:1}))[0]??null;
  if(!conversation)conversation=conversationDefaults(uid(),contactId,connectionId);
  conversation={...conversation,conexao_id:connectionId};await tx.set('conversas',conversation['id'],conversation);
  await tx.set('indices_unicos',k,{id:k,colecao:'conversas',registro_id:conversation['id']});return conversation;
}

export async function registerIncoming(tx:StoreTransaction,args:Row,outgoing=false):Promise<any>{
  const input=args['p_msg'];if(!input||!trimmed(input.id_externo)||!trimmed(input.tipo)||!stamp(input.momento))fail('mensagem_invalida');
  const connection=await required(tx,'conexoes',args['p_conexao'],'conexao_nao_encontrada');
  const dedup=key('mensagem',connection['id'],input.id_externo);const index=await tx.get('indices_unicos',dedup);
  const old=index?await tx.get('mensagens',index['registro_id']):null;
  if(old){
    if(input.editada||input.apagada)await updateMessage(tx,old,{...(input.editada?{texto:input.texto??null,editada:true}:{}),...(input.apagada?{apagada_em:old['apagada_em']??iso()}: {})});
    return outgoing?old['id']:[{mensagem_id:old['id'],conversa_id:old['conversa_id'],nova:false}];
  }
  if(input.apagada)return outgoing?null:[{mensagem_id:null,conversa_id:null,nova:false}];
  const contact=await resolveContact(tx,connection['id'],args['p_ids'],args['p_nome_whatsapp']);
  const conversation=await resolveConversation(tx,contact['id'],connection['id']);
  if(outgoing){
    const recent=await tx.list('mensagens',{filters:[eq('conversa_id',conversation['id']),eq('direcao','saida'),{field:'criado_em',op:'gte',value:later(-120)}],order:[{field:'criado_em'}],limit:100});
    const echo=recent.find(m=>(input.id_gateway&&m['id_gateway']===input.id_gateway)||(!m['id_externo']&&['janete','humano_tela'].includes(m['origem'])&&['enviando','enviada','falhou'].includes(m['status'])&&normalize(m['texto'])===normalize(input.texto)&&(trimmed(input.texto)||m['tipo']===input.tipo)));
    if(echo){await updateMessage(tx,echo,{id_externo:input.id_externo,id_gateway:input.id_gateway??echo['id_gateway'],status:['entregue','lida'].includes(echo['status'])?echo['status']:'enviada',status_em:iso(),erro:null});await tx.set('indices_unicos',dedup,{id:dedup,colecao:'mensagens',registro_id:echo['id']});return echo['id'];}
  }
  let replyId=null;
  if(input.responde_a_id_externo){const r=await tx.get('indices_unicos',key('mensagem',connection['id'],input.responde_a_id_externo));replyId=r?.['registro_id']??null;}
  const types=['texto','audio','imagem','video','documento','figurinha','outro'];
  const m=await insertMessage(tx,{conversa_id:conversation['id'],conexao_id:connection['id'],direcao:outgoing?'saida':'entrada',origem:outgoing?'humano_celular':'lead',tipo:types.includes(input.tipo)?input.tipo:'outro',texto:input.texto??null,status:outgoing?'enviada':'recebida',status_em:outgoing?input.momento:null,momento:input.momento,id_externo:input.id_externo,id_gateway:input.id_gateway??null,midia_ref_externa:input.midia_ref_externa??null,midia_mime:input.midia_mime??null,midia_nome:input.midia_nome??null,midia_tamanho:input.midia_tamanho??null,evento_id:input.evento_id??null,editada:!!input.editada,responde_a_id:replyId},null);
  await tx.set('indices_unicos',dedup,{id:dedup,colecao:'mensagens',registro_id:m['id']});
  if(!outgoing&&(!contact['primeira_mensagem_em']||stamp(input.momento)<stamp(contact['primeira_mensagem_em'])))await tx.set('contatos',contact['id'],{primeira_mensagem_em:input.momento},true);
  return outgoing?m['id']:[{mensagem_id:m['id'],conversa_id:conversation['id'],nova:true}];
}

const CONTEXT_FIELDS=['empresa_oferta','cliente_ideal','preco','diferenciais','objecoes','quando_passar_humano','tom_voz','horario'];
export async function saveContext(tx:StoreTransaction,args:Row,member:Row,restore=false):Promise<Row>{
  const config=await required(tx,'configuracao',1);
  const current=config['contexto_atual_id']?await tx.get('contexto_versoes',config['contexto_atual_id']):(await tx.list('contexto_versoes',{order:[{field:'numero',ascending:false}],limit:1}))[0]??null;
  const changes:Row=restore?await required(tx,'contexto_versoes',args['p_versao']):args['p_mudancas'];
  if(!changes||Array.isArray(changes)||typeof changes!=='object')fail('mudancas_invalidas');
  const base=restore?current:args['p_base']==null?null:await required(tx,'contexto_versoes',args['p_base']);
  if(!restore&&!base&&current)fail('contexto_mudou');
  const next:Row=Object.fromEntries(CONTEXT_FIELDS.map(k=>[k,current?.[k]??'']));next['itens']=current?.['itens']??[];
  const source=restore?Object.fromEntries([...CONTEXT_FIELDS,'itens'].map(k=>[k,changes[k]])):changes;
  for(const [field,value]of Object.entries(source)){
    if(field==='itens'){
      if(!Array.isArray(value))fail('mudancas_invalidas');if(value.length>50)fail('limite_itens');
      if(value.some((v:any)=>!v||typeof v.pergunta!=='string'||typeof v.resposta!=='string'))fail('mudancas_invalidas');
      if(value.some((v:any)=>v.pergunta.length>2000||v.resposta.length>2000))fail('limite_tamanho');
    }else if(!CONTEXT_FIELDS.includes(field)||typeof value!=='string')fail('mudancas_invalidas');
    else if(value.length>2000)fail('limite_tamanho');
    if(!restore&&base&&same(base[field],value))continue;
    if(!restore&&base&&!same(base[field],current?.[field]))fail('contexto_mudou');
    next[field]=value;
  }
  if(current&&[...CONTEXT_FIELDS,'itens'].every(k=>same(next[k],current[k])))return{id:current['id'],numero:current['numero']};
  const id=await sequence(tx,'contexto_versoes');const number=Number(current?.['numero']??0)+1;
  await tx.set('contexto_versoes',id,{...next,id,numero:number,origem:restore?'restauracao':args['p_origem']==='onboarding'?'onboarding':'edicao',criado_por:member['id'],criado_em:iso(),restaurada_de:restore?args['p_versao']:null});
  await tx.set('configuracao',1,{contexto_atual_id:id,atualizado_em:iso()},true);
  return{id,numero:number};
}

export async function memberAction(tx:StoreTransaction,name:string,args:Row,actor:Actor|null):Promise<any>{
  const admin=await requireMember(tx,actor,true);const target=await required(tx,'membros',args['p_membro']);
  if(target['id']===admin['id'])fail('proprio_membro');
  const admins=await tx.list('membros',{filters:[eq('ativo',true),eq('papel','admin')],limit:2});
  if(target['ativo']&&target['papel']==='admin'&&admins.length<2&&name!=='reativar_membro'&&args['p_papel']!=='admin')fail('ultimo_admin');
  if(name==='trocar_papel_membro'){
    if(!['admin','atendente'].includes(args['p_papel']))fail('papel_invalido');
    await tx.set('membros',target['id'],{papel:args['p_papel']},true);await audit(tx,admin['id'],'membro_papel_trocado',target['id'],{papel:args['p_papel']});return null;
  }
  const active=name==='reativar_membro';const conversations=active?[]:await bounded(tx,'conversas',{filters:[eq('responsavel_id',target['id'])]},150);
  await tx.set('membros',target['id'],{ativo:active},true);
  for(const c of conversations){await tx.set('conversas',c['id'],{responsavel_id:null,modo:'humano',aguardando_humano_desde:iso()},true);await event(tx,c['id'],{tipo:'voltou_para_fila',de_membro_id:target['id'],membro_id:admin['id']});}
  await audit(tx,admin['id'],active?'membro_reativado':'membro_desativado',target['id']);return active?null:conversations.map(c=>c['id']);
}

export async function conversationAction(tx:StoreTransaction,name:string,args:Row,actor:Actor|null):Promise<any>{
  const member=await requireMember(tx,actor);const c=await required(tx,'conversas',args['p_conversa'],'conversa_nao_encontrada');
  const now=iso();
  if(name==='marcar_lida'){await tx.set('conversas',c['id'],{nao_lidas:0,atualizado_em:now},true);return null;}
  if(name==='assumir_conversa'){
    await cancelAutomation(tx,c['id']);
    await tx.set('conversas',c['id'],{modo:'humano',responsavel_id:member['id'],aguardando_humano_desde:null,motivo_humano:c['modo']==='janete'?'humano_tela':c['motivo_humano'],responder_apos:null,atualizado_em:now},true);
    if(c['modo']==='janete'||c['responsavel_id']!==member['id'])await event(tx,c['id'],{tipo:'assumiu',membro_id:member['id'],de:c['modo']==='janete'?'janete':c['responsavel_id']?'outro':c['aguardando_humano_desde']?'espera':'celular',de_membro_id:c['responsavel_id']});
    return null;
  }
  const entries=await tx.list('mensagens',{filters:[eq('conversa_id',c['id']),eq('direcao','entrada')],order:[{field:'criado_em',ascending:false}],limit:1});
  const outputs=await tx.list('mensagens',{filters:[eq('conversa_id',c['id']),eq('direcao','saida')],order:[{field:'criado_em',ascending:false}],limit:30});
  const lastOutput=outputs.find(m=>!['falhou','cancelada'].includes(m['status']));const cx=await activeConnection(tx);
  const windowOpen=!cx?.['oficial']||stamp(c['ultima_do_lead_em'])+86400000>Date.now();
  const due=entries[0]&&stamp(entries[0]['criado_em'])>stamp(lastOutput?.['criado_em'])&&windowOpen?now:null;
  await tx.set('conversas',c['id'],{modo:'janete',motivo_humano:null,responsavel_id:null,aguardando_humano_desde:null,devolvida_em:now,responder_apos:due,lote_iniciado_em:due,atualizado_em:now},true);
  if(c['modo']==='humano')await event(tx,c['id'],{tipo:'devolveu',membro_id:member['id']});return null;
}

export async function aiTool(tx:StoreTransaction,name:string,args:Row):Promise<null>{
  const round=await required(tx,'rodadas',args['p_rodada'],'rodada_nao_rodando');if(round['status']!=='rodando')fail('rodada_nao_rodando');
  const c=await required(tx,'conversas',round['conversa_id']);if(c['modo']!=='janete'&&!round['passou_humano'])fail('rodada_nao_rodando');
  const contact=await required(tx,'contatos',c['contato_id']);
  if(name==='janete_passar_para_humano'){
    await tx.set('rodadas',round['id'],{passou_humano:true,foi_para_equipe:true},true);
    if(c['modo']==='janete'){await tx.set('conversas',c['id'],{modo:'humano',motivo_humano:'janete_passou',aguardando_humano_desde:iso(),responder_apos:null},true);await event(tx,c['id'],{tipo:'passou',motivo:'janete_passou'});}return null;
  }
  if(name==='janete_mover_etapa'){
    const target=await required(tx,'etapas',args['p_etapa'],'etapa_nao_permitida');if(!target['janete_pode_mover']||target['arquivada'])fail('etapa_nao_permitida');
    if(contact['etapa_id']===target['id'])return null;
    const current=await required(tx,'etapas',contact['etapa_id']);const last=(await tx.list('contato_etapa_historico',{filters:[eq('contato_id',contact['id'])],order:[{field:'criado_em',ascending:false}],limit:1}))[0];
    if(['ganho','perdido'].includes(current['tipo'])||(last?.['ator']==='membro'&&stamp(c['devolvida_em'])<=stamp(last['criado_em'])))fail('etapa_travada');
    await moveContact(tx,contact,target['id'],null,round['id']);return null;
  }
  const fields=args['p_campos'];if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(k=>!['nome','email','empresa','resumo_janete','fatos','proximo_passo'].includes(k)))fail('campo_nao_permitido');
  const patch:Row={atualizado_em:iso()};
  for(const k of ['nome','email','empresa'])if(!trimmed(contact[k])&&trimmed(fields[k]))patch[k]=fields[k];
  if('resumo_janete'in fields){patch['resumo_janete']=String(fields.resumo_janete??'').slice(0,4000);patch['resumo_janete_em']=iso();}
  const notes={...contact['anotacoes_janete']};
  if('fatos'in fields){if(!Array.isArray(fields.fatos)||fields.fatos.length>20||fields.fatos.some((f:Row)=>typeof f['rotulo']!=='string'||typeof f['valor']!=='string'))fail('campo_nao_permitido');notes['fatos']=fields.fatos;}
  if('proximo_passo'in fields){const p=fields.proximo_passo;if(p!==null&&(typeof p!=='object'||typeof p.titulo!=='string'||typeof p.texto!=='string'))fail('campo_nao_permitido');notes['proximo_passo']=p;}
  patch['anotacoes_janete']=notes;await tx.set('contatos',contact['id'],patch,true);return null;
}
