/**
 * Uma Web Animations API falsa para o jsdom (que não tem `Element.prototype.animate`). Cada
 * `el.animate(quadros, opcoes)` vira uma animação que dispara "finish" depois de (duração + atraso)
 * vezes `fator`, por setTimeout: com `vi.useFakeTimers()`, o tempo anda com o relógio falso; com
 * `fator: 0`, tudo termina no próximo tique (os testes de fluxo, que não querem esperar a coreografia).
 * `cancel()` dispara "cancel" na hora, também numa animação já terminada (como no navegador, que só
 * ignora a ociosa). Só o que o palco usa: `animate`, `cancel`, `finish` e os dois eventos.
 *
 *   const waapi = instalarWaapiFalsa();       // no beforeEach
 *   waapi.doAlvo(el), waapi.ativas()           // o que animou e o que ainda roda
 *   removerWaapiFalsa();                       // no afterEach (volta ao jsdom puro, sem animate)
 */

export type EstadoAnimacaoFalsa = "rodando" | "terminada" | "cancelada";

export interface AnimacaoFalsa {
  alvo: Element;
  quadros: Keyframe[] | PropertyIndexedKeyframes | null;
  opcoes: KeyframeAnimationOptions;
  /** O que o setTimeout vai esperar: (duração + atraso) × fator. */
  esperaMs: number;
  estado: EstadoAnimacaoFalsa;
  /** O objeto devolvido pelo `animate` (para comparar com o que o código guardou). */
  animacao: Animation;
}

export interface WaapiFalsa {
  /** Todas as animações criadas desde a instalação, na ordem. */
  readonly animacoes: AnimacaoFalsa[];
  /** Multiplica a duração e o atraso. 0 = termina no próximo tique. Pode mudar a qualquer momento. */
  fator: number;
  ativas(): AnimacaoFalsa[];
  doAlvo(alvo: Element | null | undefined): AnimacaoFalsa[];
  /** Esquece as animações registradas (sem cancelar nada). */
  limpar(): void;
}

let instalada: { descritor: PropertyDescriptor | undefined } | null = null;

class AnimacaoDeTeste extends EventTarget {
  playState: AnimationPlayState = "running";
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly registro: AnimacaoFalsa) {
    super();
    this.timer = setTimeout(() => this.finish(), registro.esperaMs);
  }

  finish() {
    if (this.registro.estado !== "rodando") return;
    clearTimeout(this.timer);
    this.registro.estado = "terminada";
    this.playState = "finished";
    this.dispatchEvent(new Event("finish"));
  }

  cancel() {
    if (this.playState === "idle") return;
    clearTimeout(this.timer);
    this.registro.estado = "cancelada";
    this.playState = "idle";
    this.dispatchEvent(new Event("cancel"));
  }
}

const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function instalarWaapiFalsa(opcoes: { fator?: number } = {}): WaapiFalsa {
  if (instalada) removerWaapiFalsa();
  const animacoes: AnimacaoFalsa[] = [];
  const waapi: WaapiFalsa = {
    animacoes,
    fator: opcoes.fator ?? 1,
    ativas: () => animacoes.filter((a) => a.estado === "rodando"),
    doAlvo: (alvo) => animacoes.filter((a) => a.alvo === alvo),
    limpar: () => {
      animacoes.length = 0;
    },
  };

  instalada = { descritor: Object.getOwnPropertyDescriptor(Element.prototype, "animate") };
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: function animate(
      this: Element,
      quadros: Keyframe[] | PropertyIndexedKeyframes | null,
      op?: number | KeyframeAnimationOptions,
    ): Animation {
      const opcoesAnim: KeyframeAnimationOptions = typeof op === "number" ? { duration: op } : { ...(op ?? {}) };
      const registro = {
        alvo: this,
        quadros,
        opcoes: opcoesAnim,
        esperaMs: (numero(opcoesAnim.duration) + numero(opcoesAnim.delay)) * waapi.fator,
        estado: "rodando",
      } as AnimacaoFalsa;
      const animacao = new AnimacaoDeTeste(registro) as unknown as Animation;
      registro.animacao = animacao;
      animacoes.push(registro);
      return animacao;
    },
  });
  return waapi;
}

/** Volta ao jsdom puro: sem `Element.prototype.animate` (ou com o que havia antes). */
export function removerWaapiFalsa() {
  if (!instalada) return;
  if (instalada.descritor) Object.defineProperty(Element.prototype, "animate", instalada.descritor);
  else delete (Element.prototype as { animate?: unknown }).animate;
  instalada = null;
}
