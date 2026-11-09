import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Giro } from "./Giro";
import { cx, type Classes } from "./cx";
import estilos from "./Botao.module.css";

const s = estilos as Classes<"botao" | "icone" | "depois" | "rotulo">;

export type VarianteBotao = "principal" | "contorno" | "suave" | "discreto" | "perigo";
export type TamanhoBotao = "compacto" | "padrao" | "grande";

/** Props visuais comuns a `Botao`, `BotaoLink` e `AncoraBotao`. */
export type PropsVisuaisBotao = {
  /** principal: a ação do bloco · contorno: alternativa · suave: ação dentro de linha ·
      discreto: terciária em barra de ferramentas · perigo: ação destrutiva. */
  variante?: VarianteBotao | undefined;
  /** compacto 36 · padrão 44 · grande 50. */
  tamanho?: TamanhoBotao | undefined;
  largo?: boolean | undefined;
  icone?: ReactNode;
  /** Ícone depois do rótulo (a seta do CTA). Desliza 3px no hover. */
  iconeDepois?: ReactNode;
  children: ReactNode;
};

/** Miolo compartilhado: ícone ou giro, rótulo e ícone final. */
export function ConteudoBotao({
  carregando,
  icone,
  iconeDepois,
  children,
}: {
  carregando?: boolean | undefined;
  icone?: ReactNode;
  iconeDepois?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {carregando ? (
        <Giro tamanho={18} />
      ) : icone ? (
        <span className={s.icone} aria-hidden="true">
          {icone}
        </span>
      ) : null}
      <span className={s.rotulo} data-rotulo>
        {children}
      </span>
      {iconeDepois && !carregando ? (
        <span className={cx(s.icone, s.depois)} aria-hidden="true">
          {iconeDepois}
        </span>
      ) : null}
    </>
  );
}

/** Atributos de dados que `Botao`, `BotaoLink` e o CSS compartilham. */
export function dadosBotao({
  variante,
  tamanho,
  largo,
}: Pick<PropsVisuaisBotao, "variante" | "tamanho" | "largo">) {
  return {
    "data-variante": variante ?? "principal",
    "data-tamanho": tamanho ?? "padrao",
    "data-largo": largo || undefined,
  };
}

export const classeBotao = s.botao;

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  PropsVisuaisBotao & {
    /** Mostra o giro no lugar do ícone e trava o botão sem mudar a largura. */
    carregando?: boolean | undefined;
    /** Foco programático. React 19 entrega `ref` como prop. */
    ref?: Ref<HTMLButtonElement> | undefined;
  };

/**
 * Botão da identidade AI PRO. Pílula, uma ação principal por bloco.
 * CTA de navegação é `BotaoLink`, nunca `Botao` + `navigate()`.
 */
export function Botao({
  variante = "principal",
  tamanho = "padrao",
  largo = false,
  carregando = false,
  icone,
  iconeDepois,
  children,
  className,
  disabled,
  type = "button",
  ...resto
}: Props) {
  return (
    <button
      {...resto}
      type={type}
      className={cx(s.botao, className)}
      {...dadosBotao({ variante, tamanho, largo })}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
    >
      <ConteudoBotao carregando={carregando} icone={icone} iconeDepois={iconeDepois}>
        {children}
      </ConteudoBotao>
    </button>
  );
}
