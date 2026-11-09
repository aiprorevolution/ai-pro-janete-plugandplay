import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Disco, Pilha, type FasePilha } from "@/features/plataforma/contexto/Pilha";
import {
  DURACAO_SAIDA_MS,
  ESPERA_FOCO_MS,
  TEMPOS_ENTRADA,
  TEMPOS_ENTRADA_CURTA,
  useEntradaESaida,
  type FaseEntrada,
} from "@/features/plataforma/contexto/voo";

// Task F2 da spec do Contexto (docs/spec-contexto.md): a pilha nas 4 fases, o disco solto, e a entrada e
// a saída com o VooJanete simulado. O botão do canto (#janete-gatilho) é um botão de verdade no document.

const controle = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
const reduzido = vi.hoisted(() => ({ valor: false }));

vi.mock("@/components/janete/VooJanete", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/janete/VooJanete")>();
  return { ...real, useVooJanete: () => controle, movimentoReduzido: () => reduzido.valor };
});

const MARCA = "data-ctx-escondido";
const FASES: FasePilha[] = ["plano", "inclinada", "separada", "recolhida"];

/* ---------- caixas na tela: o canto e o lugar da pilha ---------- */

function caixa(x: number, y: number, lado: number): DOMRect {
  const r = { left: x - lado / 2, top: y - lado / 2, width: lado, height: lado };
  return { ...r, x: r.left, y: r.top, right: r.left + lado, bottom: r.top + lado, toJSON: () => r } as DOMRect;
}

const CANTO = { x: 50, y: 854, tamanho: 52 };
const PILHA = { x: 700, y: 450, tamanho: 240 };

/** Um voo que a gente resolve (ou rejeita) na hora certa. */
function adiado() {
  let resolver!: () => void;
  let rejeitar!: (e: Error) => void;
  const promessa = new Promise<void>((ok, erro) => {
    resolver = ok;
    rejeitar = erro;
  });
  return { promessa, resolver, rejeitar };
}

function novoGatilho(): HTMLButtonElement {
  const g = document.createElement("button");
  g.id = "janete-gatilho";
  g.setAttribute("aria-label", "Fale com a Janete");
  document.body.appendChild(g);
  return g;
}

/** A tela de mentira: o gancho e a Pilha, com a fase da entrada traduzida para a da pilha. */
function paraPilha(f: FaseEntrada): FasePilha {
  if (f === "inclinada") return "inclinada";
  if (f === "separada" || f === "ligando" || f === "pronto") return "separada";
  return "plano";
}

function Tela({ primeiraVez }: { primeiraVez: boolean }) {
  const alvo = useRef<HTMLDivElement | null>(null);
  const { fase } = useEntradaESaida({ alvo, primeiraVez });
  return (
    <div data-testid="tela" data-entrada={fase}>
      <Pilha ref={alvo} fase={paraPilha(fase)} d={240} />
    </div>
  );
}

const faseDa = (c: HTMLElement) => c.querySelector("[data-entrada]")?.getAttribute("data-entrada");

async function andar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let gatilho: HTMLButtonElement;

beforeEach(() => {
  reduzido.valor = false;
  controle.ativo = false;
  controle.pousar.mockReset();
  controle.voar.mockReset();
  controle.soltar.mockReset();
  controle.voar.mockImplementation(() => Promise.resolve());
  gatilho = novoGatilho();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.id === "janete-gatilho") return caixa(CANTO.x, CANTO.y, CANTO.tamanho);
    if (this.id === "ctx-pilha") return caixa(PILHA.x, PILHA.y, PILHA.tamanho);
    return caixa(0, 0, 0);
  });
});

afterEach(async () => {
  cleanup();
  // a saída agendada pela desmontagem roda antes de o teste seguinte começar
  if (vi.isFakeTimers()) await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.querySelectorAll('#janete-gatilho, [data-dash="janete"], #area-contexto').forEach((el) => el.remove());
});

