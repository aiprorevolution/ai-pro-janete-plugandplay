import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErroGateway, type ConexaoServidor, type Evento } from "../../nucleo/tipos";
import { adaptadorEvolution as a, MAX_BYTES_MIDIA } from "./index";

const TOKEN_URL = "tok-url-de-exemplo-0123456789abcdef";
const APIKEY = "chave-de-exemplo-9876";

const conexao: ConexaoServidor = {
  id: "11111111-1111-4111-8111-111111111111",
  gateway: "evolution",
  id_externo: "vendas-01",
  parametros: { serverUrl: "https://evo.exemplo.com.br" },
  segredos: { apiKey: APIKEY, tokenUrl: TOKEN_URL },
  oficial: false,
};

// ---------- fetch falso ----------

type Chamada = { url: string; init: RequestInit; corpo: unknown };
let chamadas: Chamada[] = [];
let respostas: Array<{ status: number; corpo?: unknown } | "rede"> = [];

function resposta(r: { status: number; corpo?: unknown }): Response {
  return new Response(r.corpo === undefined ? "" : JSON.stringify(r.corpo), { status: r.status });
}

beforeEach(() => {
  chamadas = [];
  respostas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url, init, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
      const r = respostas.shift() ?? { status: 200, corpo: {} };
      if (r === "rede") throw new TypeError("falhou");
      return resposta(r);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const cab = (i: number) => (chamadas[i]!.init.headers ?? {}) as Record<string, string>;

/** A referência de mídia gravada (JSON com key e message). */
function refDe(ev: Evento | undefined): Record<string, unknown> {
  const ref =
    ev && (ev.tipo === "entrada" || ev.tipo === "saida_celular") ? ev.msg.midia_ref_externa : "";
  return JSON.parse(ref ?? "") as Record<string, unknown>;
}

// ---------- montarConexao ----------

describe("montarConexao", () => {
  const campos = {
    serverUrl: "https://evo.exemplo.com.br/",
    instanceName: " vendas-01 ",
    apiKey: APIKEY,
  };
  it("monta id, parametros e os dois segredos", () => {
    const r = a.montarConexao(campos, { tokenUrl: TOKEN_URL });
    expect(r.id_externo).toBe("vendas-01");
    expect(r.parametros).toEqual({ serverUrl: "https://evo.exemplo.com.br" });
    expect(r.segredos).toEqual({ apiKey: APIKEY, tokenUrl: TOKEN_URL });
  });
  it.each(["serverUrl", "instanceName", "apiKey"])(
    "campo %s faltando lança conexao_invalida",
    (nome) => {
      const c = { ...campos, [nome]: "" };
      try {
        a.montarConexao(c, { tokenUrl: TOKEN_URL });
        throw new Error("devia lançar");
      } catch (e) {
        expect(e).toBeInstanceOf(ErroGateway);
        expect((e as ErroGateway).codigo).toBe("conexao_invalida");
        expect((e as ErroGateway).definitivo).toBe(true);
      }
    },
  );
  it("sem tokenUrl gerado ou com URL não https lança", () => {
    expect(() => a.montarConexao(campos, {})).toThrow(ErroGateway);
    expect(() =>
      a.montarConexao(
        { ...campos, serverUrl: "http://evo.exemplo.com.br" },
        { tokenUrl: TOKEN_URL },
      ),
    ).toThrow(ErroGateway);
  });
});

// ---------- validarWebhook ----------

describe("validarWebhook", () => {
  const req = (t?: string) =>
    new Request(
      `https://app.exemplo.com/api/public/whatsapp/evolution/${conexao.id}${t === undefined ? "" : `?t=${t}`}`,
      {
        method: "POST",
      },
    );
  it("token certo passa", async () => {
    expect(
      await a.validarWebhook(req(TOKEN_URL), JSON.stringify({ instance: "vendas-01" }), conexao),
    ).toBe(true);
  });
  it("token errado, vazio ou ausente não passa", async () => {
    expect(await a.validarWebhook(req("errado"), "{}", conexao)).toBe(false);
    expect(await a.validarWebhook(req(""), "{}", conexao)).toBe(false);
    expect(await a.validarWebhook(req(), "{}", conexao)).toBe(false);
  });
  it("sem tokenUrl guardado nunca passa", async () => {
    const c = { ...conexao, segredos: { apiKey: APIKEY } };
    expect(await a.validarWebhook(req(""), "{}", c)).toBe(false);
  });
  it("instância diferente no corpo não passa; sem instância no corpo passa", async () => {
    expect(
      await a.validarWebhook(req(TOKEN_URL), JSON.stringify({ instance: "outra" }), conexao),
    ).toBe(false);
    expect(await a.validarWebhook(req(TOKEN_URL), JSON.stringify({ event: "x" }), conexao)).toBe(
      true,
    );
    expect(await a.validarWebhook(req(TOKEN_URL), "isto nao e json", conexao)).toBe(true);
  });
});

// ---------- traduzir ----------

const upsert = (data: Record<string, unknown>, event = "messages.upsert") => ({
  event,
  instance: "vendas-01",
  data: { messageTimestamp: 1761660000, instanceId: "uuid-exemplo", ...data },
  sender: "5511888888888@s.whatsapp.net",
});
const key = (extra: Record<string, unknown> = {}) => ({
  remoteJid: "5511999999999@s.whatsapp.net",
  fromMe: false,
  id: "3EB0A1B2C3D4E5F6",
  ...extra,
});
const um = (corpo: unknown): Evento => {
  const r = a.traduzir(corpo, conexao);
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe("traduzir", () => {
  it("texto (conversation)", () => {
    const ev = um(
      upsert({
        key: key(),
        pushName: "Maria",
        message: { conversation: "Oi, quero saber o preço" },
      }),
    );
    expect(ev).toEqual({
      tipo: "entrada",
      ids: [{ tipo: "telefone", valor: "5511999999999" }],
      nome_whatsapp: "Maria",
      msg: {
        id_externo: "3EB0A1B2C3D4E5F6",
        tipo: "texto",
        texto: "Oi, quero saber o preço",
        momento: "2025-10-28T14:00:00.000Z",
      },
    });
  });
  it("texto estendido (link ou resposta)", () => {
    const ev = um(
      upsert({
        key: key(),
        message: { extendedTextMessage: { text: "veja https://exemplo.com" } },
      }),
    );
    expect(ev).toMatchObject({
      tipo: "entrada",
      msg: { tipo: "texto", texto: "veja https://exemplo.com" },
    });
  });
  it("evento em maiúsculas também vale", () => {
    expect(
      um(upsert({ key: key(), message: { conversation: "oi" } }, "MESSAGES_UPSERT")).tipo,
    ).toBe("entrada");
  });
  it("áudio: nota de voz com referência pelo id e sem base64", () => {
    const ev = um(
      upsert({
        key: key({ id: "AUD1" }),
        messageType: "audioMessage",
        message: {
          audioMessage: {
            mimetype: "audio/ogg; codecs=opus",
            seconds: 5,
            ptt: true,
            fileLength: "12345",
          },
          base64: "QUJD",
        },
      }),
    );
    expect(ev).toMatchObject({
      tipo: "entrada",
      msg: {
        tipo: "audio",
        midia_mime: "audio/ogg; codecs=opus",
        midia_tamanho: 12345,
      },
    });
    // a referência leva a key e o conteúdo da mídia (para a Evolution não depender do banco)
    expect(refDe(ev)).toMatchObject({
      key: { id: "AUD1" },
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } },
    });
    expect(JSON.stringify(ev)).not.toContain("QUJD");
  });
  it("imagem com legenda", () => {
    const ev = um(
      upsert({
        key: key({ id: "IMG1" }),
        message: { imageMessage: { mimetype: "image/jpeg", caption: "olha isso" } },
      }),
    );
    expect(ev).toMatchObject({
      tipo: "entrada",
      msg: {
        tipo: "imagem",
        texto: "olha isso",
        midia_mime: "image/jpeg",
      },
    });
    expect(refDe(ev)).toMatchObject({ key: { id: "IMG1" }, message: { imageMessage: {} } });
  });
  it("documento com legenda dentro do envoltório", () => {
    const ev = um(
      upsert({
        key: key({ id: "DOC1" }),
        message: {
          documentWithCaptionMessage: {
            message: {
              documentMessage: {
                mimetype: "application/pdf",
                fileName: "proposta.pdf",
                caption: "segue",
              },
            },
          },
        },
      }),
    );
    expect(ev).toMatchObject({
      msg: {
        tipo: "documento",
        texto: "segue",
        midia_nome: "proposta.pdf",
      },
    });
    expect(refDe(ev)).toMatchObject({
      key: { id: "DOC1" },
      message: { documentMessage: { fileName: "proposta.pdf" } },
    });
  });
  it("vídeo, figurinha, localização e contato", () => {
    expect(
      um(upsert({ key: key(), message: { videoMessage: { mimetype: "video/mp4" } } })),
    ).toMatchObject({
      msg: { tipo: "video" },
    });
    expect(
      um(upsert({ key: key(), message: { stickerMessage: { mimetype: "image/webp" } } })),
    ).toMatchObject({
      msg: { tipo: "figurinha" },
    });
    expect(
      um(
        upsert({
          key: key(),
          message: {
            locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: "Loja" },
          },
        }),
      ),
    ).toMatchObject({ msg: { tipo: "outro", texto: "[localização: Loja] -23.5, -46.6" } });
    expect(
      um(upsert({ key: key(), message: { contactMessage: { displayName: "João" } } })),
    ).toMatchObject({
      msg: { tipo: "outro", texto: "[contato: João]" },
    });
  });
  it("eco do próprio número (fromMe) vira saida_celular, sem nome", () => {
    const ev = um(
      upsert({
        key: key({ fromMe: true }),
        pushName: "Eu",
        message: { conversation: "já te respondo" },
      }),
    );
    expect(ev).toMatchObject({ tipo: "saida_celular", msg: { texto: "já te respondo" } });
    expect(ev).not.toHaveProperty("nome_whatsapp");
  });
  it("send.message (enviada pela API) vira saida_celular com o id do envio", () => {
    const ev = um(
      upsert(
        { key: key({ fromMe: true, id: "ENV1" }), message: { conversation: "olá" } },
        "send.message",
      ),
    );
    expect(ev).toMatchObject({ tipo: "saida_celular", msg: { id_externo: "ENV1" } });
  });
  it("status entregue e lido, casados pelo keyId", () => {
    const upd = (status: unknown) =>
      um({
        event: "messages.update",
        instance: "vendas-01",
        data: { keyId: "ENV1", remoteJid: "x@lid", fromMe: true, status },
      });
    expect(upd("DELIVERY_ACK")).toMatchObject({ tipo: "status", id: "ENV1", status: "entregue" });
    expect(upd("READ")).toMatchObject({ tipo: "status", id: "ENV1", status: "lida" });
    expect(upd(4)).toMatchObject({ status: "lida" });
    expect(upd("SERVER_ACK")).toMatchObject({ status: "enviada" });
    expect(upd("ERROR")).toMatchObject({ status: "falhou" });
    expect(upd("PENDING").tipo).toBe("ignorar");
  });
  it("status de mensagem do lead (fromMe false) é ignorado", () => {
    expect(
      um({ event: "messages.update", data: { keyId: "X", fromMe: false, status: "READ" } }).tipo,
    ).toBe("ignorar");
  });
  it("conexão: open, close, refused e connecting", () => {
    const con = (state: string, extra = {}) =>
      um({ event: "connection.update", data: { instance: "vendas-01", state, ...extra } });
    expect(con("open")).toEqual({ tipo: "conexao", status: "conectada" });
    expect(con("close")).toEqual({ tipo: "conexao", status: "desconectada" });
    expect(con("close", { statusReason: 401 })).toEqual({
      tipo: "conexao",
      status: "desconectada",
      detalhe: "codigo 401",
    });
    expect(con("refused", { statusReason: 401 })).toEqual({
      tipo: "conexao",
      status: "erro",
      detalhe: "codigo 401",
    });
    expect(con("connecting").tipo).toBe("ignorar");
  });
  it("grupo, transmissão, status do WhatsApp e reação são ignorados", () => {
    const j = (remoteJid: string) =>
      um(
        upsert({
          key: key({ remoteJid, participant: "5511@s.whatsapp.net" }),
          message: { conversation: "oi" },
        }),
      );
    expect(j("120363000000000000@g.us")).toEqual({ tipo: "ignorar", motivo: "grupo" });
    expect(j("status@broadcast")).toEqual({ tipo: "ignorar", motivo: "status_whatsapp" });
    expect(j("5511999999999@broadcast").tipo).toBe("ignorar");
    expect(um(upsert({ key: key(), message: { reactionMessage: { text: "👍" } } }))).toEqual({
      tipo: "ignorar",
      motivo: "reacao",
    });
  });
  it("contato só com lid: guarda o lid; modo lid troca o remoteJid; modo pn traz o lid no alt", () => {
    const so = um(
      upsert({ key: key({ remoteJid: "98765432101234@lid" }), message: { conversation: "oi" } }),
    );
    expect(so).toMatchObject({ ids: [{ tipo: "lid", valor: "98765432101234" }] });
    // Modo lid: a Evolution troca o remoteJid @lid pelo remoteJidAlt antes de mandar, então os
    // dois chegam com o telefone e o lid não vem (só no modo pn).
    const trocado = um(
      upsert({
        key: key({
          remoteJid: "5511999999999@s.whatsapp.net",
          remoteJidAlt: "5511999999999@s.whatsapp.net",
        }),
        message: { conversation: "oi" },
      }),
    );
    expect(trocado).toMatchObject({ ids: [{ tipo: "telefone", valor: "5511999999999" }] });
    const pn = um(
      upsert({
        key: key({ remoteJid: "5511999999999@s.whatsapp.net", remoteJidAlt: "98765432101234@lid" }),
        message: { conversation: "oi" },
      }),
    );
    expect(pn).toMatchObject({
      ids: [
        { tipo: "telefone", valor: "5511999999999" },
        { tipo: "lid", valor: "98765432101234" },
      ],
    });
  });
  it("messages.delete do lead vira apagada; nossa (fromMe) é ignorada", () => {
    const apagada = um({
      event: "messages.delete",
      sender: "5511888888888@s.whatsapp.net",
      data: {
        remoteJid: "5511999999999@s.whatsapp.net",
        fromMe: false,
        id: "ORIG1",
        status: "DELETED",
      },
    });
    expect(apagada).toMatchObject({
      tipo: "entrada",
      ids: [{ tipo: "telefone", valor: "5511999999999" }],
      msg: { id_externo: "ORIG1", tipo: "outro", apagada: true },
    });
    expect(
      um({
        event: "messages.delete",
        data: {
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: true,
          id: "X",
          status: "DELETED",
        },
      }),
    ).toEqual({ tipo: "ignorar", motivo: "apagada_saida" });
  });
  it("messages.edited (data = protocolMessage) vira editada; remoteJid igual ao nosso número não vira contato", () => {
    const editada = um({
      event: "messages.edited",
      sender: "5511888888888@s.whatsapp.net",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "ORIG1" },
        type: "MESSAGE_EDIT",
        editedMessage: { conversation: "texto novo" },
      },
    });
    expect(editada).toMatchObject({
      tipo: "entrada",
      ids: [{ tipo: "telefone", valor: "5511999999999" }],
      msg: { id_externo: "ORIG1", editada: true, texto: "texto novo" },
    });
    expect(
      um({
        event: "messages.edited",
        sender: "5511999999999@s.whatsapp.net",
        data: {
          key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "ORIG1" },
          type: 14,
          editedMessage: { conversation: "x" },
        },
      }),
    ).toEqual({ tipo: "ignorar", motivo: "edicao_sem_contato" });
    expect(
      um({
        event: "messages.edited",
        data: { key: { remoteJid: "5511999999999@s.whatsapp.net", id: "O" }, type: 0 },
      }),
    ).toMatchObject({ tipo: "entrada", msg: { id_externo: "O", apagada: true } });
  });
  it("vídeo redondo (ptvMessage) é vídeo", () => {
    const ev = um(
      upsert({ key: key({ id: "PTV1" }), message: { ptvMessage: { mimetype: "video/mp4" } } }),
    );
    expect(ev).toMatchObject({ tipo: "entrada", msg: { tipo: "video", midia_mime: "video/mp4" } });
  });
  it("status sem messageTimestamp usa a hora do recebimento, não o date_time", () => {
    const ev = um({
      event: "messages.update",
      date_time: "2020-01-01T00:00:00.000Z",
      data: { keyId: "M1", fromMe: true, status: "DELIVERY_ACK" },
    });
    expect(ev).toMatchObject({ tipo: "status", id: "M1", status: "entregue" });
    const momento = ev && ev.tipo === "status" ? Date.parse(ev.momento) : 0;
    expect(Math.abs(Date.now() - momento)).toBeLessThan(5_000);
  });
  it("mensagem apagada e editada", () => {
    expect(
      um(
        upsert({
          key: key(),
          message: { protocolMessage: { type: "REVOKE", key: { id: "ORIG1" } } },
        }),
      ),
    ).toMatchObject({ tipo: "entrada", msg: { id_externo: "ORIG1", apagada: true } });
    expect(
      um(
        upsert({
          key: key(),
          message: {
            protocolMessage: {
              type: 14,
              key: { id: "ORIG1" },
              editedMessage: { conversation: "novo" },
            },
          },
        }),
      ),
    ).toMatchObject({ msg: { id_externo: "ORIG1", editada: true, texto: "novo" } });
  });
  it("corpo lixo nunca lança: ignorar", () => {
    for (const lixo of [
      null,
      undefined,
      42,
      "texto",
      [],
      {},
      { event: "messages.upsert" },
      { event: "messages.upsert", data: 5 },
      { event: 7, data: [null] },
    ]) {
      const r = a.traduzir(lixo, conexao);
      expect(r.length).toBeGreaterThan(0);
      expect(r.every((e) => e.tipo === "ignorar")).toBe(true);
    }
    expect(um({ event: "qrcode.updated", data: {} }).tipo).toBe("ignorar");
  });
  it("citação: texto estendido do lead citando outra mensagem preenche responde_a_id_externo", () => {
    const ev = um(
      upsert({
        key: key({ id: "RESP1" }),
        message: {
          extendedTextMessage: {
            text: "pode ser às 15h",
            contextInfo: {
              stanzaId: "3EB0CITADA01",
              participant: "5511888888888@s.whatsapp.net",
              quotedMessage: { conversation: "Qual horário fica bom?" },
            },
          },
        },
      }),
    );
    expect(ev).toMatchObject({
      tipo: "entrada",
      msg: { id_externo: "RESP1", texto: "pode ser às 15h", responde_a_id_externo: "3EB0CITADA01" },
    });
    // o texto da citada não vira texto da mensagem
    expect(JSON.stringify(ev)).not.toContain("Qual horário");
  });
  it("citação: o contextInfo no topo do data (prepareMessage) também vale", () => {
    const ev = um(
      upsert({
        key: key(),
        message: { conversation: "sim" },
        contextInfo: { stanzaId: " 3EB0CITADA02 " },
      }),
    );
    expect(ev).toMatchObject({ msg: { responde_a_id_externo: "3EB0CITADA02" } });
  });
  it("citação: imagem com legenda dentro da mensagem temporária", () => {
    const ev = um(
      upsert({
        key: key({ id: "IMG9" }),
        message: {
          ephemeralMessage: {
            message: {
              imageMessage: {
                mimetype: "image/jpeg",
                caption: "é este?",
                contextInfo: { stanzaId: "3EB0CITADA03" },
              },
            },
          },
        },
      }),
    );
    expect(ev).toMatchObject({
      tipo: "entrada",
      msg: { tipo: "imagem", texto: "é este?", responde_a_id_externo: "3EB0CITADA03" },
    });
    // a referência da mídia continua sem o contextInfo
    expect(JSON.stringify(refDe(ev))).not.toContain("CITADA03");
  });
  it("citação: o celular da empresa (fromMe) e o send.message citando viram saida_celular com a citada", () => {
    const celular = um(
      upsert({
        key: key({ fromMe: true, id: "CEL1" }),
        message: {
          extendedTextMessage: { text: "combinado", contextInfo: { stanzaId: "3EB0LEAD01" } },
        },
      }),
    );
    expect(celular).toMatchObject({
      tipo: "saida_celular",
      msg: { id_externo: "CEL1", responde_a_id_externo: "3EB0LEAD01" },
    });
    const api = um(
      upsert(
        {
          key: key({ fromMe: true, id: "ENV9" }),
          message: { extendedTextMessage: { text: "ok", contextInfo: { stanzaId: "3EB0LEAD02" } } },
        },
        "send.message",
      ),
    );
    expect(api).toMatchObject({
      tipo: "saida_celular",
      msg: { id_externo: "ENV9", responde_a_id_externo: "3EB0LEAD02" },
    });
  });
  it("sem citação, stanzaId vazio ou edição: sem responde_a_id_externo", () => {
    const semCitacao = um(
      upsert({
        key: key(),
        message: { extendedTextMessage: { text: "oi", contextInfo: { isForwarded: true } } },
      }),
    );
    expect(semCitacao.tipo === "entrada" && semCitacao.msg).not.toHaveProperty(
      "responde_a_id_externo",
    );
    const vazio = um(
      upsert({
        key: key(),
        message: { extendedTextMessage: { text: "oi", contextInfo: { stanzaId: "  " } } },
        contextInfo: { stanzaId: "" },
      }),
    );
    expect(vazio.tipo === "entrada" && vazio.msg).not.toHaveProperty("responde_a_id_externo");
    const edicao = um(
      upsert({
        key: key(),
        contextInfo: { stanzaId: "3EB0CITADA04" },
        message: {
          protocolMessage: {
            type: 14,
            key: { id: "ORIG1" },
            editedMessage: { conversation: "novo" },
          },
        },
      }),
    );
    expect(edicao).toMatchObject({ msg: { id_externo: "ORIG1", editada: true } });
    expect(edicao.tipo === "entrada" && edicao.msg).not.toHaveProperty("responde_a_id_externo");
  });
  it("lista em data gera um evento por item", () => {
    const r = a.traduzir(
      {
        event: "messages.upsert",
        data: [
          upsert({ key: key({ id: "A" }), message: { conversation: "1" } }).data,
          upsert({ key: key({ id: "B" }), message: { conversation: "2" } }).data,
        ],
      },
      conexao,
    );
    expect(r.map((e) => (e.tipo === "entrada" ? e.msg.id_externo : ""))).toEqual(["A", "B"]);
  });
});

