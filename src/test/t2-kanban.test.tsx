import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { nomeDoContato } from "@/features/plataforma/comum/LinhaConversa";
import { ATRASO_BUSCA_MS } from "@/features/plataforma/dados/kanban";
import { ProvedorDados, useDados } from "@/features/plataforma/dados/ProvedorDados";
import {
  IDS,
  criarEstadoInicial,
  estaAguardando,
  idContato,
  idConversa,
  useExemplo,
  type EstadoBase,
} from "@/features/plataforma/exemplo";
import { validarBuscaKanban } from "@/features/plataforma/kanban/endereco";
import { RotaKanban } from "@/features/plataforma/kanban/RotaKanban";
import { DESFAZER_JANETE_MS, TelaKanban } from "@/features/plataforma/kanban/TelaKanban";
import { ProvedorPapel } from "@/features/plataforma/papel";

/* A gaveta do lead e a etapa como chat são da task K2: aqui, só o contrato (props) importa. */
vi.mock("@/features/plataforma/kanban/GavetaLead", () => ({
  GavetaLead: ({ contatoId, aoFechar }: { contatoId: string | null; aoFechar: () => void }) =>
    contatoId ? (
      <div data-testid="gaveta" data-contato={contatoId}>
        <button type="button" onClick={aoFechar}>
          fechar gaveta
        </button>
      </div>
    ) : null,
}));

vi.mock("@/features/plataforma/kanban/EtapaChat", () => ({
  EtapaChat: ({ etapaId, aoVoltar }: { etapaId: string; aoVoltar: () => void; aoTrocarEtapa: (id: string) => void }) => (
    <div data-testid="etapa-chat" data-etapa={etapaId}>
      <button id="kb-foco-voltar" type="button" onClick={aoVoltar}>
        Voltar ao quadro
      </button>
    </div>
  ),
}));

// 14:45 em São Paulo: o "agora" dos protótipos (os dados de exemplo são relativos a ele).
const AGORA = new Date("2026-10-30T17:45:00.000Z");
/** "Desde as 08:12, quando você saiu": sem "visto" guardado, a saída dos protótipos (14:45 − 08:12). */
const SAIDA_MIN = 14 * 60 + 45 - (8 * 60 + 12);

/** O Kanban no modo exemplo da camada de dados (o mesmo contrato do banco, em memória). */
function Tela({
  inicial,
  extra,
  contato,
  aoFechar,
}: {
  inicial?: (() => EstadoBase) | undefined;
  extra?: React.ReactNode;
  contato?: string | undefined;
  aoFechar?: (() => void) | undefined;
}) {
  return (
    <ProvedorDados relogio={() => new Date(Date.now())} progredirEnvios={false} exemplo={inicial ?? (() => criarEstadoInicial(AGORA))}>
      <TelaKanban relogio={() => Date.now()} saidaSemVistoMin={SAIDA_MIN} contatoDoEndereco={contato} aoFecharContatoDoEndereco={aoFechar} />
      {extra}
    </ProvedorDados>
  );
}

function montar({ papel = "admin", extra }: { papel?: "admin" | "atendente"; extra?: React.ReactNode } = {}) {
  return render(
    <ProvedorPapel inicial={papel}>
      <Tela extra={extra} />
    </ProvedorPapel>,
  );
}

const coluna = (nome: string) => screen.getByRole("region", { name: nome });
const card = (nome: string) => screen.getByRole("article", { name: new RegExp(`^${nome}`) });
const naColuna = (etapa: string, nome: string) => within(coluna(etapa)).queryByRole("article", { name: new RegExp(`^${nome}`) });

/** Um DataTransfer mínimo (o jsdom não tem). */
function dataTransfer() {
  const dados = new Map<string, string>();
  return {
    setData: (tipo: string, valor: string) => dados.set(tipo, valor),
    getData: (tipo: string) => dados.get(tipo) ?? "",
    effectAllowed: "all",
    dropEffect: "none",
  };
}

