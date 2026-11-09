import type { Row, StoreTransaction } from './store-types';
import { bounded, eq, fail, iso, normalize, stamp } from './rpc-common';

export const MOTIVOS_FALHA_DASHBOARD = ['chave_invalida','sem_credito','audio_sem_transcricao','limite_passos','erro_provedor','envio_falhou'] as const;

const day=(value:unknown)=>stamp(value)?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(String(value))):'';
const median=(values:number[])=>{const s=values.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s.length%2?s[Math.floor(s.length/2)]!:(s[s.length/2-1]!+s[s.length/2]!)/2:null;};
const percentile=(values:number[],p:number)=>{const s=values.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.ceil(s.length*p)-1)]!:null;};
const sum=(rows:Row[],field:string)=>rows.reduce((a,r)=>a+(Number(r[field])||0),0);
const counts=(rows:Row[],field:string):Row=>{const out:Row={};for(const row of rows){const k=String(row[field]??'');out[k]=Number(out[k]??0)+1;}return out;};
const series=(rows:Row[],dateField:string,valueField?:string)=>{const out:Row={};for(const row of rows){const d=day(row[dateField]);if(!d)continue;out[d]=Number(out[d]??0)+(valueField?Number(row[valueField])||0:1);}return Object.entries(out).sort(([a],[b])=>a.localeCompare(b)).map(([dia,valor])=>({dia,valor}));};
const contactLabel=(c:Row)=>({contatoId:c['id'],nome:c['nome']??null,nomeWhatsapp:c['nome_whatsapp']??null,telefone:c['telefone']??null});
function daily(points:Row[],from:number,to:number):Row[]{
  const values=new Map(points.map(p=>[p['dia'],p['valor']]));const out:Row[]=[];
  for(let time=Date.parse(`${day(new Date(from).toISOString())}T12:00:00.000Z`),end=Date.parse(`${day(new Date(to-1).toISOString())}T12:00:00.000Z`);time<=end;time+=86400000){const d=new Date(time).toISOString().slice(0,10);out.push({dia:d,valor:values.get(d)??0});}return out;
}

export async function contactsView(tx:StoreTransaction,member:Row,args:Row,mode:string):Promise<any>{
  const contacts=await bounded(tx,'contatos',{order:[{field:'id'}]});
  const conversations=await bounded(tx,'conversas',{order:[{field:'id'}]});const cv=new Map(conversations.map(c=>[c['contato_id'],c]));
  const stages=await bounded(tx,'etapas',{},100);const stageMap=new Map(stages.map(s=>[s['id'],s]));
  const today=day(iso());
  const matches=(c:Row,slice:string)=>{const v=cv.get(c['id']);if(slice==='todos')return true;if(!c['primeira_mensagem_em'])return false;if(slice==='novos_hoje')return day(c['primeira_mensagem_em'])===today;if(slice==='precisam')return v?.['modo']==='humano'&&!v['responsavel_id']&&!!v['aguardando_humano_desde'];if(slice==='com_janete')return v?.['modo']==='janete';if(slice==='comigo')return v?.['modo']==='humano'&&v['responsavel_id']===member['id'];return false;};
  if(mode==='contatos_contadores')return Object.fromEntries(['todos','precisam','novos_hoje','com_janete','comigo'].map(k=>[k,contacts.filter(c=>matches(c,k)).length]));
  const q=normalize(args['p_busca']??args['p_q']);const digits=String(args['p_busca']??args['p_q']??'').replace(/\D/g,'');
  const search=(c:Row)=>!q||['nome','nome_whatsapp','empresa','email'].some(k=>normalize(c[k]).includes(q))||(digits.length>=4&&String(c['telefone']??'').includes(digits));
  if(mode==='buscar_quadro')return contacts.filter(search).map(c=>c['id']);
  const slice=args['p_recorte']||'todos';const order=args['p_ordem']||'ultima';const direction=args['p_direcao']||'desc';
  if(!['todos','precisam','novos_hoje','com_janete','comigo'].includes(slice)||!['contato','etapa','ultima','entrada'].includes(order)||!['asc','desc'].includes(direction))fail('parametro_invalido');
  const limit=Number(args['p_limite']??50);const offset=Math.max(0,Number(args['p_deslocamento']??0));if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset))fail('parametro_invalido');
  const rows=contacts.filter(c=>matches(c,slice)&&search(c)&&(!Array.isArray(args['p_etapas'])||!args['p_etapas'].length||args['p_etapas'].includes(c['etapa_id']))&&(!args['p_entrada_de']||day(c['primeira_mensagem_em'])>=args['p_entrada_de'])&&(!args['p_entrada_ate']||(day(c['primeira_mensagem_em'])&&day(c['primeira_mensagem_em'])<=args['p_entrada_ate']))).map(c=>({contato_id:c['id'],nome:c['nome'],nome_whatsapp:c['nome_whatsapp'],telefone:c['telefone'],email:c['email'],empresa:c['empresa'],etapa_id:c['etapa_id'],etapa_ordem:stageMap.get(c['etapa_id'])?.['ordem']??0,primeira_mensagem_em:c['primeira_mensagem_em'],criado_em:c['criado_em'],entrou_em:c['primeira_mensagem_em']??c['criado_em'],ultima_mensagem_em:cv.get(c['id'])?.['ultima_mensagem_em']??null,conversa:cv.get(c['id'])??null}));
  const name=(r:Row)=>normalize(r['nome']||r['nome_whatsapp']||r['telefone']||'Sem nome');
  const value=(r:Row)=>order==='contato'?name(r):order==='etapa'?r['etapa_ordem']:order==='entrada'?r['entrou_em']:r['ultima_mensagem_em'];
  rows.sort((a,b)=>{const x=value(a),y=value(b);if(x==null&&y!=null)return 1;if(y==null&&x!=null)return -1;return (x===y?0:x<y?-1:1)*(direction==='asc'?1:-1)||name(a).localeCompare(name(b))||a.contato_id.localeCompare(b.contato_id);});
  return{total:rows.length,linhas:rows.slice(offset,offset+limit)};
}

