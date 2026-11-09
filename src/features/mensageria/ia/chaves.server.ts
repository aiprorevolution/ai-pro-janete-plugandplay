// Chaves de IA para a rodada e a transcrição. A chave decifrada só passa por aqui e pelo
// modelo; o status ("ativa", "invalida"...) vem de uma leitura à parte, porque lerChaveIA
// devolve só a chave.
import { firebaseAdmin } from "@/integrations/firebase/client.server";
import type { Database } from "@/integrations/firebase/types";

import { lerChaveIA, type ChaveIA } from "../nucleo/conexoes.server";

type Finalidade = Database["public"]["Enums"]["ia_finalidade"];
type StatusChave = Database["public"]["Enums"]["chave_status"];

export type ChaveLida =
  | { ok: true; chave: ChaveIA; status: StatusChave }
  | { ok: false; motivo: "sem_chave" | "chave_fora_de_uso" | "cifra_invalida"; id?: string };

/** Chave da finalidade, se existir, estiver em uso (não removida nem inválida) e abrir. */
export async function lerChaveUtilizavel(finalidade: Finalidade): Promise<ChaveLida> {
  const { data, error } = await firebaseAdmin
    .from("ia_chaves")
    .select("id, status")
    .eq("finalidade", finalidade)
    .maybeSingle();
  if (error) throw new Error("banco_ler_chave");
  if (!data) return { ok: false, motivo: "sem_chave" };
  if (data.status === "removida" || data.status === "invalida") {
    return { ok: false, motivo: "chave_fora_de_uso", id: data.id };
  }
  let chave: ChaveIA | null;
  try {
    chave = await lerChaveIA(finalidade);
  } catch (erro) {
    // cifra_indisponivel (falta a variável) é do servidor, não da chave: sobe
    if ((erro as Error)?.message === "cifra_invalida") {
      return { ok: false, motivo: "cifra_invalida", id: data.id };
    }
    throw erro;
  }
  if (!chave || chave.chave.trim() === "") return { ok: false, motivo: "sem_chave", id: data.id };
  return { ok: true, chave, status: data.status };
}

/** Marca a chave como inválida ou sem crédito. Melhor esforço: nunca lança erro. */
export async function marcarStatusChave(
  id: string,
  status: Extract<StatusChave, "invalida" | "sem_credito">,
  codigo: string,
): Promise<void> {
  try {
    await firebaseAdmin
      .from("ia_chaves")
      .update({
        status,
        ultimo_erro: codigo.slice(0, 60),
        atualizada_em: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id");
  } catch {
    // o aviso da tela é secundário; a rodada já foi para humano
  }
}

/**
 * Volta para "ativa" a chave que estava "sem_credito" depois de uma chamada que deu certo (o
 * admin recarregou o saldo). Só troca se ainda estiver sem_credito. Melhor esforço.
 */
export async function reativarChave(id: string): Promise<void> {
  try {
    await firebaseAdmin
      .from("ia_chaves")
      .update({ status: "ativa", ultimo_erro: null, atualizada_em: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "sem_credito")
      .select("id");
  } catch {
    // o aviso da tela é secundário
  }
}
