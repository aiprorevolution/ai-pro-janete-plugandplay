import { limparEstadoOnboarding } from "@/features/onboarding/estado";
import { esquecerTour } from "@/features/plataforma/tour";

/**
 * Dono do progresso guardado na aba. Nesta onda o estado do onboarding e o marcador do tour ficam no
 * sessionStorage sem dizer de qual conta são; esta chave ao lado guarda o id da conta que os criou.
 * Ao entrar, só apaga os dois quando quem entrou é outra conta (ou quando não se sabe de quem são):
 * quem volta a /entrar com a mesma conta (sessão que expirou, sem ter clicado em Sair) continua de onde parou.
 */
export const CHAVE_DONO_ONBOARDING = "janete:onboarding:dono:v1";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function lerDonoOnboarding(): string | null {
  try {
    return storage()?.getItem(CHAVE_DONO_ONBOARDING) ?? null;
  } catch {
    return null;
  }
}

function gravarDono(id: string): void {
  try {
    storage()?.setItem(CHAVE_DONO_ONBOARDING, id);
  } catch {
    // sem sessionStorage: na próxima entrada o dono é desconhecido e o progresso recomeça
  }
}

function esquecerDono(): void {
  try {
    storage()?.removeItem(CHAVE_DONO_ONBOARDING);
  } catch {
    // nada a apagar
  }
}

/**
 * Chamado logo depois de entrar. Com o mesmo dono, mantém o progresso. Com outro dono, ou sem dono
 * gravado, apaga o estado do onboarding e o marcador do tour e grava o novo dono. Sem id (resposta
 * inesperada do Firebase), apaga tudo e não grava dono.
 */
export function assumirProgresso(idUsuario: string | null | undefined): void {
  const id = typeof idUsuario === "string" && idUsuario ? idUsuario : null;
  if (id && lerDonoOnboarding() === id) return;
  limparEstadoOnboarding();
  esquecerTour();
  if (id) gravarDono(id);
  else esquecerDono();
}

/** Conta nova: o progresso começa do zero e passa a ser dela. */
export function comecarProgresso(idUsuario: string | null | undefined): void {
  limparEstadoOnboarding();
  esquecerTour();
  if (typeof idUsuario === "string" && idUsuario) gravarDono(idUsuario);
  else esquecerDono();
}
