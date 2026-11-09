import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acontecimentos, midiasDoContato } from "@/features/plataforma/contatos/dados";
import { PerfilContato } from "@/features/plataforma/contatos/Perfil";
import { idTituloPerfil } from "@/features/plataforma/contatos/ids";
import type { PropsAba } from "@/features/plataforma/contatos/tipos";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import {
  criarEstadoInicial,
  custoDaConversa,
  etapasVisiveis,
  idContato,
  idConversa,
  membroDoPapel,
  mensagensDaConversa,
  janeteAtivaAgora,
  telefoneLegivel,
  useExemplo,
  type Contato,
  type Conversa,
  type EstadoBase,
  type EstadoExemplo,
} from "@/features/plataforma/exemplo";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C2 da spec de Contatos (docs/spec-contatos.md): o perfil do contato. O corpo das abas é de
// outras tasks: aqui elas entram como dublês que guardam as últimas props, para conferir a fiação
// (ir para a Conversa numa mensagem, o "Responder" com o foco na caixa, a Ficha em edição).

type PropsConversa = PropsAba & { mensagemAlvo: string | null; focarCaixa: boolean };
type PropsFicha = PropsAba & { editando: boolean; aoEditar(editando: boolean): void };

const registro = vi.hoisted(() => ({
  resumo: null as unknown,
  conversa: null as unknown,
  ficha: null as unknown,
  estado: null as unknown,
}));

const ultimo = {
  resumo: () => registro.resumo as PropsAba,
  conversa: () => registro.conversa as PropsConversa,
  ficha: () => registro.ficha as PropsFicha,
  estado: () => registro.estado as EstadoExemplo,
};

vi.mock("@/features/plataforma/contatos/AbaResumo", () => ({
  AbaResumo: (p: unknown) => {
    registro.resumo = p;
    return <div data-testid="aba-resumo" />;
  },
}));
vi.mock("@/features/plataforma/contatos/AbaConversa", () => ({
  AbaConversa: (p: unknown) => {
    registro.conversa = p;
    // Uma caixa de escrever de mentira, para o "Responder" com a Conversa já aberta ter onde focar.
    return (
      <div data-testid="aba-conversa">
        <textarea aria-label="Mensagem" />
      </div>
    );
  },
}));
vi.mock("@/features/plataforma/contatos/AbaLinha", () => ({
  AbaLinha: () => <div data-testid="aba-linha" />,
}));
vi.mock("@/features/plataforma/contatos/AbaMidias", () => ({
  AbaMidias: () => <div data-testid="aba-midias" />,
}));
vi.mock("@/features/plataforma/contatos/AbaFicha", () => ({
  AbaFicha: (p: unknown) => {
    registro.ficha = p;
    return <div data-testid="aba-ficha" />;
  },
}));

const navegar = vi.fn();
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navegar,
}));

// Sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const JULIANA = idContato("juliana");
const CV_JULIANA = idConversa("juliana");
const DOLAR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

const aoVoltar = vi.fn();
const aoApagado = vi.fn();
const avisar = vi.fn();

/** Guarda o estado do exemplo a cada render, para o teste ver o efeito das ações. */
function Sonda() {
  registro.estado = useExemplo().estado;
  return null;
}

function montar({ papel = "admin", inicial }: { papel?: Papel; inicial?: EstadoBase } = {}) {
  return render(
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={() => inicial ?? criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => AGORA}>
        <Sonda />
        <PerfilContato contatoId={JULIANA} agora={AGORA.getTime()} aoVoltar={aoVoltar} aoApagado={aoApagado} avisar={avisar} />
      </ProvedorDados>
    </ProvedorPapel>,
  );
}

/** O estado inicial com a Juliana mudada por `f`. */
function comJuliana(f: (c: Contato) => Contato, base: EstadoBase = criarEstadoInicial(AGORA)): EstadoBase {
  return { ...base, contatos: base.contatos.map((c) => (c.id === JULIANA ? f(c) : c)) };
}

/** O estado inicial com a conversa da Juliana mudada por `f`. */
function comConversaJuliana(f: (c: Conversa) => Conversa, base: EstadoBase = criarEstadoInicial(AGORA)): EstadoBase {
  return { ...base, conversas: base.conversas.map((c) => (c.id === CV_JULIANA ? f(c) : c)) };
}

const PASSO = { titulo: "Marcar a demonstração", texto: "Ela pediu uma demonstração da agenda." };

