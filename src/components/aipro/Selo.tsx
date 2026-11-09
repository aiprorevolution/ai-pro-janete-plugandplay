import type { ReactNode } from "react";
import { cx, type Classes } from "./cx";
import estilos from "./Selo.module.css";

const s = estilos as Classes<"selo" | "icone">;

type Props = {
  tom?: "rosa" | "menta" | "areia" | "azul" | "neutro" | undefined;
  /** categoria: fundo suave · fato: contorno, tinta de apoio ("Recomendado"). */
  variante?: "categoria" | "fato" | undefined;
  compacto?: boolean | undefined;
  icone?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
};

/**
 * Categoria, sentence-case. **Nunca estado** (estado é `Estado`, texto + ícone) e
 * nunca botão: o selo não disputa com a ação nem com o azul de "onde você está".
 */
export function Selo({
  tom = "neutro",
  variante = "categoria",
  compacto = false,
  icone,
  className,
  children,
}: Props) {
  return (
    <span
      className={cx(s.selo, className)}
      data-tom={variante === "fato" ? undefined : tom}
      data-variante={variante}
      data-compacto={compacto || undefined}
    >
      {icone ? (
        <span className={s.icone} aria-hidden="true">
          {icone}
        </span>
      ) : null}
      {children}
    </span>
  );
}
