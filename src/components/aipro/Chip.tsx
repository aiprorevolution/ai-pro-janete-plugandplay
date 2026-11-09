import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cx, type Classes } from "./cx";
import estilos from "./Chip.module.css";

const s = estilos as Classes<"chip" | "alvo" | "icone" | "total" | "remover">;

type Props = {
  rotulo: string;
  /** Filtro de alternância: vira `aria-pressed`. Exige `aoClicar`. */
  selecionado?: boolean | undefined;
  aoClicar?: (() => void) | undefined;
  /** Filtro ativo removível: mostra o x de 24 dentro do chip. */
  aoRemover?: (() => void) | undefined;
  /** Contagem de resultados do filtro, em mono. */
  total?: number | undefined;
  icone?: ReactNode;
  desabilitado?: boolean | undefined;
  className?: string | undefined;
};

/**
 * Filtro em pílula de 36. Sem `aoClicar` nem `aoRemover`, é só rótulo (filtro
 * aplicado, sem ação aqui).
 */
export function Chip({
  rotulo,
  selecionado,
  aoClicar,
  aoRemover,
  total,
  icone,
  desabilitado = false,
  className,
}: Props) {
  const miolo = (
    <>
      {icone ? (
        <span className={s.icone} aria-hidden="true">
          {icone}
        </span>
      ) : null}
      <span>{rotulo}</span>
      {typeof total === "number" ? <span className={s.total}>{total}</span> : null}
    </>
  );

  return (
    <span
      className={cx(s.chip, className)}
      data-selecionado={selecionado || undefined}
      data-removivel={aoRemover ? "" : undefined}
    >
      {aoClicar ? (
        <button
          type="button"
          className={s.alvo}
          aria-pressed={selecionado}
          onClick={aoClicar}
          disabled={desabilitado}
        >
          {miolo}
        </button>
      ) : (
        <span className={s.alvo}>{miolo}</span>
      )}
      {aoRemover ? (
        <button
          type="button"
          className={s.remover}
          aria-label={`Remover ${rotulo}`}
          onClick={aoRemover}
          disabled={desabilitado}
        >
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
