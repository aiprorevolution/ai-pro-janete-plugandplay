// Tradução dos webhooks da Zernio (docs.zernio.com/webhooks/inbox) para os Eventos do núcleo.
// Nunca lança erro e nunca põe texto de mensagem em motivo ou detalhe.
import { ler, lerTexto } from "../../../servidor/http";
import type {
  ConexaoServidor,
  Evento,
  Identificador,
  MensagemNormalizada,
  StatusGateway,
  TipoMensagem,
} from "../../nucleo/tipos";

export const BASE_ZERNIO = "https://zernio.com/api/v1";

const TIPO_ANEXO: Record<string, TipoMensagem> = {
  image: "imagem",
  video: "video",
  audio: "audio",
  file: "documento",
  sticker: "figurinha",
};

const STATUS: Record<string, StatusGateway> = {
  "message.delivered": "entregue",
  "message.read": "lida",
  "message.failed": "falhou",
};

const ignorar = (motivo: string): Evento[] => [{ tipo: "ignorar", motivo }];

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Data em ISO 8601; devolve undefined se não for uma data válida. */
function iso(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const SO_DIGITOS = /^\d{8,15}$/;
/** Mensagem recebida já lida e com mais disso de atraso no webhook = histórico importado. */
const JANELA_HISTORICO_MS = 10 * 60_000;
const FORMATO_BSUID = /^[A-Za-z]{2}\.[\w.-]+$/;

function digitos(v: unknown): string | undefined {
  const t = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return SO_DIGITOS.test(t) ? t : undefined;
}

function acrescentar(ids: Identificador[], tipo: Identificador["tipo"], valor: string | undefined) {
  if (valor && !ids.some((i) => i.tipo === tipo && i.valor === valor)) ids.push({ tipo, valor });
}

/** Classifica um id solto: só dígitos é telefone; "BR.123..." é bsuid. */
function classificar(ids: Identificador[], bruto: unknown) {
  const t = texto(bruto)?.trim();
  if (!t) return;
  if (SO_DIGITOS.test(t.replace(/^\+/, ""))) acrescentar(ids, "telefone", t.replace(/^\+/, ""));
  else if (FORMATO_BSUID.test(t)) acrescentar(ids, "bsuid", t);
}

function ehGrupo(corpo: unknown): boolean {
  const alvos = [
    lerTexto(corpo, "conversation", "participantId"),
    lerTexto(corpo, "message", "sender", "id"),
  ];
  if (alvos.some((a) => a !== undefined && /@(g\.us|broadcast)$|^status$/i.test(a))) return true;
  if (temGroupId(corpo)) return true;
  const marcas = [
    ler(corpo, "conversation", "isGroup"),
    ler(corpo, "message", "isGroup"),
    ler(corpo, "metadata", "isGroup"),
  ];
  if (marcas.some((m) => m === true)) return true;
  const tipo = lerTexto(corpo, "conversation", "type") ?? lerTexto(corpo, "conversation", "kind");
  return tipo !== undefined && /group|broadcast/i.test(tipo);
}

/**
 * Defesa que não depende de campo não documentado: no 1:1, o participante da conversa é o
 * próprio remetente (telefone ou BSUID). Num grupo, cada participante manda na mesma conversa,
 * então o remetente difere do participantId.
 */
function remetenteDiferenteDoParticipante(corpo: unknown): boolean {
  const participante = texto(ler(corpo, "conversation", "participantId"))?.trim();
  const remetente = texto(ler(corpo, "message", "sender", "id"))?.trim();
  if (!participante || !remetente) return false;
  const norm = (v: string) => (/^\+?\d+$/.test(v) ? v.replace(/^\+/, "") : v);
  const doRemetente = [
    remetente,
    texto(ler(corpo, "message", "sender", "phoneNumber")),
    texto(ler(corpo, "message", "sender", "businessScopedUserId")),
  ]
    .filter((v): v is string => v !== undefined)
    .map((v) => norm(v.trim()));
  return !doRemetente.includes(norm(participante));
}

function temGroupId(corpo: unknown): boolean {
  return [
    ler(corpo, "message", "groupId"),
    ler(corpo, "conversation", "groupId"),
    ler(corpo, "metadata", "groupId"),
  ].some((v) => texto(v) !== undefined);
}

function idConversa(corpo: unknown): string | undefined {
  return texto(ler(corpo, "conversation", "id")) ?? texto(ler(corpo, "message", "conversationId"));
}

/** Identificadores do contato. Na entrada vêm do remetente; na saída, do participante. */
function identificadores(corpo: unknown, entrada: boolean): Identificador[] {
  const ids: Identificador[] = [];
  if (entrada) {
    acrescentar(ids, "telefone", digitos(ler(corpo, "message", "sender", "phoneNumber")));
    classificar(ids, ler(corpo, "message", "sender", "id"));
  }
  classificar(ids, ler(corpo, "conversation", "participantId"));
  if (entrada) {
    acrescentar(ids, "bsuid", texto(ler(corpo, "message", "sender", "businessScopedUserId")));
  }
  acrescentar(ids, "zernio_conversa", idConversa(corpo));
  // telefone primeiro, depois bsuid, depois a conversa
  const ordem = { telefone: 0, bsuid: 1, lid: 2, zernio_conversa: 3 } as const;
  return ids.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]);
}

