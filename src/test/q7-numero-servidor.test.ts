import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClienteUsuario, ContextoUsuario } from "@/features/mensageria/configuracao.server";
import type { AdaptadorGateway, ConexaoServidor } from "@/features/mensageria/nucleo/tipos";
import type { Fetch } from "@/features/servidor/http";

// Q7: o número do WhatsApp no servidor (spec-qr-whatsapp, seção 8): o número lido do /device da
// Z-API e do fetchInstances da Evolution, o salvar que confere o número informado, o conserto que
// desconecta o celular de outro número, o "Desconectar e ler de novo" e a camada de dados. O fetch é
// falso e o banco também: nada vai à rede nem grava no banco de verdade.

const dubles = vi.hoisted(() => ({
  conexaoAtiva: vi.fn(),
  gravarConexao: vi.fn(),
  carregarConexaoPorExterno: vi.fn(),
  adaptadorDe: vi.fn(),
  real: null as null | ((g: string) => AdaptadorGateway | null),
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
vi.mock("@/features/mensageria/nucleo/conexoes.server", () => ({
  conexaoAtiva: dubles.conexaoAtiva,
  gravarConexao: dubles.gravarConexao,
  carregarConexaoPorExterno: dubles.carregarConexaoPorExterno,
  gravarChaveIA: vi.fn(),
  carregarConexao: vi.fn(),
  lerChaveIA: vi.fn(),
}));
vi.mock("@/features/mensageria/configuracao/banco.server", () => dubles.banco);
vi.mock("@/features/mensageria/gateways", async (original) => {
  const real = await original<typeof import("@/features/mensageria/gateways")>();
  dubles.real = real.adaptadorDe;
  return { ...real, adaptadorDe: dubles.adaptadorDe };
});

import { salvarConexaoLogica } from "@/features/mensageria/configuracao.server";
import { conferirConexaoLogica } from "@/features/mensageria/configuracao/acoes.server";
import { desconectarCelularConexaoLogica } from "@/features/mensageria/qr.server";
import { lerEntradaDesconectarCelular } from "@/features/mensageria/qr.functions";
import { textoErroConexao, textoFalhaAcao } from "@/features/plataforma/configuracao/textos";
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
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import { criarEstadoInicial } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";
import {
  ESPERA_DONO_EVOLUTION_MS,
  lerNumeroEvolution,
  lerNumeroZapi,
  requisicaoNumeroEvolution,
  requisicaoNumeroZapi,
  validarConexaoLogica,
} from "@/features/servidor/conexao";
import {
  desconectarCelularLogica,
  mapearDesconectar,
  requisicaoDesconectarEvolution,
  requisicaoDesconectarZapi,
} from "@/features/servidor/qr-conexao";

// Credenciais falsas, longas e únicas, para provar que nunca aparecem em nada que sai.
const TOKEN_ZAPI = "TOKENinstanciaNUM0A1B2C3D4E5F6ZAPI";
const CLIENT_TOKEN = "CLIENTtokenNUMf9e8d7c6b5a4CLNT";
const CHAVE_EVOLUTION = "EVOapikeyNUM5566778899aabbccEVO";
const SEGREDOS = [TOKEN_ZAPI, CLIENT_TOKEN, CHAVE_EVOLUTION];

const SERVIDOR = "https://evolution.suaempresa.com.br";
const ZAPI = { instanceId: "3C2A0B1C2D3E4F", instanceToken: TOKEN_ZAPI, clientToken: CLIENT_TOKEN };
const EVOLUTION = { serverUrl: `${SERVIDOR}/`, instanceName: "vendas", apiKey: CHAVE_EVOLUTION };

type Chamada = { url: string; init: RequestInit };
type Resposta = { status: number; corpo?: unknown } | "rede" | "pendurado";

/** Cada chamada recebe a próxima resposta (a última se repete); "rede" lança e "pendurado" só termina no prazo. */
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
        init?.signal?.addEventListener("abort", () => falhar(new Error(`abortado ${url}`)));
      });
    }
    const texto =
      r.corpo === undefined ? "" : typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo);
    return { status: r.status, text: async () => texto } as unknown as Response;
  };
  return { fetch, chamadas };
}

function semSegredo(resultado: unknown) {
  const json = JSON.stringify(resultado);
  for (const s of SEGREDOS) expect(json).not.toContain(s);
}

