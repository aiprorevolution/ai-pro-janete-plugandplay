// Tradução do webhook da Meta (WhatsApp Cloud API) para os eventos do núcleo. Nunca lança erro:
// o que não entende vira { tipo: "ignorar", motivo }. Motivos são códigos fixos, sem conteúdo.
import type { Evento, Identificador, MensagemNormalizada, TipoMensagem } from "../../nucleo/tipos";

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const lista = (v: unknown): Obj[] =>
  Array.isArray(v) ? v.map(obj).filter((o): o is Obj => o !== null) : [];
const texto = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

function soDigitos(v: unknown): string | undefined {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  const d = s.replace(/\D/g, "");
  return d.length >= 5 ? d : undefined;
}

/** Epoch em segundos (texto ou número) para ISO 8601. */
function momentoIso(v: unknown): string | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function ids(telefone: unknown, bsuid: unknown): Identificador[] {
  const r: Identificador[] = [];
  const tel = soDigitos(telefone);
  if (tel) r.push({ tipo: "telefone", valor: tel });
  const bs = texto(bsuid);
  if (bs) r.push({ tipo: "bsuid", valor: bs });
  return r;
}

const TIPOS_MIDIA: Record<string, TipoMensagem> = {
  image: "imagem",
  audio: "audio",
  video: "video",
  document: "documento",
  sticker: "figurinha",
};

type Conteudo = Pick<
  MensagemNormalizada,
  "tipo" | "texto" | "midia_ref_externa" | "midia_mime" | "midia_nome"
>;

/** Conteúdo de uma mensagem (recebida ou eco). null = tipo que não vira mensagem. */
function conteudo(m: Obj): Conteudo | null {
  const tipo = texto(m["type"]) ?? "";
  if (tipo === "text") {
    const corpo = texto(obj(m["text"])?.["body"]);
    return corpo ? { tipo: "texto", texto: corpo } : { tipo: "texto" };
  }
  const tipoMidia = TIPOS_MIDIA[tipo];
  if (tipoMidia) {
    const o = obj(m[tipo]) ?? {};
    const c: Conteudo = { tipo: tipoMidia };
    const legenda = texto(o["caption"]);
    const ref = texto(o["id"]);
    const mime = texto(o["mime_type"]);
    const nome = texto(o["filename"]);
    if (legenda) c.texto = legenda;
    if (ref) c.midia_ref_externa = ref;
    if (mime) c.midia_mime = mime;
    if (nome) c.midia_nome = nome;
    return c;
  }
  if (tipo === "location") {
    const o = obj(m["location"]) ?? {};
    const partes = [texto(o["name"]), texto(o["address"])];
    const lat = o["latitude"];
    const lng = o["longitude"];
    if (typeof lat === "number" && typeof lng === "number") partes.push(`${lat},${lng}`);
    return { tipo: "outro", texto: `[localização] ${partes.filter(Boolean).join(" ")}`.trim() };
  }
  if (tipo === "contacts") {
    const nomes = lista(m["contacts"])
      .map((c) => texto(obj(c["name"])?.["formatted_name"]))
      .filter(Boolean);
    return { tipo: "outro", texto: `[contato] ${nomes.join(", ")}`.trim() };
  }
  if (tipo === "interactive") {
    const i = obj(m["interactive"]) ?? {};
    const titulo =
      texto(obj(i["button_reply"])?.["title"]) ?? texto(obj(i["list_reply"])?.["title"]);
    return titulo ? { tipo: "texto", texto: titulo } : null;
  }
  if (tipo === "button") {
    const t = texto(obj(m["button"])?.["text"]);
    return t ? { tipo: "texto", texto: t } : null;
  }
  if (tipo === "unsupported") {
    // Edição, reação, fixar etc. chegam como "unsupported" (referência oficial do tipo): não
    // são conteúdo novo e não armam a Janete.
    const sub = texto(obj(m["unsupported"])?.["type"])?.toLowerCase();
    if (sub && SUBTIPOS_SEM_CONTEUDO.has(sub)) return null;
    return { tipo: "outro" };
  }
  return null;
}

/** Subtipos de "unsupported" que não são conteúdo novo do lead. */
const SUBTIPOS_SEM_CONTEUDO = new Set([
  "edit",
  "reaction",
  "pin",
  "keep_in_chat",
  "poll_update",
  "revoke",
]);

