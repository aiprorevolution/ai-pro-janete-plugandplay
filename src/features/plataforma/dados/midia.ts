import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Mensagem } from "../exemplo/tipos";
import { CHAVES } from "./chaves";
import { traduzirErro } from "./erros";
import { BUCKET_MIDIAS } from "./envio";
import { useClienteDados } from "./ProvedorDados";
import type { Erro } from "./tipos";

// Os links das mídias (spec 2.1, midia.ts; plano, "Peças comuns", item 5): o bucket `midias` é
// privado, então cada arquivo abre por um link assinado. Os links de uma tela são pedidos de uma vez
// (createSignedUrls, em lote), valem 1 hora e ficam guardados 50 minutos, para a tela nunca usar um
// link perto de vencer. No modo exemplo não há arquivo: nada é pedido.

/** Validade do link assinado, em segundos (1 h). */
export const VALIDADE_LINK_S = 3600;
/** Por quanto tempo um link fica guardado (50 min, antes de vencer). */
export const CACHE_LINK_MS = 50 * 60_000;

/**
 * Em que pé está a mídia de uma mensagem:
 * - `sem`: a mensagem não tem mídia;
 * - `pendente`: o servidor ainda está copiando do WhatsApp (a tela mostra "Carregando a mídia");
 * - `falhou`: não deu para copiar;
 * - `expirada`: o WhatsApp não guardava mais o arquivo quando fomos buscar;
 * - `pronta`: está no bucket e abre pelo link.
 */
export type SituacaoMidia = "sem" | "pendente" | "falhou" | "expirada" | "pronta";

export function situacaoDaMidia(m: Pick<Mensagem, "midia_caminho" | "midia_status">): SituacaoMidia {
  if (m.midia_status === "pendente") return "pendente";
  if (m.midia_status === "falhou") return "falhou";
  if (m.midia_status === "expirada") return "expirada";
  if (m.midia_caminho) return "pronta";
  return "sem";
}

/** Os caminhos das mídias prontas de uma lista de mensagens (o que vai para `useUrlMidia`). */
export function caminhosProntos(mensagens: readonly Pick<Mensagem, "midia_caminho" | "midia_status">[]): string[] {
  const caminhos: string[] = [];
  for (const m of mensagens) if (situacaoDaMidia(m) === "pronta" && m.midia_caminho) caminhos.push(m.midia_caminho);
  return caminhos;
}

export interface UrlsMidia {
  /**
   * caminho → link assinado. O caminho sem link (ainda carregando, ou que falhou) não aparece.
   * Quando a lista muda (mídia nova, pendente que virou copiada, mais uma página), os links já
   * conhecidos continuam aqui enquanto o lote novo é pedido.
   */
  urls: Readonly<Record<string, string>>;
  /** Nenhum link ainda (a 1ª busca do lote). */
  carregando: boolean;
  /**
   * Há uma busca em andamento (a 1ª, a de uma lista nova ou um Tentar de novo). O caminho que ainda
   * não tem link fica "carregando" enquanto isso; só vira erro quando a busca termina sem ele.
   */
  buscando: boolean;
  erro: Erro | null;
  tentarDeNovo: () => void;
}

/**
 * Os links já pedidos, por QueryClient: caminho → link e quando veio. O queryClient.clear() do Sair
 * não troca o objeto, então os links não somem com ele: o Sair chama esquecerLinks(queryClient).
 */
const guardados = new WeakMap<object, Map<string, { url: string; em: number }>>();

/** Esquece os links assinados guardados para este QueryClient (o Sair chama, junto do queryClient.clear()). */
export function esquecerLinks(dono: object): void {
  guardados.delete(dono);
}

/** Quantos links estão guardados para este QueryClient (para os testes). */
export function linksGuardados(dono: object): number {
  return guardados.get(dono)?.size ?? 0;
}

function guardadosDe(dono: object): Map<string, { url: string; em: number }> {
  let mapa = guardados.get(dono);
  if (!mapa) {
    mapa = new Map();
    guardados.set(dono, mapa);
  }
  return mapa;
}

/** Os links assinados de vários caminhos, pedidos em lote (um createSignedUrls para os que faltam). */
export function useUrlMidia(caminhos: readonly string[]): UrlsMidia {
  const cliente = useClienteDados();
  const queryClient = useQueryClient();
  const lista = useMemo(() => [...new Set(caminhos.filter(Boolean))].sort(), [caminhos]);

  const consulta = useQuery({
    queryKey: [...CHAVES.midias, "lote", ...lista] as const,
    enabled: !!cliente && lista.length > 0,
    // A chave muda com a lista: sem isto, a consulta nova começaria sem dados e todas as mídias da
    // conversa voltariam a "Carregando…" por uma ida e volta ao servidor.
    placeholderData: (anterior) => anterior,
    staleTime: CACHE_LINK_MS,
    gcTime: CACHE_LINK_MS,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Record<string, string>> => {
      if (!cliente) return {};
      const agora = Date.now();
      const guardado = guardadosDe(queryClient);
      const urls: Record<string, string> = {};
      const faltam: string[] = [];
      // O que já tem link com menos de 50 min fica; só os outros vão no lote.
      for (const caminho of lista) {
        const g = guardado.get(caminho);
        if (g && agora - g.em < CACHE_LINK_MS) urls[caminho] = g.url;
        else faltam.push(caminho);
      }
      if (faltam.length > 0) {
        const { data, error } = await cliente.storage.from(BUCKET_MIDIAS).createSignedUrls(faltam, VALIDADE_LINK_S);
        if (error) throw error;
        for (const item of data ?? []) {
          if (!item.error && item.path && item.signedUrl) {
            urls[item.path] = item.signedUrl;
            guardado.set(item.path, { url: item.signedUrl, em: agora });
          }
        }
      }
      return urls;
    },
  });

  const ativa = lista.length > 0 && !!cliente;
  return {
    urls: consulta.data ?? {},
    carregando: ativa && consulta.isPending,
    buscando: ativa && (consulta.isPending || consulta.isFetching),
    erro: consulta.error ? traduzirErro(consulta.error).erro : null,
    tentarDeNovo: () => void consulta.refetch(),
  };
}
