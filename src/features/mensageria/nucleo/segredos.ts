// Conferência dos segredos de uma conexão contra os nomes fixos do gateway (spec, premissas).
// Conexão desativada perde os segredos (gatilho conexoes_desativar), então isto também barra
// a conexão inativa sem depender de cada adaptador recusar segredo vazio.
import { NOMES_SEGREDOS, type GatewayId } from "./tipos";

/** true = todos os segredos do gateway existem e não estão vazios. */
export function segredosCompletos(
  gateway: GatewayId,
  segredos: Record<string, unknown> | null | undefined,
): boolean {
  if (!segredos) return false;
  return NOMES_SEGREDOS[gateway].every((nome) => {
    const valor = segredos[nome];
    return typeof valor === "string" && valor.trim() !== "";
  });
}