// ---------- baixarMidia ----------

describe("baixarMidia", () => {
  it("pede o base64 pelo id e devolve os bytes", async () => {
    respostas = [
      {
        status: 200,
        corpo: { mediaType: "audio", fileName: "a.ogg", mimetype: "audio/ogg", base64: "QUJDRA==" },
      },
    ];
    const m = await a.baixarMidia("AUD1", conexao);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe(
      "https://evo.exemplo.com.br/chat/getBase64FromMediaMessage/vendas-01",
    );
    expect(chamadas[0]!.init.method).toBe("POST");
    expect(cab(0)["apikey"]).toBe(APIKEY);
    expect(chamadas[0]!.corpo).toEqual({ message: { key: { id: "AUD1" } }, convertToMp4: false });
    expect(Array.from(m.bytes)).toEqual([65, 66, 67, 68]);
    expect(m.mime).toBe("audio/ogg");
    expect(m.nome).toBe("a.ogg");
  });
  it("ref em JSON manda a mensagem inteira; se a Evolution recusar, tenta só pela key", async () => {
    const ref = JSON.stringify({
      key: { id: "IMG1", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false },
      message: { imageMessage: { mimetype: "image/jpeg", mediaKey: "abc" } },
    });
    respostas = [{ status: 200, corpo: { mimetype: "image/jpeg", base64: "QUJD" } }];
    await a.baixarMidia(ref, conexao);
    expect(chamadas[0]!.corpo).toEqual({ message: JSON.parse(ref), convertToMp4: false });

    chamadas = [];
    respostas = [
      { status: 400 },
      { status: 200, corpo: { mimetype: "image/jpeg", base64: "QUJD" } },
    ];
    const m = await a.baixarMidia(ref, conexao);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.corpo).toEqual({ message: { key: { id: "IMG1" } }, convertToMp4: false });
    expect(Array.from(m.bytes)).toEqual([65, 66, 67]);
  });
  it("base64 de mais de 25 MB é midia_grande_demais, definitiva, sem decodificar", async () => {
    // 4N/3 letras para N = 25 MB, mais folga: passa do teto de letras
    respostas = [
      { status: 200, corpo: { mimetype: "video/mp4", base64: "A".repeat(MAX_BYTES_MIDIA * 2) } },
    ];
    const atob = vi.spyOn(globalThis, "atob");
    await expect(a.baixarMidia("V1", conexao)).rejects.toMatchObject({
      codigo: "midia_grande_demais",
      definitivo: true,
    });
    expect(atob).not.toHaveBeenCalled();
    atob.mockRestore();
  });
  it("bytes decodificados acima de 25 MB também são midia_grande_demais", async () => {
    // 25 MB + 2 bytes (múltiplo de 3): o base64 cabe na folga de letras, os bytes não
    const n = MAX_BYTES_MIDIA + 2;
    respostas = [{ status: 200, corpo: { mimetype: "video/mp4", base64: "AAAA".repeat(n / 3) } }];
    await expect(a.baixarMidia("V1", conexao)).rejects.toMatchObject({
      codigo: "midia_grande_demais",
      definitivo: true,
    });
  });
  it("até 25 MB, baixa normal", async () => {
    // 25 MB - 1 byte (múltiplo de 3), o maior abaixo do teto sem preenchimento
    const n = MAX_BYTES_MIDIA - 1;
    respostas = [{ status: 200, corpo: { mimetype: "video/mp4", base64: "AAAA".repeat(n / 3) } }];
    const m = await a.baixarMidia("V1", conexao);
    expect(m.bytes.byteLength).toBe(n);
  });
  it("400 nos dois pedidos (a Evolution embrulha falha passageira num 400) não é definitivo", async () => {
    const ref = JSON.stringify({ key: { id: "AUD9" }, message: { audioMessage: {} } });
    respostas = [{ status: 400 }, { status: 400 }];
    await expect(a.baixarMidia(ref, conexao)).rejects.toMatchObject({
      codigo: "http:400",
      definitivo: false,
    });
    expect(chamadas).toHaveLength(2);
    respostas = [{ status: 404 }];
    await expect(a.baixarMidia("AUD9", conexao)).rejects.toMatchObject({
      codigo: "http:404",
      definitivo: false,
    });
  });
  it("401 e 403 no download continuam definitivos (apikey recusada)", async () => {
    for (const status of [401, 403]) {
      respostas = [{ status }];
      await expect(a.baixarMidia("AUD9", conexao)).rejects.toMatchObject({
        codigo: `http:${status}`,
        definitivo: true,
      });
    }
  });
  it("sem base64 na resposta falha sem ser definitivo", async () => {
    respostas = [{ status: 200, corpo: {} }];
    await expect(a.baixarMidia("X", conexao)).rejects.toMatchObject({
      codigo: "midia_vazia",
      definitivo: false,
    });
  });
});

