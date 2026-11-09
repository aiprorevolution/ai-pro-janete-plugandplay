import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { banco, limparBanco } from "./__testes__/dubles";

const estado = vi.hoisted(() => ({ chaves: {} as Record<string, unknown> }));

vi.mock("@/integrations/firebase/client.server", async () => ({
  firebaseAdmin: (await import("./__testes__/dubles")).firebaseFalso,
}));
vi.mock("../nucleo/conexoes.server", () => ({
  lerChaveIA: async (finalidade: string) => estado.chaves[finalidade] ?? null,
}));

const { transcrever, formatoDoMime, paraBase64, MAX_BYTES_AUDIO } =
  await import("./transcrever.server");

const AUDIO = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]); // "OggS..."
const OGG = "audio/ogg; codecs=opus";

type Pedido = { url: string; init: RequestInit };
let pedidos: Pedido[] = [];

function responderCom(corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}) {
  pedidos = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return new Response(JSON.stringify(corpo), {
        status,
        headers: { "content-type": "application/json", ...cabecalhos },
      });
    }),
  );
}

type Resposta = { status: number; corpo: unknown; cabecalhos?: Record<string, string> } | Error;

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
      return new Response(JSON.stringify(r.corpo), {
        status: r.status,
        headers: { "content-type": "application/json", ...(r.cabecalhos ?? {}) },
      });
    }),
  );
}

const SEM_ESPERA = { "retry-after": "0" };

function chave(finalidade: string, provedor: string, modelo: string) {
  const id = `ch_${finalidade}`;
  estado.chaves[finalidade] = { id, provedor, modelo, workspace_id: null, chave: `k_${provedor}` };
  banco.tabelas["ia_chaves"]?.push({ id: `ch_${finalidade}`, finalidade, status: "ativa" });
}

function chamadas() {
  return (banco.tabelas["ia_chamadas"] ?? []) as Record<string, unknown>[];
}

