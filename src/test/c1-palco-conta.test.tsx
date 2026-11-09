import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ladoDoDisco } from "@/features/conta/movimento";
import { IDS_PALCO, PalcoConta, usePalcoConta, type ControlePalcoConta } from "@/features/conta/PalcoConta";

import { instalarWaapiFalsa, removerWaapiFalsa, type WaapiFalsa } from "./waapi-falsa";

const voo = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
const medida = vi.hoisted(() => ({ reduzido: false }));
vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  useVooJanete: () => voo,
  movimentoReduzido: () => medida.reduzido,
}));

/* ---------- Duas telas filhas, como Entrar e Criar conta ---------- */

let controle!: ControlePalcoConta;
/** O `data-fase` que a tela filha vê no próprio layout effect da montagem (antes do efeito do palco). */
let fasesNaMontagem: Array<string | null> = [];

function Tela({ nome }: { nome: string }) {
  const palco = usePalcoConta();
  controle = palco;
  useLayoutEffect(() => {
    fasesNaMontagem.push(document.getElementById(IDS_PALCO.cena)?.getAttribute("data-fase") ?? null);
  }, []);
  return (
    <section aria-labelledby={`t-${nome}`}>
      <div data-bloco="0">
        <h1 id={`t-${nome}`} tabIndex={-1}>
          Tela {nome}
        </h1>
      </div>
      <div data-campo="">
        <label htmlFor={`${nome}-email`}>E-mail {nome}</label>
        <input id={`${nome}-email`} value={palco.email} onChange={(ev) => palco.definirEmail(ev.target.value)} />
      </div>
      <button type="button" data-bloco="2">
        Enviar {nome}
      </button>
      <p data-bloco="3">Rodapé {nome}</p>
    </section>
  );
}

function montar(inicial: "/a" | "/b" = "/a", { estrito = false } = {}) {
  const raiz = createRootRoute({ component: () => <Outlet /> });
  const conta = createRoute({
    getParentRoute: () => raiz,
    id: "_conta",
    component: () => (
      <PalcoConta>
        <Outlet />
      </PalcoConta>
    ),
  });
  const a = createRoute({ getParentRoute: () => conta, path: "/a", component: () => <Tela nome="A" /> });
  const b = createRoute({ getParentRoute: () => conta, path: "/b", component: () => <Tela nome="B" /> });
  const router = createRouter({
    routeTree: raiz.addChildren([conta.addChildren([a, b])]),
    history: createMemoryHistory({ initialEntries: [inicial] }),
  });
  const arvore = <RouterProvider router={router} />;
  const r = render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore);
  return { router, ...r };
}

const cena = () => document.getElementById(IDS_PALCO.cena)!;
const fase = () => cena().getAttribute("data-fase");
const disco = () => document.getElementById(IDS_PALCO.disco)!;
const cartao = () => document.getElementById(IDS_PALCO.cartao)!;

/** Deixa o roteador carregar a rota (promessas e tiques zero), sem andar o relógio. */
async function carregar() {
  for (let i = 0; i < 5; i += 1) await act(() => vi.advanceTimersByTimeAsync(0));
  expect(document.getElementById(IDS_PALCO.cena)).not.toBeNull();
}

/** Passa o tempo em passos curtos, cada um num act(), como o navegador pintando entre os timers. */
async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 20) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(20, ms - feito)));
  }
}

let waapi: WaapiFalsa | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  medida.reduzido = false;
  voo.pousar.mockReset();
  voo.legenda.mockReset();
  fasesNaMontagem = [];
  waapi = null;
});
afterEach(() => {
  removerWaapiFalsa();
  vi.useRealTimers();
});

