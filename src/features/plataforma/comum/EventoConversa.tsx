import type { ReactNode } from "react";
import { ArrowRight, Smartphone, UserRound } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { iniciais as iniciaisDoNome } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import type { Enums, Tables } from "@/integrations/firebase/types";

import estilos from "./EventoConversa.module.css";
import { MOTIVO_CURTO, MOTIVO_LONGO, MOTIVOS_FALHA } from "./LinhaConversa";
import { horaCurta } from "./tempo";

const s = estilos as Classes<
  | "evEvento"
  | "evHora"
  | "evDia"
  | "evPassagem"
  | "evRota"
  | "evSeta"
  | "evPessoa"
  | "evMembro"
  | "evTexto"
  | "evPasHora"
  | "sr"
>;

type Props = {
  /** O que aconteceu, numa frase: "A Janete moveu para Qualificado". */
  texto: ReactNode;
  /** Quando aconteceu (ISO do banco). Sem ele, só a frase. */
  momento?: string | null | undefined;
  className?: string | undefined;
};

/**
 * Um evento na linha do tempo da conversa (o `.evento` do Chat final): a linha pequena e
 * centralizada, em cinza, com a hora em fonte mono. Não é mensagem: não tem balão, lado nem
 * ações. Serve para a etapa que mudou, o contato editado e o que mais a tela precisar registrar.
 */
export function EventoConversa({ texto, momento, className }: Props) {
  const h = momento ? horaCurta(momento) : "";
  return (
    <p className={cx(s.evEvento, className)} role="note">
      {texto}
      {h && <span className={s.evHora}> · {h}</span>}
    </p>
  );
}

/** O separador de dia da conversa (o `.dia` do Chat final): "Hoje", "Ontem", "Segunda". */
export function SeparadorDia({ texto, className }: { texto: string; className?: string | undefined }) {
  return (
    <p className={cx(s.evDia, className)} role="separator" aria-label={texto}>
      {texto}
    </p>
  );
}

/* =============================================================================
   Os eventos de `conversa_eventos` (spec 2.3, envio 2; decisão 8): a conversa troca de mãos.
   ============================================================================= */

/** Os tipos de `conversa_evento_tipo` (o enum do banco). */
export type TipoEventoConversa = Enums<"conversa_evento_tipo">;

/**
 * De onde a conversa veio (`conversa_eventos.de`): a Janete, a espera, outra pessoa ou o celular. A
 * coluna é `text` no banco (o check aceita só estes); a frase trata qualquer outro como "a Janete".
 */
export type OrigemEventoConversa = "janete" | "espera" | "outro" | "celular";

/**
 * Uma linha de `conversa_eventos`, com as colunas que a tela usa (o Pick do types.ts). O
 * `EventoPassagem` do exemplo cabe aqui sem conversão (ele não tem `voltou_para_fila`).
 * - `membro_id`: quem assumiu ou devolveu (nulo em "passou", "celular" e "voltou_para_fila");
 * - `motivo`: em "passou", por que a Janete saiu (janete_passou ou uma falha);
 * - `de`: em "assumiu", de onde a conversa veio; em "voltou_para_fila", "outro";
 * - `de_membro_id`: em "assumiu" vindo de outra pessoa, e em "voltou_para_fila", quem estava com ela;
 * - `por_envio`: em "assumiu", a pessoa assumiu mandando uma mensagem, sem clicar em Assumir.
 */
export type LinhaEventoConversa = Pick<
  Tables<"conversa_eventos">,
  "id" | "tipo" | "membro_id" | "motivo" | "de" | "de_membro_id" | "por_envio" | "criado_em"
>;

/** Os nomes que a frase usa, já resolvidos pela tela (do ponto de vista de quem olha: "Você"). */
export interface NomesEvento {
  /** Quem assumiu ou devolveu ("Você", "Marina"). Sem ele: "Alguém da equipe". */
  nome?: string | undefined;
  /** Quem estava com a conversa (assumiu de outra pessoa; voltou para a fila). */
  nomeDe?: string | undefined;
}

/** A frase de baixo do "Fulano assumiu a conversa": de onde ela veio (só no nome acessível). */
function textoDeOnde(evento: LinhaEventoConversa, nomeDe: string | undefined): string {
  const ao = evento.por_envio ? "Ao enviar uma mensagem. " : "";
  switch (evento.de) {
    case "espera":
      return `${ao}A conversa esperava atendimento.`;
    case "outro":
      return `${ao}A conversa estava com ${nomeDe || "outra pessoa da equipe"}.`;
    case "celular":
      return `${ao}Antes, respondida pelo celular da empresa.`;
    default:
      return `${ao}A Janete saiu da conversa.`;
  }
}

/**
 * O que se diz de um evento:
 * - `curto`: o texto que aparece na rota do Chat e dos Contatos ("Marina assumiu a conversa");
 * - `linha`: a frase da linha do tempo do Kanban ("A Janete parou: …", "Alguém respondeu pelo celular…");
 * - `frase`: a frase inteira do leitor de tela, com a hora, o motivo ou de onde a conversa veio;
 * - `falha`: a Janete parou por falha (o texto fica vermelho).
 */
