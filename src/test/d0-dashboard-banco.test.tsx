import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  contextoDoBanco,
  ID_TITULO_DASHBOARD,
  janelasDashboard,
  montarPainelBanco,
  montarPeriodo,
  ProvedorPainel,
  useEstadoPainel,
  usePainelDashboard,
  type EntradaPainelBanco,
  type Periodo,
  type ValorPainelDashboard,
} from "@/features/plataforma/dashboard/dados";
import { LIMITE_MOTOR_MS, lerMotor } from "@/features/plataforma/configuracao/leitura";
import { TelaDashboard } from "@/features/plataforma/dashboard/TelaDashboard";
import { Resultado } from "@/features/plataforma/dashboard/versoes/final/Resultado";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import {
  FormatoInesperado,
  buscarDashboardPeriodo,
  lerAgoraBanco,
  lerCustoBanco,
  lerFunilBanco,
  lerPeriodoBanco,
  lerProblemasBanco,
  opcoesConfiguracaoDashboard,
  opcoesDashboardAgora,
  opcoesDashboardPeriodo,
  type DashboardPeriodoBanco,
} from "@/features/plataforma/dados/dashboard";
import { traduzirErro } from "@/features/plataforma/dados/erros";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";
import type { ConfiguracaoDados, PendenciasMotor, VersaoContextoBanco } from "@/features/plataforma/dados/tipos";
import { criarEstadoInicial, type ChaveIA, type Conexao } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

import { valorDaTelaFalsa } from "./d0-tela-falsa";

// C4 · o Dashboard ligado ao banco (spec de ligar as telas ao banco, task C4): as chamadas às funções
// dashboard_* (dados/dashboard.ts), a montagem do painel com o que elas devolvem (montar.ts) e os 3
// estados da tela no modo banco, com um cliente falso (nada vai ao banco).

const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "u-1", email: "operador@exemplo.test", user_metadata: { nome: "equipe Teste" } } } })),
}));
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getUser } } }));
vi.mock("@/features/plataforma/dashboard/versoes/final/TelaDashboardFinal", async () => ({ TelaDashboardFinal: (await import("./d0-tela-falsa")).TelaFalsa }));

// 14:45 em São Paulo.
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const AGORA_MS = AGORA.getTime();
const MIN = 60_000;
const DIA = 86_400_000;
const antes = (ms: number) => new Date(AGORA_MS - ms).toISOString();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function periodo(id: "hoje" | "7d" | "30d" | "personalizado" = "30d", personalizado?: { inicio: string; fim: string }): Periodo {
  const r = montarPeriodo(id, AGORA, personalizado);
  if (!r.ok) throw new Error("período inválido");
  return r.periodo;
}

/* ---------- o que o banco devolve (o formato da 0008) ---------- */

const periodoJson = (x: Record<string, unknown> = {}) => ({
  conversas: 40,
  leadsNovos: 20,
  recebidas: 300,
  enviadas: 280,
  enviadasPorOrigem: { janete: 250, humano_tela: 20, humano_celular: 10 },
  primeiraRespostaS: 30,
  respostaJaneteS: 12,
  respostaJaneteP90S: 40,
  conversasAutonomas: 30,
  autonomiaPct: 75,
  passados: { janetePassou: 4, falha: 1, porMotivo: { janete_passou: 4, sem_credito: 1 } },
  series: {
    conversas: [{ dia: "2026-10-30", valor: 7 }],
    recebidas: [{ dia: "2026-10-30", valor: 30 }],
    enviadas: [{ dia: "2026-10-30", valor: 28 }],
    respostaJaneteS: [{ dia: "2026-10-30", valor: 11 }],
    custoUsd: [{ dia: "2026-10-30", valor: 0.25 }],
  },
  ...x,
});

const funilJson = (ganhos = 2) => ({
  leadsNovos: 20,
  ganhos,
  cicloMedianoDias: 3.5,
  etapas: [
    {
      etapaId: "e1",
      nome: "Novo",
      ordem: 10,
      tipo: "aberta",
      janetePodeMover: false,
      chegaram: 20,
      avancaram: 12,
      aindaEstao: 3,
      abandonaram: { total: 5, perdido: 3, semResposta: 2 },
      tempoMedianoH: 4.5,
      custoUsd: 0.2,
      mensagens: { recebidas: 50, enviadas: 40 },
      movimentos: { janete: 10, equipe: 2 },
      passadosParaEquipe: 1,
      entradasPorDia: [{ dia: "2026-10-30", valor: 3 }],
    },
    {
      etapaId: "e2",
      nome: "Qualificado",
      ordem: 20,
      tipo: "aberta",
      janetePodeMover: true,
      chegaram: 12,
      avancaram: 2,
      aindaEstao: 6,
      abandonaram: { total: 4, perdido: 4, semResposta: 0 },
      tempoMedianoH: 20,
      custoUsd: 0.4,
      mensagens: { recebidas: 30, enviadas: 25 },
      movimentos: { janete: 1, equipe: 1 },
      passadosParaEquipe: 2,
      entradasPorDia: [],
    },
    {
      etapaId: "e3",
      nome: "Ganho",
      ordem: 30,
      tipo: "ganho",
      janetePodeMover: false,
      chegaram: 2,
      avancaram: 0,
      aindaEstao: 2,
      abandonaram: { total: 0, perdido: 0, semResposta: 0 },
      tempoMedianoH: null,
      custoUsd: 0,
      mensagens: { recebidas: 0, enviadas: 0 },
      movimentos: { janete: 0, equipe: 0 },
      passadosParaEquipe: 0,
      entradasPorDia: [],
    },
  ],
});

const custoJson = (total = 1.5) => ({
  total,
  porTipo: { resposta: 1.0, transcricao: 0.3, onboarding: 0.2 },
  semPreco: 2,
  porModelo: [
    { provedor: "openai", modelo: "gpt-4.1-mini", usd: 1.0 },
    { provedor: "openai", modelo: "gpt-4o-mini-transcribe", usd: 0.5 },
  ],
  conversasComJanete: 10,
  porConversaUsd: 0.1,
  foraDaCoorteUsd: 0.4,
});

const problemasJson = () => [
  { id: "conexao:c1", tipo: "conexao", quando: antes(105 * MIN), fim: null, durMin: 105, motivo: null, quantidade: 1, conversasAfetadas: 0 },
  {
    id: "falha_ia:r1",
    tipo: "falha_ia",
    quando: "2026-10-29T12:00:00+00:00",
    fim: "2026-10-29T12:00:00+00:00",
    durMin: 0,
    motivo: "sem_credito",
    quantidade: 1,
    conversasAfetadas: 1,
  },
];

const agoraJson = (x: Record<string, unknown> = {}) => ({
  aguardando: {
    total: 2,
    maisAntigaDesde: antes(30 * MIN),
    itens: [
      { conversaId: "cv-1", contatoId: "ct-1", nome: "Bia", nomeWhatsapp: null, telefone: null, motivo: "janete_passou", aguardandoDesde: antes(10 * MIN) },
      { conversaId: "cv-2", contatoId: "ct-2", nome: null, nomeWhatsapp: null, telefone: "5511999990000", motivo: "sem_credito", aguardandoDesde: antes(30 * MIN) },
    ],
  },
  naoLidas: { conversas: 3, mensagens: 7 },
  comQuem: { janete: 12, membros: [{ membroId: "mb-1", nome: "Ana", n: 2 }], celular: 1 },
  janeteAtiva: { conversas: 3, digitando: { contatoId: "ct-3", nome: null, nomeWhatsapp: "Zé", telefone: "5511" } },
  kanban: [
    { etapaId: "e1", nome: "Novo", tipo: "aberta", n: 5 },
    { etapaId: "e2", nome: "Qualificado", tipo: "aberta", n: 6 },
    { etapaId: "e3", nome: "Ganho", tipo: "ganho", n: 2 },
    { etapaId: "e4", nome: "Perdido", tipo: "perdido", n: 7 },
  ],
  esfriando: 1,
  porEtapa: [
    {
      etapaId: "e1",
      paradosMais7d: 1,
      leads: [{ contatoId: "ct-1", conversaId: "cv-1", nome: "Bia", nomeWhatsapp: null, telefone: null, etapaDesde: antes(90 * MIN) }],
    },
  ],
  ultimaRecebidaEm: antes(2 * MIN),
  ultimaDaJaneteEm: antes(1 * MIN),
  ...x,
});

