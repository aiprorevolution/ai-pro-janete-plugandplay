import { OAuth2Client } from "google-auth-library";
import { configuracaoTarefas } from "@/features/mensageria/nucleo/tasks.server";

const verifier = new OAuth2Client();

/** Cloud Tasks e recuperação programada usam OIDC Google; cabeçalhos de fila não autenticam. */
export async function authenticateCronRequest(request: Request): Promise<Response | null> {
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return new Response("Não autorizado", { status: 401 });
  let config;
  try { config = await configuracaoTarefas(); }
  catch { return new Response("Publicação Google ainda não configurada", { status: 503 }); }
  try {
    const ticket = await verifier.verifyIdToken({ idToken: token, audience: config.publicUrl });
    const payload = ticket.getPayload();
    if (!payload || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) ||
        payload.email !== config.serviceAccountEmail || payload.email_verified !== true) {
      return new Response("Não autorizado", { status: 403 });
    }
    return null;
  } catch { return new Response("Não autorizado", { status: 401 }); }
}
