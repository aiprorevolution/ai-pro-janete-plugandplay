import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaConfiguracao } from "@/features/plataforma/configuracao";
import { CartaoEscuta } from "@/features/plataforma/configuracao/CartaoEscuta";
import { CartaoVoz } from "@/features/plataforma/configuracao/CartaoVoz";
import { TRANSCRITORES } from "@/features/plataforma/configuracao/dados";
import { AVISO_ANTHROPIC_SEM_ESCUTA, lerEscuta, lerVoz } from "@/features/plataforma/configuracao/leitura";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarEstadoInicial, type ChaveIA, type EstadoBase, type ProvedorIA } from "@/features/plataforma/exemplo";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// C2 da escuta com a ElevenLabs (T7): o cartão Escuta vazio com a frase única e os 3 logos, a linha
// "Chave" com "Mesma chave…" nos dois cartões (só para quem administra), o aviso novo do cérebro da
// Anthropic e o diálogo e o aviso de remover a voz quando a Escuta usa a mesma chave.

// Sem movimento: as animações vão direto ao fim (como em t3-configuracao)
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return { ...real, movimentoReduzido: () => true, rolarAteEMedir: () => Promise.resolve(null) };
});

const AGORA = new Date("2026-11-03T15:00:00-03:00");

/** Uma chave de teste (os 4 últimos são inventados, nunca uma chave de verdade). */
function chave(
  finalidade: ChaveIA["finalidade"],
  provedor: ProvedorIA,
  ultimos4: string,
  status: ChaveIA["status"] = "ativa",
): ChaveIA {
  return {
    id: `k-${finalidade}`,
    finalidade,
    provedor,
    modelo: finalidade === "transcricao" && provedor === "elevenlabs" ? "scribe_v2" : finalidade === "voz" ? "" : null,
    status,
    ultimos4,
    ultimo_erro: null,
    validada_em: AGORA.toISOString(),
    atualizada_em: AGORA.toISOString(),
    atualizada_por: null,
  } as ChaveIA;
}

function montarEscuta(chaves: ChaveIA[], admin = true) {
  render(
    <CartaoEscuta
      admin={admin}
      esc={lerEscuta({ chaves }, admin)}
      agora={AGORA}
      bloqueado={false}
      realce={null}
      oculto={false}
      aoConectar={() => {}}
    />,
  );
  return document.getElementById("cfg-card-escuta")!;
}

function montarVoz(chaves: ChaveIA[], admin = true) {
  render(
    <CartaoVoz
      admin={admin}
      voz={lerVoz({ chaves, configuracao: { voz_id: "v1", voz_nome: "Voz de teste" } }, admin)}
      agora={AGORA}
      bloqueado={false}
      realce={null}
      oculto={false}
      aoConectar={() => {}}
    />,
  );
  return document.getElementById("cfg-card-voz")!;
}

