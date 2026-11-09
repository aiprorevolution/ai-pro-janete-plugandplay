import type { Erro } from "../../dados/tipos";
import type { MotivoHumano as MotivoHumanoDoBanco } from "../../exemplo/tipos";

// Os contratos do Dashboard (docs/spec-dashboard.md, seção 14.2). A fundação escreve e calcula; as
// 4 versões da página só leem `usePainelDashboard()` e não calculam número nenhum.
//
// Regras do contrato:
// - `custo` e todo `custoUsd` são `undefined` para o atendente, nunca 0;
// - `Tendencia.atual = null` quando não há dado (período vazio, ou uma mediana sem amostra);
// - `variacaoPct = null` quando o anterior é 0 (ou não há atual ou anterior);
// - `primeiraVez` é decidido na montagem do provedor.
//
// Extras da fundação, além da 14.2 (só acrescentam; nada da 14.2 mudou). A versão usa estes campos
// em vez de calcular ou escrever o número ou a frase por conta própria:
// - `textos.atualizado`: "atualizado às 14:45" (o cabeçalho da 5.2 pede, e a versão não calcula hora);
// - `CustoPeriodo.foraDaCoorteUsd`: o custo de resposta de leads de fora da coorte, para o admin ver
//   por que a soma do custo por etapa não fecha com o custo de resposta (invariante da seção 15);
// - `ResumoPeriodo.janetePctEnviadas`: o "92% pela Janete" do cartão de mensagens (5.3.4);
// - `ResumoPeriodo.autonomiaPct.variacaoPp`: a variação da autonomia em pontos percentuais;
// - `EtapaFunil.fraseQueda`: "31 saíram aqui: 19 perdidos, 12 sem resposta há mais de 7 dias" (5.4);
// - `Funil.fraseSaidas`: a leitura do capítulo "Para onde foram os que saíram" (8);
// - `Funil.movimentos`: o total de movimentos no funil, a Janete × a equipe (9);
// - `Agora.porEtapa`: os parados há mais de 7 dias de agora e o "Agora nesta etapa" (8);
// - `ID_TITULO_DASHBOARD` (em `dados/index.ts`): o id do h1 da versão (o foco da casca vai para ele).

export type IdPeriodo = "hoje" | "7d" | "30d" | "90d" | "personalizado";

/**
 * O período, com os dias em "AAAA-MM-DD" no fuso de São Paulo (inclusive nas duas pontas).
 * `rotulo`: "hoje", "nos últimos 30 dias", "de 01/10 a 15/10".
 * `rotuloComparacao`: "comparado com os 30 dias anteriores".
 * `anterior`: o período anterior de mesmo tamanho (o atual deslocado `dias` para trás).
 */
export interface Periodo {
  id: IdPeriodo;
  inicio: string;
  fim: string;
  dias: number;
  rotulo: string;
  rotuloComparacao: string;
  anterior: { inicio: string; fim: string };
}

/** Se a mudança é boa ou ruim (a versão pinta: verde melhora; âmbar ou vermelho piora; custo subir é âmbar). */
export type Sentido = "melhor" | "pior" | "neutro";

export interface Tendencia {
  atual: number | null;
  anterior: number | null;
  /** (atual − anterior) ÷ anterior × 100, com 1 casa. `null` quando o anterior é 0 ou falta um dos dois. */
  variacaoPct: number | null;
  sentido: Sentido;
}

/** Um ponto de uma série por dia: `dia` em "AAAA-MM-DD" (São Paulo). Toda série tem um ponto por dia do período, inclusive zeros. */
export interface PontoDia {
  dia: string;
  valor: number;
}

/** O enum `motivo_humano` do banco (Enums<"motivo_humano">). */
export type MotivoHumano = MotivoHumanoDoBanco;

export interface ProblemaPeriodo {
  id: string;
  /** O instante (ISO) em que aconteceu. */
  quando: string;
  tipo: "falha_ia" | "envio" | "midia" | "conexao";
  titulo: string;
  /** A causa provável, em linguagem simples. */
  causa: string;
  /** A ação: "Ver conversa" (Chat) ou "Abrir a Configuração" (só o admin recebe esta). */
  acao?: { rotulo: string; para: "/app/chat" | "/app/configuracao" };
  soAdmin: boolean;
}

