// Pausa do ciclo, num módulo próprio para os testes trocarem pelo relógio falso.
export function dormir(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}
