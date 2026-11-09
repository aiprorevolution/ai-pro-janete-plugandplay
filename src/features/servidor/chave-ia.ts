// Validação da chave de IA colada no onboarding (etapa cérebro). Lógica pura: monta o pedido
// de cada provedor e traduz a resposta para o contrato da spec. A função de servidor
// (validar-chave-ia.functions.ts) só chama validarChaveIALogica.
//
// Endpoints e cabeçalhos: docs/pesquisa-motores-ia.md (a conferência vale sobre a pesquisa).
// - Anthropic: POST /v1/messages/count_tokens, que a conferência confirma como "free to use" e
//   que testa de uma vez a chave, o modelo e o workspace (o GET /v1/models não tem custo
//   confirmado). Cabeçalhos Authorization: Bearer, anthropic-version e, quando vier,
//   anthropic-workspace-id.
// - OpenAI: GET /v1/models/{modelo} com Authorization: Bearer.
// - OpenRouter: GET /api/v1/key (limite e saldo da chave) e depois
//   GET /api/v1/models?supported_parameters=tools para confirmar que o modelo existe e aceita
//   ferramentas.

import {
  abrirPrazo,
  blindar,
  corpoComoTexto,
  FalhaDeRede,
  ler,
  lerNumero,
  lerTexto,
  pedir,
  TempoEsgotado,
  ultimos4,
  type OpcoesValidacao,
  type Prazo,
  type RespostaHttp,
} from "./http";

export const PROVEDORES_IA = ["anthropic", "openai", "openrouter", "gemini"] as const;
export type ProvedorIA = (typeof PROVEDORES_IA)[number];

export type ErroChaveIA =
  | "chave_invalida"
  | "sem_permissao"
  | "sem_credito"
  | "workspace_necessario"
  | "modelo_indisponivel"
  | "provedor_fora"
  | "tempo_esgotado";

export type EntradaChaveIA = {
  provedor: ProvedorIA;
  chave: string;
  modelo: string;
  workspaceId?: string;
};

export type ResultadoChaveIA =
  | { ok: true; ultimos4: string }
  | { ok: false; erro: ErroChaveIA; mensagem: string };

export const ANTHROPIC_VERSAO = "2026-10-21";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
/** Páginas da lista de modelos da OpenRouter lidas no máximo (1.000 modelos por página). */
const OPENROUTER_MAX_PAGINAS = 3;

const NOME: Record<ProvedorIA, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

export type Requisicao = { url: string; init: RequestInit };

/**
 * Confere a forma da entrada vinda do navegador. Lança um erro genérico (sem nenhum valor da
 * entrada) se não for o formato do contrato.
 */
export function lerEntradaChaveIA(entrada: unknown): EntradaChaveIA {
  if (entrada === null || typeof entrada !== "object") throw new Error("Pedido inválido.");
  const e = entrada as Record<string, unknown>;
  const provedor = e["provedor"];
  const chave = e["chave"];
  const modelo = e["modelo"];
  const workspaceId = e["workspaceId"];
  if (typeof provedor !== "string" || !(PROVEDORES_IA as readonly string[]).includes(provedor)) {
    throw new Error("Pedido inválido: provedor desconhecido.");
  }
  if (typeof chave !== "string" || chave.length > 1000) throw new Error("Pedido inválido: chave.");
  if (typeof modelo !== "string" || modelo.length > 200) throw new Error("Pedido inválido: modelo.");
  if (workspaceId !== undefined && workspaceId !== null && (typeof workspaceId !== "string" || workspaceId.length > 200)) {
    throw new Error("Pedido inválido: workspace.");
  }
  const lida: EntradaChaveIA = { provedor: provedor as ProvedorIA, chave, modelo };
  if (typeof workspaceId === "string" && workspaceId.trim() !== "") lida.workspaceId = workspaceId.trim();
  return lida;
}

// ---------- montagem dos pedidos ----------

