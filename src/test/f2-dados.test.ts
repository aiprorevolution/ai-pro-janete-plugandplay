import { describe, expect, it } from "vitest";

import { acharModelo, MODELOS, modeloRecomendado, modelosDo, precoTexto } from "@/features/ia/modelos";
import {
  CAMPOS_CONTEXTO,
  FALA_EDITAR,
  INTRO,
  PERGUNTA_FINAL,
  RESUMO_ABRE,
  respostasVazias,
  responderPergunta,
  ROTEIRO,
  TOTAL_PERGUNTAS,
} from "@/features/onboarding/roteiro";
import { PROVEDORES_IA } from "@/features/servidor/chave-ia";

describe("modelos.ts", () => {
  it("tem 3 modelos por provedor e exatamente 1 recomendado em cada", () => {
    for (const p of PROVEDORES_IA.filter(p => p !== "gemini")) {
      expect(modelosDo(p)).toHaveLength(3);
      expect(modelosDo(p).filter((m) => m.recomendado)).toHaveLength(1);
      expect(modeloRecomendado(p)?.provedor).toBe(p);
    }
  });

  it("Gemini carrega modelos da chave, sem catálogo fixo inventado", () => { expect(modelosDo("gemini")).toEqual([]); });

  it("ids únicos por provedor e preços positivos", () => {
    const chaves = MODELOS.map((m) => `${m.provedor}:${m.id}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const m of MODELOS) {
      expect(m.precoEntrada).toBeGreaterThan(0);
      expect(m.precoSaida).toBeGreaterThan(m.precoEntrada);
    }
  });

  it("preços batem com docs/pesquisa-motores-ia.md", () => {
    // [provedor, id, entrada, saída] em US$ por 1M de tokens
    const esperado: Array<[(typeof PROVEDORES_IA)[number], string, number, number]> = [
      ["anthropic", "claude-haiku-5-5", 0.1, 0.5],
      ["anthropic", "claude-sonnet-5-5", 2, 10],
      ["anthropic", "claude-opus-5-5", 4, 20],
      ["openai", "gpt-6-luna", 0.1, 0.5],
      ["openai", "gpt-6.1-terra", 1, 5],
      ["openai", "gpt-6.1-sol", 2, 10],
      ["openrouter", "anthropic/claude-haiku-5.5", 0.1, 0.5],
      ["openrouter", "openai/gpt-6-luna", 0.1, 0.5],
      ["openrouter", "google/gemini-3.8-flash", 0.75, 3.75],
    ];
    expect(MODELOS).toHaveLength(esperado.length);
    for (const [p, id, entrada, saida] of esperado) {
      const m = acharModelo(p, id);
      expect(m, `${p}:${id}`).toBeDefined();
      expect(m?.precoEntrada).toBe(entrada);
      expect(m?.precoSaida).toBe(saida);
    }
  });

  it("os recomendados são os do F", () => {
    expect(modeloRecomendado("anthropic")?.id).toBe("claude-haiku-5-5");
    expect(modeloRecomendado("openai")?.id).toBe("gpt-6-luna");
    expect(modeloRecomendado("openrouter")?.id).toBe("anthropic/claude-haiku-5.5");
  });

  it("formata o preço como no F", () => {
    expect(precoTexto(acharModelo("anthropic", "claude-haiku-5-5")!)).toBe("0,10 / 0,50");
    expect(precoTexto(acharModelo("anthropic", "claude-sonnet-5-5")!)).toBe("2 / 10");
    expect(precoTexto(acharModelo("openrouter", "google/gemini-3.8-flash")!)).toBe("0,75 / 3,75");
  });
});

describe("roteiro.ts", () => {
  it("tem as 8 perguntas, uma por campo do Contexto, na ordem da spec", () => {
    expect(TOTAL_PERGUNTAS).toBe(8);
    expect(ROTEIRO.map((p) => p.campo)).toEqual([
      "empresa_oferta",
      "cliente_ideal",
      "preco",
      "diferenciais",
      "objecoes",
      "quando_passar_humano",
      "tom_voz",
      "horario",
    ]);
    expect([...CAMPOS_CONTEXTO]).toEqual(ROTEIRO.map((p) => p.campo));
    expect(Object.keys(respostasVazias()).sort()).toEqual([...CAMPOS_CONTEXTO].sort());
  });

  it("cada pergunta tem texto, rótulo e reação fixa, sem resposta de exemplo", () => {
    for (const p of ROTEIRO) {
      expect(p.pergunta.trim().length).toBeGreaterThan(10);
      expect(p.rotulo.trim().length).toBeGreaterThan(2);
      expect("sugestoes" in p).toBe(false);
      const reacao = p.reagir("qualquer resposta");
      expect(reacao.trim().length).toBeGreaterThan(10);
      // reação fixa: não repete a resposta
      expect(reacao).not.toContain("qualquer resposta");
    }
  });

  it("a introdução cita o número certo de perguntas", () => {
    expect(INTRO).toHaveLength(2);
    expect(INTRO[1]).toContain("8 perguntas");
  });

  it("o horário muda a reação para quem atende sempre", () => {
    const horario = ROTEIRO.find((p) => p.campo === "horario")!;
    expect(horario.reagir("Todos os dias, a qualquer hora")).toBe("Perfeito. Vou estar sempre por aqui.");
    expect(horario.reagir("24h")).toBe("Perfeito. Vou estar sempre por aqui.");
    expect(horario.reagir("Segunda a sexta, das 8h às 18h")).toBe("Perfeito. Fora desse horário, eu aviso quando a equipe volta.");
  });

  it("8 respostas preenchem os 8 campos e terminam no resumo", () => {
    let respostas = respostasVazias();
    for (let i = 0; i < TOTAL_PERGUNTAS; i += 1) {
      const r = responderPergunta(respostas, i, `  resposta ${i}  `);
      respostas = r.respostas;
      const ultima = i === TOTAL_PERGUNTAS - 1;
      expect(r.terminou).toBe(ultima);
      expect(r.falas[0]).toBe(ROTEIRO[i]!.reagir(`resposta ${i}`));
      if (ultima) expect(r.falas.slice(1)).toEqual([RESUMO_ABRE, FALA_EDITAR, PERGUNTA_FINAL]);
      else expect(r.falas[1]).toBe(ROTEIRO[i + 1]!.pergunta);
    }
    CAMPOS_CONTEXTO.forEach((campo, i) => expect(respostas[campo]).toBe(`resposta ${i}`));
  });

  it("pergunta fora do roteiro lança erro", () => {
    expect(() => responderPergunta(respostasVazias(), 8, "x")).toThrow();
  });
});
