import { MOTIVO_CURTO, nomeDoContato } from "../../comum/LinhaConversa";
import { diaLocal, horaCurta, segundosDesde, type Instante } from "../../comum/tempo";
import { lerCerebro, lerEscuta, lerMotor, lerWhats } from "../../configuracao/leitura";
import type { AgoraBanco, ContatoAgoraBanco, DashboardPeriodoBanco, JanelaLida, JanelasDashboard, PontoBanco, ProblemaBanco } from "../../dados/dashboard";
import type { ConfiguracaoDados, PendenciasMotor, VersaoContextoBanco } from "../../dados/tipos";
import {
  estaAguardando,
  estaEsfriando,
  etapasVisiveis,
  nomeDoMembro,
  janeteAtivaAgora,
  seloDaConversa,
  type ChaveIA,
  type Conexao,
  type Conversa,
  type EstadoExemplo,
  type MotivoHumano,
} from "../../exemplo";
import { contagem, dias as diasTexto, numero, porcentagem, tempoEtapa, haQuanto } from "./formatar";
import {
  DIAS_SEM_RESPOSTA,
  ETAPAS_GERADOR,
  MODELO_FALA,
  MODELO_RESPOSTA,
  MODELO_TRANSCRICAO,
  conversasNaJanela,
  custoNaJanelaMicro,
  numerosDaJanela,
  type EtapaNumeros,
  type NumerosJanela,
} from "./gerador";
import {
  diasDoIntervalo,
  diasDoMes,
  inicioDoDia,
  janelasDoPeriodo,
  primeiroDoMes,
  somarDias,
  type Janela,
} from "./periodo";
import type {
  Agora,
  ContextoPainel,
  CustoPeriodo,
  EtapaFunil,
  Funil,
  ItemSaude,
  PainelDashboard,
  Periodo,
  PontoDia,
  ProblemaPeriodo,
  ResumoPeriodo,
  Sentido,
  Simulacao,
  Tendencia,
} from "./tipos";

// montarPainel (docs/spec-dashboard.md, seções 3, 4 e 10): junta o período, o "agora", o papel e os
// textos. Duas entradas, a mesma montagem:
// - `montarPainel` (o modo exemplo e os testes): o período vem do gerador e o "agora" do estado de
//   exemplo do Chat e do Kanban, com as simulações;
// - `montarPainelBanco` (spec de ligar as telas ao banco, task C4): o período e o "agora" vêm das
//   funções dashboard_* (dados/dashboard.ts), e a Saúde da conexão, das chaves, do Contexto atual e
//   da configuração e do motor (motor_pendencias, spec-motor-acordado).
// Puro: recebe o "agora" por parâmetro.

const MIN_MS = 60_000;
const HORA_MS = 3_600_000;
const DIA_MS = 86_400_000;

/** O "Contexto" do modo exemplo: valor de exemplo constante da fundação (spec 5.3.3, item 5). */
export const CONTEXTO_EXEMPLO = { preenchidos: 6, total: 8, versao: 6 } as const;

/** Simulação "chave sem crédito": a Janete parou há 17 min e 4 conversas ficaram paradas (spec 15). */
const SIM_CHAVE = { parouHaMin: 17, conversas: 4, intervaloMin: 3 } as const;
/** Simulação "WhatsApp caiu": caiu há 1 h 58 min; a última mensagem recebida foi 5 min antes ("há 2 h"). */
const SIM_WHATS = { caiuHaMin: 118, ultimaAntesMin: 5 } as const;

/* ---------- os números do período ---------- */

/** Uma etapa do funil: a definição (a ordem é a de `atual.funil.etapas`). */
export interface DefEtapaFunil {
  id: string;
  nome: string;
  ordem: number;
  tipo: "aberta" | "ganho";
  janetePodeMover: boolean;
}

export interface DadosPeriodo {
  atual: NumerosJanela;
  anterior: NumerosJanela;
  /** Conversas de ontem 00:00 (São Paulo) até agora: a linha de resumo. */
  desdeOntem: number;
  /** Custo (micro-dólares) do mês até agora, quando o período termina hoje; senão `null`. */
  mesAteHojeMicro: number | null;
  /**
   * As etapas do funil, na ordem de `atual.funil.etapas` (o banco manda). Sem elas (o gerador), as do
   * gerador com o nome, a ordem e o "a Janete pode mover" do estado de exemplo.
   */
  etapasFunil?: readonly DefEtapaFunil[] | undefined;
  /** O custo por modelo (o banco manda). Sem ele (o gerador), os dois modelos do gerador. */
  porModelo?: CustoPeriodo["porModelo"] | undefined;
}

/** Os números do período e do anterior. É a parte pesada: o provedor guarda separada do "agora". */
export function calcularDadosPeriodo(periodo: Periodo, agora: Instante): DadosPeriodo {
  const agoraMs = paraMs(agora);
  const hoje = diaLocal(agoraMs);
  const { atual, anterior } = janelasDoPeriodo(periodo, agoraMs);
  const janelaOntem: Janela = { de: inicioDoDia(somarDias(hoje, -1)), ate: agoraMs + 1 };
  return {
    atual: numerosDaJanela(atual, diasDoIntervalo(periodo.inicio, periodo.fim), agoraMs),
    // o funil do anterior é lido como estava `dias` atrás: coortes da mesma idade (senão o anterior
    // sempre teria mais vendas, só por ter tido mais tempo para fechar)
    anterior: numerosDaJanela(
      anterior,
      diasDoIntervalo(periodo.anterior.inicio, periodo.anterior.fim),
      agoraMs,
      agoraMs - periodo.dias * 86_400_000,
    ),
    desdeOntem: conversasNaJanela(janelaOntem, agoraMs),
    mesAteHojeMicro:
      periodo.fim === hoje ? custoNaJanelaMicro({ de: inicioDoDia(primeiroDoMes(hoje)), ate: agoraMs + 1 }, agoraMs) : null,
  };
}

/* ---------- a entrada ---------- */

export interface EntradaPainel {
  /** O estado de exemplo (o estado em memória), já restrito pelo papel. */
  estado: EstadoExemplo;
  papel: "admin" | "atendente";
  /** O nome da conta (para a saudação); vazio = só "Bom dia". */
  nomeConta: string;
  agora: Instante;
  periodo: Periodo;
  simulacao: Simulacao;
  carregando: boolean;
  /** Os números do período já calculados (o provedor guarda); sem eles, calcula aqui. */
  dados?: DadosPeriodo | undefined;
}

/* ---------- a situação de agora (o que parou) ---------- */

interface ProblemaIA {
  /** Quando parou; `null` quando não se sabe (a chave removida sem registro na auditoria). */
  parouEm: number | null;
  motivo: "sem_credito" | "invalida" | "removida";
}

interface Situacao {
  ia: ProblemaIA | null;
  whatsCaiu: { caiuEm: number | null } | null;
  /**
   * O trabalho da Janete espera há mais de 3 min (só no banco): `desde` é o `atrasado_desde` do motor.
   * `onboarding` = a Janete está parada de propósito até o admin concluir o onboarding (decisão 2), e
   * não atrasada.
   */
  motorParado: { desde: number | null; onboarding?: boolean } | null;
  /** O motor nunca rodou e não há nada para fazer: uma cópia nova antes da 1ª mensagem (não é aviso). */
  motorAguardando?: boolean;
  /** No banco, sem uma leitura válida do motor: a tela não afirma que a fila está em dia. */
  motorSemLeitura?: boolean;
  /** A última mensagem recebida (ms), ou `null` se nenhuma. */
  ultimaRecebida: number | null;
  /** A última resposta da Janete (ms), ou `null` se nenhuma. */
  ultimaJanete: number | null;
}

/**
 * Os motivos da chave da IA: só eles param a Janete toda. As outras falhas (como o `envio_falhou`, a
 * bolha da Janete que não saiu) param só aquela conversa: ela espera com o selo de falha, e a Janete segue.
 */
const MOTIVOS_DE_CHAVE: readonly MotivoHumano[] = ["chave_invalida", "sem_credito"];

/**
 * A Janete parada: a IA, o WhatsApp ou o onboarding aberto. O atraso do motor não conta (decisão do
 * equipe em 03/11/2026, "atrasada"): ela segue respondendo as outras conversas, só que com demora.
 */
const estaParada = (sit: Situacao) => !!sit.ia || !!sit.whatsCaiu || !!sit.motorParado?.onboarding;

/** Só o atraso do motor, sem a IA nem o WhatsApp parados: a Janete está atrasada, e não parada. */
const soAtrasada = (sit: Situacao) =>
  !!sit.motorParado && !sit.motorParado.onboarding && !sit.ia && !sit.whatsCaiu;

function paraMsOuNulo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** O problema da chave de resposta, para quem lê a chave (o admin). */
function problemaDaChave(chaves: readonly ChaveIA[], agoraMs: number, removidaEm: () => number | null): ProblemaIA | null {
  const chave = chaves.find((k) => k.finalidade === "resposta") ?? null;
  if (!chave) return { parouEm: removidaEm(), motivo: "removida" };
  if (chave.status === "ativa") return null;
  const t = Date.parse(chave.atualizada_em ?? "");
  return {
    parouEm: Number.isFinite(t) ? t : agoraMs,
    motivo: chave.status === "sem_credito" ? "sem_credito" : chave.status === "invalida" ? "invalida" : "removida",
  };
}

