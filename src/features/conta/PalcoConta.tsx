import { useMatches } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { movimentoReduzido, useVooJanete, type ControleVoo, type LegendaVoo } from "@/components/janete/VooJanete";
import { type Classes } from "@/components/aipro/cx";

import {
  CLIP_CHEIO,
  clipCentro,
  criarMovimentoJanete,
  insetPonto,
  ladoDoDisco,
  type MovimentoJanete,
  type RefsDisco,
} from "./movimento";
import estilos from "./PalcoConta.module.css";

const s = estilos as Classes<
  | "cena"
  | "palco"
  | "gigante"
  | "discoPos"
  | "disco"
  | "noite"
  | "ponto"
  | "pontoAzul"
  | "sombra"
  | "cartao"
  | "conteudo"
  | "veu"
  | "carregando"
>;

/**
 * O palco do login (proposta A, "Presença"): a Janete, dormindo, é um disco cinza gigante atrás do
 * cartão, e o cartão é o ponto de fala dela. Fica na rota de layout de Entrar e Criar conta, para a
 * bola não remontar na troca entre as duas telas: o cartão é o mesmo elemento nas duas.
 *
 * Três momentos, copiados do protótipo `docs/mockups/conta/Login-A-Presenca.dc.html`:
 *   a entrada (2,2 s, toda vez que o login abre): ela cresce até virar o cenário e o ponto abre no cartão;
 *   a troca de tela, sem movimento: só a bola acompanha o tamanho do cartão novo (480 ms);
 *   a passagem (depois de entrar ou criar a conta): o cartão fecha no ponto e a bola se contrai no
 *   `carregando` de 96 px no centro.
 *
 * A fase vai em `data-fase` no `main`, escrita direto no elemento no mesmo instante das animações (o
 * JSX traz o fixo "inicio", para o React nunca sobrescrever). O CSS esconde a bola e o cartão em
 * cada fase. Animações só com `el.animate`, `cancel()` e os eventos `finish` e `cancel`.
 */

export const ESPERA_NO_CENTRO_MS = 660;
export const IDS_PALCO = { cena: "palco-cena", disco: "palco-disco", cartao: "palco-cartao" } as const;

export type OpcoesPassagem = { voo: true; legenda: LegendaVoo } | { voo: false };

export interface ControlePalcoConta {
  /** O e-mail compartilhado entre as telas (a senha nunca vai junto). */
  email: string;
  definirEmail: (valor: string) => void;
  /** A senha errada: a bola treme. Não faz nada com movimento reduzido. */
  tremer: () => void;
  /** Corta a entrada se ela estiver tocando (o envio chama antes de começar). */
  assentar: () => void;
  /**
   * O fim do Entrar e do Criar conta. Resolve `true` no quadro em que o `carregando` assume o centro;
   * `false`, sem mexer em nada, com movimento reduzido, sem WAAPI, sem provedor, com o palco
   * desmontado ou com outra passagem em curso (e também se o palco desmontar no meio).
   */
  passagem: (opcoes: OpcoesPassagem) => Promise<boolean>;
}

const VAZIO: ControlePalcoConta = {
  email: "",
  definirEmail: () => {},
  tremer: () => {},
  assentar: () => {},
  passagem: () => Promise.resolve(false),
};

const Contexto = createContext<ControlePalcoConta>(VAZIO);

/** Sem provedor (uma tela solta nos testes): e-mail vazio, nada anima e a passagem devolve `false`. */
export function usePalcoConta(): ControlePalcoConta {
  return useContext(Contexto);
}

type Fase = "inicio" | "entrada" | "abrindo" | "aberto" | "passagem" | "absorvido" | "fim";

