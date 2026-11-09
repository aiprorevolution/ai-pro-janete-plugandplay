import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VooJaneteProvider, rolarAteEMedir, useVooJanete, type ControleVoo } from "@/components/janete/VooJanete";

function Captura({ aoMontar }: { aoMontar: (c: ControleVoo) => void }) {
  aoMontar(useVooJanete());
  return null;
}

function montar() {
  let controle!: ControleVoo;
  const r = render(
    <VooJaneteProvider>
      <Captura aoMontar={(c) => (controle = c)} />
    </VooJaneteProvider>,
  );
  return { ...r, controle: () => controle };
}

const simbolo = () => document.querySelector<HTMLElement>("[data-voo-janete]");

describe("VooJanete (o símbolo em trânsito entre telas)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sem provedor, o controle não faz nada e não está ativo", () => {
    let controle!: ControleVoo;
    render(<Captura aoMontar={(c) => (controle = c)} />);
    expect(controle.ativo).toBe(false);
    expect(() => controle.pousar({ x: 1, y: 1, tamanho: 10 })).not.toThrow();
  });

  it("pousa, voa até o destino e solta", async () => {
    const { controle } = montar();
    expect(simbolo()).toBeNull();

    act(() => controle().pousar({ x: 100, y: 200, tamanho: 96 }, "carregando"));
    expect(controle().ativo).toBe(true);
    expect(simbolo()?.style.left).toBe("100px");
    expect(simbolo()?.getAttribute("data-estado")).toBe("carregando");

    let chegou = false;
    act(() => {
      void controle()
        .voar({ x: 300, y: 50, tamanho: 40 }, { estado: "acordada" })
        .then(() => (chegou = true));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(chegou).toBe(true);
    expect(simbolo()?.style.left).toBe("300px");
    expect(simbolo()?.style.width).toBe("40px");
    expect(simbolo()?.getAttribute("data-estado")).toBe("acordada");

    act(() => controle().soltar());
    expect(simbolo()).toBeNull();
    expect(controle().ativo).toBe(false);
  });

  it("soltar() logo depois de mandar voar: o voo não traz o símbolo de volta", async () => {
    const { controle } = montar();
    act(() => controle().pousar({ x: 100, y: 200, tamanho: 96 }, "acordada"));
    act(() => {
      void controle().voar({ x: 300, y: 50, tamanho: 40 });
      controle().soltar();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(simbolo()).toBeNull();
    expect(controle().ativo).toBe(false);
  });

  it("a legenda acompanha o símbolo e some com fade", async () => {
    const { controle, getByText, queryByText } = montar();
    act(() => {
      controle().pousar({ x: 100, y: 200, tamanho: 96 }, "carregando");
      controle().legenda({ titulo: "Preparando o seu espaço", detalhe: "Conta de Ana criada" });
    });
    expect(getByText("Preparando o seu espaço")).toBeTruthy();
    act(() => controle().legenda(null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(queryByText("Preparando o seu espaço")).toBeNull();
  });

  it("só a passagem do login marca a metamorfose (a sombra chega aos poucos), e ela segue no voo", async () => {
    const { controle } = montar();
    act(() => controle().pousar({ x: 100, y: 200, tamanho: 96 }, "acordada"));
    expect(simbolo()?.hasAttribute("data-metamorfose")).toBe(false);

    act(() => controle().pousar({ x: 100, y: 200, tamanho: 96 }, "carregando", { metamorfose: true }));
    expect(simbolo()?.hasAttribute("data-metamorfose")).toBe(true);

    act(() => {
      void controle().voar({ x: 300, y: 50, tamanho: 40 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(simbolo()?.hasAttribute("data-metamorfose")).toBe(true);
  });
});

describe("rolarAteEMedir (medir só depois de a rolagem parar)", () => {
  function alvo(top: number) {
    const el = document.createElement("div");
    el.id = "alvo-rolagem";
    el.getBoundingClientRect = () =>
      ({ top, bottom: top + 40, left: 100, right: 140, width: 40, height: 40, x: 100, y: top }) as DOMRect;
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    return el;
  }
  afterEach(() => document.getElementById("alvo-rolagem")?.remove());

  it("com o alvo inteiro na tela, mede sem rolar", async () => {
    const el = alvo(100);
    expect(await rolarAteEMedir("alvo-rolagem")).toEqual({ x: 120, y: 120, tamanho: 40 });
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it("com o alvo fora da tela, rola até ele e mede depois", async () => {
    const el = alvo(window.innerHeight + 200);
    const ponto = await rolarAteEMedir("alvo-rolagem");
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    expect(ponto?.tamanho).toBe(40);
  });

  it("espera o próprio alvo parar (rolagem de um contêiner de dentro, que não muda o scrollY)", async () => {
    // a rolagem suave leva o alvo de 1200 a 300 em alguns quadros; o scrollY da página não muda
    const posicoes = [1200, 1200, 900, 600, 400, 300];
    let chamadas = 0;
    const el = document.createElement("div");
    el.id = "alvo-rolagem";
    el.getBoundingClientRect = () => {
      const top = posicoes[Math.min(chamadas, posicoes.length - 1)]!;
      chamadas += 1;
      return { top, bottom: top + 40, left: 100, right: 140, width: 40, height: 40, x: 100, y: top } as DOMRect;
    };
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    const ponto = await rolarAteEMedir("alvo-rolagem");
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(ponto).toEqual({ x: 120, y: 320, tamanho: 40 });
  });

  describe("com a barra de etapas presa no topo", () => {
    function barra(fundo: number, recolhida = false) {
      const nav = document.createElement("header");
      nav.id = "onb-nav";
      if (recolhida) nav.setAttribute("data-recolhe", "true");
      nav.getBoundingClientRect = () =>
        ({ top: 0, bottom: fundo, left: 0, right: 400, width: 400, height: fundo, x: 0, y: 0 }) as DOMRect;
      document.body.appendChild(nav);
      return nav;
    }
    afterEach(() => document.getElementById("onb-nav")?.remove());

    it("um alvo parcialmente atrás da barra é rolado", async () => {
      barra(72);
      const el = alvo(40);
      await rolarAteEMedir("alvo-rolagem");
      expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    });

    it("um alvo logo abaixo da barra não é rolado", async () => {
      barra(72);
      const el = alvo(80);
      await rolarAteEMedir("alvo-rolagem");
      expect(el.scrollIntoView).not.toHaveBeenCalled();
    });

    it("com a barra recolhida, conta a partir do topo da janela", async () => {
      barra(72, true);
      const el = alvo(40);
      await rolarAteEMedir("alvo-rolagem");
      expect(el.scrollIntoView).not.toHaveBeenCalled();
    });

    it("um alvo mais alto que a área livre alinha o começo logo abaixo da barra", async () => {
      barra(72);
      const el = document.createElement("div");
      el.id = "alvo-rolagem";
      const alto = window.innerHeight;
      el.getBoundingClientRect = () =>
        ({ top: 20, bottom: 20 + alto, left: 0, right: 100, width: 100, height: alto, x: 0, y: 20 }) as DOMRect;
      el.scrollIntoView = vi.fn();
      document.body.appendChild(el);
      await rolarAteEMedir("alvo-rolagem");
      expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    });
  });

  it("sem o alvo, devolve null", async () => {
    expect(await rolarAteEMedir("nao-existe")).toBeNull();
  });
});
