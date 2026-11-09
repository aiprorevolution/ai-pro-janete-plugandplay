import type { Tables } from "@/integrations/firebase/types";

import type {
  Configuracao,
  Contato,
  Conversa,
  ErroExemplo,
  HistoricoEtapa,
  Membro,
  Mensagem,
} from "../exemplo/tipos";

// Os tipos da camada de dados (spec de ligar as telas ao banco, 2.1). As linhas das tabelas
// continuam as do exemplo (`exemplo/tipos.ts`, Picks das colunas reais); aqui ficam o erro, o
// resultado das ações e a forma das leituras, iguais nos dois modos (banco e exemplo).

/**
 * O que uma ação ou leitura pode devolver de errado. Os do exemplo, mais os que só o banco dá:
 * - `sem_acesso`: a conta não é membro ativo, ou não é admin onde precisa (42501 ou P0001);
 * - `etapa_arquivada`: mover para uma etapa arquivada;
 * - `contexto_mudou`: outro admin mudou o mesmo campo do Contexto (decisão 11);
 * - `nao_reenviavel`: a mensagem pode ter chegado, não dá para tentar de novo (decisão 8);
 * - `limite_tamanho`: passou do limite (2.000 letras por campo do Contexto, ou um check de tamanho);
 * - `limite_itens`: o Contexto passaria de 50 perguntas livres (P0001 do `contexto_salvar`);
 * - `falha`: rede, erro desconhecido ou recusa que a tela não trata (o `detalhe` traz o texto cru).
 */
export type Erro =
  | ErroExemplo
  | "sem_acesso"
  | "etapa_arquivada"
  | "contexto_mudou"
  | "nao_reenviavel"
  | "limite_tamanho"
  | "limite_itens"
  | "falha";

/**
 * O resultado de toda ação. Nunca lança: a recusada devolve o erro.
 * `id` é o da linha criada (a mensagem enviada); `assumiu` diz que a ação tirou a conversa da Janete,
 * da espera ou do celular; `valor` é o que a função devolveu (o "visto em" de `marcarVisto`).
 */
export type Resultado<T = undefined> =
  | { ok: true; id?: string | undefined; assumiu?: boolean | undefined; valor?: T | undefined }
  | { ok: false; erro: Erro; detalhe?: string | undefined };

/** Uma leitura: os dados (ausentes enquanto carrega ou depois de um erro), o estado e o "Tentar de novo". */
export interface Leitura<T> {
  dados: T | undefined;
  carregando: boolean;
  erro: Erro | null;
  tentarDeNovo: () => void;
}

/** Onde a pessoa marcou "visto" (decisão 13 do Kanban e decisão 15 do tour). */
export type OndeVisto = "kanban" | "tour";

/** O "visto em" por pessoa: `{ kanban: iso, tour: iso }` (coluna `membros.vistos`). */
export type Vistos = Partial<Record<OndeVisto, string>>;

/** A coluna `membros.vistos` (jsonb) como a tela usa: só as chaves conhecidas, com texto; o resto sai. */
export function lerVistos(json: unknown): Vistos {
  const vistos: Vistos = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return vistos;
  const o = json as Record<string, unknown>;
  for (const onde of ["kanban", "tour"] as const) {
    const v = o[onde];
    if (typeof v === "string" && v) vistos[onde] = v;
  }
  return vistos;
}

/** Quem está usando a plataforma (a linha dele em `membros`) e se é admin. */
export interface Eu {
  membro: Membro & { vistos: Vistos };
  ehAdmin: boolean;
}

/** A configuração da empresa, com o último sinal do worker (`worker_visto_em`; nulo = nunca rodou). */
export type ConfiguracaoDados = Configuracao & { worker_visto_em: string | null };

/**
 * A regra dos 3 min (spec-motor-acordado, decisão 3): trabalho esperando há mais que isto (o
 * `atrasado_desde` do motor_pendencias), a Saúde avisa que a Janete está atrasada. Um lugar só para a
 * Configuração e o Dashboard contarem igual.
 */
export const MOTOR_ATRASADO_APOS_MS = 3 * 60_000;

/**
 * O que o motor tem para fazer (a rpc motor_pendencias, spec-motor-acordado), em ms do relógio.
 * Nulo = nada daquele tipo. `atrasadoDesde` é o `vencidoDesde` sem os eventos do webhook.
 */
export interface PendenciasMotor {
  /** O próximo trabalho que fica pronto (no futuro). */
  proximoEm: number | null;
  /** O trabalho pronto mais antigo, de qualquer tipo. */
  vencidoDesde: number | null;
  /** O trabalho pronto mais antigo, sem os eventos do webhook (é ele que vira o aviso). */
  atrasadoDesde: number | null;
}

