import { ChevronRight, CircleCheck, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";

import { movimentoReduzido } from "@/components/janete/VooJanete";
import { Aviso, Botao } from "@/components/aipro";
import { cx } from "@/components/aipro/cx";

import { idTituloArea, VistaArea } from "../AreaVazia";
import { Carregando, ErroLeitura } from "../dados/estados";
import { useClienteDados } from "../dados/ProvedorDados";
import { useTelaEstreita } from "../exemplo";
import { usePapel } from "../papel";
import { Ensinar } from "./Ensinar";
import { FaixaVersaoAntiga, Historico } from "./Historico";
import { lerContexto, useContexto } from "./loja";
import { Mapa } from "./Mapa";
import { Disco } from "./Pilha";
import { PonteContextoBanco } from "./ponte";
import { avisoCamposFracos, camposFracos, contagem, numeroDoItem, semVersao, versaoAtual, versaoNaTela } from "./regras";
import { primeiroAlvo, Secao } from "./Secao";
import { s } from "./tela-estilos";
import { CAMPOS, ehChaveCampo, GRUPOS, infoCampo, type Alvo, type GrupoId } from "./tipos";
import { deslocamentoDaVista, TEMPOS_ENTRADA_CURTA, useEntradaESaida, type FaseEntrada } from "./voo";

// A tela do Contexto (docs/spec-contexto.md, task C4; o .ctx-vista do Contexto 6): junta o cabeçalho
// (os números, "+ Ensinar algo novo" e a legenda), a faixa da versão antiga, o palco (o Mapa ou a
// Secao) e o rodapé com o histórico. Quem decide o que está aberto é esta tela: a seção (área, item e
// de onde veio), o balão de ensinar, a gaveta do histórico e a passagem animada entre o mapa e a seção.
//
// A passagem (uns 400 ms): ao abrir, mede as faces dos 3 discos da pilha, monta a seção por cima do
// mapa com os discos dela escondidos, mede onde eles vão parar (#ctx-sd-face-<grupo>) e solta 3
// cópias (Disco) de um lugar para o outro; a lista e o editor entram depois que elas pousam. Voltar
// (e Esc) faz o contrário, e o mapa remonta com a entrada curta (as curvas se desenham de novo).
// Trocar de área pelos discos pequenos é uma troca curta. Sem medidas (testes) ou com movimento
// reduzido, não há passagem: troca na hora.

/** O voo das cópias entre o mapa e a seção (a lista e o editor entram aos 260 ms). */
const T_PASSA = 300;
/** A troca curta entre os discos da seção. */
const T_TROCA = 320;
/** Depois da volta, o tempo das curvas se desenhando até o mapa ficar pronto. */
const T_LIGA = TEMPOS_ENTRADA_CURTA.pronto;
/** O vão entre o palco e o rodapé, e o do rodapé até o pé da janela (os do protótipo). */
const VAO_RODAPE = 12;
const VAO_FIM = 16;

const usarLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Medida = { cx: number; cy: number; w: number };
type Medidas = Record<GrupoId, Medida>;

interface Copia {
  g: GrupoId;
  /** O maior dos 2 diâmetros: a cópia nasce nele e só encolhe (escala até 1). */
  D: number;
  x0: number;
  y0: number;
  s0: number;
  x1: number;
  y1: number;
  s1: number;
  atraso: number;
  /** Na ida, os 2 discos que não foram clicados (encolhem logo no começo). */
  outro: boolean;
}

interface Passagem {
  n: number;
  rumo: "secao" | "mapa" | "troca";
  /** "mede": esperando o destino existir na tela; "voa": as cópias andando. */
  fase: "mede" | "voa";
  de: Medidas;
  /** O disco da área aberta: anda por cima dos outros 2. */
  primeiro: GrupoId;
  copias: Copia[];
  dur: number;
}

interface SecaoAberta {
  grupo: GrupoId;
  alvo: Alvo;
  /** Entrou por uma linha ou cartão (no celular, o editor abre direto). */
  editor: boolean;
  /** O id que recebe o foco ao voltar para o mapa. */
  origem: string;
  saindo: boolean;
  /** "voo": a lista e o editor esperam as cópias pousarem. */
  entrada: "fade" | "voo";
}

function ehGrupo(x: string): x is GrupoId {
  return x === "oferta" || x === "conversa" || x === "livres";
}

function grupoDoAlvo(alvo: Alvo): GrupoId {
  return ehChaveCampo(alvo) ? infoCampo(alvo).grupo : "livres";
}

/** O botão do mapa que abre aquele item (o foco volta para ele). */
function origemDoAlvo(alvo: Alvo): string {
  if (ehChaveCampo(alvo)) return `ctx-l-${alvo}`;
  const n = numeroDoItem(alvo);
  return n === null ? "ctx-card-novo" : `ctx-card-${n}`;
}

function nomeDoAlvo(alvo: Alvo): string {
  if (ehChaveCampo(alvo)) return infoCampo(alvo).rotulo;
  const n = numeroDoItem(alvo);
  return n === null ? "Novo item livre" : `a pergunta livre ${n}`;
}

const podeAnimar = () => !movimentoReduzido();

/** A face de cada disco: na pilha do mapa (a 1ª span da camada) ou na seção (#ctx-sd-face-<g>). */
function medirDiscos(onde: "mapa" | "secao"): Medidas | null {
  if (typeof document === "undefined") return null;
  const m = {} as Medidas;
  for (const g of GRUPOS) {
    const el =
      onde === "mapa"
        ? document.querySelector(`#ctx-pilha [data-disco="${g.id}"] > span`)
        : document.getElementById(`ctx-sd-face-${g.id}`);
    const r = el?.getBoundingClientRect();
    if (!r || !r.width) return null;
    // na perspectiva, a metade da frente da face é um pouco maior: o centro da caixa fica 0,006 d abaixo
    m[g.id] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 - r.width * 0.006, w: r.width };
  }
  return m;
}

