import { useMemo, useSyncExternalStore } from "react";

// Apoios da versão final (vindos da B, com o que os capítulos da A usavam): ids, a busca do
// ancestral que rola, o movimento reduzido e o desenho do número com a unidade menor. Nada aqui
// calcula número de negócio: só lê e formata o que a fundação já entregou.

/** O capítulo "Para onde foram os que saíram" (o `data-etapa` dele). */
export const ETAPA_SAIRAM = "sairam";

/** O id da <section> do capítulo (o alvo da rolagem pelo índice). */
export const idCapitulo = (etapa: string) => `dvf-cap-${etapa}`;
/** O id do título (h2) do capítulo (o foco vai para ele). */
export const idTituloCapitulo = (etapa: string) => `dvf-cap-${etapa}-titulo`;

/** "01/10" a partir de "2026-10-01" (o dia já vem no fuso de São Paulo; aqui só se reescreve o texto). */
export function diaCurto(dia: string): string {
  return dia.length >= 10 ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : dia;
}

/** "13 perdidos" / "1 perdido" (o número já vem pronto; aqui só a concordância). */
export function plural(n: number, um: string, varios: string, formatar: (n: number) => string): string {
  return `${formatar(n)} ${n === 1 ? um : varios}`;
}

/** O ancestral mais próximo que rola na vertical (o .platMain no computador); senão, a janela. */
export function acharRolador(el: Element | null): HTMLElement | Window {
  let atual = el?.parentElement ?? null;
  while (atual && atual !== document.body && atual !== document.documentElement) {
    const estilo = window.getComputedStyle(atual);
    if (/(auto|scroll|overlay)/.test(estilo.overflowY)) return atual;
    atual = atual.parentElement;
  }
  return window;
}

/** A posição de rolagem e a altura visível do rolador. */
export function lerRolador(rolador: HTMLElement | Window): { topo: number; altura: number; rolado: number } {
  // a janela não tem getBoundingClientRect (o teste não depende de `instanceof Window`, que muda de reino)
  if (typeof (rolador as HTMLElement).getBoundingClientRect !== "function") {
    return { topo: 0, altura: window.innerHeight, rolado: window.scrollY };
  }
  rolador = rolador as HTMLElement;
  const r = rolador.getBoundingClientRect();
  return { topo: r.top, altura: rolador.clientHeight, rolado: rolador.scrollTop };
}

/** Rola o rolador até `topo` (px do conteúdo). */
export function rolarPara(rolador: HTMLElement | Window, topo: number, suave: boolean) {
  const comportamento: ScrollBehavior = suave ? "smooth" : "auto";
  if (typeof rolador.scrollTo === "function") rolador.scrollTo({ top: topo, behavior: comportamento });
}

const CONSULTA_REDUZIDO = "(prefers-reduced-motion: reduce)";

function listaReduzido(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(CONSULTA_REDUZIDO) : null;
  } catch {
    return null;
  }
}

function assinarReduzido(avisar: () => void): () => void {
  const mq = listaReduzido();
  if (!mq) return () => {};
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", avisar);
    return () => mq.removeEventListener("change", avisar);
  }
  mq.addListener(avisar);
  return () => mq.removeListener(avisar);
}

/** O sistema pede menos movimento (acompanha a mudança). */
export function useMovimentoReduzido(): boolean {
  return useSyncExternalStore(
    assinarReduzido,
    () => !!listaReduzido()?.matches,
    () => false,
  );
}

/** O ambiente tem o que o palco precisa (no jsdom e em navegador antigo, não: o funil fica aberto). */
export function ambienteDoPalco(): boolean {
  return typeof window !== "undefined" && typeof window.IntersectionObserver === "function" && typeof requestAnimationFrame === "function";
}

const nada = () => () => {};

/**
 * O palco só existe no navegador de verdade. Fora dele (servidor, jsdom) o funil fica aberto. A 1ª
 * pintura depois da hidratação usa o valor do servidor (sem palco) e troca logo em seguida.
 */
export function useAmbienteDoPalco(): boolean {
  return useSyncExternalStore(nada, ambienteDoPalco, () => false);
}

function assinarConsulta(consulta: string) {
  return (avisar: () => void): (() => void) => {
    let mq: MediaQueryList | null = null;
    try {
      mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(consulta) : null;
    } catch {
      mq = null;
    }
    if (!mq) return () => {};
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", avisar);
      const lista = mq;
      return () => lista.removeEventListener("change", avisar);
    }
    mq.addListener(avisar);
    const lista = mq;
    return () => lista.removeListener(avisar);
  };
}

function casaConsulta(consulta: string): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(consulta).matches;
  } catch {
    return false;
  }
}

/**
 * A largura da janela é de pelo menos `px` (acompanha a mudança). No jsdom o matchMedia de teste diz
 * sempre "não": vale `seNaoSouber`, para os testes verem o layout do computador.
 */
export function useLarguraMinima(px: number, seNaoSouber: boolean): boolean {
  const consulta = `(min-width: ${px}px)`;
  const assinar = useMemo(() => assinarConsulta(consulta), [consulta]);
  return useSyncExternalStore(
    assinar,
    () => (ambienteDoPalco() ? casaConsulta(consulta) : seNaoSouber),
    () => seNaoSouber,
  );
}

/**
 * A partir desta largura de janela o funil tem palco (o iPad deitado, de 1180 px, já tem). Perto do
 * mínimo, o nome mais longo pode sair com reticências no chip do índice (o nome inteiro está no nome
 * acessível do link). Abaixo, o funil fica aberto (sem a transição).
 */
export const LARGURA_DO_PALCO = 1180;

/**
 * Um texto já formatado em partes de número e de unidade ("US$ 37,46" → "US$ " + "37,46"; "1 min 5 s"
 * → "1" + " min " + "5" + " s"), para a unidade sair menor e mais leve que o número.
 */
export function partesDoNumero(texto: string): { texto: string; numero: boolean }[] {
  const partes: { texto: string; numero: boolean }[] = [];
  const re = /\d+(?:[.,]\d+)*/g;
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > ultimo) partes.push({ texto: texto.slice(ultimo, i), numero: false });
    partes.push({ texto: m[0], numero: true });
    ultimo = i + m[0].length;
  }
  if (ultimo < texto.length) partes.push({ texto: texto.slice(ultimo), numero: false });
  return partes;
}


/** Uma proporção visual (0 a 1) para desenhar barras: `valor ÷ maior`. Não aparece como número na tela. */
export function proporcao(valor: number, maior: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(maior) || maior <= 0) return 0;
  return Math.min(1, Math.max(0, valor / maior));
}
