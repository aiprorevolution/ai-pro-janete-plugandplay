import { act, fireEvent, render as renderRTL, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProvedorDadosOnboarding, criarDadosOnboardingMemoria, type DadosOnboarding } from "@/features/plataforma/dados/onboarding";

// C8: o "Pode montar" grava o Contexto pela camada de dados do onboarding (aqui, sem banco).
const salvarContexto = vi.fn<DadosOnboarding["salvarContexto"]>();
function render(ui: ReactElement) {
  const dados = criarDadosOnboardingMemoria({ salvarContexto });
  const wrapper = ({ children }: { children: ReactNode }) => <ProvedorDadosOnboarding dados={dados}>{children}</ProvedorDadosOnboarding>;
  return renderRTL(ui, { wrapper });
}
/** Deixa a gravação do Contexto (uma promessa) terminar. */
const gravou = () => act(async () => {});

const ponto = { x: 60, y: 120, tamanho: 40 };
const voo = {
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
};

vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  useVooJanete: () => voo,
  medirJanete: vi.fn(() => ponto),
  rolarAteEMedir: vi.fn(() => Promise.resolve(ponto)),
  movimentoReduzido: () => false,
}));

import { EtapaConversa } from "@/features/onboarding/conversa";
import { LIMITE_RESPOSTA_CHAT } from "@/features/onboarding/conversa/EtapaConversa";
import { FALA_EDITAR, retomarConversa } from "@/features/onboarding/conversa/historico";
import { medirJanete, rolarAteEMedir } from "@/components/janete/VooJanete";
import {
  CAMPOS_CONTEXTO,
  ESTADO_INICIAL,
  gravarEstadoOnboarding,
  lerEstadoOnboarding,
  limparEstadoOnboarding,
} from "@/features/onboarding/estado";
import { INTRO, PERGUNTA_FINAL, RESUMO_ABRE, ROTEIRO } from "@/features/onboarding/roteiro";

// Avança em passos de 20 ms, cada um no seu act: o React pinta entre um passo e outro, como no navegador.
async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 20) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(20, ms - feito));
    });
  }
}

const RESPOSTAS_TESTE = ROTEIRO.map((p, i) => `Resposta de teste ${i + 1} para ${p.rotulo}`);

function gravarRespostas(n: number) {
  const respostas: Record<string, string> = {};
  ROTEIRO.slice(0, n).forEach((p, i) => (respostas[p.campo] = RESPOSTAS_TESTE[i]!));
  gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "conversa", conversa: { respostas, confirmado: false } });
}

const entrada = () => screen.getByRole("textbox", { name: "Sua resposta para a Janete" });

