import { StrictMode, type JSX } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CartaoPessoa, idDoBotao } from "@/features/plataforma/equipe/CartaoPessoa";
import {
  MAX_NO_CARTAO,
  TRAVA_UNICO_ADMIN,
  cartoesDaEquipe,
  filaDaEquipe,
  tempoNaFila,
  tempoNaFilaPorExtenso,
  type Cartao,
  type CartaoMembro,
  type ConversaNoCartao,
  type PedidoEquipe,
} from "@/features/plataforma/equipe/dados";
import { FilaEquipe } from "@/features/plataforma/equipe/FilaEquipe";
import {
  IDS,
  ProvedorExemplo,
  criarEstadoInicial,
  etapaDoContato,
  useExemplo,
  type EstadoBase,
  type EstadoExemplo,
} from "@/features/plataforma/exemplo";
import { nomeDoContato } from "@/features/plataforma/comum/LinhaConversa";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C2 da spec da Equipe (docs/spec-equipe.md): a fila "Precisam de você" e o cartão de cada
// pessoa. Os números saem do exemplo (filaDaEquipe e cartoesDaEquipe sobre o estado do provedor),
// nunca escritos à mão sem conferir. As peças ficam num roteador de memória, para os Links do Chat
// terem href de verdade.

const AGORA = new Date("2026-10-30T17:45:00.000Z"); // sexta, 14:45 em São Paulo

afterEach(cleanup);

type Peca = (estado: EstadoExemplo) => JSX.Element;

/** Monta a peça em /app/equipe, com o papel e o estado de partida, dentro do roteador de memória. */
async function montar(peca: Peca, opcoes: { papel?: Papel; inicial?: EstadoBase } = {}) {
  function Tela() {
    const { estado } = useExemplo();
    return peca(estado);
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
      <ProvedorPapel inicial={opcoes.papel ?? "admin"}>
        <ProvedorExemplo inicial={opcoes.inicial ?? criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => AGORA}>
          <RouterProvider router={router} />
        </ProvedorExemplo>
      </ProvedorPapel>
    </StrictMode>,
  );
  await screen.findByTestId("peca");
  return router;
}

const cartaoDe = (estado: EstadoExemplo, id: string): Cartao => {
  const c = cartoesDaEquipe(estado, AGORA).find((x) => (x.tipo === "membro" ? x.membro.id : x.convite.id) === id);
  if (!c) throw new Error(`sem cartão para ${id}`);
  return c;
};

/** Um cartão de membro com `n` conversas do exemplo (para o "Ver mais"). */
const comConversas = (estado: EstadoExemplo, n: number): CartaoMembro => {
  const base = cartaoDe(estado, IDS.marina) as CartaoMembro;
  const conversas: ConversaNoCartao[] = estado.conversas.slice(0, n).map((c) => {
    const contato = estado.contatos.find((x) => x.id === c.contato_id)!;
    return {
      conversaId: c.id,
      contatoId: c.contato_id,
      nome: nomeDoContato(contato),
      etapa: etapaDoContato(estado, c.contato_id),
      ultimaEm: c.ultima_mensagem_em,
    };
  });
  return { ...base, conversas };
};

const artigo = (nome: string) => screen.getByRole("article", { name: nome });

/* ---------- a fila ---------- */

