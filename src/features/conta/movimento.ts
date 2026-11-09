/**
 * As contas e o laço da Janete gigante do login (proposta A, "Presença"), sem React: o lado do disco,
 * os recortes do cartão e a leve inclinação com o tremor. Porta do protótipo
 * `docs/mockups/conta/Login-A-Presenca.dc.html` (linhas 452–583 e 798–820), com as mesmas constantes.
 */

/** O disco nunca fica menor que a diagonal do cartão mais esta folga (48 px de cada lado). */
export const FOLGA_DISCO = 96;

/** O cartão aberto: o mesmo raio do cartão (o canto de baixo à esquerda é o reto do balão). */
export const CLIP_CHEIO = "inset(0px 0px 0px 0px round 28px 28px 28px 0px)";

/** Abaixo disto é celular: a bola passa da largura e sai pelas bordas. */
const LARGURA_CELULAR = 600;

/** A janela de referência do lado do disco (no celular, a altura só cresce enquanto a largura não muda). */
export interface RefsDisco {
  larguraRef: number;
  alturaRef: number;
}

/**
 * O lado do disco: 86% da altura (92% no celular), mas nunca menor que a diagonal do cartão mais a
 * folga, para o cartão ficar sempre inteiro dentro dele; se precisar, o disco passa da janela por
 * cima e por baixo. No celular, a altura de referência só cresce enquanto a largura não muda: o
 * teclado aberto não encolhe o disco. Devolve as refs novas junto, para a próxima medida.
 */
export function ladoDoDisco(
  janela: { largura: number; altura: number },
  cartao: { largura: number; altura: number },
  antes: RefsDisco,
): RefsDisco & { lado: number } {
  const w = janela.largura;
  const h = janela.altura;
  const cel = w < LARGURA_CELULAR;
  const mesmaLargura = w === antes.larguraRef;
  const larguraRef = w;
  const alturaRef = mesmaLargura && cel ? Math.max(antes.alturaRef, h) : h;
  const base = cel ? Math.min(0.92 * alturaRef, 2 * w) : Math.min(0.86 * alturaRef, 960, 1.5 * w);
  const minimo = Math.hypot(cartao.largura, cartao.altura) + FOLGA_DISCO;
  const teto = cel ? 2 * w : 1.5 * w;
  return { larguraRef, alturaRef, lado: Math.round(Math.min(Math.max(base, minimo), teto)) };
}

/** Um recorte com a forma do ponto de fala (três cantos redondos e o de baixo à esquerda reto). */
export function insetPonto(t: number, r: number, b: number, l: number, lado: number): string {
  const h = (lado / 2).toFixed(1);
  const px = (v: number) => `${Math.max(0, v).toFixed(1)}px`;
  return `inset(${px(t)} ${px(r)} ${px(b)} ${px(l)} round ${h}px ${h}px ${h}px 0px)`;
}

/** Um ponto de lado `lado`, no centro do cartão (onde fica o centro do disco). */
export function clipCentro(cartao: { width: number; height: number }, lado: number): string {
  const t = (cartao.height - lado) / 2;
  const l = (cartao.width - lado) / 2;
  return insetPonto(t, l, t, l, lado);
}

export interface MovimentoJanete {
  /** O cursor, normalizado de -1 a 1 a partir do centro da janela. */
  olhar(nx: number, ny: number): void;
  recentrar(): void;
  /** A senha errada: ela estremece no sono (mola de 6 px, ~0,5 s). */
  tremer(): void;
  /** A passagem: tudo volta ao centro, rápido, para a contração sair exata. */
  acalmar(): void;
  deslocamento(): { x: number; y: number };
  repor(): void;
  pintar(): void;
  pausar(): void;
  retomar(): void;
}

type Canal = "ox" | "oy" | "rx" | "ry";
type Canais = Record<Canal, number>;

