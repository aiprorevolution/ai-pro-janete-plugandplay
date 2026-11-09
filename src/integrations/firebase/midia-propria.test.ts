// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// App publicado pelo AI Studio, sem o instalador: o nome de bucket da configuração não existe, e o serviço não tem a
// permissão de assinatura do Google. O app cria o próprio bucket privado (com validade dos arquivos) e serve a mídia
// ele mesmo, com link temporário assinado pela chave da instalação.
const SEGREDO = "segredo-de-teste-da-instalacao-0123456789abcdef";
const CHAVE = createHmac("sha256", SEGREDO).update("janete-midia-link-v1").digest("hex");
const CAMINHO = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const m = vi.hoisted(() => ({ token: vi.fn(), config: vi.fn(), origem: vi.fn(), segredo: vi.fn() }));
vi.mock("./identity.server", () => ({ getServerAccessToken: m.token, requestIdentity: { exit: (fn: () => unknown) => fn() } }));
vi.mock("./config.server", () => ({ getInstallationConfig: m.config, enderecoPublicoDoAmbiente: m.origem }));
vi.mock("@/features/mensageria/nucleo/segredo-instalacao.server", () => ({ segredoDaInstalacao: m.segredo }));
import { esquecerChavesDerivadas } from "@/features/mensageria/nucleo/chave-derivada.server";
import { DIAS_VALIDADE_MIDIA, servirMidiaPublica, signedStorageUrl, storageAdapter } from "./storage.server";

const fetchFalso = vi.fn();
const bucketOk = { projectNumber: "233507220804", iamConfiguration: { publicAccessPrevention: "enforced", uniformBucketLevelAccess: { enabled: true } } };
const assinar = (caminho: string, e: number) => createHmac("sha256", CHAVE).update(`${caminho}\n${e}`).digest("hex");
const agora = () => Math.floor(Date.now() / 1000);
beforeEach(() => {
  vi.resetAllMocks();
  esquecerChavesDerivadas();
  m.config.mockResolvedValue({ projectId: "demo-janete", appId: "1:233507220804:web:abc", storageBucket: "demo-janete.firebasestorage.app" });
  m.origem.mockReturnValue("https://janete-233507220804.us-west1.run.app");
  m.token.mockResolvedValue("token-do-servico");
  m.segredo.mockResolvedValue(SEGREDO);
  vi.stubEnv("JANETE_STORAGE_BUCKET", "");
  vi.stubEnv("JANETE_RUNTIME_SERVICE_ACCOUNT", "");
  vi.stubGlobal("fetch", fetchFalso);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("bucket próprio do app publicado", () => {
  it("usa o bucket próprio, não o nome que o AI Studio grava na configuração", async () => {
    fetchFalso.mockResolvedValue(Response.json(bucketOk));
    expect((await storageAdapter.getBucket("midias")).data).toEqual({ id: "midias", name: "janete-midias-demo-janete", public: false });
    expect(fetchFalso.mock.calls[0]![0]).toBe("https://storage.googleapis.com/storage/v1/b/janete-midias-demo-janete");
  });
  it("cria quando não existe: privado, na região do serviço e com validade dos arquivos", async () => {
    fetchFalso.mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ name: "janete-midias-demo-janete" }))
      .mockResolvedValueOnce(Response.json(bucketOk));
    expect((await storageAdapter.createBucket("midias", { public: false })).error).toBeNull();
    const [url, init] = fetchFalso.mock.calls[1]!;
    expect(url).toBe("https://storage.googleapis.com/storage/v1/b?project=demo-janete");
    const corpo = JSON.parse(init.body);
    expect(corpo).toMatchObject({ name: "janete-midias-demo-janete", location: "US-WEST1",
      iamConfiguration: { publicAccessPrevention: "enforced", uniformBucketLevelAccess: { enabled: true } } });
    expect(corpo.lifecycle.rule).toEqual([{ action: { type: "Delete" }, condition: { age: DIAS_VALIDADE_MIDIA } }]);
    expect(DIAS_VALIDADE_MIDIA).toBe(30);
  });
  it("bucket que já existe não é criado de novo", async () => {
    fetchFalso.mockResolvedValue(Response.json(bucketOk));
    await storageAdapter.createBucket("midias", { public: false });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
  it("corrida na criação (409) segue para a conferência", async () => {
    fetchFalso.mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 409 }))
      .mockResolvedValueOnce(Response.json(bucketOk));
    expect((await storageAdapter.createBucket("midias", { public: false })).error).toBeNull();
  });
  it("sem permissão para criar devolve o erro, sem fingir sucesso", async () => {
    fetchFalso.mockResolvedValueOnce(new Response("{}", { status: 404 })).mockResolvedValueOnce(new Response("{}", { status: 403 }));
    expect((await storageAdapter.createBucket("midias", { public: false })).error?.code).toBe("storage_http_403");
  });
  it("recusa bucket de mesmo nome que pertence a outro projeto", async () => {
    fetchFalso.mockResolvedValue(Response.json({ ...bucketOk, projectNumber: "999" }));
    expect((await storageAdapter.getBucket("midias")).error?.code).toBe("bucket_de_outro_projeto");
  });
  it("com o instalador, usa o bucket dele e nunca cria", async () => {
    vi.stubEnv("JANETE_STORAGE_BUCKET", "bucket-do-instalador");
    fetchFalso.mockResolvedValue(new Response("{}", { status: 404 }));
    expect((await storageAdapter.createBucket("midias", { public: false })).error?.code).toBe("storage_http_404");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso.mock.calls[0]![0]).toContain("/b/bucket-do-instalador");
  });
});

