import type { FirebaseClient } from "@/integrations/firebase/client-contract";

import type { Database } from "@/integrations/firebase/types";

// As colunas que as telas leem, uma a uma (nunca select('*'): conexoes e ia_chaves têm grant por
// coluna, e o '*' pediria `segredos` e `chave_cifrada`, que o authenticated não lê). Cada lista é a
// do tipo de mesmo nome em exemplo/tipos.ts; as áreas reaproveitam.

/** O cliente do Firebase do navegador (src/integrations/firebase/client.ts), ou um falso nos testes. */
export type ClienteFirebase = FirebaseClient<Database>;

/** Com `vistos` (`{ kanban: iso, tour: iso }`): o "visto em" por pessoa do Kanban e do tour. */
export const COLUNAS_MEMBRO = "id, nome, email, papel, ativo, user_id, criado_em, vistos" as const;

export const COLUNAS_ETAPA = "id, chave, nome, ordem, tipo, cor, janete_pode_mover, arquivada" as const;

/** Sem `segredos` nem `parametros`: a tela nunca vê. */
export const COLUNAS_CONEXAO =
  "id, nome, gateway, status, ativa, oficial, id_externo, ultimo_erro, criado_em, atualizado_em" as const;

/** Sem `chave_cifrada` (nem o admin lê) e sem `workspace_id`. */
export const COLUNAS_CHAVE_IA =
  "id, finalidade, provedor, modelo, status, ultimos4, ultimo_erro, validada_em, atualizada_em, atualizada_por" as const;

/**
 * Com `worker_visto_em`: o último sinal do worker (a Saúde da Configuração, decisão 10). E a voz em
 * uso (spec-voz-uso, P1): o modo, a voz escolhida e o motivo do erro dela.
 */
export const COLUNAS_CONFIGURACAO =
  "id, espera_lote_s, espera_lote_max_s, onboarding_concluido_em, atualizado_em, worker_visto_em, voz_resposta, voz_id, voz_nome, voz_erro" as const;

export const COLUNAS_CONTEXTO =
  "id, empresa_oferta, cliente_ideal, preco, diferenciais, objecoes, quando_passar_humano, tom_voz, horario, itens, origem, criado_por, criado_em, numero, restaurada_de" as const;

export const COLUNAS_CONVERSA =
  "id, contato_id, conexao_id, modo, motivo_humano, responsavel_id, aguardando_humano_desde, devolvida_em, nao_lidas, ultima_do_lead_em, ultima_mensagem_em, ultima_mensagem_preview, criado_em, atualizado_em, ultima_mensagem_id, ultima_da_janete_em" as const;

/**
 * Com `id_externo` e `id_gateway`: o "Tentar de novo" (decisão 8, `podeTentarDeNovo` da Bolha) não
 * aparece quando o gateway já deu um id à mensagem (ela pode ter chegado), como o `reenviar_mensagem`.
 * As áreas levam os dois campos até a `MensagemBolha`. Com `responde_a_id` (a citação, decisão 5) e
 * `midia_duracao_s` (o tempo do áudio).
 */
export const COLUNAS_MENSAGEM =
  "id, conversa_id, conexao_id, direcao, origem, tipo, status, texto, transcricao, momento, autor_membro_id, midia_nome, midia_mime, midia_tamanho, midia_caminho, midia_status, editada, apagada_em, erro, id_externo, id_gateway, criado_em, responde_a_id, midia_duracao_s" as const;

export const COLUNAS_CONTATO =
  "id, nome, nome_whatsapp, telefone, email, empresa, etapa_id, etapa_desde, observacoes, resumo_janete, primeira_mensagem_em, criado_em, atualizado_em, resumo_janete_em, anotacoes_janete" as const;

/** Com `rodada_id`: o motivo do movimento da Janete fica na rodada (premissa da spec, decisão 13). */
export const COLUNAS_HISTORICO = "id, contato_id, de_etapa_id, para_etapa_id, ator, membro_id, criado_em, rodada_id" as const;

/** As passagens do bastão (`conversa_eventos`, decisão 8). */
export const COLUNAS_EVENTO = "id, conversa_id, tipo, membro_id, de, de_membro_id, motivo, por_envio, criado_em" as const;

/** O PostgREST corta em 1.000 linhas sem avisar: as leituras sem paginação leem em páginas deste tamanho. */
export const PAGINA_POSTGREST = 1000;

/**
 * Lê todas as linhas de uma consulta, de 1.000 em 1.000. A consulta precisa de uma ordem com
 * desempate (por exemplo, a data e depois o id), senão a página pode repetir ou pular linha.
 */
export async function lerTodas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA_POSTGREST) {
    const { data, error } = await pagina(de, de + PAGINA_POSTGREST - 1);
    if (error) throw error;
    const linhas = data ?? [];
    todas.push(...linhas);
    if (linhas.length < PAGINA_POSTGREST) return todas;
  }
}