/* Tempos e curvas do protótipo. */
const CURVA_ABRE = "cubic-bezier(0.45, 0, 0.1, 1)";
const CURVA_SAIDA = "cubic-bezier(0.16, 1, 0.3, 1)";
const CURVA_SNAP = "cubic-bezier(0.2, 0.7, 0.2, 1)";
const CURVA_FECHA = "cubic-bezier(0.65, 0, 0.35, 1)";
const CURVA_ABSORVE = "cubic-bezier(0.7, 0, 0.2, 1)";
/** O tamanho do símbolo no primeiro quadro da entrada e no fim da passagem. */
const TAMANHO_JANETE = 96;
/** O ponto ocupa 46% do disco e fica parado em 0,88 (o meio do sono do símbolo). */
const PONTO_FRACAO = 0.46;
const PONTO_SONO = 0.88;
const CRESCE_MS = 1250;
/** A entrada: o ponto começa a abrir aos 1050 ms e leva 760 ms; fica escuro até 72% e branco aos 87%. */
const ENTRADA_ABRE_MS = 1050;
const ABRE_MS = 760;
const ABRE_CORTE = 0.72;
const ABRE_BRANCO = 0.87;
const BLOCO_MS = 380;
const BLOCO_PASSO_MS = 70;
const AJUSTE_MS = 480;
const OCIOSO_MS = 1200;
const SAI_CONTEUDO_MS = 180;
const FECHA_MS = 520;
const ABSORVE_MS = 860;
/** O conteúdo do cartão entra em quatro blocos; o `Campo` já marca o dele com `data-campo`. */
const BLOCOS = '[data-bloco="0"], [data-campo], [data-bloco="2"], [data-bloco="3"]';

const temWaapi = () => typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
/** Movimento reduzido ou navegador sem Web Animations: tudo parado desde o primeiro quadro. */
const reduzido = () => movimentoReduzido() || !temWaapi();
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface DomPalco {
  cena: RefObject<HTMLElement | null>;
  disco: RefObject<HTMLDivElement | null>;
  noite: RefObject<HTMLDivElement | null>;
  ponto: RefObject<HTMLDivElement | null>;
  pontoAzul: RefObject<HTMLSpanElement | null>;
  sombra: RefObject<HTMLDivElement | null>;
  cartao: RefObject<HTMLDivElement | null>;
  conteudo: RefObject<HTMLDivElement | null>;
  veu: RefObject<HTMLDivElement | null>;
}

interface Centro {
  x: number;
  y: number;
}

interface Motor {
  iniciar(): void;
  parar(): void;
  assentar(): void;
  trocou(): void;
  passagem(opcoes: OpcoesPassagem): Promise<boolean>;
  /** O layout effect do estado de fim: marca a fase e resolve a passagem. */
  concluir(): void;
  moverPonteiro(ev: { pointerType: string; clientX: number; clientY: number }): void;
  sairPonteiro(): void;
  focoEntrou(): void;
}

/**
 * O motor do palco: o mesmo artboard do protótipo (fora do React), escrevendo direto no DOM pelos
 * refs. `iniciar` e `parar` são simétricos: o StrictMode do dev monta, desmonta e monta de novo, e a
 * segunda montagem toca a entrada limpa. `aoFim` grava o estado de fim no React.
 */
