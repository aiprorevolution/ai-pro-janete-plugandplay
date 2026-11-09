// Funções de servidor do QR code da Z-API e da Evolution (só admin). Uso no navegador:
//   await pedirQrConexao({ data: { gateway, campos, pedir } })   (campos colados na tela)
//   await pedirQrConexaoGuardada({ data: { pedir } })             (dados da conexão ativa)
//     → { ok: true, conectado: true, rotulo }
//     | { ok: true, conectado: false, qr, passkey }   (qr: data:image/...;base64, ou null)
// pedir "situacao" só confere; "qr", sem conexão, pede também a imagem.
// Falha: { ok: false, erro, mensagem?, campo? }; sem admin, { ok: false, erro: "sem_acesso" }.
//   await desconectarCelular({ data: { gateway, campos } })      (tira o celular da instância)
//     → { ok: true } | { ok: false, erro, mensagem, campo? }
// Nada é gravado e nenhuma credencial volta. A lógica fica em qr.server.ts, que entra por import()
// dentro do handler para não ir ao navegador. Spec: docs/spec-qr-whatsapp.md.
import { createServerFn } from "@tanstack/react-start";

import { lerEntradaConexao } from "@/features/servidor/conexao";
import {
  ehGatewayQr,
  lerEntradaQr,
  type EntradaDesconectarCelular,
  type EntradaQr,
} from "@/features/servidor/qr-conexao";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";

import type { EntradaPedirQrGuardada } from "./qr.server";

export type {
  EntradaDesconectarCelular,
  EntradaQr,
  GatewayQr,
  PedidoQr,
  ResultadoDesconectarCelular,
  ResultadoQr,
} from "@/features/servidor/qr-conexao";
export type {
  EntradaPedirQrGuardada,
  ResultadoDesconectarCelularConexao,
  ResultadoPedirQr,
  ResultadoPedirQrGuardada,
} from "./qr.server";

/** Aceita só { pedir: "qr" | "situacao" }. Erro genérico, sem nenhum valor da entrada. */
export function lerEntradaPedirQrGuardada(entrada: unknown): EntradaPedirQrGuardada {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new Error("Pedido inválido.");
  }
  const e = entrada as Record<string, unknown>;
  const pedido = e["pedir"];
  if (Object.keys(e).length !== 1 || (pedido !== "qr" && pedido !== "situacao")) {
    throw new Error("Pedido inválido: pedir.");
  }
  return { pedir: pedido };
}

/**
 * Aceita só { gateway: "zapi" | "evolution", campos } (os mesmos limites de lerEntradaConexao).
 * Erro genérico, sem nenhum valor da entrada.
 */
export function lerEntradaDesconectarCelular(entrada: unknown): EntradaDesconectarCelular {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new Error("Pedido inválido.");
  }
  const e = entrada as Record<string, unknown>;
  const gateway = e["gateway"];
  if (Object.keys(e).some((k) => k !== "gateway" && k !== "campos"))
    throw new Error("Pedido inválido.");
  if (typeof gateway !== "string" || !ehGatewayQr(gateway))
    throw new Error("Pedido inválido: gateway.");
  const { campos } = lerEntradaConexao({ gateway, campos: e["campos"] });
  return { gateway, campos };
}

export const desconectarCelular = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaDesconectarCelular) => lerEntradaDesconectarCelular(entrada))
  .handler(async ({ data, context }) => {
    const { desconectarCelularConexaoLogica } = await import("./qr.server");
    return desconectarCelularConexaoLogica(
      { firebase: context.firebase, userId: context.userId },
      data,
    );
  });

export const pedirQrConexao = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaQr) => lerEntradaQr(entrada))
  .handler(async ({ data, context }) => {
    const { pedirQrConexaoLogica } = await import("./qr.server");
    return pedirQrConexaoLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const pedirQrConexaoGuardada = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaPedirQrGuardada) => lerEntradaPedirQrGuardada(entrada))
  .handler(async ({ data, context }) => {
    const { pedirQrGuardadaLogica } = await import("./qr.server");
    return pedirQrGuardadaLogica({ firebase: context.firebase, userId: context.userId }, data);
  });