/** A atendente não lê a chave: a Janete parou se há conversa parada pela chave depois da última resposta dela. */
function problemaPelasConversas(paradasDesde: readonly (string | null)[], ultimaJanete: number | null): ProblemaIA | null {
  const depois = paradasDesde
    .map((d) => Date.parse(d ?? ""))
    .filter((t) => Number.isFinite(t) && t > (ultimaJanete ?? 0));
  return depois.length ? { parouEm: Math.min(...depois), motivo: "sem_credito" } : null;
}

/** O WhatsApp caiu (não conectado e não conectando). */
function quedaDoWhats(conexao: Conexao | null, admin: boolean): Situacao["whatsCaiu"] {
  const w = lerWhats(conexao, admin);
  if (w.ok || w.conectando) return null;
  return { caiuEm: conexao ? paraMsOuNulo(conexao.atualizado_em) : null };
}

/* ---------- o modo exemplo: as simulações ---------- */

function ultimaMensagemMs(estado: EstadoExemplo, pred: (origem: string, direcao: string) => boolean): number | null {
  let max: number | null = null;
  for (const m of estado.mensagens) {
    if (m.status === "cancelada" || !pred(m.origem, m.direcao)) continue;
    const t = Date.parse(m.momento);
    if (Number.isFinite(t) && (max === null || t > max)) max = t;
  }
  return max;
}

/** Quando o admin removeu a chave de resposta (o último `chave_removida` da auditoria), ou `null`. */
function quandoRemoveuChave(estado: EstadoExemplo): number | null {
  let quando: number | null = null;
  for (const a of estado.auditoria) {
    if (a.acao !== "chave_removida") continue;
    const d = a.detalhe;
    const finalidade = d && typeof d === "object" && !Array.isArray(d) ? d["finalidade"] : undefined;
    if (finalidade !== undefined && finalidade !== "resposta") continue;
    const t = Date.parse(a.criado_em);
    if (Number.isFinite(t) && (quando === null || t > quando)) quando = t;
  }
  return quando;
}

function aplicarSimulacao(base: EstadoExemplo, admin: boolean, simulacao: Simulacao, agoraMs: number): { estado: EstadoExemplo; sit: Situacao } {
  let estado = base;
  let ia: ProblemaIA | null = null;
  let whatsCaiu: Situacao["whatsCaiu"] = null;
  let ultimaRecebida = ultimaMensagemMs(base, (_o, d) => d === "entrada");

  if (simulacao === "chave_sem_credito") {
    const parouEm = agoraMs - SIM_CHAVE.parouHaMin * MIN_MS;
    const abertas = new Set(base.etapas.filter((e) => e.tipo === "aberta").map((e) => e.id));
    const etapaDe = new Map(base.contatos.map((c) => [c.id, c.etapa_id]));
    const escolhidas = base.conversas
      .filter((c) => c.modo === "janete" && abertas.has(etapaDe.get(c.contato_id) ?? ""))
      .sort((a, b) => Date.parse(b.ultima_do_lead_em ?? b.criado_em) - Date.parse(a.ultima_do_lead_em ?? a.criado_em))
      .slice(0, SIM_CHAVE.conversas)
      .map((c) => c.id);
    const desde = new Map(escolhidas.map((id, k) => [id, new Date(parouEm + k * SIM_CHAVE.intervaloMin * MIN_MS).toISOString()]));
    estado = {
      ...estado,
      conversas: estado.conversas.map((c): Conversa =>
        desde.has(c.id)
          ? { ...c, modo: "humano", motivo_humano: "sem_credito", responsavel_id: null, aguardando_humano_desde: desde.get(c.id) ?? null }
          : c,
      ),
      chaves: estado.chaves.map((k) =>
        k.finalidade === "resposta" ? { ...k, status: "sem_credito", ultimo_erro: "A conta de IA ficou sem crédito." } : k,
      ),
      digitando: [],
    };
    ia = { parouEm, motivo: "sem_credito" };
  }

  if (simulacao === "whatsapp_caiu") {
    const caiuEm = agoraMs - SIM_WHATS.caiuHaMin * MIN_MS;
    if (estado.conexao) estado = { ...estado, conexao: { ...estado.conexao, status: "desconectada", ultimo_erro: null } };
    estado = { ...estado, digitando: [] };
    whatsCaiu = { caiuEm };
    ultimaRecebida = caiuEm - SIM_WHATS.ultimaAntesMin * MIN_MS;
  }

  // sem simulação: o problema que o próprio exemplo tem (a Configuração trocou a chave ou a conexão)
  if (!ia) {
    if (admin) ia = problemaDaChave(estado.chaves, agoraMs, () => quandoRemoveuChave(estado));
    else {
      const ultimaJanete = ultimaMensagemMs(estado, (o) => o === "janete");
      const paradas = estado.conversas
        .filter((c) => estaAguardando(c) && c.motivo_humano && MOTIVOS_DE_CHAVE.includes(c.motivo_humano))
        .map((c) => c.aguardando_humano_desde);
      ia = problemaPelasConversas(paradas, ultimaJanete);
    }
  }
  if (!whatsCaiu) whatsCaiu = quedaDoWhats(estado.conexao, admin);
  if (ia || whatsCaiu) estado = estado.digitando.length ? { ...estado, digitando: [] } : estado;
  return {
    estado,
    sit: { ia, whatsCaiu, motorParado: null, ultimaRecebida, ultimaJanete: ultimaMensagemMs(estado, (o) => o === "janete") },
  };
}

/* ---------- o "agora" ---------- */

const FRASE_CHAVE: Record<ProblemaIA["motivo"], string> = {
  sem_credito: "a chave da IA ficou sem crédito",
  invalida: "a chave da IA foi recusada pelo provedor",
  removida: "a chave da IA foi removida",
};

type AgoraSemSaude = Omit<Agora, "saude">;

/** Quem espera há mais tempo primeiro (no empate, pelo nome). */
const porEspera = (a: { esperaMin: number; nome: string }, b: { esperaMin: number; nome: string }) =>
  b.esperaMin - a.esperaMin || a.nome.localeCompare(b.nome, "pt-BR");

function agoraDoExemplo(estado: EstadoExemplo, sit: Situacao, agoraMs: number): AgoraSemSaude {
  const parada = estaParada(sit);
  const contatoDe = new Map(estado.contatos.map((c) => [c.id, c]));

  const itens: Agora["aguardando"]["itens"] = estado.conversas
    .filter((c) => estaAguardando(c))
    .map((c) => {
      const contato = contatoDe.get(c.contato_id);
      const selo = seloDaConversa(c) === "falha" ? "falha" : "aguardando";
      return {
        conversaId: c.id,
        contatoId: c.contato_id,
        nome: contato ? nomeDoContato(contato) : "Sem nome",
        motivoCurto: c.motivo_humano ? MOTIVO_CURTO[c.motivo_humano] : "Aguardando alguém",
        esperaMin: Math.floor(segundosDesde(c.aguardando_humano_desde, agoraMs) / 60),
        selo: selo as "aguardando" | "falha",
      };
    })
    .sort(porEspera);

  const naoLidas = estado.conversas.filter((c) => c.nao_lidas > 0);

  const porMembro = new Map<string, number>();
  let comJanete = 0;
  let celular = 0;
  for (const c of estado.conversas) {
    const s = seloDaConversa(c);
    if (s === "janete") comJanete += 1;
    else if (s === "celular") celular += 1;
    else if (s === "membro" && c.responsavel_id) porMembro.set(c.responsavel_id, (porMembro.get(c.responsavel_id) ?? 0) + 1);
  }
  const membros = [...porMembro.entries()]
    .map(([id, n]) => ({ nome: nomeDoMembro(estado, id), n }))
    .sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"));

  const ativas = parada ? [] : estado.conversas.filter((c) => janeteAtivaAgora(estado, c.id, new Date(agoraMs)));
  const digitandoId = parada ? undefined : estado.digitando.find((id) => estado.conversas.some((c) => c.id === id && c.modo === "janete"));
  const digitandoContato = digitandoId ? contatoDe.get(estado.conversas.find((c) => c.id === digitandoId)?.contato_id ?? "") : undefined;

  const visiveis = etapasVisiveis(estado);
  const kanban = visiveis.map((e) => ({
    etapaId: e.id,
    nome: e.nome,
    tipo: e.tipo,
    n: estado.contatos.filter((c) => c.etapa_id === e.id).length,
  }));
  const esfriando = estado.conversas.filter((c) => estaEsfriando(estado, c, new Date(agoraMs))).length;

  // por etapa: os parados há mais de 7 dias (a regra do "sem resposta" do funil) e o "Agora nesta etapa"
  const conversaDe = new Map(estado.conversas.map((c) => [c.contato_id, c]));
  const porEtapa: Agora["porEtapa"] = visiveis.map((e) => {
    const leads = estado.contatos
      .filter((c) => c.etapa_id === e.id)
      .map((c) => {
        const conversa = conversaDe.get(c.id);
        const desde = Date.parse(c.etapa_desde ?? c.criado_em);
        const ultimaDoLead = Date.parse(conversa?.ultima_do_lead_em ?? c.primeira_mensagem_em ?? c.criado_em);
        return {
          contatoId: c.id,
          conversaId: conversa?.id ?? null,
          nome: nomeDoContato(c),
          desdeMin: Number.isFinite(desde) ? Math.max(0, Math.floor((agoraMs - desde) / MIN_MS)) : 0,
          parado: e.tipo === "aberta" && Number.isFinite(ultimaDoLead) && agoraMs - ultimaDoLead > DIAS_SEM_RESPOSTA * DIA_MS,
        };
      })
      .sort((a, b) => b.desdeMin - a.desdeMin || a.nome.localeCompare(b.nome, "pt-BR"));
    return {
      etapaId: e.id,
      paradosMais7d: leads.filter((l) => l.parado).length,
      leads: leads.slice(0, 5).map((l) => ({ contatoId: l.contatoId, conversaId: l.conversaId, nome: l.nome, desdeMin: l.desdeMin })),
    };
  });

  return {
    aguardando: { total: itens.length, maisAntigaMin: itens.length ? itens[0]!.esperaMin : null, itens },
    naoLidas: { conversas: naoLidas.length, mensagens: naoLidas.reduce((s, c) => s + c.nao_lidas, 0) },
    comQuem: { janete: comJanete, membros, celular },
    janeteAtiva: { conversas: ativas.length, digitando: digitandoContato ? nomeDoContato(digitandoContato) : null },
    kanban,
    esfriando,
    porEtapa,
  };
}

