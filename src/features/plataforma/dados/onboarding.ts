import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, createElement, useContext, useMemo, useRef, type ReactNode } from "react";

import type { CampoContexto } from "@/features/onboarding/roteiro";
import type {
  EntradaEscolherVoz,
  EntradaSalvarChaveIA,
  EntradaSalvarConexao,
  EntradaUsarChaveElevenLabs,
  ResultadoEscolherVoz,
  ResultadoListarVozes,
  ResultadoSalvarChaveIA,
  ResultadoSalvarConexao,
  ResultadoUsarChaveElevenLabs,
} from "@/features/mensageria/configuracao.functions";
import type {
  EntradaDesconectarCelular,
  EntradaQr,
  ResultadoDesconectarCelularConexao,
  ResultadoPedirQr,
} from "@/features/mensageria/qr.functions";
import type { ProvedorIA } from "@/features/servidor/chave-ia";
import type { Gateway } from "@/features/servidor/conexao";
import type { Json } from "@/integrations/firebase/types";

import type { ChaveIA, Conexao } from "../exemplo/tipos";
import { CHAVES } from "./chaves";
import type { ClienteFirebase } from "./colunas";
import type { ServidorDados } from "./ProvedorDados";
import { traduzirErro } from "./erros";
import { opcoesChaves, opcoesConexaoAtiva, opcoesConfiguracao, opcoesContextoAtual } from "./leituras";
import type { ConfiguracaoDados, Leitura, Resultado, VersaoContextoBanco } from "./tipos";

// As leituras e ações do onboarding (C8; spec de ligar as telas ao banco, decisões 2 e 14).
// O onboarding fica fora de /app (não tem o ProvedorDados da plataforma): ele monta este provedor
// próprio, com as mesmas peças da camada (CHAVES, as leituras comuns, traduzirErro, Leitura<T>).
//
// - gravado: o que já está no banco (a conexão ativa, a chave de resposta e o Contexto atual), para
//   quem sai no meio recomeçar dali (decisão 14d);
// - salvarConexao e salvarChaveIA: as funções de servidor da mensageria (só admin). A falha da
//   chamada (rede, sessão) sobe como rejeição, como nos validadores, para a tela saber dizer qual foi;
// - listarVozes e escolherVoz: a lista de vozes da conta da ElevenLabs e a voz da Janete (spec do uso
//   da voz, C4), do mesmo jeito;
// - usarChaveElevenLabs: a cópia, no servidor, da chave da voz para a escuta (spec da escuta com a
//   ElevenLabs, E4 e P8), do mesmo jeito;
// - salvarContexto: a rpc contexto_salvar, com origem onboarding e a versão atual como base;
// - concluir: a rpc concluir_onboarding (pode repetir sem efeito); deu certo, pede um toque no
//   motor sem esperar (spec-motor-acordado), para a Janete começar a atender já.

/** Os gateways que o onboarding oferece: o conector do Descontinuado saiu (decisão 14a). */
export type GatewayOnboarding = Exclude<Gateway, "descontinuado">;

export const GATEWAYS_ONBOARDING: readonly GatewayOnboarding[] = ["meta", "zernio", "zapi", "evolution"];

const PROVEDORES_RESPOSTA: readonly ProvedorIA[] = ["anthropic", "openai", "openrouter", "gemini"];

export const CAMPOS_DO_CONTEXTO: readonly CampoContexto[] = [
  "empresa_oferta",
  "cliente_ideal",
  "preco",
  "diferenciais",
  "objecoes",
  "quando_passar_humano",
  "tom_voz",
  "horario",
];

export type RespostasGravadas = Record<CampoContexto, string>;

/** O que já foi gravado no banco, no formato do estado do onboarding. Nulo = ainda não gravado. */
export interface GravadoOnboarding {
  /** A conexão ativa (`nome` é o rótulo: o número ou a instância). */
  conexao: { gateway: GatewayOnboarding; nome: string } | null;
  /** A chave de resposta ativa. */
  cerebro: { provedor: ProvedorIA; modelo: string; ultimos4: string } | null;
  /** A chave de voz ativa (a da ElevenLabs). */
  voz: { ultimos4: string } | null;
  /**
   * Já há uma chave que transcreve áudio (a do cartão Escuta, inclusive a da ElevenLabs, ou a da
   * voz), em uso para o servidor.
   */
  escuta: boolean;
  /** O Contexto atual (a versão de maior id, a mesma que a Janete usa). */
  contexto: { id: number; respostas: RespostasGravadas } | null;
}

