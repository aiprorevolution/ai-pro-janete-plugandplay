import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErroGateway, type ConexaoServidor } from "../../nucleo/tipos";
import { adaptadorMeta as meta } from "./index";

const NUMERO = "106540352242922";
const conexao: ConexaoServidor = {
  id: "11111111-1111-4111-8111-111111111111",
  gateway: "meta",
  id_externo: NUMERO,
  parametros: { phoneId: NUMERO },
  segredos: {
    token: "TOKEN_DE_TESTE",
    appSecret: "SEGREDO_DE_TESTE",
    verifyToken: "VERIFICA_TESTE",
  },
  oficial: true,
};

const WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=";
const metadata = { display_phone_number: "15550783881", phone_number_id: NUMERO };
const contato = {
  profile: { name: "Pessoa Exemplo" },
  wa_id: "16505551234",
  user_id: "US.13491208655302741918",
};

function corpoComMensagem(msg: Record<string, unknown>, contatos: unknown[] = [contato]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata,
              contacts: contatos,
              messages: [
                {
                  from: "16505551234",
                  from_user_id: "US.13491208655302741918",
                  id: WAMID,
                  timestamp: "1749416383",
                  ...msg,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function corpoComStatus(status: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata,
              statuses: [
                {
                  id: WAMID,
                  status,
                  timestamp: "1749416400",
                  recipient_user_id: "US.13491208655302741918",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

type Pedido = { url: string; init: RequestInit };
function falsoFetch(
  respostas: Array<{ status?: number; json?: unknown; bytes?: Uint8Array; mime?: string } | Error>,
) {
  const pedidos: Pedido[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    pedidos.push({ url: String(url), init });
    const r = respostas.shift() ?? { status: 200, json: {} };
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    if (r.bytes)
      return new Response(r.bytes as unknown as BodyInit, {
        status,
        headers: { "content-type": r.mime ?? "application/octet-stream" },
      });
    return new Response(JSON.stringify(r.json ?? {}), { status });
  });
  vi.stubGlobal("fetch", f);
  return pedidos;
}

afterEach(() => vi.unstubAllGlobals());

describe("montarConexao", () => {
  const gerados = { verifyToken: "gerado-32-bytes" };
  it("monta id, parametros e os 3 segredos", () => {
    const r = meta.montarConexao(
      { phoneId: NUMERO, wabaId: "999", token: "t", appSecret: "s" },
      gerados,
    );
    expect(r.id_externo).toBe(NUMERO);
    expect(r.parametros).toEqual({ phoneId: NUMERO, wabaId: "999" });
    expect(Object.keys(r.segredos).sort()).toEqual(["appSecret", "token", "verifyToken"]);
    expect(r.segredos["verifyToken"]).toBe("gerado-32-bytes");
  });
  it.each(["phoneId", "token", "appSecret"])(
    "campo %s faltando lança conexao_invalida",
    (falta) => {
      const campos: Record<string, string> = { phoneId: NUMERO, token: "t", appSecret: "s" };
      delete campos[falta];
      try {
        meta.montarConexao(campos, gerados);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ErroGateway);
        expect((e as ErroGateway).codigo).toBe("conexao_invalida");
        expect((e as ErroGateway).definitivo).toBe(true);
      }
    },
  );
});

describe("validarWebhook e verificação", () => {
  const corpo = JSON.stringify(corpoComMensagem({ type: "text", text: { body: "oi" } }));
  const assina = (segredo: string) =>
    "sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex");
  const req = (assinatura?: string) =>
    new Request("https://x.test/h", {
      method: "POST",
      headers: assinatura ? { "x-hub-signature-256": assinatura } : {},
    });

  it("assinatura certa passa", async () => {
    expect(await meta.validarWebhook(req(assina("SEGREDO_DE_TESTE")), corpo, conexao)).toBe(true);
  });
  it("assinatura errada, ausente, mal formada ou corpo alterado falham", async () => {
    expect(await meta.validarWebhook(req(assina("outro")), corpo, conexao)).toBe(false);
    expect(await meta.validarWebhook(req(), corpo, conexao)).toBe(false);
    expect(await meta.validarWebhook(req("sha256=zz"), corpo, conexao)).toBe(false);
    expect(await meta.validarWebhook(req(assina("SEGREDO_DE_TESTE")), corpo + " ", conexao)).toBe(
      false,
    );
  });
  it("sem appSecret nunca valida", async () => {
    const sem = { ...conexao, segredos: {} };
    expect(await meta.validarWebhook(req(assina("")), corpo, sem)).toBe(false);
  });

  it("verificação: token certo 200 com o desafio; errado 403; sem hub.mode null", async () => {
    const u = (q: string) => new URL(`https://x.test/h?${q}`);
    const ok = meta.responderVerificacao!(
      u("hub.mode=subscribe&hub.verify_token=VERIFICA_TESTE&hub.challenge=1158201444"),
      conexao,
    );
    expect(ok?.status).toBe(200);
    expect(await ok?.text()).toBe("1158201444");
    const ruim = meta.responderVerificacao!(
      u("hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1"),
      conexao,
    );
    expect(ruim?.status).toBe(403);
    expect(meta.responderVerificacao!(u("x=1"), conexao)).toBeNull();
  });
});

describe("traduzir", () => {
  it("texto, com nome, telefone e bsuid", () => {
    const ev = meta.traduzir(
      corpoComMensagem({ type: "text", text: { body: "Does it come in another color?" } }),
      conexao,
    );
    expect(ev).toEqual([
      {
        tipo: "entrada",
        ids: [
          { tipo: "telefone", valor: "16505551234" },
          { tipo: "bsuid", valor: "US.13491208655302741918" },
        ],
        nome_whatsapp: "Pessoa Exemplo",
        msg: {
          id_externo: WAMID,
          tipo: "texto",
          texto: "Does it come in another color?",
          momento: "2025-06-08T20:59:43.000Z",
        },
      },
    ]);
  });
  it("áudio com media id", () => {
    const [e] = meta.traduzir(
      corpoComMensagem({
        type: "audio",
        audio: { id: "MID1", mime_type: "audio/ogg; codecs=opus", voice: true },
      }),
      conexao,
    );
    expect(e).toMatchObject({
      tipo: "entrada",
      msg: { tipo: "audio", midia_ref_externa: "MID1", midia_mime: "audio/ogg; codecs=opus" },
    });
  });
  it("imagem com legenda", () => {
    const [e] = meta.traduzir(
      corpoComMensagem({
        type: "image",
        image: { id: "MID2", mime_type: "image/jpeg", caption: "olha isso" },
      }),
      conexao,
    );
    expect(e).toMatchObject({
      msg: { tipo: "imagem", texto: "olha isso", midia_ref_externa: "MID2" },
    });
  });
  it("documento com nome, figurinha, vídeo, localização e contato", () => {
    const tipos = (m: Record<string, unknown>) => {
      const [e] = meta.traduzir(corpoComMensagem(m), conexao);
      return e && e.tipo === "entrada" ? e.msg : null;
    };
    expect(
      tipos({
        type: "document",
        document: { id: "D1", mime_type: "application/pdf", filename: "proposta.pdf" },
      }),
    ).toMatchObject({
      tipo: "documento",
      midia_nome: "proposta.pdf",
      midia_ref_externa: "D1",
    });
    expect(tipos({ type: "sticker", sticker: { id: "S1", mime_type: "image/webp" } })?.tipo).toBe(
      "figurinha",
    );
    expect(
      tipos({ type: "video", video: { id: "V1", mime_type: "video/mp4", caption: "c" } }),
    ).toMatchObject({ tipo: "video", texto: "c" });
    expect(
      tipos({ type: "location", location: { latitude: -23.5, longitude: -46.6, name: "Praça" } })
        ?.tipo,
    ).toBe("outro");
    expect(
      tipos({ type: "contacts", contacts: [{ name: { formatted_name: "Fulano Exemplo" } }] })
        ?.texto,
    ).toContain("Fulano Exemplo");
  });
  it("eco do próprio número vira saida_celular", () => {
    const corpo = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "smb_message_echoes",
              value: {
                messaging_product: "whatsapp",
                metadata,
                message_echoes: [
                  {
                    from: "15550783881",
                    to: "16505551234",
                    id: WAMID,
                    timestamp: "1749416383",
                    type: "text",
                    text: { body: "Já te respondo" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(meta.traduzir(corpo, conexao)).toEqual([
      {
        tipo: "saida_celular",
        ids: [{ tipo: "telefone", valor: "16505551234" }],
        msg: {
          id_externo: WAMID,
          tipo: "texto",
          texto: "Já te respondo",
          momento: "2025-06-08T20:59:43.000Z",
        },
      },
    ]);
  });
  it("status entregue e lido (played também vira lida)", () => {
    expect(meta.traduzir(corpoComStatus("delivered"), conexao)).toEqual([
      { tipo: "status", id: WAMID, status: "entregue", momento: "2025-06-08T21:00:00.000Z" },
    ]);
    expect(meta.traduzir(corpoComStatus("read"), conexao)[0]).toMatchObject({ status: "lida" });
    expect(meta.traduzir(corpoComStatus("played"), conexao)[0]).toMatchObject({ status: "lida" });
    expect(meta.traduzir(corpoComStatus("sent"), conexao)[0]).toMatchObject({ status: "enviada" });
    expect(meta.traduzir(corpoComStatus("failed"), conexao)[0]).toMatchObject({ status: "falhou" });
  });
  it("grupo e reação são ignorados", () => {
    expect(
      meta.traduzir(
        corpoComMensagem({ type: "text", text: { body: "x" }, group_id: "120363@g.us" }),
        conexao,
      ),
    ).toEqual([{ tipo: "ignorar", motivo: "grupo" }]);
    expect(
      meta.traduzir(
        corpoComMensagem({ type: "reaction", reaction: { message_id: "w", emoji: "👍" } }),
        conexao,
      ),
    ).toEqual([{ tipo: "ignorar", motivo: "reacao" }]);
  });
  it("contato só com bsuid (sem telefone)", () => {
    const corpo = corpoComMensagem({ type: "text", text: { body: "oi" }, from: undefined }, [
      { profile: { name: "Fulana", username: "fulana" }, user_id: "BR.123ABC" },
    ]);
    const msg = (corpo.entry[0]!.changes[0]!.value.messages as Record<string, unknown>[])[0]!;
    delete msg["from"];
    msg["from_user_id"] = "BR.123ABC";
    const [e] = meta.traduzir(corpo, conexao);
    expect(e).toMatchObject({
      tipo: "entrada",
      ids: [{ tipo: "bsuid", valor: "BR.123ABC" }],
      nome_whatsapp: "Fulana",
    });
  });
  it("outro número do mesmo app é ignorado", () => {
    const corpo = corpoComMensagem({ type: "text", text: { body: "x" } });
    corpo.entry[0]!.changes[0]!.value.metadata = { phone_number_id: "999999" } as typeof metadata;
    expect(meta.traduzir(corpo, conexao)).toEqual([{ tipo: "ignorar", motivo: "outro_numero" }]);
  });
  it("vários messages e statuses no mesmo corpo", () => {
    const corpo = corpoComMensagem({ type: "text", text: { body: "a" } });
    const v = corpo.entry[0]!.changes[0]!.value as Record<string, unknown>;
    (v["messages"] as unknown[]).push({
      from: "16505551234",
      id: "wamid.2",
      timestamp: "1749416390",
      type: "text",
      text: { body: "b" },
    });
    v["statuses"] = [{ id: "wamid.9", status: "read", timestamp: "1749416399" }];
    const ev = meta.traduzir(corpo, conexao);
    expect(ev.map((e) => e.tipo)).toEqual(["entrada", "entrada", "status"]);
  });
  it("conta desconectada vira evento de conexão", () => {
    const corpo = {
      object: "whatsapp_business_account",
      entry: [
        { id: "W", changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED" } }] },
      ],
    };
    expect(meta.traduzir(corpo, conexao)).toEqual([
      { tipo: "conexao", status: "desconectada", detalhe: "PARTNER_REMOVED" },
    ]);
  });
  it("corpo lixo não lança e vira ignorar", () => {
    for (const lixo of [
      null,
      undefined,
      42,
      "texto",
      [],
      {},
      { object: "x" },
      { object: "whatsapp_business_account", entry: "z" },
    ]) {
      const ev = meta.traduzir(lixo, conexao);
      expect(ev.length).toBeGreaterThan(0);
      expect(ev.every((e) => e.tipo === "ignorar")).toBe(true);
    }
  });
});

describe("baixarMidia", () => {
  it("pede a url com Bearer e baixa os bytes com Bearer", async () => {
    const pedidos = falsoFetch([
      { json: { url: "https://lookaside.fbsbx.com/m/abc", mime_type: "image/jpeg", id: "MID2" } },
      { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" },
    ]);
    const r = await meta.baixarMidia("MID2", conexao);
    expect(Array.from(r.bytes)).toEqual([1, 2, 3]);
    expect(r.mime).toBe("image/jpeg");
    expect(pedidos[0]!.url).toBe("https://graph.facebook.com/v26.0/MID2");
    expect(pedidos[1]!.url).toBe("https://lookaside.fbsbx.com/m/abc");
    for (const p of pedidos)
      expect((p.init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer TOKEN_DE_TESTE",
      );
  });
  it("404 do media id é erro definitivo", async () => {
    falsoFetch([{ status: 404, json: { error: { code: 100 } } }]);
    await expect(meta.baixarMidia("X", conexao)).rejects.toMatchObject({ definitivo: true });
  });
});

describe("enviar", () => {
  it("texto: telefone com + e devolve o wamid", async () => {
    const pedidos = falsoFetch([{ json: { messages: [{ id: "wamid.OUT" }] } }]);
    const r = await meta.enviar(
      {
        destino: [
          { tipo: "bsuid", valor: "US.1" },
          { tipo: "telefone", valor: "5511999990000" },
        ],
        tipo: "texto",
        texto: "Olá",
      },
      conexao,
    );
    expect(r).toEqual({ id_externo: "wamid.OUT" });
    expect(pedidos[0]!.url).toBe(`https://graph.facebook.com/v26.0/${NUMERO}/messages`);
    expect(JSON.parse(pedidos[0]!.init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+5511999990000",
      type: "text",
      text: { body: "Olá" },
    });
  });
  it("sem telefone usa recipient com o bsuid", async () => {
    const pedidos = falsoFetch([{ json: { messages: [{ id: "w" }] } }]);
    await meta.enviar(
      { destino: [{ tipo: "bsuid", valor: "US.1" }], tipo: "texto", texto: "x" },
      conexao,
    );
    expect(JSON.parse(pedidos[0]!.init.body as string)).toMatchObject({ recipient: "US.1" });
  });
  it("áudio da Janete com texto no pedido: voz, sem legenda", async () => {
    const pedidos = falsoFetch([{ json: { messages: [{ id: "v" }] } }]);
    await meta.enviar(
      {
        destino: [{ tipo: "telefone" as const, valor: "5511999990000" }],
        tipo: "audio",
        texto: "transcrição da fala",
        midia: { url: "https://s.test/v", mime: "audio/ogg" },
      },
      conexao,
    );
    const corpo = JSON.parse(pedidos[0]!.init.body as string);
    expect(corpo).toMatchObject({ type: "audio" });
    expect(corpo.audio).toEqual({ link: "https://s.test/v", voice: true });
  });
  it("mídia por link: imagem com legenda, áudio ogg como voz, documento com nome", async () => {
    const pedidos = falsoFetch([
      { json: { messages: [{ id: "a" }] } },
      { json: { messages: [{ id: "b" }] } },
      { json: { messages: [{ id: "c" }] } },
    ]);
    const destino = [{ tipo: "telefone" as const, valor: "5511999990000" }];
    await meta.enviar(
      {
        destino,
        tipo: "imagem",
        texto: "foto",
        midia: { url: "https://s.test/i", mime: "image/jpeg" },
      },
      conexao,
    );
    await meta.enviar(
      { destino, tipo: "audio", midia: { url: "https://s.test/a", mime: "audio/ogg" } },
      conexao,
    );
    await meta.enviar(
      {
        destino,
        tipo: "documento",
        midia: { url: "https://s.test/d", mime: "application/pdf", nome: "p.pdf" },
      },
      conexao,
    );
    const corpos = pedidos.map((p) => JSON.parse(p.init.body as string));
    expect(corpos[0]).toMatchObject({
      type: "image",
      image: { link: "https://s.test/i", caption: "foto" },
    });
    expect(corpos[1]).toMatchObject({
      type: "audio",
      audio: { link: "https://s.test/a", voice: true },
    });
    expect(corpos[2]).toMatchObject({
      type: "document",
      document: { link: "https://s.test/d", filename: "p.pdf" },
    });
  });
  it("400 definitivo; 429, 500 e rede não definitivos", async () => {
    const p = {
      destino: [{ tipo: "telefone" as const, valor: "5511999990000" }],
      tipo: "texto" as const,
      texto: "x",
    };
    falsoFetch([{ status: 400, json: { error: { code: 131047, message: "texto secreto" } } }]);
    const e400 = await meta.enviar(p, conexao).catch((e: unknown) => e);
    expect(e400).toBeInstanceOf(ErroGateway);
    expect(e400).toMatchObject({ definitivo: true, codigo: "meta_400_131047" });
    expect((e400 as Error).message).not.toContain("secreto");
    falsoFetch([{ status: 429, json: {} }]);
    expect(await meta.enviar(p, conexao).catch((e: unknown) => e)).toMatchObject({
      definitivo: false,
    });
    falsoFetch([{ status: 500, json: {} }]);
    expect(await meta.enviar(p, conexao).catch((e: unknown) => e)).toMatchObject({
      definitivo: false,
    });
    falsoFetch([new Error("rede caiu com TOKEN_DE_TESTE")]);
    const rede = await meta.enviar(p, conexao).catch((e: unknown) => e);
    expect(rede).toMatchObject({ definitivo: false, codigo: "falha_de_rede" });
    expect((rede as Error).message).not.toContain("TOKEN");
  });
  it("sem destino utilizável ou texto vazio é definitivo, sem chamar a Meta", async () => {
    const pedidos = falsoFetch([]);
    await expect(
      meta.enviar(
        { destino: [{ tipo: "lid", valor: "1@lid" }], tipo: "texto", texto: "x" },
        conexao,
      ),
    ).rejects.toMatchObject({ definitivo: true });
    await expect(
      meta.enviar(
        { destino: [{ tipo: "telefone", valor: "5511999990000" }], tipo: "texto" },
        conexao,
      ),
    ).rejects.toMatchObject({ definitivo: true });
    expect(pedidos).toHaveLength(0);
  });
});

describe("marcarLidaEDigitando", () => {
  it("manda read + typing_indicator no último id", async () => {
    const pedidos = falsoFetch([{ json: { success: true } }]);
    await meta.marcarLidaEDigitando({ destino: [], ids_externos: ["w1", "w2"] }, conexao);
    expect(pedidos[0]!.url).toBe(`https://graph.facebook.com/v26.0/${NUMERO}/messages`);
    expect(JSON.parse(pedidos[0]!.init.body as string)).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "w2",
      typing_indicator: { type: "text" },
    });
  });
  it("falha ou lista vazia não lança", async () => {
    falsoFetch([{ status: 500 }]);
    await expect(
      meta.marcarLidaEDigitando({ destino: [], ids_externos: ["w"] }, conexao),
    ).resolves.toBeUndefined();
    falsoFetch([new Error("x")]);
    await expect(
      meta.marcarLidaEDigitando({ destino: [], ids_externos: ["w"] }, conexao),
    ).resolves.toBeUndefined();
    const pedidos = falsoFetch([]);
    await expect(
      meta.marcarLidaEDigitando({ destino: [], ids_externos: [] }, conexao),
    ).resolves.toBeUndefined();
    expect(pedidos).toHaveLength(0);
  });
});

describe("configurarWebhook", () => {
  it("a Meta configura no painel: o adaptador não define configurarWebhook", () => {
    expect(meta.configurarWebhook).toBeUndefined();
  });
});

describe("revisão final", () => {
  const conexaoWaba: ConexaoServidor = {
    ...conexao,
    parametros: { phoneId: NUMERO, wabaId: "WABA" },
  };
  const contaCorpo = (value: Record<string, unknown>, id = "WABA") => ({
    object: "whatsapp_business_account",
    entry: [{ id, changes: [{ field: "account_update", value }] }],
  });
  const ecoCorpo = (eco: Record<string, unknown>) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "smb_message_echoes",
            value: { messaging_product: "whatsapp", metadata, message_echoes: [eco] },
          },
        ],
      },
    ],
  });

  it("400 com código passageiro da Meta (131000, 4, 2494100) não é definitivo", async () => {
    const p = {
      destino: [{ tipo: "telefone" as const, valor: "5511999990000" }],
      tipo: "texto" as const,
      texto: "x",
    };
    for (const code of [131000, 4, 2494100, 131016, 133004]) {
      falsoFetch([{ status: 400, json: { error: { code } } }]);
      expect(await meta.enviar(p, conexao).catch((e: unknown) => e)).toMatchObject({
        definitivo: false,
        codigo: `meta_400_${code}`,
      });
    }
  });

  it("DISABLED_UPDATE: só DISABLE desconecta; REINSTATE e ACCOUNT_RECONNECTED conectam", () => {
    expect(
      meta.traduzir(
        contaCorpo({ event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "DISABLE" } }),
        conexaoWaba,
      ),
    ).toEqual([{ tipo: "conexao", status: "desconectada", detalhe: "DISABLED_UPDATE" }]);
    expect(
      meta.traduzir(
        contaCorpo({ event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "REINSTATE" } }),
        conexaoWaba,
      ),
    ).toEqual([{ tipo: "conexao", status: "conectada" }]);
    expect(
      meta.traduzir(
        contaCorpo({
          event: "DISABLED_UPDATE",
          ban_info: { waba_ban_state: "SCHEDULE_FOR_DISABLE" },
        }),
        conexaoWaba,
      ),
    ).toEqual([{ tipo: "ignorar", motivo: "conta_sem_efeito" }]);
    expect(meta.traduzir(contaCorpo({ event: "ACCOUNT_RECONNECTED" }), conexaoWaba)).toEqual([
      { tipo: "conexao", status: "conectada" },
    ]);
    expect(meta.traduzir(contaCorpo({ event: "ACCOUNT_OFFBOARDED" }), conexaoWaba)).toEqual([
      { tipo: "conexao", status: "desconectada", detalhe: "ACCOUNT_OFFBOARDED" },
    ]);
  });

  it("account_update de outra WABA do mesmo app é ignorado", () => {
    expect(
      meta.traduzir(contaCorpo({ event: "PARTNER_REMOVED" }, "OUTRA_WABA"), conexaoWaba),
    ).toEqual([{ tipo: "ignorar", motivo: "outra_waba" }]);
  });

  it("value.errors no campo messages não muda o status da conexão", () => {
    const corpo = corpoComMensagem({ type: "text", text: { body: "x" } });
    const v = corpo.entry[0]!.changes[0]!.value as Record<string, unknown>;
    delete v["messages"];
    v["errors"] = [{ code: 131000, title: "Something went wrong" }];
    expect(meta.traduzir(corpo, conexao)).toEqual([
      { tipo: "ignorar", motivo: "erro_sistema_131000" },
    ]);
  });

  it("unsupported de edição, reação ou fixar é ignorado; sem subtipo vira outro", () => {
    for (const sub of ["edit", "reaction", "pin", "keep_in_chat", "poll_update"]) {
      expect(
        meta.traduzir(
          corpoComMensagem({ type: "unsupported", unsupported: { type: sub } }),
          conexao,
        ),
      ).toEqual([{ tipo: "ignorar", motivo: `sem_conteudo_${sub}` }]);
    }
    const [e] = meta.traduzir(corpoComMensagem({ type: "unsupported" }), conexao);
    expect(e).toMatchObject({ tipo: "entrada", msg: { tipo: "outro" } });
    const [g] = meta.traduzir(
      corpoComMensagem({ type: "unsupported", unsupported: { type: "poll_creation" } }),
      conexao,
    );
    expect(g).toMatchObject({ tipo: "entrada", msg: { tipo: "outro" } });
  });

  it("troca de número ou de BSUID tem motivo próprio", () => {
    expect(
      meta.traduzir(
        corpoComMensagem({
          type: "system",
          system: { type: "user_changed_user_id", previous_user_id: "US.1" },
        }),
        conexao,
      ),
    ).toEqual([{ tipo: "ignorar", motivo: "troca_de_bsuid" }]);
  });

  it("eco sem `to`, só com to_user_id, vira bsuid; com os dois, os dois ids", () => {
    const base = { from: "15550783881", id: WAMID, timestamp: "1749416383", type: "text" };
    const [so] = meta.traduzir(
      ecoCorpo({ ...base, to_user_id: "US.999", text: { body: "a" } }),
      conexao,
    );
    expect(so).toMatchObject({ tipo: "saida_celular", ids: [{ tipo: "bsuid", valor: "US.999" }] });
    const [dois] = meta.traduzir(
      ecoCorpo({ ...base, to: "16505551234", to_user_id: "US.999", text: { body: "a" } }),
      conexao,
    );
    expect(dois).toMatchObject({
      ids: [
        { tipo: "telefone", valor: "16505551234" },
        { tipo: "bsuid", valor: "US.999" },
      ],
    });
    expect(
      meta.traduzir(ecoCorpo({ ...base, to: "16505551234", type: "revoke" }), conexao),
    ).toEqual([{ tipo: "ignorar", motivo: "tipo_nao_suportado" }]);
  });

  it("mídia acima de 20 MB nem é baixada (erro definitivo)", async () => {
    const pedidos = falsoFetch([
      {
        json: {
          url: "https://lookaside.fbsbx.com/m/abc",
          mime_type: "application/pdf",
          file_size: 60 * 1024 * 1024,
        },
      },
    ]);
    await expect(meta.baixarMidia("MID", conexao)).rejects.toMatchObject({
      codigo: "midia_grande_demais",
      definitivo: true,
    });
    expect(pedidos).toHaveLength(1);
  });

  it("o Bearer não vai para URL fora da Meta", async () => {
    const pedidos = falsoFetch([
      { json: { url: "https://evil.example/m", mime_type: "image/jpeg" } },
    ]);
    await expect(meta.baixarMidia("MID", conexao)).rejects.toMatchObject({
      codigo: "midia_sem_url",
    });
    expect(pedidos).toHaveLength(1);
  });
});

