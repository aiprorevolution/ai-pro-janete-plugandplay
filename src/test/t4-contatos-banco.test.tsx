import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbaFicha } from "@/features/plataforma/contatos/AbaFicha";
import { aoVivoNaLinha, FILTROS_INICIAIS, linhaDoBanco, periodoDeEntrada } from "@/features/plataforma/contatos/dados";
import { PerfilContato } from "@/features/plataforma/contatos/Perfil";
import { TabelaContatos } from "@/features/plataforma/contatos/Tabela";
import { TelaContatos } from "@/features/plataforma/contatos/TelaContatos";
import type { FiltrosTabela } from "@/features/plataforma/contatos/tipos";
import { CHAVES, ProvedorDados, removerPorId, type ServidorDados } from "@/features/plataforma/dados";
import {
  TAMANHO_PAGINA_CONTATOS,
  lerContadores,
  lerPaginaContatos,
  parametrosDaLista,
} from "@/features/plataforma/dados/contatos";
import { criarClienteFalso, type Consulta, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";
import { ProvedorPapel } from "@/features/plataforma/papel";

// Task C3 da spec de ligar as telas ao banco: os Contatos lendo e agindo pela camada de dados, no
// modo banco, com o cliente do Firebase falso (nada vai à rede nem ao banco). A tabela pela rpc
// contatos_lista (páginas de 50) e as abas pela contatos_contadores; o perfil pelas leituras de
// dados/conversa.ts e dados/contatos.ts; apagar pelo servidor; os 3 estados e os textos de erro.

// O perfil usa o roteador (Abrir no Chat, Ver no Kanban, Reconectar); o teste não monta um.
const navegar = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navegar,
}));

// Domingo, 01/11/2026, 23:30 em São Paulo (02:30 UTC de segunda): o dia de São Paulo ainda é o 1º.
const AGORA = new Date("2026-11-02T02:30:00.000Z");
const T = AGORA.getTime();

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CT = "22222222-2222-4222-8222-222222222222";
const CV = "11111111-1111-4111-8111-111111111111";
const ET_NOVO = "e0000000-0000-4000-8000-000000000001";
const ET_GANHO = "e0000000-0000-4000-8000-000000000002";

const membro = (papel: "admin" | "atendente" = "admin") => ({
  id: MB,
  nome: "Ana Souza",
  email: "ana@teste.com",
  papel,
  ativo: true,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
});

const ETAPAS = [
  { id: ET_NOVO, chave: "novo", nome: "Novo", ordem: 1, tipo: "aberta", cor: null, janete_pode_mover: true, arquivada: false },
  { id: ET_GANHO, chave: "ganho", nome: "Ganho", ordem: 2, tipo: "ganho", cor: null, janete_pode_mover: false, arquivada: false },
];

const CONEXAO = {
  id: "cx-1",
  nome: "5511999990000",
  gateway: "zapi",
  status: "conectada",
  ativa: true,
  oficial: false,
  id_externo: null,
  ultimo_erro: null,
  criado_em: "2026-10-01T12:00:00.000Z",
  atualizado_em: "2026-10-01T12:00:00.000Z",
};

const CINCO_MIN_ATRAS = new Date(T - 5 * 60_000).toISOString();

const CONTATO = {
  id: CT,
  nome: "Ricardo Alves",
  nome_whatsapp: "Ricardo",
  telefone: "5511900000001",
  email: null,
  empresa: "Clínica Vale",
  etapa_id: ET_NOVO,
  etapa_desde: "2026-10-30T12:00:00.000Z",
  observacoes: null,
  resumo_janete: "Quer implante; pediu orçamento.",
  primeira_mensagem_em: "2026-10-30T12:00:00.000Z",
  criado_em: "2026-10-30T12:00:00.000Z",
  atualizado_em: CINCO_MIN_ATRAS,
  resumo_janete_em: CINCO_MIN_ATRAS,
  anotacoes_janete: {
    fatos: [
      { rotulo: "Orçamento", valor: "R$ 30 mil", mensagem_id: "m-1" },
      { rotulo: "Prazo", valor: "março" },
    ],
    proximo_passo: { titulo: "Mandar a proposta", texto: "Ele pediu até sexta." },
  },
};

const CONVERSA = {
  id: CV,
  contato_id: CT,
  conexao_id: "cx-1",
  modo: "janete",
  motivo_humano: null,
  responsavel_id: null,
  aguardando_humano_desde: null,
  devolvida_em: null,
  nao_lidas: 2,
  ultima_do_lead_em: "2026-11-01T20:00:00.000Z",
  ultima_mensagem_em: "2026-11-01T20:00:00.000Z",
  ultima_mensagem_preview: "Oi",
  criado_em: "2026-10-30T12:00:00.000Z",
  atualizado_em: "2026-11-01T20:00:00.000Z",
  ultima_mensagem_id: "m-1",
  ultima_da_janete_em: null,
};

