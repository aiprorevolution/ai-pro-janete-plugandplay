// Funções finas sobre o firebaseAdmin para a mensageria (spec do banco, "Funções e gatilhos").
// Só roda no servidor. Erro do banco vira ErroBanco com um código curto, nunca com os detalhes
// do PostgREST (que podem trazer a linha recusada e, com ela, dado pessoal ou segredo).
import { firebaseAdmin } from "@/integrations/firebase/client.server";
import type { Database, Json } from "@/integrations/firebase/types";

import type { GatewayId, Identificador, MensagemNormalizada, StatusGateway } from "./tipos";

type Tabelas = Database["public"]["Tables"];
type Funcoes = Database["public"]["Functions"];

export type Rodada = Tabelas["rodadas"]["Row"];
export type MensagemFila = Funcoes["pegar_envios"]["Returns"][number];
export type EventoPendente = Pick<
  Tabelas["eventos_webhook"]["Row"],
  "id" | "gateway" | "conexao_id" | "payload" | "tentativas"
>;

/** Falha numa chamada ao banco. message = "<operação>:<código>", sem detalhe. */
export class ErroBanco extends Error {
  readonly operacao: string;
  readonly codigo: string;
  constructor(operacao: string, codigo: string) {
    super(`${operacao}:${codigo}`);
    this.name = "ErroBanco";
    this.operacao = operacao;
    this.codigo = codigo;
  }
}

type ErroPostgrest = { code?: string; message?: string } | null;

// Códigos levantados pelas nossas funções (raise exception '<codigo>', errcode P0001) são
// seguros; os outros ficam só com o código do Postgres.
function falha(operacao: string, erro: ErroPostgrest): ErroBanco {
  const codigo = erro?.code ?? "desconhecido";
  const msg = erro?.message ?? "";
  if (codigo === "P0001" && /^[a-z_]{1,60}$/.test(msg)) return new ErroBanco(operacao, msg);
  return new ErroBanco(operacao, codigo);
}

// ---------------------------------------------------------------------------
// Entrada (webhook)
// ---------------------------------------------------------------------------

export type MsgBanco = MensagemNormalizada & { evento_id?: number };

export async function registrarEntrada(
  conexaoId: string,
  ids: Identificador[],
  nomeWhatsapp: string | undefined,
  msg: MsgBanco,
): Promise<{ mensagem_id: string | null; conversa_id: string | null; nova: boolean }> {
  const { data, error } = await firebaseAdmin.rpc("registrar_entrada", {
    p_conexao: conexaoId,
    p_ids: ids as unknown as Json,
    p_nome_whatsapp: nomeWhatsapp ?? "",
    p_msg: msg as unknown as Json,
  });
  if (error) throw falha("registrar_entrada", error);
  const linha = Array.isArray(data) ? data[0] : data;
  return {
    mensagem_id: linha?.mensagem_id ?? null,
    conversa_id: linha?.conversa_id ?? null,
    nova: Boolean(linha?.nova),
  };
}

export async function registrarSaidaCelular(
  conexaoId: string,
  ids: Identificador[],
  msg: MsgBanco,
): Promise<string | null> {
  const { data, error } = await firebaseAdmin.rpc("registrar_saida_celular", {
    p_conexao: conexaoId,
    p_ids: ids as unknown as Json,
    p_msg: msg as unknown as Json,
  });
  if (error) throw falha("registrar_saida_celular", error);
  return (data as string | null) ?? null;
}

/** Devolve quantas mensagens casaram. 0 = o evento fica para nova tentativa. */
export async function atualizarStatus(
  conexaoId: string,
  id: string,
  status: StatusGateway,
  momento: string,
): Promise<number> {
  const { data, error } = await firebaseAdmin.rpc("atualizar_status", {
    p_conexao: conexaoId,
    p_id: id,
    p_status: status,
    p_momento: momento,
  });
  if (error) throw falha("atualizar_status", error);
  return typeof data === "number" ? data : Number(data ?? 0);
}

export async function atualizarStatusConexao(
  conexaoId: string,
  status: "conectada" | "desconectada" | "erro",
  detalhe?: string,
): Promise<void> {
  const ultimoErro = status === "conectada" ? null : (detalhe ?? status).slice(0, 300);
  const { data, error } = await firebaseAdmin
    .from("conexoes")
    .update({ status, ultimo_erro: ultimoErro, atualizado_em: new Date().toISOString() })
    .eq("id", conexaoId)
    .select("id");
  if (error) throw falha("atualizar_conexao", error);
  if (!data || data.length === 0)
    throw new ErroBanco("atualizar_conexao", "conexao_nao_encontrada");
}

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

