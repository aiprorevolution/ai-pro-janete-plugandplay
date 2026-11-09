import { type ReactNode } from "react";

import { cx, type Classes } from "@/components/aipro/cx";

import { partesDoNumero } from "./apoio";
import estilos from "./pecas.module.css";

const s = estilos as Classes<"dvbNum" | "dvbNumN" | "dvbNumU" | "dvbSr">;

// As peças pequenas que vieram da versão B e o funil ainda usa: o número com a unidade menor e o texto
// só para o leitor de tela. Os números vêm prontos da fundação; aqui só se desenha. (A variação, o
// "como contamos" e os mini gráficos da página são os de comum.tsx: um de cada.)

/** Um texto já formatado, com a unidade menor. */
export function TextoNumero({ texto, className }: { texto: string; className?: string | undefined }) {
  return (
    <span className={cx(s.dvbNum, className)} data-numero="">
      {partesDoNumero(texto).map((p, i) =>
        p.numero ? (
          <span key={i} className={s.dvbNumN}>
            {p.texto}
          </span>
        ) : (
          <span key={i} className={s.dvbNumU}>
            {p.texto}
          </span>
        ),
      )}
    </span>
  );
}

/** Texto só para leitor de tela. */
export function SoLeitor({ children }: { children: ReactNode }) {
  return <span className={s.dvbSr}>{children}</span>;
}
