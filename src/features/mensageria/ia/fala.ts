// A Janete responde em áudio (docs/spec-voz-uso.md, contrato F3): as constantes da fala e da escuta
// pela ElevenLabs, o bloco das instruções no modo fala, a decisão de falar, as bolhas de texto
// quando a fala falha e a duração do OGG/Opus gerado. Puro: não toca no banco, na rede nem na
// chave; o falar.server.ts e o responder.server.ts usam daqui.

import type { ModoVoz } from "@/features/servidor/vozes-tipos";

/** Modelo da fala, fixo (D4). */
export const MODELO_FALA = "eleven_multilingual_v2";
/** Modelo da escuta pela ElevenLabs, quando não há outra chave que transcreva (D5). */
export const MODELO_ESCUTA_ELEVENLABS = "scribe_v2";
/** OGG/Opus a 48 kHz e 32 kbps: cerca de 4 KB por segundo (P2). */
export const FORMATO_FALA = "opus_48000_32";
export const MIME_FALA = "audio/ogg";
/** Cerca de 70 s e 280 KB: abaixo dos 512 KB em que a Meta ainda mostra o play da nota de voz. */
export const MAX_CARACTERES_FALA = 1_000;
/** Bolhas de texto que vão depois do áudio (link, e-mail, chave PIX). */
export const MAX_TEXTOS_FALA = 2;
/** Tempo que a IA cede no modo fala, para a fala caber no prazo do worker (P4). */
export const RESERVA_FALA_MS = 6_000;
/** Teto do pedido da fala, cortado pelo prazo. */
export const TETO_FALA_MS = 15_000;
/** Abaixo disto a fala nem é pedida: a resposta vai em texto. */
export const MIN_TEMPO_FALA_MS = 4_000;

/** O mesmo MAX_BOLHAS das instruções (não importa de lá: as instruções importam o BLOCO_FALA). */
const MAX_BOLHAS_PADRAO = 3;

/**
 * Vai por último nas instruções (P3). Não preserva o cache entre os modos texto e fala: as
 * instruções são um bloco só e a ferramenta "responder" também muda; ver instrucoes.ts.
 */
export const BLOCO_FALA = `# Esta resposta vai em áudio
O lead vai ouvir a sua resposta como um áudio com a sua voz. Nesta rodada, a ferramenta \
"responder" recebe "fala" e "textos", e não "bolhas". Em "fala", escreva o que você vai dizer, \
como quem fala ao telefone: frases curtas e naturais, sem emoji, sem lista, sem markdown e sem \
abreviações, em até uns 40 segundos. Link, e-mail e chave PIX não se falam: mande em "textos", \
uma bolha para cada, só com o que o lead precisa ler ou copiar.`;

/**
 * Se esta rodada responde em áudio: nunca com o modo "nunca", sem voz escolhida ou sem a chave
 * da voz em uso; sempre com o modo "sempre"; com "quando_audio", só se o lead mandou áudio
 * entre as entradas da rodada.
 */
export function deveFalar(p: {
  modo: ModoVoz;
  vozId: string | null;
  chaveEmUso: boolean;
  entradas: readonly { tipo: string }[];
}): boolean {
  if (p.modo === "nunca" || !p.vozId || !p.chaveEmUso) return false;
  if (p.modo === "sempre") return true;
  return p.entradas.some((e) => e.tipo === "audio");
}

function partesDe(texto: string): string[] {
  return texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/**
 * Bolhas de texto quando a fala não sai (D6): a fala partida por linha em branco, seguida dos
 * textos. Os textos ficam sempre inteiros; a fala ocupa as bolhas que sobram (no mínimo 1) e o
 * excesso vai junto na última bolha da fala. Item vazio sai.
 */
export function bolhasSemFala(
  fala: string,
  textos: readonly string[],
  maxBolhas: number = MAX_BOLHAS_PADRAO,
): string[] {
  const extras = textos.map((t) => t.trim()).filter((t) => t !== "");
  const partes = partesDe(fala);
  const espaco = Math.max(1, maxBolhas - extras.length);
  const daFala =
    partes.length <= espaco
      ? partes
      : [...partes.slice(0, espaco - 1), partes.slice(espaco - 1).join("\n\n")];
  return [...daFala, ...extras];
}

/** Caracteres cobrados da fala: pontos de código (um emoji conta 1, não 2). */
export function caracteresDe(texto: string): number {
  return [...texto].length;
}

/** Inteiro sem sinal de 16 ou 32 bits, little-endian. */
function u16(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function u32(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

function comeca(b: Uint8Array, i: number, assinatura: string): boolean {
  if (i + assinatura.length > b.length) return false;
  for (let k = 0; k < assinatura.length; k++) {
    if (b[i + k] !== assinatura.charCodeAt(k)) return false;
  }
  return true;
}

const CABECALHO_PAGINA = 27;
const TAMANHO_OPUS_HEAD = 19;
const AMOSTRAS_POR_SEGUNDO = 48_000;

/**
 * Duração em segundos (arredondada) de um OGG/Opus (RFC 3533 e RFC 7845): a granule da última
 * página que termina um pacote, menos o pre-skip do OpusHead, a 48 kHz. Dá null para o que não
 * é OGG/Opus, para bytes cortados no meio de uma página e para granule negativa. Nunca lança.
 */
export function duracaoOgg(bytes: Uint8Array): number | null {
  try {
    let pos = 0;
    let serial: number | null = null;
    let preSkip: number | null = null;
    let granule: number | null = null;
    while (pos < bytes.length) {
      if (pos + CABECALHO_PAGINA > bytes.length || !comeca(bytes, pos, "OggS")) return null;
      if (bytes[pos + 4] !== 0) return null; // versão do formato
      const segmentos = bytes[pos + 26]!;
      const inicioDados = pos + CABECALHO_PAGINA + segmentos;
      if (inicioDados > bytes.length) return null;
      let tamanho = 0;
      for (let k = 0; k < segmentos; k++) tamanho += bytes[pos + CABECALHO_PAGINA + k]!;
      if (inicioDados + tamanho > bytes.length) return null;

      const serialPagina = u32(bytes, pos + 14);
      if (serial === null) {
        // a 1ª página traz só o OpusHead
        serial = serialPagina;
        if (tamanho < TAMANHO_OPUS_HEAD || !comeca(bytes, inicioDados, "OpusHead")) return null;
        preSkip = u16(bytes, inicioDados + 10);
      }
      if (serialPagina === serial) {
        const baixo = u32(bytes, pos + 6);
        const alto = u32(bytes, pos + 10);
        // granule -1 (todos os bits 1): nenhum pacote termina nesta página
        if (!(baixo === 0xffffffff && alto === 0xffffffff)) {
          if (alto & 0x80000000) return null;
          granule = alto * 2 ** 32 + baixo;
        }
      }
      pos = inicioDados + tamanho;
    }
    if (preSkip === null || granule === null || granule < preSkip) return null;
    return Math.round((granule - preSkip) / AMOSTRAS_POR_SEGUNDO);
  } catch {
    return null;
  }
}
