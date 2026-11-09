import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { raizesDaTabela, CHAVES, type ChaveRaiz } from "./chaves";
import { useClienteDados } from "./ProvedorDados";

// O tempo real com um dono só (spec 2.1, tempoReal.tsx; plano, "Peças comuns", item 3): um canal,
// montado na casca, que escuta as tabelas da publicação e deixa velhas as raízes que leem cada uma
// (o mesmo POR_TABELA das ações). As raízes de uma rajada de avisos se juntam e são invalidadas uma
// vez a cada ~300 ms (criarJuntador). O DELETE tira a linha dos caches pelo id na hora, antes de reler.
// Quando o canal volta depois de cair, ou a janela volta ao foco, relê tudo o que está aberto.
// No modo exemplo (sem cliente), não faz nada.

/** As tabelas que a migration 0000 pôs na publicação. */
export const TABELAS_TEMPO_REAL_HOJE = ["mensagens", "conversas", "contatos"] as const;

/**
 * As que o pacote do banco pôs na publicação (envio 4, migration 0010). `conexoes` e `ia_chaves`
 * ficam de fora: as leituras delas relêem no foco e a cada 60 s.
 */
export const TABELAS_TEMPO_REAL_PACOTE = ["etapas", "contato_etapa_historico", "rodadas", "membros", "conversa_eventos"] as const;

/** As 8 tabelas que o assinante escuta: todas as da publicação `firebase_realtime`. */
export const TABELAS_TEMPO_REAL: readonly string[] = [...TABELAS_TEMPO_REAL_HOJE, ...TABELAS_TEMPO_REAL_PACOTE];

export const NOME_CANAL = "plataforma-dados";

/** O aviso que o Firebase manda em cada mudança (o que este assinante usa dele). */
export interface AvisoMudanca {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  old?: Record<string, unknown> | null | undefined;
  new?: Record<string, unknown> | null | undefined;
}

type ComId = { id?: unknown };

/**
 * Tira a linha do id de uma lista em cache (lista simples, `{ linhas, total }` ou as páginas de uma
 * leitura paginada, `{ pages, pageParams }`); o resto fica igual.
 */
export function removerPorId(dado: unknown, id: unknown): unknown {
  if (dado && typeof dado === "object" && Array.isArray((dado as { pages?: unknown }).pages)) {
    const o = dado as { pages: unknown[] };
    let mudou = false;
    const pages = o.pages.map((p) => {
      const nova = removerPorId(p, id);
      if (nova !== p) mudou = true;
      return nova;
    });
    return mudou ? { ...o, pages } : dado;
  }
  if (Array.isArray(dado)) {
    const resto = dado.filter((x) => !(x && typeof x === "object" && (x as ComId).id === id));
    return resto.length === dado.length ? dado : resto;
  }
  if (dado && typeof dado === "object" && Array.isArray((dado as { linhas?: unknown }).linhas)) {
    const o = dado as { linhas: unknown[]; total?: unknown };
    const linhas = removerPorId(o.linhas, id) as unknown[];
    if (linhas === o.linhas) return dado;
    const total = typeof o.total === "number" ? Math.max(0, o.total - (o.linhas.length - linhas.length)) : o.total;
    return { ...o, linhas, total };
  }
  if (dado && typeof dado === "object" && (dado as ComId).id === id) return null;
  return dado;
}

/** O DELETE tira a linha do id dos caches das raízes da tabela, na hora. Devolve as raízes da tabela. */
function tirarApagada(queryClient: QueryClient, aviso: AvisoMudanca): readonly ChaveRaiz[] {
  const raizes = raizesDaTabela(aviso.table);
  if (aviso.eventType === "DELETE") {
    const id = aviso.old?.["id"];
    if (id !== undefined && id !== null) {
      for (const raiz of raizes) {
        queryClient.setQueriesData({ queryKey: CHAVES[raiz] }, (velho: unknown) => removerPorId(velho, id));
      }
    }
  }
  return raizes;
}

/** O que fazer com um aviso, sem juntar: tirar a linha apagada (DELETE) e deixar velhas as raízes da tabela. */
export function aplicarMudanca(queryClient: QueryClient, aviso: AvisoMudanca): readonly ChaveRaiz[] {
  const raizes = tirarApagada(queryClient, aviso);
  for (const raiz of raizes) void queryClient.invalidateQueries({ queryKey: CHAVES[raiz] });
  return raizes;
}

