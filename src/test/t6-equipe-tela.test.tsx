import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idTituloArea } from "@/features/plataforma/AreaVazia";
import {
  TRAVA_PROPRIO,
  TelaEquipe,
  conversasDoMembro,
  filaDaEquipe,
  idDoBotao,
} from "@/features/plataforma/equipe";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import {
  IDS,
  criarEstadoInicial,
  estaAguardando,
  useExemplo,
  type EstadoExemplo,
} from "@/features/plataforma/exemplo";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C4 da spec da Equipe (docs/spec-equipe.md): a tela inteira, com a fila, os cartões, a
// confirmação, o convite e os avisos. Monta a TelaEquipe num roteador de memória (os Links do Chat
// precisam dele), com o exemplo de relógio fixo; uma Sonda guarda o estado do provedor para conferir
// o que as ações mudaram. Os números saem do exemplo, nunca escritos à mão sem conferir.

const AGORA = new Date("2026-10-30T17:45:00.000Z"); // sexta, 14:45 em São Paulo

// A fila da tela conta a espera pelo relógio da máquina (Date.now), não pelo `relogio` do provedor:
// o Date falso põe a máquina no mesmo instante do exemplo, e a ordem e o "agora" não dependem do
// dia em que o teste roda. Só o Date: os timers continuam de verdade.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function montar(papel: Papel = "admin") {
  const sonda: { estado: EstadoExemplo | null } = { estado: null };
  function Sonda() {
    sonda.estado = useExemplo().estado;
    return null;
  }
  function Tela() {
    return (
      <>
        <TelaEquipe />
        <Sonda />
      </>
    );
  }
  const raiz = createRootRoute({ component: () => <Outlet /> });
  const equipe = createRoute({ getParentRoute: () => raiz, path: "/app/equipe", component: Tela });
  const chat = createRoute({ getParentRoute: () => raiz, path: "/app/chat", component: () => <h1>Chat</h1> });
  const router = createRouter({
    routeTree: raiz.addChildren([equipe, chat]),
    history: createMemoryHistory({ initialEntries: ["/app/equipe"] }),
  });
  render(
    <StrictMode>
      <ProvedorPapel inicial={papel}>
        <ProvedorDados exemplo={criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => AGORA}>
          <RouterProvider router={router} />
        </ProvedorDados>
      </ProvedorPapel>
    </StrictMode>,
  );
  await screen.findByRole("heading", { level: 1, name: "Equipe" });
  return { estado: () => sonda.estado! };
}

/** As ações da camada de dados são assíncronas (também no modo exemplo): espera a resposta e o React pintar. */
const assentar = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

const cartao = (nome: string) => screen.getByRole("article", { name: nome });
const fila = () => screen.getByRole("region", { name: /^Precisam de você/ });
const botao = (id: string) => document.getElementById(id) as HTMLButtonElement;
const confirmacao = () => screen.getByRole("alertdialog");
const aviso = () => screen.getByRole("status");

