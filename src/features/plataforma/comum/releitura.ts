import type { Erro, Leitura } from "../dados/tipos";

// O erro de uma leitura nas telas de conversa (Chat, Kanban e Contatos), com a regra do Dashboard:
// o React Query guarda os dados quando uma releitura em segundo plano falha (o tempo real, o foco, a
// página seguinte), e o paraLeitura põe o erro mesmo assim. Com os dados na tela, a falha vira um aviso
// compacto (com "Tentar de novo") e o conteúdo fica: a conversa, a caixa de escrever com o anexo e o
// áudio gravado, a ficha, o quadro e o perfil não somem. O ErroLeitura que toma o lugar do conteúdo é
// só o de quando ainda não há dados.

type ComErro = Pick<Leitura<unknown>, "dados" | "erro">;

/** O erro que toma o lugar do conteúdo: a leitura falhou e ainda não há dados. */
export function erroSemDados(l: ComErro): Erro | null {
  return l.dados === undefined ? l.erro : null;
}

/** O erro de uma releitura com os dados na tela: vira um aviso compacto, e o conteúdo fica. */
export function erroDeReleitura(l: ComErro): Erro | null {
  return l.dados !== undefined ? l.erro : null;
}
