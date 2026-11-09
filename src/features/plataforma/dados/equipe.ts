import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import type { BaseEquipe, ContatoEquipe } from "../equipe/dados";
import { useExemplo } from "../exemplo/ProvedorExemplo";
import type { Conversa, Convite, Membro, PapelMembro } from "../exemplo/tipos";
import { CHAVES, raizesDaTabela, type ChaveRaiz, type Tabela } from "./chaves";
import { COLUNAS_CONVERSA, lerTodas, type ClienteFirebase } from "./colunas";
import { recusado } from "./erros";
import { pronta } from "./leitura";
import { RELER_SEM_TEMPO_REAL_MS, repetirSoFalha } from "./leituras";
import { useClienteDados, useDados, useModoDados } from "./ProvedorDados";
import type { Erro, Leitura, Resultado } from "./tipos";

// As leituras e as ações da Equipe (spec de ligar as telas ao banco, 2.1 "as leituras de cada área",
// 2.3 e 2.4; task C7). A tela lê só daqui: `useEquipe()` e `useAcoesEquipe()`.
//
// Igual nos dois modos:
// - banco: os membros, as etapas e a fila ("Precisam de você") pelas leituras comuns do
//   ProvedorDados; os convites (só o admin) e as conversas com alguém da equipe, com os contatos e o
//   "Estava com" (o último evento voltou_para_fila de conversa_eventos), por React Query aqui. As
//   ações: as rpcs trocar_papel_membro, desativar_membro e reativar_membro (cliente do navegador,
//   sob RLS) e as funções de servidor de equipe/equipe.functions.ts (convite).
// - exemplo (os testes): o estado do ProvedorExemplo, e as ações do reducer, assíncronas.

/** As colunas de `convites` que a tela lê (sem `user_id`). */
export const COLUNAS_CONVITE = "id, email, papel, convidado_por, enviado_em" as const;
/** As colunas de `contatos` que a Equipe usa: o nome (como no Chat) e a etapa. */
export const COLUNAS_CONTATO_EQUIPE = "id, nome, nome_whatsapp, telefone, etapa_id" as const;

/** Quantos ids vão em cada `in(...)` (a URL do PostgREST tem limite de tamanho). */
export const LOTE_IDS = 100;

/** Quanto tempo a leitura vale antes de ser relida ao montar a tela (o tempo real invalida antes). */
const VALE_MS = 15_000;

/** O aviso de um convite gravado cujo e-mail não saiu: o admin usa "Copiar link". */
export type AvisoConvite = "email_nao_enviado";

/** O resultado das ações de convite: o de sempre, com o aviso do e-mail quando ele não saiu. */
export type ResultadoConvite<T = undefined> =
  | { ok: true; id?: string | undefined; valor?: T | undefined; aviso?: AvisoConvite | undefined }
  | { ok: false; erro: Erro; detalhe?: string | undefined };

export interface AcoesEquipe {
  /**
   * Só o admin. `id` = o convite novo. Recusa: email_invalido, email_em_uso (detalhe: membro, convite),
   * proprio_membro. O e-mail que já tem conta (criada sem convite) recebe o link de acesso dela.
   */
  convidar(email: string, papel: PapelMembro): Promise<ResultadoConvite>;
  /**
   * Só o admin. `valor` = o link para o "Copiar link" (decisão 1). Recusa email_em_uso (detalhe: conta)
   * quando a conta presa ao convite foi trocada por outra com o mesmo e-mail.
   */
  linkDoConvite(conviteId: string): Promise<ResultadoConvite<string>>;
  /** Só o admin. Manda um link novo (decisão 15). Recusa email_em_uso (detalhe: conta) como o linkDoConvite. */
  reenviarConvite(conviteId: string): Promise<ResultadoConvite>;
  /** Só o admin. O convite some e o link deixa de levar para a equipe. */
  cancelarConvite(conviteId: string): Promise<Resultado>;
  /** Só o admin, nunca em si mesmo (proprio_membro) nem deixando a equipe sem admin (ultimo_admin). */
  trocarPapel(membroId: string, papel: PapelMembro): Promise<Resultado>;
  /** Só o admin. `valor` = as conversas que voltaram para a fila (o realce). */
  desativar(membroId: string): Promise<Resultado<string[]>>;
  /** Só o admin. As conversas não voltam para a pessoa. */
  reativar(membroId: string): Promise<Resultado>;
}