function criarMotor(
  dom: DomPalco,
  janete: MovimentoJanete,
  aoFim: (centro: Centro, opcoes: OpcoesPassagem) => void,
): Motor {
  let fase: Fase = "inicio";
  let montado = false;
  // Geração: sobe a cada cancelamento, e o que foi agendado antes não roda mais.
  let ger = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const anims = new Set<Animation>();
  let D = 1;
  let refs: RefsDisco = { larguraRef: 0, alturaRef: 0 };
  let ajuste: Animation | null = null;
  let ocioso: ReturnType<typeof setTimeout> | undefined;
  let resolver: ((ok: boolean) => void) | null = null;
  let ro: ResizeObserver | null = null;
  let mq: MediaQueryList | null = null;

  const larguraJanela = () => window.innerWidth || 1;
  const alturaJanela = () => window.innerHeight || 1;
  /** O meio da largura em que o cartão está centrado: o centro do próprio `main` do palco. No
   *  computador, o `scrollbar-gutter: stable` do html reserva 15 px à direita, e o cartão fica centrado
   *  no que sobra (em 1440, 712,5, não 720). Medir o `main` vale com a barra clássica, flutuante ou
   *  escondida (o clientWidth do html nem sempre desconta a reserva). Sem medida, cai no clientWidth. */
  const meioDaLargura = () => {
    const r = dom.cena.current?.getBoundingClientRect();
    if (r && r.width) return r.left + r.width / 2;
    return (document.documentElement.clientWidth || larguraJanela()) / 2;
  };

  /* ---------- Tempos e animações canceláveis ---------- */

  function depois(fn: () => void, ms: number) {
    const g = ger;
    const t = setTimeout(() => {
      timers.delete(t);
      if (g === ger) fn();
    }, ms);
    timers.add(t);
  }

  function animar(alvo: Element, quadros: Keyframe[], opcoes: KeyframeAnimationOptions): Animation {
    const a = alvo.animate(quadros, opcoes);
    anims.add(a);
    const fica = opcoes.fill === "forwards" || opcoes.fill === "both";
    a.addEventListener("cancel", () => anims.delete(a));
    if (!fica) a.addEventListener("finish", () => anims.delete(a));
    return a;
  }

  function aoTerminar(a: Animation, fn: () => void) {
    const g = ger;
    a.addEventListener("finish", () => {
      if (g === ger) fn();
    });
  }

  function cancelarTudo() {
    ger += 1;
    timers.forEach(clearTimeout);
    timers.clear();
    Array.from(anims).forEach((a) => a.cancel());
    anims.clear();
    ajuste = null;
  }

  /** A fase visível, direto no `main`, no mesmo instante das animações. */
  function marcarFase(f: Fase) {
    fase = f;
    dom.cena.current?.setAttribute("data-fase", f);
  }

  /* ---------- Medidas ---------- */

  function medirD() {
    D = dom.disco.current?.offsetWidth || 1;
  }

  function dimensionar() {
    const cena = dom.cena.current;
    const cartao = dom.cartao.current;
    if (!cena || !cartao) return;
    const r = ladoDoDisco(
      { largura: larguraJanela(), altura: alturaJanela() },
      { largura: cartao.offsetWidth, altura: cartao.offsetHeight },
      refs,
    );
    refs = { larguraRef: r.larguraRef, alturaRef: r.alturaRef };
    cena.style.setProperty("--d", `${r.lado}px`);
  }

  /**
   * Remede o disco. Com `suave`, ele cresce ou diminui até o tamanho novo em 480 ms (só transform):
   * acompanha o cartão na troca de tela e quando aparece um erro. Sem `suave`, é na hora.
   */
  function ajustarDisco(suave = false) {
    const D0 = D;
    dimensionar();
    medirD();
    janete.pintar();
    if (!suave || reduzido() || D0 <= 1 || Math.abs(D - D0) < 1) return;
    const disco = dom.disco.current;
    if (!disco) return;
    ajuste?.cancel();
    ajuste = animar(disco, [{ transform: `scale(${(D0 / D).toFixed(5)})` }, { transform: "scale(1)" }], {
      duration: AJUSTE_MS,
      easing: CURVA_SAIDA,
    });
  }

  /** O ponto real, em coordenadas do cartão (para o cartão nascer exatamente dele). */
  function clipDoPonto(): string {
    const ponto = dom.ponto.current;
    const cartao = dom.cartao.current;
    if (!ponto || !cartao) return CLIP_CHEIO;
    const p = ponto.getBoundingClientRect();
    const c = cartao.getBoundingClientRect();
    const lado = (p.width + p.height) / 2;
    const cx = p.left + p.width / 2 - c.left;
    const cy = p.top + p.height / 2 - c.top;
    return insetPonto(cy - lado / 2, c.width - cx - lado / 2, c.height - cy - lado / 2, cx - lado / 2, lado);
  }

  /* ---------- O estado assentado: disco inteiro, cartão aberto, nada animando ---------- */

  function limparDom() {
    dom.sombra.current?.removeAttribute("data-plano");
    dom.ponto.current?.removeAttribute("style");
    dom.cartao.current?.removeAttribute("inert");
  }

  function baseDom() {
    marcarFase("aberto");
    limparDom();
    dimensionar();
    medirD();
    janete.repor();
  }

  function assentarJa() {
    cancelarTudo();
    baseDom();
  }

  const tocandoEntrada = () => fase === "entrada" || fase === "abrindo";

  /* ---------- 1º momento: a entrada (0 a 2,2 s) ----------
     0          o símbolo dela, 96 px, já inteiro e com o ponto escuro, dormindo no centro;
     220–1250   ela inspira e cresce até virar o cenário;
     1050–1810  o ponto de fala (escuro) incha até a forma do cartão; aos 1597 ms ele fica branco
                num corte curto, junto com a sombra e o conteúdo;
     1597–2187  o conteúdo do cartão entra em quatro blocos. */

  function entrada() {
    limparDom();
    marcarFase("entrada");
    dimensionar();
    medirD();
    const disco = dom.disco.current;
    const ponto = dom.ponto.current;
    if (!disco || !ponto) return;
    const s0 = (TAMANHO_JANETE / D).toFixed(5);
    ponto.style.opacity = "1";
    animar(
      disco,
      [
        { transform: `scale(${s0})`, easing: "linear" },
        { transform: `scale(${s0})`, offset: 0.176, easing: "cubic-bezier(0.6, 0, 0.12, 1)" },
        { transform: "scale(1)" },
      ],
      { duration: CRESCE_MS, fill: "backwards" },
    );
    const corte = ENTRADA_ABRE_MS + Math.round(ABRE_MS * ABRE_CORTE);
    entrarConteudo(corte);
    depois(abrirCartao, ENTRADA_ABRE_MS);
    depois(() => {
      marcarFase("aberto");
      ajustarDisco();
    }, corte + 3 * BLOCO_PASSO_MS + BLOCO_MS + 10);
  }

  function entrarConteudo(atraso: number) {
    dom.conteudo.current?.querySelectorAll(BLOCOS).forEach((b) => {
      const ordem = b.hasAttribute("data-campo") ? 1 : Number(b.getAttribute("data-bloco")) || 0;
      animar(b, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
        duration: BLOCO_MS,
        delay: atraso + ordem * BLOCO_PASSO_MS,
        easing: CURVA_SAIDA,
        fill: "backwards",
      });
    });
  }

  /**
   * O ponto de fala vira o cartão: a forma do ponto (medida ao vivo) abre até o cartão inteiro. Ele
   * continua escuro quase até o fim, para o olho acompanhar o ponto virando o cartão, e só então fica
   * branco, ao mesmo tempo que a sombra volta e o conteúdo entra.
   */
  function abrirCartao() {
    const cartao = dom.cartao.current;
    const veu = dom.veu.current;
    const sombra = dom.sombra.current;
    if (!cartao || !veu || !sombra) return;
    const inicio = clipDoPonto();
    if (dom.ponto.current) dom.ponto.current.style.opacity = "0";
    marcarFase("abrindo");
    sombra.setAttribute("data-plano", "");
    animar(cartao, [{ clipPath: inicio }, { clipPath: CLIP_CHEIO }], { duration: ABRE_MS, easing: CURVA_ABRE });
    animar(veu, [{ opacity: 1 }, { opacity: 1, offset: ABRE_CORTE }, { opacity: 0, offset: ABRE_BRANCO }, { opacity: 0 }], {
      duration: ABRE_MS,
      easing: "linear",
    });
    depois(() => sombra.removeAttribute("data-plano"), Math.round(ABRE_MS * ABRE_CORTE));
  }

  /* ---------- 2º momento: a passagem (1,38 s) ----------
     0–520      o conteúdo sai e o cartão se fecha de volta no ponto de fala (cinza);
     520–1380   o disco absorve o ponto e se contrai até 96 px no centro da tela; só nos últimos
                18% ele ganha o navy e o ponto o azul do `carregando`;
     1380       o `carregando` de 96 px assume (o do voo, ou o do próprio palco). */

  function passagem(opcoes: OpcoesPassagem): Promise<boolean> {
    if (!montado || reduzido() || resolver) return Promise.resolve(false);
    if (fase !== "aberto" && !tocandoEntrada()) return Promise.resolve(false);
    const cartao = dom.cartao.current;
    const sombra = dom.sombra.current;
    const conteudo = dom.conteudo.current;
    const veu = dom.veu.current;
    const disco = dom.disco.current;
    const ponto = dom.ponto.current;
    const noite = dom.noite.current;
    const pontoAzul = dom.pontoAzul.current;
    if (!cartao || !sombra || !conteudo || !veu || !disco || !ponto || !noite || !pontoAzul) {
      return Promise.resolve(false);
    }
    if (tocandoEntrada()) assentarJa();
    const promessa = new Promise<boolean>((r) => (resolver = r));

    marcarFase("passagem");
    const ativo = document.activeElement;
    if (ativo instanceof HTMLElement && ativo !== document.body) ativo.blur();
    cartao.setAttribute("inert", "");
    janete.acalmar();
    medirD();
    const lado = D * PONTO_FRACAO * PONTO_SONO;
    const r = cartao.getBoundingClientRect();
    sombra.setAttribute("data-plano", "");
    animar(conteudo, [{ opacity: 1 }, { opacity: 0 }], { duration: SAI_CONTEUDO_MS, easing: CURVA_SNAP, fill: "forwards" });
    const fecha = animar(cartao, [{ clipPath: CLIP_CHEIO }, { clipPath: clipCentro(r, lado) }], {
      duration: FECHA_MS,
      easing: CURVA_FECHA,
      fill: "forwards",
    });
    const escurece = animar(veu, [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 0.7 }, { opacity: 1 }], {
      duration: FECHA_MS,
      easing: "linear",
      fill: "forwards",
    });

    aoTerminar(fecha, () => {
      ponto.style.opacity = "1";
      marcarFase("absorvido");
      fecha.cancel();
      escurece.cancel();
      const c = cartao.getBoundingClientRect();
      const off = janete.deslocamento();
      const dx = meioDaLargura() - (c.left + c.width / 2) - off.x;
      const dy = alturaJanela() / 2 - (c.top + c.height / 2) - off.y;
      const sf = TAMANHO_JANETE / D;
      // Só transform e opacidade: o navy e o azul são camadas por cima do cinza que acendem nos
      // últimos 18% (a contração em si não redesenha nada).
      const opcoesAbsorve: KeyframeAnimationOptions = { duration: ABSORVE_MS, easing: CURVA_ABSORVE, fill: "forwards" };
      const contrai = animar(
        disco,
        [
          { transform: "translate(0px, 0px) scale(1)" },
          { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sf.toFixed(5)})` },
        ],
        opcoesAbsorve,
      );
      animar(ponto, [{ transform: `scale(${PONTO_SONO})` }, { transform: "scale(1)" }], opcoesAbsorve);
      const acende: Keyframe[] = [{ opacity: 0 }, { opacity: 0, offset: 0.82 }, { opacity: 1 }];
      animar(noite, acende, opcoesAbsorve);
      animar(pontoAzul, acende, opcoesAbsorve);
      // O protótipo espera 860 ms num timer; aqui é o fim da contração (o mesmo instante), para a
      // WAAPI falsa dos testes poder encurtar o tempo.
      aoTerminar(contrai, () => aoFim(centroDoDisco(), opcoes));
    });
    return promessa;
  }

  /** O centro do disco já contraído; medida vazia (largura 0) cai no centro da janela (sem a barra). */
  function centroDoDisco(): Centro {
    const r = dom.disco.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: meioDaLargura(), y: alturaJanela() / 2 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ---------- Ouvintes ---------- */

  const aoRedimensionar = () => {
    if (fase === "aberto" || fase === "fim") ajustarDisco();
    else janete.pintar();
  };

  const aoMudarVisibilidade = () => {
    if (document.hidden) janete.pausar();
    else janete.retomar();
  };

  /** A preferência mudou com a tela aberta: corta a entrada, ou só põe a bola no lugar. */
  const aoMudarPreferencia = () => {
    if (!reduzido()) return;
    if (tocandoEntrada()) assentarJa();
    else if (fase === "aberto") janete.repor();
  };

  return {
    iniciar() {
      montado = true;
      window.addEventListener("resize", aoRedimensionar);
      document.addEventListener("visibilitychange", aoMudarVisibilidade);
      try {
        mq = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
        mq?.addEventListener?.("change", aoMudarPreferencia);
      } catch {
        mq = null;
      }
      // O cartão mudou de altura (um erro apareceu ou saiu, a fonte carregou, a outra tela): o
      // disco acompanha, para o cartão nunca sair dele.
      const cartao = dom.cartao.current;
      if (cartao && typeof ResizeObserver === "function") {
        ro = new ResizeObserver(() => {
          if (fase === "aberto") ajustarDisco(true);
        });
        ro.observe(cartao);
      }
      janete.repor();
      if (reduzido()) baseDom();
      else entrada();
    },

    parar() {
      montado = false;
      cancelarTudo();
      janete.pausar();
      clearTimeout(ocioso);
      window.removeEventListener("resize", aoRedimensionar);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      try {
        mq?.removeEventListener?.("change", aoMudarPreferencia);
      } catch {
        /* nada */
      }
      mq = null;
      ro?.disconnect();
      ro = null;
      const r = resolver;
      resolver = null;
      r?.(false);
    },

    assentar() {
      if (montado && tocandoEntrada()) assentarJa();
    },

    /** A tela filha trocou (o caminho mudou e o filho novo já montou). */
    trocou() {
      if (!montado) return;
      if (tocandoEntrada()) assentarJa();
      else if (fase === "aberto") ajustarDisco(true);
      dom.cartao.current?.querySelector("h1")?.focus({ preventScroll: true });
    },

    passagem,

    concluir() {
      if (!montado || !resolver) return;
      marcarFase("fim");
      const r = resolver;
      resolver = null;
      r(true);
    },

    /** O cursor inclina o disco de leve; parado 1,2 s (o normal enquanto a pessoa digita), ele volta. */
    moverPonteiro(ev) {
      if (ev.pointerType && ev.pointerType !== "mouse" && ev.pointerType !== "pen") return;
      const w = larguraJanela() / 2 || 1;
      const h = alturaJanela() / 2 || 1;
      janete.olhar(clamp((ev.clientX - w) / w, -1, 1), clamp((ev.clientY - h) / h, -1, 1));
      clearTimeout(ocioso);
      ocioso = setTimeout(() => janete.recentrar(), OCIOSO_MS);
    },

    sairPonteiro() {
      clearTimeout(ocioso);
      janete.recentrar();
    },

    /** Quem chega pelo teclado durante a entrada não espera: a tela assenta na hora. */
    focoEntrou() {
      if (tocandoEntrada()) assentarJa();
    },
  };
}

interface EstadoFim {
  voo: boolean;
  x: number;
  y: number;
}

export function PalcoConta({ children }: { children: ReactNode }): JSX.Element {
  const voo = useVooJanete();
  const vooRef = useRef<ControleVoo>(voo);
  useEffect(() => {
    vooRef.current = voo;
  });

  const [email, definirEmail] = useState("");
  const [fim, setFim] = useState<EstadoFim | null>(null);

  const dom: DomPalco = {
    cena: useRef<HTMLElement>(null),
    disco: useRef<HTMLDivElement>(null),
    noite: useRef<HTMLDivElement>(null),
    ponto: useRef<HTMLDivElement>(null),
    pontoAzul: useRef<HTMLSpanElement>(null),
    sombra: useRef<HTMLDivElement>(null),
    cartao: useRef<HTMLDivElement>(null),
    conteudo: useRef<HTMLDivElement>(null),
    veu: useRef<HTMLDivElement>(null),
  };
  const discoPos = useRef<HTMLDivElement>(null);

  const [janete] = useState(() => criarMovimentoJanete(() => discoPos.current, reduzido));
  const [motor] = useState(() =>
    criarMotor(dom, janete, (centro, opcoes) => {
      // No mesmo tique: o símbolo em trânsito (ou o carregando do palco) aparece no mesmo quadro em
      // que o `data-fase="fim"` esconde a bola.
      if (opcoes.voo) {
        vooRef.current.pousar({ ...centro, tamanho: TAMANHO_JANETE }, "carregando", { metamorfose: true });
        vooRef.current.legenda(opcoes.legenda);
      }
      setFim({ voo: opcoes.voo, ...centro });
    }),
  );

  useLayoutEffect(() => {
    motor.iniciar();
    return () => motor.parar();
  }, [motor]);

  // O fim: marca a fase e resolve a passagem. Sem voo, o foco vai para o carregando do palco (o
  // `focar('fim')` do protótipo): o cartão está inert, e o foco não fica perdido no body até a
  // próxima página. Com voo, quem assume é o VooJanete.
  useLayoutEffect(() => {
    if (!fim) return;
    motor.concluir();
    if (fim.voo) return;
    const carregando = document.querySelector<HTMLElement>("[data-palco-carregando]");
    if (!carregando) return;
    carregando.tabIndex = -1;
    carregando.focus({ preventScroll: true });
  }, [fim, motor]);

  // A troca de tela: o caminho apresentado mudou, e o filho novo já montou. Na primeira montagem
  // (e na remontagem do StrictMode, com o mesmo caminho) não foca nada.
  const caminho = useMatches({ select: (ms) => ms[ms.length - 1]?.pathname ?? "" });
  const caminhoVisto = useRef<string | null>(null);
  useEffect(() => {
    if (caminhoVisto.current === null) {
      caminhoVisto.current = caminho;
      return;
    }
    if (caminhoVisto.current === caminho) return;
    caminhoVisto.current = caminho;
    motor.trocou();
  }, [caminho, motor]);

  const tremer = useCallback(() => janete.tremer(), [janete]);
  const assentar = useCallback(() => motor.assentar(), [motor]);
  const passagem = useCallback((opcoes: OpcoesPassagem) => motor.passagem(opcoes), [motor]);
  const controle = useMemo<ControlePalcoConta>(
    () => ({ email, definirEmail, tremer, assentar, passagem }),
    [email, tremer, assentar, passagem],
  );

  return (
    <Contexto.Provider value={controle}>
      <main
        ref={dom.cena}
        id={IDS_PALCO.cena}
        className={s.cena}
        data-identidade="aipro"
        data-fase="inicio"
        onPointerMove={motor.moverPonteiro}
        onPointerLeave={motor.sairPonteiro}
      >
        <div className={s.palco}>
          {/* A Janete, dormindo, do tamanho da tela. Decoração: o leitor de tela não a vê. */}
          <div className={s.gigante} aria-hidden="true">
            <div ref={discoPos} className={s.discoPos}>
              <div ref={dom.disco} id={IDS_PALCO.disco} className={s.disco}>
                <div ref={dom.noite} className={s.noite} />
                <div ref={dom.ponto} className={s.ponto}>
                  <span ref={dom.pontoAzul} className={s.pontoAzul} />
                </div>
              </div>
            </div>
          </div>

          <div ref={dom.sombra} className={s.sombra}>
            <div ref={dom.cartao} id={IDS_PALCO.cartao} className={s.cartao} onFocus={motor.focoEntrou}>
              {/* O invólucro do conteúdo: a passagem apaga a tela inteira de uma vez. */}
              <div ref={dom.conteudo} className={s.conteudo}>
                {children}
              </div>
              <div ref={dom.veu} className={s.veu} aria-hidden="true" />
            </div>
          </div>
        </div>
      </main>
      {fim && !fim.voo ? (
        <JaneteSimbolo
          estado="carregando"
          tamanho={TAMANHO_JANETE}
          rotulo="Janete, carregando"
          className={s.carregando}
          data-palco-carregando=""
          style={{ left: fim.x, top: fim.y }}
        />
      ) : null}
    </Contexto.Provider>
  );
}
