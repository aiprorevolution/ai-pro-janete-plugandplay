import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { PapelMembro } from "./exemplo/tipos";

// O papel de quem usa a plataforma (spec, bloco 1, item 4): define o que cada tela mostra: o atendente
// não vê a Configuração (some do menu, do dock, dos atalhos e do tour), nem o custo de IA nem o convite
// da Equipe, e não apaga contato. No exemplo, define também quem é o `eu` (admin = "Você", atendente =
// Marina).
//
// Dois jeitos de usar (spec de ligar as telas ao banco, 2.2):
// - com `papel` (o Layout da plataforma, no modo banco): o papel vem do Eu (`membros.papel`) e
//   acompanha a conta; o setPapel não faz nada, porque quem troca o papel é o admin, na Equipe;
// - com `inicial` (o modo exemplo dos testes): o papel começa nele e o setPapel troca.

export type Papel = PapelMembro;

interface ValorPapel {
  papel: Papel;
  setPapel: (papel: Papel) => void;
}

const nada = () => {};

// Sem o provedor (uma tela montada sozinha num teste), vale admin e a troca não faz nada.
const PapelContexto = createContext<ValorPapel>({ papel: "admin", setPapel: nada });

interface Props {
  children: ReactNode;
  /** O papel fixo, vindo da conta (o Eu). Quando vem, manda: o `inicial` e o setPapel não valem. */
  papel?: Papel | undefined;
  /** O papel do começo, no modo exemplo. Padrão: admin. */
  inicial?: Papel | undefined;
}

export function ProvedorPapel({ children, papel: daConta, inicial = "admin" }: Props) {
  const [local, setLocal] = useState<Papel>(inicial);
  const papel = daConta ?? local;
  const setPapel = daConta === undefined ? setLocal : nada;
  const valor = useMemo(() => ({ papel, setPapel }), [papel, setPapel]);
  return <PapelContexto.Provider value={valor}>{children}</PapelContexto.Provider>;
}

export function usePapel(): ValorPapel {
  return useContext(PapelContexto);
}
