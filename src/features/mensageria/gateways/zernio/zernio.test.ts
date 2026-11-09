import { afterEach, describe, expect, it, vi } from "vitest";
import { marcarSoLida } from "../../nucleo/lida";
import { ERRO_ENVIO_INCERTO, ErroGateway, type ConexaoServidor } from "../../nucleo/tipos";
import { adaptadorZernio as a, MAX_BYTES_MIDIA } from "./index";

const SEGREDO = "segredo-de-teste-webhook";
const CHAVE = "sk_chave_de_teste_0000";

const conexao: ConexaoServidor = {
  id: "11111111-2222-3333-4444-555555555555",
  gateway: "zernio",
  id_externo: "acc_1",
  parametros: {},
  segredos: { apiKey: CHAVE, webhookSecret: SEGREDO },
  oficial: true,
};

function envelope(extra: Record<string, unknown>, evento = "message.received") {
  return {
    id: "evt-1",
    event: evento,
    timestamp: "2026-10-28T13:00:00Z",
    account: { accountId: "acc_1", profileId: "prof_1" },
    conversation: { id: "conv_1", participantId: "5511999998888", participantName: "Ana Exemplo" },
    ...extra,
  };
}

function entrada(msg: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return envelope({
    message: {
      id: "m_1",
      conversationId: "conv_1",
      platform: "whatsapp",
      platformMessageId: "wamid.AAA",
      direction: "incoming",
      attachments: [],
      sender: { id: "5511999998888", phoneNumber: "+5511999998888", name: "Ana Exemplo" },
      sentAt: "2026-10-28T12:59:58Z",
      ...msg,
    },
    ...extra,
  });
}

function assinar(corpo: string, segredo = SEGREDO) {
  return import("node:crypto").then((m) =>
    m.createHmac("sha256", segredo).update(corpo).digest("hex"),
  );
}

afterEach(() => vi.unstubAllGlobals());

function falso(status: number, corpo: unknown = {}, cab: Record<string, string> = {}) {
  const f = vi.fn(
    async () =>
      new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), {
        status,
        headers: cab,
      }),
  );
  vi.stubGlobal("fetch", f);
  return f;
}

describe("montarConexao", () => {
  it("monta com accountId e os segredos pelos nomes fixos", () => {
    const r = a.montarConexao(
      { apiKey: " sk_x ", accountId: "acc_9" },
      { webhookSecret: "gerado" },
    );
    expect(r).toEqual({
      id_externo: "acc_9",
      parametros: {},
      segredos: { apiKey: "sk_x", webhookSecret: "gerado" },
    });
  });
  it("campo faltando lança conexao_invalida definitivo", () => {
    for (const campos of [{ apiKey: "sk" }, { accountId: "a" }]) {
      try {
        a.montarConexao(campos, { webhookSecret: "g" });
        throw new Error("não lançou");
      } catch (e) {
        expect(e).toBeInstanceOf(ErroGateway);
        expect((e as ErroGateway).codigo).toBe("conexao_invalida");
        expect((e as ErroGateway).definitivo).toBe(true);
      }
    }
  });
});

describe("validarWebhook e idEvento", () => {
  const corpo = JSON.stringify(entrada({ text: "oi" }));
  it("assinatura certa passa, errada ou ausente falha", async () => {
    const ok = new Request("https://x/", {
      method: "POST",
      headers: { "X-Zernio-Signature": await assinar(corpo) },
    });
    expect(await a.validarWebhook(ok, corpo, conexao)).toBe(true);
    const legado = new Request("https://x/", {
      method: "POST",
      headers: { "X-Late-Signature": await assinar(corpo) },
    });
    expect(await a.validarWebhook(legado, corpo, conexao)).toBe(true);
    const ruim = new Request("https://x/", {
      method: "POST",
      headers: { "X-Zernio-Signature": await assinar(corpo, "outro") },
    });
    expect(await a.validarWebhook(ruim, corpo, conexao)).toBe(false);
    const adulterado = new Request("https://x/", {
      method: "POST",
      headers: { "X-Zernio-Signature": await assinar(corpo) },
    });
    expect(await a.validarWebhook(adulterado, corpo + " ", conexao)).toBe(false);
    expect(
      await a.validarWebhook(new Request("https://x/", { method: "POST" }), corpo, conexao),
    ).toBe(false);
  });
  it("idEvento: id do corpo (assinado) primeiro; sem ele, cabeçalho ou alias antigo", () => {
    const h = (n: string) => new Request("https://x/", { headers: { [n]: "e1" } });
    expect(a.idEvento!(h("X-Zernio-Event-Id"), {})).toBe("e1");
    expect(a.idEvento!(h("X-Late-Event-Id"), {})).toBe("e1");
    expect(a.idEvento!(new Request("https://x/"), { id: "e2" })).toBe("e2");
    // cabeçalho trocado num corpo capturado não passa pela deduplicação
    expect(a.idEvento!(h("X-Zernio-Event-Id"), { id: "e2" })).toBe("e2");
    expect(a.idEvento!(new Request("https://x/"), {})).toBeNull();
  });
});

