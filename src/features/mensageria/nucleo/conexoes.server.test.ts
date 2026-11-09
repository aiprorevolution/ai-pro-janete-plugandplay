import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/firebase/store.server", () => ({
  firestoreStore: { runTransaction: vi.fn(async () => { throw new Error("offline"); }) },
}));

// Banco falso em memória: imita o que o servidor usa do firebase-js (select, insert, update,
// eq, maybeSingle) e as regras do banco que importam aqui: o gatilho que zera os segredos ao
// desativar, o índice único de "ativa" e a checagem do formato da cifra.
const falso = vi.hoisted(() => {
  type Linha = Record<string, unknown>;
  const REGEX = /^v[0-9]+:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
  const estado = {
    tabelas: {} as Record<string, Linha[]>,
    escritas: [] as { tabela: string; op: "insert" | "update"; payload: unknown }[],
    /** "tabela.op" que devolve 0 linhas, para testar a falha calada do PostgREST */
    zeroLinhas: new Set<string>(),
    /** o update de conexoes com este "ativa" devolve 0 linhas (só o passo 2 ou só o 3 do Trocar) */
    zeroLinhasAtiva: null as boolean | null,
  };

  function formatoOk(tabela: string, l: Linha): boolean {
    if (tabela === "conexoes" && l["segredos"] !== undefined) {
      const s = l["segredos"] as Record<string, unknown>;
      return Object.values(s).every((v) => typeof v === "string" && REGEX.test(v));
    }
    if (tabela === "ia_chaves" && typeof l["chave_cifrada"] === "string") {
      return REGEX.test(l["chave_cifrada"]);
    }
    return true;
  }

  function consulta(tabela: string) {
    let op: "select" | "insert" | "update" = "select";
    let payload: Linha = {};
    let unico = false;
    const filtros: [string, unknown][] = [];
    const linhas = (estado.tabelas[tabela] ??= []);
    const casa = (l: Linha) => filtros.every(([c, v]) => l[c] === v);

    function executar(): { data: unknown; error: unknown } {
      if (op !== "select") {
        estado.escritas.push({ tabela, op, payload: structuredClone(payload) });
        if (estado.zeroLinhas.has(`${tabela}.${op}`)) return { data: [], error: null };
        if (
          tabela === "conexoes" &&
          op === "update" &&
          payload["ativa"] === estado.zeroLinhasAtiva
        ) {
          return { data: [], error: null };
        }
        if (!formatoOk(tabela, payload)) return { data: null, error: { code: "23514" } };
      }
      if (op === "insert") {
        const nova: Linha = { segredos: {}, parametros: {}, ...payload };
        if (tabela === "auditoria") nova["id"] = linhas.length + 1;
        if (tabela === "conexoes") {
          nova["oficial"] = ["meta", "zernio"].includes(String(nova["gateway"]));
          if (nova["ativa"] && linhas.some((l) => l["ativa"])) {
            return { data: null, error: { code: "23505" } };
          }
        }
        linhas.push(nova);
        return { data: [{ id: nova["id"] }], error: null };
      }
      if (op === "update") {
        const alvo = linhas.filter(casa);
        for (const l of alvo) {
          const antesAtiva = l["ativa"] === true;
          Object.assign(l, payload);
          // gatilho conexoes_desativar
          if (tabela === "conexoes" && antesAtiva && l["ativa"] === false) l["segredos"] = {};
        }
        if (tabela === "conexoes" && linhas.filter((l) => l["ativa"]).length > 1) {
          return { data: null, error: { code: "23505" } };
        }
        return { data: alvo.map((l) => ({ id: l["id"] })), error: null };
      }
      const achadas = linhas.filter(casa).map((l) => ({ ...l }));
      if (unico) {
        if (achadas.length > 1) return { data: null, error: { code: "PGRST116" } };
        return { data: achadas[0] ?? null, error: null };
      }
      return { data: achadas, error: null };
    }

    const q = {
      select: () => q,
      insert: (p: Linha) => {
        op = "insert";
        payload = p;
        return q;
      },
      update: (p: Linha) => {
        op = "update";
        payload = p;
        return q;
      },
      eq: (c: string, v: unknown) => {
        filtros.push([c, v]);
        return q;
      },
      maybeSingle: () => {
        unico = true;
        return q;
      },
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve().then(executar).then(ok, falha),
    };
    return q;
  }

  return { estado, firebaseAdmin: { from: (t: string) => consulta(t) } };
});

