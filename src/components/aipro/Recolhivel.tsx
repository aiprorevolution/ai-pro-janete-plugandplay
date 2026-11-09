import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx, type Classes } from "./cx";
import estilos from "./Recolhivel.module.css";

const s = estilos as Classes<
  "recolhivel" | "resumo" | "textos" | "titulo" | "apoio" | "contagem" | "chevron" | "corpo"
>;

type Props = {
  /** Texto do `<summary>`: os testes localizam o recolhível por ele. */
  titulo: ReactNode;
  /** Contagem à direita do título, em mono ("7 linhas"). */
  contagem?: ReactNode;
  /** Linha de apoio sob o título, dentro do `<summary>`. */
  apoio?: ReactNode;
  /** Estado inicial. Depois é a pessoa quem abre e fecha (o `<details>` é nativo). */
  aberto?: boolean | undefined;
  /** O navegador pode abrir este `<details>` antes da hidratação (âncora ou busca na
      página): repassa `suppressHydrationWarning` para preservar o estado nativo. */
  aberturaNativa?: boolean | undefined;
  /** `id` do `<details>`. */
  id?: string | undefined;
  /** cartao: superfície branca de card · nenhuma: só o cabeçalho e o corpo, para
      viver dentro de um card que já existe. */
  superficie?: "cartao" | "nenhuma" | undefined;
  className?: string | undefined;
  children: ReactNode;
  /** `data-*` repassados ao `<details>` (alvo do tour, `data-testid`). */
  [dado: `data-${string}`]: string | undefined;
};

/**
 * Conteúdo secundário que a pessoa abre quando precisa. `<details>` nativo: abre pelo
 * teclado e funciona sem JS. O corpo não anima altura; só o chevron gira.
 */
export function Recolhivel({
  titulo,
  contagem,
  apoio,
  aberto = false,
  aberturaNativa = false,
  id,
  superficie = "cartao",
  className,
  children,
  ...dados
}: Props) {
  return (
    <details
      {...dados}
      id={id}
      className={cx(s.recolhivel, className)}
      data-superficie={superficie}
      open={aberto || undefined}
      suppressHydrationWarning={aberturaNativa || undefined}
    >
      <summary className={s.resumo}>
        {apoio ? (
          <span className={s.textos}>
            <span className={s.titulo}>{titulo}</span>
            <span className={s.apoio}>{apoio}</span>
          </span>
        ) : (
          <span className={s.titulo}>{titulo}</span>
        )}
        {contagem ? <span className={s.contagem}>{contagem}</span> : null}
        <ChevronDown className={s.chevron} size={18} strokeWidth={1.75} aria-hidden="true" />
      </summary>
      <div className={s.corpo}>{children}</div>
    </details>
  );
}
