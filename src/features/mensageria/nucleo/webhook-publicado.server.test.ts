// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), connection: vi.fn(), adapter: vi.fn(), update: vi.fn(), filter: vi.fn(), install: vi.fn() }));
vi.mock("@/integrations/firebase/config.server", () => ({ getInstallationConfig: m.config }));
vi.mock("./conexoes.server", () => ({ conexaoAtiva: m.connection }));
vi.mock("../gateways", () => ({ adaptadorDe: m.adapter }));
vi.mock("@/integrations/firebase/client.server", () => ({ firebaseAdmin: { from: () => ({ update: m.update }) } }));
import { sincronizarWebhookPublicado } from "./webhook-publicado.server";
const connection = { id: "connection-test", gateway: "evolution", id_externo: "instance-test",
  parametros: { serverUrl: "https://gateway.example.test" }, segredos: { tokenUrl: "token-ficticio" } };
beforeEach(() => {
  vi.resetAllMocks();
  m.config.mockResolvedValue({ publicUrl: "https://janete.example.test" });
  m.connection.mockResolvedValue(structuredClone(connection));
  m.adapter.mockReturnValue({ configurarWebhook: m.install });
  m.update.mockReturnValue({ eq: m.filter });
  m.filter.mockResolvedValue({ error: null });
});
describe("webhook da publicação", () => {
  it("instala a URL HTTPS configurada e guarda só a origem sem o token", async () => {
    await sincronizarWebhookPublicado();
    expect(m.install).toHaveBeenCalledWith(connection,
      "https://janete.example.test/api/public/whatsapp/evolution/connection-test?t=token-ficticio");
    expect(m.update).toHaveBeenCalledWith({ parametros: { serverUrl: "https://gateway.example.test", webhook_public_origin: "https://janete.example.test" } });
    expect(JSON.stringify(m.update.mock.calls)).not.toContain("token-ficticio");
  });
  it("marca persistida evita reconfigurar em cada worker/reinício", async () => {
    m.connection.mockResolvedValue({ ...connection, parametros: { ...connection.parametros, webhook_public_origin: "https://janete.example.test" } });
    await sincronizarWebhookPublicado();
    expect(m.install).not.toHaveBeenCalled();
  });
  it("não confirma configuração recusada pelo gateway", async () => {
    m.install.mockRejectedValue(new Error("offline"));
    await expect(sincronizarWebhookPublicado()).rejects.toThrow("offline");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("sem conexão não chama provedor", async () => {
    m.connection.mockResolvedValue(null);
    await sincronizarWebhookPublicado();
    expect(m.install).not.toHaveBeenCalled();
  });
  it("prévia nunca se instala como webhook", async () => {
    m.config.mockResolvedValue({ publicUrl: "https://ais-dev-abc.us-east1.run.app" });
    await expect(sincronizarWebhookPublicado()).rejects.toThrow("endereco_publicado_invalido");
    expect(m.install).not.toHaveBeenCalled();
  });
});
