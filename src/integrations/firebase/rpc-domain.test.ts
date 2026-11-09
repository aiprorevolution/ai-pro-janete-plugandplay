// @vitest-environment node
import { describe,it,expect,beforeEach,afterEach,vi } from 'vitest';
import type { Actor,Row } from './store-types';
import { dispatchRpc } from './rpc.server';
import { applyMutation } from './rpc-mutations';
import { bounded,transact } from './rpc-common';
import { MemoryStore } from './rpc-test-store';

const admin:Actor={uid:'admin-uid',email:'admin@example.test',verified:true};
const operator:Actor={uid:'operator-uid',email:'operator@example.test',verified:true};
const system:Actor={uid:'system',verified:true,system:true};
const now='2026-11-09T12:00:00.000Z';
let store:MemoryStore;
const call=(name:string,args:Row={},actor:Actor|null=admin)=>dispatchRpc(name,args,{store,actor});
const incoming=(id='message-1',text='Olá')=>({p_conexao:'connection',p_ids:[{tipo:'telefone',valor:'5511999991234'}],p_nome_whatsapp:'Clínica teste',p_msg:{id_externo:id,tipo:'texto',texto:text,momento:now}});

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(now));
  store=new MemoryStore({membros:[{id:admin.uid,user_id:admin.uid,email:admin.email,papel:'admin',ativo:true,vistos:{}},{id:operator.uid,user_id:operator.uid,email:operator.email,papel:'atendente',ativo:true,vistos:{}}],configuracao:[{id:1,espera_lote_s:8,espera_lote_max_s:60,onboarding_concluido_em:now,voz_resposta:'quando_audio'}],etapas:[{id:'new',chave:'novo',nome:'Novo',tipo:'aberta',ordem:0,janete_pode_mover:true,arquivada:false},{id:'qualified',chave:'qualificado',nome:'Qualificado',tipo:'aberta',ordem:1,janete_pode_mover:true,arquivada:false},{id:'won',nome:'Ganho',tipo:'ganho',ordem:2,janete_pode_mover:false,arquivada:false}],conexoes:[{id:'connection',ativa:true,status:'conectada',oficial:false,gateway:'evolution'}],ia_chaves:[{id:'response-key',finalidade:'resposta',provedor:'openai',modelo:'test-model',status:'ativa'}]});
});
afterEach(()=>vi.useRealTimers());

describe('Firestore domain permissions',()=>{
  it('rejects unauthenticated, unverified and operator administrative calls',async()=>{
    await expect(call('contexto_salvar',{p_base:null,p_mudancas:{empresa_oferta:'Teste'}},null)).rejects.toMatchObject({code:'42501'});
    await expect(call('contexto_salvar',{p_base:null,p_mudancas:{empresa_oferta:'Teste'}},operator)).rejects.toMatchObject({code:'42501'});
    await expect(call('eh_membro',{}, {...admin,verified:false})).resolves.toBe(false);
    await expect(call('pegar_rodadas',{p_limite:1},admin)).rejects.toMatchObject({code:'42501'});
  });
  it('does not trust role passed in actor and refuses unknown operations',async()=>{
    await expect(call('contexto_salvar',{p_base:null,p_mudancas:{}},{...operator,role:'admin'})).rejects.toMatchObject({code:'42501'});
    await expect(call('unknown_operation')).rejects.toMatchObject({code:'42883'});
  });
  it('prevents raw privilege writes and contact arbitrary fields',async()=>{
    await expect(applyMutation({store,actor:operator,collection:'membros',operation:'update',values:{papel:'admin'},options:{filters:[{field:'id',op:'eq',value:operator.uid}]}})).rejects.toMatchObject({code:'42501'});
    await expect(applyMutation({store,actor:admin,collection:'contatos',operation:'update',values:{id:'replacement'}})).rejects.toThrow('campo_nao_permitido');
  });
});

