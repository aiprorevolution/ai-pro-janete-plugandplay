// Adaptador da Meta (WhatsApp Cloud API direta). Os segredos chegam em ConexaoServidor.segredos
// (token, appSecret, verifyToken); nada é lido do ambiente. A Meta configura o webhook no painel
// do app, por isso não há configurarWebhook.
import {
  ErroGateway,
  type AdaptadorGateway,
  type ConexaoServidor,
  type Identificador,
  type PedidoEnvio,
} from "../../nucleo/tipos";
import { tempoAte, tempoEnvio } from "../../nucleo/prazo";
import { assinaturaConfere, verificacaoMeta } from "./assinatura";
import { chamar, META_GRAPH } from "./api";
import { traduzirMeta } from "./traduzir";

const texto = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;
const campoDe = (campos: Record<string, string>, nome: string): string =>
  (typeof campos[nome] === "string" ? campos[nome] : "").trim();

/** Teto do download (a Meta aceita documento de até 100 MB; o Worker tem ~128 MB). */
export const MAX_BYTES_MIDIA = 20 * 1024 * 1024;

const HOSTS_META = [".fbsbx.com", ".facebook.com", ".fbcdn.net", ".whatsapp.net"];

/** https e host da Meta (lookaside.fbsbx.com etc.). */
export function hostDaMeta(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return HOSTS_META.some((h) => host.endsWith(h) || host === h.slice(1));
  } catch {
    return false;
  }
}

function token(c: ConexaoServidor): string {
  const t = c.segredos["token"];
  if (!t) throw new ErroGateway("token_ausente", true);
  return t;
}

/** Destino pela ordem que a Meta aceita: telefone (com +) e, sem ele, o BSUID. */
function destinoMeta(destino: Identificador[]): Record<string, string> {
  const tel = destino.find((d) => d.tipo === "telefone" && /^\d{5,}$/.test(d.valor));
  if (tel) return { to: `+${tel.valor}` };
  const bs = destino.find((d) => d.tipo === "bsuid" && d.valor !== "");
  if (bs) return { recipient: bs.valor };
  throw new ErroGateway("sem_destino", true);
}

/** Teto do "lido" sem digitando (pedido da tela): curto, para não segurar quem chamou. */
export const TEMPO_LIDA_MS = 8_000;

/** Último id não vazio: a Meta marca como lidas também as anteriores da conversa individual. */
function ultimoId(ids: string[]): string | undefined {
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (typeof id === "string" && id.trim() !== "") return id.trim();
  }
  return undefined;
}

function corpoEnvio(p: PedidoEnvio): Record<string, unknown> {
  // Responder citando: context {message_id: wamid da citada} (confirmado na doc oficial,
  // pesquisa). Sem respondeA, o corpo fica igual ao de antes.
  const citada = typeof p.respondeA === "string" ? p.respondeA.trim() : "";
  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...destinoMeta(p.destino),
    ...(citada ? { context: { message_id: citada } } : {}),
  };
  if (p.tipo === "texto") {
    if (!p.texto) throw new ErroGateway("texto_vazio", true);
    return { ...base, type: "text", text: { body: p.texto } };
  }
  if (!p.midia?.url) throw new ErroGateway("midia_ausente", true);
  const link = p.midia.url;
  if (p.tipo === "imagem") {
    return { ...base, type: "image", image: { link, ...(p.texto ? { caption: p.texto } : {}) } };
  }
  if (p.tipo === "audio") {
    const voz = /ogg/i.test(p.midia.mime);
    return { ...base, type: "audio", audio: { link, ...(voz ? { voice: true } : {}) } };
  }
  if (p.tipo === "documento") {
    return {
      ...base,
      type: "document",
      document: {
        link,
        ...(p.texto ? { caption: p.texto } : {}),
        ...(p.midia.nome ? { filename: p.midia.nome } : {}),
      },
    };
  }
  throw new ErroGateway("tipo_nao_suportado", true);
}

