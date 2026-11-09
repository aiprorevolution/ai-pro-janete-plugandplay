import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  baseEvolution,
  lerEntradaConexao,
  validarConexaoLogica,
  type ErroConexao,
  type Gateway,
} from "@/features/servidor/conexao";
import type { Fetch } from "@/features/servidor/http";

// Credenciais falsas, longas e únicas, para provar que nunca aparecem em nada que sai.
const TOKEN_META = "EAAGTESTEmetaTOKEN1234567890abcdefMETA";
const APP_SECRET = "appsecretTESTE0987654321fedcbaSEGREDO";
const CHAVE_ZERNIO = "sk_TESTEzernio0123456789abcdef0123456789abcdef0123456789abcdefZRN";
const TOKEN_ZAPI = "TOKENinstanciaTESTE0A1B2C3D4E5F6ZAPI";
const CLIENT_TOKEN = "CLIENTtokenTESTEf9e8d7c6b5a4CLNT";
const CHAVE_EVOLUTION = "EVOapikeyTESTE5566778899aabbccEVO";

const SEGREDOS = [TOKEN_META, APP_SECRET, CHAVE_ZERNIO, TOKEN_ZAPI, CLIENT_TOKEN, CHAVE_EVOLUTION];

const CAMPOS: Record<Exclude<Gateway, "descontinuado">, Record<string, string>> = {
  meta: { phoneId: "106540352242922", wabaId: "102290129340398", token: TOKEN_META, appSecret: APP_SECRET },
  zernio: { apiKey: CHAVE_ZERNIO },
  zapi: { instanceId: "3C2A0B1C2D3E4F", instanceToken: TOKEN_ZAPI, clientToken: CLIENT_TOKEN },
  evolution: { serverUrl: "https://evolution.suaempresa.com.br/", instanceName: "vendas", apiKey: CHAVE_EVOLUTION },
};

type Chamada = { url: string; init: RequestInit };
type Resposta = { status: number; corpo?: unknown };

function resposta(r: Resposta): Response {
  const texto = r.corpo === undefined ? "" : typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo);
  return { status: r.status, text: async () => texto } as unknown as Response;
}

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

function fetchPendurado(): Fetch {
  return (url, init) =>
    new Promise<Response>((_ok, falhar) => {
      init?.signal?.addEventListener("abort", () => falhar(new Error(`abortado ${url} ${SEGREDOS.join(" ")}`)));
    });
}

