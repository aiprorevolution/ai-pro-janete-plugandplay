// Lista curada de modelos da etapa cérebro (spec do onboarding: "Lista de modelos: é curada,
// com preços de docs/pesquisa-motores-ia.md, sem buscar no provedor").
// A seleção segue o F (F-Final.dc.html, MOTORES): 3 modelos por motor, o recomendado primeiro.
// Os ids são os da API de cada provedor, que a pesquisa conferiu. Atenção: o F usa
// "claude-haiku-5.5" na Anthropic direta, mas o id da API é "claude-haiku-5-5" (com hífen);
// o formato com ponto só vale na OpenRouter ("anthropic/claude-haiku-5.5").
//
// Preços em US$ por 1 milhão de tokens (entrada / saída), lidos em 28/10/2026.

import type { ProvedorIA } from "@/features/servidor/chave-ia";

export type { ProvedorIA };

export type ModeloIA = {
  provedor: ProvedorIA;
  /** id exato que vai no campo model do provedor */
  id: string;
  nome: string;
  /** "Rápido e barato", "Equilibrado", "Mais capaz" (na OpenRouter, o fabricante, como no F) */
  perfil: string;
  /** US$ por 1M de tokens de entrada */
  precoEntrada: number;
  /** US$ por 1M de tokens de saída */
  precoSaida: number;
  recomendado: boolean;
  /** detalhe de preço ou de uso que a tela pode mostrar */
  observacao?: string;
};

export const MODELOS: readonly ModeloIA[] = [
  // ---- Anthropic ----
  // Fonte: docs/pesquisa-motores-ia.md, seção 1 "Modelos sugeridos" (conferência: "os preços
  // (inclusive a faixa de 100K do Haiku 5.5 e os preços de cache) batem com a documentação
  // oficial"); https://platform.claude.com/docs/en/about-claude/pricing
  {
    provedor: "anthropic",
    id: "claude-haiku-5-5",
    nome: "Claude Haiku 5.5",
    perfil: "Rápido e barato",
    precoEntrada: 0.1,
    precoSaida: 0.5,
    recomendado: true,
    // Fonte: pesquisa, seção 1 (tabela) e conferência da seção 4 ("Preço por faixa")
    observacao: "Prompts acima de 100 mil tokens custam US$ 0,50 / 2,50.",
  },
  {
    provedor: "anthropic",
    id: "claude-sonnet-5-5",
    nome: "Claude Sonnet 5.5",
    perfil: "Equilibrado",
    precoEntrada: 2,
    precoSaida: 10,
    recomendado: false,
  },
  {
    provedor: "anthropic",
    id: "claude-opus-5-5",
    nome: "Claude Opus 5.5",
    perfil: "Mais capaz",
    precoEntrada: 4,
    precoSaida: 20,
    recomendado: false,
  },

  // ---- OpenAI ----
  // Fonte: docs/pesquisa-motores-ia.md, seção 2 "Modelos sugeridos" (conferência: "ids de
  // modelo, preços ... batem com a documentação oficial atual");
  // https://developers.openai.com/api/docs/pricing
  // Os preços valem para prompts de até 272 mil tokens (conferência da seção 4).
  {
    provedor: "openai",
    id: "gpt-6-luna",
    nome: "GPT-6 Luna",
    perfil: "Rápido e barato",
    precoEntrada: 0.1,
    precoSaida: 0.5,
    recomendado: true,
  },
  {
    provedor: "openai",
    id: "gpt-6.1-terra",
    nome: "GPT-6.1 Terra",
    perfil: "Equilibrado",
    precoEntrada: 1,
    precoSaida: 5,
    recomendado: false,
    // Corrigido pela conferência da seção 2: ferramentas só pela Responses API
    observacao: "Usa ferramentas só pela Responses API.",
  },
  {
    provedor: "openai",
    id: "gpt-6.1-sol",
    nome: "GPT-6.1 Sol",
    perfil: "Mais capaz",
    precoEntrada: 2,
    precoSaida: 10,
    recomendado: false,
    observacao: "Sempre raciocina antes de responder (cobrado como saída).",
  },

  // ---- OpenRouter ----
  // Fonte: docs/pesquisa-motores-ia.md, seção 3 "Modelos sugeridos" e a conferência ("Também
  // conferem os preços e contextos dos 4 modelos sugeridos: Haiku 5.5 a US$ 0,10/0,50 ...,
  // Gemini 3.8 Flash a US$ 0,75/3,75 com '50% off' ... e GPT-6 Luna a US$ 0,10/0,50");
  // https://openrouter.ai/anthropic/claude-haiku-5.5/providers ,
  // https://openrouter.ai/openai/gpt-6-luna/providers ,
  // https://openrouter.ai/google/gemini-3.8-flash/providers
  // A OpenRouter devolve o custo real em usage.cost; estes valores são só para a tela.
  {
    provedor: "openrouter",
    id: "anthropic/claude-haiku-5.5",
    nome: "anthropic/claude-haiku-5.5",
    perfil: "Anthropic",
    precoEntrada: 0.1,
    precoSaida: 0.5,
    recomendado: true,
  },
  {
    provedor: "openrouter",
    id: "openai/gpt-6-luna",
    nome: "openai/gpt-6-luna",
    perfil: "OpenAI",
    precoEntrada: 0.1,
    precoSaida: 0.5,
    recomendado: false,
  },
  {
    provedor: "openrouter",
    id: "google/gemini-3.8-flash",
    nome: "google/gemini-3.8-flash",
    perfil: "Google",
    precoEntrada: 0.75,
    precoSaida: 3.75,
    recomendado: false,
    // Fonte: pesquisa, seção 3 ("com selo '50% off'"; "O desconto de 50% pode ser temporário")
    observacao: "Preço com desconto de 50% da OpenRouter, que pode ser temporário.",
  },
];

export function modelosDo(provedor: ProvedorIA): ModeloIA[] {
  return MODELOS.filter((m) => m.provedor === provedor);
}

export function modeloRecomendado(provedor: ProvedorIA): ModeloIA | undefined {
  return MODELOS.find((m) => m.provedor === provedor && m.recomendado);
}

export function acharModelo(provedor: ProvedorIA, id: string): ModeloIA | undefined {
  return MODELOS.find((m) => m.provedor === provedor && m.id === id);
}

function numeroBr(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace(".", ",");
}

/** Preço no formato do F: "0,10 / 0,50" ou "2 / 10" (US$ por 1M de tokens). */
export function precoTexto(m: ModeloIA): string {
  return `${numeroBr(m.precoEntrada)} / ${numeroBr(m.precoSaida)}`;
}