describe("traduzir", () => {
  it("texto de entrada", () => {
    const r = a.traduzir(entrada({ text: "Oi, quero saber o preço" }), conexao);
    expect(r).toEqual([
      {
        tipo: "entrada",
        ids: [
          { tipo: "telefone", valor: "5511999998888" },
          { tipo: "zernio_conversa", valor: "conv_1" },
        ],
        nome_whatsapp: "Ana Exemplo",
        msg: {
          id_externo: "wamid.AAA",
          id_gateway: "m_1",
          tipo: "texto",
          texto: "Oi, quero saber o preço",
          momento: "2026-10-28T12:59:58.000Z",
        },
      },
    ]);
  });
  it("áudio com url de mídia", () => {
    const r = a.traduzir(
      entrada({
        attachments: [
          {
            type: "audio",
            mimeType: "audio/ogg",
            url: "https://zernio.com/api/v1/whatsapp/media/md1?accountId=acc_1",
            payload: { id: "md1", voice: true },
          },
        ],
      }),
      conexao,
    );
    expect(r[0]).toMatchObject({
      tipo: "entrada",
      msg: {
        tipo: "audio",
        midia_mime: "audio/ogg",
        midia_ref_externa: "https://zernio.com/api/v1/whatsapp/media/md1?accountId=acc_1",
      },
    });
  });
  it("imagem com legenda e documento", () => {
    const img = a.traduzir(
      entrada({
        text: "veja",
        attachments: [{ type: "image", mimeType: "image/jpeg", payload: { id: "md2" } }],
      }),
      conexao,
    );
    expect(img[0]).toMatchObject({
      msg: { tipo: "imagem", texto: "veja", midia_ref_externa: "md2" },
    });
    const doc = a.traduzir(
      entrada({
        attachments: [
          {
            type: "file",
            mimeType: "application/pdf",
            url: "https://zernio.com/x",
            filename: "tabela.pdf",
          },
        ],
      }),
      conexao,
    );
    expect(doc[0]).toMatchObject({
      msg: { tipo: "documento", midia_nome: "tabela.pdf", midia_mime: "application/pdf" },
    });
  });
  it("figurinha, localização e contato", () => {
    expect(
      a.traduzir(
        entrada({ attachments: [{ type: "sticker", url: "https://zernio.com/s" }] }),
        conexao,
      )[0],
    ).toMatchObject({ msg: { tipo: "figurinha" } });
    const loc = a.traduzir(
      entrada({}, { metadata: { location: { latitude: 1.5, longitude: 2.5, name: "Loja" } } }),
      conexao,
    );
    expect(loc[0]).toMatchObject({
      tipo: "entrada",
      msg: { tipo: "outro", texto: "[localização] · Loja · 1.5, 2.5" },
    });
    const ct = a.traduzir(
      entrada({}, { metadata: { contacts: [{ name: { formatted_name: "Bia Exemplo" } }] } }),
      conexao,
    );
    expect(ct[0]).toMatchObject({ msg: { tipo: "outro", texto: "[contato] Bia Exemplo" } });
  });
  it("eco do próprio número vira saida_celular", () => {
    const corpo = envelope(
      {
        message: {
          id: "m_2",
          platform: "whatsapp",
          platformMessageId: "wamid.BBB",
          direction: "outgoing",
          text: "respondi pelo celular",
          attachments: [],
          sender: { id: "acc_1" },
          sentAt: "2026-10-28T13:05:00Z",
          source: "whatsapp_business_app",
          sentVia: null,
        },
      },
      "message.sent",
    );
    expect(a.traduzir(corpo, conexao)).toEqual([
      {
        tipo: "saida_celular",
        ids: [
          { tipo: "telefone", valor: "5511999998888" },
          { tipo: "zernio_conversa", valor: "conv_1" },
        ],
        msg: {
          id_externo: "wamid.BBB",
          id_gateway: "m_2",
          tipo: "texto",
          texto: "respondi pelo celular",
          momento: "2026-10-28T13:05:00.000Z",
        },
      },
    ]);
  });
  it("entrada citando: replyTo em texto ou objeto vira responde_a_id_externo (wamid primeiro)", () => {
    const casos: [Record<string, unknown>, Record<string, unknown>, string][] = [
      [{ replyTo: " wamid.CITADA " }, {}, "wamid.CITADA"],
      [{ replyTo: { id: "m_0", platformMessageId: "wamid.OBJ" } }, {}, "wamid.OBJ"],
      [{ replyTo: { messageId: "wamid.MID" } }, {}, "wamid.MID"],
      [{ replyToMessageId: "wamid.SOLTO" }, {}, "wamid.SOLTO"],
      [{ context: { id: "wamid.CTX" } }, {}, "wamid.CTX"],
      [{}, { metadata: { context: { id: "wamid.META" } } }, "wamid.META"],
    ];
    for (const [msg, extra, esperado] of casos) {
      const [ev] = a.traduzir(entrada({ text: "isso aqui", ...msg }, extra), conexao);
      expect(ev).toMatchObject({ tipo: "entrada" });
      if (ev?.tipo !== "entrada") throw new Error("não é entrada");
      expect(ev.msg.responde_a_id_externo).toBe(esperado);
      expect(ev.msg.texto).toBe("isso aqui");
    }
  });
  it("entrada citando com mídia mantém a citação; citação vazia ou da própria mensagem some", () => {
    const [img] = a.traduzir(
      entrada({
        text: "olha",
        replyTo: "wamid.CITADA",
        attachments: [{ type: "image", mimeType: "image/jpeg", url: "https://zernio.com/x" }],
      }),
      conexao,
    );
    if (img?.tipo !== "entrada") throw new Error("não é entrada");
    expect(img.msg.tipo).toBe("imagem");
    expect(img.msg.responde_a_id_externo).toBe("wamid.CITADA");
    for (const replyTo of ["", "   ", "wamid.AAA", "m_1", { platformMessageId: "" }, 42, null]) {
      const [ev] = a.traduzir(entrada({ text: "oi", replyTo }), conexao);
      if (ev?.tipo !== "entrada") throw new Error("não é entrada");
      expect(ev.msg).not.toHaveProperty("responde_a_id_externo");
    }
  });
  it("eco do celular citando também leva responde_a_id_externo", () => {
    const corpo = envelope(
      {
        message: {
          id: "m_2",
          platform: "whatsapp",
          platformMessageId: "wamid.BBB",
          direction: "outgoing",
          text: "respondendo a sua pergunta",
          attachments: [],
          sender: { id: "acc_1" },
          sentAt: "2026-10-28T13:05:00Z",
          source: "whatsapp_business_app",
          replyTo: { platformMessageId: "wamid.AAA" },
        },
      },
      "message.sent",
    );
    const [ev] = a.traduzir(corpo, conexao);
    expect(ev).toMatchObject({
      tipo: "saida_celular",
      msg: { id_externo: "wamid.BBB", responde_a_id_externo: "wamid.AAA" },
    });
  });
  it("status entregue, lido e falhou", () => {
    const base = {
      message: {
        id: "m_2",
        platformMessageId: "wamid.BBB",
        platform: "whatsapp",
        direction: "outgoing",
      },
      statusAt: "2026-10-28T13:06:00Z",
    };
    // o status casa pelo wamid, que é o id gravado no envio (data.messageId) e no eco
    expect(a.traduzir(envelope(base, "message.delivered"), conexao)).toEqual([
      { tipo: "status", id: "wamid.BBB", status: "entregue", momento: "2026-10-28T13:06:00.000Z" },
    ]);
    expect(a.traduzir(envelope(base, "message.read"), conexao)).toEqual([
      { tipo: "status", id: "wamid.BBB", status: "lida", momento: "2026-10-28T13:06:00.000Z" },
    ]);
    // nome herdado do protótipo não vira status
    expect(a.traduzir(envelope(base, "constructor"), conexao)[0]).toMatchObject({
      tipo: "ignorar",
    });
    expect(
      a.traduzir(envelope({ ...base, error: { code: 131026 } }, "message.failed"), conexao)[0],
    ).toMatchObject({ status: "falhou" });
  });
  it("grupo, reação, outra conta e outra plataforma são ignorados", () => {
    const grupo = entrada(
      { text: "oi" },
      { conversation: { id: "c", participantId: "120363000000@g.us" } },
    );
    expect(a.traduzir(grupo, conexao)[0]).toMatchObject({ tipo: "ignorar" });
    expect(a.traduzir(envelope({}, "reaction.received"), conexao)[0]).toMatchObject({
      tipo: "ignorar",
    });
    expect(
      a.traduzir(entrada({ text: "oi" }, { account: { accountId: "outra" } }), conexao)[0],
    ).toMatchObject({ tipo: "ignorar", motivo: "outra_conta" });
    expect(a.traduzir(entrada({ text: "oi", platform: "instagram" }), conexao)[0]).toMatchObject({
      tipo: "ignorar",
    });
  });
  it("contato só com bsuid", () => {
    const corpo = entrada(
      {
        text: "oi",
        sender: {
          id: "BR.13491208655302741918",
          businessScopedUserId: "BR.13491208655302741918",
          name: "Caio",
        },
      },
      { conversation: { id: "conv_9", participantId: "BR.13491208655302741918" } },
    );
    const r = a.traduzir(corpo, conexao);
    expect(r[0]).toMatchObject({
      tipo: "entrada",
      ids: [
        { tipo: "bsuid", valor: "BR.13491208655302741918" },
        { tipo: "zernio_conversa", valor: "conv_9" },
      ],
    });
  });
  it("editada e apagada casam pelo wamid com a original", () => {
    const ed = envelope(
      {
        message: {
          id: "m_1",
          platformMessageId: "wamid.AAA",
          direction: "incoming",
          text: "novo",
          sentAt: "2026-10-28T12:59:58Z",
          sender: { id: "5511999998888" },
        },
        editedAt: "2026-10-28T13:10:00Z",
      },
      "message.edited",
    );
    expect(a.traduzir(ed, conexao)[0]).toMatchObject({
      tipo: "entrada",
      msg: {
        id_externo: "wamid.AAA",
        texto: "novo",
        editada: true,
        momento: "2026-10-28T12:59:58.000Z",
      },
    });
    const ap = envelope(
      {
        message: { id: "m_1", platformMessageId: "wamid.AAA", direction: "incoming", text: "x" },
        deletedAt: "2026-10-28T13:11:00Z",
      },
      "message.deleted",
    );
    expect(a.traduzir(ap, conexao)[0]).toMatchObject({
      tipo: "entrada",
      msg: { id_externo: "wamid.AAA", apagada: true },
    });
  });
  it("edição ou apagamento sem wamid, ou de mensagem nossa, é ignorado", () => {
    const sem = envelope({ message: { id: "m_1", text: "novo" } }, "message.edited");
    expect(a.traduzir(sem, conexao)).toEqual([{ tipo: "ignorar", motivo: "sem_id_plataforma" }]);
    const nossa = envelope(
      { message: { id: "m_1", platformMessageId: "wamid.X", direction: "outgoing", text: "y" } },
      "message.edited",
    );
    expect(a.traduzir(nossa, conexao)).toEqual([{ tipo: "ignorar", motivo: "edicao_saida" }]);
    const apagadaNossa = envelope(
      { message: { id: "m_1", platformMessageId: "wamid.X", direction: "outgoing" } },
      "message.deleted",
    );
    expect(a.traduzir(apagadaNossa, conexao)).toEqual([
      { tipo: "ignorar", motivo: "apagada_saida" },
    ]);
  });
  it("remetente diferente do participante da conversa é tratado como grupo", () => {
    const corpo = entrada(
      { text: "oi", sender: { id: "5511777776666", phoneNumber: "+5511777776666" } },
      { conversation: { id: "conv_g", participantId: "5511999998888" } },
    );
    expect(a.traduzir(corpo, conexao)).toEqual([
      { tipo: "ignorar", motivo: "grupo_ou_transmissao" },
    ]);
    const comGroupId = entrada({ text: "oi", groupId: "g1" });
    expect(a.traduzir(comGroupId, conexao)[0]).toMatchObject({ tipo: "ignorar" });
  });
  it("histórico importado (já lido e antigo) não arma a Janete", () => {
    const antiga = entrada({ text: "oi", isRead: true, sentAt: "2026-06-01T10:00:00Z" });
    expect(a.traduzir(antiga, conexao)).toEqual([{ tipo: "ignorar", motivo: "historico" }]);
    // lida, mas recente: entra
    const recente = entrada({ text: "oi", isRead: true });
    expect(a.traduzir(recente, conexao)[0]).toMatchObject({ tipo: "entrada" });
  });
  it("evento de mensagem sem account.accountId é ignorado", () => {
    const corpo = entrada({ text: "oi" }) as Record<string, unknown>;
    delete corpo["account"];
    expect(a.traduzir(corpo, conexao)).toEqual([{ tipo: "ignorar", motivo: "sem_conta" }]);
  });
  it("conexão conectou e desconectou", () => {
    expect(a.traduzir(envelope({}, "account.connected"), conexao)).toEqual([
      { tipo: "conexao", status: "conectada" },
    ]);
    expect(a.traduzir(envelope({}, "account.disconnected"), conexao)).toEqual([
      { tipo: "conexao", status: "desconectada" },
    ]);
  });
  it("corpo lixo vira ignorar sem lançar", () => {
    for (const lixo of [
      null,
      undefined,
      42,
      "texto",
      [],
      {},
      { event: 7 },
      { event: "message.received" },
      { event: "message.received", message: 3 },
    ]) {
      const r = a.traduzir(lixo, conexao);
      expect(r).toHaveLength(1);
      expect(r[0]!.tipo).toBe("ignorar");
    }
  });
});

