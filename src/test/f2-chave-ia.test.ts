import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANTHROPIC_VERSAO,
  lerEntradaChaveIA,
  validarChaveIALogica,
  type EntradaChaveIA,
  type ErroChaveIA,
  type ProvedorIA,
} from "@/features/servidor/chave-ia";
import { PRAZO_MS, type Fetch } from "@/features/servidor/http";

// Chaves falsas, longas e únicas, para provar que nunca aparecem em nada que sai.
const CHAVE: Record<ProvedorIA, string> = {
  anthropic: "sk-ant-api03-TESTE-a1b2c3d4e5f6g7h8i9j0-ZZZZ",
  openai: "sk-proj-TESTE-k1l2m3n4o5p6q7r8s9t0-YYYY",
  openrouter: "sk-or-v1-TESTE-u1v2w3x4y5z6a7b8c9d0-XXXX",
};
const MODELO: Record<ProvedorIA, string> = {
  anthropic: "claude-haiku-5-5",
  openai: "gpt-6-luna",
  openrouter: "anthropic/claude-haiku-5.5",
};

type Chamada = { url: string; init: RequestInit };
type Resposta = { status: number; corpo?: unknown };

function resposta(r: Resposta): Response {
  const texto = r.corpo === undefined ? "" : typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo);
  return { status: r.status, text: async () => texto } as unknown as Response;
}

/** fetch falso: devolve as respostas em ordem e guarda cada chamada. */
function fetchFalso(...respostas: Resposta[]): { fetch: Fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  let i = 0;
  const fetch: Fetch = async (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (!r) throw new Error("sem resposta configurada");
    return resposta(r);
  };
  return { fetch, chamadas };
}

/** fetch que só termina quando o prazo aborta (e cita a chave no erro, de propósito). */
function fetchPendurado(chave: string): Fetch {
  return (_url, init) =>
    new Promise<Response>((_ok, falhar) => {
      init?.signal?.addEventListener("abort", () => falhar(new Error(`abortado ${chave}`)));
    });
}

function entrada(provedor: ProvedorIA, extra: Partial<EntradaChaveIA> = {}): EntradaChaveIA {
  return { provedor, chave: CHAVE[provedor], modelo: MODELO[provedor], ...extra };
}

function cabecalhos(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

const okOpenRouterChave: Resposta = {
  status: 200,
  corpo: { data: { label: "sk-or-v1-au7...890", limit: null, limit_remaining: null, usage: 1 } },
};
const okOpenRouterModelos: Resposta = {
  status: 200,
  corpo: {
    data: [
      { id: "openai/gpt-6-luna", supported_parameters: ["tools", "tool_choice"] },
      { id: "anthropic/claude-haiku-5.5", supported_parameters: ["tools", "tool_choice", "reasoning"] },
    ],
    total_count: 2,
  },
};

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

function semChave(resultado: unknown, chave: string) {
  const json = JSON.stringify(resultado);
  expect(json).not.toContain(chave);
  // nem um pedaço do meio da chave
  expect(json).not.toContain(chave.slice(8, -4));
}

describe("validarChaveIA: tempo limite", () => {
  it("usa 10 segundos por padrão", () => {
    expect(PRAZO_MS).toBe(10_000);
  });

  it("manda o sinal do AbortController e redirect manual em todo pedido", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { input_tokens: 3 } });
    await validarChaveIALogica(entrada("anthropic"), { fetch });
    expect(chamadas[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(chamadas[0]?.init.redirect).toBe("manual");
  });
});

