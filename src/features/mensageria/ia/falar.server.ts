// A Janete fala (docs/spec-voz-uso.md, contrato C1): lê a escolha da voz em configuracao, diz se a
// chave da voz está em uso e transforma o texto falado em áudio OGG/Opus pela ElevenLabs
// (POST /v1/text-to-speech/<voz>, modelo fixo eleven_multilingual_v2). A rodada chama falar()
// depois da IA; qualquer falha volta como { ok: false } e a resposta vai em texto na hora (D6).
// - Tempo: o menor entre 15 s e fimEm - agora - 1 s; com menos de 4 s, nem pede.
// - 401 de cota ou 402: a chave fica sem_credito; outro 401 ou 403: invalida. O 401 de
//   permissão (a chave sem o acesso Text to Speech) também a deixa invalida, com ultimo_erro
//   'sem_permissao', que o "Conferir tudo" não desfaz (P7). 404 (ou voice_not_found):
//   configuracao.voz_erro = 'voz_nao_encontrada' para a voz pedida.
// - 429, 5xx e rede repetem uma vez, se couber no tempo.
// - Sucesso: a chave sem_credito volta para ativa, o voz_erro da mesma voz é limpo e uma linha
//   de custo (tipo 'fala', por caractere) vai para ia_chamadas.
// Nem o texto, nem o áudio, nem a chave vão para log, erro ou resultado.
import { firebaseAdmin } from "@/integrations/firebase/client.server";
import {
  MODO_VOZ_PADRAO,
  MODOS_VOZ,
  VOZ_ID,
  type ModoVoz,
} from "@/features/servidor/vozes-tipos";

import { tempoAte } from "../nucleo/prazo";
import { lerChaveUtilizavel, marcarStatusChave, reativarChave } from "./chaves.server";
import { carregarPrecos, custoDeFala, gravarChamadas } from "./custo.server";
import {
  caracteresDe,
  duracaoOgg,
  FORMATO_FALA,
  MAX_CARACTERES_FALA,
  MIME_FALA,
  MIN_TEMPO_FALA_MS,
  MODELO_FALA,
  TETO_FALA_MS,
} from "./fala";

export const ELEVENLABS_FALA = "https://api.elevenlabs.io/v1/text-to-speech";
/** Espera antes da única nova tentativa (429, 5xx ou rede). */
const ESPERA_REPETICAO_MS = 500;
const MAX_CORPO_ERRO = 8_000;

export type ConfigVoz = { modo: ModoVoz; vozId: string | null };

const SEM_FALA: ConfigVoz = { modo: "nunca", vozId: null };

function ehModo(v: unknown): v is ModoVoz {
  return typeof v === "string" && (MODOS_VOZ as readonly string[]).includes(v);
}

/** Modo e voz da linha única de configuracao. Erro do banco = não fala. */
export async function lerConfigVoz(): Promise<ConfigVoz> {
  try {
    const { data, error } = await firebaseAdmin
      .from("configuracao")
      .select("voz_resposta, voz_id")
      .eq("id", 1)
      .maybeSingle();
    if (error) return SEM_FALA;
    if (!data) return { modo: MODO_VOZ_PADRAO, vozId: null };
    const vozId = typeof data.voz_id === "string" && VOZ_ID.test(data.voz_id) ? data.voz_id : null;
    return { modo: ehModo(data.voz_resposta) ? data.voz_resposta : MODO_VOZ_PADRAO, vozId };
  } catch {
    return SEM_FALA;
  }
}

/** A linha "voz" de ia_chaves existe e não está removida nem inválida. Erro = false. */
export async function vozEmUso(): Promise<boolean> {
  try {
    const { data, error } = await firebaseAdmin
      .from("ia_chaves")
      .select("id, status")
      .eq("finalidade", "voz")
      .maybeSingle();
    if (error || !data) return false;
    return data.status !== "removida" && data.status !== "invalida";
  } catch {
    return false;
  }
}

export type FalhaFala =
  | "sem_chave"
  | "sem_tempo"
  | "voz_nao_encontrada"
  | "chave_invalida"
  | "sem_credito"
  | "passageira"
  | "recusada";

export type ResultadoFala =
  | { ok: true; bytes: Uint8Array; mime: string; caracteres: number; duracaoS: number | null }
  | { ok: false; erro: FalhaFala };

export type OpcoesFala = {
  vozId: string;
  /** Prazo absoluto (Date.now()) até o qual a fala tem de ter acabado. */
  fimEm?: number;
  rodadaId?: string | null;
  conversaId?: string | null;
};

