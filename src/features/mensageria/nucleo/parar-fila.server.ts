// A fila da conexão que sai, que o Desconectar (configuracao/acoes.server.ts) e o Trocar de
// WhatsApp (gravarConexao, em conexoes.server.ts) param em silêncio (decisões 11 e 16 da
// spec-lacunas-mensageria). Roda depois de desativar a conexão.
import {
  cancelarBolhasDaJaneteNaFila,
  falharMensagensDaEquipeNaFila,
} from "../configuracao/banco.server";

/**
 * As mensagens na fila da conexão desligada: as bolhas da Janete viram canceladas (não disparam o
 * gatilho do envio que falhou) e as da equipe pela tela viram "não enviada", com o "Tentar de
 * novo". Tenta as duas; devolve o código de cada uma que falhou. Nunca lança.
 */
export async function pararFilaDaConexao(id: string): Promise<string[]> {
  const falhas: string[] = [];
  try {
    await cancelarBolhasDaJaneteNaFila(id);
  } catch {
    falhas.push("cancelar_fila_janete");
  }
  try {
    await falharMensagensDaEquipeNaFila(id);
  } catch {
    falhas.push("falhar_fila_equipe");
  }
  return falhas;
}
