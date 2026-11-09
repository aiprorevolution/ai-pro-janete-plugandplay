import { MAX_NOME_VOZ, MODOS_VOZ, MODO_VOZ_PADRAO, VOZ_ID } from "@/features/servidor/vozes-tipos";

import { previaDoBanco } from "./dados";
import { conexaoAtiva, ehAdmin, janelaFechada, seloDaConversa } from "./regras";
import type {
  CamposContato,
  Comando,
  CamposEtapa,
  Convite,
  Conversa,
  ErroExemplo,
  EstadoBase,
  EventoPassagem,
  EventoSimulado,
  Membro,
  Mensagem,
  NovaMensagem,
  OrigemPassagem,
  PapelMembro,
  ResultadoExemplo,
} from "./tipos";

// O reducer puro do modo exemplo: (estado, comando) → (estado novo, resultado). Nada vai ao banco.
// As regras seguem as do banco (0000 e 0002) e as decisões da spec das telas:
// - mandar mensagem pela tela tira a Janete e cancela o que ela tinha na fila; o responsável fica
//   quem já estava, ou quem mandou (gatilho tg_mensagens_apos_inserir: coalesce);
// - assumir põe a conversa com quem assumiu, mesmo vinda de outra pessoa (assumir_conversa);
// - devolver para a Janete, qualquer membro (devolver_para_janete);
// - mover etapa: o membro move para qualquer etapa; a Janete só para as que `janete_pode_mover`;
// - apagar contato, editar etapas, trocar conexão, chave ou ritmo: só o admin;
// - na Equipe (spec da Equipe, F2), só o admin convida, troca o papel, desativa e reativa; ninguém
//   mexe em si mesmo e a equipe nunca fica sem admin ativo (gatilho membros_ultimo_admin);
// - sem conexão ativa nada sai; na API oficial (Meta e Zernio), a janela de 24 h vale.
// A ação recusada devolve o erro e o estado igual; nunca lança.

export interface Reduzido {
  estado: EstadoBase;
  resultado: ResultadoExemplo;
}

/** O tamanho máximo do nome de uma etapa (o campo do "Editar etapas"). */
export const MAX_NOME_ETAPA = 32;

/** Os limites do ritmo (Configuração 3): espera de 2 a 30 s; teto de 20 a 120 s, sempre 5 s acima da espera. */
export const LIMITES_RITMO = { espera: { min: 2, max: 30 }, teto: { min: 20, max: 120 }, folga: 5 } as const;

const recusa = (estado: EstadoBase, erro: ErroExemplo): Reduzido => ({ estado, resultado: { ok: false, erro } });
const igual = (estado: EstadoBase): Reduzido => ({ estado, resultado: { ok: true } });

