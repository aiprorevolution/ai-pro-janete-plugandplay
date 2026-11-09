// Testes do adaptador da Z-API. Fetch falso; payloads de exemplo da pesquisa e da documentação.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroGateway, type ConexaoServidor, type Evento } from "../../nucleo/tipos";
import { adaptadorZapi as a } from "./index";

const C: ConexaoServidor = {
  id: "c1",
  gateway: "zapi",
  id_externo: "INST123",
  parametros: {},
  segredos: {
    instanceToken: "tok-instancia-x",
    clientToken: "cli-token-y",
    tokenUrl: "url-token-z",
  },
  oficial: false,
};
const BASE = "https://api.z-api.io/instances/INST123/token/tok-instancia-x";
const MS = 1632228638000;
const ISO = new Date(MS).toISOString();

function falso(status = 200, corpo: unknown = { zaapId: "Z1", messageId: "M1", id: "M1" }) {
  const f = vi.fn(
    async () => new Response(corpo === null ? null : JSON.stringify(corpo), { status }),
  );
  vi.stubGlobal("fetch", f);
  return f;
}
const chamada = (f: ReturnType<typeof falso>, i = 0) => {
  const [url, init] = f.mock.calls[i] as unknown as [string, RequestInit];
  return { url, init, corpo: init.body ? JSON.parse(init.body as string) : undefined };
};

afterEach(() => vi.unstubAllGlobals());

const recebida = (extra: Record<string, unknown>) => ({
  type: "ReceivedCallback",
  instanceId: "INST123",
  messageId: "MSG1",
  phone: "5544999999999",
  senderLid: "81896604192873@lid",
  fromMe: false,
  momment: MS,
  status: "RECEIVED",
  chatName: "Fulano Exemplo",
  senderName: "Fulano Exemplo",
  isGroup: false,
  isNewsletter: false,
  isEdit: false,
  waitingMessage: false,
  isStatusReply: false,
  broadcast: false,
  ...extra,
});

describe("montarConexao", () => {
  const campos = { instanceId: " INST123 ", instanceToken: "t", clientToken: "c" };
  it("monta id, parametros e segredos", () => {
    const r = a.montarConexao(campos, { tokenUrl: "gerado" });
    expect(r.id_externo).toBe("INST123");
    expect(r.segredos).toEqual({ instanceToken: "t", clientToken: "c", tokenUrl: "gerado" });
    expect(JSON.stringify(r.parametros)).not.toContain("gerado");
  });
  it("campo faltando lança conexao_invalida definitivo", () => {
    for (const falta of ["instanceId", "instanceToken", "clientToken"]) {
      const c = { ...campos, [falta]: "" };
      expect(() => a.montarConexao(c, { tokenUrl: "g" })).toThrow(ErroGateway);
      try {
        a.montarConexao(c, { tokenUrl: "g" });
      } catch (e) {
        expect((e as ErroGateway).codigo).toBe("conexao_invalida");
        expect((e as ErroGateway).definitivo).toBe(true);
      }
    }
    expect(() => a.montarConexao(campos, {})).toThrow(ErroGateway);
  });
});

describe("validarWebhook", () => {
  const req = (t?: string) =>
    new Request(`https://app.exemplo/api/public/whatsapp/zapi/c1${t ? `?t=${t}` : ""}`, {
      method: "POST",
    });
  it("token certo passa", async () => {
    expect(await a.validarWebhook(req("url-token-z"), "{}", C)).toBe(true);
  });
  it("token errado, ausente ou segredo vazio falham", async () => {
    expect(await a.validarWebhook(req("errado"), "{}", C)).toBe(false);
    expect(await a.validarWebhook(req(), "{}", C)).toBe(false);
    const vazio = { ...C, segredos: { ...C.segredos, tokenUrl: "" } };
    expect(await a.validarWebhook(req(), "{}", vazio)).toBe(false);
  });
  it("instanceId do corpo tem de bater", async () => {
    expect(await a.validarWebhook(req("url-token-z"), '{"instanceId":"INST123"}', C)).toBe(true);
    expect(await a.validarWebhook(req("url-token-z"), '{"instanceId":"OUTRA"}', C)).toBe(false);
  });
});

