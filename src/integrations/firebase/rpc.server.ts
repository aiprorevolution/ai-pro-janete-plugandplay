import { timingSafeEqual } from 'node:crypto';
import type { Row, RpcContext } from './store-types';
import { activeConnection,bounded,checkWindow,currentMember,eq,fail,iso,key,later,maxBatch,normalize,required,requireMember,requireSystem,stamp,transact,updateMessage } from './rpc-common';
import { aiTool,conversationAction,memberAction,normalizedIds,registerIncoming,resolveContact,resolveConversation,saveContext } from './rpc-actions';
import { completeRound,completeSend,failRound,pending,registerEvent,statusReceipt,takeEvents,takeMedia,takeRounds,takeSends } from './rpc-queue';
import { contactsView,conversationCosts,dashboardCosts,dashboardFunnel,dashboardNow,dashboardPeriod,dashboardProblems } from './rpc-reads';

const SYSTEM_ONLY=new Set(['registrar_evento_webhook','registrar_entrada','registrar_saida_celular','atualizar_status','pegar_rodadas','falhar_rodada','concluir_rodada','pegar_envios','concluir_envio','falhar_envio','pegar_midias','concluir_midia','desistir_midia','falhar_evento','pegar_eventos_pendentes','contato_por_ids','conversa_do_contato','janete_atualizar_contato','janete_mover_etapa','janete_passar_para_humano','motor_confere','motor_endereco','preparar_copia','manutencao_janete','rodada_rodando']);
const ADMIN_ONLY=new Set(['contexto_salvar','contexto_restaurar','concluir_onboarding','reordenar_etapas','trocar_papel_membro','desativar_membro','reativar_membro','dashboard_custo','dashboard_custo_por_etapa','custo_das_conversas']);