/** Anda o atraso curto da busca (a busca é no servidor, decisão 13). */
const esperarBusca = () => act(() => vi.advanceTimersByTime(ATRASO_BUSCA_MS + 10));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Kanban 2: o quadro", () => {
  it("mostra as 4 etapas abertas em colunas e Ganho e Perdido em trilhos que abrem e recolhem", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    expect(screen.getByRole("heading", { level: 1, name: "Kanban" })).toBeInTheDocument();
    for (const nome of ["Novo", "Em qualificação", "Qualificado", "Em negociação"]) expect(coluna(nome)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ganho" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Abrir Ganho: \d+ leads?/ }));
    expect(coluna("Ganho")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recolher Ganho" }));
    expect(screen.queryByRole("region", { name: "Ganho" })).not.toBeInTheDocument();

    // o cabeçalho enxuto: o ícone discreto de "a Janete pode mover" só onde ela pode
    expect(within(coluna("Em qualificação")).getByText("A Janete pode mover leads para cá")).toBeInTheDocument();
    expect(within(coluna("Novo")).queryByText("A Janete pode mover leads para cá")).not.toBeInTheDocument();
  });

  it("o card é a conversa: nome, situação no avatar, espera em âmbar, prévia com 'digitando…' em azul", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const fernando = card("Fernando");
    expect(fernando).toHaveAttribute("data-ativo");
    expect(within(fernando).getByText("digitando…")).toBeInTheDocument();
    // quem espera a equipe: o tempo de espera no lugar da hora, e o selo âmbar no avatar
    const rafael = card("Rafael Albuquerque");
    expect(rafael).toHaveAttribute("data-espera");
    expect(within(rafael).getByTestId("avatar-selo")).toHaveAttribute("data-selo", "aguardando");
    // falha: o mesmo, em vermelho
    const thiago = card("Thiago Nunes");
    expect(within(thiago).getByTestId("avatar-selo")).toHaveAttribute("data-selo", "falha");
    // o botão de abrir leva o nome completo e a situação para o leitor de tela
    expect(screen.getByRole("button", { name: /^Abrir a conversa com Rafael Albuquerque, Oficina Albuquerque Motos\. Esperando a equipe/ })).toBeInTheDocument();
  });

  it("clicar no card abre a gaveta do lead (K2) e fechar devolve o foco ao card", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Abrir a conversa com Ana Clara Souza/ }));
    expect(screen.getByTestId("gaveta")).toHaveAttribute("data-contato", idContato("ana"));
    fireEvent.click(screen.getByRole("button", { name: "fechar gaveta" }));
    expect(screen.queryByTestId("gaveta")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Abrir a conversa com Ana Clara Souza/ }));
  });

  it("expandir a etapa abre a etapa como chat (K2) e voltar mostra o quadro", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Qualificado como chat" }));
    expect(screen.getByTestId("etapa-chat")).toHaveAttribute("data-etapa", "et-qualificado");
    expect(screen.queryByRole("region", { name: "Novo" })).not.toBeInTheDocument();
    // a barra (busca, filtro, Janete ao vivo, "Desde que você saiu") continua em cima da etapa
    expect(screen.getByRole("searchbox", { name: "Buscar conversa por nome, empresa ou mensagem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Desde que você saiu/ })).toBeInTheDocument();
    // o botão de expandir sumiu com o quadro: o foco vai para "Voltar ao quadro"
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Voltar ao quadro" }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao quadro" }));
    expect(coluna("Novo")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abrir Qualificado como chat" }));
  });

  it("parar o mouse no card abre a prévia da conversa (escondida do leitor de tela); sair fecha", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const rafael = card("Rafael Albuquerque");
    fireEvent.mouseEnter(rafael);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByTestId("kb-previa")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(400));
    const previa = screen.getByTestId("kb-previa");
    expect(previa).toHaveAttribute("aria-hidden", "true");
    expect(within(previa).getByText("Rafael Albuquerque")).toBeInTheDocument();
    // quem espera a equipe: "Assumir conversa" e "Abrir conversa", fora do Tab
    const assumir = within(previa).getByText("Assumir conversa").closest("button")!;
    expect(assumir).toHaveAttribute("tabindex", "-1");
    fireEvent.mouseLeave(rafael);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId("kb-previa")).not.toBeInTheDocument();
  });

  it("com o mouse na coluna, a ordem dela fica parada", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    /** Uma mensagem nova do lead chega por fora (o webhook, a simulação). */
    function Chega() {
      const { estado, acoes } = useExemplo();
      return (
        <button
          type="button"
          onClick={() => {
            const ultimo = within(coluna("Novo")).getAllByRole("article").at(-1)!.getAttribute("aria-label")!;
            const contato = estado.contatos.find((k) => ultimo.startsWith(nomeDoContato(k)))!;
            const conversa = estado.conversas.find((c) => c.contato_id === contato.id)!;
            acoes.simularJanete({ tipo: "lead_mensagem", conversaId: conversa.id, mensagem: { tipo: "texto", texto: "Oi, ainda está aí?" } });
          }}
        >
          chega mensagem
        </button>
      );
    }
    montar({ extra: <Chega /> });
    const ordem = () => within(coluna("Novo")).getAllByRole("article").map((a) => a.getAttribute("aria-label"));
    const lista = coluna("Novo").querySelector(":scope > div") as HTMLElement;
    const antes = ordem();
    expect(antes.length).toBeGreaterThan(1);
    fireEvent.mouseEnter(lista);
    fireEvent.click(screen.getByRole("button", { name: "chega mensagem" }));
    // o card que recebeu a mensagem não pula para cima enquanto o mouse está na coluna
    expect(ordem()).toEqual(antes);
    fireEvent.mouseLeave(lista);
    expect(ordem()).not.toEqual(antes);
  });

  it("Ganho e Perdido mostram os últimos 30 dias, com o total ao lado (decisão 13)", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    // um lead ganho há 40 dias: conta no total, mas não aparece como card
    const inicial = () => {
      const e = criarEstadoInicial(AGORA);
      const velho = new Date(AGORA.getTime() - 40 * 86_400_000).toISOString();
      return { ...e, contatos: e.contatos.map((c) => (c.id === idContato("ana") ? { ...c, etapa_id: IDS.etapa.ganho, etapa_desde: velho } : c)) };
    };
    render(
      <ProvedorPapel inicial="admin">
        <Tela inicial={inicial} />
      </ProvedorPapel>,
    );
    const ganhos = criarEstadoInicial(AGORA).contatos.filter((c) => c.etapa_id === IDS.etapa.ganho).length;
    const trilho = screen.getByRole("button", { name: /^Abrir Ganho:/ });
    expect(trilho).toHaveAccessibleName(new RegExp(`^Abrir Ganho: ${ganhos} leads? nos últimos 30 dias, ${ganhos + 1} no total`));
    fireEvent.click(trilho);
    expect(within(coluna("Ganho")).getByText(`Últimos 30 dias · ${ganhos + 1} no total`)).toBeInTheDocument();
    expect(naColuna("Ganho", "Ana Clara Souza")).toBeNull();
    expect(screen.queryByRole("article", { name: /^Ana Clara Souza/ })).not.toBeInTheDocument();
  });
});