describe("traduzir", () => {
  const um = (corpo: unknown): Evento => {
    const r = a.traduzir(corpo, C);
    expect(r).toHaveLength(1);
    return r[0]!;
  };

  it("texto de entrada: lid primeiro, depois telefone", () => {
    const ev = um(recebida({ text: { message: "teste" } }));
    expect(ev).toEqual({
      tipo: "entrada",
      ids: [
        { tipo: "lid", valor: "81896604192873@lid" },
        { tipo: "telefone", valor: "5544999999999" },
      ],
      nome_whatsapp: "Fulano Exemplo",
      msg: { id_externo: "MSG1", tipo: "texto", texto: "teste", momento: ISO },
    });
  });

  it("áudio com url e mime sem parâmetros", () => {
    const ev = um(
      recebida({
        audio: {
          audioUrl: "https://f.z-api.io/a.ogg",
          mimeType: "audio/ogg; codecs=opus",
          seconds: 3,
          ptt: true,
        },
      }),
    );
    expect(ev.tipo).toBe("entrada");
    if (ev.tipo !== "entrada") return;
    expect(ev.msg).toMatchObject({
      tipo: "audio",
      midia_ref_externa: "https://f.z-api.io/a.ogg",
      midia_mime: "audio/ogg",
    });
  });

  it("imagem com legenda", () => {
    const ev = um(
      recebida({
        image: { imageUrl: "https://f.z-api.io/i.jpg", mimeType: "image/jpeg", caption: "olha" },
      }),
    );
    if (ev.tipo !== "entrada") throw new Error("esperava entrada");
    expect(ev.msg).toMatchObject({
      tipo: "imagem",
      texto: "olha",
      midia_ref_externa: "https://f.z-api.io/i.jpg",
    });
  });

  it("documento com nome", () => {
    const ev = um(
      recebida({
        document: {
          documentUrl: "https://f.z-api.io/d.pdf",
          mimeType: "application/pdf",
          fileName: "proposta.pdf",
        },
      }),
    );
    if (ev.tipo !== "entrada") throw new Error("esperava entrada");
    expect(ev.msg).toMatchObject({
      tipo: "documento",
      midia_nome: "proposta.pdf",
      midia_mime: "application/pdf",
    });
  });

  it("figurinha, localização e contato", () => {
    const f = um(
      recebida({ sticker: { stickerUrl: "https://f.z-api.io/s.webp", mimeType: "image/webp" } }),
    );
    if (f.tipo !== "entrada") throw new Error("esperava entrada");
    expect(f.msg.tipo).toBe("figurinha");
    const l = um(recebida({ location: { latitude: -23.5, longitude: -46.6, name: "Praça" } }));
    if (l.tipo !== "entrada") throw new Error("esperava entrada");
    expect(l.msg.tipo).toBe("outro");
    expect(l.msg.texto).toContain("-23.5, -46.6");
    const c = um(recebida({ contact: { displayName: "Maria Exemplo", vCard: "BEGIN:VCARD" } }));
    if (c.tipo !== "entrada") throw new Error("esperava entrada");
    expect(c.msg.texto).toContain("Maria Exemplo");
  });

  it("eco do próprio número vira saida_celular e usa zaapId e edição", () => {
    const ev = um(
      recebida({
        fromMe: true,
        zaapId: "ZAAP9",
        isEdit: true,
        text: { message: "oi" },
        senderLid: "999@lid",
      }),
    );
    expect(ev.tipo).toBe("saida_celular");
    if (ev.tipo !== "saida_celular") return;
    expect(ev.msg).toMatchObject({ id_externo: "MSG1", id_gateway: "ZAAP9", editada: true });
    // o senderLid de uma mensagem minha não é o contato
    expect(ev.ids).toEqual([{ tipo: "telefone", valor: "5544999999999" }]);
  });

  it("status entregue e lido, com vários ids", () => {
    const base = {
      type: "MessageStatusCallback",
      instanceId: "INST123",
      momment: MS,
      phone: "5544999999999",
    };
    expect(a.traduzir({ ...base, status: "RECEIVED", ids: ["A", "B"] }, C)).toEqual([
      { tipo: "status", id: "A", status: "entregue", momento: ISO },
      { tipo: "status", id: "B", status: "entregue", momento: ISO },
    ]);
    expect(um({ ...base, status: "READ", ids: ["A"] })).toEqual({
      tipo: "status",
      id: "A",
      status: "lida",
      momento: ISO,
    });
    expect(um({ ...base, status: "READ_BY_ME", ids: ["A"] }).tipo).toBe("ignorar");
  });

  it("DeliveryCallback no formato da v2 (só zaapId, sem momment) não se perde", () => {
    const ev = um({
      type: "DeliveryCallback",
      phone: "5544999999999",
      zaapId: "Z9",
      error: "The message was not sent due to a likely shadow ban",
    });
    expect(ev).toMatchObject({ tipo: "status", id: "Z9", status: "falhou" });
    const momento = ev.tipo === "status" ? Date.parse(ev.momento) : 0;
    expect(Math.abs(Date.now() - momento)).toBeLessThan(5_000);
  });
  it("MessageStatusCallback com id (texto) em vez de ids e momment em texto", () => {
    expect(
      um({ type: "MessageStatusCallback", status: "READ", id: "A", momment: String(MS) }),
    ).toEqual({ tipo: "status", id: "A", status: "lida", momento: ISO });
    expect(um({ type: "MessageStatusCallback", status: "RECEIVED", ids: ["B"] })).toMatchObject({
      tipo: "status",
      id: "B",
      status: "entregue",
    });
  });
  it("resposta do lead ao Status da empresa vira entrada com marcador", () => {
    const ev = um(recebida({ isStatusReply: true, text: { message: "quanto custa?" } }));
    expect(ev).toMatchObject({
      tipo: "entrada",
      msg: { tipo: "texto", texto: "[resposta ao seu status] quanto custa?" },
    });
    const img = um(
      recebida({
        isStatusReply: true,
        statusImage: { imageUrl: "https://f.z-api.io/s.jpg", mimeType: "image/jpeg" },
      }),
    );
    expect(img).toMatchObject({
      tipo: "entrada",
      msg: { tipo: "imagem", midia_ref_externa: "https://f.z-api.io/s.jpg" },
    });
  });
  it("DeliveryCallback com e sem erro", () => {
    const ok = um({ type: "DeliveryCallback", messageId: "M1", zaapId: "Z1", momment: MS });
    expect(ok).toMatchObject({ tipo: "status", id: "M1", status: "enviada" });
    const erro = um({
      type: "DeliveryCallback",
      messageId: "M2",
      momment: MS,
      error: "Phone number does not exist",
    });
    expect(erro).toMatchObject({ tipo: "status", id: "M2", status: "falhou" });
  });

  it("conexão: desconectou e conectou", () => {
    expect(
      um({
        type: "DisconnectedCallback",
        momment: MS,
        error: "Device has been disconnected",
        disconnected: true,
      }),
    ).toEqual({ tipo: "conexao", status: "desconectada", detalhe: "Device has been disconnected" });
    expect(
      um({ type: "ConnectedCallback", connected: true, momment: MS, instanceId: "INST123" }),
    ).toEqual({
      tipo: "conexao",
      status: "conectada",
    });
  });

  it("grupo, transmissão, status, reação e notificação são ignorados", () => {
    const motivos = [
      recebida({ isGroup: true, phone: "120363@g.us", text: { message: "x" } }),
      recebida({ broadcast: true, text: { message: "x" } }),
      recebida({ phone: "status@broadcast", text: { message: "x" } }),
      recebida({ reaction: { value: "👍", referencedMessage: { messageId: "M0" } } }),
      recebida({ notification: "CALL_MISSED_VOICE" }),
      recebida({ isNewsletter: true, text: { message: "x" } }),
    ].map((c) => um(c).tipo);
    expect(motivos.every((t) => t === "ignorar")).toBe(true);
  });

  it("contato só com lid funciona; sem nenhum identificador ignora", () => {
    const ev = um(recebida({ phone: "999999@lid", senderLid: undefined, text: { message: "oi" } }));
    if (ev.tipo !== "entrada") throw new Error("esperava entrada");
    expect(ev.ids).toEqual([{ tipo: "lid", valor: "999999@lid" }]);
    expect(
      um(recebida({ phone: undefined, senderLid: undefined, text: { message: "oi" } })).tipo,
    ).toBe("ignorar");
  });

  it("corpo lixo vira ignorar sem lançar", () => {
    for (const lixo of [
      null,
      undefined,
      42,
      "texto",
      [],
      {},
      { type: 7 },
      { type: "ReceivedCallback" },
    ]) {
      const r = a.traduzir(lixo, C);
      expect(r[0]?.tipo).toBe("ignorar");
    }
  });
});

