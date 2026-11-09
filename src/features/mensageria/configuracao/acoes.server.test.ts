import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Fetch } from "@/features/servidor/http";

import type { ClienteUsuario, ContextoUsuario } from "../configuracao.server";
import type { ChaveIA } from "../nucleo/conexoes.server";
import { ErroGateway, type ConexaoServidor } from "../nucleo/tipos";

const dubles = vi.hoisted(() => ({
  conexaoAtiva: vi.fn(),
  /** O desligarWebhook falso da Evolution e da Zernio (os de verdade são da onda A). */
  desligarWebhook: vi.fn(),
  lerChaveIA: vi.fn(),
  gravarChaveIA: vi.fn(),
  banco: {
    auditar: vi.fn(),
    idConexaoAtiva: vi.fn(),
    desativarConexao: vi.fn(),
    cancelarBolhasDaJaneteNaFila: vi.fn(),
    falharMensagensDaEquipeNaFila: vi.fn(),
    gravarStatusConexao: vi.fn(),
    regravarConexao: vi.fn(),
    lerResumoChaveIA: vi.fn(),
    gravarStatusChave: vi.fn(),
    gravarModeloChave: vi.fn(),
    apagarChave: vi.fn(),
    gravarRitmo: vi.fn(),
    lerConfigVozTela: vi.fn(),
    gravarVoz: vi.fn(),
    gravarModoVoz: vi.fn(),
    gravarErroVoz: vi.fn(),
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
vi.mock("../nucleo/conexoes.server", () => ({
  conexaoAtiva: dubles.conexaoAtiva,
  lerChaveIA: dubles.lerChaveIA,
  gravarChaveIA: dubles.gravarChaveIA,
}));
vi.mock("./banco.server", () => dubles.banco);
// os adaptadores de verdade, com o desligarWebhook trocado: falso na Evolution e na Zernio,
// ausente na Meta e na Z-API (que não têm API para desligar)
vi.mock("../gateways", async (original) => {
  const real = await original<typeof import("../gateways")>();
  return {
    ...real,
    adaptadorDe: (g: string) => {
      const a = real.adaptadorDe(g);
      if (!a) return null;
      const comDesligar = g === "evolution" || g === "zernio";
      return { ...a, desligarWebhook: comDesligar ? dubles.desligarWebhook : undefined };
    },
  };
});

import {
  camposGuardados,
  conferirConexaoLogica,
  consertarCampoConexaoLogica,
  desconectarConexaoLogica,
  escolherVozLogica,
  TETO_DESLIGAR_WEBHOOK_MS,
  TEXTO_WEBHOOK_DESLIGADO_SEM_DESCONECTAR,
  foraDoRitmo,
  listarModelosDaChaveLogica,
  listarVozesLogica,
  removerChaveIALogica,
  revalidarChaveIALogica,
  salvarModoVozLogica,
  salvarRitmoLogica,
  trocarModeloIALogica,
  usarChaveElevenLabsLogica,
} from "./acoes.server";

const MEMBRO = "9d1c7a20-0000-4000-8000-000000000001";
const CONEXAO = "c0ffee00-0000-4000-8000-0000000000aa";
const CHAVE_ID = "c4a7e000-0000-4000-8000-0000000000bb";

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

function semCredenciais(resposta: unknown, ...segredos: string[]) {
  const texto = JSON.stringify(resposta);
  for (const s of segredos) expect(texto).not.toContain(s);
}

// Credenciais falsas, longas e únicas, para provar que nunca voltam na resposta.
const ZAPI_GUARDADA: ConexaoServidor = {
  id: CONEXAO,
  gateway: "zapi",
  id_externo: "3D9A1B2C3D4E5F",
  parametros: { instanceId: "3D9A1B2C3D4E5F" },
  segredos: {
    instanceToken: "token-instancia-zapi-QWERTY123456",
    clientToken: "client-token-zapi-ASDFGH654321",
    tokenUrl: "token-url-gerado-ZXCV",
  },
  oficial: false,
};
const META_GUARDADA: ConexaoServidor = {
  id: CONEXAO,
  gateway: "meta",
  id_externo: "106540352242922",
  parametros: { phoneId: "106540352242922", wabaId: "998877" },
  segredos: {
    token: "EAAG-token-antigo-ZXCVBN987654",
    appSecret: "app-secret-meta-POIUYT112233",
    verifyToken: "verify-token-nosso-LKJH5544",
  },
  oficial: true,
};
const EVOLUTION_GUARDADA: ConexaoServidor = {
  id: CONEXAO,
  gateway: "evolution",
  id_externo: "loja-janete",
  parametros: { serverUrl: "https://evo.exemplo.com" },
  segredos: { apiKey: "api-key-evolution-MNBVCX778899", webhookSecret: "segredo-webhook-evo-0011" },
  oficial: false,
};
const ZERNIO_GUARDADA: ConexaoServidor = {
  id: CONEXAO,
  gateway: "zernio",
  id_externo: "acc-123",
  parametros: { webhookId: "wh-456" },
  segredos: { apiKey: "api-key-zernio-QAZWSX445566", webhookSecret: "segredo-webhook-zernio-2233" },
  oficial: false,
};
const META_OK = {
  status: 200,
  corpo: { display_phone_number: "55 11 99999-0000", verified_name: "Loja" },
};

const OPENAI = "sk-proj-chave-guardada-falsa-LKJH";
const GROQ = "gsk_chave-groq-guardada-MNBV";
function chave(o: Partial<ChaveIA> = {}): ChaveIA {
  return {
    id: CHAVE_ID,
    provedor: "openai",
    modelo: "gpt-5.5-mini",
    workspace_id: null,
    chave: OPENAI,
    ...o,
  };
}

beforeEach(() => {
  dubles.conexaoAtiva.mockReset().mockResolvedValue(null);
  dubles.desligarWebhook.mockReset().mockResolvedValue(undefined);
  dubles.lerChaveIA.mockReset().mockResolvedValue(null);
  dubles.gravarChaveIA
    .mockReset()
    .mockImplementation(async (n: { chave: string }) => ({ ultimos4: n.chave.trim().slice(-4) }));
  for (const f of Object.values(dubles.banco)) f.mockReset().mockResolvedValue(undefined);
  dubles.banco.idConexaoAtiva.mockResolvedValue(CONEXAO);
  dubles.banco.lerResumoChaveIA.mockResolvedValue(null);
  dubles.banco.lerConfigVozTela.mockResolvedValue({ modo: "quando_audio", voz: null, erro: null });
  dubles.banco.gravarVoz.mockResolvedValue(null);
  dubles.banco.gravarModoVoz.mockResolvedValue(null);
});

// ---------- desconectarConexao ----------

describe("desconectarConexao", () => {
  it("sem admin dá sem_acesso, sem tocar no banco", async () => {
    const { ctx, rpc } = contexto({ admin: false });
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: false, erro: "sem_acesso" });
    expect(rpc).toHaveBeenCalledWith("eh_admin");
    expect(dubles.banco.idConexaoAtiva).not.toHaveBeenCalled();
    expect(dubles.banco.desativarConexao).not.toHaveBeenCalled();
    expect(dubles.desligarWebhook).not.toHaveBeenCalled();
  });

  it("desliga a conexão ativa e grava a auditoria conexao_desativada", async () => {
    dubles.conexaoAtiva.mockResolvedValue(EVOLUTION_GUARDADA);
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: true, conexao_id: CONEXAO });
    expect(dubles.banco.desativarConexao).toHaveBeenCalledWith(CONEXAO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith({
      acao: "conexao_desativada",
      alvo: CONEXAO,
      ator_membro_id: MEMBRO,
      detalhe: { gateway: "evolution", webhook: "desligado" },
    });
  });

  // ---------- o webhook no provedor (decisão 4 das lacunas) ----------

  it("desliga o webhook antes de desativar, com os segredos ainda guardados", async () => {
    const ordem: string[] = [];
    dubles.conexaoAtiva.mockResolvedValue(EVOLUTION_GUARDADA);
    dubles.desligarWebhook.mockImplementation(async () => {
      ordem.push("desligarWebhook");
    });
    dubles.banco.desativarConexao.mockImplementation(async () => {
      ordem.push("desativarConexao");
    });
    const { ctx } = contexto();
    await desconectarConexaoLogica(ctx);
    expect(ordem).toEqual(["desligarWebhook", "desativarConexao"]);
    expect(dubles.desligarWebhook).toHaveBeenCalledWith(EVOLUTION_GUARDADA);
  });

  it.each([
    ["meta", META_GUARDADA],
    ["zapi", ZAPI_GUARDADA],
  ] as const)("%s sem API: webhook_no_painel", async (gateway, conexao) => {
    dubles.conexaoAtiva.mockResolvedValue(conexao);
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      aviso: "webhook_no_painel",
    });
    expect(dubles.desligarWebhook).not.toHaveBeenCalled();
    expect(dubles.banco.desativarConexao).toHaveBeenCalledWith(CONEXAO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({ detalhe: { gateway, webhook: "no_painel" } }),
    );
  });

  it.each([
    ["evolution", EVOLUTION_GUARDADA],
    ["zernio", ZERNIO_GUARDADA],
  ] as const)("%s que desliga fica sem aviso", async (_gateway, conexao) => {
    dubles.conexaoAtiva.mockResolvedValue(conexao);
    const { ctx } = contexto();
    const r = await desconectarConexaoLogica(ctx);
    expect(r).toEqual({ ok: true, conexao_id: CONEXAO });
    expect(dubles.desligarWebhook).toHaveBeenCalledTimes(1);
    expect(dubles.banco.desativarConexao).toHaveBeenCalledWith(CONEXAO);
  });

  it.each([
    ["evolution", EVOLUTION_GUARDADA],
    ["zernio", ZERNIO_GUARDADA],
  ] as const)("%s que falha: webhook_nao_desligado", async (gateway, conexao) => {
    dubles.conexaoAtiva.mockResolvedValue(conexao);
    dubles.desligarWebhook.mockRejectedValue(new Error("http_500"));
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      aviso: "webhook_nao_desligado",
    });
    expect(dubles.banco.desativarConexao).toHaveBeenCalledWith(CONEXAO);
    // erro sem código conhecido: a causa não leva a mensagem
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        detalhe: { gateway, webhook: "nao_desligado", webhook_causa: "erro_desconhecido" },
      }),
    );
  });

  it("a auditoria do nao_desligado leva só o código do erro do gateway", async () => {
    dubles.conexaoAtiva.mockResolvedValue(ZERNIO_GUARDADA);
    dubles.desligarWebhook.mockRejectedValue(
      new ErroGateway("zernio_http_401", true, "https://x/?token=segredo corpo da resposta"),
    );
    const { ctx } = contexto();
    await desconectarConexaoLogica(ctx);
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        detalhe: { gateway: "zernio", webhook: "nao_desligado", webhook_causa: "zernio_http_401" },
      }),
    );
    expect(JSON.stringify(dubles.banco.auditar.mock.calls)).not.toContain("segredo");
  });

  it("o teto do desligar estourado: webhook_nao_desligado, e desativa mesmo assim", async () => {
    dubles.conexaoAtiva.mockResolvedValue(ZERNIO_GUARDADA);
    // o provedor não responde nunca
    dubles.desligarWebhook.mockImplementation(() => new Promise(() => {}));
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx, { tetoWebhookMs: 20 })).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      aviso: "webhook_nao_desligado",
    });
    expect(dubles.banco.desativarConexao).toHaveBeenCalledWith(CONEXAO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        detalhe: { gateway: "zernio", webhook: "nao_desligado", webhook_causa: "tempo_esgotado" },
      }),
    );
  });

  it("o teto padrão fica abaixo dos 10 s dos vizinhos", () => {
    expect(TETO_DESLIGAR_WEBHOOK_MS).toBe(8_000);
  });

  it("falha ao carregar a conexão com os segredos: webhook_nao_desligado, e desativa mesmo assim", async () => {
    dubles.conexaoAtiva.mockRejectedValue(new Error("cifra_invalida"));
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      aviso: "webhook_nao_desligado",
    });
    expect(dubles.desligarWebhook).not.toHaveBeenCalled();
    expect(dubles.banco.desativarConexao).toHaveBeenCalledWith(CONEXAO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        detalhe: { gateway: null, webhook: "nao_desligado", webhook_causa: "conexao_nao_carregou" },
      }),
    );
  });

  it("a ativa mudou entre as leituras: não mexe no webhook da outra, e desativa a lida", async () => {
    dubles.conexaoAtiva.mockResolvedValue({ ...EVOLUTION_GUARDADA, id: "outra-conexao" });
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toMatchObject({
      ok: true,
      aviso: "webhook_nao_desligado",
    });
    expect(dubles.desligarWebhook).not.toHaveBeenCalled();
    expect(dubles.banco.desativarConexao).toHaveBeenCalledWith(CONEXAO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        detalhe: { gateway: null, webhook: "nao_desligado", webhook_causa: "conexao_mudou" },
      }),
    );
  });

  // ---------- as mensagens na fila (decisão 11 das lacunas) ----------

  it("depois de desativar, cancela as bolhas da Janete e falha as da equipe, só daquela conexão", async () => {
    const ordem: string[] = [];
    dubles.conexaoAtiva.mockResolvedValue(EVOLUTION_GUARDADA);
    dubles.banco.desativarConexao.mockImplementation(async () => {
      ordem.push("desativarConexao");
    });
    dubles.banco.cancelarBolhasDaJaneteNaFila.mockImplementation(async () => {
      ordem.push("cancelarJanete");
    });
    dubles.banco.falharMensagensDaEquipeNaFila.mockImplementation(async () => {
      ordem.push("falharEquipe");
    });
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: true, conexao_id: CONEXAO });
    expect(ordem).toEqual(["desativarConexao", "cancelarJanete", "falharEquipe"]);
    expect(dubles.banco.cancelarBolhasDaJaneteNaFila).toHaveBeenCalledWith(CONEXAO);
    expect(dubles.banco.falharMensagensDaEquipeNaFila).toHaveBeenCalledWith(CONEXAO);
  });

  it("a fila que não parou fica na auditoria e não desfaz o Desconectar", async () => {
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    dubles.banco.cancelarBolhasDaJaneteNaFila.mockRejectedValue(
      new Error("banco_cancelar_fila_janete"),
    );
    dubles.banco.falharMensagensDaEquipeNaFila.mockRejectedValue(
      new Error("banco_falhar_fila_equipe"),
    );
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      aviso: "webhook_no_painel",
    });
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "conexao_desativada",
        detalhe: {
          gateway: "meta",
          webhook: "no_painel",
          fila_causa: "cancelar_fila_janete,falhar_fila_equipe",
        },
      }),
    );
  });

  it("uma parte da fila que falha não impede a outra", async () => {
    dubles.conexaoAtiva.mockResolvedValue(EVOLUTION_GUARDADA);
    dubles.banco.cancelarBolhasDaJaneteNaFila.mockRejectedValue(
      new Error("banco_cancelar_fila_janete"),
    );
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: true, conexao_id: CONEXAO });
    expect(dubles.banco.falharMensagensDaEquipeNaFila).toHaveBeenCalledWith(CONEXAO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        detalhe: { gateway: "evolution", webhook: "desligado", fila_causa: "cancelar_fila_janete" },
      }),
    );
  });

  it("o desativar que falha não mexe na fila", async () => {
    dubles.banco.desativarConexao.mockRejectedValue(new Error("banco_desativar_conexao"));
    const { ctx } = contexto();
    await desconectarConexaoLogica(ctx);
    expect(dubles.banco.cancelarBolhasDaJaneteNaFila).not.toHaveBeenCalled();
    expect(dubles.banco.falharMensagensDaEquipeNaFila).not.toHaveBeenCalled();
  });

  it("sem conexão ativa dá sem_conexao", async () => {
    dubles.banco.idConexaoAtiva.mockResolvedValue(null);
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: false, erro: "sem_conexao" });
    expect(dubles.banco.desativarConexao).not.toHaveBeenCalled();
    expect(dubles.conexaoAtiva).not.toHaveBeenCalled();
    expect(dubles.desligarWebhook).not.toHaveBeenCalled();
  });

  it("0 linhas atingidas é erro_ao_gravar, sem auditoria", async () => {
    dubles.banco.desativarConexao.mockRejectedValue(new Error("banco_desativar_conexao"));
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: false, erro: "erro_ao_gravar" });
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
  });

  it("o webhook desligado e o desativar falhou: erro com o texto de desconectar de novo", async () => {
    dubles.conexaoAtiva.mockResolvedValue(EVOLUTION_GUARDADA);
    dubles.banco.desativarConexao.mockRejectedValue(new Error("banco_desativar_conexao"));
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({
      ok: false,
      erro: "erro_ao_gravar",
      mensagem: TEXTO_WEBHOOK_DESLIGADO_SEM_DESCONECTAR,
    });
    expect(dubles.desligarWebhook).toHaveBeenCalledTimes(1);
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
    // o Desconectar de novo termina: desliga outra vez e desativa, com a auditoria do webhook
    dubles.banco.desativarConexao.mockReset().mockResolvedValue(undefined);
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: true, conexao_id: CONEXAO });
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "conexao_desativada",
        detalhe: { gateway: "evolution", webhook: "desligado" },
      }),
    );
  });

  it("o webhook não desligado e o desativar falhou: erro_ao_gravar sem o texto próprio", async () => {
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    dubles.banco.desativarConexao.mockRejectedValue(new Error("banco_desativar_conexao"));
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: false, erro: "erro_ao_gravar" });
  });

  it("falha ao ler dá erro_ao_ler", async () => {
    dubles.banco.idConexaoAtiva.mockRejectedValue(new Error("banco_ler_conexao"));
    const { ctx } = contexto();
    expect(await desconectarConexaoLogica(ctx)).toEqual({ ok: false, erro: "erro_ao_ler" });
  });
});