export async function conversationCosts(tx:StoreTransaction,ids:unknown):Promise<Row[]>{
  if(!Array.isArray(ids)||ids.length>200)return fail('parametro_invalido');
  const out:Row[]=[];for(const id of ids){const rows=await bounded(tx,'ia_chamadas',{filters:[eq('conversa_id',id)]});out.push({conversa_id:id,custo_usd:sum(rows,'custo_usd')});}return out;
}

function period(args:Row){const from=stamp(args['p_de']??args['p_inicio']);const to=stamp(args['p_ate']??args['p_fim']);if(!from||!to||from>=to||to-from>366*86400000)fail('periodo_invalido');return{from,to,filters:[{field:'criado_em',op:'gte' as const,value:new Date(from).toISOString()},{field:'criado_em',op:'lt' as const,value:new Date(to).toISOString()}]};}

export async function dashboardNow(tx:StoreTransaction):Promise<Row>{
  const [contacts,conversations,stages,members,running]=await Promise.all([bounded(tx,'contatos',{order:[{field:'id'}]}),bounded(tx,'conversas',{order:[{field:'id'}]}),bounded(tx,'etapas',{order:[{field:'ordem'}]},100),bounded(tx,'membros',{},500),bounded(tx,'rodadas',{filters:[eq('status','rodando')]},500)]);
  const ct=new Map(contacts.map(c=>[c['id'],c]));const waiting=conversations.filter(c=>c['modo']==='humano'&&!c['responsavel_id']&&c['aguardando_humano_desde']).sort((a,b)=>stamp(a['aguardando_humano_desde'])-stamp(b['aguardando_humano_desde']));
  const unseen=conversations.filter(c=>Number(c['nao_lidas'])>0);const old=contacts.filter(c=>stamp(c['etapa_desde'])<Date.now()-7*86400000);const first=running[0]?conversations.find(c=>c['id']===running[0]!['conversa_id']):null;
  return{
    aguardando:{total:waiting.length,maisAntigaDesde:waiting[0]?.['aguardando_humano_desde']??null,itens:waiting.slice(0,30).map(c=>({...contactLabel(ct.get(c['contato_id'])??{}),conversaId:c['id'],motivo:c['motivo_humano'],aguardandoDesde:c['aguardando_humano_desde']}))},
    naoLidas:{conversas:unseen.length,mensagens:sum(unseen,'nao_lidas')},
    comQuem:{janete:conversations.filter(c=>c['modo']==='janete').length,membros:members.filter(m=>m['ativo']).map(m=>({membroId:m['id'],nome:m['nome'],n:conversations.filter(c=>c['responsavel_id']===m['id']).length})),celular:conversations.filter(c=>c['modo']==='humano'&&!c['responsavel_id']&&!c['aguardando_humano_desde']).length},
    janeteAtiva:{conversas:running.length,digitando:first?contactLabel(ct.get(first['contato_id'])??{}):null},
    kanban:stages.filter(e=>!e['arquivada']).map(e=>({etapaId:e['id'],nome:e['nome'],tipo:e['tipo'],n:contacts.filter(c=>c['etapa_id']===e['id']).length})),
    esfriando:old.filter(c=>stages.find(e=>e['id']===c['etapa_id'])?.['tipo']==='aberta').length,
    porEtapa:stages.filter(e=>e['tipo']==='aberta'&&!e['arquivada']).map(e=>{const rows=old.filter(c=>c['etapa_id']===e['id']);return{etapaId:e['id'],paradosMais7d:rows.length,leads:rows.slice(0,5).map(c=>({...contactLabel(c),conversaId:conversations.find(v=>v['contato_id']===c['id'])?.['id']??null,etapaDesde:c['etapa_desde']}))};}),
    ultimaRecebidaEm:conversations.reduce<string|null>((a,c)=>stamp(c['ultima_do_lead_em'])>stamp(a)?c['ultima_do_lead_em']:a,null),
    ultimaDaJaneteEm:conversations.reduce<string|null>((a,c)=>stamp(c['ultima_da_janete_em'])>stamp(a)?c['ultima_da_janete_em']:a,null),
  };
}

