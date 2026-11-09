// Teto do pedido de envio nos 4 gateways (nucleo/prazo.ts, tempoEnvio): 10 s para texto e 20 s
// para mídia, nunca passando do corte da rota (fimEm + 5 s) menos a reserva do concluir_envio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdaptadorGateway, ConexaoServidor, PedidoEnvio } from "../nucleo/tipos";
import { adaptadorEvolution } from "./evolution";
import { adaptadorMeta } from "./meta";
import { adaptadorZapi } from "./zapi";
import { adaptadorZernio } from "./zernio";

const base = { id: "11111111-1111-4111-8111-111111111111", oficial: false };
const casos: { nome: string; a: AdaptadorGateway; c: ConexaoServidor }[] = [
  {
    nome: "meta",
    a: adaptadorMeta,
    c: {
      ...base,
      gateway: "meta",
      id_externo: "123456789",
      parametros: { phoneId: "123456789" },
      segredos: { token: "tok-meta-0000", appSecret: "app-0000", verifyToken: "ver-0000" },
      oficial: true,
    },
  },
  {
    nome: "zernio",
    a: adaptadorZernio,
    c: {
      ...base,
      gateway: "zernio",
      id_externo: "acc_1",
      parametros: {},
      segredos: { apiKey: "sk_zernio_0000", webhookSecret: "seg-0000" },
    },
  },
  {
    nome: "zapi",
    a: adaptadorZapi,
    c: {
      ...base,
      gateway: "zapi",
      id_externo: "inst",
      parametros: { instanceId: "inst" },
      segredos: { instanceToken: "itok-0000", clientToken: "ctok-0000", tokenUrl: "url-0000" },
    },
  },
  {
    nome: "evolution",
    a: adaptadorEvolution,
    c: {
      ...base,
      gateway: "evolution",
      id_externo: "vendas-01",
      parametros: { serverUrl: "https://evo.exemplo.com.br" },
      segredos: { apiKey: "evo-0000", tokenUrl: "url-0000" },
    },
  },
];

const destino: PedidoEnvio["destino"] = [
  { tipo: "telefone", valor: "5511999990000" },
  { tipo: "zernio_conversa", valor: "conv_1" },
];
const texto: PedidoEnvio = { destino, tipo: "texto", texto: "Oi!" };
const imagem: PedidoEnvio = {
  destino,
  tipo: "imagem",
  midia: { url: "https://arquivos.exemplo/x.png", mime: "image/png" },
};

beforeEach(() => {
  vi.useFakeTimers();
  // gateway que nunca responde: o pedido só termina pelo próprio prazo
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, falhar) => {
          const s = init?.signal;
          s?.addEventListener("abort", () => falhar(new DOMException("abortado", "AbortError")), {
            once: true,
          });
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Em quantos ms (do relógio falso) o envio desiste. */
async function desisteEm(
  a: AdaptadorGateway,
  c: ConexaoServidor,
  p: PedidoEnvio,
  opcoes?: { fimEm?: number },
): Promise<{ ms: number; codigo: unknown }> {
  const inicio = Date.now();
  let fim: number | null = null;
  let codigo: unknown;
  void a.enviar(p, c, opcoes).catch((e: unknown) => {
    fim = Date.now();
    codigo = (e as { codigo?: unknown }).codigo;
  });
  for (let i = 0; i < 300 && fim === null; i++) await vi.advanceTimersByTimeAsync(100);
  return { ms: (fim ?? Number.NaN) - inicio, codigo };
}

describe.each(casos)("teto do envio: $nome", ({ a, c }) => {
  it("texto desiste em 10 s, com tempo_esgotado passageiro", async () => {
    const r = await desisteEm(a, c, texto);
    expect(r.ms).toBe(10_000);
    expect(r.codigo).toBe("tempo_esgotado");
  });

  it("mídia desiste em 20 s", async () => {
    const r = await desisteEm(a, c, imagem);
    expect(r.ms).toBe(20_000);
  });

  it("com fimEm folgado, o teto inteiro vale (não aborta mais cedo)", async () => {
    const r = await desisteEm(a, c, texto, { fimEm: Date.now() + 30_000 });
    expect(r.ms).toBe(10_000);
  });

  it("nunca passa do corte (fimEm + 5 s) menos 2 s do concluir_envio", async () => {
    // corte em 6 s, menos 2 s: o pedido desiste em 4 s
    const r = await desisteEm(a, c, texto, { fimEm: Date.now() + 1_000 });
    expect(r.ms).toBe(4_000);
  });
});
