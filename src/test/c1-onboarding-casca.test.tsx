import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Onboarding } from "@/features/onboarding/Onboarding";
import {
  CHAVE_SESSION_STORAGE,
  gravarEstadoOnboarding,
  ESTADO_INICIAL,
  lerEstadoOnboarding,
  limparEstadoOnboarding,
  temEstadoNaAba,
} from "@/features/onboarding/estado";
import {
  NADA_GRAVADO,
  criarDadosOnboardingMemoria,
  type DadosOnboarding,
  type GravadoOnboarding,
  type OpcoesDadosMemoria,
} from "@/features/plataforma/dados/onboarding";

const RESPOSTAS = {
  empresa_oferta: "Loja Teste",
  cliente_ideal: "a",
  preco: "b",
  diferenciais: "c",
  objecoes: "d",
  quando_passar_humano: "e",
  tom_voz: "f",
  horario: "g",
};
const TUDO_GRAVADO: GravadoOnboarding = {
  conexao: { gateway: "zapi", nome: "+55 11 90000-0000" },
  cerebro: { provedor: "openai", modelo: "gpt-teste", ultimos4: "abcd" },
  voz: null,
  escuta: false,
  contexto: { id: 3, respostas: RESPOSTAS },
};

/**
 * Os dados do onboarding sem banco. Sem estado na aba, nada gravado (começa do WhatsApp); com
 * estado na aba, tudo gravado (a etapa da aba vale, como nos testes de antes da C8).
 */
function dadosTeste(opcoes: OpcoesDadosMemoria = {}): DadosOnboarding {
  return criarDadosOnboardingMemoria({ gravado: temEstadoNaAba() ? TUDO_GRAVADO : NADA_GRAVADO, ...opcoes });
}

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth } }));

const voo = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  useVooJanete: () => voo,
}));

// A casca é testada com etapas de mentira (as de verdade têm os testes delas, c2 a c5).
const etapaFalsa = vi.hoisted(() => (titulo: string, ultima = false) => {
  return function EtapaFalsa({ avancar, voltar }: { avancar: () => void; voltar: () => void }) {
    return (
      <section>
        <h1 tabIndex={-1}>{titulo}</h1>
        <button type="button" onClick={voltar}>
          Voltar
        </button>
        <button type="button" onClick={avancar}>
          {ultima ? "Ir para a plataforma" : "Avançar"}
        </button>
      </section>
    );
  };
});
vi.mock("@/features/onboarding/conexao", () => ({ EtapaConexao: etapaFalsa("WhatsApp") }));
vi.mock("@/features/onboarding/cerebro", () => ({ EtapaCerebro: etapaFalsa("Cérebro") }));
vi.mock("@/features/onboarding/despertar", () => ({ EtapaDespertar: etapaFalsa("Janete") }));
vi.mock("@/features/onboarding/voz", () => ({ EtapaVoz: etapaFalsa("Voz") }));
vi.mock("@/features/onboarding/conversa", () => ({ EtapaConversa: etapaFalsa("Conversa") }));
vi.mock("@/features/onboarding/preparando", () => ({ EtapaPreparando: etapaFalsa("Preparo", true) }));