describe("citação e lido (M1c)", () => {
  const CITADA = "wamid.CITADA_ANTERIOR";
  const destino = [{ tipo: "telefone" as const, valor: "5511999990000" }];

  function corpoEco(m: Record<string, unknown>) {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "smb_message_echoes",
              value: {
                messaging_product: "whatsapp",
                metadata,
                message_echoes: [
                  {
                    from: "15550783881",
                    to: "16505551234",
                    id: WAMID,
                    timestamp: "1749416383",
                    ...m,
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  it("entrada citando: texto com context.id preenche responde_a_id_externo", () => {
    const ev = meta.traduzir(
      corpoComMensagem({
        type: "text",
        text: { body: "Sim, esse mesmo" },
        context: { from: "15550783881", id: CITADA },
      }),
      conexao,
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      tipo: "entrada",
      msg: { id_externo: WAMID, texto: "Sim, esse mesmo", responde_a_id_externo: CITADA },
    });
  });

  it("entrada citando com mídia e clique em botão também leva a citada", () => {
    const img = meta.traduzir(
      corpoComMensagem({
        type: "image",
        image: { id: "MID", mime_type: "image/jpeg" },
        context: { from: "15550783881", id: CITADA },
      }),
      conexao,
    )[0];
    expect(img).toMatchObject({ msg: { tipo: "imagem", responde_a_id_externo: CITADA } });
    const botao = meta.traduzir(
      corpoComMensagem({
        type: "button",
        button: { payload: "p", text: "Quero" },
        context: { from: "15550783881", id: CITADA },
      }),
      conexao,
    )[0];
    expect(botao).toMatchObject({ msg: { texto: "Quero", responde_a_id_externo: CITADA } });
  });

  it("sem context, encaminhada (context sem id) ou id vazio: sem a chave", () => {
    for (const context of [undefined, { forwarded: true }, { from: "1", id: "  " }, "x"]) {
      const ev = meta.traduzir(
        corpoComMensagem({ type: "text", text: { body: "oi" }, ...(context ? { context } : {}) }),
        conexao,
      )[0] as { msg: Record<string, unknown> };
      expect(ev.msg).not.toHaveProperty("responde_a_id_externo");
    }
  });

  it("context.id com espaços é aparado; citando a si mesma é ignorado", () => {
    const aparado = meta.traduzir(
      corpoComMensagem({ type: "text", text: { body: "a" }, context: { id: `  ${CITADA} ` } }),
      conexao,
    )[0] as { msg: Record<string, unknown> };
    expect(aparado.msg["responde_a_id_externo"]).toBe(CITADA);
    const propria = meta.traduzir(
      corpoComMensagem({ type: "text", text: { body: "a" }, context: { id: WAMID } }),
      conexao,
    )[0] as { msg: Record<string, unknown> };
    expect(propria.msg).not.toHaveProperty("responde_a_id_externo");
  });

  it("eco do celular citando vira saida_celular com responde_a_id_externo", () => {
    expect(
      meta.traduzir(
        corpoEco({ type: "text", text: { body: "Respondendo" }, context: { id: CITADA } }),
        conexao,
      ),
    ).toEqual([
      {
        tipo: "saida_celular",
        ids: [{ tipo: "telefone", valor: "16505551234" }],
        msg: {
          id_externo: WAMID,
          tipo: "texto",
          texto: "Respondendo",
          momento: "2025-06-08T20:59:43.000Z",
          responde_a_id_externo: CITADA,
        },
      },
    ]);
  });

  it("a segunda passada (corpo limpo, sem segredos) traduz igual", () => {
    const corpo = corpoComMensagem({
      type: "text",
      text: { body: "oi" },
      context: { from: "15550783881", id: CITADA },
    });
    const copia = JSON.parse(JSON.stringify(corpo)) as unknown;
    expect(meta.traduzir(copia, conexao)).toEqual(meta.traduzir(corpo, conexao));
  });

  it("envio citando: texto e mídia levam context.message_id", async () => {
    const pedidos = falsoFetch([
      { json: { messages: [{ id: "wamid.OUT1" }] } },
      { json: { messages: [{ id: "wamid.OUT2" }] } },
    ]);
    const r = await meta.enviar(
      { destino, tipo: "texto", texto: "Claro!", respondeA: CITADA },
      conexao,
    );
    expect(r).toEqual({ id_externo: "wamid.OUT1" });
    expect(JSON.parse(pedidos[0]!.init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+5511999990000",
      context: { message_id: CITADA },
      type: "text",
      text: { body: "Claro!" },
    });
    await meta.enviar(
      {
        destino,
        tipo: "documento",
        midia: { url: "https://s.test/d", mime: "application/pdf", nome: "p.pdf" },
        respondeA: ` ${CITADA} `,
      },
      conexao,
    );
    expect(JSON.parse(pedidos[1]!.init.body as string)).toMatchObject({
      type: "document",
      context: { message_id: CITADA },
    });
  });

  it("envio sem citação (null, vazio ou ausente) não leva context", async () => {
    const pedidos = falsoFetch([{ json: {} }, { json: {} }, { json: {} }]);
    await meta.enviar({ destino, tipo: "texto", texto: "a", respondeA: null }, conexao);
    await meta.enviar({ destino, tipo: "texto", texto: "a", respondeA: "   " }, conexao);
    await meta.enviar({ destino, tipo: "texto", texto: "a" }, conexao);
    for (const p of pedidos) {
      expect(JSON.parse(p.init.body as string)).not.toHaveProperty("context");
    }
  });

  it("marcarLida: só status read no último id, sem typing_indicator", async () => {
    const pedidos = falsoFetch([{ json: { success: true } }]);
    await meta.marcarLida!({ destino, ids_externos: ["w1", "w2", ""] }, conexao);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.url).toBe(`https://graph.facebook.com/v26.0/${NUMERO}/messages`);
    expect(pedidos[0]!.init.method).toBe("POST");
    expect((pedidos[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer TOKEN_DE_TESTE",
    );
    const corpo = JSON.parse(pedidos[0]!.init.body as string) as Record<string, unknown>;
    expect(corpo).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "w2" });
    expect(corpo).not.toHaveProperty("typing_indicator");
  });

  it("marcarLida devolve true quando a Meta aceita", async () => {
    falsoFetch([{ json: { success: true } }]);
    await expect(meta.marcarLida!({ destino, ids_externos: ["w"] }, conexao)).resolves.toBe(true);
  });

  it("marcarLida nunca lança e devolve false: erro, rede, sem token ou sem ids", async () => {
    falsoFetch([{ status: 400, json: { error: { code: 100 } } }]);
    await expect(meta.marcarLida!({ destino, ids_externos: ["w"] }, conexao)).resolves.toBe(false);
    falsoFetch([new Error("rede")]);
    await expect(meta.marcarLida!({ destino, ids_externos: ["w"] }, conexao)).resolves.toBe(false);
    const semToken = { ...conexao, segredos: { ...conexao.segredos, token: "" } };
    let pedidos = falsoFetch([]);
    await expect(meta.marcarLida!({ destino, ids_externos: ["w"] }, semToken)).resolves.toBe(false);
    expect(pedidos).toHaveLength(0);
    pedidos = falsoFetch([]);
    await expect(meta.marcarLida!({ destino, ids_externos: [] }, conexao)).resolves.toBe(false);
    await expect(meta.marcarLida!({ destino, ids_externos: ["", "  "] }, conexao)).resolves.toBe(
      false,
    );
    expect(pedidos).toHaveLength(0);
  });

  it("marcarLida com o prazo já vencido nem chama a Meta (false)", async () => {
    const pedidos = falsoFetch([{ json: { success: true } }]);
    await expect(
      meta.marcarLida!({ destino, ids_externos: ["w"] }, conexao, { fimEm: Date.now() }),
    ).resolves.toBe(false);
    expect(pedidos).toHaveLength(0);
  });

  it("marcarSoLida usa o marcarLida da Meta e nunca o digitando", async () => {
    const { marcarSoLida } = await import("../../nucleo/lida");
    const pedidos = falsoFetch([{ json: { success: true } }]);
    expect(await marcarSoLida(meta, { destino, ids_externos: ["w9"] }, conexao)).toBe(true);
    expect(pedidos).toHaveLength(1);
    expect(JSON.parse(pedidos[0]!.init.body as string)).not.toHaveProperty("typing_indicator");
  });
});

describe("desligarWebhook", () => {
  it("não existe: a API não permite, a tela lembra de tirar no painel", () => {
    expect(meta.desligarWebhook).toBeUndefined();
  });
});
