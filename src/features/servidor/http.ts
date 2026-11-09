// Peças comuns das validações feitas no servidor (chave de IA e conexão de WhatsApp).
// Tudo aqui é puro e testável sem servidor: quem chama injeta o fetch.
//
// Regras de segurança (spec do onboarding, "Segurança das chaves"):
// - a chave e a credencial nunca vão para log, para a mensagem de erro nem para a resposta;
// - nenhum texto vindo do provedor é repassado ao usuário (a OpenAI, por exemplo, ecoa parte da
//   chave na mensagem de 401), só as nossas mensagens fixas em pt-BR;
// - os erros de rede e de tempo esgotado viram classes próprias, sem a URL (a da Z-API leva o
//   token da instância no caminho).

/** Tempo limite de cada validação, do primeiro pedido ao último. */
export const PRAZO_MS = 10_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type OpcoesValidacao = {
  /** fetch a usar; o padrão é o fetch global. Os testes passam um falso. */
  fetch?: Fetch;
  /** tempo limite em milissegundos; o padrão é PRAZO_MS. */
  prazoMs?: number;
};

export type RespostaHttp = {
  status: number;
  corpo: unknown;
};

export class TempoEsgotado extends Error {
  constructor() {
    super("tempo_esgotado");
    this.name = "TempoEsgotado";
  }
}

export class FalhaDeRede extends Error {
  constructor() {
    super("falha_de_rede");
    this.name = "FalhaDeRede";
  }
}

// Chamar o fetch global por uma função própria evita o "Illegal invocation" do Cloudflare
// Workers quando o fetch é chamado como método de outro objeto.
const fetchPadrao: Fetch = (input, init) => fetch(input, init);

/** Um prazo único para todos os pedidos de uma validação. */
export type Prazo = {
  sinal: AbortSignal;
  encerrar: () => void;
};

export function abrirPrazo(prazoMs: number = PRAZO_MS): Prazo {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), prazoMs);
  return {
    sinal: controle.signal,
    encerrar: () => clearTimeout(relogio),
  };
}

/**
 * Faz um pedido e devolve o status e o corpo já lido (JSON, quando der).
 * Nunca lança erro com a URL, os cabeçalhos ou a mensagem original: só TempoEsgotado ou
 * FalhaDeRede.
 */
export async function pedir(
  opcoes: OpcoesValidacao | undefined,
  prazo: Prazo,
  url: string,
  init: RequestInit,
  /** segredos que, se o provedor os ecoar no corpo, são trocados por *** antes de ler */
  segredos: readonly string[] = [],
): Promise<RespostaHttp> {
  const fazer = opcoes?.fetch ?? fetchPadrao;
  let resposta: Response;
  try {
    // redirect manual: um redirecionamento levaria os cabeçalhos com a credencial
    // (apikey, Client-Token) para outro endereço.
    resposta = await fazer(url, { ...init, redirect: "manual", signal: prazo.sinal });
  } catch {
    if (prazo.sinal.aborted) throw new TempoEsgotado();
    throw new FalhaDeRede();
  }
  let texto = "";
  try {
    texto = await resposta.text();
  } catch {
    if (prazo.sinal.aborted) throw new TempoEsgotado();
    texto = "";
  }
  return { status: resposta.status, corpo: lerJson(apagarSegredos(texto, segredos)) };
}

function segredosValidos(segredos: readonly string[]): string[] {
  return segredos.map((s) => s.trim()).filter((s) => s.length >= 4);
}

/** Troca cada ocorrência de um segredo por ***. */
export function apagarSegredos(texto: string, segredos: readonly string[]): string {
  let limpo = texto;
  for (const s of segredosValidos(segredos)) limpo = limpo.split(s).join("***");
  return limpo;
}

function lerJson(texto: string): unknown {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return texto;
  }
}

/** Lê um caminho dentro de um JSON desconhecido, sem lançar erro. */
export function ler(valor: unknown, ...caminho: string[]): unknown {
  let atual: unknown = valor;
  for (const chave of caminho) {
    if (atual === null || typeof atual !== "object") return undefined;
    atual = (atual as Record<string, unknown>)[chave];
  }
  return atual;
}

export function lerTexto(valor: unknown, ...caminho: string[]): string | undefined {
  const v = ler(valor, ...caminho);
  return typeof v === "string" ? v : undefined;
}

export function lerNumero(valor: unknown, ...caminho: string[]): number | undefined {
  const v = ler(valor, ...caminho);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** O corpo inteiro como texto, só para procurar palavras (nunca para mostrar). */
export function corpoComoTexto(corpo: unknown): string {
  if (corpo === null || corpo === undefined) return "";
  if (typeof corpo === "string") return corpo;
  try {
    return JSON.stringify(corpo);
  } catch {
    return "";
  }
}

export function ultimos4(segredo: string): string {
  return segredo.trim().slice(-4);
}

/** Encurta um texto para mostrar na tela (igual ao `curto` do F). */
export function curto(texto: string, n: number): string {
  const s = texto.trim().replace(/\s+/g, " ");
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/**
 * Última barreira: troca qualquer ocorrência de um segredo por *** em todos os textos do
 * resultado. As mensagens já são fixas; isto cobre um rótulo vindo do provedor.
 */
export function blindar<T extends Record<string, unknown>>(resultado: T, segredos: readonly string[]): T {
  if (segredosValidos(segredos).length === 0) return resultado;
  const limpo: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(resultado)) {
    if (typeof valor === "string" && chave !== "ultimos4") {
      limpo[chave] = apagarSegredos(valor, segredos);
    } else {
      limpo[chave] = valor;
    }
  }
  return limpo as T;
}
