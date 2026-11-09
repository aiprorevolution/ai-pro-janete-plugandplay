import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cx, type Classes } from "@/components/aipro/cx";

import { JaneteSimbolo, type EstadoJanete } from "./JaneteSimbolo";
import estilos from "./VooJanete.module.css";

const s = estilos as Classes<"voo" | "legenda" | "sai" | "some">;

/**
 * O símbolo da Janete em trânsito (o `.sobrevoo` do F): um símbolo só, fixo na tela, que viaja de um
 * ponto medido a outro. É ele que liga as telas sem corte:
 *   conta → conexão (o cartão vira o símbolo, que sobe e forma o contêiner da conexão),
 *   check da IA → "Oi, eu sou a Janete", "Oi" → avatar do chat, preparo → canto da plataforma.
 *
 * O provedor fica no `__root.tsx`, acima das rotas: o símbolo continua na tela quando a rota troca
 * (de /criar-conta para /onboarding, de /onboarding para /app). Quem chega na tela nova olha
 * `ativo`: se há um símbolo em voo, a tela faz a entrada a partir dele e chama `soltar()` quando o
 * símbolo dela assumir o lugar.
 *
 * Com movimento reduzido, `voar` vai direto ao destino e resolve na hora.
 */

/** Centro na tela (px da viewport) e lado do disco. */
export interface PontoJanete {
  x: number;
  y: number;
  tamanho: number;
}

export interface LegendaVoo {
  titulo: string;
  detalhe?: string;
}

export interface OpcoesVoo {
  /** Padrão 840 ms (o `.voo` do F). Use DURACAO_VOO_LONGO_MS no voo até o canto da plataforma. */
  duracaoMs?: number;
  /** Troca o estado junto com o voo. */
  estado?: EstadoJanete;
}

export interface OpcoesPouso {
  /**
   * A passagem do login (E6, o `.metamorfose` do F): a sombra do símbolo em trânsito chega aos
   * poucos, sem tranco na troca com o símbolo do cartão. Os outros voos mostram a sombra de uma vez.
   */
  metamorfose?: boolean;
}

export interface ControleVoo {
  /** Há um símbolo em trânsito na tela. */
  ativo: boolean;
  /** Mostra o símbolo parado em `em`, sem animar (o ponto de partida). */
  pousar: (em: PontoJanete, estado?: EstadoJanete, opcoes?: OpcoesPouso) => void;
  /** Anima do ponto atual até `para`. Resolve quando chega. */
  voar: (para: PontoJanete, opcoes?: OpcoesVoo) => Promise<void>;
  mudarEstado: (estado: EstadoJanete) => void;
  /** Texto sob o símbolo ("Preparando o seu espaço"); acompanha o voo. `null` apaga com fade. */
  legenda: (texto: LegendaVoo | null) => void;
  /** Tira o símbolo da tela (a tela de destino já mostra o dela). `desvanecer` apaga em 200 ms. */
  soltar: (opcoes?: { desvanecer?: boolean }) => void;
}

export const DURACAO_VOO_MS = 840;
export const DURACAO_VOO_LONGO_MS = 950;
const DESVANECER_MS = 200;
/** Distância do centro do símbolo ao topo da legenda, como no F (`metaPos.y + 68` com disco de 96). */
const FOLGA_LEGENDA = 20;

/** Centro e lado de um elemento na tela. `alvo` pode ser o id. */
export function medirJanete(alvo: string | Element | null | undefined): PontoJanete | null {
  if (typeof document === "undefined" || !alvo) return null;
  const el = typeof alvo === "string" ? document.getElementById(alvo) : alvo;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tamanho: r.width };
}

/** Espera o elemento com esse id aparecer (a tela de destino montar). `null` se passar do limite. */
export function esperarElemento(id: string, limiteMs = 2000): Promise<HTMLElement | null> {
  return new Promise((resolver) => {
    if (typeof document === "undefined") return resolver(null);
    const inicio = performance.now();
    const olhar = () => {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().width) return resolver(el);
      if (performance.now() - inicio > limiteMs) return resolver(null);
      setTimeout(olhar, 16);
    };
    olhar();
  });
}

