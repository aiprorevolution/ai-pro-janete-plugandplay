import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CriarConta } from "@/features/conta/CriarConta";
import { Entrar } from "@/features/conta/Entrar";
import { traduzirErroConta } from "@/features/conta/erros";
import { ESPERA_NO_CENTRO_MS, IDS_PALCO, PalcoConta } from "@/features/conta/PalcoConta";
import { detalheContaCriada, medidaSenha } from "@/features/conta/validacao";
import { CHAVE_DONO_ONBOARDING } from "@/features/conta/dono";
import { CHAVE_SESSION_STORAGE, lerEstadoOnboarding, limparEstadoOnboarding } from "@/features/onboarding/estado";
import { CHAVE_TOUR_VISTO } from "@/features/plataforma/tour";

import { instalarWaapiFalsa, removerWaapiFalsa, type WaapiFalsa } from "./waapi-falsa";

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
}));
vi.mock("@/integrations/firebase/client", () => ({
  firebase: { auth },
  // Estes casos exercitam formulários em uma instalação já conectada.
  getClientConfiguration: vi.fn(async () => ({ projectId: "demo-conta", firestoreDatabaseId: "(default)" })),
}));

const voo = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
const medida = vi.hoisted(() => ({ reduzido: false }));
vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  useVooJanete: () => voo,
  movimentoReduzido: () => medida.reduzido,
}));

