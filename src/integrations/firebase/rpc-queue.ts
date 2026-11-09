import type { Row, StoreTransaction } from './store-types';
import { activeConnection,bounded,cancelAutomation,eq,event,fail,insertMessage,iso,key,later,maxBatch,required,sequence,stamp,uid,updateMessage } from './rpc-common';

export async function failRound(tx:StoreTransaction,args:Row){
  const r=await required(tx,'rodadas',args['p_rodada'],'rodada_nao_rodando');if(r['status']==='cancelada')return null;if(r['status']!=='rodando')fail('rodada_nao_rodando');
  const c=await required(tx,'conversas',r['conversa_id']);const entries=await bounded(tx,'mensagens',{filters:[eq('rodada_id',r['id']),eq('direcao','entrada')]},250);
  await tx.set('rodadas',r['id'],{status:'falhou',motivo:args['p_motivo'],terminada_em:iso()},true);
  for(const m of entries)await tx.set('mensagens',m['id'],{rodada_id:null},true);
  if(c['modo']!=='janete')return null;
  if(args['p_passageiro']&&Number(r['tentativa']??1)<3)await tx.set('conversas',c['id'],{responder_apos:later(30)},true);
  else {await tx.set('conversas',c['id'],{modo:'humano',aguardando_humano_desde:iso(),motivo_humano:args['p_motivo'],responder_apos:null},true);await tx.set('rodadas',r['id'],{foi_para_equipe:true},true);await event(tx,c['id'],{tipo:'passou',motivo:args['p_motivo']});}
  return null;
}

export async function takeRounds(tx:StoreTransaction,limit:unknown):Promise<Row[]>{
  const cap=maxBatch(limit,10);if(!cap)return[];
  const stale=await tx.list('rodadas',{filters:[eq('status','rodando'),{field:'iniciada_em',op:'lt',value:later(-300)}],order:[{field:'iniciada_em'}],limit:5});
  for(const r of stale)await failRound(tx,{p_rodada:r['id'],p_motivo:'erro_provedor',p_passageiro:true});
  const cfg=await tx.get('configuracao',1);if(!cfg?.['onboarding_concluido_em'])return[];
  const connection=await activeConnection(tx);if(!connection)return[];
  const context=cfg['contexto_atual_id']?{id:cfg['contexto_atual_id']}:(await tx.list('contexto_versoes',{order:[{field:'numero',ascending:false}],limit:1}))[0];
  const ai=(await tx.list('ia_chaves',{filters:[eq('finalidade','resposta')],limit:1}))[0];
  const candidates=await tx.list('conversas',{filters:[eq('modo','janete'),{field:'responder_apos',op:'lte',value:iso()},{field:'responder_apos',op:'gt',value:''}],order:[{field:'responder_apos'}],limit:cap*3});
  const selected:Row[]=[];
  for(const c of candidates){
    if(selected.length>=cap)break;
    if(connection['oficial']&&stamp(c['ultima_do_lead_em'])+86400000<=Date.now())continue;
    const running=await tx.list('rodadas',{filters:[eq('conversa_id',c['id']),eq('status','rodando')],limit:1});if(running.length)continue;
    const media=await tx.list('mensagens',{filters:[eq('conversa_id',c['id']),eq('direcao','entrada'),eq('midia_status','pendente'),{field:'criado_em',op:'gt',value:later(-120)}],limit:1});if(media.length)continue;
    const previous=await tx.list('rodadas',{filters:[eq('conversa_id',c['id'])],order:[{field:'criado_em',ascending:false}],limit:10});
    let attempt=1;for(const p of previous){if(p['status']==='concluida'||stamp(p['criado_em'])<=stamp(c['devolvida_em']))break;if(p['status']==='falhou')attempt++;}
    const entries=await bounded(tx,'mensagens',{filters:[eq('conversa_id',c['id']),eq('direcao','entrada'),eq('rodada_id',null)]},200);
    const now=iso();const round={id:uid(),conversa_id:c['id'],status:'rodando',motivo:null,contexto_versao_id:context?.['id']??null,provedor:ai?.['provedor']??null,modelo:ai?.['modelo']??null,passos:0,tentativa:attempt,passou_humano:false,foi_para_equipe:false,ferramentas:[],iniciada_em:now,terminada_em:null,criado_em:now};
    await tx.set('conversas',c['id'],{responder_apos:null,lote_iniciado_em:null},true);await tx.set('rodadas',round.id,round);
    for(const m of entries)await tx.set('mensagens',m['id'],{rodada_id:round.id},true);
    selected.push(round);
  }
  return selected;
}

