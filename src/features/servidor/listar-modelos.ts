// Contrato da busca de modelos no provedor (rodada 2 do onboarding, docs/spec-ajustes-onboarding-r2.md).
// A lista da etapa cérebro deixa de ser só a curada (src/features/ia/modelos.ts): ela vem do provedor,
// na hora. A lista curada continua servindo para o preço (Anthropic e OpenAI não informam preço na
// lista), para o selo "Recomendado" e como reserva quando a OpenRouter estiver fora.

import type { ErroChaveIA, ProvedorIA } from "./chave-ia";

export type { ErroChaveIA, ProvedorIA };

export type ModeloListado = {
  /** id exato que vai no campo model do provedor */
  id: string;
  /** nome para a tela (display_name da Anthropic, name da OpenRouter; na OpenAI, o da lista curada ou o id) */
  nome: string;
  /** OpenRouter: o fabricante ("Anthropic", "Google"...) */
  fabricante?: string;
  /** "Rápido e barato", "Equilibrado", "Mais capaz", quando o modelo está na lista curada */
  perfil?: string;
  /** US$ por 1M de tokens; ausente quando o provedor não informa e o modelo não está na lista curada */
  precoEntrada?: number;
  precoSaida?: number;
  /** o recomendado da lista curada (casa pelo id exato ou pelo começo do id, por causa das datas) */
  recomendado: boolean;
};

export type EntradaListarModelos = {
  provedor: ProvedorIA;
  /** obrigatória na Anthropic e na OpenAI (a própria busca confere a chave); ignorada na OpenRouter */
  chave?: string;
  workspaceId?: string;
};

export type ResultadoListarModelos =
  | {
      ok: true;
      modelos: ModeloListado[];
      /** 'lista_curada' só na OpenRouter, quando o provedor está fora: a tela avisa e segue com a curada */
      origem: "provedor" | "lista_curada";
    }
  | { ok: false; erro: ErroChaveIA; mensagem: string };
