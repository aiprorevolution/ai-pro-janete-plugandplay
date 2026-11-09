import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useRef } from "react";

import { modelosDo } from "@/features/ia/modelos";
import {
  conferirConexao,
  consertarCampoConexao,
  desconectarConexao,
  escolherVoz,
  listarModelosDaChave,
  listarVozes,
  removerChaveIA,
  revalidarChaveIA,
  salvarChaveIA,
  salvarConexao,
  salvarModoVoz,
  salvarRitmo,
  trocarModeloIA,
  usarChaveElevenLabs,
  verSegredoGerado,
  type AvisoConexao,
  type AvisoDesconectar,
  type CampoConsertoMeta,
  type EntradaUsarChaveElevenLabs,
  type ResultadoUsarChaveElevenLabs,
  type VozConferida,
} from "@/features/mensageria/configuracao.functions";
import {
  desconectarCelular,
  pedirQrConexao,
  pedirQrConexaoGuardada,
  type GatewayQr,
  type PedidoQr,
} from "@/features/mensageria/qr.functions";
import type { ProvedorIA as ProvedorListavel } from "@/features/servidor/chave-ia";
import { listarModelos } from "@/features/servidor/listar-modelos.functions";
import type { ModeloListado } from "@/features/servidor/listar-modelos";
import {
  MODOS_VOZ,
  VOZ_ID,
  type ModoVoz,
  type ResultadoListaVozes,
  type VozDaConta,
  type VozEscolhida,
} from "@/features/servidor/vozes-tipos";

import { VOZES_EXEMPLO } from "../exemplo/dados";
import { useExemplo } from "../exemplo/ProvedorExemplo";
import type { ChaveIA, Conexao, FinalidadeIA, Gateway, ProvedorIA, StatusConexao } from "../exemplo/tipos";
import { CHAVES, type ChaveRaiz } from "./chaves";
import { COLUNAS_CONEXAO, type ClienteFirebase } from "./colunas";
import { RELER_SEM_TEMPO_REAL_MS, repetirSoFalha } from "./leituras";
import { pronta, paraLeitura } from "./leitura";
import { useClienteDados, useDados, useModoDados } from "./ProvedorDados";
import type { ConfiguracaoDados, Leitura, ModoDados } from "./tipos";

// As leituras e as ações da Configuração (spec de ligar as telas ao banco, task C5). As leituras
// comuns (chaves e configuração) vêm do useDados(); a conexão da Configuração é a mais recente, ativa
// ou desligada pela Configuração (conexao_eventos), para o cartão saber dizer "Você desconectou este
// número" (desligada) e não confundir com a queda (ativa e desconectada). As ações chamam as funções
// de servidor da mensageria (src/features/mensageria/configuracao.functions.ts, só admin) e
// invalidam o que mudou. No modo exemplo, as mesmas ações mexem no estado em memória.

/* ---------- tipos ---------- */

/** A conexão que a Configuração mostra. `desligada` só quando a conexão saiu de ativa (ativa_para false). */
export interface ConexaoConfiguracao {
  /** A ativa; senão, a última desligada pela Configuração; senão, nula. */
  conexao: Conexao | null;
  /** Quem desligou (nulo quando foi o servidor, como no desconectarConexao) e quando. */
  desligada: { ator_membro_id: string | null; em: string } | null;
}

/** A recusa de uma ação da Configuração: o código, e a frase pronta do servidor quando ele manda. */
export interface FalhaConfiguracao {
  ok: false;
  erro: string;
  mensagem?: string | undefined;
  /** O campo do formulário que o gateway recusou. */
  campo?: string | undefined;
  /** O status que a conferência deixou na conexão ou na chave. */
  status?: string | undefined;
  /** numero_diferente (spec-qr-whatsapp, seção 8): o número do celular que leu o QR, formatado. */
  numeroConectado?: string | undefined;
  /** numero_diferente no salvar: o número que a pessoa informou, formatado. */
  numeroInformado?: string | undefined;
  /** numero_diferente no conserto: o número salvo na conexão, formatado. */
  numeroSalvo?: string | undefined;
  /** numero_diferente no conserto: o celular de outro número saiu da instância. */
  desconectado?: boolean | undefined;
}

export type ResultadoConfiguracao<T extends object = object> = ({ ok: true } & T) | FalhaConfiguracao;

/** Só o modo exemplo usa: o "Simular" da demo e o número de exemplo. O banco ignora. */
export interface SimulacaoExemplo {
  falhar?: boolean | undefined;
  nome?: string | undefined;
}

export interface ModelosDaChave {
  modelos: ModeloListado[];
  origem: "provedor" | "lista_curada";
}

export interface ConexaoSalva {
  nome: string;
  gateway: Gateway;
  /** O endereço do webhook (vazio no exemplo). */
  urlWebhook: string;
  /** Só a Meta: o token de verificação para colar no painel dela. */
  verifyToken: string | null;
  avisos: AvisoConexao[];
  /**
   * O Trocar (decisão 10 das lacunas): o webhook da conexão que saiu ficou no provedor (Meta e Z-API:
   * tirar no painel; ou o desligar falhou). Ausente = não havia outra, desligou ou é o exemplo.
   */
  anterior?: { gateway: Gateway; aviso: AvisoDesconectar };
}

