// Modelo de linguagem a partir da chave da Configuração (AI SDK v7). A chave vem do banco a
// cada rodada e nunca sai daqui: não vai para log, instruções nem erro.
// - Anthropic: cabeçalho anthropic-workspace-id quando a chave tem workspace.
// - OpenAI: Responses API com store: false (a conversa do lead não fica guardada na OpenAI;
//   o provedor pede sozinho o raciocínio cifrado nos modelos que raciocinam).
// - Anthropic: cache automático do prompt (cache_control no nível de cima, 5 min), para os
//   passos da rodada não pagarem de novo as instruções e o histórico.
// - OpenRouter: custo na resposta (providerMetadata.openrouter.usage.cost).
// Nada de temperature: os modelos novos da Anthropic recusam.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { JSONValue, LanguageModel } from "ai";

import type { ChaveIA } from "../nucleo/conexoes.server";

export type OpcoesProvedor = Record<string, Record<string, JSONValue>>;

export function criarModelo(chave: ChaveIA): LanguageModel {
  switch (chave.provedor) {
    case "anthropic": {
      const workspace = chave.workspace_id?.trim();
      const anthropic = createAnthropic({
        apiKey: chave.chave,
        ...(workspace ? { headers: { "anthropic-workspace-id": workspace } } : {}),
      });
      return anthropic(chave.modelo);
    }
    case "openai":
      return createOpenAI({ apiKey: chave.chave })(chave.modelo);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: chave.chave })(chave.modelo);
    case "openrouter":
      return createOpenRouter({ apiKey: chave.chave })(chave.modelo, { usage: { include: true } });
    default:
      // groq só transcreve (check do banco); outro valor = configuração inválida
      throw new Error("provedor_sem_resposta");
  }
}

export function opcoesDoProvedor(provedor: ChaveIA["provedor"]): OpcoesProvedor {
  if (provedor === "openai") return { openai: { store: false } };
  if (provedor === "anthropic") return { anthropic: { cacheControl: { type: "ephemeral" } } };
  return {};
}