async function cohortContext(tx:StoreTransaction,args:Row){
  const p=period(args);const state=stamp(args['p_estado_em'])||Date.now();
  const contacts=(await bounded(tx,'contatos',{filters:[{field:'primeira_mensagem_em',op:'gte',value:new Date(p.from).toISOString()},{field:'primeira_mensagem_em',op:'lt',value:new Date(p.to).toISOString()}],order:[{field:'primeira_mensagem_em'}]})).filter(c=>stamp(c['primeira_mensagem_em'])<=state);
  const stages=await bounded(tx,'etapas',{order:[{field:'ordem'}]},100);
  const histories=new Map<string,Row[]>();const conversations=new Map<string,Row>();const byConversation=new Map<string,Row>();
  for(const c of contacts){
    histories.set(c['id'],await bounded(tx,'contato_etapa_historico',{filters:[eq('contato_id',c['id']),{field:'criado_em',op:'lte',value:new Date(state).toISOString()}],order:[{field:'criado_em'},{field:'id'}]}));
    const v=(await tx.list('conversas',{filters:[eq('contato_id',c['id'])],limit:1}))[0];if(v){conversations.set(c['id'],v);byConversation.set(v['id'],c);}
  }
  const at=(c:Row,time:number)=>{const h=histories.get(c['id'])??[];return h.filter(x=>stamp(x['criado_em'])<=time).at(-1)?.['para_etapa_id']??h[0]?.['de_etapa_id']??h[0]?.['para_etapa_id']??c['etapa_id'];};
  return{p,state,contacts,stages,histories,conversations,byConversation,at};
}

