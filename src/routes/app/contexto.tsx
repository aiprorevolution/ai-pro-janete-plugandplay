import { createFileRoute } from "@tanstack/react-router";

import { CarregandoArea, ESPERA_ESQUELETO_MS } from "@/features/plataforma/AreaVazia";
import { TelaContexto } from "@/features/plataforma/contexto";

// O Contexto com dados de exemplo (docs/spec-contexto.md).
export const Route = createFileRoute("/app/contexto")({
  component: TelaContexto,
  // 1ª visita, com o código da área ainda baixando: o esqueleto dela no lugar da área anterior.
  pendingComponent: () => <CarregandoArea area="contexto" />,
  pendingMs: ESPERA_ESQUELETO_MS,
  pendingMinMs: 0,
});