describe("baixarMidia", () => {
  it("GET direto na url pública, sem credenciais", async () => {
    const f = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/ogg; codecs=opus" },
        }),
    );
    vi.stubGlobal("fetch", f);
    const r = await a.baixarMidia("https://f.z-api.io/a.ogg", C);
    expect(Array.from(r.bytes)).toEqual([1, 2, 3]);
    expect(r.mime).toBe("audio/ogg");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://f.z-api.io/a.ogg");
    expect(init.method).toBe("GET");
    expect(init.headers).toBeUndefined();
  });
  it("sem content-type, ou com um genérico, devolve mime vazio (vale o do webhook)", async () => {
    for (const cab of [{}, { "content-type": "application/octet-stream" }]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: cab })),
      );
      const r = await a.baixarMidia("https://f.z-api.io/a.ogg", C);
      expect(r.mime).toBe("");
    }
  });
  it("com o prazo do worker, desiste antes dele (tempo_esgotado, passageiro)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, falhar) => {
            init.signal?.addEventListener("abort", () => falhar(new Error("abortado")), {
              once: true,
            });
          }),
      ),
    );
    const inicio = Date.now();
    // prazo de 1,1 s com folga de 1 s: o pedido tem ~100 ms
    await expect(
      a.baixarMidia("https://f.z-api.io/a.ogg", C, { fimEm: inicio + 1_100 }),
    ).rejects.toMatchObject({ codigo: "tempo_esgotado", definitivo: false });
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });
  it("acima de 25 MB (Content-Length) recusa sem ler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), {
            status: 200,
            headers: { "content-length": String(60 * 1024 * 1024) },
          }),
      ),
    );
    await expect(a.baixarMidia("https://f.z-api.io/v.mp4", C)).rejects.toMatchObject({
      codigo: "midia_grande_demais",
      definitivo: true,
    });
  });
  it("url não https é recusada; 404 é definitivo; 500 não", async () => {
    await expect(a.baixarMidia("http://x/a", C)).rejects.toMatchObject({ definitivo: true });
    falso(404, null);
    await expect(a.baixarMidia("https://f.z-api.io/a", C)).rejects.toMatchObject({
      definitivo: true,
    });
    falso(500, null);
    await expect(a.baixarMidia("https://f.z-api.io/a", C)).rejects.toMatchObject({
      definitivo: false,
    });
  });
});