export const NADA_GRAVADO: GravadoOnboarding = { conexao: null, cerebro: null, voz: null, escuta: false, contexto: null };

/** A versão gravada pela rpc contexto_salvar. */
export interface VersaoGravada {
  id: number;
  numero: number;
}

/** As funções de servidor que o onboarding chama (as reais vêm de mensageria/configuracao.functions). */
export interface ServidorOnboarding {
  salvarConexao: (entrada: EntradaSalvarConexao) => Promise<ResultadoSalvarConexao>;
  salvarChaveIA: (entrada: EntradaSalvarChaveIA) => Promise<ResultadoSalvarChaveIA>;
  /** O QR da Z-API ou da Evolution com os campos colados (mensageria/qr.functions). Não grava. */
  pedirQr: (entrada: EntradaQr) => Promise<ResultadoPedirQr>;
  /** As vozes da conta da chave de voz guardada e a voz escolhida hoje. Não grava. */
  listarVozes: () => Promise<ResultadoListarVozes>;
  /** Confere a voz na ElevenLabs e a grava como a voz da Janete (configuracao). */
  escolherVoz: (entrada: EntradaEscolherVoz) => Promise<ResultadoEscolherVoz>;
  /** Tira o celular da instância ("Desconectar e ler de novo", mensageria/qr.functions). Não grava. */
  desconectarCelular: (entrada: EntradaDesconectarCelular) => Promise<ResultadoDesconectarCelularConexao>;
  /** Copia, no servidor, a chave da ElevenLabs do outro cartão (a voz → a escuta). A chave nunca volta. */
  usarChaveElevenLabs: (entrada: EntradaUsarChaveElevenLabs) => Promise<ResultadoUsarChaveElevenLabs>;
  /** O toque no motor do ServidorDados, depois de concluir. Sem ele, o motor acorda na próxima mensagem. */
  acordarMotor?: ServidorDados["acordarMotor"];
}

export interface DadosOnboarding {
  gravado: Leitura<GravadoOnboarding>;
  salvarConexao: ServidorOnboarding["salvarConexao"];
  salvarChaveIA: ServidorOnboarding["salvarChaveIA"];
  /** A falha da chamada sobe como rejeição; nada é relido (o QR não grava). */
  pedirQr: ServidorOnboarding["pedirQr"];
  /** A falha da chamada sobe como rejeição; nada é relido (não grava). */
  listarVozes: ServidorOnboarding["listarVozes"];
  /** No ok, a leitura da configuracao fica velha. A falha da chamada sobe como rejeição. */
  escolherVoz: ServidorOnboarding["escolherVoz"];
  /** A falha da chamada sobe como rejeição; nada é relido (o banco não muda). */
  desconectarCelular: ServidorOnboarding["desconectarCelular"];
  /** No ok, a leitura das chaves fica velha. A falha da chamada sobe como rejeição. */
  usarChaveElevenLabs: ServidorOnboarding["usarChaveElevenLabs"];
  /** Grava as 8 respostas como versão nova do Contexto (origem onboarding). Nunca lança. */
  salvarContexto: (respostas: RespostasGravadas) => Promise<Resultado<VersaoGravada>>;
  /** Marca o onboarding da empresa como concluído. Devolve a data gravada. Nunca lança. */
  concluir: () => Promise<Resultado<string>>;
}

/* ---------- leitura do que já foi gravado ---------- */

export function conexaoGravada(c: Conexao | null | undefined): GravadoOnboarding["conexao"] {
  if (!c || !c.ativa || c.status === "desconectada") return null;
  const gateway = (GATEWAYS_ONBOARDING as readonly string[]).includes(c.gateway) ? (c.gateway as GatewayOnboarding) : null;
  const nome = (c.nome ?? "").trim();
  if (!gateway || !nome) return null;
  return { gateway, nome };
}

