import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_SESSION_STORAGE,
  ESTADO_INICIAL,
  gravarEstadoOnboarding,
  limparEstadoOnboarding,
  type EstadoOnboarding,
} from "@/features/onboarding/estado";
import type { JSX } from "react";

import { areaVisivelPara, areasDoPapel, type AreaId } from "@/features/plataforma/areas";
import { atalhosDoPapel } from "@/features/plataforma/atalhos";
import { ProvedorExemplo, criarEstadoInicial, estaAguardando, useExemplo } from "@/features/plataforma/exemplo";
// A casca sobre o exemplo em memória (a do banco, Layout/LayoutBanco, tem os testes em f2-casca).
import { AREAS, AreaVazia, LayoutExemplo as Layout } from "@/features/plataforma/Layout";
import { TelaConfiguracao } from "@/features/plataforma/configuracao";
import { ProvedorPapel, usePapel } from "@/features/plataforma/papel";
import { CHAVE_TOUR_VISTO, PARADAS, molduraDe, paradasDoTour, posGuia } from "@/features/plataforma/tour";

// Firebase simulado: o nome vem de getUser().user_metadata.nome; sair chama signOut; o Layout
// assina onAuthStateChange (o ouvinte fica em `sessaoMuda.ouvinte` para o teste disparar eventos).
type OuvinteSessao = (evento: string, sessao: { user: { id: string } } | null) => void;
const { getUser, signOut, onAuthStateChange, sessaoMuda } = vi.hoisted(() => {
  const sessaoMuda = { ouvinte: null as OuvinteSessao | null, desassinou: 0 };
  return {
    getUser: vi.fn(),
    signOut: vi.fn(),
    sessaoMuda,
    onAuthStateChange: vi.fn((fn: OuvinteSessao) => {
      sessaoMuda.ouvinte = fn;
      return { data: { subscription: { unsubscribe: () => (sessaoMuda.desassinou += 1) } } };
    }),
  };
});
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getUser, signOut, onAuthStateChange } } }));

// O símbolo em trânsito: por padrão, sem voo (página aberta direto). O teste da chegada liga.
const voo = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
const medir = vi.hoisted(() => ({
  ponto: null as null | { x: number; y: number; tamanho: number },
  rolouAte: [] as unknown[],
}));
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return {
    ...real,
    useVooJanete: () => voo,
    medirJanete: () => medir.ponto,
    rolarAteEMedir: (alvo: unknown) => {
      medir.rolouAte.push(alvo);
      return Promise.resolve(medir.ponto);
    },
    esperarElemento: (id: string) => Promise.resolve(document.getElementById(id)),
  };
});

function onboardingConcluido(extra: Partial<EstadoOnboarding> = {}) {
  gravarEstadoOnboarding({
    ...ESTADO_INICIAL,
    etapa: "preparando",
    concluidoEm: "2026-10-28T12:00:00.000Z",
    ...extra,
  });
}