function cabecalhos(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

function semSegredo(resultado: unknown) {
  const json = JSON.stringify(resultado);
  for (const s of SEGREDOS) {
    expect(json).not.toContain(s);
    expect(json).not.toContain(s.slice(4, -4));
  }
}

function validar(gateway: Gateway, campos?: Record<string, string>, fetch?: Fetch, prazoMs?: number) {
  const opcoes: { fetch?: Fetch; prazoMs?: number } = {};
  if (fetch) opcoes.fetch = fetch;
  if (prazoMs !== undefined) opcoes.prazoMs = prazoMs;
  const c = campos ?? (gateway === "descontinuado" ? {} : CAMPOS[gateway]);
  return validarConexaoLogica({ gateway, campos: c }, opcoes);
}

type Caso = [string, Resposta, ErroConexao | "ok", string | undefined];

function rodarCasos(gateway: Exclude<Gateway, "descontinuado">, casos: Caso[]) {
  for (const [nome, r, esperado, campo] of casos) {
    it(`${nome} vira ${esperado}${campo ? ` (${campo})` : ""}`, async () => {
      const { fetch } = fetchFalso(r);
      const res = await validar(gateway, undefined, fetch);
      if (esperado === "ok") {
        expect(res.ok).toBe(true);
      } else {
        expect(res).toMatchObject({ ok: false, erro: esperado });
        if (!res.ok) {
          expect(res.campo).toBe(campo);
          expect(res.mensagem.length).toBeGreaterThan(20);
        }
      }
      semSegredo(res);
    });
  }
  it("tempo esgotado vira tempo_esgotado", async () => {
    const res = await validar(gateway, undefined, fetchPendurado(), 20);
    expect(res).toMatchObject({ ok: false, erro: "tempo_esgotado" });
    semSegredo(res);
  });
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
  for (const e of espioes) expect(e).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe("validarConexao: Meta", () => {
  it("chama a Graph API v26.0 no phone_number_id com Bearer", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { display_phone_number: "+55 11 90000-0000", verified_name: "Casa Verde", id: "106540352242922" } });
    const res = await validar("meta", undefined, fetch);
    expect(res).toEqual({ ok: true, rotulo: "+55 11 90000-0000 · Casa Verde" });
    expect(chamadas).toHaveLength(1);
    const url = new URL(chamadas[0]!.url);
    expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v26.0/106540352242922");
    expect(url.searchParams.get("fields")).toBe("display_phone_number,verified_name");
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[0]!.init)["Authorization"]).toBe(`Bearer ${TOKEN_META}`);
    expect(chamadas[0]!.url).not.toContain(TOKEN_META);
    expect(chamadas[0]!.init.redirect).toBe("manual");
    expect(chamadas[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  rodarCasos("meta", [
    ["200", { status: 200, corpo: { display_phone_number: "5511900000000" } }, "ok", undefined],
    ["401", { status: 401, corpo: { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } } }, "credencial_invalida", "token"],
    ["400 com código 190", { status: 400, corpo: { error: { message: "Error validating access token", type: "OAuthException", code: 190 } } }, "credencial_invalida", "token"],
    ["403", { status: 403, corpo: { error: { message: "x", code: 200 } } }, "credencial_invalida", "token"],
    ["404", { status: 404, corpo: { error: { message: "x" } } }, "nao_encontrado", "phoneId"],
    ["400 com código 100", { status: 400, corpo: { error: { message: "Unsupported get request. Object with ID does not exist", type: "GraphMethodException", code: 100, error_subcode: 33 } } }, "nao_encontrado", "phoneId"],
    ["429", { status: 429, corpo: { error: { message: "x", code: 4 } } }, "servidor_inacessivel", undefined],
    ["500", { status: 500, corpo: { error: { message: "x", code: 1 } } }, "servidor_inacessivel", undefined],
    ["503", { status: 503, corpo: "Service Unavailable" }, "servidor_inacessivel", undefined],
  ]);

  it("Phone Number ID que não é número não chama a Meta", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200 });
    const res = await validar("meta", { ...CAMPOS.meta, phoneId: "../me" }, fetch);
    expect(res).toMatchObject({ ok: false, erro: "nao_encontrado", campo: "phoneId" });
    expect(chamadas).toHaveLength(0);
  });

  it("token vazio não chama a Meta", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200 });
    const res = await validar("meta", { ...CAMPOS.meta, token: " " }, fetch);
    expect(res).toMatchObject({ ok: false, erro: "credencial_invalida", campo: "token" });
    expect(chamadas).toHaveLength(0);
  });
});

describe("validarConexao: Zernio", () => {
  const contas = { accounts: [{ _id: "acc_1", platform: "whatsapp", phoneNumber: "5511900000000", displayName: "Casa Verde" }] };

  it("chama GET /api/v1/accounts em zernio.com com Bearer", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: contas });
    const res = await validar("zernio", undefined, fetch);
    expect(res).toEqual({ ok: true, rotulo: "+5511900000000" });
    expect(chamadas[0]!.url).toBe("https://zernio.com/api/v1/accounts");
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[0]!.init)["Authorization"]).toBe(`Bearer ${CHAVE_ZERNIO}`);
  });

  rodarCasos("zernio", [
    ["200", { status: 200, corpo: contas }, "ok", undefined],
    ["200 sem número de WhatsApp", { status: 200, corpo: { accounts: [{ _id: "acc_2", platform: "instagram", username: "x" }] } }, "nao_encontrado", undefined],
    ["401", { status: 401, corpo: { error: "Unauthorized" } }, "credencial_invalida", "apiKey"],
    ["403", { status: 403, corpo: { error: "Forbidden" } }, "credencial_invalida", "apiKey"],
    ["404", { status: 404, corpo: { error: "Not found" } }, "nao_encontrado", undefined],
    ["429", { status: 429, corpo: { error: "Too many requests", details: { retryAfterSeconds: 30 } } }, "servidor_inacessivel", undefined],
    ["500", { status: 500, corpo: { error: "x" } }, "servidor_inacessivel", undefined],
  ]);

  it("com accountId, confere que a conta existe", async () => {
    const { fetch } = fetchFalso({ status: 200, corpo: contas });
    expect(await validar("zernio", { apiKey: CHAVE_ZERNIO, accountId: "acc_1" }, fetch)).toMatchObject({ ok: true });
    const outro = fetchFalso({ status: 200, corpo: contas });
    expect(await validar("zernio", { apiKey: CHAVE_ZERNIO, accountId: "acc_9" }, outro.fetch)).toMatchObject({
      ok: false,
      erro: "nao_encontrado",
      campo: "accountId",
    });
  });
});

