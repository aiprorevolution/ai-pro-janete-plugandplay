import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Bolha, type AutorBolha, type MensagemBolha } from "@/features/plataforma/comum/Bolha";
import { AbaMidias } from "@/features/plataforma/contatos/AbaMidias";
import { midiasDoContato } from "@/features/plataforma/contatos/dados";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarEstadoInicial, idContato, useExemplo, type EstadoBase, type EstadoExemplo } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// Task C5 da spec do uso da voz (docs/spec-voz-uso.md): o rótulo do áudio que a Janete falou.

const AGORA = new Date("2026-10-30T17:45:00.000Z");
const RICARDO = idContato("ricardo");
const JANETE: AutorBolha = { nome: "Janete" };
const LEAD: AutorBolha = { nome: "Ricardo", nomeCompleto: "Ricardo Alves" };

function audio(campos: Partial<MensagemBolha> = {}): MensagemBolha {
  return {
    id: "m1",
    origem: "janete",
    tipo: "audio",
    status: "enviada",
    texto: null,
    momento: "2026-10-30T17:31:00.000Z",
    duracaoS: 12,
    transcricao: "Te mando o orçamento agora.",
    ...campos,
  };
}

describe("Bolha: o áudio da Janete", () => {
  afterEach(cleanup);

  it("com origem janete o rótulo é 'O que a Janete falou' e o prefixo de leitor é 'Texto falado: '", () => {
    render(<Bolha mensagem={audio()} autor={JANETE} />);
    expect(screen.queryByRole("button", { name: "Transcrição da Janete" })).toBeNull();
    const botao = screen.getByRole("button", { name: "O que a Janete falou" });
    fireEvent.click(botao);
    const texto = screen.getByText("Te mando o orçamento agora.");
    expect(within(texto.closest("p")!).getByText("Texto falado:")).toBeInTheDocument();
    expect(within(texto.closest("p")!).queryByText("Transcrição:")).toBeNull();
  });

  it("o áudio do lead continua com 'Transcrição da Janete' e 'Transcrição: '", () => {
    render(<Bolha mensagem={audio({ origem: "lead", status: "recebida" })} autor={LEAD} />);
    expect(screen.queryByRole("button", { name: "O que a Janete falou" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transcrição da Janete" }));
    const p = screen.getByText("Te mando o orçamento agora.").closest("p")!;
    expect(within(p).getByText("Transcrição:")).toBeInTheDocument();
    expect(within(p).queryByText("Texto falado:")).toBeNull();
  });
});

const espiao = vi.hoisted(() => ({ estado: null as EstadoExemplo | null }));

function Espiao() {
  espiao.estado = useExemplo().estado;
  return null;
}

/** O estado do exemplo com o áudio do Ricardo passado para a origem janete. */
function comAudioDaJanete(): EstadoBase {
  const base = criarEstadoInicial(AGORA);
  return {
    ...base,
    mensagens: base.mensagens.map((m) => (m.tipo === "audio" && m.transcricao ? { ...m, origem: "janete" as const } : m)),
  };
}

describe("AbaMidias: o áudio da Janete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    espiao.estado = null;
  });

  const props = {
    contatoId: RICARDO,
    agora: AGORA.getTime(),
    irParaAba: vi.fn(),
    verNaConversa: vi.fn(),
    avisar: vi.fn(),
  };

  function montar(inicial: () => EstadoBase) {
    return render(
      <ProvedorPapel inicial="admin">
        <ProvedorDados exemplo={inicial} progredirEnvios={false} relogio={() => AGORA}>
          <Espiao />
          <AbaMidias {...props} />
        </ProvedorDados>
      </ProvedorPapel>,
    );
  }

  it("a origem janete troca o prefixo de leitor; a do lead segue com 'Transcrição: '", () => {
    montar(comAudioDaJanete);
    const daJanete = midiasDoContato(espiao.estado!, RICARDO).find((m) => m.tipo === "audio")!;
    expect(daJanete.autor).toBe("Janete");
    const card = screen.getAllByRole("listitem").find((c) => c.getAttribute("data-tipo") === "audio")!;
    expect(within(card).getByText("Texto falado:")).toBeInTheDocument();
    expect(within(card).queryByText("Transcrição:")).toBeNull();
    cleanup();

    montar(() => criarEstadoInicial(AGORA));
    const doLead = screen.getAllByRole("listitem").find((c) => c.getAttribute("data-tipo") === "audio")!;
    expect(within(doLead).getByText("Transcrição:")).toBeInTheDocument();
    expect(within(doLead).queryByText("Texto falado:")).toBeNull();
  });

  it("um lead chamado 'Janete ...' segue com 'Transcrição: ' (o prefixo vem da origem, não do nome)", () => {
    montar(() => {
      const base = criarEstadoInicial(AGORA);
      return { ...base, contatos: base.contatos.map((c) => (c.id === RICARDO ? { ...c, nome: "Janete Souza" } : c)) };
    });
    const doLead = midiasDoContato(espiao.estado!, RICARDO).find((m) => m.tipo === "audio")!;
    // o autor é o primeiro nome do lead: "Janete", igual ao da Janete
    expect(doLead.autor).toBe("Janete");
    const card = screen.getAllByRole("listitem").find((c) => c.getAttribute("data-tipo") === "audio")!;
    expect(within(card).getByText("Transcrição:")).toBeInTheDocument();
    expect(within(card).queryByText("Texto falado:")).toBeNull();
  });
});
