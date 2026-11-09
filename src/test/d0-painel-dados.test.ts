import { describe, expect, it } from "vitest";

import {
  DIAS_DE_HISTORICO,
  DIAS_SEM_RESPOSTA,
  etapaEm,
  leadsDoDia,
  numerosDaJanela,
  ultimaDoLeadAte,
} from "@/features/plataforma/dashboard/dados/gerador";
import { calcularDadosPeriodo, montarPainel, saudacao } from "@/features/plataforma/dashboard/dados/montar";
import {
  diasDoIntervalo,
  inicioDoDia,
  janelasDoPeriodo,
  montarPeriodo,
  somarDias,
} from "@/features/plataforma/dashboard/dados/periodo";
import {
  dinheiro,
  duracaoCurta,
  haQuanto,
  numero,
  porcentagem,
  variacao,
  variacaoDe,
  variacaoPontos,
} from "@/features/plataforma/dashboard/dados/formatar";
import type { IdPeriodo, PainelDashboard, Periodo, Simulacao } from "@/features/plataforma/dashboard/dados/tipos";
import { criarEstadoInicial, estaAguardando, membroDoPapel, type EstadoExemplo } from "@/features/plataforma/exemplo";

// 14:45 em São Paulo (o "agora" dos protótipos; os dados de exemplo de agora são relativos a ele).
const AGORA = new Date("2026-10-30T17:45:00.000Z");

function estadoDe(papel: "admin" | "atendente", agora: Date = AGORA, mexer?: (e: EstadoExemplo) => EstadoExemplo): EstadoExemplo {
  const base = criarEstadoInicial(agora);
  const eu = membroDoPapel(base.membros, papel);
  // como o ProvedorExemplo: a atendente não lê chaves, custos nem auditoria
  const restrito = papel === "admin" ? {} : { chaves: [], custos: [], auditoria: [] };
  const estado: EstadoExemplo = { ...base, eu, ...restrito };
  return mexer ? mexer(estado) : estado;
}

function periodo(id: IdPeriodo, agora: Date = AGORA, personalizado?: { inicio: string; fim: string }): Periodo {
  const r = montarPeriodo(id, agora, personalizado);
  if (!r.ok) throw new Error(`período inválido: ${id}`);
  return r.periodo;
}

function painel(
  opcoes: {
    id?: IdPeriodo;
    personalizado?: { inicio: string; fim: string };
    papel?: "admin" | "atendente";
    simulacao?: Simulacao;
    carregando?: boolean;
    agora?: Date;
    nome?: string;
    mexer?: (e: EstadoExemplo) => EstadoExemplo;
  } = {},
): PainelDashboard {
  const agora = opcoes.agora ?? AGORA;
  const papel = opcoes.papel ?? "admin";
  return montarPainel({
    estado: estadoDe(papel, agora, opcoes.mexer),
    papel,
    nomeConta: opcoes.nome ?? "equipe Teste",
    agora,
    periodo: periodo(opcoes.id ?? "30d", agora, opcoes.personalizado),
    simulacao: opcoes.simulacao ?? "normal",
    carregando: opcoes.carregando ?? false,
  });
}

const soma = (xs: readonly { valor: number }[]) => xs.reduce((s, p) => s + p.valor, 0);
const umaCasa = (x: number) => Math.round(x * 10) / 10;

const CASOS: readonly [string, IdPeriodo, { inicio: string; fim: string } | undefined][] = [
  ["hoje", "hoje", undefined],
  ["7 dias", "7d", undefined],
  ["30 dias", "30d", undefined],
  ["90 dias", "90d", undefined],
  ["personalizado (03/09 a 12/10)", "personalizado", { inicio: "2026-09-03", fim: "2026-10-12" }],
];

