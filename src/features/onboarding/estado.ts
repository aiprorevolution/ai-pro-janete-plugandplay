import { useCallback, useMemo, useSyncExternalStore } from "react";

// Contrato único: os campos do Contexto vêm do roteiro (F2), e Gateway e ProvedorIA vêm das
// funções de servidor da F2. Os tipos entram com `import type` (somem no build), para não levar
// a lógica de servidor para o navegador.
import type { GatewayOnboarding, GravadoOnboarding } from "@/features/plataforma/dados/onboarding";
// dados/tipos.ts só tem `import type`: trazer o cortarLetras não leva nenhum módulo de servidor
import { cortarLetras } from "@/features/plataforma/dados/tipos";
import type { ProvedorIA } from "@/features/servidor/chave-ia";

import { CAMPOS_CONTEXTO, type CampoContexto } from "./roteiro";

export { CAMPOS_CONTEXTO };
export type { CampoContexto, ProvedorIA };

/** Os gateways do onboarding: os da função de servidor, sem o conector do Descontinuado (decisão 14a). */
export type Gateway = GatewayOnboarding;

/** O limite de cada resposta do Contexto, o mesmo do banco (contexto_salvar, decisão 11). */
export const LIMITE_RESPOSTA_CONTEXTO = 2000;

/**
 * Estado do onboarding da Janete na aba (sessionStorage): a etapa atual e o que a tela mostra. O que
 * vale é o banco (C8): a conexão, a chave e o Contexto são gravados pelas etapas, o "concluído" é
 * configuracao.onboarding_concluido_em (concluir_onboarding), e ao abrir a aba junta com o que já foi
 * gravado (juntarComGravado, decisão 14d).
 *
 * Regra de segurança: aqui NUNCA entra chave de IA nem credencial de gateway. Elas só passam pelas
 * funções de servidor; do resultado, guardamos só o `ultimos4` da chave e o `rotulo` da conexão.
 * Por isso a gravação monta um objeto novo campo a campo (lista branca), em vez de gravar o que vier.
 */

export type Etapa = "conexao" | "cerebro" | "despertar" | "voz" | "conversa" | "preparando";

export const ETAPAS: readonly Etapa[] = ["conexao", "cerebro", "despertar", "voz", "conversa", "preparando"];

export type ModoConexao = "oficial" | "naooficial";

export type Respostas = Partial<Record<CampoContexto, string>>;

/**
 * Etapa conexão: só a escolha e o rótulo que o servidor devolveu (número ou instância).
 * `rotulo` só pode receber o `nome` que veio de salvarConexao (ou o gravado no banco): o filtro de prefixos abaixo
 * não reconhece tokens sem prefixo (Z-API, Evolution), então nada digitado pela pessoa entra aqui.
 */
export interface EscolhasConexao {
  modo: ModoConexao | null;
  gateway: Gateway | null;
  rotulo: string | null;
}

/** Etapa cérebro: motor, modelo e os 4 últimos caracteres da chave aceita. */
export interface EscolhasCerebro {
  provedor: ProvedorIA | null;
  modelo: string | null;
  ultimos4: string | null;
}

/**
 * Etapa voz: os 4 últimos caracteres da chave da ElevenLabs aceita e se a pessoa escolheu "Fazer
 * depois". A voz é opcional: nunca trava o onboarding.
 */
export interface EscolhasVoz {
  ultimos4: string | null;
  pulou: boolean;
}

/** Etapa conversa: as respostas do roteiro e se o painel "O que eu já sei" foi confirmado. */
export interface EscolhasConversa {
  respostas: Respostas;
  confirmado: boolean;
}

export interface EstadoOnboarding {
  etapa: Etapa;
  conexao: EscolhasConexao;
  cerebro: EscolhasCerebro;
  voz: EscolhasVoz;
  conversa: EscolhasConversa;
  /** Quando o onboarding terminou (ISO 8601); null enquanto não terminou. */
  concluidoEm: string | null;
}

