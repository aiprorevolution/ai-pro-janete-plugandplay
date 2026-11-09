import type {
  Conversa,
  Etapa,
  EstadoExemplo,
  EventoPassagem,
  Mensagem,
  OrigemPassagem,
  SituacaoConversa,
  TipoMensagem,
} from "../exemplo";

// Os tipos da tela de Contatos (docs/spec-contatos.md, "Contratos"). Só tipos: as leituras ficam em
// dados.ts e as peças em pecas.tsx.

/** As abas do perfil do contato. */
export type AbaPerfil = "resumo" | "conversa" | "linha" | "midias" | "ficha";

/** As abas de contador acima da tabela (decisão 8 do equipe). */
export type RecorteTabela = "todos" | "precisam" | "novos_hoje" | "com_janete" | "comigo";

/** As colunas que ordenam a tabela (decisão 9). */
export type ColunaOrdem = "contato" | "etapa" | "ultima" | "entrada";

/** O "Entrou em" do filtro: qualquer data, hoje, últimos 7 dias ou últimos 30 dias (dias de São Paulo). */
export type PeriodoEntrada = "qualquer" | "hoje" | "7" | "30";

export interface OrdemTabela {
  coluna: ColunaOrdem;
  direcao: "asc" | "desc";
}

export interface FiltrosTabela {
  busca: string;
  recorte: RecorteTabela;
  /** Vazio = todas as etapas. */
  etapaIds: readonly string[];
  entrada: PeriodoEntrada;
  ordem: OrdemTabela;
  /**
   * A página da tabela (0 = a primeira), de 50 em 50 (decisão 12 da spec de ligar as telas). Ausente
   * conta como 0; mudar a busca, a aba, o filtro ou a ordem volta para a primeira.
   */
  pagina?: number | undefined;
}

/**
 * Uma linha de `contatos_lista` (drizzle/migrations/0007), como o banco devolve no jsonb, mais o `id`
 * (= contato_id), para o tempo real tirar do cache o contato apagado pelo id (removerPorId).
 */
export interface LinhaContatoBanco {
  id: string;
  contato_id: string;
  nome: string | null;
  nome_whatsapp: string | null;
  telefone: string | null;
  email: string | null;
  empresa: string | null;
  etapa_id: string;
  etapa_ordem: number | null;
  primeira_mensagem_em: string | null;
  criado_em: string;
  entrou_em: string;
  ultima_mensagem_em: string | null;
  conversa: ConversaDaLinhaBanco | null;
}

/** A conversa resumida que vem em cada linha de `contatos_lista` (nula: o contato ainda não tem conversa). */
export interface ConversaDaLinhaBanco {
  id: string;
  modo: Conversa["modo"];
  responsavel_id: string | null;
  motivo_humano: Conversa["motivo_humano"];
  aguardando_humano_desde: string | null;
  ultima_mensagem_em: string | null;
  ultima_do_lead_em: string | null;
  ultima_da_janete_em: string | null;
  nao_lidas: number;
}

/** A página de `contatos_lista`, crua (a que fica no cache). */
export interface PaginaContatosBanco {
  total: number;
  linhas: LinhaContatoBanco[];
}

/** A página da tabela que a leitura entrega: as linhas dela e o total do filtro (sem a paginação). */
export interface PaginaTabela {
  total: number;
  linhas: LinhaTabela[];
}

/**
 * O que as leituras da tela usam do estado (o do exemplo inteiro, ou a "visão" do perfil montada com
 * as leituras do banco): as linhas, quem é você e quem a Janete está digitando agora.
 */
export type EstadoContatos = Pick<
  EstadoExemplo,
  "eu" | "membros" | "etapas" | "contatos" | "conversas" | "mensagens" | "historico" | "digitando" | "conexao"
> & {
  /** As passagens do bastão: as do exemplo e, no banco, as de `conversa_eventos` (com "voltou para a fila"). */
  eventos: readonly EventoContato[];
};

/** Uma passagem do bastão como a tela de Contatos lê: a do exemplo, mais o "voltou para a fila" do banco. */
export type EventoContato = Omit<EventoPassagem, "tipo" | "de"> & {
  tipo: EventoPassagem["tipo"] | "voltou_para_fila";
  de: OrigemPassagem | null;
};

/** O número de cada aba de contador. */
export type Contadores = Record<RecorteTabela, number>;

export interface QuemAtende {
  /** De exemplo/regras: janete | aguardando | falha | membro | celular. */
  tipo: SituacaoConversa;
  /** "A Janete", "Você", "Marina", "Esperando a equipe", "Celular da empresa". */
  nome: string;
  membroId: string | null;
  /** aguardando_humano_desde. */
  esperaDesde: string | null;
  /** janeteAtivaAgora (só com a Janete). */
  aoVivo: boolean;
}

export interface LinhaTabela {
  contatoId: string;
  conversaId: string | null;
  nome: string;
  empresa: string | null;
  etapa: Pick<Etapa, "id" | "chave" | "nome" | "cor" | "ordem" | "tipo">;
  quem: QuemAtende;
  ultimaMensagemEm: string | null;
  /** primeira_mensagem_em ?? criado_em. */
  entrouEm: string;
}

/** Os filtros da linha do tempo: etapas, atendimento e mensagens. */
export type GrupoAcontecimento = "etapas" | "atendimento" | "mensagens";

export interface Acontecimento {
  id: string;
  tipo:
    | "criado"
    | "primeira_mensagem"
    | "etapa"
    | "passou"
    | "assumiu"
    | "devolveu"
    | "celular"
    | "voltou_para_fila"
    | "midia";
  grupo: GrupoAcontecimento;
  em: string;
  titulo: string;
  descricao: string | null;
  quem: { tipo: "janete" | "membro" | "sistema" | "lead" | "celular"; nome: string };
  /** A etapa em que o contato estava naquele momento, pelo histórico. */
  etapaId: string | null;
  /** A mensagem de origem, para o "Ver na conversa". */
  mensagemId: string | null;
}

export interface MidiaDoContato {
  mensagemId: string;
  tipo: TipoMensagem;
  nome: string;
  autor: string;
  em: string;
  duracaoS: number | null;
  tamanho: number | null;
  transcricao: string | null;
  /** No banco: o arquivo no bucket `midias` (a miniatura abre pelo link assinado). Nulo no exemplo. */
  caminho: string | null;
  /** No banco: a situação da cópia do WhatsApp (pendente, falhou, expirada). Nula quando está pronta ou no exemplo. */
  status: Mensagem["midia_status"];
}

// Os fatos que a Janete anotou e o próximo passo que ela sugere: no banco, `contatos.anotacoes_janete`,
// lido pelo dados/conversa.ts (useContato) para os mesmos campos do exemplo. Só para ler (decisão 12).
export type { FatoJanete, ProximoPasso } from "../exemplo";

/** O que toda aba do perfil recebe. */
export interface PropsAba {
  contatoId: string;
  agora: number;
  irParaAba(aba: AbaPerfil): void;
  verNaConversa(mensagemId: string): void;
  avisar(texto: string): void;
}
