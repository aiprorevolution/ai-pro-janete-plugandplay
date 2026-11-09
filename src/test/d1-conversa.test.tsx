import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CHAVES,
  COLUNAS_CONTATO,
  COLUNAS_CONVERSA,
  COLUNAS_EVENTO,
  COLUNAS_HISTORICO,
  COLUNAS_MENSAGEM,
  INVALIDA,
  POR_TABELA,
  ProvedorDados,
  TAMANHO_PAGINA_MENSAGENS,
  juntarPaginas,
  lerAnotacoesJanete,
  useContato,
  useConversa,
  useConversaDoContato,
  useCustoConversas,
  useEventos,
  useHistoricoContato,
  useDados,
  useMensagens,
  type LeituraMensagens,
  type Leitura,
  type MensagemDados,
} from "@/features/plataforma/dados";
import { criarClienteFalso, type Consulta, type OpcoesFalso, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";
import { criarEstadoInicial, type EstadoBase, type Mensagem } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// As leituras de conversa comuns (dados/conversa.ts), que o Chat, o Kanban e os Contatos dividem: no
// modo banco (cliente do Firebase falso, nada vai à rede) e no modo exemplo (o estado em memória).

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CV = "11111111-1111-4111-8111-111111111111";
const CT = "22222222-2222-4222-8222-222222222222";

const membro = (papel: "admin" | "atendente") => ({
  id: "mb-1",
  nome: "Ana",
  email: "ana@teste.com",
  papel,
  ativo: true,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
});

function msg(i: number, extra: Partial<MensagemDados> = {}): MensagemDados {
  const momento = new Date(Date.UTC(2026, 10, 2, 12, 0, i)).toISOString();
  return {
    id: `msg-${String(i).padStart(4, "0")}`,
    conversa_id: CV,
    conexao_id: "cx-1",
    direcao: "entrada",
    origem: "lead",
    tipo: "texto",
    status: "recebida",
    texto: `mensagem ${i}`,
    transcricao: null,
    momento,
    autor_membro_id: null,
    midia_nome: null,
    midia_mime: null,
    midia_tamanho: null,
    midia_caminho: null,
    midia_status: null,
    editada: false,
    apagada_em: null,
    erro: null,
    id_externo: null,
    id_gateway: null,
    criado_em: momento,
    responde_a_id: null,
    midia_duracao_s: null,
    ...extra,
  };
}

afterEach(cleanup);

/* =============================================================================
   modo banco
   ============================================================================= */

type Lidas = {
  conversa?: Leitura<unknown>;
  doContato?: Leitura<unknown>;
  mensagens?: LeituraMensagens;
  eventos?: Leitura<unknown[]>;
  historico?: Leitura<unknown[]>;
  contato?: Leitura<unknown>;
  custos?: Leitura<Readonly<Record<string, number>>>;
};

interface Ids {
  conversa?: string | null | undefined;
  contato?: string | null | undefined;
  custos?: string[] | undefined;
}

function montarBanco(opcoes: OpcoesFalso & { papel?: "admin" | "atendente"; ids?: Ids } = {}) {
  const { papel = "admin", ids = { conversa: CV, contato: CT, custos: [] }, ...falso } = opcoes;
  const responder = (c: Consulta): Resposta | undefined => {
    const r = falso.consulta?.(c);
    if (r) return r;
    if (c.tabela === "membros" && c.unica) return { data: membro(papel), error: null };
    return undefined;
  };
  const f = criarClienteFalso({ uid: UID, ...falso, consulta: responder });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(CHAVES.eu, membro(papel));
  const lidas: Lidas = {};
  function Leitor() {
    lidas.conversa = useConversa(ids.conversa);
    lidas.doContato = useConversaDoContato(ids.contato);
    lidas.mensagens = useMensagens(ids.conversa);
    lidas.eventos = useEventos(ids.conversa);
    lidas.historico = useHistoricoContato(ids.contato);
    lidas.contato = useContato(ids.contato);
    lidas.custos = useCustoConversas(ids.custos ?? []);
    return null;
  }
  render(
    <QueryClientProvider client={qc}>
      <ProvedorDados fonte="banco" cliente={f.cliente}>
        <Leitor />
      </ProvedorDados>
    </QueryClientProvider>,
  );
  return { f, qc, lidas };
}

const consultasDe = (f: ReturnType<typeof criarClienteFalso>, tabela: string) => f.consultas.filter((c) => c.tabela === tabela);

describe("leituras de conversa no modo banco", () => {
  it("conversa, conversa do contato e contato: colunas listadas, pelo id, uma linha só", async () => {
    const conversa = { id: CV, contato_id: CT, modo: "janete", ultima_mensagem_id: "msg-9", ultima_da_janete_em: null };
    const { f, lidas } = montarBanco({
      consulta: (c) => {
        if (c.tabela === "conversas" && c.unica) return { data: conversa, error: null };
        if (c.tabela === "contatos" && c.unica) return { data: { id: CT, nome: "Ricardo", anotacoes_janete: null }, error: null };
        return undefined;
      },
    });
    await waitFor(() => expect(lidas.conversa?.dados).toEqual(conversa));
    await waitFor(() => expect(lidas.doContato?.dados).toEqual(conversa));
    await waitFor(() => expect(lidas.contato?.dados).toMatchObject({ id: CT, nome: "Ricardo", fatosJanete: [], proximoPasso: null }));
    const [porId, porContato] = consultasDe(f, "conversas");
    expect(porId).toMatchObject({ op: "select", valor: COLUNAS_CONVERSA, unica: true });
    expect(porId!.passos).toEqual([["eq", "id", CV]]);
    expect(porContato!.passos).toEqual([["eq", "contato_id", CT]]);
    expect(String(COLUNAS_CONVERSA).split(", ")).toEqual(expect.arrayContaining(["ultima_mensagem_id", "ultima_da_janete_em"]));
    const contato = consultasDe(f, "contatos")[0]!;
    expect(contato).toMatchObject({ valor: COLUNAS_CONTATO, unica: true });
    expect(String(COLUNAS_CONTATO).split(", ")).toEqual(expect.arrayContaining(["resumo_janete_em", "anotacoes_janete"]));
  });

  it("sem id, nada vai ao banco e as leituras já chegam vazias", async () => {
    const { f, lidas } = montarBanco({ ids: { conversa: null, contato: undefined, custos: [] } });
    await waitFor(() => expect(lidas.custos?.carregando).toBe(false));
    expect(lidas.conversa).toMatchObject({ dados: null, carregando: false, erro: null });
    expect(lidas.doContato).toMatchObject({ dados: null, carregando: false });
    expect(lidas.contato).toMatchObject({ dados: null, carregando: false });
    expect(lidas.mensagens).toMatchObject({ dados: [], carregando: false, temMaisAntigas: false });
    expect(lidas.eventos).toMatchObject({ dados: [], carregando: false });
    expect(lidas.historico).toMatchObject({ dados: [], carregando: false });
    expect(lidas.custos).toMatchObject({ dados: {}, carregando: false });
    expect(f.consultas.filter((c) => c.tabela !== "membros")).toHaveLength(0);
    expect(f.rpcs).toHaveLength(0);
  });

  it("o contato lê os fatos e o próximo passo de anotacoes_janete (só para ler)", async () => {
    const anotacoes = {
      fatos: [
        { rotulo: "Orçamento", valor: "R$ 30 mil", mensagem_id: "msg-3" },
        { rotulo: "Prazo", valor: "março" },
        { rotulo: "", valor: "sem rótulo" },
      ],
      proximo_passo: { titulo: "Mandar proposta", texto: "Ele pediu até sexta." },
    };
    const { lidas } = montarBanco({
      consulta: (c) => (c.tabela === "contatos" && c.unica ? { data: { id: CT, anotacoes_janete: anotacoes }, error: null } : undefined),
    });
    await waitFor(() =>
      expect(lidas.contato?.dados).toMatchObject({
        fatosJanete: [
          { rotulo: "Orçamento", valor: "R$ 30 mil", mensagemId: "msg-3" },
          { rotulo: "Prazo", valor: "março", mensagemId: null },
        ],
        proximoPasso: { titulo: "Mandar proposta", texto: "Ele pediu até sexta." },
      }),
    );
    expect(lerAnotacoesJanete(null)).toEqual({ fatos: [], proximoPasso: null });
    expect(lerAnotacoesJanete({ fatos: "x", proximo_passo: [] })).toEqual({ fatos: [], proximoPasso: null });
  });

  it("mensagens: as 50 mais recentes primeiro, na ordem da conversa; 'carregar mais antigas' busca a página de antes", async () => {
    // 120 mensagens no banco, da mais antiga (0) para a mais nova (119)
    const todas = Array.from({ length: 120 }, (_, i) => msg(i));
    const desc = [...todas].reverse();
    const { f, lidas } = montarBanco({
      consulta: (c) => {
        if (c.tabela !== "mensagens") return undefined;
        const range = c.passos.find((p) => p[0] === "range")!;
        return { data: desc.slice(range[1] as number, (range[2] as number) + 1), error: null };
      },
    });
    await waitFor(() => expect(lidas.mensagens?.dados).toHaveLength(TAMANHO_PAGINA_MENSAGENS));
    expect(lidas.mensagens!.dados!.map((m) => m.id)).toEqual(todas.slice(70).map((m) => m.id));
    expect(lidas.mensagens!.temMaisAntigas).toBe(true);
    const primeira = consultasDe(f, "mensagens")[0]!;
    expect(primeira.valor).toBe(COLUNAS_MENSAGEM);
    expect(primeira.passos).toEqual([
      ["eq", "conversa_id", CV],
      ["order", "momento", { ascending: false }],
      ["order", "criado_em", { ascending: false }],
      ["order", "ordem", { ascending: false, nullsFirst: false }],
      ["order", "id", { ascending: false }],
      ["range", 0, 49],
    ]);

    await act(async () => lidas.mensagens!.carregarMaisAntigas());
    await waitFor(() => expect(lidas.mensagens?.dados).toHaveLength(100));
    await act(async () => lidas.mensagens!.carregarMaisAntigas());
    await waitFor(() => expect(lidas.mensagens?.dados).toHaveLength(120));
    expect(lidas.mensagens!.dados!.map((m) => m.id)).toEqual(todas.map((m) => m.id));
    expect(lidas.mensagens!.temMaisAntigas).toBe(false);
    expect(consultasDe(f, "mensagens").map((c) => c.passos.at(-1))).toEqual([
      ["range", 0, 49],
      ["range", 50, 99],
      ["range", 100, 149],
    ]);
  });

  it("mensagens: a citação e a duração saem nas duas formas (colunas e extras do exemplo)", async () => {
    const { lidas } = montarBanco({
      consulta: (c) =>
        c.tabela === "mensagens"
          ? { data: [msg(2, { responde_a_id: "msg-0001", tipo: "audio", midia_duracao_s: 14 }), msg(1)], error: null }
          : undefined,
    });
    await waitFor(() => expect(lidas.mensagens?.dados).toHaveLength(2));
    const [antiga, nova] = lidas.mensagens!.dados!;
    expect(antiga).toMatchObject({ id: "msg-0001", responde_a_id: null, citaId: null });
    expect(nova).toMatchObject({ responde_a_id: "msg-0001", citaId: "msg-0001", midia_duracao_s: 14, duracaoS: 14 });
    expect(lidas.mensagens!.temMaisAntigas).toBe(false);
  });

  it("juntarPaginas tira a mensagem repetida entre páginas (a que chegou empurrou uma linha)", () => {
    const juntas = juntarPaginas([[msg(3), msg(2)], [msg(2), msg(1)]]);
    expect(juntas.map((m) => m.id)).toEqual(["msg-0001", "msg-0002", "msg-0003"]);
  });

  it("eventos e histórico: colunas listadas, na ordem em que aconteceram, de 1.000 em 1.000; o histórico traz rodada_id", async () => {
    const evento = { id: "ev-1", conversa_id: CV, tipo: "passou", membro_id: null, de: null, de_membro_id: null, motivo: "janete_passou", por_envio: false, criado_em: "x" };
    const historico = { id: "h-1", contato_id: CT, de_etapa_id: null, para_etapa_id: "et-1", ator: "janete", membro_id: null, criado_em: "x", rodada_id: "rd-1" };
    const { f, lidas } = montarBanco({
      consulta: (c) => {
        if (c.tabela === "conversa_eventos") return { data: [evento], error: null };
        if (c.tabela === "contato_etapa_historico") return { data: [historico], error: null };
        return undefined;
      },
    });
    await waitFor(() => expect(lidas.eventos?.dados).toEqual([evento]));
    await waitFor(() => expect(lidas.historico?.dados).toEqual([historico]));
    const ev = consultasDe(f, "conversa_eventos")[0]!;
    expect(ev.valor).toBe(COLUNAS_EVENTO);
    expect(ev.passos).toEqual([
      ["eq", "conversa_id", CV],
      ["order", "criado_em", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["range", 0, 999],
    ]);
    const h = consultasDe(f, "contato_etapa_historico")[0]!;
    expect(h.valor).toBe(COLUNAS_HISTORICO);
    expect(String(h.valor).split(", ")).toContain("rodada_id");
    expect(h.passos[0]).toEqual(["eq", "contato_id", CT]);
  });

  it("custo (admin): custo_das_conversas com os ids sem repetir, de 200 em 200", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `cv-${String(i).padStart(3, "0")}`);
    const { f, lidas } = montarBanco({
      ids: { conversa: null, contato: null, custos: [...ids, ids[0]!] },
      rpc: (nome, args) =>
        nome === "custo_das_conversas"
          ? { data: (args["p_conversas"] as string[]).map((id, i) => ({ conversa_id: id, custo_usd: i === 0 ? 0.25 : 0 })), error: null }
          : undefined,
    });
    await waitFor(() => expect(Object.keys(lidas.custos?.dados ?? {})).toHaveLength(250));
    const chamadas = f.rpcs.filter((r) => r.nome === "custo_das_conversas");
    expect(chamadas.map((c) => (c.args["p_conversas"] as string[]).length)).toEqual([200, 50]);
    expect(lidas.custos!.dados!["cv-000"]).toBe(0.25);
    expect(lidas.custos!.dados!["cv-200"]).toBe(0.25);
    expect(lidas.custos!.dados!["cv-001"]).toBe(0);
  });

  it("custo (atendente): não chama custo_das_conversas e recebe {}", async () => {
    const { f, lidas } = montarBanco({ papel: "atendente", ids: { conversa: null, contato: null, custos: [CV] } });
    await waitFor(() => expect(lidas.custos).toMatchObject({ dados: {}, carregando: false, erro: null }));
    expect(f.rpcs.some((r) => r.nome === "custo_das_conversas")).toBe(false);
  });

  it("o erro da leitura vem traduzido, com Tentar de novo", async () => {
    let falhar = true;
    const { lidas } = montarBanco({
      consulta: (c) =>
        c.tabela === "conversas" && c.unica
          ? falhar
            ? { data: null, error: { code: "42501", message: "permission denied" } }
            : { data: { id: CV }, error: null }
          : undefined,
    });
    await waitFor(() => expect(lidas.conversa?.erro).toBe("sem_acesso"));
    falhar = false;
    await act(async () => lidas.conversa!.tentarDeNovo());
    await waitFor(() => expect(lidas.conversa).toMatchObject({ dados: { id: CV }, erro: null }));
  });

  it("as chaves ficam embaixo das raízes de CHAVES: o tempo real e as ações invalidam pela tabela", async () => {
    const { qc } = montarBanco({ ids: { conversa: CV, contato: CT, custos: [CV] } });
    await waitFor(() => expect(qc.getQueryCache().getAll().length).toBeGreaterThan(6));
    const raizes = new Set(qc.getQueryCache().getAll().map((q) => q.queryKey[0] as string));
    for (const r of ["conversas", "mensagens", "eventos", "historico", "contatos", "custos"]) expect(raizes).toContain(r);
    // quem muda cada tabela deixa velha a leitura certa
    expect(POR_TABELA.mensagens).toContain("mensagens");
    expect(POR_TABELA.conversa_eventos).toContain("eventos");
    expect(POR_TABELA.contato_etapa_historico).toContain("historico");
    expect(POR_TABELA.rodadas).toEqual(expect.arrayContaining(["custos", "historico"]));
    expect(POR_TABELA.ia_chamadas).toContain("custos");
    expect(INVALIDA.enviarMensagem).toEqual(expect.arrayContaining(["mensagens", "conversas", "eventos"]));
    expect(INVALIDA.assumir).toEqual(expect.arrayContaining(["conversas", "eventos"]));
  });
});

