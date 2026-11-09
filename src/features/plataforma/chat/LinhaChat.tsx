import type { KeyboardEvent } from "react";
import { Ban, Camera, Check, CheckCheck, CircleAlert, Clock, FileText, Mic, Sticker, Video } from "lucide-react";

import { type Classes } from "@/components/aipro/cx";

import { AvatarLead } from "../comum/AvatarLead";
import { ESPERA_LONGA_S, nomeDoContato, resumoMensagem, situacaoDe } from "../comum/LinhaConversa";
import { esperaLonga, horaLista, segundosDesde } from "../comum/tempo";
import { estaAguardando, type Contato, type Conversa, type Etapa, type Mensagem, type StatusMensagem } from "../exemplo";
import estilos from "./LinhaChat.module.css";

const s = estilos as Classes<
  | "lhLinha"
  | "lhAbrir"
  | "lhAvatar"
  | "lhTxt"
  | "lhL1"
  | "lhNome"
  | "lhHora"
  | "lhL2"
  | "lhPrev"
  | "lhPrevTexto"
  | "lhIcone"
  | "lhSinal"
>;

// A linha da lista do Chat (rodada 2): a foto com as iniciais, o nome com a hora e a última mensagem
// com o sinal à direita. Sem a 3ª linha e sem o selo de quem atende: quem atende fica no nome
// acessível e no filtro. A LinhaConversa de comum/ continua como está, porque o Kanban usa.

/* ---------- o sinal da linha ---------- */

export type CorSinal = "azul" | "amarelo" | "vermelho";

/**
 * O sinal à direita da prévia, puro:
 * - vermelho: a conversa espera alguém há 10 min ou mais (`ESPERA_LONGA_S`);
 * - amarelo: espera alguém há menos que isso;
 * - azul: ninguém espera, mas há mensagens não lidas;
 * - `null`: nada a sinalizar.
 * `n` são as não lidas (nunca negativo). Com espera e não lidas juntas, o número fica na cor da espera.
 */
export function sinalDaLinha(
  conversa: Pick<Conversa, "modo" | "responsavel_id" | "motivo_humano" | "aguardando_humano_desde" | "nao_lidas">,
  agora: number | string | Date,
): { cor: CorSinal | null; n: number } {
  const espera = estaAguardando(conversa);
  const longa = espera && segundosDesde(conversa.aguardando_humano_desde, agora) >= ESPERA_LONGA_S;
  const n = Math.max(0, conversa.nao_lidas);
  const cor: CorSinal | null = longa ? "vermelho" : espera ? "amarelo" : n > 0 ? "azul" : null;
  return { cor, n };
}

/* ---------- os ícones da prévia (os vistos e o tipo) ---------- */

const ROTULO_STATUS: Partial<Record<StatusMensagem, string>> = {
  na_fila: "na fila",
  enviando: "enviando",
  enviada: "enviada",
  entregue: "entregue",
  lida: "lida",
  falhou: "não enviada",
};

