import { diaLocal } from "../../comum/tempo";
import { IDS } from "../../exemplo/dados";
import type { MotivoHumano } from "../../exemplo/tipos";
import { diaDaSemana, diasDoIntervalo, inicioDoDia, instanteSP, numeroDoDia, somarDias, type Janela } from "./periodo";

// O histórico de exemplo do Dashboard (docs/spec-dashboard.md, seção 15): leads sintéticos, dia a
// dia, com o caminho no funil, as mensagens, os tempos de resposta, as passagens para a equipe, as
// falhas e o custo de IA. Nada aqui vale como número de negócio: é exemplo.
//
// Determinismo: cada dia tem a sua semente (FNV-1a do dia) e cada lead a dele (dia + índice), com o
// PRNG mulberry32. O caminho inteiro de um lead sai só da semente; o "agora" (sempre recebido por
// parâmetro, nunca Date.now() aqui dentro) só corta o que ainda não aconteceu. Por isso o mesmo dia
// gera sempre os mesmos leads, e trocar o período não muda a história, só a janela.
//
// O fuso é o de São Paulo: o dia de cada evento sai de `diaLocal` (comum/tempo.ts) ou da distância
// até as 00:00 de lá (UTC−3 fixo), nunca de `toISOString()`.

const MIN_MS = 60_000;
const HORA_MS = 3_600_000;
const DIA_MS = 86_400_000;
/** São Paulo está 3 h atrás de UTC (o ano todo, desde 2019). */
const FUSO_MS = 3 * HORA_MS;

/** Quantos dias de silêncio do lead contam como "sem resposta" (spec 4.3: "o 7 é configurável na fundação"). */
export const DIAS_SEM_RESPOSTA = 7;
/**
 * Até quantos dias antes de hoje existe histórico. Cobre o personalizado máximo (366 dias), o
 * anterior dele (mais 366) e a folga das conversas antigas (75): 366 × 2 + 75 = 807, arredondado.
 */
export const DIAS_DE_HISTORICO = 810;
/** A escuta de áudio foi removida há 9 dias (o exemplo de agora está sem transcrição): não há custo de transcrição depois disso. */
export const DIAS_SEM_ESCUTA = 9;
/** Um lead fica ativo, no máximo, por volta disto depois da 1ª mensagem (folga para buscar os leads de uma janela). */
const FOLGA_ATIVIDADE_DIAS = 75;

const SEMENTE = "janete-dashboard-v9";

/* ---------- as etapas do funil (as do exemplo, na ordem do Kanban) ---------- */

export const ETAPAS_GERADOR = [
  { id: IDS.etapa.novo, nome: "Novo", ordem: 10, tipo: "aberta", janetePodeMover: false },
  { id: IDS.etapa.em_qualificacao, nome: "Em qualificação", ordem: 20, tipo: "aberta", janetePodeMover: true },
  { id: IDS.etapa.qualificado, nome: "Qualificado", ordem: 30, tipo: "aberta", janetePodeMover: true },
  { id: IDS.etapa.em_negociacao, nome: "Em negociação", ordem: 40, tipo: "aberta", janetePodeMover: false },
  { id: IDS.etapa.ganho, nome: "Ganho", ordem: 50, tipo: "ganho", janetePodeMover: false },
] as const;

const GANHO = 4;
const PERDIDO = 5;

export const MODELO_RESPOSTA = { provedor: "anthropic", modelo: "claude-haiku-5-5" } as const;
export const MODELO_TRANSCRICAO = { provedor: "openai", modelo: "gpt-4o-mini-transcribe" } as const;
export const MODELO_FALA = { provedor: "elevenlabs", modelo: "eleven_multilingual_v2" } as const;

/* ---------- PRNG ---------- */