describe("validarConexao: Z-API", () => {
  it("chama GET /status da instância com o cabeçalho Client-Token", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { connected: true, error: "You are already connected.", smartphoneConnected: true } });
    const res = await validar("zapi", undefined, fetch);
    expect(res).toEqual({ ok: true, rotulo: "Instância 3C2A0B1C2D3E4F" });
    expect(chamadas[0]!.url).toBe(`https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/status`);
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[0]!.init)["Client-Token"]).toBe(CLIENT_TOKEN);
  });

  rodarCasos("zapi", [
    ["200 conectada", { status: 200, corpo: { connected: true, smartphoneConnected: true } }, "ok", undefined],
    ["200 desconectada", { status: 200, corpo: { connected: false, error: "You are not connected.", smartphoneConnected: false } }, "instancia_desconectada", undefined],
    ["200 sem sessão", { status: 200, corpo: { connected: false, error: "You need to restore the session." } }, "instancia_desconectada", undefined],
    ["200 sem Client-Token", { status: 200, corpo: { error: "null not allowed" } }, "credencial_invalida", "clientToken"],
    ["400 sem Client-Token", { status: 400, corpo: { error: "Client-Token null not allowed" } }, "credencial_invalida", "clientToken"],
    ["401", { status: 401, corpo: { error: "Unauthorized" } }, "credencial_invalida", "instanceToken"],
    ["403 do Client-Token", { status: 403, corpo: { error: "Client-Token is not valid" } }, "credencial_invalida", "clientToken"],
    ["404", { status: 404, corpo: { error: "Instance not found" } }, "nao_encontrado", "instanceId"],
    ["429", { status: 429, corpo: {} }, "servidor_inacessivel", undefined],
    ["500", { status: 500, corpo: {} }, "servidor_inacessivel", undefined],
  ]);
});

describe("validarConexao: Evolution", () => {
  it("chama GET /instance/connectionState/{instância} com o cabeçalho apikey", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { instance: { instanceName: "vendas", state: "open" } } });
    const res = await validar("evolution", undefined, fetch);
    expect(res).toEqual({ ok: true, rotulo: "Instância “vendas” em evolution.suaempresa.com.br" });
    expect(chamadas[0]!.url).toBe("https://evolution.suaempresa.com.br/instance/connectionState/vendas");
    expect(chamadas[0]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[0]!.init)["apikey"]).toBe(CHAVE_EVOLUTION);
  });

  rodarCasos("evolution", [
    ["200 aberta", { status: 200, corpo: { instance: { instanceName: "vendas", state: "open" } } }, "ok", undefined],
    ["200 fechada", { status: 200, corpo: { instance: { instanceName: "vendas", state: "close" } } }, "instancia_desconectada", undefined],
    ["200 conectando", { status: 200, corpo: { instance: { state: "connecting" } } }, "instancia_desconectada", undefined],
    ["200 que não é Evolution", { status: 200, corpo: "<html>ok</html>" }, "servidor_inacessivel", "serverUrl"],
    ["401", { status: 401, corpo: { status: 401, error: "Unauthorized", response: { message: "Unauthorized" } } }, "credencial_invalida", "apiKey"],
    ["403", { status: 403, corpo: { status: 403, error: "Forbidden", response: { message: "Forbidden" } } }, "credencial_invalida", "apiKey"],
    ["404", { status: 404, corpo: { status: 404, error: "Not Found", response: { message: ["The \"vendas\" instance does not exist"] } } }, "nao_encontrado", "instanceName"],
    ["429", { status: 429, corpo: {} }, "servidor_inacessivel", undefined],
    ["500", { status: 500, corpo: { status: 500, error: "Internal Server Error" } }, "servidor_inacessivel", "serverUrl"],
    ["503 de licença", { status: 503, corpo: { success: false, error: { code: "LICENSE_REQUIRED", message: "x" } } }, "servidor_inacessivel", "serverUrl"],
  ]);

  it("servidor fora do ar vira servidor_inacessivel no campo da URL", async () => {
    const fetch: Fetch = async (url) => {
      throw new TypeError(`fetch failed ${url} ${CHAVE_EVOLUTION}`);
    };
    const res = await validar("evolution", undefined, fetch);
    expect(res).toMatchObject({ ok: false, erro: "servidor_inacessivel", campo: "serverUrl" });
    semSegredo(res);
  });

  it("URL sem https, com senha ou de rede interna não é chamada", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200 });
    for (const serverUrl of [
      "http://evolution.suaempresa.com.br",
      "evolution.suaempresa.com.br",
      "https://usuario:senha@evolution.suaempresa.com.br",
      "https://localhost:8080",
      "https://127.0.0.1",
      "https://10.0.0.5",
      "https://192.168.0.10",
      "https://172.20.1.1",
      "https://169.254.169.254",
      "https://[::1]",
    ]) {
      const res = await validar("evolution", { ...CAMPOS.evolution, serverUrl }, fetch);
      expect(res).toMatchObject({ ok: false, erro: "servidor_inacessivel", campo: "serverUrl" });
    }
    expect(chamadas).toHaveLength(0);
  });

  it("aceita servidor com caminho e tira a barra do fim", () => {
    expect(baseEvolution("https://api.empresa.com/evolution/")).toEqual({
      base: "https://api.empresa.com/evolution",
      host: "api.empresa.com",
    });
    expect(baseEvolution("https://evo.empresa.com/")?.base).toBe("https://evo.empresa.com");
  });
});

