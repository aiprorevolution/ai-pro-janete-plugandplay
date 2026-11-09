// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// App publicado pelo AI Studio, sem o instalador: não há fila. O toque é o app chamando a própria rota do worker com a
// chave do motor; quem pediu (o webhook, a tela) não espera a rodada. A rodada pede o toque seguinte enquanto houver
// trabalho perto, no lugar do agendador.
const SEGREDO = "segredo-de-teste-da-instalacao-0123456789abcdef";
const CHAVE = createHmac("sha256", SEGREDO).update("janete-motor-toque-v1").digest("hex");
const m = vi.hoisted(() => ({ config: vi.fn(), segredo: vi.fn(), schedule: vi.fn() }));
vi.mock("@/integrations/firebase/client.server", () => ({ firebaseAdmin: { rpc: vi.fn() } }));
vi.mock("@/integrations/firebase/config.server", () => ({ getInstallationConfig: m.config }));
vi.mock("@/integrations/firebase/identity.server", () => ({ requestIdentity: { exit: (fn: () => unknown) => fn() } }));
vi.mock("./segredo-instalacao.server", () => ({ segredoDaInstalacao: m.segredo }));
vi.mock("./tasks.server", async (actual) => ({ ...(await actual<any>()), agendarProcessamento: m.schedule }));
import {
  acordarMotor, conferirChaveDoToque, deveRenovarToque, reiniciarToque, rodarWorkerSemFila,
} from "./motor.server";

const fetchFalso = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  reiniciarToque();
  vi.stubEnv("JANETE_PUBLIC_URL", "");
  vi.stubEnv("JANETE_TASKS_LOCATION", "");
  vi.stubEnv("JANETE_TASKS_SERVICE_ACCOUNT", "");
  m.config.mockResolvedValue({ publicUrl: "https://janete.example.test" });
  m.segredo.mockResolvedValue(SEGREDO);
  fetchFalso.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchFalso);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function relogio(pendencias: Array<{ proximoEm: number | null; vencidoDesde: number | null } | null>) {
  let t = 1_000_000; const esperas: number[] = [];
  const deps = {
    agora: () => t,
    esperar: async (ms: number) => { esperas.push(ms); t += ms; },
    rodar: vi.fn(async () => {}),
    pendencias: vi.fn(async () => {
      const p = pendencias.length ? pendencias.shift() : { proximoEm: null, vencidoDesde: null };
      if (!p) return null;
      return { proximoEm: p.proximoEm === null ? null : t + p.proximoEm, vencidoDesde: p.vencidoDesde === null ? null : t + p.vencidoDesde, atrasadoDesde: null };
    }),
    marcarVisto: vi.fn(async () => true),
    garantirIndices: vi.fn(async () => true),
  };
  return { deps, esperas };
}