export async function dashboardCosts(tx:StoreTransaction,args:Row):Promise<Row>{
  const p=period(args);const [calls,messages,c]=await Promise.all([bounded(tx,'ia_chamadas',{filters:p.filters,order:[{field:'criado_em'}]}),bounded(tx,'mensagens',{filters:[eq('origem','janete'),{field:'status',op:'in',value:['enviada','entregue','lida']},{field:'momento',op:'gte',value:new Date(p.from).toISOString()},{field:'momento',op:'lt',value:new Date(p.to).toISOString()}],order:[{field:'momento'}]}),cohortContext(tx,args)]);
  const models=new Map<string,Row>();for(const call of calls){const k=`${call['provedor']}|${call['modelo']}`;const current=models.get(k)??{provedor:call['provedor'],modelo:call['modelo'],usd:0};current['usd']+=Number(call['custo_usd'])||0;models.set(k,current);}
  const responses=calls.filter(x=>x['tipo']==='resposta');let inFunnel=0;
  for(const call of responses){const conv=call['conversa_id']??(call['rodada_id']?(await tx.get('rodadas',call['rodada_id']))?.['conversa_id']:null);const contact=c.byConversation.get(conv);if(contact&&stamp(call['criado_em'])<=c.state&&c.stages.some(e=>e['id']===c.at(contact,stamp(call['criado_em']))&&!e['arquivada']&&['aberta','ganho'].includes(e['tipo'])))inFunnel+=Number(call['custo_usd'])||0;}
  const total=sum(calls,'custo_usd'),responseCost=sum(responses,'custo_usd');const conversations=new Set(messages.map(m=>m['conversa_id']));
  return{total,porTipo:Object.fromEntries(['resposta','transcricao','onboarding','fala'].map(k=>[k,sum(calls.filter(call=>call['tipo']===k),'custo_usd')])),semPreco:calls.filter(call=>call['custo_origem']==='sem_preco').length,porModelo:[...models.values()].filter(x=>x['usd']>0).sort((a,b)=>b['usd']-a['usd']),conversasComJanete:conversations.size,porConversaUsd:conversations.size?Math.round(responseCost/conversations.size*1e6)/1e6:null,foraDaCoorteUsd:responseCost-inFunnel};
}