function fnv1a(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function normal(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal pela mediana e pelo desvio do log. */
function lognormal(rng: Rng, mediana: number, sigma: number): number {
  return mediana * Math.exp(sigma * normal(rng));
}

function escolherPeso<T>(rng: Rng, opcoes: readonly (readonly [T, number])[]): T {
  const total = opcoes.reduce((s, [, p]) => s + p, 0);
  let r = rng() * total;
  for (const [valor, peso] of opcoes) {
    r -= peso;
    if (r < 0) return valor;
  }
  return opcoes[opcoes.length - 1]![0];
}

const entre = (rng: Rng, a: number, b: number) => a + (b - a) * rng();
const inteiro = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
const limitar = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/* ---------- o lead sintético ---------- */

export type Lado = "lead" | "janete" | "humano_tela" | "humano_celular";

export interface MovimentoSint {
  t: number;
  /** 1 a 4 (Em qualificação a Ganho) ou 5 (Perdido). */
  para: number;
  /** A etapa de onde saiu (0 a 3). */
  de: number;
  ator: "janete" | "equipe";
}

export interface MensagemSint {
  t: number;
  lado: Lado;
  /** Quantas mensagens (bolhas) saíram juntas nesse instante. */
  n: number;
  etapa: number;
}

export interface ChamadaSint {
  t: number;
  tipo: "resposta" | "transcricao";
  /** Custo em micro-dólares (inteiro, para as somas fecharem); `null` = chamada sem preço. */
  micro: number | null;
  etapa: number;
}

export interface PassagemSint {
  t: number;
  tipo: "janete_passou" | "falha";
  motivo: MotivoHumano;
  etapa: number;
  incidenteId: string | null;
}

export interface LeadSint {
  id: string;
  dia: string;
  /** A 1ª mensagem (entrada em Novo). */
  t0: number;
  movimentos: MovimentoSint[];
  mensagens: MensagemSint[];
  /** Cada resposta da Janete a uma rodada do lead: quando a 1ª bolha saiu e o atraso. */
  respostasJanete: { t: number; atrasoS: number }[];
  /** A 1ª resposta ao lead, de qualquer origem. */
  primeiraResposta: { t: number; atrasoS: number } | null;
  chamadas: ChamadaSint[];
  passagem: PassagemSint | null;
  /**
   * A última mensagem do lead em toda a história gerada (inclusive uma volta semanas depois, que
   * pode ainda não ter acontecido). Para o "sem resposta" num instante, use `ultimaDoLeadAte`.
   */
  ultimaDoLead: number;
  /** O lead parou de responder (fica parado na etapa, salvo se alguém mover para Perdido). */
  parado: boolean;
}

/* ---------- incidentes (falhas, envios, mídias, conexão) ---------- */

export interface IncidenteSint {
  id: string;
  dia: string;
  t: number;
  /** Duração em minutos (0 nos que são pontuais). */
  durMin: number;
  tipo: "falha_ia" | "envio" | "midia" | "conexao";
  /** Só em `falha_ia`. */
  motivo: MotivoHumano | null;
  /** Em `envio` e `midia`: quantas mensagens ou mídias falharam. */
  quantidade: number;
}

// Os incidentes caem a cada 10 dias (o marcado para domingo, que tem pouco movimento, passa para a
// segunda), quase sempre de manhã, antes da hora em que a página costuma ser aberta. O tipo segue um
// ciclo de 3 blocos: uma falha de IA longa (sem crédito ou chave recusada), uma curta (erro do
// provedor ou limite de passos) e um problema de envio, mídia ou conexão. Assim os 30 dias de
// quase toda data têm 3 problemas (2 antes do incidente do dia; 2 ou 4 perto de um que passou para
// a segunda). A falha cobre a chegada de leads novos (2 na longa, 1 na curta): eles caem nela e vão
// para a equipe, o que segura as passagens por falha na faixa da calibragem (seção 15), com as
// conversas antigas que escrevem durante a falha por cima.
const CICLO_INCIDENTE_DIAS = 10;
const DESLOCA_INCIDENTE = 3;
const cacheIncidentes = new Map<string, IncidenteSint[]>();

const resto = (a: number, b: number) => ((a % b) + b) % b;

/**
 * A janela da falha: de alguns minutos antes da chegada de um lead novo até logo depois da `k`-ésima
 * chegada. Procura primeiro um trecho de até 40 min de manhã (7h às 13h), depois até as 18h, depois
 * o dia todo; sem trecho curto, fica com o mais curto do dia. Uma falha longa pegaria conversas
 * antigas demais e passaria da faixa da calibragem.
 */
function janelaDaFalha(dia: string, kPedido: number, rng: Rng): { t: number; durMin: number } {
  const doDia = chegadasDoDia(dia).filter((t) => t >= instanteSP(dia, 7, 10, 0));
  const k = Math.max(1, Math.min(kPedido, doDia.length));
  const listas = [instanteSP(dia, 13, 0, 0), instanteSP(dia, 18, 0, 0), Infinity].map((ate) => doDia.filter((t) => t < ate));
  const sorteio = rng();
  const antes = inteiro(rng, 3, 9);
  const depois = inteiro(rng, 2, 7);
  if (doDia.length < k) {
    // dia sem chegadas suficientes (raro): uma falha curta às 9h e pouco
    return { t: instanteSP(dia, 9, 5 + Math.floor(sorteio * 45), 0), durMin: 18 + antes + depois };
  }
  const vao = (lista: number[], i: number) => lista[i + k - 1]! - lista[i]!;
  let chegadas = doDia;
  let pulo = -1;
  for (const lista of listas) {
    const curtas: number[] = [];
    for (let i = 0; i + k <= lista.length; i += 1) if (vao(lista, i) <= 40 * MIN_MS) curtas.push(i);
    if (curtas.length) {
      chegadas = lista;
      pulo = curtas[Math.floor(sorteio * Math.min(3, curtas.length))]!;
      break;
    }
  }
  if (pulo < 0) {
    pulo = 0;
    for (let i = 1; i + k <= doDia.length; i += 1) if (vao(doDia, i) < vao(doDia, pulo)) pulo = i;
  }
  const inicio = chegadas[pulo]! - antes * MIN_MS;
  const fim = chegadas[pulo + k - 1]! + depois * MIN_MS;
  return { t: inicio, durMin: Math.max(1, Math.round((fim - inicio) / MIN_MS)) };
}

/** Os incidentes de um dia (no máximo 1; 1 a cada 10 dias), sempre de manhã. */
export function incidentesDoDia(dia: string): IncidenteSint[] {
  const guardado = cacheIncidentes.get(dia);
  if (guardado) return guardado;
  const lista: IncidenteSint[] = [];
  // o incidente marcado para um domingo (pouco movimento) passa para a segunda
  const marcado = (d: string) => resto(numeroDoDia(d) + DESLOCA_INCIDENTE, CICLO_INCIDENTE_DIAS) === 0;
  const ontem = somarDias(dia, -1);
  const ehDia = (marcado(dia) && diaDaSemana(dia) !== 0) || (marcado(ontem) && diaDaSemana(ontem) === 0);
  const num = numeroDoDia(marcado(dia) ? dia : ontem) + DESLOCA_INCIDENTE;
  if (ehDia) {
    const rng = mulberry32(fnv1a(`${SEMENTE}|incidente|${dia}`));
    const fase = resto(Math.floor(num / CICLO_INCIDENTE_DIAS), 3);
    if (fase === 2) {
      const tipo = escolherPeso(rng, [
        ["envio", 0.45],
        ["midia", 0.3],
        ["conexao", 0.25],
      ] as const);
      lista.push({
        id: `pb-${dia}`,
        dia,
        t: instanteSP(dia, inteiro(rng, 9, 11), inteiro(rng, 0, 59), inteiro(rng, 0, 59)),
        durMin: tipo === "conexao" ? inteiro(rng, 7, 31) : 0,
        tipo,
        motivo: null,
        quantidade: tipo === "envio" ? inteiro(rng, 2, 6) : tipo === "midia" ? inteiro(rng, 1, 3) : 0,
      });
    } else {
      const motivo: MotivoHumano =
        fase === 0
          ? rng() < 0.7
            ? "sem_credito"
            : "chave_invalida"
          : rng() < 0.7
            ? "erro_provedor"
            : "limite_passos";
      const { t, durMin } = janelaDaFalha(dia, fase === 0 ? 2 : 1, rng);
      lista.push({ id: `pb-${dia}`, dia, t, durMin, tipo: "falha_ia", motivo, quantidade: 0 });
    }
  }
  cacheIncidentes.set(dia, lista);
  return lista;
}

/** A falha de IA ativa no instante `t`, se houver. */
function falhaIAEm(t: number): IncidenteSint | null {
  for (const inc of incidentesDoDia(diaLocal(t))) {
    if (inc.tipo === "falha_ia" && t >= inc.t && t < inc.t + inc.durMin * MIN_MS) return inc;
  }
  return null;
}

/* ---------- a chegada dos leads ---------- */

// Menos no domingo, pico de terça a quinta (spec 15). A média dá ~182 leads em 30 dias, com uma
// onda lenta de ±4% (47 dias) para os períodos não ficarem iguais.
const PESO_SEMANA = [0.38, 0.98, 1.22, 1.25, 1.18, 1.0, 0.55] as const;
const BASE_DIA = 6.6;
const ONDA = 0.04;
/** O sorteio de cada dia mexe até isto na contagem (menos que o dia mais fraco, para nunca dar negativo). */
const OSCILACAO_DIA = 2.2;
/** A contagem acumulada começa aqui (antes do começo do histórico de qualquer data de uso). */
const EPOCA = numeroDoDia("2020-01-01");
// Picos das 9h às 12h e das 14h às 18h, pouca coisa de madrugada.
const PESO_HORA = [
  0.2, 0.1, 0.05, 0.05, 0.05, 0.1, 0.3, 0.8, 1.6, 2.6, 3.0, 2.8, 1.8, 1.6, 2.5, 2.8, 2.7, 2.4, 1.9, 1.5, 1.2, 0.9, 0.6, 0.35,
] as const;
const HORAS = PESO_HORA.map((p, h) => [h, p] as const);

/* As probabilidades por etapa (avançar, perder; o resto para de responder) e o tempo até a mudança. */
const AVANCA = [0.86, 0.63, 0.5, 0.52] as const;
const PERDE = [0.05, 0.13, 0.25, 0.3] as const;
/** Mediana (ms) e desvio do log do tempo na etapa até a próxima mudança. */
const DURACAO = [
  [9 * MIN_MS, 0.6],
  [9 * HORA_MS, 1.0],
  [2.1 * DIA_MS, 0.65],
  [4.2 * DIA_MS, 0.55],
] as const;
/** Quantas rodadas (o lead escreve, alguém responde) cada etapa costuma ter. */
const RODADAS = [
  [2, 4],
  [3, 7],
  [2, 6],
  [2, 6],
  [1, 3],
] as const;

const cacheLeads = new Map<string, LeadSint[]>();

// A contagem por dia sai de um acumulado (o esperado somado desde a EPOCA, mais uma oscilação de
// cada dia): o dia varia, mas qualquer janela de dias soma o esperado com erro de até ±3 leads. O
// índice do lead nesse acumulado (o "índice global") serve de base às sequências de baixa
// discrepância abaixo, que espalham por igual os destinos (ganho, passagem, chamada sem preço) entre
// leads seguidos. Sem isso, o sorteio independente fazia a taxa de ganho de 30 dias ir de 6% a 16%.
const DIA_SEMANA_EPOCA_0 = 4; // 01/01/1970 foi uma quinta
const esperadoDoNumero = (num: number) =>
  BASE_DIA * PESO_SEMANA[resto(num + DIA_SEMANA_EPOCA_0, 7)]! * (1 + ONDA * Math.sin((2 * Math.PI * num) / 47));
const acumulados: number[] = [0];
function acumulado(num: number): number {
  const k = num - EPOCA;
  while (acumulados.length <= k) {
    const j = acumulados.length - 1;
    acumulados.push(acumulados[j]! + esperadoDoNumero(EPOCA + j));
  }
  return acumulados[k]!;
}
/** O marco do dia no acumulado: os leads do dia têm os índices globais de marco(dia) a marco(dia + 1) − 1. */
function marco(num: number): number {
  const oscilacao = mulberry32(fnv1a(`${SEMENTE}|dia|${num}`))() * OSCILACAO_DIA;
  return Math.floor(acumulado(num) + oscilacao);
}

const PHI = (Math.sqrt(5) - 1) / 2;
const RAIZ2 = Math.SQRT2 - 1;
const RAIZ3 = Math.sqrt(3) - 1;
const frac = (x: number) => x - Math.floor(x);

/** Os leads cuja 1ª mensagem caiu no dia (São Paulo). Puro e guardado: o mesmo dia dá sempre o mesmo. */
export function leadsDoDia(dia: string): LeadSint[] {
  const guardado = cacheLeads.get(dia);
  if (guardado) return guardado;
  const num = numeroDoDia(dia);
  const lista: LeadSint[] = [];
  if (num >= EPOCA) {
    const primeiro = marco(num);
    const n = Math.max(0, marco(num + 1) - primeiro);
    for (let i = 0; i < n; i += 1) lista.push(gerarLead(dia, i, primeiro + i));
  }
  lista.sort((a, b) => a.t0 - b.t0);
  cacheLeads.set(dia, lista);
  return lista;
}

interface Intervalo {
  etapa: number;
  de: number;
  ate: number;
  fim: "avancou" | "perdeu" | "parou" | "ganho";
}

/** Lead com 1 chamada de resposta sem preço (a 1ª): ~3,5 a cada 30 dias. */
const FRACAO_SEM_PRECO = 0.019;
/** A Janete passa para a equipe logo no começo (Novo ou Em qualificação). */
const PASSA_CEDO = 0.034;
/** ... ou, de quem chegou a Qualificado, esta fração. */
const PASSA_QUALIFICADO = 0.29;
/** Custo mediano (US$) de uma resposta da Janete. */
const CUSTO_RESPOSTA_MEDIANO = 0.0232;

/** O começo do sorteio de um lead: o PRNG dele e a 1ª mensagem (os incidentes também leem a chegada). */
function chegadaDoLead(dia: string, indice: number): { rng: Rng; t0: number } {
  const rng = mulberry32(fnv1a(`${SEMENTE}|lead|${dia}|${indice}`));
  const hora = escolherPeso(rng, HORAS);
  const t0 = instanteSP(dia, hora, inteiro(rng, 0, 59), inteiro(rng, 0, 59));
  return { rng, t0 };
}

/** As 1as mensagens dos leads que chegam no dia (sem gerar os leads), em ordem. */
function chegadasDoDia(dia: string): number[] {
  const num = numeroDoDia(dia);
  if (num < EPOCA) return [];
  const n = Math.max(0, marco(num + 1) - marco(num));
  const lista: number[] = [];
  for (let i = 0; i < n; i += 1) lista.push(chegadaDoLead(dia, i).t0);
  return lista.sort((a, b) => a - b);
}

function gerarLead(dia: string, indice: number, global: number): LeadSint {
  const { rng, t0 } = chegadaDoLead(dia, indice);
  // as três sequências de baixa discrepância (ver o acumulado acima)
  let uDestino = frac(global * PHI);
  const uPassa = frac(global * RAIZ2 + 0.31);
  let semPrecoPendente = frac(global * RAIZ3 + 0.17) < FRACAO_SEM_PRECO;
  /* 1. o caminho no funil (só os tempos; quem moveu sai depois, conforme quem atendia) */
  const intervalos: Intervalo[] = [];
  const destinos: { t: number; para: number; de: number }[] = [];
  let parado = false;
  let tEntra = t0;
  for (let s = 0; s <= 3; s += 1) {
    const [mediana, sigma] = DURACAO[s]!;
    const dur = limitar(lognormal(rng, mediana, sigma), 2 * MIN_MS, 40 * DIA_MS);
    // um só número (uDestino) decide o caminho inteiro: avança com AVANCA, perde com PERDE, senão
    // para; ao avançar, ele é reescalado para a etapa seguinte (o ganho é uDestino < Π AVANCA)
    const r = uDestino;
    if (r < AVANCA[s]!) {
      uDestino = r / AVANCA[s]!;
      const tSai = tEntra + dur;
      intervalos.push({ etapa: s, de: tEntra, ate: tSai, fim: "avancou" });
      destinos.push({ t: tSai, para: s + 1, de: s });
      tEntra = tSai;
      if (s + 1 === GANHO) intervalos.push({ etapa: GANHO, de: tSai, ate: tSai + entre(rng, 0.4, 3) * DIA_MS, fim: "ganho" });
      continue;
    }
    if (r < AVANCA[s]! + PERDE[s]!) {
      const tSai = tEntra + dur * 1.2;
      intervalos.push({ etapa: s, de: tEntra, ate: tSai, fim: "perdeu" });
      destinos.push({ t: tSai, para: PERDIDO, de: s });
      break;
    }
    // parou de responder: a última palavra dele fica numa fração do tempo típico da etapa
    const tPara = tEntra + (s === 0 ? 0 : dur * entre(rng, 0.15, 0.7));
    intervalos.push({ etapa: s, de: tEntra, ate: tPara, fim: "parou" });
    parado = true;
    // parte dos que somem a equipe marca como Perdido depois de um tempo
    if (rng() < 0.4) destinos.push({ t: tPara + entre(rng, 8, 25) * DIA_MS, para: PERDIDO, de: s });
    break;
  }

  /* 2. quem atende: a Janete passa para a equipe às vezes; na negociação a equipe costuma assumir */
  const chegouEm = (s: number) => intervalos.some((i) => i.etapa === s);
  let passarNa: { etapa: number; rodada: number } | null = null;
  if (uPassa < PASSA_CEDO) passarNa = { etapa: uPassa < PASSA_CEDO * 0.4 ? 0 : 1, rodada: 1 };
  else if (chegouEm(2) && (uPassa - PASSA_CEDO) / (1 - PASSA_CEDO) < PASSA_QUALIFICADO) passarNa = { etapa: 2, rodada: 1 };
  const assumeNaNegociacao = chegouEm(3) && rng() < 0.12;

  const mensagens: MensagemSint[] = [];
  const respostasJanete: { t: number; atrasoS: number }[] = [];
  const chamadas: ChamadaSint[] = [];
  let primeiraResposta: { t: number; atrasoS: number } | null = null;
  let passagem: PassagemSint | null = null;
  let humanoDesde: number | null = null;
  let ultimaDoLead = t0;

  const comHumano = (t: number) =>
    (passagem !== null && t >= passagem.t) || (humanoDesde !== null && t >= humanoDesde);

  const custoResposta = (): number | null => {
    if (semPrecoPendente) {
      semPrecoPendente = false;
      return null;
    }
    return Math.round(limitar(lognormal(rng, CUSTO_RESPOSTA_MEDIANO, 0.35), 0.004, 0.03) * 1e6);
  };

  /* 3. as rodadas de cada etapa */
  for (const iv of intervalos) {
    if (iv.etapa === 3 && assumeNaNegociacao && passagem === null) humanoDesde = iv.de;
    const [min, max] = RODADAS[iv.etapa]!;
    const k = iv.fim === "parou" && iv.etapa === 0 ? 1 : inteiro(rng, min, max);
    const largura = Math.max(iv.ate - iv.de, MIN_MS);
    const tempos: number[] = [];
    for (let j = 0; j < k; j += 1) {
      // a 1ª rodada de Novo é a 1ª mensagem; na que parou, a última rodada é a última palavra do lead
      let t: number;
      if (iv.etapa === 0 && j === 0) t = t0;
      else if (iv.fim === "parou" && j === k - 1) t = iv.ate;
      else {
        t = iv.de + largura * ((j + 0.15 + rng() * 0.7) / k);
        // de madrugada quase ninguém escreve: a rodada passa para a manhã (sem sair da etapa)
        const horaSP = Math.floor((((t - FUSO_MS) % DIA_MS) + DIA_MS) % DIA_MS / HORA_MS);
        if (horaSP < 7) t = Math.min(t + (7 - horaSP + rng() * 3) * HORA_MS, iv.ate - MIN_MS);
      }
      tempos.push(t);
    }
    tempos.sort((a, b) => a - b);
    for (let j = 0; j < k; j += 1) {
      const t = tempos[j]!;
      const nLead = escolherPeso(rng, [
        [1, 0.85],
        [2, 0.12],
        [3, 0.03],
      ] as const);
      mensagens.push({ t, lado: "lead", n: nLead, etapa: iv.etapa });
      ultimaDoLead = Math.max(ultimaDoLead, t);
      if (rng() < 0.06) {
        chamadas.push({ t: t + 2000, tipo: "transcricao", micro: Math.round(entre(rng, 0.0006, 0.0041) * 1e6), etapa: iv.etapa });
      }

      // falha de IA no meio do caminho: a conversa vai para a equipe
      if (!comHumano(t)) {
        const falha = falhaIAEm(t);
        if (falha && passagem === null) {
          passagem = { t, tipo: "falha", motivo: falha.motivo ?? "erro_provedor", etapa: iv.etapa, incidenteId: falha.id };
        }
      }

      const primeira = primeiraResposta === null;
      if (!comHumano(t)) {
        const atrasoS = Math.round(
          primeira ? limitar(lognormal(rng, 41, 0.55), 6, 600) : limitar(lognormal(rng, 17, 1.0), 4, 900),
        );
        const tResp = t + atrasoS * 1000;
        const bolhas = escolherPeso(rng, [
          [1, 0.87],
          [2, 0.11],
          [3, 0.02],
        ] as const);
        mensagens.push({ t: tResp, lado: "janete", n: bolhas, etapa: iv.etapa });
        respostasJanete.push({ t: tResp, atrasoS });
        chamadas.push({ t: tResp, tipo: "resposta", micro: custoResposta(), etapa: iv.etapa });
        if (primeira) primeiraResposta = { t: tResp, atrasoS };
        if (passarNa && passagem === null && passarNa.etapa === iv.etapa && passarNa.rodada === j) {
          passagem = { t: tResp + 1000, tipo: "janete_passou", motivo: "janete_passou", etapa: iv.etapa, incidenteId: null };
        }
      } else {
        const atrasoS = Math.round(limitar(lognormal(rng, 540, 1.0), 30, 6 * 3600));
        const tResp = t + atrasoS * 1000;
        const lado: Lado = rng() < 0.8 ? "humano_tela" : "humano_celular";
        mensagens.push({ t: tResp, lado, n: rng() < 0.92 ? 1 : 2, etapa: iv.etapa });
        if (primeira) primeiraResposta = { t: tResp, atrasoS };
      }
    }

    // quem sumiu recebe de 1 a 3 lembretes (da Janete, ou da equipe se ela já assumiu): 1 dia, 3 dias
    // e, às vezes, uma última tentativa depois de 8 a 12 dias
    if (iv.fim === "parou") {
      const quando = [24, 72, entre(rng, 8, 12) * 24];
      const lembretes = rng() < 0.6 ? (rng() < 0.45 ? 3 : 2) : 1;
      for (let l = 0; l < lembretes; l += 1) {
        const t = iv.ate + quando[l]! * HORA_MS + entre(rng, 0, 3) * HORA_MS;
        if (comHumano(t)) {
          mensagens.push({ t, lado: "humano_tela", n: 1, etapa: iv.etapa });
        } else if (falhaIAEm(t)) {
          // a Janete está parada (falha de IA): o lembrete não sai, e não há chamada de IA
          continue;
        } else {
          mensagens.push({ t, lado: "janete", n: 1, etapa: iv.etapa });
          chamadas.push({ t, tipo: "resposta", micro: Math.round(entre(rng, 0.006, 0.016) * 1e6), etapa: iv.etapa });
        }
      }
      // às vezes o lead volta a escrever semanas depois (e some de novo), se ninguém o marcou como Perdido
      if (!destinos.some((d) => d.para === PERDIDO) && rng() < 0.15) {
        const t = iv.ate + entre(rng, 12, 45) * DIA_MS;
        mensagens.push({ t, lado: "lead", n: 1, etapa: iv.etapa });
        ultimaDoLead = Math.max(ultimaDoLead, t);
        // com a equipe, ou com a Janete parada por falha de IA: quem responde é a equipe
        if (comHumano(t) || falhaIAEm(t)) {
          const atrasoS = Math.round(limitar(lognormal(rng, 540, 1.0), 30, 6 * 3600));
          mensagens.push({ t: t + atrasoS * 1000, lado: "humano_tela", n: 1, etapa: iv.etapa });
        } else {
          const atrasoS = Math.round(limitar(lognormal(rng, 17, 1.0), 4, 900));
          mensagens.push({ t: t + atrasoS * 1000, lado: "janete", n: 1, etapa: iv.etapa });
          respostasJanete.push({ t: t + atrasoS * 1000, atrasoS });
          chamadas.push({ t: t + atrasoS * 1000, tipo: "resposta", micro: custoResposta(), etapa: iv.etapa });
        }
      }
    }
  }

  /* 4. quem moveu: a Janete só move para Em qualificação, Qualificado e Perdido, e só enquanto atende */
  const movimentos: MovimentoSint[] = destinos.map((d) => {
    let ator: "janete" | "equipe" = "equipe";
    if (!comHumano(d.t)) {
      if (d.para === 1) ator = rng() < 0.92 ? "janete" : "equipe";
      else if (d.para === 2) ator = rng() < 0.78 ? "janete" : "equipe";
      else if (d.para === PERDIDO && d.de <= 1) ator = rng() < 0.6 ? "janete" : "equipe";
      else if (d.para === PERDIDO && d.de === 2) ator = rng() < 0.3 ? "janete" : "equipe";
    }
    return { t: d.t, para: d.para, de: d.de, ator };
  });

  mensagens.sort((a, b) => a.t - b.t);
  return {
    id: `ld-${dia}-${indice}`,
    dia,
    t0,
    movimentos,
    mensagens,
    respostasJanete,
    primeiraResposta,
    chamadas,
    passagem,
    ultimaDoLead,
    parado,
  };
}

/* ---------- a leitura de um lead num instante ---------- */

/** A etapa do lead no instante (0 a 4; 5 = Perdido). */
export function etapaEm(lead: LeadSint, t: number): number {
  let etapa = 0;
  for (const m of lead.movimentos) if (m.t <= t) etapa = m.para;
  return etapa;
}

/** A etapa mais adiante a que o lead chegou até o instante (sem contar Perdido). */
function maisAdiante(lead: LeadSint, t: number): number {
  let max = 0;
  for (const m of lead.movimentos) if (m.t <= t && m.para !== PERDIDO) max = Math.max(max, m.para);
  return max;
}

/** Quando o lead entrou na etapa (0 = t0), ou `null` se ainda não entrou até `t`. */
function entradaNa(lead: LeadSint, etapa: number, t: number): number | null {
  if (etapa === 0) return lead.t0 <= t ? lead.t0 : null;
  const m = lead.movimentos.find((x) => x.para === etapa);
  return m && m.t <= t ? m.t : null;
}

/** Quando saiu da etapa (para a próxima ou para Perdido), ou `null` se ainda não saiu até `t`. */
function saidaDa(lead: LeadSint, etapa: number, t: number): number | null {
  const m = lead.movimentos.find((x) => x.de === etapa);
  return m && m.t <= t ? m.t : null;
}

/** A última mensagem do lead até o instante `t` (a 1ª mensagem, `t0`, se ele não escreveu de novo). */
export function ultimaDoLeadAte(lead: LeadSint, t: number): number {
  let ultima = lead.t0;
  for (const m of lead.mensagens) if (m.lado === "lead" && m.t <= t && m.t > ultima) ultima = m.t;
  return ultima;
}

/* ---------- os leads de uma janela ---------- */

/** Os leads que podem ter algo na janela: os da janela e os que chegaram até ~75 dias antes, sem passar do início do histórico. */
function leadsParaJanela(janela: Janela, agoraMs: number): LeadSint[] {
  const hoje = diaLocal(agoraMs);
  const inicioHistorico = somarDias(hoje, -DIAS_DE_HISTORICO);
  const primeiro = somarDias(diaLocal(janela.de), -FOLGA_ATIVIDADE_DIAS);
  const ultimo = diaLocal(Math.max(janela.de, janela.ate - 1));
  const de = primeiro < inicioHistorico ? inicioHistorico : primeiro;
  if (de > ultimo) return [];
  const lista: LeadSint[] = [];
  for (const dia of diasDoIntervalo(de, ultimo)) lista.push(...leadsDoDia(dia));
  return lista;
}

/* ---------- os números de uma janela ---------- */

export interface EtapaNumeros {
  chegaram: number;
  avancaram: number;
  aindaEstao: number;
  perdido: number;
  semResposta: number;
  tempoMedianoH: number | null;
  custoMicro: number;
  recebidas: number;
  enviadas: number;
  movJanete: number;
  movEquipe: number;
  passados: number;
  entradasPorDia: number[];
}

export interface NumerosJanela {
  /** Os dias da janela ("AAAA-MM-DD"), um por ponto das séries. */
  dias: string[];
  leadsNovos: number;
  conversas: number;
  recebidas: number;
  enviadas: number;
  porOrigem: { janete: number; humano_tela: number; humano_celular: number };
  primeiraRespostaS: number | null;
  respostaJaneteS: number | null;
  respostaJaneteP90S: number | null;
  conversasAutonomas: number;
  autonomiaPct: number | null;
  passados: { janetePassou: number; falha: number; porMotivo: Partial<Record<MotivoHumano, number>> };
  /**
   * `fim`: só o banco manda (dashboard_problemas). Na conexão, `null` = ainda não voltou; ausente
   * (o gerador) = voltou.
   */
  incidentes: (IncidenteSint & { conversasAfetadas: number; fim?: number | null | undefined })[];
  series: { conversas: number[]; recebidas: number[]; enviadas: number[]; respostaJaneteS: number[]; custoMicro: number[] };
  custo: {
    totalMicro: number;
    respostaMicro: number;
    transcricaoMicro: number;
    /** O custo da IA no onboarding (decisão 9d: entra no total, numa linha própria). O gerador não tem: 0. */
    onboardingMicro: number;
    /** O custo da voz da Janete (ElevenLabs). O gerador não tem: 0, sem consumir o rng. */
    falaMicro: number;
    semPreco: number;
    /** Conversas em que a Janete respondeu (mandou ao menos 1 mensagem) na janela. */
    conversasComJanete: number;
    /** Custo de resposta dos leads de fora da coorte. */
    foraDaCoorteMicro: number;
  };
  funil: {
    etapas: EtapaNumeros[];
    ganhos: number;
    cicloMedianoDias: number | null;
  };
}

export function mediana(valores: readonly number[]): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio]! : (v[meio - 1]! + v[meio]!) / 2;
}