export function cerebroGravado(chaves: readonly ChaveIA[] | null | undefined): GravadoOnboarding["cerebro"] {
  const chave = (chaves ?? []).find((k) => k.finalidade === "resposta" && k.status === "ativa");
  if (!chave || !PROVEDORES_RESPOSTA.includes(chave.provedor as ProvedorIA)) return null;
  const modelo = (chave.modelo ?? "").trim();
  const ultimos4 = (chave.ultimos4 ?? "").trim();
  if (!modelo || !ultimos4) return null;
  return { provedor: chave.provedor as ProvedorIA, modelo, ultimos4 };
}

/** A chave de voz ativa (a da ElevenLabs). Não exige modelo: a voz grava modelo vazio. */
export function vozGravada(chaves: readonly ChaveIA[] | null | undefined): GravadoOnboarding["voz"] {
  const chave = (chaves ?? []).find(
    (k) => k.finalidade === "voz" && k.provedor === "elevenlabs" && k.status === "ativa",
  );
  const ultimos4 = (chave?.ultimos4 ?? "").trim();
  return ultimos4 ? { ultimos4 } : null;
}

/**
 * Já há quem transcreva sem o cérebro: a chave do cartão Escuta (OpenAI, OpenRouter, Groq ou
 * ElevenLabs) ou a da voz (ElevenLabs), nem removida nem inválida (a mesma regra do servidor,
 * lerChaveUtilizavel; sem crédito ainda conta). Com a Anthropic, é ela que decide o aviso do áudio
 * (decisão 1 das lacunas da mensageria).
 */
export function escutaGravada(chaves: readonly ChaveIA[] | null | undefined): boolean {
  return (chaves ?? []).some(
    (k) => (k.finalidade === "transcricao" || k.finalidade === "voz") && k.status !== "removida" && k.status !== "invalida",
  );
}

export function contextoGravado(v: VersaoContextoBanco | null | undefined): GravadoOnboarding["contexto"] {
  if (!v) return null;
  const respostas = {} as RespostasGravadas;
  for (const campo of CAMPOS_DO_CONTEXTO) respostas[campo] = typeof v[campo] === "string" ? v[campo] : "";
  return { id: v.id, respostas };
}

/* ---------- ações do modo banco ---------- */

/** Lê o `{ id, numero }` que contexto_salvar devolve (jsonb). */
function lerVersao(json: Json | null): VersaoGravada | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const id = Number((json as Record<string, unknown>)["id"]);
  const numero = Number((json as Record<string, unknown>)["numero"]);
  return Number.isFinite(id) && Number.isFinite(numero) ? { id, numero } : null;
}

export interface DepsAcoesOnboarding {
  cliente: ClienteFirebase;
  queryClient: QueryClient;
  /** A versão do Contexto que a tela abriu (a base do contexto_salvar); nula = não há versão. */
  base: () => number | null;
  /** Guarda a versão gravada como base da próxima gravação. */
  aoGravarContexto: (versao: VersaoGravada) => void;
  /** Pede um toque no motor (ServidorDados.acordarMotor), sem esperar. Sem ele, nada é pedido. */
  acordarMotor?: (() => Promise<unknown>) | undefined;
}

/** As ações que vão ao banco pelo cliente (contexto_salvar e concluir_onboarding). */
export function criarAcoesOnboardingBanco({ cliente, queryClient, base, aoGravarContexto, acordarMotor }: DepsAcoesOnboarding) {
  const salvarContexto = async (respostas: RespostasGravadas): Promise<Resultado<VersaoGravada>> => {
    try {
      const mudancas: Record<string, string> = {};
      for (const campo of CAMPOS_DO_CONTEXTO) mudancas[campo] = (respostas[campo] ?? "").trim();
      const { data, error } = await cliente.rpc("contexto_salvar", {
        // nula só quando ainda não há versão (o banco confere e devolve contexto_mudou se já houver)
        p_base: base() as number,
        p_mudancas: mudancas,
        p_origem: "onboarding",
      });
      if (error) throw error;
      const versao = lerVersao(data);
      if (!versao) return { ok: false, erro: "falha", detalhe: "contexto_salvar sem id" };
      aoGravarContexto(versao);
      void queryClient.invalidateQueries({ queryKey: CHAVES.contexto });
      return { ok: true, id: String(versao.id), valor: versao };
    } catch (e) {
      const t = traduzirErro(e);
      if (t.erro === "sem_acesso") void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
      return { ok: false, ...t };
    }
  };

  const concluir = async (): Promise<Resultado<string>> => {
    try {
      const { data, error } = await cliente.rpc("concluir_onboarding");
      if (error) throw error;
      if (typeof data !== "string" || !data) return { ok: false, erro: "falha", detalhe: "concluir_onboarding sem data" };
      // A guarda de / lê o "concluído" do cache: grava já, e relê do banco por trás.
      const chave = opcoesConfiguracao(cliente).queryKey;
      queryClient.setQueryData<ConfiguracaoDados>(chave, (atual) =>
        atual ? { ...atual, onboarding_concluido_em: data } : atual,
      );
      void queryClient.invalidateQueries({ queryKey: CHAVES.configuracao });
      // a Janete já pode atender: o toque sai sem esperar (um toque que falha é aceito, decisão 2)
      if (acordarMotor) {
        try {
          void Promise.resolve(acordarMotor()).catch(() => {});
        } catch {
          // sem o toque, o motor acorda na próxima mensagem
        }
      }
      return { ok: true, valor: data };
    } catch (e) {
      const t = traduzirErro(e);
      if (t.erro === "sem_acesso") void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
      return { ok: false, ...t };
    }
  };

  return { salvarContexto, concluir };
}

