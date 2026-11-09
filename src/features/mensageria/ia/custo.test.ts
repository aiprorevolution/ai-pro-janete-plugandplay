import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/firebase/client.server", async () => ({
  firebaseAdmin: (await import("./__testes__/dubles")).firebaseFalso,
}));

const { custoDeFala, custoDeAudio } = await import("./custo.server");
type LinhaPreco = import("./custo.server").LinhaPreco;

function preco(p: Partial<LinhaPreco> & { id: string }): LinhaPreco {
  return {
    provedor: "elevenlabs",
    modelo: "eleven_multilingual_v2",
    vigente_desde: "2026-11-02",
    a_partir_de_tokens: 0,
    entrada: null,
    cache_leitura: null,
    cache_escrita: null,
    saida: null,
    audio_por_minuto: null,
    por_mil_caracteres: null,
    fonte: "https://elevenlabs.io/pricing/api",
    criado_em: "2026-11-02T00:00:00Z",
    ...p,
  } as LinhaPreco;
}

describe("custoDeFala", () => {
  it("sem linha vigente: sem_preco, sem preco_id", () => {
    expect(custoDeFala([], 100, "2026-11-02")).toEqual({
      custo_usd: null,
      custo_origem: "sem_preco",
      preco_id: null,
    });
    // a linha só vale a partir de amanhã
    expect(
      custoDeFala([preco({ id: "p1", por_mil_caracteres: 0.08 })], 100, "2026-11-01"),
    ).toEqual({ custo_usd: null, custo_origem: "sem_preco", preco_id: null });
  });

  it("linha com por_mil_caracteres nulo: sem_preco com o preco_id", () => {
    expect(custoDeFala([preco({ id: "p1" })], 100, "2026-11-02")).toEqual({
      custo_usd: null,
      custo_origem: "sem_preco",
      preco_id: "p1",
    });
  });

  it("valor: por_mil_caracteres × caracteres / 1000, pela linha mais nova", () => {
    const precos = [
      preco({ id: "velho", vigente_desde: "2026-10-01", por_mil_caracteres: 0.3 }),
      preco({ id: "novo", por_mil_caracteres: 0.08 }),
    ];
    const c = custoDeFala(precos, 1000, "2026-11-03");
    expect(c.custo_origem).toBe("tabela");
    expect(c.preco_id).toBe("novo");
    expect(c.custo_usd).toBeCloseTo(0.08, 12);
    expect(custoDeFala(precos, 250, "2026-11-03").custo_usd).toBeCloseTo(0.02, 12);
    // o preço numeric pode vir como texto do banco
    const comoTexto = [preco({ id: "t", por_mil_caracteres: "0.08" as unknown as number })];
    expect(custoDeFala(comoTexto, 500, "2026-11-02").custo_usd).toBeCloseTo(0.04, 12);
  });
});

describe("custoDeAudio na ElevenLabs", () => {
  it("por minuto, sem o mínimo de 10 s da Groq", () => {
    const precos = [preco({ id: "scribe", modelo: "scribe_v2", audio_por_minuto: 0.22 / 60 })];
    const c = custoDeAudio("elevenlabs", precos, 3, "2026-11-02");
    expect(c.preco_id).toBe("scribe");
    expect(c.custo_usd).toBeCloseTo(((0.22 / 60) * 3) / 60, 12);
  });
});