interface EntradaSaude {
  sit: Situacao;
  admin: boolean;
  agoraMs: number;
  resumo: ResumoPeriodo;
  periodo: Periodo;
  /** A conexão do WhatsApp (no banco, só a ativa). */
  conexao: Conexao | null;
  /** As chaves de IA (a atendente: []). */
  chaves: readonly ChaveIA[];
  contexto: ContextoPainel;
}

const CONFIG = { rotulo: "Abrir a Configuração", para: "/app/configuracao" } as const;

function montarSaude({ sit, admin, agoraMs, resumo, periodo, conexao, chaves, contexto }: EntradaSaude): Agora["saude"] {
  const { ia, whatsCaiu, motorParado, motorAguardando, motorSemLeitura, ultimaRecebida, ultimaJanete } = sit;
  const itens: ItemSaude[] = [];

  /* 1. WhatsApp */
  const w = lerWhats(conexao, admin);
  const gateway = w.prov?.curto ?? w.prov?.nome ?? "";
  const recebida =
    ultimaRecebida === null ? "nenhuma mensagem recebida ainda" : `última mensagem recebida ${haQuanto((agoraMs - ultimaRecebida) / 1000)}`;
  const partesW = [gateway, w.numero].filter(Boolean);
  if (w.ok) {
    itens.push({ id: "whatsapp", titulo: "WhatsApp", detalhe: [...partesW, recebida].join(" · "), estado: "ok" });
  } else if (w.conectando) {
    itens.push({ id: "whatsapp", titulo: "WhatsApp", detalhe: [...partesW, "conectando"].join(" · "), estado: "atencao" });
  } else {
    const quando = whatsCaiu?.caiuEm ? ` às ${horaCurta(whatsCaiu.caiuEm)}` : "";
    const item: ItemSaude = {
      id: "whatsapp",
      titulo: "WhatsApp",
      detalhe: [...partesW, `desconectado${quando}`, recebida].join(" · "),
      estado: "parado",
    };
    if (admin) item.acao = CONFIG;
    itens.push(item);
  }

  /* 2. A Janete respondendo (o motor). O atraso vem antes: com ele, nada sai a tempo (decisão 3). */
  if (motorParado) {
    // só o atraso é atenção (a Janete segue respondendo, com demora); com a IA ou o WhatsApp parados, ou
    // o onboarding aberto, é parada
    const estado = soAtrasada(sit) ? "atencao" : "parado";
    const item: ItemSaude = { id: "motor", titulo: "A Janete respondendo", detalhe: fraseDoMotor(motorParado, agoraMs), estado };
    // com o onboarding aberto, o conserto é terminar o onboarding, e não mexer na Configuração
    if (admin && !motorParado.onboarding) item.acao = CONFIG;
    itens.push(item);
  } else if (ia) {
    itens.push({
      id: "motor",
      titulo: "A Janete respondendo",
      detalhe: admin
        ? `${ia.parouEm === null ? "Parada" : `Parada às ${horaCurta(ia.parouEm)}`} · ${FRASE_CHAVE[ia.motivo]}`
        : "Problema na IA: o admin precisa olhar",
      estado: "parado",
    });
  } else if (whatsCaiu) {
    const desde = whatsCaiu.caiuEm ? ` desde ${horaCurta(whatsCaiu.caiuEm)}` : "";
    itens.push({ id: "motor", titulo: "A Janete respondendo", detalhe: `Parada · sem receber mensagens${desde}`, estado: "parado" });
  } else if (motorAguardando) {
    itens.push({
      id: "motor",
      titulo: "A Janete respondendo",
      detalhe: FRASE_AGUARDANDO,
      estado: "ok",
    });
  } else {
    const resposta = ultimaJanete === null ? "nenhuma resposta ainda" : `última resposta ${haQuanto((agoraMs - ultimaJanete) / 1000)}`;
    // sem a leitura do motor, diz só o que sabe (a última resposta), sem afirmar a fila em dia
    itens.push({ id: "motor", titulo: "A Janete respondendo", detalhe: motorSemLeitura ? resposta : `${resposta} · fila em dia`, estado: "ok" });
  }

  /* 3 e 4. Cérebro e escuta (só o admin) */
  if (admin) {
    const c = lerCerebro({ chaves: [...chaves] }, true);
    const situacaoChave =
      c.situacao === "ativa" ? "chave ativa" : c.situacao === "sem_credito" ? "chave sem crédito" : c.situacao === "invalida" ? "chave recusada" : "sem chave";
    const cerebro: ItemSaude = {
      id: "cerebro",
      titulo: "Cérebro",
      detalhe: [c.motor?.nome ?? "", c.nomeModelo, situacaoChave].filter(Boolean).join(" · "),
      estado: c.ok ? "ok" : "parado",
    };
    if (!c.ok) cerebro.acao = CONFIG;
    itens.push(cerebro);

    // Sem chave própria de áudio, o servidor transcreve com a do cérebro, se ela for OpenAI ou
    // OpenRouter (mensageria/ia/transcrever.server.ts; decisão 10a); sem nenhuma das duas, com a
    // chave da voz (ElevenLabs; D5 da spec do uso da voz).
    const e = lerEscuta({ chaves: [...chaves] }, true);
    if (e.ok && e.viaCerebro) {
      itens.push({ id: "escuta", titulo: "Escuta de áudio", detalhe: "Ativa, usando a chave do cérebro", estado: "ok" });
    } else if (e.ok && e.viaVoz) {
      itens.push({ id: "escuta", titulo: "Escuta de áudio", detalhe: "Ativa, usando a chave da voz", estado: "ok" });
    } else if (e.ok) {
      itens.push({ id: "escuta", titulo: "Escuta de áudio", detalhe: `${e.transcritor?.nome ?? "Transcrição"} · transcrevendo os áudios`, estado: "ok" });
    } else {
      itens.push({
        id: "escuta",
        titulo: "Escuta de áudio",
        detalhe: "Não configurada · a Janete pede texto",
        estado: "atencao",
        acao: { rotulo: "Configurar", para: "/app/configuracao" },
      });
    }
  }

  /* 5. Contexto */
  const versao = contexto.versao === null ? "" : ` · versão ${contexto.versao}`;
  itens.push({
    id: "contexto",
    titulo: "Contexto",
    detalhe: `${contexto.preenchidos} de ${contexto.total} campos${versao}`,
    estado: "ok",
    acao: contexto.preenchidos < contexto.total ? { rotulo: "Completar", para: "/app/contexto" } : { rotulo: "Abrir", para: "/app/contexto" },
  });

  /* 6. Problemas no período */
  const nProb = resumo.problemas.length;
  const recente = resumo.problemas.some((p) => agoraMs - Date.parse(p.quando) < 24 * HORA_MS);
  itens.push({
    id: "problemas",
    titulo: "Problemas no período",
    detalhe: nProb ? `${contagem(nProb, "problema", "problemas")} ${periodo.rotulo}` : `Nenhum problema ${periodo.rotulo}`,
    estado: recente ? "atencao" : "ok",
  });

  const parados = itens.filter((i) => i.estado === "parado").length;
  const atencao = itens.filter((i) => i.estado === "atencao").length;
  if (parados) return { geral: "parado", frase: "A Janete parou", itens };
  // o atraso é o ponto de atenção que mais pesa: a frase diz qual é, em vez de só contar
  if (soAtrasada(sit)) return { geral: "atencao", frase: "A Janete está atrasada", itens };
  if (atencao) return { geral: "atencao", frase: atencao === 1 ? "1 ponto de atenção" : `${atencao} pontos de atenção`, itens };
  return { geral: "ok", frase: "Tudo funcionando", itens };
}

/** Uma cópia nova, antes da 1ª mensagem: o motor liga sozinho (spec-motor-acordado, decisão 3). */
const FRASE_AGUARDANDO = "A Janete liga sozinha quando chegar a primeira mensagem";

/** "A Janete está atrasada há 12 min" (decisão 3), ou o onboarding aberto. */
function fraseDoMotor(m: NonNullable<Situacao["motorParado"]>, agoraMs: number): string {
  if (m.onboarding || m.desde === null)
    return "A Janete começa a responder quando o onboarding terminar";
  return `A Janete está atrasada ${haQuanto((agoraMs - m.desde) / 1000)}`;
}

