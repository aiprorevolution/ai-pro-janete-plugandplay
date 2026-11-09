import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/firebase/store.server", () => ({
  firestoreStore: { runTransaction: vi.fn(async () => { throw new Error("offline"); }) },
}));

import { aadChave, aadConexao, cifrar, decifrar, gerarSegredo } from "./cifra";

// O mesmo regex que o banco confere (ia_chaves e conexoes.segredos).
const REGEX_BANCO = /^v[0-9]+:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;
const CHAVE_SERVICO = "chave-de-servico-falsa-para-teste-0123456789";
const ID = "0b8f2c1e-3d4a-4b5c-8d6e-7f8091a2b3c4";

let antes: string | undefined;

beforeEach(() => {
  antes = process.env["JANETE_MASTER_SECRET"];
  process.env["JANETE_MASTER_SECRET"] = CHAVE_SERVICO;
});

afterEach(() => {
  if (antes === undefined) delete process.env["JANETE_MASTER_SECRET"];
  else process.env["JANETE_MASTER_SECRET"] = antes;
});

describe("cifra", () => {
  it("ida e volta, com acento e emoji", async () => {
    const texto = "sk-ant-api03-ção-🔑-" + "x".repeat(300);
    const cifrado = await cifrar(texto, aadChave(ID));
    expect(cifrado).not.toContain("sk-ant");
    expect(await decifrar(cifrado, aadChave(ID))).toBe(texto);
  });

  it("a saída casa com o regex do banco e começa com v1", async () => {
    for (const texto of ["", "a", "token-123", "y".repeat(1000)]) {
      const cifrado = await cifrar(texto, aadConexao(ID, "token"));
      expect(cifrado).toMatch(REGEX_BANCO);
      expect(cifrado.startsWith("v1:")).toBe(true);
    }
  });

  it("IV novo a cada cifra", async () => {
    const a = await cifrar("mesmo", aadChave(ID));
    const b = await cifrar("mesmo", aadChave(ID));
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
  });

  it("AAD errado dá cifra_invalida", async () => {
    const cifrado = await cifrar("segredo", aadConexao(ID, "token"));
    await expect(decifrar(cifrado, aadConexao(ID, "appSecret"))).rejects.toThrow(
      /^cifra_invalida$/,
    );
    await expect(decifrar(cifrado, aadConexao("outro-id", "token"))).rejects.toThrow(
      /^cifra_invalida$/,
    );
  });

  it("texto adulterado dá cifra_invalida", async () => {
    const cifrado = await cifrar("segredo", aadChave(ID));
    const [v, iv, corpo] = cifrado.split(":") as [string, string, string];
    const trocado = (corpo[0] === "A" ? "B" : "A") + corpo.slice(1);
    await expect(decifrar(`${v}:${iv}:${trocado}`, aadChave(ID))).rejects.toThrow(
      /^cifra_invalida$/,
    );
    await expect(decifrar(`v2:${iv}:${corpo}`, aadChave(ID))).rejects.toThrow(/^cifra_invalida$/);
    await expect(decifrar("texto puro", aadChave(ID))).rejects.toThrow(/^cifra_invalida$/);
    await expect(decifrar(`v1:AAAA:${corpo}`, aadChave(ID))).rejects.toThrow(/^cifra_invalida$/);
  });

  it("outra chave de serviço não abre", async () => {
    const cifrado = await cifrar("segredo", aadChave(ID));
    process.env["JANETE_MASTER_SECRET"] = CHAVE_SERVICO + "-trocada";
    await expect(decifrar(cifrado, aadChave(ID))).rejects.toThrow(/^cifra_invalida$/);
  });

  it("sem a variável dá cifra_indisponivel", async () => {
    delete process.env["JANETE_MASTER_SECRET"];
    await expect(cifrar("segredo", aadChave(ID))).rejects.toThrow(/^cifra_indisponivel$/);
    await expect(
      decifrar("v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==", aadChave(ID)),
    ).rejects.toThrow(/^cifra_indisponivel$/);
    process.env["JANETE_MASTER_SECRET"] = "";
    await expect(cifrar("segredo", aadChave(ID))).rejects.toThrow(/^cifra_indisponivel$/);
  });

  it("o erro nunca cita o texto nem o dado associado", async () => {
    const cifrado = await cifrar("segredo-que-nao-pode-vazar", aadChave(ID));
    try {
      await decifrar(cifrado, aadChave("id-errado"));
      throw new Error("devia falhar");
    } catch (e) {
      expect(String(e)).not.toContain("segredo-que-nao-pode-vazar");
      expect(String(e)).not.toContain("id-errado");
      expect(String(e)).not.toContain(CHAVE_SERVICO);
    }
  });

  it("auxiliares de AAD e gerarSegredo", () => {
    expect(aadConexao("abc", "token")).toBe("conexoes:abc:token");
    expect(aadChave("abc")).toBe("ia_chaves:abc:chave_cifrada");
    const a = gerarSegredo();
    const b = gerarSegredo();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});