const MENSAGEM = {
  id: "m-1",
  conversa_id: CV,
  conexao_id: "cx-1",
  direcao: "entrada",
  origem: "lead",
  tipo: "texto",
  status: "recebida",
  texto: "Oi, quanto custa?",
  transcricao: null,
  momento: "2026-11-01T20:00:00.000Z",
  autor_membro_id: null,
  midia_nome: null,
  midia_mime: null,
  midia_tamanho: null,
  midia_caminho: null,
  midia_status: null,
  editada: false,
  apagada_em: null,
  erro: null,
  id_externo: null,
  id_gateway: null,
  criado_em: "2026-11-01T20:00:00.000Z",
  responde_a_id: null,
  midia_duracao_s: null,
};

/** Uma linha de contatos_lista, como o jsonb do banco. */
function linhaLista(i: number) {
  const id = `c${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`;
  return {
    contato_id: id,
    nome: `Contato ${String(i).padStart(3, "0")}`,
    nome_whatsapp: null,
    telefone: `55119000${String(i).padStart(5, "0")}`,
    email: null,
    empresa: i % 2 ? "Clínica Vale" : null,
    etapa_id: ET_NOVO,
    etapa_ordem: 1,
    primeira_mensagem_em: "2026-10-30T12:00:00.000Z",
    criado_em: "2026-10-30T12:00:00.000Z",
    entrou_em: "2026-10-30T12:00:00.000Z",
    ultima_mensagem_em: "2026-11-01T20:00:00.000Z",
    conversa: {
      id: `v${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`,
      modo: "janete",
      responsavel_id: null,
      motivo_humano: null,
      aguardando_humano_desde: null,
      ultima_mensagem_em: "2026-11-01T20:00:00.000Z",
      ultima_do_lead_em: "2026-11-01T20:00:00.000Z",
      ultima_da_janete_em: null,
      nao_lidas: 0,
    },
  };
}

const CONTADORES = { todos: 120, precisam: 3, novos_hoje: 2, com_janete: 100, comigo: 4 };

/** A lista paginada de 120 contatos, como a contatos_lista devolveria para o deslocamento pedido. */
function paginaDe120(args: Record<string, unknown>) {
  const de = Number(args["p_deslocamento"] ?? 0);
  const linhas = Array.from({ length: 120 }, (_, i) => linhaLista(i + 1)).slice(de, de + Number(args["p_limite"] ?? 50));
  return { total: 120, linhas };
}

/** As consultas que o perfil faz, respondidas com o contato, a conversa e uma mensagem. */
function responderPerfil(c: Consulta, extra: { contato?: unknown } = {}): Resposta | undefined {
  if (c.tabela === "membros") return c.unica ? { data: membro(), error: null } : { data: [membro()], error: null };
  if (c.tabela === "etapas") return { data: ETAPAS, error: null };
  if (c.tabela === "conexoes") return { data: CONEXAO, error: null };
  if (c.tabela === "contatos" && c.op === "select") return { data: "contato" in extra ? extra.contato : CONTATO, error: null };
  if (c.tabela === "conversas" && c.op === "select") return { data: CONVERSA, error: null };
  if (c.tabela === "contato_etapa_historico" || c.tabela === "conversa_eventos") return { data: [], error: null };
  if (c.tabela === "mensagens") {
    // a contagem (head), as mídias (in tipo), a 1ª do lead (eq origem) e as páginas
    if (c.valor === "id") return { data: null, error: null, count: 7 };
    if (c.passos.some((p) => p[0] === "in")) return { data: [], error: null };
    return { data: [MENSAGEM], error: null };
  }
  return undefined;
}

