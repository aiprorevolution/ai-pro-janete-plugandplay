import { describe, expect, it } from "vitest";

import {
  BLOCO_FALA,
  bolhasSemFala,
  caracteresDe,
  deveFalar,
  duracaoOgg,
  FORMATO_FALA,
  MAX_CARACTERES_FALA,
  MIME_FALA,
  MODELO_ESCUTA_ELEVENLABS,
  MODELO_FALA,
} from "./fala";
import { MAX_BOLHAS } from "./instrucoes";

const AUDIO = [{ tipo: "texto" }, { tipo: "audio" }];
const SO_TEXTO = [{ tipo: "texto" }, { tipo: "imagem" }];

describe("deveFalar", () => {
  const base = { vozId: "voz123", chaveEmUso: true };

  it("com 'quando_audio', fala só se alguma entrada é áudio", () => {
    expect(deveFalar({ ...base, modo: "quando_audio", entradas: AUDIO })).toBe(true);
    expect(deveFalar({ ...base, modo: "quando_audio", entradas: SO_TEXTO })).toBe(false);
    expect(deveFalar({ ...base, modo: "quando_audio", entradas: [] })).toBe(false);
  });

  it("com 'sempre', fala mesmo sem áudio nas entradas", () => {
    expect(deveFalar({ ...base, modo: "sempre", entradas: SO_TEXTO })).toBe(true);
    expect(deveFalar({ ...base, modo: "sempre", entradas: AUDIO })).toBe(true);
    expect(deveFalar({ ...base, modo: "sempre", entradas: [] })).toBe(true);
  });

  it("com 'nunca', não fala nem com áudio", () => {
    expect(deveFalar({ ...base, modo: "nunca", entradas: AUDIO })).toBe(false);
    expect(deveFalar({ ...base, modo: "nunca", entradas: SO_TEXTO })).toBe(false);
  });

  it("sem voz escolhida ou sem a chave em uso, não fala em nenhum modo", () => {
    for (const modo of ["quando_audio", "sempre", "nunca"] as const) {
      expect(deveFalar({ modo, vozId: null, chaveEmUso: true, entradas: AUDIO })).toBe(false);
      expect(deveFalar({ modo, vozId: "", chaveEmUso: true, entradas: AUDIO })).toBe(false);
      expect(deveFalar({ modo, vozId: "voz123", chaveEmUso: false, entradas: AUDIO })).toBe(false);
      expect(deveFalar({ modo, vozId: null, chaveEmUso: false, entradas: AUDIO })).toBe(false);
    }
  });
});

describe("bolhasSemFala", () => {
  const FALA_LONGA =
    "Oi, tudo bem?\n\nAqui é a Janete.\n\nVou te mandar o link.\n\nE o e-mail também.";

  it("fala longa com 2 textos dá 3 bolhas, com os 2 textos inteiros no fim", () => {
    const textos = ["https://exemplo.com/proposta", "contato@exemplo.com"];
    const bolhas = bolhasSemFala(FALA_LONGA, textos);
    expect(bolhas).toHaveLength(3);
    expect(bolhas[0]).toBe(
      "Oi, tudo bem?\n\nAqui é a Janete.\n\nVou te mandar o link.\n\nE o e-mail também.",
    );
    expect(bolhas.slice(1)).toEqual(textos);
  });

  it("sem textos, parte a fala em até 3 bolhas e junta o excesso na última", () => {
    expect(bolhasSemFala(FALA_LONGA, [])).toEqual([
      "Oi, tudo bem?",
      "Aqui é a Janete.",
      "Vou te mandar o link.\n\nE o e-mail também.",
    ]);
    expect(bolhasSemFala("Uma.\n\nDuas.", [])).toEqual(["Uma.", "Duas."]);
    expect(bolhasSemFala("Só uma frase.", [])).toEqual(["Só uma frase."]);
  });

  it("com 1 texto, a fala fica com 2 bolhas", () => {
    expect(bolhasSemFala(FALA_LONGA, ["chave PIX: 123"])).toEqual([
      "Oi, tudo bem?",
      "Aqui é a Janete.\n\nVou te mandar o link.\n\nE o e-mail também.",
      "chave PIX: 123",
    ]);
  });

  it("os textos ficam inteiros mesmo quando passam do limite, e a fala fica com 1 bolha", () => {
    const textos = ["um\n\ndois", "três", "quatro"];
    expect(bolhasSemFala("A.\n\nB.", textos)).toEqual(["A.\n\nB.", ...textos]);
  });

  it("item vazio sai: fala em branco, textos em branco e partes vazias", () => {
    expect(bolhasSemFala("  \n\n ", ["  ", "https://x.com"])).toEqual(["https://x.com"]);
    expect(bolhasSemFala("Oi.\n\n\n\n  \n\nTchau.", ["", " link "])).toEqual([
      "Oi.",
      "Tchau.",
      "link",
    ]);
    expect(bolhasSemFala("", [])).toEqual([]);
  });

  it("o padrão é o MAX_BOLHAS das instruções, e aceita outro limite", () => {
    expect(bolhasSemFala("a\n\nb\n\nc\n\nd\n\ne", [])).toHaveLength(MAX_BOLHAS);
    expect(bolhasSemFala("a\n\nb\n\nc", [], 2)).toEqual(["a", "b\n\nc"]);
  });
});

describe("caracteresDe", () => {
  it("conta pontos de código: acento e emoji contam 1", () => {
    expect(caracteresDe("ação 😀")).toBe(6);
    expect("ação 😀".length).toBe(7);
    expect(caracteresDe("")).toBe(0);
  });
});

// ---------- OGG montado no teste (RFC 3533 e RFC 7845) ----------

