// Funções de servidor da plataforma (spec de ligar as telas ao banco, 2.4, primeiro bloco).
// Uso no navegador:
//   await garantirBucketMidias({ data: {} })            → { ok: true }                    (membro)
//   await pedirEnvio({ data: {} })                      → { ok: true, enviados, falhas, devolvidos, incertos } (membro)
//   await marcarLidaNoWhatsApp({ data: { conversaId } }) → { ok: true, marcada }          (membro)
//   await apagarContato({ data: { contatoId } })        → { ok: true }                    (admin)
//   await acordarMotorPelaTela({ data: {} })            → { ok: true, toque }             (membro)
// Falha: { ok: false, erro: "sem_acesso" | "nao_encontrado" | "falha", mensagem? (só o código) }.
// A lógica fica em servidor.server.ts, que entra por import() dentro do handler para não ir ao
// navegador (ele carrega o firebaseAdmin e o código da mensageria).
// O toque no motor (acordarMotorPelaTela e o fim do pedirEnvio) leva a origem da URL do pedido
// (origemDaUrlDoPedido), nunca o cabeçalho Origin: um membro poderia forjá-lo para levar o toque e
// a chave do motor a um host dele.
//
// A camada de dados recebe estas funções pela prop `servidor` do <ProvedorDados fonte="banco">:
//   <ProvedorDados fonte="banco" servidor={servidorDaPlataforma}>
import { createServerFn } from "@tanstack/react-start";

import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";

import type { ServidorDados } from "./ProvedorDados";
import type { EntradaApagarContato, EntradaMarcarLida } from "./servidor.server";

export type {
  EntradaApagarContato,
  EntradaMarcarLida,
  ResultadoAcordarMotor,
  ResultadoApagarContato,
  ResultadoGarantirBucket,
  ResultadoMarcarLida,
  ResultadoPedirEnvio,
} from "./servidor.server";

// ---------- leitura das entradas (erro genérico, sem nenhum valor da entrada) ----------

function objeto(entrada: unknown): Record<string, unknown> {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new Error("Pedido inválido.");
  }
  return entrada as Record<string, unknown>;
}

/** Ações sem entrada: aceita só nada ou um objeto vazio. */
export function lerEntradaVazia(entrada: unknown): Record<string, never> {
  if (entrada === undefined || entrada === null) return {};
  if (Object.keys(objeto(entrada)).length > 0) throw new Error("Pedido inválido.");
  return {};
}

/** Só a forma; o uuid é conferido na lógica, que responde nao_encontrado (como o 22P02). */
function lerId(e: Record<string, unknown>, campo: string): string {
  const v = e[campo];
  if (typeof v !== "string" || v.length > 100) throw new Error(`Pedido inválido: ${campo}.`);
  return v.trim();
}

export function lerEntradaMarcarLida(entrada: unknown): EntradaMarcarLida {
  return { conversaId: lerId(objeto(entrada), "conversaId") };
}

export function lerEntradaApagarContato(entrada: unknown): EntradaApagarContato {
  return { contatoId: lerId(objeto(entrada), "contatoId") };
}

/** O host que recebeu o pedido (new URL(request.url).origin). Sem pedido: null. */
async function origemDaUrlDoPedido(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    return new URL(getRequest().url).origin;
  } catch {
    return null;
  }
}

// ---------- funções ----------

export const garantirBucketMidias = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada?: Record<string, never>) => lerEntradaVazia(entrada))
  .handler(async ({ context }) => {
    const { garantirBucketMidiasLogica } = await import("./servidor.server");
    return garantirBucketMidiasLogica({ firebase: context.firebase, userId: context.userId });
  });

export const pedirEnvio = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada?: Record<string, never>) => lerEntradaVazia(entrada))
  .handler(async ({ context }) => {
    const { pedirEnvioLogica } = await import("./servidor.server");
    const origem = await origemDaUrlDoPedido();
    return pedirEnvioLogica({ firebase: context.firebase, userId: context.userId }, { origem });
  });

export const acordarMotorPelaTela = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada?: Record<string, never>) => lerEntradaVazia(entrada))
  .handler(async ({ context }) => {
    const { acordarMotorPelaTelaLogica } = await import("./servidor.server");
    const origem = await origemDaUrlDoPedido();
    return acordarMotorPelaTelaLogica(
      { firebase: context.firebase, userId: context.userId },
      { origem },
    );
  });

export const marcarLidaNoWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaMarcarLida) => lerEntradaMarcarLida(entrada))
  .handler(async ({ data, context }) => {
    const { marcarLidaNoWhatsAppLogica } = await import("./servidor.server");
    return marcarLidaNoWhatsAppLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const apagarContato = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaApagarContato) => lerEntradaApagarContato(entrada))
  .handler(async ({ data, context }) => {
    const { apagarContatoLogica } = await import("./servidor.server");
    return apagarContatoLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

// ---------- ligação com a camada de dados ----------

/**
 * As 5 funções no formato que o <ProvedorDados fonte="banco" servidor={...}> recebe (o ponto de
 * injeção da F1, `ServidorDados`): o envio (envio.ts) usa pedirEnvio e garantirBucketMidias; as
 * ações marcarLida e apagarContato usam marcarLidaNoWhatsApp e apagarContato; o conserto da tela e
 * as ações que criam trabalho usam acordarMotor.
 */
export const servidorDaPlataforma: ServidorDados = {
  pedirEnvio: () => pedirEnvio({ data: {} }),
  acordarMotor: () => acordarMotorPelaTela({ data: {} }),
  garantirBucketMidias: () => garantirBucketMidias({ data: {} }),
  marcarLidaNoWhatsApp: (conversaId) => marcarLidaNoWhatsApp({ data: { conversaId } }),
  apagarContato: (contatoId) => apagarContato({ data: { contatoId } }),
};
