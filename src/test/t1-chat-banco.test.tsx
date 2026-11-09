import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { textoDoErroChat } from "@/features/plataforma/chat/aviso";
import { linhaDoTempo } from "@/features/plataforma/chat/Conversa";
import { ondeCasou } from "@/features/plataforma/chat/Lista";
import { TelaChat } from "@/features/plataforma/chat/TelaChat";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import {
  SELECT_LINHA_CHAT,
  TAMANHO_PAGINA_CHAT,
  aplicarFiltro,
  linhaDoBanco,
  normalizarBuscaChat,
  passaNoFiltroChat,
} from "@/features/plataforma/dados/chat";
import type { ClienteFirebase } from "@/features/plataforma/dados/colunas";
import { ProvedorDados, type ServidorDados } from "@/features/plataforma/dados/ProvedorDados";
import type { EventoConversaDados, MensagemDados } from "@/features/plataforma/dados/tipos";
import { ProvedorPapel } from "@/features/plataforma/papel";

// Task C1 (ligar o Chat ao banco): o Chat no modo banco, com um cliente do Firebase falso (nada vai
// à rede nem ao banco). Confere a lista paginada com o contato e a última mensagem embutidos, os
// filtros e os contadores no banco, a busca pelo servidor, os 3 estados, o "Tentar de novo" com a
// regra do banco, o lido no WhatsApp, o custo só do admin, o apagar pelo servidor e o ?conversa= fora
// da página. E que a área lê só pela camada de dados (nenhum useExemplo em chat/).

const navegar = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navegar,
}));

/* ---------- os dados ---------- */

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EU = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTRA = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ET_NOVO = "33333333-3333-4333-8333-333333333331";
const ET_GANHO = "33333333-3333-4333-8333-333333333332";
const AGORA = "2026-11-02T15:00:00.000Z";

const cv = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const ct = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const mg = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

const membroEu = (papel: "admin" | "atendente") => ({
  id: EU,
  nome: "Ana Souza",
  email: "ana@teste.com",
  papel,
  ativo: true,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
});

const etapas = [
  { id: ET_NOVO, chave: "novo", nome: "Novo", ordem: 1, tipo: "aberta", cor: null, janete_pode_mover: true, arquivada: false },
  { id: ET_GANHO, chave: "ganho", nome: "Ganho", ordem: 2, tipo: "ganho", cor: null, janete_pode_mover: false, arquivada: false },
];

const conexao = {
  id: "c0000000-0000-4000-8000-000000000001",
  nome: "5511999990000",
  gateway: "zapi",
  status: "conectada",
  ativa: true,
  oficial: false,
  id_externo: null,
  ultimo_erro: null,
  criado_em: AGORA,
  atualizado_em: AGORA,
};

function contato(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: ct(n),
    nome: `Lead Teste ${n}`,
    nome_whatsapp: null,
    telefone: `55119000000${String(n).padStart(2, "0")}`,
    email: null,
    empresa: n === 2 ? "Padaria Teste" : null,
    etapa_id: ET_NOVO,
    etapa_desde: "2026-11-01T12:00:00.000Z",
    observacoes: null,
    resumo_janete: null,
    primeira_mensagem_em: "2026-11-01T12:00:00.000Z",
    criado_em: "2026-11-01T12:00:00.000Z",
    atualizado_em: "2026-11-01T12:00:00.000Z",
    resumo_janete_em: null,
    anotacoes_janete: null,
    ...extra,
  };
}

function mensagem(n: number, conversa: number, extra: Record<string, unknown> = {}): MensagemDados {
  return {
    id: mg(n),
    conversa_id: cv(conversa),
    conexao_id: conexao.id,
    direcao: "entrada",
    origem: "lead",
    tipo: "texto",
    status: "recebida",
    texto: `Olá, mensagem ${n}`,
    transcricao: null,
    momento: `2026-11-02T14:${String(10 + n).padStart(2, "0")}:00.000Z`,
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
    criado_em: `2026-11-02T14:${String(10 + n).padStart(2, "0")}:00.000Z`,
    responde_a_id: null,
    midia_duracao_s: null,
    ...extra,
  } as MensagemDados;
}

