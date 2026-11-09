import { useLayoutEffect, useRef, useState } from "react";

import type { EstadoJanete } from "@/components/janete/JaneteSimbolo";
import { DURACAO_VOO_LONGO_MS, medirJanete, movimentoReduzido, rolarAteEMedir, useVooJanete } from "@/components/janete/VooJanete";

import { ID_PAINEL } from "../../../PainelJanete";

// A Janete entrando e saindo do Dashboard (docs/spec-dashboard.md, seção 6).
//
// Entrada: o símbolo sai do botão do canto (#janete-gatilho), voa até o lugar dela na composição
// ([data-dash="janete"], um invólucro do tamanho exato do símbolo) e o símbolo da página aparece no
// pouso. Enquanto ela mora aqui, o botão do canto fica vazio (visibility hidden + aria-hidden); um
// MutationObserver esconde o botão de novo sempre que a casca o recria (o fim do tour, o fechar do
// painel "Fale com a Janete").
//
// Saída: na limpeza do layout effect, com o nó ainda na tela, o símbolo do voo pousa onde ela está
// (no mesmo commit, para ela não piscar no lugar) e um setTimeout(0) faz o voo de volta até o botão do
// canto; no fim, o botão é devolvido. No StrictMode (e quando o roteador remonta a tela) a montagem
// seguinte cancela a saída: solta o pouso e, se a entrada ainda estava em voo, adota esse voo (a
// cadeia chama o `mostrar` da montagem corrente).
//
// Casos que a saída trata:
// - a entrada ainda em voo (sair no 1º segundo): o voo é redirecionado para o canto, nunca fica órfão;
// - outro lugar da Janete já na tela quando o timer corre (uma remontagem, ou a volta ao Dashboard antes
//   de o voo de volta terminar): não voa nem devolve o botão; quem chegou cuida dele;
// - um voo ativo que não é nosso (a chegada do onboarding): só devolve o botão;
// - a devolução acontece SEMPRE que o botão fica sem dono, mesmo que o voo falhe.
//
// Guardas da entrada: sem voo com movimento reduzido, com um voo já ativo que não é nosso ou com o tour
// ativo (#tour-ponto). Nesses casos o símbolo já está no lugar e o botão fica escondido do mesmo jeito.
//
// Foco: ao fechar o "Fale com a Janete" aberto pelo símbolo da página, a casca foca o #janete-gatilho,
// que está escondido (o foco cairia no body). O observador nota a saída do painel e, 400 ms depois
// (a casca fecha em 360), devolve o foco ao botão do lugar quando o foco está no body. Fica anotado o
// pedido de uma API no Layout para isto.

export const ATRIBUTO_FORA = "data-janete-fora";
export const ID_GATILHO = "janete-gatilho";
export const SELETOR_LUGAR = '[data-dash="janete"]';

function gatilho(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.getElementById(ID_GATILHO);
}

function esconderGatilho(el: HTMLElement) {
  el.style.visibility = "hidden";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute(ATRIBUTO_FORA, "");
}

function devolverGatilho() {
  const el = gatilho();
  if (!el) return;
  el.style.visibility = "";
  el.removeAttribute("aria-hidden");
  el.removeAttribute(ATRIBUTO_FORA);
}

function lugar(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.querySelector<HTMLElement>(SELETOR_LUGAR);
}

/** O botão do lugar (o invólucro medido fica dentro dele). */
function botaoDoLugar(): HTMLElement | null {
  const l = lugar();
  return l?.closest<HTMLElement>("button") ?? l;
}

/** O retângulo cruza a janela (e tem tamanho): a pessoa vê esse símbolo agora. */
function naTela(el: Element): boolean {
  if (typeof window === "undefined") return false;
  const r = el.getBoundingClientRect();
  const altura = window.innerHeight || document.documentElement.clientHeight;
  const largura = window.innerWidth || document.documentElement.clientWidth;
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < altura && r.right > 0 && r.left < largura;
}

/**
 * De onde o voo de volta parte: da Janete que a pessoa está vendo. Com a página rolada, é a do centro da
 * faixa das etapas (no palco, só depois que a faixa real assumiu: data-troca); senão, a do anel, se ela
 * estiver na tela. Nenhuma na tela: não há voo (o botão do canto só volta), em vez de o símbolo cruzar
 * a tela vindo de 2.000 px acima.
 */