export function reduzir(estado: EstadoBase, comando: Comando): Reduzido {
  const { acao, euId, agora } = comando;
  const eu = estado.membros.find((m) => m.id === euId && m.ativo);
  // Toda ação que não é simulação vem de um membro ativo.
  if (acao.tipo !== "simularJanete" && !eu) return recusa(estado, "sem_permissao");
  const membro = eu as Membro;

  switch (acao.tipo) {
    case "enviarMensagem":
      return enviar(estado, acao.conversaId, acao.mensagem, membro, agora);

    case "assumir": {
      const cv = conversa(estado, acao.conversaId);
      if (!cv) return recusa(estado, "nao_encontrado");
      if (cv.modo === "humano" && cv.responsavel_id === membro.id) return igual(estado);
      const de = origemDaPassagem(cv);
      const novo = cancelarFilaDaJanete(
        mudarConversa(estado, cv.id, {
          modo: "humano",
          responsavel_id: membro.id,
          aguardando_humano_desde: null,
          motivo_humano: cv.modo === "janete" ? "humano_tela" : cv.motivo_humano,
          atualizado_em: agora,
        }),
        cv.id,
      );
      return {
        estado: comEvento(semDigitar(novo, cv.id), {
          conversa_id: cv.id,
          tipo: "assumiu",
          membro_id: membro.id,
          de,
          de_membro_id: de === "outro" ? cv.responsavel_id : null,
          criado_em: agora,
        }),
        resultado: { ok: true, assumiu: true },
      };
    }

    case "devolverParaJanete": {
      const cv = conversa(estado, acao.conversaId);
      if (!cv) return recusa(estado, "nao_encontrado");
      if (cv.modo === "janete") return igual(estado);
      const novo = mudarConversa(estado, cv.id, {
        modo: "janete",
        motivo_humano: null,
        aguardando_humano_desde: null,
        responsavel_id: null,
        devolvida_em: agora,
        atualizado_em: agora,
      });
      return {
        estado: comEvento(novo, { conversa_id: cv.id, tipo: "devolveu", membro_id: membro.id, criado_em: agora }),
        resultado: { ok: true },
      };
    }

    case "marcarLida": {
      const cv = conversa(estado, acao.conversaId);
      if (!cv) return recusa(estado, "nao_encontrado");
      if (cv.nao_lidas === 0) return igual(estado);
      return { estado: mudarConversa(estado, cv.id, { nao_lidas: 0 }), resultado: { ok: true } };
    }

    case "reagir": {
      // Reagir não tira a Janete (Chat final, premissas).
      const m = estado.mensagens.find((x) => x.id === acao.mensagemId);
      if (!m) return recusa(estado, "nao_encontrado");
      return { estado: mudarMensagem(estado, m.id, { reacao: acao.emoji }), resultado: { ok: true } };
    }

    case "tentarDeNovo": {
      const m = estado.mensagens.find((x) => x.id === acao.mensagemId);
      if (!m) return recusa(estado, "nao_encontrado");
      if (m.direcao !== "saida" || m.status !== "falhou") return igual(estado);
      if (!conexaoAtiva(estado)) return recusa(estado, "sem_conexao_ativa");
      const cv = conversa(estado, m.conversa_id);
      if (cv && m.origem !== "humano_celular" && janelaFechada(estado, cv, agora)) return recusa(estado, "janela_fechada");
      return {
        estado: mudarMensagem(estado, m.id, { status: "na_fila", erro: null, conexao_id: estado.conexao!.id }),
        resultado: { ok: true, id: m.id },
      };
    }

    case "moverEtapa":
      return mover(estado, acao.contatoId, acao.etapaId, acao.ator === "janete" ? null : membro, agora);

    case "editarContato": {
      const c = estado.contatos.find((x) => x.id === acao.contatoId);
      if (!c) return recusa(estado, "nao_encontrado");
      const campos: CamposContato = {};
      for (const chave of Object.keys(acao.campos) as (keyof CamposContato)[]) {
        const valor = acao.campos[chave];
        if (valor === undefined) continue;
        const limpo = typeof valor === "string" ? valor.trim() : valor;
        campos[chave] = limpo === "" ? null : limpo;
      }
      return {
        estado: { ...estado, contatos: estado.contatos.map((x) => (x.id === c.id ? { ...x, ...campos, atualizado_em: agora } : x)) },
        resultado: { ok: true },
      };
    }

    case "editarEtapa":
      return editarEtapa(estado, acao.etapaId, acao.campos, membro);

    case "reordenarEtapas":
      return reordenarEtapas(estado, acao.ids, membro);

    case "apagarContato": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      const c = estado.contatos.find((x) => x.id === acao.contatoId);
      if (!c) return recusa(estado, "nao_encontrado");
      const conversasDele = new Set(estado.conversas.filter((x) => x.contato_id === c.id).map((x) => x.id));
      return {
        estado: {
          ...estado,
          contatos: estado.contatos.filter((x) => x.id !== c.id),
          conversas: estado.conversas.filter((x) => !conversasDele.has(x.id)),
          mensagens: estado.mensagens.filter((x) => !conversasDele.has(x.conversa_id)),
          eventos: estado.eventos.filter((x) => !conversasDele.has(x.conversa_id)),
          custos: estado.custos.filter((x) => !conversasDele.has(x.conversa_id)),
          digitando: estado.digitando.filter((x) => !conversasDele.has(x)),
          historico: estado.historico.filter((x) => x.contato_id !== c.id),
          auditoria: [
            ...estado.auditoria,
            {
              id: estado.auditoria.length + 1,
              acao: "contato_apagado",
              alvo: c.id,
              ator_membro_id: membro.id,
              detalhe: { nome: c.nome },
              ultimos4: null,
              criado_em: agora,
            },
          ],
        },
        resultado: { ok: true },
      };
    }

    case "simularJanete":
      return simular(estado, acao.evento, agora);

    case "trocarConexao": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      const atual = estado.conexao;
      if (acao.nova === null) {
        if (!atual) return igual(estado);
        return {
          estado: {
            ...estado,
            conexao: { ...atual, ativa: false, status: "desconectada", atualizado_em: agora },
            auditoria: auditar(estado, "conexao_desativada", atual.id, membro.id, agora, { gateway: atual.gateway }),
          },
          resultado: { ok: true },
        };
      }
      const n = acao.nova;
      const id = `cx-${n.gateway}-${Date.parse(agora)}`;
      return {
        estado: {
          ...estado,
          conexao: {
            id,
            nome: n.nome,
            gateway: n.gateway,
            status: "conectada",
            ativa: true,
            // como o servidor (configuracao.server.ts): Meta e Zernio são a API oficial
            oficial: n.oficial ?? (n.gateway === "meta" || n.gateway === "zernio"),
            id_externo: n.id_externo ?? id,
            ultimo_erro: null,
            criado_em: agora,
            atualizado_em: agora,
          },
          auditoria: atual?.ativa
            ? [
                ...auditar(estado, "conexao_desativada", atual.id, membro.id, agora, { gateway: atual.gateway }),
                linhaAuditoria(estado, 2, "conexao_criada", id, membro.id, agora, { gateway: n.gateway }),
              ]
            : auditar(estado, "conexao_criada", id, membro.id, agora, { gateway: n.gateway }),
        },
        resultado: { ok: true, id },
      };
    }

    case "trocarChaveIA": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      const atual = estado.chaves.find((c) => c.finalidade === acao.finalidade);
      const sem = estado.chaves.filter((c) => c.finalidade !== acao.finalidade);
      if (acao.nova === null) {
        if (!atual) return igual(estado);
        return {
          estado: {
            ...estado,
            chaves: sem,
            auditoria: auditar(estado, "chave_removida", atual.id, membro.id, agora, { finalidade: acao.finalidade }, atual.ultimos4),
          },
          resultado: { ok: true },
        };
      }
      const n = acao.nova;
      const id = atual?.id ?? `ch-${acao.finalidade}`;
      return {
        estado: {
          ...estado,
          chaves: [
            ...sem,
            {
              id,
              finalidade: acao.finalidade,
              provedor: n.provedor,
              modelo: n.modelo,
              status: "ativa",
              ultimos4: n.ultimos4.slice(-4),
              ultimo_erro: null,
              // Trocar só o modelo, com a mesma chave ativa, não valida a chave de novo: a "Última
              // validação" continua a de antes. Chave nova, ou a mesma depois de um erro, vale agora.
              validada_em:
                atual && atual.status === "ativa" && atual.provedor === n.provedor && atual.ultimos4 === n.ultimos4.slice(-4)
                  ? atual.validada_em
                  : agora,
              atualizada_em: agora,
              atualizada_por: membro.id,
            },
          ],
          auditoria: auditar(
            estado,
            atual ? "chave_trocada" : "chave_cadastrada",
            id,
            membro.id,
            agora,
            { finalidade: acao.finalidade, provedor: n.provedor, modelo: n.modelo },
            n.ultimos4.slice(-4),
          ),
        },
        resultado: { ok: true, id },
      };
    }

    case "salvarRitmo": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      const { espera: E, teto: T, folga } = LIMITES_RITMO;
      // Campo numérico vazio vira NaN: fica o valor que já estava.
      const espera = prender(Number.isFinite(acao.espera) ? Math.round(acao.espera) : estado.configuracao.espera_lote_s, E.min, E.max);
      const teto = prender(
        Number.isFinite(acao.teto) ? Math.round(acao.teto) : estado.configuracao.espera_lote_max_s,
        Math.max(T.min, espera + folga),
        T.max,
      );
      return {
        estado: { ...estado, configuracao: { ...estado.configuracao, espera_lote_s: espera, espera_lote_max_s: teto, atualizado_em: agora } },
        resultado: { ok: true },
      };
    }

    // a voz em uso (spec-voz-uso, P10): como o escolherVozLogica e o salvarModoVozLogica, grava em
    // `configuracao` e audita `voz_alterada` sem dado pessoal (só o nome da voz ou o modo)
    case "escolherVoz": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      const v = acao.voz;
      // aparado e cortado em 120 pontos de código (o check do banco), sem partir um emoji
      const nome = typeof v?.nome === "string" ? [...v.nome.trim()].slice(0, MAX_NOME_VOZ).join("") : "";
      if (!v || typeof v.id !== "string" || !VOZ_ID.test(v.id) || !nome) return recusa(estado, "nao_encontrado");
      const anterior = estado.configuracao.voz_nome;
      return {
        estado: {
          ...estado,
          configuracao: {
            ...estado.configuracao,
            voz_id: v.id,
            voz_nome: nome,
            voz_erro: null,
            atualizado_em: agora,
          },
          auditoria: auditar(estado, "voz_alterada", String(estado.configuracao.id), membro.id, agora, {
            voz_nome: nome,
            voz_nome_anterior: anterior ?? "",
          }),
        },
        resultado: { ok: true },
      };
    }

    case "salvarModoVoz": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      // um modo fora da lista é recusado, nunca preso num valor qualquer
      if (!(MODOS_VOZ as readonly string[]).includes(acao.modo)) return recusa(estado, "nao_encontrado");
      const anterior = estado.configuracao.voz_resposta ?? MODO_VOZ_PADRAO;
      if (anterior === acao.modo) return igual(estado);
      return {
        estado: {
          ...estado,
          configuracao: { ...estado.configuracao, voz_resposta: acao.modo, atualizado_em: agora },
          auditoria: auditar(estado, "voz_alterada", String(estado.configuracao.id), membro.id, agora, {
            modo: acao.modo,
            modo_anterior: anterior,
          }),
        },
        resultado: { ok: true },
      };
    }

    case "convidarMembro":
      return convidar(estado, acao.email, acao.papel, membro, agora);

    case "reenviarConvite": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      const convites = estado.convites ?? [];
      if (!convites.some((x) => x.id === acao.conviteId)) return recusa(estado, "nao_encontrado");
      return {
        estado: { ...estado, convites: convites.map((x) => (x.id === acao.conviteId ? { ...x, enviado_em: agora } : x)) },
        resultado: { ok: true },
      };
    }

    case "cancelarConvite": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      const convites = estado.convites ?? [];
      if (!convites.some((x) => x.id === acao.conviteId)) return recusa(estado, "nao_encontrado");
      return { estado: { ...estado, convites: convites.filter((x) => x.id !== acao.conviteId) }, resultado: { ok: true } };
    }

    case "trocarPapelMembro": {
      const alvo = alvoDaEquipe(estado, acao.membroId, membro);
      if ("erro" in alvo) return recusa(estado, alvo.erro);
      if (alvo.membro.papel === acao.papel) return igual(estado);
      if (alvo.membro.papel === "admin" && soEleEhAdmin(estado, alvo.membro.id)) return recusa(estado, "ultimo_admin");
      return {
        estado: { ...estado, membros: estado.membros.map((m) => (m.id === alvo.membro.id ? { ...m, papel: acao.papel } : m)) },
        resultado: { ok: true },
      };
    }

    case "desativarMembro": {
      const alvo = alvoDaEquipe(estado, acao.membroId, membro);
      if ("erro" in alvo) return recusa(estado, alvo.erro);
      if (alvo.membro.papel === "admin" && soEleEhAdmin(estado, alvo.membro.id)) return recusa(estado, "ultimo_admin");
      // As conversas com a pessoa voltam para a espera ("Precisam de você"), marcadas com quem estava
      // com elas; o modo e o motivo ficam (decisão 2 da spec da Equipe).
      let novo: EstadoBase = {
        ...estado,
        membros: estado.membros.map((m) => (m.id === alvo.membro.id ? { ...m, ativo: false } : m)),
      };
      for (const cv of estado.conversas) {
        if (cv.responsavel_id !== alvo.membro.id) continue;
        novo = mudarConversa(novo, cv.id, {
          responsavel_id: null,
          aguardando_humano_desde: agora,
          estavaCom: alvo.membro.id,
          atualizado_em: agora,
        });
      }
      return { estado: novo, resultado: { ok: true } };
    }

    case "reativarMembro": {
      if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
      const m = estado.membros.find((x) => x.id === acao.membroId);
      if (!m) return recusa(estado, "nao_encontrado");
      if (m.ativo) return igual(estado);
      // As conversas não voltam: ficam na espera ou com quem já assumiu.
      return {
        estado: { ...estado, membros: estado.membros.map((x) => (x.id === m.id ? { ...x, ativo: true } : x)) },
        resultado: { ok: true },
      };
    }
  }
}

