import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATRASO_CARREGANDO_MS,
  CONTEXTO_EXEMPLO,
  contagem,
  numero,
  ProvedorPainel,
  usePainelDashboard,
  variacaoDe,
  type Simulacao,
  type ValorPainelDashboard,
} from "@/features/plataforma/dashboard/dados";
import { CartaoContexto, ESPERA_MAXIMA_DO_POUSO_MS } from "@/features/plataforma/dashboard/versoes/final/Cartoes";
import {
  camadas,
  deslocamentoDoCapitulo,
  DICA,
  FAIXAS,
  FOLGA_CAPITULO,
  geometria,
  LINHAS,
  posicaoDaDica,
  recipiente,
} from "@/features/plataforma/dashboard/versoes/final/coreografia";
import { TelaDashboardFinal } from "@/features/plataforma/dashboard/versoes/final/TelaDashboardFinal";
import { zerarEstadoDoVoo } from "@/features/plataforma/dashboard/versoes/final/voo";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarEstadoInicial, estaAguardando, type EstadoBase } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// A versão final do Dashboard (docs/spec-dashboard-final.md e a seção 16 da spec principal, "Cada
// versão"), montada direto (sem o TelaDashboard), dentro dos provedores que ela usa e de um roteador
// de memória para os links. Sem IntersectionObserver no jsdom, o palco fica no modo "aberto": o funil
// já aberto, a faixa das etapas em fluxo e o `--p` em 1.

const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "u-1", email: "operador@exemplo.test", user_metadata: { nome: "equipe Teste" } } } })),
}));
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getUser } } }));

// O voo: um controle falso, para conferir que a entrada e a saída chamam pousar/voar/soltar (ou não chamam).
const voo = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn<(para: unknown, opcoes?: unknown) => Promise<void>>(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return { ...real, useVooJanete: () => voo };
});

// 14:45 em São Paulo (o "agora" dos protótipos).
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const relogio = () => new Date(AGORA);

let sonda: ValorPainelDashboard | null = null;
function Sonda() {
  sonda = usePainelDashboard();
  return null;
}

function montar({
  papel = "admin",
  simulacao = "normal",
  estrito = false,
  inicial = () => criarEstadoInicial(AGORA),
  componente = TelaDashboardFinal,
}: {
  papel?: "admin" | "atendente";
  simulacao?: Simulacao;
  estrito?: boolean;
  inicial?: () => EstadoBase;
  componente?: () => ReactElement;
} = {}) {
  const raiz = createRootRoute({
    component: () => (
      <ProvedorPapel inicial={papel}>
        <ProvedorDados progredirEnvios={false} relogio={relogio} exemplo={inicial}>
          <ProvedorPainel relogio={relogio} simulacaoInicial={simulacao}>
            <Sonda />
            <Outlet />
          </ProvedorPainel>
        </ProvedorDados>
      </ProvedorPapel>
    ),
  });
  const dashboard = createRoute({ getParentRoute: () => raiz, path: "/app/dashboard", component: componente });
  const outras = ["/app/chat", "/app/kanban", "/app/configuracao", "/app/contexto"].map((caminho) =>
    createRoute({ getParentRoute: () => raiz, path: caminho, component: () => <h1>{caminho}</h1> }),
  );
  const router = createRouter({
    routeTree: raiz.addChildren([dashboard, ...outras]),
    history: createMemoryHistory({ initialEntries: ["/app/dashboard"] }),
  });
  const arvore = <RouterProvider router={router} />;
  const r = render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore);
  return { ...r, router };
}

/** Um botão do canto falso, com o id que a casca usa. */
function gatilhoFalso() {
  const b = document.createElement("button");
  b.id = "janete-gatilho";
  b.type = "button";
  b.textContent = "Fale com a Janete";
  document.body.appendChild(b);
  return b;
}