function conversa(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: cv(n),
    contato_id: ct(n),
    conexao_id: conexao.id,
    modo: "janete",
    motivo_humano: null,
    responsavel_id: null,
    aguardando_humano_desde: null,
    devolvida_em: null,
    nao_lidas: 0,
    ultima_do_lead_em: "2026-11-02T14:00:00.000Z",
    ultima_mensagem_em: `2026-11-02T14:${String(50 - n).padStart(2, "0")}:00.000Z`,
    ultima_mensagem_preview: `Prévia ${n}`,
    criado_em: "2026-11-01T12:00:00.000Z",
    atualizado_em: AGORA,
    ultima_mensagem_id: mg(n),
    ultima_da_janete_em: null,
    ...extra,
  };
}

/* ---------- o cliente falso ---------- */

type Passo = [string, ...unknown[]];

interface Consulta {
  tabela: string;
  colunas: string;
  opcoes: unknown;
  op: string;
  valor: unknown;
  passos: Passo[];
  unica: boolean;
}

type Resposta = { data: unknown; error: unknown; count?: number | null };

interface Cenario {
  conversas: ReturnType<typeof conversa>[];
  contatos: ReturnType<typeof contato>[];
  mensagens: MensagemDados[];
  eventos?: EventoConversaDados[];
  /** Resposta à força para a lista do Chat (o erro ou uma promessa que não volta). */
  lista?: () => Resposta | Promise<Resposta>;
  /** Resposta à força para a leitura de uma conversa pelo id (useConversa, ?conversa=); undefined = a normal. */
  uma?: (id: string) => Resposta | undefined;
  /** Resposta à força para o histórico de etapas; undefined = a normal (vazio). */
  historico?: () => Resposta | undefined;
  rpc?: (nome: string, args: Record<string, unknown>) => Resposta | undefined;
}

const tem = (c: Consulta, nome: string, ...args: unknown[]) =>
  c.passos.some((p) => p[0] === nome && args.every((a, i) => p[i + 1] === a));
const valorDe = (c: Consulta, nome: string, coluna: string) => c.passos.find((p) => p[0] === nome && p[1] === coluna)?.[2];

function criarCliente(cenario: Cenario) {
  const consultas: Consulta[] = [];
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];

  function linhaCom(c: ReturnType<typeof conversa>) {
    return {
      ...c,
      contato: cenario.contatos.find((x) => x.id === c.contato_id) ?? null,
      ultima: cenario.mensagens.find((m) => m.id === c.ultima_mensagem_id) ?? null,
    };
  }

  function responder(c: Consulta): Resposta | Promise<Resposta> {
    const ok = (data: unknown): Resposta => ({ data, error: null });
    const um = (lista: unknown[]) => ok(c.unica ? (lista[0] ?? null) : lista);
    switch (c.tabela) {
      case "membros":
        return um([membroEu("admin")]);
      case "etapas":
        return ok(etapas);
      case "conexoes":
        return ok(conexao);
      case "contatos": {
        const id = valorDe(c, "eq", "id");
        return um(cenario.contatos.filter((x) => x.id === id));
      }
      case "conversas": {
        if ((c.opcoes as { head?: boolean } | undefined)?.head) return { data: null, error: null, count: cenario.conversas.length };
        let lista = cenario.conversas;
        const id = valorDe(c, "eq", "id");
        if (id && cenario.uma && !c.colunas.includes("contato:")) {
          const forcada = cenario.uma(String(id));
          if (forcada) return forcada;
        }
        if (id) lista = lista.filter((x) => x.id === id);
        const inn = c.passos.find((p) => p[0] === "in" && p[1] === "contato_id")?.[2] as string[] | undefined;
        if (inn) lista = lista.filter((x) => inn.includes(x.contato_id));
        if (tem(c, "eq", "modo", "humano") && tem(c, "is", "responsavel_id", null)) {
          lista = lista.filter((x) => x.modo === "humano" && !x.responsavel_id && x.aguardando_humano_desde);
        }
        if (c.colunas.includes("contato:")) {
          if (cenario.lista && !id) return cenario.lista();
          return um(lista.map(linhaCom));
        }
        return um(lista);
      }
      case "mensagens":
        return ok(cenario.mensagens.filter((m) => m.conversa_id === valorDe(c, "eq", "conversa_id")).reverse());
      case "conversa_eventos":
        return ok((cenario.eventos ?? []).filter((e) => e.conversa_id === valorDe(c, "eq", "conversa_id")));
      case "contato_etapa_historico":
        return cenario.historico?.() ?? ok([]);
      default:
        return ok([]);
    }
  }

  function construtor(tabela: string) {
    const c: Consulta = { tabela, colunas: "", opcoes: undefined, op: "", valor: undefined, passos: [], unica: false };
    consultas.push(c);
    const q: Record<string, unknown> = {};
    const passo =
      (nome: string) =>
      (...args: unknown[]) => {
        c.passos.push([nome, ...args]);
        return q;
      };
    Object.assign(q, {
      select: (colunas: string, opcoes?: unknown) => {
        if (!c.op) {
          c.op = "select";
          c.colunas = colunas;
          c.opcoes = opcoes;
        }
        return q;
      },
      update: (valor: unknown) => {
        c.op = "update";
        c.valor = valor;
        return q;
      },
      insert: (valor: unknown) => {
        c.op = "insert";
        c.valor = valor;
        return q;
      },
      eq: passo("eq"),
      neq: passo("neq"),
      is: passo("is"),
      not: passo("not"),
      in: passo("in"),
      gt: passo("gt"),
      or: passo("or"),
      order: passo("order"),
      limit: passo("limit"),
      range: passo("range"),
      maybeSingle: () => {
        c.unica = true;
        return q;
      },
      then: (res: (r: Resposta) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() =>
            c.op === "update" ? { data: [{ id: "x" }], error: null } : c.op === "insert" ? { data: null, error: null } : responder(c),
          )
          .then(res, rej),
    });
    return q;
  }

  const cliente = {
    from: (tabela: string) => construtor(tabela),
    rpc: (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      return Promise.resolve(cenario.rpc?.(nome, args) ?? { data: null, error: null });
    },
    auth: { getSession: async () => ({ data: { session: { user: { id: UID } } }, error: null }) },
    storage: {
      from: () => ({
        createSignedUrls: async (caminhos: string[]) => ({
          data: caminhos.map((p) => ({ path: p, signedUrl: `https://falso/${p}`, error: null })),
          error: null,
        }),
      }),
    },
  };
  return { cliente: cliente as unknown as ClienteFirebase, consultas, rpcs };
}

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

