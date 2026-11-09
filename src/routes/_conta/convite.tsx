import { createFileRoute } from "@tanstack/react-router";

import { ConviteConta } from "@/features/plataforma/equipe/ConviteConta";

// /convite (spec de ligar as telas ao banco, 2.2): o link do convite cai aqui, no cartão do login. A
// sessão do Firebase fica no navegador (o link a cria nele), então a rota roda só no navegador.
// A tela e as regras ficam em src/features/plataforma/equipe/ConviteConta.tsx.
export const Route = createFileRoute("/_conta/convite")({
  ssr: false,
  component: ConviteConta,
});
