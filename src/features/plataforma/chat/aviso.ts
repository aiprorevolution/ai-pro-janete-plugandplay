import type { Erro } from "../dados/tipos";

/**
 * O tom do aviso curto da tela do Chat (o `.toast` do protótipo), que escolhe o ícone:
 * - `ok`: deu certo (devolver, salvar, mover);
 * - `erro`: não deu (recusas e falhas);
 * - `pessoa`: alguém assumiu a conversa;
 * - `lixo`: um contato foi apagado.
 */
export type TomAviso = "ok" | "erro" | "pessoa" | "lixo";

/** Quem mostra o aviso curto: o texto e, se não for `ok`, o tom. */
export type Avisar = (texto: string, tom?: TomAviso) => void;

/** O que a ação tentava fazer: muda o texto da falha genérica. */
export type AcaoChat = "geral" | "enviar" | "reenviar" | "salvar" | "observacao" | "mover" | "apagar";

const FALHA: Record<AcaoChat, string> = {
  geral: "Não deu para fazer isso agora. Tente de novo.",
  enviar: "Não deu para enviar agora. Tente de novo.",
  reenviar: "Não deu para reenviar agora. Tente de novo.",
  salvar: "Não deu para salvar agora. Tente de novo.",
  observacao: "Não deu para salvar a observação agora.",
  mover: "Não deu para mover agora. Tente de novo.",
  apagar: "Não deu para apagar agora.",
};

/**
 * O texto de cada erro que uma ação do Chat pode devolver (os códigos do banco, já traduzidos pelo
 * `traduzirErro`). Sem conexão e janela fechada não passam por aqui: a caixa de escrever bloqueia.
 */
export function textoDoErroChat(erro: Erro, acao: AcaoChat = "geral"): string {
  switch (erro) {
    case "sem_acesso":
      return "Sua conta não tem mais acesso a isto. Peça ao admin para conferir o seu convite.";
    case "sem_permissao":
      if (acao === "apagar") return "Só o admin pode apagar um contato.";
      return "Você não tem permissão para fazer isso.";
    case "nao_encontrado":
      return acao === "reenviar" ? "Essa mensagem não existe mais." : "Essa conversa não existe mais. Ela pode ter sido apagada.";
    case "nao_reenviavel":
      return "Essa mensagem pode ter chegado ao lead. Para não repetir, confira no WhatsApp e escreva de novo se precisar.";
    case "etapa_arquivada":
      return "Essa etapa foi arquivada. Escolha outra.";
    case "nome_vazio":
      return "O nome não pode ficar vazio.";
    case "limite_tamanho":
      return "Passou do tamanho que o WhatsApp aceita.";
    case "sem_conexao_ativa":
      return "O WhatsApp não está conectado.";
    case "janela_fechada":
      return "O lead não escreve há mais de 24 horas: o WhatsApp só deixa responder depois que ele escrever.";
    default:
      return FALHA[acao];
  }
}
