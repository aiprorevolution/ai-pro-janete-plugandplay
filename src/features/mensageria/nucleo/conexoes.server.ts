// Conexões de WhatsApp e chaves de IA no banco, pelo servidor (firebaseAdmin, que ignora RLS).
// Os segredos chegam e saem daqui em texto puro, mas só vão ao banco cifrados (cifra.ts), com
// o dado associado preso ao id da linha. Nenhum erro daqui cita valor de segredo.
import { firebaseAdmin } from "@/integrations/firebase/client.server";
import type { Database, Json } from "@/integrations/firebase/types";

import { aadChave, aadConexao, cifrar, decifrar } from "./cifra";
import {
  AVISO_DO_WEBHOOK,
  desligarWebhookDaConexao,
  detalheDoWebhook,
  TETO_DESLIGAR_WEBHOOK_MS,
  type AvisoWebhook,
  type WebhookDesligado,
} from "./desligar-webhook.server";
import { pararFilaDaConexao } from "./parar-fila.server";
import { GATEWAYS_MENSAGERIA, type ConexaoServidor, type GatewayId } from "./tipos";

type Finalidade = Database["public"]["Enums"]["ia_finalidade"];
type Provedor = Database["public"]["Enums"]["ia_provedor"];

const COLUNAS_CONEXAO = "id, gateway, id_externo, parametros, segredos, oficial";

/** Falha de banco sem nenhum dado da linha: só a operação. */
function falhaBanco(operacao: string): Error {
  return new Error(`banco_${operacao}`);
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function ehGateway(v: unknown): v is GatewayId {
  return typeof v === "string" && (GATEWAYS_MENSAGERIA as readonly string[]).includes(v);
}

type LinhaConexao = {
  id: string;
  gateway: string;
  id_externo: string;
  parametros: Json;
  segredos: Json;
  oficial: boolean | null;
};

async function montarConexaoServidor(linha: LinhaConexao): Promise<ConexaoServidor | null> {
  if (!ehGateway(linha.gateway)) return null;
  const segredos: Record<string, string> = {};
  if (ehObjeto(linha.segredos)) {
    for (const [nome, valor] of Object.entries(linha.segredos)) {
      if (typeof valor !== "string") throw new Error("cifra_invalida");
      segredos[nome] = await decifrar(valor, aadConexao(linha.id, nome));
    }
  }
  return {
    id: linha.id,
    gateway: linha.gateway,
    id_externo: linha.id_externo,
    parametros: ehObjeto(linha.parametros) ? linha.parametros : {},
    segredos,
    oficial: linha.oficial === true,
  };
}

/** Carrega a conexão pelo id, com os segredos decifrados. null = não existe. */
export async function carregarConexao(id: string): Promise<ConexaoServidor | null> {
  const { data, error } = await firebaseAdmin
    .from("conexoes")
    .select(COLUNAS_CONEXAO)
    .eq("id", id)
    .maybeSingle();
  if (error) throw falhaBanco("ler_conexao");
  return data ? montarConexaoServidor(data as LinhaConexao) : null;
}

/** A conexão (gateway, id_externo), com os segredos decifrados. null = não existe. */
export async function carregarConexaoPorExterno(
  gateway: GatewayId,
  idExterno: string,
): Promise<ConexaoServidor | null> {
  const { data, error } = await firebaseAdmin
    .from("conexoes")
    .select(COLUNAS_CONEXAO)
    .eq("gateway", gateway)
    .eq("id_externo", idExterno)
    .maybeSingle();
  if (error) throw falhaBanco("ler_conexao");
  return data ? montarConexaoServidor(data as LinhaConexao) : null;
}

/** A conexão ativa (no máximo uma), com os segredos decifrados. */
export async function conexaoAtiva(): Promise<ConexaoServidor | null> {
  const { data, error } = await firebaseAdmin
    .from("conexoes")
    .select(COLUNAS_CONEXAO)
    .eq("ativa", true)
    .maybeSingle();
  if (error) throw falhaBanco("ler_conexao");
  return data ? montarConexaoServidor(data as LinhaConexao) : null;
}

async function cifrarSegredos(
  id: string,
  segredos: Record<string, string>,
): Promise<Record<string, string>> {
  const cifrados: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(segredos)) {
    cifrados[nome] = await cifrar(valor, aadConexao(id, nome));
  }
  return cifrados;
}

/** Exige que a escrita tenha atingido exatamente 1 linha (UPDATE sob RLS falha calado). */
function exigirUmaLinha(r: { data: unknown[] | null; error: unknown }, operacao: string): void {
  if (r.error || !r.data || r.data.length !== 1) throw falhaBanco(operacao);
}

// Auditoria é melhor esforço: a escrita principal já deu certo e não é desfeita. A falha fica
// no log só com o código da operação.
async function auditar(linha: Database["public"]["Tables"]["auditoria"]["Insert"]): Promise<void> {
  try {
    const r = await firebaseAdmin.from("auditoria").insert(linha).select("id");
    exigirUmaLinha(r, "auditoria");
  } catch {
    console.error("auditoria_falhou", linha.acao);
  }
}

