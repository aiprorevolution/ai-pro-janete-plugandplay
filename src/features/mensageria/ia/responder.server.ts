// Resposta da Janete numa rodada (tarefa F2 da spec da mensageria). O ciclo do worker chama esta
// função para cada rodada que pegar_rodadas devolver. Ela termina a rodada sempre por
// concluir_rodada ou falhar_rodada e grava uma linha de custo por passo em ia_chamadas, mesmo
// quando a rodada falha. Se lançar erro, o ciclo marca a rodada como falha passageira.
// O ciclo passa o prazo absoluto da chamada do worker (fimEm): a IA tem até o menor entre 90 s e
// fimEm - 3 s (abortSignal). Com menos de 10 s para a IA, a rodada falha como passageira logo de
// saída, antes da lida e do "digitando" (o lead não vê "digitando..." seguido de silêncio). Se o
// prazo acabar no meio, a rodada falha como passageira (erro_provedor) e volta no minuto
// seguinte, em vez de ficar presa em "rodando"; o custo dos passos que já terminaram é gravado
// do mesmo jeito. O passo que estava em andamento no abort não grava linha de custo: o AI SDK
// não devolve uso de pedido abortado, e o provedor pode ter cobrado a entrada dele (limite
// conhecido). Se a Janete já passou para humano antes do abort, a rodada é concluída sem bolhas
// (a conversa já está com a equipe; falhar_rodada não faria nada nela). Isso vale também quando o
// abort chega com a ferramenta passar_para_humano em execução: a rodada espera as ferramentas que
// já começaram a gravar no passo interrompido e as põe na auditoria (rodadas.ferramentas).
// Nada do lead, da resposta nem da chave vai para log ou para o texto de um erro.
// Modo fala (docs/spec-voz-uso.md, C1): quando a Janete responde em áudio (deveFalar), as
// instruções ganham o bloco de fala, "responder" recebe { fala, textos? } e a IA cede 6 s do
// prazo (se ainda sobrarem 10 s). A fala vira um áudio no bucket midias (<conversa>/<id>) e o
// concluir_rodada recebe o item de áudio seguido dos textos. Se a fala ou a gravação falhar, a
// resposta vai em texto na hora (bolhasSemFala), sem nova tentativa.
// Áudio sem transcrição (docs/spec-lacunas-mensageria.md, decisão 1): com algo para ler junto, a
// rodada segue normal (o histórico marca "[áudio sem transcrição]"). Só áudio: a Janete pede em
// texto para o lead escrever (bolha fixa, sem o modelo, nunca no modo fala); se a rodada anterior
// dela já pediu e o lead mandou áudio de novo depois de a bolha do pedido sair (decisão 9), sem
// escrever, a conversa vai para a equipe. Áudio ainda pendente (a cópia ou a transcrição vai ser tentada de novo) não é áudio sem
// Escuta: a rodada falha como passageira e volta em 30 s; na 3ª tentativa vai para a equipe.
// Conexão desligada no meio da rodada (decisões 11 e 16): o concluir_rodada que dá
// sem_conexao_ativa é refeito sem respostas; a rodada conclui sem mandar nada e nada vai para a
// equipe, no Desconectar e no Trocar de WhatsApp.
import { generateText, isStepCount, type StepResult, type StopCondition } from "ai";

import { firebaseAdmin } from "@/integrations/firebase/client.server";
import type { Database, Json } from "@/integrations/firebase/types";

import { adaptadorDe } from "../gateways";
import { destinoDoContato, falharRodada } from "../nucleo/banco.server";
import { carregarConexao, conexaoAtiva, type ChaveIA } from "../nucleo/conexoes.server";
import { caminhoMidia, enviarArquivo } from "../nucleo/midia.server";
import type { ConexaoServidor } from "../nucleo/tipos";
import { lerChaveUtilizavel, marcarStatusChave, reativarChave } from "./chaves.server";
import { bolhasSemFala, deveFalar, MAX_TEXTOS_FALA, RESERVA_FALA_MS } from "./fala";
import { falar, lerConfigVoz, vozEmUso } from "./falar.server";
import {
  carregarPrecos,
  custoDoProvedor,
  custoPorTabela,
  gravarChamadas,
  limparUsoBruto,
  normalizarUso,
  type LinhaPreco,
  type NovaChamada,
} from "./custo.server";
import { classificarErroIA } from "./erros";
import {
  criarFerramentas,
  type EtapaJanete,
  type FerramentasJanete,
  type ResultadoFerramenta,
} from "./ferramentas.server";
import { carregarHistorico, montarHistorico } from "./historico.server";
import {
  blocoDoContato,
  linhaDoAgora,
  MAX_BOLHAS,
  montarInstrucoes,
  type ContatoJanete,
  type ContextoJanete,
} from "./instrucoes";
import { criarModelo, opcoesDoProvedor } from "./modelo.server";

export type Rodada = Database["public"]["Tables"]["rodadas"]["Row"];
type Motivo = Database["public"]["Enums"]["motivo_humano"];

