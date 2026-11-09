import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AssinanteTempoReal,
  CHAVES,
  JUNTAR_AVISOS_MS,
  NOME_CANAL,
  POR_TABELA,
  ProvedorDados,
  TABELAS_TEMPO_REAL,
  TABELAS_TEMPO_REAL_HOJE,
  TABELAS_TEMPO_REAL_PACOTE,
  criarJuntador,
  removerPorId,
} from "@/features/plataforma/dados";
import { criarClienteFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import { criarEstadoInicial } from "@/features/plataforma/exemplo";

const criarEstadoInicialSeguro = () => criarEstadoInicial(new Date("2026-10-30T17:45:00.000Z"));

// F1: o AssinanteTempoReal, com um canal falso. Um canal só; cada aviso deixa velhas as raízes que
// leem a tabela (o mesmo POR_TABELA das ações); o DELETE tira a linha do cache pelo id; quando o
// canal volta depois de cair, ou a janela volta ao foco, relê o que está aberto.

// Os testes do mapa usam juntarMs 0 (invalida na hora); a junção das rajadas tem os testes dela.
function montar(tabelas?: readonly string[], juntarMs = 0) {
  const f = criarClienteFalso();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  const vista = render(
    <QueryClientProvider client={qc}>
      <ProvedorDados fonte="banco" cliente={f.cliente}>
        <AssinanteTempoReal {...(tabelas ? { tabelas } : {})} juntarMs={juntarMs} />
      </ProvedorDados>
    </QueryClientProvider>,
  );
  const canal = f.canais.find((c) => c.nome === NOME_CANAL)!;
  const raizes = () =>
    invalidar.mock.calls
      .map((c) => (c[0] as { queryKey?: readonly string[] } | undefined)?.queryKey?.[0])
      .filter((x): x is string => !!x);
  const tudo = () => invalidar.mock.calls.filter((c) => !(c[0] as { queryKey?: unknown } | undefined)?.queryKey);
  return { f, qc, canal, invalidar, raizes, tudo, vista };
}

afterEach(cleanup);

describe("AssinanteTempoReal", () => {
  it("abre um canal só, escutando as 8 tabelas da publicação (as da 0000 e as do pacote, 0010)", () => {
    const { f, canal } = montar();
    expect(f.canais.filter((c) => c.nome === NOME_CANAL)).toHaveLength(1);
    expect(canal.avisos.map((a) => a.filtro)).toEqual(
      TABELAS_TEMPO_REAL.map((table) => ({ event: "*", schema: "public", table })),
    );
    expect([...TABELAS_TEMPO_REAL]).toEqual([...TABELAS_TEMPO_REAL_HOJE, ...TABELAS_TEMPO_REAL_PACOTE]);
    expect([...TABELAS_TEMPO_REAL].sort()).toEqual(
      ["contato_etapa_historico", "contatos", "conversa_eventos", "conversas", "etapas", "membros", "mensagens", "rodadas"],
    );
    // conexoes e ia_chaves ficam de fora (relidas no foco e a cada 60 s)
    expect(TABELAS_TEMPO_REAL).not.toContain("conexoes");
    expect(TABELAS_TEMPO_REAL).not.toContain("ia_chaves");
    // toda tabela escutada tem raízes no POR_TABELA
    for (const t of TABELAS_TEMPO_REAL) expect(POR_TABELA[t as keyof typeof POR_TABELA].length).toBeGreaterThan(0);
  });

  it.each([
    ["INSERT", "mensagens"],
    ["UPDATE", "conversas"],
    ["UPDATE", "contatos"],
  ] as const)("%s em %s invalida as raízes que leem a tabela", (eventType, table) => {
    const { canal, raizes } = montar();
    act(() => canal.emitir({ table, eventType, new: { id: "x" }, old: {} }));
    expect(raizes().sort()).toEqual([...POR_TABELA[table]].sort());
  });

  it("as tabelas do pacote do banco têm o mapa: etapas, histórico, rodadas, membros e eventos", () => {
    const { canal, raizes, invalidar } = montar();
    act(() => canal.emitir({ table: "rodadas", eventType: "UPDATE", new: { id: "r" } }));
    // o custo, o Dashboard e o motivo do movimento da Janete (o histórico lê pela rodada)
    expect(raizes().sort()).toEqual(["custos", "dashboard", "historico"]);
    invalidar.mockClear();
    act(() => canal.emitir({ table: "contato_etapa_historico", eventType: "INSERT", new: { id: "h" } }));
    expect(raizes()).toEqual(expect.arrayContaining(["historico", "quadro"]));
    invalidar.mockClear();
    act(() => canal.emitir({ table: "membros", eventType: "UPDATE", new: { id: "m" } }));
    expect(raizes().sort()).toEqual(["eu", "membros"]);
    act(() => canal.emitir({ table: "conversa_eventos", eventType: "INSERT", new: { id: "e" } }));
    expect(raizes()).toEqual(expect.arrayContaining(["eventos", "dashboard"]));
    act(() => canal.emitir({ table: "etapas", eventType: "UPDATE", new: { id: "e" } }));
    expect(raizes()).toEqual(expect.arrayContaining(["etapas", "quadro", "contatos"]));
  });

  it("DELETE tira a linha do cache pelo id (listas e { linhas, total }) e invalida", () => {
    const { qc, canal, raizes } = montar();
    qc.setQueryData([...CHAVES.contatos, "pagina", 1], { total: 3, linhas: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    qc.setQueryData([...CHAVES.conversas, "lista"], [{ id: "a" }, { id: "z" }]);
    qc.setQueryData([...CHAVES.aguardando, "todas"], [{ id: "q" }]);
    act(() => canal.emitir({ table: "contatos", eventType: "DELETE", old: { id: "b" } }));
    expect(qc.getQueryData([...CHAVES.contatos, "pagina", 1])).toEqual({ total: 2, linhas: [{ id: "a" }, { id: "c" }] });
    act(() => canal.emitir({ table: "conversas", eventType: "DELETE", old: { id: "a" } }));
    expect(qc.getQueryData([...CHAVES.conversas, "lista"])).toEqual([{ id: "z" }]);
    expect(qc.getQueryData([...CHAVES.aguardando, "todas"])).toEqual([{ id: "q" }]);
    expect(raizes()).toEqual(expect.arrayContaining(["contatos", "conversas", "aguardando"]));
  });

  it("DELETE também sai das leituras paginadas ({ pages }) e do conversa/contato de um id só", () => {
    const { qc, canal } = montar();
    const paginas = { pages: [[{ id: "m3" }, { id: "m2" }], [{ id: "m1" }]], pageParams: [0, 2] };
    qc.setQueryData([...CHAVES.mensagens, "cv-1"], paginas);
    qc.setQueryData([...CHAVES.contatos, "um", "ct-1"], { id: "ct-1", nome: "Ana" });
    act(() => canal.emitir({ table: "mensagens", eventType: "DELETE", old: { id: "m2" } }));
    expect(qc.getQueryData([...CHAVES.mensagens, "cv-1"])).toEqual({ pages: [[{ id: "m3" }], [{ id: "m1" }]], pageParams: [0, 2] });
    act(() => canal.emitir({ table: "contatos", eventType: "DELETE", old: { id: "ct-1" } }));
    expect(qc.getQueryData([...CHAVES.contatos, "um", "ct-1"])).toBeNull();
    // um id que não está em cache não troca o objeto
    expect(removerPorId(paginas, "nada")).toBe(paginas);
  });

  it("reconectou (caiu e voltou): relê tudo o que está aberto; a 1ª conexão não relê", () => {
    const { canal, tudo } = montar();
    act(() => canal.status("SUBSCRIBED"));
    expect(tudo()).toHaveLength(0);
    act(() => canal.status("CHANNEL_ERROR"));
    act(() => canal.status("SUBSCRIBED"));
    expect(tudo()).toHaveLength(1);
    expect(tudo()[0]![0]).toEqual({ refetchType: "active" });
    act(() => canal.status("TIMED_OUT"));
    act(() => canal.status("SUBSCRIBED"));
    expect(tudo()).toHaveLength(2);
  });

  it("a janela voltou ao foco: relê o que está aberto (uma vez, mesmo com focus e visibilitychange juntos)", () => {
    const { tudo } = montar();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(tudo()).toHaveLength(1);
  });

  it("desmontou: tira o canal e para de ouvir o foco", () => {
    const { canal, vista, tudo } = montar();
    vista.unmount();
    expect(canal.removido).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(tudo()).toHaveLength(0);
  });

  it(`junta a rajada: 50 avisos seguidos produzem uma invalidação por raiz, ${JUNTAR_AVISOS_MS} ms depois do 1º`, () => {
    vi.useFakeTimers();
    try {
      const { canal, raizes } = montar(undefined, JUNTAR_AVISOS_MS);
      act(() => {
        for (let i = 0; i < 50; i++) {
          canal.emitir({ table: i % 2 ? "mensagens" : "conversas", eventType: "UPDATE", new: { id: `x${i}` } });
        }
      });
      expect(raizes()).toEqual([]);
      act(() => vi.advanceTimersByTime(JUNTAR_AVISOS_MS));
      const esperadas = [...new Set([...POR_TABELA.mensagens, ...POR_TABELA.conversas])].sort();
      expect(raizes().sort()).toEqual(esperadas);
      // A próxima rajada abre outra janela.
      act(() => canal.emitir({ table: "contatos", eventType: "UPDATE", new: { id: "c" } }));
      act(() => vi.advanceTimersByTime(JUNTAR_AVISOS_MS));
      expect(raizes().length).toBe(esperadas.length + POR_TABELA.contatos.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("na rajada, o DELETE sai do cache na hora; a invalidação espera a junção", () => {
    vi.useFakeTimers();
    try {
      const { qc, canal, raizes } = montar(undefined, JUNTAR_AVISOS_MS);
      qc.setQueryData([...CHAVES.contatos, "pagina", 1], { total: 2, linhas: [{ id: "a" }, { id: "b" }] });
      act(() => canal.emitir({ table: "contatos", eventType: "DELETE", old: { id: "a" } }));
      expect(qc.getQueryData([...CHAVES.contatos, "pagina", 1])).toEqual({ total: 1, linhas: [{ id: "b" }] });
      expect(raizes()).toEqual([]);
      act(() => vi.advanceTimersByTime(JUNTAR_AVISOS_MS));
      expect(raizes().sort()).toEqual([...POR_TABELA.contatos].sort());
    } finally {
      vi.useRealTimers();
    }
  });

  it("desmontou no meio da rajada: não invalida depois", () => {
    vi.useFakeTimers();
    try {
      const { canal, raizes, vista } = montar(undefined, JUNTAR_AVISOS_MS);
      act(() => canal.emitir({ table: "mensagens", eventType: "INSERT", new: { id: "m" } }));
      vista.unmount();
      act(() => vi.advanceTimersByTime(JUNTAR_AVISOS_MS * 2));
      expect(raizes()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("criarJuntador com espera 0 invalida na hora (o mesmo que aplicarMudanca)", () => {
    const qc = new QueryClient();
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    criarJuntador(qc, 0).aviso({ table: "contatos", eventType: "UPDATE", new: { id: "c" } });
    expect(invalidar).toHaveBeenCalledTimes(POR_TABELA.contatos.length);
  });

  it("no modo exemplo não abre canal", () => {
    const f = criarClienteFalso();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProvedorDados exemplo={criarEstadoInicialSeguro}>
          <AssinanteTempoReal />
        </ProvedorDados>
      </QueryClientProvider>,
    );
    expect(f.canais).toHaveLength(0);
  });
});

describe("removerPorId", () => {
  it("devolve o mesmo objeto quando o id não está lá", () => {
    const lista = [{ id: "a" }];
    expect(removerPorId(lista, "x")).toBe(lista);
    const pagina = { total: 1, linhas: lista };
    expect(removerPorId(pagina, "x")).toBe(pagina);
    expect(removerPorId(undefined, "x")).toBeUndefined();
  });

  it("um item sozinho com o id vira nulo", () => {
    expect(removerPorId({ id: "a", nome: "x" }, "a")).toBeNull();
  });
});
