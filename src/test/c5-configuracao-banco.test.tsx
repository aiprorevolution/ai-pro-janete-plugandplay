import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaConfiguracao } from "@/features/plataforma/configuracao";
import { PASSO_ESCUTA_TRANSCREVE } from "@/features/plataforma/configuracao/Fluxo";
import { nosEmRepouso } from "@/features/plataforma/configuracao/Saude";
import { LIMITE_MOTOR_MS, lerEscuta, lerMotor, motorParado } from "@/features/plataforma/configuracao/leitura";
import { textoErroChave, textoErroConexao, textoFalhaAcao } from "@/features/plataforma/configuracao/textos";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import {
  ServidorConfiguracaoContexto,
  criarAcoesConfiguracaoBanco,
  type ServidorConfiguracao,
} from "@/features/plataforma/dados/configuracao";
import { ProvedorDados, type ServidorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta } from "@/features/plataforma/dados/testes/clienteFalso";
import { criarEstadoInicial, type ChaveIA } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// C5: a Configuração ligada ao banco. O cliente do Firebase é falso (dados/testes/clienteFalso) e as
// funções de servidor da mensageria também (ServidorConfiguracaoContexto): nada vai à rede nem ao
// banco. O modo exemplo continua coberto em t3-configuracao.test.tsx.

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
  /** A linha da rpc motor_pendencias (spec-motor-acordado); padrão: nada pendente. */
  motor?:
    | { proximo_em: string | null; vencido_desde: string | null; atrasado_desde: string | null }
    | undefined;
  /** A rpc motor_pendencias dá erro. */
  motorFalha?: boolean | undefined;
}

/** Nada pendente no motor (a linha da rpc). */
const MOTOR_VAZIO = { proximo_em: null, vencido_desde: null, atrasado_desde: null };

