import { readFileSync } from "node:fs";
import path from "node:path";

import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Conversa } from "@/features/plataforma/chat/Conversa";
import { diaLocal } from "@/features/plataforma/comum/tempo";
import { ordemDaLista } from "@/features/plataforma/chat/Lista";
import { TelaChat } from "@/features/plataforma/chat/TelaChat";
import {
  criarEstadoInicial,
  idContato,
  idConversa,
  useExemplo,
  type EstadoBase,
} from "@/features/plataforma/exemplo";
import type { AcoesExemplo } from "@/features/plataforma/exemplo/tipos";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C2 do Chat final, revista na rodada 2 (task B): a conversa (cabeçalho numa linha com o
// bastão de 2 botões, mensagens, linhas de passagem e a caixa de escrever), com os dados de exemplo
// em memória. Testes: a ordem do bastão e a troca, o foco no campo, a linha de estado, a faixa só
// nos 2 casos, sem toast ao assumir e devolver, a passagem sem cartão, os bloqueios e marcar como lida.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// A ficha usa o roteador no "Ver no Kanban" e a conversa no "Reconectar" de quem desligou a conexão;
// a integração não tem roteador montado.
const navegar = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navegar,
}));

/** Mostra quantas não lidas a conversa tem, para conferir o "marcar como lida ao abrir". */
function NaoLidas({ conversaId }: { conversaId: string }) {
  const { estado } = useExemplo();
  return <output data-testid="nao-lidas">{estado.conversas.find((c) => c.id === conversaId)?.nao_lidas}</output>;
}

function montar(
  lead: string,
  opcoes: { papel?: Papel; ajustar?: (e: EstadoBase) => EstadoBase; fichaAberta?: boolean } = {},
) {
  const conversaId = idConversa(lead);
  const alternar = vi.fn();
  const inicial = () => {
    const e = criarEstadoInicial(new Date());
    return opcoes.ajustar ? opcoes.ajustar(e) : e;
  };
  const r = render(
    <ProvedorPapel inicial={opcoes.papel ?? "admin"}>
      <ProvedorDados exemplo={inicial} progredirEnvios={false}>
        <Conversa conversaId={conversaId} fichaAberta={opcoes.fichaAberta ?? false} onAlternarFicha={alternar} />
        <NaoLidas conversaId={conversaId} />
      </ProvedorDados>
    </ProvedorPapel>,
  );
  return { ...r, conversaId, alternar };
}

const bastao = () => screen.getByRole("group", { name: "Quem conduz a conversa" });
/** Os 2 botões do bastão, na ordem da tela (o 1º é o de quem atende). */
const botoesBastao = () => within(bastao()).getAllByRole("button");
// O nome acessível começa pelo rótulo que se vê (WCAG 2.5.3): "Janete atendendo" ou "Devolver à Janete".
const NOME_JANETE = /^(Janete atendendo|Devolver à Janete)/;
const ladoJanete = () => botoesBastao().find((b) => NOME_JANETE.test(b.getAttribute("aria-label") ?? ""))!;
const ladoPessoa = () => botoesBastao().find((b) => !NOME_JANETE.test(b.getAttribute("aria-label") ?? ""))!;
/** A faixa sobre a caixa: a caixa marca data-com-faixa quando há uma. */
const temFaixa = () => document.querySelector("[data-com-faixa]") !== null;
/** A frase inteira da passagem: o texto só para o leitor de tela (o único filho sem aria-hidden). */
const fraseDa = (n: HTMLElement) =>
  Array.from(n.children).find((c) => !c.hasAttribute("aria-hidden"))?.textContent ?? "";
/** O que a passagem mostra (a rota, o texto curto e a hora), tudo com aria-hidden. */
const visivelDa = (n: HTMLElement) =>
  Array.from(n.children)
    .filter((c) => c.getAttribute("aria-hidden") === "true")
    .map((c) => c.textContent ?? "")
    .join("");
/** A linha de passagem (role="note") cuja frase inteira começa pelo texto. */
const passagem = (inicio: string | RegExp) =>
  within(log()).getAllByRole("note").find((n) => {
    const frase = fraseDa(n);
    return typeof inicio === "string" ? frase.startsWith(inicio) : inicio.test(frase);
  });