beforeEach(() => {
  limparEstadoOnboarding();
  voo.ativo = false;
  voo.soltar.mockReset();
  voo.legenda.mockReset();
  auth.signOut.mockReset();
  auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => window.sessionStorage.clear());

const trilha = () => within(screen.getByRole("navigation", { name: "Etapas do onboarding" })).getAllByRole("listitem");

describe("casca do onboarding", () => {
  it("a trilha tem os 7 itens (os do F e a Voz), com o atual marcado e a Plataforma nunca atual", () => {
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    const itens = trilha();
    expect(itens.map((li) => li.textContent)).toEqual([
      "Passo 1 de 7, WhatsApp (atual)01WhatsApp",
      "Passo 2 de 7, Cérebro02Cérebro",
      "Passo 3 de 7, Janete03Janete",
      "Passo 4 de 7, Voz04Voz",
      "Passo 5 de 7, Conversa05Conversa",
      "Passo 6 de 7, Preparo06Preparo",
      "Passo 7 de 7, Plataforma07Plataforma",
    ]);
    expect(itens[0]).toHaveAttribute("aria-current", "step");
    // Os seguintes não são clicáveis.
    expect(within(screen.getByRole("navigation", { name: "Etapas do onboarding" })).queryAllByRole("button")).toHaveLength(0);
  });

  it("cada rótulo da trilha leva o próprio texto para reservar a largura em negrito (o passo atual não empurra os outros)", () => {
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    const rotulos = trilha().map((li) => li.querySelector("[data-texto]"));
    expect(rotulos.map((r) => r?.getAttribute("data-texto"))).toEqual([
      "WhatsApp",
      "Cérebro",
      "Janete",
      "Voz",
      "Conversa",
      "Preparo",
      "Plataforma",
    ]);
    rotulos.forEach((r) => expect(r?.textContent).toBe(r?.getAttribute("data-texto")));
  });

  it("passos feitos têm check e levam de volta a eles; na última etapa a Plataforma segue não atual", () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "preparando" });
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    const nav = screen.getByRole("navigation", { name: "Etapas do onboarding" });
    expect(within(nav).getAllByRole("button")).toHaveLength(5);
    expect(trilha()[5]).toHaveAttribute("aria-current", "step");
    expect(trilha()[6]).not.toHaveAttribute("aria-current");

    fireEvent.click(within(nav).getByRole("button", { name: "Passo 2 de 7, Cérebro (feito)" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cérebro");
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
    expect(within(nav).getAllByRole("button")).toHaveLength(1);
  });

  it("a marca mostra 'Janete, em repouso' nas etapas 1 e 2 e sai da barra no despertar (uma marca só)", () => {
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    const barra = document.getElementById("onb-nav")!;
    expect(within(barra).getByRole("img", { name: "AI PRO Janete" })).toBeInTheDocument();
    expect(within(barra).getByText("em repouso")).toBeInTheDocument();
    // A marca AI PRO fica fixa; o estado da assistente continua ao lado dela.
    const arte = barra.querySelector('img[src="/brand/aipro-icone.png"]');
    expect(arte).not.toBeNull();
    expect(arte).toHaveAttribute("alt", "");
    expect(barra.querySelector("[data-estado='dormindo']")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(within(barra).getByText("em repouso")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(within(barra).queryByText("em repouso")).toBeNull();
    expect(within(barra).queryByText("online")).toBeNull();
  });

  it("a marca volta na Voz, já 'online', e sai de novo na Conversa (P7: vale pela etapa, não pelo índice)", () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "voz" });
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Voz");
    const barra = document.getElementById("onb-nav")!;
    expect(within(barra).getByRole("img", { name: "AI PRO Janete" })).toBeInTheDocument();
    expect(within(barra).getByText("online")).toBeInTheDocument();
    // depois do despertar a Janete está acordada: a arte não dorme
    expect(barra.querySelector("svg[data-dorme]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conversa");
    expect(within(barra).queryByText("online")).toBeNull();
  });

  it("na Voz, com o símbolo em trânsito por cima, a marca espera (uma marca só)", () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "voz" });
    voo.ativo = true;
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    const barra = document.getElementById("onb-nav")!;
    expect(within(barra).queryByText("online")).toBeNull();
  });

  it("veio do login com o símbolo em trânsito: a marca espera, o anúncio fala da conta criada e o foco fica com a etapa", () => {
    voo.ativo = true;
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    const barra = document.getElementById("onb-nav")!;
    expect(within(barra).queryByText("em repouso")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Conta criada. Preparando o seu espaço…");
    // A etapa conexão leva o foco à primeira opção quando o símbolo pousa; a casca não mexe.
    expect(document.activeElement).toBe(document.body);
  });

  it("primeira pintura sem voo (Entrar, link direto, recarregar): se a etapa não focou nada, o foco vai para o título", async () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro" });
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    // a etapa tem a vez (a conexão foca a primeira opção aos 60 ms); a casca espera 100 ms
    expect(document.activeElement).toBe(document.body);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Cérebro" })),
    );
  });

  it("primeira pintura: se o foco já está em algum lugar (a etapa focou), a casca não tira", async () => {
    const botao = document.createElement("button");
    document.body.appendChild(botao);
    botao.focus();
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    await new Promise((r) => setTimeout(r, 150));
    expect(document.activeElement).toBe(botao);
    botao.remove();
  });

  it("clicar num passo feito no meio de um voo solta o símbolo e a legenda antes de trocar de etapa", () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "despertar" });
    const ordem: string[] = [];
    voo.soltar.mockImplementation(() => ordem.push("soltar"));
    voo.legenda.mockImplementation((t: unknown) => ordem.push(t === null ? "legenda:null" : "legenda"));
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste()} />);
    const nav = screen.getByRole("navigation", { name: "Etapas do onboarding" });
    fireEvent.click(within(nav).getByRole("button", { name: "Passo 2 de 7, Cérebro (feito)" }));
    expect(ordem).toEqual(["legenda:null", "soltar"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cérebro");
  });

  it("Sair chama o signOut, limpa o estado e vai para /entrar", async () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro" });
    const raiz = createRootRoute();
    const rotas = [
      createRoute({ getParentRoute: () => raiz, path: "/onboarding", component: () => <Onboarding aoConcluir={() => {}} dados={dadosTeste()} /> }),
      createRoute({ getParentRoute: () => raiz, path: "/entrar", component: () => <p>tela entrar</p> }),
    ];
    const router = createRouter({
      routeTree: raiz.addChildren(rotas),
      history: createMemoryHistory({ initialEntries: ["/onboarding"] }),
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "Sair da conta" }));
    // O símbolo em trânsito e a legenda saem na hora (nada fica preso por cima de /entrar).
    expect(voo.soltar).toHaveBeenCalled();
    expect(voo.legenda).toHaveBeenCalledWith(null);
    await waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("tela entrar")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
  });

  it("Sair também limpa o cache do React Query (a conexão, as chaves e o Contexto da conta que saiu)", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["conexao", "ativa"], { id: "cx-1", nome: "(11) 9999-0000" });
    queryClient.setQueryData(["chaves", "todas"], [{ provedor: "anthropic", ultimos4: "ABCD" }]);
    const raiz = createRootRoute();
    const rotas = [
      createRoute({ getParentRoute: () => raiz, path: "/onboarding", component: () => <Onboarding aoConcluir={() => {}} dados={dadosTeste()} /> }),
      createRoute({ getParentRoute: () => raiz, path: "/entrar", component: () => <p>tela entrar</p> }),
    ];
    const router = createRouter({
      routeTree: raiz.addChildren(rotas),
      history: createMemoryHistory({ initialEntries: ["/onboarding"] }),
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sair da conta" }));
    expect(await screen.findByText("tela entrar")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0));
  });

  it("Sair não volta a casca para a etapa conexão antes de trocar de rota (sem piscar o WhatsApp)", async () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "conversa" });
    const raiz = createRootRoute();
    const titulos: string[] = [];
    const rotas = [
      createRoute({
        getParentRoute: () => raiz,
        path: "/onboarding",
        component: () => <Onboarding aoConcluir={() => {}} dados={dadosTeste()} />,
      }),
      createRoute({ getParentRoute: () => raiz, path: "/entrar", component: () => <p>tela entrar</p> }),
    ];
    const router = createRouter({
      routeTree: raiz.addChildren(rotas),
      history: createMemoryHistory({ initialEntries: ["/onboarding"] }),
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Conversa" })).toBeInTheDocument();
    const observador = new MutationObserver(() => {
      const h1 = document.querySelector("h1");
      if (h1?.textContent) titulos.push(h1.textContent);
    });
    observador.observe(document.body, { childList: true, subtree: true, characterData: true });
    fireEvent.click(screen.getByRole("button", { name: "Sair da conta" }));
    await screen.findByText("tela entrar");
    observador.disconnect();
    expect(titulos).not.toContain("WhatsApp");
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
  });

  it("se o signOut falhar (sem rede), apaga a sessão local e sai do mesmo jeito", async () => {
    auth.signOut.mockResolvedValueOnce({ error: { name: "AuthRetryableFetchError" } });
    const raiz = createRootRoute();
    const rotas = [
      createRoute({ getParentRoute: () => raiz, path: "/onboarding", component: () => <Onboarding aoConcluir={() => {}} dados={dadosTeste()} /> }),
      createRoute({ getParentRoute: () => raiz, path: "/entrar", component: () => <p>tela entrar</p> }),
    ];
    const router = createRouter({
      routeTree: raiz.addChildren(rotas),
      history: createMemoryHistory({ initialEntries: ["/onboarding"] }),
    });
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sair da conta" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: "local" });
  });
});