describe("d0 · as invariantes do gerador em todos os períodos", () => {
  it.each(CASOS)("%s: o funil fecha, é monótono e bate com ganhos e perdidos", (_n, id, pers) => {
    const p = painel({ id, ...(pers ? { personalizado: pers } : {}) });
    const etapas = p.funil.etapas;
    expect(etapas.map((e) => e.nome)).toEqual(["Novo", "Em qualificação", "Qualificado", "Em negociação", "Ganho"]);
    expect(etapas[0]!.chegaram).toBe(p.funil.leadsNovos);
    expect(p.resumo.leadsNovos.atual).toBe(p.funil.leadsNovos);
    for (const [i, e] of etapas.entries()) {
      if (e.tipo === "aberta") {
        expect(e.chegaram).toBe(e.avancaram + e.abandonaram.total + e.aindaEstao);
        expect(e.abandonaram.total).toBe(e.abandonaram.perdido + e.abandonaram.semResposta);
        expect(e.avancaram).toBe(etapas[i + 1]!.chegaram);
        expect(e.movimentos.janete + e.movimentos.equipe).toBe(e.avancaram);
        expect(e.conversaoProxPct).toBe(e.chegaram ? umaCasa((e.avancaram / e.chegaram) * 100) : null);
      } else {
        expect(e.aindaEstao).toBe(e.chegaram);
        expect(e.conversaoProxPct).toBeNull();
      }
      if (i > 0) expect(e.chegaram).toBeLessThanOrEqual(etapas[i - 1]!.chegaram);
      expect(e.entradasPorDia).toHaveLength(p.periodo.dias);
      expect(e.frase.length).toBeGreaterThan(10);
    }
    // a Janete só move para Em qualificação e Qualificado (para a próxima: de Novo e de Em qualificação)
    expect(etapas[2]!.movimentos.janete + etapas[3]!.movimentos.janete).toBe(0);
    expect(soma(etapas[0]!.entradasPorDia)).toBe(p.funil.leadsNovos);
    expect(p.funil.ganhos).toBe(etapas[4]!.chegaram);
    expect(p.funil.perdidos).toBe(p.funil.perdidosPorOrigem.reduce((s, x) => s + x.perdido, 0));
    expect(p.funil.perdidosPorOrigem.map((x) => x.perdido)).toEqual(etapas.slice(0, 4).map((e) => e.abandonaram.perdido));
    expect(p.funil.taxaGanhoPct).toBe(p.funil.leadsNovos ? umaCasa((p.funil.ganhos / p.funil.leadsNovos) * 100) : null);
    expect(p.funil.perguntas).toHaveLength(3);
  });

  it.each(CASOS)("%s: o custo fecha (por dia, por tipo e por etapa + fora da coorte)", (_n, id, pers) => {
    const p = painel({ id, ...(pers ? { personalizado: pers } : {}) });
    const c = p.custo!;
    const total = c.total.atual ?? 0;
    expect(soma(p.resumo.series.custoUsd!)).toBeCloseTo(total, 6);
    // o exemplo não tem voz: a linha existe e vale 0, sem mudar os números de antes
    expect(c.porTipo.fala).toBe(0);
    expect(c.porTipo.resposta + c.porTipo.transcricao + c.porTipo.fala).toBeCloseTo(total, 6);
    const porEtapa = p.funil.etapas.reduce((s, e) => s + (e.custoUsd ?? 0), 0);
    expect(porEtapa + c.foraDaCoorteUsd).toBeCloseTo(c.porTipo.resposta, 6);
    expect(c.porModelo.reduce((s, m) => s + m.usd, 0)).toBeCloseTo(total, 6);
    if (p.funil.ganhos) expect(c.porGanhoUsd).toBeCloseTo(total / p.funil.ganhos, 6);
    else expect(c.porGanhoUsd).toBeNull();
  });

  it.each(CASOS)("%s: as séries têm um ponto por dia e batem com os totais", (_n, id, pers) => {
    const p = painel({ id, ...(pers ? { personalizado: pers } : {}) });
    const dias = diasDoIntervalo(p.periodo.inicio, p.periodo.fim);
    const r = p.resumo;
    for (const s of [r.series.conversas, r.series.recebidas, r.series.enviadas, r.series.respostaJaneteS, r.series.custoUsd!]) {
      expect(s.map((x) => x.dia)).toEqual(dias);
    }
    expect(soma(r.series.recebidas)).toBe(r.recebidas.atual);
    expect(soma(r.series.enviadas)).toBe(r.enviadas.atual);
    expect(r.enviadasPorOrigem.janete + r.enviadasPorOrigem.humano_tela + r.enviadasPorOrigem.humano_celular).toBe(r.enviadas.atual);
    // uma conversa por lead: a soma das conversas por dia é pelo menos o total (o mesmo lead fala em vários dias)
    expect(soma(r.series.conversas)).toBeGreaterThanOrEqual(r.conversas.atual ?? 0);
    expect(r.passados.janetePassou + r.passados.falha).toBe(Object.values(r.passados.porMotivo).reduce((s, n) => s + (n ?? 0), 0));
    for (const t of [r.conversas, r.recebidas, r.enviadas, r.leadsNovos, r.primeiraRespostaS, r.respostaJaneteS, r.autonomiaPct]) {
      if (t.atual === null || t.anterior === null || t.anterior === 0) expect(t.variacaoPct).toBeNull();
      else expect(t.variacaoPct).toBe(Math.round(((t.atual - t.anterior) / t.anterior) * 1000) / 10);
    }
  });

  it("a autonomia bate com a contagem de conversas sem humano e sem passagem", () => {
    const per = periodo("30d");
    const { atual } = janelasDoPeriodo(per, AGORA);
    const n = numerosDaJanela(atual, diasDoIntervalo(per.inicio, per.fim), AGORA.getTime());
    expect(n.autonomiaPct).toBe(umaCasa((n.conversasAutonomas / n.conversas) * 100));
    expect(painel().resumo.autonomiaPct.atual).toBe(n.autonomiaPct);
  });

  it("é determinístico: as mesmas entradas dão o mesmo painel", () => {
    expect(painel({ id: "90d" })).toEqual(painel({ id: "90d" }));
    expect(calcularDadosPeriodo(periodo("30d"), AGORA)).toEqual(calcularDadosPeriodo(periodo("30d"), AGORA));
  });

  it("trocar o período mantém a história: os 7 dias são o fim dos 30, e os 30 o fim dos 90", () => {
    const p7 = painel({ id: "7d" });
    const p30 = painel({ id: "30d" });
    const p90 = painel({ id: "90d" });
    const hoje = painel({ id: "hoje" });
    expect(p30.resumo.series.recebidas.slice(-7)).toEqual(p7.resumo.series.recebidas);
    expect(p90.resumo.series.enviadas.slice(-30)).toEqual(p30.resumo.series.enviadas);
    expect(p90.resumo.series.custoUsd!.slice(-30)).toEqual(p30.resumo.series.custoUsd);
    expect(p7.resumo.series.recebidas.slice(-1)).toEqual(hoje.resumo.series.recebidas);
    expect(hoje.resumo.leadsNovos.atual!).toBeLessThanOrEqual(p7.resumo.leadsNovos.atual!);
    expect(p7.resumo.leadsNovos.atual!).toBeLessThanOrEqual(p30.resumo.leadsNovos.atual!);
    expect(p30.resumo.leadsNovos.atual!).toBeLessThanOrEqual(p90.resumo.leadsNovos.atual!);
    // o anterior dos 30 dias é a janela dos 30 dias que vem antes
    expect(p30.periodo).toMatchObject({ inicio: "2026-10-01", fim: "2026-10-30", anterior: { inicio: "2026-09-01", fim: "2026-09-30" } });
  });
});

