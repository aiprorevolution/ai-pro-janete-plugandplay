import { APICallError, generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { classificarErroIA } from "./erros";
import { criarModelo, opcoesDoProvedor } from "./modelo.server";

// fetch falso: guarda o pedido e responde 500, sem sair da máquina
let pedidos: { url: string; headers: Headers; corpo: Record<string, unknown> }[] = [];

const CHAVE = "sk-teste-local-0123456789";

function falharTudo(status = 500, corpo: unknown = { error: { message: "x" } }) {
  pedidos = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      pedidos.push({
        url: String(url),
        headers: new Headers(init.headers),
        corpo: JSON.parse(String(init.body)),
      });
      return new Response(JSON.stringify(corpo), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

async function chamar(
  provedor: "anthropic" | "openai" | "openrouter" | "gemini",
  workspace: string | null,
  resposta: { status: number; corpo: unknown } = {
    status: 500,
    corpo: { error: { message: "x" } },
  },
) {
  falharTudo(resposta.status, resposta.corpo);
  const modelo = criarModelo({
    id: "ch1",
    provedor,
    modelo: provedor === "openrouter" ? "anthropic/claude-haiku-5-5" : "modelo-x",
    workspace_id: workspace,
    chave: CHAVE,
  });
  const erro = await generateText({
    model: modelo,
    instructions: "regras",
    messages: [{ role: "user", content: "oi" }],
    maxRetries: 0,
    providerOptions: opcoesDoProvedor(provedor),
  }).catch((e: unknown) => e);
  return { erro, pedido: pedidos[0] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("modelo", () => {
  it("Anthropic manda o workspace no cabeçalho e não manda temperature", async () => {
    const { erro, pedido } = await chamar("anthropic", "wrkspc_1");
    expect(pedido?.url).toContain("api.anthropic.com");
    expect(pedido?.headers.get("anthropic-workspace-id")).toBe("wrkspc_1");
    expect(pedido?.corpo).not.toHaveProperty("temperature");
    expect(classificarErroIA(erro)).toMatchObject({ motivo: "erro_provedor", passageiro: true });
  });

  it("Anthropic sem workspace não manda o cabeçalho", async () => {
    const { pedido } = await chamar("anthropic", null);
    expect(pedido?.headers.has("anthropic-workspace-id")).toBe(false);
  });

  it("OpenAI vai com store: false", async () => {
    const { pedido } = await chamar("openai", null);
    expect(pedido?.url).toContain("api.openai.com");
    expect(pedido?.corpo["store"]).toBe(false);
    expect(pedido?.corpo).not.toHaveProperty("temperature");
  });

  it("OpenRouter vai para a API da OpenRouter", async () => {
    const { pedido } = await chamar("openrouter", null);
    expect(pedido?.url).toContain("openrouter.ai");
    expect(pedido?.corpo).not.toHaveProperty("temperature");
  });

  it("Gemini usa a chave própria no cabeçalho e suporta o mesmo contrato de geração", async () => {
    const { pedido } = await chamar("gemini", null);
    expect(pedido?.url).toContain("generativelanguage.googleapis.com");
    expect(pedido?.headers.get("x-goog-api-key")).toBe(CHAVE);
    expect(pedido?.url).not.toContain(CHAVE);
    expect(JSON.stringify(pedido?.corpo)).not.toContain(CHAVE);
  });

  it("Anthropic liga o cache automático no nível de cima", async () => {
    const { pedido } = await chamar("anthropic", null);
    expect(pedido?.corpo["cache_control"]).toEqual({ type: "ephemeral" });
  });

  it.each([
    ["anthropic", "x-api-key", CHAVE],
    ["openai", "authorization", `Bearer ${CHAVE}`],
    ["openrouter", "authorization", `Bearer ${CHAVE}`],
  ] as const)("%s: a chave vai só no cabeçalho %s", async (provedor, cabecalho, valor) => {
    const { pedido } = await chamar(provedor, null);
    expect(pedido?.headers.get(cabecalho)).toBe(valor);
    expect(JSON.stringify(pedido?.corpo)).not.toContain(CHAVE);
    expect(pedido?.url).not.toContain(CHAVE);
    const outros = [...(pedido?.headers.entries() ?? [])].filter(([nome]) => nome !== cabecalho);
    expect(outros.some(([, v]) => v.includes(CHAVE))).toBe(false);
  });

  it("OpenRouter: 403 de moderação (resposta real) não marca a chave", async () => {
    const { erro } = await chamar("openrouter", null, {
      status: 403,
      corpo: {
        error: {
          code: 403,
          message: "Input was flagged",
          metadata: { reasons: ["harassment"], flagged_input: "...", provider_name: "x" },
        },
      },
    });
    const classe = classificarErroIA(erro, "openrouter");
    expect(classe).toEqual({
      motivo: "erro_provedor",
      passageiro: false,
      codigo: "http_403_moderacao",
    });
  });

  it("Anthropic: 429 de teto mensal (resposta real) é sem_credito, não passageiro", async () => {
    const { erro } = await chamar("anthropic", null, {
      status: 429,
      corpo: {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: "Spend limit reached",
          details: { error_code: "enforced_spend_limit_reached" },
        },
      },
    });
    expect(classificarErroIA(erro, "anthropic")).toMatchObject({
      motivo: "sem_credito",
      passageiro: false,
      statusChave: "sem_credito",
      codigo: "http_429",
    });
  });
});

describe("classificarErroIA", () => {
  const erroHttp = (statusCode: number, responseBody?: string) =>
    new APICallError({
      message: "x",
      url: "u",
      requestBodyValues: {},
      statusCode,
      ...(responseBody ? { responseBody } : {}),
    });

  it("403 da Anthropic e da OpenAI é chave inválida", () => {
    for (const provedor of ["anthropic", "openai"] as const) {
      expect(
        classificarErroIA(erroHttp(403, '{"error":{"type":"permission_error"}}'), provedor),
      ).toMatchObject({ motivo: "chave_invalida", statusChave: "invalida", codigo: "http_403" });
    }
  });

  it("403 com reasons ou flagged_input é moderação em qualquer provedor", () => {
    const corpo = '{"error":{"code":403,"metadata":{"flagged_input":"x"}}}';
    const classe = classificarErroIA(erroHttp(403, corpo));
    expect(classe).toMatchObject({ motivo: "erro_provedor", passageiro: false });
    expect(classe.statusChave).toBeUndefined();
  });

  it("400 de limite de uso do workspace é sem_credito", () => {
    const corpo = JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "You have reached your specified workspace API usage limits.",
      },
    });
    expect(classificarErroIA(erroHttp(400, corpo), "anthropic")).toMatchObject({
      motivo: "sem_credito",
      passageiro: false,
      statusChave: "sem_credito",
    });
  });

  it("OpenRouter 402: em voo é passageiro; sem saldo ou limite da chave é sem_credito", () => {
    const emVoo = JSON.stringify({
      error: {
        code: 402,
        message: "Insufficient credits for in-flight requests",
        metadata: { limit_source: "openrouter_in_flight_budget" },
      },
    });
    const classe = classificarErroIA(erroHttp(402, emVoo), "openrouter");
    expect(classe).toEqual({
      motivo: "erro_provedor",
      passageiro: true,
      codigo: "http_402_em_voo",
    });
    for (const fonte of ["openrouter_credits", "openrouter_key_limit"]) {
      const corpo = JSON.stringify({
        error: { code: 402, message: "Insufficient credits", metadata: { limit_source: fonte } },
      });
      expect(classificarErroIA(erroHttp(402, corpo), "openrouter")).toMatchObject({
        motivo: "sem_credito",
        statusChave: "sem_credito",
      });
    }
  });

  it("palavra solta de cobrança fora do código ou da frase não marca sem_credito", () => {
    const corpos = [
      '{"error":{"type":"invalid_request_error","message":"Invalid billing_address field"}}',
      '{"error":{"message":"bad request","param":"spend limit insufficient_quota saldo"}}',
      "billing spend limit insufficient credits (texto solto, sem JSON)",
    ];
    for (const corpo of corpos) {
      expect(classificarErroIA(erroHttp(400, corpo), "openai")).toEqual({
        motivo: "erro_provedor",
        passageiro: false,
        codigo: "http_400",
      });
    }
    // 429 comum (excesso de pedidos) segue passageiro
    const excesso = '{"error":{"type":"rate_limit_error","message":"Rate limit, billing tier 1"}}';
    expect(classificarErroIA(erroHttp(429, excesso), "anthropic")).toMatchObject({
      motivo: "erro_provedor",
      passageiro: true,
    });
  });

  it("códigos de cobrança da OpenAI no type ou no code são sem_credito", () => {
    for (const codigo of [
      "credit_balance_exhausted",
      "organization_spend_limit_exceeded",
      "project_spend_limit_exceeded",
      "organization_usage_limit_exceeded",
    ]) {
      const corpo = JSON.stringify({ error: { type: "insufficient_quota", code: codigo } });
      expect(classificarErroIA(erroHttp(429, corpo), "openai")).toMatchObject({
        motivo: "sem_credito",
        passageiro: false,
      });
      const soCodigo = JSON.stringify({ error: { type: "requests", code: codigo } });
      expect(classificarErroIA(erroHttp(429, soCodigo), "openai")).toMatchObject({
        motivo: "sem_credito",
      });
    }
  });

  it("cota esgotada no 429, 5xx, 400 e tempo esgotado", () => {
    expect(
      classificarErroIA(erroHttp(429, '{"error":{"code":"insufficient_quota"}}')),
    ).toMatchObject({ motivo: "sem_credito", passageiro: false, statusChave: "sem_credito" });
    expect(classificarErroIA(erroHttp(529))).toMatchObject({ passageiro: true });
    expect(classificarErroIA(erroHttp(400))).toMatchObject({
      motivo: "erro_provedor",
      passageiro: false,
    });
    const tempo = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(classificarErroIA(tempo)).toMatchObject({ motivo: "erro_provedor", passageiro: true });
    expect(classificarErroIA(new TypeError("fetch failed"))).toMatchObject({ passageiro: true });
  });
});
