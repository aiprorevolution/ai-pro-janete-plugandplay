import type { ReactNode } from "react";
import { cx, type Classes } from "./cx";
import estilos from "./Pagina.module.css";

const s = estilos as Classes<"pagina">;

type Props = {
  /** conteudo 1344 (padrão) · leitura 760 · lista 1080 · ampla 1920. */
  largura?: "conteudo" | "leitura" | "lista" | "ampla" | undefined;
  as?: "div" | "article" | "main" | undefined;
  /** Liga a coreografia nos filhos com `data-entrada` (padrão true). */
  entrada?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
};

/**
 * Raiz de toda tela da Janete. Marca `data-identidade="aipro"`: é só dentro dele que a
 * Poppins, a tinta e a coreografia de entrada valem (o resto do app segue no shadcn).
 * Não tem padding: a calha é do layout que contém a tela.
 */
export function Pagina({
  largura = "conteudo",
  as: Tag = "div",
  entrada = true,
  className,
  children,
}: Props) {
  return (
    <Tag
      data-identidade="aipro"
      data-largura={largura}
      data-sem-entrada={entrada ? undefined : ""}
      className={cx(s.pagina, className)}
    >
      {children}
    </Tag>
  );
}
