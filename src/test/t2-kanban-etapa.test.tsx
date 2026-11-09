import { readFileSync } from "node:fs";
import path from "node:path";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { IDS, criarEstadoInicial } from "@/features/plataforma/exemplo";
import { EtapaChat } from "@/features/plataforma/kanban/EtapaChat";
import { TelaKanban } from "@/features/plataforma/kanban/TelaKanban";
import { ProvedorPapel } from "@/features/plataforma/papel";

// A etapa aberta como chat, com as decisões do equipe de 30/10/2026: a lista com a linha compacta
// (66 px, sem a linha de situação) e, no celular, a etapa em tela cheia como no Kanban 2, com as setas
// no lugar das abas. Decisão de 02/11/2026: como no `.foco` do protótipo, o dock e o botão da Janete
// ficam por cima da etapa (que deixa o espaço deles embaixo); só a gaveta do lead cobre tudo.

// Quinta-feira, 30/10/2026, 14:45 em São Paulo.
const AGORA = new Date("2026-10-30T17:45:00.000Z");

let matchMediaOriginal: typeof window.matchMedia;

beforeEach(() => {
  matchMediaOriginal = window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.matchMedia = matchMediaOriginal;
  document.body.style.overflow = "";
  vi.useRealTimers();
});

/** Faz a tela "ter" a largura do celular (até 899 px) para o `useTelaEstreita`. */
function celular() {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("max-width: 899px"),
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function Montar({ children }: { children: React.ReactNode }) {
  return (
    <ProvedorPapel inicial="admin">
      <ProvedorDados exemplo={() => criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => AGORA}>
        {children}
      </ProvedorDados>
    </ProvedorPapel>
  );
}

/** A etapa com quem a monta (o TelaKanban): troca de etapa pelas setas e volta. */
function ComEtapa({ inicial, aoVoltar }: { inicial: string; aoVoltar: () => void }) {
  const [etapa, setEtapa] = useState(inicial);
  return <EtapaChat etapaId={etapa} aoVoltar={aoVoltar} aoTrocarEtapa={setEtapa} />;
}

const lista = () => screen.getByRole("navigation", { name: "Conversas desta etapa" });

/** A etapa aberta: uma região com o nome dela (no celular, não é mais janela modal). */
const etapaAberta = (nome: string) => screen.getByRole("region", { name: nome });

// Lidos do disco: no Vitest o CSS não é processado e o `?raw` volta vazio.
const cssEtapa = readFileSync(path.resolve(__dirname, "../features/plataforma/kanban/EtapaChat.module.css"), "utf-8");
const cssPlat = readFileSync(path.resolve(__dirname, "../features/plataforma/Plataforma.module.css"), "utf-8");
const cssGaveta = readFileSync(path.resolve(__dirname, "../features/plataforma/comum/Gaveta.module.css"), "utf-8");
const cssAiPro = readFileSync(path.resolve(__dirname, "../styles/aipro.css"), "utf-8");

/** O corpo das regras com esse seletor exato (todas as ocorrências, na ordem do arquivo). */
function regras(css: string, seletor: string): string[] {
  const esc = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${esc} \\{([^}]*)\\}`, "g"))].map((m) => m[1]!);
}

function zIndex(corpo: string): number {
  const m = /z-index:\s*(\d+);/.exec(corpo);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

describe("EtapaChat: linha compacta", () => {
  it("cada linha da lista da etapa vem compacta (sem a 3ª linha), no computador e no celular", () => {
    const { unmount } = render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    let linhas = within(lista()).getAllByRole("button");
    expect(linhas.length).toBeGreaterThan(1);
    for (const l of linhas) expect(l.closest("[data-compacta]")).not.toBeNull();
    unmount();

    celular();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    linhas = within(lista()).getAllByRole("button");
    expect(linhas.length).toBeGreaterThan(1);
    for (const l of linhas) expect(l.closest("[data-compacta]")).not.toBeNull();
  });

  it("quem espera a equipe mostra o tempo de espera no lugar da hora; nenhuma linha tem a linha de situação", () => {
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    const raizes = within(lista())
      .getAllByRole("button")
      .map((b) => b.closest<HTMLElement>("[data-compacta]")!);
    const espera = (r: HTMLElement) => ["aguardando", "falha"].includes(r.getAttribute("data-quem") ?? "");
    const esperando = raizes.filter(espera);
    const outros = raizes.filter((r) => !espera(r));
    expect(esperando.length).toBeGreaterThan(0);
    expect(outros.length).toBeGreaterThan(0);
    // como no protótipo: a linha de situação (o filho com `data-quem`) some de todas, e quem espera
    // mostra o tempo de espera (`data-espera`) no lugar da hora
    for (const r of raizes) expect(r.querySelector("button [data-quem]")).toBeNull();
    for (const r of esperando) expect(r.querySelector("button [data-espera]")).not.toBeNull();
    for (const r of outros) expect(r.querySelector("button [data-espera]")).toBeNull();
  });
});

describe("EtapaChat: no computador, nada muda", () => {
  it("fica no lugar (sem portal nem diálogo), com as setas e sem abas", () => {
    const { container } = render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.qualificado} aoVoltar={() => {}} />
      </Montar>,
    );
    const titulo = screen.getByRole("heading", { level: 2, name: "Qualificado" });
    const secao = titulo.closest("section")!;
    expect(container.contains(secao)).toBe(true);
    expect(secao).not.toHaveAttribute("data-tela-cheia");
    expect(secao).not.toHaveAttribute("role");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima etapa: Em negociação" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Trocar de etapa" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("EtapaChat: no celular, em tela cheia", () => {
  it("vai para o body em tela cheia, sem ser janela modal, com as setas no lugar das abas", () => {
    celular();
    const { container } = render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    const etapa = etapaAberta("Em qualificação");
    // fora da moldura: no body, pelo portal, com a identidade AI PRO
    expect(container.contains(etapa)).toBe(false);
    expect(etapa.parentElement?.parentElement).toBe(document.body);
    expect(etapa.parentElement).toHaveAttribute("data-identidade", "aipro");
    // o dock e o botão da Janete ficam por cima e continuam valendo: a etapa não é diálogo nem modal
    expect(etapa).toHaveAttribute("data-tela-cheia");
    expect(etapa).not.toHaveAttribute("role");
    expect(etapa).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // sem as abas: as setas trocam de etapa
    expect(screen.queryByRole("group", { name: "Trocar de etapa" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Etapa anterior: Novo" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Próxima etapa: Qualificado" }));
    expect(etapaAberta("Qualificado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima etapa: Em negociação" }));
    expect(etapaAberta("Em negociação")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Etapa anterior: Qualificado" }));
    expect(etapaAberta("Qualificado")).toBeInTheDocument();
    // a rolagem da página não é travada: o estilo do body fica intacto
    expect(document.body.contains(etapaAberta("Qualificado"))).toBe(true);
    expect(document.body.style.overflow).toBe("");
  });

  it("não mexe no overflow do body: ao sair, a rolagem da página fica como estava", () => {
    celular();
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.novo} aoVoltar={() => {}} />
      </Montar>,
    );
    const etapa = etapaAberta("Novo");
    expect(etapa).toHaveAttribute("data-tela-cheia");
    expect(document.body.contains(etapa)).toBe(true);
    expect(document.body.style.overflow).toBe("auto");
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("sair com a gaveta do lead aberta por cima (o voltar do celular) não deixa a página travada", () => {
    celular();
    const { unmount } = render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    fireEvent.click(within(lista()).getAllByRole("button")[0]!);
    expect(screen.getByRole("dialog", { name: /^Conversa com/ })).toBeInTheDocument();
    // a gaveta trava a página dela
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("apagar a conversa aberta devolve o foco a Voltar ao quadro, e o Esc fora da etapa ainda sai", () => {
    celular();
    const aoVoltar = vi.fn();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={aoVoltar} />
      </Montar>,
    );
    const antes = within(lista()).getAllByRole("button").length;
    fireEvent.click(within(lista()).getAllByRole("button")[0]!);
    const g = screen.getByRole("dialog", { name: /^Conversa com/ });
    fireEvent.click(within(g).getByRole("button", { name: "Sobre o lead" }));
    fireEvent.click(within(g).getByRole("button", { name: "Apagar contato" }));
    fireEvent.click(within(within(g).getByRole("alertdialog")).getByRole("button", { name: "Apagar contato" }));
    expect(screen.queryByRole("dialog", { name: /^Conversa com/ })).not.toBeInTheDocument();
    expect(within(lista()).getAllByRole("button")).toHaveLength(antes - 1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Voltar ao quadro" }));
    expect(aoVoltar).not.toHaveBeenCalled();

    // o foco perdido no body: o Esc ainda sai da etapa, e o Tab não é puxado de volta para dentro dela
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    const tab = fireEvent.keyDown(document.body, { key: "Tab" });
    expect(tab).toBe(true);
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });

  it("com a gaveta aberta, o Esc fora da etapa não fecha a etapa por baixo", () => {
    celular();
    const aoVoltar = vi.fn();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={aoVoltar} />
      </Montar>,
    );
    fireEvent.click(within(lista()).getAllByRole("button")[0]!);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    // a gaveta fecha; a etapa fica
    expect(screen.queryByRole("dialog", { name: /^Conversa com/ })).not.toBeInTheDocument();
    expect(etapaAberta("Em qualificação")).toBeInTheDocument();
    expect(aoVoltar).not.toHaveBeenCalled();
  });

  it("a seta que chega na primeira etapa passa o foco para a outra seta", () => {
    celular();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    const seta = screen.getByRole("button", { name: "Etapa anterior: Novo" });
    seta.focus();
    fireEvent.click(seta);
    expect(etapaAberta("Novo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Etapa anterior" })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Próxima etapa: Em qualificação" }));
  });

  it("Voltar ao quadro e Esc saem da etapa", () => {
    celular();
    const aoVoltar = vi.fn();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.qualificado} aoVoltar={aoVoltar} />
      </Montar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao quadro" }));
    expect(aoVoltar).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(lista(), { key: "Escape" });
    expect(aoVoltar).toHaveBeenCalledTimes(2);
    // o toque num espaço vazio deixa o foco na própria etapa, e o Esc dali também sai
    const etapa = etapaAberta("Qualificado");
    etapa.focus();
    expect(document.activeElement).toBe(etapa);
    fireEvent.keyDown(etapa, { key: "Escape" });
    expect(aoVoltar).toHaveBeenCalledTimes(3);
  });

  it("a conversa abre na gaveta por cima da etapa; o Esc na gaveta fecha só a gaveta", () => {
    celular();
    const aoVoltar = vi.fn();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={aoVoltar} />
      </Montar>,
    );
    // no celular, nenhuma conversa abre sozinha
    expect(screen.queryByRole("dialog", { name: /^Conversa com/ })).not.toBeInTheDocument();
    const primeira = within(lista()).getAllByRole("button")[0]!;
    fireEvent.click(primeira);
    const g = screen.getByRole("dialog", { name: /^Conversa com/ });
    // a gaveta vai pelo portal para o body, fora da seção da etapa (e da camada dela)
    expect(etapaAberta("Em qualificação").contains(g)).toBe(false);
    fireEvent.keyDown(within(g).getByRole("log"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /^Conversa com/ })).not.toBeInTheDocument();
    expect(aoVoltar).not.toHaveBeenCalled();
    expect(etapaAberta("Em qualificação")).toBeInTheDocument();
  });

  it("com o painel da Janete aberto por cima (janela modal fora da etapa), o Esc no body não fecha a etapa", () => {
    celular();
    const aoVoltar = vi.fn();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={aoVoltar} />
      </Montar>,
    );
    // o painel da Janete em tela cheia (aria-modal), aberto pelo botão que fica por cima da etapa
    const painel = document.createElement("section");
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-modal", "true");
    document.body.appendChild(painel);
    try {
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).toBe(document.body);
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(aoVoltar).not.toHaveBeenCalled();
      expect(etapaAberta("Em qualificação")).toBeInTheDocument();
    } finally {
      painel.remove();
    }
    // o painel fechou: o Esc perdido no body volta a sair da etapa
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });

  it("o Tab não dá a volta dentro da etapa: do último item segue para fora (o dock está por cima)", () => {
    celular();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    const voltar = screen.getByRole("button", { name: "Voltar ao quadro" });
    const linhas = within(lista()).getAllByRole("button");
    const ultima = linhas[linhas.length - 1]!;
    ultima.focus();
    // nenhum dos dois Tabs é segurado: o navegador segue a ordem normal da página
    expect(fireEvent.keyDown(ultima, { key: "Tab" })).toBe(true);
    expect(document.activeElement).toBe(ultima);
    voltar.focus();
    expect(fireEvent.keyDown(voltar, { key: "Tab", shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(voltar);
  });

  it("no CSS: abaixo do dock e do botão da Janete, acima do quadro, com o espaço deles embaixo e sem travar a página", () => {
    const [cheia] = regras(cssEtapa, ".ecRaiz[data-tela-cheia]");
    expect(cheia).toBeDefined();
    const zEtapa = zIndex(cheia!);
    // o dock do celular (o `.ladoNav` fixo) e o botão da Janete (`.gatilho`)
    const dock = regras(cssPlat, ".ladoNav").find((c) => /position:\s*fixed/.test(c));
    expect(dock).toBeDefined();
    const gatilho = regras(cssPlat, ".gatilho").find((c) => /z-index/.test(c));
    expect(gatilho).toBeDefined();
    expect(zEtapa).toBeGreaterThan(0);
    expect(zEtapa).toBeLessThan(zIndex(dock!));
    expect(zEtapa).toBeLessThan(zIndex(gatilho!));
    // o espaço embaixo é o do dock e do botão do canto (a medida do aipro.css)
    expect(cheia).toMatch(/padding:[^;]*var\(--sb-reserva-dock\)/);
    // sem a trava de rolagem da página
    expect(cssEtapa).not.toMatch(/:has\(\.ecRaiz\[data-tela-cheia\]\)/);
    // a gaveta do lead (a Gaveta comum, que vai para o body) continua por cima do dock e do botão
    const [raizGaveta] = regras(cssGaveta, ".gvRaiz");
    expect(raizGaveta).toMatch(/z-index:\s*var\(--via-z-modal\);/);
    const zModal = /--via-z-modal:\s*(\d+);/.exec(cssAiPro);
    expect(zModal).not.toBeNull();
    expect(Number(zModal![1])).toBeGreaterThan(zIndex(dock!));
    expect(Number(zModal![1])).toBeGreaterThan(zIndex(gatilho!));
  });
});

describe("EtapaChat no quadro, no celular", () => {
  it("expandir abre a etapa em tela cheia; Esc volta ao quadro com o foco no ícone de expandir", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    celular();
    render(
      <ProvedorPapel inicial="admin">
        <ProvedorDados relogio={() => new Date(Date.now())} progredirEnvios={false} exemplo={() => criarEstadoInicial(AGORA)}>
          <TelaKanban relogio={() => Date.now()} />
        </ProvedorDados>
      </ProvedorPapel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir Qualificado como chat" }));
    const etapa = etapaAberta("Qualificado");
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(within(etapa).getByRole("button", { name: "Voltar ao quadro" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    // a coluna do quadro também é uma região "Qualificado": a etapa é a que leva `data-tela-cheia`
    expect(document.querySelector("[data-tela-cheia]")).toBeNull();
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abrir Qualificado como chat" }));
    // a etapa nunca tocou no estilo do body
    expect(document.body.style.overflow).toBe("");
  });

  it("o botão Voltar ao quadro faz o mesmo", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    celular();
    render(
      <ProvedorPapel inicial="admin">
        <ProvedorDados relogio={() => new Date(Date.now())} progredirEnvios={false} exemplo={() => criarEstadoInicial(AGORA)}>
          <TelaKanban relogio={() => Date.now()} />
        </ProvedorDados>
      </ProvedorPapel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir Em negociação como chat" }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao quadro" }));
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abrir Em negociação como chat" }));
  });
});