function cabecalhos(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

const ZAPI_CONECTADA = {
  status: 200,
  corpo: { connected: true, error: null, smartphoneConnected: true },
};
const ZAPI_DESCONECTADA = {
  status: 200,
  corpo: { connected: false, error: "You are not connected." },
};
const device = (phone: unknown) => ({ status: 200, corpo: { phone, name: "Loja", imgUrl: null } });
const EVO_ABERTA = { status: 200, corpo: { instance: { instanceName: "vendas", state: "open" } } };
const instancias = (...itens: unknown[]) => ({ status: 200, corpo: itens });
const v2 = (name: string, ownerJid: string | null) => ({
  id: "x",
  name,
  ownerJid,
  profileName: "Loja",
  connectionStatus: "open",
});

const MEMBRO = "9d1c7a20-0000-4000-8000-000000000001";
const CONEXAO = "c0ffee00-0000-4000-8000-0000000000aa";
const ORIGEM = "https://janete.exemplo.com.br";

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

beforeEach(() => {

  dubles.conexaoAtiva.mockReset().mockResolvedValue(null);
  dubles.gravarConexao.mockReset().mockResolvedValue({ id: CONEXAO });
  dubles.carregarConexaoPorExterno.mockReset().mockResolvedValue(null);
  for (const f of Object.values(dubles.banco)) f.mockReset().mockResolvedValue(undefined);
  // o webhook é configurado por um dublê: nada vai à rede pelo fetch global
  const configurarWebhook = vi.fn(async () => {});
  dubles.adaptadorDe.mockReset().mockImplementation((g: string) => {
    const real = dubles.real?.(g) ?? null;
    return real ? { ...real, configurarWebhook } : null;
  });
});

/* ---------- o número lido do gateway ---------- */

describe("Z-API: o /device dá o número", () => {
  it("a requisição: GET …/device com o Client-Token", () => {
    const req = requisicaoNumeroZapi(ZAPI);
    expect(req.url).toBe(
      `https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/device`,
    );
    expect(req.init.method).toBe("GET");
    expect(cabecalhos(req.init)["Client-Token"]).toBe(CLIENT_TOKEN);
  });

  it("lerNumeroZapi: os dígitos do phone (texto ou número); o resto é null", () => {
    expect(lerNumeroZapi(device("5511987654321"))).toBe("5511987654321");
    expect(lerNumeroZapi(device("+55 (11) 98765-4321"))).toBe("5511987654321");
    expect(lerNumeroZapi(device(5511987654321))).toBe("5511987654321");
    for (const r of [
      device(null),
      device(""),
      device("123"),
      { status: 200, corpo: {} },
      { status: 401, corpo: { phone: "5511987654321" } },
      { status: 200, corpo: "ok" },
    ]) {
      expect(lerNumeroZapi(r)).toBeNull();
    }
  });

  it("conectada: 2 chamadas, o rótulo vira o número formatado e o número vem nos dígitos", async () => {
    const { fetch, chamadas } = fetchFalso(ZAPI_CONECTADA, device("5511987654321"));
    const r = await validarConexaoLogica({ gateway: "zapi", campos: ZAPI }, { fetch });
    expect(r).toEqual({ ok: true, rotulo: "+55 11 98765-4321", numero: "5511987654321" });
    expect(chamadas.map((c) => c.url)).toEqual([
      `https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/status`,
      `https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/device`,
    ]);
    expect(cabecalhos(chamadas[1]!.init)["Client-Token"]).toBe(CLIENT_TOKEN);
    expect(chamadas[1]!.init.redirect).toBe("manual");
  });

  it("a falha do /device (401, 500, rede, tempo, corpo estranho) mantém o rótulo de hoje, sem número", async () => {
    for (const falha of [
      { status: 401, corpo: { error: "unauthorized" } },
      { status: 500, corpo: {} },
      "rede" as const,
      { status: 200, corpo: { phone: null } },
      { status: 200, corpo: "<html>" },
    ]) {
      const { fetch } = fetchFalso(ZAPI_CONECTADA, falha);
      const r = await validarConexaoLogica({ gateway: "zapi", campos: ZAPI }, { fetch });
      expect(r).toEqual({ ok: true, rotulo: "Instância 3C2A0B1C2D3E4F" });
    }
    const { fetch } = fetchFalso(ZAPI_CONECTADA, "pendurado");
    expect(
      await validarConexaoLogica({ gateway: "zapi", campos: ZAPI }, { fetch, prazoMs: 30 }),
    ).toEqual({
      ok: true,
      rotulo: "Instância 3C2A0B1C2D3E4F",
    });
  });

  it("desconectada: não pede o /device", async () => {
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA, device("5511987654321"));
    const r = await validarConexaoLogica({ gateway: "zapi", campos: ZAPI }, { fetch });
    expect(r).toMatchObject({ ok: false, erro: "instancia_desconectada" });
    expect(chamadas).toHaveLength(1);
  });
});

