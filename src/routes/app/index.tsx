import { createFileRoute, redirect } from "@tanstack/react-router";

// /app sozinho abre a primeira área do menu.
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    throw redirect({ to: "/app/chat", replace: true });
  },
});