export async function pegarRodadas(limite: number): Promise<Rodada[]> {
  const { data, error } = await firebaseAdmin.rpc("pegar_rodadas", { p_limite: limite });
  if (error) throw falha("pegar_rodadas", error);
  return (data ?? []) as Rodada[];
}

export async function falharRodada(
  rodadaId: string,
  motivo: Database["public"]["Enums"]["motivo_humano"],
  passageiro: boolean,
): Promise<void> {
  const { error } = await firebaseAdmin.rpc("falhar_rodada", {
    p_rodada: rodadaId,
    p_motivo: motivo,
    p_passageiro: passageiro,
  });
  if (error) throw falha("falhar_rodada", error);
}

export async function pegarEnvios(limite: number): Promise<MensagemFila[]> {
  const { data, error } = await firebaseAdmin.rpc("pegar_envios", { p_limite: limite });
  if (error) throw falha("pegar_envios", error);
  return (data ?? []) as MensagemFila[];
}

export async function concluirEnvio(
  mensagemId: string,
  idExterno?: string | null,
  idGateway?: string | null,
): Promise<void> {
  // A função trata texto vazio como nulo.
  const { error } = await firebaseAdmin.rpc("concluir_envio", {
    p_msg: mensagemId,
    p_id_externo: idExterno ?? "",
    p_id_gateway: idGateway ?? "",
  });
  if (error) throw falha("concluir_envio", error);
}

export async function falharEnvio(
  mensagemId: string,
  erro: string,
  definitivo: boolean,
): Promise<void> {
  const { error } = await firebaseAdmin.rpc("falhar_envio", {
    p_msg: mensagemId,
    p_erro: erro,
    p_definitivo: definitivo,
  });
  if (error) throw falha("falhar_envio", error);
}

export async function pegarMidias(limite: number): Promise<MensagemFila[]> {
  const { data, error } = await firebaseAdmin.rpc("pegar_midias", { p_limite: limite });
  if (error) throw falha("pegar_midias", error);
  return (data ?? []) as MensagemFila[];
}

export async function concluirMidia(
  mensagemId: string,
  caminho: string,
  mime: string,
  tamanho: number,
  ok: boolean,
): Promise<void> {
  const { error } = await firebaseAdmin.rpc("concluir_midia", {
    p_msg: mensagemId,
    p_caminho: caminho,
    p_mime: mime,
    p_tamanho: tamanho,
    p_ok: ok,
  });
  if (error) throw falha("concluir_midia", error);
}

/**
 * Erro definitivo na cópia (por exemplo midia_grande_demais): a mídia pendente vira 'falhou'
 * na hora, sem gastar as outras tentativas. A já copiada ou já falhada fica como está.
 */
export async function desistirMidia(mensagemId: string, erro: string): Promise<void> {
  const { error } = await firebaseAdmin.rpc("desistir_midia", { p_msg: mensagemId, p_erro: erro });
  if (error) throw falha("desistir_midia", error);
}

// ---------------------------------------------------------------------------
// eventos_webhook
// ---------------------------------------------------------------------------

export async function gravarEvento(
  gateway: GatewayId,
  conexaoId: string,
  idEvento: string | null,
  tipo: string | null,
  payload: unknown,
): Promise<{ duplicado: true } | { duplicado: false; id: number }> {
  const { data, error } = await firebaseAdmin.rpc("registrar_evento_webhook", {
    p_gateway: gateway,
    p_conexao: conexaoId,
    p_id_evento: idEvento,
    p_tipo: tipo,
    p_payload: payload as Json,
  });
  if (error) throw falha("gravar_evento", error);
  if (data?.duplicado === true) return { duplicado: true };
  if (!data || typeof data.id !== "number") throw new ErroBanco("gravar_evento", "resposta_invalida");
  return { duplicado: false, id: data.id };
}

export async function marcarEventoProcessado(id: number): Promise<void> {
  const { error } = await firebaseAdmin
    .from("eventos_webhook")
    .update({ processado_em: new Date().toISOString(), erro: null })
    .eq("id", id);
  if (error) throw falha("marcar_evento", error);
}

/**
 * Deixa o evento pendente, com o erro (até 200 caracteres) e mais uma tentativa, e solta a trava
 * do pegar_eventos_pendentes: falhar_evento, num comando só. Evento já processado não muda.
 */
export async function marcarEventoComErro(id: number, erro: string): Promise<void> {
  const { error } = await firebaseAdmin.rpc("falhar_evento", {
    p_id: id,
    p_erro: erro.slice(0, 200),
  });
  if (error) throw falha("marcar_evento_erro", error);
}