vi.mock("@/integrations/firebase/client.server", () => ({ firebaseAdmin: falso.firebaseAdmin }));

// O desligarWebhook falso da Evolution e da Zernio; a Meta e a Z-API não têm (decisão 10 das lacunas).
const desligarWebhook = vi.hoisted(() => vi.fn());
vi.mock("../gateways", async (original) => {
  const real = await original<typeof import("../gateways")>();
  return {
    ...real,
    adaptadorDe: (g: string) => {
      const a = real.adaptadorDe(g);
      if (!a) return null;
      const comDesligar = g === "evolution" || g === "zernio";
      return { ...a, desligarWebhook: comDesligar ? desligarWebhook : undefined };
    },
  };
});

// A fila da conexão que sai (decisão 16 das lacunas): o falso guarda, a cada chamada, quem estava
// ativo naquela hora, para conferir que roda entre o desativar da anterior e o ativar da nova.
const pararFila = vi.hoisted(() => ({
  fn: vi.fn<(id: string) => Promise<string[]>>(),
  ativasNaHora: [] as string[][],
}));
vi.mock("./parar-fila.server", () => ({ pararFilaDaConexao: pararFila.fn }));

import {
  carregarConexao,
  conexaoAtiva,
  gravarChaveIA,
  gravarConexao,
  lerChaveIA,
} from "./conexoes.server";
import { ErroGateway } from "./tipos";

const CHAVE_SERVICO = "chave-de-servico-falsa-para-teste-conexoes";
const MEMBRO = "9d1c7a20-0000-4000-8000-000000000001";
const SEGREDOS = {
  token: "EAAG-token-meta-em-texto-puro-QWERTY",
  appSecret: "app-secret-em-texto-puro-ASDFGH",
  verifyToken: "verify-token-gerado-ZXCVBN",
};

let antes: string | undefined;

beforeEach(() => {
  antes = process.env["JANETE_MASTER_SECRET"];
  process.env["JANETE_MASTER_SECRET"] = CHAVE_SERVICO;
  falso.estado.tabelas = {};
  falso.estado.escritas = [];
  falso.estado.zeroLinhas.clear();
  falso.estado.zeroLinhasAtiva = null;
  desligarWebhook.mockReset().mockResolvedValue(undefined);
  pararFila.ativasNaHora = [];
  pararFila.fn.mockReset().mockImplementation(async () => {
    const linhas = falso.estado.tabelas["conexoes"] ?? [];
    pararFila.ativasNaHora.push(linhas.filter((l) => l["ativa"]).map((l) => String(l["id"])));
    return [];
  });
});

afterEach(() => {
  if (antes === undefined) delete process.env["JANETE_MASTER_SECRET"];
  else process.env["JANETE_MASTER_SECRET"] = antes;
});

function novaMeta(idExterno = "1234567890", segredos: Record<string, string> = SEGREDOS) {
  return {
    gateway: "meta" as const,
    nome: "+55 11 99999-0000",
    id_externo: idExterno,
    parametros: { wabaId: "555" },
    segredos,
    membroId: MEMBRO,
  };
}

function textoDasEscritas(): string {
  return JSON.stringify(falso.estado.escritas);
}

function auditorias(): Record<string, unknown>[] {
  return falso.estado.tabelas["auditoria"] ?? [];
}