describe("TelaEquipe", () => {
  it("monta o cabeçalho com o h1 da área, a frase e o Convidar pessoa do admin", async () => {
    await montar();
    const h1 = screen.getByRole("heading", { level: 1, name: "Equipe" });
    expect(h1.id).toBe(idTituloArea("equipe"));
    expect(h1.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByText("Quem recebe os leads quando a Janete passa a vez.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Convidar pessoa" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Quem atende" })).toBeTruthy();
    expect(screen.queryByText("Só um admin convida pessoas, troca o papel e desativa.")).toBeNull();
  });

  it("desativar a Marina conta as conversas, devolve todas para a fila e troca o botão por Reativar", async () => {
    const t = await montar();
    const antes = t.estado();
    const nMarina = conversasDoMembro(antes, IDS.marina).length;
    const nFila = filaDaEquipe(antes, AGORA).length;
    expect(nMarina).toBe(3);
    expect(nFila).toBe(4);
    expect(within(fila()).getAllByRole("listitem")).toHaveLength(nFila);

    fireEvent.click(within(cartao("Marina")).getByRole("button", { name: "Desativar" }));
    const dlg = confirmacao();
    expect(within(dlg).getByRole("heading", { name: "Desativar Marina?" })).toBeTruthy();
    expect(within(dlg).getByText("Marina não vai mais conseguir entrar na plataforma.")).toBeTruthy();
    const itens = within(dlg).getAllByRole("listitem");
    expect(itens).toHaveLength(3);
    expect(itens[0]!.textContent).toBe(
      "As 3 conversas com Marina voltam para “Precisam de você”, para alguém da equipe assumir.",
    );
    expect(within(itens[0]!).getByText("As 3 conversas com Marina").tagName).toBe("B");
    expect(itens[1]!.textContent).toBe("As mensagens que Marina já mandou continuam nas conversas.");
    expect(itens[2]!.textContent).toBe("Dá para reativar depois, aqui na Equipe.");
    // O foco entra no caminho seguro.
    expect(document.activeElement).toBe(within(dlg).getByRole("button", { name: "Cancelar" }));

    fireEvent.click(within(dlg).getByRole("button", { name: "Desativar Marina" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await assentar();

    // A fila vai a 7, com as 3 que voltaram por último.
    const linhas = within(fila()).getAllByRole("listitem");
    expect(linhas).toHaveLength(7);
    expect(fila().querySelector("h2")!.getAttribute("aria-label")).toBe("Precisam de você, 7 conversas");
    // Acabaram de voltar: a espera delas é "agora" (no mesmo relógio do exemplo).
    linhas.slice(4).forEach((li) => expect(li.textContent).toContain("Estava com Marina · agora"));
    linhas.slice(0, 4).forEach((li) => expect(li.textContent).not.toContain("Estava com"));
    // As que voltaram ganham o realce.
    expect(linhas.slice(4).every((li) => li.hasAttribute("data-destaque"))).toBe(true);

    // O estado confere: 7 esperando, e a Marina sem conversas.
    const depois = t.estado();
    expect(depois.conversas.filter(estaAguardando)).toHaveLength(7);
    expect(conversasDoMembro(depois, IDS.marina)).toHaveLength(0);

    // O cartão vira desativado, com o Reativar (e o foco nele).
    const marina = cartao("Marina");
    expect(within(marina).getByText("Desativado")).toBeTruthy();
    const reativar = within(marina).getByRole("button", { name: "Reativar" });
    expect(document.activeElement).toBe(reativar);
    expect(aviso().textContent).toBe(
      "Marina não entra mais na plataforma. 3 conversas voltaram para “Precisam de você”.",
    );
  });

  it("reativar traz a Marina de volta sem as conversas e põe o foco no botão de papel", async () => {
    const t = await montar();
    fireEvent.click(within(cartao("Marina")).getByRole("button", { name: "Desativar" }));
    fireEvent.click(within(confirmacao()).getByRole("button", { name: "Desativar Marina" }));
    await assentar();
    fireEvent.click(within(cartao("Marina")).getByRole("button", { name: "Reativar" }));
    await assentar();
    expect(aviso().textContent).toBe("Marina pode entrar de novo na plataforma.");
    expect(t.estado().membros.find((m) => m.id === IDS.marina)!.ativo).toBe(true);
    expect(conversasDoMembro(t.estado(), IDS.marina)).toHaveLength(0);
    expect(document.activeElement).toBe(botao(idDoBotao({ tipo: "admin", id: IDS.marina })));
  });

  it("tornar a Marina admin deixa o seu cartão travado com a explicação de pedir a outro admin", async () => {
    const t = await montar();
    fireEvent.click(within(cartao("Marina")).getByRole("button", { name: "Tornar admin" }));
    const dlg = confirmacao();
    expect(within(dlg).getByRole("heading", { name: "Tornar Marina admin?" })).toBeTruthy();
    expect(
      within(dlg).getByText(
        "Marina vai poder convidar e desativar pessoas, trocar papéis e mexer na Configuração (WhatsApp, cérebro e chaves).",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Tornar admin" }));
    await assentar();

    expect(t.estado().membros.find((m) => m.id === IDS.marina)!.papel).toBe("admin");
    expect(aviso().textContent).toBe("Marina agora é admin.");
    // O botão de papel virou "Tornar atendente" e ficou com o foco.
    const virou = within(cartao("Marina")).getByRole("button", { name: "Tornar atendente" });
    expect(document.activeElement).toBe(virou);

    const voce = cartao("Você");
    expect(within(voce).getByText(TRAVA_PROPRIO)).toBeTruthy();
    expect(TRAVA_PROPRIO).toContain("peça a outro admin");
    const desativar = within(voce).getByRole("button", { name: "Desativar" });
    expect(desativar).toBeDisabled();
    const nota = document.getElementById(desativar.getAttribute("aria-describedby")!);
    expect(nota?.textContent).toBe(TRAVA_PROPRIO);
  });

  it("convidar com Enter cria o cartão novo, realça e mostra o aviso", async () => {
    const t = await montar();
    fireEvent.click(screen.getByRole("button", { name: "Convidar pessoa" }));
    const gaveta = screen.getByRole("dialog", { name: "Convidar pessoa" });
    const campo = within(gaveta).getByLabelText("E-mail");
    fireEvent.change(campo, { target: { value: "  Bia@Empresa.Exemplo " } });
    fireEvent.keyDown(campo, { key: "Enter" });
    // Enquanto a resposta não chega, o botão mostra "Criando".
    expect(within(gaveta).getByRole("button", { name: /Criando/ })).toBeTruthy();
    await assentar();

    expect(screen.queryByRole("dialog", { name: "Convidar pessoa" })).toBeNull();
    const novo = cartao("bia@empresa.exemplo");
    expect(novo.hasAttribute("data-destaque")).toBe(true);
    expect(within(novo).getByText("Convite criado hoje")).toBeTruthy();
    expect(t.estado().convites!.some((c) => c.email === "bia@empresa.exemplo")).toBe(true);
    expect(aviso().textContent).toBe(
      "Convite criado para bia@empresa.exemplo. Use Copiar link e compartilhe com a pessoa.",
    );
    // O foco volta ao "Convidar pessoa" (o fireEvent.click não dá foco ao botão, como no Safari).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Convidar pessoa" }));
  });

  it("fechar a gaveta devolve o foco ao Convidar pessoa mesmo quando o clique não deu foco a ele (Safari)", async () => {
    await montar();
    const convidar = screen.getByRole("button", { name: "Convidar pessoa" });
    // Como no Safari: o clique abre a gaveta sem pôr o foco no botão.
    expect(document.activeElement).not.toBe(convidar);
    fireEvent.click(convidar);
    const campo = within(screen.getByRole("dialog", { name: "Convidar pessoa" })).getByLabelText("E-mail");
    act(() => {
      fireEvent.keyDown(campo, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog", { name: "Convidar pessoa" })).toBeNull();
    expect(document.activeElement).toBe(convidar);

    (document.activeElement as HTMLElement).blur();
    fireEvent.click(convidar);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Convidar pessoa" })).getByRole("button", { name: "Cancelar" }));
    expect(document.activeElement).toBe(convidar);
  });

  it("o 2º clique de um duplo clique não fecha o diálogo, não confirma e não pede de novo", async () => {
    const t = await montar();
    fireEvent.click(botao(idDoBotao({ tipo: "desativar", id: IDS.marina })), { detail: 1 });
    const dlg = confirmacao();
    // O 2º mousedown cai no véu (fora da caixa): o diálogo fica.
    fireEvent.mouseDown(dlg.parentElement!, { detail: 2 });
    expect(screen.getByRole("alertdialog")).toBe(dlg);
    // Nem um 2º clique que caia em cima do botão de confirmar.
    fireEvent.click(within(dlg).getByRole("button", { name: "Desativar Marina" }), { detail: 2 });
    expect(screen.getByRole("alertdialog")).toBe(dlg);
    expect(t.estado().membros.find((m) => m.id === IDS.marina)!.ativo).toBe(true);
    // O clique simples no véu continua cancelando.
    fireEvent.mouseDown(dlg.parentElement!, { detail: 1 });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // Reativar: o cartão muda de lugar, e o 2º clique que cai no botão de papel não abre nada.
    fireEvent.click(botao(idDoBotao({ tipo: "desativar", id: IDS.marina })));
    fireEvent.click(within(confirmacao()).getByRole("button", { name: "Desativar Marina" }));
    await assentar();
    fireEvent.click(botao(idDoBotao({ tipo: "reativar", id: IDS.marina })), { detail: 1 });
    await assentar();
    fireEvent.click(botao(idDoBotao({ tipo: "admin", id: IDS.marina })), { detail: 2 });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(t.estado().membros.find((m) => m.id === IDS.marina)).toMatchObject({ ativo: true, papel: "atendente" });
  });

  it("o mesmo aviso duas vezes entra de novo na região viva (o leitor de tela lê de novo)", async () => {
    await montar();
    const reenviar = botao(idDoBotao({ tipo: "reenviar", id: IDS.convite }));
    fireEvent.click(reenviar);
    await assentar();
    const primeiro = aviso().firstElementChild;
    expect(primeiro?.textContent).toBe("Convite renovado para rodrigo@empresa.exemplo.");
    fireEvent.click(reenviar);
    await assentar();
    const segundo = aviso().firstElementChild;
    expect(segundo?.textContent).toBe("Convite renovado para rodrigo@empresa.exemplo.");
    expect(segundo).not.toBe(primeiro);
    expect(primeiro?.isConnected).toBe(false);
  });

  it("o erro do convite fica na gaveta, sem criar nada", async () => {
    const t = await montar();
    const antes = t.estado().convites!.length;
    fireEvent.click(screen.getByRole("button", { name: "Convidar pessoa" }));
    const gaveta = screen.getByRole("dialog", { name: "Convidar pessoa" });
    const campo = within(gaveta).getByLabelText("E-mail");
    fireEvent.change(campo, { target: { value: "marina@empresa.exemplo" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await assentar();

    expect(screen.getByRole("dialog", { name: "Convidar pessoa" })).toBe(gaveta);
    // O erro aparece no campo e é repetido na região de alerta da gaveta (para o leitor de tela).
    expect(within(gaveta).getAllByText("Marina já está na equipe.")).toHaveLength(2);
    expect(within(gaveta).getByRole("alert").textContent).toBe("Marina já está na equipe.");
    expect(t.estado().convites).toHaveLength(antes);
    expect(aviso().textContent).toBe("");
  });

  it("reenviar e cancelar o convite do exemplo", async () => {
    const t = await montar();
    const email = t.estado().convites!.find((c) => c.id === IDS.convite)!.email;
    expect(email).toBe("rodrigo@empresa.exemplo");
    const enviadoAntes = t.estado().convites!.find((c) => c.id === IDS.convite)!.enviado_em;

    fireEvent.click(within(cartao(email)).getByRole("button", { name: "Renovar" }));
    await assentar();
    expect(aviso().textContent).toBe(`Convite renovado para ${email}.`);
    expect(t.estado().convites!.find((c) => c.id === IDS.convite)!.enviado_em).toBe(AGORA.toISOString());
    expect(enviadoAntes).not.toBe(AGORA.toISOString());

    fireEvent.click(within(cartao(email)).getByRole("button", { name: "Cancelar convite" }));
    const dlg = confirmacao();
    expect(within(dlg).getByRole("heading", { name: `Cancelar o convite de ${email}?` })).toBeTruthy();
    expect(
      within(dlg).getByText("A pessoa não consegue mais entrar na equipe pelo link que recebeu por e-mail. Dá para convidar de novo depois."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(within(dlg).getByRole("button", { name: "Voltar" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar convite" }));
    await assentar();

    expect(screen.queryByRole("article", { name: email })).toBeNull();
    expect(t.estado().convites!.some((c) => c.id === IDS.convite)).toBe(false);
    expect(aviso().textContent).toBe(`Convite para ${email} cancelado. O link do e-mail não leva mais para a equipe.`);
    // Sem o cartão, o foco vai para o h1.
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Equipe" }));
  });

  it("cancelar o diálogo (botão ou Esc) devolve o foco ao botão de origem, sem mudar nada", async () => {
    const t = await montar();
    const origem = botao(idDoBotao({ tipo: "desativar", id: IDS.marina }));
    fireEvent.click(origem);
    fireEvent.click(within(confirmacao()).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(botao(idDoBotao({ tipo: "desativar", id: IDS.marina })));

    const papel = botao(idDoBotao({ tipo: "admin", id: IDS.marina }));
    fireEvent.click(papel);
    const dlg = confirmacao();
    act(() => {
      fireEvent.keyDown(dlg, { key: "Escape" });
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(botao(idDoBotao({ tipo: "admin", id: IDS.marina })));
    expect(t.estado().membros.find((m) => m.id === IDS.marina)).toMatchObject({ ativo: true, papel: "atendente" });
  });

  it("o Tab fica preso entre os botões do diálogo", async () => {
    await montar();
    fireEvent.click(botao(idDoBotao({ tipo: "desativar", id: IDS.marina })));
    const dlg = confirmacao();
    const cancelar = within(dlg).getByRole("button", { name: "Cancelar" });
    const confirmar = within(dlg).getByRole("button", { name: "Desativar Marina" });
    fireEvent.keyDown(dlg, { key: "Tab" });
    expect(document.activeElement).toBe(confirmar);
    fireEvent.keyDown(dlg, { key: "Tab" });
    expect(document.activeElement).toBe(cancelar);
    fireEvent.keyDown(dlg, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmar);
  });

  it("o atendente vê a fila e os cartões sem botões, sem convites e com a nota", async () => {
    const t = await montar("atendente");
    expect(t.estado().eu.id).toBe(IDS.marina);
    expect(screen.queryByRole("button", { name: "Convidar pessoa" })).toBeNull();
    expect(screen.getByText("Só um admin convida pessoas, troca o papel e desativa.")).toBeTruthy();
    expect(within(fila()).getAllByRole("listitem")).toHaveLength(filaDaEquipe(t.estado(), AGORA).length);
    const pessoas = screen.getByRole("region", { name: "Quem atende" });
    expect(within(pessoas).getAllByRole("article")).toHaveLength(2);
    expect(within(pessoas).queryAllByRole("button", { name: /Tornar|Desativar|Reativar|Renovar|Cancelar/ })).toHaveLength(0);
    expect(screen.queryByText("rodrigo@empresa.exemplo")).toBeNull();
  });
});
