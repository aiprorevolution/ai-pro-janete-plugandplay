import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";

import estilos from "./MenuSuspenso.module.css";

const s = estilos as Classes<
  | "msRaiz"
  | "msBotao"
  | "msBotaoIcone"
  | "msBotaoTexto"
  | "msIconeTexto"
  | "msSeta"
  | "msPonto"
  | "msPop"
  | "msTitulo"
  | "msItem"
  | "msItemTexto"
  | "msContador"
  | "msMarca"
>;

export type ItemMenu = {
  id: string;
  texto: string;
  /** Número ao lado do texto ("Precisam de você 3"). */
  contador?: number | undefined;
  /** Pinta o contador: `atencao` (areia escura) ou `erro`. */
  tom?: "atencao" | "erro" | undefined;
};

type Props = {
  /** Nome do botão e do menu ("Filtrar conversas", "Mover para…"). */
  rotulo: string;
  itens: readonly ItemMenu[];
  /** O item marcado (rádio). `null`: nenhum. */
  valor: string | null;
  aoEscolher: (id: string) => void;
  /** Com ícone, o botão é só o ícone (40 px; 44 no toque) e `rotulo` vira o nome acessível. */
  icone?: ReactNode | undefined;
  /** Texto visível do botão sem ícone. Padrão: o `rotulo`. */
  textoBotao?: string | undefined;
  /** Linha pequena no alto do menu ("Mostrar"). */
  titulo?: string | undefined;
  /** Filtro ligado: o ponto azul no botão de ícone; no botão de texto, o fundo azul claro. */
  destaque?: boolean | undefined;
  /** Ícone antes do texto, no botão de texto (o botão continua com o texto; diferente de `icone`). */
  iconeTexto?: ReactNode | undefined;
  /** O contador de tom `atencao` numa pílula areia (o `.menu-item.espera .conta` do Kanban 2). Padrão: só o texto âmbar (Chat final). */
  contadorEmPilula?: boolean | undefined;
  /**
   * Onde o menu abre: alinhado ao começo do botão, ao fim, ou com a largura do bloco posicionado mais
   * próximo (`largura`; para ocupar a largura da busca, dê `position: static` à raiz por `className`).
   */
  alinhar?: "inicio" | "fim" | "largura" | undefined;
  desabilitado?: boolean | undefined;
  className?: string | undefined;
};

const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * O menu do botão de filtro do Chat final (`.filtro-btn` + `.pop-filtro`), genérico: um botão que abre
 * uma lista de opções de rádio (`menuitemradio`).
 *
 * Teclado (padrão "menu button" do WAI-ARIA): no botão, clique, Enter, Espaço e seta para baixo
 * abrem no item marcado (ou no primeiro) e seta para cima abre no último. No menu, as setas andam em círculo,
 * Home e End vão às pontas, uma letra pula para o próximo item que começa com ela, Enter e Espaço
 * escolhem, Esc fecha e Tab sai. Escolher ou fechar com Esc devolve o foco ao botão. Clicar fora fecha.
 * O Esc é consumido aqui (`preventDefault`): uma `Gaveta` por trás não fecha junto.
 */