function pagina(p: { granule: bigint; dados: Uint8Array; serial?: number; numero: number }) {
  const segmentos: number[] = [];
  let resta = p.dados.length;
  while (resta >= 255) {
    segmentos.push(255);
    resta -= 255;
  }
  segmentos.push(resta);
  const b = new Uint8Array(27 + segmentos.length + p.dados.length);
  const v = new DataView(b.buffer);
  b.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  b[4] = 0;
  b[5] = p.numero === 0 ? 0x02 : 0;
  v.setBigInt64(6, p.granule, true);
  v.setUint32(14, p.serial ?? 0x1234, true);
  v.setUint32(18, p.numero, true);
  v.setUint32(22, 0, true); // CRC não é conferido
  b[26] = segmentos.length;
  b.set(segmentos, 27);
  b.set(p.dados, 27 + segmentos.length);
  return b;
}

function opusHead(preSkip: number) {
  const b = new Uint8Array(19);
  const v = new DataView(b.buffer);
  b.set(new TextEncoder().encode("OpusHead"), 0);
  b[8] = 1; // versão
  b[9] = 1; // canais
  v.setUint16(10, preSkip, true);
  v.setUint32(12, 48_000, true);
  v.setInt16(16, 0, true);
  b[18] = 0;
  return b;
}

function juntar(...partes: Uint8Array[]) {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const b = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    b.set(p, i);
    i += p.length;
  }
  return b;
}

const PRE_SKIP = 312;
const CABECA = pagina({ granule: 0n, dados: opusHead(PRE_SKIP), numero: 0 });
const SETE_SEGUNDOS = pagina({
  granule: BigInt(48_000 * 7 + PRE_SKIP),
  dados: new Uint8Array(300).fill(7),
  numero: 1,
});

describe("duracaoOgg", () => {
  it("2 páginas, pre-skip 312 e granule 48000×7 + 312 dão 7 segundos", () => {
    expect(duracaoOgg(juntar(CABECA, SETE_SEGUNDOS))).toBe(7);
  });

  it("usa a última página com granule válida (pula a de granule -1)", () => {
    const semFim = pagina({ granule: -1n, dados: new Uint8Array(40), numero: 2 });
    expect(duracaoOgg(juntar(CABECA, SETE_SEGUNDOS, semFim))).toBe(7);
  });

  it("arredonda os segundos", () => {
    const quase = pagina({
      granule: BigInt(48_000 * 3 + 30_000 + PRE_SKIP),
      dados: new Uint8Array(10),
      numero: 1,
    });
    expect(duracaoOgg(juntar(CABECA, quase))).toBe(4);
  });

  it("aceita Uint8Array que é um pedaço de outro buffer", () => {
    const inteiro = juntar(new Uint8Array(5), CABECA, SETE_SEGUNDOS);
    expect(duracaoOgg(inteiro.subarray(5))).toBe(7);
  });

  it("dá null para o vazio, o lixo e o arquivo cortado", () => {
    expect(duracaoOgg(new Uint8Array(0))).toBeNull();
    const lixo = new TextEncoder().encode("isto não é um áudio, é texto qualquer");
    expect(duracaoOgg(lixo)).toBeNull();
    expect(duracaoOgg(new Uint8Array(64).fill(0xff))).toBeNull();
    const inteiro = juntar(CABECA, SETE_SEGUNDOS);
    expect(duracaoOgg(inteiro.subarray(0, inteiro.length - 10))).toBeNull();
    expect(duracaoOgg(inteiro.subarray(0, CABECA.length + 20))).toBeNull();
    expect(duracaoOgg(inteiro.subarray(0, 4))).toBeNull();
  });

  it("dá null para OGG que não é Opus e para granule negativa", () => {
    const vorbis = pagina({
      granule: 0n,
      dados: new TextEncoder().encode("\x01vorbis" + "x".repeat(23)),
      numero: 0,
    });
    expect(duracaoOgg(juntar(vorbis, SETE_SEGUNDOS))).toBeNull();
    const negativa = pagina({ granule: -5n, dados: new Uint8Array(10), numero: 1 });
    expect(duracaoOgg(juntar(CABECA, negativa))).toBeNull();
    // só a cabeça: nenhuma amostra depois do pre-skip
    expect(duracaoOgg(CABECA)).toBeNull();
  });

  it("nunca lança, nem com entrada que não é Uint8Array", () => {
    expect(() => duracaoOgg(null as unknown as Uint8Array)).not.toThrow();
    expect(duracaoOgg(null as unknown as Uint8Array)).toBeNull();
  });
});

describe("constantes e bloco da fala", () => {
  it("modelo, formato e mime fixos da spec", () => {
    expect(MODELO_FALA).toBe("eleven_multilingual_v2");
    expect(MODELO_ESCUTA_ELEVENLABS).toBe("scribe_v2");
    expect(FORMATO_FALA).toBe("opus_48000_32");
    expect(MIME_FALA).toBe("audio/ogg");
    expect(MAX_CARACTERES_FALA).toBe(1000);
  });

  it("o bloco é o texto inteiro da spec (seção 2, F3)", () => {
    // qualquer palavra mudada aparece aqui
    expect(BLOCO_FALA).toBe(
      "# Esta resposta vai em áudio\n" +
        "O lead vai ouvir a sua resposta como um áudio com a sua voz. Nesta rodada, a ferramenta " +
        '"responder" recebe "fala" e "textos", e não "bolhas". Em "fala", escreva o que você vai ' +
        "dizer, como quem fala ao telefone: frases curtas e naturais, sem emoji, sem lista, sem " +
        "markdown e sem abreviações, em até uns 40 segundos. Link, e-mail e chave PIX não se " +
        'falam: mande em "textos", uma bolha para cada, só com o que o lead precisa ler ou copiar.',
    );
  });
});