describe("d0 · a calibragem do padrão (30 dias)", () => {
  it("mantém as faixas de volume e a taxa de ganho coerente durante os próximos 60 dias", () => {
    const fora: string[] = [];
    for (let d = 0; d < 60; d += 1) {
      const agora = new Date(AGORA.getTime() + d * 86_400_000);
      const p = painel({ agora });
      const r = p.resumo;
      const c = p.custo!;
      const env = r.enviadas.atual ?? 0;
      const faixas: [string, number | null, number, number][] = [
        ["novos", r.leadsNovos.atual, 160, 200],
        ["conversas", r.conversas.atual, 200, 250],
        ["recebidas", r.recebidas.atual, 2000, 2600],
        ["enviadas", env, 2100, 2700],
        ["janete", r.enviadasPorOrigem.janete / env, 0.85, 0.93],
        ["tela", r.enviadasPorOrigem.humano_tela / env, 0.05, 0.12],
        ["celular", r.enviadasPorOrigem.humano_celular / env, 0.005, 0.04],
        ["1ª resposta", r.primeiraRespostaS.atual, 30, 60],
        ["Janete responde", r.respostaJaneteS.atual, 12, 25],
        ["p90", r.respostaJaneteP90S, 50, 80],
        ["autonomia", r.autonomiaPct.atual, 70, 85],
        ["passados", r.passados.janetePassou, 25, 40],
        ["custo", c.total.atual, 35, 60],
        ["sem preço", c.semPreco, 2, 5],
        ["problemas", r.problemas.length, 2, 4],
        // com os 3 problemas, as passagens por falha ficam em 3–8; no dia em que o incidente ainda
        // não aconteceu às 14:45 (2 problemas), uma falha a menos entra na janela
        ["falhas", r.passados.falha, r.problemas.length >= 3 ? 3 : 1, 8],
      ];
      for (const [nome, x, a, b] of faixas) if (x === null || x < a || x > b) fora.push(`${p.periodo.fim} ${nome}=${x}`);
      // O percentual acompanha a coorte real da data; não exige um resultado comercial mínimo.
      expect(p.funil.ganhos).toBeGreaterThanOrEqual(0);
      expect(p.funil.ganhos).toBeLessThanOrEqual(p.funil.leadsNovos);
      expect(p.funil.taxaGanhoPct).toBe(p.funil.leadsNovos
        ? umaCasa(100 * p.funil.ganhos / p.funil.leadsNovos) : null);
    }
    expect(fora).toEqual([]);
  });

  it("fica nas faixas da seção 15 e sem número redondo bonito", () => {
    const p = painel();
    const r = p.resumo;
    const c = p.custo!;
    const dentro = (x: number | null, a: number, b: number) => {
      expect(x).not.toBeNull();
      expect(x!).toBeGreaterThanOrEqual(a);
      expect(x!).toBeLessThanOrEqual(b);
    };
    dentro(r.leadsNovos.atual, 160, 200);
    dentro(r.conversas.atual, 200, 250);
    dentro(r.recebidas.atual, 2000, 2600);
    dentro(r.enviadas.atual, 2100, 2700);
    const env = r.enviadas.atual!;
    dentro(r.enviadasPorOrigem.janete / env, 0.85, 0.93);
    dentro(r.enviadasPorOrigem.humano_tela / env, 0.05, 0.12);
    dentro(r.enviadasPorOrigem.humano_celular / env, 0.005, 0.04);
    dentro(r.primeiraRespostaS.atual, 30, 60);
    dentro(r.respostaJaneteS.atual, 12, 25);
    dentro(r.respostaJaneteP90S, 50, 80);
    dentro(r.autonomiaPct.atual, 70, 85);
    dentro(r.passados.janetePassou, 25, 40);
    dentro(r.passados.falha, 3, 8);
    dentro(p.funil.taxaGanhoPct, 8, 12);
    dentro(c.total.atual, 35, 60);
    dentro(c.semPreco, 2, 5);
    expect(r.problemas).toHaveLength(3);
    for (const x of [r.leadsNovos.atual, r.conversas.atual, r.recebidas.atual, r.enviadas.atual]) expect(x! % 50).not.toBe(0);
    expect(Math.round(c.total.atual! * 100) % 100).not.toBe(0);
    expect(c.previsaoMesUsd).not.toBeNull();
    // o custo por resposta fica entre US$ 0,004 e US$ 0,03
    expect(c.porConversaUsd!).toBeGreaterThan(0.004);
  });
});