function motivoSemConteudo(m: Obj): string {
  if (texto(m["type"]) !== "unsupported") return "tipo_nao_suportado";
  const sub = texto(obj(m["unsupported"])?.["type"])?.toLowerCase() ?? "";
  return SUBTIPOS_SEM_CONTEUDO.has(sub) ? `sem_conteudo_${sub}` : "tipo_nao_suportado";
}

/** Mensagens de sistema que avisam troca de número ou de BSUID (previous_user_id). */
function motivoSistema(m: Obj): string {
  const t = texto(obj(m["system"])?.["type"]) ?? "";
  return t === "user_changed_number" || t === "user_changed_user_id" ? "troca_de_bsuid" : "sistema";
}

/**
 * Citação: a Meta manda context {from, id} quando a mensagem responde a outra; id é o wamid da
 * citada (pesquisa, eventos de messages; também no clique em botão). Encaminhada traz context
 * só com forwarded, sem id: não é citação. No eco (smb_message_echoes) o context segue o mesmo
 * formato do messages (a confirmar na doc).
 */
function citada(m: Obj): string | undefined {
  const id = obj(m["context"])?.["id"];
  return typeof id === "string" && id.trim() !== "" ? id.trim() : undefined;
}

function montarMsg(m: Obj, c: Conteudo, momento: string): MensagemNormalizada | null {
  const id = texto(m["id"]);
  if (!id) return null;
  const respondeA = citada(m);
  return {
    id_externo: id,
    ...c,
    momento,
    ...(respondeA && respondeA !== id ? { responde_a_id_externo: respondeA } : {}),
  };
}

const ignorar = (motivo: string): Evento => ({ tipo: "ignorar", motivo });

function ehGrupo(m: Obj): boolean {
  if (m["group_id"] !== undefined || m["recipient_type"] === "group") return true;
  const ref = [m["from"], m["to"], m["recipient_id"]].find((x) => typeof x === "string") as
    string | undefined;
  return typeof ref === "string" && ref.includes("@");
}

function acharContato(contatos: Obj[], tel: unknown, bsuid: unknown): Obj | undefined {
  const telDig = soDigitos(tel);
  return (
    contatos.find((x) => telDig !== undefined && soDigitos(x["wa_id"]) === telDig) ??
    contatos.find((x) => texto(bsuid) !== undefined && x["user_id"] === bsuid) ??
    (contatos.length === 1 ? contatos[0] : undefined)
  );
}

function mensagemRecebida(m: Obj, contatos: Obj[], saida: Evento[]): void {
  if (ehGrupo(m)) return void saida.push(ignorar("grupo"));
  const tipo = texto(m["type"]);
  if (tipo === "reaction") return void saida.push(ignorar("reacao"));
  if (tipo === "system") return void saida.push(ignorar(motivoSistema(m)));
  const c = conteudo(m);
  if (!c) return void saida.push(ignorar(motivoSemConteudo(m)));
  const momento = momentoIso(m["timestamp"]);
  if (!momento) return void saida.push(ignorar("sem_momento"));
  const contato = acharContato(contatos, m["from"], m["from_user_id"]);
  const identificadores = ids(
    m["from"] ?? contato?.["wa_id"],
    m["from_user_id"] ?? contato?.["user_id"],
  );
  if (identificadores.length === 0) return void saida.push(ignorar("sem_identificador"));
  const msg = montarMsg(m, c, momento);
  if (!msg) return void saida.push(ignorar("sem_id"));
  const nome = texto(obj(contato?.["profile"])?.["name"]);
  saida.push({
    tipo: "entrada",
    ids: identificadores,
    ...(nome ? { nome_whatsapp: nome } : {}),
    msg,
  });
}

function eco(m: Obj, saida: Evento[]): void {
  if (ehGrupo(m)) return void saida.push(ignorar("grupo"));
  if (texto(m["type"]) === "reaction") return void saida.push(ignorar("reacao"));
  const c = conteudo(m);
  if (!c) return void saida.push(ignorar(motivoSemConteudo(m)));
  const momento = momentoIso(m["timestamp"]);
  if (!momento) return void saida.push(ignorar("sem_momento"));
  const identificadores = ids(
    m["to"] ?? m["recipient_id"],
    m["to_user_id"] ?? m["recipient_user_id"],
  );
  if (identificadores.length === 0) return void saida.push(ignorar("sem_identificador"));
  const msg = montarMsg(m, c, momento);
  if (!msg) return void saida.push(ignorar("sem_id"));
  saida.push({ tipo: "saida_celular", ids: identificadores, msg });
}

