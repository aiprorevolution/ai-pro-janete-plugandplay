// Ferramentas da Janete numa rodada. As que gravam chamam as funções janete_* do banco, que
// conferem que a rodada ainda está rodando. Erro do banco vira resultado { erro: "<código>" }
// para o modelo, nunca exceção: a rodada segue. A trava da decisão 3 (etapa_travada) volta como
// recusa com orientação, e as chamadas seguintes de mover_etapa na rodada nem vão ao banco.
// No modo fala (docs/spec-voz-uso.md, P3), "responder" recebe { fala, textos? } em vez de
// { bolhas }: a fala vira o áudio e os textos (link, e-mail, chave PIX) vão em texto depois.
import { tool } from "ai";
import { z } from "zod";

import { firebaseAdmin } from "@/integrations/firebase/client.server";
import type { Json } from "@/integrations/firebase/types";

import { MAX_CARACTERES_FALA, MAX_TEXTOS_FALA } from "./fala";
import { MAX_BOLHAS } from "./instrucoes";

export type EtapaJanete = { id: string; chave: string; nome: string };

export type ResultadoFerramenta =
  { ok: true } | { erro: string; permitidas?: string[]; orientacao?: string };

/**
 * Recusa de janete_mover_etapa (decisão 3): o lead está em Ganho ou Perdido, ou numa etapa que uma
 * pessoa escolheu e a conversa ainda não foi devolvida à Janete. Não é falha da rodada: volta ao
 * modelo como resultado, com a orientação de não insistir e seguir a conversa.
 */
export const ETAPA_TRAVADA = "etapa_travada";
export const ORIENTACAO_ETAPA_TRAVADA =
  "Este lead não pode ser movido agora (está em Ganho, em Perdido ou numa etapa escolhida por " +
  "uma pessoa da equipe). Não tente mover de novo nesta conversa; siga o atendimento normalmente.";

type ErroRpc = { code?: string; message?: string } | null;

/** Só códigos levantados pelas nossas funções (P0001 com nome curto); o resto, genérico. */
function codigoDoErro(erro: ErroRpc): string {
  const msg = erro?.message ?? "";
  if (erro?.code === "P0001" && /^[a-z_]{1,60}$/.test(msg)) return msg;
  return "erro_banco";
}

async function chamar(
  nome: "janete_mover_etapa" | "janete_passar_para_humano" | "janete_atualizar_contato",
  args: Record<string, unknown>,
): Promise<ResultadoFerramenta> {
  try {
    // os argumentos batem com a assinatura de cada função (types.ts)
    const { error } = await firebaseAdmin.rpc(nome, args as never);
    if (error) return { erro: codigoDoErro(error) };
    return { ok: true };
  } catch {
    return { erro: "erro_banco" };
  }
}

const textoCurto = (max: number) => z.string().trim().min(1).max(max);

/** Motivo do movimento no Kanban: uma frase curta. */
export const MAX_MOTIVO_MOVER = 200;
/** Fatos e próximo passo (contatos.anotacoes_janete). */
export const MAX_FATOS = 20;
export const MAX_ROTULO_FATO = 60;
export const MAX_VALOR_FATO = 300;
export const MAX_TITULO_PASSO = 120;
export const MAX_TEXTO_PASSO = 500;

/**
 * Avisado no começo de cada execução, com a promessa do resultado. Serve para a rodada não
 * perder a auditoria de uma ferramenta que já gravou quando o prazo aborta antes do fim do
 * passo (o AI SDK não chama onStepEnd nesse caso).
 */
export type AoExecutar = (
  ferramenta: string,
  entrada: unknown,
  resultado: Promise<ResultadoFerramenta>,
) => void;

/** Cada texto que vai depois do áudio (link, e-mail, chave PIX). */
export const MAX_TEXTO_FALA = 500;

/** Entrada de "responder" nos dois modos: bolhas (texto) ou fala e textos (áudio). */
export type EntradaResponder = {
  bolhas?: string[] | undefined;
  fala?: string | undefined;
  textos?: string[] | undefined;
};

const ESQUEMA_BOLHAS = z.object({
  bolhas: z.array(textoCurto(2000)).min(1).max(MAX_BOLHAS),
});
const ESQUEMA_FALA = z.object({
  fala: textoCurto(MAX_CARACTERES_FALA),
  textos: z.array(textoCurto(MAX_TEXTO_FALA)).max(MAX_TEXTOS_FALA).optional(),
});

