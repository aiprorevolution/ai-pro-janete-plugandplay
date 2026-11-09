import { createHash, randomUUID } from 'node:crypto';
import type { Actor, Filter, ListOptions, Row, Store, StoreTransaction } from './store-types';

export class DomainError extends Error {
  code: string;
  constructor(message: string, code = 'P0001') { super(message); this.name = 'DomainError'; this.code = code; }
}
export const fail = (message: string, code?: string): never => { throw new DomainError(message, code); };
export const iso = () => new Date().toISOString();
export const stamp = (value: unknown): number => typeof value === 'string' ? Date.parse(value) || 0 : 0;
export const later = (seconds: number, base = Date.now()) => new Date(base + seconds * 1000).toISOString();
export const uid = () => randomUUID();
export const key = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const trimmed = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const eq = (field: string, value: unknown): Filter => ({ field, op: 'eq', value });
export const maxBatch = (value: unknown, max = 50) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
export const OBJECT_LIMIT = 10000;

/** Limits are explicit: never return incomplete totals as if they were complete. */
export async function bounded(store: StoreTransaction, collection: string, options: ListOptions = {}, max = OBJECT_LIMIT): Promise<Row[]> {
  const rows:Row[]=[];
  for(let offset=options.offset??0;rows.length<=max;){
    const limit=Math.min(500,max+1-rows.length);
    const page=await store.list(collection,{...options,limit,offset});
    rows.push(...page);offset+=page.length;
    if(page.length<limit)break;
  }
  if (rows.length > max) fail('consulta_muito_ampla');
  return rows;
}

export async function currentMember(store: StoreTransaction, actor: Actor | null): Promise<Row | null> {
  if (!actor || !actor.verified) return null;
  const direct = await store.get('membros', actor.uid);
  if (direct?.['user_id'] === actor.uid && direct['ativo'] === true) return direct;
  return null;
}
export async function requireMember(store: StoreTransaction, actor: Actor | null, admin = false): Promise<Row> {
  const member = await currentMember(store, actor);
  if (!member || (admin && member['papel'] !== 'admin')) fail('sem_acesso', '42501');
  return member!;
}
export function requireSystem(actor: Actor | null) { if (!actor?.system) fail('sem_acesso', '42501'); }
export async function required(store: StoreTransaction, collection: string, id: unknown, error = 'nao_encontrado'): Promise<Row> {
  if (typeof id !== 'string' && typeof id !== 'number') fail(error);
  const doc = await store.get(collection, id as string | number);
  return doc ?? fail(error);
}
export async function sequence(tx: StoreTransaction, name: string): Promise<number> {
  const current = await tx.get('sequencias', name);
  const value = Number(current?.['valor'] ?? 0) + 1;
  await tx.set('sequencias', name, { valor: value });
  return value;
}
export async function event(tx: StoreTransaction, conversationId: string, values: Row) {
  const id = uid();
  await tx.set('conversa_eventos', id, { id, conversa_id: conversationId, membro_id: null, de: null, de_membro_id: null, motivo: null, por_envio: false, criado_em: iso(), ...values });
}
export async function audit(tx: StoreTransaction, memberId: string | null, action: string, target: string | null, detail: Row = {}) {
  const id = uid();
  await tx.set('auditoria', id, { id, ator_membro_id: memberId, acao: action, alvo: target, detalhe: detail, ultimos4: null, criado_em: iso() });
}

