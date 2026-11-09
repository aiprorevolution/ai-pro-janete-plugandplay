import { createFileRoute } from "@tanstack/react-router";

import { CarregandoArea, ESPERA_ESQUELETO_MS } from "@/features/plataforma/AreaVazia";
import { TelaConfiguracao } from "@/features/plataforma/configuracao";

export const Route = createFileRoute("/app/configuracao")({
  component: TelaConfiguracao,
  // 1ª visita, com o código da área ainda baixando: o esqueleto dela no lugar da área anterior.
  pendingComponent: () => <CarregandoArea area="configuracao" />,
  pendingMs: ESPERA_ESQUELETO_MS,
  pendingMinMs: 0,
});