describe("validarConexao: Descontinuado", () => {
  it("devolve nao_suportado sem chamar nada", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200 });
    const res = await validar("descontinuado", {}, fetch);
    expect(res).toMatchObject({ ok: false, erro: "nao_suportado" });
    if (!res.ok) expect(res.mensagem).toMatch(/Descontinuado/);
    expect(chamadas).toHaveLength(0);
  });
});

describe("validarConexao: a credencial nunca sai", () => {
  const gateways: Array<Exclude<Gateway, "descontinuado">> = ["meta", "zernio", "zapi", "evolution"];

  // cada gateway só conhece as credenciais dele: é isso que ele poderia ecoar
  const doGateway: Record<Exclude<Gateway, "descontinuado">, string[]> = {
    meta: [TOKEN_META, APP_SECRET],
    zernio: [CHAVE_ZERNIO],
    zapi: [TOKEN_ZAPI, CLIENT_TOKEN],
    evolution: [CHAVE_EVOLUTION],
  };

  it("nem quando o gateway ecoa a credencial no corpo", async () => {
    for (const g of gateways) {
      const eco = `recebido ${doGateway[g].join(" ")}`;
      for (const status of [200, 400, 401, 403, 404, 429, 500, 503]) {
        const corpo = { error: { message: eco, code: eco }, display_phone_number: eco, accounts: [{ platform: "whatsapp", phoneNumber: eco }], connected: false, instance: { state: eco } };
        const { fetch } = fetchFalso({ status, corpo });
        const res = await validar(g, undefined, fetch);
        semSegredo(res);
      }
    }
  });

  it("nem quando o fetch lança um erro com a URL e a credencial", async () => {
    for (const g of gateways) {
      const fetch: Fetch = async (url, init) => {
        throw new Error(`falhou ${url} ${JSON.stringify(init?.headers)}`);
      };
      const res = await validar(g, undefined, fetch);
      expect(res).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
      semSegredo(res);
    }
  });

  it("a validação da entrada lança erro sem a credencial", () => {
    const ruins: unknown[] = [
      { gateway: "telegram", campos: { token: TOKEN_META } },
      { gateway: "meta", campos: { token: 123 } },
      { gateway: "meta", campos: [TOKEN_META] },
      { gateway: "meta", campos: { token: TOKEN_META + "x".repeat(3000) } },
      TOKEN_META,
      null,
    ];
    for (const r of ruins) {
      let lancado: unknown;
      try {
        lerEntradaConexao(r);
      } catch (e) {
        lancado = e;
      }
      expect(lancado).toBeInstanceOf(Error);
      const e = lancado as Error;
      expect(`${e.message} ${e.stack ?? ""}`).not.toContain(TOKEN_META);
    }
  });

  it("a validação da entrada aceita o contrato", () => {
    expect(lerEntradaConexao({ gateway: "zapi", campos: { instanceId: "a", instanceToken: "b", clientToken: "c" } })).toEqual({
      gateway: "zapi",
      campos: { instanceId: "a", instanceToken: "b", clientToken: "c" },
    });
    expect(lerEntradaConexao({ gateway: "descontinuado" })).toEqual({ gateway: "descontinuado", campos: {} });
  });
});
