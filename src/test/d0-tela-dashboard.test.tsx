import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idTituloArea } from "@/features/plataforma/AreaVazia";
import { ATRASO_CARREGANDO_MS, ID_TITULO_DASHBOARD, ProvedorPainel, usePainelDashboard } from "@/features/plataforma/dashboard/dados";
import { TelaDashboard } from "@/features/plataforma/dashboard/TelaDashboard";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarEstadoInicial } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// A conta (useConta, sem o Layout) busca o nome no Firebase: aqui, simulado.
const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "u-1", email: "operador@exemplo.test", user_metadata: { nome: "equipe Teste" } } } })),
}));
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getUser } } }));

// A fundação se testa com uma tela de mentira: a de verdade tem o teste dv-versao-final.
vi.mock("@/features/plataforma/dashboard/versoes/final/TelaDashboardFinal", async () => ({ TelaDashboardFinal: (await import("./d0-tela-falsa")).TelaFalsa }));

// 14:45 em São Paulo.
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const relogio = () => new Date(AGORA);

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <ProvedorPapel>
      <ProvedorDados progredirEnvios={false} relogio={relogio} exemplo={() => criarEstadoInicial(AGORA)}>
        {children}
      </ProvedorDados>
    </ProvedorPapel>
  );
}

/** Um roteador como o do app: a rota /app/dashboard com o mesmo componente (com o relógio fixo). */
function montarRota(url: string) {
  const raiz = createRootRoute({
    component: () => (
      <Casca>
        <Outlet />
      </Casca>
    ),
  });
  const dashboard = createRoute({
    getParentRoute: () => raiz,
    path: "/app/dashboard",
    component: () => <TelaDashboard relogio={relogio} />,
  });
  const router = createRouter({
    routeTree: raiz.addChildren([dashboard]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("d0 · a rota do Dashboard", () => {
  it("abre a tela: o h1 (a saudação) tem o id que a casca foca, e a raiz é a área do Dashboard", async () => {
    montarRota("/app/dashboard");
    // A espera da tela final (o osso) também tem o h1 da saudação: o h1 conferido é o da tela.
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    const h1 = screen.getByRole("heading", { level: 1, name: /^Boa tarde/ });
    expect(ID_TITULO_DASHBOARD).toBe(idTituloArea("dashboard"));
    expect(h1).toHaveAttribute("id", ID_TITULO_DASHBOARD);
    expect(h1).toHaveAttribute("tabindex", "-1");
    const raiz = h1.closest("[data-area='dashboard']");
    expect(raiz).not.toBeNull();
    expect(raiz).toHaveAttribute("aria-labelledby", ID_TITULO_DASHBOARD);
    expect(document.getElementById(idTituloArea("dashboard"))).toBe(h1);
  });

  it("sem a área vazia de antes e sem pílula de versão ou de simulação", async () => {
    montarRota("/app/dashboard");
    await screen.findByText("Tela de mentira");
    expect(screen.queryByText("Nenhum número ainda")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Versão|Simulação/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it.each(["a", "final", "z"])("um ?v=%s dos links da revisão das versões é ignorado: abre o mesmo Dashboard", async (v) => {
    montarRota(`/app/dashboard?v=${v}`);
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Boa tarde/);
  });
});

/* ---------- o provedor ---------- */

let ultimo: ReturnType<typeof usePainelDashboard> | null = null;
function Sonda() {
  const valor = usePainelDashboard();
  ultimo = valor;
  return (
    <p data-testid="sonda" data-carregando={valor.carregando} data-periodo={valor.idPeriodo} data-primeira={valor.primeiraVez}>
      {valor.painel.periodo.rotulo} · {valor.painel.estadoJanete}
    </p>
  );
}

function montarSonda(estrito = false) {
  const arvore = (
    <Casca>
      <ProvedorPainel relogio={relogio}>
        <Sonda />
      </ProvedorPainel>
    </Casca>
  );
  return render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore);
}

describe("d0 · o ProvedorPainel", () => {
  it("começa em 30 dias e normal; trocar o período carrega por 400 ms", () => {
    vi.useFakeTimers({ now: AGORA });
    montarSonda();
    const sonda = screen.getByTestId("sonda");
    expect(sonda).toHaveAttribute("data-periodo", "30d");
    expect(sonda).toHaveTextContent("nos últimos 30 dias · acordada");
    expect(ultimo!.simulacao).toBe("normal");
    expect(ultimo!.painel.papel).toBe("admin");

    let r: ReturnType<NonNullable<typeof ultimo>["setPeriodo"]> | undefined;
    act(() => {
      r = ultimo!.setPeriodo("7d");
    });
    expect(r).toEqual({ ok: true });
    expect(sonda).toHaveAttribute("data-carregando", "true");
    expect(sonda).toHaveTextContent("nos últimos 7 dias · carregando");
    act(() => {
      vi.advanceTimersByTime(ATRASO_CARREGANDO_MS - 1);
    });
    expect(sonda).toHaveAttribute("data-carregando", "true");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(sonda).toHaveAttribute("data-carregando", "false");
    expect(sonda).toHaveTextContent("nos últimos 7 dias · acordada");

    // o mesmo período de novo não carrega
    act(() => {
      ultimo!.setPeriodo("7d");
    });
    expect(sonda).toHaveAttribute("data-carregando", "false");
  });

  it("o personalizado com datas inválidas é recusado e nada muda", () => {
    vi.useFakeTimers({ now: AGORA });
    montarSonda();
    let r: unknown;
    act(() => {
      r = ultimo!.setPeriodo("personalizado", { inicio: "2026-10-20", fim: "2026-10-31" });
    });
    expect(r).toEqual({ ok: false, erro: "datas_invalidas" });
    act(() => {
      r = ultimo!.setPeriodo("personalizado");
    });
    expect(r).toEqual({ ok: false, erro: "datas_invalidas" });
    expect(screen.getByTestId("sonda")).toHaveAttribute("data-periodo", "30d");
    expect(screen.getByTestId("sonda")).toHaveAttribute("data-carregando", "false");

    act(() => {
      r = ultimo!.setPeriodo("personalizado", { inicio: "2026-10-01", fim: "2026-10-15" });
    });
    expect(r).toEqual({ ok: true });
    expect(screen.getByTestId("sonda")).toHaveTextContent("de 01/10 a 15/10");
  });

  it("a simulação 'Carregando' deixa carregando até voltar ao normal", () => {
    montarSonda();
    act(() => ultimo!.setSimulacao("carregando"));
    expect(screen.getByTestId("sonda")).toHaveAttribute("data-carregando", "true");
    expect(ultimo!.painel.estadoJanete).toBe("carregando");
    act(() => ultimo!.setSimulacao("normal"));
    expect(screen.getByTestId("sonda")).toHaveAttribute("data-carregando", "false");
  });

  it("primeiraVez: verdadeiro na 1ª montagem da aba (mesmo no StrictMode) e falso nas seguintes", () => {
    const { unmount } = montarSonda(true);
    expect(screen.getByTestId("sonda")).toHaveAttribute("data-primeira", "true");
    unmount();
    montarSonda(true);
    expect(screen.getByTestId("sonda")).toHaveAttribute("data-primeira", "false");
  });

  it("a saudação usa o nome da conta quando a busca termina", async () => {
    montarSonda();
    await act(async () => {
      await Promise.resolve();
    });
    expect(ultimo!.painel.textos.saudacao).toBe("Boa tarde, equipe");
  });

  it("não troca de valor à toa: re-renderizar sem mudança devolve o mesmo painel", () => {
    const { rerender } = montarSonda();
    const antes = ultimo!;
    rerender(
      <Casca>
        <ProvedorPainel relogio={relogio}>
          <Sonda />
        </ProvedorPainel>
      </Casca>,
    );
    expect(ultimo!.painel).toBe(antes.painel);
  });
});