export function requisicaoAnthropic(e: EntradaChaveIA): Requisicao {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${e.chave.trim()}`,
    "anthropic-version": ANTHROPIC_VERSAO,
    "content-type": "application/json",
  };
  if (e.workspaceId) headers["anthropic-workspace-id"] = e.workspaceId;
  return {
    url: `${ANTHROPIC_BASE}/messages/count_tokens`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({ model: e.modelo.trim(), messages: [{ role: "user", content: "Oi" }] }),
    },
  };
}

export function requisicaoOpenAI(e: EntradaChaveIA): Requisicao {
  return {
    url: `${OPENAI_BASE}/models/${encodeURIComponent(e.modelo.trim())}`,
    init: { method: "GET", headers: { Authorization: `Bearer ${e.chave.trim()}` } },
  };
}

export function requisicaoOpenRouterChave(e: EntradaChaveIA): Requisicao {
  return {
    url: `${OPENROUTER_BASE}/key`,
    init: { method: "GET", headers: { Authorization: `Bearer ${e.chave.trim()}` } },
  };
}

export function requisicaoOpenRouterModelos(e: EntradaChaveIA, offset = 0): Requisicao {
  const busca = new URLSearchParams({ supported_parameters: "tools", limit: "1000" });
  if (offset > 0) busca.set("offset", String(offset));
  return {
    url: `${OPENROUTER_BASE}/models?${busca.toString()}`,
    init: { method: "GET", headers: { Authorization: `Bearer ${e.chave.trim()}` } },
  };
}

// ---------- mensagens (texto humano, sem nenhum dado da chave) ----------

function falha(erro: ErroChaveIA, mensagem: string): ResultadoChaveIA {
  return { ok: false, erro, mensagem };
}

const msg = {
  chaveVazia: (p: ProvedorIA) => falha("chave_invalida", `Cole a chave de API da ${NOME[p]} para continuar.`),
  modeloVazio: () => falha("modelo_indisponivel", "Escolha um modelo antes de testar a chave."),
  chaveInvalida: (p: ProvedorIA) =>
    falha(
      "chave_invalida",
      p === "gemini"
        ? "O Google não reconheceu a chave. Confira a chave da API Gemini no Google AI Studio."
        : p === "anthropic"
        ? "A Anthropic não reconheceu a chave. Ela pode estar errada, revogada ou vencida. Copie de novo do console da Anthropic, sem espaço no começo ou no fim."
        : p === "openai"
          ? "A OpenAI não reconheceu a chave. Confira se copiou a chave inteira e se ela não foi revogada no painel da OpenAI."
          : "A OpenRouter não reconheceu a chave. Confira se copiou a chave inteira e se ela ainda está ativa em openrouter.ai.",
    ),
  semPermissao: (p: ProvedorIA) =>
    falha(
      "sem_permissao",
      p === "openai"
        ? "A chave da OpenAI existe, mas não tem permissão para usar modelos. Se for uma chave restrita, libere \"Model capabilities\" e \"List models\" no painel, ou crie uma chave nova."
        : `A chave da ${NOME[p]} existe, mas não tem permissão para esse uso. Peça ao administrador da conta uma chave com acesso aos modelos.`,
    ),
  semCredito: (p: ProvedorIA) =>
    falha(
      "sem_credito",
      p === "openrouter"
        ? "A chave da OpenRouter está sem crédito ou chegou ao limite dela. Coloque crédito na conta ou aumente o limite da chave e tente de novo."
        : `A conta da ${NOME[p]} está sem crédito ou chegou ao limite de gasto. Coloque crédito ou ajuste o limite no painel e tente de novo.`,
    ),
  limiteDoWorkspace: () =>
    falha(
      "sem_credito",
      "A conta ou o workspace dessa chave chegou ao limite de gasto definido no console da Anthropic. Aumente o limite e tente de novo.",
    ),
  workspaceNecessario: (temWorkspace: boolean) =>
    falha(
      "workspace_necessario",
      temWorkspace
        ? "A Anthropic não aceitou esse ID de workspace. Confira o ID (começa com wrkspc_) e se a chave tem acesso a ele."
        : "Essa chave da Anthropic não está presa a um workspace. Informe o ID do workspace (começa com wrkspc_) ou crie a chave dentro de um workspace.",
    ),
  modeloIndisponivel: (p: ProvedorIA, modelo: string) =>
    falha(
      "modelo_indisponivel",
      `A chave funciona, mas o modelo ${modelo.trim()} não está disponível para ela na ${NOME[p]}. Escolha outro modelo.`,
    ),
  modeloSemFerramentas: (modelo: string) =>
    falha(
      "modelo_indisponivel",
      `A chave funciona, mas o modelo ${modelo.trim()} não aparece na OpenRouter como compatível com ferramentas. Escolha outro modelo.`,
    ),
  muitasChamadas: (p: ProvedorIA) =>
    falha("provedor_fora", `A ${NOME[p]} está recebendo chamadas demais agora. Espere um minuto e tente de novo.`),
  fora: (p: ProvedorIA) =>
    falha("provedor_fora", `A ${NOME[p]} não respondeu como esperado. Pode ser uma instabilidade do lado dela: tente de novo em alguns minutos.`),
  semRede: (p: ProvedorIA) =>
    falha("provedor_fora", `Não conseguimos falar com a ${NOME[p]} agora. Tente de novo em alguns minutos.`),
  tempo: (p: ProvedorIA) =>
    falha("tempo_esgotado", `A ${NOME[p]} demorou mais de 10 segundos para responder. Tente de novo em instantes.`),
};

// ---------- tradução das respostas ----------

function mensagemDoErro(corpo: unknown): string {
  return lerTexto(corpo, "error", "message") ?? corpoComoTexto(corpo);
}

/** Resultado da Anthropic; null = chave aceita. */
export function mapearAnthropic(r: RespostaHttp, e: EntradaChaveIA): ResultadoChaveIA | null {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) return null;
  const texto = mensagemDoErro(corpo);
  const falaDeWorkspace = /workspace/i.test(texto);
  if (status === 400) {
    // limite de gasto definido pela própria organização ("specified ... usage limits")
    if (/usage limit/i.test(texto)) return msg.limiteDoWorkspace();
    if (falaDeWorkspace) return msg.workspaceNecessario(Boolean(e.workspaceId));
    return msg.modeloIndisponivel("anthropic", e.modelo);
  }
  if (status === 401) return msg.chaveInvalida("anthropic");
  if (status === 402) return msg.semCredito("anthropic");
  if (status === 403) return msg.semPermissao("anthropic");
  if (status === 404) {
    if (falaDeWorkspace) return msg.workspaceNecessario(true);
    return msg.modeloIndisponivel("anthropic", e.modelo);
  }
  if (status === 429) {
    // teto mensal da faixa: sem retry-after e com este código; não adianta repetir
    if (lerTexto(corpo, "error", "details", "error_code") === "enforced_spend_limit_reached") {
      return msg.semCredito("anthropic");
    }
    return msg.muitasChamadas("anthropic");
  }
  return msg.fora("anthropic");
}

const OPENAI_SEM_CREDITO = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

/** Resultado da OpenAI; null = chave aceita. */
export function mapearOpenAI(r: RespostaHttp, e: EntradaChaveIA): ResultadoChaveIA | null {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) return null;
  if (status === 401) {
    // a conferência lembra que 401 também é "lacks permission for the endpoint"
    if (/permission|scope/i.test(mensagemDoErro(corpo))) return msg.semPermissao("openai");
    return msg.chaveInvalida("openai");
  }
  if (status === 403) return msg.semPermissao("openai");
  if (status === 404) return msg.modeloIndisponivel("openai", e.modelo);
  if (status === 429) {
    const tipo = lerTexto(corpo, "error", "type") ?? "";
    const codigo = lerTexto(corpo, "error", "code") ?? "";
    if (OPENAI_SEM_CREDITO.has(tipo) || OPENAI_SEM_CREDITO.has(codigo)) return msg.semCredito("openai");
    return msg.muitasChamadas("openai");
  }
  return msg.fora("openai");
}

/** Consulta metadados do modelo, sem gerar conteúdo ou gastar tokens. */
export function requisicaoGemini(e: EntradaChaveIA): Requisicao {
  const modelo = e.modelo.trim().replace(/^models\//, '');
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}`,
    init: { method: 'GET', headers: { 'x-goog-api-key': e.chave.trim() } },
  };
}

