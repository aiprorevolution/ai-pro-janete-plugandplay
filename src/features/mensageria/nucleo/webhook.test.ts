import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdaptadorGateway, ConexaoServidor, Evento } from "./tipos";

// Firebase falso: só o que o banco.server usa no webhook. eventos_webhook em memória, com o
// índice único (gateway, id_evento); rpc respondido pelo teste.
const falso = vi.hoisted(() => {
  type Linha = {
    id?: number;
    gateway?: unknown;
    id_evento?: unknown;
    tipo?: unknown;
    processado_em?: unknown;
    tentativas?: number;
    erro?: unknown;
    [k: string]: unknown;
  };
  type Args = {
    p_conexao?: unknown;
    p_ids?: unknown;
    p_nome_whatsapp?: unknown;
    p_msg?: unknown;
    [k: string]: unknown;
  };
  const estado = {
    eventos: [] as Linha[],
    proximoId: 1,
    rpcs: [] as { nome: string; args: Args }[],
    respostaRpc: (_nome: string, _args: Record<string, unknown>) =>
      ({ data: null, error: null }) as { data: unknown; error: unknown },
    falharInsert: null as null | { code: string; message: string },
  };

  function from(tabela: string) {
    if (tabela !== "eventos_webhook" && tabela !== "conexoes") throw new Error(tabela);
    const q = {
      op: "select" as string,
      valores: null as Linha | null,
      filtros: [] as [string, unknown][],
      unico: false,
    };
    const executar = () => {
      if (tabela === "conexoes") return { data: [{ id: "x" }], error: null };
      if (q.op === "insert") {
        if (estado.falharInsert) return { data: null, error: estado.falharInsert };
        const v = q.valores as Linha;
        const repetido = estado.eventos.some(
          (e) => v.id_evento != null && e.gateway === v.gateway && e.id_evento === v.id_evento,
        );
        if (repetido) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const linha = { ...v, id: estado.proximoId++, tentativas: 0, processado_em: null };
        estado.eventos.push(linha);
        return { data: { id: linha.id }, error: null };
      }
      const alvo = estado.eventos.filter((e) => q.filtros.every(([c, val]) => e[c] === val));
      if (q.op === "update") {
        alvo.forEach((e) => Object.assign(e, q.valores));
        return { data: alvo.map((e) => ({ id: e.id })), error: null };
      }
      return { data: q.unico ? (alvo[0] ?? null) : alvo, error: null };
    };
    const b: Record<string, unknown> = {
      insert: (v: Linha) => ((q.op = "insert"), (q.valores = v), b),
      update: (v: Linha) => ((q.op = "update"), (q.valores = v), b),
      select: () => b,
      eq: (c: string, val: unknown) => (q.filtros.push([c, val]), b),
      single: () => ((q.unico = true), b),
      maybeSingle: () => ((q.unico = true), b),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, erro),
    };
    return b;
  }

  const firebaseAdmin = {
    from,
    rpc: async (nome: string, args: Args) => {
      if (nome === "registrar_evento_webhook") {
        if (estado.falharInsert) return { data: null, error: estado.falharInsert };
        const existing = estado.eventos.find(e => e.gateway === args["p_gateway"] && e.id_evento === args["p_id_evento"]);
        if (existing) return { data: { id: existing.id, duplicado: true }, error: null };
        const row = { id: estado.proximoId++, gateway: args["p_gateway"], conexao_id: args["p_conexao"],
          id_evento: args["p_id_evento"], tipo: args["p_tipo"], payload: args["p_payload"], tentativas: 0, processado_em: null };
        estado.eventos.push(row);
        return { data: { id: row.id, duplicado: false }, error: null };
      }
      estado.rpcs.push({ nome, args });
      // falhar_evento (0020): erro, mais uma tentativa e a trava solta, só no não processado
      if (nome === "falhar_evento") {
        const ev = estado.eventos.find((e) => e.id === args["p_id"] && e.processado_em == null);
        if (ev) {
          ev.erro = String(args["p_erro"]).slice(0, 200);
          ev.tentativas = (ev.tentativas ?? 0) + 1;
          ev["pego_em"] = null;
        }
      }
      return estado.respostaRpc(nome, args);
    },
  };
  return { estado, firebaseAdmin };
});