describe("ladoDoDisco (o tamanho da Janete gigante)", () => {
  const zero = { larguraRef: 0, alturaRef: 0 };

  it("no computador, 86% da altura, mas nunca menos que a diagonal do cartão + 96", () => {
    expect(ladoDoDisco({ largura: 1440, altura: 900 }, { largura: 424, altura: 440 }, zero).lado).toBe(774);
    expect(ladoDoDisco({ largura: 1440, altura: 900 }, { largura: 424, altura: 628 }, zero).lado).toBe(854);
  });

  it("no celular, 92% da altura; o teclado aberto não encolhe; a largura nova recomeça a altura", () => {
    const cel = ladoDoDisco({ largura: 390, altura: 844 }, { largura: 358, altura: 560 }, zero);
    expect(cel).toEqual({ larguraRef: 390, alturaRef: 844, lado: 776 });

    const teclado = ladoDoDisco({ largura: 390, altura: 500 }, { largura: 358, altura: 560 }, cel);
    expect(teclado).toEqual({ larguraRef: 390, alturaRef: 844, lado: 776 });

    // Girou (ou outra largura): a referência volta a ser a altura de agora, e o mínimo do cartão vale.
    const outra = ladoDoDisco({ largura: 430, altura: 500 }, { largura: 358, altura: 560 }, teclado);
    expect(outra.alturaRef).toBe(500);
    expect(outra.lado).toBe(Math.round(Math.hypot(358, 560) + 96));
  });
});