function falha(erro: FalhaFala): ResultadoFala {
  return { ok: false, erro };
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** O detail.status do erro da ElevenLabs, em minúsculas ("" sem ele). Só para classificar. */
async function statusDoErro(resp: Response): Promise<string> {
  try {
    const json: unknown = JSON.parse((await resp.text()).slice(0, MAX_CORPO_ERRO));
    const detalhe = ehObjeto(json) ? json["detail"] : null;
    const status = ehObjeto(detalhe) ? detalhe["status"] : null;
    return typeof status === "string" ? status.toLowerCase() : "";
  } catch {
    return "";
  }
}

function ehTempo(erro: unknown): boolean {
  const nome = (erro as { name?: unknown })?.name;
  return nome === "TimeoutError" || nome === "AbortError";
}

function dormir(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}

/** Grava (ou limpa) o voz_erro só se a voz escolhida ainda for a pedida. Melhor esforço. */
async function marcarErroVoz(vozId: string, erro: "voz_nao_encontrada" | null): Promise<void> {
  try {
    let q = firebaseAdmin
      .from("configuracao")
      .update({ voz_erro: erro })
      .eq("id", 1)
      .eq("voz_id", vozId);
    // limpar só onde havia erro: a fala que dá certo não grava à toa
    if (erro === null) q = q.eq("voz_erro", "voz_nao_encontrada");
    await q.select("id");
  } catch {
    // o aviso da tela é secundário
  }
}

async function registrarCusto(
  caracteres: number,
  requestId: string | null,
  opcoes: OpcoesFala,
): Promise<void> {
  try {
    const custo = custoDeFala(await carregarPrecos("elevenlabs", MODELO_FALA), caracteres);
    await gravarChamadas([
      {
        tipo: "fala",
        rodada_id: opcoes.rodadaId ?? null,
        conversa_id: opcoes.conversaId ?? null,
        provedor: "elevenlabs",
        modelo: MODELO_FALA,
        caracteres,
        custo_usd: custo.custo_usd,
        custo_origem: custo.custo_origem,
        preco_id: custo.preco_id,
        request_id: requestId,
      },
    ]);
  } catch {
    // custo é registro; não derruba a fala
  }
}

type Tentativa =
  | { ok: true; resp: Response }
  | { ok: false; erro: FalhaFala; status?: number; repetir?: boolean; semPermissao?: boolean };

async function pedirFala(
  url: string,
  chave: string,
  texto: string,
  tempoMs: number,
): Promise<Tentativa> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": chave, "Content-Type": "application/json" },
      body: JSON.stringify({ text: texto, model_id: MODELO_FALA }),
      redirect: "manual",
      signal: AbortSignal.timeout(tempoMs),
    });
  } catch (erro) {
    // tempo esgotado gastou o prazo; erro de rede pode repetir
    return { ok: false, erro: "passageira", repetir: !ehTempo(erro) };
  }
  if (resp.ok) return { ok: true, resp };
  const status = resp.status;
  const detalhe = await statusDoErro(resp);
  if (status === 404 || detalhe.includes("voice_not_found")) {
    return { ok: false, erro: "voz_nao_encontrada", status };
  }
  if (status === 402 || (status === 401 && detalhe.includes("quota"))) {
    return { ok: false, erro: "sem_credito", status };
  }
  // a chave sem o acesso Text to Speech (missing_permissions): inválida até ser trocada (P7)
  if (status === 401 && detalhe.includes("permission")) {
    return { ok: false, erro: "chave_invalida", status, semPermissao: true };
  }
  if (status === 401 || status === 403) return { ok: false, erro: "chave_invalida", status };
  if (status === 429 || status >= 500) return { ok: false, erro: "passageira", status, repetir: true };
  return { ok: false, erro: "recusada", status };
}

/** Transforma o texto em áudio com a voz escolhida. Nunca lança. */
export async function falar(texto: string, opcoes: OpcoesFala): Promise<ResultadoFala> {
  try {
    const caracteres = caracteresDe(texto);
    if (texto.trim() === "" || caracteres > MAX_CARACTERES_FALA) return falha("recusada");
    if (!VOZ_ID.test(opcoes.vozId)) return falha("voz_nao_encontrada");

    const inicio = Date.now();
    const tempoTotal = tempoAte(TETO_FALA_MS, opcoes.fimEm);
    if (tempoTotal < MIN_TEMPO_FALA_MS) return falha("sem_tempo");

    const lida = await lerChaveUtilizavel("voz");
    if (!lida.ok) {
      if (lida.motivo === "cifra_invalida" && lida.id) {
        await marcarStatusChave(lida.id, "invalida", "cifra_invalida");
      }
      return falha("sem_chave");
    }
    if (lida.chave.provedor !== "elevenlabs") return falha("sem_chave");
    const chave = lida.chave;

    const url =
      `${ELEVENLABS_FALA}/${encodeURIComponent(opcoes.vozId)}` +
      `?output_format=${encodeURIComponent(FORMATO_FALA)}`;
    // ler e decifrar a chave já gastou parte do prazo: o 1º pedido fica com o que sobra
    const primeiro = tempoTotal - (Date.now() - inicio);
    if (primeiro < MIN_TEMPO_FALA_MS) return falha("sem_tempo");
    let t = await pedirFala(url, chave.chave, texto, primeiro);
    if (!t.ok && t.repetir) {
      // uma nova tentativa, só se ainda couber uma fala inteira de 4 s depois da espera
      const restante = tempoTotal - (Date.now() - inicio) - ESPERA_REPETICAO_MS;
      if (restante >= MIN_TEMPO_FALA_MS) {
        await dormir(ESPERA_REPETICAO_MS);
        t = await pedirFala(url, chave.chave, texto, restante);
      }
    }

    if (!t.ok) {
      if (t.erro === "sem_credito") {
        await marcarStatusChave(chave.id, "sem_credito", `http_${t.status}`);
      } else if (t.erro === "chave_invalida") {
        await marcarStatusChave(chave.id, "invalida", t.semPermissao ? "sem_permissao" : `http_${t.status}`);
      } else if (t.erro === "voz_nao_encontrada") {
        await marcarErroVoz(opcoes.vozId, "voz_nao_encontrada");
      }
      return falha(t.erro);
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await t.resp.arrayBuffer());
    } catch (erro) {
      return falha(ehTempo(erro) ? "passageira" : "recusada");
    }
    if (bytes.byteLength === 0) return falha("recusada");

    // a fala deu certo: o saldo voltou e a voz existe
    if (lida.status === "sem_credito") await reativarChave(chave.id);
    await marcarErroVoz(opcoes.vozId, null);
    const requestId =
      t.resp.headers.get("request-id") ?? t.resp.headers.get("x-request-id") ?? null;
    await registrarCusto(caracteres, requestId, opcoes);

    return { ok: true, bytes, mime: MIME_FALA, caracteres, duracaoS: duracaoOgg(bytes) };
  } catch {
    return falha("passageira");
  }
}
