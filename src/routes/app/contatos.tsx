import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { CarregandoArea, ESPERA_ESQUELETO_MS } from "@/features/plataforma/AreaVazia";
import { TelaContatos, validarBuscaContatos } from "@/features/plataforma/contatos";

// `/app/contatos` mostra a tabela; `/app/contatos?contato=<id>` mostra o perfil desse contato
// (docs/spec-contatos.md, "Premissas", Endereço). Cada troca cria um passo no histórico, para o
// voltar do navegador levar do perfil de volta à tabela; só quando a tela sai sozinha (id que não
// existe, contato apagado) ela pede `substituir`, e o endereço troca sem criar passo.
export const Route = createFileRoute("/app/contatos")({
  validateSearch: validarBuscaContatos,
  component: PaginaContatos,
  // 1ª visita, com o código da área ainda baixando: o esqueleto dela no lugar da área anterior.
  pendingComponent: () => <CarregandoArea area="contatos" />,
  pendingMs: ESPERA_ESQUELETO_MS,
  pendingMinMs: 0,
});

function PaginaContatos() {
  const { contato } = Route.useSearch();
  const navigate = Route.useNavigate();
  const irPara = useCallback(
    (id: string | null, opcoes?: { substituir?: boolean }) => {
      // `resetScroll: false`: quem cuida da rolagem nas trocas que a própria tela pede é a TelaContatos
      // (o alto ao abrir o perfil, a altura de antes ao voltar). Sem isso, o restaurador de rolagem do
      // roteador (scrollRestoration em src/router.tsx) roda depois dela e desfaz as duas coisas.
      void navigate({
        to: "/app/contatos",
        search: { contato: id ?? undefined },
        resetScroll: false,
        replace: opcoes?.substituir === true,
      });
    },
    [navigate],
  );
  return <TelaContatos contatoId={contato ?? null} irPara={irPara} />;
}