export function mapearGemini(r: RespostaHttp, e: EntradaChaveIA): ResultadoChaveIA | null {
  if (r.status >= 200 && r.status < 300) {
    const metodos = ler(r.corpo, 'supportedGenerationMethods');
    return Array.isArray(metodos) && metodos.includes('generateContent') ? null : msg.modeloIndisponivel('gemini', e.modelo);
  }
  if (r.status === 400 || r.status === 401) return msg.chaveInvalida('gemini');
  if (r.status === 403) return msg.semPermissao('gemini');
  if (r.status === 404) return msg.modeloIndisponivel('gemini', e.modelo);
  if (r.status === 429) return msg.muitasChamadas('gemini');
  return msg.fora('gemini');
}

async function validarGemini(e: EntradaChaveIA, o: OpcoesValidacao | undefined, prazo: Prazo) {
  const req = requisicaoGemini(e);
  return mapearGemini(await pedir(o, prazo, req.url, req.init, [e.chave]), e);
}

/** Status de erro comum aos dois pedidos da OpenRouter. */
function mapearStatusOpenRouter(status: number): ResultadoChaveIA {
  if (status === 401) return msg.chaveInvalida("openrouter");
  if (status === 402) return msg.semCredito("openrouter");
  if (status === 403) return msg.semPermissao("openrouter");
  if (status === 429) return msg.muitasChamadas("openrouter");
  return msg.fora("openrouter");
}

