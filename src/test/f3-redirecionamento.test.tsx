import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAVE_SESSION_STORAGE, ESTADO_INICIAL, limparEstadoOnboarding } from "@/features/onboarding/estado";
import { CHAVES } from "@/features/plataforma/dados";
import { routeTree } from "@/routeTree.gen";
import { destinoInicial } from "@/routes/-sessao";

// F2 (spec de ligar as telas ao banco, 2.2): a guarda de /, /onboarding, /app e /sem-acesso. A sessão
// vem de firebase.auth.getSession(); o Eu, de `membros` (carregarEu); o onboarding da empresa, de
// `configuracao.onboarding_concluido_em`. Tudo simulado aqui, sem rede nem banco.
type Linha = Record<string, unknown> | null;
const banco = vi.hoisted(() => ({
  sessao: null as null | { access_token: string; user: { id: string } },
  erroSessao: null as unknown,
  falhaSessao: null as Error | null,
  membro: null as Linha,
  configuracao: null as Linha,
  consultas: [] as string[],
}));
const getSession = vi.hoisted(() =>
  vi.fn(async () => {
    if (banco.falhaSessao) throw banco.falhaSessao;
    return { data: { session: banco.sessao }, error: banco.erroSessao };
  }),
);
vi.mock("@/integrations/firebase/client", () => {
  const from = (tabela: string) => {
    banco.consultas.push(tabela);
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: () => q,
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tabela === "membros" ? banco.membro : banco.configuracao, error: null }).then(res, rej),
    };
    return q;
  };
  return { firebase: { auth: { getSession }, from } };
});

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const comSessao = (uid = UID) => {
  banco.sessao = { access_token: "x.y.z", user: { id: uid } };
};
const semSessao = () => {
  banco.sessao = null;
};
const membro = (papel: "admin" | "atendente", ativo = true, uid = UID) => {
  banco.membro = { id: "mb-1", nome: "Ana Lima", email: "ana@teste.com", papel, ativo, user_id: uid, criado_em: "2026-10-01T12:00:00.000Z" };
};
const configuracao = (concluidoEm: string | null) => {
  banco.configuracao = { id: 1, espera_lote_s: 8, espera_lote_max_s: 40, onboarding_concluido_em: concluidoEm, atualizado_em: "2026-10-01T12:00:00.000Z" };
};

function marcarOnboardingConcluidoNaAba() {
  window.sessionStorage.setItem(
    CHAVE_SESSION_STORAGE,
    JSON.stringify({ ...ESTADO_INICIAL, etapa: "preparando", concluidoEm: "2026-10-28T12:00:00.000Z" }),
  );
}

// Carrega a URL num roteador de verdade (a árvore gerada), rodando os beforeLoad, sem renderizar.
async function abrir(url: string, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  await vi.waitFor(() => expect(router.state.status).toBe("idle"));
  return router.state.location.pathname;
}