export function MenuSuspenso({
  rotulo,
  itens,
  valor,
  aoEscolher,
  icone,
  textoBotao,
  titulo,
  destaque = false,
  iconeTexto,
  contadorEmPilula = false,
  alinhar = "inicio",
  desabilitado = false,
  className,
}: Props) {
  const base = useId();
  const idMenu = `${base}-menu`;
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const refsItens = useRef<Array<HTMLButtonElement | null>>([]);

  const indiceMarcado = Math.max(
    0,
    itens.findIndex((i) => i.id === valor),
  );

  // O foco acompanha o item ativo enquanto o menu está aberto (foco itinerante).
  useEffect(() => {
    if (aberto) refsItens.current[foco]?.focus();
  }, [aberto, foco]);

  // Clique (ou toque) fora fecha, sem roubar o foco de onde a pessoa clicou.
  useEffect(() => {
    if (!aberto) return;
    const fora = (ev: PointerEvent | MouseEvent) => {
      if (raiz.current && ev.target instanceof Node && !raiz.current.contains(ev.target)) setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("mousedown", fora);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("mousedown", fora);
    };
  }, [aberto]);

  // Itens que somem com o menu aberto (o filtro mudou a lista): o foco não aponta para o vazio.
  useEffect(() => {
    if (aberto && foco > itens.length - 1) setFoco(Math.max(0, itens.length - 1));
  }, [aberto, foco, itens.length]);

  const abrir = (indice: number) => {
    if (desabilitado || !itens.length) return;
    setFoco(indice);
    setAberto(true);
  };

  const fechar = (devolverFoco: boolean) => {
    setAberto(false);
    if (devolverFoco) botao.current?.focus();
  };

  const escolher = (id: string) => {
    fechar(true);
    aoEscolher(id);
  };

  const teclaBotao = (ev: KeyboardEvent<HTMLButtonElement>) => {
    // Enter e Espaço chegam pelo clique nativo do botão (abre no item marcado, com o foco nele).
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      abrir(indiceMarcado);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      abrir(itens.length - 1);
    } else if (ev.key === "Escape" && aberto) {
      ev.preventDefault();
      ev.stopPropagation();
      fechar(true);
    }
  };

  const teclaMenu = (ev: KeyboardEvent<HTMLDivElement>) => {
    const n = itens.length;
    if (!n) return;
    switch (ev.key) {
      case "ArrowDown":
        ev.preventDefault();
        setFoco((f) => (f + 1) % n);
        return;
      case "ArrowUp":
        ev.preventDefault();
        setFoco((f) => (f - 1 + n) % n);
        return;
      case "Home":
        ev.preventDefault();
        setFoco(0);
        return;
      case "End":
        ev.preventDefault();
        setFoco(n - 1);
        return;
      case "Escape":
        ev.preventDefault();
        ev.stopPropagation();
        fechar(true);
        return;
      case "Tab":
        // Sem preventDefault: o foco segue para o próximo elemento da página.
        fechar(false);
        return;
      default:
        if (ev.key.length === 1 && /\S/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          const letra = normalizar(ev.key);
          for (let passo = 1; passo <= n; passo++) {
            const i = (foco + passo) % n;
            if (normalizar(itens[i]!.texto).startsWith(letra)) {
              ev.preventDefault();
              setFoco(i);
              return;
            }
          }
        }
    }
  };

  const comIcone = icone !== undefined;
  const textoVisivel = textoBotao ?? rotulo;

  return (
    <div ref={raiz} className={cx(s.msRaiz, className)}>
      <button
        ref={botao}
        type="button"
        className={cx(s.msBotao, comIcone && s.msBotaoIcone)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined}
        aria-label={comIcone ? rotulo : textoVisivel !== rotulo ? `${rotulo}: ${textoVisivel}` : undefined}
        data-destaque={destaque ? "" : undefined}
        disabled={desabilitado}
        onClick={() => (aberto ? fechar(false) : abrir(indiceMarcado))}
        onKeyDown={teclaBotao}
      >
        {comIcone ? (
          <>
            {icone}
            {destaque ? <span className={s.msPonto} aria-hidden="true" /> : null}
          </>
        ) : (
          <>
            {iconeTexto ? (
              <span className={s.msIconeTexto} aria-hidden="true">
                {iconeTexto}
              </span>
            ) : null}
            <span className={s.msBotaoTexto}>{textoVisivel}</span>
            <ChevronDown className={s.msSeta} size={16} strokeWidth={2} aria-hidden="true" />
          </>
        )}
      </button>

      {aberto ? (
        <div
          id={idMenu}
          role="menu"
          aria-label={rotulo}
          className={s.msPop}
          data-alinhar={alinhar}
          data-contador-pilula={contadorEmPilula ? "" : undefined}
          onKeyDown={teclaMenu}
        >
          {titulo ? (
            <p className={s.msTitulo} aria-hidden="true">
              {titulo}
            </p>
          ) : null}
          {itens.map((item, i) => {
            const marcado = item.id === valor;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  refsItens.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={marcado}
                tabIndex={i === foco ? 0 : -1}
                className={s.msItem}
                data-tom={item.tom}
                onClick={() => escolher(item.id)}
                onMouseMove={() => {
                  if (foco !== i) setFoco(i);
                }}
              >
                <span className={s.msItemTexto}>{item.texto}</span>
                {item.contador !== undefined ? <span className={s.msContador}>{item.contador}</span> : <span />}
                <Check className={s.msMarca} size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
