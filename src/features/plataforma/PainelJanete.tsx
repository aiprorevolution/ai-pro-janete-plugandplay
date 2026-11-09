import type { KeyboardEvent } from "react";
import { ArrowRight, ChevronLeft, Minus, X } from "lucide-react";

import { Botao } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import type { AreaId } from "./areas";
import type { Atalho } from "./atalhos";
import estilos from "./PainelJanete.module.css";

const s = estilos as Classes<
  | "np"
  | "abrindo"
  | "fechando"
  | "dentro"
  | "cab"
  | "cabTexto"
  | "voltar"
  | "min"
  | "fechar"
  | "botaoIcone"
  | "rolo"
  | "lista"
  | "boas"
  | "olho"
  | "saudacao"
  | "corpo2"
  | "msg"
  | "turno"
  | "eu"
  | "janeteMsg"
  | "autor"
  | "texto"
  | "acao"
  | "pontos"
  | "base"
  | "chips"
  | "chip"
  | "sr"
>;

export type FasePainel = "fechado" | "abrindo" | "aberto" | "fechando";

export interface MensagemPainel {
  id: number;
  de: "eu" | "janete";
  texto: string;
  /** Mensagem da Janete com o botão que abre a área. */
  area?: AreaId;
  botao?: string;
}

export const ID_PAINEL = "janete-painel";
export const idAtalho = (i: number) => `np-atalho-${i}`;
/** O botão "Abrir o …" da resposta da Janete: o foco vai para ele quando a resposta chega. */
export const idAcao = (idMensagem: number) => `np-acao-${idMensagem}`;

interface Props {
  fase: Exclude<FasePainel, "fechado">;
  /** No celular o painel cobre a tela: vira modal de verdade (Tab preso dentro). */
  telaCheia: boolean;
  mensagens: readonly MensagemPainel[];
  digitando: boolean;
  falando: boolean;
  atalhos: readonly Atalho[];
  primeiroNome: string;
  empresa: string | null;
  aoAtalho: (atalho: Atalho) => void;
  aoAbrirArea: (area: AreaId) => void;
  aoMinimizar: () => void;
  aoFechar: () => void;
}

/** "Fale com a Janete": a mesma linguagem do chat do onboarding (E4), com atalhos no lugar do campo de texto. */
export function PainelJanete({
  fase,
  telaCheia,
  mensagens,
  digitando,
  falando,
  atalhos,
  primeiroNome,
  empresa,
  aoAtalho,
  aoAbrirArea,
  aoMinimizar,
  aoFechar,
}: Props) {
  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.key === "Escape" && !ev.defaultPrevented) {
      ev.preventDefault();
      aoMinimizar();
      return;
    }
    if (ev.key !== "Tab" || !telaCheia) return;
    const painel = ev.currentTarget;
    const focaveis = Array.from(painel.querySelectorAll<HTMLElement>("button, [href], [tabindex='0']")).filter(
      (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
    );
    if (!focaveis.length) return;
    const primeiro = focaveis[0]!;
    const ultimo = focaveis[focaveis.length - 1]!;
    if (ev.shiftKey && (document.activeElement === primeiro || document.activeElement === painel)) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  };

  const olho = empresa ? `${empresa} · sua vendedora no WhatsApp` : "Sua vendedora no WhatsApp";
  const saudacao = primeiroNome ? `Oi, ${primeiroNome}. Em que posso te ajudar?` : "Oi. Em que posso te ajudar?";
  const ultimo = mensagens.length ? mensagens[mensagens.length - 1]!.de : null;

  let anterior: MensagemPainel["de"] | null = null;
  const itens = mensagens.map((m) => {
    const novoTurno = anterior === null || anterior !== m.de;
    anterior = m.de;
    return { m, novoTurno };
  });

  return (
    <section
      id={ID_PAINEL}
      className={cx(s.np, fase === "abrindo" && s.abrindo, fase === "fechando" && s.fechando)}
      role="dialog"
      aria-modal={telaCheia || undefined}
      aria-labelledby="np-titulo"
      tabIndex={-1}
      onKeyDown={tecla}
    >
      <div className={s.dentro}>
        <header className={s.cab}>
          <button type="button" className={cx(s.botaoIcone, s.voltar)} onClick={aoMinimizar} aria-label="Voltar para a plataforma">
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <JaneteSimbolo decorativo tamanho={40} estado={digitando ? "fala" : "acordada"} digitando={digitando} />
          <div className={s.cabTexto}>
            <h2 id="np-titulo">Fale com a Janete</h2>
            <p>{digitando ? "digitando…" : "Online · atalhos para as áreas"}</p>
          </div>
          <button type="button" className={cx(s.botaoIcone, s.min)} onClick={aoMinimizar} aria-label="Minimizar a conversa (Esc)">
            <Minus size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" className={cx(s.botaoIcone, s.fechar)} onClick={aoFechar} aria-label="Fechar o chat">
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div className={s.rolo}>
          <div className={s.lista} role="log" aria-live="polite" aria-label="Conversa com a Janete">
            <div className={s.boas}>
              <p className={s.olho}>{olho}</p>
              <h3 className={s.saudacao}>{saudacao}</h3>
              <p className={s.corpo2}>Escolha uma das opções abaixo e eu te levo para a área certa da plataforma.</p>
            </div>
            {itens.map(({ m, novoTurno }) => (
              <div key={m.id} className={cx(s.msg, m.de === "eu" ? s.eu : s.janeteMsg, novoTurno && s.turno)}>
                {m.de === "janete" && novoTurno ? (
                  <p className={s.autor}>
                    <JaneteSimbolo decorativo tamanho={20} />
                    <span>Janete</span>
                  </p>
                ) : null}
                <p className={s.texto}>
                  <span className={s.sr}>{m.de === "eu" ? "Você: " : "Janete: "}</span>
                  {m.texto}
                </p>
                {m.area && m.botao ? (
                  <div className={s.acao}>
                    <Botao
                      variante="contorno"
                      iconeDepois={<ArrowRight size={16} strokeWidth={2} />}
                      id={idAcao(m.id)}
                      onClick={() => aoAbrirArea(m.area!)}
                    >
                      {m.botao}
                    </Botao>
                  </div>
                ) : null}
              </div>
            ))}
            {digitando ? (
              <div className={cx(s.msg, s.janeteMsg, (ultimo === null || ultimo === "eu") && s.turno)}>
                <span className={s.pontos} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className={s.sr}>A Janete está digitando</span>
              </div>
            ) : null}
          </div>
        </div>
        <div className={s.base}>
          {!falando ? (
            <div className={s.chips} role="group" aria-label="Atalhos">
              {atalhos.map((a, i) => (
                <button
                  key={a.pergunta}
                  id={idAtalho(i)}
                  type="button"
                  className={s.chip}
                  onClick={() => {
                    // os atalhos somem enquanto a Janete responde: o foco espera no painel, e não no body,
                    // até ir para o botão "Abrir o …" da resposta
                    document.getElementById(ID_PAINEL)?.focus({ preventScroll: true });
                    aoAtalho(a);
                  }}
                >
                  {a.pergunta}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
