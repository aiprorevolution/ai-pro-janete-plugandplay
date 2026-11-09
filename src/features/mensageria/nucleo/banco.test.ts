import { beforeEach, describe, expect, it, vi } from "vitest";

// Firebase falso que registra cada consulta (tabela, operação, filtros) e devolve o que o teste
// mandar, na ordem.
const falso = vi.hoisted(() => {
  type Consulta = { tabela: string; op: string; valores?: unknown; filtros: unknown[][] };
  const estado = {
    consultas: [] as Consulta[],
    respostas: [] as { data: unknown; error: unknown }[],
    rpcs: [] as { nome: string; args: unknown }[],
    respostaRpc: { data: null, error: null } as { data: unknown; error: unknown },
  };
  const proxima = () => estado.respostas.shift() ?? { data: null, error: null };
  function from(tabela: string) {
    const q: Consulta = { tabela, op: "select", filtros: [] };
    estado.consultas.push(q);
    const b: Record<string, unknown> = {};
    const filtro =
      (nome: string) =>
      (...a: unknown[]) => (q.filtros.push([nome, ...a]), b);
    Object.assign(b, {
      select: () => b,
      insert: (v: unknown) => ((q.op = "insert"), (q.valores = v), b),
      update: (v: unknown) => ((q.op = "update"), (q.valores = v), b),
      delete: () => ((q.op = "delete"), b),
      eq: filtro("eq"),
      is: filtro("is"),
      lt: filtro("lt"),
      in: filtro("in"),
      order: filtro("order"),
      limit: filtro("limit"),
      single: () => b,
      maybeSingle: () => b,
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve(proxima()).then(ok, erro),
    });
    return b;
  }
  const firebaseAdmin = {
    from,
    rpc: async (nome: string, args: unknown) => {
      estado.rpcs.push({ nome, args });
      return estado.respostaRpc;
    },
  };
  return { estado, firebaseAdmin };
});

vi.mock("@/integrations/firebase/client.server", () => ({ firebaseAdmin: falso.firebaseAdmin }));

const banco = await import("./banco.server");

function consulta(i: number) {
  const q = falso.estado.consultas[i];
  if (!q) throw new Error(`sem consulta ${i}`);
  return q;
}
function rpc(i: number) {
  const r = falso.estado.rpcs[i];
  if (!r) throw new Error(`sem rpc ${i}`);
  return r;
}

beforeEach(() => {
  falso.estado.consultas = [];
  falso.estado.respostas = [];
  falso.estado.rpcs = [];
  falso.estado.respostaRpc = { data: null, error: null };
});

