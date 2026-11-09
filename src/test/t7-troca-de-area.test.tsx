import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState, type JSX, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL, gravarEstadoOnboarding, limparEstadoOnboarding } from "@/features/onboarding/estado";
import { AREAS, areaPorId, type AreaId } from "@/features/plataforma/areas";
import { AreaVazia, CarregandoArea, ESPERA_ESQUELETO_MS, VistaArea, idTituloArea } from "@/features/plataforma/AreaVazia";
import { ID_TITULO_DASHBOARD } from "@/features/plataforma/dashboard/dados";
import { TelaDashboard } from "@/features/plataforma/dashboard/TelaDashboard";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { TelaEquipe } from "@/features/plataforma/equipe";
import { criarEstadoInicial } from "@/features/plataforma/exemplo";
import { LayoutExemplo as Layout } from "@/features/plataforma/Layout";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";
import { CHAVE_TOUR_VISTO } from "@/features/plataforma/tour";
import { routeTree } from "@/routeTree.gen";

// A troca de área (02/11): o código de cada área desce em segundo plano depois que a casca abre; na
// 1ª visita, com o código ainda chegando (ou o acesso de /app ainda renovando o login), fica o
// esqueleto da área nova no lugar da anterior; a animação de entrada roda uma vez por troca; o
// Dashboard não fica em branco esperando a tela final.

const { getUser, signOut, onAuthStateChange } = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => undefined } } })),
}));
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getUser, signOut, onAuthStateChange } } }));

// O símbolo em trânsito: por padrão, sem voo (a plataforma já abre pronta); o teste da chegada liga.
const voo = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return {
    ...real,
    useVooJanete: () => voo,
    medirJanete: () => null,
    rolarAteEMedir: () => Promise.resolve({ x: 40, y: 860, tamanho: 44 }),
    // Como a de verdade (procura de 16 em 16 ms, até o limite), menos a largura, que o jsdom não mede.
    esperarElemento: (id: string, limiteMs = 2000) =>
      new Promise<HTMLElement | null>((resolver) => {
        const inicio = Date.now();
        const olhar = () => {
          const el = document.getElementById(id);
          if (el || Date.now() - inicio > limiteMs) return resolver(el);
          setTimeout(olhar, 16);
        };
        olhar();
      }),
  };
});

// Leituras que o teste segura: a da Equipe fica "carregando" e a do Dashboard fica sem os números
// até o teste soltar (no exemplo, os dois chegam na hora).
const { equipeEspera, painelEspera, telaFinal } = vi.hoisted(() => {
  const criar = () => {
    let ligado = false;
    const ouvintes = new Set<() => void>();
    return {
      ler: () => ligado,
      mudar: (valor: boolean) => {
        ligado = valor;
        ouvintes.forEach((ouvinte) => ouvinte());
      },
      assinar: (ouvinte: () => void) => {
        ouvintes.add(ouvinte);
        return () => void ouvintes.delete(ouvinte);
      },
    };
  };
  return { equipeEspera: criar(), painelEspera: criar(), telaFinal: { pedidos: 0, desenhos: 0 } };
});
vi.mock("@/features/plataforma/dados/equipe", async (original) => {
  const real = await original<typeof import("@/features/plataforma/dados/equipe")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...real,
    useEquipe: () => {
      const leitura = real.useEquipe();
      const carregando = useSyncExternalStore(equipeEspera.assinar, equipeEspera.ler);
      return carregando ? { ...leitura, dados: undefined, carregando: true } : leitura;
    },
  };
});
vi.mock("@/features/plataforma/dashboard/dados", async (original) => {
  const real = await original<typeof import("@/features/plataforma/dashboard/dados")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...real,
    useEstadoPainel: () => {
      const estado = real.useEstadoPainel();
      const segurar = useSyncExternalStore(painelEspera.assinar, painelEspera.ler);
      return segurar ? { ...estado, pronto: false } : estado;
    },
  };
});

