// Busca da lista de modelos no provedor de IA (rodada 2 do onboarding,
// docs/spec-ajustes-onboarding-r2.md, decisão 2b). Lógica pura: monta os pedidos, lê as
// respostas, filtra os modelos de texto e une com a lista curada (src/features/ia/modelos.ts).
// A função de servidor (listar-modelos.functions.ts) só chama listarModelosLogica.
//
// Endpoints (docs/pesquisa-motores-ia.md, seções "Listar modelos"):
// - Anthropic: GET /v1/models?limit=1000, paginada por has_more e after_id (= last_id da página).
//   Cabeçalhos x-api-key, anthropic-version e, quando vier, anthropic-workspace-id. A própria
//   busca confere a chave: 401, 403, 429 e 5xx viram os mesmos erros da validação da chave.
// - OpenAI: GET /v1/models com Authorization: Bearer. A lista mistura modelos de chat com
//   embeddings, voz, imagem e outros, e não traz capacidade nem preço: ver ehModeloDeTextoOpenAI.
// - OpenRouter: GET /api/v1/models, pública (decisão do equipe: não precisa de chave; a chave nunca
//   é mandada). Só os modelos que geram texto e aceitam ferramentas. Preço vem por token, em
//   string. Se a OpenRouter estiver fora (5xx, rede, tempo, resposta estranha), a função
//   devolve ok:true com a lista curada e origem 'lista_curada'.
//
// Segurança (spec do onboarding, "Segurança das chaves"): a chave nunca vai para mensagem, erro
// lançado, log nem resposta. O corpo de cada resposta passa por apagarSegredos antes de ser lido
// (em pedir) e o resultado inteiro passa por blindar no fim.

import { MODELOS, type ModeloIA } from "@/features/ia/modelos";

import {
  ANTHROPIC_VERSAO,
  mapearAnthropic,
  mapearOpenAI,
  mapearGemini,
  PROVEDORES_IA,
  type EntradaChaveIA,
  type ErroChaveIA,
  type ProvedorIA,
  type ResultadoChaveIA,
} from "./chave-ia";
import {
  abrirPrazo,
  apagarSegredos,
  blindar,
  corpoComoTexto,
  FalhaDeRede,
  ler,
  lerNumero,
  lerTexto,
  pedir,
  TempoEsgotado,
  type OpcoesValidacao,
  type Prazo,
  type RespostaHttp,
} from "./http";
import type { EntradaListarModelos, ModeloListado, ResultadoListarModelos } from "./listar-modelos";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Páginas lidas no máximo (1.000 modelos por página), para um has_more errado não virar laço. */
const ANTHROPIC_MAX_PAGINAS = 5;
const OPENROUTER_MAX_PAGINAS = 3;

const NOME: Record<ProvedorIA, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

type Requisicao = { url: string; init: RequestInit };

/** Um modelo como veio do provedor, antes da união com a lista curada. */
export type ModeloBruto = {
  id: string;
  nome?: string;
  fabricante?: string;
  precoEntrada?: number;
  precoSaida?: number;
};

// ---------- entrada ----------

/**
 * Confere a forma da entrada vinda do navegador. Lança um erro genérico (sem nenhum valor da
 * entrada) se não for o formato do contrato.
 */
export function lerEntradaListarModelos(entrada: unknown): EntradaListarModelos {
  if (entrada === null || typeof entrada !== "object") throw new Error("Pedido inválido.");
  const e = entrada as Record<string, unknown>;
  const provedor = PROVEDORES_IA.find((p) => p === e["provedor"]);
  if (!provedor) throw new Error("Provedor de IA desconhecido.");
  const chave = e["chave"];
  const workspaceId = e["workspaceId"];
  if (chave !== undefined && chave !== null && (typeof chave !== "string" || chave.length > 1000)) {
    throw new Error("Pedido inválido: chave.");
  }
  if (workspaceId !== undefined && workspaceId !== null && (typeof workspaceId !== "string" || workspaceId.length > 200)) {
    throw new Error("Pedido inválido: workspace.");
  }
  const lida: EntradaListarModelos = { provedor };
  if (typeof chave === "string") lida.chave = chave;
  if (typeof workspaceId === "string" && workspaceId.trim() !== "") lida.workspaceId = workspaceId.trim();
  return lida;
}

