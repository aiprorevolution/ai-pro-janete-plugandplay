// Números, dinheiro, porcentagem e tempo em pt-BR (docs/spec-dashboard.md, seção 12), para as 4
// versões escreverem igual: milhar com ponto (2.268), decimal com vírgula, "US$ 47,39", "84%" e
// "2,4%", "42 s", "1 min 5 s", "3 h", "2 dias". Sem espaço inseparável: os espaços são comuns.

import type { Tendencia } from "./tipos";

const inteiroBR = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasaBR = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const duasCasasBR = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2.268". Arredonda para o inteiro. */
export function numero(n: number): string {
  return inteiroBR.format(Math.round(n));
}

/** "1,5" (sempre uma casa). */
export function numeroUmaCasa(n: number): string {
  return umaCasaBR.format(n);
}

/**
 * "US$ 47,39". Com `casas: 0`, "US$ 51" (para a previsão do mês e números grandes). Abaixo de
 * 1 centavo e acima de zero, "menos de US$ 0,01".
 */
export function dinheiro(usd: number, opcoes: { casas?: 0 | 2 } = {}): string {
  const casas = opcoes.casas ?? 2;
  if (casas === 2 && usd > 0 && usd < 0.005) return "menos de US$ 0,01";
  return `US$ ${casas === 0 ? inteiroBR.format(Math.round(usd)) : duasCasasBR.format(usd)}`;
}

/** "84%" (10% ou mais, sem casa), "2,4%" (abaixo de 10%, com uma; "7%" quando a casa é zero), "0%". */
export function porcentagem(pct: number): string {
  if (pct === 0) return "0%";
  const abs = Math.abs(pct);
  if (abs >= 9.95) return `${inteiroBR.format(Math.round(pct))}%`;
  const umaCasa = Math.round(pct * 10) / 10;
  return Number.isInteger(umaCasa) ? `${inteiroBR.format(umaCasa)}%` : `${umaCasaBR.format(umaCasa)}%`;
}

/** A variação com sinal: "+7%", "−12%" (sinal de menos de verdade), "0%". `null` vira "". */
export function variacao(pct: number | null): string {
  if (pct === null) return "";
  if (Math.abs(pct) < 0.05) return "0%";
  const sinal = pct > 0 ? "+" : "−";
  return `${sinal}${porcentagem(Math.abs(pct))}`;
}

/** A variação em pontos percentuais, para porcentagens: "+1 ponto", "+1,5 ponto", "−2,5 pontos", "0 ponto"; `null` vira "". */
export function variacaoPontos(pp: number | null): string {
  if (pp === null) return "";
  const v = Math.round(pp * 10) / 10;
  if (v === 0) return "0 ponto";
  const abs = Math.abs(v);
  const txt = Number.isInteger(abs) ? inteiroBR.format(abs) : umaCasaBR.format(abs);
  return `${v > 0 ? "+" : "−"}${txt} ${abs < 2 ? "ponto" : "pontos"}`;
}

/**
 * A variação que a tela mostra para qualquer tendência: em pontos quando ela traz `variacaoPp` (as
 * porcentagens, como a autonomia), senão a relativa ("+7%"). As versões mostram toda variação por
 * aqui, para a definição mudar num lugar só.
 */
export function variacaoDe(t: Tendencia & { variacaoPp?: number | null }): string {
  return t.variacaoPp !== undefined ? variacaoPontos(t.variacaoPp) : variacao(t.variacaoPct);
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** Duração curta: "42 s", "1 min 5 s", "12 min", "3 h", "3 h 20 min", "2 dias". */
export function duracaoCurta(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const resto = s % 60;
    return m < 10 && resto ? `${m} min ${resto} s` : `${m} min`;
  }
  if (s < 86_400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h < 10 && m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.round(s / 86_400);
  return `${d} ${plural(d, "dia", "dias")}`;
}

/** O tempo na etapa, a partir de horas: "18 min", "9 h", "2 dias". */
export function tempoEtapa(horas: number): string {
  return duracaoCurta(horas * 3600);
}

/** Dias com uma casa quando é pouco ("1,5 dia"), inteiro quando passa de 10 ("12 dias"). */
export function dias(n: number): string {
  if (n < 10 && Math.round(n) !== n) return `${umaCasaBR.format(n)} ${n < 2 ? "dia" : "dias"}`;
  const i = Math.round(n);
  return `${inteiroBR.format(i)} ${plural(i, "dia", "dias")}`;
}

/** "há 40 s", "há 12 min", "há 3 h", "há 2 dias"; abaixo de 5 s, "agora". */
export function haQuanto(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 5) return "agora";
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86_400);
  return `há ${d} ${plural(d, "dia", "dias")}`;
}

/** "1 conversa" / "3 conversas" (com o número em pt-BR). */
export function contagem(n: number, um: string, varios: string): string {
  return `${numero(n)} ${plural(n, um, varios)}`;
}
