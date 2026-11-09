// Worker invocado por Cloud Tasks ou pela recuperação do Cloud Scheduler, com identidade
// Google validada antes desta função. A rota aguarda uma passada e persiste sua continuação.
// Ordem: eventos pendentes, mídias (5), rodadas da Janete (3 por vez), envios (20).
// O prazo é conferido entre itens. Nenhuma rodada
// começa com menos de 20 s até o fim, nem mídia com menos de 15 s; o prazo vai junto para
// responderRodada, transcrever e baixarMidia, que desistem antes dele.
// Envio: o corte do servidor não pode pegar um envio já aceito pelo gateway (geraria reenvio).
// Cada envio só começa quando o teto inteiro do pedido (10 s texto, 20 s mídia) mais a reserva
// do concluir_envio cabe antes de fimEm + 5 s (nucleo/prazo.ts, cabeEnvio).
// Mídias e envios são pegos um por vez, só quando sobra tempo para ele: pegar_midias e
// pegar_envios já contam a tentativa ao pegar, então devolver por falta de tempo gastaria uma
// das 3 tentativas sem tentar de verdade. A devolução fica como exceção. O tipo do envio só se
// sabe depois de pegar: o próximo é pego quando cabe um texto inteiro; se uma mídia vier sem tempo
// e for devolvida, o resto da chamada só pega envio quando cabe uma mídia inteira, para não gastar
// mais tentativas assim.
// Qualquer envio que esgota o tempo ou perde a resposta pode ter chegado ao gateway: ele fica
// "enviando" e o pegar_envios decide em 2 min, pelo eco do gateway (enviada) ou não (falhou,
// sem_resposta_do_envio). Marcar "falhou" na hora mostraria falha de algo que o lead recebeu.
// Duas passadas ao mesmo tempo usam reservas transacionais no Firestore (inclusive os eventos
// pendentes), com expiração e retomada controladas pelo estado persistido.
// O resumo leva só contagens e códigos de erro, nunca dado pessoal.
// somenteEnvios: a passada curta que a tela pede depois de gravar (só a etapa 4, envios).
// Citação: o envio leva o id_externo da mensagem citada (PedidoEnvio.respondeA), da mesma conexão.
// Se o gateway recusar o pedido que cita, sai de novo sem a citação (enviarComCitacao).
import { responderRodada } from "@/features/mensageria/ia/responder.server";
import { transcrever } from "@/features/mensageria/ia/transcrever.server";

import { adaptadorDe } from "../gateways";
import {
  concluirEnvio,
  concluirMidia,
  desistirMidia,
  destinoDoContato,
  eventosPendentes,
  falharEnvio,
  falharRodada,
  gravarTranscricao,
  idExternoDaMensagem,
  marcarEventoComErro,
  marcarEventoProcessado,
  pegarEnvios,
  pegarMidias,
  pegarRodadas,
  type EventoPendente,
  type MensagemFila,
} from "./banco.server";
import { carregarConexao } from "./conexoes.server";
import { dormir } from "./espera";
import { caminhoMidia, enviarArquivo, garantirBucket, urlAssinada } from "./midia.server";
import {
  cabeEnvio,
  FOLGA_CORTE_MS,
  RESERVA_CONCLUIR_ENVIO_MS,
  TETO_ENVIO_MIDIA_MS,
  TETO_ENVIO_TEXTO_MS,
  tetoEnvio,
} from "./prazo";
import {
  ERRO_ENVIO_INCERTO,
  ErroGateway,
  type AdaptadorGateway,
  type ConexaoServidor,
  type PedidoEnvio,
} from "./tipos";
import { aplicarEventos, codigoDoErro, ERRO_TRADUCAO, traduzirSeguro } from "./webhook.server";

export const LIMITE_EVENTOS = 20;
export const LIMITE_MIDIAS = 5;
/** Mídia (download, cópia e transcrição) vai uma por vez, só com pelo menos 15 s até o fim. */
export const LOTE_MIDIAS = 1;
export const FOLGA_MIDIA_MS = 15_000;
/**
 * O download desiste 6 s antes do fim, para sobrar tempo para a cópia no bucket e a
 * transcrição (que não têm prazo próprio aqui).
 */
