import type { ReactNode } from "react";
import { Circle, CircleAlert, CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { cx, type Classes } from "./cx";
import estilos from "./Estado.module.css";

const s = estilos as Classes<"estado" | "icone">;

export type TomEstado = "neutro" | "andamento" | "sucesso" | "atencao" | "erro";

const ICONES: Record<TomEstado, ReactNode> = {
  neutro: <Circle size={16} strokeWidth={2} />,
  andamento: <LoaderCircle size={16} strokeWidth={2} />,
  sucesso: <CircleCheck size={16} strokeWidth={2} />,
  atencao: <TriangleAlert size={16} strokeWidth={2} />,
  erro: <CircleAlert size={16} strokeWidth={2} />,
};

type Props = {
  tom?: TomEstado | undefined;
  rotulo: string;
  /** Troca o ícone padrão do tom. */
  icone?: ReactNode;
  tamanho?: "apoio" | "meta" | undefined;
  /** Sobre o palco escuro: tinta clara. */
  sobrePalco?: boolean | undefined;
  className?: string | undefined;
};

/**
 * Status: texto + ícone, **sem pílula** ("Conectado", "Testando a chave"). A cor
 * reforça; quem informa é o texto. Categoria é `Selo`.
 */
export function Estado({
  tom = "neutro",
  rotulo,
  icone,
  tamanho = "apoio",
  sobrePalco = false,
  className,
}: Props) {
  return (
    <span
      className={cx(s.estado, className)}
      data-tom={tom}
      data-tamanho={tamanho}
      data-palco={sobrePalco || undefined}
    >
      <span className={s.icone} aria-hidden="true">
        {icone ?? ICONES[tom]}
      </span>
      {rotulo}
    </span>
  );
}