/** Como o app: Entrar e Criar conta sob a rota de layout (sem caminho) do palco; / e /onboarding fora. */
function montar(inicial: string) {
  const raiz = createRootRoute({ component: () => <Outlet /> });
  const conta = createRoute({
    getParentRoute: () => raiz,
    id: "_conta",
    component: () => (
      <PalcoConta>
        <Outlet />
      </PalcoConta>
    ),
  });
  const rotas = [
    createRoute({ getParentRoute: () => raiz, path: "/", component: () => <p>tela raiz</p> }),
    conta.addChildren([
      createRoute({ getParentRoute: () => conta, path: "/criar-conta", component: CriarConta }),
      createRoute({ getParentRoute: () => conta, path: "/entrar", component: Entrar }),
    ]),
    createRoute({
      getParentRoute: () => raiz,
      path: "/onboarding",
      component: () => (
        <>
          <p>tela onboarding</p>
          <button type="button" id="linha-modo-oficial">
            API oficial
          </button>
        </>
      ),
    }),
  ];
  const router = createRouter({
    routeTree: raiz.addChildren(rotas),
    history: createMemoryHistory({ initialEntries: [inicial] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

const sessao = { access_token: "x", user: { id: "u1" } };
const fase = () => document.getElementById(IDS_PALCO.cena)?.getAttribute("data-fase");
const regiaoAnuncio = () => document.getElementById(IDS_PALCO.cartao)?.querySelector('[role="status"]');

/**
 * O jsdom mede tudo com largura 0. O disco devolve um centro antes da passagem e outro depois de
 * contraído: o pouso tem de usar o medido no fim (o da página como ela está, rolada ou não).
 */
function medirDiscoNoFim() {
  const disco = document.getElementById(IDS_PALCO.disco)!;
  disco.getBoundingClientRect = () =>
    (fase() === "absorvido"
      ? { x: 100, y: 50, left: 100, top: 50, width: 96, height: 96, right: 196, bottom: 146 }
      : { x: 0, y: 0, left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 }) as DOMRect;
}

/** O que a região de anúncio dizia no instante em que o cartão ficou inert. */
function anuncioAoFicarInert() {
  const cartao = document.getElementById(IDS_PALCO.cartao)!;
  const visto: { texto: string | null } = { texto: null };
  const obs = new MutationObserver(() => {
    if (visto.texto === null && cartao.hasAttribute("inert")) visto.texto = regiaoAnuncio()?.textContent ?? "";
  });
  obs.observe(cartao, { attributes: true, attributeFilter: ["inert"] });
  return visto;
}

async function preencherCriar({ nome = "Ana Souza", email = "ana@empresa.com.br", senha = "segredo123" } = {}) {
  fireEvent.change(await screen.findByLabelText("Seu nome"), { target: { value: nome } });
  fireEvent.change(screen.getByLabelText("E-mail de trabalho"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Senha"), { target: { value: senha } });
}

let waapi!: WaapiFalsa;

beforeEach(() => {
  auth.signUp.mockReset();
  auth.signInWithPassword.mockReset();
  voo.pousar.mockReset();
  voo.legenda.mockReset();
  medida.reduzido = false;
  // A WAAPI falsa com fator 0: cada animação termina no próximo tique, e a passagem é instantânea.
  waapi = instalarWaapiFalsa({ fator: 0 });
});
afterEach(() => {
  removerWaapiFalsa();
  window.sessionStorage.clear();
  limparEstadoOnboarding();
});

describe("regras do cartão (iguais ao F)", () => {
  it("a medida da senha conta o que falta", () => {
    expect(medidaSenha("").texto).toBe("mínimo de 8 caracteres");
    expect(medidaSenha("abcde").texto).toBe("faltam 3");
    expect(medidaSenha("abcdefg").texto).toBe("falta 1");
    expect(medidaSenha("abcdefgh")).toEqual({ texto: "senha ok", ok: true });
  });

  it("a legenda usa o primeiro nome, cortado em 24", () => {
    expect(detalheContaCriada("  Ana   Souza ")).toBe("Conta de Ana criada");
    expect(detalheContaCriada("")).toBe("Conta de você criada");
    expect(detalheContaCriada("A".repeat(30))).toBe(`Conta de ${"A".repeat(23)}… criada`);
  });

  it("os erros do Firebase viram pt-BR com o que fazer", () => {
    expect(traduzirErroConta({ code: "user_already_exists", status: 422 }, "criar")).toMatchObject({ acao: "entrar" });
    expect(traduzirErroConta({ code: "weak_password", status: 422, reasons: ["length"] }, "criar")).toMatchObject({
      campo: "senha",
    });
    expect(traduzirErroConta({ code: "over_request_rate_limit", status: 429 }, "criar").mensagem).toMatch(/Muitas tentativas/);
    expect(traduzirErroConta({ name: "AuthRetryableFetchError", status: 0 }, "criar").mensagem).toMatch(/internet/);
    expect(traduzirErroConta({ code: "invalid_credentials", status: 400 }, "entrar").mensagem).toMatch(/não conferem/);
    expect(traduzirErroConta({ message: "Something odd" }, "entrar").mensagem).not.toMatch(/odd/);
  });
});

describe("/criar-conta", () => {
  it("dentro do palco: 'Janete' pequeno acima do título e o subtítulo novo", async () => {
    montar("/criar-conta");
    const titulo = await screen.findByRole("heading", { level: 1, name: "Crie sua conta" });
    const cartao = document.getElementById(IDS_PALCO.cartao)!;
    expect(cartao).toContainElement(titulo);
    const cab = titulo.parentElement!;
    expect(cab).toHaveAttribute("data-bloco", "0");
    expect(within(cab).getByRole("img", { name: "AI PRO Janete" })).toBeInTheDocument();
    expect(
      screen.getByText("Depois você conecta o WhatsApp e acorda a Janete, a vendedora que vai atender os seus leads."),
    ).toBeInTheDocument();
    // Os blocos da entrada: o botão e o rodapé.
    expect(screen.getByRole("button", { name: "Criar conta" })).toHaveAttribute("data-bloco", "2");
    expect(screen.getByText(/Já tem conta\?/)).toHaveAttribute("data-bloco", "3");
    // O símbolo de 56 px do cartão antigo saiu: a Janete agora é a bola do palco.
    expect(document.getElementById("t0-janete")).toBeNull();
    expect(screen.getByRole("region", { name: "Crie sua conta" })).toBeInTheDocument();
  });

  it("o botão só libera com nome, e-mail válido e senha de 8; o erro de e-mail é o do F", async () => {
    montar("/criar-conta");
    expect(await screen.findByRole("heading", { level: 1, name: "Crie sua conta" })).toBeInTheDocument();
    const botao = screen.getByRole("button", { name: "Criar conta" });
    expect(botao).toBeDisabled();
    expect(screen.getByText("mínimo de 8 caracteres")).toBeInTheDocument();

    const email = screen.getByLabelText("E-mail de trabalho");
    fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Ana" } });
    fireEvent.change(email, { target: { value: "ana@empresa" } });
    fireEvent.blur(email);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Confira o e-mail. Falta algo como @empresa.com.br.")).toBeInTheDocument();

    fireEvent.change(email, { target: { value: "ana@empresa.com.br" } });
    expect(email).not.toHaveAttribute("aria-invalid");
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "1234567" } });
    expect(screen.getByText("falta 1")).toBeInTheDocument();
    expect(botao).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "12345678" } });
    expect(screen.getByText("senha ok")).toBeInTheDocument();
    expect(botao).toBeEnabled();
  });

  it("Mostrar e Ocultar trocam o tipo da senha", async () => {
    montar("/criar-conta");
    const senha = await screen.findByLabelText("Senha");
    expect(senha).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }));
    expect(senha).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar senha" })).toHaveAttribute("aria-pressed", "true");
  });

  it("com sessão: o botão gira, a passagem pousa o símbolo no centro medido do disco, com a legenda, e vai para /onboarding", async () => {
    window.sessionStorage.setItem(CHAVE_SESSION_STORAGE, JSON.stringify({ etapa: "conversa" }));
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [{}] }, session: sessao }, error: null });
    const router = montar("/criar-conta");
    await preencherCriar();
    medirDiscoNoFim();
    const anuncio = anuncioAoFicarInert();
    let noPouso: { caminho: string; quando: number } | null = null;
    voo.pousar.mockImplementation(() => {
      noPouso = { caminho: router.state.location.pathname, quando: Date.now() };
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(auth.signUp).toHaveBeenCalledWith({
      email: "ana@empresa.com.br",
      password: "segredo123",
      options: { data: { nome: "Ana Souza" } },
    });
    expect(await screen.findByRole("button", { name: /Criando sua conta/ })).toHaveAttribute("aria-busy", "true");

    await waitFor(() => expect(voo.pousar).toHaveBeenCalled(), { timeout: 2000 });
    // O centro do disco já contraído (medido no fim), não o de antes.
    expect(voo.pousar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).toHaveBeenCalledWith({ x: 148, y: 98, tamanho: 96 }, "carregando", { metamorfose: true });
    expect(voo.legenda).toHaveBeenCalledWith({ titulo: "Preparando o seu espaço", detalhe: "Conta de Ana criada" });
    expect(noPouso!.caminho).toBe("/criar-conta");
    expect(fase()).toBe("fim");
    // O anúncio foi gravado antes de o cartão ficar inert (o leitor de tela ouve antes de ele sumir).
    expect(anuncio.texto).toBe("Conta criada. Preparando o seu espaço…");
    // Com voo, o carregando é o do VooJanete: o palco não desenha o dele.
    expect(document.querySelector("[data-palco-carregando]")).toBeNull();

    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding"), { timeout: 2000 });
    expect(Date.now() - noPouso!.quando).toBeGreaterThanOrEqual(ESPERA_NO_CENTRO_MS - 20);
    // Conta nova começa o onboarding do zero.
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
    expect(window.sessionStorage.getItem(CHAVE_DONO_ONBOARDING)).toBe("u1");
  });

  it("se a passagem não puder correr (navegador sem Web Animations), vai para /onboarding sem voo", async () => {
    removerWaapiFalsa();
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [{}] }, session: sessao }, error: null });
    const router = montar("/criar-conta");
    await preencherCriar();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding"), { timeout: 2000 });
    expect(voo.pousar).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "API oficial" })));
  });

  it("com movimento reduzido, vai direto para /onboarding, sem voo, e o foco vai para a primeira opção", async () => {
    medida.reduzido = true;
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [{}] }, session: sessao }, error: null });
    const router = montar("/criar-conta");
    expect(await screen.findByRole("heading", { level: 1, name: "Crie sua conta" })).toBeInTheDocument();
    // Tudo parado desde o primeiro quadro.
    expect(fase()).toBe("aberto");
    await preencherCriar();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding"));
    expect(voo.pousar).not.toHaveBeenCalled();
    // Como o `irPara(1); focar('linha-modo-oficial')` do F, sem o foco perdido no body.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "API oficial" })));
  });

  it("sem sessão (confirmação de e-mail ligada): 'Confira seu e-mail' no mesmo cartão, e Entrar abre com o e-mail", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [{}] }, session: null }, error: null });
    const router = montar("/criar-conta");
    await preencherCriar();
    const cartao = document.getElementById(IDS_PALCO.cartao)!;
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));

    const titulo = await screen.findByRole("heading", { level: 1, name: "Confira seu e-mail" });
    // O mesmo cartão do palco (a bola acompanha a altura nova).
    expect(document.getElementById(IDS_PALCO.cartao)).toBe(cartao);
    expect(cartao).toContainElement(titulo);
    expect(screen.getByText("ana@empresa.com.br")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(titulo));
    expect(voo.pousar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Ir para Entrar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    expect(await screen.findByLabelText("E-mail de trabalho")).toHaveValue("ana@empresa.com.br");
    expect(screen.getByLabelText("Senha")).toHaveValue("");
  });

  it("e-mail já cadastrado (com erro ou com usuário sem identidades) leva a Entrar", async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: "u1", identities: [] }, session: null }, error: null });
    montar("/criar-conta");
    await preencherCriar();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Este e-mail já tem uma conta. Entre com ele.");
    expect(within(alerta).getByRole("link", { name: "Entrar" }).getAttribute("href")).toBe("/entrar");
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeEnabled();
  });

  it("senha fraca marca o campo da senha e leva o foco a ele", async () => {
    auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthWeakPasswordError", code: "weak_password", status: 422, reasons: ["characters"] },
    });
    montar("/criar-conta");
    await preencherCriar();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    const senha = screen.getByLabelText("Senha");
    await waitFor(() => expect(senha).toHaveAttribute("aria-invalid", "true"));
    expect(senha.getAttribute("aria-describedby")).toContain("c-senha-erro");
    expect(screen.getByText(/Esta senha é fraca/)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(senha));
  });

  it("sem internet (o fetch lançou) mostra o aviso e destrava o botão", async () => {
    auth.signUp.mockRejectedValue(new TypeError("Failed to fetch"));
    montar("/criar-conta");
    await preencherCriar();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com a internet");
    expect(screen.getByRole("button", { name: "Criar conta" })).toBeEnabled();
    expect(fase()).toBe("aberto");
  });

  it("tem o link 'Já tem conta? Entrar'", async () => {
    montar("/criar-conta");
    const link = await screen.findByRole("link", { name: "Entrar" });
    expect(link.getAttribute("href")).toBe("/entrar");
  });
});

