// As leituras da Configuração: o que a camada de dados entrega (dados/configuracao.ts) vira a
// situação de cada peça. Todas puras, para a tela e os testes contarem a mesma história.

import { MODELOS, precoTexto, type ModeloIA } from "@/features/ia/modelos";
import { MOTORES, type Motor, type Provedor } from "@/features/onboarding/lista/dados";
import { MODOS_VOZ, MODO_VOZ_PADRAO, type ModoVoz, type VozEscolhida } from "@/features/servidor/vozes-tipos";

import { diasEntre, horaCurta, dataCurta, type Instante } from "../comum/tempo";
import { MOTOR_ATRASADO_APOS_MS, type PendenciasMotor } from "../dados/tipos";
import type { ChaveIA, Conexao, Configuracao, EstadoExemplo, ProvedorIA, StatusChave, StatusConexao } from "../exemplo";
import { acharTranscritor, provDe, type Transcritor } from "./dados";
import { textoErroConexao } from "./textos";

/* ---------- WhatsApp ---------- */

export interface LeituraW {
  conexao: Conexao | null;
  prov: Provedor | null;
  /** Sem conexão ou com a conexão desativada conta como "desconectada". */
  situacao: StatusConexao;
  /** Desconectado de propósito (pela Configuração) ou nunca conectado: o conserto é conectar de novo. */
  manual: boolean;
  /** O número (o `nome` da conexão), ou vazio sem conexão. */
  numero: string;
  /** O motivo da queda, em linguagem simples. */
  erro: string;
  ok: boolean;
  conectando: boolean;
}

/**
 * A conexão chega da camada de dados: a ativa, ou a desligada pela Configuração (o evento
 * `ativa_para false` em conexao_eventos; sem ele, a inativa nem chega). `voce`: quem desligou foi quem
 * lê ("Você desconectou…"); senão, terceira pessoa. A ativa que caiu (desconectada ou com erro) é
 * queda do provedor: o motivo vem do código em `ultimo_erro`, traduzido.
 */
export function lerWhats(conexao: Conexao | null, voce = true): LeituraW {
  const prov = conexao ? provDe(conexao.gateway) : null;
  if (!conexao || !prov) {
    return { conexao: null, prov: null, situacao: "desconectada", manual: true, numero: "", erro: "", ok: false, conectando: false };
  }
  const ativa = conexao.ativa;
  const situacao: StatusConexao = ativa ? conexao.status : "desconectada";
  const manual = !ativa;
  let erro = "";
  if (manual) erro = voce ? "Você desconectou este número pela Configuração." : "Este número foi desconectado pela Configuração.";
  else if (situacao === "desconectada" || situacao === "erro") erro = textoErroConexao(conexao.ultimo_erro, conexao.gateway, situacao);
  return {
    conexao,
    prov,
    situacao,
    manual,
    numero: conexao.nome,
    erro,
    ok: situacao === "conectada",
    conectando: situacao === "conectando",
  };
}

/* ---------- cérebro ---------- */

/** O motor do cérebro (o banco aceita também "groq", que não responde: fica sem motor). */
export function motorDe(provedor: ProvedorIA | null | undefined): Motor | null {
  return MOTORES.find((m) => m.id === provedor) ?? null;
}

/** O modelo da lista curada (src/features/ia/modelos.ts). */
export function modeloDe(provedor: ProvedorIA | null | undefined, id: string | null | undefined): ModeloIA | undefined {
  return MODELOS.find((m) => m.provedor === provedor && m.id === id);
}

export interface LeituraC {
  /**
   * A tela sabe a situação da chave. Como no banco (ia_chaves_admin_le), a atendente não lê as
   * chaves: o provedor do exemplo entrega a lista vazia, e a situação fica desconhecida para ela.
   */
  conhecida: boolean;
  chave: ChaveIA | null;
  /** Sem chave de resposta = "removida" (a Janete está sem cérebro). */
  situacao: StatusChave;
  motor: Motor | null;
  modelo: ModeloIA | undefined;
  /** O nome do modelo (o da lista curada; senão o id como foi gravado). */
  nomeModelo: string;
  /** "US$ 0,10 / 0,50 por 1M tokens", vazio quando o modelo não está na lista curada. */
  preco: string;
  ok: boolean;
}