function passada(p: Periodo, opcoes: { admin?: boolean; periodo?: Record<string, unknown> } = {}): DashboardPeriodoBanco<Periodo> {
  const admin = opcoes.admin ?? true;
  return {
    contexto: p,
    calculadoEm: AGORA_MS,
    atual: { periodo: lerPeriodoBanco(periodoJson(opcoes.periodo)), funil: lerFunilBanco(funilJson(2)), custo: admin ? lerCustoBanco(custoJson()) : null },
    anterior: {
      periodo: lerPeriodoBanco(periodoJson({ conversas: 32, leadsNovos: 16 })),
      funil: lerFunilBanco(funilJson(1)),
      custo: admin ? lerCustoBanco(custoJson(1.0)) : null,
    },
    problemas: lerProblemasBanco(problemasJson()),
    desdeOntem: 9,
    mesAteHojeUsd: admin ? 3.0 : null,
  };
}

const CONEXAO: Conexao = {
  id: "cx-1",
  nome: "+55 11 90000-0000",
  gateway: "zapi",
  status: "conectada",
  ativa: true,
  oficial: false,
  id_externo: "inst-1",
  ultimo_erro: null,
  criado_em: "2026-10-01T12:00:00.000Z",
  atualizado_em: "2026-10-01T12:00:00.000Z",
};

const chave = (x: Partial<ChaveIA> = {}): ChaveIA => ({
  id: "k-1",
  finalidade: "resposta",
  provedor: "openai",
  modelo: "gpt-4.1-mini",
  status: "ativa",
  ultimos4: "abcd",
  ultimo_erro: null,
  validada_em: "2026-10-01T12:00:00.000Z",
  atualizada_em: "2026-10-01T12:00:00.000Z",
  atualizada_por: null,
  ...x,
});

const configuracao = (workerVistoEm: string | null): ConfiguracaoDados => ({
  id: 1,
  espera_lote_s: 8,
  espera_lote_max_s: 45,
  onboarding_concluido_em: "2026-10-01T12:00:00.000Z",
  atualizado_em: "2026-10-01T12:00:00.000Z",
  worker_visto_em: workerVistoEm,
});

/** Nada pendente no motor (motor_pendencias, spec-motor-acordado). */
const MOTOR_VAZIO: PendenciasMotor = { proximoEm: null, vencidoDesde: null, atrasadoDesde: null };
/** O trabalho da Janete esperando desde `ms` antes do relógio. */
const atrasadoHa = (ms: number): PendenciasMotor => ({
  proximoEm: null,
  vencidoDesde: AGORA_MS - ms,
  atrasadoDesde: AGORA_MS - ms,
});
/** A linha da rpc motor_pendencias com o trabalho esperando desde `ms` antes do relógio. */
const linhaMotor = (desdeMs: number | null) => {
  const desde = desdeMs === null ? null : new Date(desdeMs).toISOString();
  return [{ proximo_em: null, vencido_desde: desde, atrasado_desde: desde }];
};

const CONTEXTO: VersaoContextoBanco = {
  id: 11,
  empresa_oferta: "Cursos de IA",
  cliente_ideal: "Empresários",
  preco: "R$ 997",
  diferenciais: "  ",
  objecoes: "",
  quando_passar_humano: "Quando pedir proposta",
  tom_voz: "Leve",
  horario: "",
  itens: [],
  origem: "edicao",
  criado_por: null,
  criado_em: "2026-10-20T12:00:00.000Z",
  numero: 4,
  restaurada_de: null,
};

function painel(x: Partial<EntradaPainelBanco> & { p?: Periodo } = {}) {
  const p = x.p ?? periodo("30d");
  const papel = x.papel ?? "admin";
  return montarPainelBanco({
    papel,
    nomeConta: "equipe Teste",
    agora: AGORA,
    periodo: x.periodo ?? passada(p, { admin: papel === "admin" }),
    agoraBanco: x.agoraBanco ?? lerAgoraBanco(agoraJson()),
    conexao: x.conexao === undefined ? CONEXAO : x.conexao,
    chaves: x.chaves ?? (papel === "admin" ? [chave()] : []),
    configuracao: "configuracao" in x ? x.configuracao : configuracao(antes(1 * MIN)),
    configuracaoConhecida: x.configuracaoConhecida,
    motor: "motor" in x ? x.motor : MOTOR_VAZIO,
    contexto: x.contexto === undefined ? CONTEXTO : x.contexto,
    carregando: x.carregando ?? false,
  });
}

const item = (p: ReturnType<typeof painel>, id: string) => p.agora.saude.itens.find((i) => i.id === id);

/* ---------- dados/dashboard.ts: as chamadas ---------- */

