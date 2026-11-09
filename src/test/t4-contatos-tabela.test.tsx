import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idTituloArea } from "@/features/plataforma/AreaVazia";
import { AREAS } from "@/features/plataforma/areas";
import { FILTROS_INICIAIS, contadores, linhasDaTabela } from "@/features/plataforma/contatos/dados";
import { idLinhaContato } from "@/features/plataforma/contatos/ids";
import { TextoQuem } from "@/features/plataforma/contatos/pecas";
import { TabelaContatos } from "@/features/plataforma/contatos/Tabela";
import type { FiltrosTabela, QuemAtende, RecorteTabela } from "@/features/plataforma/contatos/tipos";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import {
  criarEstadoInicial,
  idContato,
  type EstadoBase,
  type EstadoExemplo,
} from "@/features/plataforma/exemplo";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C1 da spec de Contatos (docs/spec-contatos.md): a tabela, com as abas de contador, a busca, o
// filtro, as colunas que ordenam, os dois vazios e a lista abaixo de 1024 px. Os números esperados
// saem das funções da fundação (contadores e linhasDaTabela) sobre o mesmo estado do exemplo: nada
// de número escrito à mão.

// Sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const T = AGORA.getTime();

const aoAbrir = vi.fn<(id: string) => void>();
const ultimosFiltros = { atual: FILTROS_INICIAIS as FiltrosTabela };

/** Simula a largura da janela para as media queries (min-width e max-width), como no t1-chat. */
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

/** A tabela com os filtros num estado, como a TelaContatos guarda. */
function Casca({ foco, inicial }: { foco: string | null; inicial: FiltrosTabela }) {
  const [filtros, setFiltros] = useState<FiltrosTabela>(inicial);
  ultimosFiltros.atual = filtros;
  return (
    <TabelaContatos
      filtros={filtros}
      aoMudarFiltros={setFiltros}
      aoAbrir={aoAbrir}
      agora={T}
      focoContatoId={foco}
    />
  );
}

function montar({
  foco = null,
  papel = "admin",
  estado,
  filtros = FILTROS_INICIAIS,
}: {
  foco?: string | null;
  papel?: Papel;
  estado?: () => EstadoBase;
  filtros?: FiltrosTabela;
} = {}) {
  return render(
    <StrictMode>
      <ProvedorPapel inicial={papel}>
        <ProvedorDados
          relogio={() => new Date(T)}
          progredirEnvios={false}
          exemplo={estado ?? (() => criarEstadoInicial(AGORA))}
        >
          <Casca foco={foco} inicial={filtros} />
        </ProvedorDados>
      </ProvedorPapel>
    </StrictMode>,
  );
}

/** O estado que a tabela vê (o de admin: o "eu" é o membro admin do exemplo). */
function estadoDoExemplo(): EstadoExemplo {
  const base = criarEstadoInicial(AGORA);
  const eu = base.membros.find((m) => m.papel === "admin") ?? base.membros[0]!;
  return { ...base, eu };
}

const linhasNaTela = () => Array.from(document.querySelectorAll("tbody tr"));
const nomesNaTela = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("tbody tr button[id^='contato-linha-']")).map(
    (b) => b.textContent,
  );

const ABAS: readonly [RecorteTabela, string][] = [
  ["todos", "Todos"],
  ["precisam", "Precisam de você"],
  ["novos_hoje", "Novos hoje"],
  ["com_janete", "Com a Janete"],
  ["comigo", "Comigo"],
];

const aba = (nome: string) => screen.getByRole("button", { name: new RegExp(`^${nome}\\s*\\d+$`) });