export const RESERVA_COPIA_MS = 6_000;
/** Áudio: só chama a transcrição com pelo menos 5 s até o fim (menos que isso, ela esgota). */
export const MIN_TRANSCRICAO_MS = 5_000;
/**
 * Teto da mídia, igual ao do download da Z-API, da Zernio e da Evolution: com o tamanho do
 * webhook acima dele, o ciclo desiste sem baixar.
 */
export const MAX_BYTES_MIDIA = 25 * 1024 * 1024;
/** Tentativas de mídia e de envio (pegar_midias e pegar_envios contam ao pegar). */
export const MAX_TENTATIVAS = 3;
export const LIMITE_RODADAS = 3;
/** Nenhuma rodada nova com menos de 20 s até o fim (a IA tem até fimEm - 3 s). */
export const FOLGA_RODADA_MS = 20_000;
export const LIMITE_ENVIOS = 20;
/**
 * Envios vão um por vez: o próximo só é pego se um envio de texto inteiro ainda cabe (até 20
 * chamadas a pegar_envios por passada).
 */
export const LOTE_ENVIOS = 1;
/** Tempo entre pegar o envio e chamar o gateway (conexão, destino, URL assinada). */
export const PREPARO_ENVIO_MS = 1_500;
/**
 * concluir_rodada espaça as bolhas de 2 em 2 s (enviar_apos) e pegar_envios só entrega a 1ª
 * pendente de cada conversa. Quando a fila esvazia depois de um envio, espera isso e pede de
 * novo, para a 2ª e a 3ª bolha saírem nesta passada e não na seguinte.
 */
export const ESPERA_BOLHA_MS = 2_000;
/** Pausas entre as tentativas de concluir_envio depois que o gateway aceitou. */
export const PAUSAS_CONCLUIR_ENVIO_MS = [200, 800] as const;
/**
 * Orçamento de uma chamada da rota, contado do início do pedido (a prova mostrou corte entre
 * 50 e 60 s). É a única fonte desse valor: a rota não repete o número.
 */
export const ORCAMENTO_LACO_MS = 45_000;
/**
 * Menor orçamento da passada curta (somenteEnvios) em que uma mídia cabe: o preparo, o teto do
 * envio de mídia e a reserva do concluir_envio, menos a folga do corte (cabeEnvio). Com menos
 * que isso (os 12 s de hoje no pedirEnvio), a imagem, o áudio ou o documento da tela é pego,
 * gasta uma tentativa e volta para a fila por 30 s, segurando a conversa (decisão 7 não vale
 * para anexo). Quem pede a passada curta deve usar pelo menos este valor.
 */
export const ORCAMENTO_SOMENTE_ENVIOS_MS =
  PREPARO_ENVIO_MS + TETO_ENVIO_MIDIA_MS + RESERVA_CONCLUIR_ENVIO_MS - FOLGA_CORTE_MS;
/** O laço não começa passada nova com menos disso até o fim. */
export const MIN_PASSADA_MS = 5_000;
/** Pausa do laço depois de uma passada que não achou nada para fazer. */
export const ESPERA_OCIOSA_MS = 2_000;
const URL_MIDIA_SEGUNDOS = 3600;
const MAX_ERROS_POR_ETAPA = 20;

type Etapa = "eventos" | "midias" | "rodadas" | "envios";

export type ResumoCiclo = {
  duracao_ms: number;
  /** true = parou antes do fim por falta de tempo. */
  orcamento_esgotado: boolean;
  eventos: { processados: number; pendentes: number; falhas: number };
  midias: { copiadas: number; transcritas: number; falhas: number; devolvidas: number };
  rodadas: { respondidas: number; falhas: number };
  /**
   * devolvidos: mídias devolvidas sem tentar, por falta de tempo. incertos: última tentativa que
   * esgotou o tempo, deixada "enviando" para o pegar_envios decidir.
   */
  envios: { enviados: number; falhas: number; devolvidos: number; incertos: number };
  erros: Record<Etapa, string[]>;
};

