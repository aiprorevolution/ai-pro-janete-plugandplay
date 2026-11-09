// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), schedule: vi.fn(), config: vi.fn() }));
vi.mock("@/integrations/firebase/client.server", () => ({ firebaseAdmin: { rpc: m.rpc } }));
vi.mock("@/integrations/firebase/config.server", () => ({ getInstallationConfig: m.config }));
vi.mock("./tasks.server", async actual => ({ ...(await actual<any>()), agendarProcessamento: m.schedule }));
import { acordarMotor, origemDoMotor, pendenciasDoMotor, prepararCopia } from "./motor.server";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("JANETE_PUBLIC_URL", "");
  // Cenário com o instalador: a fila do Cloud Tasks existe. Sem fila, ver toque-proprio.test.ts.
  vi.stubEnv("JANETE_TASKS_LOCATION", "us-west1");
  vi.stubEnv("JANETE_TASKS_SERVICE_ACCOUNT", "janete@example.iam.gserviceaccount.com");
  m.config.mockResolvedValue({ publicUrl: "https://janete.example.test" });
  m.schedule.mockResolvedValue("projects/test/tasks/real");
  m.rpc.mockResolvedValue({ data: "preparada", error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("motor Google", () => {
  it("agenda na configuração publicada e ignora origem forjada", async () => {
    expect(await acordarMotor("https://attacker.example")).toBe("tocado");
    expect(m.schedule).toHaveBeenCalledTimes(1);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("sem publicação informa sem endereço e não enfileira", async () => {
    m.config.mockResolvedValue({});
    expect(await acordarMotor()).toBe("sem_endereco");
    expect(m.schedule).not.toHaveBeenCalled();
  });
  it("uma falha de enfileiramento nunca vira sucesso", async () => {
    m.schedule.mockRejectedValue(new Error("google_403"));
    expect(await acordarMotor()).toBe("falhou");
  });
  it.each(["http://localhost:3000", "https://ais-dev-abc.us-east1.run.app", "https://x.cloudworkstations.dev", "https://user:pass@example.com", "https://example.com/path"])("rejeita origem %s", origin => {
    expect(origemDoMotor(origin)).toBeNull();
  });
  it("retém timestamps futuros e reservas vencidas", async () => {
    m.rpc.mockResolvedValue({ data: [{ proximo_em: "2026-01-01T00:00:00Z", vencido_desde: null, atrasado_desde: "invalid" }], error: null });
    expect(await pendenciasDoMotor()).toEqual({ proximoEm: Date.parse("2026-01-01T00:00:00Z"), vencidoDesde: null, atrasadoDesde: null });
    m.rpc.mockResolvedValue({ data: null, error: { code: "unavailable" } });
    expect(await pendenciasDoMotor()).toBeNull();
  });
  it("preparação só confirma retorno real do banco", async () => {
    expect(await prepararCopia()).toBe("preparada");
    m.rpc.mockResolvedValue({ data: true, error: null });
    expect(await prepararCopia()).toBe("falhou");
  });
});