describe("enviar", () => {
  it("texto: telefone primeiro, cabeçalhos e ids devolvidos", async () => {
    const f = falso();
    const r = await a.enviar(
      {
        destino: [
          { tipo: "lid", valor: "1@lid" },
          { tipo: "telefone", valor: "5544999999999" },
        ],
        tipo: "texto",
        texto: "olá",
      },
      C,
    );
    expect(r).toEqual({ id_externo: "M1", id_gateway: "Z1" });
    const { url, init, corpo } = chamada(f);
    expect(url).toBe(`${BASE}/send-text`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Client-Token"]).toBe("cli-token-y");
    expect(corpo).toEqual({ phone: "5544999999999", message: "olá", delayTyping: 2 });
  });
  it("sem telefone usa o lid, sempre com o sufixo @lid", async () => {
    const f = falso();
    await a.enviar({ destino: [{ tipo: "lid", valor: "1@lid" }], tipo: "texto", texto: "x" }, C);
    expect(chamada(f).corpo.phone).toBe("1@lid");
    // lid gravado só com os dígitos (formato do núcleo, ou vindo da Evolution) não vira telefone
    const g = falso();
    await a.enviar(
      { destino: [{ tipo: "lid", valor: "123456789012345" }], tipo: "texto", texto: "x" },
      C,
    );
    expect(chamada(g).corpo.phone).toBe("123456789012345@lid");
  });
  it("imagem, áudio e documento", async () => {
    const f = falso();
    const destino = [{ tipo: "telefone" as const, valor: "5544999999999" }];
    await a.enviar(
      { destino, tipo: "imagem", texto: "veja", midia: { url: "https://s/i", mime: "image/png" } },
      C,
    );
    await a.enviar({ destino, tipo: "audio", midia: { url: "https://s/a", mime: "audio/ogg" } }, C);
    await a.enviar(
      {
        destino,
        tipo: "documento",
        midia: { url: "https://s/d", mime: "application/pdf", nome: "proposta.pdf" },
      },
      C,
    );
    expect(chamada(f, 0)).toMatchObject({
      url: `${BASE}/send-image`,
      corpo: { image: "https://s/i", caption: "veja" },
    });
    expect(chamada(f, 1)).toMatchObject({
      url: `${BASE}/send-audio`,
      corpo: { audio: "https://s/a" },
    });
    expect(chamada(f, 2)).toMatchObject({
      url: `${BASE}/send-document/pdf`,
      corpo: { document: "https://s/d", fileName: "proposta.pdf" },
    });
  });
  it("áudio da Janete com texto no pedido: send-audio, sem legenda", async () => {
    const f = falso();
    const destino = [{ tipo: "telefone" as const, valor: "5544999999999" }];
    await a.enviar(
      {
        destino,
        tipo: "audio",
        texto: "transcrição da fala",
        midia: { url: "https://s/v", mime: "audio/ogg" },
      },
      C,
    );
    expect(chamada(f).url).toBe(`${BASE}/send-audio`);
    expect(chamada(f).corpo).toEqual({ phone: "5544999999999", audio: "https://s/v" });
  });
  it("400 é definitivo; 429, 500 e rede não", async () => {
    const p = {
      destino: [{ tipo: "telefone" as const, valor: "5544999999999" }],
      tipo: "texto" as const,
      texto: "x",
    };
    falso(400, { error: "bad" });
    await expect(a.enviar(p, C)).rejects.toMatchObject({ codigo: "http_400", definitivo: true });
    falso(429, null);
    await expect(a.enviar(p, C)).rejects.toMatchObject({ definitivo: false });
    falso(408, null);
    await expect(a.enviar(p, C)).rejects.toMatchObject({ definitivo: false });
    falso(500, null);
    await expect(a.enviar(p, C)).rejects.toMatchObject({ definitivo: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom tok-instancia-x");
      }),
    );
    const e = (await a.enviar(p, C).catch((x: unknown) => x)) as ErroGateway;
    expect(e).toBeInstanceOf(ErroGateway);
    expect(e.definitivo).toBe(false);
    expect(e.message).not.toContain("tok-instancia-x");
  });
  it("sem destino ou sem texto: definitivo", async () => {
    await expect(a.enviar({ destino: [], tipo: "texto", texto: "x" }, C)).rejects.toMatchObject({
      definitivo: true,
    });
  });
});

