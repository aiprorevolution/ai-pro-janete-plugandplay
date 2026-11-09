// Os códigos que o servidor e o banco guardam (conexoes.ultimo_erro, ia_chaves.ultimo_erro e o
// `erro` das funções de servidor da Configuração) viram frases para quem lê. Nenhum código aparece
// na tela; o código desconhecido cai numa frase geral. A frase pronta que o servidor manda
// (`mensagem`, já em português e sem segredo) vale por cima.

import type { ModoVoz } from "@/features/servidor/vozes-tipos";

import type { Gateway, StatusChave, StatusConexao } from "../exemplo";
import { GATEWAY_QR, LEIA_QR_DE_NOVO, MOSTRAR_QR, erroPadraoW, provDe } from "./dados";
import type { AvisoVoz } from "./leitura";

/** O aviso do cartão Voz: por que a resposta sai em texto (spec-voz-uso, C3). */
export const TEXTO_AVISO_VOZ: Record<AvisoVoz, string> = {
  sem_credito: "Sem crédito na ElevenLabs. A Janete está respondendo em texto até a conta ser recarregada.",
  invalida: "Chave inválida. A Janete está respondendo em texto: troque a chave da ElevenLabs.",
  sem_permissao:
    "Chave inválida: falta um acesso. Na ElevenLabs, edite a chave e ligue User, Text to Speech, Speech to Text e Voices; depois, troque a chave aqui. Até lá, a Janete responde em texto.",
  voz_nao_encontrada: "A voz escolhida não existe mais na conta. Escolha outra; até lá, a Janete responde em texto.",
  sem_voz: "Escolha a voz da Janete. Sem voz, ela responde em texto.",
};

/** As 3 opções do grupo "Responder em áudio", na ordem da tela. */
export const OPCOES_MODO_VOZ: readonly { modo: ModoVoz; rotulo: string }[] = [
  { modo: "quando_audio", rotulo: "Quando o lead manda áudio" },
  { modo: "sempre", rotulo: "Sempre" },
  { modo: "nunca", rotulo: "Nunca" },
];

/**
 * O conserto lido pelo celular de outro número (spec-qr-whatsapp, seção 8, decisão 4). A frase é
 * neutra porque o mesmo código fica gravado quando o desconectar falha: dizer "a Janete desconectou"
 * seria falso nesse caso. A frase exata (desconectou ou não) só vem na `mensagem` do servidor.
 */
const NUMERO_DIFERENTE =
  "Um celular de outro número leu o QR code. Leia o QR code com o celular do número desta conexão.";

/** Um código (letras minúsculas, números, _ e -), e não uma frase. */
function ehCodigo(t: string): boolean {
  return /^[a-z0-9_\-.:]+( \d+)?$/i.test(t.trim());
}

/** Uma frase pronta (o exemplo grava assim): começa com maiúscula e termina com ponto. */
function ehFrase(t: string): boolean {
  return /^[A-ZÀ-Ú]/.test(t) && /[.!?]$/.test(t.trim()) && t.trim().length > 12;
}

/** O motivo da queda do WhatsApp (conexoes.ultimo_erro), em linguagem simples. */
export function textoErroConexao(codigo: string | null | undefined, gateway: Gateway, situacao: StatusConexao): string {
  const t = (codigo ?? "").trim();
  if (t && ehFrase(t) && !ehCodigo(t)) return t;
  const curto = provDe(gateway)?.curto ?? "provedora";
  const qr = !!GATEWAY_QR[gateway];
  switch (t) {
    case "credencial_invalida":
      return gateway === "meta"
        ? "A Meta parou de aceitar o token guardado. Ele pode ter vencido: cole um token permanente novo."
        : `A ${curto} parou de aceitar os dados guardados. Eles podem ter mudado no painel da ${curto}.`;
    case "instancia_desconectada":
      return qr
        ? `A ${curto} avisou que o número saiu do WhatsApp no celular. ${LEIA_QR_DE_NOVO}`
        : `A ${curto} avisou que o número está desconectado. Confira no painel da ${curto}.`;
    case "nao_encontrado":
      return `A ${curto} não achou o número ou a instância guardada. Confira no painel da ${curto} e cole os dados de novo.`;
    case "servidor_inacessivel":
      return `Não conseguimos falar com a ${curto}. Confira se o serviço está no ar e tente de novo.`;
    case "tempo_esgotado":
      return `A ${curto} demorou demais para responder. Tente conferir de novo em instantes.`;
    case "nao_suportado":
      return `A ${curto} respondeu de um jeito que a Janete não reconhece. Cole os dados de novo.`;
    case "numero_diferente":
      return NUMERO_DIFERENTE;
    default:
      return erroPadraoW(gateway, situacao);
  }
}