export const adaptadorMeta: AdaptadorGateway = {
  gateway: "meta",

  async validarWebhook(req, corpoCru, c) {
    return assinaturaConfere(
      req.headers.get("x-hub-signature-256"),
      corpoCru,
      c.segredos["appSecret"],
    );
  },

  responderVerificacao(url, c) {
    return verificacaoMeta(url, c.segredos["verifyToken"]);
  },

  traduzir(corpo, c) {
    const waba = c.parametros["wabaId"];
    return traduzirMeta(corpo, c.id_externo, typeof waba === "string" ? waba : undefined);
  },

  async baixarMidia(ref, c, opcoes) {
    const t = token(c);
    const fimEm = opcoes?.fimEm;
    const meta = await chamar(`${META_GRAPH}/${encodeURIComponent(ref)}`, t, {
      ...(fimEm !== undefined ? { fimEm } : {}),
    });
    const info = (meta.corpo as Record<string, unknown> | null) ?? {};
    const url = texto(info["url"]);
    // O Bearer só vai para hosts da Meta.
    if (!url || !hostDaMeta(url)) throw new ErroGateway("midia_sem_url", true);
    // Acima do teto, nem baixa: o arquivo inteiro iria para a memória do Worker.
    const tamanho = Number(info["file_size"]);
    if (Number.isFinite(tamanho) && tamanho > MAX_BYTES_MIDIA) {
      throw new ErroGateway("midia_grande_demais", true);
    }
    const mimeMeta = texto(info["mime_type"]);
    const baixada = await chamar(url, t, {
      bytes: true,
      seguirRedirect: true,
      ...(fimEm !== undefined ? { fimEm } : {}),
    });
    return {
      bytes: baixada.bytes ?? new Uint8Array(),
      mime: mimeMeta ?? baixada.mime ?? "application/octet-stream",
    };
  },

  async enviar(p, c, opcoes) {
    const corpo = corpoEnvio(p);
    const r = await chamar(`${META_GRAPH}/${encodeURIComponent(c.id_externo)}/messages`, token(c), {
      metodo: "POST",
      corpo,
      // teto do envio (10 s texto, 20 s mídia): a Meta não tem eco nem chave de idempotência
      prazoMs: tempoEnvio(p.tipo, opcoes?.fimEm),
    });
    const msgs = (r.corpo as Record<string, unknown> | null)?.["messages"];
    const id = Array.isArray(msgs)
      ? texto((msgs[0] as Record<string, unknown> | undefined)?.["id"])
      : undefined;
    return id ? { id_externo: id } : {};
  },

  async marcarLidaEDigitando(p, c) {
    try {
      const ultimo = p.ids_externos[p.ids_externos.length - 1];
      if (!ultimo) return;
      await chamar(`${META_GRAPH}/${encodeURIComponent(c.id_externo)}/messages`, token(c), {
        metodo: "POST",
        corpo: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: ultimo,
          typing_indicator: { type: "text" },
        },
      });
    } catch {
      // melhor esforço
    }
  },

  // Só o "lido": a mesma chamada sem typing_indicator (pesquisa: "Sem typing_indicator, só marca
  // como lida"). Uma chamada com o wamid mais recente basta. Vale até 30 dias após o recebimento;
  // fora disso a Meta recusa e o erro é engolido.
  async marcarLida(ref, c, opcoes) {
    try {
      const ultimo = ultimoId(ref.ids_externos);
      if (!ultimo) return false;
      const prazoMs = tempoAte(TEMPO_LIDA_MS, opcoes?.fimEm);
      if (prazoMs <= 0) return false;
      // chamar lança em resposta fora do 2xx: chegar aqui é a Meta ter aceitado
      await chamar(`${META_GRAPH}/${encodeURIComponent(c.id_externo)}/messages`, token(c), {
        metodo: "POST",
        corpo: { messaging_product: "whatsapp", status: "read", message_id: ultimo },
        prazoMs,
      });
      return true;
    } catch {
      // melhor esforço
      return false;
    }
  },

  montarConexao(campos, gerados) {
    const phoneId = campoDe(campos, "phoneId");
    const tokenAcesso = campoDe(campos, "token");
    const appSecret = campoDe(campos, "appSecret");
    const verifyToken = gerados.verifyToken ?? "";
    if (!/^\d{5,30}$/.test(phoneId) || !tokenAcesso || !appSecret || !verifyToken) {
      throw new ErroGateway("conexao_invalida", true);
    }
    const wabaId = campoDe(campos, "wabaId");
    return {
      id_externo: phoneId,
      parametros: { phoneId, ...(wabaId ? { wabaId } : {}) },
      segredos: { token: tokenAcesso, appSecret, verifyToken },
    };
  },
};