/* ---------- ações grandes ---------- */

function enviar(estado: EstadoBase, conversaId: string, nova: NovaMensagem, eu: Membro, agora: string): Reduzido {
  const cv = conversa(estado, conversaId);
  if (!cv) return recusa(estado, "nao_encontrado");
  if (!conexaoAtiva(estado)) return recusa(estado, "sem_conexao_ativa");
  if (janelaFechada(estado, cv, agora)) return recusa(estado, "janela_fechada");

  const texto = nova.texto?.trim() ? nova.texto.trim() : null;
  // Nada para mandar (texto vazio e sem anexo): não sai nada nem tira a Janete.
  if (!texto && !nova.midia) return igual(estado);
  const id = novoId(estado, "msg");
  const m: Mensagem = {
    id,
    conversa_id: cv.id,
    conexao_id: estado.conexao!.id,
    direcao: "saida",
    origem: "humano_tela",
    tipo: nova.tipo,
    status: "na_fila",
    texto,
    transcricao: null,
    momento: agora,
    autor_membro_id: eu.id,
    midia_nome: nova.midia?.nome ?? null,
    midia_mime: nova.midia?.mime ?? null,
    midia_tamanho: nova.midia?.tamanho ?? null,
    midia_caminho: null,
    midia_status: nova.midia ? "copiada" : null,
    editada: false,
    apagada_em: null,
    erro: null,
    criado_em: agora,
    reacao: null,
    citaId: nova.citaId ?? null,
    duracaoS: nova.midia?.duracaoS ?? null,
  };

  // "Responder sem assumir" (spec, bloco 2): a mensagem tira a Janete, a espera ou o celular da
  // conversa. Como no banco, o responsável fica quem já estava (outra pessoa continua com ela).
  const assume = cv.modo === "janete" || !cv.responsavel_id;
  const de = assume ? origemDaPassagem(cv) : null;
  let novo = mudarConversa(estado, cv.id, {
    modo: "humano",
    motivo_humano: cv.modo === "janete" ? "humano_tela" : cv.motivo_humano,
    responsavel_id: cv.responsavel_id ?? eu.id,
    aguardando_humano_desde: null,
    nao_lidas: 0,
    ultima_mensagem_em: agora,
    ultima_mensagem_preview: previaDoBanco(m),
    atualizado_em: agora,
  });
  novo = semDigitar(cancelarFilaDaJanete(novo, cv.id), cv.id);
  if (assume && de) {
    novo = comEvento(novo, {
      conversa_id: cv.id,
      tipo: "assumiu",
      membro_id: eu.id,
      de,
      de_membro_id: null,
      por_envio: true,
      criado_em: agora,
    });
  }
  novo = { ...novo, mensagens: [...novo.mensagens, m] };
  return { estado: novo, resultado: { ok: true, id, assumiu: assume } };
}

