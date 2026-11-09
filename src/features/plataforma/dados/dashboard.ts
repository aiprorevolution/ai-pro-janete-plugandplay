import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";

import { useExemplo } from "../exemplo/ProvedorExemplo";
import type { EstadoExemplo, MotivoHumano } from "../exemplo/tipos";
import { CHAVES } from "./chaves";
import type { ClienteFirebase } from "./colunas";
import { paraLeitura } from "./leitura";
import { RELER_SEM_TEMPO_REAL_MS, opcoesConfiguracao, repetirSoFalha } from "./leituras";
import { useClienteDados } from "./ProvedorDados";
import type { ConfiguracaoDados, Leitura } from "./tipos";

// As leituras do Dashboard (spec de ligar as telas ao banco, 2.3 "Novas, em 32-dashboard.sql", e a
// task C4). O banco conta e agrega (drizzle/migrations/0008_janete_ligacao_dashboard.sql); a área
// (dashboard/dados/montar.ts) monta as Tendencia, as frases e a Saúde. Aqui ficam só as chamadas,
// a leitura segura do JSON que volta e as chaves do React Query (CHAVES.dashboardPeriodo e
// CHAVES.dashboard).
//
// Uma passada do período chama, de uma vez (Promise.all):
//   dashboard_periodo e dashboard_funil  do atual (p_estado_em = agora) e do anterior "na mesma
//                                        idade" (a janela deslocada e p_estado_em = agora − dias;
//                                        no "Hoje", ontem até a mesma hora);
//   dashboard_custo (só o admin)         do atual, do anterior e do mês até agora (a previsão, só
//                                        quando o período termina hoje);
//   dashboard_problemas                  do atual;
//   dashboard_periodo de ontem 00:00 até agora (só o `conversas`, a linha embaixo da saudação).
// O "agora" (dashboard_agora) é outra leitura: trocar o período não o relê.
// As duas releem quando a janela volta ao foco e a cada 60 s. O tempo real invalida só a raiz
// "dashboard" (o "agora"); o período fica em "dashboard-periodo", fora dele.

/* ---------- os formatos que o banco devolve (as chaves em camelCase, como tipos.ts) ---------- */

export interface PontoBanco {
  dia: string;
  valor: number;
}

/** dashboard_periodo: os números de uma janela. Os campos de custo vêm nulos para quem não é admin. */
export interface PeriodoBanco {
  conversas: number;
  leadsNovos: number;
  recebidas: number;
  enviadas: number;
  enviadasPorOrigem: { janete: number; humano_tela: number; humano_celular: number };
  primeiraRespostaS: number | null;
  respostaJaneteS: number | null;
  respostaJaneteP90S: number | null;
  conversasAutonomas: number;
  autonomiaPct: number | null;
  passados: { janetePassou: number; falha: number; porMotivo: Partial<Record<MotivoHumano, number>> };
  series: {
    conversas: PontoBanco[];
    recebidas: PontoBanco[];
    enviadas: PontoBanco[];
    respostaJaneteS: PontoBanco[];
    /** Nulo para quem não é admin. */
    custoUsd: PontoBanco[] | null;
  };
}

export interface EtapaFunilBanco {
  etapaId: string;
  nome: string;
  ordem: number;
  tipo: "aberta" | "ganho";
  janetePodeMover: boolean;
  chegaram: number;
  avancaram: number;
  aindaEstao: number;
  abandonaram: { total: number; perdido: number; semResposta: number };
  tempoMedianoH: number | null;
  /** Nulo para quem não é admin. */
  custoUsd: number | null;
  mensagens: { recebidas: number; enviadas: number };
  movimentos: { janete: number; equipe: number };
  passadosParaEquipe: number;
  entradasPorDia: PontoBanco[];
}

/** dashboard_funil: o funil da coorte, lido como estava em p_estado_em. */
export interface FunilBanco {
  leadsNovos: number;
  ganhos: number;
  cicloMedianoDias: number | null;
  etapas: EtapaFunilBanco[];
}

