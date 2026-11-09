import { createFileRoute } from "@tanstack/react-router";

import { CarregandoArea, ESPERA_ESQUELETO_MS } from "@/features/plataforma/AreaVazia";
import { TelaChat, validarBuscaChat } from "@/features/plataforma/chat";

// `/app/chat?conversa=<id>` abre o Chat com essa conversa selecionada (o "Abrir no Chat" dos Contatos);
// sem `conversa`, ou com um id que não existe, o Chat abre como sempre.
export const Route = createFileRoute("/app/chat")({
  validateSearch: validarBuscaChat,
  component: PaginaChat,
  // 1ª visita, com o código da área ainda baixando: o esqueleto dela no lugar da área anterior.
  pendingComponent: () => <CarregandoArea area="chat" />,
  pendingMs: ESPERA_ESQUELETO_MS,
  pendingMinMs: 0,
});

function PaginaChat() {
  const { conversa } = Route.useSearch();
  return <TelaChat conversaInicial={conversa} />;
}