describe("gravarConexao", () => {
  it("manda ao banco só texto cifrado e grava a auditoria", async () => {
    const id = (await gravarConexao(novaMeta())).id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const texto = textoDasEscritas();
    for (const valor of Object.values(SEGREDOS)) expect(texto).not.toContain(valor);

    const linha = falso.estado.tabelas["conexoes"]?.[0];
    expect(linha).toMatchObject({ id, ativa: true, status: "conectada", criado_por: MEMBRO });
    expect(Object.keys(linha?.["segredos"] as object).sort()).toEqual([
      "appSecret",
      "token",
      "verifyToken",
    ]);
    expect(auditorias()).toEqual([
      expect.objectContaining({ acao: "conexao_criada", alvo: id, ator_membro_id: MEMBRO }),
    ]);
  });

  it("carregarConexao e conexaoAtiva devolvem os segredos decifrados", async () => {
    const id = (await gravarConexao(novaMeta())).id;
    const c = await carregarConexao(id);
    expect(c).toEqual({
      id,
      gateway: "meta",
      id_externo: "1234567890",
      parametros: { wabaId: "555" },
      segredos: SEGREDOS,
      oficial: true,
    });
    expect(await conexaoAtiva()).toEqual(c);
    expect(await carregarConexao("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("nova conexão desativa a anterior, que perde os segredos", async () => {
    const primeira = (await gravarConexao(novaMeta("111"))).id;
    const segunda = (await gravarConexao(novaMeta("222"))).id;
    expect(segunda).not.toBe(primeira);

    const linhas = falso.estado.tabelas["conexoes"] ?? [];
    expect(linhas.find((l) => l["id"] === primeira)).toMatchObject({ ativa: false, segredos: {} });
    expect(linhas.find((l) => l["id"] === segunda)).toMatchObject({ ativa: true });
    expect((await conexaoAtiva())?.id).toBe(segunda);
    expect(auditorias().map((a) => [a["acao"], a["alvo"]])).toEqual([
      ["conexao_criada", primeira],
      ["conexao_desativada", primeira],
      ["conexao_criada", segunda],
    ]);
  });

  it("mesmo (gateway, id_externo) reaproveita a linha e reativa", async () => {
    const primeira = (await gravarConexao(novaMeta("111"))).id;
    await gravarConexao(novaMeta("222"));
    const novos = { ...SEGREDOS, token: "EAAG-token-novo-POIUYT" };
    const de_novo = (await gravarConexao(novaMeta("111", novos))).id;

    expect(de_novo).toBe(primeira);
    expect(falso.estado.tabelas["conexoes"]).toHaveLength(2);
    expect((await carregarConexao(primeira))?.segredos).toEqual(novos);
    expect((await conexaoAtiva())?.id).toBe(primeira);
    expect(auditorias().at(-1)).toMatchObject({ acao: "conexao_ativada", alvo: primeira });
  });

  it("update que atinge 0 linhas é erro", async () => {
    await gravarConexao(novaMeta("111"));
    falso.estado.zeroLinhas.add("conexoes.update");
    await expect(gravarConexao(novaMeta("111"))).rejects.toThrow(/^banco_gravar_conexao$/);
  });

  it("insert que atinge 0 linhas é erro", async () => {
    falso.estado.zeroLinhas.add("conexoes.insert");
    await expect(gravarConexao(novaMeta())).rejects.toThrow(/^banco_gravar_conexao$/);
  });

  it("insert da nova falhando deixa a anterior ativa e com os segredos", async () => {
    const primeira = (await gravarConexao(novaMeta("111"))).id;
    falso.estado.zeroLinhas.add("conexoes.insert");
    await expect(gravarConexao(novaMeta("222"))).rejects.toThrow(/^banco_gravar_conexao$/);

    const ativa = await conexaoAtiva();
    expect(ativa?.id).toBe(primeira);
    expect(ativa?.segredos).toEqual(SEGREDOS);
    expect(auditorias().map((a) => a["acao"])).toEqual(["conexao_criada"]);
  });

  it("a nova só fica ativa depois de gravada com os segredos", async () => {
    await gravarConexao(novaMeta("111"));
    falso.estado.escritas = [];
    const segunda = (await gravarConexao(novaMeta("222"))).id;
    const conexoes = falso.estado.escritas.filter((e) => e.tabela === "conexoes");
    expect(conexoes.map((e) => [e.op, (e.payload as Record<string, unknown>)["ativa"]])).toEqual([
      ["insert", false],
      ["update", false],
      ["update", true],
    ]);
    expect((await conexaoAtiva())?.id).toBe(segunda);
    expect((await conexaoAtiva())?.segredos).toEqual(SEGREDOS);
  });

  it("auditoria que falha não desfaz nem acusa erro na conexão gravada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    falso.estado.zeroLinhas.add("auditoria.insert");
    const id = (await gravarConexao(novaMeta("111"))).id;
    expect((await conexaoAtiva())?.id).toBe(id);
    expect(console.error).toHaveBeenCalledWith("auditoria_falhou", "conexao_criada");
    vi.mocked(console.error).mockRestore();
  });

  it("sem a chave de serviço, nada é gravado", async () => {
    delete process.env["JANETE_MASTER_SECRET"];
    await expect(gravarConexao(novaMeta())).rejects.toThrow(/^cifra_indisponivel$/);
    expect(falso.estado.escritas).toEqual([]);
  });

  it("o segredo fica preso ao id da linha (copiar para outra linha não abre)", async () => {
    const a = (await gravarConexao(novaMeta("111"))).id;
    const b = (await gravarConexao(novaMeta("222"))).id;
    const linhas = falso.estado.tabelas["conexoes"] ?? [];
    const la = linhas.find((l) => l["id"] === a);
    const lb = linhas.find((l) => l["id"] === b);
    if (!la || !lb) throw new Error("linhas faltando");
    la["segredos"] = lb["segredos"];
    await expect(carregarConexao(a)).rejects.toThrow(/^cifra_invalida$/);
    // trocar o nome do segredo também não abre
    const s = lb["segredos"] as Record<string, string>;
    lb["segredos"] = { token: s["appSecret"] };
    await expect(carregarConexao(b)).rejects.toThrow(/^cifra_invalida$/);
  });
});

// ---------- o webhook da anterior no Trocar (decisão 10 das lacunas) ----------

const SEGREDOS_EVOLUTION = {
  apiKey: "api-key-evolution-MNBVCX778899",
  webhookSecret: "segredo-evo-0011",
};

function nova(gateway: "meta" | "zapi" | "evolution" | "zernio", idExterno: string) {
  if (gateway === "meta") return novaMeta(idExterno);
  const segredos =
    gateway === "zapi"
      ? { instanceToken: "token-instancia-zapi-QWERTY", clientToken: "client-zapi-ASDF" }
      : SEGREDOS_EVOLUTION;
  return { ...novaMeta(idExterno), gateway, segredos, parametros: {} };
}

describe("gravarConexao: o webhook da conexão anterior", () => {
  it("desliga o webhook da anterior com os segredos dela, antes de desativá-la", async () => {
    const primeira = (await gravarConexao(nova("evolution", "loja-1"))).id;
    let segredosNaHora: unknown = null;
    desligarWebhook.mockImplementation(async (c: { id: string; segredos: unknown }) => {
      // na hora do desligar, a anterior ainda está ativa e com os segredos no banco
      const linha = falso.estado.tabelas["conexoes"]?.find((l) => l["id"] === primeira);
      segredosNaHora = {
        ativa: linha?.["ativa"],
        chaves: Object.keys(linha?.["segredos"] as object),
      };
      expect(c.id).toBe(primeira);
      expect(c.segredos).toEqual(SEGREDOS_EVOLUTION);
    });
    const r = await gravarConexao(nova("meta", "222"));
    expect(desligarWebhook).toHaveBeenCalledTimes(1);
    expect(segredosNaHora).toEqual({ ativa: true, chaves: ["apiKey", "webhookSecret"] });
    // desligou: sem aviso
    expect(r).toEqual({ id: expect.any(String) });
    expect(auditorias().find((a) => a["acao"] === "conexao_desativada")).toMatchObject({
      alvo: primeira,
      detalhe: { gateway: "evolution", webhook: "desligado" },
    });
  });

  it.each(["meta", "zapi"] as const)("anterior na %s (sem API): webhook_no_painel", async (g) => {
    await gravarConexao(nova(g, "111"));
    const r = await gravarConexao(nova("evolution", "loja-2"));
    expect(r.anterior).toEqual({ gateway: g, aviso: "webhook_no_painel" });
    expect(desligarWebhook).not.toHaveBeenCalled();
    expect(auditorias().find((a) => a["acao"] === "conexao_desativada")).toMatchObject({
      detalhe: { gateway: g, webhook: "no_painel" },
    });
  });

  it.each(["evolution", "zernio"] as const)("anterior na %s que desliga: sem aviso", async (g) => {
    await gravarConexao(nova(g, "111"));
    const r = await gravarConexao(nova("meta", "222"));
    expect(r.anterior).toBeUndefined();
    expect(desligarWebhook).toHaveBeenCalledTimes(1);
  });

  it("o desligar que falha não impede trocar: webhook_nao_desligado, com a causa na auditoria", async () => {
    const primeira = (await gravarConexao(nova("zernio", "acc-1"))).id;
    desligarWebhook.mockRejectedValue(
      new ErroGateway("zernio_http_401", true, "https://x/?t=sigiloso-XYZ"),
    );
    const r = await gravarConexao(nova("meta", "222"));
    expect(r.anterior).toEqual({ gateway: "zernio", aviso: "webhook_nao_desligado" });
    expect((await conexaoAtiva())?.id).toBe(r.id);
    const linhas = falso.estado.tabelas["conexoes"] ?? [];
    expect(linhas.find((l) => l["id"] === primeira)).toMatchObject({ ativa: false, segredos: {} });
    expect(auditorias().find((a) => a["acao"] === "conexao_desativada")).toMatchObject({
      detalhe: { gateway: "zernio", webhook: "nao_desligado", webhook_causa: "zernio_http_401" },
    });
    expect(JSON.stringify(auditorias())).not.toContain("sigiloso");
  });

  it("o teto estourado não impede trocar: webhook_nao_desligado", async () => {
    await gravarConexao(nova("evolution", "loja-1"));
    desligarWebhook.mockImplementation(() => new Promise(() => {}));
    const r = await gravarConexao(nova("meta", "222"), { tetoWebhookMs: 20 });
    expect(r.anterior).toEqual({ gateway: "evolution", aviso: "webhook_nao_desligado" });
    expect((await conexaoAtiva())?.id).toBe(r.id);
    expect(auditorias().find((a) => a["acao"] === "conexao_desativada")).toMatchObject({
      detalhe: { gateway: "evolution", webhook: "nao_desligado", webhook_causa: "tempo_esgotado" },
    });
  });

  it("a anterior que não carrega: webhook_nao_desligado com o gateway lido da ativa", async () => {
    const primeira = (await gravarConexao(nova("evolution", "loja-1"))).id;
    const linha = falso.estado.tabelas["conexoes"]?.find((l) => l["id"] === primeira);
    if (!linha) throw new Error("linha faltando");
    linha["segredos"] = { apiKey: 42 };
    const r = await gravarConexao(nova("meta", "222"));
    expect(desligarWebhook).not.toHaveBeenCalled();
    expect(r.anterior).toEqual({ gateway: "evolution", aviso: "webhook_nao_desligado" });
    expect((await conexaoAtiva())?.id).toBe(r.id);
    expect(auditorias().find((a) => a["acao"] === "conexao_desativada")).toMatchObject({
      detalhe: {
        gateway: "evolution",
        webhook: "nao_desligado",
        webhook_causa: "conexao_nao_carregou",
      },
    });
  });

  it("sem anterior, não chama o desligar nem tem aviso", async () => {
    const r = await gravarConexao(nova("evolution", "loja-1"));
    expect(desligarWebhook).not.toHaveBeenCalled();
    expect(r).toEqual({ id: expect.any(String) });
  });

  it("a mesma conexão salva de novo não desliga o próprio webhook", async () => {
    await gravarConexao(nova("evolution", "loja-1"));
    const r = await gravarConexao(nova("evolution", "loja-1"));
    expect(desligarWebhook).not.toHaveBeenCalled();
    expect(r.anterior).toBeUndefined();
    expect(auditorias().some((a) => a["acao"] === "conexao_desativada")).toBe(false);
  });

  // M1 da revisão: o (2) ou o (3) que falham depois de mexer na anterior não podem cair no
  // erro_ao_gravar genérico, porque a Janete fica surda e o salvar seguinte já não vê a anterior
  it("desligou o webhook e o desativar da anterior falhou: troca_sem_desativar", async () => {
    const primeira = (await gravarConexao(nova("evolution", "loja-1"))).id;
    falso.estado.zeroLinhasAtiva = false;
    await expect(gravarConexao(nova("meta", "222"))).rejects.toThrow(/^troca_sem_desativar$/);
    expect(desligarWebhook).toHaveBeenCalledTimes(1);
    // a anterior segue ativa e com os segredos: salvar de novo desliga outra vez e termina
    expect((await conexaoAtiva())?.id).toBe(primeira);
    expect(auditorias().some((a) => a["acao"] === "conexao_desativada")).toBe(false);
    falso.estado.zeroLinhasAtiva = null;
    const r = await gravarConexao(nova("meta", "222"));
    expect((await conexaoAtiva())?.id).toBe(r.id);
    expect(desligarWebhook).toHaveBeenCalledTimes(2);
    expect(auditorias().find((a) => a["acao"] === "conexao_desativada")).toMatchObject({
      alvo: primeira,
      detalhe: { gateway: "evolution", webhook: "desligado" },
    });
  });

  it("webhook que ficou no provedor e o desativar falhou: o erro de banco de sempre", async () => {
    const primeira = (await gravarConexao(nova("zapi", "111"))).id;
    falso.estado.zeroLinhasAtiva = false;
    await expect(gravarConexao(nova("meta", "222"))).rejects.toThrow(/^banco_desativar_conexao$/);
    expect((await conexaoAtiva())?.id).toBe(primeira);
  });

  it.each([
    ["evolution", "troca_sem_ativar"],
    ["zapi", "troca_sem_ativar_no_painel"],
  ] as const)(
    "a anterior (%s) saiu e a nova não ativou: %s, com a auditoria da anterior gravada",
    async (g, codigo) => {
      const primeira = (await gravarConexao(nova(g, "111"))).id;
      falso.estado.zeroLinhasAtiva = true;
      await expect(gravarConexao(nova("meta", "222"))).rejects.toThrow(new RegExp(`^${codigo}$`));
      expect(await conexaoAtiva()).toBeNull();
      expect(auditorias().find((a) => a["acao"] === "conexao_desativada")).toMatchObject({
        alvo: primeira,
        detalhe: { gateway: g },
      });
    },
  );

  it("sem anterior, a nova que não ativa dá o erro de banco de sempre", async () => {
    falso.estado.zeroLinhasAtiva = true;
    await expect(gravarConexao(nova("meta", "222"))).rejects.toThrow(/^banco_ativar_conexao$/);
  });

  it("o insert da nova que falha não toca no webhook da anterior", async () => {
    await gravarConexao(nova("evolution", "loja-1"));
    falso.estado.zeroLinhas.add("conexoes.insert");
    await expect(gravarConexao(nova("meta", "222"))).rejects.toThrow(/^banco_gravar_conexao$/);
    expect(desligarWebhook).not.toHaveBeenCalled();
  });
});

describe("gravarConexao: a fila da conexão anterior (decisão 16)", () => {
  it("para a fila da anterior depois de desativá-la e antes de ativar a nova", async () => {
    const primeira = (await gravarConexao(nova("evolution", "loja-1"))).id;
    expect(pararFila.fn).not.toHaveBeenCalled();
    const r = await gravarConexao(nova("meta", "222"));
    expect(pararFila.fn).toHaveBeenCalledTimes(1);
    expect(pararFila.fn).toHaveBeenCalledWith(primeira);
    // na hora: a anterior já desativada e a nova ainda não ativa
    expect(pararFila.ativasNaHora).toEqual([[]]);
    expect((await conexaoAtiva())?.id).toBe(r.id);
    const desativada = auditorias().find((a) => a["acao"] === "conexao_desativada");
    expect(desativada?.["detalhe"]).not.toHaveProperty("fila_causa");
  });

  it("sem anterior não para fila nenhuma", async () => {
    await gravarConexao(nova("evolution", "loja-1"));
    expect(pararFila.fn).not.toHaveBeenCalled();
  });

  it("a mesma conexão salva de novo não para a própria fila", async () => {
    await gravarConexao(nova("evolution", "loja-1"));
    await gravarConexao(nova("evolution", "loja-1"));
    expect(pararFila.fn).not.toHaveBeenCalled();
  });

  it("a fila que não parou fica na auditoria e não impede a troca", async () => {
    await gravarConexao(nova("zapi", "111"));
    pararFila.fn.mockResolvedValue(["cancelar_fila_janete", "falhar_fila_equipe"]);
    const r = await gravarConexao(nova("meta", "222"));
    expect(r.anterior).toEqual({ gateway: "zapi", aviso: "webhook_no_painel" });
    expect((await conexaoAtiva())?.id).toBe(r.id);
    expect(auditorias().find((a) => a["acao"] === "conexao_desativada")).toMatchObject({
      detalhe: {
        gateway: "zapi",
        webhook: "no_painel",
        fila_causa: "cancelar_fila_janete,falhar_fila_equipe",
      },
    });
  });

  it("o desativar da anterior que falha não mexe na fila", async () => {
    await gravarConexao(nova("zapi", "111"));
    falso.estado.zeroLinhasAtiva = false;
    await expect(gravarConexao(nova("meta", "222"))).rejects.toThrow(/^banco_desativar_conexao$/);
    expect(pararFila.fn).not.toHaveBeenCalled();
  });
});

describe("chaves de IA", () => {
  const CHAVE = "  sk-ant-api03-chave-em-texto-puro-WXYZ  ";

  it("grava cifrada, devolve os 4 últimos e lê de volta", async () => {
    const r = await gravarChaveIA({
      finalidade: "resposta",
      provedor: "anthropic",
      modelo: "claude-haiku-5-5",
      workspace_id: "wrkspc_123",
      chave: CHAVE,
      membroId: MEMBRO,
    });
    expect(r).toEqual({ ultimos4: "WXYZ" });
    expect(textoDasEscritas()).not.toContain("sk-ant-api03-chave-em-texto-puro");

    const linha = falso.estado.tabelas["ia_chaves"]?.[0];
    expect(linha).toMatchObject({
      finalidade: "resposta",
      status: "ativa",
      ultimos4: "WXYZ",
      atualizada_por: MEMBRO,
    });
    expect(typeof linha?.["validada_em"]).toBe("string");

    const lida = await lerChaveIA("resposta");
    expect(lida).toEqual({
      id: linha?.["id"],
      provedor: "anthropic",
      modelo: "claude-haiku-5-5",
      workspace_id: "wrkspc_123",
      chave: CHAVE.trim(),
    });
    expect(auditorias()).toEqual([
      expect.objectContaining({ acao: "chave_cadastrada", ultimos4: "WXYZ", alvo: linha?.["id"] }),
    ]);
  });

  it("trocar mantém o id e audita chave_trocada", async () => {
    const base = {
      finalidade: "resposta" as const,
      provedor: "openai" as const,
      modelo: "gpt-5.5-mini",
      workspace_id: null,
      membroId: MEMBRO,
    };
    await gravarChaveIA({ ...base, chave: "sk-proj-primeira-AAAA" });
    const id = falso.estado.tabelas["ia_chaves"]?.[0]?.["id"];
    await gravarChaveIA({ ...base, chave: "sk-proj-segunda-BBBB" });

    expect(falso.estado.tabelas["ia_chaves"]).toHaveLength(1);
    expect((await lerChaveIA("resposta"))?.chave).toBe("sk-proj-segunda-BBBB");
    expect((await lerChaveIA("resposta"))?.id).toBe(id);
    expect(auditorias().map((a) => a["acao"])).toEqual(["chave_cadastrada", "chave_trocada"]);
  });

  it("sem chave cadastrada, lerChaveIA dá null", async () => {
    expect(await lerChaveIA("transcricao")).toBeNull();
  });

  it("update de chave com 0 linhas é erro", async () => {
    const base = {
      finalidade: "resposta" as const,
      provedor: "openai" as const,
      modelo: "gpt-5.5-mini",
      workspace_id: null,
      chave: "sk-proj-x-CCCC",
      membroId: MEMBRO,
    };
    await gravarChaveIA(base);
    falso.estado.zeroLinhas.add("ia_chaves.update");
    await expect(gravarChaveIA(base)).rejects.toThrow(/^banco_gravar_chave$/);
  });
});