/**
 * Espera a rolagem parar: a posição fica igual por 3 quadros seguidos (ou passa o limite).
 * Medir antes disso devolve a posição de onde o elemento ESTAVA, e o símbolo voa para o lugar errado.
 * Com `alvo`, olha a posição do próprio elemento na tela, e não só a da página: assim também vale
 * quando quem rola é um contêiner de dentro (a área da plataforma, o chat), que não muda o scrollY.
 */
export function esperarRolagemParar(limiteMs = 900, alvo?: Element | null): Promise<void> {
  return new Promise((resolver) => {
    if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") return resolver();
    const inicio = performance.now();
    const posicao = (): string => {
      if (alvo) {
        const r = alvo.getBoundingClientRect();
        return `${Math.round(r.left)},${Math.round(r.top)},${window.scrollX},${window.scrollY}`;
      }
      return `${window.scrollX},${window.scrollY}`;
    };
    let ultimo = posicao();
    let parados = 0;
    const olhar = () => {
      const agora = posicao();
      parados = agora === ultimo ? parados + 1 : 0;
      ultimo = agora;
      if (parados >= 3 || performance.now() - inicio > limiteMs) return resolver();
      requestAnimationFrame(olhar);
    };
    requestAnimationFrame(olhar);
  });
}

/**
 * Traz o elemento para a vista quando ele não está inteiro nela, espera a rolagem parar e só então
 * mede (centro e lado, como medirJanete). Toda passagem que mede um alvo para o símbolo voar, ou que
 * prende uma cena no lugar de um elemento, mede por aqui: assim nada fica desalinhado quando a
 * página está rolada ou quando um cartão acabou de abrir.
 */
export async function rolarAteEMedir(
  alvo: string | Element | null | undefined,
  opcoes: { bloco?: ScrollLogicalPosition } = {},
): Promise<PontoJanete | null> {
  if (typeof document === "undefined" || !alvo) return null;
  const el = typeof alvo === "string" ? document.getElementById(alvo) : alvo;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const altura = window.innerHeight || document.documentElement.clientHeight;
  const topoLivre = topoLivreDaTela();
  const inteiro = r.top >= topoLivre && r.bottom <= altura;
  if (!inteiro && typeof el.scrollIntoView === "function") {
    // Mais alto que a área livre: o começo dele fica logo abaixo da barra (o scroll-padding-top da
    // casca desconta a barra no scrollIntoView).
    const cabe = r.bottom - r.top <= altura - topoLivre;
    const bloco = cabe ? (opcoes.bloco ?? "center") : "start";
    el.scrollIntoView({ block: bloco, behavior: movimentoReduzido() ? "auto" : "smooth" });
    await esperarRolagemParar(900, el);
  }
  return medirJanete(el);
}

/**
 * Onde a área livre da tela começa: abaixo da barra de etapas do onboarding (`#onb-nav`, presa no
 * topo), quando ela está na tela; 0 fora do onboarding ou com a barra recolhida. Usa a altura de
 * layout da barra além da medida na tela: enquanto ela volta descendo, a medida ainda é menor que a
 * altura em que vai parar.
 */
function topoLivreDaTela(): number {
  const barra = document.getElementById("onb-nav");
  if (!barra || barra.hasAttribute("data-recolhe")) return 0;
  const fundo = barra.getBoundingClientRect().bottom;
  return Math.max(0, fundo, barra.offsetHeight || 0);
}

export function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Dois quadros: o navegador pinta o ponto de partida antes de a transição começar. */
function doisQuadros(): Promise<void> {
  return new Promise((resolver) => {
    if (typeof requestAnimationFrame === "undefined") return resolver();
    requestAnimationFrame(() => requestAnimationFrame(() => resolver()));
  });
}

const VAZIO: ControleVoo = {
  ativo: false,
  pousar: () => {},
  voar: () => Promise.resolve(),
  mudarEstado: () => {},
  legenda: () => {},
  soltar: () => {},
};

const Contexto = createContext<ControleVoo>(VAZIO);

/** Sem provedor (testes de uma tela solta), devolve um controle que não faz nada e `ativo: false`. */
export function useVooJanete(): ControleVoo {
  return useContext(Contexto);
}

interface Quadro {
  ponto: PontoJanete;
  estado: EstadoJanete;
  duracaoMs: number;
  saindo: boolean;
  /** Ligado no `pousar` da passagem do login; segue com o símbolo até ele ser solto. */
  metamorfose: boolean;
}