describe("C4 · as chamadas às funções do Dashboard", () => {
  it("o admin chama o período e o funil do atual e do anterior, o custo (atual, anterior e mês), os problemas e o 'desde ontem'", async () => {
    const f = criarClienteFalso({ rpc: (nome) => ({ data: nome === "dashboard_problemas" ? [] : {}, error: null }) });
    const j = janelasDashboard(periodo("30d"), AGORA_MS);
    const r = await buscarDashboardPeriodo(f.cliente, j, true, "ctx");
    expect(f.rpcs.map((c) => c.nome).sort()).toEqual(
      [
        "dashboard_custo",
        "dashboard_custo",
        "dashboard_custo",
        "dashboard_funil",
        "dashboard_funil",
        "dashboard_periodo",
        "dashboard_periodo",
        "dashboard_periodo",
        "dashboard_problemas",
      ].sort(),
    );
    expect(r.contexto).toBe("ctx");
    expect(r.mesAteHojeUsd).toBe(0);
    // o mês: do dia 1º 00:00 de São Paulo até agora
    expect(f.rpcs.filter((c) => c.nome === "dashboard_custo").map((c) => c.args["p_de"])).toContain("2026-10-01T03:00:00.000Z");
  });

  it("o atendente não pergunta o custo (a função recusaria com sem_acesso)", async () => {
    const f = criarClienteFalso({ rpc: (nome) => ({ data: nome === "dashboard_problemas" ? [] : {}, error: null }) });
    const r = await buscarDashboardPeriodo(f.cliente, janelasDashboard(periodo("30d"), AGORA_MS), false, null);
    expect(f.rpcs.some((c) => c.nome === "dashboard_custo")).toBe(false);
    expect(r.atual.custo).toBeNull();
    expect(r.mesAteHojeUsd).toBeNull();
  });

  it("no 'Hoje', o anterior é ontem até a mesma hora, lido como estava há 1 dia (mesma idade)", async () => {
    const f = criarClienteFalso({ rpc: (nome) => ({ data: nome === "dashboard_problemas" ? [] : {}, error: null }) });
    await buscarDashboardPeriodo(f.cliente, janelasDashboard(periodo("hoje"), AGORA_MS), false, null);
    const funis = f.rpcs.filter((c) => c.nome === "dashboard_funil").map((c) => c.args);
    expect(funis).toContainEqual({ p_de: "2026-10-30T03:00:00.000Z", p_ate: "2026-10-30T17:45:00.001Z", p_estado_em: AGORA.toISOString() });
    expect(funis).toContainEqual({ p_de: "2026-10-29T03:00:00.000Z", p_ate: "2026-10-29T17:45:00.001Z", p_estado_em: "2026-10-29T17:45:00.000Z" });
    // "desde ontem": ontem 00:00 até agora
    expect(f.rpcs.filter((c) => c.nome === "dashboard_periodo").map((c) => c.args["p_de"])).toContain("2026-10-29T03:00:00.000Z");
  });

  it("nos 30 dias, o anterior é a mesma janela 30 dias antes, lido como estava há 30 dias", () => {
    const j = janelasDashboard(periodo("30d"), AGORA_MS);
    expect(j.atual).toEqual({ de: Date.parse("2026-10-01T03:00:00.000Z"), ate: AGORA_MS + 1 });
    expect(j.anterior).toEqual({ de: j.atual.de - 30 * DIA, ate: j.atual.ate - 30 * DIA });
    expect(j.estadoAnterior).toBe(AGORA_MS - 30 * DIA);
  });

  it("um personalizado que não termina hoje não pede o mês (sem previsão)", async () => {
    const j = janelasDashboard(periodo("personalizado", { inicio: "2026-10-01", fim: "2026-10-15" }), AGORA_MS);
    expect(j.mes).toBeNull();
    expect(j.atual).toEqual({ de: Date.parse("2026-10-01T03:00:00.000Z"), ate: Date.parse("2026-10-16T03:00:00.000Z") });
    const f = criarClienteFalso({ rpc: (nome) => ({ data: nome === "dashboard_problemas" ? [] : {}, error: null }) });
    const r = await buscarDashboardPeriodo(f.cliente, j, true, null);
    expect(f.rpcs.filter((c) => c.nome === "dashboard_custo")).toHaveLength(2);
    expect(r.mesAteHojeUsd).toBeNull();
  });

  it("a recusa do banco sobe crua e o traduzirErro dá o texto certo (sem_acesso; o resto, falha)", async () => {
    const f = criarClienteFalso({ rpc: () => ({ data: null, error: { code: "P0001", message: "sem_acesso" } }) });
    const erro = await buscarDashboardPeriodo(f.cliente, janelasDashboard(periodo("7d"), AGORA_MS), true, null).catch((e: unknown) => e);
    expect(traduzirErro(erro).erro).toBe("sem_acesso");
    expect(traduzirErro({ code: "P0001", message: "periodo_invalido" }).erro).toBe("falha");
  });

  it("um JSON fora do formato vira FormatoInesperado (falha, com o detalhe)", () => {
    expect(() => lerPeriodoBanco(null)).toThrow(FormatoInesperado);
    expect(() => lerFunilBanco([])).toThrow(FormatoInesperado);
    expect(() => lerProblemasBanco({})).toThrow(FormatoInesperado);
    expect(() => lerAgoraBanco("x")).toThrow(FormatoInesperado);
    const t = traduzirErro(new FormatoInesperado("dashboard_periodo"));
    expect(t.erro).toBe("falha");
    expect(t.detalhe).toContain("dashboard_periodo");
  });

  it("um problema de tipo desconhecido ou sem data fica de fora; os números aceitam texto numérico", () => {
    expect(lerProblemasBanco([{ id: "x", tipo: "outro", quando: "2026-10-30T10:00:00Z" }, { id: "y", tipo: "envio" }])).toEqual([]);
    expect(lerCustoBanco({ total: "1.25", porTipo: {} }).total).toBe(1.25);
    expect(lerCustoBanco({ total: 1 }).porTipo).toEqual({ resposta: 0, transcricao: 0, onboarding: 0, fala: 0 });
    expect(lerCustoBanco({ total: 1, porTipo: { fala: "0.25" } }).porTipo.fala).toBe(0.25);
  });

  it("o período fica em CHAVES.dashboardPeriodo (fora do tempo real), o 'agora' em CHAVES.dashboard; os dois releem no foco e a cada 60 s", () => {
    const f = criarClienteFalso();
    const op = opcoesDashboardPeriodo(f.cliente, { chave: ["30d", "2026-10-01", "2026-10-30"], admin: true, janelas: () => janelasDashboard(periodo("30d"), AGORA_MS), contexto: null });
    const ag = opcoesDashboardAgora(f.cliente);
    for (const o of [op, ag]) {
      expect(o.refetchInterval).toBe(60_000);
      expect(o.refetchOnWindowFocus).toBe("always");
    }
    expect(op.queryKey).toEqual(["dashboard-periodo", "admin", "30d", "2026-10-01", "2026-10-30"]);
    expect(op.queryKey.slice(0, 1)).toEqual([...CHAVES.dashboardPeriodo]);
    expect(ag.queryKey.slice(0, 1)).toEqual([...CHAVES.dashboard]);
  });

  it("um aviso do tempo real (invalidar CHAVES.dashboard) relê só o 'agora', não a passada do período", async () => {
    const f = criarClienteFalso({ rpc: (nome) => ({ data: nome === "dashboard_problemas" ? [] : nome === "dashboard_agora" ? agoraJson() : {}, error: null }) });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const op = opcoesDashboardPeriodo(f.cliente, { chave: ["30d"], admin: true, janelas: () => janelasDashboard(periodo("30d"), AGORA_MS), contexto: null });
    await qc.fetchQuery(op);
    await qc.fetchQuery(opcoesDashboardAgora(f.cliente));
    expect(qc.getQueryState(op.queryKey)!.isInvalidated).toBe(false);
    await qc.invalidateQueries({ queryKey: CHAVES.dashboard });
    expect(qc.getQueryState(op.queryKey)!.isInvalidated).toBe(false);
    expect(qc.getQueryState(opcoesDashboardAgora(f.cliente).queryKey)!.isInvalidated).toBe(true);
  });

  it("a configuração do Dashboard é a leitura comum (mesma chave), relida a cada 60 s e no foco", () => {
    const f = criarClienteFalso();
    const o = opcoesConfiguracaoDashboard(f.cliente);
    expect(o.queryKey).toEqual([...CHAVES.configuracao, "empresa"]);
    expect(o.refetchInterval).toBe(60_000);
    expect(o.refetchOnWindowFocus).toBe("always");
  });
});

/* ---------- montar.ts: o painel com o que o banco devolve ---------- */