// A tela final do Dashboard nunca fica pronta, e o teste sabe quando ela foi pedida e quando o
// Suspense tentou desenhá-la. Só um teste deste arquivo monta o TelaDashboard: o módulo é pedido uma
// vez por arquivo. O módulo chega na hora e a tela suspende para sempre (o mesmo osso na espera): uma
// fábrica que nunca resolve deixava o mock "a meio caminho" no vitest, e o 2º import do TelaDashboard
// (o do lazy, quando os números chegam) caía no módulo de verdade, que desenha <Link> sem o roteador
// (TypeError em useLinkProps, só quando o import de verdade chegava antes de o teste acabar).
vi.mock("@/features/plataforma/dashboard/versoes/final/TelaDashboardFinal", () => {
  telaFinal.pedidos += 1;
  const nunca = new Promise<never>(() => undefined);
  return {
    TelaDashboardFinal: () => {
      telaFinal.desenhos += 1;
      throw nunca;
    },
  };
});

// Passa o tempo em passos curtos, cada um num act() próprio (o React pinta entre um e outro).
async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 20) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(20, ms - feito)));
  }
}

type Telas = Partial<Record<AreaId, () => JSX.Element>>;
type Codigo = () => Promise<{ default: () => JSX.Element }>;

interface OpcoesRoteador {
  papel?: Papel;
  /** Áreas cujo código chega quando a promessa resolver (com o esqueleto da rota, como no app). */
  espera?: Partial<Record<AreaId, Codigo>>;
  /** O acesso de /app nas trocas dentro dele (o getSession que renova o login pela rede). */
  acessoNaTroca?: () => Promise<void> | undefined;
}

/**
 * Um roteador como o do app: a casca em /app e as 7 áreas dentro dela, todas com o esqueleto da espera
 * (como as rotas de src/routes/app/: com o Suspense do esqueleto em todas, a área anterior fica
 * montada e escondida enquanto a nova chega, em vez de desmontar).
 */
