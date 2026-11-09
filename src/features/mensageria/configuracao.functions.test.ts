import { beforeEach, describe, expect, it, vi } from "vitest";

// createServerFn falso: guarda o validator e o handler e devolve uma função que roda os dois
// com o contexto que o teste definir (o que o requireFirebaseAuth poria lá).
const estado = vi.hoisted(() => ({
  contexto: {} as Record<string, unknown>,
  pedido: null as Request | null,
  salvarConexaoLogica: vi.fn(),
  acordarMotor: vi.fn(),
  acoes: {
    desconectarConexaoLogica: vi.fn(),
    conferirConexaoLogica: vi.fn(),
    consertarCampoConexaoLogica: vi.fn(),
    revalidarChaveIALogica: vi.fn(),
    listarModelosDaChaveLogica: vi.fn(),
    trocarModeloIALogica: vi.fn(),
    removerChaveIALogica: vi.fn(),
    salvarRitmoLogica: vi.fn(),
    listarVozesLogica: vi.fn(),
    escolherVozLogica: vi.fn(),
    salvarModoVozLogica: vi.fn(),
    usarChaveElevenLabsLogica: vi.fn(),
  },
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validar: (d: unknown) => unknown = (d) => d;
    const construtor = {
      middleware: () => construtor,
      validator: (v: (d: unknown) => unknown) => {
        validar = v;
        return construtor;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) => async (o: { data: unknown }) =>
          h({ data: validar(o.data), context: estado.contexto }),
    };
    return construtor;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!estado.pedido) throw new Error("sem pedido");
    return estado.pedido;
  },
}));
vi.mock("@/integrations/firebase/auth-middleware", () => ({ requireFirebaseAuth: {} }));
vi.mock("@/integrations/firebase/config.server", () => ({ getInstallationConfig: async () => ({ publicUrl: process.env["JANETE_PUBLIC_URL"] || "" }) }));
vi.mock("@/integrations/firebase/client.server", () => ({ firebaseAdmin: {} }));
vi.mock("./configuracao.server", () => ({ salvarConexaoLogica: estado.salvarConexaoLogica }));
vi.mock("./configuracao/acoes.server", () => estado.acoes);
vi.mock("./nucleo/motor.server", () => ({ acordarMotor: estado.acordarMotor }));

import {
  conferirConexao,
  consertarCampoConexao,
  desconectarConexao,
  escolherVoz,
  lerEntradaConsertarCampo,
  lerEntradaEscolherVoz,
  lerEntradaFinalidade,
  lerEntradaModoVoz,
  lerEntradaRitmo,
  lerEntradaSalvarChaveIA,
  lerEntradaTrocarModelo,
  lerEntradaUsarChaveElevenLabs,
  lerEntradaVazia,
  lerEntradaVerSegredo,
  listarModelosDaChave,
  listarVozes,
  origemDoPedido,
  removerChaveIA,
  revalidarChaveIA,
  salvarConexao,
  salvarModoVoz,
  salvarRitmo,
  trocarModeloIA,
  usarChaveElevenLabs,
} from "./configuracao.functions";

type Chamavel = (o: { data: unknown }) => Promise<unknown>;

const ID = "c0ffee00-0000-4000-8000-0000000000aa";

beforeEach(() => {
  estado.salvarConexaoLogica.mockReset().mockResolvedValue({ ok: false, erro: "sem_acesso" });
  estado.acordarMotor.mockReset().mockResolvedValue("tocado");
  for (const f of Object.values(estado.acoes))
    f.mockReset().mockResolvedValue({ ok: false, erro: "sem_acesso" });
  estado.pedido = null;
  estado.contexto = { firebase: { cliente: "do usuário" }, userId: "user-1" };
});