const VIVO = "Ao vivo: a Janete está conversando agora";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  registro.resumo = null;
  registro.conversa = null;
  registro.ficha = null;
  registro.estado = null;
  navegar.mockClear();
  aoVoltar.mockClear();
  aoApagado.mockClear();
  avisar.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("o cabeçalho", () => {
  it("mostra o nome no h1 do perfil, os dados com o vazio em cinza e o nome no WhatsApp; ← Contatos volta", () => {
    montar({ inicial: comJuliana((c) => ({ ...c, empresa: null, email: "  ", nome_whatsapp: "Ju Prado" })) });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAttribute("id", idTituloPerfil(JULIANA));
    expect(h1).toHaveAttribute("tabindex", "-1");
    expect(h1).toHaveTextContent("Juliana");
    expect(screen.getByText("Empresa não informada")).toBeInTheDocument();
    expect(screen.getByText("E-mail não informado")).toBeInTheDocument();
    expect(screen.getByText("No WhatsApp: Ju Prado")).toBeInTheDocument();
    const tel = criarEstadoInicial(AGORA).contatos.find((c) => c.id === JULIANA)!.telefone;
    expect(screen.getByText(telefoneLegivel(tel))).toBeInTheDocument();

    const voltar = screen.getByRole("button", { name: /Contatos/ });
    // Diferente do link "Contatos" do menu lateral, e contendo o texto que se vê.
    expect(voltar).toHaveAccessibleName("Voltar para Contatos");
    expect(voltar).toHaveTextContent("Contatos");
    fireEvent.click(voltar);
    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });
});

describe("o papel", () => {
  it("o admin vê o Apagar e o custo de IA em US$", () => {
    const estado = criarEstadoInicial(AGORA);
    const custo = custoDaConversa(estado, CV_JULIANA);
    expect(custo).not.toBeNull();
    montar();
    expect(screen.getByRole("button", { name: "Apagar contato" })).toBeInTheDocument();
    expect(screen.getByText("Custo de IA")).toBeInTheDocument();
    // o Intl põe um espaço inquebrável depois do "US$": compara o texto cru da célula
    expect(screen.getByText((_, el) => el?.tagName === "B" && el.textContent === DOLAR.format(custo!))).toBeInTheDocument();
    expect(DOLAR.format(custo!)).toMatch(/^US\$/);
  });

  it("o atendente não vê o Apagar nem o custo", () => {
    montar({ papel: "atendente" });
    expect(screen.queryByRole("button", { name: "Apagar contato" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Custo de IA/)).not.toBeInTheDocument();
    expect(screen.queryByText(/US\$/)).not.toBeInTheDocument();
    // as outras 4 ações ficam
    for (const nome of ["Abrir no Chat", "Ver no Kanban", "Mover para…", "Editar"]) {
      expect(screen.getByRole("button", { name: nome })).toBeInTheDocument();
    }
  });
});

describe("mover", () => {
  it("o menu tem as 6 etapas com a atual marcada; escolher outra muda a etapa e avisa", async () => {
    const estado = criarEstadoInicial(AGORA);
    const etapas = etapasVisiveis(estado);
    expect(etapas).toHaveLength(6);
    const atual = estado.contatos.find((c) => c.id === JULIANA)!.etapa_id;
    const destino = etapas.find((e) => e.id !== atual)!;
    montar({ papel: "atendente" });

    fireEvent.click(screen.getByRole("button", { name: "Mover para…" }));
    const menu = screen.getByRole("menu");
    const itens = within(menu).getAllByRole("menuitemradio");
    expect(itens).toHaveLength(6);
    // Só o nome em cada item (como no Chat e no Kanban); o aria-checked marca a atual, e só ela.
    const marcados = itens.filter((i) => i.getAttribute("aria-checked") === "true");
    expect(marcados).toHaveLength(1);
    const marcado = marcados[0]!;
    expect(marcado).toHaveTextContent(etapas.find((e) => e.id === atual)!.nome);
    expect(itens.filter((i) => /Etapa atual/.test(i.textContent ?? ""))).toHaveLength(0);

    // escolher a atual não faz nada
    fireEvent.click(marcado);
    expect(avisar).not.toHaveBeenCalled();
    expect(ultimo.estado().contatos.find((c) => c.id === JULIANA)!.etapa_id).toBe(atual);

    fireEvent.click(screen.getByRole("button", { name: "Mover para…" }));
    // A ação da camada de dados é assíncrona: espera ela voltar.
    await act(async () => {
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: destino.nome }));
    });
    expect(ultimo.estado().contatos.find((c) => c.id === JULIANA)!.etapa_id).toBe(destino.id);
    expect(avisar).toHaveBeenCalledWith(`Juliana foi para ${destino.nome}`);
  });
});