describe("d0 · papel e período vazio", () => {
  it("o atendente não recebe custo em lugar nenhum (undefined, nunca 0)", () => {
    const p = painel({ papel: "atendente" });
    expect(p.papel).toBe("atendente");
    expect(p.custo).toBeUndefined();
    expect("custo" in p).toBe(false);
    expect("custoUsd" in p.resumo.series).toBe(false);
    for (const e of p.funil.etapas) expect("custoUsd" in e).toBe(false);
    expect(JSON.stringify(p)).not.toMatch(/US\$|custoUsd|usd/i);
    // a Saúde perde o cérebro e a escuta
    expect(p.agora.saude.itens.map((i) => i.id)).toEqual(["whatsapp", "motor", "contexto", "problemas"]);
    // nenhuma ação leva à Configuração, e os problemas não falam da chave nem do saldo da IA
    for (const pb of p.resumo.problemas) expect(pb.acao?.para).not.toBe("/app/configuracao");
    for (const sim of ["normal", "chave_sem_credito"] as const) {
      for (const id of ["30d", "90d"] as const) {
        for (const pb of painel({ papel: "atendente", simulacao: sim, id }).resumo.problemas) {
          expect(`${pb.titulo} ${pb.causa}`).not.toMatch(/chave|crédito|saldo/i);
        }
      }
    }
    const admin90 = painel({ id: "90d" }).resumo.problemas.map((pb) => pb.titulo).join(" | ");
    expect(admin90).toMatch(/chave/);
    for (const i of p.agora.saude.itens) expect(i.acao?.para).not.toBe("/app/configuracao");
  });

  it("o admin vê o cérebro, a escuta (atenção: não configurada) e o custo", () => {
    const p = painel();
    expect(p.agora.saude.itens.map((i) => i.id)).toEqual(["whatsapp", "motor", "cerebro", "escuta", "contexto", "problemas"]);
    const escuta = p.agora.saude.itens.find((i) => i.id === "escuta")!;
    expect(escuta).toMatchObject({ estado: "atencao", detalhe: "Não configurada · a Janete pede texto" });
    expect(p.agora.saude.itens.find((i) => i.id === "cerebro")!.detalhe).toBe("Anthropic · Claude Haiku 5.5 · chave ativa");
    expect(p.agora.saude.itens.find((i) => i.id === "contexto")!).toMatchObject({
      detalhe: "6 de 8 campos · versão 6",
      acao: { rotulo: "Completar", para: "/app/contexto" },
    });
    expect(p.agora.saude.itens.find((i) => i.id === "problemas")!.detalhe).toBe("3 problemas nos últimos 30 dias");
    expect(p.agora.saude.geral).not.toBe("parado");
    expect(p.custo).toBeDefined();
  });

  it("a simulação 'Período vazio' zera o período, mas o agora continua", () => {
    const normal = painel();
    const p = painel({ simulacao: "periodo_vazio" });
    expect(p.vazio).toBe(true);
    const r = p.resumo;
    for (const t of [r.conversas, r.leadsNovos, r.recebidas, r.enviadas, r.primeiraRespostaS, r.respostaJaneteS, r.autonomiaPct, p.custo!.total]) {
      expect(t.atual).toBeNull();
      expect(t.variacaoPct).toBeNull();
      expect(t.sentido).toBe("neutro");
    }
    expect(r.problemas).toEqual([]);
    expect(soma(r.series.recebidas)).toBe(0);
    expect(r.series.recebidas).toHaveLength(30);
    expect(p.funil.etapas.every((e) => e.chegaram === 0 && e.conversaoProxPct === null)).toBe(true);
    expect(p.funil.frase).toBe("Nenhum lead chegou neste período.");
    expect(p.textos.resultado).toBe("Nenhum lead chegou neste período.");
    expect(p.custo!.porConversaUsd).toBeNull();
    expect(p.custo!.porGanhoUsd).toBeNull();
    // o agora é o mesmo (só a linha "Problemas no período" da Saúde muda)
    const { saude: saudeVazio, ...agoraVazio } = p.agora;
    const { saude: saudeNormal, ...agoraNormal } = normal.agora;
    expect(agoraVazio).toEqual(agoraNormal);
    expect(saudeVazio.itens.find((i) => i.id === "whatsapp")).toEqual(saudeNormal.itens.find((i) => i.id === "whatsapp"));
    expect(saudeVazio.itens.find((i) => i.id === "problemas")!.detalhe).toBe("Nenhum problema nos últimos 30 dias");
  });

  it("um personalizado antes do início do histórico vem vazio de verdade, sem problema solto", () => {
    const p = painel({ id: "personalizado", personalizado: { inicio: "2024-01-05", fim: "2024-02-10" } });
    expect(p.vazio).toBe(true);
    expect(p.resumo.conversas.atual).toBeNull();
    expect(p.resumo.conversas.anterior).toBe(0);
    expect(p.resumo.conversas.variacaoPct).toBeNull();
    expect(p.periodo.rotulo).toBe("de 05/01/2024 a 10/02/2024");
    // os números crus da janela também não têm incidente (antes do histórico não há lead nem problema)
    const per = periodo("personalizado", AGORA, { inicio: "2024-01-05", fim: "2024-02-10" });
    const n = numerosDaJanela(janelasDoPeriodo(per, AGORA).atual, diasDoIntervalo(per.inicio, per.fim), AGORA.getTime());
    expect(n.incidentes).toEqual([]);
  });

  it("numa janela que pega o começo do histórico, nenhum problema cai antes dele", () => {
    const inicioHist = somarDias("2026-10-30", -DIAS_DE_HISTORICO);
    const per = periodo("personalizado", AGORA, { inicio: somarDias(inicioHist, -60), fim: somarDias(inicioHist, 60) });
    const n = numerosDaJanela(janelasDoPeriodo(per, AGORA).atual, diasDoIntervalo(per.inicio, per.fim), AGORA.getTime());
    expect(n.incidentes.length).toBeGreaterThan(0);
    for (const inc of n.incidentes) expect(inc.t).toBeGreaterThanOrEqual(inicioDoDia(inicioHist));
  });

  it("o personalizado de 1 ano tem histórico inteiro, inclusive o anterior (sem degrau nem variação sumida)", () => {
    const p = painel({ id: "personalizado", personalizado: { inicio: "2025-10-30", fim: "2026-10-30" } });
    expect(p.periodo.dias).toBe(366);
    expect(p.vazio).toBe(false);
    const conv = p.resumo.series.conversas;
    // o começo do ano tem movimento como o resto (nada de 155 dias zerados)
    const media = (xs: { valor: number }[]) => soma(xs) / xs.length;
    expect(media(conv.slice(0, 30))).toBeGreaterThan(media(conv.slice(-30)) * 0.6);
    expect(conv.slice(0, 7).every((x) => x.valor > 0)).toBe(true);
    for (const t of [p.resumo.conversas, p.resumo.leadsNovos, p.resumo.recebidas, p.custo!.total]) {
      expect(t.anterior).toBeGreaterThan(0);
      expect(t.variacaoPct).not.toBeNull();
    }
  });
});