/* ---------- o período ---------- */

type Direcao = "subir_bom" | "descer_bom" | "subir_ruim";

export function tendencia(atual: number | null, anterior: number | null, direcao: Direcao): Tendencia {
  const variacaoPct =
    atual === null || anterior === null || anterior === 0 ? null : Math.round(((atual - anterior) / anterior) * 1000) / 10;
  let sentido: Sentido = "neutro";
  if (variacaoPct !== null && Math.abs(variacaoPct) >= 0.5) {
    const subiu = variacaoPct > 0;
    sentido = direcao === "subir_bom" ? (subiu ? "melhor" : "pior") : subiu ? "pior" : "melhor";
  }
  return { atual, anterior, variacaoPct, sentido };
}

/** A variação em pontos percentuais (1 casa), para as porcentagens. */
function comPontos(t: Tendencia): Tendencia & { variacaoPp: number | null } {
  return { ...t, variacaoPp: t.atual === null || t.anterior === null ? null : umaCasa(t.atual - t.anterior) };
}

const usd = (micro: number) => micro / 1e6;
const micro = (dolar: number) => dolar * 1e6;
const umaCasa = (x: number) => Math.round(x * 10) / 10;
const serie = (dias: readonly string[], valores: readonly number[], f: (v: number) => number = (v) => v): PontoDia[] =>
  dias.map((dia, i) => ({ dia, valor: f(valores[i] ?? 0) }));

const ACAO_CHAT = { rotulo: "Ver conversa", para: "/app/chat" } as const;
const ACAO_CONFIG = { rotulo: "Abrir a Configuração", para: "/app/configuracao" } as const;

/** "parou 12 min"; um problema de um instante só (uma falha, 0 min) é só "parou". */
const parouPor = (durMin: number) => (durMin >= 1 ? `parou ${durMin} min` : "parou");

/**
 * O título e a causa de um problema. Para o atendente, os da chave da IA (sem crédito, recusada) são
 * neutros: ele não vê a chave (seção 3); o motivo curto da lista de espera continua o do Chat.
 */
function textoProblema(inc: NumerosJanela["incidentes"][number], admin: boolean): { titulo: string; causa: string } {
  const afetadas = inc.conversasAfetadas;
  const foram =
    afetadas === 0 ? "Nenhuma conversa ficou esperando." : `${contagem(afetadas, "conversa foi", "conversas foram")} para a equipe.`;
  switch (inc.tipo) {
    case "falha_ia":
      // o falha_ia vem das rodadas que falharam; o `envio_falhou` não chega aqui (a rodada já tinha
      // concluído quando a bolha falhou), e a bolha que não saiu já conta no "envio"
      if ((inc.motivo === "sem_credito" || inc.motivo === "chave_invalida") && !admin)
        return { titulo: `A Janete ${parouPor(inc.durMin)}: problema na IA`, causa: `O admin já pode ver na Configuração. ${foram}` };
      if (inc.motivo === "sem_credito")
        return { titulo: `A Janete ${parouPor(inc.durMin)}: a chave ficou sem crédito`, causa: `O saldo da conta de IA acabou até a recarga. ${foram}` };
      if (inc.motivo === "chave_invalida")
        return { titulo: `A Janete ${parouPor(inc.durMin)}: a chave da IA foi recusada`, causa: `A chave foi trocada ou revogada no provedor. ${foram}` };
      if (inc.motivo === "limite_passos")
        return { titulo: "A Janete passou conversas por limite de passos", causa: `As conversas pediram mais passos do que o limite da Janete. ${foram}` };
      if (inc.motivo === "audio_sem_transcricao") {
        // a mensageria falha a rodada com este motivo quando não consegue transcrever o áudio (sem a
        // chave da Escuta, ou o formato foi recusado): o lugar de olhar é a Escuta, não o provedor
        const titulo = `${contagem(inc.quantidade, "áudio foi", "áudios foram")} para a equipe sem transcrição`;
        return admin
          ? { titulo, causa: "A Janete não conseguiu transcrever os áudios. Confira a Escuta de áudio na Configuração." }
          : { titulo, causa: "A Janete não conseguiu transcrever os áudios: ouça na conversa." };
      }
      return { titulo: `A Janete ${parouPor(inc.durMin)}: erro no provedor de IA`, causa: `O provedor de IA ficou fora do ar. ${foram}` };
    case "envio":
      // o banco não diz por que o envio falhou (janela de 24 h, número inválido, instabilidade): a
      // causa fica neutra e aponta para a conversa, onde o erro aparece. Também não diz quantas destas
      // conversas foram para a equipe (o `envio_falhou`): as mensagens são da Janete e da tela juntas
      return {
        titulo: `${contagem(inc.quantidade, "mensagem não saiu", "mensagens não saíram")}`,
        causa: `O WhatsApp não aceitou ${inc.quantidade === 1 ? "o envio" : "os envios"}. Abra a conversa para ver o erro.`,
      };
    case "midia":
      return {
        titulo: inc.quantidade === 1 ? "1 mídia não foi copiada" : `${numero(inc.quantidade)} mídias não foram copiadas`,
        causa: `Não deu para baixar ${inc.quantidade === 1 ? "o arquivo" : "os arquivos"} do provedor. Abra a conversa para ver.`,
      };
    default: {
      // a conexão que ainda não voltou (só o banco sabe: fim nulo). Quando voltou, só a hora: o banco
      // não diz se ela voltou sozinha ou se o admin reconectou.
      if (inc.fim === null) return { titulo: `O WhatsApp está desconectado há ${inc.durMin} min`, causa: "A sessão caiu no provedor e ainda não voltou." };
      const voltou = `A conexão voltou às ${horaCurta(inc.fim ?? inc.t + inc.durMin * MIN_MS)}.`;
      if (inc.durMin < 1) return { titulo: "O WhatsApp desconectou e voltou", causa: voltou };
      return { titulo: `O WhatsApp ficou desconectado por ${inc.durMin} min`, causa: voltou };
    }
  }
}

/** Os problemas do período (do mais recente ao mais antigo, como vieram). */
function problemasDoPeriodo(dados: NumerosJanela, admin: boolean): ProblemaPeriodo[] {
  return dados.incidentes.map((inc) => {
    const { titulo, causa } = textoProblema(inc, admin);
    const p: ProblemaPeriodo = { id: inc.id, quando: new Date(inc.t).toISOString(), tipo: inc.tipo, titulo, causa, soAdmin: false };
    if (inc.tipo === "falha_ia") p.acao = admin ? ACAO_CONFIG : ACAO_CHAT;
    else if (inc.tipo === "conexao") {
      if (admin) p.acao = ACAO_CONFIG;
    } else p.acao = ACAO_CHAT;
    return p;
  });
}

/** Os problemas do exemplo, com os das simulações na frente. */
function problemasDoExemplo(dados: NumerosJanela, sit: Situacao, simulacao: Simulacao, admin: boolean, janela: Janela): ProblemaPeriodo[] {
  const lista = problemasDoPeriodo(dados, admin);
  const naJanela = (t: number) => t >= janela.de && t < janela.ate;
  if (simulacao === "chave_sem_credito" && sit.ia?.parouEm != null && naJanela(sit.ia.parouEm)) {
    const paradas = `${contagem(SIM_CHAVE.conversas, "conversa está parada", "conversas estão paradas")} esperando a equipe.`;
    lista.unshift({
      id: "pb-simulado-chave",
      quando: new Date(sit.ia.parouEm).toISOString(),
      tipo: "falha_ia",
      titulo: admin ? "A Janete parou: a chave ficou sem crédito" : "A Janete parou: problema na IA",
      causa: admin ? `O saldo da conta de IA acabou. ${paradas}` : `O admin já pode ver na Configuração. ${paradas}`,
      acao: admin ? ACAO_CONFIG : ACAO_CHAT,
      soAdmin: false,
    });
  }
  if (simulacao === "whatsapp_caiu" && sit.whatsCaiu?.caiuEm && naJanela(sit.whatsCaiu.caiuEm)) {
    const p: ProblemaPeriodo = {
      id: "pb-simulado-whats",
      quando: new Date(sit.whatsCaiu.caiuEm).toISOString(),
      tipo: "conexao",
      titulo: `O WhatsApp desconectou às ${horaCurta(sit.whatsCaiu.caiuEm)}`,
      causa: "A sessão caiu no provedor e ainda não voltou.",
      soAdmin: false,
    };
    if (admin) p.acao = ACAO_CONFIG;
    lista.unshift(p);
  }
  return lista;
}

