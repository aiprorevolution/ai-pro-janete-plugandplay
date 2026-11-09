import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import {
  IDS,
  criarEstadoInicial,
  estaAguardando,
  idContato,
  idConversa,
  useExemplo,
} from "@/features/plataforma/exemplo";
import { EtapaChat } from "@/features/plataforma/kanban/EtapaChat";
import { GavetaLead } from "@/features/plataforma/kanban/GavetaLead";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Kanban 2 (task K2): a gaveta do lead (infos à esquerda, conversa à direita) e a etapa que vira
// chat. Tudo com os dados de exemplo em memória, sem banco.

// Quinta-feira, 30/10/2026, 14:45 em São Paulo.
const AGORA = new Date("2026-10-30T17:45:00.000Z");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Montar({ children, papel = "admin" }: { children: React.ReactNode; papel?: Papel }) {
  return (
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={() => criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => AGORA}>
        {children}
      </ProvedorDados>
    </ProvedorPapel>
  );
}

/** A gaveta com quem a abre: o botão "Abrir" no lugar do card, e o fechar trocando o estado. */
function ComGaveta({ contatoId, aoFechar }: { contatoId: string; aoFechar?: () => void }) {
  const [aberto, setAberto] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setAberto(contatoId)}>
        Abrir
      </button>
      <GavetaLead
        contatoId={aberto}
        aoFechar={() => {
          aoFechar?.();
          setAberto(null);
        }}
      />
      <Existe contatoId={contatoId} />
    </>
  );
}

/** Diz se o contato ainda existe no exemplo (para conferir o apagar). */
function Existe({ contatoId }: { contatoId: string }) {
  const { estado } = useExemplo();
  return <p data-testid="existe">{estado.contatos.some((c) => c.id === contatoId) ? "sim" : "não"}</p>;
}

const abrir = () => fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
const gaveta = (nome: string) => screen.getByRole("dialog", { name: `Conversa com ${nome}` });

/** Abaixo de 900 px (o celular); devolve quem desfaz. */
function celular() {
  const original = window.matchMedia;
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
  return () => {
    window.matchMedia = original;
  };
}

/** O topo da conversa: o cabeçalho onde fica o bastão (quem conduz a conversa), o mesmo do Chat. */
const topoDaConversa = (g: HTMLElement) => within(g).getByRole("group", { name: "Quem conduz a conversa" }).closest("header")!;

/** O campo de escrever da conversa com o lead (o nome acessível começa por "Mensagem para <primeiro nome>"). */
const campoDe = (g: HTMLElement, primeiro: string) => within(g).getByRole("textbox", { name: new RegExp(`^Mensagem para ${primeiro}`) });

