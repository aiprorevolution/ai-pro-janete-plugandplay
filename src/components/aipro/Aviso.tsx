import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cx, type Classes } from "./cx";
import estilos from "./Aviso.module.css";

const s = estilos as Classes<"aviso" | "icone" | "texto" | "titulo" | "acao" | "fechar">;

export type TomAviso = "info" | "atencao" | "erro" | "sucesso";

const ICONES: Record<TomAviso, ReactNode> = {
  info: <Info size={20} strokeWidth={1.9} aria-hidden="true" />,
  atencao: <TriangleAlert size={20} strokeWidth={1.9} aria-hidden="true" />,
  erro: <CircleAlert size={20} strokeWidth={1.9} aria-hidden="true" />,
  sucesso: <CircleCheck size={20} strokeWidth={1.9} aria-hidden="true" />,
};

type Props = {
  tom?: TomAviso | undefined;
  titulo?: ReactNode;
  /** Saída do aviso: "Tentar de novo", "Ver proposta". Botao/BotaoLink compacto. */
  acao?: ReactNode;
  /** Uma linha, menos recheio: aviso dentro de card ou acima do conteúdo no celular. */
  compacto?: boolean | undefined;
  /** Só quando o aviso é dispensável. */
  aoFechar?: (() => void) | undefined;
  /** Troca o ícone padrão do tom (por exemplo, um `Giro` enquanto processa). */
  icone?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
};

/**
 * Aviso dentro do fluxo. Estado se lê pelo texto e pelo ícone; a cor só reforça.
 * Erro e atenção entram como `alert` para o leitor de tela anunciar na hora.
 * Sem faixa lateral: contorno nenhum, só o tom do fundo.
 */
export function Aviso({
  tom = "info",
  titulo,
  acao,
  compacto = false,
  aoFechar,
  icone,
  className,
  children,
}: Props) {
  return (
    <div
      className={cx(s.aviso, className)}
      data-tom={tom}
      data-compacto={compacto || undefined}
      role={tom === "erro" || tom === "atencao" ? "alert" : "status"}
    >
      <span className={s.icone}>{icone ?? ICONES[tom]}</span>
      <div className={s.texto}>
        {titulo ? <strong className={s.titulo}>{titulo}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {acao ? <div className={s.acao}>{acao}</div> : null}
      {aoFechar ? (
        <button type="button" className={s.fechar} aria-label="Dispensar aviso" onClick={aoFechar}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
