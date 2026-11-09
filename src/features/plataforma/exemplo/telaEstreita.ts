import { useSyncExternalStore } from "react";

// A largura em que a casca troca para o topo do celular (a mesma do Plataforma.module.css). As telas
// usam para trocar o desenho do computador pelo do celular (o Chat em tela cheia, a etapa do Kanban).

const CONSULTA = "(max-width: 899px)";

function lista(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(CONSULTA) : null;
  } catch {
    return null;
  }
}

function assinar(avisar: () => void): () => void {
  const mq = lista();
  if (!mq) return () => {};
  // Safari antigo só tem addListener.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", avisar);
    return () => mq.removeEventListener("change", avisar);
  }
  mq.addListener(avisar);
  return () => mq.removeListener(avisar);
}

/** A tela está na largura do celular (até 899 px). Fora do navegador, não. */
export function useTelaEstreita(): boolean {
  return useSyncExternalStore(
    assinar,
    () => !!lista()?.matches,
    () => false,
  );
}
