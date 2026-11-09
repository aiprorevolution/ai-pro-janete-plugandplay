import type { ReactNode, TextareaHTMLAttributes } from "react";
import { MensagemCampo, classesCampo as campo } from "./Campo";
import { cx, type Classes } from "./cx";
import estilos from "./AreaTexto.module.css";

const s = estilos as Classes<"area" | "contador">;

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "rows" | "maxLength"> & {
  id: string;
  rotulo: string;
  erro?: string | undefined;
  dica?: ReactNode;
  /** Altura inicial em linhas (padrão 4). Onde há `field-sizing`, cresce com o texto. */
  linhas?: number | undefined;
  /** Limite de caracteres. Com `value` controlado, mostra "n/máx"; sem ele, "Até máx". */
  maxCaracteres?: number | undefined;
};

/**
 * Texto longo. Raio de item e não pílula: pílula com três linhas lê como balão.
 * O contador só conta quando o pai controla o valor.
 */
export function AreaTexto({
  id,
  rotulo,
  erro,
  dica,
  linhas = 4,
  maxCaracteres,
  className,
  ...area
}: Props) {
  const idContador = `${id}-contador`;
  const descricao = [
    erro ? `${id}-erro` : dica ? `${id}-dica` : null,
    maxCaracteres ? idContador : null,
  ]
    .filter(Boolean)
    .join(" ");
  const usados = typeof area.value === "string" ? area.value.length : null;
  const perto = maxCaracteres && usados !== null && usados >= maxCaracteres * 0.9;

  return (
    <div className={cx(campo.campo, className)} data-campo data-invalido={erro ? "" : undefined}>
      <div className={campo.topo}>
        <label htmlFor={id} className={campo.rotulo}>
          {rotulo}
        </label>
        {maxCaracteres ? (
          <span
            id={idContador}
            className={s.contador}
            data-perto={perto || undefined}
            aria-live={perto ? "polite" : undefined}
          >
            {usados !== null ? `${usados}/${maxCaracteres}` : `Até ${maxCaracteres} caracteres`}
          </span>
        ) : null}
      </div>
      <textarea
        {...area}
        id={id}
        rows={linhas}
        maxLength={maxCaracteres}
        className={s.area}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descricao || undefined}
      />
      <MensagemCampo id={id} erro={erro} dica={dica} />
    </div>
  );
}