export function textoDoEvento(
  evento: LinhaEventoConversa,
  nomes: NomesEvento = {},
): { curto: string; linha: string; frase: string; falha: boolean } {
  const h = horaCurta(evento.criado_em);
  const as = h ? ` às ${h}` : "";
  const nome = nomes.nome?.trim() || "Alguém da equipe";
  const nomeDe = nomes.nomeDe?.trim() || undefined;
  switch (evento.tipo) {
    case "passou": {
      const motivo = evento.motivo ?? "janete_passou";
      const falha = MOTIVOS_FALHA.includes(motivo);
      return {
        curto: MOTIVO_CURTO[motivo],
        linha: falha ? `A Janete parou: ${MOTIVO_LONGO[motivo]}` : "A Janete passou a conversa para a equipe",
        frase: `A Janete passou para um humano${as}. Motivo: ${MOTIVO_LONGO[motivo]}.`,
        falha,
      };
    }
    case "celular":
      return {
        curto: "Respondida pelo celular",
        linha: "Alguém respondeu pelo celular da empresa",
        frase: `A conversa foi respondida pelo celular da empresa${as}. A Janete saiu da conversa.`,
        falha: false,
      };
    case "assumiu":
      return {
        curto: `${nome} assumiu a conversa`,
        linha: `${nome} assumiu a conversa`,
        frase: `${nome} assumiu a conversa${as}. ${textoDeOnde(evento, nomeDe)}`,
        falha: false,
      };
    case "voltou_para_fila": {
      const quem = nomeDe ?? "quem atendia";
      return {
        curto: "Voltou para a fila",
        linha: `A conversa voltou para a fila: a conta de ${quem} foi desativada`,
        frase: `A conversa voltou para a fila${as}. A conta de ${quem} foi desativada, e a conversa espera atendimento.`,
        falha: false,
      };
    }
    default:
      return {
        curto: `${nome} devolveu para a Janete`,
        linha: `${nome} devolveu para a Janete`,
        frase: `${nome} devolveu para a Janete${as}. A Janete voltou a atender.`,
        falha: false,
      };
  }
}

type PropsPassagem = NomesEvento & {
  evento: LinhaEventoConversa;
  /** As iniciais de quem assumiu ou devolveu (o avatar navy da rota). Sem elas, saem do `nome`. */
  iniciais?: string | undefined;
  /** As iniciais de quem estava com a conversa ("VC" quando é quem olha). Sem elas, saem do `nomeDe`. */
  iniciaisDe?: string | undefined;
  /**
   * `rota` (padrão): o desenho do Chat (rodada 2), com quem passa → quem recebe, o texto curto e a
   * hora; `compacta`: a mesma rota em 18 px (o perfil do contato); `texto`: a linha do tempo do
   * Kanban (o `EventoConversa`, só a frase e a hora).
   */
  forma?: "rota" | "compacta" | "texto" | undefined;
  className?: string | undefined;
};

/**
 * Um evento de `conversa_eventos` na conversa (os avisos de passagem da decisão 8): "A Janete
 * passou", "Fulano assumiu", "Devolveu para a Janete", "Respondida pelo celular" e "Voltou para a
 * fila" (quem atendia foi desativado). Na rota, o que se vê fica escondido do leitor de tela: dentro
 * do role="note", ele lê a frase inteira, que está no conteúdo, num texto só para ele (o aria-label
 * num note nem sempre é lido).
 */
export function PassagemConversa({ evento, nome, nomeDe, iniciais, iniciaisDe, forma = "rota", className }: PropsPassagem) {
  const t = textoDoEvento(evento, { nome, nomeDe });
  const h = horaCurta(evento.criado_em);

  if (forma === "texto") return <EventoConversa texto={t.linha} momento={evento.criado_em} className={className} />;

  const px = forma === "compacta" ? 18 : 22;
  const icone = forma === "compacta" ? 11 : 13;
  const siglaDe = (n: string | undefined, ini: string | undefined) =>
    ini?.trim() ? ini.trim().slice(0, 2).toUpperCase() : n?.trim() ? (n.trim() === "Você" ? "VC" : iniciaisDoNome(n)) : "?";

  const janete = <JaneteSimbolo tamanho={px} decorativo />;
  const membro = (sigla: string) => (
    <span className={s.evMembro} aria-hidden="true">
      {sigla}
    </span>
  );
  const esperando = (
    <span className={s.evPessoa}>
      <UserRound size={icone} strokeWidth={2.2} />
    </span>
  );
  const celular = (
    <span className={s.evPessoa} data-celular="">
      <Smartphone size={icone} strokeWidth={2.2} />
    </span>
  );

  let de: ReactNode = janete;
  let para: ReactNode = membro(siglaDe(nome, iniciais));
  switch (evento.tipo) {
    case "passou":
      para = esperando;
      break;
    case "celular":
      para = celular;
      break;
    case "assumiu":
      de =
        evento.de === "espera"
          ? esperando
          : evento.de === "celular"
            ? celular
            : evento.de === "outro"
              ? membro(siglaDe(nomeDe, iniciaisDe))
              : janete;
      break;
    case "voltou_para_fila":
      de = membro(siglaDe(nomeDe, iniciaisDe));
      para = esperando;
      break;
    default:
      de = membro(siglaDe(nome, iniciais));
      para = janete;
  }

  return (
    <div
      className={cx(s.evPassagem, className)}
      data-tom={t.falha ? "falha" : undefined}
      data-forma={forma}
      data-evento={evento.tipo}
      role="note"
    >
      <span className={s.evRota} aria-hidden="true">
        {de}
        <ArrowRight className={s.evSeta} size={12} strokeWidth={2.2} />
        {para}
      </span>
      <span className={s.evTexto} aria-hidden="true">
        {t.curto}
      </span>
      {h && (
        <span className={s.evPasHora} aria-hidden="true">
          · {h}
        </span>
      )}
      <span className={s.sr}>{t.frase}</span>
    </div>
  );
}