export type ResumoLaco = ResumoCiclo & { passadas: number };

export type OpcoesCiclo = {
  /** Prazo absoluto (Date.now()) em que a passada tem de ter acabado. Tem prioridade. */
  fimEm?: number;
  /** Sem fimEm: o prazo é agora + orcamentoMs (padrão 45 s). */
  orcamentoMs?: number;
  /** Etapas que o laço pula nas passadas seguintes à 1ª (padrão: todas rodam). */
  eventos?: boolean;
  midias?: boolean;
  /**
   * true = só pega envio quando cabe um de mídia inteiro (uma mídia já foi devolvida por falta
   * de tempo nesta chamada). Padrão: basta caber um de texto.
   */
  envioComTetoDeMidia?: boolean;
  /**
   * true = só a etapa de envios: pula eventos pendentes, mídias e rodadas. É a passada curta que
   * a tela pede depois de gravar uma mensagem da equipe (pedirEnvio, decisão 7), para ela sair na
   * hora sem esperar o worker. Vale mais que eventos e midias.
   */
  somenteEnvios?: boolean;
};

const TIPOS_ENVIO = new Set<PedidoEnvio["tipo"]>(["texto", "imagem", "audio", "documento"]);

function resumoVazio(): ResumoCiclo {
  return {
    duracao_ms: 0,
    orcamento_esgotado: false,
    eventos: { processados: 0, pendentes: 0, falhas: 0 },
    midias: { copiadas: 0, transcritas: 0, falhas: 0, devolvidas: 0 },
    rodadas: { respondidas: 0, falhas: 0 },
    envios: { enviados: 0, falhas: 0, devolvidos: 0, incertos: 0 },
    erros: { eventos: [], midias: [], rodadas: [], envios: [] },
  };
}

/**
 * Repete rodarCiclo até o orçamento acabar. Cada passada recebe o prazo que sobra (fimEm).
 * Passada que não achou nada para fazer: espera 2 s antes da próxima. Nenhuma passada começa
 * com menos de 5 s até o fim. Eventos pendentes rodam só na 1ª passada (falhar_evento solta a
 * trava: a cada passada gastariam uma das 5 tentativas). Mídia que falhou ou foi
 * devolvida numa passada encerra as mídias desta chamada, pelo mesmo motivo (concluir_midia
 * devolve sem espera); elas voltam na chamada do minuto seguinte.
 * inicioEm: Date.now() da 1ª linha da rota, para o orçamento contar o começo do pedido
 * (autenticação e import do ciclo), como o corte do servidor.
 */
export async function rodarLaco(
  opcoes: { orcamentoMs?: number; inicioEm?: number } = {},
): Promise<ResumoLaco> {
  const orcamentoMs = opcoes.orcamentoMs ?? ORCAMENTO_LACO_MS;
  const inicio = opcoes.inicioEm ?? Date.now();
  const fimEm = inicio + orcamentoMs;
  const total: ResumoLaco = { ...resumoVazio(), passadas: 0 };
  let midias = true;
  let envioComTetoDeMidia = false;

  while (fimEm - Date.now() >= MIN_PASSADA_MS) {
    const primeira = total.passadas === 0;
    const r = await rodarCiclo({
      fimEm,
      eventos: primeira,
      midias,
      envioComTetoDeMidia,
    });
    total.passadas++;
    somar(total, r);
    if (r.midias.falhas > 0 || r.midias.devolvidas > 0) midias = false;
    if (r.envios.devolvidos > 0) envioComTetoDeMidia = true;
    if (!achouTrabalho(r)) {
      if (fimEm - Date.now() - ESPERA_OCIOSA_MS < MIN_PASSADA_MS) break;
      await dormir(ESPERA_OCIOSA_MS);
    }
  }

  total.orcamento_esgotado = Date.now() >= fimEm;
  total.duracao_ms = Date.now() - inicio;
  return total;
}