function descreverLocalizacao(loc: Record<string, unknown>): string {
  const nome = texto(loc["name"]);
  const endereco = texto(loc["address"]);
  const lat = loc["latitude"];
  const lng = loc["longitude"];
  const coord = typeof lat === "number" && typeof lng === "number" ? `${lat}, ${lng}` : undefined;
  return ["[localização]", nome, endereco, coord].filter(Boolean).join(" · ");
}

function nomeDeContato(c: unknown): string | undefined {
  const o = objeto(c);
  if (!o) return undefined;
  const n = o["name"];
  if (typeof n === "string") return texto(n);
  return (
    texto(ler(n, "formatted_name")) ?? texto(ler(n, "formattedName")) ?? texto(ler(n, "first_name"))
  );
}

/** Referência para baixar a mídia: a url do anexo, ou o mediaId quando a url faltar. */
function refDoAnexo(anexo: Record<string, unknown>): string | undefined {
  const url = texto(anexo["url"]);
  if (url) return url;
  const id = texto(ler(anexo, "payload", "id"));
  return id;
}

/**
 * Onde a Zernio pode trazer a mensagem citada. No envio o campo é replyTo (confirmado); no
 * webhook a doc não publica o campo (a confirmar na doc), então tentamos, em ordem, os nomes
 * mais prováveis. O wamid (platformMessageId) vem antes do id solto, porque é ele que fica em
 * id_externo; o contexto da Meta (context.id) cobre o caso de a Zernio repassar o original.
 */
const CAMINHOS_CITACAO: readonly (readonly string[])[] = [
  ["message", "replyTo"],
  ["message", "replyTo", "platformMessageId"],
  ["message", "replyTo", "messageId"],
  ["message", "replyTo", "id"],
  ["message", "replyToMessageId"],
  ["message", "replyToPlatformMessageId"],
  ["message", "context", "id"],
  ["message", "context", "message_id"],
  ["message", "metadata", "replyTo"],
  ["message", "metadata", "context", "id"],
  ["metadata", "replyTo"],
  ["metadata", "replyToMessageId"],
  ["metadata", "context", "id"],
];

/** id_externo da mensagem citada, aparado; undefined se não houver citação. */
function idCitado(corpo: unknown, proprios: (string | undefined)[]): string | undefined {
  for (const caminho of CAMINHOS_CITACAO) {
    const v = texto(ler(corpo, ...caminho))?.trim();
    // a própria mensagem nunca é a citada
    if (v && !proprios.includes(v)) return v;
  }
  return undefined;
}