// ---------- pedidos ----------

export function requisicaoAnthropicModelos(chave: string, workspaceId?: string, depoisDe?: string): Requisicao {
  const headers: Record<string, string> = {
    "x-api-key": chave.trim(),
    "anthropic-version": ANTHROPIC_VERSAO,
  };
  if (workspaceId) headers["anthropic-workspace-id"] = workspaceId;
  const busca = new URLSearchParams({ limit: "1000" });
  if (depoisDe) busca.set("after_id", depoisDe);
  return { url: `${ANTHROPIC_BASE}/models?${busca.toString()}`, init: { method: "GET", headers } };
}

export function requisicaoOpenAIModelos(chave: string): Requisicao {
  return {
    url: `${OPENAI_BASE}/models`,
    init: { method: "GET", headers: { Authorization: `Bearer ${chave.trim()}` } },
  };
}

/** Pública: sem Authorization (a chave da OpenRouter nunca vai neste pedido). */
export function requisicaoOpenRouterModelosPublica(offset = 0): Requisicao {
  const busca = new URLSearchParams({ output_modalities: "text", supported_parameters: "tools", limit: "1000" });
  if (offset > 0) busca.set("offset", String(offset));
  return { url: `${OPENROUTER_BASE}/models?${busca.toString()}`, init: { method: "GET", headers: {} } };
}

// ---------- mensagens (texto fixo, sem nenhum dado da chave nem do provedor) ----------

type Falha = Extract<ResultadoListarModelos, { ok: false }>;

function falha(erro: ErroChaveIA, mensagem: string): Falha {
  return { ok: false, erro, mensagem };
}

const msg = {
  chaveVazia: (p: ProvedorIA) =>
    falha("chave_invalida", `Cole a chave de API da ${NOME[p]} para ver os modelos que ela libera.`),
  fora: (p: ProvedorIA) =>
    falha(
      "provedor_fora",
      `A ${NOME[p]} não respondeu como esperado. Pode ser uma instabilidade do lado dela: tente de novo em alguns minutos.`,
    ),
  semRede: (p: ProvedorIA) =>
    falha("provedor_fora", `Não conseguimos falar com a ${NOME[p]} agora. Tente de novo em alguns minutos.`),
  tempo: (p: ProvedorIA) =>
    falha("tempo_esgotado", `A ${NOME[p]} demorou mais de 10 segundos para responder. Tente de novo em instantes.`),
  semModelos: (p: ProvedorIA) =>
    falha(
      "sem_permissao",
      `A chave da ${NOME[p]} funciona, mas não enxerga nenhum modelo de texto. Confira no painel da ${NOME[p]} se ela tem acesso aos modelos.`,
    ),
};

// ---------- leitura das respostas ----------

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined;
}

/** As traduções da validação devolvem ResultadoChaveIA; aqui só interessa a falha. */
function soFalha(r: ResultadoChaveIA | null): Falha | null {
  return r && !r.ok ? r : null;
}

/** Erro de status da Anthropic na listagem; null = 2xx. */
export function erroAnthropicModelos(r: RespostaHttp, e: EntradaListarModelos): Falha | null {
  if (r.status >= 200 && r.status < 300) return null;
  // 400 e 404 só têm sentido aqui quando falam de workspace ou de limite de gasto; o resto da
  // tradução de mapearAnthropic fala de modelo escolhido, que a listagem não tem.
  if (r.status === 400 || r.status === 404) {
    const t = lerTexto(r.corpo, "error", "message") ?? corpoComoTexto(r.corpo);
    if (!/workspace|usage limit/i.test(t)) return msg.fora("anthropic");
  }
  const comoValidacao: EntradaChaveIA = {
    provedor: "anthropic",
    chave: "",
    modelo: "",
    ...(e.workspaceId ? { workspaceId: e.workspaceId } : {}),
  };
  return soFalha(mapearAnthropic(r, comoValidacao)) ?? msg.fora("anthropic");
}

