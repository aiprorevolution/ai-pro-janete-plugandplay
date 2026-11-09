// Adaptador da Evolution API, só o modo QR code (WHATSAPP-BAILEYS). A ponte para a API oficial
// da Meta fica fora. Sem process.env: os segredos chegam em ConexaoServidor.segredos.
// Spec: docs/spec-mensageria-janete.md; pesquisa: docs/pesquisa-gateways-whatsapp.md, seção 5.
import { baseEvolution } from "../../../servidor/conexao";
import { ler, lerTexto } from "../../../servidor/http";
import {
  ErroGateway,
  type AdaptadorGateway,
  type ConexaoServidor,
  type Identificador,
  type MidiaBaixada,
  type PedidoEnvio,
  type RefLida,
} from "../../nucleo/tipos";
import { tempoAte, tempoEnvio } from "../../nucleo/prazo";
import { abrirSessao, buscar, postar, PRAZO_API_MS } from "./api";
import { traduzirEvolution } from "./traduzir";

export const EVENTOS_WEBHOOK = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
  "CONNECTION_UPDATE",
  // edição e exclusão do lead não passam pelo MESSAGES_UPSERT (o upsert pula protocolMessage)
  "MESSAGES_EDITED",
  "MESSAGES_DELETE",
] as const;

/** Teto do download: o arquivo inteiro vai para a memória do Worker (cerca de 128 MB). */
export const MAX_BYTES_MIDIA = 25 * 1024 * 1024;
/** base64 de N bytes tem 4N/3 letras: acima disso nem decodifica (a folga cobre o cabeçalho data:). */
const MAX_LETRAS_BASE64 = Math.ceil((MAX_BYTES_MIDIA * 4) / 3) + 1024;

/** "digitando" que cobre o tempo da IA (a Evolution segura o pedido por esse tempo). */
export const DELAY_DIGITANDO_MS = 15_000;
/** Prazo do pedido de presença: a Evolution continua depois que o cliente desconecta. */
export const PRAZO_PRESENCA_MS = 1_500;
const PRAZO_LIDA_MS = 3_000;

// ---------- validação ----------

async function resumo(texto: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

/** Comparação em tempo constante: compara os SHA-256 dos dois textos, byte a byte sem parar. */
async function iguais(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([resumo(a), resumo(b)]);
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i]! ^ y[i]!;
  return dif === 0;
}

async function validarWebhook(
  req: Request,
  corpoCru: string,
  c: ConexaoServidor,
): Promise<boolean> {
  const esperado = c.segredos["tokenUrl"];
  if (!esperado) return false;
  let t: string | null;
  try {
    t = new URL(req.url).searchParams.get("t");
  } catch {
    return false;
  }
  // Sem assinatura do corpo: o token da URL é a prova. Calcula sempre, para não variar o tempo.
  const tokenOk = await iguais(t ?? "", esperado);
  // Quando o corpo traz a instância, tem de ser a da conexão.
  let instanciaOk = true;
  try {
    const inst = lerTexto(JSON.parse(corpoCru) as unknown, "instance");
    if (inst !== undefined) instanciaOk = await iguais(inst, c.id_externo);
  } catch {
    // corpo que não é JSON: o núcleo responde 400 depois
  }
  return tokenOk && instanciaOk && t !== null && t !== "";
}

// ---------- conexão ----------

function montarConexao(
  campos: Record<string, string>,
  gerados: Partial<Record<"verifyToken" | "webhookSecret" | "tokenUrl", string>>,
) {
  const serverUrl = (campos["serverUrl"] ?? "").trim();
  const instanceName = (campos["instanceName"] ?? "").trim();
  const apiKey = (campos["apiKey"] ?? "").trim();
  const tokenUrl = gerados.tokenUrl;
  const base = baseEvolution(serverUrl);
  if (!base || !instanceName || !apiKey || !tokenUrl)
    throw new ErroGateway("conexao_invalida", true);
  return {
    id_externo: instanceName,
    parametros: { serverUrl: base.base } as Record<string, unknown>,
    segredos: { apiKey, tokenUrl },
  };
}

// ---------- destino ----------

/** Telefone com DDI, ou jid @lid; a Evolution aceita o jid cru em number. */
function numeroDoDestino(destino: Identificador[]): string | null {
  const tel = destino.find((d) => d.tipo === "telefone" && /^\d{5,20}$/.test(d.valor));
  if (tel) return tel.valor;
  const lid = destino.find((d) => d.tipo === "lid" && d.valor.trim() !== "");
  if (lid) return lid.valor.includes("@") ? lid.valor : `${lid.valor}@lid`;
  return null;
}

function jidDoTelefone(destino: Identificador[]): string | null {
  const tel = destino.find((d) => d.tipo === "telefone" && /^\d{5,20}$/.test(d.valor));
  return tel ? `${tel.valor}@s.whatsapp.net` : null;
}

// ---------- envio ----------

const NOME_PADRAO = { imagem: "imagem", documento: "documento", audio: "audio" } as const;