function montarResumo(d: DadosPeriodo, vazio: boolean, admin: boolean, problemas: ProblemaPeriodo[]): ResumoPeriodo {
  const a = d.atual;
  const b = d.anterior;
  const v = <T>(x: T): T | null => (vazio ? null : x);
  const dias = a.dias;
  const zeros = dias.map(() => 0);
  const series: ResumoPeriodo["series"] = {
    conversas: serie(dias, vazio ? zeros : a.series.conversas),
    recebidas: serie(dias, vazio ? zeros : a.series.recebidas),
    enviadas: serie(dias, vazio ? zeros : a.series.enviadas),
    respostaJaneteS: serie(dias, vazio ? zeros : a.series.respostaJaneteS),
  };
  if (admin) series.custoUsd = serie(dias, vazio ? zeros : a.series.custoMicro, usd);
  return {
    conversas: tendencia(v(a.conversas), b.conversas, "subir_bom"),
    leadsNovos: tendencia(v(a.leadsNovos), b.leadsNovos, "subir_bom"),
    recebidas: tendencia(v(a.recebidas), b.recebidas, "subir_bom"),
    enviadas: tendencia(v(a.enviadas), b.enviadas, "subir_bom"),
    enviadasPorOrigem: vazio ? { janete: 0, humano_tela: 0, humano_celular: 0 } : { ...a.porOrigem },
    janetePctEnviadas: !vazio && a.enviadas ? umaCasa((a.porOrigem.janete / a.enviadas) * 100) : null,
    primeiraRespostaS: tendencia(vazio ? null : a.primeiraRespostaS, b.primeiraRespostaS, "descer_bom"),
    respostaJaneteS: tendencia(vazio ? null : a.respostaJaneteS, b.respostaJaneteS, "descer_bom"),
    respostaJaneteP90S: vazio ? null : a.respostaJaneteP90S,
    autonomiaPct: comPontos(tendencia(vazio ? null : a.autonomiaPct, b.autonomiaPct, "subir_bom")),
    passados: vazio ? { janetePassou: 0, falha: 0, porMotivo: {} } : { ...a.passados, porMotivo: { ...a.passados.porMotivo } },
    problemas: vazio ? [] : problemas,
    series,
  };
}

/** A previsão do mês só aparece depois de 3 dias corridos (antes, a conta é ruído). */
const MIN_DIAS_PREVISAO = 3;

function montarCusto(d: DadosPeriodo, vazio: boolean, ganhos: number, agoraMs: number): CustoPeriodo {
  const a = d.atual.custo;
  const total = usd(a.totalMicro);
  let previsaoMesUsd: number | null = null;
  if (!vazio && d.mesAteHojeMicro !== null) {
    // dias corridos com a fração de hoje (no dia 2 às 08:00, 1,33 dia, não 2); antes de 3 dias, nada
    const hoje = diaLocal(agoraMs);
    const corridos = (agoraMs - inicioDoDia(primeiroDoMes(hoje))) / DIA_MS;
    previsaoMesUsd = corridos >= MIN_DIAS_PREVISAO ? (usd(d.mesAteHojeMicro) / corridos) * diasDoMes(hoje) : null;
  }
  const porModelo = vazio
    ? []
    : (
        d.porModelo ?? [
          { ...MODELO_RESPOSTA, usd: usd(a.respostaMicro) },
          { ...MODELO_TRANSCRICAO, usd: usd(a.transcricaoMicro) },
          { ...MODELO_FALA, usd: usd(a.falaMicro) },
        ]
      )
        .filter((m) => m.usd > 0)
        .map((m) => ({ provedor: m.provedor, modelo: m.modelo, usd: m.usd }))
        .sort((x, y) => y.usd - x.usd);
  return {
    total: tendencia(vazio ? null : total, usd(d.anterior.custo.totalMicro), "subir_ruim"),
    porConversaUsd: !vazio && a.conversasComJanete ? usd(a.respostaMicro) / a.conversasComJanete : null,
    porGanhoUsd: !vazio && ganhos ? total / ganhos : null,
    previsaoMesUsd,
    semPreco: vazio ? 0 : a.semPreco,
    porTipo: vazio
      ? { resposta: 0, transcricao: 0, onboarding: 0, fala: 0 }
      : {
          resposta: usd(a.respostaMicro),
          transcricao: usd(a.transcricaoMicro),
          onboarding: usd(a.onboardingMicro),
          fala: usd(a.falaMicro),
        },
    porModelo,
    foraDaCoorteUsd: vazio ? 0 : usd(a.foraDaCoorteMicro),
  };
}

/* ---------- o funil e as frases ---------- */

