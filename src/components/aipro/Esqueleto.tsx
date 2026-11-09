import type { CSSProperties } from "react";
import { cx, type Classes } from "./cx";
import estilos from "./Esqueleto.module.css";

const s = estilos as Classes<"pilha" | "osso">;

type Medida = number | string;

type Props = {
  /** texto: linhas de 0,75em · bloco: retângulo de card · circulo: avatar · linha: separador. */
  forma?: "texto" | "bloco" | "circulo" | "linha" | undefined;
  largura?: Medida | undefined;
  altura?: Medida | undefined;
  /** Só em `texto`: quantas linhas; a última fica mais curta, como texto real. */
  linhas?: number | undefined;
  /** Raio do bloco por papel (padrão item). */
  raio?: "card" | "item" | "mini" | "pilula" | undefined;
  /** Anuncia o carregamento. Sem rótulo, é decorativo: o contêiner marca `aria-busy`. */
  rotulo?: string | undefined;
  className?: string | undefined;
};

const medida = (valor?: Medida) => (typeof valor === "number" ? `${valor}px` : valor);

/**
 * Osso de carregamento. **Repete a forma do conteúdo real**: mesma grade, mesma
 * contagem. Contagem diferente faz a tela pular no fim do load.
 */
export function Esqueleto({
  forma = "texto",
  largura,
  altura,
  linhas = 1,
  raio = "item",
  rotulo,
  className,
}: Props) {
  const estilo = {
    "--esq-largura": medida(largura),
    "--esq-altura": medida(altura),
  } as CSSProperties;
  const acessivel = rotulo
    ? ({ role: "status", "aria-label": rotulo } as const)
    : ({ "aria-hidden": true } as const);

  if (forma === "texto" && linhas > 1) {
    return (
      <span className={cx(s.pilha, className)} style={estilo} {...acessivel}>
        {Array.from({ length: linhas }, (_, indice) => (
          <span key={indice} className={s.osso} data-forma="texto" />
        ))}
      </span>
    );
  }

  return (
    <span
      className={cx(s.osso, className)}
      data-forma={forma}
      data-raio={forma === "bloco" ? raio : undefined}
      style={estilo}
      {...acessivel}
    />
  );
}
