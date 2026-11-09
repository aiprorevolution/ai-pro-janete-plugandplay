import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL, gravarEstadoOnboarding, limparEstadoOnboarding } from "@/features/onboarding/estado";
import { PalcoContexto } from "@/features/onboarding/palco";
import { EtapaPreparando } from "@/features/onboarding/preparando";
import { duracaoFala, TEMPOS_PREPARO } from "@/features/onboarding/preparando/EtapaPreparando";
import { FALA_FINAL } from "@/features/onboarding/preparando/passos";

const voo = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
const medir = vi.hoisted(() => ({
  ponto: null as null | { x: number; y: number; tamanho: number },
  rolou: [] as unknown[],
  reduzido: false,
}));
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return {
    ...real,
    useVooJanete: () => voo,
    medirJanete: () => medir.ponto,
    rolarAteEMedir: (alvo: unknown) => {
      medir.rolou.push(typeof alvo === "string" ? alvo : (alvo as HTMLElement | null)?.id);
      return Promise.resolve(medir.ponto);
    },
    movimentoReduzido: () => medir.reduzido,
    esperarElemento: (id: string) => Promise.resolve(document.getElementById(id)),
  };
});

async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 50) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(50, ms - feito)));
  }
}

function montar({ estrito = false } = {}) {
  const avancar = vi.fn();
  const palco = { janeteNoPalco: vi.fn(), anunciar: vi.fn(), recolherBarra: vi.fn() };
  const etapa = (
    <PalcoContexto.Provider value={palco}>
      <EtapaPreparando avancar={avancar} voltar={() => {}} />
    </PalcoContexto.Provider>
  );
  render(estrito ? <StrictMode>{etapa}</StrictMode> : etapa);
  return { avancar, palco };
}

const secao = () => document.querySelector('[data-etapa="preparando"]') as HTMLElement;
const simbolo = () => document.querySelector("#p-simbolo [data-estado]");
const estadoDoSimbolo = () => simbolo()?.getAttribute("data-estado") ?? "";
const textoAtivo = () =>
  Array.from(document.querySelectorAll('[data-fase="ativo"][aria-hidden="false"]')).map((el) => el.textContent);
const escondido = (el: Element | null) => !!el && /escondido/.test(el.className);
const titulo = () => document.getElementById("p-titulo");

/** 4d: na frase final, título, subtítulo, passos, fio e contador somem; fica só o símbolo e a fala. */
function soFicaAFala() {
  const resto = {
    titulo: titulo(),
    subtitulo: document.querySelector("[class*='sub']"),
    passos: document.querySelector("[class*='agora']"),
    fio: document.querySelector("[class*='fio']"),
    contador: document.querySelector("[class*='conta']:not([class*='contaVoo'])"),
  };
  for (const [nome, el] of Object.entries(resto)) {
    expect(el, nome).not.toBeNull();
    expect(el?.hasAttribute("data-some"), nome).toBe(true);
  }
  const fala = document.querySelector("[data-fala-final]");
  // a fala fica fora dos passos (que somem) e no estilo grande, como o título do despertar
  expect(fala?.closest("[data-some]")).toBeNull();
  expect(fala?.querySelector("p")?.className).toMatch(/falaT/);
  expect(fala?.textContent).toBe(FALA_FINAL);
  // o símbolo continua à vista
  expect(document.getElementById("p-simbolo")?.closest("[data-some]")).toBeNull();
  expect(document.getElementById("p-simbolo")?.className).not.toMatch(/oculto/);
}

/** Antes da frase final, nada está marcado para sumir. */
const nadaSome = () => expect(document.querySelectorAll("[data-some]").length).toBe(0);

const PALAVRAS_ABERTURA_PADRAO =
  "Preparando a sua plataforma Estou juntando tudo o que você escolheu. Leva poucos segundos.".split(" ").length;
