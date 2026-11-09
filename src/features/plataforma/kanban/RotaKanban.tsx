import type { ComponentProps } from "react";
import { useNavigate } from "@tanstack/react-router";

import { TelaKanban } from "./TelaKanban";

type Props = { contato: string | undefined } & Pick<ComponentProps<typeof TelaKanban>, "relogio" | "saidaSemVistoMin">;

/**
 * O Kanban com o endereço (a página da rota /app/kanban): `?contato=` abre a gaveta do lead, e fechar a
 * gaveta tira só esse parâmetro, sem criar um passo no "voltar" (replace) e sem mexer na rolagem; os
 * outros parâmetros ficam. `relogio` e `saidaSemVistoMin` passam para a tela (os testes fixam).
 */
export function RotaKanban({ contato, ...tela }: Props) {
  const navigate = useNavigate();
  return (
    <TelaKanban
      {...tela}
      contatoDoEndereco={contato}
      aoFecharContatoDoEndereco={() => {
        void navigate({
          to: "/app/kanban",
          search: (busca) => ({ ...busca, contato: undefined }),
          replace: true,
          resetScroll: false,
        });
      }}
    />
  );
}
