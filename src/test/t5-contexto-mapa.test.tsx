import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reiniciarContexto } from "@/features/plataforma/contexto/loja";
import { Mapa, type PropsMapa } from "@/features/plataforma/contexto/Mapa";
import { CAMPOS, type Alvo } from "@/features/plataforma/contexto/tipos";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C1 da spec do Contexto (docs/spec-contexto.md): o mapa. As medidas (getBoundingClientRect) são
// simuladas: o mapa tem 1136 x 640, a pilha 252 px no centro (568, 330), os círculos dos campos numa
// coluna à esquerda e os dos cartões numa coluna à direita.

function ret(left: number, top: number, width: number, height: number): DOMRect {
  const r = { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height };
  return { ...r, toJSON: () => r } as DOMRect;
}

const D = 252;
const C = { x: 568, y: 330 };
const PILHA = ret(C.x - D / 2, C.y - D / 2, D, D);
// os hubs, como no Pilha.module.css: 8 px fora da borda, com o vão do disco de cima e do de baixo
const HUBS: Record<string, { x: number; y: number }> = {
  "ctx-hub-oferta": { x: C.x - D / 2 - 8, y: C.y - D * 0.532 },
  "ctx-hub-conversa": { x: C.x - D / 2 - 8, y: C.y },
  "ctx-hub-livres": { x: C.x + D / 2 + 8, y: C.y + D * 0.546 },
};

function medidaFalsa(this: Element): DOMRect {
  const el = this as HTMLElement;
  if (el.id === "ctx-mapa") return ret(0, 0, 1136, 640);
  if (el.id === "ctx-pilha" || el.hasAttribute("data-ancora")) return PILHA;
  const hub = HUBS[el.id];
  if (hub) return ret(hub.x, hub.y, 0, 0);
  const ponta = el.getAttribute("data-ponta");
  if (ponta) {
    const i = CAMPOS.findIndex((c) => c.chave === ponta);
    if (i >= 0) return ret(480, 60 + i * 40, 32, 32);
    const n = ponta === "livre-novo" ? 4 : Number(ponta.slice(6));
    return ret(900, 380 + n * 60, 32, 32);
  }
  return ret(0, 0, 0, 0);
}

const props = (extra: Partial<PropsMapa> = {}): PropsMapa => ({
  fase: "pronto",
  pilhaRef: createRef<HTMLDivElement>(),
  aoAbrir: vi.fn(),
  aoAbrirEnsinar: vi.fn(),
  ensinarAberto: false,
  estreita: false,
  ...extra,
});

function montar(extra: Partial<PropsMapa> = {}, papel: Papel = "admin") {
  const p = props(extra);
  const r = render(
    <ProvedorPapel inicial={papel}>
      <Mapa {...p} />
    </ProvedorPapel>,
  );
  const remontar = (mais: Partial<PropsMapa>) =>
    r.rerender(
      <ProvedorPapel inicial={papel}>
        <Mapa {...p} {...mais} />
      </ProvedorPapel>,
    );
  return { ...r, p, remontar };
}

const curva = (c: HTMLElement, alvo: Alvo) => c.querySelector<SVGPathElement>(`path[data-alvo="${alvo}"]`);
const inicio = (d: string | null) => (d ?? "").match(/^M([\d.]+) ([\d.]+)/)?.slice(1).map(Number) ?? [];

beforeEach(() => {
  reiniciarContexto();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(medidaFalsa);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  reiniciarContexto();
});

describe("a ordem de leitura (Tab)", () => {
  const ordem = (c: HTMLElement) =>
    [...c.querySelectorAll<HTMLElement>("button")].map((b) => b.getAttribute("data-grupo") ?? b.getAttribute("data-camada") ?? b.getAttribute("data-acao") ?? b.id);

  it("no computador: a coluna da esquerda, a Janete (discos e peça) e depois a da direita", () => {
    const { container } = montar();
    const o = ordem(container);
    const ultimoCampo = o.lastIndexOf("ctx-l-horario");
    const discos = ["oferta", "conversa", "livres"].map((g) => o.indexOf(g, ultimoCampo));
    const peca = o.indexOf("peca");
    const tituloLivres = o.lastIndexOf("livres");
    expect(o.indexOf("oferta")).toBeLessThan(ultimoCampo);
    for (const k of discos) expect(k).toBeGreaterThan(ultimoCampo);
    expect(peca).toBeGreaterThan(ultimoCampo);
    expect(tituloLivres).toBeGreaterThan(Math.max(...discos, peca));
    expect(o.indexOf("ctx-card-1")).toBeGreaterThan(tituloLivres);
    expect(container.querySelector("#ctx-mapa > [data-ctx-janete]")?.previousElementSibling).toBe(
      container.querySelector("#ctx-mapa > :first-child"),
    );
  });

  it("no celular: a Janete vem primeiro, como na tela", () => {
    const { container } = montar({ estreita: true });
    expect(container.querySelector("#ctx-mapa")!.firstElementChild).toHaveAttribute("data-ctx-janete");
  });
});

