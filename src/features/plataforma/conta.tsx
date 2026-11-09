import { createContext, useContext, useEffect, useState } from "react";

import { firebase } from "@/integrations/firebase/client";

// Quem está usando a plataforma: o nome (user_metadata.nome) e o e-mail da conta do Firebase.
// O Layout busca uma vez e passa para as áreas pelo contexto; uma área montada sem o Layout
// (num teste, por exemplo) busca sozinha.

export interface ContaPlataforma {
  /** O id do usuário do Firebase (vazio até a busca terminar ou sem sessão). O Layout compara com o da
   *  sessão para notar a troca de conta feita em outra aba. */
  id: string;
  nome: string;
  email: string;
  /** A busca terminou (com ou sem dado). Antes disso, a tela não afirma nome, iniciais nem e-mail. */
  carregada: boolean;
}

const CONTA_VAZIA: ContaPlataforma = { id: "", nome: "", email: "", carregada: false };

const ContaContexto = createContext<ContaPlataforma | null>(null);

export const ProvedorConta = ContaContexto.Provider;

/** Lê o usuário logado (`firebase.auth.getUser()`). Com `ativo` false, não busca nada. */
export function useContaDoFirebase(ativo = true): ContaPlataforma {
  const [conta, setConta] = useState<ContaPlataforma>(CONTA_VAZIA);
  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    (async () => {
      let id = "";
      let nome = "";
      let email = "";
      try {
        const { data } = await firebase.auth.getUser();
        const n = data.user?.user_metadata?.["nome"];
        const e = data.user?.email;
        const u = data.user?.id;
        if (typeof u === "string") id = u;
        if (typeof n === "string") nome = n.trim();
        if (typeof e === "string") email = e.trim();
      } catch {
        // sem sessão ou sem rede: fica "Você" e "E-mail não informado"
      }
      if (vivo) setConta({ id, nome, email, carregada: true });
    })();
    return () => {
      vivo = false;
    };
  }, [ativo]);
  return conta;
}

/** A conta que o Layout já buscou; sem o Layout em volta, busca sozinha. */
export function useConta(): ContaPlataforma {
  const doLayout = useContext(ContaContexto);
  const propria = useContaDoFirebase(doLayout === null);
  return doLayout ?? propria;
}
