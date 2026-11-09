import { createLink } from "@tanstack/react-router";
import { Check } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";
import { cx, type Classes } from "./cx";
import estilos from "./Cartao.module.css";

const s = estilos as Classes<
  "cartao" | "itemLista" | "topo" | "passo" | "textos" | "meta" | "titulo" | "apoio" | "acao"
>;

type PropsVisuaisCartao = {
  /** card 24 · painel 28 (o que contém outros blocos). */
  raio?: "card" | "painel" | undefined;
  /** 24 · 20 · 0 (lista colada na borda). */
  recheio?: "padrao" | "compacto" | "nenhum" | undefined;
  /** branco: card · canvas: bloco dentro de outro card, sem sombra · azul: destaque da Janete. */
  tom?: "branco" | "canvas" | "azul" | undefined;
};

type PropsCartao = PropsVisuaisCartao & {
  as?: "section" | "article" | "div" | "li" | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
  /** `data-*` repassados ao elemento: alvo do tour, `data-testid`. */
  [dado: `data-${string}`]: string | undefined;
};

/**
 * Superfície sólida. Sem borda: a separação é o tom contra o canvas e a sombra
 * quase nula. **Card dentro de card é proibido**: dentro de um `Cartao`, blocos usam
 * `tom="canvas"`, que perde a sombra. O card inteiro como link é `CartaoLink`.
 */
export function Cartao({
  as: Tag = "section",
  raio = "card",
  recheio = "padrao",
  tom = "branco",
  ariaLabelledby,
  ariaDescribedby,
  ariaLabel,
  className,
  children,
  ...atributos
}: PropsCartao) {
  return (
    <Tag
      {...atributos}
      className={cx(s.cartao, className)}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      aria-label={ariaLabel}
      data-raio={raio}
      data-recheio={recheio}
      data-tom={tom}
    >
      {children}
    </Tag>
  );
}

type PropsAncoraCartao = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> &
  PropsVisuaisCartao & {
    /** Hover ergue 2px (padrão). */
    interativo?: boolean | undefined;
    children: ReactNode;
    ref?: Ref<HTMLAnchorElement> | undefined;
  };

function AncoraCartao({
  raio = "card",
  recheio = "padrao",
  tom = "branco",
  interativo = true,
  className,
  children,
  ...resto
}: PropsAncoraCartao) {
  return (
    <a
      {...resto}
      className={cx(s.cartao, className)}
      data-raio={raio}
      data-recheio={recheio}
      data-tom={tom}
      data-interativo={interativo || undefined}
    >
      {children}
    </a>
  );
}

/**
 * O card inteiro como link do TanStack Router (`to`, `params`). Não ponha botões
 * nem links dentro dele. Em lista, envolva num `<li>`.
 */
export const CartaoLink = createLink(AncoraCartao);

type PropsTopo = {
  titulo: ReactNode;
  /** h2 (padrão) ou h3 quando o card vive sob um h2 de seção. */
  nivel?: 2 | 3 | undefined;
  /** Para o `ariaLabelledby` do Cartao. */
  id?: string | undefined;
  /** Uma linha de apoio sob o título. */
  apoio?: ReactNode;
  /** Metadado acima do título ("Passo 1 de 3", data). */
  meta?: ReactNode;
  /** Ação do card, à direita: Botao/BotaoLink suave ou compacto, BotaoIcone. */
  acao?: ReactNode;
  /** Passo numerado à esquerda do título (card que é um passo de uma sequência).
      Sempre `aria-hidden`: o nome do título não muda. `feito` mostra check ou o
      `icone`. */
  passo?:
    | { numero: number; estado: "atual" | "feito" | "proximo"; icone?: ReactNode }
    | undefined;
  className?: string | undefined;
};

/** Cabeçalho de card: título 17/600, apoio e ação alinhada pela primeira linha. */
export function CartaoTopo({
  titulo,
  nivel = 2,
  id,
  apoio,
  meta,
  acao,
  passo,
  className,
}: PropsTopo) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  return (
    <header className={cx(s.topo, className)}>
      {passo ? (
        <span className={s.passo} data-estado={passo.estado} aria-hidden="true">
          {passo.estado === "feito"
            ? (passo.icone ?? <Check size={16} strokeWidth={2} />)
            : passo.numero}
        </span>
      ) : null}
      <div className={s.textos}>
        {meta ? <p className={s.meta}>{meta}</p> : null}
        <Titulo id={id} className={s.titulo}>
          {titulo}
        </Titulo>
        {apoio ? <p className={s.apoio}>{apoio}</p> : null}
      </div>
      {acao ? <div className={s.acao}>{acao}</div> : null}
    </header>
  );
}
