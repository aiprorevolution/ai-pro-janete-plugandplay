import { acharModelo } from "@/features/ia/modelos";
import { curto, minusc, semPontoFinal } from "@/features/plataforma/texto";

import type { EstadoOnboarding, Gateway } from "../estado";

// Os passos do preparo (o PREPARO do F): cada um amarra um nó do fio, e o detalhe vem do que a
// pessoa escolheu. Onde não há escolha, o texto padrão do F.

/** Nome de cada gateway, como no F (PROVS[...].nome). */
export const NOME_DO_GATEWAY: Record<Gateway, string> = {
  meta: "API oficial da Meta",
  zernio: "Zernio",
  zapi: "Z-API",
  evolution: "Evolution",
};

export interface PassoPreparo {
  titulo: string;
  detalhe: (estado: EstadoOnboarding) => string;
}

export const PREPARO: readonly PassoPreparo[] = [
  {
    titulo: "Escrevendo meu jeito de falar",
    detalhe: (e) => {
      const tom = e.conversa.respostas.tom_voz?.trim();
      return tom ? "Tom: " + curto(semPontoFinal(minusc(tom)), 48) : "Com base na nossa conversa";
    },
  },
  {
    titulo: "Ligando o WhatsApp",
    detalhe: (e) => {
      // Como no F: só o nome do provedor, depois de a conexão validar (o rótulo prova que validou).
      const { gateway, rotulo } = e.conexao;
      if (!gateway || !rotulo) return "Assim que você conectar, em Configuração";
      return NOME_DO_GATEWAY[gateway];
    },
  },
  {
    titulo: "Guardando o Contexto da empresa",
    detalhe: (e) => {
      const n = Object.values(e.conversa.respostas).filter((v) => typeof v === "string" && v.trim()).length;
      return n
        ? n + (n === 1 ? " resposta vira" : " respostas viram") + " o meu Contexto"
        : "O que você me contar vira o meu Contexto";
    },
  },
  {
    titulo: "Organizando seus contatos",
    detalhe: () => "A lista começa vazia e cresce com cada lead",
  },
  {
    titulo: "Abrindo a sua plataforma",
    detalhe: (e) => {
      const { provedor, modelo } = e.cerebro;
      const nome = provedor && modelo ? acharModelo(provedor, modelo)?.nome : undefined;
      return nome ? "Pensando com o " + nome : "Quase lá";
    },
  },
];

/** A fala dela no fim do preparo, depois de as contas do fio voltarem para ela (4c). */
export const FALA_FINAL = "Tudo pronto, agora vou te mostrar como a plataforma funciona.";
