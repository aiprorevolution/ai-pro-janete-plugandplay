import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { esquecerRascunhos, rascunhoGuardado } from "@/features/plataforma/comum/CaixaEscrever";
import { entraNaLinha, inicioDaLinha } from "@/features/plataforma/comum/linhaDoTempo";
import { erroDeReleitura, erroSemDados } from "@/features/plataforma/comum/releitura";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import { esquecerLinks, linksGuardados, useUrlMidia } from "@/features/plataforma/dados/midia";
import { ProvedorDados, type ServidorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";
import type { ContatoDados, ConversaDados } from "@/features/plataforma/dados/tipos";
import { InfoLead } from "@/features/plataforma/kanban/GavetaLead";
import { ProvedorPapel } from "@/features/plataforma/papel";

// As correções da revisão final do grupo "conversa" (Chat, Kanban, Contatos e comum/) que não cabem
// nos testes de cada área: a gaveta do Kanban no modo banco (o custo e o apagar), os rascunhos e os
// links assinados que o Sair esquece, e as regras comuns. Cliente do Firebase falso: nada vai à rede.

const navegar = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navegar,
}));

const UID = "u-1";
const AGORA = Date.parse("2026-11-02T15:00:00.000Z");
const EU = { id: "m-1", nome: "Operador Teste", email: "operador@example.test", papel: "admin" as const, ativo: true, user_id: UID, criado_em: "2026-10-01T12:00:00.000Z", vistos: {} };
const ETAPAS = [
  { id: "e-novo", chave: "novo", nome: "Novo", ordem: 10, tipo: "aberta", cor: null, janete_pode_mover: true, arquivada: false },
];

const CONTATO: ContatoDados = {
  id: "k-ana",
  nome: "Ana Prado",
  nome_whatsapp: null,
  telefone: "5511900000001",
  email: null,
  empresa: null,
  etapa_id: "e-novo",
  etapa_desde: "2026-10-29T12:00:00.000Z",
  observacoes: null,
  resumo_janete: null,
  primeira_mensagem_em: "2026-10-29T12:00:00.000Z",
  criado_em: "2026-10-29T12:00:00.000Z",
  atualizado_em: "2026-10-29T12:00:00.000Z",
  resumo_janete_em: null,
  anotacoes_janete: null,
} as ContatoDados;

const CONVERSA: ConversaDados = {
  id: "c-ana",
  contato_id: "k-ana",
  conexao_id: null,
  modo: "janete",
  motivo_humano: null,
  responsavel_id: null,
  aguardando_humano_desde: null,
  devolvida_em: null,
  nao_lidas: 0,
  ultima_do_lead_em: "2026-11-02T12:00:00.000Z",
  ultima_mensagem_em: "2026-11-02T12:00:00.000Z",
  ultima_mensagem_preview: "Oi",
  criado_em: "2026-10-29T12:00:00.000Z",
  atualizado_em: "2026-11-02T12:00:00.000Z",
  ultima_mensagem_id: null,
  ultima_da_janete_em: null,
} as ConversaDados;

function padrao(c: Consulta): Resposta | undefined {
  if (c.tabela === "etapas") return { data: ETAPAS, error: null };
  if (c.tabela === "membros") return c.unica ? { data: EU, error: null } : { data: [EU], error: null };
  return undefined;
}

