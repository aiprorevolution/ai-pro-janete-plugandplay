import { useEffect, useMemo, useRef } from "react";

/**
 * Os `later` e `limpar` do F: agenda passos da coreografia e cancela todos de uma vez (ao pular,
 * ao sair da etapa ou ao desmontar). `geracao` muda a cada `limpar`, para que uma promessa em
 * andamento (o voo do símbolo) saiba que foi cancelada e não siga adiante.
 */
export interface Temporizadores {
  depois: (fn: () => void, ms: number) => void;
  limpar: () => void;
  /** Número da rodada atual; compare antes e depois de um `await`. */
  geracao: () => number;
}

export function useTemporizadores(): Temporizadores {
  const lista = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const rodada = useRef(0);

  const controle = useMemo<Temporizadores>(
    () => ({
      depois(fn, ms) {
        const t = setTimeout(() => {
          lista.current.delete(t);
          fn();
        }, ms);
        lista.current.add(t);
      },
      limpar() {
        rodada.current += 1;
        lista.current.forEach(clearTimeout);
        lista.current.clear();
      },
      geracao: () => rodada.current,
    }),
    [],
  );

  useEffect(() => () => controle.limpar(), [controle]);
  return controle;
}

/** O `focar` do F: leva o foco ao elemento 60 ms depois (a tela já trocou), sem rolar a página. */
export function focarDepois(t: Temporizadores, id: string, rolar = false) {
  t.depois(() => {
    const el = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    el.focus({ preventScroll: true });
    if (rolar) el.scrollIntoView?.({ block: "nearest" });
  }, 60);
}