/** O aviso do webhook da conexão anterior que o salvarConexao devolve; null = sem aviso ou fora do formato. */
function avisoAnterior(v: unknown): { gateway: Gateway; aviso: AvisoDesconectar } | null {
  if (!v || typeof v !== "object") return null;
  const gateway = (v as Record<string, unknown>)["gateway"];
  const aviso = (v as Record<string, unknown>)["aviso"];
  const gatewayOk = gateway === "meta" || gateway === "zapi" || gateway === "evolution" || gateway === "zernio";
  const avisoOk = aviso === "webhook_no_painel" || aviso === "webhook_nao_desligado";
  return gatewayOk && avisoOk ? { gateway, aviso } : null;
}

/** O passo do QR (Z-API e Evolution): conectado, ou a imagem (nula enquanto não vem) e o passkey. */
export interface EstadoQr {
  conectado: boolean;
  qr: string | null;
  passkey: boolean;
}

export interface AcoesConfiguracao {
  salvarConexao(gateway: Gateway, campos: Record<string, string>, sim?: SimulacaoExemplo): Promise<ResultadoConfiguracao<ConexaoSalva>>;
  /** Só a Meta: troca um campo guardado (token, appSecret ou wabaId) e confere de novo. */
  consertarCampo(campo: CampoConsertoMeta, valor: string, sim?: SimulacaoExemplo): Promise<ResultadoConfiguracao<{ nome: string }>>;
  /** A conferência grátis com os dados guardados (decisão 10b). */
  conferirConexao(sim?: SimulacaoExemplo): Promise<ResultadoConfiguracao<{ nome: string }>>;
  /** aviso: o webhook ficou no provedor (Meta e Z-API: tirar no painel; ou o desligar falhou). */
  desconectar(): Promise<ResultadoConfiguracao<{ aviso?: AvisoDesconectar }>>;
  /** O verify token guardado da conexão da Meta. */
  verVerifyToken(conexaoId: string): Promise<ResultadoConfiguracao<{ valor: string }>>;
  salvarChave(
    finalidade: FinalidadeIA,
    provedor: ProvedorIA,
    modelo: string,
    chave: string,
    sim?: SimulacaoExemplo,
  ): Promise<ResultadoConfiguracao<{ ultimos4: string }>>;
  /** Confere uma chave nova (ainda não gravada) pedindo a lista de modelos ao provedor. */
  conferirChaveNova(provedor: ProvedorIA, chave: string, sim?: SimulacaoExemplo): Promise<ResultadoConfiguracao<ModelosDaChave>>;
  /**
   * Testa de novo a chave guardada, com a conferência grátis (decisão 10b). Na voz, o servidor também
   * confere a voz escolhida (`voz`: "ok", "nao_encontrada" ou "sem_voz"; P12 do uso da voz).
   */
  revalidarChave(finalidade: FinalidadeIA, sim?: SimulacaoExemplo): Promise<ResultadoConfiguracao<{ voz?: VozConferida }>>;
  listarModelosDaChave(finalidade: FinalidadeIA): Promise<ResultadoConfiguracao<ModelosDaChave>>;
  trocarModelo(finalidade: FinalidadeIA, modelo: string): Promise<ResultadoConfiguracao<{ modelo: string }>>;
  /** Só a chave de áudio: sem ela, a transcrição volta a usar a do cérebro (quando ela transcreve). */
  removerChaveAudio(): Promise<ResultadoConfiguracao>;
  /** A chave da voz (ElevenLabs): sem ela, a Janete fica sem voz. */
  removerChaveVoz(): Promise<ResultadoConfiguracao>;
  salvarRitmo(espera: number, teto: number): Promise<ResultadoConfiguracao<{ espera: number; teto: number }>>;
  /** As vozes da conta da chave guardada e a escolhida hoje (spec-voz-uso, C3). Não grava nem relê nada. */
  listarVozes(): Promise<ResultadoListaVozes>;
  /** Grava a voz (o servidor confere na ElevenLabs e guarda o nome que veio de lá). */
  escolherVoz(vozId: string): Promise<ResultadoConfiguracao<{ voz: VozEscolhida }>>;
  /** Quando a Janete responde em áudio. */
  salvarModoVoz(modo: ModoVoz): Promise<ResultadoConfiguracao<{ modo: ModoVoz }>>;
  /**
   * Usa a chave da ElevenLabs do outro cartão também neste (`para`: a voz copia da escuta, e a escuta
   * da voz; spec da escuta com a ElevenLabs, E2). A cópia é no servidor: a chave nunca vem à tela.
   * `ultimos4` nulo = nada foi copiado.
   */
  usarChaveElevenLabs(para: "voz" | "transcricao"): Promise<ResultadoConfiguracao<{ ultimos4: string | null }>>;
  /** O QR com os campos colados (troca de WhatsApp). Não grava nem relê nada. */
  pedirQr(
    gateway: GatewayQr,
    campos: Record<string, string>,
    pedir: PedidoQr,
  ): Promise<ResultadoConfiguracao<EstadoQr>>;
  /** O QR com os dados guardados da conexão ativa (conserto do número caído). Não grava nem relê nada. */
  pedirQrGuardada(pedir: PedidoQr): Promise<ResultadoConfiguracao<EstadoQr>>;
  /** Tira o celular da instância com os campos colados ("Desconectar e ler de novo"). Não grava nem relê nada. */
  desconectarCelular(gateway: GatewayQr, campos: Record<string, string>): Promise<ResultadoConfiguracao>;
}