/**
 * Pega até `limite` eventos não processados, com menos de 5 tentativas, recebidos há mais de 30 s
 * e sem trava (pegar_eventos_pendentes: SKIP LOCKED e pego_em de 2 min). Duas passadas ao mesmo
 * tempo não pegam o mesmo evento. A limpeza dos eventos antigos é do relógio do banco
 * (manutencao_janete), não do motor.
 */
export async function eventosPendentes(limite: number): Promise<EventoPendente[]> {
  const { data, error } = await firebaseAdmin.rpc("pegar_eventos_pendentes", { p_limite: limite });
  if (error) throw falha("eventos_pendentes", error);
  return (data ?? []) as EventoPendente[];
}

// ---------------------------------------------------------------------------
// Contato e mensagem
// ---------------------------------------------------------------------------

const PRIORIDADE: Record<Identificador["tipo"], number> = {
  bsuid: 1,
  lid: 2,
  telefone: 3,
  zernio_conversa: 4,
};

/**
 * Os identificadores do contato da conversa, na prioridade do banco. Com a conexão, o id de
 * conversa da Zernio de outra conexão (outra conta, depois de trocar de número) fica de fora:
 * ele não vale na conta atual. Os de conexão desconhecida vêm depois dos desta.
 */
export async function destinoDoContato(
  conversaId: string,
  conexaoId?: string,
): Promise<Identificador[]> {
  const { data: conversa, error } = await firebaseAdmin
    .from("conversas")
    .select("contato_id")
    .eq("id", conversaId)
    .maybeSingle();
  if (error) throw falha("destino_conversa", error);
  if (!conversa) return [];
  const { data, error: e2 } = await firebaseAdmin
    .from("contato_identificadores")
    .select("tipo, valor, conexao_id")
    .eq("contato_id", conversa.contato_id);
  if (e2) throw falha("destino_identificadores", e2);
  const linhas = (data ?? []) as {
    tipo: Identificador["tipo"];
    valor: string;
    conexao_id?: string | null;
  }[];
  const daConexao = (l: (typeof linhas)[number]) =>
    !conexaoId || l.tipo !== "zernio_conversa" || l.conexao_id === conexaoId ? 0 : 1;
  return linhas
    .filter(
      (l) =>
        !conexaoId ||
        l.tipo !== "zernio_conversa" ||
        l.conexao_id === conexaoId ||
        l.conexao_id == null,
    )
    .sort((a, b) => PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo] || daConexao(a) - daConexao(b))
    .map((l) => ({ tipo: l.tipo, valor: l.valor }));
}

/**
 * Citação no envio: o id_externo da mensagem citada, só se ela é da mesma conexão (o id de
 * outra conexão, de antes de trocar de número ou de gateway, não vale no gateway atual).
 * null = sem id_externo ou de outra conexão: o envio sai sem citação.
 */
export async function idExternoDaMensagem(
  mensagemId: string,
  conexaoId: string,
): Promise<string | null> {
  const { data, error } = await firebaseAdmin
    .from("mensagens")
    .select("id_externo, conexao_id")
    .eq("id", mensagemId)
    .maybeSingle();
  if (error) throw falha("citacao_mensagem", error);
  if (!data || data.conexao_id !== conexaoId) return null;
  const id = (data.id_externo ?? "").trim();
  return id === "" ? null : id;
}

/**
 * Sinal de vida do worker: configuracao.worker_visto_em = agora, na linha única (id 1). A Saúde
 * da Configuração avisa quando ele passa 3 min sem rodar (decisão 10). Nunca lança: a falha só
 * vai para o log (só o código, sem detalhe), porque o laço do worker não pode parar por isso.
 * true = gravou.
 */
export async function marcarWorkerVisto(agora: Date = new Date()): Promise<boolean> {
  try {
    const { data, error } = await firebaseAdmin
      .from("configuracao")
      .update({ worker_visto_em: agora.toISOString() })
      .eq("id", 1)
      .select("id");
    if (error) throw falha("worker_visto", error);
    if (!data || data.length === 0) throw new ErroBanco("worker_visto", "sem_configuracao");
    return true;
  } catch (erro) {
    console.error(
      "worker_visto_falhou",
      erro instanceof ErroBanco ? erro.message : "worker_visto:desconhecido",
    );
    return false;
  }
}

export async function gravarTranscricao(mensagemId: string, texto: string): Promise<void> {
  const { data, error } = await firebaseAdmin
    .from("mensagens")
    .update({ transcricao: texto })
    .eq("id", mensagemId)
    .select("id");
  if (error) throw falha("gravar_transcricao", error);
  if (!data || data.length === 0)
    throw new ErroBanco("gravar_transcricao", "mensagem_nao_encontrada");
}
