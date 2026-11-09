import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";

import { useExemplo } from "../exemplo/ProvedorExemplo";
import { ehAdmin } from "../exemplo/regras";
import type { FatoJanete, Mensagem, ProximoPasso } from "../exemplo/tipos";
import { CHAVES } from "./chaves";
import {
  COLUNAS_CONTATO,
  COLUNAS_CONVERSA,
  COLUNAS_EVENTO,
  COLUNAS_HISTORICO,
  COLUNAS_MENSAGEM,
  lerTodas,
  type ClienteFirebase,
} from "./colunas";
import { traduzirErro } from "./erros";
import { paraLeitura, pronta } from "./leitura";
import { opcoesEu, repetirSoFalha } from "./leituras";
import type {
  ContatoDados,
  ConversaDados,
  CustosConversas,
  EventoConversaDados,
  HistoricoContato,
  Leitura,
  LeituraMensagens,
  MensagemDados,
} from "./tipos";

// As leituras de conversa que o Chat, o Kanban e os Contatos dividem (spec 2.1, "As leituras de
// cada área"): a conversa, as mensagens (paginadas), as passagens do bastão,
// o histórico de etapas, o contato e o custo de IA. As três telas leem daqui e não reescrevem isto.
//
// Igual nos dois modos: no banco, React Query sobre o cliente do navegador (sob RLS, colunas
// listadas, chaves embaixo das raízes de CHAVES, que o tempo real e as ações invalidam pelo
// POR_TABELA); no exemplo, as mesmas formas saem do estado em memória (o ProvedorExemplo).
// O ProvedorDados põe o provedor certo (ProvedorLeiturasConversa); as telas usam os hooks abaixo.

/** Quantas mensagens cada página traz (a 1ª página são as mais recentes). */
export const TAMANHO_PAGINA_MENSAGENS = 50;

/** O máximo de conversas por chamada de `custo_das_conversas` (a função recusa acima de 200). */
export const MAX_CUSTO_POR_CHAMADA = 200;

/** Quanto tempo uma leitura de conversa vale antes de ser relida ao montar outra tela (o tempo real invalida antes). */
const VALE_MS = 15_000;

/* ---------- o contrato ---------- */

export interface LeiturasConversa {
  /** A conversa do id (nula = não existe, ou a RLS esconde). Sem id: nula, sem ir ao banco. */
  useConversa(id: string | null | undefined): Leitura<ConversaDados | null>;
  /** A conversa do contato (uma por contato). Nula = o contato ainda não tem conversa. */
  useConversaDoContato(contatoId: string | null | undefined): Leitura<ConversaDados | null>;
  /** As mensagens, paginadas: as mais recentes primeiro, com "carregar mais antigas". */
  useMensagens(conversaId: string | null | undefined): LeituraMensagens;
  /** As passagens do bastão (`conversa_eventos`), na ordem em que aconteceram. */
  useEventos(conversaId: string | null | undefined): Leitura<EventoConversaDados[]>;
  /** O histórico de etapas do contato, na ordem em que aconteceu, com a rodada da Janete. */
  useHistoricoContato(contatoId: string | null | undefined): Leitura<HistoricoContato[]>;
  /** O contato do id (nulo = não existe), com `fatosJanete` e `proximoPasso` lidos de `anotacoes_janete`. */
  useContato(id: string | null | undefined): Leitura<ContatoDados | null>;
  /** O custo de IA de cada conversa pedida (só o admin; o atendente recebe {} sem ir ao banco). */
  useCustoConversas(ids: readonly string[]): Leitura<CustosConversas>;
}

const LeiturasContexto = createContext<LeiturasConversa | null>(null);

/** O ProvedorDados põe este provedor, com as leituras do modo dele. */
export const ProvedorLeiturasConversa = LeiturasContexto.Provider;

function useLeituras(): LeiturasConversa {
  const valor = useContext(LeiturasContexto);
  if (!valor) throw new Error("As leituras de conversa precisam do <ProvedorDados> em volta (o Layout da plataforma põe).");
  return valor;
}

export function useConversa(id: string | null | undefined): Leitura<ConversaDados | null> {
  return useLeituras().useConversa(id);
}

export function useConversaDoContato(contatoId: string | null | undefined): Leitura<ConversaDados | null> {
  return useLeituras().useConversaDoContato(contatoId);
}

export function useMensagens(conversaId: string | null | undefined): LeituraMensagens {
  return useLeituras().useMensagens(conversaId);
}

export function useEventos(conversaId: string | null | undefined): Leitura<EventoConversaDados[]> {
  return useLeituras().useEventos(conversaId);
}

export function useHistoricoContato(contatoId: string | null | undefined): Leitura<HistoricoContato[]> {
  return useLeituras().useHistoricoContato(contatoId);
}

