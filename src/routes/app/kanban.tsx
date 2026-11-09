import { createFileRoute } from "@tanstack/react-router";

import { CarregandoArea, ESPERA_ESQUELETO_MS } from "@/features/plataforma/AreaVazia";
import { RotaKanban } from "@/features/plataforma/kanban/RotaKanban";
import { validarBuscaKanban } from "@/features/plataforma/kanban/endereco";

// `?contato=<id do contato>` abre a gaveta desse lead (o "Ver no Kanban" dos Contatos). O validateSearch
// vem do arquivo pequeno (endereco.ts), e não do índice da pasta, para a tela não ir junto com a parte da
// rota que fica fora da divisão do código.
export const Route = createFileRoute("/app/kanban")({
  validateSearch: validarBuscaKanban,
  component: PaginaKanban,
  // 1ª visita, com o código da área ainda baixando: o esqueleto dela no lugar da área anterior.
  pendingComponent: () => <CarregandoArea area="kanban" />,
  pendingMs: ESPERA_ESQUELETO_MS,
  pendingMinMs: 0,
});

function PaginaKanban() {
  const { contato } = Route.useSearch();
  return <RotaKanban contato={contato} />;
}
