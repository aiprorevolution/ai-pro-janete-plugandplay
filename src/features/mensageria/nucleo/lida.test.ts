import { describe, expect, it, vi } from "vitest";

import { marcarSoLida } from "./lida";
import type { AdaptadorGateway, ConexaoServidor, RefLida } from "./tipos";

const conexao: ConexaoServidor = {
  id: "11111111-1111-4111-8111-111111111111",
  gateway: "zapi",
  id_externo: "inst",
  parametros: {},
  segredos: {},
  oficial: false,
};
const ref: RefLida = {
  destino: [{ tipo: "telefone", valor: "5511999990000" }],
  ids_externos: ["W1", " ", "W2"],
};

/** Adaptador mínimo: o contrato aceita os dois jeitos (com e sem marcarLida). */
function adaptador(extra: Partial<AdaptadorGateway> = {}): AdaptadorGateway {
  return {
    gateway: "zapi",
    validarWebhook: async () => true,
    traduzir: () => [],
    baixarMidia: async () => ({ bytes: new Uint8Array(), mime: "x" }),
    enviar: async () => ({}),
    marcarLidaEDigitando: vi.fn(async () => {}),
    montarConexao: () => ({ id_externo: "", parametros: {}, segredos: {} }),
    ...extra,
  };
}

describe("marcarSoLida", () => {
  it("chama o marcarLida do adaptador (sem o digitando), com o prazo e sem ids vazios", async () => {
    const marcarLida = vi.fn(async () => true);
    const a = adaptador({ marcarLida });
    await expect(marcarSoLida(a, ref, conexao, { fimEm: 123 })).resolves.toBe(true);
    expect(marcarLida).toHaveBeenCalledWith(
      { destino: ref.destino, ids_externos: ["W1", "W2"] },
      conexao,
      { fimEm: 123 },
    );
    expect(a.marcarLidaEDigitando).not.toHaveBeenCalled();
  });

  it("adaptador sem marcarLida: não marca e nunca cai no marcarLidaEDigitando", async () => {
    const a = adaptador();
    await expect(marcarSoLida(a, ref, conexao)).resolves.toBe(false);
    expect(a.marcarLidaEDigitando).not.toHaveBeenCalled();
  });

  it("adaptador que não pediu nada ou falhou calado (false): marcarSoLida devolve false", async () => {
    const marcarLida = vi.fn(async () => false);
    const a = adaptador({ marcarLida });
    await expect(marcarSoLida(a, ref, conexao)).resolves.toBe(false);
    expect(marcarLida).toHaveBeenCalledTimes(1);
  });

  it("sem ids ou sem destino: não chama o gateway", async () => {
    const marcarLida = vi.fn(async () => true);
    const a = adaptador({ marcarLida });
    await expect(marcarSoLida(a, { ...ref, ids_externos: [""] }, conexao)).resolves.toBe(false);
    await expect(marcarSoLida(a, { ...ref, destino: [] }, conexao)).resolves.toBe(false);
    expect(marcarLida).not.toHaveBeenCalled();
  });

  it("marcarLida que lança (contrato quebrado) não derruba quem chamou", async () => {
    const a = adaptador({
      marcarLida: async () => {
        throw new Error("gateway caiu");
      },
    });
    await expect(marcarSoLida(a, ref, conexao)).resolves.toBe(false);
  });
});
