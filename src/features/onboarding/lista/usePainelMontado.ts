import { useEffect, useState } from "react";

/** Tempo da dobra fechar (grid-template-rows .46s do F). */
const FECHA_MS = 460;

/**
 * O painel que está aberto ou acabou de fechar. O conteúdo dos painéis só existe no DOM enquanto
 * aberto (os campos de um provedor não ficam escondidos na página); ao fechar, ele fica montado
 * até a dobra terminar, para a altura recolher com o conteúdo dentro, como no F.
 */
export function usePainelMontado<T extends string>(aberto: T | null): T | null {
  const [montado, setMontado] = useState<T | null>(aberto);
  useEffect(() => {
    if (aberto) {
      setMontado(aberto);
      return;
    }
    const t = setTimeout(() => setMontado(null), FECHA_MS);
    return () => clearTimeout(t);
  }, [aberto]);
  return aberto ?? montado;
}