// ---------- enviar ----------

describe("enviar", () => {
  const destino = [
    { tipo: "lid" as const, valor: "98765432101234" },
    { tipo: "telefone" as const, valor: "5511999999999" },
  ];
  it("texto: sendText com o telefone (preferido ao lid) e devolve key.id", async () => {
    respostas = [
      {
        status: 201,
        corpo: { key: { remoteJid: "x", fromMe: true, id: "ENV1" }, status: "PENDING" },
      },
    ];
    const r = await a.enviar({ destino, tipo: "texto", texto: "Olá" }, conexao);
    expect(r).toEqual({ id_externo: "ENV1" });
    expect(chamadas[0]!.url).toBe("https://evo.exemplo.com.br/message/sendText/vendas-01");
    expect(chamadas[0]!.corpo).toEqual({ number: "5511999999999", text: "Olá" });
    expect(cab(0)["apikey"]).toBe(APIKEY);
  });
  it("só com lid, o número é o jid", async () => {
    respostas = [{ status: 201, corpo: { key: { id: "E2" } } }];
    await a.enviar({ destino: [destino[0]!], tipo: "texto", texto: "Olá" }, conexao);
    expect((chamadas[0]!.corpo as { number: string }).number).toBe("98765432101234@lid");
  });
  it("imagem e documento: sendMedia com a URL; áudio: sendWhatsAppAudio", async () => {
    respostas = [
      { status: 201, corpo: { key: { id: "M1" } } },
      { status: 201, corpo: { key: { id: "M2" } } },
      { status: 201, corpo: { key: { id: "M3" } } },
    ];
    const url = "https://storage.exemplo.com/assinada?x=1";
    await a.enviar(
      { destino, tipo: "imagem", texto: "legenda", midia: { url, mime: "image/png" } },
      conexao,
    );
    await a.enviar(
      { destino, tipo: "documento", midia: { url, mime: "application/pdf", nome: "p.pdf" } },
      conexao,
    );
    const aud = await a.enviar(
      { destino, tipo: "audio", midia: { url, mime: "audio/ogg" } },
      conexao,
    );
    expect(aud).toEqual({ id_externo: "M3" });
    expect(chamadas[0]!.url).toContain("/message/sendMedia/vendas-01");
    expect(chamadas[0]!.corpo).toMatchObject({
      number: "5511999999999",
      mediatype: "image",
      mimetype: "image/png",
      caption: "legenda",
      media: url,
    });
    expect(chamadas[1]!.corpo).toMatchObject({
      mediatype: "document",
      fileName: "p.pdf",
      media: url,
    });
    expect(chamadas[2]!.url).toContain("/message/sendWhatsAppAudio/vendas-01");
    expect(chamadas[2]!.corpo).toMatchObject({ audio: url });
  });
  it("áudio da Janete com texto no pedido: nota de voz, sem legenda", async () => {
    respostas = [{ status: 201, corpo: { key: { id: "V1" } } }];
    const url = "https://storage.exemplo.com/voz?x=1";
    await a.enviar(
      { destino, tipo: "audio", texto: "transcrição da fala", midia: { url, mime: "audio/ogg" } },
      conexao,
    );
    expect(chamadas[0]!.url).toContain("/message/sendWhatsAppAudio/vendas-01");
    expect(chamadas[0]!.corpo).toEqual({ number: "5511999999999", audio: url, encoding: true });
  });
  it("400 é definitivo; 429, 500, 408 e rede não são", async () => {
    const pedido = { destino, tipo: "texto" as const, texto: "oi" };
    const falha = async (r: (typeof respostas)[number]) => {
      respostas = [r];
      return a.enviar(pedido, conexao).catch((e: unknown) => e as ErroGateway);
    };
    expect(
      await falha({
        status: 400,
        corpo: { status: 400, error: "Bad Request", response: { message: ["x"] } },
      }),
    ).toMatchObject({ codigo: "http:400", definitivo: true });
    expect(await falha({ status: 401 })).toMatchObject({ definitivo: true });
    expect(await falha({ status: 429 })).toMatchObject({ codigo: "http:429", definitivo: false });
    expect(await falha({ status: 500 })).toMatchObject({ codigo: "http:500", definitivo: false });
    expect(await falha({ status: 408 })).toMatchObject({ definitivo: false });
    expect(
      await falha({ status: 503, corpo: { success: false, error: { code: "LICENSE_REQUIRED" } } }),
    ).toMatchObject({ codigo: "licenca_necessaria", definitivo: false });
    expect(await falha("rede")).toMatchObject({ codigo: "falha_de_rede", definitivo: false });
  });
  it("o erro não carrega a chave nem o texto da mensagem", async () => {
    respostas = [
      { status: 400, corpo: { response: { message: [`erro com ${APIKEY} e segredo`] } } },
    ];
    const e = (await a
      .enviar({ destino, tipo: "texto", texto: "texto privado do lead" }, conexao)
      .catch((x: unknown) => x)) as ErroGateway;
    expect(e.message).not.toContain(APIKEY);
    expect(e.message).not.toContain("texto privado");
  });
  it("citação: texto sai com quoted.key.id da citada", async () => {
    respostas = [{ status: 201, corpo: { key: { id: "ENV2" } } }];
    const r = await a.enviar(
      { destino, tipo: "texto", texto: "Pode sim", respondeA: " 3EB0CITADA01 " },
      conexao,
    );
    expect(r).toEqual({ id_externo: "ENV2" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe("https://evo.exemplo.com.br/message/sendText/vendas-01");
    expect(chamadas[0]!.corpo).toEqual({
      number: "5511999999999",
      text: "Pode sim",
      quoted: { key: { id: "3EB0CITADA01" } },
    });
  });
  it("citação: imagem, documento e áudio também levam o quoted", async () => {
    const url = "https://storage.exemplo.com/assinada?x=1";
    respostas = [
      { status: 201, corpo: { key: { id: "M1" } } },
      { status: 201, corpo: { key: { id: "M2" } } },
      { status: 201, corpo: { key: { id: "M3" } } },
    ];
    await a.enviar(
      { destino, tipo: "imagem", midia: { url, mime: "image/png" }, respondeA: "C1" },
      conexao,
    );
    await a.enviar(
      { destino, tipo: "documento", midia: { url, mime: "application/pdf" }, respondeA: "C2" },
      conexao,
    );
    await a.enviar(
      { destino, tipo: "audio", midia: { url, mime: "audio/ogg" }, respondeA: "C3" },
      conexao,
    );
    expect(chamadas[0]!.url).toContain("/message/sendMedia/vendas-01");
    expect(chamadas[0]!.corpo).toMatchObject({ mediatype: "image", quoted: { key: { id: "C1" } } });
    expect(chamadas[1]!.corpo).toMatchObject({
      mediatype: "document",
      quoted: { key: { id: "C2" } },
    });
    expect(chamadas[2]!.url).toContain("/message/sendWhatsAppAudio/vendas-01");
    expect(chamadas[2]!.corpo).toMatchObject({ audio: url, quoted: { key: { id: "C3" } } });
  });
  it("citação null, vazia ou ausente: sem quoted", async () => {
    const pedidos = [
      ...[null, "", "   "].map((respondeA) => ({
        destino,
        tipo: "texto" as const,
        texto: "oi",
        respondeA,
      })),
      { destino, tipo: "texto" as const, texto: "oi" },
    ];
    for (const pedido of pedidos) {
      chamadas = [];
      respostas = [{ status: 201, corpo: { key: { id: "E" } } }];
      await a.enviar(pedido, conexao);
      expect(chamadas[0]!.corpo).toEqual({ number: "5511999999999", text: "oi" });
    }
  });
  it("citação recusada com 400: erro definitivo sem repetir (o ciclo manda sem a citação)", async () => {
    respostas = [
      { status: 400, corpo: { status: 400, error: "Bad Request", response: { message: ["x"] } } },
      { status: 201, corpo: { key: { id: "ENV3" } } },
    ];
    await expect(
      a.enviar({ destino, tipo: "texto", texto: "oi", respondeA: "NAO_EXISTE" }, conexao),
    ).rejects.toMatchObject({ codigo: "http:400", definitivo: true });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.corpo).toMatchObject({ quoted: { key: { id: "NAO_EXISTE" } } });
  });
  it("citação: 400, 500, 401 e rede não repetem dentro do adaptador", async () => {
    const pedido = { destino, tipo: "texto" as const, texto: "oi", respondeA: "C1" };
    for (const r of [{ status: 400 }, { status: 500 }, { status: 401 }, "rede" as const]) {
      chamadas = [];
      respostas = [r];
      await expect(a.enviar(pedido, conexao)).rejects.toBeInstanceOf(ErroGateway);
      expect(chamadas).toHaveLength(1);
    }
    // sem citação, o 400 não repete
    chamadas = [];
    respostas = [{ status: 400 }];
    await expect(a.enviar({ ...pedido, respondeA: null }, conexao)).rejects.toMatchObject({
      codigo: "http:400",
    });
    expect(chamadas).toHaveLength(1);
  });
  it("sem destino aceito ou sem texto: definitivo, sem chamar a API", async () => {
    await expect(
      a.enviar({ destino: [{ tipo: "bsuid", valor: "x" }], tipo: "texto", texto: "oi" }, conexao),
    ).rejects.toMatchObject({ codigo: "sem_destino", definitivo: true });
    await expect(a.enviar({ destino, tipo: "texto" }, conexao)).rejects.toMatchObject({
      codigo: "texto_vazio",
      definitivo: true,
    });
    expect(chamadas).toHaveLength(0);
  });
});

// ---------- marcarLidaEDigitando ----------

describe("marcarLidaEDigitando", () => {
  const p = {
    destino: [{ tipo: "telefone" as const, valor: "5511999999999" }],
    ids_externos: ["M1", "M2"],
  };
  it("marca como lida e manda a presença composing", async () => {
    await a.marcarLidaEDigitando(p, conexao);
    expect(chamadas[0]!.url).toBe("https://evo.exemplo.com.br/chat/markMessageAsRead/vendas-01");
    expect(chamadas[0]!.corpo).toEqual({
      readMessages: [
        { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "M1" },
        { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "M2" },
      ],
    });
    expect(chamadas[1]!.url).toBe("https://evo.exemplo.com.br/chat/sendPresence/vendas-01");
    expect(chamadas[1]!.corpo).toMatchObject({
      number: "5511999999999",
      presence: "composing",
      delay: 15_000,
    });
  });
  it("falha de rede ou 500 não lança", async () => {
    respostas = ["rede", { status: 500 }];
    await expect(a.marcarLidaEDigitando(p, conexao)).resolves.toBeUndefined();
    respostas = [{ status: 400 }, "rede"];
    await expect(a.marcarLidaEDigitando(p, conexao)).resolves.toBeUndefined();
    await expect(a.marcarLidaEDigitando(p, { ...conexao, segredos: {} })).resolves.toBeUndefined();
  });
});

// ---------- marcarLida ----------

describe("marcarLida", () => {
  const ref = {
    destino: [
      { tipo: "lid" as const, valor: "98765432101234" },
      { tipo: "telefone" as const, valor: "5511999999999" },
    ],
    ids_externos: ["M1", "", "M2"],
  };
  it("só o markMessageAsRead, sem a presença composing", async () => {
    await a.marcarLida!(ref, conexao);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe("https://evo.exemplo.com.br/chat/markMessageAsRead/vendas-01");
    expect(cab(0)["apikey"]).toBe(APIKEY);
    expect(chamadas[0]!.corpo).toEqual({
      readMessages: [
        { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "M1" },
        { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "M2" },
      ],
    });
    expect(chamadas.some((c) => c.url.includes("sendPresence"))).toBe(false);
  });
  it("só com lid, sem ids ou com o prazo já vencido: não chama a API e devolve false", async () => {
    await expect(
      a.marcarLida!({ destino: [ref.destino[0]!], ids_externos: ["M1"] }, conexao),
    ).resolves.toBe(false);
    await expect(
      a.marcarLida!({ destino: ref.destino, ids_externos: [" ", ""] }, conexao),
    ).resolves.toBe(false);
    await expect(a.marcarLida!(ref, conexao, { fimEm: Date.now() - 10 })).resolves.toBe(false);
    expect(chamadas).toHaveLength(0);
  });
  it("falha de rede, 500, 400 ou conexão sem chave não lança e devolve false", async () => {
    respostas = ["rede"];
    await expect(a.marcarLida!(ref, conexao)).resolves.toBe(false);
    respostas = [{ status: 500 }];
    await expect(a.marcarLida!(ref, conexao)).resolves.toBe(false);
    respostas = [{ status: 400 }];
    await expect(a.marcarLida!(ref, conexao)).resolves.toBe(false);
    await expect(a.marcarLida!(ref, { ...conexao, segredos: {} })).resolves.toBe(false);
  });
  it("marcarSoLida do núcleo usa o marcarLida da Evolution", async () => {
    const { marcarSoLida } = await import("../../nucleo/lida");
    expect(await marcarSoLida(a, ref, conexao, { fimEm: Date.now() + 10_000 })).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toContain("/chat/markMessageAsRead/vendas-01");
  });
});

// ---------- configurarWebhook ----------

describe("configurarWebhook", () => {
  it("aponta a instância para a URL com os 6 eventos e base64 desligado", async () => {
    const url = `https://app.exemplo.com/api/public/whatsapp/evolution/${conexao.id}?t=${TOKEN_URL}`;
    await a.configurarWebhook!(conexao, url);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe("https://evo.exemplo.com.br/webhook/set/vendas-01");
    expect(cab(0)["apikey"]).toBe(APIKEY);
    expect(chamadas[0]!.corpo).toEqual({
      webhook: {
        enabled: true,
        url,
        byEvents: false,
        base64: false,
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "SEND_MESSAGE",
          "CONNECTION_UPDATE",
          "MESSAGES_EDITED",
          "MESSAGES_DELETE",
        ],
      },
    });
  });
  it("falha vira ErroGateway", async () => {
    respostas = [{ status: 401 }];
    await expect(a.configurarWebhook!(conexao, "https://x.exemplo.com/?t=1")).rejects.toMatchObject(
      { definitivo: true },
    );
  });
});