function servidorFalso(sobre: Partial<Record<keyof ServidorConfiguracao, unknown>> = {}) {
  const ok = (extra: Record<string, unknown> = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  const s = {
    salvarConexao: ok({ conexao_id: "cx-2", nome: "(11) 95555-0000", gateway: "meta", url_webhook: "", avisos: [] }),
    verSegredoGerado: ok({ valor: "verify-guardado-123" }),
    desconectarConexao: ok({ conexao_id: "cx-1" }),
    conferirConexao: ok({ conexao_id: "cx-1", gateway: "zapi", nome: "(11) 91234-5678", status: "conectada" }),
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
    usarChaveElevenLabs: ok({ copiada: true, ultimos4: "ABCD", status: "ativa" }),
    ...sobre,
  };
  return s as unknown as ServidorConfiguracao & Record<keyof ServidorConfiguracao, ReturnType<typeof vi.fn>>;
}

function montar(banco: Partial<Banco> = {}, servidor = servidorFalso(), servidorDados?: ServidorDados) {
  const b: Banco = { conexao: CONEXAO, evento: null, chaves: [CHAVE_RESPOSTA], config: CONFIG, ...banco };
  const f = criarClienteFalso({
    uid: UID,
    consulta: (c: Consulta) => {
      if (b.erroEm === c.tabela) return { data: null, error: { code: "42501", message: "permission denied" } };
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
    rpc: (nome) => {
      if (nome !== "motor_pendencias") return undefined;
      if (b.motorFalha) return { data: null, error: { code: "42501", message: "sem_acesso" } };
      return { data: [b.motor ?? MOTOR_VAZIO], error: null };
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProvedorPapel papel="admin">
        <Suspense fallback={<p>suspenso</p>}>
          <ProvedorDados fonte="banco" cliente={f.cliente} servidor={servidorDados}>
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

const cartao = (peca: "whats" | "cerebro" | "escuta" | "voz" | "ritmo") => document.getElementById(`cfg-card-${peca}`)!;
const fluxo = () => document.getElementById("cfg-fluxo");
const botao = (nome: string | RegExp, dentro: HTMLElement = document.body) => within(dentro).getByRole("button", { name: nome });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Configuração ligada ao banco: leituras e estados", () => {
  it("a área lê só pela camada de dados: nenhum useExemplo nos arquivos da Configuração", () => {
    const pasta = path.resolve(__dirname, "../features/plataforma/configuracao");
    const arquivos = readdirSync(pasta).filter((n) => /\.(ts|tsx)$/.test(n));
    expect(arquivos.length).toBeGreaterThan(5);
    for (const nome of arquivos) {
      const texto = readFileSync(path.join(pasta, nome), "utf-8");
      expect(texto, nome).not.toMatch(/useExemplo/);
    }
  });

  it("carregando: os ossos dos cartões, com o rótulo para o leitor de tela", async () => {
    montar();
    await andar(0);
    // antes das leituras chegarem (o Eu suspende ou os dados ainda não vieram)
    const carregando = screen.queryByRole("status", { name: "Carregando a Configuração" });
    const suspenso = screen.queryByText("suspenso");
    expect(carregando ?? suspenso).not.toBeNull();
    await carregar();
    expect(screen.queryByRole("status", { name: "Carregando a Configuração" })).not.toBeInTheDocument();
    expect(cartao("whats")).not.toBeNull();
  });

  it("erro de leitura: o aviso com o texto do erro e 'Tentar de novo' relê", async () => {
    const { f, b } = montar({ erroEm: "configuracao" });
    await carregar();
    expect(screen.getByText("Não deu para carregar a Configuração")).toBeInTheDocument();
    expect(screen.getByText("Sua conta não tem acesso a isto.")).toBeInTheDocument();
    const antes = f.consultas.filter((c) => c.tabela === "configuracao").length;
    b.erroEm = undefined;
    fireEvent.click(botao("Tentar de novo"));
    await carregar();
    expect(f.consultas.filter((c) => c.tabela === "configuracao").length).toBeGreaterThan(antes);
    expect(cartao("ritmo")).not.toBeNull();
  });

  it("lê a conexão com as colunas listadas (nunca '*'), a ativa primeiro", async () => {
    const { f } = montar();
    await carregar();
    const cx = f.consultas.filter((c) => c.tabela === "conexoes");
    expect(cx.length).toBeGreaterThan(0);
    for (const c of cx) expect(c.valor).not.toBe("*");
    const daCfg = cx.find((c) => c.passos.some((p) => p[0] === "order" && p[1] === "ativa"));
    expect(daCfg).toBeDefined();
    expect(f.consultas.filter((c) => c.tabela === "ia_chaves").every((c) => c.valor !== "*")).toBe(true);
  });

  it("com tudo em dia: a Janete atende, o ritmo fica verde e não há caixa de 'Simular'", async () => {
    montar();
    await carregar();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
    expect(within(cartao("ritmo")).getByText("Sempre ligada")).toBeInTheDocument();
    expect(within(cartao("whats")).getByRole("heading", { name: "(11) 91234-5678" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Simular/);
  });
});

describe("spec-motor-acordado: o atraso da Janete (motor_pendencias) e o verde do ritmo", () => {
  const SUB_ATRASADA =
    "As mensagens chegam, mas a resposta está demorando. A Janete já foi chamada de novo; se continuar, confira a conexão e as chaves.";
  const atrasado = (min: number) => ({
    ...MOTOR_VAZIO,
    vencido_desde: minAtras(min),
    atrasado_desde: minAtras(min),
  });

  it("trabalho esperando há mais de 3 min: 'A Janete está atrasada há X min', e o ritmo sai do verde", async () => {
    montar({ motor: atrasado(10) });
    await carregar();
    expect(
      screen.getByRole("heading", { name: "A Janete está atrasada há 10 min" }),
    ).toBeInTheDocument();
    expect(screen.getByText(SUB_ATRASADA)).toBeInTheDocument();
    // o atraso não é parada (decisão do equipe, 03/11): a Janete não dorme, e o Ritmo diz "Atrasada agora"
    expect(screen.getByRole("img", { name: "Janete, atrasada" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Janete, parada" })).not.toBeInTheDocument();
    expect(within(cartao("ritmo")).getByText("Atrasada agora")).toBeInTheDocument();
    expect(within(cartao("ritmo")).queryByText("Parada agora")).not.toBeInTheDocument();
    expect(within(cartao("ritmo")).queryByText("Sempre ligada")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Espera, Junta as mensagens: Atrasada há 10 min: a resposta está demorando. Ver os detalhes.",
      }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/agendamento/i);
  });

  it("atraso junto com o WhatsApp caído ou o cérebro sem chave: continua parada", async () => {
    montar({ motor: atrasado(10), conexao: { ...CONEXAO, status: "desconectada" } });
    await carregar();
    expect(screen.getByRole("img", { name: "Janete, parada" })).toBeInTheDocument();
    expect(within(cartao("ritmo")).getByText("Parada agora")).toBeInTheDocument();
    expect(within(cartao("ritmo")).queryByText("Atrasada agora")).not.toBeInTheDocument();
    cleanup();
    montar({ motor: atrasado(10), chaves: [] });
    await carregar();
    expect(screen.getByRole("img", { name: "Janete, parada" })).toBeInTheDocument();
    expect(within(cartao("ritmo")).getByText("Parada agora")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Janete, atrasada" })).not.toBeInTheDocument();
  });

  it("dia calmo não avisa: o worker parado há 10 min sem nada pendente, ou um item vencido há 2 min, é 'atendendo'", async () => {
    montar({ config: { ...CONFIG, worker_visto_em: minAtras(10) } });
    await carregar();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Espera, Junta as mensagens: Espera 8 s, no máximo 60 s. Ver os detalhes.",
      }),
    ).toBeInTheDocument();
    cleanup();
    montar({ motor: atrasado(2) });
    await carregar();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
    expect(screen.queryByText(SUB_ATRASADA)).not.toBeInTheDocument();
  });

  it("aguardando (o motor nunca rodou e nada pendente): não é aviso, e o ritmo diz que a Janete liga sozinha", async () => {
    montar({ config: { ...CONFIG, worker_visto_em: null } });
    await carregar();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
    // a frase também no sub, que aparece no celular (o detalhe do nó some abaixo de 600 px)
    expect(screen.getByText(/A Janete liga sozinha quando chegar a primeira mensagem\.$/)).toBeInTheDocument();
    expect(screen.queryByText("Precisa de você")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Espera, Junta as mensagens: A Janete liga sozinha quando chegar a primeira mensagem. Ver os detalhes.",
      }),
    ).toBeInTheDocument();
    expect(within(cartao("ritmo")).getByText("Sempre ligada")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/agendamento/i);
    // com algo pendente (a 1ª mensagem chegou e espera o lote), já não é "aguardando"
    cleanup();
    montar({
      config: { ...CONFIG, worker_visto_em: null },
      motor: { ...MOTOR_VAZIO, proximo_em: new Date(AGORA.getTime() + 5000).toISOString() },
    });
    await carregar();
    expect(screen.queryByRole("button", { name: /A Janete liga sozinha/ })).not.toBeInTheDocument();
  });

  it("o relógio anda sozinho: sem ninguém mexer, o aviso aparece depois dos 3 min", async () => {
    montar({ motor: atrasado(2.5) });
    await carregar();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
    await andar(60_000);
    expect(
      screen.getByRole("heading", { name: "A Janete está atrasada há 3 min" }),
    ).toBeInTheDocument();
  });

  it("a tela aberta relê o motor sozinha: o atraso que passou some sem ninguém mexer", async () => {
    const { b, f } = montar({ motor: atrasado(10) });
    await carregar();
    expect(
      screen.getByRole("heading", { name: "A Janete está atrasada há 10 min" }),
    ).toBeInTheDocument();
    const antes = f.rpcs.filter((r) => r.nome === "motor_pendencias").length;
    b.motor = MOTOR_VAZIO;
    for (let i = 0; i < 3; i++) await andar(60_000);
    await carregar();
    expect(f.rpcs.filter((r) => r.nome === "motor_pendencias").length).toBeGreaterThanOrEqual(
      antes + 3,
    );
    expect(screen.queryByRole("heading", { name: /A Janete está atrasada/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
  });

  it("a leitura do motor em erro não afirma nada: nem o atraso de antes, nem 'aguardando'", async () => {
    const { b } = montar({ motor: atrasado(10) });
    await carregar();
    expect(
      screen.getByRole("heading", { name: "A Janete está atrasada há 10 min" }),
    ).toBeInTheDocument();
    b.motorFalha = true;
    await andar(60_000);
    await carregar();
    expect(screen.queryByRole("heading", { name: /A Janete está atrasada/ })).not.toBeInTheDocument();
    cleanup();
    montar({ config: { ...CONFIG, worker_visto_em: null }, motorFalha: true });
    await carregar();
    expect(screen.queryByRole("button", { name: /A Janete liga sozinha/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/A Janete liga sozinha/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
  });

  it("sem uma leitura válida do motor, o nó do ritmo fica neutro (sem o verde de 'em dia')", () => {
    const w = { ok: true } as Parameters<typeof nosEmRepouso>[0];
    const esc = { conhecida: true, ok: true } as Parameters<typeof nosEmRepouso>[1];
    const cer = { conhecida: true, ok: true } as Parameters<typeof nosEmRepouso>[2];
    const semLeitura = lerMotor(undefined, AGORA, true, false, minAtras(0.5));
    expect(nosEmRepouso(w, esc, cer, semLeitura)[2]).toBe("desconhecido");
    const emDia = lerMotor(
      { proximoEm: null, vencidoDesde: null, atrasadoDesde: null },
      AGORA,
      true,
      false,
      minAtras(0.5),
    );
    expect(nosEmRepouso(w, esc, cer, emDia)[2]).toBe("ok");
    // o exemplo (sem motor) continua verde
    expect(nosEmRepouso(w, esc, cer, lerMotor(undefined, AGORA, false))[2]).toBe("ok");
  });

  it("a Janete atrasada deixa o nó do ritmo em atenção, não em erro; o onboarding aberto continua em erro", () => {
    const w = { ok: true } as Parameters<typeof nosEmRepouso>[0];
    const esc = { conhecida: true, ok: true } as Parameters<typeof nosEmRepouso>[1];
    const cer = { conhecida: true, ok: true } as Parameters<typeof nosEmRepouso>[2];
    const pendencias = {
      proximoEm: null,
      vencidoDesde: AGORA.getTime() - 5 * 60_000,
      atrasadoDesde: AGORA.getTime() - 5 * 60_000,
    };
    const atrasada = lerMotor(pendencias, AGORA, true, false, minAtras(0.5));
    expect(atrasada.estado).toBe("atrasado");
    expect(nosEmRepouso(w, esc, cer, atrasada)[2]).toBe("atencao");
    const onboarding = lerMotor(pendencias, AGORA, true, true, minAtras(0.5));
    expect(nosEmRepouso(w, esc, cer, onboarding)[2]).toBe("erro");
  });

  it("onboarding_concluido_em nulo conta como parada, com os textos de hoje, mesmo com o motor em dia", async () => {
    montar({ config: { ...CONFIG, onboarding_concluido_em: null } });
    await carregar();
    expect(screen.getByRole("heading", { name: "A Janete ainda não atende" })).toBeInTheDocument();
    expect(
      screen.getByText(/O onboarding ainda não foi concluído: a Janete não atende/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "A Janete está atendendo" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Janete, parada" })).toBeInTheDocument();
    expect(within(cartao("ritmo")).getByText("Parada agora")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^Espera, Junta as mensagens: Parada até o onboarding ser concluído/,
      }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/agendamento/i);
  });

  it("Conferir tudo com a Janete atrasada para no ritmo, sem falar em agendamento", async () => {
    const servidor = servidorFalso();
    montar({ motor: atrasado(10) }, servidor);
    await carregar();
    fireEvent.click(botao("Conferir tudo agora"));
    await andar(3000);
    expect(
      screen.getByRole("heading", { name: "A conferência parou no ritmo" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(SUB_ATRASADA).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/agendamento/i);
  });

  it("lerMotor: os 5 estados, o limite de 3 min e 1 ms depois, e o modo exemplo", () => {
    const ms = AGORA.getTime();
    const p = (
      atrasadoDesde: number | null,
      extra: Partial<{ proximoEm: number; vencidoDesde: number }> = {},
    ) => ({
      proximoEm: extra.proximoEm ?? null,
      vencidoDesde: extra.vencidoDesde ?? atrasadoDesde,
      atrasadoDesde,
    });
    // no limite, ainda ok; 1 ms depois, atrasada há 3 min
    expect(lerMotor(p(ms - LIMITE_MOTOR_MS), AGORA, true, false, minAtras(0.5))).toEqual({
      estado: "ok",
      minutos: 0,
    });
    expect(lerMotor(p(ms - LIMITE_MOTOR_MS - 1), AGORA, true, false, minAtras(0.5))).toEqual({
      estado: "atrasado",
      minutos: 3,
      desde: ms - LIMITE_MOTOR_MS - 1,
    });
    // só o atrasado_desde avisa: um evento do webhook vencido há 10 min (vencido sem atrasado), não
    expect(
      lerMotor(p(null, { vencidoDesde: ms - 600_000 }), AGORA, true, false, minAtras(0.5)).estado,
    ).toBe("ok");
    // aguardando: nunca rodou e nada pendente; com o sinal desconhecido (undefined), não afirma
    expect(lerMotor(p(null), AGORA, true, false, null)).toEqual({
      estado: "aguardando",
      minutos: 0,
    });
    expect(lerMotor(p(null), AGORA, true, false, undefined).estado).toBe("ok");
    expect(lerMotor(p(null, { proximoEm: ms + 5000 }), AGORA, true, false, null).estado).toBe("ok");
    // onboarding vem antes de tudo; sem leitura válida no banco, sem_leitura; no exemplo, desconhecido
    expect(lerMotor(p(ms - 600_000), AGORA, true, true, null)).toEqual({
      estado: "onboarding",
      minutos: 0,
    });
    expect(lerMotor(undefined, AGORA, true, false, null)).toEqual({
      estado: "sem_leitura",
      minutos: 0,
    });
    expect(lerMotor(p(ms - 600_000), AGORA, false, true, null).estado).toBe("desconhecido");
    // o que para a Janete: o atraso e o onboarding (o aguardando não é aviso)
    expect(motorParado(lerMotor(p(ms - 600_000), AGORA, true))).toBe(true);
    expect(motorParado(lerMotor(p(null), AGORA, true, true))).toBe(true);
    expect(motorParado(lerMotor(p(null), AGORA, true, false, null))).toBe(false);
    expect(motorParado(lerMotor(undefined, AGORA, false))).toBe(false);
  });
});

describe("spec-motor-acordado, decisão 2: o conserto sozinho pela tela aberta", () => {
  it("vencido há mais de 60 s: pede o toque sem esperar, no máximo 1 vez por minuto", async () => {
    let soltar: () => void = () => {};
    const acordarMotor = vi.fn(() => new Promise<unknown>((r) => (soltar = () => r({ ok: true }))));
    const { f, qc } = montar(
      { motor: { ...MOTOR_VAZIO, vencido_desde: minAtras(5), atrasado_desde: minAtras(5) } },
      servidorFalso(),
      {
        acordarMotor,
      },
    );
    await carregar();
    expect(acordarMotor).toHaveBeenCalledTimes(1);
    // a resposta não chegou e a tela não espera: a releitura e o foco dentro do minuto não pedem de novo
    await andar(30_000);
    const leituras = f.rpcs.filter((r) => r.nome === "motor_pendencias").length;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await qc.invalidateQueries({ queryKey: CHAVES.motor });
    });
    await carregar();
    expect(f.rpcs.filter((r) => r.nome === "motor_pendencias").length).toBeGreaterThan(leituras);
    await andar(29_000);
    expect(acordarMotor).toHaveBeenCalledTimes(1);
    // passou 1 min do toque e continua vencido: pede de novo
    await andar(2_000);
    await carregar();
    expect(acordarMotor).toHaveBeenCalledTimes(2);
    soltar();
    // em 5 min, no máximo 1 por minuto
    await andar(5 * 60_000);
    expect(acordarMotor.mock.calls.length).toBeLessThanOrEqual(2 + 5);
    expect(acordarMotor.mock.calls.length).toBeGreaterThanOrEqual(2 + 4);
  });

  it("vencido há menos de 60 s espera completar o minuto; nada vencido, nunca pede; o toque que falha não quebra a tela", async () => {
    const acordarMotor = vi.fn(async () => {
      throw new Error("rede");
    });
    montar({ motor: { ...MOTOR_VAZIO, vencido_desde: minAtras(0.5) } }, servidorFalso(), {
      acordarMotor,
    });
    await carregar();
    expect(acordarMotor).not.toHaveBeenCalled();
    await andar(30_000);
    expect(acordarMotor).toHaveBeenCalledTimes(1);
    // um evento do webhook vencido não vira aviso (só o atraso sem eventos avisa)
    expect(screen.getByRole("heading", { name: "A Janete está atendendo" })).toBeInTheDocument();
    cleanup();
    acordarMotor.mockClear();
    montar({}, servidorFalso(), { acordarMotor });
    await carregar();
    await andar(3 * 60_000);
    expect(acordarMotor).not.toHaveBeenCalled();
  });

  it("sem uma leitura válida (erro), não pede o toque", async () => {
    const acordarMotor = vi.fn(async () => ({ ok: true }));
    montar({ motorFalha: true }, servidorFalso(), { acordarMotor });
    await carregar();
    await andar(3 * 60_000);
    expect(acordarMotor).not.toHaveBeenCalled();
  });
});

describe("'Você desconectou' só quando a conexão foi desativada", () => {
  it("conexão inativa com o evento ativa_para false: 'Você desconectou este número' e 'Conectar de novo'", async () => {
    // o servidor desliga com a chave de serviço (ator nulo no evento); quem desligou vem da auditoria
    const { f } = montar({
      conexao: { ...CONEXAO, ativa: false, status: "desconectada" },
      evento: { id: "ev-1", ator_membro_id: null, criado_em: minAtras(5) },
      auditoria: { ator_membro_id: EU.id },
    });
    await carregar();
    const w = cartao("whats");
    expect(within(w).getByRole("alert")).toHaveTextContent("Você desconectou este número pela Configuração.");
    expect(screen.getAllByRole("button", { name: "Conectar de novo" }).length).toBeGreaterThan(0);
    const ev = f.consultas.find((c) => c.tabela === "conexao_eventos")!;
    expect(ev.passos).toEqual(
      expect.arrayContaining([
        ["eq", "conexao_id", "cx-1"],
        ["eq", "ativa_de", true],
        ["eq", "ativa_para", false],
      ]),
    );
    const au = f.consultas.find((c) => c.tabela === "auditoria")!;
    expect(au.passos).toEqual(
      expect.arrayContaining([
        ["eq", "acao", "conexao_desativada"],
        ["eq", "alvo", "cx-1"],
      ]),
    );
  });

  it("desligada pelo servidor por outro admin (auditoria): na terceira pessoa", async () => {
    montar({
      conexao: { ...CONEXAO, ativa: false, status: "desconectada" },
      evento: { id: "ev-1", ator_membro_id: null, criado_em: minAtras(5) },
      auditoria: { ator_membro_id: "mb-outro" },
    });
    await carregar();
    expect(within(cartao("whats")).getByRole("alert")).toHaveTextContent("Este número foi desconectado pela Configuração.");
  });

  it("sem saber quem desligou (sem ator e sem auditoria): frase neutra, nunca 'você'", async () => {
    montar({
      conexao: { ...CONEXAO, ativa: false, status: "desconectada" },
      evento: { id: "ev-1", ator_membro_id: null, criado_em: minAtras(5) },
      auditoria: null,
    });
    await carregar();
    const alerta = within(cartao("whats")).getByRole("alert");
    expect(alerta).toHaveTextContent("Este número foi desconectado pela Configuração.");
    expect(alerta.textContent).not.toMatch(/Você desconectou/);
  });

  it("desativada por outra pessoa: na terceira pessoa", async () => {
    montar({
      conexao: { ...CONEXAO, ativa: false, status: "desconectada" },
      evento: { id: "ev-1", ator_membro_id: "mb-outro", criado_em: minAtras(5) },
    });
    await carregar();
    expect(within(cartao("whats")).getByRole("alert")).toHaveTextContent("Este número foi desconectado pela Configuração.");
  });

  it("inativa sem o evento: conta como nenhum número (não afirma que alguém desligou)", async () => {
    montar({ conexao: { ...CONEXAO, ativa: false, status: "desconectada" }, evento: null });
    await carregar();
    const w = cartao("whats");
    expect(within(w).getByRole("heading", { name: "Nenhum número conectado" })).toBeInTheDocument();
    expect(w.textContent).not.toMatch(/desconectou/);
  });

  it("ativa que caiu: o código de ultimo_erro vira texto, e nunca 'Você desconectou'", async () => {
    montar({ conexao: { ...CONEXAO, status: "desconectada", ultimo_erro: "instancia_desconectada" } });
    await carregar();
    const alerta = within(cartao("whats")).getByRole("alert");
    expect(alerta).toHaveTextContent("A Z-API avisou que o número saiu do WhatsApp no celular.");
    expect(alerta.textContent).not.toMatch(/instancia_desconectada|Você desconectou/);
    // o conserto aparece no cartão e na Saúde
    expect(screen.getAllByRole("button", { name: "Mostrar o QR code" })).toHaveLength(2);
  });
});

describe("ações pelo servidor da mensageria", () => {
  it("Desconectar chama desconectarConexao e relê a conexão", async () => {
    const { servidor, f } = montar();
    await carregar();
    const antes = f.consultas.filter((c) => c.tabela === "conexoes").length;
    fireEvent.click(botao("Desconectar", cartao("whats")));
    fireEvent.click(botao("Desconectar", screen.getByRole("alertdialog")));
    await carregar();
    expect(servidor.desconectarConexao).toHaveBeenCalledTimes(1);
    expect(f.consultas.filter((c) => c.tabela === "conexoes").length).toBeGreaterThan(antes);
    expect(screen.getAllByText("WhatsApp desconectado. A Janete parou de atender.").length).toBeGreaterThan(0);
  });

  it("Testar a conexão agora faz a conferência grátis (conferirConexao); a recusa vira texto", async () => {
    const servidor = servidorFalso();
    const { servidor: s } = montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Testar a conexão agora", cartao("whats")));
    await andar(400);
    expect(s.conferirConexao).toHaveBeenCalledTimes(1);
    expect(within(cartao("whats")).getByText("Conectado · testado agora")).toBeInTheDocument();

    s.conferirConexao.mockResolvedValueOnce({ ok: false, erro: "servidor_inacessivel", mensagem: "" });
    fireEvent.click(botao("Testar a conexão agora", cartao("whats")));
    await andar(400);
    expect(screen.getAllByText(/Não conseguimos falar com o gateway/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/servidor_inacessivel/);
  });

  it("Conferir tudo usa as conferências de verdade e para onde a resposta parou", async () => {
    const servidor = servidorFalso();
    servidor.conferirConexao.mockResolvedValue({ ok: false, erro: "instancia_desconectada", mensagem: "A Z-API não vê o número conectado." });
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Conferir tudo agora"));
    await andar(1000);
    expect(servidor.conferirConexao).toHaveBeenCalled();
    expect(servidor.revalidarChaveIA).toHaveBeenCalledWith({ finalidade: "resposta" });
    expect(screen.getByRole("heading", { name: "A conferência parou no WhatsApp" })).toBeInTheDocument();
    // a frase do servidor (que manda ao painel do provedor) dá lugar ao botão do cartão
    expect(screen.getAllByText(/Leia o QR code em "Mostrar o QR code"/).length).toBeGreaterThan(0);
  });

  it("salvar o ritmo chama salvarRitmo; sem acesso, o texto certo", async () => {
    const servidor = servidorFalso();
    montar({}, servidor);
    await carregar();
    const r = cartao("ritmo");
    fireEvent.click(botao("Esperar 1 segundo a mais", r));
    fireEvent.click(botao("Salvar o ritmo", r));
    await andar(200);
    expect(servidor.salvarRitmo).toHaveBeenCalledWith({ espera: 9, teto: 60 });
    expect(screen.getAllByText("Ritmo salvo. A Janete espera 9 s depois da última mensagem, até 60 s.").length).toBeGreaterThan(0);

    servidor.salvarRitmo.mockResolvedValueOnce({ ok: false, erro: "sem_acesso" });
    fireEvent.click(botao("Esperar 1 segundo a mais", r));
    fireEvent.click(botao("Salvar o ritmo", r));
    await andar(200);
    expect(screen.getAllByText("Só quem administra a conta muda o ritmo.").length).toBeGreaterThan(0);
  });

  it("a recusa sem_acesso de uma ação relê o Eu (spec 2.2); a que dá certo, não", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso({ desconectarConexao: vi.fn(async () => ({ ok: false, erro: "sem_acesso" })) });
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    const r = await acoes.desconectar();
    expect(r).toMatchObject({ ok: false, erro: "sem_acesso" });
    expect(espia).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
    espia.mockClear();
    expect((await acoes.conferirConexao()).ok).toBe(true);
    expect(espia).not.toHaveBeenCalledWith({ queryKey: CHAVES.eu });
    // a recusa de outro motivo também não relê o Eu
    servidor.salvarRitmo.mockResolvedValueOnce({ ok: false, erro: "ritmo_invalido" });
    await acoes.salvarRitmo(9, 60);
    expect(espia).not.toHaveBeenCalledWith({ queryKey: CHAVES.eu });
  });

  it("chave sem crédito: 'Testar a chave de novo' chama revalidarChaveIA (conferência grátis)", async () => {
    const servidor = servidorFalso();
    servidor.revalidarChaveIA.mockResolvedValueOnce({ ok: false, erro: "sem_credito", mensagem: "sem saldo", status: "sem_credito" });
    montar({ chaves: [{ ...CHAVE_RESPOSTA, status: "sem_credito", ultimo_erro: "http_402" }] }, servidor);
    await carregar();
    const c = cartao("cerebro");
    // o código guardado vira frase
    expect(within(c).getByRole("alert")).toHaveTextContent("Resposta da Anthropic: o saldo de créditos da conta acabou.");
    expect(c.textContent).not.toMatch(/http_402/);
    fireEvent.click(botao("Testar a chave de novo", c));
    await andar(400);
    expect(servidor.revalidarChaveIA).toHaveBeenCalledWith({ finalidade: "resposta" });
    expect(within(cartao("cerebro")).getByRole("alert")).toHaveTextContent("o saldo ainda não aparece");
  });

  it("Trocar a chave grava com salvarChaveIA, mantendo o modelo; o final vem do servidor", async () => {
    const servidor = servidorFalso();
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Trocar a chave", cartao("cerebro")));
    const f = fluxo()!;
    fireEvent.change(within(f).getByLabelText("Chave da Anthropic"), { target: { value: "sk-ant-nova-ABCD9" } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    expect(servidor.salvarChaveIA).toHaveBeenCalledWith({
      finalidade: "resposta",
      provedor: "anthropic",
      modelo: "claude-haiku-5-5",
      chave: "sk-ant-nova-ABCD9",
    });
    expect(within(f).getByRole("heading", { name: "A Janete já usa a chave nova." })).toBeInTheDocument();
    expect(within(f).getByText("chave terminada em ABCD")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sk-ant-nova/);
  });

  it("a chave recusada por falta de crédito mostra o texto do servidor, e a antiga continua", async () => {
    const servidor = servidorFalso();
    servidor.salvarChaveIA.mockResolvedValueOnce({ ok: false, erro: "sem_credito", mensagem: "A conta da Anthropic está sem crédito." });
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Trocar a chave", cartao("cerebro")));
    const f = fluxo()!;
    fireEvent.change(within(f).getByLabelText("Chave da Anthropic"), { target: { value: "sk-ant-nova-ABCD9" } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    const erro = within(f).getByRole("alert");
    expect(erro).toHaveTextContent("A chave está sem crédito.");
    expect(erro).toHaveTextContent("A conta da Anthropic está sem crédito.");
    expect(erro).toHaveTextContent("A chave terminada em TSTE continua valendo.");
  });

  it("Trocar o modelo lista pela chave guardada e troca sem colar a chave (trocarModeloIA)", async () => {
    const servidor = servidorFalso({
      listarModelosDaChave: vi.fn(async () => ({
        ok: true,
        origem: "provedor",
        modelos: [
          { id: "claude-haiku-5-5", nome: "Claude Haiku 5.5", perfil: "Rápido e barato", recomendado: true },
          { id: "claude-novo-6", nome: "Claude Novo 6", recomendado: false },
        ],
      })),
      trocarModeloIA: vi.fn(async () => ({ ok: true, modelo: "claude-novo-6", status: "ativa" })),
    });
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Trocar o modelo", cartao("cerebro")));
    const f = fluxo()!;
    await andar(300);
    expect(servidor.listarModelosDaChave).toHaveBeenCalledWith({ finalidade: "resposta" });
    const radios = within(f).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([expect.stringContaining("Claude Haiku 5.5"), expect.stringContaining("Claude Novo 6")]);
    fireEvent.click(radios[1]!);
    fireEvent.click(botao("Salvar o modelo", f));
    await andar(200);
    expect(servidor.trocarModeloIA).toHaveBeenCalledWith({ finalidade: "resposta", modelo: "claude-novo-6" });
    expect(screen.getAllByText("A Janete passou a responder com o Claude Novo 6.").length).toBeGreaterThan(0);
  });

  it("Trocar de provedor: a chave nova é conferida pela lista do provedor, e só grava ao escolher o modelo", async () => {
    const servidor = servidorFalso({
      listarModelos: vi.fn(async () => ({
        ok: true,
        origem: "provedor",
        modelos: [
          { id: "gpt-5.5-mini", nome: "GPT-5.5 mini", recomendado: true, precoEntrada: 0.25, precoSaida: 2 },
          { id: "gpt-5.5", nome: "GPT-5.5", recomendado: false },
        ],
      })),
      salvarChaveIA: vi.fn(async () => ({ ok: true, ultimos4: "QWER", status: "ativa" })),
    });
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Trocar de provedor", cartao("cerebro")));
    const f = fluxo()!;
    fireEvent.click(within(f).getByRole("button", { name: /^OpenAI/ }));
    fireEvent.change(within(f).getByLabelText("Chave da OpenAI"), { target: { value: "sk-proj-nova-QWER" } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    expect(servidor.listarModelos).toHaveBeenCalledWith({ provedor: "openai", chave: "sk-proj-nova-QWER" });
    expect(servidor.salvarChaveIA).not.toHaveBeenCalled();
    fireEvent.click(botao("Escolher o modelo", f));
    await andar(1500);
    const radios = within(f).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([expect.stringContaining("GPT-5.5 mini"), expect.stringContaining("GPT-5.5")]);
    expect(radios[0]!.textContent).toContain("US$ 0,25 / 2");
    fireEvent.click(radios[1]!);
    fireEvent.click(botao("Usar este cérebro", f));
    await andar(300);
    expect(servidor.salvarChaveIA).toHaveBeenCalledWith({
      finalidade: "resposta",
      provedor: "openai",
      modelo: "gpt-5.5",
      chave: "sk-proj-nova-QWER",
    });
    expect(screen.getAllByText("A Janete passou a responder com o GPT-5.5.").length).toBeGreaterThan(0);
  });

  it("conectar a Meta: salvarConexao, e no fim o endereço, o verify token e o aviso de prévia", async () => {
    const servidor = servidorFalso({
      salvarConexao: vi.fn(async () => ({
        ok: true,
        conexao_id: "cx-2",
        nome: "(11) 95555-0000",
        gateway: "meta",
        url_webhook: "https://preview--janete.descontinuado.app/api/public/whatsapp/meta/cx-2",
        verifyToken: "vt-gerado-xyz",
        avisos: ["url_de_previa"],
      })),
    });
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Trocar de WhatsApp", cartao("whats")));
    const f = fluxo()!;
    fireEvent.click(within(f).getByRole("button", { name: /^Oficial/ }));
    fireEvent.click(within(f).getByRole("button", { name: /^API oficial da Meta/ }));
    fireEvent.change(within(f).getByLabelText("Phone Number ID"), { target: { value: "123" } });
    fireEvent.change(within(f).getByLabelText("ID da conta do WhatsApp Business"), { target: { value: "456" } });
    fireEvent.change(within(f).getByLabelText("Token de acesso permanente"), { target: { value: "EAAG-token" } });
    fireEvent.change(within(f).getByLabelText("App Secret"), { target: { value: "segredo-app" } });
    fireEvent.click(botao("Conectar", f));
    await andar(1500);
    expect(servidor.salvarConexao).toHaveBeenCalledWith({
      gateway: "meta",
      campos: { phoneId: "123", wabaId: "456", token: "EAAG-token", appSecret: "segredo-app" },
    });
    expect(within(f).getByRole("heading", { name: "Tudo certo, WhatsApp conectado." })).toBeInTheDocument();
    expect(within(f).getByText("Número (11) 95555-0000")).toBeInTheDocument();
    const fim = within(f).getByTestId("cfg-ok-conexao");
    expect(fim).toHaveTextContent("https://preview--janete.descontinuado.app/api/public/whatsapp/meta/cx-2");
    expect(fim).toHaveTextContent("vt-gerado-xyz");
    expect(fim).toHaveTextContent("Você conectou pela prévia. Depois de publicar o site, salve esta conexão de novo");
    expect(within(fim).getAllByRole("button", { name: /^Copiar/ })).toHaveLength(2);
  });

  it("a Meta com o token vencido: 'Colar o token novo' conserta só o campo (consertarCampoConexao)", async () => {
    const servidor = servidorFalso();
    montar({ conexao: { ...CONEXAO, gateway: "meta", oficial: true, status: "desconectada", ultimo_erro: "credencial_invalida" } }, servidor);
    await carregar();
    expect(within(cartao("whats")).getByRole("alert")).toHaveTextContent("A Meta parou de aceitar o token guardado.");
    fireEvent.click(botao("Colar o token novo", cartao("whats")));
    const f = fluxo()!;
    fireEvent.change(within(f).getByLabelText("Token de acesso permanente"), { target: { value: "EAAG-novo" } });
    fireEvent.click(botao("Conectar", f));
    await andar(1500);
    expect(servidor.consertarCampoConexao).toHaveBeenCalledWith({ campo: "token", valor: "EAAG-novo" });
    expect(servidor.salvarConexao).not.toHaveBeenCalled();
  });

  it("o verify token da conexão guardada vem do servidor só quando o admin pede para ver", async () => {
    const servidor = servidorFalso();
    montar({ conexao: { ...CONEXAO, gateway: "meta", oficial: true } }, servidor);
    await carregar();
    const w = cartao("whats");
    fireEvent.click(botao("Ver o endereço do webhook", w));
    expect(servidor.verSegredoGerado).not.toHaveBeenCalled();
    fireEvent.click(botao("Mostrar verify token", w));
    await carregar();
    expect(servidor.verSegredoGerado).toHaveBeenCalledWith({ conexao_id: "cx-1", nome: "verifyToken" });
    expect(within(w).getByText("verify-guardado-123")).toBeInTheDocument();
  });

  it("Copiar o verify token: a cópia sai ainda dentro do clique (Safari) e só depois diz 'Copiado'", async () => {
    const itens: Record<string, Promise<Blob>>[] = [];
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(i: Record<string, Promise<Blob>>) {
          itens.push(i);
        }
      },
    );
    let confirmar: () => void = () => {};
    const escreverItem = vi.fn(() => new Promise<void>((ok) => (confirmar = ok)));
    const escreverTexto = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { write: escreverItem, writeText: escreverTexto }, configurable: true });
    try {
      const servidor = servidorFalso();
      montar({ conexao: { ...CONEXAO, gateway: "meta", oficial: true } }, servidor);
      await carregar();
      const w = cartao("whats");
      fireEvent.click(botao("Ver o endereço do webhook", w));
      fireEvent.click(botao("Copiar verify token", w));
      // no mesmo clique: a cópia já foi pedida, antes de o servidor devolver o token
      expect(escreverItem).toHaveBeenCalledTimes(1);
      expect(servidor.verSegredoGerado).toHaveBeenCalledTimes(1);
      await carregar();
      // o navegador ainda não confirmou: nada de "Copiado"
      expect(within(w).queryByText("Copiado")).not.toBeInTheDocument();
      confirmar();
      await carregar();
      expect(within(w).getByRole("button", { name: "Verify token copiado" })).toBeInTheDocument();
      expect(escreverTexto).not.toHaveBeenCalled();
      expect(itens).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Copiar recusado pelo navegador: nunca diz 'Copiado'; avisa e deixa o verify token à mostra", async () => {
    const escreverTexto = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escreverTexto }, configurable: true });
    const servidor = servidorFalso();
    montar({ conexao: { ...CONEXAO, gateway: "meta", oficial: true } }, servidor);
    await carregar();
    const w = cartao("whats");
    fireEvent.click(botao("Ver o endereço do webhook", w));
    fireEvent.click(botao("Copiar verify token", w));
    await carregar();
    expect(escreverTexto).toHaveBeenCalledWith("verify-guardado-123");
    expect(within(w).queryByText("Copiado")).not.toBeInTheDocument();
    expect(within(w).getByText("verify-guardado-123")).toBeInTheDocument();
    expect(screen.getAllByText("Não deu para copiar; o valor está à mostra.").length).toBeGreaterThan(0);
  });
});

describe("decisão 10a: a escuta de áudio", () => {
  it("o passo da troca da escuta diz o que o servidor faz (confere a chave; nenhum áudio é transcrito)", () => {
    expect(PASSO_ESCUTA_TRANSCREVE).toBe("Conferindo se a chave transcreve áudio");
    const pasta = path.resolve(__dirname, "../features/plataforma/configuracao");
    for (const nome of readdirSync(pasta).filter((n) => /\.(ts|tsx)$/.test(n))) {
      expect(readFileSync(path.join(pasta, nome), "utf-8"), nome).not.toMatch(/Transcrevendo um áudio de teste/);
    }
  });

  it("sem chave só de áudio, com o cérebro da OpenAI: 'Ativa, usando a chave do cérebro'", async () => {
    montar({ chaves: [{ ...CHAVE_RESPOSTA, provedor: "openai", modelo: "gpt-5.5-mini" }] });
    await carregar();
    const e = cartao("escuta");
    expect(within(e).getByRole("heading", { name: "Ativa, usando a chave do cérebro" })).toBeInTheDocument();
    expect(within(e).getByText("Entende áudios")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Escuta, Áudios em texto: Ativa · chave do cérebro \(OpenAI\)/ })).toBeInTheDocument();
  });

  it("com o cérebro da Anthropic (não transcreve): continua 'Não configurada'", () => {
    const l = lerEscuta({ chaves: [CHAVE_RESPOSTA] }, true);
    expect(l.viaCerebro).toBe(false);
    expect(l.ok).toBe(false);
    const sem = lerEscuta({ chaves: [{ ...CHAVE_RESPOSTA, provedor: "openrouter", status: "sem_credito" }] }, true);
    // a chave do cérebro parada não transcreve
    expect(sem.ok).toBe(false);
  });

  it("remover a chave de áudio pede confirmação e chama removerChaveIA só da transcrição", async () => {
    const servidor = servidorFalso();
    const audio = { ...CHAVE_RESPOSTA, id: "k-2", finalidade: "transcricao", provedor: "groq", modelo: "whisper-large-v3-turbo", ultimos4: "WXYZ" } as ChaveIA;
    montar({ chaves: [CHAVE_RESPOSTA, audio] }, servidor);
    await carregar();
    fireEvent.click(botao("Remover a chave de áudio", cartao("escuta")));
    const dlg = screen.getByRole("alertdialog", { name: "Remover a chave de áudio?" });
    fireEvent.click(botao("Remover", dlg));
    await carregar();
    expect(servidor.removerChaveIA).toHaveBeenCalledWith({ finalidade: "transcricao" });
    expect(screen.getAllByText("Chave de áudio removida. Sem escuta, a Janete pede para o lead escrever.").length).toBeGreaterThan(0);
  });

  it("Voz: conectar a ElevenLabs grava com salvarChaveIA, finalidade voz e modelo vazio", async () => {
    const servidor = servidorFalso();
    montar({}, servidor);
    await carregar();
    const v = cartao("voz");
    expect(within(v).getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
    fireEvent.click(botao("Conectar a ElevenLabs", v));
    const f = fluxo()!;
    const campo = within(f).getByLabelText("Chave da ElevenLabs");
    fireEvent.change(campo, { target: { value: "sk_teste_1234567890abcd" } });
    // o campo não é controlado: a chave fica só no valor do <input>, nunca no atributo value do HTML
    // (quem serializa o DOM, como extensões ou gravação de sessão, não a vê)
    expect(campo.getAttribute("value") ?? "").not.toContain("sk_teste_1234567890abcd");
    expect(document.body.innerHTML).not.toContain("sk_teste_1234567890abcd");
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    expect(servidor.salvarChaveIA).toHaveBeenCalledTimes(1);
    expect(servidor.salvarChaveIA).toHaveBeenCalledWith({
      finalidade: "voz",
      provedor: "elevenlabs",
      modelo: "",
      chave: "sk_teste_1234567890abcd",
    });
    expect(within(f).getByRole("heading", { name: "A voz da Janete está conectada." })).toBeInTheDocument();
    expect(within(f).getByText("chave terminada em ABCD")).toBeInTheDocument();
    // a escuta não tem a mesma chave: o "Chave aceita" pergunta, e nada é copiado sem o "Sim"
    expect(within(f).getByText("Usar esta chave na escuta também?")).toBeInTheDocument();
    expect(botao("Sim, usar na escuta também", f)).toHaveAttribute("id", "val-pri");
    expect(botao("Não, só na voz", f)).toHaveAttribute("id", "val-sec");
    expect(servidor.usarChaveElevenLabs).not.toHaveBeenCalled();
    // no banco não há "Simular" e a chave nunca vai para a tela: nem no texto, nem nos atributos, e o
    // campo (montado e inerte sob o palco do ok) fica vazio
    expect(document.body.textContent).not.toMatch(/sk_teste_1234567890abcd/);
    expect(document.body.innerHTML).not.toContain("sk_teste_1234567890abcd");
    expect((document.getElementById("cfg-f-chave") as HTMLInputElement | null)?.value ?? "").toBe("");
  });

  it("Voz: sem os acessos (sem_permissao), a tela diz quais ligar, antes e depois do 'Corrigir a chave'", async () => {
    const mensagem =
      "A chave existe, mas não tem os acessos que a Janete usa. Na ElevenLabs, edite a chave e ligue User, Text to Speech, Speech to Text e Voices.";
    const servidor = servidorFalso();
    servidor.salvarChaveIA.mockResolvedValueOnce({ ok: false, erro: "sem_permissao", mensagem });
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Conectar a ElevenLabs", cartao("voz")));
    const f = fluxo()!;
    fireEvent.change(within(f).getByLabelText("Chave da ElevenLabs"), { target: { value: "sk_teste_1234567890abcd" } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    expect(servidor.salvarChaveIA).toHaveBeenCalledTimes(1);
    // o palco: chave recusada, com a primeira frase do servidor no título e a lista de acessos no texto
    const alerta = within(f).getByRole("alert");
    expect(within(alerta).getByText("Chave recusada")).toBeInTheDocument();
    expect(within(alerta).getByRole("heading", { name: "A chave existe, mas não tem os acessos que a Janete usa." })).toBeInTheDocument();
    expect(alerta.textContent).toContain("ligue User, Text to Speech, Speech to Text e Voices");
    expect(alerta.textContent).not.toMatch(/agora\./);
    // corrigir: o campo diz o que ligar, no lugar do "Copie de novo, inteira"
    fireEvent.click(botao("Corrigir a chave", f));
    await andar(1500);
    expect(f.textContent).not.toContain("Copie de novo, inteira");
    expect(f.textContent).toContain("A chave existe, mas não tem os acessos que a Janete usa.");
    const campo = within(f).getByLabelText("Chave da ElevenLabs");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    const erroId = campo.getAttribute("aria-describedby")!;
    expect(document.getElementById(erroId)!.textContent).toContain("Na ElevenLabs, edite a chave e ligue User, Text to Speech, Speech to Text e Voices.");
    // a chave continua no campo, para validar de novo depois de ligar os acessos
    expect((campo as HTMLInputElement).value).toBe("sk_teste_1234567890abcd");
    expect(document.body.innerHTML).not.toContain("sk_teste_1234567890abcd");
  });

  it("Voz: sem crédito (sem_credito) mostra a frase do servidor, e o campo não pede para copiar de novo", async () => {
    const mensagem = "A conta da ElevenLabs está sem créditos. Recarregue a conta ou cole a chave de outra conta.";
    const servidor = servidorFalso();
    servidor.salvarChaveIA.mockResolvedValueOnce({ ok: false, erro: "sem_credito", mensagem });
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Conectar a ElevenLabs", cartao("voz")));
    const f = fluxo()!;
    fireEvent.change(within(f).getByLabelText("Chave da ElevenLabs"), { target: { value: "sk_teste_1234567890abcd" } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(1500);
    const alerta = within(f).getByRole("alert");
    expect(within(alerta).getByText("Chave recusada")).toBeInTheDocument();
    expect(within(alerta).getByRole("heading", { name: "A conta da ElevenLabs está sem créditos." })).toBeInTheDocument();
    fireEvent.click(botao("Corrigir a chave", f));
    await andar(1500);
    expect(f.textContent).not.toContain("Copie de novo, inteira");
    const campo = within(f).getByLabelText("Chave da ElevenLabs");
    expect(document.getElementById(campo.getAttribute("aria-describedby")!)!.textContent).toContain(
      "Recarregue a conta ou cole a chave de outra conta.",
    );
  });

  it("Voz: a linha voz ativa vira 'Conectada' com a voz lida do banco, e remover chama removerChaveIA da voz", async () => {
    const servidor = servidorFalso();
    montar({ chaves: [CHAVE_RESPOSTA, CHAVE_VOZ], config: { ...CONFIG, voz_resposta: "sempre", voz_id: "voz-a", voz_nome: "Ana", voz_erro: null } }, servidor);
    await carregar();
    const v = cartao("voz");
    expect(within(v).getByRole("heading", { name: "Conectada, com a ElevenLabs" })).toBeInTheDocument();
    expect(within(v).getByText("Chave ativa").closest("p")).toHaveAttribute("data-tom", "ok");
    expect(v.textContent).toContain("terminada em VOZ1");
    expect(within(v).getByText("Ana")).toBeInTheDocument();
    expect(within(v).getByRole("radio", { name: "Sempre" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(botao("Remover a chave de voz", v));
    const dlg = screen.getByRole("alertdialog", { name: "Remover a chave de voz?" });
    fireEvent.click(botao("Remover", dlg));
    await carregar();
    expect(servidor.removerChaveIA).toHaveBeenCalledTimes(1);
    expect(servidor.removerChaveIA).toHaveBeenCalledWith({ finalidade: "voz" });
    // era a voz quem transcrevia (cérebro da Anthropic, sem chave de áudio)
    expect(screen.getAllByText("Chave de voz removida. Sem escuta, a Janete pede para o lead escrever.").length).toBeGreaterThan(0);
  });

  it("Saúde: 5 nós, e o 'Conferir tudo' chama revalidarChaveIA({finalidade:'voz'}) quando há chave (o nó lê o `voz`)", async () => {
    const servidor = servidorFalso({
      revalidarChaveIA: vi.fn(async ({ finalidade }: { finalidade: string }) =>
        finalidade === "voz"
          ? { ok: true, status: "ativa", provedor: "elevenlabs", modelo: "", voz: "nao_encontrada" }
          : { ok: true, status: "ativa", provedor: "anthropic", modelo: "claude-haiku-5-5" },
      ),
    });
    montar({ chaves: [CHAVE_RESPOSTA, CHAVE_VOZ], config: { ...CONFIG, voz_id: "voz-a", voz_nome: "Ana" } }, servidor);
    await carregar();
    const saude = screen.getByTestId("cfg-saude");
    // o 5º nó existe (a regex antiga contava só 4 verbos e deixava passar o fio sem a voz)
    expect(within(within(saude).getByRole("list")).getAllByRole("button").map((b) => b.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "Recebe",
      "Escuta",
      "Espera",
      "Responde",
      "Fala",
    ]);
    expect(within(saude).getByRole("button", { name: "Fala, Voz da Janete: Ativa · Ana. Ver os detalhes." })).toBeInTheDocument();
    fireEvent.click(botao("Conferir tudo agora"));
    await andar(1500);
    expect(servidor.revalidarChaveIA).toHaveBeenCalledWith({ finalidade: "voz" });
    // a escuta via voz reaproveita a mesma conferência: uma chamada só da voz
    expect(servidor.revalidarChaveIA.mock.calls.filter(([d]) => (d as { finalidade: string }).finalidade === "voz")).toHaveLength(1);
    expect(servidor.revalidarChaveIA.mock.calls.some(([d]) => (d as { finalidade: string }).finalidade === "transcricao")).toBe(false);
    // a voz que sumiu da conta é atenção, nunca para a conferência
    expect(screen.getByRole("heading", { name: "Tudo certo nas cinco peças" })).toBeInTheDocument();
    const no = within(saude).getByRole("button", { name: /^Fala, Voz da Janete: Sem fala: a resposta iria em texto/ });
    expect(no.querySelector("[data-estado]")).toHaveAttribute("data-estado", "atencao");
    // a escuta via voz fica ok: a chave respondeu, mesmo com a voz escolhida fora da conta
    expect(within(saude).getByRole("button", { name: /^Escuta, Áudios em texto: / }).querySelector("[data-estado]")).toHaveAttribute("data-estado", "ok");
  });

  it("Saúde: sem a chave da voz, o 'Conferir tudo' não chama a voz e o 5º nó fica neutro", async () => {
    const servidor = servidorFalso();
    montar({}, servidor);
    await carregar();
    fireEvent.click(botao("Conferir tudo agora"));
    await andar(1500);
    expect(servidor.revalidarChaveIA).not.toHaveBeenCalledWith({ finalidade: "voz" });
    expect(screen.getByRole("heading", { name: "Tudo certo nas cinco peças" })).toBeInTheDocument();
    // neutro: o nó sem data-estado (nem ok, nem atenção, nem erro)
    const no = screen.getByRole("button", { name: /^Fala, Voz da Janete: Não configurada/ });
    expect(no.querySelector("[data-estado]")).toBeNull();
  });

  it("Voz: trocar o modo chama salvarModoVoz uma vez, e 'Escolher a voz' lista e salva com escolherVoz", async () => {
    const servidor = servidorFalso();
    montar({ chaves: [CHAVE_RESPOSTA, CHAVE_VOZ] }, servidor);
    await carregar();
    const v = cartao("voz");
    expect(within(v).getByText("Escolha a voz da Janete. Sem voz, ela responde em texto.")).toBeInTheDocument();
    fireEvent.click(within(v).getByRole("radio", { name: "Sempre" }));
    await carregar();
    expect(servidor.salvarModoVoz).toHaveBeenCalledTimes(1);
    expect(servidor.salvarModoVoz).toHaveBeenCalledWith({ modo: "sempre" });
    expect(screen.getAllByText("Modo salvo.").length).toBeGreaterThan(0);
    // o modo gravado vale na tela até a releitura (o dublê do banco continua com o padrão)
    expect(within(v).getByRole("radio", { name: "Sempre" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(botao("Escolher a voz", v));
    const f = fluxo()!;
    expect(f).toHaveAttribute("data-fluxo", "vozes");
    await carregar();
    expect(servidor.listarVozes).toHaveBeenCalledTimes(1);
    fireEvent.click(within(f).getByRole("radio", { name: /Bruna/ }));
    // marcar não grava: só o "Salvar a voz"
    expect(servidor.escolherVoz).not.toHaveBeenCalled();
    fireEvent.click(botao("Salvar a voz", f));
    await andar(200);
    expect(servidor.escolherVoz).toHaveBeenCalledTimes(1);
    expect(servidor.escolherVoz).toHaveBeenCalledWith({ vozId: "voz-b" });
    expect(fluxo()).toBeNull();
    expect(screen.getAllByText("Voz salva.").length).toBeGreaterThan(0);
  });

  it("Voz: a recusa do escolherVoz fica no fluxo, com a frase do servidor", async () => {
    const servidor = servidorFalso({
      escolherVoz: vi.fn(async () => ({ ok: false, erro: "voz_nao_encontrada", mensagem: "A voz escolhida não existe mais na conta. Escolha outra voz." })),
    });
    montar({ chaves: [CHAVE_RESPOSTA, CHAVE_VOZ] }, servidor);
    await carregar();
    fireEvent.click(botao("Escolher a voz", cartao("voz")));
    await carregar();
    const f = fluxo()!;
    fireEvent.click(within(f).getByRole("radio", { name: /Ana/ }));
    fireEvent.click(botao("Salvar a voz", f));
    await andar(200);
    expect(fluxo()).not.toBeNull();
    expect(screen.getAllByText("A voz escolhida não existe mais na conta. Escolha outra voz.").length).toBeGreaterThan(0);
  });

  it("Escuta: sem chave de áudio e sem cérebro que transcreve, a chave da voz transcreve", async () => {
    montar({ chaves: [CHAVE_RESPOSTA, CHAVE_VOZ] });
    await carregar();
    const e = cartao("escuta");
    expect(within(e).getByRole("heading", { name: "Ativa, usando a chave da voz" })).toBeInTheDocument();
    expect(within(e).getByText("ElevenLabs, com a chave da voz")).toBeInTheDocument();
    expect(botao("Usar uma chave só para áudio", e)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Escuta, Áudios em texto: Ativa · chave da voz \(ElevenLabs\)/ })).toBeInTheDocument();
  });

  it("Voz: a voz que sumiu da conta (voz_erro) mostra o aviso e 'Escolher a voz' em destaque", async () => {
    montar({ chaves: [CHAVE_RESPOSTA, CHAVE_VOZ], config: { ...CONFIG, voz_id: "voz-x", voz_nome: "Rachel", voz_erro: "voz_nao_encontrada" } });
    await carregar();
    const v = cartao("voz");
    expect(within(v).getByText("A voz escolhida não existe mais na conta. Escolha outra; até lá, a Janete responde em texto.")).toBeInTheDocument();
    expect(within(v).getByText("Voz não encontrada").closest("p")).toHaveAttribute("data-tom", "atencao");
    expect(within(v).getByText("Rachel")).toBeInTheDocument();
  });

  it("Voz: a chave sem crédito mostra 'Com a ElevenLabs' e a situação, em atenção", async () => {
    const voz = { ...CHAVE_RESPOSTA, id: "k-3", finalidade: "voz", provedor: "elevenlabs", modelo: "", status: "sem_credito", ultimos4: "VOZ1" } as ChaveIA;
    montar({ chaves: [CHAVE_RESPOSTA, voz] });
    await carregar();
    const v = cartao("voz");
    expect(within(v).getByRole("heading", { name: "Com a ElevenLabs" })).toBeInTheDocument();
    const estado = within(v).getByText("Sem crédito").closest("p")!;
    expect(estado).toHaveAttribute("data-tom", "atencao");
  });
});

describe("o modo exemplo (testes) continua igual nas decisões novas", () => {
  it("cérebro da OpenAI no exemplo: a escuta usa a chave do cérebro", () => {
    const base = criarEstadoInicial(AGORA);
    const chaves = base.chaves.map((k) => (k.finalidade === "resposta" ? { ...k, provedor: "openai" as const } : k));
    expect(lerEscuta({ chaves }, true).viaCerebro).toBe(true);
  });
});

describe("os códigos viram texto", () => {
  it("ultimo_erro da conexão: cada código conhecido tem frase, o desconhecido cai no padrão", () => {
    const codigos = ["credencial_invalida", "instancia_desconectada", "nao_encontrado", "servidor_inacessivel", "tempo_esgotado", "nao_suportado"];
    for (const cod of codigos) {
      const t = textoErroConexao(cod, "zapi", "erro");
      expect(t).not.toContain(cod);
      expect(t.length).toBeGreaterThan(20);
    }
    expect(textoErroConexao("ACCOUNT_UPDATE", "meta", "desconectada")).toMatch(/Cole o token novo/);
    expect(textoErroConexao("codigo 401", "evolution", "desconectada")).not.toContain("codigo");
    // a frase pronta (o exemplo grava assim) passa como está
    expect(textoErroConexao("O número saiu do WhatsApp no celular.", "zapi", "desconectada")).toBe("O número saiu do WhatsApp no celular.");
  });

  it("ultimo_erro da chave e o erro das ações: nunca o código cru", () => {
    for (const cod of ["chave_invalida", "http_401", "http_402_em_voo", "http_403", "http_403_moderacao", "tempo", "rede", "http_503"]) {
      expect(textoErroChave(cod, "ativa")).not.toMatch(/http|_/);
    }
    for (const cod of ["sem_acesso", "sem_conexao", "conexao_invalida", "erro_ao_gravar", "fora_do_limite", "sem_chave", "nao_permitido", "falha", "xyz"]) {
      const t = textoFalhaAcao(cod);
      expect(t).not.toContain(cod === "falha" || cod === "xyz" ? "§" : cod);
      expect(t.length).toBeGreaterThan(10);
    }
    expect(textoFalhaAcao("sem_acesso")).toBe("Só quem administra a conta faz isso.");
    expect(textoFalhaAcao("chave_invalida", "A Anthropic recusou.")).toBe("A Anthropic recusou.");
  });
});