function montarMensagem(corpo: unknown, momento: string): MensagemNormalizada | null {
  const m = objeto(ler(corpo, "message"));
  if (!m) return null;
  const idGateway = texto(m["id"]);
  const idExterno = texto(m["platformMessageId"]) ?? idGateway;
  if (!idExterno) return null;
  const msg: MensagemNormalizada = { id_externo: idExterno, tipo: "texto", momento };
  if (idGateway) msg.id_gateway = idGateway;
  // citação: vale para a entrada do lead e para o eco do celular (message.sent)
  const citada = idCitado(corpo, [idExterno, idGateway]);
  if (citada) msg.responde_a_id_externo = citada;
  const legenda = texto(m["text"]);

  const anexos = Array.isArray(m["attachments"]) ? m["attachments"] : [];
  const anexo = objeto(anexos[0]);
  const localizacao = objeto(ler(corpo, "metadata", "location"));
  const contatos = ler(corpo, "metadata", "contacts");

  if (anexo) {
    const tipoAnexo = texto(anexo["type"]) ?? "";
    msg.tipo = TIPO_ANEXO[tipoAnexo] ?? "outro";
    if (legenda) msg.texto = legenda;
    const ref = refDoAnexo(anexo);
    if (ref) msg.midia_ref_externa = ref;
    const mime = texto(anexo["mimeType"]);
    if (mime) msg.midia_mime = mime;
    const nome =
      texto(anexo["filename"]) ?? texto(anexo["name"]) ?? texto(ler(anexo, "payload", "filename"));
    if (nome) msg.midia_nome = nome;
    const tamanho = ler(anexo, "size") ?? ler(anexo, "payload", "fileSize");
    if (typeof tamanho === "number" && tamanho >= 0) msg.midia_tamanho = tamanho;
  } else if (localizacao) {
    msg.tipo = "outro";
    msg.texto = descreverLocalizacao(localizacao);
  } else if (Array.isArray(contatos) && contatos.length > 0) {
    msg.tipo = "outro";
    const nomes = contatos.map(nomeDeContato).filter(Boolean).join(", ");
    msg.texto = nomes ? `[contato] ${nomes}` : "[contato]";
  } else if (legenda) {
    msg.texto = legenda;
  } else {
    return null;
  }
  return msg;
}

export function traduzirZernio(corpo: unknown, c: ConexaoServidor): Evento[] {
  try {
    return traduzirSolto(corpo, c);
  } catch {
    return ignorar("corpo_ilegivel");
  }
}