describe("Kanban 2: os 3 estados", () => {
  it("vazio: sem nenhum lead, o quadro avisa e as colunas continuam", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const vazio = () => ({ ...criarEstadoInicial(AGORA), contatos: [], conversas: [], mensagens: [], historico: [], eventos: [], digitando: [] });
    render(
      <ProvedorPapel inicial="admin">
        <Tela inicial={vazio} />
      </ProvedorPapel>,
    );
    expect(screen.getByRole("heading", { name: "Nenhum lead no quadro ainda" })).toBeInTheDocument();
    expect(within(coluna("Novo")).getByText("Nenhum lead aqui")).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
});

describe("Kanban 2: busca e filtro", () => {
  it("o filtro é um botão só, com contador; 'Aguardando humano' deixa só quem espera a equipe", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const estado = criarEstadoInicial(AGORA);
    const esperando = estado.conversas
      .filter((c) => estaAguardando(c))
      .map((c) => nomeDoContato(estado.contatos.find((k) => k.id === c.contato_id)!));
    expect(esperando.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    const menu = screen.getByRole("menu", { name: "Filtrar conversas" });
    const nomes = within(menu)
      .getAllByRole("menuitemradio")
      .map((i) => i.textContent ?? "");
    expect(nomes.map((n) => n.replace(/\d+$/, ""))).toEqual([
      "Todas as conversas",
      "Aguardando humano",
      "Comigo",
      "A Janete ativa agora",
      "Não lidas",
      "Esfriando",
    ]);
    const item = within(menu).getByRole("menuitemradio", { name: /Aguardando humano/ });
    expect(item).toHaveTextContent(String(esperando.length));
    fireEvent.click(item);

    const visiveis = screen.getAllByRole("article").map((a) => a.getAttribute("aria-label") ?? "");
    expect(visiveis).toHaveLength(esperando.length);
    for (const nome of esperando) expect(visiveis.some((v) => v.startsWith(nome))).toBe(true);
    expect(screen.getByRole("button", { name: `Filtrar conversas: Aguardando humano · ${esperando.length}` })).toBeInTheDocument();
    // a coluna diz quantos de quantos, e o trilho fechado também
    expect(within(coluna("Novo")).getByText(/^\d+ de \d+$/)).toBeInTheDocument();
    const trilho = screen.getByRole("button", { name: /^Abrir Ganho: \d+ leads? de \d+ com o filtro/ });
    expect(trilho).toHaveTextContent(/\d+ de \d+/);
  });

  it("a busca olha nome, empresa e mensagens, com um atraso curto ao digitar; sem resultado, oferece limpar", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const busca = screen.getByRole("searchbox", { name: "Buscar conversa por nome, empresa ou mensagem" });
    const total = screen.getAllByRole("article").length;
    fireEvent.change(busca, { target: { value: "okada" } });
    // enquanto a pessoa digita, o quadro fica como estava
    expect(screen.getAllByRole("article")).toHaveLength(total);
    esperarBusca();
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Renata Okada, Okada Hortifrúti"]);
    // sem acento, como o texto_busca do banco
    fireEvent.change(busca, { target: { value: "HORTIFRUTI" } });
    esperarBusca();
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Renata Okada, Okada Hortifrúti"]);
    fireEvent.change(busca, { target: { value: "xyzzy" } });
    esperarBusca();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Nenhuma conversa com “xyzzy”" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpar busca e filtros" }));
    expect(screen.getAllByRole("article").length).toBeGreaterThan(10);
    // o botão sumiu: o foco vai para a busca
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(busca);
  });

  it("'Não lidas' deixa só as conversas com mensagem não lida", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const estado = criarEstadoInicial(AGORA);
    const comNaoLida = estado.conversas.filter((c) => c.nao_lidas > 0).length;
    expect(comNaoLida).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Filtrar conversas" })).getByRole("menuitemradio", { name: /Não lidas/ }));
    const visiveis = screen.getAllByRole("article");
    expect(visiveis).toHaveLength(comNaoLida);
    for (const a of visiveis) expect(a).toHaveAttribute("data-nova");
  });
});

