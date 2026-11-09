import { AREAS, areaVisivelPara, type AreaId } from "./areas";
import type { PapelMembro } from "./exemplo/tipos";

// O tour da Janete (o PARADAS, ITEM_TOP, posGuia e molduraDe do F), recalculado para as 7 áreas.

export interface Parada {
  rotulo: string;
  texto: string;
  /** A área que esta parada mostra (abre a rota dela). */
  area?: AreaId;
  /** Sem área: a vista que fica aberta (a última parada volta ao Chat). */
  vista?: AreaId;
}

export const PARADAS: readonly Parada[] = [
  {
    rotulo: "O menu",
    texto: "Este é o seu menu. Tudo o que eu faço por você fica nestas sete áreas. Vou mostrar cada uma.",
  },
  {
    area: "chat",
    rotulo: "Chat",
    texto:
      "Aqui você acompanha as conversas que estou tendo com os leads. Se quiser assumir uma, é só entrar na conversa.",
  },
  {
    area: "contatos",
    rotulo: "Contatos",
    texto: "Cada pessoa que fala comigo vira um contato aqui, com o que eu descobri sobre ela.",
  },
  {
    area: "kanban",
    rotulo: "Kanban",
    texto: "Aqui cada lead vira um cartão e anda de coluna conforme a conversa avança. Você vê de relance quem está perto de fechar.",
  },
  {
    area: "dashboard",
    rotulo: "Dashboard",
    texto: "Os números do atendimento: quantos leads chegaram, quantos eu atendi e quantos passei para a equipe.",
  },
  {
    area: "equipe",
    rotulo: "Equipe",
    texto: "Quem recebe os leads que eu passar. Aqui você convida a equipe e vê quem está atendendo agora.",
  },
  {
    area: "contexto",
    rotulo: "Contexto",
    texto: "É o que eu sei sobre a sua empresa, do jeito que você me contou.",
  },
  {
    area: "configuracao",
    rotulo: "Configuração",
    texto: "O WhatsApp, o cérebro e a chave que você escolheu ficam aqui.",
  },
  {
    rotulo: "Pronto",
    vista: "chat",
    texto:
      "Tudo pronto. Quando chegar o primeiro lead, eu te aviso. Se quiser falar comigo, estou aqui no canto, embaixo.",
  },
];

export const ULTIMA_PARADA = PARADAS.length - 1;

const POR_EXTENSO: Record<number, string> = { 6: "seis", 7: "sete" };

/** A fala da Equipe para o atendente, que não convida ninguém (spec da Equipe). */
const EQUIPE_ATENDENTE = "Quem recebe os leads que eu passar. Aqui você vê quem está atendendo agora.";

/**
 * As paradas do tour para o papel (spec, bloco 1, item 4, confirmado em 30/10): o atendente não vê a
 * Configuração, então o tour dele pula essa parada, e a 1ª fala conta as áreas que ele vê. Como a
 * Configuração é o último item do menu, as outras paradas não mudam de lugar. Na parada da Equipe, a
 * fala dele não promete convidar.
 */
export function paradasDoTour(papel: PapelMembro): readonly Parada[] {
  if (papel === "admin") return PARADAS;
  const paradas = PARADAS.filter((p) => !p.area || areaVisivelPara(p.area, papel));
  const n = paradas.filter((p) => p.area).length;
  return paradas.map((p, i) =>
    i === 0
      ? { ...p, texto: p.texto.replace("nestas sete áreas", `nestas ${POR_EXTENSO[n] ?? n} áreas`) }
      : p.area === "equipe"
        ? { ...p, texto: EQUIPE_ATENDENTE }
        : p,
  );
}

// Geometria da barra lateral (px, a partir do topo da plataforma): recheio 16, marca 40, vão 16,
// título de grupo 36 + 8, item 40 com vão 2, 16 entre grupos. "Atendimento" tem 5 itens
// (116 a 284, termina em 324); "Sua Janete" começa em 324 + 16 + 44 = 384. A posição de cada item é a
// do índice da área em AREAS (o menu do atendente só perde o último item).
export const ITEM_TOP = [116, 158, 200, 242, 284, 384, 426] as const;

const MOLDURA_MENU_TOPO = 66;

/** A altura da moldura do menu inteiro: até o fim do último item que o papel vê (+ 6). */
function alturaMolduraMenu(paradas: readonly Parada[]): number {
  const ultimo = paradas.reduce((m, p) => (p.area ? Math.max(m, AREAS.findIndex((a) => a.id === p.area)) : m), 0);
  return ITEM_TOP[ultimo]! + 40 + 6 - MOLDURA_MENU_TOPO; // 406 com as 7 áreas
}

