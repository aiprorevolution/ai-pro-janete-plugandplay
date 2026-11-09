// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ token: vi.fn(), config: vi.fn() }));
vi.mock("@/integrations/firebase/identity.server", () => ({ getServerAccessToken: m.token }));
vi.mock("@/integrations/firebase/config.server", () => ({ getInstallationConfig: m.config }));
import { signedStorageUrl, storageAdapter } from "@/integrations/firebase/storage.server";
beforeEach(() => {
  vi.resetAllMocks();
  m.config.mockResolvedValue({ projectId: "test-project", storageBucket: "test-project-janete-private" });
  m.token.mockResolvedValue("adc-fixture");
  vi.stubEnv("JANETE_STORAGE_BUCKET", "test-project-janete-private");
  vi.stubEnv("JANETE_RUNTIME_SERVICE_ACCOUNT", "janete@test-project.iam.gserviceaccount.com");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signedBlob: Buffer.from("signature-fixture").toString("base64") })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("mídia privada Google", () => {
  it("URL temporária é assinada pela identidade, sem chave JSON e sem token OAuth exposto", async () => {
    const signed = await signedStorageUrl("midias", "conversation/message", 86_400);
    const url = new URL(signed);
    expect(url.pathname).toBe("/test-project-janete-private/midias/conversation/message");
    expect(url.searchParams.get("X-Goog-Expires")).toBe("3600");
    expect(url.searchParams.has("X-Goog-Signature")).toBe(true);
    expect(signed).not.toContain("adc-fixture");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("iamcredentials.googleapis.com");
  });
  it("bloqueia path traversal e namespace estranho sem falar com o Google", async () => {
    await expect(signedStorageUrl("midias", "../secret", 60)).rejects.toThrow("caminho_midia_invalido");
    await expect(signedStorageUrl("config", "c/m", 60)).rejects.toThrow("caminho_midia_invalido");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("recusa bucket sem proteção pública comprovada", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ iamConfiguration: {} }));
    expect((await storageAdapter.getBucket("midias")).error?.code).toBe("bucket_privado_nao_confirmado");
  });
  it("upload envia binário ao Storage e não Firestore", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ name: "midias/c/m" }));
    expect((await storageAdapter.from("midias").upload("c/m", new Uint8Array([1,2,3]), { contentType: "image/png" })).error).toBeNull();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("storage.googleapis.com/upload");
    expect(new Headers(init?.headers).get("content-type")).toBe("image/png");
    expect(new Uint8Array(init!.body as ArrayBuffer)).toEqual(new Uint8Array([1,2,3]));
  });
  it("na prévia sem identidade retorna erro, não arquivo ou URL fictício", async () => {
    m.token.mockRejectedValue(new Error("identity missing"));
    const r = await storageAdapter.from("midias").createSignedUrl("c/m", 60);
    expect(r.data).toBeNull(); expect(r.error?.code).toBe("storage_indisponivel");
  });
  it("lista paginada conserva só nomes dentro da conversa", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [{ name: "midias/c/a", id: "a" }], nextPageToken: "page2" }))
      .mockResolvedValueOnce(Response.json({ items: [{ name: "midias/c/b", id: "b" }] }));
    expect((await storageAdapter.from("midias").list("c", { limit: 1, offset: 1 })).data).toEqual([{ name: "b", id: "b" }]);
    expect(vi.mocked(fetch).mock.calls[1]![0]).toContain("pageToken=page2");
  });
});