describe("Evolution: o fetchInstances dá o número", () => {
  const base = { base: SERVIDOR, host: "evolution.suaempresa.com.br" };

  it("a requisição: GET {base}/instance/fetchInstances?instanceName=X com a apikey", () => {
    const req = requisicaoNumeroEvolution(base, {
      serverUrl: SERVIDOR,
      instanceName: "loja 1",
      apiKey: CHAVE_EVOLUTION,
    });
    expect(req.url).toBe(`${SERVIDOR}/instance/fetchInstances?instanceName=loja+1`);
    expect(req.init.method).toBe("GET");
    expect(cabecalhos(req.init)["apikey"]).toBe(CHAVE_EVOLUTION);
  });

  it("lerNumeroEvolution: v2 (name e ownerJid), v1 (instance.owner), com o :aparelho", () => {
    expect(
      lerNumeroEvolution(
        instancias(
          v2("outra", "5521999998888@s.whatsapp.net"),
          v2("vendas", "5511987654321@s.whatsapp.net"),
        ),
        "vendas",
      ),
    ).toBe("5511987654321");
    expect(
      lerNumeroEvolution(
        instancias({
          instance: {
            instanceName: "vendas",
            owner: "5511987654321:7@s.whatsapp.net",
            status: "open",
          },
        }),
        "vendas",
      ),
    ).toBe("5511987654321");
    // um objeto só, sem lista
    expect(
      lerNumeroEvolution(
        { status: 200, corpo: v2("vendas", "551187654321@s.whatsapp.net") },
        "vendas",
      ),
    ).toBe("551187654321");
  });

  it("lerNumeroEvolution: 401, lista vazia, outro nome, @lid e dono nulo dão null", () => {
    for (const r of [
      { status: 401, corpo: { message: "Unauthorized" } },
      instancias(),
      instancias(v2("outra", "5511987654321@s.whatsapp.net")),
      instancias(v2("vendas", "123456789012345@lid")),
      instancias(v2("vendas", null)),
      { status: 200, corpo: "texto" },
    ]) {
      expect(lerNumeroEvolution(r, "vendas")).toBeNull();
    }
  });

  it("aberta: 2 chamadas e o rótulo vira o número (v2)", async () => {
    const { fetch, chamadas } = fetchFalso(
      EVO_ABERTA,
      instancias(v2("vendas", "5511987654321@s.whatsapp.net")),
    );
    const r = await validarConexaoLogica({ gateway: "evolution", campos: EVOLUTION }, { fetch });
    expect(r).toEqual({ ok: true, rotulo: "+55 11 98765-4321", numero: "5511987654321" });
    expect(chamadas[1]!.url).toBe(`${SERVIDOR}/instance/fetchInstances?instanceName=vendas`);
    expect(cabecalhos(chamadas[1]!.init)["apikey"]).toBe(CHAVE_EVOLUTION);
  });

  it("aberta: v1 também dá o número", async () => {
    const { fetch } = fetchFalso(
      EVO_ABERTA,
      instancias({ instance: { instanceName: "vendas", owner: "551187654321@s.whatsapp.net" } }),
    );
    expect(
      await validarConexaoLogica({ gateway: "evolution", campos: EVOLUTION }, { fetch }),
    ).toEqual({
      ok: true,
      rotulo: "+55 11 8765-4321",
      numero: "551187654321",
    });
  });

  it("lerNumeroEvolution: o item que ainda não está 'open' não dá o dono (pode ser o antigo)", () => {
    const antigo = (connectionStatus: string) => ({
      ...v2("vendas", "5521999998888@s.whatsapp.net"),
      connectionStatus,
    });
    expect(lerNumeroEvolution(instancias(antigo("connecting")), "vendas")).toBeNull();
    expect(lerNumeroEvolution(instancias(antigo("close")), "vendas")).toBeNull();
    expect(
      lerNumeroEvolution(
        instancias({ instance: { instanceName: "vendas", owner: "5521999998888@s.whatsapp.net", status: "close" } }),
        "vendas",
      ),
    ).toBeNull();
  });

  it("v2 ainda sem o 'open' no banco: espera 1 s e lê de novo, uma vez, no mesmo prazo", async () => {
    vi.useFakeTimers();
    try {
      const { fetch, chamadas } = fetchFalso(
        EVO_ABERTA,
        instancias({ ...v2("vendas", "5521999998888@s.whatsapp.net"), connectionStatus: "connecting" }),
        instancias(v2("vendas", "5511987654321@s.whatsapp.net")),
      );
      const pendente = validarConexaoLogica({ gateway: "evolution", campos: EVOLUTION }, { fetch });
      await vi.advanceTimersByTimeAsync(ESPERA_DONO_EVOLUTION_MS);
      expect(await pendente).toEqual({ ok: true, rotulo: "+55 11 98765-4321", numero: "5511987654321" });
      expect(chamadas).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("v2 que continua sem o 'open' depois da 2ª leitura: número desconhecido, rótulo de hoje", async () => {
    vi.useFakeTimers();
    try {
      const naoAberta = instancias({ ...v2("vendas", "5521999998888@s.whatsapp.net"), connectionStatus: "close" });
      const { fetch, chamadas } = fetchFalso(EVO_ABERTA, naoAberta, naoAberta);
      const pendente = validarConexaoLogica({ gateway: "evolution", campos: EVOLUTION }, { fetch });
      await vi.advanceTimersByTimeAsync(ESPERA_DONO_EVOLUTION_MS);
      expect(await pendente).toEqual({ ok: true, rotulo: "Instância “vendas” em evolution.suaempresa.com.br" });
      expect(chamadas).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("401 (Evolution sem banco), lista vazia ou rede: fica o rótulo de hoje, sem número", async () => {
    for (const falha of [
      { status: 401, corpo: { message: "Unauthorized" } },
      instancias(),
      "rede" as const,
    ]) {
      const { fetch } = fetchFalso(EVO_ABERTA, falha);
      const r = await validarConexaoLogica({ gateway: "evolution", campos: EVOLUTION }, { fetch });
      expect(r).toEqual({ ok: true, rotulo: "Instância “vendas” em evolution.suaempresa.com.br" });
    }
  });
});

/* ---------- salvar ---------- */

describe("salvarConexao: o número informado", () => {
  const MSG_INVALIDO =
    "Digite o número do WhatsApp com DDD, por exemplo 11 98765-4321. De outro país, comece com + e o código.";

  it("vazio ou inválido: numero_invalido no campo numero, sem falar com o gateway e sem gravar", async () => {
    const { ctx } = contexto();
    for (const gateway of ["zapi", "evolution"] as const) {
      for (const numero of [undefined, "", "123", "abc", "11 18765-4321"]) {
        const { fetch, chamadas } = fetchFalso(ZAPI_CONECTADA);
        const base = gateway === "zapi" ? ZAPI : EVOLUTION;
        const campos: Record<string, string> =
          numero === undefined ? { ...base } : { ...base, numero };
        const r = await salvarConexaoLogica(ctx, { gateway, campos }, { origem: ORIGEM, fetch });
        expect(r).toEqual({
          ok: false,
          erro: "numero_invalido",
          campo: "numero",
          mensagem: MSG_INVALIDO,
        });
        expect(chamadas).toHaveLength(0);
      }
    }
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });

  it("sem admin, o sem_acesso vem antes do número", async () => {
    const { ctx } = contexto({ admin: false });
    const r = await salvarConexaoLogica(ctx, { gateway: "zapi", campos: ZAPI }, { origem: ORIGEM });
    expect(r).toEqual({ ok: false, erro: "sem_acesso" });
  });

  it("Z-API conectada com outro número: numero_diferente com os dois formatados, sem gravar nada", async () => {
    const { ctx } = contexto();
    const { fetch } = fetchFalso(ZAPI_CONECTADA, device("5521999998888"));
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: { ...ZAPI, numero: "11 98765-4321" } },
      { origem: ORIGEM, fetch },
    );
    expect(r).toEqual({
      ok: false,
      erro: "numero_diferente",
      numero_conectado: "+55 21 99999-8888",
      numero_informado: "+55 11 98765-4321",
      mensagem: "Este celular é do +55 21 99999-8888, não do +55 11 98765-4321 que você informou.",
    });
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
    semSegredo(r);
  });

  it("Evolution aberta com outro número: numero_diferente, sem gravar", async () => {
    const { ctx } = contexto();
    const { fetch } = fetchFalso(
      EVO_ABERTA,
      instancias(v2("vendas", "5521999998888@s.whatsapp.net")),
    );
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "evolution", campos: { ...EVOLUTION, numero: "11 98765-4321" } },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({
      ok: false,
      erro: "numero_diferente",
      numero_conectado: "+55 21 99999-8888",
    });
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });

  it("Z-API: o mesmo número com o 9 a mais grava o nome digitado e o número que o WhatsApp informou", async () => {
    const { ctx } = contexto();
    // o WhatsApp informa sem o 9; a pessoa digitou com o 9
    const { fetch } = fetchFalso(ZAPI_CONECTADA, device("551187654321"));
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: { ...ZAPI, numero: "(11) 98765-4321" } },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({
      ok: true,
      conexao_id: CONEXAO,
      nome: "+55 11 98765-4321",
      gateway: "zapi",
    });
    const gravada = dubles.gravarConexao.mock.calls[0]![0] as {
      nome: string;
      parametros: Record<string, unknown>;
      id_externo: string;
    };
    expect(gravada.nome).toBe("+55 11 98765-4321");
    expect(gravada.parametros).toEqual({ instanceId: "3C2A0B1C2D3E4F", numero: "551187654321" });
    expect(gravada.id_externo).toBe("3C2A0B1C2D3E4F");
    semSegredo(r);
  });

  it("sem o número do WhatsApp (o /device falhou): grava o informado, sem conferir", async () => {
    const { ctx } = contexto();
    const { fetch } = fetchFalso(ZAPI_CONECTADA, { status: 500, corpo: {} });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: { ...ZAPI, numero: "+55 11 98765-4321" } },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({ ok: true, nome: "+55 11 98765-4321" });
    const gravada = dubles.gravarConexao.mock.calls[0]![0] as {
      parametros: Record<string, unknown>;
    };
    expect(gravada.parametros["numero"]).toBe("5511987654321");
  });

  it("Evolution: o mesmo número grava nome e parametros.numero (com o serverUrl de antes)", async () => {
    const { ctx } = contexto();
    // validação, o número e a conferência do token próprio não acontece sem a variável da cifra
    const { fetch } = fetchFalso(
      EVO_ABERTA,
      instancias(v2("vendas", "5511987654321@s.whatsapp.net")),
    );
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "evolution", campos: { ...EVOLUTION, numero: "11987654321" } },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({ ok: true, nome: "+55 11 98765-4321", gateway: "evolution" });
    const gravada = dubles.gravarConexao.mock.calls[0]![0] as {
      parametros: Record<string, unknown>;
    };
    expect(gravada.parametros).toEqual({ serverUrl: SERVIDOR, numero: "5511987654321" });
  });

  it("instância desconectada: segue para o QR (o erro de sempre), sem conferir número", async () => {
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(ZAPI_DESCONECTADA);
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: { ...ZAPI, numero: "11 98765-4321" } },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({ ok: false, erro: "instancia_desconectada" });
    expect(chamadas).toHaveLength(1);
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });

  it("a Meta não pede número e o nome continua o rótulo do gateway", async () => {
    const { ctx } = contexto();
    const { fetch } = fetchFalso({
      status: 200,
      corpo: { display_phone_number: "55 11 99999-0000", verified_name: "Loja" },
    });
    const r = await salvarConexaoLogica(
      ctx,
      {
        gateway: "meta",
        campos: {
          phoneId: "106540352242922",
          token: "EAAG-token-meta-xyz",
          appSecret: "segredo-app-meta",
        },
      },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({ ok: true, nome: "+55 11 99999-0000 · Loja" });
    const gravada = dubles.gravarConexao.mock.calls[0]![0] as {
      parametros: Record<string, unknown>;
    };
    expect(gravada.parametros["numero"]).toBeUndefined();
  });
});

