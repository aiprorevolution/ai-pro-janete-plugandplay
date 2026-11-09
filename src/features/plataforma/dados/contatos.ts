import { keepPreviousData, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

import { diaLocal, type Instante } from "../comum/tempo";
import { contadores, linhaDoBanco, linhasDaTabela, periodoDeEntrada } from "../contatos/dados";
import type {
  Contadores,
  ConversaDaLinhaBanco,
  EstadoContatos,
  EventoContato,
  FiltrosTabela,
  LinhaContatoBanco,
  PaginaContatosBanco,
  PaginaTabela,
  RecorteTabela,
} from "../contatos/tipos";
import { useExemplo } from "../exemplo/ProvedorExemplo";
import type { OrigemPassagem, TipoMensagem } from "../exemplo/tipos";
import { CHAVES } from "./chaves";
import { COLUNAS_MENSAGEM, lerTodas, type ClienteFirebase } from "./colunas";
import {
  opcoesContato,
  useContato,
  useConversaDoContato,
  useEventos,
  useHistoricoContato,
  useMensagens,
} from "./conversa";
import { traduzirErro } from "./erros";
import { pronta } from "./leitura";
import { repetirSoFalha } from "./leituras";
import { useClienteDados, useDados, useModoDados } from "./ProvedorDados";
import type { ContatoDados, EventoConversaDados, Leitura, MensagemDados } from "./tipos";

// As leituras próprias da tela de Contatos (spec de ligar as telas ao banco, 2.1, "As leituras de cada
// área"; decisão 12): a tabela pela rpc `contatos_lista` (páginas de 50), as abas de contador pela
// `contatos_contadores` e o perfil montado com as leituras de conversa comuns (dados/conversa.ts),
// mais as mídias, a 1ª mensagem do lead e o total de mensagens da conversa.
//
// Igual nos dois modos: no banco, React Query sobre o cliente do navegador (sob RLS), com as chaves
// embaixo de CHAVES.contatos e CHAVES.mensagens (o tempo real e as ações invalidam pelo POR_TABELA);
// no exemplo, as mesmas formas saem do estado em memória, pelas mesmas regras puras de
// contatos/dados.ts. O modo não muda enquanto o provedor está montado, por isso cada hook escolhe a
// implementação uma vez pelo modo.

/** Quantos contatos cada página da tabela traz (decisão 12). */
export const TAMANHO_PAGINA_CONTATOS = 50;

/** Quanto tempo uma leitura vale antes de ser relida ao montar outra tela (o tempo real invalida antes). */
const VALE_MS = 15_000;

/** Os tipos de mensagem que contam como mídia (aba Mídias e linha do tempo; o ehMidiaValida da tela). */
const TIPOS_MIDIA: readonly TipoMensagem[] = ["audio", "imagem", "video", "documento", "figurinha"];

const RECORTES: readonly RecorteTabela[] = ["todos", "precisam", "novos_hoje", "com_janete", "comigo"];

/* ---------- os formatos do banco ---------- */

const texto = (x: unknown): string | null => (typeof x === "string" ? x : null);
const numero = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function lerConversaDaLinha(x: unknown): ConversaDaLinhaBanco | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const id = texto(o["id"]);
  const modo = o["modo"];
  if (!id || (modo !== "janete" && modo !== "humano")) return null;
  return {
    id,
    modo,
    responsavel_id: texto(o["responsavel_id"]),
    motivo_humano: (texto(o["motivo_humano"]) as ConversaDaLinhaBanco["motivo_humano"]) ?? null,
    aguardando_humano_desde: texto(o["aguardando_humano_desde"]),
    ultima_mensagem_em: texto(o["ultima_mensagem_em"]),
    ultima_do_lead_em: texto(o["ultima_do_lead_em"]),
    ultima_da_janete_em: texto(o["ultima_da_janete_em"]),
    nao_lidas: numero(o["nao_lidas"]) ?? 0,
  };
}