export interface ResumoPeriodo {
  /** Leads com pelo menos 1 mensagem (de qualquer lado) no período. */
  conversas: Tendencia;
  /** Leads cuja 1ª mensagem caiu no período (coorte). */
  leadsNovos: Tendencia;
  /** Mensagens do lead, pela data da mensagem. */
  recebidas: Tendencia;
  /** Janete + equipe pela tela + celular, pela data da mensagem. */
  enviadas: Tendencia;
  enviadasPorOrigem: { janete: number; humano_tela: number; humano_celular: number };
  /** Extra: % das enviadas que saíram da Janete (1 casa), o "92% pela Janete"; `null` sem enviadas. */
  janetePctEnviadas: number | null;
  /** Mediana, nos leads novos, do 1º contato até a 1ª resposta (segundos). */
  primeiraRespostaS: Tendencia;
  /** Mediana, por resposta da Janete, da última mensagem do lead até a 1ª bolha dela (segundos). */
  respostaJaneteS: Tendencia;
  respostaJaneteP90S: number | null;
  /**
   * % das conversas sem mensagem humana e sem passagem para a equipe (1 casa). Extra:
   * `variacaoPp`, a diferença em pontos percentuais (79,2% − 78,2% = +1,0), com 1 casa; `null` como
   * o `variacaoPct`. Numa porcentagem, "+1,3%" (relativa) se confunde com "+1 ponto": a tela mostra
   * a variação de toda tendência por `variacaoDe` (formatar.ts), que escolhe os pontos quando há
   * `variacaoPp`. A definição muda só lá (em pontos: confirmado pelo equipe em 30/10/2026).
   */
  autonomiaPct: Tendencia & { variacaoPp: number | null };
  passados: { janetePassou: number; falha: number; porMotivo: Partial<Record<MotivoHumano, number>> };
  /** Do mais recente para o mais antigo. */
  problemas: ProblemaPeriodo[];
  series: {
    conversas: PontoDia[];
    recebidas: PontoDia[];
    enviadas: PontoDia[];
    /** Mediana da Janete no dia (segundos); 0 no dia sem resposta dela. */
    respostaJaneteS: PontoDia[];
    /** Só o admin. */
    custoUsd?: PontoDia[];
  };
}

/** Só o admin. Tudo em US$, pela data do gasto. É um piso (chamadas sem preço ficam fora do total). */
export interface CustoPeriodo {
  total: Tendencia;
  porConversaUsd: number | null;
  porGanhoUsd: number | null;
  /**
   * (custo do mês até agora ÷ dias corridos, com a fração do dia de hoje) × dias do mês. `null`
   * quando o período não termina hoje ou o mês tem menos de 3 dias corridos (a conta ainda não diz nada).
   */
  previsaoMesUsd: number | null;
  /** Chamadas sem preço no período. */
  semPreco: number;
  /** O onboarding entra no total, numa linha própria (decisão 9d); a voz da Janete também (D7 da spec do uso da voz). */
  porTipo: { resposta: number; transcricao: number; onboarding: number; fala: number };
  porModelo: { provedor: string; modelo: string; usd: number }[];
  /** Extra da fundação: custo de resposta de leads de fora da coorte (Σ custo por etapa + isto = porTipo.resposta). */
  foraDaCoorteUsd: number;
}

export interface EtapaFunil {
  etapaId: string;
  nome: string;
  ordem: number;
  tipo: "aberta" | "ganho";
  janetePodeMover: boolean;
  /** Passaram pela etapa ou por uma depois dela (sem contar Perdido). */
  chegaram: number;
  /** Chegaram à etapa seguinte. */
  avancaram: number;
  /** Estão hoje nesta etapa, abertos (no Ganho: os ganhos). */
  aindaEstao: number;
  /** Foram para Perdido saindo daqui, ou estão parados aqui há mais de 7 dias sem responder. */
  abandonaram: { total: number; perdido: number; semResposta: number };
  /** avançaram ÷ chegaram × 100 (1 casa); `null` no Ganho e com 0 chegada. */
  conversaoProxPct: number | null;
  /** Mediana, em horas, de quem já saiu da etapa. */
  tempoMedianoH: number | null;
  /** Só o admin: custo das respostas da Janete enquanto o lead estava na etapa. */
  custoUsd?: number;
  mensagens: { recebidas: number; enviadas: number };
  /** Quem moveu para a próxima etapa (soma = avançaram). */
  movimentos: { janete: number; equipe: number };
  passadosParaEquipe: number;
  entradasPorDia: PontoDia[];
  /** Leitura curta dos números da etapa (texto de apoio, não fala da Janete). */
  frase: string;
  /**
   * Extra: a queda depois da etapa, para o hover/foco do funil (5.4): "31 saíram aqui: 19 perdidos,
   * 12 sem resposta há mais de 7 dias"; "Ninguém saiu aqui" sem abandono; vazia no Ganho.
   */
  fraseQueda: string;
}

export interface Funil {
  etapas: EtapaFunil[];
  leadsNovos: number;
  ganhos: number;
  perdidos: number;
  taxaGanhoPct: number | null;
  cicloMedianoDias: number | null;
  perdidosPorOrigem: { etapaId: string; nome: string; perdido: number; semResposta: number }[];
  /** A leitura do funil todo ("Dos 174 leads que chegaram, 20 viraram venda (11%). A maior perda está ..."). */
  frase: string;
  /**
   * Extra: a leitura do capítulo "Para onde foram os que saíram" (8): "Saíram 64 leads: 31 perdidos
   * e 33 sem resposta há mais de 7 dias. A maior perda está entre Qualificado e Em negociação."
   */
  fraseSaidas: string;
  /** Extra: quem moveu os leads para a etapa seguinte no funil todo (a soma dos `movimentos` das etapas). */
  movimentos: { janete: number; equipe: number };
  /** O "Pergunte à Janete": 3 perguntas com respostas montadas a partir dos números (sem IA). */
  perguntas: { pergunta: string; resposta: string }[];
}