/** Rota e corpo do envio, sem a citação. */
function pedidoDoEnvio(p: PedidoEnvio, number: string): { rota: string; corpo: object } {
  if (p.tipo === "texto") {
    if (!p.texto?.trim()) throw new ErroGateway("texto_vazio", true);
    return { rota: "message/sendText", corpo: { number, text: p.texto } };
  }
  if (!p.midia?.url) throw new ErroGateway("midia_ausente", true);
  if (p.tipo === "audio") {
    // áudio de voz (aparece como gravado na hora)
    return {
      rota: "message/sendWhatsAppAudio",
      corpo: { number, audio: p.midia.url, encoding: true },
    };
  }
  return {
    rota: "message/sendMedia",
    corpo: {
      number,
      mediatype: p.tipo === "imagem" ? "image" : "document",
      mimetype: p.midia.mime,
      fileName: p.midia.nome ?? NOME_PADRAO[p.tipo],
      media: p.midia.url,
      ...(p.texto?.trim() ? { caption: p.texto } : {}),
    },
  };
}

async function enviar(p: PedidoEnvio, c: ConexaoServidor, opcoes?: { fimEm?: number }) {
  const number = numeroDoDestino(p.destino);
  if (!number) throw new ErroGateway("sem_destino", true);
  const { rota, corpo } = pedidoDoEnvio(p, number);
  const citada = typeof p.respondeA === "string" ? p.respondeA.trim() : "";
  // Citação: quoted.key.id (sendText, conferido na pesquisa; no sendMedia e no
  // sendWhatsAppAudio, o mesmo campo das opções comuns, a confirmar na doc). Sem quoted.message,
  // a Evolution procura a citada no próprio banco (DATABASE_SAVE_DATA_NEW_MESSAGE). Se ela
  // recusar (400, citada não achada), o ciclo manda de novo sem a citação, com um prazo inteiro
  // próprio e só se ele couber (nucleo/ciclo.server.ts, enviarComCitacao).
  const pedido = citada ? { ...corpo, quoted: { key: { id: citada } } } : corpo;
  // teto do envio (10 s texto, 20 s mídia), não o das outras operações
  const s = abrirSessao(c, tempoEnvio(p.tipo, opcoes?.fimEm));
  try {
    const r = await postar(s, rota, pedido);
    const id = lerTexto(r.corpo, "key", "id");
    return id ? { id_externo: id } : {};
  } finally {
    s.prazo.encerrar();
  }
}

// ---------- mídia ----------

