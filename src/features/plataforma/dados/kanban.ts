import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { Json } from "@/integrations/firebase/types";

import { useExemplo } from "../exemplo/ProvedorExemplo";
import { janeteAtivaAgora, nivelFrio, ultimaMensagem } from "../exemplo/regras";
import type { Etapa, EstadoExemplo, Mensagem } from "../exemplo/tipos";
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
import { lerAnotacoesJanete } from "./conversa";
import { traduzirErro } from "./erros";
import { paraLeitura, pronta } from "./leitura";
import { repetirSoFalha } from "./leituras";
import { useClienteDados, useModoDados } from "./ProvedorDados";
import type {
  ContatoDados,
  ConversaDados,
  Erro,
  EventoConversaDados,
  HistoricoContato,
  Leitura,
  MensagemDados,
  ModoDados,
} from "./tipos";

// As leituras próprias do Kanban (spec de ligar as telas ao banco, C2; decisões 5, 6 e 13):
//   - o quadro: os contatos com conversa, a última mensagem embutida; as etapas abertas inteiras, e
//     Ganho e Perdido só com quem entrou nos últimos 30 dias, mais o total de cada uma;
//   - as conversas em que a Janete está trabalhando agora (as rodadas rodando);
//   - o "Desde que você saiu": os movimentos (com o motivo da Janete, tirado de rodadas.ferramentas pela
//     rodada_id do histórico), as passagens para a equipe e quantas respostas a Janete mandou;
//   - a busca no servidor (buscar_quadro: nome, empresa, nome do WhatsApp e o texto das mensagens).
// Iguais nos dois modos: no banco, React Query sobre o cliente do navegador (sob RLS, colunas
// listadas, chaves embaixo das raízes de CHAVES, que o tempo real invalida pelo POR_TABELA); no
// exemplo, as mesmas formas saem do estado em memória (os testes).
// As regras calculadas (ativa agora, esfriando, aguardando) continuam em exemplo/regras.ts.

/** Ganho e Perdido mostram quem entrou na etapa nos últimos 30 dias (decisão 13). */
export const DIAS_GANHO_PERDIDO = 30;

/** A busca do quadro traz até 50 leads (buscar_quadro, decisão 13). */
export const MAX_RESULTADOS_BUSCA = 50;

/** O atraso curto da busca: espera a pessoa parar de digitar antes de perguntar ao servidor. */
export const ATRASO_BUSCA_MS = 300;

/** "Ativa agora": a Janete ou o lead falaram nos últimos 5 minutos (exemplo/regras.ts). */
export const ATIVA_MS = 5 * 60_000;

/** As rodadas rodando também são relidas sozinhas (a gravação delas é rápida e o aviso pode se perder). */
export const RELER_RODANDO_MS = 15_000;

/** Quantas rodadas cada leitura de motivo pede de uma vez (o `in` vai no endereço). */
const RODADAS_POR_LEITURA = 100;

/** Quanto tempo uma leitura do quadro vale antes de ser relida ao voltar à tela (o tempo real invalida antes). */
const VALE_MS = 15_000;

/* ---------- tipos ---------- */

/** Um card do quadro: o contato, a conversa dele e a última mensagem (nula = a conversa ainda não tem). */
export interface LinhaQuadro {
  contato: ContatoDados;
  conversa: ConversaDados;
  ultima: MensagemDados | null;
}

export interface DadosQuadro {
  linhas: LinhaQuadro[];
  /** Ganho e Perdido: quantos leads com conversa estão na etapa, de todas as datas (decisão 13). */
  totaisFim: Readonly<Record<string, number>>;
  /** Desde quando Ganho e Perdido mostram (00:00 em São Paulo, há 30 dias), em ISO com o fuso. */
  desdeFim: string;
}

export interface DesdeQuadro {
  /** Todos os movimentos de etapa desde a saída (a régua do "Rever no quadro" precisa de todos), do mais antigo. */
  historico: HistoricoContato[];
  /** O motivo curto que a Janete deu ao mover (decisão 13): id do histórico → motivo. */
  motivos: Readonly<Record<string, string>>;
  /** As passagens para a equipe (conversa_eventos do tipo `passou`) desde a saída, da mais antiga. */
  passagens: EventoConversaDados[];
  /** Quantas mensagens a Janete mandou desde a saída (só as que saíram). */
  respostas: number;
}