beforeEach(() => {
  getSession.mockClear();
  banco.sessao = null;
  banco.erroSessao = null;
  banco.falhaSessao = null;
  banco.membro = null;
  banco.configuracao = null;
  banco.consultas = [];
  limparEstadoOnboarding();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("destinoInicial", () => {
  it("sem sessão vai para /entrar, com ou sem membro", () => {
    expect(destinoInicial({ logado: false, eu: null, concluido: false })).toBe("/entrar");
    expect(destinoInicial({ logado: false, eu: { papel: "admin" }, concluido: true })).toBe("/entrar");
  });

  it("com sessão e sem membro ativo vai para /sem-acesso", () => {
    expect(destinoInicial({ logado: true, eu: null, concluido: true })).toBe("/sem-acesso");
  });

  it("o admin vai para /onboarding enquanto não concluiu, e depois para /app", () => {
    expect(destinoInicial({ logado: true, eu: { papel: "admin" }, concluido: false })).toBe("/onboarding");
    expect(destinoInicial({ logado: true, eu: { papel: "admin" }, concluido: true })).toBe("/app");
  });

  it("o atendente vai sempre para /app", () => {
    expect(destinoInicial({ logado: true, eu: { papel: "atendente" }, concluido: false })).toBe("/app");
  });
});

describe("Redirecionamento de /", () => {
  it("sem sessão, / leva a /entrar e não consulta o banco", async () => {
    semSessao();
    expect(await abrir("/")).toBe("/entrar");
    expect(banco.consultas).toEqual([]);
  });

  it("sem Eu (a conta não é membro), / leva a /sem-acesso", async () => {
    comSessao();
    expect(await abrir("/")).toBe("/sem-acesso");
    expect(banco.consultas).toContain("membros");
  });

  it("Eu inativo (desativado), / leva a /sem-acesso", async () => {
    comSessao();
    membro("admin", false);
    configuracao("2026-10-28T12:00:00.000Z");
    expect(await abrir("/")).toBe("/sem-acesso");
  });

  it("admin sem o onboarding concluído, / leva a /onboarding", async () => {
    comSessao();
    membro("admin");
    configuracao(null);
    expect(await abrir("/")).toBe("/onboarding");
    expect(banco.consultas).toContain("configuracao");
  });

  it("admin com o onboarding concluído no banco, / leva à primeira área da plataforma", async () => {
    comSessao();
    membro("admin");
    configuracao("2026-10-28T12:00:00.000Z");
    expect(await abrir("/")).toBe("/app/chat");
  });

  it("o marcador da aba não conta mais: com o onboarding concluído só nesta aba (e nulo no banco), / leva a /onboarding", async () => {
    comSessao();
    membro("admin");
    configuracao(null);
    marcarOnboardingConcluidoNaAba();
    expect(await abrir("/")).toBe("/onboarding");
    expect(banco.consultas).toContain("configuracao");
  });

  it("um 'não concluído' em cache é lido de novo (o admin que acabou de concluir não volta ao onboarding)", async () => {
    comSessao();
    membro("admin");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    configuracao(null);
    expect(await abrir("/", queryClient)).toBe("/onboarding");
    // concluir_onboarding gravou a data (em outra aba, ou a tela não atualizou o cache)
    configuracao("2026-11-02T12:00:00.000Z");
    banco.consultas = [];
    expect(await abrir("/", queryClient)).toBe("/app/chat");
    expect(banco.consultas).toContain("configuracao");
  });

  it("um 'concluído' em cache vale sem reler (a data não volta a ser nula)", async () => {
    comSessao();
    membro("admin");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    configuracao("2026-11-02T12:00:00.000Z");
    expect(await abrir("/", queryClient)).toBe("/app/chat");
    banco.consultas = [];
    expect(await abrir("/", queryClient)).toBe("/app/chat");
    expect(banco.consultas).not.toContain("configuracao");
  });

  it("o atendente vai para /app sem ler a configuração (ele não passa pelo onboarding)", async () => {
    comSessao();
    membro("atendente");
    expect(await abrir("/")).toBe("/app/chat");
    expect(banco.consultas).not.toContain("configuracao");
  });

  it("se o Firebase falhar ao ler a sessão, conta como sem sessão", async () => {
    banco.falhaSessao = new Error("Missing Firebase environment variable(s)");
    expect(await abrir("/")).toBe("/entrar");
  });

  it("se o Firebase devolver erro, conta como sem sessão", async () => {
    banco.erroSessao = new Error("falhou");
    expect(await abrir("/")).toBe("/entrar");
  });

  it("um Eu guardado de outra conta não vale: lê de novo antes de decidir", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(CHAVES.eu, { id: "mb-x", nome: "Outra", email: "o@t.com", papel: "admin", ativo: true, user_id: "outra", criado_em: "", vistos: {} });
    comSessao();
    expect(await abrir("/", queryClient)).toBe("/sem-acesso");
    expect(queryClient.getQueryData(CHAVES.eu)).toBeNull();
  });
});

describe("Proteção de /onboarding, /app e /sem-acesso", () => {
  it.each(["/onboarding", "/app", "/app/kanban", "/app/configuracao", "/sem-acesso"])(
    "sem sessão, %s leva a /entrar",
    async (url) => {
      semSessao();
      expect(await abrir(url)).toBe("/entrar");
    },
  );

  it.each(["/onboarding", "/app", "/app/kanban"])("sem Eu, %s leva a /sem-acesso", async (url) => {
    comSessao();
    expect(await abrir(url)).toBe("/sem-acesso");
  });

  it.each(["/onboarding", "/app/chat"])("Eu inativo, %s leva a /sem-acesso", async (url) => {
    comSessao();
    membro("atendente", false);
    expect(await abrir(url)).toBe("/sem-acesso");
  });

  it.each([
    ["/app", "/app/chat"],
    ["/app/kanban", "/app/kanban"],
    ["/app/configuracao", "/app/configuracao"],
  ])("com Eu, %s abre %s e deixa o Eu no cache para o Layout", async (url, destino) => {
    comSessao();
    membro("admin");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(await abrir(url, queryClient)).toBe(destino);
    expect(queryClient.getQueryData(CHAVES.eu)).toMatchObject({ nome: "Ana Lima", papel: "admin" });
  });

  it("o atendente em /onboarding vai para /app", async () => {
    comSessao();
    membro("atendente");
    expect(await abrir("/onboarding")).toBe("/app/chat");
  });

  it("o admin sem onboarding concluído fica em /onboarding", async () => {
    comSessao();
    membro("admin");
    configuracao(null);
    expect(await abrir("/onboarding")).toBe("/onboarding");
  });

  it("o marcador da aba não tira o admin de /onboarding enquanto o banco não tiver a data", async () => {
    comSessao();
    membro("admin");
    configuracao(null);
    marcarOnboardingConcluidoNaAba();
    expect(await abrir("/onboarding")).toBe("/onboarding");
  });

  it("o admin com o onboarding concluído em /onboarding vai para /app", async () => {
    comSessao();
    membro("admin");
    configuracao("2026-10-28T12:00:00.000Z");
    expect(await abrir("/onboarding")).toBe("/app/chat");
  });

  it("quem tem acesso não fica em /sem-acesso: segue para o destino dele", async () => {
    comSessao();
    membro("atendente");
    expect(await abrir("/sem-acesso")).toBe("/app/chat");
  });

  it("sem Eu, /sem-acesso abre", async () => {
    comSessao();
    expect(await abrir("/sem-acesso")).toBe("/sem-acesso");
  });

  it.each(["/entrar", "/criar-conta"])("%s abre sem sessão e não consulta o Firebase", async (url) => {
    semSessao();
    expect(await abrir(url)).toBe(url);
    expect(getSession).not.toHaveBeenCalled();
  });
});
