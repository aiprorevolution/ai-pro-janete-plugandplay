/** Regras do cartão de conta, copiadas do F (`emailValido`, `contaBloqueada`, `senhaMedida`). */

export const SENHA_MINIMA = 8;

export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

/** O texto e o tom da medida ao lado do rótulo da senha. */
export function medidaSenha(senha: string): { texto: string; ok: boolean } {
  const faltam = Math.max(0, SENHA_MINIMA - senha.length);
  if (senha.length === 0) return { texto: "mínimo de 8 caracteres", ok: false };
  if (faltam === 0) return { texto: "senha ok", ok: true };
  return { texto: faltam === 1 ? "falta 1" : `faltam ${faltam}`, ok: false };
}

/** Corta um texto longo com reticências (o `curto` do F). */
export function curto(texto: string, limite: number): string {
  const limpo = String(texto || "")
    .trim()
    .replace(/\s+/g, " ");
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
}

/** "Conta de <primeiro nome> criada", como na legenda do F. */
export function detalheContaCriada(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] || "você";
  return `Conta de ${curto(primeiro, 24)} criada`;
}
