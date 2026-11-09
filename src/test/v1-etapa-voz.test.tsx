import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PontoJanete } from "@/components/janete/VooJanete";
import { CHAVE_SESSION_STORAGE, ESTADO_INICIAL, gravarEstadoOnboarding, lerEstadoOnboarding, limparEstadoOnboarding } from "@/features/onboarding/estado";
import { PalcoContexto } from "@/features/onboarding/palco";
import { EtapaVoz } from "@/features/onboarding/voz";
import type {
  EntradaEscolherVoz,
  EntradaSalvarChaveIA,
  EntradaUsarChaveElevenLabs,
  ResultadoEscolherVoz,
  ResultadoListarVozes,
  ResultadoSalvarChaveIA,
  ResultadoUsarChaveElevenLabs,
} from "@/features/mensageria/configuracao.functions";
import { ProvedorDadosOnboarding, criarDadosOnboardingMemoria } from "@/features/plataforma/dados/onboarding";
import type { VozDaConta } from "@/features/servidor/vozes-tipos";

// C2 da spec da voz: a etapa Voz grava a chave da ElevenLabs pela salvarChaveIA (dados do
// onboarding). A resposta de cada teste fica em `responder`.
const CHAVE = "sk_teste_1234567890abcd";
let responder: (e: EntradaSalvarChaveIA) => Promise<ResultadoSalvarChaveIA> = async () => ({
  ok: true,
  ultimos4: "abcd",
  status: "ativa",
});
const salvarChaveIA = vi.fn((e: EntradaSalvarChaveIA) => responder(e));

// C4 da spec do uso da voz: a lista de vozes no "Chave aceita" e a gravação da voz no "Próximo".
const VOZES: VozDaConta[] = [
  { id: "v1", nome: "Ana", detalhe: "Calma", portugues: true, previa: null },
  { id: "v2", nome: "Bruno", detalhe: null, portugues: true, previa: null },
  { id: "v3", nome: "Carla", detalhe: null, portugues: false, previa: null },
];
let responderVozes: () => Promise<ResultadoListarVozes> = async () => ({ ok: true, vozes: VOZES, atual: null });
const listarVozes = vi.fn(() => responderVozes());
let responderEscolha: (e: EntradaEscolherVoz) => Promise<ResultadoEscolherVoz> = async (e) => ({
  ok: true,
  voz: { id: e.vozId, nome: VOZES.find((v) => v.id === e.vozId)?.nome ?? "?" },
});
const escolherVoz = vi.fn((e: EntradaEscolherVoz) => responderEscolha(e));

// T8 da spec da escuta com a ElevenLabs: no sucesso, a etapa pede a cópia da chave para a escuta,
// sem esperar. A resposta de cada teste fica em `responderCopia`.
let responderCopia: (e: EntradaUsarChaveElevenLabs) => Promise<ResultadoUsarChaveElevenLabs> = async () => ({
  ok: true,
  copiada: true,
  ultimos4: "abcd",
  status: "ativa",
});
const usarChaveElevenLabs = vi.fn((e: EntradaUsarChaveElevenLabs) => responderCopia(e));

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
/** O círculo de onde o cartão nasce (#nasce-mira). */
const NASCE = { x: 480, y: 200, tamanho: 144 };
const reduzido = { valor: false };
const rolarAteEMedir = vi.fn<(alvo: string, opcoes?: { bloco?: ScrollLogicalPosition }) => Promise<PontoJanete | null>>();
const medirJanete = vi.fn<(alvo: string) => PontoJanete | null>();
vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  useVooJanete: () => voo,
  // repassa os argumentos como vieram: o Próximo confere também o { bloco: "center" }
  rolarAteEMedir: (...args: [string, { bloco?: ScrollLogicalPosition }?]) => rolarAteEMedir(...args),
  medirJanete: (alvo: string) => medirJanete(alvo),
  movimentoReduzido: () => reduzido.valor,
}));

const janeteNoPalco = vi.fn();
const anunciar = vi.fn();
const recolherBarra = vi.fn();

