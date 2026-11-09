import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";

import estilos from "./Gaveta.module.css";

const s = estilos as Classes<"gvRaiz" | "gvVeu" | "gvPainel" | "gvAncorada" | "gvFechar">;

/** O que recebe foco dentro da gaveta, na ordem do Tab. */
const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focaveisDe(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
    (el) => !el.closest("[inert]") && !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
}

type Props = {
  aberta: boolean;
  /** Esc, clique no véu e o botão de fechar do conteúdo chamam este. Quem usa troca `aberta`. */
  aoFechar: () => void;
  /** Só a direita nesta rodada. */
  lado?: "direita" | undefined;
  /** Largura no computador: número em px ou valor CSS. Padrão `min(440px, 100% - 24px)`. No celular, a tela toda. */
  largura?: number | string | undefined;
  /** Nome acessível do diálogo ("Ficha de Marina Werneck"). */
  rotulo: string;
  /**
   * Presa a um bloco da página, sem véu e sem prender o foco (a ficha do Chat entre 900 e 1279 px,
   * "para nunca cobrir o bastão"). Fica no lugar onde é renderizada, sem portal: quem usa dá
   * `position: relative` ao bloco e o topo em `--gv-topo` (padrão 0). O foco entra ao abrir, o Esc
   * (com o foco dentro) e o botão de fechar fecham, e o foco volta para quem abriu se estava dentro.
   * A página continua rolando e clicável. Sem esta prop, a gaveta modal de sempre.
   */
  ancorada?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
};

/**
 * A gaveta lateral: a folha da ficha do Chat no celular e a gaveta do lead no Kanban (modais); a ficha
 * do Chat de 900 a 1279 px usa a variante `ancorada`.
 *
 * - Sem `ancorada`, é um diálogo modal: o foco entra nela ao abrir (no elemento com `data-autofocus`, se houver; se
 *   não, no próprio painel), fica preso dentro pelo Tab e volta para quem a abriu ao fechar.
 * - Esc fecha, a menos que algo dentro já tenha tratado a tecla (um menu aberto chama
 *   `preventDefault`). O clique no véu também fecha.
 * - No computador, desliza da direita com a largura pedida; abaixo de 900 px, ocupa a tela cheia.
 * - Vai para o `body` por portal, para nenhum `transform` de ancestral prender o `position: fixed`.
 * - Com `ancorada`, é outra coisa: um painel preso ao bloco de quem usa, sem véu, sem portal e sem
 *   prender o foco (ver a prop).
 *
 * O conteúdo traz o próprio cabeçalho com o botão de fechar (pode usar `FecharGaveta`).
 */