beforeEach(() => {
  limparBanco({
    ia_chaves: [],
    ia_precos: [
      {
        id: "p_gpt_transcribe",
        provedor: "openai",
        modelo: "gpt-transcribe",
        vigente_desde: "2026-10-28",
        a_partir_de_tokens: 0,
        audio_por_minuto: 0.0045,
      },
      {
        id: "p_groq_turbo",
        provedor: "groq",
        modelo: "whisper-large-v3-turbo",
        vigente_desde: "2026-10-28",
        a_partir_de_tokens: 0,
        audio_por_minuto: 0.04 / 60,
      },
    ],
  });
  estado.chaves = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcrever", () => {
  it("Anthropic sem chave de transcrição → audio_sem_transcricao, sem chamar ninguém", async () => {
    responderCom({ text: "nunca" });
    chave("resposta", "anthropic", "claude-haiku-5-5");
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(0);
    expect(chamadas()).toHaveLength(0);
  });

  it("OpenRouter manda base64 em JSON e grava o custo do provedor", async () => {
    responderCom({ text: " Quero o plano anual ", usage: { seconds: 9.2, cost: 0.000508 } }, 200, {
      "x-generation-id": "gen-1",
    });
    chave("resposta", "openrouter", "anthropic/claude-haiku-5-5");
    const r = await transcrever(AUDIO, OGG, { rodadaId: "r1" });
    expect(r).toEqual({ texto: "Quero o plano anual" });

    expect(pedidos[0]?.url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    const corpo = JSON.parse(String(pedidos[0]?.init.body));
    expect(corpo).toEqual({
      model: "openai/whisper-1",
      input_audio: { data: paraBase64(AUDIO), format: "ogg" },
    });
    expect(atob(corpo.input_audio.data)).toBe("OggS\u0000\u0002");
    expect((pedidos[0]?.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer k_openrouter",
    );
    expect(chamadas()).toEqual([
      expect.objectContaining({
        tipo: "transcricao",
        rodada_id: "r1",
        provedor: "openrouter",
        modelo: "openai/whisper-1",
        segundos_audio: 9.2,
        custo_usd: 0.000508,
        custo_origem: "provedor",
        request_id: "gen-1",
      }),
    ]);
  });

  it("chave de transcrição Groq tem prioridade, multipart, mínimo de 10 s", async () => {
    responderCom({ text: "oi", duration: 4 });
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("transcricao", "groq", "whisper-large-v3-turbo");
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(pedidos[0]?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    const form = pedidos[0]?.init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("file")).toBeTruthy();
    const [linha] = chamadas();
    expect(linha).toMatchObject({
      provedor: "groq",
      custo_origem: "tabela",
      preco_id: "p_groq_turbo",
    });
    expect(linha?.["custo_usd"]).toBeCloseTo(((0.04 / 60) * 10) / 60, 12);
  });

  it("grava a conversa do áudio em ia_chamadas.conversa_id (sem ela, fica nula)", async () => {
    responderCom({ text: "oi", usage: { seconds: 3, cost: 0.0001 } });
    chave("resposta", "openrouter", "anthropic/claude-haiku-5-5");
    await transcrever(AUDIO, OGG, { conversaId: "conv-1" });
    expect(chamadas()[0]).toMatchObject({ tipo: "transcricao", conversa_id: "conv-1", rodada_id: null });

    limparBanco({ ia_chaves: [], ia_precos: [] });
    estado.chaves = {};
    responderCom({ text: "oi", usage: { seconds: 3, cost: 0.0001 } });
    chave("resposta", "openrouter", "anthropic/claude-haiku-5-5");
    await transcrever(AUDIO, OGG);
    expect(chamadas()[0]).toMatchObject({ conversa_id: null });
  });

  it("OpenAI pela chave da resposta: gpt-transcribe, custo por minuto", async () => {
    responderCom({ text: "tudo certo", usage: { type: "duration", seconds: 30 } });
    chave("resposta", "openai", "gpt-6-luna");
    expect(await transcrever(AUDIO, "audio/mpeg")).toEqual({ texto: "tudo certo" });
    expect(pedidos[0]?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((pedidos[0]?.init.body as FormData).get("model")).toBe("gpt-transcribe");
    expect(chamadas()[0]?.["custo_usd"]).toBeCloseTo(0.00225, 12);
  });

  it("OpenAI sem duração na resposta → sem_preco", async () => {
    responderCom({ text: "ok", usage: { type: "tokens", input_tokens: 10, output_tokens: 2 } });
    chave("resposta", "openai", "gpt-6-luna");
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "ok" });
    expect(chamadas()[0]).toMatchObject({ custo_usd: null, custo_origem: "sem_preco" });
  });

  it("formato recusado, erro do provedor ou arquivo grande → audio_sem_transcricao", async () => {
    chave("resposta", "openrouter", "x");
    responderCom({ text: "x" });
    expect(await transcrever(AUDIO, "audio/x-desconhecido")).toEqual({
      erro: "audio_sem_transcricao",
    });
    expect(pedidos).toHaveLength(0);

    responderCom({ error: { message: "unsupported" } }, 400);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(chamadas()).toHaveLength(0);

    responderCom({ text: "x" });
    const grande = new Uint8Array(MAX_BYTES_AUDIO + 1);
    expect(await transcrever(grande, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(0);
  });

  it("chave de transcrição removida cai para a da resposta", async () => {
    responderCom({ text: "oi", usage: { cost: 0.001 } });
    chave("resposta", "openrouter", "x");
    chave("transcricao", "groq", "whisper-large-v3-turbo");
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "transcricao");
    if (linha) linha["status"] = "removida";
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(pedidos[0]?.url).toContain("openrouter.ai");
  });

  it("503 passageiro repete e transcreve (respeita o retry-after)", async () => {
    chave("resposta", "openai", "gpt-6-luna");
    responderSequencia([
      { status: 503, corpo: { error: { message: "overloaded" } }, cabecalhos: SEM_ESPERA },
      { status: 200, corpo: { text: "oi", usage: { type: "duration", seconds: 3 } } },
    ]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(pedidos).toHaveLength(2);
    expect(chamadas()).toHaveLength(1);
  });

  it("erro de rede repete uma vez e transcreve", async () => {
    chave("resposta", "openrouter", "x");
    responderSequencia([
      new TypeError("fetch failed"),
      { status: 200, corpo: { text: "oi", usage: { cost: 0.001 } } },
    ]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(pedidos).toHaveLength(2);
  });

  it("429 que não passa: 3 tentativas e falha passageira (a mídia volta para a fila)", async () => {
    chave("resposta", "openai", "gpt-6-luna");
    responderSequencia([{ status: 429, corpo: {}, cabecalhos: SEM_ESPERA }]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "passageiro" });
    expect(pedidos).toHaveLength(3);
    expect(chamadas()).toHaveLength(0);
  });

  it("400 não repete; 5xx que não passa repete 2 vezes (retry-after-ms)", async () => {
    chave("resposta", "openai", "gpt-6-luna");
    responderSequencia([{ status: 400, corpo: {} }]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(1);

    responderSequencia([{ status: 502, corpo: {}, cabecalhos: { "retry-after-ms": "0" } }]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "passageiro" });
    expect(pedidos).toHaveLength(3);
  });

  it("401 marca a chave de transcrição como inválida", async () => {
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("transcricao", "groq", "whisper-large-v3-turbo");
    responderSequencia([{ status: 401, corpo: { error: { message: "invalid key" } } }]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(1);
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "transcricao");
    expect(linha).toMatchObject({ status: "invalida", ultimo_erro: "http_401" });
  });

  it("402 marca a chave como sem_credito, sem repetir", async () => {
    chave("transcricao", "groq", "whisper-large-v3-turbo");
    responderSequencia([{ status: 402, corpo: { error: { message: "payment required" } } }]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(1);
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "transcricao");
    expect(linha).toMatchObject({ status: "sem_credito", ultimo_erro: "http_402" });
  });

  it("429 de cota esgotada (OpenAI) é sem_credito e não repete", async () => {
    chave("resposta", "openai", "gpt-6-luna");
    responderSequencia([
      {
        status: 429,
        corpo: { error: { type: "insufficient_quota", code: "credit_balance_exhausted" } },
        cabecalhos: SEM_ESPERA,
      },
    ]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(1);
    expect(banco.tabelas["ia_chaves"]?.[0]).toMatchObject({
      status: "sem_credito",
      ultimo_erro: "http_429",
    });
  });

  it("402 em voo da OpenRouter não marca a chave", async () => {
    chave("resposta", "openrouter", "x");
    const metadata = { limit_source: "openrouter_in_flight_budget" };
    const emVoo = { error: { code: 402, metadata } };
    responderSequencia([{ status: 402, corpo: emVoo }]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(banco.tabelas["ia_chaves"]?.[0]?.["status"]).toBe("ativa");
  });

  it("chave sem_credito volta para ativa depois de uma transcrição que deu certo", async () => {
    chave("transcricao", "groq", "whisper-large-v3-turbo");
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "transcricao");
    if (linha) Object.assign(linha, { status: "sem_credito", ultimo_erro: "http_402" });
    responderCom({ text: "oi", duration: 12 });
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(linha).toMatchObject({ status: "ativa", ultimo_erro: null });
  });

  it("áudio mudo: grava o custo e devolve audio_sem_transcricao", async () => {
    chave("resposta", "openai", "gpt-6-luna");
    responderCom({ text: "  ", usage: { type: "duration", seconds: 20 } });
    expect(await transcrever(AUDIO, OGG, { rodadaId: "r1" })).toEqual({
      erro: "audio_sem_transcricao",
    });
    expect(chamadas()).toEqual([
      expect.objectContaining({ tipo: "transcricao", rodada_id: "r1", segundos_audio: 20 }),
    ]);
    expect(chamadas()[0]?.["custo_usd"]).toBeCloseTo((0.0045 * 20) / 60, 12);
  });

  it("chave própria de transcrição usa o modelo escolhido pelo admin", async () => {
    chave("transcricao", "groq", "whisper-large-v3");
    responderCom({ text: "oi", duration: 12 });
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect((pedidos[0]?.init.body as FormData).get("model")).toBe("whisper-large-v3");
    // sem preço para esse modelo na tabela do teste
    expect(chamadas()[0]).toMatchObject({ modelo: "whisper-large-v3", custo_origem: "sem_preco" });
  });

  it("mapa de formatos", () => {
    expect(formatoDoMime("audio/ogg; codecs=opus")).toBe("ogg");
    expect(formatoDoMime("audio/mpeg")).toBe("mp3");
    expect(formatoDoMime("audio/mp4")).toBe("m4a");
    expect(formatoDoMime("video/mp4")).toBeNull();
  });
});

describe("transcrever com a chave da voz (ElevenLabs, Scribe v2)", () => {
  const URL_ESCUTA = "https://api.elevenlabs.io/v1/speech-to-text";

  function precoScribe() {
    banco.tabelas["ia_precos"]?.push({
      id: "p_scribe",
      provedor: "elevenlabs",
      modelo: "scribe_v2",
      vigente_desde: "2026-11-02",
      a_partir_de_tokens: 0,
      audio_por_minuto: 0.22 / 60,
    });
  }

  it("entra só sem a chave de áudio e sem cérebro que transcreve", async () => {
    // chave de transcrição própria: ela, não a voz
    responderCom({ text: "oi", duration: 12 });
    chave("transcricao", "groq", "whisper-large-v3-turbo");
    chave("voz", "elevenlabs", "");
    await transcrever(AUDIO, OGG);
    expect(pedidos[0]?.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");

    // cérebro OpenAI ou OpenRouter: ele, não a voz
    for (const provedor of ["openai", "openrouter"]) {
      limparBanco({ ia_chaves: [], ia_precos: [] });
      estado.chaves = {};
      responderCom({ text: "oi", usage: { seconds: 3 } });
      chave("resposta", provedor, "x");
      chave("voz", "elevenlabs", "");
      await transcrever(AUDIO, OGG);
      expect(pedidos[0]?.url).not.toBe(URL_ESCUTA);
    }

    // cérebro Anthropic e chave de transcrição removida: a voz
    limparBanco({ ia_chaves: [], ia_precos: [] });
    estado.chaves = {};
    responderCom({ text: "oi", audio_duration_secs: 2 });
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("transcricao", "groq", "whisper-large-v3-turbo");
    const propria = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "transcricao");
    if (propria) propria["status"] = "removida";
    chave("voz", "elevenlabs", "");
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(pedidos[0]?.url).toBe(URL_ESCUTA);
  });

  it("chave da voz removida ou inválida não transcreve", async () => {
    responderCom({ text: "nunca" });
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    banco.tabelas["ia_chaves"]?.forEach((l) => {
      if (l["finalidade"] === "voz") l["status"] = "invalida";
    });
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(0);
  });

  it("multipart com file e model_id, cabeçalho xi-api-key e sem Authorization", async () => {
    responderCom({ language_code: "por", text: " Quero saber o preço ", audio_duration_secs: 6 }, 200, {
      "request-id": "req_scribe",
    });
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    expect(await transcrever(AUDIO, OGG, { rodadaId: "r1" })).toEqual({
      texto: "Quero saber o preço",
    });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(URL_ESCUTA);
    expect(pedidos[0]?.init.method).toBe("POST");
    const cab = pedidos[0]?.init.headers as Record<string, string>;
    expect(cab["xi-api-key"]).toBe("k_elevenlabs");
    expect(Object.keys(cab).map((k) => k.toLowerCase())).not.toContain("authorization");
    const form = pedidos[0]?.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("model")).toBeNull();
    expect(form.get("file")).toBeTruthy();
    // a chave vai no xi-api-key: o redirecionamento não é seguido
    expect(pedidos[0]?.init.redirect).toBe("manual");
    expect(chamadas()[0]).toMatchObject({
      tipo: "transcricao",
      provedor: "elevenlabs",
      modelo: "scribe_v2",
      segundos_audio: 6,
      request_id: "req_scribe",
    });
  });

  it("o custo é por minuto, sem mínimo; sem audio_duration_secs, vem do end da última palavra", async () => {
    precoScribe();
    responderCom({ text: "oi", audio_duration_secs: 3 });
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    await transcrever(AUDIO, OGG);
    expect(chamadas()[0]).toMatchObject({ custo_origem: "tabela", preco_id: "p_scribe" });
    expect(chamadas()[0]?.["custo_usd"]).toBeCloseTo(((0.22 / 60) * 3) / 60, 12);

    responderCom({
      text: "oi tudo bem",
      words: [
        { text: "oi", type: "word", start: 0.1, end: 0.4 },
        { text: " ", type: "spacing", start: 0.4, end: 0.5 },
        { text: "bem", type: "word", start: 1.2, end: 4.5 },
      ],
    });
    await transcrever(AUDIO, OGG);
    expect(chamadas()[1]).toMatchObject({ segundos_audio: 4.5, preco_id: "p_scribe" });
    expect(chamadas()[1]?.["custo_usd"]).toBeCloseTo(((0.22 / 60) * 4.5) / 60, 12);
  });

  it("401 de cota é sem_credito (não inválida) e não repete", async () => {
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    responderSequencia([
      { status: 401, corpo: { detail: { status: "quota_exceeded", message: "sem cota" } } },
    ]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(1);
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "voz");
    expect(linha).toMatchObject({ status: "sem_credito", ultimo_erro: "http_401" });
  });

  it("outro 401 marca a chave da voz como inválida; 429 repete como hoje", async () => {
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    responderSequencia([
      { status: 401, corpo: { detail: { status: "invalid_api_key", message: "x" } } },
    ]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "voz");
    expect(linha).toMatchObject({ status: "invalida", ultimo_erro: "http_401" });

    limparBanco({ ia_chaves: [], ia_precos: [] });
    estado.chaves = {};
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    responderSequencia([
      { status: 429, corpo: {}, cabecalhos: SEM_ESPERA },
      { status: 200, corpo: { text: "oi", audio_duration_secs: 1 } },
    ]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(pedidos).toHaveLength(2);
  });

  it("401 de permissão (sem Speech to Text) marca inválida com sem_permissao e não repete", async () => {
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    responderSequencia([
      {
        status: 401,
        corpo: { detail: { status: "missing_permissions", message: "falta stt k_elevenlabs" } },
      },
    ]);
    const r = await transcrever(AUDIO, OGG);
    expect(r).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(1);
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "voz");
    expect(linha).toMatchObject({ status: "invalida", ultimo_erro: "sem_permissao" });
    expect(chamadas()).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain("k_elevenlabs");
    expect(JSON.stringify(banco.tabelas)).not.toContain("k_elevenlabs");
  });

  it("fora da ElevenLabs, o 401 com detail.status de permissão continua http_401", async () => {
    chave("transcricao", "openai", "gpt-transcribe");
    responderSequencia([{ status: 401, corpo: { detail: { status: "missing_permissions" } } }]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "transcricao");
    expect(linha).toMatchObject({ status: "invalida", ultimo_erro: "http_401" });
  });

  it("um 3xx é falha sem repetir e sem marcar a chave", async () => {
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    responderSequencia([{ status: 307, corpo: {}, cabecalhos: { location: "https://outro.exemplo/x" } }]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(1);
    const linha = banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === "voz");
    expect(linha?.["status"]).toBe("ativa");
  });
});

// ---------- a ElevenLabs no cartão Escuta (docs/spec-escuta-elevenlabs.md, S3) ----------

describe("transcrever com a chave da escuta pela ElevenLabs", () => {
  const URL_ESCUTA = "https://api.elevenlabs.io/v1/speech-to-text";

  /** A escuta da ElevenLabs com uma chave falsa própria, para saber qual linha foi usada. */
  function escutaEleven(modelo = "scribe_v2") {
    chave("transcricao", "elevenlabs", modelo);
    (estado.chaves["transcricao"] as { chave: string }).chave = "k_escuta_elevenlabs";
  }
  function linha(finalidade: string) {
    return banco.tabelas["ia_chaves"]?.find((l) => l["finalidade"] === finalidade);
  }

  it("ganha do cérebro OpenAI e da voz, com o scribe_v2", async () => {
    responderCom({ text: "oi", audio_duration_secs: 2 });
    chave("resposta", "openai", "gpt-5.5-mini");
    chave("voz", "elevenlabs", "");
    escutaEleven();
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).toBe(URL_ESCUTA);
    expect((pedidos[0]?.init.headers as Record<string, string>)["xi-api-key"]).toBe(
      "k_escuta_elevenlabs",
    );
    expect((pedidos[0]?.init.body as FormData).get("model_id")).toBe("scribe_v2");
    expect(chamadas()[0]).toMatchObject({
      tipo: "transcricao",
      provedor: "elevenlabs",
      modelo: "scribe_v2",
    });
  });

  it("usa o scribe_v2 mesmo com outro modelo gravado na linha", async () => {
    responderCom({ text: "oi", audio_duration_secs: 1 });
    chave("resposta", "anthropic", "claude-haiku-5-5");
    escutaEleven("whisper-1");
    await transcrever(AUDIO, OGG);
    expect((pedidos[0]?.init.body as FormData).get("model_id")).toBe("scribe_v2");
  });

  it("o 401 de permissão marca a linha da escuta, não a da voz", async () => {
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    escutaEleven();
    responderSequencia([
      {
        status: 401,
        corpo: { detail: { status: "missing_permissions", message: "falta stt k_escuta_elevenlabs" } },
      },
    ]);
    const r = await transcrever(AUDIO, OGG);
    expect(r).toEqual({ erro: "audio_sem_transcricao" });
    expect(pedidos).toHaveLength(1);
    expect(linha("transcricao")).toMatchObject({ status: "invalida", ultimo_erro: "sem_permissao" });
    expect(linha("voz")?.["status"]).toBe("ativa");
    expect(JSON.stringify(r)).not.toContain("k_escuta_elevenlabs");
    expect(JSON.stringify(banco.tabelas)).not.toContain("k_escuta_elevenlabs");
  });

  it("o 401 de cota marca sem_credito na linha da escuta", async () => {
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    escutaEleven();
    responderSequencia([
      { status: 401, corpo: { detail: { status: "quota_exceeded", message: "sem cota" } } },
    ]);
    expect(await transcrever(AUDIO, OGG)).toEqual({ erro: "audio_sem_transcricao" });
    expect(linha("transcricao")).toMatchObject({ status: "sem_credito", ultimo_erro: "http_401" });
    expect(linha("voz")?.["status"]).toBe("ativa");
  });

  it("a escuta inválida cai para o cérebro; sem ele, a voz continua o último recurso", async () => {
    // a escuta inválida e o cérebro OpenAI: o cérebro
    responderCom({ text: "oi", duration: 3 });
    chave("resposta", "openai", "gpt-5.5-mini");
    escutaEleven();
    const propria = linha("transcricao");
    if (propria) propria["status"] = "invalida";
    await transcrever(AUDIO, OGG);
    expect(pedidos[0]?.url).toBe("https://api.openai.com/v1/audio/transcriptions");

    // a escuta inválida e o cérebro Anthropic: a chave da voz
    limparBanco({ ia_chaves: [], ia_precos: [] });
    estado.chaves = {};
    responderCom({ text: "oi", audio_duration_secs: 2 });
    chave("resposta", "anthropic", "claude-haiku-5-5");
    chave("voz", "elevenlabs", "");
    escutaEleven();
    const invalida = linha("transcricao");
    if (invalida) invalida["status"] = "invalida";
    expect(await transcrever(AUDIO, OGG)).toEqual({ texto: "oi" });
    expect(pedidos[0]?.url).toBe(URL_ESCUTA);
    expect((pedidos[0]?.init.headers as Record<string, string>)["xi-api-key"]).toBe("k_elevenlabs");
  });
});