// ---------- conferirConexao ----------

describe("conferirConexao", () => {
  it("remonta os campos de cada gateway a partir do que está guardado", () => {
    expect(camposGuardados(META_GUARDADA)).toEqual({
      phoneId: "106540352242922",
      wabaId: "998877",
      token: META_GUARDADA.segredos["token"],
      appSecret: META_GUARDADA.segredos["appSecret"],
    });
    expect(camposGuardados(ZAPI_GUARDADA)).toEqual({
      instanceId: "3D9A1B2C3D4E5F",
      instanceToken: ZAPI_GUARDADA.segredos["instanceToken"],
      clientToken: ZAPI_GUARDADA.segredos["clientToken"],
    });
    expect(
      camposGuardados({
        ...ZAPI_GUARDADA,
        gateway: "zernio",
        id_externo: "acc_7",
        parametros: {},
        segredos: { apiKey: "k", webhookSecret: "w" },
      }),
    ).toEqual({ apiKey: "k", accountId: "acc_7" });
    expect(
      camposGuardados({
        ...ZAPI_GUARDADA,
        gateway: "evolution",
        id_externo: "minha-instancia",
        parametros: { serverUrl: "https://evo.exemplo.com" },
        segredos: { apiKey: "k", tokenUrl: "t" },
      }),
    ).toEqual({
      serverUrl: "https://evo.exemplo.com",
      instanceName: "minha-instancia",
      apiKey: "k",
    });
  });

  it("sem admin dá sem_acesso, sem ler a conexão", async () => {
    const { ctx } = contexto({ admin: false });
    expect(await conferirConexaoLogica(ctx)).toEqual({ ok: false, erro: "sem_acesso" });
    expect(dubles.conexaoAtiva).not.toHaveBeenCalled();
  });

  it("conexão boa: valida com os segredos guardados e grava conectada", async () => {
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { connected: true } });
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      gateway: "zapi",
      nome: "Instância 3D9A1B2C3D4E5F",
      status: "conectada",
    });
    expect(chamadas[0]?.url).toContain("/3D9A1B2C3D4E5F/token/token-instancia-zapi-QWERTY123456/");
    expect((chamadas[0]?.init.headers as Record<string, string>)["Client-Token"]).toBe(
      "client-token-zapi-ASDFGH654321",
    );
    expect(dubles.banco.gravarStatusConexao).toHaveBeenCalledWith(CONEXAO, "conectada", null);
    semCredenciais(r, ...Object.values(ZAPI_GUARDADA.segredos));
  });

  it("credencial recusada: grava erro com o código e devolve a mensagem", async () => {
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 401, corpo: { error: { code: 190 } } });
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toMatchObject({
      ok: false,
      erro: "credencial_invalida",
      campo: "token",
      status: "erro",
    });
    expect(dubles.banco.gravarStatusConexao).toHaveBeenCalledWith(
      CONEXAO,
      "erro",
      "credencial_invalida",
    );
    semCredenciais(r, ...Object.values(META_GUARDADA.segredos));
  });

  it("instância desconectada grava desconectada", async () => {
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 200, corpo: { connected: false } });
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toMatchObject({ ok: false, erro: "instancia_desconectada", status: "desconectada" });
    expect(dubles.banco.gravarStatusConexao).toHaveBeenCalledWith(
      CONEXAO,
      "desconectada",
      "instancia_desconectada",
    );
  });

  it("gateway fora do ar é passageiro: não muda o status gravado", async () => {
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 500, corpo: {} });
    const r = await conferirConexaoLogica(ctx, { fetch });
    expect(r).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
    expect(r).not.toHaveProperty("status");
    expect(dubles.banco.gravarStatusConexao).not.toHaveBeenCalled();
  });

  it("sem conexão, segredo faltando, cifra inválida e falha ao gravar", async () => {
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { connected: true } });
    expect(await conferirConexaoLogica(ctx, { fetch })).toEqual({ ok: false, erro: "sem_conexao" });

    dubles.conexaoAtiva.mockResolvedValue({ ...ZAPI_GUARDADA, segredos: { instanceToken: "x" } });
    expect(await conferirConexaoLogica(ctx, { fetch })).toEqual({
      ok: false,
      erro: "conexao_invalida",
    });
    expect(chamadas).toHaveLength(0);

    dubles.conexaoAtiva.mockRejectedValue(new Error("cifra_invalida"));
    expect(await conferirConexaoLogica(ctx, { fetch })).toEqual({
      ok: false,
      erro: "cifra_invalida",
    });

    dubles.conexaoAtiva.mockReset().mockResolvedValue(ZAPI_GUARDADA);
    dubles.banco.gravarStatusConexao.mockRejectedValue(new Error("banco_gravar_status_conexao"));
    expect(await conferirConexaoLogica(ctx, { fetch })).toEqual({
      ok: false,
      erro: "erro_ao_gravar",
    });
  });
});

