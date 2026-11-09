import type { ReactNode, Ref } from "react";

import { Botao, cx } from "@/components/aipro";

import { IC } from "./dados";
import { s } from "./estilos";

/** Ícone de traço do F (viewBox 24). */
export function Icone({ d, tamanho = "n", className }: { d: string; tamanho?: "n" | "p" | "g"; className?: string }) {
  return (
    <svg
      className={cx(s.ic, tamanho === "p" && s.icP, tamanho === "g" && s.icG, className)}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * A dobra do acordeão (E3): abre e fecha a altura com grid 0fr/1fr. Fechada, o conteúdo sai do Tab
 * e da leitura de tela (visibility: hidden depois da transição).
 */
export function Dobra({ aberta, children, as = "div" }: { aberta: boolean; children: ReactNode; as?: "div" | "li" }) {
  const Tag = as;
  return (
    <Tag className={cx(s.dobra, !aberta && s.fechado)} data-dobra={aberta ? "aberta" : "fechada"}>
      <div className={s.dobraIn} aria-hidden={!aberta || undefined} inert={!aberta || undefined}>
        {children}
      </div>
    </Tag>
  );
}

export interface PropsLogo {
  logo: string;
  alt: string;
  escura?: boolean | undefined;
  larga?: boolean | undefined;
  mini?: boolean | undefined;
}

/**
 * Logo de terceiro num ladrilho neutro: nunca o maior destaque da tela. Nas linhas e nos painéis o
 * nome da marca está escrito ao lado, então o logo é decoração (alt vazio): o leitor de tela não
 * lê "Meta, API oficial da Meta". Só o disco da validação, sem texto ao lado, leva o alt.
 */
export function LogoTile({ logo, escura, larga, mini }: PropsLogo) {
  return (
    <span className={cx(s.logoTile, escura && s.escura, larga && s.larga, mini && s.mini)} aria-hidden="true">
      <img src={logo} alt="" />
    </span>
  );
}

/** Linha da lista: logo ou ícone, nome, frase e a seta. */
export function Linha({
  id,
  inicio,
  nome,
  frase,
  extra,
  aoEscolher,
  ref,
}: {
  id: string;
  inicio: ReactNode;
  nome: string;
  frase: string;
  extra?: ReactNode;
  aoEscolher: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button type="button" id={id} ref={ref} className={s.linha} onClick={aoEscolher}>
      {inicio}
      <span className={s.linhaTexto}>
        <span className={s.linhaNome}>{nome}</span>
        <span className={s.linhaFrase}>{frase}</span>
        {extra}
      </span>
      <Icone d={IC.chevronDireita} className={s.linhaSeta} />
    </button>
  );
}

/** Botão compacto do F (.btn .btn-disc .btn-c), com a seta para a esquerda quando volta. */
export function BotaoCompacto({
  children,
  aoClicar,
  voltar = false,
  variante = "discreto",
  className,
  ...resto
}: {
  children: ReactNode;
  aoClicar: () => void;
  voltar?: boolean;
  variante?: "discreto" | "contorno";
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  return (
    <Botao
      variante={variante}
      className={cx(s.btnC, className)}
      onClick={aoClicar}
      icone={voltar ? <Icone d={IC.chevronEsquerda} tamanho="p" /> : undefined}
      {...resto}
    >
      {children}
    </Botao>
  );
}

/**
 * Cabeçalho do painel aberto: o mesmo logo, nome e frase da linha, e o Voltar. Sem `aoVoltar` (a
 * Voz, de um provedor só, não tem lista para onde voltar), o painel fica sem o botão.
 */
export function PainelCab({ inicio, nome, frase, aoVoltar }: { inicio: ReactNode; nome: string; frase: string; aoVoltar?: () => void }) {
  return (
    <div className={s.painelCab}>
      {inicio}
      <span className={s.linhaTexto}>
        <span className={s.linhaNome}>{nome}</span>
        <span className={s.linhaFrase}>{frase}</span>
      </span>
      {aoVoltar && (
        <BotaoCompacto aoClicar={aoVoltar} voltar>
          Voltar
        </BotaoCompacto>
      )}
    </div>
  );
}

/** Aviso de erro no topo do painel reaberto. */
export function AvisoErro({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <p className={cx(s.aviso, s.avisoErro)} role="alert">
      <Icone d={IC.alerta} />
      <span>
        <b>{titulo}</b> {texto}
      </span>
    </p>
  );
}

/** Linha de rodapé: "Outros provedores: Zernio e Descontinuado" · Ver todos. */
export function OutrosRodape({
  aberta,
  logos,
  texto,
  aoVerTodos,
}: {
  aberta: boolean;
  logos: readonly PropsLogo[];
  texto: string;
  aoVerTodos: () => void;
}) {
  return (
    <Dobra aberta={aberta}>
      <div className={cx(s.linhaResumo, s.pe)}>
        <span className={s.miniLogos} aria-hidden="true">
          {logos.map((l) => (
            <LogoTile key={l.logo} {...l} mini />
          ))}
        </span>
        <span className={s.resumoNome}>{texto}</span>
        <BotaoCompacto aoClicar={aoVerTodos}>Ver todos</BotaoCompacto>
      </div>
    </Dobra>
  );
}
