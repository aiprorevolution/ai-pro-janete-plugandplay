import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANTHROPIC_VERSAO, type ProvedorIA } from "@/features/servidor/chave-ia";
import { PRAZO_MS, type Fetch } from "@/features/servidor/http";
import {
  casaComCurado,
  ehModeloDeTextoOpenAI,
  lerEntradaListarModelos,
  listaCurada,
  listarModelosLogica,
  porMilhao,
  unirComCurada,
} from "@/features/servidor/listar-modelos-logica";
import type { EntradaListarModelos, ResultadoListarModelos } from "@/features/servidor/listar-modelos";

// Chaves falsas, longas e únicas, para provar que nunca aparecem em nada que sai.
const CHAVE: Record<ProvedorIA, string> = {
  anthropic: "sk-ant-api03-LISTA-a1b2c3d4e5f6g7h8i9j0-QQQQ",
  openai: "sk-proj-LISTA-k1l2m3n4o5p6q7r8s9t0-WWWW",
  openrouter: "sk-or-v1-LISTA-u1v2w3x4y5z6a7b8c9d0-RRRR",
};

type Chamada = { url: string; init: RequestInit };
type Resposta = { status: number; corpo?: unknown } | "rede";

function resposta(r: { status: number; corpo?: unknown }): Response {
  const texto = r.corpo === undefined ? "" : typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo);
  return { status: r.status, text: async () => texto } as unknown as Response;
}

/** fetch falso: devolve as respostas em ordem e guarda cada chamada. "rede" = falha de rede. */
function fetchFalso(...respostas: Resposta[]): { fetch: Fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  let i = 0;
  const fetch: Fetch = async (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (!r) throw new Error("sem resposta configurada");
    // a falha de rede cita a chave de propósito: não pode vazar
    if (r === "rede") throw new TypeError(`fetch failed ${CHAVE.anthropic} ${CHAVE.openai} ${CHAVE.openrouter}`);
    return resposta(r);
  };
  return { fetch, chamadas };
}

/** fetch que só termina quando o prazo aborta (e cita a chave no erro, de propósito). */
function fetchPendurado(): { fetch: Fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const fetch: Fetch = (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    return new Promise<Response>((_ok, falhar) => {
      init?.signal?.addEventListener("abort", () => falhar(new Error(`abortado ${CHAVE.anthropic} ${CHAVE.openai}`)));
    });
  };
  return { fetch, chamadas };
}

function entrada(provedor: ProvedorIA, extra: Partial<EntradaListarModelos> = {}): EntradaListarModelos {
  return { provedor, chave: CHAVE[provedor], ...extra };
}