function criarRoteador(url: string, telas: Telas = {}, opcoes: OpcoesRoteador = {}) {
  const raiz = createRootRoute({ component: () => <Outlet /> });
  const app = createRoute({
    getParentRoute: () => raiz,
    path: "/app",
    beforeLoad: ({ cause }) => (cause === "stay" ? opcoes.acessoNaTroca?.() : undefined),
    component: () => <Layout papelInicial={opcoes.papel} />,
  });
  const areas = AREAS.map((area) => {
    const codigo = opcoes.espera?.[area.id];
    return createRoute({
      getParentRoute: () => app,
      path: area.id,
      component: codigo ? lazyRouteComponent(codigo) : (telas[area.id] ?? (() => <AreaVazia area={area.id} />)),
      pendingComponent: () => <CarregandoArea area={area.id} />,
      pendingMs: ESPERA_ESQUELETO_MS,
      pendingMinMs: 0,
    });
  });
  return createRouter({
    routeTree: raiz.addChildren([app.addChildren(areas)]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
}

/** O código de uma área que só chega quando o teste soltar. */
function codigoSegurado(area: AreaId, texto: string) {
  let soltar: () => void = () => undefined;
  const promessa = new Promise<{ default: () => JSX.Element }>((resolver) => {
    soltar = () =>
      resolver({
        default: () => (
          <VistaArea area={area}>
            <p>{texto}</p>
          </VistaArea>
        ),
      });
  });
  return { codigo: () => promessa, soltar: () => soltar() };
}

function clicarNoMenu(nome: string) {
  const link = document.querySelector(`nav[data-dock] a[aria-label="${nome}"]`);
  if (!link) throw new Error(`sem o link ${nome} no menu`);
  fireEvent.click(link);
}

const esqueleto = (nome: string) => screen.queryByRole("status", { name: `Carregando ${nome}` });
const vistaDa = (area: AreaId) => document.querySelector(`main section[data-area="${area}"]:not([data-carregando-area])`);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  limparEstadoOnboarding();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
  gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "preparando", concluidoEm: "2026-11-01T12:00:00.000Z" });
  getUser.mockReset().mockResolvedValue({ data: { user: { user_metadata: { nome: "Operador Teste" } } }, error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  voo.ativo = false;
  equipeEspera.mudar(false);
  painelEspera.mudar(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("t7 · as rotas das áreas", () => {
  const roteador = () => createRouter({ routeTree, context: { queryClient: new QueryClient() } });

  it.each(AREAS.map((a) => [a.id, a] as const))("%s: espera o código no máximo ESPERA_ESQUELETO_MS e mostra o esqueleto da área", (_id, area) => {
    const rota = roteador().routesById[area.rota];
    expect(rota.options.pendingMs).toBe(ESPERA_ESQUELETO_MS);
    // a área entra assim que o código chega (sem segurar o esqueleto na tela)
    expect(rota.options.pendingMinMs).toBe(0);
    const Esqueleto = rota.options.pendingComponent;
    if (!Esqueleto) throw new Error(`a rota ${area.rota} não tem pendingComponent`);
    render(<Esqueleto />);
    expect(screen.getByRole("heading", { level: 1, name: area.nome })).toBeInTheDocument();
    expect(document.querySelector(`[data-carregando-area][data-area="${area.id}"]`)).not.toBeNull();
    expect(esqueleto(area.nome)).toHaveAttribute("aria-busy", "true");
  });

  it("o limite da espera é curto: abaixo dos 100 ms que a pessoa percebe como atraso", () => {
    expect(ESPERA_ESQUELETO_MS).toBeLessThanOrEqual(100);
  });
});

describe("t7 · o esqueleto da área", () => {
  it("título e osso da área, sem o id do foco (o foco vai para o h1 da área, quando ela abre)", () => {
    render(<CarregandoArea area="contexto" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Contexto" });
    expect(h1).not.toHaveAttribute("id");
    expect(document.getElementById(idTituloArea("contexto"))).toBeNull();
    expect(screen.getByText(areaPorId("contexto").descricao)).toBeInTheDocument();
  });

  it.each(["contatos", "dashboard"] as const)("%s: sem a frase, como a tela de carregando dela", (area) => {
    render(<CarregandoArea area={area} />);
    expect(screen.getByRole("heading", { level: 1, name: areaPorId(area).nome })).toBeInTheDocument();
    expect(screen.queryByText(areaPorId(area).descricao)).not.toBeInTheDocument();
  });

  it("o Dashboard tem o título em osso (a saudação depende da hora e do nome), com o nome para o leitor de tela", () => {
    render(<CarregandoArea area="dashboard" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Dashboard" });
    expect(h1).not.toHaveTextContent("Dashboard");
  });

  it("aparece de uma vez, sem a animação de entrada (que começa transparente)", () => {
    render(<CarregandoArea area="kanban" />);
    expect(document.querySelector("[data-carregando-area]")).toHaveAttribute("data-sem-entrada", "");
  });
});

describe("t7 · a troca de área na casca", () => {
  it("na 1ª visita, com o código ainda chegando: o esqueleto da área nova no lugar da anterior, e a área quando o código chega", async () => {
    const contatos = codigoSegurado("contatos", "tabela dos contatos");
    const router = criarRoteador(
      "/app/contexto",
      {
        contexto: () => (
          <VistaArea area="contexto">
            <p>discos do contexto</p>
          </VistaArea>
        ),
      },
      { espera: { contatos: contatos.codigo } },
    );
    render(<RouterProvider router={router} />);
    await screen.findByText("discos do contexto");

    clicarNoMenu("Contatos");
    await passar(ESPERA_ESQUELETO_MS + 60);
    expect(esqueleto("Contatos")).toBeInTheDocument();
    // a área anterior sai da vista (o React a esconde enquanto mostra o esqueleto)
    const anterior = screen.queryByText("discos do contexto");
    if (anterior) expect(anterior).not.toBeVisible();

    await act(async () => contatos.soltar());
    expect(await screen.findByText("tabela dos contatos")).toBeVisible();
    expect(esqueleto("Contatos")).not.toBeInTheDocument();
  });

  it("na troca que espera o acesso de /app (o login renovando pela rede): a anterior fica até o limite, depois o esqueleto da nova; a largura segue a tela", async () => {
    let lento = false;
    let soltarAcesso: () => void = () => undefined;
    const router = criarRoteador(
      "/app/contexto",
      {
        contexto: () => (
          <VistaArea area="contexto">
            <p>discos do contexto</p>
          </VistaArea>
        ),
        contatos: () => (
          <VistaArea area="contatos">
            <p>tabela dos contatos</p>
          </VistaArea>
        ),
      },
      { acessoNaTroca: () => (lento ? new Promise<void>((resolver) => (soltarAcesso = resolver)) : undefined) },
    );
    render(<RouterProvider router={router} />);
    await screen.findByText("discos do contexto");
    const main = screen.getByRole("main");
    const conteudo = () => main.querySelector("[data-esperando]");

    lento = true;
    clicarNoMenu("Contatos");
    await passar(40);
    // o topo já é Contatos; a área na tela, e a largura dela, ainda são as do Contexto
    expect(within(main).getByText("Contatos", { selector: "b" })).toBeInTheDocument();
    expect(main).toHaveAttribute("data-area-aberta", "contexto");
    expect(esqueleto("Contatos")).not.toBeInTheDocument();
    expect(conteudo()).toBeNull();

    await passar(ESPERA_ESQUELETO_MS + 40);
    expect(esqueleto("Contatos")).toBeInTheDocument();
    expect(conteudo()).not.toBeNull();
    expect(main).toHaveAttribute("data-area-aberta", "contatos");

    await act(async () => soltarAcesso());
    expect(await screen.findByText("tabela dos contatos")).toBeInTheDocument();
    expect(esqueleto("Contatos")).not.toBeInTheDocument();
    expect(conteudo()).toBeNull();
    expect(main).toHaveAttribute("data-area-aberta", "contatos");
    // o esqueleto já fez a entrada desta visita: a área entra no lugar dele, sem animação
    expect(vistaDa("contatos")).toHaveAttribute("data-sem-entrada", "");
  });

  it("a entrada roda uma vez por troca: o esqueleto e as telas seguintes, na mesma visita, sem animação; outra área, e a volta, animadas", async () => {
    // cada etapa é uma peça diferente, como nas telas: o React monta a vista de novo a cada uma
    function Etapas({ area, children }: { area: AreaId; children?: ReactNode }) {
      const [etapa, setEtapa] = useState<"carregando" | "pronta">("carregando");
      return (
        <>
          <button type="button" onClick={() => setEtapa("pronta")}>
            dados chegaram
          </button>
          {etapa === "carregando" ? (
            <VistaArea area={area}>
              <p>carregando</p>
            </VistaArea>
          ) : (
            <div>
              <VistaArea area={area}>{children ?? <p>pronta</p>}</VistaArea>
            </div>
          )}
        </>
      );
    }
    const router = criarRoteador("/app/contexto", { contexto: () => <Etapas area="contexto" /> });
    render(<RouterProvider router={router} />);

    await screen.findByText("carregando");
    // a 1ª vista da visita entra animada
    expect(vistaDa("contexto")).not.toHaveAttribute("data-sem-entrada");

    fireEvent.click(screen.getByRole("button", { name: "dados chegaram" }));
    await screen.findByText("pronta");
    expect(vistaDa("contexto")).toHaveAttribute("data-sem-entrada", "");

    // outra área: entra animada; e a volta ao Contexto é outra visita, que entra animada de novo
    clicarNoMenu("Chat");
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(vistaDa("chat")).not.toHaveAttribute("data-sem-entrada");
    clicarNoMenu("Contexto");
    await screen.findByText("carregando");
    expect(vistaDa("contexto")).not.toHaveAttribute("data-sem-entrada");
  });

  it("a área anterior que monta de novo no meio da troca (os dados dela chegaram) não tira a entrada da nova", async () => {
    function ContextoComDados() {
      const [pronta, setPronta] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setPronta(true)}>
            dados do contexto
          </button>
          {pronta ? (
            <div>
              <VistaArea area="contexto">
                <p>contexto pronto</p>
              </VistaArea>
            </div>
          ) : (
            <VistaArea area="contexto">
              <p>contexto carregando</p>
            </VistaArea>
          )}
        </>
      );
    }
    // A troca espera o acesso de /app: a casca põe o esqueleto da área nova e esconde a anterior pelo
    // CSS, montada (no esqueleto do roteador, o Suspense esconde a anterior e não roda os efeitos dela).
    let lento = false;
    let soltarAcesso: () => void = () => undefined;
    const router = criarRoteador(
      "/app/contexto",
      {
        contexto: () => <ContextoComDados />,
        contatos: () => (
          <VistaArea area="contatos">
            <p>tabela dos contatos</p>
          </VistaArea>
        ),
      },
      { acessoNaTroca: () => (lento ? new Promise<void>((resolver) => (soltarAcesso = resolver)) : undefined) },
    );
    render(<RouterProvider router={router} />);
    await screen.findByText("contexto carregando");

    lento = true;
    clicarNoMenu("Contatos");
    await passar(ESPERA_ESQUELETO_MS + 60);
    expect(esqueleto("Contatos")).toBeInTheDocument();
    // os dados do Contexto chegam com ele escondido debaixo do esqueleto (o jsdom não aplica o CSS)
    fireEvent.click(screen.getByRole("button", { name: "dados do contexto" }));
    await screen.findByText("contexto pronto");
    await passar(40);

    await act(async () => soltarAcesso());
    await screen.findByText("tabela dos contatos");
    expect(vistaDa("contatos")).toHaveAttribute("data-sem-entrada", "");
  });

  it("na revisita, com o código já baixado, a área troca na hora, sem esqueleto", async () => {
    const contatos = codigoSegurado("contatos", "tabela dos contatos");
    const router = criarRoteador("/app/contexto", {}, { espera: { contatos: contatos.codigo } });
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Contexto" });
    clicarNoMenu("Contatos");
    await act(async () => contatos.soltar());
    await screen.findByText("tabela dos contatos");
    clicarNoMenu("Contexto");
    await screen.findByRole("heading", { level: 1, name: "Contexto" });

    clicarNoMenu("Contatos");
    await passar(20);
    expect(screen.getByText("tabela dos contatos")).toBeInTheDocument();
    await passar(ESPERA_ESQUELETO_MS + 60);
    expect(esqueleto("Contatos")).not.toBeInTheDocument();
  });

  it("chegando por link direto com o código da área ainda baixando: o foco vai para o título da área quando ela abre", async () => {
    const contatos = codigoSegurado("contatos", "tabela dos contatos");
    const router = criarRoteador("/app/contatos", {}, { espera: { contatos: contatos.codigo } });
    render(<RouterProvider router={router} />);
    await passar(300);
    expect(esqueleto("Contatos")).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);

    await act(async () => contatos.soltar());
    await screen.findByText("tabela dos contatos");
    await passar(100);
    expect(document.activeElement).toBe(document.getElementById(idTituloArea("contatos")));
  });

  it("o foco espera o título mesmo numa troca lenta (o login renovando leva mais de 2 s)", async () => {
    const contatos = codigoSegurado("contatos", "tabela dos contatos");
    const router = criarRoteador("/app/contatos", {}, { espera: { contatos: contatos.codigo } });
    render(<RouterProvider router={router} />);
    await passar(3000);
    expect(document.activeElement).toBe(document.body);
    await act(async () => contatos.soltar());
    await screen.findByText("tabela dos contatos");
    await passar(100);
    expect(document.activeElement).toBe(document.getElementById(idTituloArea("contatos")));
  });

  it("Equipe: a tela pronta, que monta depois da de carregando na mesma visita, entra sem animação", async () => {
    equipeEspera.mudar(true);
    const router = criarRoteador("/app/equipe", { equipe: () => <TelaEquipe /> });
    render(<RouterProvider router={router} />);
    await screen.findByRole("status", { name: "Carregando a equipe" });
    const raiz = () => document.querySelector(`main section[aria-labelledby="${idTituloArea("equipe")}"]`);
    expect(raiz()).not.toHaveAttribute("data-sem-entrada");

    act(() => equipeEspera.mudar(false));
    await screen.findByRole("region", { name: "Quem atende" });
    expect(raiz()).toHaveAttribute("data-sem-entrada", "");

    // os dados somem (a leitura recomeça) na mesma visita: a de carregando volta sem animação
    act(() => equipeEspera.mudar(true));
    await screen.findByRole("status", { name: "Carregando a equipe" });
    expect(raiz()).toHaveAttribute("data-sem-entrada", "");
  });

  it("fora da casca (uma tela sozinha), toda vista entra animada", () => {
    const { unmount } = render(<VistaArea area="chat">x</VistaArea>);
    expect(document.querySelector('section[data-area="chat"]')).not.toHaveAttribute("data-sem-entrada");
    unmount();
    render(<VistaArea area="chat">y</VistaArea>);
    expect(document.querySelector('section[data-area="chat"]')).not.toHaveAttribute("data-sem-entrada");
  });

  it("o CSS tira a animação das vistas marcadas e esconde a área anterior enquanto a casca espera", () => {
    const css = (arquivo: string) => readFileSync(path.resolve(__dirname, "..", "features/plataforma", arquivo), "utf-8");
    const regra = (texto: string, seletor: string) => {
      const i = texto.indexOf(`${seletor} {`);
      return i < 0 ? null : texto.slice(i, texto.indexOf("}", i));
    };
    expect(regra(css("AreaVazia.module.css"), ".vista[data-sem-entrada]")).toMatch(/animation:\s*none/);
    expect(regra(css("equipe/TelaEquipe.module.css"), ".eqTela[data-sem-entrada]")).toMatch(/animation:\s*none/);
    expect(
      regra(css("Plataforma.module.css"), ".platConteudo[data-esperando] > :not([data-carregando-area]):not([data-aviso-casca])"),
    ).toMatch(/display:\s*none/);
  });
});

describe("t7 · o código das áreas desce em segundo plano", () => {
  it("depois que a plataforma abre, baixa o código das 7 áreas, na ordem do menu", async () => {
    const router = criarRoteador("/app/chat");
    const baixar = vi.spyOn(router, "loadRouteChunk");
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await passar(4000);
    expect(baixar.mock.calls.map(([rota]) => rota.id)).toEqual(AREAS.map((a) => a.rota));
  });

  it("uma por vez: a próxima só começa depois que a anterior chega", async () => {
    const router = criarRoteador("/app/chat");
    const chegadas: Array<() => void> = [];
    const baixar = vi.spyOn(router, "loadRouteChunk").mockImplementation(() => new Promise<void>((resolver) => chegadas.push(resolver)));
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await passar(2000);
    expect(baixar).toHaveBeenCalledTimes(1);
    await act(async () => chegadas[0]!());
    await passar(1000);
    expect(baixar).toHaveBeenCalledTimes(2);
  });

  it("a casca que sai (Sair, troca de conta) para a fila", async () => {
    const router = criarRoteador("/app/chat");
    const chegadas: Array<() => void> = [];
    const baixar = vi.spyOn(router, "loadRouteChunk").mockImplementation(() => new Promise<void>((resolver) => chegadas.push(resolver)));
    const { unmount } = render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await passar(2000);
    expect(baixar).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => chegadas[0]!());
    await passar(2000);
    expect(baixar).toHaveBeenCalledTimes(1);
  });

  it("o atendente não baixa a Configuração (ela não está no menu dele)", async () => {
    const router = criarRoteador("/app/chat", {}, { papel: "atendente" });
    const baixar = vi.spyOn(router, "loadRouteChunk");
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await passar(4000);
    const ids = baixar.mock.calls.map(([rota]) => rota.id);
    expect(ids).not.toContain("/app/configuracao");
    expect(ids).toEqual(AREAS.filter((a) => a.id !== "configuracao").map((a) => a.rota));
  });

  it("uma falha ao baixar uma área não para a fila", async () => {
    const router = criarRoteador("/app/chat");
    const original = router.loadRouteChunk;
    const baixar = vi
      .spyOn(router, "loadRouteChunk")
      .mockImplementation((rota, tipo) => (rota.id === "/app/contatos" ? Promise.reject(new Error("rede")) : original(rota, tipo)));
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await passar(4000);
    expect(baixar.mock.calls.map(([rota]) => rota.id)).toEqual(AREAS.map((a) => a.rota));
  });

  it("cede a vez enquanto há leitura do banco em andamento (no máximo uns 6 s)", async () => {
    const queryClient = new QueryClient();
    void queryClient.fetchQuery({ queryKey: ["lendo"], queryFn: () => new Promise(() => undefined) }).catch(() => undefined);
    const router = criarRoteador("/app/chat");
    const baixar = vi.spyOn(router, "loadRouteChunk");
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await passar(3000);
    expect(baixar).not.toHaveBeenCalled();
    await passar(6000);
    expect(baixar).toHaveBeenCalled();
  });

  it("cede a vez às leituras também onde o navegador avisa quando fica livre (o aviso volta na hora)", async () => {
    vi.stubGlobal("requestIdleCallback", (fn: IdleRequestCallback) =>
      window.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 0),
    );
    vi.stubGlobal("cancelIdleCallback", (id: number) => window.clearTimeout(id));
    let desmontar: (() => void) | undefined;
    try {
      const queryClient = new QueryClient();
      void queryClient.fetchQuery({ queryKey: ["lendo"], queryFn: () => new Promise(() => undefined) }).catch(() => undefined);
      const router = criarRoteador("/app/chat");
      const baixar = vi.spyOn(router, "loadRouteChunk");
      desmontar = render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      ).unmount;
      await screen.findByRole("heading", { level: 1, name: "Chat" });
      await passar(3000);
      expect(baixar).not.toHaveBeenCalled();
      await passar(6000);
      expect(baixar).toHaveBeenCalled();
    } finally {
      // desmonta antes de devolver as funções do navegador: a limpeza da casca ainda cancela o aviso
      desmontar?.();
      vi.unstubAllGlobals();
    }
  });

  it("com a economia de dados ligada, não baixa nada", async () => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } });
    try {
      const router = criarRoteador("/app/chat");
      const baixar = vi.spyOn(router, "loadRouteChunk");
      render(<RouterProvider router={router} />);
      await screen.findByRole("heading", { level: 1, name: "Chat" });
      await passar(4000);
      expect(baixar).not.toHaveBeenCalled();
    } finally {
      delete (navigator as Navigator & { connection?: unknown }).connection;
    }
  });

  it("espera a chegada da plataforma terminar (o símbolo em voo) antes de começar", async () => {
    voo.ativo = true;
    const router = criarRoteador("/app/chat");
    const baixar = vi.spyOn(router, "loadRouteChunk");
    render(<RouterProvider router={router} />);
    await passar(600);
    expect(baixar).not.toHaveBeenCalled();
    await passar(4000);
    expect(baixar).toHaveBeenCalled();
  });

  it("passar o mouse num item do menu já baixa a área dele", async () => {
    const router = criarRoteador("/app/chat");
    const preCarregar = vi.spyOn(router, "preloadRoute");
    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    const link = document.querySelector('nav[data-dock] a[aria-label="Kanban"]');
    if (!link) throw new Error("sem o link do Kanban");
    fireEvent.mouseEnter(link);
    await passar(120);
    expect(preCarregar.mock.calls.some(([opcoes]) => (opcoes as { to?: string }).to === "/app/kanban")).toBe(true);
  });
});

