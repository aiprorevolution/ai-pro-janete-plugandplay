import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Onboarding } from "@/features/onboarding/Onboarding";
import { limparEstadoOnboarding, onboardingConcluido } from "@/features/onboarding/estado";
import { criarDadosOnboardingMemoria } from "@/features/plataforma/dados/onboarding";
import { AREAS, AreaVazia, LayoutExemplo as Layout } from "@/features/plataforma/Layout";

// O orquestrador é testado com etapas de mentira (cada etapa de verdade tem os testes dela, c2 a c5):
// aqui só importa a troca de etapa, a trilha, o foco e a conclusão.
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

beforeEach(() => limparEstadoOnboarding());
afterEach(() => window.sessionStorage.clear());

describe("Onboarding (orquestrador)", () => {
  it("mostra a etapa atual, avança e volta, marca a trilha e conclui na última", async () => {
    const aoConcluir = vi.fn();
    // C8: sem banco; nada gravado, e o concluir do banco responde na hora
    render(<Onboarding aoConcluir={aoConcluir} dados={criarDadosOnboardingMemoria()} />);

    const titulo = () => screen.getByRole("heading", { level: 1 }).textContent;
    const itens = () =>
      within(screen.getByRole("navigation", { name: "Etapas do onboarding" })).getAllByRole("listitem");
    expect(titulo()).toBe("WhatsApp");
    expect(itens()).toHaveLength(7);
    expect(itens()[0]).toHaveAttribute("aria-current", "step");

    const avancar = () => fireEvent.click(screen.getByRole("button", { name: /Avançar|Ir para a plataforma/ }));
    avancar();
    expect(titulo()).toBe("Cérebro");
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(titulo()).toBe("WhatsApp");

    for (const esperado of ["Cérebro", "Janete", "Voz", "Conversa", "Preparo"]) {
      avancar();
      expect(titulo()).toBe(esperado);
    }
    expect(itens()[5]).toHaveAttribute("aria-current", "step");
    expect(itens()[6]).not.toHaveAttribute("aria-current");
    expect(aoConcluir).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ir para a plataforma" }));
    // o fim grava no banco (concluir_onboarding) antes de ir para a plataforma
    await waitFor(() => expect(aoConcluir).toHaveBeenCalledTimes(1));
    expect(onboardingConcluido()).toBe(true);
  });

  it("ao avançar ou voltar, o foco vai para o título da etapa nova (ao abrir, dá a vez à etapa)", async () => {
    render(<Onboarding aoConcluir={() => {}} dados={criarDadosOnboardingMemoria()} />);
    // ao abrir, a etapa tem 100 ms para levar o foco aonde quiser; esta etapa falsa não foca nada
    expect(document.activeElement).toBe(document.body);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "WhatsApp" })),
    );

    const botaoAvancar = screen.getByRole("button", { name: "Avançar" });
    botaoAvancar.focus();
    fireEvent.click(botaoAvancar);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Cérebro" }));

    const botaoVoltar = screen.getByRole("button", { name: "Voltar" });
    botaoVoltar.focus();
    fireEvent.click(botaoVoltar);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "WhatsApp" }));
  });
});

describe("Layout da plataforma (esqueleto)", () => {
  it("tem o menu das 7 áreas, na ordem da spec, e mostra a área aberta no Outlet", async () => {
    const raiz = createRootRoute();
    const app = createRoute({ getParentRoute: () => raiz, path: "/app", component: Layout });
    const areas = AREAS.map((area) =>
      createRoute({ getParentRoute: () => app, path: area.id, component: () => <AreaVazia area={area.id} /> }),
    );
    const router = createRouter({
      routeTree: raiz.addChildren([app.addChildren(areas)]),
      history: createMemoryHistory({ initialEntries: ["/app/kanban"] }),
    });

    render(<RouterProvider router={router} />);

    const menu = await screen.findByRole("navigation", { name: "Áreas da plataforma" });
    const links = Array.from(menu.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual([
      "Chat",
      "Contatos",
      "Kanban",
      "Dashboard",
      "Equipe",
      "Contexto",
      "Configuração",
    ]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/app/chat",
      "/app/contatos",
      "/app/kanban",
      "/app/dashboard",
      "/app/equipe",
      "/app/contexto",
      "/app/configuracao",
    ]);
    expect(await screen.findByRole("heading", { level: 1, name: "Kanban" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kanban" })).toHaveAttribute("aria-current", "page");
  });
});