function montar(url = "/app/chat", telas: Partial<Record<string, () => JSX.Element>> = {}) {
  const raiz = createRootRoute({ component: () => <Outlet /> });
  const app = createRoute({ getParentRoute: () => raiz, path: "/app", component: Layout });
  const areas = AREAS.map((area) =>
    createRoute({ getParentRoute: () => app, path: area.id, component: telas[area.id] ?? (() => <AreaVazia area={area.id} />) }),
  );
  const entrar = createRoute({ getParentRoute: () => raiz, path: "/entrar", component: () => <h1>Entrar</h1> });
  const router = createRouter({
    routeTree: raiz.addChildren([app.addChildren(areas), entrar]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

// Sem o "Ver como" no topo (decisão de 30/10), o teste troca o papel de dentro da área: a tela que
// fica no <Outlet> do Layout está dentro do ProvedorPapel dele, como a tela do papel virá da conta.
function TrocaPapel({ area }: { area: AreaId }) {
  const { setPapel } = usePapel();
  return (
    <>
      <AreaVazia area={area} />
      <button type="button" onClick={() => setPapel("atendente")}>
        virar atendente
      </button>
      <button type="button" onClick={() => setPapel("admin")}>
        virar admin
      </button>
    </>
  );
}
const COM_PAPEL: Partial<Record<string, () => JSX.Element>> = Object.fromEntries(
  AREAS.map((a) => [a.id, () => <TrocaPapel area={a.id} />]),
);

// Passa o tempo em passos curtos: cada passo é um act() próprio, então o React pinta entre um
// temporizador e outro (como no navegador) e o foco programático acha o elemento novo.
async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 20) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(20, ms - feito)));
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  limparEstadoOnboarding();
  window.sessionStorage.clear();
  getUser.mockReset().mockResolvedValue({ data: { user: { user_metadata: { nome: "Operador Teste" } } }, error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  onAuthStateChange.mockClear();
  sessaoMuda.ouvinte = null;
  sessaoMuda.desassinou = 0;
  voo.ativo = false;
  medir.ponto = null;
  medir.rolouAte = [];
  for (const f of [voo.pousar, voo.voar, voo.soltar]) f.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("casca da plataforma: topo e menu", () => {
  it("mostra o nome da conta e a empresa da 1ª resposta, e o menu das 7 áreas nos 2 grupos do F", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido({
      conversa: {
        respostas: { empresa_oferta: "Casa Verde Solar. Energia solar para casas e pequenos comércios" },
        confirmado: true,
      },
    });
    montar("/app/kanban");

    expect(await screen.findByRole("heading", { level: 1, name: "Kanban" })).toBeInTheDocument();
    expect(await screen.findAllByText("Operador Teste")).not.toHaveLength(0);
    expect(screen.getAllByText("OT").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Casa Verde Solar").length).toBeGreaterThan(0);

    const menu = screen.getByRole("navigation", { name: "Áreas da plataforma" });
    const atendimento = within(menu).getByRole("list", { name: "Atendimento" });
    const suaJanete = within(menu).getByRole("list", { name: "Sua Janete" });
    expect(within(atendimento).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Chat",
      "Contatos",
      "Kanban",
      "Dashboard",
      "Equipe",
    ]);
    expect(within(suaJanete).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Contexto",
      "Configuração",
    ]);
    // a barra de etapas do onboarding não aparece aqui
    expect(screen.queryByRole("navigation", { name: /Etapas/ })).not.toBeInTheDocument();
  });

  it("sem resposta de empresa nem nome na conta, não inventa: mostra 'Você' e nenhuma empresa", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    getUser.mockResolvedValue({ data: { user: { user_metadata: {} } }, error: null });
    onboardingConcluido();
    montar();
    expect(await screen.findByRole("heading", { level: 1, name: "Chat" })).toBeInTheDocument();
    expect((await screen.findAllByText("Você")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Sua empresa")).not.toBeInTheDocument();
  });

  it("enquanto a conta carrega, o topo não afirma 'Você' nem 'VC'", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    let responder: (v: unknown) => void = () => {};
    getUser.mockReset().mockReturnValue(new Promise((r) => (responder = r)));
    onboardingConcluido();
    montar();
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(screen.queryByText("Você")).not.toBeInTheDocument();
    expect(screen.queryByText("VC")).not.toBeInTheDocument();
    await act(async () => responder({ data: { user: { user_metadata: { nome: "Operador Teste" } } }, error: null }));
    expect(screen.getAllByText("Operador Teste").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OT").length).toBeGreaterThan(0);
  });

  it("Sair chama o signOut, apaga o onboarding e o marcador do tour desta aba e volta para /entrar", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido({ conexao: { modo: "naooficial", gateway: "zapi", rotulo: "Instância 3C2A" } });
    const router = montar();
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[0]!);
    await passar(50);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/entrar");
    // a próxima conta que entrar nesta aba não herda o onboarding nem o tour da anterior
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBeNull();
    expect(sessaoMuda.desassinou).toBeGreaterThan(0);
  });

  it("enquanto o signOut não volta, a tela não esvazia e o Sair fica desligado", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido({
      conexao: { modo: "naooficial", gateway: "zapi", rotulo: "Instância 3C2A" },
      conversa: { respostas: { empresa_oferta: "Casa Verde Solar. Energia solar" }, confirmado: true },
    });
    let terminar: (v: unknown) => void = () => {};
    signOut.mockReset().mockReturnValue(new Promise((r) => (terminar = r)));
    const router = montar();
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[0]!);
    await passar(50);
    // ainda na plataforma, com o que a sessão tem
    expect(router.state.location.pathname).toBe("/app/chat");
    expect(screen.getAllByText("Casa Verde Solar").length).toBeGreaterThan(0);
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).not.toBeNull();
    for (const botao of screen.getAllByRole("button", { name: "Sair" })) {
      expect(botao).toBeDisabled();
      expect(botao).toHaveAttribute("aria-busy", "true");
    }
    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[1]!);
    await act(async () => terminar({ error: null }));
    await passar(50);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/entrar");
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBeNull();
  });

  it("saída ou troca de conta em outra aba: volta para /entrar e apaga o onboarding e o tour desta aba", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "conta-a", user_metadata: { nome: "Operador Teste" } } }, error: null });
    for (const [evento, sessao] of [
      ["SIGNED_IN", { user: { id: "conta-b" } }],
      ["SIGNED_OUT", null],
    ] as const) {
      window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
      onboardingConcluido();
      const router = montar();
      expect((await screen.findAllByText("Operador Teste")).length).toBeGreaterThan(0);
      // a mesma conta renovando o token não é troca
      await act(async () => sessaoMuda.ouvinte!("TOKEN_REFRESHED", { user: { id: "conta-a" } }));
      await passar(50);
      expect(router.state.location.pathname).toBe("/app/chat");
      expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).not.toBeNull();

      await act(async () => sessaoMuda.ouvinte!(evento, sessao));
      await passar(50);
      expect(router.state.location.pathname).toBe("/entrar");
      expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
      expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBeNull();
      expect(signOut).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("o conteúdo da área fica no landmark main", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    montar("/app/kanban");
    const titulo = await screen.findByRole("heading", { level: 1, name: "Kanban" });
    expect(screen.getByRole("main")).toContainElement(titulo);
  });

  it("com o fluxo da Configuração em tela cheia aberto (portal no body), o menu e a área ficam inert e aria-hidden", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    montar("/app/kanban");
    await screen.findByRole("heading", { level: 1, name: "Kanban" });
    const main = screen.getByRole("main");
    const menu = screen.getByRole("complementary", { name: "Menu" });
    expect(main).not.toHaveAttribute("inert");
    expect(menu).not.toHaveAttribute("inert");

    // o que o Fluxo faz no celular: um portal no <body> com o diálogo modal
    const portal = document.createElement("div");
    portal.innerHTML = '<section id="cfg-fluxo" role="dialog" aria-modal="true"></section>';
    document.body.appendChild(portal);
    try {
      await vi.waitFor(() => {
        expect(main).toHaveAttribute("inert");
        expect(main).toHaveAttribute("aria-hidden", "true");
        expect(menu).toHaveAttribute("inert");
        expect(menu).toHaveAttribute("aria-hidden", "true");
      });

      // o mesmo fluxo no computador (região, sem aria-modal) não esconde nada
      portal.querySelector("section")!.removeAttribute("aria-modal");
      await vi.waitFor(() => expect(main).not.toHaveAttribute("inert"));

      portal.querySelector("section")!.setAttribute("aria-modal", "true");
      await vi.waitFor(() => expect(main).toHaveAttribute("inert"));
    } finally {
      portal.remove();
    }
    await vi.waitFor(() => {
      expect(main).not.toHaveAttribute("inert");
      expect(main).not.toHaveAttribute("aria-hidden");
      expect(menu).not.toHaveAttribute("inert");
    });
  });

  // Decisão de 30/10: no modo exemplo, o selo "Exemplo", o "Ver como" e o "Pausar a simulação" saem
  // do topo de todas as telas, no computador e no celular (a faixa do celular sumiu junto).
  for (const [largura, celular] of [
    ["no computador", false],
    ["no celular", true],
  ] as const) {
    it(`${largura}, o topo não tem o selo Exemplo, o 'Ver como' nem o 'Pausar a simulação' em nenhuma área`, async () => {
      window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
      onboardingConcluido();
      const original = window.matchMedia;
      window.matchMedia = ((q: string) => ({
        matches: celular && q === "(max-width: 899px)",
        media: q,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
      try {
        const router = montar("/app/chat");
        await screen.findByRole("heading", { level: 1, name: "Chat" });
        for (const area of AREAS) {
          await act(() => router.navigate({ to: area.rota }));
          const titulo = await screen.findByRole("heading", { level: 1, name: area.nome });
          const main = screen.getByRole("main");
          // o <main> tem só o topo do computador, o do celular e o conteúdo: nenhuma faixa a mais
          const foraDaArea = Array.from(main.children).filter((el) => !el.contains(titulo));
          expect(foraDaArea).toHaveLength(2);
          for (const topo of foraDaArea) {
            expect(within(topo as HTMLElement).queryByText(/Exemplo/)).toBeNull();
            expect(within(topo as HTMLElement).queryByText("Ver como")).toBeNull();
          }
          // em lugar nenhum da casca: nem o grupo, nem os botões de papel, nem a pausa, nem o aviso
          expect(screen.queryByRole("group", { name: "Ver a tela como" })).toBeNull();
          expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
          expect(screen.queryByRole("button", { name: "Atendente" })).toBeNull();
          expect(screen.queryByRole("button", { name: /a simulação$/ })).toBeNull();
          expect(screen.queryByTestId("aviso-papel")).toBeNull();
        }
      } finally {
        window.matchMedia = original;
      }
    });
  }

  it("o <main> diz qual área está aberta (data-area-aberta), e só o Kanban, o Chat e os Contatos tiram o limite de largura no CSS", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    const router = montar("/app/chat");
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    for (const area of AREAS) {
      await act(() => router.navigate({ to: area.rota }));
      await screen.findByRole("heading", { level: 1, name: area.nome });
      expect(screen.getByRole("main")).toHaveAttribute("data-area-aberta", area.id);
    }
    // O jsdom não aplica o CSS: o teste lê o Plataforma.module.css e confere as regras que dão
    // largura ao .platConteudo. Só quatro: o limite de 1.344 px de todas, e a do Kanban, a do Chat e a dos
    // Contatos, sem limite.
    const css = readFileSync(path.resolve(__dirname, "../features/plataforma/Plataforma.module.css"), "utf-8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const comLargura = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /\.platConteudo(?![\w-])/.test(m[1]!) && /(^|[;\s])width\s*:/.test(m[2]!))
      .map((m) => [m[1]!.trim(), m[2]!.match(/(?:^|[;\s])width\s*:\s*([^;]+);/)![1]!.trim()]);
    expect(comLargura).toEqual([
      [".platConteudo", "min(100%, 1344px)"],
      [".platMain[data-area-aberta='kanban'] > .platConteudo", "100%"],
      [".platMain[data-area-aberta='chat'] > .platConteudo", "100%"],
      [".platMain[data-area-aberta='contatos'] > .platConteudo", "100%"],
    ]);
  });

  it("a casca lê o exemplo: o WhatsApp do rodapé acompanha a conexão e o Chat mostra quantas precisam de alguém", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    function Desconectar() {
      const { acoes } = useExemplo();
      return (
        <section data-area="configuracao">
          <h1>Configuração</h1>
          <button type="button" onClick={() => acoes.trocarConexao(null)}>
            Desconectar
          </button>
        </section>
      );
    }
    montar("/app/configuracao", { configuracao: Desconectar });
    await screen.findByRole("heading", { level: 1, name: "Configuração" });
    const menu = screen.getByRole("complementary", { name: "Menu" });
    expect(within(menu).getByText("WhatsApp conectado")).toBeInTheDocument();
    // o contador do Chat fica fora do texto do link (o nome continua só "Chat")
    const esperando = criarEstadoInicial(new Date()).conversas.filter(estaAguardando).length;
    expect(esperando).toBeGreaterThan(0);
    const chat = within(menu).getByRole("link", { name: "Chat" });
    expect(chat).toHaveAttribute("data-conta", String(esperando));
    expect(chat.textContent).toBe("Chat");
    expect(within(menu).getByRole("link", { name: "Kanban" })).not.toHaveAttribute("data-conta");

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(within(menu).getByText("WhatsApp desconectado")).toBeInTheDocument();
    expect(within(menu).queryByText("WhatsApp conectado")).toBeNull();
  });

  it("sem o 'Ver como', o exemplo fica sempre como admin: a conta real no topo, com 'Admin'", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido({
      conversa: { respostas: { empresa_oferta: "Casa Verde Solar. Energia solar" }, confirmado: true },
    });
    montar("/app/contatos");
    await screen.findByRole("heading", { level: 1, name: "Contatos" });
    expect(await screen.findByText("Admin · Casa Verde Solar")).toBeInTheDocument();
    expect(screen.getAllByText("Operador Teste").length).toBeGreaterThan(0);
    expect(screen.queryByText("Marina")).toBeNull();
    // e o admin vê as 7 áreas no menu (o mesmo <nav> é o dock do celular, com o data-dock)
    const menu = screen.getByRole("navigation", { name: "Áreas da plataforma" });
    expect(menu).toHaveAttribute("data-dock");
    expect(within(menu).getAllByRole("link")).toHaveLength(7);
    expect(within(menu).getByRole("link", { name: "Configuração" })).toBeInTheDocument();
  });

  it("como atendente, a conta do topo vira a da Marina (MA); de volta a admin, a conta real com 'Admin'", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido({
      conversa: { respostas: { empresa_oferta: "Casa Verde Solar. Energia solar" }, confirmado: true },
    });
    montar("/app/contatos", COM_PAPEL);
    await screen.findByRole("heading", { level: 1, name: "Contatos" });
    expect(await screen.findByText("Admin · Casa Verde Solar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "virar atendente" }));
    expect(screen.getByText("Atendente · Casa Verde Solar")).toBeInTheDocument();
    expect(screen.getByText("Marina")).toBeInTheDocument();
    expect(screen.getByText("MA")).toBeInTheDocument();
    expect(screen.queryByText("Operador Teste")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "virar admin" }));
    expect(screen.getByText("Admin · Casa Verde Solar")).toBeInTheDocument();
    expect(screen.getAllByText("Operador Teste").length).toBeGreaterThan(0);
    expect(screen.queryByText("Marina")).toBeNull();
  });

  // Todas as áreas já são telas (a Equipe e o Contexto viraram em 01/11). A AreaVazia continua para quando
  // não houver dado; esta árvore a monta em toda área. O `vazio` de Contatos segue em areas.ts: a tabela
  // usa o texto quando não há contato nenhum (contatos/Tabela.tsx).
  it("a área vazia de cada tela diz o que vai aparecer, sem dado de exemplo nem 'Em breve'", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido();
    const router = montar("/app/chat");
    for (const area of AREAS) {
      await act(() => router.navigate({ to: `/app/${area.id}` }));
      const titulo = await screen.findByRole("heading", { level: 1, name: area.nome });
      const secao = titulo.closest("section")!;
      expect(within(secao).getByRole("heading", { level: 2, name: area.vazio.titulo })).toBeInTheDocument();
      expect(within(secao).getByText(area.vazio.texto)).toBeInTheDocument();
      expect(secao.textContent).not.toMatch(/Em breve|exemplo|Marina/i);
      // o `.vazio-plat` do F: esboço de 3 barras, sem ícone
      expect(secao.querySelector("svg")).toBeNull();
      expect(secao.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(3);
    }
  });
});