/** A resposta das funções de servidor do convite (equipe.functions.ts), no que a camada usa. */
type RespostaServidor = { ok: boolean; erro?: string; mensagem?: string; conviteId?: string; link?: string; aviso?: string };

/** As funções de servidor do convite. Por parâmetro nos testes; padrão: as de equipe.functions.ts. */
export interface ServidorEquipe {
  convidarMembro(email: string, papel: PapelMembro): Promise<RespostaServidor>;
  linkDoConvite(conviteId: string): Promise<RespostaServidor>;
  reenviarConvite(conviteId: string): Promise<RespostaServidor>;
  cancelarConvite(conviteId: string): Promise<RespostaServidor>;
}

/**
 * As funções de servidor de verdade, carregadas na 1ª ação (import dinâmico): a tela não carrega o
 * módulo do servidor só para ler, e os testes que só leem não precisam dele.
 */
export const servidorEquipePadrao: ServidorEquipe = {
  convidarMembro: async (email, papel) => (await import("../equipe/equipe.functions")).convidarMembro({ data: { email, papel } }),
  linkDoConvite: async (conviteId) => (await import("../equipe/equipe.functions")).linkDoConvite({ data: { conviteId } }),
  reenviarConvite: async (conviteId) => (await import("../equipe/equipe.functions")).reenviarConvite({ data: { conviteId } }),
  cancelarConvite: async (conviteId) => (await import("../equipe/equipe.functions")).cancelarConvite({ data: { conviteId } }),
};

/* ---------- modo banco: leituras ---------- */