describe("validarChaveIA: Anthropic", () => {
  it("monta o pedido sem custo (count_tokens) com Bearer e anthropic-version", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { input_tokens: 3 } });
    await validarChaveIALogica(entrada("anthropic"), { fetch });
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0]!;
    expect(c.url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
    expect(c.init.method).toBe("POST");
    const h = cabecalhos(c.init);
    expect(h["Authorization"]).toBe(`Bearer ${CHAVE.anthropic}`);
    expect(h["anthropic-version"]).toBe(ANTHROPIC_VERSAO);
    expect(h["anthropic-workspace-id"]).toBeUndefined();
    expect(JSON.parse(String(c.init.body))).toMatchObject({ model: "claude-haiku-5-5" });
  });

  it("manda anthropic-workspace-id quando vem workspaceId", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    await validarChaveIALogica(entrada("anthropic", { workspaceId: "wrkspc_01ABC" }), { fetch });
    expect(cabecalhos(chamadas[0]!.init)["anthropic-workspace-id"]).toBe("wrkspc_01ABC");
  });

  const casos: Array<[string, Resposta, ErroChaveIA | "ok"]> = [
    ["200", { status: 200, corpo: { input_tokens: 3 } }, "ok"],
    ["401", { status: 401, corpo: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }, "chave_invalida"],
    ["403", { status: 403, corpo: { type: "error", error: { type: "permission_error", message: "no" } } }, "sem_permissao"],
    ["404 do modelo", { status: 404, corpo: { type: "error", error: { type: "not_found_error", message: "model: claude-x" } } }, "modelo_indisponivel"],
    ["404 do workspace", { status: 404, corpo: { type: "error", error: { type: "not_found_error", message: "Workspace `wrkspc_x` not found." } } }, "workspace_necessario"],
    ["400 sem workspace", { status: 400, corpo: { type: "error", error: { type: "invalid_request_error", message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header" } } }, "workspace_necessario"],
    ["400 limite próprio", { status: 400, corpo: { type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits" } } }, "sem_credito"],
    ["402", { status: 402, corpo: { type: "error", error: { type: "billing_error", message: "x" } } }, "sem_credito"],
    ["429 de taxa", { status: 429, corpo: { type: "error", error: { type: "rate_limit_error", message: "x" } } }, "provedor_fora"],
    ["429 do teto mensal", { status: 429, corpo: { type: "error", error: { type: "rate_limit_error", message: "x", details: { error_code: "enforced_spend_limit_reached" } } } }, "sem_credito"],
    ["500", { status: 500, corpo: { type: "error", error: { type: "api_error", message: "x" } } }, "provedor_fora"],
    ["529", { status: 529, corpo: { type: "error", error: { type: "overloaded_error", message: "x" } } }, "provedor_fora"],
  ];
  for (const [nome, r, esperado] of casos) {
    it(`${nome} vira ${esperado}`, async () => {
      const { fetch } = fetchFalso(r);
      const res = await validarChaveIALogica(entrada("anthropic"), { fetch });
      if (esperado === "ok") expect(res).toEqual({ ok: true, ultimos4: "ZZZZ" });
      else expect(res).toMatchObject({ ok: false, erro: esperado });
      if (!res.ok) expect(res.mensagem.length).toBeGreaterThan(20);
      semChave(res, CHAVE.anthropic);
    });
  }

  it("tempo esgotado vira tempo_esgotado", async () => {
    const res = await validarChaveIALogica(entrada("anthropic"), { fetch: fetchPendurado(CHAVE.anthropic), prazoMs: 20 });
    expect(res).toMatchObject({ ok: false, erro: "tempo_esgotado" });
    semChave(res, CHAVE.anthropic);
  });
});

describe("validarChaveIA: OpenAI", () => {
  it("monta GET models/{modelo} com Bearer", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { id: "gpt-6-luna", object: "model" } });
    await validarChaveIALogica(entrada("openai"), { fetch });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toBe("https://api.openai.com/v1/models/gpt-6-luna");
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[0]!.init)["Authorization"]).toBe(`Bearer ${CHAVE.openai}`);
  });

  // a OpenAI ecoa parte da chave no 401: a resposta nunca pode repassar esse texto
  const eco = `Incorrect API key provided: ${CHAVE.openai}. You can find your API key at ...`;
  const casos: Array<[string, Resposta, ErroChaveIA | "ok"]> = [
    ["200", { status: 200, corpo: { id: "gpt-6-luna" } }, "ok"],
    ["401", { status: 401, corpo: { error: { message: eco, type: "invalid_request_error", code: "invalid_api_key" } } }, "chave_invalida"],
    ["401 sem escopo", { status: 401, corpo: { error: { message: "You have insufficient permissions for this operation. Missing scopes: api.model.read", type: "invalid_request_error" } } }, "sem_permissao"],
    ["403", { status: 403, corpo: { error: { message: "Country, region, or territory not supported", code: "unsupported_country_region_territory" } } }, "sem_permissao"],
    ["404", { status: 404, corpo: { error: { message: "The model does not exist", code: "model_not_found" } } }, "modelo_indisponivel"],
    ["429 de taxa", { status: 429, corpo: { error: { message: "Rate limit reached", type: "requests" } } }, "provedor_fora"],
    ["429 sem crédito", { status: 429, corpo: { error: { message: "x", type: "insufficient_quota", code: "credit_balance_exhausted" } } }, "sem_credito"],
    ["429 teto da organização", { status: 429, corpo: { error: { message: "x", type: "x", code: "organization_usage_limit_exceeded" } } }, "sem_credito"],
    ["500", { status: 500, corpo: { error: { message: "x" } } }, "provedor_fora"],
    ["503", { status: 503, corpo: { error: { message: "x", code: "server_is_overloaded" } } }, "provedor_fora"],
  ];
  for (const [nome, r, esperado] of casos) {
    it(`${nome} vira ${esperado}`, async () => {
      const { fetch } = fetchFalso(r);
      const res = await validarChaveIALogica(entrada("openai"), { fetch });
      if (esperado === "ok") expect(res).toEqual({ ok: true, ultimos4: "YYYY" });
      else expect(res).toMatchObject({ ok: false, erro: esperado });
      semChave(res, CHAVE.openai);
    });
  }

  it("tempo esgotado vira tempo_esgotado", async () => {
    const res = await validarChaveIALogica(entrada("openai"), { fetch: fetchPendurado(CHAVE.openai), prazoMs: 20 });
    expect(res).toMatchObject({ ok: false, erro: "tempo_esgotado" });
    semChave(res, CHAVE.openai);
  });
});