export const CHAVE_SESSION_STORAGE = "janete:onboarding:v1";

export const ESTADO_INICIAL: EstadoOnboarding = {
  etapa: "conexao",
  conexao: { modo: null, gateway: null, rotulo: null },
  cerebro: { provedor: null, modelo: null, ultimos4: null },
  voz: { ultimos4: null, pulou: false },
  conversa: { respostas: {}, confirmado: false },
  concluidoEm: null,
};

const MODOS: readonly ModoConexao[] = ["oficial", "naooficial"];
// Listas de valores aceitos na leitura. Ficam aqui (e não importadas da F2) para o navegador não
// carregar os módulos de servidor; o `ListaCompleta` faz o tsc falhar se a F2 ganhar ou perder um
// gateway ou provedor e esta lista não acompanhar.
type ListaCompleta<T extends string, L extends readonly T[]> = [T] extends [L[number]] ? L : never;
const GATEWAYS_ACEITOS = ["meta", "zernio", "zapi", "evolution"] as const satisfies readonly Gateway[];
const PROVEDORES_ACEITOS = ["anthropic", "openai", "openrouter", "gemini"] as const satisfies readonly ProvedorIA[];
const GATEWAYS: ListaCompleta<Gateway, typeof GATEWAYS_ACEITOS> = GATEWAYS_ACEITOS;
const PROVEDORES: ListaCompleta<ProvedorIA, typeof PROVEDORES_ACEITOS> = PROVEDORES_ACEITOS;
const LIMITE_TEXTO_CURTO = 120;
const LIMITE_RESPOSTA = LIMITE_RESPOSTA_CONTEXTO;

// Prefixos de chaves e tokens dos provedores e gateways (Anthropic, OpenAI, OpenRouter, Meta) e de
// cabeçalhos de autorização. Um texto curto (modelo, rótulo) que comece assim é descartado.
const PREFIXOS_DE_SEGREDO = /^(sk-|sk_|rk-|pk-|eaa[a-z0-9]|bearer\s|basic\s)/i;

function umDe<T extends string>(valor: unknown, opcoes: readonly T[]): T | null {
  return typeof valor === "string" && (opcoes as readonly string[]).includes(valor) ? (valor as T) : null;
}

function textoCurto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  if (!limpo || limpo.length > LIMITE_TEXTO_CURTO || PREFIXOS_DE_SEGREDO.test(limpo)) return null;
  return limpo;
}

/** Só os 4 últimos caracteres, mesmo que alguém passe a chave inteira por engano. */
function ultimos4(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo.slice(-4) : null;
}

function respostas(valor: unknown): Respostas {
  const saida: Respostas = {};
  if (typeof valor !== "object" || valor === null) return saida;
  const origem = valor as Record<string, unknown>;
  for (const campo of CAMPOS_CONTEXTO) {
    const texto = origem[campo];
    // cortado por letra (ponto de código, como o banco conta): nunca parte um emoji ao meio
    if (typeof texto === "string") saida[campo] = cortarLetras(texto, LIMITE_RESPOSTA);
  }
  return saida;
}

function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {};
}

/**
 * Monta um estado válido a partir de qualquer coisa (o que veio do sessionStorage ou de quem chamou),
 * copiando só os campos permitidos. Tudo o que não está na lista branca some, inclusive chaves.
 */
