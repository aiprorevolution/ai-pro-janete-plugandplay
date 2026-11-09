import { beforeEach, describe, expect, it, vi } from "vitest";

import { validarConexaoLogica } from "@/features/servidor/conexao";
import type { Fetch } from "@/features/servidor/http";

import type { AdaptadorGateway, ConexaoServidor } from "./nucleo/tipos";

vi.mock("./nucleo/segredo-instalacao.server", () => ({ segredoDaInstalacao: async () => "segredo-ficticio-estavel-para-testes-000000" }));

const dubles = vi.hoisted(() => ({
  gravarConexao: vi.fn(),
  gravarChaveIA: vi.fn(),
  carregarConexao: vi.fn(),
  carregarConexaoPorExterno: vi.fn(),
  adaptadorDe: vi.fn(),
  lerResumoChaveIA: vi.fn(),
  /** o registro real, guardado antes de ser trocado pelo dublê */
  real: null as null | ((g: string) => AdaptadorGateway | null),
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
vi.mock("./nucleo/conexoes.server", () => ({
  gravarConexao: dubles.gravarConexao,
  gravarChaveIA: dubles.gravarChaveIA,
  carregarConexao: dubles.carregarConexao,
  carregarConexaoPorExterno: dubles.carregarConexaoPorExterno,
}));
vi.mock("./configuracao/banco.server", () => ({ lerResumoChaveIA: dubles.lerResumoChaveIA }));
vi.mock("./gateways", async (original) => {
  const real = await original<typeof import("./gateways")>();
  dubles.real = real.adaptadorDe;
  return { ...real, adaptadorDe: dubles.adaptadorDe };
});

import {
  salvarChaveIALogica,
  salvarConexaoLogica,
  TEXTOS_TROCA_INCOMPLETA,
  verSegredoGeradoLogica,
  type ClienteUsuario,
  type ContextoUsuario,
} from "./configuracao.server";

function adaptadorReal(gateway: string): AdaptadorGateway | null {
  if (!dubles.real) throw new Error("registro real não carregado");
  return dubles.real(gateway);
}

const MEMBRO = "9d1c7a20-0000-4000-8000-000000000001";
const CONEXAO = "c0ffee00-0000-4000-8000-0000000000aa";
const ORIGEM = "https://janete.exemplo.com.br";

// Credenciais falsas, longas e únicas, para provar que nunca voltam na resposta.
const ZAPI = {
  // o número do WhatsApp, obrigatório na Z-API (spec-qr-whatsapp, seção 8)
  numero: "11 98765-4321",
  instanceId: "3D9A1B2C3D4E5F",
  instanceToken: "token-instancia-zapi-QWERTY123456",
  clientToken: "client-token-zapi-ASDFGH654321",
};
const META = {
  phoneId: "106540352242922",
  token: "EAAG-token-meta-ZXCVBN987654",
  appSecret: "app-secret-meta-POIUYT112233",
};

function contexto(o: { admin?: boolean; membro?: string | null; erroRpc?: boolean } = {}) {
  const { admin = true, membro = MEMBRO, erroRpc = false } = o;
  const rpc = vi.fn(async () =>
    erroRpc ? { data: null, error: { message: "falhou" } } : { data: admin, error: null },
  );
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => ({ data: membro ? { id: membro } : null, error: null }),
  };
  const firebase = { rpc, from: vi.fn(() => consulta) } as unknown as ClienteUsuario;
  const ctx: ContextoUsuario = { firebase, userId: "user-1" };
  return { ctx, rpc };
}

type Resposta = { status: number; corpo?: unknown };

function fetchFalso(...respostas: Resposta[]) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetch: Fetch = async (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (!r) throw new Error("sem resposta configurada");
    const texto = r.corpo === undefined ? "" : JSON.stringify(r.corpo);
    return { status: r.status, text: async () => texto } as unknown as Response;
  };
  return { fetch, chamadas };
}

/** Adaptador falso que monta a conexão com os campos e os gerados, como os reais farão. */
function adaptadorFalso(gateway: "zapi" | "meta", configurar?: () => Promise<void>) {
  const configurarWebhook = vi.fn(configurar ?? (async () => {}));
  const adaptador = {
    ...adaptadorReal(gateway),
    gateway,
    montarConexao: (campos: Record<string, string>, gerados: Record<string, string>) =>
      gateway === "zapi"
        ? {
            id_externo: campos["instanceId"] ?? "",
            parametros: {},
            segredos: {
              instanceToken: campos["instanceToken"] ?? "",
              clientToken: campos["clientToken"] ?? "",
              tokenUrl: gerados["tokenUrl"] ?? "",
            },
          }
        : {
            id_externo: campos["phoneId"] ?? "",
            parametros: {},
            segredos: {
              token: campos["token"] ?? "",
              appSecret: campos["appSecret"] ?? "",
              verifyToken: gerados["verifyToken"] ?? "",
            },
          },
    ...(gateway === "zapi" ? { configurarWebhook } : {}),
  } as unknown as AdaptadorGateway;
  return { adaptador, configurarWebhook };
}

function semCredenciais(resposta: unknown, ...segredos: string[]) {
  const texto = JSON.stringify(resposta);
  for (const s of segredos) expect(texto).not.toContain(s);
}

beforeEach(() => {
  dubles.gravarConexao.mockReset().mockResolvedValue({ id: CONEXAO });
  dubles.gravarChaveIA.mockReset().mockResolvedValue({ ultimos4: "WXYZ" });
  dubles.carregarConexao.mockReset();
  dubles.carregarConexaoPorExterno.mockReset().mockResolvedValue(null);
  dubles.adaptadorDe.mockReset().mockImplementation(adaptadorReal);
  dubles.lerResumoChaveIA.mockReset().mockResolvedValue(null);
});

describe("salvarConexao: Zernio", () => {
  const CHAVE_ZERNIO = "sk_zernio_teste_LKJHGF0987";
  const contas = {
    accounts: [{ _id: "acc_7", platform: "whatsapp", phoneNumber: "+5511999990000" }],
  };
  function zernioComWebhookFalso() {
    const configurarWebhook = vi.fn(async (_c: ConexaoServidor, _url: string) => {});
    const real = adaptadorReal("zernio");
    if (!real) throw new Error("sem adaptador");
    dubles.adaptadorDe.mockReturnValue({ ...real, configurarWebhook });
    return configurarWebhook;
  }

  it("sem accountId usa a primeira conta de WhatsApp (a mesma regra da validação)", async () => {
    zernioComWebhookFalso();
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: contas });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zernio", campos: { apiKey: CHAVE_ZERNIO, accountId: "" } },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({ ok: true, conexao_id: CONEXAO });
    const gravada = dubles.gravarConexao.mock.calls[0]?.[0] as { id_externo: string };
    expect(gravada.id_externo).toBe("acc_7");
    expect(chamadas.some((c) => c.url.endsWith("/accounts?platform=whatsapp"))).toBe(true);
    semCredenciais(r, CHAVE_ZERNIO);
  });

  it("sem accountId e sem conta achada: nao_encontrado no campo accountId", async () => {
    zernioComWebhookFalso();
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: contas }, { status: 500, corpo: {} });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zernio", campos: { apiKey: CHAVE_ZERNIO } },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({ ok: false, erro: "nao_encontrado", campo: "accountId" });
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });

  it("salvar de novo a mesma conta mantém o webhookSecret atual", async () => {
    const configurarWebhook = zernioComWebhookFalso();
    dubles.carregarConexaoPorExterno.mockResolvedValue({
      id: CONEXAO,
      gateway: "zernio",
      id_externo: "acc_7",
      parametros: {},
      segredos: { apiKey: "antiga", webhookSecret: "segredo-atual-da-zernio" },
      oficial: true,
    });
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: contas });
    await salvarConexaoLogica(
      ctx,
      { gateway: "zernio", campos: { apiKey: CHAVE_ZERNIO, accountId: "acc_7" } },
      { origem: ORIGEM, fetch },
    );
    expect(dubles.carregarConexaoPorExterno).toHaveBeenCalledWith("zernio", "acc_7");
    const gravada = dubles.gravarConexao.mock.calls[0]?.[0] as {
      segredos: Record<string, string>;
    };
    expect(gravada.segredos["webhookSecret"]).toBe("segredo-atual-da-zernio");
    expect(gravada.segredos["apiKey"]).toBe(CHAVE_ZERNIO);
    const conexaoUsada = configurarWebhook.mock.calls[0]?.[0];
    expect(conexaoUsada?.segredos["webhookSecret"]).toBe("segredo-atual-da-zernio");
  });
});

