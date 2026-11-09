// O desligar do webhook no provedor, que o Desconectar (configuracao/acoes.server.ts) e o Trocar de
// WhatsApp (gravarConexao, em conexoes.server.ts) fazem com a conexão que sai (decisões 4 e 10 da
// spec-lacunas-mensageria). Roda antes de desativar a conexão, porque o gatilho conexoes_desativar
// apaga os segredos. Recebe quem carrega a conexão, para não importar o conexoes.server (que importa
// este módulo).
import { FalhaDeRede, TempoEsgotado } from "@/features/servidor/http";

import { adaptadorDe } from "../gateways";
import type { ConexaoServidor, GatewayId } from "./tipos";

/** Teto do desligar do webhook (abaixo do PRAZO_MS de 10 s dos vizinhos). */
export const TETO_DESLIGAR_WEBHOOK_MS = 8_000;

/**
 * O webhook no provedor depois de a conexão sair: webhook_no_painel = o gateway não tem API para
 * desligar (Meta e Z-API), a tela lembra de tirar no painel; webhook_nao_desligado = tinha e falhou
 * (ou estourou o tempo). Sem aviso = desligou.
 */
export type AvisoWebhook = "webhook_no_painel" | "webhook_nao_desligado";

export type ResultadoWebhook = "desligado" | "no_painel" | "nao_desligado";

export type WebhookDesligado = {
  gateway: GatewayId | null;
  resultado: ResultadoWebhook;
  causa?: string;
};

export const AVISO_DO_WEBHOOK: Record<ResultadoWebhook, AvisoWebhook | null> = {
  desligado: null,
  no_painel: "webhook_no_painel",
  nao_desligado: "webhook_nao_desligado",
};

/**
 * Código curto da falha do desligar, para a auditoria: o código do ErroGateway (só letras,
 * números, "_" e ":"), tempo_esgotado ou falha_de_rede. Nunca a mensagem, a URL ou o corpo.
 */
function causaDoDesligar(e: unknown): string {
  if (e instanceof TempoEsgotado) return "tempo_esgotado";
  if (e instanceof FalhaDeRede) return "falha_de_rede";
  const codigo = e && typeof e === "object" && "codigo" in e ? e.codigo : null;
  return typeof codigo === "string" && /^[a-z0-9_:]{1,60}$/i.test(codigo)
    ? codigo
    : "erro_desconhecido";
}

/**
 * Melhor esforço: desliga o webhook no provedor com os segredos ainda guardados. Nunca lança: a
 * falha ao carregar a conexão, o erro do gateway e o teto estourado viram nao_desligado, com a
 * causa (causaDoDesligar) para a auditoria. `carregar` traz a conexão com os segredos; se ela não
 * é a de `id`, não mexe no webhook de outra conexão.
 */
export async function desligarWebhookDaConexao(
  carregar: () => Promise<ConexaoServidor | null>,
  id: string,
  tetoMs: number = TETO_DESLIGAR_WEBHOOK_MS,
): Promise<WebhookDesligado> {
  let c: ConexaoServidor | null;
  try {
    c = await carregar();
  } catch {
    return { gateway: null, resultado: "nao_desligado", causa: "conexao_nao_carregou" };
  }
  // a conexão mudou entre as duas leituras: não mexe no webhook de outra conexão
  if (!c || c.id !== id) {
    return { gateway: null, resultado: "nao_desligado", causa: "conexao_mudou" };
  }
  const adaptador = adaptadorDe(c.gateway);
  if (!adaptador?.desligarWebhook) return { gateway: c.gateway, resultado: "no_painel" };
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const teto = new Promise<never>((_, recusar) => {
    relogio = setTimeout(() => recusar(new TempoEsgotado()), tetoMs);
  });
  try {
    await Promise.race([adaptador.desligarWebhook(c), teto]);
    return { gateway: c.gateway, resultado: "desligado" };
  } catch (e) {
    return { gateway: c.gateway, resultado: "nao_desligado", causa: causaDoDesligar(e) };
  } finally {
    clearTimeout(relogio);
  }
}

/** O detalhe da auditoria conexao_desativada: o gateway, o resultado e a causa da falha. */
export function detalheDoWebhook(w: WebhookDesligado): Record<string, string | null> {
  return {
    gateway: w.gateway,
    webhook: w.resultado,
    ...(w.causa ? { webhook_causa: w.causa } : {}),
  };
}
