import { Fragment } from "react";

// O número com a unidade menor (a ref. 10: "$" pequeno antes, "s", "min", "dias" pequenos depois). O
// texto já vem formatado pela fundação ("US$ 42,05", "1 min 4 s", "7,6 dias", "77%"); aqui ele só é
// separado em pedaços: os algarismos ficam no tamanho do número, o resto vai num span com
// [data-unidade], que cada folha de estilo da versão desenha menor (0,55em, tinta-2, peso 500). Nenhum
// número é calculado nem reescrito: juntar os pedaços devolve o texto original.

interface PedacoNumero {
  texto: string;
  unidade: boolean;
}

const ALGARISMOS = /(\d[\d.,]*)/;

/** "US$ 42,05" → [{US$ , unidade}, {42,05}]. Texto sem algarismo ("sem dados") volta inteiro, sem unidade. */
function pedacosDoNumero(texto: string): PedacoNumero[] {
  if (!/\d/.test(texto)) return [{ texto, unidade: false }];
  return texto
    .split(ALGARISMOS)
    .filter((p) => p !== "")
    .map((p) => ({ texto: p, unidade: !/^\d/.test(p) }));
}

/** Os pedaços como nós de React (para o texto que não anima). */
export function ComUnidade({ texto }: { texto: string }) {
  return (
    <>
      {pedacosDoNumero(texto).map((p, k) =>
        p.unidade ? (
          <span key={k} data-unidade="">
            {p.texto}
          </span>
        ) : (
          <Fragment key={k}>{p.texto}</Fragment>
        ),
      )}
    </>
  );
}
