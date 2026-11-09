import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { limparEstadoOnboarding } from "@/features/onboarding/estado";
import { CHAVES, NOME_CANAL, useDados, useModoDados, type Eu, type Resultado, type ServidorDados } from "@/features/plataforma/dados";
import { useExemplo } from "@/features/plataforma/exemplo/ProvedorExemplo";
import { servidorDaPlataforma } from "@/features/plataforma/dados/servidor.functions";
import { criarClienteFalso, type Consulta, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";
import {
  AREAS,
  AVISO_ONBOARDING_ABERTO,
  AVISO_ONBOARDING_ADMIN,
  AreaVazia,
  Layout,
  LayoutBanco,
  avisoDaCasca,
  respostasDoContexto,
} from "@/features/plataforma/Layout";
import { CHAVE_TOUR_VISTO, TOUR_POR_PESSOA, marcadorDoTour } from "@/features/plataforma/tour";
import { lerContexto, reiniciarContexto, type EstadoContexto } from "@/features/plataforma/contexto/loja";
import { Route as RotaSemAcesso } from "@/routes/sem-acesso";

// F2 (spec de ligar as telas ao banco, 2.2): a casca ligada ao banco. O Layout da rota /app monta o
// ProvedorDados no modo banco e o assinante do tempo real; o papel vem do Eu, o nome do topo de
// membros.nome, a empresa do Contexto atual, o contador do Chat de useAguardando, o rodapé da conexão
// ativa; o Sair limpa o cache do React Query; e a página /sem-acesso. O cliente do Firebase é falso.

const { signOutModulo } = vi.hoisted(() => ({ signOutModulo: vi.fn() }));
vi.mock("@/integrations/firebase/client", () => ({
  firebase: { auth: { signOut: signOutModulo, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));

// As funções de servidor da F4, falsas: o teste confere que o Layout da rota as passa à camada.
const servidorFalso = vi.hoisted(() => ({
  pedirEnvio: vi.fn(() => Promise.resolve({ ok: true })),
  garantirBucketMidias: vi.fn(() => Promise.resolve({ ok: true })),
  marcarLidaNoWhatsApp: vi.fn(() => Promise.resolve({ ok: true, marcada: true })),
  apagarContato: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/features/plataforma/dados/servidor.functions", () => ({ servidorDaPlataforma: servidorFalso }));

// O Sair também esquece os rascunhos da caixa de escrever e os links assinados das mídias: as duas
// funções reais, embrulhadas num espião para o teste conferir a chamada.
const { esquecerRascunhosEspiao, esquecerLinksEspiao } = vi.hoisted(() => ({
  esquecerRascunhosEspiao: vi.fn(),
  esquecerLinksEspiao: vi.fn(),
}));
vi.mock("@/features/plataforma/comum/CaixaEscrever", async (original) => {
  const real = await original<typeof import("@/features/plataforma/comum/CaixaEscrever")>();
  esquecerRascunhosEspiao.mockImplementation(real.esquecerRascunhos);
  return { ...real, esquecerRascunhos: esquecerRascunhosEspiao };
});
vi.mock("@/features/plataforma/dados/midia", async (original) => {
  const real = await original<typeof import("@/features/plataforma/dados/midia")>();
  esquecerLinksEspiao.mockImplementation(real.esquecerLinks);
  return { ...real, esquecerLinks: esquecerLinksEspiao };
});

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type MembroEu = Eu["membro"];
const membro = (papel: "admin" | "atendente", extra: Partial<MembroEu> = {}): MembroEu => ({
  id: "mb-1",
  nome: "Ana Lima",
  email: "ana@teste.com",
  papel,
  ativo: true,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
  ...extra,
});

const conexaoConectada = {
  id: "cx-1",
  nome: "Comercial",
  gateway: "zapi",
  status: "conectada",
  ativa: true,
  oficial: false,
  id_externo: null,
  ultimo_erro: null,
  criado_em: "2026-10-01T12:00:00.000Z",
  atualizado_em: "2026-10-01T12:00:00.000Z",
};

const conversaAguardando = (id: string) => ({
  id,
  contato_id: `ct-${id}`,
  conexao_id: "cx-1",
  modo: "humano",
  motivo_humano: "pediu_humano",
  responsavel_id: null,
  aguardando_humano_desde: "2026-11-01T12:00:00.000Z",
  devolvida_em: null,
  nao_lidas: 1,
  ultima_do_lead_em: "2026-11-01T12:00:00.000Z",
  ultima_mensagem_em: "2026-11-01T12:00:00.000Z",
  ultima_mensagem_preview: "Oi",
  criado_em: "2026-11-01T12:00:00.000Z",
  atualizado_em: "2026-11-01T12:00:00.000Z",
});

const contexto = {
  id: 7,
  empresa_oferta: "Casa Verde Solar. Energia solar para casas",
  cliente_ideal: null,
  preco: null,
  diferenciais: null,
  objecoes: null,
  quando_passar_humano: null,
  tom_voz: "Próximo e direto.",
  horario: null,
  itens: null,
  origem: "onboarding",
  criado_por: null,
  criado_em: "2026-10-01T12:00:00.000Z",
};

interface Banco {
  membro: MembroEu | null;
  conexao: unknown;
  aguardando: unknown[];
  contexto: unknown;
  /** `configuracao.onboarding_concluido_em`; undefined = a linha não chega (a leitura dá nao_encontrado). */
  concluidoEm?: string | null | undefined;
}

function preparar(b: Partial<Banco> = {}) {
  const banco: Banco = { membro: membro("admin"), conexao: conexaoConectada, aguardando: [], contexto, ...b };
  const responder = (c: Consulta): Resposta | undefined => {
    if (c.tabela === "membros") {
      // carregarEu lê com `vistos` (a coluna jsonb do pacote do banco)
      return { data: banco.membro, error: null };
    }
    if (c.tabela === "configuracao") {
      if (banco.concluidoEm === undefined) return undefined;
      return {
        data: { id: 1, espera_lote_s: 8, espera_lote_max_s: 40, onboarding_concluido_em: banco.concluidoEm, atualizado_em: "x", worker_visto_em: null },
        error: null,
      };
    }
    if (c.tabela === "conexoes") return { data: banco.conexao, error: null };
    if (c.tabela === "conversas") return { data: banco.aguardando, error: null };
    if (c.tabela === "contexto_versoes") return { data: banco.contexto, error: null };
    return undefined;
  };
  const f = criarClienteFalso({ uid: UID, consulta: responder });
  const signOut = vi.fn(async () => ({ error: null }));
  const auth = (f.cliente as unknown as { auth: Record<string, unknown> }).auth;
  auth["signOut"] = signOut;
  auth["onAuthStateChange"] = () => ({ data: { subscription: { unsubscribe: () => {} } } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // O que a rota /app faz antes (exigirAcesso → ensureQueryData): o Eu já está no cache.
  if (banco.membro) qc.setQueryData(CHAVES.eu, banco.membro);
  return { f, qc, banco, signOut };
}

function montar(
  p: ReturnType<typeof preparar>,
  {
    url = "/app/chat",
    tourPorPessoa = false,
    servidor,
    area,
    comOnboarding = false,
  }: {
    url?: string;
    /** Põe a rota /onboarding na árvore (o botão do aviso do admin leva para lá). */
    comOnboarding?: boolean;
    /** "padrao": o LayoutBanco sem a prop (vale TOUR_POR_PESSOA). Os outros testes desligam o tour. */
    tourPorPessoa?: boolean | "padrao";
    servidor?: ServidorDados;
    area?: () => ReactNode;
  } = {},
) {
  const raiz = createRootRoute({ component: () => <Outlet /> });
  const app = createRoute({
    getParentRoute: () => raiz,
    path: "/app",
    component: () =>
      tourPorPessoa === "padrao" ? (
        <LayoutBanco cliente={p.f.cliente} servidor={servidor} />
      ) : (
        <LayoutBanco cliente={p.f.cliente} tourPorPessoa={tourPorPessoa} servidor={servidor} />
      ),
  });
  const areas = AREAS.map((a) =>
    createRoute({ getParentRoute: () => app, path: a.id, component: area ?? (() => <AreaVazia area={a.id} />) }),
  );
  const entrar = createRoute({ getParentRoute: () => raiz, path: "/entrar", component: () => <h1>Entrar</h1> });
  const semAcesso = createRoute({ getParentRoute: () => raiz, path: "/sem-acesso", component: () => <h1>Sem acesso</h1> });
  const onboarding = createRoute({ getParentRoute: () => raiz, path: "/onboarding", component: () => <h1>Onboarding</h1> });
  const router = createRouter({
    routeTree: raiz.addChildren([app.addChildren(areas), entrar, semAcesso, ...(comOnboarding ? [onboarding] : [])]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={p.qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  limparEstadoOnboarding();
  window.sessionStorage.clear();
  signOutModulo.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("casca ligada ao banco", () => {
  it("o nome do topo vem de membros.nome, com as iniciais, e a empresa do Contexto atual", async () => {
    const p = preparar();
    montar(p);
    expect(await screen.findByRole("heading", { level: 1, name: "Chat" })).toBeInTheDocument();
    expect(screen.getAllByText("Ana Lima").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AL").length).toBeGreaterThan(0);
    expect(await screen.findByText("Admin · Casa Verde Solar")).toBeInTheDocument();
    // a casca leu o Contexto atual pelo cliente do banco (a versão de maior id)
    expect(p.f.consultas.some((c) => c.tabela === "contexto_versoes")).toBe(true);
  });

  it("o papel é o do Eu: o atendente não vê a Configuração e o topo diz 'Atendente'", async () => {
    const p = preparar({ membro: membro("atendente", { nome: "Bruno Reis" }) });
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    const menu = screen.getByRole("navigation", { name: "Áreas da plataforma" });
    expect(within(menu).getAllByRole("link")).toHaveLength(6);
    expect(within(menu).queryByRole("link", { name: "Configuração" })).toBeNull();
    expect(await screen.findByText("Atendente · Casa Verde Solar")).toBeInTheDocument();
    expect(screen.getAllByText("Bruno Reis").length).toBeGreaterThan(0);
  });

  it("o admin vê as 7 áreas", async () => {
    const p = preparar();
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    const menu = screen.getByRole("navigation", { name: "Áreas da plataforma" });
    expect(within(menu).getAllByRole("link")).toHaveLength(7);
  });

  it("o contador do Chat vem de useAguardando e o rodapé, da conexão ativa", async () => {
    const p = preparar({ aguardando: [conversaAguardando("cv-1"), conversaAguardando("cv-2")] });
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    const menu = screen.getByRole("complementary", { name: "Menu" });
    await waitFor(() => expect(within(menu).getByRole("link", { name: "Chat" })).toHaveAttribute("data-conta", "2"));
    expect(await within(menu).findByText("WhatsApp conectado")).toBeInTheDocument();
    // a conexão foi pedida com as colunas listadas, nunca '*', e só a ativa
    const leitura = p.f.consultas.find((c) => c.tabela === "conexoes")!;
    expect(leitura.valor).not.toBe("*");
    expect(leitura.passos).toContainEqual(["eq", "ativa", true]);
  });

  it("sem conexão ativa, o rodapé diz 'WhatsApp desconectado' e o Chat fica sem contador", async () => {
    const p = preparar({ conexao: null });
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    const menu = screen.getByRole("complementary", { name: "Menu" });
    expect(await within(menu).findByText("WhatsApp desconectado")).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Chat" })).not.toHaveAttribute("data-conta");
  });

  it("monta o assinante do tempo real (um canal só)", async () => {
    const p = preparar();
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await waitFor(() => expect(p.f.canais.filter((c) => c.nome === NOME_CANAL && !c.removido)).toHaveLength(1));
  });

  it("o Sair chama o signOut do cliente, volta para /entrar e limpa o cache do React Query", async () => {
    const p = preparar();
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    const router = montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(p.qc.getQueryData(CHAVES.eu)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[0]!);
    expect(await screen.findByRole("heading", { level: 1, name: "Entrar" })).toBeInTheDocument();
    expect(p.signOut).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/entrar");
    await waitFor(() => expect(p.qc.getQueryCache().getAll()).toHaveLength(0));
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBeNull();
  });

  it("o Sair também esquece os rascunhos da caixa de escrever e os links assinados das mídias", async () => {
    const p = preparar();
    esquecerRascunhosEspiao.mockClear();
    esquecerLinksEspiao.mockClear();
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[0]!);
    expect(await screen.findByRole("heading", { level: 1, name: "Entrar" })).toBeInTheDocument();
    await waitFor(() => expect(esquecerRascunhosEspiao).toHaveBeenCalled());
    expect(esquecerLinksEspiao).toHaveBeenCalledWith(p.qc);
  });

  it("o Sair também apaga o Contexto da aba: o rascunho não salvo não passa para a próxima conta", async () => {
    const p = preparar();
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    // o admin deixou um rascunho, uma versão antiga aberta e a entrada já vista
    const rascunhos = { preco: { texto: "texto que ninguém salvou" } } as unknown as EstadoContexto["rascunhos"];
    reiniciarContexto({ jaEntrou: true, vendo: 3, rascunhos });
    expect(lerContexto().rascunhos).toBe(rascunhos);
    fireEvent.click(screen.getAllByRole("button", { name: "Sair" })[0]!);
    expect(await screen.findByRole("heading", { level: 1, name: "Entrar" })).toBeInTheDocument();
    await waitFor(() => expect(lerContexto().rascunhos).toEqual({}));
    expect(lerContexto().vendo).toBeNull();
    expect(lerContexto().jaEntrou).toBe(false);
  });

  it("o Layout da rota /app passa as funções de servidor da F4 (servidorDaPlataforma) à camada", () => {
    const elemento = Layout();
    expect(elemento.type).toBe(LayoutBanco);
    expect((elemento.props as { servidor?: unknown }).servidor).toBe(servidorDaPlataforma);
  });

  it("com o servidor do Layout: o enviar chama o pedirEnvio, o anexo garante o bucket e o marcar como lida pede o 'lido'", async () => {
    Object.values(servidorFalso).forEach((fn) => fn.mockClear());
    const p = preparar();
    const servidor = (Layout().props as { servidor: ServidorDados }).servidor;
    let resultado: Resultado | undefined;
    function Sonda() {
      const { acoes } = useDados();
      return (
        <>
          <h1>Sonda</h1>
          <button type="button" onClick={async () => void (resultado = await acoes.enviarMensagem("cv-1", { tipo: "texto", texto: "oi" }))}>
            enviar
          </button>
          <button
            type="button"
            onClick={async () => void (resultado = await acoes.enviarMensagem("cv-1", { tipo: "documento", arquivo: new Blob(["x"]) }))}
          >
            anexo
          </button>
          <button type="button" onClick={async () => void (resultado = await acoes.marcarLida("cv-1"))}>
            ler
          </button>
          <button type="button" onClick={async () => void (resultado = await acoes.apagarContato("ct-1"))}>
            apagar
          </button>
        </>
      );
    }
    montar(p, { servidor, area: Sonda });
    await screen.findByRole("heading", { level: 1, name: "Sonda" });

    fireEvent.click(screen.getByRole("button", { name: "enviar" }));
    await waitFor(() => expect(servidorFalso.pedirEnvio).toHaveBeenCalledTimes(1));
    expect(resultado).toMatchObject({ ok: true });

    fireEvent.click(screen.getByRole("button", { name: "anexo" }));
    await waitFor(() => expect(servidorFalso.garantirBucketMidias).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(servidorFalso.pedirEnvio).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "ler" }));
    await waitFor(() => expect(servidorFalso.marcarLidaNoWhatsApp).toHaveBeenCalledWith("cv-1"));

    fireEvent.click(screen.getByRole("button", { name: "apagar" }));
    await waitFor(() => expect(servidorFalso.apagarContato).toHaveBeenCalledWith("ct-1"));
    await waitFor(() => expect(resultado).toEqual({ ok: true }));
  });

  it("no modo banco não há exemplo em memória: a área está no modo banco e useExemplo() não acha o ProvedorExemplo", async () => {
    const p = preparar();
    function SondaSemExemplo() {
      const modo = useModoDados();
      let temExemplo = true;
      try {
        useExemplo();
      } catch {
        temExemplo = false;
      }
      return <h1>{`modo ${modo}, exemplo ${temExemplo ? "sim" : "não"}`}</h1>;
    }
    montar(p, { area: SondaSemExemplo });
    expect(await screen.findByRole("heading", { level: 1, name: "modo banco, exemplo não" })).toBeInTheDocument();
  });

  it("quando o Eu relido vem vazio (desativado no meio da sessão), leva a /sem-acesso", async () => {
    const p = preparar();
    const router = montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    p.banco.membro = null;
    await act(async () => {
      await p.qc.invalidateQueries({ queryKey: CHAVES.eu });
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Sem acesso" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/sem-acesso");
  });
});

describe("o aviso do atendente enquanto o onboarding não terminou (decisão 2)", () => {
  it("o atendente vê 'O admin ainda está configurando a Janete.' com onboarding_concluido_em nulo", async () => {
    const p = preparar({ membro: membro("atendente"), concluidoEm: null });
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(await screen.findByText(AVISO_ONBOARDING_ABERTO)).toBeInTheDocument();
    expect(AVISO_ONBOARDING_ABERTO).toBe("O admin ainda está configurando a Janete.");
    // o atendente leu a configuração (policy configuracao_membro_le)
    expect(p.f.consultas.some((c) => c.tabela === "configuracao")).toBe(true);
  });

  it("com o onboarding concluído, o atendente não vê o aviso", async () => {
    const p = preparar({ membro: membro("atendente"), concluidoEm: "2026-11-01T12:00:00.000Z" });
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await waitFor(() => expect(p.f.consultas.some((c) => c.tabela === "configuracao")).toBe(true));
    expect(screen.queryByText(AVISO_ONBOARDING_ABERTO)).toBeNull();
  });

  it("o admin em /app com o onboarding aberto (convidado, ou pelo endereço) vê o aviso dele, com o botão para concluir", async () => {
    const p = preparar({ membro: membro("admin"), concluidoEm: null });
    const router = montar(p, { comOnboarding: true });
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(await screen.findByText(AVISO_ONBOARDING_ADMIN)).toBeInTheDocument();
    expect(AVISO_ONBOARDING_ADMIN).toBe("O onboarding ainda não foi concluído: a Janete não atende.");
    // o texto do atendente não aparece para o admin
    expect(screen.queryByText(AVISO_ONBOARDING_ABERTO)).toBeNull();
    const botao = screen.getByRole("link", { name: "Concluir o onboarding" });
    fireEvent.click(botao);
    expect(await screen.findByRole("heading", { level: 1, name: "Onboarding" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("o admin com o onboarding concluído não vê aviso nenhum", async () => {
    const p = preparar({ membro: membro("admin"), concluidoEm: "2026-11-01T12:00:00.000Z" });
    montar(p);
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    await waitFor(() => expect(p.f.consultas.some((c) => c.tabela === "configuracao")).toBe(true));
    expect(screen.queryByText(AVISO_ONBOARDING_ADMIN)).toBeNull();
    expect(screen.queryByText(AVISO_ONBOARDING_ABERTO)).toBeNull();
  });

  it("avisoDaCasca: um texto por papel, só com a data nula, e nada enquanto a configuração não chega", () => {
    expect(avisoDaCasca("atendente", { onboarding_concluido_em: null })).toEqual({
      texto: AVISO_ONBOARDING_ABERTO,
      irParaOnboarding: false,
    });
    expect(avisoDaCasca("atendente", { onboarding_concluido_em: "2026-11-01T12:00:00.000Z" })).toBeNull();
    expect(avisoDaCasca("atendente", undefined)).toBeNull();
    expect(avisoDaCasca("admin", { onboarding_concluido_em: null })).toEqual({
      texto: AVISO_ONBOARDING_ADMIN,
      irParaOnboarding: true,
    });
    expect(avisoDaCasca("admin", { onboarding_concluido_em: "2026-11-01T12:00:00.000Z" })).toBeNull();
    expect(avisoDaCasca("admin", undefined)).toBeNull();
  });
});

describe("o tour uma vez por pessoa", () => {
  it("TOUR_POR_PESSOA está ligado: a casca do banco, sem a prop, mostra o tour a quem ainda não viu e grava", async () => {
    expect(TOUR_POR_PESSOA).toBe(true);
    const p = preparar({ membro: membro("atendente") });
    montar(p, { tourPorPessoa: "padrao" });
    expect(await screen.findByRole("region", { name: "Tour da Janete" })).toBeInTheDocument();
    await waitFor(() => expect(p.f.rpcs).toContainEqual({ nome: "marcar_visto", args: { p_onde: "tour" } }));
  });

  it("por pessoa, pelo padrão: quem já viu (vistos.tour, lido da linha de membros) não vê de novo", async () => {
    const p = preparar({ membro: membro("atendente", { vistos: { tour: "2026-11-01T12:00:00.000Z" } }) });
    montar(p, { tourPorPessoa: "padrao" });
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(screen.queryByRole("region", { name: "Tour da Janete" })).toBeNull();
    expect(p.f.rpcs.some((r) => r.nome === "marcar_visto")).toBe(false);
  });

  it("por pessoa: o tour não depende do marcador do onboarding desta aba (o atendente nunca passa por ele)", async () => {
    const p = preparar({ membro: membro("atendente") });
    window.sessionStorage.clear();
    montar(p, { tourPorPessoa: true });
    expect(await screen.findByRole("region", { name: "Tour da Janete" })).toBeInTheDocument();
  });

  it("por pessoa: quem já viu (vistos.tour) não vê de novo", async () => {
    const p = preparar({ membro: membro("admin", { vistos: { tour: "2026-11-01T12:00:00.000Z" } }) });
    montar(p, { tourPorPessoa: true });
    await screen.findByRole("heading", { level: 1, name: "Chat" });
    expect(screen.queryByRole("region", { name: "Tour da Janete" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ver o tour de novo" }).length).toBeGreaterThan(0);
    expect(p.f.rpcs.some((r) => r.nome === "marcar_visto")).toBe(false);
  });

  it("marcadorDoTour: por pessoa lê vistos.tour; na regra de hoje, o marcador da aba e o onboarding", () => {
    const marcarNoBanco = vi.fn();
    expect(marcadorDoTour({ porPessoa: true, vistoEm: null, marcarNoBanco })).toMatchObject({ visto: false, podeComecarSozinho: true });
    expect(marcadorDoTour({ porPessoa: true, vistoEm: "2026-11-01T12:00:00.000Z", marcarNoBanco }).visto).toBe(true);
    marcadorDoTour({ porPessoa: true, vistoEm: null, marcarNoBanco }).marcar();
    expect(marcarNoBanco).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBe("1");
    window.sessionStorage.clear();
    expect(marcadorDoTour({ porPessoa: false, onboardingConcluido: false })).toMatchObject({ visto: false, podeComecarSozinho: false });
    expect(marcadorDoTour({ porPessoa: false, onboardingConcluido: true }).podeComecarSozinho).toBe(true);
  });
});

describe("respostasDoContexto", () => {
  it("leva a empresa e o tom; o que está vazio não entra", () => {
    expect(respostasDoContexto(null)).toEqual({});
    expect(respostasDoContexto({ ...contexto, tom_voz: null, numero: null, restaurada_de: null } as never)).toEqual({
      empresa_oferta: contexto.empresa_oferta,
    });
  });
});

describe("/sem-acesso", () => {
  function montarSemAcesso() {
    const qc = new QueryClient();
    qc.setQueryData(CHAVES.eu, null);
    const Pagina = RotaSemAcesso.options.component!;
    const raiz = createRootRoute({ component: () => <Outlet /> });
    const pagina = createRoute({ getParentRoute: () => raiz, path: "/sem-acesso", component: () => <Pagina /> });
    const entrar = createRoute({ getParentRoute: () => raiz, path: "/entrar", component: () => <h1>Entrar</h1> });
    const convite = createRoute({ getParentRoute: () => raiz, path: "/convite", component: () => <h1>Convite</h1> });
    const router = createRouter({
      routeTree: raiz.addChildren([pagina, entrar, convite]),
      history: createMemoryHistory({ initialEntries: ["/sem-acesso"] }),
    });
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return { qc, router };
  }

  it("mostra o aviso da decisão 1 no cartão do login, com Sair", async () => {
    montarSemAcesso();
    expect(await screen.findByRole("heading", { level: 1, name: "Sua conta não tem acesso" })).toBeInTheDocument();
    expect(screen.getByText("Peça um convite ao admin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("o convidado que caiu aqui (Redirect URL faltando) tem o caminho para /convite", async () => {
    const { router } = montarSemAcesso();
    const link = await screen.findByRole("link", { name: "Abrir o convite" });
    expect(screen.getByText(/Recebeu um convite\?/)).toBeInTheDocument();
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Convite" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/convite");
  });

  it("o Sair encerra a sessão, limpa o cache e volta para /entrar", async () => {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
    const { qc, router } = montarSemAcesso();
    fireEvent.click(await screen.findByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Entrar" })).toBeInTheDocument();
    expect(signOutModulo).toHaveBeenCalledTimes(1);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(router.state.location.pathname).toBe("/entrar");
    expect(window.sessionStorage.getItem(CHAVE_TOUR_VISTO)).toBeNull();
  });
});