beforeEach(() => {
  vi.useFakeTimers();
  limparEstadoOnboarding();
  voo.ativo = false;
  vi.clearAllMocks();
  salvarContexto.mockReset();
  salvarContexto.mockResolvedValue({ ok: true, valor: { id: 7, numero: 1 } });
});
afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("roteiro da conversa", () => {
  it("8 respostas digitadas preenchem os 8 campos e terminam no resumo com o botão de montar", async () => {
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Conversa com a Janete" })).toBeInTheDocument();
    await passar(20000);
    expect(screen.getByText(INTRO[0]!)).toBeInTheDocument();
    expect(screen.getByText(ROTEIRO[0]!.pergunta)).toBeInTheDocument();
    expect(screen.getByText("Pergunta 1 de 8")).toBeInTheDocument();

    for (let i = 0; i < ROTEIRO.length; i++) {
      fireEvent.change(entrada(), { target: { value: RESPOSTAS_TESTE[i] } });
      fireEvent.keyDown(entrada(), { key: "Enter" });
      expect(lerEstadoOnboarding().conversa.respostas[ROTEIRO[i]!.campo]).toBe(RESPOSTAS_TESTE[i]);
      await passar(20000);
      expect(screen.getByText(ROTEIRO[i]!.reagir(RESPOSTAS_TESTE[i]!))).toBeInTheDocument();
    }

    const respostas = lerEstadoOnboarding().conversa.respostas;
    expect(CAMPOS_CONTEXTO.every((c) => respostas[c])).toBe(true);
    expect(screen.getByText(RESUMO_ABRE)).toBeInTheDocument();
    expect(screen.getByText(FALA_EDITAR)).toBeInTheDocument();
    expect(screen.getByText(PERGUNTA_FINAL)).toBeInTheDocument();
    expect(screen.getByText("Meu jeito de trabalhar")).toBeInTheDocument();
    expect(screen.getByText("Conversa completa")).toBeInTheDocument();
    expect(screen.getByText("8 de 8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pode montar/ })).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "Sua resposta para a Janete" })).toBeNull();
  });

  it("sem respostas de exemplo: a pessoa responde só pelo campo de texto", async () => {
    const { container } = render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    await passar(20000);
    expect(screen.queryByText(/Respostas de exemplo|Casa Verde|empresa fictícia/)).toBeNull();
    // no pé do chat só fica o compositor: o campo e o botão de enviar
    const base = entrada().parentElement!.parentElement!;
    expect(within(base).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Enviar resposta"]);
    expect(container.textContent).not.toMatch(/Casa Verde|fictícia/);
    fireEvent.change(entrada(), { target: { value: RESPOSTAS_TESTE[0] } });
    fireEvent.keyDown(entrada(), { key: "Enter" });
    expect(lerEstadoOnboarding().conversa.respostas.empresa_oferta).toBe(RESPOSTAS_TESTE[0]);
    // enquanto a Janete fala, o envio fica bloqueado
    expect(screen.getByRole("button", { name: "Enviar resposta" })).toBeDisabled();
  });

  it("clicar em Enviar resposta grava e o campo continua com o foco", async () => {
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    await passar(20000);
    const enviar = screen.getByRole("button", { name: "Enviar resposta" });
    entrada().focus();
    fireEvent.change(entrada(), { target: { value: RESPOSTAS_TESTE[0] } });
    // o mousedown do botão é cancelado: o clique ou toque não tira o foco do campo
    expect(fireEvent.mouseDown(enviar)).toBe(false);
    // quem chegou pelo Tab: o foco está no botão, que fica desabilitado depois de enviar
    enviar.focus();
    fireEvent.click(enviar);
    expect(lerEstadoOnboarding().conversa.respostas[ROTEIRO[0]!.campo]).toBe(RESPOSTAS_TESTE[0]);
    expect(enviar).toBeDisabled();
    expect(entrada()).toHaveFocus();
    expect(entrada()).toHaveValue("");
    // depois da fala da Janete, a próxima resposta sai do mesmo campo, sem tocar nele de novo
    await passar(20000);
    expect(entrada()).toHaveFocus();
    fireEvent.change(entrada(), { target: { value: RESPOSTAS_TESTE[1] } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    expect(lerEstadoOnboarding().conversa.respostas[ROTEIRO[1]!.campo]).toBe(RESPOSTAS_TESTE[1]);
    expect(entrada()).toHaveFocus();
  });

  it("o campo da conversa não aceita mais do que o estado guarda", async () => {
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    await passar(20000);
    expect(entrada()).toHaveAttribute("maxLength", String(LIMITE_RESPOSTA_CHAT));
  });

  it("não envia resposta vazia", async () => {
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    await passar(20000);
    fireEvent.change(entrada(), { target: { value: "   " } });
    fireEvent.keyDown(entrada(), { key: "Enter" });
    expect(lerEstadoOnboarding().conversa.respostas).toEqual({});
  });

  it("ao recarregar no meio, retoma das respostas gravadas", async () => {
    gravarRespostas(3);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    expect(within(screen.getByRole("log")).getByText(RESPOSTAS_TESTE[2]!)).toBeInTheDocument();
    expect(screen.getByText("Pergunta 4 de 8")).toBeInTheDocument();
    expect(screen.getByText("3 de 8")).toBeInTheDocument();
    await passar(20000);
    expect(screen.getByText(ROTEIRO[3]!.pergunta)).toBeInTheDocument();
  });
});

describe("retomarConversa", () => {
  it("sem respostas, abre com a INTRO e a primeira pergunta", () => {
    const r = retomarConversa({});
    expect(r.mensagens).toEqual([]);
    expect(r.falar).toEqual([INTRO[0], INTRO[1], ROTEIRO[0]!.pergunta]);
  });

  it("com as 8 respostas, termina no resumo", () => {
    const todas = Object.fromEntries(ROTEIRO.map((p, i) => [p.campo, RESPOSTAS_TESTE[i]]));
    const r = retomarConversa(todas);
    expect(r.fim).toBe(true);
    expect(r.q).toBe(8);
    expect(r.mensagens.map((m) => m.de).slice(-4)).toEqual(["janete", "resumo", "janete", "janete"]);
    expect(r.mensagens.slice(-2).map((m) => m.texto)).toEqual([FALA_EDITAR, PERGUNTA_FINAL]);
    expect(r.falar).toEqual([]);
  });
});

const linhaResumo = (rotulo: string) =>
  within(screen.getByRole("log")).getByRole("button", { name: new RegExp(`^Alterar ${rotulo}`) });

describe("balões no formato do WhatsApp", () => {
  it("mensagens seguidas do mesmo autor formam um grupo: só a primeira tem a pontinha; sem horário", async () => {
    gravarRespostas(2);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    const msgs = Array.from(screen.getByRole("log").children) as HTMLElement[];
    // INTRO[0], INTRO[1], pergunta 1, resposta 1, reação 1, pergunta 2, resposta 2, reação 2
    expect(msgs.map((m) => m.dataset["de"])).toEqual(["janete", "janete", "janete", "eu", "janete", "janete", "eu", "janete"]);
    expect(msgs.map((m) => m.hasAttribute("data-turno"))).toEqual([true, false, false, true, true, false, true, true]);
    // cada fala é um balão
    for (const m of msgs) expect(m.firstElementChild?.className).toMatch(/bolha/);
    // sem horário e sem "vistos"
    expect(screen.getByRole("log").textContent).not.toMatch(/\d{1,2}:\d{2}|✓/);
  });

  it("o digitando também vem num balão, com a pontinha quando abre um grupo", async () => {
    gravarRespostas(1);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    await passar(500);
    const digitando = screen.getByText("A Janete está digitando").closest("[data-de]") as HTMLElement;
    expect(digitando.dataset["de"]).toBe("janete");
    // a última mensagem é a reação da Janete: o digitando continua o grupo dela, sem pontinha
    expect(digitando).not.toHaveAttribute("data-turno");
    expect(digitando.firstElementChild).toHaveAttribute("data-digitando");
  });
});

describe("editar no chat (fim da conversa)", () => {
  it("o painel O que eu já sei fica só leitura no fim: sem caixas de texto e sem Ajustar respostas", async () => {
    gravarRespostas(8);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    const painel = screen.getByRole("complementary", { name: "O que eu já sei" });
    expect(within(painel).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(painel).queryAllByRole("button")).toHaveLength(0);
    expect(within(painel).queryByText(/Ajustar respostas|Fechar ajustes/)).toBeNull();
    expect(within(painel).getByText(RESPOSTAS_TESTE[0]!)).toBeInTheDocument();
    // o painel vem antes do chat no DOM (ordem do Tab igual à da tela no celular)
    const chat = document.getElementById("chat-painel")!;
    expect(painel.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicar numa linha do resumo abre a caixa no chat; Enter salva e atualiza o painel", async () => {
    gravarRespostas(8);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    expect(screen.getByText(FALA_EDITAR)).toBeInTheDocument();
    const log = screen.getByRole("log");
    // as 8 linhas do resumo são botões
    expect(within(log).getAllByRole("button", { name: /^Alterar / })).toHaveLength(8);

    fireEvent.click(linhaResumo("Tom de voz"));
    const caixa = within(log).getByRole("textbox", { name: "Tom de voz" });
    expect(caixa).toHaveValue(RESPOSTAS_TESTE[ROTEIRO.findIndex((p) => p.campo === "tom_voz")]);
    await passar(60);
    expect(caixa).toHaveFocus();
    expect(within(log).getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    expect(within(log).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();

    // Shift+Enter quebra a linha: não salva
    fireEvent.change(caixa, { target: { value: "Leve e simpático" } });
    fireEvent.keyDown(caixa, { key: "Enter", shiftKey: true });
    expect(within(log).getByRole("textbox", { name: "Tom de voz" })).toBeInTheDocument();
    expect(lerEstadoOnboarding().conversa.respostas.tom_voz).not.toBe("Leve e simpático");

    fireEvent.keyDown(caixa, { key: "Enter" });
    expect(lerEstadoOnboarding().conversa.respostas.tom_voz).toBe("Leve e simpático");
    expect(within(log).queryByRole("textbox")).toBeNull();
    // o resumo e o painel mostram o valor novo
    expect(linhaResumo("Tom de voz")).toHaveTextContent("Leve e simpático");
    const painel = screen.getByRole("complementary", { name: "O que eu já sei" });
    expect(within(painel).getAllByText("Leve e simpático").length).toBeGreaterThan(0);
    await passar(60);
    expect(linhaResumo("Tom de voz")).toHaveFocus();
  });

  it("o botão Salvar grava sem os espaços das pontas", async () => {
    gravarRespostas(8);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    fireEvent.click(linhaResumo("Preço"));
    fireEvent.change(screen.getByRole("textbox", { name: "Preço" }), { target: { value: "  Valor de teste  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(lerEstadoOnboarding().conversa.respostas.preco).toBe("Valor de teste");
  });

  it("Cancelar e Esc fecham sem gravar", async () => {
    gravarRespostas(8);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    const antes = lerEstadoOnboarding().conversa.respostas.preco;

    fireEvent.click(linhaResumo("Preço"));
    fireEvent.change(screen.getByRole("textbox", { name: "Preço" }), { target: { value: "Outro valor" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("textbox", { name: "Preço" })).toBeNull();
    expect(lerEstadoOnboarding().conversa.respostas.preco).toBe(antes);
    await passar(60);
    expect(linhaResumo("Preço")).toHaveFocus();

    fireEvent.click(linhaResumo("Preço"));
    const caixa = screen.getByRole("textbox", { name: "Preço" });
    // ao reabrir, a caixa volta com o valor gravado, não com o rascunho cancelado
    expect(caixa).toHaveValue(antes);
    fireEvent.change(caixa, { target: { value: "Mais um valor" } });
    fireEvent.keyDown(caixa, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Preço" })).toBeNull();
    expect(lerEstadoOnboarding().conversa.respostas.preco).toBe(antes);
  });

  it("campo vazio não salva: a caixa continua aberta, com o erro", async () => {
    gravarRespostas(8);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    const antes = lerEstadoOnboarding().conversa.respostas.preco;
    fireEvent.click(linhaResumo("Preço"));
    const caixa = screen.getByRole("textbox", { name: "Preço" });
    fireEvent.change(caixa, { target: { value: "   " } });
    fireEvent.keyDown(caixa, { key: "Enter" });
    expect(caixa).toBeInTheDocument();
    expect(caixa).toHaveAttribute("aria-invalid", "true");
    expect(lerEstadoOnboarding().conversa.respostas.preco).toBe(antes);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(lerEstadoOnboarding().conversa.respostas.preco).toBe(antes);
    // escrever de novo tira o erro
    fireEvent.change(caixa, { target: { value: "Valor" } });
    expect(caixa).not.toHaveAttribute("aria-invalid");
  });

  it("a caixa não aceita mais do que o estado guarda", async () => {
    gravarRespostas(8);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    fireEvent.click(linhaResumo("Tom de voz"));
    const caixa = screen.getByRole("textbox", { name: "Tom de voz" });
    fireEvent.change(caixa, { target: { value: "a".repeat(LIMITE_RESPOSTA_CHAT + 50) } });
    expect((caixa as HTMLTextAreaElement).value).toHaveLength(LIMITE_RESPOSTA_CHAT);
    fireEvent.keyDown(caixa, { key: "Enter" });
    expect(lerEstadoOnboarding().conversa.respostas.tom_voz).toHaveLength(LIMITE_RESPOSTA_CHAT);
  });

  it("as linhas do resumo só ficam clicáveis depois que a Janete termina de falar", async () => {
    gravarRespostas(7);
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    await passar(20000);
    fireEvent.change(entrada(), { target: { value: RESPOSTAS_TESTE[7] } });
    fireEvent.keyDown(entrada(), { key: "Enter" });
    // espera o cartão do resumo aparecer, antes do fim das falas
    for (let i = 0; i < 400 && !screen.queryByText("Meu jeito de trabalhar"); i++) await passar(20);
    expect(screen.queryByText(PERGUNTA_FINAL)).toBeNull();
    expect(linhaResumo("Preço")).toBeDisabled();
    await passar(20000);
    expect(linhaResumo("Preço")).toBeEnabled();
  });

  it("Pode montar confirma o Contexto e segue para o preparo", async () => {
    gravarRespostas(8);
    const avancar = vi.fn();
    render(<EtapaConversa avancar={avancar} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Pode montar/ }));
    // grava no banco antes de confirmar (contexto_salvar, origem onboarding)
    expect(lerEstadoOnboarding().conversa.confirmado).toBe(false);
    await gravou();
    expect(salvarContexto).toHaveBeenCalledTimes(1);
    expect(salvarContexto).toHaveBeenCalledWith(Object.fromEntries(ROTEIRO.map((p, i) => [p.campo, RESPOSTAS_TESTE[i]])));
    expect(lerEstadoOnboarding().conversa.confirmado).toBe(true);
    expect(avancar).not.toHaveBeenCalled();
    // a saída também traz o avatar para a vista antes de medir (decisão 5b)
    expect(rolarAteEMedir).toHaveBeenCalledWith("chat-avatar");
    await passar(520);
    expect(voo.pousar).toHaveBeenCalledWith(ponto, "carregando");
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("o símbolo pousa no avatar medido na hora do pouso, não no da hora do clique", async () => {
    gravarRespostas(8);
    const avancar = vi.fn();
    render(<EtapaConversa avancar={avancar} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Pode montar/ }));
    await passar(20);
    // a página rolou durante o recolhimento: o avatar está em outro lugar
    const depois = { x: 60, y: 300, tamanho: 40 };
    vi.mocked(medirJanete).mockImplementation(() => depois);
    try {
      await passar(520);
      expect(voo.pousar).toHaveBeenCalledWith(depois, "carregando");
      expect(avancar).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(medirJanete).mockImplementation(() => ponto);
    }
  });

  it("com uma linha aberta em edição, Pode montar grava o texto novo antes de confirmar", async () => {
    gravarRespostas(8);
    const avancar = vi.fn();
    render(<EtapaConversa avancar={avancar} voltar={vi.fn()} />);
    fireEvent.click(linhaResumo("Preço"));
    fireEvent.change(screen.getByRole("textbox", { name: "Preço" }), { target: { value: "  Outro valor  " } });
    fireEvent.click(screen.getByRole("button", { name: /Pode montar/ }));
    await gravou();
    expect(salvarContexto.mock.calls[0]![0].preco).toBe("Outro valor");
    const conversa = lerEstadoOnboarding().conversa;
    expect(conversa.respostas.preco).toBe("Outro valor");
    expect(conversa.confirmado).toBe(true);
    await passar(520);
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("com a linha em edição vazia, Pode montar não avança: a caixa fica aberta, com o erro e o foco", async () => {
    gravarRespostas(8);
    const avancar = vi.fn();
    render(<EtapaConversa avancar={avancar} voltar={vi.fn()} />);
    const antes = lerEstadoOnboarding().conversa.respostas.preco;
    fireEvent.click(linhaResumo("Preço"));
    fireEvent.change(screen.getByRole("textbox", { name: "Preço" }), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Pode montar/ }));
    const caixa = screen.getByRole("textbox", { name: "Preço" });
    expect(caixa).toHaveAttribute("aria-invalid", "true");
    await passar(600);
    expect(caixa).toHaveFocus();
    const conversa = lerEstadoOnboarding().conversa;
    expect(conversa.respostas.preco).toBe(antes);
    expect(conversa.confirmado).toBe(false);
    expect(avancar).not.toHaveBeenCalled();
    expect(voo.pousar).not.toHaveBeenCalled();
    expect(salvarContexto).not.toHaveBeenCalled();
  });

  it.each([
    ["limite_tamanho", "Uma das respostas passou de 2.000 letras. Encurte e tente de novo."],
    ["contexto_mudou", "Outra pessoa da equipe mudou o Contexto agora há pouco. Recarregue a página para ver o que mudou e monte de novo."],
    ["sem_acesso", "Sua conta não pode montar o Contexto. Só o admin da empresa faz esta etapa."],
    ["falha", "Não conseguimos guardar agora. Confira a sua internet e tente de novo."],
  ] as const)("o banco recusou (%s): não avança, mostra o texto certo e deixa tentar de novo", async (erro, texto) => {
    gravarRespostas(8);
    salvarContexto.mockResolvedValueOnce({ ok: false, erro });
    const avancar = vi.fn();
    render(<EtapaConversa avancar={avancar} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Pode montar/ }));
    await gravou();
    expect(screen.getByRole("alert")).toHaveTextContent(texto);
    expect(lerEstadoOnboarding().conversa.confirmado).toBe(false);
    await passar(600);
    expect(avancar).not.toHaveBeenCalled();
    expect(voo.pousar).not.toHaveBeenCalled();
    const botao = screen.getByRole("button", { name: /Tentar de novo/ });
    expect(botao).toHaveFocus();
    // a segunda tentativa grava e segue
    fireEvent.click(botao);
    await gravou();
    expect(salvarContexto).toHaveBeenCalledTimes(2);
    expect(lerEstadoOnboarding().conversa.confirmado).toBe(true);
    await passar(520);
    expect(avancar).toHaveBeenCalledTimes(1);
  });

  it("enquanto grava, o botão fica ocupado e um 2º clique não grava de novo", async () => {
    gravarRespostas(8);
    let terminar: (r: { ok: true; valor: { id: number; numero: number } }) => void = () => {};
    salvarContexto.mockReturnValueOnce(new Promise((r) => (terminar = r)));
    render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Pode montar/ }));
    await gravou();
    const botao = screen.getByRole("button", { name: /Guardando/ });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("aria-busy", "true");
    fireEvent.click(botao);
    expect(salvarContexto).toHaveBeenCalledTimes(1);
    await act(async () => terminar({ ok: true, valor: { id: 7, numero: 1 } }));
    expect(lerEstadoOnboarding().conversa.confirmado).toBe(true);
  });
});

describe("chegada com o símbolo em voo", () => {
  it("o chat espera fechado, o símbolo voa até o avatar, é solto e o chat abre e começa a conversa", async () => {
    voo.ativo = true;
    const { container } = render(<EtapaConversa avancar={vi.fn()} voltar={vi.fn()} />);
    const painel = container.querySelector("#chat-painel")!;
    expect(painel).toHaveAttribute("data-chat", "espera");
    expect(container.querySelector("#chat-avatar")).toHaveAttribute("data-oculto");

    await passar(60);
    // a chegada mede o avatar com rolarAteEMedir (traz para a vista e espera a rolagem parar)
    expect(rolarAteEMedir).toHaveBeenCalledWith("chat-avatar");
    expect(voo.voar).toHaveBeenCalledWith(ponto, { duracaoMs: 860, estado: "acordada" });
    expect(voo.soltar).toHaveBeenCalled();
    expect(painel).toHaveAttribute("data-chat", "abrindo");

    await passar(660);
    expect(painel).toHaveAttribute("data-chat", "aberto");
    await passar(60);
    expect(entrada()).toHaveFocus();
    await passar(20000);
    expect(screen.getByText(ROTEIRO[0]!.pergunta)).toBeInTheDocument();
  });
});
