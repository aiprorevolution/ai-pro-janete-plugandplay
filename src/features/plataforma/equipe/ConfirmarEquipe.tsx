import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { History, MessageSquare, RotateCcw } from "lucide-react";

import { Botao } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";

import { conversasDoMembro, nomeNaEquipe, type BaseEquipe, type PedidoEquipe } from "./dados";
import estilos from "./ConfirmarEquipe.module.css";

// A confirmação da Equipe (o `.veu` e o `.dialogo` do protótipo B): desativar alguém (com quantas
// conversas voltam para a fila), tornar admin, tornar atendente e cancelar um convite. Segue o
// padrão do DialogoApagar dos Contatos: portal no body, o foco começa no botão de voltar atrás (o
// caminho seguro), fica preso no diálogo, e Esc ou clique fora cancelam. Lê a base que a tela passa;
// `pedido` nulo (ou de um tipo que não confirma) = fechado.

const s = estilos as Classes<"ceVeu" | "ceDialogo" | "ceTitulo" | "ceTexto" | "ceLista" | "ceItem" | "ceIcone" | "ceAcoes">;

interface Props {
  pedido: PedidoEquipe | null;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}

interface Conteudo {
  titulo: string;
  texto: string;
  itens?: { icone: ReactNode; texto: ReactNode }[];
  cancelar: string;
  confirmar: string;
  perigo: boolean;
}

const ICONE = { size: 16, strokeWidth: 2, "aria-hidden": true } as const;

/** Os textos do diálogo de cada pedido (os da função dialogoAtual do protótipo B). */
function conteudoDo(estado: BaseEquipe, pedido: PedidoEquipe): Conteudo | null {
  if (pedido.tipo === "cancelar") {
    const convite = (estado.convites ?? []).find((c) => c.id === pedido.id);
    if (!convite) return null;
    return {
      titulo: `Cancelar o convite de ${convite.email}?`,
      texto: "A pessoa não consegue mais entrar na equipe pelo link que recebeu por e-mail. Dá para convidar de novo depois.",
      cancelar: "Voltar",
      confirmar: "Cancelar convite",
      perigo: true,
    };
  }
  if (pedido.tipo !== "desativar" && pedido.tipo !== "admin" && pedido.tipo !== "atendente") return null;
  if (!estado.membros.some((m) => m.id === pedido.id)) return null;
  const nome = nomeNaEquipe(estado, pedido.id);

  if (pedido.tipo === "admin") {
    return {
      titulo: `Tornar ${nome} admin?`,
      texto: `${nome} vai poder convidar e desativar pessoas, trocar papéis e mexer na Configuração (WhatsApp, cérebro e chaves).`,
      cancelar: "Cancelar",
      confirmar: "Tornar admin",
      perigo: false,
    };
  }
  if (pedido.tipo === "atendente") {
    return {
      titulo: `Tornar ${nome} atendente?`,
      texto: `${nome} deixa de convidar e desativar pessoas, de trocar papéis e de ver a Configuração. Continua atendendo as conversas.`,
      cancelar: "Cancelar",
      confirmar: "Tornar atendente",
      perigo: false,
    };
  }

  const n = conversasDoMembro(estado, pedido.id).length;
  const conversas: ReactNode =
    n === 0 ? (
      `Nenhuma conversa está com ${nome} agora.`
    ) : (
      <>
        <b>{n === 1 ? `A conversa com ${nome}` : `As ${n} conversas com ${nome}`}</b>
        {n === 1 ? " volta" : " voltam"} para “Precisam de você”, para alguém da equipe assumir.
      </>
    );
  return {
    titulo: `Desativar ${nome}?`,
    texto: `${nome} não vai mais conseguir entrar na plataforma.`,
    itens: [
      { icone: <MessageSquare {...ICONE} />, texto: conversas },
      { icone: <History {...ICONE} />, texto: `As mensagens que ${nome} já mandou continuam nas conversas.` },
      { icone: <RotateCcw {...ICONE} />, texto: "Dá para reativar depois, aqui na Equipe." },
    ],
    cancelar: "Cancelar",
    confirmar: `Desativar ${nome}`,
    perigo: true,
  };
}

export function ConfirmarEquipe({ base, pedido, aoConfirmar, aoCancelar }: Props & { base: BaseEquipe }) {
  const conteudo = pedido ? conteudoDo(base, pedido) : null;
  if (!conteudo || typeof document === "undefined") return null;
  // A chave remonta o diálogo a cada pedido novo: o foco volta a começar no botão seguro.
  return (
    <Dialogo
      key={`${pedido!.tipo}-${pedido!.id}`}
      conteudo={conteudo}
      aoConfirmar={aoConfirmar}
      aoCancelar={aoCancelar}
    />
  );
}

function Dialogo({ conteudo, aoConfirmar, aoCancelar }: { conteudo: Conteudo } & Omit<Props, "pedido">) {
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
    // O foco anda só entre os dois botões do diálogo (os únicos focáveis aqui).
    ev.stopPropagation();
    const botoes = Array.from(caixa.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!botoes.length) return;
    const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
    const j = ev.shiftKey ? (i <= 0 ? botoes.length - 1 : i - 1) : (i + 1) % botoes.length;
    ev.preventDefault();
    botoes[j]!.focus();
  };

  // Só o clique no véu (fora da caixa) cancela; o clique dentro do diálogo não. O 2º clique de um
  // duplo clique (`detail` > 1) é o mesmo gesto que abriu o diálogo: não cancela nem confirma nada.
  const cliqueFora = (ev: MouseEvent<HTMLDivElement>) => {
    if (ev.detail > 1) return;
    if (ev.target === ev.currentTarget) aoCancelar();
  };
  const soClique = (fazer: () => void) => (ev: MouseEvent<HTMLButtonElement>) => {
    if (ev.detail > 1) return;
    fazer();
  };

  return createPortal(
    <div className={s.ceVeu} data-identidade="aipro" onMouseDown={cliqueFora}>
      <div
        ref={caixa}
        className={s.ceDialogo}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${base}-t`}
        aria-describedby={`${base}-d`}
        onKeyDown={tecla}
      >
        <h2 id={`${base}-t`} className={s.ceTitulo}>
          {conteudo.titulo}
        </h2>
        <p id={`${base}-d`} className={s.ceTexto}>
          {conteudo.texto}
        </p>
        {conteudo.itens ? (
          <ul className={s.ceLista}>
            {conteudo.itens.map((item, i) => (
              <li key={i} className={s.ceItem}>
                <span className={s.ceIcone}>{item.icone}</span>
                <span>{item.texto}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className={s.ceAcoes}>
          <Botao ref={cancelar} variante="contorno" onClick={soClique(aoCancelar)}>
            {conteudo.cancelar}
          </Botao>
          {/* Dentro do diálogo, o perigo do AI PRO já é cheio (o .btn-perigo-cheio do protótipo). */}
          <Botao variante={conteudo.perigo ? "perigo" : "principal"} onClick={soClique(aoConfirmar)}>
            {conteudo.confirmar}
          </Botao>
        </div>
      </div>
    </div>,
    document.body,
  );
}