describe("os ícones dos campos são os do Contexto 6", () => {
  it("Cliente ideal é o alvo, Diferenciais a medalha, Tom de voz as ondas e Passar para humano as pessoas", async () => {
    const lucide = await import("lucide-react");
    const icone = (k: string) => CAMPOS.find((c) => c.chave === k)!.icone;
    expect(icone("cliente_ideal")).toBe(lucide.Target);
    expect(icone("diferenciais")).toBe(lucide.Award);
    expect(icone("tom_voz")).toBe(lucide.AudioLines);
    expect(icone("quando_passar_humano")).toBe(lucide.Users);
    // Empresa e oferta: o prédio do protótipo (IC.empresa)
    const Empresa = icone("empresa_oferta");
    const { container } = render(<Empresa />);
    const ds = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(ds).toContain("M5 21V7l7-4 7 4v14");
    expect(ds).toContain("M10 21v-3h4v3");
  });
});

describe("o mapa: grupos, linhas e cartões", () => {
  it("tem os 3 títulos de grupo, as 8 linhas nos 2 grupos da esquerda e os 3 cartões mais o novo", () => {
    const { container } = montar();
    expect([...container.querySelectorAll("[data-grupo]")].map((e) => e.getAttribute("data-grupo"))).toEqual([
      "oferta",
      "conversa",
      "livres",
    ]);
    const oferta = container.querySelector("section[aria-labelledby='ctx-g-oferta']")!;
    const conversa = container.querySelector("section[aria-labelledby='ctx-g-conversa']")!;
    expect([...oferta.querySelectorAll("[data-campo]")].map((e) => e.getAttribute("data-campo"))).toEqual([
      "empresa_oferta",
      "cliente_ideal",
      "preco",
      "diferenciais",
    ]);
    expect([...conversa.querySelectorAll("[data-campo]")].map((e) => e.getAttribute("data-campo"))).toEqual([
      "tom_voz",
      "quando_passar_humano",
      "objecoes",
      "horario",
    ]);
    expect(container.querySelectorAll("[data-campo]")).toHaveLength(8);
    expect([...container.querySelectorAll("[data-livre]")].map((e) => e.getAttribute("data-livre"))).toEqual(["1", "2", "3", "novo"]);
    // o ícone num círculo, com o id que o mapa mede
    for (const c of CAMPOS) expect(container.querySelector(`#ctx-li-${c.chave}`)).not.toBeNull();
    for (const id of ["ctx-ci-1", "ctx-ci-2", "ctx-ci-3", "ctx-ci-novo"]) expect(container.querySelector(`#${id}`)).not.toBeNull();
    expect(container.querySelector("#ctx-card-1")?.textContent).toContain("Vocês emitem nota fiscal?");
  });

  it("sem selo: cada círculo tem só o ícone, e o contorno conta a situação", () => {
    const { container } = montar();
    const icones = container.querySelectorAll("[data-ponta]");
    expect(icones).toHaveLength(12);
    icones.forEach((ico) => {
      expect(ico.querySelectorAll("svg")).toHaveLength(1);
      expect(ico.children).toHaveLength(1);
    });
    expect(container.querySelector("[data-selo]")).toBeNull();
    expect(container.querySelector("#ctx-li-preco")?.getAttribute("data-situacao")).toBe("sabe");
    expect(container.querySelector("#ctx-li-objecoes")?.getAttribute("data-situacao")).toBe("vazio");
  });

  it("o atendente não vê o cartão novo nem a peça; a versão antiga dorme e não tem o novo", () => {
    const at = montar({}, "atendente");
    expect(at.container.querySelector('[data-livre="novo"]')).toBeNull();
    expect(at.container.querySelector('[data-acao="peca"]')).toBeNull();
    expect(at.container.querySelectorAll("[data-camada]")).toHaveLength(3);
    cleanup();

    reiniciarContexto({ vendo: 3 });
    const { container } = montar();
    expect(container.querySelector('[data-livre="novo"]')).toBeNull();
    expect(container.querySelector('[data-acao="peca"]')).toBeNull();
    expect(container.querySelector("#ctx-pilha")?.hasAttribute("data-dormindo")).toBe(true);
    expect(container.textContent).toContain("Versão 3 · só leitura");
  });
});