export function useContato(id: string | null | undefined): Leitura<ContatoDados | null> {
  return useLeituras().useContato(id);
}

export function useCustoConversas(ids: readonly string[]): Leitura<CustosConversas> {
  return useLeituras().useCustoConversas(ids);
}

/* ---------- ajudantes (os dois modos) ---------- */

/** As anotações da Janete (`contatos.anotacoes_janete`) no formato da tela; o que não tiver a forma certa sai. */
export function lerAnotacoesJanete(json: unknown): { fatos: FatoJanete[]; proximoPasso: ProximoPasso | null } {
  const fatos: FatoJanete[] = [];
  let proximoPasso: ProximoPasso | null = null;
  if (!json || typeof json !== "object" || Array.isArray(json)) return { fatos, proximoPasso };
  const o = json as Record<string, unknown>;
  if (Array.isArray(o["fatos"])) {
    for (const f of o["fatos"]) {
      if (!f || typeof f !== "object") continue;
      const { rotulo, valor, mensagem_id } = f as Record<string, unknown>;
      if (typeof rotulo !== "string" || !rotulo.trim() || typeof valor !== "string" || !valor.trim()) continue;
      fatos.push({ rotulo, valor, mensagemId: typeof mensagem_id === "string" && mensagem_id ? mensagem_id : null });
    }
  }
  const p = o["proximo_passo"];
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const { titulo, texto } = p as Record<string, unknown>;
    if (typeof titulo === "string" && titulo.trim() && typeof texto === "string") proximoPasso = { titulo, texto };
  }
  return { fatos, proximoPasso };
}

/** A mensagem com as duas formas da citação e da duração (as colunas do banco e os extras do exemplo). */
function comCitacaoEDuracao<T extends Partial<Pick<MensagemDados, "responde_a_id" | "midia_duracao_s">> & Pick<Mensagem, "citaId" | "duracaoS">>(
  m: T,
): T & Pick<MensagemDados, "responde_a_id" | "midia_duracao_s" | "citaId" | "duracaoS"> {
  const responde = m.responde_a_id ?? m.citaId ?? null;
  const duracao = m.midia_duracao_s ?? m.duracaoS ?? null;
  return { ...m, responde_a_id: responde, citaId: responde, midia_duracao_s: duracao, duracaoS: duracao };
}

/** A ordem do banco (momento, criado_em, ordem, id), crescente: a da conversa. */
function antesNaConversa(a: Pick<Mensagem, "momento" | "criado_em" | "id">, b: Pick<Mensagem, "momento" | "criado_em" | "id">): number {
  const pa = Date.parse(a.momento) - Date.parse(b.momento);
  if (pa) return pa;
  const pb = Date.parse(a.criado_em) - Date.parse(b.criado_em);
  if (pb) return pb;
  return 0;
}

function porCriadoEm(a: { criado_em: string; id: string }, b: { criado_em: string; id: string }): number {
  return Date.parse(a.criado_em) - Date.parse(b.criado_em) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Ids únicos, em ordem: a chave do custo não muda quando a tela passa os mesmos ids em outra ordem. */
function idsDaChave(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))].sort();
}

const MENSAGENS_VAZIAS: LeituraMensagens = {
  ...pronta<MensagemDados[]>([]),
  temMaisAntigas: false,
  carregarMaisAntigas: () => {},
  carregandoMaisAntigas: false,
};

/* ---------- modo banco ---------- */