describe("/entrar", () => {
  it("entra com signInWithPassword: passagem sem voo, o carregando do palco no centro e depois /", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: sessao, user: {} }, error: null });
    const router = montar("/entrar");
    expect(await screen.findByRole("heading", { level: 1, name: "Entre na sua conta" })).toBeInTheDocument();
    const botao = screen.getByRole("button", { name: "Entrar" });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("data-bloco", "2");
    medirDiscoNoFim();
    const anuncio = anuncioAoFicarInert();
    fireEvent.change(screen.getByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    fireEvent.click(botao);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "ana@empresa.com.br", password: "x" });

    const carregando = await screen.findByRole("img", { name: "Janete, carregando" }, { timeout: 2000 });
    expect(carregando).toHaveAttribute("data-estado", "carregando");
    expect(carregando.style.left).toBe("148px");
    expect(carregando.style.top).toBe("98px");
    // O cartão está inert: o foco vai para o carregando (o `focar('fim')` do protótipo), não fica no body.
    expect(carregando).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(carregando);
    const visto = Date.now();
    expect(router.state.location.pathname).toBe("/entrar");
    expect(fase()).toBe("fim");
    expect(anuncio.texto).toBe("Entrando…");
    expect(voo.pousar).not.toHaveBeenCalled();
    expect(voo.legenda).not.toHaveBeenCalled();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"), { timeout: 2000 });
    expect(Date.now() - visto).toBeGreaterThanOrEqual(ESPERA_NO_CENTRO_MS - 40);
    expect(screen.getByText("tela raiz")).toBeInTheDocument();
    // O carregando some com o palco.
    expect(screen.queryByRole("img", { name: "Janete, carregando" })).toBeNull();
  });

  it("com movimento reduzido, vai direto para /, sem passagem", async () => {
    medida.reduzido = true;
    auth.signInWithPassword.mockResolvedValue({ data: { session: sessao, user: { id: "u1" } }, error: null });
    const router = montar("/entrar");
    fireEvent.change(await screen.findByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(screen.queryByRole("img", { name: "Janete, carregando" })).toBeNull();
    expect(voo.pousar).not.toHaveBeenCalled();
  });

  async function entrarCom(id: string | undefined) {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: sessao, user: id ? { id } : null },
      error: null,
    });
    const router = montar("/entrar");
    fireEvent.change(await screen.findByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"), { timeout: 2000 });
  }

  it("a mesma conta que volta a entrar (sem ter clicado em Sair) continua de onde parou", async () => {
    window.sessionStorage.setItem(CHAVE_DONO_ONBOARDING, "u1");
    window.sessionStorage.setItem(CHAVE_SESSION_STORAGE, JSON.stringify({ etapa: "conversa" }));
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    await entrarCom("u1");
    expect(lerEstadoOnboarding().etapa).toBe("conversa");
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBe("1");
    expect(window.sessionStorage.getItem(CHAVE_DONO_ONBOARDING)).toBe("u1");
  });

  it("outra conta na mesma aba começa do zero e vira a dona do progresso", async () => {
    window.sessionStorage.setItem(CHAVE_DONO_ONBOARDING, "u1");
    window.sessionStorage.setItem(CHAVE_SESSION_STORAGE, JSON.stringify({ etapa: "conversa" }));
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    await entrarCom("u2");
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
    expect(lerEstadoOnboarding().etapa).toBe("conexao");
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBeNull();
    expect(window.sessionStorage.getItem(CHAVE_DONO_ONBOARDING)).toBe("u2");
  });

  it("progresso sem dono gravado não é herdado", async () => {
    window.sessionStorage.setItem(CHAVE_SESSION_STORAGE, JSON.stringify({ etapa: "conversa" }));
    await entrarCom("u1");
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
    expect(window.sessionStorage.getItem(CHAVE_DONO_ONBOARDING)).toBe("u1");
  });

  it("sem id na resposta do Firebase, apaga o progresso e não grava dono", async () => {
    window.sessionStorage.setItem(CHAVE_DONO_ONBOARDING, "u1");
    window.sessionStorage.setItem(CHAVE_SESSION_STORAGE, JSON.stringify({ etapa: "conversa" }));
    await entrarCom(undefined);
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE)).toBeNull();
    expect(window.sessionStorage.getItem(CHAVE_DONO_ONBOARDING)).toBeNull();
  });

  const credencialErrada = {
    data: { session: null, user: null },
    error: { name: "AuthApiError", code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
  };

  async function errarSenha() {
    fireEvent.change(await screen.findByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "errada" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("E-mail ou senha não conferem. Confira os dois e tente de novo.")).toBeInTheDocument();
  }

  it("credencial errada: mensagem em pt-BR, a senha marcada e a bola treme", async () => {
    auth.signInWithPassword.mockResolvedValue(credencialErrada);
    const router = montar("/entrar");
    const discoPos = () => document.getElementById(IDS_PALCO.disco)!.parentElement!;
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    try {
      await errarSenha();
      expect(screen.getByLabelText("Senha")).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByText(/Invalid login/)).toBeNull();
      expect(router.state.location.pathname).toBe("/entrar");
      // A mola do tremor: o laço de quadros liga e a bola sai do lugar na horizontal.
      expect(raf).toHaveBeenCalled();
      await waitFor(() => expect(discoPos().style.transform).toMatch(/^translate3d\((?!0\.00px)/));
      expect(fase()).toBe("aberto");
    } finally {
      raf.mockRestore();
    }
  });

  it("com movimento reduzido, a senha errada não faz a bola tremer", async () => {
    medida.reduzido = true;
    auth.signInWithPassword.mockResolvedValue(credencialErrada);
    montar("/entrar");
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    try {
      await errarSenha();
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });

  it("um erro que não é da senha (sem internet) não faz a bola tremer", async () => {
    auth.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    montar("/entrar");
    fireEvent.change(await screen.findByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    try {
      fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com a internet");
      expect(raf).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
    }
  });

  it("tem o link para Criar conta", async () => {
    montar("/entrar");
    const link = await screen.findByRole("link", { name: "Criar conta" });
    expect(link.getAttribute("href")).toBe("/criar-conta");
    expect(link.parentElement).toHaveAttribute("data-bloco", "3");
  });
});

describe("troca entre Entrar e Criar conta", () => {
  it("o e-mail vai junto nos dois sentidos, a senha não, e o palco é o mesmo", async () => {
    const router = montar("/entrar");
    fireEvent.change(await screen.findByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "segredo123" } });
    const cena = document.getElementById(IDS_PALCO.cena);

    fireEvent.click(screen.getByRole("link", { name: "Criar conta" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/criar-conta"));
    expect(await screen.findByRole("heading", { level: 1, name: "Crie sua conta" })).toBeInTheDocument();
    expect(document.getElementById(IDS_PALCO.cena)).toBe(cena);
    expect(screen.getByLabelText("E-mail de trabalho")).toHaveValue("ana@empresa.com.br");
    expect(screen.getByLabelText("Senha")).toHaveValue("");
    // Na troca, o foco vai para o título da tela nova.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Crie sua conta" })));

    fireEvent.change(screen.getByLabelText("E-mail de trabalho"), { target: { value: "bia@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "outrasenha" } });
    fireEvent.click(screen.getByRole("link", { name: "Entrar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    expect(await screen.findByRole("heading", { level: 1, name: "Entre na sua conta" })).toBeInTheDocument();
    expect(document.getElementById(IDS_PALCO.cena)).toBe(cena);
    expect(screen.getByLabelText("E-mail de trabalho")).toHaveValue("bia@empresa.com.br");
    expect(screen.getByLabelText("Senha")).toHaveValue("");
  });
});

/** Uma resposta do Firebase que o teste solta quando quiser. */
function adiada() {
  let soltar!: (valor: unknown) => void;
  const promessa = new Promise((r) => (soltar = r));
  return { promessa, soltar };
}

const sessaoCriada = { data: { user: { id: "u1", identities: [{}] }, session: sessao }, error: null };

describe("durante o envio, a troca de tela fica travada", () => {
  it("no Entrar: o rodapé fica inert até a resposta com erro voltar", async () => {
    const resposta = adiada();
    auth.signInWithPassword.mockReturnValue(resposta.promessa);
    montar("/entrar");
    fireEvent.change(await screen.findByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    const rodape = screen.getByText(/Ainda não tem conta\?/);
    expect(rodape).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(rodape).toHaveAttribute("inert"));
    resposta.soltar({
      data: { session: null, user: null },
      error: { name: "AuthApiError", code: "invalid_credentials", status: 400, message: "Invalid login credentials" },
    });
    expect(await screen.findByText(/não conferem/)).toBeInTheDocument();
    expect(rodape).not.toHaveAttribute("inert");
  });

  it("no Criar conta: o rodapé fica inert até a resposta com erro voltar", async () => {
    const resposta = adiada();
    auth.signUp.mockReturnValue(resposta.promessa);
    montar("/criar-conta");
    await preencherCriar();
    const rodape = screen.getByText(/Já tem conta\?/);
    expect(rodape).not.toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(rodape).toHaveAttribute("inert"));
    resposta.soltar({ data: { user: null, session: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com a internet");
    expect(rodape).not.toHaveAttribute("inert");
  });
});

describe("Voltar no histórico durante o envio", () => {
  it("no meio da passagem do Criar conta: a passagem segue e termina em /onboarding", async () => {
    auth.signUp.mockResolvedValue(sessaoCriada);
    const router = montar("/entrar");
    fireEvent.click(await screen.findByRole("link", { name: "Criar conta" }));
    await preencherCriar();
    // A passagem no tempo de verdade (1,38 s), para dar tempo de voltar no meio dela.
    waapi.fator = 1;
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    await waitFor(() => expect(fase()).toBe("passagem"), { timeout: 2000 });
    act(() => router.history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe("/entrar"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding"), { timeout: 4000 });
    expect(voo.pousar).toHaveBeenCalledTimes(1);
    // O palco saiu com a tela: nada de símbolo parado no login.
    expect(document.getElementById(IDS_PALCO.cena)).toBeNull();
    expect(window.sessionStorage.getItem(CHAVE_DONO_ONBOARDING)).toBe("u1");
  }, 10000);

  it("no meio da passagem do Entrar: a passagem segue e termina em /, sem carregando parado", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: sessao, user: { id: "u1" } }, error: null });
    const router = montar("/criar-conta");
    fireEvent.click(await screen.findByRole("link", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Entre na sua conta" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    waapi.fator = 1;
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(fase()).toBe("passagem"), { timeout: 2000 });
    act(() => router.history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe("/criar-conta"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"), { timeout: 4000 });
    expect(screen.getByText("tela raiz")).toBeInTheDocument();
    expect(document.querySelector("[data-palco-carregando]")).toBeNull();
    expect(document.getElementById(IDS_PALCO.cena)).toBeNull();
  }, 10000);

  it("antes da resposta do Criar conta: com a sessão criada, vai ao onboarding e a conta é a dona do progresso", async () => {
    const resposta = adiada();
    auth.signUp.mockReturnValue(resposta.promessa);
    const router = montar("/entrar");
    fireEvent.click(await screen.findByRole("link", { name: "Criar conta" }));
    await preencherCriar();
    fireEvent.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByRole("button", { name: /Criando sua conta/ })).toBeInTheDocument();
    act(() => router.history.back());
    expect(await screen.findByRole("heading", { level: 1, name: "Entre na sua conta" })).toBeInTheDocument();
    resposta.soltar(sessaoCriada);
    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding"), { timeout: 2000 });
    expect(window.sessionStorage.getItem(CHAVE_DONO_ONBOARDING)).toBe("u1");
    expect(voo.pousar).not.toHaveBeenCalled();
  });

  it("antes da resposta do Entrar, com erro: fica na tela para onde voltou, sem mexer em nada", async () => {
    const resposta = adiada();
    auth.signInWithPassword.mockReturnValue(resposta.promessa);
    const router = montar("/criar-conta");
    fireEvent.click(await screen.findByRole("link", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Entre na sua conta" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-mail de trabalho"), { target: { value: "ana@empresa.com.br" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    act(() => router.history.back());
    expect(await screen.findByRole("heading", { level: 1, name: "Crie sua conta" })).toBeInTheDocument();
    await act(async () => {
      resposta.soltar({ data: { session: null, user: null }, error: { code: "invalid_credentials", status: 400 } });
      await resposta.promessa;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe("/criar-conta");
    expect(fase()).toBe("aberto");
  });
});