export function sanearEstado(valor: unknown): EstadoOnboarding {
  const bruto = objeto(valor);
  const conexao = objeto(bruto["conexao"]);
  const cerebro = objeto(bruto["cerebro"]);
  const voz = objeto(bruto["voz"]);
  const conversa = objeto(bruto["conversa"]);
  const concluidoEm = bruto["concluidoEm"];
  return {
    etapa: umDe(bruto["etapa"], ETAPAS) ?? ESTADO_INICIAL.etapa,
    conexao: {
      modo: umDe(conexao["modo"], MODOS),
      gateway: umDe(conexao["gateway"], GATEWAYS),
      rotulo: textoCurto(conexao["rotulo"]),
    },
    cerebro: {
      provedor: umDe(cerebro["provedor"], PROVEDORES),
      modelo: textoCurto(cerebro["modelo"]),
      ultimos4: ultimos4(cerebro["ultimos4"]),
    },
    voz: {
      ultimos4: ultimos4(voz["ultimos4"]),
      pulou: voz["pulou"] === true,
    },
    conversa: {
      respostas: respostas(conversa["respostas"]),
      confirmado: conversa["confirmado"] === true,
    },
    concluidoEm:
      typeof concluidoEm === "string" && !Number.isNaN(Date.parse(concluidoEm)) ? concluidoEm : null,
  };
}

/* ---------- armazenamento: o sessionStorage pode faltar (servidor) ou recusar (modo privado) ---------- */

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

let cacheBruto: string | null | undefined;
let cacheEstado: EstadoOnboarding = ESTADO_INICIAL;
// Ligado quando o sessionStorage recusou a gravação: o estado passa a valer só em memória, nesta página.
let soMemoria = false;
const ouvintes = new Set<() => void>();

/** Lê o estado da aba. Devolve sempre o mesmo objeto enquanto o que está gravado não muda. */
export function lerEstadoOnboarding(): EstadoOnboarding {
  if (soMemoria) return cacheEstado;
  let bruto: string | null = null;
  try {
    bruto = storage()?.getItem(CHAVE_SESSION_STORAGE) ?? null;
  } catch {
    bruto = null;
  }
  if (bruto === cacheBruto) return cacheEstado;
  cacheBruto = bruto;
  if (bruto === null) {
    cacheEstado = ESTADO_INICIAL;
    return cacheEstado;
  }
  try {
    cacheEstado = sanearEstado(JSON.parse(bruto));
  } catch {
    cacheEstado = ESTADO_INICIAL;
  }
  return cacheEstado;
}

function avisar() {
  for (const ouvinte of ouvintes) ouvinte();
}

export function gravarEstadoOnboarding(proximo: EstadoOnboarding): void {
  // No servidor o módulo é compartilhado entre as requisições: lá nada é gravado, nem em memória.
  if (typeof window === "undefined") return;
  const limpo = sanearEstado(proximo);
  const bruto = JSON.stringify(limpo);
  try {
    const alvo = storage();
    if (!alvo) throw new Error("sem sessionStorage");
    alvo.setItem(CHAVE_SESSION_STORAGE, bruto);
    cacheBruto = bruto;
    soMemoria = false;
  } catch {
    // Sem sessionStorage (modo privado, cota cheia): o estado vale só enquanto a página estiver aberta.
    soMemoria = true;
  }
  cacheEstado = limpo;
  avisar();
}

export function limparEstadoOnboarding(): void {
  try {
    storage()?.removeItem(CHAVE_SESSION_STORAGE);
  } catch {
    // nada a limpar
  }
  cacheBruto = null;
  cacheEstado = ESTADO_INICIAL;
  soMemoria = false;
  avisar();
}

export function onboardingConcluido(): boolean {
  return lerEstadoOnboarding().concluidoEm !== null;
}

/** true quando esta aba já guardou o estado do onboarding (a pessoa estava no meio, nesta aba). */
export function temEstadoNaAba(): boolean {
  if (soMemoria) return true;
  try {
    return storage()?.getItem(CHAVE_SESSION_STORAGE) != null;
  } catch {
    return false;
  }
}

const MODO_DO_GATEWAY: Record<Gateway, ModoConexao> = {
  meta: "oficial",
  zernio: "oficial",
  zapi: "naooficial",
  evolution: "naooficial",
};