describe("Kanban 2: mover", () => {
  it("'Mover para…' pelo teclado: abre o menu, foca a 1ª etapa, move e oferece desfazer", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    expect(naColuna("Novo", "Ana Clara Souza")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mover Ana Clara Souza para outra etapa" }));
    const menu = screen.getByRole("group", { name: "Mover Ana Clara Souza para" });
    // a etapa atual vem desabilitada; o foco vai para a primeira possível
    expect(within(menu).getByRole("button", { name: "Novo" })).toBeDisabled();
    expect(document.activeElement).toBe(within(menu).getByRole("button", { name: "Em qualificação" }));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(menu).getByRole("button", { name: "Qualificado" }));
    fireEvent.click(within(menu).getByRole("button", { name: "Qualificado" }));

    expect(await screen.findByText("Você moveu Ana para Qualificado.")).toBeInTheDocument();
    expect(naColuna("Novo", "Ana Clara Souza")).toBeNull();
    expect(naColuna("Qualificado", "Ana Clara Souza")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(naColuna("Novo", "Ana Clara Souza")).not.toBeNull());
  });

  it("o 'Desfazer' do aviso não volta o lead que já mudou de etapa por fora", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    /** Outra tela (a gaveta, a Janete) muda a etapa sem passar pelo aviso. */
    function PorFora() {
      const { acoes } = useExemplo();
      return (
        <button type="button" onClick={() => acoes.moverEtapa(idContato("ana"), "et-em-negociacao", "membro")}>
          mover por fora
        </button>
      );
    }
    montar({ extra: <PorFora /> });
    fireEvent.click(screen.getByRole("button", { name: "Mover Ana Clara Souza para outra etapa" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Mover Ana Clara Souza para" })).getByRole("button", { name: "Qualificado" }));
    await screen.findByText("Você moveu Ana para Qualificado.");
    fireEvent.click(screen.getByRole("button", { name: "mover por fora" }));
    expect(naColuna("Em negociação", "Ana Clara Souza")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(await screen.findByText("Não dá para desfazer: Ana já mudou de etapa.")).toBeInTheDocument();
    expect(naColuna("Em negociação", "Ana Clara Souza")).not.toBeNull();
    expect(naColuna("Novo", "Ana Clara Souza")).toBeNull();
  });

  it("o atendente também move para Ganho e Perdido", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar({ papel: "atendente" });
    fireEvent.click(screen.getByRole("button", { name: "Mover Ana Clara Souza para outra etapa" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Mover Ana Clara Souza para" })).getByRole("button", { name: "Ganho" }));
    expect(await screen.findByText("Você moveu Ana para Ganho.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Abrir Ganho/ }));
    expect(naColuna("Ganho", "Ana Clara Souza")).not.toBeNull();
  });

  it("Esc fecha o menu 'Mover para…' e devolve o foco ao botão", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const botao = screen.getByRole("button", { name: "Mover Ana Clara Souza para outra etapa" });
    fireEvent.click(botao);
    fireEvent.keyDown(screen.getByRole("group", { name: "Mover Ana Clara Souza para" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Mover Ana Clara Souza para" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(botao);
  });

  it("arrastar entre colunas (HTML5): a coluna mostra 'Solte aqui' e o card muda de etapa", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const dt = dataTransfer();
    const ana = card("Ana Clara Souza");
    expect(ana).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(ana, { dataTransfer: dt });
    // o "buraco" do card só aparece depois do dragstart (a cópia do arrasto sai com o conteúdo)
    expect(card("Ana Clara Souza")).not.toHaveAttribute("data-arrastando");
    act(() => vi.advanceTimersByTime(1));
    expect(card("Ana Clara Souza")).toHaveAttribute("data-arrastando");
    const destino = coluna("Em negociação");
    fireEvent.dragOver(destino, { dataTransfer: dt });
    expect(within(destino).getByText("Solte aqui")).toBeInTheDocument();
    fireEvent.drop(destino, { dataTransfer: dt });

    expect(await screen.findByText("Você moveu Ana para Em negociação.")).toBeInTheDocument();
    expect(naColuna("Em negociação", "Ana Clara Souza")).not.toBeNull();
    expect(naColuna("Novo", "Ana Clara Souza")).toBeNull();
    expect(card("Ana Clara Souza")).toHaveAttribute("data-pousou");
  });

  it("arrastar para um trilho fechado (Perdido) também move", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const dt = dataTransfer();
    fireEvent.dragStart(card("Ana Clara Souza"), { dataTransfer: dt });
    act(() => vi.advanceTimersByTime(1));
    const trilho = screen.getByRole("button", { name: /^Abrir Perdido/ });
    fireEvent.dragOver(trilho, { dataTransfer: dt });
    fireEvent.drop(trilho, { dataTransfer: dt });
    await screen.findByText("Você moveu Ana para Perdido.");
    fireEvent.click(screen.getByRole("button", { name: /^Abrir Perdido/ }));
    expect(naColuna("Perdido", "Ana Clara Souza")).not.toBeNull();
  });

});

describe("Kanban 2: editar etapas (só o admin)", () => {
  it("o atendente não vê 'Editar etapas'", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar({ papel: "atendente" });
    expect(screen.queryByRole("button", { name: "Editar etapas" })).not.toBeInTheDocument();
  });

  it("o admin renomeia, liga 'A Janete pode mover', não arquiva etapa com leads e fecha com Esc", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const abrir = screen.getByRole("button", { name: "Editar etapas" });
    fireEvent.click(abrir);
    const dlg = screen.getByRole("dialog", { name: "Editar etapas" });

    const nome = within(dlg).getByRole("textbox", { name: "Nome da etapa Novo" });
    fireEvent.change(nome, { target: { value: "Entrada" } });
    fireEvent.blur(nome);
    expect(await screen.findByRole("region", { name: "Entrada" })).toBeInTheDocument();

    // nome vazio é recusado e a caixa avisa
    const qual = within(dlg).getByRole("textbox", { name: "Nome da etapa Qualificado" });
    fireEvent.change(qual, { target: { value: "   " } });
    fireEvent.blur(qual);
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("O nome da etapa não pode ficar vazio.");
    expect(coluna("Qualificado")).toBeInTheDocument();

    // "A Janete pode mover para cá" em Em negociação (desligado no começo)
    const linhaNeg = dlg.querySelector('[data-etapa="et-em-negociacao"]') as HTMLElement;
    const troca = within(linhaNeg).getByRole("switch", { name: /A Janete pode mover para cá/ });
    expect(troca).toHaveAttribute("aria-checked", "false");
    fireEvent.click(troca);
    await waitFor(() => expect(troca).toHaveAttribute("aria-checked", "true"));
    expect(within(coluna("Em negociação")).getByText("A Janete pode mover leads para cá")).toBeInTheDocument();

    // arquivar só etapa vazia
    expect(within(linhaNeg).getByRole("button", { name: "Arquivar" })).toBeDisabled();

    // a ordem: descer Entrada troca com Em qualificação (um grupo só: as abertas)
    fireEvent.click(within(dlg).getByRole("button", { name: "Descer Entrada" }));
    await waitFor(() => {
      const titulos = screen
        .getAllByRole("region")
        .filter((r) => r.id.startsWith("kb-col-"))
        .map((r) => r.querySelector("h2")?.textContent);
      expect(titulos.slice(0, 2)).toEqual(["Em qualificação", "Entrada"]);
    });
    // Ganho e Perdido trocam entre si; a última aberta não desce para o grupo deles
    expect(within(dlg).getByRole("button", { name: "Descer Em negociação" })).toBeDisabled();
    expect(within(dlg).getByRole("button", { name: "Subir Ganho" })).toBeDisabled();

    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Editar etapas" })).not.toBeInTheDocument();
  });

  it("trocar para atendente com a caixa aberta fecha a caixa", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { rerender } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Editar etapas" }));
    expect(screen.getByRole("dialog", { name: "Editar etapas" })).toBeInTheDocument();
    rerender(
      <ProvedorPapel inicial="atendente" key="atendente">
        <Tela />
      </ProvedorPapel>,
    );
    expect(screen.queryByRole("dialog", { name: "Editar etapas" })).not.toBeInTheDocument();
  });
});

describe("Kanban 2: a Janete real move (decisão 5)", () => {
  /** O que a Janete real faz chega por fora (no banco, pelo tempo real; aqui, pelo exemplo). */
  function Janete() {
    const { acoes } = useExemplo();
    return (
      <>
        <button type="button" onClick={() => acoes.simularJanete({ tipo: "janete_move", contatoId: idContato("carla"), etapaId: IDS.etapa.qualificado })}>
          janete move carla
        </button>
        <button type="button" onClick={() => acoes.simularJanete({ tipo: "janete_passa", conversaId: idConversa("ana"), motivo: "janete_passou" })}>
          janete passa ana
        </button>
        <button type="button" onClick={() => acoes.simularJanete({ tipo: "janete_digitando", conversaId: idConversa("fernando"), digitando: false })}>
          fernando para
        </button>
      </>
    );
  }

  it("o movimento da Janete chega: o card pousa na etapa nova, sem o 'Manter aqui', e o 'Mover para…' oferece Desfazer por 10 s", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar({ extra: <Janete /> });
    expect(naColuna("Em qualificação", "Carla Mendes")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "janete move carla" }));
    expect(naColuna("Qualificado", "Carla Mendes")).not.toBeNull();
    // a Janete real move na hora: sem janela de veto
    expect(screen.queryByRole("button", { name: "Manter aqui" })).not.toBeInTheDocument();
    // quem moveu fica só no rótulo do card (a rodada 2 deixa o card visível em 2 linhas)
    expect(await screen.findByRole("button", { name: /^Abrir a conversa com Carla Mendes.*A Janete moveu para cá às \d{2}:\d{2}\./ })).toBeInTheDocument();
    expect(card("Carla Mendes")).toHaveAttribute("data-pousou");
    // a Janete ao vivo diz o que ela fez
    expect(screen.getByTitle(/^Janete ao vivo: Moveu Carla para Qualificado$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mover Carla Mendes para outra etapa" }));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer: voltar para Em qualificação" }));
    await waitFor(() => expect(naColuna("Em qualificação", "Carla Mendes")).not.toBeNull());
    expect(screen.getByRole("button", { name: /^Abrir a conversa com Carla Mendes.*Você desfez o movimento da Janete/ })).toBeInTheDocument();
  });

  it("depois de 10 s, o Desfazer da Janete sai do menu", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar({ extra: <Janete /> });
    fireEvent.click(screen.getByRole("button", { name: "janete move carla" }));
    act(() => vi.advanceTimersByTime(DESFAZER_JANETE_MS + 100));
    fireEvent.click(screen.getByRole("button", { name: "Mover Carla Mendes para outra etapa" }));
    expect(screen.queryByRole("button", { name: /^Desfazer: voltar para/ })).not.toBeInTheDocument();
  });

  it("a faixa Janete ao vivo mostra o que a Janete real faz: escrevendo, chamando a equipe, ou acompanhando", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar({ extra: <Janete /> });
    // no exemplo, a Janete está escrevendo para o Fernando (no banco: a rodada rodando)
    expect(screen.getByTitle(/^Janete ao vivo: Escrevendo para Fernando Castro$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "fernando para" }));
    expect(screen.getByTitle(/^Janete ao vivo: Acompanhando \d+ conversas?$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "janete passa ana" }));
    expect(screen.getByTitle(/^Janete ao vivo: Chamou a equipe para Ana Clara Souza$/)).toBeInTheDocument();
    // a frase do que ela acabou de fazer sai sozinha depois de uns segundos
    act(() => vi.advanceTimersByTime(21_000));
    expect(screen.getByTitle(/^Janete ao vivo: Acompanhando/)).toBeInTheDocument();
  });

  it("abrir o Kanban grava o 'visto' da pessoa: na próxima vez, 'Desde que você saiu' conta dali (decisão 13)", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    function Visto() {
      const eu = useDados().useEu();
      return <p data-testid="visto">{eu.membro.vistos.kanban ?? "nunca"}</p>;
    }
    function Alterna() {
      const [aberto, setAberto] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setAberto((a) => !a)}>
            alternar kanban
          </button>
          {aberto ? <TelaKanban relogio={() => Date.now()} saidaSemVistoMin={SAIDA_MIN} /> : null}
          <Visto />
        </>
      );
    }
    render(
      <ProvedorPapel inicial="admin">
        <ProvedorDados relogio={() => new Date(Date.now())} progredirEnvios={false} exemplo={() => criarEstadoInicial(AGORA)}>
          <Alterna />
        </ProvedorDados>
      </ProvedorPapel>,
    );
    // a 1ª vez: as novidades desde a saída dos protótipos
    expect(screen.getByRole("button", { name: /^Desde que você saiu: \d+ novidades?$/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("visto")).not.toHaveTextContent("nunca"));
    fireEvent.click(screen.getByRole("button", { name: "alternar kanban" }));
    fireEvent.click(screen.getByRole("button", { name: "alternar kanban" }));
    // a 2ª vez: conta da última abertura, e nada aconteceu desde então
    expect(screen.getByRole("button", { name: "Desde que você saiu" })).toBeInTheDocument();
  });

  it("'Marcar como visto' zera as novidades e grava o visto", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Desde que você saiu: \d+ novidades?$/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "O que a Janete fez por você" })).getByRole("button", { name: "Marcar como visto" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Desde que você saiu" })).toBeInTheDocument());
  });

  it("Esc sai do 'Rever no quadro'", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Desde que você saiu/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "O que a Janete fez por você" })).getByRole("button", { name: "Rever no quadro" }));
    const regua = screen.getByRole("region", { name: "Linha do tempo desde que você saiu" });
    // o foco vai para o tocar e pausar (e não para a faixa inteira)
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(within(regua).getByRole("button", { name: /Pausar|Reproduzir/ }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Linha do tempo desde que você saiu" })).not.toBeInTheDocument();
  });

  it("'Desde que você saiu' conta o que a Janete fez e o 'Rever no quadro' volta o quadro no tempo", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    montar();
    const botao = screen.getByRole("button", { name: /^Desde que você saiu: \d+ novidades?$/ });
    fireEvent.click(botao);
    const caixa = screen.getByRole("dialog", { name: "O que a Janete fez por você" });
    expect(within(caixa).getByText("Desde as 08:12, quando você saiu")).toBeInTheDocument();
    expect(within(caixa).getByText(/Passou Rafael Albuquerque para a equipe/)).toBeInTheDocument();
    // ao abrir, o foco vai para "Rever no quadro" (como no protótipo)
    expect(document.activeElement).toBe(within(caixa).getByRole("button", { name: "Rever no quadro" }));
    fireEvent.click(within(caixa).getByRole("button", { name: "Rever no quadro" }));

    // às 08:12, a Carla ainda não tinha chegado
    expect(screen.getByRole("region", { name: "Linha do tempo desde que você saiu" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /^Carla Mendes/ })).not.toBeInTheDocument();
    // revendo, não dá para mover
    expect(card("Paulo Henrique Viana")).toHaveAttribute("draggable", "false");
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao vivo" }));
    expect(card("Carla Mendes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desde que você saiu" })).toBeInTheDocument();
  });
});

