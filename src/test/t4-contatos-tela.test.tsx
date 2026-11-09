import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idTituloArea } from "@/features/plataforma/AreaVazia";
import { FILTROS_INICIAIS } from "@/features/plataforma/contatos/dados";
import {
  TelaContatos,
  idLinhaContato,
  idTituloPerfil,
  validarBuscaContatos,
} from "@/features/plataforma/contatos/TelaContatos";
import type { FiltrosTabela } from "@/features/plataforma/contatos/tipos";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarEstadoInicial, idContato, useExemplo } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// Task F2 da spec de Contatos (docs/spec-contatos.md): a tela que troca a tabela e o perfil pelo
// endereço. Aqui só a fiação importa: a tabela e o perfil são das tasks C1 e C2, então entram
// dublês com o mesmo contrato, que guardam as últimas props recebidas.

interface PropsTabela {
  filtros: FiltrosTabela;
  aoMudarFiltros(f: FiltrosTabela): void;
  aoAbrir(contatoId: string): void;
  agora: number;
  focoContatoId: string | null;
}
interface PropsPerfil {
  contatoId: string;
  agora: number;
  aoVoltar(): void;
  aoApagado(nome: string): void;
  avisar(texto: string): void;
}

const registro = vi.hoisted(() => ({
  tabela: null as PropsTabela | null,
  perfil: null as PropsPerfil | null,
  // os contatos do estado, vistos pela tabela: confere que o Apagar do dublê apagou de verdade
  idsNoEstado: [] as string[],
}));

// Os contatos que o dublê da tabela mostra (dois leads do exemplo).
const JULIANA = "ct-juliana";
const RICARDO = "ct-ricardo";

vi.mock("@/features/plataforma/contatos/Tabela", () => ({
  TabelaContatos: function TabelaDuble(p: PropsTabela) {
    registro.tabela = p;
    registro.idsNoEstado = useExemplo().estado.contatos.map((c) => c.id);
    return (
      <section data-testid="tabela">
        <h1 id={idTituloArea("contatos")} tabIndex={-1}>
          Contatos
        </h1>
        <input
          aria-label="Buscar contato"
          value={p.filtros.busca}
          onChange={(e) => p.aoMudarFiltros({ ...p.filtros, busca: e.target.value })}
        />
        <button type="button" onClick={() => p.aoMudarFiltros({ ...p.filtros, recorte: "comigo" })}>
          Comigo
        </button>
        {[JULIANA, RICARDO].map((id) => (
          <button key={id} type="button" id={idLinhaContato(id)} onClick={() => p.aoAbrir(id)}>
            {id}
          </button>
        ))}
      </section>
    );
  },
}));

vi.mock("@/features/plataforma/contatos/Perfil", () => ({
  PerfilContato: function PerfilDuble(p: PropsPerfil) {
    registro.perfil = p;
    const { acoes } = useExemplo();
    return (
      <article data-testid="perfil" data-contato={p.contatoId}>
        <button type="button" onClick={p.aoVoltar}>
          ← Contatos
        </button>
        <h1 id={idTituloPerfil(p.contatoId)} tabIndex={-1}>
          {p.contatoId}
        </h1>
        {/* Como o Apagar de verdade: tira o contato do estado e só então avisa a tela. */}
        <button
          type="button"
          onClick={() => {
            acoes.apagarContato(p.contatoId);
            p.aoApagado("Juliana Teste");
          }}
        >
          Apagar
        </button>
        <button type="button" onClick={() => p.avisar("Etapa mudada")}>
          Mover
        </button>
      </article>
    );
  },
}));

// Sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");

const irPara = vi.fn<(id: string | null, opcoes?: { substituir?: boolean }) => void>();

/**
 * O endereço de mentira: guarda o contato num estado, como a rota guarda no `?contato=`. O botão
 * "Voltar do navegador" muda o endereço sem passar pelo irPara, como o voltar de verdade.
 */
function Endereco({ inicial }: { inicial: string | null }) {
  const [contato, setContato] = useState<string | null>(inicial);
  return (
    <>
      <button type="button" onClick={() => setContato(null)}>
        Voltar do navegador
      </button>
      <TelaContatos
        contatoId={contato}
        irPara={(...args) => {
          // Repassa os argumentos como vieram: a chamada sem opções fica [id], e não [id, undefined].
          irPara(...args);
          setContato(args[0]);
        }}
      />
    </>
  );
}

/** Uma área que rola por dentro, como o `.platMain` da casca no computador. */
function areaQueRola(): { el: HTMLDivElement | null; topo: number } {
  return { el: null, topo: 0 };
}