/** A read-your-writes view. Remote transactions defer writes until all reads complete. */
export async function transact<T>(store: Store, action: (tx: StoreTransaction) => Promise<T>): Promise<T> {
  return store.runTransaction(async (remote) => {
    const changes = new Map<string, Row | null>();
    const token = (c: string, id: string | number) => `${c}/${String(id)}`;
    const matches = (row: Row, f: Filter): boolean => {
      const v = f.field.split('.').reduce((a: any, b) => a?.[b], row);
      switch (f.op) {
        case 'eq': case 'is': return same(v, f.value);
        case 'neq': return !same(v, f.value);
        case 'gt': return v > f.value; case 'gte': return v >= f.value;
        case 'lt': return v < f.value; case 'lte': return v <= f.value;
        case 'in': return f.value.includes(v); case 'not-in': return !f.value.includes(v);
        case 'array-contains': return Array.isArray(v) && v.includes(f.value);
      }
    };
    const tx: StoreTransaction = {
      async get(c, id) { const k = token(c, id); return changes.has(k) ? changes.get(k)! : remote.get(c, id); },
      async list(c, options = {}) {
        const pending=[...changes].filter(([k])=>k.startsWith(`${c}/`));
        if(!pending.length)return remote.list(c,options);
        // Read a sufficient prefix before applying the overlay. Applying pending rows
        // after an already-offset page would repeat rows and corrupt pagination.
        const offset=options.offset??0,limit=options.limit??1000;
        const needed=offset+limit+pending.length;if(needed>OBJECT_LIMIT)fail('consulta_muito_ampla');
        const base:Row[]=[];
        while(base.length<needed){const take=Math.min(500,needed-base.length);const page=await remote.list(c,{...options,offset:base.length,limit:take});base.push(...page);if(page.length<take)break;}
        const rows = new Map(base.map(r => [String(r['id']), r]));
        for (const [k, r] of pending) {
          const id = k.slice(c.length + 1); rows.delete(id);
          if (r && (options.filters ?? []).every(f => matches(r, f)) && (!options.or || options.or.some(g => g.every(f => matches(r, f))))) rows.set(id, {id,...r});
        }
        const out = [...rows.values()];
        out.sort((a,b) => { for(const o of options.order??[]) { const av=a[o.field], bv=b[o.field]; if(av===bv)continue; return (av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1)*(o.ascending===false?-1:1); } return String(a['id']).localeCompare(String(b['id'])); });
        return out.slice(offset,offset+limit);
      },
      async set(c, id, data, merge = false) {
        const current = merge ? await tx.get(c,id) : null;
        const next = { ...(current ?? {}), ...data };
        changes.set(token(c,id), next);
      },
      async delete(c,id) { changes.set(token(c,id),null); },
    };
    const result=await action(tx);
    if(changes.size>450)fail('transacao_muito_grande');
    for(const [document,row]of changes){const slash=document.indexOf('/');const c=document.slice(0,slash),id=document.slice(slash+1);if(row)await remote.set(c,id,row,false);else await remote.delete(c,id);}
    return result;
  });
}

export async function activeConnection(tx: StoreTransaction): Promise<Row | null> {
  return (await tx.list('conexoes', { filters: [eq('ativa', true)], limit: 1 }))[0] ?? null;
}
export function checkWindow(connection: Row, conversation: Row) {
  if (connection['oficial'] && stamp(conversation['ultima_do_lead_em']) + 86400000 <= Date.now()) fail('janela_fechada');
}
export function conversationDefaults(id: string, contact: string, connection: string): Row {
  const now = iso();
  return { id, contato_id: contact, conexao_id: connection, modo: 'janete', motivo_humano: null, responsavel_id: null, aguardando_humano_desde: null, devolvida_em: null, nao_lidas: 0, ultima_do_lead_em: null, ultima_da_janete_em: null, ultima_mensagem_em: null, ultima_mensagem_id: null, ultima_mensagem_preview: null, responder_apos: null, lote_iniciado_em: null, criado_em: now, atualizado_em: now };
}
export function messageDefaults(values: Row): Row {
  const now = iso();
  return { id: uid(), conversa_id: null, conexao_id: null, direcao: 'saida', origem: 'humano_tela', tipo: 'texto', texto: null, status: 'na_fila', status_em: null, momento: now, criado_em: now, autor_membro_id: null, midia_caminho: null, midia_duracao_s: null, midia_mime: null, midia_nome: null, midia_pega_em: null, midia_ref_externa: null, midia_status: null, midia_tamanho: null, midia_tentativas: 0, tentativas: 0, reenvios: 0, erro: null, evento_id: null, id_externo: null, id_gateway: null, editada: false, apagada_em: null, enviar_apos: null, ordem: null, responde_a_id: null, rodada_id: null, transcricao: null, ...values };
}