/** Percentil pela posição mais próxima (p90 = 0.9). */
export function percentil(valores: readonly number[], p: number): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))]!;
}

const umaCasa = (x: number) => Math.round(x * 10) / 10;

/**
 * Os números de uma janela de instantes [de, ate), com o estado do funil lido em `estadoEmMs`
 * (o "ainda estão" é de hoje). `dias` são os dias civis da janela, para as séries.
 */
export function numerosDaJanela(
  janela: Janela,
  dias: readonly string[],
  agoraMs: number,
  /** Quando ler o estado do funil (o "ainda estão"). Padrão: agora. O anterior lê em agora − dias, para comparar coortes da mesma idade. */
  estadoEmMs: number = agoraMs,
): NumerosJanela {
  const { de, ate } = janela;
  const n = dias.length;
  const dentro = (t: number) => t >= de && t < ate && t <= agoraMs;
  const indiceDia = (t: number) => Math.min(n - 1, Math.floor((t - de) / DIA_MS));
  const corteEscuta = agoraMs - DIAS_SEM_ESCUTA * DIA_MS;

  const zeros = () => Array.from({ length: n }, () => 0);
  const series = { conversas: zeros(), recebidas: zeros(), enviadas: zeros(), respostaJaneteS: zeros(), custoMicro: zeros() };
  const respostasPorDia: number[][] = Array.from({ length: n }, () => []);
  const porOrigem = { janete: 0, humano_tela: 0, humano_celular: 0 };
  const passados = { janetePassou: 0, falha: 0, porMotivo: {} as Partial<Record<MotivoHumano, number>> };
  const afetadas = new Map<string, number>();
  const etapas: EtapaNumeros[] = ETAPAS_GERADOR.map(() => ({
    chegaram: 0,
    avancaram: 0,
    aindaEstao: 0,
    perdido: 0,
    semResposta: 0,
    tempoMedianoH: null,
    custoMicro: 0,
    recebidas: 0,
    enviadas: 0,
    movJanete: 0,
    movEquipe: 0,
    passados: 0,
    entradasPorDia: zeros(),
  }));
  const temposEtapa: number[][] = ETAPAS_GERADOR.map(() => []);

  let leadsNovos = 0;
  let conversas = 0;
  let autonomas = 0;
  let recebidas = 0;
  let enviadas = 0;
  let conversasComJanete = 0;
  let totalMicro = 0;
  let respostaMicro = 0;
  let transcricaoMicro = 0;
  let semPreco = 0;
  let foraDaCoorteMicro = 0;
  let ganhos = 0;
  const primeiras: number[] = [];
  const respostas: number[] = [];
  const ciclos: number[] = [];

  for (const lead of leadsParaJanela(janela, agoraMs)) {
    const coorte = dentro(lead.t0);

    /* mensagens */
    let teveMsg = false;
    let teveHumano = false;
    let teveJanete = false;
    const diasComMsg = new Set<number>();
    for (const m of lead.mensagens) {
      if (!dentro(m.t)) continue;
      teveMsg = true;
      const d = indiceDia(m.t);
      diasComMsg.add(d);
      if (m.lado === "lead") {
        recebidas += m.n;
        series.recebidas[d]! += m.n;
        if (coorte) etapas[m.etapa]!.recebidas += m.n;
      } else {
        enviadas += m.n;
        series.enviadas[d]! += m.n;
        porOrigem[m.lado] += m.n;
        if (coorte) etapas[m.etapa]!.enviadas += m.n;
        if (m.lado === "janete") teveJanete = true;
        else teveHumano = true;
      }
    }
    for (const d of diasComMsg) series.conversas[d]! += 1;

    /* respostas da Janete e 1ª resposta */
    for (const r of lead.respostasJanete) {
      if (!dentro(r.t)) continue;
      respostas.push(r.atrasoS);
      respostasPorDia[indiceDia(r.t)]!.push(r.atrasoS);
    }
    if (coorte && lead.primeiraResposta && lead.primeiraResposta.t <= estadoEmMs) primeiras.push(lead.primeiraResposta.atrasoS);

    /* passagem */
    const p = lead.passagem;
    const passouNaJanela = !!p && dentro(p.t);
    if (p && passouNaJanela) {
      if (p.tipo === "falha") {
        passados.falha += 1;
        if (p.incidenteId) afetadas.set(p.incidenteId, (afetadas.get(p.incidenteId) ?? 0) + 1);
      } else passados.janetePassou += 1;
      passados.porMotivo[p.motivo] = (passados.porMotivo[p.motivo] ?? 0) + 1;
      if (coorte) etapas[p.etapa]!.passados += 1;
    }

    if (teveMsg) {
      conversas += 1;
      if (!teveHumano && !passouNaJanela) autonomas += 1;
      if (teveJanete) conversasComJanete += 1;
    }

    /* custo */
    for (const c of lead.chamadas) {
      if (!dentro(c.t)) continue;
      if (c.tipo === "transcricao" && c.t >= corteEscuta) continue;
      if (c.micro === null) {
        semPreco += 1;
        continue;
      }
      totalMicro += c.micro;
      series.custoMicro[indiceDia(c.t)]! += c.micro;
      if (c.tipo === "transcricao") transcricaoMicro += c.micro;
      else {
        respostaMicro += c.micro;
        if (coorte) etapas[c.etapa]!.custoMicro += c.micro;
        else foraDaCoorteMicro += c.micro;
      }
    }

    /* funil (coorte), lido em agora */
    if (!coorte) continue;
    leadsNovos += 1;
    const alcance = maisAdiante(lead, estadoEmMs);
    const atual = etapaEm(lead, estadoEmMs);
    for (let s = 0; s <= alcance; s += 1) {
      const e = etapas[s]!;
      e.chegaram += 1;
      const entrou = entradaNa(lead, s, estadoEmMs);
      if (entrou !== null && dentro(entrou)) e.entradasPorDia[indiceDia(entrou)]! += 1;
      if (s === GANHO) continue;
      const saiu = saidaDa(lead, s, estadoEmMs);
      if (saiu !== null && entrou !== null) temposEtapa[s]!.push((saiu - entrou) / HORA_MS);
      if (s < alcance) {
        e.avancaram += 1;
        const mov = lead.movimentos.find((m) => m.de === s && m.para === s + 1);
        if (mov?.ator === "janete") e.movJanete += 1;
        else e.movEquipe += 1;
      }
    }
    if (alcance === GANHO) {
      ganhos += 1;
      etapas[GANHO]!.aindaEstao += 1;
      const tGanho = entradaNa(lead, GANHO, estadoEmMs);
      if (tGanho !== null) ciclos.push((tGanho - lead.t0) / DIA_MS);
    } else {
      const e = etapas[alcance]!;
      // "sem resposta": lido no instante do funil, só com o que o lead escreveu até ali (um lead
      // calado há mais de 7 dias que só volta depois conta como sem resposta agora)
      if (atual === PERDIDO) e.perdido += 1;
      else if (estadoEmMs - ultimaDoLeadAte(lead, estadoEmMs) > DIAS_SEM_RESPOSTA * DIA_MS) e.semResposta += 1;
      else e.aindaEstao += 1;
    }
  }

  for (let d = 0; d < n; d += 1) series.respostaJaneteS[d] = Math.round(mediana(respostasPorDia[d]!) ?? 0);
  etapas.forEach((e, s) => {
    const m = mediana(temposEtapa[s]!);
    e.tempoMedianoH = m === null ? null : umaCasa(m);
  });

  // os problemas só existem a partir do começo do histórico (antes dele não há lead nem conversa)
  const inicioHistorico = inicioDoDia(somarDias(diaLocal(agoraMs), -DIAS_DE_HISTORICO));
  const incidentes: NumerosJanela["incidentes"] = [];
  for (const dia of dias) {
    for (const inc of incidentesDoDia(dia)) {
      if (dentro(inc.t) && inc.t >= inicioHistorico) incidentes.push({ ...inc, conversasAfetadas: afetadas.get(inc.id) ?? 0 });
    }
  }
  incidentes.sort((a, b) => b.t - a.t);

  const primeiraMed = mediana(primeiras);
  const janeteMed = mediana(respostas);
  const cicloMed = mediana(ciclos);
  return {
    dias: [...dias],
    leadsNovos,
    conversas,
    recebidas,
    enviadas,
    porOrigem,
    primeiraRespostaS: primeiraMed === null ? null : Math.round(primeiraMed),
    respostaJaneteS: janeteMed === null ? null : Math.round(janeteMed),
    respostaJaneteP90S: percentil(respostas, 0.9),
    conversasAutonomas: autonomas,
    autonomiaPct: conversas ? umaCasa((autonomas / conversas) * 100) : null,
    passados,
    incidentes,
    series,
    custo: { totalMicro, respostaMicro, transcricaoMicro, onboardingMicro: 0, falaMicro: 0, semPreco, conversasComJanete, foraDaCoorteMicro },
    funil: { etapas, ganhos, cicloMedianoDias: cicloMed === null ? null : umaCasa(cicloMed) },
  };
}

/** Quantas conversas (leads com mensagem) houve na janela: a "{n} conversas desde ontem" da linha de resumo. */
export function conversasNaJanela(janela: Janela, agoraMs: number): number {
  let total = 0;
  for (const lead of leadsParaJanela(janela, agoraMs)) {
    if (lead.mensagens.some((m) => m.t >= janela.de && m.t < janela.ate && m.t <= agoraMs)) total += 1;
  }
  return total;
}

/** O custo (micro-dólares) com preço na janela: o "custo do mês até hoje" da previsão. */
export function custoNaJanelaMicro(janela: Janela, agoraMs: number): number {
  const corteEscuta = agoraMs - DIAS_SEM_ESCUTA * DIA_MS;
  let total = 0;
  for (const lead of leadsParaJanela(janela, agoraMs)) {
    for (const c of lead.chamadas) {
      if (c.micro === null || c.t < janela.de || c.t >= janela.ate || c.t > agoraMs) continue;
      if (c.tipo === "transcricao" && c.t >= corteEscuta) continue;
      total += c.micro;
    }
  }
  return total;
}
