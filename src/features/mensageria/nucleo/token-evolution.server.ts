// O token próprio de uma instância da Evolution que o app cria (spec-qr-whatsapp, seção 7).
// HMAC-SHA256 da base do servidor e do nome da instância, com uma chave derivada por HKDF do
// segredo estável da instalação (salt e info próprios, separados da cifra). O mesmo token se refaz a
// qualquer hora: nada é gravado antes de o celular conectar, e o salvar guarda este token no
// lugar da chave global. Os erros nunca citam a variável: só "cifra_indisponivel".

import { segredoDaInstalacao } from "./segredo-instalacao.server";

const SALT = "janete-evolution";
const INFO = "token-instancia-v1";

const codificador = new TextEncoder();

// Cache por isolate, como a chave mestra da cifra.
let cache: { ikm: string; chave: Promise<CryptoKey> } | null = null;

function bytes(texto: string): Uint8Array<ArrayBuffer> {
  return codificador.encode(texto) as Uint8Array<ArrayBuffer>;
}

async function derivar(ikm: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bytes(ikm), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bytes(SALT), info: bytes(INFO) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

async function chave(): Promise<CryptoKey> {
  const ikm = await segredoDaInstalacao();
  if (cache && cache.ikm === ikm) return cache.chave;
  const nova = derivar(ikm);
  cache = { ikm, chave: nova };
  // se a derivação falhar, a próxima chamada tenta de novo
  nova.catch(() => {
    if (cache?.chave === nova) cache = null;
  });
  return nova;
}

function paraBase64Url(dados: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < dados.length; i += 1) binario += String.fromCharCode(dados[i] ?? 0);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** O token da instância `nome` no servidor `base` (base sem barra no fim, como baseEvolution). */
export async function tokenDaInstanciaEvolution(base: string, nome: string): Promise<string> {
  const assinatura = await crypto.subtle.sign("HMAC", await chave(), bytes(`${base}\n${nome}`));
  return paraBase64Url(new Uint8Array(assinatura));
}
