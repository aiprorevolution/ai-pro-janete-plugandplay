import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { opcoesConfiguracao, opcoesEu, type ClienteFirebase, type Eu } from "@/features/plataforma/dados";
import { firebase } from "@/integrations/firebase/client";

// O prefixo "-" tira este arquivo da árvore de rotas (routeFileIgnorePrefix do TanStack): ele só
// junta a regra de acesso usada por /, /onboarding, /app e /sem-acesso (spec de ligar as telas ao
// banco, 2.2, e decisões 1 e 2).
//
// A sessão do Firebase fica no navegador, então
// as rotas que dependem dela rodam com `ssr: false`: o servidor não sabe quem está logado. Esta proteção
// só decide o que mostrar; a API autenticada e as regras Firebase protegem os dados.

export type DestinoInicial = "/entrar" | "/sem-acesso" | "/onboarding" | "/app";

type MembroEu = Eu["membro"];

/** A conta logada: sem sessão; com sessão e sem acesso (eu = null); ou com o membro ativo. */
export type SituacaoConta = { logado: false } | { logado: true; eu: MembroEu | null };

/**
 * Para onde vai quem abre /:
 * - sem sessão → /entrar;
 * - sem Eu (a conta não é membro, ou foi desativada) → /sem-acesso (decisão 1);
 * - admin com o onboarding da empresa ainda aberto → /onboarding (decisão 2);
 * - senão (o atendente sempre) → /app.
 */
export function destinoInicial({
  logado,
  eu,
  concluido,
}: {
  logado: boolean;
  eu: Pick<MembroEu, "papel"> | null;
  concluido: boolean;
}): DestinoInicial {
  if (!logado) return "/entrar";
  if (!eu) return "/sem-acesso";
  if (eu.papel === "admin" && !concluido) return "/onboarding";
  return "/app";
}

/** O id do usuário da sessão do Firebase na aba. Qualquer falha (cliente sem configuração, rede) conta como sem sessão. */
async function idDaSessao(cliente: ClienteFirebase): Promise<string | null> {
  try {
    const { data, error } = await cliente.auth.getSession();
    if (error) return null;
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** true quando há sessão do Firebase na aba. */
export async function temSessao(cliente: ClienteFirebase = firebase): Promise<boolean> {
  return (await idDaSessao(cliente)) !== null;
}

/**
 * Quem está logado e se tem acesso: o Eu (`carregarEu`, spec 2.2) pelo `ensureQueryData` do router,
 * que fica no cache para o Layout ler sem esperar. Um Eu guardado que não serve (nulo, ou de outra
 * conta que entrou nesta aba) é lido de novo antes de decidir. A leitura que falha (rede) lança: a
 * página de erro da raiz mostra "Tentar de novo".
 */
export async function lerConta(queryClient: QueryClient, cliente: ClienteFirebase = firebase): Promise<SituacaoConta> {
  const uid = await idDaSessao(cliente);
  if (!uid) return { logado: false };
  const opcoes = opcoesEu(cliente);
  const guardado = queryClient.getQueryData(opcoes.queryKey);
  const serve = guardado === undefined || (guardado !== null && guardado.user_id === uid);
  const eu = serve
    ? await queryClient.ensureQueryData(opcoes)
    : await queryClient.fetchQuery({ ...opcoes, staleTime: 0 });
  return { logado: true, eu };
}

/**
 * Se o onboarding da empresa terminou (decisão 2): só `configuracao.onboarding_concluido_em`, que o
 * fim do onboarding grava por `concluir_onboarding()`. O marcador da aba (sessionStorage) não conta:
 * o admin precisa concluir pela tela, senão a Janete não atende (o `pegar_rodadas` devolve vazio
 * enquanto a data for nula). Só o admin pergunta (o atendente nunca vai para o onboarding).
 *
 * A data, uma vez gravada, não volta a ser nula (`concluir_onboarding` usa coalesce): o "concluído"
 * em cache vale; o "não concluído" em cache é lido de novo, para quem acabou de concluir (nesta aba
 * ou em outra) não voltar ao onboarding por um cache velho.
 */
export async function onboardingDaEmpresaConcluido(
  queryClient: QueryClient,
  cliente: ClienteFirebase = firebase,
): Promise<boolean> {
  const opcoes = opcoesConfiguracao(cliente);
  const guardada = queryClient.getQueryData(opcoes.queryKey);
  if (guardada && guardada.onboarding_concluido_em !== null) return true;
  const configuracao = await queryClient.fetchQuery({ ...opcoes, staleTime: 0 });
  return configuracao.onboarding_concluido_em !== null;
}

/** O destino de quem está logado, lido do banco (para / e /sem-acesso). */
async function destinoDaConta(queryClient: QueryClient, cliente: ClienteFirebase): Promise<DestinoInicial> {
  const conta = await lerConta(queryClient, cliente);
  if (!conta.logado) return "/entrar";
  const concluido = conta.eu?.papel === "admin" ? await onboardingDaEmpresaConcluido(queryClient, cliente) : true;
  return destinoInicial({ logado: true, eu: conta.eu, concluido });
}

/** Para o beforeLoad de /: manda para entrar, sem acesso, onboarding ou app. */
export async function redirecionarDaRaiz(queryClient: QueryClient, cliente: ClienteFirebase = firebase): Promise<never> {
  throw redirect({ to: await destinoDaConta(queryClient, cliente), replace: true });
}

/** Para o beforeLoad de /app: exige sessão e Eu (membro ativo). */
export async function exigirAcesso(queryClient: QueryClient, cliente: ClienteFirebase = firebase): Promise<void> {
  const conta = await lerConta(queryClient, cliente);
  if (!conta.logado) throw redirect({ to: "/entrar", replace: true });
  if (!conta.eu) throw redirect({ to: "/sem-acesso", replace: true });
}

/** Para o beforeLoad de /onboarding: só o admin, e só enquanto o onboarding da empresa não terminou. */
export async function exigirOnboardingAberto(queryClient: QueryClient, cliente: ClienteFirebase = firebase): Promise<void> {
  const conta = await lerConta(queryClient, cliente);
  if (!conta.logado) throw redirect({ to: "/entrar", replace: true });
  if (!conta.eu) throw redirect({ to: "/sem-acesso", replace: true });
  if (conta.eu.papel !== "admin") throw redirect({ to: "/app", replace: true });
  if (await onboardingDaEmpresaConcluido(queryClient, cliente)) throw redirect({ to: "/app", replace: true });
}

/** Para o beforeLoad de /sem-acesso: sem sessão vai para /entrar; quem tem acesso segue para o destino dele. */
export async function exigirSemAcesso(queryClient: QueryClient, cliente: ClienteFirebase = firebase): Promise<void> {
  const destino = await destinoDaConta(queryClient, cliente);
  if (destino !== "/sem-acesso") throw redirect({ to: destino, replace: true });
}