/** A passada (ou o laço) fez alguma coisa? Também decide a renovação do toque, na rota. */
export function achouTrabalho(r: ResumoCiclo): boolean {
  const contagens = [r.eventos, r.midias, r.rodadas, r.envios].flatMap((g) => Object.values(g));
  return contagens.some((n) => n > 0);
}

function somar(total: ResumoCiclo, r: ResumoCiclo): void {
  const grupos = ["eventos", "midias", "rodadas", "envios"] as const;
  for (const g of grupos) {
    const alvo = total[g] as Record<string, number>;
    for (const [k, v] of Object.entries(r[g] as Record<string, number>)) {
      alvo[k] = (alvo[k] ?? 0) + v;
    }
  }
  for (const etapa of Object.keys(total.erros) as Etapa[]) {
    const lista = total.erros[etapa];
    for (const codigo of r.erros[etapa]) {
      if (lista.length < MAX_ERROS_POR_ETAPA) lista.push(codigo);
    }
  }
}

export async function rodarCiclo(opcoes: OpcoesCiclo = {}): Promise<ResumoCiclo> {
  const inicio = Date.now();
  const fimEm = opcoes.fimEm ?? inicio + (opcoes.orcamentoMs ?? ORCAMENTO_LACO_MS);
  const restante = () => fimEm - Date.now();
  const semTempo = () => restante() <= 0;
  const cabe = (folgaMs: number) => restante() >= folgaMs;

  const resumo = resumoVazio();
  const anotar = (etapa: Etapa, erro: unknown) => {
    const lista = resumo.erros[etapa];
    if (lista.length < MAX_ERROS_POR_ETAPA) lista.push(codigoDoErro(erro));
  };

  // Uma leitura (e uma decifragem) por conexão nesta passada.
  const conexoes = new Map<string, Promise<ConexaoServidor | null>>();
  const conexao = (id: string) => {
    let p = conexoes.get(id);
    if (!p) {
      p = carregarConexao(id);
      conexoes.set(id, p);
    }
    return p;
  };

  const somenteEnvios = opcoes.somenteEnvios === true;

  // 1. Eventos pendentes, pegos com trava: reaplica (tudo é idempotente; status sem mensagem
  // continua pendente).
  if (!somenteEnvios && opcoes.eventos !== false && !semTempo()) {
    try {
      const pendentes = await eventosPendentes(LIMITE_EVENTOS);
      for (const ev of pendentes) {
        if (semTempo()) break;
        await reaplicarEvento(ev, conexao, resumo, anotar);
      }
    } catch (erro) {
      anotar("eventos", erro);
    }
  }

  // 2. Mídias: baixa do gateway e copia para o bucket. Áudio: tenta transcrever.
  if (!somenteEnvios && opcoes.midias !== false) {
    try {
      let pegas = 0;
      lotes: while (pegas < LIMITE_MIDIAS && cabe(FOLGA_MIDIA_MS)) {
        const pedido = Math.min(LOTE_MIDIAS, LIMITE_MIDIAS - pegas);
        const midias = await pegarMidias(pedido);
        pegas += midias.length;
        for (const [i, midia] of midias.entries()) {
          if (semTempo()) {
            // Exceção: devolve as que já foram pegas, para não esperarem a trava de 2 min vencer.
            for (const resto of midias.slice(i)) {
              await soltarMidia(resto, anotar);
              resumo.midias.devolvidas++;
            }
            break lotes;
          }
          await copiarMidia(midia, conexao, resumo, anotar, fimEm);
          // concluir_midia devolve a que falhou sem espera: pegar de novo agora gastaria as
          // tentativas dela em segundos. As mídias param e voltam na chamada seguinte.
          if (resumo.midias.falhas > 0 || resumo.midias.devolvidas > 0) break lotes;
        }
        if (midias.length < pedido) break;
      }
    } catch (erro) {
      anotar("midias", erro);
    }
  }

  // 3. Rodadas: até 3 por vez, em paralelo; nenhuma nova com menos de 20 s até o fim.
  try {
    while (!somenteEnvios && cabe(FOLGA_RODADA_MS)) {
      const rodadas = await pegarRodadas(LIMITE_RODADAS);
      if (rodadas.length === 0) break;
      await Promise.all(
        rodadas.map(async (rodada) => {
          try {
            await responderRodada(rodada, { fimEm });
            resumo.rodadas.respondidas++;
          } catch (erro) {
            resumo.rodadas.falhas++;
            anotar("rodadas", erro);
            // Nenhuma rodada fica presa em "rodando": falha passageira (o banco re-arma).
            try {
              await falharRodada(rodada.id, "erro_provedor", true);
            } catch (erro2) {
              anotar("rodadas", erro2);
            }
          }
        }),
      );
      if (rodadas.length < LIMITE_RODADAS) break;
    }
  } catch (erro) {
    anotar("rodadas", erro);
  }

  // 4. Envios, um de cada vez (as bolhas de uma conversa saem na ordem). Só pega o próximo
  // quando um envio de texto inteiro (preparo, teto do pedido e concluir_envio) ainda termina
  // antes do corte; mídia confere o próprio teto antes de chamar o gateway. Depois de uma mídia
  // devolvida por falta de tempo, só pega quando cabe uma mídia inteira.
  const folgaMidia = TETO_ENVIO_MIDIA_MS + PREPARO_ENVIO_MS;
  let folgaPegar = opcoes.envioComTetoDeMidia ? folgaMidia : TETO_ENVIO_TEXTO_MS + PREPARO_ENVIO_MS;
  try {
    let pegos = 0;
    let pegouDesdeEspera = false;
    while (pegos < LIMITE_ENVIOS && cabeEnvio(folgaPegar, fimEm)) {
      const [envio] = await pegarEnvios(LOTE_ENVIOS);
      if (!envio) {
        // fila vazia depois de um envio: a próxima bolha da mesma conversa vence em até 2 s
        if (!pegouDesdeEspera) break;
        if (!cabeEnvio(folgaPegar + ESPERA_BOLHA_MS, fimEm)) break;
        pegouDesdeEspera = false;
        await dormir(ESPERA_BOLHA_MS);
        continue;
      }
      pegos++;
      pegouDesdeEspera = true;
      await enviarMensagem(envio, conexao, resumo, anotar, fimEm);
      if (resumo.envios.devolvidos > 0) folgaPegar = folgaMidia;
    }
  } catch (erro) {
    anotar("envios", erro);
  }

  resumo.orcamento_esgotado = semTempo();
  resumo.duracao_ms = Date.now() - inicio;
  return resumo;
}

