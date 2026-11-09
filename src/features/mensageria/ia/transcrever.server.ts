// Transcrição de áudio (spec da mensageria, premissa "Transcrição"). O ciclo do worker chama
// esta função para cada áudio copiado para o Storage.
// Ordem da chave: a de transcrição; senão, a da resposta, se for OpenAI ou OpenRouter (a
// Anthropic não transcreve); senão, a da voz (ElevenLabs, Scribe v2, docs/spec-voz-uso.md D5).
// A chave própria de transcrição usa o modelo que o admin escolheu; a da ElevenLabs no cartão
// Escuta usa o Scribe v2, fixo (docs/spec-escuta-elevenlabs.md P3 e P4).
// 408, 409, 429, 5xx e erro de rede repetem até 2 vezes dentro dos 60 s; se ainda falhar (ou o
// tempo esgotar): { erro: "passageiro" }, e o ciclo devolve a mídia para nova tentativa. Sem
// chave que transcreva, formato recusado, 401, sem crédito, áudio mudo ou erro inesperado:
// { erro: "audio_sem_transcricao" } (definitivo). O custo
// vai para ia_chamadas (tipo "transcricao"), inclusive quando o texto volta vazio. 401 marca a
// chave como inválida; 402 ou cota esgotada (na ElevenLabs, o 401 com detail.status de cota),
// como sem_credito (sem repetir). Na ElevenLabs, o 401 de permissão (a chave sem o acesso
// Speech to Text) marca inválida com ultimo_erro 'sem_permissao' (docs/spec-voz-uso.md P7 e
// P8), que o "Conferir tudo" não desfaz. Uma transcrição que
// deu certo volta a chave sem_credito para ativa. Nem o áudio, nem o texto, nem a chave vão
// para log ou erro.
import { APICallError } from "ai";

import type { Database } from "@/integrations/firebase/types";

import type { ChaveIA } from "../nucleo/conexoes.server";
import { tempoAte } from "../nucleo/prazo";
import { lerChaveUtilizavel, marcarStatusChave, reativarChave } from "./chaves.server";
import {
  carregarPrecos,
  custoDeAudio,
  custoDoProvedor,
  gravarChamadas,
  limparUsoBruto,
  type Custo,
} from "./custo.server";
import { classificarErroIA } from "./erros";
import { MODELO_ESCUTA_ELEVENLABS } from "./fala";

/**
 * audio_sem_transcricao = definitivo (sem chave que transcreva, formato recusado, 401, sem
 * crédito, áudio mudo). passageiro = 408, 409, 429, 5xx, rede ou tempo esgotado: o ciclo
 * devolve a mídia para nova tentativa.
 */
export type ResultadoTranscricao =
  { texto: string } | { erro: "audio_sem_transcricao" } | { erro: "passageiro" };

export type OpcoesTranscricao = {
  /** Rodada a que o custo pertence, quando houver. */
  rodadaId?: string | null;
  /**
   * Conversa do áudio: vai para ia_chamadas.conversa_id, para o custo da transcrição contar na
   * conversa (custo_das_conversas soma por coalesce(ia_chamadas.conversa_id, rodadas.conversa_id)).
   */
  conversaId?: string | null;
  /**
   * Prazo absoluto da chamada do worker (nucleo/prazo.ts): o tempo total é o menor entre 60 s
   * e o que falta até ele, menos 1 s. Esgotado, volta { erro: "passageiro" }.
   */
  fimEm?: number;
};

type Provedor = Database["public"]["Enums"]["ia_provedor"];
type StatusChave = Database["public"]["Enums"]["chave_status"];

export const MAX_BYTES_AUDIO = 25 * 1024 * 1024;
const TEMPO_MS = 60_000;
export const MAX_REPETICOES_TRANSCRICAO = 2;
const ESPERA_BASE_MS = 500;
const ESPERA_MAX_MS = 10_000;

export const MODELOS_TRANSCRICAO = {
  openai: "gpt-transcribe",
  openrouter: "openai/whisper-1",
  groq: "whisper-large-v3-turbo",
} as const;

const URLS = {
  openai: "https://api.openai.com/v1/audio/transcriptions",
  openrouter: "https://openrouter.ai/api/v1/audio/transcriptions",
  groq: "https://api.groq.com/openai/v1/audio/transcriptions",
  elevenlabs: "https://api.elevenlabs.io/v1/speech-to-text",
} as const;

