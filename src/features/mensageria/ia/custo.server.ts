// Custo da IA em ia_chamadas (spec da mensageria, premissa "Custo"). Uma linha por passo da
// resposta, uma por transcrição e uma por fala (a voz da Janete, docs/spec-voz-uso.md).
// - OpenRouter: o valor que ela devolve (custo_origem = provedor).
// - Anthropic e OpenAI: a linha de ia_precos vigente hoje (São Paulo), na faixa do tamanho do
//   prompt (custo_origem = tabela).
// - Componente usado sem preço, ou modelo sem preço: custo nulo e sem_preco (o banco exige os
//   dois juntos).
// Nada aqui guarda texto do lead nem da resposta: só contagens.
import { firebaseAdmin } from "@/integrations/firebase/client.server";
import type { Database, Json } from "@/integrations/firebase/types";

type Tabelas = Database["public"]["Tables"];
export type LinhaPreco = Tabelas["ia_precos"]["Row"];
export type NovaChamada = Tabelas["ia_chamadas"]["Insert"];
type Provedor = Database["public"]["Enums"]["ia_provedor"];
type Origem = Database["public"]["Enums"]["custo_origem"];

export type Custo = { custo_usd: number | null; custo_origem: Origem; preco_id: string | null };

const SEM_PRECO: Custo = { custo_usd: null, custo_origem: "sem_preco", preco_id: null };

/** Data de hoje em São Paulo, AAAA-MM-DD (nunca toISOString, que é UTC). */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** Preços do provedor e modelo vigentes até hoje. Erro do banco = lista vazia (sem_preco). */
export async function carregarPrecos(provedor: Provedor, modelo: string): Promise<LinhaPreco[]> {
  const { data, error } = await firebaseAdmin
    .from("ia_precos")
    .select("*")
    .eq("provedor", provedor)
    .eq("modelo", modelo)
    .lte("vigente_desde", hojeSaoPaulo());
  if (error || !data) return [];
  return data as LinhaPreco[];
}

/**
 * A linha com o maior vigente_desde até hoje e, dentro dela, a maior faixa a_partir_de_tokens
 * que não passa do tamanho do prompt.
 */
export function escolherPreco(
  precos: LinhaPreco[],
  tokensPrompt: number,
  hoje: string = hojeSaoPaulo(),
): LinhaPreco | null {
  const vigentes = precos.filter((p) => p.vigente_desde <= hoje);
  if (vigentes.length === 0) return null;
  const maisNova = vigentes.reduce((a, p) => (p.vigente_desde > a ? p.vigente_desde : a), "");
  let escolhida: LinhaPreco | null = null;
  for (const p of vigentes) {
    if (p.vigente_desde !== maisNova || p.a_partir_de_tokens > tokensPrompt) continue;
    if (!escolhida || p.a_partir_de_tokens > escolhida.a_partir_de_tokens) escolhida = p;
  }
  return escolhida;
}

/** Uso de um passo, já no formato normalizado do AI SDK. */
export type UsoTokens = {
  entrada: number;
  semCache: number;
  cacheLeitura: number;
  cacheEscrita: number;
  saida: number;
  raciocinio: number;
};

type UsoSdk = {
  inputTokens?: number | undefined;
  inputTokenDetails?: {
    noCacheTokens?: number | undefined;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  };
  outputTokens?: number | undefined;
  outputTokenDetails?: { reasoningTokens?: number | undefined };
};

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