/** O resultado da busca do quadro: os contatos achados (nulo = sem busca), e se ainda está buscando. */
export interface BuscaQuadro {
  ids: ReadonlySet<string> | null;
  /** A busca digitada ainda não voltou (o atraso curto, ou o servidor respondendo). */
  buscando: boolean;
  erro: Erro | null;
  tentarDeNovo: () => void;
}

interface LeiturasKanban {
  useQuadro(etapas: readonly Etapa[] | undefined): Leitura<DadosQuadro>;
  useJaneteTrabalhando(): Leitura<string[]>;
  useDesdeQuadro(saida: string | null, etapas: readonly Etapa[] | undefined): Leitura<DesdeQuadro>;
  useBuscaQuadro(q: string): BuscaQuadro;
}

/* ---------- ajudantes (os dois modos) ---------- */

const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** O dia em São Paulo (AAAA-MM-DD), nunca pelo `toISOString()` (que é o dia em UTC). */
export function diaEmSaoPaulo(ms: number): string {
  return formatoDia.format(new Date(ms));
}

/** O início do recorte de Ganho e Perdido: 00:00 em São Paulo (-03:00, sem horário de verão), há 30 dias. */
export function inicioDoRecorte(agora: number): string {
  return `${diaEmSaoPaulo(agora - DIAS_GANHO_PERDIDO * 86_400_000)}T00:00:00-03:00`;
}