/** dashboard_custo (só o admin), em US$. */
export interface CustoBanco {
  total: number;
  /** `fala` é a voz da ElevenLabs; a chave ausente (banco de antes da migration) vira 0. */
  porTipo: { resposta: number; transcricao: number; onboarding: number; fala: number };
  semPreco: number;
  porModelo: { provedor: string; modelo: string; usd: number }[];
  conversasComJanete: number;
  porConversaUsd: number | null;
  foraDaCoorteUsd: number;
}

/** Um item de dashboard_problemas (o título, a causa e a ação, a área monta). */
export interface ProblemaBanco {
  id: string;
  tipo: "falha_ia" | "envio" | "midia" | "conexao";
  /** A 1ª falha (ISO). */
  quando: string;
  /** A última falha; na conexão, quando voltou (nulo se ainda não voltou). */
  fim: string | null;
  durMin: number;
  /** Só em falha_ia. */
  motivo: MotivoHumano | null;
  quantidade: number;
  conversasAfetadas: number;
}

export interface ContatoAgoraBanco {
  contatoId: string;
  nome: string | null;
  nomeWhatsapp: string | null;
  telefone: string | null;
}

/** dashboard_agora: a foto de agora (a Saúde, a área monta com a conexão, as chaves, o Contexto e a configuração). */
export interface AgoraBanco {
  aguardando: {
    total: number;
    maisAntigaDesde: string | null;
    itens: (ContatoAgoraBanco & { conversaId: string; motivo: MotivoHumano | null; aguardandoDesde: string | null })[];
  };
  naoLidas: { conversas: number; mensagens: number };
  comQuem: { janete: number; membros: { membroId: string; nome: string; n: number }[]; celular: number };
  janeteAtiva: { conversas: number; digitando: ContatoAgoraBanco | null };
  kanban: { etapaId: string; nome: string; tipo: "aberta" | "ganho" | "perdido"; n: number }[];
  esfriando: number;
  porEtapa: {
    etapaId: string;
    paradosMais7d: number;
    leads: (ContatoAgoraBanco & { conversaId: string | null; etapaDesde: string | null })[];
  }[];
  ultimaRecebidaEm: string | null;
  ultimaDaJaneteEm: string | null;
}

/* ---------- a leitura segura do JSON ---------- */

/** O JSON que voltou não tem a forma esperada (vira `falha` no traduzirErro, com este texto no detalhe). */
export class FormatoInesperado extends Error {
  constructor(onde: string) {
    super(`dashboard: formato inesperado em ${onde}`);
    this.name = "FormatoInesperado";
  }
}

type Obj = Record<string, unknown>;

function obj(v: unknown, onde: string): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new FormatoInesperado(onde);
  return v as Obj;
}

