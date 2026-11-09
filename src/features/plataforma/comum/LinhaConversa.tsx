import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Ban, Camera, Check, CheckCheck, CircleAlert, Clock, FileText, Mic, Sticker, Video } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { iniciais } from "@/components/aipro/iniciais";
import type { Enums, Tables } from "@/integrations/firebase/types";

import { AvatarLead, type CorLead, type SeloLead } from "./AvatarLead";
import { duracao, esperaCompacta, esperaLonga, horaLista, segundosDesde, type Instante } from "./tempo";
import estilos from "./LinhaConversa.module.css";

const s = estilos as Classes<
  | "lcLinha"
  | "lcAbrir"
  | "lcAv"
  | "lcTxt"
  | "lcL1"
  | "lcNome"
  | "lcHora"
  | "lcL2"
  | "lcPrev"
  | "lcPrevTexto"
  | "lcIcone"
  | "lcNl"
  | "lcL3"
  | "lcPonto"
  | "lcSitTexto"
  | "lcEspera"
  | "lcExtra"
>;

/* ---------- tipos: o mínimo de colunas do banco que a linha lê ----------
   São `Pick` das tabelas, então os tipos de `exemplo/` (que pegam mais colunas) cabem aqui. */

export type ConversaDaLinha = Pick<Tables<"conversas">, "id" | "nao_lidas" | "aguardando_humano_desde"> &
  Partial<Pick<Tables<"conversas">, "ultima_mensagem_em" | "ultima_mensagem_preview">>;

export type ContatoDaLinha = Pick<Tables<"contatos">, "id" | "nome"> &
  Partial<Pick<Tables<"contatos">, "nome_whatsapp" | "telefone" | "empresa">>;

export type MensagemDaLinha = Pick<Tables<"mensagens">, "id" | "origem" | "tipo" | "texto" | "status" | "momento"> &
  Partial<Pick<Tables<"mensagens">, "midia_nome" | "apagada_em">> & {
    /** Áudio e vídeo: duração em segundos (extra de tela; o banco ainda não tem). */
    duracaoS?: number | null | undefined;
  };

/** Quem está com a conversa e o que a linha de situação diz. Monte com `situacaoDe`. */
export type Situacao = {
  /** O selo do avatar e a cor do ponto. */
  quem: SeloLead;
  /** A linha de situação, curta: "Janete atendendo · Qualificado", "A Janete pediu ajuda". */
  texto: string;
  /** A mesma situação por extenso, para o leitor de tela. Padrão: `texto`. */
  descricao?: string | undefined;
  /** Selo "membro": as iniciais de quem atende. */
  iniciaisMembro?: string | null | undefined;
  /** Etapa final: o ponto fica verde (ganho) ou cinza (perdido). */
  desfecho?: "ganho" | "perdido" | null | undefined;
  /** A Janete está escrevendo: a prévia vira "Janete digitando…". */
  digitando?: boolean | undefined;
};

/* ---------- textos ---------- */

/** O motivo da passagem por extenso (cabeçalho, ficha, leitor de tela). */
export const MOTIVO_LONGO: Record<Enums<"motivo_humano">, string> = {
  janete_passou: "a Janete decidiu passar",
  humano_tela: "alguém respondeu pela tela",
  humano_celular: "alguém respondeu pelo WhatsApp do celular",
  chave_invalida: "a chave de IA está inválida",
  sem_credito: "acabou o crédito da chave de IA",
  audio_sem_transcricao: "áudio sem transcrição",
  limite_passos: "a Janete chegou ao limite de passos",
  erro_provedor: "erro no provedor de IA",
  envio_falhou: "a mensagem da Janete não foi entregue",
};

/** O motivo curto, para a lista (a coluna é estreita). */
export const MOTIVO_CURTO: Record<Enums<"motivo_humano">, string> = {
  janete_passou: "A Janete pediu ajuda",
  humano_tela: "Respondida pela tela",
  humano_celular: "Pelo celular da empresa",
  chave_invalida: "Chave de IA inválida",
  sem_credito: "Sem crédito de IA",
  audio_sem_transcricao: "Áudio sem transcrição",
  limite_passos: "Limite de passos",
  erro_provedor: "Erro no provedor",
  envio_falhou: "Mensagem não entregue",
};

/** Motivos em que a Janete parou por falha (selo vermelho), e não porque decidiu passar. */
export const MOTIVOS_FALHA: readonly Enums<"motivo_humano">[] = [
  "chave_invalida",
  "sem_credito",
  "audio_sem_transcricao",
  "limite_passos",
  "erro_provedor",
  "envio_falhou",
];

/** A partir daqui (10 min) o tempo esperando alguém fica vermelho. */
export const ESPERA_LONGA_S = 600;