/** Um matchMedia que só casa a consulta pedida (o celular ou o movimento reduzido). */
function comMidia(trecho: string) {
  const original = window.matchMedia;
  window.matchMedia = ((consulta: string) => ({
    matches: consulta.includes(trecho),
    media: consulta,
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

/** O estado do exemplo sem ninguém esperando (as conversas que esperavam voltam para a Janete). */
function semNinguemEsperando(): EstadoBase {
  const e = criarEstadoInicial(AGORA);
  return {
    ...e,
    conversas: e.conversas.map((c) => (estaAguardando(c) ? { ...c, modo: "janete", responsavel_id: null, motivo_humano: null, aguardando_humano_desde: null } : c)),
  };
}

const esperarTela = () => screen.findByRole("heading", { level: 1, name: /^Boa tarde/ });
const cartao = (id: string) => document.querySelector<HTMLElement>(`[data-dash="cartao"][data-cartao="${id}"]`);
const simboloJanete = () => document.querySelector<HTMLElement>('[data-dash="janete"] [data-estado]');
const botaoJanete = () => document.querySelector<HTMLElement>('[data-dash="janete"]')!.closest("button")!;
const faixa = () => screen.getByRole("navigation", { name: "Etapas do funil" });
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const MEDIDA = { top: 100, left: 100, width: 52, height: 52, bottom: 152, right: 152, x: 100, y: 100 } as DOMRect;
const PONTO = { x: 126, y: 126, tamanho: 52 };

beforeEach(() => {
  window.sessionStorage.clear();
  // não é a 1ª vez da aba: os números aparecem já no valor (sem a contagem de 600 ms)
  window.sessionStorage.setItem("janete-dashboard-visto", "1");
  voo.ativo = false;
  voo.pousar.mockClear();
  voo.voar.mockReset();
  voo.voar.mockImplementation(() => Promise.resolve());
  voo.soltar.mockClear();
  zerarEstadoDoVoo();
  sonda = null;
});

afterEach(() => {
  cleanup();
  document.getElementById("janete-gatilho")?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ---------- a página e os ganchos (14.5) ---------- */

describe("dv · versão final: a página e os ganchos", () => {
  it("renderiza sem erro, com o h1 da saudação e os ganchos da seção 14.5", async () => {
    montar();
    const h1 = await esperarTela();
    expect(h1).toHaveAttribute("id", "area-dashboard");
    expect(h1).toHaveAttribute("tabindex", "-1");
    expect(h1).toHaveTextContent(sonda!.painel.textos.saudacao);

    const pagina = document.querySelector('[data-dash="pagina"]');
    expect(pagina).toHaveAttribute("data-versao", "final");
    expect(pagina).toHaveAttribute("data-area", "dashboard");
    expect(pagina).toHaveAttribute("aria-labelledby", "area-dashboard");
    expect(pagina).toHaveAttribute("data-dash-fase", "repouso");
    // no jsdom não há palco: o funil fica aberto
    expect(pagina).toHaveAttribute("data-dash-modo", "aberto");

    for (const gancho of ["janete", "funil", "indice", "resultado"]) expect(document.querySelector(`[data-dash="${gancho}"]`), gancho).not.toBeNull();
    const palco = document.querySelector<HTMLElement>('[data-dash="palco"]');
    expect(palco).not.toBeNull();
    expect(palco!.style.getPropertyValue("--p")).toBe("1");

    for (const id of ["precisa", "contexto", "kanban", "saude", "conversas", "mensagens", "tempo", "custo"]) expect(cartao(id), id).not.toBeNull();
    expect(cartao("autonomia")).toBeNull();

    const capitulos = Array.from(document.querySelectorAll('[data-dash="capitulo"]')).map((c) => c.getAttribute("data-etapa"));
    expect(capitulos).toEqual([...sonda!.painel.funil.etapas.map((e) => e.etapaId), "sairam"]);
    // o símbolo já está no lugar (sem voo possível no jsdom: o botão do canto não existe)
    expect(simboloJanete()).toHaveAttribute("data-visivel");
    const lugar = document.querySelector<HTMLElement>('[data-dash="janete"]')!;
    expect(lugar.style.width).toBe(lugar.style.height);
    // o lugar da Janete é o centro do anel do "No Kanban agora" (o voo da D pousa ali)
    expect(cartao("kanban")!.contains(lugar)).toBe(true);
  });

  it("aguenta o StrictMode: monta duas vezes sem o botão do canto voltar", async () => {
    const g = gatilhoFalso();
    montar({ estrito: true });
    await esperarTela();
    await esperar(5);
    expect(g.style.visibility).toBe("hidden");
    expect(g).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.querySelectorAll('[data-dash="pagina"]')).toHaveLength(1);
  });

  it("no celular, a ordem é a da seção 11 com o Contexto depois do Precisa, e a Janete mora no herói", async () => {
    const restaurar = comMidia("max-width: 899px");
    try {
      montar();
      await esperarTela();
      const ordem = Array.from(document.querySelectorAll('[data-dash="cartao"]')).map((c) => c.getAttribute("data-cartao"));
      expect(ordem).toEqual(["precisa", "contexto", "conversas", "mensagens", "tempo", "custo", "kanban", "saude"]);
      expect(document.querySelector('[data-dash="pagina"]')).toHaveAttribute("data-dash-modo", "celular");
      const h1 = screen.getByRole("heading", { level: 1 });
      expect(h1.compareDocumentPosition(document.querySelector('[data-dash="janete"]')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      // a faixa do celular também tem a Janete no centro
      const itens = faixa().querySelectorAll(":scope > ol > li");
      expect(itens).toHaveLength(7);
      expect(within(itens[3] as HTMLElement).getByRole("button", { name: /Fale com a Janete/ })).toBeInTheDocument();
    } finally {
      restaurar();
    }
  });
});

/* ---------- mudança 1: "Precisa de você" ---------- */

describe("dv · versão final: Precisa de você (mudança 1)", () => {
  it("mostra o total do useExemplo, os 3 rostos sem o selo e o Abrir no Chat, que leva a /app/chat", async () => {
    const { router } = montar();
    await esperarTela();
    const esperado = criarEstadoInicial(AGORA).conversas.filter(estaAguardando).length;
    expect(esperado).toBeGreaterThan(1);
    expect(sonda!.painel.agora.aguardando.total).toBe(esperado);
    const precisa = cartao("precisa")!;
    expect(texto(precisa)).toContain(`${numero(esperado)} conversas esperando você`);

    // os 3 rostos que esperam há mais tempo, pelo nome (para o leitor de tela), sem selo e sem bolinhas extras
    const rostos = within(precisa).getByRole("list", { name: "As que esperam há mais tempo" });
    const itens = within(rostos).getAllByRole("listitem");
    expect(itens).toHaveLength(Math.min(3, esperado));
    sonda!.painel.agora.aguardando.itens.slice(0, 3).forEach((item, k) => expect(itens[k]).toHaveTextContent(item.nome));
    expect(within(precisa).queryAllByTestId("avatar-selo")).toHaveLength(0);
    expect(precisa.querySelector("[data-com-selo]")).toBeNull();
    // nada da lista antiga: nem o motivo nem a espera
    expect(texto(precisa)).not.toMatch(/min$|não lidas/);

    const abrir = within(precisa).getByRole("link", { name: "Abrir no Chat" });
    expect(abrir).toHaveAttribute("href", "/app/chat");
    await act(async () => {
      fireEvent.click(abrir);
    });
    expect(router.state.location.pathname).toBe("/app/chat");
  });

  it("com zero esperando: 'Ninguém esperando por você' e o mesmo botão", async () => {
    montar({ inicial: semNinguemEsperando });
    await esperarTela();
    expect(sonda!.painel.agora.aguardando.total).toBe(0);
    const precisa = cartao("precisa")!;
    expect(within(precisa).getByText("Ninguém esperando por você")).toBeInTheDocument();
    expect(within(precisa).queryByRole("list")).toBeNull();
    expect(within(precisa).getByRole("link", { name: "Abrir no Chat" })).toHaveAttribute("href", "/app/chat");
  });

  it("com a chave sem crédito, o admin lê a frase da fundação no cartão; o atendente, sem chave nem crédito", async () => {
    montar({ simulacao: "chave_sem_credito" });
    await esperarTela();
    const frase = sonda!.painel.textos.resumo;
    expect(frase).toMatch(/chave/);
    expect(within(cartao("precisa")!).getByText(frase)).toBeInTheDocument();
    cleanup();

    const { container } = montar({ papel: "atendente", simulacao: "chave_sem_credito" });
    await esperarTela();
    const fraseAtendente = sonda!.painel.textos.resumo;
    expect(within(cartao("precisa")!).getByText(fraseAtendente)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/chave|crédito|US\$/i);
  });
});

/* ---------- mudança 2: o cartão do Contexto ---------- */

describe("dv · versão final: o cartão do Contexto (mudança 2)", () => {
  it("fica embaixo do Precisa, na mesma coluna, mostra '6 de 8 campos' e leva a /app/contexto", async () => {
    const { router } = montar();
    await esperarTela();
    const precisa = cartao("precisa")!;
    const contexto = cartao("contexto")!;
    expect(contexto.parentElement).toBe(precisa.parentElement);
    expect(precisa.compareDocumentPosition(contexto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // a composição do "Precisa": o título e o atalho em cima; "6 de 8" grande, "campos" e a barrinha embaixo
    expect(within(contexto).getByRole("heading", { level: 2 })).toHaveTextContent("Contexto da Janete");
    expect(texto(contexto)).toContain(`${CONTEXTO_EXEMPLO.preenchidos} de ${CONTEXTO_EXEMPLO.total} campos`);
    expect(within(contexto).getByRole("img", { name: "6 de 8 campos preenchidos" })).toBeInTheDocument();
    const link = within(contexto).getByRole("link", { name: "Completar o contexto" });
    expect(link).toHaveAttribute("href", "/app/contexto");
    await act(async () => {
      fireEvent.click(link);
    });
    expect(router.state.location.pathname).toBe("/app/contexto");
  });

  it("completo: 'Contexto completo · versão 6' e 'Abrir o Contexto'", async () => {
    function Completo() {
      return <CartaoContexto entrada={false} ordem={0} contexto={{ preenchidos: 8, total: 8, versao: 6 }} />;
    }
    montar({ componente: Completo });
    await screen.findByRole("heading", { level: 2, name: /Contexto completo/ });
    const contexto = cartao("contexto")!;
    expect(texto(contexto)).toContain("Contexto completo · versão 6");
    expect(texto(contexto)).toContain("8 de 8 campos");
    expect(within(contexto).getByRole("link", { name: "Abrir o Contexto" })).toHaveAttribute("href", "/app/contexto");
  });
});

/* ---------- mudança 3: a Saúde em medidor ---------- */

describe("dv · versão final: a Saúde em medidor (mudança 3)", () => {
  const botoesDaSaude = (saude: HTMLElement) => within(within(saude).getByRole("list", { name: "Itens da saúde" })).getAllByRole("button");

  it("admin: 5 partes (sem o Contexto), a frase geral no centro e o Abrir a Configuração", async () => {
    montar();
    await esperarTela();
    const saude = cartao("saude")!;
    expect(within(saude).getByText(sonda!.painel.agora.saude.frase)).toBeInTheDocument();
    const nomes = botoesDaSaude(saude).map((b) => b.textContent);
    expect(nomes).toHaveLength(5);
    expect(nomes.map((n) => n!.split(",")[0])).toEqual(["WhatsApp", "Janete", "Modelo", "Áudio", "Problemas"]);
    expect(saude.querySelectorAll("svg path[data-estado]")).toHaveLength(5);
    expect(texto(saude)).not.toMatch(/Contexto|Completar/);
    // cada parte na cor do estado do item da fundação, na mesma ordem
    const itens = sonda!.painel.agora.saude.itens.filter((i) => i.id !== "contexto");
    Array.from(saude.querySelectorAll("svg path[data-estado]")).forEach((p, k) => expect(p).toHaveAttribute("data-estado", itens[k]!.estado));
    expect(within(saude).getByRole("link", { name: "Abrir a Configuração" })).toHaveAttribute("href", "/app/configuracao");
  });

  it("atendente: 3 partes (WhatsApp, a Janete respondendo e os problemas), sem a Configuração", async () => {
    montar({ papel: "atendente" });
    await esperarTela();
    const saude = cartao("saude")!;
    expect(botoesDaSaude(saude).map((b) => b.textContent!.split(",")[0])).toEqual(["WhatsApp", "Janete", "Problemas"]);
    expect(saude.querySelectorAll("svg path[data-estado]")).toHaveLength(3);
    expect(within(saude).queryByRole("link", { name: /Configuração/ })).toBeNull();
  });

  it("o detalhe abre na dica no foco, no hover e no clique, e fecha com Esc", async () => {
    montar();
    await esperarTela();
    const saude = cartao("saude")!;
    const whats = botoesDaSaude(saude)[0]!;
    const dica = document.getElementById(whats.getAttribute("aria-describedby")!)!;
    const item = sonda!.painel.agora.saude.itens.find((i) => i.id === "whatsapp")!;
    expect(dica).toHaveAttribute("role", "tooltip");
    expect(dica).toHaveTextContent(item.detalhe);
    expect(dica).not.toHaveAttribute("data-aberta");

    fireEvent.focus(whats);
    expect(dica).toHaveAttribute("data-aberta");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dica).not.toHaveAttribute("data-aberta");
    fireEvent.blur(whats);

    fireEvent.mouseEnter(whats.parentElement!);
    expect(dica).toHaveAttribute("data-aberta");
    // ao sair o ponteiro, a dica espera um pouco (dá para levar o ponteiro até ela, 1.4.13)
    fireEvent.mouseLeave(whats.parentElement!);
    expect(dica).toHaveAttribute("data-aberta");
    fireEvent.mouseEnter(whats.parentElement!);
    await esperar(200);
    expect(dica).toHaveAttribute("data-aberta");
    fireEvent.mouseLeave(whats.parentElement!);
    await esperar(200);
    expect(dica).not.toHaveAttribute("data-aberta");
    // aberta pelo mouse, também fecha com Esc
    fireEvent.mouseEnter(whats.parentElement!);
    expect(dica).toHaveAttribute("data-aberta");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dica).not.toHaveAttribute("data-aberta");
    fireEvent.mouseLeave(whats.parentElement!);
    await esperar(200);

    fireEvent.click(whats);
    expect(dica).toHaveAttribute("data-aberta");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dica).not.toHaveAttribute("data-aberta");
  });

  it("os Problemas abrem a lista do período no clique, e o Esc fecha e devolve o foco", async () => {
    montar();
    await esperarTela();
    const saude = cartao("saude")!;
    const problemas = botoesDaSaude(saude).at(-1)!;
    expect(sonda!.painel.resumo.problemas.length).toBeGreaterThan(0);
    expect(problemas).toHaveAttribute("aria-expanded", "false");
    problemas.focus();
    fireEvent.click(problemas);
    expect(problemas).toHaveAttribute("aria-expanded", "true");
    const lista = within(saude).getByRole("region", { name: /Problemas/ });
    for (const p of sonda!.painel.resumo.problemas) expect(within(lista).getByText(p.titulo)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(saude).queryByRole("region", { name: /Problemas/ })).toBeNull();
    expect(document.activeElement).toBe(problemas);
  });
});

/* ---------- mudança 4: os capítulos ---------- */

describe("dv · versão final: os capítulos (mudança 4)", () => {
  it("o cabeçalho da D (o nome e o número juntos, a frase da fundação) e o corpo da A, alternando de lado", async () => {
    montar();
    await esperarTela();
    const etapas = sonda!.painel.funil.etapas;
    const caps = Array.from(document.querySelectorAll<HTMLElement>('[data-dash="capitulo"]'));
    etapas.forEach((e, k) => {
      const cap = caps[k]!;
      const titulo = within(cap).getByRole("heading", { level: 2 });
      expect(texto(titulo)).toBe(`${e.nome} · ${contagem(e.chegaram, "lead chegou", "leads chegaram")}`);
      expect(within(cap).getByText(e.frase)).toBeInTheDocument();
      expect(cap).toHaveAttribute("data-lado", k % 2 ? "direita" : "esquerda");
      // o corpo da A: o cartão grande do fluxo, o "Agora nesta etapa" e a faixa de números
      expect(within(cap).getByRole("heading", { level: 3, name: e.tipo === "ganho" ? "Vendas" : "Fluxo" })).toBeInTheDocument();
      expect(within(cap).getByRole("heading", { level: 3, name: /^Agora nesta etapa/ })).toBeInTheDocument();
      expect(within(cap).getByRole("heading", { level: 3, name: `Os números de ${e.nome}` })).toBeInTheDocument();
      expect(within(cap).getByRole("link", { name: /Ver todos no Kanban/ })).toHaveAttribute("href", "/app/kanban");
    });
    // sem "· N" no título dos que saíram: a frase da fundação, logo embaixo, traz os três números
    const sairam = caps.at(-1)!;
    expect(texto(within(sairam).getByRole("heading", { level: 2 }))).toBe("Para onde foram os que saíram");
    expect(within(sairam).getByText(sonda!.painel.funil.fraseSaidas)).toBeInTheDocument();
    expect(sairam).toHaveAttribute("data-lado", etapas.length % 2 ? "direita" : "esquerda");
  });
});

/* ---------- mudança 5: a faixa das etapas com a Janete no centro ---------- */

describe("dv · versão final: a faixa das etapas com a Janete no centro (mudança 5)", () => {
  it("a faixa tem a Janete no centro, com 3 itens de cada lado", async () => {
    montar();
    await esperarTela();
    const nav = faixa();
    expect(nav).toHaveAttribute("data-dash", "indice");
    const itens = Array.from(nav.querySelectorAll<HTMLElement>(":scope > ol > li"));
    expect(itens).toHaveLength(7);
    const etapas = sonda!.painel.funil.etapas;
    const esperado = [etapas[0]!.nome, etapas[1]!.nome, etapas[2]!.nome, "Janete", etapas[3]!.nome, etapas[4]!.nome, "Para onde foram"];
    itens.forEach((li, k) => {
      if (k === 3) {
        expect(within(li).getByRole("button", { name: /^Fale com a Janete · Janete, atendendo$/ })).toBeInTheDocument();
        expect(within(li).queryByRole("link")).toBeNull();
      } else {
        expect(within(li).getByRole("link")).toHaveTextContent(esperado[k]!);
      }
    });
    // as setas: entre os 3 da esquerda e entre os da direita, nunca encostadas na Janete
    expect(itens[2]!.querySelector("svg")).toBeNull();
    expect(itens[0]!.querySelector("svg")).not.toBeNull();
    expect(itens[4]!.querySelector("svg")).not.toBeNull();
  });

  it("clicar na Janete da faixa clica no #janete-gatilho", async () => {
    const g = gatilhoFalso();
    const clique = vi.fn();
    g.addEventListener("click", clique);
    montar();
    await esperarTela();
    const janete = within(faixa()).getByRole("button", { name: /Fale com a Janete/ });
    expect(janete).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(janete);
    expect(clique).toHaveBeenCalledTimes(1);
  });

  it("os chips levam aos capítulos, com o foco no título", async () => {
    const rolar = vi.fn();
    const descritor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: rolar });
    try {
      montar();
      await esperarTela();
      const links = within(faixa()).getAllByRole("link");
      expect(links).toHaveLength(6);
      const segunda = sonda!.painel.funil.etapas[1]!;
      expect(links[1]).toHaveAccessibleName(`${segunda.nome}: ${contagem(segunda.chegaram, "chegou", "chegaram")}`);
      fireEvent.click(links[1]!);
      const titulo = document.getElementById(`dvf-cap-${segunda.etapaId}-titulo`)!;
      expect(titulo.tagName).toBe("H2");
      expect(document.activeElement).toBe(titulo);
      expect(rolar).toHaveBeenCalled();
      expect(links[1]).toHaveAttribute("aria-current", "true");
      fireEvent.click(links[5]!);
      expect(document.activeElement).toBe(document.getElementById("dvf-cap-sairam-titulo"));
    } finally {
      if (descritor) Object.defineProperty(Element.prototype, "scrollIntoView", descritor);
      else delete (Element.prototype as unknown as Record<string, unknown>)["scrollIntoView"];
    }
  });

  it("a coreografia: as colunas andam até o chip e a Janete entra com a faixa, pelo mesmo p, sem salto", () => {
    // antes da fase 3 nada anda nem aparece
    expect(camadas(0.8).lado).toBe(0);
    expect(camadas(0.8).janete).toBe(0);
    expect(camadas(0.82).janete).toBe(0);
    expect(camadas(0.85).lado).toBeGreaterThan(0);
    expect(camadas(0.85).lado).toBeLessThan(0.5);
    expect(camadas(0.85).janete).toBeGreaterThan(0);
    expect(camadas(0.9).janete).toBeGreaterThan(0.8);
    expect(camadas(0.95).lado).toBe(1);
    expect(camadas(0.95).janete).toBe(1);
    // ajuste 1: a Janete entra já na cor dela. A opacidade (min(1, janete × 12,5), Funil.module.css) fica
    // cheia enquanto ela ainda é um ponto (escala 0,35 + 0,65 × janete abaixo de 0,42, ~17 px): nunca o
    // disco translúcido e grande que parece a Janete parada
    for (let p = 0.8; p <= 1.0001; p += 0.001) {
      const n = camadas(p).janete;
      if (0.35 + 0.65 * n > 0.42) expect(Math.min(1, n * 12.5), `p ${p.toFixed(3)}`).toBe(1);
    }
    // a Janete termina de entrar antes de a faixa real assumir (sem salto na troca)
    expect(camadas(FAIXAS.troca).janete).toBe(1);
    expect(camadas(1)).toMatchObject({ lado: 1, janete: 1, ind: 1, chip: 1 });
    // as barras deitam na mesma janela em que a fileira e o cartão sobem (um tempo só)
    expect(FAIXAS.deita).toEqual(FAIXAS.indice);
    // contínuo e monótono: nenhum degrau maior que 3% entre dois pontos a 0,005 de distância
    let antes = camadas(0.75);
    for (let p = 0.755; p <= 1.0001; p += 0.005) {
      const c = camadas(p);
      expect(c.lado).toBeGreaterThanOrEqual(antes.lado);
      expect(c.janete).toBeGreaterThanOrEqual(antes.janete);
      expect(c.lado - antes.lado).toBeLessThan(0.08);
      expect(c.janete - antes.janete).toBeLessThan(0.08);
      antes = c;
    }
    // rolar para cima desfaz: o mesmo p dá o mesmo quadro
    expect(camadas(0.9)).toEqual(camadas(0.9));
  });

  it("a fase 3 num tempo só: nenhum quadro de 0,76 a 1 mostra o cartão vazio", () => {
    // As mesmas contas do CSS (Funil.module.css) para a coluna mais alta (v = 1): o número sobe por
    // --a-ind, a barra deita (--d) e a base dela sobe (--a-ind), e o pé do cartão vem do recipiente.
    for (const v of [824, 724]) {
      const g = geometria({ v, w: 1136, admin: true });
      const rolagem = { antes: 556, alcance: 556 + 2 * v };
      for (let p = 0.76; p <= 1.0001; p += 0.0025) {
        const c = camadas(p);
        const base = g.base1 + (56 - g.base1) * c.ind;
        const topoBarra = base - (g.bh1 - (g.bh1 - 3) * c.d[0]!);
        const topoNumero = 80 + 20 * c.cresce - 67 * c.ind;
        const n = c.n[0]!;
        const alturaNumero = c.ind < 0.5 ? 44 * 1.15 * (0.6364 + 0.3636 * n) * (1 - 0.6591 * c.ind) : 15 * 1.15 * (2.9333 - 1.9333 * c.ind);
        // entre o número e o topo da barra visível: nunca mais de ~40 px de branco
        expect(topoBarra - (topoNumero + alturaNumero), `p ${p.toFixed(4)}`).toBeLessThanOrEqual(40);
        expect(topoBarra - (topoNumero + alturaNumero), `p ${p.toFixed(4)}`).toBeGreaterThanOrEqual(0);
        // depois que o conteúdo de baixo saiu, o pé do cartão fica logo abaixo do pé das barras
        const { ch } = recipiente(c, g, rolagem);
        expect(ch - base, `p ${p.toFixed(4)}`).toBeGreaterThanOrEqual(11.99);
        if (p >= FAIXAS.esvazia[0] + FAIXAS.esvazia[1]) expect(ch - base, `p ${p.toFixed(4)}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it("o 1º capítulo sobe colado ao pé do cartão e chega ao lugar dele em p = 1, sem salto", () => {
    const v = 824;
    const g = geometria({ v, w: 1136, admin: true });
    const antes = 556;
    const viagem = 2 * v;
    const rolagem = { antes, alcance: antes + viagem };
    // a vista (v), o trilho (2 telas) e o recuo do detalhe (124 − v): o 1º capítulo no palco
    const topoCap = v + viagem + (124 - v);
    const folga = Math.max(FOLGA_CAPITULO, topoCap - viagem - (g.t2 + g.hs));
    const quadro = (p: number) => {
      const r = recipiente(camadas(p), g, rolagem);
      const natural = topoCap + Math.min(0, antes - p * rolagem.alcance);
      const dy = deslocamentoDoCapitulo(p, r, natural, folga);
      return { dy, topo: natural + dy, pe: r.cy + r.ch };
    };
    expect(quadro(1).dy).toBeCloseTo(0, 6);
    let anterior = quadro(0);
    for (let p = 0; p <= 1.0001; p += 0.002) {
      const q = quadro(p);
      // nunca em volta do funil: sempre abaixo do pé do cartão, com a folga
      expect(q.topo - q.pe, `p ${p.toFixed(3)}`).toBeGreaterThanOrEqual(FOLGA_CAPITULO - 0.01);
      // na fase 3, colado ao pé do cartão (nada de vão cinza no meio)
      if (p >= FAIXAS.indice[0]) expect(q.topo - q.pe, `p ${p.toFixed(3)}`).toBeCloseTo(folga, 6);
      // contínuo: nenhum salto entre dois quadros vizinhos
      expect(Math.abs(q.dy - anterior.dy), `p ${p.toFixed(3)}`).toBeLessThan(12);
      anterior = q;
    }
  });

  it("a geometria da faixa: 6 chips iguais, 16 px nas pontas e a Janete no centro exato", () => {
    for (const w of [876, 1136, 1500]) {
      const g = geometria({ v: 824, w, admin: true });
      expect(16 + 6 * g.cw + 4 * g.vao + g.nz + 16).toBeCloseTo(w, 6);
      const centroJanete = 16 + 3 * (g.cw + g.vao) - g.vao + g.nz / 2;
      expect(centroJanete).toBeCloseTo(w / 2, 6);
      expect(g.mini).toBeCloseTo(Math.max(24, g.cw - 24), 6);
    }
  });
});

/* ---------- o funil, o período, o papel e os estados (seção 16) ---------- */

describe("dv · versão final: o funil e o período", () => {
  it("o funil tem 5 etapas com os números da fundação, mais o Perdido", async () => {
    montar();
    await esperarTela();
    const funil = document.querySelector<HTMLElement>('[data-dash="funil"]')!;
    const etapas = sonda!.painel.funil.etapas;
    expect(etapas).toHaveLength(5);
    for (const e of etapas) {
      const coluna = funil.querySelector<HTMLElement>(`[data-etapa="${e.etapaId}"]`)!;
      expect(coluna, e.nome).not.toBeNull();
      expect(coluna).toHaveTextContent(e.nome);
      expect(coluna).toHaveTextContent(numero(e.chegaram));
    }
    expect(within(funil).getByRole("button", { name: /^Perdido:/ })).toBeInTheDocument();
    // o "Pergunte à Janete" responde com a frase montada pela fundação
    const pergunta = sonda!.painel.funil.perguntas[0]!;
    fireEvent.click(within(funil).getByRole("button", { name: pergunta.pergunta }));
    expect(within(funil).getByText(pergunta.resposta)).toBeInTheDocument();
  });

  it("trocar o período muda os números (com a variação pela fundação) e carrega por 400 ms", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    await esperarTela();
    const antes = sonda!.painel.resumo.conversas.atual!;
    expect(within(cartao("conversas")!).getByText(numero(antes))).toBeInTheDocument();
    expect(cartao("conversas")).toHaveTextContent(variacaoDe(sonda!.painel.resumo.conversas));

    fireEvent.click(screen.getByRole("radio", { name: "7 dias" }));
    expect(sonda!.carregando).toBe(true);
    expect(cartao("conversas")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector('[data-dash="resultado"]')).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ATRASO_CARREGANDO_MS + 10);
    });
    expect(sonda!.carregando).toBe(false);
    const depois = sonda!.painel.resumo.conversas.atual!;
    expect(depois).not.toBe(antes);
    expect(within(cartao("conversas")!).getByText(numero(depois))).toBeInTheDocument();
    expect(cartao("conversas")).toHaveTextContent(variacaoDe(sonda!.painel.resumo.conversas));
    // a região viva anuncia o período carregado
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(screen.getByRole("status")).toHaveTextContent(`Período carregado: ${sonda!.painel.periodo.rotulo}.`);
  });

  it("o 'Abrir o Kanban' do anel leva a /app/kanban", async () => {
    const { router } = montar();
    await esperarTela();
    const link = within(cartao("kanban")!).getByRole("link", { name: /Abrir o Kanban/ });
    expect(link).toHaveAttribute("href", "/app/kanban");
    await act(async () => {
      fireEvent.click(link);
    });
    expect(router.state.location.pathname).toBe("/app/kanban");
  });

  it("os botões de 'como contamos' dizem de qual métrica são", async () => {
    montar();
    await esperarTela();
    for (const nome of ["No Kanban agora", "Conversas", "Mensagens", "Tempo de resposta", "Custo de IA", "Funil do período"]) {
      expect(screen.getByRole("button", { name: `Como contamos: ${nome}` })).toBeInTheDocument();
    }
  });
});

describe("dv · versão final: o papel e os estados", () => {
  it("ver como atendente: nenhum 'US$', 'chave' nem 'crédito' na página inteira, e o custo vira 'Resolvidas só pela Janete'", async () => {
    const { container } = montar({ papel: "atendente" });
    await esperarTela();
    expect(sonda!.painel.papel).toBe("atendente");
    expect(container.innerHTML).not.toMatch(/US\$/);
    expect(container.textContent).not.toMatch(/chave|crédito|US\$/i);
    expect(cartao("custo")).toBeNull();
    expect(cartao("autonomia")).not.toBeNull();
  });

  it("período vazio: os cartões dizem que nenhum lead chegou, sem capítulos nem faixa; o agora continua", async () => {
    montar({ simulacao: "periodo_vazio" });
    await esperarTela();
    expect(sonda!.painel.vazio).toBe(true);
    expect(screen.getAllByText("Nenhum lead chegou neste período").length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll('[data-dash="capitulo"]')).toHaveLength(0);
    expect(document.querySelector('[data-dash="indice"]')).toBeNull();
    expect(texto(cartao("precisa"))).toContain(numero(sonda!.painel.agora.aguardando.total));
    fireEvent.click(screen.getByRole("button", { name: "Ver os últimos 90 dias" }));
    expect(sonda!.idPeriodo).toBe("90d");
  });

  it("chave sem crédito: a linha de resumo, a Saúde vermelha e a Janete dormindo (no anel e na faixa)", async () => {
    montar({ simulacao: "chave_sem_credito" });
    await esperarTela();
    expect(screen.getAllByText("A Janete parou às 14:28: a chave da IA ficou sem crédito").length).toBeGreaterThanOrEqual(1);
    expect(within(cartao("saude")!).getByText("A Janete parou")).toBeInTheDocument();
    expect(simboloJanete()).toHaveAttribute("data-estado", "dormindo");
    expect(botaoJanete()).toHaveAccessibleName(/Janete, parada/);
    expect(within(faixa()).getByRole("button", { name: /Janete, parada/ })).toBeInTheDocument();
  });

  it("WhatsApp caiu: a linha de resumo, a Janete parada (no anel e na faixa) e o WhatsApp parado na Saúde", async () => {
    montar({ simulacao: "whatsapp_caiu" });
    await esperarTela();
    const frase = sonda!.painel.textos.resumo;
    expect(frase).toMatch(/WhatsApp/);
    expect(within(cartao("precisa")!).getByText(frase)).toBeInTheDocument();
    expect(simboloJanete()).toHaveAttribute("data-estado", "dormindo");
    expect(within(faixa()).getByRole("button", { name: /Janete, parada/ })).toBeInTheDocument();
    const whats = within(cartao("saude")!).getByRole("button", { name: /^WhatsApp/ });
    expect(whats).toHaveAttribute("data-estado", sonda!.painel.agora.saude.itens.find((i) => i.id === "whatsapp")!.estado);
    expect(whats.getAttribute("data-estado")).not.toBe("ok");
  });

  it("atendente: a lista de Problemas abre com títulos neutros (sem chave, crédito nem US$)", async () => {
    montar({ papel: "atendente", simulacao: "chave_sem_credito" });
    await esperarTela();
    const problemas = sonda!.painel.resumo.problemas;
    expect(problemas.length).toBeGreaterThan(0);
    const saude = cartao("saude")!;
    fireEvent.click(within(saude).getByRole("button", { name: /^Problemas/ }));
    const lista = within(saude).getByRole("region", { name: /Problemas/ });
    for (const p of problemas) expect(within(lista).getByText(p.titulo)).toBeInTheDocument();
    expect(lista.textContent).not.toMatch(/chave|crédito|US\$/i);
  });

  it("a Janete parada é anunciada na região viva", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    await esperarTela();
    act(() => {
      sonda!.setSimulacao("chave_sem_credito");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ATRASO_CARREGANDO_MS + 100);
    });
    expect(screen.getByRole("status")).toHaveTextContent(sonda!.painel.textos.resumo);
  });

  it("carregando: os cartões de período mostram esqueletos e o agora não", async () => {
    montar({ simulacao: "carregando" });
    await esperarTela();
    expect(cartao("conversas")).toHaveAttribute("aria-busy", "true");
    expect(cartao("precisa")).not.toHaveAttribute("aria-busy");
    expect(simboloJanete()).toHaveAttribute("data-estado", "carregando");
  });
});

/* ---------- a Janete e o botão do canto (o voo da D) ---------- */

describe("dv · versão final: a Janete e o botão do canto", () => {
  it("o #janete-gatilho fica escondido enquanto o Dashboard está montado e volta ao desmontar", async () => {
    const g = gatilhoFalso();
    const { unmount } = montar();
    await esperarTela();
    expect(g.style.visibility).toBe("hidden");
    expect(g).toHaveAttribute("aria-hidden", "true");
    unmount();
    await esperar(5);
    expect(g.style.visibility).toBe("");
    expect(g).not.toHaveAttribute("aria-hidden");
  });

  it("clicar no símbolo da Janete no anel clica no #janete-gatilho", async () => {
    const g = gatilhoFalso();
    const clique = vi.fn();
    g.addEventListener("click", clique);
    montar();
    await esperarTela();
    const botao = botaoJanete();
    expect(botao).toHaveAccessibleName(/Fale com a Janete/);
    fireEvent.click(botao);
    expect(clique).toHaveBeenCalledTimes(1);
  });

  it("movimento reduzido: sem voo, o símbolo já está no lugar e o botão do canto some do mesmo jeito", async () => {
    const g = gatilhoFalso();
    g.getBoundingClientRect = () => ({ top: 800, left: 16, width: 52, height: 52, bottom: 852, right: 68, x: 16, y: 800 }) as DOMRect;
    const restaurar = comMidia("prefers-reduced-motion");
    try {
      montar();
      await esperarTela();
      expect(voo.pousar).not.toHaveBeenCalled();
      expect(voo.voar).not.toHaveBeenCalled();
      expect(simboloJanete()).toHaveAttribute("data-visivel");
      expect(g.style.visibility).toBe("hidden");
      expect(document.querySelector('[data-dash="pagina"]')).toHaveAttribute("data-dash-modo", "aberto");
    } finally {
      restaurar();
    }
  });

  it("com o botão do canto medível, a Janete voa até o lugar dela no anel e aparece no pouso", async () => {
    gatilhoFalso();
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => MEDIDA;
    try {
      montar();
      await esperarTela();
      await esperar(20);
      expect(voo.pousar).toHaveBeenCalledWith(PONTO, "acordada");
      expect(voo.voar).toHaveBeenCalledTimes(1);
      expect(voo.soltar).toHaveBeenCalled();
      expect(simboloJanete()).toHaveAttribute("data-visivel");
      expect(simboloJanete()).toHaveAttribute("data-pousou");
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
  });
});

describe("dv · versão final: a saída com a página rolada", () => {
  it("com o anel fora da tela (e sem a faixa à vista), a saída não pousa nem voa: só devolve o botão do canto", async () => {
    const g = gatilhoFalso();
    const FORA = { top: -2000, left: 100, width: 52, height: 52, bottom: -1948, right: 152, x: 100, y: -2000 } as DOMRect;
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.id === "janete-gatilho" ? MEDIDA : FORA;
    };
    try {
      const { unmount } = montar();
      await esperarTela();
      await esperar(20);
      voo.pousar.mockClear();
      voo.voar.mockClear();
      unmount();
      await esperar(20);
      expect(voo.pousar).not.toHaveBeenCalled();
      expect(voo.voar).not.toHaveBeenCalled();
      expect(g.style.visibility).toBe("");
      expect(g).not.toHaveAttribute("aria-hidden");
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("com o anel na tela, a saída parte dele (pousa e voa de volta ao canto)", async () => {
    gatilhoFalso();
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => MEDIDA;
    try {
      const { unmount } = montar();
      await esperarTela();
      await esperar(20);
      voo.pousar.mockClear();
      voo.voar.mockClear();
      unmount();
      await esperar(20);
      expect(voo.pousar).toHaveBeenCalledWith(PONTO, expect.anything());
      expect(voo.voar).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
  });
});

/* ---------- os 4 ajustes do equipe (31/10, olhando a prancha rodando) ---------- */

/** O palco em 1440 × 900 (v = 824) e numa janela mais baixa (v = 724), com o funil começando a 556 px. */
function cenaDoPalco(v: number) {
  const g = geometria({ v, w: 1136, admin: true });
  const antes = 556;
  const viagem = 2 * v;
  const rolagem = { antes, alcance: antes + viagem };
  // a vista (v), o trilho (2 telas) e o recuo do detalhe (124 − v): o 1º capítulo no palco
  const topoCap = v + viagem + (124 - v);
  const folga = Math.max(FOLGA_CAPITULO, topoCap - viagem - (g.t2 + g.hs));
  const quadro = (p: number) => {
    const c = camadas(p);
    const r = recipiente(c, g, rolagem);
    const natural = topoCap + Math.min(0, antes - p * rolagem.alcance);
    const topoCapitulo = natural + deslocamentoDoCapitulo(p, r, natural, folga);
    // o pé visível das barras (todas sobem pelo mesmo --a-ind) e o fim das métricas e das quedas abertas
    const peBarras = g.base1 + (56 - g.base1) * c.ind;
    return { c, r, topoCapitulo, peBarras, dicaY: posicaoDaDica(c, r, g.v) };
  };
  return {
    g,
    quadro,
    fimMetricas: g.base1 + LINHAS.quedaFolga + LINHAS.quedaAltura + LINHAS.metricaFolga + 3 * LINHAS.metricaLinha,
    fimQuedas: g.base1 + LINHAS.quedaFolga + LINHAS.quedaAltura,
  };
}

describe("dv · versão final: os 4 ajustes do equipe", () => {
  it("ajuste 1: o cartão encolhe junto com o conteúdo, a Janete entra na cor dela e o 1º capítulo aparece colado embaixo", () => {
    for (const v of [824, 724]) {
      const { g, quadro, fimMetricas, fimQuedas } = cenaDoPalco(v);
      for (let p = 0.72; p <= 1.0001; p += 0.0025) {
        const { c, r, topoCapitulo, peBarras } = quadro(p);
        const rot = `v ${v} · p ${p.toFixed(4)}`;
        // o pé do cartão nunca corta um texto que ainda se vê: passa pelas métricas com elas abaixo de 3%
        // de opacidade e pelas quedas com elas já sumidas
        if (r.ch < fimMetricas - 0.5) expect(1 - c.sai, rot).toBeLessThanOrEqual(0.03);
        if (r.ch < fimQuedas - 0.5) expect(1 - c.sai, rot).toBeLessThanOrEqual(0.001);
        // o recorte acompanha as barras: depois que o pé subiu, ele fica 12 px abaixo do pé visível delas
        // (nunca um cartão alto com as barras reduzidas a linhas no pé)
        if (p >= FAIXAS.esvazia[0] + FAIXAS.esvazia[1]) expect(r.ch - peBarras, rot).toBeCloseTo(12, 6);
        // o 1º capítulo: com 120 px ou mais dele à vista, já está pelo menos na metade (sem vão cinza vazio)
        if (g.v - topoCapitulo >= 120) expect(c.capitulo, rot).toBeGreaterThanOrEqual(0.45);
        // e sempre colado ao pé do cartão (a folga de p = 1)
        if (p >= FAIXAS.indice[0]) expect(topoCapitulo - (r.cy + r.ch), rot).toBeCloseTo(48, 6);
      }
    }
    // os 5 quadros que o equipe olhou (1440 × 900)
    const { quadro } = cenaDoPalco(824);
    const q = (p: number) => quadro(p);
    // 0,8: o conteúdo aberto já sumiu, o pé do cartão está terminando de subir (~100 px abaixo do pé das
    // barras, contra os ~300 de antes) e o 1º capítulo já aparece logo embaixo
    expect(q(0.8).c.sai).toBe(1);
    expect(q(0.8).r.ch - q(0.8).peBarras).toBeLessThan(110);
    expect(q(0.8).c.capitulo).toBeGreaterThan(0.7);
    // 0,85: o cartão do tamanho das barras; o capítulo inteiro embaixo; a Janete entrando, já opaca
    expect(q(0.85).r.ch - q(0.85).peBarras).toBeCloseTo(12, 6);
    expect(q(0.85).c.capitulo).toBe(1);
    expect(Math.min(1, q(0.85).c.janete * 12.5)).toBe(1);
    // 0,9 e 0,95: o cartão encolhendo com as barras; a Janete perto do tamanho final
    expect(q(0.9).r.ch).toBeLessThan(q(0.85).r.ch);
    expect(q(0.95).r.ch).toBeLessThan(q(0.9).r.ch);
    expect(q(0.95).c.janete).toBe(1);
    // 1: a faixa (68 px) presa a 8 px do topo, o capítulo começando 48 px abaixo dela
    expect(q(1).r.ch).toBeCloseTo(68, 6);
    expect(q(1).r.cy).toBeCloseTo(8, 6);
    expect(q(1).topoCapitulo).toBeCloseTo(124, 6);
  });

  it("ajuste 4: a pílula de rolar fica à vista na dobra e no funil aberto, no pé do cartão, e some quando a faixa se forma", () => {
    for (const v of [824, 724]) {
      const { g, quadro, fimMetricas } = cenaDoPalco(v);
      let anterior: number | null = null;
      for (let p = 0; p <= FAIXAS.dica[0] + 1e-9; p += 0.0025) {
        const { c, r, dicaY } = quadro(p);
        const rot = `v ${v} · p ${p.toFixed(4)}`;
        expect(c.dica, rot).toBe(1);
        // inteira na tela (16 px acima do fim dela, no máximo)
        const topoNaTela = r.cy + r.vy + dicaY;
        expect(topoNaTela + DICA.altura, rot).toBeLessThanOrEqual(g.v - DICA.margemTela + 0.01);
        expect(topoNaTela, rot).toBeGreaterThan(0);
        // com o funil aberto: na linha dela no pé do cartão, embaixo das métricas e dentro do cartão
        if (p >= 0.46) {
          expect(dicaY, rot).toBeGreaterThanOrEqual(fimMetricas + 8);
          expect(dicaY + DICA.altura, rot).toBeLessThanOrEqual(r.ch - 12);
        }
        // contínua: anda com a rolagem, sem pulo
        if (anterior !== null) expect(Math.abs(topoNaTela - anterior), rot).toBeLessThan(24);
        anterior = topoNaTela;
      }
    }
    // some com a formação da faixa, ligada ao p (antes de o pé do cartão subir)
    expect(camadas(0.735).dica).toBeGreaterThan(0);
    expect(camadas(0.735).dica).toBeLessThan(1);
    expect(camadas(FAIXAS.esvazia[0]).dica).toBe(0);
    expect(camadas(0.8).dica).toBe(0);
  });

  it("ajuste 4 sem palco: a pílula fica no pé do cartão do funil, com a faixa das etapas logo depois; no celular e no período vazio, não", async () => {
    montar();
    await esperarTela();
    const funil = document.querySelector<HTMLElement>('[data-dash="funil"]')!;
    const dica = funil.querySelector<HTMLElement>('[data-dash="dica-rolar"]')!;
    expect(dica).not.toBeNull();
    expect(texto(dica)).toBe("Role para ver cada etapa");
    expect(dica).toHaveAttribute("aria-hidden", "true");
    expect(dica.querySelector("svg")).not.toBeNull();
    // a última coisa do cartão, e a faixa das etapas vem logo depois do cartão
    expect(funil.lastElementChild === dica || funil.lastElementChild?.previousElementSibling === dica).toBe(true);
    expect(funil.nextElementSibling).toBe(faixa());
    cleanup();

    montar({ simulacao: "periodo_vazio" });
    await esperarTela();
    expect(document.querySelector('[data-dash="dica-rolar"]')).toBeNull();
    cleanup();

    const restaurar = comMidia("max-width: 899px");
    try {
      montar();
      await esperarTela();
      expect(document.querySelector('[data-dash="dica-rolar"]')).toBeNull();
    } finally {
      restaurar();
    }
  });

  it("ajuste 2: o 'Agora nesta etapa' e o 'Em Perdido agora' ficam ao lado do bloco grande, com o 'Ver todos no Kanban' no pé", async () => {
    montar();
    await esperarTela();
    const caps = Array.from(document.querySelectorAll<HTMLElement>('[data-dash="capitulo"]'));
    expect(caps).toHaveLength(6);
    for (const cap of caps) {
      const titulo = within(cap).getByRole("heading", { level: 3, name: /^(Agora nesta etapa|Em Perdido agora)/ });
      const bloco = titulo.parentElement!;
      const link = within(bloco).getByRole("link", { name: /Ver todos no Kanban/ });
      // o link é o último do cartão (preso no pé), e a lista (ou o "Ninguém...") fica no alto, logo abaixo do título
      expect(bloco.lastElementChild, cap.dataset["etapa"]).toBe(link);
      expect(bloco.firstElementChild).toBe(titulo);
      // lado a lado com o bloco grande (o Fluxo, as Vendas ou "Por etapa de origem"), na mesma grade
      const grande = within(cap).getByRole("heading", { level: 3, name: /^(Fluxo|Vendas|Por etapa de origem)$/ }).parentElement!;
      expect(grande.parentElement).toBe(bloco.parentElement);
    }
  });

  it("ajuste 3: o 'Precisa de você' num azul claro com o texto escuro, e o botão no azul da Janete (AA)", () => {
    const css = readFileSync(path.resolve(__dirname, "../features/plataforma/dashboard/versoes/final/Resumo.module.css"), "utf-8");
    const bloco = (seletor: string) => {
      const i = css.indexOf(`\n${seletor} {`);
      expect(i, seletor).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf("\n}", i));
    };
    const precisa = bloco("div.precisa");
    // nada do azul cheio nem do texto branco
    expect(precisa).not.toMatch(/background:\s*var\(--sb-azul\)\s*;/);
    expect(precisa).toMatch(/color:\s*var\(--sb-tinta\)/);
    const tons = [...precisa.matchAll(/color-mix\(in srgb, var\(--sb-azul\) (\d+)%, var\(--sb-branco\)\)/g)].map((m) => Number(m[1]));
    expect(tons.length).toBeGreaterThan(0);
    for (const t of tons) expect(t).toBeLessThanOrEqual(20);
    expect(bloco(".precisaRotulo")).toMatch(/color:\s*var\(--sb-tinta\)/);
    // o botão: o azul da Janete com o texto em azul-marinho (5,4:1); branco sobre ele seria 3,27:1
    const botao = bloco(".precisaBotao");
    expect(botao).toMatch(/background:\s*var\(--sb-azul\)/);
    expect(botao).toMatch(/color:\s*var\(--sb-navy\)/);
  });

  it("ajuste 3: no jsdom (sem voo), as etapas, os números, o 'esfriando' e a 'Janete em N conversas' estão no cartão do anel, já no lugar", async () => {
    montar();
    await esperarTela();
    const kanban = cartao("kanban")!;
    expect(kanban).not.toHaveAttribute("data-chegada");
    const { kanban: etapas, esfriando, janeteAtiva } = sonda!.painel.agora;
    for (const e of etapas) {
      const item = Array.from(kanban.querySelectorAll("li")).find((li) => li.textContent?.includes(e.nome));
      expect(item, e.nome).toBeDefined();
      expect(item).toHaveTextContent(numero(e.n));
    }
    expect(esfriando).toBeGreaterThan(0);
    expect(texto(kanban)).toContain(`${numero(esfriando)} esfriando`);
    expect(janeteAtiva.conversas).toBeGreaterThan(0);
    expect(texto(kanban)).toContain(`a Janete está em ${contagem(janeteAtiva.conversas, "conversa", "conversas")} agora`);
  });

  it("ajuste 3: com voo, as infos do anel esperam o pouso (na árvore, só invisíveis) e entram quando ela pousa", async () => {
    gatilhoFalso();
    let pousar: (() => void) | null = null;
    voo.voar.mockImplementation(
      () =>
        new Promise<void>((r) => {
          pousar = r;
        }),
    );
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => MEDIDA;
    try {
      montar();
      await esperarTela();
      await esperar(20);
      expect(voo.voar).toHaveBeenCalledTimes(1);
      const kanban = cartao("kanban")!;
      expect(kanban).toHaveAttribute("data-chegada", "esperando");
      expect(simboloJanete()).not.toHaveAttribute("data-visivel");
      // os textos continuam na árvore (o leitor de tela lê; só a opacidade esconde)
      expect(texto(kanban)).toContain("esfriando");
      for (const e of sonda!.painel.agora.kanban) expect(texto(kanban)).toContain(e.nome);
      expect(pousar).not.toBeNull();
      await act(async () => {
        pousar!();
      });
      await esperar(5);
      expect(kanban).toHaveAttribute("data-chegada", "entrando");
      expect(simboloJanete()).toHaveAttribute("data-pousou");
      // as partes do anel levam a ordem do traço (o desenho em sequência)
      const partes = Array.from(kanban.querySelectorAll<SVGElement>("circle[data-parte]"));
      expect(partes.length).toBeGreaterThan(0);
      const ordem = partes.map((c) => Number(c.style.getPropertyValue("--k")));
      const comLeads = sonda!.painel.agora.kanban.map((e, k) => (e.n > 0 ? k : -1)).filter((k) => k >= 0);
      expect(ordem).toEqual(comLeads);
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("ajuste 3: se o pouso não chega, o cartão do anel aparece inteiro do mesmo jeito", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    gatilhoFalso();
    voo.voar.mockImplementation(() => new Promise<void>(() => {}));
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => MEDIDA;
    try {
      montar();
      await esperarTela();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(cartao("kanban")).toHaveAttribute("data-chegada", "esperando");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ESPERA_MAXIMA_DO_POUSO_MS + 50);
      });
      expect(cartao("kanban")).not.toHaveAttribute("data-chegada");
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
  });
});

/* ---------- as classes dos CSS Modules da pasta da final ---------- */

describe("dv · versão final: as classes dos CSS Modules", () => {
  const pasta = path.resolve(__dirname, "../features/plataforma/dashboard/versoes/final");
  const declaracoes: { arquivo: string; css: string; classes: string[] }[] = [];
  for (const arquivo of readdirSync(pasta).filter((a) => a.endsWith(".tsx"))) {
    const codigo = readFileSync(path.join(pasta, arquivo), "utf-8");
    const importes = new Map<string, string>();
    for (const m of codigo.matchAll(/import\s+(\w+)\s+from\s+["']\.\/([\w.-]+\.module\.css)["']/g)) importes.set(m[1]!, m[2]!);
    for (const m of codigo.matchAll(/\b(\w+)\s+as\s+Classes<([^>]+)>/g)) {
      const css = importes.get(m[1]!);
      declaracoes.push({
        arquivo,
        css: css ? path.join(pasta, css) : `(sem import de ${m[1]})`,
        classes: [...m[2]!.matchAll(/["']([\w-]+)["']/g)].map((c) => c[1]!),
      });
    }
  }

  it("acha as declarações", () => {
    expect(declaracoes.length).toBeGreaterThan(8);
  });

  it.each(declaracoes.map((d) => [`${d.arquivo} → ${path.basename(d.css)}`, d] as const))("%s: cada classe declarada existe", (_nome, d) => {
    expect(d.css.endsWith(".module.css")).toBe(true);
    const css = readFileSync(d.css, "utf-8");
    const faltando = d.classes.filter((classe) => !new RegExp(`\\.${classe.replace(/-/g, "\\-")}(?![\\w-])`).test(css));
    expect(faltando).toEqual([]);
  });

  it("nada da final importa das versões A, B, C ou D", () => {
    for (const arquivo of readdirSync(pasta).filter((a) => /\.(tsx?|css)$/.test(a))) {
      const codigo = readFileSync(path.join(pasta, arquivo), "utf-8");
      expect(codigo, arquivo).not.toMatch(/from\s+["'][^"']*versoes\/(a|b|c|d)\//);
      expect(codigo, arquivo).not.toMatch(/from\s+["']\.\.\/(a|b|c|d)\//);
    }
  });
});