const partes = (lista: string[]) =>
  lista.length <= 1 ? (lista[0] ?? "") : `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;

const SEM_RESPOSTA_TXT = `sem resposta há mais de ${DIAS_SEM_RESPOSTA} dias`;

/** "19 perdidos e 12 sem resposta há mais de 7 dias" (`sep` troca o " e " por ", "). */
function fraseSaidas(perdido: number, semResposta: number, sep?: string): string {
  const p: string[] = [];
  if (perdido) p.push(contagem(perdido, "perdido", "perdidos"));
  if (semResposta) p.push(`${numero(semResposta)} ${SEM_RESPOSTA_TXT}`);
  return sep ? p.join(sep) : partes(p);
}

/** A queda depois da etapa (5.4): "31 saíram aqui: 19 perdidos, 12 sem resposta há mais de 7 dias". */
function fraseQueda(e: Omit<EtapaFunil, "frase" | "fraseQueda">): string {
  if (e.tipo === "ganho") return "";
  const { total, perdido, semResposta } = e.abandonaram;
  if (!total) return "Ninguém saiu aqui";
  return `${total === 1 ? "1 saiu aqui" : `${numero(total)} saíram aqui`}: ${fraseSaidas(perdido, semResposta, ", ")}`;
}

function fraseEtapa(e: Omit<EtapaFunil, "frase" | "fraseQueda">, indice: number, leadsNovos: number, taxaGanhoPct: number | null): string {
  if (e.tipo === "ganho") {
    if (!e.chegaram) return "Nenhuma venda neste período ainda.";
    const taxa = taxaGanhoPct === null ? "" : `: ${porcentagem(taxaGanhoPct)} dos ${numero(leadsNovos)} leads que chegaram`;
    return `${e.chegaram === 1 ? "1 virou venda" : `${numero(e.chegaram)} viraram venda`}${taxa}.`;
  }
  if (!e.chegaram) return `Nenhum lead chegou em ${e.nome} neste período.`;
  const onde = indice === 0 ? "" : ` em ${e.nome}`;
  const inicio = e.chegaram === 1 ? `Do 1 que chegou${onde}` : `Dos ${numero(e.chegaram)} que chegaram${onde}`;
  const avancou = e.avancaram === 1 ? "1 avançou" : `${numero(e.avancaram)} avançaram`;
  let frase = `${inicio}, ${avancou} (${porcentagem(e.conversaoProxPct ?? 0)}).`;
  const { perdido, semResposta, total } = e.abandonaram;
  if (total) {
    if (semResposta > perdido) frase += " Quem sai, sai mais por falta de resposta.";
    else if (perdido > semResposta) frase += " Quem sai, sai mais como perdido.";
    else frase += " Quem sai se divide entre perdidos e sem resposta.";
  }
  if (e.aindaEstao) frase += e.aindaEstao === 1 ? " 1 ainda está aqui." : ` ${numero(e.aindaEstao)} ainda estão aqui.`;
  return frase;
}

function rotuloAnterior(periodo: Periodo): string {
  if (periodo.id === "hoje") return "a ontem";
  if (periodo.id === "personalizado") return "ao período anterior";
  return `aos ${periodo.dias} dias anteriores`;
}

/** As etapas do gerador, com o nome, a ordem e o "a Janete pode mover" do estado de exemplo. */
function etapasDoExemplo(estado: EstadoExemplo): DefEtapaFunil[] {
  const doEstado = new Map(estado.etapas.map((e) => [e.id, e]));
  return ETAPAS_GERADOR.map((g) => {
    const real = doEstado.get(g.id);
    return { id: g.id, nome: real?.nome ?? g.nome, ordem: real?.ordem ?? g.ordem, tipo: g.tipo, janetePodeMover: real?.janete_pode_mover ?? g.janetePodeMover };
  });
}

const ETAPA_ZERADA: EtapaNumeros = {
  chegaram: 0,
  avancaram: 0,
  aindaEstao: 0,
  perdido: 0,
  semResposta: 0,
  tempoMedianoH: null,
  custoMicro: 0,
  recebidas: 0,
  enviadas: 0,
  movJanete: 0,
  movEquipe: 0,
  passados: 0,
  entradasPorDia: [],
};

function montarFunil(d: DadosPeriodo, vazio: boolean, admin: boolean, defs: readonly DefEtapaFunil[], periodo: Periodo): Funil {
  const a = d.atual.funil;
  const leadsNovos = vazio ? 0 : d.atual.leadsNovos;
  const ganhos = vazio ? 0 : a.ganhos;
  const taxaGanhoPct = leadsNovos ? umaCasa((ganhos / leadsNovos) * 100) : null;
  const dias = d.atual.dias;

  const etapas: EtapaFunil[] = defs.map((g, i) => {
    const n = a.etapas[i] ?? ETAPA_ZERADA;
    const z = vazio;
    const chegaram = z ? 0 : n.chegaram;
    const avancaram = z ? 0 : n.avancaram;
    const perdido = z ? 0 : n.perdido;
    const semResposta = z ? 0 : n.semResposta;
    const base: Omit<EtapaFunil, "frase" | "fraseQueda"> = {
      etapaId: g.id,
      nome: g.nome,
      ordem: g.ordem,
      tipo: g.tipo,
      janetePodeMover: g.janetePodeMover,
      chegaram,
      avancaram,
      aindaEstao: z ? 0 : n.aindaEstao,
      abandonaram: { total: perdido + semResposta, perdido, semResposta },
      conversaoProxPct: g.tipo === "ganho" || !chegaram ? null : umaCasa((avancaram / chegaram) * 100),
      tempoMedianoH: z ? null : n.tempoMedianoH,
      mensagens: { recebidas: z ? 0 : n.recebidas, enviadas: z ? 0 : n.enviadas },
      movimentos: { janete: z ? 0 : n.movJanete, equipe: z ? 0 : n.movEquipe },
      passadosParaEquipe: z ? 0 : n.passados,
      entradasPorDia: serie(dias, z ? dias.map(() => 0) : n.entradasPorDia),
    };
    if (admin) base.custoUsd = z ? 0 : usd(n.custoMicro);
    return { ...base, frase: fraseEtapa(base, i, leadsNovos, taxaGanhoPct), fraseQueda: fraseQueda(base) };
  });

  // as abertas (Perdido não está no funil; o Ganho é o fim), com o índice de cada uma no funil
  const iAbertas = etapas.flatMap((e, i) => (e.tipo === "aberta" ? [i] : []));
  const abertas = iAbertas.map((i) => etapas[i]!);
  const perdidosPorOrigem = abertas.map((e) => ({
    etapaId: e.etapaId,
    nome: e.nome,
    perdido: e.abandonaram.perdido,
    semResposta: e.abandonaram.semResposta,
  }));
  const perdidos = perdidosPorOrigem.reduce((s, p) => s + p.perdido, 0);
  const cicloMedianoDias = vazio ? null : a.cicloMedianoDias;

  // a maior perda (o maior abandono; no empate, a primeira) e a menor conversão
  let iPerda = -1;
  abertas.forEach((e, i) => {
    if (e.abandonaram.total > 0 && (iPerda < 0 || e.abandonaram.total > abertas[iPerda]!.abandonaram.total)) iPerda = i;
  });
  let iConv = -1;
  abertas.forEach((e, i) => {
    if (e.conversaoProxPct !== null && (iConv < 0 || e.conversaoProxPct < abertas[iConv]!.conversaoProxPct!)) iConv = i;
  });
  /** "entre Qualificado e Em negociação" (a aberta e a etapa seguinte do funil). */
  const entreEtapas = (iAberta: number) => {
    const i = iAbertas[iAberta]!;
    const proxima = etapas[i + 1];
    return proxima ? `entre ${etapas[i]!.nome} e ${proxima.nome}` : `em ${etapas[i]!.nome}`;
  };

  let frase = "Nenhum lead chegou neste período.";
  let fraseSaidasFunil = frase;
  if (!vazio && leadsNovos) {
    const vendas = ganhos === 1 ? "1 virou venda" : `${numero(ganhos)} viraram venda`;
    frase = `Dos ${numero(leadsNovos)} leads que chegaram, ${vendas}${taxaGanhoPct !== null ? ` (${porcentagem(taxaGanhoPct)})` : ""}.`;
    if (iPerda >= 0) frase += ` A maior perda está ${entreEtapas(iPerda)}.`;

    // o capítulo "Para onde foram os que saíram"
    const semResp = perdidosPorOrigem.reduce((s, p) => s + p.semResposta, 0);
    const sairam = perdidos + semResp;
    fraseSaidasFunil =
      sairam === 0 || iPerda < 0
        ? "Ninguém saiu do funil neste período até agora."
        : `${sairam === 1 ? "Saiu 1 lead" : `Saíram ${numero(sairam)} leads`}: ${fraseSaidas(perdidos, semResp)}. A maior perda está ${entreEtapas(iPerda)}.`;
  }
  const movimentos = abertas.reduce((m, e) => ({ janete: m.janete + e.movimentos.janete, equipe: m.equipe + e.movimentos.equipe }), { janete: 0, equipe: 0 });

  /* o "Pergunte à Janete" */
  const semDados = "Nenhum lead chegou neste período, então ainda não há o que responder.";
  const perguntas: Funil["perguntas"] = [];

  let perda = semDados;
  if (!vazio && leadsNovos) {
    if (iPerda < 0) perda = "Ninguém saiu do funil neste período até agora.";
    else {
      const e = abertas[iPerda]!;
      const quebra = fraseSaidas(e.abandonaram.perdido, e.abandonaram.semResposta);
      const qtd = e.abandonaram.total === 1 ? "1 saiu ali" : `${numero(e.abandonaram.total)} saíram ali`;
      const t = entreEtapas(iPerda);
      perda = `${t.charAt(0).toUpperCase()}${t.slice(1)}: ${qtd}, ${quebra}.`;
      if (iConv === iPerda) perda += ` É também a etapa com a menor conversão (${porcentagem(e.conversaoProxPct ?? 0)}).`;
      else if (iConv >= 0) perda += ` A menor conversão está em ${abertas[iConv]!.nome} (${porcentagem(abertas[iConv]!.conversaoProxPct ?? 0)}).`;
    }
  }
  perguntas.push({ pergunta: "Onde eu mais perco leads?", resposta: perda });

  let mudou = semDados;
  if (!vazio && leadsNovos) {
    const antes = d.anterior.leadsNovos;
    const dif = leadsNovos - antes;
    const pct = antes ? Math.round((dif / antes) * 100) : null;
    const comp =
      dif === 0
        ? "o mesmo número que no anterior"
        : `${numero(Math.abs(dif))} a ${dif > 0 ? "mais" : "menos"} que no anterior${pct !== null && pct !== 0 ? ` (${dif > 0 ? "+" : "−"}${porcentagem(Math.abs(pct))})` : ""}`;
    mudou = `Chegaram ${contagem(leadsNovos, "lead", "leads")}, ${comp}.`;
    const ganhosAntes = d.anterior.funil.ganhos;
    const taxaAntes = antes ? umaCasa((ganhosAntes / antes) * 100) : null;
    if (taxaGanhoPct !== null && taxaAntes !== null) {
      // as duas coortes são lidas com a mesma idade (o anterior como estava `dias` atrás)
      const antesTxt = porcentagem(taxaAntes);
      const agoraTxt = porcentagem(taxaGanhoPct);
      mudou += antesTxt === agoraTxt ? ` A taxa de ganho ficou em ${agoraTxt}.` : ` A taxa de ganho foi de ${antesTxt} para ${agoraTxt}.`;
    }
  }
  perguntas.push({ pergunta: `O que mudou em relação ${rotuloAnterior(periodo)}?`, resposta: mudou });

  let tempo = semDados;
  if (!vazio && leadsNovos) {
    let iLenta = -1;
    abertas.forEach((e, i) => {
      if (e.tempoMedianoH !== null && (iLenta < 0 || e.tempoMedianoH > abertas[iLenta]!.tempoMedianoH!)) iLenta = i;
    });
    const lenta = iLenta >= 0 ? ` A etapa mais demorada é ${abertas[iLenta]!.nome}, com ${tempoEtapa(abertas[iLenta]!.tempoMedianoH!)} de mediana.` : "";
    tempo =
      cicloMedianoDias !== null
        ? `A mediana é de ${diasTexto(cicloMedianoDias)} do 1º contato até o Ganho.${lenta}`
        : `Ainda não houve venda neste período.${lenta}`;
  }
  perguntas.push({ pergunta: "Quanto tempo leva para fechar uma venda?", resposta: tempo });

  return {
    etapas,
    leadsNovos,
    ganhos,
    perdidos,
    taxaGanhoPct,
    cicloMedianoDias,
    perdidosPorOrigem,
    frase,
    fraseSaidas: fraseSaidasFunil,
    movimentos,
    perguntas,
  };
}

/* ---------- textos ---------- */

export function saudacao(agora: Instante, nomeConta: string): string {
  const hora = Number(horaCurta(agora).slice(0, 2));
  const cumprimento = hora >= 5 && hora < 12 ? "Bom dia" : hora >= 12 && hora < 18 ? "Boa tarde" : "Boa noite";
  const primeiro = nomeConta.trim().split(/\s+/)[0] ?? "";
  return primeiro ? `${cumprimento}, ${primeiro}` : cumprimento;
}

/**
 * A linha embaixo da saudação (4.4). Sem conversa desde ontem (a simulação "Período vazio" com um
 * período que pega ontem ou hoje, por exemplo), sai só o "{k} precisam de você", para não contradizer
 * os cartões ("Nenhum lead chegou neste período").
 */
function linhaResumo(sit: Situacao, admin: boolean, desdeOntem: number, aguardando: number, agoraMs: number): string {
  if (sit.motorParado) return fraseDoMotor(sit.motorParado, agoraMs);
  if (sit.whatsCaiu) return sit.whatsCaiu.caiuEm ? `O WhatsApp desconectou às ${horaCurta(sit.whatsCaiu.caiuEm)}` : "O WhatsApp está desconectado";
  if (sit.ia) {
    if (!admin) return "A Janete está com um problema técnico · o admin já pode ver";
    return sit.ia.parouEm === null
      ? `A Janete parou: ${FRASE_CHAVE[sit.ia.motivo]}`
      : `A Janete parou às ${horaCurta(sit.ia.parouEm)}: ${FRASE_CHAVE[sit.ia.motivo]}`;
  }
  if (!aguardando) return "Tudo em dia · ninguém esperando por você";
  const precisam = aguardando === 1 ? "1 precisa de você" : `${numero(aguardando)} precisam de você`;
  if (!desdeOntem) return precisam;
  return `${contagem(desdeOntem, "conversa", "conversas")} desde ontem · ${precisam}`;
}

function fraseResultado(d: DadosPeriodo, vazio: boolean): string {
  if (vazio || !d.atual.leadsNovos) return "Nenhum lead chegou neste período.";
  const g = d.atual.funil.ganhos;
  const ga = d.anterior.funil.ganhos;
  const vendas = g === 0 ? "Nenhuma venda no período" : g === 1 ? "1 venda no período" : `${numero(g)} vendas no período`;
  if (g === ga) return `${vendas}, o mesmo que no anterior.`;
  const dif = Math.abs(g - ga);
  return `${vendas}, ${numero(dif)} a ${g > ga ? "mais" : "menos"} que no anterior.`;
}

/* ---------- a montagem comum ---------- */

function paraMs(x: Instante): number {
  if (x instanceof Date) return x.getTime();
  if (typeof x === "number") return x;
  return Date.parse(x);
}

const periodoVazio = (dados: DadosPeriodo) => dados.atual.leadsNovos === 0 && dados.atual.recebidas + dados.atual.enviadas === 0;

interface EntradaJuntar {
  papel: "admin" | "atendente";
  nomeConta: string;
  agoraMs: number;
  periodo: Periodo;
  carregando: boolean;
  dados: DadosPeriodo;
  defs: readonly DefEtapaFunil[];
  vazio: boolean;
  sit: Situacao;
  problemas: ProblemaPeriodo[];
  agora: AgoraSemSaude;
  conexao: Conexao | null;
  chaves: readonly ChaveIA[];
  contexto: ContextoPainel;
  /** As conversas desde ontem que a linha de resumo mostra. */
  desdeOntem: number;
  /**
   * A hora do "atualizado às": no banco, a da passada que está na tela (`calculadoEm`), para não dizer
   * "atualizado às 14:52" com os números de 14:45 quando as releituras falham. Sem ela, o relógio.
   */
  atualizadoEm?: number | undefined;
}

function juntarPainel(e: EntradaJuntar): PainelDashboard {
  const admin = e.papel === "admin";
  const resumo = montarResumo(e.dados, e.vazio, admin, e.problemas);
  const funil = montarFunil(e.dados, e.vazio, admin, e.defs, e.periodo);
  const saude = montarSaude({
    sit: e.sit,
    admin,
    agoraMs: e.agoraMs,
    resumo,
    periodo: e.periodo,
    conexao: e.conexao,
    chaves: e.chaves,
    contexto: e.contexto,
  });
  const agora: Agora = { ...e.agora, saude };
  const estadoJanete: PainelDashboard["estadoJanete"] = e.carregando ? "carregando" : estaParada(e.sit) ? "dormindo" : "acordada";
  const painel: PainelDashboard = {
    papel: e.papel,
    periodo: e.periodo,
    vazio: e.vazio,
    resumo,
    funil,
    agora,
    estadoJanete,
    contexto: e.contexto,
    textos: {
      saudacao: saudacao(e.agoraMs, e.nomeConta),
      resumo: linhaResumo(e.sit, admin, e.desdeOntem, agora.aguardando.total, e.agoraMs),
      resultado: fraseResultado(e.dados, e.vazio),
      atualizado: `atualizado às ${horaCurta(e.atualizadoEm ?? e.agoraMs)}`,
    },
  };
  if (admin) painel.custo = montarCusto(e.dados, e.vazio, funil.ganhos, e.agoraMs);
  return painel;
}

/* ---------- montarPainel (o modo exemplo) ---------- */

export function montarPainel(entrada: EntradaPainel): PainelDashboard {
  const { estado: base, papel, nomeConta, periodo, simulacao, carregando } = entrada;
  const agoraMs = paraMs(entrada.agora);
  const admin = papel === "admin";
  const dados = entrada.dados ?? calcularDadosPeriodo(periodo, agoraMs);
  const { estado, sit } = aplicarSimulacao(base, admin, simulacao, agoraMs);
  const vazio = simulacao === "periodo_vazio" || periodoVazio(dados);
  const { atual: janela } = janelasDoPeriodo(periodo, agoraMs);

  // na simulação "Período vazio", se o período pega ontem ou hoje, também não houve conversa desde ontem
  const vazioPegaOntem = simulacao === "periodo_vazio" && periodo.fim >= somarDias(diaLocal(agoraMs), -1);

  return juntarPainel({
    papel,
    nomeConta,
    agoraMs,
    periodo,
    carregando: carregando || simulacao === "carregando",
    dados,
    defs: dados.etapasFunil ?? etapasDoExemplo(estado),
    vazio,
    sit,
    problemas: problemasDoExemplo(dados.atual, sit, simulacao, admin, janela),
    agora: agoraDoExemplo(estado, sit, agoraMs),
    conexao: estado.conexao,
    chaves: estado.chaves,
    contexto: { ...CONTEXTO_EXEMPLO },
    desdeOntem: vazioPegaOntem ? 0 : dados.desdeOntem,
  });
}

/* ---------- o modo banco ---------- */

/** As janelas de uma passada do período (dados/dashboard.ts busca com elas), no instante `agoraMs`. */
export function janelasDashboard(periodo: Periodo, agoraMs: number): JanelasDashboard {
  const hoje = diaLocal(agoraMs);
  const { atual, anterior } = janelasDoPeriodo(periodo, agoraMs);
  return {
    agora: agoraMs,
    atual,
    anterior,
    // o anterior é lido como estava na mesma idade (decisão do bloco 3)
    estadoAnterior: agoraMs - periodo.dias * DIA_MS,
    ontem: { de: inicioDoDia(somarDias(hoje, -1)), ate: agoraMs + 1 },
    mes: periodo.fim === hoje ? { de: inicioDoDia(primeiroDoMes(hoje)), ate: agoraMs + 1 } : null,
  };
}

/** Uma série do banco, um ponto por dia da tela (o dia que não veio é 0). */
function serieDoBanco(pontos: readonly PontoBanco[] | null | undefined, dias: readonly string[], f: (v: number) => number = (v) => v): number[] {
  const porDia = new Map((pontos ?? []).map((p) => [p.dia, p.valor]));
  return dias.map((d) => f(porDia.get(d) ?? 0));
}

function incidenteDoBanco(p: ProblemaBanco): NumerosJanela["incidentes"][number] {
  const t = Date.parse(p.quando);
  return {
    id: p.id,
    dia: diaLocal(t),
    t,
    durMin: p.durMin,
    tipo: p.tipo,
    motivo: p.motivo,
    quantidade: p.quantidade,
    conversasAfetadas: p.conversasAfetadas,
    fim: p.fim === null ? null : paraMsOuNulo(p.fim),
  };
}

function numerosDoBanco(lida: JanelaLida, dias: readonly string[], incidentes: NumerosJanela["incidentes"]): NumerosJanela {
  const { periodo: p, funil: f, custo: c } = lida;
  return {
    dias: [...dias],
    leadsNovos: p.leadsNovos,
    conversas: p.conversas,
    recebidas: p.recebidas,
    enviadas: p.enviadas,
    porOrigem: { ...p.enviadasPorOrigem },
    primeiraRespostaS: p.primeiraRespostaS,
    respostaJaneteS: p.respostaJaneteS,
    respostaJaneteP90S: p.respostaJaneteP90S,
    conversasAutonomas: p.conversasAutonomas,
    autonomiaPct: p.autonomiaPct,
    passados: { ...p.passados, porMotivo: { ...p.passados.porMotivo } },
    incidentes,
    series: {
      conversas: serieDoBanco(p.series.conversas, dias),
      recebidas: serieDoBanco(p.series.recebidas, dias),
      enviadas: serieDoBanco(p.series.enviadas, dias),
      respostaJaneteS: serieDoBanco(p.series.respostaJaneteS, dias),
      custoMicro: serieDoBanco(p.series.custoUsd, dias, micro),
    },
    custo: c
      ? {
          totalMicro: micro(c.total),
          respostaMicro: micro(c.porTipo.resposta),
          transcricaoMicro: micro(c.porTipo.transcricao),
          onboardingMicro: micro(c.porTipo.onboarding),
          falaMicro: micro(c.porTipo.fala),
          semPreco: c.semPreco,
          conversasComJanete: c.conversasComJanete,
          foraDaCoorteMicro: micro(c.foraDaCoorteUsd),
        }
      : { totalMicro: 0, respostaMicro: 0, transcricaoMicro: 0, onboardingMicro: 0, falaMicro: 0, semPreco: 0, conversasComJanete: 0, foraDaCoorteMicro: 0 },
    funil: {
      etapas: f.etapas.map((e) => ({
        chegaram: e.chegaram,
        avancaram: e.avancaram,
        aindaEstao: e.aindaEstao,
        perdido: e.abandonaram.perdido,
        semResposta: e.abandonaram.semResposta,
        tempoMedianoH: e.tempoMedianoH,
        custoMicro: micro(e.custoUsd ?? 0),
        recebidas: e.mensagens.recebidas,
        enviadas: e.mensagens.enviadas,
        movJanete: e.movimentos.janete,
        movEquipe: e.movimentos.equipe,
        passados: e.passadosParaEquipe,
        entradasPorDia: serieDoBanco(e.entradasPorDia, dias),
      })),
      ganhos: f.ganhos,
      cicloMedianoDias: f.cicloMedianoDias,
    },
  };
}

/** Os números de uma passada do banco no formato da montagem (o período é o da passada). */
export function dadosDoBanco(r: DashboardPeriodoBanco<Periodo>): DadosPeriodo {
  const periodo = r.contexto;
  return {
    atual: numerosDoBanco(r.atual, diasDoIntervalo(periodo.inicio, periodo.fim), r.problemas.map(incidenteDoBanco)),
    anterior: numerosDoBanco(r.anterior, diasDoIntervalo(periodo.anterior.inicio, periodo.anterior.fim), []),
    desdeOntem: r.desdeOntem,
    mesAteHojeMicro: r.mesAteHojeUsd === null ? null : micro(r.mesAteHojeUsd),
    etapasFunil: r.atual.funil.etapas.map((e) => ({ id: e.etapaId, nome: e.nome, ordem: e.ordem, tipo: e.tipo, janetePodeMover: e.janetePodeMover })),
    porModelo: r.atual.custo?.porModelo,
  };
}

/** As 8 colunas de texto de `contexto_versoes` (os campos do Contexto). */
const CAMPOS_CONTEXTO = [
  "empresa_oferta",
  "cliente_ideal",
  "preco",
  "diferenciais",
  "objecoes",
  "quando_passar_humano",
  "tom_voz",
  "horario",
] as const satisfies readonly (keyof VersaoContextoBanco)[];

/** O cartão do Contexto a partir da versão atual: os campos com texto e o número da versão. */
export function contextoDoBanco(versao: VersaoContextoBanco | null): ContextoPainel {
  const preenchidos = versao ? CAMPOS_CONTEXTO.filter((c) => (versao[c] ?? "").trim() !== "").length : 0;
  return { preenchidos, total: CAMPOS_CONTEXTO.length, versao: versao?.numero ?? null };
}

const nomeDe = (c: ContatoAgoraBanco) => nomeDoContato({ id: c.contatoId, nome: c.nome, nome_whatsapp: c.nomeWhatsapp, telefone: c.telefone });

/** O que parou agora, pelas leituras do banco. */
function situacaoDoBanco(x: {
  agora: AgoraBanco;
  conexao: Conexao | null;
  chaves: readonly ChaveIA[];
  admin: boolean;
  configuracao: ConfiguracaoDados | null | undefined;
  configuracaoConhecida?: ConfiguracaoDados | null | undefined;
  motor: PendenciasMotor | null | undefined;
  agoraMs: number;
}): Situacao {
  const { agora, conexao, chaves, admin, configuracao, configuracaoConhecida, motor, agoraMs } = x;
  const ultimaJanete = paraMsOuNulo(agora.ultimaDaJaneteEm);
  const ia = admin
    ? // sem o registro da remoção (a auditoria não é lida aqui), "Parada" sem hora
      problemaDaChave(chaves, agoraMs, () => null)
    : problemaPelasConversas(
        agora.aguardando.itens.filter((i) => i.motivo && MOTIVOS_DE_CHAVE.includes(i.motivo)).map((i) => i.aguardandoDesde),
        ultimaJanete,
      );
  let motorParado: Situacao["motorParado"] = null;
  let motorAguardando = false;
  // sem a configuração (carregando, falhou ou velha: o provedor não passa), não afirma nada sobre o
  // motor; sem a leitura do motor (idem), só o onboarding aberto. A regra dos 3 min é a da
  // Configuração (lerMotor), para as duas telas não discordarem.
  if (configuracao) {
    const m = lerMotor(
      motor,
      agoraMs,
      true,
      configuracao.onboarding_concluido_em === null,
      configuracao.worker_visto_em,
    );
    if (m.estado === "onboarding") motorParado = { desde: null, onboarding: true };
    else if (m.estado === "atrasado") motorParado = { desde: m.desde ?? null };
    else if (m.estado === "aguardando") motorAguardando = true;
  } else if (configuracaoConhecida && configuracaoConhecida.onboarding_concluido_em !== null) {
    // só a releitura da configuração falhou (ou envelheceu): o onboarding concluído nunca volta a
    // nulo, então o atraso lido do motor ainda vale, como na Configuração. Sem o sinal do worker
    // (undefined), nunca sai "aguardando".
    const m = lerMotor(motor, agoraMs, true, false, undefined);
    if (m.estado === "atrasado") motorParado = { desde: m.desde ?? null };
  }
  return {
    ia,
    whatsCaiu: quedaDoWhats(conexao, admin),
    motorParado,
    motorAguardando,
    motorSemLeitura: !motor,
    ultimaRecebida: paraMsOuNulo(agora.ultimaRecebidaEm),
    ultimaJanete,
  };
}

function agoraDoBanco(a: AgoraBanco, sit: Situacao, agoraMs: number): AgoraSemSaude {
  const parada = estaParada(sit);
  const itens: Agora["aguardando"]["itens"] = a.aguardando.itens
    .map((i) => {
      const conversa = { modo: "humano" as const, responsavel_id: null, motivo_humano: i.motivo, aguardando_humano_desde: i.aguardandoDesde };
      return {
        conversaId: i.conversaId,
        contatoId: i.contatoId,
        nome: nomeDe(i),
        motivoCurto: i.motivo ? (MOTIVO_CURTO[i.motivo] ?? "Aguardando alguém") : "Aguardando alguém",
        esperaMin: Math.floor(segundosDesde(i.aguardandoDesde, agoraMs) / 60),
        selo: (seloDaConversa(conversa) === "falha" ? "falha" : "aguardando") as "aguardando" | "falha",
      };
    })
    .sort(porEspera);
  return {
    aguardando: { total: itens.length, maisAntigaMin: itens.length ? itens[0]!.esperaMin : null, itens },
    naoLidas: { ...a.naoLidas },
    comQuem: {
      janete: a.comQuem.janete,
      membros: a.comQuem.membros.map((m) => ({ nome: m.nome.trim() || "Sem nome", n: m.n })),
      celular: a.comQuem.celular,
    },
    janeteAtiva: parada
      ? { conversas: 0, digitando: null }
      : { conversas: a.janeteAtiva.conversas, digitando: a.janeteAtiva.digitando ? nomeDe(a.janeteAtiva.digitando) : null },
    kanban: a.kanban.map((k) => ({ ...k })),
    esfriando: a.esfriando,
    porEtapa: a.porEtapa.map((e) => ({
      etapaId: e.etapaId,
      paradosMais7d: e.paradosMais7d,
      leads: e.leads.map((l) => {
        const desde = paraMsOuNulo(l.etapaDesde);
        return {
          contatoId: l.contatoId,
          conversaId: l.conversaId,
          nome: nomeDe(l),
          desdeMin: desde === null ? 0 : Math.max(0, Math.floor((agoraMs - desde) / MIN_MS)),
        };
      }),
    })),
  };
}

export interface EntradaPainelBanco {
  papel: "admin" | "atendente";
  nomeConta: string;
  agora: Instante;
  /** A passada do período (o período da tela vem nela). */
  periodo: DashboardPeriodoBanco<Periodo>;
  /** Os números já convertidos (o provedor guarda); sem eles, converte aqui. */
  dados?: DadosPeriodo | undefined;
  agoraBanco: AgoraBanco;
  /** A conexão ativa (nula sem nenhuma). */
  conexao: Conexao | null;
  /** As chaves de IA (a atendente: []). */
  chaves: readonly ChaveIA[];
  /** A configuração (o onboarding e o sinal do motor); ausente enquanto carrega ou se a leitura falhou. */
  configuracao: ConfiguracaoDados | null | undefined;
  /**
   * A última configuração lida, mesmo velha ou depois de uma releitura que falhou: só o onboarding
   * concluído vale dela (ele nunca volta a nulo), para o atraso do motor não sumir do Dashboard.
   */
  configuracaoConhecida?: ConfiguracaoDados | null | undefined;
  /** As pendências do motor (motor_pendencias); ausentes enquanto carregam, se falharam ou se envelheceram. */
  motor?: PendenciasMotor | null | undefined;
  /** A versão atual do Contexto (nula sem nenhuma). */
  contexto: VersaoContextoBanco | null;
  /** O período de antes está na tela enquanto o novo carrega. */
  carregando: boolean;
}

export function montarPainelBanco(e: EntradaPainelBanco): PainelDashboard {
  const agoraMs = paraMs(e.agora);
  const admin = e.papel === "admin";
  const dados = e.dados ?? dadosDoBanco(e.periodo);
  const sit = situacaoDoBanco({ agora: e.agoraBanco, conexao: e.conexao, chaves: e.chaves, admin, configuracao: e.configuracao, configuracaoConhecida: e.configuracaoConhecida, motor: e.motor, agoraMs });
  return juntarPainel({
    papel: e.papel,
    nomeConta: e.nomeConta,
    agoraMs,
    periodo: e.periodo.contexto,
    carregando: e.carregando,
    dados,
    defs: dados.etapasFunil ?? [],
    vazio: periodoVazio(dados),
    sit,
    problemas: problemasDoPeriodo(dados.atual, admin),
    agora: agoraDoBanco(e.agoraBanco, sit, agoraMs),
    conexao: e.conexao,
    chaves: e.chaves,
    contexto: contextoDoBanco(e.contexto),
    desdeOntem: dados.desdeOntem,
    atualizadoEm: e.periodo.calculadoEm,
  });
}
