import { describe, expect, it } from "vitest";

import { PROVS } from "@/features/onboarding/lista/dados";
import {
  formatarNumero,
  mesmoNumero,
  normalizarNumero,
  numeroDoJid,
} from "@/features/servidor/numero-whatsapp";

// Q6: as regras puras do número do WhatsApp (spec-qr-whatsapp, seção 8): normalizar, comparar,
// formatar e ler o jid. E o campo do número, o 1º da Z-API e da Evolution.

describe("normalizarNumero", () => {
  it("sem +: 10 ou 11 dígitos ganham o 55", () => {
    expect(normalizarNumero("11 98765-4321")).toBe("5511987654321");
    expect(normalizarNumero("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizarNumero("11987654321")).toBe("5511987654321");
    expect(normalizarNumero("11 8765-4321")).toBe("551187654321");
    expect(normalizarNumero("21.3456.7890")).toBe("552134567890");
  });

  it("sem +: 12 ou 13 dígitos começando com 55 ficam como estão", () => {
    expect(normalizarNumero("5511987654321")).toBe("5511987654321");
    expect(normalizarNumero("55 11 98765-4321")).toBe("5511987654321");
    expect(normalizarNumero("551187654321")).toBe("551187654321");
  });

  it("sem +: os zeros da frente saem (o 0 do DDD e o 00 internacional)", () => {
    expect(normalizarNumero("011 98765-4321")).toBe("5511987654321");
    expect(normalizarNumero("0055 11 98765-4321")).toBe("5511987654321");
    expect(normalizarNumero("0 11 8765-4321")).toBe("551187654321");
  });

  it("com +: DDI de qualquer país, de 8 a 15 dígitos", () => {
    expect(normalizarNumero("+55 11 98765-4321")).toBe("5511987654321");
    expect(normalizarNumero("+1 (415) 555-2671")).toBe("14155552671");
    expect(normalizarNumero("+351 912 345 678")).toBe("351912345678");
    expect(normalizarNumero("+44 7911 123456")).toBe("447911123456");
    expect(normalizarNumero("+12345678")).toBe("12345678");
    expect(normalizarNumero("+123456789012345")).toBe("123456789012345");
  });

  it("com +55, vale a regra do Brasil", () => {
    expect(normalizarNumero("+55 11 8765-4321")).toBe("551187654321");
    expect(normalizarNumero("+55 11 88765-4321")).toBeNull(); // 9 dígitos sem o 9 na frente
    expect(normalizarNumero("+55 01 98765-4321")).toBeNull(); // DDD com 0
    expect(normalizarNumero("+55 11 987")).toBeNull();
  });

  it("inválidos viram null", () => {
    for (const ruim of [
      "",
      "   ",
      "abc",
      "11 98765-432a",
      "98765-4321", // sem DDD
      "123",
      "+1234567", // 7 dígitos
      "+1234567890123456", // 16 dígitos
      "1234567890123", // 13 sem o 55
      "441234567890", // 12 sem o 55 e sem +
      "11 18765-4321", // número começando com 1
      "11 08765-4321", // número começando com 0
      "11 88765-4321", // 9 dígitos sem o 9 na frente
      "10 98765-4321", // DDD com 0 no fim
      "++55 11 98765-4321",
      "55+11987654321",
      "11 98765-4321 ramal 2",
    ]) {
      expect(normalizarNumero(ruim)).toBeNull();
    }
  });

  it("os zeros da frente saem antes de contar os dígitos (a regra literal da spec)", () => {
    // "01 98765-4321" → "1987654321" (10 dígitos) → DDD 19 e um fixo de 8 dígitos
    expect(normalizarNumero("01 98765-4321")).toBe("551987654321");
  });

  it("o número copiado do WhatsApp: marcas de direção, BOM e traços Unicode não atrapalham", () => {
    // as marcas de direção que o WhatsApp no Android põe em volta do número copiado
    expect(normalizarNumero("\u202a+55 11 98765-4321\u202c")).toBe("5511987654321");
    expect(normalizarNumero("\u200e+55 11 98765-4321\u200f")).toBe("5511987654321");
    expect(normalizarNumero("\u2066+44 7911 123456\u2069")).toBe("447911123456");
    expect(normalizarNumero("\ufeff11 98765-4321")).toBe("5511987654321");
    // hífen que não quebra, travessão e sinal de menos
    expect(normalizarNumero("+55 11 98765\u20114321")).toBe("5511987654321");
    expect(normalizarNumero("11 98765\u20134321")).toBe("5511987654321");
    expect(normalizarNumero("11 98765\u22124321")).toBe("5511987654321");
    // o resto continua inválido
    expect(normalizarNumero("\u202a\u202c")).toBeNull();
    expect(normalizarNumero("\u202a11 98765-432a\u202c")).toBeNull();
  });
});

describe("mesmoNumero", () => {
  it("iguais", () => {
    expect(mesmoNumero("5511987654321", "5511987654321")).toBe(true);
    expect(mesmoNumero("14155552671", "14155552671")).toBe(true);
  });

  it("Brasil: com ou sem o 9 a mais, no mesmo DDD", () => {
    expect(mesmoNumero("5511987654321", "551187654321")).toBe(true);
    expect(mesmoNumero("551187654321", "5511987654321")).toBe(true);
  });

  it("Brasil: outro DDD ou outros 8 dígitos não é o mesmo", () => {
    expect(mesmoNumero("5511987654321", "5521987654321")).toBe(false);
    expect(mesmoNumero("5511987654321", "552187654321")).toBe(false);
    expect(mesmoNumero("5511987654321", "5511987654322")).toBe(false);
  });

  it("fora do Brasil, só iguais; vazio nunca é o mesmo", () => {
    expect(mesmoNumero("14155552671", "4155552671")).toBe(false);
    expect(mesmoNumero("351912345678", "5511912345678")).toBe(false);
    expect(mesmoNumero("", "")).toBe(false);
    expect(mesmoNumero("5511987654321", "")).toBe(false);
  });
});

describe("formatarNumero", () => {
  it("Brasil com 9 e com 8 dígitos", () => {
    expect(formatarNumero("5511987654321")).toBe("+55 11 98765-4321");
    expect(formatarNumero("551187654321")).toBe("+55 11 8765-4321");
    expect(formatarNumero("552134567890")).toBe("+55 21 3456-7890");
  });

  it("fora do Brasil: + e os dígitos", () => {
    expect(formatarNumero("14155552671")).toBe("+14155552671");
    expect(formatarNumero("351912345678")).toBe("+351912345678");
  });

  it("volta ao mesmo número pelo normalizar", () => {
    for (const d of ["5511987654321", "551187654321", "14155552671"]) {
      expect(normalizarNumero(formatarNumero(d))).toBe(d);
    }
  });
});

describe("numeroDoJid", () => {
  it("o jid de pessoa vira os dígitos, com ou sem o aparelho (:12)", () => {
    expect(numeroDoJid("5511987654321@s.whatsapp.net")).toBe("5511987654321");
    expect(numeroDoJid("5511987654321:12@s.whatsapp.net")).toBe("5511987654321");
    expect(numeroDoJid("551187654321:3@s.whatsapp.net")).toBe("551187654321");
  });

  it("@lid, grupo e o resto viram null", () => {
    for (const ruim of [
      "123456789012345@lid",
      "120363025246125486@g.us",
      "5511987654321",
      "5511987654321@c.us",
      "status@broadcast",
      "abc@s.whatsapp.net",
      "",
      "5511987654321@s.whatsapp.net.evil",
    ]) {
      expect(numeroDoJid(ruim)).toBeNull();
    }
  });
});

describe("o campo do número no formulário", () => {
  it("é o 1º da Z-API e da Evolution, obrigatório e de telefone, com o texto da spec", () => {
    const esperado = {
      id: "numero",
      label: "Número do WhatsApp",
      ph: "11 98765-4321",
      ajuda: "O do celular que vai ler o QR code, com DDD. De outro país, comece com + e o código.",
      tel: true,
    };
    for (const g of ["zapi", "evolution"] as const) {
      expect(PROVS[g].campos[0]).toEqual(esperado);
      expect(PROVS[g].campos[0]!.opcional).toBeUndefined();
    }
  });

  it("a Meta e a Zernio não pedem o número", () => {
    for (const g of ["meta", "zernio"] as const) {
      expect(PROVS[g].campos.some((c) => c.id === "numero")).toBe(false);
    }
  });
});
