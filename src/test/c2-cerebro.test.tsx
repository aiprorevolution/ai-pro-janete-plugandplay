import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PontoJanete } from "@/components/janete/VooJanete";
import { EtapaCerebro } from "@/features/onboarding/cerebro";
import { CHAVE_SESSION_STORAGE, gravarEstadoOnboarding, ESTADO_INICIAL, lerEstadoOnboarding, limparEstadoOnboarding } from "@/features/onboarding/estado";
import type { PropsFusaoJanete } from "@/features/onboarding/fusao";
import { consumirDesdobra, pedirDesdobra } from "@/features/onboarding/lista";
import { PalcoContexto } from "@/features/onboarding/palco";
import type { EntradaSalvarChaveIA, ResultadoSalvarChaveIA } from "@/features/mensageria/configuracao.functions";
import { ProvedorDadosOnboarding, criarDadosOnboardingMemoria } from "@/features/plataforma/dados/onboarding";
import type { EntradaChaveIA, ResultadoChaveIA } from "@/features/servidor/chave-ia";
import type { EntradaListarModelos, ModeloListado, ResultadoListarModelos } from "@/features/servidor/listar-modelos";

// C8: o "Validar chave" grava pela salvarChaveIA (dados do onboarding). Os testes de antes
// respondem no formato do validador; o adaptador abaixo devolve no formato do salvar, e o teste
// pode trocar a resposta inteira em `salvarDireto`.
const validarChaveIA = vi.fn<(arg: { data: EntradaChaveIA }) => Promise<ResultadoChaveIA>>();
let salvarDireto: ((e: EntradaSalvarChaveIA) => Promise<ResultadoSalvarChaveIA>) | null = null;
const salvarChaveIA = vi.fn(async (e: EntradaSalvarChaveIA): Promise<ResultadoSalvarChaveIA> => {
  if (salvarDireto) return salvarDireto(e);
  const data: EntradaChaveIA = { provedor: e.provedor as EntradaChaveIA["provedor"], chave: e.chave, modelo: e.modelo };
  if (e.workspace_id) data.workspaceId = e.workspace_id;
  const r = await validarChaveIA({ data });
  return r.ok ? { ok: true, ultimos4: r.ultimos4, status: "ativa" } : r;
});

const listarModelos = vi.fn<(arg: { data: EntradaListarModelos }) => Promise<ResultadoListarModelos>>();
vi.mock("@/features/servidor/listar-modelos.functions", () => ({
  listarModelos: (arg: { data: EntradaListarModelos }) => listarModelos(arg),
}));

const getSession = vi.fn();
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getSession: () => getSession() } } }));

const voo = {
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
};
/** O check (disco da validação) medido depois de rolar. */
const PONTO = { x: 500, y: 300, tamanho: 152 };
const rolarAteEMedir = vi.fn<(alvo: string) => Promise<PontoJanete | null>>();
const medirJanete = vi.fn<(alvo: string) => PontoJanete | null>();
vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  useVooJanete: () => voo,
  rolarAteEMedir: (alvo: string) => rolarAteEMedir(alvo),
  medirJanete: (alvo: string) => medirJanete(alvo),
}));

// a cena da fusão é de outra tarefa (R2-C2): aqui só importa o contrato (props e aoTerminar)
let fusao: PropsFusaoJanete | null = null;
vi.mock("@/features/onboarding/fusao", () => ({
  FusaoJanete: (props: PropsFusaoJanete) => {
    fusao = props;
    return <div data-testid="fusao" />;
  },
}));

const janeteNoPalco = vi.fn();
const anunciar = vi.fn();
const recolherBarra = vi.fn();

/* ---------- listas que a função devolve (simuladas) ---------- */
const ANTHROPIC: ModeloListado[] = [
  { id: "claude-opus-5-5", nome: "Claude Opus 5.5", perfil: "Mais capaz", precoEntrada: 4, precoSaida: 20, recomendado: false },
  { id: "claude-sonnet-5-5", nome: "Claude Sonnet 5.5", perfil: "Equilibrado", precoEntrada: 2, precoSaida: 10, recomendado: false },
  { id: "claude-haiku-5-5", nome: "Claude Haiku 5.5", perfil: "Rápido e barato", precoEntrada: 0.1, precoSaida: 0.5, recomendado: true },
  { id: "claude-legado-x", nome: "Claude Legado X", recomendado: false },
];
const OPENROUTER: ModeloListado[] = [
  { id: "mistralai/mistral-x", nome: "Mistral: Mistral X", fabricante: "Mistral", recomendado: false },
  { id: "google/gemini-3.8-flash", nome: "Google: Gemini 3.8 Flash", fabricante: "Google", precoEntrada: 0.75, precoSaida: 3.75, recomendado: false },
  { id: "anthropic/claude-haiku-5.5", nome: "Anthropic: Claude Haiku 5.5", fabricante: "Anthropic", precoEntrada: 0.1, precoSaida: 0.5, recomendado: true },
];
const okLista = (modelos: ModeloListado[], origem: "provedor" | "lista_curada" = "provedor"): ResultadoListarModelos => ({
  ok: true,
  modelos,
  origem,
});

