// Chamadas à Graph API da Meta. Segredos só no cabeçalho; nenhum erro leva URL, corpo ou token.
import { abrirPrazo } from "../../../servidor/http";
import { META_GRAPH } from "../../../servidor/conexao";
import { tempoAte } from "../../nucleo/prazo";
import { ErroGateway } from "../../nucleo/tipos";

export { META_GRAPH };

const PRAZO_MS = 20_000;

// Códigos da Meta que pedem nova tentativa mesmo vindo como 4xx (página oficial de códigos de
// erro): 1 e 2 (erro ou indisponibilidade temporária da API), 4 (limite de chamadas do app),
// 80007 (limite da conta), 130429 (throughput), 131000 (erro genérico), 131016 (serviço
// indisponível), 131056 (limite por destinatário), 133004 (servidor indisponível) e 2494100
// (número em manutenção).
export const CODIGOS_TRANSITORIOS = new Set([
  1, 2, 4, 80007, 130429, 131000, 131016, 131056, 133004, 2494100,
]);

export type RespostaMeta = { status: number; corpo: unknown; bytes?: Uint8Array; mime?: string };

function codigoMeta(corpo: unknown): number | undefined {
  if (corpo === null || typeof corpo !== "object") return undefined;
  const erro = (corpo as Record<string, unknown>)["error"];
  if (erro === null || typeof erro !== "object") return undefined;
  const c = (erro as Record<string, unknown>)["code"];
  return typeof c === "number" ? c : undefined;
}

/** 4xx é definitivo, menos 408 e 429; 5xx e o resto não. */
export function erroDeStatus(status: number, corpo: unknown): ErroGateway {
  const cod = codigoMeta(corpo);
  const sufixo = cod !== undefined ? `_${cod}` : "";
  const quatroXX = status >= 400 && status < 500;
  const definitivo =
    quatroXX &&
    status !== 408 &&
    status !== 429 &&
    !(cod !== undefined && CODIGOS_TRANSITORIOS.has(cod));
  return new ErroGateway(`meta_${status}${sufixo}`, definitivo);
}

type Opcoes = {
  metodo?: "GET" | "POST";
  corpo?: unknown;
  bytes?: boolean;
  seguirRedirect?: boolean;
  /** Prazo absoluto do worker: o pedido desiste antes dele. */
  fimEm?: number;
  /** Tempo exato do pedido (o envio usa tempoEnvio); sem ele, 20 s cortados por fimEm. */
  prazoMs?: number;
};

/** Faz o pedido. Rede e tempo esgotado viram ErroGateway não definitivo; status de erro também. */
export async function chamar(url: string, token: string, o: Opcoes = {}): Promise<RespostaMeta> {
  const prazo = abrirPrazo(o.prazoMs ?? tempoAte(PRAZO_MS, o.fimEm));
  try {
    const init: RequestInit = {
      method: o.metodo ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(o.corpo !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      redirect: o.seguirRedirect ? "follow" : "manual",
      signal: prazo.sinal,
      ...(o.corpo !== undefined ? { body: JSON.stringify(o.corpo) } : {}),
    };
    let r: Response;
    try {
      r = await fetch(url, init);
    } catch {
      throw new ErroGateway(prazo.sinal.aborted ? "tempo_esgotado" : "falha_de_rede", false);
    }
    try {
      if (o.bytes && r.status >= 200 && r.status < 300) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        const mime = r.headers.get("content-type") ?? undefined;
        return { status: r.status, corpo: null, bytes, ...(mime ? { mime } : {}) };
      }
      const t = await r.text();
      let corpo: unknown = null;
      try {
        corpo = t ? (JSON.parse(t) as unknown) : null;
      } catch {
        corpo = null;
      }
      if (r.status < 200 || r.status >= 300) throw erroDeStatus(r.status, corpo);
      return { status: r.status, corpo };
    } catch (e) {
      if (e instanceof ErroGateway) throw e;
      throw new ErroGateway(prazo.sinal.aborted ? "tempo_esgotado" : "falha_de_rede", false);
    }
  } finally {
    prazo.encerrar();
  }
}
