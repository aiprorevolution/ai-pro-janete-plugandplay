// Funções de servidor da Equipe (spec de ligar as telas ao banco, 2.4, segundo bloco).
// Uso no navegador:
//   await convidarMembro({ data: { email, papel } })   → { ok: true, conviteId, aviso? }   (admin)
//   await linkDoConvite({ data: { conviteId } })        → { ok: true, link }                (admin)
//   await reenviarConvite({ data: { conviteId } })      → { ok: true, aviso? }              (admin)
//   await cancelarConvite({ data: { conviteId } })      → { ok: true }                      (admin)
//   await aceitarConvite({ data: { nome } })            → { ok: true, membroId }            (a sessão do convidado)
// Falha: { ok: false, erro, mensagem? (só um código) }. A lógica fica em equipe.server.ts, que entra
// por import() dentro do handler para não ir ao navegador (ele carrega o firebaseAdmin).
import { createServerFn } from "@tanstack/react-start";

import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";

import type { EntradaAceitar, EntradaConvidar, EntradaConvite } from "./equipe.server";

export type {
  AvisoEmail,
  EntradaAceitar,
  EntradaConvidar,
  EntradaConvite,
  ResultadoAceitar,
  ResultadoCancelar,
  ResultadoConvidar,
  ResultadoLinkDoConvite,
  ResultadoReenviar,
} from "./equipe.server";

// ---------- leitura das entradas (erro genérico, sem nenhum valor da entrada) ----------

function objeto(entrada: unknown): Record<string, unknown> {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new Error("Pedido inválido.");
  }
  return entrada as Record<string, unknown>;
}

function texto(e: Record<string, unknown>, campo: string, max: number): string {
  const v = e[campo];
  if (typeof v !== "string" || v.length > max) throw new Error(`Pedido inválido: ${campo}.`);
  return v;
}

/** Só a forma: o formato do e-mail é conferido na lógica, que responde email_invalido. */
export function lerEntradaConvidar(entrada: unknown): EntradaConvidar {
  const e = objeto(entrada);
  const papel = e["papel"];
  if (papel !== "admin" && papel !== "atendente") throw new Error("Pedido inválido: papel.");
  return { email: texto(e, "email", 320), papel };
}

/** Só a forma; o uuid é conferido na lógica, que responde nao_encontrado. */
export function lerEntradaConvite(entrada: unknown): EntradaConvite {
  return { conviteId: texto(objeto(entrada), "conviteId", 254).trim() };
}

export function lerEntradaAceitar(entrada: unknown): EntradaAceitar {
  return { nome: texto(objeto(entrada), "nome", 400) };
}

/**
 * A origem do app, para o redirectTo (origem + /convite): o cabeçalho Origin do pedido (o navegador
 * sempre manda num POST), senão a do endereço pedido. Fica vazia quando não dá para saber, e a lógica
 * responde falha ("origem_invalida").
 */
async function origemDoPedido(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const pedido = getRequest();
    const origem = pedido?.headers.get("origin");
    if (origem && origem !== "null") return origem;
    return pedido?.url ? new URL(pedido.url).origin : "";
  } catch {
    return "";
  }
}

/**
 * O token de acesso do pedido (o mesmo que o requireFirebaseAuth conferiu): o aceitarConvite usa para
 * encerrar as outras sessões da conta que já existia. null quando não dá para ler.
 */
async function tokenDoPedido(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const cabecalho = getRequest()?.headers.get("authorization") ?? "";
    return cabecalho.startsWith("Bearer ") ? cabecalho.slice("Bearer ".length) || null : null;
  } catch {
    return null;
  }
}

// ---------- funções ----------

export const convidarMembro = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaConvidar) => lerEntradaConvidar(entrada))
  .handler(async ({ data, context }) => {
    const { convidarMembroLogica } = await import("./equipe.server");
    const origem = await origemDoPedido();
    return convidarMembroLogica({ firebase: context.firebase, userId: context.userId, origem }, data);
  });

export const linkDoConvite = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaConvite) => lerEntradaConvite(entrada))
  .handler(async ({ data, context }) => {
    const { linkDoConviteLogica } = await import("./equipe.server");
    const origem = await origemDoPedido();
    return linkDoConviteLogica({ firebase: context.firebase, userId: context.userId, origem }, data);
  });

export const reenviarConvite = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaConvite) => lerEntradaConvite(entrada))
  .handler(async ({ data, context }) => {
    const { reenviarConviteLogica } = await import("./equipe.server");
    const origem = await origemDoPedido();
    return reenviarConviteLogica({ firebase: context.firebase, userId: context.userId, origem }, data);
  });

export const cancelarConvite = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaConvite) => lerEntradaConvite(entrada))
  .handler(async ({ data, context }) => {
    const { cancelarConviteLogica } = await import("./equipe.server");
    return cancelarConviteLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const aceitarConvite = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaAceitar) => lerEntradaAceitar(entrada))
  .handler(async ({ data, context }) => {
    const { aceitarConviteLogica } = await import("./equipe.server");
    // as claims do token (o e-mail da sessão e o jeito de entrar, que o aceitar confere) e o próprio
    // token (para encerrar as outras sessões da conta que já existia)
    const token = await tokenDoPedido();
    return aceitarConviteLogica({ firebase: context.firebase, userId: context.userId, claims: context.claims, token }, data);
  });