/* =============================================================================
   modo exemplo
   ============================================================================= */

function estadoPequeno(): EstadoBase {
  const base = criarEstadoInicial(new Date("2026-11-02T17:45:00.000Z"));
  const conversa = base.conversas[0]!;
  const outra = base.conversas[1]!;
  const m = (id: string, momento: string, extra: Partial<Mensagem> = {}): Mensagem => ({
    ...msg(0),
    id,
    conversa_id: conversa.id,
    momento,
    criado_em: momento,
    ...extra,
  });
  return {
    ...base,
    mensagens: [
      m("m-b", "2026-11-02T12:00:02.000Z", { citaId: "m-a" }),
      m("m-a", "2026-11-02T12:00:01.000Z"),
      m("m-c", "2026-11-02T12:00:02.000Z", { tipo: "audio", duracaoS: 9 }),
      { ...m("m-x", "2026-11-02T12:00:00.000Z"), conversa_id: outra.id },
    ],
    eventos: [
      { id: "e-2", conversa_id: conversa.id, tipo: "assumiu", membro_id: "mb-voce", motivo: null, de: "janete", de_membro_id: null, por_envio: true, criado_em: "2026-11-02T12:05:00.000Z" },
      { id: "e-1", conversa_id: conversa.id, tipo: "passou", membro_id: null, motivo: "janete_passou", de: null, de_membro_id: null, por_envio: false, criado_em: "2026-11-02T12:01:00.000Z" },
      { id: "e-3", conversa_id: outra.id, tipo: "celular", membro_id: null, motivo: null, de: "janete", de_membro_id: null, por_envio: false, criado_em: "2026-11-02T12:00:00.000Z" },
    ],
    historico: [
      { id: "h-2", contato_id: conversa.contato_id, de_etapa_id: "et-novo", para_etapa_id: "et-qualificado", ator: "janete", membro_id: null, criado_em: "2026-11-02T12:10:00.000Z" },
      { id: "h-1", contato_id: conversa.contato_id, de_etapa_id: null, para_etapa_id: "et-novo", ator: "sistema", membro_id: null, criado_em: "2026-11-01T12:00:00.000Z" },
    ],
    custos: [
      { id: 1, conversa_id: conversa.id, criado_em: "x", custo_usd: 0.1, tipo: "resposta", provedor: "anthropic", modelo: "m" },
      { id: 2, conversa_id: conversa.id, criado_em: "x", custo_usd: 0.05, tipo: "transcricao", provedor: "openai", modelo: "m" },
      { id: 3, conversa_id: conversa.id, criado_em: "x", custo_usd: null, tipo: "resposta", provedor: "anthropic", modelo: "m" },
    ],
  };
}

