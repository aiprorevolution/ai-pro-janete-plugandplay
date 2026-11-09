// Chamadas à API da Z-API. A URL leva o instanceId e o token da instância no caminho e o
// Client-Token vai no cabeçalho. Nada aqui entra em log, erro ou resposta com segredo.
import {
  abrirPrazo,
  FalhaDeRede,
  pedir,
  TempoEsgotado,
  type Prazo,
  type RespostaHttp,
} from "../../../servidor/http";
import { tempoAte } from "../../nucleo/prazo";
import { ErroGateway, type ConexaoServidor, type Identificador } from "../../nucleo/tipos";

export const BASE_ZAPI = "https://api.z-api.io/instances";
export const PRAZO_API_MS = 15_000;

export type Credenciais = { instanceId: string; instanceToken: string; clientToken: string };

export function credenciais(c: ConexaoServidor): Credenciais {
  const instanceToken = c.segredos["instanceToken"] ?? "";
  const clientToken = c.segredos["clientToken"] ?? "";
  if (!c.id_externo || !instanceToken || !clientToken) {
    throw new ErroGateway("conexao_invalida", true);
  }
  return { instanceId: c.id_externo, instanceToken, clientToken };
}

export function urlApi(k: Credenciais, rota: string): string {
  const id = encodeURIComponent(k.instanceId);
  const token = encodeURIComponent(k.instanceToken);
  return `${BASE_ZAPI}/${id}/token/${token}/${rota}`;
}

/** 4xx é definitivo, menos 408 e 429. 5xx, rede e tempo esgotado tentam de novo. */
export function erroDeStatus(status: number): ErroGateway {
  const definitivo = status >= 300 && status < 500 && status !== 408 && status !== 429;
  return new ErroGateway(`http_${status}`, definitivo);
}

/** Pedido JSON à API. Lança ErroGateway em qualquer falha; devolve o corpo em caso de 2xx. */
export async function chamar(
  k: Credenciais,
  metodo: "GET" | "POST" | "PUT",
  rota: string,
  corpo: unknown,
  prazo: Prazo,
): Promise<RespostaHttp> {
  const init: RequestInit = {
    method: metodo,
    headers: { "Client-Token": k.clientToken, "Content-Type": "application/json" },
  };
  if (corpo !== undefined) init.body = JSON.stringify(corpo);
  let r: RespostaHttp;
  try {
    r = await pedir(undefined, prazo, urlApi(k, rota), init, [k.instanceToken, k.clientToken]);
  } catch (erro) {
    if (erro instanceof TempoEsgotado) throw new ErroGateway("tempo_esgotado", false);
    if (erro instanceof FalhaDeRede) throw new ErroGateway("falha_de_rede", false);
    throw new ErroGateway("falha_de_rede", false);
  }
  if (r.status < 200 || r.status >= 300) throw erroDeStatus(r.status);
  return r;
}

/** fimEm: prazo absoluto do worker (nucleo/prazo.ts); o pedido desiste antes dele. */
export function abrirPrazoApi(fimEm?: number): Prazo {
  return abrirPrazo(tempoAte(PRAZO_API_MS, fimEm));
}

export async function comPrazo<T>(fn: (p: Prazo) => Promise<T>): Promise<T> {
  const prazo = abrirPrazoApi();
  try {
    return await fn(prazo);
  } finally {
    prazo.encerrar();
  }
}

/**
 * Destino do envio: telefone (só dígitos) primeiro, depois o lid. O núcleo guarda o lid só com
 * os dígitos (sem "@lid"); a Z-API aceita "<lid>@lid" no campo phone, e sem o sufixo o lid
 * seria lido como telefone.
 */
export function destinoDe(destino: Identificador[]): string | null {
  const tel = destino.find((i) => i.tipo === "telefone" && /^\d{6,}$/.test(i.valor.trim()));
  if (tel) return tel.valor.trim();
  const lid = destino.find((i) => i.tipo === "lid" && i.valor.trim() !== "");
  if (lid) {
    const v = lid.valor.trim();
    return /@lid$/i.test(v) ? v : `${v}@lid`;
  }
  return null;
}