export interface DadosConfiguracao {
  modo: ModoDados;
  /** O id do membro de quem usa (para "Você desconectou"). */
  euId: string;
  conexao: Leitura<ConexaoConfiguracao>;
  chaves: Leitura<ChaveIA[]>;
  configuracao: Leitura<ConfiguracaoDados>;
  acoes: AcoesConfiguracao;
}

/* ---------- as funções de servidor (testes trocam por falsas) ---------- */

type Resposta = { ok: boolean } & Record<string, unknown>;

/** As funções de servidor que a Configuração chama, com a entrada de cada uma. */
export interface ServidorConfiguracao {
  salvarConexao(d: { gateway: string; campos: Record<string, string> }): Promise<Resposta>;
  verSegredoGerado(d: { conexao_id: string; nome: "verifyToken" }): Promise<Resposta>;
  desconectarConexao(): Promise<Resposta>;
  conferirConexao(): Promise<Resposta>;
  consertarCampoConexao(d: { campo: CampoConsertoMeta; valor: string }): Promise<Resposta>;
  salvarChaveIA(d: { finalidade: FinalidadeIA; provedor: ProvedorIA; modelo: string; chave: string }): Promise<Resposta>;
  revalidarChaveIA(d: { finalidade: FinalidadeIA }): Promise<Resposta>;
  listarModelosDaChave(d: { finalidade: FinalidadeIA }): Promise<Resposta>;
  trocarModeloIA(d: { finalidade: FinalidadeIA; modelo: string }): Promise<Resposta>;
  removerChaveIA(d: { finalidade: FinalidadeIA }): Promise<Resposta>;
  salvarRitmo(d: { espera: number; teto: number }): Promise<Resposta>;
  listarModelos(d: { provedor: ProvedorListavel; chave: string }): Promise<Resposta>;
  pedirQrConexao(d: {
    gateway: GatewayQr;
    campos: Record<string, string>;
    pedir: PedidoQr;
  }): Promise<Resposta>;
  pedirQrConexaoGuardada(d: { pedir: PedidoQr }): Promise<Resposta>;
  listarVozes(): Promise<Resposta>;
  escolherVoz(d: { vozId: string }): Promise<Resposta>;
  salvarModoVoz(d: { modo: ModoVoz }): Promise<Resposta>;
  desconectarCelular(d: { gateway: GatewayQr; campos: Record<string, string> }): Promise<Resposta>;
  usarChaveElevenLabs(d: EntradaUsarChaveElevenLabs): Promise<ResultadoUsarChaveElevenLabs>;
}

const comoResposta = (p: Promise<unknown>) => p as Promise<Resposta>;

/** As funções de servidor de verdade (createServerFn: no navegador, viram uma chamada ao servidor). */
export const SERVIDOR_CONFIGURACAO: ServidorConfiguracao = {
  salvarConexao: (data) => comoResposta(salvarConexao({ data })),
  verSegredoGerado: (data) => comoResposta(verSegredoGerado({ data })),
  desconectarConexao: () => comoResposta(desconectarConexao({ data: {} })),
  conferirConexao: () => comoResposta(conferirConexao({ data: {} })),
  consertarCampoConexao: (data) => comoResposta(consertarCampoConexao({ data })),
  salvarChaveIA: (data) => comoResposta(salvarChaveIA({ data })),
  revalidarChaveIA: (data) => comoResposta(revalidarChaveIA({ data })),
  listarModelosDaChave: (data) => comoResposta(listarModelosDaChave({ data })),
  trocarModeloIA: (data) => comoResposta(trocarModeloIA({ data })),
  removerChaveIA: (data) => comoResposta(removerChaveIA({ data })),
  salvarRitmo: (data) => comoResposta(salvarRitmo({ data })),
  listarModelos: (data) => comoResposta(listarModelos({ data })),
  pedirQrConexao: (data) => comoResposta(pedirQrConexao({ data })),
  pedirQrConexaoGuardada: (data) => comoResposta(pedirQrConexaoGuardada({ data })),
  listarVozes: () => comoResposta(listarVozes({ data: {} })),
  escolherVoz: (data) => comoResposta(escolherVoz({ data })),
  salvarModoVoz: (data) => comoResposta(salvarModoVoz({ data })),
  desconectarCelular: (data) => comoResposta(desconectarCelular({ data })),
  usarChaveElevenLabs: (data) => usarChaveElevenLabs({ data }),
};

/** Troca as funções de servidor (testes). Sem provedor, valem as de verdade. */
export const ServidorConfiguracaoContexto = createContext<ServidorConfiguracao>(SERVIDOR_CONFIGURACAO);

/* ---------- leitura da conexão ---------- */

const VALE_MS = 15_000;

