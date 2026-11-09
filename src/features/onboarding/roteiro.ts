// Roteiro fixo da conversa de onboarding (spec do onboarding, decisão 2): 8 perguntas, uma por
// campo do Contexto, e as reações fixas da Janete. Na onda 1 não há IA na conversa.
// Textos do F (F-Final.dc.html: QUESTOES, INTRO, RESUMO_ABRE, PERGUNTA_FINAL). O F pergunta
// "empresa" e "o que vende" em duas vezes; aqui as duas viram uma pergunta só, porque o
// Contexto tem um campo só (empresa_oferta, docs/spec-banco-janete.md).

export const CAMPOS_CONTEXTO = [
  "empresa_oferta",
  "cliente_ideal",
  "preco",
  "diferenciais",
  "objecoes",
  "quando_passar_humano",
  "tom_voz",
  "horario",
] as const;

export type CampoContexto = (typeof CAMPOS_CONTEXTO)[number];

export type RespostasContexto = Record<CampoContexto, string>;

export type PerguntaRoteiro = {
  campo: CampoContexto;
  /** nome curto do campo no painel "O que eu já sei" */
  rotulo: string;
  pergunta: string;
  /** frase fixa da Janete depois da resposta */
  reagir: (resposta: string) => string;
};

export const ROTEIRO: readonly PerguntaRoteiro[] = [
  {
    campo: "empresa_oferta",
    rotulo: "Empresa e oferta",
    pergunta: "Para começar: como se chama a sua empresa e o que vocês vendem?",
    reagir: () => "Prazer. Vou usar esse nome com os seus clientes e explicar o que vocês vendem do jeito mais simples.",
  },
  {
    campo: "cliente_ideal",
    rotulo: "Cliente ideal",
    pergunta: "Quem é o cliente ideal de vocês?",
    reagir: () => "Certo. Vou dar prioridade a quem tiver esse perfil.",
  },
  {
    campo: "preco",
    rotulo: "Preço",
    pergunta: "Quanto custa, mais ou menos? Uma faixa de preço já me ajuda.",
    reagir: () => "Combinado. Só falo de valores do jeito que você me passou.",
  },
  {
    campo: "diferenciais",
    rotulo: "Diferenciais",
    pergunta: "Por que escolhem vocês e não a concorrência?",
    reagir: () => "Esse é o tipo de argumento que eu sei usar bem.",
  },
  {
    campo: "objecoes",
    rotulo: "Objeções",
    pergunta: "Quais dúvidas ou objeções aparecem mais?",
    reagir: () => "Vou preparar uma boa resposta para cada uma delas.",
  },
  {
    campo: "quando_passar_humano",
    rotulo: "Passar para humano",
    pergunta: "Quando um lead está pronto para falar com alguém da equipe?",
    reagir: () => "Fechado. Nesse ponto eu chamo alguém da equipe e passo a conversa.",
  },
  {
    campo: "tom_voz",
    rotulo: "Tom de voz",
    pergunta: "Como eu devo falar? Me descreva o tom.",
    reagir: () => "Pode deixar, vou falar desse jeito.",
  },
  {
    campo: "horario",
    rotulo: "Horário",
    pergunta: "Por último: em que horário eu atendo?",
    reagir: (resposta) =>
      /qualquer hora|24\s*h|sempre/i.test(resposta)
        ? "Perfeito. Vou estar sempre por aqui."
        : "Perfeito. Fora desse horário, eu aviso quando a equipe volta.",
  },
];

export const TOTAL_PERGUNTAS = ROTEIRO.length;

/** Primeiras falas da Janete, antes da 1ª pergunta. */
export const INTRO: readonly string[] = [
  "Oi. Eu sou a Janete e vou atender os leads da sua empresa no WhatsApp.",
  `Antes de falar com alguém, preciso conhecer o seu negócio. São ${TOTAL_PERGUNTAS} perguntas rápidas, e você pode responder do seu jeito.`,
];

/** Depois da última reação, antes do resumo editável. */
export const RESUMO_ABRE = "Pronto, aprendi o essencial. Veja como ficou:";

/** Depois do resumo: a Janete avisa que dá para alterar qualquer linha dele (decisão 3b da rodada 2). */
export const FALA_EDITAR = "Se você quiser alterar algum campo, clique nele e altere.";

/** Depois do resumo e do aviso de editar, antes do botão de confirmar. */
export const PERGUNTA_FINAL = "Posso montar tudo assim?";

export function respostasVazias(): RespostasContexto {
  return {
    empresa_oferta: "",
    cliente_ideal: "",
    preco: "",
    diferenciais: "",
    objecoes: "",
    quando_passar_humano: "",
    tom_voz: "",
    horario: "",
  };
}

/**
 * Grava a resposta da pergunta `indice` e devolve as falas seguintes da Janete: a reação e a
 * próxima pergunta, ou, na última, a reação, a abertura do resumo, o aviso de editar e a pergunta
 * final. O app usa `falasDepoisDaResposta` (conversa/historico.ts), que põe o cartão do resumo
 * entre a abertura e o aviso; as falas de texto são as mesmas.
 */
export function responderPergunta(
  respostas: RespostasContexto,
  indice: number,
  texto: string,
): { respostas: RespostasContexto; falas: string[]; terminou: boolean } {
  const pergunta = ROTEIRO[indice];
  if (!pergunta) throw new Error("Pergunta fora do roteiro.");
  const resposta = texto.trim();
  const novas = { ...respostas, [pergunta.campo]: resposta };
  const proxima = ROTEIRO[indice + 1];
  const reacao = pergunta.reagir(resposta);
  if (proxima) return { respostas: novas, falas: [reacao, proxima.pergunta], terminou: false };
  return { respostas: novas, falas: [reacao, RESUMO_ABRE, FALA_EDITAR, PERGUNTA_FINAL], terminou: true };
}