describe("toque sem fila: o app chama a própria rota do worker", () => {
  it("chama o endereço publicado com a chave do motor e não usa o Cloud Tasks", async () => {
    expect(await acordarMotor("https://attacker.example", { naHora: true })).toBe("tocado");
    expect(m.schedule).not.toHaveBeenCalled();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toBe("https://janete.example.test/api/public/cron/mensageria");
    expect(init.method).toBe("POST");
    expect(init.headers["x-janete-motor"]).toBe(CHAVE);
    expect(init.signal).toBeUndefined();
  });
  it("não espera a rodada do worker: responde no teto de 1,5 s", async () => {
    vi.useFakeTimers();
    fetchFalso.mockReturnValue(new Promise(() => {}));
    const toque = acordarMotor(null, { naHora: true });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await toque).toBe("tocado");
  });
  it("worker que recusa ou rede que falha nunca vira sucesso", async () => {
    fetchFalso.mockResolvedValue(new Response("Não autorizado", { status: 401 }));
    expect(await acordarMotor()).toBe("falhou");
    fetchFalso.mockRejectedValue(new Error("offline"));
    expect(await acordarMotor()).toBe("falhou");
  });
  it("sem o segredo da instalação o toque falha, sem chamar nada", async () => {
    m.segredo.mockRejectedValue(new Error("cifra_indisponivel"));
    expect(await acordarMotor()).toBe("falhou");
    expect(fetchFalso).not.toHaveBeenCalled();
  });
  it("sem endereço publicado e sem naHora informa sem endereço", async () => {
    m.config.mockResolvedValue({});
    expect(await acordarMotor()).toBe("sem_endereco");
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("chave do toque", () => {
  it("aceita só a chave desta instalação", async () => {
    expect(await conferirChaveDoToque(CHAVE)).toBe(true);
    expect(await conferirChaveDoToque("0".repeat(64))).toBe(false);
  });
  it("recusa o que não tem o formato sem ir ao banco", async () => {
    for (const ruim of [null, "", "abc", CHAVE.toUpperCase(), `${CHAVE}0`]) expect(await conferirChaveDoToque(ruim)).toBe(false);
    expect(m.segredo).not.toHaveBeenCalled();
  });
  it("sem o segredo da instalação recusa", async () => {
    m.segredo.mockRejectedValue(new Error("cifra_indisponivel"));
    expect(await conferirChaveDoToque(CHAVE)).toBe(false);
  });
});

describe("rodada do worker sem fila", () => {
  it("sem pendência termina sem pedir outro toque", async () => {
    const { deps } = relogio([]);
    const renovar = vi.fn(async () => "tocado" as const);
    expect(await rodarWorkerSemFila(45_000, deps, renovar)).toEqual({ resultado: "tocado", toque: null });
    expect(renovar).not.toHaveBeenCalled();
  });
  it("trabalho que vence depois do teto: espera até o teto e pede o toque seguinte", async () => {
    // laço: vence em 60 s (além do teto, sai); conferência: ainda 60 s; depois da bandeira: 15 s
    const { deps, esperas } = relogio([{ proximoEm: 60_000, vencidoDesde: null }, { proximoEm: 60_000, vencidoDesde: null }, { proximoEm: 15_000, vencidoDesde: null }]);
    const renovar = vi.fn(async () => "tocado" as const);
    expect(await rodarWorkerSemFila(45_000, deps, renovar)).toEqual({ resultado: "tocado", toque: "tocado" });
    expect(esperas).toEqual([45_000]);
    expect(renovar).toHaveBeenCalledTimes(1);
  });
  it("enquanto a rodada está de pé, outro pedido de toque não chama de novo; depois volta a chamar", async () => {
    let durante: string | undefined;
    const { deps } = relogio([]);
    deps.rodar.mockImplementation(async () => { durante = await acordarMotor(null, { naHora: true }); });
    await rodarWorkerSemFila(45_000, deps, vi.fn(async () => "tocado" as const));
    expect(durante).toBe("recente");
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(await acordarMotor(null, { naHora: true })).toBe("tocado");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
  it("a renovação sai mesmo com outra rodada de pé", async () => {
    const { deps } = relogio([]);
    let renovacao: string | undefined;
    deps.rodar.mockImplementation(async () => { renovacao = await acordarMotor(null, { renovar: true }); });
    await rodarWorkerSemFila(45_000, deps, vi.fn(async () => "tocado" as const));
    expect(renovacao).toBe("tocado");
  });
  it("banco fora do ar: falha e não vira corrente sem fim", async () => {
    const { deps } = relogio([null, null, null]);
    const renovar = vi.fn(async () => "tocado" as const);
    expect(await rodarWorkerSemFila(45_000, deps, renovar)).toEqual({ resultado: "falhou", toque: null });
    expect(renovar).not.toHaveBeenCalled();
  });
  it("item vencido que ninguém pega: a espera dobra em vez de consultar o banco a cada segundo", async () => {
    const preso = { proximoEm: null, vencidoDesde: -5_000 };
    const { deps, esperas } = relogio(Array.from({ length: 30 }, () => preso));
    await rodarWorkerSemFila(45_000, deps, vi.fn(async () => "tocado" as const));
    expect(esperas.slice(0, 5)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
    expect(deps.rodar.mock.calls.length).toBeLessThan(10);
  });
});

describe("regra de renovar o toque", () => {
  const agora = 1_000_000;
  it("renova com item nos próximos 10 min ou vencido há menos de 10 min", () => {
    expect(deveRenovarToque({ proximoEm: agora + 30_000, vencidoDesde: null, atrasadoDesde: null }, false, agora)).toBe(true);
    expect(deveRenovarToque({ proximoEm: null, vencidoDesde: agora - 60_000, atrasadoDesde: null }, false, agora)).toBe(true);
  });
  it("item vencido há mais de 10 min, sem trabalho achado, não renova", () => {
    expect(deveRenovarToque({ proximoEm: null, vencidoDesde: agora - 601_000, atrasadoDesde: null }, false, agora)).toBe(false);
    expect(deveRenovarToque({ proximoEm: agora + 601_000, vencidoDesde: null, atrasadoDesde: null }, false, agora)).toBe(false);
  });
  it("sem leitura das pendências, só renova se achou trabalho", () => {
    expect(deveRenovarToque(null, false, agora)).toBe(false);
    expect(deveRenovarToque(null, true, agora)).toBe(true);
  });
});