/** Erro de status da OpenAI na listagem; null = 2xx. */
export function erroOpenAIModelos(r: RespostaHttp): Falha | null {
  if (r.status >= 200 && r.status < 300) return null;
  if (r.status === 404) return msg.fora("openai");
  return soFalha(mapearOpenAI(r, { provedor: "openai", chave: "", modelo: "" })) ?? msg.fora("openai");
}

/** Uma página do GET /v1/models da Anthropic. Deixa de fora os modelos deprecated e retired. */
export function lerPaginaAnthropic(corpo: unknown): { modelos: ModeloBruto[]; proximo: string | null } | null {
  const lista = ler(corpo, "data");
  if (!Array.isArray(lista)) return null;
  const modelos: ModeloBruto[] = [];
  for (const item of lista) {
    const id = texto(lerTexto(item, "id"));
    if (!id) continue;
    const ciclo = lerTexto(item, "lifecycle");
    if (ciclo === "deprecated" || ciclo === "retired") continue;
    const nome = texto(lerTexto(item, "display_name"));
    modelos.push(nome ? { id, nome } : { id });
  }
  const temMais = ler(corpo, "has_more") === true;
  const ultimo = texto(lerTexto(corpo, "last_id")) ?? (lista.length > 0 ? texto(lerTexto(lista[lista.length - 1], "id")) : undefined);
  return { modelos, proximo: temMais && ultimo ? ultimo : null };
}

/**
 * Regra dos modelos de texto da OpenAI. O GET /v1/models não diz o que cada modelo faz, então a
 * regra é pelo id:
 * - entram as famílias de chat: ids que começam com "gpt-", "chatgpt-" ou "o" seguido de número
 *   (o1, o3, o4-mini...), e os ajustes finos delas ("ft:gpt-...");
 * - saem os que não conversam por texto: embedding, tts, whisper, transcribe, dall-e, gpt-image
 *   (e qualquer "image"), moderation, realtime, audio, search, instruct (completions antigo),
 *   computer-use, deep-research, sora e diarize;
 * - todo o resto (operadornci, babbage, text-embedding, omni-moderation...) fica fora por não ser
 *   de uma família de chat.
 */
export function ehModeloDeTextoOpenAI(id: string): boolean {
  const base = id.toLowerCase().replace(/^ft:/, "");
  if (!/^(gpt-|chatgpt-|o\d)/.test(base)) return false;
  return !/(embedding|tts|whisper|transcribe|dall-e|image|moderation|realtime|audio|search|instruct|computer-use|deep-research|sora|diarize)/.test(
    base,
  );
}

export function lerListaOpenAI(corpo: unknown): ModeloBruto[] | null {
  const lista = ler(corpo, "data");
  if (!Array.isArray(lista)) return null;
  const modelos: ModeloBruto[] = [];
  for (const item of lista) {
    const id = texto(lerTexto(item, "id"));
    if (id && ehModeloDeTextoOpenAI(id)) modelos.push({ id });
  }
  return modelos;
}

/** Fabricantes pelo prefixo do id da OpenRouter, quando o nome não traz "Fabricante: ...". */
const FABRICANTES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "meta-llama": "Meta",
  mistralai: "Mistral",
  "x-ai": "xAI",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  cohere: "Cohere",
  amazon: "Amazon",
  microsoft: "Microsoft",
  nvidia: "NVIDIA",
  moonshotai: "Moonshot AI",
  perplexity: "Perplexity",
  openrouter: "OpenRouter",
};

export function fabricanteOpenRouter(id: string, nome?: string): string | undefined {
  const doNome = nome?.match(/^([^:]{1,40}):\s+\S/)?.[1]?.trim();
  if (doNome) return doNome;
  const prefixo = id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
  if (!prefixo) return undefined;
  return FABRICANTES[prefixo.toLowerCase()] ?? prefixo;
}

