import { createFileRoute } from "@tanstack/react-router";

import { Layout } from "@/features/plataforma/Layout";

import { exigirAcesso } from "./-sessao";

// Casca da plataforma: menu das 7 áreas, e cada área é uma rota filha em src/routes/app/.
// Só entra quem é membro ativo (o Eu, spec 2.2); o Eu fica no cache do React Query para o Layout.
export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: ({ context }) => exigirAcesso(context.queryClient),
  component: Layout,
});
