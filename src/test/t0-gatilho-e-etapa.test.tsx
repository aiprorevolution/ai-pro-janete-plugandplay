import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL, gravarEstadoOnboarding, limparEstadoOnboarding } from "@/features/onboarding/estado";
import { AREAS, AreaVazia, LayoutExemplo as Layout } from "@/features/plataforma/Layout";
import { CHAVE_TOUR_VISTO } from "@/features/plataforma/tour";

// O botão da Janete no celular (decisão A44, 02/11) e a área inert com a etapa do Kanban aberta como chat
// no celular (o dock e o botão ficam por cima dela, como no protótipo Kanban 2).

const { getUser, signOut } = vi.hoisted(() => ({ getUser: vi.fn(), signOut: vi.fn() }));
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getUser, signOut } } }));

// Sem símbolo em trânsito (página aberta direto).
const voo = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return {
    ...real,
    useVooJanete: () => voo,
    medirJanete: () => null,
    esperarElemento: (id: string) => Promise.resolve(document.getElementById(id)),
  };
});

const matchMediaOriginal = window.matchMedia;

/** O (max-width: 899px) responde `celular`; as outras consultas, não. `mudar` simula girar a tela. */
function largura(celular: boolean) {
  const ouvintes = new Set<(e: { matches: boolean }) => void>();
  const consulta = {
    matches: celular,
    media: "(max-width: 899px)",
    onchange: null,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => ouvintes.add(f),
    removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => ouvintes.delete(f),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  };
  window.matchMedia = vi.fn((q: string) =>
    q.includes("max-width: 899px") ? consulta : { ...consulta, matches: false, media: q },
  ) as unknown as typeof window.matchMedia;
  return {
    mudar(v: boolean) {
      consulta.matches = v;
      act(() => ouvintes.forEach((f) => f({ matches: v })));
    },
  };
}

/** Uma área qualquer com uma lista que rola, uma faixa que rola de lado e um diálogo com rolagem própria. */
function AreaComLista({ area }: { area: (typeof AREAS)[number]["id"] }) {
  return (
    <>
      <AreaVazia area={area} />
      <div data-testid="lista" />
      <div data-testid="faixa" />
      <div role="dialog" aria-label="Diálogo de teste">
        <div data-testid="no-dialogo" />
      </div>
    </>
  );
}