/** Depois de gravar a conexão ou a chave, as leituras delas ficam velhas. */
function aposServidor<E, R extends { ok: boolean; erro?: string }>(
  queryClient: QueryClient,
  chave: readonly string[],
  chamar: (e: E) => Promise<R>,
): (e: E) => Promise<R> {
  return async (entrada) => {
    const r = await chamar(entrada);
    if (r.ok) void queryClient.invalidateQueries({ queryKey: chave });
    else if (r.erro === "sem_acesso") void queryClient.invalidateQueries({ queryKey: CHAVES.eu });
    return r;
  };
}

/** O que o banco já tem, nas leituras comuns da camada (as mesmas chaves do React Query da plataforma). */
function useGravadoBanco(cliente: ClienteFirebase): Leitura<GravadoOnboarding> {
  const conexao = useQuery(opcoesConexaoAtiva(cliente));
  const chaves = useQuery(opcoesChaves(cliente, true));
  const contexto = useQuery(opcoesContextoAtual(cliente));
  const consultas = [conexao, chaves, contexto];
  const comErro = consultas.find((q) => q.error);
  const carregando = consultas.some((q) => q.isPending) && !comErro;
  const dados = useMemo<GravadoOnboarding | undefined>(
    () =>
      conexao.data !== undefined && chaves.data !== undefined && contexto.data !== undefined
        ? {
            conexao: conexaoGravada(conexao.data),
            cerebro: cerebroGravado(chaves.data),
            voz: vozGravada(chaves.data),
            escuta: escutaGravada(chaves.data),
            contexto: contextoGravado(contexto.data),
          }
        : undefined,
    [conexao.data, chaves.data, contexto.data],
  );
  return {
    dados: comErro ? undefined : dados,
    carregando,
    erro: comErro?.error ? traduzirErro(comErro.error).erro : null,
    tentarDeNovo: () => {
      for (const q of consultas) if (q.error || q.data === undefined) void q.refetch();
    },
  };
}

/** O modo banco: o cliente do navegador e as funções de servidor (as reais, ou falsas nos testes). */
export function useDadosOnboardingBanco(cliente: ClienteFirebase, servidor: ServidorOnboarding): DadosOnboarding {
  const queryClient = useQueryClient();
  const gravado = useGravadoBanco(cliente);
  // a base do contexto_salvar: a última versão gravada por esta tela, senão a que o banco tem
  const baseGravada = useRef<number | null>(null);
  const baseLida = useRef<number | null>(null);
  baseLida.current = gravado.dados?.contexto?.id ?? null;
  const servidorRef = useRef(servidor);
  servidorRef.current = servidor;

  const acoes = useMemo(() => {
    const banco = criarAcoesOnboardingBanco({
      cliente,
      queryClient,
      base: () => {
        const a = baseGravada.current;
        const b = baseLida.current;
        if (a === null) return b;
        return b === null ? a : Math.max(a, b);
      },
      aoGravarContexto: (v) => {
        baseGravada.current = v.id;
      },
      acordarMotor: () => servidorRef.current.acordarMotor?.() ?? Promise.resolve(),
    });
    return {
      ...banco,
      salvarConexao: aposServidor(queryClient, CHAVES.conexao, (e: EntradaSalvarConexao) => servidorRef.current.salvarConexao(e)),
      salvarChaveIA: aposServidor(queryClient, CHAVES.chaves, (e: EntradaSalvarChaveIA) => servidorRef.current.salvarChaveIA(e)),
      pedirQr: (e: EntradaQr) => servidorRef.current.pedirQr(e),
      listarVozes: () => servidorRef.current.listarVozes(),
      escolherVoz: aposServidor(queryClient, CHAVES.configuracao, (e: EntradaEscolherVoz) => servidorRef.current.escolherVoz(e)),
      desconectarCelular: (e: EntradaDesconectarCelular) => servidorRef.current.desconectarCelular(e),
      usarChaveElevenLabs: aposServidor(queryClient, CHAVES.chaves, (e: EntradaUsarChaveElevenLabs) =>
        servidorRef.current.usarChaveElevenLabs(e),
      ),
    };
  }, [cliente, queryClient]);

  return useMemo(() => ({ gravado, ...acoes }), [gravado, acoes]);
}