function bytesDeBase64(b64: string): Uint8Array {
  const limpo = b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const bin = atob(limpo);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * A Evolution embrulha qualquer falha do getBase64FromMediaMessage num 400 (o catch dela faz
 * BadRequestException), inclusive as passageiras: tempo esgotado na CDN do WhatsApp, a instância
 * reconectando, "Message not found" sem DATABASE_SAVE_DATA_NEW_MESSAGE. Por isso o 4xx desse
 * pedido não é definitivo (o ciclo tenta de novo), menos o 401 e o 403 (apikey recusada).
 */
function http4xxPassageiro(e: unknown): unknown {
  if (!(e instanceof ErroGateway) || !e.definitivo) return e;
  if (!/^http:4\d\d$/.test(e.codigo) || e.codigo === "http:401" || e.codigo === "http:403")
    return e;
  return new ErroGateway(e.codigo, false);
}

async function baixarMidia(
  ref: string,
  c: ConexaoServidor,
  opcoes?: { fimEm?: number },
): Promise<MidiaBaixada> {
  if (!ref) throw new ErroGateway("midia_ausente", true);
  const s = abrirSessao(c, tempoAte(PRAZO_API_MS, opcoes?.fimEm));
  try {
    // Ref em JSON: a mensagem inteira vai no pedido (a Evolution não precisa do próprio banco).
    // Se ela recusar, tenta só pela key, que funciona com DATABASE_SAVE_DATA_NEW_MESSAGE=true.
    let completa: unknown = null;
    let id = ref;
    if (ref.startsWith("{")) {
      try {
        completa = JSON.parse(ref) as unknown;
      } catch {
        completa = null;
      }
      id = lerTexto(completa, "key", "id") ?? "";
      if (!id) throw new ErroGateway("midia_ref_invalida", true);
    }
    let r;
    try {
      r = completa
        ? await postar(s, "chat/getBase64FromMediaMessage", {
            message: completa,
            convertToMp4: false,
          })
        : null;
    } catch {
      r = null;
    }
    try {
      r ??= await postar(s, "chat/getBase64FromMediaMessage", {
        message: { key: { id } },
        convertToMp4: false,
      });
    } catch (e) {
      throw http4xxPassageiro(e);
    }
    const b64 = lerTexto(r.corpo, "base64");
    if (!b64) throw new ErroGateway("midia_vazia", false);
    // grande demais é definitivo: não adianta tentar de novo (o ciclo desiste da mídia)
    if (b64.length > MAX_LETRAS_BASE64) throw new ErroGateway("midia_grande_demais", true);
    let bytes: Uint8Array;
    try {
      bytes = bytesDeBase64(b64);
    } catch {
      throw new ErroGateway("midia_invalida", false);
    }
    if (bytes.byteLength > MAX_BYTES_MIDIA) throw new ErroGateway("midia_grande_demais", true);
    const nome = lerTexto(r.corpo, "fileName");
    return {
      bytes,
      mime: lerTexto(r.corpo, "mimetype") ?? "application/octet-stream",
      ...(nome ? { nome } : {}),
    };
  } finally {
    s.prazo.encerrar();
  }
}

// ---------- lida e digitando ----------

/**
 * Só o "lido" (chat/markMessageAsRead). Lança em falha; quem chama engole. Esse pedido só
 * aceita @s.whatsapp.net (descarta @lid sem avisar e responde sucesso), então contato só com
 * lid não é marcado. true = pedido aceito; false = nada pedido.
 */
async function pedirLida(p: RefLida, c: ConexaoServidor, prazoMs: number): Promise<boolean> {
  const jid = jidDoTelefone(p.destino);
  const ids = p.ids_externos.filter((id) => typeof id === "string" && id.trim() !== "");
  if (!jid || ids.length === 0 || prazoMs <= 0) return false;
  const s = abrirSessao(c, prazoMs);
  try {
    await postar(s, "chat/markMessageAsRead", {
      readMessages: ids.map((id) => ({ remoteJid: jid, fromMe: false, id })),
    });
    return true;
  } finally {
    s.prazo.encerrar();
  }
}

/** O "lido" sem o "digitando" (a tela abriu ou mexeu na conversa). Nunca lança erro. */
async function marcarLida(
  ref: RefLida,
  c: ConexaoServidor,
  opcoes?: { fimEm?: number },
): Promise<boolean> {
  try {
    return await pedirLida(ref, c, tempoAte(PRAZO_LIDA_MS, opcoes?.fimEm));
  } catch {
    // melhor esforço
    return false;
  }
}

async function marcarLidaEDigitando(p: RefLida, c: ConexaoServidor): Promise<void> {
  // Os dois em paralelo e com prazo curto: rodam junto com a IA. O sendPresence da Evolution
  // manda "composing", segura a resposta pelo delay e depois manda "paused"; o tempo esgotado
  // do nosso lado conta como sucesso, porque o "composing" já saiu.
  const lida = () => pedirLida(p, c, PRAZO_LIDA_MS);
  const digitando = async () => {
    const number = numeroDoDestino(p.destino);
    if (!number) return;
    const s = abrirSessao(c, PRAZO_PRESENCA_MS);
    try {
      await postar(s, "chat/sendPresence", {
        number,
        presence: "composing",
        delay: DELAY_DIGITANDO_MS,
      });
    } finally {
      s.prazo.encerrar();
    }
  };
  try {
    await Promise.allSettled([lida(), digitando()]);
  } catch {
    // melhor esforço
  }
}

// ---------- webhook ----------

/** Corpo do webhook/set: o mesmo para ligar e para desligar, só muda o enabled. */
function corpoWebhook(enabled: boolean, url: string) {
  return {
    webhook: { enabled, url, byEvents: false, base64: false, events: [...EVENTOS_WEBHOOK] },
  };
}

async function configurarWebhook(c: ConexaoServidor, url: string): Promise<void> {
  const s = abrirSessao(c);
  try {
    await postar(s, "webhook/set", corpoWebhook(true, url));
  } finally {
    s.prazo.encerrar();
  }
}

/**
 * Desliga o webhook da instância (enabled: false), com a URL que está gravada nela: o adaptador
 * não sabe a origem do app, e o webhook/set exige url. A URL vem do GET webhook/find. Se ela não
 * é a desta conexão (o caminho termina em /api/public/whatsapp/evolution/<id da conexão>, com ou
 * sem ?t=) ou já está desligada, não mexe: a instância pode apontar para outra cópia da Janete.
 * Falha de rede ou HTTP é lançada.
 */
async function desligarWebhook(c: ConexaoServidor): Promise<void> {
  const s = abrirSessao(c);
  try {
    const r = await buscar(s, "webhook/find");
    const atual = ler(r.corpo, "webhook") ?? r.corpo;
    const url = lerTexto(atual, "url") ?? "";
    const caminho = url.split(/[?#]/)[0]!.replace(/\/+$/, "");
    const desta = caminho.endsWith(`/api/public/whatsapp/evolution/${c.id}`);
    if (!desta || ler(atual, "enabled") === false) return;
    await postar(s, "webhook/set", corpoWebhook(false, url));
  } finally {
    s.prazo.encerrar();
  }
}

export const adaptadorEvolution: AdaptadorGateway = {
  gateway: "evolution",
  validarWebhook,
  traduzir: traduzirEvolution,
  baixarMidia,
  enviar,
  marcarLidaEDigitando,
  marcarLida,
  configurarWebhook,
  desligarWebhook,
  montarConexao,
};