describe("marcarLidaEDigitando", () => {
  const p = {
    destino: [{ tipo: "telefone" as const, valor: "5544999999999" }],
    ids_externos: ["A", "B"],
  };
  it("chama read-message por id", async () => {
    const f = falso(204, null);
    await a.marcarLidaEDigitando(p, C);
    expect(f).toHaveBeenCalledTimes(2);
    expect(chamada(f, 0)).toMatchObject({
      url: `${BASE}/read-message`,
      corpo: { phone: "5544999999999", messageId: "A" },
    });
  });
  it("falha não lança", async () => {
    falso(500, null);
    await expect(a.marcarLidaEDigitando(p, C)).resolves.toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("x");
      }),
    );
    await expect(a.marcarLidaEDigitando(p, C)).resolves.toBeUndefined();
    await expect(a.marcarLidaEDigitando(p, { ...C, segredos: {} })).resolves.toBeUndefined();
  });
});

describe("citação", () => {
  const destino = [{ tipo: "telefone" as const, valor: "5544999999999" }];
  it("entrada do lead citando: responde_a_id_externo com o referenceMessageId aparado", () => {
    const [ev] = a.traduzir(
      recebida({ text: { message: "sim, esse" }, referenceMessageId: " 3EB0CITADA " }),
      C,
    ) as Extract<Evento, { tipo: "entrada" }>[];
    expect(ev?.tipo).toBe("entrada");
    expect(ev?.msg.responde_a_id_externo).toBe("3EB0CITADA");
    expect(ev?.msg.texto).toBe("sim, esse");
  });
  it("celular da empresa citando (fromMe) também leva a citação", () => {
    const [ev] = a.traduzir(
      recebida({
        fromMe: true,
        messageId: "MSG9",
        image: { imageUrl: "https://f.z-api.io/i.jpg", mimeType: "image/jpeg" },
        referenceMessageId: "MSG1",
      }),
      C,
    ) as Extract<Evento, { tipo: "saida_celular" }>[];
    expect(ev?.tipo).toBe("saida_celular");
    expect(ev?.msg.responde_a_id_externo).toBe("MSG1");
  });
  it("sem citação, ou com referenceMessageId vazio ou nulo, a chave fica de fora", () => {
    for (const extra of [{}, { referenceMessageId: "" }, { referenceMessageId: null }]) {
      const [ev] = a.traduzir(recebida({ text: { message: "oi" }, ...extra }), C) as Extract<
        Evento,
        { tipo: "entrada" }
      >[];
      expect(ev?.tipo).toBe("entrada");
      expect("responde_a_id_externo" in (ev?.msg ?? {})).toBe(false);
    }
  });
  it("envio de texto citando manda messageId com o id da citada (aparado)", async () => {
    const f = falso();
    await a.enviar({ destino, tipo: "texto", texto: "isso", respondeA: " MSG1 " }, C);
    expect(chamada(f).url).toBe(`${BASE}/send-text`);
    expect(chamada(f).corpo).toEqual({
      phone: "5544999999999",
      message: "isso",
      delayTyping: 2,
      messageId: "MSG1",
    });
  });
  it("envio de imagem, áudio e documento citando também leva messageId", async () => {
    const f = falso();
    const respondeA = "MSG1";
    await a.enviar(
      { destino, tipo: "imagem", midia: { url: "https://s/i", mime: "image/png" }, respondeA },
      C,
    );
    await a.enviar(
      { destino, tipo: "audio", midia: { url: "https://s/a", mime: "audio/ogg" }, respondeA },
      C,
    );
    await a.enviar(
      {
        destino,
        tipo: "documento",
        midia: { url: "https://s/d", mime: "application/pdf", nome: "p.pdf" },
        respondeA,
      },
      C,
    );
    for (const i of [0, 1, 2]) expect(chamada(f, i).corpo.messageId).toBe("MSG1");
  });
  it("respondeA null, vazio ou ausente: sem messageId no corpo", async () => {
    for (const respondeA of [null, "", "   ", undefined]) {
      const f = falso();
      const extra = respondeA === undefined ? {} : { respondeA };
      await a.enviar({ destino, tipo: "texto", texto: "x", ...extra }, C);
      expect("messageId" in chamada(f).corpo).toBe(false);
    }
  });
});