/**
 * A conexão da Configuração: a ativa; sem ela, a mais recente, se o último evento dela foi sair de
 * ativa (conexao_eventos, ativa_de true → ativa_para false). Inativa sem esse evento conta como
 * nenhuma. conexoes não está no tempo real: relê no foco e a cada 60 s.
 */
export function opcoesConexaoConfiguracao(cliente: ClienteFirebase) {
  return queryOptions({
    queryKey: [...CHAVES.conexao, "configuracao"] as const,
    queryFn: async (): Promise<ConexaoConfiguracao> => {
      const { data, error } = await cliente
        .from("conexoes")
        .select(COLUNAS_CONEXAO)
        .order("ativa", { ascending: false })
        .order("atualizado_em", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { conexao: null, desligada: null };
      if (data.ativa) return { conexao: data, desligada: null };
      const ev = await cliente
        .from("conexao_eventos")
        .select("id, ator_membro_id, criado_em")
        .eq("conexao_id", data.id)
        .eq("ativa_de", true)
        .eq("ativa_para", false)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ev.error) throw ev.error;
      if (!ev.data) return { conexao: null, desligada: null };
      // O desconectar do servidor desliga com a chave de serviço, e o gatilho grava o ator nulo. Quem
      // desligou fica na auditoria (conexao_desativada, alvo = id da conexão), que só o admin lê; a
      // Configuração é só do admin. Sem achar, o ator continua nulo e a frase sai neutra.
      let ator = ev.data.ator_membro_id;
      if (ator === null) {
        const au = await cliente
          .from("auditoria")
          .select("ator_membro_id")
          .eq("acao", "conexao_desativada")
          .eq("alvo", data.id)
          .order("criado_em", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!au.error && au.data) ator = au.data.ator_membro_id;
      }
      return { conexao: data, desligada: { ator_membro_id: ator, em: ev.data.criado_em } };
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
    refetchInterval: RELER_SEM_TEMPO_REAL_MS,
    refetchOnWindowFocus: "always",
  });
}

/* ---------- apoio ---------- */

/** O que cada ação deixa velho (sempre, mesmo na recusa: a conferência que falha muda o status). */
const RELER: Record<"conexao" | "chaves" | "configuracao" | "voz", readonly ChaveRaiz[]> = {
  conexao: ["conexao", "auditoria"],
  chaves: ["chaves", "auditoria"],
  configuracao: ["configuracao", "auditoria"],
  // a conferência da chave da voz também grava ou limpa configuracao.voz_erro (P12)
  voz: ["chaves", "configuracao", "auditoria"],
};

function falha(erro: string, mensagem?: string, extra: Partial<FalhaConfiguracao> = {}): FalhaConfiguracao {
  return { ok: false, erro, ...(mensagem ? { mensagem } : {}), ...extra };
}

/** A resposta de uma função de servidor como recusa (só código, frase, campo e status: nada de segredo). */
function recusaDe(r: Resposta): FalhaConfiguracao {
  const erro = typeof r["erro"] === "string" ? (r["erro"] as string) : "falha";
  const extra: Partial<FalhaConfiguracao> = {};
  if (typeof r["campo"] === "string") extra.campo = r["campo"] as string;
  if (typeof r["status"] === "string") extra.status = r["status"] as string;
  // numero_diferente (spec-qr-whatsapp, seção 8): os números já vêm formatados do servidor
  if (typeof r["numero_conectado"] === "string") extra.numeroConectado = r["numero_conectado"] as string;
  if (typeof r["numero_informado"] === "string") extra.numeroInformado = r["numero_informado"] as string;
  if (typeof r["numero_salvo"] === "string") extra.numeroSalvo = r["numero_salvo"] as string;
  if (typeof r["desconectado"] === "boolean") extra.desconectado = r["desconectado"] as boolean;
  return falha(erro, typeof r["mensagem"] === "string" ? (r["mensagem"] as string) : undefined, extra);
}

function texto(r: Resposta, campo: string): string {
  return typeof r[campo] === "string" ? (r[campo] as string) : "";
}

const VOZES_CONFERIDAS: readonly VozConferida[] = ["ok", "nao_encontrada", "sem_voz"];

/** O `voz` da conferência da chave da voz, só quando veio num valor conhecido. */
function vozConferidaDe(r: Resposta): { voz?: VozConferida } {
  const v = r["voz"];
  return typeof v === "string" && (VOZES_CONFERIDAS as readonly string[]).includes(v) ? { voz: v as VozConferida } : {};
}

/** Uma voz escolhida que veio do servidor (id no formato e nome de texto), ou nula. */
function vozEscolhidaDe(v: unknown): VozEscolhida | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o["id"] !== "string" || !VOZ_ID.test(o["id"])) return null;
  const nome = typeof o["nome"] === "string" && o["nome"].trim() ? o["nome"] : o["id"];
  return { id: o["id"], nome };
}

/** A recusa no formato da lista de vozes (só o código e a frase: nada de campo nem status). */
function falhaLista(f: FalhaConfiguracao): ResultadoListaVozes {
  return { ok: false, erro: f.erro, ...(f.mensagem ? { mensagem: f.mensagem } : {}) };
}

