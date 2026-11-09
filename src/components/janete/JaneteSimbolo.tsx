import type { CSSProperties } from "react";
import { cx, type Classes } from "@/components/aipro/cx";
import estilos from "./JaneteSimbolo.module.css";

const s = estilos as Classes<"janete" | "ponto" | "falas" | "check">;

/**
 * dormindo: cinza, respira devagar (antes de conectar) · carregando: o ponto gira
 * (validação, preparo) · check: o ponto some e o traço do check é desenhado ·
 * acordada: navy, o ponto respira · fala: o disco vira balão e o ponto se abre em três.
 */
export type EstadoJanete = "dormindo" | "carregando" | "check" | "acordada" | "fala";

export const ESTADOS_JANETE: readonly EstadoJanete[] = [
  "dormindo",
  "carregando",
  "check",
  "acordada",
  "fala",
];

const ROTULOS: Record<EstadoJanete, string> = {
  dormindo: "Janete, em repouso",
  carregando: "Janete, carregando",
  check: "Janete, tudo certo",
  acordada: "Janete",
  fala: "Janete, falando",
};

type Props = {
  estado?: EstadoJanete | undefined;
  /** Lado do disco em px (os do F: 20, 28, 36, 40, 56, 112, 144). Padrão 40. */
  tamanho?: number | undefined;
  /** Só em `fala`: os três pontos pulam em onda (o "digitando" do chat). */
  digitando?: boolean | undefined;
  /** Nome acessível. Padrão (também com ""): o do estado ("Janete, carregando"). */
  rotulo?: string | undefined;
  /** Ao lado do nome "Janete" já escrito, o símbolo é decoração: `aria-hidden`. */
  decorativo?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** `data-*` repassados ao disco (alvo do voo entre etapas, `data-testid`). */
  [dado: `data-${string}`]: string | undefined;
};

/**
 * O símbolo da Janete. Um componente só para todos os estados: trocar `estado` faz a
 * transição contínua copiada do F (a cor do disco, o canto do balão, o ponto e o
 * check animam entre si). Com `prefers-reduced-motion`, vai direto ao estado final.
 *
 * Dentro de um botão com `data-janete-gatilho`, o símbolo vira o balão de fala no hover
 * e no foco (o botão do canto "Fale com a Janete").
 */
export function JaneteSimbolo({
  estado = "acordada",
  tamanho = 40,
  digitando = false,
  rotulo,
  decorativo = false,
  className,
  style,
  ...dados
}: Props) {
  const acessivel = decorativo
    ? ({ "aria-hidden": true } as const)
    : ({
        role: "img",
        // `||`, não `??`: rótulo vazio cai no do estado (para esconder, use `decorativo`).
        "aria-label": rotulo || (estado === "fala" && digitando ? "Janete, digitando" : ROTULOS[estado]),
      } as const);

  return (
    <span
      {...dados}
      {...acessivel}
      className={cx(s.janete, className)}
      data-estado={estado}
      data-digitando={(estado === "fala" && digitando) || undefined}
      style={{ width: tamanho, height: tamanho, ...style }}
    >
      <span className={s.ponto} aria-hidden="true" />
      <span className={s.falas} aria-hidden="true">
        <span />
        <span />
      </span>
      <svg className={s.check} viewBox="0 0 112 112" aria-hidden="true" focusable="false">
        <path d="M37 57l13 13 26-28" />
      </svg>
    </span>
  );
}
