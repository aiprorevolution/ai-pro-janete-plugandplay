// A pergunta "usar também no outro cartão?" do "Chave aceita" de uma chave da ElevenLabs
// (docs/spec-escuta-elevenlabs.md, T5). Funções puras: o Fluxo calcula a pergunta com a leitura do
// outro cartão no momento do aceite, e os testes contam a mesma história.

import type { ChaveIA, ProvedorIA } from "../exemplo";
import type { LeituraE, LeituraV } from "./leitura";

export type PerguntaTambem = { titulo: string; detalhe: string; sim: string; nao: string };

/** Os provedores de chave da escuta que não são a ElevenLabs, pelo nome que a pergunta diz. */
const NOME_ESCUTA: Partial<Record<ProvedorIA, string>> = { openai: "OpenAI", groq: "Groq", openrouter: "OpenRouter" };

/** A linha tem chave: não removida e com os 4 últimos (P5). */
function temChave(c: ChaveIA | null): c is ChaveIA & { ultimos4: string } {
  return !!c && c.status !== "removida" && !!c.ultimos4;
}

/** O outro cartão já usa esta chave: da ElevenLabs, ativa ou sem crédito, com os mesmos 4 últimos (P6).
 *  Sem diferença de maiúsculas: o banco guarda o final como veio na chave, e a tela o mostra em
 *  maiúsculas. */
function jaUsa(c: ChaveIA | null, ultimos4Nova: string): boolean {
  return (
    !!c &&
    c.provedor === "elevenlabs" &&
    (c.status === "ativa" || c.status === "sem_credito") &&
    !!c.ultimos4 &&
    c.ultimos4.toUpperCase() === ultimos4Nova.toUpperCase()
  );
}

/** A pergunta do cartão Escuta para a voz; null quando a voz já usa esta chave (P6). */
export function perguntaUsarNaVoz(voz: LeituraV, ultimos4Nova: string): PerguntaTambem | null {
  if (jaUsa(voz.chave, ultimos4Nova)) return null;
  const detalhe = temChave(voz.chave)
    ? `A voz hoje usa a chave terminada em ${voz.chave.ultimos4}. No Sim, ela passa a usar esta, e você confere a voz em seguida.`
    : "Com a mesma chave, a Janete também responde por áudio. Em seguida, você escolhe a voz.";
  return {
    titulo: "Usar esta chave também na voz?",
    detalhe,
    sim: "Sim, usar na voz também",
    nao: "Não, só na escuta",
  };
}

/** A pergunta do cartão Voz para a escuta; null quando a escuta já usa esta chave (P6). */
export function perguntaUsarNaEscuta(esc: LeituraE, ultimos4Nova: string): PerguntaTambem | null {
  if (jaUsa(esc.chave, ultimos4Nova)) return null;
  const chave = temChave(esc.chave) ? esc.chave : null;
  let detalhe: string;
  // a ordem da spec: a chave de outro provedor (que sai), uma da ElevenLabs (outra, ou a mesma marcada
  // como inválida), o cérebro que transcreve e, por último, a própria voz (E1: sem chave de escuta, a
  // voz já transcreve)
  if (chave && chave.provedor !== "elevenlabs") {
    const nome = NOME_ESCUTA[chave.provedor] ?? chave.provedor;
    detalhe = `O cartão Escuta tem a chave da ${nome}, terminada em ${chave.ultimos4}. No Sim, ela sai, e a escuta passa a usar esta.`;
  } else if (chave) {
    detalhe = `O cartão Escuta tem uma chave da ElevenLabs, terminada em ${chave.ultimos4}. No Sim, a escuta passa a usar esta.`;
  } else if (esc.cerebroTranscreve) {
    detalhe = "Hoje a Janete ouve os áudios com a chave do cérebro. No Sim, ela passa a ouvir com a ElevenLabs.";
  } else {
    detalhe =
      "Hoje a Janete já ouve os áudios com a chave da voz, porque não há chave de escuta. No Sim, a chave fica também no cartão Escuta e continua lá se você tirar a voz.";
  }
  return {
    titulo: "Usar esta chave na escuta também?",
    detalhe,
    sim: "Sim, usar na escuta também",
    nao: "Não, só na voz",
  };
}
