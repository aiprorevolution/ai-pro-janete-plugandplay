// Valida o webhook, persiste o evento com deduplicação transacional e aplica os dados.
// Nenhuma geração de IA acontece nesta requisição. Antes de confirmar, aguarda a gravação
// da tarefa durável. Reentregas também acordam a fila: o evento pode ter sido salvo antes
// de uma falha ao agendar. Se a fila não aceitar, retorna 503 para permitir nova tentativa.
import { adaptadorDe } from "../gateways";
import {
  atualizarStatus,
  atualizarStatusConexao,
  gravarEvento,
  marcarEventoComErro,
  marcarEventoProcessado,
  registrarEntrada,
  registrarSaidaCelular,
  type MsgBanco,
} from "./banco.server";
import { carregarConexao } from "./conexoes.server";
import { limparPayload } from "./limpeza";
import { acordarMotor } from "./motor.server";
import { segredosCompletos } from "./segredos";
import {
  ErroGateway,
  type AdaptadorGateway,
  type ConexaoServidor,
  type Evento,
  type Identificador,
  type MensagemNormalizada,
} from "./tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(status: number, corpo: string): Response {
  return new Response(corpo, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

const naoEncontrado = () => texto(404, "nao_encontrado");

/** Teto do toque no motor: a Zernio espera a resposta do webhook no máximo 5 s. */
export const TETO_TOQUE_WEBHOOK_MS = 1_500;

/** Código curto e seguro para log e para a coluna erro. */
export function codigoDoErro(erro: unknown): string {
  // ErroGateway: só o código (a mensagem pode trazer o corpo da resposta do gateway).
  const msg = erro instanceof ErroGateway ? erro.codigo : erro instanceof Error ? erro.message : "";
  return /^[a-z0-9_]{1,40}(:[a-z0-9_]{1,60})?$/i.test(msg) ? msg : "erro_interno";
}

/**
 * Formato único do lid no banco: só o valor, sem o sufixo "@lid" (a Z-API manda com ele, a
 * Evolution sem). Assim o mesmo lead é achado pelo lid depois de trocar de gateway. No envio,
 * cada adaptador põe o sufixo de que precisa.
 */
export function idsNormalizados(ids: Identificador[]): Identificador[] {
  return ids.map((i) =>
    i.tipo === "lid" ? { tipo: i.tipo, valor: i.valor.trim().replace(/@lid$/i, "") } : i,
  );
}

/**
 * p_msg de registrar_entrada e registrar_saida_celular. A citação (responde_a_id_externo) vai
 * aparada; vazia ou de outro tipo, sai do p_msg (o banco grava responde_a_id nulo).
 */
export function msgParaBanco(msg: MensagemNormalizada, eventoId: number): MsgBanco {
  const { responde_a_id_externo: citacao, ...resto } = msg;
  const limpa = typeof citacao === "string" ? citacao.trim() : "";
  return {
    ...resto,
    ...(limpa ? { responde_a_id_externo: limpa.slice(0, 300) } : {}),
    evento_id: eventoId,
  };
}

/**
 * Aplica os eventos traduzidos. Todas as funções do banco são idempotentes, então reaplicar o
 * mesmo evento (reentrega ou nova tentativa do ciclo) não duplica nada.
 * pendente = algum status não casou com mensagem nenhuma (o evento fica para nova tentativa).
 * Erro do banco: lança.
 */
export async function aplicarEventos(
  eventos: Evento[],
  conexao: ConexaoServidor,
  eventoId: number,
): Promise<{ pendente: boolean }> {
  let pendente = false;
  for (const ev of eventos) {
    switch (ev.tipo) {
      case "entrada":
        await registrarEntrada(
          conexao.id,
          idsNormalizados(ev.ids),
          ev.nome_whatsapp,
          msgParaBanco(ev.msg, eventoId),
        );
        break;
      case "saida_celular":
        await registrarSaidaCelular(
          conexao.id,
          idsNormalizados(ev.ids),
          msgParaBanco(ev.msg, eventoId),
        );
        break;
      case "status": {
        const casaram = await atualizarStatus(conexao.id, ev.id, ev.status, ev.momento);
        if (casaram === 0) pendente = true;
        break;
      }
      case "conexao":
        await atualizarStatusConexao(conexao.id, ev.status, ev.detalhe);
        break;
      case "ignorar":
        break;
    }
  }
  return { pendente };
}

export const ERRO_TRADUCAO = "traducao_falhou";

// Mantém o import antigo (webhook.test.ts e quem mais usar) funcionando.
export { limparPayload };

/**
 * traduzir nunca deveria lançar. Se lançar (ou não devolver lista), falhou = true: o evento
 * fica pendente com o erro "traducao_falhou", para o ciclo tentar de novo depois que o
 * adaptador for corrigido, e a falha aparece em eventos_webhook.
 */
export function traduzirSeguro(
  adaptador: AdaptadorGateway,
  corpo: unknown,
  conexao: ConexaoServidor,
): { eventos: Evento[]; falhou: boolean } {
  try {
    const eventos = adaptador.traduzir(corpo, conexao);
    return Array.isArray(eventos) ? { eventos, falhou: false } : { eventos: [], falhou: true };
  } catch {
    return { eventos: [], falhou: true };
  }
}

async function sha256Hex(textoCru: string): Promise<string> {
  const dados = new TextEncoder().encode(textoCru);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", dados));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Id do evento: o do adaptador (Zernio); senão, o hash do corpo cru com a conexão, para que a
// reentrega idêntica (Meta, Z-API, Evolution) também caia no índice único.
async function idDoEvento(
  adaptador: AdaptadorGateway,
  req: Request,
  corpo: unknown,
  corpoCru: string,
  conexaoId: string,
): Promise<string> {
  let id: string | null = null;
  try {
    id = adaptador.idEvento?.(req, corpo) ?? null;
  } catch {
    id = null;
  }
  if (id && id.trim() !== "") return id.trim().slice(0, 200);
  return `sha256:${await sha256Hex(`${conexaoId}\n${corpoCru}`)}`;
}

function tipoDoEvento(eventos: Evento[]): string | null {
  const tipos = Array.from(new Set(eventos.map((e) => e.tipo)));
  return tipos.length ? tipos.join(",").slice(0, 100) : null;
}

export async function processarWebhook(
  req: Request,
  gateway: string,
  conexaoId: string,
): Promise<Response> {
  const adaptador = adaptadorDe(gateway);
  if (!adaptador || !UUID.test(conexaoId)) return naoEncontrado();

  let conexao: ConexaoServidor | null;
  try {
    conexao = await carregarConexao(conexaoId);
  } catch (erro) {
    console.error("webhook_conexao", codigoDoErro(erro));
    return texto(500, "erro");
  }
  if (!conexao || conexao.gateway !== adaptador.gateway) return naoEncontrado();
  // Sem todos os segredos (desativada ou gravada incompleta): nem chega ao adaptador, para
  // ninguém validar assinatura com chave vazia.
  if (!segredosCompletos(conexao.gateway, conexao.segredos)) return naoEncontrado();

  if (req.method === "GET") {
    if (!adaptador.responderVerificacao) return naoEncontrado();
    try {
      return adaptador.responderVerificacao(new URL(req.url), conexao) ?? naoEncontrado();
    } catch {
      return naoEncontrado();
    }
  }

  if (req.method !== "POST") return texto(405, "metodo_nao_permitido");

  const corpoCru = await req.text();
  let valido = false;
  try {
    valido = await adaptador.validarWebhook(req, corpoCru, conexao);
  } catch {
    valido = false;
  }
  if (!valido) return texto(401, "nao_autorizado");

  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru);
  } catch {
    return texto(400, "json_invalido");
  }

  const { eventos, falhou } = traduzirSeguro(adaptador, corpo, conexao);
  const idEvento = await idDoEvento(adaptador, req, corpo, corpoCru, conexao.id);

  let eventoId: number;
  try {
    const gravado = await gravarEvento(
      adaptador.gateway,
      conexao.id,
      idEvento,
      tipoDoEvento(eventos),
      limparPayload(corpo, Object.values(conexao.segredos)),
    );
    // Reentrega: já gravado. Se ficou pendente, o ciclo do worker termina o serviço.
    if (gravado.duplicado) {
      // A primeira entrega pode ter persistido o evento e perdido a confirmação da fila.
      const toque = await acordarMotor(new URL(req.url).origin).catch(() => "falhou");
      return toque === "tocado" ? texto(200, "ok") : texto(503, "fila_indisponivel");
    }
    eventoId = gravado.id;
  } catch (erro) {
    console.error("webhook_gravar", codigoDoErro(erro));
    return texto(500, "erro");
  }

  const resposta = await tratarEventoGravado(eventoId, eventos, falhou, conexao);
  // 2xx só depois de a fila durável confirmar. 503 pede reentrega ao gateway sem perder o evento.
  const toque = await acordarMotor(new URL(req.url).origin).catch(() => "falhou");
  return toque === "tocado" ? resposta : texto(503, "fila_indisponivel");
}

/** O que vem depois de gravar o evento novo: aplicar e marcar. Devolve a resposta ao gateway. */
async function tratarEventoGravado(
  eventoId: number,
  eventos: Evento[],
  falhou: boolean,
  conexao: ConexaoServidor,
): Promise<Response> {
  if (falhou) {
    // gravado: o ciclo tenta de novo; o gateway não precisa reenviar
    console.error("webhook_traduzir", ERRO_TRADUCAO);
    try {
      await marcarEventoComErro(eventoId, ERRO_TRADUCAO);
    } catch {
      // o evento continua pendente de qualquer jeito
    }
    return texto(200, "ok");
  }

  try {
    const { pendente } = await aplicarEventos(eventos, conexao, eventoId);
    if (pendente) await marcarEventoComErro(eventoId, "status_sem_mensagem");
    else await marcarEventoProcessado(eventoId);
  } catch (erro) {
    const codigo = codigoDoErro(erro);
    console.error("webhook_aplicar", codigo);
    try {
      await marcarEventoComErro(eventoId, codigo);
    } catch {
      // o evento continua pendente de qualquer jeito
    }
    return texto(500, "erro");
  }
  return texto(200, "ok");
}
