import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { banco, limparBanco } from "./__testes__/dubles";

const estado = vi.hoisted(() => ({
  chaves: {} as Record<string, unknown>,
  /** quando definido, lerChaveIA lança este erro (cifra_invalida) */
  erroChave: null as Error | null,
}));

vi.mock("@/integrations/firebase/client.server", async () => ({
  firebaseAdmin: (await import("./__testes__/dubles")).firebaseFalso,
}));
vi.mock("../nucleo/conexoes.server", () => ({
  lerChaveIA: async (finalidade: string) => {
    if (estado.erroChave) throw estado.erroChave;
    return estado.chaves[finalidade] ?? null;
  },
}));

const { falar, lerConfigVoz, vozEmUso, ELEVENLABS_FALA } = await import("./falar.server");
const { MAX_CARACTERES_FALA, MODELO_FALA } = await import("./fala");

const SEGREDO = "sk_eleven_segredo_0000_9999";
const VOZ = "voz_Abc-123";

type Pedido = { url: string; init: RequestInit };
let pedidos: Pedido[] = [];

type Resposta =
  | { status: number; corpo?: unknown; bytes?: Uint8Array; cabecalhos?: Record<string, string> }
  | Error;

/** fetch falso que devolve as respostas em ordem (repete a última). */
function responderSequencia(respostas: Resposta[]) {
  pedidos = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      const r = respostas[Math.min(i++, respostas.length - 1)];
      if (!r || r instanceof Error) throw r ?? new TypeError("fetch failed");
      if (r.bytes) {
        return new Response(r.bytes.slice(), {
          status: r.status,
          headers: { "content-type": "audio/ogg", ...(r.cabecalhos ?? {}) },
        });
      }
      return new Response(JSON.stringify(r.corpo ?? {}), {
        status: r.status,
        headers: { "content-type": "application/json", ...(r.cabecalhos ?? {}) },
      });
    }),
  );
}

// OGG/Opus mínimo: OpusHead (pre-skip 312) e uma página de áudio com 7 s
function pagina(granule: bigint, dados: Uint8Array, numero: number): Uint8Array {
  const b = new Uint8Array(27 + 1 + dados.length);
  const v = new DataView(b.buffer);
  b.set([0x4f, 0x67, 0x67, 0x53], 0);
  b[5] = numero === 0 ? 0x02 : 0;
  v.setBigInt64(6, granule, true);
  v.setUint32(14, 0x1234, true);
  v.setUint32(18, numero, true);
  b[26] = 1;
  b[27] = dados.length;
  b.set(dados, 28);
  return b;
}
function oggDe7Segundos(): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1;
  head[9] = 1;
  new DataView(head.buffer).setUint16(10, 312, true);
  const p1 = pagina(0n, head, 0);
  const p2 = pagina(BigInt(48_000 * 7 + 312), new Uint8Array([1, 2, 3, 4]), 1);
  const ogg = new Uint8Array(p1.length + p2.length);
  ogg.set(p1, 0);
  ogg.set(p2, p1.length);
  return ogg;
}
const OGG = oggDe7Segundos();
const OK: Resposta = { status: 200, bytes: OGG, cabecalhos: { "request-id": "req_fala_1" } };

function chaveVoz(status = "ativa") {
  estado.chaves["voz"] = {
    id: "ch_voz",
    provedor: "elevenlabs",
    modelo: "",
    workspace_id: null,
    chave: SEGREDO,
  };
  banco.tabelas["ia_chaves"]?.push({ id: "ch_voz", finalidade: "voz", status });
}