function montar(inicial: string | null = null, rolador?: ReturnType<typeof areaQueRola>) {
  const tela = <Endereco inicial={inicial} />;
  return render(
    <StrictMode>
      <ProvedorPapel inicial="admin">
        <ProvedorDados relogio={() => new Date(Date.now())} progredirEnvios={false} exemplo={() => criarEstadoInicial(AGORA)}>
          {rolador ? (
            <div
              data-testid="rolador"
              style={{ overflowY: "auto" }}
              ref={(el) => {
                if (!el || rolador.el === el) return;
                rolador.el = el;
                // jsdom não tem layout: o scrollTop vira um campo comum, que a tela lê e escreve.
                Object.defineProperty(el, "scrollTop", {
                  configurable: true,
                  get: () => rolador.topo,
                  set: (v: number) => {
                    rolador.topo = v;
                  },
                });
              }}
            >
              {tela}
            </div>
          ) : (
            tela
          )}
        </ProvedorDados>
      </ProvedorPapel>
    </StrictMode>,
  );
}

const rolarJanela = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ now: AGORA, shouldAdvanceTime: true });
  registro.tabela = null;
  registro.perfil = null;
  registro.idsNoEstado = [];
  irPara.mockClear();
  rolarJanela.mockClear();
  // No teste ninguém rola por dentro (jsdom não tem layout): quem rola é a janela.
  vi.spyOn(window, "scrollTo").mockImplementation(rolarJanela);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
});

