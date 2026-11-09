import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Onboarding } from "@/features/onboarding/Onboarding";

import { exigirOnboardingAberto } from "./-sessao";

// Uma rota só para as 5 etapas: as transições contínuas do F pedem o DOM compartilhado entre elas.
// Só o admin, e só enquanto o onboarding da empresa não terminou (decisão 2); o atendente vai para /app.
export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: ({ context }) => exigirOnboardingAberto(context.queryClient),
  component: PaginaOnboarding,
});

function PaginaOnboarding() {
  const navigate = useNavigate();
  return <Onboarding aoConcluir={() => navigate({ to: "/app", replace: true })} />;
}
