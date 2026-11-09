// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), token: vi.fn(), verify: vi.fn() }));
vi.mock("@/integrations/firebase/config.server", () => ({ getInstallationConfig: m.config }));
vi.mock("@/integrations/firebase/identity.server", () => ({ getServerAccessToken: m.token }));
vi.mock("google-auth-library", () => ({ OAuth2Client: class { verifyIdToken = m.verify; } }));
import { agendarProcessamento, configuracaoTarefas } from "./tasks.server";
import { authenticateCronRequest } from "@/integrations/firebase/cron-auth";
const account = "janete@test-project.iam.gserviceaccount.com";
beforeEach(() => {
  vi.resetAllMocks();
  m.config.mockResolvedValue({ projectId: "test-project", publicUrl: "https://janete.example.test" });
  m.token.mockResolvedValue("server-token-fixture");
  vi.stubEnv("JANETE_PUBLIC_URL", "");
  vi.stubEnv("JANETE_TASKS_LOCATION", "us-east1");
  vi.stubEnv("JANETE_TASKS_QUEUE", "janete-mensageria");
  vi.stubEnv("JANETE_TASKS_SERVICE_ACCOUNT", account);
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); return Response.json({ name: body.task.name });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("fila Google e autenticação", () => {
  it("grava HTTP task OIDC com ADC, sem token do usuário", async () => {
    const when = Date.now() + 30_000;
    const result = await agendarProcessamento(when);
    expect(result).toContain("projects/test-project/locations/us-east1/queues/janete-mensageria/tasks/");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("cloudtasks.googleapis.com/v2/");
    const body = JSON.parse(init!.body as string);
    expect(body.task.scheduleTime).toBe(new Date(when).toISOString());
    expect(body.task.httpRequest.oidcToken).toEqual({ serviceAccountEmail: account, audience: "https://janete.example.test" });
    expect(body.task.dispatchDeadline).toBe("120s");
    expect(body.task.httpRequest.headers).not.toHaveProperty("authorization");
  });
  it("duas chegadas criam tarefas distintas, sem perder a segunda", async () => {
    expect(await agendarProcessamento()).not.toBe(await agendarProcessamento());
  });
  it("403 da fila rejeita, nunca retorna tarefa fictícia", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("permission", { status: 403 }));
    await expect(agendarProcessamento()).rejects.toThrow("tarefas_http_403");
  });
  it("recusa service account de outro projeto", async () => {
    vi.stubEnv("JANETE_TASKS_SERVICE_ACCOUNT", "evil@other-project.iam.gserviceaccount.com");
    await expect(configuracaoTarefas()).rejects.toThrow("tarefas_identidade_invalida");
  });
  it("cabeçalhos CloudTasks forjados não autorizam", async () => {
    const denied = await authenticateCronRequest(new Request("https://janete.example.test", { headers: { "x-cloudtasks-queuename": "queue" } }));
    expect(denied?.status).toBe(401); expect(m.verify).not.toHaveBeenCalled();
  });
  it("só aceita OIDC verificado com e-mail da própria identidade", async () => {
    m.verify.mockResolvedValue({ getPayload: () => ({ iss: "https://accounts.google.com", email: account, email_verified: true }) });
    const req = new Request("https://janete.example.test", { headers: { authorization: "Bearer fixture" } });
    expect(await authenticateCronRequest(req)).toBeNull();
    expect(m.verify).toHaveBeenCalledWith({ idToken: "fixture", audience: "https://janete.example.test" });
    m.verify.mockResolvedValue({ getPayload: () => ({ iss: "https://accounts.google.com", email: "other@example.com", email_verified: true }) });
    expect((await authenticateCronRequest(req))?.status).toBe(403);
  });
});