describe("PalcoConta", () => {
  it("com movimento reduzido (ou sem WAAPI), já monta aberto, com a bola inteira e sem animar", async () => {
    waapi = instalarWaapiFalsa();
    medida.reduzido = true;
    const { unmount } = montar();
    await carregar();
    expect(fase()).toBe("aberto");
    expect(waapi.animacoes).toHaveLength(0);
    expect(cena().style.getPropertyValue("--d")).toMatch(/^\d+px$/);
    unmount();

    // Sem Element.prototype.animate, mesmo sem a preferência: também parado desde o primeiro quadro.
    removerWaapiFalsa();
    medida.reduzido = false;
    montar("/b");
    await carregar();
    expect(fase()).toBe("aberto");
    expect(screen.getByRole("heading", { name: "Tela B" })).toBeInTheDocument();
  });

  it.each([false, true])(
    "a entrada vai de inicio a entrada e chega em aberto em ~2,2 s (StrictMode: %s)",
    async (estrito) => {
      waapi = instalarWaapiFalsa();
      montar("/a", { estrito });
      await carregar();
      // O primeiro HTML (o do servidor também) nasce em "inicio": a tela filha monta antes do palco.
      expect(fasesNaMontagem[0]).toBe("inicio");
      expect(fase()).toBe("entrada");

      // A bola: uma animação de entrada viva (no StrictMode, a da primeira montagem foi cancelada).
      const doDisco = waapi.doAlvo(disco());
      expect(doDisco.filter((a) => a.estado === "rodando")).toHaveLength(1);
      expect(doDisco.filter((a) => a.estado === "cancelada")).toHaveLength(estrito ? 1 : 0);
      expect(doDisco.at(-1)?.opcoes.duration).toBe(1250);

      // Os quatro blocos do conteúdo, a cada 70 ms a partir do corte (1050 + 760 × 0,72).
      const blocos = waapi
        .ativas()
        .filter((a) => cartao().contains(a.alvo))
        .map((a) => a.opcoes.delay);
      expect(blocos).toEqual([1597, 1667, 1737, 1807]);

      await passar(1000);
      expect(fase()).toBe("entrada");
      await passar(100);
      expect(fase()).toBe("abrindo");
      expect(waapi.doAlvo(cartao()).at(-1)?.quadros).toEqual([
        { clipPath: expect.stringMatching(/^inset\(/) },
        { clipPath: "inset(0px 0px 0px 0px round 28px 28px 28px 0px)" },
      ]);
      await passar(1040);
      expect(fase()).toBe("abrindo");
      await passar(80);
      expect(fase()).toBe("aberto");
      expect(waapi.ativas()).toHaveLength(0);
      // Na primeira montagem, nada recebe o foco.
      expect(document.activeElement).toBe(document.body);
    },
  );

  it("o e-mail digitado vai junto na troca entre as duas telas", async () => {
    const { router } = montar("/a");
    await carregar();
    fireEvent.change(screen.getByLabelText("E-mail A"), { target: { value: "ana@empresa.com.br" } });
    await act(() => router.history.push("/b"));
    await carregar();
    expect(screen.queryByLabelText("E-mail A")).toBeNull();
    expect(screen.getByLabelText("E-mail B")).toHaveValue("ana@empresa.com.br");
    expect(controle.email).toBe("ana@empresa.com.br");
  });

  describe("passagem", () => {
    it("devolve false sem WAAPI ou com movimento reduzido, sem mexer em nada", async () => {
      const { unmount } = montar("/a");
      await carregar();
      await expect(controle.passagem({ voo: false })).resolves.toBe(false);
      expect(fase()).toBe("aberto");
      expect(cartao()).not.toHaveAttribute("inert");
      unmount();

      instalarWaapiFalsa();
      medida.reduzido = true;
      montar("/a");
      await carregar();
      const campo = screen.getByLabelText("E-mail A");
      campo.focus();
      await expect(controle.passagem({ voo: true, legenda: { titulo: "x" } })).resolves.toBe(false);
      expect(fase()).toBe("aberto");
      expect(document.activeElement).toBe(campo);
      expect(voo.pousar).not.toHaveBeenCalled();
    });

    it("com voo: fecha o cartão, contrai a bola e pousa o símbolo no centro medido do disco, com a legenda", async () => {
      waapi = instalarWaapiFalsa();
      montar("/a");
      await carregar();
      await passar(2300);
      expect(fase()).toBe("aberto");
      disco().getBoundingClientRect = () =>
        ({ x: 100, y: 50, left: 100, top: 50, width: 96, height: 96, right: 196, bottom: 146 }) as DOMRect;
      const campo = screen.getByLabelText("E-mail A");
      campo.focus();

      let resultado: boolean | null = null;
      const legenda = { titulo: "Preparando o seu espaço", detalhe: "Conta de Ana criada" };
      act(() => {
        void controle.passagem({ voo: true, legenda }).then((ok) => (resultado = ok));
      });
      expect(fase()).toBe("passagem");
      expect(document.activeElement).not.toBe(campo);
      expect(cartao()).toHaveAttribute("inert");
      // Outra passagem enquanto esta corre: recusa.
      await expect(controle.passagem({ voo: false })).resolves.toBe(false);

      await passar(500);
      expect(fase()).toBe("passagem");
      await passar(40);
      expect(fase()).toBe("absorvido");
      const contracao = waapi.doAlvo(disco()).at(-1);
      expect(contracao?.opcoes).toMatchObject({ duration: 860, easing: "cubic-bezier(0.7, 0, 0.2, 1)" });
      expect(resultado).toBeNull();
      expect(voo.pousar).not.toHaveBeenCalled();

      await passar(900);
      expect(resultado).toBe(true);
      expect(fase()).toBe("fim");
      expect(voo.pousar).toHaveBeenCalledTimes(1);
      expect(voo.pousar).toHaveBeenCalledWith({ x: 148, y: 98, tamanho: 96 }, "carregando", { metamorfose: true });
      expect(voo.legenda).toHaveBeenCalledWith(legenda);
      // Com voo, o carregando é o do VooJanete: o palco não desenha o dele.
      expect(screen.queryByRole("img", { name: "Janete, carregando" })).toBeNull();
    });

    it("sem voo: mostra o carregando do palco no centro da janela quando a medida vem vazia", async () => {
      waapi = instalarWaapiFalsa({ fator: 0 });
      montar("/a");
      await carregar();
      await passar(2300);

      let resultado: boolean | null = null;
      act(() => {
        void controle.passagem({ voo: false }).then((ok) => (resultado = ok));
      });
      await passar(100);
      expect(resultado).toBe(true);
      expect(fase()).toBe("fim");
      expect(voo.pousar).not.toHaveBeenCalled();
      const carregando = screen.getByRole("img", { name: "Janete, carregando" });
      expect(carregando).toHaveAttribute("data-estado", "carregando");
      // O jsdom mede tudo com largura 0: cai no centro da janela (1024 × 768).
      expect(carregando.style.left).toBe(`${window.innerWidth / 2}px`);
      expect(carregando.style.top).toBe(`${window.innerHeight / 2}px`);
      expect(carregando.style.width).toBe("96px");
      // O cartão está inert: o foco vai para o carregando, e não fica perdido no body.
      expect(document.activeElement).toBe(carregando);
      // Já terminou: não começa de novo.
      await expect(controle.passagem({ voo: false })).resolves.toBe(false);
    });

    it("o centro é o da largura sem a barra de rolagem (o html reserva 15 px no computador)", async () => {
      waapi = instalarWaapiFalsa({ fator: 0 });
      // A janela tem 1024 de largura, mas a página só 1000: o resto é a barra reservada.
      Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1000 });
      try {
        montar("/a");
        await carregar();
        await passar(2300);
        act(() => {
          void controle.passagem({ voo: false });
        });
        await passar(100);
        // A contração leva o centro do cartão (0 no jsdom) ao meio de 1000, não de 1024.
        const contracao = waapi.doAlvo(disco()).find((a) => a.opcoes.duration === 860);
        const quadros = contracao?.quadros as Keyframe[];
        expect(quadros[1]?.["transform"]).toMatch(/^translate\(500\.0px, /);
        // A medida vazia também cai no meio da página.
        expect(screen.getByRole("img", { name: "Janete, carregando" }).style.left).toBe("500px");
      } finally {
        Reflect.deleteProperty(document.documentElement, "clientWidth");
      }
    });

    it("com o main medido, o centro é o dele (a reserva da barra fica fora, mesmo se o clientWidth não a descontar)", async () => {
      waapi = instalarWaapiFalsa({ fator: 0 });
      // O navegador sem tela diz clientWidth 1440, mas o main tem 1425 (os 15 px da barra reservada).
      Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1440 });
      try {
        montar("/a");
        await carregar();
        await passar(2300);
        const cena = document.getElementById("palco-cena")!;
        cena.getBoundingClientRect = () =>
          ({ x: 0, y: 0, left: 0, top: 0, width: 1425, height: 900, right: 1425, bottom: 900 }) as DOMRect;
        act(() => {
          void controle.passagem({ voo: false });
        });
        await passar(100);
        // 712,5 (o meio do main), não 720 (o meio do clientWidth).
        const contracao = waapi.doAlvo(disco()).find((a) => a.opcoes.duration === 860);
        const quadros = contracao?.quadros as Keyframe[];
        expect(quadros[1]?.["transform"]).toMatch(/^translate\(712\.5px, /);
        expect(screen.getByRole("img", { name: "Janete, carregando" }).style.left).toBe("712.5px");
      } finally {
        Reflect.deleteProperty(document.documentElement, "clientWidth");
      }
    });

    it("desmontar no meio cancela tudo e resolve false", async () => {
      waapi = instalarWaapiFalsa();
      const { unmount } = montar("/a");
      await carregar();
      await passar(2300);
      let resultado: boolean | null = null;
      act(() => {
        void controle.passagem({ voo: true, legenda: { titulo: "x" } }).then((ok) => (resultado = ok));
      });
      await passar(200);
      expect(waapi.ativas().length).toBeGreaterThan(0);
      unmount();
      await passar(2000);
      expect(resultado).toBe(false);
      expect(waapi.ativas()).toHaveLength(0);
      expect(voo.pousar).not.toHaveBeenCalled();
    });
  });

  it("trocar de tela durante a entrada assenta na hora e foca o h1 novo", async () => {
    waapi = instalarWaapiFalsa();
    const { router } = montar("/a");
    await carregar();
    await passar(400);
    expect(fase()).toBe("entrada");
    expect(document.activeElement).toBe(document.body);

    await act(() => router.history.push("/b"));
    await carregar();
    expect(fase()).toBe("aberto");
    expect(waapi.ativas()).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Tela B" }));
    // Cortada, a entrada não volta a mexer em nada depois.
    await passar(2000);
    expect(fase()).toBe("aberto");
  });

  it("tremer não anima com movimento reduzido (e anima sem ele)", async () => {
    waapi = instalarWaapiFalsa();
    medida.reduzido = true;
    const { unmount } = montar("/a");
    await carregar();
    const discoPos = () => disco().parentElement!;
    const parado = discoPos().style.transform;
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    act(() => controle.tremer());
    await passar(100);
    expect(raf).not.toHaveBeenCalled();
    expect(discoPos().style.transform).toBe(parado);
    expect(waapi.animacoes).toHaveLength(0);
    unmount();

    medida.reduzido = false;
    montar("/a");
    await carregar();
    act(() => controle.assentar());
    expect(fase()).toBe("aberto");
    raf.mockClear();
    act(() => controle.tremer());
    expect(raf).toHaveBeenCalled();
    await passar(40);
    expect(discoPos().style.transform).toMatch(/^translate3d\((?!0\.00px)/);
    raf.mockRestore();
  });
});