/** US$ por token (string ou número) para US$ por 1M de tokens; negativo (preço variável) = sem preço. */
export function porMilhao(valor: unknown): number | undefined {
  const n = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() !== "" ? Number(valor) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  // arredonda só o ruído da conta em ponto flutuante (0,0000001 × 1e6 = 0,09999999999999999)
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

function geraTexto(item: unknown): boolean {
  const saidas = ler(item, "architecture", "output_modalities");
  if (Array.isArray(saidas)) return saidas.includes("text");
  const modalidade = lerTexto(item, "architecture", "modality");
  if (modalidade && modalidade.includes("->")) return modalidade.split("->")[1]?.includes("text") ?? false;
  return false;
}

function aceitaFerramentas(item: unknown): boolean {
  const parametros = ler(item, "supported_parameters");
  // sem o campo, confia no filtro supported_parameters=tools do pedido
  return Array.isArray(parametros) ? parametros.includes("tools") : true;
}

/** Uma página do GET /api/v1/models da OpenRouter. */
export function lerPaginaOpenRouter(
  corpo: unknown,
  offset: number,
): { modelos: ModeloBruto[]; proximo: number | null } | null {
  const lista = ler(corpo, "data");
  if (!Array.isArray(lista)) return null;
  const modelos: ModeloBruto[] = [];
  for (const item of lista) {
    const id = texto(lerTexto(item, "id"));
    if (!id || !geraTexto(item) || !aceitaFerramentas(item)) continue;
    const nome = texto(lerTexto(item, "name"));
    const modelo: ModeloBruto = { id };
    if (nome) modelo.nome = nome;
    const fabricante = fabricanteOpenRouter(id, nome);
    if (fabricante) modelo.fabricante = fabricante;
    const entrada = porMilhao(ler(item, "pricing", "prompt"));
    const saida = porMilhao(ler(item, "pricing", "completion"));
    if (entrada !== undefined && saida !== undefined) {
      modelo.precoEntrada = entrada;
      modelo.precoSaida = saida;
    }
    modelos.push(modelo);
  }
  const total = lerNumero(corpo, "total_count");
  const fim = offset + lista.length;
  return { modelos, proximo: lista.length > 0 && total !== undefined && total > fim ? fim : null };
}

// ---------- união com a lista curada ----------

/**
 * O modelo listado casa com o curado pelo id exato ou pelo começo do id, quando o resto é uma
 * data ou versão ("claude-haiku-5-5-20261001", "gpt-6-luna-2026-09-22"). "gpt-6-luna-mini" não
 * casa com "gpt-6-luna".
 */
export function casaComCurado(id: string, curado: string): "exato" | "comeco" | null {
  if (id === curado) return "exato";
  if (id.startsWith(curado) && /^[-@]\d/.test(id.slice(curado.length))) return "comeco";
  return null;
}

function curadoDe(provedor: ProvedorIA, id: string): { modelo: ModeloIA; como: "exato" | "comeco" } | undefined {
  let porComeco: ModeloIA | undefined;
  for (const m of MODELOS) {
    if (m.provedor !== provedor) continue;
    const como = casaComCurado(id, m.id);
    if (como === "exato") return { modelo: m, como };
    if (como === "comeco" && (!porComeco || m.id.length > porComeco.id.length)) porComeco = m;
  }
  return porComeco ? { modelo: porComeco, como: "comeco" } : undefined;
}

/**
 * Une a lista do provedor com a curada:
 * - nome: o do provedor; na OpenAI (que não tem nome), o da curada quando o id é exato, senão o id;
 * - preço: o do provedor (só a OpenRouter informa); senão o da curada, quando casar; senão nenhum;
 * - perfil: o da curada, quando casar (na OpenRouter o "perfil" da curada é o fabricante e vai
 *   em `fabricante`, quando o provedor não trouxer um);
 * - recomendado: o recomendado da curada marca um só modelo listado, o de id exato ou, sem ele,
 *   o primeiro que casa pelo começo do id;
 * - ordem: o recomendado primeiro, depois a ordem do provedor. Ids repetidos saem.
 */
export function unirComCurada(provedor: ProvedorIA, brutos: readonly ModeloBruto[]): ModeloListado[] {
  const vistos = new Set<string>();
  const modelos: ModeloListado[] = [];
  const casados: (ReturnType<typeof curadoDe> | undefined)[] = [];
  for (const b of brutos) {
    if (vistos.has(b.id)) continue;
    vistos.add(b.id);
    const casou = curadoDe(provedor, b.id);
    const c = casou?.modelo;
    const nome = b.nome ?? (c && casou?.como === "exato" ? c.nome : b.id);
    const m: ModeloListado = { id: b.id, nome, recomendado: false };
    const fabricante = b.fabricante ?? (provedor === "openrouter" ? c?.perfil : undefined);
    if (fabricante) m.fabricante = fabricante;
    if (c && provedor !== "openrouter") m.perfil = c.perfil;
    if (b.precoEntrada !== undefined && b.precoSaida !== undefined) {
      m.precoEntrada = b.precoEntrada;
      m.precoSaida = b.precoSaida;
    } else if (c) {
      m.precoEntrada = c.precoEntrada;
      m.precoSaida = c.precoSaida;
    }
    modelos.push(m);
    casados.push(casou);
  }

  for (const curado of MODELOS) {
    if (curado.provedor !== provedor || !curado.recomendado) continue;
    let alvo = modelos.findIndex((_, i) => casados[i]?.modelo === curado && casados[i]?.como === "exato");
    if (alvo < 0) alvo = modelos.findIndex((_, i) => casados[i]?.modelo === curado);
    const escolhido = alvo >= 0 ? modelos[alvo] : undefined;
    if (escolhido) escolhido.recomendado = true;
  }

  return [...modelos.filter((m) => m.recomendado), ...modelos.filter((m) => !m.recomendado)];
}

/** A lista curada no formato da listagem (reserva da OpenRouter fora do ar). */
export function listaCurada(provedor: ProvedorIA): ModeloListado[] {
  const modelos = MODELOS.filter((m) => m.provedor === provedor).map((m): ModeloListado => {
    const listado: ModeloListado = {
      id: m.id,
      nome: m.nome,
      precoEntrada: m.precoEntrada,
      precoSaida: m.precoSaida,
      recomendado: m.recomendado,
    };
    if (provedor === "openrouter") listado.fabricante = m.perfil;
    else listado.perfil = m.perfil;
    return listado;
  });
  return [...modelos.filter((m) => m.recomendado), ...modelos.filter((m) => !m.recomendado)];
}

// ---------- fluxo ----------

async function buscarAnthropic(
  e: EntradaListarModelos,
  chave: string,
  o: OpcoesValidacao | undefined,
  prazo: Prazo,
): Promise<ResultadoListarModelos> {
  const brutos: ModeloBruto[] = [];
  let depoisDe: string | undefined;
  for (let pagina = 0; pagina < ANTHROPIC_MAX_PAGINAS; pagina += 1) {
    const req = requisicaoAnthropicModelos(chave, e.workspaceId, depoisDe);
    const r = await pedir(o, prazo, req.url, req.init, [chave]);
    const erro = erroAnthropicModelos(r, e);
    if (erro) return erro;
    const lida = lerPaginaAnthropic(r.corpo);
    if (!lida) return msg.fora("anthropic");
    brutos.push(...lida.modelos);
    if (!lida.proximo || lida.proximo === depoisDe) break;
    depoisDe = lida.proximo;
  }
  if (brutos.length === 0) return msg.semModelos("anthropic");
  return { ok: true, origem: "provedor", modelos: unirComCurada("anthropic", brutos) };
}

async function buscarOpenAI(
  chave: string,
  o: OpcoesValidacao | undefined,
  prazo: Prazo,
): Promise<ResultadoListarModelos> {
  const req = requisicaoOpenAIModelos(chave);
  const r = await pedir(o, prazo, req.url, req.init, [chave]);
  const erro = erroOpenAIModelos(r);
  if (erro) return erro;
  const brutos = lerListaOpenAI(r.corpo);
  if (!brutos) return msg.fora("openai");
  if (brutos.length === 0) return msg.semModelos("openai");
  return { ok: true, origem: "provedor", modelos: unirComCurada("openai", brutos) };
}

const RESERVA_OPENROUTER = (): ResultadoListarModelos => ({
  ok: true,
  origem: "lista_curada",
  modelos: listaCurada("openrouter"),
});

async function buscarOpenRouter(o: OpcoesValidacao | undefined, prazo: Prazo): Promise<ResultadoListarModelos> {
  const brutos: ModeloBruto[] = [];
  let offset = 0;
  for (let pagina = 0; pagina < OPENROUTER_MAX_PAGINAS; pagina += 1) {
    let r: RespostaHttp;
    try {
      const req = requisicaoOpenRouterModelosPublica(offset);
      r = await pedir(o, prazo, req.url, req.init);
    } catch {
      // rede ou tempo: com páginas já lidas, segue com elas; sem nenhuma, a curada
      if (pagina === 0) return RESERVA_OPENROUTER();
      break;
    }
    const lida = r.status >= 200 && r.status < 300 ? lerPaginaOpenRouter(r.corpo, offset) : null;
    if (!lida) {
      if (pagina === 0) return RESERVA_OPENROUTER();
      break;
    }
    brutos.push(...lida.modelos);
    if (lida.proximo === null) break;
    offset = lida.proximo;
  }
  if (brutos.length === 0) return RESERVA_OPENROUTER();
  return { ok: true, origem: "provedor", modelos: unirComCurada("openrouter", brutos) };
}

/** Limpa a chave de todos os textos da resposta, inclusive nome e id de cada modelo. */
function blindarResultado(resultado: ResultadoListarModelos, segredos: readonly string[]): ResultadoListarModelos {
  if (!resultado.ok) return blindar(resultado, segredos);
  return {
    ...resultado,
    modelos: resultado.modelos.map((m) => {
      const limpo: ModeloListado = { ...m, id: apagarSegredos(m.id, segredos), nome: apagarSegredos(m.nome, segredos) };
      if (m.fabricante !== undefined) limpo.fabricante = apagarSegredos(m.fabricante, segredos);
      if (m.perfil !== undefined) limpo.perfil = apagarSegredos(m.perfil, segredos);
      return limpo;
    }),
  };
}

/** Valor que pode ir num cabeçalho HTTP como está: só ASCII visível, sem espaço. */
const SO_ASCII_VISIVEL = /^[\x21-\x7e]+$/;

/**
 * A chave e o workspace vão em cabeçalho, e o fetch recusa (TypeError) valor com caractere acima
 * de 0xFF, o que viraria "não conseguimos falar com o provedor". Um caractere fora do ASCII
 * visível (travessão no lugar do hífen, reticência, espaço de largura zero, espaço no meio) já
 * mostra que o valor foi colado errado: devolve a mesma falha de um 401 (ou do workspace
 * recusado), sem chamar o provedor e sem texto novo.
 */
function conferirCabecalhos(e: EntradaListarModelos, chave: string): Falha | null {
  if (e.provedor === "openrouter") return null; // a chave da OpenRouter nunca é mandada
  const comoValidacao: EntradaChaveIA = { provedor: e.provedor, chave: "", modelo: "" };
  if (!SO_ASCII_VISIVEL.test(chave)) {
    const nao401: RespostaHttp = { status: 401, corpo: null };
    const r = e.provedor === "gemini" ? mapearGemini(nao401, comoValidacao) : e.provedor === "anthropic" ? mapearAnthropic(nao401, comoValidacao) : mapearOpenAI(nao401, comoValidacao);
    return soFalha(r) ?? msg.fora(e.provedor);
  }
  if (e.provedor === "anthropic" && e.workspaceId && !SO_ASCII_VISIVEL.test(e.workspaceId)) {
    return erroAnthropicModelos({ status: 404, corpo: { error: { message: "workspace" } } }, e) ?? msg.fora("anthropic");
  }
  return null;
}

/** Lista real da conta Gemini, paginada; nenhum identificador de modelo fixo é exigido. */
export async function buscarGemini(chave: string, opcoes: OpcoesValidacao | undefined, prazo: Prazo): Promise<ResultadoListarModelos> {
  const modelos = new Map<string, ModeloListado>();
  let proxima: string | undefined;
  for (let pagina = 0; pagina < 5; pagina++) {
    const params = new URLSearchParams({ pageSize: '1000' });
    if (proxima) params.set('pageToken', proxima);
    const r = await pedir(opcoes, prazo, `https://generativelanguage.googleapis.com/v1beta/models?${params}`, {
      method: 'GET', headers: { 'x-goog-api-key': chave },
    }, [chave]);
    if (r.status < 200 || r.status >= 300) {
      return soFalha(mapearGemini(r, { provedor: 'gemini', chave, modelo: '' })) ?? msg.fora('gemini');
    }
    const lista = ler(r.corpo, 'models');
    if (!Array.isArray(lista)) return msg.fora('gemini');
    for (const item of lista) {
      const nome = lerTexto(item, 'name');
      const metodos = ler(item, 'supportedGenerationMethods');
      if (!nome?.startsWith('models/') || !Array.isArray(metodos) || !metodos.includes('generateContent')) continue;
      const id = nome.slice(7);
      if (!/^gemini-/.test(id) || /image|tts|robotics|embedding|computer-use/.test(id)) continue;
      modelos.set(id, { id, nome: lerTexto(item, 'displayName') || id, fabricante: 'Google', recomendado: false });
    }
    proxima = lerTexto(r.corpo, 'nextPageToken') || undefined;
    if (!proxima) break;
  }
  if (proxima) return { ok: false, erro: 'provedor_fora', mensagem: 'A lista de modelos excedeu o limite de consulta. Tente novamente.' };
  if (!modelos.size) return msg.semModelos('gemini');
  return { ok: true, origem: 'provedor', modelos: [...modelos.values()].sort((a,b) => a.nome.localeCompare(b.nome)) };
}

/**
 * Busca os modelos de texto no provedor, sem gravar nada. Na Anthropic e na OpenAI a busca já
 * confere a chave. A resposta nunca traz a chave.
 */
export async function listarModelosLogica(
  entrada: EntradaListarModelos,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoListarModelos> {
  const segredos = entrada.chave ? [entrada.chave] : [];
  const provedor = entrada.provedor;
  const chave = (entrada.chave ?? "").trim();
  if (provedor !== "openrouter" && !chave) return msg.chaveVazia(provedor);
  const recusada = conferirCabecalhos(entrada, chave);
  if (recusada) return blindarResultado(recusada, segredos);

  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: ResultadoListarModelos;
  try {
    resultado =
      provedor === "gemini"
        ? await buscarGemini(chave, opcoes, prazo)
        : provedor === "anthropic"
        ? await buscarAnthropic(entrada, chave, opcoes, prazo)
        : provedor === "openai"
          ? await buscarOpenAI(chave, opcoes, prazo)
          : await buscarOpenRouter(opcoes, prazo);
  } catch (falhou) {
    if (provedor === "openrouter") resultado = RESERVA_OPENROUTER();
    else if (falhou instanceof TempoEsgotado) resultado = msg.tempo(provedor);
    else if (falhou instanceof FalhaDeRede) resultado = msg.semRede(provedor);
    else resultado = msg.fora(provedor);
  } finally {
    prazo.encerrar();
  }
  return blindarResultado(resultado, segredos);
}