describe("t7 · o Dashboard esperando a tela final", () => {
  // 14:45 em São Paulo.
  const AGORA = new Date("2026-10-30T17:45:00.000Z");
  const relogio = () => new Date(AGORA);

  it("pede a tela final ao abrir, antes dos números; com os números e sem a tela final, a saudação e o osso, não a área em branco", async () => {
    const pedidosAntes = telaFinal.pedidos;
    painelEspera.mudar(true);
    render(
      <ProvedorPapel>
        <ProvedorDados progredirEnvios={false} relogio={relogio} exemplo={() => criarEstadoInicial(AGORA)}>
          <TelaDashboard relogio={relogio} />
        </ProvedorDados>
      </ProvedorPapel>,
    );
    // ainda sem os números, e a tela final já foi pedida (o import é assíncrono: espera ele chegar ao mock)
    await vi.waitFor(() => expect(telaFinal.pedidos).toBe(pedidosAntes + 1));
    expect(screen.getByRole("status", { name: "Carregando o Dashboard" })).toBeInTheDocument();

    act(() => painelEspera.mudar(false));
    await passar(1500);
    // o lazy chegou ao mock (e não ao módulo de verdade, que precisa do roteador) e ele suspendeu
    await vi.waitFor(() => expect(telaFinal.desenhos).toBeGreaterThan(0));
    expect(telaFinal.pedidos).toBe(pedidosAntes + 1);
    const h1 = screen.getByRole("heading", { level: 1, name: /^Boa tarde/ });
    expect(h1).toHaveAttribute("id", ID_TITULO_DASHBOARD);
    expect(screen.getByRole("status", { name: "Carregando o Dashboard" })).toBeInTheDocument();
  });
});