function cabecalhos(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

function semChave(resultado: unknown) {
  const json = JSON.stringify(resultado);
  for (const chave of Object.values(CHAVE)) {
    expect(json).not.toContain(chave);
    // nem um pedaço do meio da chave
    expect(json).not.toContain(chave.slice(8, -4));
  }
}

function ok(r: ResultadoListarModelos) {
  if (!r.ok) throw new Error(`esperava ok, veio ${r.erro}`);
  return r;
}

function erro(r: ResultadoListarModelos) {
  if (r.ok) throw new Error("esperava erro, veio ok");
  return r;
}

let espioes: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  espioes = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
  ];
});
afterEach(() => {
  // nada vai para log, nem a chave nem outra coisa
  for (const e of espioes) expect(e).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- dados de exemplo

const paginaAnthropic1 = {
  status: 200,
  corpo: {
    data: [
      { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", lifecycle: "active" },
      { type: "model", id: "claude-haiku-5-5-20261001", display_name: "Claude Haiku 5.5", lifecycle: "active" },
      { type: "model", id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5", lifecycle: "deprecated" },
    ],
    has_more: true,
    first_id: "claude-opus-5-5",
    last_id: "claude-haiku-4-5",
  },
};
const paginaAnthropic2 = {
  status: 200,
  corpo: {
    data: [
      { type: "model", id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", lifecycle: "active" },
      { type: "model", id: "claude-fable-5-1", display_name: "Claude Fable 5.1", lifecycle: "active" },
    ],
    has_more: false,
    first_id: "claude-sonnet-5-5",
    last_id: "claude-fable-5-1",
  },
};

const listaOpenAI = {
  status: 200,
  corpo: {
    object: "list",
    data: [
      { id: "gpt-6.1-sol", object: "model", owned_by: "openai" },
      { id: "text-embedding-3-large", object: "model" },
      { id: "gpt-6-luna", object: "model" },
      { id: "gpt-4o-mini-tts", object: "model" },
      { id: "whisper-1", object: "model" },
      { id: "gpt-transcribe", object: "model" },
      { id: "dall-e-3", object: "model" },
      { id: "gpt-image-2", object: "model" },
      { id: "omni-moderation-latest", object: "model" },
      { id: "gpt-realtime-2.1-mini", object: "model" },
      { id: "gpt-audio-1.5", object: "model" },
      { id: "gpt-4o-search-preview", object: "model" },
      { id: "gpt-3.5-turbo-instruct", object: "model" },
      { id: "operadornci-002", object: "model" },
      { id: "o4-mini", object: "model" },
      { id: "gpt-6.1-terra-2026-10-01", object: "model" },
    ],
  },
};

const paginaOpenRouter = {
  status: 200,
  corpo: {
    data: [
      {
        id: "google/gemini-3.8-flash",
        name: "Google: Gemini 3.8 Flash",
        architecture: { input_modalities: ["text", "image", "audio"], output_modalities: ["text"] },
        pricing: { prompt: "0.00000075", completion: "0.00000375" },
        supported_parameters: ["tools", "tool_choice"],
      },
      {
        id: "anthropic/claude-haiku-5.5",
        name: "Anthropic: Claude Haiku 5.5",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        pricing: { prompt: "0.0000001", completion: "0.0000005" },
        supported_parameters: ["tools", "tool_choice", "reasoning"],
      },
      {
        id: "black-forest-labs/flux-3",
        name: "Black Forest Labs: FLUX 3",
        architecture: { input_modalities: ["text"], output_modalities: ["image"] },
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools"],
      },
      {
        id: "openai/gpt-6-luna",
        name: "OpenAI: GPT-6 Luna",
        architecture: { modality: "text+image->text" },
        pricing: { prompt: "-1", completion: "0.0000005" },
        supported_parameters: ["tools"],
      },
      {
        id: "meta-llama/llama-5-8b:free",
        name: "Llama 5 8B (grátis)",
        architecture: { output_modalities: ["text"] },
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools"],
      },
      {
        id: "acme/sem-ferramentas",
        name: "Acme: Sem ferramentas",
        architecture: { output_modalities: ["text"] },
        pricing: { prompt: "0.000001", completion: "0.000002" },
        supported_parameters: ["temperature"],
      },
    ],
    total_count: 6,
  },
};

// ---------------------------------------------------------------- comum

describe("listarModelos: tempo limite e pedidos", () => {
  it("usa 10 segundos por padrão", () => {
    expect(PRAZO_MS).toBe(10_000);
  });

  it("manda o sinal do AbortController e redirect manual em todo pedido", async () => {
    const { fetch, chamadas } = fetchFalso(paginaAnthropic2);
    await listarModelosLogica(entrada("anthropic"), { fetch });
    expect(chamadas[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(chamadas[0]?.init.redirect).toBe("manual");
  });
});

describe("listarModelos: entrada", () => {
  it("aceita o contrato e limpa o workspace", () => {
    expect(lerEntradaListarModelos({ provedor: "openrouter" })).toEqual({ provedor: "openrouter" });
    expect(lerEntradaListarModelos({ provedor: "anthropic", chave: "x", workspaceId: "  wrkspc_1 " })).toEqual({
      provedor: "anthropic",
      chave: "x",
      workspaceId: "wrkspc_1",
    });
  });

  it("recusa provedor desconhecido e campos fora do formato, sem citar o valor", () => {
    expect(() => lerEntradaListarModelos({ provedor: "provedor-inexistente" })).toThrow("Provedor de IA desconhecido.");
    expect(() => lerEntradaListarModelos(null)).toThrow();
    let mensagem = "";
    try {
      lerEntradaListarModelos({ provedor: "openai", chave: CHAVE.openai.repeat(30) });
    } catch (e) {
      mensagem = (e as Error).message;
    }
    expect(mensagem).not.toBe("");
    expect(mensagem).not.toContain(CHAVE.openai);
    expect(() => lerEntradaListarModelos({ provedor: "openai", chave: 12 })).toThrow();
  });
});

// ---------------------------------------------------------------- Anthropic

describe("listarModelos: Anthropic", () => {
  it("sem chave devolve chave_invalida pedindo a chave, sem chamar o provedor", async () => {
    const { fetch, chamadas } = fetchFalso(paginaAnthropic2);
    const r = erro(await listarModelosLogica({ provedor: "anthropic", chave: "   " }, { fetch }));
    expect(r.erro).toBe("chave_invalida");
    expect(r.mensagem).toMatch(/Cole a chave de API da Anthropic/);
    expect(chamadas).toHaveLength(0);
    const r2 = erro(await listarModelosLogica({ provedor: "anthropic" }, { fetch }));
    expect(r2.erro).toBe("chave_invalida");
  });

  it.each([
    ["reticência", "sk-ant-api03-abc\u2026xyz"],
    ["espaço de largura zero", "sk-ant-api03-abc\u200bxyz"],
    ["travessão no lugar do hífen", "sk\u2013ant-api03-abcxyz"],
    ["espaço no meio", "sk-ant-api03 abcxyz"],
  ])("chave com %s: chave_invalida igual à do 401, sem chamar o provedor", async (_nome, chave) => {
    const { fetch, chamadas } = fetchFalso(paginaAnthropic2);
    const r = erro(await listarModelosLogica({ provedor: "anthropic", chave }, { fetch }));
    expect(chamadas).toHaveLength(0);
    const do401 = erro(
      await listarModelosLogica(entrada("anthropic"), fetchFalso({ status: 401, corpo: { error: { message: "invalid x-api-key" } } })),
    );
    expect(r).toEqual(do401);
    expect(r.erro).toBe("chave_invalida");
    expect(JSON.stringify(r)).not.toContain(chave);
  });

  it("workspace com caractere fora do ASCII: o mesmo erro do workspace recusado, sem chamar o provedor", async () => {
    const { fetch, chamadas } = fetchFalso(paginaAnthropic2);
    const r = erro(await listarModelosLogica(entrada("anthropic", { workspaceId: "wrkspc_01\u2026" }), { fetch }));
    expect(chamadas).toHaveLength(0);
    expect(r.erro).toBe("workspace_necessario");
    expect(r.mensagem).toMatch(/não aceitou esse ID de workspace/);
  });

  it("chama GET /v1/models com x-api-key, anthropic-version e o workspace", async () => {
    const { fetch, chamadas } = fetchFalso(paginaAnthropic2);
    await listarModelosLogica(entrada("anthropic", { chave: `  ${CHAVE.anthropic} `, workspaceId: "wrkspc_01ABC" }), { fetch });
    const c = chamadas[0]!;
    expect(c.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(c.init.method).toBe("GET");
    const h = cabecalhos(c.init);
    expect(h["x-api-key"]).toBe(CHAVE.anthropic);
    expect(h["anthropic-version"]).toBe(ANTHROPIC_VERSAO);
    expect(h["anthropic-workspace-id"]).toBe("wrkspc_01ABC");
  });

  it("sem workspace não manda o cabeçalho", async () => {
    const { fetch, chamadas } = fetchFalso(paginaAnthropic2);
    await listarModelosLogica(entrada("anthropic"), { fetch });
    expect(cabecalhos(chamadas[0]!.init)["anthropic-workspace-id"]).toBeUndefined();
  });

  it("200: pagina por has_more e after_id, tira os deprecated e une com a lista curada", async () => {
    const { fetch, chamadas } = fetchFalso(paginaAnthropic1, paginaAnthropic2);
    const r = ok(await listarModelosLogica(entrada("anthropic"), { fetch }));
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.url).toBe("https://api.anthropic.com/v1/models?limit=1000&after_id=claude-haiku-4-5");
    expect(r.origem).toBe("provedor");
    // recomendado primeiro (casou pelo começo do id, por causa da data), depois a ordem do provedor
    expect(r.modelos.map((m) => m.id)).toEqual([
      "claude-haiku-5-5-20261001",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-fable-5-1",
    ]);
    expect(r.modelos[0]).toEqual({
      id: "claude-haiku-5-5-20261001",
      nome: "Claude Haiku 5.5",
      perfil: "Rápido e barato",
      precoEntrada: 0.1,
      precoSaida: 0.5,
      recomendado: true,
    });
    expect(r.modelos[1]).toMatchObject({ nome: "Claude Opus 5.5", perfil: "Mais capaz", precoEntrada: 4, precoSaida: 20, recomendado: false });
    // fora da lista curada: sem preço e sem perfil
    const fable = r.modelos.find((m) => m.id === "claude-fable-5-1")!;
    expect(fable).toEqual({ id: "claude-fable-5-1", nome: "Claude Fable 5.1", recomendado: false });
    expect(r.modelos.filter((m) => m.recomendado)).toHaveLength(1);
  });

  it("para de paginar se has_more não avançar (sem laço)", async () => {
    const travada = { status: 200, corpo: { ...paginaAnthropic1.corpo } };
    const { fetch, chamadas } = fetchFalso(travada, travada, travada, travada, travada, travada, travada);
    ok(await listarModelosLogica(entrada("anthropic"), { fetch }));
    expect(chamadas.length).toBe(2);
  });

  it.each([
    [401, { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${CHAVE.anthropic}` } }, "chave_invalida"],
    [403, { type: "error", error: { type: "permission_error", message: "no" } }, "sem_permissao"],
    [429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "provedor_fora"],
    [500, { type: "error", error: { type: "api_error", message: "boom" } }, "provedor_fora"],
    [503, "Service Unavailable", "provedor_fora"],
    [529, { type: "error", error: { type: "overloaded_error", message: "overloaded" } }, "provedor_fora"],
    [400, { type: "error", error: { message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header" } }, "workspace_necessario"],
    [404, { type: "error", error: { message: "Workspace `wrkspc_x` not found." } }, "workspace_necessario"],
    [404, { type: "error", error: { message: "not found" } }, "provedor_fora"],
  ] as const)("status %i vira %s, sem a chave", async (status, corpo, esperado) => {
    const { fetch } = fetchFalso({ status, corpo });
    const r = erro(await listarModelosLogica(entrada("anthropic"), { fetch }));
    expect(r.erro).toBe(esperado);
    expect(r.mensagem).not.toMatch(/modelo  /);
    semChave(r);
  });

  it("429 de teto de gasto vira sem_credito", async () => {
    const { fetch } = fetchFalso({
      status: 429,
      corpo: { type: "error", error: { type: "rate_limit_error", message: "x", details: { error_code: "enforced_spend_limit_reached" } } },
    });
    expect(erro(await listarModelosLogica(entrada("anthropic"), { fetch })).erro).toBe("sem_credito");
  });

  it("tempo esgotado e falha de rede, sem a chave", async () => {
    const pendurado = fetchPendurado();
    const r = erro(await listarModelosLogica(entrada("anthropic"), { fetch: pendurado.fetch, prazoMs: 20 }));
    expect(r.erro).toBe("tempo_esgotado");
    expect(r.mensagem).toMatch(/10 segundos/);
    semChave(r);
    const { fetch } = fetchFalso("rede");
    const r2 = erro(await listarModelosLogica(entrada("anthropic"), { fetch }));
    expect(r2.erro).toBe("provedor_fora");
    semChave(r2);
  });

  it("corpo sem lista vira provedor_fora; lista vazia vira sem_permissao", async () => {
    expect(erro(await listarModelosLogica(entrada("anthropic"), fetchFalso({ status: 200, corpo: "<html>" }))).erro).toBe("provedor_fora");
    const vazia = { status: 200, corpo: { data: [], has_more: false } };
    expect(erro(await listarModelosLogica(entrada("anthropic"), fetchFalso(vazia))).erro).toBe("sem_permissao");
  });

  it("um provedor que ecoa a chave no nome do modelo não a devolve", async () => {
    const eco = {
      status: 200,
      corpo: { data: [{ id: "claude-opus-5-5", display_name: `Opus ${CHAVE.anthropic}`, lifecycle: "active" }], has_more: false },
    };
    const r = ok(await listarModelosLogica(entrada("anthropic"), fetchFalso(eco)));
    semChave(r);
    expect(r.modelos[0]!.nome).toBe("Opus ***");
  });
});

// ---------------------------------------------------------------- OpenAI

describe("listarModelos: OpenAI", () => {
  it("sem chave devolve chave_invalida pedindo a chave, sem chamar o provedor", async () => {
    const { fetch, chamadas } = fetchFalso(listaOpenAI);
    const r = erro(await listarModelosLogica({ provedor: "openai" }, { fetch }));
    expect(r.erro).toBe("chave_invalida");
    expect(r.mensagem).toMatch(/Cole a chave de API da OpenAI/);
    expect(chamadas).toHaveLength(0);
  });

  it.each([
    ["reticência", "sk-proj-abc\u2026xyz"],
    ["espaço de largura zero", "sk-proj-abc\u200bxyz"],
  ])("chave com %s: chave_invalida igual à do 401, sem chamar o provedor", async (_nome, chave) => {
    const { fetch, chamadas } = fetchFalso(listaOpenAI);
    const r = erro(await listarModelosLogica({ provedor: "openai", chave }, { fetch }));
    expect(chamadas).toHaveLength(0);
    const do401 = erro(
      await listarModelosLogica(
        entrada("openai"),
        fetchFalso({ status: 401, corpo: { error: { message: "Incorrect API key provided", code: "invalid_api_key" } } }),
      ),
    );
    expect(r).toEqual(do401);
    expect(r.erro).toBe("chave_invalida");
  });

  it("chama GET /v1/models com Bearer", async () => {
    const { fetch, chamadas } = fetchFalso(listaOpenAI);
    await listarModelosLogica(entrada("openai"), { fetch });
    expect(chamadas[0]!.url).toBe("https://api.openai.com/v1/models");
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[0]!.init)["Authorization"]).toBe(`Bearer ${CHAVE.openai}`);
  });

  it("200: só os modelos de texto, nome da curada quando casa exato, senão o id", async () => {
    const r = ok(await listarModelosLogica(entrada("openai"), fetchFalso(listaOpenAI)));
    expect(r.origem).toBe("provedor");
    expect(r.modelos.map((m) => m.id)).toEqual(["gpt-6-luna", "gpt-6.1-sol", "o4-mini", "gpt-6.1-terra-2026-10-01"]);
    expect(r.modelos[0]).toEqual({
      id: "gpt-6-luna",
      nome: "GPT-6 Luna",
      perfil: "Rápido e barato",
      precoEntrada: 0.1,
      precoSaida: 0.5,
      recomendado: true,
    });
    expect(r.modelos[1]).toMatchObject({ nome: "GPT-6.1 Sol", precoEntrada: 2, precoSaida: 10, recomendado: false });
    expect(r.modelos[2]).toEqual({ id: "o4-mini", nome: "o4-mini", recomendado: false });
    // casou pelo começo do id (data): preço e perfil da curada, nome é o id
    expect(r.modelos[3]).toMatchObject({ nome: "gpt-6.1-terra-2026-10-01", perfil: "Equilibrado", precoEntrada: 1, precoSaida: 5 });
  });

  it.each([
    [401, { error: { message: `Incorrect API key provided: ${CHAVE.openai}`, type: "invalid_request_error", code: "invalid_api_key" } }, "chave_invalida"],
    [401, { error: { message: "You have insufficient permissions for this operation. Missing scopes: api.model.read" } }, "sem_permissao"],
    [403, { error: { message: "forbidden" } }, "sem_permissao"],
    [429, { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } }, "provedor_fora"],
    [429, { error: { message: "quota", type: "insufficient_quota", code: "insufficient_quota" } }, "sem_credito"],
    [500, { error: { message: "server" } }, "provedor_fora"],
    [502, "Bad Gateway", "provedor_fora"],
    [404, { error: { message: "not found" } }, "provedor_fora"],
  ] as const)("status %i vira %s, sem a chave", async (status, corpo, esperado) => {
    const r = erro(await listarModelosLogica(entrada("openai"), fetchFalso({ status, corpo })));
    expect(r.erro).toBe(esperado);
    semChave(r);
  });

  it("tempo esgotado e falha de rede, sem a chave", async () => {
    const pendurado = fetchPendurado();
    const r = erro(await listarModelosLogica(entrada("openai"), { fetch: pendurado.fetch, prazoMs: 20 }));
    expect(r.erro).toBe("tempo_esgotado");
    semChave(r);
    const r2 = erro(await listarModelosLogica(entrada("openai"), fetchFalso("rede")));
    expect(r2.erro).toBe("provedor_fora");
    semChave(r2);
  });

  it("lista sem nenhum modelo de texto vira sem_permissao", async () => {
    const soEmbedding = { status: 200, corpo: { data: [{ id: "text-embedding-3-small" }, { id: "whisper-1" }] } };
    expect(erro(await listarModelosLogica(entrada("openai"), fetchFalso(soEmbedding))).erro).toBe("sem_permissao");
  });

  it("regra dos modelos de texto", () => {
    for (const id of ["gpt-6-luna", "gpt-6.1-sol", "o3", "o4-mini", "chatgpt-4o-latest", "ft:gpt-6-luna:empresa::abc", "gpt-5-codex"]) {
      expect(ehModeloDeTextoOpenAI(id)).toBe(true);
    }
    for (const id of [
      "text-embedding-3-large",
      "tts-1",
      "gpt-4o-mini-tts",
      "whisper-1",
      "gpt-4o-transcribe",
      "dall-e-3",
      "gpt-image-1",
      "omni-moderation-latest",
      "gpt-realtime",
      "gpt-audio-1.5",
      "gpt-4o-search-preview",
      "gpt-3.5-turbo-instruct",
      "o3-deep-research",
      "computer-use-preview",
      "sora-2",
      "operadornci-002",
      "babbage-002",
    ]) {
      expect(ehModeloDeTextoOpenAI(id)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- OpenRouter

describe("listarModelos: OpenRouter", () => {
  it("pede a lista pública sem mandar a chave", async () => {
    const { fetch, chamadas } = fetchFalso(paginaOpenRouter);
    await listarModelosLogica(entrada("openrouter"), { fetch });
    const c = chamadas[0]!;
    expect(c.url.startsWith("https://openrouter.ai/api/v1/models?")).toBe(true);
    const busca = new URL(c.url).searchParams;
    expect(busca.get("output_modalities")).toBe("text");
    expect(busca.get("supported_parameters")).toBe("tools");
    expect(cabecalhos(c.init)["Authorization"]).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain(CHAVE.openrouter);
  });

  it("funciona sem chave nenhuma", async () => {
    const r = ok(await listarModelosLogica({ provedor: "openrouter" }, fetchFalso(paginaOpenRouter)));
    expect(r.origem).toBe("provedor");
  });

  it("chave com caractere fora do ASCII não atrapalha (a chave da OpenRouter nunca é mandada)", async () => {
    const r = ok(await listarModelosLogica({ provedor: "openrouter", chave: "sk-or-v1-abc…xyz" }, fetchFalso(paginaOpenRouter)));
    expect(r.origem).toBe("provedor");
  });

  it("200: só os que geram texto e aceitam ferramentas, preço por 1M, fabricante e recomendado", async () => {
    const r = ok(await listarModelosLogica(entrada("openrouter"), fetchFalso(paginaOpenRouter)));
    expect(r.modelos.map((m) => m.id)).toEqual([
      "anthropic/claude-haiku-5.5",
      "google/gemini-3.8-flash",
      "openai/gpt-6-luna",
      "meta-llama/llama-5-8b:free",
    ]);
    expect(r.modelos[0]).toEqual({
      id: "anthropic/claude-haiku-5.5",
      nome: "Anthropic: Claude Haiku 5.5",
      fabricante: "Anthropic",
      precoEntrada: 0.1,
      precoSaida: 0.5,
      recomendado: true,
    });
    expect(r.modelos[1]).toMatchObject({ fabricante: "Google", precoEntrada: 0.75, precoSaida: 3.75, recomendado: false });
    // preço variável (-1) no provedor: usa o da curada
    expect(r.modelos[2]).toMatchObject({ fabricante: "OpenAI", precoEntrada: 0.1, precoSaida: 0.5 });
    // fabricante pelo prefixo do id; grátis é 0
    expect(r.modelos[3]).toMatchObject({ fabricante: "Meta", precoEntrada: 0, precoSaida: 0, recomendado: false });
    expect(r.modelos.every((m) => m.perfil === undefined)).toBe(true);
  });

  it("pagina por total_count e offset", async () => {
    const p1 = { status: 200, corpo: { data: [paginaOpenRouter.corpo.data[0]], total_count: 2 } };
    const p2 = { status: 200, corpo: { data: [paginaOpenRouter.corpo.data[1]], total_count: 2 } };
    const { fetch, chamadas } = fetchFalso(p1, p2);
    const r = ok(await listarModelosLogica(entrada("openrouter"), { fetch }));
    expect(chamadas).toHaveLength(2);
    expect(new URL(chamadas[1]!.url).searchParams.get("offset")).toBe("1");
    expect(r.modelos.map((m) => m.id)).toEqual(["anthropic/claude-haiku-5.5", "google/gemini-3.8-flash"]);
  });

  const curada = listaCurada("openrouter");

  it.each([
    ["500", { status: 500, corpo: "erro" }],
    ["503", { status: 503 }],
    ["429", { status: 429, corpo: { error: { message: "rate" } } }],
    ["401", { status: 401, corpo: { error: { message: "Missing Authentication header" } } }],
    ["corpo estranho", { status: 200, corpo: "<html>" }],
    ["lista vazia", { status: 200, corpo: { data: [], total_count: 0 } }],
    ["rede", "rede"],
  ] as const)("fora do ar (%s) devolve ok com a lista curada", async (_nome, r) => {
    const res = ok(await listarModelosLogica(entrada("openrouter"), fetchFalso(r as Resposta)));
    expect(res.origem).toBe("lista_curada");
    expect(res.modelos).toEqual(curada);
    semChave(res);
  });

  it("tempo esgotado devolve ok com a lista curada", async () => {
    const pendurado = fetchPendurado();
    const res = ok(await listarModelosLogica(entrada("openrouter"), { fetch: pendurado.fetch, prazoMs: 20 }));
    expect(res.origem).toBe("lista_curada");
  });

  it("a lista curada de reserva tem o recomendado primeiro, fabricante e preço", () => {
    expect(curada[0]).toEqual({
      id: "anthropic/claude-haiku-5.5",
      nome: "anthropic/claude-haiku-5.5",
      fabricante: "Anthropic",
      precoEntrada: 0.1,
      precoSaida: 0.5,
      recomendado: true,
    });
    expect(curada.map((m) => m.id)).toEqual(["anthropic/claude-haiku-5.5", "openai/gpt-6-luna", "google/gemini-3.8-flash"]);
  });

  it("segunda página fora: segue com a primeira", async () => {
    const p1 = { status: 200, corpo: { data: [paginaOpenRouter.corpo.data[0]], total_count: 5 } };
    const r = ok(await listarModelosLogica(entrada("openrouter"), fetchFalso(p1, { status: 502 })));
    expect(r.origem).toBe("provedor");
    expect(r.modelos.map((m) => m.id)).toEqual(["google/gemini-3.8-flash"]);
  });
});

// ---------------------------------------------------------------- união

describe("união com a lista curada", () => {
  it("casa pelo id exato ou pelo começo seguido de data ou versão", () => {
    expect(casaComCurado("gpt-6-luna", "gpt-6-luna")).toBe("exato");
    expect(casaComCurado("gpt-6-luna-2026-09-22", "gpt-6-luna")).toBe("comeco");
    expect(casaComCurado("claude-haiku-5-5-20261001", "claude-haiku-5-5")).toBe("comeco");
    expect(casaComCurado("claude-haiku-5-5@20261001", "claude-haiku-5-5")).toBe("comeco");
    expect(casaComCurado("gpt-6-luna-mini", "gpt-6-luna")).toBeNull();
    expect(casaComCurado("claude-haiku-5-50", "claude-haiku-5-5")).toBeNull();
    expect(casaComCurado("anthropic/claude-haiku-5.5:free", "anthropic/claude-haiku-5.5")).toBeNull();
  });

  it("com o id exato e o datado na lista, só o exato leva o selo; os dois levam o preço", () => {
    const r = unirComCurada("openai", [{ id: "gpt-6-luna-2026-09-22" }, { id: "o3" }, { id: "gpt-6-luna" }]);
    expect(r.map((m) => [m.id, m.recomendado])).toEqual([
      ["gpt-6-luna", true],
      ["gpt-6-luna-2026-09-22", false],
      ["o3", false],
    ]);
    expect(r[1]).toMatchObject({ precoEntrada: 0.1, precoSaida: 0.5, perfil: "Rápido e barato" });
  });

  it("tira ids repetidos e mantém a ordem do provedor", () => {
    const r = unirComCurada("anthropic", [{ id: "b" }, { id: "a" }, { id: "b" }]);
    expect(r.map((m) => m.id)).toEqual(["b", "a"]);
    expect(r.every((m) => !m.recomendado && m.precoEntrada === undefined)).toBe(true);
  });

  it("preço por token vira preço por 1M, sem ruído; negativo ou vazio é sem preço", () => {
    expect(porMilhao("0.0000001")).toBe(0.1);
    expect(porMilhao("0.00000375")).toBe(3.75);
    expect(porMilhao("0")).toBe(0);
    expect(porMilhao("-1")).toBeUndefined();
    expect(porMilhao("")).toBeUndefined();
    expect(porMilhao(undefined)).toBeUndefined();
  });
});