function montarExemplo(estado: EstadoBase, ids: Ids, papel: "admin" | "atendente" = "admin") {
  const lidas: Lidas = {};
  function Leitor() {
    lidas.conversa = useConversa(ids.conversa);
    lidas.doContato = useConversaDoContato(ids.contato);
    lidas.mensagens = useMensagens(ids.conversa);
    lidas.eventos = useEventos(ids.conversa);
    lidas.historico = useHistoricoContato(ids.contato);
    lidas.contato = useContato(ids.contato);
    lidas.custos = useCustoConversas(ids.custos ?? []);
    return null;
  }
  const arvore = (
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={estado}>
        <Leitor />
      </ProvedorDados>
    </ProvedorPapel>
  );
  render(arvore);
  return lidas;
}

describe("leituras de conversa no modo exemplo", () => {
  it("as mesmas leituras saem do estado, prontas, sem QueryClient", () => {
    const estado = estadoPequeno();
    const conversa = estado.conversas[0]!;
    const lidas = montarExemplo(estado, { conversa: conversa.id, contato: conversa.contato_id, custos: [conversa.id, "cv-nao-existe"] });

    expect(lidas.conversa).toMatchObject({ dados: conversa, carregando: false, erro: null });
    expect(lidas.doContato?.dados).toEqual(conversa);
    expect(lidas.contato?.dados).toEqual(estado.contatos.find((c) => c.id === conversa.contato_id));

    // na ordem da conversa (momento, depois a ordem em que o exemplo guardou), só desta conversa
    expect(lidas.mensagens!.dados!.map((m) => m.id)).toEqual(["m-a", "m-b", "m-c"]);
    expect(lidas.mensagens).toMatchObject({ carregando: false, temMaisAntigas: false, carregandoMaisAntigas: false });
    // a citação e a duração também nas colunas do banco
    expect(lidas.mensagens!.dados![1]).toMatchObject({ citaId: "m-a", responde_a_id: "m-a" });
    expect(lidas.mensagens!.dados![2]).toMatchObject({ duracaoS: 9, midia_duracao_s: 9 });

    expect(lidas.eventos!.dados!.map((e) => (e as { id: string }).id)).toEqual(["e-1", "e-2"]);
    expect(lidas.historico!.dados!.map((h) => (h as { id: string }).id)).toEqual(["h-1", "h-2"]);
    expect(lidas.historico!.dados!.every((h) => (h as { rodada_id: unknown }).rodada_id === null)).toBe(true);

    // admin: uma linha por conversa que existe, somando o custo (o nulo não soma)
    expect(Object.keys(lidas.custos!.dados!)).toEqual([conversa.id]);
    expect(lidas.custos!.dados![conversa.id]).toBeCloseTo(0.15, 10);
  });

  it("o atendente não recebe custo", () => {
    const estado = estadoPequeno();
    const conversa = estado.conversas[0]!;
    const lidas = montarExemplo(estado, { conversa: conversa.id, custos: [conversa.id] }, "atendente");
    expect(lidas.custos).toMatchObject({ dados: {}, carregando: false });
  });

  it("id que não existe ou nulo: nulo e listas vazias", () => {
    const lidas = montarExemplo(estadoPequeno(), { conversa: "cv-nada", contato: null, custos: [] });
    expect(lidas.conversa?.dados).toBeNull();
    expect(lidas.doContato?.dados).toBeNull();
    expect(lidas.contato?.dados).toBeNull();
    expect(lidas.mensagens?.dados).toEqual([]);
    expect(lidas.eventos?.dados).toEqual([]);
    expect(lidas.historico?.dados).toEqual([]);
    expect(lidas.custos?.dados).toEqual({});
  });

  it("acompanham o estado: a mensagem enviada pela tela aparece na leitura", async () => {
    const estado = estadoPequeno();
    const conversa = estado.conversas[0]!;
    let enviar: ((texto: string) => Promise<unknown>) | undefined;
    function Envia() {
      const { acoes } = useDados();
      enviar = (texto) => acoes.enviarMensagem(conversa.id, { tipo: "texto", texto });
      return null;
    }
    const lidas2: Lidas = {};
    function Leitor() {
      lidas2.mensagens = useMensagens(conversa.id);
      return null;
    }
    render(
      <ProvedorPapel inicial="admin">
        <ProvedorDados exemplo={estado} progredirEnvios={false} relogio={() => new Date("2026-11-02T13:00:00.000Z")}>
          <Envia />
          <Leitor />
        </ProvedorDados>
      </ProvedorPapel>,
    );
    expect(lidas2.mensagens?.dados).toHaveLength(3);
    await act(async () => {
      await enviar!("oi da tela");
    });
    expect(lidas2.mensagens!.dados).toHaveLength(4);
    expect(lidas2.mensagens!.dados!.at(-1)).toMatchObject({ texto: "oi da tela", origem: "humano_tela" });
  });
});