const STATUS: Record<string, "enviada" | "entregue" | "lida" | "falhou"> = {
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  played: "lida",
  failed: "falhou",
};

function status(s: Obj, saida: Evento[]): void {
  if (ehGrupo(s)) return void saida.push(ignorar("grupo"));
  const id = texto(s["id"]);
  const mapeado = STATUS[texto(s["status"]) ?? ""];
  const momento = momentoIso(s["timestamp"]);
  if (!id || !mapeado || !momento) return void saida.push(ignorar("status_desconhecido"));
  saida.push({ tipo: "status", id, status: mapeado, momento });
}

// account_update (referência oficial): DISABLED_UPDATE só desconecta com
// ban_info.waba_ban_state = DISABLE (REINSTATE é a conta reativada; SCHEDULE_FOR_DISABLE é só
// agendado). ACCOUNT_RECONNECTED volta a conectada.
const EVENTOS_DESCONECTA = new Set(["PARTNER_REMOVED", "ACCOUNT_DELETED", "ACCOUNT_OFFBOARDED"]);
const EVENTOS_CONECTA = new Set(["ACCOUNT_RECONNECTED"]);

function conta(valor: Obj, idEntrada: string | undefined, waba: string | undefined): Evento {
  // account_update não traz phone_number_id: sem conferir a WABA, o evento de outra conta do
  // mesmo app mudaria esta conexão.
  if (waba && idEntrada && idEntrada !== waba) return ignorar("outra_waba");
  const evento = texto(valor["event"]) ?? "";
  if (EVENTOS_DESCONECTA.has(evento)) {
    return { tipo: "conexao", status: "desconectada", detalhe: evento };
  }
  if (EVENTOS_CONECTA.has(evento)) return { tipo: "conexao", status: "conectada" };
  if (evento === "DISABLED_UPDATE") {
    const estado = texto(obj(valor["ban_info"])?.["waba_ban_state"]) ?? "";
    if (estado === "DISABLE") return { tipo: "conexao", status: "desconectada", detalhe: evento };
    if (estado === "REINSTATE") return { tipo: "conexao", status: "conectada" };
  }
  return ignorar("conta_sem_efeito");
}

function mudanca(
  campo: string,
  valor: Obj,
  numero: string,
  idEntrada: string | undefined,
  waba: string | undefined,
  saida: Evento[],
): void {
  const meta = obj(valor["metadata"]);
  const phoneId = texto(meta?.["phone_number_id"]);
  if (campo === "account_update") return void saida.push(conta(valor, idEntrada, waba));
  if (phoneId && phoneId !== numero) return void saida.push(ignorar("outro_numero"));

  if (campo === "messages") {
    const contatos = lista(valor["contacts"]);
    for (const m of lista(valor["messages"])) mensagemRecebida(m, contatos, saida);
    for (const s of lista(valor["statuses"])) status(s, saida);
    // Erro de sistema no campo messages não diz nada sobre a conexão: só fica registrado.
    const erros = lista(valor["errors"]);
    if (erros.length > 0) {
      const codigo = erros.map((e) => e["code"]).find((x) => typeof x === "number");
      saida.push(ignorar(`erro_sistema_${String(codigo ?? "desconhecido")}`));
    }
    return;
  }
  if (campo === "smb_message_echoes") {
    for (const m of lista(valor["message_echoes"])) eco(m, saida);
    return;
  }
  saida.push(ignorar(`campo_${campo.replace(/[^a-z_]/gi, "").slice(0, 40) || "vazio"}`));
}

/** Traduz um corpo inteiro (vários entry/changes/messages/statuses). */
export function traduzirMeta(corpo: unknown, numero: string, waba?: string): Evento[] {
  try {
    const raiz = obj(corpo);
    if (!raiz || raiz["object"] !== "whatsapp_business_account")
      return [ignorar("corpo_desconhecido")];
    const saida: Evento[] = [];
    for (const entrada of lista(raiz["entry"])) {
      const idEntrada = texto(entrada["id"]);
      for (const ch of lista(entrada["changes"])) {
        const valor = obj(ch["value"]);
        const campo = texto(ch["field"]);
        if (!valor || !campo) {
          saida.push(ignorar("mudanca_invalida"));
          continue;
        }
        mudanca(campo, valor, numero, idEntrada, waba, saida);
      }
    }
    return saida.length > 0 ? saida : [ignorar("sem_eventos")];
  } catch {
    return [ignorar("corpo_invalido")];
  }
}
