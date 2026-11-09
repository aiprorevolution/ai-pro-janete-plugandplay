import { MessageSquareText, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";

import { cx } from "@/components/aipro/cx";

import { usePapel } from "../papel";
import { useContexto } from "./loja";
import { s } from "./mapa-estilos";
import { G_SEP, G_SEP3, Pilha, type FasePilha } from "./Pilha";
import {
  alvoDoItem,
  conteudoDe,
  dadosDoAlvo,
  noTetoDeItens,
  plural,
  situacao,
  TEXTO_TETO_ITENS,
  versaoAtual,
  versaoNaTela,
  type EstadoContexto,
} from "./regras";
import { GRUPOS, camposDoGrupo, ehChaveCampo, infoCampo, type Alvo, type GrupoId, type Situacao } from "./tipos";
import type { FaseEntrada } from "./voo";

// O mapa do Contexto (docs/spec-contexto.md, task C1, e .ctx-mapa do Contexto 6): a pilha no centro,
// "Sobre a oferta" e "Como conversar" à esquerda, "Perguntas livres" à direita, e uma curva SVG de cada
// hub até o círculo do ícone de cada campo e de cada cartão. A curva e o contorno do círculo contam a
// situação: azul contínua ("sabe"), cinza pontilhada ("vazio") ou azul clara ("nao_salvo").
//
// Medidas: o mapa, o lugar da pilha, os hubs e os círculos, com getBoundingClientRect relativo ao mapa.
// Só na montagem, quando a disposição muda (a chave abaixo) e pelo ResizeObserver; nunca a cada render.
// Os hubs são medidos em relação ao #ctx-pilha (a razão não muda com a transformação do ensinar) e postos
// sobre o lugar da pilha sem transformação (.ancora). Com o balão de ensinar aberto, a pilha encolhe e
// desce por CSS, e as curvas acompanham pela mesma conta (ENS_S e ENS_DY), sem medir no meio da passagem.

/** Com o balão de ensinar, a pilha encolhe para esta fração… */
const ENS_S = 0.62;
/** …e desce esta fração do diâmetro (o mesmo do CSS, .mapa[data-ensina] .mover). */
const ENS_DY = 0.45;
/** O hub fica 8 px fora da borda do disco (o mesmo do Pilha.module.css). */
const HUB_FORA = 8;
/** O diâmetro no celular. */
const D_ESTREITA = 108;
/** A partir daqui a coluna da direita rola por dentro e os cartões ficam mais baixos. */
const MUITOS_CARTOES = 6;

const usarLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface PropsMapa {
  /** A fase da entrada (voo.ts). Antes do pouso ("casa" e "voo") a pilha não aparece. */
  fase: FaseEntrada;
  /** Repassado à Pilha (#ctx-pilha): o alvo do voo. */
  pilhaRef: Ref<HTMLDivElement>;
  /** Disco ou título do grupo (GrupoId: a seção abre no 1º item), linha ou cartão (Alvo). */
  aoAbrir(alvo: Alvo | GrupoId): void;
  /** A peça azul (só admin, na versão atual). */
  aoAbrirEnsinar(): void;
  /** O balão de ensinar aberto: a pilha encolhe e desce, e as curvas acompanham. */
  ensinarAberto: boolean;
  /** O raio que corre pela curva até a linha descoberta pelo Ensinar (`n` muda a cada envio). */
  raio?: { alvo: Alvo; n: number } | null | undefined;
  /** Celular: a Janete pequena no alto e os grupos em coluna, sem curvas. */
  estreita: boolean;
  /** O balão de ensinar (Ensinar.tsx), posto acima da peça. */
  balao?: ReactNode;
  className?: string | undefined;
}

/* ---------- a geometria ---------- */

interface Ponto {
  x: number;
  y: number;
}

interface Geo {
  w: number;
  h: number;
  /** O centro do disco do meio, sem a transformação do ensinar. */
  c: Ponto;
  d: number;
  hubs: Record<GrupoId, Ponto>;
  /** A ponta de cada curva: o contorno do círculo do ícone, no lado virado para a Janete. */
  pontas: Partial<Record<Alvo, Ponto>>;
}

type Bezier = [Ponto, Ponto, Ponto, Ponto];

const meio = (n: number) => Math.round(n * 2) / 2;
const fx = (n: number) => String(Math.round(n * 100) / 100);

/** A curva em S do protótipo: sai na horizontal do hub e chega na horizontal ao círculo. */
function sCurva(a: Ponto, b: Ponto): Bezier {
  const dx = b.x - a.x;
  return [a, { x: a.x + dx * 0.5, y: a.y }, { x: b.x - dx * 0.5, y: b.y }, b];
}

function caminho(c: Bezier): string {
  return `M${fx(c[0].x)} ${fx(c[0].y)}C${fx(c[1].x)} ${fx(c[1].y)} ${fx(c[2].x)} ${fx(c[2].y)} ${fx(c[3].x)} ${fx(c[3].y)}`;
}

/** O comprimento aproximado (14 trechos), para o tracejado da entrada e do raio. */
function comprimento(c: Bezier): number {
  let total = 0;
  let p = c[0];
  for (let i = 1; i <= 14; i += 1) {
    const t = i / 14;
    const m = 1 - t;
    const q = {
      x: m * m * m * c[0].x + 3 * m * m * t * c[1].x + 3 * m * t * t * c[2].x + t * t * t * c[3].x,
      y: m * m * m * c[0].y + 3 * m * m * t * c[1].y + 3 * m * t * t * c[2].y + t * t * t * c[3].y,
    };
    total += Math.hypot(q.x - p.x, q.y - p.y);
    p = q;
  }
  return total;
}

function centro(r: DOMRect): Ponto {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Mede o mapa. `null` quando ainda não há tamanho (fora da tela, ou num teste sem medidas). */
function medirMapa(raiz: HTMLElement, ancora: HTMLElement | null, pilha: HTMLElement | null, colDir: HTMLElement | null): Geo | null {
  const R = raiz.getBoundingClientRect();
  if (!R.width || !R.height || !ancora) return null;
  const A = ancora.getBoundingClientRect();
  const d = A.width;
  if (!d) return null;
  const ca = centro(A);
  const c = { x: meio(ca.x - R.left), y: meio(ca.y - R.top) };

  // os hubs, relativos ao #ctx-pilha medido (com ou sem a transformação, a razão é a mesma)
  const P = pilha?.getBoundingClientRect();
  const conta: Record<GrupoId, Ponto> = {
    oferta: { x: -(0.5 + HUB_FORA / d), y: -G_SEP },
    conversa: { x: -(0.5 + HUB_FORA / d), y: 0 },
    livres: { x: 0.5 + HUB_FORA / d, y: G_SEP3 },
  };
  const hubs = {} as Record<GrupoId, Ponto>;
  for (const g of GRUPOS) {
    let rel = conta[g.id];
    const el = pilha?.querySelector<HTMLElement>(`#ctx-hub-${g.id}`);
    if (P && P.width && el) {
      const h = el.getBoundingClientRect();
      const cp = centro(P);
      rel = { x: (h.left + h.width / 2 - cp.x) / P.width, y: (h.top + h.height / 2 - cp.y) / P.width };
    }
    hubs[g.id] = { x: meio(c.x + rel.x * d), y: meio(c.y + rel.y * d) };
  }

  // as pontas: à esquerda, o lado direito do círculo; à direita, o lado esquerdo
  const rolando = raiz.hasAttribute("data-muitos") && colDir ? colDir.getBoundingClientRect() : null;
  const pontas: Partial<Record<Alvo, Ponto>> = {};
  raiz.querySelectorAll<HTMLElement>("[data-ponta]").forEach((el) => {
    const { ponta, lado } = el.dataset;
    if (!ponta) return;
    const alvo = ponta as Alvo;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const y = r.top + r.height / 2;
    // com a coluna rolando, só ganha curva o cartão que está à vista
    if (lado === "esq" && rolando && (y < rolando.top || y > rolando.bottom)) return;
    const x = lado === "esq" ? r.left - R.left - 1 : r.right - R.left + 1;
    pontas[alvo] = { x: meio(x), y: meio(y - R.top) };
  });

  return { w: Math.ceil(R.width), h: Math.ceil(R.height), c, d, hubs, pontas };
}

function mesmaGeo(a: Geo | null, b: Geo | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ---------- o diâmetro: o do protótipo, clamp(170px, min(17.5vw, 28vh), 264px) ---------- */

const JANELA_PADRAO = { w: 1440, h: 900 };

function tamanhoJanela(): { w: number; h: number } {
  if (typeof window === "undefined") return JANELA_PADRAO;
  return { w: window.innerWidth || JANELA_PADRAO.w, h: window.innerHeight || JANELA_PADRAO.h };
}

function useDiametro(estreita: boolean): number {
  // o servidor e o 1º render do cliente usam a janela padrão (sem diferença na hidratação)
  const [jan, setJan] = useState(JANELA_PADRAO);
  usarLayout(() => {
    const ler = () =>
      setJan((ant) => {
        const n = tamanhoJanela();
        return n.w === ant.w && n.h === ant.h ? ant : n;
      });
    ler();
    window.addEventListener("resize", ler);
    return () => window.removeEventListener("resize", ler);
  }, []);
  if (estreita) return D_ESTREITA;
  return Math.round(Math.min(264, Math.max(170, Math.min(jan.w * 0.175, jan.h * 0.28))));
}

/* ---------- a entrada das curvas ---------- */

/** A pilha segue a fase da entrada; antes do pouso ela fica plana e escondida. */
function fasePilhaDe(f: FaseEntrada): FasePilha {
  if (f === "casa" || f === "voo" || f === "plano") return "plano";
  if (f === "inclinada") return "inclinada";
  return "separada";
}

/** Quando cada curva começa e quanto dura: em ordem, de cima para baixo (a curta é quase junta). */
function atrasoDe(i: number, breve: boolean): { atraso: number; dur: number } {
  return breve ? { atraso: i * 20, dur: 420 } : { atraso: 140 + i * 85, dur: 560 };
}

/* ---------- o vínculo entre os discos e os itens ---------- */

type Aceso = { grupo: GrupoId; origem: "disco" | "grupo" | "item"; alvo: Alvo | null } | null;

function ehGrupo(x: string | undefined): x is GrupoId {
  return x === "oferta" || x === "conversa" || x === "livres";
}

function acesoDe(alvo: EventTarget | null, raiz: HTMLElement | null): Aceso {
  if (!(alvo instanceof Element) || !raiz) return null;
  const el = alvo.closest<HTMLElement>("[data-camada],[data-grupo],[data-campo],[data-livre]");
  if (!el || !raiz.contains(el)) return null;
  const { camada, grupo, campo, livre } = el.dataset;
  if (ehGrupo(camada)) return { grupo: camada, origem: "disco", alvo: null };
  if (ehGrupo(grupo)) return { grupo, origem: "grupo", alvo: null };
  if (campo && ehChaveCampo(campo)) return { grupo: infoCampo(campo).grupo, origem: "item", alvo: campo };
  if (livre) return { grupo: "livres", origem: "item", alvo: livre === "novo" ? "livre-novo" : alvoDoItem(Number(livre)) };
  return null;
}

function mesmoAceso(a: Aceso, b: Aceso): boolean {
  return a?.grupo === b?.grupo && a?.origem === b?.origem && a?.alvo === b?.alvo;
}

/* ---------- textos ---------- */

const NOME_GRUPO: Record<GrupoId, string> = { oferta: "Sobre a oferta", conversa: "Como conversar", livres: "Perguntas livres" };
const POSICAO_DISCO: Record<GrupoId, string> = { oferta: "Disco de cima", conversa: "Disco do meio", livres: "Disco de baixo" };
const ESTADO_ARIA: Record<Situacao, string> = { sabe: "a Janete sabe", vazio: "ainda vazio", nao_salvo: "mudanças não salvas" };

/** A versão na tela é diferente da atual neste alvo? (só vendo uma versão antiga) */
function mudaDaAtual(estado: EstadoContexto, alvo: Alvo): boolean {
  if (estado.vendo === null) return false;
  const vista = dadosDoAlvo(versaoNaTela(estado), alvo);
  const atual = dadosDoAlvo(versaoAtual(estado), alvo);
  if (!vista || !atual) return vista !== atual;
  return (
    vista.texto.trim() !== atual.texto.trim() ||
    vista.pergunta.trim() !== atual.pergunta.trim() ||
    vista.anexos.map((a) => a.id).join("|") !== atual.anexos.map((a) => a.id).join("|")
  );
}

/** O glifo de cada grupo: as 3 camadas, com a do grupo cheia. */
function Glifo({ grupo }: { grupo: GrupoId }) {
  const cy: Record<GrupoId, number> = { oferta: 4.4, conversa: 11, livres: 17.6 };
  return (
    <svg className={s.glifo} viewBox="0 0 24 22" aria-hidden="true">
      {[17.6, 11, 4.4].map((y) => (
        <ellipse key={y} className={y === cy[grupo] ? s.ativa : undefined} cx="12" cy={y} rx="10" ry="3.3" />
      ))}
    </svg>
  );
}

/* ---------- o mapa ---------- */

interface Item {
  alvo: Alvo;
  grupo: GrupoId;
  /** A ordem do desenho: os 8 campos de cima para baixo, depois os cartões. */
  ordem: number;
}

export function Mapa({
  fase,
  pilhaRef,
  aoAbrir,
  aoAbrirEnsinar,
  ensinarAberto,
  raio = null,
  estreita,
  balao,
  className,
}: PropsMapa) {
  const { estado } = useContexto();
  const { papel } = usePapel();
  const admin = papel === "admin";
  const vendo = estado.vendo !== null;
  const podeEditar = admin && !vendo;
  const versao = versaoNaTela(estado);
  const itens = versao.itens;
  // com 50 perguntas livres, o "Novo item livre" fica desligado, com o motivo (podeEditar: a tela é a atual)
  const noTeto = podeEditar && noTetoDeItens(versao);
  const d = useDiametro(estreita);

  const fasePilha = fasePilhaDe(fase);
  const ligado = fase === "ligando" || fase === "pronto";
  const solto = fasePilha === "separada";

  // a entrada curta: o mapa montou já com a pilha separada (as outras visitas da sessão)
  const breve = useRef(fase === "separada" || fase === "ligando").current;

  // as curvas se desenhando: de "ligando" até a última chegar (segue em "pronto" até lá)
  const [desenho, setDesenho] = useState(fase === "ligando");
  const [faseAnt, setFaseAnt] = useState(fase);
  if (faseAnt !== fase) {
    setFaseAnt(fase);
    if (fase === "ligando") setDesenho(true);
    else if (!ligado) setDesenho(false);
  }

  /* ---- os itens, na ordem do desenho ---- */
  const lista = useMemo<Item[]>(() => {
    const campos: Item[] = GRUPOS.filter((g) => g.id !== "livres").flatMap((g) =>
      camposDoGrupo(g.id as Exclude<GrupoId, "livres">).map((c) => ({ alvo: c.chave as Alvo, grupo: g.id, ordem: 0 })),
    );
    const cartoes: Item[] = itens.map((_, i) => ({ alvo: alvoDoItem(i + 1), grupo: "livres" as const, ordem: 0 }));
    const novo: Item[] = podeEditar ? [{ alvo: "livre-novo", grupo: "livres", ordem: 0 }] : [];
    return [...campos, ...cartoes, ...novo].map((it, i) => ({ ...it, ordem: i }));
  }, [itens, podeEditar]);

  const ordemDe = useMemo(() => new Map(lista.map((it) => [it.alvo, it.ordem])), [lista]);
  const duracaoDesenho = useMemo(() => {
    const ultimo = atrasoDe(Math.max(0, lista.length - 1), breve);
    return ultimo.atraso + ultimo.dur + 120;
  }, [lista.length, breve]);

  useEffect(() => {
    if (!desenho) return;
    const t = setTimeout(() => setDesenho(false), duracaoDesenho);
    return () => clearTimeout(t);
  }, [desenho, duracaoDesenho]);

  /** Quando a curva chega no círculo (o contorno e o cartão acendem nessa hora). */
  const chegaDe = (alvo: Alvo): number => {
    if (!desenho) return 0;
    const a = atrasoDe(ordemDe.get(alvo) ?? 0, breve);
    return a.atraso + a.dur - 60;
  };

  /* ---- a situação de cada item (o atendente nunca vê rascunho) ---- */
  const situacoes = useMemo(() => {
    const m = new Map<Alvo, Situacao>();
    for (const it of lista) m.set(it.alvo, situacao(estado, it.alvo, admin));
    return m;
  }, [estado, lista, admin]);
  const situacaoDe = (alvo: Alvo): Situacao => situacoes.get(alvo) ?? "vazio";

  /* ---- as medidas ---- */
  const raizRef = useRef<HTMLDivElement | null>(null);
  const ancoraRef = useRef<HTMLSpanElement | null>(null);
  const pilhaLocal = useRef<HTMLDivElement | null>(null);
  const colDirRef = useRef<HTMLElement | null>(null);
  const colEsqRef = useRef<HTMLDivElement | null>(null);
  const cartoesRef = useRef<HTMLUListElement | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);

  const refPilha = useCallback(
    (el: HTMLDivElement | null) => {
      pilhaLocal.current = el;
      if (typeof pilhaRef === "function") pilhaRef(el);
      else if (pilhaRef) pilhaRef.current = el;
    },
    [pilhaRef],
  );

  const medir = useCallback(() => {
    const raiz = raizRef.current;
    const g = raiz && !estreita ? medirMapa(raiz, ancoraRef.current, pilhaLocal.current, colDirRef.current) : null;
    setGeo((ant) => (mesmaGeo(ant, g) ? ant : g));
  }, [estreita]);

  const quadro = useRef<number | null>(null);
  const agendar = useCallback(() => {
    if (typeof requestAnimationFrame !== "function") {
      medir();
      return;
    }
    if (quadro.current !== null) return;
    quadro.current = requestAnimationFrame(() => {
      quadro.current = null;
      medir();
    });
  }, [medir]);

  const nCartoes = itens.length + (podeEditar ? 1 : 0);
  const muitos = nCartoes >= MUITOS_CARTOES;
  // o que muda a disposição: só então se mede de novo (além do ResizeObserver)
  const chave = [estreita ? "e" : "l", d, nCartoes, papel, estado.vendo ?? 0].join("|");

  usarLayout(() => {
    medir();
  }, [medir, chave]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => agendar());
    for (const el of [raizRef.current, colEsqRef.current, colDirRef.current, cartoesRef.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [agendar, chave]);

  useEffect(
    () => () => {
      if (quadro.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(quadro.current);
      quadro.current = null;
    },
    [],
  );

  /* ---- o vínculo (hover ou foco) ---- */
  const [aceso, setAceso] = useState<Aceso>(null);
  const mudarAceso = (novo: Aceso) => setAceso((ant) => (mesmoAceso(ant, novo) ? ant : novo));
  const aoPassar = (e: SyntheticEvent) => {
    if (estreita || !solto) return;
    mudarAceso(acesoDe(e.target, raizRef.current));
  };
  const aoSair = () => mudarAceso(null);
  const aoTirarFoco = (e: FocusEvent) => {
    if (!raizRef.current?.contains(e.relatedTarget as Node | null)) mudarAceso(null);
  };
  const acesoNoGrupo = (g: GrupoId) => !!aceso && aceso.grupo === g && aceso.origem !== "item";

  /* ---- as curvas ---- */
  const curvas = useMemo(() => {
    if (!geo || estreita || !ligado) return [];
    const sc = ensinarAberto ? ENS_S : 1;
    const dy = ensinarAberto ? ENS_DY * geo.d : 0;
    const hubDe = (g: GrupoId): Ponto => {
      const h = geo.hubs[g];
      return { x: geo.c.x + sc * (h.x - geo.c.x), y: geo.c.y + sc * (h.y - geo.c.y) + dy };
    };
    return lista.flatMap((it) => {
      const ponta = geo.pontas[it.alvo];
      if (!ponta) return [];
      const bz = sCurva(hubDe(it.grupo), ponta);
      return [{ ...it, d: caminho(bz), len: comprimento(bz) + 2, hub: hubDe(it.grupo) }];
    });
  }, [geo, estreita, ligado, ensinarAberto, lista]);

  const portas = useMemo(() => {
    const vistos = new Map<GrupoId, { hub: Ponto; temSabe: boolean }>();
    for (const c of curvas) {
      const p = vistos.get(c.grupo) ?? { hub: c.hub, temSabe: false };
      if (situacoes.get(c.alvo) === "sabe") p.temSabe = true;
      vistos.set(c.grupo, p);
    }
    return GRUPOS.flatMap((g) => {
      const p = vistos.get(g.id);
      return p ? [{ grupo: g.id, ...p }] : [];
    });
  }, [curvas, situacoes]);

  /* ---- os textos acessíveis ---- */
  const cheiosDe = (g: Exclude<GrupoId, "livres">) =>
    camposDoGrupo(g).filter((c) => versao.campos[c.chave].trim() || versao.anexos[c.chave].length).length;
  const resumoGrupo: Record<GrupoId, string> = {
    oferta: `${cheiosDe("oferta")} de 4 campos com conteúdo`,
    conversa: `${cheiosDe("conversa")} de 4 campos com conteúdo`,
    livres: plural(itens.length, "pergunta", "perguntas"),
  };
  const rotulosDiscos: Record<GrupoId, string> = {
    oferta: `${POSICAO_DISCO.oferta}, ${NOME_GRUPO.oferta}: ${resumoGrupo.oferta}. Abrir a área.`,
    conversa: `${POSICAO_DISCO.conversa}, ${NOME_GRUPO.conversa}: ${resumoGrupo.conversa}. Abrir a área.`,
    livres: `${POSICAO_DISCO.livres}, ${NOME_GRUPO.livres}: ${resumoGrupo.livres}. Abrir a área.`,
  };

  const escondida = fase === "casa" || fase === "voo";
  const estiloRaiz = { "--d": `${d}px` } as CSSProperties;
  const W = Math.max(1, geo?.w ?? 1);
  const H = Math.max(1, geo?.h ?? 1);
  const curvaDoRaio = raio ? curvas.find((c) => c.alvo === raio.alvo) : undefined;

  /* ---- um título de grupo ---- */
  const tituloGrupo = (g: GrupoId) => (
    <h2 id={`ctx-g-${g}`} className={s.grupoTit}>
      <button
        type="button"
        id={`ctx-gb-${g}`}
        data-grupo={g}
        className={s.grupoBtn}
        data-aceso={aceso?.grupo === g && aceso.origem === "disco" ? "" : undefined}
        aria-label={`${NOME_GRUPO[g]}: ${resumoGrupo[g]}. Abrir a área.`}
        onClick={() => aoAbrir(g)}
      >
        <Glifo grupo={g} />
        <span>{NOME_GRUPO[g]}</span>
      </button>
    </h2>
  );

  /* ---- a Janete: a pilha, a legenda e o balão de ensinar ---- */
  const camadaJanete = (
    <div className={s.janete} data-ctx-janete="">
      <span ref={ancoraRef} className={s.ancora} data-ancora="" aria-hidden="true" />
      <div className={s.mover}>
        <div className={s.lugar} data-escondida={escondida ? "" : undefined}>
          <Pilha
            ref={refPilha}
            fase={fasePilha}
            d={d}
            dormindo={vendo}
            destaque={aceso?.grupo ?? null}
            aoClicarDisco={(g) => aoAbrir(g)}
            aoClicarPeca={podeEditar ? aoAbrirEnsinar : undefined}
            pecaAberta={podeEditar ? ensinarAberto : undefined}
            rotulos={rotulosDiscos}
          />
        </div>
      </div>
      <div className={s.leg} data-visivel={solto ? "" : undefined}>
        <b className={s.legTit}>Conhecimento da Janete</b>
        <span className={s.pilula}>{vendo ? `Versão ${versao.numero} · só leitura` : `Versão ${versao.numero} em uso`}</span>
      </div>
      {balao ? <div className={s.balao}>{balao}</div> : null}
    </div>
  );

  return (
    <div
      ref={raizRef}
      id="ctx-mapa"
      className={cx(s.mapa, className)}
      style={estiloRaiz}
      data-fase={fase}
      data-antes={!ligado ? "" : undefined}
      data-desenha={desenho ? "" : undefined}
      data-antiga={vendo ? "" : undefined}
      data-ensina={ensinarAberto ? "" : undefined}
      data-muitos={muitos ? "" : undefined}
      data-estreita={estreita ? "" : undefined}
      onMouseOver={aoPassar}
      onMouseLeave={aoSair}
      onFocus={aoPassar}
      onBlur={aoTirarFoco}
    >
      {/* no celular, a Janete vem primeiro (no alto da coluna) */}
      {estreita ? camadaJanete : null}

      {/* à esquerda: Sobre a oferta e Como conversar */}
      <div ref={colEsqRef} className={cx(s.col, s.colEsq)}>
        {(["oferta", "conversa"] as const).map((g) => (
          <section key={g} className={s.grupo} aria-labelledby={`ctx-g-${g}`}>
            {tituloGrupo(g)}
            <ul className={s.linhas}>
              {camposDoGrupo(g).map((c) => {
                const sit = situacaoDe(c.chave);
                const muda = mudaDaAtual(estado, c.chave);
                const nAnexos = conteudoDe(estado, c.chave, admin)?.anexos.length ?? 0;
                const Icone = c.icone;
                return (
                  <li key={c.chave}>
                    <button
                      type="button"
                      id={`ctx-l-${c.chave}`}
                      data-campo={c.chave}
                      className={s.linha}
                      data-situacao={sit}
                      data-muda={muda ? "" : undefined}
                      data-aceso={acesoNoGrupo(g) ? "" : undefined}
                      aria-label={`${c.rotulo}, ${ESTADO_ARIA[sit]}${nAnexos ? `, ${plural(nAnexos, "anexo", "anexos")}` : ""}${
                        muda ? ", diferente da versão atual" : ""
                      }. Abre a área ${NOME_GRUPO[g]}.`}
                      onClick={() => aoAbrir(c.chave)}
                    >
                      <span className={s.nome} aria-hidden="true">
                        {c.rotulo}
                      </span>
                      <span
                        id={`ctx-li-${c.chave}`}
                        className={s.ico}
                        data-ponta={c.chave}
                        data-lado="dir"
                        data-situacao={sit}
                        style={{ "--chega": `${chegaDe(c.chave)}ms` } as CSSProperties}
                        aria-hidden="true"
                      >
                        <Icone className={s.icoSvg} strokeWidth={1.8} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* no computador, a Janete fica entre as 2 colunas no DOM: o Tab segue a leitura, da esquerda para a
          direita (a pintura não muda: o z-index é explícito) */}
      {!estreita ? camadaJanete : null}

      {/* à direita: as perguntas livres, ligadas ao hub da direita do disco de baixo */}
      <section
        ref={colDirRef}
        className={cx(s.col, s.colDir)}
        aria-labelledby="ctx-g-livres"
        onScroll={muitos ? agendar : undefined}
      >
        <div className={s.grupo}>
          {tituloGrupo("livres")}
          <ul ref={cartoesRef} className={s.cartoes}>
            {itens.map((item, i) => {
              const n = i + 1;
              const alvo = alvoDoItem(n);
              const sit = situacaoDe(alvo);
              const pergunta = conteudoDe(estado, alvo, admin)?.pergunta || item.pergunta;
              const muda = mudaDaAtual(estado, alvo);
              const chega = chegaDe(alvo);
              return (
                <li key={n}>
                  <button
                    type="button"
                    id={`ctx-card-${n}`}
                    data-livre={String(n)}
                    className={s.cartao}
                    data-situacao={sit}
                    data-muda={muda ? "" : undefined}
                    data-aceso={acesoNoGrupo("livres") ? "" : undefined}
                    style={{ "--chega": `${chega}ms` } as CSSProperties}
                    aria-label={`Pergunta livre ${n}: ${pergunta}${sit === "nao_salvo" ? " Mudanças não salvas." : ""} Abre a área Perguntas livres.`}
                    onClick={() => aoAbrir(alvo)}
                  >
                    <span
                      id={`ctx-ci-${n}`}
                      className={s.ico}
                      data-ponta={alvo}
                      data-lado="esq"
                      data-situacao={sit}
                      style={{ "--chega": `${chega}ms` } as CSSProperties}
                      aria-hidden="true"
                    >
                      <MessageSquareText className={s.icoSvg} strokeWidth={1.8} />
                    </span>
                    <span className={s.cartaoP} aria-hidden="true">
                      {pergunta}
                    </span>
                  </button>
                </li>
              );
            })}
            {podeEditar ? (
              <li>
                <button
                  type="button"
                  id="ctx-card-novo"
                  data-livre="novo"
                  className={s.cartao}
                  data-novo=""
                  data-desligado={noTeto ? "" : undefined}
                  data-situacao={situacaoDe("livre-novo")}
                  data-aceso={acesoNoGrupo("livres") ? "" : undefined}
                  aria-label="Novo item livre: acrescentar uma pergunta e a resposta"
                  // aria-disabled (e não disabled): o cartão segue no Tab e o leitor de tela lê o motivo
                  aria-disabled={noTeto ? "true" : undefined}
                  aria-describedby={noTeto ? "ctx-card-novo-motivo" : undefined}
                  onClick={() => {
                    if (!noTeto) aoAbrir("livre-novo");
                  }}
                >
                  <span
                    id="ctx-ci-novo"
                    className={s.ico}
                    data-ponta="livre-novo"
                    data-lado="esq"
                    data-situacao={situacaoDe("livre-novo")}
                    aria-hidden="true"
                  >
                    <Plus className={s.icoSvg} strokeWidth={2} />
                  </span>
                  <span className={s.cartaoP} aria-hidden="true">
                    Novo item livre
                  </span>
                  {noTeto ? (
                    <span id="ctx-card-novo-motivo" className={s.cartaoMotivo} data-motivo="">
                      {TEXTO_TETO_ITENS}
                    </span>
                  ) : null}
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      </section>

      {/* as ligações: dos hubs dos discos até o círculo do ícone de cada item (só no computador) */}
      {!estreita ? (
        <div className={s.fios} aria-hidden="true">
          {curvas.length ? (
            <svg className={s.svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
              {/* as vazias embaixo, as acesas por cima */}
              {[...curvas]
                .sort((a, b) => Number(situacaoDe(b.alvo) === "vazio") - Number(situacaoDe(a.alvo) === "vazio"))
                .map((c) => {
                  const sit = situacaoDe(c.alvo);
                  const a = atrasoDe(c.ordem, breve);
                  const estilo = {
                    d: `path('${c.d}')`,
                    "--len": `${fx(c.len)}px`,
                    "--atraso": `${a.atraso}ms`,
                    "--dur": `${a.dur}ms`,
                  } as CSSProperties;
                  const doGrupo = !!aceso && aceso.grupo === c.grupo;
                  return (
                    <g key={c.alvo}>
                      <path
                        className={s.fio}
                        d={c.d}
                        style={estilo}
                        data-alvo={c.alvo}
                        data-de={c.grupo}
                        data-situacao={sit}
                        strokeDasharray={sit === "vazio" ? "4 5" : undefined}
                        data-aceso={doGrupo ? (aceso?.alvo === c.alvo ? "item" : "grupo") : undefined}
                        data-esmaecido={aceso && !doGrupo ? "" : undefined}
                      />
                      {sit === "vazio" ? <path className={s.borracha} d={c.d} style={estilo} /> : null}
                    </g>
                  );
                })}
              {curvaDoRaio && raio ? (
                <path
                  key={`raio-${raio.n}`}
                  className={s.raio}
                  d={curvaDoRaio.d}
                  data-raio={raio.alvo}
                  style={{ d: `path('${curvaDoRaio.d}')`, "--len": `${fx(curvaDoRaio.len)}px` } as CSSProperties}
                />
              ) : null}
            </svg>
          ) : null}
          {portas.map((p, gi) => (
            <span
              key={p.grupo}
              className={s.porta}
              data-porta={p.grupo}
              data-vazio={p.temSabe ? undefined : ""}
              data-aceso={aceso?.grupo === p.grupo ? "" : undefined}
              data-esmaecido={aceso && aceso.grupo !== p.grupo ? "" : undefined}
              style={
                {
                  left: `${fx(p.hub.x)}px`,
                  top: `${fx(p.hub.y)}px`,
                  "--chega": `${desenho && !breve ? (p.grupo === "livres" ? 760 : gi * 90) : 0}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