describe("as curvas", () => {
  it("uma curva por campo e por cartão, do hub até o lado do círculo virado para a Janete", () => {
    const { container } = montar();
    const caminhos = container.querySelectorAll("path[data-alvo]");
    expect(caminhos).toHaveLength(12);
    const alvos = [...caminhos].map((p) => p.getAttribute("data-alvo")).sort();
    expect(alvos).toEqual(
      [...CAMPOS.map((c) => c.chave), "livre-1", "livre-2", "livre-3", "livre-novo"].sort(),
    );
    // sai do hub do disco de cima e chega ao lado direito do círculo de "Preço" (480 + 32 + 1)
    const preco = curva(container, "preco")!.getAttribute("d")!;
    expect(inicio(preco)).toEqual([434, 196]);
    expect(preco.endsWith("513 156")).toBe(true);
    // as perguntas livres saem do hub da direita do disco de baixo e chegam ao lado esquerdo (900 - 1)
    const l2 = curva(container, "livre-2")!.getAttribute("d")!;
    expect(inicio(l2)).toEqual([702, 467.5]);
    expect(l2.endsWith("899 516")).toBe(true);
    // os 3 hubs aparecem
    expect([...container.querySelectorAll("[data-porta]")].map((e) => e.getAttribute("data-porta"))).toEqual([
      "oferta",
      "conversa",
      "livres",
    ]);
  });

  it("contínua quando sabe, tracejada quando vazio, clara quando não salvo (e o atendente nunca vê rascunho)", () => {
    reiniciarContexto({ rascunhos: { horario: { texto: "Segunda a sexta, das 9h às 18h." } } });
    const { container } = montar();
    const preco = curva(container, "preco")!;
    expect(preco.getAttribute("data-situacao")).toBe("sabe");
    expect(preco.getAttribute("stroke-dasharray")).toBeNull();
    const obj = curva(container, "objecoes")!;
    expect(obj.getAttribute("data-situacao")).toBe("vazio");
    expect(obj.getAttribute("stroke-dasharray")).toBe("4 5");
    expect(curva(container, "livre-novo")!.getAttribute("data-situacao")).toBe("vazio");
    const hor = curva(container, "horario")!;
    expect(hor.getAttribute("data-situacao")).toBe("nao_salvo");
    expect(hor.getAttribute("stroke-dasharray")).toBeNull();
    expect(container.querySelector("#ctx-li-horario")?.getAttribute("data-situacao")).toBe("nao_salvo");
    cleanup();

    const at = montar({}, "atendente");
    expect(curva(at.container, "horario")!.getAttribute("data-situacao")).toBe("vazio");
    expect(at.container.querySelectorAll("path[data-alvo]")).toHaveLength(11);
  });

  it("só se desenham a partir de 'ligando', em ordem; antes do pouso a pilha não aparece", () => {
    vi.useFakeTimers();
    const { container, remontar } = montar({ fase: "casa" });
    expect(container.querySelector("[data-escondida]")?.contains(container.querySelector("#ctx-pilha"))).toBe(true);
    expect(container.querySelectorAll("path[data-alvo]")).toHaveLength(0);
    expect(container.querySelector("#ctx-mapa")?.hasAttribute("data-antes")).toBe(true);

    remontar({ fase: "separada" });
    expect(container.querySelector("[data-escondida]")).toBeNull();
    expect(container.querySelector("#ctx-pilha")?.getAttribute("data-fase")).toBe("separada");
    expect(container.querySelectorAll("path[data-alvo]")).toHaveLength(0);

    remontar({ fase: "ligando" });
    const mapa = container.querySelector("#ctx-mapa")!;
    expect(mapa.hasAttribute("data-desenha")).toBe(true);
    expect(container.querySelectorAll("path[data-alvo]")).toHaveLength(12);
    const atraso = (a: Alvo) => parseFloat(curva(container, a)!.style.getPropertyValue("--atraso"));
    expect(atraso("empresa_oferta")).toBeLessThan(atraso("diferenciais"));
    expect(atraso("diferenciais")).toBeLessThan(atraso("horario"));
    expect(atraso("horario")).toBeLessThan(atraso("livre-1"));

    // em "pronto" ficam; o desenho termina sozinho
    remontar({ fase: "pronto" });
    expect(container.querySelectorAll("path[data-alvo]")).toHaveLength(12);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mapa.hasAttribute("data-desenha")).toBe(false);
  });

  it("no celular não há curvas", () => {
    const { container } = montar({ estreita: true });
    expect(container.querySelector("#ctx-mapa")?.hasAttribute("data-estreita")).toBe(true);
    expect(container.querySelectorAll("path[data-alvo]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-campo]")).toHaveLength(8);
  });

  it("com o balão de ensinar, os hubs encolhem e descem junto com a pilha", () => {
    const { container, remontar } = montar();
    const antes = inicio(curva(container, "empresa_oferta")!.getAttribute("d"));
    remontar({ ensinarAberto: true, balao: <div data-testid="balao">balão</div> });
    expect(container.querySelector("#ctx-mapa")?.hasAttribute("data-ensina")).toBe(true);
    const depois = inicio(curva(container, "empresa_oferta")!.getAttribute("d"));
    // x: 568 + 0,62 (434 - 568); y: 330 + 0,62 (196 - 330) + 0,45 x 252
    expect(depois[0]).toBeCloseTo(484.92, 1);
    expect(depois[1]).toBeCloseTo(360.32, 1);
    expect(depois[1]).toBeGreaterThan(antes[1]!);
    expect(container.querySelector('[data-testid="balao"]')).not.toBeNull();
    expect(container.querySelector('[data-acao="peca"]')?.getAttribute("aria-expanded")).toBe("true");
  });

  it("o raio corre pela curva do campo descoberto", () => {
    const { container, remontar } = montar();
    expect(container.querySelector("path[data-raio]")).toBeNull();
    remontar({ raio: { alvo: "horario", n: 1 } });
    const raio = container.querySelector("path[data-raio]")!;
    expect(raio.getAttribute("data-raio")).toBe("horario");
    expect(raio.getAttribute("d")).toBe(curva(container, "horario")!.getAttribute("d"));
  });
});