describe("validarChaveIA: OpenRouter", () => {
  it("confere a chave em /key e o modelo com tools em /models", async () => {
    const { fetch, chamadas } = fetchFalso(okOpenRouterChave, okOpenRouterModelos);
    const res = await validarChaveIALogica(entrada("openrouter"), { fetch });
    expect(res).toEqual({ ok: true, ultimos4: "XXXX" });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.url).toBe("https://openrouter.ai/api/v1/key");
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[0]!.init)["Authorization"]).toBe(`Bearer ${CHAVE.openrouter}`);
    const modelos = new URL(chamadas[1]!.url);
    expect(modelos.origin + modelos.pathname).toBe("https://openrouter.ai/api/v1/models");
    expect(modelos.searchParams.get("supported_parameters")).toBe("tools");
  });

  const casosChave: Array<[string, Resposta, ErroChaveIA]> = [
    ["401", { status: 401, corpo: { error: { code: 401, message: `Missing Authentication header ${CHAVE.openrouter}` } } }, "chave_invalida"],
    ["402", { status: 402, corpo: { error: { code: 402, message: "insufficient credits" } } }, "sem_credito"],
    ["403", { status: 403, corpo: { error: { code: 403, message: "x" } } }, "sem_permissao"],
    ["404", { status: 404, corpo: { error: { code: 404, message: "x" } } }, "provedor_fora"],
    ["429", { status: 429, corpo: { error: { code: 429, message: "x" } } }, "provedor_fora"],
    ["502", { status: 502, corpo: { error: { code: 502, message: "x" } } }, "provedor_fora"],
    ["500", { status: 500, corpo: "Internal Server Error" }, "provedor_fora"],
    ["200 com limite zerado", { status: 200, corpo: { data: { limit: 100, limit_remaining: 0 } } }, "sem_credito"],
    ["200 com orçamento zerado", { status: 200, corpo: { data: { limit_remaining: null, effective_budget: { remaining_usd: 0 } } } }, "sem_credito"],
  ];
  for (const [nome, r, esperado] of casosChave) {
    it(`/key ${nome} vira ${esperado} e não consulta os modelos`, async () => {
      const { fetch, chamadas } = fetchFalso(r, okOpenRouterModelos);
      const res = await validarChaveIALogica(entrada("openrouter"), { fetch });
      expect(res).toMatchObject({ ok: false, erro: esperado });
      expect(chamadas).toHaveLength(1);
      semChave(res, CHAVE.openrouter);
    });
  }

  it("modelo fora da lista com tools vira modelo_indisponivel", async () => {
    const { fetch } = fetchFalso(okOpenRouterChave, { status: 200, corpo: { data: [{ id: "openai/gpt-6-luna" }], total_count: 1 } });
    const res = await validarChaveIALogica(entrada("openrouter"), { fetch });
    expect(res).toMatchObject({ ok: false, erro: "modelo_indisponivel" });
  });

  it("modelo que existe mas não aceita tools vira modelo_indisponivel", async () => {
    const { fetch } = fetchFalso(okOpenRouterChave, {
      status: 200,
      corpo: { data: [{ id: "anthropic/claude-haiku-5.5", supported_parameters: ["temperature"] }], total_count: 1 },
    });
    const res = await validarChaveIALogica(entrada("openrouter"), { fetch });
    expect(res).toMatchObject({ ok: false, erro: "modelo_indisponivel" });
  });

  it("404 em /models vira modelo_indisponivel", async () => {
    const { fetch } = fetchFalso(okOpenRouterChave, { status: 404, corpo: {} });
    const res = await validarChaveIALogica(entrada("openrouter"), { fetch });
    expect(res).toMatchObject({ ok: false, erro: "modelo_indisponivel" });
  });

  it("429 e 5xx em /models viram provedor_fora", async () => {
    for (const status of [429, 500, 503]) {
      const { fetch } = fetchFalso(okOpenRouterChave, { status, corpo: {} });
      const res = await validarChaveIALogica(entrada("openrouter"), { fetch });
      expect(res).toMatchObject({ ok: false, erro: "provedor_fora" });
    }
  });

  it("procura o modelo na página seguinte quando a lista é longa", async () => {
    const pagina1 = { status: 200, corpo: { data: [{ id: "a/b", supported_parameters: ["tools"] }], total_count: 2 } };
    const pagina2 = { status: 200, corpo: { data: [{ id: "anthropic/claude-haiku-5.5", supported_parameters: ["tools"] }], total_count: 2 } };
    const { fetch, chamadas } = fetchFalso(okOpenRouterChave, pagina1, pagina2);
    const res = await validarChaveIALogica(entrada("openrouter"), { fetch });
    expect(res).toEqual({ ok: true, ultimos4: "XXXX" });
    expect(new URL(chamadas[2]!.url).searchParams.get("offset")).toBe("1");
  });

  it("tempo esgotado vira tempo_esgotado", async () => {
    const res = await validarChaveIALogica(entrada("openrouter"), { fetch: fetchPendurado(CHAVE.openrouter), prazoMs: 20 });
    expect(res).toMatchObject({ ok: false, erro: "tempo_esgotado" });
    semChave(res, CHAVE.openrouter);
  });
});

