import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaConfiguracao } from "@/features/plataforma/configuracao";
import { lerCerebro, lerWhats, quandoValidada } from "@/features/plataforma/configuracao/leitura";
import { mudarRitmo } from "@/features/plataforma/configuracao/CartaoRitmo";
import { chaveTemFinal, ultimos4De } from "@/features/plataforma/configuracao/dados";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarEstadoInicial, type ChaveIA, type EstadoBase } from "@/features/plataforma/exemplo";
import { ProvedorPapel, usePapel, type Papel } from "@/features/plataforma/papel";

// Sem movimento: as animações vão direto ao fim (os tempos da validação ficam curtos) e a página
// não rola até o disco antes de dobrar o cartão.
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return { ...real, movimentoReduzido: () => true, rolarAteEMedir: () => Promise.resolve(null) };
});

const AGORA = new Date("2026-10-30T15:00:00-03:00");

function montar({
  papel = "admin",
  inicial,
  estrito = false,
}: { papel?: Papel; inicial?: (base: EstadoBase) => EstadoBase; estrito?: boolean } = {}) {
  const base = criarEstadoInicial(AGORA);
  return render(
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={inicial ? inicial(base) : base} progredirEnvios={false} relogio={() => new Date(AGORA)}>
        <TelaConfiguracao />
      </ProvedorDados>
    </ProvedorPapel>,
    { reactStrictMode: estrito },
  );
}

async function andar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** O exemplo com a chave da voz (ElevenLabs) e, se vier, a escolha guardada em `configuracao`. */
function comVoz(chave: Partial<ChaveIA> = {}, cfg: Partial<EstadoBase["configuracao"]> = {}) {
  return (b: EstadoBase): EstadoBase => ({
    ...b,
    chaves: [
      ...b.chaves,
      {
        id: "ch-voz",
        finalidade: "voz",
        provedor: "elevenlabs",
        modelo: "",
        status: "ativa",
        ultimos4: "VOZ1",
        ultimo_erro: null,
        validada_em: AGORA.toISOString(),
        atualizada_em: AGORA.toISOString(),
        atualizada_por: null,
        ...chave,
      },
    ],
    configuracao: { ...b.configuracao, ...cfg },
  });
}

