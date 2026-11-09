import { createFileRoute } from "@tanstack/react-router";

/** Só responde 2xx quando os efeitos e a continuação foram persistidos. */
export async function executarTarefa(request: Request): Promise<Response> {
  // O toque do próprio app (sem fila): a chave do motor decide. Chave errada = 401, sem tentar o OIDC.
  const chave = request.headers.get("x-janete-motor");
  if (chave !== null) return executarToque(chave);
  const { authenticateCronRequest } = await import("@/integrations/firebase/cron-auth");
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;
  try {
    const [{ rodarCiclo }, { marcarWorkerVisto }, { pendenciasDoMotor }, { agendarProcessamento }] =
      await Promise.all([
        import("@/features/mensageria/nucleo/ciclo.server"),
        import("@/features/mensageria/nucleo/banco.server"),
        import("@/features/mensageria/nucleo/motor.server"),
        import("@/features/mensageria/nucleo/tasks.server"),
      ]);
    if (!(await marcarWorkerVisto())) throw new Error("worker_sem_configuracao");
    const { sincronizarWebhookPublicado } = await import("@/features/mensageria/nucleo/webhook-publicado.server");
    await sincronizarWebhookPublicado();
    // Uma passada limitada; sem espera ociosa de 45 s nem processo solto depois de responder.
    const resumo = await rodarCiclo({ orcamentoMs: 45_000 });
    const pending = await pendenciasDoMotor();
    if (!pending) throw new Error("worker_pendencias_indisponiveis");
    const moments = [pending.proximoEm, pending.vencidoDesde].filter((n): n is number => n !== null);
    if (moments.length) await agendarProcessamento(Math.max(Date.now() + 1_000, Math.min(...moments)));
    return Response.json({ ok: true, resumo, continuacao: moments.length > 0 });
  } catch {
    // Cloud Tasks repete com backoff; leases e outbox evitam repetir efeitos já confirmados.
    return Response.json({ ok: false, erro: "processamento_pendente" }, { status: 503 });
  }
}

/**
 * A rodada pedida pelo toque do próprio app publicado, sem Cloud Tasks. Quem tocou não espera esta resposta: o
 * resultado serve ao log e ao diagnóstico. A própria rodada pede o toque seguinte enquanto houver trabalho perto.
 */
async function executarToque(chave: string): Promise<Response> {
  const motor = await import("@/features/mensageria/nucleo/motor.server");
  if (!(await motor.conferirChaveDoToque(chave))) return new Response("Não autorizado", { status: 401 });
  try {
    const { sincronizarWebhookPublicado } = await import("@/features/mensageria/nucleo/webhook-publicado.server");
    await sincronizarWebhookPublicado().catch(() => {});
    const { resultado, toque } = await motor.rodarWorkerSemFila();
    return Response.json({ ok: resultado !== "falhou", continuacao: toque }, { status: resultado === "falhou" ? 503 : 200 });
  } catch {
    return Response.json({ ok: false, erro: "processamento_pendente" }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/public/cron/mensageria")({
  server: { handlers: { POST: ({ request }) => executarTarefa(request) } },
});
