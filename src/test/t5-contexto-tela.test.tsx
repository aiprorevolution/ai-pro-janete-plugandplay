import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaContexto } from "@/features/plataforma/contexto";
import { lerContexto, reiniciarContexto } from "@/features/plataforma/contexto/loja";
import { TEMPOS_ENTRADA, TEMPOS_ENTRADA_CURTA } from "@/features/plataforma/contexto/voo";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";
import { Route } from "@/routes/app/contexto";

// Task C4 da spec do Contexto (docs/spec-contexto.md): a tela que junta tudo e a rota. O VooJanete é
// simulado (o voo resolve na hora); sem medidas (jsdom), não há passagem animada: troca na hora.

const controle = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
const reduzido = vi.hoisted(() => ({ valor: false }));

vi.mock("@/components/janete/VooJanete", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/janete/VooJanete")>();
  return { ...real, useVooJanete: () => controle, movimentoReduzido: () => reduzido.valor };
});

const matchMediaOriginal = window.matchMedia;

/** Tela estreita (celular): só a consulta de largura da casca casa. */
function telaEstreita(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query === "(max-width: 899px)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function montar(papel: Papel = "admin", Tela: ComponentType = TelaContexto) {
  return render(
    <ProvedorPapel inicial={papel}>
      <Tela />
    </ProvedorPapel>,
  );
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);

/** Clica e deixa os timers curtos da tela (foco, fases da volta) correrem. */
async function clicar(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el!);
  });
}

beforeEach(() => {
  reiniciarContexto({ jaEntrou: true });
  reduzido.valor = false;
  controle.pousar.mockClear();
  controle.voar.mockClear();
  controle.soltar.mockClear();
});

afterEach(() => {
  cleanup();
  // a saída do Contexto (voo.ts) devolve o botão do canto num timer: com o relógio falso, ele corre aqui
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  Object.defineProperty(window, "matchMedia", { writable: true, configurable: true, value: matchMediaOriginal });
  document.getElementById("janete-gatilho")?.remove();
});

describe("a rota /app/contexto", () => {
  it("monta a TelaContexto, com o h1 #area-contexto dentro da VistaArea", () => {
    const Componente = Route.options.component as ComponentType;
    expect(Componente).toBe(TelaContexto);
    montar("admin", Componente);
    const h1 = screen.getByRole("heading", { level: 1, name: "Contexto" });
    expect(h1).toHaveAttribute("id", "area-contexto");
    expect(h1.closest('section[data-area="contexto"]')).not.toBeNull();
    expect($("#ctx-mapa")).not.toBeNull();
    expect($("#ctx-pilha")).not.toBeNull();
  });
});

describe("cabeçalho e rodapé", () => {
  it("mostra os números da versão na tela, a legenda, o rodapé e o histórico", async () => {
    montar();
    const tela = document.body.textContent ?? "";
    expect(tela).toContain("6 de 8 campos");
    expect(tela).toContain("3 itens livres");
    // sem anexos na v1 (decisão 11a)
    expect(tela).not.toMatch(/anexo/i);
    expect(tela).toContain("A Janete sabe");
    expect(tela).toContain("Ainda vazio");
    expect(tela).toContain("Não salvo");
    expect(tela).toContain("Versão 6");
    expect(tela).toContain("Em uso");
    expect(tela).toContain("Cada alteração salva cria uma nova versão.");
    expect(tela).not.toMatch(/Ver como/);

    const hist = $("[data-acao='historico']")!;
    expect(hist).toHaveAttribute("aria-expanded", "false");
    await clicar(hist);
    expect($("#ctx-gaveta")).not.toBeNull();
    expect(hist).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelectorAll("#ctx-gaveta li[data-versao]")).toHaveLength(6);
  });

  it("vendo uma versão antiga: a faixa, os números dela, o rodapé 'Antiga' e sem ensinar", () => {
    reiniciarContexto({ jaEntrou: true, vendo: 3 });
    montar();
    expect(screen.getByRole("region", { name: "Versão antiga" })).toHaveAttribute("data-vendo", "3");
    expect(document.body.textContent).toContain("Antiga · só leitura");
    expect($("[data-acao='ensinar']")).toBeNull();
    expect($("[data-acao='peca']")).toBeNull();
    expect(document.body.textContent).not.toContain("Não salvo");
  });

  it("o atendente não vê '+ Ensinar algo novo', a peça, nem 'Não salvo'", () => {
    montar("atendente");
    expect($("[data-acao='ensinar']")).toBeNull();
    expect($("[data-acao='peca']")).toBeNull();
    expect(document.body.textContent).not.toContain("Não salvo");
    expect($("[data-acao='historico']")).not.toBeNull();
  });
});