describe('Inbound identity and delivery semantics',()=>{
  it('deduplicates concurrent deliveries and counts unread once',async()=>{
    const result=await Promise.all([call('registrar_entrada',incoming(),system),call('registrar_entrada',incoming(),system),call('registrar_entrada',incoming(),system)]);
    expect(result.filter(r=>r[0].nova)).toHaveLength(1);
    expect(await store.list('contatos')).toHaveLength(1);expect(await store.list('mensagens')).toHaveLength(1);
    const c=(await store.list('conversas'))[0]!;expect(c['nao_lidas']).toBe(1);expect(c['responder_apos']).toBe('2026-11-09T12:00:08.000Z');
  });
  it('deduplicates webhook IDs per connection, preserving retry ID',async()=>{
    const a={p_gateway:'evolution',p_conexao:'connection',p_id_evento:'event-1',p_tipo:'message',p_payload:{data:'test'}};
    const first=await call('registrar_evento_webhook',a,system),second=await call('registrar_evento_webhook',a,system),other=await call('registrar_evento_webhook',{...a,p_conexao:'another'},system);
    expect(first.duplicado).toBe(false);expect(second).toEqual({duplicado:true,id:first.id});expect(other.id).not.toBe(first.id);
  });
  it('ignores deletion of never received message and applies edit without duplicate',async()=>{
    const input=incoming();await call('registrar_entrada',{...input,p_msg:{...input.p_msg,apagada:true}},system);expect(await store.list('contatos')).toHaveLength(0);
    const first=await call('registrar_entrada',input,system);await call('registrar_entrada',{...input,p_msg:{...input.p_msg,editada:true,texto:'Corrigida'}},system);
    expect((await store.get('mensagens',first[0].mensagem_id))!['texto']).toBe('Corrigida');expect((await store.list('conversas'))[0]!['nao_lidas']).toBe(1);
  });
  it('resolves a phone already manually present rather than duplicating',async()=>{
    await store.set('contatos','existing',{id:'existing',telefone:'5511999991234',nome:'Minha clínica',etapa_id:'new'});
    await call('registrar_entrada',incoming(),system);expect(await store.list('contatos')).toHaveLength(1);expect((await store.list('conversas'))[0]!['contato_id']).toBe('existing');
  });
});

describe('Context and human control',()=>{
  it('merges different edits but detects conflicting concurrent fields',async()=>{
    const v1=await call('contexto_salvar',{p_base:null,p_mudancas:{empresa_oferta:'Inicial',preco:'10'}});
    const v2=await call('contexto_salvar',{p_base:v1.id,p_mudancas:{empresa_oferta:'Atualizada'}});
    const v3=await call('contexto_salvar',{p_base:v1.id,p_mudancas:{preco:'20'}});
    expect((await store.get('contexto_versoes',v3.id))!['empresa_oferta']).toBe('Atualizada');
    await expect(call('contexto_salvar',{p_base:v1.id,p_mudancas:{empresa_oferta:'Conflitante'}})).rejects.toThrow('contexto_mudou');
    const restored=await call('contexto_restaurar',{p_versao:v1.id});expect((await store.get('contexto_versoes',restored.id))!['preco']).toBe('10');expect(restored.numero).toBe(v3.numero+1);
    expect(v2.numero).toBe(2);
  });
  it('takes over, cancels running AI and returns only pending entry to AI',async()=>{
    const receipt=await call('registrar_entrada',incoming(),system);const id=receipt[0].conversa_id;
    vi.advanceTimersByTime(10000);const rounds=await call('pegar_rodadas',{p_limite:2},system);expect(rounds).toHaveLength(1);
    await call('assumir_conversa',{p_conversa:id},operator);
    expect((await store.get('rodadas',rounds[0].id))!['status']).toBe('cancelada');
    expect((await store.get('conversas',id))!['responder_apos']).toBeNull();
    await call('registrar_entrada',incoming('message-2'),system);expect((await store.get('conversas',id))!['responder_apos']).toBeNull();
    await call('devolver_para_janete',{p_conversa:id},operator);expect((await store.get('conversas',id))!['responder_apos']).not.toBeNull();
  });
  it('blocks AI stage movement after human changes the stage',async()=>{
    const first=await call('registrar_entrada',incoming(),system);vi.advanceTimersByTime(10000);const [round]=await call('pegar_rodadas',{p_limite:1},system);
    const c=await store.get('conversas',first[0].conversa_id);
    await applyMutation({store,actor:operator,collection:'contatos',operation:'update',values:{etapa_id:'qualified'},options:{filters:[{field:'id',op:'eq',value:c!['contato_id']}]}});
    await expect(call('janete_mover_etapa',{p_rodada:round.id,p_etapa:'new'},system)).rejects.toThrow('etapa_travada');
    expect(await store.list('contato_etapa_historico')).toHaveLength(2);
  });
  it('deactivation releases conversations and prevents future takeover',async()=>{
    const r=await call('registrar_entrada',incoming(),system);await call('assumir_conversa',{p_conversa:r[0].conversa_id},operator);
    const released=await call('desativar_membro',{p_membro:operator.uid});expect(released).toEqual([r[0].conversa_id]);
    await expect(call('assumir_conversa',{p_conversa:r[0].conversa_id},operator)).rejects.toMatchObject({code:'42501'});
    expect((await store.get('conversas',r[0].conversa_id))!['aguardando_humano_desde']).not.toBeNull();
  });
});

