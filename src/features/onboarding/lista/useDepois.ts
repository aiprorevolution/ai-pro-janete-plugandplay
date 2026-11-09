import { useCallback, useEffect, useRef } from "react";

import { movimentoReduzido } from "@/components/janete/VooJanete";

/** Temporizadores da etapa (o `later` do F): todos são cancelados quando a etapa sai da tela. */
export function useDepois() {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const lista = timers.current;
    return () => {
      lista.forEach(clearTimeout);
      lista.clear();
    };
  }, []);

  const depois = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
    return t;
  }, []);

  /** Foco como o `focar(id, rolar)` do F: 60 ms depois (mais o atraso), sem rolar a página. */
  const focar = useCallback(
    (id: string, opcoes: { rolar?: boolean; atrasoMs?: number } = {}) => {
      depois(() => focarAgora(id, opcoes.rolar ?? false), (opcoes.atrasoMs ?? 0) + 60);
    },
    [depois],
  );

  return { depois, focar };
}

export function focarAgora(id: string, rolar = false): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id) as (HTMLElement & { disabled?: boolean }) | null;
  if (!el || el.disabled) return;
  el.focus({ preventScroll: true });
  if (rolar && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "nearest", behavior: movimentoReduzido() ? "auto" : "smooth" });
  }
}