/** Provedores da chave própria de transcrição com modelo escolhido pelo admin. */
type ProvedorEscolhido = keyof typeof MODELOS_TRANSCRICAO;
/** Mais a ElevenLabs, de modelo fixo: no cartão Escuta ou pela chave da voz (a última da ordem). */
type ProvedorTranscricao = ProvedorEscolhido | "elevenlabs";

const SEM_TRANSCRICAO = { erro: "audio_sem_transcricao" } as const;
const PASSAGEIRO = { erro: "passageiro" } as const;

/** Formato (nome do arquivo e "format" da OpenRouter) a partir do mime. null = recusado. */
export function formatoDoMime(mime: string): string | null {
  const base = (mime.split(";")[0] ?? "").trim().toLowerCase();
  const mapa: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "application/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/webm": "webm",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
  };
  return mapa[base] ?? null;
}

function ehTranscritor(p: Provedor): p is ProvedorEscolhido {
  return p === "openai" || p === "openrouter" || p === "groq";
}

type ChaveTranscricao = ChaveIA & {
  provedor: ProvedorTranscricao;
  modeloTranscricao: string;
  status: StatusChave;
};

/** A chave que transcreve, na ordem da spec, com o modelo de transcrição. null = nenhuma. */
async function chaveDeTranscricao(): Promise<ChaveTranscricao | null> {
  const propria = await lerChaveUtilizavel("transcricao");
  if (propria.ok && ehTranscritor(propria.chave.provedor)) {
    const provedor = propria.chave.provedor;
    const escolhido = (propria.chave.modelo ?? "").trim();
    return {
      ...propria.chave,
      provedor,
      modeloTranscricao: escolhido || MODELOS_TRANSCRICAO[provedor],
      status: propria.status,
    };
  }
  // a ElevenLabs no cartão Escuta: o Scribe, sem escolha de modelo (docs/spec-escuta-elevenlabs.md S3)
  if (propria.ok && propria.chave.provedor === "elevenlabs") {
    return {
      ...propria.chave,
      provedor: "elevenlabs",
      modeloTranscricao: MODELO_ESCUTA_ELEVENLABS,
      status: propria.status,
    };
  }
  const resposta = await lerChaveUtilizavel("resposta");
  if (
    resposta.ok &&
    (resposta.chave.provedor === "openai" || resposta.chave.provedor === "openrouter")
  ) {
    const provedor = resposta.chave.provedor;
    return {
      ...resposta.chave,
      provedor,
      modeloTranscricao: MODELOS_TRANSCRICAO[provedor],
      status: resposta.status,
    };
  }
  // por último, a chave da voz: a ElevenLabs também transcreve (Scribe v2)
  const voz = await lerChaveUtilizavel("voz");
  if (voz.ok && voz.chave.provedor === "elevenlabs") {
    return {
      ...voz.chave,
      provedor: "elevenlabs",
      modeloTranscricao: MODELO_ESCUTA_ELEVENLABS,
      status: voz.status,
    };
  }
  return null;
}

// base64 sem Buffer (o Worker pode não ter nodejs_compat), em pedaços para não estourar a pilha
export function paraBase64(bytes: Uint8Array): string {
  let binario = "";
  const pedaco = 0x8000;
  for (let i = 0; i < bytes.length; i += pedaco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + pedaco));
  }
  return btoa(binario);
}

type RespostaProvedor = {
  texto: string;
  segundos: number | null;
  custoInformado: unknown;
  usoBruto: unknown;
  requestId: string | null;
};

type FalhaProvedor = {
  falha: true;
  status: number | null;
  semCredito?: boolean;
  /** só na ElevenLabs: o 401 com detail.status de permissão (a chave sem Speech to Text) */
  semPermissao?: boolean;
  /** 408, 409, 429, 5xx, rede ou tempo: vale tentar de novo mais tarde */
  passageira?: boolean;
};

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Duração na ElevenLabs: audio_duration_secs ou, sem ele, o end da última palavra. */
function segundosElevenLabs(json: Record<string, unknown>): number | null {
  const informado = numero(json["audio_duration_secs"]);
  if (informado !== null) return informado;
  const palavras = json["words"];
  if (!Array.isArray(palavras) || palavras.length === 0) return null;
  const ultima = palavras[palavras.length - 1] as { end?: unknown } | null;
  return numero(ultima?.end);
}

