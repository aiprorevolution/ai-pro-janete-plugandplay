import { beforeEach, describe, expect, it, vi } from "vitest";

// firebaseAdmin falso: cada from() vira uma cadeia que guarda as chamadas e responde com o que o
// teste deixar em `estado.respostas` (na ordem), como o PostgREST faria.
type Chamada = { tabela: string; passos: [string, ...unknown[]][] };
const estado = vi.hoisted(() => ({
  chamadas: [] as Chamada[],
  respostas: [] as { data: unknown; error: unknown }[],
}));

vi.mock("@/integrations/firebase/client.server", () => {
  const cadeia = (tabela: string) => {
    const chamada: Chamada = { tabela, passos: [] };
    estado.chamadas.push(chamada);
    const responder = () =>
      Promise.resolve(estado.respostas.shift() ?? { data: null, error: null });
    const c: Record<string, unknown> = {};
    for (const nome of ["select", "update", "insert", "eq"]) {
      c[nome] = (...args: unknown[]) => {
        chamada.passos.push([nome, ...args]);
        return c;
      };
    }
    c["maybeSingle"] = () => {
      chamada.passos.push(["maybeSingle"]);
      return responder();
    };
    c["then"] = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      responder().then(ok, falha);
    return c;
  };
  return { firebaseAdmin: { from: cadeia } };
});
vi.mock("../nucleo/cifra", () => ({
  aadConexao: (id: string, nome: string) => `${id}:${nome}`,
  cifrar: async (texto: string, aad: string) =>
    `v1:${Buffer.from(aad).toString("base64")}:${Buffer.from(texto).toString("base64")}`,
}));

import {
  apagarChave,
  auditar,
  cancelarBolhasDaJaneteNaFila,
  desativarConexao,
  falharMensagensDaEquipeNaFila,
  gravarErroVoz,
  gravarModeloChave,
  gravarModoVoz,
  gravarRitmo,
  gravarStatusChave,
  gravarStatusConexao,
  gravarVoz,
  idConexaoAtiva,
  lerConfigVozTela,
  lerResumoChaveIA,
  regravarConexao,
} from "./banco.server";

const UMA = { data: [{ id: "x" }], error: null };
const NENHUMA = { data: [], error: null };

function passos(i = 0) {
  return estado.chamadas[i]?.passos ?? [];
}
function valorDe(passo: string, i = 0): Record<string, unknown> {
  return (passos(i).find((p) => p[0] === passo)?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  estado.chamadas = [];
  estado.respostas = [];
});