export const MAX_PASSOS = 6;
/** Teto do tempo total da IA; com prazo do worker, vale o menor entre este e fimEm - 3 s. */
export const TEMPO_TOTAL_MS = 90_000;
/** Folga antes do fim do prazo do worker, para gravar o custo e o fim da rodada. */
export const FOLGA_PRAZO_IA_MS = 3_000;
/** Mínimo de tempo para a IA (tempoDaIA) para começar a rodada, a lida e o "digitando". */
export const MIN_TEMPO_IA_MS = 10_000;
export const TEMPO_PASSO_MS = 40_000;
export const MAX_REPETICOES = 2;
/** Teto da espera por lida e digitando no fim da rodada (rodam em paralelo com a IA). */
export const TETO_LIDA_DIGITANDO_MS = 3_000;

type Passo = StepResult<FerramentasJanete>;

// ---------------------------------------------------------------------------
// Leitura do banco
// ---------------------------------------------------------------------------

type DadosRodada = {
  conversa: {
    id: string;
    contato_id: string;
    conexao_id: string | null;
    devolvida_em: string | null;
  };
  contato: (ContatoJanete & { etapa_id: string }) | null;
  contexto: ContextoJanete | null;
  etapas: { id: string; chave: string | null; nome: string; janete_pode_mover: boolean }[];
  entradas: {
    id_externo: string | null;
    tipo: string;
    texto: string | null;
    transcricao: string | null;
    midia_status: string | null;
    criado_em: string;
  }[];
};