export async function dashboardPeriod(tx:StoreTransaction,args:Row,admin:boolean):Promise<Row>{
  const p=period(args);
  const [messages,contacts,events]=await Promise.all([bounded(tx,'mensagens',{filters:[{field:'momento',op:'gte',value:new Date(p.from).toISOString()},{field:'momento',op:'lt',value:new Date(p.to).toISOString()}],order:[{field:'momento'}]}),bounded(tx,'contatos',{filters:[{field:'primeira_mensagem_em',op:'gte',value:new Date(p.from).toISOString()},{field:'primeira_mensagem_em',op:'lt',value:new Date(p.to).toISOString()}],order:[{field:'primeira_mensagem_em'}]}),bounded(tx,'conversa_eventos',{filters:p.filters,order:[{field:'criado_em'}]})]);
  const incoming=messages.filter(m=>m['direcao']==='entrada');const outgoing=messages.filter(m=>m['direcao']==='saida'&&['enviada','entregue','lida'].includes(m['status']));
  const counted=[...incoming,...outgoing];const convs=new Set(counted.map(m=>m['conversa_id']));const responseTimes:number[]=[];const firstTimes:number[]=[];const responseRows:Row[]=[];
  const rounds=[...new Set(outgoing.filter(m=>m['origem']==='janete'&&m['rodada_id']).map(m=>m['rodada_id']))];
  for(const round of rounds){
    const first=(await tx.list('mensagens',{filters:[eq('rodada_id',round),eq('origem','janete'),{field:'status',op:'in',value:['enviada','entregue','lida']}],order:[{field:'momento'}],limit:1}))[0];
    if(!first||stamp(first['momento'])<p.from||stamp(first['momento'])>=p.to)continue;
    const inputs=await tx.list('mensagens',{filters:[eq('rodada_id',round),eq('direcao','entrada'),{field:'momento',op:'lte',value:first['momento']}],order:[{field:'momento',ascending:false}],limit:1});
    const before=inputs[0]??(await tx.list('mensagens',{filters:[eq('conversa_id',first['conversa_id']),eq('direcao','entrada'),{field:'momento',op:'lte',value:first['momento']}],order:[{field:'momento',ascending:false}],limit:1}))[0];
    if(before){const seconds=(stamp(first['momento'])-stamp(before['momento']))/1000;responseTimes.push(seconds);responseRows.push({momento:first['momento'],seconds});}
  }
  const state=stamp(args['p_estado_em'])||Date.now();
  for(const contact of contacts){
    const c=(await tx.list('conversas',{filters:[eq('contato_id',contact['id'])],limit:1}))[0];if(!c)continue;
    const first=(await tx.list('mensagens',{filters:[eq('conversa_id',c['id']),eq('direcao','saida'),{field:'status',op:'in',value:['enviada','entregue','lida']},{field:'momento',op:'gte',value:contact['primeira_mensagem_em']},{field:'momento',op:'lte',value:new Date(state).toISOString()}],order:[{field:'momento'}],limit:1}))[0];
    if(first)firstTimes.push((stamp(first['momento'])-stamp(contact['primeira_mensagem_em']))/1000);
  }
  const passed=events.filter(r=>r['tipo']==='passou');const failReasons:readonly string[]=MOTIVOS_FALHA_DASHBOARD;
  const autonomy=[...convs].filter(id=>!messages.some(m=>m['conversa_id']===id&&m['status']!=='cancelada'&&['humano_tela','humano_celular'].includes(m['origem']))&&!events.some(r=>r['conversa_id']===id&&['passou','assumiu'].includes(r['tipo']))).length;
  const calls=admin?await bounded(tx,'ia_chamadas',{filters:p.filters,order:[{field:'criado_em'}]}):[];
  const conversationDays=[...new Map(counted.map(m=>[`${day(m['momento'])}|${m['conversa_id']}`,m])).values()];
  const responseByDay=new Map<string,number[]>();for(const r of responseRows){const d=day(r['momento']);responseByDay.set(d,[...(responseByDay.get(d)??[]),r['seconds']]);}
  return{conversas:convs.size,leadsNovos:contacts.length,recebidas:incoming.length,enviadas:outgoing.length,enviadasPorOrigem:{janete:outgoing.filter(m=>m['origem']==='janete').length,humano_tela:outgoing.filter(m=>m['origem']==='humano_tela').length,humano_celular:outgoing.filter(m=>m['origem']==='humano_celular').length},primeiraRespostaS:median(firstTimes),respostaJaneteS:median(responseTimes),respostaJaneteP90S:percentile(responseTimes,.9),conversasAutonomas:autonomy,autonomiaPct:convs.size?Math.round(autonomy/convs.size*1000)/10:null,passados:{janetePassou:passed.filter(r=>!failReasons.includes(r['motivo'])).length,falha:passed.filter(r=>failReasons.includes(r['motivo'])).length,porMotivo:counts(passed,'motivo')},series:{conversas:daily(series(conversationDays,'momento'),p.from,p.to),recebidas:daily(series(incoming,'momento'),p.from,p.to),enviadas:daily(series(outgoing,'momento'),p.from,p.to),respostaJaneteS:daily([...responseByDay].map(([dia,v])=>({dia,valor:median(v)})),p.from,p.to),custoUsd:admin?daily(series(calls,'criado_em','custo_usd'),p.from,p.to):null}};
}