describe("salvarConexao", () => {
  it("sem admin dá sem_acesso, sem chamar o gateway nem o banco", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { connected: true } });
    for (const o of [{ admin: false }, { membro: null }, { erroRpc: true }]) {
      const { ctx } = contexto(o);
      const r = await salvarConexaoLogica(
        ctx,
        { gateway: "zapi", campos: ZAPI },
        { origem: ORIGEM, fetch },
      );
      expect(r).toEqual({ ok: false, erro: "sem_acesso" });
    }
    expect(chamadas).toHaveLength(0);
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });

  it("confere o admin com eh_admin", async () => {
    const { ctx, rpc } = contexto({ admin: false });
    await salvarConexaoLogica(ctx, { gateway: "zapi", campos: ZAPI }, { origem: ORIGEM });
    expect(rpc).toHaveBeenCalledWith("eh_admin");
  });

  it("erro da validação passa adiante como veio", async () => {
    const corpo = { error: "your client-token is not configured" };
    const esperado = await validarConexaoLogica(
      { gateway: "zapi", campos: ZAPI },
      { fetch: fetchFalso({ status: 400, corpo }).fetch },
    );
    expect(esperado.ok).toBe(false);

    const { ctx } = contexto();
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: ZAPI },
      { origem: ORIGEM, fetch: fetchFalso({ status: 400, corpo }).fetch },
    );
    expect(r).toEqual(esperado);
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
    semCredenciais(r, ZAPI.instanceToken, ZAPI.clientToken);
  });

  it("adaptador provisório dá gateway_nao_implementado", async () => {
    // os 4 gateways já têm adaptador de verdade: o provisório entra pelo dublê
    const { adaptadorProvisorio } = await import("./gateways/provisorio");
    dubles.adaptadorDe.mockReturnValue(adaptadorProvisorio("meta"));
    const { ctx } = contexto();
    const { fetch } = fetchFalso({
      status: 200,
      corpo: { display_phone_number: "55 11 99999-0000" },
    });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "meta", campos: META },
      { origem: ORIGEM, fetch },
    );
    expect(r).toEqual({ ok: false, erro: "gateway_nao_implementado" });
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });

  it("Z-API: grava com o token gerado, monta a URL com ?t= e configura o webhook", async () => {
    const { adaptador, configurarWebhook } = adaptadorFalso("zapi");
    dubles.adaptadorDe.mockReturnValue(adaptador);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { connected: true } });

    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: ZAPI },
      { origem: ORIGEM, fetch },
    );

    const gravada = dubles.gravarConexao.mock.calls[0]?.[0] as {
      segredos: Record<string, string>;
      membroId: string;
      id_externo: string;
      nome: string;
    };
    const tokenUrl = gravada.segredos["tokenUrl"] ?? "";
    expect(tokenUrl).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gravada).toMatchObject({
      gateway: "zapi",
      id_externo: ZAPI.instanceId,
      membroId: MEMBRO,
    });
    // o nome é o número informado, formatado (seção 8)
    expect(gravada.nome).toBe("+55 11 98765-4321");

    const url = `${ORIGEM}/api/public/whatsapp/zapi/${CONEXAO}?t=${tokenUrl}`;
    expect(r).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      nome: gravada.nome,
      gateway: "zapi",
      url_webhook: url,
      avisos: [],
    });
    expect(configurarWebhook).toHaveBeenCalledTimes(1);
    const [conexao, urlConfigurada] = configurarWebhook.mock.calls[0] as unknown as [
      ConexaoServidor,
      string,
    ];
    expect(urlConfigurada).toBe(url);
    expect(conexao).toMatchObject({ id: CONEXAO, gateway: "zapi", oficial: false });
    semCredenciais(r, ZAPI.instanceToken, ZAPI.clientToken);
  });

  it("segredo do gateway vazio dá conexao_invalida e nada é gravado", async () => {
    const { adaptador } = adaptadorFalso("zapi");
    const montar = adaptador.montarConexao.bind(adaptador);
    adaptador.montarConexao = (campos, gerados) => {
      const m = montar(campos, gerados);
      return { ...m, segredos: { ...m.segredos, clientToken: "   " } };
    };
    dubles.adaptadorDe.mockReturnValue(adaptador);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { connected: true } });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: ZAPI },
      { origem: ORIGEM, fetch },
    );
    expect(r).toEqual({ ok: false, erro: "conexao_invalida" });
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });

  it("montarConexao sem um dos segredos do gateway dá conexao_invalida", async () => {
    const { adaptador } = adaptadorFalso("meta");
    dubles.adaptadorDe.mockReturnValue(adaptador);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({
      status: 200,
      corpo: { display_phone_number: "55 11 99999-0000", verified_name: "Loja" },
    });
    const campos: Record<string, string> = { phoneId: META.phoneId, token: META.token };
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "meta", campos },
      { origem: ORIGEM, fetch },
    );
    expect(r).toEqual({ ok: false, erro: "conexao_invalida" });
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });

  it("origem da prévia ou local leva o aviso url_de_previa", async () => {
    for (const origem of [
      "https://ais-dev-1234abcd.us-east1.run.app",
      "https://ais-dev-janete.us-east1.run.app",
      "https://1234abcd.cloudworkstations.dev",
      "http://localhost:8080",
    ]) {
      const { adaptador } = adaptadorFalso("zapi");
      dubles.adaptadorDe.mockReturnValue(adaptador);
      const { ctx } = contexto();
      const { fetch } = fetchFalso({ status: 200, corpo: { connected: true } });
      const r = await salvarConexaoLogica(
        ctx,
        { gateway: "zapi", campos: ZAPI },
        { origem, fetch },
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.avisos).toEqual(["url_de_previa"]);
        expect(r.url_webhook.startsWith(`${origem}/api/public/whatsapp/zapi/${CONEXAO}?t=`)).toBe(
          true,
        );
      }
    }
  });

  it("origem publicada não leva o aviso", async () => {
    const { ehOrigemDePrevia } = await import("./configuracao.server");
    expect(ehOrigemDePrevia("https://janete.example.test")).toBe(false);
    expect(ehOrigemDePrevia("https://app.janete.com.br")).toBe(false);
    expect(ehOrigemDePrevia("https://meu-preview--x.com.br")).toBe(false);
  });

  it("falha ao configurar o webhook vira aviso, sem perder a conexão", async () => {
    const { adaptador } = adaptadorFalso("zapi", async () => {
      throw new Error(`falhou ${ZAPI.instanceToken}`);
    });
    dubles.adaptadorDe.mockReturnValue(adaptador);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { connected: true } });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: ZAPI },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({ ok: true, conexao_id: CONEXAO, avisos: ["webhook_nao_configurado"] });
    semCredenciais(r, ZAPI.instanceToken, ZAPI.clientToken);
  });

  it("Meta: devolve o verifyToken gerado e a URL sem ?t=", async () => {
    const { adaptador } = adaptadorFalso("meta");
    dubles.adaptadorDe.mockReturnValue(adaptador);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({
      status: 200,
      corpo: { display_phone_number: "55 11 99999-0000", verified_name: "Loja" },
    });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "meta", campos: META },
      { origem: ORIGEM, fetch },
    );

    const gravada = dubles.gravarConexao.mock.calls[0]?.[0] as { segredos: Record<string, string> };
    expect(r).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      nome: "+55 11 99999-0000 · Loja",
      gateway: "meta",
      url_webhook: `${ORIGEM}/api/public/whatsapp/meta/${CONEXAO}`,
      verifyToken: gravada.segredos["verifyToken"],
      avisos: [],
    });
    expect(gravada.segredos["tokenUrl"]).toBeUndefined();
    semCredenciais(r, META.token);
  });

  it.each([
    ["meta", "webhook_no_painel"],
    ["zapi", "webhook_no_painel"],
    ["evolution", "webhook_nao_desligado"],
    ["zernio", "webhook_nao_desligado"],
  ] as const)("o Trocar devolve o aviso do webhook da anterior (%s, %s)", async (g, aviso) => {
    const { adaptador } = adaptadorFalso("meta");
    dubles.adaptadorDe.mockReturnValue(adaptador);
    dubles.gravarConexao.mockResolvedValue({ id: CONEXAO, anterior: { gateway: g, aviso } });
    const { ctx } = contexto();
    const { fetch } = fetchFalso({
      status: 200,
      corpo: { display_phone_number: "55 11 99999-0000", verified_name: "Loja" },
    });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "meta", campos: META },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({
      ok: true,
      conexao_id: CONEXAO,
      conexao_anterior: { gateway: g, aviso },
    });
  });

  it("sem aviso da anterior, o salvar não leva conexao_anterior", async () => {
    const { adaptador } = adaptadorFalso("zapi");
    dubles.adaptadorDe.mockReturnValue(adaptador);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { connected: true } });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: ZAPI },
      { origem: ORIGEM, fetch },
    );
    expect(r).toMatchObject({ ok: true });
    expect(r).not.toHaveProperty("conexao_anterior");
  });

  it("sem a chave de serviço dá cifra_indisponivel", async () => {
    const { adaptador } = adaptadorFalso("zapi");
    dubles.adaptadorDe.mockReturnValue(adaptador);
    dubles.gravarConexao.mockRejectedValue(new Error("cifra_indisponivel"));
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { connected: true } });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: ZAPI },
      { origem: ORIGEM, fetch },
    );
    expect(r).toEqual({ ok: false, erro: "cifra_indisponivel" });
  });

  it.each(["troca_sem_desativar", "troca_sem_ativar", "troca_sem_ativar_no_painel"] as const)(
    "o Trocar que parou no meio (%s) leva o texto próprio, não o genérico",
    async (codigo) => {
      const { adaptador } = adaptadorFalso("zapi");
      dubles.adaptadorDe.mockReturnValue(adaptador);
      dubles.gravarConexao.mockRejectedValue(new Error(codigo));
      const { ctx } = contexto();
      const { fetch } = fetchFalso({ status: 200, corpo: { connected: true } });
      const r = await salvarConexaoLogica(
        ctx,
        { gateway: "zapi", campos: ZAPI },
        { origem: ORIGEM, fetch },
      );
      expect(r).toEqual({
        ok: false,
        erro: "erro_ao_gravar",
        mensagem: TEXTOS_TROCA_INCOMPLETA[codigo],
      });
      expect(r).toMatchObject({ mensagem: expect.stringContaining("Salve de novo") });
    },
  );

  it("outro erro de banco no salvar continua erro_ao_gravar, sem texto", async () => {
    const { adaptador } = adaptadorFalso("zapi");
    dubles.adaptadorDe.mockReturnValue(adaptador);
    dubles.gravarConexao.mockRejectedValue(new Error("banco_desativar_conexao"));
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { connected: true } });
    const r = await salvarConexaoLogica(
      ctx,
      { gateway: "zapi", campos: ZAPI },
      { origem: ORIGEM, fetch },
    );
    expect(r).toEqual({ ok: false, erro: "erro_ao_gravar" });
  });
});