/** As vozes da lista: só as que têm id no formato e nome (o resto do formato a lista mostra como veio). */
function vozesDe(lista: unknown[]): VozDaConta[] {
  return lista.filter(
    (v): v is VozDaConta =>
      !!v && typeof v === "object" && typeof (v as VozDaConta).id === "string" && VOZ_ID.test((v as VozDaConta).id) && typeof (v as VozDaConta).nome === "string",
  );
}

function modelosDe(r: Resposta): ModelosDaChave {
  const lista = Array.isArray(r["modelos"]) ? (r["modelos"] as ModeloListado[]) : [];
  return { modelos: lista, origem: r["origem"] === "lista_curada" ? "lista_curada" : "provedor" };
}

/** Os 4 últimos caracteres da chave colada (só letras e números), como a tela do exemplo mostra. */
function ultimos4Exemplo(chave: string): string {
  return chave.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
}

/** A lista curada (src/features/ia/modelos.ts) no formato da listarModelos: o exemplo e a reserva. */
export function modelosCurados(provedor: ProvedorIA | null | undefined): ModeloListado[] {
  // groq só transcreve e a ElevenLabs só dá voz: nenhuma das duas tem lista de modelos de texto
  if (!provedor || provedor === "groq" || provedor === "elevenlabs") return [];
  return modelosDo(provedor).map((m) => ({
    id: m.id,
    nome: m.nome,
    perfil: m.perfil,
    precoEntrada: m.precoEntrada,
    precoSaida: m.precoSaida,
    recomendado: m.recomendado,
  }));
}