/**
 * Quanto tempo os avisos de uma rajada se juntam antes de invalidar (300 ms). Cada invalidação
 * cancela a busca aberta e começa outra (cancelRefetch), e as consultas do Firebase não usam o sinal
 * de cancelamento: sem juntar, apagar um contato com 500 mensagens relia cada consulta aberta 500 vezes.
 */
export const JUNTAR_AVISOS_MS = 300;

export interface JuntadorAvisos {
  /** Um aviso: o DELETE sai do cache na hora; as raízes entram na próxima invalidação. */
  aviso(aviso: AvisoMudanca): void;
  /** Esquece o que estava esperando (relerAberto já relê tudo). */
  esquecer(): void;
  /** Desmontou: para o relógio sem invalidar. */
  parar(): void;
}

/**
 * Junta as raízes dos avisos num conjunto e invalida cada uma uma vez só, `esperaMs` depois do 1º
 * aviso da rajada (um setTimeout por rajada). Com `esperaMs` 0 ou menos, invalida na hora.
 */
export function criarJuntador(queryClient: QueryClient, esperaMs: number = JUNTAR_AVISOS_MS): JuntadorAvisos {
  const pendentes = new Set<ChaveRaiz>();
  let relogio: ReturnType<typeof setTimeout> | null = null;
  const soltar = () => {
    relogio = null;
    const raizes = [...pendentes];
    pendentes.clear();
    for (const raiz of raizes) void queryClient.invalidateQueries({ queryKey: CHAVES[raiz] });
  };
  return {
    aviso(aviso) {
      for (const raiz of tirarApagada(queryClient, aviso)) pendentes.add(raiz);
      if (esperaMs <= 0) soltar();
      else if (relogio === null) relogio = setTimeout(soltar, esperaMs);
    },
    esquecer() {
      pendentes.clear();
      if (relogio !== null) clearTimeout(relogio);
      relogio = null;
    },
    parar() {
      this.esquecer();
    },
  };
}

/** Relê tudo o que está aberto (o canal voltou, ou a janela voltou ao foco). */
export function relerAberto(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ refetchType: "active" });
}

interface Props {
  /** As tabelas escutadas (testes passam outras). Padrão: TABELAS_TEMPO_REAL. */
  tabelas?: readonly string[] | undefined;
  /** Quanto tempo os avisos de uma rajada se juntam (testes passam 0). Padrão: JUNTAR_AVISOS_MS. */
  juntarMs?: number | undefined;
}

/*
 * O envio da tela e o eco (plano, "Peças comuns", item 3): a mensagem nasce com o id do navegador
 * (envio.ts), mas na v1 não há mensagem otimista. A lista mostra a mensagem depois que o insert volta
 * e a consulta é relida (INVALIDA.enviarMensagem); o eco do tempo real só invalida, então nada se
 * duplica. Se uma área quiser mostrar a mensagem antes do insert, o casamento pelo id fica num
 * ajudante comum em dados/, nunca em cada área.
 */
export function AssinanteTempoReal({ tabelas = TABELAS_TEMPO_REAL, juntarMs = JUNTAR_AVISOS_MS }: Props) {
  const cliente = useClienteDados();
  const queryClient = useQueryClient();
  const chaveTabelas = tabelas.join(",");

  useEffect(() => {
    if (!cliente) return;
    let conectou = false;
    let caiu = false;
    const juntador = criarJuntador(queryClient, juntarMs);
    const relerTudo = () => {
      juntador.esquecer();
      relerAberto(queryClient);
    };
    let canal = cliente.channel(NOME_CANAL);
    for (const tabela of chaveTabelas.split(",").filter(Boolean)) {
      canal = canal.on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: tabela },
        (aviso: AvisoMudanca) => {
          juntador.aviso(aviso);
        },
      );
    }
    canal.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        // Voltou depois de cair: o que mudou enquanto estava fora não chegou; relê o que está aberto.
        if (conectou && caiu) relerTudo();
        conectou = true;
        caiu = false;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        caiu = true;
      }
    });

    // O foco e o visibilitychange chegam juntos ao voltar para a aba: relê uma vez só.
    let ultimaReleitura = 0;
    const aoVoltar = () => {
      if (document.visibilityState === "hidden") return;
      const agora = Date.now();
      if (agora - ultimaReleitura < 1000) return;
      ultimaReleitura = agora;
      relerTudo();
    };
    window.addEventListener("focus", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      window.removeEventListener("focus", aoVoltar);
      document.removeEventListener("visibilitychange", aoVoltar);
      juntador.parar();
      void cliente.removeChannel(canal);
    };
  }, [cliente, queryClient, chaveTabelas, juntarMs]);

  return null;
}
