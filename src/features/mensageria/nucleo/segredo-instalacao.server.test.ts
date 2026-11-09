// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/integrations/firebase/store.server", () => ({ firestoreStore: { runTransaction: m.transaction } }));
import { segredoDaInstalacao } from "./segredo-instalacao.server";
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("JANETE_MASTER_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("segredo estável por cópia", () => {
  it("cria uma vez e conserva após novo login/token e nova instância", async () => {
    let document: any = null;
    const tx = { get: vi.fn(async () => document), set: vi.fn(async (_c,_id,value) => { document = value; }) };
    m.transaction.mockImplementation(fn => fn(tx));
    const first = await segredoDaInstalacao();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(await segredoDaInstalacao()).toBe(first);
    expect(tx.set).toHaveBeenCalledTimes(1);
  });
  it("falha de permissão não gera chave temporária nem substitui a existente", async () => {
    m.transaction.mockRejectedValue(new Error("permission denied"));
    await expect(segredoDaInstalacao()).rejects.toThrow(/^cifra_indisponivel$/);
  });
  it("segredo malformado não é regenerado perdendo cifras antigas", async () => {
    const tx = { get: async () => ({ secret: "bad" }), set: vi.fn() };
    m.transaction.mockImplementation(fn => fn(tx));
    await expect(segredoDaInstalacao()).rejects.toThrow(/^cifra_indisponivel$/);
    expect(tx.set).not.toHaveBeenCalled();
  });
});
