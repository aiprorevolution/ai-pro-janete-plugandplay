/**
 * Quem rola a área da tela: no computador, o `.platMain` da casca (overflow-y auto); no celular (até
 * 899 px), a página. Procura o ancestral mais próximo que rola na vertical; sem nenhum, `null` = a janela.
 * A TelaContatos usa para guardar e devolver a rolagem da tabela; a AbaConversa, para medir quanto da
 * janela sobra abaixo do cartão da conversa.
 */
export function acharRolador(el: Element | null): HTMLElement | null {
  let atual = el?.parentElement ?? null;
  while (atual && atual !== document.body && atual !== document.documentElement) {
    if (/(auto|scroll|overlay)/.test(window.getComputedStyle(atual).overflowY)) return atual;
    atual = atual.parentElement;
  }
  return null;
}
