import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHAVES, raizesDaTabela } from "@/features/plataforma/dados/chaves";
import {
  ATRASO_BUSCA_MS,
  MAX_RESULTADOS_BUSCA,
  buscaDoExemplo,
  etapasNoInstante,
  inicioDoRecorte,
  motivoDaRodada,
  janeteAtivaNoQuadro,
  opcoesBuscaQuadro,
  opcoesHistoricoDesde,
  opcoesJaneteTrabalhando,
  opcoesPassagensDesde,
  opcoesQuadro,
  opcoesRespostasDesde,
  quadroDoExemplo,
  type LinhaQuadro,
} from "@/features/plataforma/dados/kanban";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";
import type { ContatoDados, ConversaDados, HistoricoContato, MensagemDados } from "@/features/plataforma/dados/tipos";
import { IDS, criarEstadoInicial, idContato, type Etapa } from "@/features/plataforma/exemplo";
import { ERRO_ETAPA } from "@/features/plataforma/kanban/Faixa";
import { ERRO_MOVER, TelaKanban } from "@/features/plataforma/kanban/TelaKanban";
import { ProvedorPapel } from "@/features/plataforma/papel";

// O Kanban ligado ao banco (spec de ligar as telas, task C2): as leituras de dados/kanban.ts sobre um
// cliente do Firebase falso (nada vai à rede nem ao banco), e a tela no modo banco do ProvedorDados.

vi.mock("@/features/plataforma/kanban/GavetaLead", () => ({
  GavetaLead: ({ contatoId }: { contatoId: string | null }) => (contatoId ? <div data-testid="gaveta" data-contato={contatoId} /> : null),
}));

// Quinta-feira, 30/10/2026, 14:45 em São Paulo.
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const UID = "u-1";

const ETAPAS: Etapa[] = [
  { id: "e-novo", chave: "novo", nome: "Novo", ordem: 10, tipo: "aberta", cor: null, janete_pode_mover: false, arquivada: false },
  { id: "e-qual", chave: "qualificado", nome: "Qualificado", ordem: 20, tipo: "aberta", cor: null, janete_pode_mover: true, arquivada: false },
  { id: "e-ganho", chave: "ganho", nome: "Ganho", ordem: 50, tipo: "ganho", cor: null, janete_pode_mover: false, arquivada: false },
  { id: "e-perdido", chave: "perdido", nome: "Perdido", ordem: 60, tipo: "perdido", cor: null, janete_pode_mover: true, arquivada: false },
];

const EU = { id: "m-1", nome: "Operador Teste", email: "operador@example.test", papel: "admin" as const, ativo: true, user_id: UID, criado_em: "2026-10-01T12:00:00.000Z", vistos: {} };

function contato(id: string, nome: string, etapa: string, extra: Partial<ContatoDados> = {}): ContatoDados {
  return {
    id,
    nome,
    nome_whatsapp: null,
    telefone: "5511900000001",
    email: null,
    empresa: null,
    etapa_id: etapa,
    etapa_desde: "2026-10-29T12:00:00.000Z",
    observacoes: null,
    resumo_janete: null,
    primeira_mensagem_em: "2026-10-29T12:00:00.000Z",
    criado_em: "2026-10-29T12:00:00.000Z",
    atualizado_em: "2026-10-29T12:00:00.000Z",
    resumo_janete_em: null,
    anotacoes_janete: null,
    ...extra,
  };
}

function conversa(id: string, contatoId: string, extra: Partial<ConversaDados> = {}): ConversaDados {
  return {
    id,
    contato_id: contatoId,
    conexao_id: null,
    modo: "janete",
    motivo_humano: null,
    responsavel_id: null,
    aguardando_humano_desde: null,
    devolvida_em: null,
    nao_lidas: 0,
    ultima_do_lead_em: "2026-10-30T12:00:00.000Z",
    ultima_mensagem_em: "2026-10-30T12:00:00.000Z",
    ultima_mensagem_preview: "Oi",
    criado_em: "2026-10-29T12:00:00.000Z",
    atualizado_em: "2026-10-30T12:00:00.000Z",
    ultima_mensagem_id: null,
    ultima_da_janete_em: null,
    ...extra,
  };
}

