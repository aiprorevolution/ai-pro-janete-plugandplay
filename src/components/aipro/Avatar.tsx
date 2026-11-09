import { iniciais } from "./iniciais";
import { cx, type Classes } from "./cx";
import estilos from "./Avatar.module.css";

const s = estilos as Classes<"avatar" | "foto">;

type Props = {
  nome: string;
  /** Foto real. Sem foto, iniciais: nunca silhueta. */
  src?: string | null | undefined;
  /** p 32 · m 38 · g 44. */
  tamanho?: "p" | "m" | "g" | undefined;
  tom?: "azul" | "navy" | "neutro" | undefined;
  /** Decorativo quando o nome já está escrito ao lado (padrão). */
  decorativo?: boolean | undefined;
  className?: string | undefined;
};

/** Pessoa. Círculo com foto ou iniciais derivadas do nome. */
export function Avatar({
  nome,
  src,
  tamanho = "m",
  tom = "azul",
  decorativo = true,
  className,
}: Props) {
  const acessivel = decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);

  return (
    <span className={cx(s.avatar, className)} data-tamanho={tamanho} data-tom={tom} {...acessivel}>
      {src ? (
        <img src={src} alt="" className={s.foto} loading="lazy" decoding="async" />
      ) : (
        iniciais(nome)
      )}
    </span>
  );
}
