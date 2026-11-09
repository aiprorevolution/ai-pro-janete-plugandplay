import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  createBucket: vi.fn(),
  getBucket: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/integrations/firebase/client.server", () => ({
  firebaseAdmin: {
    storage: {
      createBucket: s.createBucket,
      getBucket: s.getBucket,
      from: () => ({ upload: s.upload, createSignedUrl: s.createSignedUrl, download: s.download }),
    },
  },
}));

const midia = await import("./midia.server");

const CONVERSA = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  for (const f of Object.values(s)) f.mockReset();
  midia.esquecerBucket();
  s.createBucket.mockResolvedValue({ data: { name: "midias" }, error: null });
  s.getBucket.mockResolvedValue({ data: { id: "midias", public: false }, error: null });
  s.upload.mockResolvedValue({ data: {}, error: null });
});

describe("midia.server", () => {
  it("cria o bucket privado e guarda no cache", async () => {
    await midia.garantirBucket();
    await midia.garantirBucket();
    expect(s.createBucket).toHaveBeenCalledTimes(1);
    expect(s.createBucket).toHaveBeenCalledWith("midias", { public: false });
  });

  it("'já existe' conta como sucesso", async () => {
    s.createBucket.mockResolvedValue({
      data: null,
      error: { status: 409, message: "The resource already exists" },
    });
    await expect(midia.garantirBucket()).resolves.toBeUndefined();
  });

  it("bucket público para com erro e não fica no cache", async () => {
    s.getBucket.mockResolvedValue({ data: { id: "midias", public: true }, error: null });
    await expect(midia.garantirBucket()).rejects.toThrow("bucket_publico");
    await expect(
      midia.enviarArquivo(`${CONVERSA}/${MSG}`, new Uint8Array([1]), "image/png"),
    ).rejects.toThrow("bucket_publico");
    expect(s.upload).not.toHaveBeenCalled();
    expect(s.createBucket).toHaveBeenCalledTimes(2);
  });

  it("outro erro ao criar: bucket_indisponivel", async () => {
    s.createBucket.mockResolvedValue({ data: null, error: { status: 500, message: "x" } });
    await expect(midia.garantirBucket()).rejects.toThrow("bucket_indisponivel");
  });

  it("enviarArquivo grava no caminho certo com o contentType", async () => {
    const bytes = new Uint8Array([1, 2]);
    await midia.enviarArquivo(`${CONVERSA}/${MSG}`, bytes, "audio/ogg");
    expect(s.upload).toHaveBeenCalledWith(`${CONVERSA}/${MSG}`, bytes, {
      contentType: "audio/ogg",
      upsert: true,
    });
  });

  it("caminho fora do formato é recusado", async () => {
    await expect(midia.enviarArquivo("x/y.png", new Uint8Array(), "image/png")).rejects.toThrow(
      "caminho_invalido",
    );
    expect(() => midia.caminhoMidia(CONVERSA, "nao-uuid")).toThrow("caminho_invalido");
    expect(midia.caminhoMidia(CONVERSA, MSG)).toBe(`${CONVERSA}/${MSG}`);
  });

  it("urlAssinada e baixarArquivo", async () => {
    s.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://u" }, error: null });
    await expect(midia.urlAssinada(`${CONVERSA}/${MSG}`, 3600)).resolves.toBe("https://u");
    expect(s.createSignedUrl).toHaveBeenCalledWith(`${CONVERSA}/${MSG}`, 3600);
    s.download.mockResolvedValue({
      // o Blob do jsdom não tem arrayBuffer(); o do servidor tem
      data: { type: "image/png", arrayBuffer: async () => new Uint8Array([7, 8]).buffer },
      error: null,
    });
    const r = await midia.baixarArquivo(`${CONVERSA}/${MSG}`);
    expect(Array.from(r.bytes)).toEqual([7, 8]);
    expect(r.mime).toBe("image/png");
  });
});
