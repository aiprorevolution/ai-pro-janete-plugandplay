import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Botao } from "@/components/aipro";
import { PalcoConta } from "@/features/conta";
import { CartaoConta, classesConta as s } from "@/features/conta/CartaoConta";
import { limparEstadoOnboarding } from "@/features/onboarding/estado";
import { esquecerTour } from "@/features/plataforma/tour";
import { firebase } from "@/integrations/firebase/client";

import { exigirSemAcesso } from "./-sessao";

// /sem-acesso (spec de ligar as telas ao banco, 2.2, e decisão 1): a conta entrou, mas não é membro
// da empresa (não foi convidada) ou foi desativada. Mostra o aviso no cartão do login, com Sair.
// Quem tem acesso não fica aqui (vai para o destino dele) e quem não tem sessão vai para /entrar.
// Só o Route sai daqui (o code splitting do TanStack separa o componente); os testes usam
// Route.options.component.
export const Route = createFileRoute("/sem-acesso")({
  ssr: false,
  beforeLoad: ({ context }) => exigirSemAcesso(context.queryClient),
  component: PaginaSemAcesso,
});

const TITULO_SEM_ACESSO = "Sua conta não tem acesso";
const TEXTO_SEM_ACESSO = "Peça um convite ao admin.";

function PaginaSemAcesso() {
  return (
    <PalcoConta>
      <SemAcesso />
    </PalcoConta>
  );
}

function SemAcesso() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saindo, setSaindo] = useState(false);

  const sair = async () => {
    if (saindo) return;
    setSaindo(true);
    try {
      await firebase.auth.signOut();
    } catch {
      // mesmo com falha de rede, a tela volta para o login
    }
    // A próxima conta que entrar nesta aba não herda nada desta: nem o cache, nem o onboarding, nem o tour.
    queryClient.clear();
    limparEstadoOnboarding();
    esquecerTour();
    try {
      await navigate({ to: "/entrar", replace: true });
    } catch {
      window.location.assign("/entrar");
    }
  };

  return (
    <CartaoConta
      idTitulo="sem-acesso-titulo"
      titulo={TITULO_SEM_ACESSO}
      subtitulo={TEXTO_SEM_ACESSO}
      anuncio={saindo ? "Saindo…" : ""}
    >
      <div className={s.form}>
        <Botao type="button" tamanho="grande" largo carregando={saindo} onClick={() => void sair()} data-bloco="2">
          Sair
        </Botao>
      </div>
      {/* O convidado cai aqui quando o endereço de /convite não está nas Redirect URLs do login (o
          Firebase manda para o Site URL, e a rota / vê uma sessão sem membro). O /convite confere
          sozinho se esta conta tem convite (aceitarConvite). */}
      <p className={s.rodape} data-bloco="3" inert={saindo}>
        Recebeu um convite?{" "}
        <Link to="/convite" className={s.link}>
          Abrir o convite
        </Link>
      </p>
    </CartaoConta>
  );
}
