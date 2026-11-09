import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { resumoMensagem } from "../comum/LinhaConversa";
import { useExemplo } from "../exemplo/ProvedorExemplo";
import { conversasPorRecencia, seloDaConversa, ultimaMensagem } from "../exemplo/regras";
import type { Conversa, EstadoExemplo } from "../exemplo/tipos";
import { CHAVES } from "./chaves";
import { COLUNAS_CONTATO, COLUNAS_CONVERSA, COLUNAS_MENSAGEM, type ClienteFirebase } from "./colunas";
import { lerAnotacoesJanete, opcoesConversa } from "./conversa";
import { traduzirErro } from "./erros";
import { paraLeitura, pronta } from "./leitura";
import { repetirSoFalha } from "./leituras";
import { useClienteDados, useDados, useModoDados } from "./ProvedorDados";
import type { ContatoDados, ConversaDados, Leitura, MensagemDados } from "./tipos";

// As leituras próprias do Chat (spec 2.1, "As leituras de cada área"; task C1): a lista de conversas
// paginada, com o contato e a última mensagem embutidos, os 6 filtros e os contadores. A conversa
// aberta, as mensagens, os eventos, o histórico, o contato e o custo vêm de dados/conversa.ts.
//
// Igual nos dois modos: no banco, React Query sobre o cliente do navegador (sob RLS, colunas
// listadas, chaves embaixo de CHAVES.conversas, que o tempo real e as ações invalidam pelo
// POR_TABELA: conversas, mensagens, contatos e etapas); no exemplo, as mesmas formas saem do estado em
// memória (os testes). O modo não muda durante a vida do provedor: cada hook escolhe a implementação
// uma vez por modo.

/** Os 6 filtros da lista do Chat. */
export type FiltroChat = "todas" | "aguardando" | "nao_lidas" | "comigo" | "equipe" | "janete";

export const FILTROS_CHAT: readonly FiltroChat[] = ["todas", "aguardando", "nao_lidas", "comigo", "equipe", "janete"];

/** Quantas conversas cada página da lista traz. */
export const TAMANHO_PAGINA_CHAT = 50;

/** Quanto a busca espera depois da última tecla para ir ao banco (no exemplo, filtra na hora). */
export const ESPERA_BUSCA_MS = 300;

/** Quanto tempo uma leitura da lista vale antes de ser relida ao montar outra tela (o tempo real invalida antes). */
const VALE_MS = 15_000;

/** Uma linha da lista: a conversa, o contato e a última mensagem (a de `ultima_mensagem_id`; nula = nenhuma). */
export interface LinhaChatDados {
  conversa: ConversaDados;
  contato: ContatoDados;
  ultima: MensagemDados | null;
}

export interface LeituraListaChat extends Leitura<LinhaChatDados[]> {
  /** Há mais conversas depois da última página lida. */
  temMais: boolean;
  /** Busca a próxima página (não faz nada sem `temMais` ou enquanto busca). */
  carregarMais: () => void;
  carregandoMais: boolean;
}

/** Quantas conversas há em cada filtro (sem a busca). "Precisam de você" sai do `useAguardando`. */
export type ContadoresChat = Readonly<Record<FiltroChat, number>>;

/* ---------- regras (os dois modos) ---------- */

/** O filtro da lista, pela mesma regra que o banco aplica em `aplicarFiltro`. */
export function passaNoFiltroChat(
  filtro: FiltroChat,
  c: Pick<Conversa, "modo" | "responsavel_id" | "motivo_humano" | "aguardando_humano_desde" | "nao_lidas">,
  euId: string,
): boolean {
  switch (filtro) {
    case "aguardando": {
      const selo = seloDaConversa(c);
      return selo === "aguardando" || selo === "falha";
    }
    case "nao_lidas":
      return c.nao_lidas > 0;
    case "comigo":
      return c.modo === "humano" && c.responsavel_id === euId;
    case "equipe": {
      const selo = seloDaConversa(c);
      return selo === "membro" || selo === "celular";
    }
    case "janete":
      return c.modo === "janete";
    default:
      return true;
  }
}

