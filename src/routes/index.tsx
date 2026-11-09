import { createFileRoute } from "@tanstack/react-router";

import { redirecionarDaRaiz } from "./-sessao";

// No head() here: the home route inherits title/description/og/twitter from
// __root.tsx, and ships no og:image so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
//
// / não tem tela: manda para /entrar, /sem-acesso, /onboarding ou /app conforme a sessão do
// Firebase, o membro da conta (o Eu) e o onboarding da empresa (spec de ligar as telas ao banco,
// 2.2). Roda só no navegador, onde a sessão está.
export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: ({ context }) => redirecionarDaRaiz(context.queryClient),
});