/** Põe o foco num elemento (ou no título da área, se ele não existir). Com mouse, sem anel. */
function focarId(id: string, semAnel: boolean): void {
  const el = document.getElementById(id) ?? document.getElementById(idTituloArea("contexto"));
  if (!el) return;
  if (semAnel) {
    el.setAttribute("data-sem-anel", "");
    el.addEventListener("blur", () => el.removeAttribute("data-sem-anel"), { once: true });
  }
  el.focus({ preventScroll: true });
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * A rota /app/contexto. No modo banco (há cliente do Firebase na camada de dados), a ponte põe as
 * versões do banco; sem ele (testes e modo exemplo), a loja usa as da memória.
 */
export function TelaContexto() {
  const cliente = useClienteDados();
  return cliente ? (
    <PonteContextoBanco>
      <TelaComEstados />
    </PonteContextoBanco>
  ) : (
    <TelaComEstados />
  );
}

/** Os 3 estados: carregando (o esqueleto dos discos), erro com "Tentar de novo", e a tela (vazia ou não). */
function TelaComEstados() {
  const { leitura } = useContexto();
  if (leitura.carregando) {
    return (
      <VistaArea area="contexto">
        <Carregando forma="cartao" quantos={3} rotulo="Carregando o Contexto" />
      </VistaArea>
    );
  }
  // A tela de erro só enquanto os dados não chegaram. Uma releitura que falha em segundo plano (o
  // React Query guarda o erro junto com os dados antigos) vira um aviso compacto, e a seção aberta,
  // o rascunho e o foco ficam onde estavam: a TelaPronta não desmonta (fica na mesma posição).
  if (leitura.erro && !leitura.pronta) {
    return (
      <VistaArea area="contexto">
        <ErroLeitura erro={leitura.erro} tentarDeNovo={leitura.tentarDeNovo} titulo="Não deu para carregar o Contexto" />
      </VistaArea>
    );
  }
  return (
    <>
      {leitura.erro ? (
        <div style={{ marginBottom: 16 }} data-aviso-releitura="">
          <Aviso
            tom="atencao"
            compacto
            acao={
              <Botao variante="contorno" tamanho="compacto" onClick={leitura.tentarDeNovo}>
                Tentar de novo
              </Botao>
            }
          >
            {AVISO_RELEITURA_CONTEXTO}
          </Aviso>
        </div>
      ) : null}
      <TelaPronta />
    </>
  );
}

/** O aviso compacto da releitura que falhou com a tela já pronta. */
export const AVISO_RELEITURA_CONTEXTO = "Não deu para atualizar o Contexto. O que está na tela pode estar desatualizado.";

function TelaPronta() {
  const { estado, acoes, leitura } = useContexto();
  const { papel } = usePapel();
  const estreita = useTelaEstreita();
  const admin = papel === "admin";
  const vendo = estado.vendo !== null;
  const podeEditar = admin && !vendo;
  const versao = versaoNaTela(estado);
  const nums = contagem(versao);
  const nenhuma = semVersao(estado);
  // o aviso de campo fraco olha a versão salva atual (não a antiga na tela nem o rascunho). Com a
  // releitura falhando, a tela segue com os dados velhos, mas o aviso some (undefined: não se sabe).
  const fraco = avisoCamposFracos(camposFracos(leitura.erro ? undefined : nenhuma ? null : versaoAtual(estado)));

  /* ---- timers: todos saem ao desmontar ---- */
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const depois = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);
  useEffect(() => {
    const lista = timers.current;
    return () => {
      lista.forEach(clearTimeout);
      lista.clear();
    };
  }, []);

  /* ---- a entrada (voo.ts): completa na 1ª visita da sessão, curta nas outras ---- */
  const [primeiraVez] = useState(() => !lerContexto().jaEntrou);
  // o alvo do voo: a pilha no mapa ou, com a seção aberta, o disco grande dela (a saída parte dele)
  const alvoVoo = useRef<HTMLElement | null>(null);
  const { fase } = useEntradaESaida({ alvo: alvoVoo, primeiraVez });
  useEffect(() => {
    if (fase === "pronto") acoes.marcarEntrada();
  }, [fase, acoes]);
  const refPilha = useCallback((el: HTMLDivElement | null) => {
    if (el) alvoVoo.current = el;
  }, []);

  // depois da 1ª ida à seção, o mapa segue esta fase (a volta curta), e não mais a da entrada
  const [faseVolta, setFaseVolta] = useState<FaseEntrada | null>(null);
  const faseMapa = faseVolta ?? fase;
  const geracaoVolta = useRef(0);
  /** A volta sem passagem: a pilha remonta já separada e as curvas se desenham, curto. */
  const remontarMapa = () => {
    geracaoVolta.current += 1;
    const g = geracaoVolta.current;
    if (!podeAnimar()) {
      setFaseVolta("pronto");
      return;
    }
    setFaseVolta("separada");
    depois(() => {
      if (geracaoVolta.current === g) setFaseVolta("ligando");
    }, TEMPOS_ENTRADA_CURTA.ligando);
    depois(() => {
      if (geracaoVolta.current === g) setFaseVolta("pronto");
    }, T_LIGA);
  };

  /* ---- teclado ou mouse: o foco devolvido só desenha anel com teclado ---- */
  const teclado = useRef(false);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key === "Enter" || e.key === " " || e.key === "Escape" || e.key.startsWith("Arrow")) teclado.current = true;
    };
    const ponteiro = () => {
      teclado.current = false;
    };
    document.addEventListener("keydown", tecla, true);
    document.addEventListener("pointerdown", ponteiro, true);
    document.addEventListener("mousedown", ponteiro, true);
    return () => {
      document.removeEventListener("keydown", tecla, true);
      document.removeEventListener("pointerdown", ponteiro, true);
      document.removeEventListener("mousedown", ponteiro, true);
    };
  }, []);

  /* ---- o que está aberto ---- */
  const [secao, setSecao] = useState<SecaoAberta | null>(null);
  const [passagem, setPassagem] = useState<Passagem | null>(null);
  const [ensinar, setEnsinar] = useState<{ origem: string } | null>(null);
  const [hist, setHist] = useState(false);
  const [raio, setRaio] = useState<{ alvo: Alvo; n: number } | null>(null);
  const [toast, setToast] = useState<{ id: number; texto: string } | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const seq = useRef(0);
  // o raio corre uma vez só: some depois da animação (e ao abrir a seção), para não correr de novo
  // quando o mapa remonta na volta ou as curvas reaparecem
  const raioSeq = useRef(0);
  const descobrir = (alvo: Alvo) => {
    const n = ++raioSeq.current;
    setRaio({ alvo, n });
    depois(() => setRaio((x) => (x?.n === n ? null : x)), 1100);
  };

  // vendo uma versão antiga (ou como atendente), o balão de ensinar fecha
  const [vendoAnt, setVendoAnt] = useState(estado.vendo);
  if (vendoAnt !== estado.vendo) {
    setVendoAnt(estado.vendo);
    if (estado.vendo !== null) setEnsinar(null);
  }
  const ensinarAberto = !!ensinar && podeEditar;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // com a seção aberta, a saída parte do disco grande dela
  useEffect(() => {
    if (!secao || secao.saindo) return;
    const face = document.getElementById(`ctx-sd-face-${secao.grupo}`);
    if (face) alvoVoo.current = face;
  }, [secao]);

  /* ---- a passagem ---- */
  const novaPassagem = (rumo: Passagem["rumo"], de: Medidas, primeiro: GrupoId): Passagem => {
    seq.current += 1;
    return { n: seq.current, rumo, fase: "mede", de, primeiro, copias: [], dur: 0 };
  };

  const passagemRef = useRef<Passagem | null>(null);
  usarLayout(() => {
    passagemRef.current = passagem;
  });

  const terminarPassagem = useCallback(
    (p: Passagem) => {
      if (passagemRef.current?.n !== p.n) return;
      passagemRef.current = null;
      setPassagem(null);
      if (p.rumo === "mapa") {
        // de volta ao mapa: a pilha já está montada; as curvas se desenham de novo, curto
        setSecao(null);
        geracaoVolta.current += 1;
        const g = geracaoVolta.current;
        if (!podeAnimar()) {
          setFaseVolta("pronto");
          return;
        }
        setFaseVolta("ligando");
        depois(() => {
          if (geracaoVolta.current === g) setFaseVolta("pronto");
        }, T_LIGA);
      }
    },
    [depois],
  );

  useEffect(() => {
    if (!passagem || passagem.fase !== "mede") return;
    const n = passagem.n;
    const partir = () => {
      const p = passagemRef.current;
      if (!p || p.n !== n || p.fase !== "mede") return;
      const para = medirDiscos(p.rumo === "mapa" ? "mapa" : "secao");
      if (!para) {
        terminarPassagem(p);
        return;
      }
      const dur = p.rumo === "troca" ? T_TROCA : T_PASSA;
      // o disco da área anda por último no DOM: por cima dos outros 2
      const ordem = [...GRUPOS.map((g) => g.id).filter((g) => g !== p.primeiro), p.primeiro];
      const copias = ordem.map((g, i): Copia => {
        const a = p.de[g];
        const b = para[g];
        const D = Math.max(a.w, b.w, 1);
        const outro = p.rumo === "secao" && g !== p.primeiro;
        return { g, D, x0: a.cx, y0: a.cy, s0: a.w / D, x1: b.cx, y1: b.cy, s1: b.w / D, atraso: outro ? i * 15 : 0, outro };
      });
      const voa: Passagem = { ...p, fase: "voa", copias, dur };
      passagemRef.current = voa;
      // as cópias entram no mesmo quadro (antes da pintura): os discos de verdade já estão escondidos
      flushSync(() => setPassagem(voa));
      depois(() => terminarPassagem(voa), dur + 50);
    };
    // espera um quadro: o destino (a seção, ou o mapa de volta) já está na tela com o tamanho certo
    if (typeof requestAnimationFrame === "function") {
      const q = requestAnimationFrame(partir);
      return () => cancelAnimationFrame(q);
    }
    const t = setTimeout(partir, 16);
    return () => clearTimeout(t);
  }, [passagem, depois, terminarPassagem]);

  /* ---- abrir a seção: disco ou título (o 1º item), linha ou cartão (aquele item) ---- */
  const abrir = (x: Alvo | GrupoId, origemPedida?: string) => {
    if (secao?.saindo) return;
    const tec = teclado.current;
    const pelaArea = ehGrupo(x);
    const grupo = pelaArea ? x : grupoDoAlvo(x);
    const alvo = pelaArea ? primeiroAlvo(grupo) : x;
    const ativo = typeof document !== "undefined" ? document.activeElement : null;
    const origem =
      origemPedida ??
      (ativo instanceof HTMLElement && /^ctx-(disco|gb|l|card)-/.test(ativo.id)
        ? ativo.id
        : pelaArea
          ? `ctx-gb-${grupo}`
          : origemDoAlvo(alvo));
    setEnsinar(null);
    setRaio(null);
    setHist(false);
    const nomeG = GRUPOS.find((g) => g.id === grupo)?.nome ?? "";
    setAnuncio(`Seção ${nomeG}${pelaArea ? "" : `, com ${nomeDoAlvo(alvo)} no editor`}. Esc volta para o mapa.`);

    if (secao) {
      setSecao({ ...secao, grupo, alvo, editor: !pelaArea });
      return;
    }

    let p: Passagem | null = null;
    const pronto = faseMapa === "ligando" || faseMapa === "pronto";
    if (podeAnimar() && !estreita && pronto) {
      const de = medirDiscos("mapa");
      if (de) p = novaPassagem("secao", de, grupo);
    }
    passagemRef.current = p;
    setPassagem(p);
    setSecao({ grupo, alvo, editor: !pelaArea, origem, saindo: false, entrada: p ? "voo" : "fade" });
    if (p) {
      // depois que a lista e o editor entraram, a seção volta ao normal (trocar de item não espera mais)
      depois(() => setSecao((sc) => (sc && sc.entrada === "voo" ? { ...sc, entrada: "fade" } : sc)), 600);
    }

    // com teclado, o foco vai para o item aberto; com mouse, para o título (que não desenha anel)
    const foco = !pelaArea ? "ctx-ed-tit" : estreita || !tec ? "ctx-sec-tit" : `ctx-it-${alvo}`;
    depois(() => focarId(document.getElementById(foco) ? foco : "ctx-sec-tit", !tec), p ? T_PASSA : 90);
  };

  /* ---- voltar ao mapa (Voltar, Esc, e o "Ensinar" com a seção aberta) ---- */
  const voltar = (opcoes: { semFoco?: boolean; semVoo?: boolean } = {}) => {
    if (!secao || secao.saindo) return;
    const tec = teclado.current;
    const volta = secao.origem;
    setAnuncio("De volta ao mapa do conhecimento.");
    if (podeAnimar() && !opcoes.semVoo && !estreita) {
      const de = medirDiscos("secao");
      if (de) {
        const p = novaPassagem("mapa", de, secao.grupo);
        passagemRef.current = p;
        geracaoVolta.current += 1;
        setFaseVolta("separada");
        setPassagem(p);
        setSecao({ ...secao, saindo: true });
        if (!opcoes.semFoco) depois(() => focarId(volta, !tec), T_PASSA + 80);
        return;
      }
    }
    passagemRef.current = null;
    setPassagem(null);
    setSecao(null);
    remontarMapa();
    if (!opcoes.semFoco) depois(() => focarId(volta, !tec), 80);
  };

  const trocarGrupo = (g: GrupoId) => {
    if (!secao || secao.saindo) return;
    const de = podeAnimar() && !estreita ? medirDiscos("secao") : null;
    const p = de ? novaPassagem("troca", de, g) : null;
    passagemRef.current = p;
    setPassagem(p);
    setSecao({ ...secao, grupo: g, alvo: primeiroAlvo(g), editor: false, origem: `ctx-gb-${g}` });
    setAnuncio(`Seção ${GRUPOS.find((x) => x.id === g)?.nome ?? ""}.`);
  };

  /* ---- Esc com o foco fora (no corpo da página): fecha a gaveta ou o balão, ou volta ao mapa ---- */
  const esc = useRef<(e: KeyboardEvent) => void>(() => {});
  usarLayout(() => {
    esc.current = (e) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (hist) {
        e.preventDefault();
        setHist(false);
        focarId("ctx-historico-btn", !teclado.current);
        return;
      }
      if (ensinarAberto) {
        e.preventDefault();
        setEnsinar(null);
        if (ensinar?.origem) focarId(ensinar.origem, !teclado.current);
        return;
      }
      if (!secao || secao.saindo) return;
      e.preventDefault();
      voltar();
    };
  });
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) esc.current(e);
    };
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, []);

  /* ---- "+ Ensinar algo novo": a peça e o botão do cabeçalho abrem o mesmo balão ---- */
  const alternarEnsinar = (origem: string) => {
    if (ensinar) {
      setEnsinar(null);
      return;
    }
    if (!podeEditar) return;
    setHist(false);
    // com a seção aberta, volta ao mapa (sem passagem) e abre o balão sobre a peça
    if (secao) voltar({ semFoco: true, semVoo: true });
    setEnsinar({ origem });
    setAnuncio("Ensinar algo novo: escreva e a Janete descobre o campo.");
  };

  const alternarHistorico = () => {
    if (hist) {
      setHist(false);
      return;
    }
    setEnsinar(null);
    setHist(true);
  };

  const aoRestaurar = (v: number, de: number) => {
    const texto = `Versão ${v} salva, igual à versão ${de}.`;
    setToast((x) => ({ id: (x?.id ?? 0) + 1, texto }));
    // o aviso visual nasce com o texto: quem fala é a região viva que já existe
    setAnuncio(texto);
  };

  /* ---- a altura do palco: o que sobra até o pé da janela (só no computador) ---- */
  const palcoRef = useRef<HTMLDivElement | null>(null);
  const rodapeRef = useRef<HTMLElement | null>(null);
  const cabDirRef = useRef<HTMLDivElement | null>(null);
  const [alturaPalco, setAlturaPalco] = useState<number | null>(null);
  const medirAltura = useCallback(() => {
    const palco = palcoRef.current;
    if (!palco || estreita) {
      setAlturaPalco(null);
      return;
    }
    const rolo = palco.closest("main");
    const r = palco.getBoundingClientRect();
    const topoRolo = rolo ? rolo.getBoundingClientRect().top : 0;
    const visivel = rolo ? rolo.clientHeight : window.innerHeight;
    // na entrada, a vista ainda tem uns 8 px de translate: mede onde o palco vai ficar
    const dy = deslocamentoDaVista(palco);
    const topo = r.top - dy - topoRolo + (rolo ? rolo.scrollTop : 0);
    const rodape = rodapeRef.current?.offsetHeight ?? 0;
    const h = Math.floor(visivel - topo - rodape - VAO_RODAPE - VAO_FIM);
    setAlturaPalco((x) => {
      const novo = h > 0 && visivel > 0 ? h : null;
      return x === novo ? x : novo;
    });
  }, [estreita]);

  usarLayout(() => {
    medirAltura();
    window.addEventListener("resize", medirAltura);
    // refaz quando o que fica acima ou abaixo do palco muda de altura (o título quebra, as fontes chegam)
    let ro: ResizeObserver | null = null;
    const palco = palcoRef.current;
    if (palco && typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => medirAltura());
      const sec = palco.closest('section[data-area="contexto"]');
      const observar = [sec?.firstElementChild, cabDirRef.current, rodapeRef.current];
      for (const el of observar) if (el) ro.observe(el);
    }
    let vivo = true;
    void (typeof document !== "undefined" ? document.fonts?.ready : undefined)?.then(() => {
      if (vivo) medirAltura();
    });
    return () => {
      vivo = false;
      window.removeEventListener("resize", medirAltura);
      ro?.disconnect();
    };
  }, [medirAltura, vendo]);

  /* ---- o que vai na tela ---- */
  const mapaVisivel = !secao || secao.saindo || passagem?.rumo === "secao";
  const balao = ensinarAberto ? (
    <Ensinar
      aberto
      aoFechar={() => setEnsinar(null)}
      aoDescobrir={descobrir}
      aoAbrirAlvo={(alvo) => abrir(alvo, origemDoAlvo(alvo))}
      ponta={!estreita}
      devolverFocoPara={ensinar?.origem}
    />
  ) : null;

  const discosEscondidos = !!passagem && (passagem.fase === "voa" || passagem.rumo !== "mapa");
  const estiloPalco = alturaPalco ? ({ "--palco-h": `${alturaPalco}px` } as CSSProperties) : undefined;

  return (
    <VistaArea area="contexto">
      <div className={s.tela} data-estreita={estreita ? "" : undefined}>
        <div ref={cabDirRef} className={s.cabDir}>
          <div className={s.nums}>
            <p className={s.num}>
              <b>{nums.campos}</b> de {CAMPOS.length} campos
            </p>
            <p className={s.num}>
              <b>{nums.itens}</b> {nums.itens === 1 ? "item livre" : "itens livres"}
            </p>
          </div>
          {podeEditar ? (
            <button
              type="button"
              id="ctx-ensinar-btn"
              data-acao="ensinar"
              className={s.btnEns}
              aria-expanded={ensinarAberto}
              aria-controls={ensinarAberto ? "ctx-ens" : undefined}
              onClick={() => alternarEnsinar("ctx-ensinar-btn")}
            >
              <Plus className={s.btnEnsIc} strokeWidth={1.75} aria-hidden="true" />
              <span>Ensinar algo novo</span>
            </button>
          ) : null}
          {fraco ? (
            <p className={s.fraco} data-aviso-fraco="">
              {fraco}
            </p>
          ) : null}
          <div className={s.legenda} aria-hidden="true">
            <span className={s.leg}>
              <svg className={s.legTr} viewBox="0 0 26 8">
                <path className={s.tOn} d="M2 4H24" />
              </svg>
              A Janete sabe
            </span>
            <span className={s.leg}>
              <svg className={s.legTr} viewBox="0 0 26 8">
                <path className={s.tOff} d="M2 4H24" />
              </svg>
              Ainda vazio
            </span>
            {podeEditar ? (
              <span className={s.leg}>
                <svg className={s.legTr} viewBox="0 0 26 8">
                  <path className={s.tRasc} d="M2 4H24" />
                </svg>
                Não salvo
              </span>
            ) : null}
          </div>
        </div>

        <FaixaVersaoAntiga className={s.faixa} aoRestaurar={aoRestaurar} />

        <div ref={palcoRef} id="ctx-palco" className={s.palco} style={estiloPalco}>
          {mapaVisivel ? (
            <Mapa
              fase={faseMapa}
              pilhaRef={refPilha}
              aoAbrir={(x) => abrir(x)}
              aoAbrirEnsinar={() => alternarEnsinar("ctx-peca-btn")}
              ensinarAberto={ensinarAberto}
              raio={raio}
              estreita={estreita}
              balao={balao}
              className={cx(
                passagem?.rumo === "secao" && s.mapaSai,
                passagem?.rumo === "mapa" && s.mapaChega,
                passagem?.rumo === "mapa" && passagem.fase === "mede" && s.mapaOculto,
              )}
            />
          ) : null}
          {secao ? (
            <div
              className={cx(
                s.palcoSecao,
                secao.entrada === "voo" && !secao.saindo && s.secaoVoo,
                discosEscondidos && s.secaoVoando,
                secao.saindo && s.secaoSai,
              )}
            >
              <Secao
                grupo={secao.grupo}
                alvo={secao.alvo}
                aoEscolher={(alvo) => setSecao((sc) => (sc ? { ...sc, alvo } : sc))}
                aoTrocarGrupo={trocarGrupo}
                aoVoltar={() => voltar()}
                estreita={estreita}
                editorAberto={estreita && secao.editor}
                focarAoAbrir={false}
              />
            </div>
          ) : null}
        </div>

        <footer ref={rodapeRef} className={s.rodape}>
          {nenhuma ? (
            <p className={s.rodEsq} data-vazio="">
              <b>Nenhuma versão ainda</b>
              <span className={s.rodDiv} aria-hidden="true" />
              <span>{admin ? "O 1º salvamento cria a versão 1." : "Quando o admin salvar, a versão 1 aparece aqui."}</span>
            </p>
          ) : (
            <p className={s.rodEsq}>
              <b>Versão {versao.numero}</b>
              <span className={s.pilula} data-antiga={vendo ? "" : undefined}>
                {vendo ? "Antiga · só leitura" : "Em uso"}
              </span>
              <span className={s.rodDiv} aria-hidden="true" />
              <span>Cada alteração salva cria uma nova versão.</span>
            </p>
          )}
          <button
            type="button"
            id="ctx-historico-btn"
            data-acao="historico"
            className={s.rodHist}
            aria-expanded={hist}
            aria-controls={hist ? "ctx-gaveta" : undefined}
            onClick={alternarHistorico}
          >
            <span>Ver histórico</span>
            <ChevronRight className={s.rodHistIc} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </footer>

        <Historico aberto={hist} aoFechar={() => setHist(false)} aoRestaurar={aoRestaurar} />

        {toast ? (
          <p key={toast.id} className={s.toast} aria-hidden="true">
            <CircleCheck className={s.toastIc} strokeWidth={2} aria-hidden="true" />
            <span>{toast.texto}</span>
          </p>
        ) : null}

        <p className={s.sr} aria-live="polite">
          {anuncio}
        </p>
      </div>

      {/* a passagem: as cópias dos 3 discos, por cima de tudo, de onde estavam até onde vão */}
      {passagem?.fase === "voa" && typeof document !== "undefined"
        ? createPortal(
            <div data-identidade="aipro" aria-hidden="true">
              {passagem.copias.map((c) => (
                <span
                  key={c.g}
                  className={s.v3}
                  data-copia={c.g}
                  data-outro={c.outro ? "" : undefined}
                  style={
                    {
                      "--x0": px(c.x0),
                      "--y0": px(c.y0),
                      "--s0": String(Math.round(c.s0 * 10000) / 10000),
                      "--x1": px(c.x1),
                      "--y1": px(c.y1),
                      "--s1": String(Math.round(c.s1 * 10000) / 10000),
                      "--vt": `${passagem.dur}ms`,
                      "--vd": `${c.atraso}ms`,
                    } as CSSProperties
                  }
                >
                  <span className={s.v3Disco} style={{ "--dv": px(c.D) } as CSSProperties}>
                    <Disco grupo={c.g} d={c.D} dormindo={vendo} />
                  </span>
                </span>
              ))}
            </div>,
            document.body,
          )
        : null}
    </VistaArea>
  );
}