export function VooJaneteProvider({ children }: { children: ReactNode }) {
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const [texto, setTexto] = useState<{ legenda: LegendaVoo; saindo: boolean } | null>(null);
  const atual = useRef<Quadro | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const depois = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    const lista = timers.current;
    return () => lista.forEach(clearTimeout);
  }, []);

  const definir = useCallback((q: Quadro | null) => {
    atual.current = q;
    setQuadro(q);
  }, []);

  const pousar = useCallback<ControleVoo["pousar"]>(
    (em, estado, opcoes) =>
      definir({
        ponto: em,
        estado: estado ?? atual.current?.estado ?? "acordada",
        duracaoMs: 0,
        saindo: false,
        metamorfose: opcoes?.metamorfose ?? false,
      }),
    [definir],
  );

  const voar = useCallback<ControleVoo["voar"]>(
    async (para, opcoes = {}) => {
      const antes = atual.current;
      const estado = opcoes.estado ?? antes?.estado ?? "acordada";
      if (!antes || movimentoReduzido()) {
        definir({ ponto: para, estado, duracaoMs: 0, saindo: false, metamorfose: antes?.metamorfose ?? false });
        return;
      }
      await doisQuadros();
      // soltar() nesses dois quadros (a pessoa trocou de etapa ou saiu): o voo não traz o símbolo de volta.
      if (!atual.current || atual.current.saindo) return;
      const duracaoMs = opcoes.duracaoMs ?? DURACAO_VOO_MS;
      definir({ ponto: para, estado, duracaoMs, saindo: false, metamorfose: antes.metamorfose });
      await new Promise<void>((resolver) => depois(resolver, duracaoMs));
    },
    [definir, depois],
  );

  const mudarEstado = useCallback<ControleVoo["mudarEstado"]>(
    (estado) => {
      if (atual.current) definir({ ...atual.current, estado });
    },
    [definir],
  );

  const legenda = useCallback<ControleVoo["legenda"]>(
    (t) => {
      if (t) {
        setTexto({ legenda: t, saindo: false });
        return;
      }
      setTexto((v) => (v ? { ...v, saindo: true } : v));
      depois(() => setTexto((v) => (v?.saindo ? null : v)), DESVANECER_MS);
    },
    [depois],
  );

  const soltar = useCallback<ControleVoo["soltar"]>(
    (opcoes) => {
      if (!atual.current) return;
      if (!opcoes?.desvanecer || movimentoReduzido()) {
        definir(null);
        return;
      }
      definir({ ...atual.current, saindo: true });
      depois(() => {
        if (atual.current?.saindo) definir(null);
      }, DESVANECER_MS);
    },
    [definir, depois],
  );

  const controle = useMemo<ControleVoo>(
    () => ({ ativo: quadro !== null, pousar, voar, mudarEstado, legenda, soltar }),
    [quadro, pousar, voar, mudarEstado, legenda, soltar],
  );

  return (
    <Contexto.Provider value={controle}>
      {children}
      {quadro && (
        <JaneteSimbolo
          decorativo
          estado={quadro.estado}
          tamanho={quadro.ponto.tamanho}
          className={cx(s.voo, quadro.saindo && s.some)}
          data-voo-janete=""
          data-metamorfose={quadro.metamorfose ? "" : undefined}
          style={{
            left: quadro.ponto.x,
            top: quadro.ponto.y,
            // left, top, width, height seguem o voo; cor, canto e opacidade mantêm o tempo do símbolo.
            transitionDuration: `${quadro.duracaoMs}ms, ${quadro.duracaoMs}ms, ${quadro.duracaoMs}ms, ${quadro.duracaoMs}ms, 500ms, 420ms, 200ms`,
          }}
        />
      )}
      {quadro && texto && (
        <div
          aria-hidden="true"
          data-identidade="aipro"
          className={cx(s.legenda, texto.saindo && s.sai)}
          style={{
            left: quadro.ponto.x,
            top: quadro.ponto.y + quadro.ponto.tamanho / 2 + FOLGA_LEGENDA,
            transitionDuration: `${quadro.duracaoMs}ms, ${quadro.duracaoMs}ms, 200ms`,
          }}
        >
          <b>{texto.legenda.titulo}</b>
          {texto.legenda.detalhe && <span>{texto.legenda.detalhe}</span>}
        </div>
      )}
    </Contexto.Provider>
  );
}
