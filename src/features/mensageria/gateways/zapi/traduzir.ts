// Tradução dos webhooks da Z-API para os eventos do contrato. Nunca lança erro.
import { ler, lerNumero, lerTexto } from "../../../servidor/http";
import type {
  Evento,
  Identificador,
  MensagemNormalizada,
  StatusGateway,
  TipoMensagem,
} from "../../nucleo/tipos";

const ignorar = (motivo: string): Evento => ({ tipo: "ignorar", motivo });

/** momment em milissegundos; um valor de 10 dígitos ou menos é tratado como segundos. */
export function momentoIso(valor: unknown): string | undefined {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n < 100_000_000_000 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function ehLid(v: string | undefined): v is string {
  return !!v && /@lid$/i.test(v.trim());
}

/** Identificadores do contato da conversa: @lid primeiro (estável), depois o telefone. */
function identificadores(corpo: unknown, deMim: boolean): Identificador[] {
  const ids: Identificador[] = [];
  const phone = lerTexto(corpo, "phone")?.trim();
  const lid = [
    lerTexto(corpo, "chatLid"),
    deMim ? undefined : lerTexto(corpo, "senderLid"),
    ehLid(phone) ? phone : undefined,
  ].find(ehLid);
  if (lid) ids.push({ tipo: "lid", valor: lid.trim() });
  if (phone && !phone.includes("@")) {
    const digitos = phone.replace(/\D/g, "");
    if (digitos.length >= 6) ids.push({ tipo: "telefone", valor: digitos });
  }
  return ids;
}

function ehGrupo(corpo: unknown): boolean {
  const phone = lerTexto(corpo, "phone") ?? "";
  return (
    ler(corpo, "isGroup") === true ||
    /@g\.us$/i.test(phone) ||
    /-group$/i.test(phone) ||
    /^\d+-\d+$/.test(phone)
  );
}

type Conteudo = {
  tipo: TipoMensagem;
  texto?: string | undefined;
  midia_ref_externa?: string | undefined;
  midia_mime?: string | undefined;
  midia_nome?: string | undefined;
};

function mime(v: unknown): string | undefined {
  return texto(v)?.split(";")[0]?.trim() || undefined;
}

function conteudo(corpo: unknown): Conteudo | { ignorar: string } {
  const c = (k: string) => ler(corpo, k);
  const tem = (k: string) => c(k) !== null && typeof c(k) === "object";

  if (tem("reaction")) return { ignorar: "reacao" };
  if (texto(c("notification"))) return { ignorar: "notificacao" };
  if (tem("text")) {
    return { tipo: "texto", texto: lerTexto(corpo, "text", "message") };
  }
  if (tem("image")) {
    return {
      tipo: "imagem",
      texto: texto(lerTexto(corpo, "image", "caption")),
      midia_ref_externa: texto(lerTexto(corpo, "image", "imageUrl")),
      midia_mime: mime(lerTexto(corpo, "image", "mimeType")),
    };
  }
  if (tem("audio")) {
    return {
      tipo: "audio",
      midia_ref_externa: texto(lerTexto(corpo, "audio", "audioUrl")),
      midia_mime: mime(lerTexto(corpo, "audio", "mimeType")),
    };
  }
  if (tem("video")) {
    return {
      tipo: "video",
      texto: texto(lerTexto(corpo, "video", "caption")),
      midia_ref_externa: texto(lerTexto(corpo, "video", "videoUrl")),
      midia_mime: mime(lerTexto(corpo, "video", "mimeType")),
    };
  }
  if (tem("document")) {
    return {
      tipo: "documento",
      texto: texto(lerTexto(corpo, "document", "caption")),
      midia_ref_externa: texto(lerTexto(corpo, "document", "documentUrl")),
      midia_mime: mime(lerTexto(corpo, "document", "mimeType")),
      midia_nome:
        texto(lerTexto(corpo, "document", "fileName")) ??
        texto(lerTexto(corpo, "document", "title")),
    };
  }
  if (tem("sticker")) {
    return {
      tipo: "figurinha",
      midia_ref_externa: texto(lerTexto(corpo, "sticker", "stickerUrl")),
      midia_mime: mime(lerTexto(corpo, "sticker", "mimeType")),
    };
  }
  if (tem("location")) {
    const partes = [
      texto(lerTexto(corpo, "location", "name")),
      texto(lerTexto(corpo, "location", "address")),
    ].filter(Boolean);
    const lat = lerNumero(corpo, "location", "latitude");
    const lon = lerNumero(corpo, "location", "longitude");
    if (lat !== undefined && lon !== undefined) partes.push(`${lat}, ${lon}`);
    return { tipo: "outro", texto: `[localização] ${partes.join(" - ")}`.trim() };
  }
  if (tem("contact")) {
    const nome = texto(lerTexto(corpo, "contact", "displayName"));
    return { tipo: "outro", texto: nome ? `[contato] ${nome}` : "[contato]" };
  }
  const botao = texto(lerTexto(corpo, "buttonsResponseMessage", "message"));
  const lista = texto(lerTexto(corpo, "listResponseMessage", "message"));
  if (botao ?? lista) return { tipo: "texto", texto: botao ?? lista };
  if (tem("poll") || tem("pollVote")) return { tipo: "outro", texto: "[enquete]" };
  // resposta ao Status da empresa só com a mídia do Status citado
  const doStatus: [string, TipoMensagem, string][] = [
    ["statusImage", "imagem", "imageUrl"],
    ["statusVideo", "video", "videoUrl"],
    ["statusAudio", "audio", "audioUrl"],
  ];
  for (const [chave, tipo, campoUrl] of doStatus) {
    if (!tem(chave)) continue;
    return {
      tipo,
      texto: texto(lerTexto(corpo, chave, "caption")),
      midia_ref_externa:
        texto(lerTexto(corpo, chave, campoUrl)) ?? texto(lerTexto(corpo, chave, "url")),
      midia_mime: mime(lerTexto(corpo, chave, "mimeType")),
    };
  }
  return { ignorar: "tipo_nao_suportado" };
}

const PREFIXO_RESPOSTA_STATUS = "[resposta ao seu status]";

function traduzirMensagem(corpo: unknown): Evento {
  if (ler(corpo, "isNewsletter") === true) return ignorar("canal");
  if (ehGrupo(corpo)) return ignorar("grupo");
  if (
    ler(corpo, "broadcast") === true ||
    /^status@broadcast$/i.test(lerTexto(corpo, "phone") ?? "")
  ) {
    return ignorar("transmissao_ou_status");
  }
  if (ler(corpo, "waitingMessage") === true) return ignorar("mensagem_aguardando");

  const c = conteudo(corpo);
  if ("ignorar" in c) return ignorar(c.ignorar);
  // Resposta do lead ao Status da empresa: chega no chat privado dele e é mensagem de verdade
  // (só a postagem, status@broadcast, é ignorada acima).
  if (ler(corpo, "isStatusReply") === true) {
    c.texto = c.texto ? `${PREFIXO_RESPOSTA_STATUS} ${c.texto}` : PREFIXO_RESPOSTA_STATUS;
  }

  const idExterno = texto(lerTexto(corpo, "messageId"));
  if (!idExterno) return ignorar("sem_id_da_mensagem");
  const momento = momentoIso(ler(corpo, "momment"));
  if (!momento) return ignorar("sem_momento");

  const deMim = ler(corpo, "fromMe") === true;
  const ids = identificadores(corpo, deMim);
  if (ids.length === 0) return ignorar("contato_sem_identificador");

  const msg: MensagemNormalizada = { id_externo: idExterno, tipo: c.tipo, momento };
  const zaap = texto(lerTexto(corpo, "zaapId"));
  if (zaap) msg.id_gateway = zaap;
  if (c.texto) msg.texto = c.texto;
  if (c.midia_ref_externa) msg.midia_ref_externa = c.midia_ref_externa;
  if (c.midia_mime) msg.midia_mime = c.midia_mime;
  if (c.midia_nome) msg.midia_nome = c.midia_nome;
  if (ler(corpo, "isEdit") === true) msg.editada = true;
  // Citação: referenceMessageId é o messageId da mensagem respondida (tabela do ReceivedCallback
  // na v2, "Conferência" da pesquisa). Vale para o lead e para o celular da empresa (fromMe).
  const citada = texto(lerTexto(corpo, "referenceMessageId"))?.trim();
  if (citada) msg.responde_a_id_externo = citada;

  if (deMim) return { tipo: "saida_celular", ids, msg };
  const ev: Evento = { tipo: "entrada", ids, msg };
  const nome = texto(lerTexto(corpo, "senderName")) ?? texto(lerTexto(corpo, "chatName"));
  if (nome) ev.nome_whatsapp = nome;
  return ev;
}

const STATUS: Record<string, StatusGateway | null> = {
  SENT: "enviada",
  RECEIVED: "entregue",
  READ: "lida",
  PLAYED: "lida",
  READ_BY_ME: null,
};

function traduzirStatus(corpo: unknown): Evento[] {
  if (ler(corpo, "isGroup") === true) return [ignorar("grupo")];
  const bruto = (lerTexto(corpo, "status") ?? "").toUpperCase();
  const status = STATUS[bruto];
  if (status === undefined) return [ignorar("status_desconhecido")];
  if (status === null) return [ignorar("lida_por_mim")];
  // a doc atual manda "ids" (lista); a tabela da v2 lista "id" (texto)
  const ids = ler(corpo, "ids");
  const lista = Array.isArray(ids)
    ? ids.filter((i): i is string => typeof i === "string" && i !== "")
    : [];
  const unico = texto(lerTexto(corpo, "id"));
  if (lista.length === 0 && unico) lista.push(unico);
  if (lista.length === 0) return [ignorar("status_sem_ids")];
  // sem momment válido, a hora do recebimento (o status não pode se perder por isso)
  const momento = momentoIso(ler(corpo, "momment")) ?? new Date().toISOString();
  return lista.map((id) => ({ tipo: "status" as const, id, status, momento }));
}

/**
 * DeliveryCallback ("Ao enviar"): é por aqui que a Z-API avisa a falha de um envio depois de
 * aceitá-lo. A tabela da v2 garante só phone, zaapId e type: o id cai no zaapId (o
 * atualizar_status casa por id_externo ou id_gateway) e o momento, na hora do recebimento.
 */
function traduzirEntrega(corpo: unknown): Evento[] {
  const id = texto(lerTexto(corpo, "messageId")) ?? texto(lerTexto(corpo, "zaapId"));
  if (!id) return [ignorar("entrega_sem_id")];
  const momento = momentoIso(ler(corpo, "momment")) ?? new Date().toISOString();
  const falhou = ler(corpo, "error") != null && ler(corpo, "error") !== "";
  return [{ tipo: "status", id, status: falhou ? "falhou" : "enviada", momento }];
}

export function traduzirZapi(corpo: unknown): Evento[] {
  try {
    if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) {
      return [ignorar("corpo_invalido")];
    }
    const tipo = (lerTexto(corpo, "type") ?? "").toLowerCase();
    switch (tipo) {
      case "receivedcallback":
        return [traduzirMensagem(corpo)];
      case "messagestatuscallback":
        return traduzirStatus(corpo);
      case "deliverycallback":
        return traduzirEntrega(corpo);
      case "disconnectedcallback": {
        const detalhe = texto(lerTexto(corpo, "error"));
        return [
          {
            tipo: "conexao",
            status: "desconectada",
            ...(detalhe ? { detalhe: detalhe.slice(0, 200) } : {}),
          },
        ];
      }
      case "connectedcallback":
        return [
          {
            tipo: "conexao",
            status: ler(corpo, "connected") === false ? "desconectada" : "conectada",
          },
        ];
      case "presencechatcallback":
        return [ignorar("presenca")];
      default:
        return [ignorar("tipo_desconhecido")];
    }
  } catch {
    return [ignorar("corpo_invalido")];
  }
}
