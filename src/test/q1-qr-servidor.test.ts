import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClienteUsuario, ContextoUsuario } from "@/features/mensageria/configuracao.server";
import type { ConexaoServidor } from "@/features/mensageria/nucleo/tipos";
import type { Fetch } from "@/features/servidor/http";

// Q1: o QR code da Z-API e da Evolution no servidor (qr-conexao, qr.server, qr.functions) e na
// camada de dados (onboarding e Configuração). O fetch é falso e o banco também: nada vai à rede
// nem grava no banco. Spec: docs/spec-qr-whatsapp.md, linha F1.

const dubles = vi.hoisted(() => ({
  conexaoAtiva: vi.fn(),
  /** tudo que grava: não pode ser chamado */
  gravar: {
    gravarConexao: vi.fn(),
    gravarChaveIA: vi.fn(),
    carregarConexao: vi.fn(),
    carregarConexaoPorExterno: vi.fn(),
    lerChaveIA: vi.fn(),
  },
  banco: {
    auditar: vi.fn(),
    idConexaoAtiva: vi.fn(),
    desativarConexao: vi.fn(),
    gravarStatusConexao: vi.fn(),
    regravarConexao: vi.fn(),
    lerResumoChaveIA: vi.fn(),
    gravarStatusChave: vi.fn(),
    gravarModeloChave: vi.fn(),
    apagarChave: vi.fn(),
    gravarRitmo: vi.fn(),
  },
}));

vi.mock("@/integrations/firebase/client.server", () => ({
  firebaseAdmin: new Proxy(
    {},
    {
      get: () => {
        throw new Error("banco real não pode ser usado");
      },
    },
  ),
}));
vi.mock("@/features/mensageria/nucleo/conexoes.server", () => ({ conexaoAtiva: dubles.conexaoAtiva, ...dubles.gravar }));
vi.mock("@/features/mensageria/configuracao/banco.server", () => dubles.banco);

import { pedirQrConexaoLogica, pedirQrGuardadaLogica } from "@/features/mensageria/qr.server";
import { lerEntradaPedirQrGuardada } from "@/features/mensageria/qr.functions";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import {
  criarAcoesConfiguracaoBanco,
  useDadosConfiguracao,
  type ServidorConfiguracao,
} from "@/features/plataforma/dados/configuracao";
import {
  criarDadosOnboardingMemoria,
  useDadosOnboardingBanco,
  type ServidorOnboarding,
} from "@/features/plataforma/dados/onboarding";
import { criarClienteFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarEstadoInicial } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";
import {
  lerEntradaQr,
  lerImagemQr,
  pedirQrLogica,
  type EntradaQr,
  type GatewayQr,
  type PedidoQr,
} from "@/features/servidor/qr-conexao";

// Credenciais falsas, longas e únicas, para provar que nunca aparecem em nada que sai.
const TOKEN_ZAPI = "TOKENinstanciaQR0A1B2C3D4E5F6ZAPI";
const CLIENT_TOKEN = "CLIENTtokenQRf9e8d7c6b5a4CLNT";
const CHAVE_EVOLUTION = "EVOapikeyQR5566778899aabbccEVO";
const SEGREDOS = [TOKEN_ZAPI, CLIENT_TOKEN, CHAVE_EVOLUTION];

const CAMPOS: Record<GatewayQr, Record<string, string>> = {
  zapi: { instanceId: "3C2A0B1C2D3E4F", instanceToken: TOKEN_ZAPI, clientToken: CLIENT_TOKEN },
  evolution: { serverUrl: "https://evolution.suaempresa.com.br/", instanceName: "vendas", apiKey: CHAVE_EVOLUTION },
};