function IconeStatus({ status }: { status: StatusMensagem }) {
  const p = { className: s.lhIcone, "aria-hidden": true, strokeWidth: 2 } as const;
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

function IconeTipo({ m }: { m: Mensagem }) {
  const p = { className: s.lhIcone, "aria-hidden": true, strokeWidth: 2, "data-tipo": m.tipo } as const;
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

/** Na busca, o campo que casou quando não é o nome nem a mensagem ("Empresa: Studio Pilates…"). */
export type PreviaBusca = {
  /** O que a linha mostra no lugar da prévia. */
  texto: string;
  /** O que o leitor de tela ouve logo depois do nome ("Encontrada pela empresa."). */
  aria: string;
};

/** O nome acessível corta a prévia em 80 caracteres, como a LinhaConversa. */
const PREVIA_ARIA = 80;

type Props = {
  /** Vai no botão: a Lista monta "<base>-ci-<conversaId>" (a TelaChat foca por ele). */
  id: string;
  conversa: Conversa;
  contato: Contato;
  /** A última mensagem; `null` usa a prévia gravada na conversa. */
  ultima: Mensagem | null;
  /** Quem mandou a última pela tela ("Você", "Rafael"): vira o "Rafael: " da prévia. */
  autorUltima?: string | undefined;
  /** A Janete está escrevendo: a prévia vira "Janete digitando…". */
  digitando: boolean;
  /** Quem assumiu a conversa (para o "Com Rafael" do nome acessível). */
  responsavel: { id: string; nome: string } | null;
  /** Na espera, o nome de quem estava com ela antes de ser desativado ("Estava com Marina", spec da Equipe, F4). */
  estavaCom?: string | null | undefined;
  etapa: Pick<Etapa, "nome" | "tipo"> | null;
  /** Id de quem olha: o responsável vira "Com você". */
  euId: string;
  selecionada: boolean;
  /** O relógio comum da lista. */
  agora: number;
  aoAbrir: (conversaId: string) => void;
  /** A lista tem uma parada de Tab só: as outras linhas ficam com -1 e recebem o foco pelas setas. */
  tabIndex?: 0 | -1 | undefined;
  /** Com a busca preenchida, por que a conversa apareceu (troca a prévia). */
  previaBusca?: PreviaBusca | undefined;
  onFocus?: (() => void) | undefined;
  onKeyDown?: ((ev: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
};

export function LinhaChat({
  id,
  conversa,
  contato,
  ultima,
  autorUltima,
  digitando,
  responsavel,
  estavaCom,
  etapa,
  euId,
  selecionada,
  agora,
  aoAbrir,
  tabIndex,
  previaBusca,
  onFocus,
  onKeyDown,
}: Props) {
  const situacao = situacaoDe(conversa, { etapa, responsavel, euId, digitando, estavaCom });
  const sinal = sinalDaLinha(conversa, agora);
  const esperando = estaAguardando(conversa);

  const nome = nomeDoContato(contato);
  const momento = ultima?.momento ?? conversa.ultima_mensagem_em ?? null;
  const hora = momento ? horaLista(momento, agora) : "";
  const nova = sinal.n > 0;

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
  if (previaBusca) {
    prev = previaBusca.texto;
  } else if (situacao.digitando) {
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
  const statusLeitura =
    ultima && saida && !situacao.digitando && ultima.status !== "falhou" ? ROTULO_STATUS[ultima.status] : undefined;

  // A "Última:" do nome acessível é sempre a mensagem, mesmo quando a busca troca a prévia que se vê.
  const prevMsg = previaBusca
    ? ultima
      ? prefixo + resumoMensagem(ultima)
      : conversa.ultima_mensagem_preview?.trim() || "Sem mensagens ainda"
    : prev;
  const prevAria = prevMsg.length > PREVIA_ARIA ? `${prevMsg.slice(0, PREVIA_ARIA - 1).trimEnd()}…` : prevMsg;
  const textoSituacao = situacao.descricao ?? situacao.texto;
  const aria = [
    `${nome}${contato.empresa ? `, ${contato.empresa}` : ""}.`,
    previaBusca?.aria ?? "",
    esperando ? `${textoSituacao}, há ${esperaLonga(espera)}.` : `${textoSituacao}.`,
    nova ? `${sinal.n} ${sinal.n > 1 ? "mensagens não lidas" : "mensagem não lida"}.` : "",
    `Última: ${prevAria}${statusLeitura ? `, ${statusLeitura}` : ""}${hora ? `, ${hora}` : ""}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={s.lhLinha}
      role="listitem"
      data-selecionada={selecionada ? "" : undefined}
      data-nova={nova ? "" : undefined}
      data-quem={situacao.quem}
    >
      <button
        id={id}
        type="button"
        className={s.lhAbrir}
        aria-current={selecionada ? "true" : undefined}
        aria-label={aria}
        tabIndex={tabIndex}
        onClick={() => aoAbrir(conversa.id)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        <AvatarLead nome={nome} chave={contato.id} tamanho="m" className={s.lhAvatar} />
        <span className={s.lhTxt} aria-hidden="true">
          <span className={s.lhL1}>
            <span className={s.lhNome}>{nome}</span>
            {hora ? <span className={s.lhHora}>{hora}</span> : null}
          </span>
          <span className={s.lhL2}>
            <span className={s.lhPrev} data-tom={tomPrev}>
              {ultima && !situacao.digitando && !previaBusca ? (
                <>
                  {saida ? <IconeStatus status={ultima.status} /> : null}
                  {tomPrev !== "falhou" ? <IconeTipo m={ultima} /> : null}
                </>
              ) : null}
              <span className={s.lhPrevTexto}>{prev}</span>
            </span>
            {sinal.cor && (nova || sinal.cor !== "azul") ? (
              <span className={s.lhSinal} data-cor={sinal.cor} data-ponto={nova ? undefined : ""}>
                {nova ? (sinal.n > 99 ? "99+" : sinal.n) : null}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </div>
  );
}
