import type { InputHTMLAttributes, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cx, type Classes } from "./cx";
import estilos from "./Campo.module.css";

export type ClassesCampo = Classes<
  "campo" | "topo" | "rotulo" | "caixa" | "prefixo" | "oculto" | "entrada" | "erro" | "dica" | "alternar"
>;

const s = estilos as ClassesCampo;

/** Classes do campo, para `AreaTexto` e `CampoSenha` reaproveitarem o mesmo desenho. */
export const classesCampo = s;

export type PropsCampo = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "prefix"> & {
  id: string;
  rotulo: string;
  erro?: string | undefined;
  dica?: ReactNode;
  /** Atalho na linha do rótulo, como "Esqueci minha senha". */
  acaoRotulo?: ReactNode;
  /** Controle dentro da caixa, à direita, como mostrar a senha. */
  sufixo?: ReactNode;
  /** Ícone ou texto à esquerda, dentro da caixa (R$, lupa). */
  prefixo?: ReactNode;
  /** Rótulo só para leitor de tela (busca em barra de ferramentas). */
  rotuloOculto?: boolean | undefined;
  /** curta = 12ch (CEP, data, código). */
  largura?: "cheia" | "curta" | undefined;
};

/**
 * Campo de texto da identidade AI PRO. Rótulo sempre presente, erro ligado ao campo
 * por `aria-describedby` e `aria-invalid`, texto a 16px para o iPhone não aproximar a
 * tela. `data-campo` marca o grupo que a validação rola para a vista.
 */
export function Campo({
  id,
  rotulo,
  erro,
  dica,
  acaoRotulo,
  sufixo,
  prefixo,
  rotuloOculto = false,
  largura = "cheia",
  className,
  ...entrada
}: PropsCampo) {
  const idErro = `${id}-erro`;
  const idDica = `${id}-dica`;
  const descricao = erro ? idErro : dica ? idDica : undefined;

  return (
    <div
      className={cx(s.campo, className)}
      data-campo
      data-invalido={erro ? "" : undefined}
      data-largura={largura === "curta" ? "curta" : undefined}
    >
      <div className={cx(s.topo, rotuloOculto && !acaoRotulo && s.oculto)}>
        <label htmlFor={id} className={cx(s.rotulo, rotuloOculto && s.oculto)}>
          {rotulo}
        </label>
        {acaoRotulo}
      </div>
      <div
        className={s.caixa}
        data-caixa
        data-com-sufixo={sufixo ? "" : undefined}
        data-com-prefixo={prefixo ? "" : undefined}
      >
        {prefixo ? (
          <span className={s.prefixo} aria-hidden="true">
            {prefixo}
          </span>
        ) : null}
        <input
          {...entrada}
          id={id}
          className={s.entrada}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descricao}
        />
        {sufixo}
      </div>
      <MensagemCampo id={id} erro={erro} dica={dica} />
    </div>
  );
}

/** Erro (texto + ícone) ou dica sob o controle. Compartilhado por Campo e AreaTexto. */
export function MensagemCampo({
  id,
  erro,
  dica,
}: {
  id: string;
  erro?: string | undefined;
  dica?: ReactNode;
}) {
  if (erro) {
    return (
      <p id={`${id}-erro`} className={s.erro}>
        <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />
        {erro}
      </p>
    );
  }
  if (dica) {
    return (
      <p id={`${id}-dica`} className={s.dica}>
        {dica}
      </p>
    );
  }
  return null;
}
