import { timingSafeEqual } from "node:crypto";
import { firebaseAdmin } from "@/integrations/firebase/client.server";
import { getInstallationConfig } from "@/integrations/firebase/config.server";
import { chaveDerivada, esquecerChavesDerivadas } from "./chave-derivada.server";
import { agendarProcessamento, CAMINHO_WORKER, conferirOrigemPublicada } from "./tasks.server";

export type ResultadoToque = "tocado" | "recente" | "sem_endereco" | "falhou";
export type ResultadoPreparo = "pronta" | "preparada" | "falhou";
export type PendenciasMotor = { proximoEm: number | null; vencidoDesde: number | null; atrasadoDesde: number | null };
export const TETO_TOQUE_MS = 12_000;
export const LEMBRAR_PREPARO_MS = 3_600_000;
export const JANELA_RENOVAR_MS = 600_000;
export const JANELA_RECENTE_MS = 0;
export const FOLGA_RELOGIO_MS = 0;
/** Cabeçalho do toque que o app publicado manda para a própria rota do worker. */
export const CABECALHO_TOQUE = "x-janete-motor";
/** Quanto o toque espera o worker aceitar o pedido; depois disso segue sem esperar a resposta. */
export const TETO_TOQUE_PROPRIO_MS = 1_500;

/** Utilitário para leituras opcionais; não usar para abandonar enfileiramento ou escrita. */
export function comTeto<T>(promessa: Promise<T>, ms: number, noTeto: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<T>(resolve => { timer = setTimeout(() => resolve(noTeto), ms); });
  return Promise.race([promessa.catch(() => noTeto), limit]).finally(() => clearTimeout(timer));
}

export function origemDoMotor(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try { return conferirOrigemPublicada(origin); } catch { return null; }
}

/**
 * Pede um toque no motor. O destino vem da configuração instalada, nunca de Host/Origin recebido na requisição.
 * - Com a fila do Cloud Tasks (instalador): grava a tarefa durável.
 * - Sem fila (app publicado pelo AI Studio): o app chama a própria rota do worker, com a chave do motor, e não espera
 *   a rodada terminar. Quem pediu (o webhook, a tela) responde na hora; o worker faz o trabalho em outro pedido.
 * - Sem endereço publicado (prévia, máquina local): com `naHora`, processa dentro do próprio pedido.
 */
export async function acordarMotor(
  _origem?: string | null,
  options: { renovar?: boolean; tetoMs?: number; naHora?: boolean } = {},
): Promise<ResultadoToque> {
  if (filaConfigurada()) {
    try {
      const config = await getInstallationConfig();
      const origin = origemDoMotor(process.env["JANETE_PUBLIC_URL"] || config.publicUrl);
      if (!origin) return "sem_endereco";
      await agendarProcessamento(Date.now(), options.tetoMs ?? TETO_TOQUE_MS);
      return "tocado";
    } catch {
      console.error("motor_enfileiramento_falhou");
      return "falhou";
    }
  }
  try {
    const config = await getInstallationConfig().catch(() => null);
    const origin = origemDoMotor(process.env["JANETE_PUBLIC_URL"] || config?.publicUrl);
    if (!origin) return options.naHora ? processarNaHora() : "sem_endereco";
    const teto = Math.min(options.tetoMs ?? TETO_TOQUE_PROPRIO_MS, TETO_TOQUE_PROPRIO_MS);
    return await tocarProprioApp(origin, options.renovar === true, teto);
  } catch {
    console.error("motor_toque_falhou");
    return "falhou";
  }
}

// ---------- o toque sem fila: o app publicado chama a própria rota do worker ----------

const FORMATO_CHAVE = /^[0-9a-f]{64}$/;
/** Workers sem fila rodando nesta instância. Enquanto houver um, ele mesmo vê o que chegar: não sai outro toque. */
let workersAtivos = 0;