/** As ações do modo banco: chamam o servidor, nunca lançam, e invalidam o que mudou. */
export function criarAcoesConfiguracaoBanco(servidor: ServidorConfiguracao, queryClient: QueryClient): AcoesConfiguracao {
  const reler = (alvo: keyof typeof RELER) => {
    for (const raiz of RELER[alvo]) void queryClient.invalidateQueries({ queryKey: CHAVES[raiz] });
  };
  /** Chama, traduz a falha da chamada (rede, sessão, validador) e relê no fim, deu certo ou não. */
  async function chamar(alvo: keyof typeof RELER, fn: () => Promise<Resposta>): Promise<Resposta | FalhaConfiguracao> {
    let resultado: Resposta | FalhaConfiguracao;
    try {
      const r = await fn();
      if (!r || typeof r !== "object") resultado = falha("falha");
      else resultado = r.ok ? r : recusaDe(r);
    } catch {
      // nunca o texto cru: pode citar a entrada
      resultado = falha("falha");
    }
    reler(alvo);
    // A conta perdeu o acesso (desativada, ou deixou de ser admin): o Eu é relido (spec 2.2) e a
    // casca leva para /sem-acesso, ou o papel novo some com a Configuração.
    if (!resultado.ok && resultado.erro === "sem_acesso") void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
    return resultado;
  }
  /** O QR: como o chamar, mas sem reler nada (o pedido não grava). Só o sem_acesso relê o Eu. */
  async function pedirEstadoQr(
    fn: () => Promise<Resposta>,
  ): Promise<ResultadoConfiguracao<EstadoQr>> {
    let resultado: ResultadoConfiguracao<EstadoQr>;
    try {
      const r = await fn();
      if (!r || typeof r !== "object") resultado = falha("falha");
      else if (!r.ok) resultado = recusaDe(r);
      else
        resultado = {
          ok: true,
          conectado: r["conectado"] === true,
          qr: texto(r, "qr") || null,
          passkey: r["passkey"] === true,
        };
    } catch {
      // nunca o texto cru: pode citar a entrada
      resultado = falha("falha");
    }
    if (!resultado.ok && resultado.erro === "sem_acesso")
      void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
    return resultado;
  }

  return {
    salvarConexao: async (gateway, campos) => {
      const r = await chamar("conexao", () => servidor.salvarConexao({ gateway, campos }));
      if (!r.ok) return r as FalhaConfiguracao;
      const ok = r as Resposta;
      const avisos = Array.isArray(ok["avisos"]) ? (ok["avisos"] as AvisoConexao[]) : [];
      const anterior = avisoAnterior(ok["conexao_anterior"]);
      return {
        ok: true,
        nome: texto(ok, "nome"),
        gateway: (texto(ok, "gateway") || gateway) as Gateway,
        urlWebhook: texto(ok, "url_webhook"),
        verifyToken: texto(ok, "verifyToken") || null,
        avisos,
        ...(anterior ? { anterior } : {}),
      };
    },
    consertarCampo: async (campo, valor) => {
      const r = await chamar("conexao", () => servidor.consertarCampoConexao({ campo, valor }));
      return r.ok ? { ok: true, nome: texto(r as Resposta, "nome") } : (r as FalhaConfiguracao);
    },
    conferirConexao: async () => {
      const r = await chamar("conexao", () => servidor.conferirConexao());
      return r.ok ? { ok: true, nome: texto(r as Resposta, "nome") } : (r as FalhaConfiguracao);
    },
    desconectar: async () => {
      const r = await chamar("conexao", () => servidor.desconectarConexao());
      if (!r.ok) return r as FalhaConfiguracao;
      const aviso = texto(r as Resposta, "aviso");
      return aviso === "webhook_no_painel" || aviso === "webhook_nao_desligado" ? { ok: true, aviso } : { ok: true };
    },
    verVerifyToken: async (conexaoId) => {
      try {
        const r = await servidor.verSegredoGerado({ conexao_id: conexaoId, nome: "verifyToken" });
        if (!r?.ok) return recusaDe(r ?? { ok: false });
        return { ok: true, valor: texto(r, "valor") };
      } catch {
        return falha("falha");
      }
    },
    salvarChave: async (finalidade, provedor, modelo, chave) => {
      const r = await chamar("chaves", () => servidor.salvarChaveIA({ finalidade, provedor, modelo, chave }));
      return r.ok ? { ok: true, ultimos4: texto(r as Resposta, "ultimos4") } : (r as FalhaConfiguracao);
    },
    conferirChaveNova: async (provedor, chave) => {
      if (provedor === "groq" || provedor === "elevenlabs") return falha("provedor_nao_permitido");
      try {
        const r = await servidor.listarModelos({ provedor, chave });
        if (!r?.ok) return recusaDe(r ?? { ok: false });
        return { ok: true, ...modelosDe(r) };
      } catch {
        return falha("falha");
      }
    },
    revalidarChave: async (finalidade) => {
      const r = await chamar(finalidade === "voz" ? "voz" : "chaves", () => servidor.revalidarChaveIA({ finalidade }));
      return r.ok ? { ok: true, ...vozConferidaDe(r as Resposta) } : (r as FalhaConfiguracao);
    },
    listarModelosDaChave: async (finalidade) => {
      try {
        const r = await servidor.listarModelosDaChave({ finalidade });
        if (!r?.ok) return recusaDe(r ?? { ok: false });
        return { ok: true, ...modelosDe(r) };
      } catch {
        return falha("falha");
      }
    },
    trocarModelo: async (finalidade, modelo) => {
      const r = await chamar("chaves", () => servidor.trocarModeloIA({ finalidade, modelo }));
      return r.ok ? { ok: true, modelo: texto(r as Resposta, "modelo") || modelo } : (r as FalhaConfiguracao);
    },
    removerChaveAudio: async () => {
      const r = await chamar("chaves", () => servidor.removerChaveIA({ finalidade: "transcricao" }));
      return r.ok ? { ok: true } : (r as FalhaConfiguracao);
    },
    removerChaveVoz: async () => {
      const r = await chamar("chaves", () => servidor.removerChaveIA({ finalidade: "voz" }));
      return r.ok ? { ok: true } : (r as FalhaConfiguracao);
    },
    salvarRitmo: async (espera, teto) => {
      const r = await chamar("configuracao", () => servidor.salvarRitmo({ espera, teto }));
      if (!r.ok) return r as FalhaConfiguracao;
      const ok = r as Resposta;
      return {
        ok: true,
        espera: typeof ok["espera"] === "number" ? (ok["espera"] as number) : espera,
        teto: typeof ok["teto"] === "number" ? (ok["teto"] as number) : teto,
      };
    },
    pedirQr: (gateway, campos, pedir) =>
      pedirEstadoQr(() => servidor.pedirQrConexao({ gateway, campos, pedir })),
    pedirQrGuardada: (pedir) => pedirEstadoQr(() => servidor.pedirQrConexaoGuardada({ pedir })),
    // a lista não grava: não relê nada (como listarModelosDaChave); só o sem_acesso relê o Eu
    listarVozes: async () => {
      let resultado: ResultadoListaVozes;
      try {
        const r = await servidor.listarVozes();
        if (!r || typeof r !== "object") resultado = falhaLista(falha("falha"));
        else if (!r.ok) resultado = falhaLista(recusaDe(r));
        else if (!Array.isArray(r["vozes"])) resultado = falhaLista(falha("falha"));
        else resultado = { ok: true, vozes: vozesDe(r["vozes"] as unknown[]), atual: vozEscolhidaDe(r["atual"]) };
      } catch {
        // nunca o texto cru: pode citar a entrada
        resultado = falhaLista(falha("falha"));
      }
      if (!resultado.ok && resultado.erro === "sem_acesso") void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
      return resultado;
    },
    escolherVoz: async (vozId) => {
      const r = await chamar("configuracao", () => servidor.escolherVoz({ vozId }));
      if (!r.ok) return r as FalhaConfiguracao;
      return { ok: true, voz: vozEscolhidaDe((r as Resposta)["voz"]) ?? { id: vozId, nome: vozId } };
    },
    salvarModoVoz: async (modo) => {
      const r = await chamar("configuracao", () => servidor.salvarModoVoz({ modo }));
      if (!r.ok) return r as FalhaConfiguracao;
      const volta = (r as Resposta)["modo"];
      return { ok: true, modo: typeof volta === "string" && (MODOS_VOZ as readonly string[]).includes(volta) ? (volta as ModoVoz) : modo };
    },
    // a cópia grava a linha do destino: as chaves são relidas (a chave nunca vem na resposta)
    usarChaveElevenLabs: async (para) => {
      const r = await chamar("chaves", () => comoResposta(servidor.usarChaveElevenLabs({ para })));
      if (!r.ok) return r as FalhaConfiguracao;
      const ok = r as Resposta;
      return { ok: true, ultimos4: ok["copiada"] === true ? texto(ok, "ultimos4") || null : null };
    },
    // como o QR: nada grava no banco, então nada é relido (só o sem_acesso relê o Eu)
    desconectarCelular: async (gateway, campos) => {
      let resultado: ResultadoConfiguracao;
      try {
        const r = await servidor.desconectarCelular({ gateway, campos });
        if (!r || typeof r !== "object") resultado = falha("falha");
        else resultado = r.ok ? { ok: true } : recusaDe(r);
      } catch {
        // nunca o texto cru: pode citar a entrada
        resultado = falha("falha");
      }
      if (!resultado.ok && resultado.erro === "sem_acesso")
        void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
      return resultado;
    },
  };
}

