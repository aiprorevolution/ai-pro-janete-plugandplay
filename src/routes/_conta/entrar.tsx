import { createFileRoute } from "@tanstack/react-router";

import { Entrar } from "@/features/conta";

export const Route = createFileRoute("/_conta/entrar")({
  component: Entrar,
});