/** O nome que a tela mostra: o salvo, o do WhatsApp, o telefone ou "Sem nome". */
export function nomeDoContato(c: ContatoDaLinha): string {
  return c.nome?.trim() || c.nome_whatsapp?.trim() || c.telefone?.trim() || "Sem nome";
}

/** Uma mensagem em uma linha: o texto, ou o tipo ("Foto", "Áudio (0:12)", o nome do arquivo). */
export function resumoMensagem(m: MensagemDaLinha): string {
  if (m.apagada_em) return "Mensagem apagada";
  const texto = m.texto?.trim();
  switch (m.tipo) {
    case "texto":
      return texto || "Mensagem";
    case "imagem":
      return texto || "Foto";
    case "audio":
      return m.duracaoS != null ? `Áudio (${duracao(m.duracaoS)})` : "Áudio";
    case "video":
      return m.duracaoS != null ? `Vídeo (${duracao(m.duracaoS)})` : texto || "Vídeo";
    case "documento":
      return m.midia_nome?.trim() || texto || "Documento";
    case "figurinha":
      return "Figurinha";
    default:
      return texto || "Mensagem";
  }
}

type EntradaSituacao = Pick<
  Tables<"conversas">,
  "modo" | "responsavel_id" | "aguardando_humano_desde" | "motivo_humano"
>;

/**
 * A situação da conversa nos 5 casos do Chat final:
 * - a Janete atende (`modo` janete);
 * - uma pessoa da equipe assumiu (tem responsável);
 * - aguardando alguém: a Janete passou e ninguém respondeu ainda (vira "falha" quando ela parou por erro);
 * - respondida pelo celular da empresa (modo humano, sem responsável e sem espera).
 * Em Ganho e Perdido, a etapa vem antes de quem atende ("Ganho · Com você").
 */
export function situacaoDe(
  conversa: EntradaSituacao,
  opcoes: {
    etapa?: { nome: string; tipo: Enums<"etapa_tipo"> } | null | undefined;
    responsavel?: { id: string; nome: string } | null | undefined;
    /** Id do membro logado: o responsável vira "Com você". */
    euId?: string | null | undefined;
    digitando?: boolean | undefined;
    /**
     * O nome de quem estava com a conversa quando ela voltou para a espera porque a pessoa foi
     * desativada (o `estavaCom` do exemplo, spec da Equipe, F4). Na espera, troca o motivo.
     */
    estavaCom?: string | null | undefined;
  } = {},
): Situacao {
  const { etapa, responsavel, euId, digitando, estavaCom } = opcoes;
  if (conversa.modo !== "janete" && !conversa.responsavel_id && conversa.aguardando_humano_desde) {
    const motivo = conversa.motivo_humano;
    const falha = motivo != null && MOTIVOS_FALHA.includes(motivo);
    // Voltou para a espera porque quem estava com ela foi desativado: o texto diz com quem estava; a
    // cor (falha ou não) continua pelo motivo, como o selo do avatar.
    if (estavaCom) {
      return { quem: falha ? "falha" : "aguardando", texto: `Estava com ${estavaCom}`, descricao: `Aguardando alguém: estava com ${estavaCom}` };
    }
    return {
      quem: falha ? "falha" : "aguardando",
      texto: motivo ? MOTIVO_CURTO[motivo] : "Aguardando alguém",
      descricao: motivo ? `Aguardando alguém: ${MOTIVO_LONGO[motivo]}` : "Aguardando alguém",
    };
  }

  let quem: SeloLead;
  let rotuloQuem: string;
  let iniciaisMembro: string | null = null;
  if (conversa.modo === "janete") {
    quem = "janete";
    rotuloQuem = "Janete atendendo";
  } else if (conversa.responsavel_id) {
    quem = "membro";
    const nome = responsavel?.nome.trim();
    const souEu = !!euId && conversa.responsavel_id === euId;
    rotuloQuem = souEu ? "Com você" : nome ? `Com ${nome.split(/\s+/)[0]}` : "Com a equipe";
    // Quem olha é sempre "VC" (de "Você"), como no protótipo; os outros, pelas iniciais do nome.
    iniciaisMembro = souEu ? "VC" : nome ? iniciais(nome) : null;
  } else {
    quem = "celular";
    rotuloQuem = "Pelo celular";
  }

  const desfecho = etapa?.tipo === "ganho" ? "ganho" : etapa?.tipo === "perdido" ? "perdido" : null;
  const texto = desfecho
    ? `${etapa!.nome} · ${rotuloQuem}`
    : etapa
      ? `${rotuloQuem} · ${etapa.nome}`
      : rotuloQuem;
  const descricao = quem === "celular" ? `Respondida pelo celular da empresa${etapa ? `, ${etapa.nome}` : ""}` : texto;

  return { quem, texto, descricao, iniciaisMembro, desfecho, digitando: quem === "janete" && !!digitando };
}