describe("mapa ⇄ seção ⇄ mapa", () => {
  it("o disco abre a área no 1º item; Voltar volta ao mapa", async () => {
    montar();
    await clicar($("[data-camada='conversa']"));
    expect($("#ctx-mapa")).toBeNull();
    const secao = $("#ctx-secao")!;
    expect(secao).toHaveAttribute("data-secao", "conversa");
    expect($("[data-item='tom_voz']")).toHaveAttribute("aria-current", "true");
    expect($("#ctx-editor")).not.toBeNull();
    // os hooks do cabeçalho e do rodapé continuam
    expect($("[data-acao='ensinar']")).not.toBeNull();
    expect($("[data-acao='historico']")).not.toBeNull();

    await clicar($("[data-acao='voltar']"));
    expect($("#ctx-secao")).toBeNull();
    expect($("#ctx-mapa")).not.toBeNull();
  });

  it("a linha abre aquele item; data-item troca o editor; data-trocar troca a área; Esc volta", async () => {
    montar();
    await clicar($("[data-campo='preco']"));
    expect($("#ctx-secao")).toHaveAttribute("data-secao", "oferta");
    expect($("#ctx-ed-tit")).toHaveTextContent("Preço");

    await clicar($("[data-item='diferenciais']"));
    expect($("#ctx-ed-tit")).toHaveTextContent("Diferenciais");

    await clicar($("[data-trocar='livres']"));
    expect($("#ctx-secao")).toHaveAttribute("data-secao", "livres");
    expect($("[data-item='livre-1']")).toHaveAttribute("aria-current", "true");

    await act(async () => {
      fireEvent.keyDown($("#ctx-secao")!, { key: "Escape" });
    });
    expect($("#ctx-secao")).toBeNull();
    expect($("#ctx-mapa")).not.toBeNull();
  });

  it("o cartão e o título do grupo abrem as perguntas livres; Esc com o foco fora da seção também volta", async () => {
    montar();
    await clicar($("[data-livre='2']"));
    expect($("[data-item='livre-2']")).toHaveAttribute("aria-current", "true");
    await clicar($("[data-acao='voltar']"));

    await clicar($("[data-grupo='oferta']"));
    expect($("[data-item='empresa_oferta']")).toHaveAttribute("aria-current", "true");
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect($("#ctx-secao")).toBeNull();
  });

  it("na volta, o mapa remonta com a entrada curta (separada, ligando, pronto)", async () => {
    vi.useFakeTimers();
    montar();
    await act(async () => {
      vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.pronto + 50);
    });
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "pronto");
    await clicar($("[data-camada='oferta']"));
    await clicar($("[data-acao='voltar']"));
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "separada");
    await act(async () => {
      vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.ligando + 5);
    });
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "ligando");
    await act(async () => {
      vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.pronto);
    });
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "pronto");
  });
});