function montar(
  cenario: Cenario,
  opcoes: { papel?: "admin" | "atendente"; servidor?: ServidorDados; conversaInicial?: string; px?: number } = {},
) {
  largura(opcoes.px ?? 1440);
  const falso = criarCliente(cenario);
  // retryDelay 0: as leituras repetem a falha de rede (repetirSoFalha) sem os segundos de espera.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  qc.setQueryData(CHAVES.eu, membroEu(opcoes.papel ?? "admin"));
  const r = render(
    <QueryClientProvider client={qc}>
      <ProvedorPapel inicial={opcoes.papel ?? "admin"}>
        <ProvedorDados fonte="banco" cliente={falso.cliente} servidor={opcoes.servidor}>
          <TelaChat conversaInicial={opcoes.conversaInicial} />
        </ProvedorDados>
      </ProvedorPapel>
    </QueryClientProvider>,
  );
  return { ...r, ...falso, qc };
}

const basico = (): Cenario => ({
  conversas: [conversa(1), conversa(2, { nao_lidas: 2 }), conversa(3)],
  contatos: [contato(1), contato(2), contato(3)],
  mensagens: [mensagem(1, 1), mensagem(2, 2), mensagem(3, 3)],
});

const linhaDe = (nome: string) => screen.getByRole("button", { name: new RegExp(`^${nome}[,.]`) });

// A tela conta o "Hoje", o "Ontem" e a hora da lista pelo relógio da máquina (Date.now): o Date falso
// põe a máquina no AGORA dos dados, e a tela não depende do dia em que o teste roda. Só o Date: os
// timers continuam de verdade.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  navegar.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ---------- a área só lê pela camada de dados ---------- */

describe("a área do Chat lê só pela camada de dados", () => {
  it("nenhum arquivo de chat/ usa useExemplo", () => {
    const pasta = path.resolve(__dirname, "../features/plataforma/chat");
    const arquivos = readdirSync(pasta).filter((a) => /\.tsx?$/.test(a));
    expect(arquivos.length).toBeGreaterThan(5);
    for (const a of arquivos) {
      expect(readFileSync(path.join(pasta, a), "utf8"), a).not.toMatch(/useExemplo/);
    }
  });
});

/* ---------- as regras puras ---------- */