export function lerCerebro(estado: Pick<EstadoExemplo, "chaves">, admin: boolean): LeituraC {
  const chave = estado.chaves.find((c) => c.finalidade === "resposta") ?? null;
  const conhecida = admin || estado.chaves.length > 0;
  const situacao: StatusChave = chave ? chave.status : "removida";
  const motor = chave ? motorDe(chave.provedor) : null;
  const modelo = chave ? modeloDe(chave.provedor, chave.modelo) : undefined;
  return {
    conhecida,
    chave,
    situacao,
    motor,
    modelo,
    nomeModelo: modelo?.nome ?? chave?.modelo ?? "",
    preco: modelo ? `US$ ${precoTexto(modelo)} por 1M tokens` : "",
    ok: conhecida && situacao === "ativa",
  };
}

/* ---------- escuta de áudio ---------- */

export interface LeituraE {
  conhecida: boolean;
  /**
   * A chave só de áudio (finalidade "transcricao"), como está guardada. Inválida, o servidor a pula
   * e segue a ordem (o cérebro que transcreve, depois a voz): `viaCerebro` e `viaVoz` dizem isso.
   */
  chave: ChaveIA | null;
  transcritor: Transcritor | null;
  /**
   * Sem chave só de áudio, a transcrição usa a chave do cérebro quando ela é da OpenAI ou da
   * OpenRouter e está ativa (o que o servidor já faz, transcrever.server.ts; decisão 10a).
   */
  viaCerebro: boolean;
  /** O nome de quem transcreve pela chave do cérebro ("OpenAI", "OpenRouter"). */
  nomeViaCerebro: string;
  /**
   * Sem chave só de áudio e sem cérebro que transcreve em uso, a transcrição usa a chave da voz
   * (ElevenLabs, Scribe), se ela estiver em uso: a mesma ordem do servidor (P14 da spec do uso da
   * voz; transcrever.server.ts).
   */
  viaVoz: boolean;
  /**
   * O cérebro em uso (até sem crédito) é da OpenAI ou da OpenRouter: o servidor tenta ele antes da
   * voz, então a chave da ElevenLabs não transcreve enquanto ele estiver ali.
   */
  cerebroTranscreve: boolean;
  /**
   * A escuta e a voz guardam a mesma chave da ElevenLabs (P5 da spec da escuta com a ElevenLabs): o
   * cartão diz "Mesma chave da Voz da Janete".
   */
  mesmaChaveDaVoz: boolean;
  ok: boolean;
}

/**
 * As linhas "transcricao" e "voz" são ambas da ElevenLabs, as duas têm chave (não removida, com os 4
 * últimos) e os 4 últimos são iguais (P5). Duas chaves diferentes com o mesmo final contam como a
 * mesma (raríssimo, limite conhecido da spec).
 */
function mesmaChaveElevenLabs(chaves: readonly ChaveIA[]): boolean {
  const comChave = (f: ChaveIA["finalidade"]) => {
    const c = chaves.find((k) => k.finalidade === f) ?? null;
    return c && c.provedor === "elevenlabs" && c.status !== "removida" && c.ultimos4 ? c : null;
  };
  const esc = comChave("transcricao");
  const voz = comChave("voz");
  return !!esc && !!voz && esc.ultimos4 === voz.ultimos4;
}

/** Os provedores do cérebro que também transcrevem (transcrever.server.ts). */
const CEREBRO_TRANSCREVE: Partial<Record<ProvedorIA, string>> = { openai: "OpenAI", openrouter: "OpenRouter" };

/** Em uso para o servidor: nem removida nem inválida (lerChaveUtilizavel; sem crédito ainda conta). */
function emUso(c: ChaveIA | null): c is ChaveIA {
  return !!c && c.status !== "removida" && c.status !== "invalida";
}

export function lerEscuta(estado: Pick<EstadoExemplo, "chaves">, admin: boolean): LeituraE {
  const chave = estado.chaves.find((c) => c.finalidade === "transcricao") ?? null;
  const cerebro = estado.chaves.find((c) => c.finalidade === "resposta") ?? null;
  const voz = estado.chaves.find((c) => c.finalidade === "voz") ?? null;
  // a ordem do servidor (transcrever.server.ts): a chave só de áudio em uso; senão, o cérebro que
  // transcreve; senão, a voz. A chave só de áudio inválida não conta (lerChaveUtilizavel a pula).
  const propria = emUso(chave) ? chave : null;
  const viaCerebro = !propria && !!cerebro && cerebro.status === "ativa" && !!CEREBRO_TRANSCREVE[cerebro.provedor];
  // o cérebro que transcreve e está em uso (até sem crédito) vem antes da voz no servidor
  const cerebroTranscreve = emUso(cerebro) && !!CEREBRO_TRANSCREVE[cerebro.provedor];
  const viaVoz = !propria && !cerebroTranscreve && emUso(voz);
  return {
    conhecida: admin || estado.chaves.length > 0,
    chave,
    transcritor: chave ? acharTranscritor(chave.provedor) : null,
    viaCerebro,
    nomeViaCerebro: viaCerebro && cerebro ? (CEREBRO_TRANSCREVE[cerebro.provedor] ?? "") : "",
    viaVoz,
    cerebroTranscreve,
    mesmaChaveDaVoz: mesmaChaveElevenLabs(estado.chaves),
    ok: propria ? propria.status === "ativa" : viaCerebro || (viaVoz && voz?.status === "ativa"),
  };
}

