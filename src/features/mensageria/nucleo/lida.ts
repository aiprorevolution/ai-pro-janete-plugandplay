// "Lido" no WhatsApp sem o "digitando" (spec de ligar as telas, decisão 6 e 2.5): quando uma
// pessoa abre ou mexe na conversa na tela, o lead vê o azul. Quem chama (a função de servidor
// da tela) já tem a conexão decifrada, o destino e os ids externos (RefLida: só ids de entrada,
// do mais antigo ao mais novo).
import type { AdaptadorGateway, ConexaoServidor, RefLida } from "./tipos";

/**
 * Pede o "lido" ao gateway pelo marcarLida do adaptador. Nunca lança erro e nunca cai no
 * marcarLidaEDigitando (o lead veria "digitando" sem ninguém escrever).
 * Devolve true só quando o gateway aceitou o pedido; false quando não há o que marcar, o
 * adaptador não tem marcarLida (a Zernio), não pediu nada (contato só com lid na Evolution, sem
 * prazo) ou o pedido falhou. false é normal: a conversa fica lida na tela do mesmo jeito.
 */
export async function marcarSoLida(
  adaptador: Pick<AdaptadorGateway, "marcarLida">,
  ref: RefLida,
  conexao: ConexaoServidor,
  opcoes: { fimEm?: number } = {},
): Promise<boolean> {
  const ids = ref.ids_externos.filter((id) => typeof id === "string" && id.trim() !== "");
  if (!adaptador.marcarLida || ids.length === 0 || ref.destino.length === 0) return false;
  try {
    const feito = await adaptador.marcarLida(
      { destino: ref.destino, ids_externos: ids },
      conexao,
      opcoes,
    );
    return feito === true;
  } catch {
    return false;
  }
}
