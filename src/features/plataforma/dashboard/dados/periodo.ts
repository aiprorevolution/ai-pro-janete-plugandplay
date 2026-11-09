import { dataCurta, diaLocal, type Instante } from "../../comum/tempo";
import type { IdPeriodo, Periodo } from "./tipos";

// Os períodos do Dashboard, no fuso de São Paulo. Os dias são "AAAA-MM-DD" (o dia civil de lá) e a
// conta de dias é de calendário (Date.UTC sobre ano, mês e dia), sem `toISOString()` para dia local
// e sem depender do fuso da máquina.
//
// São Paulo está em UTC−3 o ano inteiro desde 2019 (o horário de verão acabou). Por isso o instante
// de um horário de lá é o mesmo horário em UTC mais 3 horas (`instanteSP`).

const DIA_MS = 86_400_000;
const FUSO_SP_H = 3;
/** "Até 1 ano" no personalizado. */
export const MAX_DIAS_PERSONALIZADO = 366;

const DIAS_DO_ID: Record<Exclude<IdPeriodo, "personalizado">, number> = { hoje: 1, "7d": 7, "30d": 30, "90d": 90 };

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** O dia é "AAAA-MM-DD" e existe no calendário (nada de 2026-02-30). */
export function diaValido(dia: string): boolean {
  const m = RE_DIA.exec(dia);
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(a, me - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === me - 1 && t.getUTCDate() === d;
}

function partesDia(dia: string): [number, number, number] {
  const m = RE_DIA.exec(dia);
  if (!m) throw new Error(`Dia inválido: ${dia}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const dois = (n: number) => String(n).padStart(2, "0");

/** O dia `n` dias depois (ou antes, com `n` negativo), em calendário. */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = partesDia(dia);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`;
}

/** Quantos dias de calendário vão de `de` até `ate` (0 no mesmo dia). */
export function diasEntreDias(de: string, ate: string): number {
  const [a1, m1, d1] = partesDia(de);
  const [a2, m2, d2] = partesDia(ate);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / DIA_MS);
}

/** O número do dia (dias desde 1970) de um dia civil: serve de semente e de eixo. */
export function numeroDoDia(dia: string): number {
  const [a, m, d] = partesDia(dia);
  return Math.round(Date.UTC(a, m - 1, d) / DIA_MS);
}

/** O dia da semana (0 = domingo) de um dia civil. */
export function diaDaSemana(dia: string): number {
  const [a, m, d] = partesDia(dia);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** O instante (ms) de um horário de São Paulo. Segundos e milissegundos opcionais. */
export function instanteSP(dia: string, hora = 0, minuto = 0, segundo = 0): number {
  const [a, m, d] = partesDia(dia);
  return Date.UTC(a, m - 1, d, hora + FUSO_SP_H, minuto, segundo);
}

/** O começo (00:00 de São Paulo) do dia, em ms. */
export function inicioDoDia(dia: string): number {
  return instanteSP(dia, 0, 0, 0);
}

/** Os dias de `inicio` a `fim`, inclusive, em ordem. */
export function diasDoIntervalo(inicio: string, fim: string): string[] {
  const n = diasEntreDias(inicio, fim);
  const lista: string[] = [];
  for (let i = 0; i <= n; i += 1) lista.push(somarDias(inicio, i));
  return lista;
}

/** Os dias do mês do dia (28 a 31). */
export function diasDoMes(dia: string): number {
  const [a, m] = partesDia(dia);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** O 1º dia do mês do dia. */
export function primeiroDoMes(dia: string): string {
  const [a, m] = partesDia(dia);
  return `${a}-${dois(m)}-01`;
}

/**
 * A janela de instantes de um período: de 00:00 do início até o fim do último dia, sem passar de
 * `agora`. A do anterior é a mesma janela deslocada `dias` para trás (mesmo tamanho: "hoje até as
 * 14:45" se compara com "ontem até as 14:45").
 */
export interface Janela {
  de: number;
  /** Exclusivo. */
  ate: number;
}

export function janelasDoPeriodo(periodo: Periodo, agora: Instante): { atual: Janela; anterior: Janela } {
  const agoraMs = paraMs(agora);
  const de = inicioDoDia(periodo.inicio);
  const ate = Math.min(inicioDoDia(somarDias(periodo.fim, 1)), agoraMs + 1);
  const desloca = periodo.dias * DIA_MS;
  return { atual: { de, ate }, anterior: { de: de - desloca, ate: ate - desloca } };
}

function paraMs(x: Instante): number {
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  return Date.parse(x);
}

function rotuloDias(n: number): string {
  return n === 1 ? "o dia anterior" : `os ${n} dias anteriores`;
}

export type ResultadoPeriodo = { ok: true; periodo: Periodo } | { ok: false; erro: "datas_invalidas" };

/**
 * Monta o período a partir de `agora` (o "hoje" é o dia de São Paulo). Hoje, 7, 30 e 90 dias
 * contam hoje. O personalizado exige as duas datas válidas, o início até o fim, o fim até hoje e no
 * máximo 1 ano (366 dias); senão `datas_invalidas`.
 */
export function montarPeriodo(
  id: IdPeriodo,
  agora: Instante,
  personalizado?: { inicio: string; fim: string } | undefined,
): ResultadoPeriodo {
  const hoje = diaLocal(agora);
  if (!hoje) return { ok: false, erro: "datas_invalidas" };

  if (id !== "personalizado") {
    const dias = DIAS_DO_ID[id];
    const inicio = somarDias(hoje, -(dias - 1));
    const rotulo = id === "hoje" ? "hoje" : `nos últimos ${dias} dias`;
    const rotuloComparacao = id === "hoje" ? "comparado com ontem até esta hora" : `comparado com ${rotuloDias(dias)}`;
    return {
      ok: true,
      periodo: {
        id,
        inicio,
        fim: hoje,
        dias,
        rotulo,
        rotuloComparacao,
        anterior: { inicio: somarDias(inicio, -dias), fim: somarDias(hoje, -dias) },
      },
    };
  }

  if (!personalizado) return { ok: false, erro: "datas_invalidas" };
  const { inicio, fim } = personalizado;
  if (!diaValido(inicio) || !diaValido(fim)) return { ok: false, erro: "datas_invalidas" };
  if (diasEntreDias(inicio, fim) < 0) return { ok: false, erro: "datas_invalidas" };
  if (diasEntreDias(fim, hoje) < 0) return { ok: false, erro: "datas_invalidas" };
  const dias = diasEntreDias(inicio, fim) + 1;
  if (dias > MAX_DIAS_PERSONALIZADO) return { ok: false, erro: "datas_invalidas" };

  const anoHoje = hoje.slice(0, 4);
  const curta = (d: string) => dataCurta(inicioDoDia(d) + 12 * 3_600_000, d.slice(0, 4) !== anoHoje);
  const rotulo = inicio === fim ? `em ${curta(inicio)}` : `de ${curta(inicio)} a ${curta(fim)}`;
  return {
    ok: true,
    periodo: {
      id,
      inicio,
      fim,
      dias,
      rotulo,
      rotuloComparacao: `comparado com ${rotuloDias(dias)}`,
      anterior: { inicio: somarDias(inicio, -dias), fim: somarDias(fim, -dias) },
    },
  };
}