type Anotar = (etapa: Etapa, erro: unknown) => void;
type ConexaoDe = (id: string) => Promise<ConexaoServidor | null>;

async function reaplicarEvento(
  ev: EventoPendente,
  conexao: ConexaoDe,
  resumo: ResumoCiclo,
  anotar: Anotar,
): Promise<void> {
  try {
    const adaptador = adaptadorDe(ev.gateway);
    const c = ev.conexao_id ? await conexao(ev.conexao_id) : null;
    if (!adaptador || !c || c.gateway !== adaptador.gateway) {
      await marcarEventoComErro(ev.id, "conexao_inexistente");
      resumo.eventos.falhas++;
      return;
    }
    // ev.payload é o corpo limpo (limparPayload): ver o contrato de traduzir em tipos.ts.
    const { eventos, falhou } = traduzirSeguro(adaptador, ev.payload, c);
    if (falhou) {
      await marcarEventoComErro(ev.id, ERRO_TRADUCAO);
      resumo.eventos.falhas++;
      anotar("eventos", new Error(ERRO_TRADUCAO));
      return;
    }
    const { pendente } = await aplicarEventos(eventos, c, ev.id);
    if (pendente) {
      await marcarEventoComErro(ev.id, "status_sem_mensagem");
      resumo.eventos.pendentes++;
    } else {
      await marcarEventoProcessado(ev.id);
      resumo.eventos.processados++;
    }
  } catch (erro) {
    resumo.eventos.falhas++;
    anotar("eventos", erro);
    try {
      await marcarEventoComErro(ev.id, codigoDoErro(erro));
    } catch (erro2) {
      anotar("eventos", erro2);
    }
  }
}

