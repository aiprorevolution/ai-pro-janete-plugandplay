// Tradução dos webhooks da Evolution API (modo QR code, WHATSAPP-BAILEYS) para o contrato.
// Nunca lança erro: o que não entende vira { tipo: "ignorar" }. Nenhum texto de mensagem vai
// para erro ou log. Formatos: docs/pesquisa-gateways-whatsapp.md, seção 5 (e a conferência).
import { ler, lerNumero, lerTexto } from "../../../servidor/http";
import type {
  ConexaoServidor,
  Evento,
  Identificador,
  MensagemNormalizada,
  StatusGateway,
  TipoMensagem,
} from "../../nucleo/tipos";

const ignorar = (motivo: string): Evento => ({ tipo: "ignorar", motivo });

/** "messages.upsert" e "MESSAGES_UPSERT" valem os dois. */
function nomeDoEvento(corpo: unknown): string {
  return (lerTexto(corpo, "event") ?? "").trim().toLowerCase().replace(/_/g, ".");
}

/** O data do webhook pode vir como objeto ou como lista de objetos. */
function itensDe(corpo: unknown): unknown[] {
  const data = ler(corpo, "data");
  if (Array.isArray(data)) return data;
  return data === undefined || data === null ? [] : [data];
}

function agoraIso(): string {
  return new Date().toISOString();
}

/**
 * messageTimestamp em segundos (número, texto ou {low}); sem ele, a hora do recebimento. O
 * date_time do envelope não serve: a Evolution monta a hora local com sufixo Z (channel.service,
 * `new Date(Date.now() - tzoffset).toISOString()`), e num servidor em São Paulo ele fica 3 h
 * atrás.
 */
function momentoDe(item: unknown): string {
  const bruto = ler(item, "messageTimestamp");
  const seg = lerNumero(item, "messageTimestamp") ?? lerNumero({ v: bruto }, "v", "low");
  if (seg !== undefined && seg > 0) {
    const d = new Date(seg * 1000);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return agoraIso();
}

// ---------- identificadores ----------

/** Parte antes do @ sem o sufixo de aparelho (":12") nem de agente ("_1"). */
function usuarioDoJid(jid: string): { usuario: string; servidor: string } | null {
  const i = jid.indexOf("@");
  if (i <= 0) return null;
  const usuario = jid.slice(0, i).split(":")[0]!.split("_")[0]!;
  const servidor = jid.slice(i + 1).toLowerCase();
  return usuario ? { usuario, servidor } : null;
}

function telefoneDe(jid: string | undefined): string | null {
  if (!jid) return null;
  const j = usuarioDoJid(jid);
  if (!j || j.servidor !== "s.whatsapp.net") return null;
  return /^\d{5,20}$/.test(j.usuario) ? j.usuario : null;
}

function lidDe(jid: string | undefined): string | null {
  if (!jid) return null;
  const j = usuarioDoJid(jid);
  if (!j || j.servidor !== "lid") return null;
  return /^\d{5,30}$/.test(j.usuario) ? j.usuario : null;
}

/** Telefone primeiro, depois o lid. Lista vazia = sem como identificar o contato. */
function identificadores(key: unknown): Identificador[] {
  const jid = lerTexto(key, "remoteJid");
  const alt = lerTexto(key, "remoteJidAlt");
  const ids: Identificador[] = [];
  const telefone = telefoneDe(jid) ?? telefoneDe(alt);
  const lid = lidDe(jid) ?? lidDe(alt);
  if (telefone) ids.push({ tipo: "telefone", valor: telefone });
  if (lid) ids.push({ tipo: "lid", valor: lid });
  return ids;
}

/** Motivo para ignorar o chat, ou null se é conversa com pessoa. */
function motivoChatIgnorado(jid: string | undefined): string | null {
  if (!jid) return "sem_remetente";
  const j = jid.toLowerCase();
  if (j.endsWith("@g.us")) return "grupo";
  if (j.endsWith("@broadcast")) return j.startsWith("status@") ? "status_whatsapp" : "transmissao";
  if (j.endsWith("@newsletter")) return "canal";
  return null;
}

// ---------- conteúdo ----------

const ENVOLTORIOS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
] as const;

/** Tira os envoltórios (temporária, ver uma vez, documento com legenda, editada). */
function desembrulhar(message: unknown): Record<string, unknown> | null {
  let atual = message;
  for (let i = 0; i < 6; i++) {
    if (atual === null || typeof atual !== "object") return null;
    const m = atual as Record<string, unknown>;
    const chave = ENVOLTORIOS.find((k) => ler(m, k, "message") !== undefined);
    if (!chave) return m;
    atual = ler(m, chave, "message");
  }
  return null;
}

