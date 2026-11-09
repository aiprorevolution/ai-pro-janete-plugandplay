import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cx, type Classes } from "./cx";
import estilos from "./Dica.module.css";

const s = estilos as Classes<"dica" | "balao">;

type Props = {
  /** Repete o rótulo ou explica um ícone. Nunca carrega informação necessária. */
  rotulo: string;
  lado?: "cima" | "baixo" | "direita" | undefined;
  /**
   * Onde o balão encosta, nos lados `cima` e `baixo`. `centro` (padrão) centraliza
   * no filho; `fim` alinha a borda direita do balão à do filho, `inicio` a esquerda.
   */
  alinhamento?: "inicio" | "centro" | "fim" | undefined;
  /**
   * Com `id`, o balão vira `role="tooltip"` e o filho ganha `aria-describedby`.
   * Sem `id`, o balão é só visual (`aria-hidden`): é o caso em que ele REPETE o
   * nome acessível do filho, e ler duas vezes o mesmo texto é ruído.
   */
  id?: string | undefined;
  className?: string | undefined;
  /** O elemento focável. */
  children: ReactNode;
};

/**
 * Dica em CSS puro: aparece no hover e quando o filho recebe foco por teclado,
 * com um atraso curto (`--app-motion-state`) para não piscar ao passar o mouse.
 */
export function Dica({
  rotulo,
  lado = "cima",
  alinhamento = "centro",
  id,
  className,
  children,
}: Props) {
  const filho =
    id && isValidElement<{ "aria-describedby"?: string }>(children)
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
          "aria-describedby": id,
        })
      : children;

  return (
    <span
      className={cx(s.dica, className)}
      data-lado={lado}
      data-alinhamento={alinhamento === "centro" ? undefined : alinhamento}
    >
      {filho}
      <span
        className={s.balao}
        id={id}
        role={id ? "tooltip" : undefined}
        aria-hidden={id ? undefined : true}
      >
        {rotulo}
      </span>
    </span>
  );
}