/* ---------- conserto (conferir) ---------- */

const ZAPI_GUARDADA: ConexaoServidor = {
  id: CONEXAO,
  gateway: "zapi",
  id_externo: "3C2A0B1C2D3E4F",
  parametros: { instanceId: "3C2A0B1C2D3E4F", numero: "5511987654321" },
  segredos: {
    instanceToken: TOKEN_ZAPI,
    clientToken: CLIENT_TOKEN,
    tokenUrl: "token-url-gerado-ZXCV",
  },
  oficial: false,
};
const EVO_GUARDADA: ConexaoServidor = {
  id: CONEXAO,
  gateway: "evolution",
  id_externo: "vendas",
  parametros: { serverUrl: SERVIDOR, numero: "5511987654321" },
  segredos: { apiKey: CHAVE_EVOLUTION, tokenUrl: "token-url-gerado-ZXCV" },
  oficial: false,
};

const MSG_DIFERENTE =
  "Um celular de outro número leu o QR code, e a Janete desconectou ele. Leia o QR code com o celular do número desta conexão.";

describe("conferirConexao: o número no conserto", () => {
  it("Z-API lida por outro número: desconecta o celular, grava numero_diferente e recusa", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { fetch, chamadas } = fetchFalso(ZAPI_CONECTADA, device("5521999998888"), {
      status: 200,
      corpo: { value: true },
    });
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toEqual({
      ok: false,
      erro: "numero_diferente",
      numero_conectado: "+55 21 99999-8888",
      numero_salvo: "+55 11 98765-4321",
      desconectado: true,
      status: "desconectada",
      mensagem: MSG_DIFERENTE,
    });
    expect(chamadas[2]!.url).toBe(
      `https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/disconnect`,
    );
    expect(chamadas[2]!.init.method).toBe("GET");
    expect(cabecalhos(chamadas[2]!.init)["Client-Token"]).toBe(CLIENT_TOKEN);
    expect(dubles.banco.gravarStatusConexao).toHaveBeenCalledTimes(1);
    expect(dubles.banco.gravarStatusConexao).toHaveBeenCalledWith(
      CONEXAO,
      "desconectada",
      "numero_diferente",
    );
    expect(dubles.banco.regravarConexao).not.toHaveBeenCalled();
    semSegredo(r);
  });

  it("Evolution lida por outro número: DELETE /instance/logout/{nome} com a apikey", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(EVO_GUARDADA);
    const { fetch, chamadas } = fetchFalso(
      EVO_ABERTA,
      instancias(v2("vendas", "5521999998888@s.whatsapp.net")),
      { status: 200, corpo: { status: "SUCCESS", error: false } },
    );
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toMatchObject({
      ok: false,
      erro: "numero_diferente",
      desconectado: true,
      status: "desconectada",
    });
    expect(chamadas[2]!.url).toBe(`${SERVIDOR}/instance/logout/vendas`);
    expect(chamadas[2]!.init.method).toBe("DELETE");
    expect(cabecalhos(chamadas[2]!.init)["apikey"]).toBe(CHAVE_EVOLUTION);
    expect(dubles.banco.gravarStatusConexao).toHaveBeenCalledWith(
      CONEXAO,
      "desconectada",
      "numero_diferente",
    );
  });

  it("o logout falha: grava do mesmo jeito e avisa que não desconectou", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { fetch } = fetchFalso(ZAPI_CONECTADA, device("5521999998888"), {
      status: 500,
      corpo: { error: SEGREDOS.join(" ") },
    });
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toMatchObject({
      ok: false,
      erro: "numero_diferente",
      desconectado: false,
      status: "desconectada",
    });
    expect(dubles.banco.gravarStatusConexao).toHaveBeenCalledWith(
      CONEXAO,
      "desconectada",
      "numero_diferente",
    );
    semSegredo(r);
  });

  it("gravar o status falha: erro_ao_gravar", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    dubles.banco.gravarStatusConexao.mockRejectedValue(new Error("banco"));
    const { fetch } = fetchFalso(ZAPI_CONECTADA, device("5521999998888"), {
      status: 200,
      corpo: { value: true },
    });
    expect(await conferirConexaoLogica(ctx, { fetch })).toEqual({
      ok: false,
      erro: "erro_ao_gravar",
    });
  });

  it("o mesmo número (com ou sem o 9): conectada, sem desconectar nem regravar", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { fetch, chamadas } = fetchFalso(ZAPI_CONECTADA, device("551187654321"));
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toMatchObject({ ok: true, conexao_id: CONEXAO, status: "conectada" });
    expect(chamadas).toHaveLength(2);
    expect(dubles.banco.gravarStatusConexao).toHaveBeenCalledWith(CONEXAO, "conectada", null);
    expect(dubles.banco.regravarConexao).not.toHaveBeenCalled();
  });

  it("sem número salvo (conexão de antes): regrava o nome e parametros.numero, com os segredos como estão", async () => {
    const { ctx } = contexto();
    const antiga: ConexaoServidor = {
      ...ZAPI_GUARDADA,
      parametros: { instanceId: "3C2A0B1C2D3E4F" },
    };
    dubles.conexaoAtiva.mockResolvedValue(antiga);
    const { fetch, chamadas } = fetchFalso(ZAPI_CONECTADA, device("5511987654321"));
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toMatchObject({ ok: true, status: "conectada" });
    expect(dubles.banco.regravarConexao).toHaveBeenCalledWith(CONEXAO, {
      nome: "+55 11 98765-4321",
      parametros: { instanceId: "3C2A0B1C2D3E4F", numero: "5511987654321" },
      segredos: antiga.segredos,
    });
    expect(chamadas).toHaveLength(2);
    semSegredo(r);
  });

  it("sem número salvo e a regravação falha: erro_ao_gravar", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue({ ...EVO_GUARDADA, parametros: { serverUrl: SERVIDOR } });
    dubles.banco.regravarConexao.mockRejectedValue(new Error("banco"));
    const { fetch } = fetchFalso(
      EVO_ABERTA,
      instancias(v2("vendas", "5511987654321@s.whatsapp.net")),
    );
    expect(await conferirConexaoLogica(ctx, { fetch })).toEqual({
      ok: false,
      erro: "erro_ao_gravar",
    });
  });

  it("o WhatsApp não informou o número: a conferência de sempre", async () => {
    const { ctx } = contexto();
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { fetch } = fetchFalso(ZAPI_CONECTADA, { status: 404, corpo: {} });
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toMatchObject({ ok: true, status: "conectada" });
    expect(dubles.banco.regravarConexao).not.toHaveBeenCalled();
  });
});