describe("d0 · a virada de dia no fuso de São Paulo", () => {
  it("às 00:30 de São Paulo, 'hoje' já é o dia novo e só conta o que chegou depois da meia-noite", () => {
    const agora = new Date("2026-10-31T03:30:00.000Z"); // 31/10, 00:30 em SP
    const per = periodo("hoje", agora);
    expect(per).toMatchObject({ inicio: "2026-10-31", fim: "2026-10-31", dias: 1, anterior: { inicio: "2026-10-30", fim: "2026-10-30" } });
    const p = painel({ id: "hoje", agora });
    const esperado = leadsDoDia("2026-10-31").filter((l) => l.t0 <= agora.getTime()).length;
    expect(p.resumo.leadsNovos.atual ?? 0).toBe(esperado);
    expect(p.resumo.series.recebidas.map((x) => x.dia)).toEqual(["2026-10-31"]);
    expect(p.textos.saudacao).toBe("Boa noite, equipe");
    expect(p.textos.atualizado).toBe("atualizado às 00:30");
    // 30 dias às 00:30 de 31/10: de 02/10 a 31/10
    expect(periodo("30d", agora)).toMatchObject({ inicio: "2026-10-02", fim: "2026-10-31" });
  });

  it("às 23:30 de São Paulo (já é o dia seguinte em UTC), 'hoje' ainda é o dia de lá", () => {
    const agora = new Date("2026-10-31T02:30:00.000Z"); // 30/10, 23:30 em SP
    const per = periodo("hoje", agora);
    expect(per).toMatchObject({ inicio: "2026-10-30", fim: "2026-10-30" });
    const p = painel({ id: "hoje", agora });
    const esperado = leadsDoDia("2026-10-30").filter((l) => l.t0 <= agora.getTime()).length;
    expect(esperado).toBeGreaterThan(0);
    expect(p.resumo.leadsNovos.atual).toBe(esperado);
    expect(p.resumo.series.conversas.map((x) => x.dia)).toEqual(["2026-10-30"]);
    expect(p.textos.saudacao).toBe("Boa noite, equipe");
    // o dia 31 ainda é futuro em São Paulo
    expect(montarPeriodo("personalizado", agora, { inicio: "2026-10-30", fim: "2026-10-31" })).toEqual({ ok: false, erro: "datas_invalidas" });
    expect(periodo("7d", agora)).toMatchObject({ inicio: "2026-10-24", fim: "2026-10-30" });
  });

  it("a comparação de 'hoje' é com ontem até a mesma hora", () => {
    const per = periodo("hoje");
    const { atual, anterior } = janelasDoPeriodo(per, AGORA);
    expect(atual.ate - atual.de).toBe(anterior.ate - anterior.de);
    expect(new Date(atual.de).toISOString()).toBe("2026-10-30T03:00:00.000Z");
    expect(per.rotuloComparacao).toBe("comparado com ontem até esta hora");
  });

  it("a saudação segue a hora de São Paulo", () => {
    expect(saudacao(new Date("2026-10-30T08:00:00.000Z"), "equipe Teste")).toBe("Bom dia, equipe");
    expect(saudacao(new Date("2026-10-30T15:00:00.000Z"), "equipe")).toBe("Boa tarde, equipe");
    expect(saudacao(new Date("2026-10-30T21:00:00.000Z"), "")).toBe("Boa noite");
    expect(saudacao(new Date("2026-10-30T07:59:00.000Z"), "  ")).toBe("Boa noite"); // 04:59 em SP
  });
});