function chamadas() {
  return (banco.tabelas["ia_chamadas"] ?? []) as Record<string, unknown>[];
}
function chaveNoBanco() {
  return banco.tabelas["ia_chaves"]?.find((c) => c["id"] === "ch_voz");
}
function configuracao() {
  return banco.tabelas["configuracao"]?.[0];
}
function cabecalhos(i = 0) {
  return (pedidos[i]?.init.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  limparBanco({
    ia_chaves: [],
    configuracao: [{ id: 1, voz_resposta: "quando_audio", voz_id: VOZ, voz_erro: null }],
    ia_precos: [
      {
        id: "p_fala",
        provedor: "elevenlabs",
        modelo: MODELO_FALA,
        vigente_desde: "2026-11-02",
        a_partir_de_tokens: 0,
        por_mil_caracteres: 0.08,
        audio_por_minuto: null,
      },
    ],
  });
  estado.chaves = {};
  estado.erroChave = null;
  pedidos = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("falar", () => {
  it("pede a fala com URL, corpo e cabeçalho certos e devolve o áudio", async () => {
    responderSequencia([OK]);
    chaveVoz();
    const r = await falar("Oi, Ana! Tudo bem?", { vozId: VOZ, rodadaId: "r1", conversaId: "c1" });

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(`${ELEVENLABS_FALA}/${VOZ}?output_format=opus_48000_32`);
    expect(pedidos[0]?.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voz_Abc-123?output_format=opus_48000_32",
    );
    expect(pedidos[0]?.init.method).toBe("POST");
    expect(pedidos[0]?.init.redirect).toBe("manual");
    expect(cabecalhos()["xi-api-key"]).toBe(SEGREDO);
    expect(cabecalhos()["Content-Type"]).toBe("application/json");
    expect(Object.keys(cabecalhos()).map((k) => k.toLowerCase())).not.toContain("authorization");
    const corpo = JSON.parse(String(pedidos[0]?.init.body));
    expect(corpo).toEqual({ text: "Oi, Ana! Tudo bem?", model_id: "eleven_multilingual_v2" });
    expect(corpo).not.toHaveProperty("language_code");

    expect(r).toEqual({
      ok: true,
      bytes: OGG,
      mime: "audio/ogg",
      caracteres: 18,
      duracaoS: 7,
    });
  });

  it("grava a linha de custo com caracteres e por_mil_caracteres (pontos de código)", async () => {
    responderSequencia([OK]);
    chaveVoz();
    await falar("ação 😀", { vozId: VOZ, rodadaId: "r1", conversaId: "c1" });
    expect(chamadas()).toHaveLength(1);
    const linha = chamadas()[0]!;
    expect(linha).toEqual(
      expect.objectContaining({
        tipo: "fala",
        provedor: "elevenlabs",
        modelo: "eleven_multilingual_v2",
        caracteres: 6,
        rodada_id: "r1",
        conversa_id: "c1",
        custo_origem: "tabela",
        preco_id: "p_fala",
        request_id: "req_fala_1",
      }),
    );
    expect(linha["custo_usd"]).toBeCloseTo((0.08 * 6) / 1000, 12);
  });

  it("request_id cai para x-request-id; sem preço, a linha fica sem_preco", async () => {
    banco.tabelas["ia_precos"] = [];
    responderSequencia([{ status: 200, bytes: OGG, cabecalhos: { "x-request-id": "req_x" } }]);
    chaveVoz();
    await falar("Oi", { vozId: VOZ });
    expect(chamadas()[0]).toEqual(
      expect.objectContaining({
        request_id: "req_x",
        custo_usd: null,
        custo_origem: "sem_preco",
        rodada_id: null,
        conversa_id: null,
      }),
    );
  });

  it("texto vazio ou acima de 1.000 caracteres: recusada, sem fetch", async () => {
    responderSequencia([OK]);
    chaveVoz();
    expect(await falar("   ", { vozId: VOZ })).toEqual({ ok: false, erro: "recusada" });
    expect(await falar("a".repeat(MAX_CARACTERES_FALA + 1), { vozId: VOZ })).toEqual({
      ok: false,
      erro: "recusada",
    });
    expect(pedidos).toHaveLength(0);
    expect(chamadas()).toHaveLength(0);
  });

  it("com menos de 4 s até o prazo: sem_tempo, sem fetch", async () => {
    responderSequencia([OK]);
    chaveVoz();
    // tempo = fimEm - agora - 1 s = 3,9 s
    expect(await falar("Oi", { vozId: VOZ, fimEm: Date.now() + 4_900 })).toEqual({
      ok: false,
      erro: "sem_tempo",
    });
    expect(pedidos).toHaveLength(0);
  });

  it("o tempo do pedido é o menor entre 15 s e o prazo menos 1 s", async () => {
    const espiao = vi.spyOn(AbortSignal, "timeout");
    try {
      responderSequencia([OK]);
      chaveVoz();
      await falar("Oi", { vozId: VOZ });
      expect(espiao.mock.calls[0]?.[0]).toBe(15_000);
      await falar("Oi", { vozId: VOZ, fimEm: Date.now() + 9_000 });
      const ms = espiao.mock.calls[1]?.[0] ?? 0;
      expect(ms).toBeLessThanOrEqual(8_000);
      expect(ms).toBeGreaterThan(7_500);
    } finally {
      espiao.mockRestore();
    }
  });

  it("a leitura da chave gasta o prazo: sobrando menos de 4 s, sem_tempo e nenhum pedido", async () => {
    responderSequencia([OK]);
    chaveVoz();
    // tempoTotal = 15 s (fimEm + 1 s folgado); a leitura da chave "leva" 11,5 s e sobram 3,5 s
    const t0 = Date.now();
    let agora = t0;
    const relogio = vi.spyOn(Date, "now").mockImplementation(() => agora);
    estado.chaves["voz"] = new Proxy(estado.chaves["voz"] as object, {
      get(alvo, campo, rec) {
        if (campo === "chave") agora = t0 + 11_500;
        return Reflect.get(alvo, campo, rec);
      },
    });
    try {
      expect(await falar("Oi", { vozId: VOZ, fimEm: t0 + 16_000 })).toEqual({
        ok: false,
        erro: "sem_tempo",
      });
      expect(pedidos).toHaveLength(0);
      expect(chamadas()).toHaveLength(0);
      expect(chaveNoBanco()?.["status"]).toBe("ativa");
    } finally {
      relogio.mockRestore();
    }
  });

  it("o 1º pedido fica só com o que sobra depois de ler a chave", async () => {
    const espiao = vi.spyOn(AbortSignal, "timeout");
    responderSequencia([OK]);
    chaveVoz();
    // tempoTotal = 15 s; a leitura da chave "leva" 9 s e sobram uns 6 s para o pedido
    const t0 = Date.now();
    let agora = t0;
    const relogio = vi.spyOn(Date, "now").mockImplementation(() => agora);
    estado.chaves["voz"] = new Proxy(estado.chaves["voz"] as object, {
      get(alvo, campo, rec) {
        if (campo === "chave") agora = t0 + 9_000;
        return Reflect.get(alvo, campo, rec);
      },
    });
    try {
      const r = await falar("Oi", { vozId: VOZ, fimEm: t0 + 16_000 });
      expect(r.ok).toBe(true);
      expect(pedidos).toHaveLength(1);
      const ms = espiao.mock.calls[0]?.[0] ?? 0;
      expect(ms).toBe(6_000);
      expect(ms).toBeLessThan(15_000);
    } finally {
      relogio.mockRestore();
      espiao.mockRestore();
    }
  });

  it("sem chave da voz (ou removida): sem_chave, sem fetch", async () => {
    responderSequencia([OK]);
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "sem_chave" });
    chaveVoz("removida");
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "sem_chave" });
    expect(pedidos).toHaveLength(0);
  });

  it("cifra_invalida marca a chave como inválida e dá sem_chave", async () => {
    responderSequencia([OK]);
    chaveVoz();
    estado.erroChave = new Error("cifra_invalida");
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "sem_chave" });
    expect(chaveNoBanco()).toEqual(
      expect.objectContaining({ status: "invalida", ultimo_erro: "cifra_invalida" }),
    );
    expect(pedidos).toHaveLength(0);
  });

  it("401 de cota e 402: sem_credito, a chave fica sem_credito", async () => {
    responderSequencia([
      { status: 401, corpo: { detail: { status: "quota_exceeded", message: "sem cota" } } },
    ]);
    chaveVoz();
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "sem_credito" });
    expect(chaveNoBanco()).toEqual(
      expect.objectContaining({ status: "sem_credito", ultimo_erro: "http_401" }),
    );
    expect(pedidos).toHaveLength(1);

    limparBanco({ ia_chaves: [] });
    responderSequencia([{ status: 402, corpo: {} }]);
    chaveVoz();
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "sem_credito" });
    expect(chaveNoBanco()).toEqual(
      expect.objectContaining({ status: "sem_credito", ultimo_erro: "http_402" }),
    );
    expect(chamadas()).toHaveLength(0);
  });

  it("outro 401 e o 403: chave_invalida, a chave fica invalida", async () => {
    responderSequencia([
      { status: 401, corpo: { detail: { status: "invalid_api_key", message: "x" } } },
    ]);
    chaveVoz();
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "chave_invalida" });
    expect(chaveNoBanco()).toEqual(
      expect.objectContaining({ status: "invalida", ultimo_erro: "http_401" }),
    );
    expect(pedidos).toHaveLength(1);

    limparBanco({ ia_chaves: [] });
    responderSequencia([{ status: 401, corpo: {} }]);
    chaveVoz();
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "chave_invalida" });
    expect(chaveNoBanco()).toEqual(
      expect.objectContaining({ status: "invalida", ultimo_erro: "http_401" }),
    );

    limparBanco({ ia_chaves: [] });
    responderSequencia([{ status: 403, corpo: {} }]);
    chaveVoz();
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "chave_invalida" });
    expect(chaveNoBanco()).toEqual(
      expect.objectContaining({ status: "invalida", ultimo_erro: "http_403" }),
    );
  });

  it("401 de permissão (sem Text to Speech): chave_invalida, com ultimo_erro sem_permissao", async () => {
    responderSequencia([
      {
        status: 401,
        corpo: { detail: { status: "missing_permissions", message: `falta tts ${SEGREDO}` } },
      },
    ]);
    chaveVoz();
    const r = await falar("Oi", { vozId: VOZ });
    expect(r).toEqual({ ok: false, erro: "chave_invalida" });
    expect(chaveNoBanco()).toEqual(
      expect.objectContaining({ status: "invalida", ultimo_erro: "sem_permissao" }),
    );
    // não repete, não grava custo nem mexe na voz
    expect(pedidos).toHaveLength(1);
    expect(chamadas()).toHaveLength(0);
    expect(configuracao()?.["voz_erro"]).toBeNull();
    expect(JSON.stringify(r)).not.toContain(SEGREDO);
    expect(JSON.stringify(banco.tabelas)).not.toContain(SEGREDO);
  });

  it("o 403 com detail.status de permissão continua http_403 (só o 401 é falta de acesso)", async () => {
    responderSequencia([{ status: 403, corpo: { detail: { status: "missing_permissions" } } }]);
    chaveVoz();
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "chave_invalida" });
    expect(chaveNoBanco()).toEqual(
      expect.objectContaining({ status: "invalida", ultimo_erro: "http_403" }),
    );
  });

  it("404 (ou voice_not_found): voz_nao_encontrada e voz_erro gravado só para a voz pedida", async () => {
    responderSequencia([{ status: 404, corpo: { detail: { status: "voice_not_found" } } }]);
    chaveVoz();
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "voz_nao_encontrada" });
    expect(configuracao()?.["voz_erro"]).toBe("voz_nao_encontrada");
    // a chave não muda
    expect(chaveNoBanco()?.["status"]).toBe("ativa");

    // outra voz já escolhida na tela: o erro da voz antiga não marca a nova
    banco.tabelas["configuracao"] = [{ id: 1, voz_id: "voz_nova", voz_erro: null }];
    responderSequencia([{ status: 400, corpo: { detail: { status: "voice_not_found" } } }]);
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "voz_nao_encontrada" });
    expect(configuracao()?.["voz_erro"]).toBeNull();
  });

  it("sucesso limpa o voz_erro da mesma voz e reativa a chave sem_credito", async () => {
    banco.tabelas["configuracao"] = [{ id: 1, voz_id: VOZ, voz_erro: "voz_nao_encontrada" }];
    responderSequencia([OK]);
    chaveVoz("sem_credito");
    const r = await falar("Oi", { vozId: VOZ });
    expect(r.ok).toBe(true);
    expect(configuracao()?.["voz_erro"]).toBeNull();
    expect(chaveNoBanco()).toEqual(expect.objectContaining({ status: "ativa", ultimo_erro: null }));
  });

  it("sucesso com outra voz escolhida não limpa o voz_erro dela", async () => {
    banco.tabelas["configuracao"] = [
      { id: 1, voz_id: "voz_nova", voz_erro: "voz_nao_encontrada" },
    ];
    responderSequencia([OK]);
    chaveVoz();
    await falar("Oi", { vozId: VOZ });
    expect(configuracao()?.["voz_erro"]).toBe("voz_nao_encontrada");
  });

  it("429 e 5xx repetem uma vez", async () => {
    responderSequencia([{ status: 429, corpo: {} }, OK]);
    chaveVoz();
    expect((await falar("Oi", { vozId: VOZ })).ok).toBe(true);
    expect(pedidos).toHaveLength(2);

    responderSequencia([{ status: 503, corpo: {} }, { status: 502, corpo: {} }, OK]);
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "passageira" });
    expect(pedidos).toHaveLength(2);
    // a chave não muda num erro passageiro
    expect(chaveNoBanco()?.["status"]).toBe("ativa");
  });

  it("erro de rede repete uma vez; tempo esgotado não repete", async () => {
    responderSequencia([new TypeError("fetch failed"), OK]);
    chaveVoz();
    expect((await falar("Oi", { vozId: VOZ })).ok).toBe(true);
    expect(pedidos).toHaveLength(2);

    const tempo = new Error("tempo");
    tempo.name = "TimeoutError";
    responderSequencia([tempo, OK]);
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "passageira" });
    expect(pedidos).toHaveLength(1);
  });

  it("a repetição só acontece se couber no tempo", async () => {
    responderSequencia([{ status: 503, corpo: {} }, OK]);
    chaveVoz();
    // tempo = 4,4 s: depois da 1ª tentativa e da espera, não sobram 4 s
    expect(await falar("Oi", { vozId: VOZ, fimEm: Date.now() + 5_400 })).toEqual({
      ok: false,
      erro: "passageira",
    });
    expect(pedidos).toHaveLength(1);
  });

  it("outro 4xx ou corpo vazio: recusada, sem repetir", async () => {
    responderSequencia([{ status: 422, corpo: { detail: [{ msg: "x" }] } }]);
    chaveVoz();
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "recusada" });
    expect(pedidos).toHaveLength(1);

    responderSequencia([{ status: 200, bytes: new Uint8Array() }]);
    expect(await falar("Oi", { vozId: VOZ })).toEqual({ ok: false, erro: "recusada" });
    expect(chamadas()).toHaveLength(0);
  });

  it("voice_id fora do formato: voz_nao_encontrada sem fetch", async () => {
    responderSequencia([OK]);
    chaveVoz();
    expect(await falar("Oi", { vozId: "../v1/user" })).toEqual({
      ok: false,
      erro: "voz_nao_encontrada",
    });
    expect(pedidos).toHaveLength(0);
  });

  it("a chave nunca aparece no resultado nem no banco, mesmo quando o erro a ecoa", async () => {
    const casos: [Resposta, string | true][] = [
      [{ status: 401, corpo: { detail: { status: "invalid_api_key", message: SEGREDO } } }, "chave_invalida"],
      [{ status: 404, corpo: { detail: { status: "voice_not_found", message: SEGREDO } } }, "voz_nao_encontrada"],
      [{ status: 422, corpo: { detail: SEGREDO } }, "recusada"],
      [new TypeError(`fetch failed ${SEGREDO}`), "passageira"],
      [OK, true],
    ];
    for (const [caso, esperado] of casos) {
      // a chave volta a cada caso: o 401 a marca inválida, e sem isso o resto nem pediria
      banco.tabelas["ia_chaves"] = [];
      chaveVoz();
      responderSequencia([caso]);
      const r = await falar("Oi", { vozId: VOZ });
      // o pedido saiu de verdade: o eco foi lido (a rede repete uma vez)
      expect(pedidos.length).toBe(caso instanceof Error ? 2 : 1);
      if (esperado === true) expect(r.ok).toBe(true);
      else expect(r).toEqual({ ok: false, erro: esperado });
      expect(JSON.stringify(r)).not.toContain(SEGREDO);
    }
    expect(JSON.stringify(banco.tabelas)).not.toContain(SEGREDO);
  });
});