describe("o vínculo e os cliques", () => {
  it("hover no disco de baixo marca os cartões e esmaece as outras curvas; e o contrário", () => {
    const { container } = montar();
    fireEvent.mouseOver(container.querySelector('[data-camada="livres"]')!);
    container.querySelectorAll("[data-livre]").forEach((c) => expect(c.hasAttribute("data-aceso")).toBe(true));
    expect(container.querySelector('[data-campo="preco"]')?.hasAttribute("data-aceso")).toBe(false);
    expect(curva(container, "preco")!.hasAttribute("data-esmaecido")).toBe(true);
    expect(curva(container, "livre-1")!.hasAttribute("data-esmaecido")).toBe(false);
    expect(curva(container, "livre-1")!.getAttribute("data-aceso")).toBe("grupo");
    expect(container.querySelector('[data-grupo="livres"]')?.hasAttribute("data-aceso")).toBe(true);

    // um cartão acende o disco de baixo e engrossa a curva dele
    fireEvent.mouseOver(container.querySelector('[data-livre="2"]')!);
    expect(container.querySelector("#ctx-pilha")?.getAttribute("data-destaque")).toBe("livres");
    expect(curva(container, "livre-2")!.getAttribute("data-aceso")).toBe("item");

    fireEvent.mouseLeave(container.querySelector("#ctx-mapa")!);
    expect(container.querySelector("#ctx-pilha")?.hasAttribute("data-destaque")).toBe(false);
    expect(container.querySelector("[data-esmaecido]")).toBeNull();
  });

  it("disco, título, linha e cartão abrem a seção; a peça abre o ensinar", () => {
    const { container, p } = montar();
    fireEvent.click(container.querySelector('[data-camada="conversa"]')!);
    fireEvent.click(container.querySelector('[data-grupo="oferta"]')!);
    fireEvent.click(container.querySelector('[data-campo="preco"]')!);
    fireEvent.click(container.querySelector('[data-livre="2"]')!);
    fireEvent.click(container.querySelector('[data-livre="novo"]')!);
    expect(vi.mocked(p.aoAbrir).mock.calls.map((c) => c[0])).toEqual(["conversa", "oferta", "preco", "livre-2", "livre-novo"]);
    fireEvent.click(container.querySelector('[data-acao="peca"]')!);
    expect(p.aoAbrirEnsinar).toHaveBeenCalledTimes(1);
  });

  it("repassa o ref à pilha (o alvo do voo)", () => {
    const { p } = montar();
    const ref = p.pilhaRef as { current: HTMLDivElement | null };
    expect(ref.current?.id).toBe("ctx-pilha");
  });
});