function ehPassageiro(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function ehTempo(erro: unknown): boolean {
  const nome = (erro as { name?: unknown })?.name;
  return nome === "TimeoutError" || nome === "AbortError";
}

/** Espera antes da próxima tentativa: retry-after(-ms) do provedor ou 0,5 s, 1 s... */
function esperaMs(tentativa: number, cabecalhos: Headers | null): number {
  const ms = Number(cabecalhos?.get("retry-after-ms") ?? NaN);
  if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, ESPERA_MAX_MS);
  const seg = Number(cabecalhos?.get("retry-after") ?? NaN);
  if (Number.isFinite(seg) && seg >= 0) return Math.min(seg * 1000, ESPERA_MAX_MS);
  return ESPERA_BASE_MS * 2 ** tentativa;
}

function dormir(ms: number): Promise<void> {
  return new Promise((ok) => setTimeout(ok, ms));
}

const MAX_CORPO_ERRO = 8_000;

/** Corpo do erro, só para classificar (nunca vai para log), cortado. */
async function corpoDoErro(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, MAX_CORPO_ERRO);
  } catch {
    return "";
  }
}

/** O detail.status de um erro da ElevenLabs ({ detail: { status, message } }), em minúsculas. */
function statusElevenLabs(corpo: string): string {
  try {
    const json = JSON.parse(corpo) as { detail?: { status?: unknown } } | null;
    const status = json?.detail?.status;
    return typeof status === "string" ? status.toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * 402 (fora o "em voo" da OpenRouter) ou cota/saldo esgotado no corpo: não adianta repetir. Na
 * ElevenLabs, a cota esgotada vem como 401 com detail.status "quota_exceeded".
 */
function ehSemCredito(provedor: ProvedorTranscricao, status: number, corpo: string): boolean {
  if (provedor === "elevenlabs") {
    return status === 402 || (status === 401 && statusElevenLabs(corpo).includes("quota"));
  }
  const erro = new APICallError({
    message: "",
    url: URLS[provedor],
    requestBodyValues: {},
    statusCode: status,
    responseBody: corpo,
  });
  return classificarErroIA(erro, provedor).statusChave === "sem_credito";
}

async function pedir(
  provedor: ProvedorTranscricao,
  modelo: string,
  chave: string,
  bytes: Uint8Array,
  mime: string,
  formato: string,
  fimEm?: number,
): Promise<RespostaProvedor | FalhaProvedor> {
  // a ElevenLabs usa o cabeçalho xi-api-key, sem Authorization
  const cabecalhos: Record<string, string> =
    provedor === "elevenlabs" ? { "xi-api-key": chave } : { Authorization: `Bearer ${chave}` };
  let corpo: BodyInit;
  if (provedor === "elevenlabs") {
    const form = new FormData();
    form.append("file", new Blob([bytes.slice()], { type: mime }), `audio.${formato}`);
    form.append("model_id", modelo);
    corpo = form;
  } else if (provedor === "openrouter") {
    cabecalhos["Content-Type"] = "application/json";
    corpo = JSON.stringify({
      model: modelo,
      input_audio: { data: paraBase64(bytes), format: formato },
    });
  } else {
    const form = new FormData();
    form.append("file", new Blob([bytes.slice()], { type: mime }), `audio.${formato}`);
    form.append("model", modelo);
    // a Groq só devolve a duração no verbose_json; na OpenAI vem em usage.seconds
    form.append("response_format", provedor === "groq" ? "verbose_json" : "json");
    corpo = form;
  }

  // tentativas dentro do mesmo prazo total: 60 s, cortado pelo prazo do worker
  const inicio = Date.now();
  const tempoTotal = tempoAte(TEMPO_MS, fimEm);
  let resp: Response | null = null;
  for (let tentativa = 0; ; tentativa++) {
    const restante = tempoTotal - (Date.now() - inicio);
    if (restante <= 0) return { falha: true, status: null, passageira: true };
    let espera: number;
    try {
      resp = await fetch(URLS[provedor], {
        method: "POST",
        headers: cabecalhos,
        body: corpo,
        // a ElevenLabs leva a chave no xi-api-key, que o fetch não tira num
        // redirecionamento para outro domínio: um 3xx vira falha sem marcar a chave
        ...(provedor === "elevenlabs" ? { redirect: "manual" as const } : {}),
        signal: AbortSignal.timeout(restante),
      });
      if (resp.ok) break;
      const corpoErro = await corpoDoErro(resp);
      if (ehSemCredito(provedor, resp.status, corpoErro)) {
        return { falha: true, status: resp.status, semCredito: true };
      }
      if (
        provedor === "elevenlabs" &&
        resp.status === 401 &&
        statusElevenLabs(corpoErro).includes("permission")
      ) {
        return { falha: true, status: resp.status, semPermissao: true };
      }
      if (!ehPassageiro(resp.status)) return { falha: true, status: resp.status };
      if (tentativa >= MAX_REPETICOES_TRANSCRICAO) {
        return { falha: true, status: resp.status, passageira: true };
      }
      espera = esperaMs(tentativa, resp.headers);
    } catch (erro) {
      // tempo esgotado gastou o prazo; erro de rede repete
      if (ehTempo(erro) || tentativa >= MAX_REPETICOES_TRANSCRICAO) {
        return { falha: true, status: null, passageira: true };
      }
      espera = esperaMs(tentativa, null);
    }
    if (espera >= tempoTotal - (Date.now() - inicio)) {
      return { falha: true, status: resp?.status ?? null, passageira: true };
    }
    await dormir(espera);
  }

  const json = (await resp.json()) as Record<string, unknown>;
  const texto = typeof json["text"] === "string" ? json["text"].trim() : "";
  const uso = (json["usage"] ?? null) as Record<string, unknown> | null;
  const segundos =
    provedor === "elevenlabs"
      ? segundosElevenLabs(json)
      : (numero(uso?.["seconds"]) ?? numero(json["duration"]));
  return {
    texto,
    segundos,
    custoInformado: uso?.["cost"],
    usoBruto: uso,
    requestId:
      resp.headers.get("x-request-id") ??
      resp.headers.get("x-generation-id") ??
      resp.headers.get("request-id"),
  };
}

export async function transcrever(
  bytes: Uint8Array,
  mime: string,
  opcoes: OpcoesTranscricao = {},
): Promise<ResultadoTranscricao> {
  try {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES_AUDIO) return SEM_TRANSCRICAO;
    const formato = formatoDoMime(mime);
    if (!formato) return SEM_TRANSCRICAO;

    const chave = await chaveDeTranscricao();
    if (!chave) return SEM_TRANSCRICAO;

    const modelo = chave.modeloTranscricao;
    const r = await pedir(chave.provedor, modelo, chave.chave, bytes, mime, formato, opcoes.fimEm);
    if ("falha" in r) {
      // o sem crédito vem antes: na ElevenLabs, a cota esgotada também é um 401
      if (r.semCredito) await marcarStatusChave(chave.id, "sem_credito", `http_${r.status}`);
      else if (r.semPermissao) await marcarStatusChave(chave.id, "invalida", "sem_permissao");
      else if (r.status === 401) await marcarStatusChave(chave.id, "invalida", "http_401");
      return r.passageira ? PASSAGEIRO : SEM_TRANSCRICAO;
    }
    // o admin recarregou o saldo: a chave volta a ativa
    if (chave.status === "sem_credito") await reativarChave(chave.id);

    let custo: Custo;
    if (chave.provedor === "openrouter") {
      custo = custoDoProvedor(r.custoInformado);
    } else {
      const precos = await carregarPrecos(chave.provedor, modelo);
      custo = custoDeAudio(chave.provedor, precos, r.segundos);
    }
    await gravarChamadas([
      {
        tipo: "transcricao",
        rodada_id: opcoes.rodadaId ?? null,
        conversa_id: opcoes.conversaId ?? null,
        provedor: chave.provedor,
        modelo,
        segundos_audio: r.segundos,
        custo_usd: custo.custo_usd,
        custo_origem: custo.custo_origem,
        preco_id: custo.preco_id,
        request_id: r.requestId,
        uso_bruto: limparUsoBruto(r.usoBruto),
      },
    ]);
    // áudio mudo: cobrado (a linha acima), mas sem texto para a Janete
    if (!r.texto) return SEM_TRANSCRICAO;
    return { texto: r.texto };
  } catch {
    return SEM_TRANSCRICAO;
  }
}
