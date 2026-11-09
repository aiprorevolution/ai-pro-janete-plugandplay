import type { NomeAcao } from "./fonte";

// As chaves do React Query (spec 2.1, chaves.ts) e a tabela "ação → o que ela atualiza" (plano,
// "Peças comuns", item 8). Cada leitura fica embaixo de uma raiz; as áreas acrescentam o resto
// (`[...CHAVES.mensagens, conversaId]`), e invalidar a raiz invalida tudo embaixo dela.
//
// A regra: toda ação invalida pelas TABELAS que ela muda, nunca pela tela. POR_TABELA diz quais
// raízes leem cada tabela; TABELAS_DA_ACAO diz quais tabelas cada ação muda (inclusive pelos
// gatilhos); INVALIDA junta as duas. O tempo real (tempoReal.tsx) usa o mesmo POR_TABELA.

export const CHAVES = {
  /** A linha de quem usa (membros). */
  eu: ["eu"],
  membros: ["membros"],
  etapas: ["etapas"],
  /** A conexão ativa do WhatsApp. */
  conexao: ["conexao"],
  configuracao: ["configuracao"],
  /** A versão atual e o histórico do Contexto. */
  contexto: ["contexto"],
  /** "Precisam de você" (o contador do Chat e a fila). */
  aguardando: ["aguardando"],
  /** As chaves de IA. */
  chaves: ["chaves"],
  /**
   * Listas e detalhes de conversas (Chat, Kanban, Contatos). dados/conversa.ts usa
   * `[...conversas, "uma", id]` e `[...conversas, "do-contato", contatoId]`.
   */
  conversas: ["conversas"],
  /** As mensagens de cada conversa: `[...mensagens, conversaId]` (paginada, dados/conversa.ts). */
  mensagens: ["mensagens"],
  /** A tabela, os contadores e o perfil dos Contatos; o contato: `[...contatos, "um", id]`. */
  contatos: ["contatos"],
  /** O histórico de etapas (linha do tempo, "desde que você saiu"): `[...historico, contatoId]`. */
  historico: ["historico"],
  /** As passagens do bastão (conversa_eventos): `[...eventos, conversaId]`. */
  eventos: ["eventos"],
  /** O custo de IA por conversa (só o admin): `[...custos, "conversas", ...ids em ordem]`. */
  custos: ["custos"],
  /** O "agora" do Dashboard (no tempo real: as tabelas de POR_TABELA invalidam). */
  dashboard: ["dashboard"],
  /**
   * Os números do período do Dashboard (dashboard_periodo, _funil, _custo e _problemas). Fica FORA de
   * POR_TABELA e de INVALIDA de propósito: a leitura já relê a cada 60 s e no foco, e reler a passada
   * inteira do período a cada mensagem custaria 6 a 9 chamadas ao banco por aviso do tempo real.
   */
  dashboardPeriodo: ["dashboard-periodo"],
  /** O quadro do Kanban (colunas, Ganho e Perdido de 30 dias, busca). */
  quadro: ["quadro"],
  /** Os convites pendentes da Equipe. */
  convites: ["convites"],
  auditoria: ["auditoria"],
  /** Os links assinados das mídias (midia.ts); não entram em INVALIDA, vencem sozinhos. */
  midias: ["midias"],
  /**
   * O que o motor tem para fazer (motor_pendencias, dados/motor.ts). Fica fora de POR_TABELA e de
   * INVALIDA: a leitura junta 5 tabelas e já relê a cada 60 s e no foco.
   */
  motor: ["motor"],
} as const;

export type ChaveRaiz = keyof typeof CHAVES;

/** As tabelas que as telas leem (as de hoje e as do pacote do banco). */
export type Tabela =
  | "membros"
  | "etapas"
  | "conexoes"
  | "configuracao"
  | "contexto_versoes"
  | "conversas"
  | "mensagens"
  | "contatos"
  | "contato_etapa_historico"
  | "conversa_eventos"
  | "rodadas"
  | "ia_chamadas"
  | "ia_chaves"
  | "auditoria"
  | "convites";