/** Um objeto opcional: ausente ou nulo vira `{}` (os números dentro dele caem para 0 ou nulo). */
function objOuVazio(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Um número (o jsonb manda numeric e bigint como número; por garantia, aceita texto numérico). Senão, nulo. */
function numOuNulo(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Um número que é contagem ou soma: ausente vira 0. */
function num(v: unknown): number {
  return numOuNulo(v) ?? 0;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function pontos(v: unknown): PontoBanco[] {
  return lista(v).map((p) => {
    const o = objOuVazio(p);
    return { dia: texto(o["dia"]), valor: num(o["valor"]) };
  });
}

function porMotivo(v: unknown): Partial<Record<MotivoHumano, number>> {
  const saida: Partial<Record<MotivoHumano, number>> = {};
  for (const [motivo, n] of Object.entries(objOuVazio(v))) saida[motivo as MotivoHumano] = num(n);
  return saida;
}

function contatoAgora(o: Obj): ContatoAgoraBanco {
  return {
    contatoId: texto(o["contatoId"]),
    nome: textoOuNulo(o["nome"]),
    nomeWhatsapp: textoOuNulo(o["nomeWhatsapp"]),
    telefone: textoOuNulo(o["telefone"]),
  };
}

export function lerPeriodoBanco(json: unknown): PeriodoBanco {
  const o = obj(json, "dashboard_periodo");
  const origem = objOuVazio(o["enviadasPorOrigem"]);
  const passados = objOuVazio(o["passados"]);
  const series = objOuVazio(o["series"]);
  return {
    conversas: num(o["conversas"]),
    leadsNovos: num(o["leadsNovos"]),
    recebidas: num(o["recebidas"]),
    enviadas: num(o["enviadas"]),
    enviadasPorOrigem: { janete: num(origem["janete"]), humano_tela: num(origem["humano_tela"]), humano_celular: num(origem["humano_celular"]) },
    primeiraRespostaS: numOuNulo(o["primeiraRespostaS"]),
    respostaJaneteS: numOuNulo(o["respostaJaneteS"]),
    respostaJaneteP90S: numOuNulo(o["respostaJaneteP90S"]),
    conversasAutonomas: num(o["conversasAutonomas"]),
    autonomiaPct: numOuNulo(o["autonomiaPct"]),
    passados: { janetePassou: num(passados["janetePassou"]), falha: num(passados["falha"]), porMotivo: porMotivo(passados["porMotivo"]) },
    series: {
      conversas: pontos(series["conversas"]),
      recebidas: pontos(series["recebidas"]),
      enviadas: pontos(series["enviadas"]),
      respostaJaneteS: pontos(series["respostaJaneteS"]),
      custoUsd: Array.isArray(series["custoUsd"]) ? pontos(series["custoUsd"]) : null,
    },
  };
}

export function lerFunilBanco(json: unknown): FunilBanco {
  const o = obj(json, "dashboard_funil");
  return {
    leadsNovos: num(o["leadsNovos"]),
    ganhos: num(o["ganhos"]),
    cicloMedianoDias: numOuNulo(o["cicloMedianoDias"]),
    etapas: lista(o["etapas"]).map((x) => {
      const e = objOuVazio(x);
      const ab = objOuVazio(e["abandonaram"]);
      const msg = objOuVazio(e["mensagens"]);
      const mov = objOuVazio(e["movimentos"]);
      return {
        etapaId: texto(e["etapaId"]),
        nome: texto(e["nome"]),
        ordem: num(e["ordem"]),
        tipo: e["tipo"] === "ganho" ? "ganho" : "aberta",
        janetePodeMover: e["janetePodeMover"] === true,
        chegaram: num(e["chegaram"]),
        avancaram: num(e["avancaram"]),
        aindaEstao: num(e["aindaEstao"]),
        abandonaram: { total: num(ab["total"]), perdido: num(ab["perdido"]), semResposta: num(ab["semResposta"]) },
        tempoMedianoH: numOuNulo(e["tempoMedianoH"]),
        custoUsd: numOuNulo(e["custoUsd"]),
        mensagens: { recebidas: num(msg["recebidas"]), enviadas: num(msg["enviadas"]) },
        movimentos: { janete: num(mov["janete"]), equipe: num(mov["equipe"]) },
        passadosParaEquipe: num(e["passadosParaEquipe"]),
        entradasPorDia: pontos(e["entradasPorDia"]),
      } satisfies EtapaFunilBanco;
    }),
  };
}

export function lerCustoBanco(json: unknown): CustoBanco {
  const o = obj(json, "dashboard_custo");
  const tipo = objOuVazio(o["porTipo"]);
  return {
    total: num(o["total"]),
    porTipo: { resposta: num(tipo["resposta"]), transcricao: num(tipo["transcricao"]), onboarding: num(tipo["onboarding"]), fala: num(tipo["fala"]) },
    semPreco: num(o["semPreco"]),
    porModelo: lista(o["porModelo"]).map((x) => {
      const m = objOuVazio(x);
      return { provedor: texto(m["provedor"]), modelo: texto(m["modelo"]), usd: num(m["usd"]) };
    }),
    conversasComJanete: num(o["conversasComJanete"]),
    porConversaUsd: numOuNulo(o["porConversaUsd"]),
    foraDaCoorteUsd: num(o["foraDaCoorteUsd"]),
  };
}

const TIPOS_PROBLEMA: readonly ProblemaBanco["tipo"][] = ["falha_ia", "envio", "midia", "conexao"];

export function lerProblemasBanco(json: unknown): ProblemaBanco[] {
  if (!Array.isArray(json)) throw new FormatoInesperado("dashboard_problemas");
  const saida: ProblemaBanco[] = [];
  for (const x of json) {
    const p = objOuVazio(x);
    const tipo = p["tipo"];
    const quando = textoOuNulo(p["quando"]);
    // um tipo que a tela não conhece, ou sem data, fica de fora (não inventa um problema)
    if (!TIPOS_PROBLEMA.includes(tipo as ProblemaBanco["tipo"]) || !quando) continue;
    saida.push({
      id: texto(p["id"]),
      tipo: tipo as ProblemaBanco["tipo"],
      quando,
      fim: textoOuNulo(p["fim"]),
      durMin: num(p["durMin"]),
      motivo: textoOuNulo(p["motivo"]) as MotivoHumano | null,
      quantidade: num(p["quantidade"]),
      conversasAfetadas: num(p["conversasAfetadas"]),
    });
  }
  return saida;
}

export function lerAgoraBanco(json: unknown): AgoraBanco {
  const o = obj(json, "dashboard_agora");
  const ag = objOuVazio(o["aguardando"]);
  const nl = objOuVazio(o["naoLidas"]);
  const cq = objOuVazio(o["comQuem"]);
  const na = objOuVazio(o["janeteAtiva"]);
  const digitando = na["digitando"];
  return {
    aguardando: {
      total: num(ag["total"]),
      maisAntigaDesde: textoOuNulo(ag["maisAntigaDesde"]),
      itens: lista(ag["itens"]).map((x) => {
        const i = objOuVazio(x);
        return {
          ...contatoAgora(i),
          conversaId: texto(i["conversaId"]),
          motivo: textoOuNulo(i["motivo"]) as MotivoHumano | null,
          aguardandoDesde: textoOuNulo(i["aguardandoDesde"]),
        };
      }),
    },
    naoLidas: { conversas: num(nl["conversas"]), mensagens: num(nl["mensagens"]) },
    comQuem: {
      janete: num(cq["janete"]),
      membros: lista(cq["membros"]).map((x) => {
        const m = objOuVazio(x);
        return { membroId: texto(m["membroId"]), nome: texto(m["nome"]), n: num(m["n"]) };
      }),
      celular: num(cq["celular"]),
    },
    janeteAtiva: {
      conversas: num(na["conversas"]),
      digitando: digitando && typeof digitando === "object" && !Array.isArray(digitando) ? contatoAgora(digitando as Obj) : null,
    },
    kanban: lista(o["kanban"]).map((x) => {
      const k = objOuVazio(x);
      const tipo = k["tipo"] === "ganho" || k["tipo"] === "perdido" ? k["tipo"] : "aberta";
      return { etapaId: texto(k["etapaId"]), nome: texto(k["nome"]), tipo, n: num(k["n"]) };
    }),
    esfriando: num(o["esfriando"]),
    porEtapa: lista(o["porEtapa"]).map((x) => {
      const e = objOuVazio(x);
      return {
        etapaId: texto(e["etapaId"]),
        paradosMais7d: num(e["paradosMais7d"]),
        leads: lista(e["leads"]).map((y) => {
          const l = objOuVazio(y);
          return { ...contatoAgora(l), conversaId: textoOuNulo(l["conversaId"]), etapaDesde: textoOuNulo(l["etapaDesde"]) };
        }),
      };
    }),
    ultimaRecebidaEm: textoOuNulo(o["ultimaRecebidaEm"]),
    ultimaDaJaneteEm: textoOuNulo(o["ultimaDaJaneteEm"]),
  };
}

/* ---------- as janelas e a passada do período ---------- */

/** Uma janela de instantes, em ms: [de, ate). */
export interface JanelaMs {
  de: number;
  ate: number;
}

/**
 * As janelas de uma passada, calculadas na hora da busca (a área passa a função, com o relógio dela):
 * o atual (lido como está agora), o anterior (lido como estava em `estadoAnterior`), ontem 00:00 até
 * agora e o mês até agora (nulo quando o período não termina hoje).
 */
export interface JanelasDashboard {
  agora: number;
  atual: JanelaMs;
  anterior: JanelaMs;
  estadoAnterior: number;
  ontem: JanelaMs;
  mes: JanelaMs | null;
}

export interface JanelaLida {
  periodo: PeriodoBanco;
  funil: FunilBanco;
  /** Nulo para quem não é admin. */
  custo: CustoBanco | null;
}

/** O resultado de uma passada do período. `contexto` é o que a área passou (o período da tela). */
export interface DashboardPeriodoBanco<C> {
  contexto: C;
  /** Quando a passada começou (ms). */
  calculadoEm: number;
  atual: JanelaLida;
  anterior: JanelaLida;
  problemas: ProblemaBanco[];
  /** Conversas de ontem 00:00 até agora. */
  desdeOntem: number;
  /** O custo do mês até agora (só o admin, só quando o período termina hoje); senão, nulo. */
  mesAteHojeUsd: number | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** O que o PostgREST devolve: o dado, ou o erro cru (quem mostra passa por traduzirErro). */
function dadoOuErro({ data, error }: { data: unknown; error: unknown }): unknown {
  if (error) throw error;
  return data;
}

function argsPeriodo(j: JanelaMs, estadoEm: number) {
  return { p_de: iso(j.de), p_ate: iso(j.ate), p_estado_em: iso(estadoEm) };
}

const rpcPeriodo = async (cliente: ClienteFirebase, j: JanelaMs, estadoEm: number) =>
  lerPeriodoBanco(dadoOuErro(await cliente.rpc("dashboard_periodo", argsPeriodo(j, estadoEm))));
const rpcFunil = async (cliente: ClienteFirebase, j: JanelaMs, estadoEm: number) =>
  lerFunilBanco(dadoOuErro(await cliente.rpc("dashboard_funil", argsPeriodo(j, estadoEm))));
const rpcCusto = async (cliente: ClienteFirebase, j: JanelaMs) =>
  lerCustoBanco(dadoOuErro(await cliente.rpc("dashboard_custo", { p_de: iso(j.de), p_ate: iso(j.ate) })));
const rpcProblemas = async (cliente: ClienteFirebase, j: JanelaMs) =>
  lerProblemasBanco(dadoOuErro(await cliente.rpc("dashboard_problemas", { p_de: iso(j.de), p_ate: iso(j.ate) })));

/** Uma passada do período (as chamadas em paralelo). Lança o erro cru da 1ª que falhar. */
export async function buscarDashboardPeriodo<C>(
  cliente: ClienteFirebase,
  janelas: JanelasDashboard,
  admin: boolean,
  contexto: C,
): Promise<DashboardPeriodoBanco<C>> {
  const { agora, atual, anterior, estadoAnterior, ontem, mes } = janelas;
  // o atendente não pergunta o custo (a função recusa com sem_acesso)
  const custo = (j: JanelaMs) => (admin ? rpcCusto(cliente, j) : Promise.resolve(null));
  const [pAtual, fAtual, cAtual, pAnterior, fAnterior, cAnterior, problemas, pOntem, cMes] = await Promise.all([
    rpcPeriodo(cliente, atual, agora),
    rpcFunil(cliente, atual, agora),
    custo(atual),
    rpcPeriodo(cliente, anterior, estadoAnterior),
    rpcFunil(cliente, anterior, estadoAnterior),
    custo(anterior),
    rpcProblemas(cliente, atual),
    rpcPeriodo(cliente, ontem, agora),
    mes ? custo(mes) : Promise.resolve(null),
  ]);
  return {
    contexto,
    calculadoEm: agora,
    atual: { periodo: pAtual, funil: fAtual, custo: cAtual },
    anterior: { periodo: pAnterior, funil: fAnterior, custo: cAnterior },
    problemas,
    desdeOntem: pOntem.conversas,
    mesAteHojeUsd: cMes ? cMes.total : null,
  };
}

/** Por quanto tempo a passada vale antes de outra tela que monte relê-la (os 60 s e o foco releem antes). */
const VALE_MS = 30_000;

/**
 * A passada do período. `chave` identifica o período na tela (o id e os dias); as janelas são
 * calculadas na hora de cada busca, então a releitura de 60 s anda com o relógio sem trocar de chave.
 * Ao trocar de período, os números de antes ficam na tela (placeholderData) até os novos chegarem.
 * Fica embaixo de CHAVES.dashboardPeriodo, fora do tempo real: cada aviso refaria as 6 a 9 chamadas
 * (e cancelaria a passada em andamento). Relê a cada 60 s e no foco.
 */
export function opcoesDashboardPeriodo<C>(
  cliente: ClienteFirebase,
  entrada: { chave: readonly (string | number)[]; admin: boolean; janelas: () => JanelasDashboard; contexto: C },
) {
  const { chave, admin, janelas, contexto } = entrada;
  return queryOptions({
    queryKey: [...CHAVES.dashboardPeriodo, admin ? "admin" : "atendente", ...chave] as const,
    queryFn: () => buscarDashboardPeriodo(cliente, janelas(), admin, contexto),
    staleTime: VALE_MS,
    retry: repetirSoFalha,
    placeholderData: keepPreviousData,
    refetchInterval: RELER_SEM_TEMPO_REAL_MS,
    refetchOnWindowFocus: "always",
  });
}

export function opcoesDashboardAgora(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.dashboard, "agora"] as const,
    queryFn: async () => lerAgoraBanco(dadoOuErro(await cliente.rpc("dashboard_agora"))),
    staleTime: VALE_MS,
    retry: repetirSoFalha,
    refetchInterval: RELER_SEM_TEMPO_REAL_MS,
    refetchOnWindowFocus: "always",
  });
}

/**
 * A configuração lida pelo Dashboard (o onboarding e o `worker_visto_em` da Saúde): a mesma leitura
 * comum (mesma chave e mesmo cache), relida a cada 60 s e no foco. A tabela `configuracao` não está
 * no tempo real: sem a releitura, o valor da abertura envelheceria na tela (o motor, em
 * dados/motor.ts, é relido do mesmo jeito).
 */
export function opcoesConfiguracaoDashboard(cliente: ClienteFirebase) {
  return queryOptions({
    ...opcoesConfiguracao(cliente),
    refetchInterval: RELER_SEM_TEMPO_REAL_MS,
    refetchOnWindowFocus: "always",
  });
}

/** A leitura do período, com o "atualizando": os números na tela são os do período de antes. */
export interface LeituraPeriodoDashboard<C> extends Leitura<DashboardPeriodoBanco<C>> {
  atualizando: boolean;
}

/** A leitura da configuração, com a hora (ms, relógio do navegador) em que o dado na tela chegou. */
export interface LeituraConfiguracaoDashboard extends Leitura<ConfiguracaoDados> {
  /** 0 enquanto nada chegou. */
  chegouEm: number;
}

/** As leituras do Dashboard no modo banco. Só dentro do `<ProvedorDados fonte="banco">`. */
export function useDashboardBanco<C>(entrada: {
  chave: readonly (string | number)[];
  admin: boolean;
  janelas: () => JanelasDashboard;
  contexto: C;
}): { periodo: LeituraPeriodoDashboard<C>; agora: Leitura<AgoraBanco>; configuracao: LeituraConfiguracaoDashboard } {
  const cliente = useClienteDados();
  if (!cliente) throw new Error("useDashboardBanco() é do modo banco: precisa do <ProvedorDados fonte=\"banco\"> em volta.");
  const qPeriodo = useQuery(opcoesDashboardPeriodo(cliente, entrada));
  const qAgora = useQuery(opcoesDashboardAgora(cliente));
  const qConfiguracao = useQuery(opcoesConfiguracaoDashboard(cliente));
  return {
    periodo: { ...paraLeitura(qPeriodo), atualizando: qPeriodo.isPlaceholderData },
    agora: paraLeitura(qAgora),
    configuracao: { ...paraLeitura(qConfiguracao), chegouEm: qConfiguracao.dataUpdatedAt },
  };
}

/* ---------- o modo exemplo ---------- */

/**
 * O estado em memória do exemplo (os testes e o modo exemplo): o gerador do Dashboard e o "agora"
 * calculado em cima dele. Só fora do modo banco.
 */
export function useEstadoEmMemoria(): EstadoExemplo {
  return useExemplo().estado;
}
