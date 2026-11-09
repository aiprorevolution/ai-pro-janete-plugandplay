import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  EventoConversa,
  PassagemConversa,
  textoDoEvento,
  type LinhaEventoConversa,
} from "@/features/plataforma/comum/EventoConversa";
import type { EventoPassagem } from "@/features/plataforma/exemplo";

// F5 (ligar as telas ao banco): os eventos de conversa_eventos (decisão 8) desenhados pela peça comum,
// no desenho de hoje (a passagem do Chat, a do perfil do contato e a linha do tempo do Kanban), com o
// tipo novo `voltou_para_fila` (quem atendia foi desativado).

/* 17:32 em UTC é 14:32 em São Paulo (UTC-3). */
const EM = "2026-10-30T17:32:00.000Z";

function ev(campos: Partial<LinhaEventoConversa> = {}): LinhaEventoConversa {
  return {
    id: "ev-1",
    tipo: "passou",
    membro_id: null,
    motivo: null,
    de: null,
    de_membro_id: null,
    por_envio: false,
    criado_em: EM,
    ...campos,
  };
}

/** A frase do leitor de tela (o texto só para ele, dentro do role="note"). */
const frase = (nota: HTMLElement) => nota.querySelector("[class*='sr']")!.textContent;

afterEach(() => {
  cleanup();
});

describe("textoDoEvento", () => {
  it("passou: o motivo curto, a frase com o motivo e a falha em vermelho", () => {
    expect(textoDoEvento(ev({ motivo: "janete_passou" }))).toEqual({
      curto: "A Janete pediu ajuda",
      linha: "A Janete passou a conversa para a equipe",
      frase: "A Janete passou para um humano às 14:32. Motivo: a Janete decidiu passar.",
      falha: false,
    });
    const falha = textoDoEvento(ev({ motivo: "chave_invalida" }));
    expect(falha.falha).toBe(true);
    expect(falha.linha).toBe("A Janete parou: a chave de IA está inválida");
    // Sem motivo gravado, vale o "a Janete decidiu".
    expect(textoDoEvento(ev()).curto).toBe("A Janete pediu ajuda");
  });

  it("assumiu: de onde veio, e o 'ao enviar'", () => {
    expect(textoDoEvento(ev({ tipo: "assumiu", de: "janete" }), { nome: "Você" }).frase).toBe(
      "Você assumiu a conversa às 14:32. A Janete saiu da conversa.",
    );
    expect(textoDoEvento(ev({ tipo: "assumiu", de: "espera", por_envio: true }), { nome: "Marina" }).frase).toBe(
      "Marina assumiu a conversa às 14:32. Ao enviar uma mensagem. A conversa esperava atendimento.",
    );
    expect(textoDoEvento(ev({ tipo: "assumiu", de: "outro" }), { nome: "Você", nomeDe: "Bruna" }).frase).toBe(
      "Você assumiu a conversa às 14:32. A conversa estava com Bruna.",
    );
    expect(textoDoEvento(ev({ tipo: "assumiu", de: "celular" })).curto).toBe("Alguém da equipe assumiu a conversa");
  });

  it("devolveu, celular e voltou para a fila", () => {
    expect(textoDoEvento(ev({ tipo: "devolveu" }), { nome: "Marina" }).curto).toBe("Marina devolveu para a Janete");
    expect(textoDoEvento(ev({ tipo: "celular" })).linha).toBe("Alguém respondeu pelo celular da empresa");
    expect(textoDoEvento(ev({ tipo: "voltou_para_fila", de: "outro" }), { nomeDe: "Bruna" })).toEqual({
      curto: "Voltou para a fila",
      linha: "A conversa voltou para a fila: a conta de Bruna foi desativada",
      frase: "A conversa voltou para a fila às 14:32. A conta de Bruna foi desativada, e a conversa espera atendimento.",
      falha: false,
    });
    expect(textoDoEvento(ev({ tipo: "voltou_para_fila" })).linha).toContain("a conta de quem atendia foi desativada");
  });
});

