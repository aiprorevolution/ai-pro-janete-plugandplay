import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Image as IconeImagem, MessageSquare, UserRound } from "lucide-react";

import { Botao } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";

import estilos from "./DialogoApagar.module.css";

// O diálogo de "Apagar contato" do perfil (o do Contatos 4, sem a caixa rosa: decisão 5 do equipe). Diz
// o que some junto, para ninguém apagar sem saber, e só o "Apagar para sempre" é vermelho. Segue o
// padrão do ConfirmarApagar do Chat (chat/Ficha.tsx): portal no body, o foco começa em Cancelar (o
// caminho seguro), fica preso no diálogo, e Esc ou clique fora cancelam.

const s = estilos as Classes<
  "daVeu" | "daDialogo" | "daTitulo" | "daTexto" | "daLista" | "daItem" | "daIcone" | "daNota" | "daAcoes"
>;

interface Props {
  /** O nome do contato, como o perfil mostra. */
  nome: string;
  /** Quantas mensagens a conversa tem. */
  mensagens: number;
  /** Quantas mídias foram trocadas. */
  midias: number;
  aoCancelar(): void;
  aoConfirmar(): void;
  /** O servidor está apagando: os botões esperam, e Esc ou clique fora não cancelam. */
  apagando?: boolean | undefined;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function DialogoApagar({ nome, mensagens, midias, aoCancelar, aoConfirmar, apagando = false }: Props) {
  const base = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelar.current?.focus();
  }, []);

  const tecla = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      aoCancelar();
      return;
    }
    if (ev.key !== "Tab") return;
    // O foco anda só entre os botões do diálogo (os únicos focáveis aqui).
    ev.stopPropagation();
    const botoes = Array.from(caixa.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!botoes.length) return;
    const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
    const j = ev.shiftKey ? (i <= 0 ? botoes.length - 1 : i - 1) : (i + 1) % botoes.length;
    ev.preventDefault();
    botoes[j]!.focus();
  };

  // Só o clique no véu (fora da caixa) cancela; o clique dentro do diálogo não.
  const cliqueFora = (ev: MouseEvent<HTMLDivElement>) => {
    if (ev.target === ev.currentTarget) aoCancelar();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={s.daVeu} data-identidade="aipro" onMouseDown={cliqueFora}>
      <div
        ref={caixa}
        className={s.daDialogo}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${base}-t`}
        aria-describedby={`${base}-d`}
        onKeyDown={tecla}
      >
        <h2 id={`${base}-t`} className={s.daTitulo}>
          Apagar {nome}?
        </h2>
        <p id={`${base}-d`} className={s.daTexto}>
          Isso não tem volta. Some da plataforma, para todos da equipe:
        </p>
        <ul className={s.daLista}>
          <li className={s.daItem}>
            <MessageSquare className={s.daIcone} size={16} strokeWidth={2} aria-hidden="true" />
            <span>{plural(mensagens, "mensagem da conversa", "mensagens da conversa")}</span>
          </li>
          <li className={s.daItem}>
            <IconeImagem className={s.daIcone} size={16} strokeWidth={2} aria-hidden="true" />
            <span>{`${plural(midias, "mídia trocada", "mídias trocadas")} (imagens, áudios, vídeos e documentos)`}</span>
          </li>
          <li className={s.daItem}>
            <UserRound className={s.daIcone} size={16} strokeWidth={2} aria-hidden="true" />
            <span>O perfil, o resumo da Janete e as observações da equipe</span>
          </li>
        </ul>
        {/* Decisão 12 (c): o número não fica bloqueado. */}
        <p className={s.daNota}>Se ele escrever de novo, volta como lead novo.</p>
        <div className={s.daAcoes}>
          <Botao ref={cancelar} variante="contorno" onClick={aoCancelar} disabled={apagando}>
            Cancelar
          </Botao>
          <Botao variante="perigo" onClick={aoConfirmar} disabled={apagando} aria-busy={apagando || undefined}>
            {apagando ? "Apagando…" : "Apagar para sempre"}
          </Botao>
        </div>
      </div>
    </div>,
    document.body,
  );
}