export type NovaConexao = {
  gateway: GatewayId;
  /** rótulo da conexão (número ou instância) */
  nome: string;
  id_externo: string;
  parametros: Record<string, unknown>;
  /** em texto puro; são cifrados aqui */
  segredos: Record<string, string>;
  membroId: string;
};

export type ConexaoGravada = {
  id: string;
  /**
   * A conexão que saiu no Trocar (decisão 10 da spec-lacunas-mensageria), quando o webhook dela
   * ficou no provedor: webhook_no_painel (Meta e Z-API) ou webhook_nao_desligado. Ausente = não
   * havia outra ativa, ou o webhook dela foi desligado.
   */
  anterior?: { gateway: GatewayId; aviso: AvisoWebhook };
};

/**
 * O Trocar parou no meio, depois de mexer na conexão anterior (o salvar mostra o texto de cada um):
 * troca_sem_desativar = o webhook da anterior já foi desligado no provedor, mas ela não foi
 * desativada (segue ativa e surda); troca_sem_ativar = a anterior saiu, mas a nova não ficou ativa;
 * troca_sem_ativar_no_painel = o mesmo, e o webhook da anterior ficou no provedor. Salvar de novo
 * termina a troca.
 */
export type TrocaIncompleta =
  "troca_sem_desativar" | "troca_sem_ativar" | "troca_sem_ativar_no_painel";

/**
 * Grava a conexão e a deixa como a única ativa. Se já existe a mesma (gateway, id_externo),
 * reaproveita a linha. Devolve o id da conexão e o aviso do webhook da anterior.
 * Ordem: (1) grava a nova inativa, com os segredos; (1b) desliga o webhook da anterior no
 * provedor, como o Desconectar (melhor esforço, com o teto); (2) desativa a anterior (o gatilho
 * conexoes_desativar apaga os segredos dela, sem volta); (2b) para a fila da anterior em silêncio,
 * como o Desconectar (decisão 16; melhor esforço, a falha fica na auditoria): entre o (2) e o (3)
 * não há conexão ativa, e o pegar_envios não concorre com as órfãs; (3) ativa a nova. Falha em
 * (1) não mexe em nada. Falha em (2) depois de desligar o webhook lança troca_sem_desativar. Falha em (3)
 * deixa sem conexão ativa, mas a nova fica com os segredos: salvar de novo reaproveita a linha e
 * ativa; com anterior, lança troca_sem_ativar (ou troca_sem_ativar_no_painel), porque no salvar
 * seguinte ela já não é a ativa e o aviso do webhook dela se perderia.
 */
export async function gravarConexao(
  nova: NovaConexao,
  opcoes?: { tetoWebhookMs?: number },
): Promise<ConexaoGravada> {
  const existente = await firebaseAdmin
    .from("conexoes")
    .select("id")
    .eq("gateway", nova.gateway)
    .eq("id_externo", nova.id_externo)
    .maybeSingle();
  if (existente.error) throw falhaBanco("ler_conexao");
  const reaproveitada = existente.data !== null;
  // o id entra no dado associado, por isso existe antes de gravar
  const id = existente.data?.id ?? crypto.randomUUID();

  // cifra antes de qualquer escrita: sem a chave mestra, nada muda no banco
  const segredos = await cifrarSegredos(id, nova.segredos);

  const ativa = await firebaseAdmin
    .from("conexoes")
    .select("id, gateway")
    .eq("ativa", true)
    .maybeSingle();
  if (ativa.error) throw falhaBanco("ler_conexao");
  const anterior = ativa.data?.id ?? null;
  const gatewayAnterior = ehGateway(ativa.data?.gateway) ? ativa.data.gateway : null;
  const jaAtiva = anterior === id;

  // (1) a nova, sem tocar em "ativa": a reaproveitada mantém o que tem (inativa, ou já a ativa)
  const campos = {
    nome: nova.nome,
    parametros: nova.parametros as Json,
    segredos: segredos as Json,
    status: "conectada" as const,
    ultimo_erro: null,
  };
  if (reaproveitada) {
    const r = await firebaseAdmin.from("conexoes").update(campos).eq("id", id).select("id");
    exigirUmaLinha(r, "gravar_conexao");
  } else {
    const r = await firebaseAdmin
      .from("conexoes")
      .insert({
        ...campos,
        id,
        gateway: nova.gateway,
        id_externo: nova.id_externo,
        criado_por: nova.membroId,
        ativa: false,
      })
      .select("id");
    exigirUmaLinha(r, "gravar_conexao");
  }

  let webhook: WebhookDesligado | null = null;
  // o gateway da anterior vem da leitura da ativa quando ela não carregou com os segredos
  let gatewayDoWebhook: GatewayId | null = null;
  if (!jaAtiva) {
    if (anterior !== null) {
      // (1b) antes de desativar, com os segredos da anterior ainda guardados; nunca lança
      webhook = await desligarWebhookDaConexao(
        () => carregarConexao(anterior),
        anterior,
        opcoes?.tetoWebhookMs ?? TETO_DESLIGAR_WEBHOOK_MS,
      );
      gatewayDoWebhook = webhook.gateway ?? gatewayAnterior;
      // (2) a anterior
      const r = await firebaseAdmin
        .from("conexoes")
        .update({ ativa: false })
        .eq("id", anterior)
        .select("id");
      // com o webhook já desligado, a anterior segue ativa mas não recebe nada: a tela precisa
      // saber, como no Desconectar (e, como lá, sem auditoria: salvar de novo audita)
      if (webhook.resultado === "desligado" && (r.error || !r.data || r.data.length !== 1)) {
        throw new Error("troca_sem_desativar" satisfies TrocaIncompleta);
      }
      exigirUmaLinha(r, "desativar_conexao");
      // (2b) a fila da anterior; nunca lança
      const fila = await pararFilaDaConexao(anterior);
      // logo depois do (2): se o (3) falhar, no salvar seguinte já não existe anterior
      await auditar({
        acao: "conexao_desativada",
        alvo: anterior,
        ator_membro_id: nova.membroId,
        detalhe: {
          ...detalheDoWebhook({ ...webhook, gateway: gatewayDoWebhook }),
          ...(fila.length > 0 ? { fila_causa: fila.join(",") } : {}),
        },
      });
    }
    // (3) a nova; uma nova tentativa, porque aqui a anterior já perdeu os segredos
    const ativar = () =>
      firebaseAdmin.from("conexoes").update({ ativa: true }).eq("id", id).select("id");
    let r = await ativar();
    if (r.error || !r.data || r.data.length !== 1) r = await ativar();
    if (webhook && (r.error || !r.data || r.data.length !== 1)) {
      const codigo: TrocaIncompleta = AVISO_DO_WEBHOOK[webhook.resultado]
        ? "troca_sem_ativar_no_painel"
        : "troca_sem_ativar";
      throw new Error(codigo);
    }
    exigirUmaLinha(r, "ativar_conexao");
  }

  await auditar({
    acao: reaproveitada ? "conexao_ativada" : "conexao_criada",
    alvo: id,
    ator_membro_id: nova.membroId,
  });
  const aviso = webhook ? AVISO_DO_WEBHOOK[webhook.resultado] : null;
  return aviso && gatewayDoWebhook
    ? { id, anterior: { gateway: gatewayDoWebhook, aviso } }
    : { id };
}