/* ---------- a situação de envio ("vistos") e o ícone do tipo ---------- */

const ROTULO_STATUS: Partial<Record<Enums<"mensagem_status">, string>> = {
  na_fila: "na fila",
  enviando: "enviando",
  enviada: "enviada",
  entregue: "entregue",
  lida: "lida",
  falhou: "não enviada",
};

function IconeStatus({ status }: { status: Enums<"mensagem_status"> }) {
  const p = { className: s.lcIcone, "aria-hidden": true, strokeWidth: 2 } as const;
  switch (status) {
    case "na_fila":
    case "enviando":
      return <Clock {...p} data-status={status} />;
    case "enviada":
      return <Check {...p} data-status={status} />;
    case "entregue":
    case "lida":
      return <CheckCheck {...p} data-status={status} />;
    case "falhou":
      return <CircleAlert {...p} data-status={status} />;
    default:
      return null;
  }
}

function IconeTipo({ m }: { m: MensagemDaLinha }) {
  const p = { className: s.lcIcone, "aria-hidden": true, strokeWidth: 2, "data-tipo": m.tipo } as const;
  if (m.apagada_em) return <Ban {...p} />;
  switch (m.tipo) {
    case "imagem":
      return <Camera {...p} />;
    case "audio":
      return <Mic {...p} />;
    case "video":
      return <Video {...p} />;
    case "documento":
      return <FileText {...p} />;
    case "figurinha":
      return <Sticker {...p} />;
    default:
      return null;
  }
}

/**
 * O relógio da linha: o de quem usa (`agora`) ou um próprio. O próprio anda a cada 1 s enquanto a
 * conversa espera alguém (o tempo da espera) e a cada 60 s fora disso (para "14:32" virar "Ontem").
 */