/* ---------- o hook ---------- */

/** A Configuração lê e age por aqui (só o admin chega à tela: a rota e a casca cuidam). */
export function useDadosConfiguracao(): DadosConfiguracao {
  const modo = useModoDados();
  // o modo não muda enquanto o provedor está montado: o hook de cada modo é sempre o mesmo (como os
  // métodos da FonteDados do ProvedorDados). O do banco precisa do QueryClient; o do exemplo, do
  // ProvedorExemplo: por isso não se chamam os dois.
  return IMPLEMENTACAO[modo]();
}

const IMPLEMENTACAO: Readonly<Record<ModoDados, () => DadosConfiguracao>> = {
  banco: useConfiguracaoBanco,
  exemplo: useConfiguracaoExemplo,
};

function useConfiguracaoBanco(): DadosConfiguracao {
  const dados = useDados();
  const cliente = useClienteDados();
  const queryClient = useQueryClient();
  const servidor = useContext(ServidorConfiguracaoContexto);
  const eu = dados.useEu();
  const chaves = dados.useChaves();
  const configuracao = dados.useConfiguracao();
  const q = useQuery({ ...opcoesConexaoConfiguracao(cliente as ClienteFirebase), enabled: !!cliente });
  const conexao = paraLeitura(q);
  const acoes = useMemo(() => criarAcoesConfiguracaoBanco(servidor, queryClient), [servidor, queryClient]);
  return { modo: "banco", euId: eu.membro.id, conexao, chaves, configuracao, acoes };
}

const espera0 = () => Promise.resolve();