beforeEach(() => {
  vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
  aoAbrir.mockClear();
  ultimosFiltros.atual = FILTROS_INICIAIS;
  largura(1440);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Contatos, tabela: o título e as abas de contador", () => {
  it("o h1 'Contatos' com o id da área, focável por código, e o total em cinza", () => {
    montar();
    const h1 = screen.getByRole("heading", { level: 1, name: "Contatos" });
    expect(h1).toHaveAttribute("id", idTituloArea("contatos"));
    expect(h1).toHaveAttribute("tabindex", "-1");
    const total = contadores(estadoDoExemplo(), T).todos;
    expect(total).toBeGreaterThan(0);
    expect(screen.getByText(`${total} contatos`)).toBeInTheDocument();
  });

  it("o estado da tabela é o do admin (o 'Comigo' bate com o membro admin)", () => {
    // Confere a premissa dos números esperados abaixo: o exemplo monta como admin.
    montar();
    expect(aba("Comigo")).toHaveTextContent(String(contadores(estadoDoExemplo(), T).comigo));
  });

  it("cada aba mostra o número de contadores() e, ligada, filtra a tabela com esse número de linhas", () => {
    montar();
    const numeros = contadores(estadoDoExemplo(), T);
    for (const [recorte, nome] of ABAS) {
      const botao = aba(nome);
      expect(botao).toHaveTextContent(`${nome}${numeros[recorte]}`);
      fireEvent.click(botao);
      expect(ultimosFiltros.atual.recorte).toBe(recorte);
      // Uma ligada por vez.
      for (const [, outro] of ABAS) expect(aba(outro)).toHaveAttribute("aria-pressed", String(outro === nome));
      if (numeros[recorte] > 0) {
        expect(linhasNaTela()).toHaveLength(numeros[recorte]);
        const esperado = linhasDaTabela(estadoDoExemplo(), { ...FILTROS_INICIAIS, recorte }, T).map((l) => l.nome);
        expect(nomesNaTela()).toEqual(esperado);
      } else {
        expect(screen.getByRole("heading", { name: "Nenhum contato encontrado" })).toBeInTheDocument();
      }
      // Com recorte, o total vira "N de T" (o "Todos" é a tabela inteira).
      if (recorte !== "todos") expect(screen.getByText(`${numeros[recorte]} de ${numeros.todos}`)).toBeInTheDocument();
    }
  });
});

describe("Contatos, tabela: a busca", () => {
  it("'90000-0007' acha o Marcos pelo telefone, e o total vira '1 de N'", () => {
    montar();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar contato" }), { target: { value: "90000-0007" } });
    expect(nomesNaTela()).toEqual(["Marcos Vieira"]);
    expect(screen.getByText(`1 de ${contadores(estadoDoExemplo(), T).todos}`)).toBeInTheDocument();
  });

  it("'clinica' (sem acento) acha quem é de clínica", () => {
    montar();
    const busca = screen.getByRole("searchbox", { name: "Buscar contato" });
    expect(busca).toHaveAttribute("placeholder", "Buscar por nome, telefone, empresa ou e-mail");
    fireEvent.change(busca, { target: { value: "clinica" } });
    const esperado = linhasDaTabela(estadoDoExemplo(), { ...FILTROS_INICIAIS, busca: "clinica" }, T);
    expect(esperado.length).toBeGreaterThan(0);
    expect(nomesNaTela()).toEqual(esperado.map((l) => l.nome));
    expect(screen.getAllByText(/Clínica/).length).toBeGreaterThan(0);
  });
});