describe("tour", () => {
  it("aparece sozinho na 1ª visita depois do onboarding, passa pelas 9 paradas e termina no botão da Janete", async () => {
    onboardingConcluido();
    const router = montar("/app/chat");

    const regiao = await screen.findByRole("region", { name: "Tour da Janete" });
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBe("1");
    await passar(1300);
    expect(within(regiao).getByText("1 de 9")).toBeInTheDocument();
    expect(within(regiao).getByText(/nestas sete áreas/)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Próximo" }));

    const rotulos = ["Chat", "Contatos", "Kanban", "Dashboard", "Equipe", "Contexto", "Configuração"];
    for (const [i, rotulo] of rotulos.entries()) {
      fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
      await passar(900);
      expect(within(regiao).getByText(`${i + 2} de 9`)).toBeInTheDocument();
      expect(within(regiao).getByText(rotulo, { selector: "p" })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(AREAS[i]!.rota);
    }

    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    await passar(900);
    expect(within(regiao).getByText("9 de 9")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/chat");

    fireEvent.click(screen.getByRole("button", { name: "Começar a usar" }));
    await passar(1000);
    expect(screen.queryByRole("region", { name: "Tour da Janete" })).not.toBeInTheDocument();
    const gatilho = screen.getByRole("button", { name: "Fale com a Janete (ela tem novidade)" });
    expect(gatilho).toHaveAttribute("data-janete-gatilho");
    expect(document.activeElement).toBe(gatilho);
    expect(screen.getAllByRole("button", { name: "Ver o tour de novo" }).length).toBeGreaterThan(0);
  });

  it("clicar num item do menu durante o tour vai para a parada daquela área", async () => {
    onboardingConcluido();
    const router = montar("/app/chat");
    const regiao = await screen.findByRole("region", { name: "Tour da Janete" });
    await passar(1300);
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    await passar(900);
    expect(within(regiao).getByText("5 de 9")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/dashboard");
  });

  it("não aparece sozinho de novo quando o marcador já existe, mas dá para ver de novo", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido();
    montar();
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await passar(1300);
    expect(screen.queryByRole("region", { name: "Tour da Janete" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Ver o tour de novo" })[0]!);
    await passar(1300);
    expect(screen.getByRole("region", { name: "Tour da Janete" })).toBeInTheDocument();
  });

  it("Pular tour leva a Janete para o canto", async () => {
    onboardingConcluido();
    montar();
    await screen.findByRole("region", { name: "Tour da Janete" });
    await passar(1300);
    fireEvent.click(screen.getByRole("button", { name: "Pular tour" }));
    await passar(1000);
    expect(screen.queryByRole("region", { name: "Tour da Janete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fale com a Janete/ })).toHaveFocus();
  });
});

describe("Fale com a Janete", () => {
  async function abrirPainel() {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido({
      conversa: { respostas: { tom_voz: "Próximo e direto, sem formalidade." }, confirmado: true },
    });
    const router = montar("/app/chat");
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    fireEvent.click(screen.getByRole("button", { name: "Fale com a Janete" }));
    await passar(700);
    const painel = screen.getByRole("dialog", { name: "Fale com a Janete" });
    return { router, painel };
  }

  it("abre o painel com atalhos, sem campo de texto livre, e o foco no 1º atalho", async () => {
    const { painel } = await abrirPainel();
    expect(within(painel).getByText("Oi, Operador. Em que posso te ajudar?")).toBeInTheDocument();
    expect(within(painel).queryByRole("textbox")).not.toBeInTheDocument();
    const atalhos = within(painel).getAllByRole("button", { name: /\?|empresa|falando|amanhã/ });
    expect(atalhos.map((b) => b.textContent)).toEqual([
      "Como estão meus leads hoje?",
      "Quero te ensinar algo novo sobre a empresa",
      "Revise como você está falando",
      "Pause o atendimento até amanhã",
    ]);
    expect(document.activeElement).toBe(atalhos[0]);
    expect(screen.queryByRole("button", { name: /^Fale com a Janete/ })).not.toBeInTheDocument();
  });

  it("um atalho faz a Janete responder com frase fixa e um botão que abre a área certa", async () => {
    const { router, painel } = await abrirPainel();
    fireEvent.click(within(painel).getByRole("button", { name: "Como estão meus leads hoje?" }));
    await passar(3000);
    const log = within(painel).getByRole("log");
    expect(within(log).getByText("Como estão meus leads hoje?")).toBeInTheDocument();
    // com os leads de exemplo nas telas, a Janete não diz mais que "nenhum lead chegou": manda para o Kanban
    expect(within(log).getByText(/Os seus leads estão no Kanban/)).toBeInTheDocument();
    expect(within(log).getByText(/Os números do atendimento estão no Dashboard\./)).toBeInTheDocument();
    expect(within(log).queryByText(/ainda está vazio/)).toBeNull();
    const abrir = within(log).getByRole("button", { name: "Abrir o Kanban" });
    expect(document.activeElement).toBe(abrir);

    fireEvent.click(abrir);
    await passar(500);
    expect(router.state.location.pathname).toBe("/app/kanban");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Kanban" }));
  });

  it("'Revise como você está falando' usa o tom de voz real do onboarding", async () => {
    const { painel } = await abrirPainel();
    fireEvent.click(within(painel).getByRole("button", { name: "Revise como você está falando" }));
    await passar(3000);
    expect(within(painel).getByText(/Hoje eu falo assim: próximo e direto, sem formalidade\./)).toBeInTheDocument();
    expect(within(painel).getByRole("button", { name: "Abrir o Contexto" })).toBeInTheDocument();
  });

  it("enquanto a Janete responde, o foco fica no painel (os atalhos saem da tela)", async () => {
    const { painel } = await abrirPainel();
    fireEvent.click(within(painel).getByRole("button", { name: "Como estão meus leads hoje?" }));
    await passar(100);
    expect(within(painel).queryByRole("button", { name: "Revise como você está falando" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(painel);
    // o Esc continua fechando o painel nesse intervalo
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await passar(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reabrir o painel enquanto a Janete ainda responde põe o foco no painel", async () => {
    const { painel } = await abrirPainel();
    fireEvent.click(within(painel).getByRole("button", { name: "Como estão meus leads hoje?" }));
    await passar(100);
    fireEvent.keyDown(painel, { key: "Escape" });
    await passar(450);
    fireEvent.click(screen.getByRole("button", { name: /^Fale com a Janete/ }));
    await passar(200);
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Fale com a Janete" }));
  });

  it("Fechar o chat fecha como o minimizar e guarda as mensagens ao reabrir", async () => {
    const { painel } = await abrirPainel();
    fireEvent.click(within(painel).getByRole("button", { name: "Como estão meus leads hoje?" }));
    await passar(3000);
    fireEvent.click(within(painel).getByRole("button", { name: "Fechar o chat" }));
    await passar(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Fale com a Janete/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Fale com a Janete/ }));
    await passar(700);
    const log = within(screen.getByRole("dialog", { name: "Fale com a Janete" })).getByRole("log");
    expect(within(log).getByText("Como estão meus leads hoje?")).toBeInTheDocument();
    expect(within(log).getByText(/Os seus leads estão no Kanban/)).toBeInTheDocument();
  });

  it("Esc minimiza e o foco volta para o botão do canto", async () => {
    const { painel } = await abrirPainel();
    fireEvent.keyDown(painel, { key: "Escape" });
    await passar(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fale com a Janete" }));
  });
});

describe("chegada vinda do preparo (E6)", () => {
  it("com o símbolo em voo: plataforma fechada, voo longo até o guia, solta e abre; o tour começa no Próximo", async () => {
    onboardingConcluido();
    voo.ativo = true;
    medir.ponto = { x: 42, y: 858, tamanho: 52 };
    montar("/app/chat");

    const plataforma = await screen.findByRole("region", { name: "Plataforma AI PRO Janete" });
    expect(plataforma.className).toMatch(/rev0/);
    await passar(10);
    // o guia é medido só depois de trazido para a vista e de a rolagem parar (decisão 5b)
    expect(medir.rolouAte).toEqual([document.getElementById("tour-ponto")]);
    expect(voo.voar).toHaveBeenCalledWith({ x: 42, y: 858, tamanho: 52 }, { duracaoMs: 950, estado: "acordada" });
    expect(voo.soltar).not.toHaveBeenCalled();

    await passar(100);
    expect(voo.soltar).toHaveBeenCalledTimes(1);
    expect(plataforma.className).toMatch(/revAbre/);
    await passar(2100);
    expect(plataforma.className).not.toMatch(/rev0|revAbre/);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Próximo" }));
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBe("1");
  });

  it("sem voo, a plataforma já aparece aberta", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido();
    montar();
    const plataforma = await screen.findByRole("region", { name: "Plataforma AI PRO Janete" });
    expect(plataforma.className).not.toMatch(/rev0|revAbre/);
    expect(voo.voar).not.toHaveBeenCalled();
  });
});

// Sem o "Ver como" (decisão de 30/10), a casca fica sempre como admin; a visão do atendente volta
// quando o papel vier da conta, com o banco. Até lá, o que o atendente vê se confere pelas funções
// puras que a casca usa (areasDoPapel, atalhosDoPapel, paradasDoTour, posGuia, molduraDe), pela
// casca com o papel trocado de dentro da área (TrocaPapel) e pela tela montada com ProvedorPapel
// inicial="atendente".
describe("o atendente, sem a Configuração (decisão de 30/10)", () => {
  async function comoAtendente(url = "/app/chat") {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido();
    const router = montar(url, COM_PAPEL);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "virar atendente" }));
    return router;
  }

  it("na casca, a Configuração some do menu do atendente (o mesmo <nav> é o dock, com o data-dock) e volta com o admin", async () => {
    await comoAtendente();
    const menu = screen.getByRole("navigation", { name: "Áreas da plataforma" });
    expect(menu).toHaveAttribute("data-dock");
    expect(within(menu).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Chat",
      "Contatos",
      "Kanban",
      "Dashboard",
      "Equipe",
      "Contexto",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "virar admin" }));
    expect(within(menu).getByRole("link", { name: "Configuração" })).toBeInTheDocument();
  });

  it("na casca, o painel da Janete mostra ao atendente só os 3 atalhos sem a Configuração", async () => {
    await comoAtendente();
    fireEvent.click(screen.getByRole("button", { name: "Fale com a Janete" }));
    await passar(700);
    const painel = screen.getByRole("dialog", { name: "Fale com a Janete" });
    const atalhos = within(painel).getAllByRole("button", { name: /\?|empresa|falando|amanhã/ });
    expect(atalhos.map((b) => b.textContent)).toEqual([
      "Como estão meus leads hoje?",
      "Quero te ensinar algo novo sobre a empresa",
      "Revise como você está falando",
    ]);
  });

  it("na casca, o tour do atendente começa em '1 de 8' e conta seis áreas", async () => {
    await comoAtendente();
    fireEvent.click(screen.getAllByRole("button", { name: "Ver o tour de novo" })[0]!);
    await passar(1300);
    const regiao = screen.getByRole("region", { name: "Tour da Janete" });
    expect(within(regiao).getByText("1 de 8")).toBeInTheDocument();
    expect(within(regiao).getByText(/nestas seis áreas/)).toBeInTheDocument();
  });

  it("trocar o papel no meio do tour leva a rota junto com a parada", async () => {
    onboardingConcluido();
    const router = montar("/app/chat", COM_PAPEL);
    const regiao = await screen.findByRole("region", { name: "Tour da Janete" });
    await passar(1300);
    // o admin para na Configuração (8 de 9)
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
      await passar(900);
    }
    expect(within(regiao).getByText("8 de 9")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/configuracao");

    // virando atendente, a parada fica presa ao fim da lista dele (Pronto) e a rota volta ao Chat
    fireEvent.click(screen.getByRole("button", { name: "virar atendente" }));
    await passar(100);
    expect(within(regiao).getByText("8 de 8")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/chat");

    // de volta a admin, a parada 8 é a Configuração de novo, e a rota vai junto
    fireEvent.click(screen.getByRole("button", { name: "virar admin" }));
    await passar(100);
    expect(within(regiao).getByText("8 de 9")).toBeInTheDocument();
    expect(within(regiao).getByText("Configuração", { selector: "p" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/configuracao");
  });

  it("a resposta antiga da Janete com 'Abrir a Configuração' perde o botão quando o papel vira atendente", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    onboardingConcluido();
    montar("/app/chat", COM_PAPEL);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    fireEvent.click(screen.getByRole("button", { name: "Fale com a Janete" }));
    await passar(700);
    const painel = screen.getByRole("dialog", { name: "Fale com a Janete" });
    fireEvent.click(within(painel).getByRole("button", { name: "Pause o atendimento até amanhã" }));
    await passar(3000);
    const log = within(painel).getByRole("log");
    expect(within(log).getByRole("button", { name: "Abrir a Configuração" })).toBeInTheDocument();
    const textos = within(log).getAllByText(/./).length;

    fireEvent.click(screen.getByRole("button", { name: "virar atendente" }));
    await passar(100);
    const log2 = within(screen.getByRole("dialog", { name: "Fale com a Janete" })).getByRole("log");
    expect(within(log2).queryByRole("button", { name: "Abrir a Configuração" })).not.toBeInTheDocument();
    // o texto da resposta fica
    expect(within(log2).getByText("Pause o atendimento até amanhã")).toBeInTheDocument();
    expect(within(log2).getAllByText(/./)).toHaveLength(textos - 1); // só o botão saiu
  });

  it("a Configuração some do menu do atendente (o mesmo <nav> é o dock do celular); o admin vê as 7", () => {
    expect(areasDoPapel("atendente").map((a) => a.nome)).toEqual([
      "Chat",
      "Contatos",
      "Kanban",
      "Dashboard",
      "Equipe",
      "Contexto",
    ]);
    expect(areasDoPapel("admin")).toBe(AREAS);
    expect(areaVisivelPara("configuracao", "atendente")).toBe(false);
    expect(areaVisivelPara("configuracao", "admin")).toBe(true);
  });

  it("os atalhos da Janete não levam o atendente à Configuração", () => {
    expect(atalhosDoPapel("atendente").map((a) => a.pergunta)).toEqual([
      "Como estão meus leads hoje?",
      "Quero te ensinar algo novo sobre a empresa",
      "Revise como você está falando",
    ]);
    expect(atalhosDoPapel("atendente").some((a) => a.area === "configuracao")).toBe(false);
    expect(atalhosDoPapel("admin").map((a) => a.pergunta)).toContain("Pause o atendimento até amanhã");
  });

  it("o tour do atendente tem 8 paradas, conta seis áreas e pula a Configuração", () => {
    const paradas = paradasDoTour("atendente");
    expect(paradas).toHaveLength(8);
    expect(paradas[0]!.texto).toMatch(/nestas seis áreas/);
    expect(paradas.map((p) => p.rotulo)).toEqual([
      "O menu",
      "Chat",
      "Contatos",
      "Kanban",
      "Dashboard",
      "Equipe",
      "Contexto",
      "Pronto",
    ]);
    // cada parada de área abre a rota dela, na ordem do menu; o fim volta ao Chat
    expect(paradas.slice(1, 7).map((p) => p.area)).toEqual(AREAS.slice(0, 6).map((a) => a.id));
    expect(paradas[7]!.vista).toBe("chat");
    expect(paradasDoTour("admin")).toHaveLength(9);
  });

  it("na parada da Equipe, só o admin ouve que convida a equipe", () => {
    const equipe = (papel: "admin" | "atendente") => paradasDoTour(papel).find((p) => p.area === "equipe")!.texto;
    expect(equipe("admin")).toBe(
      "Quem recebe os leads que eu passar. Aqui você convida a equipe e vê quem está atendendo agora.",
    );
    expect(equipe("atendente")).toBe("Quem recebe os leads que eu passar. Aqui você vê quem está atendendo agora.");
  });

  it("as paradas do tour ficam nos mesmos lugares; só o menu inteiro encolhe para o atendente", () => {
    const atendente = paradasDoTour("atendente");
    expect(paradasDoTour("admin")).toBe(PARADAS);
    expect(atendente.map((p) => p.area ?? p.vista ?? "menu")).toEqual([
      "menu",
      "chat",
      "contatos",
      "kanban",
      "dashboard",
      "equipe",
      "contexto",
      "chat",
    ]);
    for (let i = 1; i <= 6; i++) {
      expect(posGuia(i, "ativo", false, atendente)).toEqual(posGuia(i, "ativo", false));
      expect(molduraDe(i, atendente)).toEqual(molduraDe(i));
    }
    // o fim fica no meio da área, como no tour do admin
    expect(posGuia(7, "ativo", false, atendente)).toEqual(posGuia(8, "ativo", false));
    expect(molduraDe(0)).toMatchObject({ height: "406px" });
    expect(molduraDe(0, atendente)).toMatchObject({ height: "364px" });
  });

  it("na rota da Configuração, o atendente vê só o aviso, e 'Ir para o Chat' leva ao Chat com o foco no título", async () => {
    // a tela montada sem a casca, com o papel do provedor (o que a casca fará quando o papel vier da conta)
    const raiz = createRootRoute({
      component: () => (
        <ProvedorPapel inicial="atendente">
          <ProvedorExemplo>
            <Outlet />
          </ProvedorExemplo>
        </ProvedorPapel>
      ),
    });
    const configuracao = createRoute({ getParentRoute: () => raiz, path: "/app/configuracao", component: TelaConfiguracao });
    const chatRota = createRoute({ getParentRoute: () => raiz, path: "/app/chat", component: () => <AreaVazia area="chat" /> });
    const router = createRouter({
      routeTree: raiz.addChildren([configuracao, chatRota]),
      history: createMemoryHistory({ initialEntries: ["/app/configuracao"] }),
    });
    render(<RouterProvider router={router} />);
    const titulo = await screen.findByRole("heading", { level: 1, name: "Configuração" });
    const secao = titulo.closest("section")!;
    expect(within(secao).getByText("Só o admin vê a Configuração.")).toBeInTheDocument();
    expect(within(secao).getAllByRole("button").map((b) => b.textContent)).toEqual(["Ir para o Chat"]);
    expect(document.getElementById("cfg-card-whats")).toBeNull();

    fireEvent.click(within(secao).getByRole("button", { name: "Ir para o Chat" }));
    const chat = await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(router.state.location.pathname).toBe("/app/chat");
    await passar(100);
    expect(document.activeElement).toBe(chat);
  });
});
