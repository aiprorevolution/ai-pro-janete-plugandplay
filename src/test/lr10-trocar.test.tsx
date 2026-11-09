import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaConfiguracao } from "@/features/plataforma/configuracao";
import {
  ServidorConfiguracaoContexto,
  type ServidorConfiguracao,
} from "@/features/plataforma/dados/configuracao";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta } from "@/features/plataforma/dados/testes/clienteFalso";
import type { ChaveIA } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// LR10 (spec-lacunas-mensageria, decisão 10): o Trocar de WhatsApp faz com a conexão antiga o mesmo
// que o Desconectar. O aviso do webhook dela (conexao_anterior, que o salvarConexao devolve) chega à
// tela de sucesso do Trocar: na Meta e na Z-API, tirar no painel; quando o desligar falhou, também.
// O cliente do Firebase e as funções de servidor são falsos: nada vai à rede nem ao banco.

vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return { ...real, movimentoReduzido: () => true, rolarAteEMedir: () => Promise.resolve(null) };
});

const AGORA = new Date("2026-11-02T15:00:00-03:00");
const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EU = {
  id: "mb-1",
  nome: "Ana",
  email: "ana@teste.com",
  papel: "admin",
  ativo: true,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
};
const minAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

const CONEXAO = {
  id: "cx-1",
  nome: "(11) 91234-5678",
  gateway: "zapi",
  status: "conectada",
  ativa: true,
  oficial: false,
  id_externo: null,
  ultimo_erro: null,
  criado_em: "2026-10-20T12:00:00.000Z",
  atualizado_em: "2026-10-20T12:00:00.000Z",
};
const CHAVE_RESPOSTA: ChaveIA = {
  id: "k-1",
  finalidade: "resposta",
  provedor: "anthropic",
  modelo: "claude-haiku-5-5",
  status: "ativa",
  ultimos4: "TSTE",
  ultimo_erro: null,
  validada_em: minAtras(60),
  atualizada_em: minAtras(60),
  atualizada_por: null,
} as ChaveIA;
const CONFIG = {
  id: 1,
  espera_lote_s: 8,
  espera_lote_max_s: 60,
  onboarding_concluido_em: "2026-10-21T12:00:00.000Z",
  atualizado_em: minAtras(1),
  worker_visto_em: minAtras(0.5),
};

/** A chave da voz (ElevenLabs) guardada, ativa. */
const CHAVE_VOZ = {
  ...CHAVE_RESPOSTA,
  id: "k-3",
  finalidade: "voz",
  provedor: "elevenlabs",
  modelo: "",
  ultimos4: "VOZ1",
} as ChaveIA;
/** As vozes da conta (a lista que o servidor devolve). */
const VOZES = [
  { id: "voz-a", nome: "Ana", detalhe: "Feminina · brasileira", portugues: true, previa: null },
  { id: "voz-b", nome: "Bruna", detalhe: null, portugues: true, previa: null },
];

interface Banco {
  conexao: Record<string, unknown> | null;
  evento: Record<string, unknown> | null;
  chaves: ChaveIA[];
  config: Record<string, unknown>;
  /** A linha da auditoria conexao_desativada (quem desligou pelo servidor). */
  auditoria?: Record<string, unknown> | null | undefined;
  erroEm?: string | undefined;
}

