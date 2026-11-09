import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import {
  DURACAO_VOO_LONGO_MS,
  medirJanete,
  movimentoReduzido,
  useVooJanete,
  type PontoJanete,
} from "@/components/janete/VooJanete";

import { idTituloArea } from "../AreaVazia";

// A regra que esconde o botão do canto marcado (ver o fim do CSS) vem junto com este arquivo.
import "./Pilha.module.css";

// A entrada e a saída do Contexto (spec-contexto.md, "Contratos", e entrar/desmontar/sairDoContexto do
// Contexto 6).
//
// Entrada completa (a 1ª visita da sessão): o símbolo sai do botão do canto (#janete-gatilho) e voa até o
// centro do alvo (950 ms, a curva do VooJanete); a pilha aparece plana no mesmo lugar e o símbolo é solto;
// ela inclina, separa, as curvas se desenham ("ligando") e fica pronta, uns 3 s no total.
// Entrada curta (as outras): já separada, só as curvas se desenham, uns 600 ms, sem voo.
// Saída: ao desmontar, o símbolo é pousado no lugar da pilha, já pequeno, e volta ao canto em 300 ms,
// por cima da área nova, sem segurar nada.
//
// O botão do canto fica escondido enquanto a tela está montada, e SEMPRE volta (finally), mesmo se o voo
// falhar. Ele é escondido só por um atributo desta tela (data-ctx-escondido, com a regra no CSS): o
// estilo e o aria-hidden que outra tela pôs nele ficam como estão, e nada daqui os devolve. O Layout
// monta o botão de novo (ao abrir e fechar o "Fale com a Janete"): um MutationObserver marca o novo.
//
// Outra tela com a Janete (o Dashboard, que não passa pelo dono daqui): se ela já está na tela quando a
// saída corre, não voamos nem soltamos (o pouso dela substituiu o nosso); se a volta dela ainda está no
// ar quando o Contexto monta ou desmonta, não pousamos nem voamos por cima dela.
//
// StrictMode: a desmontagem de mentira (efeito, limpeza e efeito no mesmo commit) não dispara a saída:
// ela é agendada para depois do commit e cancelada se o mesmo componente montar de novo.

export type FaseEntrada = "casa" | "voo" | "plano" | "inclinada" | "separada" | "ligando" | "pronto";

/** A entrada completa, em ms depois do pouso (a pilha "plano"). */
export const TEMPOS_ENTRADA = { inclinada: 100, separada: 600, ligando: 1500, pronto: 2100 } as const;
/** A entrada curta, em ms depois de montar. */
export const TEMPOS_ENTRADA_CURTA = { ligando: 40, pronto: 600 } as const;
/** A saída inteira: do lugar da pilha até o canto. */
export const DURACAO_SAIDA_MS = 300;
/** Na saída, o símbolo já nasce com esta fração do diâmetro da pilha. */
const ESCALA_SAIDA = 0.45;

const ID_GATILHO = "janete-gatilho";
const MARCA = "data-ctx-escondido";
/** O h1 da área (idTituloArea("contexto"), com tabIndex -1): o foco cai nele se o do botão se perder. */
const ID_TITULO_CONTEXTO = idTituloArea("contexto");
/** Depois de o Layout recriar o botão: o `focar` dele espera 60 ms (e o painel fecha em 360 antes). */
export const ESPERA_FOCO_MS = 150;

// O Dashboard (dashboard/versoes/final/voo.ts) também pousa a Janete e esconde o botão, com outro
// atributo. Só leitura: os nomes ficam repetidos aqui, sem importar de lá.
const SELETOR_LUGAR_DASH = '[data-dash="janete"]';
const MARCA_DASH = "data-janete-fora";

/** Outra tela está com a Janete: montada (o lugar dela na tela) ou com a volta dela ainda em curso. */
function outraTelaComAJanete(): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector(SELETOR_LUGAR_DASH)) return true;
  return !!document.getElementById(ID_GATILHO)?.hasAttribute(MARCA_DASH);
}

/**
 * O deslocamento vertical que a vista da área ainda tem: ela entra com a animação `vista`
 * (AreaVazia.module.css, translateY de 8 px até 0), e quem mede logo ao montar (o destino do voo, a
 * altura do palco) precisa descontá-lo para mirar onde as coisas vão ficar.
 */
export function deslocamentoDaVista(el: Element | null | undefined): number {
  if (!el || typeof getComputedStyle !== "function" || typeof DOMMatrixReadOnly !== "function") return 0;
  const sec = el.closest('section[data-area="contexto"]');
  if (!sec) return 0;
  const t = getComputedStyle(sec).transform;
  if (!t || t === "none") return 0;
  try {
    const dy = new DOMMatrixReadOnly(t).m42;
    return Number.isFinite(dy) ? dy : 0;
  } catch {
    return 0;
  }
}

/* ---------- o botão do canto: escondido enquanto alguém do Contexto o pede ---------- */