describe("casca do onboarding: o banco (C8)", () => {
  it("o fim do preparo grava o concluído (concluir_onboarding) e só então chama aoConcluir", async () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "preparando" });
    let terminar: (r: { ok: true; valor: string }) => void = () => {};
    const concluir = vi.fn(() => new Promise<{ ok: true; valor: string }>((r) => (terminar = r)));
    const aoConcluir = vi.fn();
    render(<Onboarding aoConcluir={aoConcluir} dados={dadosTeste({ concluir })} />);
    fireEvent.click(screen.getByRole("button", { name: "Ir para a plataforma" }));
    expect(concluir).toHaveBeenCalledTimes(1);
    expect(aoConcluir).not.toHaveBeenCalled();
    expect(lerEstadoOnboarding().concluidoEm).toBeNull();
    await act(async () => terminar({ ok: true, valor: "2026-11-02T15:00:00.000Z" }));
    expect(aoConcluir).toHaveBeenCalledTimes(1);
    expect(lerEstadoOnboarding().concluidoEm).not.toBeNull();
  });

  it("o concluir falhou: não vai para a plataforma, mostra o erro e o Tentar de novo chama outra vez", async () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "preparando" });
    const concluir = vi
      .fn<DadosOnboarding["concluir"]>()
      .mockResolvedValueOnce({ ok: false, erro: "falha", detalhe: "rede" })
      .mockResolvedValueOnce({ ok: true, valor: "2026-11-02T15:00:00.000Z" });
    const aoConcluir = vi.fn();
    render(<Onboarding aoConcluir={aoConcluir} dados={dadosTeste({ concluir })} />);
    fireEvent.click(screen.getByRole("button", { name: "Ir para a plataforma" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não conseguimos concluir agora. Confira a sua internet e tente de novo.");
    expect(aoConcluir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(aoConcluir).toHaveBeenCalledTimes(1));
    expect(concluir).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("o concluir recusado por sem_acesso: o texto diz que só o admin conclui", async () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "preparando" });
    const concluir = vi.fn<DadosOnboarding["concluir"]>().mockResolvedValue({ ok: false, erro: "sem_acesso" });
    render(<Onboarding aoConcluir={() => {}} dados={dadosTeste({ concluir })} />);
    fireEvent.click(screen.getByRole("button", { name: "Ir para a plataforma" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Só o admin da empresa faz esta etapa.");
  });

  it("recomeça do que foi gravado (14d): com conexão e chave e sem Contexto, numa aba nova, abre no despertar", () => {
    render(
      <Onboarding
        aoConcluir={() => {}}
        dados={criarDadosOnboardingMemoria({ gravado: { ...TUDO_GRAVADO, contexto: null } })}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Janete");
    const estado = lerEstadoOnboarding();
    expect(estado.conexao).toEqual({ modo: "naooficial", gateway: "zapi", rotulo: "+55 11 90000-0000" });
    expect(estado.cerebro).toEqual({ provedor: "openai", modelo: "gpt-teste", ultimos4: "abcd" });
    expect(estado.conversa.confirmado).toBe(false);
  });

  it("recomeça do que foi gravado: com tudo gravado, abre no preparo, com as respostas do Contexto", () => {
    render(<Onboarding aoConcluir={() => {}} dados={criarDadosOnboardingMemoria({ gravado: TUDO_GRAVADO })} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Preparo");
    expect(lerEstadoOnboarding().conversa).toEqual({ respostas: RESPOSTAS, confirmado: true });
  });

  it("o banco vale sobre a aba: a aba no cérebro sem conexão gravada volta para o WhatsApp", () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro", conexao: { modo: "oficial", gateway: "meta", rotulo: "+55 velho" } });
    render(<Onboarding aoConcluir={() => {}} dados={criarDadosOnboardingMemoria({ gravado: NADA_GRAVADO })} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("WhatsApp");
    expect(lerEstadoOnboarding().conexao.rotulo).toBeNull();
  });

  it("enquanto lê o que foi gravado: o carregando, sem etapa; na falha, o erro com Tentar de novo", () => {
    const tentarDeNovo = vi.fn();
    const base = criarDadosOnboardingMemoria();
    const { rerender } = render(
      <Onboarding aoConcluir={() => {}} dados={{ ...base, gravado: { dados: undefined, carregando: true, erro: null, tentarDeNovo } }} />,
    );
    expect(screen.getByRole("status", { name: "Abrindo o onboarding" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    rerender(
      <Onboarding aoConcluir={() => {}} dados={{ ...base, gravado: { dados: undefined, carregando: false, erro: "falha", tentarDeNovo } }} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Não deu para abrir o onboarding");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(tentarDeNovo).toHaveBeenCalledTimes(1);
    rerender(<Onboarding aoConcluir={() => {}} dados={{ ...base, gravado: { ...base.gravado } }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("WhatsApp");
  });
});
