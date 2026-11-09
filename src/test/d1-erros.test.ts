import { describe, expect, it } from "vitest";

import { CODIGOS_DO_BANCO, SemLinhas, exigirLinhas, recusado, traduzirErro } from "@/features/plataforma/dados/erros";
import { CHAVES, INVALIDA, POR_TABELA, TABELAS_DA_ACAO } from "@/features/plataforma/dados/chaves";
import { NOMES_ACOES } from "@/features/plataforma/dados/fonte";

// F1: o tradutor de erros (spec 2.1) e a tabela "ação → o que atualiza" (plano, peças comuns, item 8).

const p0001 = (message: string) => ({ code: "P0001", message, details: null, hint: null });

describe("traduzirErro: os códigos P0001 da spec 2.3", () => {
  // A lista da spec 2.3, "Códigos P0001": os novos e os que continuam, com o Erro esperado.
  const CASOS: [string, string][] = [
    ["etapa_travada", "sem_permissao"],
    ["nao_reenviavel", "nao_reenviavel"],
    ["proprio_membro", "proprio_membro"],
    ["contexto_mudou", "contexto_mudou"],
    ["limite_tamanho", "limite_tamanho"],
    ["limite_itens", "limite_itens"],
    ["sem_acesso", "sem_acesso"],
    ["etapa_arquivada", "etapa_arquivada"],
    ["etapa_com_leads", "etapa_com_leads"],
    ["sem_etapa_de_entrada", "sem_etapa_de_entrada"],
    ["sem_conexao_ativa", "sem_conexao_ativa"],
    ["janela_fechada", "janela_fechada"],
    ["ultimo_admin", "ultimo_admin"],
    ["conversa_nao_encontrada", "nao_encontrado"],
    ["nao_encontrado", "nao_encontrado"],
  ];

  it.each(CASOS)("P0001 %s → %s", (codigo, esperado) => {
    expect(traduzirErro(p0001(codigo)).erro).toBe(esperado);
  });

  it("todo código da lista está no mapa (nenhum cai em falha por esquecimento)", () => {
    for (const [codigo] of CASOS) expect(CODIGOS_DO_BANCO[codigo]).toBeDefined();
  });

  it("os outros códigos das funções novas também", () => {
    expect(traduzirErro(p0001("sem_permissao")).erro).toBe("sem_permissao");
    expect(traduzirErro(p0001("mensagem_nao_encontrada")).erro).toBe("nao_encontrado");
  });

  it("P0001 desconhecido vira falha, com o código no detalhe", () => {
    expect(traduzirErro(p0001("parametro_invalido"))).toEqual({ erro: "falha", detalhe: "parametro_invalido" });
  });
});

describe("traduzirErro: os códigos do Postgres e do PostgREST", () => {
  it("42501 (sem permissão, RLS ou grant) → sem_acesso", () => {
    expect(traduzirErro({ code: "42501", message: "permission denied for table convites" }).erro).toBe("sem_acesso");
  });

  it("23505 (único repetido) → email_em_uso", () => {
    expect(traduzirErro({ code: "23505", message: 'duplicate key value violates unique constraint "convites_email_key"' }).erro).toBe(
      "email_em_uso",
    );
  });

  it("23514 do check do nome → nome_vazio", () => {
    expect(
      traduzirErro({ code: "23514", message: 'new row for relation "etapas" violates check constraint "etapas_nome_check"' }).erro,
    ).toBe("nome_vazio");
  });

  it("23514 de outro check (ritmo, duração) → limite_tamanho", () => {
    const r = traduzirErro({ code: "23514", message: 'violates check constraint "configuracao_ritmo"' });
    expect(r.erro).toBe("limite_tamanho");
    expect(r.detalhe).toContain("configuracao_ritmo");
  });

  it("22P02 (uuid inválido) → nao_encontrado", () => {
    expect(traduzirErro({ code: "22P02", message: 'invalid input syntax for type uuid: "abc"' }).erro).toBe("nao_encontrado");
  });

  it("PGRST116 (.single sem linha) → nao_encontrado", () => {
    expect(traduzirErro({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }).erro).toBe(
      "nao_encontrado",
    );
  });
});