export type ChaveIA = {
  id: string;
  provedor: Provedor;
  modelo: string;
  workspace_id: string | null;
  chave: string;
};

/** A chave de IA da finalidade, decifrada. null = não cadastrada (ou sem chave própria). */
export async function lerChaveIA(finalidade: Finalidade): Promise<ChaveIA | null> {
  const { data, error } = await firebaseAdmin
    .from("ia_chaves")
    .select("id, provedor, modelo, workspace_id, chave_cifrada")
    .eq("finalidade", finalidade)
    .maybeSingle();
  if (error) throw falhaBanco("ler_chave");
  if (!data || data.chave_cifrada === null) return null;
  return {
    id: data.id,
    provedor: data.provedor,
    modelo: data.modelo,
    workspace_id: data.workspace_id,
    chave: await decifrar(data.chave_cifrada, aadChave(data.id)),
  };
}

export type NovaChaveIA = {
  finalidade: Finalidade;
  provedor: Provedor;
  modelo: string;
  workspace_id: string | null;
  /** em texto puro; é cifrada aqui */
  chave: string;
  membroId: string;
};

/** Grava (ou troca) a chave da finalidade, mantendo o id da linha. Devolve os 4 últimos. */
export async function gravarChaveIA(nova: NovaChaveIA): Promise<{ ultimos4: string }> {
  const chave = nova.chave.trim();
  const ultimos4 = chave.slice(-4);
  const existente = await firebaseAdmin
    .from("ia_chaves")
    .select("id")
    .eq("finalidade", nova.finalidade)
    .maybeSingle();
  if (existente.error) throw falhaBanco("ler_chave");
  const trocada = existente.data !== null;
  const id = existente.data?.id ?? crypto.randomUUID();
  const chave_cifrada = await cifrar(chave, aadChave(id));

  const campos = {
    provedor: nova.provedor,
    modelo: nova.modelo,
    workspace_id: nova.workspace_id,
    chave_cifrada,
    ultimos4,
    status: "ativa" as const,
    ultimo_erro: null,
    validada_em: new Date().toISOString(),
    atualizada_por: nova.membroId,
  };
  if (trocada) {
    const r = await firebaseAdmin.from("ia_chaves").update(campos).eq("id", id).select("id");
    exigirUmaLinha(r, "gravar_chave");
  } else {
    const r = await firebaseAdmin
      .from("ia_chaves")
      .insert({ ...campos, id, finalidade: nova.finalidade })
      .select("id");
    exigirUmaLinha(r, "gravar_chave");
  }
  await auditar({
    acao: trocada ? "chave_trocada" : "chave_cadastrada",
    alvo: id,
    ator_membro_id: nova.membroId,
    ultimos4,
    detalhe: { finalidade: nova.finalidade, provedor: nova.provedor, modelo: nova.modelo },
  });
  return { ultimos4 };
}