type Conteudo = {
  tipo: TipoMensagem;
  texto?: string;
  mime?: string;
  nome?: string;
  tamanho?: number;
};

function textoNaoVazio(t: string | undefined): string | undefined {
  return t !== undefined && t.trim() !== "" ? t : undefined;
}

const CHAVES_MIDIA = [
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "ptvMessage",
  "documentMessage",
  "stickerMessage",
] as const;
/** Campos grandes ou inúteis para o download, tirados da referência gravada. */
const CAMPOS_PESADOS = new Set(["jpegThumbnail", "thumbnail", "base64", "contextInfo"]);

/**
 * Referência da mídia para o getBase64FromMediaMessage: a key e o conteúdo da mídia (sem a
 * miniatura), em JSON. Com o conteúdo no pedido, a Evolution baixa sem procurar a mensagem no
 * próprio banco, o que exige DATABASE_SAVE_DATA_NEW_MESSAGE=true no servidor.
 */
function refDaMidia(key: unknown, m: Record<string, unknown>, idMsg: string): string {
  const chave = CHAVES_MIDIA.find((k) => ler(m, k) !== undefined);
  const bruto = chave ? ler(m, chave) : undefined;
  if (!chave || bruto === null || typeof bruto !== "object") return idMsg;
  const limpo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (!CAMPOS_PESADOS.has(k)) limpo[k] = v;
  }
  const remoteJid = lerTexto(key, "remoteJid");
  return JSON.stringify({
    key: { id: idMsg, ...(remoteJid ? { remoteJid } : {}), fromMe: ler(key, "fromMe") === true },
    message: { [chave]: limpo },
  });
}

function conteudoDe(m: Record<string, unknown>): Conteudo | "reacao" | null {
  const conversa = textoNaoVazio(lerTexto(m, "conversation"));
  if (conversa) return { tipo: "texto", texto: conversa };
  const estendido = textoNaoVazio(lerTexto(m, "extendedTextMessage", "text"));
  if (estendido) return { tipo: "texto", texto: estendido };
  const botao =
    textoNaoVazio(lerTexto(m, "buttonsResponseMessage", "selectedDisplayText")) ??
    textoNaoVazio(lerTexto(m, "templateButtonReplyMessage", "selectedDisplayText")) ??
    textoNaoVazio(lerTexto(m, "listResponseMessage", "title"));
  if (botao) return { tipo: "texto", texto: botao };

  const midia = (chave: string, tipo: TipoMensagem): Conteudo | null => {
    if (ler(m, chave) === undefined) return null;
    const c: Conteudo = { tipo };
    const legenda = textoNaoVazio(lerTexto(m, chave, "caption"));
    if (legenda) c.texto = legenda;
    const mime = lerTexto(m, chave, "mimetype");
    if (mime) c.mime = mime;
    const nome = lerTexto(m, chave, "fileName") ?? lerTexto(m, chave, "title");
    if (nome) c.nome = nome;
    const tamanho = lerNumero(m, chave, "fileLength");
    if (tamanho !== undefined && tamanho >= 0) c.tamanho = tamanho;
    return c;
  };
  const achada =
    midia("imageMessage", "imagem") ??
    midia("videoMessage", "video") ??
    midia("audioMessage", "audio") ??
    midia("ptvMessage", "video") ??
    midia("documentMessage", "documento") ??
    midia("stickerMessage", "figurinha");
  if (achada) return achada;

  const lat = lerNumero(m, "locationMessage", "degreesLatitude");
  const lng = lerNumero(m, "locationMessage", "degreesLongitude");
  if (lat !== undefined && lng !== undefined) {
    const lugar = textoNaoVazio(lerTexto(m, "locationMessage", "name"));
    return { tipo: "outro", texto: `[localização${lugar ? `: ${lugar}` : ""}] ${lat}, ${lng}` };
  }
  if (ler(m, "contactMessage") !== undefined) {
    const nome = textoNaoVazio(lerTexto(m, "contactMessage", "displayName"));
    return { tipo: "outro", texto: `[contato${nome ? `: ${nome}` : ""}]` };
  }
  if (ler(m, "contactsArrayMessage") !== undefined) {
    const nome = textoNaoVazio(lerTexto(m, "contactsArrayMessage", "displayName"));
    return { tipo: "outro", texto: `[contatos${nome ? `: ${nome}` : ""}]` };
  }
  if (ler(m, "reactionMessage") !== undefined) return "reacao";
  return null;
}