/* ---------- provedor ---------- */

const ContextoDadosOnboarding = createContext<DadosOnboarding | null>(null);

/** Os dados do onboarding. Só dentro do `<ProvedorDadosOnboarding>` (o Onboarding monta). */
export function useDadosOnboarding(): DadosOnboarding {
  const valor = useContext(ContextoDadosOnboarding);
  if (!valor) throw new Error("useDadosOnboarding() precisa do <ProvedorDadosOnboarding> em volta (o Onboarding põe).");
  return valor;
}

export function ProvedorDadosOnboarding({ dados, children }: { dados: DadosOnboarding; children: ReactNode }) {
  return createElement(ContextoDadosOnboarding.Provider, { value: dados }, children);
}

/* ---------- modo de teste (sem banco) ---------- */

export interface OpcoesDadosMemoria {
  gravado?: GravadoOnboarding;
  salvarConexao?: DadosOnboarding["salvarConexao"];
  salvarChaveIA?: DadosOnboarding["salvarChaveIA"];
  pedirQr?: DadosOnboarding["pedirQr"];
  listarVozes?: DadosOnboarding["listarVozes"];
  escolherVoz?: DadosOnboarding["escolherVoz"];
  desconectarCelular?: DadosOnboarding["desconectarCelular"];
  usarChaveElevenLabs?: DadosOnboarding["usarChaveElevenLabs"];
  salvarContexto?: DadosOnboarding["salvarContexto"];
  concluir?: DadosOnboarding["concluir"];
}

const NAO_LIGADO = (nome: string) => () => Promise.reject(new Error(`${nome} não foi passado ao modo de teste`));

/**
 * Os dados do onboarding sem banco, para os testes: o gravado já chegou (nada, por padrão) e cada
 * ação é a que o teste passar. Uma ação não passada rejeita (a tela mostra a falha de rede).
 */
export function criarDadosOnboardingMemoria(opcoes: OpcoesDadosMemoria = {}): DadosOnboarding {
  return {
    gravado: { dados: opcoes.gravado ?? NADA_GRAVADO, carregando: false, erro: null, tentarDeNovo: () => {} },
    salvarConexao: opcoes.salvarConexao ?? NAO_LIGADO("salvarConexao"),
    salvarChaveIA: opcoes.salvarChaveIA ?? NAO_LIGADO("salvarChaveIA"),
    pedirQr: opcoes.pedirQr ?? NAO_LIGADO("pedirQr"),
    listarVozes: opcoes.listarVozes ?? NAO_LIGADO("listarVozes"),
    escolherVoz: opcoes.escolherVoz ?? NAO_LIGADO("escolherVoz"),
    desconectarCelular: opcoes.desconectarCelular ?? NAO_LIGADO("desconectarCelular"),
    usarChaveElevenLabs: opcoes.usarChaveElevenLabs ?? NAO_LIGADO("usarChaveElevenLabs"),
    salvarContexto: opcoes.salvarContexto ?? (() => Promise.resolve({ ok: true, valor: { id: 1, numero: 1 } })),
    concluir: opcoes.concluir ?? (() => Promise.resolve({ ok: true, valor: "2026-11-02T12:00:00-03:00" })),
  };
}
