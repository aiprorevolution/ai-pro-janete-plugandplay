// A busca da rota /app/kanban. `?contato=<id do contato>` abre a gaveta desse lead, como o clique no card
// (o "Ver no Kanban" do perfil, na tela Contatos). A tela ignora um id que não existe.

export interface BuscaKanban {
  contato?: string | undefined;
}

/**
 * O `validateSearch` da rota: só um texto não vazio vale como `contato`; o resto (número, lista, vazio)
 * fica sem contato. O `contato: undefined` explícito importa: o roteador junta a busca validada com a
 * crua, e sem ele um `?contato=42` passaria adiante.
 */
export function validarBuscaKanban(busca: Record<string, unknown>): BuscaKanban {
  const contato = busca["contato"];
  const id = typeof contato === "string" ? contato.trim() : "";
  return { contato: id || undefined };
}
