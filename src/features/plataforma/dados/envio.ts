import type { TablesInsert } from "@/integrations/firebase/types";

import type { Conversa } from "../exemplo/tipos";
import type { ClienteFirebase } from "./colunas";
import { recusado } from "./erros";
import type { NovaMensagemDados } from "./fonte";
import type { Resultado } from "./tipos";

// O envio pela tela (spec 2.1, envio.ts; plano, "Peças comuns", item 7; decisão 7):
// - cada mensagem nasce com o id gerado no navegador (o eco do tempo real casa pelo id);
// - o bucket `midias` é garantido pelo servidor uma vez por sessão, antes do 1º upload;
// - o arquivo sobe em `midias/{conversa_id}/{id}`;
// - o insert vai com status 'na_fila' explícito e sem conexao_id (o gatilho tg_mensagens_antes_inserir
//   põe a conexão ativa e recusa sem_conexao_ativa e janela_fechada);
// - uma por vez, esperando a anterior, para o lead receber na ordem;
// - depois do último insert da leva, pede uma passada de envio ao servidor, sem esperar a resposta.
// As duas chamadas ao servidor (pedirEnvio e garantirBucketMidias) chegam por parâmetro: as funções
// de servidor são da F4 (plataforma/dados/servidor.functions.ts).

export const BUCKET_MIDIAS = "midias";

/** O que o servidor devolve: `{ ok: true }` ou `{ ok: false, erro }` (spec 2.4). */
export type RespostaServidor = { ok: boolean; erro?: string | undefined; mensagem?: string | undefined } | void;

export interface DepsEnvio {
  cliente: ClienteFirebase;
  /** F4: `garantirBucketMidias()`. */
  garantirBucketMidias: () => Promise<RespostaServidor>;
  /** F4: `pedirEnvio()`. Chamado sem esperar a resposta. */
  pedirEnvio: () => Promise<unknown>;
  /** O id da mensagem (testes fixam). Padrão: crypto.randomUUID(). */
  gerarId?: (() => string) | undefined;
  /**
   * Confere, antes de subir um arquivo, o que a tela já sabe (conexão ativa e janela de 24 h): a
   * recusa volta sem subir nada. Null deixa seguir (o banco confere no insert de qualquer jeito).
   */
  conferirAntesDoArquivo?: ((conversaId: string) => Resultado | null) | undefined;
  /**
   * Lê o modo e o responsável da conversa logo antes do insert, para o resultado dizer `assumiu`.
   * Null (ou erro) deixa o resultado sem `assumiu`; o envio segue de qualquer jeito.
   */
  lerConversaAntes?: ((conversaId: string) => Promise<ConversaAntes | null>) | undefined;
}

export interface Enviador {
  enviar(conversaId: string, m: NovaMensagemDados): Promise<Resultado>;
  /** Pede a passada de envio sem esperar (o "Tentar de novo" usa depois do reenviar_mensagem). */
  pedirEnvioSemEsperar(): void;
}

/** O caminho do arquivo no bucket `midias`. */
export function caminhoDaMidia(conversaId: string, mensagemId: string): string {
  return `${conversaId}/${mensagemId}`;
}

function idNovo(): string {
  return globalThis.crypto.randomUUID();
}

/** A duração em segundos inteiros, como a coluna guarda; o que não é número ≥ 0 vira nulo. */
function duracaoInteira(s: number | null | undefined): number | null {
  return typeof s === "number" && Number.isFinite(s) && s >= 0 ? Math.round(s) : null;
}

/** O que a conversa era antes da ação: o bastão estava com a Janete, com alguém ou com ninguém. */
export type ConversaAntes = Pick<Conversa, "modo" | "responsavel_id">;

/**
 * Se a mensagem da tela "assume" a conversa (a mesma regra do gatilho tg_mensagens_apos_inserir e
 * do reducer): tira da Janete, da espera ou do celular. Com alguém da equipe (a própria pessoa ou
 * outra), o responsável não muda e não há evento (ajuste 2.6 da spec).
 */
export function assumePorEnvio(antes: ConversaAntes): boolean {
  return antes.modo === "janete" || antes.responsavel_id === null;
}

