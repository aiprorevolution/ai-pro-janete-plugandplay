import {
  FALA_EDITAR,
  INTRO,
  PERGUNTA_FINAL,
  RESUMO_ABRE,
  ROTEIRO,
  TOTAL_PERGUNTAS,
  type CampoContexto,
} from "../roteiro";
import type { Respostas } from "../estado";

/** Uma linha do chat: fala da Janete, resposta da pessoa ou o cartão do resumo. */
export interface Mensagem {
  id: number;
  de: "janete" | "eu" | "resumo";
  texto: string;
}

/** A fala de editar mora no roteiro, com as outras falas; continua exportada daqui para quem já a importa. */
export { FALA_EDITAR };

/** O que a Janete vai dizer em seguida: texto, ou o cartão "Meu jeito de trabalhar". */
export type Fala = string | { resumo: true };

function preenchida(respostas: Respostas, campo: CampoContexto): boolean {
  return !!respostas[campo]?.trim();
}

/** A primeira pergunta sem resposta, na ordem do roteiro; `TOTAL_PERGUNTAS` se todas têm. */
export function proximaPendente(respostas: Respostas): number {
  const i = ROTEIRO.findIndex((p) => !preenchida(respostas, p.campo));
  return i === -1 ? TOTAL_PERGUNTAS : i;
}

export function contarPreenchidas(respostas: Respostas): number {
  return ROTEIRO.filter((p) => preenchida(respostas, p.campo)).length;
}

/** As falas depois da resposta à pergunta `indice` (o `responder` do F). */
export function falasDepoisDaResposta(indice: number, texto: string, respostas: Respostas): Fala[] {
  const pergunta = ROTEIRO[indice];
  if (!pergunta) return [];
  const reacao = pergunta.reagir(texto);
  const proxima = proximaPendente(respostas);
  if (proxima >= TOTAL_PERGUNTAS) return [reacao, RESUMO_ABRE, { resumo: true }, FALA_EDITAR, PERGUNTA_FINAL];
  return [reacao, ROTEIRO[proxima]!.pergunta];
}

/** As falas da abertura (sem nada respondido ainda). */
export function falasDaAbertura(): Fala[] {
  return [INTRO[0]!, INTRO[1]!, ROTEIRO[0]!.pergunta];
}

export interface Retomada {
  mensagens: Mensagem[];
  /** Pergunta da vez (TOTAL_PERGUNTAS quando acabou). */
  q: number;
  /** Conversa já terminou: mostra o resumo e o botão de montar. */
  fim: boolean;
  /** O campo aprendido por último (o destaque do painel). */
  ultimo: CampoContexto | null;
  /** O que falta a Janete dizer, com a animação de digitando. */
  falar: Fala[];
}

/**
 * Remonta o chat a partir das respostas gravadas (página recarregada no meio da conversa).
 * O histórico vai até a primeira pergunta sem resposta; essa pergunta a Janete volta a digitar.
 */
export function retomarConversa(respostas: Respostas): Retomada {
  let id = 0;
  const msg = (de: Mensagem["de"], texto = ""): Mensagem => ({ id: ++id, de, texto });

  const q = proximaPendente(respostas);
  if (q === 0) return { mensagens: [], q: 0, fim: false, ultimo: null, falar: falasDaAbertura() };

  const mensagens: Mensagem[] = [msg("janete", INTRO[0]), msg("janete", INTRO[1])];
  let ultimo: CampoContexto | null = null;
  for (let i = 0; i < q; i++) {
    const p = ROTEIRO[i]!;
    const texto = respostas[p.campo]!.trim();
    mensagens.push(msg("janete", p.pergunta), msg("eu", texto), msg("janete", p.reagir(texto)));
    ultimo = p.campo;
  }
  if (q >= TOTAL_PERGUNTAS) {
    mensagens.push(msg("janete", RESUMO_ABRE), msg("resumo"), msg("janete", FALA_EDITAR), msg("janete", PERGUNTA_FINAL));
    return { mensagens, q, fim: true, ultimo, falar: [] };
  }
  return { mensagens, q, fim: false, ultimo, falar: [ROTEIRO[q]!.pergunta] };
}