export async function completeRound(tx:StoreTransaction,args:Row){
  const r=await required(tx,'rodadas',args['p_rodada'],'rodada_nao_rodando');
  if(r['status']==='concluida')return null;
  if(!['rodando','cancelada'].includes(r['status']))fail('rodada_nao_rodando');
  // Completion is idempotent even if a cancelled round's worker retries its commit.
  if(r['respostas_gravadas'])return null;
  const c=await required(tx,'conversas',r['conversa_id']);
  const human=await tx.list('mensagens',{filters:[eq('conversa_id',c['id']),{field:'origem',op:'in',value:['humano_tela','humano_celular']},{field:'criado_em',op:'gte',value:r['iniciada_em']}],limit:1});
  const status=r['status']==='rodando'&&(c['modo']==='janete'||r['passou_humano'])&&!human.length?'na_fila':'cancelada';
  const responses=(Array.isArray(args['p_respostas'])?args['p_respostas']:[]).slice(0,12);let order=0;
  for(const response of responses){
    const audio=response.tipo==='audio';if(!audio&&!String(response.texto??'').trim())continue;
    const id=audio?response.id:uid();
    if(audio&&(!id||response.midia_caminho!==`${c['id']}/${id}`||!String(response.transcricao??'').trim()||!/^audio\//i.test(response.midia_mime??'')))fail('resposta_audio_invalida');
    order++;
    await insertMessage(tx,{id,conversa_id:c['id'],conexao_id:c['conexao_id'],direcao:'saida',origem:'janete',tipo:audio?'audio':'texto',texto:audio?null:response.texto,transcricao:audio?response.transcricao:null,midia_caminho:audio?response.midia_caminho:null,midia_mime:audio?response.midia_mime:null,midia_tamanho:audio?response.midia_tamanho??null:null,midia_duracao_s:audio?response.midia_duracao_s??null:null,midia_status:audio?'copiada':null,status,ordem:order,enviar_apos:later((order-1)*2),rodada_id:r['id']},null);
  }
  await tx.set('rodadas',r['id'],{status:r['status']==='cancelada'?'cancelada':'concluida',ferramentas:args['p_ferramentas']??r['ferramentas'],passos:args['p_passos']??r['passos'],terminada_em:r['terminada_em']??iso(),respostas_gravadas:true},true);return null;
}

export async function takeSends(tx:StoreTransaction,limit:unknown):Promise<Row[]>{
  const cap=maxBatch(limit,20);if(!cap)return[];
  const stale=await tx.list('mensagens',{filters:[eq('direcao','saida'),eq('status','enviando'),{field:'status_em',op:'lt',value:later(-120)}],order:[{field:'status_em'}],limit:30});
  // A transport timeout does not prove non-delivery. Never automatically resend an unknown send.
  for(const m of stale)await updateMessage(tx,m,m['id_externo']||m['id_gateway']?{status:'enviada',status_em:iso()}:{status:'falhou',erro:'sem_resposta_do_envio',status_em:iso()});
  const connection=await activeConnection(tx);if(!connection)return[];
  const queue=await tx.list('mensagens',{filters:[eq('direcao','saida'),eq('status','na_fila')],order:[{field:'criado_em'},{field:'ordem'}],limit:150});
  const seen=new Set<string>();const selected:Row[]=[];
  for(const m of queue){
    if(selected.length>=cap)break;if(seen.has(m['conversa_id']))continue;seen.add(m['conversa_id']);
    if(m['conexao_id']!==connection['id']){await updateMessage(tx,m,{status:'falhou',erro:'conexao_inativa',status_em:iso()});continue;}
    if(stamp(m['enviar_apos']??m['criado_em'])>Date.now())continue;
    const sending=await tx.list('mensagens',{filters:[eq('conversa_id',m['conversa_id']),eq('direcao','saida'),eq('status','enviando')],limit:1});if(sending.length)continue;
    const next={...m,status:'enviando',tentativas:Number(m['tentativas']??0)+1,status_em:iso()};await updateMessage(tx,m,next);selected.push(next);
  }
  return selected;
}

export async function completeSend(tx:StoreTransaction,args:Row){
  const m=await required(tx,'mensagens',args['p_msg'],'mensagem_nao_encontrada');const id=String(args['p_id_externo']??'').trim()||m['id_externo'];
  if(id){
    const dedup=key('mensagem',m['conexao_id'],id);const index=await tx.get('indices_unicos',dedup);
    if(index&&index['registro_id']!==m['id']){
      const echo=await tx.get('mensagens',index['registro_id']);
      if(echo&&echo['conversa_id']===m['conversa_id']&&echo['origem']==='humano_celular'&&stamp(echo['criado_em'])>Date.now()-60000){
        const conversation=await required(tx,'conversas',m['conversa_id']);
        const humans=await tx.list('mensagens',{filters:[eq('conversa_id',m['conversa_id']),{field:'origem',op:'in',value:['humano_tela','humano_celular']},{field:'criado_em',op:'gte',value:m['criado_em']}],limit:100});
        const events=await tx.list('conversa_eventos',{filters:[eq('conversa_id',m['conversa_id']),eq('origem_mensagem_id',echo['id'])],limit:10});
        const cancelledMessages=await tx.list('mensagens',{filters:[eq('conversa_id',m['conversa_id']),eq('cancelada_por_mensagem_id',echo['id']),eq('status','cancelada')],limit:100});
        const cancelledRounds=await tx.list('rodadas',{filters:[eq('conversa_id',m['conversa_id']),eq('cancelada_por_mensagem_id',echo['id']),eq('status','cancelada')],limit:10});
        await tx.delete('mensagens',echo['id']);
        for(const e of events)await tx.delete('conversa_eventos',e['id']);
        // Undo only effects caused by this proven echo, never a later genuine human intervention.
        if(m['origem']==='janete'&&conversation['modo']==='humano'&&conversation['motivo_humano']==='humano_celular'&&!conversation['responsavel_id']&&!humans.some(h=>h['id']!==echo['id'])){
          await tx.set('conversas',conversation['id'],{modo:'janete',motivo_humano:null,aguardando_humano_desde:null},true);
          for(const cm of cancelledMessages)await tx.set('mensagens',cm['id'],{status:'na_fila',status_em:iso(),cancelada_por_mensagem_id:null},true);
          for(const cr of cancelledRounds){
            await tx.set('rodadas',cr['id'],{status:cr['respostas_gravadas']?'concluida':'rodando',terminada_em:cr['respostas_gravadas']?cr['terminada_em']:null,cancelada_por_mensagem_id:null},true);
            if(!cr['respostas_gravadas']){
              const entries=await tx.list('mensagens',{filters:[eq('conversa_id',m['conversa_id']),eq('direcao','entrada'),eq('rodada_id',null),{field:'criado_em',op:'lte',value:cr['iniciada_em']}],limit:100});
              for(const entry of entries)await tx.set('mensagens',entry['id'],{rodada_id:cr['id']},true);
            }
          }
          const unclaimed=await tx.list('mensagens',{filters:[eq('conversa_id',m['conversa_id']),eq('direcao','entrada'),eq('rodada_id',null)],order:[{field:'criado_em',ascending:false}],limit:1});
          if(unclaimed[0]&&stamp(unclaimed[0]['criado_em'])>stamp(m['criado_em']))await tx.set('conversas',conversation['id'],{responder_apos:iso()},true);
        }
      }else fail('id_externo_conflitante');
    }
    await tx.set('indices_unicos',dedup,{id:dedup,colecao:'mensagens',registro_id:m['id']});
  }
  const canComplete=['na_fila','enviando'].includes(m['status'])||(m['status']==='falhou'&&m['erro']==='sem_resposta_do_envio');
  await updateMessage(tx,m,{id_externo:id??null,id_gateway:String(args['p_id_gateway']??'').trim()||m['id_gateway'],...(canComplete?{status:'enviada',status_em:iso(),momento:iso(),erro:null}:{})});return null;
}

export async function statusReceipt(tx:StoreTransaction,args:Row):Promise<number>{
  const external=String(args['p_id']??'').trim();if(!external)return 0;
  const a=await tx.list('mensagens',{filters:[eq('conexao_id',args['p_conexao']),eq('id_externo',external),eq('direcao','saida')],limit:10});
  const b=await tx.list('mensagens',{filters:[eq('conexao_id',args['p_conexao']),eq('id_gateway',external),eq('direcao','saida')],limit:10});
  const rows=[...new Map([...a,...b].map(m=>[m['id'],m])).values()];const order=['na_fila','enviando','enviada','entregue','lida'];
  for(const m of rows){const s=args['p_status'];if((order.indexOf(s)>order.indexOf(m['status'])&&order.includes(m['status']))||(s==='falhou'&&['enviando','enviada'].includes(m['status']))){await updateMessage(tx,m,{status:s,status_em:args['p_momento']||iso(),erro:s==='falhou'?'falha_no_gateway':m['erro']});}}
  return rows.length;
}

export async function takeMedia(tx:StoreTransaction,limit:unknown):Promise<Row[]>{
  const cap=maxBatch(limit,20);if(!cap)return[];
  const rows=await tx.list('mensagens',{filters:[eq('midia_status','pendente')],order:[{field:'criado_em'}],limit:100});const out:Row[]=[];
  for(const m of rows){
    if(stamp(m['midia_pega_em'])>Date.now()-120000)continue;
    if(Number(m['midia_tentativas']??0)>=3){await updateMessage(tx,m,{midia_status:'falhou',midia_pega_em:null});continue;}
    if(!m['midia_ref_externa']||out.length>=cap)continue;
    const next={...m,midia_pega_em:iso(),midia_tentativas:Number(m['midia_tentativas']??0)+1};await tx.set('mensagens',m['id'],next);out.push(next);
  }
  return out;
}

export async function takeEvents(tx:StoreTransaction,limit:unknown):Promise<Row[]>{
  const cap=maxBatch(limit,50);if(!cap)return[];
  const rows=await tx.list('eventos_webhook',{filters:[eq('processado_em',null),{field:'tentativas',op:'lt',value:5},{field:'recebido_em',op:'lt',value:later(-30)}],order:[{field:'recebido_em'}],limit:100});const out:Row[]=[];
  for(const e of rows){if(out.length>=cap)break;if(Number(e['tentativas']??0)>=5||stamp(e['pego_em'])>Date.now()-120000)continue;const next={...e,pego_em:iso()};await tx.set('eventos_webhook',e['id'],next);out.push(next);}
  return out;
}

export async function registerEvent(tx:StoreTransaction,args:Row):Promise<Row>{
  const idEvent=String(args['p_id_evento']??'').trim()||null;
  const k=idEvent?key('eventos_webhook',args['p_gateway'],args['p_conexao'],idEvent):null;
  if(k){const i=await tx.get('indices_unicos',k);if(i)return{duplicado:true,id:i['registro_id']};}
  const id=await sequence(tx,'eventos_webhook');
  await tx.set('eventos_webhook',id,{id,gateway:args['p_gateway'],conexao_id:args['p_conexao'],id_evento:idEvent,tipo:args['p_tipo']??null,payload:args['p_payload']??{},recebido_em:iso(),processado_em:null,pego_em:null,tentativas:0,erro:null,criado_em:iso()});
  if(k)await tx.set('indices_unicos',k,{id:k,colecao:'eventos_webhook',registro_id:id});return{duplicado:false,id};
}

export async function pending(tx:StoreTransaction):Promise<Row[]>{
  const now=Date.now();const dates:number[]=[];const eventDates:number[]=[];
  const active=await activeConnection(tx);const cfg=await tx.get('configuracao',1);
  if(active&&cfg?.['onboarding_concluido_em']){
    const conversations=await tx.list('conversas',{filters:[eq('modo','janete'),{field:'responder_apos',op:'gt',value:''}],order:[{field:'responder_apos'}],limit:50});
    for(const c of conversations){
      if(active['oficial']&&stamp(c['ultima_do_lead_em'])+86400000<=now)continue;
      const round=(await tx.list('rodadas',{filters:[eq('conversa_id',c['id']),eq('status','rodando')],order:[{field:'iniciada_em',ascending:false}],limit:1}))[0];
      const media=(await tx.list('mensagens',{filters:[eq('conversa_id',c['id']),eq('direcao','entrada'),eq('midia_status','pendente')],order:[{field:'criado_em',ascending:false}],limit:1}))[0];
      dates.push(Math.max(stamp(c['responder_apos']),round?stamp(round['iniciada_em'])+300000:0,media?stamp(media['criado_em'])+120000:0));
    }
  }
  if(active){
    const queue=await tx.list('mensagens',{filters:[eq('status','na_fila')],order:[{field:'criado_em'},{field:'ordem'}],limit:100});const seen=new Set<string>();
    for(const m of queue){if(seen.has(m['conversa_id']))continue;seen.add(m['conversa_id']);
      const sending=(await tx.list('mensagens',{filters:[eq('conversa_id',m['conversa_id']),eq('status','enviando')],order:[{field:'status_em',ascending:false}],limit:1}))[0];
      dates.push(Math.max(stamp(m['enviar_apos']??m['criado_em']),sending?stamp(sending['status_em'])+120000:0));
    }
  }
  for(const [collection,statusField,status,timeField,seconds]of [['mensagens','status','enviando','status_em',120],['rodadas','status','rodando','iniciada_em',300]] as const){const r=(await tx.list(collection,{filters:[eq(statusField,status)],order:[{field:timeField}],limit:1}))[0];if(r)dates.push(stamp(r[timeField])+seconds*1000);}
  const media=await tx.list('mensagens',{filters:[eq('midia_status','pendente')],order:[{field:'criado_em'}],limit:100});for(const m of media)if(m['midia_ref_externa']||Number(m['midia_tentativas']??0)>=3)dates.push(m['midia_pega_em']?stamp(m['midia_pega_em'])+120000:now);
  const events=await tx.list('eventos_webhook',{filters:[eq('processado_em',null),{field:'tentativas',op:'lt',value:5}],order:[{field:'recebido_em'}],limit:100});for(const e of events)eventDates.push(Math.max(stamp(e['recebido_em'])+30000,e['pego_em']?stamp(e['pego_em'])+120000:0));
  const valid=[...dates,...eventDates].filter(n=>Number.isFinite(n)&&n>0);const minimum=(items:number[])=>items.length?new Date(Math.min(...items)).toISOString():null;
  return[{proximo_em:minimum(valid.filter(n=>n>now)),vencido_desde:minimum(valid.filter(n=>n<=now)),atrasado_desde:minimum(dates.filter(n=>n>0&&n<=now))}];
}
