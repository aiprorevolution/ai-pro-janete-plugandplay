import type { Respostas } from "@/features/onboarding/estado";

import { areaVisivelPara, type AreaId } from "./areas";
import type { PapelMembro } from "./exemplo/tipos";
import { curto, minusc, semPontoFinal } from "./texto";

// "Fale com a Janete" nesta onda (spec, decisão 4): as sugestões do F (JANETE_SUGESTOES) viram atalhos.
// Cada uma leva a Janete a responder com uma frase fixa e um botão que abre a área certa. Sem IA e sem
// campo de texto livre. A única parte variável é o tom de voz, que vem da resposta do onboarding.
// As respostas dizem onde fica cada coisa, sem prometer o que a tela não faz: não há pausa na
// Configuração. Os leads de exemplo ficam no Chat e no Kanban, e os números do atendimento, no Dashboard.

export interface Atalho {
  pergunta: string;
  area: AreaId;
  botao: string;
  resposta: (respostas: Respostas) => string;
}

export const ATALHOS_JANETE: readonly Atalho[] = [
  {
    pergunta: "Como estão meus leads hoje?",
    area: "kanban",
    botao: "Abrir o Kanban",
    resposta: () =>
      "Os seus leads estão no Kanban, cada um na etapa em que está. Os números do atendimento estão no Dashboard.",
  },
  {
    pergunta: "Quero te ensinar algo novo sobre a empresa",
    area: "contexto",
    botao: "Abrir o Contexto",
    resposta: () => "Tudo o que eu sei sobre a sua empresa fica no Contexto.",
  },
  {
    pergunta: "Revise como você está falando",
    area: "contexto",
    botao: "Abrir o Contexto",
    resposta: (respostas) => {
      const tom = respostas.tom_voz ? curto(semPontoFinal(minusc(respostas.tom_voz)), 60) : "";
      return (
        (tom ? `Hoje eu falo assim: ${tom}. ` : "") +
        "O meu jeito de falar fica no Contexto, no item Tom de voz."
      );
    },
  },
  {
    pergunta: "Pause o atendimento até amanhã",
    area: "configuracao",
    botao: "Abrir a Configuração",
    resposta: () =>
      "Ainda não dá para pausar o atendimento. Quando der, a pausa vai ficar na Configuração.",
  },
];

/** Os atalhos que o papel vê: o atendente não vê a Configuração, então os que levam a ela saem. */
export function atalhosDoPapel(papel: PapelMembro): readonly Atalho[] {
  return papel === "admin" ? ATALHOS_JANETE : ATALHOS_JANETE.filter((a) => areaVisivelPara(a.area, papel));
}
