import { firebaseAdmin } from "@/integrations/firebase/client.server";
import { getInstallationConfig } from "@/integrations/firebase/config.server";
import { agendarProcessamento, conferirOrigemPublicada } from "./tasks.server";

export type ResultadoToque = "tocado" | "recente" | "sem_endereco" | "falhou";
export type ResultadoPreparo = "pronta" | "preparada" | "falhou";
export type PendenciasMotor = { proximoEm: number | null; vencidoDesde: number | null; atrasadoDesde: number | null };
export const TETO_TOQUE_MS = 12_000;
export const LEMBRAR_PREPARO_MS = 3_600_000;
export const JANELA_RENOVAR_MS = 600_000;
export const JANELA_RECENTE_MS = 0;
export const FOLGA_RELOGIO_MS = 0;

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

/** O destino vem da configuração instalada, nunca de Host/Origin recebido na requisição. */
export async function acordarMotor(
  _origem?: string | null,
  options: { renovar?: boolean; tetoMs?: number } = {},
): Promise<ResultadoToque> {
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

/** Mantido para chamadores de diagnóstico. A retomada efetiva é feita por Cloud Tasks. */
export function deveRenovarToque(pending: PendenciasMotor | null, work: boolean): boolean {
  return pending ? pending.proximoEm !== null || pending.vencidoDesde !== null : work;
}