/** Resposta do GET /key; null = chave aceita e com saldo. */
export function mapearOpenRouterChave(r: RespostaHttp): ResultadoChaveIA | null {
  if (r.status < 200 || r.status >= 300) return mapearStatusOpenRouter(r.status);
  const dados = ler(r.corpo, "data");
  if (dados === null || typeof dados !== "object") return msg.fora("openrouter");
  // limit_remaining é null quando a chave não tem teto
  const restante = lerNumero(dados, "limit_remaining");
  const orcamento = lerNumero(dados, "effective_budget", "remaining_usd");
  if ((restante !== undefined && restante <= 0) || (orcamento !== undefined && orcamento <= 0)) {
    return msg.semCredito("openrouter");
  }
  return null;
}

type BuscaModelo = { achou: "sim" } | { achou: "sem_tools" } | { achou: "nao"; proximo: number | null };

/** Procura o modelo numa página da lista filtrada por tools. */
export function procurarModeloOpenRouter(corpo: unknown, modelo: string, offset: number): BuscaModelo {
  const lista = ler(corpo, "data");
  const alvo = modelo.trim();
  if (!Array.isArray(lista)) return { achou: "nao", proximo: null };
  for (const item of lista) {
    const id = lerTexto(item, "id");
    const slug = lerTexto(item, "canonical_slug");
    if (id === alvo || slug === alvo) {
      const parametros = ler(item, "supported_parameters");
      if (Array.isArray(parametros) && !parametros.includes("tools")) return { achou: "sem_tools" };
      return { achou: "sim" };
    }
  }
  const total = lerNumero(corpo, "total_count");
  const fim = offset + lista.length;
  const proximo = lista.length > 0 && total !== undefined && total > fim ? fim : null;
  return { achou: "nao", proximo };
}

// ---------- fluxo ----------

async function validarAnthropic(e: EntradaChaveIA, o: OpcoesValidacao | undefined, prazo: Prazo) {
  const req = requisicaoAnthropic(e);
  return mapearAnthropic(await pedir(o, prazo, req.url, req.init, [e.chave]), e);
}

async function validarOpenAI(e: EntradaChaveIA, o: OpcoesValidacao | undefined, prazo: Prazo) {
  const req = requisicaoOpenAI(e);
  return mapearOpenAI(await pedir(o, prazo, req.url, req.init, [e.chave]), e);
}

async function validarOpenRouter(e: EntradaChaveIA, o: OpcoesValidacao | undefined, prazo: Prazo) {
  const reqChave = requisicaoOpenRouterChave(e);
  const erroChave = mapearOpenRouterChave(await pedir(o, prazo, reqChave.url, reqChave.init, [e.chave]));
  if (erroChave) return erroChave;

  let offset = 0;
  for (let pagina = 0; pagina < OPENROUTER_MAX_PAGINAS; pagina += 1) {
    const req = requisicaoOpenRouterModelos(e, offset);
    const r = await pedir(o, prazo, req.url, req.init, [e.chave]);
    if (r.status === 404) return msg.modeloIndisponivel("openrouter", e.modelo);
    if (r.status < 200 || r.status >= 300) return mapearStatusOpenRouter(r.status);
    const busca = procurarModeloOpenRouter(r.corpo, e.modelo, offset);
    if (busca.achou === "sim") return null;
    if (busca.achou === "sem_tools") return msg.modeloSemFerramentas(e.modelo);
    if (busca.proximo === null) break;
    offset = busca.proximo;
  }
  return msg.modeloSemFerramentas(e.modelo);
}

/**
 * Testa a chave no provedor, sem gravar nada. A resposta nunca traz a chave: só os ultimos4.
 */
export async function validarChaveIALogica(
  entrada: EntradaChaveIA,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoChaveIA> {
  const segredos = [entrada.chave];
  const chave = entrada.chave.trim();
  if (!chave) return msg.chaveVazia(entrada.provedor);
  if (!entrada.modelo.trim()) return msg.modeloVazio();

  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: ResultadoChaveIA;
  try {
    const erro =
      entrada.provedor === "gemini"
        ? await validarGemini(entrada, opcoes, prazo)
        : entrada.provedor === "anthropic"
        ? await validarAnthropic(entrada, opcoes, prazo)
        : entrada.provedor === "openai"
          ? await validarOpenAI(entrada, opcoes, prazo)
          : await validarOpenRouter(entrada, opcoes, prazo);
    resultado = erro ?? { ok: true, ultimos4: ultimos4(chave) };
  } catch (falhou) {
    if (falhou instanceof TempoEsgotado) resultado = msg.tempo(entrada.provedor);
    else if (falhou instanceof FalhaDeRede) resultado = msg.semRede(entrada.provedor);
    else resultado = msg.fora(entrada.provedor);
  } finally {
    prazo.encerrar();
  }
  return blindar(resultado, segredos);
}