function montar({ avancar = vi.fn(), voltar = vi.fn(), estrito = false } = {}) {
  const dados = criarDadosOnboardingMemoria({ salvarChaveIA });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <ProvedorDadosOnboarding dados={dados}>
      <PalcoContexto.Provider value={{ janeteNoPalco, anunciar, recolherBarra }}>{children}</PalcoContexto.Provider>
    </ProvedorDadosOnboarding>
  );
  // estrito: o modo estrito do React (monta, desmonta e monta de novo os efeitos, como em
  // desenvolvimento). Pela opção do render: um <StrictMode> dentro do wrapper não repete os efeitos.
  render(<EtapaCerebro avancar={avancar} voltar={voltar} />, { wrapper: envoltorio, reactStrictMode: estrito });
  return { avancar, voltar };
}

async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 20) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(20, ms - feito));
    });
  }
}

const chave = (motor: string) => document.getElementById(`chave-${motor}`) as HTMLInputElement;
const botaoValidar = () => screen.getByRole("button", { name: "Validar chave" });
const botaoBuscar = () => screen.getByRole("button", { name: "Buscar modelos" });
const grupoModelos = () => screen.getByRole("radiogroup", { name: "Modelo" });

function movimento(reduzido: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: reduzido && query.includes("reduce"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

async function abrirMotor(nome: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${nome}`) }));
  await passar(500);
}

/** Anthropic: cola a chave e busca a lista (a função devolve ANTHROPIC). */
async function anthropicComLista(opcoes?: Parameters<typeof montar>[0]) {
  listarModelos.mockResolvedValue(okLista(ANTHROPIC));
  const r = montar(opcoes);
  await abrirMotor("Anthropic");
  fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-segredo-abcd" } });
  fireEvent.click(botaoBuscar());
  await passar(100);
  return r;
}

async function validarAnthropic(resposta: () => Promise<ResultadoChaveIA>, opcoes?: Parameters<typeof montar>[0]) {
  validarChaveIA.mockImplementation(resposta);
  const r = await anthropicComLista(opcoes);
  fireEvent.click(botaoValidar());
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  movimento(false);
  limparEstadoOnboarding();
  validarChaveIA.mockReset();
  salvarChaveIA.mockClear();
  salvarDireto = null;
  listarModelos.mockReset();
  rolarAteEMedir.mockReset();
  rolarAteEMedir.mockImplementation(async () => null);
  medirJanete.mockReset();
  medirJanete.mockImplementation((alvo: string) => (alvo === "val-disco" ? PONTO : null));
  fusao = null;
  janeteNoPalco.mockReset();
  anunciar.mockReset();
  voo.pousar.mockClear();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
  consumirDesdobra();
});
afterEach(() => {
  vi.useRealTimers();
  movimento(false);
  window.sessionStorage.clear();
});

describe("Etapa cérebro: motores (2a)", () => {
  it("mostra os 3 motores, cada um dizendo quais modelos tem", () => {
    montar();
    expect(screen.getByRole("heading", { level: 1, name: "Escolha o cérebro da Janete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Anthropic/ })).toHaveTextContent("Os modelos Claude, como Haiku, Sonnet e Opus.");
    expect(screen.getByRole("button", { name: /^OpenAI/ })).toHaveTextContent("Os modelos GPT, da OpenAI.");
    expect(screen.getByRole("button", { name: /^OpenRouter/ })).toHaveTextContent(
      "Modelos de vários fabricantes, como Claude, GPT e Gemini, com uma chave só.",
    );
  });

  it("a Anthropic não manda mais conectar a transcrição depois: a etapa Voz cuida dos áudios (P8 da spec da voz)", async () => {
    montar();
    await abrirMotor("Anthropic");
    expect(chave("anthropic")).toBeInTheDocument();
    expect(screen.queryByText(/Para entender áudios/)).not.toBeInTheDocument();
  });
});

describe("Etapa cérebro: Anthropic e OpenAI, a chave antes da lista (2b)", () => {
  it("abre com a chave focada e sem lista; Buscar modelos só libera com 8 caracteres ou mais", async () => {
    montar();
    await abrirMotor("OpenAI");
    expect(chave("openai")).toHaveFocus();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: "Validar chave" })).toBeNull();
    expect(botaoBuscar()).toBeDisabled();
    fireEvent.change(chave("openai"), { target: { value: "sk-1234" } });
    expect(botaoBuscar()).toBeDisabled();
    fireEvent.change(chave("openai"), { target: { value: "sk-12345" } });
    expect(botaoBuscar()).toBeEnabled();
    expect(listarModelos).not.toHaveBeenCalled();
  });

  it("buscar manda a chave, mostra o carregando e depois a lista do provedor em 2 colunas, com o recomendado marcado", async () => {
    let responder: (r: ResultadoListarModelos) => void = () => {};
    listarModelos.mockImplementation(() => new Promise((r) => (responder = r)));
    montar();
    await abrirMotor("Anthropic");
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-segredo-abcd" } });
    fireEvent.keyDown(chave("anthropic"), { key: "Enter" });
    expect(listarModelos).toHaveBeenCalledWith({ data: { provedor: "anthropic", chave: "sk-ant-segredo-abcd" } });
    expect(screen.getByRole("status")).toHaveTextContent("Buscando os modelos da Anthropic…");
    await act(async () => responder(okLista(ANTHROPIC)));
    await passar(100);

    const grupo = grupoModelos();
    expect(grupo).toHaveAttribute("data-colunas", "2");
    const opcoes = within(grupo).getAllByRole("radio");
    expect(opcoes).toHaveLength(4);
    // o recomendado (da lista curada) vem primeiro, marcado e focado
    expect(opcoes[0]).toHaveAccessibleName(/^Claude Haiku 5\.5 Recomendado/);
    expect(opcoes[0]).toHaveAttribute("aria-checked", "true");
    expect(opcoes[0]).toHaveFocus();
    expect(within(opcoes[0]!).getByText("US$ 0,10 / 0,50")).toBeInTheDocument();
    expect(within(grupo).getAllByText("Recomendado")).toHaveLength(1);
    // sem preço do provedor nem da curada: sem preço, e o id embaixo do nome
    const legado = within(grupo).getByRole("radio", { name: /Claude Legado X/ });
    expect(legado).not.toHaveTextContent("US$");
    expect(legado).toHaveTextContent("claude-legado-x");
    expect(lerEstadoOnboarding().cerebro).toEqual({ provedor: "anthropic", modelo: "claude-haiku-5-5", ultimos4: null });

    // a chave vem antes da lista
    expect(chave("anthropic").compareDocumentPosition(grupo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(botaoValidar()).toBeEnabled();

    // setas movem a escolha no grupo de rádio
    fireEvent.keyDown(opcoes[0]!, { key: "ArrowDown" });
    await passar(100);
    expect(within(grupo).getByRole("radio", { name: /Claude Opus 5\.5/ })).toHaveAttribute("aria-checked", "true");
    expect(within(grupo).getByRole("radio", { name: /Claude Opus 5\.5/ })).toHaveFocus();
    expect(lerEstadoOnboarding().cerebro.modelo).toBe("claude-opus-5-5");
  });

  it("chave recusada na busca: o campo da chave fica marcado com a mensagem e focado; digitar tira a marca", async () => {
    listarModelos.mockResolvedValue({
      ok: false,
      erro: "chave_invalida",
      mensagem: "A Anthropic não reconheceu a chave. Ela pode estar errada, revogada ou vencida.",
    });
    montar();
    await abrirMotor("Anthropic");
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-errada-123" } });
    fireEvent.click(botaoBuscar());
    await passar(100);
    expect(chave("anthropic")).toHaveAttribute("aria-invalid", "true");
    expect(chave("anthropic")).toHaveFocus();
    expect(document.getElementById(chave("anthropic").getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "A Anthropic não reconheceu a chave. Ela pode estar errada, revogada ou vencida.",
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(botaoBuscar()).toBeEnabled();
    // a palavra secreta não vai para a tela
    expect(document.body.innerHTML).not.toContain("sk-ant-errada");
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-nova-1234" } });
    expect(chave("anthropic")).not.toHaveAttribute("aria-invalid");
  });

  it("workspace necessário na busca: o campo do workspace aparece marcado e a próxima busca o envia", async () => {
    listarModelos.mockResolvedValueOnce({
      ok: false,
      erro: "workspace_necessario",
      mensagem: "Essa chave da Anthropic não está presa a um workspace. Informe o ID do workspace (começa com wrkspc_).",
    });
    montar();
    await abrirMotor("Anthropic");
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-segredo-abcd" } });
    fireEvent.click(botaoBuscar());
    await passar(100);
    const ws = screen.getByLabelText("ID do workspace");
    expect(ws).toHaveFocus();
    expect(ws).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(ws, { target: { value: "wrkspc_01ABC" } });
    expect(ws).not.toHaveAttribute("aria-invalid");
    listarModelos.mockResolvedValueOnce(okLista(ANTHROPIC));
    fireEvent.click(botaoBuscar());
    expect(listarModelos).toHaveBeenLastCalledWith({
      data: { provedor: "anthropic", chave: "sk-ant-segredo-abcd", workspaceId: "wrkspc_01ABC" },
    });
    await passar(100);
    expect(grupoModelos()).toBeInTheDocument();
  });

  it("a lista chega abaixo da dobra: o foco vai para o modelo marcado e a página rola até ele", async () => {
    const rolar = vi.fn();
    const antes = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = rolar;
    try {
      await anthropicComLista();
      const marcado = within(grupoModelos()).getByRole("radio", { checked: true });
      expect(marcado).toHaveFocus();
      expect(rolar.mock.contexts).toContain(marcado);
    } finally {
      HTMLElement.prototype.scrollIntoView = antes;
    }
  });

  it("o preço tem rótulo para o leitor de tela (o cabeçalho é só visual)", async () => {
    await anthropicComLista();
    expect(
      within(grupoModelos()).getByRole("radio", { name: /Preço por 1 milhão de tokens, entrada e saída: US\$ 0,10 \/ 0,50$/ }),
    ).toHaveAccessibleName(/^Claude Haiku 5\.5/);
  });

  it("modo estrito do React (monta duas vezes): a lista buscada aparece, sem ficar em Buscando", async () => {
    listarModelos.mockResolvedValue(okLista(ANTHROPIC));
    montar({ estrito: true });
    await abrirMotor("Anthropic");
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-segredo-abcd" } });
    fireEvent.click(botaoBuscar());
    await passar(100);
    expect(screen.queryByText(/Buscando os modelos/)).toBeNull();
    expect(within(grupoModelos()).getAllByRole("radio")).toHaveLength(4);
  });

  it("modo estrito do React: no OpenRouter a lista abre sozinha", async () => {
    listarModelos.mockResolvedValue(okLista(OPENROUTER));
    montar({ estrito: true });
    await abrirMotor("OpenRouter");
    await passar(100);
    expect(within(grupoModelos()).getAllByRole("radio")).toHaveLength(3);
  });

  it("a resposta da chave antiga chegando depois da nova é ignorada: fica a lista da nova, sem erro nem foco da antiga", async () => {
    const respostas: Array<(r: ResultadoListarModelos) => void> = [];
    listarModelos.mockImplementation(() => new Promise((r) => respostas.push(r)));
    montar();
    await abrirMotor("Anthropic");
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-chave-A-1111" } });
    fireEvent.click(botaoBuscar());
    await passar(20);
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-chave-B-2222" } });
    fireEvent.click(botaoBuscar());
    expect(listarModelos).toHaveBeenLastCalledWith({ data: { provedor: "anthropic", chave: "sk-ant-chave-B-2222" } });
    await act(async () => respostas[1]!(okLista(ANTHROPIC.slice(1, 3))));
    await passar(100);
    await act(async () =>
      respostas[0]!({ ok: false, erro: "chave_invalida", mensagem: "A Anthropic não reconheceu a chave. Ela pode estar errada." }),
    );
    await passar(100);
    const opcoes = within(grupoModelos()).getAllByRole("radio");
    expect(opcoes).toHaveLength(2);
    expect(opcoes[0]).toHaveFocus();
    expect(chave("anthropic")).not.toHaveAttribute("aria-invalid");
    expect(document.body.textContent).not.toContain("não reconheceu");
  });

  it("OpenRouter: voltar e reabrir durante a busca fica com a lista da busca nova", async () => {
    const respostas: Array<(r: ResultadoListarModelos) => void> = [];
    listarModelos.mockImplementation(() => new Promise((r) => respostas.push(r)));
    montar();
    await abrirMotor("OpenRouter");
    fireEvent.click(within(screen.getByRole("group", { name: "OpenRouter" })).getByRole("button", { name: "Voltar" }));
    await passar(500);
    await abrirMotor("OpenRouter");
    expect(respostas).toHaveLength(2);
    await act(async () => respostas[1]!(okLista(OPENROUTER)));
    await passar(20);
    await act(async () => respostas[0]!(okLista(OPENROUTER.slice(0, 1))));
    await passar(100);
    expect(within(grupoModelos()).getAllByRole("radio")).toHaveLength(3);
  });

  it("trocar a chave depois de a lista chegar: a lista some e é preciso buscar de novo", async () => {
    await anthropicComLista();
    expect(grupoModelos()).toBeInTheDocument();
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-outra-9876" } });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(botaoBuscar()).toBeEnabled();
  });

  it("provedor fora do ar: mostra o aviso e deixa buscar de novo", async () => {
    listarModelos.mockResolvedValueOnce({
      ok: false,
      erro: "provedor_fora",
      mensagem: "A OpenAI não respondeu agora. Tente de novo em instantes.",
    });
    montar();
    await abrirMotor("OpenAI");
    fireEvent.change(chave("openai"), { target: { value: "sk-openai-1234" } });
    fireEvent.click(botaoBuscar());
    await passar(100);
    expect(screen.getByRole("alert")).toHaveTextContent("A OpenAI não respondeu agora. Tente de novo em instantes.");
    listarModelos.mockResolvedValueOnce(okLista([{ id: "gpt-6-luna", nome: "GPT-6 Luna", recomendado: true }]));
    fireEvent.click(botaoBuscar());
    await passar(100);
    expect(within(grupoModelos()).getByRole("radio", { name: /GPT-6 Luna/ })).toHaveAttribute("aria-checked", "true");
  });

  it("a busca foi recusada porque a sessão terminou: pede para entrar de novo", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    listarModelos.mockRejectedValue(new Error("Unauthorized"));
    montar();
    await abrirMotor("Anthropic");
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-segredo-abcd" } });
    fireEvent.click(botaoBuscar());
    await passar(100);
    expect(screen.getByRole("alert")).toHaveTextContent("Sua sessão terminou.");
    expect(screen.getByRole("button", { name: "Entrar de novo" })).toBeInTheDocument();
  });
});

describe("Etapa cérebro: OpenRouter, a lista ao abrir (2b)", () => {
  it("busca a lista sem chave ao abrir; a busca vem antes da chave e filtra por nome, id e fabricante", async () => {
    listarModelos.mockResolvedValue(okLista(OPENROUTER));
    montar();
    await abrirMotor("OpenRouter");
    expect(listarModelos).toHaveBeenCalledWith({ data: { provedor: "openrouter" } });
    expect(screen.getByLabelText("Buscar modelo")).toHaveFocus();
    const grupo = grupoModelos();
    const opcoes = within(grupo).getAllByRole("radio");
    expect(opcoes).toHaveLength(3);
    expect(opcoes[0]).toHaveAccessibleName(/^Anthropic: Claude Haiku 5\.5 Recomendado/);
    expect(opcoes[0]).toHaveAttribute("aria-checked", "true");
    expect(opcoes[0]).toHaveTextContent("anthropic/claude-haiku-5.5");
    expect(screen.getByLabelText("Buscar modelo").compareDocumentPosition(chave("openrouter")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(grupo.compareDocumentPosition(chave("openrouter")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "google" } });
    expect(within(grupoModelos()).getAllByRole("radio")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "mistral x" } });
    expect(within(grupoModelos()).getByRole("radio", { name: /Mistral X/ })).toBeInTheDocument();
  });

  it("aceita um id completo digitado e valida com ele", async () => {
    listarModelos.mockResolvedValue(okLista(OPENROUTER));
    montar();
    await abrirMotor("OpenRouter");
    fireEvent.change(screen.getByLabelText("Buscar modelo"), { target: { value: "meta-llama/llama-5-70b" } });
    const digitado = within(grupoModelos()).getByRole("radio", { name: /meta-llama\/llama-5-70b/ });
    expect(digitado).toHaveTextContent("Digitado por você");
    fireEvent.click(digitado);
    fireEvent.change(chave("openrouter"), { target: { value: "sk-or-v1-segredo" } });
    validarChaveIA.mockResolvedValue({ ok: true, ultimos4: "gred" });
    fireEvent.click(botaoValidar());
    expect(validarChaveIA).toHaveBeenCalledWith({
      data: { provedor: "openrouter", chave: "sk-or-v1-segredo", modelo: "meta-llama/llama-5-70b" },
    });
  });

  it("OpenRouter fora do ar (a função devolve a lista curada): avisa e segue com ela", async () => {
    listarModelos.mockResolvedValue(
      okLista([{ id: "anthropic/claude-haiku-5.5", nome: "anthropic/claude-haiku-5.5", fabricante: "Anthropic", recomendado: true }], "lista_curada"),
    );
    montar();
    await abrirMotor("OpenRouter");
    expect(screen.getByText(/O OpenRouter não respondeu agora\. Mostramos os modelos que recomendamos/)).toBeInTheDocument();
    expect(within(grupoModelos()).getByRole("radio", { name: /anthropic\/claude-haiku-5\.5/ })).toHaveAttribute("aria-checked", "true");
  });

  it("a chamada falhou (sem rede): usa a lista curada de reserva, com o aviso", async () => {
    listarModelos.mockRejectedValue(new Error("rede"));
    montar();
    await abrirMotor("OpenRouter");
    expect(screen.getByText(/O OpenRouter não respondeu agora/)).toBeInTheDocument();
    const opcoes = within(grupoModelos()).getAllByRole("radio");
    expect(opcoes).toHaveLength(3);
    expect(opcoes[0]).toHaveAccessibleName(/anthropic\/claude-haiku-5\.5/);
    expect(opcoes[0]).toHaveTextContent("US$ 0,10 / 0,50");
  });

  it("lista longa: mostra 12 e o Mostrar mais traz o resto", async () => {
    const muitos: ModeloListado[] = Array.from({ length: 30 }, (_, i) => ({
      id: `fab/modelo-${i + 1}`,
      nome: `Fab: Modelo ${i + 1}`,
      fabricante: "Fab",
      recomendado: false,
    }));
    listarModelos.mockResolvedValue(okLista(muitos));
    montar();
    await abrirMotor("OpenRouter");
    expect(within(grupoModelos()).getAllByRole("radio")).toHaveLength(12);
    expect(screen.getByText("Mostrando 12 de 30 modelos.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais" }));
    expect(within(grupoModelos()).getAllByRole("radio")).toHaveLength(30);
    expect(screen.queryByRole("button", { name: "Mostrar mais" })).toBeNull();
  });
});

describe("Etapa cérebro: validação do modelo escolhido", () => {
  it("sucesso: chama com o modelo escolhido, espera a animação mínima, diz qual modelo a Janete vai usar e apaga a chave", async () => {
    await validarAnthropic(() => Promise.resolve({ ok: true, ultimos4: "abcd" }));
    expect(validarChaveIA).toHaveBeenCalledWith({
      data: { provedor: "anthropic", chave: "sk-ant-segredo-abcd", modelo: "claude-haiku-5-5" },
    });
    // a chave não vai para o atributo value do HTML (campo não controlado)
    expect(chave("anthropic").getAttribute("value") ?? "").not.toContain("sk-ant");
    expect(document.body.innerHTML).not.toContain("sk-ant-segredo");
    await passar(20);
    expect(janeteNoPalco).toHaveBeenLastCalledWith(true);
    await passar(2000);
    expect(screen.queryByText("A Janete já tem cérebro.")).toBeNull();
    expect(screen.getByText("Testando o Claude Haiku 5.5")).toBeInTheDocument();
    await passar(1000);
    expect(screen.getByText("A Janete já tem cérebro.")).toBeInTheDocument();
    // 2c: em linguagem simples, sem a chave e sem "••••"
    expect(screen.getByText("Ela vai usar o Claude Haiku 5.5, da Anthropic.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("••••");
    expect(document.body.textContent).not.toMatch(/terminada em/);
    // na Anthropic sem escuta, o aviso do áudio vai junto (o foco pula para o "Próximo")
    expect(anunciar).toHaveBeenCalledWith(
      "Chave aceita. Ela vai usar o Claude Haiku 5.5, da Anthropic. Com a Anthropic, a Janete não entende áudio. Adicione uma chave de Escuta (OpenAI, Groq ou ElevenLabs) ou a da voz (ElevenLabs).",
    );
    expect(screen.getByRole("button", { name: "Próximo" })).toHaveFocus();

    expect(lerEstadoOnboarding().cerebro).toEqual({ provedor: "anthropic", modelo: "claude-haiku-5-5", ultimos4: "abcd" });
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE) ?? "").not.toContain("sk-ant-segredo");

    // a chave não ficou na memória: trocar a chave reabre o campo vazio (e a lista, que era dela, some)
    fireEvent.click(screen.getByRole("button", { name: "Trocar chave" }));
    await passar(400);
    expect(chave("anthropic").value).toBe("");
    expect(chave("anthropic")).toHaveFocus();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(lerEstadoOnboarding().cerebro.ultimos4).toBeNull();
  });

  it("OpenRouter: o resultado diz o modelo sem o nome do fabricante na frente", async () => {
    listarModelos.mockResolvedValue(okLista(OPENROUTER));
    validarChaveIA.mockResolvedValue({ ok: true, ultimos4: "gred" });
    montar();
    await abrirMotor("OpenRouter");
    fireEvent.change(chave("openrouter"), { target: { value: "sk-or-v1-segredo" } });
    fireEvent.click(botaoValidar());
    await passar(3000);
    expect(screen.getByText("Ela vai usar o Claude Haiku 5.5, pelo OpenRouter.")).toBeInTheDocument();
  });

  it("a página rolada: a chamada sai na hora, mas o cartão só dobra depois de a rolagem parar", async () => {
    let parou: (p: PontoJanete | null) => void = () => {};
    validarChaveIA.mockResolvedValue({ ok: true, ultimos4: "abcd" });
    await anthropicComLista();
    rolarAteEMedir.mockImplementationOnce(() => new Promise((r) => (parou = r)));
    fireEvent.click(botaoValidar());
    expect(rolarAteEMedir).toHaveBeenLastCalledWith("disco-mira");
    expect(validarChaveIA).toHaveBeenCalledTimes(1);
    await passar(200);
    const secao = document.querySelector("section[data-etapa='cerebro']")!;
    expect(secao).not.toHaveAttribute("data-validando");
    // um segundo clique durante a rolagem não chama de novo
    fireEvent.click(botaoValidar());
    expect(validarChaveIA).toHaveBeenCalledTimes(1);
    await act(async () => parou(null));
    await passar(20);
    expect(secao).toHaveAttribute("data-validando");
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "fechando");
  });

  it("a página rolando até o disco: a lista fica inert e Voltar não troca o motor; parada a rolagem, o cartão dobra com o palco", async () => {
    let parou: (p: PontoJanete | null) => void = () => {};
    validarChaveIA.mockResolvedValue({ ok: true, ultimos4: "abcd" });
    await anthropicComLista();
    rolarAteEMedir.mockImplementationOnce(() => new Promise((r) => (parou = r)));
    fireEvent.click(botaoValidar());
    await passar(100);
    expect(document.getElementById("lista-cartao")!.firstElementChild).toHaveAttribute("inert");
    fireEvent.click(within(screen.getByRole("group", { name: "Anthropic" })).getByRole("button", { name: "Voltar" }));
    await passar(500);
    expect(lerEstadoOnboarding().cerebro.provedor).toBe("anthropic");
    await act(async () => parou(null));
    await passar(20);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "fechando");
    expect(screen.getByTestId("val-disco")).toBeInTheDocument();
    await passar(3000);
    expect(screen.getByText("A Janete já tem cérebro.")).toBeInTheDocument();
    expect(lerEstadoOnboarding().cerebro).toEqual({ provedor: "anthropic", modelo: "claude-haiku-5-5", ultimos4: "abcd" });
  });

  it("erro de chave: mostra a mensagem da função; Colar outra chave limpa o campo e avisa", async () => {
    await validarAnthropic(() =>
      Promise.resolve({
        ok: false,
        erro: "chave_invalida",
        mensagem: "A Anthropic não reconheceu a chave. Ela pode estar errada, revogada ou vencida.",
      }),
    );
    await passar(3000);
    expect(screen.getByText("Chave recusada")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "A Anthropic não reconheceu a chave." })).toBeInTheDocument();
    expect(screen.getByText("Ela pode estar errada, revogada ou vencida.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Colar outra chave" })).toHaveFocus();
    expect(lerEstadoOnboarding().cerebro.ultimos4).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Colar outra chave" }));
    await passar(400);
    expect(chave("anthropic").value).toBe("");
    expect(chave("anthropic")).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("A Anthropic não reconheceu a chave. Cole uma chave nova e valide de novo.");
    // o campo da chave fica marcado, com a instrução ligada a ele; digitar tira a marca
    expect(chave("anthropic")).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(chave("anthropic").getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "Ela pode estar errada, revogada ou vencida.",
    );
    // a lista era da chave recusada: é preciso buscar de novo
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.change(chave("anthropic"), { target: { value: "sk-ant-nova-1234" } });
    expect(chave("anthropic")).not.toHaveAttribute("aria-invalid");
    expect(botaoBuscar()).toBeEnabled();
  });

  it("workspace necessário: Informar o workspace abre o campo, marcado e focado, e a próxima tentativa o envia", async () => {
    await validarAnthropic(() =>
      Promise.resolve({
        ok: false,
        erro: "workspace_necessario",
        mensagem: "Essa chave da Anthropic não está presa a um workspace. Informe o ID do workspace (começa com wrkspc_).",
      }),
    );
    await passar(3000);
    fireEvent.click(screen.getByRole("button", { name: "Informar o workspace" }));
    await passar(400);
    const ws = screen.getByLabelText("ID do workspace");
    expect(ws).toHaveFocus();
    expect(ws).toHaveAttribute("aria-invalid", "true");
    expect(chave("anthropic").value).toBe("sk-ant-segredo-abcd");
    fireEvent.change(ws, { target: { value: "wrkspc_01ABC" } });
    expect(ws).not.toHaveAttribute("aria-invalid");
    // o workspace mudou: a lista é buscada de novo (com ele) antes de validar
    fireEvent.click(botaoBuscar());
    expect(listarModelos).toHaveBeenLastCalledWith({
      data: { provedor: "anthropic", chave: "sk-ant-segredo-abcd", workspaceId: "wrkspc_01ABC" },
    });
    await passar(100);
    validarChaveIA.mockResolvedValue({ ok: true, ultimos4: "abcd" });
    fireEvent.click(botaoValidar());
    expect(validarChaveIA).toHaveBeenLastCalledWith({
      data: { provedor: "anthropic", chave: "sk-ant-segredo-abcd", modelo: "claude-haiku-5-5", workspaceId: "wrkspc_01ABC" },
    });
  });

  it("falha da chamada e Tentar de novo: chama outra vez com a mesma chave", async () => {
    await validarAnthropic(() => Promise.reject(new Error("rede")));
    await passar(3000);
    expect(screen.getByText("Não validou")).toBeInTheDocument();
    validarChaveIA.mockImplementation(() => Promise.resolve({ ok: true, ultimos4: "abcd" }));
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(validarChaveIA).toHaveBeenCalledTimes(2);
    expect(validarChaveIA.mock.calls[1]![0].data.chave).toBe("sk-ant-segredo-abcd");
    await passar(2500);
    expect(screen.getByText("A Janete já tem cérebro.")).toBeInTheDocument();
  });

  it("a chamada foi recusada porque a sessão terminou: pede para entrar de novo", async () => {
    await anthropicComLista();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    validarChaveIA.mockRejectedValue(new Error("Unauthorized"));
    fireEvent.click(botaoValidar());
    await passar(3000);
    expect(screen.getByRole("heading", { level: 2, name: "Sua sessão terminou." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar de novo" })).toHaveFocus();
  });
});

describe("Etapa cérebro: gravar a chave (C8)", () => {
  it("Validar chave grava pela salvarChaveIA como chave de resposta, sem workspace quando não foi digitado", async () => {
    await validarAnthropic(() => Promise.resolve({ ok: true, ultimos4: "abcd" }));
    await passar(3000);
    expect(salvarChaveIA).toHaveBeenLastCalledWith({
      finalidade: "resposta",
      provedor: "anthropic",
      modelo: "claude-haiku-5-5",
      chave: "sk-ant-segredo-abcd",
    });
    expect(lerEstadoOnboarding().cerebro).toEqual({ provedor: "anthropic", modelo: "claude-haiku-5-5", ultimos4: "abcd" });
  });

  it.each([
    ["sem_acesso", undefined, "Sua conta não pode configurar a Janete.", "Sem acesso"],
    ["erro_ao_gravar", "Não conseguimos guardar a chave agora. Tente de novo em instantes.", "Não conseguimos guardar a chave agora.", "Não guardou"],
    ["provedor_nao_permitido", "A Groq só pode ser usada na transcrição de áudio.", "A Groq só pode ser usada na transcrição de áudio.", "Não validou"],
  ] as const)("recusa %s: mostra o texto certo e não guarda a chave", async (erro, mensagem, titulo, estado) => {
    salvarDireto = async () => (mensagem ? { ok: false, erro, mensagem } : { ok: false, erro }) as ResultadoSalvarChaveIA;
    await anthropicComLista();
    fireEvent.click(botaoValidar());
    await passar(3000);
    expect(screen.getByText(estado)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: titulo })).toBeInTheDocument();
    expect(lerEstadoOnboarding().cerebro.ultimos4).toBeNull();
    salvarDireto = null;
  });

  it("a lista recusada por sem_acesso (conta que não é membro): mostra a falha, sem a lista curada de reserva", async () => {
    listarModelos.mockResolvedValue({ ok: false, erro: "sem_acesso", mensagem: "Sua conta não tem acesso. Peça um convite ao admin." } as never);
    montar();
    await abrirMotor("OpenRouter");
    await passar(100);
    expect(screen.getByText("Sua conta não tem acesso.")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Modelo" })).toBeNull();
  });
});

describe("Etapa cérebro: passagens", () => {
  it("Próximo: mede o check depois de rolar, a cena FusaoJanete começa nele e, no fim, a Janete pousa acordada e a etapa avança", async () => {
    const { avancar } = await validarAnthropic(() => Promise.resolve({ ok: true, ultimos4: "abcd" }));
    await passar(3000);
    rolarAteEMedir.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    // um segundo clique não começa outra cena
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    await passar(20);
    // rola pela mira (que desconta a barra de etapas) e só depois mede o check
    expect(rolarAteEMedir.mock.calls).toEqual([["disco-mira"]]);
    expect(medirJanete.mock.calls.filter(([a]) => a === "val-disco")).toHaveLength(1);
    expect(screen.getByTestId("fusao")).toBeInTheDocument();
    expect(fusao?.origem).toEqual(PONTO);
    expect(fusao?.logo).toEqual({ src: "/logos/anthropic.svg", alt: "Anthropic" });
    // o disco do palco sai de cena (a cena começa no lugar dele) e a etapa ainda não avançou
    expect(document.querySelector("[data-fusao]")).not.toBeNull();
    expect(avancar).not.toHaveBeenCalled();
    expect(voo.pousar).not.toHaveBeenCalled();

    const fim = { x: 640, y: 320, tamanho: 152 };
    act(() => fusao!.aoTerminar(fim));
    expect(voo.pousar).toHaveBeenCalledWith(fim, "acordada");
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("Próximo com movimento reduzido: só avança, sem cena e sem símbolo em trânsito", async () => {
    const { avancar } = await validarAnthropic(() => Promise.resolve({ ok: true, ultimos4: "abcd" }));
    await passar(3000);
    movimento(true);
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("fusao")).toBeNull();
    expect(voo.pousar).not.toHaveBeenCalled();
  });

  it("durante a cena, os botões do resultado saem do teclado e Trocar chave não apaga a chave validada", async () => {
    const { avancar } = await validarAnthropic(() => Promise.resolve({ ok: true, ultimos4: "abcd" }));
    await passar(3000);
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    await passar(20);
    expect(screen.getByTestId("fusao")).toBeInTheDocument();
    const trocar = screen.getByRole("button", { name: "Trocar chave", hidden: true });
    expect(trocar.closest("[inert]")).not.toBeNull();
    // pelo teclado (o jsdom não aplica o inert): a cena já começou, nada muda
    fireEvent.click(trocar);
    await passar(400);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "ok");
    expect(lerEstadoOnboarding().cerebro.ultimos4).toBe("abcd");
    act(() => fusao!.aoTerminar({ x: 640, y: 320, tamanho: 152 }));
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("voltou já validada no OpenRouter: a frase vem sem nome e ganha o nome da lista pública, sem o fabricante", async () => {
    let responder: (r: ResultadoListarModelos) => void = () => {};
    listarModelos.mockImplementation(() => new Promise((r) => (responder = r)));
    gravarEstadoOnboarding({
      ...ESTADO_INICIAL,
      etapa: "cerebro",
      cerebro: { provedor: "openrouter", modelo: "anthropic/claude-haiku-5.5", ultimos4: "wxyz" },
    });
    // no modo estrito: o pedido da primeira montagem é descartado, o da segunda vale
    montar({ estrito: true });
    expect(screen.getByText("Ela vai usar um modelo pelo OpenRouter.")).toBeInTheDocument();
    expect(listarModelos).toHaveBeenCalledWith({ data: { provedor: "openrouter" } });
    await act(async () => responder(okLista(OPENROUTER)));
    await passar(20);
    expect(screen.getByText("Ela vai usar o Claude Haiku 5.5, pelo OpenRouter.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("anthropic/claude-haiku-5.5");
  });

  it("voltou já validada no OpenRouter e a lista não respondeu: fica a frase sem nome, nunca o id", async () => {
    listarModelos.mockRejectedValue(new Error("rede"));
    gravarEstadoOnboarding({
      ...ESTADO_INICIAL,
      etapa: "cerebro",
      cerebro: { provedor: "openrouter", modelo: "anthropic/claude-haiku-5.5", ultimos4: "wxyz" },
    });
    montar();
    await passar(100);
    expect(screen.getByText("Ela vai usar um modelo pelo OpenRouter.")).toBeInTheDocument();
  });

  it("voltou já validada: o resultado diz o modelo pelo nome da lista curada, sem a chave", () => {
    gravarEstadoOnboarding({
      ...ESTADO_INICIAL,
      etapa: "cerebro",
      cerebro: { provedor: "openai", modelo: "gpt-6-luna", ultimos4: "wxyz" },
    });
    montar();
    expect(screen.getByText("Ela vai usar o GPT-6 Luna, da OpenAI.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("wxyz");
  });

  it("vindo do check do WhatsApp: o contêiner se desdobra; a linha do WhatsApp mostra a conexão", async () => {
    gravarEstadoOnboarding({
      ...ESTADO_INICIAL,
      etapa: "cerebro",
      conexao: { modo: "oficial", gateway: "zernio", rotulo: "+55 11 91234-5678" },
    });
    pedirDesdobra();
    const { voltar } = montar();
    const secao = document.querySelector("section[data-etapa='cerebro']")!;
    expect(secao).toHaveAttribute("data-entrada", "desdobrando");
    expect(screen.getByText("Conectado via Zernio")).toBeInTheDocument();
    await passar(800);
    expect(secao).not.toHaveAttribute("data-entrada");
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));
    expect(voltar).toHaveBeenCalledTimes(1);
  });

  it("sem conexão: a linha do WhatsApp diz que ainda não conectou e oferece Conectar", () => {
    montar();
    expect(screen.getByText("Ainda não conectado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conectar" })).toBeInTheDocument();
  });
});