describe("validarChaveIA: a chave nunca sai", () => {
  const provedores: ProvedorIA[] = ["anthropic", "openai", "openrouter"];

  it("nem quando o provedor ecoa a chave inteira no corpo do erro", async () => {
    for (const p of provedores) {
      for (const status of [400, 401, 402, 403, 404, 429, 500, 503]) {
        const corpo = { error: { message: `chave ${CHAVE[p]} recusada`, type: CHAVE[p], code: CHAVE[p] } };
        const { fetch } = fetchFalso({ status, corpo });
        const res = await validarChaveIALogica(entrada(p), { fetch });
        expect(res.ok).toBe(false);
        semChave(res, CHAVE[p]);
      }
    }
  });

  it("nem quando o fetch lança um erro com a chave e a URL", async () => {
    for (const p of provedores) {
      const fetch: Fetch = async (url) => {
        throw new Error(`falhou ${url} ${CHAVE[p]}`);
      };
      const res = await validarChaveIALogica(entrada(p), { fetch });
      expect(res).toMatchObject({ ok: false, erro: "provedor_fora" });
      semChave(res, CHAVE[p]);
    }
  });

  it("nem quando a leitura do corpo lança erro", async () => {
    for (const p of provedores) {
      const fetch: Fetch = async () =>
        ({
          status: 500,
          text: async () => {
            throw new Error(CHAVE[p]);
          },
        }) as unknown as Response;
      const res = await validarChaveIALogica(entrada(p), { fetch });
      expect(res.ok).toBe(false);
      semChave(res, CHAVE[p]);
    }
  });

  it("no sucesso, a resposta traz só ok e ultimos4", async () => {
    const { fetch } = fetchFalso({ status: 200, corpo: { echo: CHAVE.anthropic } });
    const res = await validarChaveIALogica(entrada("anthropic"), { fetch });
    expect(Object.keys(res).sort()).toEqual(["ok", "ultimos4"]);
    semChave(res, CHAVE.anthropic);
  });

  it("chave vazia ou modelo vazio não chamam o provedor", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200 });
    expect(await validarChaveIALogica(entrada("openai", { chave: "   " }), { fetch })).toMatchObject({ ok: false, erro: "chave_invalida" });
    expect(await validarChaveIALogica(entrada("openai", { modelo: "" }), { fetch })).toMatchObject({ ok: false, erro: "modelo_indisponivel" });
    expect(chamadas).toHaveLength(0);
  });

  it("a validação da entrada lança erro sem a chave", () => {
    const ruins: unknown[] = [
      { provedor: "provedor-inexistente", chave: CHAVE.openai, modelo: "x" },
      { provedor: "openai", chave: 123, modelo: "x" },
      { provedor: "openai", chave: CHAVE.openai, modelo: 5 },
      { provedor: "openai", chave: CHAVE.openai, modelo: "x", workspaceId: 7 },
      { provedor: "openai", chave: CHAVE.openai + "x".repeat(2000), modelo: "x" },
      null,
      CHAVE.openai,
    ];
    for (const r of ruins) {
      let lancado: unknown;
      try {
        lerEntradaChaveIA(r);
      } catch (e) {
        lancado = e;
      }
      expect(lancado).toBeInstanceOf(Error);
      const e = lancado as Error;
      expect(`${e.message} ${e.stack ?? ""}`).not.toContain(CHAVE.openai);
    }
  });

  it("a validação da entrada aceita o contrato e ignora workspace vazio", () => {
    expect(lerEntradaChaveIA({ provedor: "anthropic", chave: "k", modelo: "m", workspaceId: " " })).toEqual({
      provedor: "anthropic",
      chave: "k",
      modelo: "m",
    });
    expect(lerEntradaChaveIA({ provedor: "anthropic", chave: "k", modelo: "m", workspaceId: "wrkspc_1" })).toEqual({
      provedor: "anthropic",
      chave: "k",
      modelo: "m",
      workspaceId: "wrkspc_1",
    });
  });
});
