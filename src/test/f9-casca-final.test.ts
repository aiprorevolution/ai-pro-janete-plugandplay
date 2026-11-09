import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { CHAVES, INVALIDA, POR_TABELA } from "@/features/plataforma/dados/chaves";
import { conversaEmCache } from "@/features/plataforma/dados/ProvedorDados";

// A casca final (spec de ligar as telas ao banco): os pedidos das áreas que tocam a fundação.

describe("CHAVES.dashboardPeriodo (pedido do Dashboard)", () => {
  it("é uma raiz própria, separada do 'agora' do Dashboard", () => {
    expect(CHAVES.dashboardPeriodo).toEqual(["dashboard-periodo"]);
    // o prefixo não casa com o do "agora": invalidar CHAVES.dashboard não relê o período
    expect(CHAVES.dashboardPeriodo[0]).not.toBe(CHAVES.dashboard[0]);
  });

  it("fica fora do tempo real e das ações (relê a cada 60 s e no foco)", () => {
    for (const raizes of Object.values(POR_TABELA)) expect(raizes).not.toContain("dashboardPeriodo");
    for (const raizes of Object.values(INVALIDA)) expect(raizes).not.toContain("dashboardPeriodo");
  });

  it("o 'agora' do Dashboard continua no tempo real", () => {
    expect(POR_TABELA.mensagens).toContain("dashboard");
    expect(POR_TABELA.conversas).toContain("dashboard");
  });
});

describe("conversaEmCache acha a conversa na linha do quadro (pedido do Kanban)", () => {
  const conversa = { id: "cv-1", nao_lidas: 0, ultima_do_lead_em: "2026-11-01T12:00:00.000Z" };
  const quadro = {
    linhas: [
      { contato: { id: "ct-0" }, conversa: { id: "cv-0", nao_lidas: 2, ultima_do_lead_em: null }, ultima: null },
      { contato: { id: "ct-1" }, conversa, ultima: null },
    ],
    totaisFim: {},
    desdeFim: "2026-10-03T00:00:00-03:00",
  };

  it("lê pelo campo 'conversa' das linhas { contato, conversa, ultima }", () => {
    const qc = new QueryClient();
    qc.setQueryData([...CHAVES.quadro, "cards", "x"], quadro);
    expect(conversaEmCache(qc, "cv-1")).toEqual(conversa);
    expect(conversaEmCache(qc, "cv-0")?.nao_lidas).toBe(2);
  });

  it("o contato da linha (sem nao_lidas) não é confundido com a conversa", () => {
    const qc = new QueryClient();
    qc.setQueryData([...CHAVES.quadro, "cards", "x"], quadro);
    expect(conversaEmCache(qc, "ct-1")).toBeNull();
    expect(conversaEmCache(qc, "cv-9")).toBeNull();
  });
});