describe("d0 · a linha de resumo e o estado da Janete nos 5 estados", () => {
  it("normal: 'N conversas desde ontem · K precisam de você', Janete acordada", () => {
    const p = painel();
    const k = estadoDe("admin").conversas.filter((c) => estaAguardando(c)).length;
    expect(k).toBeGreaterThan(0);
    expect(p.agora.aguardando.total).toBe(k);
    expect(p.textos.resumo).toMatch(new RegExp(`^\\d+ conversas desde ontem · ${k} precisa(m)? de você$`));
    expect(p.estadoJanete).toBe("acordada");
    expect(p.textos.saudacao).toBe("Boa tarde, equipe");
    expect(p.textos.atualizado).toBe("atualizado às 14:45");
  });

  it("normal sem ninguém esperando: 'Tudo em dia'", () => {
    const p = painel({
      mexer: (e) => ({
        ...e,
        conversas: e.conversas.map((c) => (estaAguardando(c) ? { ...c, modo: "janete", motivo_humano: null, aguardando_humano_desde: null } : c)),
      }),
    });
    expect(p.agora.aguardando.total).toBe(0);
    expect(p.agora.aguardando.maisAntigaMin).toBeNull();
    expect(p.textos.resumo).toBe("Tudo em dia · ninguém esperando por você");
  });

  it("chave sem crédito: a Janete parou às 14:28, dorme, a Saúde fica vermelha e 4 conversas param", () => {
    const normal = painel();
    const admin = painel({ simulacao: "chave_sem_credito" });
    expect(admin.textos.resumo).toBe("A Janete parou às 14:28: a chave da IA ficou sem crédito");
    expect(admin.estadoJanete).toBe("dormindo");
    expect(admin.agora.saude).toMatchObject({ geral: "parado", frase: "A Janete parou" });
    expect(admin.agora.saude.itens.find((i) => i.id === "motor")).toMatchObject({ estado: "parado" });
    expect(admin.agora.saude.itens.find((i) => i.id === "cerebro")).toMatchObject({ estado: "parado" });
    expect(admin.agora.aguardando.total).toBe(normal.agora.aguardando.total + 4);
    const paradas = admin.agora.aguardando.itens.filter((i) => i.motivoCurto === "Sem crédito de IA" && i.selo === "falha");
    expect(paradas.map((i) => i.esperaMin).sort((a, b) => a - b)).toEqual(expect.arrayContaining([8, 11, 14, 17]));
    expect(admin.agora.janeteAtiva).toEqual({ conversas: 0, digitando: null });
    expect(admin.resumo.problemas[0]).toMatchObject({ tipo: "falha_ia", acao: { para: "/app/configuracao" } });

    const atendente = painel({ simulacao: "chave_sem_credito", papel: "atendente" });
    expect(atendente.textos.resumo).toBe("A Janete está com um problema técnico · o admin já pode ver");
    expect(atendente.estadoJanete).toBe("dormindo");
    expect(atendente.agora.saude.itens.find((i) => i.id === "motor")!.detalhe).toBe("Problema na IA: o admin precisa olhar");
    expect(atendente.resumo.problemas[0]!.acao).toEqual({ rotulo: "Ver conversa", para: "/app/chat" });
  });

  it("WhatsApp caiu: 'O WhatsApp desconectou às 12:47', Janete dorme, última mensagem há 2 h", () => {
    const p = painel({ simulacao: "whatsapp_caiu" });
    expect(p.textos.resumo).toBe("O WhatsApp desconectou às 12:47");
    expect(p.estadoJanete).toBe("dormindo");
    const w = p.agora.saude.itens.find((i) => i.id === "whatsapp")!;
    expect(w.estado).toBe("parado");
    expect(w.detalhe).toContain("última mensagem recebida há 2 h");
    expect(p.agora.saude.geral).toBe("parado");
    expect(p.agora.saude.itens.find((i) => i.id === "motor")!.estado).toBe("parado");
  });

  it("período vazio: sem 'conversas desde ontem' (não contradiz os cartões), e a Janete fica acordada", () => {
    const k = painel().agora.aguardando.total;
    const p = painel({ simulacao: "periodo_vazio" });
    expect(p.textos.resumo).toBe(`${k} precisam de você`);
    expect(p.estadoJanete).toBe("acordada");
    // a simulação com um personalizado no passado (sem ontem nem hoje) mantém a linha normal
    const passado = painel({ simulacao: "periodo_vazio", id: "personalizado", personalizado: { inicio: "2026-09-01", fim: "2026-09-15" } });
    expect(passado.textos.resumo).toBe(painel().textos.resumo);
    // e, sem ninguém esperando, a frase calma
    const calmo = painel({
      simulacao: "periodo_vazio",
      mexer: (e) => ({
        ...e,
        conversas: e.conversas.map((c) => (estaAguardando(c) ? { ...c, modo: "janete", motivo_humano: null, aguardando_humano_desde: null } : c)),
      }),
    });
    expect(calmo.textos.resumo).toBe("Tudo em dia · ninguém esperando por você");
  });

  it("chave removida na Configuração: a hora vem da auditoria (e some sem registro), não do relógio", () => {
    const semChave = (e: EstadoExemplo): EstadoExemplo => ({ ...e, chaves: e.chaves.filter((k) => k.finalidade !== "resposta") });
    const removidaAs = "2026-10-30T16:12:00.000Z"; // 13:12 em SP
    const comRegistro = painel({
      mexer: (e) => ({
        ...semChave(e),
        auditoria: [
          ...e.auditoria,
          { id: 99, acao: "chave_removida", alvo: "ch-resposta", ator_membro_id: e.eu.id, detalhe: { finalidade: "resposta" }, ultimos4: "a1b2", criado_em: removidaAs },
        ],
      }),
    });
    expect(comRegistro.textos.resumo).toBe("A Janete parou às 13:12: a chave da IA foi removida");
    expect(comRegistro.agora.saude.itens.find((i) => i.id === "motor")!.detalhe).toBe("Parada às 13:12 · a chave da IA foi removida");
    const semRegistro = painel({ mexer: semChave });
    expect(semRegistro.textos.resumo).toBe("A Janete parou: a chave da IA foi removida");
    expect(semRegistro.agora.saude.itens.find((i) => i.id === "motor")!.detalhe).toBe("Parada · a chave da IA foi removida");
  });

  it("carregando: a Janete gira (pela simulação e pela troca de período)", () => {
    expect(painel({ simulacao: "carregando" }).estadoJanete).toBe("carregando");
    expect(painel({ carregando: true }).estadoJanete).toBe("carregando");
    expect(painel({ carregando: true, simulacao: "chave_sem_credito" }).estadoJanete).toBe("carregando");
  });
});

describe("d0 · o agora sai do exemplo", () => {
  it("aguardando em ordem de espera, kanban igual ao do exemplo, não lidas e com quem", () => {
    const e = estadoDe("admin");
    const p = painel();
    const a = p.agora;
    const esperas = a.aguardando.itens.map((i) => i.esperaMin);
    expect(esperas).toEqual([...esperas].sort((x, y) => y - x));
    expect(a.aguardando.maisAntigaMin).toBe(esperas[0]);
    expect(a.kanban.map((k) => k.nome)).toEqual(["Novo", "Em qualificação", "Qualificado", "Em negociação", "Ganho", "Perdido"]);
    expect(a.kanban.reduce((s, k) => s + k.n, 0)).toBe(e.contatos.length);
    expect(a.naoLidas.mensagens).toBe(e.conversas.reduce((s, c) => s + c.nao_lidas, 0));
    expect(a.comQuem.janete + a.comQuem.celular + a.comQuem.membros.reduce((s, m) => s + m.n, 0) + a.aguardando.total).toBe(e.conversas.length);
  });
});

describe("d0 · o 'Pergunte à Janete' e as frases", () => {
  it("as respostas saem dos números", () => {
    const p = painel();
    const [perda, mudou, tempo] = p.funil.perguntas;
    expect(perda!.pergunta).toBe("Onde eu mais perco leads?");
    const maior = p.funil.etapas.slice(0, 4).reduce((m, e) => (e.abandonaram.total > m.abandonaram.total ? e : m));
    expect(perda!.resposta).toContain(`${maior.abandonaram.total} saíram ali`);
    expect(mudou!.pergunta).toBe("O que mudou em relação aos 30 dias anteriores?");
    expect(mudou!.resposta).toContain(`Chegaram ${p.funil.leadsNovos} leads`);
    expect(tempo!.pergunta).toBe("Quanto tempo leva para fechar uma venda?");
    expect(tempo!.resposta).toMatch(/^A mediana é de [\d,]+ dias? do 1º contato até o Ganho\./);
    const e1 = p.funil.etapas[1]!;
    expect(e1.frase.startsWith(`Dos ${e1.chegaram} que chegaram em Em qualificação, ${e1.avancaram} avançaram (`)).toBe(true);
    expect(p.textos.resultado).toMatch(/^\d+ vendas no período, (\d+ a (mais|menos) que no anterior|o mesmo que no anterior)\.$/);
  });
});

