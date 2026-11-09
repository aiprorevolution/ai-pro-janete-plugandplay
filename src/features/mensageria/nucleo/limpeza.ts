// Limpeza do corpo do webhook antes de gravar em eventos_webhook (função pura, sem banco).
// ATENÇÃO, contrato com os adaptadores: o ciclo reprocessa os eventos pendentes a partir do
// payload GRAVADO, que é este corpo limpo. Por isso nenhum adaptador pode ler, em traduzir(),
// uma chave de CHAVES_SECRETAS nem depender de um texto que contenha um segredo da conexão
// (ele vira "[removido]"). O teste limpeza.test.ts confere, para cada gateway, que traduzir()
// dá o mesmo resultado com o corpo original e com o limpo.

/**
 * Chaves apagadas do corpo antes de gravar (sem diferenciar maiúscula). Na Evolution, o
 * envelope traz `apikey` (o token da instância, com AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES)
 * e `destination` (a nossa URL, com ?t=<tokenUrl>). Nenhum adaptador lê essas chaves.
 */
export const CHAVES_SECRETAS = new Set(
  [
    "apikey",
    "token",
    "instancetoken",
    "clienttoken",
    "secret",
    "destination",
    "authorization",
    "webhooksecret",
    "appsecret",
    "verifytoken",
    "tokenurl",
  ].map((c) => c.toLowerCase()),
);
export const REMOVIDO = "[removido]";
/** Segredo mais curto que isso não é procurado no texto (casaria com qualquer coisa). */
const MIN_SEGREDO = 8;

/**
 * O corpo que vai para eventos_webhook (fica 30 dias): sem as chaves de CHAVES_SECRETAS e com
 * todo valor de `segredos` (os da conexão, já decifrados) trocado por "[removido]" dentro de
 * qualquer texto, o que também pega o ?t= dentro de URLs. O id do evento e a tradução usam o
 * corpo original.
 */
export function limparPayload(corpo: unknown, segredos: readonly string[]): unknown {
  const alvos = Array.from(
    new Set(
      segredos
        .filter((v) => typeof v === "string" && v.length >= MIN_SEGREDO)
        .flatMap((v) => [v, encodeURIComponent(v)]),
    ),
  ).sort((a, b) => b.length - a.length);
  const limparTexto = (t: string) =>
    alvos.reduce((acc, alvo) => (acc.includes(alvo) ? acc.split(alvo).join(REMOVIDO) : acc), t);
  const passar = (v: unknown, fundo: number): unknown => {
    if (fundo > 64) return null;
    if (typeof v === "string") return limparTexto(v);
    if (Array.isArray(v)) return v.map((x) => passar(x, fundo + 1));
    if (v !== null && typeof v === "object") {
      const saida: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (CHAVES_SECRETAS.has(k.toLowerCase())) continue;
        saida[limparTexto(k)] = passar(x, fundo + 1);
      }
      return saida;
    }
    return v;
  };
  return passar(corpo, 0);
}