async function soltarMidia(m: MensagemFila, anotar: Anotar): Promise<void> {
  try {
    await concluirMidia(m.id, "", "", 0, false);
  } catch (erro) {
    anotar("midias", erro);
  }
}

/**
 * Erro definitivo (grande demais, expirada...): desiste na hora, sem esperar as 3 tentativas.
 * Se o desistir_midia falhar, solta como uma falha comum, para a mídia não ficar presa.
 */
async function desistirDaMidia(m: MensagemFila, codigo: string, anotar: Anotar): Promise<void> {
  try {
    await desistirMidia(m.id, codigo);
  } catch (erro) {
    anotar("midias", erro);
    await soltarMidia(m, anotar);
  }
}

async function copiarMidia(
  m: MensagemFila,
  conexao: ConexaoDe,
  resumo: ResumoCiclo,
  anotar: Anotar,
  fimEm: number,
): Promise<void> {
  try {
    // o tamanho do webhook (Zernio e Evolution) já diz que não cabe: nem baixa
    if (typeof m.midia_tamanho === "number" && m.midia_tamanho > MAX_BYTES_MIDIA) {
      throw new ErroGateway("midia_grande_demais", true);
    }
    const c = await conexao(m.conexao_id);
    const adaptador = c ? adaptadorDe(c.gateway) : null;
    if (!c || !adaptador || !m.midia_ref_externa) throw new Error("conexao_inexistente");

    // o download desiste antes, para sobrar tempo para a cópia e a transcrição
    const baixada = await adaptador.baixarMidia(m.midia_ref_externa, c, {
      fimEm: fimEm - RESERVA_COPIA_MS,
    });
    const mime = baixada.mime || m.midia_mime || "application/octet-stream";
    const caminho = caminhoMidia(m.conversa_id, m.id);
    // O áudio não depende do depósito para ser entendido: se guardar o arquivo falhar, a Janete ainda
    // transcreve e responde. O arquivo fica indisponível no chat; a transcrição fica no banco.
    let guardada = true;
    try {
      await garantirBucket();
      await enviarArquivo(caminho, baixada.bytes, mime);
    } catch (erro) {
      if (m.tipo !== "audio") throw erro;
      guardada = false;
      anotar("midias", erro);
    }

    // Transcrição: sem texto por motivo definitivo, a mídia é concluída do mesmo jeito (a
    // rodada passa o áudio sem transcrição para humano). Falha passageira (429, 5xx, rede,
    // tempo) devolve a mídia para nova tentativa, enquanto houver: a rodada espera a mídia
    // pendente. Na última tentativa, conclui sem texto.
    if (m.tipo === "audio") {
      // Exceção: sem tempo para transcrever, devolve sem chamar o provedor (a transcrição
      // esgotaria pelo prazo do worker do mesmo jeito). Na última tentativa, tenta assim mesmo.
      if (fimEm - Date.now() < MIN_TRANSCRICAO_MS && (m.midia_tentativas ?? 0) < MAX_TENTATIVAS) {
        anotar("midias", new Error("sem_tempo_transcricao"));
        await soltarMidia(m, anotar);
        resumo.midias.devolvidas++;
        return;
      }
      try {
        const r = await transcrever(baixada.bytes, mime, { fimEm, conversaId: m.conversa_id });
        if ("texto" in r && r.texto.trim() !== "") {
          await gravarTranscricao(m.id, r.texto);
          resumo.midias.transcritas++;
        } else if (
          "erro" in r &&
          r.erro === "passageiro" &&
          (m.midia_tentativas ?? 0) < MAX_TENTATIVAS
        ) {
          anotar("midias", new Error("transcricao_passageira"));
          await soltarMidia(m, anotar);
          resumo.midias.devolvidas++;
          return;
        }
      } catch (erro) {
        anotar("midias", erro);
      }
    }

    if (!guardada) {
      // sem arquivo guardado: encerra a mídia (não tenta de novo) para a rodada seguir com a transcrição
      await desistirDaMidia(m, "midia_sem_deposito", anotar);
      return;
    }
    await concluirMidia(m.id, caminho, mime, baixada.bytes.byteLength, true);
    resumo.midias.copiadas++;
  } catch (erro) {
    resumo.midias.falhas++;
    anotar("midias", erro);
    if (erro instanceof ErroGateway && erro.definitivo) {
      await desistirDaMidia(m, erro.codigo, anotar);
    } else {
      await soltarMidia(m, anotar);
    }
  }
}

