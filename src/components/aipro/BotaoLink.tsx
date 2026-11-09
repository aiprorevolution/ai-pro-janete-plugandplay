import { createLink } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, Ref } from "react";
import { ConteudoBotao, classeBotao, dadosBotao, type PropsVisuaisBotao } from "./Botao";
import { cx } from "./cx";

type PropsAncora = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> &
  PropsVisuaisBotao & {
    /** Abre em nova aba, com `rel="noopener noreferrer"`. */
    externo?: boolean | undefined;
    /** Foco programático. React 19 entrega `ref` como prop. */
    ref?: Ref<HTMLAnchorElement> | undefined;
  };

/**
 * `<a>` com a forma do `Botao`. Use direto para destino fora do app (documentação do
 * provedor, painel do gateway) com `externo`; para rota do app, use `BotaoLink`.
 */
export function AncoraBotao({
  variante = "principal",
  tamanho = "padrao",
  largo = false,
  icone,
  iconeDepois,
  externo = false,
  className,
  children,
  ...resto
}: PropsAncora) {
  return (
    <a
      {...resto}
      {...dadosBotao({ variante, tamanho, largo })}
      {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cx(classeBotao, className)}
    >
      <ConteudoBotao icone={icone} iconeDepois={iconeDepois}>
        {children}
      </ConteudoBotao>
    </a>
  );
}

/**
 * CTA de navegação interna com a forma do `Botao`: o `Link` do TanStack Router
 * (`to`, `params`, `search`, preload) sobre `AncoraBotao`. Destino é obrigatório:
 * um CTA sem destino é um defeito.
 *
 * Exemplo: `<BotaoLink to="/app/chat" variante="suave">Abrir o chat</BotaoLink>`.
 */
export const BotaoLink = createLink(AncoraBotao);
