// Escritas da Configuração que não estão no núcleo: desligar e conferir a conexão, regravar a
// conexão da Meta com um campo consertado, mudar a chave de IA sem colar de novo, o ritmo e a
// voz em uso (a voz escolhida, o modo e o erro da voz).
// Usa o firebaseAdmin (ignora RLS), por isso só entra por configuracao.server.ts, pela
// lógica em acoes.server.ts, que as funções de servidor carregam por import() no handler, e
// pelo nucleo/parar-fila.server.ts (a fila parada no Desconectar e no Trocar), também só de servidor.
// Toda escrita pede .select("id") e trata 0 linhas como falha. Nenhum erro cita valor de
// segredo: só o código da operação.
import {
  MODO_VOZ_PADRAO,
  MODOS_VOZ,
  VOZ_ID,
  type ModoVoz,
  type VozEscolhida,
} from "@/features/servidor/vozes-tipos";
import { firebaseAdmin } from "@/integrations/firebase/client.server";
import type { Database, Json } from "@/integrations/firebase/types";

import { aadConexao, cifrar } from "../nucleo/cifra";

type Finalidade = Database["public"]["Enums"]["ia_finalidade"];
type Provedor = Database["public"]["Enums"]["ia_provedor"];
type StatusChave = Database["public"]["Enums"]["chave_status"];
type StatusConexao = Database["public"]["Enums"]["conexao_status"];
type LinhaAuditoria = Database["public"]["Tables"]["auditoria"]["Insert"];

function falhaBanco(operacao: string): Error {
  return new Error(`banco_${operacao}`);
}

function exigirUmaLinha(r: { data: unknown[] | null; error: unknown }, operacao: string): void {
  if (r.error || !r.data || r.data.length !== 1) throw falhaBanco(operacao);
}

/** Auditoria é melhor esforço: a escrita principal já deu certo e não é desfeita. */
export async function auditar(linha: LinhaAuditoria): Promise<void> {
  try {
    const r = await firebaseAdmin.from("auditoria").insert(linha).select("id");
    exigirUmaLinha(r, "auditoria");
  } catch {
    console.error("auditoria_falhou", linha.acao);
  }
}

// ---------- conexão ----------

/** id da conexão ativa (no máximo uma). null = nenhuma. */
export async function idConexaoAtiva(): Promise<string | null> {
  const { data, error } = await firebaseAdmin
    .from("conexoes")
    .select("id")
    .eq("ativa", true)
    .maybeSingle();
  if (error) throw falhaBanco("ler_conexao");
  return data?.id ?? null;
}

/**
 * Desliga a conexão ativa. O gatilho conexoes_desativar apaga os segredos dela, sem volta: para
 * ligar de novo, o admin salva a conexão outra vez. Só atinge a linha se ela ainda estiver ativa.
 */