describe("lerConfigVoz e vozEmUso", () => {
  it("lê o modo e a voz da linha única", async () => {
    banco.tabelas["configuracao"] = [{ id: 1, voz_resposta: "sempre", voz_id: VOZ }];
    expect(await lerConfigVoz()).toEqual({ modo: "sempre", vozId: VOZ });
  });

  it("sem linha, o modo padrão sem voz; modo ou voz fora do formato viram padrão e null", async () => {
    banco.tabelas["configuracao"] = [];
    expect(await lerConfigVoz()).toEqual({ modo: "quando_audio", vozId: null });
    banco.tabelas["configuracao"] = [{ id: 1, voz_resposta: "talvez", voz_id: "a b" }];
    expect(await lerConfigVoz()).toEqual({ modo: "quando_audio", vozId: null });
  });

  it("erro do banco: nunca, sem voz", async () => {
    // o dublê lança ao ler as tabelas
    banco.tabelas = null as unknown as typeof banco.tabelas;
    expect(await lerConfigVoz()).toEqual({ modo: "nunca", vozId: null });
    expect(await vozEmUso()).toBe(false);
  });

  it("vozEmUso: só a chave da voz que não está removida nem inválida", async () => {
    expect(await vozEmUso()).toBe(false);
    for (const [status, esperado] of [
      ["ativa", true],
      ["sem_credito", true],
      ["removida", false],
      ["invalida", false],
    ] as const) {
      banco.tabelas["ia_chaves"] = [
        { id: "ch_resp", finalidade: "resposta", status: "ativa" },
        { id: "ch_voz", finalidade: "voz", status },
      ];
      expect(await vozEmUso()).toBe(esperado);
    }
  });
});