describe("a peça e o botão do cabeçalho abrem o mesmo balão", () => {
  it("os dois abrem o #ctx-ens sobre a peça, no mapa", async () => {
    montar();
    const btn = $("[data-acao='ensinar']")!;
    await clicar($("[data-acao='peca']"));
    const peloDisco = $("#ctx-ens");
    expect(peloDisco).not.toBeNull();
    expect(peloDisco!.closest("#ctx-mapa")).not.toBeNull();
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect($("[data-acao='peca']")).toHaveAttribute("aria-expanded", "true");
    expect($("#ctx-mapa")).toHaveAttribute("data-ensina");

    // o botão do cabeçalho fecha o mesmo balão…
    await clicar(btn);
    expect($("#ctx-ens")).toBeNull();
    expect(btn).toHaveAttribute("aria-expanded", "false");

    // …e abre de novo, no mesmo lugar
    await clicar(btn);
    const peloBotao = $("#ctx-ens")!;
    expect(peloBotao.closest("#ctx-mapa")).not.toBeNull();
    expect(document.querySelectorAll("#ctx-ens")).toHaveLength(1);
  });

  it("com a seção aberta, o botão do cabeçalho volta ao mapa e abre o balão", async () => {
    montar();
    await clicar($("[data-campo='horario']"));
    expect($("#ctx-secao")).not.toBeNull();
    await clicar($("[data-acao='ensinar']"));
    expect($("#ctx-secao")).toBeNull();
    expect($("#ctx-ens")!.closest("#ctx-mapa")).not.toBeNull();
  });

  it("ensinar 'atendemos sábado das 9h' liga o raio até Horário e 'Abrir Horário' leva à seção", async () => {
    vi.useFakeTimers();
    montar();
    await act(async () => {
      vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.pronto + 50);
    });
    await clicar($("[data-acao='ensinar']"));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    const caixa = $<HTMLTextAreaElement>("#ens-in")!;
    fireEvent.change(caixa, { target: { value: "atendemos sábado das 9h" } });
    fireEvent.keyDown(caixa, { key: "Enter" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(lerContexto().rascunhos.horario?.extras).toEqual(["atendemos sábado das 9h."]);
    expect($("[data-campo='horario']")).toHaveAttribute("data-situacao", "nao_salvo");

    await clicar($("#ens-abrir"));
    expect($("#ctx-ens")).toBeNull();
    expect($("#ctx-secao")).toHaveAttribute("data-secao", "conversa");
    expect($("#ctx-ed-tit")).toHaveTextContent("Horário");
  });
});

describe("o raio do ensinar", () => {
  function ret(left: number, top: number, width: number, height: number): DOMRect {
    const r = { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height };
    return { ...r, toJSON: () => r } as DOMRect;
  }

  it("corre uma vez: some depois da animação e não corre de novo quando o mapa remonta", async () => {
    vi.useFakeTimers();
    // o mapa com tamanho (as curvas existem); os discos sem tamanho (sem passagem animada)
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.id === "ctx-mapa") return ret(0, 0, 1136, 640);
      if (el.id === "ctx-pilha" || el.hasAttribute("data-ancora")) return ret(442, 204, 252, 252);
      if (el.getAttribute("data-ponta")) return ret(480, 60, 32, 32);
      return ret(0, 0, 0, 0);
    });
    const ensinar = async (texto: string) => {
      const caixa = $<HTMLTextAreaElement>("#ens-in")!;
      fireEvent.change(caixa, { target: { value: texto } });
      fireEvent.keyDown(caixa, { key: "Enter" });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    };
    try {
      montar();
      await act(async () => {
        vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.pronto + 50);
      });
      await clicar($("[data-acao='ensinar']"));
      await act(async () => {
        vi.advanceTimersByTime(10);
      });
      await ensinar("atendemos sábado das 9h");
      expect($("[data-raio='horario']")).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1200);
      });
      expect($("[data-raio]")).toBeNull();

      // de novo, e logo "Abrir Horário": na volta, as curvas reaparecem sem o raio
      await clicar(screen.getByRole("button", { name: "Ensinar outra coisa" }));
      await ensinar("atendemos sábado das 10h");
      expect($("[data-raio='horario']")).not.toBeNull();
      await clicar($("#ens-abrir"));
      expect($("#ctx-secao")).not.toBeNull();
      await clicar($("[data-acao='voltar']"));
      await act(async () => {
        vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.ligando + 5);
      });
      expect($("#ctx-mapa")).toHaveAttribute("data-fase", "ligando");
      expect($("#ctx-mapa path[data-alvo='horario']")).not.toBeNull();
      expect($("[data-raio]")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Esc com o foco no corpo da página", () => {
  it("fecha a gaveta do histórico e o balão de ensinar", async () => {
    vi.useFakeTimers();
    montar();
    await clicar($("[data-acao='historico']"));
    expect($("#ctx-gaveta")).not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect($("#ctx-gaveta")).toBeNull();
    expect(document.activeElement).toBe($("#ctx-historico-btn"));

    await clicar($("[data-acao='ensinar']"));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect($("#ctx-ens")).not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect($("#ctx-ens")).toBeNull();
    expect(document.activeElement).toBe($("#ctx-ensinar-btn"));
  });
});

