import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type Ref, type RefObject } from "react";

import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { type Classes } from "@/components/aipro/cx";

import { contagem, numero, type PainelDashboard } from "../../dados";
import { acharRolador, ambienteDoPalco, ETAPA_SAIRAM, idCapitulo, lerRolador, rolarPara } from "./apoio";
import { ESTADO_TEXTO } from "./Cartoes";
import { abrirFaleComAJanete } from "./voo";
import {
  camadas,
  deslocamentoDoCapitulo,
  FAIXAS,
  FOLGA_CAPITULO,
  faseDoP,
  geometria,
  recipiente,
  VIAGEM_TELAS,
  variaveisDaGeometria,
  variaveisDoQuadro,
  type FaseB,
  type GeometriaPalco,
} from "./coreografia";
import { DEPOIS_DA_JANETE, FunilAberto, FunilLinhas, FunilPalco, TabelaDoFunil, type ColunaFunil } from "./Funil";
import { TextoNumero } from "./pecas";
import estilos from "./Palco.module.css";

const s = estilos as Classes<
  | "dvbPalco"
  | "dvbVista"
  | "dvbVeu"
  | "dvbFaixaFundo"
  | "dvbCartaoFunil"
  | "dvbSombraA"
  | "dvbSombraB"
  | "dvbSombraC"
  | "dvbMoldura"
  | "dvbConteudo"
  | "dvbIndiceCaixa"
  | "dvbTrilho"
  | "dvbDetalhe"
  | "dvbCartaoFluxo"
  | "dvbIndice"
  | "dvbIndiceLista"
  | "dvbIndiceItem"
  | "dvbChip"
  | "dvbChipNome"
  | "dvbChipNumero"
  | "dvbChipOsso"
  | "dvbChipTrilho"
  | "dvbChipBarra"
  | "dvbChipSairam"
  | "dvbChipSeta"
  | "dvbIndiceJanete"
  | "dvbIndiceJaneteBotao"
>;

// O palco do funil (spec 7): a seção alta onde o MESMO cartão do funil cresce, se abre e vira o índice
// das etapas, preso no topo enquanto os capítulos passam por baixo dele.
//
// Estrutura (computador largo, com movimento):
//   <section data-dash="palco">   o --p (spec 14.5) e a geometria medida (--g-*) ficam aqui
//     <div vista>                 presa embaixo do topo, da altura visível, transparente ao clique;
//                                 as variáveis de cada quadro são escritas nela (e não no palco, que
//                                 contém os capítulos: nada fora da vista recalcula a cada quadro)
//       fundo de tela · véu · <div data-dash="funil"> sombras + moldura + conteúdo + <nav índice>
//     <div trilho>                a distância de rolagem da transição (VIAGEM_TELAS, 2 telas)
//     <div detalhe>               os capítulos; sobem por baixo da vista e, em p = 1, começam logo
//                                 abaixo da faixa do índice
// Sem palco (movimento reduzido, jsdom, janela estreita, celular): o cartão fica no fluxo, já aberto,
// o índice vem logo abaixo (preso no topo) e os capítulos seguem em fluxo normal.

export type ModoPalco = "palco" | "aberto" | "celular";

export interface ItemIndice {
  id: string;
  nome: string;
  chegaram: number | null;
  /** O comprimento da mini barra (o mesmo desenho da coluna do funil). */
  v: number;
  ganho: boolean;
}

/* ---------- o índice das etapas ---------- */

/**
 * A Janete no centro da faixa (mudança 5 da final): um botão de 44 px, "Fale com a Janete" mais o estado
 * dela, que clica no #janete-gatilho como o símbolo do topo.
 */
function JaneteDaFaixa({ estado, tamanho }: { estado: PainelDashboard["estadoJanete"]; tamanho: number }) {
  return (
    // role="none": o item da Janete não conta como etapa na lista ("lista, 6 itens"); o botão continua acessível
    <li className={s.dvbIndiceJanete} data-janete="" role="none">
      <button
        type="button"
        className={s.dvbIndiceJaneteBotao}
        aria-label={`Fale com a Janete · ${ESTADO_TEXTO[estado]}`}
        aria-haspopup="dialog"
        onClick={(ev) => abrirFaleComAJanete(ev.currentTarget)}
      >
        <JaneteSimbolo decorativo estado={estado} tamanho={tamanho} />
      </button>
    </li>
  );
}