/**
 * O jsonb `{total, linhas}` de `contatos_lista` no formato da tela. A linha sem `contato_id` ou sem
 * etapa sai (não deveria acontecer); cada linha ganha `id` = contato_id, para o tempo real tirar do
 * cache o contato apagado (removerPorId), e o total desce junto.
 */
export function lerPaginaContatos(json: unknown): PaginaContatosBanco {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { total: 0, linhas: [] };
  const o = json as Record<string, unknown>;
  const linhas: LinhaContatoBanco[] = [];
  for (const x of Array.isArray(o["linhas"]) ? (o["linhas"] as unknown[]) : []) {
    if (!x || typeof x !== "object") continue;
    const l = x as Record<string, unknown>;
    const contatoId = texto(l["contato_id"]);
    const etapaId = texto(l["etapa_id"]);
    const criadoEm = texto(l["criado_em"]);
    if (!contatoId || !etapaId || !criadoEm) continue;
    const primeira = texto(l["primeira_mensagem_em"]);
    linhas.push({
      id: contatoId,
      contato_id: contatoId,
      nome: texto(l["nome"]),
      nome_whatsapp: texto(l["nome_whatsapp"]),
      telefone: texto(l["telefone"]),
      email: texto(l["email"]),
      empresa: texto(l["empresa"]),
      etapa_id: etapaId,
      etapa_ordem: numero(l["etapa_ordem"]),
      primeira_mensagem_em: primeira,
      criado_em: criadoEm,
      entrou_em: texto(l["entrou_em"]) ?? primeira ?? criadoEm,
      ultima_mensagem_em: texto(l["ultima_mensagem_em"]),
      conversa: lerConversaDaLinha(l["conversa"]),
    });
  }
  const total = numero(o["total"]);
  return { total: total === null ? linhas.length : Math.max(total, 0), linhas };
}

