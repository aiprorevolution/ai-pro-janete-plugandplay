import type { Erro } from "../dados/tipos";

// O texto curto de cada recusa das ações dos Contatos (mover, salvar a ficha, apagar), para o aviso da
// tela e o leitor de tela. Os códigos são os do traduzirErro (dados/erros.ts). `sem_permissao` (o
// atendente, recusado antes de ir ao banco) e `sem_acesso` (a RLS ou a função) dizem o mesmo; o
// `nao_encontrado` de um UPDATE com 0 linhas é o contato que sumiu (spec 2.6, "Erros iguais").

export type AcaoContato = "mover" | "salvar" | "apagar";

const TENTE: Record<AcaoContato, string> = {
  mover: "Não deu para mover agora. Tente de novo.",
  salvar: "Não deu para salvar agora. Tente de novo.",
  apagar: "Não deu para apagar agora. Tente de novo.",
};

export function textoDaRecusa(erro: Erro, acao: AcaoContato): string {
  switch (erro) {
    case "sem_permissao":
    case "sem_acesso":
      return acao === "apagar" ? "Só um admin pode apagar contatos." : "Sua conta não tem permissão para isso.";
    case "nao_encontrado":
      return "Este contato não existe mais. Ele pode ter sido apagado.";
    case "etapa_arquivada":
      return "Essa etapa foi arquivada. Escolha outra.";
    case "nome_vazio":
      return "O nome não pode ficar vazio.";
    case "limite_tamanho":
      return "Algum campo passou do tamanho que dá para salvar. Encurte e tente de novo.";
    default:
      return TENTE[acao];
  }
}
