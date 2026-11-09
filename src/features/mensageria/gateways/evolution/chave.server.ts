// O que fica guardado numa conexão da Evolution (spec-qr-whatsapp, seção 7). O nome efetivo da
// instância ("janete" quando vazio) e a chave: o token próprio quando a instância foi criada pela
// Janete (a chave global não fica guardada), ou a chave que a pessoa colou, como antes.
import { baseEvolution, nomeInstancia, requisicaoEvolution, type ErroConexao } from "../../../servidor/conexao";
import { abrirPrazo, FalhaDeRede, pedir, TempoEsgotado, type OpcoesValidacao } from "../../../servidor/http";
import { tokenDaInstanciaEvolution } from "../../nucleo/token-evolution.server";

export type CamposGuardar =
  | { ok: true; campos: Record<string, string> }
  | { ok: false; erro: Extract<ErroConexao, "servidor_inacessivel" | "tempo_esgotado">; mensagem: string };

const NAO_CONFERIU =
  "Não deu para conferir a instância no seu servidor Evolution agora. Nada foi salvo: tente de novo em instantes.";

/**
 * A chave colada só fica numa recusa definitiva do token próprio (401 ou 403: a instância não é
 * da Janete). Na dúvida (rede, tempo, 5xx, 429), nada é salvo: guardar a colada ali poderia deixar a
 * chave global numa instância que a Janete criou (decisão 2 da seção 7).
 */
export async function camposParaGuardarEvolution(
  campos: Record<string, string>,
  opcoes: OpcoesValidacao,
): Promise<CamposGuardar> {
  const nome = nomeInstancia(campos["instanceName"]);
  const resultado = { ...campos, instanceName: nome };
  const base = baseEvolution(campos["serverUrl"] ?? "");
  const colada = (campos["apiKey"] ?? "").trim();
  if (!base) return { ok: true, campos: resultado };
  let token: string;
  try {
    token = await tokenDaInstanciaEvolution(base.base, nome);
  } catch {
    // sem a variável da cifra, fica a colada (o salvar falha depois, ao cifrar)
    return { ok: true, campos: resultado };
  }
  if (token === colada) return { ok: true, campos: resultado };
  // o token próprio só abre a instância que a Janete criou com ele
  const req = requisicaoEvolution(base, { serverUrl: base.base, instanceName: nome, apiKey: token });
  const prazo = abrirPrazo(opcoes.prazoMs);
  try {
    const r = await pedir(opcoes, prazo, req.url, req.init, [token, colada]);
    if (r.status >= 200 && r.status < 300) return { ok: true, campos: { ...resultado, apiKey: token } };
    if (r.status === 401 || r.status === 403) return { ok: true, campos: resultado };
    return { ok: false, erro: "servidor_inacessivel", mensagem: NAO_CONFERIU };
  } catch (falhou) {
    if (falhou instanceof TempoEsgotado) return { ok: false, erro: "tempo_esgotado", mensagem: NAO_CONFERIU };
    if (falhou instanceof FalhaDeRede) return { ok: false, erro: "servidor_inacessivel", mensagem: NAO_CONFERIU };
    return { ok: false, erro: "servidor_inacessivel", mensagem: NAO_CONFERIU };
  } finally {
    prazo.encerrar();
  }
}