/* ---------- desconectar o celular ---------- */

describe("desconectar o celular", () => {
  const base = { base: SERVIDOR, host: "evolution.suaempresa.com.br" };

  it("as 2 requisições", () => {
    const z = requisicaoDesconectarZapi(ZAPI);
    expect(z.url).toBe(
      `https://api.z-api.io/instances/3C2A0B1C2D3E4F/token/${TOKEN_ZAPI}/disconnect`,
    );
    expect(z.init.method).toBe("GET");
    expect(cabecalhos(z.init)["Client-Token"]).toBe(CLIENT_TOKEN);
    const e = requisicaoDesconectarEvolution(base, {
      serverUrl: SERVIDOR,
      instanceName: "loja 1/a",
      apiKey: CHAVE_EVOLUTION,
    });
    expect(e.url).toBe(`${SERVIDOR}/instance/logout/loja%201%2Fa`);
    expect(e.init.method).toBe("DELETE");
    expect(cabecalhos(e.init)["apikey"]).toBe(CHAVE_EVOLUTION);
  });

  it("mapearDesconectar: 2xx ok; o 400 'not connected' da Evolution também", () => {
    expect(mapearDesconectar({ status: 200, corpo: { value: true } }, "zapi")).toEqual({
      ok: true,
    });
    expect(mapearDesconectar({ status: 200, corpo: { status: "SUCCESS" } }, "evolution")).toEqual({
      ok: true,
    });
    const fechada = {
      status: 400,
      corpo: {
        status: 400,
        error: "Bad Request",
        response: { message: ['The "vendas" instance is not connected'] },
      },
    };
    expect(mapearDesconectar(fechada, "evolution")).toEqual({ ok: true });
    // na Z-API, o 400 não é sucesso
    expect(mapearDesconectar(fechada, "zapi")).toMatchObject({
      ok: false,
      erro: "servidor_inacessivel",
    });
  });

  it("mapearDesconectar: 401/403 credencial, 404 instância, 429 e o resto fora do ar", () => {
    expect(mapearDesconectar({ status: 401, corpo: {} }, "zapi")).toMatchObject({
      ok: false,
      erro: "credencial_invalida",
      campo: "instanceToken",
    });
    expect(
      mapearDesconectar({ status: 403, corpo: { error: "Client-Token not allowed" } }, "zapi"),
    ).toMatchObject({
      erro: "credencial_invalida",
      campo: "clientToken",
    });
    expect(mapearDesconectar({ status: 401, corpo: {} }, "evolution")).toMatchObject({
      erro: "credencial_invalida",
      campo: "apiKey",
    });
    expect(mapearDesconectar({ status: 404, corpo: {} }, "zapi")).toMatchObject({
      erro: "nao_encontrado",
      campo: "instanceId",
    });
    expect(mapearDesconectar({ status: 404, corpo: {} }, "evolution")).toMatchObject({
      erro: "nao_encontrado",
      campo: "instanceName",
    });
    expect(mapearDesconectar({ status: 429, corpo: {} }, "zapi")).toMatchObject({
      erro: "servidor_inacessivel",
      mensagem: expect.stringMatching(/tentativas demais/),
    });
    expect(mapearDesconectar({ status: 500, corpo: {} }, "zapi")).toEqual({
      ok: false,
      erro: "servidor_inacessivel",
      mensagem: "A Z-API não conseguiu desconectar o celular agora. Tente de novo em instantes.",
    });
    expect(
      mapearDesconectar({ status: 400, corpo: { message: "outra coisa" } }, "evolution"),
    ).toEqual({
      ok: false,
      erro: "servidor_inacessivel",
      campo: "serverUrl",
      mensagem:
        "O servidor Evolution não conseguiu desconectar o celular agora. Tente de novo em instantes.",
    });
  });

  it("desconectarCelularLogica: o nome vazio vira 'janete'; rede, tempo e campos faltando", async () => {
    const um = fetchFalso({ status: 400, corpo: { response: { message: ["is not connected"] } } });
    expect(
      await desconectarCelularLogica(
        { gateway: "evolution", campos: { ...EVOLUTION, instanceName: "" } },
        { fetch: um.fetch },
      ),
    ).toEqual({ ok: true });
    expect(um.chamadas[0]!.url).toBe(`${SERVIDOR}/instance/logout/janete`);

    const rede = await desconectarCelularLogica(
      { gateway: "evolution", campos: EVOLUTION },
      { fetch: fetchFalso("rede").fetch },
    );
    expect(rede).toMatchObject({ ok: false, erro: "servidor_inacessivel", campo: "serverUrl" });
    semSegredo(rede);

    const tempo = await desconectarCelularLogica(
      { gateway: "zapi", campos: ZAPI },
      { fetch: fetchFalso("pendurado").fetch, prazoMs: 30 },
    );
    expect(tempo).toMatchObject({ ok: false, erro: "tempo_esgotado" });
    semSegredo(tempo);

    const semToken = fetchFalso({ status: 200 });
    expect(
      await desconectarCelularLogica(
        { gateway: "zapi", campos: { ...ZAPI, clientToken: "" } },
        { fetch: semToken.fetch },
      ),
    ).toMatchObject({
      ok: false,
      campo: "clientToken",
    });
    expect(
      await desconectarCelularLogica(
        { gateway: "evolution", campos: { ...EVOLUTION, serverUrl: "http://10.0.0.1" } },
        { fetch: semToken.fetch },
      ),
    ).toMatchObject({
      ok: false,
      campo: "serverUrl",
    });
    expect(semToken.chamadas).toHaveLength(0);
  });

  it("segredo nunca aparece na falha", async () => {
    for (const gateway of ["zapi", "evolution"] as const) {
      const campos = gateway === "zapi" ? ZAPI : EVOLUTION;
      for (const f of [
        { status: 401, corpo: SEGREDOS.join(" ") },
        { status: 500, corpo: { message: SEGREDOS.join(" ") } },
        "rede" as const,
      ]) {
        semSegredo(
          await desconectarCelularLogica({ gateway, campos }, { fetch: fetchFalso(f).fetch }),
        );
      }
    }
  });

  it("desconectarCelularConexaoLogica: só admin, e nada grava", async () => {
    const semAdmin = fetchFalso({ status: 200, corpo: { value: true } });
    const { ctx: ctxSem } = contexto({ admin: false });
    expect(
      await desconectarCelularConexaoLogica(
        ctxSem,
        { gateway: "zapi", campos: ZAPI },
        { fetch: semAdmin.fetch },
      ),
    ).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(semAdmin.chamadas).toHaveLength(0);

    const { ctx, rpc } = contexto();
    const ok = fetchFalso({ status: 200, corpo: { value: true } });
    expect(
      await desconectarCelularConexaoLogica(
        ctx,
        { gateway: "zapi", campos: ZAPI },
        { fetch: ok.fetch },
      ),
    ).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("eh_admin");
    expect(ok.chamadas).toHaveLength(1);
    for (const f of [dubles.gravarConexao, ...Object.values(dubles.banco)])
      expect(f).not.toHaveBeenCalled();
  });

  it("lerEntradaDesconectarCelular: só zapi e evolution, com os campos; erro sem valor da entrada", () => {
    expect(lerEntradaDesconectarCelular({ gateway: "zapi", campos: ZAPI })).toEqual({
      gateway: "zapi",
      campos: ZAPI,
    });
    expect(lerEntradaDesconectarCelular({ gateway: "evolution" })).toEqual({
      gateway: "evolution",
      campos: {},
    });
    for (const ruim of [
      null,
      [],
      "zapi",
      { gateway: "meta", campos: {} },
      { gateway: "zernio", campos: {} },
      { gateway: "zapi", campos: { instanceToken: 5 } },
      { gateway: "zapi", campos: {}, pedir: "qr" },
    ]) {
      expect(() => lerEntradaDesconectarCelular(ruim)).toThrow(/Pedido inválido/);
    }
    try {
      lerEntradaDesconectarCelular({
        gateway: "zapi",
        campos: { instanceToken: TOKEN_ZAPI.repeat(100) },
      });
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(TOKEN_ZAPI);
    }
  });
});

