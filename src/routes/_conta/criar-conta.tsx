import { createFileRoute } from "@tanstack/react-router";

import { CriarConta } from "@/features/conta";

// O cadastro e a passagem do login para a etapa conexão ficam em src/features/conta/.
export const Route = createFileRoute("/_conta/criar-conta")({
  component: CriarConta,
});