let pedidos = 0;
let observador: MutationObserver | null = null;

/** Marca o botão do canto; devolve se marcou um que ainda não estava marcado. */
function marcarGatilho(): boolean {
  const g = document.getElementById(ID_GATILHO);
  if (!g || g.hasAttribute(MARCA)) return false;
  g.setAttribute(MARCA, "");
  return true;
}

/**
 * O Layout recriou o botão (o "Pular tour", o fechar do "Fale com a Janete") e vai focá-lo, mas ele está
 * escondido e o foco cai no body. Um pouco depois, se o foco estiver perdido, ele vai para o h1 da
 * área (ou para o 1º disco).
 */
function aoMudarODom() {
  if (!marcarGatilho()) return;
  setTimeout(() => {
    if (pedidos === 0) return;
    const ativo = document.activeElement;
    const perdido = !ativo || ativo === document.body || ativo.id === ID_GATILHO;
    if (!perdido) return;
    const destino =
      document.getElementById(ID_TITULO_CONTEXTO) ?? document.querySelector<HTMLElement>("[data-camada]");
    destino?.focus({ preventScroll: true });
  }, ESPERA_FOCO_MS);
}

/** Esconde o botão do canto (e os que o Layout montar depois). Devolve quem o libera (idempotente). */
function esconderGatilho(): () => void {
  if (typeof document === "undefined") return () => {};
  pedidos += 1;
  marcarGatilho();
  if (!observador && typeof MutationObserver === "function") {
    observador = new MutationObserver(aoMudarODom);
    observador.observe(document.body, { childList: true, subtree: true });
  }
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    pedidos = Math.max(0, pedidos - 1);
    if (pedidos > 0) return;
    observador?.disconnect();
    observador = null;
    // só o que esta tela marcou: sem a marca, o botão volta a ser o que era
    document.querySelectorAll(`[${MARCA}]`).forEach((el) => el.removeAttribute(MARCA));
  };
}

/* ---------- quem está com o símbolo em voo ---------- */

// O provedor do voo tem um símbolo só: quem o pousou por último é o dono, e só o dono o solta.
let dono = 0;
let proximoDono = 0;

function tomarSimbolo(): number {
  proximoDono += 1;
  dono = proximoDono;
  return dono;
}

/* ---------- o gancho ---------- */

interface Instancia {
  vivo: boolean;
  geracao: number;
  fase: FaseEntrada;
  /** O símbolo pousado ou em voo por esta tela (0: nenhum). */
  token: number;
  timers: Set<ReturnType<typeof setTimeout>>;
  /** A saída agendada pela limpeza; a remontagem do StrictMode a cancela. */
  saida: ReturnType<typeof setTimeout> | null;
  /** A limpeza pousou o símbolo para a saída; a remontagem do StrictMode o solta. */
  pousouNaSaida: boolean;
  liberar: (() => void) | null;
}

export interface OpcoesEntrada {
  /** O lugar da pilha (o #ctx-pilha): o voo mira no centro dele. */
  alvo: RefObject<HTMLElement | null>;
  /** A 1ª visita da sessão: entrada completa, com o voo. */
  primeiraVez: boolean;
}