vi.mock("@/integrations/firebase/client.server", () => ({ firebaseAdmin: falso.firebaseAdmin }));

const CONEXAO_ID = "11111111-1111-4111-8111-111111111111";
const conexao: ConexaoServidor = {
  id: CONEXAO_ID,
  gateway: "zapi",
  id_externo: "inst-1",
  parametros: {},
  segredos: { instanceToken: "inst-token", clientToken: "certo", tokenUrl: "tok-url" },
  oficial: false,
};

const mocks = vi.hoisted(() => ({
  carregarConexao: vi.fn(),
  acordarMotor: vi.fn(),
}));
// o toque no motor: o acordarMotor falso, com o comTeto de verdade
vi.mock("./motor.server", async (original) => ({
  ...(await original<typeof import("./motor.server")>()),
  acordarMotor: mocks.acordarMotor,
}));
vi.mock("./conexoes.server", () => ({
  carregarConexao: mocks.carregarConexao,
  conexaoAtiva: vi.fn(),
}));

// Adaptador falso: assinatura pelo cabeçalho x-token, comparado com o segredo clientToken
// (como um adaptador descuidado faria, com "?? ''"); o corpo traz os eventos prontos.
const adaptadorFalso: AdaptadorGateway = {
  gateway: "zapi",
  async validarWebhook(req, _cru, c) {
    return (req.headers.get("x-token") ?? "") === (c.segredos["clientToken"] ?? "");
  },
  traduzir(corpo) {
    if ((corpo as { quebrar?: boolean }).quebrar) throw new Error("bug do adaptador");
    return ((corpo as { eventos?: Evento[] }).eventos ?? []) as Evento[];
  },
  async baixarMidia() {
    throw new Error("nao");
  },
  async enviar() {
    return {};
  },
  async marcarLidaEDigitando() {},
  montarConexao() {
    throw new Error("nao");
  },
};
vi.mock("../gateways", () => ({
  adaptadorDe: (g: string) => (g === "zapi" ? adaptadorFalso : null),
}));

const { processarWebhook, limparPayload, codigoDoErro } = await import("./webhook.server");

const entrada: Evento = {
  tipo: "entrada",
  ids: [{ tipo: "telefone", valor: "5511999990000" }],
  nome_whatsapp: "Lead Teste",
  msg: { id_externo: "MSG1", tipo: "texto", texto: "oi", momento: "2026-10-29T12:00:00Z" },
};

function pedido(corpo: unknown, token = "certo", metodo = "POST") {
  const init: RequestInit = {
    method: metodo,
    headers: { "x-token": token, "content-type": "application/json" },
  };
  if (metodo === "POST") init.body = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return new Request(`https://app.exemplo/api/public/whatsapp/zapi/${CONEXAO_ID}`, init);
}

const rpcsDe = (nome: string) => falso.estado.rpcs.filter((r) => r.nome === nome);

function primeira<T>(lista: T[]): T {
  const x = lista[0];
  if (x === undefined) throw new Error("lista vazia");
  return x;
}

