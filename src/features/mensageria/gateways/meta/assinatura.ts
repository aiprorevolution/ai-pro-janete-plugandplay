// Conferência de origem da Meta: HMAC-SHA256 do corpo cru e token de verificação, sempre em tempo
// constante. Nada aqui lança erro nem devolve o segredo.

const codificador = new TextEncoder();

/** Compara dois vetores sem parar no primeiro byte diferente. */
export function iguaisEmTempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.max(a.length, b.length);
  let dif = a.length ^ b.length;
  for (let i = 0; i < n; i++) dif |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return dif === 0;
}

export function textosIguais(a: string, b: string): boolean {
  return iguaisEmTempoConstante(codificador.encode(a), codificador.encode(b));
}

function hexParaBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Confere o cabeçalho X-Hub-Signature-256 ("sha256=<hex>") contra o corpo cru. */
export async function assinaturaConfere(
  cabecalho: string | null,
  corpoCru: string,
  appSecret: string | undefined,
): Promise<boolean> {
  if (!cabecalho || !appSecret) return false;
  const prefixo = "sha256=";
  if (!cabecalho.toLowerCase().startsWith(prefixo)) return false;
  const recebida = hexParaBytes(cabecalho.slice(prefixo.length).trim());
  if (!recebida) return false;
  try {
    const chave = await crypto.subtle.importKey(
      "raw",
      codificador.encode(appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const esperada = new Uint8Array(
      await crypto.subtle.sign("HMAC", chave, codificador.encode(corpoCru)),
    );
    return iguaisEmTempoConstante(esperada, recebida);
  } catch {
    return false;
  }
}

/** GET de verificação da Meta. null = não é uma verificação (sem hub.mode). */
export function verificacaoMeta(url: URL, verifyToken: string | undefined): Response | null {
  const modo = url.searchParams.get("hub.mode");
  if (modo === null) return null;
  const token = url.searchParams.get("hub.verify_token");
  const desafio = url.searchParams.get("hub.challenge");
  const ok =
    modo === "subscribe" &&
    !!verifyToken &&
    token !== null &&
    desafio !== null &&
    textosIguais(token, verifyToken);
  if (!ok)
    return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
  return new Response(desafio, { status: 200, headers: { "content-type": "text/plain" } });
}
