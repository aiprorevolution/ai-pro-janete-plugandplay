import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ponto = { x: 200, y: 150, tamanho: 144 };
const voo = {
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
};
const reduzido = { valor: false };
// A medida da chegada (rolarAteEMedir): por padrão já vem pronta; um teste a segura para simular a rolagem.
const medida: { promessa: Promise<typeof ponto | null> } = { promessa: Promise.resolve(ponto) };

vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  useVooJanete: () => voo,
  medirJanete: vi.fn(() => ponto),
  rolarAteEMedir: vi.fn(() => medida.promessa),
  movimentoReduzido: () => reduzido.valor,
}));

import { medirJanete, rolarAteEMedir } from "@/components/janete/VooJanete";
import { EtapaDespertar } from "@/features/onboarding/despertar";
import { ESTADO_INICIAL, gravarEstadoOnboarding, lerEstadoOnboarding, limparEstadoOnboarding } from "@/features/onboarding/estado";

// Avança em passos de 20 ms, cada um no seu act: o React pinta entre um passo e outro, como no navegador.
async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 20) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(20, ms - feito));
    });
  }
}

const SEM_VOZ = "Ainda não consigo falar nem escutar áudios. Vamos configurar a chave da ElevenLabs agora.";
const SEM_VOZ_OPENAI = "Já consigo escutar áudios, mas ainda não consigo falar. Vamos configurar a chave da ElevenLabs agora.";
const COM_VOZ =
  "Vou atender os leads da sua empresa no WhatsApp. Antes, quero entender o seu negócio com algumas perguntas rápidas.";

const botaoVoz = () => screen.getByRole("button", { name: /Configurar a ElevenLabs/ });