export function opcoesConversa(cliente: ClienteFirebase, id: string) {
  return queryOptions({
    queryKey: [...CHAVES.conversas, "uma", id] as const,
    queryFn: async (): Promise<ConversaDados | null> => {
      const { data, error } = await cliente.from("conversas").select(COLUNAS_CONVERSA).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesConversaDoContato(cliente: ClienteFirebase, contatoId: string) {
  return queryOptions({
    queryKey: [...CHAVES.conversas, "do-contato", contatoId] as const,
    queryFn: async (): Promise<ConversaDados | null> => {
      const { data, error } = await cliente.from("conversas").select(COLUNAS_CONVERSA).eq("contato_id", contatoId).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/**
 * As mensagens em páginas de 50, da mais recente para a mais antiga (momento, criado_em, ordem e id,
 * como o gatilho que refaz a prévia). A página é por deslocamento: ao reler (tempo real, foco), o
 * React Query relê todas as páginas já abertas, de novo a partir da mais recente; entre duas leituras,
 * a mensagem que chegou empurra uma linha para a página seguinte, e o `useMensagens` tira a repetida
 * pelo id.
 */
export function opcoesMensagens(cliente: ClienteFirebase, conversaId: string) {
  return infiniteQueryOptions({
    queryKey: [...CHAVES.mensagens, conversaId] as const,
    queryFn: async ({ pageParam }): Promise<MensagemDados[]> => {
      const { data, error } = await cliente
        .from("mensagens")
        .select(COLUNAS_MENSAGEM)
        .eq("conversa_id", conversaId)
        .order("momento", { ascending: false })
        .order("criado_em", { ascending: false })
        .order("ordem", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(pageParam, pageParam + TAMANHO_PAGINA_MENSAGENS - 1);
      if (error) throw error;
      return (data ?? []).map((m: MensagemDados) => comCitacaoEDuracao(m));
    },
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) =>
      ultima.length < TAMANHO_PAGINA_MENSAGENS ? undefined : todas.reduce((n, p) => n + p.length, 0),
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** As páginas (cada uma da mais recente para a mais antiga) juntas, sem repetir id, na ordem da conversa. */
export function juntarPaginas(paginas: readonly (readonly MensagemDados[])[]): MensagemDados[] {
  const vistas = new Set<string>();
  const juntas: MensagemDados[] = [];
  for (const pagina of paginas) {
    for (const m of pagina) {
      if (vistas.has(m.id)) continue;
      vistas.add(m.id);
      juntas.push(m);
    }
  }
  return juntas.reverse();
}

export function opcoesEventos(cliente: ClienteFirebase, conversaId: string) {
  return queryOptions({
    queryKey: [...CHAVES.eventos, conversaId] as const,
    queryFn: (): Promise<EventoConversaDados[]> =>
      lerTodas<EventoConversaDados>((de, ate) =>
        cliente
          .from("conversa_eventos")
          .select(COLUNAS_EVENTO)
          .eq("conversa_id", conversaId)
          .order("criado_em", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      ),
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesHistoricoContato(cliente: ClienteFirebase, contatoId: string) {
  return queryOptions({
    queryKey: [...CHAVES.historico, contatoId] as const,
    queryFn: (): Promise<HistoricoContato[]> =>
      lerTodas<HistoricoContato>((de, ate) =>
        cliente
          .from("contato_etapa_historico")
          .select(COLUNAS_HISTORICO)
          .eq("contato_id", contatoId)
          .order("criado_em", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      ),
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesContato(cliente: ClienteFirebase, id: string) {
  return queryOptions({
    queryKey: [...CHAVES.contatos, "um", id] as const,
    queryFn: async (): Promise<ContatoDados | null> => {
      const { data, error } = await cliente.from("contatos").select(COLUNAS_CONTATO).eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { fatos, proximoPasso } = lerAnotacoesJanete(data.anotacoes_janete);
      return { ...data, fatosJanete: fatos, proximoPasso };
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** O custo de IA das conversas (só o admin), de 200 em 200 ids. */
export function opcoesCustoConversas(cliente: ClienteFirebase, ids: readonly string[], admin: boolean) {
  const chave = idsDaChave(ids);
  return queryOptions({
    queryKey: [...CHAVES.custos, "conversas", ...chave] as const,
    queryFn: async (): Promise<CustosConversas> => {
      const custos: Record<string, number> = {};
      for (let i = 0; i < chave.length; i += MAX_CUSTO_POR_CHAMADA) {
        const { data, error } = await cliente.rpc("custo_das_conversas", {
          p_conversas: chave.slice(i, i + MAX_CUSTO_POR_CHAMADA),
        });
        if (error) throw error;
        for (const linha of data ?? []) custos[linha.conversa_id] = Number(linha.custo_usd) || 0;
      }
      return custos;
    },
    enabled: admin && chave.length > 0,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** As leituras do modo banco, sobre o cliente do Firebase (o ProvedorDados cria uma vez por cliente). */
export function criarLeiturasConversaBanco(cliente: ClienteFirebase): LeiturasConversa {
  const nula = pronta<ConversaDados | null>(null);
  return {
    useConversa: (id) => {
      const q = useQuery({ ...opcoesConversa(cliente, id ?? ""), enabled: !!id });
      const leitura = paraLeitura(q);
      return id ? leitura : nula;
    },
    useConversaDoContato: (contatoId) => {
      const q = useQuery({ ...opcoesConversaDoContato(cliente, contatoId ?? ""), enabled: !!contatoId });
      const leitura = paraLeitura(q);
      return contatoId ? leitura : nula;
    },
    useMensagens: (conversaId) => {
      const q = useInfiniteQuery({ ...opcoesMensagens(cliente, conversaId ?? ""), enabled: !!conversaId });
      const paginas = q.data?.pages;
      const dados = useMemo(() => (paginas ? juntarPaginas(paginas) : undefined), [paginas]);
      if (!conversaId) return MENSAGENS_VAZIAS;
      const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
      return {
        dados,
        carregando: q.isPending,
        erro: q.error ? traduzirErro(q.error).erro : null,
        tentarDeNovo: () => void q.refetch(),
        temMaisAntigas: hasNextPage,
        carregandoMaisAntigas: isFetchingNextPage,
        carregarMaisAntigas: () => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        },
      };
    },
    useEventos: (conversaId) => {
      const q = useQuery({ ...opcoesEventos(cliente, conversaId ?? ""), enabled: !!conversaId });
      const leitura = paraLeitura(q);
      const vazia = useMemo(() => pronta<EventoConversaDados[]>([]), []);
      return conversaId ? leitura : vazia;
    },
    useHistoricoContato: (contatoId) => {
      const q = useQuery({ ...opcoesHistoricoContato(cliente, contatoId ?? ""), enabled: !!contatoId });
      const leitura = paraLeitura(q);
      const vazia = useMemo(() => pronta<HistoricoContato[]>([]), []);
      return contatoId ? leitura : vazia;
    },
    useContato: (id) => {
      const q = useQuery({ ...opcoesContato(cliente, id ?? ""), enabled: !!id });
      const leitura = paraLeitura(q);
      const nulo = useMemo(() => pronta<ContatoDados | null>(null), []);
      return id ? leitura : nulo;
    },
    useCustoConversas: (ids) => {
      // O custo é só do admin (custo_das_conversas recusa o resto com sem_acesso): o atendente não chama.
      const eu = useQuery(opcoesEu(cliente));
      const admin = ehAdmin(eu.data ?? null);
      const q = useQuery(opcoesCustoConversas(cliente, ids, admin));
      const vazio = useMemo(() => pronta<CustosConversas>({}), []);
      if (!admin) return eu.isPending ? { ...vazio, dados: undefined, carregando: true } : vazio;
      if (idsDaChave(ids).length === 0) return vazio;
      return paraLeitura(q);
    },
  };
}

/* ---------- modo exemplo ---------- */

/** As mesmas leituras, do estado do exemplo (os testes). Não carregam nem falham. */
export function criarLeiturasConversaExemplo(): LeiturasConversa {
  return {
    useConversa: (id) => {
      const { estado } = useExemplo();
      return useMemo(() => pronta(estado.conversas.find((c) => c.id === id) ?? null), [estado.conversas, id]);
    },
    useConversaDoContato: (contatoId) => {
      const { estado } = useExemplo();
      return useMemo(
        () => pronta(estado.conversas.find((c) => c.contato_id === contatoId) ?? null),
        [estado.conversas, contatoId],
      );
    },
    useMensagens: (conversaId) => {
      const { estado } = useExemplo();
      return useMemo<LeituraMensagens>(() => {
        // O sort é estável: no mesmo momento, fica a ordem em que o exemplo guardou.
        const doConversa = estado.mensagens
          .filter((m) => m.conversa_id === conversaId)
          .sort(antesNaConversa)
          .map((m): MensagemDados => comCitacaoEDuracao(m));
        return { ...MENSAGENS_VAZIAS, dados: doConversa };
      }, [estado.mensagens, conversaId]);
    },
    useEventos: (conversaId) => {
      const { estado } = useExemplo();
      return useMemo(
        () => pronta<EventoConversaDados[]>(estado.eventos.filter((e) => e.conversa_id === conversaId).sort(porCriadoEm)),
        [estado.eventos, conversaId],
      );
    },
    useHistoricoContato: (contatoId) => {
      const { estado } = useExemplo();
      return useMemo(
        () =>
          pronta<HistoricoContato[]>(
            estado.historico
              .filter((h) => h.contato_id === contatoId)
              .sort(porCriadoEm)
              // O exemplo não guarda a rodada da Janete.
              .map((h) => ({ ...h, rodada_id: null })),
          ),
        [estado.historico, contatoId],
      );
    },
    useContato: (id) => {
      const { estado } = useExemplo();
      return useMemo(() => pronta<ContatoDados | null>(estado.contatos.find((c) => c.id === id) ?? null), [estado.contatos, id]);
    },
    useCustoConversas: (ids) => {
      const { estado } = useExemplo();
      const chave = idsDaChave(ids).join(",");
      return useMemo(() => {
        // Como no banco: o atendente não recebe custo; o admin, uma linha por conversa que existe (0 sem custo).
        if (!ehAdmin(estado.eu)) return pronta<CustosConversas>({});
        const existem = new Set(estado.conversas.map((c) => c.id));
        const custos: Record<string, number> = {};
        for (const id of chave ? chave.split(",") : []) if (existem.has(id)) custos[id] = 0;
        for (const c of estado.custos) {
          if (c.conversa_id in custos && c.custo_usd !== null) custos[c.conversa_id] = (custos[c.conversa_id] ?? 0) + c.custo_usd;
        }
        return pronta<CustosConversas>(custos);
      }, [estado.eu, estado.conversas, estado.custos, chave]);
    },
  };
}
