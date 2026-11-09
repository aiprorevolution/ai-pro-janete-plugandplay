// Adaptador da Zernio (zernio.com, antiga Late): API REST por cima da Cloud API da Meta.
// Webhook assinado com HMAC-SHA256 (X-Zernio-Signature), envio por conversationId, mídia
// recebida com Bearer. Pesquisa: docs/pesquisa-gateways-whatsapp.md, seção 2.
import {
  abrirPrazo,
  FalhaDeRede,
  ler,
  lerTexto,
  pedir,
  TempoEsgotado,
  type Prazo,
  type RespostaHttp,
} from "../../../servidor/http";
import {
  ERRO_ENVIO_INCERTO,
  ErroGateway,
  type AdaptadorGateway,
  type ConexaoServidor,
  type Identificador,
  type PedidoEnvio,
} from "../../nucleo/tipos";
import { tempoAte, tempoEnvio } from "../../nucleo/prazo";
import { CODIGOS_TRANSITORIOS } from "../meta/api";
import { BASE_ZERNIO, traduzirZernio } from "./traduzir";

const PRAZO_CHAMADA_MS = 15_000;
const PRAZO_MIDIA_MS = 30_000;
/** Teto do download: o arquivo inteiro vai para a memória do Worker (cerca de 128 MB). */
export const MAX_BYTES_MIDIA = 25 * 1024 * 1024;

export const EVENTOS_WEBHOOK = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
  "message.edited",
  "message.deleted",
  "account.connected",
  "account.disconnected",
] as const;

const TIPO_ANEXO = { imagem: "image", audio: "audio", documento: "file" } as const;

// ---------- erros ----------

/**
 * 4xx é definitivo, menos 408, 409 (Idempotency-Key ainda em andamento) e 429; 5xx e o resto
 * não.
 */
function definitivoPorStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

