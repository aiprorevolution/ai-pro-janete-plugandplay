import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdaptadorGateway, ConexaoServidor } from "@/features/mensageria/nucleo/tipos";

// Firebase falso: o cliente do usuário (rpc eh_membro / eh_admin e a linha de membros) e o
// firebaseAdmin (tabelas e Storage). Cada operação vai para um registro único, em ordem, para
// conferir o que vem antes do quê. Nada vai à rede nem ao banco.

type Passo = [string, ...unknown[]];
type Consulta = { tabela: string; passos: Passo[] };
type Resposta = { data: unknown; error: unknown };

const estado = vi.hoisted(() => ({
  admin: null as unknown,
  garantirBucket: vi.fn(),
  rodarCiclo: vi.fn(),
  acordarMotor: vi.fn(),
  conexaoAtiva: vi.fn(),
  adaptadorDe: vi.fn(),
  destinoDoContato: vi.fn(),
}));

vi.mock("@/integrations/firebase/client.server", () => ({
  get firebaseAdmin() {
    if (!estado.admin) throw new Error("o firebaseAdmin não devia ser usado neste caso");
    return estado.admin;
  },
}));
vi.mock("@/features/mensageria/nucleo/midia.server", () => ({
  garantirBucket: estado.garantirBucket,
}));
vi.mock("@/features/mensageria/nucleo/ciclo.server", () => ({
  rodarCiclo: estado.rodarCiclo,
  ORCAMENTO_SOMENTE_ENVIOS_MS: 18_500,
}));
vi.mock("@/features/mensageria/nucleo/motor.server", () => ({
  acordarMotor: estado.acordarMotor,
}));
vi.mock("@/features/mensageria/nucleo/conexoes.server", () => ({
  conexaoAtiva: estado.conexaoAtiva,
}));
vi.mock("@/features/mensageria/gateways", () => ({ adaptadorDe: estado.adaptadorDe }));
vi.mock("@/features/mensageria/nucleo/banco.server", () => ({
  destinoDoContato: estado.destinoDoContato,
}));

import {
  LOTE_STORAGE,
  acordarMotorPelaTelaLogica,
  apagarContatoLogica,
  garantirBucketMidiasLogica,
  marcarLidaNoWhatsAppLogica,
  pedirEnvioLogica,
  type ContextoUsuario,
} from "./servidor.server";

const USUARIO = "a0000000-0000-4000-8000-000000000001";
const MEMBRO = "9d1c7a20-0000-4000-8000-000000000001";
const CONTATO = "c0000000-0000-4000-8000-0000000000c1";
const CONVERSA = "d0000000-0000-4000-8000-0000000000d1";
const CONEXAO = "e0000000-0000-4000-8000-0000000000e1";

// ---------- cliente do usuário ----------

function contexto(papel: { membro?: boolean; admin?: boolean } = {}) {
  const { membro = true, admin = true } = papel;
  const rpc = vi.fn(async (nome: string) => {
    if (nome === "eh_membro") return { data: membro, error: null };
    if (nome === "eh_admin") return { data: admin && membro, error: null };
    return { data: null, error: { message: "rpc desconhecida" } };
  });
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => ({ data: membro ? { id: MEMBRO } : null, error: null }),
  };
  const ctx = { firebase: { rpc, from: () => consulta }, userId: USUARIO };
  return { ctx: ctx as unknown as ContextoUsuario, rpc };
}

// ---------- firebaseAdmin falso ----------

interface OpcoesAdmin {
  consulta?: (c: Consulta) => Resposta | undefined;
  listar?: (pasta: string, opcoes: { limit: number; offset: number }) => Resposta;
  remover?: (caminhos: string[]) => Resposta;
}

