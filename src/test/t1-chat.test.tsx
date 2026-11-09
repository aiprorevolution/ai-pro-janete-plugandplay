import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaChat, proximoTique, validarBuscaChat } from "@/features/plataforma/chat/TelaChat";
import { haQuanto, quandoCurto } from "@/features/plataforma/chat/Ficha";
import { sinalDaLinha } from "@/features/plataforma/chat/LinhaChat";
import { ordemDaLista } from "@/features/plataforma/chat/Lista";
import {
  conversasPorRecencia,
  criarEstadoInicial,
  estaAguardando,
  idContato,
  idConversa,
  seloDaConversa,
  type Conversa,
  type EstadoBase,
} from "@/features/plataforma/exemplo";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C1 do Chat final e rodada 2 (agente A): a página de 3 colunas, a lista (busca e um filtro só,
// sem blocos, pela mensagem mais recente), a linha com o sinal e a ficha do lead.
// A conversa do meio é da task C2: aqui ela é trocada por um dublê com o mesmo contrato.

const cliqueBastao = vi.fn();

vi.mock("@/features/plataforma/chat/Conversa", () => ({
  Conversa: (p: { conversaId: string; fichaAberta: boolean; onAlternarFicha(): void; onVoltar?(): void }) => (
    <div data-testid="conversa" data-conversa={p.conversaId} data-ficha={p.fichaAberta ? "aberta" : "fechada"}>
      {/* o cabeçalho da conversa, com o bastão (a gaveta presa começa logo abaixo dele) */}
      <header>
        <button type="button" onClick={() => cliqueBastao()}>
          Bastão
        </button>
      </header>
      <button type="button" onClick={p.onAlternarFicha}>
        Alternar a ficha
      </button>
      {/* o enviar da caixa de escrever, que a ficha presa pode cobrir */}
      <button type="button">Enviar</button>
      {p.onVoltar ? (
        <button type="button" onClick={p.onVoltar}>
          Voltar para a lista
        </button>
      ) : null}
    </div>
  ),
}));

const navegar = vi.fn();
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navegar,
}));

// Quinta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");

/** Simula a largura da janela para as media queries (min-width e max-width). */
function largura(px: number) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches = (!min || px >= Number(min[1])) && (!max || px <= Number(max[1]));
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
}

function montar({
  papel = "admin",
  px = 1440,
  inicial,
  conversa,
}: { papel?: Papel; px?: number; inicial?: EstadoBase; conversa?: string } = {}) {
  largura(px);
  return render(
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={() => inicial ?? criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => AGORA}>
        <TelaChat conversaInicial={conversa} />
      </ProvedorDados>
    </ProvedorPapel>,
  );
}

const nomeDe = (lead: string) => criarEstadoInicial(AGORA).contatos.find((c) => c.id === idContato(lead))!.nome!;

/** A linha da lista de um lead (o botão com o nome acessível completo). */
function linha(nome: string) {
  return screen.getByRole("button", { name: new RegExp(`^${nome}[,.]`) });
}

function linhasVisiveis(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-chat-lista] button[id*='-ci-']"));
}

/** O nome que a linha mostra (o span do nome, e não um pedaço do nome acessível). */
const nomeDaLinha = (b: HTMLElement) => b.querySelector("[class*='lhNome']")!.textContent;

/** O trecho do nome do filtro que diz quantas esperam há 10 min ou mais (o ponto vermelho, em palavras). */
const atrasadasNoRotulo = (e: EstadoBase, agora: number) => {
  const n = e.conversas.filter((c) => estaAguardando(c) && agora - Date.parse(c.aguardando_humano_desde!) >= 600_000).length;
  return n ? `. ${n === 1 ? "1 espera" : `${n} esperam`} há 10 min ou mais` : "";
};

/** O sinal da linha (o número de não lidas ou o ponto), ou null. */
const sinalNaTela = (nome: string) => linha(nome).querySelector<HTMLElement>("[class*='lhSinal']");

/** O ponto de quem espera, no botão do filtro. */
const pontoDoFiltro = () => document.querySelector<HTMLElement>("[data-chat-lista] [class*='liAlerta']");

/** O estado inicial com as conversas mudadas por `f`. */
function comConversas(f: (c: Conversa) => Conversa): EstadoBase {
  const e = criarEstadoInicial(AGORA);
  return { ...e, conversas: e.conversas.map(f) };
}

const menosSegundos = (s: number) => new Date(AGORA.getTime() - s * 1000).toISOString();