export function criarFerramentas(p: {
  rodadaId: string;
  etapas: EtapaJanete[];
  aoExecutar?: AoExecutar;
  /** Esta resposta vai em áudio: "responder" recebe fala e textos. */
  falar?: boolean;
}) {
  const porChave = new Map(p.etapas.map((e) => [e.chave, e]));
  const chaves = p.etapas.map((e) => e.chave);
  /** true depois de um etapa_travada nesta rodada. */
  let travada = false;
  const avisar = (
    ferramenta: string,
    entrada: unknown,
    resultado: Promise<ResultadoFerramenta>,
  ): Promise<ResultadoFerramenta> => {
    p.aoExecutar?.(ferramenta, entrada, resultado);
    return resultado;
  };

  // o esquema é escolhido aqui, mas o tipo é um só: FerramentasJanete não muda com o modo
  const esquemaResponder: z.ZodType<EntradaResponder> = p.falar ? ESQUEMA_FALA : ESQUEMA_BOLHAS;

  return {
    responder: tool({
      description: p.falar
        ? "Envia a resposta ao lead em áudio: em fala, o que você vai dizer (vira um áudio com a " +
          `sua voz); em textos, até ${MAX_TEXTOS_FALA} bolhas só com o que o lead precisa ler ou ` +
          "copiar (link, e-mail, chave PIX). Chame uma vez, no fim da rodada."
        : `Envia a resposta ao lead em 1 a ${MAX_BOLHAS} bolhas curtas de WhatsApp. ` +
          "Chame uma vez, no fim da rodada.",
      inputSchema: esquemaResponder,
      execute: async (): Promise<ResultadoFerramenta> => ({ ok: true }),
    }),

    mover_etapa: tool({
      description:
        "Move o lead no funil para uma das etapas permitidas, pela chave. Em motivo, diga numa " +
        "frase curta por que está movendo (a equipe lê no Kanban).",
      inputSchema: z.object({
        etapa: z.string().trim().min(1).max(100),
        motivo: textoCurto(MAX_MOTIVO_MOVER),
      }),
      execute: async ({ etapa, motivo }): Promise<ResultadoFerramenta> => {
        const alvo = porChave.get(etapa);
        if (!alvo) return { erro: "etapa_nao_permitida", permitidas: chaves };
        // já recusado nesta rodada: o banco recusaria de novo
        if (travada) return { erro: ETAPA_TRAVADA, orientacao: ORIENTACAO_ETAPA_TRAVADA };
        const resultado = chamar("janete_mover_etapa", {
          p_rodada: p.rodadaId,
          p_etapa: alvo.id,
        }).then((r): ResultadoFerramenta => {
          if ("erro" in r && r.erro === ETAPA_TRAVADA) {
            travada = true;
            return { erro: ETAPA_TRAVADA, orientacao: ORIENTACAO_ETAPA_TRAVADA };
          }
          return r;
        });
        // o motivo fica na entrada gravada em rodadas.ferramentas (o Kanban lê por lá)
        return avisar("mover_etapa", { etapa, motivo }, resultado);
      },
    }),

    atualizar_contato: tool({
      description:
        "Guarda dados que o lead informou (nome, e-mail, empresa; só entram se ainda estiverem " +
        "vazios no cadastro), um resumo curto do que você já sabe dele, os fatos importantes " +
        "(rótulo e valor) e o próximo passo combinado. Mande só os campos que mudaram; em fatos, " +
        "mande a lista completa e atualizada.",
      inputSchema: z.object({
        nome: textoCurto(200).optional(),
        email: textoCurto(320).optional(),
        empresa: textoCurto(200).optional(),
        resumo: textoCurto(2000).optional(),
        fatos: z
          .array(
            z.object({ rotulo: textoCurto(MAX_ROTULO_FATO), valor: textoCurto(MAX_VALOR_FATO) }),
          )
          .min(1)
          .max(MAX_FATOS)
          .optional(),
        proximo_passo: z
          .object({ titulo: textoCurto(MAX_TITULO_PASSO), texto: textoCurto(MAX_TEXTO_PASSO) })
          .optional(),
      }),
      execute: async (campos): Promise<ResultadoFerramenta> => {
        const p_campos: Record<string, Json> = {};
        if (campos.nome) p_campos["nome"] = campos.nome;
        if (campos.email) p_campos["email"] = campos.email;
        if (campos.empresa) p_campos["empresa"] = campos.empresa;
        if (campos.resumo) p_campos["resumo_janete"] = campos.resumo;
        if (campos.fatos && campos.fatos.length > 0) {
          p_campos["fatos"] = campos.fatos.map((f) => ({ rotulo: f.rotulo, valor: f.valor }));
        }
        if (campos.proximo_passo) {
          p_campos["proximo_passo"] = {
            titulo: campos.proximo_passo.titulo,
            texto: campos.proximo_passo.texto,
          };
        }
        if (Object.keys(p_campos).length === 0) return { erro: "nada_para_atualizar" };
        // o janete_atualizar_contato do pacote (0006) aceita fatos e proximo_passo no formato que o
        // inputSchema já garante; uma recusa volta ao modelo como as outras
        const resultado = chamar("janete_atualizar_contato", { p_rodada: p.rodadaId, p_campos });
        return avisar("atualizar_contato", campos, resultado);
      },
    }),

    passar_para_humano: tool({
      description:
        "Passa a conversa para a equipe. Depois, despeça-se do lead pela ferramenta responder.",
      inputSchema: z.object({ motivo: textoCurto(500) }),
      execute: async (entrada): Promise<ResultadoFerramenta> =>
        avisar(
          "passar_para_humano",
          entrada,
          chamar("janete_passar_para_humano", { p_rodada: p.rodadaId }),
        ),
    }),
  };
}

export type FerramentasJanete = ReturnType<typeof criarFerramentas>;