function montar(url = "/app/chat") {
  window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
  act(() =>
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "preparando", concluidoEm: "2026-10-29T12:00:00.000Z" }),
  );
  const raiz = createRootRoute({ component: () => <Outlet /> });
  const app = createRoute({ getParentRoute: () => raiz, path: "/app", component: Layout });
  const filhos = AREAS.map((area) =>
    createRoute({ getParentRoute: () => app, path: area.id, component: () => <AreaComLista area={area.id} /> }),
  );
  const router = createRouter({
    routeTree: raiz.addChildren([app.addChildren(filhos)]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** O jsdom não rola nem mede: a posição e as alturas são postas à mão antes do evento. */
function posicionar(el: Element, topo: number) {
  Object.defineProperty(el, "scrollTop", { value: topo, configurable: true, writable: true });
  Object.defineProperty(el, "scrollHeight", { value: 3000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 700, configurable: true });
}

function rolar(el: Element, topo: number) {
  posicionar(el, topo);
  fireEvent.scroll(el);
}

/** No celular, quem rola é o documento (o .platMain fica com overflow visível). */
function rolarDocumento(topo: number) {
  if (!document.scrollingElement) {
    Object.defineProperty(document, "scrollingElement", { value: document.documentElement, configurable: true });
  }
  posicionar(document.scrollingElement!, topo);
  fireEvent.scroll(document);
}

const gatilho = () => document.getElementById("janete-gatilho")!;

beforeEach(() => {
  limparEstadoOnboarding();
  window.sessionStorage.clear();
  getUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(() => {
  window.matchMedia = matchMediaOriginal;
  window.sessionStorage.clear();
  document.querySelectorAll("[data-teste-portal]").forEach((n) => n.remove());
  if (document.scrollingElement) posicionar(document.scrollingElement, 0);
});

describe("botão da Janete no celular (A44)", () => {
  it("some enquanto a lista desce e volta quando ela sobe ou chega ao topo", async () => {
    largura(true);
    montar();
    const lista = await screen.findByTestId("lista");
    expect(gatilho()).not.toHaveAttribute("data-escondido");

    rolar(lista, 40);
    rolar(lista, 120);
    expect(gatilho()).toHaveAttribute("data-escondido");

    // um tremido pequeno para cima não muda nada
    rolar(lista, 116);
    expect(gatilho()).toHaveAttribute("data-escondido");

    rolar(lista, 60);
    expect(gatilho()).not.toHaveAttribute("data-escondido");

    rolar(lista, 200);
    expect(gatilho()).toHaveAttribute("data-escondido");
    rolar(lista, 0);
    expect(gatilho()).not.toHaveAttribute("data-escondido");
  });

  it("vale para a rolagem do documento, que é a do celular", async () => {
    largura(true);
    montar();
    await screen.findByTestId("lista");
    rolarDocumento(30);
    rolarDocumento(260);
    expect(gatilho()).toHaveAttribute("data-escondido");
    rolarDocumento(150);
    expect(gatilho()).not.toHaveAttribute("data-escondido");
  });

  it("quem rola devagar, de 2 a 3 px por vez, também esconde e mostra", async () => {
    largura(true);
    montar();
    const lista = await screen.findByTestId("lista");
    let topo = 100;
    rolar(lista, topo);
    for (let i = 0; i < 5; i++) rolar(lista, (topo += 2));
    expect(gatilho()).toHaveAttribute("data-escondido");
    for (let i = 0; i < 5; i++) rolar(lista, (topo -= 2));
    expect(gatilho()).not.toHaveAttribute("data-escondido");
  });

  it("rolar de lado (o carrossel de etapas, as abas) não mostra o botão de volta", async () => {
    largura(true);
    montar();
    const lista = await screen.findByTestId("lista");
    rolar(lista, 40);
    rolar(lista, 300);
    expect(gatilho()).toHaveAttribute("data-escondido");
    const faixa = screen.getByTestId("faixa");
    rolar(faixa, 0);
    rolar(faixa, 0);
    rolar(faixa, 0);
    expect(gatilho()).toHaveAttribute("data-escondido");
  });

  it("numa lista em column-reverse (scrollTop negativo, como as mensagens), o botão fica à vista", async () => {
    largura(true);
    montar();
    const lista = await screen.findByTestId("lista");
    rolar(lista, -400);
    rolar(lista, -100);
    expect(gatilho()).not.toHaveAttribute("data-escondido");
  });

  it("no computador, nunca some", async () => {
    largura(false);
    montar();
    const lista = await screen.findByTestId("lista");
    rolar(lista, 40);
    rolar(lista, 300);
    expect(gatilho()).not.toHaveAttribute("data-escondido");
  });

  it("rolar dentro de um diálogo, ou o documento por trás de um painel em tela cheia, não esconde", async () => {
    largura(true);
    montar();
    const noDialogo = await screen.findByTestId("no-dialogo");
    rolar(noDialogo, 40);
    rolar(noDialogo, 300);
    expect(gatilho()).not.toHaveAttribute("data-escondido");

    const painel = document.createElement("div");
    painel.setAttribute("data-teste-portal", "");
    painel.setAttribute("aria-modal", "true");
    document.body.appendChild(painel);
    rolarDocumento(30);
    rolarDocumento(400);
    expect(gatilho()).not.toHaveAttribute("data-escondido");
  });

  it("trocar de área ou passar para o computador mostra o botão de novo", async () => {
    const tela = largura(true);
    const router = montar();
    const lista = await screen.findByTestId("lista");
    rolar(lista, 40);
    rolar(lista, 300);
    expect(gatilho()).toHaveAttribute("data-escondido");

    await act(() => router.navigate({ to: "/app/contatos" }));
    await screen.findByRole("heading", { level: 1, name: "Contatos" });
    expect(gatilho()).not.toHaveAttribute("data-escondido");

    const outra = screen.getByTestId("lista");
    rolar(outra, 40);
    rolar(outra, 300);
    expect(gatilho()).toHaveAttribute("data-escondido");
    tela.mudar(false);
    expect(gatilho()).not.toHaveAttribute("data-escondido");
  });
});

describe("etapa do Kanban aberta como chat no celular", () => {
  const foraDoAlcance = (el: Element) => el.closest('[inert], [aria-hidden="true"]');

  it("só a área fica inert e aria-hidden; o menu (o dock) e o botão da Janete continuam valendo", async () => {
    largura(true);
    montar();
    const main = await screen.findByRole("main");
    const menu = document.querySelector("aside")!;
    expect(main).not.toHaveAttribute("inert");

    // o EtapaChat vai por portal para o <body>, com o data-tela-cheia só no celular
    const portal = document.createElement("div");
    portal.setAttribute("data-teste-portal", "");
    portal.innerHTML = '<section data-tela-cheia="" aria-label="Etapa"></section>';
    await act(async () => {
      document.body.appendChild(portal);
    });
    expect(main).toHaveAttribute("inert");
    expect(main).toHaveAttribute("aria-hidden", "true");
    expect(foraDoAlcance(menu)).toBeNull();
    expect(foraDoAlcance(gatilho())).toBeNull();

    // fechar a etapa (o portal sai) devolve a área
    await act(async () => {
      portal.remove();
    });
    expect(main).not.toHaveAttribute("inert");
    expect(main).not.toHaveAttribute("aria-hidden");
  });

  it("também segue o atributo trocado num nó que já estava no <body> (a largura mudou com a etapa aberta)", async () => {
    largura(true);
    montar();
    const main = await screen.findByRole("main");
    const portal = document.createElement("div");
    portal.setAttribute("data-teste-portal", "");
    portal.innerHTML = '<section aria-label="Etapa"></section>';
    await act(async () => {
      document.body.appendChild(portal);
    });
    expect(main).not.toHaveAttribute("inert");

    const secao = portal.querySelector("section")!;
    await act(async () => {
      secao.setAttribute("data-tela-cheia", "");
    });
    expect(main).toHaveAttribute("inert");
    await act(async () => {
      secao.removeAttribute("data-tela-cheia");
    });
    expect(main).not.toHaveAttribute("inert");
  });
});