function origemDaSaida(): Element | null {
  if (typeof document === "undefined") return null;
  const botaoFaixa = document.querySelector<HTMLElement>('[data-dash="indice"] [data-janete] button');
  if (botaoFaixa) {
    const palco = botaoFaixa.closest<HTMLElement>('[data-dash="palco"]');
    const assumiu = palco?.getAttribute("data-modo") !== "palco" || !!botaoFaixa.closest("[data-troca]");
    const simbolo = botaoFaixa.querySelector("[data-estado]") ?? botaoFaixa;
    if (assumiu && naTela(simbolo)) return simbolo;
  }
  const l = lugar();
  return l && naTela(l) ? l : null;
}

/* ---------- o estado do módulo (um lugar da Janete por página) ---------- */

/** Quantas instâncias do lugar estão montadas (o reforço do seletor no DOM). */
let montagens = 0;
/** A saída agendada: a montagem seguinte cancela. */
let saidaPendente: ReturnType<typeof setTimeout> | null = null;
/** A saída pousou o símbolo do voo no lugar (para a montagem seguinte soltar, se cancelar). */
let pousouNaSaida = false;
/** A entrada em curso: a saída redireciona, a remontagem adota. */
let entrada: { emVoo: boolean; cancelado: boolean } | null = null;
/** O `mostrar` da montagem corrente (a cadeia do voo chama o atual, não o da montagem que o começou). */
let mostrarAtual: ((comPouso: boolean) => void) | null = null;
/** O último "Fale com a Janete" foi aberto pelo símbolo da página. */
let abriuPeloLugar = false;
/** O botão que abriu o "Fale com a Janete" (o do anel ou o da faixa das etapas): o foco volta a ele. */
let voltarFocoPara: HTMLElement | null = null;

/**
 * Chamado por um símbolo da página (o do anel ou o do centro da faixa das etapas) antes de clicar no
 * #janete-gatilho: ao fechar o painel, o foco volta para o botão que abriu (sem ele, o do anel).
 */
export function marcarAberturaPeloLugar(botao?: HTMLElement | null) {
  abriuPeloLugar = true;
  voltarFocoPara = botao ?? null;
}

/** Abre o "Fale com a Janete" da casca a partir de um símbolo da página. */
export function abrirFaleComAJanete(botao?: HTMLElement | null) {
  marcarAberturaPeloLugar(botao);
  document.getElementById(ID_GATILHO)?.click();
}

/** Só para os testes: zera o estado do módulo entre casos. */
export function zerarEstadoDoVoo() {
  montagens = 0;
  if (saidaPendente) clearTimeout(saidaPendente);
  saidaPendente = null;
  pousouNaSaida = false;
  entrada = null;
  mostrarAtual = null;
  abriuPeloLugar = false;
  voltarFocoPara = null;
}

export interface EstadoDoVoo {
  /** O símbolo da página já pode aparecer (o voo terminou, ou não houve voo). */
  visivel: boolean;
  /** O símbolo acabou de pousar: o "assentar" (compressão curta e halo) roda uma vez. */
  pousou: boolean;
}

/**
 * Cuida do voo da Janete enquanto o Dashboard está montado. `reduzido` vem de quem monta (a mesma
 * decisão que desliga o palco), para a entrada e a saída concordarem.
 */