/** Depois de qual chip vem a seta: entre os 3 da esquerda e entre os 3 da direita (nunca encostada na Janete nem antes dos que saíram). */
function temSeta(i: number, n: number): boolean {
  return i < n - 2 && i !== DEPOIS_DA_JANETE - 1;
}

/**
 * O índice (spec 7.3): um `nav` com um link por etapa e o "Para onde foram os que saíram", com a Janete
 * no centro (3 itens de cada lado). No palco, ele fica dentro do cartão do funil, no lugar exato da
 * faixa desenhada pela transição (cada chip no lugar que a faixa com a Janete reserva para ele), e
 * assume quando o desenho termina. `aria-current` marca o capítulo visível.
 */
export function Indice({
  itens,
  ativo,
  modo,
  carregando,
  reduzido,
  estadoJanete,
  aoIr,
  aoFocar,
  refNav,
}: {
  itens: ItemIndice[];
  ativo: string | null;
  modo: ModoPalco;
  carregando: boolean;
  reduzido: boolean;
  estadoJanete: PainelDashboard["estadoJanete"];
  aoIr: (etapa: string) => void;
  /** O foco entrou no índice (no palco, antes da troca, o motor rola até a faixa real aparecer). */
  aoFocar?: (() => void) | undefined;
  refNav?: Ref<HTMLElement> | undefined;
}) {
  const lista = useRef<HTMLOListElement>(null);
  // No celular, a fileira acompanha o capítulo visível (rola na horizontal até o chip ativo).
  useEffect(() => {
    const caixa = lista.current;
    if (modo !== "celular" || !ativo || !caixa) return;
    const chip = Array.from(caixa.querySelectorAll<HTMLElement>("[data-etapa]")).find((el) => el.dataset["etapa"] === ativo);
    if (!chip || typeof caixa.scrollTo !== "function") return;
    const alvo = chip.offsetLeft - caixa.clientWidth / 2 + chip.offsetWidth / 2;
    caixa.scrollTo({ left: Math.max(0, alvo), behavior: reduzido ? "auto" : "smooth" });
  }, [ativo, modo, reduzido]);

  return (
    <nav ref={refNav} data-dash="indice" className={s.dvbIndice} data-modo={modo} aria-label="Etapas do funil" onFocus={aoFocar}>
      <ol ref={lista} className={s.dvbIndiceLista}>
        {itens.map((it, i) => {
          const sairam = it.id === ETAPA_SAIRAM;
          const rotulo = sairam
            ? "Para onde foram os que saíram"
            : carregando || it.chegaram === null
              ? it.nome
              : `${it.nome}: ${contagem(it.chegaram, "chegou", "chegaram")}`;
          return (
            <Fragment key={it.id}>
            {i === DEPOIS_DA_JANETE ? <JaneteDaFaixa estado={estadoJanete} tamanho={modo === "celular" ? 32 : 40} /> : null}
            <li
              className={s.dvbIndiceItem}
              style={{ "--i": i, "--depois": i >= DEPOIS_DA_JANETE ? 1 : 0, "--dvb-v": it.v } as CSSProperties}
              data-sairam={sairam || undefined}
            >
              <a
                href={`#${idCapitulo(it.id)}`}
                className={s.dvbChip}
                data-etapa={it.id}
                data-ganho={it.ganho || undefined}
                aria-label={rotulo}
                aria-current={ativo === it.id ? "true" : undefined}
                onClick={(ev) => {
                  ev.preventDefault();
                  aoIr(it.id);
                }}
              >
                {sairam ? (
                  <span className={s.dvbChipSairam}>
                    Para onde foram
                    <br />
                    os que saíram
                  </span>
                ) : (
                  <>
                    <span className={s.dvbChipNome}>{it.nome}</span>
                    {carregando || it.chegaram === null ? (
                      <span className={s.dvbChipOsso} aria-hidden="true" />
                    ) : (
                      <TextoNumero texto={numero(it.chegaram)} className={s.dvbChipNumero} />
                    )}
                    <span className={s.dvbChipTrilho} aria-hidden="true">
                      <span className={s.dvbChipBarra} />
                    </span>
                  </>
                )}
              </a>
              {temSeta(i, itens.length) ? (
                <span className={s.dvbChipSeta} aria-hidden="true">
                  <ChevronRight size={16} strokeWidth={2.2} />
                </span>
              ) : null}
            </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------- o motor da rolagem ---------- */

function alternar(el: HTMLElement, nome: string, ligado: boolean) {
  if (ligado) el.setAttribute(nome, "");
  else el.removeAttribute(nome);
}

interface Motor {
  ativo: boolean;
  admin: boolean;
  palco: RefObject<HTMLElement | null>;
  vista: RefObject<HTMLElement | null>;
  trilho: RefObject<HTMLElement | null>;
  detalhe: RefObject<HTMLElement | null>;
  nav: RefObject<HTMLElement | null>;
  resultado: RefObject<HTMLElement | null>;
  aoFase: (fase: FaseB) => void;
  aoCapitulo: (etapa: string | null) => void;
  /** O motor põe aqui o "rolar até a faixa real" (o foco do teclado no índice antes da troca). */
  irAoIndice: { current: (() => void) | null };
}

/** As fases em que algo do palco anda com a rolagem (só nelas há will-change). */
const FASES_EM_MOVIMENTO: ReadonlySet<FaseB> = new Set<FaseB>(["crescer", "abrir", "indice"]);

/**
 * O progresso `p` (spec 7.2): ouve a rolagem do ancestral que rola (o .platMain no computador) um
 * quadro por vez, mede o palco e escreve o `--p` no próprio [data-dash="palco"] e as camadas da
 * coreografia na vista presa. O React só fica sabendo quando a fase ou o capítulo visível mudam.
 *
 * Calibragem: `p` sobe desde o 1º pixel de rolagem (o funil já está na borda da dobra). O trecho
 * "antes" é a distância do topo visível até o palco com a rolagem no começo (no máximo uma tela);
 * depois dele vem a viagem do trilho, com a vista presa. Assim o cartão sobe junto com a rolagem
 * enquanto cresce e prende no topo perto do fim do crescimento.
 *
 * Atributos escritos direto na vista (sem React): `data-movendo` nas fases em que algo anda (o
 * will-change só existe aí), `data-rolando` enquanto um gesto de rolagem acontece (o hover das colunas
 * fica desligado: o funil passa embaixo de um cursor parado), `data-sai-fim` quando o conteúdo aberto
 * terminou de sair e `data-troca` quando a faixa real assume.
 */
function useMotorDoPalco(m: Motor) {
  const aoFase = useRef(m.aoFase);
  aoFase.current = m.aoFase;
  const aoCapitulo = useRef(m.aoCapitulo);
  aoCapitulo.current = m.aoCapitulo;

  useLayoutEffect(() => {
    const el = m.palco.current;
    if (!el || typeof window === "undefined") return;
    let fase: FaseB | "" = "";
    let capitulo: string | null | undefined;
    const vistaAtual = m.vista.current;
    const publicarFase = (f: FaseB) => {
      if (f === fase) return;
      fase = f;
      if (m.ativo && vistaAtual) alternar(vistaAtual, "data-movendo", FASES_EM_MOVIMENTO.has(f));
      aoFase.current(f);
    };
    const publicarCapitulo = (c: string | null) => {
      if (c === capitulo) return;
      capitulo = c;
      aoCapitulo.current(c);
    };
    const capituloNaLinha = (linha: number): string | null => {
      const lista = m.detalhe.current?.querySelectorAll<HTMLElement>('[data-dash="capitulo"]');
      let achado: string | null = null;
      lista?.forEach((cap) => {
        if (cap.getBoundingClientRect().top <= linha) achado = cap.dataset["etapa"] ?? null;
      });
      return achado;
    };

    // Sem palco: o --p fica em 1 (o funil já aberto); com layout (movimento reduzido, janela estreita,
    // celular), a rolagem ainda diz a fase e o capítulo visível. No jsdom, nada roda.
    if (!m.ativo) {
      el.style.setProperty("--p", "1");
      if (!ambienteDoPalco()) return;
      const rolador = acharRolador(el);
      let quadro = 0;
      const medir = () => {
        quadro = 0;
        const r = lerRolador(rolador);
        const nav = m.nav.current;
        const topoNav = nav ? parseFloat(window.getComputedStyle(nav).top) || 0 : 0;
        const topoVisivel = r.topo + topoNav;
        const v = r.altura - topoNav;
        const alturaNav = nav?.offsetHeight ?? 0;
        const primeiro = m.detalhe.current?.querySelector<HTMLElement>('[data-dash="capitulo"]');
        const resultado = m.resultado.current?.getBoundingClientRect().top ?? Infinity;
        const inicioDetalhe = primeiro ? primeiro.getBoundingClientRect().top : Infinity;
        let f: FaseB = inicioDetalhe <= topoVisivel + alturaNav + v * 0.4 ? "detalhe" : "repouso";
        if (resultado < topoVisivel + v * 0.55) f = "resultado";
        publicarFase(f);
        publicarCapitulo(f === "detalhe" ? capituloNaLinha(topoVisivel + alturaNav + v * 0.3) : null);
      };
      const pedir = () => {
        if (!quadro) quadro = requestAnimationFrame(medir);
      };
      medir();
      rolador.addEventListener("scroll", pedir, { passive: true });
      window.addEventListener("resize", pedir);
      return () => {
        rolador.removeEventListener("scroll", pedir);
        window.removeEventListener("resize", pedir);
        if (quadro) cancelAnimationFrame(quadro);
      };
    }

    const vista = m.vista.current;
    if (!vista) return;
    const rolador = acharRolador(el);
    let geo: GeometriaPalco | null = null;
    let topoVista = 0;
    let viagem = 0;
    let ultimoP = -1;
    let quadro = 0;
    // O 1º capítulo nasce por opacidade (e 8 px) enquanto o cartão encolhe, e os capítulos sobem colados
    // ao pé do cartão: a cada quadro o detalhe se desloca o que for preciso para o 1º capítulo começar
    // logo abaixo dele (só transform; em p = 1 o deslocamento é zero e o detalhe fica no fluxo).
    let primeiroCap: HTMLElement | null = null;
    let ultimoCap = -1;
    let topoCapNoPalco = 0;
    let ultimoDy = -1;
    const mostrarCapitulo = (o: number) => {
      if (!primeiroCap || o === ultimoCap) return;
      ultimoCap = o;
      primeiroCap.style.opacity = o >= 1 ? "" : o.toFixed(3);
      primeiroCap.style.transform = o >= 1 ? "" : `translateY(${(8 * (1 - o)).toFixed(2)}px)`;
    };
    const descerDetalhe = (dy: number) => {
      const det = m.detalhe.current;
      const arredondado = Math.round(dy * 2) / 2;
      if (!det || arredondado === ultimoDy) return;
      ultimoDy = arredondado;
      det.style.transform = arredondado !== 0 ? `translateY(${arredondado}px)` : "";
    };
    /** O topo do elemento em relação ao palco, pelo offsetTop (que ignora os transforms). */
    const topoNoPalco = (alvo: HTMLElement | null): number => {
      let y = 0;
      let no: HTMLElement | null = alvo;
      while (no && no !== el) {
        y += no.offsetTop;
        no = no.offsetParent as HTMLElement | null;
      }
      return y;
    };
    let parado: ReturnType<typeof setTimeout> | null = null;
    const ligados = { saiFim: false, troca: false };
    // a última leitura da rolagem (para o "rolar até a faixa real")
    const ultimo = { antes: 0, alcance: 0, distancia: 0, rolado: 0 };

    const medir = () => {
      topoVista = parseFloat(window.getComputedStyle(vista).top) || 0;
      const r = lerRolador(rolador);
      const v = Math.max(320, r.altura - topoVista);
      geo = geometria({ v, w: el.clientWidth, admin: m.admin });
      // a geometria vai no palco: a vista, o trilho e o recuo dos capítulos usam a mesma altura
      for (const [nome, valor] of variaveisDaGeometria(geo)) el.style.setProperty(nome, valor);
      viagem = m.trilho.current?.offsetHeight || Math.round(v * VIAGEM_TELAS);
      const cap = m.detalhe.current?.querySelector<HTMLElement>('[data-dash="capitulo"]') ?? null;
      if (cap !== primeiroCap) {
        if (primeiroCap) {
          primeiroCap.style.opacity = "";
          primeiroCap.style.transform = "";
        }
        primeiroCap = cap;
        ultimoCap = -1;
      }
      topoCapNoPalco = cap ? topoNoPalco(cap) : topoNoPalco(m.detalhe.current);
      ultimoDy = -1;
      ultimoP = -1;
    };

    const desenhar = () => {
      quadro = 0;
      if (!geo) return;
      const r = lerRolador(rolador);
      const topoVisivel = r.topo + topoVista;
      const v = geo.v;
      // a distância do topo visível até o palco (positiva antes de ele chegar) e a mesma no começo da rolagem
      const distancia = el.getBoundingClientRect().top - topoVisivel;
      const noComeco = distancia + r.rolado;
      const antes = Math.max(0, Math.min(noComeco, v));
      const alcance = antes + viagem;
      const p = alcance > 0 ? Math.min(1, Math.max(0, (antes - distancia) / alcance)) : 1;
      ultimo.antes = antes;
      ultimo.alcance = alcance;
      ultimo.distancia = distancia;
      ultimo.rolado = r.rolado;
      if (Math.abs(p - ultimoP) >= 0.00005) {
        ultimoP = p;
        el.style.setProperty("--p", p.toFixed(4));
        const c = camadas(p);
        for (const [nome, valor] of variaveisDoQuadro(c, geo, { antes, alcance })) vista.style.setProperty(nome, valor);
        // onde o 1º capítulo estaria na vista (a vista fica no topo do palco até prender no topo visível);
        // a folga é a de p = 1 (o topo dele em p = 1 menos o pé da faixa), para o deslocamento terminar em zero
        const topoNatural = topoCapNoPalco + Math.min(0, distancia);
        const folga = Math.max(FOLGA_CAPITULO, topoCapNoPalco - viagem - (geo.t2 + geo.hs));
        descerDetalhe(deslocamentoDoCapitulo(p, recipiente(c, geo, { antes, alcance }), topoNatural, folga));
        const saiFim = c.sai >= 0.999;
        if (saiFim !== ligados.saiFim) {
          ligados.saiFim = saiFim;
          alternar(vista, "data-sai-fim", saiFim);
        }
        const troca = p >= FAIXAS.troca;
        if (troca !== ligados.troca) {
          ligados.troca = troca;
          alternar(vista, "data-troca", troca);
        }
        mostrarCapitulo(c.capitulo);
      }
      let f: FaseB = faseDoP(p);
      if (f === "detalhe") {
        const topoResultado = m.resultado.current?.getBoundingClientRect().top ?? Infinity;
        if (topoResultado < topoVisivel + v * 0.55) f = "resultado";
      }
      publicarFase(f);
      // o chip da etapa visível acende no mesmo quadro em que a faixa real assume
      publicarCapitulo(p >= FAIXAS.troca ? capituloNaLinha(topoVisivel + geo.t2 + geo.hs + v * 0.3) : null);
    };

    const pedir = () => {
      if (!quadro) quadro = requestAnimationFrame(desenhar);
      // durante o gesto, o hover das colunas fica desligado (nada de balão a cada pausa da roda)
      if (!vista.hasAttribute("data-rolando")) vista.setAttribute("data-rolando", "");
      if (parado) clearTimeout(parado);
      parado = setTimeout(() => vista.removeAttribute("data-rolando"), 220);
    };
    // O foco do teclado entrou no índice antes da troca: rola até p = 1 (o mesmo ponto em que a faixa
    // real assume), para o foco aparecer onde ele está.
    m.irAoIndice.current = () => {
      if (ultimoP >= FAIXAS.troca || ultimo.alcance <= 0) return;
      const alvo = ultimo.rolado + ultimo.distancia - ultimo.antes + ultimo.alcance + 1;
      rolarPara(rolador, Math.max(0, alvo), true);
    };
    const redimensionar = () => {
      quadro = 0;
      medir();
      desenhar();
    };

    medir();
    desenhar();
    rolador.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", redimensionar);
    let observador: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      observador = new ResizeObserver(() => {
        if (quadro) cancelAnimationFrame(quadro);
        quadro = requestAnimationFrame(redimensionar);
      });
      observador.observe(el);
    }
    return () => {
      rolador.removeEventListener("scroll", pedir);
      window.removeEventListener("resize", redimensionar);
      observador?.disconnect();
      if (quadro) cancelAnimationFrame(quadro);
      if (parado) clearTimeout(parado);
      if (primeiroCap) {
        primeiroCap.style.opacity = "";
        primeiroCap.style.transform = "";
      }
      if (m.detalhe.current) m.detalhe.current.style.transform = "";
      m.irAoIndice.current = null;
      vista.removeAttribute("data-movendo");
      vista.removeAttribute("data-rolando");
    };
    // As refs são estáveis; o motor recomeça quando o modo ou o papel mudam (o papel muda as linhas).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.ativo, m.admin]);
}

/* ---------- o palco ---------- */

export function Palco({
  modo,
  painel,
  carregando,
  colunas,
  itensIndice,
  ativo,
  aoIr,
  aoFase,
  aoCapitulo,
  resultado,
  entra,
  fase,
  reduzido,
  children,
}: {
  modo: ModoPalco;
  painel: PainelDashboard;
  carregando: boolean;
  colunas: ColunaFunil[];
  itensIndice: ItemIndice[];
  ativo: string | null;
  aoIr: (etapa: string) => void;
  aoFase: (fase: FaseB) => void;
  aoCapitulo: (etapa: string | null) => void;
  resultado: RefObject<HTMLElement | null>;
  /** A entrada da 1ª vez da aba (o cartão aparece com os outros). */
  entra: boolean;
  /** A fase da jornada (o funil do palco solta o foco das colunas quando vira índice). */
  fase: FaseB;
  reduzido: boolean;
  /** Os capítulos. */
  children: ReactNode;
}) {
  const palco = useRef<HTMLElement>(null);
  const vista = useRef<HTMLDivElement>(null);
  const trilho = useRef<HTMLDivElement>(null);
  const detalhe = useRef<HTMLDivElement>(null);
  const irAoIndice = useRef<(() => void) | null>(null);
  const nav = useRef<HTMLElement>(null);
  const admin = painel.papel === "admin";
  const noPalco = modo === "palco";
  const vazio = painel.vazio || painel.funil.leadsNovos === 0;

  useMotorDoPalco({
    ativo: noPalco,
    admin,
    palco,
    vista,
    trilho,
    detalhe,
    nav,
    resultado,
    aoFase,
    aoCapitulo,
    irAoIndice,
  });

  const props = { painel, colunas, carregando, idTitulo: "dvb-funil-titulo", aoIr };
  // No período vazio não há capítulos: sem índice (o bloco "escolha outro período" fica no lugar deles).
  const indice = vazio ? null : (
    <Indice
      itens={itensIndice}
      ativo={ativo}
      modo={modo}
      carregando={carregando}
      reduzido={reduzido}
      estadoJanete={painel.estadoJanete}
      aoIr={aoIr}
      aoFocar={noPalco ? () => irAoIndice.current?.() : undefined}
      refNav={nav}
    />
  );
  const entrada = entra ? { "data-entra-funil": "", style: { "--dvb-ordem": 8 } as CSSProperties } : {};

  if (noPalco) {
    return (
      <section ref={palco} data-dash="palco" data-modo="palco" className={s.dvbPalco} aria-labelledby="dvb-funil-titulo">
        <div ref={vista} className={s.dvbVista}>
          <div className={s.dvbFaixaFundo} aria-hidden="true" />
          <div className={s.dvbVeu} aria-hidden="true" />
          <div data-dash="funil" className={s.dvbCartaoFunil} aria-busy={carregando || undefined} {...entrada}>
            <div className={s.dvbSombraA} aria-hidden="true" />
            <div className={s.dvbSombraB} aria-hidden="true" />
            <div className={s.dvbSombraC} aria-hidden="true" />
            <div className={s.dvbMoldura} aria-hidden="true" />
            <div className={s.dvbConteudo}>
              <FunilPalco {...props} fase={fase} />
              <TabelaDoFunil funil={painel.funil} vazio={vazio} carregando={carregando} />
            </div>
            <div className={s.dvbIndiceCaixa}>{indice}</div>
          </div>
        </div>
        <div ref={trilho} className={s.dvbTrilho} aria-hidden="true" />
        <div ref={detalhe} className={s.dvbDetalhe} data-modo="palco">
          {children}
        </div>
      </section>
    );
  }

  return (
    <section ref={palco} data-dash="palco" data-modo={modo} className={s.dvbPalco} aria-labelledby="dvb-funil-titulo">
      <div data-dash="funil" className={s.dvbCartaoFluxo} data-modo={modo} aria-busy={carregando || undefined} {...entrada}>
        {modo === "celular" ? <FunilLinhas {...props} /> : <FunilAberto {...props} />}
        <TabelaDoFunil funil={painel.funil} vazio={vazio} carregando={carregando} />
      </div>
      {indice}
      <div ref={detalhe} className={s.dvbDetalhe} data-modo={modo}>
        {children}
      </div>
    </section>
  );
}
