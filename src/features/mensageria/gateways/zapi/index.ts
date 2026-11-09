// Adaptador da Z-API (WhatsApp Web via QR code). Pesquisa: docs/pesquisa-gateways-whatsapp.md,
// seção 4 e "Conferência". A Z-API não assina o webhook: a origem é conferida pelo token na URL
// (?t=) e pelo instanceId do corpo.
import { abrirPrazo, lerTexto } from "../../../servidor/http";
import {
  ErroGateway,
  type AdaptadorGateway,
  type ConexaoServidor,
  type MidiaBaixada,
  type PedidoEnvio,
  type RefLida,
  type SegredoGerado,
} from "../../nucleo/tipos";
import { tempoAte, tempoEnvio } from "../../nucleo/prazo";
import { abrirPrazoApi, chamar, comPrazo, credenciais, destinoDe, erroDeStatus } from "./api";
import { traduzirZapi } from "./traduzir";

/** Compara em tempo constante: compara os resumos SHA-256, que têm sempre o mesmo tamanho. */
async function iguais(a: string, b: string): Promise<boolean> {
  if (a === "" || b === "") return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(x);
  const vb = new Uint8Array(y);
  let dif = 0;
  for (let i = 0; i < va.length; i++) dif |= (va[i] ?? 0) ^ (vb[i] ?? 0);
  return dif === 0;
}

const EXTENSOES_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "application/json": "json",
  "application/rtf": "rtf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

function extensaoDoDocumento(nome: string | undefined, mime: string): string {
  const doNome = nome?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  if (doNome) return doNome.toLowerCase();
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const daTabela = EXTENSOES_POR_MIME[base];
  if (daTabela) return daTabela;
  // reserva: o subtipo limpo do mime (image/heic -> heic); "pdf" só sem nada melhor
  const sub = base.split("/")[1] ?? "";
  return /^[a-z0-9]{1,8}$/.test(sub) && sub !== "octet" ? sub : "pdf";
}

/** Teto do download: o arquivo inteiro vai para a memória do Worker (cerca de 128 MB). */
export const MAX_BYTES_MIDIA = 25 * 1024 * 1024;
/** "Digitando..." antes de cada texto (delayTyping do send-text, de 1 a 15 s). */
export const DIGITANDO_S = 2;
/** Prazo próprio da marcação de lida: ela roda em paralelo com a IA. */
const PRAZO_LIDA_MS = 3_000;
const MIMES_GENERICOS = new Set(["application/octet-stream", "binary/octet-stream"]);

function idsDaResposta(corpo: unknown): { id_externo?: string; id_gateway?: string } {
  const id_externo = lerTexto(corpo, "messageId") ?? lerTexto(corpo, "id");
  const id_gateway = lerTexto(corpo, "zaapId");
  return {
    ...(id_externo ? { id_externo } : {}),
    ...(id_gateway ? { id_gateway } : {}),
  };
}

async function baixarPublica(ref: string, fimEm?: number): Promise<MidiaBaixada> {
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    throw new ErroGateway("midia_ref_invalida", true);
  }
  if (url.protocol !== "https:") throw new ErroGateway("midia_ref_invalida", true);
  const prazo = abrirPrazoApi(fimEm);
  try {
    let r: Response;
    try {
      // URL pública: sem Client-Token nem token da instância.
      r = await fetch(url.toString(), { method: "GET", signal: prazo.sinal });
    } catch {
      throw new ErroGateway(prazo.sinal.aborted ? "tempo_esgotado" : "falha_de_rede", false);
    }
    if (r.status < 200 || r.status >= 300) throw erroDeStatus(r.status);
    const tamanho = Number(r.headers.get("content-length") ?? NaN);
    if (Number.isFinite(tamanho) && tamanho > MAX_BYTES_MIDIA) {
      throw new ErroGateway("midia_grande_demais", true);
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await r.arrayBuffer());
    } catch {
      throw new ErroGateway(prazo.sinal.aborted ? "tempo_esgotado" : "falha_de_rede", false);
    }
    if (bytes.byteLength > MAX_BYTES_MIDIA) throw new ErroGateway("midia_grande_demais", true);
    // Sem Content-Type, ou com um genérico (comum em armazenamento tipo S3): mime vazio, para
    // o ciclo usar o mimeType que veio no webhook.
    const bruto = r.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const mime = MIMES_GENERICOS.has(bruto) ? "" : bruto;
    return { bytes, mime };
  } finally {
    prazo.encerrar();
  }
}

/**
 * POST read-message {phone, messageId} por mensagem (as 20 últimas), em paralelo e com prazo
 * curto (cortado por fimEm). A doc aceita 200 ou 204. Melhor esforço: nunca lança erro.
 * true = pelo menos um read-message aceito; false = nada pedido ou todos falharam.
 */
async function lerMensagens(ref: RefLida, c: ConexaoServidor, fimEm?: number): Promise<boolean> {
  try {
    const k = credenciais(c);
    const phone = destinoDe(ref.destino);
    const ids = ref.ids_externos.filter((id) => typeof id === "string" && id.trim() !== "");
    const tempo = tempoAte(PRAZO_LIDA_MS, fimEm);
    if (!phone || ids.length === 0 || tempo <= 0) return false;
    const prazo = abrirPrazo(tempo);
    try {
      const resultados = await Promise.allSettled(
        ids
          .slice(-20)
          .map((messageId) => chamar(k, "POST", "read-message", { phone, messageId }, prazo)),
      );
      return resultados.some((r) => r.status === "fulfilled");
    } finally {
      prazo.encerrar();
    }
  } catch {
    // melhor esforço
    return false;
  }
}