function useAgora(externo: Instante | undefined, esperando: boolean): Instante {
  const [proprio, setProprio] = useState(() => Date.now());
  useEffect(() => {
    if (externo !== undefined) return;
    setProprio(Date.now());
    const id = window.setInterval(() => setProprio(Date.now()), esperando ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [externo, esperando]);
  return externo ?? proprio;
}

/** O nome acessível corta a prévia em 80 caracteres, como o protótipo. */
const PREVIA_ARIA = 80;

type Props = {
  conversa: ConversaDaLinha;
  contato: ContatoDaLinha;
  /** A última mensagem da conversa; `null` usa a prévia gravada na conversa. */
  ultima: MensagemDaLinha | null;
  situacao: Situacao;
  selecionada?: boolean | undefined;
  aoAbrir: (conversaId: string) => void;
  /** Conteúdo abaixo da linha, fora do botão (o card do Kanban põe aqui as últimas mensagens e as ações). */
  extra?: ReactNode | undefined;
  /** Quem mandou a última pela tela ("Você", "Rafael"): vira o "Rafael: " da prévia. */
  autorUltima?: string | undefined;
  /**
   * O relógio da hora e da espera. A lista passa um relógio comum (um intervalo só, na TelaChat ou na
   * TelaKanban). Sem ele, cada linha liga o próprio: 1 s enquanto espera, 60 s fora disso.
   */
  agora?: Instante | undefined;
  /** Padrão: derivada do id do contato. */
  cor?: CorLead | undefined;
  /** Para a navegação por setas entre as linhas, feita por quem monta a lista. */
  id?: string | undefined;
  onKeyDown?: ((ev: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
  /**
   * A lista estreita da etapa em chat do Kanban (66 px por linha, como no protótipo): sem a linha de
   * situação, e quem atende fica só no selo do avatar. Na conversa que espera alguém, o tempo de espera
   * toma o lugar da hora, em âmbar ou vermelho, como no protótipo. O nome acessível continua completo.
   */
  compacta?: boolean | undefined;
  className?: string | undefined;
};

/**
 * A linha da lista de conversas do Chat final (o `.ci` da opção A), reaproveitada como card no Kanban:
 * - o avatar do lead com o selo de quem atende;
 * - o nome com a hora da última mensagem;
 * - a prévia de uma linha, com a situação de envio (vistos) e o ícone do tipo, e o contador de não lidas;
 * - a linha de situação com o ponto colorido; quando a conversa espera alguém, o ponto vira o relógio
 *   com o tempo correndo (vermelho a partir de 10 min).
 * Com não lidas, o nome e a hora ficam fortes. Selecionada, a linha fica em cinza suave.
 * O botão leva um nome acessível completo; o conteúdo visível fica escondido do leitor de tela.
 */
export function LinhaConversa({
  conversa,
  contato,
  ultima,
  situacao,
  selecionada = false,
  aoAbrir,
  extra,
  autorUltima,
  agora: agoraExterno,
  cor,
  id,
  onKeyDown,
  compacta = false,
  className,
}: Props) {
  const esperando = situacao.quem === "aguardando" || situacao.quem === "falha";
  const agora = useAgora(agoraExterno, esperando);

  const nome = nomeDoContato(contato);
  const momento = ultima?.momento ?? conversa.ultima_mensagem_em ?? null;
  const hora = momento ? horaLista(momento, agora) : "";
  const nl = Math.max(0, conversa.nao_lidas);
  const nova = nl > 0;

  // A prévia: quem mandou (menos o lead), o resumo e, se falhou, o aviso.
  const saida = !!ultima && ultima.origem !== "lead";
  const prefixo = !ultima
    ? ""
    : ultima.origem === "lead"
      ? ""
      : ultima.origem === "janete"
        ? "Janete: "
        : ultima.origem === "humano_celular"
          ? "Celular: "
          : `${autorUltima?.trim() || "Equipe"}: `;
  let prev: string;
  let tomPrev: "digita" | "falhou" | undefined;
  if (situacao.digitando) {
    prev = "Janete digitando…";
    tomPrev = "digita";
  } else if (ultima && saida && ultima.status === "falhou") {
    prev = `Não enviada: ${resumoMensagem(ultima)}`;
    tomPrev = "falhou";
  } else if (ultima) {
    prev = prefixo + resumoMensagem(ultima);
  } else {
    prev = conversa.ultima_mensagem_preview?.trim() || "Sem mensagens ainda";
  }

  const espera = esperando ? segundosDesde(conversa.aguardando_humano_desde, agora) : 0;
  const statusLeitura = saida && !situacao.digitando && ultima.status !== "falhou" ? ROTULO_STATUS[ultima.status] : undefined;

  const prevAria = prev.length > PREVIA_ARIA ? `${prev.slice(0, PREVIA_ARIA - 1).trimEnd()}…` : prev;
  const aria = [
    `${nome}${contato.empresa ? `, ${contato.empresa}` : ""}.`,
    esperando
      ? `${situacao.descricao ?? situacao.texto}, há ${esperaLonga(espera)}.`
      : `${situacao.descricao ?? situacao.texto}.`,
    nova ? `${nl} ${nl > 1 ? "mensagens não lidas" : "mensagem não lida"}.` : "",
    `Última: ${prevAria}${statusLeitura ? `, ${statusLeitura}` : ""}${hora ? `, ${hora}` : ""}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cx(s.lcLinha, className)}
      data-selecionada={selecionada ? "" : undefined}
      data-nova={nova ? "" : undefined}
      data-quem={situacao.quem}
      data-compacta={compacta ? "" : undefined}
    >
      <button
        id={id}
        type="button"
        className={s.lcAbrir}
        aria-current={selecionada ? "true" : undefined}
        aria-label={aria}
        onClick={() => aoAbrir(conversa.id)}
        onKeyDown={onKeyDown}
      >
        <span className={s.lcAv} aria-hidden="true">
          <AvatarLead
            nome={nome}
            chave={contato.id}
            cor={cor}
            selo={situacao.quem}
            iniciaisMembro={situacao.iniciaisMembro}
            tamanho="m"
          />
        </span>
        <span className={s.lcTxt} aria-hidden="true">
          <span className={s.lcL1}>
            <span className={s.lcNome}>{nome}</span>
            {compacta && esperando ? (
              <span className={s.lcHora} data-espera={situacao.quem} data-longa={espera >= ESPERA_LONGA_S ? "" : undefined}>
                {esperaCompacta(espera)}
              </span>
            ) : hora ? (
              <span className={s.lcHora}>{hora}</span>
            ) : null}
          </span>
          <span className={s.lcL2}>
            <span className={s.lcPrev} data-tom={tomPrev}>
              {ultima && !situacao.digitando ? (
                <>
                  {saida ? <IconeStatus status={ultima.status} /> : null}
                  {tomPrev !== "falhou" ? <IconeTipo m={ultima} /> : null}
                </>
              ) : null}
              <span className={s.lcPrevTexto}>{prev}</span>
            </span>
            {nova ? <span className={s.lcNl}>{nl > 99 ? "99+" : nl}</span> : null}
          </span>
          {!compacta ? (
            <span className={s.lcL3} data-quem={situacao.quem} data-desfecho={situacao.desfecho ?? undefined}>
              {esperando ? (
                <span className={s.lcEspera} data-longa={espera >= ESPERA_LONGA_S ? "" : undefined}>
                  <Clock aria-hidden="true" strokeWidth={2.2} />
                  {esperaCompacta(espera)}
                </span>
              ) : (
                <i className={s.lcPonto} />
              )}
              <span className={s.lcSitTexto}>{situacao.texto}</span>
            </span>
          ) : null}
        </span>
      </button>
      {extra != null && extra !== false ? <div className={s.lcExtra}>{extra}</div> : null}
    </div>
  );
}
