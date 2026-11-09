import { createFileRoute } from "@tanstack/react-router";

import { CarregandoArea, ESPERA_ESQUELETO_MS } from "@/features/plataforma/AreaVazia";
import { TelaEquipe } from "@/features/plataforma/equipe";

export const Route = createFileRoute("/app/equipe")({
  component: TelaEquipe,
  // 1ª visita, com o código da área ainda baixando: o esqueleto dela no lugar da área anterior.
  pendingComponent: () => <CarregandoArea area="equipe" />,
  pendingMs: ESPERA_ESQUELETO_MS,
  pendingMinMs: 0,
});