/** Minúsculas, sem acento e com os espaços juntos (o mesmo `texto_busca` do banco). */
export function normalizarBuscaChat(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- modo banco ---------- */

/** As colunas da linha: a conversa, o contato e a última mensagem, embutidos pelas chaves estrangeiras. */
export const SELECT_LINHA_CHAT =
  `${COLUNAS_CONVERSA}, contato:contatos!conversas_contato_id_fkey(${COLUNAS_CONTATO}), ultima:mensagens!conversas_ultima_mensagem_id_fkey(${COLUNAS_MENSAGEM})` as const;

/** Os filtros do PostgREST que o construtor de consulta usa (o mínimo, para os testes passarem um falso). */
interface FiltravelChat<Q> {
  eq(coluna: string, valor: unknown): Q;
  is(coluna: string, valor: null): Q;
  not(coluna: string, operador: string, valor: unknown): Q;
  gt(coluna: string, valor: unknown): Q;
  or(filtros: string): Q;
}

/** Aplica o filtro na consulta de `conversas`: a mesma regra de `passaNoFiltroChat`. */
export function aplicarFiltro<Q extends FiltravelChat<Q>>(q: Q, filtro: FiltroChat, euId: string): Q {
  switch (filtro) {
    case "aguardando":
      return q.eq("modo", "humano").is("responsavel_id", null).not("aguardando_humano_desde", "is", null);
    case "nao_lidas":
      return q.gt("nao_lidas", 0);
    case "comigo":
      return q.eq("modo", "humano").eq("responsavel_id", euId);
    case "equipe":
      return q.eq("modo", "humano").or("responsavel_id.not.is.null,aguardando_humano_desde.is.null");
    case "janete":
      return q.eq("modo", "janete");
    default:
      return q;
  }
}

type LinhaCrua = Record<string, unknown> & { contato?: unknown; ultima?: unknown };

/** A linha do PostgREST (com `contato` e `ultima` embutidos) no formato da tela. Sem contato, sai. */
export function linhaDoBanco(crua: LinhaCrua): LinhaChatDados | null {
  const { contato: c, ultima: u, ...conversa } = crua;
  const contato = Array.isArray(c) ? c[0] : c;
  if (!contato || typeof contato !== "object") return null;
  const ultima = Array.isArray(u) ? u[0] : u;
  const ct = contato as ContatoDados;
  const { fatos, proximoPasso } = lerAnotacoesJanete(ct.anotacoes_janete);
  let msg: MensagemDados | null = null;
  if (ultima && typeof ultima === "object") {
    const m = ultima as MensagemDados;
    // As duas formas da duração e da citação, como as mensagens de dados/conversa.ts.
    msg = { ...m, citaId: m.responde_a_id ?? null, duracaoS: m.midia_duracao_s ?? null };
  }
  return {
    conversa: conversa as unknown as ConversaDados,
    contato: { ...ct, fatosJanete: fatos, proximoPasso },
    ultima: msg,
  };
}

function linhasDoBanco(dados: unknown): LinhaChatDados[] {
  if (!Array.isArray(dados)) return [];
  const linhas: LinhaChatDados[] = [];
  for (const crua of dados) {
    const l = crua && typeof crua === "object" ? linhaDoBanco(crua as LinhaCrua) : null;
    if (l) linhas.push(l);
  }
  return linhas;
}

/** A consulta da lista, já com a ordem do Chat (a mensagem mais recente primeiro, depois a criação e o id). */
function consultaLista(cliente: ClienteFirebase, filtro: FiltroChat, euId: string) {
  const base = cliente.from("conversas").select(SELECT_LINHA_CHAT);
  return aplicarFiltro(base as never as FiltravelChat<typeof base> & typeof base, filtro, euId)
    .order("ultima_mensagem_em", { ascending: false, nullsFirst: false })
    .order("criado_em", { ascending: false })
    .order("id", { ascending: false });
}

/** A lista sem busca: páginas de 50, por deslocamento. A conversa repetida entre páginas sai pelo id. */
export function opcoesListaChat(cliente: ClienteFirebase, filtro: FiltroChat, euId: string) {
  return infiniteQueryOptions({
    queryKey: [...CHAVES.conversas, "chat", "lista", filtro, euId] as const,
    queryFn: async ({ pageParam }): Promise<LinhaChatDados[]> => {
      const { data, error } = await consultaLista(cliente, filtro, euId).range(
        pageParam,
        pageParam + TAMANHO_PAGINA_CHAT - 1,
      );
      if (error) throw error;
      return linhasDoBanco(data);
    },
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) =>
      ultima.length < TAMANHO_PAGINA_CHAT ? undefined : todas.reduce((n, p) => n + p.length, 0),
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/**
 * A lista com busca: a busca do servidor (`buscar_quadro`, até 50 contatos: nome, empresa, nome no
 * WhatsApp e o texto e a transcrição das mensagens, sem acento) e, desses, as conversas do filtro.
 */
export function opcoesBuscaChat(cliente: ClienteFirebase, filtro: FiltroChat, euId: string, q: string) {
  return queryOptions({
    queryKey: [...CHAVES.conversas, "chat", "busca", filtro, euId, q] as const,
    queryFn: async (): Promise<LinhaChatDados[]> => {
      const { data: ids, error: erroBusca } = await cliente.rpc("buscar_quadro", { p_q: q });
      if (erroBusca) throw erroBusca;
      const contatos = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string");
      if (!contatos.length) return [];
      const { data, error } = await consultaLista(cliente, filtro, euId).in("contato_id", contatos);
      if (error) throw error;
      return linhasDoBanco(data);
    },
    enabled: q.length > 0,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** Uma linha só (a conversa fixada na lista depois que saiu do filtro). */
export function opcoesLinhaChat(cliente: ClienteFirebase, id: string) {
  return queryOptions({
    queryKey: [...CHAVES.conversas, "chat", "uma", id] as const,
    queryFn: async (): Promise<LinhaChatDados | null> => {
      const { data, error } = await cliente.from("conversas").select(SELECT_LINHA_CHAT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? linhaDoBanco(data as unknown as LinhaCrua) : null;
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** Os contadores dos filtros (menos "Precisam de você", que é o `useAguardando`), por contagem no banco. */
export function opcoesContadoresChat(cliente: ClienteFirebase, euId: string) {
  return queryOptions({
    queryKey: [...CHAVES.conversas, "chat", "contadores", euId] as const,
    queryFn: async (): Promise<Omit<ContadoresChat, "aguardando">> => {
      const contar = async (filtro: FiltroChat): Promise<number> => {
        const base = cliente.from("conversas").select("id", { count: "exact", head: true });
        const { count, error } = await aplicarFiltro(base as never as FiltravelChat<typeof base> & typeof base, filtro, euId);
        if (error) throw error;
        return count ?? 0;
      };
      const [todas, nao_lidas, comigo, equipe, janete] = await Promise.all(
        (["todas", "nao_lidas", "comigo", "equipe", "janete"] as const).map(contar),
      );
      return { todas: todas!, nao_lidas: nao_lidas!, comigo: comigo!, equipe: equipe!, janete: janete! };
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** O valor que só muda depois de `ms` sem mudar (a busca não vai ao banco a cada tecla). */
function useAtrasado(valor: string, ms: number, ligado: boolean): string {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    if (!ligado) return;
    if (!valor) {
      setAtrasado("");
      return;
    }
    const t = window.setTimeout(() => setAtrasado(valor), ms);
    return () => window.clearTimeout(t);
  }, [valor, ms, ligado]);
  return ligado ? atrasado : valor;
}

function useListaBanco(filtro: FiltroChat, busca: string): LeituraListaChat {
  const cliente = useClienteDados()!;
  const euId = useDados().useEu().membro.id;
  const qDigitado = normalizarBuscaChat(busca);
  const q = useAtrasado(qDigitado, ESPERA_BUSCA_MS, true);
  const comBusca = qDigitado.length > 0;

  const lista = useInfiniteQuery({ ...opcoesListaChat(cliente, filtro, euId), enabled: !comBusca });
  const achadas = useQuery(opcoesBuscaChat(cliente, filtro, euId, q));
  const paginas = lista.data?.pages;
  const juntas = useMemo(() => {
    if (!paginas) return undefined;
    const vistas = new Set<string>();
    const linhas: LinhaChatDados[] = [];
    for (const p of paginas) {
      for (const l of p) {
        if (vistas.has(l.conversa.id)) continue;
        vistas.add(l.conversa.id);
        linhas.push(l);
      }
    }
    return linhas;
  }, [paginas]);

  if (comBusca) {
    // Enquanto a busca espera a última tecla, mostra "carregando" (a lista de antes não vale para o termo novo).
    const esperando = q !== qDigitado;
    const leitura = paraLeitura(achadas);
    return {
      ...leitura,
      dados: esperando ? undefined : leitura.dados,
      carregando: esperando || leitura.carregando,
      erro: esperando ? null : leitura.erro,
      temMais: false,
      carregarMais: () => {},
      carregandoMais: false,
    };
  }
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = lista;
  return {
    dados: juntas,
    carregando: lista.isPending,
    erro: lista.error ? traduzirErro(lista.error).erro : null,
    tentarDeNovo: () => void lista.refetch(),
    temMais: hasNextPage,
    carregandoMais: isFetchingNextPage,
    carregarMais: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
  };
}

function useLinhaBanco(id: string | null | undefined): Leitura<LinhaChatDados | null> {
  const cliente = useClienteDados()!;
  const q = useQuery({ ...opcoesLinhaChat(cliente, id ?? ""), enabled: !!id });
  const nula = useMemo(() => pronta<LinhaChatDados | null>(null), []);
  const leitura = paraLeitura(q);
  return id ? leitura : nula;
}

function useContadoresBanco(): Leitura<ContadoresChat> {
  const cliente = useClienteDados()!;
  const dados = useDados();
  const euId = dados.useEu().membro.id;
  const aguardando = dados.useAguardando();
  const q = useQuery(opcoesContadoresChat(cliente, euId));
  const contagem = q.data;
  const nAguardando = aguardando.dados?.length;
  const valor = useMemo<ContadoresChat | undefined>(
    () => (contagem && nAguardando !== undefined ? { ...contagem, aguardando: nAguardando } : undefined),
    [contagem, nAguardando],
  );
  const erroQ = q.error ? traduzirErro(q.error).erro : null;
  return {
    dados: valor,
    carregando: q.isPending || aguardando.carregando,
    erro: erroQ ?? aguardando.erro,
    tentarDeNovo: () => {
      void q.refetch();
      aguardando.tentarDeNovo();
    },
  };
}

function useBuscarBanco(): BuscarConversaChat {
  const cliente = useClienteDados()!;
  const queryClient = useQueryClient();
  return useCallback(
    async (id: string) => {
      try {
        return await queryClient.fetchQuery(opcoesConversa(cliente, id));
      } catch {
        // A leitura falhou (rede), o que não quer dizer que a conversa não existe: ela abre pelo id, e
        // a Conversa mostra o próprio erro, com "Tentar de novo" (como o ?contato= dos Contatos). Só a
        // leitura que volta vazia (apagada, ou a RLS esconde) é "não achamos essa conversa".
        return { id };
      }
    },
    [cliente, queryClient],
  );
}

/* ---------- modo exemplo ---------- */

/** O texto em que a busca do exemplo procura: nome, nome no WhatsApp, empresa e a última mensagem. */
function textoDaBuscaExemplo(estado: EstadoExemplo, c: Conversa): string {
  const contato = estado.contatos.find((x) => x.id === c.contato_id);
  const ultima = ultimaMensagem(estado, c.id);
  return normalizarBuscaChat(
    [contato?.nome, contato?.nome_whatsapp, contato?.empresa, ultima ? resumoMensagem(ultima) : c.ultima_mensagem_preview]
      .filter(Boolean)
      .join(" "),
  );
}

function linhaDoExemplo(estado: EstadoExemplo, c: Conversa): LinhaChatDados | null {
  const contato = estado.contatos.find((x) => x.id === c.contato_id);
  if (!contato) return null;
  const ultima = ultimaMensagem(estado, c.id);
  return {
    conversa: c,
    contato,
    ultima: ultima
      ? { ...ultima, responde_a_id: ultima.citaId ?? null, midia_duracao_s: ultima.duracaoS ?? null }
      : null,
  };
}

const SEM_MAIS = { temMais: false, carregarMais: () => {}, carregandoMais: false } as const;

function useListaExemplo(filtro: FiltroChat, busca: string): LeituraListaChat {
  const { estado } = useExemplo();
  const q = normalizarBuscaChat(busca);
  return useMemo<LeituraListaChat>(() => {
    const linhas = conversasPorRecencia(estado)
      .filter((c) => passaNoFiltroChat(filtro, c, estado.eu.id) && (!q || textoDaBuscaExemplo(estado, c).includes(q)))
      .map((c) => linhaDoExemplo(estado, c))
      .filter((l): l is LinhaChatDados => !!l);
    return { ...pronta(linhas), ...SEM_MAIS };
  }, [estado, filtro, q]);
}

function useLinhaExemplo(id: string | null | undefined): Leitura<LinhaChatDados | null> {
  const { estado } = useExemplo();
  return useMemo(() => {
    const c = id ? estado.conversas.find((x) => x.id === id) : undefined;
    return pronta(c ? linhaDoExemplo(estado, c) : null);
  }, [estado, id]);
}

function useContadoresExemplo(): Leitura<ContadoresChat> {
  const { estado } = useExemplo();
  return useMemo(() => {
    const conta = (f: FiltroChat) => estado.conversas.filter((c) => passaNoFiltroChat(f, c, estado.eu.id)).length;
    const valor = Object.fromEntries(FILTROS_CHAT.map((f) => [f, conta(f)])) as Record<FiltroChat, number>;
    return pronta<ContadoresChat>(valor);
  }, [estado.conversas, estado.eu.id]);
}

/** Procura a conversa pelo id: a achada (ou só o id, quando a leitura falhou); null = não existe. */
export type BuscarConversaChat = (id: string) => Promise<Pick<ConversaDados, "id"> | null>;

function useBuscarExemplo(): BuscarConversaChat {
  const { estado } = useExemplo();
  const conversas = estado.conversas;
  return useCallback(async (id: string) => conversas.find((c) => c.id === id) ?? null, [conversas]);
}

/* ---------- os hooks da tela ---------- */

/**
 * A lista do Chat: as conversas do filtro (e da busca), pela mensagem mais recente, com o contato e a
 * última mensagem. Sem busca, em páginas de 50; com busca, os até 50 contatos que o servidor achou.
 */
export function useListaChat(filtro: FiltroChat, busca: string): LeituraListaChat {
  const usar = useModoDados() === "banco" ? useListaBanco : useListaExemplo;
  return usar(filtro, busca);
}

/** Uma linha da lista pelo id da conversa (a fixada, que saiu do filtro). Nula = não existe. */
export function useLinhaChat(conversaId: string | null | undefined): Leitura<LinhaChatDados | null> {
  const usar = useModoDados() === "banco" ? useLinhaBanco : useLinhaExemplo;
  return usar(conversaId);
}

/** Quantas conversas há em cada filtro. */
export function useContadoresChat(): Leitura<ContadoresChat> {
  const usar = useModoDados() === "banco" ? useContadoresBanco : useContadoresExemplo;
  return usar();
}

/**
 * Procura uma conversa pelo id, fora da página carregada (o `?conversa=` do endereço). Uma falha de
 * leitura devolve só o id: a conversa abre e mostra o próprio erro, com "Tentar de novo".
 */
export function useBuscarConversaChat(): BuscarConversaChat {
  const usar = useModoDados() === "banco" ? useBuscarBanco : useBuscarExemplo;
  return usar();
}

function useDigitandoExemplo(conversaId: string): boolean {
  const { estado } = useExemplo();
  return estado.digitando.includes(conversaId);
}

const nuncaDigitando = (_conversaId: string) => false;

/** A Janete está digitando nesta conversa. O banco não guarda esse sinal: só o exemplo mostra. */
export function useDigitandoChat(conversaId: string): boolean {
  const usar = useModoDados() === "banco" ? nuncaDigitando : useDigitandoExemplo;
  return usar(conversaId);
}

function useReconexaoExemplo(): (() => boolean) | null {
  const { acoes } = useExemplo();
  return useCallback(() => acoes.simularJanete({ tipo: "conexao", status: "conectada" }).ok, [acoes]);
}

const semReconexao = () => null;

/**
 * O "Reconectar" que só o exemplo tem: simula a volta da conexão caída. No banco, nulo (quem
 * reconecta é o admin, na Configuração).
 */
export function useReconexaoDoExemplo(): (() => boolean) | null {
  const usar = useModoDados() === "banco" ? semReconexao : useReconexaoExemplo;
  return usar();
}