describe("banco da Configuração", () => {
  it("desativarConexao: só a linha ativa, pede o id de volta e 0 linhas é falha", async () => {
    estado.respostas.push(UMA);
    await desativarConexao("c1");
    expect(estado.chamadas[0]?.tabela).toBe("conexoes");
    expect(valorDe("update")).toMatchObject({ ativa: false, status: "desconectada" });
    expect(passos()).toContainEqual(["eq", "id", "c1"]);
    expect(passos()).toContainEqual(["eq", "ativa", true]);
    expect(passos()).toContainEqual(["select", "id"]);

    estado.respostas.push(NENHUMA);
    await expect(desativarConexao("c1")).rejects.toThrow("banco_desativar_conexao");
    estado.respostas.push({ data: null, error: { message: "x" } });
    await expect(desativarConexao("c1")).rejects.toThrow("banco_desativar_conexao");
  });

  it("cancelarBolhasDaJaneteNaFila: só as da Janete na fila daquela conexão; 0 linhas não é falha", async () => {
    estado.respostas.push(NENHUMA);
    await cancelarBolhasDaJaneteNaFila("c1");
    expect(estado.chamadas[0]?.tabela).toBe("mensagens");
    expect(valorDe("update")).toMatchObject({ status: "cancelada" });
    expect(typeof valorDe("update")["status_em"]).toBe("string");
    expect(valorDe("update")).not.toHaveProperty("erro");
    expect(passos()).toContainEqual(["eq", "conexao_id", "c1"]);
    expect(passos()).toContainEqual(["eq", "direcao", "saida"]);
    expect(passos()).toContainEqual(["eq", "origem", "janete"]);
    expect(passos()).toContainEqual(["eq", "status", "na_fila"]);
    expect(passos()).toContainEqual(["select", "id"]);
    estado.respostas.push({ data: null, error: { message: "x" } });
    await expect(cancelarBolhasDaJaneteNaFila("c1")).rejects.toThrow("banco_cancelar_fila_janete");
  });

  it("falharMensagensDaEquipeNaFila: só as da equipe na fila, falhou com conexao_inativa", async () => {
    estado.respostas.push(UMA);
    await falharMensagensDaEquipeNaFila("c1");
    expect(estado.chamadas[0]?.tabela).toBe("mensagens");
    expect(valorDe("update")).toMatchObject({ status: "falhou", erro: "conexao_inativa" });
    expect(typeof valorDe("update")["status_em"]).toBe("string");
    expect(passos()).toContainEqual(["eq", "conexao_id", "c1"]);
    expect(passos()).toContainEqual(["eq", "direcao", "saida"]);
    expect(passos()).toContainEqual(["eq", "origem", "humano_tela"]);
    expect(passos()).toContainEqual(["eq", "status", "na_fila"]);
    estado.respostas.push(NENHUMA);
    await expect(falharMensagensDaEquipeNaFila("c1")).resolves.toBeUndefined();
    estado.respostas.push({ data: null, error: { message: "x" } });
    await expect(falharMensagensDaEquipeNaFila("c1")).rejects.toThrow("banco_falhar_fila_equipe");
  });

  it("idConexaoAtiva lê só o id da ativa", async () => {
    estado.respostas.push({ data: { id: "c9" }, error: null });
    expect(await idConexaoAtiva()).toBe("c9");
    expect(passos()).toContainEqual(["select", "id"]);
    expect(passos()).toContainEqual(["eq", "ativa", true]);
    estado.respostas.push({ data: null, error: null });
    expect(await idConexaoAtiva()).toBeNull();
    estado.respostas.push({ data: null, error: { message: "x" } });
    await expect(idConexaoAtiva()).rejects.toThrow("banco_ler_conexao");
  });

  it("gravarStatusConexao: conectada limpa o erro; erro guarda o código", async () => {
    estado.respostas.push(UMA, UMA);
    await gravarStatusConexao("c1", "conectada", "ignorado");
    expect(valorDe("update")).toMatchObject({ status: "conectada", ultimo_erro: null });
    await gravarStatusConexao("c1", "erro", "credencial_invalida");
    expect(valorDe("update", 1)).toMatchObject({
      status: "erro",
      ultimo_erro: "credencial_invalida",
    });
    expect(passos(1)).toContainEqual(["eq", "ativa", true]);
    estado.respostas.push(NENHUMA);
    await expect(gravarStatusConexao("c1", "erro", "x")).rejects.toThrow(
      "banco_gravar_status_conexao",
    );
  });

  it("regravarConexao cifra cada segredo preso ao id e ao nome, sem mexer em ativa", async () => {
    estado.respostas.push(UMA);
    await regravarConexao("c1", {
      nome: "+55 11",
      parametros: { phoneId: "123" },
      segredos: { token: "tok-claro", verifyToken: "vt" },
    });
    const v = valorDe("update");
    expect(v).not.toHaveProperty("ativa");
    expect(v).toMatchObject({
      nome: "+55 11",
      parametros: { phoneId: "123" },
      status: "conectada",
      ultimo_erro: null,
    });
    const segredos = v["segredos"] as Record<string, string>;
    expect(segredos["token"]).toBe(
      `v1:${Buffer.from("c1:token").toString("base64")}:${Buffer.from("tok-claro").toString("base64")}`,
    );
    expect(JSON.stringify(v)).not.toContain("tok-claro");
    estado.respostas.push(NENHUMA);
    await expect(
      regravarConexao("c1", { nome: "n", parametros: {}, segredos: { token: "t" } }),
    ).rejects.toThrow("banco_regravar_conexao");
  });

  it("lerResumoChaveIA não decifra e diz se há chave", async () => {
    estado.respostas.push({
      data: {
        id: "k1",
        provedor: "anthropic",
        modelo: "m",
        workspace_id: "w",
        status: "ativa",
        ultimos4: "ABCD",
        ultimo_erro: "sem_permissao",
        chave_cifrada: "v1:a:b",
      },
      error: null,
    });
    expect(await lerResumoChaveIA("resposta")).toEqual({
      id: "k1",
      provedor: "anthropic",
      modelo: "m",
      workspace_id: "w",
      status: "ativa",
      ultimos4: "ABCD",
      ultimo_erro: "sem_permissao",
      temChave: true,
    });
    // o último erro é lido junto (o "Conferir tudo" da voz usa), sem decifrar nada
    expect(passos()).toContainEqual([
      "select",
      "id, provedor, modelo, workspace_id, status, ultimos4, ultimo_erro, chave_cifrada",
    ]);
    expect(passos()).toContainEqual(["eq", "finalidade", "resposta"]);
    estado.respostas.push({ data: null, error: null });
    expect(await lerResumoChaveIA("transcricao")).toBeNull();
  });

  it("gravarStatusChave, gravarModeloChave e apagarChave pedem 1 linha", async () => {
    estado.respostas.push(UMA, UMA, UMA, UMA);
    await gravarStatusChave("k1", "ativa", null);
    expect(valorDe("update", 0)).toMatchObject({ status: "ativa", ultimo_erro: null });
    expect(valorDe("update", 0)).toHaveProperty("validada_em");
    await gravarStatusChave("k1", "invalida", "chave_invalida");
    expect(valorDe("update", 1)).toMatchObject({
      status: "invalida",
      ultimo_erro: "chave_invalida",
    });
    expect(valorDe("update", 1)).not.toHaveProperty("validada_em");
    await gravarModeloChave("k1", "novo", "m1");
    expect(valorDe("update", 2)).toMatchObject({
      modelo: "novo",
      status: "ativa",
      atualizada_por: "m1",
    });
    await apagarChave("k1", "m1");
    expect(valorDe("update", 3)).toMatchObject({
      chave_cifrada: null,
      ultimos4: null,
      status: "removida",
      atualizada_por: "m1",
    });
    for (const i of [0, 1, 2, 3]) expect(passos(i)).toContainEqual(["select", "id"]);

    estado.respostas.push(NENHUMA, NENHUMA, NENHUMA);
    await expect(gravarStatusChave("k1", "ativa", null)).rejects.toThrow(
      "banco_gravar_status_chave",
    );
    await expect(gravarModeloChave("k1", "n", "m1")).rejects.toThrow("banco_gravar_modelo");
    await expect(apagarChave("k1", "m1")).rejects.toThrow("banco_remover_chave");
  });

  it("gravarRitmo lê os valores de antes, grava na linha 1 de configuracao e devolve o anterior", async () => {
    estado.respostas.push({ data: { espera_lote_s: 5, espera_lote_max_s: 40 }, error: null }, UMA);
    expect(await gravarRitmo(8, 60)).toEqual({ espera: 5, teto: 40 });
    expect(estado.chamadas[0]?.tabela).toBe("configuracao");
    expect(passos(0)).toContainEqual(["select", "espera_lote_s, espera_lote_max_s"]);
    expect(passos(0)).toContainEqual(["eq", "id", 1]);
    expect(estado.chamadas[1]?.tabela).toBe("configuracao");
    expect(valorDe("update", 1)).toEqual({ espera_lote_s: 8, espera_lote_max_s: 60 });
    expect(passos(1)).toContainEqual(["eq", "id", 1]);

    // a leitura de antes falhou: grava do mesmo jeito, anterior null
    estado.chamadas = [];
    estado.respostas.push({ data: null, error: { code: "08006" } }, UMA);
    expect(await gravarRitmo(8, 60)).toBeNull();
    expect(valorDe("update", 1)).toEqual({ espera_lote_s: 8, espera_lote_max_s: 60 });

    estado.respostas.push({ data: null, error: null }, NENHUMA);
    await expect(gravarRitmo(8, 60)).rejects.toThrow("banco_gravar_ritmo");
  });

  it("lerConfigVozTela lê a linha 1 e trata o que está fora do formato como ausente", async () => {
    estado.respostas.push({
      data: { voz_resposta: "sempre", voz_id: "voz_Ana-01", voz_nome: "Ana", voz_erro: null },
      error: null,
    });
    expect(await lerConfigVozTela()).toEqual({
      modo: "sempre",
      voz: { id: "voz_Ana-01", nome: "Ana" },
      erro: null,
    });
    expect(estado.chamadas[0]?.tabela).toBe("configuracao");
    expect(passos(0)).toContainEqual(["select", "voz_resposta, voz_id, voz_nome, voz_erro"]);
    expect(passos(0)).toContainEqual(["eq", "id", 1]);

    estado.respostas.push({
      data: { voz_resposta: "x", voz_id: "id com espaço", voz_nome: "N", voz_erro: "voz_nao_encontrada" },
      error: null,
    });
    expect(await lerConfigVozTela()).toEqual({
      modo: "quando_audio",
      voz: null,
      erro: "voz_nao_encontrada",
    });
    estado.respostas.push({ data: null, error: null });
    expect(await lerConfigVozTela()).toEqual({ modo: "quando_audio", voz: null, erro: null });
    estado.respostas.push({ data: null, error: { code: "08006" } });
    await expect(lerConfigVozTela()).rejects.toThrow("banco_ler_voz");
  });

  it("gravarVoz grava id e nome, limpa o voz_erro e devolve a voz de antes", async () => {
    estado.respostas.push({ data: { voz_id: "voz_Velha", voz_nome: "Velha" }, error: null }, UMA);
    expect(await gravarVoz({ id: "voz_Ana-01", nome: "Ana" })).toEqual({
      id: "voz_Velha",
      nome: "Velha",
    });
    expect(valorDe("update", 1)).toEqual({ voz_id: "voz_Ana-01", voz_nome: "Ana", voz_erro: null });
    expect(passos(1)).toContainEqual(["eq", "id", 1]);
    expect(passos(1)).toContainEqual(["select", "id"]);

    // sem voz antes, ou a leitura de antes falhou: grava do mesmo jeito, anterior null
    estado.chamadas = [];
    estado.respostas.push({ data: { voz_id: null, voz_nome: null }, error: null }, UMA);
    expect(await gravarVoz({ id: "voz_Ana-01", nome: "Ana" })).toBeNull();
    estado.respostas.push({ data: null, error: { code: "08006" } }, UMA);
    expect(await gravarVoz({ id: "voz_Ana-01", nome: "Ana" })).toBeNull();

    estado.respostas.push({ data: null, error: null }, NENHUMA);
    await expect(gravarVoz({ id: "voz_Ana-01", nome: "Ana" })).rejects.toThrow("banco_gravar_voz");
  });

  it("gravarModoVoz grava o modo na linha 1 e devolve o de antes", async () => {
    estado.respostas.push({ data: { voz_resposta: "quando_audio" }, error: null }, UMA);
    expect(await gravarModoVoz("nunca")).toBe("quando_audio");
    expect(passos(0)).toContainEqual(["select", "voz_resposta"]);
    expect(valorDe("update", 1)).toEqual({ voz_resposta: "nunca" });
    expect(passos(1)).toContainEqual(["eq", "id", 1]);
    expect(passos(1)).toContainEqual(["select", "id"]);

    estado.respostas.push({ data: null, error: { code: "08006" } }, UMA);
    expect(await gravarModoVoz("sempre")).toBeNull();
    estado.respostas.push({ data: null, error: null }, NENHUMA);
    await expect(gravarModoVoz("sempre")).rejects.toThrow("banco_gravar_modo_voz");
  });

  it("gravarErroVoz só atinge a linha da mesma voz e 0 linhas é falha", async () => {
    estado.respostas.push(UMA, UMA);
    await gravarErroVoz("voz_Ana-01", "voz_nao_encontrada");
    expect(valorDe("update", 0)).toEqual({ voz_erro: "voz_nao_encontrada" });
    expect(passos(0)).toContainEqual(["eq", "id", 1]);
    expect(passos(0)).toContainEqual(["eq", "voz_id", "voz_Ana-01"]);
    expect(passos(0)).toContainEqual(["select", "id"]);
    await gravarErroVoz("voz_Ana-01", null);
    expect(valorDe("update", 1)).toEqual({ voz_erro: null });

    estado.respostas.push(NENHUMA);
    await expect(gravarErroVoz("voz_Outra", null)).rejects.toThrow("banco_gravar_erro_voz");
  });

  it("auditar é melhor esforço: falha não sobe", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    estado.respostas.push(NENHUMA);
    await expect(auditar({ acao: "chave_removida", alvo: "k1" })).resolves.toBeUndefined();
    expect(estado.chamadas[0]?.tabela).toBe("auditoria");
    expect(erro).toHaveBeenCalledWith("auditoria_falhou", "chave_removida");
    erro.mockRestore();
  });
});
