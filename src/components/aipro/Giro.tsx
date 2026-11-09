import { cx, type Classes } from "./cx";
import estilos from "./Giro.module.css";

const s = estilos as Classes<"envoltorio" | "giro" | "oculto">;

type Props = {
  tamanho?: 16 | 18 | 24 | undefined;
  /** Com rótulo, o giro se anuncia (`role="status"`). Sem rótulo, é decoração de um
      controle que já declara `aria-busy`. */
  rotulo?: string | undefined;
  className?: string | undefined;
};

/**
 * Giro de carregamento DENTRO de controle (botão, campo, linha). Carregando de
 * ÁREA é `Esqueleto` com a forma do conteúdo, nunca um giro no meio da tela.
 */
export function Giro({ tamanho = 18, rotulo, className }: Props) {
  if (!rotulo) {
    return <span className={cx(s.giro, className)} data-tamanho={tamanho} aria-hidden="true" />;
  }
  return (
    <span className={cx(s.envoltorio, className)} role="status">
      <span className={s.giro} data-tamanho={tamanho} aria-hidden="true" />
      <span className={s.oculto}>{rotulo}</span>
    </span>
  );
}
