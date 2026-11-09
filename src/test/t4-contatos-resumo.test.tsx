import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbaLinha } from "@/features/plataforma/contatos/AbaLinha";
import { AbaResumo } from "@/features/plataforma/contatos/AbaResumo";
import { acontecimentos, ultimosAcontecimentos } from "@/features/plataforma/contatos/dados";
import type { FatoJanete, PropsAba } from "@/features/plataforma/contatos/tipos";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import {
  conversaDoContato,
  criarEstadoInicial,
  idContato,
  membroDoPapel,
  mensagensDaConversa,
  type Contato,
  type EstadoBase,
  type EstadoExemplo,
} from "@/features/plataforma/exemplo";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C3 da spec de Contatos (docs/spec-contatos.md): as abas Resumo e Linha do tempo do perfil.

// Sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const JULIANA = idContato("juliana");

const RESUMO_LONGO =
  "Sócia da clínica, com três dentistas e duas recepcionistas. Hoje a agenda fica numa planilha e a " +
  "recepção confirma tudo por telefone, um por um, e mesmo assim tem faltas toda semana. Quer agenda " +
  "online com lembrete no WhatsApp para acabar com as faltas. Pediu o valor do plano para duas salas, " +
  "quer começar em novembro e prefere pagar a implantação em três vezes. Ela mesma decide a compra.";

/** O estado como o provedor monta para o admin (o "Você" dos títulos é o admin). */
function comoAdmin(base: EstadoBase): EstadoExemplo {
  return { ...base, eu: membroDoPapel(base.membros, "admin") };
}

/** O estado do exemplo com o contato trocado (resumo, fatos), como o patch do exemplo faria. */
function estadoCom(id: string, mudar: (c: Contato) => Contato): EstadoBase {
  const base = criarEstadoInicial(AGORA);
  return { ...base, contatos: base.contatos.map((c) => (c.id === id ? mudar(c) : c)) };
}

/** Um id de mensagem real da conversa do contato (o "ver" dos fatos aponta para ela). */
function umaMensagem(base: EstadoBase, contatoId: string, i = 0): string {
  const estado = comoAdmin(base);
  const conversa = conversaDoContato(estado, contatoId)!;
  return mensagensDaConversa(estado, conversa.id)[i]!.id;
}

function props(extra: Partial<PropsAba> = {}): PropsAba {
  return {
    contatoId: JULIANA,
    agora: AGORA.getTime(),
    irParaAba: vi.fn(),
    verNaConversa: vi.fn(),
    avisar: vi.fn(),
    ...extra,
  };
}

function montar(ui: React.ReactElement, inicial?: EstadoBase, papel: Papel = "admin") {
  return render(
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={inicial ?? criarEstadoInicial(AGORA)} progredirEnvios={false} relogio={() => AGORA}>
        {ui}
      </ProvedorDados>
    </ProvedorPapel>,
  );
}

afterEach(cleanup);

