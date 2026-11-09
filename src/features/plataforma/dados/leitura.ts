import type { UseQueryResult } from "@tanstack/react-query";

import { traduzirErro } from "./erros";
import type { Leitura } from "./tipos";

// Os ajudantes de toda leitura (spec 2.1, `Leitura<T>`): o resultado do React Query no formato da
// camada, e a leitura já pronta do modo exemplo (o estado em memória não carrega nem falha).

/** O resultado do React Query como `Leitura<T>`: o erro já traduzido e o "Tentar de novo". */
export function paraLeitura<T>(q: UseQueryResult<T>): Leitura<T> {
  return {
    dados: q.data,
    carregando: q.isPending,
    erro: q.error ? traduzirErro(q.error).erro : null,
    tentarDeNovo: () => void q.refetch(),
  };
}

/** Uma leitura que já chegou (o modo exemplo, ou o que não precisa ir ao banco). */
export function pronta<T>(dados: T): Leitura<T> {
  return { dados, carregando: false, erro: null, tentarDeNovo: () => {} };
}