describe("FilaEquipe", () => {
  it("lista quem espera, a que espera há mais tempo primeiro, com o link para o Chat", async () => {
    let itens: ReturnType<typeof filaDaEquipe> = [];
    await montar((estado) => {
      itens = filaDaEquipe(estado, AGORA);
      return (
        <div data-testid="peca">
          <FilaEquipe itens={itens} />
        </div>
      );
    });

    const fila = screen.getByRole("region", { name: "Precisam de você, 4 conversas" });
    expect(within(fila).getByText("A Janete passou estas conversas para a equipe e ninguém assumiu ainda.")).toBeTruthy();

    const links = within(fila).getAllByRole("link");
    // A ordem da spec (C1): Thiago, Rafael, Ricardo, Juliana.
    expect(links.map((l) => l.getAttribute("aria-label")?.split(" ")[0])).toEqual(["Thiago", "Rafael", "Ricardo", "Juliana"]);
    expect(links).toHaveLength(itens.length);

    itens.forEach((item, i) => {
      const link = links[i]!;
      expect(link.getAttribute("href")).toBe(`/app/chat?conversa=${item.conversaId}`);
      expect(link.getAttribute("aria-label")).toBe(
        `${item.nome}, ${item.motivo}, esperando ${tempoNaFilaPorExtenso(item.esperaS)}. Abrir no Chat`,
      );
      expect(link.textContent).toContain(`${item.motivo} · ${tempoNaFila(item.esperaS)}`);
      // A bolinha vermelha (data-longa) só a partir de 10 min.
      expect(!!link.querySelector("[data-longa]")).toBe(item.longa);
    });
    // Thiago espera há mais de 10 min; Juliana, há menos.
    expect(itens[0]!.longa).toBe(true);
    expect(itens[3]!.longa).toBe(false);
    expect(links[0]!.getAttribute("href")).toMatch(/^\/app\/chat\?conversa=cv-/);
  });

  it("o link leva ao Chat com a conversa", async () => {
    const router = await montar((estado) => (
      <div data-testid="peca">
        <FilaEquipe itens={filaDaEquipe(estado, AGORA)} />
      </div>
    ));
    const primeiro = screen.getAllByRole("link")[0]!;
    const href = primeiro.getAttribute("href")!;
    fireEvent.click(primeiro);
    expect(await screen.findByRole("heading", { name: "Chat" })).toBeTruthy();
    expect(router.state.location.href).toBe(href);
  });

  it("realça só os destacados", async () => {
    let alvo = "";
    await montar((estado) => {
      const itens = filaDaEquipe(estado, AGORA);
      alvo = itens[1]!.conversaId;
      return (
        <div data-testid="peca">
          <FilaEquipe itens={itens} destacados={[alvo]} />
        </div>
      );
    });
    const realcados = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-destaque"));
    expect(realcados).toHaveLength(1);
    expect(within(realcados[0]!).getByRole("link").getAttribute("href")).toBe(`/app/chat?conversa=${alvo}`);
  });

  it("sem ninguém esperando: o texto do vazio e o contador cinza", async () => {
    await montar(() => (
      <div data-testid="peca">
        <FilaEquipe itens={[]} />
      </div>
    ));
    const fila = screen.getByRole("region", { name: "Precisam de você, 0 conversas" });
    expect(within(fila).getByText("Ninguém esperando. A Janete está dando conta de todas as conversas agora.")).toBeTruthy();
    expect(within(fila).queryByRole("list")).toBeNull();
    expect(fila.querySelector("[data-zero]")?.textContent).toBe("0");
  });
});

/* ---------- os cartões ---------- */