function mover(estado: EstadoBase, contatoId: string, etapaId: string, membro: Membro | null, agora: string): Reduzido {
  const c = estado.contatos.find((x) => x.id === contatoId);
  const etapa = estado.etapas.find((e) => e.id === etapaId);
  if (!c || !etapa) return recusa(estado, "nao_encontrado");
  if (etapa.arquivada) return recusa(estado, "sem_permissao");
  // A Janete só move para as etapas que ela pode (janete_mover_etapa: etapa_nao_permitida).
  if (!membro && !etapa.janete_pode_mover) return recusa(estado, "sem_permissao");
  if (c.etapa_id === etapaId) return igual(estado);
  return {
    estado: {
      ...estado,
      contatos: estado.contatos.map((x) => (x.id === c.id ? { ...x, etapa_id: etapaId, etapa_desde: agora, atualizado_em: agora } : x)),
      historico: [
        ...estado.historico,
        {
          id: novoId(estado, "hi"),
          contato_id: c.id,
          de_etapa_id: c.etapa_id,
          para_etapa_id: etapaId,
          ator: membro ? "membro" : "janete",
          membro_id: membro ? membro.id : null,
          criado_em: agora,
        },
      ],
    },
    resultado: { ok: true },
  };
}

/**
 * O "Editar etapas" (Kanban 2). Só o admin (policy etapas_admin_altera). As regras de arquivar vêm do
 * gatilho tg_etapas_arquivar: etapa com contato não arquiva, e sobra sempre uma aberta para o lead
 * novo entrar.
 */