describe("Contatos, tabela: as colunas e a ordem", () => {
  it("tem caption para o leitor de tela e os 5 títulos com scope=col; Quem atende não ordena", () => {
    montar();
    const tabela = screen.getByRole("table");
    expect(tabela.querySelector("caption")).toHaveTextContent(/Contatos, ordenados por Última mensagem/);
    const titulos = within(tabela).getAllByRole("columnheader");
    expect(titulos.map((t) => t.textContent)).toEqual(["Contato", "Etapa", "Quem atende", "Última mensagem", "Entrou em"]);
    for (const t of titulos) expect(t).toHaveAttribute("scope", "col");
    expect(within(titulos[2]!).queryByRole("button")).not.toBeInTheDocument();
    // A ordem padrão: a última mensagem, a mais nova primeiro.
    expect(titulos[3]).toHaveAttribute("aria-sort", "descending");
    expect(nomesNaTela()).toEqual(linhasDaTabela(estadoDoExemplo(), FILTROS_INICIAIS, T).map((l) => l.nome));
  });

  it("clicar em Contato ordena de A a Z (aria-sort ascending); de novo, inverte", () => {
    montar();
    const tabela = screen.getByRole("table");
    const botao = within(tabela).getByRole("button", { name: "Contato" });
    fireEvent.click(botao);
    const th = botao.closest("th")!;
    expect(th).toHaveAttribute("aria-sort", "ascending");
    const az = linhasDaTabela(estadoDoExemplo(), { ...FILTROS_INICIAIS, ordem: { coluna: "contato", direcao: "asc" } }, T).map(
      (l) => l.nome,
    );
    expect(nomesNaTela()).toEqual(az);
    // Os outros títulos ficam sem ordem.
    expect(within(tabela).getByRole("button", { name: "Última mensagem" }).closest("th")).toHaveAttribute("aria-sort", "none");

    fireEvent.click(botao);
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(nomesNaTela()).toEqual([...az].reverse());
  });

  it("Etapa ordena pela ordem do funil e Entrou em começa da mais nova; clicar de novo inverte", () => {
    montar();
    const tabela = screen.getByRole("table");
    fireEvent.click(within(tabela).getByRole("button", { name: "Etapa" }));
    expect(ultimosFiltros.atual.ordem).toEqual({ coluna: "etapa", direcao: "asc" });
    fireEvent.click(within(tabela).getByRole("button", { name: "Etapa" }));
    expect(ultimosFiltros.atual.ordem).toEqual({ coluna: "etapa", direcao: "desc" });

    const entrou = within(tabela).getByRole("button", { name: "Entrou em" });
    fireEvent.click(entrou);
    expect(entrou.closest("th")).toHaveAttribute("aria-sort", "descending");
    expect(nomesNaTela()).toEqual(
      linhasDaTabela(estadoDoExemplo(), { ...FILTROS_INICIAIS, ordem: { coluna: "entrada", direcao: "desc" } }, T).map(
        (l) => l.nome,
      ),
    );
    fireEvent.click(entrou);
    expect(entrou.closest("th")).toHaveAttribute("aria-sort", "ascending");

    // A última mensagem, que já é a ordem padrão (desc), inverte no primeiro clique.
    const ultima = within(tabela).getByRole("button", { name: "Última mensagem" });
    fireEvent.click(ultima);
    expect(ultima.closest("th")).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(ultima);
    expect(ultima.closest("th")).toHaveAttribute("aria-sort", "ascending");
  });

  it("cada linha traz o nome, a empresa (ou 'Sem empresa'), a etapa, quem atende e as datas", () => {
    montar();
    const marcos = document.getElementById(idLinhaContato(idContato("marcos")))!;
    const linha = marcos.closest("tr")!;
    expect(within(linha).getByText("Marcos Vieira")).toBeInTheDocument();
    expect(within(linha).getByText("Escola de Idiomas Ponte")).toBeInTheDocument();
    const dado = linhasDaTabela(estadoDoExemplo(), FILTROS_INICIAIS, T).find((l) => l.contatoId === idContato("marcos"))!;
    expect(within(linha).getByText(dado.etapa.nome)).toBeInTheDocument();
    expect(linha.querySelectorAll("td")).toHaveLength(5);
  });
});

