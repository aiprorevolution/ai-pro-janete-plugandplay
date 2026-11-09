// Classificação dos erros do provedor de IA em códigos do banco (motivo_humano). Puro: não
// toca no banco nem guarda o texto do erro, que pode trazer trecho do pedido.
import { APICallError, RetryError } from "ai";

export type ClasseErroIA = {
  motivo: "chave_invalida" | "sem_credito" | "erro_provedor";
  passageiro: boolean;
  /** Novo status da chave em ia_chaves, quando o erro é da chave. */
  statusChave?: "invalida" | "sem_credito";
  /** Código curto para ia_chaves.ultimo_erro. */
  codigo: string;
};

export type ProvedorErro = "anthropic" | "openai" | "openrouter" | "gemini" | "groq";

// Saldo ou teto de gasto esgotado (pesquisa, seção 4 e conferências):
// - OpenAI: insufficient_quota, credit_balance_exhausted, *_spend_limit_exceeded (429);
// - Anthropic: billing_error (402), enforced_spend_limit_reached (429, teto mensal) e
//   "You have reached your specified (workspace) API usage limits" (400);
// - OpenRouter: "insufficient credits" (402, já coberto pelo status).
// Os códigos vêm dos campos code, type e details.error_code; a frase, só do "message" do erro.
// O corpo bruto não entra, para palavra solta ("billing", "limit") não marcar a chave.
const CODIGO_SEM_CREDITO = new RegExp(
  "^(" +
    [
      "insufficient_quota",
      "credit_balance_exhausted",
      "billing_error",
      "[a-z_]*_spend_limit_(exceeded|reached)",
      "[a-z_]*_usage_limit_exceeded",
    ].join("|") +
    ")$",
  "i",
);
const FRASE_SEM_CREDITO = /reached your specified (workspace )?API usage limits/i;

/** Desembrulha o RetryError (último erro) e causas encadeadas até achar um APICallError. */
function erroDeChamada(erro: unknown): APICallError | null {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && atual; i++) {
    if (APICallError.isInstance(atual)) return atual;
    if (RetryError.isInstance(atual)) {
      atual = atual.lastError;
      continue;
    }
    atual = (atual as { cause?: unknown }).cause;
  }
  return null;
}

function ehTempoOuAborto(erro: unknown): boolean {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && atual; i++) {
    const nome = (atual as { name?: unknown }).name;
    if (nome === "AbortError" || nome === "TimeoutError") return true;
    if (RetryError.isInstance(atual)) {
      if (atual.reason === "abort") return true;
      atual = atual.lastError;
      continue;
    }
    atual = (atual as { cause?: unknown }).cause;
  }
  return false;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * O "error" do corpo JSON da resposta ({ error: {...} }), se houver. O corpo bruto vem antes
 * do `data` já validado, porque o esquema do provedor pode tirar campos (o details da Anthropic).
 */
function erroDoCorpo(chamada: APICallError | null): Record<string, unknown> | null {
  if (!chamada) return null;
  if (chamada.responseBody) {
    try {
      const json = objeto(JSON.parse(chamada.responseBody));
      if (json) return objeto(json["error"]) ?? json;
    } catch {
      // corpo que não é JSON: tenta o data
    }
  }
  const dados = objeto(chamada.data);
  return dados ? (objeto(dados["error"]) ?? dados) : null;
}

/** 403 de guardrail ou moderação (OpenRouter): o pedido foi barrado, a chave está boa. */
function ehModeracao(
  provedor: ProvedorErro | undefined,
  erroCorpo: Record<string, unknown> | null,
) {
  if (provedor === "openrouter") return true;
  const meta = objeto(erroCorpo?.["metadata"]);
  return Boolean(meta && ("reasons" in meta || "flagged_input" in meta));
}

/**
 * 401 → chave_invalida; 403 → chave_invalida na Anthropic e na OpenAI, mas moderação na
 * OpenRouter (erro_provedor definitivo, sem marcar a chave); 402 ou saldo/teto esgotado →
 * sem_credito (o 402 "em voo" da OpenRouter é passageiro); 429, 5xx, 408, tempo esgotado,
 * rede ou erro desconhecido → erro_provedor passageiro; outro 4xx (pedido recusado, que não
 * muda ao repetir) → erro_provedor definitivo.
 */
export function classificarErroIA(erro: unknown, provedor?: ProvedorErro): ClasseErroIA {
  const chamada = erroDeChamada(erro);
  const status = chamada?.statusCode;
  const erroCorpo = erroDoCorpo(chamada);

  if (status === 401) {
    return {
      motivo: "chave_invalida",
      passageiro: false,
      statusChave: "invalida",
      codigo: "http_401",
    };
  }
  if (status === 403) {
    if (ehModeracao(provedor, erroCorpo)) {
      return { motivo: "erro_provedor", passageiro: false, codigo: "http_403_moderacao" };
    }
    return {
      motivo: "chave_invalida",
      passageiro: false,
      statusChave: "invalida",
      codigo: "http_403",
    };
  }

  // 402 da OpenRouter por orçamento "em voo": esperar e repetir; não é falta de saldo
  const meta = objeto(erroCorpo?.["metadata"]);
  if (status === 402 && meta?.["limit_source"] === "openrouter_in_flight_budget") {
    return { motivo: "erro_provedor", passageiro: true, codigo: "http_402_em_voo" };
  }

  // o corpo vem antes da regra do 429: teto de gasto e cota esgotada não adiantam repetir
  const detalhes = objeto(erroCorpo?.["details"]);
  const codigos = [erroCorpo?.["code"], erroCorpo?.["type"], detalhes?.["error_code"]].filter(
    (v): v is string => typeof v === "string",
  );
  const mensagem = erroCorpo?.["message"];
  const frase = typeof mensagem === "string" ? mensagem : (chamada?.message ?? "");
  const semCredito =
    codigos.some((c) => CODIGO_SEM_CREDITO.test(c)) || FRASE_SEM_CREDITO.test(frase);
  if (status === 402 || (chamada && semCredito)) {
    return {
      motivo: "sem_credito",
      passageiro: false,
      statusChave: "sem_credito",
      codigo: status ? `http_${status}` : "sem_credito",
    };
  }
  if (status !== undefined) {
    const passageiro = status === 408 || status === 409 || status === 429 || status >= 500;
    return { motivo: "erro_provedor", passageiro, codigo: `http_${status}` };
  }
  if (ehTempoOuAborto(erro)) return { motivo: "erro_provedor", passageiro: true, codigo: "tempo" };
  return { motivo: "erro_provedor", passageiro: true, codigo: chamada ? "rede" : "desconhecido" };
}
