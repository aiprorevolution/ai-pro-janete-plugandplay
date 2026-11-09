import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Dica } from "./Dica";
import { Giro } from "./Giro";
import { cx, type Classes } from "./cx";
import estilos from "./BotaoIcone.module.css";

const s = estilos as Classes<"botao" | "icone" | "ponto">;

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /** Nome acessível (vira `aria-label`) e texto da dica. Obrigatório. */
  rotulo: string;
  variante?: "contorno" | "suave" | "discreto" | "principal" | undefined;
  /** compacto 36 · padrão 44, sempre círculo. */
  tamanho?: "compacto" | "padrao" | undefined;
  /** Botão de alternância: vira `aria-pressed`. */
  pressionado?: boolean | undefined;
  carregando?: boolean | undefined;
  /** Ponto azul no canto (há algo novo). */
  ponto?: boolean | undefined;
  /** Desliga a dica com o rótulo (quando o texto já está visível ao lado). */
  semDica?: boolean | undefined;
  ladoDica?: "cima" | "baixo" | undefined;
  /** Alinhamento do balão com o botão (`Dica`). */
  alinharDica?: "inicio" | "centro" | "fim" | undefined;
  /** Ícone já renderizado: 18 no compacto, 20 no padrão. */
  icone: ReactNode;
  /** Foco programático. React 19 entrega `ref` como prop. */
  ref?: Ref<HTMLButtonElement> | undefined;
};

/** Botão só com ícone. O rótulo aparece como dica no hover e no foco por teclado. */
export function BotaoIcone({
  rotulo,
  variante = "contorno",
  tamanho = "padrao",
  pressionado,
  carregando = false,
  ponto = false,
  semDica = false,
  ladoDica = "baixo",
  alinharDica = "centro",
  icone,
  className,
  disabled,
  type = "button",
  ...resto
}: Props) {
  const botao = (
    <button
      {...resto}
      type={type}
      className={cx(s.botao, className)}
      data-variante={variante}
      data-tamanho={tamanho}
      aria-label={rotulo}
      aria-pressed={pressionado}
      aria-busy={carregando || undefined}
      disabled={disabled || carregando}
    >
      {carregando ? (
        <Giro tamanho={tamanho === "compacto" ? 16 : 18} />
      ) : (
        <span className={s.icone} aria-hidden="true">
          {icone}
        </span>
      )}
      {ponto ? <span className={s.ponto} aria-hidden="true" /> : null}
    </button>
  );

  if (semDica) return botao;
  return (
    <Dica rotulo={rotulo} lado={ladoDica} alinhamento={alinharDica}>
      {botao}
    </Dica>
  );
}