function montar(
  ui: React.ReactNode,
  opcoes: {
    consulta?: (c: Consulta) => Resposta | undefined;
    rpc?: (nome: string, args: Record<string, unknown>) => Resposta | Promise<Resposta> | undefined;
    servidor?: ServidorDados;
    papel?: "admin" | "atendente";
  } = {},
) {
  const papel = opcoes.papel ?? "admin";
  const f = criarClienteFalso({
    uid: UID,
    consulta: opcoes.consulta ?? ((c) => responderPerfil(c)),
    ...(opcoes.rpc ? { rpc: opcoes.rpc } : {}),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(CHAVES.eu, membro(papel));
  const r = render(
    <QueryClientProvider client={qc}>
      <ProvedorPapel inicial={papel}>
        <ProvedorDados fonte="banco" cliente={f.cliente} servidor={opcoes.servidor}>
          {ui}
        </ProvedorDados>
      </ProvedorPapel>
    </QueryClientProvider>,
  );
  return { ...r, f, qc };
}

const registro = vi.hoisted(() => ({ filtros: null as FiltrosTabela | null }));

function Casca({ inicial }: { inicial?: FiltrosTabela }) {
  const [filtros, setFiltros] = useState<FiltrosTabela>(inicial ?? FILTROS_INICIAIS);
  registro.filtros = filtros;
  return <TabelaContatos filtros={filtros} aoMudarFiltros={setFiltros} aoAbrir={() => {}} agora={T} focoContatoId={null} />;
}

const rpcsDe = (f: ReturnType<typeof criarClienteFalso>, nome: string) => f.rpcs.filter((r) => r.nome === nome);

afterEach(() => {
  cleanup();
  navegar.mockClear();
});

/* =============================================================================
   a tabela
   ============================================================================= */

describe("Contatos no banco: a tabela (contatos_lista e contatos_contadores)", () => {
  it("pede a 1ª página de 50 com os filtros iniciais e mostra as linhas, os contadores e o total", async () => {
    const { f } = montar(<Casca />, {
      rpc: (nome, args) =>
        nome === "contatos_lista"
          ? { data: paginaDe120(args), error: null }
          : nome === "contatos_contadores"
            ? { data: CONTADORES, error: null }
            : undefined,
    });
    expect(await screen.findByText("Contato 001")).toBeInTheDocument();
    const [pedido] = rpcsDe(f, "contatos_lista");
    expect(pedido!.args).toEqual({
      p_busca: "",
      p_recorte: "todos",
      p_etapas: [],
      p_entrada_de: null,
      p_entrada_ate: null,
      p_ordem: "ultima",
      p_direcao: "desc",
      p_limite: 50,
      p_deslocamento: 0,
    });
    expect(screen.getAllByRole("row")).toHaveLength(1 + 50);
    expect(await screen.findByText("120 contatos")).toBeInTheDocument();
    const abas = screen.getByRole("group", { name: "Mostrar" });
    expect(within(abas).getByRole("button", { name: /Precisam de você/ })).toHaveTextContent("3");
    expect(within(abas).getByRole("button", { name: /Comigo/ })).toHaveTextContent("4");
    expect(rpcsDe(f, "contatos_contadores")).toHaveLength(1);
  });

  it("a paginação: '1–50 de 120', Próxima pede o deslocamento 50, e mudar a busca volta para a 1ª", async () => {
    const { f } = montar(<Casca />, {
      rpc: (nome, args) =>
        nome === "contatos_lista" ? { data: paginaDe120(args), error: null } : { data: CONTADORES, error: null },
    });
    const nav = await screen.findByRole("navigation", { name: "Páginas de contatos" });
    expect(within(nav).getByText("1–50 de 120")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Anterior" })).toBeDisabled();
    fireEvent.click(within(nav).getByRole("button", { name: "Próxima" }));
    expect(await screen.findByText("Contato 051")).toBeInTheDocument();
    expect(rpcsDe(f, "contatos_lista").at(-1)!.args["p_deslocamento"]).toBe(TAMANHO_PAGINA_CONTATOS);
    expect(within(nav).getByText("51–100 de 120")).toBeInTheDocument();

    // a busca vai com atraso curto e volta para a 1ª página
    fireEvent.change(screen.getByLabelText("Buscar contato"), { target: { value: "clinica" } });
    expect(registro.filtros!.pagina).toBe(0);
    await waitFor(() => expect(rpcsDe(f, "contatos_lista").at(-1)!.args).toMatchObject({ p_busca: "clinica", p_deslocamento: 0 }));
  });

  it("a busca não vai ao banco a cada letra: só depois de uma pausa curta", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { f } = montar(<Casca />, {
        rpc: (nome, args) =>
          nome === "contatos_lista" ? { data: paginaDe120(args), error: null } : { data: CONTADORES, error: null },
      });
      await screen.findByText("Contato 001");
      const campo = screen.getByLabelText("Buscar contato");
      fireEvent.change(campo, { target: { value: "c" } });
      fireEvent.change(campo, { target: { value: "cl" } });
      fireEvent.change(campo, { target: { value: "cli" } });
      // o campo mostra o texto na hora
      expect(campo).toHaveValue("cli");
      expect(rpcsDe(f, "contatos_lista").some((r) => r.args["p_busca"] !== "")).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      await waitFor(() => expect(rpcsDe(f, "contatos_lista").filter((r) => r.args["p_busca"] !== "")).toHaveLength(1));
      expect(rpcsDe(f, "contatos_lista").at(-1)!.args["p_busca"]).toBe("cli");
    } finally {
      vi.useRealTimers();
    }
  });

  it("filtro de etapa e 'Entrou em: últimos 7 dias' vão como uuid[] e datas de São Paulo; a ordem vai junto", async () => {
    const { f } = montar(<Casca />, {
      rpc: (nome, args) =>
        nome === "contatos_lista" ? { data: paginaDe120(args), error: null } : { data: CONTADORES, error: null },
    });
    await screen.findByText("Contato 001");
    fireEvent.click(screen.getByRole("button", { name: "Filtro" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Ganho/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Últimos 7 dias" }));
    fireEvent.click(within(screen.getAllByRole("columnheader")[0]!).getByRole("button"));
    await waitFor(() =>
      expect(rpcsDe(f, "contatos_lista").at(-1)!.args).toMatchObject({
        p_etapas: [ET_GANHO],
        p_entrada_de: "2026-10-26",
        p_entrada_ate: "2026-11-01",
        p_ordem: "contato",
        p_direcao: "asc",
      }),
    );
  });

  it("carregando: o esqueleto; erro: o aviso com 'Tentar de novo', que pede de novo", async () => {
    let falhar = true;
    let soltar: (() => void) | null = null;
    const { f } = montar(<Casca />, {
      rpc: (nome, args) => {
        if (nome === "contatos_contadores") return { data: CONTADORES, error: null };
        // 42501 (sem acesso) não é repetido sozinho: o aviso aparece na hora.
        if (falhar) return new Promise<Resposta>((ok) => (soltar = () => ok({ data: null, error: { code: "42501", message: "x" } })));
        return { data: paginaDe120(args), error: null };
      },
    });
    expect(screen.getByRole("status", { name: "Carregando os contatos" })).toBeInTheDocument();
    await act(async () => soltar?.());
    expect(await screen.findByText("Não deu para carregar os contatos")).toBeInTheDocument();
    expect(screen.getByText("Sua conta não tem acesso a isto.")).toBeInTheDocument();
    falhar = false;
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Contato 001")).toBeInTheDocument();
    expect(rpcsDe(f, "contatos_lista").length).toBeGreaterThanOrEqual(2);
  });

  it("a releitura que falha com a tabela na tela vira um aviso compacto, e as linhas ficam", async () => {
    let falhar = false;
    const { qc } = montar(<Casca />, {
      rpc: (nome, args) => {
        if (nome === "contatos_contadores") return { data: CONTADORES, error: null };
        if (falhar) return { data: null, error: { code: "42501", message: "x" } };
        return { data: paginaDe120(args), error: null };
      },
    });
    expect(await screen.findByText("Contato 001")).toBeInTheDocument();
    falhar = true;
    await act(async () => {
      await qc.refetchQueries({ queryKey: CHAVES.contatos });
    });
    expect(await screen.findByText("Não deu para atualizar os contatos")).toBeInTheDocument();
    expect(screen.queryByText("Não deu para carregar os contatos")).toBeNull();
    expect(screen.getByText("Contato 001")).toBeInTheDocument();
  });

  it("sem acesso (42501): o texto de sem acesso", async () => {
    montar(<Casca />, {
      rpc: (nome) =>
        nome === "contatos_lista"
          ? { data: null, error: { code: "42501", message: "permission denied" } }
          : { data: CONTADORES, error: null },
    });
    expect(await screen.findByText("Sua conta não tem acesso a isto.")).toBeInTheDocument();
  });

  it("vazio: nenhum contato na empresa mostra o vazio da área, sem abas nem paginação", async () => {
    montar(<Casca />, {
      rpc: (nome) =>
        nome === "contatos_lista"
          ? { data: { total: 0, linhas: [] }, error: null }
          : { data: { todos: 0, precisam: 0, novos_hoje: 0, com_janete: 0, comigo: 0 }, error: null },
    });
    expect(await screen.findByRole("heading", { name: "Nenhum contato ainda" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mostrar" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Páginas de contatos" })).toBeNull();
  });
});

/* =============================================================================
   o perfil
   ============================================================================= */

const aoVoltar = vi.fn();
const aoApagado = vi.fn();
const avisar = vi.fn();

function perfil() {
  return <PerfilContato contatoId={CT} agora={T} aoVoltar={aoVoltar} aoApagado={aoApagado} avisar={avisar} />;
}

describe("Contatos no banco: o perfil", () => {
  it("lê o contato, os fatos e o próximo passo de anotacoes_janete (só para ler) e o 'Atualizado' do resumo_janete_em", async () => {
    const { f } = montar(perfil(), {
      rpc: (nome) => (nome === "custo_das_conversas" ? { data: [{ conversa_id: CV, custo_usd: 1.5 }], error: null } : undefined),
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" })).toBeInTheDocument();
    const fatos = screen.getByLabelText("O que a Janete anotou sobre Ricardo");
    expect(within(fatos).getByText("Orçamento")).toBeInTheDocument();
    expect(within(fatos).getByText("março")).toBeInTheDocument();
    // só para ler (decisão 12): nada de editar nos fatos
    expect(within(fatos).queryByRole("textbox")).toBeNull();
    expect(within(fatos).queryByRole("button", { name: /Editar|Apagar/ })).toBeNull();
    expect(screen.getByText("Atualizado há 5 min")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mandar a proposta" })).toBeInTheDocument();
    // o custo de IA do admin vem de custo_das_conversas
    expect(await screen.findByText("US$ 1,50")).toBeInTheDocument();
    expect(rpcsDe(f, "custo_das_conversas")[0]!.args).toEqual({ p_conversas: [CV] });
    // o total de mensagens vem contado no banco
    expect(screen.getByRole("tab", { name: /^Conversa.*7 mensagens/ })).toBeInTheDocument();
  });

  it("marcar como lida pela regra do Chat: o Resumo não marca; abrir a aba Conversa marca", async () => {
    const { f } = montar(perfil(), { rpc: () => undefined });
    await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" });
    expect(rpcsDe(f, "marcar_lida")).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: /Conversa/ }));
    await waitFor(() => expect(rpcsDe(f, "marcar_lida")).toEqual([{ nome: "marcar_lida", args: { p_conversa: CV } }]));
  });

  it("carregando: o esqueleto do contato; erro: o aviso com 'Tentar de novo'", async () => {
    const soltar: (() => void)[] = [];
    montar(perfil(), {
      consulta: (c) =>
        c.tabela === "contatos" && c.op === "select"
          ? (new Promise<Resposta>((ok) => soltar.push(() => ok({ data: null, error: { code: "42501", message: "x" } }))) as unknown as Resposta)
          : responderPerfil(c),
    });
    expect(screen.getByRole("status", { name: "Carregando o contato" })).toBeInTheDocument();
    await waitFor(() => expect(soltar.length).toBeGreaterThan(0));
    await act(async () => {
      for (const s of soltar) s();
    });
    expect(await screen.findByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Voltar para/ })).toBeInTheDocument();
  });

  it("apagar vai ao servidor; o diálogo avisa que ele volta como lead novo; a recusa diz o motivo", async () => {
    const apagarContato = vi.fn(async () => ({ ok: false, erro: "sem_acesso" }));
    montar(perfil(), { servidor: { apagarContato }, rpc: () => undefined });
    await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" });
    fireEvent.click(screen.getByRole("button", { name: "Apagar contato" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(within(dialogo).getByText("Se ele escrever de novo, volta como lead novo.")).toBeInTheDocument();
    expect(within(dialogo).getByText("7 mensagens da conversa")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Apagar para sempre" }));
    });
    expect(apagarContato).toHaveBeenCalledWith(CT);
    expect(avisar).toHaveBeenCalledWith("Só um admin pode apagar contatos.");
    expect(aoApagado).not.toHaveBeenCalled();
  });

  it("apagar que dá certo chama aoApagado com o nome", async () => {
    aoApagado.mockClear();
    const apagarContato = vi.fn(async () => ({ ok: true }));
    montar(perfil(), { servidor: { apagarContato }, rpc: () => undefined });
    await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" });
    fireEvent.click(screen.getByRole("button", { name: "Apagar contato" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apagar para sempre" }));
    });
    expect(aoApagado).toHaveBeenCalledWith("Ricardo Alves");
  });

  it("editar a ficha: o UPDATE que atinge 0 linhas é recusa ('Este contato não existe mais')", async () => {
    const props = { contatoId: CT, agora: T, irParaAba: vi.fn(), verNaConversa: vi.fn(), avisar: vi.fn() };
    const { f } = montar(<AbaFicha {...props} editando={true} aoEditar={() => {}} />, {
      consulta: (c) => (c.tabela === "contatos" && c.op === "update" ? { data: [], error: null } : responderPerfil(c)),
    });
    await screen.findByLabelText("Nome");
    fireEvent.change(screen.getByLabelText("Empresa"), { target: { value: "Outra" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    });
    expect(await screen.findByText("Este contato não existe mais. Ele pode ter sido apagado.")).toBeInTheDocument();
    const update = f.consultas.find((c) => c.tabela === "contatos" && c.op === "update")!;
    expect(update.valor).toMatchObject({ empresa: "Outra" });
    expect(update.comSelect).toBe("id");
    expect(props.avisar).not.toHaveBeenCalled();
  });

  it("a releitura que falha com o perfil na tela vira um aviso compacto, e o perfil fica", async () => {
    let falhar = false;
    const { qc } = montar(perfil(), {
      rpc: () => undefined,
      consulta: (c) =>
        falhar && c.tabela === "contatos" && c.op === "select" ? { data: null, error: { code: "42501", message: "x" } } : responderPerfil(c),
    });
    await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" });
    falhar = true;
    await act(async () => {
      await qc.refetchQueries({ queryKey: [...CHAVES.contatos, "um", CT] });
    });
    expect(await screen.findByText("Não deu para atualizar o contato")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ricardo Alves" })).toBeInTheDocument();
  });

  it("a aba Conversa: o envio recusado aparece na tela (o avisar do perfil), não só para o leitor de tela", async () => {
    avisar.mockClear();
    montar(perfil(), {
      rpc: () => undefined,
      consulta: (c) =>
        c.tabela === "mensagens" && c.op === "insert" ? { data: null, error: { code: "42501", message: "x" } } : responderPerfil(c),
    });
    await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" });
    fireEvent.click(screen.getByRole("tab", { name: /Conversa/ }));
    const campo = await screen.findByRole("textbox", { name: /^Mensagem/ });
    fireEvent.change(campo, { target: { value: "Oi, Ricardo (teste)" } });
    await act(async () => {
      fireEvent.keyDown(campo, { key: "Enter" });
    });
    await waitFor(() => expect(avisar).toHaveBeenCalledWith("Sua conta não tem acesso a isto."));
  });

  it("a aba Conversa: com mensagens mais antigas por carregar, as etapas e passagens de antes ficam para depois", async () => {
    // a 1ª página cheia (50): há mais antigas; a mais antiga carregada é de 01/11, 19:11
    const pagina = Array.from({ length: 50 }, (_, i) => ({
      ...MENSAGEM,
      id: `m-p${i}`,
      texto: `Mensagem ${i}`,
      momento: new Date(Date.parse("2026-11-01T20:00:00.000Z") - i * 60_000).toISOString(),
      criado_em: new Date(Date.parse("2026-11-01T20:00:00.000Z") - i * 60_000).toISOString(),
    }));
    const historico = [
      { id: "h-antigo", contato_id: CT, de_etapa_id: ET_NOVO, para_etapa_id: ET_GANHO, ator: "janete", membro_id: null, criado_em: "2026-10-30T13:00:00.000Z", rodada_id: null },
      { id: "h-novo", contato_id: CT, de_etapa_id: ET_GANHO, para_etapa_id: ET_NOVO, ator: "janete", membro_id: null, criado_em: "2026-11-01T19:50:00.000Z", rodada_id: null },
    ];
    montar(perfil(), {
      rpc: () => undefined,
      consulta: (c) => {
        if (c.tabela === "contato_etapa_historico") return { data: historico, error: null };
        if (c.tabela === "mensagens" && c.valor !== "id" && !c.passos.some((p) => p[0] === "in") && !c.unica) {
          if (c.passos.some((p) => p[0] === "eq" && p[1] === "origem")) return responderPerfil(c);
          return { data: pagina, error: null };
        }
        return responderPerfil(c);
      },
    });
    await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" });
    fireEvent.click(screen.getByRole("tab", { name: /Conversa/ }));
    const log = await screen.findByRole("log");
    await within(log).findByRole("button", { name: "Carregar mensagens mais antigas" });
    // a de 30/10 (antes das 50 carregadas) não aparece no alto; a do meio delas, sim
    expect(within(log).getAllByText(/A Janete moveu para/)).toHaveLength(1);
    expect(within(log).getByText("A Janete moveu para Novo")).toBeInTheDocument();
  });

  it("a aba Mídias no banco: a miniatura é o link assinado, e a mídia que não veio do WhatsApp diz a situação", async () => {
    const midias = [
      { ...MENSAGEM, id: "m-foto", tipo: "imagem", texto: null, midia_nome: "foto.jpg", midia_mime: "image/jpeg", midia_caminho: `${CV}/m-foto`, midia_status: null },
      { ...MENSAGEM, id: "m-falhou", tipo: "imagem", texto: null, midia_nome: "outra.jpg", midia_mime: "image/jpeg", midia_caminho: null, midia_status: "falhou" },
      { ...MENSAGEM, id: "m-exp", tipo: "video", texto: null, midia_nome: "video.mp4", midia_mime: "video/mp4", midia_caminho: null, midia_status: "expirada" },
    ];
    const { f } = montar(perfil(), {
      rpc: () => undefined,
      consulta: (c) => (c.tabela === "mensagens" && c.passos.some((p) => p[0] === "in") ? { data: midias, error: null } : responderPerfil(c)),
    });
    await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" });
    fireEvent.click(screen.getByRole("tab", { name: /Mídias/ }));
    const aba = await screen.findByRole("region", { name: "Mídias trocadas" });
    // a imagem pronta: o arquivo de verdade, pelo link assinado (um pedido em lote), não o desenho de exemplo
    await waitFor(() => expect(aba.querySelector("img")?.getAttribute("src")).toBe(`https://falso/${CV}/m-foto?v=3600`));
    expect(f.assinaturas).toContainEqual({ caminhos: [`${CV}/m-foto`], validade: 3600 });
    // nem o prédio (CenaFoto) nem a cena do vídeo (CenaVideo) do exemplo
    expect(aba.querySelector("svg[viewBox='0 0 260 190'], svg[viewBox='0 0 320 200']")).toBeNull();
    // as que não estão no bucket dizem a situação
    expect(within(aba).getByText("Não deu para baixar a foto do WhatsApp.")).toBeInTheDocument();
    expect(within(aba).getByText("O vídeo não está mais disponível no WhatsApp.")).toBeInTheDocument();
  });
});

/* =============================================================================
   abrir por ?contato=
   ============================================================================= */

describe("Contatos no banco: abrir por ?contato= (useAbrirPorId)", () => {
  it("um id que não é uuid nem vai ao banco: volta para a tabela, substituindo o endereço", async () => {
    const irPara = vi.fn();
    const { f } = montar(<TelaContatos contatoId="42" irPara={irPara} />, {
      rpc: (nome, args) => (nome === "contatos_lista" ? { data: paginaDe120(args), error: null } : { data: CONTADORES, error: null }),
    });
    await waitFor(() => expect(irPara).toHaveBeenCalledWith(null, { substituir: true }));
    expect(f.consultas.some((c) => c.tabela === "contatos" && c.passos.some((p) => p[2] === "42"))).toBe(false);
  });

  it("um uuid que o banco não acha volta para a tabela uma vez", async () => {
    const irPara = vi.fn();
    montar(<TelaContatos contatoId={CT} irPara={irPara} />, {
      consulta: (c) => responderPerfil(c, { contato: null }),
      rpc: (nome, args) => (nome === "contatos_lista" ? { data: paginaDe120(args), error: null } : { data: CONTADORES, error: null }),
    });
    await waitFor(() => expect(irPara).toHaveBeenCalledWith(null, { substituir: true }));
    await act(async () => {});
    expect(irPara).toHaveBeenCalledTimes(1);
  });

  it("um uuid que existe abre o perfil", async () => {
    const irPara = vi.fn();
    montar(<TelaContatos contatoId={CT} irPara={irPara} />, { rpc: () => undefined });
    expect(await screen.findByRole("heading", { level: 1, name: "Ricardo Alves" })).toBeInTheDocument();
    expect(irPara).not.toHaveBeenCalled();
  });
});

/* =============================================================================
   as regras puras e os formatos
   ============================================================================= */

describe("Contatos no banco: formatos e regras", () => {
  it("lerPaginaContatos dá a cada linha o id do contato, e o tempo real tira o apagado (o total desce)", () => {
    const pagina = lerPaginaContatos({ total: 3, linhas: [linhaLista(1), linhaLista(2), { nome: "sem id" }] });
    expect(pagina.linhas).toHaveLength(2);
    expect(pagina.linhas[0]!.id).toBe(pagina.linhas[0]!.contato_id);
    const depois = removerPorId(pagina, pagina.linhas[0]!.id) as typeof pagina;
    expect(depois.linhas).toHaveLength(1);
    expect(depois.total).toBe(2);
    expect(lerPaginaContatos(null)).toEqual({ total: 0, linhas: [] });
  });

  it("lerContadores: o que faltar ou vier estranho conta 0", () => {
    expect(lerContadores({ todos: 5, precisam: "2", comigo: -1 })).toEqual({ todos: 5, precisam: 2, novos_hoje: 0, com_janete: 0, comigo: 0 });
    expect(lerContadores(null)).toEqual({ todos: 0, precisam: 0, novos_hoje: 0, com_janete: 0, comigo: 0 });
  });

  it("'Entrou em' em dias de São Paulo, na virada do dia (23:59 e 00:00, -03:00)", () => {
    expect(periodoDeEntrada("qualquer", T)).toEqual({ de: null, ate: null });
    // 01/11 23:59 em São Paulo (02:59 UTC do dia 2)
    const antes = Date.parse("2026-11-02T02:59:00.000Z");
    expect(periodoDeEntrada("hoje", antes)).toEqual({ de: "2026-11-01", ate: "2026-11-01" });
    expect(periodoDeEntrada("7", antes)).toEqual({ de: "2026-10-26", ate: "2026-11-01" });
    expect(periodoDeEntrada("30", antes)).toEqual({ de: "2026-10-03", ate: "2026-11-01" });
    // 02/11 00:00 em São Paulo
    const depois = Date.parse("2026-11-02T03:00:00.000Z");
    expect(periodoDeEntrada("hoje", depois)).toEqual({ de: "2026-11-02", ate: "2026-11-02" });
    // a chave muda com o dia: "Novos hoje" é relido na virada
    expect(parametrosDaLista(FILTROS_INICIAIS, antes).dia).toBe("2026-11-01");
    expect(parametrosDaLista(FILTROS_INICIAIS, depois).dia).toBe("2026-11-02");
  });

  it("a página pedida vira o deslocamento de 50 em 50; as etapas vão em ordem", () => {
    const p = parametrosDaLista({ ...FILTROS_INICIAIS, pagina: 2, etapaIds: [ET_GANHO, ET_NOVO, ET_GANHO] }, T);
    expect(p.deslocamento).toBe(100);
    expect(p.etapas).toEqual([ET_NOVO, ET_GANHO]);
  });

  it("ao vivo numa linha do banco: com a Janete, etapa aberta e fala nos últimos 5 minutos", () => {
    const conversa = { modo: "janete" as const, ultima_do_lead_em: new Date(T - 4 * 60_000).toISOString(), ultima_da_janete_em: null };
    expect(aoVivoNaLinha(conversa, { tipo: "aberta" }, T)).toBe(true);
    expect(aoVivoNaLinha(conversa, { tipo: "ganho" }, T)).toBe(false);
    expect(aoVivoNaLinha({ ...conversa, modo: "humano" }, { tipo: "aberta" }, T)).toBe(false);
    expect(aoVivoNaLinha({ ...conversa, ultima_do_lead_em: new Date(T - 6 * 60_000).toISOString() }, { tipo: "aberta" }, T)).toBe(false);
  });

  it("linhaDoBanco: quem atende pela regra do selo, com o nome de quem atende", () => {
    const l = lerPaginaContatos({ total: 1, linhas: [linhaLista(1)] }).linhas[0]!;
    const comigo = { ...l, conversa: { ...l.conversa!, modo: "humano" as const, responsavel_id: MB } };
    const estado = { membros: [membro()], eu: membro(), etapas: ETAPAS as never };
    expect(linhaDoBanco(comigo, estado, T).quem).toMatchObject({ tipo: "membro", membroId: MB });
    const esperando = { ...l, conversa: { ...l.conversa!, modo: "humano" as const, aguardando_humano_desde: AGORA.toISOString() } };
    expect(linhaDoBanco(esperando, estado, T).quem).toMatchObject({ tipo: "aguardando", nome: "Esperando a equipe" });
    expect(linhaDoBanco({ ...l, conversa: null }, estado, T).quem).toMatchObject({ tipo: "janete", aoVivo: false });
  });
});

/* =============================================================================
   a área lê só pela camada de dados
   ============================================================================= */

describe("Contatos: a área lê só pela camada de dados", () => {
  it("nenhum arquivo de contatos/ usa useExemplo", () => {
    const pasta = path.resolve(__dirname, "../features/plataforma/contatos");
    const arquivos = readdirSync(pasta).filter((n) => /\.(ts|tsx)$/.test(n));
    expect(arquivos.length).toBeGreaterThan(5);
    for (const nome of arquivos) {
      const texto = readFileSync(path.join(pasta, nome), "utf8");
      expect({ nome, usa: /\buseExemplo\b/.test(texto) }).toEqual({ nome, usa: false });
    }
  });
});