/** Business operations backed by Firestore transactions. No SQL or database emulation. */
export async function dispatchRpc(name:string,args:Row={},context:RpcContext):Promise<any>{
  const {store,actor}=context;
  if(name==='eh_membro'||name==='eh_admin'||name==='membro_atual'){
    const member=await currentMember(store,actor);
    return name==='eh_membro'?!!member:name==='eh_admin'?member?.['papel']==='admin':member?.['id']??fail('sem_acesso');
  }
  if(SYSTEM_ONLY.has(name))requireSystem(actor);
  const member=actor?.system?null:await requireMember(store,actor,ADMIN_ONLY.has(name));
  switch(name){
    case 'contatos_lista':case 'contatos_contadores':case 'buscar_quadro':return contactsView(store,member??{},args,name);
    case 'custo_das_conversas':return conversationCosts(store,args['p_conversas']);
    case 'dashboard_agora':return dashboardNow(store);
    case 'dashboard_periodo':case 'dashboard':return dashboardPeriod(store,args,!!actor?.system||member?.['papel']==='admin');
    case 'dashboard_funil':return dashboardFunnel(store,args,!!actor?.system||member?.['papel']==='admin');
    case 'dashboard_custo':return dashboardCosts(store,args);
    case 'dashboard_problemas':return dashboardProblems(store,args);
    case 'dashboard_custo_por_etapa':return (await dashboardFunnel(store,args,true))['etapas'].map((e:Row)=>({etapa_id:e['etapaId'],usd:e['custoUsd']}));
    case 'dashboard_etapa_em':{
      const h=await store.list('contato_etapa_historico',{filters:[eq('contato_id',args['p_contato']),{field:'criado_em',op:'lte',value:args['p_instante']}],order:[{field:'criado_em',ascending:false}],limit:1});return h[0]?.['para_etapa_id']??null;
    }
    case 'motor_pendencias':return pending(store);
    case 'texto_busca':return normalize(args['p_texto']);
    case 'texto_normalizado':return String(args['p_texto']??'').trim().replace(/\s+/g,' ')||null;
    case 'ids_normalizados':return normalizedIds(args['p_ids']);
    case 'tipo_de_mensagem':return ['texto','audio','imagem','video','documento','figurinha','outro'].includes(args['p_tipo'])?args['p_tipo']:'outro';
    default:break;
  }
  return transact(store,async tx=>{
    // Recheck member inside the mutation transaction: deactivation races cannot retain rights.
    const eu=actor?.system?null:await requireMember(tx,actor,ADMIN_ONLY.has(name));
    switch(name){
      case 'registrar_evento_webhook':return registerEvent(tx,args);
      case 'registrar_entrada':return registerIncoming(tx,args);
      case 'registrar_saida_celular':return registerIncoming(tx,args,true);
      case 'contato_por_ids':return (await resolveContact(tx,args['p_conexao'],args['p_ids'],args['p_nome_whatsapp']))['id'];
      case 'conversa_do_contato':return (await resolveConversation(tx,args['p_contato'],args['p_conexao']))['id'];
      case 'atualizar_status':return statusReceipt(tx,args);
      case 'pegar_rodadas':return takeRounds(tx,args['p_limite']);
      case 'falhar_rodada':return failRound(tx,args);
      case 'concluir_rodada':return completeRound(tx,args);
      case 'pegar_envios':return takeSends(tx,args['p_limite']);
      case 'concluir_envio':return completeSend(tx,args);
      case 'pegar_midias':return takeMedia(tx,args['p_limite']);
      case 'pegar_eventos_pendentes':return takeEvents(tx,args['p_limite']);
      case 'janete_atualizar_contato':case 'janete_mover_etapa':case 'janete_passar_para_humano':return aiTool(tx,name,args);
      case 'trocar_papel_membro':case 'desativar_membro':case 'reativar_membro':return memberAction(tx,name,args,actor);
      case 'assumir_conversa':case 'devolver_para_janete':case 'marcar_lida':return conversationAction(tx,name,args,actor);
      case 'contexto_salvar':case 'contexto_restaurar':return saveContext(tx,args,eu!,name==='contexto_restaurar');
      case 'concluir_onboarding':{
        const cfg=await required(tx,'configuracao',1);const done=cfg['onboarding_concluido_em']??iso();await tx.set('configuracao',1,{onboarding_concluido_em:done,atualizado_em:iso()},true);return done;
      }
      case 'marcar_visto':{
        if(!['kanban','tour'].includes(args['p_onde']))fail('onde_invalido');const now=iso();await tx.set('membros',eu!['id'],{vistos:{...eu!['vistos'],[args['p_onde']]:now}},true);return now;
      }
      case 'mensagem_da_conversa':return (await tx.get('mensagens',args['p_msg']))?.['conversa_id']===args['p_conversa'];
      case 'rodada_rodando':{const r=await required(tx,'rodadas',args['p_rodada'],'rodada_nao_rodando');if(r['status']!=='rodando')fail('rodada_nao_rodando');return r;}
      case 'reordenar_etapas':{
        const ids:string[]=args['p_ids'];if(!Array.isArray(ids)||ids.length<1||ids.length>100||new Set(ids).size!==ids.length)return fail('sem_permissao');
        const all=await bounded(tx,'etapas',{filters:[eq('arquivada',false)]},100);const rows=ids.map(id=>all.find(r=>r['id']===id));if(rows.some(r=>!r))fail('sem_permissao');
        const open=rows[0]!['tipo']==='aberta';if(rows.some(r=>(r!['tipo']==='aberta')!==open))fail('sem_permissao');
        const group=all.filter(r=>(r['tipo']==='aberta')===open);if(group.length!==ids.length)fail('sem_permissao');
        for(let n=0;n<ids.length;n++)await tx.set('etapas',ids[n]!,{ordem:open?n:all.filter(r=>r['tipo']==='aberta').length+n},true);return null;
      }
      case 'reenviar_mensagem':{
        const m=await required(tx,'mensagens',args['p_msg']);
        if(m['direcao']!=='saida'||m['origem']!=='humano_tela'||m['status']!=='falhou')fail('nao_reenviavel');
        if(m['erro']!=='falha_no_gateway'&&(m['id_externo']||m['id_gateway']||['sem_resposta_do_envio','tempo_esgotado','falha_de_rede'].includes(m['erro'])||/^(http_|http:|meta_|zernio_http_)5\d\d/.test(m['erro']??'')))fail('nao_reenviavel');
        const connection=await activeConnection(tx);if(!connection)fail('sem_conexao_ativa');const c=await required(tx,'conversas',m['conversa_id']);checkWindow(connection!,c);
        await updateMessage(tx,m,{status:'na_fila',erro:null,tentativas:0,enviar_apos:iso(),status_em:iso(),conexao_id:connection!['id'],id_externo:null,id_gateway:null,reenvios:Number(m['reenvios']??0)+1});return null;
      }
      case 'falhar_envio':{
        const m=await required(tx,'mensagens',args['p_msg'],'mensagem_nao_encontrada');if(!['na_fila','enviando'].includes(m['status']))return null;
        const uncertain=['sem_resposta_do_envio','tempo_esgotado','falha_de_rede'].includes(args['p_erro']);
        const done=args['p_definitivo']||uncertain||Number(m['tentativas']??0)>=3;
        await updateMessage(tx,m,{status:done?'falhou':'na_fila',erro:args['p_erro'],status_em:iso(),...(done?{}:{enviar_apos:later(30)})});return null;
      }
      case 'concluir_midia':case 'desistir_midia':{
        const m=await required(tx,'mensagens',args['p_msg'],'mensagem_nao_encontrada');
        if(name==='desistir_midia'){if(m['midia_status']==='pendente')await updateMessage(tx,m,{midia_status:'falhou',midia_pega_em:null,erro:String(args['p_erro']??'').slice(0,200)});return null;}
        if(args['p_ok']){
          if(args['p_caminho']!==`${m['conversa_id']}/${m['id']}`)fail('caminho_midia_invalido');
          await updateMessage(tx,m,{midia_status:'copiada',midia_caminho:args['p_caminho'],midia_mime:args['p_mime']||m['midia_mime'],midia_tamanho:args['p_tamanho']??m['midia_tamanho'],midia_pega_em:null});
        }else if(m['midia_status']==='pendente')await updateMessage(tx,m,{midia_status:Number(m['midia_tentativas'])>=3?'falhou':'pendente',midia_pega_em:null});return null;
      }
      case 'falhar_evento':{
        const e=await required(tx,'eventos_webhook',args['p_id']);if(!e['processado_em'])await tx.set('eventos_webhook',e['id'],{erro:String(args['p_erro']??'').slice(0,200),tentativas:Number(e['tentativas']??0)+1,pego_em:null},true);return null;
      }
      case 'preparar_copia':{
        // Initial owner and defaults are created by the authenticated bootstrap, not by first HTTP visitor.
        const cfg=await tx.get('configuracao',1);return cfg?'pronta':'aguardando_instalacao';
      }
      case 'motor_endereco':{
        let url:URL;try{url=new URL(args['p_url']);}catch{return false;}
        if(url!.protocol!=='https:'||url!.username||url!.password||['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(url!.hostname))return false;
        await tx.set('motor','principal',{id:'principal',url:url!.origin,url_em:iso()},true);return true;
      }
      case 'motor_confere':{
        const motor=await tx.get('motor','principal');const a=Buffer.from(String(motor?.['chave']??'')),b=Buffer.from(String(args['p_chave']??''));return a.length>0&&a.length===b.length&&timingSafeEqual(a,b);
      }
      case 'acordar_motor':return fail('usar_fila_cloud_tasks');
      case 'manutencao_janete':{
        const old=await tx.list('eventos_webhook',{filters:[{field:'recebido_em',op:'lt',value:later(-30*86400)},{field:'processado_em',op:'gt',value:''}],order:[{field:'recebido_em'}],limit:100});
        for(const e of old){await tx.delete('eventos_webhook',e['id']);if(e['id_evento'])await tx.delete('indices_unicos',key('eventos_webhook',e['gateway'],e['conexao_id'],e['id_evento']));}return null;
      }
      default:fail('operacao_nao_suportada','42883');
    }
  });
}

export const RPC_NAMES=[...new Set([...SYSTEM_ONLY,...ADMIN_ONLY,'eh_membro','eh_admin','membro_atual','contatos_lista','contatos_contadores','buscar_quadro','dashboard_agora','dashboard_periodo','dashboard_funil','dashboard_problemas','dashboard_etapa_em','assumir_conversa','devolver_para_janete','marcar_lida','marcar_visto','mensagem_da_conversa','reenviar_mensagem','motor_pendencias','texto_busca','texto_normalizado','ids_normalizados','tipo_de_mensagem','dashboard'])];
