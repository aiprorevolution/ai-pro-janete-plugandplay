import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ESTADO_INICIAL,
  gravarEstadoOnboarding,
  limparEstadoOnboarding,
  type EstadoOnboarding,
} from "@/features/onboarding/estado";
import { ATALHOS_JANETE } from "@/features/plataforma/atalhos";
import { useConta } from "@/features/plataforma/conta";
import { AREAS, AreaVazia, LayoutExemplo as Layout, VistaArea } from "@/features/plataforma/Layout";
import { CHAVE_TOUR_VISTO } from "@/features/plataforma/tour";
import { TelaConfiguracao } from "@/features/plataforma/configuracao";

// Firebase simulado: nome em user_metadata.nome e o e-mail do usuário logado.
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

function sessao(extra: Partial<EstadoOnboarding> = {}) {
  act(() =>
    gravarEstadoOnboarding({
      ...ESTADO_INICIAL,
      etapa: "preparando",
      concluidoEm: "2026-10-29T12:00:00.000Z",
      ...extra,
    }),
  );
}

function usuario(user: Record<string, unknown> | null) {
  getUser.mockReset().mockResolvedValue({ data: { user }, error: null });
}

beforeEach(() => {
  limparEstadoOnboarding();
  window.sessionStorage.clear();
  usuario({ email: "operador@empresa-teste.com.br", user_metadata: { nome: "Operador Teste" } });
});

afterEach(() => {
  window.sessionStorage.clear();
});

// As vistas só de leitura saíram: a Configuração virou tela antes (testes em t3-configuracao), e o
// Contexto e a Equipe viraram telas em 01/11 (testes em t5-contexto-* e t6-equipe-*).

describe("conta dentro da plataforma", () => {
  it("a tela reaproveita a conta que o Layout já buscou (uma chamada só)", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    sessao();
    // uma tela qualquer que lê a conta, no lugar da antiga Equipe só de leitura
    function LeConta() {
      const conta = useConta();
      return (
        <VistaArea area="equipe">
          <p>{conta.carregada ? conta.email : ""}</p>
        </VistaArea>
      );
    }
    const raiz = createRootRoute({ component: () => <Outlet /> });
    const app = createRoute({ getParentRoute: () => raiz, path: "/app", component: Layout });
    const filhos = AREAS.map((area) =>
      createRoute({
        getParentRoute: () => app,
        path: area.id,
        component:
          area.id === "equipe"
            ? LeConta
            : area.id === "configuracao"
              ? TelaConfiguracao
              : () => <AreaVazia area={area.id} />,
      }),
    );
    const router = createRouter({
      routeTree: raiz.addChildren([app.addChildren(filhos)]),
      history: createMemoryHistory({ initialEntries: ["/app/equipe"] }),
    });
    render(<RouterProvider router={router} />);

    const main = await screen.findByRole("main");
    expect(await within(main).findByText("operador@empresa-teste.com.br")).toBeInTheDocument();
    expect(within(main).getByRole("heading", { level: 1, name: "Equipe" })).toBeInTheDocument();
    expect(getUser).toHaveBeenCalledTimes(1);

    // as outras áreas abrem pelo menu, com o título no lugar de sempre (o foco dos atalhos)
    await act(() => router.navigate({ to: "/app/configuracao" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Configuração" })).toHaveAttribute("id", "area-configuracao");
    await act(() => router.navigate({ to: "/app/contexto" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Contexto" })).toHaveAttribute("id", "area-contexto");
  });
});

describe("textos dos atalhos que não podem prometer o que a tela não faz", () => {
  const atalho = (pergunta: string) => ATALHOS_JANETE.find((a) => a.pergunta === pergunta)!;

  it("'Quero te ensinar algo novo' diz só onde fica o que a Janete sabe", () => {
    const a = atalho("Quero te ensinar algo novo sobre a empresa");
    expect(a.resposta({})).toBe("Tudo o que eu sei sobre a sua empresa fica no Contexto.");
    expect(a.area).toBe("contexto");
  });

  it("'Pause o atendimento' não promete uma pausa que a Configuração não tem", () => {
    const a = atalho("Pause o atendimento até amanhã");
    expect(a.resposta({})).toBe(
      "Ainda não dá para pausar o atendimento. Quando der, a pausa vai ficar na Configuração.",
    );
    expect(a.area).toBe("configuracao");
  });

  it("'Revise como você está falando' aponta para o item Tom de voz, que o Contexto mostra", () => {
    expect(atalho("Revise como você está falando").resposta({})).toBe(
      "O meu jeito de falar fica no Contexto, no item Tom de voz.",
    );
  });
});