beforeEach(() => {
  falso.estado.eventos = [];
  falso.estado.proximoId = 1;
  falso.estado.rpcs = [];
  falso.estado.falharInsert = null;
  falso.estado.respostaRpc = (nome) =>
    nome === "registrar_entrada"
      ? { data: [{ mensagem_id: "m1", conversa_id: "c1", nova: true }], error: null }
      : nome === "atualizar_status"
        ? { data: 1, error: null }
        : { data: null, error: null };
  mocks.carregarConexao.mockReset();
  mocks.carregarConexao.mockResolvedValue(conexao);
  mocks.acordarMotor.mockReset();
  mocks.acordarMotor.mockResolvedValue("tocado");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("processarWebhook", () => {
  it("assinatura inválida: 401 e nada gravado", async () => {
    const r = await processarWebhook(pedido({ eventos: [entrada] }, "errado"), "zapi", CONEXAO_ID);
    expect(r.status).toBe(401);
    expect(falso.estado.eventos).toHaveLength(0);
    expect(falso.estado.rpcs).toHaveLength(0);
  });

  it("o mesmo webhook duas vezes chama registrar_entrada uma vez só", async () => {
    const corpo = { eventos: [entrada] };
    const r1 = await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    const r2 = await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(rpcsDe("registrar_entrada")).toHaveLength(1);
    expect(falso.estado.eventos).toHaveLength(1);
    const args = primeira(rpcsDe("registrar_entrada")).args;
    expect(args.p_conexao).toBe(CONEXAO_ID);
    expect(args.p_ids).toEqual(entrada.ids);
    expect(args.p_nome_whatsapp).toBe("Lead Teste");
    expect(args.p_msg).toMatchObject({ id_externo: "MSG1", texto: "oi", evento_id: 1 });
    expect(primeira(falso.estado.eventos).processado_em).toBeTruthy();
    expect(primeira(falso.estado.eventos).tipo).toBe("entrada");
  });

  it("status que não casa (0 linhas) deixa o evento pendente", async () => {
    falso.estado.respostaRpc = () => ({ data: 0, error: null });
    const corpo = {
      eventos: [{ tipo: "status", id: "MSG9", status: "lida", momento: "2026-10-29T12:00:00Z" }],
    };
    const r = await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    expect(r.status).toBe(200);
    expect(primeira(rpcsDe("atualizar_status")).args).toMatchObject({
      p_conexao: CONEXAO_ID,
      p_id: "MSG9",
      p_status: "lida",
    });
    const ev = primeira(falso.estado.eventos);
    expect(ev.processado_em).toBeNull();
    expect(ev.tentativas).toBe(1);
    expect(ev.erro).toBe("status_sem_mensagem");
  });

  it("erro do banco: 500, sem vazar a mensagem, e o evento fica pendente", async () => {
    falso.estado.respostaRpc = () => ({
      data: null,
      error: { code: "XX000", message: "detalhe com 5511999990000 e segredo" },
    });
    const r = await processarWebhook(pedido({ eventos: [entrada] }), "zapi", CONEXAO_ID);
    expect(r.status).toBe(500);
    const corpo = await r.text();
    expect(corpo).not.toContain("segredo");
    const ev = primeira(falso.estado.eventos);
    expect(ev.processado_em).toBeNull();
    expect(ev.erro).toBe("registrar_entrada:XX000");
  });

  it("erro ao gravar o bruto: 500", async () => {
    falso.estado.falharInsert = { code: "08006", message: "conexao caiu" };
    const r = await processarWebhook(pedido({ eventos: [entrada] }), "zapi", CONEXAO_ID);
    expect(r.status).toBe(500);
    expect(falso.estado.rpcs).toHaveLength(0);
  });

  it("gateway desconhecido, conexão inexistente ou de outro gateway: 404", async () => {
    expect((await processarWebhook(pedido({}), "outro", CONEXAO_ID)).status).toBe(404);
    expect((await processarWebhook(pedido({}), "zapi", "nao-e-uuid")).status).toBe(404);
    mocks.carregarConexao.mockResolvedValueOnce(null);
    expect((await processarWebhook(pedido({}), "zapi", CONEXAO_ID)).status).toBe(404);
    mocks.carregarConexao.mockResolvedValueOnce({ ...conexao, gateway: "meta" });
    expect((await processarWebhook(pedido({}), "zapi", CONEXAO_ID)).status).toBe(404);
  });

  it("conexão sem os segredos (desativada): 404 e nada gravado, nem com assinatura vazia", async () => {
    mocks.carregarConexao.mockResolvedValue({ ...conexao, segredos: {} });
    const r = await processarWebhook(pedido({ eventos: [entrada] }, ""), "zapi", CONEXAO_ID);
    expect(r.status).toBe(404);
    expect(falso.estado.eventos).toHaveLength(0);
    expect(falso.estado.rpcs).toHaveLength(0);

    mocks.carregarConexao.mockResolvedValue({
      ...conexao,
      segredos: { ...conexao.segredos, tokenUrl: " " },
    });
    const r2 = await processarWebhook(pedido({ eventos: [entrada] }), "zapi", CONEXAO_ID);
    expect(r2.status).toBe(404);
    expect(falso.estado.eventos).toHaveLength(0);
  });

  it("adaptador que lança no traduzir: grava o bruto e deixa pendente com traducao_falhou", async () => {
    const r = await processarWebhook(pedido({ quebrar: true }), "zapi", CONEXAO_ID);
    expect(r.status).toBe(200);
    const ev = primeira(falso.estado.eventos);
    expect(ev.processado_em).toBeNull();
    expect(ev.erro).toBe("traducao_falhou");
    expect(ev.tentativas).toBe(1);
    // só a falha do evento (falhar_evento); nada aplicado
    expect(falso.estado.rpcs.map((r) => r.nome)).toEqual(["falhar_evento"]);
  });

  it("GET sem verificação no adaptador: 404", async () => {
    const r = await processarWebhook(pedido(null, "certo", "GET"), "zapi", CONEXAO_ID);
    expect(r.status).toBe(404);
  });

  it("JSON inválido: 400", async () => {
    const r = await processarWebhook(pedido("{nao e json"), "zapi", CONEXAO_ID);
    expect(r.status).toBe(400);
    expect(falso.estado.eventos).toHaveLength(0);
  });

  it("saida_celular e conexao vão para as funções certas; ignorar não faz nada", async () => {
    const corpo = {
      eventos: [
        { tipo: "saida_celular", ids: entrada.ids, msg: { ...entrada.msg, id_externo: "S1" } },
        { tipo: "conexao", status: "desconectada", detalhe: "celular_offline" },
        { tipo: "ignorar", motivo: "grupo" },
      ],
    };
    const r = await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    expect(r.status).toBe(200);
    expect(primeira(rpcsDe("registrar_saida_celular")).args.p_msg).toMatchObject({
      id_externo: "S1",
      evento_id: 1,
    });
    expect(primeira(falso.estado.eventos).processado_em).toBeTruthy();
  });

  it("o corpo gravado sai sem apikey, destination nem o tokenUrl (formato da Evolution)", async () => {
    const corpo = {
      event: "messages.upsert",
      instance: "vendas-01",
      destination: `https://app.exemplo/api/public/whatsapp/zapi/${CONEXAO_ID}?t=tok-url-longo-123`,
      apikey: "TOKEN-DA-INSTANCIA-EVOLUTION",
      sender: "5511888888888@s.whatsapp.net",
      data: { nota: "link com inst-token-longo-1 dentro", url: "https://x/?t=tok-url-longo-123" },
      eventos: [entrada],
    };
    const segredosLongos = {
      ...conexao,
      segredos: {
        instanceToken: "inst-token-longo-1",
        clientToken: "certo",
        tokenUrl: "tok-url-longo-123",
      },
    };
    mocks.carregarConexao.mockResolvedValue(segredosLongos);
    const r = await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    expect(r.status).toBe(200);
    const gravado = JSON.stringify(primeira(falso.estado.eventos)["payload"]);
    expect(gravado).not.toContain("TOKEN-DA-INSTANCIA-EVOLUTION");
    expect(gravado).not.toContain("tok-url-longo-123");
    expect(gravado).not.toContain("inst-token-longo-1");
    expect(gravado).not.toContain("destination");
    expect(gravado).toContain("[removido]");
    // a tradução usou o corpo original: a entrada foi registrada
    expect(rpcsDe("registrar_entrada")).toHaveLength(1);
  });

  it("limparPayload apaga chaves secretas sem diferenciar maiúscula e ignora segredo curto", () => {
    expect(
      limparPayload({ ApiKey: "a", Token: "b", ok: "certo", lista: [{ secret: 1, x: "y" }] }, [
        "certo",
      ]),
    ).toEqual({ ok: "certo", lista: [{ x: "y" }] });
  });

  it("lid vai ao banco sem o sufixo @lid (mesmo formato em todo gateway)", async () => {
    const comLid: Evento = {
      ...entrada,
      ids: [
        { tipo: "lid", valor: "81896604192873@lid" },
        { tipo: "telefone", valor: "5511999990000" },
      ],
    };
    await processarWebhook(pedido({ eventos: [comLid] }), "zapi", CONEXAO_ID);
    expect(primeira(rpcsDe("registrar_entrada")).args.p_ids).toEqual([
      { tipo: "lid", valor: "81896604192873" },
      { tipo: "telefone", valor: "5511999990000" },
    ]);
  });

  it("citação: responde_a_id_externo vai no p_msg da entrada e da saída do celular", async () => {
    const corpo = {
      eventos: [
        { ...entrada, msg: { ...entrada.msg, responde_a_id_externo: "  CITADA1 " } },
        {
          tipo: "saida_celular",
          ids: entrada.ids,
          msg: { ...entrada.msg, id_externo: "S1", responde_a_id_externo: "CITADA2" },
        },
      ],
    };
    const r = await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    expect(r.status).toBe(200);
    expect(primeira(rpcsDe("registrar_entrada")).args.p_msg).toMatchObject({
      id_externo: "MSG1",
      responde_a_id_externo: "CITADA1",
      evento_id: 1,
    });
    expect(primeira(rpcsDe("registrar_saida_celular")).args.p_msg).toMatchObject({
      id_externo: "S1",
      responde_a_id_externo: "CITADA2",
    });
  });

  it("citação vazia ou ausente não vai no p_msg", async () => {
    const corpo = {
      eventos: [
        { ...entrada, msg: { ...entrada.msg, responde_a_id_externo: "   " } },
        { tipo: "saida_celular", ids: entrada.ids, msg: { ...entrada.msg, id_externo: "S1" } },
      ],
    };
    await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    expect(primeira(rpcsDe("registrar_entrada")).args.p_msg).not.toHaveProperty(
      "responde_a_id_externo",
    );
    expect(primeira(rpcsDe("registrar_saida_celular")).args.p_msg).not.toHaveProperty(
      "responde_a_id_externo",
    );
  });

  it("codigoDoErro aceita os códigos com números da Meta", () => {
    expect(codigoDoErro(new Error("meta_400_131047"))).toBe("meta_400_131047");
    expect(codigoDoErro(new Error("falhou para 5511999 com espaço"))).toBe("erro_interno");
  });
});

describe("o toque no motor depois de gravar (spec-motor-acordado)", () => {
  const ORIGEM = "https://app.exemplo";
  const status = { tipo: "status", id: "MSG9", status: "lida", momento: "2026-10-29T12:00:00Z" };

  it("200 processado: toca com a origem do pedido, depois de aplicar", async () => {
    let marcadoNoToque: unknown = "não tocou";
    mocks.acordarMotor.mockImplementation(async () => {
      marcadoNoToque = falso.estado.eventos[0]?.processado_em;
      return "tocado";
    });
    const r = await processarWebhook(pedido({ eventos: [entrada] }), "zapi", CONEXAO_ID);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok");
    expect(mocks.acordarMotor).toHaveBeenCalledTimes(1);
    expect(mocks.acordarMotor).toHaveBeenCalledWith(ORIGEM, { naHora: true });
    // o evento já estava aplicado e marcado quando o toque saiu
    expect(marcadoNoToque).toBeTruthy();
  });

  it("200 pendente (status que ainda não casa): toca", async () => {
    falso.estado.respostaRpc = () => ({ data: 0, error: null });
    const r = await processarWebhook(pedido({ eventos: [status] }), "zapi", CONEXAO_ID);
    expect(r.status).toBe(200);
    expect(primeira(falso.estado.eventos).processado_em).toBeNull();
    expect(mocks.acordarMotor).toHaveBeenCalledWith(ORIGEM, { naHora: true });
  });

  it("200 com a tradução que falhou: toca", async () => {
    const r = await processarWebhook(pedido({ quebrar: true }), "zapi", CONEXAO_ID);
    expect(r.status).toBe(200);
    expect(mocks.acordarMotor).toHaveBeenCalledTimes(1);
  });

  it("500 depois de gravar: toca, e a resposta continua 500", async () => {
    falso.estado.respostaRpc = (nome) =>
      nome === "registrar_entrada"
        ? { data: null, error: { code: "XX000", message: "x" } }
        : { data: null, error: null };
    const r = await processarWebhook(pedido({ eventos: [entrada] }), "zapi", CONEXAO_ID);
    expect(r.status).toBe(500);
    expect(await r.text()).toBe("erro");
    expect(mocks.acordarMotor).toHaveBeenCalledTimes(1);
  });

  it("a reentrega duplicada garante nova tentativa da fila sem duplicar o evento", async () => {
    const corpo = { eventos: [entrada] };
    await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    const r2 = await processarWebhook(pedido(corpo), "zapi", CONEXAO_ID);
    expect(r2.status).toBe(200);
    expect(mocks.acordarMotor).toHaveBeenCalledTimes(2);
    expect(falso.estado.eventos).toHaveLength(1);
  });

  it("antes de gravar (401, 404, 400, 500 do insert, GET), não toca", async () => {
    await processarWebhook(pedido({ eventos: [entrada] }, "errado"), "zapi", CONEXAO_ID);
    await processarWebhook(pedido({}), "outro", CONEXAO_ID);
    await processarWebhook(pedido("{nao json"), "zapi", CONEXAO_ID);
    await processarWebhook(pedido(null, "certo", "GET"), "zapi", CONEXAO_ID);
    falso.estado.falharInsert = { code: "08006", message: "caiu" };
    await processarWebhook(pedido({ eventos: [entrada] }), "zapi", CONEXAO_ID);
    expect(mocks.acordarMotor).not.toHaveBeenCalled();
  });

  it("falha da fila pede reentrega sem perder o evento gravado", async () => {
    mocks.acordarMotor.mockResolvedValueOnce("falhou");
    const r1 = await processarWebhook(pedido({ eventos: [entrada] }), "zapi", CONEXAO_ID);
    expect(r1.status).toBe(503);
    mocks.acordarMotor.mockRejectedValueOnce(new Error("inesperado"));
    const r2 = await processarWebhook(
      pedido({ eventos: [{ ...entrada, msg: { ...entrada.msg, id_externo: "MSG2" } }] }),
      "zapi",
      CONEXAO_ID,
    );
    expect(r2.status).toBe(503);
    expect(await r2.text()).toBe("fila_indisponivel");
  });

  it("só confirma o webhook depois de a fila confirmar a persistência", async () => {
    let chamou: () => void = () => {};
    let confirmar: (value: string) => void = () => {};
    const chamado = new Promise<void>((ok) => (chamou = ok));
    mocks.acordarMotor.mockImplementation(() => {
      chamou();
      return new Promise<string>((resolve) => { confirmar = resolve; });
    });
    let respondeu = false;
    const resposta = processarWebhook(pedido({ eventos: [entrada] }), "zapi", CONEXAO_ID).then(
      (r) => ((respondeu = true), r),
    );
    await chamado;
    expect(respondeu).toBe(false);
    expect(falso.estado.eventos).toHaveLength(1);
    confirmar("tocado");
    expect((await resposta).status).toBe(200);
  });
});