/**
 * Quantas letras o texto tem, como o banco conta (`char_length`, por ponto de código): um emoji
 * conta 1, e não 2 como no `.length` do JavaScript. É a régua do limite de 2.000 (decisão 11d).
 */
export function contarLetras(texto: string): number {
  let n = 0;
  for (const _ of texto) n += 1;
  return n;
}

/** O texto cortado em `limite` letras (pontos de código), sem partir um emoji ao meio. */
export function cortarLetras(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  return Array.from(texto).slice(0, limite).join("");
}

/**
 * A versão atual do Contexto, como o banco guarda. `numero` é 1, 2, 3, sem buracos (o gatilho
 * contexto_numerar); `restaurada_de` é a versão de onde a restauração veio (nula nas outras).
 */
export type VersaoContextoBanco = Pick<
  Tables<"contexto_versoes">,
  | "id"
  | "empresa_oferta"
  | "cliente_ideal"
  | "preco"
  | "diferenciais"
  | "objecoes"
  | "quando_passar_humano"
  | "tom_voz"
  | "horario"
  | "itens"
  | "origem"
  | "criado_por"
  | "criado_em"
> & {
  /** `contexto_versoes.numero` (nulo só no modo exemplo, quando o teste não passa). */
  numero: number | null;
  /** `contexto_versoes.restaurada_de`. */
  restaurada_de: number | null;
};

/* ---------- as leituras de conversa (dados/conversa.ts): Chat, Kanban e Contatos ---------- */

/**
 * Uma conversa, com as colunas novas do pacote do banco. No modo exemplo as duas não existem (o
 * exemplo não guarda), e ficam ausentes.
 */
export type ConversaDados = Conversa & Partial<Pick<Tables<"conversas">, "ultima_mensagem_id" | "ultima_da_janete_em">>;

/**
 * Uma mensagem, com o que a Bolha usa: `id_externo` e `id_gateway` (o "Tentar de novo"),
 * `responde_a_id` (a citação) e `midia_duracao_s` (o tempo do áudio). No modo exemplo, a citação e a
 * duração vêm nos extras `citaId` e `duracaoS`, e as colunas novas, preenchidas a partir deles.
 */
export type MensagemDados = Mensagem &
  Pick<Tables<"mensagens">, "responde_a_id" | "midia_duracao_s"> &
  Partial<Pick<Tables<"mensagens">, "id_externo" | "id_gateway">>;

/**
 * Um contato, com o resumo da Janete datado e as anotações dela. No modo banco, `fatosJanete` e
 * `proximoPasso` (os extras de tela do exemplo) saem de `anotacoes_janete`, para a tela ler igual nos
 * dois modos (decisão 12: só para ler).
 */
export type ContatoDados = Contato & Partial<Pick<Tables<"contatos">, "resumo_janete_em" | "anotacoes_janete">>;

/** Uma linha do histórico de etapas, com a rodada da Janete que moveu (nula quando foi uma pessoa ou o sistema). */
export type HistoricoContato = HistoricoEtapa & { rodada_id: string | null };

/** Uma linha de `conversa_eventos` (as passagens do bastão, decisão 8), com as colunas que a tela usa. */
export type EventoConversaDados = Pick<
  Tables<"conversa_eventos">,
  "id" | "conversa_id" | "tipo" | "membro_id" | "de" | "de_membro_id" | "motivo" | "por_envio" | "criado_em"
>;

/** O custo de IA por conversa, em dólar: `{ [conversa_id]: custo_usd }`. A conversa sem custo vem com 0. */
export type CustosConversas = Readonly<Record<string, number>>;

/**
 * As mensagens de uma conversa, paginadas: as mais recentes chegam primeiro, e "carregar mais antigas"
 * busca a página de antes. `dados` vem sempre na ordem da conversa (a mais antiga primeiro), juntando
 * as páginas já lidas.
 */
export interface LeituraMensagens extends Leitura<MensagemDados[]> {
  /** Há mensagens antes da mais antiga já lida. */
  temMaisAntigas: boolean;
  /** Busca a página anterior (não faz nada sem `temMaisAntigas` ou enquanto busca). */
  carregarMaisAntigas: () => void;
  carregandoMaisAntigas: boolean;
}

/** Os dois modos da camada: o banco de verdade ou o exemplo em memória (testes). */
export type ModoDados = "banco" | "exemplo";