describe("PassagemConversa: a rota do Chat", () => {
  it("passou: a Janete → quem espera, o texto curto e a hora; a frase inteira para o leitor de tela", () => {
    render(<PassagemConversa evento={ev({ motivo: "janete_passou" })} />);
    const nota = screen.getByRole("note");
    expect(nota).toHaveAttribute("data-evento", "passou");
    expect(nota).toHaveAttribute("data-forma", "rota");
    expect(nota).not.toHaveAttribute("data-tom");
    expect(screen.getByText("A Janete pediu ajuda")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("· 14:32")).toBeInTheDocument();
    expect(frase(nota)).toBe("A Janete passou para um humano às 14:32. Motivo: a Janete decidiu passar.");
  });

  it("passou por falha: o tom vermelho", () => {
    render(<PassagemConversa evento={ev({ motivo: "sem_credito" })} />);
    expect(screen.getByRole("note")).toHaveAttribute("data-tom", "falha");
    expect(screen.getByText("Sem crédito de IA")).toBeInTheDocument();
  });

  it("assumiu de outra pessoa: as iniciais de quem estava → as de quem assumiu", () => {
    render(
      <PassagemConversa evento={ev({ tipo: "assumiu", de: "outro" })} nome="Você" iniciais="VC" nomeDe="Bruna Lima" />,
    );
    const rota = screen.getByRole("note").firstElementChild!;
    expect(Array.from(rota.querySelectorAll("[class*='evMembro']")).map((e) => e.textContent)).toEqual(["BL", "VC"]);
    expect(screen.getByText("Você assumiu a conversa")).toBeInTheDocument();
  });

  it("voltou para a fila: a pessoa desativada → quem espera", () => {
    render(<PassagemConversa evento={ev({ tipo: "voltou_para_fila", de: "outro" })} nomeDe="Bruna Lima" />);
    const nota = screen.getByRole("note");
    expect(nota).toHaveAttribute("data-evento", "voltou_para_fila");
    const rota = nota.firstElementChild!;
    expect(rota.querySelector("[class*='evMembro']")!.textContent).toBe("BL");
    expect(rota.querySelector("[class*='evPessoa']")).not.toBeNull();
    expect(screen.getByText("Voltou para a fila")).toBeInTheDocument();
    expect(frase(nota)).toContain("A conta de Bruna Lima foi desativada");
  });

  it("devolveu: quem devolve → a Janete; celular: a Janete → o celular", () => {
    const { rerender } = render(<PassagemConversa evento={ev({ tipo: "devolveu" })} nome="Marina Souza" />);
    expect(screen.getByRole("note").querySelector("[class*='evMembro']")!.textContent).toBe("MS");
    rerender(<PassagemConversa evento={ev({ tipo: "celular" })} />);
    expect(screen.getByRole("note").querySelector("[data-celular]")).not.toBeNull();
    expect(screen.getByText("Respondida pelo celular")).toBeInTheDocument();
  });

  it("compacta (o perfil do contato) e texto (a linha do tempo do Kanban)", () => {
    const { rerender } = render(<PassagemConversa evento={ev({ tipo: "devolveu" })} nome="Marina" forma="compacta" />);
    expect(screen.getByRole("note")).toHaveAttribute("data-forma", "compacta");
    rerender(<PassagemConversa evento={ev({ tipo: "celular" })} forma="texto" />);
    // A forma texto é o EventoConversa de sempre: só a frase e a hora.
    expect(screen.getByRole("note")).toHaveTextContent(/^Alguém respondeu pelo celular da empresa · 14:32$/);
    render(<EventoConversa texto="Contato editado" />);
    expect(screen.getAllByRole("note")).toHaveLength(2);
  });

  it("o EventoPassagem do exemplo cabe sem conversão", () => {
    const doExemplo: EventoPassagem = {
      id: "ev-x",
      conversa_id: "cv",
      tipo: "assumiu",
      membro_id: "mb-1",
      motivo: null,
      de: "espera",
      de_membro_id: null,
      por_envio: true,
      criado_em: EM,
    };
    render(<PassagemConversa evento={doExemplo} nome="Você" />);
    expect(screen.getByText("Você assumiu a conversa")).toBeInTheDocument();
  });

  it("cada classe declarada existe no CSS", () => {
    const pasta = path.resolve(__dirname, "../features/plataforma/comum");
    const codigo = readFileSync(path.join(pasta, "EventoConversa.tsx"), "utf-8");
    const css = readFileSync(path.join(pasta, "EventoConversa.module.css"), "utf-8");
    const classes = [.../as Classes<([^>]+)>/.exec(codigo)![1]!.matchAll(/["']([\w-]+)["']/g)].map((c) => c[1]!);
    expect(classes).toContain("evPassagem");
    expect(classes.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css))).toEqual([]);
  });
});