function useConfiguracaoExemplo(): DadosConfiguracao {
  const dados = useDados();
  const { estado, acoes: ex } = useExemplo();
  const chaves = dados.useChaves();
  const configuracao = dados.useConfiguracao();
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  const conexao = useMemo(() => {
    const c = estado.conexao;
    const valor: ConexaoConfiguracao = !c
      ? { conexao: null, desligada: null }
      : c.ativa
        ? { conexao: c, desligada: null }
        : // no exemplo, a conexão inativa é sempre a desligada pela Configuração (trocarConexao(null))
          { conexao: c, desligada: { ator_membro_id: estado.eu.id, em: c.atualizado_em } };
    return pronta(valor);
  }, [estado.conexao, estado.eu.id]);

  const acoes = useMemo<AcoesConfiguracao>(() => {
    const recusado = (r: { ok: boolean; erro?: string }): FalhaConfiguracao => falha(r.erro ?? "sem_acesso");
    const chaveDe = (f: FinalidadeIA) => estadoRef.current.chaves.find((k) => k.finalidade === f) ?? null;
    return {
      salvarConexao: async (gateway, _campos, sim) => {
        await espera0();
        if (sim?.falhar) return falha("credencial_invalida");
        const nome = sim?.nome ?? "";
        const r = ex.trocarConexao({ gateway, nome });
        if (!r.ok) return recusado(r);
        return { ok: true, nome, gateway, urlWebhook: "", verifyToken: null, avisos: [] };
      },
      consertarCampo: async (_campo, _valor, sim) => {
        await espera0();
        if (sim?.falhar) return falha("credencial_invalida");
        const r = ex.simularJanete({ tipo: "conexao", status: "conectada", ultimo_erro: null });
        return r.ok ? { ok: true, nome: estadoRef.current.conexao?.nome ?? "" } : recusado(r);
      },
      conferirConexao: async (sim) => {
        await espera0();
        const c = estadoRef.current.conexao;
        if (!c || !c.ativa) return falha("sem_conexao");
        if (sim?.falhar) {
          const qr = c.gateway === "zapi" || c.gateway === "evolution";
          const status: StatusConexao = c.status === "erro" ? "erro" : "desconectada";
          const erro = qr ? "instancia_desconectada" : "credencial_invalida";
          ex.simularJanete({ tipo: "conexao", status, ultimo_erro: erro });
          return falha(erro, undefined, { status });
        }
        if (c.status !== "conectada") ex.simularJanete({ tipo: "conexao", status: "conectada", ultimo_erro: null });
        return { ok: true, nome: c.nome };
      },
      desconectar: async () => {
        await espera0();
        const r = ex.trocarConexao(null);
        return r.ok ? { ok: true } : recusado(r);
      },
      // o exemplo não guarda segredo: o cartão mostra o lugar do token
      verVerifyToken: async () => falha("nao_encontrado"),
      salvarChave: async (finalidade, provedor, modelo, chave, sim) => {
        await espera0();
        if (sim?.falhar) return falha("chave_invalida");
        const ultimos4 = ultimos4Exemplo(chave);
        const r = ex.trocarChaveIA(finalidade, { provedor, modelo, ultimos4 });
        return r.ok ? { ok: true, ultimos4 } : recusado(r);
      },
      conferirChaveNova: async (provedor, _chave, sim) => {
        await espera0();
        if (sim?.falhar) return falha("chave_invalida");
        return { ok: true, modelos: modelosCurados(provedor), origem: "lista_curada" };
      },
      revalidarChave: async (finalidade, sim) => {
        await espera0();
        const k = chaveDe(finalidade);
        if (!k) return falha("sem_chave");
        if (sim?.falhar) return falha(k.status === "sem_credito" ? "sem_credito" : "chave_invalida");
        const r = ex.simularJanete({ tipo: "chave", finalidade, status: "ativa" });
        if (!r.ok) return recusado(r);
        if (finalidade !== "voz") return { ok: true };
        // a voz escolhida é conferida na lista da "conta" do exemplo (P12)
        const id = estadoRef.current.configuracao.voz_id ?? null;
        return { ok: true, voz: !id ? "sem_voz" : VOZES_EXEMPLO.some((v) => v.id === id) ? "ok" : "nao_encontrada" };
      },
      listarModelosDaChave: async (finalidade) => {
        await espera0();
        const k = chaveDe(finalidade);
        if (!k) return falha("sem_chave");
        return { ok: true, modelos: modelosCurados(k.provedor), origem: "lista_curada" };
      },
      trocarModelo: async (finalidade, modelo) => {
        await espera0();
        const k = chaveDe(finalidade);
        if (!k) return falha("sem_chave");
        const r = ex.trocarChaveIA(finalidade, { provedor: k.provedor, modelo, ultimos4: k.ultimos4 ?? "" });
        return r.ok ? { ok: true, modelo } : recusado(r);
      },
      removerChaveAudio: async () => {
        await espera0();
        if (!chaveDe("transcricao")) return falha("sem_chave");
        const r = ex.trocarChaveIA("transcricao", null);
        return r.ok ? { ok: true } : recusado(r);
      },
      removerChaveVoz: async () => {
        await espera0();
        if (!chaveDe("voz")) return falha("sem_chave");
        const r = ex.trocarChaveIA("voz", null);
        return r.ok ? { ok: true } : recusado(r);
      },
      salvarRitmo: async (espera, teto) => {
        await espera0();
        const r = ex.salvarRitmo(espera, teto);
        return r.ok ? { ok: true, espera, teto } : recusado(r);
      },
      // a demo não inventa QR: o celular "conecta" na hora
      pedirQr: async () => {
        await espera0();
        return { ok: true, conectado: true, qr: null, passkey: false };
      },
      pedirQrGuardada: async () => {
        await espera0();
        return { ok: true, conectado: true, qr: null, passkey: false };
      },
      // a "conta" do exemplo tem 3 vozes sem prévia: a demo não toca áudio inventado (P18)
      listarVozes: async () => {
        await espera0();
        if (!chaveDe("voz")) return falhaLista(falha("sem_chave"));
        const cfg = estadoRef.current.configuracao;
        const atual = cfg.voz_id ? { id: cfg.voz_id, nome: cfg.voz_nome || cfg.voz_id } : null;
        return { ok: true, vozes: [...VOZES_EXEMPLO], atual };
      },
      escolherVoz: async (vozId) => {
        await espera0();
        if (!chaveDe("voz")) return falha("sem_chave");
        const v = VOZES_EXEMPLO.find((x) => x.id === vozId);
        if (!v) return falha("voz_nao_encontrada", "A voz escolhida não existe mais na conta. Escolha outra voz.");
        const r = ex.escolherVoz({ id: v.id, nome: v.nome });
        return r.ok ? { ok: true, voz: { id: v.id, nome: v.nome } } : recusado(r);
      },
      salvarModoVoz: async (modo) => {
        await espera0();
        const r = ex.salvarModoVoz(modo);
        return r.ok ? { ok: true, modo } : recusado(r);
      },
      // a "cópia" do exemplo: o destino ganha os 4 últimos da origem (o exemplo não guarda chave)
      usarChaveElevenLabs: async (para) => {
        await espera0();
        const origem = chaveDe(para === "voz" ? "transcricao" : "voz");
        // a origem sem os 4 últimos não tem chave (P5): nada se grava, e o null do T1 ("nada copiado")
        // não aparece com uma linha nova no destino
        if (!origem || origem.provedor !== "elevenlabs" || origem.status === "removida" || !origem.ultimos4)
          return falha("sem_chave");
        const ultimos4 = origem.ultimos4;
        const r = ex.trocarChaveIA(para, {
          provedor: "elevenlabs",
          modelo: para === "transcricao" ? "scribe_v2" : "",
          ultimos4,
        });
        return r.ok ? { ok: true, ultimos4 } : recusado(r);
      },
      desconectarCelular: async () => {
        await espera0();
        return { ok: true };
      },
    };
  }, [ex]);

  return { modo: "exemplo", euId: estado.eu.id, conexao, chaves, configuracao, acoes };
}