/** O topo do item do menu que a parada mostra, ou `null` (o menu inteiro ou a área aberta). */
function topoDoItem(p: Parada | undefined): number | null {
  if (!p?.area) return null;
  const i = AREAS.findIndex((a) => a.id === p.area);
  return i >= 0 ? (ITEM_TOP[i] ?? null) : null;
}

export type EstadoTour = "ativo" | "casa" | "fora";

/** Onde fica o guia (a bolinha da Janete, 44 px). A casa dela é o canto inferior esquerdo. */
export function posGuia(
  parada: number,
  tour: EstadoTour,
  saindo: boolean,
  paradas: readonly Parada[] = PARADAS,
): { l: string; t: string } {
  if (tour === "casa" || saindo) return { l: "20px", t: "calc(100% - 64px)" };
  if (parada === 0) return { l: "248px", t: `${MOLDURA_MENU_TOPO + alturaMolduraMenu(paradas) / 2 - 22}px` };
  const topo = topoDoItem(paradas[parada]);
  if (topo !== null) return { l: "248px", t: `${topo - 2}px` };
  return { l: "calc(240px + (100% - 240px) / 2 - 22px)", t: "24%" };
}

/** A moldura azul em volta do que a parada mostra. */
export function molduraDe(
  parada: number,
  paradas: readonly Parada[] = PARADAS,
): { left: string; top: string; width: string; height: string } {
  if (parada === 0) {
    return { left: "6px", top: `${MOLDURA_MENU_TOPO}px`, width: "228px", height: `${alturaMolduraMenu(paradas)}px` };
  }
  const topo = topoDoItem(paradas[parada]);
  if (topo !== null) {
    return { left: "8px", top: `${topo - 4}px`, width: "224px", height: "48px" };
  }
  return { left: "256px", top: "84px", width: "calc(100% - 272px)", height: "calc(100% - 100px)" };
}

/* ---------- marcador "o tour já apareceu" (sessionStorage nesta onda) ---------- */

export const CHAVE_TOUR_VISTO = "janete:tour-visto:v1";

export function tourJaVisto(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(CHAVE_TOUR_VISTO) === "1";
  } catch {
    return false;
  }
}

/** Apaga o marcador (ao sair da conta: a próxima conta nesta aba vê o tour de novo). */
export function esquecerTour(): void {
  try {
    window.sessionStorage.removeItem(CHAVE_TOUR_VISTO);
  } catch {
    // sem sessionStorage: não há marcador para apagar
  }
}

export function marcarTourVisto(): void {
  try {
    window.sessionStorage.setItem(CHAVE_TOUR_VISTO, "1");
  } catch {
    // sem sessionStorage: o tour pode voltar a aparecer sozinho ao recarregar
  }
}

/* ---------- o tour uma vez por pessoa (decisão 15, spec de ligar as telas ao banco, 2.2) ---------- */

/**
 * O tour uma vez por pessoa (decisão 15), lembrado na conta: `membros.vistos.tour`, gravado por
 * `marcar_visto('tour')`. É o padrão da casca ligada ao banco; a regra da aba (o marcador do
 * sessionStorage e o onboarding concluído nesta aba) fica só para a casca do exemplo (os testes).
 */
export const TOUR_POR_PESSOA = true;

/** O que a casca precisa saber e fazer sobre o tour, venha o "visto" do banco ou da aba. */
export interface MarcadorTour {
  /** O tour já apareceu para esta pessoa (ou nesta aba, na regra de hoje). */
  visto: boolean;
  /** Pode começar sozinho ao abrir a plataforma (sem voo), se ainda não foi visto. */
  podeComecarSozinho: boolean;
  /** Grava que o tour apareceu. */
  marcar: () => void;
}

/**
 * O marcador do tour.
 * - Por pessoa (a casca ligada ao banco): visto = `vistos.tour` do Eu; começa sozinho uma vez para
 *   cada pessoa, admin ou atendente (o atendente nunca passa pelo onboarding); marcar grava no banco
 *   (`marcar_visto`) e, para recarregar antes de o Eu voltar não repetir o tour, também nesta aba.
 * - Pela aba (a casca do exemplo): visto = o marcador desta aba; começa sozinho só depois do
 *   onboarding concluído nesta aba.
 */
export function marcadorDoTour(
  opcoes:
    | { porPessoa: true; vistoEm: string | null | undefined; marcarNoBanco: () => void }
    | { porPessoa: false; onboardingConcluido: boolean },
): MarcadorTour {
  if (opcoes.porPessoa) {
    return {
      visto: !!opcoes.vistoEm || tourJaVisto(),
      podeComecarSozinho: true,
      marcar: () => {
        marcarTourVisto();
        opcoes.marcarNoBanco();
      },
    };
  }
  return { visto: tourJaVisto(), podeComecarSozinho: opcoes.onboardingConcluido, marcar: marcarTourVisto };
}