function criarAdmin(o: OpcoesAdmin = {}) {
  const registro: string[] = [];
  const consultas: Consulta[] = [];
  const removidos: string[][] = [];

  const responder = (c: Consulta): Resposta => o.consulta?.(c) ?? { data: null, error: null };

  const from = (tabela: string) => {
    const c: Consulta = { tabela, passos: [] };
    let anotado = false;
    const anotar = () => {
      if (anotado) return;
      anotado = true;
      consultas.push(c);
      registro.push(`${tabela}.${c.passos[0]?.[0] ?? "?"}`);
    };
    const construtor: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, prop) {
          if (prop === "then") {
            anotar();
            const r = responder(c);
            return (ok: (v: unknown) => unknown, falhou: (e: unknown) => unknown) =>
              Promise.resolve(r).then(ok, falhou);
          }
          if (prop === "maybeSingle") {
            return async () => {
              c.passos.push(["maybeSingle"]);
              anotar();
              return responder(c);
            };
          }
          return (...args: unknown[]) => {
            c.passos.push([String(prop), ...args]);
            return construtor;
          };
        },
      },
    );
    return construtor;
  };

  const storage = {
    from: (bucket: string) => ({
      list: async (pasta: string, opcoes: { limit: number; offset: number }) => {
        registro.push(`storage.list:${bucket}/${pasta}@${opcoes.offset}`);
        return o.listar?.(pasta, opcoes) ?? { data: [], error: null };
      },
      remove: async (caminhos: string[]) => {
        registro.push(`storage.remove:${bucket}`);
        removidos.push(caminhos);
        return o.remover?.(caminhos) ?? { data: caminhos.map((name) => ({ name })), error: null };
      },
    }),
  };

  const admin = { from, storage };
  estado.admin = admin;
  return { registro, consultas, removidos };
}

function passo(c: Consulta, nome: string): unknown[] | undefined {
  return c.passos.find((p) => p[0] === nome);
}

function arquivo(nome: string) {
  return { name: nome, id: `id-${nome}` };
}