describe("baixarMidia", () => {
  it("url da Zernio leva o Bearer e devolve os bytes", async () => {
    const f = falso(200, "binario", { "content-type": "application/octet-stream" });
    const url = "https://zernio.com/api/v1/whatsapp/media/md1?accountId=acc_1";
    const r = await a.baixarMidia(url, conexao);
    expect(f).toHaveBeenCalledTimes(1);
    const [u, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(u).toBe(url);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${CHAVE}`);
    expect(new TextDecoder().decode(r.bytes)).toBe("binario");
    expect(r.mime).toBe("application/octet-stream");
  });
  it("só o mediaId monta a url com accountId", async () => {
    const f = falso(200, "x");
    await a.baixarMidia("md7", conexao);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://zernio.com/api/v1/whatsapp/media/md7?accountId=acc_1",
    );
  });
  it("URL https fora da Zernio é baixada sem o Bearer; http é recusado", async () => {
    const f = falso(200, "x", { "content-type": "image/png" });
    const r = await a.baixarMidia("https://outro.exemplo/arquivo", conexao);
    expect(r.mime).toBe("image/png");
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    const g = falso(200, "x");
    await expect(a.baixarMidia("http://outro.exemplo/arquivo", conexao)).rejects.toMatchObject({
      definitivo: true,
    });
    expect(g).not.toHaveBeenCalled();
  });
  it("400 é mídia expirada, definitiva; 500 não", async () => {
    falso(400);
    await expect(a.baixarMidia("md1", conexao)).rejects.toMatchObject({
      codigo: "midia_expirada",
      definitivo: true,
    });
    falso(500);
    await expect(a.baixarMidia("md1", conexao)).rejects.toMatchObject({ definitivo: false });
  });
  it("acima de 25 MB é midia_grande_demais, definitiva (pelo content-length ou pelo corpo)", async () => {
    const corpoDe = (bytes: Uint8Array<ArrayBuffer>, cab: Record<string, string> = {}) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(bytes, { status: 200, headers: cab })),
      );
    corpoDe(new Uint8Array(3), { "content-length": String(MAX_BYTES_MIDIA + 1) });
    await expect(a.baixarMidia("md1", conexao)).rejects.toMatchObject({
      codigo: "midia_grande_demais",
      definitivo: true,
    });
    // sem content-length: confere o tamanho real depois de ler
    corpoDe(new Uint8Array(MAX_BYTES_MIDIA + 1));
    await expect(a.baixarMidia("md1", conexao)).rejects.toMatchObject({
      codigo: "midia_grande_demais",
      definitivo: true,
    });
    // no limite, baixa normal
    corpoDe(new Uint8Array(MAX_BYTES_MIDIA), {
      "content-length": String(MAX_BYTES_MIDIA),
      "content-type": "video/mp4",
    });
    const r = await a.baixarMidia("md1", conexao);
    expect(r.bytes.byteLength).toBe(MAX_BYTES_MIDIA);
    expect(r.mime).toBe("video/mp4");
  });
});

describe("enviar", () => {
  const destino = [
    { tipo: "telefone", valor: "5511999998888" },
    { tipo: "zernio_conversa", valor: "conv_1" },
  ] as const;

  it("texto vai para a conversa e devolve o wamid (data.messageId) como id_externo", async () => {
    const f = falso(200, { data: { messageId: "wamid.OUT" } });
    const r = await a.enviar({ destino: [...destino], tipo: "texto", texto: "olá" }, conexao);
    expect(r).toEqual({ id_externo: "wamid.OUT" });
    const [u, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(u).toBe("https://zernio.com/api/v1/inbox/conversations/conv_1/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ accountId: "acc_1", message: "olá" });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${CHAVE}`);
  });
  it("mídia: imagem com legenda, documento e áudio ogg", async () => {
    const f = falso(200, { data: { messageId: "wamid.A" } });
    await a.enviar(
      {
        destino: [...destino],
        tipo: "imagem",
        texto: "legenda",
        midia: { url: "https://x/a.jpg", mime: "image/jpeg" },
      },
      conexao,
    );
    await a.enviar(
      {
        destino: [...destino],
        tipo: "documento",
        midia: { url: "https://x/a.pdf", mime: "application/pdf", nome: "a.pdf" },
      },
      conexao,
    );
    const r = await a.enviar(
      {
        destino: [...destino],
        tipo: "audio",
        midia: { url: "https://x/a.ogg", mime: "audio/ogg" },
      },
      conexao,
    );
    expect(r).toEqual({ id_externo: "wamid.A" });
    const corpos = f.mock.calls.map((c) =>
      JSON.parse((c as unknown as [string, RequestInit])[1].body as string),
    );
    expect(corpos[0]).toEqual({
      accountId: "acc_1",
      attachmentUrl: "https://x/a.jpg",
      attachmentType: "image",
      message: "legenda",
    });
    expect(corpos[1]).toEqual({
      accountId: "acc_1",
      attachmentUrl: "https://x/a.pdf",
      attachmentType: "file",
      attachmentName: "a.pdf",
    });
    expect(corpos[2]).toEqual({
      accountId: "acc_1",
      attachmentUrl: "https://x/a.ogg",
      attachmentType: "audio",
      voiceNote: true,
    });
  });
  // Regressão do áudio da Janete (decisão da sessão da voz): nota de voz, sem legenda.
  it("áudio ogg/opus sai como nota de voz", async () => {
    const f = falso(200, { data: { messageId: "wamid.V" } });
    await a.enviar(
      {
        destino: [...destino],
        tipo: "audio",
        texto: "transcrição da fala",
        midia: { url: "https://x/v.ogg", mime: "audio/ogg; codecs=opus" },
      },
      conexao,
    );
    const corpo = JSON.parse(
      (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(corpo).toMatchObject({
      attachmentUrl: "https://x/v.ogg",
      attachmentType: "audio",
      voiceNote: true,
    });
  });
  it("áudio com texto no pedido não manda legenda", async () => {
    const f = falso(200, { data: { messageId: "wamid.V" } });
    await a.enviar(
      {
        destino: [...destino],
        tipo: "audio",
        texto: "transcrição da fala",
        midia: { url: "https://x/v.ogg", mime: "audio/ogg; codecs=opus" },
      },
      conexao,
    );
    const corpo = JSON.parse(
      (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(corpo).not.toHaveProperty("message");
  });
  it("citando: respondeA vai em replyTo no texto e na mídia; nulo ou vazio não manda", async () => {
    const f = falso(200, { data: { messageId: "wamid.OUT" } });
    await a.enviar(
      { destino: [...destino], tipo: "texto", texto: "respondendo", respondeA: " wamid.AAA " },
      conexao,
    );
    await a.enviar(
      {
        destino: [...destino],
        tipo: "imagem",
        texto: "segue",
        midia: { url: "https://x/a.jpg", mime: "image/jpeg" },
        respondeA: "wamid.BBB",
      },
      conexao,
    );
    await a.enviar({ destino: [...destino], tipo: "texto", texto: "sem" }, conexao);
    for (const respondeA of [null, "", "  "]) {
      await a.enviar({ destino: [...destino], tipo: "texto", texto: "sem", respondeA }, conexao);
    }
    const corpos = f.mock.calls.map((c) =>
      JSON.parse((c as unknown as [string, RequestInit])[1].body as string),
    );
    expect(corpos[0]).toEqual({ accountId: "acc_1", message: "respondendo", replyTo: "wamid.AAA" });
    expect(corpos[1]).toEqual({
      accountId: "acc_1",
      attachmentUrl: "https://x/a.jpg",
      attachmentType: "image",
      message: "segue",
      replyTo: "wamid.BBB",
    });
    for (const corpo of corpos.slice(2)) {
      expect(corpo).toEqual({ accountId: "acc_1", message: "sem" });
    }
  });
  it("manda a Idempotency-Key com o id da mensagem; 409 é passageiro", async () => {
    const f = falso(200, { data: { messageId: "wamid.OUT" } });
    await a.enviar(
      { destino: [...destino], tipo: "texto", texto: "olá", chave: "msg-uuid-1" },
      conexao,
    );
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("msg-uuid-1");
    falso(409, { error: "in progress" });
    await expect(
      a.enviar({ destino: [...destino], tipo: "texto", texto: "x", chave: "k" }, conexao),
    ).rejects.toMatchObject({ definitivo: false });
  });
  it("422 com a Idempotency-Key depois da 1ª tentativa: envio incerto (pode ter saído)", async () => {
    const pedido = {
      destino: [...destino],
      tipo: "texto" as const,
      texto: "olá",
      chave: "msg-uuid-1",
    };
    falso(422, { error: "Idempotency key reused with different body" });
    await expect(a.enviar({ ...pedido, tentativa: 2 }, conexao)).rejects.toMatchObject({
      codigo: ERRO_ENVIO_INCERTO,
      definitivo: false,
    });
    // na 1ª tentativa (ou sem chave), o 422 é recusa comum: definitivo
    falso(422, { error: "invalid" });
    await expect(a.enviar({ ...pedido, tentativa: 1 }, conexao)).rejects.toMatchObject({
      codigo: "zernio_http_422",
      definitivo: true,
    });
    falso(422, { error: "invalid" });
    await expect(a.enviar({ ...pedido }, conexao)).rejects.toMatchObject({
      codigo: "zernio_http_422",
    });
    falso(422, { error: "invalid" });
    await expect(
      a.enviar({ destino: [...destino], tipo: "texto", texto: "x", tentativa: 3 }, conexao),
    ).rejects.toMatchObject({ codigo: "zernio_http_422", definitivo: true });
  });
  it("422 depois de uma resposta de erro da Zernio na tentativa anterior: recusa comum (definitivo)", async () => {
    const pedido = {
      destino: [...destino],
      tipo: "texto" as const,
      texto: "olá",
      chave: "msg-uuid-1",
      respondeA: "wamid.CITADA",
    };
    // sem 2xx a Zernio não guardou a chave: o 422 é validação e o ciclo tenta sem a citação
    for (const erroAnterior of [
      "zernio_http_503",
      "zernio_http_500",
      "zernio_http_408",
      "limite_de_chamadas",
      "limite_destinatario",
      "limite_meta_130429",
    ]) {
      falso(422, { error: "replyTo not found" });
      await expect(
        a.enviar({ ...pedido, tentativa: 2, erroAnterior }, conexao),
      ).rejects.toMatchObject({ codigo: "zernio_http_422", definitivo: true });
    }
    // o anterior pode ter sido aceito: continua incerto
    for (const erroAnterior of [
      null,
      "",
      "tempo_esgotado",
      "falha_de_rede",
      "sem_tempo",
      "erro_interno",
      "zernio_http_409",
      "envio_incerto",
    ]) {
      falso(422, { error: "Idempotency key reused with different body" });
      await expect(
        a.enviar({ ...pedido, tentativa: 3, erroAnterior }, conexao),
      ).rejects.toMatchObject({ codigo: ERRO_ENVIO_INCERTO, definitivo: false });
    }
  });
  it("400 com 131056 (limite por destinatário) é passageiro; outro 400 continua definitivo", async () => {
    for (const corpo of [
      { error: "Too many messages", code: 131056 },
      { error: "x", code: "platform_api_error", platformError: { code: 131056 } },
    ]) {
      falso(400, corpo);
      await expect(
        a.enviar({ destino: [...destino], tipo: "texto", texto: "x" }, conexao),
      ).rejects.toMatchObject({ codigo: "limite_destinatario", definitivo: false });
    }
    falso(400, { error: "x", platformError: { code: 131047 } });
    await expect(
      a.enviar({ destino: [...destino], tipo: "texto", texto: "x" }, conexao),
    ).rejects.toMatchObject({ definitivo: true });
  });
  it("sem conversa da Zernio falha de forma definitiva sem chamar", async () => {
    const f = falso(200);
    await expect(
      a.enviar(
        { destino: [{ tipo: "telefone", valor: "5511" }], tipo: "texto", texto: "oi" },
        conexao,
      ),
    ).rejects.toMatchObject({ definitivo: true });
    expect(f).not.toHaveBeenCalled();
  });
  it("400 definitivo; 429, 408 e 500 não; rede não", async () => {
    const pedido = { destino: [...destino], tipo: "texto" as const, texto: "oi" };
    for (const [status, definitivo] of [
      [400, true],
      [401, true],
      [429, false],
      [408, false],
      [500, false],
    ] as const) {
      falso(status, { error: "x" });
      const e = await a.enviar(pedido, conexao).catch((x) => x);
      expect(e).toBeInstanceOf(ErroGateway);
      expect(e.definitivo).toBe(definitivo);
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`falha com ${CHAVE}`);
      }),
    );
    const e = await a.enviar(pedido, conexao).catch((x) => x);
    expect(e).toBeInstanceOf(ErroGateway);
    expect(e.definitivo).toBe(false);
    expect(e.message).not.toContain(CHAVE);
  });
});

describe("marcarLidaEDigitando", () => {
  const p = {
    destino: [{ tipo: "zernio_conversa" as const, valor: "conv_1" }],
    ids_externos: ["wamid.AAA"],
  };
  it("chama o endpoint de digitando", async () => {
    const f = falso(200, { success: true });
    await a.marcarLidaEDigitando(p, conexao);
    const [u, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(u).toBe("https://zernio.com/api/v1/inbox/conversations/conv_1/typing");
    expect(JSON.parse(init.body as string)).toEqual({ accountId: "acc_1" });
  });
  it("falha não lança", async () => {
    falso(500);
    await expect(a.marcarLidaEDigitando(p, conexao)).resolves.toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rede");
      }),
    );
    await expect(a.marcarLidaEDigitando(p, conexao)).resolves.toBeUndefined();
    await expect(
      a.marcarLidaEDigitando({ destino: [], ids_externos: [] }, conexao),
    ).resolves.toBeUndefined();
  });
});