describe("Cartão Escuta vazio: uma frase só e os 3 logos (T7)", () => {
  it.each([
    ["só o cérebro da Anthropic", [chave("resposta", "anthropic", "AAAA")]],
    ["o cérebro da OpenAI sem crédito (o que antes trocava a frase)", [chave("resposta", "openai", "AAAA", "sem_credito")]],
    ["a chave da voz inválida", [chave("resposta", "anthropic", "AAAA"), chave("voz", "elevenlabs", "BBBB", "invalida")]],
  ])("%s: a mesma frase", (_nome, chaves) => {
    const cartao = montarEscuta(chaves);
    expect(within(cartao).getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
    expect(cartao).toHaveTextContent("Com uma chave da OpenAI, da Groq ou da ElevenLabs, ela ouve e responde sozinha.");
    expect(cartao.textContent).not.toMatch(/OpenAI ou da Groq/);
    expect(cartao.textContent).not.toMatch(/no cartão Voz da Janete/);
  });

  it("os 3 logos pequenos de TRANSCRITORES, ao lado de \"Conectar uma chave\"", () => {
    const cartao = montarEscuta([chave("resposta", "anthropic", "AAAA")]);
    const conectar = within(cartao).getByRole("button", { name: "Conectar uma chave" });
    const logos = conectar.parentElement!.querySelector('[class*="miniLogos"]')!;
    expect(logos).toHaveAttribute("aria-hidden", "true");
    expect(logos.children).toHaveLength(3);
    expect(TRANSCRITORES.map((t) => t.id)).toEqual(["openai", "groq", "elevenlabs"]);
    const srcs = Array.from(logos.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    // a Groq não tem logo (o "G" no lugar); a OpenAI e a ElevenLabs, sim
    expect(srcs).toEqual([TRANSCRITORES[0]!.logo, TRANSCRITORES[2]!.logo]);
    expect(logos.textContent).toBe("G");
  });
});

describe("Linha \"Chave\": a mesma chave nos dois cartões (E2, P5)", () => {
  const mesma = () => [
    chave("resposta", "anthropic", "AAAA"),
    chave("transcricao", "elevenlabs", "EL11"),
    chave("voz", "elevenlabs", "EL11"),
  ];

  it("Escuta, admin: \"terminada em EL11 · Mesma chave da Voz da Janete\"", () => {
    const cartao = montarEscuta(mesma());
    expect(within(cartao).getByRole("heading", { name: "Ativa, com a ElevenLabs" })).toBeInTheDocument();
    expect(cartao).toHaveTextContent("terminada em EL11 · Mesma chave da Voz da Janete");
  });

  it("Voz, admin: \"terminada em EL11 · Mesma chave da Escuta de áudio\"", () => {
    const cartao = montarVoz(mesma());
    expect(cartao).toHaveTextContent("terminada em EL11 · Mesma chave da Escuta de áudio");
  });

  it("quem não é admin não vê a linha \"Chave\" nem o \"Mesma chave…\"", () => {
    const e = montarEscuta(mesma(), false);
    expect(e.textContent).not.toMatch(/terminada em/);
    expect(e.textContent).not.toMatch(/Mesma chave/);
    const v = montarVoz(mesma(), false);
    expect(v.textContent).not.toMatch(/terminada em/);
    expect(v.textContent).not.toMatch(/Mesma chave/);
  });

  it.each([
    ["finais diferentes", [chave("transcricao", "elevenlabs", "EL11"), chave("voz", "elevenlabs", "EL22")]],
    ["a escuta de outro provedor", [chave("transcricao", "groq", "EL11"), chave("voz", "elevenlabs", "EL11")]],
  ])("%s: sem \"Mesma chave…\" nos dois", (_nome, chaves) => {
    const todas = [chave("resposta", "anthropic", "AAAA"), ...chaves];
    const e = montarEscuta(todas);
    expect(e).toHaveTextContent("terminada em EL11");
    expect(e.textContent).not.toMatch(/Mesma chave/);
    const v = montarVoz(todas);
    expect(v).toHaveTextContent(/terminada em EL(11|22)/);
    expect(v.textContent).not.toMatch(/Mesma chave/);
  });
});

describe("O aviso do cérebro da Anthropic sem escuta (T7)", () => {
  it("cita a ElevenLabs na Escuta", () => {
    expect(AVISO_ANTHROPIC_SEM_ESCUTA).toBe(
      "Com a Anthropic, a Janete não entende áudio. Adicione uma chave de Escuta (OpenAI, Groq ou ElevenLabs) ou a da voz (ElevenLabs).",
    );
  });
});

/* ---------- a tela: remover a chave de voz que a Escuta também usa ---------- */

function montarTela(chaves: ChaveIA[], papel: Papel = "admin") {
  const base = criarEstadoInicial(AGORA);
  const estado: EstadoBase = {
    ...base,
    // a escuta e a voz do teste no lugar das que vierem no exemplo
    chaves: [...base.chaves.filter((k) => k.finalidade !== "transcricao" && k.finalidade !== "voz"), ...chaves],
    configuracao: { ...base.configuracao, voz_id: "v1", voz_nome: "Voz de teste" },
  };
  return render(
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={estado} progredirEnvios={false} relogio={() => new Date(AGORA)}>
        <TelaConfiguracao />
      </ProvedorDados>
    </ProvedorPapel>,
  );
}

async function andar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const cartao = (peca: "escuta" | "voz") => document.getElementById(`cfg-card-${peca}`)!;
const botao = (nome: string | RegExp, dentro: HTMLElement = document.body) => within(dentro).getByRole("button", { name: nome });

describe("Remover a chave de voz com a mesma chave na Escuta (T7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o diálogo diz que a escuta continua; o aviso também, e a Escuta segue com a chave", async () => {
    montarTela([chave("transcricao", "elevenlabs", "EL11"), chave("voz", "elevenlabs", "EL11")]);
    const v = cartao("voz");
    expect(v).toHaveTextContent("Mesma chave da Escuta de áudio");
    expect(cartao("escuta")).toHaveTextContent("Mesma chave da Voz da Janete");

    fireEvent.click(botao("Remover a chave de voz", v));
    const dlg = screen.getByRole("alertdialog", { name: "Remover a chave de voz?" });
    expect(dlg).toHaveTextContent(
      "A chave sai da voz: a Janete passa a responder só em texto. A Escuta de áudio continua com a mesma chave. Dá para conectar de novo quando quiser.",
    );
    fireEvent.click(botao("Remover", dlg));
    await andar(50);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("Chave de voz removida. A escuta continua com a mesma chave.").length).toBeGreaterThan(0);
    expect(within(v).getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
    // a Escuta guarda a sua (E2): continua com a chave, agora sem o "Mesma chave…"
    const e = cartao("escuta");
    expect(within(e).getByRole("heading", { name: "Ativa, com a ElevenLabs" })).toBeInTheDocument();
    expect(e).toHaveTextContent("terminada em EL11");
    expect(e.textContent).not.toMatch(/Mesma chave/);
    await andar(300);
    expect(document.activeElement).toBe(document.getElementById("cfg-h-voz"));
  });

  it("com outra chave na Escuta, os textos de antes", async () => {
    montarTela([chave("transcricao", "elevenlabs", "EL11"), chave("voz", "elevenlabs", "EL22")]);
    const v = cartao("voz");
    fireEvent.click(botao("Remover a chave de voz", v));
    const dlg = screen.getByRole("alertdialog", { name: "Remover a chave de voz?" });
    expect(dlg).toHaveTextContent(
      "A chave da ElevenLabs sai da Janete: ela passa a responder só em texto. Dá para conectar de novo quando quiser.",
    );
    expect(dlg.textContent).not.toMatch(/continua com a mesma chave/);
    fireEvent.click(botao("Remover", dlg));
    await andar(50);
    expect(screen.getAllByText("Chave de voz removida.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Chave de voz removida. A escuta continua com a mesma chave.")).not.toBeInTheDocument();
  });
});
