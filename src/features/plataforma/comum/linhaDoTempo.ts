// A regra comum das linhas do tempo de conversa (Chat, gaveta do Kanban e a aba Conversa dos
// Contatos): as mensagens vêm em páginas de 50, mas as passagens (conversa_eventos) e as mudanças de
// etapa vêm todas. Com mensagens mais antigas ainda por carregar, o que aconteceu antes da mensagem
// mais antiga carregada fica para quando a página dela chegar: senão, essas passagens e etapas
// apareciam no alto, com os separadores de dia, coladas nas mensagens recentes (como se naqueles dias
// não houvesse mensagem), e o "Carregar mensagens anteriores" ficava acima de coisas mais antigas do
// que as mensagens que ele traz.

/**
 * O instante (ms) a partir do qual as passagens e as etapas entram na linha: o da mensagem mais antiga
 * carregada, quando ainda há mais antigas; senão, tudo entra (-Infinity).
 */
export function inicioDaLinha(mensagens: readonly { momento: string }[], temMaisAntigas: boolean): number {
  if (!temMaisAntigas) return -Infinity;
  let inicio = Infinity;
  for (const m of mensagens) {
    const t = Date.parse(m.momento);
    if (Number.isFinite(t) && t < inicio) inicio = t;
  }
  return Number.isFinite(inicio) ? inicio : -Infinity;
}

/** Entra na linha: o item é do instante `inicio` em diante (o que não tem data válida entra). */
export function entraNaLinha(em: string, inicio: number): boolean {
  const t = Date.parse(em);
  return !Number.isFinite(t) || t >= inicio;
}