describe("d0 · o personalizado e as datas inválidas", () => {
  it("recusa datas inválidas", () => {
    const inval = { ok: false, erro: "datas_invalidas" };
    expect(montarPeriodo("personalizado", AGORA)).toEqual(inval);
    expect(montarPeriodo("personalizado", AGORA, { inicio: "2026-13-01", fim: "2026-10-01" })).toEqual(inval);
    expect(montarPeriodo("personalizado", AGORA, { inicio: "2026-02-30", fim: "2026-03-10" })).toEqual(inval);
    expect(montarPeriodo("personalizado", AGORA, { inicio: "01/10/2026", fim: "2026-10-10" })).toEqual(inval);
    expect(montarPeriodo("personalizado", AGORA, { inicio: "2026-10-12", fim: "2026-10-03" })).toEqual(inval);
    expect(montarPeriodo("personalizado", AGORA, { inicio: "2026-10-20", fim: "2026-10-31" })).toEqual(inval);
    expect(montarPeriodo("personalizado", AGORA, { inicio: "2025-10-29", fim: "2026-10-30" })).toEqual(inval);
  });

  it("aceita até 1 ano, um dia só e o fim hoje", () => {
    const umAno = montarPeriodo("personalizado", AGORA, { inicio: "2025-10-30", fim: "2026-10-30" });
    expect(umAno.ok && umAno.periodo.dias).toBe(366);
    const umDia = montarPeriodo("personalizado", AGORA, { inicio: "2026-10-15", fim: "2026-10-15" });
    expect(umDia.ok && umDia.periodo).toMatchObject({ dias: 1, rotulo: "em 15/10", rotuloComparacao: "comparado com o dia anterior" });
    const ate = montarPeriodo("personalizado", AGORA, { inicio: "2026-10-01", fim: "2026-10-15" });
    expect(ate.ok && ate.periodo).toMatchObject({
      dias: 15,
      rotulo: "de 01/10 a 15/10",
      rotuloComparacao: "comparado com os 15 dias anteriores",
      anterior: { inicio: "2026-09-16", fim: "2026-09-30" },
    });
    // período que não termina hoje: sem previsão do mês
    expect(painel({ id: "personalizado", personalizado: { inicio: "2026-10-01", fim: "2026-10-15" } }).custo!.previsaoMesUsd).toBeNull();
  });
});

describe("d0 · o 'sem resposta' é lido no instante do funil, sem saber do futuro", () => {
  it("bate com a recontagem lead a lead e conta quem só volta a escrever depois de agora", () => {
    const per = periodo("90d");
    const agoraMs = AGORA.getTime();
    const { atual } = janelasDoPeriodo(per, AGORA);
    const n = numerosDaJanela(atual, diasDoIntervalo(per.inicio, per.fim), agoraMs);
    let semResposta = 0;
    let voltamDepois = 0;
    for (const dia of diasDoIntervalo(per.inicio, per.fim)) {
      for (const lead of leadsDoDia(dia)) {
        if (lead.t0 < atual.de || lead.t0 >= atual.ate || lead.t0 > agoraMs) continue;
        const alcance = Math.max(0, ...lead.movimentos.filter((m) => m.t <= agoraMs && m.para !== 5).map((m) => m.para));
        if (alcance === 4 || etapaEm(lead, agoraMs) === 5) continue;
        if (agoraMs - ultimaDoLeadAte(lead, agoraMs) <= DIAS_SEM_RESPOSTA * 86_400_000) continue;
        semResposta += 1;
        if (lead.mensagens.some((m) => m.lado === "lead" && m.t > agoraMs)) voltamDepois += 1;
      }
    }
    expect(n.funil.etapas.reduce((s, e) => s + e.semResposta, 0)).toBe(semResposta);
    expect(voltamDepois).toBeGreaterThan(0);
  });

  it("ultimaDoLeadAte ignora o que o lead escreve depois do instante", () => {
    const lead = leadsDoDia("2026-10-20").find((l) => l.mensagens.filter((m) => m.lado === "lead").length >= 2)!;
    const doLead = lead.mensagens.filter((m) => m.lado === "lead").map((m) => m.t);
    expect(ultimaDoLeadAte(lead, doLead[0]!)).toBe(lead.t0);
    expect(ultimaDoLeadAte(lead, doLead[1]! - 1)).toBe(doLead[0]);
    expect(ultimaDoLeadAte(lead, doLead[1]!)).toBe(doLead[1]);
  });
});

