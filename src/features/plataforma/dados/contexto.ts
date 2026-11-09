import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Json } from "@/integrations/firebase/types";

import { CHAVES } from "./chaves";
import { COLUNAS_CONTEXTO, type ClienteFirebase } from "./colunas";
import { recusado, traduzirErro } from "./erros";
import { paraLeitura } from "./leitura";
import { opcoesContextoAtual, repetirSoFalha } from "./leituras";
import { useClienteDados } from "./ProvedorDados";
import type { Leitura, Resultado, VersaoContextoBanco } from "./tipos";

// As leituras e as ações do Contexto (task C6; spec 2.3, "33-equipe-contexto.sql", e decisão 11):
//   - a versão atual vem de `useDados().useContextoAtual()` (a de maior id, a mesma que a Janete usa);
//   - o histórico é paginado: as 30 mais recentes e "Ver mais antigas" (premissa do bloco 3);
//   - uma versão qualquer, por id (a que está na tela, vendo uma antiga);
//   - salvar pela rpc `contexto_salvar(p_base, p_mudancas)`, só com os campos mudados: o banco junta
//     as mudanças de dois admins por campo e devolve `contexto_mudou` quando o mesmo campo mudou
//     (decisão 11b), `limite_tamanho` acima de 2.000 letras (11d) e `limite_itens` acima de 50
//     perguntas livres;
//   - restaurar pela rpc `contexto_restaurar(p_versao)`, que grava `restaurada_de`.
// Tudo pelo cliente do navegador, sob RLS (o membro lê; só o admin grava), com as chaves embaixo de
// CHAVES.contexto: invalidar a raiz relê a atual (a casca também lê), o histórico e a versão aberta.

/** Quantas versões cada página do histórico traz. */
export const TAMANHO_PAGINA_CONTEXTO = 30;

/** O limite de letras de cada campo e de cada resposta livre (decisão 11d; conferido também no banco). */
export const LIMITE_LETRAS_CONTEXTO = 2000;

/** As 8 colunas de texto de `contexto_versoes`, as que `contexto_salvar` aceita. */
export const CAMPOS_TEXTO_CONTEXTO = [
  "empresa_oferta",
  "cliente_ideal",
  "preco",
  "diferenciais",
  "objecoes",
  "quando_passar_humano",
  "tom_voz",
  "horario",
] as const;

export type CampoTextoContexto = (typeof CAMPOS_TEXTO_CONTEXTO)[number];

/** Um item de `contexto_versoes.itens` (o formato que a Janete lê). */
export interface ItemContextoBanco {
  pergunta: string;
  resposta: string;
}

/** O `p_mudancas` de `contexto_salvar`: só o que mudou. A lista de itens vai inteira e conta como um campo. */
export type MudancasContexto = Partial<Record<CampoTextoContexto, string>> & { itens?: ItemContextoBanco[] | undefined };

/** O que `contexto_salvar` e `contexto_restaurar` devolvem: a versão gravada (ou a atual, se nada mudou). */
export interface VersaoGravada {
  id: number;
  numero: number;
}

/** Uma página do histórico, da mais nova para a mais velha. */
export interface PaginaHistoricoContexto {
  linhas: VersaoContextoBanco[];
  /** A versão logo antes da última da página (a 31ª), para o resumo dela; nula na última página. */
  anterior: VersaoContextoBanco | null;
  /** O número de cada versão conhecida, por id (inclui as de `restaurada_de` de fora da página). */
  numeros: Readonly<Record<number, number>>;
  /** O deslocamento da próxima página; nulo quando não há mais antigas. */
  proxima: number | null;
}

/** O histórico paginado, como a gaveta usa. `dados` são as páginas já lidas, em ordem. */
export interface LeituraHistoricoContexto extends Leitura<PaginaHistoricoContexto[]> {
  temMaisAntigas: boolean;
  /** Busca a página seguinte (não faz nada sem `temMaisAntigas` ou enquanto busca). */
  carregarMaisAntigas: () => void;
  carregandoMaisAntigas: boolean;
}

const VALE_MS = 15_000;