/** Quem lê cada tabela: quando ela muda, essas raízes ficam velhas. */
export const POR_TABELA: Readonly<Record<Tabela, readonly ChaveRaiz[]>> = {
  // o nome do topo, o papel, o "Com você" e a Equipe
  membros: ["eu", "membros"],
  // o Chat mostra a etapa, os Contatos filtram por ela, o Kanban é ela, o Dashboard conta o funil
  etapas: ["etapas", "conversas", "contatos", "quadro", "dashboard"],
  // a casca (rodapé do WhatsApp) e as caixas de escrever leem a conexão ativa
  conexoes: ["conexao"],
  configuracao: ["configuracao"],
  // a empresa e o tom no topo, e a tela do Contexto
  contexto_versoes: ["contexto"],
  conversas: ["conversas", "aguardando", "contatos", "quadro", "dashboard"],
  mensagens: ["mensagens", "conversas", "quadro", "dashboard"],
  contatos: ["contatos", "conversas", "quadro", "dashboard"],
  contato_etapa_historico: ["historico", "quadro", "dashboard"],
  conversa_eventos: ["eventos", "dashboard"],
  // o custo; e o motivo do movimento da Janete, que o histórico lê pela rodada (rodada_id)
  rodadas: ["custos", "dashboard", "historico"],
  ia_chamadas: ["custos", "dashboard"],
  ia_chaves: ["chaves"],
  auditoria: ["auditoria"],
  convites: ["convites"],
};

/** As tabelas que cada ação muda, contando os gatilhos e as funções do banco. */
export const TABELAS_DA_ACAO: Readonly<Record<NomeAcao, readonly Tabela[]>> = {
  // a mensagem; a conversa (prévia, modo, responsável) e o evento "assumiu" pelo tg_mensagens_apos_inserir
  enviarMensagem: ["mensagens", "conversas", "conversa_eventos"],
  // a conversa; o que a Janete tinha na fila vira cancelada; o evento "assumiu"
  assumir: ["conversas", "mensagens", "conversa_eventos"],
  devolverParaJanete: ["conversas", "conversa_eventos"],
  marcarLida: ["conversas"],
  // a mensagem volta para na_fila (e a prévia da conversa)
  tentarDeNovo: ["mensagens", "conversas"],
  // contatos.etapa_id; o histórico pelo gatilho
  moverEtapa: ["contatos", "contato_etapa_historico"],
  editarContato: ["contatos"],
  editarEtapa: ["etapas"],
  reordenarEtapas: ["etapas"],
  // a cascata leva a conversa, as mensagens, o histórico e os eventos; a auditoria guarda o nome
  apagarContato: [
    "contatos",
    "conversas",
    "mensagens",
    "contato_etapa_historico",
    "conversa_eventos",
    "rodadas",
    "ia_chamadas",
    "auditoria",
  ],
  marcarVisto: ["membros"],
};

function raizesDe(tabelas: readonly Tabela[]): ChaveRaiz[] {
  const vistas = new Set<ChaveRaiz>();
  for (const t of tabelas) for (const r of POR_TABELA[t]) vistas.add(r);
  return [...vistas];
}

/** Ação → as raízes que ela deixa velhas (as de todas as tabelas que ela muda). */
export const INVALIDA: Readonly<Record<NomeAcao, readonly ChaveRaiz[]>> = Object.fromEntries(
  (Object.keys(TABELAS_DA_ACAO) as NomeAcao[]).map((acao) => [acao, raizesDe(TABELAS_DA_ACAO[acao])]),
) as Record<NomeAcao, ChaveRaiz[]>;

/** As raízes que uma tabela deixa velhas (o tempo real usa). */
export function raizesDaTabela(tabela: string): readonly ChaveRaiz[] {
  return (POR_TABELA as Record<string, readonly ChaveRaiz[] | undefined>)[tabela] ?? [];
}