const cartao = (peca: "whats" | "cerebro" | "escuta" | "voz" | "ritmo") => document.getElementById(`cfg-card-${peca}`)!;
const fluxo = () => document.getElementById("cfg-fluxo");
const botao = (nome: string | RegExp, dentro: HTMLElement = document.body) => within(dentro).getByRole("button", { name: nome });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Configuração 3 · o caminho da mensagem", () => {
  it("título da área, saúde com o fio de 5 nós na ordem da mensagem e os cartões com os dados do exemplo", () => {
    montar();
    expect(screen.getByRole("heading", { level: 1, name: "Configuração" })).toHaveAttribute("id", "area-configuracao");

    const saude = screen.getByTestId("cfg-saude");
    expect(within(saude).getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
    expect(within(saude).getByRole("img", { name: "Janete, atendendo" })).toBeInTheDocument();
    const fio = within(saude).getByRole("list");
    const pecas = within(fio).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(pecas).toEqual([
      "Recebe, WhatsApp: Conectado · Z-API. Ver os detalhes.",
      "Escuta, Áudios em texto: Não configurada · a Janete pede texto. Ver os detalhes.",
      "Espera, Junta as mensagens: Espera 8 s, no máximo 60 s. Ver os detalhes.",
      "Responde, Cérebro: Ativa · Claude Haiku 5.5. Ver os detalhes.",
      "Fala, Voz da Janete: Não configurada · responde em texto. Ver os detalhes.",
    ]);
    // a escuta não configurada é atenção (areia), não parada; a voz sem chave fica neutra
    expect(fio.querySelectorAll('[data-estado="ok"]')).toHaveLength(3);
    expect(fio.querySelectorAll('[data-estado="atencao"]')).toHaveLength(1);
    // um trecho de fio entre cada par de nós
    expect(fio.querySelectorAll('[class*="cfSegFio"]')).toHaveLength(4);

    const w = cartao("whats");
    expect(within(w).getByRole("heading", { name: "(11) 90000-0000" })).toBeInTheDocument();
    expect(within(w).getByText("Z-API")).toBeInTheDocument();
    expect(within(w).getByText("Fácil")).toBeInTheDocument();
    expect(within(w).getByText(/Não oficial, pelo QR code/)).toBeInTheDocument();
    expect(w.querySelector("img")).toHaveAttribute("src", "/logos/zapi-logo.png");
    // Z-API recebe o webhook sozinha: nada de endereço nem token para colar
    expect(within(w).queryByText(/webhook/i)).not.toBeInTheDocument();

    const c = cartao("cerebro");
    expect(within(c).getByRole("heading", { name: "Claude Haiku 5.5" })).toBeInTheDocument();
    expect(within(c).getByText("Anthropic")).toBeInTheDocument();
    expect(within(c).getByText("Rápido e barato")).toBeInTheDocument();
    expect(within(c).getByText("US$ 0,10 / 0,50 por 1M tokens")).toBeInTheDocument();
    expect(c.textContent).toContain("terminada em TSTE");
    expect(within(c).getByText(/^hoje às \d{1,2}h\d{2}$/)).toBeInTheDocument();

    const e = cartao("escuta");
    expect(within(e).getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
    expect(botao("Conectar uma chave", e)).toBeInTheDocument();

    const r = cartao("ritmo");
    expect(within(r).getByRole("heading", { name: "24 horas, todos os dias" })).toBeInTheDocument();
    expect(screen.getByTestId("cfg-valor-espera").textContent).toBe("8s");
    expect(screen.getByTestId("cfg-valor-teto").textContent).toBe("60s");
  });

  it("Conferir tudo agora: uma peça de cada vez, e no fim o check da Janete", async () => {
    montar();
    expect(screen.getByText("Confere as cinco peças agora, sem falar com nenhum lead.")).toBeInTheDocument();
    fireEvent.click(botao("Conferir tudo agora"));
    expect(screen.getByRole("heading", { name: "Conferindo as cinco peças" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Janete, conferindo" })).toBeInTheDocument();
    await andar(1000);
    expect(screen.getByRole("heading", { name: "Tudo certo nas cinco peças" })).toBeInTheDocument();
    expect(screen.getByText("A conexão e o cérebro responderam. Só os áudios ainda não viram texto: a Janete pede para o lead escrever.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Janete, tudo certo" })).toBeInTheDocument();
    expect(botao("Conferir de novo")).toBeInTheDocument();
    await andar(2000);
    expect(screen.getByRole("img", { name: "Janete, atendendo" })).toBeInTheDocument();
  });

  it("Testar a conexão agora: gira o logo, avisa e marca 'testado agora'", async () => {
    montar();
    const w = cartao("whats");
    fireEvent.click(botao("Testar a conexão agora", w));
    expect(within(w).getAllByText("Testando…").length).toBeGreaterThan(0);
    expect(w.querySelector("[data-gira]")).not.toBeNull();
    await andar(400);
    expect(within(w).getByText("Conectado · testado agora")).toBeInTheDocument();
    expect(screen.getAllByText("A Z-API respondeu. O WhatsApp está conectado.").length).toBeGreaterThan(0);
  });

  it("Desconectar pede confirmação: Cancelar e Esc não mudam nada; Desconectar para a Janete", async () => {
    montar();
    fireEvent.click(botao("Desconectar", cartao("whats")));
    let dlg = screen.getByRole("alertdialog", { name: "Desconectar o WhatsApp?" });
    expect(dlg).toHaveTextContent("A Janete para de receber e de responder mensagens no (11) 90000-0000");
    fireEvent.click(botao("Cancelar", dlg));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(cartao("whats")).getByText("Conectado")).toBeInTheDocument();

    fireEvent.click(botao("Desconectar", cartao("whats")));
    dlg = screen.getByRole("alertdialog");
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    // o foco fica preso no diálogo: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último
    fireEvent.click(botao("Desconectar", cartao("whats")));
    dlg = screen.getByRole("alertdialog");
    const cancelar = botao("Cancelar", dlg);
    const confirmar = botao("Desconectar", dlg);
    confirmar.focus();
    fireEvent.keyDown(confirmar, { key: "Tab" });
    expect(document.activeElement).toBe(cancelar);
    fireEvent.keyDown(cancelar, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmar);
    // com o foco no próprio diálogo (clique no texto), o Esc ainda fecha
    expect(dlg).toHaveAttribute("tabindex", "-1");
    dlg.focus();
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(botao("Desconectar", cartao("whats")));
    fireEvent.click(botao("Desconectar", screen.getByRole("alertdialog")));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // a ação é assíncrona (no banco, a função de servidor desconectarConexao)
    await andar(0);
    const w = cartao("whats");
    expect(within(w).getByText("Desconectado")).toBeInTheDocument();
    expect(within(w).getByRole("alert")).toHaveTextContent("Você desconectou este número pela Configuração.");
    expect(screen.getByRole("heading", { name: "A Janete parou de atender" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Janete, parada" })).toBeInTheDocument();
    // o conserto aparece no cartão e na saúde
    expect(screen.getAllByRole("button", { name: "Conectar de novo" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Testar a conexão agora" })).not.toBeInTheDocument();
  });

  it("Trocar de WhatsApp reabre a escolha do onboarding; a Meta mostra o webhook e o verify token", async () => {
    montar();
    fireEvent.click(botao("Trocar de WhatsApp", cartao("whats")));
    const f = fluxo()!;
    expect(within(f).getByRole("heading", { level: 2, name: "Trocar de WhatsApp" })).toBeInTheDocument();
    // o cartão escolhido e os de baixo saem enquanto o fluxo está aberto
    expect(cartao("whats").className).toMatch(/cfOculto/);
    expect(cartao("ritmo").className).toMatch(/cfOculto/);

    fireEvent.click(within(f).getByRole("button", { name: /^Oficial/ }));
    fireEvent.click(within(f).getByRole("button", { name: /^API oficial da Meta/ }));
    expect(within(f).getByText("Ao conectar, o (11) 90000-0000 pela Z-API é desativado. Só um WhatsApp fica ativo por vez.")).toBeInTheDocument();
    expect(within(f).getByText(/\/api\/public\/whatsapp\/meta\/\[id da nova conexão\]/)).toBeInTheDocument();
    const conectar = botao("Conectar", f);
    expect(conectar).toBeDisabled();
    fireEvent.change(within(f).getByLabelText("Phone Number ID"), { target: { value: "123" } });
    fireEvent.change(within(f).getByLabelText("ID da conta do WhatsApp Business"), { target: { value: "456" } });
    fireEvent.change(within(f).getByLabelText("Token de acesso permanente"), { target: { value: "EAAG-token" } });
    fireEvent.change(within(f).getByLabelText("App Secret"), { target: { value: "segredo-app" } });
    expect(conectar).toBeEnabled();
    fireEvent.click(conectar);
    await andar(1500);
    expect(within(f).getByRole("heading", { name: "Tudo certo, WhatsApp conectado." })).toBeInTheDocument();
    fireEvent.click(botao("Voltar para a Configuração", f));
    expect(fluxo()).toBeNull();

    const w = cartao("whats");
    expect(w.className).not.toMatch(/cfOculto/);
    expect(within(w).getByText("API oficial da Meta")).toBeInTheDocument();
    expect(within(w).getByText("Difícil")).toBeInTheDocument();
    expect(screen.getAllByText("WhatsApp trocado. A conexão anterior foi desativada.").length).toBeGreaterThan(0);
    fireEvent.click(botao("Ver o endereço do webhook", w));
    expect(within(w).getByText("Endereço do webhook")).toBeInTheDocument();
    expect(within(w).getByText("Verify token")).toBeInTheDocument();
    expect(within(w).getByText("••••••••••••••••")).toBeInTheDocument();
  });

  it("Trocar a chave: a chave recusada mostra o erro e mantém a antiga; corrigida, vale a nova", async () => {
    montar();
    fireEvent.click(botao("Trocar a chave", cartao("cerebro")));
    const f = fluxo()!;
    expect(within(f).getByRole("heading", { level: 2, name: "Trocar a chave da Anthropic" })).toBeInTheDocument();
    expect(within(f).getByText("Enquanto a chave nova não for validada, a terminada em TSTE continua valendo.")).toBeInTheDocument();
    const campo = within(f).getByLabelText("Chave da Anthropic");
    expect(campo).toHaveAttribute("type", "password");
    fireEvent.change(campo, { target: { value: "sk-ant-invalida-1" } });
    fireEvent.click(botao("Validar a chave", f));
    expect(screen.getByRole("img", { name: "Janete, conferindo" })).toBeInTheDocument();
    await andar(1500);
    const erro = within(f).getByRole("alert");
    expect(erro).toHaveTextContent("A Anthropic recusou a chave.");
    expect(erro).toHaveTextContent("A chave terminada em TSTE continua valendo.");
    // nada mudou no exemplo
    expect(cartao("cerebro").textContent).toContain("terminada em TSTE");

    fireEvent.click(botao("Corrigir a chave", f));
    await andar(300);
    const marcado = within(f).getByLabelText("Chave da Anthropic");
    expect(marcado).toHaveAttribute("aria-invalid", "true");
    expect(within(f).getByText("Chave recusada. Copie de novo, inteira, e valide.")).toBeInTheDocument();
    fireEvent.change(marcado, { target: { value: "sk-ant-nova-ABCD9" } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    expect(within(f).getByRole("heading", { name: "A Janete já usa a chave nova." })).toBeInTheDocument();
    expect(within(f).getByText("chave terminada em BCD9")).toBeInTheDocument();
    fireEvent.click(botao("Voltar para a Configuração", f));
    const c = cartao("cerebro");
    expect(c.textContent).toContain("terminada em BCD9");
    expect(within(c).getByText("agora")).toBeInTheDocument();
    expect(screen.getAllByText("Chave trocada. A antiga deixou de valer.").length).toBeGreaterThan(0);
    // a chave colada nunca aparece inteira, só o final
    expect(document.body.textContent).not.toMatch(/sk-ant-nova/);
  });

  it("depois do 'ok', fechar pelo Esc também zera a conferência anterior", async () => {
    montar();
    fireEvent.click(botao("Conferir tudo agora"));
    await andar(1000);
    expect(screen.getByRole("heading", { name: "Tudo certo nas cinco peças" })).toBeInTheDocument();
    fireEvent.click(botao("Testar a conexão agora", cartao("whats")));
    await andar(400);
    expect(within(cartao("whats")).getByText("Conectado · testado agora")).toBeInTheDocument();

    fireEvent.click(botao("Trocar de WhatsApp", cartao("whats")));
    const f = fluxo()!;
    fireEvent.click(within(f).getByRole("button", { name: /^Oficial/ }));
    fireEvent.click(within(f).getByRole("button", { name: /^API oficial da Meta/ }));
    fireEvent.change(within(f).getByLabelText("Phone Number ID"), { target: { value: "123" } });
    fireEvent.change(within(f).getByLabelText("ID da conta do WhatsApp Business"), { target: { value: "456" } });
    fireEvent.change(within(f).getByLabelText("Token de acesso permanente"), { target: { value: "EAAG-token" } });
    fireEvent.change(within(f).getByLabelText("App Secret"), { target: { value: "segredo-app" } });
    fireEvent.click(botao("Conectar", f));
    await andar(1500);
    expect(within(f).getByRole("heading", { name: "Tudo certo, WhatsApp conectado." })).toBeInTheDocument();
    fireEvent.keyDown(f, { key: "Escape" });
    expect(fluxo()).toBeNull();

    const w = cartao("whats");
    expect(within(w).getByText("API oficial da Meta")).toBeInTheDocument();
    expect(within(w).queryByText("Conectado · testado agora")).not.toBeInTheDocument();
    expect(within(w).getByText("Conectado")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tudo certo nas cinco peças" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
  });

  it("sem chave de resposta: 'Conectar uma chave' deixa escolher o provedor", () => {
    montar({ inicial: (b) => ({ ...b, chaves: b.chaves.filter((c) => c.finalidade !== "resposta") }) });
    fireEvent.click(botao("Conectar uma chave", cartao("cerebro")));
    const f = fluxo()!;
    expect(within(f).getByRole("heading", { level: 2, name: "Trocar de provedor" })).toBeInTheDocument();
    expect(within(f).getByRole("button", { name: /^Anthropic/ })).toBeInTheDocument();
  });

  it("durante o 'Conferir tudo', trocar fica desligado em todos os cartões", () => {
    montar();
    fireEvent.click(botao("Conferir tudo agora"));
    for (const [peca, nome] of [
      ["whats", "Trocar de WhatsApp"],
      ["cerebro", "Trocar o modelo"],
      ["cerebro", "Trocar a chave"],
      ["cerebro", "Trocar de provedor"],
      ["escuta", "Conectar uma chave"],
      ["voz", "Conectar a ElevenLabs"],
    ] as const) {
      expect(botao(nome, cartao(peca))).toBeDisabled();
    }
    // o bloqueio é inteiro: testar a conexão também fica desligado e o "Desconectar" sai
    expect(botao("Testar a conexão agora", cartao("whats"))).toBeDisabled();
    expect(within(cartao("whats")).queryByRole("button", { name: "Desconectar" })).not.toBeInTheDocument();
  });

  it("o diálogo e o aviso rápido vão para o <body> com a identidade (a fonte da página)", async () => {
    montar();
    fireEvent.click(botao("Desconectar", cartao("whats")));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg.closest('[data-identidade="aipro"]')).not.toBeNull();
    fireEvent.click(botao("Desconectar", dlg));
    await andar(0);
    const aviso = screen.getAllByText("WhatsApp desconectado. A Janete parou de atender.").find((el) => el.closest("[aria-hidden='true']"));
    expect(aviso).toBeDefined();
    expect(aviso!.closest('[data-identidade="aipro"]')).not.toBeNull();
  });

  it("na lista do fluxo, os selos ficam ao lado do nome, não abaixo da frase", () => {
    montar();
    fireEvent.click(botao("Trocar de WhatsApp", cartao("whats")));
    const f = fluxo()!;
    fireEvent.click(within(f).getByRole("button", { name: /^Não oficial/ }));
    const linha = document.getElementById("cfg-it-zapi")!;
    const selo = within(linha).getByText("Em uso");
    const nome = within(linha).getByText("Z-API");
    expect(selo.parentElement).toBe(nome.parentElement);
    expect(within(nome.parentElement!).getByText("Fácil")).toBeInTheDocument();
  });

  it("'Conferir tudo' para no WhatsApp quando ele está fora", async () => {
    montar({
      inicial: (b) => ({ ...b, conexao: { ...b.conexao!, status: "desconectada", ultimo_erro: "O número saiu do WhatsApp no celular." } }),
    });
    fireEvent.click(botao("Conferir tudo agora"));
    await andar(300);
    expect(screen.getByRole("heading", { name: "A conferência parou no WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText("A Z-API não confirmou o número conectado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Recebe, WhatsApp: A conferência parou aqui/ })).toBeInTheDocument();
  });

  it("'Ver como' atendente troca a tela pelo aviso, e voltar a admin não traz a conferência de antes", async () => {
    // o papel troca no meio da tela (o "Ver como" do topo saiu em 30/10; com o banco, o papel virá da conta)
    function VerComo() {
      const { setPapel } = usePapel();
      return (
        <>
          <button type="button" onClick={() => setPapel("atendente")}>
            Ver como atendente
          </button>
          <button type="button" onClick={() => setPapel("admin")}>
            Ver como admin
          </button>
        </>
      );
    }
    render(
      <ProvedorPapel inicial="admin">
        <ProvedorDados exemplo={criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => new Date(AGORA)}>
          <VerComo />
          <TelaConfiguracao />
        </ProvedorDados>
      </ProvedorPapel>,
    );
    fireEvent.click(botao("Conferir tudo agora"));
    await andar(1000);
    expect(screen.getByRole("heading", { name: "Tudo certo nas cinco peças" })).toBeInTheDocument();
    fireEvent.click(botao("Ver como atendente"));
    expect(screen.queryByRole("heading", { name: "Tudo certo nas cinco peças" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Configuração" })).toHaveAttribute("id", "area-configuracao");
    expect(screen.getByText("Só o admin vê a Configuração.")).toBeInTheDocument();
    expect(cartao("whats")).toBeNull();
    fireEvent.click(botao("Ver como admin"));
    expect(cartao("whats")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Tudo certo nas quatro peças" })).not.toBeInTheDocument();
  });

  it("Trocar o modelo usa a lista curada, sem rede", async () => {
    montar();
    fireEvent.click(botao("Trocar o modelo", cartao("cerebro")));
    const f = fluxo()!;
    expect(within(f).getByText("Buscando os modelos na Anthropic…")).toBeInTheDocument();
    await andar(300);
    const radios = within(f).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Claude Haiku 5.5"),
      expect.stringContaining("Claude Sonnet 5.5"),
      expect.stringContaining("Claude Opus 5.5"),
    ]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(botao("Salvar o modelo", f)).toBeDisabled();
    fireEvent.click(radios[1]!);
    fireEvent.click(botao("Salvar o modelo", f));
    await andar(200);
    expect(fluxo()).toBeNull();
    expect(within(cartao("cerebro")).getByRole("heading", { name: "Claude Sonnet 5.5" })).toBeInTheDocument();
    expect(screen.getAllByText("A Janete passou a responder com o Claude Sonnet 5.5.").length).toBeGreaterThan(0);
  });

  it("Escuta de áudio: conectar a Groq liga a escuta", async () => {
    montar();
    fireEvent.click(botao("Conectar uma chave", cartao("escuta")));
    const f = fluxo()!;
    expect(within(f).getByRole("heading", { level: 2, name: "Conectar a escuta de áudio" })).toBeInTheDocument();
    fireEvent.click(within(f).getByRole("button", { name: /^Groq/ }));
    fireEvent.change(within(f).getByLabelText("Chave da Groq"), { target: { value: "gsk_teste_WXYZ" } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    expect(within(f).getByRole("heading", { name: "A Janete já entende áudios." })).toBeInTheDocument();
    fireEvent.click(botao("Voltar para a Configuração", f));
    const e = cartao("escuta");
    expect(within(e).getByRole("heading", { name: "Ativa, com a Groq" })).toBeInTheDocument();
    expect(e.textContent).toContain("terminada em WXYZ");
    expect(screen.getByRole("button", { name: /^Escuta, Áudios em texto: Ativa · Groq/ })).toBeInTheDocument();
  });

  it("Voz: 'Não configurada', conectar a ElevenLabs, o ok leva à lista, salvar a voz; remover volta a 'Não configurada'", async () => {
    montar();
    const v = cartao("voz");
    // entre a escuta e o ritmo; no fio, o 5º nó ("Fala"), neutro sem chave
    expect(cartao("escuta").compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(v.compareDocumentPosition(cartao("ritmo")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole("list")).getAllByRole("button")).toHaveLength(5);
    expect(within(v).getByText("Voz da Janete")).toHaveAttribute("id", "cfg-m-voz");
    expect(within(v).getByRole("heading", { level: 2, name: "Não configurada" })).toHaveAttribute("id", "cfg-h-voz");
    expect(within(v).getByText("Sem chave")).toBeInTheDocument();
    expect(within(v).getByRole("heading", { level: 3, name: "A Janete ainda não tem voz" })).toBeInTheDocument();

    fireEvent.click(botao("Conectar a ElevenLabs", v));
    const f = fluxo()!;
    expect(f).toHaveAttribute("data-fluxo", "voz");
    expect(within(f).getByRole("heading", { level: 2, name: "Conectar a ElevenLabs" })).toBeInTheDocument();
    // um provedor só: abre direto no painel, sem lista e sem Voltar
    expect(within(f).queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();
    expect(within(f).queryByRole("heading", { level: 3, name: "Quem vai ouvir os áudios?" })).not.toBeInTheDocument();
    expect(within(f).getByText(/Developers → API Keys/)).toBeInTheDocument();
    fireEvent.change(within(f).getByLabelText("Chave da ElevenLabs"), { target: { value: "sk_teste_1234567890abcd" } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    expect(within(f).getByRole("heading", { name: "A voz da Janete está conectada." })).toBeInTheDocument();
    expect(within(f).getByText("chave terminada em ABCD")).toBeInTheDocument();
    expect(within(f).getByRole("img", { name: "ElevenLabs" })).toHaveAttribute("src", "/logos/elevenlabs-icone.svg");
    // a face é o logo da ElevenLabs, nunca o monograma "G" da Groq
    expect(f.querySelector('[class*="cfMonoLogo"]')).toBeNull();
    // sem chave de escuta, o "Chave aceita" pergunta se a chave vale também na escuta; o "Não" segue
    // para a lista de vozes (como o motor segue para os modelos)
    expect(within(f).getByText("Usar esta chave na escuta também?")).toBeInTheDocument();
    expect(
      within(f).getByText(
        "Hoje a Janete já ouve os áudios com a chave da voz, porque não há chave de escuta. No Sim, a chave fica também no cartão Escuta e continua lá se você tirar a voz.",
      ),
    ).toBeInTheDocument();
    expect(document.getElementById("val-pri")).toHaveTextContent("Sim, usar na escuta também");
    fireEvent.click(botao("Não, só na voz", f));
    await andar(900);
    expect(fluxo()).toBe(f);
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
    expect(within(f).getByText("Ouça e escolha a voz que a Janete usa nos áudios.")).toBeInTheDocument();
    const grupo = within(f).getByRole("radiogroup", { name: "Vozes da conta da ElevenLabs" });
    expect(within(grupo).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Voz de exemplo APortuguês",
      "Voz de exemplo BPortuguês",
      "Voz de exemplo CPortuguês",
    ]);
    // a demo não toca áudio inventado: nenhuma prévia
    expect(within(f).queryByRole("button", { name: /^Ouvir/ })).not.toBeInTheDocument();
    expect(botao("Salvar a voz", f)).toBeDisabled();
    fireEvent.click(within(grupo).getByRole("radio", { name: /Voz de exemplo B/ }));
    expect(within(grupo).getByRole("radio", { name: /Voz de exemplo B/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(botao("Salvar a voz", f));
    await andar(200);
    expect(fluxo()).toBeNull();
    expect(screen.getAllByText("Voz salva.").length).toBeGreaterThan(0);
    expect(within(v).getByRole("heading", { name: "Conectada, com a ElevenLabs" })).toBeInTheDocument();
    expect(within(v).getByText("Chave ativa")).toBeInTheDocument();
    expect(v.textContent).toContain("terminada em ABCD");
    expect(within(v).getByText("Voz de exemplo B")).toBeInTheDocument();
    expect(botao("Trocar a voz", v)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fala, Voz da Janete: Ativa · Voz de exemplo B. Ver os detalhes." })).toBeInTheDocument();
    // sem chave de áudio e com o cérebro da Anthropic, a chave da voz passa a transcrever
    expect(within(cartao("escuta")).getByRole("heading", { name: "Ativa, usando a chave da voz" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Escuta, Áudios em texto: Ativa · chave da voz \(ElevenLabs\)/ })).toBeInTheDocument();

    // trocar reabre o fluxo com o título da troca
    fireEvent.click(botao("Trocar a chave de voz", v));
    expect(within(fluxo()!).getByRole("heading", { level: 2, name: "Trocar a chave da ElevenLabs" })).toBeInTheDocument();
    fireEvent.click(botao("Cancelar", fluxo()!));

    // cancelar o diálogo devolve o foco ao botão; confirmar remove (e diz que a Janete passa a pedir texto)
    fireEvent.click(botao("Remover a chave de voz", v));
    let dlg = screen.getByRole("alertdialog", { name: "Remover a chave de voz?" });
    expect(dlg.textContent).toContain("os áudios dos leads deixam de virar texto: a Janete pede para o lead escrever");
    fireEvent.click(botao("Cancelar", dlg));
    await andar(100);
    expect(document.activeElement).toBe(document.getElementById("cfg-remover-voz"));
    fireEvent.click(botao("Remover a chave de voz", v));
    dlg = screen.getByRole("alertdialog", { name: "Remover a chave de voz?" });
    fireEvent.click(botao("Remover", dlg));
    await andar(50);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(v).getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
    expect(screen.getAllByText("Chave de voz removida. Sem escuta, a Janete pede para o lead escrever.").length).toBeGreaterThan(0);
    expect(within(cartao("escuta")).getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
    await andar(300);
    expect(document.activeElement).toBe(document.getElementById("cfg-h-voz"));
  });

  it("Voz: abrir o fluxo da voz esconde o próprio cartão e o ritmo, e deixa a escuta à vista", () => {
    montar();
    fireEvent.click(botao("Conectar a ElevenLabs", cartao("voz")));
    expect(cartao("voz").className).toMatch(/cfOculto/);
    expect(cartao("ritmo").className).toMatch(/cfOculto/);
    expect(cartao("escuta").className).not.toMatch(/cfOculto/);
  });

  it("Voz: com chave, o cartão mostra a voz, o modo e os botões; 'Escolher a voz' abre o fluxo 'vozes'", async () => {
    montar({ inicial: comVoz() });
    const v = cartao("voz");
    expect(within(v).getByText("Voz")).toBeInTheDocument();
    expect(within(v).getByText("Nenhuma escolhida")).toBeInTheDocument();
    expect(within(v).getByText("Sem voz escolhida").closest("p")).toHaveAttribute("data-tom", "atencao");
    const grupo = within(v).getByRole("radiogroup", { name: "Responder em áudio" });
    expect(within(grupo).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Quando o lead manda áudio", "Sempre", "Nunca"]);
    expect(within(grupo).getByRole("radio", { name: "Quando o lead manda áudio" })).toHaveAttribute("aria-checked", "true");
    for (const nome of ["Escolher a voz", "Remover a chave de voz", "Trocar a chave de voz"]) expect(botao(nome, v)).toBeEnabled();

    fireEvent.click(botao("Escolher a voz", v));
    const f = fluxo()!;
    expect(f).toHaveAttribute("data-fluxo", "vozes");
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
    expect(cartao("voz").className).toMatch(/cfOculto/);
    expect(cartao("ritmo").className).toMatch(/cfOculto/);
    await andar(50);
    fireEvent.click(within(f).getByRole("radio", { name: /Voz de exemplo C/ }));
    fireEvent.click(botao("Salvar a voz", f));
    await andar(200);
    expect(fluxo()).toBeNull();
    expect(within(v).getByText("Voz de exemplo C")).toBeInTheDocument();
    expect(within(v).getByText("Chave ativa").closest("p")).toHaveAttribute("data-tom", "ok");
    expect(within(v).queryByText(/Escolha a voz da Janete/)).not.toBeInTheDocument();
    await andar(300);
    expect(document.activeElement).toBe(document.getElementById("cfg-h-voz"));
  });

  it("Voz: trocar o modo salva ao escolher; as setas só andam com o foco", async () => {
    montar({ inicial: comVoz() });
    const v = cartao("voz");
    const quando = within(v).getByRole("radio", { name: "Quando o lead manda áudio" });
    quando.focus();
    fireEvent.keyDown(quando, { key: "ArrowRight" });
    const sempre = within(v).getByRole("radio", { name: "Sempre" });
    expect(document.activeElement).toBe(sempre);
    // a seta não grava: o marcado continua o mesmo, e nenhum aviso
    expect(quando).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("Modo salvo.")).not.toBeInTheDocument();
    fireEvent.click(sempre);
    await andar(50);
    expect(within(v).getByRole("radio", { name: "Sempre" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("Modo salvo.").length).toBeGreaterThan(0);
    // escolher o mesmo de novo não grava outra vez (nem avisa de novo)
    await andar(5000);
    expect(screen.queryByText("Modo salvo.")).not.toBeInTheDocument();
    fireEvent.click(within(v).getByRole("radio", { name: "Sempre" }));
    await andar(50);
    expect(screen.queryByText("Modo salvo.")).not.toBeInTheDocument();
    // no "Nunca", o nó da voz fica neutro
    fireEvent.click(within(v).getByRole("radio", { name: "Nunca" }));
    await andar(50);
    expect(screen.getByRole("button", { name: "Fala, Voz da Janete: Desligada · responde em texto. Ver os detalhes." })).toBeInTheDocument();
  });

  it("no StrictMode (a prévia do Descontinuado roda em desenvolvimento): o modo salva e o 'Conferir tudo' chega ao fim", async () => {
    montar({ inicial: comVoz({}, { voz_id: "exemplo-voz-a", voz_nome: "Voz de exemplo A" }), estrito: true });
    const v = cartao("voz");
    fireEvent.click(within(v).getByRole("radio", { name: "Sempre" }));
    await andar(1000);
    expect(within(v).getByRole("radio", { name: "Sempre" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("Modo salvo.").length).toBeGreaterThan(0);
    expect(within(v).queryByText(/Salvando…/)).not.toBeInTheDocument();
    await andar(5000);

    fireEvent.click(botao("Conferir tudo agora"));
    expect(screen.getByRole("heading", { name: "Conferindo as cinco peças" })).toBeInTheDocument();
    await andar(1500);
    expect(screen.getByRole("heading", { name: "Tudo certo nas cinco peças" })).toBeInTheDocument();
    const fio = within(screen.getByTestId("cfg-saude")).getByRole("list");
    expect(fio.querySelectorAll('[data-estado="carregando"]')).toHaveLength(0);
  });

  it("Voz: os 4 avisos do cartão, na prioridade", () => {
    const casos: [Parameters<typeof comVoz>, string, string][] = [
      [[{ status: "sem_credito" }, { voz_id: "exemplo-voz-a", voz_nome: "Voz de exemplo A" }], "Sem crédito na ElevenLabs. A Janete está respondendo em texto até a conta ser recarregada.", "Sem crédito"],
      [[{ status: "invalida" }, { voz_id: "exemplo-voz-a", voz_nome: "Voz de exemplo A", voz_erro: "voz_nao_encontrada" }], "Chave inválida. A Janete está respondendo em texto: troque a chave da ElevenLabs.", "Chave inválida"],
      [[{}, { voz_id: "voz-sumida", voz_nome: "Rachel", voz_erro: "voz_nao_encontrada" }], "A voz escolhida não existe mais na conta. Escolha outra; até lá, a Janete responde em texto.", "Voz não encontrada"],
      [[{}, {}], "Escolha a voz da Janete. Sem voz, ela responde em texto.", "Sem voz escolhida"],
    ];
    for (const [args, aviso, estado] of casos) {
      const r = montar({ inicial: comVoz(...args) });
      const v = cartao("voz");
      expect(within(v).getByText(aviso)).toBeInTheDocument();
      expect(within(v).getByText(estado).closest("p")).toHaveAttribute("data-tom", "atencao");
      // a falha da fala nunca para a Janete: o nó da voz fica em atenção, nunca em erro
      const no = screen.getByRole("button", { name: /^Fala, Voz da Janete:/ });
      expect(no.querySelector("[data-estado]")).toHaveAttribute("data-estado", "atencao");
      r.unmount();
    }
  });

  it("Voz: a chave sem um acesso (ultimo_erro sem_permissao) diz o caminho, e continua 'Chave inválida'", () => {
    montar({
      inicial: comVoz(
        { status: "invalida", ultimo_erro: "sem_permissao" },
        { voz_id: "exemplo-voz-a", voz_nome: "Voz de exemplo A" },
      ),
    });
    const v = cartao("voz");
    expect(
      within(v).getByText(
        "Chave inválida: falta um acesso. Na ElevenLabs, edite a chave e ligue User, Text to Speech, Speech to Text e Voices; depois, troque a chave aqui. Até lá, a Janete responde em texto.",
      ),
    ).toBeInTheDocument();
    expect(within(v).queryByText("Chave inválida. A Janete está respondendo em texto: troque a chave da ElevenLabs.")).not.toBeInTheDocument();
    expect(within(v).getByText("Chave inválida").closest("p")).toHaveAttribute("data-tom", "atencao");
    // na Saúde, o mesmo detalhe da chave inválida, em atenção (nunca erro)
    const no = screen.getByRole("button", { name: "Fala, Voz da Janete: Chave inválida · responde em texto. Ver os detalhes." });
    expect(no.querySelector("[data-estado]")).toHaveAttribute("data-estado", "atencao");
    expect(botao("Trocar a chave de voz", v)).toBeEnabled();
  });

  it("Saúde: o nó da voz nunca para a conferência, e remover a voz zera a conferência", async () => {
    montar({ inicial: comVoz({ status: "sem_credito" }, { voz_id: "exemplo-voz-a", voz_nome: "Voz de exemplo A" }) });
    fireEvent.click(botao("Conferir tudo agora"));
    // tudo desligado durante a conferência, também o cartão Voz
    const v = cartao("voz");
    for (const nome of ["Trocar a voz", "Remover a chave de voz", "Trocar a chave de voz"]) expect(botao(nome, v)).toBeDisabled();
    for (const r of within(v).getAllByRole("radio")) expect(r).toBeDisabled();
    await andar(1500);
    expect(screen.getByRole("heading", { name: "Tudo certo nas cinco peças" })).toBeInTheDocument();
    // a frase da Saúde (e o anúncio do leitor de tela, que repete título e frase)
    expect(within(screen.getByTestId("cfg-saude")).getByText(/As respostas em áudio sairiam em texto\.$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fala, Voz da Janete: Sem fala: a resposta iria em texto. Ver os detalhes." })).toBeInTheDocument();
    fireEvent.click(botao("Remover a chave de voz", v));
    fireEvent.click(botao("Remover", screen.getByRole("alertdialog")));
    await andar(50);
    expect(screen.queryByRole("heading", { name: "Tudo certo nas cinco peças" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fala, Voz da Janete: Não configurada · responde em texto. Ver os detalhes." })).toBeInTheDocument();
  });

  it("Cancelar e Esc fecham o fluxo sem mudar nada", () => {
    montar();
    fireEvent.click(botao("Trocar de provedor", cartao("cerebro")));
    expect(fluxo()).not.toBeNull();
    fireEvent.keyDown(fluxo()!, { key: "Escape" });
    expect(fluxo()).toBeNull();
    fireEvent.click(botao("Trocar de WhatsApp", cartao("whats")));
    fireEvent.click(botao("Cancelar", fluxo()!));
    expect(fluxo()).toBeNull();
    expect(within(cartao("whats")).getByText("Z-API")).toBeInTheDocument();
  });

  it("salvar o ritmo: ajusta, mostra 'não salvas', desfaz e salva", async () => {
    montar();
    const r = cartao("ritmo");
    fireEvent.click(botao("Esperar 1 segundo a mais", r));
    fireEvent.click(botao("Esperar 1 segundo a mais", r));
    fireEvent.click(botao("Aumentar o tempo máximo em 5 segundos", r));
    expect(screen.getByTestId("cfg-valor-espera").textContent).toBe("10s");
    expect(screen.getByTestId("cfg-valor-teto").textContent).toBe("65s");
    expect(within(r).getByText("Mudanças ainda não salvas")).toBeInTheDocument();
    fireEvent.click(botao("Desfazer", r));
    expect(screen.getByTestId("cfg-valor-espera").textContent).toBe("8s");
    expect(within(r).queryByText("Mudanças ainda não salvas")).not.toBeInTheDocument();

    fireEvent.click(botao("Esperar 1 segundo a mais", r));
    fireEvent.click(botao("Salvar o ritmo", r));
    await andar(200);
    expect(screen.getAllByText("Ritmo salvo. A Janete espera 9 s depois da última mensagem, até 60 s.").length).toBeGreaterThan(0);
    expect(within(r).queryByText("Mudanças ainda não salvas")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Espera, Junta as mensagens: Espera 9 s, no máximo 60 s/ })).toBeInTheDocument();
  });

  it("no limite do ritmo, o botão fica 'aria-disabled' e continua com o foco", () => {
    montar();
    const mais = botao("Esperar 1 segundo a mais", cartao("ritmo"));
    mais.focus();
    for (let i = 0; i < 40; i++) fireEvent.click(mais);
    expect(screen.getByTestId("cfg-valor-espera").textContent).toBe("30s");
    expect(mais).toHaveAttribute("aria-disabled", "true");
    expect(mais).not.toBeDisabled();
    expect(document.activeElement).toBe(mais);
  });

  it("a linha do tempo explica o ritmo com o exemplo de 3 mensagens", () => {
    montar();
    fireEvent.click(botao("Ver como funciona", cartao("ritmo")));
    expect(screen.getByText("Exemplo: o lead manda 3 mensagens em 5 s. A Janete responde 13 s depois da primeira.")).toBeInTheDocument();
  });

  it("atendente: só o aviso curto (título, frase e 'Ir para o Chat'), sem a situação das peças", () => {
    const { container } = montar({ papel: "atendente" });
    const titulo = screen.getByRole("heading", { level: 1, name: "Configuração" });
    expect(titulo).toHaveAttribute("id", "area-configuracao");
    const raiz = container.querySelector('[data-papel="atendente"]') as HTMLElement;
    expect(raiz).not.toBeNull();
    expect(within(raiz).getByText("Só o admin vê a Configuração.")).toBeInTheDocument();
    // o único botão da tela é o caminho de volta
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Ir para o Chat"]);
    // nada da tela do admin: nem cartões, nem saúde, nem chave, nem custo
    for (const peca of ["whats", "cerebro", "escuta", "ritmo"] as const) expect(cartao(peca)).toBeNull();
    expect(screen.queryByTestId("cfg-saude")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/TSTE|terminada em|US\$|Conectado|Só quem administra vê/);
    // sem roteador (a tela sozinha), o botão não quebra
    fireEvent.click(botao("Ir para o Chat"));
  });

  it("atendente com o WhatsApp caído: também só o aviso (a situação não aparece para ele)", () => {
    montar({
      papel: "atendente",
      inicial: (b) => ({ ...b, conexao: { ...b.conexao!, status: "desconectada", ultimo_erro: "O número saiu do WhatsApp no celular." } }),
    });
    expect(screen.getByText("Só o admin vê a Configuração.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A Janete parou de atender" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("chave sem crédito: o cérebro para, e testar de novo a devolve", async () => {
    montar({
      inicial: (b) => ({ ...b, chaves: b.chaves.map((c) => ({ ...c, status: "sem_credito" as const })) }),
    });
    expect(screen.getByRole("heading", { name: "A Janete parou de responder" })).toBeInTheDocument();
    const c = cartao("cerebro");
    expect(within(c).getByRole("alert")).toHaveTextContent("ficou sem crédito");
    fireEvent.click(botao("Testar a chave de novo", c));
    await andar(400);
    expect(within(c).getByText("Chave ativa")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
  });

  it("Z-API desconectada sozinha: 'Mostrar o QR code' abre o QR no cartão e, conectado, confere com os dados guardados", async () => {
    montar({
      inicial: (b) => ({ ...b, conexao: { ...b.conexao!, status: "desconectada", ultimo_erro: "O número saiu do WhatsApp no celular." } }),
    });
    const w = cartao("whats");
    expect(within(w).getByRole("alert")).toHaveTextContent("O número saiu do WhatsApp no celular.");
    // no exemplo, o celular "conecta" na hora (a demo não inventa QR)
    fireEvent.click(botao("Mostrar o QR code", w));
    await andar(400);
    expect(within(cartao("whats")).getByText("Conectado · testado agora")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
  });

  it("clicar numa peça do fio leva o foco ao título do cartão", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Espera, Junta as mensagens/ }));
    await andar(100);
    expect(document.activeElement).toBe(document.getElementById("cfg-h-ritmo"));
    expect(cartao("ritmo")).toHaveAttribute("data-realce", "flash");
  });
});

describe("leituras da Configuração", () => {
  it("conexão desativada conta como desconectada de propósito", () => {
    const base = criarEstadoInicial(AGORA);
    const l = lerWhats({ ...base.conexao!, ativa: false });
    expect(l.situacao).toBe("desconectada");
    expect(l.manual).toBe(true);
    expect(lerWhats(null).prov).toBeNull();
    // a atendente lê na terceira pessoa
    expect(lerWhats({ ...base.conexao!, ativa: false }, false).erro).toBe("Este número foi desconectado pela Configuração.");
  });

  it("conexão ativa que caiu sem motivo guardado é queda do provedor, não desligada à mão", () => {
    const base = criarEstadoInicial(AGORA);
    const l = lerWhats({ ...base.conexao!, status: "desconectada", ultimo_erro: null });
    expect(l.manual).toBe(false);
    expect(l.erro).toMatch(/Falta ler o QR code de novo/);
  });

  it("o final da chave nunca é inventado", () => {
    expect(ultimos4De("sk-ant-nova-ABCD9")).toBe("BCD9");
    expect(ultimos4De("--------")).toBe("");
    expect(chaveTemFinal("--------")).toBe(false);
    expect(chaveTemFinal("sk-a-b-c-d")).toBe(false);
    expect(chaveTemFinal("sk-ant-abcd")).toBe(true);
  });

  it("a atendente não lê as chaves: a situação do cérebro fica desconhecida, nunca 'removida'", () => {
    const l = lerCerebro({ chaves: [] }, false);
    expect(l.conhecida).toBe(false);
    expect(l.ok).toBe(false);
    expect(lerCerebro({ chaves: [] }, true).situacao).toBe("removida");
  });

  it("a última validação segue o dia de São Paulo", () => {
    expect(quandoValidada("2026-10-31T02:30:00Z", "2026-10-31T02:59:00Z")).toBe("hoje às 23h30");
    expect(quandoValidada("2026-10-31T02:30:00Z", "2026-10-31T03:10:00Z")).toBe("ontem às 23h30");
    expect(quandoValidada("2026-10-31T02:30:00Z", "2026-10-31T02:30:30Z")).toBe("agora");
  });

  it("o ritmo respeita os limites e a folga de 5 s", () => {
    expect(mudarRitmo({ espera: 30, teto: 60 }, "espera", 1).espera).toBe(30);
    expect(mudarRitmo({ espera: 2, teto: 60 }, "espera", -1).espera).toBe(2);
    expect(mudarRitmo({ espera: 18, teto: 25 }, "teto", -5).teto).toBe(23);
    expect(mudarRitmo({ espera: 8, teto: 120 }, "teto", 5).teto).toBe(120);
  });
});