/**
 * Quem sai no meio recomeça do que já foi gravado (decisão 14d). O banco vale sobre a aba:
 * - conexão e cérebro: os do banco (a conexão ativa e a chave de resposta ativa), ou vazios;
 * - voz: a chave de voz do banco (o "pulou" zera); sem ela, o "pulou" que a aba tinha. A voz é
 *   opcional e nunca entra no que falta: quem abre uma aba nova sem Contexto volta ao despertar e
 *   passa pela Voz de novo;
 * - conversa: com Contexto gravado, as respostas dele, já confirmadas; sem ele, as respostas que a
 *   aba ainda tinha (a conversa em andamento não vai ao banco antes do "Pode montar"), sem confirmar;
 * - etapa: a primeira que falta gravar. Se a aba estava num ponto anterior (a pessoa voltou para
 *   trocar algo), fica ali. Sem estado na aba, o recomeço da conversa é pelo despertar.
 */
export function juntarComGravado(aba: EstadoOnboarding, temAba: boolean, g: GravadoOnboarding): EstadoOnboarding {
  const conexao: EscolhasConexao = g.conexao
    ? { modo: MODO_DO_GATEWAY[g.conexao.gateway], gateway: g.conexao.gateway, rotulo: g.conexao.nome }
    : { modo: aba.conexao.rotulo ? null : aba.conexao.modo, gateway: aba.conexao.rotulo ? null : aba.conexao.gateway, rotulo: null };
  const cerebro: EscolhasCerebro = g.cerebro
    ? { provedor: g.cerebro.provedor, modelo: g.cerebro.modelo, ultimos4: g.cerebro.ultimos4 }
    : { provedor: aba.cerebro.ultimos4 ? null : aba.cerebro.provedor, modelo: aba.cerebro.ultimos4 ? null : aba.cerebro.modelo, ultimos4: null };
  const voz: EscolhasVoz = g.voz ? { ultimos4: g.voz.ultimos4, pulou: false } : { ultimos4: null, pulou: aba.voz.pulou };
  const conversa: EscolhasConversa = g.contexto
    ? { respostas: { ...g.contexto.respostas }, confirmado: true }
    : { respostas: aba.conversa.respostas, confirmado: false };

  const falta: Etapa = !g.conexao ? "conexao" : !g.cerebro ? "cerebro" : !g.contexto ? (temAba ? "conversa" : "despertar") : "preparando";
  const etapa = temAba && ETAPAS.indexOf(aba.etapa) < ETAPAS.indexOf(falta) ? aba.etapa : falta;
  return sanearEstado({ etapa, conexao, cerebro, voz, conversa, concluidoEm: null });
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function atualizar(mudar: (atual: EstadoOnboarding) => EstadoOnboarding) {
  gravarEstadoOnboarding(mudar(lerEstadoOnboarding()));
}

/* ---------- hook ---------- */

export interface UseOnboarding {
  estado: EstadoOnboarding;
  etapa: Etapa;
  /** Posição da etapa atual, de 0 a 5. */
  indice: number;
  primeira: boolean;
  ultima: boolean;
  irPara: (etapa: Etapa) => void;
  /** Vai para a próxima etapa; na última não faz nada (quem conclui é `concluir`). */
  avancar: () => void;
  /** Volta para a etapa anterior; na primeira não faz nada. */
  voltar: () => void;
  definirConexao: (escolhas: Partial<EscolhasConexao>) => void;
  definirCerebro: (escolhas: Partial<EscolhasCerebro>) => void;
  definirVoz: (escolhas: Partial<EscolhasVoz>) => void;
  responder: (campo: CampoContexto, valor: string) => void;
  /** Troca as respostas de uma vez (o painel "O que eu já sei" editado). */
  definirRespostas: (respostas: Respostas) => void;
  confirmarContexto: () => void;
  concluir: () => void;
  recomecar: () => void;
}

/**
 * Estado do onboarding compartilhado por todos os componentes da aba (cada etapa pode chamar o hook).
 * No servidor e na primeira pintura no navegador vale o estado inicial; o gravado entra logo depois.
 */
export function useOnboarding(): UseOnboarding {
  const estado = useSyncExternalStore(assinar, lerEstadoOnboarding, () => ESTADO_INICIAL);
  const indice = ETAPAS.indexOf(estado.etapa);

  const irPara = useCallback((etapa: Etapa) => atualizar((atual) => ({ ...atual, etapa })), []);
  const avancar = useCallback(
    () =>
      atualizar((atual) => {
        const proxima = ETAPAS[ETAPAS.indexOf(atual.etapa) + 1];
        return proxima ? { ...atual, etapa: proxima } : atual;
      }),
    [],
  );
  const voltar = useCallback(
    () =>
      atualizar((atual) => {
        const anterior = ETAPAS[ETAPAS.indexOf(atual.etapa) - 1];
        return anterior ? { ...atual, etapa: anterior } : atual;
      }),
    [],
  );
  const definirConexao = useCallback(
    (escolhas: Partial<EscolhasConexao>) =>
      atualizar((atual) => ({
        ...atual,
        conexao: {
          modo: "modo" in escolhas ? (escolhas.modo ?? null) : atual.conexao.modo,
          gateway: "gateway" in escolhas ? (escolhas.gateway ?? null) : atual.conexao.gateway,
          rotulo: "rotulo" in escolhas ? (escolhas.rotulo ?? null) : atual.conexao.rotulo,
        },
      })),
    [],
  );
  const definirCerebro = useCallback(
    (escolhas: Partial<EscolhasCerebro>) =>
      atualizar((atual) => ({
        ...atual,
        cerebro: {
          provedor: "provedor" in escolhas ? (escolhas.provedor ?? null) : atual.cerebro.provedor,
          modelo: "modelo" in escolhas ? (escolhas.modelo ?? null) : atual.cerebro.modelo,
          ultimos4: "ultimos4" in escolhas ? (escolhas.ultimos4 ?? null) : atual.cerebro.ultimos4,
        },
      })),
    [],
  );
  const definirVoz = useCallback(
    (escolhas: Partial<EscolhasVoz>) =>
      atualizar((atual) => ({
        ...atual,
        voz: {
          ultimos4: "ultimos4" in escolhas ? (escolhas.ultimos4 ?? null) : atual.voz.ultimos4,
          pulou: "pulou" in escolhas ? escolhas.pulou === true : atual.voz.pulou,
        },
      })),
    [],
  );
  const responder = useCallback(
    (campo: CampoContexto, valor: string) =>
      atualizar((atual) => ({
        ...atual,
        conversa: { ...atual.conversa, respostas: { ...atual.conversa.respostas, [campo]: valor } },
      })),
    [],
  );
  const definirRespostas = useCallback(
    (novas: Respostas) =>
      atualizar((atual) => ({ ...atual, conversa: { ...atual.conversa, respostas: { ...novas } } })),
    [],
  );
  const confirmarContexto = useCallback(
    () => atualizar((atual) => ({ ...atual, conversa: { ...atual.conversa, confirmado: true } })),
    [],
  );
  const concluir = useCallback(
    () => atualizar((atual) => ({ ...atual, concluidoEm: new Date().toISOString() })),
    [],
  );
  const recomecar = useCallback(() => limparEstadoOnboarding(), []);

  return useMemo(
    () => ({
      estado,
      etapa: estado.etapa,
      indice,
      primeira: indice === 0,
      ultima: indice === ETAPAS.length - 1,
      irPara,
      avancar,
      voltar,
      definirConexao,
      definirCerebro,
      definirVoz,
      responder,
      definirRespostas,
      confirmarContexto,
      concluir,
      recomecar,
    }),
    [
      estado,
      indice,
      irPara,
      avancar,
      voltar,
      definirConexao,
      definirCerebro,
      definirVoz,
      responder,
      definirRespostas,
      confirmarContexto,
      concluir,
      recomecar,
    ],
  );
}
