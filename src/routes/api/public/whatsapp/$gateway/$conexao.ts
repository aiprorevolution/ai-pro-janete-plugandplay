// Webhook dos gateways de WhatsApp (spec da mensageria, premissa "Webhook"). GET responde ao
// desafio da Meta; POST recebe os eventos. A lógica fica no servidor e é carregada aqui dentro.
import { createFileRoute } from "@tanstack/react-router";

async function tratar(request: Request, params: { gateway: string; conexao: string }) {
  const { processarWebhook } = await import("@/features/mensageria/nucleo/webhook.server");
  return processarWebhook(request, params.gateway, params.conexao);
}

export const Route = createFileRoute("/api/public/whatsapp/$gateway/$conexao")({
  server: {
    handlers: {
      GET: ({ request, params }) => tratar(request, params),
      POST: ({ request, params }) => tratar(request, params),
    },
  },
});