/**
 * Citação: o key.id da mensagem que esta responde (o mesmo formato do nosso id_externo). A
 * Evolution repete o contextInfo do conteúdo em data.contextInfo (prepareMessage); o Baileys o
 * deixa dentro do próprio conteúdo (extendedTextMessage.contextInfo, imageMessage.contextInfo...).
 * stanzaId é o id da citada (a confirmar na doc: nome do protocolo, não visto na pesquisa).
 */
function citadaDe(item: unknown, m: Record<string, unknown>): string | undefined {
  const doTopo = textoNaoVazio(lerTexto(item, "contextInfo", "stanzaId"));
  if (doTopo) return doTopo.trim();
  for (const conteudo of Object.values(m)) {
    if (conteudo === null || typeof conteudo !== "object") continue;
    const id = textoNaoVazio(lerTexto(conteudo, "contextInfo", "stanzaId"));
    if (id) return id.trim();
  }
  return undefined;
}

/** protocolMessage: apagar (REVOKE, 0) e editar (MESSAGE_EDIT, 14). */
function protocoloDe(m: Record<string, unknown>, momento: string): MensagemNormalizada | null {
  const p = ler(m, "protocolMessage");
  if (p === undefined) return null;
  const tipo = ler(p, "type");
  const idAlvo = lerTexto(p, "key", "id");
  if (!idAlvo) return null;
  if (tipo === 0 || tipo === "REVOKE")
    return { id_externo: idAlvo, tipo: "outro", momento, apagada: true };
  if (tipo === 14 || tipo === "MESSAGE_EDIT") {
    const novo = desembrulhar(ler(p, "editedMessage"));
    const texto = novo
      ? (textoNaoVazio(lerTexto(novo, "conversation")) ??
        textoNaoVazio(lerTexto(novo, "extendedTextMessage", "text")))
      : undefined;
    const msg: MensagemNormalizada = { id_externo: idAlvo, tipo: "texto", momento, editada: true };
    if (texto) msg.texto = texto;
    return msg;
  }
  return null;
}

// ---------- mensagens (upsert e send.message) ----------

function traduzirMensagem(item: unknown, corpo: unknown, daApi: boolean): Evento {
  const key = ler(item, "key");
  const jid = lerTexto(key, "remoteJid");
  const motivo = motivoChatIgnorado(jid);
  if (motivo) return ignorar(motivo);
  const idMsg = lerTexto(key, "id");
  if (!idMsg) return ignorar("sem_id");
  const ids = identificadores(key);
  if (ids.length === 0) return ignorar("sem_identificador");

  const momento = momentoDe(item);
  const doCelular = daApi || ler(key, "fromMe") === true;
  const message = desembrulhar(ler(item, "message"));
  if (!message) return ignorar("sem_conteudo");

  let msg: MensagemNormalizada | null = protocoloDe(message, momento);
  if (!msg) {
    const c = conteudoDe(message);
    if (c === "reacao") return ignorar("reacao");
    if (!c) return ignorar("tipo_nao_suportado");
    msg = { id_externo: idMsg, tipo: c.tipo, momento };
    if (c.texto) msg.texto = c.texto;
    if (c.tipo !== "texto" && c.tipo !== "outro") {
      msg.midia_ref_externa = refDaMidia(key, message, idMsg);
      if (c.mime) msg.midia_mime = c.mime;
      if (c.nome) msg.midia_nome = c.nome;
      if (c.tamanho !== undefined) msg.midia_tamanho = c.tamanho;
    }
    // edição e exclusão (protocolMessage) apontam para a própria mensagem: sem citação
    const citada = citadaDe(item, message);
    if (citada) msg.responde_a_id_externo = citada;
  }

  if (doCelular) return { tipo: "saida_celular", ids, msg };
  const nome = textoNaoVazio(lerTexto(item, "pushName"));
  return nome ? { tipo: "entrada", ids, nome_whatsapp: nome, msg } : { tipo: "entrada", ids, msg };
}

// ---------- status ----------

const STATUS_NUMERO: Record<number, StatusGateway | null> = {
  0: "falhou",
  1: null, // PENDING: ainda não saiu
  2: "enviada",
  3: "entregue",
  4: "lida",
  5: "lida",
};
const STATUS_NOME: Record<string, StatusGateway | null> = {
  ERROR: "falhou",
  PENDING: null,
  SERVER_ACK: "enviada",
  DELIVERY_ACK: "entregue",
  READ: "lida",
  PLAYED: "lida",
};

function traduzirStatus(item: unknown, corpo: unknown): Evento {
  const id = lerTexto(item, "keyId");
  if (!id) return ignorar("sem_id");
  // Status de mensagem do lead (lida por nós) não tem o que casar.
  if (ler(item, "fromMe") === false) return ignorar("status_de_entrada");
  const bruto = ler(item, "status");
  const status =
    typeof bruto === "number"
      ? STATUS_NUMERO[bruto]
      : typeof bruto === "string"
        ? STATUS_NOME[bruto.trim().toUpperCase()]
        : undefined;
  if (status === undefined) return ignorar("status_desconhecido");
  if (status === null) return ignorar("status_pendente");
  return { tipo: "status", id, status, momento: momentoDe(item) };
}

