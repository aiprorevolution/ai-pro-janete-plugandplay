// A conferência de membro das funções de servidor da onda 1 (validarConexao, validarChaveIA e
// listarModelos; spec de ligar as telas ao banco, C8). Elas não gravam nada, mas falam com o
// gateway e com o provedor de IA: só quem é membro ativo da empresa pode usar, para a função não
// virar um repassador aberto para qualquer conta logada. A pergunta é a eh_membro() do banco, com
// o cliente do usuário (o do requireFirebaseAuth), sob as regras do banco.

import type { FirebaseClient } from "@/integrations/firebase/client-contract";

import type { Database } from "@/integrations/firebase/types";

/** A recusa de quem não é membro ativo, no formato das outras recusas destas funções. */
export type SemAcessoServidor = { ok: false; erro: "sem_acesso"; mensagem: string };

export const MENSAGEM_SEM_MEMBRO = "Sua conta não tem acesso. Peça um convite ao admin.";

const SEM_MEMBRO: SemAcessoServidor = { ok: false, erro: "sem_acesso", mensagem: MENSAGEM_SEM_MEMBRO };

/**
 * null quando a conta é membro ativo; senão, a recusa. Falha ao perguntar (rede, erro do banco)
 * também recusa: sem a confirmação, a função não fala com o provedor.
 */
export async function exigirMembro(cliente: Pick<FirebaseClient<Database>, "rpc">): Promise<SemAcessoServidor | null> {
  try {
    const { data, error } = await cliente.rpc("eh_membro");
    if (error || data !== true) return SEM_MEMBRO;
    return null;
  } catch {
    return SEM_MEMBRO;
  }
}
