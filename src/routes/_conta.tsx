import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PalcoConta } from "@/features/conta";

// A rota de layout (sem caminho) de Entrar e Criar conta: o palco do login, com a Janete gigante
// atrás do cartão, fica montado na troca entre as duas telas, e os endereços continuam
// /entrar e /criar-conta.
export const Route = createFileRoute("/_conta")({
  component: LayoutConta,
});

function LayoutConta() {
  return (
    <PalcoConta>
      <Outlet />
    </PalcoConta>
  );
}
