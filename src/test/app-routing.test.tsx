import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  const criar = () => createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it("matches a page for / instead of falling back to not found", () => {
    const matches = criar().matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  // Todas as rotas da spec: cada URL cai na rota certa, e as áreas ficam dentro da casca /app (e o
  // login, dentro do layout /_conta).
  it.each([
    ["/", "/"],
    ["/entrar", "/_conta/entrar"],
    ["/criar-conta", "/_conta/criar-conta"],
    ["/onboarding", "/onboarding"],
    ["/sem-acesso", "/sem-acesso"],
    ["/app", "/app/"],
    ["/app/chat", "/app/chat"],
    ["/app/contatos", "/app/contatos"],
    ["/app/kanban", "/app/kanban"],
    ["/app/dashboard", "/app/dashboard"],
    ["/app/equipe", "/app/equipe"],
    ["/app/contexto", "/app/contexto"],
    ["/app/configuracao", "/app/configuracao"],
  ])("%s abre a rota %s", (url, routeId) => {
    const ids = criar()
      .matchRoutes(url)
      .map((m) => m.routeId);

    expect(ids.at(-1)).toBe(routeId);
    if (url.startsWith("/app")) expect(ids).toContain("/app");
    // Entrar e Criar conta ficam sob o layout do palco (sem caminho): a bola não remonta na troca.
    if (url === "/entrar" || url === "/criar-conta") expect(ids).toContain("/_conta");
  });

  it("uma URL que não existe não abre nenhuma página", () => {
    const matches = criar().matchRoutes("/nao-existe");

    expect(matches.at(-1)?.routeId).toBe(rootRouteId);
  });
});