async function carregarDados(rodada: Rodada): Promise<DadosRodada | null> {
  const conversa = await firebaseAdmin
    .from("conversas")
    .select("id, contato_id, conexao_id, devolvida_em")
    .eq("id", rodada.conversa_id)
    .maybeSingle();
  if (conversa.error) throw new Error("banco_conversa");
  if (!conversa.data) return null;

  const contato = await firebaseAdmin
    .from("contatos")
    .select("nome, nome_whatsapp, telefone, email, empresa, resumo_janete, anotacoes_janete, etapa_id")
    .eq("id", conversa.data.contato_id)
    .maybeSingle();
  if (contato.error) throw new Error("banco_contato");

  const ctx =
    rodada.contexto_versao_id !== null
      ? firebaseAdmin
          .from("contexto_versoes")
          .select("*")
          .eq("id", rodada.contexto_versao_id)
          .maybeSingle()
      : firebaseAdmin
          .from("contexto_versoes")
          .select("*")
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
  const contexto = await ctx;
  if (contexto.error) throw new Error("banco_contexto");

  const etapas = await firebaseAdmin
    .from("etapas")
    .select("id, chave, nome, janete_pode_mover")
    .eq("arquivada", false)
    .order("ordem", { ascending: true });
  if (etapas.error) throw new Error("banco_etapas");

  const entradas = await firebaseAdmin
    .from("mensagens")
    .select("id_externo, tipo, texto, transcricao, midia_status, criado_em")
    .eq("rodada_id", rodada.id)
    .eq("direcao", "entrada")
    // o último id é a entrada mais nova: a Meta marca como lida ela e as anteriores
    .order("momento", { ascending: true })
    .order("id", { ascending: true });
  if (entradas.error) throw new Error("banco_entradas");

  return {
    conversa: conversa.data,
    contato: contato.data ?? null,
    contexto: (contexto.data as ContextoJanete | null) ?? null,
    etapas: etapas.data ?? [],
    entradas: entradas.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// Áudio sem transcrição
// ---------------------------------------------------------------------------

/** A bolha fixa da rodada que é só áudio sem transcrição (sempre em texto). */
export const TEXTO_PEDIR_ESCRITA =
  "Não consigo ouvir áudio por aqui. Pode me escrever a sua mensagem?";

type Entrada = DadosRodada["entradas"][number];

function audioSemTranscricao(e: Entrada): boolean {
  return e.tipo === "audio" && (e.transcricao ?? "").trim() === "";
}

/**
 * Áudio que ainda vai ser baixado ou transcrito: o pegar_rodadas só espera a mídia pendente por
 * 2 min, e a 3ª tentativa dela pode cair depois disso.
 */
function audioPendente(e: Entrada): boolean {
  return audioSemTranscricao(e) && e.midia_status === "pendente";
}

/**
 * A rodada não tem nada que a Janete consiga ler: tem áudio sem transcrição e o resto é só texto
 * vazio. Imagem, documento, texto ou áudio transcrito junto = segue normal.
 */
function soAudioSemTranscricao(entradas: Entrada[]): boolean {
  return (
    entradas.some(audioSemTranscricao) &&
    entradas.every(
      (e) => audioSemTranscricao(e) || (e.tipo === "texto" && (e.texto ?? "").trim() === ""),
    )
  );
}

/** Teto da leitura dos textos do lead depois do pedido (basta um com conteúdo). */
const LIMITE_TEXTOS_DEPOIS = 50;

/** O que fazer com a rodada que é só áudio sem transcrição. */
type DepoisDoPedido =
  /** a Janete não pediu, ou o pedido não vale mais: pede em texto */
  | "pedir"
  /** pediu, e o lead mandou áudio de novo depois de a bolha do pedido sair: vai para a equipe */
  | "insistiu"
  /** pediu, mas os áudios desta rodada chegaram antes de a bolha do pedido sair: não repete a bolha */
  | "antes_do_pedido";

/** Status da bolha que já saiu para o lead (o concluir_envio grava momento = hora da saída). */
const SAIU = new Set(["enviada", "entregue", "lida"]);

/**
 * A rodada que tem a bolha do pedido: a própria rodada do pedir_texto ou, quando ela foi um
 * antes_do_pedido (concluiu sem bolha), a que ela aponta em entrada.pedido_rodada.
 */
function rodadaDaBolha(ferramentas: unknown, rodadaId: string): string | null {
  if (!Array.isArray(ferramentas)) return null;
  const pedido = ferramentas.find((c) => ehObjeto(c) && c["ferramenta"] === "pedir_texto");
  if (!ehObjeto(pedido)) return null;
  const entrada = pedido["entrada"];
  const aponta = ehObjeto(entrada) ? entrada["pedido_rodada"] : undefined;
  return typeof aponta === "string" && aponta !== "" ? aponta : rodadaId;
}

/**
 * Olha a última rodada concluída da Janete nesta conversa. O pedido (pedir_texto) só vale se veio
 * depois da última devolução para a Janete (devolvida_em, que também zera as tentativas no
 * pegar_rodadas), se a bolha dele existe, não foi cancelada nem falhou, e se o lead não mandou
 * texto depois. "Depois" do texto é pelo criado_em da rodada: as entradas que chegaram depois de
 * a rodada ser criada não são dela (pegar_rodadas liga as soltas na criação). Insistir é mandar
 * áudio depois de a bolha do pedido sair (decisão 9): com ela ainda na fila ou enviando, todo
 * áudio é antes_do_pedido; com ela enviada, entregue ou lida, o limite é o momento dela.
 * Devolve também a rodada da bolha, que o antes_do_pedido grava para a rodada seguinte.
 */
async function depoisDoPedido(
  rodada: Rodada,
  dados: DadosRodada,
): Promise<{ situacao: DepoisDoPedido; rodadaDaBolha: string | null }> {
  const pedir = { situacao: "pedir" as const, rodadaDaBolha: null };
  const anterior = await firebaseAdmin
    .from("rodadas")
    .select("id, ferramentas, criado_em, terminada_em")
    .eq("conversa_id", rodada.conversa_id)
    .eq("status", "concluida")
    .neq("id", rodada.id)
    .order("terminada_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (anterior.error) throw new Error("banco_rodadas");
  if (!anterior.data) return pedir;
  const r0 = anterior.data;
  const daBolha = rodadaDaBolha(r0.ferramentas, r0.id);
  if (daBolha === null) return pedir;

  const devolvida = dados.conversa.devolvida_em ?? null;
  if (devolvida !== null && Date.parse(r0.criado_em) <= Date.parse(devolvida)) return pedir;

  // a bolha do pedido que não chegou ao lead: nem foi criada (a rodada concluiu sem mandar),
  // cancelada no concluir_rodada ou falhou no envio
  const bolhas = await firebaseAdmin
    .from("mensagens")
    .select("status, momento")
    .eq("rodada_id", daBolha)
    .eq("direcao", "saida");
  if (bolhas.error) throw new Error("banco_entradas");
  const lista = bolhas.data ?? [];
  if (lista.length === 0 || lista.some((m) => m.status === "cancelada" || m.status === "falhou")) {
    return pedir;
  }

  const textos = await firebaseAdmin
    .from("mensagens")
    .select("texto")
    .eq("conversa_id", rodada.conversa_id)
    .eq("direcao", "entrada")
    .eq("tipo", "texto")
    .neq("status", "cancelada")
    .gt("criado_em", r0.criado_em)
    .limit(LIMITE_TEXTOS_DEPOIS);
  if (textos.error) throw new Error("banco_entradas");
  if ((textos.data ?? []).some((m) => (m.texto ?? "").trim() !== "")) return pedir;

  // a bolha ainda não saiu (na_fila ou enviando): o lead não viu o pedido
  const antes = { situacao: "antes_do_pedido" as const, rodadaDaBolha: daBolha };
  if (!lista.every((m) => SAIU.has(m.status))) return antes;
  const pedidoEm = Math.max(...lista.map((m) => Date.parse(m.momento)));
  return dados.entradas.some((e) => e.tipo === "audio" && Date.parse(e.criado_em) > pedidoEm)
    ? { situacao: "insistiu", rodadaDaBolha: daBolha }
    : antes;
}

// ---------------------------------------------------------------------------
// Lida e digitando (melhor esforço: nunca derruba a rodada)
// ---------------------------------------------------------------------------

/** Espera a promessa até `ms`; depois segue sem ela (ela nunca lança). */
async function esperarComTeto(p: Promise<void>, ms: number): Promise<void> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([p, new Promise<void>((ok) => (relogio = setTimeout(ok, ms)))]);
  } finally {
    if (relogio !== undefined) clearTimeout(relogio);
  }
}

async function marcarLidaEDigitando(d: DadosRodada): Promise<void> {
  try {
    let conexao: ConexaoServidor | null = d.conversa.conexao_id
      ? await carregarConexao(d.conversa.conexao_id)
      : null;
    // conexão desativada fica sem segredos: usa a ativa
    if (!conexao || Object.keys(conexao.segredos).length === 0) conexao = await conexaoAtiva();
    if (!conexao) return;
    const adaptador = adaptadorDe(conexao.gateway);
    if (!adaptador) return;
    const destino = await destinoDoContato(d.conversa.id, conexao.id);
    if (destino.length === 0) return;
    const ids_externos = d.entradas
      .map((e) => e.id_externo)
      .filter((v): v is string => typeof v === "string" && v !== "");
    await adaptador.marcarLidaEDigitando({ destino, ids_externos }, conexao);
  } catch {
    // ignorado de propósito
  }
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

type Chamada = { passo: number; ferramenta: string; entrada: unknown; resultado: unknown };

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Chamadas de ferramenta de todos os passos, para rodadas.ferramentas (auditoria). */
function chamadasDe(passos: Passo[]): Chamada[] {
  const lista: Chamada[] = [];
  passos.forEach((passo, i) => {
    for (const parte of passo.content) {
      if (parte.type === "tool-result") {
        lista.push({
          passo: i + 1,
          ferramenta: parte.toolName,
          entrada: parte.input,
          resultado: parte.output,
        });
      } else if (parte.type === "tool-error") {
        lista.push({
          passo: i + 1,
          ferramenta: parte.toolName,
          entrada: parte.input,
          resultado: { erro: "entrada_invalida" },
        });
      }
    }
  });
  return lista;
}

/** Bolhas da última chamada válida de responder (no máximo 3, sem vazias). */
export function bolhasDaFerramenta(chamadas: Chamada[]): string[] | null {
  for (let i = chamadas.length - 1; i >= 0; i--) {
    const c = chamadas[i];
    if (!c || c.ferramenta !== "responder") continue;
    if (!ehObjeto(c.resultado) || c.resultado["ok"] !== true) continue;
    const bolhas = ehObjeto(c.entrada) ? c.entrada["bolhas"] : null;
    if (!Array.isArray(bolhas)) continue;
    const limpas = bolhas
      .filter((b): b is string => typeof b === "string")
      .map((b) => b.trim())
      .filter((b) => b !== "");
    if (limpas.length > 0) return limpas.slice(0, MAX_BOLHAS);
  }
  return null;
}

/** Fala e textos da última chamada válida de responder no modo fala. null = nenhuma. */
export function falaDaFerramenta(chamadas: Chamada[]): { fala: string; textos: string[] } | null {
  for (let i = chamadas.length - 1; i >= 0; i--) {
    const c = chamadas[i];
    if (!c || c.ferramenta !== "responder") continue;
    if (!ehObjeto(c.resultado) || c.resultado["ok"] !== true) continue;
    if (!ehObjeto(c.entrada)) continue;
    const fala = c.entrada["fala"];
    if (typeof fala !== "string" || fala.trim() === "") continue;
    const brutos = c.entrada["textos"];
    const textos = (Array.isArray(brutos) ? brutos : [])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t !== "")
      .slice(0, MAX_TEXTOS_FALA);
    return { fala: fala.trim(), textos };
  }
  return null;
}

/** Texto final em até 3 bolhas, separadas por linha em branco (o excesso vai na 3ª). */
export function bolhasDoTexto(texto: string): string[] {
  const partes = texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (partes.length <= MAX_BOLHAS) return partes;
  return [...partes.slice(0, MAX_BOLHAS - 1), partes.slice(MAX_BOLHAS - 1).join("\n\n")];
}

/** Ferramenta que começou a gravar num passo que ainda não terminou (onStepEnd). */
type Execucao = { ferramenta: string; entrada: unknown; resultado: Promise<ResultadoFerramenta> };

/** Espera as execuções do passo interrompido e as devolve como chamadas do passo seguinte. */
async function chamadasEmAndamento(execucoes: Execucao[], passo: number): Promise<Chamada[]> {
  return Promise.all(
    execucoes.map(async (e) => ({
      passo,
      ferramenta: e.ferramenta,
      entrada: e.entrada,
      resultado: await e.resultado.catch(() => ({ erro: "erro_banco" })),
    })),
  );
}

function passouParaHumano(chamadas: Chamada[]): boolean {
  return chamadas.some(
    (c) =>
      c.ferramenta === "passar_para_humano" && ehObjeto(c.resultado) && c.resultado["ok"] === true,
  );
}

/** Para quando o último passo tem um responder aceito (entrada válida e executada). */
const respondeu: StopCondition<FerramentasJanete> = ({ steps }) =>
  steps.at(-1)?.content.some((p) => p.type === "tool-result" && p.toolName === "responder") ??
  false;

// ---------------------------------------------------------------------------
// Custo
// ---------------------------------------------------------------------------

function idDoPedido(passo: Passo): string | null {
  const h = passo.response.headers ?? {};
  return h["request-id"] ?? h["x-request-id"] ?? (passo.response.id || null);
}

/**
 * Custo do passo na OpenRouter: usage.cost (o que ela cobrou em créditos) mais, com chave
 * própria do provedor (BYOK), o custo upstream, que o provedor cobra direto e que não está no
 * usage.cost.
 */
export function custoDoOpenRouter(passo: Pick<Passo, "providerMetadata">): unknown {
  const meta = passo.providerMetadata?.["openrouter"];
  const uso = ehObjeto(meta) ? meta["usage"] : null;
  if (!ehObjeto(uso)) return undefined;
  const custo = uso["cost"];
  const detalhes = uso["costDetails"];
  const upstream = ehObjeto(detalhes) ? detalhes["upstreamInferenceCost"] : undefined;
  if (typeof upstream === "number" && Number.isFinite(upstream) && upstream > 0) {
    return (
      (typeof custo === "number" && Number.isFinite(custo) && custo > 0 ? custo : 0) + upstream
    );
  }
  return custo;
}

function linhasDeCusto(
  rodadaId: string,
  chave: ChaveIA,
  passos: Passo[],
  precos: LinhaPreco[],
): NovaChamada[] {
  return passos.map((passo, i) => {
    const uso = normalizarUso(passo.usage);
    const custo =
      chave.provedor === "openrouter"
        ? custoDoProvedor(custoDoOpenRouter(passo))
        : custoPorTabela(precos, uso, passo.usage.raw);
    return {
      rodada_id: rodadaId,
      tipo: "resposta",
      provedor: chave.provedor,
      modelo: chave.modelo,
      passo: i + 1,
      tokens_entrada: uso.entrada,
      tokens_cache_leitura: uso.cacheLeitura,
      tokens_cache_escrita: uso.cacheEscrita,
      tokens_saida: uso.saida,
      tokens_raciocinio: uso.raciocinio,
      custo_usd: custo.custo_usd,
      custo_origem: custo.custo_origem,
      preco_id: custo.preco_id,
      request_id: idDoPedido(passo),
      uso_bruto: limparUsoBruto(passo.usage.raw ?? null),
    };
  });
}

async function registrarCusto(rodadaId: string, chave: ChaveIA, passos: Passo[]): Promise<void> {
  if (passos.length === 0) return;
  try {
    const precos =
      chave.provedor === "openrouter" ? [] : await carregarPrecos(chave.provedor, chave.modelo);
    await gravarChamadas(linhasDeCusto(rodadaId, chave, passos, precos));
  } catch {
    // custo é registro; não derruba a rodada
  }
}

// ---------------------------------------------------------------------------
// Fim da rodada
// ---------------------------------------------------------------------------

/** O áudio da Janete, no formato do item de áudio do concluir_rodada (migration 0014). */
export type RespostaAudio = {
  tipo: "audio";
  id: string;
  transcricao: string;
  midia_caminho: string;
  midia_mime: string;
  midia_tamanho: number;
  midia_duracao_s: number | null;
};
export type RespostaRodada = { texto: string } | RespostaAudio;

async function concluir(
  rodadaId: string,
  respostas: RespostaRodada[],
  chamadas: Chamada[],
  passos: number,
): Promise<void> {
  const chamar = (itens: RespostaRodada[]) =>
    firebaseAdmin.rpc("concluir_rodada", {
      p_rodada: rodadaId,
      // os itens de texto nunca levam "tipo" (o concluir_rodada trata como texto)
      p_respostas: itens.map((r) => ("tipo" in r ? r : { texto: r.texto })) as Json,
      p_ferramentas: chamadas as unknown as Json,
      p_passos: passos,
    });
  const { error } = await chamar(respostas);
  if (!error) return;
  // conexão desligada no meio da rodada (decisões 11 e 16): conclui sem mandar nada (sem
  // respostas, o gatilho do insert não roda) e nada vai para a equipe, também no Trocar de
  // WhatsApp, que para a fila da antiga em silêncio. Se a conclusão vazia falhar, segue como antes
  if (error.message === "sem_conexao_ativa" && respostas.length > 0) {
    const vazia = await chamar([]);
    if (!vazia.error) return;
  }
  // gatilho do insert: não adianta repetir (comentário de concluir_rodada na migration 0002)
  if (error.message === "sem_conexao_ativa" || error.message === "janela_fechada") {
    await falharRodada(rodadaId, "erro_provedor", false);
    return;
  }
  throw new Error("banco_concluir_rodada");
}

async function falhar(rodadaId: string, motivo: Motivo, passageiro: boolean): Promise<void> {
  await falharRodada(rodadaId, motivo, passageiro);
}

// ---------------------------------------------------------------------------
// Rodada
// ---------------------------------------------------------------------------

export type OpcoesRodada = {
  /** Prazo absoluto da chamada do worker (Date.now()), vindo do ciclo. */
  fimEm?: number;
  /** Relógio da linha "Agora:" (ms desde 1970); sem ele, Date.now(). Os testes fixam a hora. */
  agora?: number;
};

/**
 * Tempo total da IA: o teto de 90 s, cortado pelo prazo do worker menos 3 s. No modo fala, a IA
 * cede 6 s para a fala caber no prazo, se ainda sobrarem 10 s; senão fica com o tempo de hoje.
 */
export function tempoDaIA(fimEm: number | undefined, modoFala = false): number {
  const base =
    fimEm === undefined || !Number.isFinite(fimEm)
      ? TEMPO_TOTAL_MS
      : Math.min(TEMPO_TOTAL_MS, fimEm - Date.now() - FOLGA_PRAZO_IA_MS);
  if (modoFala && base - RESERVA_FALA_MS >= MIN_TEMPO_IA_MS) return base - RESERVA_FALA_MS;
  return base;
}

/** Folga entre o fim da fala e o prazo do worker, para gravar o áudio e concluir a rodada. */
export const FOLGA_FALA_MS = 2_000;

/** A gravação do áudio no bucket termina até 1 s antes do prazo do worker, ou a resposta vai em texto. */
const TETO_GRAVACAO_ANTES_DO_FIM_MS = 1_000;

/** Bolhas de texto no formato de concluir. */
function emTexto(bolhas: string[]): RespostaRodada[] {
  return bolhas.map((texto) => ({ texto }));
}

/**
 * Se esta rodada responde em áudio, a voz escolhida; senão null. Erro na leitura = texto (a
 * fala nunca derruba a rodada).
 */
async function vozDaRodada(dados: DadosRodada): Promise<string | null> {
  try {
    const [config, emUso] = await Promise.all([lerConfigVoz(), vozEmUso()]);
    const sim = deveFalar({
      modo: config.modo,
      vozId: config.vozId,
      chaveEmUso: emUso,
      entradas: dados.entradas,
    });
    return sim ? config.vozId : null;
  } catch {
    return null;
  }
}

/**
 * Transforma a fala em áudio e o grava no bucket. Devolve as respostas da rodada: o áudio
 * seguido dos textos ou, se a fala ou a gravação falhar, tudo em texto (bolhasSemFala).
 */
async function respostasComFala(
  rodada: Rodada,
  vozId: string,
  fala: string,
  textos: string[],
  fimEm: number | undefined,
): Promise<RespostaRodada[]> {
  const emBolhas = () => emTexto(bolhasSemFala(fala, textos, MAX_BOLHAS));
  const r = await falar(fala, {
    vozId,
    rodadaId: rodada.id,
    conversaId: rodada.conversa_id,
    ...(fimEm === undefined ? {} : { fimEm: fimEm - FOLGA_FALA_MS }),
  });
  if (!r.ok) return emBolhas();
  const id = crypto.randomUUID();
  let caminho: string;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    caminho = caminhoMidia(rodada.conversa_id, id);
    const envio = enviarArquivo(caminho, r.bytes, r.mime);
    if (fimEm === undefined) {
      await envio;
    } else {
      // teto da gravação: o concluir tem de caber antes do corte do worker. Estourou, a resposta
      // vai em texto; o arquivo que ainda chegar fica órfão no bucket (limite aceito na P5)
      envio.catch(() => undefined);
      const teto = Math.max(0, fimEm - TETO_GRAVACAO_ANTES_DO_FIM_MS - Date.now());
      const gravou = await Promise.race([
        envio.then(() => true),
        new Promise<boolean>((ok) => (relogio = setTimeout(() => ok(false), teto))),
      ]);
      if (!gravou) return emBolhas();
    }
  } catch {
    // o arquivo não ficou no bucket: a resposta vai em texto
    return emBolhas();
  } finally {
    if (relogio !== undefined) clearTimeout(relogio);
  }
  const audio: RespostaAudio = {
    tipo: "audio",
    id,
    transcricao: fala,
    midia_caminho: caminho,
    midia_mime: r.mime,
    midia_tamanho: r.bytes.byteLength,
    midia_duracao_s: r.duracaoS,
  };
  return [audio, ...emTexto(textos)];
}