/* ---------- textos e camada de dados ---------- */

const MSG_DIFERENTE_NEUTRA =
  "Um celular de outro número leu o QR code. Leia o QR code com o celular do número desta conexão.";

describe("textos: numero_diferente", () => {
  it("a queda gravada e a recusa sem frase do servidor mostram a frase neutra", () => {
    // neutra: o mesmo código fica gravado quando o desconectar falha
    expect(textoErroConexao("numero_diferente", "zapi", "desconectada")).toBe(MSG_DIFERENTE_NEUTRA);
    expect(textoFalhaAcao("numero_diferente")).toBe(MSG_DIFERENTE_NEUTRA);
    expect(textoErroConexao("numero_diferente", "zapi", "desconectada")).not.toMatch(/desconect/);
  });

  it("a frase do servidor vale por cima na recusa (desconectou ou não)", () => {
    expect(textoFalhaAcao("numero_diferente", MSG_DIFERENTE)).toBe(MSG_DIFERENTE);
  });
});

function servidorFalso(sobre: Partial<Record<keyof ServidorConfiguracao, unknown>> = {}) {
  const s = {
    salvarConexao: vi.fn(async () => ({ ok: true })),
    conferirConexao: vi.fn(async () => ({ ok: true, nome: "+55 11 98765-4321" })),
    desconectarCelular: vi.fn(async () => ({ ok: true })),
    ...sobre,
  };
  return s as unknown as ServidorConfiguracao &
    Record<"salvarConexao" | "conferirConexao" | "desconectarCelular", ReturnType<typeof vi.fn>>;
}