/** O aviso do cérebro sem escuta (decisão 1 das lacunas da mensageria): o mesmo no cartão e no onboarding. */
export const AVISO_ANTHROPIC_SEM_ESCUTA =
  "Com a Anthropic, a Janete não entende áudio. Adicione uma chave de Escuta (OpenAI, Groq ou ElevenLabs) ou a da voz (ElevenLabs).";

/**
 * O cérebro avisa que a Janete não entende áudio: provedor Anthropic (que não transcreve) e nenhuma
 * escuta que o servidor use, nem a chave só de áudio (a inválida não conta), nem a do cérebro, nem a
 * da voz. Sem chave de IA (removida), o cartão já diz que a Janete não responde: o aviso do áudio não
 * aparece.
 */
export function avisaSemEscuta(
  cer: Pick<LeituraC, "chave" | "situacao">,
  esc: Pick<LeituraE, "chave" | "viaCerebro" | "viaVoz">,
): boolean {
  return cer.chave?.provedor === "anthropic" && cer.situacao !== "removida" && !emUso(esc.chave) && !esc.viaCerebro && !esc.viaVoz;
}

/* ---------- voz ---------- */

/** O que o cartão Voz avisa, nesta prioridade (spec-voz-uso, C3). */
export type AvisoVoz = "sem_credito" | "invalida" | "sem_permissao" | "voz_nao_encontrada" | "sem_voz";

export interface LeituraV {
  conhecida: boolean;
  /** A chave da voz (finalidade "voz", sempre da ElevenLabs; o modelo de fala é fixo no código). */
  chave: ChaveIA | null;
  /** Quando a Janete responde em áudio (configuracao.voz_resposta; fora da lista, o padrão). */
  modo: ModoVoz;
  /** A voz escolhida (configuracao.voz_id e voz_nome), ou nula. */
  voz: VozEscolhida | null;
  /** O motivo de a resposta sair em texto, com a chave guardada; null quando está tudo certo ou sem chave. */
  aviso: AvisoVoz | null;
  /** A voz e a escuta guardam a mesma chave da ElevenLabs (P5): o cartão diz "Mesma chave da Escuta de áudio". */
  mesmaChaveDaEscuta: boolean;
  /** A chave ativa, a voz escolhida e sem erro da voz: a Janete fala. */
  ok: boolean;
}

/**
 * A voz da Janete (ElevenLabs): a chave, o modo e a voz escolhida (que fica em `configuracao`, e
 * sobrevive à troca e à remoção da chave, P1). A falha da fala não para a Janete (a resposta sai em
 * texto): na Saúde, o nó da voz nunca fica em erro (P13).
 */
export function lerVoz(
  estado: Pick<EstadoExemplo, "chaves"> & {
    configuracao: Partial<Pick<Configuracao, "voz_resposta" | "voz_id" | "voz_nome" | "voz_erro">>;
  },
  admin: boolean,
): LeituraV {
  const chave = estado.chaves.find((c) => c.finalidade === "voz") ?? null;
  const cfg = estado.configuracao;
  const modo: ModoVoz = (MODOS_VOZ as readonly string[]).includes(cfg.voz_resposta ?? "")
    ? (cfg.voz_resposta as ModoVoz)
    : MODO_VOZ_PADRAO;
  const voz: VozEscolhida | null = cfg.voz_id ? { id: cfg.voz_id, nome: cfg.voz_nome || cfg.voz_id } : null;
  const sumiu = !!voz && cfg.voz_erro === "voz_nao_encontrada";
  let aviso: AvisoVoz | null = null;
  if (chave) {
    if (chave.status === "sem_credito") aviso = "sem_credito";
    // a chave sem um acesso (Text to Speech ou Speech to Text): inválida, com o caminho (P7)
    else if (chave.status === "invalida") aviso = chave.ultimo_erro === "sem_permissao" ? "sem_permissao" : "invalida";
    else if (sumiu) aviso = "voz_nao_encontrada";
    else if (!voz) aviso = "sem_voz";
  }
  return {
    conhecida: admin || estado.chaves.length > 0,
    chave,
    modo,
    voz,
    aviso,
    mesmaChaveDaEscuta: mesmaChaveElevenLabs(estado.chaves),
    ok: chave?.status === "ativa" && !!voz && !cfg.voz_erro,
  };
}

