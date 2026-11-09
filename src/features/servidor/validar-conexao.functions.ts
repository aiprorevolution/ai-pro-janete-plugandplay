// Função de servidor: testa a credencial no gateway de WhatsApp, sem gravar nada (onda 1).
// Uso no navegador: await validarConexao({ data: { gateway, campos } })
// Resposta: { ok: true, rotulo } ou { ok: false, erro, campo?, mensagem }. A credencial nunca
// volta. Exige sessão do Firebase e conta de membro ativo (eh_membro; sem ele, erro sem_acesso),
// para a função não virar um repassador aberto de pedidos.
import { createServerFn } from "@tanstack/react-start";

import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";

import { lerEntradaConexao, validarConexaoLogica, type EntradaConexao, type ResultadoConexao } from "./conexao";
import { exigirMembro, type SemAcessoServidor } from "./membro";

export type { EntradaConexao, ErroConexao, Gateway, ResultadoConexao } from "./conexao";
export type { SemAcessoServidor } from "./membro";

export const validarConexao = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaConexao) => lerEntradaConexao(entrada))
  .handler(async ({ data, context }): Promise<ResultadoConexao | SemAcessoServidor> => {
    const recusa = await exigirMembro(context.firebase);
    if (recusa) return recusa;
    return validarConexaoLogica(data);
  });