export function criarEnviador(deps: DepsEnvio): Enviador {
  const gerarId = deps.gerarId ?? idNovo;
  // Sem leitor, o resultado não diz `assumiu` (a tela não afirma o que não sabe).
  const lerAntes = async (conversaId: string): Promise<ConversaAntes | null> => {
    if (!deps.lerConversaAntes) return null;
    try {
      return await deps.lerConversaAntes(conversaId);
    } catch {
      return null;
    }
  };
  let bucket: Promise<Resultado> | null = null;
  let fila: Promise<unknown> = Promise.resolve();
  let pendentes = 0;
  let inseriuNaLeva = false;

  const pedirEnvioSemEsperar = () => {
    try {
      void Promise.resolve(deps.pedirEnvio()).catch(() => {});
    } catch {
      // a passada é só um atalho: o worker manda de qualquer jeito
    }
  };

  // Uma vez por sessão; se falhar, a próxima mensagem com arquivo tenta de novo.
  const garantirBucket = (): Promise<Resultado> => {
    if (!bucket) {
      bucket = (async (): Promise<Resultado> => {
        try {
          const r = await deps.garantirBucketMidias();
          if (r && r.ok === false) return recusado(r);
          return { ok: true };
        } catch (e) {
          return recusado(e);
        }
      })().then((r) => {
        if (!r.ok) bucket = null;
        return r;
      });
    }
    return bucket;
  };

  const enviarUma = async (conversaId: string, m: NovaMensagemDados): Promise<Resultado> => {
    const texto = m.texto?.trim() ? m.texto.trim() : null;
    const arquivo = m.arquivo;
    // Nada para mandar (texto vazio e sem anexo): não grava nem tira a Janete.
    if (!texto && !arquivo && !m.midia) return { ok: true };
    if (m.midia && !arquivo) return { ok: false, erro: "falha", detalhe: "anexo sem o arquivo" };

    const id = gerarId();
    let caminho: string | null = null;
    try {
      if (arquivo) {
        const antes = deps.conferirAntesDoArquivo?.(conversaId) ?? null;
        if (antes && !antes.ok) return antes;
        const b = await garantirBucket();
        if (!b.ok) return b;
        caminho = caminhoDaMidia(conversaId, id);
        const mime = m.midia?.mime ?? (arquivo.type || null);
        const { error } = await deps.cliente.storage
          .from(BUCKET_MIDIAS)
          .upload(caminho, arquivo, { upsert: false, ...(mime ? { contentType: mime } : {}) });
        if (error) return recusado(error);
      }

      const linha = {
        id,
        conversa_id: conversaId,
        direcao: "saida",
        origem: "humano_tela",
        tipo: m.tipo,
        texto,
        status: "na_fila",
        midia_caminho: caminho,
        midia_nome: arquivo ? (m.midia?.nome ?? (arquivo instanceof File ? arquivo.name : null)) : null,
        midia_mime: arquivo ? (m.midia?.mime ?? (arquivo.type || null)) : null,
        midia_tamanho: arquivo ? (m.midia?.tamanho ?? arquivo.size) : null,
        // A citação (decisão 5): a policy mensagens_citacao_mesma_conversa só aceita mensagem da
        // mesma conversa. A duração do áudio gravado, em segundos inteiros (check ≥ 0).
        responde_a_id: m.citaId ?? null,
        midia_duracao_s: duracaoInteira(m.midia?.duracaoS),
      } satisfies Omit<TablesInsert<"mensagens">, "conexao_id">;
      // O estado da conversa logo antes do insert (o mesmo que o gatilho lê): diz se a mensagem tira
      // a conversa da Janete, da espera ou do celular. Lido dentro da fila, depois da anterior gravar.
      const antes = await lerAntes(conversaId);
      // Sem conexao_id de propósito: o gatilho põe a conexão ativa. O types.ts pede a coluna porque
      // ela é NOT NULL; daí o cast.
      const { error } = await deps.cliente.from("mensagens").insert(linha as TablesInsert<"mensagens">);
      // O insert recusado deixa o arquivo já aipro no bucket, sem mensagem. Apagar daqui não adianta:
      // storage.objects não tem regra de apagar para o authenticated (só midias_membro_le e
      // midias_membro_grava, migration 0003), e a remoção falharia em silêncio. Por isso a conferência
      // de antes do upload (conferirAntesDoArquivo); o que sobrar sai com o contato (apagarContato
      // apaga `midias/{conversa_id}/*`).
      if (error) return recusado(error);
      const assumiu = antes ? assumePorEnvio(antes) : undefined;
      return assumiu === undefined ? { ok: true, id } : { ok: true, id, assumiu };
    } catch (e) {
      return recusado(e);
    }
  };

  const enviar = (conversaId: string, m: NovaMensagemDados): Promise<Resultado> => {
    pendentes += 1;
    const rodada = fila.then(() => enviarUma(conversaId, m));
    fila = rodada.then(
      () => undefined,
      () => undefined,
    );
    return rodada.then((r) => {
      pendentes -= 1;
      if (r.ok && r.id) inseriuNaLeva = true;
      // Depois do último insert da leva (nenhuma outra esperando), uma passada só.
      if (pendentes === 0 && inseriuNaLeva) {
        inseriuNaLeva = false;
        pedirEnvioSemEsperar();
      }
      return r;
    });
  };

  return { enviar, pedirEnvioSemEsperar };
}