// ---------- consertarCampoConexao ----------

describe("consertarCampoConexao", () => {
  const NOVO = "EAAG-token-novo-MNBVCX111222";

  it("sem admin dá sem_acesso", async () => {
    const { ctx } = contexto({ admin: false });
    const r = await consertarCampoConexaoLogica(ctx, { campo: "token", valor: NOVO });
    expect(r).toEqual({ ok: false, erro: "sem_acesso" });
    expect(dubles.conexaoAtiva).not.toHaveBeenCalled();
  });

  it("token novo: junta ao guardado, mantém o verifyToken e regrava", async () => {
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(META_OK);
    const r = await consertarCampoConexaoLogica(
      ctx,
      { campo: "token", valor: `  ${NOVO} ` },
      { fetch },
    );
    expect(r).toEqual({
      ok: true,
      conexao_id: CONEXAO,
      gateway: "meta",
      nome: "+55 11 99999-0000 · Loja",
    });
    expect((chamadas[0]?.init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${NOVO}`,
    );
    expect(dubles.banco.regravarConexao).toHaveBeenCalledWith(CONEXAO, {
      nome: "+55 11 99999-0000 · Loja",
      parametros: { phoneId: "106540352242922", wabaId: "998877" },
      segredos: {
        token: NOVO,
        appSecret: META_GUARDADA.segredos["appSecret"],
        verifyToken: META_GUARDADA.segredos["verifyToken"],
      },
    });
    semCredenciais(r, NOVO, ...Object.values(META_GUARDADA.segredos));
  });

  it("appSecret novo valida com o token guardado; wabaId vazio sai dos parâmetros", async () => {
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(META_OK);
    await consertarCampoConexaoLogica(
      ctx,
      { campo: "appSecret", valor: "app-secret-novo-QAZ" },
      { fetch },
    );
    expect((chamadas[0]?.init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${META_GUARDADA.segredos["token"]}`,
    );
    const dados = dubles.banco.regravarConexao.mock.calls[0]?.[1] as {
      segredos: Record<string, string>;
    };
    expect(dados.segredos["appSecret"]).toBe("app-secret-novo-QAZ");

    dubles.banco.regravarConexao.mockClear();
    await consertarCampoConexaoLogica(ctx, { campo: "wabaId", valor: "" }, { fetch });
    expect(dubles.banco.regravarConexao.mock.calls[0]?.[1]).toMatchObject({
      parametros: { phoneId: "106540352242922" },
    });
    const parametros = (dubles.banco.regravarConexao.mock.calls[0]?.[1] as { parametros: object })
      .parametros;
    expect(parametros).not.toHaveProperty("wabaId");
  });

  it("só na Meta; sem conexão dá sem_conexao", async () => {
    const { ctx } = contexto();
    expect(await consertarCampoConexaoLogica(ctx, { campo: "token", valor: NOVO })).toEqual({
      ok: false,
      erro: "sem_conexao",
    });
    dubles.conexaoAtiva.mockResolvedValue(ZAPI_GUARDADA);
    expect(await consertarCampoConexaoLogica(ctx, { campo: "token", valor: NOVO })).toEqual({
      ok: false,
      erro: "so_meta",
    });
  });

  it("campo vazio é recusado sem chamar a Meta", async () => {
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(META_OK);
    const r = await consertarCampoConexaoLogica(ctx, { campo: "token", valor: "   " }, { fetch });
    expect(r).toEqual({ ok: false, erro: "campo_vazio", campo: "token" });
    expect(chamadas).toHaveLength(0);
  });

  it("token recusado pela Meta: nada é gravado", async () => {
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    const { ctx } = contexto();
    const { fetch } = fetchFalso({ status: 401, corpo: { error: { code: 190 } } });
    const r = await consertarCampoConexaoLogica(ctx, { campo: "token", valor: NOVO }, { fetch });
    expect(r).toMatchObject({ ok: false, erro: "credencial_invalida", campo: "token" });
    expect(dubles.banco.regravarConexao).not.toHaveBeenCalled();
    semCredenciais(r, NOVO);
  });

  it("sem o verifyToken guardado dá conexao_invalida; falha da cifra passa adiante", async () => {
    const { ctx } = contexto();
    const { fetch } = fetchFalso(META_OK);
    dubles.conexaoAtiva.mockResolvedValue({
      ...META_GUARDADA,
      segredos: { token: "a", appSecret: "b" },
    });
    expect(
      await consertarCampoConexaoLogica(ctx, { campo: "token", valor: NOVO }, { fetch }),
    ).toEqual({
      ok: false,
      erro: "conexao_invalida",
    });
    dubles.conexaoAtiva.mockResolvedValue(META_GUARDADA);
    dubles.banco.regravarConexao.mockRejectedValue(new Error("cifra_indisponivel"));
    expect(
      await consertarCampoConexaoLogica(ctx, { campo: "token", valor: NOVO }, { fetch }),
    ).toEqual({
      ok: false,
      erro: "cifra_indisponivel",
    });
  });
});

// ---------- revalidarChaveIA ----------

describe("revalidarChaveIA", () => {
  it("sem admin dá sem_acesso, sem ler a chave", async () => {
    const { ctx } = contexto({ admin: false });
    expect(await revalidarChaveIALogica(ctx, { finalidade: "resposta" })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(dubles.lerChaveIA).not.toHaveBeenCalled();
  });

  it("chave boa: a conferência grátis (GET do modelo) e o status volta para ativa", async () => {
    dubles.lerChaveIA.mockResolvedValue(chave());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { id: "gpt-5.5-mini" } });
    const r = await revalidarChaveIALogica(ctx, { finalidade: "resposta" }, { fetch });
    expect(r).toEqual({ ok: true, status: "ativa", provedor: "openai", modelo: "gpt-5.5-mini" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("https://api.openai.com/v1/models/gpt-5.5-mini");
    expect(chamadas[0]?.init.method).toBe("GET");
    expect(dubles.banco.gravarStatusChave).toHaveBeenCalledWith(CHAVE_ID, "ativa", null);
    semCredenciais(r, OPENAI);
  });

  it("chave recusada marca invalida; sem crédito marca sem_credito", async () => {
    dubles.lerChaveIA.mockResolvedValue(chave());
    const { ctx } = contexto();
    let r = await revalidarChaveIALogica(
      ctx,
      { finalidade: "resposta" },
      fetchFalso({ status: 401, corpo: {} }),
    );
    expect(r).toMatchObject({ ok: false, erro: "chave_invalida", status: "invalida" });
    expect(dubles.banco.gravarStatusChave).toHaveBeenLastCalledWith(
      CHAVE_ID,
      "invalida",
      "chave_invalida",
    );

    r = await revalidarChaveIALogica(
      ctx,
      { finalidade: "resposta" },
      fetchFalso({ status: 429, corpo: { error: { code: "insufficient_quota" } } }),
    );
    expect(r).toMatchObject({ ok: false, erro: "sem_credito", status: "sem_credito" });
    expect(dubles.banco.gravarStatusChave).toHaveBeenLastCalledWith(
      CHAVE_ID,
      "sem_credito",
      "sem_credito",
    );
  });

  it("recusa que pode ser de configuração (modelo, permissão) não marca invalida", async () => {
    dubles.lerChaveIA.mockResolvedValue(chave());
    const { ctx } = contexto();
    const r404 = await revalidarChaveIALogica(
      ctx,
      { finalidade: "resposta" },
      fetchFalso({ status: 404, corpo: {} }),
    );
    expect(r404).toMatchObject({ ok: false, erro: "modelo_indisponivel" });
    expect(r404).not.toHaveProperty("status");
    const r403 = await revalidarChaveIALogica(
      ctx,
      { finalidade: "resposta" },
      fetchFalso({ status: 403, corpo: {} }),
    );
    expect(r403).toMatchObject({ ok: false });
    expect(r403).not.toHaveProperty("status");
    expect(r403.ok === false && "erro" in r403 ? r403.erro : "").not.toBe("chave_invalida");
    expect(dubles.banco.gravarStatusChave).not.toHaveBeenCalled();
  });

  it("provedor fora é passageiro: não muda o status", async () => {
    dubles.lerChaveIA.mockResolvedValue(chave());
    const { ctx } = contexto();
    const r = await revalidarChaveIALogica(
      ctx,
      { finalidade: "resposta" },
      fetchFalso({ status: 500, corpo: {} }),
    );
    expect(r).toMatchObject({ ok: false, erro: "provedor_fora" });
    expect(r).not.toHaveProperty("status");
    expect(dubles.banco.gravarStatusChave).not.toHaveBeenCalled();
  });

  it("Groq na transcrição confere pela lista de modelos", async () => {
    dubles.lerChaveIA.mockResolvedValue(
      chave({ provedor: "groq", modelo: "whisper-large-v3-turbo", chave: GROQ }),
    );
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({
      status: 200,
      corpo: { data: [{ id: "whisper-large-v3-turbo" }] },
    });
    const r = await revalidarChaveIALogica(ctx, { finalidade: "transcricao" }, { fetch });
    expect(r).toMatchObject({ ok: true, provedor: "groq" });
    expect(chamadas[0]?.url).toBe("https://api.groq.com/openai/v1/models");
    expect(dubles.lerChaveIA).toHaveBeenCalledWith("transcricao");
  });

  it("sem chave guardada dá sem_chave; cifra fora dá cifra_indisponivel", async () => {
    const { ctx } = contexto();
    expect(await revalidarChaveIALogica(ctx, { finalidade: "transcricao" })).toEqual({
      ok: false,
      erro: "sem_chave",
    });
    dubles.lerChaveIA.mockRejectedValue(new Error("cifra_indisponivel"));
    expect(await revalidarChaveIALogica(ctx, { finalidade: "resposta" })).toEqual({
      ok: false,
      erro: "cifra_indisponivel",
    });
  });
});

// ---------- listarModelosDaChave ----------

describe("listarModelosDaChave", () => {
  it("sem admin dá sem_acesso", async () => {
    const { ctx } = contexto({ admin: false });
    expect(await listarModelosDaChaveLogica(ctx, { finalidade: "resposta" })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(dubles.lerChaveIA).not.toHaveBeenCalled();
  });

  it("resposta: lista do provedor com a chave guardada, que nunca volta", async () => {
    dubles.lerChaveIA.mockResolvedValue(chave());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({
      status: 200,
      corpo: { data: [{ id: "gpt-5.5-mini" }, { id: "whisper-1" }] },
    });
    const r = await listarModelosDaChaveLogica(ctx, { finalidade: "resposta" }, { fetch });
    expect(r).toMatchObject({ ok: true, origem: "provedor" });
    expect(chamadas[0]?.url).toBe("https://api.openai.com/v1/models");
    expect((chamadas[0]?.init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${OPENAI}`,
    );
    const ids = r.ok && "modelos" in r ? r.modelos.map((m) => m.id) : [];
    expect(ids).toContain("gpt-5.5-mini");
    expect(ids).not.toContain("whisper-1");
    semCredenciais(r, OPENAI);
  });

  it("transcrição na Groq: só os modelos de voz", async () => {
    dubles.lerChaveIA.mockResolvedValue(
      chave({ provedor: "groq", modelo: "whisper-large-v3-turbo", chave: GROQ }),
    );
    const { ctx } = contexto();
    const { fetch } = fetchFalso({
      status: 200,
      corpo: {
        data: [{ id: "llama-4" }, { id: "whisper-large-v3-turbo" }, { id: "whisper-large-v3" }],
      },
    });
    const r = await listarModelosDaChaveLogica(ctx, { finalidade: "transcricao" }, { fetch });
    expect(r).toEqual({
      ok: true,
      origem: "provedor",
      modelos: [
        { id: "whisper-large-v3-turbo", nome: "whisper-large-v3-turbo", recomendado: true },
        { id: "whisper-large-v3", nome: "whisper-large-v3", recomendado: false },
      ],
    });
  });

  it("transcrição: chave recusada pela Groq dá chave_invalida", async () => {
    dubles.lerChaveIA.mockResolvedValue(
      chave({ provedor: "groq", modelo: "whisper-large-v3-turbo", chave: GROQ }),
    );
    const { ctx } = contexto();
    const r = await listarModelosDaChaveLogica(
      ctx,
      { finalidade: "transcricao" },
      fetchFalso({ status: 401 }),
    );
    expect(r).toMatchObject({ ok: false, erro: "chave_invalida" });
    semCredenciais(r, GROQ);
  });

  it("transcrição na OpenRouter: o modelo que a transcrição usa, sem chamar o provedor", async () => {
    dubles.lerChaveIA.mockResolvedValue(
      chave({ provedor: "openrouter", modelo: "openai/whisper-1" }),
    );
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    const r = await listarModelosDaChaveLogica(ctx, { finalidade: "transcricao" }, { fetch });
    expect(r).toEqual({
      ok: true,
      origem: "lista_curada",
      modelos: [{ id: "openai/whisper-1", nome: "openai/whisper-1", recomendado: true }],
    });
    expect(chamadas).toHaveLength(0);
  });

  it("sem chave guardada dá sem_chave", async () => {
    const { ctx } = contexto();
    expect(await listarModelosDaChaveLogica(ctx, { finalidade: "resposta" })).toEqual({
      ok: false,
      erro: "sem_chave",
    });
  });
});

// ---------- trocarModeloIA ----------

describe("trocarModeloIA", () => {
  it("sem admin dá sem_acesso", async () => {
    const { ctx } = contexto({ admin: false });
    expect(await trocarModeloIALogica(ctx, { finalidade: "resposta", modelo: "gpt-5.5" })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(dubles.lerChaveIA).not.toHaveBeenCalled();
  });

  it("confere o modelo novo com a chave guardada, grava e audita", async () => {
    dubles.lerChaveIA.mockResolvedValue(chave());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { id: "gpt-5.5" } });
    const r = await trocarModeloIALogica(
      ctx,
      { finalidade: "resposta", modelo: " gpt-5.5 " },
      { fetch },
    );
    expect(r).toEqual({ ok: true, modelo: "gpt-5.5", status: "ativa" });
    expect(chamadas[0]?.url).toBe("https://api.openai.com/v1/models/gpt-5.5");
    expect(dubles.banco.gravarModeloChave).toHaveBeenCalledWith(CHAVE_ID, "gpt-5.5", MEMBRO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith({
      acao: "chave_trocada",
      alvo: CHAVE_ID,
      ator_membro_id: MEMBRO,
      ultimos4: "LKJH",
      detalhe: {
        finalidade: "resposta",
        provedor: "openai",
        modelo: "gpt-5.5",
        modelo_anterior: "gpt-5.5-mini",
        so_modelo: true,
      },
    });
    semCredenciais(r, OPENAI);
  });

  it("modelo que a chave não alcança: nada muda", async () => {
    dubles.lerChaveIA.mockResolvedValue(chave());
    const { ctx } = contexto();
    const r = await trocarModeloIALogica(
      ctx,
      { finalidade: "resposta", modelo: "gpt-nao-existe" },
      fetchFalso({ status: 404, corpo: {} }),
    );
    expect(r).toMatchObject({ ok: false, erro: "modelo_indisponivel" });
    expect(dubles.banco.gravarModeloChave).not.toHaveBeenCalled();
    expect(dubles.banco.gravarStatusChave).not.toHaveBeenCalled();
  });

  it("transcrição na OpenRouter: só aceita o modelo que a transcrição usa", async () => {
    dubles.lerChaveIA.mockResolvedValue(
      chave({ provedor: "openrouter", modelo: "openai/whisper-1" }),
    );
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { data: { label: "k" } } });
    const r = await trocarModeloIALogica(
      ctx,
      { finalidade: "transcricao", modelo: "anthropic/claude-x" },
      { fetch },
    );
    expect(r).toMatchObject({ ok: false, erro: "modelo_indisponivel" });
    expect(chamadas).toHaveLength(0);
    expect(dubles.banco.gravarModeloChave).not.toHaveBeenCalled();
    expect(dubles.banco.auditar).not.toHaveBeenCalled();

    const certo = await trocarModeloIALogica(
      ctx,
      { finalidade: "transcricao", modelo: "openai/whisper-1" },
      { fetch },
    );
    expect(certo).toEqual({ ok: true, modelo: "openai/whisper-1", status: "ativa" });
  });

  it("modelo vazio, sem chave e falha ao gravar", async () => {
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    expect(
      await trocarModeloIALogica(ctx, { finalidade: "resposta", modelo: "  " }, { fetch }),
    ).toMatchObject({
      ok: false,
      erro: "modelo_indisponivel",
    });
    expect(chamadas).toHaveLength(0);
    expect(
      await trocarModeloIALogica(ctx, { finalidade: "resposta", modelo: "m" }, { fetch }),
    ).toEqual({
      ok: false,
      erro: "sem_chave",
    });
    dubles.lerChaveIA.mockResolvedValue(chave());
    dubles.banco.gravarModeloChave.mockRejectedValue(new Error("banco_gravar_modelo"));
    expect(
      await trocarModeloIALogica(ctx, { finalidade: "resposta", modelo: "m" }, { fetch }),
    ).toMatchObject({
      ok: false,
      erro: "erro_ao_gravar",
    });
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
  });
});

// ---------- removerChaveIA ----------

describe("removerChaveIA", () => {
  const resumo = {
    id: CHAVE_ID,
    provedor: "groq",
    modelo: "whisper-large-v3-turbo",
    workspace_id: null,
    status: "ativa",
    ultimos4: "MNBV",
    temChave: true,
  };

  it("sem admin dá sem_acesso", async () => {
    const { ctx } = contexto({ admin: false });
    expect(await removerChaveIALogica(ctx, { finalidade: "transcricao" })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(dubles.banco.apagarChave).not.toHaveBeenCalled();
  });

  it("apaga a chave de áudio e grava a auditoria chave_removida", async () => {
    dubles.banco.lerResumoChaveIA.mockResolvedValue(resumo);
    const { ctx } = contexto();
    expect(await removerChaveIALogica(ctx, { finalidade: "transcricao" })).toEqual({ ok: true });
    expect(dubles.banco.lerResumoChaveIA).toHaveBeenCalledWith("transcricao");
    expect(dubles.banco.apagarChave).toHaveBeenCalledWith(CHAVE_ID, MEMBRO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith({
      acao: "chave_removida",
      alvo: CHAVE_ID,
      ator_membro_id: MEMBRO,
      ultimos4: "MNBV",
      detalhe: { finalidade: "transcricao", provedor: "groq", modelo: "whisper-large-v3-turbo" },
    });
  });

  it("a chave do cérebro não se remove", async () => {
    const { ctx } = contexto();
    expect(await removerChaveIALogica(ctx, { finalidade: "resposta" })).toEqual({
      ok: false,
      erro: "nao_permitido",
    });
    expect(dubles.banco.lerResumoChaveIA).not.toHaveBeenCalled();
  });

  it("sem chave (nunca cadastrada ou já removida) e falha ao gravar", async () => {
    const { ctx } = contexto();
    expect(await removerChaveIALogica(ctx, { finalidade: "transcricao" })).toEqual({
      ok: false,
      erro: "sem_chave",
    });
    dubles.banco.lerResumoChaveIA.mockResolvedValue({ ...resumo, temChave: false });
    expect(await removerChaveIALogica(ctx, { finalidade: "transcricao" })).toEqual({
      ok: false,
      erro: "sem_chave",
    });
    dubles.banco.lerResumoChaveIA.mockResolvedValue(resumo);
    dubles.banco.apagarChave.mockRejectedValue(new Error("banco_remover_chave"));
    expect(await removerChaveIALogica(ctx, { finalidade: "transcricao" })).toEqual({
      ok: false,
      erro: "erro_ao_gravar",
    });
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
  });

  it("apaga a chave de voz e grava a auditoria chave_removida com a finalidade voz", async () => {
    dubles.banco.lerResumoChaveIA.mockResolvedValue({
      ...resumo,
      provedor: "elevenlabs",
      modelo: "",
      ultimos4: "ABCD",
    });
    const { ctx } = contexto();
    expect(await removerChaveIALogica(ctx, { finalidade: "voz" })).toEqual({ ok: true });
    expect(dubles.banco.lerResumoChaveIA).toHaveBeenCalledWith("voz");
    expect(dubles.banco.apagarChave).toHaveBeenCalledWith(CHAVE_ID, MEMBRO);
    expect(dubles.banco.auditar).toHaveBeenCalledWith({
      acao: "chave_removida",
      alvo: CHAVE_ID,
      ator_membro_id: MEMBRO,
      ultimos4: "ABCD",
      detalhe: { finalidade: "voz", provedor: "elevenlabs", modelo: "" },
    });
    // a do cérebro continua sem remoção
    dubles.banco.apagarChave.mockClear();
    expect(await removerChaveIALogica(ctx, { finalidade: "resposta" })).toEqual({
      ok: false,
      erro: "nao_permitido",
    });
    expect(dubles.banco.apagarChave).not.toHaveBeenCalled();
  });
});

// ---------- a voz (ElevenLabs) nas ações com a chave guardada ----------

describe("voz (ElevenLabs)", () => {
  const VOZ = "sk_teste_1234567890abcd";
  const chaveVoz = () => chave({ provedor: "elevenlabs", modelo: "", chave: VOZ });

  it("listar os modelos da voz dá provedor_nao_permitido, sem ler a chave", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    const r = await listarModelosDaChaveLogica(ctx, { finalidade: "voz" }, { fetch });
    expect(r).toMatchObject({ ok: false, erro: "provedor_nao_permitido" });
    expect(dubles.lerChaveIA).not.toHaveBeenCalled();
    expect(chamadas).toHaveLength(0);
  });

  it("trocar o modelo da voz dá provedor_nao_permitido, sem chamar o provedor nem gravar", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    const r = await trocarModeloIALogica(
      ctx,
      { finalidade: "voz", modelo: "eleven_multilingual_v2" },
      { fetch },
    );
    expect(r).toMatchObject({ ok: false, erro: "provedor_nao_permitido" });
    expect(chamadas).toHaveLength(0);
    expect(dubles.lerChaveIA).not.toHaveBeenCalled();
    expect(dubles.banco.gravarModeloChave).not.toHaveBeenCalled();
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
  });

  it("revalidar a chave de voz: 200 volta para ativa pela ElevenLabs", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({
      status: 200,
      corpo: { subscription: { character_limit: 10000, character_count: 10 } },
    });
    const r = await revalidarChaveIALogica(ctx, { finalidade: "voz" }, { fetch });
    // sem voz escolhida: só o GET /v1/user (P12 da spec do uso da voz)
    expect(r).toEqual({
      ok: true,
      status: "ativa",
      provedor: "elevenlabs",
      modelo: "",
      voz: "sem_voz",
    });
    expect(dubles.lerChaveIA).toHaveBeenCalledWith("voz");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("https://api.elevenlabs.io/v1/user");
    expect((chamadas[0]?.init.headers as Record<string, string>)["xi-api-key"]).toBe(VOZ);
    expect(dubles.banco.gravarStatusChave).toHaveBeenCalledWith(CHAVE_ID, "ativa", null);
    semCredenciais(r, VOZ);
  });

  it("revalidar a chave de voz: 401 marca invalida", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    const { ctx } = contexto();
    const r = await revalidarChaveIALogica(
      ctx,
      { finalidade: "voz" },
      fetchFalso({ status: 401, corpo: { detail: { status: "invalid_api_key" } } }),
    );
    expect(r).toMatchObject({ ok: false, erro: "chave_invalida", status: "invalida" });
    expect(dubles.banco.gravarStatusChave).toHaveBeenCalledWith(
      CHAVE_ID,
      "invalida",
      "chave_invalida",
    );
    semCredenciais(r, VOZ);
  });

  it("revalidar a chave de voz: a conta sem crédito marca sem_credito", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    const { ctx } = contexto();
    const r = await revalidarChaveIALogica(
      ctx,
      { finalidade: "voz" },
      fetchFalso({
        status: 200,
        corpo: {
          subscription: { character_limit: 10000, character_count: 10000, max_credit_limit_extension: 0 },
        },
      }),
    );
    expect(r).toMatchObject({ ok: false, erro: "sem_credito", status: "sem_credito" });
    expect(dubles.banco.gravarStatusChave).toHaveBeenCalledWith(CHAVE_ID, "sem_credito", "sem_credito");
    semCredenciais(r, VOZ);
  });
});

// ---------- voz em uso (docs/spec-voz-uso.md, aceite da C2) ----------

describe("voz em uso", () => {
  const VOZ = "sk_teste_voz_em_uso_QAZWSX0987";
  const chaveVoz = () => chave({ provedor: "elevenlabs", modelo: "", chave: VOZ });
  const USUARIO_OK = {
    status: 200,
    corpo: { subscription: { character_limit: 10000, character_count: 10 } },
  };
  const ANA = { id: "voz_Ana-01", nome: "Ana" };
  const configCom = (o: Partial<{ modo: string; voz: unknown; erro: unknown }> = {}) => ({
    modo: "quando_audio",
    voz: ANA,
    erro: null,
    ...o,
  });

  it("sem admin, as 3 funções dão sem_acesso sem nenhum pedido nem leitura", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    const { ctx } = contexto({ admin: false });
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    const sem = { ok: false, erro: "sem_acesso" };
    expect(await listarVozesLogica(ctx, { fetch })).toEqual(sem);
    expect(await escolherVozLogica(ctx, { vozId: "voz_Ana-01" }, { fetch })).toEqual(sem);
    expect(await salvarModoVozLogica(ctx, { modo: "sempre" })).toEqual(sem);
    expect(chamadas).toHaveLength(0);
    expect(dubles.lerChaveIA).not.toHaveBeenCalled();
    expect(dubles.banco.lerConfigVozTela).not.toHaveBeenCalled();
    expect(dubles.banco.gravarVoz).not.toHaveBeenCalled();
    expect(dubles.banco.gravarModoVoz).not.toHaveBeenCalled();
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
  });

  it("listarVozes devolve as vozes da conta e a atual da tabela, sem gravar nada", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerConfigVozTela.mockResolvedValue(configCom());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({
      status: 200,
      corpo: {
        voices: [
          { voice_id: "voz_Bia-02", name: "Bia", verified_languages: [{ language: "pt" }] },
        ],
        has_more: false,
      },
    });
    const r = await listarVozesLogica(ctx, { fetch });
    expect(r).toEqual({
      ok: true,
      vozes: [{ id: "voz_Bia-02", nome: "Bia", detalhe: null, portugues: true, previa: null }],
      atual: ANA,
    });
    expect(dubles.lerChaveIA).toHaveBeenCalledWith("voz");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toContain("https://api.elevenlabs.io/v2/voices?page_size=100");
    for (const f of [
      dubles.banco.gravarVoz,
      dubles.banco.gravarModoVoz,
      dubles.banco.gravarErroVoz,
      dubles.banco.gravarStatusChave,
      dubles.banco.auditar,
    ]) {
      expect(f).not.toHaveBeenCalled();
    }
    semCredenciais(r, VOZ);
  });

  it("listarVozes: sem chave dá sem_chave; falha ao ler a voz dá erro_ao_ler; falha da ElevenLabs volta como veio", async () => {
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 401, corpo: {} });
    expect(await listarVozesLogica(ctx, { fetch })).toEqual({ ok: false, erro: "sem_chave" });

    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerConfigVozTela.mockRejectedValueOnce(new Error("banco_ler_voz"));
    expect(await listarVozesLogica(ctx, { fetch })).toEqual({ ok: false, erro: "erro_ao_ler" });
    expect(chamadas).toHaveLength(0);

    const r = await listarVozesLogica(ctx, { fetch });
    expect(r).toMatchObject({ ok: false, erro: "chave_invalida" });
    semCredenciais(r, VOZ);
  });

  it("escolherVoz confere na ElevenLabs e grava o nome que veio de lá, depois audita", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.gravarVoz.mockResolvedValue({ id: "voz_Velha", nome: "Velha" });
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({
      status: 200,
      corpo: { voice_id: "voz_Ana-01", name: "  Ana da ElevenLabs  " },
    });
    const r = await escolherVozLogica(ctx, { vozId: "voz_Ana-01" }, { fetch });
    expect(r).toEqual({ ok: true, voz: { id: "voz_Ana-01", nome: "Ana da ElevenLabs" } });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("https://api.elevenlabs.io/v1/voices/voz_Ana-01");
    expect((chamadas[0]?.init.headers as Record<string, string>)["xi-api-key"]).toBe(VOZ);
    expect(dubles.banco.gravarVoz).toHaveBeenCalledWith({
      id: "voz_Ana-01",
      nome: "Ana da ElevenLabs",
    });
    expect(dubles.banco.auditar).toHaveBeenCalledWith({
      acao: "voz_alterada",
      ator_membro_id: MEMBRO,
      detalhe: { voz_nome: "Ana da ElevenLabs", voz_nome_anterior: "Velha" },
    });
    // a auditoria só depois da gravação
    expect(dubles.banco.gravarVoz.mock.invocationCallOrder[0]!).toBeLessThan(
      dubles.banco.auditar.mock.invocationCallOrder[0]!,
    );
    semCredenciais(r, VOZ);
  });

  it("escolherVoz: o 404 dá voz_nao_encontrada e não grava nem audita", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    const { ctx } = contexto();
    const r = await escolherVozLogica(
      ctx,
      { vozId: "voz_Sumiu" },
      fetchFalso({ status: 404, corpo: { detail: { status: "voice_not_found" } } }),
    );
    expect(r).toMatchObject({ ok: false, erro: "voz_nao_encontrada" });
    expect(dubles.banco.gravarVoz).not.toHaveBeenCalled();
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
    semCredenciais(r, VOZ);
  });

  it("escolherVoz: falha ao gravar dá erro_ao_gravar sem auditoria; sem chave não chama a ElevenLabs", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.gravarVoz.mockRejectedValue(new Error("banco_gravar_voz"));
    const { ctx } = contexto();
    const ok = fetchFalso({ status: 200, corpo: { voice_id: "voz_Ana-01", name: "Ana" } });
    expect(await escolherVozLogica(ctx, { vozId: "voz_Ana-01" }, ok)).toMatchObject({
      ok: false,
      erro: "erro_ao_gravar",
    });
    expect(dubles.banco.auditar).not.toHaveBeenCalled();

    dubles.lerChaveIA.mockResolvedValue(null);
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    expect(await escolherVozLogica(ctx, { vozId: "voz_Ana-01" }, { fetch })).toEqual({
      ok: false,
      erro: "sem_chave",
    });
    expect(chamadas).toHaveLength(0);
  });

  it("salvarModoVoz grava o modo e audita com o anterior, sem falar com a ElevenLabs", async () => {
    dubles.banco.gravarModoVoz.mockResolvedValue("quando_audio");
    const { ctx } = contexto();
    expect(await salvarModoVozLogica(ctx, { modo: "sempre" })).toEqual({ ok: true, modo: "sempre" });
    expect(dubles.lerChaveIA).not.toHaveBeenCalled();
    expect(dubles.banco.gravarModoVoz).toHaveBeenCalledWith("sempre");
    expect(dubles.banco.auditar).toHaveBeenCalledWith({
      acao: "voz_alterada",
      ator_membro_id: MEMBRO,
      detalhe: { modo: "sempre", modo_anterior: "quando_audio" },
    });
    expect(dubles.banco.gravarModoVoz.mock.invocationCallOrder[0]!).toBeLessThan(
      dubles.banco.auditar.mock.invocationCallOrder[0]!,
    );

    dubles.banco.auditar.mockClear();
    dubles.banco.gravarModoVoz.mockRejectedValue(new Error("banco_gravar_modo_voz"));
    expect(await salvarModoVozLogica(ctx, { modo: "nunca" })).toMatchObject({
      ok: false,
      erro: "erro_ao_gravar",
    });
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
  });

  it("revalidar com voz: 2 pedidos, a voz existe e o voz_erro gravado é limpo", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerConfigVozTela.mockResolvedValue(configCom({ erro: "voz_nao_encontrada" }));
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK, {
      status: 200,
      corpo: { voice_id: "voz_Ana-01", name: "Ana" },
    });
    const r = await revalidarChaveIALogica(ctx, { finalidade: "voz" }, { fetch });
    expect(r).toEqual({ ok: true, status: "ativa", provedor: "elevenlabs", modelo: "", voz: "ok" });
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://api.elevenlabs.io/v1/user",
      "https://api.elevenlabs.io/v1/voices/voz_Ana-01",
    ]);
    expect(dubles.banco.gravarErroVoz).toHaveBeenCalledWith("voz_Ana-01", null);
    semCredenciais(r, VOZ);
  });

  it("revalidar com voz que sumiu: 2 pedidos, nao_encontrada e o voz_erro gravado", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerConfigVozTela.mockResolvedValue(configCom());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK, { status: 404, corpo: {} });
    const r = await revalidarChaveIALogica(ctx, { finalidade: "voz" }, { fetch });
    expect(r).toMatchObject({ ok: true, status: "ativa", voz: "nao_encontrada" });
    expect(chamadas).toHaveLength(2);
    expect(dubles.banco.gravarErroVoz).toHaveBeenCalledWith("voz_Ana-01", "voz_nao_encontrada");
    // a chave continua ativa: a voz que sumiu não muda o status da chave
    expect(dubles.banco.gravarStatusChave).toHaveBeenCalledWith(CHAVE_ID, "ativa", null);
    semCredenciais(r, VOZ);
  });

  it("revalidar sem voz: 1 pedido e voz sem_voz; o erro já gravado não é regravado", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    const r = await revalidarChaveIALogica(ctx, { finalidade: "voz" }, { fetch });
    expect(r).toMatchObject({ ok: true, voz: "sem_voz" });
    expect(chamadas).toHaveLength(1);
    expect(dubles.banco.gravarErroVoz).not.toHaveBeenCalled();

    // voz que continua sumida: o erro já está lá, não grava de novo
    dubles.banco.lerConfigVozTela.mockResolvedValue(configCom({ erro: "voz_nao_encontrada" }));
    const r2 = await revalidarChaveIALogica(
      ctx,
      { finalidade: "voz" },
      fetchFalso(USUARIO_OK, { status: 404, corpo: {} }),
    );
    expect(r2).toMatchObject({ ok: true, voz: "nao_encontrada" });
    expect(dubles.banco.gravarErroVoz).not.toHaveBeenCalled();
  });

  it("revalidar: a ElevenLabs fora na 2ª conferência não muda o voz_erro e a resposta sai sem voz", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerConfigVozTela.mockResolvedValue(configCom());
    const { ctx } = contexto();
    const r = await revalidarChaveIALogica(
      ctx,
      { finalidade: "voz" },
      fetchFalso(USUARIO_OK, { status: 500, corpo: {} }),
    );
    expect(r).toEqual({ ok: true, status: "ativa", provedor: "elevenlabs", modelo: "" });
    expect(dubles.banco.gravarErroVoz).not.toHaveBeenCalled();
  });

  it("revalidar: a chave recusada não confere a voz; outra finalidade não lê a voz", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerConfigVozTela.mockResolvedValue(configCom());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso({ status: 401, corpo: {} }, { status: 200, corpo: {} });
    await revalidarChaveIALogica(ctx, { finalidade: "voz" }, { fetch });
    expect(chamadas).toHaveLength(1);
    expect(dubles.banco.lerConfigVozTela).not.toHaveBeenCalled();

    dubles.lerChaveIA.mockResolvedValue(chave());
    const r = await revalidarChaveIALogica(
      ctx,
      { finalidade: "resposta" },
      fetchFalso({ status: 200, corpo: { id: "gpt-5.5-mini" } }),
    );
    expect(r).not.toHaveProperty("voz");
    expect(dubles.banco.lerConfigVozTela).not.toHaveBeenCalled();
    // só a chave da ElevenLabs olha o último erro (P11 da spec da escuta)
    expect(dubles.banco.lerResumoChaveIA).not.toHaveBeenCalledWith("resposta");
  });

  const resumoVoz = (status: string, ultimo_erro: string | null) => ({
    id: CHAVE_ID,
    provedor: "elevenlabs",
    modelo: "",
    workspace_id: null,
    status,
    ultimos4: "0987",
    ultimo_erro,
    temChave: true,
  });

  it("revalidar: a chave invalida por falta de acesso não volta a ativa, mesmo com o GET /v1/user 200", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerResumoChaveIA.mockResolvedValue(resumoVoz("invalida", "sem_permissao"));
    dubles.banco.lerConfigVozTela.mockResolvedValue(configCom());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK, { status: 200, corpo: {} });
    const r = await revalidarChaveIALogica(ctx, { finalidade: "voz" }, { fetch });
    expect(r).toEqual({
      ok: false,
      erro: "sem_permissao",
      mensagem:
        "A chave existe, mas não tem os acessos que a Janete usa. Na ElevenLabs, edite a chave e ligue User, Text to Speech, Speech to Text e Voices.",
      status: "invalida",
    });
    expect(dubles.banco.lerResumoChaveIA).toHaveBeenCalledWith("voz");
    // nada muda: nem o status, nem a voz (só o GET /v1/user saiu)
    expect(dubles.banco.gravarStatusChave).not.toHaveBeenCalled();
    expect(dubles.banco.lerConfigVozTela).not.toHaveBeenCalled();
    expect(dubles.banco.gravarErroVoz).not.toHaveBeenCalled();
    expect(chamadas).toHaveLength(1);
    semCredenciais(r, VOZ);
  });

  it("revalidar: a chave invalida comum (http_401) volta a ativa como antes", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerResumoChaveIA.mockResolvedValue(resumoVoz("invalida", "http_401"));
    const { ctx } = contexto();
    const r = await revalidarChaveIALogica(ctx, { finalidade: "voz" }, fetchFalso(USUARIO_OK));
    expect(r).toEqual({ ok: true, status: "ativa", provedor: "elevenlabs", modelo: "", voz: "sem_voz" });
    expect(dubles.banco.gravarStatusChave).toHaveBeenCalledWith(CHAVE_ID, "ativa", null);

    // o sem_permissao com a chave já ativa (salva de novo) também segue normal
    dubles.banco.gravarStatusChave.mockClear();
    dubles.banco.lerResumoChaveIA.mockResolvedValue(resumoVoz("ativa", "sem_permissao"));
    const r2 = await revalidarChaveIALogica(ctx, { finalidade: "voz" }, fetchFalso(USUARIO_OK));
    expect(r2).toMatchObject({ ok: true, status: "ativa" });
    expect(dubles.banco.gravarStatusChave).toHaveBeenCalledWith(CHAVE_ID, "ativa", null);
  });

  it("revalidar: sem conseguir ler o último erro, a chave da voz não volta a ativa", async () => {
    dubles.lerChaveIA.mockResolvedValue(chaveVoz());
    dubles.banco.lerResumoChaveIA.mockRejectedValue(new Error("banco_ler_chave"));
    const { ctx } = contexto();
    const r = await revalidarChaveIALogica(ctx, { finalidade: "voz" }, fetchFalso(USUARIO_OK));
    expect(r).toEqual({ ok: false, erro: "erro_ao_ler" });
    expect(dubles.banco.gravarStatusChave).not.toHaveBeenCalled();
  });
});

// ---------- a ElevenLabs nos dois cartões (docs/spec-escuta-elevenlabs.md, S2 e S4) ----------

describe("a chave da ElevenLabs na escuta", () => {
  const ELEVEN = "sk_teste_escuta_e_voz_PLMOKN1357";
  const ESCUTA_ID = "e5c07a00-0000-4000-8000-0000000000cc";
  const USUARIO_OK = {
    status: 200,
    corpo: { subscription: { character_limit: 10000, character_count: 10 } },
  };
  const chaveEleven = (o: Partial<ChaveIA> = {}) =>
    chave({ provedor: "elevenlabs", modelo: "", chave: ELEVEN, ...o });
  /** A origem da cópia: só a linha pedida tem a chave. */
  const origemEm = (finalidade: string, k: ChaveIA) =>
    dubles.lerChaveIA.mockImplementation(async (f: string) => (f === finalidade ? k : null));
  const resumo = (o: Record<string, unknown> = {}) => ({
    id: ESCUTA_ID,
    provedor: "elevenlabs",
    modelo: "scribe_v2",
    workspace_id: null,
    status: "ativa",
    ultimos4: "1357",
    ultimo_erro: null,
    temChave: true,
    ...o,
  });

  it("sem admin dá sem_acesso, sem ler a chave, sem pedido nem gravação", async () => {
    origemEm("voz", chaveEleven());
    const { ctx } = contexto({ admin: false });
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    const r = await usarChaveElevenLabsLogica(ctx, { para: "transcricao" }, { fetch });
    expect(r).toEqual({ ok: false, erro: "sem_acesso" });
    expect(dubles.lerChaveIA).not.toHaveBeenCalled();
    expect(dubles.banco.lerResumoChaveIA).not.toHaveBeenCalled();
    expect(chamadas).toHaveLength(0);
    expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
  });

  it("na escuta: copia a chave da voz, confere de novo e grava com o scribe_v2", async () => {
    origemEm("voz", chaveEleven());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    const r = await usarChaveElevenLabsLogica(ctx, { para: "transcricao" }, { fetch });
    expect(r).toEqual({ ok: true, copiada: true, ultimos4: "1357", status: "ativa" });
    expect(dubles.lerChaveIA).toHaveBeenCalledWith("voz");
    expect(dubles.lerChaveIA).not.toHaveBeenCalledWith("transcricao");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("https://api.elevenlabs.io/v1/user");
    expect((chamadas[0]?.init.headers as Record<string, string>)["xi-api-key"]).toBe(ELEVEN);
    expect(dubles.gravarChaveIA).toHaveBeenCalledTimes(1);
    expect(dubles.gravarChaveIA).toHaveBeenCalledWith({
      finalidade: "transcricao",
      provedor: "elevenlabs",
      modelo: "scribe_v2",
      workspace_id: null,
      chave: ELEVEN,
      membroId: MEMBRO,
    });
    // sem seLivre, o destino não é lido: a cópia substitui (P7)
    expect(dubles.banco.lerResumoChaveIA).not.toHaveBeenCalled();
    // a auditoria sai do gravarChaveIA, não daqui
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(ELEVEN);
  });

  it("na voz: copia a chave da escuta e grava sem modelo", async () => {
    origemEm("transcricao", chaveEleven({ id: ESCUTA_ID, modelo: "scribe_v2" }));
    const { ctx } = contexto();
    const r = await usarChaveElevenLabsLogica(ctx, { para: "voz" }, fetchFalso(USUARIO_OK));
    expect(r).toEqual({ ok: true, copiada: true, ultimos4: "1357", status: "ativa" });
    expect(dubles.lerChaveIA).toHaveBeenCalledWith("transcricao");
    expect(dubles.lerChaveIA).not.toHaveBeenCalledWith("voz");
    expect(dubles.gravarChaveIA).toHaveBeenCalledWith({
      finalidade: "voz",
      provedor: "elevenlabs",
      modelo: "",
      workspace_id: null,
      chave: ELEVEN,
      membroId: MEMBRO,
    });
    expect(JSON.stringify(r)).not.toContain(ELEVEN);
  });

  it("a origem sem chave devolve a falta, sem pedido nem gravação", async () => {
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    expect(await usarChaveElevenLabsLogica(ctx, { para: "transcricao" }, { fetch })).toEqual({
      ok: false,
      erro: "sem_chave",
    });
    expect(dubles.lerChaveIA).toHaveBeenCalledWith("voz");

    dubles.lerChaveIA.mockRejectedValue(new Error("cifra_invalida"));
    expect(await usarChaveElevenLabsLogica(ctx, { para: "voz" }, { fetch })).toEqual({
      ok: false,
      erro: "cifra_invalida",
    });
    expect(chamadas).toHaveLength(0);
    expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
  });

  it("a origem de outro provedor dá provedor_nao_permitido, sem pedido nem gravação", async () => {
    origemEm("transcricao", chave({ provedor: "groq", modelo: "whisper-large-v3-turbo", chave: GROQ }));
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    const r = await usarChaveElevenLabsLogica(ctx, { para: "voz" }, { fetch });
    expect(r).toEqual({
      ok: false,
      erro: "provedor_nao_permitido",
      mensagem: "A chave do outro cartão não é da ElevenLabs.",
    });
    expect(chamadas).toHaveLength(0);
    expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    semCredenciais(r, GROQ);
  });

  it("a conferência recusa: a falha volta e nada é gravado", async () => {
    origemEm("voz", chaveEleven());
    const { ctx } = contexto();
    const recusada = await usarChaveElevenLabsLogica(
      ctx,
      { para: "transcricao" },
      fetchFalso({ status: 401, corpo: { detail: { status: "invalid_api_key", message: ELEVEN } } }),
    );
    expect(recusada).toMatchObject({ ok: false, erro: "chave_invalida" });
    semCredenciais(recusada, ELEVEN);

    const semCredito = await usarChaveElevenLabsLogica(
      ctx,
      { para: "transcricao" },
      fetchFalso({
        status: 200,
        corpo: {
          subscription: { character_limit: 10000, character_count: 10000, max_credit_limit_extension: 0 },
        },
      }),
    );
    expect(semCredito).toMatchObject({ ok: false, erro: "sem_credito" });
    expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    // a marca não cai em nenhuma das duas linhas
    expect(dubles.banco.gravarStatusChave).not.toHaveBeenCalled();
  });

  it("a gravação falha: o código da gravação com o texto da spec, sem a chave", async () => {
    origemEm("voz", chaveEleven());
    const { ctx } = contexto();
    dubles.gravarChaveIA.mockRejectedValueOnce(new Error("cifra_indisponivel"));
    const semCifra = await usarChaveElevenLabsLogica(ctx, { para: "transcricao" }, fetchFalso(USUARIO_OK));
    expect(semCifra).toEqual({
      ok: false,
      erro: "cifra_indisponivel",
      mensagem: "Não conseguimos usar a chave agora. Tente de novo em instantes.",
    });
    dubles.gravarChaveIA.mockRejectedValueOnce(new Error("banco_gravar_chave"));
    const semBanco = await usarChaveElevenLabsLogica(ctx, { para: "transcricao" }, fetchFalso(USUARIO_OK));
    expect(semBanco).toEqual({
      ok: false,
      erro: "erro_ao_gravar",
      mensagem: "Não conseguimos usar a chave agora. Tente de novo em instantes.",
    });
    semCredenciais([semCifra, semBanco], ELEVEN);
  });

  describe("seLivre (onboarding, P8)", () => {
    it("a escuta com a chave da Groq fica: copiada false, sem ler a origem", async () => {
      origemEm("voz", chaveEleven());
      dubles.banco.lerResumoChaveIA.mockResolvedValue(
        resumo({ provedor: "groq", modelo: "whisper-large-v3-turbo", ultimos4: "MNBV" }),
      );
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso(USUARIO_OK);
      const r = await usarChaveElevenLabsLogica(ctx, { para: "transcricao", seLivre: true }, { fetch });
      expect(r).toEqual({ ok: true, copiada: false });
      expect(dubles.banco.lerResumoChaveIA).toHaveBeenCalledWith("transcricao");
      expect(dubles.lerChaveIA).not.toHaveBeenCalled();
      expect(chamadas).toHaveLength(0);
      expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    });

    it.each([
      ["vazia (nunca cadastrada)", null],
      ["removida", { provedor: "openai", modelo: "gpt-transcribe", status: "removida", ultimos4: null, temChave: false }],
      ["com outra chave da ElevenLabs", { ultimos4: "9999" }],
    ] as const)("a escuta %s: copia", async (_nome, destino) => {
      origemEm("voz", chaveEleven());
      dubles.banco.lerResumoChaveIA.mockResolvedValue(destino === null ? null : resumo(destino));
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso(USUARIO_OK);
      const r = await usarChaveElevenLabsLogica(ctx, { para: "transcricao", seLivre: true }, { fetch });
      expect(r).toEqual({ ok: true, copiada: true, ultimos4: "1357", status: "ativa" });
      expect(chamadas).toHaveLength(1);
      expect(dubles.gravarChaveIA).toHaveBeenCalledWith(
        expect.objectContaining({ finalidade: "transcricao", provedor: "elevenlabs", modelo: "scribe_v2" }),
      );
      expect(JSON.stringify(r)).not.toContain(ELEVEN);
    });

    it("a escuta já com a mesma chave: copiada false, sem pedido nem gravação", async () => {
      origemEm("voz", chaveEleven());
      dubles.banco.lerResumoChaveIA.mockResolvedValue(resumo());
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso(USUARIO_OK);
      const r = await usarChaveElevenLabsLogica(ctx, { para: "transcricao", seLivre: true }, { fetch });
      expect(r).toEqual({ ok: true, copiada: false });
      expect(chamadas).toHaveLength(0);
      expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    });

    it("a escuta com a mesma chave, mas inválida: confere e grava de novo (o Trocar chave a reativa)", async () => {
      origemEm("voz", chaveEleven());
      dubles.banco.lerResumoChaveIA.mockResolvedValue(resumo({ status: "invalida", ultimo_erro: "sem_permissao" }));
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso(USUARIO_OK);
      const r = await usarChaveElevenLabsLogica(ctx, { para: "transcricao", seLivre: true }, { fetch });
      expect(r).toEqual({ ok: true, copiada: true, ultimos4: "1357", status: "ativa" });
      expect(chamadas).toHaveLength(1);
      expect(dubles.gravarChaveIA).toHaveBeenCalledWith(
        expect.objectContaining({ finalidade: "transcricao", provedor: "elevenlabs", modelo: "scribe_v2" }),
      );
    });

    it("sem conseguir ler o destino: erro_ao_ler, sem ler a origem nem gravar", async () => {
      origemEm("voz", chaveEleven());
      dubles.banco.lerResumoChaveIA.mockRejectedValue(new Error("banco_ler_chave"));
      const { ctx } = contexto();
      const { fetch, chamadas } = fetchFalso(USUARIO_OK);
      const r = await usarChaveElevenLabsLogica(ctx, { para: "transcricao", seLivre: true }, { fetch });
      expect(r).toEqual({ ok: false, erro: "erro_ao_ler" });
      expect(dubles.lerChaveIA).not.toHaveBeenCalled();
      expect(chamadas).toHaveLength(0);
      expect(dubles.gravarChaveIA).not.toHaveBeenCalled();
    });
  });

  // ---------- S4: modelo e "Conferir tudo" ----------

  it("trocar o modelo da escuta pela ElevenLabs é recusado, sem pedido nem gravação", async () => {
    origemEm("transcricao", chaveEleven({ modelo: "scribe_v2" }));
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    const r = await trocarModeloIALogica(
      ctx,
      { finalidade: "transcricao", modelo: "scribe_v1" },
      { fetch },
    );
    expect(r).toEqual({
      ok: false,
      erro: "provedor_nao_permitido",
      mensagem: "A escuta pela ElevenLabs não tem modelo para trocar.",
    });
    expect(chamadas).toHaveLength(0);
    expect(dubles.banco.gravarModeloChave).not.toHaveBeenCalled();
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
  });

  it("listar os modelos da escuta pela ElevenLabs continua recusando, sem pedido", async () => {
    origemEm("transcricao", chaveEleven({ modelo: "scribe_v2" }));
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    const r = await listarModelosDaChaveLogica(ctx, { finalidade: "transcricao" }, { fetch });
    expect(r).toEqual({ ok: false, erro: "provedor_nao_permitido" });
    expect(chamadas).toHaveLength(0);
  });

  it("revalidar a escuta pela ElevenLabs: o sem_permissao fica invalida, sem conferir a voz", async () => {
    origemEm("transcricao", chaveEleven({ id: ESCUTA_ID, modelo: "scribe_v2" }));
    dubles.banco.lerResumoChaveIA.mockResolvedValue(
      resumo({ status: "invalida", ultimo_erro: "sem_permissao" }),
    );
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK);
    const r = await revalidarChaveIALogica(ctx, { finalidade: "transcricao" }, { fetch });
    expect(r).toEqual({
      ok: false,
      erro: "sem_permissao",
      mensagem:
        "A chave existe, mas não tem os acessos que a Janete usa. Na ElevenLabs, edite a chave e ligue User, Text to Speech, Speech to Text e Voices.",
      status: "invalida",
    });
    expect(dubles.banco.lerResumoChaveIA).toHaveBeenCalledWith("transcricao");
    expect(dubles.banco.lerResumoChaveIA).not.toHaveBeenCalledWith("voz");
    expect(dubles.banco.gravarStatusChave).not.toHaveBeenCalled();
    expect(dubles.banco.lerConfigVozTela).not.toHaveBeenCalled();
    expect(chamadas).toHaveLength(1);
    semCredenciais(r, ELEVEN);
  });

  it("revalidar a escuta pela ElevenLabs ativa: volta ativa na própria linha, sem conferir a voz", async () => {
    origemEm("transcricao", chaveEleven({ id: ESCUTA_ID, modelo: "scribe_v2" }));
    dubles.banco.lerResumoChaveIA.mockResolvedValue(resumo());
    const { ctx } = contexto();
    const { fetch, chamadas } = fetchFalso(USUARIO_OK, { status: 200, corpo: {} });
    const r = await revalidarChaveIALogica(ctx, { finalidade: "transcricao" }, { fetch });
    expect(r).toEqual({ ok: true, status: "ativa", provedor: "elevenlabs", modelo: "scribe_v2" });
    expect(dubles.banco.gravarStatusChave).toHaveBeenCalledWith(ESCUTA_ID, "ativa", null);
    expect(dubles.banco.lerConfigVozTela).not.toHaveBeenCalled();
    expect(chamadas).toHaveLength(1);
  });

  it("remover a escuta pela ElevenLabs apaga só a linha da escuta", async () => {
    dubles.banco.lerResumoChaveIA.mockResolvedValue(resumo());
    const { ctx } = contexto();
    expect(await removerChaveIALogica(ctx, { finalidade: "transcricao" })).toEqual({ ok: true });
    expect(dubles.banco.lerResumoChaveIA).toHaveBeenCalledWith("transcricao");
    expect(dubles.banco.lerResumoChaveIA).not.toHaveBeenCalledWith("voz");
    expect(dubles.banco.apagarChave).toHaveBeenCalledTimes(1);
    expect(dubles.banco.apagarChave).toHaveBeenCalledWith(ESCUTA_ID, MEMBRO);
  });
});

// ---------- salvarRitmo ----------

describe("salvarRitmo", () => {
  it("sem admin dá sem_acesso", async () => {
    const { ctx } = contexto({ admin: false });
    expect(await salvarRitmoLogica(ctx, { espera: 8, teto: 60 })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(dubles.banco.gravarRitmo).not.toHaveBeenCalled();
  });

  it("grava dentro dos limites", async () => {
    const { ctx } = contexto();
    expect(await salvarRitmoLogica(ctx, { espera: 8, teto: 60 })).toEqual({
      ok: true,
      espera: 8,
      teto: 60,
    });
    expect(dubles.banco.gravarRitmo).toHaveBeenCalledWith(8, 60);
  });

  it("grava a auditoria ritmo_alterado com o ritmo novo e o anterior", async () => {
    const { ctx } = contexto();
    dubles.banco.gravarRitmo.mockResolvedValueOnce({ espera: 5, teto: 40 });
    await salvarRitmoLogica(ctx, { espera: 8, teto: 60 });
    expect(dubles.banco.auditar).toHaveBeenCalledWith({
      acao: "ritmo_alterado",
      ator_membro_id: MEMBRO,
      detalhe: { espera: 8, teto: 60, espera_anterior: 5, teto_anterior: 40 },
    });

    // sem o anterior (a leitura de antes falhou), audita com nulos
    dubles.banco.auditar.mockClear();
    dubles.banco.gravarRitmo.mockResolvedValueOnce(null);
    await salvarRitmoLogica(ctx, { espera: 8, teto: 60 });
    expect(dubles.banco.auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "ritmo_alterado",
        detalhe: { espera: 8, teto: 60, espera_anterior: null, teto_anterior: null },
      }),
    );

    // falha ao gravar: sem auditoria
    dubles.banco.auditar.mockClear();
    dubles.banco.gravarRitmo.mockRejectedValueOnce(new Error("banco_gravar_ritmo"));
    await salvarRitmoLogica(ctx, { espera: 8, teto: 60 });
    expect(dubles.banco.auditar).not.toHaveBeenCalled();
  });

  it("limites: espera de 2 a 30, teto de 20 a 120 e teto ≥ espera + 5", () => {
    expect(foraDoRitmo({ espera: 2, teto: 20 })).toBeNull();
    expect(foraDoRitmo({ espera: 30, teto: 120 })).toBeNull();
    expect(foraDoRitmo({ espera: 20, teto: 25 })).toBeNull();
    expect(foraDoRitmo({ espera: 1, teto: 60 })).toBe("espera");
    expect(foraDoRitmo({ espera: 31, teto: 60 })).toBe("espera");
    expect(foraDoRitmo({ espera: 2.5, teto: 60 })).toBe("espera");
    expect(foraDoRitmo({ espera: 8, teto: 19 })).toBe("teto");
    expect(foraDoRitmo({ espera: 8, teto: 121 })).toBe("teto");
    expect(foraDoRitmo({ espera: 20, teto: 24 })).toBe("teto");
  });

  it("fora do limite não grava; falha ao gravar dá erro_ao_gravar", async () => {
    const { ctx } = contexto();
    expect(await salvarRitmoLogica(ctx, { espera: 20, teto: 24 })).toEqual({
      ok: false,
      erro: "fora_do_limite",
      campo: "teto",
    });
    expect(dubles.banco.gravarRitmo).not.toHaveBeenCalled();
    dubles.banco.gravarRitmo.mockRejectedValue(new Error("banco_gravar_ritmo"));
    expect(await salvarRitmoLogica(ctx, { espera: 8, teto: 60 })).toEqual({
      ok: false,
      erro: "erro_ao_gravar",
    });
  });
});
