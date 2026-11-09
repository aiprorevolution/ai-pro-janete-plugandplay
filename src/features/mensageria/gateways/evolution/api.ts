// Chamadas à API da Evolution (apikey no cabeçalho). Falha vira ErroGateway sem URL, sem
// cabeçalho e sem texto do corpo da resposta (podem ter segredo ou mensagem de lead).
import {
  abrirPrazo,
  corpoComoTexto,
  FalhaDeRede,
  pedir,
  TempoEsgotado,
  type Prazo,
  type RespostaHttp,
} from "../../../servidor/http";
import { baseEvolution } from "../../../servidor/conexao";
import { ErroGateway, type ConexaoServidor } from "../../nucleo/tipos";

/** Tempo limite de cada operação (todos os pedidos dela juntos). */
export const PRAZO_API_MS = 25_000;

/** 4xx é definitivo, menos 408 e 429; o resto (5xx, rede, tempo) tenta de novo. */
export function definitivo(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export type Sessao = {
  base: string;
  instancia: string;
  apikey: string;
  prazo: Prazo;
};

export function abrirSessao(c: ConexaoServidor, prazoMs: number = PRAZO_API_MS): Sessao {
  const url = typeof c.parametros["serverUrl"] === "string" ? c.parametros["serverUrl"] : "";
  const base = baseEvolution(url);
  const apikey = c.segredos["apiKey"];
  if (!base || !apikey || !c.id_externo) throw new ErroGateway("conexao_invalida", true);
  return { base: base.base, instancia: c.id_externo, apikey, prazo: abrirPrazo(prazoMs) };
}

/** POST JSON em {base}/{rota}/{instância}. Devolve o corpo de uma resposta 2xx. */
export async function postar(s: Sessao, rota: string, corpo: unknown): Promise<RespostaHttp> {
  return chamarApi(s, rota, {
    method: "POST",
    headers: { apikey: s.apikey, "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

/** GET em {base}/{rota}/{instância}. Devolve o corpo de uma resposta 2xx. */
export async function buscar(s: Sessao, rota: string): Promise<RespostaHttp> {
  return chamarApi(s, rota, { method: "GET", headers: { apikey: s.apikey } });
}

async function chamarApi(s: Sessao, rota: string, init: RequestInit): Promise<RespostaHttp> {
  const url = `${s.base}/${rota}/${encodeURIComponent(s.instancia)}`;
  let r: RespostaHttp;
  try {
    r = await pedir(undefined, s.prazo, url, init, [s.apikey]);
  } catch (falhou) {
    if (falhou instanceof TempoEsgotado) throw new ErroGateway("tempo_esgotado", false);
    if (falhou instanceof FalhaDeRede) throw new ErroGateway("falha_de_rede", false);
    throw new ErroGateway("erro_interno", false);
  }
  if (r.status >= 200 && r.status < 300) return r;
  if (r.status >= 300 && r.status < 400) throw new ErroGateway("redirecionamento", true);
  if (/LICENSE_REQUIRED/.test(corpoComoTexto(r.corpo)))
    throw new ErroGateway("licenca_necessaria", false);
  throw new ErroGateway(`http:${r.status}`, definitivo(r.status));
}