/** O role="status" da própria conversa (a TelaChat e a lista têm os deles). */
const statusDaConversa = () => log().closest("[data-ficha]")!.querySelector<HTMLElement>(":scope > [role='status']")!;
const campo = () => screen.getByRole("textbox", { name: /^Mensagem/ });
const log = () => screen.getByRole("log");
/** A linha de baixo do nome, no cabeçalho: a empresa e a etapa (ou há quanto tempo espera). */
const estadoCab = () => screen.getByRole("heading", { level: 2 }).nextElementSibling as HTMLElement;
/** A empresa do lead no exemplo, para a linha do cabeçalho. */
const empresaDe = (lead: string) => criarEstadoInicial(new Date()).contatos.find((c) => c.id === idContato(lead))!.empresa!;
const comeca = (texto: string) => new RegExp(`^${texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

function escrever(texto: string) {
  fireEvent.change(campo(), { target: { value: texto } });
  fireEvent.keyDown(campo(), { key: "Enter" });
}

describe("classes dos CSS Modules da conversa", () => {
  const pasta = path.resolve(__dirname, "../features/plataforma/chat");
  it.each(["Conversa", "Bastao", "Passagem"])("%s: cada classe declarada existe no CSS", (nome) => {
    const codigo = readFileSync(path.join(pasta, `${nome}.tsx`), "utf-8");
    const css = readFileSync(path.join(pasta, `${nome}.module.css`), "utf-8");
    const bloco = /as Classes<([^>]+)>/.exec(codigo);
    expect(bloco).not.toBeNull();
    const classes = [...bloco![1]!.matchAll(/["']([\w-]+)["']/g)].map((c) => c[1]!);
    expect(classes.length).toBeGreaterThan(2);
    const faltando = classes.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(faltando).toEqual([]);
  });
});

describe("Conversa: cabeçalho", () => {
  it("mostra o nome, quem atende e alterna a ficha", () => {
    const { alternar } = montar("fernando");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Fernando");
    // quem atende está no bastão; sob o nome ficam a empresa e a etapa
    expect(estadoCab()).toHaveTextContent(comeca(`${empresaDe("fernando")} · `));
    expect(ladoJanete()).toBeDisabled();
    expect(ladoJanete()).toHaveAccessibleName("Janete atendendo. Esta conversa está com a Janete");
    expect(ladoPessoa()).toHaveAccessibleName("Assumir conversa. A Janete sai dela");

    // rótulo fixo: o estado vai só no aria-expanded (sem anunciar duas vezes)
    const ficha = screen.getByRole("button", { name: "Ficha do lead" });
    expect(ficha).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(ficha);
    expect(alternar).toHaveBeenCalledTimes(1);
  });

  it("esperando: o estado diz só há quanto tempo (sem o motivo); o motivo fica na passagem", () => {
    montar("ricardo");
    expect(estadoCab()).toHaveTextContent(/^Aguardando há \d+ min$/);
    expect(estadoCab()).toHaveAttribute("data-tom", "espera");
    expect(bastao()).toHaveAttribute("data-estado", "espera");
    expect(ladoPessoa()).toHaveAccessibleName(/^Assumir conversa\. Ela espera atendimento há /);
    // a linha de passagem da Janete para a equipe, com o motivo curto
    expect(within(log()).getByText("A Janete pediu ajuda")).toBeInTheDocument();
  });

  it("linha de estado: âmbar até 10 min e data-longa a partir de 10 min", () => {
    const esperandoHa = (min: number) => (e: EstadoBase) => ({
      ...e,
      conversas: e.conversas.map((c) =>
        c.id === idConversa("ricardo")
          ? { ...c, aguardando_humano_desde: new Date(Date.now() - min * 60_000).toISOString() }
          : c,
      ),
    });
    montar("ricardo", { ajustar: esperandoHa(9) });
    expect(estadoCab()).toHaveTextContent("Aguardando há 9 min");
    expect(estadoCab()).toHaveAttribute("data-tom", "espera");
    expect(estadoCab()).not.toHaveAttribute("data-longa");
    expect(estadoCab().querySelector("svg.lucide-clock")).not.toBeNull();
    cleanup();

    montar("ricardo", { ajustar: esperandoHa(10) });
    expect(estadoCab()).toHaveTextContent("Aguardando há 10 min");
    expect(estadoCab()).toHaveAttribute("data-longa");
  });

  it("celular: 'Respondida pelo celular · etapa'", () => {
    montar("carlos");
    expect(estadoCab()).toHaveTextContent(/^Respondida pelo celular · .+/);
    expect(estadoCab().querySelector("svg.lucide-smartphone")).not.toBeNull();
  });

  it("com outra pessoa: a empresa no cabeçalho e 'Com Marina' (quem atende) na frente do bastão", () => {
    montar("patricia");
    expect(estadoCab()).toHaveTextContent(comeca(empresaDe("patricia")));
    expect(ladoPessoa()).toHaveAccessibleName("Com Marina · Assumir de Marina. A conversa passa para você");
    expect(ladoPessoa()).toHaveAttribute("title", "Assumir de Marina. A conversa passa para você");
    // Os 2 rótulos, cada um no seu span. O jsdom não aplica a container query: qual dos dois aparece
    // em cada largura (o curto até 600 px de cabeçalho, o que inclui 1440 px com a ficha aberta) se
    // confere pelo print, não aqui.
    expect(ladoPessoa().querySelector("[class*='baLongo']")!.textContent).toBe("Com Marina · Assumir");
    expect(ladoPessoa().querySelector("[class*='baCurto']")!.textContent).toBe("Com Marina");
  });

  it("a frente que é uma ação (esperando, outra pessoa, celular) tem texto; o grupo diz se a frente é estado ou ação", () => {
    const casos: [lead: string, tom: string, frente: string, curto: string][] = [
      ["ricardo", "espera", "acao", "Assumir"],
      ["patricia", "outro", "acao", "Com Marina"],
      ["carlos", "celular", "acao", "Assumir"],
      ["fernando", "janete", "estado", "Com a Janete"],
      ["sergio", "voce", "estado", "Com você"],
    ];
    for (const [lead, tom, frente, curto] of casos) {
      montar(lead);
      const b1 = botoesBastao()[0]!;
      expect(b1).toHaveAttribute("data-tom", tom);
      expect(bastao()).toHaveAttribute("data-frente", frente);
      expect(b1.querySelector("[class*='baCurto']")!.textContent).toBe(curto);
      cleanup();
    }
    // a regra de largura: só a frente que é estado fica só com o ícone (no CSS, pelo data-frente)
    const css = readFileSync(path.resolve(__dirname, "../features/plataforma/chat/Bastao.module.css"), "utf-8");
    expect(css).toMatch(/\[data-frente='estado'\] > \.baLado\[data-lado='frente'\] \.baTxt \{\s*display: none;/);
    expect(css).not.toMatch(/\[data-frente='acao'\] > \.baLado\[data-lado='frente'\] \.baTxt/);
  });

  it("estreito: a linha de estado em 2 pedaços; na espera, o 'Aguardando' sai e o tempo fica", () => {
    montar("ricardo");
    const [a, b] = Array.from(estadoCab().querySelectorAll("span"));
    expect(a).toHaveTextContent("Aguardando");
    expect(a).toHaveAttribute("data-sai-estreito");
    expect(b).toHaveTextContent(/^há \d+ min$/);
    cleanup();
    montar("fernando");
    const [e, etapa] = Array.from(estadoCab().querySelectorAll("span"));
    expect(e).toHaveTextContent(empresaDe("fernando"));
    expect(e).not.toHaveAttribute("data-sai-estreito");
    expect(etapa).toHaveTextContent(/^· .+/);
  });

  it("'Janete digitando…' aparece quando o estado diz", () => {
    montar("fernando");
    expect(within(log()).getByText("A Janete está digitando")).toBeInTheDocument();
  });
});

describe("Conversa: o bastão", () => {
  it("a ordem dos 2 botões: na frente (o 1º do grupo) fica quem atende, em cada estado", () => {
    const casos: [lead: string, estado: string, nomes: [string, string]][] = [
      ["fernando", "janete", ["Janete atendendo. Esta conversa está com a Janete", "Assumir conversa. A Janete sai dela"]],
      ["sergio", "humano", ["Você atendendo. Esta conversa está com você", "Devolver à Janete. Ela volta a atender esta conversa"]],
      ["patricia", "humano", ["Com Marina · Assumir de Marina. A conversa passa para você", "Devolver à Janete. Ela volta a atender esta conversa"]],
      ["carlos", "celular", [
        "Assumir pela plataforma. A conversa foi respondida pelo celular da empresa",
        "Devolver à Janete. Ela volta a atender esta conversa",
      ]],
    ];
    for (const [lead, estado, [frente, tras]] of casos) {
      montar(lead);
      expect(bastao()).toHaveAttribute("data-estado", estado);
      const [b1, b2] = botoesBastao();
      expect(botoesBastao()).toHaveLength(2);
      expect(b1).toHaveAccessibleName(frente);
      expect(b1).toHaveAttribute("data-lado", "frente");
      expect(b2).toHaveAccessibleName(tras);
      expect(b2).toHaveAttribute("data-lado", "tras");
      cleanup();
    }

    // esperando: o "Assumir" fica na frente, em âmbar (quem chama)
    montar("ricardo");
    const [b1, b2] = botoesBastao();
    expect(b1).toHaveAccessibleName(/^Assumir conversa\. Ela espera atendimento há /);
    expect(b1).toHaveAttribute("data-tom", "espera");
    expect(b2).toHaveAccessibleName("Devolver à Janete. Ela volta a atender esta conversa");
  });

  it("assumir e devolver trocam os 2 botões de lugar", () => {
    montar("fernando");
    expect(botoesBastao()[0]).toBe(ladoJanete());
    fireEvent.click(ladoPessoa());
    expect(botoesBastao()[0]).toBe(ladoPessoa());
    expect(botoesBastao()[0]).toHaveAccessibleName("Você atendendo. Esta conversa está com você");
    fireEvent.click(ladoJanete());
    expect(botoesBastao()[0]).toBe(ladoJanete());
    expect(botoesBastao()[0]).toHaveAccessibleName("Janete atendendo. Esta conversa está com a Janete");
  });

  it("a troca anima o deslocamento com element.animate; com 'reduzir movimento', não anima", () => {
    // O jsdom não tem layout nem element.animate: a posição vem da ordem no grupo (100 px cada).
    const animate = vi.fn();
    const proto = HTMLElement.prototype as unknown as { animate: unknown };
    const antesAnimate = proto.animate;
    const antesRect = HTMLElement.prototype.getBoundingClientRect;
    proto.animate = animate;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const i = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      return { left: i * 100, top: 0, right: i * 100 + 90, bottom: 32, width: 90, height: 32, x: i * 100, y: 0 } as DOMRect;
    };
    try {
      largura(1440);
      montar("fernando");
      fireEvent.click(ladoPessoa());
      expect(animate).toHaveBeenCalledTimes(2);
      const deslocamentos = animate.mock.calls.map((c) => (c[0] as { transform: string }[])[0]!.transform).sort();
      expect(deslocamentos).toEqual(["translateX(-100px)", "translateX(100px)"]);
      expect((animate.mock.calls[0]![1] as KeyframeAnimationOptions).duration).toBe(250);
      cleanup();

      animate.mockClear();
      largura(1440, true);
      montar("fernando");
      fireEvent.click(ladoPessoa());
      expect(botoesBastao()[0]).toBe(ladoPessoa());
      expect(animate).not.toHaveBeenCalled();
    } finally {
      proto.animate = antesAnimate;
      HTMLElement.prototype.getBoundingClientRect = antesRect;
      largura(1440);
    }
  });

  it("depois de assumir e de devolver, o foco vai para o campo de texto", async () => {
    montar("ricardo");
    act(() => ladoPessoa().focus());
    fireEvent.click(ladoPessoa());
    await waitFor(() => expect(campo()).toHaveFocus());

    act(() => ladoJanete().focus());
    fireEvent.click(ladoJanete());
    await waitFor(() => expect(campo()).toHaveFocus());
    expect(bastao()).toHaveAttribute("data-estado", "janete");
  });

  it("assumir: a pessoa vai para a frente, entra a linha de passagem e o leitor de tela ouve (sem faixa)", async () => {
    montar("ricardo");
    fireEvent.click(ladoPessoa());

    expect(bastao()).toHaveAttribute("data-estado", "humano");
    expect(ladoPessoa()).toBeDisabled();
    expect(ladoPessoa()).toHaveAccessibleName("Você atendendo. Esta conversa está com você");
    expect(ladoJanete()).toBeEnabled();
    expect(estadoCab()).toHaveTextContent(comeca(empresaDe("ricardo")));
    expect(within(log()).getByText("Você assumiu a conversa")).toBeInTheDocument();
    expect(fraseDa(passagem("Você assumiu a conversa")!)).toMatch(
      /^Você assumiu a conversa às \d{2}:\d{2}\. A conversa esperava atendimento\.$/,
    );
    // quem olha aparece como "VC" no bastão e na passagem (como na lista e no protótipo)
    expect(ladoPessoa()).toHaveTextContent("VC");
    expect(ladoPessoa()).not.toHaveTextContent("AD");
    expect(passagem("Você assumiu a conversa")).toHaveTextContent("VC");
    // sem o aviso da tela, a frase vai para o leitor de tela (um instante depois, para poder repetir)
    expect(
      await screen.findByText("Você assumiu a conversa. A conversa esperava atendimento e agora está com você."),
    ).toHaveAttribute("role", "status");

    // com você: nenhuma faixa sobre a caixa (nem a verde com "Ok")
    expect(screen.queryByRole("button", { name: "Ok" })).not.toBeInTheDocument();
    expect(temFaixa()).toBe(false);
  });

  it("assumir de outra pessoa: a passagem diz de quem veio", async () => {
    montar("patricia");
    fireEvent.click(ladoPessoa());
    expect(bastao()).toHaveAttribute("data-estado", "humano");
    expect(ladoPessoa()).toHaveAccessibleName("Você atendendo. Esta conversa está com você");
    expect(fraseDa(passagem("Você assumiu a conversa")!)).toMatch(/\. A conversa estava com Marina\.$/);
    expect(await screen.findByText("Você assumiu a conversa. A conversa passou de Marina para você.")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("esperando há mais de 10 min, o estado do cabeçalho fica vermelho (data-longa) com o relógio", () => {
    montar("juliana", {
      ajustar: (e) => ({
        ...e,
        conversas: e.conversas.map((c) =>
          c.id === idConversa("juliana")
            ? { ...c, aguardando_humano_desde: new Date(Date.now() - 25 * 60_000).toISOString() }
            : c,
        ),
      }),
    });
    expect(bastao()).toHaveAttribute("data-estado", "espera");
    expect(estadoCab()).toHaveAttribute("data-tom", "espera");
    expect(estadoCab()).toHaveAttribute("data-longa");
    expect(estadoCab().querySelector("svg.lucide-clock")).not.toBeNull();
  });

  it("devolver: a Janete volta e entra a passagem 'Você devolveu para a Janete'", async () => {
    montar("patricia");
    fireEvent.click(ladoJanete());

    expect(bastao()).toHaveAttribute("data-estado", "janete");
    expect(ladoJanete()).toBeDisabled();
    expect(within(log()).getByText("Você devolveu para a Janete")).toBeInTheDocument();
    // na passagem, quem devolveu aparece como "VC" (como na lista), não pelas iniciais do nome
    expect(within(log()).getByText("Você devolveu para a Janete").closest('[role="note"]')).toHaveTextContent(/^VC/);
    expect(fraseDa(passagem("Você devolveu para a Janete")!)).toMatch(
      /^Você devolveu para a Janete às \d{2}:\d{2}\. A Janete voltou a atender\.$/,
    );
    expect(await screen.findByText("A Janete voltou a atender Patrícia.")).toHaveAttribute("role", "status");
    // com a Janete: nenhuma faixa
    expect(temFaixa()).toBe(false);
  });

  it("devolver uma conversa parada por falha pede confirmação (Esc cancela)", () => {
    montar("juliana");
    fireEvent.click(ladoJanete());
    const dlg = screen.getByRole("alertdialog", { name: "Devolver para a Janete mesmo assim?" });
    expect(dlg).toHaveAccessibleDescription(/sem crédito/);
    expect(dlg).toHaveFocus();
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(bastao()).toHaveAttribute("data-estado", "espera");

    fireEvent.click(ladoJanete());
    fireEvent.click(screen.getByRole("button", { name: "Devolver mesmo assim" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(bastao()).toHaveAttribute("data-estado", "janete");
  });
});

describe("Conversa: responder", () => {
  it("responder sem assumir: a mensagem sai, a Janete sai, entra a passagem e o leitor de tela ouve", async () => {
    montar("fernando");
    expect(temFaixa()).toBe(false);

    escrever("Oi, Fernando. Aqui é da equipe.");

    expect(within(log()).getByText("Oi, Fernando. Aqui é da equipe.")).toBeInTheDocument();
    expect(bastao()).toHaveAttribute("data-estado", "humano");
    expect(ladoPessoa()).toHaveAccessibleName("Você atendendo. Esta conversa está com você");
    expect(within(log()).getByText("Você assumiu a conversa")).toBeInTheDocument();
    expect(fraseDa(passagem("Você assumiu a conversa")!)).toMatch(
      /^Você assumiu a conversa às \d{2}:\d{2}\. Ao enviar uma mensagem\. A Janete saiu da conversa\.$/,
    );
    // sem a faixa verde com "Ok": quem avisa é a passagem e o role="status"
    expect(await screen.findByText("Você assumiu a conversa.")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("button", { name: "Ok" })).not.toBeInTheDocument();
    expect(temFaixa()).toBe(false);
    // a Janete parou de digitar
    expect(within(log()).queryByText("A Janete está digitando")).not.toBeInTheDocument();
  });

  it("responder numa conversa que já é sua não repete o aviso", () => {
    montar("sergio");
    expect(bastao()).toHaveAttribute("data-estado", "humano");
    escrever("Combinado.");
    expect(within(log()).getByText("Combinado.")).toBeInTheDocument();
    expect(screen.queryByText(/^Você assumiu a conversa\./)).not.toBeInTheDocument();
  });

  it("janela de 24 h fechada (API oficial): a caixa fica bloqueada e nada sai", () => {
    montar("fernando", {
      ajustar: (e) => ({
        ...e,
        conexao: e.conexao && { ...e.conexao, gateway: "meta", oficial: true },
        conversas: e.conversas.map((c) =>
          c.id === idConversa("fernando")
            ? { ...c, ultima_do_lead_em: new Date(Date.now() - 30 * 3_600_000).toISOString() }
            : c,
        ),
      }),
    });
    expect(screen.getByText(/^Janela de 24 h fechada/)).toBeInTheDocument();
    expect(campo()).toBeDisabled();
    // o bastão segue com a Janete
    expect(bastao()).toHaveAttribute("data-estado", "janete");
  });

  it("sem conexão: a faixa avisa e 'Reconectar' libera a caixa", () => {
    montar("fernando", {
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, status: "desconectada" } }),
    });
    expect(screen.getByText(/^WhatsApp desconectado/)).toBeInTheDocument();
    expect(campo()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    expect(screen.queryByText(/^WhatsApp desconectado/)).not.toBeInTheDocument();
    expect(campo()).toBeEnabled();
  });

  it("conexão desligada na Configuração: o 'Reconectar' do admin leva para a Configuração", () => {
    navegar.mockClear();
    montar("fernando", {
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, ativa: false, status: "desconectada" } }),
    });
    expect(screen.getByText(/^WhatsApp desconectado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    expect(navegar).toHaveBeenCalledWith({ to: "/app/configuracao" });
    expect(campo()).toBeDisabled();
  });

  it("conexão desligada, como atendente: a faixa explica e pede um admin (sem 'Reconectar')", () => {
    montar("fernando", {
      papel: "atendente",
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, ativa: false, status: "desconectada" } }),
    });
    expect(
      screen.getByText("WhatsApp desconectado: nenhuma mensagem sai daqui até reconectar. Peça a um admin para reconectar."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconectar" })).not.toBeInTheDocument();
  });

  it("sem nenhuma conexão, como atendente: também pede um admin", () => {
    montar("fernando", {
      papel: "atendente",
      ajustar: (e) => ({ ...e, conexao: null }),
    });
    expect(screen.getByText(/^WhatsApp desconectado.*Peça a um admin para reconectar\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconectar" })).not.toBeInTheDocument();
  });

  it("conexão caída, como atendente: o 'Reconectar' do exemplo continua, sem o pedido ao admin", async () => {
    montar("fernando", {
      papel: "atendente",
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, status: "desconectada" } }),
    });
    expect(screen.getByText("WhatsApp desconectado: nenhuma mensagem sai daqui até reconectar.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    // o aviso não manda o atendente para a Configuração, que ele não vê
    expect(await screen.findByText("Reconectado no exemplo. No app, quem reconecta é um admin.")).toBeInTheDocument();
    expect(screen.queryByText(/reconexão é feita na Configuração/)).not.toBeInTheDocument();
  });

  it("conexão caída, como admin: o aviso do 'Reconectar' aponta para a Configuração", async () => {
    montar("fernando", {
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, status: "desconectada" } }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    expect(
      await screen.findByText("Reconectado no exemplo. No app, a reconexão é feita na Configuração."),
    ).toBeInTheDocument();
  });

  it("conexão desligada, como admin: o 'Reconectar' fica, sem o pedido ao admin", () => {
    montar("fernando", {
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, ativa: false, status: "desconectada" } }),
    });
    expect(screen.queryByText(/Peça a um admin/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconectar" })).toBeInTheDocument();
  });
});

describe("Conversa: a faixa sobre a caixa", () => {
  it("só com outra pessoa atendendo e com a Janete parada por falha", () => {
    montar("patricia");
    expect(temFaixa()).toBe(true);
    expect(
      screen.getByText("Marina está atendendo. Se você enviar, a conversa continua com Marina."),
    ).toBeInTheDocument();
    cleanup();

    montar("juliana");
    expect(temFaixa()).toBe(true);
    expect(screen.getByText("Sem crédito de IA: a Janete parou. Ao responder, você assume.")).toBeInTheDocument();
  });

  it.each([
    ["com a Janete", "fernando"],
    ["esperando sem falha", "ricardo"],
    ["no celular", "carlos"],
    ["com você", "sergio"],
  ])("nenhuma faixa %s", (_caso, lead) => {
    montar(lead);
    expect(temFaixa()).toBe(false);
  });
});

describe("Conversa: a passagem", () => {
  it("sem cartão: uma linha com a rota, o texto curto e a hora; role=note com a frase inteira", () => {
    montar("ricardo");
    const nota = passagem("A Janete passou para um humano")!;
    // a frase está no conteúdo do note (só para o leitor de tela), não num aria-label; o que se vê fica escondido dele
    expect(nota).not.toHaveAttribute("aria-label");
    expect(within(nota).getByText(/^A Janete passou para um humano às /)).not.toHaveAttribute("aria-hidden");
    expect(nota.querySelector("svg.lucide-arrow-right")).not.toBeNull();
    expect(fraseDa(nota)).toMatch(/^A Janete passou para um humano às \d{2}:\d{2}\. Motivo: a Janete decidiu passar\.$/);
    expect(visivelDa(nota)).toMatch(/^A Janete pediu ajuda· \d{2}:\d{2}$/);
    expect(nota).not.toHaveAttribute("data-tom");
    // a rota é decorativa; a hora vai em mono
    expect(nota.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // sem cartão: nenhum parágrafo de "Motivo:" visível
    expect(within(log()).queryByText(/^Motivo:/)).not.toBeInTheDocument();
  });

  it("na falha da IA, o texto curto vem em vermelho (data-tom='falha')", () => {
    montar("juliana");
    const nota = passagem("A Janete passou para um humano")!;
    expect(nota).toHaveAttribute("data-tom", "falha");
    expect(visivelDa(nota)).toMatch(/^Sem crédito de IA/);
    expect(fraseDa(nota)).toMatch(/Motivo: acabou o crédito da chave de IA\.$/);
  });

  it("celular: 'Respondida pelo celular'", () => {
    montar("carlos");
    const nota = passagem("A conversa foi respondida pelo celular")!;
    expect(visivelDa(nota)).toMatch(/^Respondida pelo celular· \d{2}:\d{2}$/);
  });

  it("o CSS da passagem não tem cartão (sem fundo, borda nem sombra)", () => {
    // A conversa desenha as passagens de conversa_eventos com a peça comum (PassagemConversa).
    const css = readFileSync(path.resolve(__dirname, "../features/plataforma/comum/EventoConversa.module.css"), "utf-8");
    const bloco = /\.evPassagem\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(bloco).not.toMatch(/background|border|box-shadow/);
  });
});

describe("Conversa: a caixa de escrever ocupa a largura da coluna", () => {
  it("o limite de 1120 px vem do recheio da caixa, não de margem automática nos filhos (que encolhia a caixa)", () => {
    const css = readFileSync(path.resolve(__dirname, "../features/plataforma/chat/Conversa.module.css"), "utf-8");
    expect(css).not.toMatch(/\.cvEscrever > \*/);
    const regra = /\n\.cvEscrever \{([^}]*)\}/.exec(css)![1]!;
    expect(regra).toMatch(/padding-inline: max\(var\(--cv-pad\), calc\(\(100% - 1120px\) \/ 2\)\);/);
  });
});

describe("Conversa: o texto da caixa vazia e a bolinha da equipe (fundação da rodada 2)", () => {
  it("com a Janete, esperando sem falha e no celular, a caixa vazia avisa que enviar troca de mãos", () => {
    for (const lead of ["fernando", "ricardo", "carlos"]) {
      const { unmount } = montar(lead);
      expect(campo().getAttribute("placeholder")).toMatch(/^Escreva para \S+ · você assume ao enviar$/);
      expect(temFaixa()).toBe(false);
      unmount();
    }
  });

  it("com você, com outra pessoa e na falha, fica o texto padrão (a faixa, quando há, já explica)", () => {
    for (const lead of ["sergio", "patricia", "thiago"]) {
      const { unmount } = montar(lead);
      expect(campo().getAttribute("placeholder")).toMatch(/^Escreva para \S+$/);
      unmount();
    }
  });

  it("a bolinha do balão da equipe: VC para quem olha, as iniciais para os outros", () => {
    const { unmount } = montar("sergio");
    const minhas = within(log()).getAllByText("VC", { selector: "[data-quem='equipe']" });
    expect(minhas.length).toBeGreaterThan(0);
    unmount();
    montar("patricia");
    expect(within(log()).getAllByText("MA", { selector: "[data-quem='equipe']" }).length).toBeGreaterThan(0);
  });
});

describe("Conversa: a etapa fica na ficha (A16)", () => {
  it("sem as linhas 'moveu para', e um separador de dia só nos dias com mensagem ou passagem", () => {
    montar("sergio");
    expect(within(log()).queryByText(/moveu para/)).toBeNull();
    const e = criarEstadoInicial(new Date());
    const cv = idConversa("sergio");
    const dias = new Set([
      ...e.mensagens.filter((m) => m.conversa_id === cv).map((m) => diaLocal(m.momento)),
      ...e.eventos.filter((ev) => ev.conversa_id === cv).map((ev) => diaLocal(ev.criado_em)),
    ]);
    // o Sérgio tem mudanças de etapa em dias sem mensagem: antes, cada uma ganhava um separador
    const comEtapa = new Set([
      ...dias,
      ...e.historico.filter((h) => h.contato_id === idContato("sergio")).map((h) => diaLocal(h.criado_em)),
    ]);
    expect(comEtapa.size).toBeGreaterThan(dias.size);
    expect(within(log()).getAllByRole("separator")).toHaveLength(dias.size);
  });
});

describe("Conversa: marcar como lida", () => {
  it("abrir a conversa zera as não lidas", () => {
    const e = criarEstadoInicial(new Date());
    expect(e.conversas.find((c) => c.id === idConversa("juliana"))!.nao_lidas).toBeGreaterThan(0);
    montar("juliana");
    expect(screen.getByTestId("nao-lidas")).toHaveTextContent("0");
  });

  it("como atendente, o admin aparece pelo nome e quem atende é a própria Marina", () => {
    montar("patricia", { papel: "atendente" });
    expect(ladoPessoa()).toHaveAccessibleName("Você atendendo. Esta conversa está com você");
    expect(ladoPessoa()).toBeDisabled();
  });
});

describe("Conversa: teclado nas mensagens", () => {
  it("só a última mensagem é parada de Tab; as setas andam entre elas", async () => {
    montar("ricardo");
    const msgs = within(log()).getAllByRole("article");
    const ultima = msgs[msgs.length - 1]!;
    expect(ultima).toHaveAttribute("tabindex", "0");
    expect(msgs.filter((m) => m.getAttribute("tabindex") === "0")).toHaveLength(1);
    await act(async () => ultima.focus());
    fireEvent.keyDown(ultima, { key: "ArrowUp" });
    expect(msgs[msgs.length - 2]).toHaveFocus();
  });
});

/* =============================================================================
   Integração com a TelaChat (sem dublê): o botão da ficha, o bastão e o voltar do celular
   ============================================================================= */

// Quinta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");

/**
 * Simula a largura da janela para as media queries (min-width e max-width), como no t1-chat, e o
 * "reduzir movimento" (desligado por padrão).
 */
function largura(px: number, reduzirMovimento = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches = /prefers-reduced-motion/.test(query)
        ? reduzirMovimento
        : (!min || px >= Number(min[1])) && (!max || px <= Number(max[1]));
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

/** As ações do exemplo, para simular o que chega de fora (a mensagem do lead) com a tela montada. */
const acoesTela: { atual: AcoesExemplo | null } = { atual: null };
function CapturarAcoes() {
  const { acoes } = useExemplo();
  useEffect(() => {
    acoesTela.atual = acoes;
  });
  return null;
}

function montarTela(px: number, inicial?: EstadoBase, conversaInicial?: string) {
  largura(px);
  return render(
    <ProvedorPapel inicial="admin">
      <ProvedorDados exemplo={() => inicial ?? criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => AGORA}>
        <TelaChat conversaInicial={conversaInicial} />
        <CapturarAcoes />
      </ProvedorDados>
    </ProvedorPapel>,
  );
}

/**
 * O estado com as 2 primeiras da lista com 2 não lidas cada (a 1ª é a que abre sozinha; a 2ª, a que
 * abre sozinha depois de apagar a 1ª), com os nomes e os contatos delas.
 */
function estadoComDuasNaoLidas() {
  const base = criarEstadoInicial(AGORA);
  const [a, b] = ordemDaLista(base) as [string, string];
  const e = { ...base, conversas: base.conversas.map((c) => (c.id === a || c.id === b ? { ...c, nao_lidas: 2 } : c)) };
  const dados = (cv: string) => {
    const contatoId = e.conversas.find((c) => c.id === cv)!.contato_id;
    return { id: cv, contatoId, nome: e.contatos.find((x) => x.id === contatoId)!.nome! };
  };
  return { e, A: dados(a), B: dados(b) };
}
const naoLida = (nome: string) => /não lida/.test(linhaDe(nome).getAttribute("aria-label") ?? "");
const leadEscreve = (conversaId: string) =>
  act(() => {
    acoesTela.atual!.simularJanete({ tipo: "lead_mensagem", conversaId, mensagem: { tipo: "texto", texto: "Oi de novo" } });
  });
/** Apaga pela ficha, como quem usa: o "Apagar contato" e a confirmação. */
/** As ações da camada de dados são assíncronas: espera a resposta delas chegar à tela. */
async function esperarAcoes() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function apagarPelaFicha() {
  fireEvent.click(screen.getByRole("button", { name: "Apagar contato" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Apagar contato" }));
  await esperarAcoes();
}

const nomeNaTela = (lead: string) => criarEstadoInicial(AGORA).contatos.find((c) => c.id === idContato(lead))!.nome!;
const linhaDe = (nome: string) => screen.getByRole("button", { name: new RegExp(`^${nome}[,.]`) });
/** Roda os setTimeout(0) que movem o foco. */
const rodarTimers = () =>
  act(() => {
    vi.advanceTimersByTime(1);
  });

describe("integração com a TelaChat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });

  it("1440 px: o botão da ficha (aria-expanded) fecha a coluna e o foco volta para ele", () => {
    montarTela(1440);
    const fechar = screen.getByRole("button", { name: "Ficha do lead", expanded: true });
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    // com a ficha aberta, só o X dela se chama "Fechar a ficha do lead"
    expect(screen.getAllByRole("button", { name: "Fechar a ficha do lead" })).toHaveLength(1);
    fireEvent.click(fechar);
    expect(screen.queryByRole("complementary")).toBeNull();
    const abrir = screen.getByRole("button", { name: "Ficha do lead" });
    expect(abrir).toHaveAttribute("aria-expanded", "false");

    // reabre e fecha pelo X da própria ficha: o foco não cai no body
    fireEvent.click(abrir);
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Fechar a ficha do lead" }));
    rodarTimers();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("button", { name: "Ficha do lead", expanded: false })).toHaveFocus();
  });

  it("assumir pelo bastão troca a situação da linha da lista, sem toast (o leitor de tela ouve)", async () => {
    montarTela(1440);
    const nome = nomeNaTela("ricardo");
    fireEvent.click(linhaDe(nome));
    // a ficha segue aberta, com o resumo da Janete
    expect(within(screen.getByRole("complementary")).getByText("O que a Janete já descobriu")).toBeInTheDocument();
    expect(linhaDe(nome).getAttribute("aria-label")).not.toMatch(/Com você/);

    fireEvent.click(ladoPessoa());
    await esperarAcoes();
    expect(linhaDe(nome).getAttribute("aria-label")).toMatch(/Com você/);
    // sem o aviso flutuante (o toast da TelaChat)
    expect(screen.queryByRole("button", { name: "Fechar o aviso" })).not.toBeInTheDocument();
    // o leitor de tela continua ouvindo (um instante depois), e a linha de passagem diz para quem enxerga
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(
      screen.getByText("Você assumiu a conversa. A conversa esperava atendimento e agora está com você."),
    ).toHaveAttribute("role", "status");
    expect(within(log()).getByText("Você assumiu a conversa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ok" })).not.toBeInTheDocument();
    // o foco vai para o campo
    rodarTimers();
    expect(campo()).toHaveFocus();
  });

  it("abrir uma conversa com não lidas zera o contador", () => {
    const e = criarEstadoInicial(AGORA);
    const comNovas = e.conversas.find((c) => c.nao_lidas > 0 && c.id !== ordemDaLista(e)[0])!;
    const nome = e.contatos.find((x) => x.id === comNovas.contato_id)!.nome!;
    montarTela(1440, e);
    expect(linhaDe(nome).getAttribute("aria-label")).toMatch(/não lida/);
    fireEvent.click(linhaDe(nome));
    expect(linhaDe(nome).getAttribute("aria-label")).not.toMatch(/não lida/);
  });

  it("ao entrar no Chat, a conversa que abre sozinha continua não lida até alguém mexer nela (A26)", () => {
    const base = criarEstadoInicial(AGORA);
    const primeira = ordemDaLista(base)[0]!;
    const e = { ...base, conversas: base.conversas.map((c) => (c.id === primeira ? { ...c, nao_lidas: 2 } : c)) };
    const contatoId = e.conversas.find((c) => c.id === primeira)!.contato_id;
    const nome = e.contatos.find((x) => x.id === contatoId)!.nome!;
    montarTela(1440, e);
    rodarTimers();
    expect(linhaDe(nome)).toHaveAttribute("aria-current", "true");
    expect(linhaDe(nome).getAttribute("aria-label")).toMatch(/2 mensagens não lidas/);
    // a 1ª interação dentro dela (um clique na conversa) marca como lida
    fireEvent.pointerDown(screen.getByRole("log"));
    expect(linhaDe(nome).getAttribute("aria-label")).not.toMatch(/não lida/);
  });

  it("aberta pelo endereço (?conversa=), a conversa vira lida na hora (A26)", () => {
    const e = criarEstadoInicial(AGORA);
    const outra = e.conversas.find((c) => c.nao_lidas > 0 && c.id !== ordemDaLista(e)[0])!;
    const nome = e.contatos.find((x) => x.id === outra.contato_id)!.nome!;
    montarTela(1440, e, outra.id);
    rodarTimers();
    expect(linhaDe(nome)).toHaveAttribute("aria-current", "true");
    expect(linhaDe(nome).getAttribute("aria-label")).not.toMatch(/não lida/);
  });

  it("A26: sem mexer, a mensagem nova fica não lida; depois de mexer (a roda do mouse), já chega lida", () => {
    const { e, A } = estadoComDuasNaoLidas();
    montarTela(1440, e);
    rodarTimers();
    leadEscreve(A.id);
    expect(linhaDe(A.nome).getAttribute("aria-label")).toMatch(/3 mensagens não lidas/);
    fireEvent.wheel(screen.getByRole("log"));
    expect(naoLida(A.nome)).toBe(false);
    leadEscreve(A.id);
    expect(naoLida(A.nome)).toBe(false);
  });

  it("A26: fechar a ficha pelo X não marca a que abriu sozinha (o foco no botão da ficha é do programa)", () => {
    const { e, A } = estadoComDuasNaoLidas();
    montarTela(1440, e);
    rodarTimers();
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Fechar a ficha do lead" }));
    rodarTimers();
    expect(screen.getByRole("button", { name: "Ficha do lead", expanded: false })).toHaveFocus();
    expect(naoLida(A.nome)).toBe(true);
    // o foco que a pessoa põe (o Tab chegando no campo) conta
    act(() => campo().focus());
    expect(naoLida(A.nome)).toBe(false);
  });

  it("A26: aberta pela lista e apagada pela ficha, a próxima abre sozinha e espera a 1ª interação", async () => {
    const { e, A, B } = estadoComDuasNaoLidas();
    montarTela(1440, e);
    rodarTimers();
    fireEvent.click(linhaDe(A.nome));
    expect(naoLida(A.nome)).toBe(false);
    await apagarPelaFicha();
    rodarTimers();
    expect(screen.queryByRole("button", { name: new RegExp(`^${A.nome}[,.]`) })).toBeNull();
    // o foco foi para a linha da próxima, fora da conversa: não conta
    expect(linhaDe(B.nome)).toHaveFocus();
    expect(linhaDe(B.nome)).toHaveAttribute("aria-current", "true");
    expect(linhaDe(B.nome).getAttribute("aria-label")).toMatch(/2 mensagens não lidas/);
    fireEvent.pointerDown(screen.getByRole("log"));
    expect(naoLida(B.nome)).toBe(false);
  });

  it("A26: mexer na que abriu sozinha e apagá-la pela ficha não passa a interação para a próxima", async () => {
    const { e, A, B } = estadoComDuasNaoLidas();
    montarTela(1440, e);
    rodarTimers();
    fireEvent.pointerDown(screen.getByRole("log"));
    expect(naoLida(A.nome)).toBe(false);
    await apagarPelaFicha();
    rodarTimers();
    expect(linhaDe(B.nome)).toHaveAttribute("aria-current", "true");
    expect(naoLida(B.nome)).toBe(true);
  });

  it("A26: a mesma conversa que volta a abrir sozinha (depois de apagar a aberta) espera a interação de novo", async () => {
    const { e, A, B } = estadoComDuasNaoLidas();
    montarTela(1440, e);
    rodarTimers();
    // mexe na 1ª, abre a 2ª pela lista, chega mensagem na 1ª (que volta ao topo)
    fireEvent.pointerDown(screen.getByRole("log"));
    fireEvent.click(linhaDe(B.nome));
    leadEscreve(A.id);
    expect(naoLida(A.nome)).toBe(true);
    // apaga a 2ª pela ficha: a 1ª reabre sozinha e continua não lida
    await apagarPelaFicha();
    rodarTimers();
    expect(linhaDe(A.nome)).toHaveAttribute("aria-current", "true");
    expect(naoLida(A.nome)).toBe(true);
    fireEvent.keyDown(screen.getByRole("log"), { key: "ArrowUp" });
    expect(naoLida(A.nome)).toBe(false);
  });

  it("A26, 900 a 1279 px: apagar pela gaveta não conta o foco que ela devolve ao botão da ficha", async () => {
    const { e, A, B } = estadoComDuasNaoLidas();
    montarTela(1000, e);
    rodarTimers();
    // a pessoa abre a gaveta pelo botão da ficha (o foco e o clique contam na 1ª)
    const botao = screen.getByRole("button", { name: "Ficha do lead", expanded: false });
    act(() => botao.focus());
    fireEvent.click(botao);
    expect(naoLida(A.nome)).toBe(false);
    await apagarPelaFicha();
    rodarTimers();
    expect(linhaDe(B.nome)).toHaveAttribute("aria-current", "true");
    expect(naoLida(B.nome)).toBe(true);
  });

  it("A26: a interação vale mesmo se a conversa remontar (mexeu, foi para o celular e voltou)", () => {
    const { e, A } = estadoComDuasNaoLidas();
    montarTela(1440, e);
    rodarTimers();
    fireEvent.pointerDown(screen.getByRole("log"));
    expect(naoLida(A.nome)).toBe(false);
    // celular sem tela cheia: a conversa desmonta (uma mudança qualquer no estado faz a tela ler a largura)
    largura(600);
    act(() => {
      acoesTela.atual!.simularJanete({ tipo: "janete_digitando", conversaId: A.id, digitando: true });
    });
    expect(screen.queryByRole("log")).toBeNull();
    largura(1440);
    act(() => {
      acoesTela.atual!.simularJanete({ tipo: "janete_digitando", conversaId: A.id, digitando: false });
    });
    expect(screen.getByRole("log")).toBeInTheDocument();
    leadEscreve(A.id);
    expect(naoLida(A.nome)).toBe(false);
  });

  it("A26: no celular sem tocar em nada e depois no computador, a 1ª abre sozinha e fica não lida", () => {
    const { e, A } = estadoComDuasNaoLidas();
    montarTela(600, e);
    rodarTimers();
    expect(screen.queryByRole("log")).toBeNull();
    largura(1440);
    act(() => {
      acoesTela.atual!.simularJanete({ tipo: "janete_digitando", conversaId: A.id, digitando: true });
    });
    expect(screen.getByRole("log")).toBeInTheDocument();
    expect(naoLida(A.nome)).toBe(true);
  });

  it("devolver com confirmação: o véu fica no body e o Cancelar devolve o foco ao bastão", async () => {
    montarTela(1440);
    fireEvent.click(linhaDe(nomeNaTela("juliana")));
    const janete = ladoJanete();
    act(() => janete.focus());
    fireEvent.click(janete);
    const dlg = screen.getByRole("alertdialog", { name: "Devolver para a Janete mesmo assim?" });
    // fora da coluna da conversa: o véu cobre o app inteiro
    expect(dlg.closest("[data-chat-lista]")).toBeNull();
    expect(log().contains(dlg)).toBe(false);
    expect(dlg.parentElement!.parentElement).toBe(document.body);
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar" }));
    rodarTimers();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(ladoJanete()).toHaveFocus();

    // devolver de verdade: sem toast; o leitor de tela ouve
    fireEvent.click(ladoJanete());
    fireEvent.click(screen.getByRole("button", { name: "Devolver mesmo assim" }));
    await esperarAcoes();
    expect(screen.queryByRole("button", { name: "Fechar o aviso" })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText(/^A Janete voltou a atender /)).toHaveAttribute("role", "status");
    expect(within(log()).getByText("Você devolveu para a Janete")).toBeInTheDocument();
  });

  it("celular: abrir leva o foco ao voltar, sem o selo Exemplo, e voltar devolve o foco à linha", () => {
    montarTela(390);
    const nome = nomeNaTela("ricardo");
    fireEvent.click(linhaDe(nome));
    rodarTimers();
    const voltar = screen.getByRole("button", { name: "Voltar para a lista de conversas" });
    expect(voltar).toHaveFocus();
    // o selo Exemplo saiu de todas as telas (30/10): o cabeçalho fica com o nome e a linha de estado
    const cab = voltar.closest("header")!;
    expect(within(cab).queryByText("Exemplo")).toBeNull();
    // no celular, sem a foto do lead: o voltar e o nome bastam
    expect(cab.querySelector("[data-tamanho]")).toBeNull();
    expect(within(cab).getByRole("heading", { level: 2 })).toHaveTextContent(comeca(nome));
    // numa linha: o bastão e o botão da ficha também moram no <header>
    expect(within(cab).getByRole("group", { name: "Quem conduz a conversa" })).toBeInTheDocument();
    expect(within(cab).getByRole("button", { name: "Ficha do lead" })).toHaveAttribute("aria-expanded");
    // a lista por baixo sai do Tab
    expect(document.querySelector("[data-chat-lista]")).toHaveAttribute("inert");

    fireEvent.click(voltar);
    rodarTimers();
    expect(screen.queryByRole("button", { name: "Voltar para a lista de conversas" })).toBeNull();
    expect(document.querySelector("[data-chat-lista]")).not.toHaveAttribute("inert");
    expect(linhaDe(nome)).toHaveFocus();
  });
});

/* =============================================================================
   Rodada 2, revisão (corretor): duplo clique, anúncio, filtros, foco e o "digitando"
   ============================================================================= */

/** Espiona element.animate e dá a cada botão a posição pela ordem no grupo (o jsdom não tem layout). */
function espionarAnimacao() {
  const animate = vi.fn();
  const proto = HTMLElement.prototype as unknown as { animate: unknown };
  const antesAnimate = proto.animate;
  const antesRect = HTMLElement.prototype.getBoundingClientRect;
  proto.animate = animate;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const i = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
    return { left: i * 100, top: 0, right: i * 100 + 90, bottom: 32, width: 90, height: 32, x: i * 100, y: 0 } as DOMRect;
  };
  return {
    animate,
    restaurar() {
      proto.animate = antesAnimate;
      HTMLElement.prototype.getBoundingClientRect = antesRect;
    },
  };
}

describe("Conversa: o bastão não desfaz a escolha num duplo clique", () => {
  it("Assumir com um duplo clique: o 2º clique, no 'Devolver' que chegou ao lugar, é ignorado", () => {
    montar("fernando");
    fireEvent.click(ladoPessoa(), { detail: 1 });
    expect(bastao()).toHaveAttribute("data-estado", "humano");
    fireEvent.click(ladoJanete(), { detail: 2 });
    expect(bastao()).toHaveAttribute("data-estado", "humano");
  });

  it("Devolver com um duplo clique: o 2º clique, no 'Assumir', é ignorado", () => {
    montar("sergio");
    fireEvent.click(ladoJanete(), { detail: 1 });
    expect(bastao()).toHaveAttribute("data-estado", "janete");
    fireEvent.click(ladoPessoa(), { detail: 2 });
    expect(bastao()).toHaveAttribute("data-estado", "janete");
  });

  it("2 cliques simples em menos de 400 ms: o 2º é ignorado; depois deles, vale; o teclado passa sempre", () => {
    vi.useFakeTimers();
    montar("fernando");
    fireEvent.click(ladoPessoa(), { detail: 1 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.click(ladoJanete(), { detail: 1 });
    expect(bastao()).toHaveAttribute("data-estado", "humano");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(ladoJanete(), { detail: 1 });
    expect(bastao()).toHaveAttribute("data-estado", "janete");
    // Enter ou Espaço (detail 0) logo depois da troca: passa (o foco já foi para o campo)
    fireEvent.click(ladoPessoa(), { detail: 0 });
    expect(bastao()).toHaveAttribute("data-estado", "humano");
  });
});

describe("Conversa: o anúncio do leitor de tela", () => {
  it("dois 'Tentar de novo' seguidos: o anúncio é apagado e regravado, para ser lido de novo", async () => {
    // Decisão 8: só a mensagem da equipe pela tela tem "Tentar de novo"; as da Janete viram da equipe aqui.
    montar("ricardo", {
      ajustar: (e) => ({
        ...e,
        mensagens: e.mensagens.map((m) =>
          m.conversa_id === idConversa("ricardo") && m.origem === "janete"
            ? { ...m, origem: "humano_tela", autor_membro_id: e.membros[0]!.id, status: "falhou", erro: "falha_no_gateway" }
            : m,
        ),
      }),
    });
    const tentar = () => within(log()).getAllByRole("button", { name: "Tentar de novo" });
    expect(tentar().length).toBeGreaterThan(1);
    fireEvent.click(tentar()[0]!);
    await waitFor(() => expect(statusDaConversa()).toHaveTextContent("Reenviando a mensagem."));
    fireEvent.click(tentar()[0]!);
    // logo depois da resposta do 2º clique, o anúncio fica vazio; um instante depois, a mesma frase volta
    await esperarAcoes();
    expect(statusDaConversa()).toHaveTextContent(/^$/);
    await waitFor(() => expect(statusDaConversa()).toHaveTextContent("Reenviando a mensagem."));
  });

  it("o passo da espera: um 'Reconectar' sem o aviso da tela também vai para o leitor de tela, e some sozinho", async () => {
    vi.useFakeTimers();
    montar("fernando", {
      ajustar: (e) => ({ ...e, conexao: e.conexao && { ...e.conexao, status: "desconectada" } }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(statusDaConversa()).toHaveTextContent(/^Reconectado no exemplo/);
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(statusDaConversa()).toHaveTextContent(/^$/);
  });
});

describe("Conversa: o 'digitando' na linha da Janete", () => {
  const digitando = () => {
    const bolha = within(log()).getByText("A Janete está digitando").parentElement!;
    return { bolha, linha: bolha.parentElement! };
  };

  it("sem o nome em cima: a bolinha da Janete à direita quando a última mensagem não é dela", () => {
    montar("fernando");
    const { linha } = digitando();
    // nada visível além dos pontos: o nome "Janete" e o "digitando…" saíram
    expect(linha.textContent).toBe("A Janete está digitando");
    expect(linha.querySelector("[class*='cvDigitaQuem']")).not.toBeNull();
    expect(linha.querySelector("[class*='cvDigitaEsp']")).toBeNull();
    expect(linha).not.toHaveAttribute("data-agrupada");
  });

  it("continuando o grupo da Janete (a última mensagem é dela), fica só o espaço da bolinha", () => {
    montar("fernando", {
      ajustar: (e) => {
        const minhas = e.mensagens.filter((m) => m.conversa_id === idConversa("fernando"));
        const ultima = minhas[minhas.length - 1]!;
        return {
          ...e,
          mensagens: e.mensagens.map((m) =>
            m.id === ultima.id ? { ...m, origem: "janete", direcao: "saida", status: "lida", autor_membro_id: null } : m,
          ),
        };
      },
    });
    const { linha } = digitando();
    expect(linha.querySelector("[class*='cvDigitaEsp']")).not.toBeNull();
    expect(linha.querySelector("[class*='cvDigitaQuem']")).toBeNull();
    expect(linha).toHaveAttribute("data-agrupada");
  });
});

describe("Conversa: a passagem de outra pessoa para quem olha", () => {
  it("quem olha aparece como 'VC' na rota (não 'VO')", () => {
    montar("patricia", {
      ajustar: (e) => {
        const admin = e.membros.find((m) => m.papel === "admin")!;
        const marina = e.membros.find((m) => m.nome.startsWith("Marina"))!;
        return {
          ...e,
          eventos: [
            ...e.eventos,
            {
              id: "ev-teste-vc",
              conversa_id: idConversa("patricia"),
              tipo: "assumiu",
              membro_id: marina.id,
              motivo: null,
              de: "outro",
              de_membro_id: admin.id,
              por_envio: false,
              criado_em: new Date().toISOString(),
            },
          ],
        };
      },
    });
    const nota = passagem(/^Marina assumiu a conversa .*A conversa estava com /)!;
    expect(visivelDa(nota)).toMatch(/^VCMA/);
  });
});

describe("Conversa: o texto da caixa vazia pela largura do campo", () => {
  it("o longo quando cabe numa linha; o curto 'Você assume ao enviar' quando não cabe", () => {
    const RO = globalThis.ResizeObserver;
    const getContext = HTMLCanvasElement.prototype.getContext;
    let larguraCampo = 200;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    HTMLCanvasElement.prototype.getContext = (() => ({
      font: "",
      measureText: (t: string) => ({ width: t.length * 8 }),
    })) as unknown as typeof getContext;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => larguraCampo });
    try {
      // "Escreva para Fernando · você assume ao enviar": 45 letras x 8 = 360 px
      montar("fernando");
      expect(campo().getAttribute("placeholder")).toBe("Você assume ao enviar");
      cleanup();
      larguraCampo = 600;
      montar("fernando");
      expect(campo().getAttribute("placeholder")).toBe("Escreva para Fernando · você assume ao enviar");
    } finally {
      globalThis.ResizeObserver = RO;
      HTMLCanvasElement.prototype.getContext = getContext;
      delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
    }
  });
});

describe("Conversa: com a caixa bloqueada, o foco depois de assumir e devolver não cai no body", () => {
  const semConexao = (e: EstadoBase): EstadoBase => ({ ...e, conexao: e.conexao && { ...e.conexao, status: "desconectada" } });
  const janelaFechada = (e: EstadoBase): EstadoBase => ({
    ...e,
    conexao: e.conexao && { ...e.conexao, gateway: "meta", oficial: true },
    conversas: e.conversas.map((c) =>
      c.id === idConversa("fernando") ? { ...c, ultima_do_lead_em: new Date(Date.now() - 30 * 3_600_000).toISOString() } : c,
    ),
  });

  it("sem conexão: assumir e devolver levam o foco ao 'Reconectar' da faixa", async () => {
    montar("fernando", { ajustar: semConexao });
    const reconectar = () => screen.getByRole("button", { name: "Reconectar" });
    fireEvent.click(ladoPessoa());
    await waitFor(() => expect(document.activeElement).toBe(reconectar()));
    expect(reconectar()).toBeEnabled();
    fireEvent.click(ladoJanete());
    await waitFor(() => expect(bastao()).toHaveAttribute("data-estado", "janete"));
    await waitFor(() => expect(document.activeElement).toBe(reconectar()));
  });

  it("janela de 24 h fechada: depois de assumir, o 'Devolver à Janete'; depois de devolver, o 'Assumir'", async () => {
    montar("fernando", { ajustar: janelaFechada });
    expect(campo()).toBeDisabled();
    fireEvent.click(ladoPessoa());
    await waitFor(() => expect(document.activeElement).toBe(ladoJanete()));
    expect(ladoJanete()).toBeEnabled();
    expect(ladoJanete()).toHaveAccessibleName(/^Devolver à Janete/);
    fireEvent.click(ladoJanete());
    await waitFor(() => expect(document.activeElement).toBe(ladoPessoa()));
    expect(ladoPessoa()).toBeEnabled();
    expect(ladoPessoa()).toHaveAccessibleName(/^Assumir conversa/);
  });
});

describe("integração com a TelaChat (revisão da rodada 2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });

  const filtrar = (nome: RegExp) => {
    fireEvent.click(screen.getByRole("button", { name: /^Filtrar conversas/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: nome }));
  };

  it("trocar de conversa não anima o bastão; assumir na conversa nova anima", () => {
    const espia = espionarAnimacao();
    try {
      montarTela(1440);
      // a 1ª aberta (Aline) está com a Janete; o Thiago espera (a pessoa na frente)
      fireEvent.click(linhaDe(nomeNaTela("thiago")));
      expect(bastao()).toHaveAttribute("data-estado", "espera");
      fireEvent.click(linhaDe(nomeNaTela("aline")));
      expect(bastao()).toHaveAttribute("data-estado", "janete");
      expect(espia.animate).not.toHaveBeenCalled();
      fireEvent.click(ladoPessoa());
      expect(espia.animate).toHaveBeenCalledTimes(2);
    } finally {
      espia.restaurar();
    }
  });

  it("trocar de conversa troca o role=log (o leitor de tela não lê o histórico novo como mensagens novas)", () => {
    montarTela(1440);
    const antes = log();
    fireEvent.click(linhaDe(nomeNaTela("fernando")));
    expect(log()).not.toBe(antes);
    expect(log()).toHaveAccessibleName(`Conversa com ${nomeNaTela("fernando")}`);
  });

  it("o anúncio de assumir é apagado ao trocar de conversa e volta a ser lido na seguinte", async () => {
    montarTela(1440);
    const frase = "Você assumiu a conversa. A Janete saiu desta conversa e só volta se alguém devolver.";
    fireEvent.click(linhaDe(nomeNaTela("fernando")));
    fireEvent.click(ladoPessoa());
    await esperarAcoes();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(statusDaConversa()).toHaveTextContent(frase);
    fireEvent.click(linhaDe(nomeNaTela("aline")));
    expect(statusDaConversa()).toHaveTextContent(/^$/);
    fireEvent.click(ladoPessoa());
    await esperarAcoes();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(statusDaConversa()).toHaveTextContent(frase);
  });

  it("filtro 'Não lidas': a conversa aberta pela lista continua nela (e com o foco) até trocar de filtro", () => {
    montarTela(1440);
    filtrar(/^Não lidas/);
    const nome = nomeNaTela("juliana");
    act(() => linhaDe(nome).focus());
    fireEvent.click(linhaDe(nome));
    rodarTimers();
    // abrir marcou como lida, mas a linha fica e o foco nela
    expect(linhaDe(nome).getAttribute("aria-label")).not.toMatch(/não lida/);
    expect(document.activeElement).toBe(linhaDe(nome));
    expect(document.activeElement).not.toBe(document.body);
    // a etiqueta conta só as que passam no filtro (a fixada não entra)
    const naoLidas = Number(/(\d+)/.exec(screen.getByRole("button", { name: /Limpar o filtro/ }).getAttribute("aria-label")!)![1]);
    expect(naoLidas).toBe(
      Array.from(document.querySelectorAll("[data-chat-lista] button[id*='-ci-']")).filter((b) =>
        /não lida/.test(b.getAttribute("aria-label") ?? ""),
      ).length,
    );

    // outro filtro e de volta: a linha (já lida) sai
    filtrar(/^Comigo/);
    filtrar(/^Não lidas/);
    expect(screen.queryByRole("button", { name: new RegExp(`^${nome}[,.]`) })).toBeNull();
  });

  it("celular, 'Precisam de você': abrir, assumir e voltar deixa o foco numa linha da lista, nunca no body", () => {
    montarTela(390);
    filtrar(/^Precisam de você/);
    const nome = nomeNaTela("ricardo");
    fireEvent.click(linhaDe(nome));
    rodarTimers();
    fireEvent.click(ladoPessoa());
    rodarTimers();
    fireEvent.click(screen.getByRole("button", { name: "Voltar para a lista de conversas" }));
    rodarTimers();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement!.closest("[data-chat-lista]")).not.toBeNull();
    // a linha aberta continua à vista no filtro, e é ela que tem o foco
    expect(document.activeElement).toBe(linhaDe(nome));
  });

  it("celular, abrindo pelo endereço: a conversa em tela cheia com o foco no 'voltar' de verdade", () => {
    montarTela(390, undefined, idConversa("ricardo"));
    rodarTimers();
    expect(screen.getByRole("button", { name: "Voltar para a lista de conversas" })).toHaveFocus();
    expect(document.querySelector("[data-chat-lista]")).toHaveAttribute("inert");
  });
});