export const adaptadorZapi: AdaptadorGateway = {
  gateway: "zapi",

  async validarWebhook(req, corpoCru, c) {
    try {
      const esperado = c.segredos["tokenUrl"] ?? "";
      const recebido = new URL(req.url).searchParams.get("t") ?? "";
      if (!(await iguais(recebido, esperado))) return false;
      let corpo: unknown = null;
      try {
        corpo = JSON.parse(corpoCru);
      } catch {
        return true;
      }
      const instancia = lerTexto(corpo, "instanceId");
      if (instancia === undefined) return true;
      return await iguais(instancia, c.id_externo);
    } catch {
      return false;
    }
  },

  traduzir(corpo) {
    return traduzirZapi(corpo);
  },

  baixarMidia(ref, _c, opcoes) {
    return baixarPublica(ref, opcoes?.fimEm);
  },

  async enviar(p: PedidoEnvio, c: ConexaoServidor, opcoes?: { fimEm?: number }) {
    const k = credenciais(c);
    const phone = destinoDe(p.destino);
    if (!phone) throw new ErroGateway("sem_destino", true);

    let rota: string;
    let corpo: Record<string, unknown>;
    if (p.tipo === "texto") {
      if (!p.texto) throw new ErroGateway("texto_vazio", true);
      rota = "send-text";
      // delayTyping: a fila da Z-API mostra "Digitando..." antes de enviar (decisão 8)
      corpo = { phone, message: p.texto, delayTyping: DIGITANDO_S };
    } else {
      if (!p.midia?.url) throw new ErroGateway("midia_ausente", true);
      const legenda = p.texto ? { caption: p.texto } : {};
      if (p.tipo === "imagem") {
        rota = "send-image";
        corpo = { phone, image: p.midia.url, ...legenda };
      } else if (p.tipo === "audio") {
        rota = "send-audio";
        corpo = { phone, audio: p.midia.url };
      } else {
        rota = `send-document/${extensaoDoDocumento(p.midia.nome, p.midia.mime)}`;
        corpo = {
          phone,
          document: p.midia.url,
          ...(p.midia.nome ? { fileName: p.midia.nome } : {}),
          ...legenda,
        };
      }
    }
    // Citação: "messageId" no corpo do envio responde àquela mensagem (reply-message da v2;
    // texto, imagem, documento e, pela v2, áudio). Vazio = mensagem sem citação.
    const citada = p.respondeA?.trim();
    if (citada) corpo["messageId"] = citada;
    // teto do envio (10 s texto, 20 s mídia), não o das outras operações
    const prazo = abrirPrazo(tempoEnvio(p.tipo, opcoes?.fimEm));
    try {
      const r = await chamar(k, "POST", rota, corpo, prazo);
      return idsDaResposta(r.corpo);
    } finally {
      prazo.encerrar();
    }
  },

  async marcarLidaEDigitando(p, c) {
    // Não há endpoint de presença: o "digitando" vai no próprio envio (delayTyping). Aqui só
    // marca como lida, em paralelo e com prazo curto, porque roda junto com a IA.
    await lerMensagens(p, c);
  },

  async marcarLida(ref, c, opcoes) {
    // O read-message já é só o "lido": nada de "digitando" (que na Z-API só existe no envio).
    return lerMensagens(ref, c, opcoes?.fimEm);
  },

  async configurarWebhook(c, url) {
    const k = credenciais(c);
    await comPrazo(async (prazo) => {
      // A ordem importa: "enviadas por mim" exige o webhook de recebida já configurado, e com
      // ele ligado a Z-API passa a usar a URL de update-webhook-received-delivery (a de "Ao
      // receber" fica salva, mas sem uso). Por isso a nossa URL vai nas duas.
      await chamar(k, "PUT", "update-webhook-received", { value: url }, prazo);
      await chamar(k, "PUT", "update-webhook-received-delivery", { value: url }, prazo);
      await chamar(k, "PUT", "update-notify-sent-by-me", { notifySentByMe: true }, prazo);
      await chamar(k, "PUT", "update-webhook-message-status", { value: url }, prazo);
      // "Ao enviar" (DeliveryCallback): o único aviso de falha depois que o envio foi aceito
      await chamar(k, "PUT", "update-webhook-delivery", { value: url }, prazo);
      await chamar(k, "PUT", "update-webhook-disconnected", { value: url }, prazo);
      await chamar(k, "PUT", "update-webhook-connected", { value: url }, prazo);
    });
  },

  montarConexao(campos, gerados: Partial<Record<SegredoGerado, string>>) {
    const instanceId = (campos["instanceId"] ?? "").trim();
    const instanceToken = (campos["instanceToken"] ?? "").trim();
    const clientToken = (campos["clientToken"] ?? "").trim();
    const tokenUrl = (gerados.tokenUrl ?? "").trim();
    if (!instanceId || !instanceToken || !clientToken || !tokenUrl) {
      throw new ErroGateway("conexao_invalida", true);
    }
    return {
      id_externo: instanceId,
      parametros: { instanceId },
      segredos: { instanceToken, clientToken, tokenUrl },
    };
  },
};
