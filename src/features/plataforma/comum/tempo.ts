/*
 * Datas e horas das telas da plataforma, sempre no fuso de São Paulo.
 *
 * O banco guarda `timestamptz` (ISO em UTC). O dia que a pessoa vê é o de São Paulo: uma mensagem
 * das 23:30 de lá é "hoje" para ela, mesmo já sendo o dia seguinte em UTC. Por isso nada aqui usa
 * `toISOString()` nem `getDate()`/`getHours()` (que seguem o fuso da máquina): o dia e a hora saem
 * do `Intl.DateTimeFormat` com `timeZone` fixo.
 */

export const FUSO = "America/Sao_Paulo";

/** O que as funções aceitam: o ISO do banco, um `Date` ou milissegundos. */
export type Instante = string | number | Date;

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] as const;
const SEMANA_CURTA = ["Dom.", "Seg.", "Ter.", "Qua.", "Qui.", "Sex.", "Sáb."] as const;
const SEMANA_ROTULO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

const DIA_MS = 86_400_000;

/* Um formatador só, criado uma vez: `formatToParts` devolve as partes já no fuso de São Paulo.
   `hourCycle: "h23"` evita o "24:05" que alguns motores devolvem à meia-noite com `hour12: false`. */
const formatador = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type Partes = { ano: number; mes: number; dia: number; hora: number; minuto: number };

function paraMs(x: Instante): number {
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  return Date.parse(x);
}

/** As partes do instante no relógio de São Paulo; `null` se o valor não for uma data. */
function partes(x: Instante): Partes | null {
  const ms = paraMs(x);
  if (!Number.isFinite(ms)) return null;
  const p: Record<string, number> = {};
  for (const parte of formatador.formatToParts(ms)) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  return {
    ano: p["year"] ?? 0,
    mes: p["month"] ?? 0,
    dia: p["day"] ?? 0,
    hora: (p["hour"] ?? 0) % 24,
    minuto: p["minute"] ?? 0,
  };
}

/* O dia civil de São Paulo como número de dias desde 1970: subtrair dois dá a distância em dias de
   calendário (ontem = 1), sem depender de horário de verão nem do fuso da máquina. */
function numeroDoDia(p: Partes): number {
  return Math.round(Date.UTC(p.ano, p.mes - 1, p.dia) / DIA_MS);
}

function diaDaSemana(p: Partes): number {
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay();
}

const dois = (n: number) => String(n).padStart(2, "0");

/** "2026-10-30": o dia em São Paulo, para agrupar e comparar. "" se o valor não for data. */
export function diaLocal(x: Instante): string {
  const p = partes(x);
  return p ? `${p.ano}-${dois(p.mes)}-${dois(p.dia)}` : "";
}

/** Os dois instantes caem no mesmo dia de São Paulo. */
export function mesmoDia(a: Instante, b: Instante): boolean {
  const da = diaLocal(a);
  return da !== "" && da === diaLocal(b);
}

/**
 * Quantos dias de calendário (em São Paulo) vão de `de` até `ate`: 0 no mesmo dia, 1 de ontem
 * para hoje (mesmo que tenham passado só 5 minutos, de 23:58 a 00:03). `NaN` se algum não for data.
 */
export function diasEntre(de: Instante, ate: Instante): number {
  const a = partes(de);
  const b = partes(ate);
  if (!a || !b) return Number.NaN;
  return numeroDoDia(b) - numeroDoDia(a);
}

/** "14:32". */
export function horaCurta(iso: Instante): string {
  const p = partes(iso);
  return p ? `${dois(p.hora)}:${dois(p.minuto)}` : "";
}

/** "26/10", ou "26/10/2025" com `comAno`. */
export function dataCurta(iso: Instante, comAno = false): string {
  const p = partes(iso);
  if (!p) return "";
  return comAno ? `${dois(p.dia)}/${dois(p.mes)}/${p.ano}` : `${dois(p.dia)}/${dois(p.mes)}`;
}

/** "segunda-feira, 26 de outubro de 2026". */
export function dataLonga(iso: Instante): string {
  const p = partes(iso);
  if (!p) return "";
  return `${SEMANA[diaDaSemana(p)]}, ${p.dia} de ${MESES[p.mes - 1]} de ${p.ano}`;
}

/**
 * O separador de dia nas mensagens: "Hoje", "Ontem" ou "Segunda, 26/10" (com o ano, "/2025",
 * quando não é o ano de `agora`).
 */
export function rotuloDia(iso: Instante, agora: Instante): string {
  const p = partes(iso);
  const a = partes(agora);
  if (!p || !a) return "";
  const dias = numeroDoDia(a) - numeroDoDia(p);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  return `${SEMANA_ROTULO[diaDaSemana(p)]}, ${dataCurta(iso, p.ano !== a.ano)}`;
}

/**
 * A hora da lista de conversas: "14:32" hoje, "Ontem", o dia da semana ("Seg.") até 6 dias atrás
 * e "26/10" (ou "26/10/2025" em outro ano) antes disso.
 */
export function horaLista(iso: Instante, agora: Instante): string {
  const p = partes(iso);
  const a = partes(agora);
  if (!p || !a) return "";
  const dias = numeroDoDia(a) - numeroDoDia(p);
  if (dias <= 0) return horaCurta(iso);
  if (dias === 1) return "Ontem";
  if (dias < 7) return SEMANA_CURTA[diaDaSemana(p)]!;
  return dataCurta(iso, p.ano !== a.ano);
}

/**
 * "agora", "há 5 min", "há 3 h" (no mesmo dia), "ontem", "há 4 dias" (até 6) e, depois, a data
 * curta ("26/10"). A virada de dia segue o calendário de São Paulo: 23:50 visto às 00:10 é "ontem".
 */
export function tempoRelativo(iso: Instante, agora: Instante): string {
  const ms = paraMs(iso);
  const agoraMs = paraMs(agora);
  if (!Number.isFinite(ms) || !Number.isFinite(agoraMs)) return "";
  const seg = Math.floor((agoraMs - ms) / 1000);
  if (seg < 60) return "agora";
  const dias = diasEntre(ms, agoraMs);
  if (dias <= 0) {
    const min = Math.floor(seg / 60);
    return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h`;
  }
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  const p = partes(ms);
  const a = partes(agoraMs);
  return dataCurta(ms, !!p && !!a && p.ano !== a.ano);
}

/** Duração de áudio ou vídeo: "0:09", "1:05", "12:40". */
export function duracao(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${dois(s % 60)}`;
}

/** Tempo esperando alguém, curto, para a linha da lista: "45 s", "12 min", "1 h 05". */
export function esperaCompacta(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${dois(m % 60)}`;
}

/** O mesmo tempo por extenso, para leitor de tela e cabeçalho: "menos de 1 min", "1 h 5 min". */
export function esperaLonga(segundos: number): string {
  const m = Math.floor(Math.max(0, segundos) / 60);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Segundos de `desde` até `agora` (0 se faltar algum ou se `desde` estiver no futuro). */
export function segundosDesde(desde: Instante | null | undefined, agora: Instante): number {
  if (desde == null) return 0;
  const d = paraMs(desde);
  const a = paraMs(agora);
  if (!Number.isFinite(d) || !Number.isFinite(a)) return 0;
  return Math.max(0, Math.floor((a - d) / 1000));
}
