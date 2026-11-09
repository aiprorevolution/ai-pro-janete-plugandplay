import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AvatarLead, corDoLead, CORES_LEAD } from "@/features/plataforma/comum/AvatarLead";
import { FecharGaveta, Gaveta } from "@/features/plataforma/comum/Gaveta";
import {
  LinhaConversa,
  nomeDoContato,
  resumoMensagem,
  situacaoDe,
  type ContatoDaLinha,
  type ConversaDaLinha,
  type MensagemDaLinha,
  type Situacao,
} from "@/features/plataforma/comum/LinhaConversa";
import { MenuSuspenso, type ItemMenu } from "@/features/plataforma/comum/MenuSuspenso";
import {
  dataCurta,
  dataLonga,
  diaLocal,
  diasEntre,
  duracao,
  esperaCompacta,
  esperaLonga,
  horaCurta,
  horaLista,
  mesmoDia,
  rotuloDia,
  segundosDesde,
  tempoRelativo,
} from "@/features/plataforma/comum/tempo";
import { criarEstadoInicial } from "@/features/plataforma/exemplo/dados";
import { corDoContato } from "@/features/plataforma/exemplo/regras";
import type { Contato, Conversa, Etapa, Membro, Mensagem } from "@/features/plataforma/exemplo/tipos";

/* Checagem de tipos (só o tsc a roda): os tipos da F1 (`exemplo/`) cabem nas props da linha. Se um
   divergir (por exemplo `duracaoS` com `null`), o tsc acusa aqui antes de o Chat ou o Kanban quebrar. */
export function _tiposDaF1CabemNaLinha(c: Conversa, k: Contato, m: Mensagem, e: Etapa, r: Membro) {
  const _c: ConversaDaLinha = c;
  const _k: ContatoDaLinha = k;
  const _m: MensagemDaLinha = m;
  return [_c, _k, _m, situacaoDe(c, { etapa: e, responsavel: r })] as const;
}

const PASTA = path.resolve(__dirname, "../features/plataforma/comum");
const css = (arquivo: string) => readFileSync(path.join(PASTA, arquivo), "utf-8");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* =============================================================================
   tempo.ts: tudo no fuso de São Paulo (UTC−3, sem horário de verão desde 2019)
   ============================================================================= */