function traduzirSolto(corpo: unknown, c: ConexaoServidor): Evento[] {
  if (!objeto(corpo)) return ignorar("corpo_invalido");
  const evento = lerTexto(corpo, "event");
  if (!evento) return ignorar("sem_evento");

  // um webhook da Zernio pode atender várias contas: só vale a da nossa conexão (todo evento
  // message.* e account.* traz account.accountId; sem ele, não dá para saber de quem é)
  const conta = lerTexto(corpo, "account", "accountId");
  if (conta === undefined && /^(message|account)\./.test(evento)) return ignorar("sem_conta");
  if (conta !== undefined && c.id_externo && conta !== c.id_externo) return ignorar("outra_conta");

  if (evento === "account.connected") return [{ tipo: "conexao", status: "conectada" }];
  if (evento === "account.disconnected") return [{ tipo: "conexao", status: "desconectada" }];

  const ehMensagem =
    evento === "message.received" ||
    evento === "message.sent" ||
    evento === "message.edited" ||
    evento === "message.deleted" ||
    Object.hasOwn(STATUS, evento);
  if (!ehMensagem) return ignorar("evento_sem_tratamento");

  const plataforma = lerTexto(corpo, "message", "platform");
  if (plataforma !== undefined && plataforma !== "whatsapp") return ignorar("outra_plataforma");
  if (ehGrupo(corpo)) return ignorar("grupo_ou_transmissao");

  const momentoEnvelope = iso(ler(corpo, "timestamp"));

  if (Object.hasOwn(STATUS, evento)) {
    // o wamid (platformMessageId) é o que fica gravado: no envio, como id_externo; no eco,
    // também. O message.id interno da Zernio não é guardado em lugar nenhum.
    const id =
      texto(ler(corpo, "message", "platformMessageId")) ?? texto(ler(corpo, "message", "id"));
    const momento = iso(ler(corpo, "statusAt")) ?? momentoEnvelope;
    if (!id || !momento) return ignorar("status_incompleto");
    return [{ tipo: "status", id, status: STATUS[evento]!, momento }];
  }

  if (evento === "message.received") {
    if (lerTexto(corpo, "message", "direction") === "outgoing")
      return ignorar("direcao_inesperada");
    if (ler(corpo, "metadata", "standby") === true) return ignorar("conversa_com_outro_app");
    if (remetenteDiferenteDoParticipante(corpo)) return ignorar("grupo_ou_transmissao");
    const enviadaEm = iso(ler(corpo, "message", "sentAt"));
    // Histórico importado ao conectar (coexistência) chega como já lido (isRead) e antigo:
    // não arma a Janete para conversas que um humano já resolveu.
    if (
      ler(corpo, "message", "isRead") === true &&
      enviadaEm &&
      momentoEnvelope &&
      Date.parse(momentoEnvelope) - Date.parse(enviadaEm) > JANELA_HISTORICO_MS
    ) {
      return ignorar("historico");
    }
    return montarEntrada(corpo, "entrada", enviadaEm ?? momentoEnvelope);
  }

  if (evento === "message.sent") {
    return montarEntrada(
      corpo,
      "saida_celular",
      iso(ler(corpo, "message", "sentAt")) ?? momentoEnvelope,
    );
  }

  // message.edited e message.deleted: o banco só trata edição e apagamento na entrada. Na
  // saída, a mensagem não achada pelo id viraria humano_celular nova. E só o wamid casa com a
  // original (gravada pelo platformMessageId).
  const saida = lerTexto(corpo, "message", "direction") === "outgoing";
  const apagada = evento === "message.deleted";
  if (saida) return ignorar(apagada ? "apagada_saida" : "edicao_saida");
  if (!texto(ler(corpo, "message", "platformMessageId"))) return ignorar("sem_id_plataforma");
  const momento =
    iso(ler(corpo, "message", "sentAt")) ??
    iso(ler(corpo, apagada ? "deletedAt" : "editedAt")) ??
    momentoEnvelope;
  const r = montarEntrada(corpo, "entrada", momento, apagada);
  for (const ev of r) {
    if (ev.tipo !== "entrada") continue;
    if (apagada) ev.msg.apagada = true;
    else ev.msg.editada = true;
  }
  return r;
}

function montarEntrada(
  corpo: unknown,
  tipo: "entrada" | "saida_celular",
  momento: string | undefined,
  apagada = false,
): Evento[] {
  if (!momento) return ignorar("sem_data");
  const ids = identificadores(corpo, tipo === "entrada");
  if (ids.length === 0) return ignorar("sem_contato");
  let msg = montarMensagem(corpo, momento);
  if (!msg && apagada) {
    // apagada sem conteúdo: só o id importa
    const id =
      texto(ler(corpo, "message", "platformMessageId")) ?? texto(ler(corpo, "message", "id"));
    if (id) msg = { id_externo: id, tipo: "outro", momento };
    const g = texto(ler(corpo, "message", "id"));
    if (msg && g) msg.id_gateway = g;
  }
  if (!msg) return ignorar("sem_conteudo");
  if (tipo === "saida_celular") return [{ tipo, ids, msg }];
  const nome =
    texto(ler(corpo, "message", "sender", "name")) ??
    texto(ler(corpo, "conversation", "participantName"));
  const ev: Evento = { tipo, ids, msg };
  if (nome) ev.nome_whatsapp = nome;
  return [ev];
}