describe("Contatos, tabela: o filtro", () => {
  it("Etapa (várias) filtra, o botão mostra quantos estão ligados e 'Limpar filtros' desliga", () => {
    montar();
    const estado = estadoDoExemplo();
    const botao = screen.getByRole("button", { name: "Filtro" });
    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");
    const painel = screen.getByRole("group", { name: "Filtrar contatos" });
    // Sem filtro ligado, não há o "Limpar filtros".
    expect(within(painel).queryByRole("button", { name: "Limpar filtros" })).not.toBeInTheDocument();

    const etapas = estado.etapas.filter((e) => !e.arquivada).sort((a, b) => a.ordem - b.ordem);
    expect(within(painel).getAllByRole("checkbox").map((c) => c.closest("label")!.textContent)).toEqual(
      etapas.map((e) => e.nome),
    );

    // A etapa com mais contatos, e depois mais uma.
    const comContatos = etapas.filter((e) => estado.contatos.some((c) => c.etapa_id === e.id));
    const [a, b] = comContatos;
    fireEvent.click(within(painel).getByRole("checkbox", { name: a!.nome }));
    expect(ultimosFiltros.atual.etapaIds).toEqual([a!.id]);
    expect(linhasNaTela()).toHaveLength(estado.contatos.filter((c) => c.etapa_id === a!.id).length);
    fireEvent.click(within(painel).getByRole("checkbox", { name: b!.nome }));
    expect(linhasNaTela()).toHaveLength(estado.contatos.filter((c) => c.etapa_id === a!.id || c.etapa_id === b!.id).length);
    expect(screen.getByRole("button", { name: "Filtro, 2 ligados" })).toBeInTheDocument();

    // O período conta mais um.
    fireEvent.click(within(painel).getByRole("radio", { name: "Últimos 30 dias" }));
    expect(ultimosFiltros.atual.entrada).toBe("30");
    expect(screen.getByRole("button", { name: "Filtro, 3 ligados" })).toBeInTheDocument();

    fireEvent.click(within(painel).getByRole("button", { name: "Limpar filtros" }));
    expect(ultimosFiltros.atual).toMatchObject({ etapaIds: [], entrada: "qualquer" });
    expect(screen.getByRole("button", { name: "Filtro" })).toHaveFocus();
    expect(linhasNaTela()).toHaveLength(estado.contatos.length);
  });

  it("Entrou em tem as 4 opções, e Esc fecha devolvendo o foco ao botão", () => {
    montar();
    const botao = screen.getByRole("button", { name: "Filtro" });
    fireEvent.click(botao);
    const painel = screen.getByRole("group", { name: "Filtrar contatos" });
    expect(within(painel).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual([
      "Qualquer data",
      "Hoje",
      "Últimos 7 dias",
      "Últimos 30 dias",
    ]);
    expect(within(painel).getByRole("radio", { name: "Qualquer data" })).toBeChecked();
    fireEvent.click(within(painel).getByRole("radio", { name: "Hoje" }));
    const novosHoje = linhasDaTabela(estadoDoExemplo(), { ...FILTROS_INICIAIS, entrada: "hoje" }, T);
    expect(nomesNaTela()).toEqual(novosHoje.map((l) => l.nome));

    fireEvent.keyDown(within(painel).getByRole("radio", { name: "Hoje" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Filtrar contatos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtro, 1 ligado" })).toHaveFocus();
  });
});

describe("Contatos, tabela: os vazios", () => {
  it("busca sem resultado: 'Nenhum contato encontrado', diz o que foi buscado e 'Limpar busca e filtros' limpa tudo", () => {
    montar();
    fireEvent.click(aba("Precisam de você"));
    fireEvent.click(screen.getByRole("table").querySelector("th button")!); // ordena por Contato
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar contato" }), { target: { value: "zzz-ninguem" } });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nenhum contato encontrado" })).toBeInTheDocument();
    expect(screen.getByText(/a busca “zzz-ninguem” e a aba Precisam de você/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpar busca e filtros" }));
    // Volta a tabela inteira; a ordem escolhida fica.
    expect(ultimosFiltros.atual).toEqual({ ...FILTROS_INICIAIS, ordem: { coluna: "contato", direcao: "asc" } });
    expect(screen.getByRole("searchbox", { name: "Buscar contato" })).toHaveValue("");
    expect(aba("Todos")).toHaveAttribute("aria-pressed", "true");
    expect(linhasNaTela()).toHaveLength(estadoDoExemplo().contatos.length);
  });

  it("sem nenhum contato: o título e o texto da área Contatos, sem abas nem busca", () => {
    montar({ estado: () => ({ ...criarEstadoInicial(AGORA), contatos: [] }) });
    const area = AREAS.find((a) => a.id === "contatos")!;
    expect(screen.getByRole("heading", { name: area.vazio.titulo })).toBeInTheDocument();
    expect(screen.getByText(area.vazio.texto)).toBeInTheDocument();
    expect(screen.getByText("0 contatos")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("Contatos, tabela: abrir um contato", () => {
  it("o clique no nome chama aoAbrir uma vez, com o id", () => {
    montar();
    const id = idContato("marcos");
    fireEvent.click(document.getElementById(idLinhaContato(id))!);
    expect(aoAbrir).toHaveBeenCalledTimes(1);
    expect(aoAbrir).toHaveBeenCalledWith(id);
  });

  it("o clique em outro ponto da linha também abre", () => {
    montar();
    const id = idContato("marcos");
    const linha = document.getElementById(idLinhaContato(id))!.closest("tr")!;
    fireEvent.click(linha.querySelectorAll("td")[3]!);
    expect(aoAbrir).toHaveBeenCalledTimes(1);
    expect(aoAbrir).toHaveBeenCalledWith(id);
  });

  it("Enter no botão do nome abre (é um botão de verdade, no teclado)", () => {
    montar();
    const id = idContato("marcos");
    const botao = document.getElementById(idLinhaContato(id)) as HTMLButtonElement;
    // Um <button type="button"> habilitado e focável: no navegador, Enter e Espaço viram clique.
    expect(botao.tagName).toBe("BUTTON");
    expect(botao).toHaveAttribute("type", "button");
    expect(botao).toBeEnabled();
    botao.focus();
    expect(botao).toHaveFocus();
    // O jsdom não converte a tecla em clique (o projeto não tem o user-event): o teste faz o que o
    // navegador faz, a tecla e o clique que ela gera, e confere que abre uma vez só.
    fireEvent.keyDown(botao, { key: "Enter" });
    fireEvent.click(botao);
    expect(aoAbrir).toHaveBeenCalledTimes(1);
    expect(aoAbrir).toHaveBeenCalledWith(id);
  });

  it("focoContatoId põe o foco no botão do nome desse contato", () => {
    const id = idContato("marcos");
    montar({ foco: id });
    expect(document.activeElement).toBe(document.getElementById(idLinhaContato(id)));
  });
});

describe("Contatos, tabela: abaixo de 1024 px vira lista", () => {
  it("a 1023 px, uma ul com cada contato num botão (com o mesmo id, uma vez só) e sem a tabela", () => {
    largura(1023);
    montar();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const lista = screen.getByRole("list", { name: "Contatos" });
    const itens = within(lista).getAllByRole("listitem");
    expect(itens).toHaveLength(estadoDoExemplo().contatos.length);

    const id = idContato("marcos");
    expect(document.querySelectorAll(`#${idLinhaContato(id)}`)).toHaveLength(1);
    const botao = document.getElementById(idLinhaContato(id))!;
    expect(botao).toHaveTextContent("Marcos Vieira");
    expect(botao).toHaveTextContent("Escola de Idiomas Ponte");
    fireEvent.click(botao);
    expect(aoAbrir).toHaveBeenCalledWith(id);
    // Na lista, a busca é estreita: o texto de exemplo é o curto, igual ao rótulo.
    expect(screen.getByRole("searchbox", { name: "Buscar contato" })).toHaveAttribute("placeholder", "Buscar contato");
  });

  it("a 1024 px, a tabela", () => {
    largura(1024);
    montar();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Contatos" })).not.toBeInTheDocument();
  });
});

describe("Contatos, tabela: a espera de quem atende", () => {
  const esperando = (segundos: number, tipo: "aguardando" | "falha" = "aguardando"): QuemAtende => ({
    tipo,
    nome: "Esperando a equipe",
    membroId: null,
    esperaDesde: new Date(T - segundos * 1000).toISOString(),
    aoVivo: false,
  });
  const bolinha = (c: HTMLElement) => c.querySelector("i[aria-hidden='true']")!;

  it("a cor fica numa bolinha, âmbar até 9 min 59 s e vermelha (data-longa) a partir de 10 min", () => {
    const a = render(<TextoQuem quem={esperando(9 * 60 + 59)} agora={T} />);
    expect(bolinha(a.container)).not.toHaveAttribute("data-longa");
    expect(a.container).toHaveTextContent("Esperando a equipe há 9 min");
    a.unmount();

    const b = render(<TextoQuem quem={esperando(10 * 60)} agora={T} />);
    expect(bolinha(b.container)).toHaveAttribute("data-longa");
    b.unmount();
  });

  it("a falha segue a mesma régua: com 4 min, sem data-longa", () => {
    const { container } = render(<TextoQuem quem={esperando(4 * 60, "falha")} agora={T} />);
    expect(bolinha(container)).toBeInTheDocument();
    expect(bolinha(container)).not.toHaveAttribute("data-longa");
  });

  it("'4 min' não quebra entre o número e a unidade", () => {
    const { container } = render(<TextoQuem quem={esperando(4 * 60)} agora={T} />);
    expect(container.textContent).toContain("Esperando a equipe · 4 min");
  });

  it("a forma curta ('Esperando · 4 min') só sai quando pedida, e o leitor de tela ouve o nome inteiro", () => {
    const sem = render(<TextoQuem quem={esperando(4 * 60)} agora={T} />);
    expect(sem.container.textContent).not.toContain("Esperando ·");
    sem.unmount();
    const com = render(<TextoQuem quem={esperando(4 * 60)} agora={T} curto="estreito" />);
    expect(com.container.firstElementChild).toHaveAttribute("data-curto", "estreito");
    expect(com.container.textContent).toContain("Esperando · 4 min");
    expect(com.container.textContent).toContain("Esperando a equipe há 4 min");
  });

  it("na lista (abaixo de 1024 px), a etapa e quem atende andam juntos, separados da empresa", () => {
    largura(1023);
    montar();
    const linha = linhasDaTabela(estadoDoExemplo(), FILTROS_INICIAIS, T).find(
      (l) => l.quem.tipo === "aguardando" || l.quem.tipo === "falha",
    )!;
    const botao = document.getElementById(idLinhaContato(linha.contatoId))!;
    const quem = botao.querySelector("[data-curto='sempre']")!;
    expect(quem).toBeInTheDocument();
    const grupo = quem.parentElement!;
    expect(grupo).toHaveTextContent(linha.etapa.nome);
    expect(grupo).not.toHaveTextContent(linha.empresa?.trim() || "Sem empresa");
  });
});

describe("Contatos, tabela: as classes do CSS", () => {
  it("toda classe declarada em Tabela.tsx existe em Tabela.module.css", () => {
    const pasta = path.resolve(__dirname, "../features/plataforma/contatos");
    const codigo = readFileSync(path.join(pasta, "Tabela.tsx"), "utf-8");
    const css = readFileSync(path.join(pasta, "Tabela.module.css"), "utf-8");
    const bloco = /estilos as Classes<([^>]+)>/.exec(codigo)![1]!;
    const classes = [...bloco.matchAll(/"([\w-]+)"/g)].map((m) => m[1]!);
    expect(classes.length).toBeGreaterThan(10);
    for (const c of classes) expect(css, c).toMatch(new RegExp(`\\.${c}\\b`));
  });
});