function montar({ avancar = vi.fn(), estrito = true } = {}) {
  const dados = criarDadosOnboardingMemoria({ salvarChaveIA, listarVozes, escolherVoz, usarChaveElevenLabs });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <ProvedorDadosOnboarding dados={dados}>
      <PalcoContexto.Provider value={{ janeteNoPalco, anunciar, recolherBarra }}>{children}</PalcoContexto.Provider>
    </ProvedorDadosOnboarding>
  );
  // estrito: o modo estrito do React (monta, desmonta e monta de novo os efeitos, como em
  // desenvolvimento). Pela opção do render: um <StrictMode> dentro do wrapper não repete os efeitos.
  render(<EtapaVoz avancar={avancar} voltar={vi.fn()} />, { wrapper: envoltorio, reactStrictMode: estrito });
  return { avancar };
}

async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 20) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(20, ms - feito));
    });
  }
}

const campo = () => document.getElementById("chave-elevenlabs") as HTMLInputElement;
const botaoValidar = () => screen.getByRole("button", { name: "Validar chave" });
const cartao = () => document.querySelector('[data-etapa="voz"]') as HTMLElement;

/** Na etapa Voz, com o cérebro da Anthropic já conectado; `voz` com os 4 últimos da chave de voz. */
function naAba(voz: string | null = null) {
  gravarEstadoOnboarding({
    ...ESTADO_INICIAL,
    etapa: "voz",
    cerebro: { provedor: "anthropic", modelo: "claude-haiku-5-5", ultimos4: "zzzz" },
    voz: { ultimos4: voz, pulou: false },
  });
}

/** Cola a chave e valida; `passar` leva até o fim da animação. */
async function validarChave(opcoes?: Parameters<typeof montar>[0]) {
  const r = montar(opcoes);
  fireEvent.change(campo(), { target: { value: CHAVE } });
  fireEvent.click(botaoValidar());
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  voo.ativo = false;
  reduzido.valor = false;
  limparEstadoOnboarding();
  naAba();
  responder = async () => ({ ok: true, ultimos4: "abcd", status: "ativa" });
  salvarChaveIA.mockClear();
  responderVozes = async () => ({ ok: true, vozes: VOZES, atual: null });
  listarVozes.mockClear();
  responderEscolha = async (e) => ({ ok: true, voz: { id: e.vozId, nome: VOZES.find((v) => v.id === e.vozId)?.nome ?? "?" } });
  escolherVoz.mockClear();
  responderCopia = async () => ({ ok: true, copiada: true, ultimos4: "abcd", status: "ativa" });
  usarChaveElevenLabs.mockClear();
  rolarAteEMedir.mockReset();
  rolarAteEMedir.mockImplementation(async (alvo) => (alvo === "nasce-mira" ? NASCE : null));
  medirJanete.mockReset();
  medirJanete.mockImplementation((alvo: string) => (alvo === "val-disco" ? PONTO : null));
  janeteNoPalco.mockReset();
  anunciar.mockReset();
  voo.pousar.mockClear();
  voo.voar.mockClear();
  voo.soltar.mockClear();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("Etapa Voz: o cartão", () => {
  it("mostra o olho, o título, o subtítulo, a linha do Cérebro, o painel da ElevenLabs e a ajuda", () => {
    montar();
    expect(screen.getByText("A voz da Janete")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Conecte a ElevenLabs" })).toBeInTheDocument();
    expect(
      screen.getByText("Com ela, a Janete escuta os áudios dos leads e responde por áudio. Dá para trocar depois na Configuração."),
    ).toBeInTheDocument();
    expect(screen.getByText("Cérebro")).toBeInTheDocument();
    expect(screen.getByText("Conectado via Anthropic")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "ElevenLabs" })).toHaveTextContent(
      "Vozes realistas e transcrição de áudio, com uma chave só.",
    );
    // um provedor só: o painel não tem Voltar
    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
    expect(screen.getByText(/crie a chave em Developers → API Keys e ligue os acessos User, Text to Speech/)).toBeInTheDocument();
    expect(screen.getByLabelText("Chave de API da ElevenLabs")).toBe(campo());
    expect(campo()).toHaveAttribute("type", "password");
    expect(campo()).toHaveAttribute("placeholder", "Cole a chave aqui");
    expect(screen.getByRole("button", { name: "Fazer depois" })).toBeEnabled();
  });

  it("Validar chave só libera com 8 caracteres ou mais; Mostrar e Ocultar trocam o tipo do campo", () => {
    montar();
    expect(botaoValidar()).toBeDisabled();
    fireEvent.change(campo(), { target: { value: "sk_1234" } });
    expect(botaoValidar()).toBeDisabled();
    fireEvent.change(campo(), { target: { value: "sk_12345" } });
    expect(botaoValidar()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar chave" }));
    expect(campo()).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar chave" }));
    expect(campo()).toHaveAttribute("type", "password");
  });

  it("Alterar, na linha do Cérebro, volta à etapa do Cérebro", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Alterar" }));
    expect(lerEstadoOnboarding().etapa).toBe("cerebro");
  });

  it("sem cérebro: a linha diz que ainda não conectou e oferece Conectar", () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "voz" });
    montar();
    expect(screen.getByText("Ainda não conectado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Conectar" }));
    expect(lerEstadoOnboarding().etapa).toBe("cerebro");
  });
});