describe("a entrada", () => {
  it("a 1ª montagem da sessão faz a entrada completa e a 2ª, a curta", async () => {
    reiniciarContexto();
    vi.useFakeTimers();
    const primeira = montar();
    expect(lerContexto().jaEntrou).toBe(false);
    // sem o botão do canto na tela, não há voo: a pilha pousa e se desmonta
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "plano");
    await act(async () => {
      vi.advanceTimersByTime(TEMPOS_ENTRADA.separada + 5);
    });
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "separada");
    await act(async () => {
      vi.advanceTimersByTime(TEMPOS_ENTRADA.pronto);
    });
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "pronto");
    expect(lerContexto().jaEntrou).toBe(true);
    primeira.unmount();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    montar();
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "separada");
    await act(async () => {
      vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.ligando + 5);
    });
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "ligando");
    await act(async () => {
      vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.pronto);
    });
    expect($("#ctx-mapa")).toHaveAttribute("data-fase", "pronto");
  });

  it("o botão do canto fica escondido enquanto a tela está montada e volta ao sair", async () => {
    const gatilho = document.createElement("button");
    gatilho.id = "janete-gatilho";
    document.body.appendChild(gatilho);
    const r = montar();
    expect(gatilho).toHaveAttribute("data-ctx-escondido");
    r.unmount();
    await act(async () => {
      await new Promise((ok) => setTimeout(ok, 20));
    });
    expect(gatilho).not.toHaveAttribute("data-ctx-escondido");
  });
});

describe("celular (matchMedia de tela estreita)", () => {
  it("a linha abre o editor em tela cheia; o título do grupo, só a lista", async () => {
    telaEstreita();
    montar();
    expect($("#ctx-mapa")).toHaveAttribute("data-estreita");

    await clicar($("[data-campo='preco']"));
    expect($("#ctx-secao")).toHaveAttribute("data-estreita");
    expect($("#ctx-editor")).toHaveAttribute("data-estreita");
    expect($("#ctx-ed-tit")).toHaveTextContent("Preço");
    expect($("#ctx-mapa")).toBeNull();

    // o "←" do editor volta para a lista
    await clicar($("#ctx-editor [data-acao='voltar']"));
    expect($("#ctx-editor")).toBeNull();
    expect(document.querySelectorAll("#ctx-secao [data-item]").length).toBeGreaterThan(0);

    await clicar($("#ctx-secao [data-acao='voltar']"));
    expect($("#ctx-mapa")).not.toBeNull();

    await clicar($("[data-grupo='conversa']"));
    expect($("#ctx-secao")).toHaveAttribute("data-secao", "conversa");
    expect($("#ctx-editor")).toBeNull();
    await clicar($("[data-item='objecoes']"));
    expect($("#ctx-editor")).not.toBeNull();
    expect($("#ctx-ed-tit")).toHaveTextContent("Objeções");
  });
});

describe("a passagem animada (com medidas)", () => {
  it("as cópias dos 3 discos andam do mapa até a seção e somem", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const el = this as HTMLElement;
      const disco = el.parentElement?.getAttribute("data-disco");
      const tem = (el.parentElement?.closest("#ctx-pilha") && disco) || el.id.startsWith("ctx-sd-face-");
      const r = tem ? { left: 100, top: 100, width: 200, height: 100 } : { left: 0, top: 0, width: 0, height: 0 };
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
    };
    try {
      montar();
      await act(async () => {
        vi.advanceTimersByTime(TEMPOS_ENTRADA_CURTA.pronto + 50);
      });
      await clicar($("[data-camada='livres']"));
      // o mapa fica montado por baixo, saindo; a seção já está por cima, com os discos escondidos
      expect($("#ctx-mapa")).not.toBeNull();
      expect($("#ctx-secao")).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(20);
      });
      const copias = document.querySelectorAll("[data-copia]");
      expect(copias).toHaveLength(3);
      // o disco clicado anda por último (por cima); os outros 2 encolhem
      expect(copias[2]).toHaveAttribute("data-copia", "livres");
      expect(document.querySelectorAll("[data-copia][data-outro]")).toHaveLength(2);
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(document.querySelectorAll("[data-copia]")).toHaveLength(0);
      expect($("#ctx-mapa")).toBeNull();
      expect($("#ctx-secao")).toHaveAttribute("data-secao", "livres");

      // com movimento reduzido, sem passagem
      await clicar($("[data-acao='voltar']"));
      await act(async () => {
        vi.advanceTimersByTime(20);
      });
      expect(document.querySelectorAll("[data-copia]")).toHaveLength(3);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect($("#ctx-secao")).toBeNull();
      expect($("#ctx-mapa")).toHaveAttribute("data-fase", "pronto");

      reduzido.valor = true;
      await clicar($("[data-camada='oferta']"));
      expect(document.querySelectorAll("[data-copia]")).toHaveLength(0);
      expect($("#ctx-mapa")).toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});