export function opcoesConvites(cliente: ClienteFirebase, admin: boolean) {
  return queryOptions({
    queryKey: [...CHAVES.convites, "pendentes"] as const,
    queryFn: async (): Promise<Convite[]> =>
      // Só o admin lê (policy convites_admin_le). Pequena, mas sem confiar no corte de 1.000.
      lerTodas<Convite>((de, ate) =>
        cliente
          .from("convites")
          .select(COLUNAS_CONVITE)
          .order("criado_em", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      ),
    enabled: admin,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
    // `convites` não está no tempo real: quem aceita some na próxima releitura (ou quando `membros` muda).
    refetchInterval: admin ? RELER_SEM_TEMPO_REAL_MS : false,
    refetchOnWindowFocus: "always",
  });
}

/** As conversas que a Equipe mostra (com alguém, ou esperando alguém), com os contatos delas. */
export interface ConversasDaEquipe {
  conversas: Conversa[];
  contatos: ContatoEquipe[];
}

function emLotes<T>(lista: readonly T[], tamanho = LOTE_IDS): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

type EventoFila = { id: string; conversa_id: string; tipo: string; de_membro_id: string | null; criado_em: string };

/**
 * Para cada conversa que espera, quem estava com ela quando voltou para a fila: o `de_membro_id` do
 * último evento dela, se esse evento for `voltou_para_fila` (a pessoa foi desativada, 2.6). Qualquer
 * evento depois (assumiu, devolveu, passou) apaga a marca, como o `estavaCom` do exemplo.
 */
export function estavaComDosEventos(eventos: readonly EventoFila[]): Map<string, string> {
  const ultimo = new Map<string, EventoFila>();
  for (const e of eventos) {
    const antes = ultimo.get(e.conversa_id);
    const depois =
      !antes ||
      Date.parse(e.criado_em) > Date.parse(antes.criado_em) ||
      (Date.parse(e.criado_em) === Date.parse(antes.criado_em) && e.id > antes.id);
    if (depois) ultimo.set(e.conversa_id, e);
  }
  const estavaCom = new Map<string, string>();
  for (const [conversaId, e] of ultimo) {
    if (e.tipo === "voltou_para_fila" && e.de_membro_id) estavaCom.set(conversaId, e.de_membro_id);
  }
  return estavaCom;
}

export function opcoesConversasDaEquipe(cliente: ClienteFirebase) {
  return queryOptions({
    // Embaixo de `conversas`: muda junto com conversas, mensagens, contatos e etapas (POR_TABELA).
    queryKey: [...CHAVES.conversas, "equipe"] as const,
    queryFn: async (): Promise<ConversasDaEquipe> => {
      // Com alguém da equipe, ou esperando alguém: de 1.000 em 1.000, com desempate pelo id.
      const linhas = await lerTodas<Conversa>((de, ate) =>
        cliente
          .from("conversas")
          .select(COLUNAS_CONVERSA)
          .eq("modo", "humano")
          .or("responsavel_id.not.is.null,aguardando_humano_desde.not.is.null")
          .order("id", { ascending: true })
          .range(de, ate),
      );

      const idsContatos = [...new Set(linhas.map((c) => c.contato_id))];
      const contatos: ContatoEquipe[] = [];
      for (const lote of emLotes(idsContatos)) {
        const { data, error } = await cliente.from("contatos").select(COLUNAS_CONTATO_EQUIPE).in("id", lote);
        if (error) throw error;
        contatos.push(...(data ?? []));
      }

      const esperando = linhas.filter((c) => !c.responsavel_id && c.aguardando_humano_desde).map((c) => c.id);
      const eventos: EventoFila[] = [];
      for (const lote of emLotes(esperando)) {
        const doLote = await lerTodas<EventoFila>((de, ate) =>
          cliente
            .from("conversa_eventos")
            .select("id, conversa_id, tipo, de_membro_id, criado_em")
            .in("conversa_id", lote)
            .order("criado_em", { ascending: true })
            .order("id", { ascending: true })
            .range(de, ate),
        );
        eventos.push(...doLote);
      }
      const estavaCom = estavaComDosEventos(eventos);
      const conversas = linhas.map((c) => {
        const de = estavaCom.get(c.id);
        return de ? { ...c, estavaCom: de } : c;
      });
      return { conversas, contatos };
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/**
 * Junta a fila (as conversas de `useAguardando`, a regra da casca) com as conversas da Equipe: a fila
 * manda em quem espera; a leitura da Equipe dá o contato e o "Estava com". Uma conversa da fila que a
 * leitura da Equipe ainda não viu entra sem contato ("Sem nome") até a próxima releitura.
 */
export function juntarConversas(aguardando: readonly Conversa[], daEquipe: readonly Conversa[]): Conversa[] {
  const porId = new Map(daEquipe.map((c) => [c.id, c]));
  const naFila = new Set(aguardando.map((c) => c.id));
  const fila = aguardando.map((c) => {
    const estavaCom = porId.get(c.id)?.estavaCom;
    return estavaCom ? { ...c, estavaCom } : c;
  });
  const comAlguem = daEquipe.filter((c) => !naFila.has(c.id) && c.responsavel_id);
  return [...fila, ...comAlguem];
}

/**
 * Junta várias leituras numa só: carrega enquanto alguma carrega; o 1º erro vale; "Tentar de novo"
 * relê todas. Os dados saem sempre que todas já têm dados, mesmo com erro: o React Query guarda o
 * erro de uma releitura em segundo plano junto com os dados antigos, e a tela pronta não pode virar
 * a tela de erro por isso (fecharia a gaveta do convite e o diálogo abertos). Quem mostra decide:
 * sem dados, a tela de erro; com dados, um aviso compacto.
 */
export function juntarLeituras<T>(leituras: readonly Leitura<unknown>[], dados: () => T): Leitura<T> {
  const erro = leituras.find((l) => l.erro)?.erro ?? null;
  const todasComDados = leituras.every((l) => l.dados !== undefined);
  const carregando = !erro && !todasComDados && leituras.some((l) => l.carregando);
  return {
    dados: todasComDados ? dados() : undefined,
    carregando,
    erro,
    tentarDeNovo: () => {
      for (const l of leituras) if (l.erro) l.tentarDeNovo();
    },
  };
}

function useEquipeBanco(): Leitura<BaseEquipe> {
  const fonte = useDados();
  const cliente = useClienteDados();
  const queryClient = useQueryClient();
  const { membro: eu, ehAdmin: admin } = fonte.useEu();
  const membros = fonte.useMembros();
  const etapas = fonte.useEtapas();
  const aguardando = fonte.useAguardando();
  if (!cliente) throw new Error("useEquipe(): o modo banco precisa do cliente do Firebase.");
  const convitesQ = useQuery(opcoesConvites(cliente, admin));
  const conversasQ = useQuery(opcoesConversasDaEquipe(cliente));

  // Quem aceita o convite vira membro (tempo real em `membros`) e o convite sai (sem tempo real):
  // quando a lista de membros muda, os convites são relidos junto.
  const assinatura = (membros.dados ?? []).map((m) => m.id).join("|");
  const ultima = useRef(assinatura);
  useEffect(() => {
    if (ultima.current === assinatura) return;
    ultima.current = assinatura;
    if (admin) void queryClient.invalidateQueries({ queryKey: CHAVES.convites });
  }, [assinatura, admin, queryClient]);

  const convites: Leitura<Convite[]> = admin
    ? {
        dados: convitesQ.data,
        carregando: convitesQ.isPending,
        erro: convitesQ.error ? recusado(convitesQ.error).erro : null,
        tentarDeNovo: () => void convitesQ.refetch(),
      }
    : pronta<Convite[]>([]);
  const conversas: Leitura<ConversasDaEquipe> = {
    dados: conversasQ.data,
    carregando: conversasQ.isPending,
    erro: conversasQ.error ? recusado(conversasQ.error).erro : null,
    tentarDeNovo: () => void conversasQ.refetch(),
  };

  const d = { m: membros.dados, e: etapas.dados, a: aguardando.dados, c: convites.dados, v: conversas.dados };
  const base = useMemo<BaseEquipe | undefined>(() => {
    if (!d.m || !d.e || !d.a || !d.c || !d.v) return undefined;
    return {
      eu,
      membros: d.m,
      etapas: d.e,
      convites: d.c,
      conversas: juntarConversas(d.a, d.v.conversas),
      contatos: d.v.contatos,
    };
  }, [eu, d.m, d.e, d.a, d.c, d.v]);

  return juntarLeituras([membros, etapas, aguardando, convites, conversas], () => base!);
}

function useEquipeExemplo(): Leitura<BaseEquipe> {
  const { estado } = useExemplo();
  return useMemo(() => pronta<BaseEquipe>(estado), [estado]);
}

/* ---------- modo banco: ações ---------- */

/** Invalida as raízes das tabelas e espera as leituras abertas voltarem (a tela realça e foca já no estado novo). */
async function invalidarTabelas(queryClient: QueryClient, tabelas: readonly Tabela[]): Promise<void> {
  const raizes = new Set<ChaveRaiz>();
  for (const t of tabelas) for (const r of raizesDaTabela(t)) raizes.add(r);
  try {
    await Promise.all([...raizes].map((r) => queryClient.invalidateQueries({ queryKey: CHAVES[r] })));
  } catch {
    // a releitura que falhou mostra o erro na própria leitura; a ação já deu certo
  }
}

/** O que cada ação muda no banco (para invalidar pelas tabelas, como o INVALIDA da camada). */
export const TABELAS_EQUIPE = {
  convidar: ["convites", "auditoria"],
  linkDoConvite: ["convites"],
  reenviarConvite: ["convites", "auditoria"],
  cancelarConvite: ["convites", "auditoria"],
  trocarPapel: ["membros", "auditoria"],
  // as conversas voltam para a fila (sem responsável, aguardando agora) com o evento voltou_para_fila
  desativar: ["membros", "conversas", "conversa_eventos", "auditoria"],
  reativar: ["membros", "auditoria"],
} as const satisfies Record<keyof AcoesEquipe, readonly Tabela[]>;

export function criarAcoesEquipeBanco(
  cliente: ClienteFirebase,
  queryClient: QueryClient,
  servidor: ServidorEquipe = servidorEquipePadrao,
): AcoesEquipe {
  // Toda ação: nunca lança; deu certo, invalida pelas tabelas que mudou; sem_acesso relê o Eu.
  async function executar<R extends { ok: boolean; erro?: Erro }>(acao: keyof AcoesEquipe, fazer: () => Promise<R>): Promise<R> {
    let r: R;
    try {
      r = await fazer();
    } catch (e) {
      r = recusado(e) as unknown as R;
    }
    if (r.ok) await invalidarTabelas(queryClient, TABELAS_EQUIPE[acao]);
    else if (r.erro === "sem_acesso") void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
    return r;
  }

  /** A resposta da função de servidor no formato da camada (a recusa passa pelo traduzirErro). */
  const doServidor = <T,>(r: RespostaServidor, valor?: T): ResultadoConvite<T> => {
    if (!r || r.ok !== true) return recusado(r);
    const aviso = r.aviso === "email_nao_enviado" ? ("email_nao_enviado" as const) : undefined;
    return { ok: true, ...(r.conviteId ? { id: r.conviteId } : {}), ...(valor !== undefined ? { valor } : {}), ...(aviso ? { aviso } : {}) };
  };

  const rpc = async (resposta: PromiseLike<{ error: unknown }>): Promise<Resultado> => {
    const { error } = await resposta;
    return error ? recusado(error) : { ok: true };
  };

  return {
    convidar: (email, papel) => executar("convidar", async () => doServidor(await servidor.convidarMembro(email, papel))),
    linkDoConvite: (conviteId) =>
      executar("linkDoConvite", async () => {
        const r = await servidor.linkDoConvite(conviteId);
        if (r?.ok === true && typeof r.link !== "string") return { ok: false, erro: "falha", detalhe: "sem link" } as const;
        return doServidor<string>(r, r?.link);
      }),
    reenviarConvite: (conviteId) => executar("reenviarConvite", async () => doServidor(await servidor.reenviarConvite(conviteId))),
    cancelarConvite: (conviteId) =>
      executar("cancelarConvite", async (): Promise<Resultado> => {
        const r = await servidor.cancelarConvite(conviteId);
        return r?.ok === true ? { ok: true } : recusado(r);
      }),
    trocarPapel: (membroId, papel) =>
      executar("trocarPapel", () => rpc(cliente.rpc("trocar_papel_membro", { p_membro: membroId, p_papel: papel }))),
    desativar: (membroId) =>
      executar("desativar", async (): Promise<Resultado<string[]>> => {
        const { data, error } = await cliente.rpc("desativar_membro", { p_membro: membroId });
        if (error) return recusado(error);
        return { ok: true, valor: Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : [] };
      }),
    reativar: (membroId) => executar("reativar", () => rpc(cliente.rpc("reativar_membro", { p_membro: membroId }))),
  };
}

/* ---------- modo exemplo: ações ---------- */

function useAcoesEquipeExemplo(): AcoesEquipe {
  const { estado, acoes } = useExemplo();
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  return useMemo<AcoesEquipe>(
    () => ({
      convidar: async (email, papel) => {
        const r = acoes.convidarMembro(email, papel);
        return r.ok ? { ok: true, id: r.id } : { ok: false, erro: r.erro };
      },
      // O exemplo não tem Auth: não há link de verdade para copiar (nunca um link inventado).
      linkDoConvite: async () => ({ ok: false, erro: "falha", detalhe: "o exemplo não gera link" }),
      reenviarConvite: async (conviteId) => acoes.reenviarConvite(conviteId),
      cancelarConvite: async (conviteId) => acoes.cancelarConvite(conviteId),
      trocarPapel: async (membroId, papel) => acoes.trocarPapelMembro(membroId, papel),
      desativar: async (membroId): Promise<Resultado<string[]>> => {
        // As conversas que voltam: as que estavam com a pessoa logo antes (o que desativar_membro devolve).
        const voltam = estadoRef.current.conversas
          .filter((c) => c.modo === "humano" && c.responsavel_id === membroId)
          .map((c) => c.id);
        const r = acoes.desativarMembro(membroId);
        return r.ok ? { ok: true, valor: voltam } : { ok: false, erro: r.erro };
      },
      reativar: async (membroId) => acoes.reativarMembro(membroId),
    }),
    [acoes],
  );
}

function useAcoesEquipeBanco(): AcoesEquipe {
  const cliente = useClienteDados();
  const queryClient = useQueryClient();
  if (!cliente) throw new Error("useAcoesEquipe(): o modo banco precisa do cliente do Firebase.");
  return useMemo(() => criarAcoesEquipeBanco(cliente, queryClient), [cliente, queryClient]);
}

/* ---------- os hooks da tela ---------- */

// O modo vem do <ProvedorDados> (banco ou exemplo) e não muda durante a vida da tela: cada modo
// chama sempre os mesmos hooks, na mesma ordem. Fora do provedor conta como exemplo (os testes
// antigos montam só o ProvedorExemplo).
const LER = { banco: useEquipeBanco, exemplo: useEquipeExemplo } as const;
const AGIR = { banco: useAcoesEquipeBanco, exemplo: useAcoesEquipeExemplo } as const;

/** Tudo o que a tela da Equipe lê, nos 3 estados (carregando, erro, pronta). */
export function useEquipe(): Leitura<BaseEquipe> {
  const ler = LER[useModoDados()];
  return ler();
}

/** As ações da Equipe. Nunca lançam: a recusada devolve o erro. */
export function useAcoesEquipe(): AcoesEquipe {
  const agir = AGIR[useModoDados()];
  return agir();
}

/** O membro do id na base (para os textos da tela). */
export function membroDaBase(base: Pick<BaseEquipe, "membros">, id: string): Membro | undefined {
  return base.membros.find((m) => m.id === id);
}