/* ---------- ajudantes ---------- */

/** Os itens livres da coluna jsonb: só os que têm pergunta e resposta em texto. */
export function lerItensContexto(json: unknown): ItemContextoBanco[] {
  if (!Array.isArray(json)) return [];
  const itens: ItemContextoBanco[] = [];
  for (const x of json) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const { pergunta, resposta } = x as Record<string, unknown>;
    if (typeof pergunta === "string" && typeof resposta === "string") itens.push({ pergunta, resposta });
  }
  return itens;
}

/** O `{id, numero}` que as duas rpcs devolvem; nulo se a resposta não tiver a forma certa. */
export function lerVersaoGravada(json: unknown): VersaoGravada | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const id = Number(o["id"]);
  const numero = Number(o["numero"]);
  return Number.isInteger(id) && id > 0 && Number.isInteger(numero) && numero > 0 ? { id, numero } : null;
}

/* ---------- leituras ---------- */

export function opcoesHistoricoContexto(cliente: ClienteFirebase) {
  return infiniteQueryOptions({
    queryKey: [...CHAVES.contexto, "historico"] as const,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<PaginaHistoricoContexto> => {
      const de = pageParam;
      // uma a mais que a página: ela diz se há mais antigas e dá o resumo da última da página
      const { data, error } = await cliente
        .from("contexto_versoes")
        .select(COLUNAS_CONTEXTO)
        .order("id", { ascending: false })
        .range(de, de + TAMANHO_PAGINA_CONTEXTO);
      if (error) throw error;
      const todas: VersaoContextoBanco[] = data ?? [];
      const linhas = todas.slice(0, TAMANHO_PAGINA_CONTEXTO);
      const numeros: Record<number, number> = {};
      for (const l of todas) if (l.numero !== null) numeros[l.id] = l.numero;
      // "Restauração da versão N": o número da versão de origem, mesmo fora da página
      const faltam = [
        ...new Set(linhas.map((l) => l.restaurada_de).filter((x): x is number => x !== null && numeros[x] === undefined)),
      ];
      if (faltam.length) {
        const r = await cliente.from("contexto_versoes").select("id, numero").in("id", faltam);
        if (r.error) throw r.error;
        for (const x of r.data ?? []) if (x.numero !== null) numeros[x.id] = x.numero;
      }
      return {
        linhas,
        anterior: todas[TAMANHO_PAGINA_CONTEXTO] ?? null,
        numeros,
        proxima: todas.length > TAMANHO_PAGINA_CONTEXTO ? de + TAMANHO_PAGINA_CONTEXTO : null,
      };
    },
    getNextPageParam: (ultima) => ultima.proxima ?? undefined,
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

export function opcoesVersaoContexto(cliente: ClienteFirebase, id: number) {
  return queryOptions({
    queryKey: [...CHAVES.contexto, "versao", id] as const,
    queryFn: async (): Promise<VersaoContextoBanco | null> => {
      const { data, error } = await cliente.from("contexto_versoes").select(COLUNAS_CONTEXTO).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: VALE_MS,
    retry: repetirSoFalha,
  });
}

function exigirCliente(cliente: ClienteFirebase | null, quem: string): ClienteFirebase {
  if (!cliente) throw new Error(`${quem} só funciona no <ProvedorDados fonte="banco">.`);
  return cliente;
}

/** O histórico do Contexto, de 30 em 30 (só no modo banco). */
export function useHistoricoContexto(): LeituraHistoricoContexto {
  const cliente = exigirCliente(useClienteDados(), "useHistoricoContexto()");
  const q = useInfiniteQuery(opcoesHistoricoContexto(cliente));
  return {
    dados: q.data?.pages,
    carregando: q.isPending,
    erro: q.error ? traduzirErro(q.error).erro : null,
    tentarDeNovo: () => void q.refetch(),
    temMaisAntigas: !!q.hasNextPage,
    carregarMaisAntigas: () => {
      if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
    },
    carregandoMaisAntigas: q.isFetchingNextPage,
  };
}

/** Uma versão por id (nula = não existe). Sem id, nula sem ir ao banco (só no modo banco). */
export function useVersaoContexto(id: number | null): Leitura<VersaoContextoBanco | null> {
  const cliente = exigirCliente(useClienteDados(), "useVersaoContexto()");
  const q = useQuery({ ...opcoesVersaoContexto(cliente, id ?? 0), enabled: id !== null && id > 0 });
  const leitura = paraLeitura(q);
  if (id === null || id <= 0) return { dados: null, carregando: false, erro: null, tentarDeNovo: () => {} };
  return leitura;
}

/* ---------- ações ---------- */

/** `contexto_salvar`: `base` nulo só quando ainda não há versão (a 1ª vira a versão 1). */
export async function salvarContextoBanco(
  cliente: ClienteFirebase,
  base: number | null,
  mudancas: MudancasContexto,
): Promise<Resultado<VersaoGravada>> {
  try {
    const { data, error } = await cliente.rpc("contexto_salvar", {
      // o tipo gerado não diz, mas o banco aceita nulo (ainda sem versão)
      p_base: base as number,
      p_mudancas: mudancas as Json,
    });
    if (error) return recusado(error);
    const valor = lerVersaoGravada(data);
    return valor ? { ok: true, id: String(valor.id), valor } : { ok: false, erro: "falha", detalhe: "contexto_salvar sem {id, numero}" };
  } catch (e) {
    return recusado(e);
  }
}

/** `contexto_restaurar`: uma versão nova igual à `versaoId`, com origem "restauracao". */
export async function restaurarContextoBanco(cliente: ClienteFirebase, versaoId: number): Promise<Resultado<VersaoGravada>> {
  try {
    const { data, error } = await cliente.rpc("contexto_restaurar", { p_versao: versaoId });
    if (error) return recusado(error);
    const valor = lerVersaoGravada(data);
    return valor ? { ok: true, id: String(valor.id), valor } : { ok: false, erro: "falha", detalhe: "contexto_restaurar sem {id, numero}" };
  } catch (e) {
    return recusado(e);
  }
}

export interface AcoesContextoBanco {
  /**
   * Salva e relê o Contexto (a atual, o histórico e a casca) antes de voltar. Com `contexto_mudou`,
   * também relê antes de voltar, e `atual` traz a versão que o outro admin gravou.
   */
  salvar(base: number | null, mudancas: MudancasContexto): Promise<Resultado<VersaoGravada> & { atual?: VersaoContextoBanco | null }>;
  restaurar(versaoId: number): Promise<Resultado<VersaoGravada>>;
}

/** As ações do Contexto no modo banco. */
export function useAcoesContextoBanco(): AcoesContextoBanco {
  const cliente = exigirCliente(useClienteDados(), "useAcoesContextoBanco()");
  const qc = useQueryClient();
  return useMemo<AcoesContextoBanco>(() => {
    const reler = () => qc.invalidateQueries({ queryKey: CHAVES.contexto });
    // A conta perdeu o acesso (desativada, ou deixou de ser admin): o Eu é relido (spec 2.2) e a
    // casca leva para /sem-acesso, ou o papel novo tira o editor da tela.
    const relerEuSeSemAcesso = (r: Resultado<unknown>) => {
      if (!r.ok && r.erro === "sem_acesso") void qc.invalidateQueries({ queryKey: CHAVES.eu });
    };
    return {
      salvar: async (base, mudancas) => {
        const r = await salvarContextoBanco(cliente, base, mudancas);
        if (r.ok) {
          await reler();
          return r;
        }
        if (r.erro === "contexto_mudou") {
          await reler();
          const atual = await qc.fetchQuery(opcoesContextoAtual(cliente)).catch(() => undefined);
          return atual === undefined ? r : { ...r, atual };
        }
        relerEuSeSemAcesso(r);
        return r;
      },
      restaurar: async (versaoId) => {
        const r = await restaurarContextoBanco(cliente, versaoId);
        if (r.ok) await reler();
        relerEuSeSemAcesso(r);
        return r;
      },
    };
  }, [cliente, qc]);
}
