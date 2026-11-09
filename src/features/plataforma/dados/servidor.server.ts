// Lógica das funções de servidor da plataforma (spec de ligar as telas ao banco, 2.4, primeiro
// bloco, com os ajustes da 2.6): garantir o bucket das mídias, pedir uma passada de envio, pedir o
// "lido" no WhatsApp, apagar um contato e pedir um toque no motor (docs/spec-motor-acordado.md). As funções (createServerFn) ficam em
// servidor.functions.ts, que carrega este arquivo por import() dentro do handler.
//
// - O papel é conferido com o cliente do próprio usuário: eh_membro() ou eh_admin().
// - O firebaseAdmin (chave de serviço, ignora RLS) e o código da mensageria entram por import()
//   dentro de cada função, depois da conferência do papel: nunca vão para o navegador.
// - Nunca lança: toda falha vira { ok: false, erro } com um código fixo, sem dado pessoal.
import type { FirebaseClient } from "@/integrations/firebase/client-contract";

import type { Database } from "@/integrations/firebase/types";

export type ClienteUsuario = Pick<FirebaseClient<Database>, 'from' | 'rpc' | 'storage'>;
export type ContextoUsuario = { firebase: ClienteUsuario; userId: string };

export type SemAcesso = { ok: false; erro: "sem_acesso" };
export type NaoEncontrado = { ok: false; erro: "nao_encontrado" };
/** mensagem: só o código do que falhou (ex.: "bucket_publico"), nunca dado do banco. */
export type Falha = { ok: false; erro: "falha"; mensagem: string };

export type ResultadoGarantirBucket = { ok: true } | SemAcesso | Falha;

export type ResultadoPedirEnvio =
  | { ok: true; enviados: number; falhas: number; devolvidos: number; incertos: number }
  | SemAcesso
  | Falha;

/** toque: o que o banco respondeu ao pedido (acordar_motor), ou "falhou". */
export type ResultadoAcordarMotor =
  { ok: true; toque: "tocado" | "recente" | "sem_endereco" | "falhou" } | SemAcesso | Falha;

/**
 * A origem que a tela grava como endereço do motor: o host que recebeu o pedido
 * (new URL(request.url).origin), nunca o cabeçalho Origin, que um membro pode forjar para levar o
 * toque e a chave a um host dele. Sem pedido: null (o toque sai com o endereço já gravado).
 */
export type OpcoesToque = { origem?: string | null };

/** marcada: o gateway aceitou o "lido". false é normal (spec 2.6): a conversa fica lida na tela. */
export type ResultadoMarcarLida = { ok: true; marcada: boolean } | SemAcesso | NaoEncontrado | Falha;

export type ResultadoApagarContato = { ok: true } | SemAcesso | NaoEncontrado | Falha;

export type EntradaMarcarLida = { conversaId: string };
export type EntradaApagarContato = { contatoId: string };

const SEM_ACESSO: SemAcesso = { ok: false, erro: "sem_acesso" };
const NAO_ENCONTRADO: NaoEncontrado = { ok: false, erro: "nao_encontrado" };

function falha(codigo: string): Falha {
  return { ok: false, erro: "falha", mensagem: codigo };
}

