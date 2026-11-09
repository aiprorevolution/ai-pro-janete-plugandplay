// Função de servidor: busca a lista de modelos atual no provedor de IA, sem gravar nada.
// Uso no navegador: await listarModelos({ data: { provedor, chave?, workspaceId? } })
// Resposta: ResultadoListarModelos (listar-modelos.ts), ou { ok: false, erro: "sem_acesso", mensagem }
// para quem não é membro ativo (eh_membro). A chave nunca volta.
// Exige sessão do Firebase e membro, como validarChaveIA, para a função não virar um repassador aberto.
// A lógica (pedidos, filtro dos modelos de texto, união com a lista curada) fica em
// listar-modelos-logica.ts, que é pura e testada com fetch simulado.
import { createServerFn } from "@tanstack/react-start";

import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";

import type { EntradaListarModelos, ResultadoListarModelos } from "./listar-modelos";
import { lerEntradaListarModelos, listarModelosLogica } from "./listar-modelos-logica";
import { exigirMembro, type SemAcessoServidor } from "./membro";

export type { EntradaListarModelos, ModeloListado, ResultadoListarModelos } from "./listar-modelos";
export type { SemAcessoServidor } from "./membro";

export const listarModelos = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaListarModelos) => lerEntradaListarModelos(entrada))
  .handler(async ({ data, context }): Promise<ResultadoListarModelos | SemAcessoServidor> => {
    const recusa = await exigirMembro(context.firebase);
    if (recusa) return recusa;
    return listarModelosLogica(data);
  });
