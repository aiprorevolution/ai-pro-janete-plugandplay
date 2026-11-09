// Cifra dos segredos guardados no banco (ia_chaves.chave_cifrada e conexoes.segredos).
// AES-256-GCM pela Web Crypto no Node. A chave mestra deriva do segredo estável da instalação,
// gerado uma vez no servidor e conservado entre logins e publicações.
// Formato gravado: "v1:<iv base64>:<cifra+tag base64>",
// em base64 padrão, que casa com o regex que o banco confere.
//
// Os erros nunca citam o texto, o dado associado nem a chave: só os códigos
// "cifra_indisponivel" (falta a variável) e "cifra_invalida" (não abriu).

import { segredoDaInstalacao } from "./segredo-instalacao.server";

const VERSAO = "v1";
const SALT = "janete-segredos";
const INFO = "v1";
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
const FORMATO = /^v([0-9]+):([A-Za-z0-9+/]+={0,2}):([A-Za-z0-9+/]+={0,2})$/;

const codificador = new TextEncoder();

// Cache por isolate. Guarda o valor lido para refazer a chave se a variável mudar.
let cache: { ikm: string; chave: Promise<CryptoKey> } | null = null;

function bytes(texto: string): Uint8Array<ArrayBuffer> {
  return codificador.encode(texto) as Uint8Array<ArrayBuffer>;
}

async function derivar(ikm: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bytes(ikm), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bytes(SALT), info: bytes(INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function chaveMestra(): Promise<CryptoKey> {
  const ikm = await segredoDaInstalacao();
  if (cache && cache.ikm === ikm) return cache.chave;
  const chave = derivar(ikm);
  cache = { ikm, chave };
  // se a derivação falhar, a próxima chamada tenta de novo
  chave.catch(() => {
    if (cache?.chave === chave) cache = null;
  });
  return chave;
}

function paraBase64(dados: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < dados.length; i += 1) binario += String.fromCharCode(dados[i] ?? 0);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const binario = atob(texto);
  const dados = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) dados[i] = binario.charCodeAt(i);
  return dados;
}

/** Cifra um texto preso ao dado associado (aad). Cada chamada usa um IV novo. */
export async function cifrar(texto: string, aad: string): Promise<string> {
  const chave = await chaveMestra();
  const iv = crypto.getRandomValues(new Uint8Array(TAMANHO_IV));
  let cifrado: ArrayBuffer;
  try {
    cifrado = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: bytes(aad), tagLength: TAMANHO_TAG * 8 },
      chave,
      bytes(texto),
    );
  } catch {
    throw new Error("cifra_indisponivel");
  }
  return `${VERSAO}:${paraBase64(iv)}:${paraBase64(new Uint8Array(cifrado))}`;
}

/** Abre um texto gravado por cifrar. Qualquer falha vira Error("cifra_invalida"). */
export async function decifrar(cifrado: string, aad: string): Promise<string> {
  const chave = await chaveMestra();
  const partes = FORMATO.exec(typeof cifrado === "string" ? cifrado : "");
  if (!partes || `v${partes[1]}` !== VERSAO) throw new Error("cifra_invalida");
  let iv: Uint8Array<ArrayBuffer>;
  let dados: Uint8Array<ArrayBuffer>;
  try {
    iv = deBase64(partes[2] ?? "");
    dados = deBase64(partes[3] ?? "");
  } catch {
    throw new Error("cifra_invalida");
  }
  if (iv.length !== TAMANHO_IV || dados.length < TAMANHO_TAG) throw new Error("cifra_invalida");
  try {
    const aberto = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: bytes(aad), tagLength: TAMANHO_TAG * 8 },
      chave,
      dados,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(aberto);
  } catch {
    throw new Error("cifra_invalida");
  }
}

/** Dado associado de um segredo de conexão: conexoes:<id>:<nome do segredo>. */
export function aadConexao(id: string, nome: string): string {
  return `conexoes:${id}:${nome}`;
}

/** Dado associado da chave de IA: ia_chaves:<id>:chave_cifrada. */
export function aadChave(id: string): string {
  return `ia_chaves:${id}:chave_cifrada`;
}

/** Segredo que nós geramos: 32 bytes aleatórios em base64url, sem "=". */
export function gerarSegredo(): string {
  const dados = crypto.getRandomValues(new Uint8Array(32));
  return paraBase64(dados).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