export async function dashboardFunnel(tx:StoreTransaction,args:Row,admin:boolean):Promise<Row>{
  const c=await cohortContext(tx,args);const {p,state,contacts,stages,histories,byConversation,at}=c;
  const [messages,events,calls]=await Promise.all([bounded(tx,'mensagens',{filters:[{field:'momento',op:'gte',value:new Date(p.from).toISOString()},{field:'momento',op:'lt',value:new Date(p.to).toISOString()}],order:[{field:'momento'}]}),bounded(tx,'conversa_eventos',{filters:[eq('tipo','passou'),...p.filters],order:[{field:'criado_em'}]}),admin?bounded(tx,'ia_chamadas',{filters:[eq('tipo','resposta'),...p.filters],order:[{field:'criado_em'}]}):Promise.resolve([] as Row[])]);
  const visible=stages.filter(s=>!s['arquivada']&&['aberta','ganho'].includes(s['tipo']));const position=new Map(visible.map((s,i)=>[s['id'],i+1]));
  const pc:Row[]=[];
  for(const contact of contacts){const h=histories.get(contact['id'])??[];const stage=at(contact,state);const visits=[stage,...h.flatMap(x=>[x['de_etapa_id'],x['para_etapa_id']])];const conv=c.conversations.get(contact['id']);const last=conv?(await tx.list('mensagens',{filters:[eq('conversa_id',conv['id']),eq('direcao','entrada'),{field:'momento',op:'lte',value:new Date(state).toISOString()}],order:[{field:'momento',ascending:false}],limit:1}))[0]:null;pc.push({...contact,stage,kind:stages.find(e=>e['id']===stage)?.['tipo'],reach:Math.max(0,...visits.map(x=>position.get(x)??0)),silent:state-stamp(last?.['momento']??contact['primeira_mensagem_em'])>7*86400000});}
  const costs=new Map<string,number>();for(const call of calls){const v=call['conversa_id']??(call['rodada_id']?(await tx.get('rodadas',call['rodada_id']))?.['conversa_id']:null);const contact=byConversation.get(v);if(!contact||stamp(call['criado_em'])>state)continue;const stage=at(contact,stamp(call['criado_em']));costs.set(stage,(costs.get(stage)??0)+(Number(call['custo_usd'])||0));}
  const allHistory=[...histories.values()].flat();
  const rows=visible.map(s=>{
    const pos=position.get(s['id'])!;const reached=pc.filter(x=>x['reach']>=pos),advanced=s['tipo']==='aberta'?pc.filter(x=>x['reach']>pos):[];const lost=s['tipo']==='aberta'?pc.filter(x=>x['reach']===pos&&x['kind']==='perdido').length:0;const silent=s['tipo']==='aberta'?pc.filter(x=>x['reach']===pos&&x['kind']==='aberta'&&x['silent']).length:0;
    const entries:Row[]=[],times:number[]=[];for(const h of histories.values()){const n=h.findIndex(x=>x['para_etapa_id']===s['id']);if(n<0)continue;const first=h[n]!;if(stamp(first['criado_em'])>=p.from&&stamp(first['criado_em'])<p.to)entries.push(first);if(h[n+1])times.push((stamp(h[n+1]!['criado_em'])-stamp(first['criado_em']))/3600000);}
    const stageMessages=messages.filter(m=>{const ct=byConversation.get(m['conversa_id']);return ct&&stamp(m['momento'])<=state&&at(ct,stamp(m['momento']))===s['id']&&(m['direcao']==='entrada'||['enviada','entregue','lida'].includes(m['status']));});
    const movements=advanced.map(x=>(histories.get(x['id'])??[]).find(h=>(position.get(h['para_etapa_id'])??0)>pos)?.['ator']);const t=median(times);
    return{etapaId:s['id'],nome:s['nome'],ordem:s['ordem'],tipo:s['tipo'],janetePodeMover:s['janete_pode_mover'],chegaram:reached.length,avancaram:advanced.length,aindaEstao:s['tipo']==='aberta'?pc.filter(x=>x['reach']===pos&&x['kind']!=='perdido'&&!(x['kind']==='aberta'&&x['silent'])).length:pc.filter(x=>x['stage']===s['id']).length,abandonaram:{total:lost+silent,perdido:lost,semResposta:silent},tempoMedianoH:s['tipo']==='aberta'&&t!=null?Math.round(t*10)/10:null,custoUsd:admin?costs.get(s['id'])??0:null,mensagens:{recebidas:stageMessages.filter(m=>m['direcao']==='entrada').length,enviadas:stageMessages.filter(m=>m['direcao']==='saida').length},movimentos:{janete:movements.filter(x=>x==='janete').length,equipe:movements.filter(x=>x!=='janete').length},passadosParaEquipe:events.filter(e=>{const ct=byConversation.get(e['conversa_id']);return ct&&stamp(e['criado_em'])<=state&&at(ct,stamp(e['criado_em']))===s['id'];}).length,entradasPorDia:daily(series(entries,'criado_em'),p.from,p.to)};
  });
  const gained=pc.filter(x=>x['kind']==='ganho');const cycles=gained.map(x=>{const h=allHistory.find(h=>h['contato_id']===x['id']&&stages.find(s=>s['id']===h['para_etapa_id'])?.['tipo']==='ganho');return h?(stamp(h['criado_em'])-stamp(x['primeira_mensagem_em']))/86400000:NaN;});const cycle=median(cycles);
  return{leadsNovos:contacts.length,ganhos:gained.length,cicloMedianoDias:cycle==null?null:Math.round(cycle*10)/10,etapas:rows};
}