function mensagem(id: string, conversaId: string, extra: Partial<MensagemDados> = {}): MensagemDados {
  return {
    id,
    conversa_id: conversaId,
    conexao_id: null,
    direcao: "entrada",
    origem: "lead",
    tipo: "texto",
    status: "recebida",
    texto: "Oi, quero saber o preço",
    transcricao: null,
    momento: "2026-10-30T12:00:00.000Z",
    autor_membro_id: null,
    midia_nome: null,
    midia_mime: null,
    midia_tamanho: null,
    midia_caminho: null,
    midia_status: null,
    editada: false,
    apagada_em: null,
    erro: null,
    criado_em: "2026-10-30T12:00:00.000Z",
    responde_a_id: null,
    midia_duracao_s: null,
    ...extra,
  } as MensagemDados;
}

/** As linhas do quadro como o PostgREST devolve: a conversa com o contato e a última mensagem embutidos. */
const BRUTAS = [
  { ...conversa("c-ana", "k-ana"), contatos: contato("k-ana", "Ana Prado", "e-novo"), ultima: mensagem("m-1", "c-ana") },
  { ...conversa("c-bia", "k-bia"), contatos: contato("k-bia", "Bia Lopes", "e-qual"), ultima: null },
  {
    ...conversa("c-caio", "k-caio"),
    contatos: contato("k-caio", "Caio Reis", "e-ganho", { etapa_desde: "2026-10-28T12:00:00.000Z" }),
    ultima: null,
  },
];

type Opcoes = {
  consulta?: (c: Consulta) => Resposta | undefined;
  rpc?: (nome: string, args: Record<string, unknown>) => Resposta | Promise<Resposta> | undefined;
};

/** O cliente falso da camada, com o `gte` (o recorte de 30 dias e o "desde") gravado nos passos. */
function falso(opcoes: Opcoes = {}) {
  const f = criarClienteFalso({ uid: UID, consulta: (c) => opcoes.consulta?.(c) ?? padrao(c), rpc: (n, a) => opcoes.rpc?.(n, a) });
  const cliente = f.cliente as unknown as { from: (t: string) => Record<string, unknown> };
  const from = cliente.from;
  cliente.from = (t: string) => {
    const q = from(t);
    const c = f.consultas.at(-1)!;
    q["gte"] = (...args: unknown[]) => {
      c.passos.push(["gte", ...args]);
      return q;
    };
    return q;
  };
  return f;
}

const passo = (c: Consulta, nome: string, coluna?: string) => c.passos.find((p) => p[0] === nome && (coluna === undefined || p[1] === coluna));

/** As respostas de sempre: as etapas, o membro, o quadro, as contagens e o "desde" vazio. */
function padrao(c: Consulta): Resposta | undefined {
  if (c.tabela === "etapas") return { data: ETAPAS, error: null };
  if (c.tabela === "membros") return c.unica ? { data: EU, error: null } : { data: [EU], error: null };
  if (c.tabela === "conversas" && c.op === "select") {
    if (c.valor === "id, contatos!inner(etapa_id)") return { data: null, error: null, count: 9 };
    const ids = (passo(c, "in", "contatos.etapa_id")?.[2] as string[] | undefined) ?? [];
    return { data: BRUTAS.filter((b) => ids.includes(b.contatos.etapa_id)), error: null };
  }
  if (c.tabela === "mensagens" && c.valor === "id") return { data: null, error: null, count: 3 };
  if (["rodadas", "contato_etapa_historico", "conversa_eventos"].includes(c.tabela)) return { data: [], error: null };
  return undefined;
}