const CANAIS: readonly Canal[] = ["ox", "oy", "rx", "ry"];
const REPOUSO: Readonly<Canais> = { ox: 0, oy: 0, rx: 0, ry: 0 };
/** Abaixo disto o canal chegou: o laço pode parar. */
const EPS: Readonly<Canais> = { ox: 0.05, oy: 0.05, rx: 0.01, ry: 0.01 };

const escondida = () => typeof document !== "undefined" && document.hidden;

/**
 * A Janete gigante: sem luz e sem respiração, o disco fica parado. Só a leve inclinação com o cursor
 * (no máximo 2° e 4 px, com suavização exponencial) e uma mola, o tremor (x) no erro de senha.
 * O requestAnimationFrame só roda enquanto algo se mexe, e para com a aba escondida.
 * Escreve direto no `style.transform` de `alvo()` (o React não controla esse style).
 * `parado()` é o movimento reduzido: com ele, olhar, recentrar e tremer não fazem nada.
 */
export function criarMovimentoJanete(alvo: () => HTMLElement | null, parado: () => boolean): MovimentoJanete {
  const meta: Canais = { ...REPOUSO };
  const atual: Canais = { ...REPOUSO };
  const mola = { x: 0, vx: 0 };
  let raf = 0;
  let ultimo = 0;
  let calmo = false;

  function pintar() {
    const el = alvo();
    if (!el) return;
    const x = atual.ox + mola.x;
    el.style.transform =
      `translate3d(${x.toFixed(2)}px, ${atual.oy.toFixed(2)}px, 0) ` +
      `rotateX(${atual.rx.toFixed(3)}deg) rotateY(${atual.ry.toFixed(3)}deg)`;
  }

  function passo(t: number) {
    raf = 0;
    let dt = (t - ultimo) / 1000;
    ultimo = t;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.05);

    // Suavização exponencial: 0,32 s de constante de tempo (0,12 s na passagem).
    const kr = 1 - Math.exp(-dt / (calmo ? 0.12 : 0.32));
    let vivo = false;
    for (const c of CANAIS) {
      atual[c] += (meta[c] - atual[c]) * kr;
      if (Math.abs(meta[c] - atual[c]) > EPS[c]) vivo = true;
    }

    // A mola do tremor, em subpassos de 8 ms para não explodir com um quadro longo.
    const n = Math.ceil(dt / 0.008);
    const h = dt / n;
    for (let i = 0; i < n; i += 1) {
      mola.vx += (-620 * mola.x - (calmo ? 40 : 9) * mola.vx) * h;
      mola.x += mola.vx * h;
    }
    if (Math.abs(mola.x) > 0.02 || Math.abs(mola.vx) > 0.2) vivo = true;

    if (!vivo) {
      Object.assign(atual, meta);
      mola.x = 0;
      mola.vx = 0;
    }
    pintar();
    if (vivo && !escondida()) raf = requestAnimationFrame(passo);
  }

  function agendar() {
    if (raf || escondida() || parado() || typeof requestAnimationFrame !== "function") return;
    ultimo = performance.now();
    raf = requestAnimationFrame(passo);
  }

  function pausar() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const parada = () => calmo || parado();

  return {
    olhar(nx, ny) {
      if (parada()) return;
      meta.ox = -nx * 4;
      meta.oy = -ny * 3;
      meta.ry = nx * 2;
      meta.rx = -ny * 2;
      agendar();
    },
    recentrar() {
      if (parada()) return;
      Object.assign(meta, REPOUSO);
      agendar();
    },
    tremer() {
      if (parada()) return;
      mola.vx += 170;
      agendar();
    },
    acalmar() {
      calmo = true;
      Object.assign(meta, REPOUSO);
      agendar();
    },
    deslocamento() {
      return { x: atual.ox + mola.x, y: atual.oy };
    },
    repor() {
      calmo = false;
      pausar();
      Object.assign(meta, REPOUSO);
      Object.assign(atual, REPOUSO);
      mola.x = 0;
      mola.vx = 0;
      pintar();
    },
    pintar,
    pausar,
    retomar: agendar,
  };
}