// ---------- conexão ----------

function traduzirConexao(item: unknown): Evento {
  const estado = (lerTexto(item, "state") ?? "").toLowerCase();
  if (estado === "open") return { tipo: "conexao", status: "conectada" };
  if (estado === "close") {
    // só chega quando a Evolution não vai reconectar (logout, 401/403...): ler o QR de novo
    const razao = lerNumero(item, "statusReason");
    return {
      tipo: "conexao",
      status: "desconectada",
      ...(razao !== undefined ? { detalhe: `codigo ${razao}` } : {}),
    };
  }
  if (estado === "refused") {
    const razao = lerNumero(item, "statusReason");
    return {
      tipo: "conexao",
      status: "erro",
      ...(razao !== undefined ? { detalhe: `codigo ${razao}` } : {}),
    };
  }
  return ignorar("conexao_em_andamento");
}

// ---------- edição e exclusão ----------

/** O número da própria instância (sender do envelope), para não virar contato. */
function proprioNumero(corpo: unknown): string | null {
  return telefoneDe(lerTexto(corpo, "sender")) ?? lerTexto(corpo, "sender")?.split("@")[0] ?? null;
}

function idsSemOProprio(key: unknown, corpo: unknown): Identificador[] {
  const proprio = proprioNumero(corpo);
  return identificadores(key).filter((i) => i.valor !== proprio);
}

/**
 * messages.delete: data = {...key, status: "DELETED"} (às vezes {key}). A chave é a do Baileys,
 * do nosso ponto de vista. Só a do lead interessa: o banco não trata exclusão na saída.
 */
function traduzirExclusao(item: unknown, corpo: unknown): Evento {
  const key = ler(item, "key") ?? item;
  const jid = lerTexto(key, "remoteJid");
  const motivo = motivoChatIgnorado(jid);
  if (motivo) return ignorar(motivo);
  if (ler(key, "fromMe") === true) return ignorar("apagada_saida");
  const id = lerTexto(key, "id");
  if (!id) return ignorar("sem_id");
  const ids = idsSemOProprio(key, corpo);
  if (ids.length === 0) return ignorar("sem_identificador");
  return {
    tipo: "entrada",
    ids,
    msg: { id_externo: id, tipo: "outro", momento: agoraIso(), apagada: true },
  };
}

/**
 * messages.edited: data é o próprio protocolMessage ({key, type, editedMessage}). A key pode vir
 * do ponto de vista de quem mandou, então o remoteJid igual ao número da instância não vira
 * contato (se a original não existir, registrar_entrada criaria um contato com o nosso número).
 */
function traduzirEdicao(item: unknown, corpo: unknown): Evento {
  const key = ler(item, "key");
  const jid = lerTexto(key, "remoteJid");
  const motivo = motivoChatIgnorado(jid);
  if (motivo) return ignorar(motivo);
  if (ler(key, "fromMe") === true) return ignorar("edicao_saida");
  const msg = protocoloDe({ protocolMessage: item }, agoraIso());
  if (!msg) return ignorar("protocolo_sem_efeito");
  const ids = idsSemOProprio(key, corpo);
  if (ids.length === 0) return ignorar("edicao_sem_contato");
  return { tipo: "entrada", ids, msg };
}

// ---------- entrada pública ----------

export function traduzirEvolution(corpo: unknown, _c: ConexaoServidor): Evento[] {
  try {
    const evento = nomeDoEvento(corpo);
    const itens = itensDe(corpo);
    let eventos: Evento[];
    switch (evento) {
      case "messages.upsert":
        eventos = itens.map((i) => traduzirMensagem(i, corpo, false));
        break;
      case "send.message":
        eventos = itens.map((i) => traduzirMensagem(i, corpo, true));
        break;
      case "messages.update":
        eventos = itens.map((i) => traduzirStatus(i, corpo));
        break;
      case "connection.update":
        eventos = itens.map((i) => traduzirConexao(i));
        break;
      case "messages.delete":
        eventos = itens.map((i) => traduzirExclusao(i, corpo));
        break;
      case "messages.edited":
        eventos = itens.map((i) => traduzirEdicao(i, corpo));
        break;
      default:
        return [ignorar("evento_nao_tratado")];
    }
    return eventos.length > 0 ? eventos : [ignorar("sem_dados")];
  } catch {
    return [ignorar("corpo_invalido")];
  }
}