describe("AbaResumo: o resumo da Janete", () => {
  it("corta o resumo longo e abre e fecha com 'Ler o resumo inteiro' e 'Mostrar menos'", () => {
    montar(<AbaResumo {...props()} />, estadoCom(JULIANA, (c) => ({ ...c, resumo_janete: RESUMO_LONGO })));
    expect(screen.getByRole("heading", { level: 2, name: "O resumo da Janete" })).toBeTruthy();
    expect(screen.getByText(RESUMO_LONGO)).toBeTruthy();
    const ler = screen.getByRole("button", { name: "Ler o resumo inteiro" });
    expect(ler.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(ler);
    const menos = screen.getByRole("button", { name: "Mostrar menos" });
    expect(menos.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(menos);
    expect(screen.getByRole("button", { name: "Ler o resumo inteiro" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("resumo curto não mostra 'Ler o resumo inteiro'", () => {
    montar(<AbaResumo {...props()} />, estadoCom(JULIANA, (c) => ({ ...c, resumo_janete: "Quer o valor do plano." })));
    expect(screen.getByText("Quer o valor do plano.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ler o resumo inteiro" })).toBeNull();
  });

  it("sem resumo e sem fatos: as duas frases com o primeiro nome", () => {
    montar(
      <AbaResumo {...props()} />,
      estadoCom(JULIANA, (c) => ({ ...c, resumo_janete: null, fatosJanete: [] })),
    );
    expect(screen.getByText("A Janete ainda não escreveu um resumo de Juliana.")).toBeTruthy();
    expect(screen.getByText("A Janete ainda não anotou nenhum fato sobre Juliana.")).toBeTruthy();
    expect(screen.queryByRole("term")).toBeNull();
  });

  it("sem o extra fatosJanete (o banco ainda não guarda): a frase de sem fatos", () => {
    montar(
      <AbaResumo {...props()} />,
      estadoCom(JULIANA, (c) => {
        const { fatosJanete: _fora, ...resto } = c;
        return resto as Contato;
      }),
    );
    expect(screen.getByText("A Janete ainda não anotou nenhum fato sobre Juliana.")).toBeTruthy();
  });
});

describe("AbaResumo: os fatos", () => {
  it("mostra os fatos numa lista (dl) e o 'ver' chama verNaConversa com o id da mensagem", () => {
    const base = criarEstadoInicial(AGORA);
    const msg = umaMensagem(base, JULIANA, 0);
    const fatos: FatoJanete[] = [
      { rotulo: "Interesse", valor: "Agenda online com lembrete", mensagemId: msg },
      { rotulo: "Orçamento", valor: "até R$ 600 por mês", mensagemId: null },
    ];
    const inicial = { ...base, contatos: base.contatos.map((c) => (c.id === JULIANA ? { ...c, fatosJanete: fatos } : c)) };
    const p = props();
    montar(<AbaResumo {...p} />, inicial);

    const lista = document.querySelector("dl");
    expect(lista?.getAttribute("aria-label")).toBe("O que a Janete anotou sobre Juliana");
    const termos = screen.getAllByRole("term").map((t) => t.textContent);
    expect(termos).toEqual(["Interesse", "Orçamento"]);
    const valores = screen.getAllByRole("definition");
    expect(valores[0]!.textContent).toContain("Agenda online com lembrete");
    expect(valores[1]!.textContent).toBe("até R$ 600 por mês");

    // só o fato com mensagem tem o "ver"
    expect(within(valores[1]!).queryByRole("button")).toBeNull();
    const ver = within(valores[0]!).getByRole("button", { name: /Ver na conversa onde a Janete anotou: Interesse/ });
    expect(ver.textContent).toBe("ver");
    fireEvent.click(ver);
    expect(p.verNaConversa).toHaveBeenCalledWith(msg);
    expect(screen.queryByText(/ainda não anotou nenhum fato/)).toBeNull();
  });
});

describe("AbaResumo: os últimos acontecimentos", () => {
  it("mostra os 5 mais recentes na ordem de ultimosAcontecimentos, com 'Ver na conversa' no id certo", () => {
    const base = criarEstadoInicial(AGORA);
    const estado = comoAdmin(base);
    const esperados = ultimosAcontecimentos(estado, JULIANA, 5);
    expect(esperados.length).toBeGreaterThan(0);
    const p = props();
    montar(<AbaResumo {...p} />, base);

    const secao = screen.getByRole("region", { name: "Últimos acontecimentos" });
    const itens = within(secao).getAllByRole("listitem");
    expect(itens).toHaveLength(Math.min(5, esperados.length));
    expect(itens.map((li) => li.querySelector("p")!.textContent)).toEqual(esperados.map((a) => a.titulo));

    const comMensagem = esperados.findIndex((a) => a.mensagemId);
    if (comMensagem >= 0) {
      fireEvent.click(within(itens[comMensagem]!).getByRole("button", { name: /Ver na conversa/ }));
      expect(p.verNaConversa).toHaveBeenCalledWith(esperados[comMensagem]!.mensagemId);
    }
    // quem não tem mensagem não tem o botão
    esperados.forEach((a, i) => {
      if (!a.mensagemId) expect(within(itens[i]!).queryByRole("button")).toBeNull();
    });
  });

  it("corta em 5 quando o contato tem mais acontecimentos", () => {
    const base = criarEstadoInicial(AGORA);
    const estado = comoAdmin(base);
    // um contato do exemplo com mais de 5 acontecimentos
    const alvo = base.contatos.find((c) => acontecimentos(estado, c.id).length > 5);
    expect(alvo).toBeTruthy();
    montar(<AbaResumo {...props({ contatoId: alvo!.id })} />, base);
    const secao = screen.getByRole("region", { name: "Últimos acontecimentos" });
    expect(within(secao).getAllByRole("listitem")).toHaveLength(5);
    const titulos = within(secao)
      .getAllByRole("listitem")
      .map((li) => li.querySelector("p")!.textContent);
    expect(titulos).toEqual(ultimosAcontecimentos(estado, alvo!.id).map((a) => a.titulo));
  });

  it("'Ver a linha do tempo inteira' chama irParaAba('linha')", () => {
    const p = props();
    montar(<AbaResumo {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver a linha do tempo inteira" }));
    expect(p.irParaAba).toHaveBeenCalledWith("linha");
  });
});

describe("AbaLinha", () => {
  function contarPorGrupo(base: EstadoBase, contatoId: string) {
    const estado = comoAdmin(base);
    const todos = acontecimentos(estado, contatoId);
    return {
      todos,
      etapas: todos.filter((a) => a.grupo === "etapas"),
      atendimento: todos.filter((a) => a.grupo === "atendimento"),
      mensagens: todos.filter((a) => a.grupo === "mensagens"),
    };
  }

  function titulosNaLista(): string[] {
    const ol = screen.getByRole("heading", { level: 2, name: "Linha do tempo" }).closest("section")!.querySelector("ol");
    if (!ol) return [];
    return within(ol)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent ?? "");
  }

  it("mostra tudo, do mais antigo ao mais novo, com a frase de contagem", () => {
    const base = criarEstadoInicial(AGORA);
    const { todos } = contarPorGrupo(base, JULIANA);
    montar(<AbaLinha {...props()} />, base);
    expect(screen.getByRole("button", { name: "Tudo" }).getAttribute("aria-pressed")).toBe("true");
    expect(titulosNaLista()).toEqual(todos.map((a) => a.titulo));
    const frase = screen.getByText(/acontecimentos? desde/);
    expect(frase.textContent).toMatch(
      new RegExp(`^${todos.length} acontecimentos? desde \\d+ de [a-zç]+, do mais antigo para o mais novo\\.$`),
    );
  });

  it("os 4 filtros mudam a lista e o número da frase", () => {
    const base = criarEstadoInicial(AGORA);
    const g = contarPorGrupo(base, JULIANA);
    montar(<AbaLinha {...props()} />, base);
    const casos = [
      ["Etapas", g.etapas],
      ["Atendimento", g.atendimento],
      ["Mensagens e mídias", g.mensagens],
      ["Tudo", g.todos],
    ] as const;
    for (const [rotulo, lista] of casos) {
      fireEvent.click(screen.getByRole("button", { name: rotulo }));
      expect(screen.getByRole("button", { name: rotulo }).getAttribute("aria-pressed")).toBe("true");
      if (lista.length === 0) {
        expect(screen.getByText("Nada deste tipo na linha do tempo de Juliana.")).toBeTruthy();
      } else {
        expect(titulosNaLista()).toEqual(lista.map((a) => a.titulo));
        expect(screen.getByText(/acontecimentos? desde/).textContent!.startsWith(`${lista.length} `)).toBe(true);
      }
    }
    // os 4 grupos juntos são o todo, e cada filtro de fato filtrou algo
    expect(g.etapas.length + g.atendimento.length + g.mensagens.length).toBe(g.todos.length);
    expect(g.etapas.length).toBeGreaterThan(0);
    expect(g.mensagens.length).toBeGreaterThan(0);
  });

  it("vazio por filtro: 'Nada deste tipo na linha do tempo de <primeiro nome>.'", () => {
    // um contato sem nenhum acontecimento de atendimento
    const base = criarEstadoInicial(AGORA);
    const estado = comoAdmin(base);
    const alvo = base.contatos.find((c) => {
      const todos = acontecimentos(estado, c.id);
      return todos.length > 0 && !todos.some((a) => a.grupo === "atendimento");
    });
    expect(alvo).toBeTruthy();
    const primeiro = (alvo!.nome ?? alvo!.nome_whatsapp ?? "").split(" ")[0];
    montar(<AbaLinha {...props({ contatoId: alvo!.id })} />, base);
    fireEvent.click(screen.getByRole("button", { name: "Atendimento" }));
    expect(screen.getByText(`Nada deste tipo na linha do tempo de ${primeiro}.`)).toBeTruthy();
    expect(screen.queryByText(/acontecimentos? desde/)).toBeNull();
  });

  it("'Ver na conversa' chama verNaConversa com o id da mensagem daquele acontecimento", () => {
    const base = criarEstadoInicial(AGORA);
    const { todos } = contarPorGrupo(base, JULIANA);
    const comMensagem = todos.filter((a) => a.mensagemId);
    expect(comMensagem.length).toBeGreaterThan(0);
    const p = props();
    montar(<AbaLinha {...p} />, base);
    const itens = screen.getAllByRole("listitem");
    const ultimo = comMensagem[comMensagem.length - 1]!;
    const i = todos.indexOf(ultimo);
    fireEvent.click(within(itens[i]!).getByRole("button", { name: "Ver na conversa" }));
    expect(p.verNaConversa).toHaveBeenCalledWith(ultimo.mensagemId);
    // quem não tem mensagem não tem o botão
    todos.forEach((a, k) => {
      if (!a.mensagemId) expect(within(itens[k]!).queryByRole("button", { name: "Ver na conversa" })).toBeNull();
    });
  });

  it("a etapa do momento aparece como texto, e quem fez aparece por nome", () => {
    const base = criarEstadoInicial(AGORA);
    const { todos } = contarPorGrupo(base, JULIANA);
    montar(<AbaLinha {...props()} />, base);
    const itens = screen.getAllByRole("listitem");
    // No criado e na troca de etapa o título já diz a etapa: o rodapé não a repete.
    const k = todos.findIndex((a) => a.etapaId && a.tipo !== "criado" && a.tipo !== "etapa");
    expect(k).toBeGreaterThanOrEqual(0);
    const etapa = base.etapas.find((e) => e.id === todos[k]!.etapaId)!;
    expect(within(itens[k]!).getByText(etapa.nome)).toBeTruthy();
    expect(within(itens[0]!).getByText(todos[0]!.quem.nome)).toBeTruthy();

    const comEtapaNoTitulo = todos.flatMap((a, i) => (a.etapaId && (a.tipo === "criado" || a.tipo === "etapa") ? [i] : []));
    expect(comEtapaNoTitulo.length).toBeGreaterThan(0);
    for (const i of comEtapaNoTitulo) {
      const nomeEtapa = base.etapas.find((e) => e.id === todos[i]!.etapaId)!.nome;
      expect(within(itens[i]!).getByRole("heading", { level: 3 })).toHaveTextContent(nomeEtapa);
      expect(within(itens[i]!).queryByText(nomeEtapa)).toBeNull();
    }
  });
});