function editarEtapa(estado: EstadoBase, etapaId: string, campos: CamposEtapa, membro: Membro): Reduzido {
  if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
  const etapa = estado.etapas.find((e) => e.id === etapaId);
  if (!etapa) return recusa(estado, "nao_encontrado");

  const mudanca: CamposEtapa = {};
  if (campos.nome !== undefined) {
    const nome = (campos.nome ?? "").trim().slice(0, MAX_NOME_ETAPA).trim();
    if (!nome) return recusa(estado, "nome_vazio");
    mudanca.nome = nome;
  }
  if (campos.cor !== undefined) mudanca.cor = campos.cor?.trim() || null;
  if (campos.janete_pode_mover !== undefined) mudanca.janete_pode_mover = campos.janete_pode_mover;
  if (campos.arquivada !== undefined) mudanca.arquivada = campos.arquivada;

  if (mudanca.arquivada && !etapa.arquivada) {
    if (estado.contatos.some((c) => c.etapa_id === etapa.id)) return recusa(estado, "etapa_com_leads");
    const outraAberta = estado.etapas.some((e) => e.id !== etapa.id && e.tipo === "aberta" && !e.arquivada);
    if (etapa.tipo === "aberta" && !outraAberta) return recusa(estado, "sem_etapa_de_entrada");
  }

  const chaves = Object.keys(mudanca) as (keyof CamposEtapa)[];
  if (chaves.every((k) => mudanca[k] === etapa[k])) return igual(estado);
  return {
    estado: { ...estado, etapas: estado.etapas.map((e) => (e.id === etapa.id ? { ...e, ...mudanca } : e)) },
    resultado: { ok: true },
  };
}

/**
 * A nova ordem das etapas, dentro de um grupo só (as abertas, ou Ganho e Perdido), como no protótipo.
 * Os ids passados trocam entre si as posições que já ocupavam: no exemplo as abertas são 10, 20, 30
 * e 40, então ficam 10, 20, 30... na ordem da lista. Reusar as posições (em vez de sempre 10, 20...)
 * mantém Ganho e Perdido no fim quando são eles que trocam; as etapas fora da lista não mudam.
 */
function reordenarEtapas(estado: EstadoBase, ids: readonly string[], membro: Membro): Reduzido {
  if (!ehAdmin(membro)) return recusa(estado, "sem_permissao");
  if (new Set(ids).size !== ids.length) return recusa(estado, "nao_encontrado");
  const etapas = ids.map((id) => estado.etapas.find((e) => e.id === id));
  if (etapas.some((e) => !e)) return recusa(estado, "nao_encontrado");
  const abertas = etapas.filter((e) => e!.tipo === "aberta").length;
  if (abertas !== 0 && abertas !== etapas.length) return recusa(estado, "sem_permissao");

  const posicoes = etapas.map((e) => e!.ordem).sort((x, y) => x - y);
  const ordem = new Map(ids.map((id, i) => [id, posicoes[i]!]));
  if (estado.etapas.every((e) => !ordem.has(e.id) || e.ordem === ordem.get(e.id))) return igual(estado);
  return {
    estado: { ...estado, etapas: estado.etapas.map((e) => (ordem.has(e.id) ? { ...e, ordem: ordem.get(e.id)! } : e)) },
    resultado: { ok: true },
  };
}