/** O código fixo de um erro lançado (os módulos da mensageria lançam Error("codigo")). */
function codigoDe(erro: unknown, padrao: string): string {
  const msg = erro instanceof Error ? erro.message : "";
  return /^[a-z][a-z0-9_]{1,60}$/.test(msg) ? msg : padrao;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(v: string): boolean {
  return UUID.test(v);
}

/** Bucket das mídias (o mesmo nome de nucleo/midia.server.ts, que é a fonte). */
export const BUCKET = "midias";
/** Página da listagem do Storage e lote do remove. */
export const LOTE_STORAGE = 1000;
/** Quantas entradas recentes vão no pedido de "lido" (a Z-API usa as 20 últimas). */
export const MAX_IDS_LIDA = 20;
/** Teto do pedido de "lido" ao gateway: a tela não espera, mas o pedido não fica pendurado. */
export const PRAZO_LIDA_MS = 8_000;
/** Status de saída que contam como "respondida": o lead já recebeu (ou está recebendo). */
const SAIDA_QUE_SAIU = ["enviando", "enviada", "entregue", "lida"] as const;

// ---------- acesso ----------

/** true = membro ativo (eh_membro() com o cliente do usuário). */
export async function ehMembro(ctx: ContextoUsuario): Promise<boolean> {
  const r = await ctx.firebase.rpc("eh_membro");
  return !r.error && r.data === true;
}

/** id do membro admin ativo do usuário; null = sem acesso. */
export async function membroAdmin(ctx: ContextoUsuario): Promise<string | null> {
  const admin = await ctx.firebase.rpc("eh_admin");
  if (admin.error || admin.data !== true) return null;
  const membro = await ctx.firebase
    .from("membros")
    .select("id")
    .eq("user_id", ctx.userId)
    .eq("ativo", true)
    .maybeSingle();
  if (membro.error || !membro.data) return null;
  return membro.data.id;
}

async function clienteAdmin(): Promise<ClienteUsuario> {
  const { firebaseAdmin } = await import("@/integrations/firebase/client.server");
  return firebaseAdmin;
}

// ---------- garantirBucketMidias (membro) ----------

/**
 * Cria o bucket privado "midias" na primeira vez (o envio da tela chama 1 vez por sessão, antes
 * do 1º upload). "Já existe" conta como sucesso; bucket público é falha ("bucket_publico").
 */
export async function garantirBucketMidiasLogica(
  ctx: ContextoUsuario,
): Promise<ResultadoGarantirBucket> {
  try {
    if (!(await ehMembro(ctx))) return SEM_ACESSO;
    const { garantirBucket } = await import("@/features/mensageria/nucleo/midia.server");
    await garantirBucket();
    return { ok: true };
  } catch (erro) {
    return falha(codigoDe(erro, "bucket_indisponivel"));
  }
}

// ---------- toque no motor ----------

/** Pede o toque (motor.server: grava a origem válida e fora da prévia). Nunca lança. */
async function tocarMotor(origem: string | null | undefined): Promise<ResultadoAcordarMotor> {
  try {
    const { acordarMotor } = await import("@/features/mensageria/nucleo/motor.server");
    return { ok: true, toque: await acordarMotor(origem ?? null) };
  } catch (erro) {
    return falha(codigoDe(erro, "motor_indisponivel"));
  }
}

/**
 * O conserto pela tela (spec-motor-acordado, "O conserto sozinho"): um membro que vê trabalho
 * vencido pede um toque. O banco não deixa sair dois toques em 40 s.
 */
export async function acordarMotorPelaTelaLogica(
  ctx: ContextoUsuario,
  opcoes: OpcoesToque = {},
): Promise<ResultadoAcordarMotor> {
  try {
    if (!(await ehMembro(ctx))) return SEM_ACESSO;
  } catch (erro) {
    return falha(codigoDe(erro, "motor_indisponivel"));
  }
  return tocarMotor(opcoes.origem);
}

// ---------- pedirEnvio (membro) ----------

/**
 * A passada curta de envio que a tela pede depois de gravar (decisão 7): só a etapa de envios.
 * O orçamento é o ORCAMENTO_SOMENTE_ENVIOS_MS do ciclo (spec 2.6), para caber uma mídia; com
 * menos, o anexo gastaria uma tentativa e voltaria para a fila. Duas passadas ao mesmo tempo são
 * seguras (as funções do banco pegam com SKIP LOCKED). Devolve só contagens.
 * No fim, com ou sem falha na passada, pede um toque no motor (com a origem do pedido): o resto do
 * trabalho (rodadas, mídias) não espera a próxima mensagem.
 */
export async function pedirEnvioLogica(
  ctx: ContextoUsuario,
  opcoes: OpcoesToque = {},
): Promise<ResultadoPedirEnvio> {
  try {
    if (!(await ehMembro(ctx))) return SEM_ACESSO;
  } catch (erro) {
    return falha(codigoDe(erro, "envio_indisponivel"));
  }
  try {
    const { rodarCiclo, ORCAMENTO_SOMENTE_ENVIOS_MS } = await import(
      "@/features/mensageria/nucleo/ciclo.server"
    );
    const resumo = await rodarCiclo({
      somenteEnvios: true,
      orcamentoMs: ORCAMENTO_SOMENTE_ENVIOS_MS,
    });
    const { enviados, falhas, devolvidos, incertos } = resumo.envios;
    return { ok: true, enviados, falhas, devolvidos, incertos };
  } catch (erro) {
    return falha(codigoDe(erro, "envio_indisponivel"));
  } finally {
    await tocarMotor(opcoes.origem);
  }
}

// ---------- marcarLidaNoWhatsApp (membro) ----------

/**
 * Os id_externo das entradas da conversa que ainda não tiveram resposta: as que chegaram depois
 * da última saída que saiu (ou todas, se nenhuma saiu), na conexão ativa, as 20 mais novas, em
 * ordem de tempo (da mais antiga à mais nova, como o RefLida pede).
 */
export async function idsParaLida(
  admin: ClienteUsuario,
  conversaId: string,
  conexaoId: string,
): Promise<string[]> {
  const ultimaSaida = await admin
    .from("mensagens")
    .select("momento")
    .eq("conversa_id", conversaId)
    .eq("direcao", "saida")
    .in("status", [...SAIDA_QUE_SAIU])
    .order("momento", { ascending: false })
    .limit(1);
  if (ultimaSaida.error) throw new Error("lida_saida");
  const desde = ultimaSaida.data?.[0]?.momento ?? null;

  let consulta = admin
    .from("mensagens")
    .select("id_externo, momento")
    .eq("conversa_id", conversaId)
    .eq("direcao", "entrada")
    .eq("conexao_id", conexaoId)
    .not("id_externo", "is", null);
  if (desde) consulta = consulta.gt("momento", desde);
  const entradas = await consulta
    .order("momento", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAX_IDS_LIDA);
  if (entradas.error) throw new Error("lida_entradas");
  return (entradas.data ?? [])
    .map((m: { id_externo?: string | null }) => m.id_externo)
    .filter((id: unknown): id is string => typeof id === "string" && id.trim() !== "")
    .reverse();
}

/**
 * Pede o "lido" ao gateway da conexão ativa (decisão 6), sem o "digitando". A tela já zerou as
 * não lidas (marcar_lida) e não espera esta resposta. Sem conexão ativa, sem marcarLida no
 * adaptador (a Zernio), sem destino ou sem id: { ok: true, marcada: false }, sem pedir nada.
 */
export async function marcarLidaNoWhatsAppLogica(
  ctx: ContextoUsuario,
  entrada: EntradaMarcarLida,
): Promise<ResultadoMarcarLida> {
  try {
    if (!(await ehMembro(ctx))) return SEM_ACESSO;
    if (!ehUuid(entrada.conversaId)) return NAO_ENCONTRADO;
    const admin = await clienteAdmin();
    const conversa = await admin
      .from("conversas")
      .select("id")
      .eq("id", entrada.conversaId)
      .maybeSingle();
    if (conversa.error) return falha("lida_conversa");
    if (!conversa.data) return NAO_ENCONTRADO;

    const { conexaoAtiva } = await import("@/features/mensageria/nucleo/conexoes.server");
    const conexao = await conexaoAtiva();
    if (!conexao || Object.keys(conexao.segredos).length === 0) return { ok: true, marcada: false };
    const { adaptadorDe } = await import("@/features/mensageria/gateways");
    const adaptador = adaptadorDe(conexao.gateway);
    if (!adaptador?.marcarLida) return { ok: true, marcada: false };

    const ids = await idsParaLida(admin, entrada.conversaId, conexao.id);
    if (ids.length === 0) return { ok: true, marcada: false };
    const { destinoDoContato } = await import("@/features/mensageria/nucleo/banco.server");
    const destino = await destinoDoContato(entrada.conversaId, conexao.id);
    if (destino.length === 0) return { ok: true, marcada: false };

    const { marcarSoLida } = await import("@/features/mensageria/nucleo/lida");
    const marcada = await marcarSoLida(adaptador, { destino, ids_externos: ids }, conexao, {
      fimEm: Date.now() + PRAZO_LIDA_MS,
    });
    return { ok: true, marcada };
  } catch (erro) {
    return falha(codigoDe(erro, "lida_indisponivel"));
  }
}

// ---------- apagarContato (admin) ----------

type ErroStorage = { status?: number; statusCode?: string | number; message?: string } | null;

function bucketNaoExiste(erro: ErroStorage): boolean {
  if (!erro) return false;
  return /bucket not found/i.test(erro.message ?? "") || String(erro.statusCode ?? "") === "404";
}

/**
 * Os caminhos dos arquivos em midias/{conversaId}/, listando a pasta de 1.000 em 1.000. O bucket
 * que ainda não existe não tem arquivo: lista vazia.
 */
export async function arquivosDaConversa(
  admin: ClienteUsuario,
  conversaId: string,
): Promise<string[]> {
  const caminhos: string[] = [];
  for (let deslocamento = 0; ; deslocamento += LOTE_STORAGE) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(conversaId, {
        limit: LOTE_STORAGE,
        offset: deslocamento,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) {
      if (bucketNaoExiste(error as ErroStorage)) return [];
      throw Object.assign(new Error("midias_nao_listadas"), { storageCode: (error as { code?: string } | null)?.code });
    }
    const pagina = data ?? [];
    for (const item of pagina) {
      // item sem id é uma subpasta (o caminho é sempre {conversa}/{mensagem}, sem subpasta)
      if (item.name && (item as { id?: string | null }).id != null) {
        caminhos.push(`${conversaId}/${item.name}`);
      }
    }
    if (pagina.length < LOTE_STORAGE) return caminhos;
  }
}

/**
 * Apaga o contato (decisão 12): primeiro os arquivos midias/{conversa_id}/* (listando a pasta),
 * depois a linha do contato (a cascata leva a conversa, as mensagens e o resto), e grava a
 * auditoria contato_apagado com { nome } (sem telefone nem conversa). Se os arquivos não saem,
 * o contato fica: nada de linha apagada com mídia órfã no bucket.
 */
export async function apagarContatoLogica(
  ctx: ContextoUsuario,
  entrada: EntradaApagarContato,
): Promise<ResultadoApagarContato> {
  try {
    const ator = await membroAdmin(ctx);
    if (!ator) return SEM_ACESSO;
    if (!ehUuid(entrada.contatoId)) return NAO_ENCONTRADO;
    const admin = await clienteAdmin();

    const contato = await admin
      .from("contatos")
      .select("id, nome, nome_whatsapp")
      .eq("id", entrada.contatoId)
      .maybeSingle();
    if (contato.error) return falha("contato_nao_lido");
    if (!contato.data) return NAO_ENCONTRADO;

    const conversas = await admin
      .from("conversas")
      .select("id")
      .eq("contato_id", entrada.contatoId);
    if (conversas.error) return falha("conversas_nao_lidas");

    for (const { id } of conversas.data ?? []) {
      let caminhos: string[];
      try { caminhos = await arquivosDaConversa(admin, id); }
      catch (error) {
        // A prévia não possui a identidade do bucket. Contato sem mídia ainda pode ser apagado.
        // Publicação sempre lista o bucket, incluindo uploads órfãos, antes da exclusão.
        const storageCode = (error as { storageCode?: string }).storageCode;
        if (process.env["JANETE_RUNTIME_SERVICE_ACCOUNT"] || !["storage_nao_configurado", "storage_indisponivel", "server_identity_required"].includes(storageCode ?? "")) throw error;
        const media = await admin.from("mensagens").select("id").eq("conversa_id", id).not("midia_caminho", "is", null).limit(1);
        if (media.error || (media.data?.length ?? 0) > 0) throw error;
        caminhos = [];
      }
      for (let i = 0; i < caminhos.length; i += LOTE_STORAGE) {
        const lote = caminhos.slice(i, i + LOTE_STORAGE);
        const { error } = await admin.storage.from(BUCKET).remove(lote);
        if (error) return falha("midias_nao_apagadas");
      }
    }

    const apagado = await admin
      .from("contatos")
      .delete()
      .eq("id", entrada.contatoId)
      .select("id");
    if (apagado.error) return falha("contato_nao_apagado");
    // 0 linhas: outro admin apagou entre a leitura e agora
    if (!apagado.data || apagado.data.length === 0) return NAO_ENCONTRADO;

    const nome = contato.data.nome?.trim() || contato.data.nome_whatsapp?.trim() || null;
    // Auditoria é melhor esforço: o contato já saiu e não volta. A falha fica no log só com o código.
    try {
      const r = await admin
        .from("auditoria")
        .insert({
          acao: "contato_apagado",
          alvo: entrada.contatoId,
          ator_membro_id: ator,
          detalhe: { nome },
        })
        .select("id");
      if (r.error || !r.data || r.data.length !== 1) console.error("auditoria_falhou", "contato_apagado");
    } catch {
      console.error("auditoria_falhou", "contato_apagado");
    }
    return { ok: true };
  } catch (erro) {
    return falha(codigoDe(erro, "contato_nao_apagado"));
  }
}