describe("C4 · o painel montado com o que o banco devolve", () => {
  it("as Tendencia juntam o atual e o anterior (o anterior na mesma idade)", () => {
    const p = painel();
    expect(p.resumo.conversas).toMatchObject({ atual: 40, anterior: 32, variacaoPct: 25, sentido: "melhor" });
    expect(p.resumo.leadsNovos).toMatchObject({ atual: 20, anterior: 16 });
    expect(p.resumo.autonomiaPct).toMatchObject({ atual: 75, anterior: 75, variacaoPp: 0 });
    expect(p.resumo.janetePctEnviadas).toBeCloseTo((250 / 280) * 100, 0);
    expect(p.resumo.passados).toEqual({ janetePassou: 4, falha: 1, porMotivo: { janete_passou: 4, sem_credito: 1 } });
  });

  it("as séries têm um ponto por dia do período, com zero nos dias que não vieram", () => {
    const p = painel();
    expect(p.resumo.series.conversas).toHaveLength(30);
    expect(p.resumo.series.conversas[0]).toEqual({ dia: "2026-10-01", valor: 0 });
    expect(p.resumo.series.conversas.at(-1)).toEqual({ dia: "2026-10-30", valor: 7 });
    expect(p.resumo.series.custoUsd!.at(-1)!.valor).toBeCloseTo(0.25, 9);
  });

  it("o funil usa as etapas do banco (nomes, ordem, conversão) e as frases saem dos números", () => {
    const p = painel();
    expect(p.funil.etapas.map((e) => e.nome)).toEqual(["Novo", "Qualificado", "Ganho"]);
    expect(p.funil.etapas[0]).toMatchObject({ chegaram: 20, avancaram: 12, conversaoProxPct: 60, custoUsd: 0.2 });
    expect(p.funil.etapas[2]!.conversaoProxPct).toBeNull();
    expect(p.funil.perdidosPorOrigem.map((x) => x.etapaId)).toEqual(["e1", "e2"]);
    expect(p.funil.perdidos).toBe(7);
    expect(p.funil.taxaGanhoPct).toBe(10);
    expect(p.funil.frase).toBe("Dos 20 leads que chegaram, 2 viraram venda (10%). A maior perda está entre Novo e Qualificado.");
    expect(p.funil.movimentos).toEqual({ janete: 11, equipe: 3 });
    expect(p.textos.resultado).toBe("2 vendas no período, 1 a mais que no anterior.");
  });

  it("o custo (admin): o onboarding numa linha própria e dentro do total (decisão 9d); a previsão do mês", () => {
    const p = painel();
    const c = p.custo!;
    expect(c.total).toMatchObject({ atual: 1.5, anterior: 1.0, variacaoPct: 50, sentido: "pior" });
    expect(c.porTipo.onboarding).toBeCloseTo(0.2, 9);
    expect(c.porTipo.resposta + c.porTipo.transcricao + c.porTipo.onboarding).toBeCloseTo(c.total.atual!, 9);
    expect(c.porModelo.map((m) => m.modelo)).toEqual(["gpt-4.1-mini", "gpt-4o-mini-transcribe"]);
    expect(c.porGanhoUsd).toBeCloseTo(0.75, 9);
    expect(c.porConversaUsd).toBeCloseTo(0.1, 9);
    expect(c.foraDaCoorteUsd).toBeCloseTo(0.4, 9);
    const corridos = (AGORA_MS - Date.parse("2026-10-01T03:00:00.000Z")) / DIA;
    expect(c.previsaoMesUsd).toBeCloseTo((3.0 / corridos) * 31, 6);
  });

  it("o atendente não recebe custo nenhum, nem o cérebro e a escuta na Saúde", () => {
    const p = painel({ papel: "atendente" });
    expect(p.custo).toBeUndefined();
    expect(p.resumo.series.custoUsd).toBeUndefined();
    expect(p.funil.etapas.every((e) => e.custoUsd === undefined)).toBe(true);
    expect(p.agora.saude.itens.map((i) => i.id)).toEqual(["whatsapp", "motor", "contexto", "problemas"]);
  });

  it("decisão 3 do motor: trabalho esperando há mais de 3 min → 'A Janete está atrasada há X'", () => {
    const p = painel({ motor: atrasadoHa(5 * MIN) });
    // o atraso não é parada (decisão do equipe, 03/11): atenção, e a Janete segue ativa
    expect(item(p, "motor")).toMatchObject({
      estado: "atencao",
      detalhe: "A Janete está atrasada há 5 min",
      acao: { para: "/app/configuracao" },
    });
    expect(p.agora.saude).toMatchObject({ geral: "atencao", frase: "A Janete está atrasada" });
    expect(p.estadoJanete).toBe("acordada");
    expect(p.textos.resumo).toBe("A Janete está atrasada há 5 min");
    expect(p.agora.janeteAtiva).toEqual({ conversas: 3, digitando: "Zé" });
    // o X no formato do haQuanto: em horas depois de 1 h
    expect(item(painel({ motor: atrasadoHa(125 * MIN) }), "motor")!.detalhe).toBe(
      "A Janete está atrasada há 2 h",
    );
    // a atendente também vê o aviso, sem o atalho da Configuração
    expect(
      item(painel({ papel: "atendente", motor: atrasadoHa(5 * MIN) }), "motor")!.acao,
    ).toBeUndefined();
  });

  it("o atraso sozinho não para a Janete: a Saúde diz 'atrasada' mesmo com outros pontos de atenção", () => {
    // a atendente vê o mesmo: atenção, a Janete ativa e o 'digitando'
    const at = painel({ papel: "atendente", motor: atrasadoHa(5 * MIN) });
    expect(item(at, "motor")).toMatchObject({
      estado: "atencao",
      detalhe: "A Janete está atrasada há 5 min",
    });
    expect(at.agora.saude).toMatchObject({ geral: "atencao", frase: "A Janete está atrasada" });
    expect(at.estadoJanete).toBe("acordada");
    expect(at.agora.janeteAtiva).toEqual({ conversas: 3, digitando: "Zé" });
    // sem o atraso, a mesma conta tem só os outros pontos de atenção
    expect(painel().agora.saude.frase).not.toMatch(/atrasada/);
    expect(JSON.stringify(painel({ motor: atrasadoHa(5 * MIN) }).agora.saude)).not.toMatch(
      /A Janete parou/,
    );
  });

  it("atraso junto com o WhatsApp caído, a IA sem chave ou o onboarding aberto: continua parada", () => {
    const comWhats = painel({ conexao: null, motor: atrasadoHa(5 * MIN) });
    expect(item(comWhats, "motor")).toMatchObject({
      estado: "parado",
      detalhe: "A Janete está atrasada há 5 min",
    });
    expect(comWhats.agora.saude).toMatchObject({ geral: "parado", frase: "A Janete parou" });
    expect(comWhats.estadoJanete).toBe("dormindo");
    expect(comWhats.agora.janeteAtiva).toEqual({ conversas: 0, digitando: null });

    const semChave = painel({ chaves: [], motor: atrasadoHa(5 * MIN) });
    expect(item(semChave, "motor")!.estado).toBe("parado");
    expect(semChave.agora.saude).toMatchObject({ geral: "parado", frase: "A Janete parou" });
    expect(semChave.estadoJanete).toBe("dormindo");
    expect(semChave.agora.janeteAtiva).toEqual({ conversas: 0, digitando: null });

    const aberto = painel({
      configuracao: { ...configuracao(null), onboarding_concluido_em: null },
      motor: atrasadoHa(5 * MIN),
    });
    expect(item(aberto, "motor")).toMatchObject({
      estado: "parado",
      detalhe: "A Janete começa a responder quando o onboarding terminar",
    });
    expect(aberto.agora.saude).toMatchObject({ geral: "parado", frase: "A Janete parou" });
    expect(aberto.estadoJanete).toBe("dormindo");
    expect(aberto.agora.janeteAtiva).toEqual({ conversas: 0, digitando: null });
  });

  it("a regra dos 3 min é a mesma da Configuração (lerMotor): no limite e 1 ms depois", () => {
    const noLimite = atrasadoHa(LIMITE_MOTOR_MS);
    const depois = atrasadoHa(LIMITE_MOTOR_MS + 1);
    expect(lerMotor(noLimite, AGORA_MS, true, false, antes(1 * MIN)).estado).toBe("ok");
    expect(item(painel({ motor: noLimite }), "motor")!.estado).toBe("ok");
    expect(lerMotor(depois, AGORA_MS, true, false, antes(1 * MIN))).toMatchObject({
      estado: "atrasado",
      minutos: 3,
    });
    expect(item(painel({ motor: depois }), "motor")).toMatchObject({
      estado: "atencao",
      detalhe: "A Janete está atrasada há 3 min",
    });
    // um evento do webhook vencido (vencido sem atrasado) não avisa
    expect(
      item(painel({ motor: { ...MOTOR_VAZIO, vencidoDesde: AGORA_MS - 10 * MIN } }), "motor")!
        .estado,
    ).toBe("ok");
  });

  it("o 'atualizado às' é a hora da passada na tela (calculadoEm), não o relógio", () => {
    const p = periodo("30d");
    const velha = { ...passada(p), calculadoEm: AGORA_MS - 7 * MIN };
    expect(painel({ periodo: velha }).textos.atualizado).toBe("atualizado às 14:38");
    expect(painel().textos.atualizado).toBe("atualizado às 14:45");
  });

  it("falha_ia por áudio sem transcrição: o texto do áudio (não o do provedor de IA) e a Configuração para o admin", () => {
    const p = periodo("30d");
    const comAudio = {
      ...passada(p),
      problemas: lerProblemasBanco([
        { id: "falha_ia:r9", tipo: "falha_ia", quando: antes(60 * MIN), fim: antes(50 * MIN), durMin: 10, motivo: "audio_sem_transcricao", quantidade: 3, conversasAfetadas: 2 },
      ]),
    };
    const pb = painel({ periodo: comAudio }).resumo.problemas[0]!;
    expect(pb).toMatchObject({
      titulo: "3 áudios foram para a equipe sem transcrição",
      causa: "A Janete não conseguiu transcrever os áudios. Confira a Escuta de áudio na Configuração.",
      acao: { rotulo: "Abrir a Configuração", para: "/app/configuracao" },
    });
    expect(`${pb.titulo} ${pb.causa}`).not.toMatch(/provedor de IA/);
    const at = painel({ papel: "atendente", periodo: { ...comAudio, atual: { ...comAudio.atual, custo: null } } }).resumo.problemas[0]!;
    expect(at).toMatchObject({ titulo: "3 áudios foram para a equipe sem transcrição", acao: { para: "/app/chat" } });
    expect(at.causa).not.toMatch(/Configuração|chave/);
    const um = { ...comAudio, problemas: comAudio.problemas.map((x) => ({ ...x, quantidade: 1 })) };
    expect(painel({ periodo: um }).resumo.problemas[0]!.titulo).toBe("1 áudio foi para a equipe sem transcrição");
  });

  it("as causas de envio, mídia e conexão que voltou são neutras (o banco não diz o porquê)", () => {
    const p = periodo("30d");
    const lista = lerProblemasBanco([
      { id: "envio:m1", tipo: "envio", quando: antes(30 * MIN), fim: antes(30 * MIN), durMin: 0, motivo: null, quantidade: 2, conversasAfetadas: 1 },
      { id: "midia:m2", tipo: "midia", quando: antes(40 * MIN), fim: antes(40 * MIN), durMin: 0, motivo: null, quantidade: 1, conversasAfetadas: 1 },
      { id: "conexao:c2", tipo: "conexao", quando: antes(80 * MIN), fim: antes(68 * MIN), durMin: 12, motivo: null, quantidade: 1, conversasAfetadas: 0 },
    ]);
    const pbs = painel({ periodo: { ...passada(p), problemas: lista } }).resumo.problemas;
    expect(pbs.map((x) => [x.titulo, x.causa])).toEqual([
      ["2 mensagens não saíram", "O WhatsApp não aceitou os envios. Abra a conversa para ver o erro."],
      ["1 mídia não foi copiada", "Não deu para baixar o arquivo do provedor. Abra a conversa para ver."],
      ["O WhatsApp ficou desconectado por 12 min", "A conexão voltou às 13:37."],
    ]);
    expect(pbs.map((x) => x.causa).join(" ")).not.toMatch(/instabilidade|expirou|sozinha/);
  });

  it("dia calmo não avisa; a cópia antes da 1ª mensagem 'liga sozinha'; sem a configuração ou o motor, não afirma nada", () => {
    // o worker parado há 10 min, sem nada pendente: dia calmo
    expect(item(painel({ configuracao: configuracao(antes(10 * MIN)) }), "motor")).toMatchObject({
      estado: "ok",
      detalhe: "última resposta há 1 min · fila em dia",
    });
    // aguardando: o motor nunca rodou e nada pendente (não é aviso)
    const nova = painel({ configuracao: configuracao(null) });
    expect(item(nova, "motor")).toMatchObject({
      estado: "ok",
      detalhe: "A Janete liga sozinha quando chegar a primeira mensagem",
    });
    expect(nova.agora.saude.geral).not.toBe("parado");
    expect(nova.textos.resumo).not.toMatch(/atrasada|liga sozinha/);
    // com algo pendente, já não é "aguardando"
    const pendente = { ...MOTOR_VAZIO, proximoEm: AGORA_MS + 5000 };
    expect(
      item(painel({ configuracao: configuracao(null), motor: pendente }), "motor")!.detalhe,
    ).toBe("última resposta há 1 min · fila em dia");
    // sem a configuração, ou sem a leitura do motor, não afirma nada
    expect(
      item(painel({ configuracao: undefined, motor: atrasadoHa(10 * MIN) }), "motor")!.estado,
    ).toBe("ok");
    // sem a leitura do motor, nem "fila em dia": só a última resposta
    expect(
      item(painel({ configuracao: configuracao(null), motor: undefined }), "motor")!.detalhe,
    ).toBe("última resposta há 1 min");
  });

  it("só a configuração falhando: o atraso lido do motor continua, pela última configuração conhecida", () => {
    const conhecida = configuracao(antes(MIN));
    const atrasada = painel({
      configuracao: undefined,
      configuracaoConhecida: conhecida,
      motor: atrasadoHa(10 * MIN),
    });
    expect(item(atrasada, "motor")).toMatchObject({ estado: "atencao" });
    expect(item(atrasada, "motor")!.detalhe).toMatch(/^A Janete está atrasada/);
    // a última conhecida com o onboarding aberto não afirma nada (ele pode ter sido concluído)
    const aberta = { ...conhecida, onboarding_concluido_em: null };
    const comAberta = painel({
      configuracao: undefined,
      configuracaoConhecida: aberta,
      motor: atrasadoHa(10 * MIN),
    });
    expect(item(comAberta, "motor")!.estado).toBe("ok");
    // sem o sinal do worker, nunca "aguardando"
    const semSinal = painel({
      configuracao: undefined,
      configuracaoConhecida: { ...conhecida, worker_visto_em: null },
      motor: MOTOR_VAZIO,
    });
    expect(item(semSinal, "motor")!.detalhe).toBe("última resposta há 1 min · fila em dia");
  });

  it("nenhum texto do Dashboard fala em 'agendamento', em nenhum estado do motor", () => {
    const aberto = { ...configuracao(null), onboarding_concluido_em: null };
    for (const p of [
      painel({ motor: atrasadoHa(10 * MIN) }),
      painel({ configuracao: configuracao(null) }),
      painel({ configuracao: aberto }),
      painel({ motor: undefined }),
    ]) {
      expect(JSON.stringify(p)).not.toMatch(/agendamento/i);
    }
  });

  it("com o onboarding aberto, a Saúde diz que a Janete começa quando ele terminar, sem mandar para a Configuração", () => {
    const aberto = { ...configuracao(null), onboarding_concluido_em: null };
    const motor = item(painel({ configuracao: aberto }), "motor")!;
    expect(motor).toMatchObject({ estado: "parado", detalhe: "A Janete começa a responder quando o onboarding terminar" });
    expect(motor.acao).toBeUndefined();
  });

  it("decisão 10a: sem chave de áudio, a escuta usa a do cérebro quando ele é OpenAI ou OpenRouter", () => {
    expect(item(painel(), "escuta")).toMatchObject({ estado: "ok", detalhe: "Ativa, usando a chave do cérebro" });
    expect(item(painel({ chaves: [chave({ provedor: "openrouter", modelo: "x" })] }), "escuta")!.detalhe).toBe("Ativa, usando a chave do cérebro");
    expect(item(painel({ chaves: [chave({ provedor: "anthropic", modelo: "claude-haiku-5-5" })] }), "escuta")).toMatchObject({
      estado: "atencao",
      detalhe: "Não configurada · a Janete pede texto",
    });
    const propria = painel({ chaves: [chave({ provedor: "anthropic" }), chave({ id: "k-2", finalidade: "transcricao", provedor: "groq", modelo: "whisper-large-v3-turbo" })] });
    expect(item(propria, "escuta")).toMatchObject({ estado: "ok", detalhe: "Groq · transcrevendo os áudios" });
  });

  it("D5: sem chave de áudio e com o cérebro Anthropic, a escuta usa a chave da voz; a voz sem crédito é atenção", () => {
    const voz = (status: ChaveIA["status"]) => chave({ id: "k-voz", finalidade: "voz", provedor: "elevenlabs", modelo: "", status });
    const cerebro = chave({ provedor: "anthropic", modelo: "claude-haiku-5-5" });
    expect(item(painel({ chaves: [cerebro, voz("ativa")] }), "escuta")).toMatchObject({
      estado: "ok",
      detalhe: "Ativa, usando a chave da voz",
    });
    expect(item(painel({ chaves: [cerebro, voz("sem_credito")] }), "escuta")!.estado).toBe("atencao");
    // o cérebro OpenAI vem antes da voz
    expect(item(painel({ chaves: [chave(), voz("ativa")] }), "escuta")!.detalhe).toBe("Ativa, usando a chave do cérebro");
  });

  it("a chave do cérebro sem crédito para a Janete (admin), com a hora", () => {
    const p = painel({ chaves: [chave({ status: "sem_credito", atualizada_em: antes(17 * MIN) })] });
    expect(item(p, "motor")).toMatchObject({ estado: "parado", detalhe: "Parada às 14:28 · a chave da IA ficou sem crédito" });
    expect(item(p, "cerebro")!.estado).toBe("parado");
    expect(p.textos.resumo).toBe("A Janete parou às 14:28: a chave da IA ficou sem crédito");
  });

  it("a atendente vê a Janete parada quando há conversa parada pela chave depois da última resposta dela", () => {
    const ag = lerAgoraBanco(agoraJson({ ultimaDaJaneteEm: antes(40 * MIN) }));
    const p = painel({ papel: "atendente", agoraBanco: ag });
    expect(item(p, "motor")!.detalhe).toBe("Problema na IA: o admin precisa olhar");
    expect(p.textos.resumo).toBe("A Janete está com um problema técnico · o admin já pode ver");
  });

  it("sem conexão ativa, o WhatsApp aparece desconectado", () => {
    const p = painel({ conexao: null });
    expect(item(p, "whatsapp")!.estado).toBe("parado");
    expect(p.textos.resumo).toBe("O WhatsApp está desconectado");
  });

  it("o Contexto vem da versão atual: os campos com texto e o número dela", () => {
    expect(painel().contexto).toEqual({ preenchidos: 5, total: 8, versao: 4 });
    expect(item(painel(), "contexto")).toMatchObject({ detalhe: "5 de 8 campos · versão 4", acao: { rotulo: "Completar" } });
    expect(contextoDoBanco(null)).toEqual({ preenchidos: 0, total: 8, versao: null });
    expect(painel({ contexto: null }).contexto).toEqual({ preenchidos: 0, total: 8, versao: null });
  });

  it("os problemas: a conexão que ainda não voltou e a falha de um instante só", () => {
    const p = painel();
    expect(p.resumo.problemas.map((x) => x.titulo)).toEqual(["O WhatsApp está desconectado há 105 min", "A Janete parou: a chave ficou sem crédito"]);
    expect(p.resumo.problemas[0]).toMatchObject({ causa: "A sessão caiu no provedor e ainda não voltou.", acao: { para: "/app/configuracao" } });
    expect(p.resumo.problemas[1]!.causa).toBe("O saldo da conta de IA acabou até a recarga. 1 conversa foi para a equipe.");
    const at = painel({ papel: "atendente" });
    expect(at.resumo.problemas[1]).toMatchObject({ titulo: "A Janete parou: problema na IA", acao: { para: "/app/chat" } });
    expect(at.resumo.problemas[0]!.acao).toBeUndefined();
    expect(item(p, "problemas")).toMatchObject({ estado: "atencao", detalhe: "2 problemas nos últimos 30 dias" });
  });

  it("o agora: a fila pela espera, os nomes (com a regra do Chat) e o selo de falha", () => {
    const p = painel();
    expect(p.agora.aguardando.itens.map((i) => [i.nome, i.esperaMin, i.selo])).toEqual([
      ["5511999990000", 30, "falha"],
      ["Bia", 10, "aguardando"],
    ]);
    expect(p.agora.aguardando.maisAntigaMin).toBe(30);
    expect(p.agora.comQuem).toEqual({ janete: 12, membros: [{ nome: "Ana", n: 2 }], celular: 1 });
    expect(p.agora.janeteAtiva).toEqual({ conversas: 3, digitando: "Zé" });
    expect(p.agora.kanban.map((k) => k.tipo)).toEqual(["aberta", "aberta", "ganho", "perdido"]);
    expect(p.agora.porEtapa[0]!.leads[0]).toEqual({ contatoId: "ct-1", conversaId: "cv-1", nome: "Bia", desdeMin: 90 });
    expect(p.textos.resumo).toBe("9 conversas desde ontem · 2 precisam de você");
  });

  it("a voz da Janete (fala) tem linha própria: a soma das linhas dá o total", () => {
    const comFala = {
      ...custoJson(1.6),
      porTipo: { resposta: 1.0, transcricao: 0.3, onboarding: 0.2, fala: 0.1 },
      porModelo: [
        { provedor: "openai", modelo: "gpt-4.1-mini", usd: 1.0 },
        { provedor: "openai", modelo: "gpt-4o-mini-transcribe", usd: 0.5 },
        { provedor: "elevenlabs", modelo: "eleven_multilingual_v2", usd: 0.1 },
      ],
    };
    const base = passada(periodo("30d"));
    const p = painel({ periodo: { ...base, atual: { ...base.atual, custo: lerCustoBanco(comFala) } } });
    const c = p.custo!;
    expect(c.porTipo.fala).toBeCloseTo(0.1, 9);
    expect(c.porTipo.resposta + c.porTipo.transcricao + c.porTipo.onboarding + c.porTipo.fala).toBeCloseTo(c.total.atual!, 9);
    expect(c.porModelo.map((m) => m.modelo)).toContain("eleven_multilingual_v2");
    // a voz fica fora do custo por conversa (só a resposta entra nele)
    expect(c.porConversaUsd).toBeCloseTo(0.1, 9);
  });

  it("o período sem nada fica vazio (sem números, sem problemas)", () => {
    const zerado = periodoJson({ conversas: 0, leadsNovos: 0, recebidas: 0, enviadas: 0 });
    const p = painel({ periodo: passada(periodo("30d"), { periodo: zerado }) });
    expect(p.vazio).toBe(true);
    expect(p.resumo.conversas.atual).toBeNull();
    expect(p.resumo.problemas).toEqual([]);
    expect(p.custo!.porTipo).toEqual({ resposta: 0, transcricao: 0, onboarding: 0, fala: 0 });
  });

  it("carregando (o período de antes na tela) deixa a Janete em 'carregando'", () => {
    expect(painel({ carregando: true }).estadoJanete).toBe("carregando");
  });
});