export function normalizarUso(u: UsoSdk | undefined): UsoTokens {
  const cacheLeitura = n(u?.inputTokenDetails?.cacheReadTokens);
  const cacheEscrita = n(u?.inputTokenDetails?.cacheWriteTokens);
  const entrada = n(u?.inputTokens);
  const semCacheInformado = u?.inputTokenDetails?.noCacheTokens;
  const semCache =
    typeof semCacheInformado === "number"
      ? n(semCacheInformado)
      : Math.max(0, entrada - cacheLeitura - cacheEscrita);
  return {
    entrada,
    semCache,
    cacheLeitura,
    cacheEscrita,
    saida: n(u?.outputTokens),
    raciocinio: n(u?.outputTokenDetails?.reasoningTokens),
  };
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Situações que a tabela não cobre (comentário da migration 0001): escrita de cache de 1 h,
 * modo rápido e inference_geo "us" na Anthropic. Nelas o custo fica sem_preco.
 */
function foraDaTabela(bruto: unknown): boolean {
  if (!ehObjeto(bruto)) return false;
  const criacao = bruto["cache_creation"];
  if (ehObjeto(criacao) && n(criacao["ephemeral_1h_input_tokens"]) > 0) return true;
  if (bruto["speed"] === "fast") return true;
  if (bruto["inference_geo"] === "us") return true;
  return false;
}

/** Custo de um passo pela tabela (Anthropic e OpenAI). US$ por 1M de tokens. */
export function custoPorTabela(
  precos: LinhaPreco[],
  uso: UsoTokens,
  bruto?: unknown,
  hoje?: string,
): Custo {
  const preco = escolherPreco(precos, uso.entrada, hoje);
  if (!preco) return SEM_PRECO;
  const semPreco: Custo = { ...SEM_PRECO, preco_id: preco.id };
  if (foraDaTabela(bruto)) return semPreco;
  const partes: [number, number | null][] = [
    [uso.semCache, preco.entrada],
    [uso.cacheLeitura, preco.cache_leitura],
    [uso.cacheEscrita, preco.cache_escrita],
    [uso.saida, preco.saida],
  ];
  let total = 0;
  for (const [tokens, valor] of partes) {
    if (tokens <= 0) continue;
    if (valor === null || valor === undefined) return semPreco;
    total += (tokens * Number(valor)) / 1_000_000;
  }
  return { custo_usd: total, custo_origem: "tabela", preco_id: preco.id };
}

/** Custo informado pelo provedor (OpenRouter). Sem o número = sem_preco. */
export function custoDoProvedor(valor: unknown): Custo {
  if (typeof valor === "number" && Number.isFinite(valor) && valor >= 0) {
    return { custo_usd: valor, custo_origem: "provedor", preco_id: null };
  }
  return SEM_PRECO;
}

/** Custo da transcrição pela tabela: audio_por_minuto × duração (mínimo de 10 s na Groq). */
export function custoDeAudio(
  provedor: Provedor,
  precos: LinhaPreco[],
  segundos: number | null,
  hoje?: string,
): Custo {
  const preco = escolherPreco(precos, 0, hoje);
  if (!preco) return SEM_PRECO;
  if (segundos === null || !(segundos >= 0) || preco.audio_por_minuto === null) {
    return { ...SEM_PRECO, preco_id: preco.id };
  }
  const cobrados = provedor === "groq" ? Math.max(segundos, 10) : segundos;
  return {
    custo_usd: (Number(preco.audio_por_minuto) * cobrados) / 60,
    custo_origem: "tabela",
    preco_id: preco.id,
  };
}

/**
 * Custo da fala (a voz da Janete, ElevenLabs) pela tabela: por_mil_caracteres × caracteres / 1000.
 * Sem linha vigente, sem_preco; com a linha sem por_mil_caracteres, sem_preco com o preco_id.
 */
export function custoDeFala(precos: LinhaPreco[], caracteres: number, hoje?: string): Custo {
  const preco = escolherPreco(precos, 0, hoje);
  if (!preco) return SEM_PRECO;
  if (preco.por_mil_caracteres === null || preco.por_mil_caracteres === undefined) {
    return { ...SEM_PRECO, preco_id: preco.id };
  }
  return {
    custo_usd: (Number(preco.por_mil_caracteres) * n(caracteres)) / 1000,
    custo_origem: "tabela",
    preco_id: preco.id,
  };
}

/** Só números, textos curtos e objetos aninhados (o uso bruto não tem texto do lead). */
export function limparUsoBruto(v: unknown, nivel = 0): Json | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length <= 60 ? v : null;
  if (nivel >= 3 || !ehObjeto(v)) return null;
  const saida: Record<string, Json> = {};
  for (const [k, valor] of Object.entries(v)) {
    const limpo = limparUsoBruto(valor, nivel + 1);
    if (limpo !== null) saida[k] = limpo;
  }
  return saida;
}

/** Grava as linhas de custo. Falha no banco não derruba a rodada; devolve se gravou. */
export async function gravarChamadas(linhas: NovaChamada[]): Promise<boolean> {
  if (linhas.length === 0) return true;
  try {
    const { error } = await firebaseAdmin.from("ia_chamadas").insert(linhas);
    return !error;
  } catch {
    return false;
  }
}