export function useEntradaESaida({ alvo, primeiraVez }: OpcoesEntrada): { fase: FaseEntrada } {
  const voo = useVooJanete();
  const vooRef = useRef(voo);
  vooRef.current = voo;
  const primeira = useRef(primeiraVez);
  const [fase, setFase] = useState<FaseEntrada>(primeiraVez ? "casa" : "separada");
  const inst = useRef<Instancia>({
    vivo: false,
    geracao: 0,
    fase: primeiraVez ? "casa" : "separada",
    token: 0,
    timers: new Set(),
    saida: null,
    pousouNaSaida: false,
    liberar: null,
  });

  useLayoutEffect(() => {
    const i = inst.current;
    i.vivo = true;
    i.geracao += 1;
    const geracao = i.geracao;
    const vivo = () => i.vivo && i.geracao === geracao;

    // remontagem do StrictMode: a saída agendada não acontece, e o símbolo pousado para ela sai
    if (i.saida !== null) {
      clearTimeout(i.saida);
      i.saida = null;
      if (i.pousouNaSaida && dono === i.token) vooRef.current.soltar();
      i.pousouNaSaida = false;
      i.token = 0;
    }
    if (!i.liberar) i.liberar = esconderGatilho();

    const mudar = (f: FaseEntrada) => {
      if (!vivo()) return;
      i.fase = f;
      setFase(f);
    };
    const depois = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        i.timers.delete(t);
        if (vivo()) fn();
      }, ms);
      i.timers.add(t);
    };
    const soltarSeFor = (token: number) => {
      if (token !== 0 && dono === token) vooRef.current.soltar();
      if (i.token === token) i.token = 0;
    };
    // pousou: a pilha plana assume o lugar e se desmonta
    const desmontar = () => {
      mudar("plano");
      depois(() => mudar("inclinada"), TEMPOS_ENTRADA.inclinada);
      depois(() => mudar("separada"), TEMPOS_ENTRADA.separada);
      depois(() => mudar("ligando"), TEMPOS_ENTRADA.ligando);
      depois(() => mudar("pronto"), TEMPOS_ENTRADA.pronto);
    };

    if (movimentoReduzido()) {
      mudar("pronto");
    } else if (!primeira.current) {
      mudar("separada");
      depois(() => mudar("ligando"), TEMPOS_ENTRADA_CURTA.ligando);
      depois(() => mudar("pronto"), TEMPOS_ENTRADA_CURTA.pronto);
    } else {
      const v = vooRef.current;
      const gatilho = document.getElementById(ID_GATILHO);
      // outro símbolo ainda em voo (a volta de outra tela, como a do Dashboard, que pousou na limpeza
      // dela e ainda não aparece em `v.ativo`) ou sem quadros: sem voo, só a desmontagem
      const podeVoar = !v.ativo && typeof requestAnimationFrame === "function" && !outraTelaComAJanete();
      const origem = podeVoar && gatilho ? medirJanete(gatilho) : null;
      if (!origem) {
        desmontar();
      } else {
        mudar("casa");
        const token = tomarSimbolo();
        i.token = token;
        // o símbolo aparece no lugar do botão, que some no mesmo quadro
        v.pousar(origem, "acordada");
        requestAnimationFrame(() => {
          if (!vivo()) return;
          void (async () => {
            try {
              // no 1º quadro, a vista ainda está uns 8 px abaixo (a animação de entrada): mira no lugar final
              const medido = medirJanete(alvo.current);
              const destino = medido ? { ...medido, y: medido.y - deslocamentoDaVista(alvo.current) } : null;
              if (!destino) {
                soltarSeFor(token);
                desmontar();
                return;
              }
              mudar("voo");
              await vooRef.current.voar(destino, { estado: "acordada", duracaoMs: DURACAO_VOO_LONGO_MS });
              if (!vivo()) return;
              // a pilha plana e o símbolo solto no mesmo commit (as duas mudanças vão no mesmo lote)
              desmontar();
              soltarSeFor(token);
            } catch {
              if (!vivo()) return;
              soltarSeFor(token);
              mudar("pronto");
            }
          })();
        });
      }
    }

    return () => {
      i.vivo = false;
      i.timers.forEach(clearTimeout);
      i.timers.clear();

      // mede agora: na limpeza de layout o DOM ainda está no lugar
      const naSaida = i.fase;
      const meu = i.token !== 0 && dono === i.token;
      const animar = !movimentoReduzido() && typeof requestAnimationFrame === "function";
      const gatilho = document.getElementById(ID_GATILHO);
      const casa = gatilho ? medirJanete(gatilho) : null;
      // ainda no voo de entrada: o símbolo só muda de rumo e volta para o canto
      const mudarRumo = animar && meu && naSaida === "voo";
      let de: PontoJanete | null = null;
      // a volta de outra tela ainda no ar: o símbolo é dela, e pousar aqui o tomaria
      if (animar && casa && naSaida !== "casa" && naSaida !== "voo" && !outraTelaComAJanete()) {
        const p = medirJanete(alvo.current);
        if (p && p.tamanho > 4) de = { x: p.x, y: p.y, tamanho: p.tamanho * ESCALA_SAIDA };
      }
      if (de) {
        i.token = tomarSimbolo();
        vooRef.current.pousar(de, "acordada");
        i.pousouNaSaida = true;
      }
      const token = i.token;
      const comSimbolo = token !== 0 && (de !== null || meu);
      const voa = de !== null || mudarRumo;

      i.saida = setTimeout(() => {
        i.saida = null;
        i.pousouNaSaida = false;
        const liberar = i.liberar;
        i.liberar = null;
        i.token = 0;
        i.fase = primeira.current ? "casa" : "separada";
        // a tela nova (o Dashboard) já assumiu a Janete: o pouso dela substituiu o nosso (o provedor tem
        // um símbolo só). Nada de voar nem soltar; só o nosso pedido de esconder o botão sai.
        if (outraTelaComAJanete()) {
          liberar?.();
          return;
        }
        void (async () => {
          const v = vooRef.current;
          try {
            const destino = voa ? medirJanete(document.getElementById(ID_GATILHO)) : null;
            if (destino) await v.voar(destino, { estado: "acordada", duracaoMs: DURACAO_SAIDA_MS });
          } catch {
            // nada: o botão volta de qualquer jeito, logo abaixo
          } finally {
            liberar?.();
            if (comSimbolo && dono === token) v.soltar();
          }
        })();
      }, 0);
    };
    // Só na montagem: o voo, o alvo e a 1ª vez são lidos por ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { fase };
}