describe("tempo: fuso de São Paulo", () => {
  it("hora e dia saem no relógio de São Paulo, não no UTC", () => {
    expect(horaCurta("2026-10-30T17:32:00Z")).toBe("14:32");
    expect(horaCurta("2026-10-31T03:00:00Z")).toBe("00:00");
    // 02:30 UTC do dia 31 ainda é 23:30 do dia 30 em São Paulo.
    expect(diaLocal("2026-10-31T02:30:00Z")).toBe("2026-10-30");
    expect(diaLocal("2026-10-31T03:00:00Z")).toBe("2026-10-31");
    expect(dataCurta("2026-10-31T02:30:00Z")).toBe("30/10");
    expect(dataCurta("2026-10-31T02:30:00Z", true)).toBe("30/10/2026");
  });

  it("virada de dia: 23:59 e 00:01 de São Paulo são dias diferentes, mesmo com 2 minutos de distância", () => {
    const antes = "2026-10-31T02:59:00Z"; // 23:59 de 30/10
    const depois = "2026-10-31T03:01:00Z"; // 00:01 de 31/10
    expect(mesmoDia(antes, depois)).toBe(false);
    expect(diasEntre(antes, depois)).toBe(1);
    expect(rotuloDia(antes, depois)).toBe("Ontem");
    expect(horaLista(antes, depois)).toBe("Ontem");
    expect(tempoRelativo(antes, depois)).toBe("ontem");
  });

  it("23:30 de São Paulo visto às 23:45 é hoje, embora já seja o dia seguinte em UTC", () => {
    const msg = "2026-10-31T02:30:00Z";
    const agora = "2026-10-31T02:45:00Z";
    expect(mesmoDia(msg, agora)).toBe(true);
    expect(rotuloDia(msg, agora)).toBe("Hoje");
    expect(horaLista(msg, agora)).toBe("23:30");
    expect(tempoRelativo(msg, agora)).toBe("há 15 min");
  });

  it("não depende do fuso da máquina", () => {
    const antes = process.env["TZ"];
    try {
      process.env["TZ"] = "Asia/Tokyo";
      expect(horaCurta("2026-10-30T17:32:00Z")).toBe("14:32");
      expect(diaLocal("2026-10-31T02:30:00Z")).toBe("2026-10-30");
      expect(rotuloDia("2026-10-31T02:59:00Z", "2026-10-31T03:01:00Z")).toBe("Ontem");
    } finally {
      if (antes === undefined) delete process.env["TZ"];
      else process.env["TZ"] = antes;
    }
  });

  it("rótulo de dia, hora da lista e data longa", () => {
    const agora = "2026-10-30T15:00:00Z"; // sexta, 30/10/2026, 12:00
    expect(rotuloDia("2026-10-26T15:00:00Z", agora)).toBe("Segunda, 26/10");
    expect(rotuloDia("2025-12-26T15:00:00Z", agora)).toBe("Sexta, 26/12/2025");
    expect(horaLista("2026-10-30T12:05:00Z", agora)).toBe("09:05");
    expect(horaLista("2026-10-26T15:00:00Z", agora)).toBe("Seg.");
    expect(horaLista("2026-10-12T15:00:00Z", agora)).toBe("12/10");
    expect(horaLista("2025-10-12T15:00:00Z", agora)).toBe("12/10/2025");
    expect(dataLonga("2026-10-26T15:00:00Z")).toBe("segunda-feira, 26 de outubro de 2026");
    // 01:00 UTC do dia 27 ainda é segunda, 26, às 22:00.
    expect(dataLonga("2026-10-27T01:00:00Z")).toBe("segunda-feira, 26 de outubro de 2026");
  });

  it("tempo relativo", () => {
    const agora = "2026-10-30T15:00:00Z";
    expect(tempoRelativo("2026-10-30T14:59:30Z", agora)).toBe("agora");
    expect(tempoRelativo("2026-10-30T15:05:00Z", agora)).toBe("agora");
    expect(tempoRelativo("2026-10-30T14:55:00Z", agora)).toBe("há 5 min");
    expect(tempoRelativo("2026-10-30T12:00:00Z", agora)).toBe("há 3 h");
    expect(tempoRelativo("2026-10-26T15:00:00Z", agora)).toBe("há 4 dias");
    expect(tempoRelativo("2026-10-12T15:00:00Z", agora)).toBe("12/10");
    expect(tempoRelativo("2025-10-12T15:00:00Z", agora)).toBe("12/10/2025");
  });

  it("durações e esperas", () => {
    expect(duracao(9)).toBe("0:09");
    expect(duracao(65)).toBe("1:05");
    expect(esperaCompacta(45)).toBe("45 s");
    expect(esperaCompacta(12 * 60 + 30)).toBe("12 min");
    expect(esperaCompacta(3900)).toBe("1 h 05");
    expect(esperaLonga(30)).toBe("menos de 1 min");
    expect(esperaLonga(3900)).toBe("1 h 5 min");
    expect(segundosDesde("2026-10-30T14:48:00Z", "2026-10-30T15:00:00Z")).toBe(720);
    expect(segundosDesde(null, "2026-10-30T15:00:00Z")).toBe(0);
    expect(segundosDesde("2026-10-30T15:10:00Z", "2026-10-30T15:00:00Z")).toBe(0);
  });

  it("valor que não é data vira texto vazio, sem lançar", () => {
    expect(horaCurta("ontem")).toBe("");
    expect(diaLocal("")).toBe("");
    expect(rotuloDia("x", "2026-10-30T15:00:00Z")).toBe("");
    expect(tempoRelativo("x", "2026-10-30T15:00:00Z")).toBe("");
    expect(Number.isNaN(diasEntre("x", "2026-10-30T15:00:00Z"))).toBe(true);
  });

  it("aceita Date e milissegundos", () => {
    const d = new Date("2026-10-30T17:32:00Z");
    expect(horaCurta(d)).toBe("14:32");
    expect(horaCurta(d.getTime())).toBe("14:32");
  });

  it("o código não usa toISOString nem os getters do fuso da máquina", () => {
    const codigo = css("tempo.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/toISOString\s*\(/);
    expect(codigo).not.toMatch(/\.get(Date|Day|Hours|Minutes|Month|FullYear)\s*\(/);
  });
});

/* =============================================================================
   AvatarLead
   ============================================================================= */

describe("AvatarLead", () => {
  it("mostra as iniciais do nome e é decorativo por padrão", () => {
    const { container } = render(<AvatarLead nome="Marina Werneck" />);
    const av = container.firstElementChild!;
    expect(av).toHaveTextContent("MW");
    expect(av).toHaveAttribute("aria-hidden", "true");
    expect(av).not.toHaveAttribute("data-com-selo");
    expect(screen.queryByTestId("avatar-selo")).toBeNull();
  });

  it("nome de 3 palavras: 1ª letra do primeiro e do último nome, como no protótipo", () => {
    const { container, rerender } = render(<AvatarLead nome="Carlos Eduardo Lima" />);
    expect(container.firstElementChild).toHaveTextContent("CL");
    rerender(<AvatarLead nome="Patrícia" />);
    expect(container.firstElementChild).toHaveTextContent("PA");
  });

  it("selo de membro com as iniciais de quem atende; sem iniciais, o ícone de pessoa", () => {
    const { rerender } = render(<AvatarLead nome="Marina Werneck" selo="membro" iniciaisMembro="rb" />);
    const selo = screen.getByTestId("avatar-selo");
    expect(selo).toHaveAttribute("data-selo", "membro");
    expect(selo).toHaveTextContent("RB");
    rerender(<AvatarLead nome="Marina Werneck" selo="membro" />);
    expect(screen.getByTestId("avatar-selo").querySelector("svg")).not.toBeNull();
  });

  it.each(["janete", "celular", "aguardando", "falha"] as const)("selo %s tem ícone e marca o avatar", (selo) => {
    const { container } = render(<AvatarLead nome="Ana" selo={selo} />);
    expect(container.firstElementChild).toHaveAttribute("data-com-selo");
    expect(screen.getByTestId("avatar-selo")).toHaveAttribute("data-selo", selo);
    if (selo === "janete") expect(screen.getByTestId("avatar-selo").querySelector('img')?.getAttribute('src')).toBe('/brand/aipro-icone.png');
    else expect(screen.getByTestId("avatar-selo").querySelector("svg")).not.toBeNull();
  });

  it("fora do modo decorativo, é uma imagem com o nome e o selo", () => {
    render(<AvatarLead nome="Ana Souza" selo="aguardando" decorativo={false} />);
    expect(screen.getByRole("img", { name: "Ana Souza, aguardando alguém" })).toBeInTheDocument();
  });

  it("cor e tamanho viram atributos; a cor padrão é derivada e estável", () => {
    const { container, rerender } = render(<AvatarLead nome="Ana" cor="rosa" tamanho="g" />);
    expect(container.firstElementChild).toHaveAttribute("data-cor", "rosa");
    expect(container.firstElementChild).toHaveAttribute("data-tamanho", "g");
    rerender(<AvatarLead nome="Ana" />);
    expect(container.firstElementChild).toHaveAttribute("data-cor", corDoLead("Ana"));
    expect(corDoLead("contato-1")).toBe(corDoLead("contato-1"));
    expect(CORES_LEAD).toContain(corDoLead("qualquer"));
  });

  it("a cor do lead é a mesma do corDoContato da F1, para todos os contatos do exemplo", () => {
    const { contatos } = criarEstadoInicial(new Date("2026-10-30T15:00:00Z"));
    expect(contatos.length).toBeGreaterThan(0);
    for (const c of contatos) expect(corDoLead(c.id)).toBe(corDoContato(c.id));
    expect(CORES_LEAD).toEqual(["azul", "menta", "areia", "rosa"]);
  });

  it("com `chave` (o id do contato), a cor sai dela e não do nome", () => {
    const { container } = render(<AvatarLead nome="Ana" chave="contato-9" />);
    expect(container.firstElementChild).toHaveAttribute("data-cor", corDoLead("contato-9"));
  });

  it("nome sem letra (só o telefone): ícone de pessoa no lugar das iniciais", () => {
    const { container } = render(<AvatarLead nome="+55 11 90000-0000" selo="janete" />);
    expect(container.firstElementChild).not.toHaveTextContent("+1");
    expect(screen.getByTestId("avatar-sem-nome").querySelector("svg")).not.toBeNull();
  });

  /* A geometria do CSS: com as iniciais 2 px para cima e para a esquerda, o canto de baixo à direita
     do texto (2 maiúsculas largas, 0,85 em cada + o espaçamento; altura de maiúscula 0,7 em) fica fora
     do selo e do anel dele, nos 3 tamanhos. */
  it("o selo nunca cobre as iniciais, em nenhum tamanho", () => {
    const texto = css("AvatarLead.module.css");
    expect(texto.replace(/\s+/g, " ")).toContain(".alAvatar[data-com-selo] .alIniciais { translate: -2px -2px; }");
    const blocos: Record<string, string> = {
      m: texto.slice(texto.indexOf(".alAvatar {"), texto.indexOf("}", texto.indexOf(".alAvatar {"))),
      p: texto.slice(texto.indexOf(".alAvatar[data-tamanho='p']"), texto.indexOf("}", texto.indexOf(".alAvatar[data-tamanho='p']"))),
      g: texto.slice(texto.indexOf(".alAvatar[data-tamanho='g']"), texto.indexOf("}", texto.indexOf(".alAvatar[data-tamanho='g']"))),
    };
    const ler = (bloco: string, nome: string) => {
      const m = bloco.match(new RegExp(`--al-${nome}:\\s*([\\d.]+)(px|rem)`));
      expect(m, `--al-${nome}`).not.toBeNull();
      return Number(m![1]) * (m![2] === "rem" ? 16 : 1);
    };
    for (const [tam, bloco] of Object.entries(blocos)) {
      const d = ler(bloco, "d");
      const fonte = ler(bloco, "fonte");
      const selo = ler(bloco, "selo");
      const fora = ler(bloco, "fora");
      const anel = ler(bloco, "anel-l");
      const larguraTexto = 2 * 0.85 * fonte + 0.02 * fonte;
      const alturaMaiuscula = 0.7 * fonte;
      const cantoX = d / 2 + larguraTexto / 2 - 2;
      const cantoY = d / 2 + alturaMaiuscula / 2 - 2;
      const centro = d + fora - selo / 2;
      const distancia = Math.hypot(centro - cantoX, centro - cantoY);
      expect(distancia, `tamanho ${tam}`).toBeGreaterThan(selo / 2 + anel);
    }
    // O selo fica para fora do círculo, no canto de baixo à direita.
    expect(texto).toMatch(/\.alSelo \{[^}]*right: calc\(-1 \* var\(--al-fora\)\);[^}]*bottom: calc\(-1 \* var\(--al-fora\)\);/);
  });
});

/* =============================================================================
   Gaveta
   ============================================================================= */

function GavetaDeTeste({ inicial = false, comMenu = false }: { inicial?: boolean; comMenu?: boolean }) {
  const [aberta, setAberta] = useState(inicial);
  const [valor, setValor] = useState("todas");
  return (
    <div>
      <button type="button" onClick={() => setAberta(true)}>
        Abrir a ficha
      </button>
      <Gaveta aberta={aberta} aoFechar={() => setAberta(false)} rotulo="Ficha de Marina Werneck" largura={360}>
        <header>
          <h2>Marina Werneck</h2>
          <FecharGaveta aoFechar={() => setAberta(false)} rotulo="Fechar a ficha" />
        </header>
        <button type="button" data-autofocus>
          Primeiro campo
        </button>
        {comMenu ? (
          <MenuSuspenso
            rotulo="Etapa"
            itens={[
              { id: "todas", texto: "Todas" },
              { id: "novo", texto: "Novo" },
            ]}
            valor={valor}
            aoEscolher={setValor}
          />
        ) : null}
        <button type="button">Último</button>
      </Gaveta>
    </div>
  );
}

describe("Gaveta", () => {
  it("fechada não renderiza nada", () => {
    render(<GavetaDeTeste />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("abre como diálogo modal com o nome, leva o foco ao data-autofocus e trava a rolagem", () => {
    render(<GavetaDeTeste />);
    const abrir = screen.getByRole("button", { name: "Abrir a ficha" });
    abrir.focus();
    fireEvent.click(abrir);
    const dialogo = screen.getByRole("dialog", { name: "Ficha de Marina Werneck" });
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(dialogo).toHaveAttribute("data-lado", "direita");
    expect(dialogo.style.getPropertyValue("--gv-largura")).toBe("360px");
    expect(screen.getByRole("button", { name: "Primeiro campo" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    // Vai para o body (portal) e leva a identidade junto.
    expect(dialogo.closest("[data-identidade='aipro']")?.parentElement).toBe(document.body);
  });

  it("sem data-autofocus, o foco vai para o próprio painel", () => {
    render(
      <Gaveta aberta aoFechar={() => {}} rotulo="Painel">
        <p>Só texto</p>
      </Gaveta>,
    );
    expect(screen.getByRole("dialog", { name: "Painel" })).toHaveFocus();
  });

  it("prende o foco: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último", () => {
    render(<GavetaDeTeste inicial />);
    const dialogo = screen.getByRole("dialog");
    const fechar = within(dialogo).getByRole("button", { name: "Fechar a ficha" });
    const ultimo = within(dialogo).getByRole("button", { name: "Último" });
    ultimo.focus();
    fireEvent.keyDown(ultimo, { key: "Tab" });
    expect(fechar).toHaveFocus();
    fireEvent.keyDown(fechar, { key: "Tab", shiftKey: true });
    expect(ultimo).toHaveFocus();
  });

  it("Esc fecha e o foco volta para quem abriu; a rolagem volta", () => {
    render(<GavetaDeTeste />);
    const abrir = screen.getByRole("button", { name: "Abrir a ficha" });
    abrir.focus();
    fireEvent.click(abrir);
    fireEvent.keyDown(screen.getByRole("button", { name: "Primeiro campo" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(abrir).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("foco caído no body (o botão focado ficou desabilitado): Tab volta para dentro e Esc ainda fecha", () => {
    render(<GavetaDeTeste inicial />);
    const dialogo = screen.getByRole("dialog");
    const fechar = within(dialogo).getByRole("button", { name: "Fechar a ficha" });
    const ultimo = within(dialogo).getByRole("button", { name: "Último" });
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.body).toHaveFocus();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(fechar).toHaveFocus();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    expect(ultimo).toHaveFocus();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clique no véu fecha; o botão de fechar também", () => {
    const aoFechar = vi.fn();
    render(
      <Gaveta aberta aoFechar={aoFechar} rotulo="Painel">
        <FecharGaveta aoFechar={aoFechar} />
      </Gaveta>,
    );
    fireEvent.click(screen.getByTestId("gaveta-veu"));
    expect(aoFechar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(aoFechar).toHaveBeenCalledTimes(2);
  });

  it("Esc num menu aberto dentro da gaveta fecha só o menu", () => {
    render(<GavetaDeTeste inicial comMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Etapa" }));
    const menu = screen.getByRole("menu", { name: "Etapa" });
    fireEvent.keyDown(within(menu).getAllByRole("menuitemradio")[0]!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Etapa" })).toHaveFocus();
    // O segundo Esc, já sem menu, fecha a gaveta.
    fireEvent.keyDown(screen.getByRole("button", { name: "Etapa" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ancorada: fica no lugar (sem portal), sem véu, sem aria-modal e sem travar a rolagem", () => {
    render(
      <div data-testid="bloco">
        <Gaveta ancorada aberta aoFechar={() => {}} rotulo="Ficha presa" largura={340}>
          <button type="button" data-autofocus>
            Primeiro
          </button>
        </Gaveta>
      </div>,
    );
    const dialogo = screen.getByRole("dialog", { name: "Ficha presa" });
    expect(dialogo.parentElement).toBe(screen.getByTestId("bloco"));
    expect(dialogo).not.toHaveAttribute("aria-modal");
    expect(dialogo).toHaveAttribute("data-ancorada");
    expect(dialogo.style.getPropertyValue("--gv-largura")).toBe("340px");
    expect(screen.queryByTestId("gaveta-veu")).toBeNull();
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  function AncoradaDeTeste() {
    const [aberta, setAberta] = useState(false);
    return (
      <div>
        <button type="button" onClick={() => setAberta((v) => !v)}>
          Abrir a ficha
        </button>
        <button type="button">Fora</button>
        <Gaveta ancorada aberta={aberta} aoFechar={() => setAberta(false)} rotulo="Ficha presa">
          <FecharGaveta aoFechar={() => setAberta(false)} rotulo="Fechar a ficha" />
          <button type="button">Último</button>
        </Gaveta>
      </div>
    );
  }

  it("ancorada: não prende o Tab; Esc dentro fecha e o foco volta para quem abriu", () => {
    render(<AncoradaDeTeste />);
    const abrir = screen.getByRole("button", { name: "Abrir a ficha" });
    abrir.focus();
    fireEvent.click(abrir);
    const dialogo = screen.getByRole("dialog", { name: "Ficha presa" });
    // sem data-autofocus, o foco vai para o painel
    expect(dialogo).toHaveFocus();
    const ultimo = within(dialogo).getByRole("button", { name: "Último" });
    ultimo.focus();
    fireEvent.keyDown(ultimo, { key: "Tab" });
    // o Tab segue a página (o navegador move o foco): a gaveta não puxa para o primeiro
    expect(ultimo).toHaveFocus();
    fireEvent.keyDown(ultimo, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(abrir).toHaveFocus();
  });

  it("ancorada: Esc fora dela é da página (não fecha); fechar com o foco fora não mexe no foco", () => {
    render(<AncoradaDeTeste />);
    const abrir = screen.getByRole("button", { name: "Abrir a ficha" });
    abrir.focus();
    fireEvent.click(abrir);
    const fora = screen.getByRole("button", { name: "Fora" });
    fora.focus();
    fireEvent.keyDown(fora, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(abrir);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fora).toHaveFocus();
  });

  it("ancorada: o X fecha e o foco volta para quem abriu", () => {
    render(<AncoradaDeTeste />);
    const abrir = screen.getByRole("button", { name: "Abrir a ficha" });
    abrir.focus();
    fireEvent.click(abrir);
    const fechar = screen.getByRole("button", { name: "Fechar a ficha" });
    fechar.focus();
    fireEvent.click(fechar);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(abrir).toHaveFocus();
  });

  it("CSS: a ancorada fica presa ao bloco, do --gv-topo até o fundo", () => {
    const texto = css("Gaveta.module.css").replace(/\s+/g, " ");
    expect(texto).toMatch(/\.gvAncorada\.gvAncorada \{ top: var\(--gv-topo, 0\); right: 0; bottom: 0;/);
  });

  it("CSS: tela cheia no celular e nenhuma animação com fill-mode both", () => {
    const texto = css("Gaveta.module.css");
    const celular = texto.slice(texto.indexOf("@media (max-width: 899px)"));
    expect(celular.replace(/\s+/g, " ")).toMatch(/\.gvPainel \{ inset: 0; width: auto; border-radius: 0;/);
    // Só as peças desta task (as outras de comum/ têm o próprio teste).
    for (const arquivo of ["Gaveta.module.css", "MenuSuspenso.module.css", "AvatarLead.module.css", "LinhaConversa.module.css"]) {
      for (const linha of css(arquivo).split("\n").filter((l) => /animation(-fill-mode)?:/.test(l))) {
        expect(linha, `${arquivo}: ${linha.trim()}`).not.toMatch(/\bboth\b|\bforwards\b/);
      }
    }
  });
});

/* =============================================================================
   MenuSuspenso
   ============================================================================= */

const FILTROS: ItemMenu[] = [
  { id: "todas", texto: "Todas", contador: 8 },
  { id: "espera", texto: "Precisam de você", contador: 3, tom: "atencao" },
  { id: "nao_lidas", texto: "Não lidas", contador: 2 },
  { id: "minhas", texto: "Comigo", contador: 1 },
];

function MenuDeTeste(props: { aoEscolher?: (id: string) => void; inicial?: string; icone?: boolean }) {
  const [valor, setValor] = useState(props.inicial ?? "todas");
  return (
    <div>
      <MenuSuspenso
        rotulo="Filtrar conversas"
        titulo="Mostrar"
        itens={FILTROS}
        valor={valor}
        icone={props.icone ? <svg data-testid="icone-filtro" /> : undefined}
        destaque={valor !== "todas"}
        aoEscolher={(id) => {
          setValor(id);
          props.aoEscolher?.(id);
        }}
      />
      <button type="button">Fora</button>
    </div>
  );
}

const itens = () => screen.getAllByRole("menuitemradio");
const botaoFiltro = () => screen.getByRole("button", { name: /Filtrar conversas/ });

describe("MenuSuspenso", () => {
  it("o botão anuncia o menu; fechado, não há menu", () => {
    render(<MenuDeTeste />);
    expect(botaoFiltro()).toHaveAttribute("aria-haspopup", "menu");
    expect(botaoFiltro()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clique abre com o foco no item marcado; os itens são rádios com contador e tom", () => {
    render(<MenuDeTeste inicial="nao_lidas" />);
    fireEvent.click(botaoFiltro());
    expect(botaoFiltro()).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Filtrar conversas" });
    expect(botaoFiltro()).toHaveAttribute("aria-controls", menu.id);
    expect(itens()).toHaveLength(4);
    expect(itens()[2]).toHaveAttribute("aria-checked", "true");
    expect(itens()[0]).toHaveAttribute("aria-checked", "false");
    expect(itens()[2]).toHaveFocus();
    expect(itens()[1]).toHaveTextContent("Precisam de você3");
    expect(itens()[1]).toHaveAttribute("data-tom", "atencao");
    expect(menu).toHaveTextContent("Mostrar");
  });

  it("setas andam em círculo; Home e End vão às pontas", () => {
    render(<MenuDeTeste />);
    fireEvent.click(botaoFiltro());
    expect(itens()[0]).toHaveFocus();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(itens()[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(itens()[3]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(itens()[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(itens()[3]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(itens()[0]).toHaveFocus();
    // Uma letra pula para o próximo item que começa com ela (sem acento).
    fireEvent.keyDown(menu, { key: "n" });
    expect(itens()[2]).toHaveFocus();
    // Só um item com o foco do Tab (foco itinerante).
    expect(itens().filter((i) => i.tabIndex === 0)).toHaveLength(1);
  });

  it("a letra ignora o acento da primeira letra do item", () => {
    const comAcento: ItemMenu[] = [
      { id: "todas", texto: "Todas" },
      { id: "agil", texto: "Ágil" },
    ];
    render(<MenuSuspenso rotulo="Ritmo" itens={comAcento} valor="todas" aoEscolher={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Ritmo" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "a" });
    expect(screen.getByRole("menuitemradio", { name: "Ágil" })).toHaveFocus();
  });

  it("no botão fechado, seta para baixo abre no marcado e seta para cima abre no último", () => {
    render(<MenuDeTeste inicial="espera" />);
    fireEvent.keyDown(botaoFiltro(), { key: "ArrowDown" });
    expect(itens()[1]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.keyDown(botaoFiltro(), { key: "ArrowUp" });
    expect(itens()[3]).toHaveFocus();
  });

  it("Esc fecha e devolve o foco ao botão, sem escolher", () => {
    const aoEscolher = vi.fn();
    render(<MenuDeTeste aoEscolher={aoEscolher} />);
    fireEvent.click(botaoFiltro());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(botaoFiltro()).toHaveFocus();
    expect(aoEscolher).not.toHaveBeenCalled();
  });

  it("escolher chama aoEscolher, fecha e devolve o foco ao botão", () => {
    const aoEscolher = vi.fn();
    render(<MenuDeTeste aoEscolher={aoEscolher} />);
    fireEvent.click(botaoFiltro());
    fireEvent.click(itens()[1]!);
    expect(aoEscolher).toHaveBeenCalledWith("espera");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(botaoFiltro()).toHaveFocus();
  });

  it("clicar fora fecha; Tab fecha", () => {
    render(<MenuDeTeste />);
    fireEvent.click(botaoFiltro());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Fora" }));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(botaoFiltro());
    fireEvent.pointerDown(itens()[1]!);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicar no botão com o menu aberto fecha", () => {
    render(<MenuDeTeste />);
    fireEvent.click(botaoFiltro());
    fireEvent.click(botaoFiltro());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("só ícone: o rótulo vira o nome do botão e o destaque acende com o filtro ligado", () => {
    render(<MenuDeTeste icone />);
    const botao = screen.getByRole("button", { name: "Filtrar conversas" });
    expect(within(botao).getByTestId("icone-filtro")).toBeInTheDocument();
    expect(botao).not.toHaveAttribute("data-destaque");
    fireEvent.click(botao);
    fireEvent.click(itens()[2]!);
    expect(botao).toHaveAttribute("data-destaque");
  });

  it("com texto próprio, o botão mostra o texto e o nome junta o rótulo", () => {
    render(
      <MenuSuspenso rotulo="Mover para" textoBotao="Qualificado" itens={FILTROS} valor={null} aoEscolher={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Mover para: Qualificado" })).toHaveTextContent("Qualificado");
  });

  it("desabilitado não abre", () => {
    render(<MenuSuspenso rotulo="Etapa" itens={FILTROS} valor="todas" aoEscolher={() => {}} desabilitado />);
    fireEvent.click(screen.getByRole("button", { name: "Etapa" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("botão de texto com ícone antes do texto e destaque; contador em pílula só quando pedido", () => {
    const { rerender } = render(
      <MenuSuspenso rotulo="Filtro" itens={FILTROS} valor="todas" aoEscolher={() => {}} iconeTexto={<svg data-testid="funil" />} destaque />,
    );
    const botao = screen.getByRole("button", { name: "Filtro" });
    expect(botao).toHaveTextContent("Filtro");
    expect(botao).toContainElement(screen.getByTestId("funil"));
    expect(botao).toHaveAttribute("data-destaque");
    fireEvent.click(botao);
    expect(screen.getByRole("menu")).not.toHaveAttribute("data-contador-pilula");
    rerender(
      <MenuSuspenso rotulo="Filtro" itens={FILTROS} valor="todas" aoEscolher={() => {}} iconeTexto={<svg data-testid="funil" />} contadorEmPilula />,
    );
    expect(screen.getByRole("menu")).toHaveAttribute("data-contador-pilula");
  });
});

/* =============================================================================
   LinhaConversa
   ============================================================================= */

const AGORA = "2026-10-30T15:00:00Z"; // 12:00 em São Paulo

const conversa = (extra: Partial<ConversaDaLinha> = {}): ConversaDaLinha => ({
  id: "conv-1",
  nao_lidas: 0,
  aguardando_humano_desde: null,
  ultima_mensagem_em: "2026-10-30T14:32:00Z",
  ultima_mensagem_preview: null,
  ...extra,
});

const contato: ContatoDaLinha = {
  id: "contato-1",
  nome: "Marina Werneck",
  nome_whatsapp: "Marina",
  telefone: "+55 11 90000-0000",
  empresa: "Clínica Aurora",
};

const msg = (extra: Partial<MensagemDaLinha> = {}): MensagemDaLinha => ({
  id: "m1",
  origem: "janete",
  tipo: "texto",
  texto: "Posso te mandar a proposta?",
  status: "lida",
  momento: "2026-10-30T14:32:00Z",
  ...extra,
});

const JANETE: Situacao = { quem: "janete", texto: "Janete atendendo · Qualificado" };

describe("LinhaConversa", () => {
  it("nome, hora, prévia com quem mandou e os vistos, e a linha de situação", () => {
    const aoAbrir = vi.fn();
    render(<LinhaConversa conversa={conversa()} contato={contato} ultima={msg()} situacao={JANETE} aoAbrir={aoAbrir} agora={AGORA} />);
    const botao = screen.getByRole("button");
    expect(botao).toHaveAccessibleName(
      "Marina Werneck, Clínica Aurora. Janete atendendo · Qualificado. Última: Janete: Posso te mandar a proposta?, lida, 11:32",
    );
    expect(botao).toHaveTextContent("Marina Werneck");
    expect(botao).toHaveTextContent("11:32");
    expect(botao).toHaveTextContent("Janete: Posso te mandar a proposta?");
    expect(botao).toHaveTextContent("Janete atendendo · Qualificado");
    expect(botao.querySelector("[data-status='lida']")).not.toBeNull();
    expect(screen.getByTestId("avatar-selo")).toHaveAttribute("data-selo", "janete");
    fireEvent.click(botao);
    expect(aoAbrir).toHaveBeenCalledWith("conv-1");
  });

  it("não lidas: contador e a linha marcada como nova; selecionada: aria-current", () => {
    const { container } = render(
      <LinhaConversa
        conversa={conversa({ nao_lidas: 2 })}
        contato={contato}
        ultima={msg({ origem: "lead", status: "recebida", texto: "Oi!" })}
        situacao={JANETE}
        selecionada
        aoAbrir={() => {}}
        agora={AGORA}
      />,
    );
    const raiz = container.firstElementChild!;
    expect(raiz).toHaveAttribute("data-nova");
    expect(raiz).toHaveAttribute("data-selecionada");
    const botao = screen.getByRole("button");
    expect(botao).toHaveAttribute("aria-current", "true");
    expect(botao).toHaveAccessibleName(/2 mensagens não lidas\. Última: Oi!, 11:32$/);
    // Mensagem do lead: sem prefixo e sem vistos.
    expect(botao.querySelector("[data-status]")).toBeNull();
  });

  it("aguardando alguém: selo de sino e o relógio com o tempo correndo, vermelho a partir de 10 min", () => {
    const sit = situacaoDe({ modo: "humano", responsavel_id: null, aguardando_humano_desde: "2026-10-30T14:52:00Z", motivo_humano: "janete_passou" });
    const { container, rerender } = render(
      <LinhaConversa conversa={conversa({ aguardando_humano_desde: "2026-10-30T14:52:00Z" })} contato={contato} ultima={msg()} situacao={sit} aoAbrir={() => {}} agora={AGORA} />,
    );
    expect(screen.getByTestId("avatar-selo")).toHaveAttribute("data-selo", "aguardando");
    expect(screen.getByRole("button")).toHaveTextContent("8 minA Janete pediu ajuda");
    expect(screen.getByRole("button")).toHaveAccessibleName(/Aguardando alguém: a Janete decidiu passar, há 8 min\./);
    expect(container.querySelector("[data-longa]")).toBeNull();
    rerender(
      <LinhaConversa conversa={conversa({ aguardando_humano_desde: "2026-10-30T14:40:00Z" })} contato={contato} ultima={msg()} situacao={sit} aoAbrir={() => {}} agora={AGORA} />,
    );
    expect(container.querySelector("[data-longa]")).toHaveTextContent("20 min");
  });

  it("sem `agora`, o relógio da espera anda sozinho", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T15:00:00Z"));
    const sit = situacaoDe({ modo: "humano", responsavel_id: null, aguardando_humano_desde: "2026-10-30T14:59:30Z", motivo_humano: "janete_passou" });
    render(
      <LinhaConversa conversa={conversa({ aguardando_humano_desde: "2026-10-30T14:59:30Z" })} contato={contato} ultima={msg()} situacao={sit} aoAbrir={() => {}} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("30 s");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("button")).toHaveTextContent("35 s");
  });

  it("sem `agora` e sem espera, o relógio anda a cada minuto: a hora de hoje vira 'Ontem' depois da meia-noite", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T02:59:30Z")); // 23:59:30 de 30/10 em São Paulo
    render(
      <LinhaConversa conversa={conversa()} contato={contato} ultima={msg({ momento: "2026-10-30T17:32:00Z" })} situacao={JANETE} aoAbrir={() => {}} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("14:32");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("button")).toHaveTextContent("Ontem");
  });

  it("o nome acessível corta a prévia longa em 80 caracteres", () => {
    const longa = "Oi! ".repeat(40).trim();
    render(<LinhaConversa conversa={conversa()} contato={contato} ultima={msg({ origem: "lead", texto: longa })} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} />);
    const nomeAcessivel = screen.getByRole("button").getAttribute("aria-label")!;
    const ultima = nomeAcessivel.slice(nomeAcessivel.indexOf("Última: ") + "Última: ".length).split(",")[0]!;
    expect(ultima.endsWith("…")).toBe(true);
    expect(ultima.length).toBeLessThanOrEqual(80);
    expect(nomeAcessivel).not.toContain(longa);
  });

  it("a cor do avatar da linha vem do id do contato", () => {
    const { container } = render(<LinhaConversa conversa={conversa()} contato={contato} ultima={msg()} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} />);
    expect(container.querySelector("[data-cor]")).toHaveAttribute("data-cor", corDoContato(contato.id));
  });

  it("falha de envio: a prévia vira 'Não enviada'", () => {
    render(<LinhaConversa conversa={conversa()} contato={contato} ultima={msg({ status: "falhou" })} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} />);
    expect(screen.getByRole("button")).toHaveTextContent("Não enviada: Posso te mandar a proposta?");
  });

  it("tipo da mensagem: ícone e resumo; 'Janete digitando…' quando ela escreve", () => {
    const { rerender } = render(
      <LinhaConversa conversa={conversa()} contato={contato} ultima={msg({ origem: "lead", status: "recebida", tipo: "audio", texto: null, duracaoS: 9 })} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Áudio (0:09)");
    expect(screen.getByRole("button").querySelector("[data-tipo='audio']")).not.toBeNull();
    rerender(
      <LinhaConversa conversa={conversa()} contato={contato} ultima={msg()} situacao={{ ...JANETE, digitando: true }} aoAbrir={() => {}} agora={AGORA} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Janete digitando…");
  });

  it("resposta pela tela usa o nome de quem mandou; pelo celular, 'Celular:'", () => {
    const { rerender } = render(
      <LinhaConversa conversa={conversa()} contato={contato} ultima={msg({ origem: "humano_tela", status: "entregue" })} situacao={JANETE} autorUltima="Rafael" aoAbrir={() => {}} agora={AGORA} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Rafael: Posso");
    rerender(
      <LinhaConversa conversa={conversa()} contato={contato} ultima={msg({ origem: "humano_celular", status: "enviada" })} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Celular: Posso");
  });

  it("hora de ontem na virada do dia em São Paulo", () => {
    render(
      <LinhaConversa conversa={conversa()} contato={contato} ultima={msg({ momento: "2026-10-31T02:59:00Z" })} situacao={JANETE} aoAbrir={() => {}} agora="2026-10-31T03:01:00Z" />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Ontem");
  });

  it("sem última mensagem, usa a prévia gravada na conversa", () => {
    render(
      <LinhaConversa conversa={conversa({ ultima_mensagem_preview: "Bom dia" })} contato={contato} ultima={null} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Bom dia");
  });

  it("o extra (card do Kanban) fica fora do botão", () => {
    render(
      <LinhaConversa conversa={conversa()} contato={contato} ultima={msg()} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} extra={<button type="button">Mover</button>} />,
    );
    const mover = screen.getByRole("button", { name: "Mover" });
    expect(mover.closest("button[aria-label]")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("compacta (etapa em chat do Kanban): sem a linha de situação, o selo diz quem atende e o nome acessível fica completo", () => {
    const { container } = render(
      <LinhaConversa conversa={conversa()} contato={contato} ultima={msg()} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} compacta />,
    );
    expect(container.firstElementChild).toHaveAttribute("data-compacta");
    const botao = screen.getByRole("button");
    expect(botao).not.toHaveTextContent("Janete atendendo");
    expect(botao).toHaveTextContent("Janete: Posso te mandar a proposta?");
    expect(botao).toHaveAccessibleName(/Janete atendendo · Qualificado\./);
    expect(screen.getByTestId("avatar-selo")).toHaveAttribute("data-selo", "janete");
  });

  it("compacta, esperando alguém: o tempo de espera toma o lugar da hora, como no protótipo, e o motivo fica no nome acessível", () => {
    const sit = situacaoDe({ modo: "humano", responsavel_id: null, aguardando_humano_desde: "2026-10-30T14:52:00Z", motivo_humano: "janete_passou" });
    const { container } = render(
      <LinhaConversa conversa={conversa({ aguardando_humano_desde: "2026-10-30T14:52:00Z" })} contato={contato} ultima={msg()} situacao={sit} aoAbrir={() => {}} agora={AGORA} compacta />,
    );
    const botao = screen.getByRole("button");
    expect(container.querySelector("[data-espera]")).toHaveTextContent("8 min");
    expect(botao).not.toHaveTextContent("A Janete pediu ajuda");
    expect(botao).toHaveAccessibleName(/Aguardando alguém: a Janete decidiu passar, há 8 min\./);
  });

  it("o padrão (Chat) continua com a linha de situação", () => {
    const { container } = render(<LinhaConversa conversa={conversa()} contato={contato} ultima={msg()} situacao={JANETE} aoAbrir={() => {}} agora={AGORA} />);
    expect(container.firstElementChild).not.toHaveAttribute("data-compacta");
    expect(screen.getByRole("button")).toHaveTextContent("Janete atendendo · Qualificado");
  });
});

describe("situacaoDe e textos", () => {
  const etapa = { nome: "Qualificado", tipo: "aberta" as const };

  it("Janete atendendo, com a etapa", () => {
    expect(situacaoDe({ modo: "janete", responsavel_id: null, aguardando_humano_desde: null, motivo_humano: null }, { etapa })).toMatchObject({
      quem: "janete",
      texto: "Janete atendendo · Qualificado",
    });
  });

  it("com você, com outra pessoa (primeiro nome e iniciais) e pelo celular", () => {
    const base = { modo: "humano" as const, aguardando_humano_desde: null, motivo_humano: null };
    expect(situacaoDe({ ...base, responsavel_id: "eu" }, { etapa, euId: "eu", responsavel: { id: "eu", nome: "Operador Teste" } })).toMatchObject({
      quem: "membro",
      texto: "Com você · Qualificado",
      // quem olha é "VC", como no protótipo (e não as iniciais do nome)
      iniciaisMembro: "VC",
    });
    expect(situacaoDe({ ...base, responsavel_id: "r" }, { etapa, euId: "eu", responsavel: { id: "r", nome: "Rafael Brito" } })).toMatchObject({
      quem: "membro",
      texto: "Com Rafael · Qualificado",
      iniciaisMembro: "RB",
    });
    expect(situacaoDe({ ...base, responsavel_id: null }, { etapa })).toMatchObject({
      quem: "celular",
      texto: "Pelo celular · Qualificado",
      descricao: "Respondida pelo celular da empresa, Qualificado",
    });
  });

  it("aguardando: pedido da Janete é sino; falha é o triângulo vermelho", () => {
    const base = { modo: "humano" as const, responsavel_id: null, aguardando_humano_desde: AGORA };
    expect(situacaoDe({ ...base, motivo_humano: "janete_passou" })).toMatchObject({ quem: "aguardando", texto: "A Janete pediu ajuda" });
    expect(situacaoDe({ ...base, motivo_humano: "chave_invalida" })).toMatchObject({ quem: "falha", texto: "Chave de IA inválida" });
  });

  it("Ganho e Perdido vêm antes de quem atende", () => {
    const janete = { modo: "janete" as const, responsavel_id: null, aguardando_humano_desde: null, motivo_humano: null };
    expect(situacaoDe(janete, { etapa: { nome: "Ganho", tipo: "ganho" } })).toMatchObject({ texto: "Ganho · Janete atendendo", desfecho: "ganho" });
    expect(situacaoDe(janete, { etapa: { nome: "Perdido", tipo: "perdido" } })).toMatchObject({ texto: "Perdido · Janete atendendo", desfecho: "perdido" });
  });

  it("digitando só vale com a Janete", () => {
    const humano = { modo: "humano" as const, responsavel_id: "r", aguardando_humano_desde: null, motivo_humano: null };
    expect(situacaoDe(humano, { digitando: true }).digitando).toBe(false);
  });

  it("nome do contato e resumo das mensagens", () => {
    expect(nomeDoContato({ id: "1", nome: "  ", nome_whatsapp: "Mari" })).toBe("Mari");
    expect(nomeDoContato({ id: "1", nome: null, telefone: "+55 11 9" })).toBe("+55 11 9");
    expect(nomeDoContato({ id: "1", nome: null })).toBe("Sem nome");
    expect(resumoMensagem(msg({ tipo: "imagem", texto: null }))).toBe("Foto");
    expect(resumoMensagem(msg({ tipo: "documento", texto: null, midia_nome: "proposta.pdf" }))).toBe("proposta.pdf");
    expect(resumoMensagem(msg({ tipo: "video", texto: null, duracaoS: 18 }))).toBe("Vídeo (0:18)");
    expect(resumoMensagem(msg({ tipo: "figurinha", texto: null }))).toBe("Figurinha");
    expect(resumoMensagem(msg({ apagada_em: AGORA }))).toBe("Mensagem apagada");
    expect(resumoMensagem(msg({ tipo: "audio", texto: null, duracaoS: null }))).toBe("Áudio");
  });
});

/* =============================================================================
   As classes declaradas existem nos CSS Modules (o f1-classes-css cobre só components/)
   ============================================================================= */

describe("comum: classes dos CSS Modules", () => {
  const arquivos = readdirSync(PASTA).filter((a) => ["Gaveta.tsx", "MenuSuspenso.tsx", "AvatarLead.tsx", "LinhaConversa.tsx"].includes(a));

  it("acha as 4 peças", () => {
    expect(arquivos).toHaveLength(4);
  });

  it.each(arquivos)("%s: cada classe declarada existe no .module.css, com o prefixo da peça", (arquivo) => {
    const codigo = css(arquivo);
    const declaradas = [...(codigo.match(/as Classes<([\s\S]+?)>/)?.[1] ?? "").matchAll(/"([\w-]+)"/g)].map((m) => m[1]!);
    expect(declaradas.length).toBeGreaterThan(2);
    const folha = css(arquivo.replace(".tsx", ".module.css"));
    const faltando = declaradas.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(folha));
    expect(faltando).toEqual([]);
    const prefixo = declaradas[0]!.slice(0, 2);
    expect(declaradas.every((c) => c.startsWith(prefixo))).toBe(true);
  });
});