/** A chave do toque só faz o worker rodar; não abre nenhum dado. */
const chaveDoToque = () => chaveDerivada("janete-motor-toque-v1");
/** A chave que chegou no cabeçalho é a desta instalação? A que nem tem o formato é recusada sem ir ao banco. */
export async function conferirChaveDoToque(chave: string | null): Promise<boolean> {
  if (!chave || !FORMATO_CHAVE.test(chave)) return false;
  try {
    return timingSafeEqual(Buffer.from(chave), Buffer.from(await chaveDoToque()));
  } catch {
    console.error("motor_chave_falhou");
    return false;
  }
}

async function tocarProprioApp(origin: string, renovar: boolean, tetoMs: number): Promise<ResultadoToque> {
  if (!renovar && workersAtivos > 0) return "recente";
  const chave = await chaveDoToque();
  // Sem AbortSignal: desistir de esperar não pode cancelar o pedido, que é a rodada do worker.
  const pedido = fetch(`${origin}${CAMINHO_WORKER}`, {
    method: "POST",
    headers: { "content-type": "application/json", [CABECALHO_TOQUE]: chave },
    body: '{"version":1}',
  }).then(
    (resposta): ResultadoToque => {
      void resposta.body?.cancel().catch(() => {});
      return resposta.ok ? "tocado" : "falhou";
    },
    (): ResultadoToque => "falhou",
  );
  let timer: ReturnType<typeof setTimeout>;
  const teto = new Promise<ResultadoToque>((resolve) => { timer = setTimeout(() => resolve("tocado"), tetoMs); });
  return Promise.race([pedido, teto]).finally(() => clearTimeout(timer));
}

/** Só para testes. */
export function reiniciarToque() { esquecerChavesDerivadas(); workersAtivos = 0; }

/** A fila do Cloud Tasks existe quando o instalador configurou local e identidade da fila. */
export function filaConfigurada(): boolean {
  return !!process.env["JANETE_TASKS_LOCATION"] && !!process.env["JANETE_TASKS_SERVICE_ACCOUNT"];
}

export const TETO_NA_HORA_MS = 45_000;
type DependenciasNaHora = {
  rodar: (opcoes: { orcamentoMs: number }) => Promise<unknown>;
  pendencias: () => Promise<PendenciasMotor | null>;
  esperar: (ms: number) => Promise<void>;
  agora: () => number;
  marcarVisto: () => Promise<unknown>;
  garantirIndices: () => Promise<unknown>;
};
const naHoraPadrao: DependenciasNaHora = {
  rodar: async (opcoes) => (await import("./ciclo.server")).rodarCiclo(opcoes),
  pendencias: () => pendenciasDoMotor(),
  esperar: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  agora: () => Date.now(),
  marcarVisto: async () => (await import("./banco.server")).marcarWorkerVisto(),
  garantirIndices: async () => (await import("@/integrations/firebase/indices-automaticos.server")).garantirIndicesComTeto(20_000),
};

/**
 * Sem fila, o próprio webhook faz o trabalho do worker: roda o ciclo de atendimento, espera as rodadas vencerem
 * (o agrupamento de mensagens seguidas) e roda de novo, até o teto. O que vencer depois do teto fica pendente para o
 * próximo toque. Leases e outbox do ciclo impedem resposta repetida se o gateway reenviar o webhook.
 */
export async function processarNaHora(
  tetoMs = TETO_NA_HORA_MS,
  deps: DependenciasNaHora = naHoraPadrao,
): Promise<ResultadoToque> {
  const fim = deps.agora() + tetoMs;
  try {
    await deps.marcarVisto().catch(() => {});
    await deps.garantirIndices().catch(() => {});
    // Item vencido que ninguém consegue pegar não vira laço apertado: a espera dobra (1, 2, 4, 8 s).
    let esperaVencido = 1_000;
    for (;;) {
      const restante = fim - deps.agora();
      if (restante <= 1_000) return "tocado";
      await deps.rodar({ orcamentoMs: restante });
      const pendentes = await deps.pendencias();
      if (!pendentes) return "falhou";
      const momentos = [pendentes.proximoEm, pendentes.vencidoDesde].filter((n): n is number => n !== null);
      if (!momentos.length) return "tocado";
      const menor = Math.min(...momentos);
      const vencido = menor <= deps.agora();
      const proximo = Math.max(deps.agora() + (vencido ? esperaVencido : 1_000), menor);
      esperaVencido = vencido ? Math.min(esperaVencido * 2, 8_000) : 1_000;
      if (proximo >= fim) return "tocado";
      await deps.esperar(proximo - deps.agora());
    }
  } catch {
    console.error("motor_na_hora_falhou");
    return "falhou";
  }
}