function servidorFalso(sobre: Partial<Record<keyof ServidorConfiguracao, unknown>> = {}) {
  const ok = (extra: Record<string, unknown> = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  const s = {
    salvarConexao: ok({
      conexao_id: "cx-2",
      nome: "(11) 95555-0000",
      gateway: "meta",
      url_webhook: "",
      avisos: [],
    }),
    verSegredoGerado: ok({ valor: "verify-guardado-123" }),
    desconectarConexao: ok({ conexao_id: "cx-1" }),
    conferirConexao: ok({
      conexao_id: "cx-1",
      gateway: "zapi",
      nome: "(11) 91234-5678",
      status: "conectada",
    }),
    consertarCampoConexao: ok({ conexao_id: "cx-1", gateway: "meta", nome: "(11) 91234-5678" }),
    salvarChaveIA: ok({ ultimos4: "ABCD", status: "ativa" }),
    revalidarChaveIA: ok({ status: "ativa", provedor: "anthropic", modelo: "claude-haiku-5-5" }),
    listarModelosDaChave: ok({ modelos: [], origem: "provedor" }),
    trocarModeloIA: ok({ modelo: "x", status: "ativa" }),
    removerChaveIA: ok(),
    salvarRitmo: ok({ espera: 9, teto: 60 }),
    listarModelos: ok({ modelos: [], origem: "provedor" }),
    listarVozes: ok({ vozes: VOZES, atual: null }),
    escolherVoz: ok({ voz: { id: "voz-b", nome: "Bruna (da ElevenLabs)" } }),
    salvarModoVoz: ok({ modo: "sempre" }),
    ...sobre,
  };
  return s as unknown as ServidorConfiguracao &
    Record<keyof ServidorConfiguracao, ReturnType<typeof vi.fn>>;
}

function montar(banco: Partial<Banco> = {}, servidor = servidorFalso()) {
  const b: Banco = {
    conexao: CONEXAO,
    evento: null,
    chaves: [CHAVE_RESPOSTA],
    config: CONFIG,
    ...banco,
  };
  const f = criarClienteFalso({
    uid: UID,
    consulta: (c: Consulta) => {
      if (b.erroEm === c.tabela)
        return { data: null, error: { code: "42501", message: "permission denied" } };
      switch (c.tabela) {
        case "membros":
          return { data: EU, error: null };
        case "conexoes":
          return { data: b.conexao, error: null };
        case "conexao_eventos":
          return { data: b.evento, error: null };
        case "ia_chaves":
          return { data: b.chaves, error: null };
        case "configuracao":
          return { data: b.config, error: null };
        case "auditoria":
          return { data: b.auditoria ?? null, error: null };
        default:
          return undefined;
      }
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProvedorPapel papel="admin">
        <Suspense fallback={<p>suspenso</p>}>
          <ProvedorDados fonte="banco" cliente={f.cliente}>
            <ServidorConfiguracaoContexto.Provider value={servidor}>
              <TelaConfiguracao />
            </ServidorConfiguracaoContexto.Provider>
          </ProvedorDados>
        </Suspense>
      </ProvedorPapel>
    </QueryClientProvider>,
  );
  return { f, b, servidor, qc };
}

async function andar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** As leituras chegam (promessas do cliente falso e do React Query). */
async function carregar() {
  for (let i = 0; i < 6; i++) await andar(5);
}

const cartao = (peca: "whats" | "cerebro" | "escuta" | "voz" | "ritmo") =>
  document.getElementById(`cfg-card-${peca}`)!;
const fluxo = () => document.getElementById("cfg-fluxo");
const botao = (nome: string | RegExp, dentro: HTMLElement = document.body) =>
  within(dentro).getByRole("button", { name: nome });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Troca a conexão (Z-API guardada) por uma da Meta, com o salvar devolvendo `conexao_anterior`. */
async function trocarParaMeta(
  conexaoAnterior?: unknown,
  guardada: Record<string, unknown> = CONEXAO,
) {
  const servidor = servidorFalso({
    salvarConexao: vi.fn(async () => ({
      ok: true,
      conexao_id: "cx-2",
      nome: "(11) 95555-0000",
      gateway: "meta",
      url_webhook: "https://janete.descontinuado.app/api/public/whatsapp/meta/cx-2",
      verifyToken: "vt-gerado-xyz",
      avisos: [],
      ...(conexaoAnterior === undefined ? {} : { conexao_anterior: conexaoAnterior }),
    })),
  });
  montar({ conexao: guardada }, servidor);
  await carregar();
  fireEvent.click(botao("Trocar de WhatsApp", cartao("whats")));
  const f = fluxo()!;
  fireEvent.click(within(f).getByRole("button", { name: /^Oficial/ }));
  fireEvent.click(within(f).getByRole("button", { name: /^API oficial da Meta/ }));
  fireEvent.change(within(f).getByLabelText("Phone Number ID"), { target: { value: "123" } });
  fireEvent.change(within(f).getByLabelText("ID da conta do WhatsApp Business"), {
    target: { value: "456" },
  });
  fireEvent.change(within(f).getByLabelText("Token de acesso permanente"), {
    target: { value: "EAAG-token" },
  });
  fireEvent.change(within(f).getByLabelText("App Secret"), { target: { value: "segredo-app" } });
  fireEvent.click(botao("Conectar", f));
  await andar(1500);
  expect(servidor.salvarConexao).toHaveBeenCalledTimes(1);
  expect(
    within(f).getByRole("heading", { name: "Tudo certo, WhatsApp conectado." }),
  ).toBeInTheDocument();
  return { f, fim: within(f).getByTestId("cfg-ok-conexao") };
}

describe("LR10: o webhook da conexão antiga no sucesso do Trocar", () => {
  it.each([
    ["zapi", "Z-API"],
    ["meta", "Meta"],
  ] as const)("anterior na %s: lembra de tirar no painel", async (gateway, nome) => {
    const { fim } = await trocarParaMeta(
      { gateway, aviso: "webhook_no_painel" },
      { ...CONEXAO, gateway, oficial: gateway === "meta" },
    );
    expect(fim).toHaveTextContent(`Tire também o webhook da conexão antiga no painel da ${nome}.`);
    // o resto do sucesso da Meta continua: o endereço e o token para colar
    expect(fim).toHaveTextContent("vt-gerado-xyz");
  });

  it.each([
    ["evolution", "Evolution"],
    ["zernio", "Zernio"],
  ] as const)(
    "anterior na %s que não desligou: diz que não deu e manda tirar no painel",
    async (gateway, nome) => {
      const { fim } = await trocarParaMeta(
        { gateway, aviso: "webhook_nao_desligado" },
        { ...CONEXAO, gateway, oficial: gateway === "zernio" },
      );
      expect(fim).toHaveTextContent(
        `Não deu para desligar o webhook da conexão antiga no provedor. Tire no painel da ${nome}.`,
      );
    },
  );

  it("sem conexao_anterior (desligou, ou não havia outra): nenhum lembrete", async () => {
    const { f } = await trocarParaMeta();
    expect(f).not.toHaveTextContent("conexão antiga");
  });

  it("conexao_anterior fora do formato é ignorada", async () => {
    const { f } = await trocarParaMeta({ gateway: "descontinuado", aviso: "webhook_no_painel" });
    expect(f).not.toHaveTextContent("conexão antiga");
  });
});