describe("CartaoPessoa", () => {
  it("o cartão da Marina: papel, situação e as conversas com link para o Chat", async () => {
    let cartao: CartaoMembro | null = null;
    await montar((estado) => {
      cartao = cartaoDe(estado, IDS.marina) as CartaoMembro;
      return (
        <div data-testid="peca">
          <CartaoPessoa cartao={cartao} podeGerenciar aoPedir={() => {}} />
        </div>
      );
    });
    const c = cartao! as CartaoMembro;
    const el = artigo(c.nome);
    expect(within(el).getByText(c.membro.email)).toBeTruthy();
    expect(within(el).getByText("Atendente")).toBeTruthy();
    expect(within(el).getByText("Ativo")).toBeTruthy();
    expect(within(el).getByText("Conversas agora")).toBeTruthy();
    // A Marina tem 3 conversas no exemplo (C1).
    expect(c.conversas).toHaveLength(3);
    const links = within(el).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(c.conversas.map((v) => `/app/chat?conversa=${v.conversaId}`));
    links.forEach((l) => expect(l.getAttribute("href")).toMatch(/^\/app\/chat\?conversa=cv-/));
    expect(within(el).queryByRole("button", { name: /Ver mais/ })).toBeNull();
  });

  it("com 7 conversas, mostra 5 e o \"Ver mais 2\", que vira \"Mostrar menos\"", async () => {
    await montar((estado) => (
      <div data-testid="peca">
        <CartaoPessoa cartao={comConversas(estado, 7)} podeGerenciar aoPedir={() => {}} />
      </div>
    ));
    expect(MAX_NO_CARTAO).toBe(5);
    expect(screen.getAllByRole("link")).toHaveLength(5);
    const ver = screen.getByRole("button", { name: "Ver mais 2" });
    expect(ver.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(ver);
    expect(screen.getAllByRole("link")).toHaveLength(7);
    const menos = screen.getByRole("button", { name: "Mostrar menos" });
    expect(menos.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(menos);
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });

  it("sem conversa: \"Nenhuma conversa agora.\"", async () => {
    await montar((estado) => (
      <div data-testid="peca">
        <CartaoPessoa cartao={comConversas(estado, 0)} podeGerenciar aoPedir={() => {}} />
      </div>
    ));
    expect(screen.getByText("Nenhuma conversa agora.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("o seu cartão de único admin: os dois botões travados, com a explicação no aria-describedby", async () => {
    const aoPedir = vi.fn();
    await montar((estado) => (
      <div data-testid="peca">
        <CartaoPessoa cartao={cartaoDe(estado, IDS.voce)} podeGerenciar aoPedir={aoPedir} />
      </div>
    ));
    const el = artigo("Você");
    const botoes = within(el).getAllByRole("button");
    expect(botoes.map((b) => b.textContent)).toEqual(["Tornar atendente", "Desativar"]);
    const nota = within(el).getByText(TRAVA_UNICO_ADMIN).closest("p")!;
    expect(nota.id).not.toBe("");
    for (const b of botoes) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
      expect(b.getAttribute("aria-describedby")).toBe(nota.id);
      fireEvent.click(b);
    }
    expect(aoPedir).not.toHaveBeenCalled();
  });

  it("os botões da Marina pedem { tipo, id } e têm o id do DOM de idDoBotao", async () => {
    const aoPedir = vi.fn<(p: PedidoEquipe) => void>();
    await montar((estado) => (
      <div data-testid="peca">
        <CartaoPessoa cartao={cartaoDe(estado, IDS.marina)} podeGerenciar aoPedir={aoPedir} />
      </div>
    ));
    const admin = screen.getByRole("button", { name: "Tornar admin" });
    const desativar = screen.getByRole("button", { name: "Desativar" });
    expect(admin.id).toBe(idDoBotao({ tipo: "admin", id: IDS.marina }));
    expect(admin.id).toBe(`equipe-admin-${IDS.marina}`);
    expect(desativar.id).toBe(`equipe-desativar-${IDS.marina}`);
    expect(admin.hasAttribute("aria-describedby")).toBe(false);
    fireEvent.click(admin);
    fireEvent.click(desativar);
    expect(aoPedir.mock.calls).toEqual([[{ tipo: "admin", id: IDS.marina }], [{ tipo: "desativar", id: IDS.marina }]]);
  });

  it("membro desativado: o texto e só o Reativar", async () => {
    const inicial = criarEstadoInicial(AGORA);
    inicial.membros = inicial.membros.map((m) => (m.id === IDS.marina ? { ...m, ativo: false } : m));
    const aoPedir = vi.fn();
    let nome = "";
    await montar(
      (estado) => {
        const c = cartaoDe(estado, IDS.marina) as CartaoMembro;
        nome = c.nome;
        return (
          <div data-testid="peca">
            <CartaoPessoa cartao={c} podeGerenciar aoPedir={aoPedir} />
          </div>
        );
      },
      { inicial },
    );
    const el = artigo(nome);
    expect(within(el).getByText("Desativado")).toBeTruthy();
    expect(
      within(el).getByText(
        "Não entra mais na plataforma. As conversas que eram dessa pessoa voltaram para “Precisam de você”.",
      ),
    ).toBeTruthy();
    expect(within(el).queryByText("Conversas agora")).toBeNull();
    const botoes = within(el).getAllByRole("button");
    expect(botoes.map((b) => b.textContent)).toEqual(["Reativar"]);
    expect(botoes[0]!.id).toBe(`equipe-reativar-${IDS.marina}`);
    fireEvent.click(botoes[0]!);
    expect(aoPedir).toHaveBeenCalledWith({ tipo: "reativar", id: IDS.marina });
  });

  it("o convite: o e-mail como título, há quantos dias saiu, Renovar, Copiar link e Cancelar convite", async () => {
    const aoPedir = vi.fn<(p: PedidoEquipe) => void>();
    let email = "";
    await montar((estado) => {
      const c = cartaoDe(estado, IDS.convite);
      if (c.tipo === "convite") email = c.convite.email;
      return (
        <div data-testid="peca">
          <CartaoPessoa cartao={c} podeGerenciar aoPedir={aoPedir} destaque />
        </div>
      );
    });
    expect(email).toBe("rodrigo@empresa.exemplo");
    const el = artigo(email);
    expect(el.hasAttribute("data-destaque")).toBe(true);
    expect(within(el).getByRole("heading", { level: 3, name: email })).toBeTruthy();
    expect(within(el).getByText("Convidado para entrar na equipe")).toBeTruthy();
    expect(within(el).getByText("Atendente")).toBeTruthy();
    // Enviado ontem (17:20 de quinta, em São Paulo): 1 dia de calendário.
    expect(within(el).getByText("Convite criado há 1 dia")).toBeTruthy();
    expect(within(el).getByText("Ainda não aceitou com Google. Começa a receber conversas depois de entrar.")).toBeTruthy();
    expect(
      within(el).getByText("O convite vale por 7 dias. Use Renovar para estender a validade e Copiar link para compartilhar."),
    ).toBeTruthy();
    const reenviar = within(el).getByRole("button", { name: "Renovar" });
    const copiar = within(el).getByRole("button", { name: "Copiar link" });
    const cancelar = within(el).getByRole("button", { name: "Cancelar convite" });
    expect(reenviar.id).toBe(`equipe-reenviar-${IDS.convite}`);
    expect(copiar.id).toBe(`equipe-copiar-${IDS.convite}`);
    expect(cancelar.id).toBe(`equipe-cancelar-${IDS.convite}`);
    fireEvent.click(reenviar);
    fireEvent.click(copiar);
    fireEvent.click(cancelar);
    expect(aoPedir.mock.calls).toEqual([
      [{ tipo: "reenviar", id: IDS.convite }],
      [{ tipo: "copiar", id: IDS.convite }],
      [{ tipo: "cancelar", id: IDS.convite }],
    ]);
  });

  it("sem podeGerenciar, nenhum botão nem nota (as conversas continuam)", async () => {
    await montar((estado) => (
      <div data-testid="peca">
        {cartoesDaEquipe(estado).map((c) => (
          <CartaoPessoa key={c.tipo === "membro" ? c.membro.id : c.convite.id} cartao={c} podeGerenciar={false} aoPedir={() => {}} />
        ))}
        <CartaoPessoa cartao={comConversas(estado, 3)} podeGerenciar={false} aoPedir={() => {}} />
      </div>
    ));
    expect(screen.getAllByRole("article").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(TRAVA_UNICO_ADMIN)).toBeNull();
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });
});