export type ResultadoWorker = { resultado: ResultadoToque; toque: ResultadoToque | null };

/**
 * A rodada do worker sem fila, chamada pelo toque (rota do worker, com a chave do motor). Faz o que o Cloud Tasks e o
 * agendador fariam: roda o atendimento até o teto e, se sobrar trabalho perto, espera a hora dele e pede outro toque.
 * Assim uma falha passageira da IA ou uma resposta que vence depois do teto não fica esperando a próxima mensagem.
 * Enquanto roda, esta instância não solta outro toque; ao sair, confere de novo o que chegou no fim.
 */
export async function rodarWorkerSemFila(
  tetoMs = TETO_NA_HORA_MS,
  deps: DependenciasNaHora = naHoraPadrao,
  renovar: () => Promise<ResultadoToque> = () => acordarMotor(null, { renovar: true }),
): Promise<ResultadoWorker> {
  const fim = deps.agora() + tetoMs;
  let resultado: ResultadoToque = "falhou";
  workersAtivos++;
  try {
    resultado = await processarNaHora(tetoMs, deps);
    const pendentes = await deps.pendencias().catch(() => null);
    if (deveRenovarToque(pendentes, false, deps.agora())) {
      const momentos = [pendentes!.proximoEm, pendentes!.vencidoDesde].filter((n): n is number => n !== null);
      const ate = Math.min(Math.min(...momentos), fim);
      if (ate > deps.agora()) await deps.esperar(ate - deps.agora());
    }
  } finally {
    workersAtivos--;
  }
  // Depois de baixar a bandeira: o que chegou enquanto ela estava de pé contou com esta rodada.
  const pendentes = await deps.pendencias().catch(() => null);
  const toque = deveRenovarToque(pendentes, false, deps.agora()) ? await renovar().catch((): ResultadoToque => "falhou") : null;
  return { resultado, toque };
}

/** Inicialização idempotente de documentos padrão, não cria infraestrutura externa. */
export async function prepararCopia(): Promise<ResultadoPreparo> {
  try {
    const { data, error } = await firebaseAdmin.rpc("preparar_copia");
    if (error || (data !== "pronta" && data !== "preparada")) return "falhou";
    return data;
  } catch { return "falhou"; }
}

function instante(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const number = Date.parse(value);
  return Number.isFinite(number) ? number : null;
}

export async function pendenciasDoMotor(): Promise<PendenciasMotor | null> {
  try {
    const { data, error } = await firebaseAdmin.rpc("motor_pendencias");
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row) return null;
    return { proximoEm: instante(row["proximo_em"]), vencidoDesde: instante(row["vencido_desde"]),
      atrasadoDesde: instante(row["atrasado_desde"]) };
  } catch { return null; }
}

/**
 * A regra de renovar o toque no fim da rodada. Renova quando há item que fica pronto nos próximos 10 min, item vencido
 * há menos de 10 min, ou trabalho achado com pendência sobrando. Item vencido há mais tempo, sem trabalho achado, não
 * renova: um item que nunca é pego não vira corrente sem fim (a tela mostra o atraso e pede o toque).
 */
export function deveRenovarToque(pending: PendenciasMotor | null, work: boolean, agora: number = Date.now()): boolean {
  if (!pending) return work;
  const { proximoEm, vencidoDesde } = pending;
  if (proximoEm !== null && proximoEm - agora <= JANELA_RENOVAR_MS) return true;
  if (vencidoDesde !== null && agora - vencidoDesde < JANELA_RENOVAR_MS) return true;
  return work && (proximoEm !== null || vencidoDesde !== null);
}
