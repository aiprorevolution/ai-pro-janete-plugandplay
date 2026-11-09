import type { ReactNode } from "react";
import { ArrowRight, Smartphone, UserRound } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { iniciais as iniciaisDoNome } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { MOTIVO_CURTO, MOTIVO_LONGO, MOTIVOS_FALHA } from "../comum/LinhaConversa";
import { horaCurta } from "../comum/tempo";
import type { EventoPassagem } from "../exemplo";
import estilos from "./Passagem.module.css";

const s = estilos as Classes<"paLinha" | "paRota" | "paSeta" | "paPessoa" | "paMembro" | "paTexto" | "paHora" | "sr">;

type Props = {
  evento: EventoPassagem;
  /** O nome de quem assumiu ou devolveu, do ponto de vista de quem olha ("Você", "Marina"). */
  nome: string;
  /** As iniciais de quem assumiu ou devolveu (o avatar navy da rota). */
  iniciais: string;
  /** Em "assumiu" vindo de outra pessoa: o nome de quem estava com a conversa. */
  nomeDe?: string | undefined;
  /** As iniciais de quem estava com a conversa ("VC" quando é quem olha). Sem elas, saem do `nomeDe`. */
  iniciaisDe?: string | undefined;
  className?: string | undefined;
};

/** A frase de baixo do "Fulano assumiu a conversa": de onde ela veio (só no nome acessível). */
function textoDeOnde(evento: EventoPassagem, nomeDe: string | undefined): string {
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
 * A passagem do Chat (rodada 2): o momento em que a conversa troca de mãos, numa linha centrada e
 * pequena, sem cartão. A rota (a bolinha de quem passa, a seta e a bolinha de quem recebe), o texto
 * curto e a hora. Na falha da IA, o texto fica vermelho. O que se vê fica escondido do leitor de
 * tela: dentro do role="note", ele lê a frase inteira (com o motivo ou de onde a conversa veio), que
 * está no conteúdo, num texto só para ele (o aria-label num note nem sempre é lido).
 */
export function Passagem({ evento, nome, iniciais, nomeDe, iniciaisDe, className }: Props) {
  const h = horaCurta(evento.criado_em);
  const as = h ? ` às ${h}` : "";

  const janete = <JaneteSimbolo tamanho={22} decorativo />;
  const membro = (sigla: string) => (
    <span className={s.paMembro} aria-hidden="true">
      {sigla}
    </span>
  );
  const esperando = (
    <span className={s.paPessoa}>
      <UserRound size={13} strokeWidth={2.2} />
    </span>
  );
  const celular = (
    <span className={s.paPessoa} data-celular="">
      <Smartphone size={13} strokeWidth={2.2} />
    </span>
  );

  let texto: string;
  let frase: string;
  let falha = false;
  let de: ReactNode = janete;
  let para: ReactNode = membro(iniciais);

  switch (evento.tipo) {
    case "passou": {
      const motivo = evento.motivo ?? "janete_passou";
      falha = MOTIVOS_FALHA.includes(motivo);
      texto = MOTIVO_CURTO[motivo];
      frase = `A Janete passou para um humano${as}. Motivo: ${MOTIVO_LONGO[motivo]}.`;
      para = esperando;
      break;
    }
    case "celular":
      texto = "Respondida pelo celular";
      frase = `A conversa foi respondida pelo celular da empresa${as}. A Janete saiu da conversa.`;
      para = celular;
      break;
    case "assumiu":
      texto = `${nome} assumiu a conversa`;
      frase = `${nome} assumiu a conversa${as}. ${textoDeOnde(evento, nomeDe)}`;
      de =
        evento.de === "espera"
          ? esperando
          : evento.de === "celular"
            ? celular
            : evento.de === "outro"
              ? membro(iniciaisDe ?? (nomeDe ? iniciaisDoNome(nomeDe) : "?"))
              : janete;
      break;
    default:
      texto = `${nome} devolveu para a Janete`;
      frase = `${nome} devolveu para a Janete${as}. A Janete voltou a atender.`;
      de = membro(iniciais);
      para = janete;
  }

  return (
    <div
      className={cx(s.paLinha, className)}
      data-tom={falha ? "falha" : undefined}
      role="note"
    >
      <span className={s.paRota} aria-hidden="true">
        {de}
        <ArrowRight className={s.paSeta} size={12} strokeWidth={2.2} />
        {para}
      </span>
      <span className={s.paTexto} aria-hidden="true">
        {texto}
      </span>
      {h && (
        <span className={s.paHora} aria-hidden="true">
          · {h}
        </span>
      )}
      <span className={s.sr}>{frase}</span>
    </div>
  );
}