describe("marcarLida (só o lido)", () => {
  const ref = {
    destino: [{ tipo: "telefone" as const, valor: "5544999999999" }],
    ids_externos: ["A", " ", "B"],
  };
  it("faz só read-message (POST), um por id válido, sem nada de digitando", async () => {
    const f = falso(200, { value: true });
    await a.marcarLida!(ref, C);
    expect(f).toHaveBeenCalledTimes(2);
    for (const i of [0, 1]) {
      expect(chamada(f, i).url).toBe(`${BASE}/read-message`);
      expect(chamada(f, i).init.method).toBe("POST");
    }
    expect(chamada(f, 0).corpo).toEqual({ phone: "5544999999999", messageId: "A" });
    expect(chamada(f, 1).corpo).toEqual({ phone: "5544999999999", messageId: "B" });
  });
  it("aceita 204 sem corpo e manda o lid com @lid quando não há telefone", async () => {
    const f = falso(204, null);
    await a.marcarLida!(
      { destino: [{ tipo: "lid", valor: "123456789012345" }], ids_externos: ["A"] },
      C,
    );
    expect(chamada(f).corpo).toEqual({ phone: "123456789012345@lid", messageId: "A" });
  });
  it("prazo do worker já vencido, sem destino ou sem ids: não chama a API (false)", async () => {
    const f = falso();
    await expect(a.marcarLida!(ref, C, { fimEm: Date.now() - 1 })).resolves.toBe(false);
    await expect(a.marcarLida!({ destino: [], ids_externos: ["A"] }, C)).resolves.toBe(false);
    await expect(a.marcarLida!({ ...ref, ids_externos: [] }, C)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("devolve true com um read-message aceito", async () => {
    falso(200, { value: true });
    await expect(a.marcarLida!(ref, C)).resolves.toBe(true);
  });
  it("falha de API, de rede ou de credencial não lança e devolve false", async () => {
    falso(500, null);
    await expect(a.marcarLida!(ref, C)).resolves.toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("x");
      }),
    );
    await expect(a.marcarLida!(ref, C)).resolves.toBe(false);
    await expect(a.marcarLida!(ref, { ...C, segredos: {} })).resolves.toBe(false);
  });
  it("marcarSoLida do núcleo usa o marcarLida da Z-API", async () => {
    const { marcarSoLida } = await import("../../nucleo/lida");
    const f = falso(204, null);
    await expect(marcarSoLida(a, ref, C)).resolves.toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("configurarWebhook", () => {
  it("faz os 7 pedidos PUT na ordem (com recebidas-e-enviadas e Ao enviar)", async () => {
    const f = falso(200, { value: true });
    const url = "https://app.exemplo/api/public/whatsapp/zapi/c1?t=url-token-z";
    await a.configurarWebhook!(C, url);
    expect(f).toHaveBeenCalledTimes(7);
    const rotas = [0, 1, 2, 3, 4, 5, 6].map((i) => chamada(f, i).url.replace(`${BASE}/`, ""));
    expect(rotas).toEqual([
      "update-webhook-received",
      "update-webhook-received-delivery",
      "update-notify-sent-by-me",
      "update-webhook-message-status",
      "update-webhook-delivery",
      "update-webhook-disconnected",
      "update-webhook-connected",
    ]);
    expect(chamada(f, 0).init.method).toBe("PUT");
    expect(chamada(f, 0).corpo).toEqual({ value: url });
    expect(chamada(f, 1).corpo).toEqual({ value: url });
    expect(chamada(f, 2).corpo).toEqual({ notifySentByMe: true });
    expect(chamada(f, 4).corpo).toEqual({ value: url });
    expect(chamada(f, 6).corpo).toEqual({ value: url });
  });
  it("falha vira ErroGateway", async () => {
    falso(401, null);
    await expect(a.configurarWebhook!(C, "https://x?t=1")).rejects.toMatchObject({
      definitivo: true,
    });
  });
});

describe("documento: extensão do caminho", () => {
  it("usa a tabela ampliada e o subtipo do mime, não pdf", async () => {
    const casos: [string, string][] = [
      ["image/jpeg", "jpg"],
      ["audio/ogg", "ogg"],
      ["image/heic", "heic"],
      ["application/octet-stream", "pdf"],
    ];
    for (const [mime, ext] of casos) {
      const f = falso();
      await a.enviar(
        {
          destino: [{ tipo: "telefone", valor: "5544999999999" }],
          tipo: "documento",
          midia: { url: "https://x.exemplo/a", mime, nome: "arquivo" },
        },
        C,
      );
      expect(chamada(f).url).toBe(`${BASE}/send-document/${ext}`);
    }
  });
});

describe("desligarWebhook", () => {
  it("não existe: a API não permite, a tela lembra de tirar no painel", () => {
    expect(a.desligarWebhook).toBeUndefined();
  });
});