/** Código da Meta no corpo do erro (code, error.code ou platformError.code). */
function codigoDaPlataforma(corpo: unknown): number | undefined {
  for (const v of [
    ler(corpo, "platformError", "code"),
    ler(corpo, "error", "code"),
    ler(corpo, "code"),
    ler(corpo, "error", "platformError", "code"),
  ]) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

function erroDeStatus(status: number, corpo?: unknown): ErroGateway {
  // 131056 (limite por destinatário), 130429 e 80007 chegam como 400 e pedem espera
  const cod = codigoDaPlataforma(corpo);
  if (status >= 400 && status < 500 && cod !== undefined && CODIGOS_TRANSITORIOS.has(cod)) {
    return new ErroGateway(cod === 131056 ? "limite_destinatario" : `limite_meta_${cod}`, false);
  }
  const codigo = status === 429 ? "limite_de_chamadas" : `zernio_http_${status}`;
  return new ErroGateway(codigo, definitivoPorStatus(status));
}

/**
 * Códigos que só saem de uma resposta de erro da Zernio (erroDeStatus): sem 2xx, ela não guardou a
 * Idempotency-Key. 409 fica de fora: quer dizer que um pedido com a mesma chave ainda estava em
 * andamento, e ele pode ter sido aceito.
 */
const RESPOSTA_DE_ERRO_DA_ZERNIO =
  /^(zernio_http_(?!409$)\d{3}|limite_de_chamadas|limite_destinatario|limite_meta_\d+)$/;

/**
 * A tentativa anterior pode ter sido aceita (e a chave guardada)? Só não quando o erro que ela
 * deixou prova que a Zernio respondeu com erro. Sem erro anterior (o concluir_envio que falhou
 * depois de um 2xx), tempo esgotado, rede, "sem_tempo" ou erro interno (que apagam o erro de
 * antes): pode, e o 422 continua incerto.
 */
function anteriorPodeTerSaido(p: PedidoEnvio): boolean {
  const anterior = p.erroAnterior?.trim() ?? "";
  return !RESPOSTA_DE_ERRO_DA_ZERNIO.test(anterior);
}

function erroDeRede(e: unknown): ErroGateway {
  if (e instanceof TempoEsgotado) return new ErroGateway("tempo_esgotado", false);
  if (e instanceof ErroGateway) return e;
  return new ErroGateway("falha_de_rede", false);
}

// ---------- webhooks ----------

/** Itens da lista de GET /webhooks/settings (array solto, em "webhooks" ou em "data"). */
function itensDaLista(corpo: unknown): unknown[] {
  const bruto = Array.isArray(corpo) ? corpo : (ler(corpo, "webhooks") ?? ler(corpo, "data"));
  return Array.isArray(bruto) ? bruto : [];
}

function idDoWebhook(i: unknown): string | undefined {
  return lerTexto(i, "webhookId") ?? lerTexto(i, "_id") ?? lerTexto(i, "id");
}

/** Webhook nosso: a mesma url (quando se sabe), o caminho do nosso webhook da Zernio ou o nome "Janete ...". */
function ehWebhookNosso(i: unknown, url?: string): boolean {
  const u = lerTexto(i, "url") ?? "";
  return (
    (url !== undefined && u === url) ||
    u.includes("/api/public/whatsapp/zernio/") ||
    /^Janete /.test(lerTexto(i, "name") ?? "")
  );
}

/**
 * Webhook desta conexão, para desligar: a url com o caminho /api/public/whatsapp/zernio/<id da
 * conexão> ou o nome exato "Janete <8 letras do id>". Se o item traz accountIds, precisa ter a conta
 * desta conexão. Mais estrito que o ehWebhookNosso: a mesma chave da Zernio pode servir outra
 * cópia da Janete (remix com o mesmo número) ou outro cliente, e esses não podem ser desligados.
 */
function ehWebhookDestaConexao(i: unknown, c: ConexaoServidor): boolean {
  const caminho = (lerTexto(i, "url") ?? "").split(/[?#]/)[0]!.replace(/\/+$/, "");
  const peloEndereco = caminho.endsWith(`/api/public/whatsapp/zernio/${c.id}`);
  const peloNome = lerTexto(i, "name") === `Janete ${c.id.slice(0, 8)}`;
  if (!peloEndereco && !peloNome) return false;
  const contas = ler(i, "accountIds");
  return !Array.isArray(contas) || contas.length === 0 || contas.includes(c.id_externo);
}

/**
 * Webhook de outra conexão (o caminho /api/public/whatsapp/zernio/<outro id> ou o nome "Janete <8
 * letras de outro id>"), que o configurarWebhook não reaproveita. No Trocar entre duas contas da
 * mesma chave, o desligar da anterior pode terminar depois do teto (ele não é cancelado) e
 * desligaria a entrada que a nova acabou de ligar. Sem reaproveitar, cada conexão tem a sua.
 */
function ehWebhookDeOutraConexao(i: unknown, c: ConexaoServidor): boolean {
  const caminho = (lerTexto(i, "url") ?? "").split(/[?#]/)[0]!.replace(/\/+$/, "");
  const doCaminho = /\/api\/public\/whatsapp\/zernio\/([^/]+)$/.exec(caminho)?.[1];
  if (doCaminho !== undefined) return doCaminho !== c.id;
  const doNome = /^Janete ([0-9a-f]{8})$/i.exec(lerTexto(i, "name") ?? "")?.[1];
  return doNome !== undefined && doNome.toLowerCase() !== c.id.slice(0, 8).toLowerCase();
}

// ---------- chamadas ----------

function cabecalhos(c: ConexaoServidor, json: boolean): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${c.segredos["apiKey"] ?? ""}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function chamar(
  c: ConexaoServidor,
  metodo: "GET" | "POST" | "PUT",
  caminho: string,
  corpo?: unknown,
  extras: Record<string, string> = {},
  prazoMs: number = PRAZO_CHAMADA_MS,
): Promise<RespostaHttp> {
  const prazo: Prazo = abrirPrazo(prazoMs);
  try {
    const init: RequestInit = {
      method: metodo,
      headers: { ...cabecalhos(c, corpo !== undefined), ...extras },
    };
    if (corpo !== undefined) init.body = JSON.stringify(corpo);
    return await pedir(undefined, prazo, `${BASE_ZERNIO}${caminho}`, init, [
      c.segredos["apiKey"] ?? "",
    ]);
  } catch (e) {
    throw erroDeRede(e);
  } finally {
    prazo.encerrar();
  }
}

function conversaDe(destino: Identificador[]): string | undefined {
  return destino.find((d) => d.tipo === "zernio_conversa" && d.valor.trim() !== "")?.valor;
}

/**
 * URL do download e se ela leva o Bearer. O Bearer só vai para a Zernio; outra URL https (no
 * message.sent, o anexo traz a URL que nós ou o painel mandamos) é baixada sem ele. http ou
 * URL inválida: erro definitivo.
 */
function enderecoMidia(ref: string, c: ConexaoServidor): { url: string; comChave: boolean } {
  if (/^https?:\/\//i.test(ref)) {
    let host = "";
    try {
      host = new URL(ref).hostname.toLowerCase();
    } catch {
      host = "";
    }
    if (!/^https:\/\//i.test(ref) || !host) throw new ErroGateway("midia_url_invalida", true);
    const daZernio =
      host === "zernio.com" ||
      host.endsWith(".zernio.com") ||
      host === "getlate.dev" ||
      host.endsWith(".getlate.dev");
    return { url: ref, comChave: daZernio };
  }
  return {
    url: `${BASE_ZERNIO}/whatsapp/media/${encodeURIComponent(ref)}?accountId=${encodeURIComponent(c.id_externo)}`,
    comChave: true,
  };
}

// ---------- assinatura ----------

async function hmacHex(segredo: string, corpo: string): Promise<string> {
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    "raw",
    enc.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = new Uint8Array(await crypto.subtle.sign("HMAC", chave, enc.encode(corpo)));
  return Array.from(assinatura, (b) => b.toString(16).padStart(2, "0")).join("");
}

function iguais(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i]! ^ y[i]!;
  return dif === 0;
}

// ---------- adaptador ----------

export const adaptadorZernio: AdaptadorGateway = {
  gateway: "zernio",

  async validarWebhook(req, corpoCru, c) {
    try {
      const segredo = c.segredos["webhookSecret"];
      if (!segredo) return false;
      const recebido = req.headers.get("x-zernio-signature") ?? req.headers.get("x-late-signature");
      if (!recebido) return false;
      const limpo = recebido
        .trim()
        .toLowerCase()
        .replace(/^sha256=/, "");
      return iguais(await hmacHex(segredo, corpoCru), limpo);
    } catch {
      return false;
    }
  },

  idEvento(req, corpo) {
    // o id do corpo é coberto pelo HMAC; o cabeçalho, não
    const id =
      lerTexto(corpo, "id") ??
      req.headers.get("x-zernio-event-id") ??
      req.headers.get("x-late-event-id");
    return id && id.trim() !== "" ? id.trim() : null;
  },

  traduzir(corpo, c) {
    return traduzirZernio(corpo, c);
  },

  async baixarMidia(ref, c, opcoes) {
    const { url, comChave } = enderecoMidia(ref, c);
    const prazo = abrirPrazo(tempoAte(PRAZO_MIDIA_MS, opcoes?.fimEm));
    try {
      // fetch próprio porque o pedir() devolve texto e aqui precisamos dos bytes
      let r: Response;
      try {
        r = await fetch(url, {
          method: "GET",
          headers: comChave ? cabecalhos(c, false) : {},
          redirect: "manual",
          signal: prazo.sinal,
        });
      } catch {
        throw prazo.sinal.aborted ? new TempoEsgotado() : new FalhaDeRede();
      }
      if (r.status < 200 || r.status >= 300) {
        // 400 depois de cerca de 7 dias quer dizer mídia descartada pela Meta, sem volta
        if (r.status === 400 || r.status === 404 || r.status === 410) {
          throw new ErroGateway("midia_expirada", true);
        }
        throw erroDeStatus(r.status);
      }
      // grande demais é definitivo: não adianta tentar de novo (o ciclo desiste da mídia)
      const tamanho = Number(r.headers.get("content-length") ?? NaN);
      if (Number.isFinite(tamanho) && tamanho > MAX_BYTES_MIDIA) {
        throw new ErroGateway("midia_grande_demais", true);
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await r.arrayBuffer());
      } catch {
        throw prazo.sinal.aborted ? new TempoEsgotado() : new FalhaDeRede();
      }
      if (bytes.byteLength > MAX_BYTES_MIDIA) throw new ErroGateway("midia_grande_demais", true);
      const mime =
        (r.headers.get("content-type") ?? "").split(";")[0]!.trim() || "application/octet-stream";
      return { bytes, mime };
    } catch (e) {
      throw erroDeRede(e);
    } finally {
      prazo.encerrar();
    }
  },

  async enviar(p: PedidoEnvio, c, opcoes) {
    const conversa = conversaDe(p.destino);
    // sem conversa da Zernio só dá para abrir uma nova com template, o que a Janete não faz
    if (!conversa) throw new ErroGateway("sem_conversa_zernio", true);
    const corpo: Record<string, unknown> = { accountId: c.id_externo };
    if (p.tipo === "texto") {
      if (!p.texto?.trim()) throw new ErroGateway("pedido_invalido", true);
      corpo["message"] = p.texto;
    } else {
      if (!p.midia?.url) throw new ErroGateway("pedido_invalido", true);
      corpo["attachmentUrl"] = p.midia.url;
      corpo["attachmentType"] = TIPO_ANEXO[p.tipo];
      if (p.tipo === "documento" && p.midia.nome) corpo["attachmentName"] = p.midia.nome;
      if (p.tipo === "audio" && /ogg|opus/i.test(p.midia.mime)) corpo["voiceNote"] = true;
      // o áudio sai como nota de voz, sem legenda (como nos outros 3 gateways)
      if (p.tipo !== "audio" && p.texto?.trim()) corpo["message"] = p.texto;
    }
    // Citação: replyTo leva o wamid da mensagem citada (docs.zernio.com/messages/send-inbox-message),
    // o mesmo id_externo que o tradutor grava. Vale para texto e mídia.
    const citada = p.respondeA?.trim();
    if (citada) corpo["replyTo"] = citada;
    // Idempotency-Key (24 h): o reenvio depois de tempo esgotado ou 5xx não duplica no lead
    const extras: Record<string, string> = p.chave ? { "Idempotency-Key": p.chave } : {};
    const r = await chamar(
      c,
      "POST",
      `/inbox/conversations/${encodeURIComponent(conversa)}/messages`,
      corpo,
      extras,
      // teto do envio (10 s texto, 20 s mídia), não o das outras chamadas
      tempoEnvio(p.tipo, opcoes?.fimEm),
    );
    // 422 com a Idempotency-Key depois da 1ª tentativa: a Zernio só guarda a chave depois de um
    // 2xx (pesquisa, seção 2) e responde 422 quando ela volta com outro corpo (o replyTo foi
    // numa tentativa e não na outra). Ou seja, a mensagem pode já ter chegado ao lead: o ciclo
    // deixa "enviando" e decide pelo eco (message.sent), em vez de marcar "falhou".
    // Exceção: se a tentativa anterior terminou numa resposta de erro da própria Zernio
    // (zernio_http_5xx, limite...), ela não guardou a chave, e o 422 é recusa comum (validação).
    // Tratá-lo como incerto deixaria a mensagem "enviando" 2 min por tentativa, travando a fila da
    // conversa, e no fim sem "Tentar de novo".
    if (r.status === 422 && p.chave && (p.tentativa ?? 1) > 1 && anteriorPodeTerSaido(p)) {
      throw new ErroGateway(ERRO_ENVIO_INCERTO, false);
    }
    if (r.status < 200 || r.status >= 300) throw erroDeStatus(r.status, r.corpo);
    // No WhatsApp, data.messageId é o wamid, o mesmo message.platformMessageId dos webhooks
    // (docs.zernio.com/messages/send-inbox-message). messageIds[] só existe no Facebook e no
    // Instagram.
    const dados = ler(r.corpo, "data") ?? r.corpo;
    const id_externo = lerTexto(dados, "messageId");
    return id_externo ? { id_externo } : {};
  },

  async marcarLidaEDigitando(p, c) {
    try {
      const conversa = conversaDe(p.destino);
      if (!conversa) return;
      // o indicador de digitando também marca a última mensagem recebida como lida
      await chamar(c, "POST", `/inbox/conversations/${encodeURIComponent(conversa)}/typing`, {
        accountId: c.id_externo,
      });
    } catch {
      // melhor esforço
    }
  },

  // Sem marcarLida de propósito: a Zernio não documenta um "lido" sem o "digitando". O único
  // jeito de mandar o azul é o POST .../typing, que mostra "digitando..." ao lead por até 25 s
  // (pesquisa, conferência da seção 2). Sem o método, marcarSoLida não pede nada e a conversa
  // fica sem o azul no WhatsApp até o próximo marcarLidaEDigitando da Janete.

  async configurarWebhook(c, url) {
    const segredo = c.segredos["webhookSecret"];
    if (!segredo) throw new ErroGateway("conexao_invalida", true);
    const nome = `Janete ${c.id.slice(0, 8)}`;
    // Procura um webhook nosso (a mesma url, o nome "Janete ..." ou o caminho do nosso webhook
    // da Zernio), para atualizar em vez de duplicar. Os outros nossos que sobrarem são
    // desativados (melhor esforço): ficariam falhando e contam no limite de endpoints.
    let existente: string | undefined;
    const sobras: string[] = [];
    try {
      const lista = await chamar(c, "GET", "/webhooks/settings");
      if (lista.status >= 200 && lista.status < 300) {
        const nossos = itensDaLista(lista.corpo).filter((i) => ehWebhookNosso(i, url));
        // a de outra conexão não se reaproveita (ehWebhookDeOutraConexao): vira sobra
        const preferido =
          nossos.find((i) => lerTexto(i, "url") === url) ??
          nossos.find((i) => !ehWebhookDeOutraConexao(i, c));
        existente = idDoWebhook(preferido);
        for (const i of nossos) {
          const id = idDoWebhook(i);
          if (id && id !== existente && ler(i, "isActive") !== false) sobras.push(id);
        }
      }
    } catch {
      existente = undefined;
    }
    const base = {
      name: nome,
      url,
      secret: segredo,
      events: [...EVENTOS_WEBHOOK],
      // só os eventos da conta desta conexão (lista vazia liberaria todas)
      accountIds: [c.id_externo],
    };
    const r = existente
      ? await chamar(c, "PUT", "/webhooks/settings", {
          ...base,
          webhookId: existente,
          isActive: true,
        })
      : await chamar(c, "POST", "/webhooks/settings", base);
    if (r.status < 200 || r.status >= 300) throw erroDeStatus(r.status);
    for (const id of sobras) {
      try {
        await chamar(c, "PUT", "/webhooks/settings", { webhookId: id, isActive: false });
      } catch {
        // melhor esforço
      }
    }
  },

  async desligarWebhook(c) {
    if (!c.segredos["apiKey"]) throw new ErroGateway("conexao_invalida", true);
    // Desativa (isActive: false) cada webhook desta conexão ainda ativo (ehWebhookDestaConexao);
    // os de terceiros e os de outra cópia da Janete ficam como estão. Falha de rede ou HTTP é lançada.
    const lista = await chamar(c, "GET", "/webhooks/settings");
    if (lista.status < 200 || lista.status >= 300) throw erroDeStatus(lista.status);
    for (const i of itensDaLista(lista.corpo)) {
      const id = idDoWebhook(i);
      if (!id || !ehWebhookDestaConexao(i, c) || ler(i, "isActive") === false) continue;
      const r = await chamar(c, "PUT", "/webhooks/settings", { webhookId: id, isActive: false });
      if (r.status < 200 || r.status >= 300) throw erroDeStatus(r.status);
    }
  },

  montarConexao(campos, gerados) {
    const apiKey = (campos["apiKey"] ?? "").trim();
    const accountId = (campos["accountId"] ?? "").trim();
    const webhookSecret = gerados.webhookSecret ?? "";
    if (!apiKey || !accountId || !webhookSecret) throw new ErroGateway("conexao_invalida", true);
    return { id_externo: accountId, parametros: {}, segredos: { apiKey, webhookSecret } };
  },
};