function simular(estado: EstadoBase, ev: EventoSimulado, agora: string): Reduzido {
  switch (ev.tipo) {
    case "lead_mensagem": {
      const cv = conversa(estado, ev.conversaId);
      if (!cv) return recusa(estado, "nao_encontrado");
      const id = novoId(estado, "msg");
      const m: Mensagem = {
        id,
        conversa_id: cv.id,
        conexao_id: estado.conexao?.id ?? cv.conexao_id ?? "",
        direcao: "entrada",
        origem: "lead",
        tipo: ev.mensagem.tipo,
        status: "recebida",
        texto: ev.mensagem.texto?.trim() || null,
        transcricao: null,
        momento: agora,
        autor_membro_id: null,
        midia_nome: ev.mensagem.midia?.nome ?? null,
        midia_mime: ev.mensagem.midia?.mime ?? null,
        midia_tamanho: ev.mensagem.midia?.tamanho ?? null,
        midia_caminho: null,
        midia_status: ev.mensagem.midia ? "copiada" : null,
        editada: false,
        apagada_em: null,
        erro: null,
        criado_em: agora,
        reacao: null,
        citaId: ev.mensagem.citaId ?? null,
        duracaoS: ev.mensagem.midia?.duracaoS ?? null,
      };
      // O lead leu o que a empresa mandou antes de responder.
      const lidas = estado.mensagens.map((x) =>
        x.conversa_id === cv.id && x.direcao === "saida" && (x.status === "enviada" || x.status === "entregue")
          ? { ...x, status: "lida" as const }
          : x,
      );
      const novo = mudarConversa({ ...estado, mensagens: [...lidas, m] }, cv.id, {
        nao_lidas: cv.nao_lidas + 1,
        ultima_do_lead_em: agora,
        ultima_mensagem_em: agora,
        ultima_mensagem_preview: previaDoBanco(m),
        atualizado_em: agora,
      });
      return { estado: novo, resultado: { ok: true, id } };
    }

    case "janete_responde": {
      const cv = conversa(estado, ev.conversaId);
      if (!cv) return recusa(estado, "nao_encontrado");
      // A Janete não fala numa conversa que está com uma pessoa.
      // (o "digitando" já sai em assumir, enviar e celular_responde)
      if (cv.modo !== "janete") return recusa(estado, "sem_permissao");
      if (!conexaoAtiva(estado)) return recusa(estado, "sem_conexao_ativa");
      if (janelaFechada(estado, cv, agora)) return recusa(estado, "janela_fechada");
      const id = novoId(estado, "msg");
      const m: Mensagem = {
        id,
        conversa_id: cv.id,
        conexao_id: estado.conexao!.id,
        direcao: "saida",
        origem: "janete",
        tipo: "texto",
        status: "entregue",
        texto: ev.texto,
        transcricao: null,
        momento: agora,
        autor_membro_id: null,
        midia_nome: null,
        midia_mime: null,
        midia_tamanho: null,
        midia_caminho: null,
        midia_status: null,
        editada: false,
        apagada_em: null,
        erro: null,
        criado_em: agora,
        reacao: null,
        citaId: null,
        duracaoS: null,
      };
      const novo = mudarConversa({ ...estado, mensagens: [...estado.mensagens, m] }, cv.id, {
        ultima_mensagem_em: agora,
        ultima_mensagem_preview: previaDoBanco(m),
        atualizado_em: agora,
      });
      return { estado: semDigitar(novo, cv.id), resultado: { ok: true, id } };
    }

    case "janete_digitando": {
      const cv = conversa(estado, ev.conversaId);
      if (!cv) return recusa(estado, "nao_encontrado");
      if (!ev.digitando) return igual(semDigitar(estado, cv.id));
      if (cv.modo !== "janete") return recusa(estado, "sem_permissao");
      if (estado.digitando.includes(cv.id)) return igual(estado);
      return igual({ ...estado, digitando: [...estado.digitando, cv.id] });
    }

    case "janete_move":
      return mover(estado, ev.contatoId, ev.etapaId, null, agora);

    case "janete_passa": {
      const cv = conversa(estado, ev.conversaId);
      if (!cv) return recusa(estado, "nao_encontrado");
      // Como janete_passar_para_humano: só sai de uma conversa que é dela.
      if (cv.modo !== "janete") return recusa(estado, "sem_permissao");
      const novo = mudarConversa(estado, cv.id, {
        modo: "humano",
        motivo_humano: ev.motivo,
        responsavel_id: null,
        aguardando_humano_desde: cv.aguardando_humano_desde ?? agora,
        atualizado_em: agora,
      });
      return {
        estado: comEvento(semDigitar(novo, cv.id), { conversa_id: cv.id, tipo: "passou", motivo: ev.motivo, criado_em: agora }),
        resultado: { ok: true },
      };
    }

    case "janete_resumo": {
      const c = estado.contatos.find((x) => x.id === ev.contatoId);
      if (!c) return recusa(estado, "nao_encontrado");
      return {
        estado: { ...estado, contatos: estado.contatos.map((x) => (x.id === c.id ? { ...x, resumo_janete: ev.resumo, atualizado_em: agora } : x)) },
        resultado: { ok: true },
      };
    }

    case "celular_responde": {
      const cv = conversa(estado, ev.conversaId);
      if (!cv) return recusa(estado, "nao_encontrado");
      const id = novoId(estado, "msg");
      const m: Mensagem = {
        id,
        conversa_id: cv.id,
        conexao_id: estado.conexao?.id ?? cv.conexao_id ?? "",
        direcao: "saida",
        origem: "humano_celular",
        tipo: "texto",
        status: "enviada",
        texto: ev.texto,
        transcricao: null,
        momento: agora,
        autor_membro_id: null,
        midia_nome: null,
        midia_mime: null,
        midia_tamanho: null,
        midia_caminho: null,
        midia_status: null,
        editada: false,
        apagada_em: null,
        erro: null,
        criado_em: agora,
        reacao: null,
        citaId: null,
        duracaoS: null,
      };
      // Como no banco: tira a Janete; o responsável continua quem estava (o celular não tem um).
      const saiuDaJanete = cv.modo === "janete" || !cv.responsavel_id;
      let novo = mudarConversa({ ...estado, mensagens: [...estado.mensagens, m] }, cv.id, {
        modo: "humano",
        motivo_humano: cv.modo === "janete" ? "humano_celular" : cv.motivo_humano,
        aguardando_humano_desde: null,
        ultima_mensagem_em: agora,
        ultima_mensagem_preview: previaDoBanco(m),
        atualizado_em: agora,
      });
      novo = semDigitar(cancelarFilaDaJanete(novo, cv.id), cv.id);
      if (saiuDaJanete) novo = comEvento(novo, { conversa_id: cv.id, tipo: "celular", criado_em: agora });
      return { estado: novo, resultado: { ok: true, id } };
    }

    case "status_mensagem": {
      const m = estado.mensagens.find((x) => x.id === ev.mensagemId);
      if (!m) return recusa(estado, "nao_encontrado");
      // Uma mensagem cancelada não volta à fila sozinha.
      if (m.status === "cancelada") return igual(estado);
      return {
        estado: mudarMensagem(estado, m.id, { status: ev.status, erro: ev.status === "falhou" ? (ev.erro ?? m.erro) : null }),
        resultado: { ok: true },
      };
    }

    case "conexao": {
      // O provedor muda só o status; o número que o admin desconectou não volta sozinho.
      const c = estado.conexao;
      if (!c || !c.ativa) return recusa(estado, "nao_encontrado");
      const conectada = ev.status === "conectada";
      return igual({
        ...estado,
        conexao: {
          ...c,
          status: ev.status,
          ultimo_erro: conectada ? null : (ev.ultimo_erro ?? c.ultimo_erro),
          atualizado_em: agora,
        },
      });
    }

    case "chave": {
      const c = estado.chaves.find((x) => x.finalidade === ev.finalidade);
      if (!c) return recusa(estado, "nao_encontrado");
      return igual({
        ...estado,
        chaves: estado.chaves.map((x) =>
          x.id === c.id ? { ...x, status: ev.status, ultimo_erro: ev.status === "ativa" ? null : (ev.ultimo_erro ?? x.ultimo_erro) } : x,
        ),
      });
    }
  }
}