describe("GavetaLead", () => {
  it("abre com as infos e a conversa, e fecha com Esc devolvendo o foco", () => {
    const aoFechar = vi.fn();
    render(
      <Montar>
        <ComGaveta contatoId={idContato("fernando")} aoFechar={aoFechar} />
      </Montar>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const botao = screen.getByRole("button", { name: "Abrir" });
    botao.focus();
    abrir();

    const g = gaveta("Fernando Castro");
    expect(within(g).getByRole("heading", { name: "Fernando Castro" })).toBeInTheDocument();
    expect(within(g).getByRole("heading", { name: "O que a Janete descobriu" })).toBeInTheDocument();
    expect(within(g).getByRole("button", { name: "Etapa do lead: Em qualificação" })).toBeInTheDocument();
    expect(within(g).getByRole("heading", { name: "Histórico de etapas" })).toBeInTheDocument();
    expect(within(g).getByRole("log", { name: "Mensagens com Fernando Castro" })).toBeInTheDocument();
    expect(within(g).getByRole("button", { name: /^Assumir conversa/ })).toBeInTheDocument();

    fireEvent.keyDown(g, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(botao).toHaveFocus();
  });

  it("fecha no X e clicando fora", () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    abrir();
    fireEvent.click(within(gaveta("Fernando Castro")).getByRole("button", { name: "Fechar a conversa (Esc)" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    abrir();
    fireEvent.click(screen.getByTestId("gaveta-veu"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("mandar mensagem tira a Janete: a conversa vem para você e a tela avisa", async () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Fernando Castro");
    // Com a Janete, o aviso fica no texto do campo, não numa faixa (a regra do Chat da rodada 2).
    expect(within(g).queryByText(/Ao enviar, você assume/)).not.toBeInTheDocument();

    const campo = campoDe(g, "Fernando");
    expect(campo).toHaveAttribute("placeholder", "Escreva para Fernando · você assume ao enviar");
    fireEvent.change(campo, { target: { value: "Oi, Fernando! Aqui é da equipe." } });
    fireEvent.keyDown(campo, { key: "Enter" });

    // As ações da camada de dados são assíncronas: o aviso vem quando o envio volta.
    const aviso = (await within(g).findByText("Você assumiu a conversa.")).closest('[role="status"]');
    expect(aviso).not.toBeNull();
    expect(aviso).toHaveTextContent("A Janete parou de responder este lead.");
    expect(within(g).getByRole("log")).toHaveTextContent("Oi, Fernando! Aqui é da equipe.");
    // Quem atende já está no bastão: o texto de estado não repete, e fica com a empresa e a etapa.
    expect(within(topoDaConversa(g)).queryByText("Você está atendendo")).not.toBeInTheDocument();
    expect(topoDaConversa(g)).toHaveTextContent(/Auto Peças Rota 9 · Em qualificação/);
    expect(within(g).queryByRole("button", { name: /^Assumir conversa/ })).not.toBeInTheDocument();
    expect(within(g).getByRole("button", { name: /^Você atendendo/ })).toBeDisabled();
    // Com você, a caixa volta ao texto padrão.
    expect(campo).toHaveAttribute("placeholder", "Escreva para Fernando");

    // Devolver pelo aviso: a Janete volta e o aviso some.
    fireEvent.click(within(aviso as HTMLElement).getByRole("button", { name: "Devolver para a Janete" }));
    await waitFor(() => expect(within(g).queryByText("Você assumiu a conversa.")).not.toBeInTheDocument());
    expect(within(g).getByRole("button", { name: /^Assumir conversa/ })).toBeInTheDocument();
  });

  it("com outra pessoa atendendo: a faixa avisa e o botão vira 'Assumir de <nome>'", async () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("patricia")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Patrícia Nogueira");
    expect(within(g).getByText("Marina está atendendo. Se você enviar, a conversa continua com Marina.")).toBeInTheDocument();
    // O topo não repete "Com Marina" no texto de estado: a empresa e a etapa ficam no lugar.
    const foraDoBastao = Array.from(topoDaConversa(g).querySelectorAll("span")).filter(
      (el) => !el.closest('[role="group"]') && el.textContent === "Com Marina",
    );
    expect(foraDoBastao).toHaveLength(0);
    expect(topoDaConversa(g)).toHaveTextContent(/Studio Pilates Equilíbrio · /);
    // Enviar não troca de mãos: o campo fica com o texto padrão, sem "você assume ao enviar".
    expect(campoDe(g, "Patrícia")).toHaveAttribute("placeholder", "Escreva para Patrícia");
    expect(within(g).queryByRole("button", { name: /^Assumir conversa/ })).not.toBeInTheDocument();

    const assumirDe = within(g).getByRole("button", { name: /Assumir de Marina/ });
    // A dica do mouse diz o que o botão faz.
    expect(assumirDe).toHaveAttribute("title", "Assumir de Marina. A conversa passa para você");
    fireEvent.click(assumirDe);
    expect(within(g).getByRole("button", { name: /^Você atendendo/ })).toBeDisabled();
    expect(within(g).queryByText(/Marina está atendendo/)).not.toBeInTheDocument();
    expect(within(g).queryByRole("button", { name: /Assumir de Marina/ })).not.toBeInTheDocument();
    // O foco vai para o campo, e o leitor de tela ouve de quem a conversa veio (como no Chat).
    await waitFor(() => expect(campoDe(g, "Patrícia")).toHaveFocus());
    expect(await within(g).findByText("Você assumiu a conversa. A conversa passou de Marina para você.")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("assumir e devolver pelo bastão: o foco vai para o campo e o leitor de tela ouve a troca", async () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Fernando Castro");
    const campo = () => campoDe(g, "Fernando");

    fireEvent.click(within(g).getByRole("button", { name: /^Assumir conversa/ }));
    expect(within(g).getByRole("button", { name: /^Você atendendo/ })).toBeDisabled();
    expect(campo()).toHaveAttribute("placeholder", "Escreva para Fernando");
    await waitFor(() => expect(campo()).toHaveFocus());
    expect(
      await within(g).findByText("Você assumiu a conversa. A Janete saiu desta conversa e só volta se alguém devolver."),
    ).toHaveAttribute("role", "status");

    // Tira o foco do campo, para conferir que o devolver o põe de volta.
    campo().blur();
    fireEvent.click(within(g).getByRole("button", { name: /^Devolver à Janete/ }));
    // Sem falha, devolver é direto: nenhuma confirmação.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(g).getByRole("button", { name: /^Janete atendendo/ })).toBeDisabled();
    expect(within(g).getByRole("button", { name: /^Assumir conversa/ })).toBeEnabled();
    expect(campo()).toHaveAttribute("placeholder", "Escreva para Fernando · você assume ao enviar");
    await waitFor(() => expect(campo()).toHaveFocus());
    expect(await within(g).findByText("A conversa com Fernando Castro voltou para a Janete.")).toHaveAttribute("role", "status");
  });

  it("com a Janete parada por falha: a faixa diz o motivo, e o campo fica com o texto padrão", () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("juliana")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Juliana Prado");
    expect(within(g).getByText("Sem crédito de IA: a Janete parou. Ao responder, você assume.")).toBeInTheDocument();
    expect(campoDe(g, "Juliana")).toHaveAttribute("placeholder", "Escreva para Juliana");
  });

  it("devolver depois de uma falha (Juliana) pede confirmação, como no Chat: confirmar devolve", async () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("juliana")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Juliana Prado");
    fireEvent.click(within(g).getByRole("button", { name: /^Devolver à Janete/ }));
    const d = screen.getByRole("alertdialog", { name: "Devolver para a Janete mesmo assim?" });
    expect(d).toHaveAccessibleDescription(
      "A chave de IA está sem crédito. A Janete volta a falhar até alguém resolver na Configuração.",
    );
    await waitFor(() => expect(d).toHaveFocus());
    // Ainda não devolveu: a conversa segue esperando a equipe.
    expect(within(g).getByRole("button", { name: /^Devolver à Janete/ })).toBeEnabled();

    fireEvent.click(within(d).getByRole("button", { name: "Devolver mesmo assim" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(g).getByRole("button", { name: /^Janete atendendo/ })).toBeDisabled();
    await waitFor(() => expect(campoDe(g, "Juliana")).toHaveFocus());
    expect(await within(g).findByText("A conversa com Juliana Prado voltou para a Janete.")).toHaveAttribute("role", "status");
  });

  it("devolver depois de uma falha (Juliana): cancelar, ou Esc, não devolve e não fecha a gaveta", async () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("juliana")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Juliana Prado");
    const devolver = () => within(g).getByRole("button", { name: /^Devolver à Janete/ });

    devolver().focus();
    fireEvent.click(devolver());
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(devolver()).toBeEnabled();
    expect(within(g).queryByRole("button", { name: /^Janete atendendo/ })).not.toBeInTheDocument();
    // O foco volta para quem abriu o diálogo.
    await waitFor(() => expect(devolver()).toHaveFocus());

    // Esc fecha só a confirmação: a gaveta fica aberta e a conversa continua esperando.
    fireEvent.click(devolver());
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(gaveta("Juliana Prado")).toBeInTheDocument();
    expect(devolver()).toBeEnabled();
  });

  it.each([
    ["ricardo", "Ricardo Menezes", "Ricardo"],
    ["carlos", "Carlos Eduardo Lima", "Carlos"],
  ])("esperando sem falha ou pelo celular (%s): sem faixa, e o campo avisa que você assume ao enviar", (lead, nome, primeiro) => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato(lead)} />
      </Montar>,
    );
    abrir();
    const g = gaveta(nome);
    expect(within(g).queryByText(/está atendendo\./)).not.toBeInTheDocument();
    expect(within(g).queryByText(/a Janete parou/)).not.toBeInTheDocument();
    expect(campoDe(g, primeiro)).toHaveAttribute("placeholder", `Escreva para ${primeiro} · você assume ao enviar`);
  });

  it("com a Janete atendendo, sem estar conversando agora (Fernando): o topo traz a empresa e a etapa, sem repetir o bastão", () => {
    // No exemplo, o Fernando começa com a Janete digitando: para de digitar antes de abrir.
    function ParaDeDigitar() {
      const { acoes } = useExemplo();
      return (
        <button
          type="button"
          onClick={() => acoes.simularJanete({ tipo: "janete_digitando", conversaId: idConversa("fernando"), digitando: false })}
        >
          a Janete para de digitar
        </button>
      );
    }
    render(
      <Montar>
        <ParaDeDigitar />
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "a Janete para de digitar" }));
    abrir();
    const topo = topoDaConversa(gaveta("Fernando Castro"));
    expect(topo).not.toHaveTextContent("Janete digitando");
    expect(topo).not.toHaveTextContent("A Janete está conversando agora");
    expect(topo).toHaveTextContent("Auto Peças Rota 9 · Em qualificação");
    expect(topo).not.toHaveTextContent("A Janete está atendendo");
  });

  it.each([
    ["ricardo", "Ricardo Menezes", "Esperando a equipe há"],
    ["carlos", "Carlos Eduardo Lima", "Respondida pelo celular da empresa"],
  ])("o topo da conversa diz a situação (%s)", (lead, nome, situacao) => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato(lead)} />
      </Montar>,
    );
    abrir();
    expect(topoDaConversa(gaveta(nome))).toHaveTextContent(situacao);
  });

  it("esperando a equipe sem falha (Ricardo): 'Devolver à Janete' devolve direto, sem o diálogo de alerta", async () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("ricardo")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Ricardo Menezes");
    fireEvent.click(within(g).getByRole("button", { name: /^Devolver à Janete/ }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(g).getByRole("button", { name: /^Janete atendendo/ })).toBeDisabled();
    expect(await within(g).findByText("A conversa com Ricardo Menezes voltou para a Janete.")).toHaveAttribute("role", "status");
  });

  it("o diálogo de devolver (Juliana): depois do Esc o foco volta ao 'Devolver à Janete', e o Tab fica preso nos botões", async () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("juliana")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Juliana Prado");
    const devolver = () => within(g).getByRole("button", { name: /^Devolver à Janete/ });

    devolver().focus();
    fireEvent.click(devolver());
    const d = screen.getByRole("alertdialog", { name: "Devolver para a Janete mesmo assim?" });
    await waitFor(() => expect(d).toHaveFocus());

    // Tab no último botão volta para o primeiro (e Shift+Tab no primeiro vai para o último).
    const botoes = within(d).getAllByRole("button");
    expect(botoes.length).toBeGreaterThanOrEqual(2);
    const primeiroB = botoes[0]!;
    const ultimoB = botoes[botoes.length - 1]!;
    ultimoB.focus();
    fireEvent.keyDown(ultimoB, { key: "Tab" });
    expect(primeiroB).toHaveFocus();
    fireEvent.keyDown(primeiroB, { key: "Tab", shiftKey: true });
    expect(ultimoB).toHaveFocus();

    fireEvent.keyDown(ultimoB, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(devolver()).toHaveFocus());
  });

  it("pelo celular (Carlos): o bastão oferece 'Assumir pela plataforma', e o campo avisa que você assume", () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("carlos")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Carlos Eduardo Lima");
    const bastao = within(g).getByRole("group", { name: "Quem conduz a conversa" });
    expect(within(bastao).getByRole("button", { name: /^Assumir pela plataforma/ })).toBeEnabled();
    expect(within(bastao).queryByRole("button", { name: /^Assumir conversa/ })).not.toBeInTheDocument();
    expect(campoDe(g, "Carlos")).toHaveAttribute("placeholder", "Escreva para Carlos · você assume ao enviar");
  });

  it("com a Janete digitando ou não: sem faixa, e o campo avisa que você assume ao enviar", () => {
    function Digitar() {
      const { acoes } = useExemplo();
      const simular = (digitando: boolean) =>
        acoes.simularJanete({ tipo: "janete_digitando", conversaId: idConversa("fernando"), digitando });
      return (
        <>
          <button type="button" onClick={() => simular(true)}>
            a Janete digita
          </button>
          <button type="button" onClick={() => simular(false)}>
            a Janete para de digitar
          </button>
        </>
      );
    }
    render(
      <Montar>
        <Digitar />
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "a Janete para de digitar" }));
    fireEvent.click(screen.getByRole("button", { name: "a Janete digita" }));
    abrir();
    const g = gaveta("Fernando Castro");
    const semFaixa = () => {
      expect(within(g).queryByText(/está atendendo\./)).not.toBeInTheDocument();
      expect(within(g).queryByText(/a Janete parou/)).not.toBeInTheDocument();
      expect(campoDe(g, "Fernando")).toHaveAttribute("placeholder", "Escreva para Fernando · você assume ao enviar");
    };
    expect(within(g).getByText("Janete digitando…")).toBeInTheDocument();
    semFaixa();
    fireEvent.click(screen.getByRole("button", { name: "a Janete para de digitar" }));
    expect(within(g).queryByText("Janete digitando…")).not.toBeInTheDocument();
    semFaixa();
  });

  it("o texto longo do campo só quando cabe numa linha; senão o curto 'Você assume ao enviar'", () => {
    const RO = globalThis.ResizeObserver;
    const getContext = HTMLCanvasElement.prototype.getContext;
    let larguraCampo = 200;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    HTMLCanvasElement.prototype.getContext = (() => ({
      font: "",
      measureText: (t: string) => ({ width: t.length * 8 }),
    })) as unknown as typeof getContext;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => larguraCampo });
    try {
      // "Escreva para Fernando · você assume ao enviar": 45 letras x 8 = 360 px
      render(
        <Montar>
          <ComGaveta contatoId={idContato("fernando")} />
        </Montar>,
      );
      abrir();
      expect(campoDe(gaveta("Fernando Castro"), "Fernando")).toHaveAttribute("placeholder", "Você assume ao enviar");
      cleanup();
      larguraCampo = 600;
      render(
        <Montar>
          <ComGaveta contatoId={idContato("fernando")} />
        </Montar>,
      );
      abrir();
      expect(campoDe(gaveta("Fernando Castro"), "Fernando")).toHaveAttribute(
        "placeholder",
        "Escreva para Fernando · você assume ao enviar",
      );
    } finally {
      globalThis.ResizeObserver = RO;
      HTMLCanvasElement.prototype.getContext = getContext;
      delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
    }
  });

  it("o documento tem o botão de baixar (no exemplo, o download é simulado e a tela avisa à vista)", () => {
    // Relógio falso: o aviso à vista e o anúncio são dois timers de 80 ms separados (dois useAnuncio),
    // e cada um vira uma renderização. Com o relógio real, o findAllByText podia resolver entre as
    // duas, achando só um dos textos (falhou 1 vez em 4 com a máquina carregada).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(
      <Montar>
        <ComGaveta contatoId={idContato("patricia")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Patrícia Nogueira");
    const texto = "Download simulado: proposta-studio-equilibrio.pdf.";
    const baixar = within(g).getByRole("button", { name: "Baixar proposta-studio-equilibrio.pdf" });
    fireEvent.click(baixar);
    // Antes dos 80 ms, nada ainda (o texto entra um instante depois de apagado).
    expect(within(g).queryAllByText(texto)).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    const achados = within(g).getAllByText(texto);
    // Um à vista, fora do parágrafo do leitor de tela, e o mesmo texto no anúncio (role=status).
    expect(achados).toHaveLength(2);
    const visivel = achados.find((el) => !el.closest('[role="status"]'));
    expect(visivel).toBeDefined();
    expect(visivel!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(achados.some((el) => el.getAttribute("role") === "status")).toBe(true);

    // Baixar de novo o mesmo arquivo: o aviso é apagado e regravado, para o leitor de tela ler outra vez.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(baixar);
    expect(within(g).queryAllByText(texto)).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(within(g).getAllByText(texto)).toHaveLength(2);

    // O aviso dura ~4 s contados do segundo clique (o timer do primeiro foi cancelado), e então some.
    act(() => {
      vi.advanceTimersByTime(3990);
    });
    expect(within(g).getAllByText(texto)).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(within(g).queryAllByText(texto)).toHaveLength(0);
  });

  it("o e-mail pode quebrar depois do @ e antes de um ponto, e não no meio da palavra", () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("patricia")} />
      </Montar>,
    );
    abrir();
    const campos = within(gaveta("Patrícia Nogueira")).getByText("E-mail").closest("div")!;
    const dd = campos.querySelector("dd")!;
    expect(dd).toHaveTextContent("patricia@equilibrio.exemplo");
    expect(dd.innerHTML).toBe("patricia@<wbr>equilibrio<wbr>.exemplo");
  });

  it("a etapa é um menu suspenso com a atual no botão; escolher outra move e grava quem moveu no histórico", () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Fernando Castro");
    // Um botão só (decisão do equipe, 30/10): não há mais um botão por etapa.
    expect(within(g).queryByRole("button", { name: "Qualificado" })).not.toBeInTheDocument();
    // "Nesta etapa desde…", e não "Em Em qualificação desde…"
    expect(within(g).getByText(/^Nesta etapa desde /)).toBeInTheDocument();
    expect(within(g).queryByText(/Em Em /)).not.toBeInTheDocument();

    fireEvent.click(within(g).getByRole("button", { name: "Etapa do lead: Em qualificação" }));
    const menu = within(g).getByRole("menu", { name: "Etapa do lead" });
    const opcoes = within(menu).getAllByRole("menuitemradio");
    // as 6 etapas, inclusive Ganho e Perdido
    expect(opcoes).toHaveLength(6);
    expect(within(menu).getByRole("menuitemradio", { name: "Ganho" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "Perdido" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "Em qualificação" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Qualificado" }));
    expect(within(g).queryByRole("menu")).not.toBeInTheDocument();
    expect(within(g).getByRole("button", { name: "Etapa do lead: Qualificado" })).toBeInTheDocument();
    const hist = within(g).getByRole("heading", { name: "Histórico de etapas" }).parentElement!;
    expect(within(hist).getAllByRole("listitem")[0]).toHaveTextContent(/Qualificadopor você/);
  });

  it("no computador, o topo da conversa não repete a bolinha nem o nome, que estão nas infos ao lado", () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Fernando Castro");
    const topo = topoDaConversa(g);
    expect(topo).not.toHaveTextContent("Fernando Castro");
    expect(topo).not.toHaveTextContent("FC");
    // as infos ao lado têm o nome, e a conversa continua com o nome para o leitor de tela
    expect(within(g).getByRole("heading", { name: "Fernando Castro" })).toBeInTheDocument();
    expect(within(g).getByRole("log", { name: "Mensagens com Fernando Castro" })).toBeInTheDocument();
  });

  it("no celular, onde as infos ficam na outra aba, o nome continua no topo da conversa", () => {
    const desfazer = celular();
    try {
      render(
        <Montar>
          <ComGaveta contatoId={idContato("fernando")} />
        </Montar>,
      );
      abrir();
      expect(topoDaConversa(gaveta("Fernando Castro"))).toHaveTextContent("Fernando Castro");
    } finally {
      desfazer();
    }
  });

  it("o movimento mais recente da Janete tem 'Desfazer' no histórico", () => {
    function PelaJanete() {
      const { acoes } = useExemplo();
      return (
        <button type="button" onClick={() => acoes.simularJanete({ tipo: "janete_move", contatoId: idContato("fernando"), etapaId: IDS.etapa.qualificado })}>
          a Janete move
        </button>
      );
    }
    render(
      <Montar>
        <PelaJanete />
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "a Janete move" }));
    abrir();
    const g = gaveta("Fernando Castro");
    expect(within(g).getByRole("button", { name: "Etapa do lead: Qualificado" })).toBeInTheDocument();
    fireEvent.click(within(g).getByRole("button", { name: "Desfazer: voltar para Em qualificação" }));
    expect(within(g).getByRole("button", { name: "Etapa do lead: Em qualificação" })).toBeInTheDocument();
    // o movimento mais recente agora é da pessoa: o "Desfazer" some
    expect(within(g).queryByRole("button", { name: /^Desfazer/ })).not.toBeInTheDocument();
  });

  it("no celular, ocupa a tela com as abas 'Conversa' e 'Sobre o lead' e o 'Voltar'", () => {
    const desfazer = celular();
    try {
      const aoFechar = vi.fn();
      render(
        <Montar>
          <ComGaveta contatoId={idContato("fernando")} aoFechar={aoFechar} />
        </Montar>,
      );
      abrir();
      const g = gaveta("Fernando Castro");
      const abas = within(g).getByRole("group", { name: "Mostrar" });
      // abre na conversa; as infos ficam na outra aba
      expect(within(abas).getByRole("button", { name: "Conversa" })).toHaveAttribute("aria-pressed", "true");
      expect(within(g).getByRole("log")).toBeInTheDocument();
      expect(within(g).queryByRole("heading", { name: "O que a Janete descobriu" })).not.toBeInTheDocument();
      fireEvent.click(within(abas).getByRole("button", { name: "Sobre o lead" }));
      expect(within(g).getByRole("heading", { name: "O que a Janete descobriu" })).toBeInTheDocument();
      expect(within(g).queryByRole("log")).not.toBeInTheDocument();
      fireEvent.click(within(g).getByRole("button", { name: "Voltar" }));
      expect(aoFechar).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      desfazer();
    }
  });

  it("admin vê o custo de IA e apaga o contato com confirmação; a gaveta fecha", () => {
    const aoFechar = vi.fn();
    render(
      <Montar>
        <ComGaveta contatoId={idContato("fernando")} aoFechar={aoFechar} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Fernando Castro");
    expect(within(g).getByRole("heading", { name: "Custo de IA" })).toBeInTheDocument();

    fireEvent.click(within(g).getByRole("button", { name: "Apagar contato" }));
    const confirma = within(g).getByRole("alertdialog");
    expect(confirma).toHaveTextContent("Apagar Fernando Castro? A conversa e as mídias vão junto.");
    fireEvent.click(within(confirma).getByRole("button", { name: "Cancelar" }));
    expect(within(g).queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("existe")).toHaveTextContent("sim");

    fireEvent.click(within(g).getByRole("button", { name: "Apagar contato" }));
    fireEvent.click(within(within(g).getByRole("alertdialog")).getByRole("button", { name: "Apagar contato" }));
    expect(screen.getByTestId("existe")).toHaveTextContent("não");
    expect(aoFechar).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a atendente também move para Ganho e Perdido pelo menu da etapa", () => {
    render(
      <Montar papel="atendente">
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Fernando Castro");
    fireEvent.click(within(g).getByRole("button", { name: "Etapa do lead: Em qualificação" }));
    const menu = within(g).getByRole("menu", { name: "Etapa do lead" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(6);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Perdido" }));
    expect(within(g).getByRole("button", { name: "Etapa do lead: Perdido" })).toBeInTheDocument();
  });

  it("a atendente não vê Apagar contato nem o custo de IA", () => {
    render(
      <Montar papel="atendente">
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    abrir();
    const g = gaveta("Fernando Castro");
    expect(within(g).queryByRole("button", { name: "Apagar contato" })).not.toBeInTheDocument();
    expect(within(g).queryByRole("heading", { name: "Custo de IA" })).not.toBeInTheDocument();
    // O resto da gaveta continua igual.
    expect(within(g).getByRole("heading", { name: "O que a Janete descobriu" })).toBeInTheDocument();
  });

  it("observações salvam ao sair do campo", () => {
    render(
      <Montar>
        <ComGaveta contatoId={idContato("fernando")} />
      </Montar>,
    );
    abrir();
    const campo = within(gaveta("Fernando Castro")).getByRole("textbox", { name: "Observações da equipe" });
    fireEvent.change(campo, { target: { value: "Prefere contato à tarde." } });
    fireEvent.blur(campo);
    // Fecha e abre de novo: o texto veio do exemplo, não do rascunho do campo.
    fireEvent.keyDown(gaveta("Fernando Castro"), { key: "Escape" });
    abrir();
    expect(within(gaveta("Fernando Castro")).getByRole("textbox", { name: "Observações da equipe" })).toHaveValue(
      "Prefere contato à tarde.",
    );
  });
});

/** A etapa que vira chat com quem a monta (o TelaKanban): troca de etapa e volta. */
function ComEtapa({
  inicial,
  aoVoltar,
  mostrar,
}: {
  inicial: string;
  aoVoltar: () => void;
  mostrar?: (contatoId: string) => boolean;
}) {
  const [etapa, setEtapa] = useState(inicial);
  return <EtapaChat etapaId={etapa} aoVoltar={aoVoltar} aoTrocarEtapa={setEtapa} mostrar={mostrar} />;
}

describe("EtapaChat", () => {
  it("mostra a lista da etapa (quem espera a equipe primeiro), abre a primeira conversa e troca de etapa pelas setas", () => {
    const aoVoltar = vi.fn();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={aoVoltar} />
      </Montar>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Em qualificação" })).toBeInTheDocument();
    const lista = screen.getByRole("navigation", { name: "Conversas desta etapa" });
    const linhas = within(lista).getAllByRole("button");
    expect(linhas.length).toBeGreaterThan(0);
    // Na ordem do quadro: quem espera a equipe vem antes dos outros.
    const estado = criarEstadoInicial(AGORA);
    const espera = (rotulo: string) => {
      const contato = estado.contatos.find((k) => rotulo.includes(k.nome ?? "\u0000"))!;
      return estaAguardando(estado.conversas.find((c) => c.contato_id === contato.id)!);
    };
    const flags = linhas.map((l) => espera(l.getAttribute("aria-label") ?? l.textContent ?? ""));
    expect(flags).toContain(true);
    expect(flags).toContain(false);
    expect(flags.indexOf(false)).toBeGreaterThan(flags.lastIndexOf(true));
    // A primeira já vem aberta ao lado (no computador), com a conversa encaixada, sem véu.
    expect(linhas[0]).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("log")).toBeInTheDocument();

    // No computador, só as setas (as abas são do celular).
    expect(screen.queryByRole("group", { name: "Trocar de etapa" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima etapa: Qualificado" }));
    expect(screen.getByRole("heading", { level: 2, name: "Qualificado" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Próxima etapa: Em negociação" }));
    expect(screen.getByRole("heading", { level: 2, name: "Em negociação" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Etapa anterior: Qualificado" }));
    expect(screen.getByRole("heading", { level: 2, name: "Qualificado" })).toBeInTheDocument();
  });

  it("no computador, a conversa encaixada não repete a bolinha nem o nome no topo (as infos estão ao lado)", () => {
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    const infos = screen.getByRole("complementary", { name: "Informações do lead" });
    const nome = within(infos).getByRole("heading", { level: 2 }).textContent ?? "";
    expect(nome).not.toBe("");
    const topo = screen.getByRole("group", { name: "Quem conduz a conversa" }).closest("header")!;
    expect(topo).not.toHaveTextContent(nome);
  });

  it("Esc no menu da etapa fecha só o menu: a etapa como chat continua aberta e o foco volta ao botão", () => {
    const aoVoltar = vi.fn();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={aoVoltar} />
      </Montar>,
    );
    const botao = screen.getByRole("button", { name: "Etapa do lead: Em qualificação" });
    fireEvent.click(botao);
    const menu = screen.getByRole("menu", { name: "Etapa do lead" });
    fireEvent.keyDown(within(menu).getByRole("menuitemradio", { name: "Em qualificação" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(aoVoltar).not.toHaveBeenCalled();
    expect(botao).toHaveFocus();
  });

  it("clicar numa linha abre aquela conversa", () => {
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    const lista = screen.getByRole("navigation", { name: "Conversas desta etapa" });
    const linhas = within(lista).getAllByRole("button");
    expect(linhas.length).toBeGreaterThan(1);
    fireEvent.click(linhas[1]!);
    expect(linhas[1]).toHaveAttribute("aria-current", "true");
    expect(linhas[0]).not.toHaveAttribute("aria-current");
  });

  it("Voltar ao quadro e Esc saem da etapa", () => {
    const aoVoltar = vi.fn();
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.qualificado} aoVoltar={aoVoltar} />
      </Montar>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao quadro" }));
    expect(aoVoltar).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("navigation", { name: "Conversas desta etapa" }), { key: "Escape" });
    expect(aoVoltar).toHaveBeenCalledTimes(2);
  });

  it("a busca e o filtro do quadro (mostrar) valem para a lista, que diz quantas de quantas; a linha não repete a etapa", () => {
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} mostrar={(id) => id === idContato("fernando")} />
      </Montar>,
    );
    const lista = screen.getByRole("navigation", { name: "Conversas desta etapa" });
    const linhas = within(lista).getAllByRole("button");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toHaveAccessibleName(/Fernando Castro/);
    expect(screen.getByText(/^1 de \d+ conversas$/)).toBeInTheDocument();
    // a etapa já está no título: a situação da linha não diz "· Em qualificação"
    expect(within(lista).queryByText(/· Em qualificação/)).not.toBeInTheDocument();
  });

  it("etapa vazia avisa", () => {
    render(
      <Montar>
        <ComEtapa inicial={IDS.etapa.em_qualificacao} aoVoltar={() => {}} />
      </Montar>,
    );
    // Esvazia a etapa movendo todo mundo para Novo pela própria tela.
    for (let volta = 0; volta < 30; volta++) {
      const lista = screen.getByRole("navigation", { name: "Conversas desta etapa" });
      const linhas = within(lista).queryAllByRole("button");
      if (!linhas.length) break;
      act(() => {
        fireEvent.click(linhas[0]!);
      });
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: /^Etapa do lead: / }));
      });
      act(() => {
        fireEvent.click(within(screen.getByRole("menu", { name: "Etapa do lead" })).getByRole("menuitemradio", { name: "Novo" }));
      });
    }
    expect(screen.getByText("Nenhuma conversa nesta etapa.")).toBeInTheDocument();
  });
});

describe("marcar como lida: a regra do Chat (decisão 6)", () => {
  /** Só a Ana em Em negociação, com 2 mensagens não lidas. */
  const soAna = () => {
    const e = criarEstadoInicial(AGORA);
    return {
      ...e,
      contatos: e.contatos.map((c) =>
        c.id === idContato("ana")
          ? { ...c, etapa_id: IDS.etapa.em_negociacao }
          : c.etapa_id === IDS.etapa.em_negociacao
            ? { ...c, etapa_id: IDS.etapa.qualificado }
            : c,
      ),
      conversas: e.conversas.map((c) => (c.id === idConversa("ana") ? { ...c, nao_lidas: 2 } : c)),
    };
  };

  function NaoLidas() {
    const { estado } = useExemplo();
    return <p data-testid="nao-lidas">{estado.conversas.find((c) => c.id === idConversa("ana"))?.nao_lidas}</p>;
  }

  function MontarAna({ children }: { children: React.ReactNode }) {
    return (
      <ProvedorPapel inicial="admin">
        <ProvedorDados exemplo={soAna} progredirEnvios={false} relogio={() => AGORA}>
          {children}
          <NaoLidas />
        </ProvedorDados>
      </ProvedorPapel>
    );
  }

  it("abrir pelo card (a gaveta) marca como lida na hora", async () => {
    render(
      <MontarAna>
        <ComGaveta contatoId={idContato("ana")} />
      </MontarAna>,
    );
    expect(screen.getByTestId("nao-lidas")).toHaveTextContent("2");
    abrir();
    await waitFor(() => expect(screen.getByTestId("nao-lidas")).toHaveTextContent("0"));
  });

  it("na etapa como chat, a conversa que abriu sozinha só vira lida na 1ª interação dentro dela", async () => {
    render(
      <MontarAna>
        <EtapaChat etapaId={IDS.etapa.em_negociacao} aoVoltar={() => {}} aoTrocarEtapa={() => {}} />
      </MontarAna>,
    );
    // abriu sozinha (a primeira da lista): quem só passou pela etapa não zera o aviso da equipe
    expect(screen.getByRole("log", { name: "Mensagens com Ana Clara Souza" })).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByTestId("nao-lidas")).toHaveTextContent("2");
    fireEvent.pointerDown(screen.getByRole("log", { name: "Mensagens com Ana Clara Souza" }));
    await waitFor(() => expect(screen.getByTestId("nao-lidas")).toHaveTextContent("0"));
  });
});

describe("classes dos CSS Modules da K2", () => {
  it.each(["GavetaLead", "EtapaChat"])("%s: cada classe declarada existe no .module.css", (nome) => {
    const pasta = path.resolve(__dirname, "../features/plataforma/kanban");
    const codigo = readFileSync(path.join(pasta, `${nome}.tsx`), "utf-8");
    const css = readFileSync(path.join(pasta, `${nome}.module.css`), "utf-8");
    const decl = /estilos as Classes<([^>]+)>/.exec(codigo);
    expect(decl).not.toBeNull();
    const classes = [...decl![1]!.matchAll(/"([\w-]+)"/g)].map((m) => m[1]!);
    const faltando = classes.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(faltando).toEqual([]);
  });
});