export interface ItemSaude {
  id: "whatsapp" | "motor" | "cerebro" | "escuta" | "contexto" | "problemas";
  titulo: string;
  detalhe: string;
  estado: "ok" | "atencao" | "parado";
  acao?: { rotulo: string; para: string };
}

export interface Agora {
  aguardando: {
    total: number;
    maisAntigaMin: number | null;
    /** Ordenados pela espera, da mais longa para a mais curta. */
    itens: {
      conversaId: string;
      contatoId: string;
      nome: string;
      motivoCurto: string;
      esperaMin: number;
      selo: "aguardando" | "falha";
    }[];
  };
  naoLidas: { conversas: number; mensagens: number };
  comQuem: { janete: number; membros: { nome: string; n: number }[]; celular: number };
  /** `digitando`: o nome de quem a Janete está respondendo agora, ou `null`. */
  janeteAtiva: { conversas: number; digitando: string | null };
  kanban: { etapaId: string; nome: string; tipo: "aberta" | "ganho" | "perdido"; n: number }[];
  esfriando: number;
  /**
   * Extra: por etapa visível (a mesma ordem do `kanban`), o que o capítulo dela mostra de agora (8):
   * - `paradosMais7d`: leads nesta etapa (só nas abertas) cuja última mensagem tem mais de 7 dias
   *   (a mesma regra do "sem resposta" do funil);
   * - `leads`: o "Agora nesta etapa", até 5, os há mais tempo na etapa primeiro; `desdeMin` é o tempo
   *   na etapa, em minutos; `conversaId` é `null` se o lead não tiver conversa.
   */
  porEtapa: {
    etapaId: string;
    paradosMais7d: number;
    leads: { contatoId: string; conversaId: string | null; nome: string; desdeMin: number }[];
  }[];
  saude: { geral: "ok" | "atencao" | "parado"; frase: string; itens: ItemSaude[] };
}

export interface ContextoPainel {
  preenchidos: number;
  total: number;
  versao: number | null;
}

export interface PainelDashboard {
  papel: "admin" | "atendente";
  periodo: Periodo;
  /** O período não tem nada: nenhum lead novo e nenhuma mensagem (ou a simulação "Período vazio"). */
  vazio: boolean;
  resumo: ResumoPeriodo;
  /** Só o admin. */
  custo?: CustoPeriodo;
  funil: Funil;
  agora: Agora;
  estadoJanete: "acordada" | "dormindo" | "carregando";
  /**
   * O cartão do Contexto: os campos preenchidos dos 8 e a versão atual (`contexto_versoes.numero`;
   * nula sem versão). No modo exemplo, o valor de exemplo da fundação (CONTEXTO_EXEMPLO).
   */
  contexto: ContextoPainel;
  /**
   * `saudacao`: o h1 ("Boa tarde, equipe"). `resumo`: a linha estática embaixo dela. `resultado`: a
   * frase do fim da página. `atualizado` (extra da fundação): "atualizado às 14:45".
   */
  textos: { saudacao: string; resumo: string; resultado: string; atualizado: string };
}

export type Simulacao = "normal" | "chave_sem_credito" | "whatsapp_caiu" | "periodo_vazio" | "carregando";

export type ResultadoSetPeriodo = { ok: true } | { ok: false; erro: "datas_invalidas" };

export interface ValorPainelDashboard {
  painel: PainelDashboard;
  /** O período está "carregando" (400 ms ao trocar, ou a simulação "Carregando"). O "agora" não recarrega. */
  carregando: boolean;
  idPeriodo: IdPeriodo;
  setPeriodo(id: IdPeriodo, personalizado?: { inicio: string; fim: string }): ResultadoSetPeriodo;
  simulacao: Simulacao;
  setSimulacao(s: Simulacao): void;
  /** 1ª vez do Dashboard nesta aba (decidido na montagem do provedor). */
  primeiraVez: boolean;
}

/**
 * O estado da leitura do painel (os 3 estados): `pronto` quando todas as leituras chegaram (só então
 * existe `usePainelDashboard()`); `erro` da 1ª leitura que falhou (com dado na tela, é a releitura que
 * falhou); `saudacao` para o h1 enquanto carrega. No modo exemplo, sempre pronto e sem erro.
 */
export interface EstadoPainelDashboard {
  pronto: boolean;
  erro: Erro | null;
  tentarDeNovo: () => void;
  saudacao: string;
}