/* ---------- a tela no modo banco: os 3 estados ---------- */

const membroAdmin = { id: "mb-1", nome: "Ana", email: "ana@teste.com", papel: "admin", ativo: true, user_id: "u-1", criado_em: "2026-10-01T12:00:00.000Z", vistos: {} };

function consultaPadrao(c: Consulta): Resposta | undefined {
  if (c.tabela === "membros" && c.unica) return { data: membroAdmin, error: null };
  if (c.tabela === "conexoes") return { data: CONEXAO, error: null };
  if (c.tabela === "ia_chaves") return { data: [chave()], error: null };
  if (c.tabela === "configuracao") return { data: configuracao(antes(1 * MIN)), error: null };
  if (c.tabela === "contexto_versoes") return { data: CONTEXTO, error: null };
  return undefined;
}

function rpcPadrao(nome: string): Resposta {
  switch (nome) {
    case "dashboard_periodo":
      return { data: periodoJson(), error: null };
    case "dashboard_funil":
      return { data: funilJson(), error: null };
    case "dashboard_custo":
      return { data: custoJson(), error: null };
    case "dashboard_problemas":
      return { data: problemasJson(), error: null };
    default:
      return { data: agoraJson(), error: null };
  }
}

function montarBanco(rpc: (nome: string) => Resposta | Promise<Resposta>, filho?: ReactNode, consulta: (c: Consulta) => Resposta | undefined = consultaPadrao) {
  const f = criarClienteFalso({ uid: "u-1", consulta, rpc });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProvedorPapel papel="admin">
        <ProvedorDados fonte="banco" cliente={f.cliente}>
          {filho ?? <TelaDashboard relogio={() => new Date(AGORA)} />}
        </ProvedorDados>
      </ProvedorPapel>
    </QueryClientProvider>,
  );
  return { ...f, qc };
}