beforeEach(() => {
  estado.admin = null;
  estado.garantirBucket.mockReset();
  estado.rodarCiclo.mockReset();
  estado.conexaoAtiva.mockReset();
  estado.adaptadorDe.mockReset();
  estado.destinoDoContato.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------- apagarContato ----------

describe("apagarContatoLogica", () => {
  function adminDoContato(o: { contato?: unknown; midias?: unknown[]; apagadas?: number; listar?: OpcoesAdmin["listar"]; remover?: OpcoesAdmin["remover"] } = {}) {
    const contato = "contato" in o ? o.contato : { id: CONTATO, nome: "Ana Teste", nome_whatsapp: "Ana" };
    return criarAdmin({
      listar: o.listar ?? (() => ({ data: [arquivo("m1"), arquivo("m2")], error: null })),
      ...(o.remover ? { remover: o.remover } : {}),
      consulta: (c) => {
        if (c.tabela === "contatos" && passo(c, "select") && !passo(c, "delete")) return { data: contato, error: null };
        if (c.tabela === "conversas") return { data: [{ id: CONVERSA }], error: null };
        if (c.tabela === "mensagens") return { data: o.midias ?? [], error: null };
        if (c.tabela === "contatos" && passo(c, "delete")) {
          return { data: Array.from({ length: o.apagadas ?? 1 }, () => ({ id: CONTATO })), error: null };
        }
        if (c.tabela === "auditoria") return { data: [{ id: 1 }], error: null };
        return undefined;
      },
    });
  }

  it("apaga os arquivos de midias/{conversa_id}/ antes da linha do contato e grava a auditoria com o nome", async () => {
    const { registro, consultas, removidos } = adminDoContato();
    const { ctx } = contexto();

    const r = await apagarContatoLogica(ctx, { contatoId: CONTATO });

    expect(r).toEqual({ ok: true });
    expect(removidos).toEqual([[`${CONVERSA}/m1`, `${CONVERSA}/m2`]]);
    const iRemove = registro.indexOf("storage.remove:midias");
    const iDelete = registro.indexOf("contatos.delete");
    const iAuditoria = registro.indexOf("auditoria.insert");
    expect(registro[0]).toBe("contatos.select");
    expect(registro).toContain(`storage.list:midias/${CONVERSA}@0`);
    expect(iRemove).toBeGreaterThan(-1);
    expect(iDelete).toBeGreaterThan(iRemove);
    expect(iAuditoria).toBeGreaterThan(iDelete);

    const del = consultas.find((c) => c.tabela === "contatos" && passo(c, "delete"))!;
    expect(passo(del, "eq")).toEqual(["eq", "id", CONTATO]);
    expect(passo(del, "select")).toEqual(["select", "id"]);

    const aud = consultas.find((c) => c.tabela === "auditoria")!;
    expect(passo(aud, "insert")?.[1]).toEqual({
      acao: "contato_apagado",
      alvo: CONTATO,
      ator_membro_id: MEMBRO,
      detalhe: { nome: "Ana Teste" },
    });
  });

  it("pasta com mais de 1.000 arquivos: lista página por página e apaga em lotes", async () => {
    const total = LOTE_STORAGE + 3;
    const { removidos, registro } = adminDoContato({
      listar: (_pasta, { offset, limit }) => ({
        data: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => arquivo(`m${offset + i}`)),
        error: null,
      }),
    });
    const { ctx } = contexto();

    expect(await apagarContatoLogica(ctx, { contatoId: CONTATO })).toEqual({ ok: true });
    expect(registro.filter((l) => l.startsWith("storage.list"))).toEqual([
      `storage.list:midias/${CONVERSA}@0`,
      `storage.list:midias/${CONVERSA}@${LOTE_STORAGE}`,
    ]);
    expect(removidos.map((l) => l.length)).toEqual([LOTE_STORAGE, 3]);
    expect(removidos.flat()).toHaveLength(total);
  });

  it("sem arquivos: não chama o remove e apaga o contato", async () => {
    const { removidos, registro } = adminDoContato({ listar: () => ({ data: [], error: null }) });
    const { ctx } = contexto();
    expect(await apagarContatoLogica(ctx, { contatoId: CONTATO })).toEqual({ ok: true });
    expect(removidos).toEqual([]);
    expect(registro).toContain("contatos.delete");
  });

  it("subpasta (item sem id) não entra na lista de arquivos", async () => {
    const { removidos } = adminDoContato({
      listar: () => ({ data: [arquivo("m1"), { name: "sub", id: null }], error: null }),
    });
    const { ctx } = contexto();
    await apagarContatoLogica(ctx, { contatoId: CONTATO });
    expect(removidos).toEqual([[`${CONVERSA}/m1`]]);
  });

  it("o bucket que ainda não existe conta como pasta vazia", async () => {
    const { registro } = adminDoContato({
      listar: () => ({ data: null, error: { message: "Bucket not found", statusCode: "404" } }),
    });
    const { ctx } = contexto();
    expect(await apagarContatoLogica(ctx, { contatoId: CONTATO })).toEqual({ ok: true });
    expect(registro).toContain("contatos.delete");
  });

  it("sem admin (atendente): sem_acesso, e nada é lido nem apagado com a chave de serviço", async () => {
    const { ctx } = contexto({ admin: false });
    // sem estado.admin: se a lógica tocar no firebaseAdmin, o teste quebra
    expect(await apagarContatoLogica(ctx, { contatoId: CONTATO })).toEqual({ ok: false, erro: "sem_acesso" });
  });

  it("quem não é membro: sem_acesso", async () => {
    const { ctx } = contexto({ membro: false, admin: false });
    expect(await apagarContatoLogica(ctx, { contatoId: CONTATO })).toEqual({ ok: false, erro: "sem_acesso" });
  });

  it("o admin é conferido com o cliente do usuário (rpc eh_admin)", async () => {
    adminDoContato();
    const { ctx, rpc } = contexto();
    await apagarContatoLogica(ctx, { contatoId: CONTATO });
    expect(rpc).toHaveBeenCalledWith("eh_admin");
  });

  it("contato inexistente: nao_encontrado, sem mexer no Storage nem apagar nada", async () => {
    const { registro } = adminDoContato({ contato: null });
    const { ctx } = contexto();
    expect(await apagarContatoLogica(ctx, { contatoId: CONTATO })).toEqual({ ok: false, erro: "nao_encontrado" });
    expect(registro).toEqual(["contatos.select"]);
  });

  it("id que não é uuid: nao_encontrado (como o 22P02), sem consulta", async () => {
    const { ctx } = contexto();
    expect(await apagarContatoLogica(ctx, { contatoId: "abc" })).toEqual({ ok: false, erro: "nao_encontrado" });
  });

  it("o remove do Storage falha: o contato fica (nada de mídia órfã) e volta falha", async () => {
    const { registro } = adminDoContato({ remover: () => ({ data: null, error: { message: "boom" } }) });
    const { ctx } = contexto();
    expect(await apagarContatoLogica(ctx, { contatoId: CONTATO })).toEqual({
      ok: false,
      erro: "falha",
      mensagem: "midias_nao_apagadas",
    });
    expect(registro).not.toContain("contatos.delete");
    expect(registro).not.toContain("auditoria.insert");
  });

  it("a listagem falha (sem ser bucket inexistente): o contato fica", async () => {
    const { registro } = adminDoContato({ listar: () => ({ data: null, error: { message: "boom", statusCode: "500" } }) });
    const { ctx } = contexto();
    const r = await apagarContatoLogica(ctx, { contatoId: CONTATO });
    expect(r).toEqual({ ok: false, erro: "falha", mensagem: "midias_nao_listadas" });
    expect(registro).not.toContain("contatos.delete");
  });

  it("prévia sem identidade Storage permite apagar contato comprovadamente sem mídia", async () => {
    const { registro } = adminDoContato({ listar: () => ({ data: null, error: { code: "storage_indisponivel" } }) });
    expect(await apagarContatoLogica(contexto().ctx, { contatoId: CONTATO })).toEqual({ ok: true });
    expect(registro).toContain("mensagens.select");
    expect(registro).toContain("contatos.delete");
  });

  it("prévia sem identidade Storage preserva contato que possui mídia", async () => {
    const { registro } = adminDoContato({ midias: [{ id: "mensagem-com-midia" }], listar: () => ({ data: null, error: { code: "storage_indisponivel" } }) });
    expect(await apagarContatoLogica(contexto().ctx, { contatoId: CONTATO })).toMatchObject({ ok: false, erro: "falha" });
    expect(registro).not.toContain("contatos.delete");
  });

  it("o DELETE que não atinge linha (outro admin apagou antes): nao_encontrado, sem auditoria", async () => {
    const { registro } = adminDoContato({ apagadas: 0 });
    const { ctx } = contexto();
    expect(await apagarContatoLogica(ctx, { contatoId: CONTATO })).toEqual({ ok: false, erro: "nao_encontrado" });
    expect(registro).not.toContain("auditoria.insert");
  });

  it("sem nome: a auditoria guarda o nome do WhatsApp; sem os dois, nome nulo (nunca o telefone)", async () => {
    const um = adminDoContato({ contato: { id: CONTATO, nome: "  ", nome_whatsapp: "Zé do Zap" } });
    await apagarContatoLogica(contexto().ctx, { contatoId: CONTATO });
    const aud1 = um.consultas.find((c) => c.tabela === "auditoria")!;
    expect((passo(aud1, "insert")?.[1] as { detalhe: unknown }).detalhe).toEqual({ nome: "Zé do Zap" });

    const dois = adminDoContato({ contato: { id: CONTATO, nome: null, nome_whatsapp: null } });
    await apagarContatoLogica(contexto().ctx, { contatoId: CONTATO });
    const aud2 = dois.consultas.find((c) => c.tabela === "auditoria")!;
    expect((passo(aud2, "insert")?.[1] as { detalhe: unknown }).detalhe).toEqual({ nome: null });
  });

  it("a auditoria que falha não desfaz nem muda a resposta", async () => {
    criarAdmin({
      consulta: (c) => {
        if (c.tabela === "contatos" && !passo(c, "delete")) return { data: { id: CONTATO, nome: "Ana", nome_whatsapp: null }, error: null };
        if (c.tabela === "conversas") return { data: [], error: null };
        if (c.tabela === "contatos") return { data: [{ id: CONTATO }], error: null };
        if (c.tabela === "auditoria") return { data: null, error: { message: "sem grant" } };
        return undefined;
      },
    });
    expect(await apagarContatoLogica(contexto().ctx, { contatoId: CONTATO })).toEqual({ ok: true });
    expect(console.error).toHaveBeenCalledWith("auditoria_falhou", "contato_apagado");
  });
});

// ---------- pedirEnvio ----------

describe("pedirEnvioLogica", () => {
  const resumo = {
    envios: { enviados: 2, falhas: 1, devolvidos: 0, incertos: 0 },
  };

  beforeEach(() => {
    estado.rodarCiclo.mockReset();
    estado.acordarMotor.mockReset().mockResolvedValue("tocado");
  });

  it("roda o ciclo só com os envios, com o orçamento que cabe uma mídia, e devolve só as contagens", async () => {
    estado.rodarCiclo.mockResolvedValue(resumo);
    const r = await pedirEnvioLogica(contexto({ admin: false }).ctx);
    expect(estado.rodarCiclo).toHaveBeenCalledTimes(1);
    expect(estado.rodarCiclo).toHaveBeenCalledWith({ somenteEnvios: true, orcamentoMs: 18_500 });
    expect(r).toEqual({ ok: true, enviados: 2, falhas: 1, devolvidos: 0, incertos: 0 });
  });

  it("o ciclo de envio roda como sistema, mesmo pedido por um membro logado (as operações internas exigem o sistema)", async () => {
    // Teste real: com a identidade do usuário, pegar_envios era recusado e a mensagem ficava "na_fila".
    const { requestIdentity, currentActor } = await import("@/integrations/firebase/identity.server");
    let atorNoCiclo: unknown;
    let atorNoToque: unknown;
    estado.rodarCiclo.mockImplementation(async () => { atorNoCiclo = currentActor(); return resumo; });
    estado.acordarMotor.mockImplementation(async () => { atorNoToque = currentActor(); return "tocado"; });
    await requestIdentity.run({ actor: { uid: "membro", verified: true }, token: "do-usuario" }, () =>
      pedirEnvioLogica(contexto().ctx));
    expect(atorNoCiclo).toMatchObject({ system: true });
    expect(atorNoToque).toMatchObject({ system: true });
  });

  it("quem não é membro: sem_acesso, sem rodar o ciclo", async () => {
    const { ctx, rpc } = contexto({ membro: false });
    expect(await pedirEnvioLogica(ctx)).toEqual({ ok: false, erro: "sem_acesso" });
    expect(rpc).toHaveBeenCalledWith("eh_membro");
    expect(estado.rodarCiclo).not.toHaveBeenCalled();
    expect(estado.acordarMotor).not.toHaveBeenCalled();
  });

  it("o ciclo que lança vira falha com um código fixo", async () => {
    estado.rodarCiclo.mockRejectedValue(new Error("Falha com dado: +55 11 99999-0000"));
    expect(await pedirEnvioLogica(contexto().ctx)).toEqual({ ok: false, erro: "falha", mensagem: "envio_indisponivel" });
  });

  it("no fim, pede o toque no motor com a origem do pedido, depois da passada", async () => {
    estado.rodarCiclo.mockResolvedValue(resumo);
    await pedirEnvioLogica(contexto().ctx, { origem: "https://janete.exemplo.com" });
    expect(estado.acordarMotor).toHaveBeenCalledTimes(1);
    expect(estado.acordarMotor).toHaveBeenCalledWith("https://janete.exemplo.com", { naHora: true });
    expect(estado.rodarCiclo.mock.invocationCallOrder[0]!).toBeLessThan(
      estado.acordarMotor.mock.invocationCallOrder[0]!,
    );
  });

  it("toca também quando a passada falha; sem origem, toca com o endereço já gravado", async () => {
    estado.rodarCiclo.mockRejectedValue(new Error("x"));
    await pedirEnvioLogica(contexto().ctx);
    expect(estado.acordarMotor).toHaveBeenCalledWith(null, { naHora: true });
  });

  it("o toque que lança não muda o resultado da passada", async () => {
    estado.rodarCiclo.mockResolvedValue(resumo);
    estado.acordarMotor.mockRejectedValue(new Error("inesperado"));
    expect(await pedirEnvioLogica(contexto().ctx)).toEqual({
      ok: true,
      enviados: 2,
      falhas: 1,
      devolvidos: 0,
      incertos: 0,
    });
  });
});

// ---------- acordarMotorPelaTela ----------

describe("acordarMotorPelaTelaLogica", () => {
  beforeEach(() => {
    estado.acordarMotor.mockReset().mockResolvedValue("tocado");
  });

  it("membro (não precisa ser admin): pede o toque com a origem e devolve o resultado", async () => {
    const r = await acordarMotorPelaTelaLogica(contexto({ admin: false }).ctx, {
      origem: "https://janete.exemplo.com",
    });
    expect(r).toEqual({ ok: true, toque: "tocado" });
    expect(estado.acordarMotor).toHaveBeenCalledWith("https://janete.exemplo.com", { naHora: true });
  });

  it("quem não é membro: sem_acesso, sem tocar", async () => {
    const { ctx, rpc } = contexto({ membro: false });
    expect(await acordarMotorPelaTelaLogica(ctx, { origem: "https://janete.exemplo.com" })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(rpc).toHaveBeenCalledWith("eh_membro");
    expect(estado.acordarMotor).not.toHaveBeenCalled();
  });

  it("devolve o recente e o falhou como vieram; o toque que lança vira falha com código fixo", async () => {
    estado.acordarMotor.mockResolvedValueOnce("recente");
    expect(await acordarMotorPelaTelaLogica(contexto().ctx)).toEqual({
      ok: true,
      toque: "recente",
    });
    estado.acordarMotor.mockRejectedValueOnce(new Error("Falha com dado: https://x"));
    expect(await acordarMotorPelaTelaLogica(contexto().ctx)).toEqual({
      ok: false,
      erro: "falha",
      mensagem: "motor_indisponivel",
    });
  });
});

// ---------- garantirBucketMidias ----------

describe("garantirBucketMidiasLogica", () => {
  it("membro: garante o bucket", async () => {
    estado.garantirBucket.mockResolvedValue(undefined);
    expect(await garantirBucketMidiasLogica(contexto({ admin: false }).ctx)).toEqual({ ok: true });
    expect(estado.garantirBucket).toHaveBeenCalledTimes(1);
  });

  it("quem não é membro: sem_acesso, sem criar nada", async () => {
    expect(await garantirBucketMidiasLogica(contexto({ membro: false }).ctx)).toEqual({ ok: false, erro: "sem_acesso" });
    expect(estado.garantirBucket).not.toHaveBeenCalled();
  });

  it("bucket público: falha com o código", async () => {
    estado.garantirBucket.mockRejectedValue(new Error("bucket_publico"));
    expect(await garantirBucketMidiasLogica(contexto().ctx)).toEqual({ ok: false, erro: "falha", mensagem: "bucket_publico" });
  });
});

// ---------- marcarLidaNoWhatsApp ----------

describe("marcarLidaNoWhatsAppLogica", () => {
  const conexao: ConexaoServidor = {
    id: CONEXAO,
    gateway: "meta",
    id_externo: "106540352242922",
    parametros: {},
    segredos: { token: "x" },
    oficial: true,
  } as ConexaoServidor;
  const destino = [{ tipo: "telefone", valor: "5511999990000" }];

  function adminDaConversa(o: { conversa?: unknown; ultimaSaida?: string | null; entradas?: { id_externo: string | null }[] } = {}) {
    return criarAdmin({
      consulta: (c) => {
        if (c.tabela === "conversas") return { data: "conversa" in o ? o.conversa : { id: CONVERSA }, error: null };
        if (c.tabela === "mensagens" && c.passos.some((p) => p[0] === "eq" && p[1] === "direcao" && p[2] === "saida")) {
          const momento = o.ultimaSaida === undefined ? "2026-11-02T10:00:00-03:00" : o.ultimaSaida;
          return { data: momento ? [{ momento }] : [], error: null };
        }
        if (c.tabela === "mensagens") {
          // a consulta vem da mais nova para a mais antiga
          return { data: o.entradas ?? [{ id_externo: "wamid.3" }, { id_externo: "wamid.2" }], error: null };
        }
        return undefined;
      },
    });
  }

  function adaptador(marcarLida?: AdaptadorGateway["marcarLida"]) {
    return { gateway: "meta", marcarLidaEDigitando: vi.fn(), ...(marcarLida ? { marcarLida } : {}) };
  }

  it("quem não é membro: sem_acesso, sem ler a conversa nem chamar o gateway", async () => {
    const { ctx, rpc } = contexto({ membro: false });
    expect(await marcarLidaNoWhatsAppLogica(ctx, { conversaId: CONVERSA })).toEqual({ ok: false, erro: "sem_acesso" });
    expect(rpc).toHaveBeenCalledWith("eh_membro");
    expect(estado.conexaoAtiva).not.toHaveBeenCalled();
  });

  it("pede o lido pelo marcarLida do adaptador da conexão ativa, com as entradas em ordem de tempo", async () => {
    const { consultas } = adminDaConversa();
    const marcarLida = vi.fn(async () => true);
    estado.conexaoAtiva.mockResolvedValue(conexao);
    estado.adaptadorDe.mockReturnValue(adaptador(marcarLida));
    estado.destinoDoContato.mockResolvedValue(destino);

    const r = await marcarLidaNoWhatsAppLogica(contexto({ admin: false }).ctx, { conversaId: CONVERSA });

    expect(r).toEqual({ ok: true, marcada: true });
    expect(estado.adaptadorDe).toHaveBeenCalledWith("meta");
    expect(estado.destinoDoContato).toHaveBeenCalledWith(CONVERSA, CONEXAO);
    expect(marcarLida).toHaveBeenCalledTimes(1);
    const [ref, c, opcoes] = marcarLida.mock.calls[0] as unknown as [unknown, unknown, { fimEm: number }];
    expect(ref).toEqual({ destino, ids_externos: ["wamid.2", "wamid.3"] });
    expect(c).toBe(conexao);
    expect(opcoes.fimEm).toBeGreaterThan(Date.now());

    const entradas = consultas.find(
      (q) => q.tabela === "mensagens" && q.passos.some((p) => p[0] === "eq" && p[1] === "direcao" && p[2] === "entrada"),
    )!;
    expect(entradas.passos).toContainEqual(["eq", "conversa_id", CONVERSA]);
    expect(entradas.passos).toContainEqual(["eq", "conexao_id", CONEXAO]);
    expect(entradas.passos).toContainEqual(["gt", "momento", "2026-11-02T10:00:00-03:00"]);
    expect(entradas.passos).toContainEqual(["limit", 20]);
  });

  it("sem saída na conversa: pega as entradas desde o começo (sem o corte por momento)", async () => {
    const { consultas } = adminDaConversa({ ultimaSaida: null });
    estado.conexaoAtiva.mockResolvedValue(conexao);
    estado.adaptadorDe.mockReturnValue(adaptador(vi.fn(async () => true)));
    estado.destinoDoContato.mockResolvedValue(destino);
    await marcarLidaNoWhatsAppLogica(contexto().ctx, { conversaId: CONVERSA });
    const entradas = consultas.filter((q) => q.tabela === "mensagens").at(-1)!;
    expect(entradas.passos.some((p) => p[0] === "gt")).toBe(false);
  });

  it("adaptador sem marcarLida (Zernio): ok sem fazer nada", async () => {
    const { consultas } = adminDaConversa();
    estado.conexaoAtiva.mockResolvedValue({ ...conexao, gateway: "zernio" });
    const ad = adaptador();
    estado.adaptadorDe.mockReturnValue(ad);
    expect(await marcarLidaNoWhatsAppLogica(contexto().ctx, { conversaId: CONVERSA })).toEqual({ ok: true, marcada: false });
    expect(consultas.some((q) => q.tabela === "mensagens")).toBe(false);
    expect(ad.marcarLidaEDigitando).not.toHaveBeenCalled();
    expect(estado.destinoDoContato).not.toHaveBeenCalled();
  });

  it("sem conexão ativa: ok, marcada false", async () => {
    adminDaConversa();
    estado.conexaoAtiva.mockResolvedValue(null);
    expect(await marcarLidaNoWhatsAppLogica(contexto().ctx, { conversaId: CONVERSA })).toEqual({ ok: true, marcada: false });
    expect(estado.adaptadorDe).not.toHaveBeenCalled();
  });

  it("o gateway que recusa (false) é normal: ok, marcada false", async () => {
    adminDaConversa();
    estado.conexaoAtiva.mockResolvedValue(conexao);
    estado.adaptadorDe.mockReturnValue(adaptador(vi.fn(async () => false)));
    estado.destinoDoContato.mockResolvedValue(destino);
    expect(await marcarLidaNoWhatsAppLogica(contexto().ctx, { conversaId: CONVERSA })).toEqual({ ok: true, marcada: false });
  });

  it("sem entrada com id_externo: não chama o gateway", async () => {
    adminDaConversa({ entradas: [] });
    const marcarLida = vi.fn(async () => true);
    estado.conexaoAtiva.mockResolvedValue(conexao);
    estado.adaptadorDe.mockReturnValue(adaptador(marcarLida));
    expect(await marcarLidaNoWhatsAppLogica(contexto().ctx, { conversaId: CONVERSA })).toEqual({ ok: true, marcada: false });
    expect(marcarLida).not.toHaveBeenCalled();
  });

  it("conversa inexistente: nao_encontrado", async () => {
    adminDaConversa({ conversa: null });
    expect(await marcarLidaNoWhatsAppLogica(contexto().ctx, { conversaId: CONVERSA })).toEqual({ ok: false, erro: "nao_encontrado" });
    expect(estado.conexaoAtiva).not.toHaveBeenCalled();
  });

  it("id que não é uuid: nao_encontrado", async () => {
    expect(await marcarLidaNoWhatsAppLogica(contexto().ctx, { conversaId: "cv-1" })).toEqual({ ok: false, erro: "nao_encontrado" });
  });
});
