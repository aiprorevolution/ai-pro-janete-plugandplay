import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reduzido = { valor: false };

vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  movimentoReduzido: () => reduzido.valor,
}));

import { PalcoContexto, type Palco } from "@/features/onboarding/palco";
import {
  ANUNCIO_FUSAO,
  DURACAO_FUSAO_MS,
  FusaoJanete,
  INICIO_FUSAO,
  afastamento,
} from "@/features/onboarding/fusao";

const origem = { x: 720, y: 268, tamanho: 152 };
const logo = { src: "/logos/anthropic.svg", alt: "Anthropic" };

function palco(): Palco {
  return { janeteNoPalco: vi.fn(), anunciar: vi.fn(), recolherBarra: vi.fn() };
}

function montar(aoTerminar = vi.fn(), p = palco(), props: Partial<{ escura: boolean }> = {}) {
  const r = render(
    <PalcoContexto.Provider value={p}>
      <FusaoJanete logo={{ ...logo, ...props }} origem={origem} aoTerminar={aoTerminar} />
    </PalcoContexto.Provider>,
  );
  return { ...r, aoTerminar, palco: p };
}

const cena = () => document.body.querySelector<HTMLElement>("[data-fusao-janete]");
const fase = () => cena()?.getAttribute("data-fase");
const estadoJanete = () => cena()?.querySelector('[data-peca="janete"] [data-estado]')?.getAttribute("data-estado");

async function ate(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reduzido.valor = false;
});
afterEach(() => vi.useRealTimers());

describe("FusaoJanete (2d: o check vira o logo, que se funde com a Janete)", () => {
  it("fica em posição fixa no body, escondida do leitor de tela, e anuncia um texto curto", () => {
    const { container, palco: p } = montar();
    const el = cena();
    expect(el).not.toBeNull();
    // portal: não fica dentro de quem renderizou
    expect(container.contains(el)).toBe(false);
    expect(el!.parentElement).toBe(document.body);
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("data-identidade", "aipro");
    expect(p.anunciar).toHaveBeenCalledWith(ANUNCIO_FUSAO);
    // as duas peças centradas na origem, com o lado do disco
    const janete = el!.querySelector<HTMLElement>('[data-peca="janete"]')!;
    expect(janete.style.left).toBe(`${origem.x - origem.tamanho / 2}px`);
    expect(janete.style.top).toBe(`${origem.y - origem.tamanho / 2}px`);
    expect(janete.style.width).toBe(`${origem.tamanho}px`);
    // o logo da IA no verso da moeda
    expect(el!.querySelector("img")).toHaveAttribute("src", logo.src);
  });

  it("passa por check → vira → separa → junta → acorda → fim; a Janete dorme até acordar", async () => {
    const { aoTerminar } = montar();
    expect(fase()).toBe("check");
    expect(estadoJanete()).toBe("dormindo");

    await ate(INICIO_FUSAO.vira);
    expect(fase()).toBe("vira");

    await ate(INICIO_FUSAO.separa - INICIO_FUSAO.vira);
    expect(fase()).toBe("separa");
    expect(estadoJanete()).toBe("dormindo");

    await ate(INICIO_FUSAO.junta - INICIO_FUSAO.separa);
    expect(fase()).toBe("junta");
    expect(estadoJanete()).toBe("dormindo");
    expect(aoTerminar).not.toHaveBeenCalled();

    await ate(INICIO_FUSAO.acorda - INICIO_FUSAO.junta);
    expect(fase()).toBe("acorda");
    expect(estadoJanete()).toBe("acordada");
    expect(aoTerminar).not.toHaveBeenCalled();

    await ate(INICIO_FUSAO.fim - INICIO_FUSAO.acorda - 1);
    expect(aoTerminar).not.toHaveBeenCalled();
    await ate(1);
    expect(fase()).toBe("fim");
    expect(estadoJanete()).toBe("acordada");
  });

  it("chama aoTerminar uma vez só, no fim, com o ponto da Janete colorida (o centro e o lado do disco)", async () => {
    const { aoTerminar } = montar();
    await ate(DURACAO_FUSAO_MS);
    expect(aoTerminar).toHaveBeenCalledTimes(1);
    expect(aoTerminar).toHaveBeenCalledWith({ x: origem.x, y: origem.y, tamanho: origem.tamanho });
    await ate(3000);
    expect(aoTerminar).toHaveBeenCalledTimes(1);
  });

  it("dura entre 2 e 3 s, com as fases em ordem", () => {
    expect(DURACAO_FUSAO_MS).toBeGreaterThanOrEqual(2000);
    expect(DURACAO_FUSAO_MS).toBeLessThanOrEqual(3000);
    const tempos = [INICIO_FUSAO.vira, INICIO_FUSAO.separa, INICIO_FUSAO.junta, INICIO_FUSAO.acorda, INICIO_FUSAO.fim];
    expect([...tempos].sort((a, b) => a - b)).toEqual(tempos);
  });

  it("desmontada no meio (a pessoa saiu), não chama aoTerminar e some do body", async () => {
    const { aoTerminar, unmount } = montar();
    await ate(INICIO_FUSAO.junta);
    unmount();
    await ate(DURACAO_FUSAO_MS);
    expect(aoTerminar).not.toHaveBeenCalled();
    expect(cena()).toBeNull();
  });

  it("logo de tile escuro (prop escura, sem uso hoje em MOTORES): o verso leva a marca de escuro", () => {
    montar(vi.fn(), palco(), { escura: true });
    const verso = cena()!.querySelector("img")!.parentElement!;
    expect(verso.className).toMatch(/escura/);
  });

  it("com movimento reduzido: termina na hora, com o mesmo ponto, sem cena na tela", () => {
    reduzido.valor = true;
    const { aoTerminar, palco: p } = montar();
    expect(aoTerminar).toHaveBeenCalledTimes(1);
    expect(aoTerminar).toHaveBeenCalledWith({ x: origem.x, y: origem.y, tamanho: origem.tamanho });
    expect(cena()).toBeNull();
    expect(p.anunciar).toHaveBeenCalledWith(ANUNCIO_FUSAO);
  });
});

describe("afastamento (quanto o logo e a Janete andam para os lados)", () => {
  it("no desktop anda 56% do disco", () => {
    expect(afastamento({ x: 720, y: 300, tamanho: 152 }, 1440)).toBeCloseTo(152 * 0.56);
  });

  it("no celular de 390 px as duas peças cabem com 16 px de folga", () => {
    const o = { x: 195, y: 300, tamanho: 152 };
    const a = afastamento(o, 390);
    const meia = (152 * 0.84) / 2;
    expect(o.x - a - meia).toBeGreaterThanOrEqual(16);
    expect(o.x + a + meia).toBeLessThanOrEqual(390 - 16);
  });

  it("numa tela estreita demais, não fica abaixo de 30% do disco", () => {
    expect(afastamento({ x: 110, y: 300, tamanho: 152 }, 220)).toBeCloseTo(152 * 0.3);
  });
});