describe("Etapa Voz: validar a chave", () => {
  it("sucesso: grava com o objeto do contrato, limpa o campo e mostra o ok com os 4 últimos", async () => {
    await validarChave();
    expect(salvarChaveIA).toHaveBeenCalledTimes(1);
    expect(salvarChaveIA).toHaveBeenCalledWith({ finalidade: "voz", provedor: "elevenlabs", modelo: "", chave: CHAVE });
    // a chave não vai para o atributo value do HTML (campo não controlado)
    expect(campo().getAttribute("value") ?? "").not.toContain("sk_teste");
    await passar(20);
    expect(janeteNoPalco).toHaveBeenLastCalledWith(true);
    // depois da dobra (680 ms), a moeda gira com os passos da ElevenLabs
    await passar(800);
    expect(anunciar).toHaveBeenCalledWith("Validando a chave da ElevenLabs…");
    expect(screen.getByText("Falando com a ElevenLabs")).toBeInTheDocument();
    expect(screen.getByText("Conferindo a chave")).toBeInTheDocument();
    expect(screen.getByText("Conferindo os créditos da conta")).toBeInTheDocument();
    await passar(3000);
    expect(screen.getByText("Chave aceita")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "A voz da Janete está conectada." })).toBeInTheDocument();
    expect(screen.getByText(/chave terminada em/)).toHaveTextContent("chave terminada em abcd");
    expect(screen.getByText("A chave fica guardada com segurança e nunca é mostrada de novo.")).toBeInTheDocument();
    expect(anunciar).toHaveBeenCalledWith("Chave aceita. A voz da Janete está conectada.");
    expect(screen.getByRole("button", { name: "Próximo" })).toHaveFocus();
    expect(campo().value).toBe("");
    expect(document.body.innerHTML).not.toContain(CHAVE);
    expect(lerEstadoOnboarding().voz).toEqual({ ultimos4: "abcd", pulou: false });
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE) ?? "").not.toContain("sk_teste");
  });

  it("o Enter no campo valida", async () => {
    montar();
    fireEvent.change(campo(), { target: { value: CHAVE } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(salvarChaveIA).toHaveBeenCalledTimes(1);
  });

  it("o clique duplo em Validar salva uma vez só", async () => {
    montar();
    fireEvent.change(campo(), { target: { value: CHAVE } });
    fireEvent.click(botaoValidar());
    fireEvent.click(botaoValidar());
    await passar(100);
    fireEvent.click(screen.getByRole("button", { name: "Validar chave", hidden: true }));
    await passar(3000);
    expect(salvarChaveIA).toHaveBeenCalledTimes(1);
  });

  it("chave inválida: Chave recusada; Colar outra chave limpa o campo, foca nele e avisa", async () => {
    responder = async () => ({
      ok: false,
      erro: "chave_invalida",
      mensagem: "A ElevenLabs não reconheceu a chave. Confira se copiou a chave inteira e se ela ainda está ativa na ElevenLabs.",
    });
    await validarChave();
    await passar(3000);
    expect(screen.getByText("Chave recusada")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "A ElevenLabs não reconheceu a chave." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Colar outra chave" })).toHaveFocus();
    expect(anunciar).toHaveBeenCalledWith("Chave recusada. A ElevenLabs não reconheceu a chave.");
    expect(lerEstadoOnboarding().voz.ultimos4).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Colar outra chave" }));
    await passar(400);
    expect(campo().value).toBe("");
    expect(campo()).toHaveFocus();
    expect(campo()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("A ElevenLabs não reconheceu a chave. Cole uma chave nova e valide de novo.");
    fireEvent.change(campo(), { target: { value: "sk_teste_nova_123" } });
    expect(campo()).not.toHaveAttribute("aria-invalid");
  });

  it.each([
    ["sem_permissao", "A chave existe, mas não tem os acessos que a Janete usa. Na ElevenLabs, edite a chave.", "Chave recusada", "Colar outra chave"],
    ["sem_credito", "A conta da ElevenLabs está sem créditos. Recarregue a conta.", "Chave recusada", "Colar outra chave"],
    ["provedor_fora", "A ElevenLabs não respondeu agora. Tente de novo em instantes.", "Não validou", "Voltar"],
    ["tempo_esgotado", "A ElevenLabs demorou demais para responder. Tente de novo.", "Não validou", "Voltar"],
    ["sem_acesso", undefined, "Sem acesso", "Voltar"],
    ["cifra_indisponivel", "O servidor não está pronto para guardar credenciais agora. Avise o suporte.", "Não guardou", "Voltar"],
    ["erro_ao_gravar", "Não conseguimos guardar a chave agora. Tente de novo em instantes.", "Não guardou", "Voltar"],
  ] as const)("recusa %s: mostra o estado e a ação certos e não guarda a chave", async (erro, mensagem, estado, acao) => {
    responder = async () => (mensagem ? { ok: false, erro, mensagem } : { ok: false, erro }) as ResultadoSalvarChaveIA;
    await validarChave();
    await passar(3000);
    expect(screen.getByText(estado)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: acao })).toHaveFocus();
    expect(lerEstadoOnboarding().voz.ultimos4).toBeNull();
  });

  it("a chamada falhou (sem rede): mostra a mensagem de sem resposta e Tentar de novo chama outra vez", async () => {
    responder = () => Promise.reject(new Error("rede"));
    await validarChave();
    await passar(3000);
    expect(screen.getByRole("heading", { level: 2, name: "Não conseguimos fazer o teste agora." })).toBeInTheDocument();
    expect(screen.getByText("Não validou")).toBeInTheDocument();
    responder = async () => ({ ok: true, ultimos4: "abcd", status: "ativa" });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await passar(3000);
    expect(salvarChaveIA).toHaveBeenCalledTimes(2);
    expect(salvarChaveIA).toHaveBeenLastCalledWith({ finalidade: "voz", provedor: "elevenlabs", modelo: "", chave: CHAVE });
    expect(screen.getByRole("heading", { level: 2, name: "A voz da Janete está conectada." })).toBeInTheDocument();
  });

  it("a chamada foi recusada porque a sessão terminou: pede para entrar de novo", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    responder = () => Promise.reject(new Error("Unauthorized"));
    await validarChave();
    await passar(3000);
    expect(screen.getByRole("heading", { level: 2, name: "Sua sessão terminou." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar de novo" })).toHaveFocus();
  });
});

describe("Etapa Voz: passagens", () => {
  it("Próximo: rola até o disco, a Janete pousa acordada sobre o check e a etapa avança uma vez 240 ms depois", async () => {
    const { avancar } = await validarChave();
    await passar(3000);
    rolarAteEMedir.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    // um segundo clique não começa outra saída
    fireEvent.click(screen.getByRole("button", { name: "Próximo", hidden: true }));
    await passar(20);
    expect(rolarAteEMedir.mock.calls).toEqual([["disco-mira", { bloco: "center" }]]);
    expect(medirJanete.mock.calls.filter(([a]) => a === "val-disco")).toHaveLength(1);
    expect(voo.pousar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).toHaveBeenCalledWith(PONTO, "acordada");
    expect(avancar).not.toHaveBeenCalled();
    await passar(220);
    expect(avancar).toHaveBeenCalledTimes(1);
    await passar(500);
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("Próximo com movimento reduzido: avança sem pousar", async () => {
    reduzido.valor = true;
    const { avancar } = await validarChave();
    await passar(3000);
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).not.toHaveBeenCalled();
  });

  it("Fazer depois: grava que pulou e avança uma vez, sem pousar e sem salvar", async () => {
    const { avancar } = montar();
    fireEvent.change(campo(), { target: { value: CHAVE } });
    fireEvent.click(screen.getByRole("button", { name: "Fazer depois" }));
    fireEvent.click(screen.getByRole("button", { name: "Fazer depois" }));
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(lerEstadoOnboarding().voz).toEqual({ ultimos4: null, pulou: true });
    await passar(500);
    expect(voo.pousar).not.toHaveBeenCalled();
    expect(salvarChaveIA).not.toHaveBeenCalled();
    expect(usarChaveElevenLabs).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE) ?? "").not.toContain("sk_teste");
  });

  it("Fazer depois fica bloqueado durante a validação", async () => {
    const { avancar } = await validarChave();
    await passar(800);
    const pular = screen.getByRole("button", { name: "Fazer depois", hidden: true });
    expect(pular).toBeDisabled();
    fireEvent.click(pular);
    expect(avancar).not.toHaveBeenCalled();
    expect(lerEstadoOnboarding().voz.pulou).toBe(false);
  });

  it("chegada do despertar com o símbolo em voo: voa à mira, o cartão nasce dele e o foco vai ao campo, uma vez só no StrictMode", async () => {
    voo.ativo = true;
    montar({ estrito: true });
    expect(cartao()).toHaveAttribute("data-entrada", "espera");
    expect(janeteNoPalco).toHaveBeenLastCalledWith(true);
    await passar(60);
    expect(rolarAteEMedir).toHaveBeenCalledTimes(1);
    expect(rolarAteEMedir).toHaveBeenCalledWith("nasce-mira");
    expect(voo.voar).toHaveBeenCalledTimes(1);
    expect(voo.voar).toHaveBeenCalledWith({ ...NASCE, tamanho: 96 }, { duracaoMs: 900 });
    expect(voo.soltar).not.toHaveBeenCalled();

    await passar(1080);
    expect(cartao()).toHaveAttribute("data-entrada", "nascendo");
    expect(voo.soltar).toHaveBeenCalledTimes(1);
    expect(voo.soltar).toHaveBeenCalledWith({ desvanecer: true });

    await passar(780);
    expect(cartao()).not.toHaveAttribute("data-entrada");
    expect(campo()).toHaveFocus();
    expect(janeteNoPalco).toHaveBeenLastCalledWith(false);
    expect(voo.voar).toHaveBeenCalledTimes(1);
    expect(voo.soltar).toHaveBeenCalledTimes(1);
  });

  it("chegada com voo, mas sem a mira medida: o cartão nasce já", async () => {
    voo.ativo = true;
    rolarAteEMedir.mockImplementation(async () => null);
    montar();
    await passar(80);
    expect(voo.voar).not.toHaveBeenCalled();
    expect(cartao()).toHaveAttribute("data-entrada", "nascendo");
    expect(voo.soltar).toHaveBeenCalledWith({ desvanecer: true });
    await passar(800);
    expect(campo()).toHaveFocus();
  });

  it("chegada com voo e movimento reduzido: solta o símbolo, sem voo, e foca o campo", async () => {
    voo.ativo = true;
    reduzido.valor = true;
    montar();
    expect(cartao()).not.toHaveAttribute("data-entrada");
    await passar(100);
    expect(voo.voar).not.toHaveBeenCalled();
    expect(voo.soltar).toHaveBeenCalled();
    expect(campo()).toHaveFocus();
  });

  it("quem volta com a chave vê o ok com terminada em; Trocar chave volta ao formulário vazio, com o foco no campo", async () => {
    naAba("wxyz");
    montar();
    expect(screen.getByRole("heading", { level: 2, name: "A voz da Janete está conectada." })).toBeInTheDocument();
    expect(screen.getByText(/chave terminada em/)).toHaveTextContent("chave terminada em wxyz");
    await passar(100);
    expect(screen.getByRole("button", { name: "Próximo" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Trocar chave" }));
    await passar(400);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "form");
    expect(campo().value).toBe("");
    expect(campo()).toHaveFocus();
    expect(lerEstadoOnboarding().voz.ultimos4).toBeNull();
    expect(botaoValidar()).toBeDisabled();
  });

  it("sem StrictMode também: a validação e o Próximo seguem iguais", async () => {
    const { avancar } = await validarChave({ estrito: false });
    await passar(3000);
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    await passar(300);
    expect(voo.pousar).toHaveBeenCalledWith(PONTO, "acordada");
    expect(avancar).toHaveBeenCalledTimes(1);
  });
});

describe("Etapa Voz: a chave também na escuta (T8)", () => {
  it("o sucesso pede a cópia para a escuta uma vez, só se ela estiver livre, sem a chave e sem mensagem", async () => {
    await validarChave({ estrito: true });
    expect(usarChaveElevenLabs).not.toHaveBeenCalled();
    await passar(3000);
    expect(screen.getByText("Chave aceita")).toBeInTheDocument();
    expect(usarChaveElevenLabs).toHaveBeenCalledTimes(1);
    expect(usarChaveElevenLabs).toHaveBeenCalledWith({ para: "transcricao", seLivre: true });
    // a cópia é no servidor: a chave não vai junto
    expect(JSON.stringify(usarChaveElevenLabs.mock.calls)).not.toContain("sk_teste");
    // os textos da etapa não mudam
    expect(anunciar).toHaveBeenCalledWith("Chave aceita. A voz da Janete está conectada.");
    expect(anunciar.mock.calls.flat().join(" ")).not.toMatch(/escuta/i);
    await passar(1000);
    expect(usarChaveElevenLabs).toHaveBeenCalledTimes(1);
  });

  it("a recusa não dispara a cópia", async () => {
    responder = async () => ({ ok: false, erro: "chave_invalida", mensagem: "A ElevenLabs não reconheceu a chave." });
    await validarChave();
    await passar(3000);
    expect(screen.getByText("Chave recusada")).toBeInTheDocument();
    expect(usarChaveElevenLabs).not.toHaveBeenCalled();
  });

  it.each([
    ["rejeita (sem rede)", () => Promise.reject(new Error("rede"))],
    ["recusa no servidor", async () => ({ ok: false, erro: "erro_ao_gravar", mensagem: "Não conseguimos guardar a chave agora." }) as ResultadoUsarChaveElevenLabs],
  ] as const)("a cópia que %s não muda o Chave aceita nem mostra erro", async (_nome, resposta) => {
    responderCopia = resposta;
    const { avancar } = await validarChave();
    await passar(3000);
    expect(usarChaveElevenLabs).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Chave aceita")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "A voz da Janete está conectada." })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Próximo" })).toHaveFocus();
    expect(lerEstadoOnboarding().voz).toEqual({ ultimos4: "abcd", pulou: false });
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    await passar(300);
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("o Chave aceita aparece sem esperar a cópia", async () => {
    responderCopia = () => new Promise<ResultadoUsarChaveElevenLabs>(() => undefined);
    await validarChave();
    await passar(3000);
    expect(usarChaveElevenLabs).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Chave aceita")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próximo" })).toHaveFocus();
  });

  it("Trocar chave e validar de novo pede a cópia de novo", async () => {
    await validarChave();
    await passar(3000);
    expect(usarChaveElevenLabs).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Trocar chave" }));
    await passar(400);
    // trocar, sozinho, não pede nada
    expect(usarChaveElevenLabs).toHaveBeenCalledTimes(1);
    fireEvent.change(campo(), { target: { value: CHAVE } });
    fireEvent.click(botaoValidar());
    await passar(3000);
    expect(salvarChaveIA).toHaveBeenCalledTimes(2);
    expect(usarChaveElevenLabs).toHaveBeenCalledTimes(2);
    expect(usarChaveElevenLabs).toHaveBeenLastCalledWith({ para: "transcricao", seLivre: true });
  });

  it("quem volta com a chave não pede a cópia ao abrir", async () => {
    naAba("wxyz");
    montar({ estrito: true });
    await passar(500);
    expect(usarChaveElevenLabs).not.toHaveBeenCalled();
  });
});