/** O jsonb de `contatos_contadores` como os 5 números das abas (o que faltar conta 0). */
export function lerContadores(json: unknown): Contadores {
  const r: Contadores = { todos: 0, precisam: 0, novos_hoje: 0, com_janete: 0, comigo: 0 };
  if (!json || typeof json !== "object" || Array.isArray(json)) return r;
  const o = json as Record<string, unknown>;
  for (const k of RECORTES) {
    const n = Number(o[k]);
    r[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return r;
}

/* ---------- a tabela ---------- */

/** O que vai para `contatos_lista`: os filtros da tela, com o "Entrou em" em dias de São Paulo. */
export interface ParametrosLista {
  busca: string;
  recorte: RecorteTabela;
  /** Em ordem, para a chave não mudar quando a pessoa marca as mesmas etapas em outra ordem. */
  etapas: string[];
  entradaDe: string | null;
  entradaAte: string | null;
  ordem: FiltrosTabela["ordem"]["coluna"];
  direcao: FiltrosTabela["ordem"]["direcao"];
  deslocamento: number;
  /** O dia de hoje em São Paulo: "Novos hoje" e o "Entrou em" mudam na virada do dia. */
  dia: string;
}

/** A página pedida (0 = a primeira); um valor estranho vira 0. */
export function paginaDe(filtros: Pick<FiltrosTabela, "pagina">): number {
  const p = filtros.pagina ?? 0;
  return Number.isFinite(p) && p > 0 ? Math.floor(p) : 0;
}

export function parametrosDaLista(filtros: FiltrosTabela, agora: Instante): ParametrosLista {
  const { de, ate } = periodoDeEntrada(filtros.entrada, agora);
  return {
    busca: filtros.busca.trim(),
    recorte: filtros.recorte,
    etapas: [...new Set(filtros.etapaIds)].sort(),
    entradaDe: de,
    entradaAte: ate,
    ordem: filtros.ordem.coluna,
    direcao: filtros.ordem.direcao,
    deslocamento: paginaDe(filtros) * TAMANHO_PAGINA_CONTATOS,
    dia: diaLocal(agora),
  };
}

export function opcoesListaContatos(cliente: ClienteFirebase, p: ParametrosLista) {
  return queryOptions({
    queryKey: [...CHAVES.contatos, "lista", p] as const,
    queryFn: async (): Promise<PaginaContatosBanco> => {
      const { data, error } = await cliente.rpc("contatos_lista", {
        p_busca: p.busca,
        p_recorte: p.recorte,
        p_etapas: p.etapas,
        // Nulo = sem limite daquele lado (a função aceita; o types.ts gerado não marca como opcional).
        p_entrada_de: p.entradaDe as string,
        p_entrada_ate: p.entradaAte as string,
        p_ordem: p.ordem,
        p_direcao: p.direcao,
        p_limite: TAMANHO_PAGINA_CONTATOS,
        p_deslocamento: p.deslocamento,
      });
      if (error) throw error;
      return lerPaginaContatos(data);
    },
    // Trocar de página, de busca ou de filtro mostra a página anterior até a nova chegar (sem piscar).
    placeholderData: keepPreviousData,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesContadoresContatos(cliente: ClienteFirebase, dia: string) {
  return queryOptions({
    queryKey: [...CHAVES.contatos, "contadores", dia] as const,
    queryFn: async (): Promise<Contadores> => {
      const { data, error } = await cliente.rpc("contatos_contadores");
      if (error) throw error;
      return lerContadores(data);
    },
    placeholderData: keepPreviousData,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

/** A leitura da tabela: a página e, enquanto a próxima chega, `atualizando` (a anterior continua na tela). */
export interface LeituraTabela extends Leitura<PaginaTabela> {
  atualizando: boolean;
}

/** Junta o estado de várias leituras: carrega enquanto alguma carrega, e o 1º erro vale. */
function juntarEstados(leituras: readonly Pick<Leitura<unknown>, "carregando" | "erro" | "tentarDeNovo">[]) {
  return {
    carregando: leituras.some((l) => l.carregando),
    erro: leituras.find((l) => l.erro)?.erro ?? null,
    tentarDeNovo: () => {
      for (const l of leituras) if (l.erro) l.tentarDeNovo();
    },
  };
}

function useListaBanco(filtros: FiltrosTabela, agora: number): LeituraTabela {
  const cliente = useClienteDados();
  const fonte = useDados();
  const eu = fonte.useEu();
  const membros = fonte.useMembros();
  const etapas = fonte.useEtapas();
  const q = useQuery({ ...opcoesListaContatos(cliente!, parametrosDaLista(filtros, agora)), enabled: !!cliente });
  const pagina = q.data;
  const linhas = useMemo<PaginaTabela | undefined>(() => {
    if (!pagina || !membros.dados || !etapas.dados) return undefined;
    const estado = { membros: membros.dados, eu: eu.membro, etapas: etapas.dados };
    return { total: pagina.total, linhas: pagina.linhas.map((l) => linhaDoBanco(l, estado, agora)) };
  }, [pagina, membros.dados, etapas.dados, eu.membro, agora]);
  const lista: Leitura<unknown> = {
    dados: q.data,
    carregando: q.isPending,
    erro: q.error ? traduzirErro(q.error).erro : null,
    tentarDeNovo: () => void q.refetch(),
  };
  const estados = juntarEstados([lista, membros, etapas]);
  // Como no perfil: com a página na tela, a releitura que falha fica no aviso compacto e as linhas ficam.
  return {
    dados: linhas,
    carregando: !linhas && !estados.erro,
    erro: estados.erro,
    tentarDeNovo: estados.tentarDeNovo,
    atualizando: q.isPlaceholderData || (q.isFetching && !q.isPending),
  };
}

function useListaExemplo(filtros: FiltrosTabela, agora: number): LeituraTabela {
  const { estado } = useExemplo();
  return useMemo(() => {
    const todas = linhasDaTabela(estado, filtros, agora);
    const de = paginaDe(filtros) * TAMANHO_PAGINA_CONTATOS;
    return { ...pronta({ total: todas.length, linhas: todas.slice(de, de + TAMANHO_PAGINA_CONTATOS) }), atualizando: false };
  }, [estado, filtros, agora]);
}

/** A página da tabela de Contatos, com os filtros da tela (no banco, `contatos_lista`). */
export function useListaContatos(filtros: FiltrosTabela, agora: number): LeituraTabela {
  const usar = useModoDados() === "banco" ? useListaBanco : useListaExemplo;
  return usar(filtros, agora);
}

function useContadoresBanco(agora: number): Leitura<Contadores> {
  const cliente = useClienteDados();
  const q = useQuery({ ...opcoesContadoresContatos(cliente!, diaLocal(agora)), enabled: !!cliente });
  return {
    dados: q.data,
    carregando: q.isPending,
    erro: q.error ? traduzirErro(q.error).erro : null,
    tentarDeNovo: () => void q.refetch(),
  };
}

function useContadoresExemplo(agora: number): Leitura<Contadores> {
  const { estado } = useExemplo();
  return useMemo(() => pronta(contadores(estado, agora)), [estado, agora]);
}

/** O número de cada aba de contador (no banco, `contatos_contadores`). */
export function useContadoresContatos(agora: number): Leitura<Contadores> {
  const usar = useModoDados() === "banco" ? useContadoresBanco : useContadoresExemplo;
  return usar(agora);
}

/* ---------- o perfil ---------- */

/** O que o perfil lê da conversa além das páginas de mensagens: todas as mídias, a 1ª do lead e o total. */
export interface ExtrasPerfil {
  /** As mídias que contam (não canceladas nem apagadas), da mais antiga para a mais nova. */
  midias: MensagemDados[];
  /** A 1ª mensagem do lead (não cancelada nem apagada), para a linha do tempo. */
  primeiraDoLead: MensagemDados | null;
  /** Quantas mensagens a conversa tem, sem as canceladas (a aba Conversa e o diálogo de apagar). */
  totalMensagens: number;
}

/** A mensagem do banco com os extras do exemplo (citaId, duracaoS), como dados/conversa.ts entrega. */
function comExtras(m: Omit<MensagemDados, "citaId" | "duracaoS">): MensagemDados {
  return { ...m, citaId: m.responde_a_id ?? null, duracaoS: m.midia_duracao_s ?? null };
}

export function opcoesExtrasPerfil(cliente: ClienteFirebase, conversaId: string) {
  return queryOptions({
    // Embaixo de [...mensagens, conversaId]: a mensagem nova (tempo real, envio) invalida junto.
    queryKey: [...CHAVES.mensagens, conversaId, "perfil"] as const,
    queryFn: async (): Promise<ExtrasPerfil> => {
      const [midias, primeira, total] = await Promise.all([
        lerTodas<MensagemDados>((de, ate) =>
          cliente
            .from("mensagens")
            .select(COLUNAS_MENSAGEM)
            .eq("conversa_id", conversaId)
            .in("tipo", [...TIPOS_MIDIA])
            .neq("status", "cancelada")
            .is("apagada_em", null)
            .order("momento", { ascending: true })
            .order("criado_em", { ascending: true })
            .order("id", { ascending: true })
            .range(de, ate),
        ),
        cliente
          .from("mensagens")
          .select(COLUNAS_MENSAGEM)
          .eq("conversa_id", conversaId)
          .eq("origem", "lead")
          .neq("status", "cancelada")
          .is("apagada_em", null)
          .order("momento", { ascending: true })
          .order("criado_em", { ascending: true })
          .order("id", { ascending: true })
          .limit(1),
        cliente
          .from("mensagens")
          .select("id", { count: "exact", head: true })
          .eq("conversa_id", conversaId)
          .neq("status", "cancelada"),
      ]);
      if (primeira.error) throw primeira.error;
      if (total.error) throw total.error;
      const p = (primeira.data ?? [])[0];
      return {
        midias: midias.map(comExtras),
        primeiraDoLead: p ? comExtras(p) : null,
        totalMensagens: typeof total.count === "number" ? total.count : 0,
      };
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

const ORIGENS: readonly OrigemPassagem[] = ["janete", "espera", "outro", "celular"];

/** Uma linha de `conversa_eventos` no formato da tela (o `de` fora da lista vira nulo). */
export function paraEventoContato(e: EventoConversaDados): EventoContato {
  const de = ORIGENS.find((o) => o === e.de) ?? null;
  return {
    id: e.id,
    conversa_id: e.conversa_id,
    tipo: e.tipo,
    membro_id: e.membro_id,
    motivo: e.motivo,
    de,
    de_membro_id: e.de_membro_id,
    por_envio: e.por_envio,
    criado_em: e.criado_em,
  };
}

/** As mensagens das páginas, as mídias e a 1ª do lead, sem repetir id. */
function juntarMensagens(...grupos: readonly (readonly MensagemDados[] | undefined)[]): MensagemDados[] {
  const vistas = new Set<string>();
  const todas: MensagemDados[] = [];
  for (const g of grupos) {
    for (const m of g ?? []) {
      if (vistas.has(m.id)) continue;
      vistas.add(m.id);
      todas.push(m);
    }
  }
  return todas;
}

/**
 * O perfil de um contato: o estado que as abas leem (o do exemplo, ou a "visão" montada com as
 * leituras do banco), o carregar das mensagens mais antigas e o total de mensagens.
 * `dados.contatos` vem vazio quando o contato não existe (ou foi apagado).
 */
export interface LeituraPerfil extends Leitura<EstadoContatos> {
  /** Há mensagens antes das que já vieram (a aba Conversa mostra "Carregar mensagens mais antigas"). */
  temMaisAntigas: boolean;
  carregarMaisAntigas: () => void;
  carregandoMaisAntigas: boolean;
  /** Quantas mensagens a conversa tem, sem as canceladas; nulo = conte as do estado (o exemplo tem todas). */
  totalMensagens: number | null;
  /**
   * As mensagens das páginas já lidas (a aba Conversa mostra só estas, sem buraco no meio); nulo = todas
   * as do estado (o exemplo). As mídias e a 1ª do lead entram no estado inteiras, para a linha do tempo.
   */
  idsDaConversa: ReadonlySet<string> | null;
}

function usePerfilBanco(contatoId: string): LeituraPerfil {
  const cliente = useClienteDados();
  const fonte = useDados();
  const eu = fonte.useEu();
  const membros = fonte.useMembros();
  const etapas = fonte.useEtapas();
  const conexao = fonte.useConexaoAtiva();
  const contato = useContato(contatoId);
  const conversa = useConversaDoContato(contatoId);
  const conversaId = conversa.dados?.id ?? null;
  const historico = useHistoricoContato(contatoId);
  const eventos = useEventos(conversaId);
  const mensagens = useMensagens(conversaId);
  const q = useQuery({ ...opcoesExtrasPerfil(cliente!, conversaId ?? ""), enabled: !!cliente && !!conversaId });
  const extras: Leitura<ExtrasPerfil | null> = conversaId
    ? { dados: q.data, carregando: q.isPending, erro: q.error ? traduzirErro(q.error).erro : null, tentarDeNovo: () => void q.refetch() }
    : pronta(null);

  const leituras = [membros, etapas, conexao, contato, conversa, historico, eventos, mensagens, extras];
  const estados = juntarEstados(leituras);
  const pronto = leituras.every((l) => l.dados !== undefined);

  const visao = useMemo<EstadoContatos | undefined>(() => {
    if (!pronto) return undefined;
    const c = contato.dados ?? null;
    const cv = conversa.dados ?? null;
    return {
      eu: eu.membro,
      membros: membros.dados ?? [],
      etapas: etapas.dados ?? [],
      contatos: c ? [c] : [],
      conversas: cv ? [cv] : [],
      mensagens: juntarMensagens(mensagens.dados, extras.dados?.midias, extras.dados?.primeiraDoLead ? [extras.dados.primeiraDoLead] : []),
      historico: historico.dados ?? [],
      eventos: (eventos.dados ?? []).map(paraEventoContato),
      // O banco não tem o "digitando" da Janete: o "ao vivo" sai das mensagens dos últimos 5 minutos.
      digitando: [],
      conexao: conexao.dados ?? null,
    };
  }, [pronto, eu.membro, membros.dados, etapas.dados, contato.dados, conversa.dados, mensagens.dados, extras.dados, historico.dados, eventos.dados, conexao.dados]);

  const paginas = mensagens.dados;
  const idsDaConversa = useMemo(() => new Set((paginas ?? []).map((m) => m.id)), [paginas]);

  // Com o perfil montado, a releitura que falha (o React Query guarda os dados) não o tira da tela: os
  // dados ficam, e o erro vai junto para o aviso compacto (comum/releitura). Sem o perfil, o erro manda.
  return {
    dados: visao,
    carregando: !visao && !estados.erro,
    erro: estados.erro,
    tentarDeNovo: estados.tentarDeNovo,
    temMaisAntigas: mensagens.temMaisAntigas,
    carregarMaisAntigas: mensagens.carregarMaisAntigas,
    carregandoMaisAntigas: mensagens.carregandoMaisAntigas,
    totalMensagens: extras.dados ? extras.dados.totalMensagens : null,
    idsDaConversa,
  };
}

function usePerfilExemplo(): LeituraPerfil {
  const { estado } = useExemplo();
  return useMemo(
    () => ({
      ...pronta<EstadoContatos>(estado),
      temMaisAntigas: false,
      carregarMaisAntigas: () => {},
      carregandoMaisAntigas: false,
      totalMensagens: null,
      idsDaConversa: null,
    }),
    [estado],
  );
}

/** O perfil do contato (as abas e o cabeçalho leem daqui; no banco, as leituras ficam no cache e se dividem). */
export function usePerfilContato(contatoId: string): LeituraPerfil {
  const usar = useModoDados() === "banco" ? usePerfilBanco : usePerfilExemplo;
  return usar(contatoId);
}

type BuscarContato = (id: string) => Promise<Pick<ContatoDados, "id"> | null>;

function useBuscarBanco(): BuscarContato {
  const cliente = useClienteDados();
  const queryClient = useQueryClient();
  return useCallback(
    async (id: string) => {
      if (!cliente) return null;
      try {
        return await queryClient.fetchQuery(opcoesContato(cliente, id));
      } catch {
        // A leitura falhou (rede): o perfil abre e mostra o próprio erro, com "Tentar de novo".
        return { id };
      }
    },
    [cliente, queryClient],
  );
}

function useBuscarExemplo(): BuscarContato {
  const { estado } = useExemplo();
  const contatos = useRef(estado.contatos);
  contatos.current = estado.contatos;
  return useCallback(async (id: string) => contatos.current.find((c) => c.id === id) ?? null, []);
}

/**
 * Procura o contato do endereço (`?contato=`) para o useAbrirPorId: no banco, pelo cache ou numa
 * leitura (a mesma do useContato, que fica no cache); no exemplo, no estado. Uma falha de leitura
 * devolve só o id: o perfil abre e mostra o próprio erro, com "Tentar de novo".
 */
export function useBuscarContato(): BuscarContato {
  const usar = useModoDados() === "banco" ? useBuscarBanco : useBuscarExemplo;
  return usar();
}
