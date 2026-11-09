/**
 * Campos de segredo (chave de IA, tokens dos gateways) ficam não controlados: o valor vive só no
 * `<input>` e é lido na hora de validar. Campo controlado no React 19 copia o valor para o atributo
 * `value` do HTML, e o segredo apareceria em quem serializa o DOM (editor visual, extensões,
 * gravação de sessão, foto do DOM em relatório de erro).
 */
export function lerCampo(id: string): string {
  if (typeof document === "undefined") return "";
  const el = document.getElementById(id);
  return el instanceof HTMLInputElement ? el.value : "";
}

/** Apaga o valor do campo (sucesso, troca de motor ou de provedor). */
export function limparCampo(id: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el instanceof HTMLInputElement) el.value = "";
}