export function Gaveta({ aberta, aoFechar, lado = "direita", largura, rotulo, ancorada = false, children, className }: Props) {
  // O portal só existe no navegador: no servidor (e no primeiro render da hidratação) não há `document`.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const painel = useRef<HTMLDivElement>(null);
  // O `aoFechar` mais recente, para o ouvinte do documento não precisar ser religado a cada render.
  const fechar = useRef(aoFechar);
  useEffect(() => {
    fechar.current = aoFechar;
  });

  const visivel = aberta && montado;

  // Foco: entra ao abrir e volta para quem abriu ao fechar (ou ao desmontar aberta).
  useEffect(() => {
    if (!visivel) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = painel.current;
    const alvo = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el;
    alvo?.focus({ preventScroll: true });
    return () => {
      if (!anterior || !anterior.isConnected) return;
      // Ancorada, a pessoa pode ter seguido para outro lugar da página (o campo da conversa, o bastão):
      // o foco só volta se estava dentro do painel (que já saiu da tela, e o foco caiu no body).
      if (ancorada) {
        const ativo = document.activeElement;
        if (ativo && ativo !== document.body && !(el && el.contains(ativo))) return;
      }
      anterior.focus({ preventScroll: true });
    };
  }, [visivel, ancorada]);

  // Foco fora do painel (o elemento focado ficou desabilitado ou sumiu e o foco caiu no body): o Esc
  // ainda fecha e o Tab traz o foco de volta para dentro. Com o foco dentro, quem cuida é o `tecla`.
  // Ancorada, o foco fora do painel é da página: nada a fazer.
  useEffect(() => {
    if (!visivel || ancorada) return;
    const ouvir = (ev: globalThis.KeyboardEvent) => {
      const el = painel.current;
      if (!el || (ev.key !== "Escape" && ev.key !== "Tab")) return;
      const alvo = ev.target instanceof Node ? ev.target : null;
      if (alvo && el.contains(alvo)) return;
      // Outro diálogo ou menu aberto por cima cuida das próprias teclas.
      if (alvo instanceof Element && alvo.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      if (ev.key === "Escape") {
        if (ev.defaultPrevented) return;
        ev.preventDefault();
        fechar.current();
        return;
      }
      ev.preventDefault();
      const lista = focaveisDe(el);
      const destino = (ev.shiftKey ? lista[lista.length - 1] : lista[0]) ?? el;
      destino.focus();
    };
    document.addEventListener("keydown", ouvir);
    return () => document.removeEventListener("keydown", ouvir);
  }, [visivel, ancorada]);

  // A página por trás não rola enquanto a gaveta modal está aberta (a ancorada não trava nada).
  useEffect(() => {
    if (!visivel || ancorada) return;
    const corpo = document.body;
    const antes = corpo.style.overflow;
    corpo.style.overflow = "hidden";
    return () => {
      corpo.style.overflow = antes;
    };
  }, [visivel, ancorada]);

  if (!visivel) return null;

  const tecla = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Escape") {
      if (ev.defaultPrevented) return;
      ev.preventDefault();
      ev.stopPropagation();
      aoFechar();
      return;
    }
    // Ancorada, o Tab segue a ordem da página (sai da ficha para o resto do Chat).
    if (ev.key !== "Tab" || ancorada) return;
    const raiz = ev.currentTarget;
    const lista = focaveisDe(raiz);
    if (!lista.length) {
      ev.preventDefault();
      raiz.focus();
      return;
    }
    const primeiro = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    const ativo = document.activeElement;
    if (ev.shiftKey && (ativo === primeiro || ativo === raiz || !raiz.contains(ativo))) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && (ativo === ultimo || !raiz.contains(ativo))) {
      ev.preventDefault();
      primeiro.focus();
    }
  };

  const estilo =
    largura === undefined
      ? undefined
      : ({ "--gv-largura": typeof largura === "number" ? `${largura}px` : largura } as CSSProperties);

  // Ancorada: só o painel, no lugar (sem portal, sem véu e sem aria-modal). Fica dentro do Chat,
  // que já leva a identidade e os tokens.
  if (ancorada) {
    return (
      <div
        ref={painel}
        role="dialog"
        aria-label={rotulo}
        tabIndex={-1}
        data-lado={lado}
        data-ancorada=""
        className={cx(s.gvPainel, s.gvAncorada, className)}
        style={estilo}
        onKeyDown={tecla}
      >
        {children}
      </div>
    );
  }

  return createPortal(
    <div className={s.gvRaiz} data-identidade="aipro">
      <div className={s.gvVeu} aria-hidden="true" data-testid="gaveta-veu" onClick={() => aoFechar()} />
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        tabIndex={-1}
        data-lado={lado}
        className={cx(s.gvPainel, className)}
        style={estilo}
        onKeyDown={tecla}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** O botão de fechar no padrão da gaveta (44 px, X), para o cabeçalho do conteúdo. */
export function FecharGaveta({
  aoFechar,
  rotulo = "Fechar",
  className,
}: {
  aoFechar: () => void;
  rotulo?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <button type="button" className={cx(s.gvFechar, className)} aria-label={rotulo} onClick={aoFechar}>
      <X size={20} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