/** O estado da aba no despertar; `voz` com os 4 últimos da chave de voz, `provedor` do cérebro. */
function naAba({ voz = null, provedor = "anthropic" }: { voz?: string | null; provedor?: "anthropic" | "openai" } = {}) {
  gravarEstadoOnboarding({
    ...ESTADO_INICIAL,
    etapa: "despertar",
    cerebro: { provedor, modelo: "modelo-x", ultimos4: "abcd" },
    voz: { ultimos4: voz, pulou: false },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  voo.ativo = false;
  reduzido.valor = false;
  medida.promessa = Promise.resolve(ponto);
  vi.clearAllMocks();
  limparEstadoOnboarding();
  naAba();
});
afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("EtapaDespertar", () => {
  it("sem voo: acende, fala e no fim mostra o texto e o botão, com o foco nele", async () => {
    const { container } = render(<EtapaDespertar avancar={vi.fn()} voltar={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Oi! Eu sou a Janete." })).toBeInTheDocument();
    expect(container.querySelector("[data-fase]")).toHaveAttribute("data-fase", "acende");
    expect(screen.queryByRole("button", { name: /Configurar a ElevenLabs/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Pular animação" })).toBeInTheDocument();

    await passar(750);
    expect(container.querySelector("[data-fase]")).toHaveAttribute("data-fase", "fala");

    await passar(1650 + 60);
    expect(botaoVoz()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Pular animação" })).toBeNull();
    expect(screen.getByText(SEM_VOZ)).toBeInTheDocument();
  });

  it("Pular animação vai direto ao fim e foca o botão", async () => {
    render(<EtapaDespertar avancar={vi.fn()} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pular animação" }));
    await passar(60);
    expect(botaoVoz()).toHaveFocus();
    expect(voo.soltar).toHaveBeenCalled();
  });

  it("com o símbolo em voo: mede o próprio símbolo, o viajante voa até ele, é solto e só então acende", async () => {
    voo.ativo = true;
    const { container } = render(<EtapaDespertar avancar={vi.fn()} voltar={vi.fn()} />);
    expect(container.querySelector("[data-fase]")).toHaveAttribute("data-fase", "chega");
    expect(container.querySelector("#d-simbolo")).toHaveAttribute("data-oculto");

    await passar(60);
    expect(rolarAteEMedir).toHaveBeenCalledWith("d-simbolo");
    expect(medirJanete).not.toHaveBeenCalled();
    expect(voo.voar).toHaveBeenCalledWith(ponto, { estado: "acordada" });
    expect(voo.soltar).toHaveBeenCalled();
    expect(container.querySelector("[data-fase]")).toHaveAttribute("data-fase", "acende");
  });

  it("com o símbolo em voo: só voa depois de a rolagem parar e a medida chegar", async () => {
    voo.ativo = true;
    let entregar: (p: typeof ponto) => void = () => {};
    medida.promessa = new Promise((r) => (entregar = r));
    const { container } = render(<EtapaDespertar avancar={vi.fn()} voltar={vi.fn()} />);

    await passar(200);
    expect(rolarAteEMedir).toHaveBeenCalledTimes(1);
    expect(voo.voar).not.toHaveBeenCalled();
    expect(container.querySelector("[data-fase]")).toHaveAttribute("data-fase", "chega");

    await act(async () => entregar(ponto));
    await passar(20);
    expect(voo.voar).toHaveBeenCalledWith(ponto, { estado: "acordada" });
    expect(container.querySelector("[data-fase]")).toHaveAttribute("data-fase", "acende");
  });

  it("Pular animação enquanto a página ainda rola: o voo não acontece depois", async () => {
    voo.ativo = true;
    let entregar: (p: typeof ponto) => void = () => {};
    medida.promessa = new Promise((r) => (entregar = r));
    render(<EtapaDespertar avancar={vi.fn()} voltar={vi.fn()} />);
    await passar(60);
    fireEvent.click(screen.getByRole("button", { name: "Pular animação" }));
    expect(voo.soltar).toHaveBeenCalledTimes(1);

    await act(async () => entregar(ponto));
    await passar(60);
    expect(voo.voar).not.toHaveBeenCalled();
    expect(voo.soltar).toHaveBeenCalledTimes(1);
    expect(botaoVoz()).toHaveFocus();
  });
});

describe("EtapaDespertar: sem chave de voz (a Voz vem a seguir)", () => {
  it("Configurar a ElevenLabs: o texto sai, o símbolo pousa em trânsito e a etapa avança uma vez após 180 ms", async () => {
    const avancar = vi.fn();
    const { container } = render(<EtapaDespertar avancar={avancar} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pular animação" }));
    expect(screen.queryByRole("button", { name: /Conversar com a Janete/ })).toBeNull();
    fireEvent.click(botaoVoz());
    // o clique duplo não avança duas vezes
    fireEvent.click(botaoVoz());
    expect(container.querySelector("[data-fase]")).toHaveAttribute("data-fase", "sai");
    expect(avancar).not.toHaveBeenCalled();

    await passar(180);
    expect(medirJanete).toHaveBeenCalledWith("d-simbolo");
    expect(voo.pousar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).toHaveBeenCalledWith(ponto, "acordada");
    expect(avancar).toHaveBeenCalledTimes(1);
    // vai à Voz pelo avancar, não direto à conversa
    expect(lerEstadoOnboarding().etapa).toBe("despertar");
  });

  it("com o cérebro da OpenAI: a frase diz que já escuta áudios, mas ainda não fala", async () => {
    naAba({ provedor: "openai" });
    render(<EtapaDespertar avancar={vi.fn()} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pular animação" }));
    expect(screen.getByText(SEM_VOZ_OPENAI)).toBeInTheDocument();
    expect(screen.queryByText(SEM_VOZ)).toBeNull();
    expect(botaoVoz()).toBeInTheDocument();
  });

  it("com movimento reduzido: chega ao fim em 40 ms e o clique duplo avança uma vez só, sem voo", async () => {
    reduzido.valor = true;
    const avancar = vi.fn();
    render(<EtapaDespertar avancar={avancar} voltar={vi.fn()} />);
    await passar(40);
    fireEvent.click(botaoVoz());
    fireEvent.click(botaoVoz());
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).not.toHaveBeenCalled();
  });
});

describe("EtapaDespertar: com chave de voz (quem voltou)", () => {
  it("mostra o texto e o botão de antes; o clique pousa o símbolo e vai direto à conversa", async () => {
    naAba({ voz: "wxyz" });
    const avancar = vi.fn();
    render(<EtapaDespertar avancar={avancar} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pular animação" }));
    expect(screen.getByText(COM_VOZ)).toBeInTheDocument();
    expect(screen.queryByText(SEM_VOZ)).toBeNull();
    expect(screen.queryByRole("button", { name: /Configurar a ElevenLabs/ })).toBeNull();
    const botao = screen.getByRole("button", { name: /Conversar com a Janete/ });
    fireEvent.click(botao);
    fireEvent.click(botao);

    await passar(180);
    expect(voo.pousar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).toHaveBeenCalledWith(ponto, "acordada");
    expect(avancar).not.toHaveBeenCalled();
    expect(lerEstadoOnboarding().etapa).toBe("conversa");
  });

  it("com o cérebro da OpenAI e a chave de voz: o texto de antes, sem a variante", async () => {
    naAba({ voz: "wxyz", provedor: "openai" });
    render(<EtapaDespertar avancar={vi.fn()} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pular animação" }));
    expect(screen.getByText(COM_VOZ)).toBeInTheDocument();
    expect(screen.queryByText(SEM_VOZ_OPENAI)).toBeNull();
  });

  it("com movimento reduzido: o clique duplo vai à conversa uma vez só, sem voo", async () => {
    naAba({ voz: "wxyz" });
    reduzido.valor = true;
    const avancar = vi.fn();
    render(<EtapaDespertar avancar={avancar} voltar={vi.fn()} />);
    await passar(40);
    const botao = screen.getByRole("button", { name: /Conversar com a Janete/ });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(voo.pousar).not.toHaveBeenCalled();
    expect(avancar).not.toHaveBeenCalled();
    expect(lerEstadoOnboarding().etapa).toBe("conversa");
  });
});
