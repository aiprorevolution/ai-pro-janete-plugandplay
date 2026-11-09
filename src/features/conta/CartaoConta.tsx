import { useState, type ReactNode, type Ref } from "react";
import BrandLogo from "@/components/brand/BrandLogo";

import { classesCampo } from "@/components/aipro/Campo";
import { cx, type Classes } from "@/components/aipro/cx";

import { medidaSenha } from "./validacao";
import estilos from "./CartaoConta.module.css";

export const classesConta = estilos as Classes<
  | "tela"
  | "sr"
  | "nome"
  | "cab"
  | "titulo"
  | "sub"
  | "form"
  | "medida"
  | "medidaPonto"
  | "olhar"
  | "rodape"
  | "link"
>;

const s = classesConta;

interface PropsCartao {
  idTitulo: string;
  titulo: ReactNode;
  subtitulo: ReactNode;
  /** Texto da região de anúncio (leitor de tela). */
  anuncio?: string;
  refTitulo?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}

/**
 * O conteúdo do cartão do login. O cartão em si (o fundo branco, a sombra, a Janete gigante atrás)
 * é do `PalcoConta`, que fica na rota de layout: aqui só a tela, em coluna. O cabeçalho é o bloco 0
 * da entrada; os campos (o `Campo` já marca), o botão (`data-bloco="2"`) e o rodapé
 * (`data-bloco="3"`) vêm nos `children`.
 */
export function CartaoConta({ idTitulo, titulo, subtitulo, anuncio = "", refTitulo, children }: PropsCartao) {
  return (
    <section className={s.tela} aria-labelledby={idTitulo}>
      <p className={s.sr} role="status" aria-live="polite">
        {anuncio}
      </p>
      <div className={s.cab} data-bloco="0">
        <div className={s.nome}><BrandLogo withName height={42} /></div>
        <h1 id={idTitulo} ref={refTitulo} tabIndex={-1} className={s.titulo}>
          {titulo}
        </h1>
        <p className={s.sub}>{subtitulo}</p>
      </div>
      {children}
    </section>
  );
}

interface PropsSenha {
  id: string;
  valor: string;
  aoMudar: (valor: string) => void;
  autoComplete: "new-password" | "current-password";
  /** Mostra a medida do F ("mínimo de 8 caracteres", "faltam 3", "senha ok"). */
  comMedida?: boolean;
  placeholder?: string;
  erro?: string | undefined;
  desabilitado?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/**
 * A senha do cartão: rótulo e medida na mesma linha, botão "Mostrar"/"Ocultar" em texto dentro
 * da pílula (como no F). Usa o desenho do `Campo` da identidade.
 */
export function CampoSenhaConta({
  id,
  valor,
  aoMudar,
  autoComplete,
  comMedida = false,
  placeholder,
  erro,
  desabilitado,
  ref,
}: PropsSenha) {
  const c = classesCampo;
  const [ver, setVer] = useState(false);
  const medida = medidaSenha(valor);
  const idMedida = `${id}-d`;
  const idErro = `${id}-erro`;
  const descritores = [comMedida ? idMedida : null, erro ? idErro : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={c.campo} data-campo data-invalido={erro ? "" : undefined}>
      <div className={c.topo}>
        <label htmlFor={id} className={c.rotulo}>
          Senha
        </label>
        {comMedida ? (
          <span id={idMedida} className={s.medida} data-ok={medida.ok || undefined}>
            <span className={s.medidaPonto} aria-hidden="true" />
            <span>{medida.texto}</span>
          </span>
        ) : null}
      </div>
      <div className={c.caixa} data-caixa data-com-sufixo="">
        <input
          ref={ref}
          id={id}
          className={c.entrada}
          type={ver ? "text" : "password"}
          autoComplete={autoComplete}
          value={valor}
          onChange={(ev) => aoMudar(ev.target.value)}
          placeholder={placeholder}
          disabled={desabilitado}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritores}
        />
        <button
          type="button"
          className={s.olhar}
          onClick={() => setVer((v) => !v)}
          aria-label={ver ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={ver}
          aria-controls={id}
        >
          {ver ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {erro ? (
        <p id={idErro} className={cx(c.erro)}>
          <IconeErro />
          {erro}
        </p>
      ) : null}
    </div>
  );
}

function IconeErro() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 8v4M12 16h.01" />
    </svg>
  );
}