describe("Kanban 2: o endereço ?contato= (o 'Ver no Kanban' dos Contatos)", () => {
  /** O Kanban com o lead do endereço; `aoFechar` é quem tira o ?contato do endereço (a rota). */
  function comEndereco(contato: string | undefined, aoFechar = vi.fn()) {
    const tela = (c: string | undefined) => (
      <ProvedorPapel inicial="admin">
        <Tela contato={c} aoFechar={aoFechar} />
      </ProvedorPapel>
    );
    const r = render(tela(contato));
    return { aoFechar, trocar: (c: string | undefined) => r.rerender(tela(c)) };
  }

  it("a rota só aceita um texto não vazio em ?contato (o resto vira 'sem contato')", () => {
    expect(validarBuscaKanban({ contato: "ct-juliana" })).toStrictEqual({ contato: "ct-juliana" });
    expect(validarBuscaKanban({ contato: "  ct-juliana " })).toStrictEqual({ contato: "ct-juliana" });
    // o `contato: undefined` explícito importa: o roteador junta a busca validada com a crua (o
    // toStrictEqual separa a chave com undefined da chave ausente)
    expect(validarBuscaKanban({})).toStrictEqual({ contato: undefined });
    expect(validarBuscaKanban({ contato: "" })).toStrictEqual({ contato: undefined });
    expect(validarBuscaKanban({ contato: 42 })).toStrictEqual({ contato: undefined });
    expect(validarBuscaKanban({ contato: ["ct-a", "ct-b"] })).toStrictEqual({ contato: undefined });
  });

  it("na rota: fechar a gaveta tira só o ?contato do endereço, sem criar passo no 'voltar'", async () => {
    const raiz = createRootRoute({
      component: () => (
        <ProvedorPapel inicial="admin">
          <ProvedorDados relogio={() => new Date(Date.now())} progredirEnvios={false} exemplo={() => criarEstadoInicial(AGORA)}>
            <Outlet />
          </ProvedorDados>
        </ProvedorPapel>
      ),
    });
    const kanban = createRoute({
      getParentRoute: () => raiz,
      path: "/app/kanban",
      validateSearch: validarBuscaKanban,
      component: function Pagina() {
        const { contato } = kanban.useSearch();
        return <RotaKanban contato={contato} />;
      },
    });
    const router = createRouter({
      routeTree: raiz.addChildren([kanban]),
      history: createMemoryHistory({ initialEntries: ["/app/kanban?contato=ct-ana&x=1"] }),
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId("gaveta")).toHaveAttribute("data-contato", idContato("ana"));
    const passos = router.history.length;

    fireEvent.click(screen.getByRole("button", { name: "fechar gaveta" }));
    await waitFor(() => expect(router.state.location.searchStr).toBe("?x=1"));
    expect(router.history.length).toBe(passos);
    expect(screen.queryByTestId("gaveta")).not.toBeInTheDocument();
  });

  it("no StrictMode (os efeitos rodam em dobro no desenvolvimento), o id que não existe pede a limpeza uma vez só", () => {
    const aoFechar = vi.fn();
    render(
      <StrictMode>
        <ProvedorPapel inicial="admin">
          <Tela contato="ct-nao-existe" aoFechar={aoFechar} />
        </ProvedorPapel>
      </StrictMode>,
    );
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("sem ?contato no endereço, fechar a gaveta aberta pelo clique não mexe no endereço", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { aoFechar } = comEndereco(undefined);
    fireEvent.click(screen.getByRole("button", { name: /^Abrir a conversa com Ana Clara Souza/ }));
    fireEvent.click(screen.getByRole("button", { name: "fechar gaveta" }));
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it("fechada a gaveta de um lead fora do filtro, o foco vai para a busca (o card não está à vista)", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { trocar } = comEndereco(undefined);
    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    fireEvent.click(within(screen.getByRole("menu", { name: "Filtrar conversas" })).getByRole("menuitemradio", { name: /Aguardando humano/ }));
    expect(screen.queryByRole("article", { name: /^Ana Clara Souza/ })).not.toBeInTheDocument();
    // a Ana está com a Janete: pelo endereço, a gaveta abre mesmo fora do filtro
    trocar(idContato("ana"));
    expect(screen.getByTestId("gaveta")).toHaveAttribute("data-contato", idContato("ana"));
    fireEvent.click(screen.getByRole("button", { name: "fechar gaveta" }));
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("abre a gaveta do lead ao chegar, como o clique no card; fechar avisa a rota e devolve o foco ao card", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { aoFechar } = comEndereco(idContato("ana"));
    expect(screen.getByTestId("gaveta")).toHaveAttribute("data-contato", idContato("ana"));
    expect(aoFechar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "fechar gaveta" }));
    expect(screen.queryByTestId("gaveta")).not.toBeInTheDocument();
    expect(aoFechar).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(100));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Abrir a conversa com Ana Clara Souza/ }));
  });

  it("fechada a gaveta, não reabre enquanto o endereço ainda tem o mesmo ?contato (a rota limpa depois)", async () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { trocar } = comEndereco(idContato("ana"));
    fireEvent.click(screen.getByRole("button", { name: "fechar gaveta" }));
    // o estado do exemplo muda (alguém move outro lead) com o mesmo endereço
    fireEvent.click(screen.getByRole("button", { name: "Mover Carla Mendes para outra etapa" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Mover Carla Mendes para" })).getByRole("button", { name: "Novo" }));
    await waitFor(() => expect(naColuna("Novo", "Carla Mendes")).toBeInTheDocument());
    trocar(idContato("ana"));
    expect(screen.queryByTestId("gaveta")).not.toBeInTheDocument();
  });

  it("trocar o ?contato com o Kanban aberto abre o novo lead; voltar ao mesmo depois de limpar abre de novo", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { trocar } = comEndereco(idContato("ana"));
    trocar(idContato("carla"));
    expect(screen.getByTestId("gaveta")).toHaveAttribute("data-contato", idContato("carla"));
    fireEvent.click(screen.getByRole("button", { name: "fechar gaveta" }));
    trocar(undefined);
    trocar(idContato("carla"));
    expect(screen.getByTestId("gaveta")).toHaveAttribute("data-contato", idContato("carla"));
  });

  it("id que não existe: o quadro abre normal, sem gaveta e sem erro, e a rota limpa o endereço", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    const { aoFechar } = comEndereco("ct-apagado-faz-tempo");
    expect(screen.queryByTestId("gaveta")).not.toBeInTheDocument();
    expect(coluna("Novo")).toBeInTheDocument();
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("lead em Ganho: o trilho abre e, ao fechar, o card rola inteiro para a vista e recebe o foco", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
    // o jsdom não rola: um espião no lugar do scrollIntoView diz quem pediu para aparecer
    const rolar = vi.fn();
    const proto = HTMLElement.prototype as { scrollIntoView?: unknown };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = rolar;
    try {
      comEndereco(idContato("beatriz"));
      expect(screen.getByTestId("gaveta")).toHaveAttribute("data-contato", idContato("beatriz"));
      const cardBeatriz = within(coluna("Ganho")).getByRole("article", { name: /^Beatriz Santana/ });
      rolar.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "fechar gaveta" }));
      act(() => vi.advanceTimersByTime(100));
      expect(rolar.mock.contexts).toContain(cardBeatriz);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Abrir a conversa com Beatriz Santana/ }));
    } finally {
      if (original === undefined) delete proto.scrollIntoView;
      else proto.scrollIntoView = original;
    }
  });

  it("no celular, a aba vai para a etapa do lead e o carrossel rola até a coluna dela", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
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
    // o jsdom não rola: um espião no lugar do scrollIntoView diz quem pediu para aparecer
    const rolar = vi.fn();
    const proto = HTMLElement.prototype as { scrollIntoView?: unknown };
    const rolarOriginal = proto.scrollIntoView;
    proto.scrollIntoView = rolar;
    try {
      comEndereco(idContato("lucas"));
      expect(screen.getByTestId("gaveta")).toHaveAttribute("data-contato", idContato("lucas"));
      const abas = screen.getByRole("group", { name: "Etapas" });
      expect(within(abas).getByRole("button", { name: /^Qualificado/ })).toHaveAttribute("aria-pressed", "true");
      expect(within(abas).getByRole("button", { name: /^Novo/ })).toHaveAttribute("aria-pressed", "false");
      expect(rolar.mock.contexts).toContain(coluna("Qualificado"));
    } finally {
      window.matchMedia = original;
      if (rolarOriginal === undefined) delete proto.scrollIntoView;
      else proto.scrollIntoView = rolarOriginal;
    }
  });
});