describe("d0 · os extras do contrato (a versão não calcula nada)", () => {
  it("'92% pela Janete', a autonomia em pontos, a queda de cada etapa, as saídas e os movimentos", () => {
    const p = painel();
    const r = p.resumo;
    expect(r.janetePctEnviadas).toBe(umaCasa((r.enviadasPorOrigem.janete / r.enviadas.atual!) * 100));
    expect(r.autonomiaPct.variacaoPp).toBe(umaCasa(r.autonomiaPct.atual! - r.autonomiaPct.anterior!));
    for (const e of p.funil.etapas) {
      if (e.tipo === "ganho") expect(e.fraseQueda).toBe("");
      else if (!e.abandonaram.total) expect(e.fraseQueda).toBe("Ninguém saiu aqui");
      else {
        expect(e.fraseQueda.startsWith(`${e.abandonaram.total} saíram aqui: `)).toBe(true);
        if (e.abandonaram.perdido) expect(e.fraseQueda).toContain(`${e.abandonaram.perdido} perdido`);
        if (e.abandonaram.semResposta) expect(e.fraseQueda).toContain(`${e.abandonaram.semResposta} sem resposta há mais de 7 dias`);
      }
    }
    const sairam = p.funil.perdidosPorOrigem.reduce((s, x) => s + x.perdido + x.semResposta, 0);
    expect(p.funil.fraseSaidas).toMatch(new RegExp(`^Saíram ${sairam} leads: \\d+ perdidos e \\d+ sem resposta há mais de 7 dias\\. A maior perda está entre `));
    const abertas = p.funil.etapas.filter((e) => e.tipo === "aberta");
    expect(p.funil.movimentos).toEqual({
      janete: abertas.reduce((s, e) => s + e.movimentos.janete, 0),
      equipe: abertas.reduce((s, e) => s + e.movimentos.equipe, 0),
    });
    expect(p.funil.movimentos.janete + p.funil.movimentos.equipe).toBe(abertas.reduce((s, e) => s + e.avancaram, 0));

    const vazio = painel({ simulacao: "periodo_vazio" });
    expect(vazio.resumo.janetePctEnviadas).toBeNull();
    expect(vazio.resumo.autonomiaPct.variacaoPp).toBeNull();
    expect(vazio.funil.fraseSaidas).toBe("Nenhum lead chegou neste período.");
    expect(vazio.funil.movimentos).toEqual({ janete: 0, equipe: 0 });
  });

  it("agora por etapa: na ordem do Kanban, até 5 leads, os há mais tempo primeiro, parados só nas abertas", () => {
    const e = estadoDe("admin");
    const p = painel();
    expect(p.agora.porEtapa.map((x) => x.etapaId)).toEqual(p.agora.kanban.map((k) => k.etapaId));
    for (const [i, x] of p.agora.porEtapa.entries()) {
      const k = p.agora.kanban[i]!;
      expect(x.leads).toHaveLength(Math.min(5, k.n));
      const desde = x.leads.map((l) => l.desdeMin);
      expect(desde).toEqual([...desde].sort((a, b) => b - a));
      expect(x.paradosMais7d).toBeLessThanOrEqual(k.n);
      if (k.tipo !== "aberta") expect(x.paradosMais7d).toBe(0);
      for (const l of x.leads) {
        const c = e.contatos.find((ct) => ct.id === l.contatoId)!;
        expect(c.etapa_id).toBe(x.etapaId);
        expect(l.desdeMin).toBe(Math.floor((AGORA.getTime() - Date.parse(c.etapa_desde ?? c.criado_em)) / 60_000));
      }
    }
    // um lead calado há 10 dias numa etapa aberta conta como parado
    const alvo = p.agora.porEtapa.find((x) => p.agora.kanban.find((k) => k.etapaId === x.etapaId)!.tipo === "aberta" && x.leads.length)!;
    const contatoId = alvo.leads[0]!.contatoId;
    const dezDias = new Date(AGORA.getTime() - 10 * 86_400_000).toISOString();
    const mexido = painel({
      mexer: (est) => ({ ...est, conversas: est.conversas.map((c) => (c.contato_id === contatoId ? { ...c, ultima_do_lead_em: dezDias } : c)) }),
    });
    expect(mexido.agora.porEtapa.find((x) => x.etapaId === alvo.etapaId)!.paradosMais7d).toBe(alvo.paradosMais7d + 1);
  });

  it("a previsão do mês usa os dias corridos com fração, e só depois de 3 dias", () => {
    // 02/11 às 08:00 em SP: 1,33 dia de mês, ainda sem previsão
    expect(painel({ agora: new Date("2026-11-02T11:00:00.000Z") }).custo!.previsaoMesUsd).toBeNull();
    // 10/11 às 14:45: 9,61 dias corridos
    const agora = new Date("2026-11-10T17:45:00.000Z");
    const d = calcularDadosPeriodo(periodo("30d", agora), agora);
    const corridos = (agora.getTime() - inicioDoDia("2026-11-01")) / 86_400_000;
    expect(painel({ agora }).custo!.previsaoMesUsd).toBeCloseTo((d.mesAteHojeMicro! / 1e6 / corridos) * 30, 6);
  });
});

describe("d0 · a formatação em pt-BR", () => {
  it("números, dinheiro, porcentagem, variação e tempo", () => {
    expect(numero(2268)).toBe("2.268");
    expect(dinheiro(47.391)).toBe("US$ 47,39");
    expect(dinheiro(51.4, { casas: 0 })).toBe("US$ 51");
    expect(porcentagem(84.2)).toBe("84%");
    expect(porcentagem(2.43)).toBe("2,4%");
    expect(variacao(7.04)).toBe("+7%");
    expect(variacao(-12.3)).toBe("−12%");
    expect(variacao(null)).toBe("");
    expect(duracaoCurta(42)).toBe("42 s");
    expect(duracaoCurta(65)).toBe("1 min 5 s");
    expect(duracaoCurta(3 * 3600)).toBe("3 h");
    expect(duracaoCurta(2 * 86400)).toBe("2 dias");
    expect(haQuanto(40)).toBe("há 40 s");
    expect(haQuanto(12 * 60 + 5)).toBe("há 12 min");
    expect(variacaoPontos(1)).toBe("+1 ponto");
    expect(variacaoPontos(1.46)).toBe("+1,5 ponto");
    expect(variacaoPontos(-2.46)).toBe("−2,5 pontos");
    expect(variacaoPontos(0.02)).toBe("0 ponto");
    expect(variacaoPontos(null)).toBe("");
  });

  it("variacaoDe escolhe os pontos nas porcentagens e a relativa no resto", () => {
    const relativa = { atual: 214, anterior: 200, variacaoPct: 7, sentido: "melhor" as const };
    expect(variacaoDe(relativa)).toBe("+7%");
    expect(variacaoDe({ ...relativa, variacaoPct: null })).toBe("");
    const pontos = { atual: 79.2, anterior: 78.2, variacaoPct: 1.3, variacaoPp: 1, sentido: "melhor" as const };
    expect(variacaoDe(pontos)).toBe("+1 ponto");
    expect(variacaoDe({ ...pontos, variacaoPp: null })).toBe("");
    const p = painel();
    expect(variacaoDe(p.resumo.autonomiaPct)).toBe(variacaoPontos(p.resumo.autonomiaPct.variacaoPp));
    expect(variacaoDe(p.resumo.conversas)).toBe(variacao(p.resumo.conversas.variacaoPct));
  });
});