describe("configuracao.functions", () => {
  it("salvarConexao passa o cliente do usuário e a origem do pedido para a lógica", async () => {
    estado.pedido = new Request("http://localhost:8080/_serverFn/x", {
      method: "POST",
      headers: { origin: "https://ais-dev-abc.us-east1.run.app" },
    });
    const r = await (salvarConexao as unknown as (o: { data: unknown }) => Promise<unknown>)({
      data: { gateway: "zapi", campos: { instanceId: "X" } },
    });
    expect(r).toEqual({ ok: false, erro: "sem_acesso" });
    expect(estado.salvarConexaoLogica).toHaveBeenCalledWith(
      { firebase: { cliente: "do usuário" }, userId: "user-1" },
      { gateway: "zapi", campos: { instanceId: "X" } },
      { origem: "https://ais-dev-abc.us-east1.run.app" },
    );
  });

  it("salvarConexao que ativou: pede o toque com o host do pedido, nunca o Origin", async () => {
    const ok = {
      ok: true,
      conexao_id: ID,
      nome: "Z",
      gateway: "zapi",
      url_webhook: "u",
      avisos: [],
    };
    estado.salvarConexaoLogica.mockResolvedValue(ok);
    estado.pedido = new Request("https://janete.exemplo.com/_serverFn/x", {
      method: "POST",
      headers: { origin: "https://outro.exemplo" },
    });
    const salvar = salvarConexao as unknown as (o: { data: unknown }) => Promise<unknown>;
    const r = await salvar({ data: { gateway: "zapi", campos: { instanceId: "X" } } });
    expect(r).toEqual(ok);
    expect(estado.acordarMotor).toHaveBeenCalledTimes(1);
    expect(estado.acordarMotor).toHaveBeenCalledWith("https://janete.exemplo.com");
    // o toque vem depois de gravar a conexão
    expect(estado.salvarConexaoLogica.mock.invocationCallOrder[0]!).toBeLessThan(
      estado.acordarMotor.mock.invocationCallOrder[0]!,
    );
  });

  it("salvarConexao que não ativou não toca; o toque que lança não muda a resposta", async () => {
    estado.pedido = new Request("https://janete.exemplo.com/_serverFn/x", { method: "POST" });
    const salvar = salvarConexao as unknown as (o: { data: unknown }) => Promise<unknown>;
    expect(await salvar({ data: { gateway: "zapi", campos: { instanceId: "X" } } })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(estado.acordarMotor).not.toHaveBeenCalled();

    const ok = {
      ok: true,
      conexao_id: ID,
      nome: "Z",
      gateway: "zapi",
      url_webhook: "u",
      avisos: [],
    };
    estado.salvarConexaoLogica.mockResolvedValue(ok);
    estado.acordarMotor.mockRejectedValue(new Error("inesperado"));
    expect(await salvar({ data: { gateway: "zapi", campos: { instanceId: "X" } } })).toEqual(ok);
  });

  it("gateway desconhecido é recusado antes da lógica", async () => {
    await expect(
      (salvarConexao as unknown as (o: { data: unknown }) => Promise<unknown>)({
        data: { gateway: "telegram", campos: {} },
      }),
    ).rejects.toThrow(/Pedido inválido/);
    expect(estado.salvarConexaoLogica).not.toHaveBeenCalled();
  });

  it("origem: cabeçalho Origin, senão a URL do pedido", () => {
    const comOrigin = new Request("https://interno/_serverFn", {
      headers: { origin: "https://app.ex.com" },
    });
    expect(origemDoPedido(comOrigin)).toBe("https://app.ex.com");
    const semOrigin = new Request("https://janete.ex.com.br/_serverFn/abc");
    expect(origemDoPedido(semOrigin)).toBe("https://janete.ex.com.br");
    const invalida = new Request("https://janete.ex.com.br/x", { headers: { origin: "null" } });
    expect(origemDoPedido(invalida)).toBe("https://janete.ex.com.br");
  });

  it("lerEntradaSalvarChaveIA confere a forma", () => {
    expect(
      lerEntradaSalvarChaveIA({
        finalidade: "resposta",
        provedor: "anthropic",
        modelo: "claude",
        chave: "sk",
        workspace_id: "  wrkspc_1 ",
      }),
    ).toEqual({
      finalidade: "resposta",
      provedor: "anthropic",
      modelo: "claude",
      chave: "sk",
      workspace_id: "wrkspc_1",
    });
    expect(() =>
      lerEntradaSalvarChaveIA({ finalidade: "x", provedor: "openai", modelo: "m", chave: "k" }),
    ).toThrow();
    expect(() =>
      lerEntradaSalvarChaveIA({ finalidade: "resposta", provedor: "x", modelo: "m", chave: "k" }),
    ).toThrow();
    expect(() =>
      lerEntradaSalvarChaveIA({
        finalidade: "resposta",
        provedor: "openai",
        modelo: "m",
        chave: 1,
      }),
    ).toThrow();
  });

  it("a voz: lerEntradaSalvarChaveIA aceita voz e elevenlabs; lerEntradaFinalidade aceita voz", () => {
    const voz = { finalidade: "voz", provedor: "elevenlabs", modelo: "", chave: "sk_teste_1234567890abcd" };
    expect(lerEntradaSalvarChaveIA(voz)).toEqual(voz);
    expect(lerEntradaFinalidade({ finalidade: "voz" })).toEqual({ finalidade: "voz" });
    // valores parecidos, mas desconhecidos, continuam recusados
    expect(() => lerEntradaSalvarChaveIA({ ...voz, finalidade: "fala" })).toThrow();
    expect(() => lerEntradaSalvarChaveIA({ ...voz, provedor: "eleven_labs" })).toThrow();
    expect(() => lerEntradaSalvarChaveIA({ ...voz, provedor: "ElevenLabs" })).toThrow();
    expect(() => lerEntradaFinalidade({ finalidade: "Voz" })).toThrow();
    expect(() => lerEntradaFinalidade({ finalidade: "audio" })).toThrow();
  });

  it("lerEntradaVerSegredo só aceita os segredos gerados", () => {
    expect(lerEntradaVerSegredo({ conexao_id: ID, nome: "verifyToken" })).toEqual({
      conexao_id: ID,
      nome: "verifyToken",
    });
    expect(() => lerEntradaVerSegredo({ conexao_id: ID, nome: "token" })).toThrow();
    expect(() => lerEntradaVerSegredo({ conexao_id: ID, nome: "apiKey" })).toThrow();
    expect(() => lerEntradaVerSegredo({ conexao_id: "1; drop", nome: "tokenUrl" })).toThrow();
  });

  it("lerEntradaSalvarChaveIA: workspace ausente fica ausente; vazio ou null vira null", () => {
    const base = { finalidade: "resposta", provedor: "anthropic", modelo: "m", chave: "k" };
    expect(lerEntradaSalvarChaveIA(base)).not.toHaveProperty("workspace_id");
    expect(lerEntradaSalvarChaveIA({ ...base, workspace_id: "  " }).workspace_id).toBeNull();
    expect(lerEntradaSalvarChaveIA({ ...base, workspace_id: null }).workspace_id).toBeNull();
    expect(() => lerEntradaSalvarChaveIA({ ...base, workspace_id: 3 })).toThrow();
  });

  it("entradas das ações novas conferem a forma", () => {
    expect(lerEntradaVazia(undefined)).toEqual({});
    expect(lerEntradaVazia({})).toEqual({});
    expect(() => lerEntradaVazia({ conexao_id: "x" })).toThrow();

    expect(lerEntradaFinalidade({ finalidade: "transcricao" })).toEqual({
      finalidade: "transcricao",
    });
    expect(() => lerEntradaFinalidade({ finalidade: "audio" })).toThrow();
    expect(() => lerEntradaFinalidade(null)).toThrow();

    expect(lerEntradaTrocarModelo({ finalidade: "resposta", modelo: "gpt-5.5" })).toEqual({
      finalidade: "resposta",
      modelo: "gpt-5.5",
    });
    expect(() =>
      lerEntradaTrocarModelo({ finalidade: "resposta", modelo: "x".repeat(201) }),
    ).toThrow();
    expect(() => lerEntradaTrocarModelo({ finalidade: "resposta" })).toThrow();

    expect(lerEntradaConsertarCampo({ campo: "token", valor: "EAAG" })).toEqual({
      campo: "token",
      valor: "EAAG",
    });
    expect(lerEntradaConsertarCampo({ campo: "wabaId", valor: "" })).toEqual({
      campo: "wabaId",
      valor: "",
    });
    expect(() => lerEntradaConsertarCampo({ campo: "phoneId", valor: "1" })).toThrow();
    expect(() => lerEntradaConsertarCampo({ campo: "verifyToken", valor: "1" })).toThrow();
    expect(() => lerEntradaConsertarCampo({ campo: "token", valor: 1 })).toThrow();

    expect(lerEntradaRitmo({ espera: 8, teto: 60 })).toEqual({ espera: 8, teto: 60 });
    expect(() => lerEntradaRitmo({ espera: "8", teto: 60 })).toThrow();
    expect(() => lerEntradaRitmo({ espera: 8.5, teto: 60 })).toThrow();
    expect(() => lerEntradaRitmo({ espera: 8 })).toThrow();
  });

  it("cada ação nova passa o cliente do usuário e a entrada lida para a lógica", async () => {
    const ctx = { firebase: { cliente: "do usuário" }, userId: "user-1" };
    const casos: [Chamavel, keyof typeof estado.acoes, unknown, unknown[]][] = [
      [desconectarConexao as unknown as Chamavel, "desconectarConexaoLogica", {}, [ctx]],
      [conferirConexao as unknown as Chamavel, "conferirConexaoLogica", undefined, [ctx]],
      [
        consertarCampoConexao as unknown as Chamavel,
        "consertarCampoConexaoLogica",
        { campo: "token", valor: "t" },
        [ctx, { campo: "token", valor: "t" }],
      ],
      [
        revalidarChaveIA as unknown as Chamavel,
        "revalidarChaveIALogica",
        { finalidade: "resposta" },
        [ctx, { finalidade: "resposta" }],
      ],
      [
        listarModelosDaChave as unknown as Chamavel,
        "listarModelosDaChaveLogica",
        { finalidade: "transcricao" },
        [ctx, { finalidade: "transcricao" }],
      ],
      [
        trocarModeloIA as unknown as Chamavel,
        "trocarModeloIALogica",
        { finalidade: "resposta", modelo: "m" },
        [ctx, { finalidade: "resposta", modelo: "m" }],
      ],
      [
        removerChaveIA as unknown as Chamavel,
        "removerChaveIALogica",
        { finalidade: "transcricao" },
        [ctx, { finalidade: "transcricao" }],
      ],
      [
        salvarRitmo as unknown as Chamavel,
        "salvarRitmoLogica",
        { espera: 8, teto: 60 },
        [ctx, { espera: 8, teto: 60 }],
      ],
      [listarVozes as unknown as Chamavel, "listarVozesLogica", {}, [ctx]],
      [listarVozes as unknown as Chamavel, "listarVozesLogica", undefined, [ctx]],
      [
        escolherVoz as unknown as Chamavel,
        "escolherVozLogica",
        { vozId: "voz_Ana-01" },
        [ctx, { vozId: "voz_Ana-01" }],
      ],
      [
        salvarModoVoz as unknown as Chamavel,
        "salvarModoVozLogica",
        { modo: "sempre" },
        [ctx, { modo: "sempre" }],
      ],
    ];
    for (const [fn, logica, data, args] of casos) {
      expect(await fn({ data })).toEqual({ ok: false, erro: "sem_acesso" });
      expect(estado.acoes[logica]).toHaveBeenCalledWith(...args);
    }
  });

  it("entrada inválida é recusada antes da lógica", async () => {
    await expect(
      (salvarRitmo as unknown as Chamavel)({ data: { espera: "x", teto: 60 } }),
    ).rejects.toThrow(/Pedido inválido/);
    await expect(
      (consertarCampoConexao as unknown as Chamavel)({ data: { campo: "phoneId", valor: "1" } }),
    ).rejects.toThrow(/Pedido inválido/);
    expect(estado.acoes.salvarRitmoLogica).not.toHaveBeenCalled();
    expect(estado.acoes.consertarCampoConexaoLogica).not.toHaveBeenCalled();
  });

  it("a voz em uso: as entradas inválidas são recusadas antes da lógica, sem ecoar o valor", async () => {
    expect(lerEntradaEscolherVoz({ vozId: "voz_Ana-01" })).toEqual({ vozId: "voz_Ana-01" });
    expect(lerEntradaModoVoz({ modo: "quando_audio" })).toEqual({ modo: "quando_audio" });
    expect(lerEntradaModoVoz({ modo: "nunca" })).toEqual({ modo: "nunca" });

    const vozesRuins = ["", "a/b", "../user", "id com espaço", "x".repeat(65), 7, null];
    for (const vozId of vozesRuins) {
      expect(() => lerEntradaEscolherVoz({ vozId })).toThrow("Pedido inválido: voz.");
      await expect(
        (escolherVoz as unknown as Chamavel)({ data: { vozId } }),
      ).rejects.toThrow("Pedido inválido: voz.");
    }
    for (const modo of ["as_vezes", "", "SEMPRE", 1, undefined]) {
      expect(() => lerEntradaModoVoz({ modo })).toThrow("Pedido inválido: modo.");
      await expect(
        (salvarModoVoz as unknown as Chamavel)({ data: { modo } }),
      ).rejects.toThrow("Pedido inválido: modo.");
    }
    expect(() => lerEntradaEscolherVoz(null)).toThrow("Pedido inválido.");
    expect(() => lerEntradaModoVoz(["sempre"])).toThrow("Pedido inválido.");
    await expect(
      (listarVozes as unknown as Chamavel)({ data: { vozId: "x" } }),
    ).rejects.toThrow("Pedido inválido.");

    expect(estado.acoes.escolherVozLogica).not.toHaveBeenCalled();
    expect(estado.acoes.salvarModoVozLogica).not.toHaveBeenCalled();
    expect(estado.acoes.listarVozesLogica).not.toHaveBeenCalled();
  });

  // ---------- a chave da ElevenLabs nos dois cartões (docs/spec-escuta-elevenlabs.md, S2) ----------

  it("usarChaveElevenLabs: lê o cartão e o seLivre e passa o cliente do usuário para a lógica", async () => {
    expect(lerEntradaUsarChaveElevenLabs({ para: "voz" })).toEqual({ para: "voz" });
    expect(lerEntradaUsarChaveElevenLabs({ para: "transcricao", seLivre: true })).toEqual({
      para: "transcricao",
      seLivre: true,
    });
    expect(lerEntradaUsarChaveElevenLabs({ para: "voz", seLivre: false })).toEqual({
      para: "voz",
      seLivre: false,
    });

    const ctx = { firebase: { cliente: "do usuário" }, userId: "user-1" };
    const r = await (usarChaveElevenLabs as unknown as Chamavel)({
      data: { para: "transcricao", seLivre: true },
    });
    expect(r).toEqual({ ok: false, erro: "sem_acesso" });
    expect(estado.acoes.usarChaveElevenLabsLogica).toHaveBeenCalledWith(ctx, {
      para: "transcricao",
      seLivre: true,
    });
  });

  it("usarChaveElevenLabs: cartão inválido ou seLivre que não é booleano são recusados antes da lógica", async () => {
    for (const para of ["resposta", "", "VOZ", 1, null, undefined]) {
      expect(() => lerEntradaUsarChaveElevenLabs({ para })).toThrow("Pedido inválido: cartão.");
      await expect(
        (usarChaveElevenLabs as unknown as Chamavel)({ data: { para } }),
      ).rejects.toThrow("Pedido inválido: cartão.");
    }
    for (const seLivre of ["true", 1, null, {}]) {
      expect(() => lerEntradaUsarChaveElevenLabs({ para: "voz", seLivre })).toThrow(
        "Pedido inválido: seLivre.",
      );
      await expect(
        (usarChaveElevenLabs as unknown as Chamavel)({ data: { para: "transcricao", seLivre } }),
      ).rejects.toThrow("Pedido inválido: seLivre.");
    }
    expect(() => lerEntradaUsarChaveElevenLabs(null)).toThrow("Pedido inválido.");
    expect(() => lerEntradaUsarChaveElevenLabs(["voz"])).toThrow("Pedido inválido.");
    expect(estado.acoes.usarChaveElevenLabsLogica).not.toHaveBeenCalled();
  });
});
