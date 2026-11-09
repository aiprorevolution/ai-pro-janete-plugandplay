// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), cycle: vi.fn(), seen: vi.fn(), pending: vi.fn(), schedule: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@/integrations/firebase/cron-auth", () => ({ authenticateCronRequest: m.auth }));
vi.mock("./ciclo.server", () => ({ rodarCiclo: m.cycle }));
vi.mock("./banco.server", () => ({ marcarWorkerVisto: m.seen }));
vi.mock("./motor.server", () => ({ pendenciasDoMotor: m.pending }));
vi.mock("./tasks.server", () => ({ agendarProcessamento: m.schedule }));
vi.mock("./webhook-publicado.server", () => ({ sincronizarWebhookPublicado: async () => {} }));
import { executarTarefa } from "@/routes/api/public/cron/mensageria";
const request = () => new Request("https://janete.example.test/api/public/cron/mensageria", { method: "POST" });
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue(null); m.seen.mockResolvedValue(true);
  m.cycle.mockResolvedValue({ envios: { enviados: 0 } });
  m.pending.mockResolvedValue({ proximoEm: null, vencidoDesde: null, atrasadoDesde: null });
  m.schedule.mockResolvedValue("task");
});
describe("worker durável", () => {
  it("nega antes de ler banco e executar o motor", async () => {
    m.auth.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    expect((await executarTarefa(request())).status).toBe(401);
    expect(m.cycle).not.toHaveBeenCalled();
  });
  it("sem pendências conclui sem laço ocioso nem nova tarefa", async () => {
    expect((await executarTarefa(request())).status).toBe(200);
    expect(m.cycle).toHaveBeenCalledWith({ orcamentoMs: 45_000 });
    expect(m.schedule).not.toHaveBeenCalled();
  });
  it("agenda a continuação para a data realmente persistida", async () => {
    const when = Date.now() + 60_000;
    m.pending.mockResolvedValue({ proximoEm: when, vencidoDesde: null });
    expect((await executarTarefa(request())).status).toBe(200);
    expect(m.schedule).toHaveBeenCalledWith(when);
  });
  it("fila indisponível responde 503 para Cloud Tasks repetir", async () => {
    m.pending.mockResolvedValue({ proximoEm: Date.now(), vencidoDesde: null });
    m.schedule.mockRejectedValue(new Error("offline"));
    expect((await executarTarefa(request())).status).toBe(503);
  });
  it("falha ao ler pendências nunca confirma a tarefa", async () => {
    m.pending.mockResolvedValue(null);
    expect((await executarTarefa(request())).status).toBe(503);
  });
  it("erro antes da rodada não envia nem confirma", async () => {
    m.seen.mockResolvedValue(false);
    expect((await executarTarefa(request())).status).toBe(503);
    expect(m.cycle).not.toHaveBeenCalled();
  });
});