describe("banco.server", () => {
  it("gravarEvento: índice único repetido = duplicado", async () => {
    falso.estado.respostaRpc = { data: { duplicado: true, id: 42 }, error: null };
    await expect(banco.gravarEvento("zapi", "c", "e1", "entrada", {})).resolves.toEqual({
      duplicado: true,
    });
    falso.estado.respostaRpc = { data: { duplicado: false, id: 42 }, error: null };
    await expect(banco.gravarEvento("zapi", "c", "e2", "entrada", {})).resolves.toEqual({
      duplicado: false,
      id: 42,
    });
  });

  it("erro do banco vira exceção só com o código", async () => {
    falso.estado.respostaRpc = {
      data: null,
      error: { code: "23514", message: "new row ... segredo", details: "Failing row (abc)" },
    };
    await expect(banco.pegarEnvios(20)).rejects.toThrow(/^pegar_envios:23514$/);
    falso.estado.respostaRpc = {
      data: null,
      error: { code: "P0001", message: "mensagem_invalida" },
    };
    await expect(banco.registrarEntrada("c", [], undefined, {} as never)).rejects.toThrow(
      "registrar_entrada:mensagem_invalida",
    );
  });

  it("registrarEntrada manda p_ids e p_msg no formato do banco", async () => {
    falso.estado.respostaRpc = {
      data: [{ mensagem_id: "m", conversa_id: "v", nova: true }],
      error: null,
    };
    const ids = [{ tipo: "telefone" as const, valor: "5511" }];
    const msg = {
      id_externo: "X",
      tipo: "texto" as const,
      momento: "2026-10-29T00:00:00Z",
      evento_id: 3,
    };
    const r = await banco.registrarEntrada("c", ids, "Nome", msg);
    expect(r).toEqual({ mensagem_id: "m", conversa_id: "v", nova: true });
    expect(rpc(0)).toEqual({
      nome: "registrar_entrada",
      args: { p_conexao: "c", p_ids: ids, p_nome_whatsapp: "Nome", p_msg: msg },
    });
  });

  it("marcarEventoComErro: falhar_evento num comando só (soma a tentativa e solta a trava no banco)", async () => {
    await banco.marcarEventoComErro(9, "status_sem_mensagem");
    expect(falso.estado.rpcs).toEqual([
      { nome: "falhar_evento", args: { p_id: 9, p_erro: "status_sem_mensagem" } },
    ]);
    // nada de ler e gravar a linha à parte
    expect(falso.estado.consultas).toEqual([]);
  });

  it("marcarEventoComErro corta o erro em 200 letras e lança só com o código", async () => {
    await banco.marcarEventoComErro(9, "x".repeat(250));
    expect((rpc(0).args as { p_erro: string }).p_erro).toHaveLength(200);
    falso.estado.respostaRpc = { data: null, error: { code: "08006", message: "caiu" } };
    await expect(banco.marcarEventoComErro(9, "e")).rejects.toThrow(/^marcar_evento_erro:08006$/);
  });

  it("eventosPendentes: pegar_eventos_pendentes com o limite (a trava e as regras são do banco)", async () => {
    const linha = { id: 7, gateway: "zapi", conexao_id: "c", payload: {}, tentativas: 1 };
    falso.estado.respostaRpc = { data: [linha], error: null };
    await expect(banco.eventosPendentes(20)).resolves.toEqual([linha]);
    expect(falso.estado.rpcs).toEqual([
      { nome: "pegar_eventos_pendentes", args: { p_limite: 20 } },
    ]);
    expect(falso.estado.consultas).toEqual([]);
    falso.estado.respostaRpc = { data: null, error: { code: "57014", message: "x" } };
    await expect(banco.eventosPendentes(20)).rejects.toThrow(/^eventos_pendentes:57014$/);
  });

  it("a limpeza dos eventos antigos saiu do servidor (é do relógio do banco)", () => {
    expect("limparEventosAntigos" in banco).toBe(false);
  });

  it("destinoDoContato devolve os identificadores na prioridade do banco", async () => {
    falso.estado.respostas.push(
      { data: { contato_id: "k" }, error: null },
      {
        data: [
          { tipo: "telefone", valor: "5511" },
          { tipo: "bsuid", valor: "BR.1" },
        ],
        error: null,
      },
    );
    await expect(banco.destinoDoContato("v")).resolves.toEqual([
      { tipo: "bsuid", valor: "BR.1" },
      { tipo: "telefone", valor: "5511" },
    ]);
  });

  it("destinoDoContato com a conexão tira a conversa da Zernio de outra conta", async () => {
    falso.estado.respostas.push(
      { data: { contato_id: "k" }, error: null },
      {
        data: [
          { tipo: "zernio_conversa", valor: "conv_conta_antiga", conexao_id: "A" },
          { tipo: "zernio_conversa", valor: "conv_sem_conexao", conexao_id: null },
          { tipo: "zernio_conversa", valor: "conv_conta_atual", conexao_id: "B" },
          { tipo: "telefone", valor: "5511", conexao_id: "A" },
        ],
        error: null,
      },
    );
    await expect(banco.destinoDoContato("v", "B")).resolves.toEqual([
      { tipo: "telefone", valor: "5511" },
      { tipo: "zernio_conversa", valor: "conv_conta_atual" },
      { tipo: "zernio_conversa", valor: "conv_sem_conexao" },
    ]);
  });

  it("gravarTranscricao que não acha a mensagem é erro", async () => {
    falso.estado.respostas.push({ data: [], error: null });
    await expect(banco.gravarTranscricao("m", "oi")).rejects.toThrow(
      "gravar_transcricao:mensagem_nao_encontrada",
    );
  });

  it("idExternoDaMensagem: só devolve o id da citada quando ela é da mesma conexão", async () => {
    falso.estado.respostas.push({
      data: { id_externo: " wamid.X ", conexao_id: "A" },
      error: null,
    });
    await expect(banco.idExternoDaMensagem("m7", "A")).resolves.toBe("wamid.X");
    expect(consulta(0)).toMatchObject({ tabela: "mensagens", op: "select" });
    expect(consulta(0).filtros).toContainEqual(["eq", "id", "m7"]);

    falso.estado.respostas.push({ data: { id_externo: "wamid.X", conexao_id: "B" }, error: null });
    await expect(banco.idExternoDaMensagem("m7", "A")).resolves.toBeNull();
    falso.estado.respostas.push({ data: { id_externo: null, conexao_id: "A" }, error: null });
    await expect(banco.idExternoDaMensagem("m7", "A")).resolves.toBeNull();
    falso.estado.respostas.push({ data: null, error: null });
    await expect(banco.idExternoDaMensagem("m7", "A")).resolves.toBeNull();
  });

  it("idExternoDaMensagem: erro do banco vira exceção só com o código", async () => {
    falso.estado.respostas.push({ data: null, error: { code: "08006", message: "detalhe" } });
    await expect(banco.idExternoDaMensagem("m7", "A")).rejects.toThrow("citacao_mensagem:08006");
  });

  it("marcarWorkerVisto grava worker_visto_em na linha 1; falha ou 0 linhas só vai para o log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      falso.estado.respostas.push({ data: [{ id: 1 }], error: null });
      const agora = new Date("2026-11-02T12:00:00.000Z");
      await expect(banco.marcarWorkerVisto(agora)).resolves.toBe(true);
      expect(consulta(0)).toMatchObject({
        tabela: "configuracao",
        op: "update",
        valores: { worker_visto_em: "2026-11-02T12:00:00.000Z" },
      });
      expect(consulta(0).filtros).toContainEqual(["eq", "id", 1]);
      expect(log).not.toHaveBeenCalled();

      falso.estado.respostas.push({ data: null, error: { code: "08006", message: "detalhe" } });
      await expect(banco.marcarWorkerVisto()).resolves.toBe(false);
      expect(log).toHaveBeenLastCalledWith("worker_visto_falhou", "worker_visto:08006");

      falso.estado.respostas.push({ data: [], error: null });
      await expect(banco.marcarWorkerVisto()).resolves.toBe(false);
      expect(log).toHaveBeenLastCalledWith("worker_visto_falhou", "worker_visto:sem_configuracao");
    } finally {
      log.mockRestore();
    }
  });

  it("concluirEnvio sem ids manda texto vazio (o banco trata como nulo)", async () => {
    await banco.concluirEnvio("m", undefined, null);
    expect(rpc(0).args).toEqual({ p_msg: "m", p_id_externo: "", p_id_gateway: "" });
  });
});