export async function dashboardProblems(tx:StoreTransaction,args:Row):Promise<Row[]>{
  const p=period(args);const [rounds,messages,connections,passes]=await Promise.all([
    bounded(tx,'rodadas',{filters:[{field:'status',op:'in',value:['concluida','falhou']},{field:'terminada_em',op:'lt',value:new Date(p.to).toISOString()}],order:[{field:'terminada_em'}]}),
    bounded(tx,'mensagens',{filters:[{field:'momento',op:'lt',value:new Date(p.to).toISOString()}],order:[{field:'momento'}]}),
    bounded(tx,'conexao_eventos',{filters:[{field:'criado_em',op:'lt',value:new Date(p.to).toISOString()}],order:[{field:'criado_em'}]}),
    bounded(tx,'conversa_eventos',{filters:[eq('tipo','passou'),...p.filters],order:[{field:'criado_em'}]})]);
  const output:Row[]=[];
  const group=(rows:Row[],type:string,differentReasons=false)=>{
    rows=rows.filter(r=>stamp(r['t'])&&stamp(r['t'])<p.to).sort((a,b)=>stamp(a['t'])-stamp(b['t'])||String(a['id']).localeCompare(String(b['id'])));
    const cut=rows.filter(r=>!r['failed']&&stamp(r['t'])<p.from).at(-1);if(cut)rows=rows.filter(r=>stamp(r['t'])>stamp(cut['t']));
    let run:Row[]=[];const flush=()=>{if(!run.length)return;const first=run[0]!,last=run.at(-1)!;if(stamp(first['t'])>=p.from){const affected=type==='falha_ia'?new Set(passes.filter(e=>e['motivo']===first['motivo']&&stamp(e['criado_em'])>=stamp(first['t'])&&stamp(e['criado_em'])<=stamp(last['t'])).map(e=>e['conversa_id'])).size:new Set(run.map(r=>r['conversa_id'])).size;output.push({id:`${type}:${first['id']}`,tipo:type,quando:first['t'],fim:last['t'],durMin:Math.round((stamp(last['t'])-stamp(first['t']))/60000),motivo:differentReasons?first['motivo']:null,quantidade:run.length,conversasAfetadas:affected});}run=[];};
    for(const r of rows){if(!r['failed']){flush();continue;}if(differentReasons&&run.length&&run[0]!['motivo']!==r['motivo'])flush();run.push(r);}flush();
  };
  group(rounds.map(r=>({...r,t:r['terminada_em'],failed:r['status']==='falhou'})),'falha_ia',true);
  group(messages.filter(m=>m['direcao']==='saida'&&['janete','humano_tela'].includes(m['origem'])&&['enviada','entregue','lida','falhou'].includes(m['status'])).map(m=>({...m,t:m['status']==='falhou'?m['status_em']??m['momento']:m['momento'],failed:m['status']==='falhou'})),'envio');
  group(messages.filter(m=>m['midia_ref_externa']&&['copiada','falhou'].includes(m['midia_status'])).map(m=>({...m,t:m['momento'],failed:m['midia_status']==='falhou'})),'midia');
  const ids=new Set(connections.map(e=>e['conexao_id']));for(const id of ids){let run:Row[]=[];const flush=(end:string|null)=>{if(!run.length)return;const first=run[0]!;if(stamp(first['criado_em'])>=p.from)output.push({id:`conexao:${first['id']}`,tipo:'conexao',quando:first['criado_em'],fim:end,durMin:Math.round(((end?stamp(end):Date.now())-stamp(first['criado_em']))/60000),motivo:null,quantidade:run.length,conversasAfetadas:0});run=[];};for(const e of connections.filter(e=>e['conexao_id']===id)){if(e['status_para']==='conectada')flush(e['criado_em']);else if(['desconectada','erro'].includes(e['status_para'])&&e['ativa_para'])run.push(e);}flush(null);}
  return output.sort((a,b)=>stamp(b['quando'])-stamp(a['quando'])||String(a['id']).localeCompare(String(b['id'])));
}