describe("dados/chat.ts: regras e consultas", () => {
  it("a linha embute o contato e a última mensagem pela ultima_mensagem_id (origem, status, tipo, apagada, autor)", () => {
    expect(SELECT_LINHA_CHAT).toContain("contato:contatos!conversas_contato_id_fkey(");
    expect(SELECT_LINHA_CHAT).toContain("ultima:mensagens!conversas_ultima_mensagem_id_fkey(");
    for (const col of ["origem", "status", "tipo", "apagada_em", "autor_membro_id"]) expect(SELECT_LINHA_CHAT).toContain(col);
    expect(SELECT_LINHA_CHAT).not.toContain("*");
    const l = linhaDoBanco({
      ...conversa(1),
      contato: contato(1, { anotacoes_janete: { fatos: [{ rotulo: "Orçamento", valor: "R$ 5 mil" }], proximo_passo: null } }),
      ultima: mensagem(1, 1, { midia_duracao_s: 12, responde_a_id: mg(9) }),
    });
    expect(l?.contato.fatosJanete).toEqual([{ rotulo: "Orçamento", valor: "R$ 5 mil", mensagemId: null }]);
    expect(l?.ultima?.duracaoS).toBe(12);
    expect(l?.ultima?.citaId).toBe(mg(9));
    // sem contato (a RLS escondeu), a linha sai
    expect(linhaDoBanco({ ...conversa(1), contato: null, ultima: null })).toBeNull();
  });

  it("os 6 filtros no banco seguem a mesma regra da tela", () => {
    const passos: unknown[][] = [];
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const nome of ["eq", "is", "not", "gt", "or"]) {
      q[nome] = (...a: unknown[]) => {
        passos.push([nome, ...a]);
        return q;
      };
    }
    const filtro = (f: Parameters<typeof aplicarFiltro>[1]) => {
      passos.length = 0;
      aplicarFiltro(q as never, f, EU);
      return [...passos];
    };
    expect(filtro("todas")).toEqual([]);
    expect(filtro("aguardando")).toEqual([
      ["eq", "modo", "humano"],
      ["is", "responsavel_id", null],
      ["not", "aguardando_humano_desde", "is", null],
    ]);
    expect(filtro("nao_lidas")).toEqual([["gt", "nao_lidas", 0]]);
    expect(filtro("comigo")).toEqual([
      ["eq", "modo", "humano"],
      ["eq", "responsavel_id", EU],
    ]);
    expect(filtro("equipe")).toEqual([
      ["eq", "modo", "humano"],
      ["or", "responsavel_id.not.is.null,aguardando_humano_desde.is.null"],
    ]);
    expect(filtro("janete")).toEqual([["eq", "modo", "janete"]]);

    const base = { modo: "humano" as const, responsavel_id: null, motivo_humano: null, aguardando_humano_desde: null, nao_lidas: 0 };
    expect(passaNoFiltroChat("equipe", base, EU)).toBe(true); // o celular
    expect(passaNoFiltroChat("aguardando", { ...base, aguardando_humano_desde: AGORA }, EU)).toBe(true);
    expect(passaNoFiltroChat("comigo", { ...base, responsavel_id: EU }, EU)).toBe(true);
    expect(passaNoFiltroChat("janete", { ...base, modo: "janete" }, EU)).toBe(true);
  });

  it("a busca normaliza como o texto_busca do banco; a prévia diz por que achou", () => {
    expect(normalizarBuscaChat("  Clínica   VALE ")).toBe("clinica vale");
    const l = linhaDoBanco({ ...conversa(2), contato: contato(2), ultima: mensagem(2, 2) })!;
    expect(ondeCasou(l, "padaria")).toEqual({ texto: "Empresa: Padaria Teste", aria: "Encontrada pela empresa." });
    expect(ondeCasou(l, "lead teste")).toBeNull();
  });

  it("a linha do tempo junta mensagens e passagens, com a passagem do envio antes da mensagem", () => {
    const m = mensagem(1, 1, { momento: AGORA });
    const ev: EventoConversaDados = {
      id: "e1",
      conversa_id: cv(1),
      tipo: "assumiu",
      membro_id: EU,
      de: "janete",
      de_membro_id: null,
      motivo: null,
      por_envio: true,
      criado_em: AGORA,
    };
    expect(linhaDoTempo([m], [ev]).map((i) => i.k)).toEqual(["passagem", "mensagem"]);
    expect(linhaDoTempo([m], [{ ...ev, por_envio: false }]).map((i) => i.k)).toEqual(["mensagem", "passagem"]);
  });

  it("os erros do banco viram o texto certo", () => {
    expect(textoDoErroChat("nao_reenviavel", "reenviar")).toMatch(/pode ter chegado ao lead/);
    expect(textoDoErroChat("sem_acesso")).toMatch(/não tem mais acesso/);
    expect(textoDoErroChat("nao_encontrado")).toMatch(/não existe mais/);
    expect(textoDoErroChat("sem_permissao", "apagar")).toBe("Só o admin pode apagar um contato.");
    expect(textoDoErroChat("etapa_arquivada", "mover")).toMatch(/arquivada/);
    expect(textoDoErroChat("falha", "enviar")).toBe("Não deu para enviar agora. Tente de novo.");
  });
});

