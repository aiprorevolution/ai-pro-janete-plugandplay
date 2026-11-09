import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbaConversa } from "@/features/plataforma/contatos/AbaConversa";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import {
  criarEstadoInicial,
  idContato,
  idConversa,
  useExemplo,
  type EstadoBase,
} from "@/features/plataforma/exemplo";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C5 da spec de Contatos (docs/spec-contatos.md): a aba Conversa do perfil. Ela segue as regras
// do Chat: as 4 origens nos balões, assumir e devolver sem aviso flutuante (a linha de passagem
// diz), a caixa bloqueada sem conexão, marcar como lida ao abrir, o "Ver na conversa" (mensagemAlvo)
// e o "Responder" (focarCaixa).

// O "Reconectar" do admin usa o roteador; o teste não monta um.
const navegar = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navegar,
}));

// Sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");

/** Mostra as não lidas da conversa, para conferir o "abrir marca como lida". */
function NaoLidas({ conversaId }: { conversaId: string }) {
  const { estado } = useExemplo();
  return <output data-testid="nao-lidas">{estado.conversas.find((c) => c.id === conversaId)?.nao_lidas}</output>;
}

/** Mostra quem está com a conversa: "janete", ou "humano:<id do responsável>". */
function Modo({ conversaId }: { conversaId: string }) {
  const { estado } = useExemplo();
  const c = estado.conversas.find((x) => x.id === conversaId);
  return <output data-testid="modo">{c ? `${c.modo}${c.modo === "humano" ? `:${c.responsavel_id ?? ""}` : ""}` : ""}</output>;
}

function montar(
  lead: string,
  opcoes: {
    papel?: Papel;
    ajustar?: (e: EstadoBase) => EstadoBase;
    mensagemAlvo?: string | null;
    focarCaixa?: boolean;
  } = {},
) {
  const contatoId = idContato(lead);
  const conversaId = idConversa(lead);
  const props = {
    contatoId,
    agora: AGORA.getTime(),
    irParaAba: vi.fn(),
    verNaConversa: vi.fn(),
    avisar: vi.fn(),
  };
  const inicial = () => {
    const e = criarEstadoInicial(AGORA);
    return opcoes.ajustar ? opcoes.ajustar(e) : e;
  };
  const r = render(
    <ProvedorPapel inicial={opcoes.papel ?? "admin"}>
      <ProvedorDados relogio={() => new Date(Date.now())} progredirEnvios={false} exemplo={inicial}>
        <AbaConversa {...props} mensagemAlvo={opcoes.mensagemAlvo ?? null} focarCaixa={opcoes.focarCaixa ?? false} />
        <NaoLidas conversaId={conversaId} />
        <Modo conversaId={conversaId} />
      </ProvedorDados>
    </ProvedorPapel>,
  );
  return { ...r, props, contatoId, conversaId };
}

const log = () => screen.getByRole("log");
const campo = () => screen.getByRole("textbox", { name: /^Mensagem/ });
/** As linhas de passagem (role="note" com o nome acessível que começa pelo texto). */
const passagens = (inicio: string) =>
  within(log())
    .queryAllByRole("note")
    .filter((n) => (n.getAttribute("aria-label") ?? "").startsWith(inicio));
const origens = () =>
  new Set(Array.from(log().querySelectorAll("article[data-origem]")).map((a) => a.getAttribute("data-origem")));

function escrever(texto: string) {
  fireEvent.change(campo(), { target: { value: texto } });
  fireEvent.keyDown(campo(), { key: "Enter" });
}

/** O id do membro "eu" do exemplo (o admin). */
const euId = () => {
  const e = criarEstadoInicial(AGORA);
  return e.membros.find((m) => m.papel === "admin")!.id;
};

beforeEach(() => {
  vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
  navegar.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Contatos, aba Conversa: as mensagens", () => {
  it("mostra as 4 origens: lead, Janete, celular da empresa e equipe pela tela", () => {
    // Carlos tem lead, Janete e celular; ao responder pela tela, entra a 4ª origem.
    montar("carlos");
    expect(origens()).toEqual(new Set(["lead", "janete", "humano_celular"]));
    escrever("Mando o contrato agora.");
    expect(origens()).toEqual(new Set(["lead", "janete", "humano_celular", "humano_tela"]));
  });

  it("tem o separador de dia e a passagem do celular, como no Chat", () => {
    montar("carlos");
    expect(within(log()).getAllByRole("separator").length).toBeGreaterThan(0);
    expect(passagens("A conversa foi respondida pelo celular da empresa")).toHaveLength(1);
  });

  it("abrir a aba marca a conversa como lida (o não lido zera)", () => {
    const e = criarEstadoInicial(AGORA);
    expect(e.conversas.find((c) => c.id === idConversa("juliana"))!.nao_lidas).toBeGreaterThan(0);
    montar("juliana");
    expect(screen.getByTestId("nao-lidas")).toHaveTextContent("0");
  });
});