describe("marcarLida (só o lido)", () => {
  it("a Zernio não tem lido sem digitando: sem marcarLida, marcarSoLida não chama nada", async () => {
    expect(a.marcarLida).toBeUndefined();
    const f = falso(200, { success: true });
    const r = await marcarSoLida(
      a,
      { destino: [{ tipo: "zernio_conversa", valor: "conv_1" }], ids_externos: ["wamid.AAA"] },
      conexao,
    );
    expect(r).toBe(false);
    // nunca cai no endpoint de digitando
    expect(f).not.toHaveBeenCalled();
  });
});

describe("configurarWebhook", () => {
  const url = "https://app.exemplo/api/public/whatsapp/zernio/abc";
  it("cria quando não existe", async () => {
    const f = vi.fn(
      async (_u: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(init?.method === "GET" ? { webhooks: [] } : { webhook: { _id: "w1" } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", f);
    await a.configurarWebhook!(conexao, url);
    expect(f).toHaveBeenCalledTimes(2);
    const [u, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(u).toBe("https://zernio.com/api/v1/webhooks/settings");
    expect(init.method).toBe("POST");
    const corpo = JSON.parse(init.body as string);
    expect(corpo).toMatchObject({ url, secret: SEGREDO });
    expect(corpo.events).toContain("message.received");
    expect(corpo.events).toContain("message.read");
  });
  it("atualiza com PUT quando já existe a mesma url", async () => {
    const f = vi.fn(
      async (_u: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(init?.method === "GET" ? { webhooks: [{ _id: "w1", url }] } : {}),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", f);
    await a.configurarWebhook!(conexao, url);
    const init = (f.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toMatchObject({
      webhookId: "w1",
      url,
      secret: SEGREDO,
      isActive: true,
    });
  });
  it("manda accountIds e reaproveita o webhook nosso de outra URL; desativa as sobras", async () => {
    const f = vi.fn(
      async (_u: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "GET"
              ? {
                  webhooks: [
                    { _id: "w_previa", name: "Janete 1234", url: "https://previa/x" },
                    {
                      _id: "w_antigo",
                      url: "https://app.antigo/api/public/whatsapp/zernio/outra?t=1",
                    },
                    { _id: "w_alheio", name: "n8n", url: "https://n8n.exemplo/hook" },
                  ],
                }
              : {},
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", f);
    await a.configurarWebhook!(conexao, url);
    const corpos = f.mock.calls
      .slice(1)
      .map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(corpos[0]).toMatchObject({
      webhookId: "w_previa",
      url,
      secret: SEGREDO,
      accountIds: ["acc_1"],
      isActive: true,
    });
    expect(corpos[1]).toEqual({ webhookId: "w_antigo", isActive: false });
    expect(corpos).toHaveLength(2);
  });
  // M2 da revisão: no Trocar entre duas contas da mesma chave, o desligar atrasado da anterior
  // (depois do teto de 8 s) não pode desligar a entrada que a nova ligou
  it("não reaproveita a entrada de outra conexão: cria a sua e desativa a outra", async () => {
    const outra = "aaaaaaaa-2222-3333-4444-555555555555";
    const f = vi.fn(
      async (_u: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "GET"
              ? {
                  webhooks: [
                    {
                      _id: "w_outra",
                      name: "Janete aaaaaaaa",
                      url: `https://app.exemplo/api/public/whatsapp/zernio/${outra}`,
                      accountIds: ["acc_outra"],
                      isActive: true,
                    },
                    { _id: "w_outra_nome", name: "Janete aaaaaaaa", isActive: true },
                  ],
                }
              : {},
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", f);
    await a.configurarWebhook!(conexao, url);
    const pedidos = f.mock.calls.slice(1) as unknown as [string, RequestInit][];
    expect(pedidos[0]![1].method).toBe("POST");
    expect(JSON.parse(pedidos[0]![1].body as string)).not.toHaveProperty("webhookId");
    expect(pedidos.slice(1).map(([, init]) => JSON.parse(init.body as string))).toEqual([
      { webhookId: "w_outra", isActive: false },
      { webhookId: "w_outra_nome", isActive: false },
    ]);
  });
  it("reaproveita a entrada desta conexão com outra origem (prévia e publicado)", async () => {
    const f = vi.fn(
      async (_u: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "GET"
              ? {
                  webhooks: [
                    {
                      _id: "w_outra",
                      url: "https://app.exemplo/api/public/whatsapp/zernio/aaaaaaaa-2222-3333-4444-555555555555",
                    },
                    {
                      _id: "w_minha",
                      url: `https://previa.exemplo/api/public/whatsapp/zernio/${conexao.id}`,
                    },
                  ],
                }
              : {},
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", f);
    await a.configurarWebhook!(conexao, url);
    const pedidos = f.mock.calls.slice(1) as unknown as [string, RequestInit][];
    expect(pedidos[0]![1].method).toBe("PUT");
    expect(JSON.parse(pedidos[0]![1].body as string)).toMatchObject({
      webhookId: "w_minha",
      url,
      isActive: true,
    });
  });
  it("erro da Zernio lança ErroGateway", async () => {
    falso(401);
    await expect(a.configurarWebhook!(conexao, url)).rejects.toBeInstanceOf(ErroGateway);
  });
});

describe("desligarWebhook", () => {
  type Pedido = [string, RequestInit];
  function falsoLista(lista: unknown, statusPut = 200) {
    const f = vi.fn(
      async (_u: string, init?: RequestInit) =>
        new Response(JSON.stringify(init?.method === "GET" ? lista : {}), {
          status: init?.method === "GET" ? 200 : statusPut,
        }),
    );
    vi.stubGlobal("fetch", f);
    return f;
  }
  it("desativa só os webhooks desta conexão (2), e não o de terceiro", async () => {
    const f = falsoLista({
      webhooks: [
        {
          _id: "w1",
          url: `https://app.exemplo/api/public/whatsapp/zernio/${conexao.id}`,
          isActive: true,
        },
        { _id: "w2", name: "Terceiro", url: "https://crm.exemplo/hook", isActive: true },
        { webhookId: "w3", name: "Janete 11111111", url: "https://velho.exemplo/x" },
      ],
    });
    await a.desligarWebhook!(conexao);
    const chamadas = f.mock.calls as unknown as Pedido[];
    expect(chamadas).toHaveLength(3);
    expect(chamadas[0]![0]).toBe("https://zernio.com/api/v1/webhooks/settings");
    expect(chamadas[0]![1].method).toBe("GET");
    const puts = chamadas.slice(1);
    for (const [u, init] of puts) {
      expect(u).toBe("https://zernio.com/api/v1/webhooks/settings");
      expect(init.method).toBe("PUT");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${CHAVE}`);
    }
    expect(puts.map(([, init]) => JSON.parse(init.body as string))).toEqual([
      { webhookId: "w1", isActive: false },
      { webhookId: "w3", isActive: false },
    ]);
  });
  it("webhook de outra conexão (outra cópia da Janete ou outro cliente): não é tocado", async () => {
    const f = falsoLista([
      {
        _id: "o1",
        name: "Janete 99999999",
        url: "https://copia.exemplo/api/public/whatsapp/zernio/99999999-2222-3333-4444-555555555555",
        isActive: true,
      },
      { _id: "o2", name: "Janete outro", url: "https://x.exemplo/hook", isActive: true },
      { _id: "o3", name: "Janete CRM", url: "https://crm.exemplo/hook", isActive: true },
      {
        _id: "o4",
        url: `https://x.exemplo/api/public/whatsapp/zernio/${conexao.id}-b`,
        isActive: true,
      },
      // o nome bate, mas o webhook é de outra conta da Zernio
      { _id: "o5", name: "Janete 11111111", accountIds: ["acc_outra"], isActive: true },
    ]);
    await a.desligarWebhook!(conexao);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as Pedido)[1].method).toBe("GET");
  });
  it("aceita a url desta conexão com ?t= e o item com a conta desta conexão", async () => {
    const f = falsoLista([
      {
        _id: "w5",
        url: `https://app.exemplo/api/public/whatsapp/zernio/${conexao.id}?t=abc`,
        accountIds: ["acc_1"],
        isActive: true,
      },
    ]);
    await a.desligarWebhook!(conexao);
    const chamadas = f.mock.calls as unknown as Pedido[];
    expect(chamadas).toHaveLength(2);
    expect(JSON.parse(chamadas[1]![1].body as string)).toEqual({
      webhookId: "w5",
      isActive: false,
    });
  });
  it("sem webhook nosso (ou só nossos já desativados): não chama o PUT", async () => {
    const f = falsoLista([
      { _id: "w2", name: "Terceiro", url: "https://crm.exemplo/hook", isActive: true },
      {
        _id: "w4",
        name: "Janete 11111111",
        url: "https://x/api/public/whatsapp/zernio/y",
        isActive: false,
      },
    ]);
    await a.desligarWebhook!(conexao);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as Pedido)[1].method).toBe("GET");
  });
  it("falha HTTP na lista ou no PUT é lançada", async () => {
    falso(401);
    await expect(a.desligarWebhook!(conexao)).rejects.toBeInstanceOf(ErroGateway);
    falsoLista({ data: [{ _id: "w1", name: "Janete 11111111" }] }, 500);
    await expect(a.desligarWebhook!(conexao)).rejects.toBeInstanceOf(ErroGateway);
  });
  it("falha de rede é lançada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("falhou");
      }),
    );
    await expect(a.desligarWebhook!(conexao)).rejects.toBeInstanceOf(ErroGateway);
  });
});