describe('Durable queues and uncertain delivery',()=>{
  it('reserves a conversation once and completes a round idempotently',async()=>{
    await call('registrar_entrada',incoming(),system);vi.advanceTimersByTime(9000);
    const result=await Promise.all([call('pegar_rodadas',{p_limite:2},system),call('pegar_rodadas',{p_limite:2},system)]);expect(result.flat()).toHaveLength(1);
    const round=result.flat()[0];const args={p_rodada:round.id,p_respostas:[{texto:'Olá'},{texto:'Posso ajudar?'}],p_passos:1,p_ferramentas:[]};
    await call('concluir_rodada',args,system);await call('concluir_rodada',args,system);
    expect((await store.list('mensagens')).filter(m=>m['direcao']==='saida')).toHaveLength(2);
    const send=await call('pegar_envios',{p_limite:10},system);expect(send).toHaveLength(1);
    await call('concluir_envio',{p_msg:send[0].id,p_id_externo:'sent-1',p_id_gateway:''},system);vi.advanceTimersByTime(2000);
    expect(await call('pegar_envios',{p_limite:10},system)).toHaveLength(1);
  });
  it('expired unknown send is not automatically resent',async()=>{
    const r=await call('registrar_entrada',incoming(),system);
    await applyMutation({store,actor:operator,collection:'mensagens',operation:'insert',values:{id:'human-msg',conversa_id:r[0].conversa_id,direcao:'saida',origem:'humano_tela',tipo:'texto',texto:'Teste',status:'na_fila'}});
    expect(await call('pegar_envios',{p_limite:1},system)).toHaveLength(1);vi.advanceTimersByTime(121000);
    expect(await call('pegar_envios',{p_limite:1},system)).toHaveLength(0);
    expect((await store.get('mensagens','human-msg'))!['erro']).toBe('sem_resposta_do_envio');
    await expect(call('reenviar_mensagem',{p_msg:'human-msg'},operator)).rejects.toThrow('nao_reenviavel');
    await call('concluir_envio',{p_msg:'human-msg',p_id_externo:'confirmed',p_id_gateway:''},system);expect((await store.get('mensagens','human-msg'))!['status']).toBe('enviada');
  });
  it('transient round failure schedules retry and stops after three attempts',async()=>{
    await call('registrar_entrada',incoming(),system);vi.advanceTimersByTime(9000);
    for(let n=1;n<=3;n++){
      const [r]=await call('pegar_rodadas',{p_limite:1},system);expect(r.tentativa).toBe(n);
      await call('falhar_rodada',{p_rodada:r.id,p_motivo:'erro_provedor',p_passageiro:true},system);vi.advanceTimersByTime(31000);
    }
    expect((await store.list('conversas'))[0]!['modo']).toBe('humano');expect(await call('pegar_rodadas',{p_limite:1},system)).toHaveLength(0);
  });
  it('status receipts never regress delivered state',async()=>{
    const r=await call('registrar_entrada',incoming(),system);
    await applyMutation({store,actor:operator,collection:'mensagens',operation:'insert',values:{id:'h',conversa_id:r[0].conversa_id,direcao:'saida',origem:'humano_tela',tipo:'texto',texto:'Oi',status:'na_fila'}});
    await call('concluir_envio',{p_msg:'h',p_id_externo:'ext',p_id_gateway:''},system);
    await call('atualizar_status',{p_conexao:'connection',p_id:'ext',p_status:'lida',p_momento:now},system);
    await call('atualizar_status',{p_conexao:'connection',p_id:'ext',p_status:'entregue',p_momento:now},system);
    expect((await store.get('mensagens','h'))!['status']).toBe('lida');
  });
  it('does not keep scheduling a blocked conversation without onboarding or a connection',async()=>{
    await call('registrar_entrada',incoming(),system);vi.advanceTimersByTime(10000);
    await store.set('conexoes','connection',{ativa:false},true);
    expect(await call('motor_pendencias')).toEqual([{proximo_em:null,vencido_desde:null,atrasado_desde:null}]);
    await store.set('conexoes','connection',{ativa:true},true);await store.set('configuracao',1,{onboarding_concluido_em:null},true);
    expect(await call('motor_pendencias')).toEqual([{proximo_em:null,vencido_desde:null,atrasado_desde:null}]);
  });
  it('pending jobs preserve their future lease deadline',async()=>{
    await call('registrar_entrada',incoming(),system);vi.advanceTimersByTime(10000);
    await call('pegar_rodadas',{p_limite:1},system);
    const [work]=await call('motor_pendencias');expect(work.proximo_em).toBe('2026-11-09T12:05:10.000Z');expect(work.vencido_desde).toBeNull();
  });
});