describe("Contatos, aba Conversa: quem atende e a ação", () => {
  it("com a Janete: 'Quem atende' diz a Janete e a ação é Assumir", () => {
    montar("fernando");
    expect(screen.getByText("Quem atende").parentElement).toHaveTextContent(/A Janete/);
    expect(screen.getByRole("button", { name: "Assumir" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Devolver para a Janete" })).not.toBeInTheDocument();
  });

  it("enviar com a Janete atendendo assume e mostra 'Você assumiu a conversa', sem aviso flutuante", () => {
    const { props } = montar("fernando");
    expect(passagens("Você assumiu a conversa")).toHaveLength(0);
    // Sem faixa: o aviso é o texto da caixa vazia.
    expect(document.querySelector("[data-com-faixa]")).toBeNull();
    expect(campo()).toHaveAttribute("placeholder", expect.stringMatching(/você assume ao enviar/));

    escrever("Oi, aqui é da equipe.");

    expect(screen.getByTestId("modo")).toHaveTextContent(`humano:${euId()}`);
    const linhas = passagens("Você assumiu a conversa");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toHaveTextContent(/Você assumiu a conversa/);
    expect(linhas[0]!.getAttribute("aria-label")).toMatch(/Ao enviar uma mensagem/);
    // Nada de aviso flutuante: o avisar do perfil não é chamado e não há alert na tela.
    expect(props.avisar).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // A ação vira "Devolver para a Janete".
    expect(screen.getByRole("button", { name: "Devolver para a Janete" })).toBeInTheDocument();
  });

  it("com a Marina: 'Assumir de Marina', a faixa avisa e assumir põe a passagem 'de quem veio'", async () => {
    const { props } = montar("patricia");
    expect(screen.getByText("Quem atende").parentElement).toHaveTextContent(/Marina/);
    expect(document.querySelector("[data-com-faixa]")).not.toBeNull();
    // A ação da camada de dados é assíncrona: espera ela voltar.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Assumir de Marina" }));
    });
    expect(screen.getByTestId("modo")).toHaveTextContent(`humano:${euId()}`);
    const linhas = passagens("Você assumiu a conversa");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.getAttribute("aria-label")).toMatch(/estava com Marina/);
    expect(props.avisar).not.toHaveBeenCalled();
    // O leitor de tela ouve a troca (o role=status da aba).
    expect(screen.getAllByRole("status").some((el) => /Você assumiu a conversa/.test(el.textContent ?? ""))).toBe(true);
  });

  it("com você: 'Devolver para a Janete' devolve e mostra 'Você devolveu para a Janete'", async () => {
    const { props } = montar("sergio");
    expect(screen.getByText("Quem atende").parentElement).toHaveTextContent(/Você/);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Devolver para a Janete" }));
    });
    expect(screen.getByTestId("modo")).toHaveTextContent("janete");
    expect(passagens("Você devolveu para a Janete")).toHaveLength(1);
    expect(props.avisar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Assumir" })).toBeInTheDocument();
  });

  it("esperando por falha: a ação é Assumir e a faixa diz que a Janete parou", () => {
    montar("juliana");
    expect(screen.getByRole("button", { name: "Assumir" })).toBeInTheDocument();
    expect(screen.getByText(/^A Janete parou:/)).toBeInTheDocument();
  });
});

describe("Contatos, aba Conversa: a caixa de escrever", () => {
  it("sem conexão, a caixa fica bloqueada e o 'Reconectar' do admin leva à Configuração", () => {
    navegar.mockClear();
    montar("fernando", {
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, status: "desconectada" } }),
    });
    expect(screen.getByText(/^WhatsApp desconectado/)).toBeInTheDocument();
    expect(campo()).toBeDisabled();
    // Quem reconecta o WhatsApp de verdade é a Configuração (não há mais a reconexão simulada).
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    expect(navegar).toHaveBeenCalledWith({ to: "/app/configuracao" });
  });

  it("sem conexão, como atendente com a conexão desligada: pede um admin, sem 'Reconectar'", () => {
    montar("fernando", {
      papel: "atendente",
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, ativa: false } }),
    });
    expect(campo()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reconectar" })).not.toBeInTheDocument();
    expect(screen.getByText(/Peça a um admin para reconectar/)).toBeInTheDocument();
  });

  it("focarCaixa põe o foco na caixa de escrever", () => {
    montar("fernando", { focarCaixa: true });
    expect(campo()).toHaveFocus();
  });
});