// um png de verdade (1x1), repetido para passar dos 100 caracteres do base64 sem prefixo
const BASE64_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${BASE64_PNG}`;
const CRU = "A".repeat(120);

type Chamada = { url: string; init: RequestInit };
type Resposta = { status: number; corpo?: unknown } | "rede" | "pendurado";

/** Cada chamada recebe a próxima resposta; "rede" lança e "pendurado" só termina no prazo. */
function fetchFalso(...respostas: Resposta[]): { fetch: Fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  let i = 0;
  const fetch: Fetch = async (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (!r) throw new Error("sem resposta configurada");
    if (r === "rede") throw new TypeError(`fetch failed ${url} ${SEGREDOS.join(" ")}`);
    if (r === "pendurado") {
      return new Promise<Response>((_ok, falhar) => {
        init?.signal?.addEventListener("abort", () => falhar(new Error(`abortado ${url} ${SEGREDOS.join(" ")}`)));
      });
    }
    const texto = r.corpo === undefined ? "" : typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo);
    return { status: r.status, text: async () => texto } as unknown as Response;
  };
  return { fetch, chamadas };
}

function semSegredo(resultado: unknown) {
  const json = JSON.stringify(resultado);
  for (const s of SEGREDOS) {
    expect(json).not.toContain(s);
    expect(json).not.toContain(s.slice(4, -4));
  }
}

function cabecalhos(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

const ZAPI_DESCONECTADA = { status: 200, corpo: { connected: false, error: "You are not connected.", smartphoneConnected: false } };
const ZAPI_CONECTADA = { status: 200, corpo: { connected: true, error: null, smartphoneConnected: true } };
const EVO_DESCONECTADA = { status: 200, corpo: { instance: { instanceName: "vendas", state: "close" } } };
const EVO_CONECTADA = { status: 200, corpo: { instance: { instanceName: "vendas", state: "open" } } };
const DESCONECTADA: Record<GatewayQr, Resposta> = { zapi: ZAPI_DESCONECTADA, evolution: EVO_DESCONECTADA };

function pedirQr(gateway: GatewayQr, pedir: PedidoQr, f: Fetch, prazoMs?: number) {
  const opcoes: { fetch: Fetch; prazoMs?: number } = { fetch: f };
  if (prazoMs !== undefined) opcoes.prazoMs = prazoMs;
  return pedirQrLogica({ gateway, campos: CAMPOS[gateway], pedir }, opcoes);
}

beforeEach(() => {
  dubles.conexaoAtiva.mockReset().mockResolvedValue(null);
  for (const f of [...Object.values(dubles.gravar), ...Object.values(dubles.banco)]) f.mockReset();
});

/* ---------- entrada e imagem ---------- */

describe("lerEntradaQr", () => {
  it("aceita só zapi e evolution, com pedir qr ou situacao", () => {
    expect(lerEntradaQr({ gateway: "zapi", campos: CAMPOS.zapi, pedir: "qr" })).toEqual({
      gateway: "zapi",
      campos: CAMPOS.zapi,
      pedir: "qr",
    });
    expect(lerEntradaQr({ gateway: "evolution", pedir: "situacao" })).toEqual({ gateway: "evolution", campos: {}, pedir: "situacao" });
    for (const ruim of [
      null,
      "zapi",
      [],
      { gateway: "meta", campos: {}, pedir: "qr" },
      { gateway: "zernio", campos: {}, pedir: "qr" },
      { gateway: "zapi", campos: {}, pedir: "outro" },
      { gateway: "zapi", campos: {} },
      { gateway: "zapi", campos: { instanceToken: 5 }, pedir: "qr" },
      { gateway: "zapi", campos: { instanceToken: "x".repeat(2001) }, pedir: "qr" },
      { gateway: "zapi", campos: { ["n".repeat(51)]: "x" }, pedir: "qr" },
      { gateway: "zapi", campos: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`c${i}`, "x"])), pedir: "qr" },
    ]) {
      expect(() => lerEntradaQr(ruim)).toThrow(/Pedido inválido/);
    }
  });

  it("o erro não leva nenhum valor da entrada", () => {
    try {
      lerEntradaQr({ gateway: "zapi", campos: { instanceToken: TOKEN_ZAPI.repeat(100) }, pedir: "qr" });
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(TOKEN_ZAPI);
    }
  });

  it("lerEntradaPedirQrGuardada aceita só { pedir: qr | situacao }", () => {
    expect(lerEntradaPedirQrGuardada({ pedir: "qr" })).toEqual({ pedir: "qr" });
    expect(lerEntradaPedirQrGuardada({ pedir: "situacao" })).toEqual({ pedir: "situacao" });
    for (const ruim of [null, undefined, {}, { pedir: "x" }, { pedir: "qr", gateway: "zapi" }, ["qr"]]) {
      expect(() => lerEntradaPedirQrGuardada(ruim)).toThrow(/Pedido inválido/);
    }
  });
});

describe("lerImagemQr", () => {
  it("aceita png e jpeg em base64, com quebras de linha", () => {
    expect(lerImagemQr(PNG)).toBe(PNG);
    expect(lerImagemQr(`data:image/jpeg;base64,${BASE64_PNG}`)).toBe(`data:image/jpeg;base64,${BASE64_PNG}`);
    expect(lerImagemQr(`data:image/png;base64,${BASE64_PNG.slice(0, 40)}\n${BASE64_PNG.slice(40)}\r\n`)).toBe(PNG);
  });

  it("base64 cru (100 ou mais caracteres) vira png", () => {
    expect(lerImagemQr(CRU)).toBe(`data:image/png;base64,${CRU}`);
    expect(lerImagemQr("A".repeat(99))).toBeNull();
  });

  it("o resto vira null", () => {
    for (const ruim of [
      null,
      undefined,
      42,
      {},
      "",
      "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      `data:image/png;base64,${BASE64_PNG}<script>`,
      "data:image/png;base64,",
      "https://exemplo.com/qr.png",
      `${"A".repeat(120)}!`,
      `data:image/png;base64,${"A".repeat(300 * 1024)}`,
      "A".repeat(300 * 1024),
    ]) {
      expect(lerImagemQr(ruim)).toBeNull();
    }
  });
});

/* ---------- Z-API ---------- */

describe("pedirQrLogica: Z-API", () => {
  it("conectado: a /status e o /device (o número, seção 8), sem pedir o QR; devolve o rótulo", async () => {
    const { fetch, chamadas } = fetchFalso(ZAPI_CONECTADA);
    const r = await pedirQr("zapi", "qr", fetch);
    expect(r).toEqual({ ok: true, conectado: true, rotulo: "Instância 3C2A0B1C2D3E4F" });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.url).toMatch(/\/status$/);
    expect(chamadas[1]!.url).toMatch(/\/device$/);
  });

  it("situacao com o número desconectado: 1 chamada só, sem QR", async () => {
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: { value: PNG } });
    const r = await pedirQr("zapi", "situacao", fetch);
    expect(r).toEqual({ ok: true, conectado: false, qr: null, passkey: false });
    expect(chamadas).toHaveLength(1);
  });

  it("qr com o número desconectado: 2 chamadas, a 2ª no /qr-code com o Client-Token", async () => {
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: { value: PNG } });
    const r = await pedirQr("zapi", "qr", fetch);
    expect(r).toEqual({ ok: true, conectado: false, qr: PNG, passkey: false });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.url).toBe(`https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/qr-code`);
    expect(chamadas[1]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[1]!.init)["Client-Token"]).toBe(CLIENT_TOKEN);
    expect(chamadas[1]!.init.redirect).toBe("manual");
  });

  it("sem imagem (nem no /qr-code/image): qr null, sem passkey, 3 chamadas", async () => {
    for (const corpo of [{}, { value: null }, "ok"]) {
      const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo });
      expect(await pedirQr("zapi", "qr", fetch)).toEqual({ ok: true, conectado: false, qr: null, passkey: false });
      expect(chamadas).toHaveLength(3);
    }
  });

  it("/qr-code com {connected: true}: sem QR, 2 chamadas (não pede o /qr-code/image)", async () => {
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: { connected: true } });
    expect(await pedirQr("zapi", "qr", fetch)).toEqual({ ok: true, conectado: false, qr: null, passkey: false });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.url).toMatch(/\/qr-code$/);
  });

  it("imagem inválida: qr null", async () => {
    const { fetch } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: { value: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" } });
    expect(await pedirQr("zapi", "qr", fetch)).toEqual({ ok: true, conectado: false, qr: null, passkey: false });
  });

  it("passkey ({challenge}): qr null, passkey true", async () => {
    const corpo = { challenge: { rpId: "whatsapp.com", challenge: "abc", timeout: 600000 } };
    const { fetch } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo });
    expect(await pedirQr("zapi", "qr", fetch)).toEqual({ ok: true, conectado: false, qr: null, passkey: true });
  });

  it("/qr-code com texto cru: o mesmo pedido chama o /qr-code/image e devolve a imagem dele", async () => {
    const { fetch, chamadas } = fetchFalso(
      ZAPI_DESCONECTADA,
      { status: 200, corpo: { value: "2@AbCdEf123,XyZ456,QrCru789==" } },
      { status: 200, corpo: { value: PNG } },
    );
    const r = await pedirQr("zapi", "qr", fetch);
    expect(r).toEqual({ ok: true, conectado: false, qr: PNG, passkey: false });
    expect(chamadas.map((c) => c.url)).toEqual([
      `https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/status`,
      `https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/qr-code`,
      `https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/qr-code/image`,
    ]);
    expect(chamadas[2]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[2]!.init)["Client-Token"]).toBe(CLIENT_TOKEN);
    expect(chamadas[2]!.init.redirect).toBe("manual");
  });

  it("/qr-code com imagem ou com challenge: o /qr-code/image não é chamado", async () => {
    const comImagem = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: { value: PNG } }, { status: 500 });
    expect(await pedirQr("zapi", "qr", comImagem.fetch)).toMatchObject({ qr: PNG });
    expect(comImagem.chamadas).toHaveLength(2);

    const comDesafio = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: { challenge: { rpId: "whatsapp.com" } } }, { status: 500 });
    expect(await pedirQr("zapi", "qr", comDesafio.fetch)).toMatchObject({ qr: null, passkey: true });
    expect(comDesafio.chamadas).toHaveLength(2);
    expect(comDesafio.chamadas.some((c) => c.url.endsWith("/qr-code/image"))).toBe(false);
  });

  it("/qr-code/image mapeia igual: base64 cru, challenge, sem QR e não-2xx", async () => {
    const cru = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: {} }, { status: 200, corpo: { value: CRU } });
    expect(await pedirQr("zapi", "qr", cru.fetch)).toEqual({ ok: true, conectado: false, qr: `data:image/png;base64,${CRU}`, passkey: false });
    expect(cru.chamadas).toHaveLength(3);

    const desafio = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: {} }, { status: 200, corpo: { challenge: { rpId: "whatsapp.com" } } });
    expect(await pedirQr("zapi", "qr", desafio.fetch)).toEqual({ ok: true, conectado: false, qr: null, passkey: true });

    const nada = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: {} }, { status: 200, corpo: "ok" });
    expect(await pedirQr("zapi", "qr", nada.fetch)).toEqual({ ok: true, conectado: false, qr: null, passkey: false });
    expect(nada.chamadas).toHaveLength(3);

    const naoAchou = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: {} }, { status: 404, corpo: {} });
    const r = await pedirQr("zapi", "qr", naoAchou.fetch);
    expect(r).toMatchObject({ ok: false, erro: "nao_encontrado", campo: "instanceId" });
    semSegredo(r);
  });

  it("rede no /qr-code/image: servidor_inacessivel, sem segredo", async () => {
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: {} }, "rede");
    const r = await pedirQr("zapi", "qr", fetch);
    expect(r).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
    expect(chamadas).toHaveLength(3);
    semSegredo(r);
  });

  it("401 no QR: credencial_invalida apontando o campo, sem segredo", async () => {
    const { fetch } = fetchFalso(ZAPI_DESCONECTADA, { status: 401, corpo: { error: `token ${TOKEN_ZAPI} inválido` } });
    const r = await pedirQr("zapi", "qr", fetch);
    expect(r).toMatchObject({ ok: false, erro: "credencial_invalida", campo: "instanceToken" });
    semSegredo(r);
  });

  it("401 já na situação: não pede o QR", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 401, corpo: { error: "Client-Token not allowed" } });
    const r = await pedirQr("zapi", "qr", fetch);
    expect(r).toMatchObject({ ok: false, erro: "credencial_invalida", campo: "clientToken" });
    expect(chamadas).toHaveLength(1);
    semSegredo(r);
  });

  it("404 no QR: nao_encontrado no instanceId", async () => {
    const { fetch } = fetchFalso(ZAPI_DESCONECTADA, { status: 404, corpo: {} });
    const r = await pedirQr("zapi", "qr", fetch);
    expect(r).toMatchObject({ ok: false, erro: "nao_encontrado", campo: "instanceId" });
    semSegredo(r);
  });

  it("tempo esgotado no QR: tempo_esgotado com a frase da Z-API", async () => {
    const { fetch } = fetchFalso(ZAPI_DESCONECTADA, "pendurado");
    const r = await pedirQr("zapi", "qr", fetch, 30);
    expect(r).toEqual({
      ok: false,
      erro: "tempo_esgotado",
      mensagem: "A Z-API demorou mais de 10 segundos para responder. Tente de novo em instantes.",
    });
    semSegredo(r);
  });

  it("rede no QR: servidor_inacessivel, sem segredo", async () => {
    const { fetch } = fetchFalso(ZAPI_DESCONECTADA, "rede");
    const r = await pedirQr("zapi", "qr", fetch);
    expect(r).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
    expect(r).not.toHaveProperty("campo");
    semSegredo(r);
  });
});

/* ---------- Evolution ---------- */

describe("pedirQrLogica: Evolution", () => {
  it("conectado: o connectionState e o fetchInstances (o número, seção 8), sem pedir o QR; devolve o rótulo", async () => {
    const { fetch, chamadas } = fetchFalso(EVO_CONECTADA);
    const r = await pedirQr("evolution", "qr", fetch);
    expect(r).toMatchObject({ ok: true, conectado: true });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.url).toContain("/instance/connectionState/vendas");
    expect(chamadas[1]!.url).toContain("/instance/fetchInstances?instanceName=vendas");
  });

  it("situacao com o número desconectado: 1 chamada só", async () => {
    const { fetch, chamadas } = fetchFalso(EVO_DESCONECTADA, { status: 200, corpo: { base64: PNG } });
    expect(await pedirQr("evolution", "situacao", fetch)).toEqual({ ok: true, conectado: false, qr: null, passkey: false });
    expect(chamadas).toHaveLength(1);
  });

  it("qr com o número desconectado: 2 chamadas, a 2ª no /instance/connect com a apikey", async () => {
    const corpo = { pairingCode: "ABCD1234", code: "2@xyz", base64: PNG, count: 1 };
    const { fetch, chamadas } = fetchFalso(EVO_DESCONECTADA, { status: 200, corpo });
    const r = await pedirQr("evolution", "qr", fetch);
    expect(r).toEqual({ ok: true, conectado: false, qr: PNG, passkey: false });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.url).toBe("https://evolution.suaempresa.com.br/instance/connect/vendas");
    expect(cabecalhos(chamadas[1]!.init)["apikey"]).toBe(CHAVE_EVOLUTION);
  });

  it("o nome da instância vai codificado na URL", async () => {
    const { fetch, chamadas } = fetchFalso(EVO_DESCONECTADA, { status: 200, corpo: { base64: PNG } });
    await pedirQrLogica({ gateway: "evolution", campos: { ...CAMPOS.evolution, instanceName: "loja 1/a" }, pedir: "qr" }, { fetch });
    expect(chamadas[1]!.url).toBe("https://evolution.suaempresa.com.br/instance/connect/loja%201%2Fa");
  });

  it("base64 cru vira png", async () => {
    const { fetch } = fetchFalso(EVO_DESCONECTADA, { status: 200, corpo: { base64: CRU } });
    expect(await pedirQr("evolution", "qr", fetch)).toMatchObject({ ok: true, qr: `data:image/png;base64,${CRU}` });
  });

  it("sem imagem ou já aberta no connect: qr null", async () => {
    for (const corpo of [{ count: 0 }, { instance: { instanceName: "vendas", state: "open" } }, { base64: "não é base64" }]) {
      const { fetch } = fetchFalso(EVO_DESCONECTADA, { status: 200, corpo });
      expect(await pedirQr("evolution", "qr", fetch)).toEqual({ ok: true, conectado: false, qr: null, passkey: false });
    }
  });

  it("error:true: servidor_inacessivel no serverUrl, com a frase fixa", async () => {
    const { fetch } = fetchFalso(EVO_DESCONECTADA, { status: 200, corpo: { error: true, message: `falhou ${CHAVE_EVOLUTION}` } });
    const r = await pedirQr("evolution", "qr", fetch);
    expect(r).toEqual({
      ok: false,
      erro: "servidor_inacessivel",
      campo: "serverUrl",
      mensagem: "O servidor Evolution não conseguiu gerar o QR code. Confira se a instância está funcionando e tente de novo.",
    });
    semSegredo(r);
  });

  it("401 no QR: credencial_invalida no apiKey", async () => {
    const { fetch } = fetchFalso(EVO_DESCONECTADA, { status: 401, corpo: { message: CHAVE_EVOLUTION } });
    const r = await pedirQr("evolution", "qr", fetch);
    expect(r).toMatchObject({ ok: false, erro: "credencial_invalida", campo: "apiKey" });
    semSegredo(r);
  });

  it("404 no QR: nao_encontrado no instanceName", async () => {
    const { fetch } = fetchFalso(EVO_DESCONECTADA, { status: 404, corpo: {} });
    expect(await pedirQr("evolution", "qr", fetch)).toMatchObject({ ok: false, erro: "nao_encontrado", campo: "instanceName" });
  });

  it("tempo esgotado no QR: a frase do servidor Evolution", async () => {
    const { fetch } = fetchFalso(EVO_DESCONECTADA, "pendurado");
    const r = await pedirQr("evolution", "qr", fetch, 30);
    expect(r).toMatchObject({
      ok: false,
      erro: "tempo_esgotado",
      mensagem: "O seu servidor Evolution demorou mais de 10 segundos para responder. Tente de novo em instantes.",
    });
    semSegredo(r);
  });

  it("rede no QR: servidor_inacessivel apontando o serverUrl", async () => {
    const { fetch } = fetchFalso(EVO_DESCONECTADA, "rede");
    const r = await pedirQr("evolution", "qr", fetch);
    expect(r).toMatchObject({ ok: false, erro: "servidor_inacessivel", campo: "serverUrl" });
    semSegredo(r);
  });
});

describe("pedirQrLogica: segredo nunca aparece na falha", () => {
  const falhas: Resposta[] = [
    "rede",
    { status: 400, corpo: { error: SEGREDOS.join(" ") } },
    { status: 401, corpo: SEGREDOS.join(" ") },
    { status: 403, corpo: { message: SEGREDOS.join(" ") } },
    { status: 404, corpo: { message: SEGREDOS.join(" ") } },
    { status: 429, corpo: {} },
    { status: 500, corpo: { message: SEGREDOS.join(" ") } },
    { status: 200, corpo: { error: true, message: SEGREDOS.join(" ") } },
  ];
  for (const gateway of ["zapi", "evolution"] as const) {
    it(`${gateway}: nenhum instanceToken, clientToken ou apiKey no JSON do resultado`, async () => {
      for (const f of falhas) {
        const { fetch } = fetchFalso(DESCONECTADA[gateway], f);
        semSegredo(await pedirQr(gateway, "qr", fetch));
        // a falha já na situação também
        semSegredo(await pedirQr(gateway, "qr", fetchFalso(f).fetch));
      }
      semSegredo(await pedirQr(gateway, "qr", fetchFalso(DESCONECTADA[gateway], "pendurado").fetch, 30));
    });
  }
});

/* ---------- qr.server ---------- */

const MEMBRO = "9d1c7a20-0000-4000-8000-000000000001";

function contexto(o: { admin?: boolean } = {}) {
  const { admin = true } = o;
  const rpc = vi.fn(async () => ({ data: admin, error: null }));
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => ({ data: { id: MEMBRO }, error: null }),
  };
  const firebase = { rpc, from: vi.fn(() => consulta) } as unknown as ClienteUsuario;
  const ctx: ContextoUsuario = { firebase, userId: "user-1" };
  return { ctx, rpc };
}

const ZAPI_GUARDADA: ConexaoServidor = {
  id: "c0ffee00-0000-4000-8000-0000000000aa",
  gateway: "zapi",
  id_externo: "3C2A0B1C2D3E4F",
  parametros: { instanceId: "3C2A0B1C2D3E4F" },
  segredos: { instanceToken: TOKEN_ZAPI, clientToken: CLIENT_TOKEN, tokenUrl: "token-url-gerado-ZXCV" },
  oficial: false,
};
const EVO_GUARDADA: ConexaoServidor = {
  id: "c0ffee00-0000-4000-8000-0000000000bb",
  gateway: "evolution",
  id_externo: "vendas",
  parametros: { serverUrl: "https://evolution.suaempresa.com.br" },
  segredos: { apiKey: CHAVE_EVOLUTION, tokenUrl: "token-url-gerado-ZXCV" },
  oficial: false,
};
const META_GUARDADA: ConexaoServidor = {
  id: "c0ffee00-0000-4000-8000-0000000000cc",
  gateway: "meta",
  id_externo: "106540352242922",
  parametros: { phoneId: "106540352242922" },
  segredos: { token: "EAAG-token-meta", appSecret: "app-secret-meta", verifyToken: "verify" },
  oficial: true,
};

function nadaGravou() {
  for (const f of [...Object.values(dubles.gravar), ...Object.values(dubles.banco)]) expect(f).not.toHaveBeenCalled();
}

describe("pedirQrConexaoLogica (campos da tela)", () => {
  it("sem admin: sem_acesso, sem chamar o gateway", async () => {
    const { ctx } = contexto({ admin: false });
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA);
    const entrada: EntradaQr = { gateway: "zapi", campos: CAMPOS.zapi, pedir: "qr" };
    expect(await pedirQrConexaoLogica(ctx, entrada, { fetch })).toEqual({ ok: false, erro: "sem_acesso" });
    expect(chamadas).toHaveLength(0);
  });

  it("admin: pede o QR e não grava nada", async () => {
    const { ctx, rpc } = contexto();
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: { value: PNG } });
    const r = await pedirQrConexaoLogica(ctx, { gateway: "zapi", campos: CAMPOS.zapi, pedir: "qr" }, { fetch });
    expect(r).toEqual({ ok: true, conectado: false, qr: PNG, passkey: false });
    expect(chamadas).toHaveLength(2);
    expect(rpc).toHaveBeenCalledWith("eh_admin");
    nadaGravou();
  });
});

describe("pedirQrGuardadaLogica (dados guardados)", () => {
  it("sem admin: sem_acesso, sem ler a conexão", async () => {
    const { ctx } = contexto({ admin: false });
    expect(await pedirQrGuardadaLogica(ctx, { pedir: "qr" })).toEqual({ ok: false, erro: "sem_acesso" });
    expect(dubles.conexaoAtiva).not.toHaveBeenCalled();
  });

  it("sem conexão: sem_conexao", async () => {
    const { ctx } = contexto();
    expect(await pedirQrGuardadaLogica(ctx, { pedir: "qr" })).toEqual({ ok: false, erro: "sem_conexao" });
  });

  it("Meta: nao_e_qr, sem chamar o gateway", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    expect(await pedirQrGuardadaLogica(ctx, { pedir: "qr" }, { fetch })).toEqual({ ok: false, erro: "nao_e_qr" });
    expect(chamadas).toHaveLength(0);
  });

  it("erro ao ler: cifra_indisponivel, cifra_invalida ou erro_ao_ler", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockRejectedValueOnce(new Error("cifra_indisponivel"));
    expect(await pedirQrGuardadaLogica(ctx, { pedir: "qr" })).toEqual({ ok: false, erro: "cifra_indisponivel" });
    dubles.conexaoAtiva.mockRejectedValueOnce(new Error("cifra_invalida"));
    expect(await pedirQrGuardadaLogica(ctx, { pedir: "qr" })).toEqual({ ok: false, erro: "cifra_invalida" });
    dubles.conexaoAtiva.mockRejectedValueOnce(new Error(`outra coisa ${TOKEN_ZAPI}`));
    const r = await pedirQrGuardadaLogica(ctx, { pedir: "qr" });
    expect(r).toEqual({ ok: false, erro: "erro_ao_ler" });
    semSegredo(r);
  });

  it("Z-API guardada: usa os campos guardados, pede o QR e não grava nada", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA, { status: 200, corpo: { value: PNG } });
    const r = await pedirQrGuardadaLogica(ctx, { pedir: "qr" }, { fetch });
    expect(r).toEqual({ ok: true, conectado: false, qr: PNG, passkey: false });
    expect(chamadas[1]!.url).toBe(`https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/qr-code`);
    expect(cabecalhos(chamadas[1]!.init)["Client-Token"]).toBe(CLIENT_TOKEN);
    nadaGravou();
  });

  it("Evolution guardada, situacao: 1 chamada só; conectada devolve o rótulo", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(EVO_GUARDADA);
    const um = fetchFalso(EVO_DESCONECTADA);
    expect(await pedirQrGuardadaLogica(ctx, { pedir: "situacao" }, { fetch: um.fetch })).toEqual({
      ok: true,
      conectado: false,
      qr: null,
      passkey: false,
    });
    expect(um.chamadas).toHaveLength(1);
    const dois = fetchFalso(EVO_CONECTADA);
    expect(await pedirQrGuardadaLogica(ctx, { pedir: "qr" }, { fetch: dois.fetch })).toMatchObject({ ok: true, conectado: true });
    // conectada: o connectionState e o fetchInstances (o número, seção 8)
    expect(dois.chamadas).toHaveLength(2);
    nadaGravou();
  });

  it("falha com os dados guardados: nenhum segredo no resultado", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { fetch } = fetchFalso(ZAPI_DESCONECTADA, { status: 401, corpo: { error: SEGREDOS.join(" ") } });
    const r = await pedirQrGuardadaLogica(ctx, { pedir: "qr" }, { fetch });
    expect(r).toMatchObject({ ok: false, erro: "credencial_invalida" });
    semSegredo(r);
    nadaGravou();
  });
});

/* ---------- camada de dados ---------- */

describe("camada de dados: onboarding", () => {
  it("o modo de teste rejeita pedirQr não passado e usa o passado", async () => {
    await expect(criarDadosOnboardingMemoria().pedirQr({ gateway: "zapi", campos: {}, pedir: "qr" })).rejects.toThrow(/pedirQr/);
    const pedirQr = vi.fn(async () => ({ ok: true as const, conectado: false as const, qr: PNG, passkey: false }));
    const dados = criarDadosOnboardingMemoria({ pedirQr });
    expect(await dados.pedirQr({ gateway: "zapi", campos: CAMPOS.zapi, pedir: "qr" })).toEqual({
      ok: true,
      conectado: false,
      qr: PNG,
      passkey: false,
    });
  });

  it("modo banco: repassa a entrada ao servidor, não relê nada (nem no ok, nem no sem_acesso) e a rejeição chega como rejeição", async () => {
    const f = criarClienteFalso({ consulta: () => ({ data: null, error: null }) });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const espia = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
    const pedirQr = vi.fn();
    const servidor: ServidorOnboarding = {
      salvarConexao: vi.fn(),
      salvarChaveIA: vi.fn(),
      pedirQr,
      listarVozes: vi.fn(),
      escolherVoz: vi.fn(),
      desconectarCelular: vi.fn(),
      usarChaveElevenLabs: vi.fn(),
    };
    const { result } = renderHook(() => useDadosOnboardingBanco(f.cliente, servidor), { wrapper });
    const entrada: EntradaQr = { gateway: "zapi", campos: CAMPOS.zapi, pedir: "qr" };

    pedirQr.mockResolvedValueOnce({ ok: true, conectado: false, qr: PNG, passkey: false });
    expect(await result.current.pedirQr(entrada)).toEqual({ ok: true, conectado: false, qr: PNG, passkey: false });
    expect(pedirQr).toHaveBeenCalledWith(entrada);

    pedirQr.mockResolvedValueOnce({ ok: false, erro: "sem_acesso" });
    expect(await result.current.pedirQr({ ...entrada, pedir: "situacao" })).toEqual({ ok: false, erro: "sem_acesso" });
    expect(pedirQr).toHaveBeenLastCalledWith({ ...entrada, pedir: "situacao" });
    expect(espia).not.toHaveBeenCalled();

    pedirQr.mockRejectedValueOnce(new Error("rede"));
    await expect(result.current.pedirQr(entrada)).rejects.toThrow("rede");
    expect(espia).not.toHaveBeenCalled();
    queryClient.clear();
  });
});

function servidorFalso(sobre: Partial<Record<keyof ServidorConfiguracao, unknown>> = {}) {
  const s = {
    pedirQrConexao: vi.fn(async () => ({ ok: true, conectado: false, qr: PNG, passkey: false })),
    pedirQrConexaoGuardada: vi.fn(async () => ({ ok: true, conectado: true, rotulo: "Instância X" })),
    ...sobre,
  };
  return s as unknown as ServidorConfiguracao & Record<"pedirQrConexao" | "pedirQrConexaoGuardada", ReturnType<typeof vi.fn>>;
}

describe("camada de dados: Configuração no banco", () => {
  it("pedirQr e pedirQrGuardada devolvem o EstadoQr e não releem nada", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso();
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.pedirQr("zapi", CAMPOS.zapi, "qr")).toEqual({ ok: true, conectado: false, qr: PNG, passkey: false });
    expect(servidor.pedirQrConexao).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS.zapi, pedir: "qr" });
    expect(await acoes.pedirQrGuardada("situacao")).toEqual({ ok: true, conectado: true, qr: null, passkey: false });
    expect(servidor.pedirQrConexaoGuardada).toHaveBeenCalledWith({ pedir: "situacao" });
    servidor.pedirQrConexao.mockResolvedValueOnce({ ok: true, conectado: false, qr: null, passkey: true });
    expect(await acoes.pedirQr("evolution", CAMPOS.evolution, "qr")).toEqual({ ok: true, conectado: false, qr: null, passkey: true });
    expect(espia).not.toHaveBeenCalled();
  });

  it("recusa preserva erro, mensagem e campo; rejeição vira falha", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso({
      pedirQrConexao: vi.fn(async () => ({ ok: false, erro: "credencial_invalida", campo: "clientToken", mensagem: "recusou" })),
      pedirQrConexaoGuardada: vi.fn(async () => {
        throw new Error(`rede ${TOKEN_ZAPI}`);
      }),
    });
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.pedirQr("zapi", CAMPOS.zapi, "qr")).toEqual({
      ok: false,
      erro: "credencial_invalida",
      campo: "clientToken",
      mensagem: "recusou",
    });
    const r = await acoes.pedirQrGuardada("qr");
    expect(r).toEqual({ ok: false, erro: "falha" });
    semSegredo(r);
    expect(espia).not.toHaveBeenCalled();
  });

  it("sem_acesso relê o Eu", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso({ pedirQrConexaoGuardada: vi.fn(async () => ({ ok: false, erro: "sem_acesso" })) });
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.pedirQrGuardada("qr")).toEqual({ ok: false, erro: "sem_acesso" });
    expect(espia).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
    expect(espia).toHaveBeenCalledTimes(1);
  });
});

describe("camada de dados: Configuração no exemplo", () => {
  it("as duas devolvem conectado na hora (a demo não inventa QR)", async () => {
    const exemplo = criarEstadoInicial(new Date("2026-11-02T15:00:00-03:00"));
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ProvedorPapel, {
        inicial: "admin",
        children: createElement(ProvedorDados, { exemplo, progredirEnvios: false, children }),
      });
    const { result } = renderHook(() => useDadosConfiguracao(), { wrapper });
    await waitFor(() => expect(result.current.modo).toBe("exemplo"));
    const esperado = { ok: true, conectado: true, qr: null, passkey: false };
    expect(await result.current.acoes.pedirQr("zapi", CAMPOS.zapi, "qr")).toEqual(esperado);
    expect(await result.current.acoes.pedirQrGuardada("situacao")).toEqual(esperado);
  });
});