describe("camada de dados: Configuração", () => {
  it("o recusaDe leva os campos do numero_diferente (salvar e conferir)", async () => {
    const servidor = servidorFalso({
      salvarConexao: vi.fn(async () => ({
        ok: false,
        erro: "numero_diferente",
        numero_conectado: "+55 21 99999-8888",
        numero_informado: "+55 11 98765-4321",
        mensagem:
          "Este celular é do +55 21 99999-8888, não do +55 11 98765-4321 que você informou.",
      })),
      conferirConexao: vi.fn(async () => ({
        ok: false,
        erro: "numero_diferente",
        numero_conectado: "+55 21 99999-8888",
        numero_salvo: "+55 11 98765-4321",
        desconectado: true,
        status: "desconectada",
        mensagem: MSG_DIFERENTE,
      })),
    });
    const acoes = criarAcoesConfiguracaoBanco(servidor, new QueryClient());
    expect(await acoes.salvarConexao("zapi", { ...ZAPI, numero: "11 98765-4321" })).toEqual({
      ok: false,
      erro: "numero_diferente",
      numeroConectado: "+55 21 99999-8888",
      numeroInformado: "+55 11 98765-4321",
      mensagem: "Este celular é do +55 21 99999-8888, não do +55 11 98765-4321 que você informou.",
    });
    expect(await acoes.conferirConexao()).toEqual({
      ok: false,
      erro: "numero_diferente",
      numeroConectado: "+55 21 99999-8888",
      numeroSalvo: "+55 11 98765-4321",
      desconectado: true,
      status: "desconectada",
      mensagem: MSG_DIFERENTE,
    });
  });

  it("desconectarCelular: repassa a entrada, não relê nada; recusa, rejeição e sem_acesso", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso();
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.desconectarCelular("zapi", ZAPI)).toEqual({ ok: true });
    expect(servidor.desconectarCelular).toHaveBeenCalledWith({ gateway: "zapi", campos: ZAPI });
    expect(espia).not.toHaveBeenCalled();

    servidor.desconectarCelular.mockResolvedValueOnce({
      ok: false,
      erro: "credencial_invalida",
      campo: "apiKey",
      mensagem: "recusou",
    });
    expect(await acoes.desconectarCelular("evolution", EVOLUTION)).toEqual({
      ok: false,
      erro: "credencial_invalida",
      campo: "apiKey",
      mensagem: "recusou",
    });

    servidor.desconectarCelular.mockRejectedValueOnce(new Error(`rede ${TOKEN_ZAPI}`));
    const r = await acoes.desconectarCelular("zapi", ZAPI);
    expect(r).toEqual({ ok: false, erro: "falha" });
    semSegredo(r);
    expect(espia).not.toHaveBeenCalled();

    servidor.desconectarCelular.mockResolvedValueOnce({ ok: false, erro: "sem_acesso" });
    expect(await acoes.desconectarCelular("zapi", ZAPI)).toEqual({ ok: false, erro: "sem_acesso" });
    expect(espia).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
    expect(espia).toHaveBeenCalledTimes(1);
  });

  it("no exemplo, desconectarCelular dá ok", async () => {
    const exemplo = criarEstadoInicial(new Date("2026-11-02T15:00:00-03:00"));
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ProvedorPapel, {
        inicial: "admin",
        children: createElement(ProvedorDados, { exemplo, progredirEnvios: false, children }),
      });
    const { result } = renderHook(() => useDadosConfiguracao(), { wrapper });
    await waitFor(() => expect(result.current.modo).toBe("exemplo"));
    expect(await result.current.acoes.desconectarCelular("zapi", ZAPI)).toEqual({ ok: true });
  });
});

