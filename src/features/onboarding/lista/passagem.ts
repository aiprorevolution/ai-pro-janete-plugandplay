/**
 * Passagem WhatsApp → cérebro (irCerebro do F): o check do WhatsApp se desdobra no contêiner do
 * cérebro. A conexão marca antes de avançar; o cérebro lê ao montar e limpa depois de montado.
 * Fica só em memória (não vai para o sessionStorage): recarregar a página entra sem o desdobrar.
 */
let desdobrarNoCerebro = false;

export function pedirDesdobra(): void {
  desdobrarNoCerebro = true;
}

/** A conexão pediu o desdobrar? (só lê: pode rodar mais de uma vez na mesma pintura) */
export function desdobraPedido(): boolean {
  return desdobrarNoCerebro;
}

/** Limpa o pedido (no efeito de montagem do cérebro). */
export function consumirDesdobra(): void {
  desdobrarNoCerebro = false;
}