describe('Reads, totals and transactional rollback',()=>{
  it('contact list and dashboard use real records and role filters',async()=>{
    const r=await call('registrar_entrada',incoming(),system);
    expect((await call('contatos_lista',{p_busca:'clinica',p_recorte:'todos',p_ordem:'contato',p_direcao:'asc',p_limite:50})).total).toBe(1);
    expect((await call('contatos_contadores')).com_janete).toBe(1);
    await call('assumir_conversa',{p_conversa:r[0].conversa_id},operator);
    expect((await call('contatos_contadores',{},operator)).comigo).toBe(1);
    const dashboard=await call('dashboard_agora');expect(dashboard.naoLidas.mensagens).toBe(1);expect(dashboard.comQuem.janete).toBe(0);
  });
  it('bounded pagination crosses the 1000-document transport cap',async()=>{
    for(let n=0;n<1200;n++)await store.set('test',String(n).padStart(4,'0'),{id:String(n).padStart(4,'0')});
    expect(await bounded(store,'test',{order:[{field:'id'}]},1500)).toHaveLength(1200);
    await expect(bounded(store,'test',{order:[{field:'id'}]},1000)).rejects.toThrow('consulta_muito_ampla');
  });
  it('an invalid context does not leave a sequence or partial version',async()=>{
    await expect(call('contexto_salvar',{p_base:null,p_mudancas:{empresa_oferta:'x'.repeat(2001)}})).rejects.toThrow('limite_tamanho');
    expect(await store.list('contexto_versoes')).toHaveLength(0);expect(await store.get('sequencias','contexto_versoes')).toBeNull();
  });
  it('deletes a long conversation in batches while keeping anonymous billing totals',async()=>{
    const [r]=await call('registrar_entrada',incoming(),system);const c=await store.get('conversas',r.conversa_id);
    for(let n=0;n<550;n++)await store.set('mensagens',`old-${n}`,{id:`old-${n}`,conversa_id:r.conversa_id,direcao:'entrada',origem:'lead'});
    await store.set('ia_chamadas',1,{id:1,conversa_id:r.conversa_id,rodada_id:'round',custo_usd:1});
    await applyMutation({store,actor:admin,collection:'contatos',operation:'delete',options:{filters:[{field:'id',op:'eq',value:c!['contato_id']}]}});
    expect(await store.list('mensagens')).toHaveLength(0);expect(await store.list('contatos')).toHaveLength(0);expect(await store.list('conversas')).toHaveLength(0);
    expect(await store.get('ia_chamadas',1)).toMatchObject({conversa_id:null,rodada_id:null,custo_usd:1});
  });
});