describe("Contatos, aba Conversa: o 'Ver na conversa'", () => {
  it("mensagemAlvo rola só a lista de mensagens até a mensagem certa, põe o foco nela e a destaca por 2 s", () => {
    const e = criarEstadoInicial(AGORA);
    const msgs = e.mensagens.filter((m) => m.conversa_id === idConversa("juliana"));
    const alvo = msgs[0]!; // a primeira, longe do fim
    const outra = msgs[msgs.length - 1]!;
    // Quem rola é a lista (scrollBy nela); a página não pode se mexer (o scrollIntoView mexeria).
    const rolouLista: Element[] = [];
    const rolouPagina: Element[] = [];
    HTMLElement.prototype.scrollBy = function (this: HTMLElement) {
      rolouLista.push(this);
    } as typeof HTMLElement.prototype.scrollBy;
    Element.prototype.scrollIntoView = function (this: Element) {
      rolouPagina.push(this);
    };

    montar("juliana", { mensagemAlvo: alvo.id });

    const el = document.getElementById(`contato-msg-${alvo.id}`)!;
    expect(el).toBeInTheDocument();
    // Quem rola é o rolo que envolve a lista (o pai do role=log), não o cartão nem a seção.
    expect(rolouLista).toEqual([log().parentElement]);
    expect(rolouPagina).toEqual([]);
    expect(el).toHaveFocus();
    expect(el.className).toMatch(/acDestaque/);
    expect(document.getElementById(`contato-msg-${outra.id}`)!.className).not.toMatch(/acDestaque/);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(el.className).not.toMatch(/acDestaque/);
    // O jsdom não tem scrollIntoView nem scrollBy em elemento: tira os dublês para não vazar.
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    delete (HTMLElement.prototype as { scrollBy?: unknown }).scrollBy;
  });

  it("o cartão da conversa fica com a altura que sobra da janela, com mínimo, e recalcula no resize", () => {
    // jsdom: sem layout, o cartão está no alto (topo 0). No computador, a altura é a janela menos a
    // folga de 24 px, com o mínimo de 240.
    const alturaAntes = window.innerHeight;
    const cartao = () => log().closest("[class*='acCartao']") as HTMLElement;
    try {
      Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
      montar("juliana");
      expect(cartao().style.getPropertyValue("--ac-altura")).toBe("876px");

      // A janela muda com a aba aberta: mede de novo.
      Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(cartao().style.getPropertyValue("--ac-altura")).toBe("676px");
      cleanup();

      // Janela baixa: fica o mínimo, e a página rola para mostrar a caixa de escrever.
      Object.defineProperty(window, "innerHeight", { value: 200, configurable: true });
      montar("juliana");
      expect(cartao().style.getPropertyValue("--ac-altura")).toBe("240px");
    } finally {
      Object.defineProperty(window, "innerHeight", { value: alturaAntes, configurable: true });
    }
  });

  it("no celular, o cartão para acima da bolinha da Janete (160 px do pé), com o mínimo de 220", () => {
    const alturaAntes = window.innerHeight;
    const matchMediaAntes = window.matchMedia;
    const cartao = () => log().closest("[class*='acCartao']") as HTMLElement;
    // Só a consulta do celular responde que sim.
    window.matchMedia = ((consulta: string) => ({
      matches: consulta.includes("max-width: 899px"),
      media: consulta,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
      montar("juliana");
      expect(cartao().style.getPropertyValue("--ac-altura")).toBe("684px");
      cleanup();

      Object.defineProperty(window, "innerHeight", { value: 300, configurable: true });
      montar("juliana");
      expect(cartao().style.getPropertyValue("--ac-altura")).toBe("220px");
    } finally {
      window.matchMedia = matchMediaAntes;
      Object.defineProperty(window, "innerHeight", { value: alturaAntes, configurable: true });
    }
  });

  it("sem mensagemAlvo, nenhuma mensagem fica destacada", () => {
    montar("juliana");
    expect(log().querySelector("[class*='acDestaque']")).toBeNull();
  });
});
