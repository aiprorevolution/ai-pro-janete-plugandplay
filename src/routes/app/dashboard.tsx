import { createFileRoute } from "@tanstack/react-router";

import { CarregandoArea, ESPERA_ESQUELETO_MS } from "@/features/plataforma/AreaVazia";
import { TelaDashboard } from "@/features/plataforma/dashboard/TelaDashboard";

// O Dashboard com dados de exemplo (docs/spec-dashboard-final.md). Um `?v=` dos links da revisão das
// versões é ignorado.
export const Route = createFileRoute("/app/dashboard")({
  component: TelaDashboard,
  // 1ª visita, com o código da área ainda baixando: o esqueleto dela no lugar da área anterior.
  pendingComponent: () => <CarregandoArea area="dashboard" />,
  pendingMs: ESPERA_ESQUELETO_MS,
  pendingMinMs: 0,
});