export async function cancelAutomation(tx: StoreTransaction, conversationId: string, preserveHandoff = true, causedBy: string | null = null) {
  const queued = await bounded(tx, 'mensagens', { filters: [eq('conversa_id', conversationId), eq('origem', 'janete'), eq('status', 'na_fila')] }, 300);
  const rounds = await bounded(tx, 'rodadas', { filters: [eq('conversa_id', conversationId), eq('status', 'rodando')] }, 10);
  const entries = await bounded(tx, 'mensagens', { filters: [eq('conversa_id', conversationId), eq('direcao','entrada'), {field:'rodada_id',op:'in',value:rounds.length ? rounds.map(r => r['id']) : ['__none__']}] }, 300);
  const now = iso();
  for (const m of queued) await tx.set('mensagens',m['id'],{status:'cancelada',status_em:now,cancelada_por_mensagem_id:causedBy},true);
  for (const r of rounds) if (!preserveHandoff || !r['passou_humano']) {
    await tx.set('rodadas',r['id'],{status:'cancelada',terminada_em:now,cancelada_por_mensagem_id:causedBy},true);
    for (const m of entries) if(m['rodada_id']===r['id']) await tx.set('mensagens',m['id'],{rodada_id:null},true);
  }
}

export async function moveContact(tx: StoreTransaction, contact: Row, stageId: string, memberId: string | null, roundId: string | null = null) {
  if (contact['etapa_id'] === stageId) return;
  const stage = await required(tx,'etapas',stageId,'etapa_nao_encontrada');
  if(stage['arquivada']) fail('etapa_arquivada');
  const now=iso(); const id=uid();
  await tx.set('contatos',contact['id'],{etapa_id:stageId,etapa_desde:now,atualizado_em:now},true);
  await tx.set('contato_etapa_historico',id,{id,contato_id:contact['id'],de_etapa_id:contact['etapa_id']??null,para_etapa_id:stageId,ator:roundId?'janete':memberId?'membro':'sistema',membro_id:memberId,rodada_id:roundId,criado_em:now});
}

export async function insertMessage(tx: StoreTransaction, values: Row, actor: Actor | null): Promise<Row> {
  const m=messageDefaults(values); const now=iso();
  const existing=await tx.get('mensagens',m['id']);
  if(existing) return existing;
  const c=await required(tx,'conversas',m['conversa_id'],'conversa_nao_encontrada');
  if(c['exclusao_em'])fail('contato_em_exclusao');
  if(m['responde_a_id']) {
    const reply=await required(tx,'mensagens',m['responde_a_id'],'citacao_invalida');
    if(reply['conversa_id']!==c['id'])fail('citacao_invalida');
  }
  if(m['origem']==='humano_tela') {
    const member=await requireMember(tx,actor);m['autor_membro_id']=member['id'];
    if(!['texto','audio','imagem','video','documento','figurinha','outro'].includes(m['tipo']))fail('mensagem_invalida');
    if(m['texto']!=null&&(typeof m['texto']!=='string'||m['texto'].length>10000))fail('mensagem_invalida');
    if(m['midia_caminho']&&m['midia_caminho']!==`${c['id']}/${m['id']}`)fail('caminho_midia_invalido');
    if(!trimmed(m['texto'])&&!m['midia_caminho'])fail('mensagem_vazia');
    if(m['midia_tamanho']!=null&&(!Number.isFinite(m['midia_tamanho'])||m['midia_tamanho']<0||m['midia_tamanho']>104857600))fail('midia_grande_demais');
  }
  if(m['direcao']==='saida' && ['na_fila','enviando'].includes(m['status'])) {
    const cx=await activeConnection(tx);if(!cx)fail('sem_conexao_ativa');checkWindow(cx!,c);
    m['conexao_id']=cx!['id'];m['enviar_apos']??=now;
  }
  if(!m['conexao_id']) m['conexao_id']=c['conexao_id'];
  if(m['midia_status']==null) m['midia_status']=m['midia_ref_externa']?'pendente':m['midia_caminho']?'copiada':null;
  const patch:Row={atualizado_em:now};
  if(m['status']!=='cancelada' && stamp(m['momento'])>=stamp(c['ultima_mensagem_em'])) Object.assign(patch,{ultima_mensagem_em:m['momento'],ultima_mensagem_id:m['id'],ultima_mensagem_preview:String(trimmed(m['texto'])??`[${m['tipo']}]`).slice(0,140)});
  if(m['direcao']==='entrada') {
    patch['nao_lidas']=Number(c['nao_lidas']??0)+1;
    patch['ultima_do_lead_em']=stamp(m['momento'])>stamp(c['ultima_do_lead_em'])?m['momento']:c['ultima_do_lead_em'];
    if(c['modo']==='janete') {
      const cfg=await tx.get('configuracao','1');const wait=Number(cfg?.['espera_lote_s']??8);const max=Number(cfg?.['espera_lote_max_s']??60);
      const started=c['responder_apos'] && stamp(c['responder_apos'])>=Date.now()-max*1000 ? stamp(c['lote_iniciado_em'])||Date.now() : Date.now();
      patch['lote_iniciado_em']=new Date(started).toISOString();
      patch['responder_apos']=new Date(Math.max(stamp(c['responder_apos']),Math.min(Date.now()+wait*1000,started+max*1000))).toISOString();
    } else if(!c['responsavel_id'] && !c['aguardando_humano_desde']) patch['aguardando_humano_desde']=now;
  } else if(['humano_tela','humano_celular'].includes(m['origem'])) {
    const from=c['modo']==='janete'?'janete':c['responsavel_id']?'outro':c['aguardando_humano_desde']?'espera':'celular';
    if(m['origem']==='humano_tela' && from!=='outro') await event(tx,c['id'],{tipo:'assumiu',membro_id:m['autor_membro_id'],de:from,por_envio:true});
    if(m['origem']==='humano_celular' && ['janete','espera'].includes(from)) await event(tx,c['id'],{tipo:'celular',de:from,origem_mensagem_id:m['id']});
    await cancelAutomation(tx,c['id'],false,m['id']);
    Object.assign(patch,{modo:'humano',motivo_humano:c['modo']==='janete'?m['origem']:c['motivo_humano'],responsavel_id:c['responsavel_id']??m['autor_membro_id'],aguardando_humano_desde:null,responder_apos:null});
  }
  await tx.set('mensagens',m['id'],m);
  await tx.set('conversas',c['id'],patch,true);
  return m;
}