describe("Etapa Voz: a lista de vozes no Chave aceita (C4)", () => {
  const radio = (nome: string) => screen.getByRole("radio", { name: new RegExp(nome) });
  const proximo = () => screen.getByRole("button", { name: "Próximo" });

  /** Uma promessa que o teste resolve na hora que quiser. */
  function adiada<T>() {
    let resolver!: (v: T) => void;
    const promessa = new Promise<T>((r) => {
      resolver = r;
    });
    return { promessa, resolver };
  }

  it("o ok busca a lista uma vez, no StrictMode, e mostra as vozes no bloco, com o foco no Próximo", async () => {
    await validarChave({ estrito: true });
    expect(listarVozes).not.toHaveBeenCalled();
    await passar(3000);
    expect(listarVozes).toHaveBeenCalledTimes(1);
    const grupo = screen.getByRole("group", { name: "Escolha a voz da Janete" });
    expect(grupo).toContainElement(screen.getByRole("radiogroup", { name: "Voz da Janete" }));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    // o radiogroup só tem radios (o "Ouvir", quando há prévia, fica numa coluna irmã)
    for (const filho of screen.getByRole("radiogroup", { name: "Voz da Janete" }).children) {
      expect(filho).toHaveAttribute("role", "radio");
    }
    expect(radio("Ana")).toHaveAttribute("aria-checked", "false");
    expect(proximo()).toHaveFocus();
    await passar(1000);
    expect(listarVozes).toHaveBeenCalledTimes(1);
  });

  it("as setas e o clique só marcam a voz, sem chamar o servidor", async () => {
    await validarChave();
    await passar(3000);
    fireEvent.click(radio("Ana"));
    expect(radio("Ana")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radio("Ana"), { key: "ArrowDown" });
    expect(radio("Bruno")).toHaveAttribute("aria-checked", "true");
    expect(radio("Bruno")).toHaveFocus();
    fireEvent.keyDown(radio("Bruno"), { key: "End" });
    expect(radio("Carla")).toHaveAttribute("aria-checked", "true");
    await passar(500);
    expect(escolherVoz).not.toHaveBeenCalled();
    expect(listarVozes).toHaveBeenCalledTimes(1);
  });

  it("Próximo com uma voz nova: grava uma vez (Salvando… na linha), anuncia e só depois rola, pousa e avança", async () => {
    const { avancar } = await validarChave();
    await passar(3000);
    const espera = adiada<ResultadoEscolherVoz>();
    responderEscolha = () => espera.promessa;
    fireEvent.click(radio("Bruno"));
    rolarAteEMedir.mockClear();
    fireEvent.click(proximo());
    // um segundo clique durante a gravação não grava de novo
    fireEvent.click(proximo());
    expect(escolherVoz).toHaveBeenCalledTimes(1);
    expect(escolherVoz).toHaveBeenCalledWith({ vozId: "v2" });
    await passar(100);
    expect(screen.getByText("Salvando…")).toBeInTheDocument();
    expect(rolarAteEMedir).not.toHaveBeenCalled();
    expect(voo.pousar).not.toHaveBeenCalled();
    expect(avancar).not.toHaveBeenCalled();

    await act(async () => {
      espera.resolver({ ok: true, voz: { id: "v2", nome: "Bruno" } });
    });
    expect(anunciar).toHaveBeenCalledWith("Voz escolhida: Bruno.");
    await passar(20);
    expect(rolarAteEMedir.mock.calls).toEqual([["disco-mira", { bloco: "center" }]]);
    expect(voo.pousar).toHaveBeenCalledTimes(1);
    expect(voo.pousar).toHaveBeenCalledWith(PONTO, "acordada");
    await passar(240);
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(escolherVoz).toHaveBeenCalledTimes(1);
  });

  it("Próximo com a mesma voz (a atual) não grava e voa", async () => {
    responderVozes = async () => ({ ok: true, vozes: VOZES, atual: { id: "v1", nome: "Ana" } });
    const { avancar } = await validarChave();
    await passar(3000);
    expect(radio("Ana")).toHaveAttribute("aria-checked", "true");
    // marca outra e volta para a atual: nada mudou
    fireEvent.click(radio("Bruno"));
    fireEvent.click(radio("Ana"));
    fireEvent.click(proximo());
    await passar(300);
    expect(escolherVoz).not.toHaveBeenCalled();
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("Próximo sem voz marcada avança sem gravar", async () => {
    const { avancar } = await validarChave();
    await passar(3000);
    fireEvent.click(proximo());
    await passar(300);
    expect(escolherVoz).not.toHaveBeenCalled();
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("a gravação recusada mostra o erro no bloco e não avança; o Próximo de novo grava e segue", async () => {
    responderEscolha = async () => ({
      ok: false,
      erro: "voz_nao_encontrada",
      mensagem: "A voz escolhida não existe mais na conta. Escolha outra voz.",
    });
    const { avancar } = await validarChave();
    await passar(3000);
    fireEvent.click(radio("Bruno"));
    fireEvent.click(proximo());
    await passar(1000);
    expect(avancar).not.toHaveBeenCalled();
    expect(voo.pousar).not.toHaveBeenCalled();
    const grupo = screen.getByRole("group", { name: "Escolha a voz da Janete" });
    expect(grupo).toHaveTextContent("A voz escolhida não existe mais na conta. Escolha outra voz.");
    // o Chave aceita continua, com o Próximo e a voz marcada
    expect(screen.getByText("Chave aceita")).toBeInTheDocument();
    expect(radio("Bruno")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("Salvando…")).toBeNull();

    responderEscolha = async () => ({ ok: true, voz: { id: "v2", nome: "Bruno" } });
    fireEvent.click(proximo());
    await passar(300);
    expect(escolherVoz).toHaveBeenCalledTimes(2);
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("a gravação sem resposta (rede) mostra o texto próprio e não avança", async () => {
    responderEscolha = () => Promise.reject(new Error("rede"));
    const { avancar } = await validarChave();
    await passar(3000);
    fireEvent.click(radio("Carla"));
    fireEvent.click(proximo());
    await passar(500);
    expect(avancar).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Escolha a voz da Janete" })).toHaveTextContent(
      "Não conseguimos salvar a voz agora. Confira a sua internet e tente de novo em instantes.",
    );
  });

  it("a gravação com a sessão terminada pede para entrar de novo, sem avançar", async () => {
    const { avancar } = await validarChave();
    await passar(3000);
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    responderEscolha = () => Promise.reject(new Error("Unauthorized"));
    fireEvent.click(radio("Carla"));
    fireEvent.click(proximo());
    await passar(500);
    expect(avancar).not.toHaveBeenCalled();
    const grupo = screen.getByRole("group", { name: "Escolha a voz da Janete" });
    expect(grupo).toHaveTextContent("Sua sessão terminou.");
    expect(screen.getByRole("button", { name: "Entrar de novo" })).toBeInTheDocument();
  });

  it("a falha da lista aparece no bloco e não tira o Próximo, que avança sem gravar", async () => {
    responderVozes = () => Promise.reject(new Error("rede"));
    const { avancar } = await validarChave();
    await passar(3000);
    const grupo = screen.getByRole("group", { name: "Escolha a voz da Janete" });
    expect(grupo).toHaveTextContent("Não conseguimos buscar as vozes agora.");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(screen.getByText("Chave aceita")).toBeInTheDocument();
    fireEvent.click(proximo());
    await passar(300);
    expect(escolherVoz).not.toHaveBeenCalled();
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("a recusa da lista (sem permissão) mostra a mensagem do servidor no bloco", async () => {
    responderVozes = async () => ({
      ok: false,
      erro: "sem_permissao",
      mensagem: "A chave não tem o acesso Voices. Na ElevenLabs, edite a chave.",
    });
    await validarChave();
    await passar(3000);
    expect(screen.getByRole("group", { name: "Escolha a voz da Janete" })).toHaveTextContent("A chave não tem o acesso Voices.");
    expect(proximo()).toBeInTheDocument();
  });

  it("Trocar chave esquece a lista e a voz marcada; a chave nova busca de novo", async () => {
    await validarChave();
    await passar(3000);
    fireEvent.click(radio("Bruno"));
    fireEvent.click(screen.getByRole("button", { name: "Trocar chave" }));
    await passar(400);
    expect(screen.queryAllByRole("radio", { hidden: true })).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Escolha a voz da Janete", hidden: true })).toBeNull();

    fireEvent.change(campo(), { target: { value: CHAVE } });
    fireEvent.click(botaoValidar());
    await passar(3000);
    expect(listarVozes).toHaveBeenCalledTimes(2);
    // a marcada da chave anterior foi esquecida
    expect(radio("Bruno")).toHaveAttribute("aria-checked", "false");
    expect(escolherVoz).not.toHaveBeenCalled();
  });

  it("quem volta com a chave vê a lista ao abrir (uma busca no StrictMode), com a voz atual marcada", async () => {
    naAba("wxyz");
    responderVozes = async () => ({ ok: true, vozes: VOZES, atual: { id: "v3", nome: "Carla" } });
    montar({ estrito: true });
    await passar(100);
    expect(listarVozes).toHaveBeenCalledTimes(1);
    expect(radio("Carla")).toHaveAttribute("aria-checked", "true");
    expect(proximo()).toHaveFocus();
  });
});
