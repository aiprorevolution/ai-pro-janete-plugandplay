import { useEffect, useRef, useState } from "react";

import { useModoDados } from "./ProvedorDados";

// Abrir pelo endereço com id (`?conversa=`, `?contato=`; plano, "Peças comuns", item 6), com a
// leitura assíncrona e paginada: confere se o id é um uuid, espera a lista carregar, procura (a
// área decide: primeiro na página, depois fora dela, no banco), abre e limpa o parâmetro do endereço.
// Roda uma vez por valor: limpar e voltar ao mesmo id abre de novo.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor: string): boolean {
  return UUID.test(valor);
}

export type SituacaoAbrir = "ocioso" | "esperando" | "buscando" | "aberto" | "nao_encontrado" | "invalido";

export interface OpcoesAbrirPorId<T> {
  /** A lista da tela já carregou (enquanto não, espera). */
  pronto: boolean;
  /** Abre o item achado (seleciona a conversa, abre o perfil). */
  abrir: (item: T) => void;
  /** Tira o parâmetro do endereço (navigate com search sem o id). */
  limpar: () => void;
  /** Não achou, ou o id não é válido (a tela pode avisar). */
  naoAchou?: (() => void) | undefined;
}

/**
 * `buscar(id)` procura o item: na página carregada e, se não estiver, fora dela (uma leitura por id).
 * Devolve o item, ou null/undefined quando não existe (ou a RLS esconde).
 */
export function useAbrirPorId<T>(
  valor: string | null | undefined,
  buscar: (id: string) => T | null | undefined | Promise<T | null | undefined>,
  opcoes: OpcoesAbrirPorId<T>,
): SituacaoAbrir {
  const modo = useModoDados();
  const [situacao, setSituacao] = useState<SituacaoAbrir>("ocioso");
  const feito = useRef<string | null>(null);
  const ultimas = useRef({ buscar, opcoes });
  ultimas.current = { buscar, opcoes };

  useEffect(() => {
    if (!valor) {
      feito.current = null;
      setSituacao("ocioso");
      return;
    }
    if (feito.current === valor) return;
    const id = valor.trim();
    // No exemplo, os ids não são uuid ("cv-1"); no banco, qualquer outra coisa nem vai à consulta.
    if (modo === "banco" && !ehUuid(id)) {
      feito.current = valor;
      setSituacao("invalido");
      ultimas.current.opcoes.naoAchou?.();
      ultimas.current.opcoes.limpar();
      return;
    }
    if (!opcoes.pronto) {
      setSituacao("esperando");
      return;
    }
    feito.current = valor;
    setSituacao("buscando");
    let vivo = true;
    void (async () => {
      let item: T | null | undefined = null;
      try {
        item = await ultimas.current.buscar(id);
      } catch {
        item = null;
      }
      if (!vivo) return;
      const { abrir, limpar, naoAchou } = ultimas.current.opcoes;
      if (item !== null && item !== undefined) {
        abrir(item);
        setSituacao("aberto");
      } else {
        naoAchou?.();
        setSituacao("nao_encontrado");
      }
      limpar();
    })();
    return () => {
      vivo = false;
      // desmontou (ou o valor mudou) no meio da busca: a próxima vez busca de novo
      if (feito.current === valor) feito.current = null;
    };
  }, [valor, opcoes.pronto, modo]);

  return situacao;
}