/** O lugar da Janete do Dashboard (dashboard/versoes/final), como ele fica quando a tela monta. */
function montarDashboard(): HTMLElement {
  const lugar = document.createElement("span");
  lugar.setAttribute("data-dash", "janete");
  document.body.appendChild(lugar);
  gatilho.setAttribute("data-janete-fora", "");
  return lugar;
}

/* =========================================================
   A pilha
   ========================================================= */

describe("Pilha", () => {
  it.each(FASES)("na fase %s tem o #ctx-pilha e os 3 hubs, e os discos só são botões quando separada", (fase) => {
    const aoClicarDisco = vi.fn();
    const { container } = render(<Pilha fase={fase} d={240} aoClicarDisco={aoClicarDisco} />);
    const pilha = container.querySelector("#ctx-pilha");
    expect(pilha).not.toBeNull();
    expect(pilha).toHaveAttribute("data-fase", fase);
    expect(pilha).toHaveStyle({ "--d": "240px" });

    for (const g of ["oferta", "conversa", "livres"]) {
      const hub = container.querySelector(`#ctx-hub-${g}`);
      expect(hub?.tagName).toBe("SPAN");
      expect(hub).toHaveAttribute("data-hub", g);
    }
    // os 3 discos desenhados, de baixo para cima, e o recorte e a peça só no de cima
    expect([...container.querySelectorAll("[data-disco]")].map((el) => el.getAttribute("data-disco"))).toEqual([
      "livres",
      "conversa",
      "oferta",
    ]);
    expect(container.querySelectorAll('[data-disco="oferta"] [data-parte="peca"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-disco="oferta"] [data-parte="recorte"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-parte="peca"], [data-parte="recorte"]')).toHaveLength(2);

    const botoes = container.querySelectorAll("button[data-camada]");
    if (fase !== "separada") {
      expect(botoes).toHaveLength(0);
      return;
    }
    expect([...botoes].map((b) => b.getAttribute("data-camada"))).toEqual(["oferta", "conversa", "livres"]);
    botoes.forEach((b) => expect(b.getAttribute("aria-label")).toMatch(/Abrir a área/));
    fireEvent.click(container.querySelector('[data-camada="conversa"]')!);
    fireEvent.click(container.querySelector('[data-camada="livres"]')!);
    expect(aoClicarDisco.mock.calls).toEqual([["conversa"], ["livres"]]);
  });

  it("sem aoClicarDisco, nenhum disco vira botão", () => {
    const { container } = render(<Pilha fase="separada" d={200} />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it('o botão data-acao="peca" só existe com aoClicarPeca (e só com a pilha separada)', () => {
    const { container, rerender } = render(<Pilha fase="separada" d={240} aoClicarDisco={() => {}} />);
    expect(container.querySelector('[data-acao="peca"]')).toBeNull();

    const aoClicarPeca = vi.fn();
    rerender(<Pilha fase="separada" d={240} aoClicarDisco={() => {}} aoClicarPeca={aoClicarPeca} pecaAberta={false} />);
    const peca = container.querySelector('[data-acao="peca"]');
    expect(peca).toHaveAttribute("aria-label", "Ensinar algo novo à Janete");
    expect(peca).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(peca!);
    expect(aoClicarPeca).toHaveBeenCalledTimes(1);

    rerender(<Pilha fase="inclinada" d={240} aoClicarDisco={() => {}} aoClicarPeca={aoClicarPeca} />);
    expect(container.querySelector('[data-acao="peca"]')).toBeNull();
  });

  it("os rótulos dos discos podem vir da tela, com a contagem", () => {
    const { container } = render(
      <Pilha
        fase="separada"
        d={240}
        aoClicarDisco={() => {}}
        rotulos={{ oferta: "Disco de cima, Sobre a oferta: 4 de 4 campos com conteúdo. Abrir a área." }}
      />,
    );
    expect(container.querySelector('[data-camada="oferta"]')).toHaveAttribute(
      "aria-label",
      "Disco de cima, Sobre a oferta: 4 de 4 campos com conteúdo. Abrir a área.",
    );
    expect(container.querySelector('[data-camada="livres"]')).toHaveAttribute(
      "aria-label",
      "Disco de baixo, Perguntas livres. Abrir a área.",
    );
  });

  it("dormindo e destaque ficam na pilha; a fase anterior e a mola assentada também", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Pilha fase="recolhida" d={240} dormindo destaque="livres" />);
    const pilha = container.querySelector("#ctx-pilha")!;
    expect(pilha).toHaveAttribute("data-dormindo");
    expect(pilha).toHaveAttribute("data-destaque", "livres");
    expect(pilha).not.toHaveAttribute("data-de");

    rerender(<Pilha fase="separada" d={240} destaque={null} />);
    expect(pilha).not.toHaveAttribute("data-dormindo");
    expect(pilha).not.toHaveAttribute("data-destaque");
    expect(pilha).toHaveAttribute("data-de", "recolhida");
    expect(pilha).not.toHaveAttribute("data-assentada");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(pilha).toHaveAttribute("data-assentada");
  });

  it("montada já separada (a entrada curta), a mola já está assentada", () => {
    const { container } = render(<Pilha fase="separada" d={240} />);
    expect(container.querySelector("#ctx-pilha")).toHaveAttribute("data-assentada");
  });
});

describe("Disco", () => {
  it("o de cima tem o recorte e a peça; o do meio e o de baixo, não", () => {
    const { container } = render(
      <>
        <Disco grupo="oferta" d={200} idFace="face-oferta" />
        <Disco grupo="conversa" d={64} />
        <Disco grupo="livres" d={64} dormindo />
      </>,
    );
    const oferta = container.querySelector('[data-disco="oferta"]')!;
    expect(oferta).toHaveAttribute("aria-hidden", "true");
    expect(oferta).toHaveAttribute("data-com-peca");
    expect(oferta).toHaveStyle({ "--d": "200px" });
    expect(oferta.querySelectorAll('[data-parte="peca"]')).toHaveLength(1);
    expect(oferta.querySelectorAll('[data-parte="recorte"]')).toHaveLength(1);
    expect(container.querySelector("#face-oferta")).not.toBeNull();

    const conversa = container.querySelector('[data-disco="conversa"]')!;
    expect(conversa).not.toHaveAttribute("data-com-peca");
    expect(conversa.querySelector('[data-parte="peca"], [data-parte="recorte"]')).toBeNull();

    expect(container.querySelector('[data-disco="livres"]')).toHaveAttribute("data-dormindo");
  });

  it("comPeca manda: tira a peça do de cima e põe em outro", () => {
    const { container } = render(
      <>
        <Disco grupo="oferta" d={64} comPeca={false} />
        <Disco grupo="livres" d={64} comPeca />
      </>,
    );
    expect(container.querySelector('[data-disco="oferta"] [data-parte="peca"]')).toBeNull();
    expect(container.querySelector('[data-disco="livres"] [data-parte="peca"]')).not.toBeNull();
    expect(container.querySelector('[data-disco="livres"] [data-parte="recorte"]')).not.toBeNull();
  });
});

/* =========================================================
   A entrada e a saída
   ========================================================= */

describe("useEntradaESaida", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("entrada completa: voa do canto até o centro da pilha, pousa plana, desmonta e fica pronta", async () => {
    expect(typeof requestAnimationFrame).toBe("function");
    const ida = adiado();
    controle.voar.mockImplementationOnce(() => ida.promessa);

    const { container } = render(<Tela primeiraVez />);
    expect(faseDa(container)).toBe("casa");
    expect(gatilho).toHaveAttribute(MARCA);
    expect(controle.pousar).toHaveBeenCalledWith(CANTO, "acordada");

    await andar(20);
    expect(faseDa(container)).toBe("voo");
    expect(controle.voar).toHaveBeenCalledTimes(1);
    expect(controle.voar).toHaveBeenCalledWith(PILHA, { estado: "acordada", duracaoMs: 950 });
    expect(controle.soltar).not.toHaveBeenCalled();

    await act(async () => {
      ida.resolver();
    });
    expect(faseDa(container)).toBe("plano");
    expect(controle.soltar).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#ctx-pilha")).toHaveAttribute("data-fase", "plano");

    await andar(TEMPOS_ENTRADA.inclinada);
    expect(faseDa(container)).toBe("inclinada");
    await andar(TEMPOS_ENTRADA.separada - TEMPOS_ENTRADA.inclinada);
    expect(faseDa(container)).toBe("separada");
    await andar(TEMPOS_ENTRADA.ligando - TEMPOS_ENTRADA.separada);
    expect(faseDa(container)).toBe("ligando");
    await andar(TEMPOS_ENTRADA.pronto - TEMPOS_ENTRADA.ligando);
    expect(faseDa(container)).toBe("pronto");
    // uns 3 s do clique até pronta: o voo de 950 ms mais a desmontagem
    expect(950 + TEMPOS_ENTRADA.pronto).toBeGreaterThanOrEqual(2600);
    expect(950 + TEMPOS_ENTRADA.pronto).toBeLessThanOrEqual(3400);
    expect(gatilho).toHaveAttribute(MARCA);
  });

  it("saída: pousa o símbolo pequeno no lugar da pilha, voa ao canto em 300 ms e só então devolve o botão", async () => {
    const { container, unmount } = render(<Tela primeiraVez={false} />);
    await andar(TEMPOS_ENTRADA_CURTA.pronto);
    expect(faseDa(container)).toBe("pronto");

    const volta = adiado();
    controle.voar.mockImplementationOnce(() => volta.promessa);
    unmount();
    expect(controle.pousar).toHaveBeenCalledTimes(1);
    expect(controle.pousar).toHaveBeenCalledWith({ x: PILHA.x, y: PILHA.y, tamanho: PILHA.tamanho * 0.45 }, "acordada");
    expect(gatilho).toHaveAttribute(MARCA);

    await andar(0);
    expect(controle.voar).toHaveBeenCalledWith(CANTO, { estado: "acordada", duracaoMs: DURACAO_SAIDA_MS });
    expect(gatilho).toHaveAttribute(MARCA);

    await act(async () => {
      volta.resolver();
    });
    expect(gatilho).not.toHaveAttribute(MARCA);
    expect(controle.soltar).toHaveBeenCalledTimes(1);
  });

  it("o botão do canto volta mesmo se o voo de saída falhar", async () => {
    const { unmount } = render(<Tela primeiraVez={false} />);
    await andar(TEMPOS_ENTRADA_CURTA.pronto);
    controle.voar.mockImplementationOnce(() => Promise.reject(new Error("voo caiu")));
    unmount();
    expect(gatilho).toHaveAttribute(MARCA);
    await andar(0);
    expect(controle.voar).toHaveBeenCalledTimes(1);
    expect(gatilho).not.toHaveAttribute(MARCA);
    expect(controle.soltar).toHaveBeenCalledTimes(1);
  });

  it("o voo de entrada falhando: a pilha fica pronta, o botão segue escondido e volta ao desmontar", async () => {
    controle.voar.mockImplementationOnce(() => Promise.reject(new Error("voo caiu")));
    const { container, unmount } = render(<Tela primeiraVez />);
    await andar(20);
    expect(faseDa(container)).toBe("pronto");
    expect(controle.soltar).toHaveBeenCalledTimes(1);
    expect(gatilho).toHaveAttribute(MARCA);

    controle.voar.mockImplementationOnce(() => Promise.reject(new Error("de novo")));
    unmount();
    await andar(0);
    expect(gatilho).not.toHaveAttribute(MARCA);
  });

  it("sair no meio do voo de entrada: o símbolo só muda de rumo e volta ao canto", async () => {
    const ida = adiado();
    controle.voar.mockImplementationOnce(() => ida.promessa);
    const { container, unmount } = render(<Tela primeiraVez />);
    await andar(20);
    expect(faseDa(container)).toBe("voo");

    unmount();
    expect(controle.pousar).toHaveBeenCalledTimes(1); // só o do canto, na entrada
    await andar(0);
    expect(controle.voar).toHaveBeenLastCalledWith(CANTO, { estado: "acordada", duracaoMs: DURACAO_SAIDA_MS });
    await act(async () => {
      ida.resolver();
    });
    expect(gatilho).not.toHaveAttribute(MARCA);
    expect(controle.soltar).toHaveBeenCalledTimes(1);
  });

  it("entrada curta: começa separada, liga e fica pronta em uns 600 ms, sem voo", async () => {
    const { container } = render(<Tela primeiraVez={false} />);
    expect(faseDa(container)).toBe("separada");
    expect(gatilho).toHaveAttribute(MARCA);
    await andar(TEMPOS_ENTRADA_CURTA.ligando);
    expect(faseDa(container)).toBe("ligando");
    await andar(TEMPOS_ENTRADA_CURTA.pronto - TEMPOS_ENTRADA_CURTA.ligando);
    expect(faseDa(container)).toBe("pronto");
    expect(TEMPOS_ENTRADA_CURTA.pronto).toBeLessThanOrEqual(700);
    expect(controle.pousar).not.toHaveBeenCalled();
    expect(controle.voar).not.toHaveBeenCalled();
  });

  it("movimento reduzido: pronta na hora, nada voa, e o botão volta ao desmontar", async () => {
    reduzido.valor = true;
    const { container, unmount } = render(<Tela primeiraVez />);
    expect(faseDa(container)).toBe("pronto");
    expect(gatilho).toHaveAttribute(MARCA);
    unmount();
    await andar(0);
    expect(controle.pousar).not.toHaveBeenCalled();
    expect(controle.voar).not.toHaveBeenCalled();
    expect(gatilho).not.toHaveAttribute(MARCA);
  });

  it("outro símbolo ainda em voo: sem voo, só a desmontagem", async () => {
    controle.ativo = true;
    const { container } = render(<Tela primeiraVez />);
    expect(faseDa(container)).toBe("plano");
    expect(controle.pousar).not.toHaveBeenCalled();
    await andar(TEMPOS_ENTRADA.pronto);
    expect(faseDa(container)).toBe("pronto");
  });

  it("o Layout monta o botão de novo: o novo também fica escondido, e volta no fim", async () => {
    const { unmount } = render(<Tela primeiraVez={false} />);
    gatilho.remove();
    const novo = novoGatilho();
    await act(async () => {
      await Promise.resolve();
    });
    expect(novo).toHaveAttribute(MARCA);
    unmount();
    await andar(DURACAO_SAIDA_MS);
    expect(novo).not.toHaveAttribute(MARCA);
  });

  it("não devolve o que outra tela escondeu: o estilo e o aria-hidden dela ficam como estão", async () => {
    gatilho.style.visibility = "hidden";
    gatilho.setAttribute("aria-hidden", "true");
    const { unmount } = render(<Tela primeiraVez={false} />);
    expect(gatilho).toHaveAttribute(MARCA);
    unmount();
    await andar(DURACAO_SAIDA_MS);
    expect(gatilho).not.toHaveAttribute(MARCA);
    expect(gatilho.style.visibility).toBe("hidden");
    expect(gatilho).toHaveAttribute("aria-hidden", "true");
  });

  it("voltar ao Contexto durante a saída: o botão segue escondido até a tela nova sair", async () => {
    const volta = adiado();
    const primeira = render(<Tela primeiraVez={false} />);
    controle.voar.mockImplementationOnce(() => volta.promessa);
    primeira.unmount();
    await andar(0);
    const segunda = render(<Tela primeiraVez={false} />);
    await act(async () => {
      volta.resolver();
    });
    expect(gatilho).toHaveAttribute(MARCA);
    segunda.unmount();
    await andar(DURACAO_SAIDA_MS);
    expect(gatilho).not.toHaveAttribute(MARCA);
  });

  it("ir para o Dashboard: a saída não voa nem solta o símbolo dele, e só a nossa marca sai do botão", async () => {
    const { container, unmount } = render(<Tela primeiraVez={false} />);
    await andar(TEMPOS_ENTRADA_CURTA.pronto);
    expect(faseDa(container)).toBe("pronto");

    // a limpeza ainda pousa no lugar da pilha (o Dashboard monta no mesmo commit, depois dela)
    unmount();
    expect(controle.pousar).toHaveBeenCalledTimes(1);
    // e o Dashboard monta: pousa o símbolo dele e esconde o botão com o atributo dele
    montarDashboard();
    await andar(DURACAO_SAIDA_MS);
    expect(controle.voar).not.toHaveBeenCalled();
    expect(controle.soltar).not.toHaveBeenCalled();
    expect(gatilho).not.toHaveAttribute(MARCA);
    expect(gatilho).toHaveAttribute("data-janete-fora");
  });

  it("sair no meio do voo de entrada para o Dashboard: o voo não muda de rumo nem é solto", async () => {
    const ida = adiado();
    controle.voar.mockImplementationOnce(() => ida.promessa);
    const { unmount } = render(<Tela primeiraVez />);
    await andar(20);
    unmount();
    montarDashboard();
    await andar(0);
    expect(controle.voar).toHaveBeenCalledTimes(1); // só o da ida
    await act(async () => {
      ida.resolver();
    });
    expect(controle.soltar).not.toHaveBeenCalled();
    expect(gatilho).not.toHaveAttribute(MARCA);
  });

  it("vindo do Dashboard (a volta dele ainda no ar): a 1ª entrada não voa nem pousa, só desmonta", async () => {
    gatilho.setAttribute("data-janete-fora", "");
    const { container, unmount } = render(<Tela primeiraVez />);
    expect(faseDa(container)).toBe("plano");
    expect(controle.pousar).not.toHaveBeenCalled();
    await andar(TEMPOS_ENTRADA.pronto);
    expect(faseDa(container)).toBe("pronto");
    expect(gatilho).toHaveAttribute(MARCA);

    // e se sair com a volta dele ainda no ar, também não pousa por cima
    unmount();
    expect(controle.pousar).not.toHaveBeenCalled();
    await andar(DURACAO_SAIDA_MS);
    expect(controle.voar).not.toHaveBeenCalled();
    expect(controle.soltar).not.toHaveBeenCalled();
    expect(gatilho).not.toHaveAttribute(MARCA);
  });

  it("o Layout recria o botão e o foco se perde: ele vai para o h1 da área", async () => {
    const h1 = document.createElement("h1");
    h1.id = "area-contexto";
    h1.tabIndex = -1;
    document.body.appendChild(h1);
    render(<Tela primeiraVez={false} />);

    gatilho.remove();
    const novo = novoGatilho();
    await andar(0);
    expect(novo).toHaveAttribute(MARCA);
    // o focar("janete-gatilho") do Layout, que não pega num botão escondido
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await andar(ESPERA_FOCO_MS);
    expect(document.activeElement).toBe(h1);
  });

  it("o botão recriado com o foco em outro lugar: o foco fica onde está", async () => {
    const outro = document.createElement("button");
    document.body.appendChild(outro);
    render(<Tela primeiraVez={false} />);
    gatilho.remove();
    novoGatilho();
    await andar(0);
    outro.focus();
    await andar(ESPERA_FOCO_MS);
    expect(document.activeElement).toBe(outro);
    outro.remove();
  });

  it("StrictMode: a desmontagem de mentira não dispara a saída nem um voo a mais", async () => {
    const ida = adiado();
    controle.voar.mockImplementationOnce(() => ida.promessa);
    const { container } = render(
      <StrictMode>
        <Tela primeiraVez />
      </StrictMode>,
    );
    await andar(20);
    expect(faseDa(container)).toBe("voo");
    expect(controle.voar).toHaveBeenCalledTimes(1);
    expect(controle.voar).toHaveBeenCalledWith(PILHA, { estado: "acordada", duracaoMs: 950 });
    expect(controle.soltar).not.toHaveBeenCalled();
    expect(gatilho).toHaveAttribute(MARCA);

    await act(async () => {
      ida.resolver();
    });
    await andar(TEMPOS_ENTRADA.pronto);
    expect(faseDa(container)).toBe("pronto");
    expect(controle.voar).toHaveBeenCalledTimes(1);
    expect(gatilho).toHaveAttribute(MARCA);
  });
});