export async function updateMessage(tx: StoreTransaction, before: Row, patch: Row): Promise<Row> {
  const after={...before,...patch};
  const c=await tx.get('conversas',after['conversa_id']);
  if(c) {
    const cp:Row={atualizado_em:iso()};
    if(after['origem']==='janete' && ['enviada','entregue','lida'].includes(after['status']) && stamp(after['momento'])>stamp(c['ultima_da_janete_em'])) cp['ultima_da_janete_em']=after['momento'];
    if(c['ultima_mensagem_id']===after['id']) {
      if(after['status']==='cancelada' || after['apagada_em']) {
        const latest=(await tx.list('mensagens',{filters:[eq('conversa_id',c['id'])],order:[{field:'momento',ascending:false}],limit:100})).find(m=>m['id']!==after['id']&&m['status']!=='cancelada'&&!m['apagada_em']);
        cp['ultima_mensagem_id']=latest?.['id']??null;cp['ultima_mensagem_preview']=latest?String(trimmed(latest['texto'])??`[${latest['tipo']}]`).slice(0,140):null;
        if(latest)cp['ultima_mensagem_em']=latest['momento'];
      } else if(patch['texto']!==undefined) cp['ultima_mensagem_preview']=String(trimmed(after['texto'])??`[${after['tipo']}]`).slice(0,140);
    }
    if(after['status']==='falhou' && before['status']!=='falhou' && after['direcao']==='saida' && after['origem']==='janete' && c['modo']==='janete') {
      await cancelAutomation(tx,c['id']);
      Object.assign(cp,{modo:'humano',motivo_humano:'envio_falhou',aguardando_humano_desde:iso(),responder_apos:null});
      if(after['rodada_id'])await tx.set('rodadas',after['rodada_id'],{foi_para_equipe:true},true);
      await event(tx,c['id'],{tipo:'passou',motivo:'envio_falhou'});
    }
    await tx.set('conversas',c['id'],cp,true);
  }
  await tx.set('mensagens',after['id'],after);
  return after;
}
