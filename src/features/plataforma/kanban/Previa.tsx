import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { Botao } from "@/components/aipro/Botao";
import { type Classes } from "@/components/aipro/cx";

import { AvatarLead } from "../comum/AvatarLead";
import { resumoMensagem } from "../comum/LinhaConversa";
import type { Mensagem } from "../exemplo";
import type { DadosCard } from "./Card";
import estilos from "./Previa.module.css";

const s = estilos as Classes<"kpPrevia" | "kpCab" | "kpId" | "kpRolo" | "kpLista" | "kpBolha" | "kpDigitando" | "kpPe" | "kpSit" | "kpBtns">;

// A prévia flutuante do card (a ideia a do equipe, o `.previa` do Kanban-2.dc.html): parar o mouse num
// card mostra a conversa sem mexer no quadro. Limpa: as últimas mensagens (sem rótulos nem horários),
// a situação numa linha e as ações. É só do mouse: fica escondida do leitor de tela e fora do Tab,
// porque pelo teclado o Enter no card já abre a gaveta com tudo isso. Abaixo de 900 px, não aparece.

/** A largura da prévia e a folga até o card. */
export const LARGURA_PREVIA = 340;
export const ALTURA_PREVIA = 440;

/** Onde a prévia abre: à direita do card, ou à esquerda se não couber; sempre dentro da janela. */
export function posicaoDaPrevia(card: DOMRect, janela: { largura: number; altura: number }): { x: number; y: number } {
  const folga = 10;
  const x =
    card.right + folga + LARGURA_PREVIA <= janela.largura - 8 ? card.right + folga : Math.max(8, card.left - folga - LARGURA_PREVIA);
  const y = Math.max(12, Math.min(card.top - 8, janela.altura - ALTURA_PREVIA));
  return { x, y };
}

type Props = {
  dados: DadosCard;
  /** As últimas mensagens da conversa, da mais antiga para a mais nova. */
  mensagens: readonly Mensagem[];
  x: number;
  y: number;
  /** Quem espera a equipe (fora de Ganho e Perdido, e não revendo o dia): o "Assumir conversa". */
  podeAssumir: boolean;
  aoAbrir: () => void;
  aoAssumir: () => void;
  /** O mouse entrou na prévia (ela fica) ou saiu (ela fecha com folga). */
  aoFicar: () => void;
  aoSair: () => void;
};

export function PreviaCard({ dados: d, mensagens, x, y, podeAssumir, aoAbrir, aoAssumir, aoFicar, aoSair }: Props) {
  const tom = d.falha ? "falha" : d.esperaS !== null ? "alerta" : d.ativo ? "ativo" : undefined;
  return (
    <div
      className={s.kpPrevia}
      style={{ left: `${Math.round(x)}px`, top: `${Math.round(y)}px` }}
      aria-hidden="true"
      data-previa=""
      data-testid="kb-previa"
      onMouseEnter={aoFicar}
      onMouseLeave={aoSair}
    >
      <div className={s.kpCab}>
        <AvatarLead nome={d.nome} chave={d.contatoId} selo={d.selo} iniciaisMembro={d.iniciaisMembro} tamanho="p" />
        <div className={s.kpId}>
          <b>{d.nome}</b>
          {d.empresa ? <span>{d.empresa}</span> : null}
        </div>
      </div>
      <div className={s.kpRolo}>
        <div className={s.kpLista}>
          {mensagens.map((m) => (
            <p key={m.id} className={s.kpBolha} data-de={m.origem === "lead" ? "lead" : m.origem === "janete" ? "janete" : "equipe"}>
              {resumoMensagem(m)}
            </p>
          ))}
          {d.digitando ? (
            <div className={s.kpDigitando}>
              <JaneteSimbolo tamanho={20} estado="fala" digitando decorativo />
            </div>
          ) : null}
        </div>
      </div>
      <div className={s.kpPe}>
        <p className={s.kpSit} data-tom={tom}>
          {d.situacao}
        </p>
        <div className={s.kpBtns}>
          {podeAssumir ? (
            <Botao tamanho="compacto" tabIndex={-1} onClick={aoAssumir}>
              Assumir conversa
            </Botao>
          ) : null}
          <Botao variante={podeAssumir ? "contorno" : "principal"} tamanho="compacto" tabIndex={-1} onClick={aoAbrir}>
            Abrir conversa
          </Botao>
        </div>
      </div>
    </div>
  );
}