export async function responderRodada(rodada: Rodada, opcoes: OpcoesRodada = {}): Promise<void> {
  // 1. Dados e chave
  const dados = await carregarDados(rodada);
  if (!dados) {
    await falhar(rodada.id, "erro_provedor", false);
    return;
  }

  const lida = await lerChaveUtilizavel("resposta");
  if (!lida.ok) {
    if (lida.motivo === "cifra_invalida" && lida.id) {
      await marcarStatusChave(lida.id, "invalida", "cifra_invalida");
    }
    await falhar(rodada.id, "chave_invalida", false);
    return;
  }
  const chave = lida.chave;

  // 2. Só áudio sem transcrição: a Janete pede em texto para o lead escrever (a lida e o
  // "digitando" como numa resposta normal, sem o modelo e sem custo de IA). Se ela já pediu na
  // rodada anterior e o lead mandou áudio de novo depois do pedido, sem escrever, vai para a
  // equipe (sem "digitando"). Áudio que chegou antes de a bolha do pedido sair não é insistência:
  // conclui sem bolha nova e grava o pedir_texto de novo, apontando a rodada da bolha
  // (pedido_rodada), para o próximo áudio depois da saída dela ir para a equipe.
  if (soAudioSemTranscricao(dados.entradas)) {
    // a transcrição ainda pode chegar: volta em 30 s (religa as entradas) em vez de pedir
    if (dados.entradas.some(audioPendente)) {
      await falhar(rodada.id, "audio_sem_transcricao", true);
      return;
    }
    const { situacao, rodadaDaBolha: daBolha } = await depoisDoPedido(rodada, dados);
    if (situacao === "insistiu") {
      await falhar(rodada.id, "audio_sem_transcricao", false);
      return;
    }
    const pedido: Chamada = {
      passo: 0,
      ferramenta: "pedir_texto",
      entrada: { motivo: "audio_sem_transcricao" },
      resultado: null,
    };
    if (situacao === "antes_do_pedido") {
      const apontado: Chamada = {
        ...pedido,
        entrada: { motivo: "audio_sem_transcricao", pedido_rodada: daBolha },
      };
      await concluir(rodada.id, [], [apontado], 0);
      return;
    }
    const lidaDigitando = marcarLidaEDigitando(dados);
    try {
      await concluir(rodada.id, emTexto([TEXTO_PEDIR_ESCRITA]), [pedido], 0);
    } finally {
      await esperarComTeto(lidaDigitando, TETO_LIDA_DIGITANDO_MS);
    }
    return;
  }

  // Prazo: com menos de 10 s para a IA, volta no minuto seguinte sem marcar lida nem mostrar
  // "digitando" e sem montar o histórico.
  if (tempoDaIA(opcoes.fimEm) < MIN_TEMPO_IA_MS) {
    await falhar(rodada.id, "erro_provedor", true);
    return;
  }

  // Modo fala: a voz escolhida, se esta rodada responde em áudio (senão, texto como sempre)
  const vozId = await vozDaRodada(dados);

  // 3. Lida e digitando: começa agora, em paralelo com a IA (sem esperar antes de chamá-la), e
  // só é esperado no fim, com teto de 3 s (o gateway pode segurar o pedido por segundos).
  const lidaDigitando = marcarLidaEDigitando(dados);
  try {
    await responderComIA(rodada, dados, lida, chave, opcoes, vozId);
  } finally {
    await esperarComTeto(lidaDigitando, TETO_LIDA_DIGITANDO_MS);
  }
}

