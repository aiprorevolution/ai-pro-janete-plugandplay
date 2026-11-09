import { createContext, useContext, useEffect } from "react";

/**
 * O que as etapas contam para a casca do onboarding (a barra de cima e a região de anúncios).
 * Quem fornece é o Onboarding.tsx; uma etapa renderizada sozinha (teste) recebe funções vazias.
 */
export interface Palco {
  /** A Janete está no palco desta etapa (validação, despertar): a barra esconde a marca dela. Uma marca só. */
  janeteNoPalco: (sim: boolean) => void;
  /** Texto para o leitor de tela (região `aria-live="polite"` da casca). */
  anunciar: (texto: string) => void;
  /** A barra sai de cena (o `.nav.recolhe` do F): nada fica em cima do logo girando na validação. */
  recolherBarra: (sim: boolean) => void;
}

export const PalcoContexto = createContext<Palco>({
  janeteNoPalco: () => {},
  anunciar: () => {},
  recolherBarra: () => {},
});

export function usePalco(): Palco {
  return useContext(PalcoContexto);
}

/** Enquanto `ativo` for true, a marca da Janete sai da barra. Ao desmontar, volta. */
export function useJaneteNoPalco(ativo: boolean) {
  const { janeteNoPalco } = usePalco();
  useEffect(() => {
    janeteNoPalco(ativo);
    return () => janeteNoPalco(false);
  }, [ativo, janeteNoPalco]);
}

/** Enquanto `ativo` for true, a barra de etapas fica recolhida. Ao desmontar, volta. */
export function useBarraRecolhida(ativo: boolean) {
  const { recolherBarra } = usePalco();
  useEffect(() => {
    recolherBarra(ativo);
    return () => recolherBarra(false);
  }, [ativo, recolherBarra]);
}