/** Como o `texto_busca` do banco: minúsculo e sem acento. */
export function textoDeBusca(t: string | null | undefined): string {
  return (t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** A mensagem com a citação e a duração nas duas formas (as colunas do banco e os extras do exemplo). */
function comCitacao<T extends Partial<Pick<MensagemDados, "responde_a_id" | "midia_duracao_s">> & Pick<Mensagem, "citaId" | "duracaoS">>(
  m: T,
): T & Pick<MensagemDados, "responde_a_id" | "midia_duracao_s"> {
  const responde = m.responde_a_id ?? m.citaId ?? null;
  const duracao = m.midia_duracao_s ?? m.duracaoS ?? null;
  return { ...m, responde_a_id: responde, citaId: responde, midia_duracao_s: duracao, duracaoS: duracao };
}

/** O contato com os fatos e o próximo passo lidos das anotações da Janete (só no banco; o exemplo já tem). */
function comAnotacoes(c: ContatoDados): ContatoDados {
  if (c.anotacoes_janete === undefined) return c;
  const { fatos, proximoPasso } = lerAnotacoesJanete(c.anotacoes_janete);
  return { ...c, fatosJanete: fatos, proximoPasso };
}

/**
 * "A Janete ativa agora" (Kanban 2): a regra de `exemplo/regras.ts` (com a Janete, numa etapa aberta, e
 * a Janete trabalhando ou uma troca da Janete ou do lead nos últimos 5 min), aplicada à linha do quadro:
 * a última mensagem e as colunas do banco `ultima_do_lead_em` e `ultima_da_janete_em`.
 */
export function janeteAtivaNoQuadro(l: LinhaQuadro, etapas: readonly Etapa[], trabalhando: readonly string[], agora: number): boolean {
  const mini = {
    mensagens: l.ultima ? [l.ultima] : [],
    digitando: [...trabalhando],
    conversas: [l.conversa],
    etapas: [...etapas],
    contatos: [l.contato],
  };
  if (janeteAtivaAgora(mini, l.conversa.id, new Date(agora))) return true;
  if (l.conversa.modo !== "janete") return false;
  const etapa = etapas.find((e) => e.id === l.contato.etapa_id);
  if (etapa && etapa.tipo !== "aberta") return false;
  const limite = agora - ATIVA_MS;
  return [l.conversa.ultima_do_lead_em, l.conversa.ultima_da_janete_em].some((t) => !!t && Date.parse(t) >= limite);
}

/** Quanto o card esfriou (a regra de `exemplo/regras.ts`), aplicada à linha do quadro. */
export function frioNoQuadro(l: LinhaQuadro, etapas: readonly Etapa[], agora: number): number {
  return nivelFrio({ etapas: [...etapas], contatos: [l.contato] }, l.conversa, new Date(agora));
}

/**
 * A etapa de cada lead num instante do "Rever no quadro" (decisão 13), a partir da etapa de agora e
 * dos movimentos desde a saída: o lead que se moveu depois do instante estava na etapa de onde saiu
 * no primeiro desses movimentos; quem entrou depois do instante (o primeiro movimento sem etapa de
 * origem) ainda não estava no quadro e fica de fora.
 */
export function etapasNoInstante(
  linhas: readonly Pick<LinhaQuadro, "contato">[],
  historico: readonly HistoricoContato[],
  instante: number,
): Map<string, string> {
  const primeiroDepois = new Map<string, HistoricoContato>();
  for (const h of historico) {
    const em = Date.parse(h.criado_em);
    if (em <= instante) continue;
    const atual = primeiroDepois.get(h.contato_id);
    if (!atual || em < Date.parse(atual.criado_em)) primeiroDepois.set(h.contato_id, h);
  }
  const mapa = new Map<string, string>();
  for (const { contato } of linhas) {
    const h = primeiroDepois.get(contato.id);
    if (!h) mapa.set(contato.id, contato.etapa_id);
    else if (h.de_etapa_id) mapa.set(contato.id, h.de_etapa_id);
  }
  return mapa;
}

type ChamadaFerramenta = { ferramenta?: unknown; entrada?: unknown; resultado?: unknown };

/**
 * O motivo que a Janete deu ao mover, na entrada da ferramenta `mover_etapa` gravada em
 * `rodadas.ferramentas` (`[{ passo, ferramenta, entrada: { etapa, motivo }, resultado }]`). Vale a
 * chamada que deu certo para a etapa de destino (pela chave); sem ela, a última que deu certo.
 */
export function motivoDaRodada(ferramentas: Json | null | undefined, chaveDestino: string | null): string | null {
  if (!Array.isArray(ferramentas)) return null;
  let ultimo: string | null = null;
  let daEtapa: string | null = null;
  for (const item of ferramentas as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const c = item as ChamadaFerramenta;
    if (c.ferramenta !== "mover_etapa") continue;
    const r = c.resultado;
    if (r && typeof r === "object" && !Array.isArray(r) && "erro" in (r as Record<string, unknown>)) continue;
    const e = c.entrada && typeof c.entrada === "object" && !Array.isArray(c.entrada) ? (c.entrada as Record<string, unknown>) : null;
    const motivo = typeof e?.["motivo"] === "string" ? e["motivo"].trim() : "";
    if (!motivo) continue;
    ultimo = motivo;
    if (chaveDestino && e?.["etapa"] === chaveDestino) daEtapa = motivo;
  }
  return daEtapa ?? ultimo;
}

function porCriadoEm(a: { criado_em: string; id: string }, b: { criado_em: string; id: string }): number {
  return Date.parse(a.criado_em) - Date.parse(b.criado_em) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** O valor que só muda depois de `ms` sem mudar (o atraso curto da busca). O vazio vale na hora. */
function useAtrasado(valor: string, ms: number): string {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    if (!valor) {
      setAtrasado("");
      return;
    }
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return valor ? atrasado : "";
}

/** As mensagens da Janete que contam como resposta: só as que saíram. */
const STATUS_SAIU = ["enviada", "entregue", "lida"] as const;

/* ---------- modo banco ---------- */

// Os aliases não vão no filtro: o filtro do recurso embutido usa o nome da tabela (`contatos.etapa_id`).
const SELECT_QUADRO = `${COLUNAS_CONVERSA}, contatos!inner(${COLUNAS_CONTATO}), ultima:mensagens!conversas_ultima_mensagem_id_fkey(${COLUNAS_MENSAGEM})`;

type LinhaBruta = ConversaDados & { contatos: ContatoDados | null; ultima: MensagemDados | null };

function paraLinha(bruta: LinhaBruta): LinhaQuadro | null {
  const { contatos, ultima, ...conversa } = bruta;
  if (!contatos) return null;
  return { contato: comAnotacoes(contatos), conversa, ultima: ultima ? comCitacao(ultima) : null };
}

/** A ordem do quadro: a conversa com a mensagem mais recente primeiro (sem mensagem, no fim), desempate pelo id. */
export function ordenarQuadro(linhas: LinhaQuadro[]): LinhaQuadro[] {
  const quando = (l: LinhaQuadro) => {
    const t = l.conversa.ultima_mensagem_em ? Date.parse(l.conversa.ultima_mensagem_em) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  return linhas.sort((a, b) => {
    const ta = quando(a);
    const tb = quando(b);
    if (ta !== tb) return tb > ta ? 1 : -1;
    return a.conversa.id < b.conversa.id ? -1 : a.conversa.id > b.conversa.id ? 1 : 0;
  });
}

/** O quadro: as etapas abertas inteiras e Ganho e Perdido dos últimos 30 dias, com o total delas. */
export function opcoesQuadro(cliente: ClienteFirebase, etapas: readonly Etapa[], agora: number) {
  const abertas = etapas.filter((e) => e.tipo === "aberta").map((e) => e.id).sort();
  const fins = etapas.filter((e) => e.tipo !== "aberta").map((e) => e.id).sort();
  const desdeFim = inicioDoRecorte(agora);
  return queryOptions({
    queryKey: [...CHAVES.quadro, "cards", desdeFim, ...abertas, "|", ...fins] as const,
    queryFn: async (): Promise<DadosQuadro> => {
      const base = () => cliente.from("conversas").select(SELECT_QUADRO);
      // O PostgREST corta em 1.000: lê de 1.000 em 1.000 pelo id, que não muda. Na ordem de
      // ultima_mensagem_em (que muda a cada mensagem), uma mensagem que chegasse no meio da leitura
      // empurraria linhas entre as páginas: um card sumia e outro vinha repetido. A ordem da conversa
      // mais recente sai depois, aqui (ordenarQuadro), e a repetida pelo id sai por garantia.
      const ler = (filtrar: (q: ReturnType<typeof base>) => ReturnType<typeof base>) =>
        lerTodas<LinhaBruta>(async (de, ate) => {
          const r = await filtrar(base()).order("id", { ascending: true }).range(de, ate);
          return { data: (r.data ?? null) as unknown as LinhaBruta[] | null, error: r.error };
        });
      const [linhasAbertas, linhasFins, totais] = await Promise.all([
        abertas.length ? ler((q) => q.in("contatos.etapa_id", abertas)) : Promise.resolve([]),
        fins.length ? ler((q) => q.in("contatos.etapa_id", fins).gte("contatos.etapa_desde", desdeFim)) : Promise.resolve([]),
        Promise.all(
          fins.map(async (id) => {
            const { count, error } = await cliente
              .from("conversas")
              .select("id, contatos!inner(etapa_id)", { count: "exact", head: true })
              .eq("contatos.etapa_id", id);
            if (error) throw error;
            return [id, count ?? 0] as const;
          }),
        ),
      ]);
      const linhas: LinhaQuadro[] = [];
      const vistas = new Set<string>();
      for (const b of [...linhasAbertas, ...linhasFins]) {
        if (vistas.has(b.id)) continue;
        vistas.add(b.id);
        const l = paraLinha(b);
        if (l) linhas.push(l);
      }
      return { linhas: ordenarQuadro(linhas), totaisFim: Object.fromEntries(totais), desdeFim };
    },
    enabled: etapas.length > 0,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/**
 * As conversas em que a Janete está trabalhando agora (as rodadas rodando, uma por conversa). Fica
 * embaixo da raiz `historico` porque é ela que `rodadas` deixa velha no POR_TABELA (o motivo do
 * movimento da Janete também vem da rodada).
 */
export function opcoesJaneteTrabalhando(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.historico, "rodadas-rodando"] as const,
    queryFn: async (): Promise<string[]> => {
      const linhas = await lerTodas<{ id: string; conversa_id: string }>((de, ate) =>
        cliente
          .from("rodadas")
          .select("id, conversa_id")
          .eq("status", "rodando")
          .order("iniciada_em", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      );
      return [...new Set(linhas.map((r) => r.conversa_id))];
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
    refetchInterval: RELER_RODANDO_MS,
  });
}

/** Os movimentos desde a saída, com o motivo da Janete (rodadas.ferramentas pela rodada_id). */
export function opcoesHistoricoDesde(cliente: ClienteFirebase, saida: string, etapas: readonly Etapa[]) {
  const chaves = new Map(etapas.map((e) => [e.id, e.chave] as const));
  return queryOptions({
    queryKey: [...CHAVES.historico, "desde", saida, etapas.map((e) => `${e.id}:${e.chave}`).join(",")] as const,
    queryFn: async (): Promise<Pick<DesdeQuadro, "historico" | "motivos">> => {
      const historico = await lerTodas<HistoricoContato>((de, ate) =>
        cliente
          .from("contato_etapa_historico")
          .select(COLUNAS_HISTORICO)
          .gte("criado_em", saida)
          .order("criado_em", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      );
      const daJanete = historico.filter((h) => h.ator === "janete" && h.rodada_id);
      const rodadas = [...new Set(daJanete.map((h) => h.rodada_id!))];
      const ferramentas = new Map<string, Json>();
      for (let i = 0; i < rodadas.length; i += RODADAS_POR_LEITURA) {
        const { data, error } = await cliente
          .from("rodadas")
          .select("id, ferramentas")
          .in("id", rodadas.slice(i, i + RODADAS_POR_LEITURA));
        if (error) throw error;
        for (const r of data ?? []) ferramentas.set(r.id, r.ferramentas);
      }
      const motivos: Record<string, string> = {};
      for (const h of daJanete) {
        const m = motivoDaRodada(ferramentas.get(h.rodada_id!), chaves.get(h.para_etapa_id) ?? null);
        if (m) motivos[h.id] = m;
      }
      return { historico, motivos };
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesPassagensDesde(cliente: ClienteFirebase, saida: string) {
  return queryOptions({
    queryKey: [...CHAVES.eventos, "passagens-desde", saida] as const,
    queryFn: () =>
      lerTodas<EventoConversaDados>((de, ate) =>
        cliente
          .from("conversa_eventos")
          .select(COLUNAS_EVENTO)
          .eq("tipo", "passou")
          .gte("criado_em", saida)
          .order("criado_em", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      ),
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesRespostasDesde(cliente: ClienteFirebase, saida: string) {
  return queryOptions({
    queryKey: [...CHAVES.mensagens, "respostas-da-janete-desde", saida] as const,
    queryFn: async (): Promise<number> => {
      // Só conta (head): nenhuma linha vem, e o corte de 1.000 não vale.
      const { count, error } = await cliente
        .from("mensagens")
        .select("id", { count: "exact", head: true })
        .eq("origem", "janete")
        .in("status", [...STATUS_SAIU])
        .gte("momento", saida);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** A busca no servidor (buscar_quadro): até 50 contatos, pelo nome, a empresa, o WhatsApp e as mensagens. */
export function opcoesBuscaQuadro(cliente: ClienteFirebase, q: string) {
  return queryOptions({
    queryKey: [...CHAVES.quadro, "busca", q] as const,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await cliente.rpc("buscar_quadro", { p_q: q });
      if (error) throw error;
      return (data ?? []).slice(0, MAX_RESULTADOS_BUSCA);
    },
    enabled: q.length > 0,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

function exigirCliente(cliente: ClienteFirebase | null): ClienteFirebase {
  if (!cliente) throw new Error("As leituras do Kanban no modo banco precisam do <ProvedorDados fonte=\"banco\">.");
  return cliente;
}

/** O relógio das leituras: muda de hora em hora (o recorte de Ganho e Perdido anda com o dia). */
function useHoraAtual(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 3_600_000);
    return () => clearInterval(id);
  }, []);
  return agora;
}

const SEM_ETAPAS: readonly Etapa[] = [];

const BANCO: LeiturasKanban = {
  useQuadro: (etapas) => {
    const cliente = exigirCliente(useClienteDados());
    const agora = useHoraAtual();
    const q = useQuery(opcoesQuadro(cliente, etapas ?? SEM_ETAPAS, agora));
    const leitura = paraLeitura(q);
    const desdeFim = inicioDoRecorte(agora);
    const semEtapas = useMemo(() => pronta<DadosQuadro>({ linhas: [], totaisFim: {}, desdeFim }), [desdeFim]);
    // Sem etapas (ainda carregando), o quadro também está carregando. Com as etapas lidas e nenhuma
    // (o remix sem os dados iniciais), o quadro está pronto e vazio: a consulta nem roda (enabled), e
    // ficaria carregando para sempre.
    if (!etapas) return { ...leitura, dados: undefined, carregando: true, erro: null };
    return etapas.length === 0 ? semEtapas : leitura;
  },
  useJaneteTrabalhando: () => {
    const cliente = exigirCliente(useClienteDados());
    return paraLeitura(useQuery(opcoesJaneteTrabalhando(cliente)));
  },
  useDesdeQuadro: (saida, etapas) => {
    const cliente = exigirCliente(useClienteDados());
    const s = saida ?? "";
    const h = useQuery({ ...opcoesHistoricoDesde(cliente, s, etapas ?? SEM_ETAPAS), enabled: !!saida && !!etapas });
    const p = useQuery({ ...opcoesPassagensDesde(cliente, s), enabled: !!saida });
    const r = useQuery({ ...opcoesRespostasDesde(cliente, s), enabled: !!saida });
    const dados = useMemo<DesdeQuadro | undefined>(
      () =>
        h.data && p.data && r.data !== undefined
          ? { historico: h.data.historico, motivos: h.data.motivos, passagens: p.data, respostas: r.data }
          : undefined,
      [h.data, p.data, r.data],
    );
    const erro = h.error ?? p.error ?? r.error;
    return {
      dados,
      carregando: !dados && !erro,
      erro: erro ? traduzirErro(erro).erro : null,
      tentarDeNovo: () => {
        if (h.error) void h.refetch();
        if (p.error) void p.refetch();
        if (r.error) void r.refetch();
      },
    };
  },
  useBuscaQuadro: (texto) => {
    const cliente = exigirCliente(useClienteDados());
    const q = useAtrasado(texto.trim(), ATRASO_BUSCA_MS);
    // Enquanto a próxima busca não volta, fica a anterior (o quadro não pisca entre uma letra e outra).
    const r = useQuery({ ...opcoesBuscaQuadro(cliente, q), placeholderData: keepPreviousData });
    const ids = useMemo(() => (q && r.data ? new Set(r.data) : null), [q, r.data]);
    if (!texto.trim()) return { ids: null, buscando: false, erro: null, tentarDeNovo: () => {} };
    return {
      ids,
      buscando: q !== texto.trim() || r.isFetching,
      erro: r.error ? traduzirErro(r.error).erro : null,
      tentarDeNovo: () => void r.refetch(),
    };
  },
};

/* ---------- modo exemplo ---------- */

/** O quadro do exemplo, com o mesmo recorte do banco. */
export function quadroDoExemplo(estado: Pick<EstadoExemplo, "contatos" | "conversas" | "etapas" | "mensagens">, agora: number): DadosQuadro {
  const desdeFim = inicioDoRecorte(agora);
  const limite = Date.parse(desdeFim);
  const porId = new Map(estado.etapas.map((e) => [e.id, e] as const));
  const contatos = new Map(estado.contatos.map((c) => [c.id, c] as const));
  const linhas: LinhaQuadro[] = [];
  const totaisFim: Record<string, number> = {};
  for (const e of estado.etapas) if (e.tipo !== "aberta") totaisFim[e.id] = 0;
  for (const conversa of estado.conversas) {
    const contato = contatos.get(conversa.contato_id);
    if (!contato) continue;
    const etapa = porId.get(contato.etapa_id);
    if (!etapa) continue;
    if (etapa.tipo !== "aberta") {
      totaisFim[etapa.id] = (totaisFim[etapa.id] ?? 0) + 1;
      if (!contato.etapa_desde || Date.parse(contato.etapa_desde) < limite) continue;
    }
    const u = ultimaMensagem(estado, conversa.id);
    linhas.push({ contato, conversa, ultima: u ? (comCitacao(u) as MensagemDados) : null });
  }
  return { linhas, totaisFim, desdeFim };
}

/** A busca do exemplo, com a regra do buscar_quadro (sem acento, nome, empresa, WhatsApp e mensagens, até 50). */
export function buscaDoExemplo(estado: Pick<EstadoExemplo, "contatos" | "conversas" | "mensagens">, texto: string): string[] {
  const q = textoDeBusca(texto.trim());
  if (!q) return [];
  const conversaDe = new Map(estado.conversas.map((c) => [c.contato_id, c] as const));
  const textos = new Map<string, string>();
  for (const m of estado.mensagens) {
    if (m.apagada_em) continue;
    textos.set(m.conversa_id, `${textos.get(m.conversa_id) ?? ""} ${textoDeBusca(m.texto)} ${textoDeBusca(m.transcricao)}`);
  }
  const achados = estado.contatos.filter((c) => {
    const cv = conversaDe.get(c.id);
    return (
      textoDeBusca(c.nome).includes(q) ||
      textoDeBusca(c.empresa).includes(q) ||
      textoDeBusca(c.nome_whatsapp).includes(q) ||
      (!!cv && (textos.get(cv.id) ?? "").includes(q))
    );
  });
  const quando = (id: string) => {
    const t = conversaDe.get(id)?.ultima_mensagem_em;
    return t ? Date.parse(t) : -Infinity;
  };
  return achados
    .sort((a, b) => quando(b.id) - quando(a.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_RESULTADOS_BUSCA)
    .map((c) => c.id);
}

/** O "Desde que você saiu" do exemplo (o exemplo não guarda a rodada: sem motivo da Janete). */
export function desdeDoExemplo(estado: Pick<EstadoExemplo, "historico" | "eventos" | "mensagens">, saida: string): DesdeQuadro {
  const desde = Date.parse(saida);
  return {
    historico: estado.historico
      .filter((h) => Date.parse(h.criado_em) >= desde)
      .sort(porCriadoEm)
      .map((h) => ({ ...h, rodada_id: null })),
    motivos: {},
    passagens: estado.eventos
      .filter((e) => e.tipo === "passou" && Date.parse(e.criado_em) >= desde)
      .sort(porCriadoEm)
      .map((e) => ({ ...e })),
    respostas: estado.mensagens.filter(
      (m) => m.origem === "janete" && (STATUS_SAIU as readonly string[]).includes(m.status) && Date.parse(m.momento) >= desde,
    ).length,
  };
}

const EXEMPLO: LeiturasKanban = {
  useQuadro: () => {
    const { estado } = useExemplo();
    const agora = useHoraAtual();
    return useMemo(() => pronta(quadroDoExemplo(estado, agora)), [estado, agora]);
  },
  useJaneteTrabalhando: () => {
    const { estado } = useExemplo();
    return useMemo(() => pronta(estado.digitando), [estado.digitando]);
  },
  useDesdeQuadro: (saida) => {
    const { estado } = useExemplo();
    return useMemo<Leitura<DesdeQuadro>>(
      () =>
        saida
          ? pronta(desdeDoExemplo(estado, saida))
          : { dados: undefined, carregando: true, erro: null, tentarDeNovo: () => {} },
      [estado, saida],
    );
  },
  useBuscaQuadro: (texto) => {
    const { estado } = useExemplo();
    const q = useAtrasado(texto.trim(), ATRASO_BUSCA_MS);
    const ids = useMemo(() => (q ? new Set(buscaDoExemplo(estado, q)) : null), [estado, q]);
    if (!texto.trim()) return { ids: null, buscando: false, erro: null, tentarDeNovo: () => {} };
    return { ids, buscando: q !== texto.trim(), erro: null, tentarDeNovo: () => {} };
  },
};

const LEITURAS: Readonly<Record<ModoDados, LeiturasKanban>> = { banco: BANCO, exemplo: EXEMPLO };

/* ---------- os hooks da tela ---------- */
// O modo não muda enquanto a tela está montada (vem do ProvedorDados em volta), então cada hook chama
// sempre as mesmas leituras, como as de dados/conversa.ts.

/** O quadro (os cards, e o total de Ganho e Perdido). Sem as etapas (ainda carregando), carrega. */
export function useQuadro(etapas: readonly Etapa[] | undefined): Leitura<DadosQuadro> {
  return LEITURAS[useModoDados()].useQuadro(etapas);
}

/** As conversas em que a Janete está trabalhando agora (no exemplo, as que estão "digitando"). */
export function useJaneteTrabalhando(): Leitura<string[]> {
  return LEITURAS[useModoDados()].useJaneteTrabalhando();
}

/** O "Desde que você saiu", a partir de `saida` (ISO). Sem saída, carrega. */
export function useDesdeQuadro(saida: string | null, etapas: readonly Etapa[] | undefined): Leitura<DesdeQuadro> {
  return LEITURAS[useModoDados()].useDesdeQuadro(saida, etapas);
}

/** A busca do quadro, com o atraso curto ao digitar. */
export function useBuscaQuadro(texto: string): BuscaQuadro {
  return LEITURAS[useModoDados()].useBuscaQuadro(texto);
}