describe("Contatos: a tela troca a tabela e o perfil pelo endereço", () => {
  it("os contatos de teste existem no exemplo", () => {
    expect(JULIANA).toBe(idContato("juliana"));
    expect(RICARDO).toBe(idContato("ricardo"));
  });

  it("sem contato, mostra a tabela com os filtros iniciais e sem linha para focar", () => {
    montar();
    expect(screen.getByTestId("tabela")).toBeInTheDocument();
    expect(screen.queryByTestId("perfil")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Contatos" })).toHaveAttribute("id", idTituloArea("contatos"));
    expect(registro.tabela?.filtros).toEqual(FILTROS_INICIAIS);
    expect(registro.tabela?.focoContatoId).toBeNull();
    expect(registro.tabela?.agora).toBe(AGORA.getTime());
    expect(irPara).not.toHaveBeenCalled();
  });

  it("abrir chama irPara com o id e mostra o perfil desse contato, com o foco no nome", () => {
    montar();
    fireEvent.click(document.getElementById(idLinhaContato(JULIANA))!);
    expect(irPara).toHaveBeenCalledTimes(1);
    // Abrir cria um passo no "voltar": sem a opção substituir.
    expect(irPara.mock.calls).toEqual([[JULIANA]]);
    expect(screen.queryByTestId("tabela")).not.toBeInTheDocument();
    expect(screen.getByTestId("perfil")).toHaveAttribute("data-contato", JULIANA);
    expect(registro.perfil?.contatoId).toBe(JULIANA);
    expect(document.activeElement).toBe(document.getElementById(idTituloPerfil(JULIANA)));
  });

  it("o endereço com um contato válido abre direto no perfil", () => {
    montar(RICARDO);
    expect(screen.getByTestId("perfil")).toHaveAttribute("data-contato", RICARDO);
    expect(irPara).not.toHaveBeenCalled();
  });

  it("a busca e o filtro mudados na tabela voltam iguais depois de abrir e voltar", () => {
    montar();
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar contato" }), { target: { value: "clinica" } });
    fireEvent.click(screen.getByRole("button", { name: "Comigo" }));
    const mudados = registro.tabela!.filtros;
    expect(mudados).toMatchObject({ busca: "clinica", recorte: "comigo" });

    fireEvent.click(document.getElementById(idLinhaContato(RICARDO))!);
    fireEvent.click(screen.getByRole("button", { name: "← Contatos" }));

    // "← Contatos" também cria um passo: sem a opção substituir.
    expect(irPara.mock.calls).toEqual([[RICARDO], [null]]);
    expect(screen.getByTestId("tabela")).toBeInTheDocument();
    expect(registro.tabela?.filtros).toEqual(mudados);
    expect(screen.getByRole("textbox", { name: "Buscar contato" })).toHaveValue("clinica");
  });

  it("ao voltar, o foco vai para a linha do contato aberto (focoContatoId = ele)", () => {
    montar();
    fireEvent.click(document.getElementById(idLinhaContato(RICARDO))!);
    fireEvent.click(screen.getByRole("button", { name: "← Contatos" }));
    expect(registro.tabela?.focoContatoId).toBe(RICARDO);
    expect(document.activeElement).toBe(document.getElementById(idLinhaContato(RICARDO)));
  });

  it("ao abrir, a área volta para o alto; ao voltar, a rolagem volta para onde estava", () => {
    montar();
    Object.defineProperty(window, "scrollY", { value: 640, configurable: true, writable: true });
    fireEvent.click(document.getElementById(idLinhaContato(JULIANA))!);
    expect(rolarJanela).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));

    Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
    fireEvent.click(screen.getByRole("button", { name: "← Contatos" }));
    expect(rolarJanela).toHaveBeenLastCalledWith(expect.objectContaining({ top: 640 }));
  });

  it("no computador, quem rola é a área com overflow-y auto: alto ao abrir, a altura de antes ao voltar", () => {
    const rolador = areaQueRola();
    montar(null, rolador);
    expect(rolador.el).not.toBeNull();
    rolador.topo = 480;
    fireEvent.click(document.getElementById(idLinhaContato(RICARDO))!);
    expect(rolador.topo).toBe(0);
    // A janela não é mexida quando a área rola por dentro.
    expect(rolarJanela).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "← Contatos" }));
    expect(rolador.topo).toBe(480);
    expect(document.activeElement).toBe(document.getElementById(idLinhaContato(RICARDO)));
  });

  it("o voltar do navegador (endereço sem ?contato=, sem passar pelo aoVoltar) devolve o foco e a rolagem", () => {
    montar();
    Object.defineProperty(window, "scrollY", { value: 320, configurable: true, writable: true });
    fireEvent.click(document.getElementById(idLinhaContato(JULIANA))!);
    expect(irPara).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Voltar do navegador" }));
    expect(irPara).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("tabela")).toBeInTheDocument();
    expect(rolarJanela).toHaveBeenLastCalledWith(expect.objectContaining({ top: 320 }));
    expect(document.activeElement).toBe(document.getElementById(idLinhaContato(JULIANA)));
  });

  it("um id que não existe mostra a tabela e chama irPara(null, { substituir: true }) uma vez", () => {
    montar("ct-nao-existe");
    expect(screen.getByTestId("tabela")).toBeInTheDocument();
    expect(screen.queryByTestId("perfil")).not.toBeInTheDocument();
    // Substitui: o endereço inválido não fica no histórico.
    expect(irPara.mock.calls).toEqual([[null, { substituir: true }]]);
  });

  it("aoApagado volta para a tabela e avisa 'Contato apagado: <nome>' num role=status, que some em 4 s", () => {
    montar();
    fireEvent.click(document.getElementById(idLinhaContato(JULIANA))!);
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));

    // O contato saiu do estado (o dublê apaga de verdade), e mesmo assim a tela navega uma vez só:
    // o efeito do id inexistente não repete o irPara(null). A saída substitui o endereço, para o
    // "voltar" não levar ao perfil apagado.
    expect(irPara.mock.calls).toEqual([[JULIANA], [null, { substituir: true }]]);
    expect(screen.getByTestId("tabela")).toBeInTheDocument();
    expect(registro.idsNoEstado).not.toContain(JULIANA);
    expect(registro.idsNoEstado).toContain(RICARDO);
    expect(screen.getByRole("status")).toHaveTextContent("Contato apagado: Juliana Teste");
    // O contato não existe mais para a tela: a linha dele não recebe o foco.
    expect(registro.tabela?.focoContatoId).toBeNull();

    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("avisar mostra um aviso por vez: o novo troca o anterior", () => {
    montar(JULIANA);
    fireEvent.click(screen.getByRole("button", { name: "Mover" }));
    expect(screen.getByRole("status")).toHaveTextContent("Etapa mudada");
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(screen.getByRole("status")).toHaveTextContent("Contato apagado: Juliana Teste");
    expect(screen.queryAllByText(/Etapa mudada/)).toHaveLength(0);
  });
});

describe("Contatos: o endereço (validateSearch)", () => {
  it("aceita só um texto não vazio de até 100 caracteres", () => {
    expect(validarBuscaContatos({ contato: JULIANA })).toEqual({ contato: JULIANA });
    expect(validarBuscaContatos({ contato: `  ${JULIANA}  ` })).toEqual({ contato: JULIANA });
    expect(validarBuscaContatos({ contato: "x".repeat(100) })).toEqual({ contato: "x".repeat(100) });
    for (const ruim of ["", "   ", "x".repeat(101), 42, ["a"], null, undefined, { a: 1 }]) {
      expect(validarBuscaContatos({ contato: ruim })).toEqual({ contato: undefined });
    }
    expect(validarBuscaContatos({})).toEqual({ contato: undefined });
    expect("contato" in validarBuscaContatos({ outro: "x" })).toBe(true);
  });
});