/* ---------- o motor (spec-motor-acordado) ---------- */

/** Trabalho esperando há mais que isto, a Saúde avisa (decisão 3). A regra mora na camada de dados. */
export const LIMITE_MOTOR_MS = MOTOR_ATRASADO_APOS_MS;

export interface LeituraMotor {
  /**
   * `atrasado`: há trabalho da Janete (fora os eventos do webhook) esperando há mais de 3 min.
   * `aguardando`: o motor nunca rodou (`worker_visto_em` nulo) e não há nada para fazer: uma cópia
   * nova antes da 1ª mensagem; não é aviso. `desconhecido`: o modo exemplo, que não tem motor.
   * `sem_leitura`: no banco, sem uma leitura válida do motor (carregando, em erro ou velha): a tela
   * não afirma nada, nem que está em dia. `onboarding`: o onboarding da empresa não foi concluído
   * (`onboarding_concluido_em` nulo); o pegar_rodadas devolve vazio e a Janete não atende (decisão 2
   * de ligar as telas ao banco).
   */
  estado: "ok" | "atrasado" | "aguardando" | "desconhecido" | "sem_leitura" | "onboarding";
  /** Há quantos minutos o trabalho espera (só em "atrasado"). */
  minutos: number;
  /** Desde quando (ms) o trabalho espera (só em "atrasado"). */
  desde?: number | undefined;
}

/**
 * As pendências do motor (motor_pendencias, já validadas pela camada: undefined = sem leitura que
 * valha) contra o relógio. Com `onboardingAberto` (a data de conclusão nula), a Janete não atende de
 * qualquer jeito. `vistoEm` é o último sinal do motor (`configuracao.worker_visto_em`): nulo = nunca
 * rodou; undefined = não se sabe (aí não diz "aguardando").
 */
export function lerMotor(
  pendencias: PendenciasMotor | null | undefined,
  agora: Instante,
  conhecido: boolean,
  onboardingAberto = false,
  vistoEm?: string | null,
): LeituraMotor {
  if (!conhecido) return { estado: "desconhecido", minutos: 0 };
  if (onboardingAberto) return { estado: "onboarding", minutos: 0 };
  if (!pendencias) return { estado: "sem_leitura", minutos: 0 };
  const agoraMs = agora instanceof Date ? agora.getTime() : typeof agora === "number" ? agora : Date.parse(agora);
  const desde = pendencias.atrasadoDesde;
  if (desde !== null && Number.isFinite(agoraMs) && agoraMs - desde > LIMITE_MOTOR_MS) {
    return { estado: "atrasado", minutos: Math.floor((agoraMs - desde) / 60_000), desde };
  }
  const nada =
    pendencias.proximoEm === null &&
    pendencias.vencidoDesde === null &&
    pendencias.atrasadoDesde === null;
  if (vistoEm === null && nada) return { estado: "aguardando", minutos: 0 };
  return { estado: "ok", minutos: 0 };
}

/** A Janete recebe, mas não responde a tempo: o trabalho atrasou, ou o onboarding está aberto. */
export function motorParado(m: LeituraMotor): boolean {
  return m.estado === "atrasado" || m.estado === "onboarding";
}

/**
 * Só o atraso do motor, com o WhatsApp e o cérebro funcionando: a Janete está atrasada, e não parada
 * (decisão do equipe em 03/11/2026). Ela segue respondendo, com demora; o aviso diz há quanto tempo.
 */
export function soAtrasada(w: LeituraW, cer: LeituraC, m: LeituraMotor | undefined): boolean {
  return !!m && m.estado === "atrasado" && w.ok && (!cer.conhecida || cer.ok);
}

/* ---------- datas ---------- */

/** "agora", "hoje às 14h43", "ontem às 9h12" ou "26/10 às 9h12", no fuso de São Paulo. */
export function quandoValidada(iso: string | null | undefined, agora: Instante): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  const agoraMs = agora instanceof Date ? agora.getTime() : typeof agora === "number" ? agora : Date.parse(agora);
  if (!Number.isFinite(ms) || !Number.isFinite(agoraMs)) return "";
  if (agoraMs - ms < 60_000) return "agora";
  const hora = horaCurta(iso).replace(":", "h").replace(/^0(\d)h/, "$1h");
  const dias = diasEntre(ms, agoraMs);
  if (dias <= 0) return `hoje às ${hora}`;
  if (dias === 1) return `ontem às ${hora}`;
  return `${dataCurta(iso)} às ${hora}`;
}