describe("link temporário servido pelo próprio app", () => {
  it("sem a identidade do instalador, o link aponta para o endereço publicado e não fala com o Google", async () => {
    const link = new URL(await signedStorageUrl("midias", CAMINHO, 86_400));
    expect(link.origin).toBe("https://janete-233507220804.us-west1.run.app");
    expect(link.pathname).toBe(`/api/public/midia/${CAMINHO}`);
    const e = Number(link.searchParams.get("e"));
    expect(e - agora()).toBeGreaterThan(3590); expect(e - agora()).toBeLessThanOrEqual(3600);
    expect(link.searchParams.get("s")).toBe(assinar(CAMINHO, e));
    expect(link.href).not.toContain("token-do-servico");
    expect(fetchFalso).not.toHaveBeenCalled();
  });
  it("na prévia (sem endereço publicado) devolve erro, não um link que não funciona", async () => {
    m.origem.mockReturnValue(undefined);
    expect((await storageAdapter.from("midias").createSignedUrl(CAMINHO, 60)).error?.code).toBe("storage_identidade_ausente");
  });
});

describe("entrega da mídia pelo link", () => {
  const pedir = (caminho: string, e: number, s: string, init: RequestInit = {}) =>
    servirMidiaPublica(new Request(`https://janete-233507220804.us-west1.run.app/api/public/midia/${caminho}?e=${e}&s=${s}`, init));
  it("link válido entrega o arquivo do bucket próprio, com o tipo e sem deixar o navegador adivinhar", async () => {
    fetchFalso.mockResolvedValue(new Response("bytes-do-audio", { status: 200, headers: { "content-type": "audio/ogg", "content-length": "14" } }));
    const e = agora() + 600;
    const resposta = await pedir(CAMINHO, e, assinar(CAMINHO, e));
    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe("bytes-do-audio");
    expect(resposta.headers.get("content-type")).toBe("audio/ogg");
    expect(resposta.headers.get("content-disposition")).toBe("inline");
    expect(resposta.headers.get("x-content-type-options")).toBe("nosniff");
    const [url, init] = fetchFalso.mock.calls[0]!;
    expect(url).toContain("/b/janete-midias-demo-janete/o/midias%2F");
    expect(init.headers.authorization).toBe("Bearer token-do-servico");
  });
  it("tipo que o navegador poderia executar sai como download genérico", async () => {
    fetchFalso.mockResolvedValue(new Response("<script>", { status: 200, headers: { "content-type": "text/html" } }));
    const e = agora() + 600;
    const resposta = await pedir(CAMINHO, e, assinar(CAMINHO, e));
    expect(resposta.headers.get("content-type")).toBe("application/octet-stream");
    expect(resposta.headers.get("content-disposition")).toBe("attachment");
  });
  it("repassa o pedido de faixa (avançar o áudio no player)", async () => {
    fetchFalso.mockResolvedValue(new Response("yt", { status: 206, headers: { "content-type": "audio/ogg", "content-range": "bytes 1-2/14" } }));
    const e = agora() + 600;
    const resposta = await pedir(CAMINHO, e, assinar(CAMINHO, e), { headers: { range: "bytes=1-2" } });
    expect(resposta.status).toBe(206);
    expect(resposta.headers.get("content-range")).toBe("bytes 1-2/14");
    expect(fetchFalso.mock.calls[0]![1].headers.range).toBe("bytes=1-2");
  });
  it("vencido, adulterado, de outro arquivo ou com validade longa demais: o mesmo 404, sem ir ao bucket", async () => {
    const e = agora() + 600; const s = assinar(CAMINHO, e);
    const outro = CAMINHO.replace(/2/g, "3");
    const passado = agora() - 5; const longe = agora() + 86_400;
    const respostas = await Promise.all([
      pedir(CAMINHO, passado, assinar(CAMINHO, passado)),
      pedir(CAMINHO, e, s.replace(/^./, s[0] === "0" ? "1" : "0")),
      pedir(outro, e, s),
      pedir(CAMINHO, e + 1, s),
      pedir(CAMINHO, longe, assinar(CAMINHO, longe)),
      pedir("../../segredo", e, s),
      pedir(CAMINHO, e, s, { method: "POST" }),
    ]);
    for (const r of respostas) { expect(r.status).toBe(404); expect(await r.text()).toBe("nao_encontrado"); }
    expect(fetchFalso).not.toHaveBeenCalled();
  });
  it("arquivo que não existe (ou já apagado pela validade) responde 404", async () => {
    fetchFalso.mockResolvedValue(new Response("{}", { status: 404 }));
    const e = agora() + 600;
    expect((await pedir(CAMINHO, e, assinar(CAMINHO, e))).status).toBe(404);
  });
});
