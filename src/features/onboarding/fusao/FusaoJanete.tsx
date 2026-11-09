import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { movimentoReduzido, type PontoJanete } from "@/components/janete/VooJanete";

import { usePalco } from "../palco";
import estilos from "./FusaoJanete.module.css";

const s = estilos as Classes<"cena" | "peca" | "logo" | "moeda" | "face" | "check" | "verso" | "escura" | "janete">;

// A cena do 2d (docs/spec-ajustes-onboarding-r2.md): depois do "Próximo" no cérebro, o check vira de
// novo o logo da IA escolhida, o logo vai para a esquerda e de trás dele surge a Janete em preto e branco
// (estado "dormindo"), indo para a direita; os dois se fundem, a Janete ganha cor e a cena entrega o
// ponto onde ela ficou, para o voo até o "Oi, eu sou a Janete".
//
// Quem chama: mede o disco da validação com rolarAteEMedir (a origem), esconde o disco dele enquanto a
// cena roda (a cena fica por cima, mas o logo sai do lugar e o disco de baixo apareceria) e, em
// aoTerminar, faz voo.pousar(ponto, "acordada") e avancar().

export interface LogoFusao {
  src: string;
  alt: string;
  /** tile escuro (grafite), para um logo de cor clara; hoje nenhum motor de MOTORES usa */
  escura?: boolean;
}

export interface PropsFusaoJanete {
  /** o logo da IA escolhida (MOTORES, em lista/dados.ts) */
  logo: LogoFusao;
  /** centro e lado do disco da validação (o check), na tela: a cena começa ali */
  origem: PontoJanete;
  /** no fim, o ponto da Janete já colorida: quem chama faz voo.pousar(ponto, "acordada") e avança */
  aoTerminar: (ponto: PontoJanete) => void;
}

/**
 * check (o disco como a validação deixou) → vira (meia volta da moeda: aparece o logo) → separa (o
 * logo à esquerda, a Janete dormindo à direita) → junta (os dois no centro, o logo some dentro dela) →
 * acorda (ela ganha cor) → fim (aoTerminar).
 */
export type FaseFusao = "check" | "vira" | "separa" | "junta" | "acorda" | "fim";

/** Quando cada fase começa, em ms desde a montagem. A cena inteira dura 2,44 s. */
export const INICIO_FUSAO = {
  vira: 120,
  separa: 680,
  junta: 1320,
  acorda: 1880,
  fim: 2440,
} as const satisfies Record<Exclude<FaseFusao, "check">, number>;

export const DURACAO_FUSAO_MS = INICIO_FUSAO.fim;

/** Texto para o leitor de tela (a cena é aria-hidden). */
export const ANUNCIO_FUSAO = "Cérebro conectado. A Janete está acordando.";

/** Escala das duas peças enquanto estão separadas (a Janete sai de trás do logo, menor que ele). */
const ESCALA_SEPARADA = 0.84;
/** Folga mínima até a borda da tela, como o gutter das telas (16 px). */
const BORDA = 16;

/**
 * Quanto cada peça anda para o lado: até 56% do disco, sem sair da tela no celular (390 px), e
 * nunca menos que 30% (as duas ainda se afastam o bastante para ler o logo).
 */
export function afastamento(origem: PontoJanete, larguraTela: number): number {
  const meia = (origem.tamanho * ESCALA_SEPARADA) / 2;
  const cabe = Math.min(origem.x - BORDA - meia, larguraTela - BORDA - meia - origem.x);
  return Math.max(origem.tamanho * 0.3, Math.min(origem.tamanho * 0.56, cabe));
}

/** Renderiza a cena por cima da tela (posição fixa). Com movimento reduzido, termina na hora. */
export function FusaoJanete({ logo, origem, aoTerminar }: PropsFusaoJanete) {
  const { anunciar } = usePalco();
  const [reduzido] = useState(movimentoReduzido);
  const [fase, setFase] = useState<FaseFusao>("check");
  // A Janete termina no lugar do disco, com o lado dele: é ali que o símbolo em voo pousa.
  const [ponto] = useState<PontoJanete>(() => ({ x: origem.x, y: origem.y, tamanho: origem.tamanho }));
  const [afasta] = useState(() =>
    afastamento(origem, typeof window !== "undefined" ? window.innerWidth : origem.x * 2),
  );
  const aoTerminarRef = useRef(aoTerminar);
  aoTerminarRef.current = aoTerminar;
  // No modo estrito do React o efeito roda duas vezes: aoTerminar só uma.
  const terminou = useRef(false);

  useEffect(() => {
    anunciar(ANUNCIO_FUSAO);
    const terminar = () => {
      if (terminou.current) return;
      terminou.current = true;
      aoTerminarRef.current(ponto);
    };
    if (reduzido) {
      terminar();
      return;
    }
    const timers = [
      setTimeout(() => setFase("vira"), INICIO_FUSAO.vira),
      setTimeout(() => setFase("separa"), INICIO_FUSAO.separa),
      setTimeout(() => setFase("junta"), INICIO_FUSAO.junta),
      setTimeout(() => setFase("acorda"), INICIO_FUSAO.acorda),
      setTimeout(() => {
        setFase("fim");
        terminar();
      }, INICIO_FUSAO.fim),
    ];
    return () => timers.forEach(clearTimeout);
    // só na montagem: a cena é uma só, do começo ao fim
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reduzido || typeof document === "undefined") return null;

  const lugar: CSSProperties = {
    left: ponto.x - ponto.tamanho / 2,
    top: ponto.y - ponto.tamanho / 2,
    width: ponto.tamanho,
    height: ponto.tamanho,
  };
  const dormindo = fase !== "acorda" && fase !== "fim";

  return createPortal(
    <div
      className={s.cena}
      data-identidade="aipro"
      data-fusao-janete=""
      data-fase={fase}
      aria-hidden="true"
      style={{ "--afasta": `${afasta}px` } as CSSProperties}
    >
      <div className={cx(s.peca, s.janete)} style={lugar} data-peca="janete">
        <JaneteSimbolo decorativo tamanho={ponto.tamanho} estado={dormindo ? "dormindo" : "acordada"} />
      </div>
      <div className={cx(s.peca, s.logo)} style={lugar} data-peca="logo">
        <div className={s.moeda}>
          <div className={cx(s.face, s.check)}>
            <svg viewBox="0 0 112 112" focusable="false">
              <path d="M37 57l13 13 26-28" />
            </svg>
          </div>
          <div className={cx(s.face, s.verso, logo.escura && s.escura)}>
            <img src={logo.src} alt={logo.alt} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