describe("traduzirErro: 0 linhas, rede e o resto", () => {
  it("UPDATE com 0 linhas (exigirLinhas) → nao_encontrado", () => {
    let pego: unknown = null;
    try {
      exigirLinhas({ data: [], error: null }, "contatos");
    } catch (e) {
      pego = e;
    }
    expect(pego).toBeInstanceOf(SemLinhas);
    expect(traduzirErro(pego).erro).toBe("nao_encontrado");
    // data nulo também é 0 linhas
    expect(() => exigirLinhas({ data: null, error: null })).toThrow(SemLinhas);
  });

  it("exigirLinhas devolve as linhas, e o erro do banco sobe como veio", () => {
    expect(exigirLinhas({ data: [{ id: "a" }], error: null })).toEqual([{ id: "a" }]);
    const erro = { code: "42501", message: "x" };
    expect(() => exigirLinhas({ data: null, error: erro })).toThrow();
    try {
      exigirLinhas({ data: null, error: erro });
    } catch (e) {
      expect(e).toBe(erro);
    }
  });

  it("rede (TypeError: Failed to fetch) → falha, com o texto cru", () => {
    expect(traduzirErro(new TypeError("Failed to fetch"))).toEqual({ erro: "falha", detalhe: "Failed to fetch" });
  });

  it("o PostgrestError de rede (sem código) → falha, com o texto cru", () => {
    expect(traduzirErro({ code: "", message: "TypeError: NetworkError when attempting to fetch resource." })).toEqual({
      erro: "falha",
      detalhe: "TypeError: NetworkError when attempting to fetch resource.",
    });
  });

  it("desconhecido (string, nulo, objeto qualquer) → falha", () => {
    expect(traduzirErro("deu ruim")).toEqual({ erro: "falha", detalhe: "deu ruim" });
    expect(traduzirErro(null).erro).toBe("falha");
    expect(traduzirErro(undefined).erro).toBe("falha");
    expect(traduzirErro({ qualquer: 1 }).erro).toBe("falha");
  });

  it("o resultado recusado de uma função de servidor passa como veio", () => {
    expect(traduzirErro({ ok: false, erro: "email_em_uso" })).toEqual({ erro: "email_em_uso" });
    expect(traduzirErro({ ok: false, erro: "sem_acesso", mensagem: "só admin" })).toEqual({ erro: "sem_acesso", detalhe: "só admin" });
    expect(traduzirErro({ ok: false, erro: "algo_novo" }).erro).toBe("falha");
  });

  it("recusado() monta o Resultado sem detalhe vazio", () => {
    expect(recusado(p0001("sem_acesso"))).toEqual({ ok: false, erro: "sem_acesso" });
    expect(recusado(new Error("x"))).toEqual({ ok: false, erro: "falha", detalhe: "x" });
  });
});

describe("INVALIDA: a tabela ação → o que ela atualiza", () => {
  it("tem uma entrada para cada ação de AcoesDados, e nenhuma a mais", () => {
    expect(Object.keys(INVALIDA).sort()).toEqual([...NOMES_ACOES].sort());
    expect(Object.keys(TABELAS_DA_ACAO).sort()).toEqual([...NOMES_ACOES].sort());
    expect(NOMES_ACOES).toHaveLength(11);
  });

  it("toda ação invalida alguma raiz, e toda raiz existe em CHAVES", () => {
    for (const acao of NOMES_ACOES) {
      expect(INVALIDA[acao].length).toBeGreaterThan(0);
      for (const raiz of INVALIDA[acao]) expect(CHAVES[raiz]).toBeDefined();
    }
    for (const raizes of Object.values(POR_TABELA)) for (const raiz of raizes) expect(CHAVES[raiz]).toBeDefined();
  });

  it("invalida pela tabela que mudou: as raízes da ação são as das tabelas dela", () => {
    for (const acao of NOMES_ACOES) {
      const esperadas = new Set(TABELAS_DA_ACAO[acao].flatMap((t) => POR_TABELA[t]));
      expect(new Set(INVALIDA[acao])).toEqual(esperadas);
    }
  });

  it("os exemplos do plano: editar etapas muda o Chat, os Contatos, o Dashboard e o Kanban", () => {
    expect(INVALIDA.editarEtapa).toEqual(expect.arrayContaining(["etapas", "conversas", "contatos", "dashboard", "quadro"]));
    expect(INVALIDA.reordenarEtapas).toEqual(expect.arrayContaining(["etapas", "contatos", "quadro"]));
  });

  it("as ações de conversa atualizam a fila (Precisam de você) e as passagens", () => {
    for (const acao of ["enviarMensagem", "assumir", "devolverParaJanete"] as const) {
      expect(INVALIDA[acao]).toEqual(expect.arrayContaining(["conversas", "aguardando", "eventos"]));
    }
    expect(INVALIDA.enviarMensagem).toContain("mensagens");
    expect(INVALIDA.marcarLida).toEqual(expect.arrayContaining(["conversas", "aguardando"]));
    expect(INVALIDA.moverEtapa).toEqual(expect.arrayContaining(["contatos", "historico", "quadro"]));
    expect(INVALIDA.apagarContato).toEqual(expect.arrayContaining(["contatos", "conversas", "mensagens", "auditoria", "custos"]));
    expect(INVALIDA.marcarVisto).toEqual(expect.arrayContaining(["eu"]));
  });

  it("os links das mídias não entram (vencem sozinhos)", () => {
    for (const acao of NOMES_ACOES) expect(INVALIDA[acao]).not.toContain("midias");
  });
});