export function useVooDaJanete(estado: EstadoJanete, reduzido: boolean): EstadoDoVoo {
  const voo = useVooJanete();
  const vooRef = useRef(voo);
  vooRef.current = voo;
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const [visivel, setVisivel] = useState(false);
  const [pousou, setPousou] = useState(false);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    montagens += 1;
    const controle = vooRef.current;
    // o StrictMode, o roteador ou uma troca do `reduzido` remontou: a saída agendada não vale
    if (saidaPendente) {
      clearTimeout(saidaPendente);
      saidaPendente = null;
      if (pousouNaSaida) {
        pousouNaSaida = false;
        controle.soltar();
      }
    }

    const mostrar = (comPouso: boolean) => {
      setVisivel(true);
      if (comPouso) setPousou(true);
    };
    mostrarAtual = mostrar;

    let painelEstava = !!document.getElementById(ID_PAINEL);
    const vigia = new MutationObserver(() => {
      const g = gatilho();
      if (g && !g.hasAttribute(ATRIBUTO_FORA)) esconderGatilho(g);
      // o painel fechou: a casca foca o botão escondido; o foco volta ao símbolo da página
      const painelEsta = !!document.getElementById(ID_PAINEL);
      if (painelEstava && !painelEsta && abriuPeloLugar) {
        abriuPeloLugar = false;
        const quem = voltarFocoPara;
        voltarFocoPara = null;
        setTimeout(() => {
          if (!document.activeElement || document.activeElement === document.body) {
            const alvo = quem && quem.isConnected ? quem : botaoDoLugar();
            alvo?.focus({ preventScroll: true });
          }
        }, 400);
      }
      painelEstava = painelEsta;
    });

    const g = gatilho();
    if (g) esconderGatilho(g);
    vigia.observe(document.body, { childList: true, subtree: true });

    if (entrada?.emVoo && !entrada.cancelado) {
      // a remontagem adota o voo de entrada em curso: ele chama `mostrarAtual` no fim
    } else {
      const tourAtivo = !!document.getElementById("tour-ponto");
      const semVoo = reduzido || controle.ativo || tourAtivo;
      const origem = semVoo ? null : medirJanete(ID_GATILHO);
      if (!origem) {
        mostrar(false);
      } else {
        const e = { emVoo: true, cancelado: false };
        entrada = e;
        const terminar = () => {
          e.emVoo = false;
          if (entrada === e) entrada = null;
        };
        (async () => {
          controle.pousar(origem, estadoRef.current);
          const alvo = await rolarAteEMedir(lugar());
          if (e.cancelado) return;
          if (!alvo) {
            terminar();
            controle.soltar();
            mostrarAtual?.(false);
            return;
          }
          await controle.voar(alvo, { estado: estadoRef.current, duracaoMs: DURACAO_VOO_LONGO_MS });
          if (e.cancelado) return;
          terminar();
          mostrarAtual?.(true);
          controle.soltar();
        })().catch(() => {
          if (e.cancelado) return;
          terminar();
          controle.soltar();
          mostrarAtual?.(false);
        });
      }
    }

    return () => {
      montagens -= 1;
      vigia.disconnect();
      if (mostrarAtual === mostrar) mostrarAtual = null;
      const c = vooRef.current;
      // medido agora, com o nó ainda na tela (a limpeza de layout roda antes de o DOM sair), na Janete que
      // a pessoa está vendo (a da faixa, com a página rolada; nenhuma na tela, nenhum voo)
      const atual = medirJanete(origemDaSaida());
      const destino = medirJanete(ID_GATILHO);
      const nossaEntradaEmVoo = !!entrada?.emVoo && !entrada.cancelado;
      const semMovimento = reduzido || movimentoReduzido();
      // o pouso no mesmo commit: a Janete não pisca no lugar antes de voltar (a remontagem solta)
      if (!nossaEntradaEmVoo && !semMovimento && atual && destino && !c.ativo) {
        try {
          c.pousar(atual, estadoRef.current);
          pousouNaSaida = true;
        } catch {
          pousouNaSaida = false;
        }
      }
      saidaPendente = setTimeout(() => {
        saidaPendente = null;
        const pousado = pousouNaSaida;
        pousouNaSaida = false;
        const fim = () => {
          // outro lugar chegou enquanto a Janete voltava: quem chegou cuida do botão
          if (montagens > 0 || lugar()) {
            c.soltar();
            return;
          }
          devolverGatilho();
          c.soltar();
        };
        if (montagens > 0 || lugar()) {
          // outro lugar da Janete (uma remontagem, ou a volta ao Dashboard) já está na tela: não voa nem devolve o botão
          if (pousado) c.soltar();
          return;
        }
        if (nossaEntradaEmVoo && entrada) {
          // a entrada ainda estava em voo: o voo vira o voo de volta (parte de onde está)
          entrada.cancelado = true;
          entrada.emVoo = false;
          entrada = null;
          if (semMovimento || !destino) {
            devolverGatilho();
            c.soltar();
            return;
          }
          try {
            c.voar(destino, { estado: "acordada", duracaoMs: DURACAO_VOO_LONGO_MS }).then(fim, fim);
          } catch {
            fim();
          }
          return;
        }
        if (!pousado) {
          devolverGatilho();
          return;
        }
        try {
          c.voar(destino!, { estado: "acordada", duracaoMs: DURACAO_VOO_LONGO_MS }).then(fim, fim);
        } catch {
          fim();
        }
      }, 0);
    };
  }, [reduzido]);

  return { visivel, pousou };
}