/** As ações da camada de dados são assíncronas: espera a resposta delas chegar à tela. */
async function esperarAcoes() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  navegar.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a página", () => {
  it("o h1 da área é o da VistaArea (o tour foca nele); a lista não tem título visível, só o h2 'Conversas' escondido", () => {
    montar();
    expect(screen.getByRole("heading", { level: 1, name: "Chat" })).toHaveAttribute("id", "area-chat");
    expect(screen.queryByRole("heading", { level: 2, name: "Chat" })).toBeNull();
    const h2 = screen.getByRole("heading", { level: 2, name: "Conversas" });
    expect(h2.className).toMatch(/liSr/);
    expect(screen.getByRole("region", { name: "Conversas" })).toContainElement(linhasVisiveis()[0]!);
  });

  it("em 1440 px, as 3 colunas: a 1ª conversa da lista aberta e a ficha ao lado", () => {
    montar();
    const primeira = ordemDaLista(criarEstadoInicial(AGORA))[0]!;
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-conversa", primeira);
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-ficha", "aberta");
    expect(within(screen.getByRole("complementary")).getByText("Ficha do lead")).toBeInTheDocument();
  });

  it("em 1280 px, as 3 juntas também; a ficha fecha e abre pelo botão da conversa", () => {
    montar({ px: 1280 });
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Alternar a ficha" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-ficha", "fechada");
    fireEvent.click(screen.getByRole("button", { name: "Alternar a ficha" }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it.each([900, 1100, 1279])(
    "em %i px, a ficha é uma gaveta presa à torre, sem véu: abre pelo botão e fecha com Esc",
    (px) => {
      montar({ px });
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(screen.getByTestId("conversa")).toHaveAttribute("data-ficha", "fechada");
      const botao = screen.getByRole("button", { name: "Alternar a ficha" });
      botao.focus();
      fireEvent.click(botao);
      const gaveta = screen.getByRole("dialog", { name: /^Ficha de / });
      expect(within(gaveta).getByText("O que a Janete já descobriu")).toBeInTheDocument();
      // não é modal: sem aria-modal, sem véu, sem portal (fica dentro da torre) e a página não trava
      expect(gaveta).not.toHaveAttribute("aria-modal");
      expect(gaveta).toHaveAttribute("data-ancorada");
      expect(screen.queryByTestId("gaveta-veu")).toBeNull();
      expect(gaveta.closest("[data-largura='media']")).not.toBeNull();
      expect(document.body.style.overflow).not.toBe("hidden");
      // o foco entra na ficha (no X) e, com Esc, volta ao botão da ficha
      expect(within(gaveta).getByRole("button", { name: "Fechar a ficha do lead" })).toHaveFocus();
      fireEvent.keyDown(gaveta, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(botao).toHaveFocus();
    },
  );

  it("de 900 a 1279, com a ficha aberta o bastão e a conversa continuam clicáveis; o X fecha", () => {
    cliqueBastao.mockClear();
    montar({ px: 1100 });
    const botao = screen.getByRole("button", { name: "Alternar a ficha" });
    botao.focus();
    fireEvent.click(botao);
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-ficha", "aberta");
    // nada da conversa fica inerte nem escondido do leitor de tela
    expect(screen.getByTestId("conversa").closest("[inert], [aria-hidden='true']")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bastão" }));
    expect(cliqueBastao).toHaveBeenCalledTimes(1);
    // a ficha segue aberta: clicar fora não fecha (não há véu)
    const gaveta = screen.getByRole("dialog", { name: /^Ficha de / });
    // trocar de conversa com a ficha aberta: a ficha acompanha
    fireEvent.click(linha(nomeDe("ricardo")));
    expect(screen.getByRole("dialog", { name: `Ficha de ${nomeDe("ricardo")}` })).toBe(gaveta);
    // o X fecha e o foco volta ao botão da ficha
    within(gaveta).getByRole("button", { name: "Fechar a ficha do lead" }).focus();
    fireEvent.click(within(gaveta).getByRole("button", { name: "Fechar a ficha do lead" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-ficha", "fechada");
    expect(botao).toHaveFocus();
  });

  it("de 900 a 1279, o foco que seguiu para fora da ficha não é puxado de volta ao fechar", () => {
    montar({ px: 1100 });
    const botao = screen.getByRole("button", { name: "Alternar a ficha" });
    botao.focus();
    fireEvent.click(botao);
    const bastao = screen.getByRole("button", { name: "Bastão" });
    bastao.focus();
    // Esc fora da ficha é da página: não fecha
    fireEvent.keyDown(bastao, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: /^Ficha de / })).toBeInTheDocument();
    fireEvent.click(botao);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bastao).toHaveFocus();
  });

  it("de 900 a 1279, o foco que cai em algo da conversa coberto pela ficha recolhe a ficha e fica lá", () => {
    montar({ px: 1100 });
    const botao = screen.getByRole("button", { name: "Alternar a ficha" });
    botao.focus();
    fireEvent.click(botao);
    const gaveta = screen.getByRole("dialog", { name: /^Ficha de / });
    // a ficha ocupa os 340 px da direita, do fim do cabeçalho para baixo
    const caixa = (left: number, top: number, right: number, bottom: number) =>
      ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(gaveta, "getBoundingClientRect").mockReturnValue(caixa(760, 200, 1100, 800));
    const enviar = screen.getByRole("button", { name: "Enviar" });
    const bastao = screen.getByRole("button", { name: "Bastão" });
    vi.spyOn(enviar, "getBoundingClientRect").mockReturnValue(caixa(1040, 740, 1084, 784));
    vi.spyOn(bastao, "getBoundingClientRect").mockReturnValue(caixa(700, 120, 1000, 180));

    // o bastão fica acima do topo da ficha: focar nele não fecha
    act(() => bastao.focus());
    expect(screen.getByRole("dialog", { name: /^Ficha de / })).toBe(gaveta);

    // o enviar está por baixo da ficha: focar nele recolhe a ficha e o foco fica nele
    act(() => enviar.focus());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-ficha", "fechada");
    expect(enviar).toHaveFocus();
  });

  it("abaixo de 900, a lista é a 1ª tela; a conversa abre em tela cheia e volta", () => {
    montar({ px: 390 });
    expect(screen.queryByTestId("conversa")).toBeNull();
    fireEvent.click(linha(nomeDe("ricardo")));
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-conversa", idConversa("ricardo"));
    // a ficha numa folha de baixo
    fireEvent.click(screen.getByRole("button", { name: "Alternar a ficha" }));
    // no celular nada muda: a folha é modal, com véu
    expect(screen.getByRole("dialog", { name: `Ficha de ${nomeDe("ricardo")}` })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("gaveta-veu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Voltar para a lista" }));
    expect(screen.queryByTestId("conversa")).toBeNull();
  });
});

describe("abrir pelo endereço (?conversa=, o 'Abrir no Chat' dos Contatos)", () => {
  it("a busca da rota aceita só um id em texto, sem espaços nas pontas", () => {
    expect(validarBuscaChat({ conversa: "cv-juliana" })).toEqual({ conversa: "cv-juliana" });
    expect(validarBuscaChat({ conversa: " cv-juliana " })).toEqual({ conversa: "cv-juliana" });
    expect(validarBuscaChat({ conversa: "  " })).toEqual({ conversa: undefined });
    expect(validarBuscaChat({ conversa: 42 })).toEqual({ conversa: undefined });
    expect(validarBuscaChat({})).toEqual({ conversa: undefined });
  });

  it("em 1440 px, abre com a conversa pedida selecionada, e não a 1ª da lista", () => {
    const pedida = idConversa("juliana");
    expect(ordemDaLista(criarEstadoInicial(AGORA))[0]).not.toBe(pedida);
    montar({ conversa: pedida });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-conversa", pedida);
    expect(linha(nomeDe("juliana"))).toHaveAttribute("aria-current", "true");
  });

  it("um id que não existe é ignorado: abre a 1ª da lista, sem erro", () => {
    montar({ conversa: "cv-nao-existe" });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-conversa", ordemDaLista(criarEstadoInicial(AGORA))[0]!);
  });

  it("no celular, abre a conversa pedida em tela cheia, com a lista por baixo fora do Tab", () => {
    montar({ px: 390, conversa: idConversa("ricardo") });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-conversa", idConversa("ricardo"));
    expect(screen.getByRole("button", { name: "Voltar para a lista" })).toBeInTheDocument();
    expect(document.querySelector("[data-chat-lista]")).toHaveAttribute("inert");
  });
});

describe("a lista", () => {
  it("uma lista só, sem grupos, da mensagem mais recente para a mais antiga; a 1ª abre ao entrar", () => {
    montar();
    const lista = document.querySelector<HTMLElement>("[data-chat-lista]")!;
    expect(within(lista).queryAllByRole("group")).toHaveLength(0);
    expect(within(lista).queryByText("Precisam de você")).toBeNull();
    expect(within(lista).queryByText("Com a equipe")).toBeNull();

    const e = criarEstadoInicial(AGORA);
    const recentes = conversasPorRecencia(e);
    // a ordem por recência mistura quem espera com quem está com a Janete (não há mais blocos)
    expect(new Set(recentes.slice(0, 4).map((c) => estaAguardando(c))).size).toBe(2);
    expect(ordemDaLista(e)).toEqual(recentes.map((c) => c.id));
    const nomes = recentes.map((c) => e.contatos.find((x) => x.id === c.contato_id)!.nome!);
    expect(linhasVisiveis().map(nomeDaLinha)).toEqual(nomes);
    // a 1ª da lista está aberta e marcada
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-conversa", recentes[0]!.id);
    expect(linhasVisiveis()[0]).toHaveAttribute("aria-current", "true");
    expect(linhasVisiveis()[0]!.id).toMatch(new RegExp(`-ci-${recentes[0]!.id}$`));
  });

  it("a linha: foto sem o selo de quem atende, nome e hora, prévia, e nada da 3ª linha de situação", () => {
    montar();
    const e = criarEstadoInicial(AGORA);
    for (const lead of ["fernando", "ricardo", "sergio", "carlos"]) {
      const b = linha(nomeDe(lead));
      expect(within(b).queryByTestId("avatar-selo")).toBeNull();
      // a situação continua no nome acessível, mas não aparece na linha
      const visivel = b.textContent ?? "";
      expect(visivel).not.toMatch(/Janete atendendo|Com você|Aguardando alguém|A Janete pediu ajuda|Pelo celular/);
      expect(b.getAttribute("aria-label")).toMatch(/Janete atendendo|Com você|Aguardando alguém|Respondida pelo celular/);
      // nome e prévia (as 2 linhas)
      const c = e.conversas.find((x) => x.id === idConversa(lead))!;
      expect(visivel).toContain(nomeDe(lead));
      expect(c.ultima_mensagem_em).not.toBeNull();
    }
    // o nome acessível no formato de sempre: nome, empresa. situação[, há espera]. [não lidas.] Última: …
    expect(linha(nomeDe("ricardo")).getAttribute("aria-label")).toMatch(
      new RegExp(`^${nomeDe("ricardo")}, .+\\. Aguardando alguém: .+, há 13 min\\. 1 mensagem não lida\\. Última: .+`),
    );
    expect(linha(nomeDe("sergio")).getAttribute("aria-label")).toMatch(/\. Com você · .+\. Última: /);
  });

  it("a conversa aberta fica marcada (aria-current) e abrir outra troca a conversa do meio", () => {
    montar();
    const nome = nomeDe("ricardo");
    fireEvent.click(linha(nome));
    expect(screen.getByTestId("conversa")).toHaveAttribute("data-conversa", idConversa("ricardo"));
    expect(linha(nome)).toHaveAttribute("aria-current", "true");
  });

  // "Abrir uma conversa com não lidas zera o contador" é da Conversa real: está na integração, em
  // t1-chat-conversa.test.tsx (aqui a Conversa é um dublê).

  it("filtrar: 6 opções com contador; 'Precisam de você' filtra quem espera; a etiqueta abaixo da busca limpa", () => {
    montar();
    const e = criarEstadoInicial(AGORA);
    const total = e.conversas.length;
    const aguardando = e.conversas.filter((c) => estaAguardando(c)).length;
    const naoLidas = e.conversas.filter((c) => c.nao_lidas > 0).length;
    const comigo = e.conversas.filter((c) => c.modo === "humano" && c.responsavel_id === e.membros.find((m) => m.papel === "admin")!.id).length;
    const equipe = e.conversas.filter((c) => ["membro", "celular"].includes(seloDaConversa(c))).length;
    const janete = e.conversas.filter((c) => c.modo === "janete").length;

    // sem filtro, não há etiqueta
    expect(screen.queryByRole("button", { name: /Limpar o filtro/ })).toBeNull();
    const atrasadas = atrasadasNoRotulo(e, AGORA.getTime());
    expect(atrasadas).not.toBe("");
    const botao = screen.getByRole("button", { name: `Filtrar conversas. ${aguardando} conversas precisam de você${atrasadas}` });
    fireEvent.click(botao);
    const menu = screen.getByRole("menu", { name: /^Filtrar conversas/ });
    const itens = within(menu).getAllByRole("menuitemradio");
    expect(itens.map((i) => i.textContent?.replace(/\d+$/, ""))).toEqual([
      "Todas",
      "Precisam de você",
      "Não lidas",
      "Comigo",
      "Com a equipe",
      "Com a Janete",
    ]);
    expect(itens.map((i) => Number(/\d+$/.exec(i.textContent ?? "")?.[0]))).toEqual([total, aguardando, naoLidas, comigo, equipe, janete]);
    // "Precisam de você" no tom de atenção, porque passa de 0
    expect(itens[1]).toHaveAttribute("data-tom", "atencao");

    fireEvent.click(itens[1]!);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(linhasVisiveis()).toHaveLength(aguardando);
    for (const b of linhasVisiveis()) expect(b.getAttribute("aria-label")).toMatch(/Aguardando alguém/);
    expect(
      screen.getByRole("button", {
        name: `Filtrar conversas. Filtro ligado: Precisam de você. ${aguardando} conversas precisam de você${atrasadas}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(`Filtro ligado: Precisam de você. ${aguardando} conversas.`)).toBeInTheDocument();

    // a etiqueta fica numa linha logo abaixo da busca (fora dela) e limpa o filtro
    const chip = screen.getByRole("button", { name: `Precisam de você, ${aguardando} conversas. Limpar o filtro e mostrar todas` });
    const busca = screen.getByRole("textbox", { name: "Buscar por nome, empresa ou mensagem" });
    const caixaBusca = busca.parentElement!;
    expect(caixaBusca.contains(chip)).toBe(false);
    expect(caixaBusca.parentElement!.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(chip);
    expect(linhasVisiveis()).toHaveLength(total);
    expect(screen.queryByRole("button", { name: /Limpar o filtro/ })).toBeNull();
    expect(busca).toHaveFocus();
  });

  it("filtro 'Com a equipe': só quem está com uma pessoa (assumida ou pelo celular), na ordem da lista", () => {
    montar();
    const e = criarEstadoInicial(AGORA);
    const esperados = conversasPorRecencia(e)
      .filter((c) => ["membro", "celular"].includes(seloDaConversa(c)))
      .map((c) => e.contatos.find((x) => x.id === c.contato_id)!.nome!);
    expect(esperados.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Com a equipe/ }));
    expect(linhasVisiveis().map(nomeDaLinha)).toEqual(esperados);
    expect(nomeDaLinha(linhasVisiveis()[0]!)).not.toBe(nomeDe("ricardo"));
  });

  it("filtro 'Com a equipe' vazio: título e texto próprios", () => {
    const inicial = comConversas((c) =>
      ["membro", "celular"].includes(seloDaConversa(c)) ? { ...c, modo: "janete", responsavel_id: null, motivo_humano: null } : c,
    );
    montar({ inicial });
    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Com a equipe/ }));
    expect(screen.getByRole("heading", { name: "Ninguém da equipe atendendo agora" })).toBeInTheDocument();
    expect(screen.getByText("As conversas com uma pessoa da equipe aparecem aqui.")).toBeInTheDocument();
  });

  it("filtro 'Comigo' sem nenhuma conversa mostra o vazio com 'Ver todas'", () => {
    const e = criarEstadoInicial(AGORA);
    const inicial: EstadoBase = {
      ...e,
      conversas: e.conversas.map((c) => (c.responsavel_id === e.membros.find((m) => m.papel === "admin")!.id ? { ...c, responsavel_id: null } : c)),
    };
    montar({ inicial });
    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Comigo/ }));
    expect(screen.getByRole("heading", { name: "Nenhuma conversa com você" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver todas" }));
    expect(linhasVisiveis()).toHaveLength(e.conversas.length);
  });

  it("buscar por empresa, sem acento; nada encontrado oferece limpar", () => {
    montar();
    const busca = screen.getByRole("textbox", { name: "Buscar por nome, empresa ou mensagem" });
    fireEvent.change(busca, { target: { value: "mercado bom preco" } });
    expect(linhasVisiveis().map(nomeDaLinha)).toEqual([nomeDe("ricardo")]);

    fireEvent.change(busca, { target: { value: "zzzz" } });
    expect(screen.getByRole("heading", { name: "Nada encontrado para “zzzz”" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar a busca" })[0]!);
    expect((busca as HTMLInputElement).value).toBe("");
    expect(linhasVisiveis().length).toBeGreaterThan(1);
  });

  it("Esc na busca limpa; seta para baixo vai à 1ª linha e as setas andam entre as linhas", () => {
    montar();
    const busca = screen.getByRole("textbox", { name: "Buscar por nome, empresa ou mensagem" });
    fireEvent.change(busca, { target: { value: "a" } });
    fireEvent.keyDown(busca, { key: "Escape" });
    expect((busca as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(busca, { key: "ArrowDown" });
    const linhas = linhasVisiveis();
    expect(document.activeElement).toBe(linhas[0]);
    fireEvent.keyDown(linhas[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(linhas[1]);
    fireEvent.keyDown(linhas[1]!, { key: "End" });
    expect(document.activeElement).toBe(linhas[linhas.length - 1]);
    fireEvent.keyDown(linhas[linhas.length - 1]!, { key: "Home" });
    expect(document.activeElement).toBe(linhas[0]);
  });
});

describe("o sinal da linha e o ponto do filtro", () => {
  const base = {
    modo: "humano" as const,
    responsavel_id: null,
    motivo_humano: "janete_passou" as const,
    aguardando_humano_desde: "2026-10-30T17:00:00.000Z",
    nao_lidas: 0,
  };
  const desde = new Date(base.aguardando_humano_desde).getTime();

  it("sinalDaLinha: azul com não lidas; amarelo esperando; vermelho a partir de 10 min (599 s x 600 s)", () => {
    expect(sinalDaLinha({ ...base, modo: "janete", motivo_humano: null, aguardando_humano_desde: null, nao_lidas: 3 }, AGORA)).toEqual({
      cor: "azul",
      n: 3,
    });
    expect(sinalDaLinha({ ...base, modo: "janete", motivo_humano: null, aguardando_humano_desde: null }, AGORA)).toEqual({ cor: null, n: 0 });
    // assumida por alguém: não espera, então sem cor mesmo com a data antiga
    expect(sinalDaLinha({ ...base, responsavel_id: "m1" }, AGORA)).toEqual({ cor: null, n: 0 });
    expect(sinalDaLinha(base, desde + 599_000)).toEqual({ cor: "amarelo", n: 0 });
    expect(sinalDaLinha(base, desde + 600_000)).toEqual({ cor: "vermelho", n: 0 });
    // a falha da IA segue a mesma regra de cor
    expect(sinalDaLinha({ ...base, motivo_humano: "sem_credito" }, desde + 30_000).cor).toBe("amarelo");
    // com espera e não lidas juntas, o número fica na cor da espera
    expect(sinalDaLinha({ ...base, nao_lidas: 2 }, desde + 60_000)).toEqual({ cor: "amarelo", n: 2 });
    expect(sinalDaLinha({ ...base, nao_lidas: 2 }, desde + 700_000)).toEqual({ cor: "vermelho", n: 2 });
    // nunca negativo
    expect(sinalDaLinha({ ...base, modo: "janete", aguardando_humano_desde: null, nao_lidas: -4 }, AGORA)).toEqual({ cor: null, n: 0 });
  });

  it("na tela: o número na cor (azul, amarelo, vermelho), o ponto sem não lidas e nada sem sinal", () => {
    // Ricardo espera há 13 min, sem não lidas aqui: o ponto vermelho
    montar({ inicial: comConversas((c) => (c.id === idConversa("ricardo") ? { ...c, nao_lidas: 0 } : c)) });
    expect(sinalNaTela(nomeDe("aline"))).toHaveAttribute("data-cor", "azul");
    expect(sinalNaTela(nomeDe("aline"))).toHaveTextContent("3");
    expect(sinalNaTela(nomeDe("juliana"))).toHaveAttribute("data-cor", "amarelo");
    expect(sinalNaTela(nomeDe("juliana"))).toHaveTextContent("2");
    expect(sinalNaTela(nomeDe("thiago"))).toHaveAttribute("data-cor", "vermelho");
    expect(sinalNaTela(nomeDe("thiago"))).toHaveTextContent("2");
    const ponto = sinalNaTela(nomeDe("ricardo"))!;
    expect(ponto).toHaveAttribute("data-cor", "vermelho");
    expect(ponto).toHaveAttribute("data-ponto");
    expect(ponto).toHaveTextContent("");
    expect(sinalNaTela(nomeDe("fernando"))).toBeNull();
  });

  it("mais de 99 não lidas vira 99+", () => {
    montar({ inicial: comConversas((c) => (c.id === idConversa("aline") ? { ...c, nao_lidas: 120 } : c)) });
    expect(sinalNaTela(nomeDe("aline"))).toHaveTextContent("99+");
  });

  it("com o relógio andando, a linha e o ponto do filtro viram de amarelo para vermelho aos 10 min", () => {
    // todos que esperam começam a 599 s
    montar({ inicial: comConversas((c) => (estaAguardando(c) ? { ...c, aguardando_humano_desde: menosSegundos(599) } : c)) });
    expect(sinalNaTela(nomeDe("ricardo"))).toHaveAttribute("data-cor", "amarelo");
    expect(pontoDoFiltro()).toHaveAttribute("data-cor", "amarelo");
    // o relógio da tela anda na virada do minuto da espera (aqui, 1 s depois, mais a folga do tique)
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(sinalNaTela(nomeDe("ricardo"))).toHaveAttribute("data-cor", "vermelho");
    expect(pontoDoFiltro()).toHaveAttribute("data-cor", "vermelho");
  });

  it("o ponto do filtro: vermelho quando alguém espera há 10 min ou mais, e ausente quando ninguém espera", () => {
    montar();
    expect(pontoDoFiltro()).toHaveAttribute("data-cor", "vermelho");
    cleanup();

    montar({
      inicial: comConversas((c) =>
        estaAguardando(c) ? { ...c, modo: "janete", motivo_humano: null, aguardando_humano_desde: null } : c,
      ),
    });
    expect(pontoDoFiltro()).toBeNull();
    expect(screen.getByRole("button", { name: "Filtrar conversas" })).toBeInTheDocument();
  });

  it("o rótulo do filtro diz quantas precisam de você, no singular com 1", () => {
    let primeira = true;
    montar({
      inicial: comConversas((c) => {
        if (!estaAguardando(c)) return c;
        if (primeira) {
          primeira = false;
          return { ...c, aguardando_humano_desde: menosSegundos(120) };
        }
        return { ...c, modo: "janete", motivo_humano: null, aguardando_humano_desde: null };
      }),
    });
    expect(screen.getByRole("button", { name: "Filtrar conversas. 1 conversa precisa de você" })).toBeInTheDocument();
  });

  it("o nome do filtro diz quem espera há 10 min ou mais (o ponto vermelho): nada aos 599 s, o trecho aos 600 s", () => {
    let primeira = true;
    montar({
      inicial: comConversas((c) => {
        if (!estaAguardando(c)) return c;
        if (primeira) {
          primeira = false;
          return { ...c, aguardando_humano_desde: menosSegundos(599) };
        }
        return { ...c, modo: "janete", motivo_humano: null, aguardando_humano_desde: null };
      }),
    });
    expect(screen.getByRole("button", { name: "Filtrar conversas. 1 conversa precisa de você" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(
      screen.getByRole("button", { name: "Filtrar conversas. 1 conversa precisa de você. 1 espera há 10 min ou mais" }),
    ).toBeInTheDocument();
  });
});

describe("a ficha do lead", () => {
  function abrirRicardo(opcoes: Parameters<typeof montar>[0] = {}) {
    montar(opcoes);
    fireEvent.click(linha(nomeDe("ricardo")));
    return within(screen.getByRole("complementary"));
  }

  it("sem o bloco do topo (foto e nome): o cabeçalho 'Ficha do lead', o resumo da Janete e o atendimento enxuto", () => {
    const f = abrirRicardo();
    const e = criarEstadoInicial(AGORA);
    const c = e.contatos.find((x) => x.id === idContato("ricardo"))!;
    const ficha = screen.getByRole("complementary", { name: `Ficha de ${c.nome}` });
    // os títulos guiam o leitor de tela: o h2 da ficha e um h3 por parte, sem regiões aninhadas
    expect(f.getByRole("heading", { level: 2, name: "Ficha do lead" })).toBeInTheDocument();
    expect(f.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "O que a Janete já descobriu",
      "Atendimento",
      "Etapa no funil",
      "Contato",
      "Observações da equipe",
      "Histórico de etapas",
    ]);
    expect(f.queryAllByRole("region")).toHaveLength(0);
    // nada de foto nem do nome como título no topo
    expect(f.queryByRole("heading", { name: c.nome! })).toBeNull();
    expect(ficha.querySelector("[data-tamanho]")).toBeNull();
    expect(f.queryByText(/^No WhatsApp:/)).toBeNull();
    expect(f.getByText("O que a Janete já descobriu")).toBeInTheDocument();
    expect(f.getByText(c.resumo_janete!)).toBeInTheDocument();
    // "Situação do atendimento" virou "Atendimento", sem quem atende, motivo nem espera
    expect(f.queryByText("Situação do atendimento")).toBeNull();
    expect(f.getByText("Atendimento")).toBeInTheDocument();
    for (const saiu of ["Quem atende", "Situação", "Por que saiu da Janete", "Aguardando desde"]) {
      expect(f.queryByText(saiu)).toBeNull();
    }
    expect(f.getByText("Primeira mensagem")).toBeInTheDocument();
    expect(f.queryByText("Devolvida à Janete")).toBeNull();
    // a seção Contato na ordem nova
    const rotulos = Array.from(ficha.querySelectorAll<HTMLElement>("[class*='fcCampoRot']")).map((r) =>
      r.firstChild!.textContent!.trim(),
    );
    expect(rotulos).toEqual(["Nome", "Nome no WhatsApp", "Telefone", "Empresa", "E-mail"]);
  });

  it("'Nome no WhatsApp' e telefone só de leitura (o nome acessível diz que vêm do WhatsApp), sem a nota 'do WhatsApp'", () => {
    const f = abrirRicardo();
    const c = criarEstadoInicial(AGORA).contatos.find((x) => x.id === idContato("ricardo"))!;
    expect(f.getByText(c.nome_whatsapp!)).toBeInTheDocument();
    expect(f.queryByRole("button", { name: /whatsapp/i })).toBeNull();
    expect(f.queryByRole("button", { name: /telefone/i })).toBeNull();
    expect(f.queryByText("do WhatsApp")).toBeNull();
    expect(f.getByText(/^Telefone/)).toHaveTextContent("Telefone (vem do WhatsApp, só leitura)");
    expect(f.getByText(/^Nome no WhatsApp/)).toHaveTextContent("vem do WhatsApp, só leitura");
  });

  it("a etapa numa linha: o nome e '· há X', a barra e o 'Mover para…', sem 'desde' e sem os rótulos da barra", () => {
    const f = abrirRicardo();
    const c = criarEstadoInicial(AGORA).contatos.find((x) => x.id === idContato("ricardo"))!;
    const ha = haQuanto(c.etapa_desde!, AGORA);
    expect(ha).toMatch(/^há \d+ h$/);
    const linhaEtapa = f.getByText(`· ${ha}`).parentElement!;
    expect(linhaEtapa.tagName).toBe("P");
    expect(linhaEtapa.textContent).toMatch(new RegExp(`^.+· ${ha}$`));
    expect(f.queryByText(/^desde /)).toBeNull();
    expect(f.queryByText(/nesta etapa/)).toBeNull();
    expect(f.queryByText("Ganho ou Perdido")).toBeNull();
    expect(f.getByRole("button", { name: "Mover o lead para a etapa: Mover para…" })).toBeInTheDocument();
  });

  it("o atendimento some sem nenhuma linha (atendente, sem primeira mensagem e sem devolução)", () => {
    const e = criarEstadoInicial(AGORA);
    const inicial: EstadoBase = {
      ...e,
      contatos: e.contatos.map((c) => (c.id === idContato("ricardo") ? { ...c, primeira_mensagem_em: null } : c)),
    };
    const f = abrirRicardo({ papel: "atendente", inicial });
    expect(f.queryByText("Atendimento")).toBeNull();
    expect(f.getByText("Contato")).toBeInTheDocument();
  });

  it("'Devolvida à Janete' aparece só com a conversa devolvida e com a Janete", () => {
    const inicial = comConversas((c) =>
      c.id === idConversa("ricardo")
        ? { ...c, modo: "janete", motivo_humano: null, aguardando_humano_desde: null, devolvida_em: "2026-10-30T17:30:00.000Z" }
        : c,
    );
    const f = abrirRicardo({ inicial });
    expect(f.getByText("Devolvida à Janete").nextElementSibling).toHaveTextContent("hoje, 14:30");
  });

  it("editar o nome: vazio não salva; salvar troca na ficha e na lista", async () => {
    const f = abrirRicardo();
    fireEvent.click(f.getByRole("button", { name: "Editar o nome" }));
    const campo = f.getByRole("textbox", { name: "Nome" });
    fireEvent.change(campo, { target: { value: "   " } });
    fireEvent.click(f.getByRole("button", { name: "Salvar" }));
    expect(f.getByRole("alert")).toHaveTextContent("O nome não pode ficar vazio.");

    fireEvent.change(campo, { target: { value: "Ricardo M. (teste)" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await esperarAcoes();
    // o nome editado aparece na seção Contato, na lista e no nome da ficha; o foco volta ao lápis
    expect(f.getByText("Contato").parentElement).toHaveTextContent("Ricardo M. (teste)");
    expect(linha("Ricardo M\\. \\(teste\\)")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Ficha de Ricardo M. (teste)" })).toBeInTheDocument();
    expect(f.getByRole("button", { name: "Editar o nome" })).toHaveFocus();
    expect(screen.getAllByText("Dados do lead salvos.").length).toBeGreaterThan(0);

    // cancelar também devolve o foco ao lápis
    fireEvent.click(f.getByRole("button", { name: "Editar o nome" }));
    fireEvent.keyDown(f.getByRole("textbox", { name: "Nome" }), { key: "Escape" });
    expect(f.getByRole("button", { name: "Editar o nome" })).toHaveFocus();
  });

  it("editar empresa e e-mail (e-mail incompleto avisa); Esc cancela; telefone vem do WhatsApp", async () => {
    const f = abrirRicardo();
    fireEvent.click(f.getByRole("button", { name: /^(Editar|Adicionar) empresa$/ }));
    fireEvent.change(f.getByRole("textbox", { name: "Empresa" }), { target: { value: "Mercado Teste" } });
    fireEvent.click(f.getByRole("button", { name: "Salvar" }));
    await esperarAcoes();
    expect(f.getByText("Mercado Teste")).toBeInTheDocument();

    fireEvent.click(f.getByRole("button", { name: /^(Editar|Adicionar) e-mail$/ }));
    const email = f.getByRole("textbox", { name: "E-mail" });
    fireEvent.change(email, { target: { value: "ricardo@" } });
    fireEvent.click(f.getByRole("button", { name: "Salvar" }));
    expect(f.getByRole("alert")).toHaveTextContent("e-mail parece incompleto");
    fireEvent.keyDown(email, { key: "Escape" });
    expect(f.queryByRole("textbox", { name: "E-mail" })).toBeNull();
    // a ficha (coluna) continua aberta: o Esc só cancelou a edição
    expect(screen.getByRole("complementary")).toBeInTheDocument();

    expect(f.getByText(/^Telefone/)).toBeInTheDocument();
    expect(f.queryByRole("button", { name: /telefone/i })).toBeNull();
  });

  it("observações: o Salvar aparece só com alteração e grava", async () => {
    const f = abrirRicardo();
    const obs = f.getByRole("textbox", { name: "Observações da equipe" });
    expect(f.queryByRole("button", { name: "Salvar" })).toBeNull();
    fireEvent.change(obs, { target: { value: "Ligar depois das 17h (teste)" } });
    expect(f.getByText("Alteração ainda não salva")).toBeInTheDocument();
    fireEvent.click(f.getByRole("button", { name: "Salvar" }));
    await esperarAcoes();
    expect(f.queryByText("Alteração ainda não salva")).toBeNull();
    expect((obs as HTMLTextAreaElement).value).toBe("Ligar depois das 17h (teste)");
    expect(f.getByText("Visível para toda a equipe")).toBeInTheDocument();
  });

  it("mover etapa: 'Mover para…' com as 6 etapas; o histórico ganha a mudança feita por você", async () => {
    const f = abrirRicardo();
    fireEvent.click(f.getByRole("button", { name: "Mover o lead para a etapa: Mover para…" }));
    const opcoes = within(screen.getByRole("menu", { name: "Mover o lead para a etapa" })).getAllByRole("menuitemradio");
    expect(opcoes.map((o) => o.textContent)).toEqual(["Novo", "Em qualificação", "Qualificado", "Em negociação", "Ganho", "Perdido"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Ganho" }));
    await esperarAcoes();

    expect(f.getAllByText("Ganho")[0]).toBeInTheDocument();
    const hist = f.getByRole("list");
    const primeiro = within(hist).getAllByRole("listitem")[0]!;
    expect(primeiro).toHaveTextContent("Ganho");
    expect(primeiro).toHaveTextContent("por você");
    expect(f.getByText("· agora")).toBeInTheDocument();
    expect(screen.getAllByText(/Ricardo foi para Ganho\./).length).toBeGreaterThan(0);
  });

  it("Ver no Kanban navega para /app/kanban", () => {
    const f = abrirRicardo();
    fireEvent.click(f.getByRole("button", { name: "Ver no Kanban" }));
    expect(navegar).toHaveBeenCalledWith({ to: "/app/kanban" });
  });

  it("admin vê o custo de IA e apaga com confirmação (Cancelar não apaga)", async () => {
    const nome = nomeDe("ricardo");
    const f = abrirRicardo();
    expect(f.getByText("Custo de IA")).toBeInTheDocument();
    expect(f.getByText(/US\$\s?\d+,\d{2} nesta conversa|Nenhum gasto registrado/)).toBeInTheDocument();

    fireEvent.click(f.getByRole("button", { name: "Apagar contato" }));
    let dlg = screen.getByRole("alertdialog", { name: `Apagar ${nome}?` });
    expect(document.activeElement).toBe(within(dlg).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(linha(nome)).toBeInTheDocument();

    fireEvent.click(f.getByRole("button", { name: "Apagar contato" }));
    dlg = screen.getByRole("alertdialog");
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(f.getByRole("button", { name: "Apagar contato" }));
    const dialogo = screen.getByRole("alertdialog");
    // o diálogo avisa que o contato volta como lead novo se escrever de novo (decisão 12)
    expect(dialogo).toHaveTextContent("Se ele escrever de novo, volta como lead novo.");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Apagar contato" }));
    await esperarAcoes();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(`^${nome}[,.]`) })).toBeNull();
    expect(screen.getAllByText(`${nome} foi apagado, com a conversa e as mídias.`).length).toBeGreaterThan(0);
    // abriu outra conversa no lugar
    const prox = screen.getByTestId("conversa").getAttribute("data-conversa")!;
    expect(prox).not.toBe(idConversa("ricardo"));
    // o foco não cai no body: vai para a linha da conversa que abriu
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.activeElement?.id).toMatch(new RegExp(`-ci-${prox}$`));
  });

  it("atendente: sem custo de IA e sem Apagar contato, mas edita e move", () => {
    const f = abrirRicardo({ papel: "atendente" });
    expect(f.queryByText("Custo de IA")).toBeNull();
    expect(f.queryByText(/US\$/)).toBeNull();
    // o atendimento continua com o que não é custo
    expect(f.getByText("Atendimento")).toBeInTheDocument();
    expect(f.getByText("Primeira mensagem")).toBeInTheDocument();
    expect(f.queryByRole("button", { name: "Apagar contato" })).toBeNull();
    fireEvent.click(f.getByRole("button", { name: "Mover o lead para a etapa: Mover para…" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Perdido" }));
    expect(within(f.getByRole("list")).getAllByRole("listitem")[0]).toHaveTextContent("Perdido");
  });

  it("o aviso some sozinho depois de alguns segundos", async () => {
    const f = abrirRicardo();
    fireEvent.click(f.getByRole("button", { name: "Mover o lead para a etapa: Mover para…" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Perdido" }));
    await esperarAcoes();
    expect(screen.getByRole("button", { name: "Fechar o aviso" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("button", { name: "Fechar o aviso" })).toBeNull();
  });
});

describe("tempo da ficha, no fuso de São Paulo", () => {
  it("quandoCurto vira o dia pela meia-noite de São Paulo, não pela de UTC", () => {
    // 23:50 de quarta (29/10) em São Paulo = 02:50 UTC de quinta
    const antes = "2026-10-30T02:50:00.000Z";
    expect(quandoCurto(antes, "2026-10-30T03:10:00.000Z")).toBe("ontem, 23:50");
    expect(quandoCurto(antes, "2026-10-30T02:55:00.000Z")).toBe("hoje, 23:50");
    expect(quandoCurto("2026-10-26T14:20:00.000Z", AGORA)).toBe("segunda, 11:20");
    expect(quandoCurto("2026-10-20T14:20:00.000Z", AGORA)).toBe("20/10, 11:20");
  });

  it("haQuanto conta o tempo corrido", () => {
    expect(haQuanto("2026-10-30T17:44:30.000Z", AGORA)).toBe("agora");
    expect(haQuanto("2026-10-30T17:29:00.000Z", AGORA)).toBe("há 16 min");
    expect(haQuanto("2026-10-29T17:00:00.000Z", AGORA)).toBe("há 1 dia");
    expect(haQuanto("2026-10-27T17:00:00.000Z", AGORA)).toBe("há 3 dias");
  });
});

describe("classes dos CSS Modules do Chat", () => {
  const pasta = path.resolve(__dirname, "../features/plataforma/chat");
  it.each(["TelaChat", "Lista", "LinhaChat", "Ficha"])("%s: cada classe declarada existe no .module.css", (nome) => {
    const codigo = readFileSync(path.join(pasta, `${nome}.tsx`), "utf-8");
    const css = readFileSync(path.join(pasta, `${nome}.module.css`), "utf-8");
    const bloco = /estilos as Classes<([^>]+)>/.exec(codigo)![1]!;
    const classes = [...bloco.matchAll(/"([\w-]+)"/g)].map((m) => m[1]!);
    expect(classes.length).toBeGreaterThan(5);
    const faltando = classes.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(faltando).toEqual([]);
  });
});

/* =============================================================================
   Rodada 2, revisão (corretor): teclado, leitor de tela, busca, relógio e larguras
   ============================================================================= */

describe("a lista para o teclado e o leitor de tela", () => {
  it("uma parada de Tab só (a conversa aberta) e a lista se anuncia como lista, com um item por conversa", () => {
    montar();
    const lista = screen.getByRole("list", { name: "Conversas" });
    const linhas = linhasVisiveis();
    expect(within(lista).getAllByRole("listitem")).toHaveLength(linhas.length);
    const comTab = linhas.filter((b) => b.tabIndex === 0);
    expect(comTab).toHaveLength(1);
    expect(comTab[0]).toHaveAttribute("aria-current", "true");
    // as setas levam a parada de Tab junto
    act(() => linhas[0]!.focus());
    fireEvent.keyDown(linhas[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(linhas[1]);
    expect(linhasVisiveis().filter((b) => b.tabIndex === 0)).toEqual([linhas[1]]);
  });

  it("com um filtro que tira a conversa aberta, a 1ª linha à vista fica com o Tab", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Com a equipe/ }));
    const linhas = linhasVisiveis();
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.filter((b) => b.tabIndex === 0)).toEqual([linhas[0]]);
  });

  it("a busca anuncia quantas sobraram ~500 ms depois da última tecla; com filtro, cita o filtro; vazia, 'Mostrando todas'", () => {
    montar();
    const busca = screen.getByRole("textbox", { name: "Buscar por nome, empresa ou mensagem" });
    const status = () => document.querySelector<HTMLElement>("[data-chat-lista] section > [role='status']")!;
    fireEvent.change(busca, { target: { value: "merc" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.change(busca, { target: { value: "mercado bom preco" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // a 1ª tecla foi cancelada pela 2ª: nada ainda
    expect(status()).toHaveTextContent(/^$/);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(status()).toHaveTextContent("1 conversa.");
    fireEvent.change(busca, { target: { value: "zzzz" } });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(status()).toHaveTextContent("Nada encontrado.");
    fireEvent.keyDown(busca, { key: "Escape" });
    expect(status()).toHaveTextContent("Mostrando todas as conversas.");

    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Precisam de você/ }));
    fireEvent.change(busca, { target: { value: "mercado" } });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(status()).toHaveTextContent("1 conversa em Precisam de você.");
  });

  it("buscar pela empresa: a prévia mostra por que a conversa apareceu; sem busca, volta a ser a mensagem", () => {
    montar();
    const busca = screen.getByRole("textbox", { name: "Buscar por nome, empresa ou mensagem" });
    const patricia = () => linha(nomeDe("patricia"));
    const previa = () => patricia().querySelector("[class*='lhPrevTexto']")!.textContent;
    const antes = previa();
    expect(antes).not.toMatch(/^Empresa:/);
    fireEvent.change(busca, { target: { value: "pilates" } });
    expect(previa()).toBe("Empresa: Studio Pilates Equilíbrio");
    expect(patricia().getAttribute("aria-label")).toMatch(/\. Encontrada pela empresa\. /);
    // a "Última:" do nome acessível continua sendo a mensagem
    expect(patricia().getAttribute("aria-label")).not.toMatch(/Última: Empresa:/);
    fireEvent.change(busca, { target: { value: "paty" } });
    expect(previa()).toBe("No WhatsApp: Paty Nogueira");
    expect(patricia().getAttribute("aria-label")).toMatch(/Encontrada pelo nome no WhatsApp\./);
    // pelo nome, a prévia fica a mensagem
    fireEvent.change(busca, { target: { value: "patri" } });
    expect(previa()).toBe(antes);
    fireEvent.change(busca, { target: { value: "" } });
    expect(previa()).toBe(antes);
  });

  it("o nome da linha vem do span, mesmo com ponto no nome e sem empresa", () => {
    const e = criarEstadoInicial(AGORA);
    const inicial: EstadoBase = {
      ...e,
      contatos: e.contatos.map((c) => (c.id === idContato("ricardo") ? { ...c, nome: "Ricardo M. Teste", empresa: null } : c)),
    };
    montar({ inicial });
    const b = linha("Ricardo M\\. Teste");
    expect(nomeDaLinha(b)).toBe("Ricardo M. Teste");
    expect(b.getAttribute("aria-label")).toMatch(/^Ricardo M\. Teste\. /);
  });
});

describe("a ficha: valores longos", () => {
  it("empresa e e-mail quebram em até 2 linhas e todo valor tem o texto inteiro na dica", () => {
    montar();
    fireEvent.click(linha(nomeDe("ricardo")));
    const f = within(screen.getByRole("complementary"));
    const c = criarEstadoInicial(AGORA).contatos.find((x) => x.id === idContato("ricardo"))!;
    const valor = (rot: string) =>
      f.getByText(rot, { selector: "[class*='fcCampoRot']" }).parentElement!.querySelector<HTMLElement>("[class*='fcCampoValor']")!;
    expect(valor("Nome")).toHaveAttribute("title", c.nome!);
    expect(valor("Nome")).not.toHaveAttribute("data-quebra");
    expect(valor("Empresa")).toHaveAttribute("title", c.empresa!);
    expect(valor("Empresa")).toHaveAttribute("data-quebra");
    if (c.email) {
      expect(valor("E-mail")).toHaveAttribute("data-quebra");
      expect(valor("E-mail")).toHaveTextContent(c.email);
    } else {
      expect(valor("E-mail")).not.toHaveAttribute("title");
    }
    // o atendimento: o rótulo em cima e o valor embaixo (sem as 2 colunas que quebravam o valor)
    const css = readFileSync(path.resolve(__dirname, "../features/plataforma/chat/Ficha.module.css"), "utf-8");
    const sit = /\.fcSit > div \{([^}]*)\}/.exec(css)![1]!;
    expect(sit).toMatch(/flex-direction: column/);
    expect(sit).not.toMatch(/grid-template-columns/);
  });

  it("a área que rola da ficha prende os textos só para o leitor de tela (a página do Chat não rola)", () => {
    // Sem o position: relative, os .fcSr (absolutos) se posicionavam pela página: editando o nome, a
    // página ganhava 80 px de rolagem e a torre subia (medido no navegador em 30/10).
    const css = readFileSync(path.resolve(__dirname, "../features/plataforma/chat/Ficha.module.css"), "utf-8");
    const rolo = /\n\.fcRolo \{([^}]*)\}/.exec(css)![1]!;
    expect(rolo).toMatch(/position: relative/);
    expect(rolo).toMatch(/overflow-y: auto/);
  });
});

describe("o relógio da tela", () => {
  it("o próximo tique cai na virada do minuto da espera mais próxima, ou do relógio", () => {
    const agora = Date.parse("2026-10-30T17:45:20.000Z");
    // sem ninguém esperando: a próxima virada do relógio (40 s), com a folga
    expect(proximoTique(agora, [])).toBe(40_050);
    // esperando há 599 s: falta 1 s para os 10 min
    expect(proximoTique(agora, [new Date(agora - 599_000).toISOString()])).toBe(1_050);
    // a menor das esperas manda; um valor inválido é ignorado
    expect(proximoTique(agora, ["x", new Date(agora - 90_500).toISOString()])).toBe(29_550);
  });
});

describe("as larguras das colunas", () => {
  const css = readFileSync(path.resolve(__dirname, "../features/plataforma/chat/TelaChat.module.css"), "utf-8");
  it("a lista cresce até 300 px antes de 1280 e, a partir de 1360, nunca fica abaixo dos 300 px de 1280", () => {
    expect(css).toMatch(/grid-template-columns: clamp\(248px, calc\(26vw \+ 6px\), 300px\) minmax\(0, 1fr\);/);
    expect(css).not.toMatch(/clamp\(288px/);
    expect(css.match(/clamp\(300px, 20vw, 400px\)/g)).toHaveLength(2);
  });
});
