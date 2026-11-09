import { queryOptions } from "@tanstack/react-query";

import { estaAguardando } from "../exemplo/regras";
import type { ChaveIA, Conexao, Conversa, Etapa, Membro } from "../exemplo/tipos";
import { CHAVES } from "./chaves";
import {
  COLUNAS_CHAVE_IA,
  COLUNAS_CONEXAO,
  COLUNAS_CONFIGURACAO,
  COLUNAS_CONTEXTO,
  COLUNAS_CONVERSA,
  COLUNAS_ETAPA,
  COLUNAS_MEMBRO,
  lerTodas,
  type ClienteFirebase,
} from "./colunas";
import { SemLinhas, traduzirErro } from "./erros";
import { lerVistos, type ConfiguracaoDados, type Eu, type VersaoContextoBanco } from "./tipos";

// As leituras comuns do modo banco (spec 2.1, FonteDados; plano, "Peças comuns", item 5), como
// `queryOptions` do React Query: o ProvedorDados usa nos hooks, e a rota pode usar no
// `ensureQueryData` (o Eu da 2.2). Todas pelo cliente do navegador, sob RLS, com as colunas listadas.
// A consulta que dá erro lança o erro cru; quem mostra passa por `traduzirErro`.

/** As leituras que mudam sem tempo real (conexoes e ia_chaves ficam fora da publicação): relidas a cada 60 s. */
export const RELER_SEM_TEMPO_REAL_MS = 60_000;

/** Quanto tempo uma leitura comum vale antes de ser relida ao montar outra tela (o tempo real invalida antes). */
const VALE_MS = 15_000;

/** Quantas vezes uma leitura que falhou por rede (ou erro desconhecido) é tentada de novo. */
export const REPETIR_LEITURA_VEZES = 3;

/**
 * O retry das leituras: só o erro que pode passar com nova tentativa (`falha`: rede ou desconhecido)
 * é repetido, até 3 vezes. `sem_acesso`, `nao_encontrado` (o SemLinhas da configuração do atendente) e
 * os outros mostram o erro na hora, em vez de deixar a tela uns 7 s em "carregando".
 */
export function repetirSoFalha(tentativas: number, erro: Error): boolean {
  return traduzirErro(erro).erro === "falha" && tentativas < REPETIR_LEITURA_VEZES;
}

/**
 * O Eu (spec 2.2): a linha de `membros` da conta logada. Uma linha ativa → o membro; sem sessão, sem
 * linha (a RLS esconde de quem não é membro) ou inativo → null.
 */
export async function carregarEu(cliente: ClienteFirebase): Promise<Eu["membro"] | null> {
  const { data: sessao, error: erroSessao } = await cliente.auth.getSession();
  if (erroSessao) throw erroSessao;
  const uid = sessao.session?.user.id;
  if (!uid) return null;
  const { data, error } = await cliente.from("membros").select(COLUNAS_MEMBRO).eq("user_id", uid).maybeSingle();
  if (error) throw error;
  if (!data || !data.ativo) return null;
  // `vistos` é jsonb: só as chaves conhecidas (kanban, tour), com texto, chegam à tela.
  return { ...data, vistos: lerVistos(data.vistos) };
}

export function opcoesEu(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: CHAVES.eu,
    queryFn: () => carregarEu(cliente),
    staleTime: 60_000,
    retry: repetirSoFalha,
    // Eu é relido quando a janela volta ao foco (spec 2.2).
    refetchOnWindowFocus: "always",
  });
}

export function opcoesMembros(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.membros, "todos"] as const,
    queryFn: async (): Promise<Membro[]> => {
      const { data, error } = await cliente
        .from("membros")
        .select(COLUNAS_MEMBRO)
        .order("criado_em", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesEtapas(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.etapas, "todas"] as const,
    queryFn: async (): Promise<Etapa[]> => {
      const { data, error } = await cliente
        .from("etapas")
        .select(COLUNAS_ETAPA)
        .order("ordem", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesConexaoAtiva(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.conexao, "ativa"] as const,
    queryFn: async (): Promise<Conexao | null> => {
      const { data, error } = await cliente.from("conexoes").select(COLUNAS_CONEXAO).eq("ativa", true).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
    refetchInterval: RELER_SEM_TEMPO_REAL_MS,
    refetchOnWindowFocus: "always",
  });
}

export function opcoesConfiguracao(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.configuracao, "empresa"] as const,
    queryFn: async (): Promise<ConfiguracaoDados> => {
      // Todo membro lê (policy configuracao_membro_le): o atendente também sabe se o onboarding
      // terminou. Sem linha visível (a conta não é membro), a leitura dá nao_encontrado.
      const { data, error } = await cliente.from("configuracao").select(COLUNAS_CONFIGURACAO).eq("id", 1).maybeSingle();
      if (error) throw error;
      if (!data) throw new SemLinhas("configuracao");
      return data;
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
    // `configuracao` não está no tempo real, e o `worker_visto_em` muda a cada passada do motor. Sem
    // esta releitura, a tela aberta e em foco envelhece o sinal (a Saúde usa para dizer que a cópia
    // nova ainda espera a 1ª mensagem, spec-motor-acordado). Relida a cada 60 s, como o motor
    // (dados/motor.ts). Custa uma leitura de 1 linha por minuto por aba.
    refetchInterval: RELER_SEM_TEMPO_REAL_MS,
  });
}

export function opcoesContextoAtual(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.contexto, "atual"] as const,
    queryFn: async (): Promise<VersaoContextoBanco | null> => {
      const { data, error } = await cliente
        .from("contexto_versoes")
        .select(COLUNAS_CONTEXTO)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** Quem espera alguém da equipe há mais tempo vem primeiro (desempate pelo id). */
function porEspera(a: Conversa, b: Conversa): number {
  const ta = a.aguardando_humano_desde ? Date.parse(a.aguardando_humano_desde) : 0;
  const tb = b.aguardando_humano_desde ? Date.parse(b.aguardando_humano_desde) : 0;
  return ta - tb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** "Precisam de você" pela regra de `estaAguardando`, aplicada a qualquer lista de conversas. */
export function filtrarAguardando(conversas: readonly Conversa[]): Conversa[] {
  return conversas.filter((c) => estaAguardando(c)).sort(porEspera);
}

export function opcoesAguardando(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.aguardando, "todas"] as const,
    queryFn: async (): Promise<Conversa[]> => {
      // Sem paginação na tela, mas o PostgREST corta em 1.000: lê de 1.000 em 1.000.
      const linhas = await lerTodas<Conversa>((de, ate) =>
        cliente
          .from("conversas")
          .select(COLUNAS_CONVERSA)
          .eq("modo", "humano")
          .is("responsavel_id", null)
          .not("aguardando_humano_desde", "is", null)
          .order("aguardando_humano_desde", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      );
      return filtrarAguardando(linhas);
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesChaves(cliente: ClienteFirebase, ehAdmin: boolean) {
  return queryOptions({
    queryKey: [...CHAVES.chaves, "todas"] as const,
    queryFn: async (): Promise<ChaveIA[]> => {
      const { data, error } = await cliente
        .from("ia_chaves")
        .select(COLUNAS_CHAVE_IA)
        .neq("status", "removida")
        .order("finalidade", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    // Só o admin lê (policy ia_chaves_admin_le); o atendente nem pergunta.
    enabled: ehAdmin,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
    refetchInterval: ehAdmin ? RELER_SEM_TEMPO_REAL_MS : false,
    refetchOnWindowFocus: "always",
  });
}