async function responderComIA(
  rodada: Rodada,
  dados: DadosRodada,
  lida: Extract<Awaited<ReturnType<typeof lerChaveUtilizavel>>, { ok: true }>,
  chave: ChaveIA,
  opcoes: OpcoesRodada,
  vozId: string | null,
): Promise<void> {
  const { fimEm } = opcoes;
  const agora = opcoes.agora ?? Date.now();
  const modoFala = vozId !== null;
  // 4. Instruções (só regras, Contexto e etapas; no modo fala, o bloco de fala no fim) e
  // histórico (com os dados do contato no fim)
  const permitidas: EtapaJanete[] = dados.etapas
    .filter((e) => e.janete_pode_mover)
    .map((e) => ({ id: e.id, chave: e.chave ?? e.id, nome: e.nome }));
  const etapaAtual = dados.etapas.find((e) => e.id === dados.contato?.etapa_id)?.nome ?? null;
  const instructions = montarInstrucoes({
    contexto: dados.contexto,
    etapasPermitidas: permitidas.map(({ chave: c, nome }) => ({ chave: c, nome })),
    falar: modoFala,
  });
  const mensagens = await montarHistorico(await carregarHistorico(rodada.conversa_id, rodada.id), {
    // a data e a hora vão aqui, no fim, e não nas instruções: o começo do pedido fica igual
    dadosContato: `${linhaDoAgora(agora)}\n${blocoDoContato(dados.contato, etapaAtual)}`,
    rodadaId: rodada.id,
  });

  // 5. Modelo e laço de ferramentas
  let modelo;
  try {
    modelo = criarModelo(chave);
  } catch {
    await falhar(rodada.id, "chave_invalida", false);
    return;
  }

  // Prazo: sem tempo para a IA, a rodada volta no minuto seguinte sem chamar o modelo.
  const tempoTotal = tempoDaIA(fimEm, modoFala);
  if (tempoTotal <= 0) {
    await falhar(rodada.id, "erro_provedor", true);
    return;
  }
  const prazo = new AbortController();
  const relogio = setTimeout(() => prazo.abort(), tempoTotal);

  const passos: Passo[] = [];
  // execuções do passo em andamento; o fim do passo (onStepEnd) já as traz em passo.content
  let emAndamento: Execucao[] = [];
  let resultado: Awaited<ReturnType<typeof generateText<FerramentasJanete>>>;
  try {
    resultado = await generateText({
      model: modelo,
      instructions,
      messages: mensagens,
      tools: criarFerramentas({
        rodadaId: rodada.id,
        etapas: permitidas,
        falar: modoFala,
        aoExecutar: (ferramenta, entrada, r) => {
          emAndamento.push({ ferramenta, entrada, resultado: r });
        },
      }),
      stopWhen: [isStepCount(MAX_PASSOS), respondeu],
      toolCallConcurrency: 1,
      // o tempo total é o do abortSignal (prazo); o de cada passo continua 40 s
      abortSignal: prazo.signal,
      timeout: { stepMs: TEMPO_PASSO_MS },
      maxRetries: MAX_REPETICOES,
      providerOptions: opcoesDoProvedor(chave.provedor),
      onStepEnd: (passo) => {
        passos.push(passo);
        emAndamento = [];
      },
    });
  } catch (erro) {
    // 6. Custo do que já rodou, mesmo com a rodada falhando
    await registrarCusto(rodada.id, chave, passos);
    const abortou = prazo.signal.aborted;
    // 8. Erros do provedor (o prazo é do worker, não do provedor: não marca a chave)
    // a chave de resposta nunca é da ElevenLabs (checks da 0012), mas o tipo do banco não sabe disso
    const provedorErro = chave.provedor === "elevenlabs" ? undefined : chave.provedor;
    const classe = abortou ? null : classificarErroIA(erro, provedorErro);
    if (classe?.statusChave) await marcarStatusChave(chave.id, classe.statusChave, classe.codigo);
    // Já passou para humano (janete_passar_para_humano gravou modo = 'humano'): falhar_rodada não
    // mexeria na conversa e a auditoria se perderia. Conclui sem bolhas, como "passou sem se
    // despedir". O abort pode chegar com uma ferramenta gravando (o pedido ao banco segue até o
    // fim): espera por ela e a junta à auditoria, como chamada do passo interrompido.
    const chamadas = [
      ...chamadasDe(passos),
      ...(await chamadasEmAndamento(emAndamento, passos.length + 1)),
    ];
    if (passouParaHumano(chamadas)) {
      await concluir(rodada.id, [], chamadas, passos.length);
      return;
    }
    // Prazo esgotado: falha passageira, a conversa volta no minuto seguinte
    if (!classe) {
      await falhar(rodada.id, "erro_provedor", true);
      return;
    }
    await falhar(rodada.id, classe.motivo, classe.passageiro);
    return;
  } finally {
    clearTimeout(relogio);
  }

  const todos = resultado.steps.length > 0 ? resultado.steps : passos;
  await registrarCusto(rodada.id, chave, todos);
  // a chamada deu certo: o saldo voltou
  if (lida.status === "sem_credito") await reativarChave(chave.id);

  // 7. Fim
  const chamadas = chamadasDe(todos);
  // modo fala: a fala vira áudio (ou texto, se a fala falhar), os textos vão depois
  const daFala = vozId !== null ? falaDaFerramenta(chamadas) : null;
  if (vozId !== null && daFala) {
    const respostas = await respostasComFala(rodada, vozId, daFala.fala, daFala.textos, fimEm);
    await concluir(rodada.id, respostas, chamadas, todos.length);
    return;
  }
  const daFerramenta = bolhasDaFerramenta(chamadas);
  if (daFerramenta) {
    await concluir(rodada.id, emTexto(daFerramenta), chamadas, todos.length);
    return;
  }
  const ultimo = todos.at(-1);
  const terminou = ultimo !== undefined && ultimo.toolCalls.length === 0;
  const doTexto = terminou ? bolhasDoTexto(ultimo.text) : [];
  if (doTexto.length > 0) {
    await concluir(rodada.id, emTexto(doTexto), chamadas, todos.length);
    return;
  }
  if (passouParaHumano(chamadas)) {
    // passou sem se despedir: conclui sem bolhas (a conversa já está com a equipe)
    await concluir(rodada.id, [], chamadas, todos.length);
    return;
  }
  if (todos.length >= MAX_PASSOS) {
    await falhar(rodada.id, "limite_passos", false);
    return;
  }
  // terminou sem nada para dizer: tenta de novo
  await falhar(rodada.id, "erro_provedor", true);
}