const FIM_DA_FALA = duracaoFala(PALAVRAS_ABERTURA_PADRAO) + TEMPOS_PREPARO.depoisDaFala;
const FALA_FINAL_MS = duracaoFala(FALA_FINAL.split(" ").length);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  limparEstadoOnboarding();
  voo.ativo = false;
  medir.ponto = null;
  medir.rolou = [];
  medir.reduzido = false;
  for (const f of [voo.pousar, voo.voar, voo.soltar]) f.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("etapa preparando", () => {
  it("sem o brilho azul no fundo (4a)", () => {
    montar();
    expect(document.querySelector('[class*="halo"]')).toBeNull();
  });

  it("ela fala o título e o texto, depois mostra os 5 passos um por vez com o detalhe das escolhas reais", async () => {
    gravarEstadoOnboarding({
      ...ESTADO_INICIAL,
      etapa: "preparando",
      conexao: { modo: "naooficial", gateway: "zapi", rotulo: "+55 11 98888-7777" },
      cerebro: { provedor: "anthropic", modelo: "claude-sonnet-5-5", ultimos4: "AB12" },
      conversa: {
        respostas: {
          empresa_oferta: "Casa Verde Solar. Energia solar para casas",
          tom_voz: "Próximo e direto, sem formalidade.",
          horario: "Segunda a sexta, das 8h às 18h",
        },
        confirmado: true,
      },
    });
    const { avancar, palco } = montar();

    // fala: o símbolo no estado "fala", o texto palavra por palavra, os passos ainda escondidos
    expect(secao().dataset["fase"]).toBe("fala");
    expect(estadoDoSimbolo()).toBe("fala");
    expect(screen.getByRole("heading", { level: 1, name: "Preparando a sua plataforma" })).toBeInTheDocument();
    expect(titulo()?.querySelectorAll('[class*="palavra"]').length).toBe(4);
    expect(document.querySelector("p")?.textContent).toBe(
      "Estou montando tudo para Casa Verde Solar. Leva poucos segundos.",
    );
    expect(escondido(document.querySelector("[class*='agora']"))).toBe(true);
    expect(textoAtivo()).toEqual([]);
    expect(palco.janeteNoPalco).toHaveBeenCalledWith(true);

    const palavras = "Preparando a sua plataforma Estou montando tudo para Casa Verde Solar. Leva poucos segundos.";
    await passar(duracaoFala(palavras.split(" ").length) + TEMPOS_PREPARO.depoisDaFala + 50);

    // preparo: volta para "carregando" e o primeiro passo aparece
    expect(secao().dataset["fase"]).toBe("preparo");
    expect(estadoDoSimbolo()).not.toBe("fala");
    expect(screen.getByText("Passo 1 de 5")).toBeInTheDocument();
    expect(textoAtivo()).toEqual(["Escrevendo meu jeito de falarTom: próximo e direto, sem formalidade"]);
    expect(palco.anunciar).toHaveBeenLastCalledWith("Escrevendo meu jeito de falar…");

    await passar(1250);
    expect(textoAtivo()).toEqual(["Ligando o WhatsAppZ-API"]);
    await passar(1250);
    expect(textoAtivo()).toEqual(["Guardando o Contexto da empresa3 respostas viram o meu Contexto"]);
    await passar(1250);
    expect(textoAtivo()).toEqual(["Organizando seus contatosA lista começa vazia e cresce com cada lead"]);
    await passar(1250);
    expect(textoAtivo()).toEqual([expect.stringMatching(/^Abrindo a sua plataformaPensando com o Claude Sonnet/)]);
    await passar(1250);
    expect(screen.getByRole("heading", { level: 1, name: "Sua plataforma está pronta" })).toBeInTheDocument();
    expect(screen.getByText("5 de 5 concluídos")).toBeInTheDocument();
    nadaSome();

    // sem como medir o símbolo (sem layout): ela fala a frase final e só depois avança, sem pousar
    await passar(1700 + 50);
    expect(secao().dataset["fase"]).toBe("despede");
    expect(textoAtivo()).toEqual([FALA_FINAL]);
    expect(palco.anunciar).toHaveBeenLastCalledWith(FALA_FINAL);
    soFicaAFala();
    expect(document.querySelectorAll("[data-fala-final] [class*='palavra']").length).toBe(FALA_FINAL.split(" ").length);
    expect(palco.recolherBarra).toHaveBeenCalledWith(true);
    expect(avancar).not.toHaveBeenCalled();
    await passar(FALA_FINAL_MS + TEMPOS_PREPARO.leitura - 200);
    expect(avancar).not.toHaveBeenCalled();
    await passar(300);
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).not.toHaveBeenCalled();
  });

  it("sem escolhas, usa os textos padrão do F", () => {
    montar();
    expect(screen.getByText("Com base na nossa conversa")).toBeInTheDocument();
    expect(screen.getByText("Assim que você conectar, em Configuração")).toBeInTheDocument();
    expect(screen.getByText("O que você me contar vira o meu Contexto")).toBeInTheDocument();
    expect(screen.getByText("Quase lá")).toBeInTheDocument();
    expect(document.querySelectorAll("p")[0]?.textContent).toBe(
      "Estou juntando tudo o que você escolheu. Leva poucos segundos.",
    );
  });

  it("vindo do chat: nada de texto até pousar (medido com rolarAteEMedir); no fim suga as contas, fala e então segue", async () => {
    voo.ativo = true;
    medir.ponto = { x: 720, y: 300, tamanho: 112 };
    let chegar: () => void = () => {};
    voo.voar.mockImplementationOnce(() => new Promise<void>((r) => (chegar = r)));
    const { avancar, palco } = montar();

    // antes do pouso: símbolo escondido, título, texto e passos escondidos
    expect(document.getElementById("p-simbolo")?.className).toMatch(/oculto/);
    expect(secao().dataset["fase"]).toBe("chega");
    await passar(50);
    expect(medir.rolou).toContain("p-simbolo");
    expect(voo.voar).toHaveBeenCalledWith({ x: 720, y: 300, tamanho: 112 }, { duracaoMs: 950, estado: "carregando" });
    expect(escondido(titulo())).toBe(true);
    expect(escondido(document.querySelector("[class*='agora']"))).toBe(true);

    // pousou: aparece o texto, como fala
    await act(async () => chegar());
    expect(voo.soltar).toHaveBeenCalledTimes(1);
    expect(document.getElementById("p-simbolo")?.className).not.toMatch(/oculto/);
    expect(secao().dataset["fase"]).toBe("fala");
    expect(escondido(titulo())).toBe(false);
    expect(estadoDoSimbolo()).toBe("fala");

    // fala + 5 passos de 1250 ms + 1700 ms até a Janete puxar o fio
    await passar(FIM_DA_FALA + 1250 * 5 + 1700 + 50);
    expect(document.querySelectorAll('body > span[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(palco.recolherBarra).toHaveBeenCalledWith(true);
    expect(secao().dataset["fase"]).toBe("fim");
    expect(textoAtivo()).toEqual([]);
    // as contas saem dos nós: o fio ainda está na tela
    nadaSome();

    // as contas chegam nela; então ela fala a frase final
    await passar(4 * 90 + 40 + 780 + 300 + 50);
    expect(document.querySelectorAll('body > span[aria-hidden="true"]').length).toBe(0);
    expect(secao().dataset["fase"]).toBe("despede");
    expect(textoAtivo()).toEqual([FALA_FINAL]);
    soFicaAFala();
    expect(estadoDoSimbolo()).toBe("fala");
    expect(avancar).not.toHaveBeenCalled();
    expect(voo.pousar).not.toHaveBeenCalled();

    // terminou a frase e a pausa: fica em trânsito e a casca abre a plataforma
    await passar(FALA_FINAL_MS + TEMPOS_PREPARO.leitura + 50);
    expect(voo.pousar).toHaveBeenCalledWith({ x: 720, y: 300, tamanho: 112 }, "acordada");
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("com movimento reduzido, tudo aparece direto, sem fala animada", async () => {
    medir.reduzido = true;
    const { avancar, palco } = montar();
    await passar(50);
    expect(secao().dataset["fase"]).toBe("preparo");
    expect(escondido(titulo())).toBe(false);
    expect(titulo()?.querySelectorAll('[class*="palavra"]').length).toBe(0);
    expect(textoAtivo()).toEqual(["Escrevendo meu jeito de falarCom base na nossa conversa"]);

    await passar(380 * 5 + 120 + 50);
    expect(secao().dataset["fase"]).toBe("despede");
    expect(textoAtivo()).toEqual([FALA_FINAL]);
    expect(document.querySelector("[data-fala-final] [class*='palavra']")).toBeNull();
    soFicaAFala();
    // com movimento reduzido a barra de cima também sai na frase final
    expect(palco.recolherBarra).toHaveBeenCalledWith(true);
    expect(avancar).not.toHaveBeenCalled();
    await passar(TEMPOS_PREPARO.leituraReduzida + 50);
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).not.toHaveBeenCalled();
  });

  it("na montagem dupla do React (StrictMode), a chegada roda uma vez só", async () => {
    voo.ativo = true;
    medir.ponto = { x: 720, y: 300, tamanho: 112 };
    const { avancar } = montar({ estrito: true });
    await passar(50);
    expect(voo.voar).toHaveBeenCalledTimes(1);
    expect(voo.soltar).toHaveBeenCalledTimes(1);
    expect(secao().dataset["fase"]).toBe("fala");

    await passar(FIM_DA_FALA + 1250 * 5 + 1700 + 4 * 90 + 40 + 780 + 300 + FALA_FINAL_MS + TEMPOS_PREPARO.leitura + 200);
    expect(voo.voar).toHaveBeenCalledTimes(1);
    expect(voo.soltar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).toHaveBeenCalledTimes(1);
    expect(avancar).toHaveBeenCalledTimes(1);
  });
});