function montarInfo(opcoes: { rpc?: (nome: string) => Resposta | Promise<Resposta> | undefined; servidor?: ServidorDados } = {}) {
  const f = criarClienteFalso({ uid: UID, consulta: padrao, rpc: (n) => opcoes.rpc?.(n) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  qc.setQueryData(CHAVES.eu, EU);
  const aoApagar = vi.fn();
  const r = render(
    <QueryClientProvider client={qc}>
      <ProvedorPapel inicial="admin">
        <ProvedorDados fonte="banco" cliente={f.cliente} servidor={opcoes.servidor}>
          <Suspense fallback={<p>suspenso</p>}>
            <InfoLead contato={CONTATO} conversa={CONVERSA} agora={AGORA} aoApagar={aoApagar} />
          </Suspense>
        </ProvedorDados>
      </ProvedorPapel>
    </QueryClientProvider>,
  );
  return { ...r, f, qc, aoApagar };
}

afterEach(() => {
  cleanup();
});

describe("gaveta do Kanban no banco: o custo de IA", () => {
  it("enquanto o custo não chega: 'Calculando…', não 'Nenhum gasto'", async () => {
    montarInfo({ rpc: (n) => (n === "custo_das_conversas" ? new Promise<Resposta>(() => {}) : undefined) });
    const bloco = await screen.findByRole("region", { name: "Custo de IA" });
    expect(within(bloco).getByText("Calculando…")).toBeInTheDocument();
    expect(within(bloco).queryByText(/Nenhum gasto/)).toBeNull();
  });

  it("se a leitura do custo falha: 'Não deu para calcular agora', não 'Nenhum gasto'", async () => {
    montarInfo({ rpc: (n) => (n === "custo_das_conversas" ? { data: null, error: { code: "42501", message: "x" } } : undefined) });
    const bloco = await screen.findByRole("region", { name: "Custo de IA" });
    expect(await within(bloco).findByText("Não deu para calcular agora")).toBeInTheDocument();
    expect(within(bloco).queryByText(/Nenhum gasto/)).toBeNull();
  });

  it("com o custo lido e zero: aí sim, 'Nenhum gasto de IA nesta conversa ainda.'", async () => {
    montarInfo({ rpc: (n) => (n === "custo_das_conversas" ? { data: [{ conversa_id: "c-ana", custo_usd: 0 }], error: null } : undefined) });
    const bloco = await screen.findByRole("region", { name: "Custo de IA" });
    expect(await within(bloco).findByText("Nenhum gasto de IA nesta conversa ainda.")).toBeInTheDocument();
  });
});

describe("gaveta do Kanban no banco: apagar contato", () => {
  it("trava enquanto espera o servidor: 'Apagando…', e o 2º clique não manda outro apagarContato", async () => {
    let soltar: (r: { ok: true }) => void = () => {};
    const apagarContato = vi.fn(() => new Promise<{ ok: true }>((ok) => (soltar = ok)));
    const { aoApagar } = montarInfo({ servidor: { apagarContato } });
    fireEvent.click(await screen.findByRole("button", { name: "Apagar contato" }));
    const dlg = screen.getByRole("alertdialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Apagar contato" }));
    const apagando = await within(dlg).findByRole("button", { name: "Apagando…" });
    expect(apagando).toBeDisabled();
    expect(apagando).toHaveAttribute("aria-busy", "true");
    expect(within(dlg).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(apagando);
    expect(apagarContato).toHaveBeenCalledTimes(1);
    await act(async () => soltar({ ok: true }));
    await waitFor(() => expect(aoApagar).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Não deu para apagar este contato.")).toBeNull();
  });
});

describe("o Sair esquece os rascunhos e os links assinados", () => {
  it("esquecerRascunhos esvazia o rascunho de todas as conversas", async () => {
    const { CaixaEscrever } = await import("@/features/plataforma/comum/CaixaEscrever");
    const qc = new QueryClient();
    const r = render(
      <QueryClientProvider client={qc}>
        <ProvedorPapel inicial="admin">
          <ProvedorDados fonte="banco" cliente={criarClienteFalso({ uid: UID, consulta: padrao }).cliente}>
            <CaixaEscrever conversaId="c-rascunho" bloqueio={null} faixa={null} aoEnviar={async () => ({ ok: true })} destinatario="Ana" />
          </ProvedorDados>
        </ProvedorPapel>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Mensagem/ }), { target: { value: "Texto da conta anterior" } });
    r.unmount();
    expect(rascunhoGuardado("c-rascunho")).toBe("Texto da conta anterior");
    esquecerRascunhos();
    expect(rascunhoGuardado("c-rascunho")).toBe("");
  });

  it("esquecerLinks tira os links guardados daquele QueryClient (o clear() não troca o objeto)", async () => {
    const f = criarClienteFalso({ uid: UID, consulta: padrao });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Links() {
      const r = useUrlMidia(["c-1/m-1"]);
      return <p>{r.urls["c-1/m-1"] ?? "sem link"}</p>;
    }
    render(
      <QueryClientProvider client={qc}>
        <ProvedorPapel inicial="admin">
          <ProvedorDados fonte="banco" cliente={f.cliente}>
            <Links />
          </ProvedorDados>
        </ProvedorPapel>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("https://falso/c-1/m-1?v=3600")).toBeInTheDocument();
    expect(linksGuardados(qc)).toBe(1);
    qc.clear();
    // o clear sozinho deixava o link para a próxima conta
    expect(linksGuardados(qc)).toBe(1);
    esquecerLinks(qc);
    expect(linksGuardados(qc)).toBe(0);
  });
});

describe("as regras comuns das telas de conversa", () => {
  it("inicioDaLinha: com mais antigas, o momento da mensagem mais antiga carregada; sem, tudo entra", () => {
    const msgs = [{ momento: "2026-11-02T14:20:00.000Z" }, { momento: "2026-11-02T14:10:00.000Z" }];
    const inicio = inicioDaLinha(msgs, true);
    expect(inicio).toBe(Date.parse("2026-11-02T14:10:00.000Z"));
    expect(entraNaLinha("2026-11-02T14:09:59.000Z", inicio)).toBe(false);
    expect(entraNaLinha("2026-11-02T14:10:00.000Z", inicio)).toBe(true);
    expect(inicioDaLinha(msgs, false)).toBe(-Infinity);
    expect(inicioDaLinha([], true)).toBe(-Infinity);
  });

  it("erroSemDados e erroDeReleitura: o erro toma a tela só sem dados", () => {
    expect(erroSemDados({ dados: undefined, erro: "falha" })).toBe("falha");
    expect(erroDeReleitura({ dados: undefined, erro: "falha" })).toBeNull();
    expect(erroSemDados({ dados: [], erro: "falha" })).toBeNull();
    expect(erroDeReleitura({ dados: [], erro: "falha" })).toBe("falha");
    expect(erroDeReleitura({ dados: null, erro: "sem_acesso" })).toBe("sem_acesso");
  });
});