describe('Historical reporting and echo reconciliation',()=>{
  it('attributes messages and response cost only to the stage occupied at their timestamp',async()=>{
    const contact={id:'cohort',primeira_mensagem_em:'2026-11-09T09:00:00.000Z',etapa_id:'qualified'};
    await store.set('contatos',contact.id,contact);await store.set('conversas','cv',{id:'cv',contato_id:contact.id});
    await store.set('contato_etapa_historico','h0',{id:'h0',contato_id:contact.id,de_etapa_id:null,para_etapa_id:'new',ator:'sistema',criado_em:'2026-11-09T09:00:00.000Z'});
    await store.set('contato_etapa_historico','h1',{id:'h1',contato_id:contact.id,de_etapa_id:'new',para_etapa_id:'qualified',ator:'janete',criado_em:'2026-11-09T10:00:00.000Z'});
    for(const [id,time,direction,cost]of [['one','09:30','entrada',1],['two','10:30','saida',2]] as const){const t=`2026-11-09T${time}:00.000Z`;await store.set('mensagens',id,{id,conversa_id:'cv',direcao:direction,origem:direction==='entrada'?'lead':'janete',status:direction==='entrada'?'recebida':'enviada',momento:t,criado_em:t});await store.set('ia_chamadas',id,{id,conversa_id:'cv',tipo:'resposta',criado_em:t,custo_usd:cost});}
    await store.set('ia_chamadas','onboard',{id:'onboard',tipo:'onboarding',criado_em:now,custo_usd:4});
    const args={p_de:'2026-11-09T03:00:00.000Z',p_ate:'2026-11-10T03:00:00.000Z',p_estado_em:now};const funnel=await call('dashboard_funil',args);
    expect(funnel.etapas[0]).toMatchObject({chegaram:1,avancaram:1,custoUsd:1,mensagens:{recebidas:1,enviadas:0},movimentos:{janete:1,equipe:0}});
    expect(funnel.etapas[1]).toMatchObject({chegaram:1,aindaEstao:1,custoUsd:2,mensagens:{recebidas:0,enviadas:1}});
    const costs=await call('dashboard_custo',args);expect(costs).toMatchObject({total:7,conversasComJanete:1,porConversaUsd:3,foraDaCoorteUsd:0});
    const operatorFunnel=await call('dashboard_funil',args,operator);expect(operatorFunnel.etapas.every((e:Row)=>e['custoUsd']===null)).toBe(true);
  });
  it('counts distinct conversations per day and computes round response from last input',async()=>{
    const times=['09:00','09:05','09:06'];for(let i=0;i<times.length;i++){const t=`2026-11-09T${times[i]}:00.000Z`;await store.set('mensagens',`m${i}`,{id:`m${i}`,conversa_id:'cv',rodada_id:'r',direcao:i<2?'entrada':'saida',origem:i<2?'lead':'janete',status:i<2?'recebida':'enviada',momento:t});}
    const report=await call('dashboard_periodo',{p_de:'2026-11-09T03:00:00.000Z',p_ate:'2026-11-11T03:00:00.000Z'});
    expect(report).toMatchObject({conversas:1,recebidas:2,enviadas:1,respostaJaneteS:60,conversasAutonomas:1});expect(report.series.conversas).toEqual([{dia:'2026-11-09',valor:1},{dia:'2026-11-10',valor:0}]);
  });
  it('groups consecutive failures and ends connection outage when it reconnects',async()=>{
    for(const [id,status,time]of [['a','falhou','09:00'],['b','falhou','09:02'],['c','concluida','09:03'],['d','falhou','09:04']] as const)await store.set('rodadas',id,{id,conversa_id:id,status,motivo:status==='falhou'?'erro_provedor':null,terminada_em:`2026-11-09T${time}:00.000Z`});
    await store.set('conexao_eventos','down',{id:'down',conexao_id:'connection',status_para:'desconectada',ativa_para:true,criado_em:'2026-11-09T09:00:00.000Z'});await store.set('conexao_eventos','up',{id:'up',conexao_id:'connection',status_para:'conectada',ativa_para:true,criado_em:'2026-11-09T09:05:00.000Z'});
    const rows=await call('dashboard_problemas',{p_de:'2026-11-09T03:00:00.000Z',p_ate:'2026-11-10T03:00:00.000Z'});
    expect(rows.filter((r:Row)=>r['tipo']==='falha_ia')).toHaveLength(2);expect(rows.find((r:Row)=>r['id']==='falha_ia:a')).toMatchObject({quantidade:2,durMin:2});expect(rows.find((r:Row)=>r['tipo']==='conexao')).toMatchObject({durMin:5,fim:'2026-11-09T09:05:00.000Z'});
  });
  it('undoes only human handoff caused by a proven outgoing gateway echo',async()=>{
    const [entry]=await call('registrar_entrada',incoming(),system);vi.advanceTimersByTime(9000);const [round]=await call('pegar_rodadas',{p_limite:1},system);await call('concluir_rodada',{p_rodada:round.id,p_respostas:[{texto:'Primeira'},{texto:'Segunda'}]},system);const [send]=await call('pegar_envios',{p_limite:1},system);
    const echoArgs=incoming('external-echo','Texto alterado pelo gateway');const echoId=await call('registrar_saida_celular',echoArgs,system);expect((await store.get('conversas',entry.conversa_id))!['modo']).toBe('humano');
    await call('concluir_envio',{p_msg:send.id,p_id_externo:'external-echo'},system);expect(await store.get('mensagens',echoId)).toBeNull();expect((await store.get('conversas',entry.conversa_id))!['modo']).toBe('janete');expect((await store.list('mensagens')).filter(m=>m['status']==='na_fila')).toHaveLength(1);
  });
});


it('transaction overlay paginates changed rows without repeating them',async()=>{
  for(let n=0;n<510;n++)await store.set('test',String(n).padStart(4,'0'),{id:String(n).padStart(4,'0'),value:n});
  const rows=await transact(store,async tx=>{await tx.set('test','0000',{value:-1},true);return bounded(tx,'test',{order:[{field:'id'}]},1000);});
  expect(rows).toHaveLength(510);expect(new Set(rows.map(r=>r['id'])).size).toBe(510);expect(rows[0]!['value']).toBe(-1);
});


it('allows deleting and configuring a transcription key again without a stale unique index',async()=>{
  const base={store,actor:system,collection:'ia_chaves'};
  await applyMutation({...base,operation:'insert',values:{id:'first-transcription',finalidade:'transcricao',provedor:'openai',modelo:'test'}});
  await applyMutation({...base,operation:'delete',options:{filters:[{field:'id',op:'eq',value:'first-transcription'}]}});
  await expect(applyMutation({...base,operation:'insert',values:{id:'replacement-transcription',finalidade:'transcricao',provedor:'openai',modelo:'test'}})).resolves.toHaveLength(1);
});