describe("salvarChaveIA", () => {
  const OPENAI = "sk-proj-chave-openai-falsa-LKJH";
  const GROQ = "gsk_chave-groq-falsa-MNBV";

  it("sem admin dá sem_acesso", async () => {
    const { ctx } = contexto({ admin: false });
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    const r = await salvarChaveIALogica(
      ctx,
      { finalidade: "resposta", provedor: "openai", modelo: "gpt-5.5-mini", chave: OPENAI },
      { fetch },
    );
    expect(r).toEqual({ ok: false, erro: "sem_acesso" });
    expect(chamadas).toHaveLength(0);
  });

  it("chave aceita é gravada e só os 4 últimos voltam", async () => {
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { id: "gpt-5.5-mini" } });
    const r = await salvarChaveIALogica(
      ctx,
      { finalidade: "resposta", provedor: "openai", modelo: "gpt-5.5-mini", chave: OPENAI },
      { fetch },
    );
    expect(r).toEqual({ ok: true, ultimos4: "WXYZ", status: "ativa" });
    expect(dubles.gravarChaveIA).toHaveBeenCalledWith({
      finalidade: "resposta",
      provedor: "openai",
      modelo: "gpt-5.5-mini",
      workspace_id: null,
      chave: OPENAI,
      membroId: MEMBRO,
    });
    semCredenciais(r, OPENAI);
  });

  it("erro da validação passa adiante e nada é gravado", async () => {
    const { ctx } = contexto();
    const { fetch } = fetchFalso({
      status: 401,
      corpo: { error: { message: `bad key ${OPENAI}` } },
    });
    const r = await salvarChaveIALogica(
      ctx,
      { finalidade: "resposta", provedor: "openai", modelo: "gpt-5.5-mini", chave: OPENAI },
      { fetch },
    );
    expect(r).toMatchObject({ ok: false, erro: "chave_invalida" });
    expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    semCredenciais(r, OPENAI);
  });

  it("Groq na transcrição: GET /models com Bearer e o modelo na lista", async () => {
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({
      status: 200,
      corpo: { data: [{ id: "whisper-large-v3" }, { id: "whisper-large-v3-turbo" }] },
    });
    const r = await salvarChaveIALogica(
      ctx,
      { finalidade: "transcricao", provedor: "groq", modelo: "whisper-large-v3", chave: GROQ },
      { fetch },
    );
    expect(r).toEqual({ ok: true, ultimos4: "WXYZ", status: "ativa" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("https://api.groq.com/openai/v1/models");
    expect(chamadas[0]?.init.method).toBe("GET");
    expect((chamadas[0]?.init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${GROQ}`,
    );
  });

  it("Groq: chave recusada e modelo fora da lista", async () => {
    const { ctx } = contexto();
    const r401 = await salvarChaveIALogica(
      ctx,
      { finalidade: "transcricao", provedor: "groq", modelo: "whisper-large-v3", chave: GROQ },
      {
        fetch: fetchFalso({ status: 401, corpo: { error: { message: `invalid ${GROQ}` } } }).fetch,
      },
    );
    expect(r401).toMatchObject({ ok: false, erro: "chave_invalida" });
    semCredenciais(r401, GROQ);

    const semModelo = await salvarChaveIALogica(
      ctx,
      { finalidade: "transcricao", provedor: "groq", modelo: "nao-existe", chave: GROQ },
      { fetch: fetchFalso({ status: 200, corpo: { data: [{ id: "whisper-large-v3" }] } }).fetch },
    );
    expect(semModelo).toMatchObject({ ok: false, erro: "modelo_indisponivel" });
    expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
  });

  it("Groq na resposta e Anthropic na transcrição são recusados", async () => {
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    const groq = await salvarChaveIALogica(
      ctx,
      { finalidade: "resposta", provedor: "groq", modelo: "llama", chave: GROQ },
      { fetch },
    );
    const anthropic = await salvarChaveIALogica(
      ctx,
      { finalidade: "transcricao", provedor: "anthropic", modelo: "claude", chave: "sk-ant-x" },
      { fetch },
    );
    expect(groq).toMatchObject({ ok: false, erro: "provedor_nao_permitido" });
    expect(anthropic).toMatchObject({ ok: false, erro: "provedor_nao_permitido" });
    expect(chamadas).toHaveLength(0);
  });

  it("OpenRouter na transcrição só confere a chave", async () => {
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({
      status: 200,
      corpo: { data: { limit_remaining: null } },
    });
    const r = await salvarChaveIALogica(
      ctx,
      {
        finalidade: "transcricao",
        provedor: "openrouter",
        modelo: "openai/whisper-1",
        chave: "sk-or-v1-x-TTTT",
      },
      { fetch },
    );
    expect(r).toEqual({ ok: true, ultimos4: "WXYZ", status: "ativa" });
    expect(chamadas.map((c) => c.url)).toEqual(["https://openrouter.ai/api/v1/key"]);
  });

  it("falha ao gravar vira código genérico", async () => {
    dubles.gravarChaveIA.mockRejectedValue(new Error("banco_gravar_chave"));
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { id: "gpt-5.5-mini" } });
    const r = await salvarChaveIALogica(
      ctx,
      { finalidade: "resposta", provedor: "openai", modelo: "gpt-5.5-mini", chave: OPENAI },
      { fetch },
    );
    expect(r).toMatchObject({ ok: false, erro: "erro_ao_gravar" });
  });

  describe("workspace da Anthropic", () => {
    const ANTHROPIC = "sk-ant-chave-falsa-POIU0987";
    const guardada = (provedor: string, workspace_id: string | null) => ({
      id: "k1",
      provedor,
      modelo: "claude-x",
      workspace_id,
      status: "ativa",
      ultimos4: "0987",
      temChave: true,
    });
    const entrada = {
      finalidade: "resposta" as const,
      provedor: "anthropic" as const,
      modelo: "claude-x",
      chave: ANTHROPIC,
    };
    const gravado = () =>
      (dubles.gravarChaveIA.mock.calls[0]?.[0] as { workspace_id: string | null }).workspace_id;
    const cabecalho = (chamadas: { init: RequestInit }[]) =>
      (chamadas[0]?.init.headers as Record<string, string>)["anthropic-workspace-id"];

    it("campo ausente e mesmo provedor: valida e grava com o workspace guardado", async () => {
      dubles.lerResumoChaveIA.mockResolvedValue(guardada("anthropic", "wrkspc_guardado"));
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { input_tokens: 3 } });
      const r = await salvarChaveIALogica(ctx, entrada, { fetch });
      expect(r).toMatchObject({ ok: true });
      expect(dubles.lerResumoChaveIA).toHaveBeenCalledWith("resposta");
      expect(cabecalho(chamadas)).toBe("wrkspc_guardado");
      expect(gravado()).toBe("wrkspc_guardado");
    });

    it("campo ausente e provedor diferente: sem workspace", async () => {
      dubles.lerResumoChaveIA.mockResolvedValue(guardada("openai", "wrkspc_de_outro"));
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
      await salvarChaveIALogica(ctx, entrada, { fetch });
      expect(cabecalho(chamadas)).toBeUndefined();
      expect(gravado()).toBeNull();
    });

    it("null apaga o guardado; um valor novo vale sobre o guardado (sem ler o banco)", async () => {
      dubles.lerResumoChaveIA.mockResolvedValue(guardada("anthropic", "wrkspc_guardado"));
      const { ctx } = contexto();
      const { fetch } = fetchFalso({ status: 200, corpo: {} });
      await salvarChaveIALogica(ctx, { ...entrada, workspace_id: null }, { fetch });
      expect(gravado()).toBeNull();
      dubles.gravarChaveIA.mockClear();
      await salvarChaveIALogica(ctx, { ...entrada, workspace_id: "wrkspc_novo" }, { fetch });
      expect(gravado()).toBe("wrkspc_novo");
      expect(dubles.lerResumoChaveIA).not.toHaveBeenCalled();
    });

    it("falha ao ler o guardado: não grava sem workspace por engano", async () => {
      dubles.lerResumoChaveIA.mockRejectedValue(new Error("banco_ler_chave"));
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
      const r = await salvarChaveIALogica(ctx, entrada, { fetch });
      expect(r).toMatchObject({ ok: false, erro: "erro_ao_gravar" });
      expect(chamadas).toHaveLength(0);
      expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    });
  });

  describe("voz (ElevenLabs)", () => {
    const VOZ = "sk_teste_1234567890abcd";
    const entrada = {
      finalidade: "voz" as const,
      provedor: "elevenlabs" as const,
      modelo: "",
      chave: VOZ,
    };
    const COM_CREDITO = { subscription: { character_limit: 10000, character_count: 120 } };

    it("chave aceita: GET /v1/user com xi-api-key, grava sem modelo e só os 4 últimos voltam", async () => {
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso({ status: 200, corpo: COM_CREDITO });
      const r = await salvarChaveIALogica(ctx, entrada, { fetch });
      expect(r).toEqual({ ok: true, ultimos4: "WXYZ", status: "ativa" });
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]?.url).toBe("https://api.elevenlabs.io/v1/user");
      expect(chamadas[0]?.init.method).toBe("GET");
      const cabecalhos = chamadas[0]?.init.headers as Record<string, string>;
      expect(cabecalhos["xi-api-key"]).toBe(VOZ);
      expect(cabecalhos["Authorization"]).toBeUndefined();
      expect(dubles.gravarChaveIA).toHaveBeenCalledTimes(1);
      expect(dubles.gravarChaveIA).toHaveBeenCalledWith({
        finalidade: "voz",
        provedor: "elevenlabs",
        modelo: "",
        workspace_id: null,
        chave: VOZ,
        membroId: MEMBRO,
      });
      // a voz não tem workspace: não lê a chave guardada
      expect(dubles.lerResumoChaveIA).not.toHaveBeenCalled();
      semCredenciais(r, VOZ);
    });

    it("a voz grava sempre sem modelo, mesmo se o pedido trouxer um", async () => {
      const { ctx } = contexto();
      const { fetch } = fetchFalso({ status: 200, corpo: COM_CREDITO });
      const r = await salvarChaveIALogica(ctx, { ...entrada, modelo: "eleven_v3" }, { fetch });
      expect(r).toEqual({ ok: true, ultimos4: "WXYZ", status: "ativa" });
      expect(dubles.gravarChaveIA).toHaveBeenCalledWith(expect.objectContaining({ finalidade: "voz", modelo: "" }));
    });

    it("401 dá chave_invalida e nada é gravado", async () => {
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso({
        status: 401,
        corpo: { detail: { status: "invalid_api_key", message: `bad key ${VOZ}` } },
      });
      const r = await salvarChaveIALogica(ctx, entrada, { fetch });
      expect(r).toMatchObject({ ok: false, erro: "chave_invalida" });
      expect(chamadas).toHaveLength(1);
      expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
      semCredenciais(r, VOZ);
    });

    it.each([
      ["resposta", "elevenlabs"],
      ["voz", "openai"],
      ["voz", "groq"],
      ["voz", "anthropic"],
      ["voz", "openrouter"],
    ] as const)(
      "%s com %s dá provedor_nao_permitido, sem chamar o provedor nem gravar",
      async (finalidade, provedor) => {
        const { ctx } = contexto();
        const { fetch, chamadas } = fetchFalso({ status: 200, corpo: COM_CREDITO });
        const r = await salvarChaveIALogica(
          ctx,
          { finalidade, provedor, modelo: "", chave: VOZ },
          { fetch },
        );
        expect(r).toMatchObject({ ok: false, erro: "provedor_nao_permitido" });
        expect(chamadas).toHaveLength(0);
        expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
        expect(dubles.lerResumoChaveIA).not.toHaveBeenCalled();
        semCredenciais(r, VOZ);
      },
    );

    it("sem admin dá sem_acesso, sem chamar a ElevenLabs", async () => {
      const { ctx } = contexto({ admin: false });
      const { fetch, chamadas } = fetchFalso({ status: 200, corpo: COM_CREDITO });
      const r = await salvarChaveIALogica(ctx, entrada, { fetch });
      expect(r).toEqual({ ok: false, erro: "sem_acesso" });
      expect(chamadas).toHaveLength(0);
      expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    });

    // ---------- a ElevenLabs também na escuta (docs/spec-escuta-elevenlabs.md, S1) ----------

    it("na escuta: GET /v1/user e grava o scribe_v2, mesmo vindo outro modelo da tela", async () => {
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso({ status: 200, corpo: COM_CREDITO });
      const r = await salvarChaveIALogica(
        ctx,
        { finalidade: "transcricao", provedor: "elevenlabs", modelo: "whisper-1", chave: VOZ },
        { fetch },
      );
      expect(r).toEqual({ ok: true, ultimos4: "WXYZ", status: "ativa" });
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]?.url).toBe("https://api.elevenlabs.io/v1/user");
      expect((chamadas[0]?.init.headers as Record<string, string>)["xi-api-key"]).toBe(VOZ);
      expect(dubles.gravarChaveIA).toHaveBeenCalledTimes(1);
      expect(dubles.gravarChaveIA).toHaveBeenCalledWith({
        finalidade: "transcricao",
        provedor: "elevenlabs",
        modelo: "scribe_v2",
        workspace_id: null,
        chave: VOZ,
        membroId: MEMBRO,
      });
      expect(dubles.lerResumoChaveIA).not.toHaveBeenCalled();
      semCredenciais(r, VOZ);
    });

    it("na escuta, sem modelo no pedido, também grava o scribe_v2; 401 não grava", async () => {
      const { ctx } = contexto();
      const ok = await salvarChaveIALogica(
        ctx,
        { finalidade: "transcricao", provedor: "elevenlabs", modelo: "", chave: VOZ },
        { fetch: fetchFalso({ status: 200, corpo: COM_CREDITO }).fetch },
      );
      expect(ok).toMatchObject({ ok: true });
      expect(dubles.gravarChaveIA).toHaveBeenCalledWith(
        expect.objectContaining({ finalidade: "transcricao", modelo: "scribe_v2" }),
      );

      dubles.gravarChaveIA.mockClear();
      const recusada = await salvarChaveIALogica(
        ctx,
        { finalidade: "transcricao", provedor: "elevenlabs", modelo: "", chave: VOZ },
        { fetch: fetchFalso({ status: 401, corpo: { detail: { status: "invalid_api_key" } } }).fetch },
      );
      expect(recusada).toMatchObject({ ok: false, erro: "chave_invalida" });
      expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
      semCredenciais(recusada, VOZ);
    });

    it("os textos das recusas: a ElevenLabs na resposta e a Anthropic na transcrição", async () => {
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso({ status: 200, corpo: COM_CREDITO });
      const elevenlabs = await salvarChaveIALogica(
        ctx,
        { finalidade: "resposta", provedor: "elevenlabs", modelo: "", chave: VOZ },
        { fetch },
      );
      expect(elevenlabs).toEqual({
        ok: false,
        erro: "provedor_nao_permitido",
        mensagem: "A ElevenLabs não responde às mensagens: ela fica na voz e na escuta.",
      });
      const anthropic = await salvarChaveIALogica(
        ctx,
        { finalidade: "transcricao", provedor: "anthropic", modelo: "claude", chave: "sk-ant-x" },
        { fetch },
      );
      expect(anthropic).toEqual({
        ok: false,
        erro: "provedor_nao_permitido",
        mensagem:
          "Este provedor responde às mensagens. Para a transcrição, use uma chave da OpenAI, da OpenRouter, da Groq ou da ElevenLabs.",
      });
      // a recusa da voz com outro provedor não muda
      const voz = await salvarChaveIALogica(
        ctx,
        { finalidade: "voz", provedor: "openai", modelo: "", chave: VOZ },
        { fetch },
      );
      expect(voz).toEqual({
        ok: false,
        erro: "provedor_nao_permitido",
        mensagem: "A voz da Janete usa uma chave da ElevenLabs.",
      });
      expect(chamadas).toHaveLength(0);
      expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    });
  });
});

describe("verSegredoGerado", () => {
  const conexao: ConexaoServidor = {
    id: CONEXAO,
    gateway: "zapi",
    id_externo: "X",
    parametros: {},
    segredos: { instanceToken: "tok", clientToken: "cli", tokenUrl: "gerado-123" },
    oficial: false,
  };

  it("sem admin dá sem_acesso", async () => {
    const { ctx } = contexto({ admin: false });
    expect(await verSegredoGeradoLogica(ctx, { conexao_id: CONEXAO, nome: "tokenUrl" })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(dubles.carregarConexao).not.toHaveBeenCalled();
  });

  it("devolve o segredo gerado", async () => {
    dubles.carregarConexao.mockResolvedValue(conexao);
    const { ctx } = contexto();
    expect(await verSegredoGeradoLogica(ctx, { conexao_id: CONEXAO, nome: "tokenUrl" })).toEqual({
      ok: true,
      valor: "gerado-123",
    });
  });

  it("segredo colado nunca sai; conexão ou segredo ausente dá nao_encontrado", async () => {
    dubles.carregarConexao.mockResolvedValue(conexao);
    const { ctx } = contexto();
    const colado = await verSegredoGeradoLogica(ctx, {
      conexao_id: CONEXAO,
      nome: "instanceToken" as never,
    });
    expect(colado).toEqual({ ok: false, erro: "nao_encontrado" });
    expect(await verSegredoGeradoLogica(ctx, { conexao_id: CONEXAO, nome: "verifyToken" })).toEqual(
      {
        ok: false,
        erro: "nao_encontrado",
      },
    );
    dubles.carregarConexao.mockResolvedValue(null);
    expect(await verSegredoGeradoLogica(ctx, { conexao_id: CONEXAO, nome: "tokenUrl" })).toEqual({
      ok: false,
      erro: "nao_encontrado",
    });
  });
});