describe("camada de dados: onboarding", () => {
  it("o modo de teste rejeita desconectarCelular não passado e usa o passado", async () => {
    await expect(
      criarDadosOnboardingMemoria().desconectarCelular({ gateway: "zapi", campos: {} }),
    ).rejects.toThrow(/desconectarCelular/);
    const desconectarCelular = vi.fn(async () => ({ ok: true as const }));
    const dados = criarDadosOnboardingMemoria({ desconectarCelular });
    expect(await dados.desconectarCelular({ gateway: "zapi", campos: ZAPI })).toEqual({ ok: true });
  });

  it("modo banco: repassa ao servidor, não relê nada, e a rejeição chega como rejeição", async () => {
    const f = criarClienteFalso({ consulta: () => ({ data: null, error: null }) });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const espia = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const desconectarCelular = vi.fn();
    const servidor: ServidorOnboarding = {
      salvarConexao: vi.fn(),
      salvarChaveIA: vi.fn(),
      pedirQr: vi.fn(),
      listarVozes: vi.fn(),
      escolherVoz: vi.fn(),
      desconectarCelular,
      usarChaveElevenLabs: vi.fn(),
    };
    const { result } = renderHook(() => useDadosOnboardingBanco(f.cliente, servidor), { wrapper });
    const entrada = { gateway: "evolution" as const, campos: EVOLUTION };

    desconectarCelular.mockResolvedValueOnce({ ok: true });
    expect(await result.current.desconectarCelular(entrada)).toEqual({ ok: true });
    expect(desconectarCelular).toHaveBeenCalledWith(entrada);
    expect(espia).not.toHaveBeenCalled();

    desconectarCelular.mockRejectedValueOnce(new Error("rede"));
    await expect(result.current.desconectarCelular(entrada)).rejects.toThrow("rede");
    queryClient.clear();
  });
});
