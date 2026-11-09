import { randomUUID } from "node:crypto";
import { getInstallationConfig } from "@/integrations/firebase/config.server";
import { getServerAccessToken } from "@/integrations/firebase/identity.server";

export const CAMINHO_WORKER = "/api/public/cron/mensageria";
export type ConfiguracaoTarefas = { projectId: string; location: string; queue: string; publicUrl: string; serviceAccountEmail: string };

export function conferirOrigemPublicada(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      /^(localhost|127\.|0\.|\[::1\])/.test(url.hostname) ||
      /^ais-dev-|\.cloudworkstations\.dev$|\.run\.app\.googleusercontent\.com$/.test(url.hostname)) {
    throw new Error("endereco_publicado_invalido");
  }
  return url.origin;
}

export async function configuracaoTarefas(): Promise<ConfiguracaoTarefas> {
  const installation = await getInstallationConfig();
  const location = process.env["JANETE_TASKS_LOCATION"] || "";
  const queue = process.env["JANETE_TASKS_QUEUE"] || "janete-mensageria";
  const publicUrl = process.env["JANETE_PUBLIC_URL"] || installation.publicUrl || "";
  const serviceAccountEmail = process.env["JANETE_TASKS_SERVICE_ACCOUNT"] || "";
  if (!location || !publicUrl || !serviceAccountEmail) throw new Error("tarefas_nao_configuradas");
  if (!/^[a-z]+-[a-z]+\d+$/.test(location) || !/^[a-zA-Z0-9_-]{1,100}$/.test(queue))
    throw new Error("tarefas_configuracao_invalida");
  if (!serviceAccountEmail.endsWith(`@${installation.projectId}.iam.gserviceaccount.com`))
    throw new Error("tarefas_identidade_invalida");
  return { projectId: installation.projectId, location, queue,
    publicUrl: conferirOrigemPublicada(publicUrl), serviceAccountEmail };
}

/** A confirmação significa que o Google persistiu a tarefa; não há trabalho após a resposta. */
export async function agendarProcessamento(when = Date.now(), timeoutMs = 12_000): Promise<string> {
  const config = await configuracaoTarefas();
  const token = await getServerAccessToken();
  const parent = `projects/${config.projectId}/locations/${config.location}/queues/${config.queue}`;
  // Uma chegada no fim do processamento nunca é suprimida por debounce em memória.
  // Transações e reservas no Firestore tornam entregas repetidas seguras.
  const name = `${parent}/tasks/janete-${randomUUID()}`;
  const scheduleTime = new Date(Math.max(Date.now(), Math.min(when, Date.now() + 86_400_000))).toISOString();
  const result = await fetch(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(Math.max(500, Math.min(timeoutMs, 15_000))),
    body: JSON.stringify({ task: {
      name, scheduleTime, dispatchDeadline: "120s",
      httpRequest: {
        httpMethod: "POST", url: `${config.publicUrl}${CAMINHO_WORKER}`,
        headers: { "Content-Type": "application/json" },
        body: Buffer.from('{"version":1}').toString("base64"),
        oidcToken: { serviceAccountEmail: config.serviceAccountEmail, audience: config.publicUrl },
      },
    } }),
  });
  if (!result.ok) throw new Error(`tarefas_http_${result.status}`);
  const data = await result.json() as { name?: unknown };
  if (typeof data.name !== "string" || !data.name.startsWith(`${parent}/tasks/`))
    throw new Error("tarefas_resposta_invalida");
  return data.name;
}