/** A resposta do provedor da chave (ia_chaves.ultimo_erro), para "Resposta da X: …". */
export function textoErroChave(codigo: string | null | undefined, situacao: StatusChave): string {
  const t = (codigo ?? "").trim();
  if (t && ehFrase(t) && !ehCodigo(t)) return t;
  if (t === "chave_invalida" || t === "http_401") return "a chave não é válida. Ela pode ter sido apagada no painel.";
  if (t === "sem_credito" || t.startsWith("http_402")) return "o saldo de créditos da conta acabou.";
  if (t === "http_403_moderacao") return "a moderação do provedor bloqueou uma resposta.";
  if (t === "sem_permissao" || t === "http_403") return "a chave não tem permissão para usar este modelo.";
  if (t === "modelo_indisponivel" || t === "http_404") return "o modelo escolhido não está liberado para esta chave.";
  if (t === "workspace_necessario") return "a chave pede o workspace da conta.";
  if (t === "tempo_esgotado" || t === "tempo") return "o provedor demorou demais para responder.";
  if (t === "rede" || t === "provedor_fora" || /^http_5\d\d$/.test(t)) return "o provedor ficou fora do ar por um momento.";
  if (situacao === "sem_credito") return "o saldo de créditos da conta acabou.";
  if (situacao === "invalida") return "a chave não é válida. Ela pode ter sido apagada no painel.";
  return t ? "o provedor recusou o último pedido." : "";
}

/** A recusa de uma ação da Configuração (o `erro` da função de servidor), para o aviso rápido e o palco. */
export function textoFalhaAcao(erro: string, mensagem?: string | undefined): string {
  // só a Z-API e a Evolution devolvem "instancia_desconectada", e a frase do servidor manda ao painel
  // do provedor: na Configuração, o QR code se lê no próprio cartão
  if (erro === "instancia_desconectada") return `O número ainda não está conectado no WhatsApp. Leia o QR code em "${MOSTRAR_QR}".`;
  if (mensagem && mensagem.trim()) return mensagem.trim();
  switch (erro) {
    case "sem_acesso":
      return "Só quem administra a conta faz isso.";
    case "sem_conexao":
      return "Nenhum WhatsApp ativo. Conecte um número.";
    case "conexao_invalida":
      return "Os dados guardados desta conexão estão incompletos. Cole os dados de novo.";
    case "cifra_indisponivel":
    case "cifra_invalida":
      return "Não conseguimos abrir os dados guardados. Cole os dados de novo.";
    case "erro_ao_ler":
      return "Não conseguimos ler o que está guardado agora. Tente de novo em instantes.";
    case "erro_ao_gravar":
      return "Não conseguimos gravar agora. Tente de novo em instantes.";
    case "so_meta":
      return "Só a Meta deixa trocar um campo sozinho. Cole os dados de novo.";
    case "campo_vazio":
      return "Preencha o campo antes de conferir.";
    case "gateway_nao_implementado":
      return "Este gateway ainda não está disponível.";
    case "sem_chave":
      return "Não há chave guardada. Conecte uma chave.";
    case "provedor_nao_permitido":
      return "Este provedor não serve para isso.";
    case "nao_permitido":
      return "A chave do cérebro não se remove, só se troca.";
    case "fora_do_limite":
      return "O ritmo ficou fora dos limites: espera de 2 a 30 s, máximo de 20 a 120 s, e o máximo 5 s acima da espera.";
    case "credencial_invalida":
      return "O gateway recusou os dados. Confira e cole de novo.";
    case "nao_encontrado":
      return "Não achamos o que estava guardado. Cole os dados de novo.";
    case "servidor_inacessivel":
      return "Não conseguimos falar com o gateway. Tente de novo em instantes.";
    case "tempo_esgotado":
      return "Demorou demais para responder. Tente de novo em instantes.";
    case "nao_suportado":
      return "O gateway respondeu de um jeito que a Janete não reconhece.";
    case "numero_diferente":
      return NUMERO_DIFERENTE;
    case "chave_invalida":
      return "A chave foi recusada. Copie de novo, inteira, e valide.";
    case "sem_credito":
      return "A chave está sem crédito. Depois do pagamento, pode levar alguns minutos.";
    case "sem_permissao":
      return "A chave não tem permissão para usar este modelo.";
    case "workspace_necessario":
      return "A chave pede o workspace da conta.";
    case "modelo_indisponivel":
      return "O modelo escolhido não está liberado para esta chave.";
    case "provedor_fora":
      return "O provedor não respondeu agora. Tente de novo em alguns minutos.";
    case "voz_nao_encontrada":
      return "A voz escolhida não existe mais na conta. Escolha outra voz.";
    default:
      return "Não conseguimos falar com o servidor. Verifique a internet e tente de novo.";
  }
}

/**
 * O webhook da conexão antiga depois do Trocar (decisão 10 das lacunas), como no Desconectar: na Meta
 * e na Z-API, tirar no painel; na Evolution e na Zernio, só quando o desligar falhou.
 */
export function textoWebhookAnterior(aviso: string, gateway: Gateway): string {
  const curto = provDe(gateway)?.curto ?? "provedora";
  if (aviso === "webhook_no_painel") return `Tire também o webhook da conexão antiga no painel da ${curto}.`;
  if (aviso === "webhook_nao_desligado")
    return `Não deu para desligar o webhook da conexão antiga no provedor. Tire no painel da ${curto}.`;
  return "";
}

/** Os avisos de quem salvou a conexão (salvarConexao): a prévia e o webhook que não configurou. */
export function textoAvisoConexao(aviso: string, gateway: Gateway): string {
  const curto = provDe(gateway)?.curto ?? "provedora";
  if (aviso === "url_de_previa")
    return "Você conectou pela prévia. Depois de publicar o site, salve esta conexão de novo, para o WhatsApp mandar as mensagens para o endereço publicado.";
  if (aviso === "webhook_nao_configurado")
    return `A ${curto} não aceitou o endereço do webhook sozinha. Cole o endereço abaixo no painel da ${curto}.`;
  return "";
}