export async function desativarConexao(id: string): Promise<void> {
  const r = await firebaseAdmin
    .from("conexoes")
    .update({ ativa: false, status: "desconectada", atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("ativa", true)
    .select("id");
  exigirUmaLinha(r, "desativar_conexao");
}

/**
 * As bolhas da Janete que iam sair pela conexão desligada viram canceladas (decisão 11 das lacunas):
 * cancelada não dispara o gatilho do envio que falhou, e nada vai para "Precisam de você". Só as
 * que estão na fila; 0 linhas não é falha (a fila podia estar vazia).
 */
export async function cancelarBolhasDaJaneteNaFila(conexaoId: string): Promise<void> {
  const r = await firebaseAdmin
    .from("mensagens")
    .update({ status: "cancelada", status_em: new Date().toISOString() })
    .eq("conexao_id", conexaoId)
    .eq("direcao", "saida")
    .eq("origem", "janete")
    .eq("status", "na_fila")
    .select("id");
  if (r.error) throw falhaBanco("cancelar_fila_janete");
}

/**
 * As mensagens da equipe pela tela que estavam na fila da conexão desligada ficam "não enviada",
 * com o erro conexao_inativa (o mesmo do pegar_envios), que o "Tentar de novo" aceita. 0 linhas
 * não é falha.
 */
export async function falharMensagensDaEquipeNaFila(conexaoId: string): Promise<void> {
  const r = await firebaseAdmin
    .from("mensagens")
    .update({ status: "falhou", erro: "conexao_inativa", status_em: new Date().toISOString() })
    .eq("conexao_id", conexaoId)
    .eq("direcao", "saida")
    .eq("origem", "humano_tela")
    .eq("status", "na_fila")
    .select("id");
  if (r.error) throw falhaBanco("falhar_fila_equipe");
}

/** Grava o resultado da conferência na conexão ativa. ultimoErro é um código curto. */
export async function gravarStatusConexao(
  id: string,
  status: Extract<StatusConexao, "conectada" | "desconectada" | "erro">,
  ultimoErro: string | null,
): Promise<void> {
  const r = await firebaseAdmin
    .from("conexoes")
    .update({
      status,
      ultimo_erro: status === "conectada" ? null : (ultimoErro ?? status).slice(0, 300),
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("ativa", true)
    .select("id");
  exigirUmaLinha(r, "gravar_status_conexao");
}

/**
 * Regrava parametros e segredos da conexão ativa (o conserto de um campo da Meta), sem tocar em
 * "ativa". Os segredos chegam em texto puro, todos (os colados e os nossos, como estavam), e são
 * cifrados aqui antes de qualquer escrita, presos ao id da linha.
 */
export async function regravarConexao(
  id: string,
  dados: { nome: string; parametros: Record<string, unknown>; segredos: Record<string, string> },
): Promise<void> {
  const cifrados: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(dados.segredos)) {
    cifrados[nome] = await cifrar(valor, aadConexao(id, nome));
  }
  const r = await firebaseAdmin
    .from("conexoes")
    .update({
      nome: dados.nome,
      parametros: dados.parametros as Json,
      segredos: cifrados as Json,
      status: "conectada",
      ultimo_erro: null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("ativa", true)
    .select("id");
  exigirUmaLinha(r, "regravar_conexao");
}

// ---------- chave de IA ----------

export type ResumoChaveIA = {
  id: string;
  provedor: Provedor;
  modelo: string;
  workspace_id: string | null;
  status: StatusChave;
  ultimos4: string | null;
  /** O código do último erro (ex.: 'sem_permissao' na voz, docs/spec-voz-uso.md P7), ou null. */
  ultimo_erro: string | null;
  /** false = a linha existe, mas sem chave (removida) */
  temChave: boolean;
};

/** A linha da chave da finalidade, sem decifrar. null = nunca cadastrada. */
export async function lerResumoChaveIA(finalidade: Finalidade): Promise<ResumoChaveIA | null> {
  const { data, error } = await firebaseAdmin
    .from("ia_chaves")
    .select("id, provedor, modelo, workspace_id, status, ultimos4, ultimo_erro, chave_cifrada")
    .eq("finalidade", finalidade)
    .maybeSingle();
  if (error) throw falhaBanco("ler_chave");
  if (!data) return null;
  return {
    id: data.id,
    provedor: data.provedor,
    modelo: data.modelo,
    workspace_id: data.workspace_id,
    status: data.status,
    ultimos4: data.ultimos4,
    ultimo_erro: data.ultimo_erro,
    temChave: data.chave_cifrada !== null,
  };
}

/** Resultado da conferência da chave guardada: "ativa" limpa o erro e marca validada_em. */
export async function gravarStatusChave(
  id: string,
  status: Extract<StatusChave, "ativa" | "invalida" | "sem_credito">,
  codigo: string | null,
): Promise<void> {
  const agora = new Date().toISOString();
  const r = await firebaseAdmin
    .from("ia_chaves")
    .update(
      status === "ativa"
        ? { status, ultimo_erro: null, validada_em: agora, atualizada_em: agora }
        : { status, ultimo_erro: (codigo ?? status).slice(0, 60), atualizada_em: agora },
    )
    .eq("id", id)
    .select("id");
  exigirUmaLinha(r, "gravar_status_chave");
}

/** Troca só o modelo da chave guardada, já conferido com ela. */
export async function gravarModeloChave(
  id: string,
  modelo: string,
  membroId: string,
): Promise<void> {
  const agora = new Date().toISOString();
  const r = await firebaseAdmin
    .from("ia_chaves")
    .update({
      modelo,
      status: "ativa",
      ultimo_erro: null,
      validada_em: agora,
      atualizada_em: agora,
      atualizada_por: membroId,
    })
    .eq("id", id)
    .select("id");
  exigirUmaLinha(r, "gravar_modelo");
}

/** Apaga a chave guardada (fica a linha, com status "removida", para a tela e a auditoria). */
export async function apagarChave(id: string, membroId: string): Promise<void> {
  const r = await firebaseAdmin
    .from("ia_chaves")
    .update({
      chave_cifrada: null,
      ultimos4: null,
      status: "removida",
      ultimo_erro: null,
      atualizada_em: new Date().toISOString(),
      atualizada_por: membroId,
    })
    .eq("id", id)
    .select("id");
  exigirUmaLinha(r, "remover_chave");
}

// ---------- ritmo ----------

export type Ritmo = { espera: number; teto: number };

/**
 * Grava a espera e o teto na linha única de configuracao (id 1) e devolve os valores de antes,
 * para a auditoria ritmo_alterado. A leitura de antes é só para a auditoria: se falhar, o
 * ritmo é gravado do mesmo jeito e o anterior volta null.
 */
export async function gravarRitmo(espera: number, teto: number): Promise<Ritmo | null> {
  let anterior: Ritmo | null = null;
  try {
    const { data, error } = await firebaseAdmin
      .from("configuracao")
      .select("espera_lote_s, espera_lote_max_s")
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) anterior = { espera: data.espera_lote_s, teto: data.espera_lote_max_s };
  } catch {
    anterior = null;
  }
  const r = await firebaseAdmin
    .from("configuracao")
    .update({ espera_lote_s: espera, espera_lote_max_s: teto })
    .eq("id", 1)
    .select("id");
  exigirUmaLinha(r, "gravar_ritmo");
  return anterior;
}

// ---------- voz em uso (docs/spec-voz-uso.md, contrato C2) ----------

export type ErroVozGravado = "voz_nao_encontrada";

export type ConfigVozTela = {
  modo: ModoVoz;
  voz: VozEscolhida | null;
  erro: ErroVozGravado | null;
};

function lerModo(valor: unknown): ModoVoz {
  return typeof valor === "string" && (MODOS_VOZ as readonly string[]).includes(valor)
    ? (valor as ModoVoz)
    : MODO_VOZ_PADRAO;
}

function lerVozGravada(id: unknown, nome: unknown): VozEscolhida | null {
  return typeof id === "string" && VOZ_ID.test(id) && typeof nome === "string" && nome
    ? { id, nome }
    : null;
}

/**
 * A voz escolhida, o modo e o erro gravado na linha única de configuracao (id 1). Sem a linha,
 * o padrão (quando_audio, sem voz). Um valor fora do formato conta como ausente.
 */
export async function lerConfigVozTela(): Promise<ConfigVozTela> {
  const { data, error } = await firebaseAdmin
    .from("configuracao")
    .select("voz_resposta, voz_id, voz_nome, voz_erro")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw falhaBanco("ler_voz");
  return {
    modo: lerModo(data?.voz_resposta),
    voz: lerVozGravada(data?.voz_id, data?.voz_nome),
    erro: data?.voz_erro === "voz_nao_encontrada" ? "voz_nao_encontrada" : null,
  };
}

/**
 * Grava a voz já conferida na ElevenLabs (o nome é o de lá) e limpa o voz_erro. Devolve a voz de
 * antes, para a auditoria voz_alterada; como no ritmo, a leitura de antes é melhor esforço.
 */
export async function gravarVoz(voz: VozEscolhida): Promise<VozEscolhida | null> {
  let anterior: VozEscolhida | null = null;
  try {
    const { data, error } = await firebaseAdmin
      .from("configuracao")
      .select("voz_id, voz_nome")
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) anterior = lerVozGravada(data.voz_id, data.voz_nome);
  } catch {
    anterior = null;
  }
  const r = await firebaseAdmin
    .from("configuracao")
    .update({ voz_id: voz.id, voz_nome: voz.nome, voz_erro: null })
    .eq("id", 1)
    .select("id");
  exigirUmaLinha(r, "gravar_voz");
  return anterior;
}

/** Grava quando a Janete responde em áudio e devolve o modo de antes (melhor esforço). */
export async function gravarModoVoz(modo: ModoVoz): Promise<ModoVoz | null> {
  let anterior: ModoVoz | null = null;
  try {
    const { data, error } = await firebaseAdmin
      .from("configuracao")
      .select("voz_resposta")
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) anterior = lerModo(data.voz_resposta);
  } catch {
    anterior = null;
  }
  const r = await firebaseAdmin
    .from("configuracao")
    .update({ voz_resposta: modo })
    .eq("id", 1)
    .select("id");
  exigirUmaLinha(r, "gravar_modo_voz");
  return anterior;
}

/**
 * Grava (ou limpa, com null) o erro da voz. Só atinge a linha se a voz escolhida ainda for a
 * conferida: uma troca de voz no meio não herda o erro da anterior (0 linhas = falha).
 */
export async function gravarErroVoz(vozId: string, erro: ErroVozGravado | null): Promise<void> {
  const r = await firebaseAdmin
    .from("configuracao")
    .update({ voz_erro: erro })
    .eq("id", 1)
    .eq("voz_id", vozId)
    .select("id");
  exigirUmaLinha(r, "gravar_erro_voz");
}