/**
 * id_externo da mensagem citada, para o PedidoEnvio.respondeA: busca pelo mensagens.responde_a_id
 * (a linha do pegar_envios é a de mensagens), só na mesma conexão do envio. Roda uma vez por
 * envio: o 2º pedido sem a citação (enviarComCitacao) não busca de novo. A citação é enfeite: se
 * a busca falhar, anota e o envio sai sem ela (nunca deixa de enviar por isso).
 */
async function citacaoDoEnvio(m: MensagemFila, anotar: Anotar): Promise<string | null> {
  const citada = m.responde_a_id;
  if (!citada) return null;
  try {
    return await idExternoDaMensagem(citada, m.conexao_id);
  } catch (erro) {
    anotar("envios", erro);
    return null;
  }
}

/**
 * Envia, e manda de novo sem a citação quando o gateway recusa o pedido que cita (citada antiga,
 * apagada ou que o gateway não acha). A citação é enfeite: como na busca da citada que falha, a
 * mensagem nunca deixa de sair por ela. Não dá para saber se a citação foi a causa, então
 * qualquer erro definitivo com citação tenta uma vez sem ela; erro definitivo é recusa (4xx),
 * então não duplica no lead. Vale para os 4 gateways.
 * O segundo pedido só começa se o teto inteiro dele ainda cabe antes do corte (cabeEnvio), com
 * prazo próprio: senão o corte da rota poderia pegar um envio já aceito. Sem tempo, volta para a
 * fila (não definitivo) enquanto houver tentativa; na última, fica o erro do gateway.
 */
async function enviarComCitacao(
  adaptador: AdaptadorGateway,
  pedido: PedidoEnvio,
  c: ConexaoServidor,
  fimEm: number,
  tentativas: number,
): Promise<{ id_externo?: string; id_gateway?: string }> {
  try {
    return await adaptador.enviar(pedido, c, { fimEm });
  } catch (erro) {
    if (!pedido.respondeA || !(erro instanceof ErroGateway) || !erro.definitivo) throw erro;
    if (!cabeEnvio(tetoEnvio(pedido.tipo), fimEm)) {
      if (tentativas < MAX_TENTATIVAS) throw new ErroGateway(erro.codigo, false);
      throw erro;
    }
    const semCitacao: PedidoEnvio = { ...pedido };
    delete semCitacao.respondeA;
    return await adaptador.enviar(semCitacao, c, { fimEm });
  }
}