/* ---------- apoio ---------- */

function conversa(estado: EstadoBase, id: string): Conversa | undefined {
  return estado.conversas.find((c) => c.id === id);
}

function mudarConversa(estado: EstadoBase, id: string, mudanca: Partial<Conversa>): EstadoBase {
  // O `estavaCom` só vale enquanto a conversa espera desde a desativação de alguém: quem mexe no
  // responsável ou na espera sem gravar a marca (assumir, devolver, responder, a Janete, o celular) apaga.
  const apaga = ("responsavel_id" in mudanca || "aguardando_humano_desde" in mudanca) && !("estavaCom" in mudanca);
  return {
    ...estado,
    conversas: estado.conversas.map((c) =>
      c.id === id ? { ...c, ...mudanca, ...(apaga && c.estavaCom ? { estavaCom: null } : {}) } : c,
    ),
  };
}

function mudarMensagem(estado: EstadoBase, id: string, mudanca: Partial<Mensagem>): EstadoBase {
  return { ...estado, mensagens: estado.mensagens.map((m) => (m.id === id ? { ...m, ...mudanca } : m)) };
}

/** Como assumir_conversa e o gatilho de saída humana: o que a Janete tinha na fila é cancelado. */
function cancelarFilaDaJanete(estado: EstadoBase, conversaId: string): EstadoBase {
  const tem = estado.mensagens.some((m) => m.conversa_id === conversaId && m.origem === "janete" && m.status === "na_fila");
  if (!tem) return estado;
  return {
    ...estado,
    mensagens: estado.mensagens.map((m) =>
      m.conversa_id === conversaId && m.origem === "janete" && m.status === "na_fila" ? { ...m, status: "cancelada" } : m,
    ),
  };
}