function montar(opcoes: Opcoes = {}, papel: "admin" | "atendente" = "admin") {
  const f = falso(opcoes);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(CHAVES.eu, { ...EU, papel });
  const r = render(
    <QueryClientProvider client={qc}>
      <ProvedorPapel inicial={papel}>
        <ProvedorDados fonte="banco" cliente={f.cliente}>
          <Suspense fallback={<p>suspenso</p>}>
            <TelaKanban relogio={() => Date.now()} />
          </Suspense>
        </ProvedorDados>
      </ProvedorPapel>
    </QueryClientProvider>,
  );
  return { ...r, f, qc };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ---------- as leituras (dados/kanban.ts) ---------- */

describe("dados/kanban.ts: o quadro no banco", () => {
  it("lê as conversas com o contato e a última mensagem embutidos; as abertas inteiras e Ganho e Perdido dos últimos 30 dias, com o total", async () => {
    const f = falso();
    const op = opcoesQuadro(f.cliente, ETAPAS, AGORA.getTime());
    const dados = await op.queryFn!({} as never);
    const quadros = f.consultas.filter((c) => c.tabela === "conversas" && c.valor !== "id, contatos!inner(etapa_id)");
    expect(quadros).toHaveLength(2);
    for (const q of quadros) {
      // colunas listadas, nunca '*'; o contato por inner join e a última pela fk da conversa
      expect(q.valor).toMatch(/contatos!inner\(id, nome,/);
      expect(q.valor).toMatch(/ultima:mensagens!conversas_ultima_mensagem_id_fkey\(id, conversa_id,/);
      expect(q.valor).not.toContain("*");
      // o PostgREST corta em 1.000: lê em páginas, com ordem de desempate
      expect(passo(q, "range")).toEqual(["range", 0, 999]);
      expect(passo(q, "order", "id")).toBeTruthy();
    }
    const [abertas, fins] = quadros;
    expect(passo(abertas!, "in", "contatos.etapa_id")?.[2]).toEqual(["e-novo", "e-qual"]);
    expect(passo(abertas!, "gte")).toBeUndefined();
    expect(passo(fins!, "in", "contatos.etapa_id")?.[2]).toEqual(["e-ganho", "e-perdido"]);
    expect(passo(fins!, "gte", "contatos.etapa_desde")?.[2]).toBe("2026-09-30T00:00:00-03:00");
    // o total de Ganho e Perdido: uma contagem por etapa, sem trazer linhas
    const contagens = f.consultas.filter((c) => c.valor === "id, contatos!inner(etapa_id)");
    expect(contagens.map((c) => passo(c, "eq", "contatos.etapa_id")?.[2])).toEqual(["e-ganho", "e-perdido"]);
    expect(dados.totaisFim).toEqual({ "e-ganho": 9, "e-perdido": 9 });
    expect(dados.linhas.map((l) => l.contato.id)).toEqual(["k-ana", "k-bia", "k-caio"]);
    expect(dados.linhas[0]!.ultima?.id).toBe("m-1");
    // a citação e a duração nas duas formas, como em dados/conversa.ts
    expect(dados.linhas[0]!.ultima).toMatchObject({ responde_a_id: null, citaId: null });
  });

  it("acima de 1.000 conversas: lê as páginas pelo id (que não muda), tira a repetida e ordena pela mensagem mais recente", async () => {
    // 1.001 conversas abertas; a 2ª página repete a última da 1ª (o que acontecia quando a ordem andava no meio da leitura)
    const todas = Array.from({ length: 1001 }, (_, i) => {
      const n = String(i).padStart(4, "0");
      return {
        ...conversa(`c-${n}`, `k-${n}`, { ultima_mensagem_em: new Date(Date.parse("2026-10-30T12:00:00.000Z") - i * 60_000).toISOString() }),
        contatos: contato(`k-${n}`, `Lead ${n}`, "e-novo"),
        ultima: null,
      };
    });
    // a mais recente fica no fim da ordem por id
    todas[1000]!.ultima_mensagem_em = "2026-10-30T13:00:00.000Z";
    const f = falso({
      consulta: (c) => {
        if (c.tabela !== "conversas" || c.valor === "id, contatos!inner(etapa_id)") return undefined;
        const ids = (passo(c, "in", "contatos.etapa_id")?.[2] as string[] | undefined) ?? [];
        if (!ids.includes("e-novo")) return { data: [], error: null };
        const [, de] = passo(c, "range") as [string, number, number];
        return { data: de === 0 ? todas.slice(0, 1000) : [todas[999]!, todas[1000]!], error: null };
      },
    });
    const dados = await opcoesQuadro(f.cliente, ETAPAS, AGORA.getTime()).queryFn!({} as never);
    const abertas = f.consultas.filter((c) => c.tabela === "conversas" && passo(c, "range"));
    for (const q of abertas) {
      expect(q.passos.filter((p) => p[0] === "order").map((p) => p[1])).toEqual(["id"]);
    }
    const ids = dados.linhas.map((l) => l.conversa.id);
    expect(ids).toHaveLength(1001);
    expect(new Set(ids).size).toBe(1001);
    expect(ids[0]).toBe("c-1000");
    expect(ids[1]).toBe("c-0000");
    expect(ids.at(-1)).toBe("c-0999");
  });

  it("as chaves ficam embaixo das raízes que o tempo real e as ações invalidam", () => {
    const f = falso();
    expect(opcoesQuadro(f.cliente, ETAPAS, AGORA.getTime()).queryKey[0]).toBe("quadro");
    for (const tabela of ["conversas", "mensagens", "contatos", "etapas"]) expect(raizesDaTabela(tabela)).toContain("quadro");
    // as rodadas rodando e o motivo da Janete vêm de `rodadas`, que deixa velho o histórico
    expect(opcoesJaneteTrabalhando(f.cliente).queryKey[0]).toBe("historico");
    expect(raizesDaTabela("rodadas")).toContain("historico");
    expect(opcoesHistoricoDesde(f.cliente, "x", ETAPAS).queryKey[0]).toBe("historico");
    expect(raizesDaTabela("contato_etapa_historico")).toContain("historico");
    expect(opcoesPassagensDesde(f.cliente, "x").queryKey[0]).toBe("eventos");
    expect(raizesDaTabela("conversa_eventos")).toContain("eventos");
    expect(opcoesRespostasDesde(f.cliente, "x").queryKey[0]).toBe("mensagens");
    expect(opcoesBuscaQuadro(f.cliente, "ana").queryKey[0]).toBe("quadro");
  });

  it("o recorte de 30 dias começa às 00:00 de São Paulo, também na virada do dia (23:59 e 00:00, -03:00)", () => {
    // 30/10 às 23:59 em São Paulo (31/10 02:59 em UTC): ainda é o dia 30
    expect(inicioDoRecorte(Date.parse("2026-10-31T02:59:00.000Z"))).toBe("2026-09-30T00:00:00-03:00");
    // 31/10 às 00:00 em São Paulo
    expect(inicioDoRecorte(Date.parse("2026-10-31T03:00:00.000Z"))).toBe("2026-10-01T00:00:00-03:00");
  });

  it("o motivo da Janete sai da entrada do mover_etapa que deu certo (rodadas.ferramentas, decisão 13)", () => {
    const ferramentas = [
      { passo: 1, ferramenta: "responder", entrada: { mensagens: ["Oi"] }, resultado: { ok: true } },
      { passo: 2, ferramenta: "mover_etapa", entrada: { etapa: "perdido", motivo: "Errou" }, resultado: { erro: "etapa_travada" } },
      { passo: 3, ferramenta: "mover_etapa", entrada: { etapa: "qualificado", motivo: "  Conta alta e imóvel próprio.  " }, resultado: { ok: true } },
    ];
    expect(motivoDaRodada(ferramentas, "qualificado")).toBe("Conta alta e imóvel próprio.");
    // sem a etapa de destino, vale o último que deu certo; o recusado nunca vale
    expect(motivoDaRodada(ferramentas, null)).toBe("Conta alta e imóvel próprio.");
    expect(motivoDaRodada([ferramentas[1]!], "perdido")).toBeNull();
    expect(motivoDaRodada(null, "x")).toBeNull();
    expect(motivoDaRodada({ nao: "lista" }, "x")).toBeNull();
  });

  it("o motivo é lido pela rodada_id do histórico, em lotes, só para os movimentos da Janete", async () => {
    const hist: HistoricoContato[] = [
      { id: "h-1", contato_id: "k-bia", de_etapa_id: "e-novo", para_etapa_id: "e-qual", ator: "janete", membro_id: null, criado_em: "2026-10-30T15:00:00.000Z", rodada_id: "r-1" },
      { id: "h-2", contato_id: "k-ana", de_etapa_id: "e-qual", para_etapa_id: "e-novo", ator: "membro", membro_id: "m-1", criado_em: "2026-10-30T15:10:00.000Z", rodada_id: null },
    ];
    const f = falso({
      consulta: (c) => {
        if (c.tabela === "contato_etapa_historico") return { data: hist, error: null };
        if (c.tabela === "rodadas")
          return {
            data: [{ id: "r-1", ferramentas: [{ ferramenta: "mover_etapa", entrada: { etapa: "qualificado", motivo: "Topou a visita." }, resultado: { ok: true } }] }],
            error: null,
          };
        return undefined;
      },
    });
    const r = await opcoesHistoricoDesde(f.cliente, "2026-10-30T11:12:00.000Z", ETAPAS).queryFn!({} as never);
    expect(r.motivos).toEqual({ "h-1": "Topou a visita." });
    const leituraRodadas = f.consultas.find((c) => c.tabela === "rodadas")!;
    expect(passo(leituraRodadas, "in", "id")?.[2]).toEqual(["r-1"]);
    expect(passo(f.consultas.find((c) => c.tabela === "contato_etapa_historico")!, "gte", "criado_em")?.[2]).toBe("2026-10-30T11:12:00.000Z");
  });

  it("respostas da Janete desde a saída: só conta (head) as que saíram", async () => {
    const f = falso();
    expect(await opcoesRespostasDesde(f.cliente, "2026-10-30T11:12:00.000Z").queryFn!({} as never)).toBe(3);
    const c = f.consultas.find((x) => x.tabela === "mensagens")!;
    expect(passo(c, "eq", "origem")?.[2]).toBe("janete");
    expect(passo(c, "in", "status")?.[2]).toEqual(["enviada", "entregue", "lida"]);
  });

  it("a busca do servidor (buscar_quadro) e a do exemplo seguem a mesma regra: sem acento e até 50", async () => {
    const f = falso({ rpc: (nome) => (nome === "buscar_quadro" ? { data: Array.from({ length: 60 }, (_, i) => `k-${i}`), error: null } : undefined) });
    expect(await opcoesBuscaQuadro(f.cliente, "joão").queryFn!({} as never)).toHaveLength(MAX_RESULTADOS_BUSCA);
    expect(f.rpcs).toEqual([{ nome: "buscar_quadro", args: { p_q: "joão" } }]);
    const e = criarEstadoInicial(AGORA);
    expect(buscaDoExemplo(e, "HORTIFRUTI")).toEqual([idContato("renata")]);
    expect(buscaDoExemplo(e, "")).toEqual([]);
  });

  it("'a Janete ativa agora' usa as colunas do banco (ultima_da_janete_em, ultima_do_lead_em) e as rodadas rodando", () => {
    const agora = AGORA.getTime();
    const l = (extra: Partial<ConversaDados>, etapa = "e-novo"): LinhaQuadro => ({
      contato: contato("k", "K", etapa),
      conversa: conversa("c", "k", { ultima_do_lead_em: "2026-10-30T10:00:00.000Z", ultima_mensagem_em: "2026-10-30T10:00:00.000Z", ...extra }),
      ultima: null,
    });
    expect(janeteAtivaNoQuadro(l({}), ETAPAS, [], agora)).toBe(false);
    expect(janeteAtivaNoQuadro(l({ ultima_da_janete_em: "2026-10-30T17:42:00.000Z" }), ETAPAS, [], agora)).toBe(true);
    expect(janeteAtivaNoQuadro(l({ ultima_do_lead_em: "2026-10-30T17:41:00.000Z" }), ETAPAS, [], agora)).toBe(true);
    expect(janeteAtivaNoQuadro(l({}), ETAPAS, ["c"], agora)).toBe(true);
    // com uma pessoa, ou em Ganho, não é "a Janete ativa"
    expect(janeteAtivaNoQuadro(l({ modo: "humano", ultima_da_janete_em: "2026-10-30T17:42:00.000Z" }), ETAPAS, [], agora)).toBe(false);
    expect(janeteAtivaNoQuadro(l({ ultima_da_janete_em: "2026-10-30T17:42:00.000Z" }, "e-ganho"), ETAPAS, [], agora)).toBe(false);
  });

  it("o 'Rever no quadro' volta cada lead à etapa de onde ele saiu depois do instante; quem entrou depois fica de fora", () => {
    const linhas = [{ contato: contato("k-a", "A", "e-qual") }, { contato: contato("k-b", "B", "e-novo") }, { contato: contato("k-c", "C", "e-novo") }];
    const hist: HistoricoContato[] = [
      { id: "1", contato_id: "k-a", de_etapa_id: "e-novo", para_etapa_id: "e-qual", ator: "janete", membro_id: null, criado_em: "2026-10-30T15:00:00.000Z", rodada_id: null },
      { id: "2", contato_id: "k-c", de_etapa_id: null, para_etapa_id: "e-novo", ator: "sistema", membro_id: null, criado_em: "2026-10-30T16:00:00.000Z", rodada_id: null },
    ];
    const antes = etapasNoInstante(linhas, hist, Date.parse("2026-10-30T14:00:00.000Z"));
    expect(Object.fromEntries(antes)).toEqual({ "k-a": "e-novo", "k-b": "e-novo" });
    const depois = etapasNoInstante(linhas, hist, Date.parse("2026-10-30T17:00:00.000Z"));
    expect(Object.fromEntries(depois)).toEqual({ "k-a": "e-qual", "k-b": "e-novo", "k-c": "e-novo" });
  });

  it("no exemplo, o mesmo recorte: Ganho de 40 dias atrás fica fora dos cards e dentro do total", () => {
    const e = criarEstadoInicial(AGORA);
    const velho = new Date(AGORA.getTime() - 40 * 86_400_000).toISOString();
    const um = e.contatos[0]!;
    const estado = { ...e, contatos: e.contatos.map((c) => (c.id === um.id ? { ...c, etapa_id: IDS.etapa.ganho, etapa_desde: velho } : c)) };
    const q = quadroDoExemplo(estado, AGORA.getTime());
    expect(q.linhas.some((l) => l.contato.id === um.id)).toBe(false);
    const ganhos = estado.contatos.filter((c) => c.etapa_id === IDS.etapa.ganho && estado.conversas.some((cv) => cv.contato_id === c.id)).length;
    expect(q.totaisFim[IDS.etapa.ganho]).toBe(ganhos);
  });
});

/* ---------- a tela no modo banco ---------- */

describe("TelaKanban no modo banco", () => {
  it("carregando: o osso do quadro; depois, as colunas com os cards do banco e o total de Ganho", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { f } = montar();
    // antes de as leituras voltarem
    expect(screen.getByRole("status", { name: "Carregando o quadro" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Novo" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Carregando o quadro" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Novo" })).getByRole("article", { name: /^Ana Prado/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Abrir Ganho: 1 lead nos últimos 30 dias, 9 no total/ })).toBeInTheDocument();
    // abrir o Kanban grava o "visto" da pessoa (decisão 13)
    await waitFor(() => expect(f.rpcs).toContainEqual({ nome: "marcar_visto", args: { p_onde: "kanban" } }));
  });

  it("erro: 'Não deu para carregar o quadro' com o texto do erro e o Tentar de novo, que lê de novo", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    let falhar = true;
    montar({
      consulta: (c) =>
        c.tabela === "conversas" && falhar ? { data: null, error: { code: "42501", message: "permission denied" } } : undefined,
    });
    expect(await screen.findByText("Não deu para carregar o quadro")).toBeInTheDocument();
    expect(screen.getByText("Sua conta não tem acesso a isto.")).toBeInTheDocument();
    falhar = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("article", { name: /^Ana Prado/ })).toBeInTheDocument();
  });

  it("a busca vai ao servidor uma vez só, depois do atraso curto, e o quadro mostra só quem voltou", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { f } = montar({ rpc: (nome) => (nome === "buscar_quadro" ? { data: ["k-bia"], error: null } : undefined) });
    await screen.findByRole("article", { name: /^Ana Prado/ });
    const busca = screen.getByRole("searchbox", { name: "Buscar conversa por nome, empresa ou mensagem" });
    fireEvent.change(busca, { target: { value: "b" } });
    fireEvent.change(busca, { target: { value: "bi" } });
    fireEvent.change(busca, { target: { value: "bia" } });
    act(() => vi.advanceTimersByTime(ATRASO_BUSCA_MS + 10));
    await waitFor(() => expect(screen.queryByRole("article", { name: /^Ana Prado/ })).not.toBeInTheDocument());
    expect(screen.getByRole("article", { name: /^Bia Lopes/ })).toBeInTheDocument();
    expect(f.rpcs.filter((r) => r.nome === "buscar_quadro")).toEqual([{ nome: "buscar_quadro", args: { p_q: "bia" } }]);
  });

  it("a busca que falha avisa e oferece Tentar de novo", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    // (a falha de rede é tentada de novo 3 vezes antes de aparecer; a recusa aparece na hora)
    montar({ rpc: (nome) => (nome === "buscar_quadro" ? { data: null, error: { code: "P0001", message: "sem_acesso" } } : undefined) });
    await screen.findByRole("article", { name: /^Ana Prado/ });
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar conversa por nome, empresa ou mensagem" }), { target: { value: "bia" } });
    act(() => vi.advanceTimersByTime(ATRASO_BUSCA_MS + 10));
    expect(await screen.findByText("Não deu para buscar agora")).toBeInTheDocument();
    expect(screen.getByText("Sua conta não tem acesso a isto.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  it("mover: o UPDATE vai com .select('id'); a recusa do banco (etapa arquivada) vira o texto certo", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { f } = montar({
      consulta: (c) =>
        c.tabela === "contatos" && c.op === "update" ? { data: null, error: { code: "P0001", message: "etapa_arquivada" } } : undefined,
    });
    await screen.findByRole("article", { name: /^Ana Prado/ });
    fireEvent.click(screen.getByRole("button", { name: "Mover Ana Prado para outra etapa" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Mover Ana Prado para" })).getByRole("button", { name: "Qualificado" }));
    expect(await screen.findByText("Não deu para mover: essa etapa está arquivada.")).toBeInTheDocument();
    const upd = f.consultas.find((c) => c.tabela === "contatos" && c.op === "update")!;
    expect(upd.valor).toEqual({ etapa_id: "e-qual" });
    expect(upd.comSelect).toBe("id");
  });

  it("mover: o UPDATE que não atinge nenhuma linha (o lead foi apagado) é falha, com o texto certo", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar({ consulta: (c) => (c.tabela === "contatos" && c.op === "update" ? { data: [], error: null } : undefined) });
    await screen.findByRole("article", { name: /^Ana Prado/ });
    fireEvent.click(screen.getByRole("button", { name: "Mover Ana Prado para outra etapa" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Mover Ana Prado para" })).getByRole("button", { name: "Qualificado" }));
    expect(await screen.findByText("Não deu para mover: esse lead não existe mais.")).toBeInTheDocument();
  });

  it("editar etapas: reordenar vai pelo reordenar_etapas só com o grupo das abertas; a recusa por permissão tem o texto de admin", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { f } = montar({
      consulta: (c) => (c.tabela === "etapas" && c.op === "update" ? { data: [], error: null } : undefined),
    });
    await screen.findByRole("article", { name: /^Ana Prado/ });
    fireEvent.click(screen.getByRole("button", { name: "Editar etapas" }));
    const dlg = screen.getByRole("dialog", { name: "Editar etapas" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Descer Novo" }));
    await waitFor(() => expect(f.rpcs).toContainEqual({ nome: "reordenar_etapas", args: { p_ids: ["e-qual", "e-novo"] } }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Descer Ganho" }));
    await waitFor(() => expect(f.rpcs).toContainEqual({ nome: "reordenar_etapas", args: { p_ids: ["e-perdido", "e-ganho"] } }));
    // o UPDATE que a RLS não deixa atingir nenhuma linha: o mesmo texto de "sem permissão" (spec 2.6)
    const linhaNovo = dlg.querySelector('[data-etapa="e-novo"]') as HTMLElement;
    fireEvent.click(within(linhaNovo).getByRole("switch", { name: /A Janete pode mover para cá/ }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("Só o admin edita as etapas.");
  });

  it("'Desde que você saiu' mostra o movimento da Janete com o motivo dela (rodadas.ferramentas)", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar({
      consulta: (c) => {
        if (c.tabela === "contato_etapa_historico")
          return {
            data: [
              { id: "h-1", contato_id: "k-bia", de_etapa_id: "e-novo", para_etapa_id: "e-qual", ator: "janete", membro_id: null, criado_em: "2026-10-30T17:30:00.000Z", rodada_id: "r-1" },
            ],
            error: null,
          };
        if (c.tabela === "rodadas" && passo(c, "in", "id"))
          return { data: [{ id: "r-1", ferramentas: [{ ferramenta: "mover_etapa", entrada: { etapa: "qualificado", motivo: "Topou a visita na sexta." }, resultado: { ok: true } }] }], error: null };
        return undefined;
      },
    });
    const botao = await screen.findByRole("button", { name: "Desde que você saiu: 1 novidade" });
    fireEvent.click(botao);
    const caixa = screen.getByRole("dialog", { name: "O que a Janete fez por você" });
    expect(within(caixa).getByText(/Moveu Bia Lopes para Qualificado/)).toBeInTheDocument();
    expect(within(caixa).getByText("Topou a visita na sexta.")).toBeInTheDocument();
  });

  it("'Desde que você saiu' com a leitura falhando: o erro com Tentar de novo, sem os zeros nem o 'Marcar como visto'", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    let falhar = true;
    const { f } = montar({
      consulta: (c) =>
        c.tabela === "contato_etapa_historico" && falhar ? { data: null, error: { code: "42501", message: "permission denied" } } : undefined,
    });
    await screen.findByRole("region", { name: "Novo" });
    fireEvent.click(screen.getByRole("button", { name: /^Desde que você saiu/ }));
    const caixa = screen.getByRole("dialog", { name: "O que a Janete fez por você" });
    expect(await within(caixa).findByText("Não deu para ver o que a Janete fez")).toBeInTheDocument();
    // nada de "0 respostas" nem de "a Janete ainda não mexeu em nada", que seriam falsos
    expect(within(caixa).queryByText(/A Janete ainda não mexeu em nada/)).toBeNull();
    expect(within(caixa).queryByText(/respostas?/)).toBeNull();
    // sem os dados, marcar como visto perderia o período: o botão some (e o rever também)
    expect(within(caixa).queryByRole("button", { name: "Marcar como visto" })).toBeNull();
    expect(within(caixa).queryByRole("button", { name: "Rever no quadro" })).toBeNull();
    expect(f.rpcs.filter((r) => r.nome === "marcar_visto")).toHaveLength(1);
    // o Tentar de novo lê de novo, e o painel volta com o resumo
    falhar = false;
    fireEvent.click(within(caixa).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(caixa).findByText(/A Janete ainda não mexeu em nada/)).toBeInTheDocument();
    expect(within(caixa).getByRole("button", { name: "Marcar como visto" })).toBeInTheDocument();
  });

  it("'Desde que você saiu' enquanto carrega: o esqueleto, não os zeros", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar({
      consulta: (c) => (c.tabela === "contato_etapa_historico" ? (new Promise<Resposta>(() => {}) as unknown as Resposta) : undefined),
    });
    await screen.findByRole("region", { name: "Novo" });
    fireEvent.click(screen.getByRole("button", { name: /^Desde que você saiu/ }));
    const caixa = screen.getByRole("dialog", { name: "O que a Janete fez por você" });
    expect(within(caixa).getByRole("status", { name: "Carregando o que a Janete fez" })).toBeInTheDocument();
    expect(within(caixa).queryByText(/A Janete ainda não mexeu em nada/)).toBeNull();
    expect(within(caixa).queryByRole("button", { name: "Marcar como visto" })).toBeNull();
  });

  it("com as etapas lidas e nenhuma (o remix sem os dados iniciais): um vazio que explica, sem esqueleto sem fim", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { f } = montar({ consulta: (c) => (c.tabela === "etapas" ? { data: [], error: null } : undefined) });
    expect(await screen.findByText("Nenhuma etapa configurada")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Carregando o quadro" })).toBeNull();
    // o quadro nem vai ao banco: não há etapa para ler
    expect(f.consultas.some((c) => c.tabela === "conversas" && c.valor !== "id, contatos!inner(etapa_id)")).toBe(false);
  });

  it("a releitura do quadro que falha com os cards na tela vira um aviso compacto, e os cards ficam", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    let falhar = false;
    const { qc } = montar({
      consulta: (c) =>
        c.tabela === "conversas" && falhar ? { data: null, error: { code: "42501", message: "permission denied" } } : undefined,
    });
    expect(await screen.findByRole("article", { name: /^Ana Prado/ })).toBeInTheDocument();
    falhar = true;
    await act(async () => {
      await qc.refetchQueries({ queryKey: CHAVES.quadro });
    });
    expect(await screen.findByText("Não deu para atualizar o quadro")).toBeInTheDocument();
    expect(screen.queryByText("Não deu para carregar o quadro")).toBeNull();
    expect(screen.getByRole("article", { name: /^Ana Prado/ })).toBeInTheDocument();
  });

  it("os textos dos erros: cada código do banco tem a sua frase", () => {
    expect(ERRO_MOVER.etapa_arquivada).toBe("Não deu para mover: essa etapa está arquivada.");
    expect(ERRO_MOVER.nao_encontrado).toBe("Não deu para mover: esse lead não existe mais.");
    expect(ERRO_MOVER.sem_acesso).toBe("Não deu para mover: sua conta não tem acesso.");
    expect(ERRO_MOVER.falha).toMatch(/Verifique a internet/);
    expect(ERRO_ETAPA["sem_acesso"]).toBe(ERRO_ETAPA["sem_permissao"]);
    expect(ERRO_ETAPA["nao_encontrado"]).toBe(ERRO_ETAPA["sem_permissao"]);
    expect(ERRO_ETAPA["etapa_com_leads"]).toBe("Mova os leads desta etapa antes de arquivar.");
  });
});

describe("a área lê só pela camada de dados", () => {
  it("nenhum arquivo do Kanban usa o useExemplo nem importa o ProvedorExemplo", () => {
    const pasta = path.resolve(__dirname, "../features/plataforma/kanban");
    const arquivos = readdirSync(pasta).filter((a) => /\.tsx?$/.test(a));
    expect(arquivos.length).toBeGreaterThan(5);
    for (const a of arquivos) {
      const texto = readFileSync(path.join(pasta, a), "utf-8");
      expect(texto, a).not.toMatch(/useExemplo|ProvedorExemplo|simularJanete/);
    }
  });
});