async function enviarMensagem(
  m: MensagemFila,
  conexao: ConexaoDe,
  resumo: ResumoCiclo,
  anotar: Anotar,
  fimEm: number,
): Promise<void> {
  const falhar = async (codigo: string, definitivo: boolean) => {
    resumo.envios.falhas++;
    try {
      await falharEnvio(m.id, codigo, definitivo);
    } catch (erro) {
      anotar("envios", erro);
    }
  };

  let resposta: { id_externo?: string; id_gateway?: string };
  try {
    const c = await conexao(m.conexao_id);
    const adaptador = c ? adaptadorDe(c.gateway) : null;
    if (!c || !adaptador) return await falhar("conexao_inexistente", true);

    const tipo = m.tipo as PedidoEnvio["tipo"];
    if (!TIPOS_ENVIO.has(tipo)) return await falhar("tipo_nao_suportado", true);

    const destino = await destinoDoContato(m.conversa_id, c.id);
    if (destino.length === 0) return await falhar("sem_destino", true);

    // Idempotency-Key da Zernio: igual nas tentativas automáticas (a 2ª não duplica a 1ª), nova
    // a cada "Tentar de novo" (senão a Zernio trata o reenvio como repetição do envio que
    // falhou e não manda).
    const chave = m.reenvios > 0 ? `${m.id}:r${m.reenvios}` : m.id;
    const pedido: PedidoEnvio = { destino, tipo, chave };
    if (typeof m.tentativas === "number") pedido.tentativa = m.tentativas;
    if (typeof m.erro === "string" && m.erro.trim() !== "") pedido.erroAnterior = m.erro;
    if (m.texto) pedido.texto = m.texto;
    const respondeA = await citacaoDoEnvio(m, anotar);
    if (respondeA) pedido.respondeA = respondeA;
    if (tipo !== "texto") {
      if (!m.midia_caminho) return await falhar("midia_ausente", true);
      pedido.midia = {
        url: await urlAssinada(m.midia_caminho, URL_MIDIA_SEGUNDOS),
        mime: m.midia_mime || "application/octet-stream",
        ...(m.midia_nome ? { nome: m.midia_nome } : {}),
      };
    } else if (!m.texto) {
      return await falhar("texto_vazio", true);
    }

    // O pedido só começa se o teto inteiro dele mais o concluir_envio terminam antes do corte.
    // Exceção (mídia pega com pouco tempo, ou preparo lento): devolve sem tentar, o que gasta
    // uma tentativa. Na última, tenta assim mesmo, com o pedido cortado antes do corte da rota
    // (melhor do que virar "falhou" sem tentar).
    if (!cabeEnvio(tetoEnvio(tipo), fimEm) && (m.tentativas ?? 0) < MAX_TENTATIVAS) {
      resumo.envios.devolvidos++;
      try {
        await falharEnvio(m.id, "sem_tempo", false);
      } catch (erro) {
        anotar("envios", erro);
      }
      return;
    }

    resposta = await enviarComCitacao(adaptador, pedido, c, fimEm, m.tentativas ?? 0);
  } catch (erro) {
    anotar("envios", erro);
    // O gateway avisou que esta mensagem pode já ter saído (a Zernio com a mesma
    // Idempotency-Key de uma tentativa anterior): fica "enviando" e o pegar_envios decide em
    // 2 min pelo eco, como no tempo esgotado da última tentativa. "falhou" mostraria falha de
    // algo que o lead pode ter recebido (decisão 8).
    if (erro instanceof ErroGateway && erro.codigo === ERRO_ENVIO_INCERTO) {
      resumo.envios.incertos++;
      return;
    }
    // A rede pode perder a confirmação depois que o gateway já aceitou. Em qualquer tentativa,
    // conserva a reserva até o eco ou revisão humana; não repete automaticamente um envio incerto.
    if (
      erro instanceof ErroGateway &&
      (erro.codigo === "tempo_esgotado" || erro.codigo === "falha_de_rede" || /^http:5\d\d$/.test(erro.codigo))
    ) {
      resumo.envios.incertos++;
      return;
    }
    if (erro instanceof ErroGateway) return await falhar(erro.codigo, erro.definitivo);
    return await falhar("erro_interno", false);
  }

  // O gateway já aceitou: nunca chamar falhar_envio aqui (geraria reenvio). Se concluir_envio
  // falhar nas 3 tentativas, a mensagem fica "enviando"; depois de 2 min, o pegar_envios só a
  // dá por enviada se o eco do gateway já gravou o id_externo. Sem confirmação, exige revisão
  // humana; a recuperação no Firestore não dispara novamente de forma automática.
  const idExterno = resposta?.id_externo ?? null;
  const idGateway = resposta?.id_gateway ?? null;
  for (let tentativa = 0; ; tentativa++) {
    try {
      await concluirEnvio(m.id, idExterno, idGateway);
      resumo.envios.enviados++;
      return;
    } catch (erro) {
      const pausa = PAUSAS_CONCLUIR_ENVIO_MS[tentativa];
      if (pausa === undefined) {
        anotar("envios", erro);
        return;
      }
      await new Promise((ok) => setTimeout(ok, pausa));
    }
  }
}