/* ---------- a tela no modo banco ---------- */

describe("o Chat no modo banco", () => {
  it("a lista vem do banco: páginas de 50, pela última mensagem, com a prévia e as não lidas", async () => {
    const t = montar(basico());
    expect(await screen.findByRole("button", { name: /^Lead Teste 1[,.]/ })).toBeInTheDocument();
    const lista = t.consultas.find((c) => c.tabela === "conversas" && c.colunas === SELECT_LINHA_CHAT)!;
    expect(lista.passos).toContainEqual(["order", "ultima_mensagem_em", { ascending: false, nullsFirst: false }]);
    expect(lista.passos).toContainEqual(["range", 0, TAMANHO_PAGINA_CHAT - 1]);
    // a prévia é a última mensagem embutida, e a não lida aparece no nome acessível
    expect(linhaDe("Lead Teste 2").getAttribute("aria-label")).toMatch(/2 mensagens não lidas/);
    expect(linhaDe("Lead Teste 2").getAttribute("aria-label")).toMatch(/Olá, mensagem 2/);
    // os contadores vêm por contagem no banco (head), e "Precisam de você" do useAguardando
    await waitFor(() =>
      expect(t.consultas.some((c) => c.tabela === "conversas" && (c.opcoes as { head?: boolean })?.head)).toBe(true),
    );
  });

  it("carregando: o esqueleto da lista; erro: o aviso com 'Tentar de novo', que relê", async () => {
    let falhar = true;
    const cenario: Cenario = {
      ...basico(),
      lista: () => (falhar ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: [], error: null }),
    };
    montar(cenario);
    expect(screen.getAllByRole("status", { name: "Carregando as conversas" }).length).toBeGreaterThan(0);
    expect(await screen.findAllByText("Não deu para carregar as conversas")).not.toHaveLength(0);
    expect(screen.getAllByText("Sua conta não tem acesso a isto.").length).toBeGreaterThan(0);
    falhar = false;
    fireEvent.click(screen.getAllByRole("button", { name: "Tentar de novo" })[0]!);
    expect(await screen.findAllByText("Nenhuma conversa ainda")).not.toHaveLength(0);
  });

  it("vazio: sem conversa nenhuma, 'Nenhuma conversa ainda'", async () => {
    montar({ conversas: [], contatos: [], mensagens: [] });
    expect(await screen.findAllByText("Nenhuma conversa ainda")).not.toHaveLength(0);
  });

  it("a busca vai ao servidor (buscar_quadro) e lista as conversas desses contatos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const t = montar({
        ...basico(),
        rpc: (nome) => (nome === "buscar_quadro" ? { data: [ct(3)], error: null } : undefined),
      });
      await screen.findByRole("button", { name: /^Lead Teste 1[,.]/ });
      fireEvent.change(screen.getByRole("textbox", { name: "Buscar por nome, empresa ou mensagem" }), {
        target: { value: "Orçamento" },
      });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      await waitFor(() => expect(screen.queryByRole("button", { name: /^Lead Teste 1[,.]/ })).toBeNull());
      expect(screen.getByRole("button", { name: /^Lead Teste 3[,.]/ })).toBeInTheDocument();
      expect(t.rpcs).toContainEqual({ nome: "buscar_quadro", args: { p_q: "orcamento" } });
      const busca = t.consultas.find((c) => c.passos.some((p) => p[0] === "in"))!;
      expect(busca.passos).toContainEqual(["in", "contato_id", [ct(3)]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("abrir pela lista marca como lida (marcar_lida) e pede o lido no WhatsApp (decisão 6)", async () => {
    const marcarLidaNoWhatsApp = vi.fn(() => Promise.resolve());
    const c = basico();
    // a 1ª (que abre sozinha) também tem não lidas: a regra do adiarLida é que a segura
    c.conversas[0] = conversa(1, { nao_lidas: 3 });
    const t = montar(c, { servidor: { marcarLidaNoWhatsApp } });
    await screen.findByRole("log");
    fireEvent.click(await screen.findByRole("button", { name: /^Lead Teste 2[,.]/ }));
    await waitFor(() => expect(t.rpcs).toContainEqual({ nome: "marcar_lida", args: { p_conversa: cv(2) } }));
    await waitFor(() => expect(marcarLidaNoWhatsApp).toHaveBeenCalledWith(cv(2)));
    // a que abriu sozinha (a 1ª, com 3 não lidas) não foi marcada: ninguém mexeu nela
    expect(t.rpcs.filter((r) => r.nome === "marcar_lida")).toEqual([{ nome: "marcar_lida", args: { p_conversa: cv(2) } }]);
  });

  it("a conversa que abriu sozinha só vira lida na 1ª interação dentro dela (decisão 6, adiarLida)", async () => {
    const marcarLidaNoWhatsApp = vi.fn(() => Promise.resolve());
    const c = basico();
    c.conversas[0] = conversa(1, { nao_lidas: 3 });
    const t = montar(c, { servidor: { marcarLidaNoWhatsApp } });
    const log = await screen.findByRole("log", { name: /Lead Teste 1/ });
    await within(log).findByText("Olá, mensagem 1");
    // carregou e ficou aberta, sem nenhum toque: nada vai ao banco nem ao WhatsApp
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(t.rpcs.filter((r) => r.nome === "marcar_lida")).toHaveLength(0);
    expect(marcarLidaNoWhatsApp).not.toHaveBeenCalled();
    // a 1ª interação dentro dela (o toque na conversa) marca
    fireEvent.pointerDown(log);
    await waitFor(() => expect(t.rpcs).toContainEqual({ nome: "marcar_lida", args: { p_conversa: cv(1) } }));
    await waitFor(() => expect(marcarLidaNoWhatsApp).toHaveBeenCalledWith(cv(1)));
  });

  it("'Tentar de novo' chama reenviar_mensagem; o banco recusa nao_reenviavel e a tela explica", async () => {
    const c = basico();
    c.mensagens[0] = mensagem(1, 1, { origem: "humano_tela", direcao: "saida", autor_membro_id: EU, status: "falhou", erro: "falha_no_gateway" });
    c.mensagens.push(mensagem(5, 1, { origem: "janete", direcao: "saida", status: "falhou", erro: "tempo_esgotado" }));
    const t = montar({
      ...c,
      rpc: (nome) => (nome === "reenviar_mensagem" ? { data: null, error: { code: "P0001", message: "nao_reenviavel" } } : undefined),
    });
    const log = await screen.findByRole("log");
    // decisão 8: só a da equipe tem o botão; a da Janete que falhou fica só com "Não enviada"
    const botoes = await within(log).findAllByRole("button", { name: "Tentar de novo" });
    expect(botoes).toHaveLength(1);
    fireEvent.click(botoes[0]!);
    await waitFor(() => expect(t.rpcs).toContainEqual({ nome: "reenviar_mensagem", args: { p_msg: mg(1) } }));
    expect(await screen.findAllByText(/Essa mensagem pode ter chegado ao lead/)).not.toHaveLength(0);
  });

  it("a ficha: o custo da conversa vem de custo_das_conversas (admin); o atendente nem pede", async () => {
    const t = montar({
      ...basico(),
      rpc: (nome, args) =>
        nome === "custo_das_conversas"
          ? { data: (args["p_conversas"] as string[]).map((id) => ({ conversa_id: id, custo_usd: 0.1234 })), error: null }
          : undefined,
    });
    const ficha = await screen.findByRole("complementary");
    expect(await within(ficha).findByText(/US\$\s?0,12 nesta conversa/)).toBeInTheDocument();
    expect(t.rpcs.some((r) => r.nome === "custo_das_conversas")).toBe(true);
    cleanup();

    const a = montar(basico(), { papel: "atendente" });
    const fichaA = await screen.findByRole("complementary");
    await within(fichaA).findByText("Ficha do lead");
    expect(within(fichaA).queryByText("Custo de IA")).toBeNull();
    expect(a.rpcs.some((r) => r.nome === "custo_das_conversas")).toBe(false);
  });

  it("apagar contato vai pelo servidor, com o aviso de que ele volta como lead novo", async () => {
    const apagarContato = vi.fn(() => Promise.resolve({ ok: true as const }));
    montar(basico(), { servidor: { apagarContato } });
    const ficha = await screen.findByRole("complementary");
    fireEvent.click(await within(ficha).findByRole("button", { name: "Apagar contato" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent("Se ele escrever de novo, volta como lead novo.");
    fireEvent.click(within(dlg).getByRole("button", { name: "Apagar contato" }));
    await waitFor(() => expect(apagarContato).toHaveBeenCalledWith(ct(1)));
    expect(await screen.findAllByText("Lead Teste 1 foi apagado, com a conversa e as mídias.")).not.toHaveLength(0);
  });

  it("?conversa= fora da página: procura no banco, abre e tira o parâmetro do endereço", async () => {
    const c = basico();
    // a conversa pedida existe, mas não está na página (a lista não a traz)
    const pedida = conversa(9);
    const t = montar(
      {
        ...c,
        contatos: [...c.contatos, contato(9)],
        mensagens: [...c.mensagens, mensagem(9, 9)],
        lista: () => ({
          data: Array.from({ length: TAMANHO_PAGINA_CHAT }, (_, i) => ({
            ...conversa(1),
            id: `11111111-1111-4111-8111-9${String(i).padStart(11, "0")}`,
            contato: contato(1),
            ultima: null,
          })),
          error: null,
        }),
        conversas: [...c.conversas, pedida],
      },
      { conversaInicial: cv(9) },
    );
    expect(await screen.findByRole("heading", { level: 2, name: "Lead Teste 9" })).toBeInTheDocument();
    expect(t.consultas.some((q) => q.tabela === "conversas" && q.unica && q.passos.some((p) => p[0] === "eq" && p[2] === cv(9)))).toBe(true);
    await waitFor(() => expect(navegar).toHaveBeenCalledWith({ to: "/app/chat", search: {}, replace: true }));
  });

  it("?conversa= que não existe: avisa e abre a 1ª da lista", async () => {
    montar(basico(), { conversaInicial: "99999999-9999-4999-8999-999999999999" });
    expect(await screen.findAllByText("Não achamos essa conversa. Ela pode ter sido apagada.")).not.toHaveLength(0);
    expect(await screen.findByRole("heading", { level: 2, name: "Lead Teste 1" })).toBeInTheDocument();
  });

  it("enviar grava a mensagem pela camada (insert em mensagens com na_fila e a citação) e pede a passada de envio", async () => {
    const pedirEnvio = vi.fn(() => Promise.resolve());
    const t = montar(basico(), { servidor: { pedirEnvio } });
    const log = await screen.findByRole("log");
    // responder citando a mensagem do lead (a citação é de verdade, decisão 5)
    const bolha = await within(log).findByRole("article", { name: /Olá, mensagem 1/ });
    fireEvent.click(within(bolha).getByRole("button", { name: /Responder/ }));
    // o campo da caixa de escrever (o único textarea fora da ficha)
    const campo = screen.getAllByRole("textbox").find((e) => e.tagName === "TEXTAREA" && !e.closest("aside"))!;
    fireEvent.change(campo, { target: { value: "Oi, aqui é a Ana (teste)" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await waitFor(() => expect(t.consultas.some((c) => c.tabela === "mensagens" && c.op === "insert")).toBe(true));
    const insert = t.consultas.find((c) => c.tabela === "mensagens" && c.op === "insert")!;
    expect(insert.valor).toMatchObject({
      conversa_id: cv(1),
      status: "na_fila",
      origem: "humano_tela",
      texto: "Oi, aqui é a Ana (teste)",
      responde_a_id: mg(1),
    });
    expect(insert.valor).not.toHaveProperty("conexao_id");
    await waitFor(() => expect(pedirEnvio).toHaveBeenCalled());
  });

  it("as passagens vêm de conversa_eventos, inclusive 'Voltou para a fila' (quem atendia foi desativado)", async () => {
    const c = basico();
    c.eventos = [
      {
        id: "ev-1",
        conversa_id: cv(1),
        tipo: "voltou_para_fila",
        membro_id: null,
        de: "outro",
        de_membro_id: OUTRA,
        motivo: null,
        por_envio: false,
        criado_em: "2026-11-02T14:30:00.000Z",
      },
    ];
    montar(c);
    const log = await screen.findByRole("log");
    expect(await within(log).findByText("Voltou para a fila")).toBeInTheDocument();
  });

  it("mensagens em páginas de 50: 'Carregar mensagens anteriores' pede a página de antes", async () => {
    const c = basico();
    c.mensagens = Array.from({ length: 50 }, (_, i) => mensagem(100 + i, 1, { momento: new Date(Date.parse(AGORA) - (50 - i) * 60_000).toISOString() }));
    c.conversas[0] = conversa(1, { ultima_mensagem_id: mg(149) });
    const t = montar(c);
    const log = await screen.findByRole("log");
    fireEvent.click(await within(log).findByRole("button", { name: "Carregar mensagens anteriores" }));
    await waitFor(() =>
      expect(t.consultas.some((q) => q.tabela === "mensagens" && q.passos.some((p) => p[0] === "range" && p[1] === 50 && p[2] === 99))).toBe(true),
    );
  });

  it("com mensagens mais antigas por carregar, as passagens de antes da mais antiga carregada ficam para depois", async () => {
    const c = basico();
    // a página cheia (50): há mais antigas; a mais antiga carregada é de 02/11, 14:10
    c.mensagens = Array.from({ length: 50 }, (_, i) => mensagem(100 + i, 1, { momento: new Date(Date.parse(AGORA) - (50 - i) * 60_000).toISOString() }));
    c.conversas[0] = conversa(1, { ultima_mensagem_id: mg(149) });
    const passagem = (id: string, criado_em: string): EventoConversaDados => ({
      id,
      conversa_id: cv(1),
      tipo: "voltou_para_fila",
      membro_id: null,
      de: "outro",
      de_membro_id: OUTRA,
      motivo: null,
      por_envio: false,
      criado_em,
    });
    // uma passagem de ontem (antes das 50 carregadas) e uma no meio delas
    c.eventos = [passagem("ev-antiga", "2026-11-01T12:00:00.000Z"), passagem("ev-nova", "2026-11-02T14:40:00.000Z")];
    montar(c);
    const log = await screen.findByRole("log");
    await within(log).findByRole("button", { name: "Carregar mensagens anteriores" });
    expect(await within(log).findAllByText("Voltou para a fila")).toHaveLength(1);
    // sem o separador "Ontem" no alto, colado nas mensagens de hoje
    expect(within(log).queryByText(/^Ontem/)).toBeNull();
    // a regra pura: sem mais antigas, tudo entra
    const msgs = c.mensagens.slice(0, 2);
    expect(linhaDoTempo(msgs, c.eventos, true).map((i) => i.id)).toEqual([mg(100), mg(101), "ev-nova"]);
    expect(linhaDoTempo(msgs, c.eventos, false).filter((i) => i.k === "passagem")).toHaveLength(2);
  });

  it("?conversa= com a leitura falhando (rede): abre a conversa com o próprio erro, sem dizer que ela não existe", async () => {
    const c = basico();
    montar(
      { ...c, uma: (id) => (id === cv(9) ? { data: null, error: { message: "Failed to fetch" } } : undefined) },
      { conversaInicial: cv(9) },
    );
    expect(await screen.findByText("Não deu para carregar a conversa")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Tentar de novo" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Não achamos essa conversa. Ela pode ter sido apagada.")).toBeNull();
  });

  it("a releitura que falha com a conversa na tela vira um aviso: as mensagens e a caixa de escrever ficam", async () => {
    let falhar = false;
    const t = montar({ ...basico(), uma: () => (falhar ? { data: null, error: { message: "Failed to fetch" } } : undefined) });
    const log = await screen.findByRole("log");
    await within(log).findByText("Olá, mensagem 1");
    falhar = true;
    await act(async () => {
      await t.qc.refetchQueries({ queryKey: [...CHAVES.conversas, "uma", cv(1)] });
    });
    expect(await screen.findByText("Não deu para atualizar a conversa")).toBeInTheDocument();
    expect(screen.queryByText("Não deu para carregar a conversa")).toBeNull();
    expect(within(screen.getByRole("log")).getByText("Olá, mensagem 1")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox").length).toBeGreaterThan(1);
  });

  it("a ficha: o histórico de etapas tem o carregando e o erro, sem 'Nenhuma mudança' antes da hora", async () => {
    montar({ ...basico(), historico: () => ({ data: null, error: { message: "Failed to fetch" } }) });
    const ficha = await screen.findByRole("complementary");
    expect(await within(ficha).findByText("Não deu para carregar o histórico")).toBeInTheDocument();
    expect(within(ficha).queryByText("Nenhuma mudança de etapa ainda.")).toBeNull();
  });

  it("decisão 5: sem Vídeo no anexo e sem Reagir nas mensagens", async () => {
    montar(basico());
    const log = await screen.findByRole("log");
    await within(log).findByRole("article", { name: /Olá, mensagem 1/ });
    expect(within(log).queryByRole("button", { name: /reagir/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Anexar imagem ou documento" }));
    expect(screen.queryByRole("menuitem", { name: /vídeo/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /imagem|foto/i })).toBeInTheDocument();
  });
});