function semDigitar(estado: EstadoBase, conversaId: string): EstadoBase {
  return estado.digitando.includes(conversaId)
    ? { ...estado, digitando: estado.digitando.filter((x) => x !== conversaId) }
    : estado;
}

/** De onde vem a conversa que `euId` está assumindo (muda o texto do aviso e do cartão). */
function origemDaPassagem(cv: Conversa): OrigemPassagem {
  const s = seloDaConversa(cv);
  if (s === "janete") return "janete";
  if (s === "celular") return "celular";
  // quem já é o responsável não chega aqui (assumir de novo não muda nada)
  if (s === "membro") return "outro";
  return "espera";
}

function comEvento(
  estado: EstadoBase,
  ev: Partial<EventoPassagem> & Pick<EventoPassagem, "conversa_id" | "tipo" | "criado_em">,
): EstadoBase {
  const evento: EventoPassagem = {
    id: novoId(estado, "ev"),
    membro_id: null,
    motivo: null,
    de: null,
    de_membro_id: null,
    por_envio: false,
    ...ev,
  };
  return { ...estado, eventos: [...estado.eventos, evento] };
}

/**
 * Id novo e único no estado: prefixo + o maior número já usado com esse prefixo + 1. Os ids do
 * exemplo inicial têm outro formato ("msg-ricardo-1"), então não colidem.
 */
function novoId(estado: EstadoBase, prefixo: "msg" | "ev" | "hi"): string {
  const lista: readonly { id: string }[] =
    prefixo === "msg" ? estado.mensagens : prefixo === "ev" ? estado.eventos : estado.historico;
  const re = new RegExp(`^${prefixo}-n(\\d+)$`);
  let maior = 0;
  for (const x of lista) {
    const n = re.exec(x.id)?.[1];
    if (n) maior = Math.max(maior, Number(n));
  }
  return `${prefixo}-n${maior + 1}`;
}

function linhaAuditoria(
  estado: EstadoBase,
  extra: number,
  acao: EstadoBase["auditoria"][number]["acao"],
  alvo: string,
  ator: string,
  agora: string,
  detalhe: Record<string, string>,
  ultimos4: string | null = null,
): EstadoBase["auditoria"][number] {
  return { id: estado.auditoria.length + extra, acao, alvo, ator_membro_id: ator, detalhe, ultimos4, criado_em: agora };
}

function auditar(
  estado: EstadoBase,
  acao: EstadoBase["auditoria"][number]["acao"],
  alvo: string,
  ator: string,
  agora: string,
  detalhe: Record<string, string>,
  ultimos4: string | null = null,
): EstadoBase["auditoria"] {
  return [...estado.auditoria, linhaAuditoria(estado, 1, acao, alvo, ator, agora, detalhe, ultimos4)];
}

/* ---------- equipe ---------- */

/** O formato mínimo de um e-mail (x@y.zz), o mesmo da tela da Equipe. */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function convidar(estado: EstadoBase, email: string, papel: PapelMembro, eu: Membro, agora: string): Reduzido {
  if (!ehAdmin(eu)) return recusa(estado, "sem_permissao");
  const limpo = email.trim().toLowerCase();
  if (!RE_EMAIL.test(limpo)) return recusa(estado, "email_invalido");
  const convites = estado.convites ?? [];
  if (estado.membros.some((m) => m.email === limpo) || convites.some((c) => c.email === limpo)) {
    return recusa(estado, "email_em_uso");
  }
  const id = novoIdConvite(convites);
  const convite: Convite = { id, email: limpo, papel, convidado_por: eu.id, enviado_em: agora };
  return { estado: { ...estado, convites: [...convites, convite] }, resultado: { ok: true, id } };
}

/** O membro em que um admin mexe (papel, desativar): existe, está ativo e não é quem mexe. */
function alvoDaEquipe(estado: EstadoBase, membroId: string, eu: Membro): { membro: Membro } | { erro: ErroExemplo } {
  if (!ehAdmin(eu)) return { erro: "sem_permissao" };
  const m = estado.membros.find((x) => x.id === membroId && x.ativo);
  if (!m) return { erro: "nao_encontrado" };
  if (m.id === eu.id) return { erro: "proprio_membro" };
  return { membro: m };
}

/** Ninguém além dele é admin ativo (gatilho membros_ultimo_admin; no exemplo ninguém tem `user_id`). */
function soEleEhAdmin(estado: EstadoBase, membroId: string): boolean {
  return !estado.membros.some((m) => m.id !== membroId && m.ativo && m.papel === "admin");
}

/** Id novo de convite: "cn-n" + o maior número já usado + 1 (o do exemplo é "cn-rodrigo"). */
function novoIdConvite(convites: readonly Convite[]): string {
  let maior = 0;
  for (const c of convites) {
    const n = /^cn-n(\d+)$/.exec(c.id)?.[1];
    if (n) maior = Math.max(maior, Number(n));
  }
  return `cn-n${maior + 1}`;
}

function prender(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