// ---------- desligarWebhook ----------

describe("desligarWebhook", () => {
  const url = `https://app.exemplo.com/api/public/whatsapp/evolution/${conexao.id}?t=${TOKEN_URL}`;
  it("lê a URL atual e manda o mesmo webhook/set com enabled false", async () => {
    respostas = [{ status: 200, corpo: { enabled: true, url, events: ["MESSAGES_UPSERT"] } }];
    await a.desligarWebhook!(conexao);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.url).toBe("https://evo.exemplo.com.br/webhook/find/vendas-01");
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(cab(0)["apikey"]).toBe(APIKEY);
    expect(chamadas[1]!.url).toBe("https://evo.exemplo.com.br/webhook/set/vendas-01");
    expect(chamadas[1]!.init.method).toBe("POST");
    expect(cab(1)["apikey"]).toBe(APIKEY);
    expect(chamadas[1]!.corpo).toEqual({
      webhook: {
        enabled: false,
        url,
        byEvents: false,
        base64: false,
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "SEND_MESSAGE",
          "CONNECTION_UPDATE",
          "MESSAGES_EDITED",
          "MESSAGES_DELETE",
        ],
      },
    });
  });
  it("aceita a URL dentro de { webhook }", async () => {
    respostas = [{ status: 200, corpo: { webhook: { enabled: true, url } } }];
    await a.desligarWebhook!(conexao);
    expect(chamadas).toHaveLength(2);
    expect((chamadas[1]!.corpo as { webhook: { url: string } }).webhook.url).toBe(url);
  });
  it("webhook de terceiro, sem webhook ou já desligado: não manda o webhook/set", async () => {
    for (const corpo of [
      { enabled: true, url: "https://outro.exemplo.com/hook" },
      null,
      { enabled: false, url },
    ]) {
      chamadas = [];
      respostas = [{ status: 200, corpo }];
      await a.desligarWebhook!(conexao);
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]!.url).toContain("/webhook/find/");
    }
  });
  it("URL desta conexão sem ?t= também é desligada", async () => {
    const semToken = `https://app.exemplo.com/api/public/whatsapp/evolution/${conexao.id}`;
    respostas = [{ status: 200, corpo: { enabled: true, url: semToken } }];
    await a.desligarWebhook!(conexao);
    expect(chamadas).toHaveLength(2);
    expect((chamadas[1]!.corpo as { webhook: { url: string } }).webhook.url).toBe(semToken);
  });
  it("webhook de outra conexão (outra cópia da Janete no mesmo número): não é tocado", async () => {
    for (const outra of [
      "https://copia.exemplo.com/api/public/whatsapp/evolution/22222222-2222-4222-8222-222222222222?t=x",
      "https://copia.exemplo.com/api/public/whatsapp/evolution/22222222-2222-4222-8222-222222222222",
      `https://copia.exemplo.com/api/public/whatsapp/evolution/${conexao.id}-b`,
      `https://copia.exemplo.com/outra?u=/api/public/whatsapp/evolution/${conexao.id}`,
    ]) {
      chamadas = [];
      respostas = [{ status: 200, corpo: { enabled: true, url: outra } }];
      await a.desligarWebhook!(conexao);
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]!.url).toContain("/webhook/find/");
    }
  });
  it("falha HTTP ou de rede é lançada (no find e no set)", async () => {
    respostas = [{ status: 401 }];
    await expect(a.desligarWebhook!(conexao)).rejects.toMatchObject({ definitivo: true });
    respostas = [{ status: 200, corpo: { enabled: true, url } }, { status: 500 }];
    await expect(a.desligarWebhook!(conexao)).rejects.toMatchObject({
      codigo: "http:500",
      definitivo: false,
    });
    respostas = ["rede"];
    await expect(a.desligarWebhook!(conexao)).rejects.toBeInstanceOf(ErroGateway);
  });
  it("conexão sem apikey é inválida", async () => {
    await expect(a.desligarWebhook!({ ...conexao, segredos: {} })).rejects.toMatchObject({
      codigo: "conexao_invalida",
    });
    expect(chamadas).toHaveLength(0);
  });
});
