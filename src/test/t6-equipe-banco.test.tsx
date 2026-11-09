import { StrictMode, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task C7 (spec de ligar as telas ao banco; decisões 1, 4 e 15): a Equipe no modo banco, com um
// cliente do Firebase falso (nada vai à rede). Confere as leituras (membros inclusive desativados,
// convites só do admin, conversas com cada pessoa, a fila com "Estava com"), as ações (rpcs e funções
// de servidor do convite) com os códigos de erro do banco, e os 3 estados da tela.

const servidor = vi.hoisted(() => ({
  convidarMembro: vi.fn(),
  linkDoConvite: vi.fn(),
  reenviarConvite: vi.fn(),
  cancelarConvite: vi.fn(),
}));
vi.mock("@/features/plataforma/equipe/equipe.functions", () => ({
  convidarMembro: (o: { data: { email: string; papel: string } }) => servidor.convidarMembro(o.data),
  linkDoConvite: (o: { data: { conviteId: string } }) => servidor.linkDoConvite(o.data),
  reenviarConvite: (o: { data: { conviteId: string } }) => servidor.reenviarConvite(o.data),
  cancelarConvite: (o: { data: { conviteId: string } }) => servidor.cancelarConvite(o.data),
  aceitarConvite: vi.fn(),
}));

import { CHAVES } from "@/features/plataforma/dados/chaves";
import type { ClienteFirebase } from "@/features/plataforma/dados/colunas";
import {
  COLUNAS_CONVITE,
  LOTE_IDS,
  TABELAS_EQUIPE,
  criarAcoesEquipeBanco,
  estavaComDosEventos,
  juntarConversas,
  juntarLeituras,
  opcoesConversasDaEquipe,
  type ServidorEquipe,
} from "@/features/plataforma/dados/equipe";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { TRAVA_PROPRIO, TRAVA_UNICO_ADMIN, TelaEquipe, idDoBotao } from "@/features/plataforma/equipe";
import { AVISO_RELEITURA_EQUIPE, textoDaRecusa } from "@/features/plataforma/equipe/TelaEquipe";
import type { Conversa, Membro } from "@/features/plataforma/exemplo/tipos";

const AGORA = new Date("2026-11-02T15:00:00.000Z"); // segunda, 12:00 em São Paulo

const UID = "a0000000-0000-4000-8000-000000000001";
const EU = "9d1c7a20-0000-4000-8000-000000000001";
const ANA = "9d1c7a20-0000-4000-8000-000000000002";
const LUIS = "9d1c7a20-0000-4000-8000-000000000003";
const CONVITE = "c0000000-0000-4000-8000-0000000000c1";
const ETAPA = "e0000000-0000-4000-8000-0000000000e1";

const membro = (id: string, nome: string, o: Partial<Membro> = {}): Membro & { vistos: object } => ({
  id,
  nome,
  email: `${nome.toLowerCase()}@empresa.com`,
  papel: "atendente",
  ativo: true,
  user_id: id === EU ? UID : null,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
  ...o,
});

const conversa = (id: string, contato: string, o: Partial<Conversa> = {}): Conversa => ({
  id,
  contato_id: contato,
  conexao_id: null,
  modo: "humano",
  motivo_humano: null,
  responsavel_id: null,
  aguardando_humano_desde: null,
  devolvida_em: null,
  nao_lidas: 0,
  ultima_do_lead_em: null,
  ultima_mensagem_em: "2026-11-02T14:00:00.000Z",
  ultima_mensagem_preview: null,
  criado_em: "2026-11-01T12:00:00.000Z",
  atualizado_em: "2026-11-01T12:00:00.000Z",
  ...o,
});

const contato = (id: string, nome: string) => ({ id, nome, nome_whatsapp: null, telefone: null, etapa_id: ETAPA });

type Passo = [string, ...unknown[]];
type Consulta = { tabela: string; passos: Passo[] };
type Resposta = { data: unknown; error: unknown };

/** O banco falso: as linhas de cada tabela e as respostas das rpcs. */
interface Banco {
  membros: Array<Membro & { vistos: object }>;
  convites: Array<{ id: string; email: string; papel: string; convidado_por: string | null; enviado_em: string }>;
  conversas: Conversa[];
  contatos: ReturnType<typeof contato>[];
  eventos: Array<{ id: string; conversa_id: string; tipo: string; de_membro_id: string | null; criado_em: string }>;
  rpc: (nome: string, args: unknown) => Resposta;
  /** Falha forçada numa tabela (a leitura dá erro). */
  falhar?: Partial<Record<string, unknown>>;
  /** Uma tabela que nunca responde (carregando). */
  pendurar?: string;
}

const tem = (c: Consulta, passo: string) => c.passos.some((p) => p[0] === passo);
const argsDe = (c: Consulta, passo: string) => c.passos.find((p) => p[0] === passo);

function responder(b: Banco, c: Consulta): Resposta {
  const erro = b.falhar?.[c.tabela];
  if (erro) return { data: null, error: erro };
  switch (c.tabela) {
    case "membros":
      if (tem(c, "maybeSingle")) return { data: b.membros.find((m) => m.user_id === UID) ?? null, error: null };
      return { data: b.membros, error: null };
    case "etapas":
      return {
        data: [{ id: ETAPA, chave: "novo", nome: "Novo", ordem: 1, tipo: "aberta", cor: null, janete_pode_mover: true, arquivada: false }],
        error: null,
      };
    case "convites":
      return { data: b.convites, error: null };
    case "conversas": {
      // A leitura da fila (useAguardando) usa .is("responsavel_id", null); a da Equipe usa .or(...).
      if (tem(c, "is")) {
        return { data: b.conversas.filter((x) => x.modo === "humano" && !x.responsavel_id && x.aguardando_humano_desde), error: null };
      }
      return { data: b.conversas.filter((x) => x.modo === "humano" && (x.responsavel_id || x.aguardando_humano_desde)), error: null };
    }
    case "contatos": {
      const ids = (argsDe(c, "in")?.[2] ?? []) as string[];
      return { data: b.contatos.filter((x) => ids.includes(x.id)), error: null };
    }
    case "conversa_eventos": {
      const ids = (argsDe(c, "in")?.[2] ?? []) as string[];
      return { data: b.eventos.filter((x) => ids.includes(x.conversa_id)), error: null };
    }
    default:
      return { data: [], error: null };
  }
}

function criarCliente(b: Banco) {
  const consultas: Consulta[] = [];
  const rpcs: Array<[string, unknown]> = [];
  const from = (tabela: string) => {
    const c: Consulta = { tabela, passos: [] };
    const resposta = (): Promise<Resposta> => {
      consultas.push(c);
      if (b.pendurar === tabela) return new Promise(() => {});
      return Promise.resolve(responder(b, c));
    };
    const construtor: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, prop) {
          if (prop === "then") {
            const r = resposta();
            return (ok: (v: unknown) => unknown, falhou: (e: unknown) => unknown) => r.then(ok, falhou);
          }
          if (prop === "maybeSingle" || prop === "single") {
            return () => {
              c.passos.push([String(prop)]);
              return resposta();
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
  const cliente = {
    from,
    rpc: async (nome: string, args: unknown) => {
      rpcs.push([nome, args]);
      return b.rpc(nome, args);
    },
    auth: {
      getSession: async () => ({ data: { session: { user: { id: UID } } }, error: null }),
    },
  };
  return { cliente: cliente as unknown as ClienteFirebase, consultas, rpcs };
}

function bancoPadrao(): Banco {
  return {
    membros: [
      membro(EU, "equipe", { papel: "admin" }),
      membro(ANA, "Ana"),
      membro(LUIS, "Luis", { ativo: false }),
    ],
    convites: [{ id: CONVITE, email: "bia@empresa.com", papel: "atendente", convidado_por: EU, enviado_em: "2026-10-30T15:00:00.000Z" }],
    conversas: [
      conversa("d0000000-0000-4000-8000-000000000001", "f0000000-0000-4000-8000-000000000001", { responsavel_id: ANA }),
      conversa("d0000000-0000-4000-8000-000000000002", "f0000000-0000-4000-8000-000000000002", { responsavel_id: ANA }),
      // voltou do Luis (desativado): o último evento é voltou_para_fila
      conversa("d0000000-0000-4000-8000-000000000003", "f0000000-0000-4000-8000-000000000003", {
        aguardando_humano_desde: "2026-11-02T14:50:00.000Z",
      }),
      // a Janete passou: sem "Estava com"
      conversa("d0000000-0000-4000-8000-000000000004", "f0000000-0000-4000-8000-000000000004", {
        aguardando_humano_desde: "2026-11-02T14:40:00.000Z",
        motivo_humano: "janete_passou",
      }),
      // com a Janete: fora da Equipe
      conversa("d0000000-0000-4000-8000-000000000005", "f0000000-0000-4000-8000-000000000005", { modo: "janete" }),
    ],
    contatos: [
      contato("f0000000-0000-4000-8000-000000000001", "Carla"),
      contato("f0000000-0000-4000-8000-000000000002", "Bruno"),
      contato("f0000000-0000-4000-8000-000000000003", "Patrícia"),
      contato("f0000000-0000-4000-8000-000000000004", "Rafael"),
    ],
    eventos: [
      { id: "1", conversa_id: "d0000000-0000-4000-8000-000000000003", tipo: "assumiu", de_membro_id: null, criado_em: "2026-11-01T10:00:00.000Z" },
      { id: "2", conversa_id: "d0000000-0000-4000-8000-000000000003", tipo: "voltou_para_fila", de_membro_id: LUIS, criado_em: "2026-11-02T14:50:00.000Z" },
      { id: "3", conversa_id: "d0000000-0000-4000-8000-000000000004", tipo: "voltou_para_fila", de_membro_id: LUIS, criado_em: "2026-11-01T09:00:00.000Z" },
      { id: "4", conversa_id: "d0000000-0000-4000-8000-000000000004", tipo: "passou", de_membro_id: null, criado_em: "2026-11-02T14:40:00.000Z" },
    ],
    rpc: () => ({ data: null, error: null }),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  for (const f of Object.values(servidor)) f.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const assentar = () =>
  act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });

async function montar(b: Banco) {
  const { cliente, consultas, rpcs } = criarCliente(b);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const raiz = createRootRoute({ component: () => <Outlet /> });
  const equipe = createRoute({ getParentRoute: () => raiz, path: "/app/equipe", component: TelaEquipe });
  const chat = createRoute({ getParentRoute: () => raiz, path: "/app/chat", component: () => <h1>Chat</h1> });
  const router = createRouter({
    routeTree: raiz.addChildren([equipe, chat]),
    history: createMemoryHistory({ initialEntries: ["/app/equipe"] }),
  });
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ProvedorDados fonte="banco" cliente={cliente}>
          <Suspense fallback={<p>suspenso</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </ProvedorDados>
      </QueryClientProvider>
    </StrictMode>,
  );
  await screen.findByRole("heading", { level: 1, name: "Equipe" });
  // Espera a tela pronta (a não ser que o teste force o carregando ou o erro).
  if (!b.pendurar && !b.falhar) await screen.findByRole("region", { name: "Quem atende" });
  await assentar();
  return { consultas, rpcs, queryClient };
}

const fila = () => screen.getByRole("region", { name: /^Precisam de você/ });
const cartao = (nome: string) => screen.getByRole("article", { name: nome });
const aviso = () => screen.getByRole("status", { name: "" });
const textoDoAviso = () => document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? "";

/* ---------- as leituras puras ---------- */

describe("estavaComDosEventos", () => {
  it("só marca quando o último evento da conversa é voltou_para_fila", () => {
    const m = estavaComDosEventos(bancoPadrao().eventos);
    expect([...m.entries()]).toEqual([["d0000000-0000-4000-8000-000000000003", LUIS]]);
  });

  it("no empate do instante, o maior id é o último", () => {
    const m = estavaComDosEventos([
      { id: "b", conversa_id: "x", tipo: "voltou_para_fila", de_membro_id: LUIS, criado_em: "2026-11-02T10:00:00.000Z" },
      { id: "a", conversa_id: "x", tipo: "assumiu", de_membro_id: null, criado_em: "2026-11-02T10:00:00.000Z" },
    ]);
    expect(m.get("x")).toBe(LUIS);
  });
});

describe("juntarConversas", () => {
  it("a fila manda em quem espera; a leitura da Equipe dá o 'Estava com' e as conversas com alguém", () => {
    const naFila = conversa("1", "c1", { aguardando_humano_desde: "2026-11-02T14:00:00.000Z" });
    const daEquipe = [{ ...naFila, estavaCom: LUIS }, conversa("2", "c2", { responsavel_id: ANA }), conversa("3", "c3", { aguardando_humano_desde: "x" })];
    const juntas = juntarConversas([naFila], daEquipe);
    expect(juntas.map((c) => [c.id, c.estavaCom ?? null])).toEqual([
      ["1", LUIS],
      ["2", null],
    ]);
  });
});

describe("opcoesConversasDaEquipe", () => {
  it("lê só as conversas humanas com alguém ou esperando, os contatos e os eventos em lotes de 100", async () => {
    const b = bancoPadrao();
    // 250 conversas esperando: 3 lotes de contatos e 3 de eventos.
    b.conversas = Array.from({ length: 250 }, (_, i) =>
      conversa(`d-${i}`, `f-${i}`, { aguardando_humano_desde: "2026-11-02T14:00:00.000Z" }),
    );
    b.contatos = b.conversas.map((c) => contato(c.contato_id, `Lead ${c.id}`));
    b.eventos = [];
    const { cliente, consultas } = criarCliente(b);
    const r = await opcoesConversasDaEquipe(cliente).queryFn!({} as never);
    expect(r.conversas).toHaveLength(250);
    expect(r.contatos).toHaveLength(250);
    const conv = consultas.find((c) => c.tabela === "conversas")!;
    expect(argsDe(conv, "eq")).toEqual(["eq", "modo", "humano"]);
    expect(argsDe(conv, "or")).toEqual(["or", "responsavel_id.not.is.null,aguardando_humano_desde.not.is.null"]);
    // paginada (o PostgREST corta em 1.000) e com desempate pelo id
    expect(argsDe(conv, "range")).toEqual(["range", 0, 999]);
    expect(argsDe(conv, "order")).toEqual(["order", "id", { ascending: true }]);
    const lotes = consultas.filter((c) => c.tabela === "contatos").map((c) => (argsDe(c, "in")![2] as string[]).length);
    expect(lotes).toEqual([LOTE_IDS, LOTE_IDS, 50]);
    expect(consultas.filter((c) => c.tabela === "conversa_eventos")).toHaveLength(3);
    // colunas listadas, nunca '*'
    expect(consultas.every((c) => argsDe(c, "select")?.[1] !== "*")).toBe(true);
  });
});

/* ---------- as ações ---------- */

describe("criarAcoesEquipeBanco", () => {
  const falso = (r: Partial<Record<keyof ServidorEquipe, unknown>> = {}): ServidorEquipe =>
    ({
      convidarMembro: vi.fn(async () => r.convidarMembro ?? { ok: true, conviteId: CONVITE }),
      linkDoConvite: vi.fn(async () => r.linkDoConvite ?? { ok: true, link: "https://auth.exemplo/l" }),
      reenviarConvite: vi.fn(async () => r.reenviarConvite ?? { ok: true }),
      cancelarConvite: vi.fn(async () => r.cancelarConvite ?? { ok: true }),
    }) as unknown as ServidorEquipe;

  it("desativar chama desativar_membro e devolve as conversas que voltaram; invalida membros, conversas e eventos", async () => {
    const b = bancoPadrao();
    b.rpc = (nome) => (nome === "desativar_membro" ? { data: ["d1", "d2"], error: null } : { data: null, error: null });
    const { cliente, rpcs } = criarCliente(b);
    const qc = new QueryClient();
    const espiao = vi.spyOn(qc, "invalidateQueries");
    const acoes = criarAcoesEquipeBanco(cliente, qc, falso());
    expect(await acoes.desativar(ANA)).toEqual({ ok: true, valor: ["d1", "d2"] });
    expect(rpcs).toEqual([["desativar_membro", { p_membro: ANA }]]);
    const chaves = espiao.mock.calls.map((c) => (c[0] as { queryKey: readonly string[] }).queryKey[0]);
    for (const raiz of ["membros", "eu", "conversas", "aguardando", "eventos", "auditoria"]) expect(chaves).toContain(raiz);
    expect(TABELAS_EQUIPE.desativar).toEqual(["membros", "conversas", "conversa_eventos", "auditoria"]);
  });

  it("os códigos do banco: proprio_membro, ultimo_admin, sem_acesso (que relê o Eu) e nao_encontrado", async () => {
    const b = bancoPadrao();
    const erros: Record<string, string> = {
      trocar_papel_membro: "ultimo_admin",
      desativar_membro: "proprio_membro",
      reativar_membro: "sem_acesso",
    };
    b.rpc = (nome) => ({ data: null, error: { code: "P0001", message: erros[nome] ?? "nao_encontrado" } });
    const { cliente } = criarCliente(b);
    const qc = new QueryClient();
    const espiao = vi.spyOn(qc, "invalidateQueries");
    const acoes = criarAcoesEquipeBanco(cliente, qc, falso());
    expect(await acoes.trocarPapel(ANA, "atendente")).toEqual({ ok: false, erro: "ultimo_admin" });
    expect(await acoes.desativar(EU)).toEqual({ ok: false, erro: "proprio_membro" });
    expect(espiao).not.toHaveBeenCalled();
    expect(await acoes.reativar(LUIS)).toEqual({ ok: false, erro: "sem_acesso" });
    expect(espiao).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
  });

  it("o convite: o id, o aviso de e-mail não enviado, a recusa da conta que já existe e a falha de rede", async () => {
    const { cliente } = criarCliente(bancoPadrao());
    const qc = new QueryClient();
    let s = falso();
    let acoes = criarAcoesEquipeBanco(cliente, qc, s);
    expect(await acoes.convidar("bia@x.com", "admin")).toEqual({ ok: true, id: CONVITE });
    expect(s.convidarMembro).toHaveBeenCalledWith("bia@x.com", "admin");

    s = falso({ convidarMembro: { ok: true, conviteId: CONVITE, aviso: "email_nao_enviado" } });
    acoes = criarAcoesEquipeBanco(cliente, qc, s);
    expect(await acoes.convidar("bia@x.com", "admin")).toEqual({ ok: true, id: CONVITE, aviso: "email_nao_enviado" });

    s = falso({ convidarMembro: { ok: false, erro: "email_em_uso", mensagem: "conta" } });
    acoes = criarAcoesEquipeBanco(cliente, qc, s);
    expect(await acoes.convidar("bia@x.com", "admin")).toEqual({ ok: false, erro: "email_em_uso", detalhe: "conta" });

    s = falso();
    (s.reenviarConvite as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    acoes = criarAcoesEquipeBanco(cliente, qc, s);
    expect(await acoes.reenviarConvite(CONVITE)).toEqual({ ok: false, erro: "falha", detalhe: "Failed to fetch" });

    expect(await acoes.linkDoConvite(CONVITE)).toEqual({ ok: true, valor: "https://auth.exemplo/l" });
    expect(await acoes.cancelarConvite(CONVITE)).toEqual({ ok: true });
  });
});

/* ---------- a tela no modo banco ---------- */

describe("TelaEquipe no banco", () => {
  it("mostra a fila com 'Estava com Luis', os cartões (inclusive o desativado) e o convite com há quantos dias saiu", async () => {
    const { consultas } = await montar(bancoPadrao());
    const itens = within(fila()).getAllByRole("listitem");
    // A que espera há mais tempo primeiro: o Rafael (14:40), depois a Patrícia (14:50).
    expect(itens).toHaveLength(2);
    expect(itens[0]!.textContent).toContain("Rafael");
    expect(itens[1]!.textContent).toContain("Patrícia");
    expect(itens[1]!.textContent).toContain("Estava com Luis");
    expect(itens[0]!.textContent).not.toContain("Estava com");
    expect(itens[0]!.textContent).toContain("A Janete pediu ajuda");

    const ana = cartao("Ana");
    expect(within(ana).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Carla, Novo. Abrir no Chat",
      "Bruno, Novo. Abrir no Chat",
    ]);
    expect(within(cartao("Luis")).getByText("Desativado")).toBeTruthy();
    const convite = cartao("bia@empresa.com");
    expect(within(convite).getByText("Convite criado há 3 dias")).toBeTruthy();
    // os convites com as colunas listadas (sem user_id)
    expect(argsDe(consultas.find((c) => c.tabela === "convites")!, "select")?.[1]).toBe(COLUNAS_CONVITE);
  });

  it("o atendente não lê convites e não vê os botões", async () => {
    const b = bancoPadrao();
    b.membros = [membro(EU, "equipe"), membro(ANA, "Ana", { papel: "admin" })];
    const { consultas } = await montar(b);
    expect(consultas.some((c) => c.tabela === "convites")).toBe(false);
    expect(screen.queryByText("bia@empresa.com")).toBeNull();
    expect(screen.queryByRole("button", { name: "Convidar pessoa" })).toBeNull();
    expect(screen.getByText("Só um admin convida pessoas, troca o papel e desativa.")).toBeTruthy();
  });

  it("carregando: o esqueleto com o h1 da área", async () => {
    const b = bancoPadrao();
    b.pendurar = "conversas";
    await montar(b);
    expect(screen.getByRole("status", { name: "Carregando a equipe" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /^Precisam de você/ })).toBeNull();
  });

  it("erro de leitura: o aviso com Tentar de novo, que relê e mostra a tela", async () => {
    const b = bancoPadrao();
    // 42501 (sem permissão) não é repetido sozinho: o erro aparece na hora.
    b.falhar = { convites: { code: "42501", message: "permission denied" } };
    await montar(b);
    expect(await screen.findByText("Não deu para carregar a equipe")).toBeTruthy();
    expect(screen.getByText("Sua conta não tem acesso a isto.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /^Precisam de você/ })).toBeNull();
    b.falhar = {};
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("article", { name: "bia@empresa.com" })).toBeTruthy();
  });

  it("a releitura que falha com a tela pronta não troca a tela: a gaveta e o e-mail ficam, e um aviso compacto oferece Tentar de novo", async () => {
    const b = bancoPadrao();
    const { queryClient } = await montar(b);
    fireEvent.click(screen.getByRole("button", { name: "Convidar pessoa" }));
    const campo = within(screen.getByRole("dialog", { name: "Convidar pessoa" })).getByLabelText("E-mail") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "quase@empresa.com" } });
    // a releitura dos convites (a cada 60 s ou no foco) falha em segundo plano
    b.falhar = { convites: { code: "42501", message: "permission denied" } };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: CHAVES.convites });
    });
    // o React Query avisa os leitores num setTimeout: espera o aviso aparecer
    expect(await screen.findByText(AVISO_RELEITURA_EQUIPE)).toBeTruthy();
    expect(screen.queryByText("Não deu para carregar a equipe")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Convidar pessoa" })).toBeTruthy();
    expect((within(screen.getByRole("dialog", { name: "Convidar pessoa" })).getByLabelText("E-mail") as HTMLInputElement).value).toBe(
      "quase@empresa.com",
    );
    expect(screen.getByRole("article", { name: "bia@empresa.com" })).toBeTruthy();
    // o Tentar de novo relê, e o aviso sai
    b.falhar = {};
    fireEvent.click(screen.getByText("Tentar de novo"));
    await waitFor(() => expect(screen.queryByText(AVISO_RELEITURA_EQUIPE)).toBeNull());
    expect(screen.getByRole("dialog", { name: "Convidar pessoa" })).toBeTruthy();
  });

  it("juntarLeituras: com dados em todas, os dados saem mesmo com o erro de uma releitura", () => {
    const l = <T,>(dados: T | undefined, erro: "sem_acesso" | null = null) => ({ dados, carregando: false, erro, tentarDeNovo: () => {} });
    const comErro = juntarLeituras([l([1]), l([2], "sem_acesso")], () => "base");
    expect(comErro).toMatchObject({ dados: "base", erro: "sem_acesso", carregando: false });
    const semDados = juntarLeituras([l([1]), l(undefined, "sem_acesso")], () => "base");
    expect(semDados).toMatchObject({ dados: undefined, erro: "sem_acesso" });
  });

  it("desativar a Ana chama a rpc e conta as conversas que voltaram, realçando-as", async () => {
    const b = bancoPadrao();
    b.rpc = (nome, args) => {
      if (nome !== "desativar_membro") return { data: null, error: null };
      expect(args).toEqual({ p_membro: ANA });
      // o banco: a Ana desativada e as 2 conversas dela na fila, com o evento
      b.membros = b.membros.map((m) => (m.id === ANA ? { ...m, ativo: false } : m));
      b.conversas = b.conversas.map((c) =>
        c.responsavel_id === ANA ? { ...c, responsavel_id: null, aguardando_humano_desde: AGORA.toISOString() } : c,
      );
      b.eventos.push(
        { id: "9", conversa_id: "d0000000-0000-4000-8000-000000000001", tipo: "voltou_para_fila", de_membro_id: ANA, criado_em: AGORA.toISOString() },
        { id: "10", conversa_id: "d0000000-0000-4000-8000-000000000002", tipo: "voltou_para_fila", de_membro_id: ANA, criado_em: AGORA.toISOString() },
      );
      return { data: ["d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002"], error: null };
    };
    await montar(b);
    fireEvent.click(document.getElementById(idDoBotao({ tipo: "desativar", id: ANA }))!);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Desativar Ana" }));
    await assentar();
    expect(textoDoAviso()).toBe("Ana não entra mais na plataforma. 2 conversas voltaram para “Precisam de você”.");
    const itens = within(fila()).getAllByRole("listitem");
    expect(itens).toHaveLength(4);
    const realcadas = itens.filter((li) => li.hasAttribute("data-destaque"));
    expect(realcadas.map((li) => li.textContent?.includes("Estava com Ana"))).toEqual([true, true]);
    expect(within(cartao("Ana")).getByText("Desativado")).toBeTruthy();
    expect(document.activeElement).toBe(document.getElementById(idDoBotao({ tipo: "reativar", id: ANA })));
  });

  it("os erros do banco com o texto da tela: ultimo_admin e proprio_membro", async () => {
    const b = bancoPadrao();
    b.rpc = (nome) => ({ data: null, error: { code: "P0001", message: nome === "trocar_papel_membro" ? "ultimo_admin" : "proprio_membro" } });
    await montar(b);
    fireEvent.click(document.getElementById(idDoBotao({ tipo: "admin", id: ANA }))!);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Tornar admin" }));
    await assentar();
    expect(textoDoAviso()).toBe(TRAVA_UNICO_ADMIN);
    fireEvent.click(document.getElementById(idDoBotao({ tipo: "desativar", id: ANA }))!);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Desativar Ana" }));
    await assentar();
    expect(textoDoAviso()).toBe(TRAVA_PROPRIO);
  });

  it("Copiar link pede o link ao servidor e põe na área de transferência", async () => {
    const escrever = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    servidor.linkDoConvite.mockResolvedValue({ ok: true, link: "https://auth.exemplo/verify?token=9" });
    await montar(bancoPadrao());
    fireEvent.click(within(cartao("bia@empresa.com")).getByRole("button", { name: "Copiar link" }));
    await assentar();
    expect(servidor.linkDoConvite).toHaveBeenCalledWith({ conviteId: CONVITE });
    expect(escrever).toHaveBeenCalledWith("https://auth.exemplo/verify?token=9");
    expect(textoDoAviso()).toBe("Link do convite de bia@empresa.com copiado. Mande para a pessoa: ela entra por ele com a conta Google convidada.");
  });

  it("Copiar link no Safari: o clipboard.write sai ainda dentro do clique, com a promessa do link", async () => {
    // O Safari só aceita copiar dentro do clique: a cópia é pedida antes de o servidor responder.
    const conteudos: Record<string, Promise<Blob>>[] = [];
    class ClipboardItemFalso {
      constructor(public itens: Record<string, Promise<Blob>>) {
        conteudos.push(itens);
      }
    }
    vi.stubGlobal("ClipboardItem", ClipboardItemFalso);
    const escreverItem = vi.fn(async (itens: ClipboardItemFalso[]) => {
      await itens[0]!.itens["text/plain"];
    });
    const escreverTexto = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    Object.defineProperty(navigator, "clipboard", { value: { write: escreverItem, writeText: escreverTexto }, configurable: true });
    let responder: (v: unknown) => void = () => {};
    servidor.linkDoConvite.mockReturnValue(new Promise((r) => (responder = r)));
    try {
      await montar(bancoPadrao());
      fireEvent.click(within(cartao("bia@empresa.com")).getByRole("button", { name: "Copiar link" }));
      // ainda dentro do clique: o servidor não respondeu, e a cópia já foi pedida
      expect(escreverItem).toHaveBeenCalledTimes(1);
      responder({ ok: true, link: "https://auth.exemplo/verify?token=7" });
      await assentar();
      const blob = await conteudos[0]!["text/plain"]!;
      // o Blob do jsdom não tem .text(): lido pelo FileReader
      const lido = await new Promise<string>((ok) => {
        const leitor = new FileReader();
        leitor.onload = () => ok(String(leitor.result));
        leitor.readAsText(blob);
      });
      expect(blob.type).toBe("text/plain");
      expect(lido).toBe("https://auth.exemplo/verify?token=7");
      expect(escreverTexto).not.toHaveBeenCalled();
      expect(textoDoAviso()).toBe("Link do convite de bia@empresa.com copiado. Mande para a pessoa: ela entra por ele com a conta Google convidada.");
      expect(document.querySelector("[data-link-manual]")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Copiar link recusado pelo navegador: o link fica à mostra, num campo só de leitura já selecionado", async () => {
    const escrever = vi.fn(async (_t: string) => {
      throw new Error("NotAllowedError");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    servidor.linkDoConvite.mockResolvedValue({ ok: true, link: "https://auth.exemplo/verify?token=9" });
    await montar(bancoPadrao());
    fireEvent.click(within(cartao("bia@empresa.com")).getByRole("button", { name: "Copiar link" }));
    await assentar();
    expect(escrever).toHaveBeenCalledWith("https://auth.exemplo/verify?token=9");
    expect(screen.getByText("Copie o link abaixo")).toBeTruthy();
    const campo = screen.getByLabelText("Link do convite de bia@empresa.com") as HTMLInputElement;
    expect(campo.readOnly).toBe(true);
    expect(campo.value).toBe("https://auth.exemplo/verify?token=9");
    expect(document.activeElement).toBe(campo);
    expect(campo.selectionStart).toBe(0);
    expect(campo.selectionEnd).toBe(campo.value.length);
    // nunca diz "Tente de novo" (falharia igual)
    expect(document.body.textContent).not.toMatch(/Tente de novo/);
    fireEvent.click(screen.getByRole("button", { name: "Dispensar aviso" }));
    expect(document.querySelector("[data-link-manual]")).toBeNull();
  });

  it("Renovar com o e-mail que não saiu avisa para usar o Copiar link", async () => {
    servidor.reenviarConvite.mockResolvedValue({ ok: true, aviso: "email_nao_enviado" });
    await montar(bancoPadrao());
    fireEvent.click(within(cartao("bia@empresa.com")).getByRole("button", { name: "Renovar" }));
    await assentar();
    expect(servidor.reenviarConvite).toHaveBeenCalledWith({ conviteId: CONVITE });
    expect(textoDoAviso()).toBe(
      "O convite para bia@empresa.com está criado, mas o e-mail não saiu. Use Copiar link no cartão e mande o link para a pessoa.",
    );
  });

  it("convidar: o e-mail que já está num convite volta com o texto na gaveta; o convite novo fecha a gaveta", async () => {
    servidor.convidarMembro.mockResolvedValueOnce({ ok: false, erro: "email_em_uso", mensagem: "convite" });
    await montar(bancoPadrao());
    fireEvent.click(screen.getByRole("button", { name: "Convidar pessoa" }));
    const gaveta = screen.getByRole("dialog", { name: "Convidar pessoa" });
    const campo = within(gaveta).getByLabelText("E-mail");
    fireEvent.change(campo, { target: { value: "novo@empresa.com" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await assentar();
    expect(servidor.convidarMembro).toHaveBeenCalledWith({ email: "novo@empresa.com", papel: "atendente" });
    expect(within(gaveta).getByRole("alert").textContent).toBe("Esse e-mail já está na equipe ou num convite.");
    // o e-mail que já tem conta (criada sem convite) não é mais recusado: o "conta" só sobra para o
    // convite cuja conta foi trocada por outra com o mesmo e-mail
    expect(textoDaRecusa("email_em_uso", "convite", "conta")).toBe(
      "Esse e-mail passou a ser de outra conta. Cancele este convite e convide de novo.",
    );

    servidor.convidarMembro.mockResolvedValueOnce({ ok: true, conviteId: "c0000000-0000-4000-8000-0000000000c2" });
    fireEvent.keyDown(campo, { key: "Enter" });
    await assentar();
    expect(screen.queryByRole("dialog", { name: "Convidar pessoa" })).toBeNull();
    expect(textoDoAviso()).toBe("Convite criado para novo@empresa.com. Use Copiar link e compartilhe com a pessoa.");
  });
});

void aviso;