describe("Kanban 2: celular", () => {
  it("o carrossel de etapas, com abas que levam até cada uma", () => {
    vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
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
    try {
      montar();
      const abas = screen.getByRole("group", { name: "Etapas" });
      expect(within(abas).getAllByRole("button")).toHaveLength(6);
      // todas as etapas lado a lado (o deslizar troca de uma para a outra), Ganho e Perdido como colunas
      for (const nome of ["Novo", "Em qualificação", "Qualificado", "Em negociação", "Ganho", "Perdido"]) {
        expect(coluna(nome)).toBeInTheDocument();
      }
      expect(within(abas).getByRole("button", { name: /^Novo/ })).toHaveAttribute("aria-pressed", "true");
      // tocar na aba marca a etapa (e rola até ela; o jsdom não rola)
      fireEvent.click(within(abas).getByRole("button", { name: /^Qualificado/ }));
      expect(within(abas).getByRole("button", { name: /^Qualificado/ })).toHaveAttribute("aria-pressed", "true");
      expect(within(abas).getByRole("button", { name: /^Novo/ })).toHaveAttribute("aria-pressed", "false");
      // a busca do celular tem o texto curto, que cabe
      expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Buscar");
      // no celular, mover é pelo "Mover para…" (o card não arrasta)
      expect(screen.getAllByRole("article")[0]).toHaveAttribute("draggable", "false");
    } finally {
      window.matchMedia = original;
    }
  });
});