let sondaBanco: ValorPainelDashboard | null = null;
function DentroDaSonda() {
  sondaBanco = usePainelDashboard();
  return (
    <p data-testid="sonda-banco" data-carregando={sondaBanco.carregando}>
      {sondaBanco.painel.periodo.rotulo}
    </p>
  );
}
function SondaBanco() {
  return useEstadoPainel().pronto ? <DentroDaSonda /> : <p>esperando</p>;
}
function SondaComEstado() {
  const e = useEstadoPainel();
  return (
    <>
      <p data-testid="estado-banco" data-pronto={e.pronto} data-erro={e.erro ?? ""} />
      {e.pronto ? <DentroDaSonda /> : null}
    </>
  );
}

describe("C4 · a tela no modo banco: carregando, erro e pronto", () => {
  it("carregando: o h1 com a saudação (o id que a casca foca) e o osso dos cartões", async () => {
    montarBanco(() => new Promise<Resposta>(() => {}));
    const h1 = await screen.findByRole("heading", { level: 1, name: /^Boa tarde/ });
    expect(h1).toHaveAttribute("id", ID_TITULO_DASHBOARD);
    expect(screen.getByRole("status", { name: "Carregando o Dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("Tela de mentira")).not.toBeInTheDocument();
  });

  it("pronto: a tela recebe o painel montado com o banco", async () => {
    montarBanco(rpcPadrao);
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    // o "desde ontem" é o `conversas` da chamada de ontem 00:00 até agora (aqui, o mesmo JSON: 40)
    expect(screen.getByText("40 conversas desde ontem · 2 precisam de você")).toBeInTheDocument();
  });

  it("erro sem_acesso: 'Sua conta não tem acesso a isto.' com Tentar de novo, que relê", async () => {
    const f = montarBanco((nome) => (nome === "dashboard_agora" ? { data: null, error: { code: "P0001", message: "sem_acesso" } } : rpcPadrao(nome)));
    expect(await screen.findByText("Não deu para carregar o Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sua conta não tem acesso a isto.")).toBeInTheDocument();
    const antesDoClique = f.rpcs.filter((c) => c.nome === "dashboard_agora").length;
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(f.rpcs.filter((c) => c.nome === "dashboard_agora").length).toBeGreaterThan(antesDoClique));
  });

  it("o custo na tela de verdade: a linha 'voz da Janete' com o valor do banco e o provedor 'ElevenLabs'", async () => {
    const comFala = {
      ...custoJson(1.6),
      porTipo: { resposta: 1.0, transcricao: 0.3, onboarding: 0.2, fala: 0.1 },
      porModelo: [
        { provedor: "openai", modelo: "gpt-4.1-mini", usd: 1.0 },
        { provedor: "elevenlabs", modelo: "eleven_multilingual_v2", usd: 0.1 },
      ],
    };
    function ResultadoPronto() {
      return useEstadoPainel().pronto ? <Resultado ref={null} aoVoltarAoTopo={() => {}} /> : <p>esperando</p>;
    }
    montarBanco(
      (nome) => (nome === "dashboard_custo" ? { data: comFala, error: null } : rpcPadrao(nome)),
      <ProvedorPainel relogio={() => new Date(AGORA)}>
        <ResultadoPronto />
      </ProvedorPainel>,
    );
    const porTipo = await screen.findByRole("table", { name: "Por tipo" });
    const linhaVoz = within(porTipo).getByRole("rowheader", { name: "voz da Janete" }).closest("tr")!;
    expect(linhaVoz).toHaveTextContent(/US\$\s?0,10/);
    const modelo = screen.getByRole("rowheader", { name: "eleven_multilingual_v2" }).closest("tr")!;
    expect(within(modelo).getByText("ElevenLabs")).toBeInTheDocument();
  });

  it("no exemplo, a linha 'voz da Janete' aparece sempre, com US$ 0,00 (P18 e P19)", async () => {
    render(
      <ProvedorPapel papel="admin">
        <ProvedorDados progredirEnvios={false} relogio={() => new Date(AGORA)} exemplo={() => criarEstadoInicial(AGORA)}>
          <ProvedorPainel relogio={() => new Date(AGORA)}>
            <Resultado ref={null} aoVoltarAoTopo={() => {}} />
          </ProvedorPainel>
        </ProvedorDados>
      </ProvedorPapel>,
    );
    const porTipo = await screen.findByRole("table", { name: "Por tipo" });
    const linhaVoz = within(porTipo).getByRole("rowheader", { name: "voz da Janete" }).closest("tr")!;
    expect(linhaVoz).toHaveTextContent(/US\$\s?0,00/);
  });

  it("trocar o período deixa os números de antes na tela, em 'carregando', até os novos chegarem", async () => {
    let segurar = false;
    const pendentes: (() => void)[] = [];
    const rpc = (nome: string) =>
      segurar ? new Promise<Resposta>((ok) => pendentes.push(() => ok(rpcPadrao(nome)))) : rpcPadrao(nome);
    montarBanco(
      rpc,
      <ProvedorPainel relogio={() => new Date(AGORA)}>
        <SondaBanco />
      </ProvedorPainel>,
    );
    const sonda = await screen.findByTestId("sonda-banco");
    expect(sonda).toHaveTextContent("nos últimos 30 dias");
    expect(sonda).toHaveAttribute("data-carregando", "false");
    segurar = true;
    act(() => {
      sondaBanco!.setPeriodo("7d");
    });
    await waitFor(() => expect(screen.getByTestId("sonda-banco")).toHaveAttribute("data-carregando", "true"));
    expect(screen.getByTestId("sonda-banco")).toHaveTextContent("nos últimos 30 dias");
    expect(sondaBanco!.idPeriodo).toBe("7d");
    segurar = false;
    await act(async () => {
      for (const p of pendentes.splice(0)) p();
    });
    await waitFor(() => expect(screen.getByTestId("sonda-banco")).toHaveTextContent("nos últimos 7 dias"));
    expect(screen.getByTestId("sonda-banco")).toHaveAttribute("data-carregando", "false");
  });

  it("uma releitura que falha com os números na tela vira um aviso compacto em cima (os números ficam)", async () => {
    let falhar = false;
    const { qc } = montarBanco((nome) => (falhar ? { data: null, error: { code: "P0001", message: "sem_acesso" } } : rpcPadrao(nome)));
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    falhar = true;
    await act(async () => {
      await qc.invalidateQueries({ queryKey: CHAVES.dashboard });
      await qc.invalidateQueries({ queryKey: CHAVES.dashboardPeriodo });
    });
    expect(await screen.findByText("Não deu para atualizar os números")).toBeInTheDocument();
    expect(screen.getByText("Tela de mentira")).toBeInTheDocument();
  });

  it("trocar para um período cuja leitura falha não prende a tela: o painel de antes, o aviso compacto e o seletor ficam", async () => {
    let falhar = false;
    montarBanco(
      (nome) => (falhar && nome !== "dashboard_agora" ? { data: null, error: { code: "P0001", message: "sem_acesso" } } : rpcPadrao(nome)),
      <ProvedorPainel relogio={() => new Date(AGORA)}>
        <SondaComEstado />
      </ProvedorPainel>,
    );
    expect(await screen.findByTestId("sonda-banco")).toHaveTextContent("nos últimos 30 dias");
    falhar = true;
    act(() => {
      sondaBanco!.setPeriodo("7d");
    });
    await waitFor(() => expect(screen.getByTestId("estado-banco")).toHaveAttribute("data-erro", "sem_acesso"));
    // continua pronto (a tela com o seletor), com os números da última passada boa e o 7d escolhido
    expect(screen.getByTestId("estado-banco")).toHaveAttribute("data-pronto", "true");
    expect(screen.getByTestId("sonda-banco")).toHaveTextContent("nos últimos 30 dias");
    expect(screen.getByTestId("sonda-banco")).toHaveAttribute("data-carregando", "false");
    expect(sondaBanco!.idPeriodo).toBe("7d");
    // dá para voltar a um período que funciona sem sair da tela
    falhar = false;
    act(() => {
      sondaBanco!.setPeriodo("hoje");
    });
    await waitFor(() => expect(screen.getByTestId("sonda-banco")).toHaveTextContent("hoje"));
    expect(screen.getByTestId("estado-banco")).toHaveAttribute("data-erro", "");
  });

  it("na tela: a troca que falha mostra o aviso compacto em cima e a tela (não o erro de página inteira)", async () => {
    let falhar = false;
    montarBanco((nome) => (falhar && nome !== "dashboard_agora" ? { data: null, error: { code: "P0001", message: "sem_acesso" } } : rpcPadrao(nome)));
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    falhar = true;
    act(() => {
      valorDaTelaFalsa()!.setPeriodo("7d");
    });
    expect(await screen.findByText("Não deu para atualizar os números")).toBeInTheDocument();
    expect(screen.getByText("Tela de mentira")).toBeInTheDocument();
    expect(screen.queryByText("Não deu para carregar o Dashboard")).not.toBeInTheDocument();
    expect(valorDaTelaFalsa()!.idPeriodo).toBe("7d");
  });

  it("o motor é relido: 4 min com a tela aberta e nada pendente não viram 'A Janete está atrasada'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: AGORA });
    const f = montarBanco(
      (nome) =>
        nome === "motor_pendencias" ? { data: linhaMotor(null), error: null } : rpcPadrao(nome),
      <TelaDashboard relogio={() => new Date()} />,
    );
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    const lidasAntes = f.rpcs.filter((c) => c.nome === "motor_pendencias").length;
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }
    expect(f.rpcs.filter((c) => c.nome === "motor_pendencias").length).toBeGreaterThan(lidasAntes);
    expect(screen.queryByText(/A Janete está atrasada/)).not.toBeInTheDocument();
    expect(screen.getByText(/conversas desde ontem/)).toBeInTheDocument();
  });

  it("com o trabalho esperando de verdade, o aviso aparece depois dos 3 min, sem ninguém mexer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: AGORA });
    const desde = AGORA_MS - 2.5 * MIN;
    montarBanco(
      (nome) =>
        nome === "motor_pendencias" ? { data: linhaMotor(desde), error: null } : rpcPadrao(nome),
      <TelaDashboard relogio={() => new Date()} />,
    );
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    expect(screen.queryByText(/A Janete está atrasada/)).not.toBeInTheDocument();
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }
    expect(await screen.findByText(/^A Janete está atrasada há \d+ min$/)).toBeInTheDocument();
  });

  it("se a releitura do motor falha, o dado velho não vira 'A Janete está atrasada' (não afirma nada)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: AGORA });
    let falhar = false;
    montarBanco(
      (nome) =>
        nome === "motor_pendencias"
          ? falhar
            ? { data: null, error: { code: "P0001", message: "sem_acesso" } }
            : { data: linhaMotor(AGORA_MS - 10 * MIN), error: null }
          : rpcPadrao(nome),
      <TelaDashboard relogio={() => new Date()} />,
    );
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    expect(await screen.findByText(/^A Janete está atrasada há \d+ min$/)).toBeInTheDocument();
    falhar = true;
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }
    expect(screen.queryByText(/A Janete está atrasada/)).not.toBeInTheDocument();
    expect(screen.getByText(/conversas desde ontem/)).toBeInTheDocument();
  });

  it("se a releitura da configuração falha, o dado velho não vira aviso (não afirma nada)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: AGORA });
    let falhar = false;
    // o motor nunca rodou e nada pendente: o "aguardando" vem só da configuração
    montarBanco(
      (nome) =>
        nome === "motor_pendencias" ? { data: linhaMotor(null), error: null } : rpcPadrao(nome),
      <TelaDashboard relogio={() => new Date()} />,
      (c) =>
        c.tabela === "configuracao"
          ? falhar
            ? { data: null, error: { code: "P0001", message: "sem_acesso" } }
            : { data: configuracao(null), error: null }
          : consultaPadrao(c),
    );
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    const detalhe = () =>
      valorDaTelaFalsa()!.painel.agora.saude.itens.find((i) => i.id === "motor")!.detalhe;
    expect(detalhe()).toBe("A Janete liga sozinha quando chegar a primeira mensagem");
    falhar = true;
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }
    expect(detalhe()).not.toMatch(/liga sozinha/);
    expect(screen.queryByText(/atrasada|agendamento/)).not.toBeInTheDocument();
    expect(screen.getByText(/conversas desde ontem/)).toBeInTheDocument();
  });

  it("se só a releitura da configuração falha, o atraso lido do motor continua (como na Configuração)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: AGORA });
    let falhar = false;
    montarBanco(
      (nome) =>
        nome === "motor_pendencias"
          ? { data: linhaMotor(AGORA_MS - 10 * MIN), error: null }
          : rpcPadrao(nome),
      <TelaDashboard relogio={() => new Date()} />,
      (c) =>
        c.tabela === "configuracao"
          ? falhar
            ? { data: null, error: { code: "P0001", message: "sem_acesso" } }
            : { data: configuracao(new Date(Date.now() - 30_000).toISOString()), error: null }
          : consultaPadrao(c),
    );
    expect(await screen.findByText("Tela de mentira")).toBeInTheDocument();
    expect(await screen.findByText(/^A Janete está atrasada há \d+ min$/)).toBeInTheDocument();
    falhar = true;
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }
    expect(screen.getByText(/^A Janete está atrasada há \d+ min$/)).toBeInTheDocument();
  });

  it("erro de rede (depois das 3 novas tentativas): 'Verifique a internet e tente de novo.'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: AGORA });
    montarBanco((nome) => (nome === "dashboard_periodo" ? Promise.reject(new TypeError("Failed to fetch")) : rpcPadrao(nome)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(await screen.findByText("Não deu para carregar o Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Verifique a internet e tente de novo.")).toBeInTheDocument();
  });
});

/* ---------- a área lê só pela camada de dados ---------- */

describe("C4 · a área do Dashboard não lê o exemplo direto", () => {
  it("nenhum arquivo de dashboard/ usa useExemplo (só a camada de dados, em dados/dashboard.ts)", () => {
    const raiz = path.resolve(__dirname, "../features/plataforma/dashboard");
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = path.join(dir, nome);
        if (statSync(caminho).isDirectory()) andar(caminho);
        else if (/\.(ts|tsx)$/.test(nome)) arquivos.push(caminho);
      }
    };
    andar(raiz);
    expect(arquivos.length).toBeGreaterThan(10);
    const comExemplo = arquivos.filter((a) => readFileSync(a, "utf8").includes("useExemplo"));
    expect(comExemplo).toEqual([]);
  });
});
