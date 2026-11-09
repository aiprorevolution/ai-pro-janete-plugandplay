import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaConfiguracao } from "@/features/plataforma/configuracao";
import {
  ServidorConfiguracaoContexto,
  criarAcoesConfiguracaoBanco,
  type ServidorConfiguracao,
} from "@/features/plataforma/dados/configuracao";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta } from "@/features/plataforma/dados/testes/clienteFalso";
import type { ChaveIA } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// LB2 (spec-lacunas-mensageria, decisão 4): o Desconectar e o webhook no provedor. Na Meta e na
// Z-API, o diálogo lembra de tirar no painel; o aviso que volta do servidor vira texto na tela.
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

const conexao = (gateway: string) => ({
  id: "cx-1",
  nome: "(11) 91234-5678",
  gateway,
  status: "conectada",
  ativa: true,
  oficial: gateway === "meta",
  id_externo: null,
  ultimo_erro: null,
  criado_em: "2026-10-20T12:00:00.000Z",
  atualizado_em: "2026-10-20T12:00:00.000Z",
});
const CHAVE_RESPOSTA = {
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

function servidorFalso(desconectar: Record<string, unknown>) {
  const ok = (extra: Record<string, unknown> = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  return {
    salvarConexao: ok(),
    verSegredoGerado: ok({ valor: "verify-guardado-123" }),
    desconectarConexao: vi.fn(async () => desconectar),
    conferirConexao: ok(),
    consertarCampoConexao: ok(),
    salvarChaveIA: ok(),
    revalidarChaveIA: ok({ status: "ativa", provedor: "anthropic", modelo: "claude-haiku-5-5" }),
    listarModelosDaChave: ok({ modelos: [], origem: "provedor" }),
    trocarModeloIA: ok(),
    removerChaveIA: ok(),
    salvarRitmo: ok(),
    listarModelos: ok({ modelos: [], origem: "provedor" }),
    pedirQrConexao: ok(),
    pedirQrConexaoGuardada: ok(),
    listarVozes: ok({ vozes: [], atual: null }),
    escolherVoz: ok(),
    salvarModoVoz: ok(),
  } as unknown as ServidorConfiguracao &
    Record<keyof ServidorConfiguracao, ReturnType<typeof vi.fn>>;
}

/** `banco.desligada`: o banco que muda com o Desconectar (a conexão inativa e o evento ativa_para false). */
function montar(
  gateway: string,
  desconectar: Record<string, unknown> = { ok: true, conexao_id: "cx-1" },
  banco: { desligada: boolean } | null = null,
) {
  const servidor = servidorFalso(desconectar);
  if (banco) {
    servidor.desconectarConexao.mockImplementation(async () => {
      banco.desligada = true;
      return desconectar;
    });
  }
  const f = criarClienteFalso({
    uid: UID,
    consulta: (c: Consulta) => {
      switch (c.tabela) {
        case "membros":
          return { data: EU, error: null };
        case "conexoes":
          return {
            data: banco?.desligada
              ? { ...conexao(gateway), ativa: false, status: "desconectada" }
              : conexao(gateway),
            error: null,
          };
        case "conexao_eventos":
          return {
            data: banco?.desligada
              ? { id: "ev-1", ator_membro_id: EU.id, criado_em: AGORA.toISOString() }
              : null,
            error: null,
          };
        case "ia_chaves":
          return { data: [CHAVE_RESPOSTA], error: null };
        case "configuracao":
          return { data: CONFIG, error: null };
        case "auditoria":
          return { data: null, error: null };
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
  return { servidor };
}

async function andar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function carregar() {
  for (let i = 0; i < 6; i++) await andar(5);
}

const cartao = () => document.getElementById("cfg-card-whats")!;
const botao = (nome: string, dentro: HTMLElement) =>
  within(dentro).getByRole("button", { name: nome });

async function abrirDialogo() {
  await carregar();
  fireEvent.click(botao("Desconectar", cartao()));
  return screen.getByRole("alertdialog", { name: "Desconectar o WhatsApp?" });
}

async function confirmar() {
  const dlg = await abrirDialogo();
  fireEvent.click(botao("Desconectar", dlg));
  await carregar();
}

/** O aviso rápido com este texto (o visível; o mesmo texto vai ao leitor de tela, no status). */
const avisoRapido = (texto: string) =>
  screen.queryAllByText(texto).find((el) => el.closest("[aria-hidden='true']")) ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("o diálogo do Desconectar lembra do webhook no painel", () => {
  it("Meta: 'Tire também o webhook no painel da Meta.'", async () => {
    montar("meta");
    const dlg = await abrirDialogo();
    expect(dlg).toHaveTextContent("A Janete para de receber e de responder mensagens no");
    expect(dlg).toHaveTextContent("Tire também o webhook no painel da Meta.");
  });

  it("Z-API: 'Tire também o webhook no painel da Z-API.'", async () => {
    montar("zapi");
    const dlg = await abrirDialogo();
    expect(dlg).toHaveTextContent("Tire também o webhook no painel da Z-API.");
  });

  it.each(["evolution", "zernio"])("%s desliga sozinha: sem o lembrete", async (gateway) => {
    montar(gateway);
    const dlg = await abrirDialogo();
    expect(dlg.textContent).not.toMatch(/webhook/);
  });
});

describe("o que a tela mostra depois do Desconectar", () => {
  it("webhook_nao_desligado na Evolution: o texto manda ao painel da Evolution", async () => {
    const { servidor } = montar("evolution", {
      ok: true,
      conexao_id: "cx-1",
      aviso: "webhook_nao_desligado",
    });
    await confirmar();
    expect(servidor.desconectarConexao).toHaveBeenCalledTimes(1);
    expect(
      avisoRapido(
        "O WhatsApp foi desconectado, mas não deu para desligar o webhook no provedor. Tire no painel da Evolution.",
      ),
    ).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Tire no painel da Evolution.");
  });

  it("webhook_nao_desligado na Zernio: o texto manda ao painel da Zernio", async () => {
    montar("zernio", { ok: true, conexao_id: "cx-1", aviso: "webhook_nao_desligado" });
    await confirmar();
    expect(
      avisoRapido(
        "O WhatsApp foi desconectado, mas não deu para desligar o webhook no provedor. Tire no painel da Zernio.",
      ),
    ).not.toBeNull();
  });

  it("webhook_no_painel na Z-API: repete o lembrete do painel", async () => {
    montar("zapi", { ok: true, conexao_id: "cx-1", aviso: "webhook_no_painel" });
    await confirmar();
    expect(
      avisoRapido(
        "WhatsApp desconectado. A Janete parou de atender. Tire também o webhook no painel da Z-API.",
      ),
    ).not.toBeNull();
  });

  it("webhook_no_painel na Meta: repete o lembrete do painel", async () => {
    montar("meta", { ok: true, conexao_id: "cx-1", aviso: "webhook_no_painel" });
    await confirmar();
    expect(
      avisoRapido(
        "WhatsApp desconectado. A Janete parou de atender. Tire também o webhook no painel da Meta.",
      ),
    ).not.toBeNull();
  });

  it("sem aviso (o webhook foi desligado): o texto de sempre", async () => {
    montar("evolution");
    await confirmar();
    expect(avisoRapido("WhatsApp desconectado. A Janete parou de atender.")).not.toBeNull();
  });

  it("o webhook desligado e a conexão não: o texto do servidor manda desconectar de novo", async () => {
    const mensagem =
      "O webhook já foi desligado no provedor, mas a conexão não. Desconecte de novo para terminar: até lá, a Janete não recebe mensagens.";
    montar("evolution", { ok: false, erro: "erro_ao_gravar", mensagem });
    await confirmar();
    expect(avisoRapido(mensagem)).not.toBeNull();
  });
});

describe("a espera e o lembrete que fica (I-2 e I-3 da revisão)", () => {
  it("enquanto o provedor não responde, o botão diz 'Desconectando…' com o indicador de espera", async () => {
    const { servidor } = montar("evolution");
    let soltar: (r: unknown) => void = () => {};
    servidor.desconectarConexao.mockImplementation(() => new Promise((r) => (soltar = r)));
    const dlg = await abrirDialogo();
    fireEvent.click(botao("Desconectar", dlg));
    await andar(5);
    const esperando = botao("Desconectando…", cartao());
    expect(esperando).toBeDisabled();
    expect(esperando.querySelector("[aria-hidden='true']")).not.toBeNull();
    soltar({ ok: true, conexao_id: "cx-1" });
    await carregar();
    expect(within(cartao()).queryByRole("button", { name: "Desconectando…" })).toBeNull();
  });

  it("webhook_nao_desligado: o lembrete fica no aviso do cartão depois que o aviso rápido some", async () => {
    montar(
      "evolution",
      { ok: true, conexao_id: "cx-1", aviso: "webhook_nao_desligado" },
      { desligada: false },
    );
    await confirmar();
    await andar(5000);
    expect(
      avisoRapido(
        "O WhatsApp foi desconectado, mas não deu para desligar o webhook no provedor. Tire no painel da Evolution.",
      ),
    ).toBeNull();
    const alerta = within(cartao()).getByRole("alert");
    expect(alerta).toHaveTextContent("Você desconectou este número pela Configuração.");
    expect(alerta).toHaveTextContent(
      "Não deu para desligar o webhook no provedor. Tire no painel da Evolution.",
    );
  });

  it("sem aviso do servidor: o cartão desconectado não fala do webhook", async () => {
    montar("evolution", { ok: true, conexao_id: "cx-1" }, { desligada: false });
    await confirmar();
    await andar(5000);
    const alerta = within(cartao()).getByRole("alert");
    expect(alerta).toHaveTextContent("Você desconectou este número pela Configuração.");
    expect(alerta.textContent).not.toMatch(/webhook/);
  });
});

describe("a camada de dados leva o aviso do servidor", () => {
  it("passa os dois avisos conhecidos e ignora outro valor", async () => {
    const qc = new QueryClient();
    for (const aviso of ["webhook_no_painel", "webhook_nao_desligado"]) {
      const acoes = criarAcoesConfiguracaoBanco(
        servidorFalso({ ok: true, conexao_id: "cx-1", aviso }),
        qc,
      );
      expect(await acoes.desconectar()).toEqual({ ok: true, aviso });
    }
    const semAviso = criarAcoesConfiguracaoBanco(
      servidorFalso({ ok: true, conexao_id: "cx-1" }),
      qc,
    );
    expect(await semAviso.desconectar()).toEqual({ ok: true });
    const estranho = criarAcoesConfiguracaoBanco(
      servidorFalso({ ok: true, conexao_id: "cx-1", aviso: "x" }),
      qc,
    );
    expect(await estranho.desconectar()).toEqual({ ok: true });
  });
});