describe("apagar", () => {
  it("pede confirmação com o foco em Cancelar, e Esc fecha devolvendo o foco", () => {
    const estado = criarEstadoInicial(AGORA);
    const n = mensagensDaConversa(estado, CV_JULIANA).filter((m) => m.status !== "cancelada").length;
    montar();
    const apagar = screen.getByRole("button", { name: "Apagar contato" });
    fireEvent.click(apagar);

    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo).toHaveAccessibleName(/^Apagar Juliana/);
    expect(within(dialogo).getByText(`${n} mensagens da conversa`)).toBeInTheDocument();
    expect(within(dialogo).getByText(/mídias? trocadas? \(imagens, áudios, vídeos e documentos\)/)).toBeInTheDocument();
    // Decisão 12 (c) da spec de ligar as telas: o número não fica bloqueado.
    expect(within(dialogo).getByText("Se ele escrever de novo, volta como lead novo.")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toHaveFocus();

    // o Tab fica preso no diálogo
    fireEvent.keyDown(dialogo, { key: "Tab" });
    expect(within(dialogo).getByRole("button", { name: "Apagar para sempre" })).toHaveFocus();
    fireEvent.keyDown(dialogo, { key: "Tab" });
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toHaveFocus();

    fireEvent.keyDown(dialogo, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(apagar).toHaveFocus();
    expect(aoApagado).not.toHaveBeenCalled();
    expect(ultimo.estado().contatos.some((c) => c.id === JULIANA)).toBe(true);
  });

  it("clique fora cancela", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Apagar contato" }));
    const veu = screen.getByRole("alertdialog").parentElement!;
    fireEvent.mouseDown(veu);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirmar tira o contato do estado, grava na auditoria e chama aoApagado com o nome", async () => {
    montar();
    const antes = ultimo.estado().auditoria.length;
    const nome = ultimo.estado().contatos.find((c) => c.id === JULIANA)!.nome!;
    fireEvent.click(screen.getByRole("button", { name: "Apagar contato" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apagar para sempre" }));
    });

    const depois = ultimo.estado();
    expect(depois.contatos.some((c) => c.id === JULIANA)).toBe(false);
    expect(depois.auditoria).toHaveLength(antes + 1);
    expect(depois.auditoria.at(-1)).toMatchObject({ acao: "contato_apagado", alvo: JULIANA });
    expect(aoApagado).toHaveBeenCalledWith(nome);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("a coluna da direita", () => {
  it("a bolinha de ao vivo aparece com janeteAtivaAgora (a Janete digitando)", () => {
    const base = criarEstadoInicial(AGORA);
    const inicial: EstadoBase = {
      ...base,
      conversas: base.conversas.map((c) => (c.id === CV_JULIANA ? { ...c, modo: "janete" } : c)),
      digitando: [CV_JULIANA],
    };
    expect(janeteAtivaAgora(inicial, CV_JULIANA, AGORA)).toBe(true);
    montar({ inicial });
    expect(screen.getByText(VIVO)).toBeInTheDocument();
    expect(screen.getByTitle(VIVO)).toBeInTheDocument();
    expect(screen.getByText("A Janete")).toBeInTheDocument();
  });

  it("sem janeteAtivaAgora, não há bolinha", () => {
    const base = criarEstadoInicial(AGORA);
    const velho = new Date(AGORA.getTime() - 60 * 60_000).toISOString();
    const inicial: EstadoBase = {
      ...base,
      conversas: base.conversas.map((c) => (c.id === CV_JULIANA ? { ...c, modo: "janete" } : c)),
      digitando: [],
      // nenhuma troca nos últimos 5 minutos
      mensagens: base.mensagens.map((m) =>
        m.conversa_id === CV_JULIANA && Date.parse(m.momento) > Date.parse(velho) ? { ...m, momento: velho } : m,
      ),
    };
    expect(janeteAtivaAgora(inicial, CV_JULIANA, AGORA)).toBe(false);
    montar({ inicial });
    expect(screen.queryByText(VIVO)).not.toBeInTheDocument();
    expect(screen.getByText("A Janete")).toBeInTheDocument();
  });

  it("quem atende sou eu: o cartão mostra 'VC' e 'Você' (como o Chat e o Kanban)", () => {
    const base = criarEstadoInicial(AGORA);
    const eu = membroDoPapel(base.membros, "admin");
    montar({ inicial: comConversaJuliana((c) => ({ ...c, modo: "humano", responsavel_id: eu.id }), base) });
    const cartao = screen.getByRole("region", { name: "Quem atende" });
    expect(within(cartao).getByText("Você")).toBeInTheDocument();
    expect(within(cartao).getByText("VC")).toBeInTheDocument();
  });

  it("na espera, o tempo aparece no cartão e o ícone só fica vermelho a partir de 10 min (a falha também)", () => {
    const simbolo = () => screen.getByRole("region", { name: "Quem atende" }).querySelector("[data-tipo]")!;
    const ha = (s: number) => new Date(AGORA.getTime() - s * 1000).toISOString();
    const falha = { modo: "humano" as const, responsavel_id: null, motivo_humano: "erro_provedor" as const };

    // Uma falha de 4 min: âmbar, como no Chat (a cor não depende de ser falha).
    montar({ inicial: comConversaJuliana((c) => ({ ...c, ...falha, aguardando_humano_desde: ha(4 * 60) })) });
    expect(simbolo()).toHaveAttribute("data-tipo", "falha");
    expect(simbolo()).not.toHaveAttribute("data-longa");
    expect(screen.getByText("há 4 min")).toBeInTheDocument();
    cleanup();

    montar({ inicial: comConversaJuliana((c) => ({ ...c, ...falha, aguardando_humano_desde: ha(599) })) });
    expect(simbolo()).not.toHaveAttribute("data-longa");
    cleanup();

    montar({ inicial: comConversaJuliana((c) => ({ ...c, ...falha, aguardando_humano_desde: ha(600) })) });
    expect(simbolo()).toHaveAttribute("data-longa");
    expect(screen.getByText("há 10 min")).toBeInTheDocument();
  });

  it("sem gasto de IA, o custo diz 'Nenhum gasto registrado'", () => {
    const base = criarEstadoInicial(AGORA);
    montar({ inicial: { ...base, custos: base.custos.filter((c) => c.conversa_id !== CV_JULIANA) } });
    expect(screen.getByText("Custo de IA")).toBeInTheDocument();
    expect(screen.getByText("Nenhum gasto registrado")).toBeInTheDocument();
  });

  it("sem sugestão, o Próximo passo não aparece", () => {
    montar({ inicial: comJuliana((c) => ({ ...c, proximoPasso: null })) });
    expect(screen.queryByText("Próximo passo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Responder" })).not.toBeInTheDocument();
  });

  it("com sugestão, 'Responder' abre a Conversa com focarCaixa", () => {
    montar({ inicial: comJuliana((c) => ({ ...c, proximoPasso: PASSO })) });
    expect(screen.getByText("Próximo passo")).toBeInTheDocument();
    expect(screen.getByText("sugestão da Janete")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: PASSO.titulo })).toBeInTheDocument();
    expect(screen.getByText(PASSO.texto)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(screen.getByRole("tab", { name: /^Conversa/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("aba-conversa")).toBeInTheDocument();
    expect(ultimo.conversa().focarCaixa).toBe(true);
    expect(ultimo.conversa().mensagemAlvo).toBeNull();
  });

  it("com a Conversa já aberta, 'Responder' de novo põe o foco na caixa", () => {
    montar({ inicial: comJuliana((c) => ({ ...c, proximoPasso: PASSO })) });
    const responder = screen.getByRole("button", { name: "Responder" });
    fireEvent.click(responder);
    const caixa = screen.getByRole("textbox", { name: "Mensagem" });
    // A pessoa saiu da caixa (clicou em outra coisa) e voltou ao "Responder", que segue à vista.
    responder.focus();
    expect(caixa).not.toHaveFocus();
    fireEvent.click(responder);
    expect(caixa).toHaveFocus();
  });
});

describe("as abas", () => {
  it("começa no Resumo, com as props do contrato", () => {
    montar();
    expect(screen.getByRole("tab", { name: "Resumo" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toContainElement(screen.getByTestId("aba-resumo"));
    expect(ultimo.resumo()).toMatchObject({ contatoId: JULIANA, agora: AGORA.getTime() });
    expect(ultimo.resumo().avisar).toBe(avisar);
  });

  it("as contagens de Conversa, Linha do tempo e Mídias saem do exemplo", () => {
    const estado = criarEstadoInicial(AGORA);
    const n = mensagensDaConversa(estado, CV_JULIANA).filter((m) => m.status !== "cancelada").length;
    const comoAdmin = { ...estado, eu: membroDoPapel(estado.membros, "admin") };
    const nLinha = acontecimentos(comoAdmin, JULIANA).length;
    const nMidias = midiasDoContato(comoAdmin, JULIANA).length;
    expect(nLinha).toBeGreaterThan(1);
    montar();
    expect(screen.getByRole("tab", { name: new RegExp(`^Conversa.*${n} mensagens`) })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: new RegExp(`^Linha do tempo.*, ${nLinha} acontecimentos$`) })).toBeInTheDocument();
    const palavra = nMidias === 1 ? "mídia" : "mídias";
    expect(screen.getByRole("tab", { name: new RegExp(`^Mídias.*, ${nMidias} ${palavra}$`) })).toBeInTheDocument();
  });

  it("verNaConversa abre a Conversa com mensagemAlvo", () => {
    montar();
    act(() => ultimo.resumo().verNaConversa("msg-alvo"));
    expect(screen.getByRole("tab", { name: /^Conversa/ })).toHaveAttribute("aria-selected", "true");
    expect(ultimo.conversa()).toMatchObject({ mensagemAlvo: "msg-alvo", focarCaixa: false });
  });

  it("irParaAba troca a aba", () => {
    montar();
    act(() => ultimo.resumo().irParaAba("midias"));
    expect(screen.getByTestId("aba-midias")).toBeInTheDocument();
  });

  it("abrir a Conversa não rola a página (o equipe pediu para tirar a âncora em 31/10)", () => {
    const rolou: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      rolou.push(this);
    };
    try {
      montar();
      fireEvent.click(screen.getByRole("tab", { name: /^Conversa/ }));
      expect(screen.getByRole("tab", { name: /^Conversa/ })).toHaveAttribute("aria-selected", "true");
      // O "Ver na conversa" (que rola só a lista) está coberto em t4-contatos-conversa: aqui a aba é dublê.
      expect(rolou).toEqual([]);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("Editar abre a Ficha com editando, e aoEditar(false) volta", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("tab", { name: "Ficha" })).toHaveAttribute("aria-selected", "true");
    expect(ultimo.ficha().editando).toBe(true);
    act(() => ultimo.ficha().aoEditar(false));
    expect(ultimo.ficha().editando).toBe(false);
  });

  it("abrir a Ficha pela barra não entra em edição", () => {
    montar();
    fireEvent.click(screen.getByRole("tab", { name: "Ficha" }));
    expect(ultimo.ficha().editando).toBe(false);
  });

  it("as setas trocam de aba (em círculo), com o foco junto", () => {
    montar();
    const resumo = screen.getByRole("tab", { name: "Resumo" });
    resumo.focus();
    fireEvent.keyDown(resumo, { key: "ArrowRight" });
    const conversa = screen.getByRole("tab", { name: /^Conversa/ });
    expect(conversa).toHaveAttribute("aria-selected", "true");
    expect(conversa).toHaveFocus();
    expect(conversa).toHaveAttribute("tabindex", "0");
    expect(resumo).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(conversa, { key: "ArrowLeft" });
    fireEvent.keyDown(resumo, { key: "ArrowLeft" });
    const ficha = screen.getByRole("tab", { name: "Ficha" });
    expect(ficha).toHaveAttribute("aria-selected", "true");
    expect(ficha).toHaveFocus();

    fireEvent.keyDown(ficha, { key: "Home" });
    expect(resumo).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(resumo, { key: "End" });
    expect(ficha).toHaveAttribute("aria-selected", "true");
  });
});

describe("navegar", () => {
  it("Abrir no Chat leva à conversa do contato", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Abrir no Chat" }));
    expect(navegar).toHaveBeenCalledWith({ to: "/app/chat", search: { conversa: CV_JULIANA } });
  });

  it("Ver no Kanban leva ao contato no quadro", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Ver no Kanban" }));
    expect(navegar).toHaveBeenCalledWith({ to: "/app/kanban", search: { contato: JULIANA } });
  });
});
