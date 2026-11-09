import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
} from "react";
import { CircleCheck, Search } from "lucide-react";

import { type Classes } from "@/components/aipro/cx";

import { VistaArea } from "../AreaVazia";
import { MOTIVO_LONGO, nomeDoContato } from "../comum/LinhaConversa";
import type { ItemMenu } from "../comum/MenuSuspenso";
import { dataCurta, diasEntre, horaCurta } from "../comum/tempo";
import { ehUuid } from "../dados/abrirPorId";
import { useMensagens } from "../dados/conversa";
import { Carregando, ErroLeitura, Vazio } from "../dados/estados";
import {
  etapasNoInstante,
  useBuscaQuadro,
  useDesdeQuadro,
  useJaneteTrabalhando,
  useQuadro,
} from "../dados/kanban";
import { useDados, useModoDados } from "../dados/ProvedorDados";
import type { Erro, Resultado } from "../dados/tipos";
import { estaAguardando, etapasVisiveis } from "../exemplo/regras";
import { useTelaEstreita } from "../exemplo/telaEstreita";
import type { Conversa } from "../exemplo/tipos";
import { usePapel } from "../papel";
import { Card, IconeJaneteContorno, idAbrirCard, idCard, montarCard, type ContextoCard, type DadosCard } from "./Card";
import { Coluna, corDaEtapa, idColuna, idExpandir, idRecolher, idTrilho, nomeDaEtapa } from "./Coluna";
import { EtapaChat } from "./EtapaChat";
import { BarraKanban, EditarEtapas, ID_BUSCA, ID_REPLAY_TOCAR, ReplayKanban, type ItemDesde, type JaneteAoVivo } from "./Faixa";
import { GavetaLead } from "./GavetaLead";
import { NoCorpo } from "./NoCorpo";
import { PreviaCard, posicaoDaPrevia } from "./Previa";
import estilos from "./TelaKanban.module.css";

const s = estilos as Classes<
  | "kbRaiz"
  | "kbTela"
  | "kbAbas"
  | "kbAba"
  | "kbAbaConta"
  | "kbQuadro"
  | "kbFim"
  | "kbVazio"
  | "kbVazioIcone"
  | "kbVazioTitulo"
  | "kbLimpar"
  | "kbToast"
  | "kbSr"
>;

// O Kanban 2 · Sala de controle (rodada 2, a menos poluída), ligado ao banco pela camada de dados
// (useDados e dados/kanban.ts; no modo exemplo, o mesmo contrato em memória) e com as permissões de
// usePapel(). Uma linha de ferramentas (busca no servidor, um filtro, a Janete ao vivo, "Desde que você
// saiu" e, para o admin, "Editar etapas"); as etapas abertas em colunas e Ganho e Perdido (os últimos
// 30 dias, com o total) em trilhos que abrem; o card é a conversa. Mover: arrastar entre colunas
// (HTML5) ou "Mover para…" (teclado e celular). A Janete real também move: quando o movimento dela chega
// (tempo real), o card pousa na etapa nova e o "Mover para…" oferece "Desfazer" por 10 s (decisão 5:
// sem o "Manter aqui" na v1). Parar o mouse no card abre a prévia da conversa; clicar abre a gaveta do
// lead; expandir a etapa abre a etapa como chat. Com o mouse numa coluna, a ordem dela fica parada. No
// celular, uma etapa por vez, com abas.

/* ---------- constantes ---------- */

/** Sem "visto" guardado (a 1ª vez da pessoa no Kanban): o "Desde que você saiu" olha as últimas 24 h. */
export const SAIDA_SEM_VISTO_MIN = 24 * 60;
/** O "Desde que você saiu" olha no máximo 7 dias para trás (quem ficou longe muito tempo vê a última semana). */
export const SAIDA_MAX_DIAS = 7;
/** O voo do card movido e o pouso de quem foi movido. */
const VOO_MS = 900;
const POUSO_MS = 1300;
/** O "Desfazer" do movimento da Janete fica no menu "Mover para…" por 10 s (decisão 5). */
export const DESFAZER_JANETE_MS = 10_000;
/** A frase da Janete ao vivo sobre o que ela acabou de fazer vale por este tempo; depois, volta ao que ela faz agora. */
const VIVO_MS = 20_000;
const TOAST_MS = 6000;
/** O relógio comum dos cards (hora, espera, ativo, esfriando). */
const TIQUE_MS = 15_000;
/** A prévia do card: abre com o mouse parado e fecha com uma folga (dá tempo de ir até ela). */
const PREVIA_ABRE_MS = 600;
const PREVIA_FECHA_MS = 160;
/** Quantas mensagens a prévia mostra. */
const PREVIA_MENSAGENS = 5;

export type IdFiltro = "todos" | "aguardando" | "comigo" | "ativos" | "naolidas" | "frios";

const FILTROS: readonly { id: IdFiltro; texto: string }[] = [
  { id: "todos", texto: "Todas as conversas" },
  { id: "aguardando", texto: "Aguardando humano" },
  { id: "comigo", texto: "Comigo" },
  { id: "ativos", texto: "A Janete ativa agora" },
  { id: "naolidas", texto: "Não lidas" },
  { id: "frios", texto: "Esfriando" },
];

/* ---------- apoio ---------- */

const primeiro = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

/** O texto cortado em `n` caracteres, com reticências. */
const curto = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** Prefere menos movimento: sem o voo do card (o estado final aparece de uma vez). */
function reduzMovimento(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** O que a tela diz quando mover não dá certo (o banco e o exemplo devolvem os mesmos códigos). */
export const ERRO_MOVER: Partial<Record<Erro, string>> = {
  sem_permissao: "Não deu para mover: essa etapa está arquivada.",
  etapa_arquivada: "Não deu para mover: essa etapa está arquivada.",
  nao_encontrado: "Não deu para mover: esse lead não existe mais.",
  sem_acesso: "Não deu para mover: sua conta não tem acesso.",
  falha: "Não deu para mover esse lead. Verifique a internet e tente de novo.",
};

/** O dia da saída para a frase "Desde …": vazio hoje, "ontem" ou a data curta. */
function diaDaSaida(saida: number, agora: number): string {
  const d = diasEntre(saida, agora);
  return d <= 0 ? "" : d === 1 ? "ontem" : dataCurta(saida);
}

/** Um item do "Desde que você saiu", com o instante e o tipo (a régua do "Rever no quadro" usa). */
type ItemDesdeTela = ItemDesde & { em: number; tipo: "mover" | "passar" };

interface Toast {
  texto: string;
  desfazer?: (() => void) | undefined;
}

type CardTela = DadosCard & { conversa: Conversa; ordem: number };

type Props = {
  /** O relógio da tela (os testes fixam). Padrão: `Date.now`. */
  relogio?: (() => number) | undefined;
  /** Sem "visto" guardado, quantos minutos antes de agora o "Desde que você saiu" começa (os testes fixam). */
  saidaSemVistoMin?: number | undefined;
  /** O lead do endereço (`?contato=`, o "Ver no Kanban" dos Contatos): a gaveta dele abre ao chegar,
      como o clique no card. Um id que não existe é ignorado. */
  contatoDoEndereco?: string | undefined;
  /** A gaveta fechou com o `?contato` no endereço (ou o id não existe): a rota tira o parâmetro. */
  aoFecharContatoDoEndereco?: (() => void) | undefined;
};

/** A prévia do card com as últimas mensagens da conversa (dados/conversa.ts). */
function PreviaComMensagens(props: Omit<ComponentProps<typeof PreviaCard>, "mensagens">) {
  const m = useMensagens(props.dados.conversaId);
  const mensagens = useMemo(
    () => (m.dados ?? []).filter((x) => x.status !== "cancelada").slice(-PREVIA_MENSAGENS),
    [m.dados],
  );
  return <PreviaCard {...props} mensagens={mensagens} />;
}

export function TelaKanban({ relogio, saidaSemVistoMin = SAIDA_SEM_VISTO_MIN, contatoDoEndereco, aoFecharContatoDoEndereco }: Props) {
  const dados = useDados();
  const { acoes } = dados;
  const modo = useModoDados();
  const eu = dados.useEu();
  const { papel } = usePapel();
  const estreito = useTelaEstreita();
  const admin = eu.ehAdmin && papel === "admin";

  const relogioRef = useRef(relogio ?? (() => Date.now()));
  relogioRef.current = relogio ?? (() => Date.now());
  const [agora, setAgora] = useState(() => relogioRef.current());

  // "Desde que você saiu" (decisão 13): conta a partir do último "visto" da pessoa (o "Marcar como
  // visto" ou a última abertura do Kanban), guardado por pessoa em membros.vistos.kanban. Lido uma vez,
  // ao abrir; abrir já grava o novo "visto" (a próxima vez conta daqui).
  const [saida] = useState(() => {
    const ate = relogioRef.current();
    const visto = eu.membro.vistos.kanban ? Date.parse(eu.membro.vistos.kanban) : NaN;
    const desde = Number.isFinite(visto) ? visto : ate - saidaSemVistoMin * 60_000;
    return Math.max(desde, ate - SAIDA_MAX_DIAS * 86_400_000);
  });
  const saidaIso = useMemo(() => new Date(saida).toISOString(), [saida]);
  const gravouVisto = useRef(false);
  useEffect(() => {
    if (gravouVisto.current) return;
    gravouVisto.current = true;
    void acoes.marcarVisto("kanban");
  }, [acoes]);

  const etapasL = dados.useEtapas();
  const membrosL = dados.useMembros();
  const quadroL = useQuadro(etapasL.dados);
  const trabalhandoL = useJaneteTrabalhando();
  const desdeL = useDesdeQuadro(saidaIso, etapasL.dados);

  const [busca, setBusca] = useState("");
  const buscaL = useBuscaQuadro(busca);
  const [filtro, setFiltro] = useState<IdFiltro>("todos");
  const [menuDe, setMenuDe] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [focoEtapa, setFocoEtapa] = useState<string | null>(null);
  const [fimAberto, setFimAberto] = useState<string | null>(null);
  const [aba, setAba] = useState<string | null>(null);
  /** Quem moveu cada lead por último nesta sessão (só no rótulo do card para o leitor de tela). */
  const [rastros, setRastros] = useState<Record<string, string>>({});
  const [desfazJanete, setDesfazJanete] = useState<{ contatoId: string; de: string; para: string } | null>(null);
  const [pousou, setPousou] = useState<string | null>(null);
  const [voando, setVoando] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [etapasAberto, setEtapasAberto] = useState(false);
  const [replay, setReplay] = useState<{ tempo: number; tocando: boolean; marca: string | null } | null>(null);
  const [vistos, setVistos] = useState(0);
  const [vivo, setVivo] = useState<{ acao: string; alvo: string; falando: boolean; em: number } | null>(null);
  /** A coluna com o mouse em cima: a ordem dos cards fica parada (o card não pula sob o cursor). */
  const [congelada, setCongelada] = useState<{ etapaId: string; ordem: string[] } | null>(null);
  /** A prévia flutuante do card (o mouse parado nele), na posição da janela. */
  const [previa, setPrevia] = useState<{ contatoId: string; x: number; y: number } | null>(null);

  /* ---------- timers: todos limpos no unmount ---------- */
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const depois = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
    return t;
  }, []);
  useEffect(() => {
    const lista = timers.current;
    return () => {
      lista.forEach(clearTimeout);
      lista.clear();
    };
  }, []);

  // O relógio comum dos cards.
  useEffect(() => {
    const id = setInterval(() => setAgora(relogioRef.current()), TIQUE_MS);
    return () => clearInterval(id);
  }, []);

  /* ---------- o que a tela lê ---------- */

  const etapasTodas = useMemo(() => etapasL.dados ?? [], [etapasL.dados]);
  const etapas = useMemo(() => etapasVisiveis({ etapas: etapasTodas }), [etapasTodas]);
  const abertas = etapas.filter((e) => e.tipo === "aberta");
  const fins = etapas.filter((e) => e.tipo !== "aberta");
  const etapaPorId = useCallback((id: string) => etapasTodas.find((e) => e.id === id), [etapasTodas]);
  const nomeEtapaId = useCallback(
    (id: string) => {
      const e = etapaPorId(id);
      return e ? nomeDaEtapa(e) : "outra etapa";
    },
    [etapaPorId],
  );

  const linhas = useMemo(() => quadroL.dados?.linhas ?? [], [quadroL.dados]);
  const totaisFim = quadroL.dados?.totaisFim;
  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const linhaDe = useCallback((contatoId: string) => linhasRef.current.find((l) => l.contato.id === contatoId), []);
  const contatoDaConversa = useMemo(() => new Map(linhas.map((l) => [l.conversa.id, l.contato.id] as const)), [linhas]);
  const trabalhando = useMemo(() => trabalhandoL.dados ?? [], [trabalhandoL.dados]);
  const membros = useMemo(() => membrosL.dados ?? [], [membrosL.dados]);
  const desde = desdeL.dados;

  const ctx = useMemo<ContextoCard>(
    () => ({ etapas: etapasTodas, membros, euId: eu.membro.id, trabalhando }),
    [etapasTodas, membros, eu.membro.id, trabalhando],
  );

  const vendo = replay !== null;
  const etapaNoReplay = useMemo(
    () => (replay && desde ? etapasNoInstante(linhas, desde.historico, replay.tempo) : null),
    [linhas, desde, replay],
  );

  // Os cards de todas as conversas (com a etapa do instante, se está revendo o dia).
  const cards = useMemo(() => {
    const lista: CardTela[] = [];
    for (const l of linhas) {
      let etapaId = l.contato.etapa_id;
      if (etapaNoReplay) {
        const naquela = etapaNoReplay.get(l.contato.id);
        if (!naquela) continue;
        etapaId = naquela;
      }
      const d = montarCard(ctx, l, agora);
      const ordem = new Date(l.conversa.ultima_mensagem_em ?? l.conversa.criado_em).getTime();
      lista.push({ ...d, etapaId, conversa: l.conversa, ordem });
    }
    return lista;
  }, [linhas, ctx, agora, etapaNoReplay]);

  const passa = (c: CardTela, f: IdFiltro): boolean => {
    if (f === "aguardando") return estaAguardando(c.conversa);
    if (f === "comigo") return c.conversa.responsavel_id === eu.membro.id;
    if (f === "ativos") return c.ativo;
    if (f === "naolidas") return c.naoLidas > 0;
    if (f === "frios") return c.frio > 0;
    return true;
  };
  // A busca é no servidor (decisão 13): nome, empresa, nome do WhatsApp e o texto das mensagens, até 50
  // leads, com um atraso curto ao digitar. Enquanto a 1ª resposta não chega, o quadro fica como estava.
  const q = busca.trim();
  const casaBusca = (c: CardTela): boolean => !q || !buscaL.ids || buscaL.ids.has(c.contatoId);
  const filtrado = filtro !== "todos" || !!q;
  const vistosCards = cards.filter((c) => passa(c, filtro) && casaBusca(c));
  // A ordem da coluna: quem espera a equipe primeiro, depois a conversa mais recente. Com o mouse na
  // coluna, vale a ordem de quando ele entrou; quem chegou depois vai para o fim.
  const daEtapa = (etapaId: string) => {
    const lista = vistosCards
      .filter((c) => c.etapaId === etapaId)
      .sort((a, b) => Number(b.esperaS !== null) - Number(a.esperaS !== null) || b.ordem - a.ordem);
    if (congelada?.etapaId !== etapaId) return lista;
    const pos = new Map(congelada.ordem.map((id, i) => [id, i]));
    const fim = Number.MAX_SAFE_INTEGER;
    return lista.sort((a, b) => (pos.get(a.contatoId) ?? fim) - (pos.get(b.contatoId) ?? fim));
  };
  const congelar = (etapaId: string) => (sim: boolean) => {
    if (sim) setCongelada({ etapaId, ordem: daEtapa(etapaId).map((c) => c.contatoId) });
    else setCongelada((c) => (c?.etapaId === etapaId ? null : c));
  };
  const totalDaEtapa = (etapaId: string) => cards.filter((c) => c.etapaId === etapaId).length;

  const itensFiltro: ItemMenu[] = FILTROS.map((f) => {
    const n = cards.filter((c) => passa(c, f.id)).length;
    return { id: f.id, texto: f.texto, contador: n, tom: f.id === "aguardando" && n > 0 ? "atencao" : undefined };
  });

  /* ---------- "Desde que você saiu" ---------- */

  const desdeItens = useMemo<ItemDesdeTela[]>(() => {
    if (!desde) return [];
    const contatoDe = new Map(linhas.map((l) => [l.contato.id, l.contato] as const));
    const nome = (contatoId: string) => {
      const c = contatoDe.get(contatoId);
      return c ? nomeDoContato(c) : "um lead";
    };
    const itens: ItemDesdeTela[] = [];
    for (const h of desde.historico) {
      const em = new Date(h.criado_em).getTime();
      if (h.ator !== "janete" || em < saida) continue;
      const contato = contatoDe.get(h.contato_id);
      itens.push({
        id: h.id,
        em,
        tipo: "mover",
        hora: horaCurta(em),
        contatoId: h.contato_id,
        titulo: `Moveu ${nome(h.contato_id)} para ${nomeEtapaId(h.para_etapa_id)}`,
        // O motivo curto que a Janete deu (decisão 13); sem ele, o resumo dela ou de onde o lead saiu.
        motivo:
          desde.motivos[h.id] ??
          contato?.resumo_janete ??
          `Saiu de ${h.de_etapa_id ? nomeEtapaId(h.de_etapa_id) : "Novo"}.`,
      });
    }
    for (const ev of desde.passagens) {
      const em = new Date(ev.criado_em).getTime();
      if (em < saida) continue;
      const contatoId = contatoDaConversa.get(ev.conversa_id);
      if (!contatoId) continue;
      const motivo = ev.motivo ? MOTIVO_LONGO[ev.motivo] : "a Janete decidiu passar";
      itens.push({
        id: ev.id,
        em,
        tipo: "passar",
        hora: horaCurta(em),
        contatoId,
        titulo: `Passou ${nome(contatoId)} para a equipe`,
        motivo: `${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}.`,
      });
    }
    // do mais novo para o mais antigo (a régua do "Rever no quadro" ordena à parte, do mais antigo)
    return itens.sort((a, b) => b.em - a.em);
  }, [desde, linhas, saida, nomeEtapaId, contatoDaConversa]);

  const respostasDesde = desde?.respostas ?? 0;

  /* ---------- o voo (FLIP): o card sai de onde estava e assenta no lugar novo ---------- */

  const voo = useRef<{ contatoId: string; rect: DOMRect | null; ms: number; em: number } | null>(null);
  const medir = (contatoId: string) => document.getElementById(idCard(contatoId))?.getBoundingClientRect() ?? null;
  const prepararVoo = (contatoId: string, ms: number) => {
    voo.current = { contatoId, rect: medir(contatoId), ms, em: Date.now() };
  };
  useLayoutEffect(() => {
    const v = voo.current;
    if (!v) return;
    const el = document.getElementById(idCard(v.contatoId));
    // O voo que não aconteceu em 3 s (a releitura não veio) não vale mais.
    if (!el || !v.rect || reduzMovimento() || typeof el.animate !== "function" || Date.now() - v.em > 3000) {
      voo.current = null;
      return;
    }
    const r = el.getBoundingClientRect();
    const dx = v.rect.left - r.left;
    const dy = v.rect.top - r.top;
    // No banco, o card só muda de lugar quando a releitura chega: até lá, o voo espera.
    if (!dx && !dy) return;
    voo.current = null;
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(-2deg) scale(1.03)` },
        { transform: "translate(0, 0) rotate(0) scale(1)" },
      ],
      { duration: v.ms, easing: "cubic-bezier(0.65, 0, 0.35, 1)" },
    );
  });

  /* ---------- avisos ---------- */

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mostrarToast = useCallback(
    (t: Toast) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast(t);
      toastTimer.current = depois(() => setToast(null), TOAST_MS);
    },
    [depois],
  );
  const segurarToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
  };
  const soltarToast = () => {
    if (toast && !toastTimer.current) toastTimer.current = depois(() => setToast(null), 4000);
  };

  const marcarPouso = useCallback(
    (contatoId: string) => {
      setPousou(contatoId);
      depois(() => setPousou((p) => (p === contatoId ? null : p)), POUSO_MS);
    },
    [depois],
  );

  const focar = useCallback(
    (id: string, ms = 60) => {
      depois(() => document.getElementById(id)?.focus(), ms);
    },
    [depois],
  );

  /* ---------- a prévia do card (mouse parado 600 ms; fecha com 160 ms de folga) ---------- */

  const previaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pararTimerPrevia = () => {
    if (previaTimer.current) clearTimeout(previaTimer.current);
    previaTimer.current = null;
  };
  /** O que impede a prévia agora (lido na hora em que o timer dispara). */
  const semPreviaRef = useRef<(contatoId: string) => boolean>(() => true);
  const pedirPrevia = (contatoId: string) => {
    pararTimerPrevia();
    previaTimer.current = depois(() => {
      previaTimer.current = null;
      if (semPreviaRef.current(contatoId)) return;
      const el = document.getElementById(idCard(contatoId));
      if (!el) return;
      const pos = posicaoDaPrevia(el.getBoundingClientRect(), { largura: window.innerWidth, altura: window.innerHeight });
      setPrevia({ contatoId, ...pos });
    }, PREVIA_ABRE_MS);
  };
  const fecharPrevia = () => {
    pararTimerPrevia();
    previaTimer.current = depois(() => {
      previaTimer.current = null;
      setPrevia(null);
    }, PREVIA_FECHA_MS);
  };
  const fecharPreviaJa = () => {
    pararTimerPrevia();
    setPrevia(null);
  };

  // A prévia fica presa à janela: rolar o quadro (ou a página) fecha, menos a rolagem da própria prévia.
  useEffect(() => {
    if (!previa) return;
    const rolou = (ev: Event) => {
      if (ev.target instanceof Element && ev.target.closest("[data-previa]")) return;
      setPrevia(null);
    };
    window.addEventListener("scroll", rolou, true);
    return () => window.removeEventListener("scroll", rolou, true);
  }, [previa]);

  /* ---------- a pessoa move (arrastar ou "Mover para…") ---------- */

  const moverPorPessoa = async (contatoId: string, para: string, doMenu = false) => {
    setMenuDe(null);
    setArrastando(null);
    const contato = linhaDe(contatoId)?.contato;
    if (!contato || contato.etapa_id === para) return;
    const nome = primeiro(nomeDoContato(contato));
    if (replay) {
      mostrarToast({ texto: `Você está vendo o quadro de ${horaCurta(replay.tempo)}. Toque em "Voltar ao vivo" para mexer.` });
      return;
    }
    if (voando) {
      const quem = linhaDe(voando)?.contato;
      mostrarToast({ texto: `Espere a Janete terminar de mover ${quem ? primeiro(nomeDoContato(quem)) : "o lead"}.` });
      return;
    }
    const de = contato.etapa_id;
    prepararVoo(contatoId, 420);
    const r = await acoes.moverEtapa(contatoId, para);
    if (!r.ok) {
      voo.current = null;
      mostrarToast({ texto: ERRO_MOVER[r.erro] ?? "Não deu para mover esse lead." });
      return;
    }
    // a decisão da pessoa vale mais que o "Desfazer" da Janete sobre o mesmo lead
    setDesfazJanete((x) => (x?.contatoId === contatoId ? null : x));
    const hora = horaCurta(relogioRef.current());
    setRastros((m) => ({ ...m, [contatoId]: `Você moveu para cá às ${hora}` }));
    marcarPouso(contatoId);
    const etapaNome = nomeEtapaId(para);
    setAnuncio(`${nomeDoContato(contato)} foi para ${etapaNome}.`);
    mostrarToast({
      texto: `Você moveu ${nome} para ${etapaNome}.`,
      desfazer: () => {
        setToast(null);
        void (async () => {
          // O lead pode ter mudado de etapa depois (pela Janete ou pela gaveta): aí não volta sem avisar.
          const atual = linhaDe(contatoId)?.contato;
          if (!atual || atual.etapa_id !== para) {
            mostrarToast({ texto: `Não dá para desfazer: ${nome} já mudou de etapa.` });
            return;
          }
          const r2 = await acoes.moverEtapa(contatoId, de);
          if (!r2.ok) {
            mostrarToast({ texto: ERRO_MOVER[r2.erro] ?? "Não deu para desfazer esse movimento." });
            return;
          }
          marcarPouso(contatoId);
          setAnuncio(`${nomeDoContato(contato)} voltou para ${nomeEtapaId(de)}.`);
          focar(idAbrirCard(contatoId), 80);
        })();
      },
    });
    if (doMenu) focar(idAbrirCard(contatoId), 80);
  };

  const arrasteRef = useRef<string | null>(null);
  const comecarArraste = (contatoId: string) => (ev: DragEvent<HTMLElement>) => {
    if (vendo) {
      ev.preventDefault();
      return;
    }
    try {
      ev.dataTransfer?.setData("text/plain", contatoId);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
    } catch {
      /* alguns navegadores recusam setData fora do dragstart real */
    }
    setMenuDe(null);
    fecharPreviaJa();
    // O estado vem depois do dragstart: o navegador tira a "foto" do card para a cópia que segue o
    // ponteiro logo depois deste evento, e o `data-arrastando` esconde o conteúdo (a cópia sairia vazia).
    arrasteRef.current = contatoId;
    depois(() => {
      if (arrasteRef.current === contatoId) setArrastando(contatoId);
    }, 0);
  };

  const terminarArraste = () => {
    arrasteRef.current = null;
    setArrastando(null);
  };

  const soltarEm = (etapaId: string) => (idDoArraste: string | null) => {
    const id = idDoArraste || arrasteRef.current || arrastando;
    terminarArraste();
    if (id) void moverPorPessoa(id, etapaId);
  };

  /* ---------- a Janete real move ou passa para a equipe: chega pelo tempo real ---------- */

  // Os movimentos e passagens que já estavam lá quando o Kanban abriu não animam; os que chegam
  // depois, sim: o card pousa na etapa nova (o banco já moveu), a Janete ao vivo diz o que ela fez e o
  // "Mover para…" do card oferece "Desfazer" por 10 s (decisão 5).
  const conhecidos = useRef<Set<string> | null>(null);
  const chegouMovimento = useCallback(
    (h: { contato_id: string; de_etapa_id: string | null; para_etapa_id: string }) => {
      const contato = linhaDe(h.contato_id)?.contato;
      const nome = contato ? nomeDoContato(contato) : "um lead";
      const para = nomeEtapaId(h.para_etapa_id);
      const hora = horaCurta(relogioRef.current());
      setRastros((m) => ({ ...m, [h.contato_id]: `A Janete moveu para cá às ${hora}` }));
      setVoando(h.contato_id);
      depois(() => setVoando((v) => (v === h.contato_id ? null : v)), VOO_MS);
      marcarPouso(h.contato_id);
      setVivo({ acao: `Moveu ${primeiro(nome)} para`, alvo: para, falando: false, em: relogioRef.current() });
      if (h.de_etapa_id) {
        const d = { contatoId: h.contato_id, de: h.de_etapa_id, para: h.para_etapa_id };
        setDesfazJanete(d);
        depois(() => setDesfazJanete((x) => (x?.contatoId === d.contatoId && x.para === d.para ? null : x)), DESFAZER_JANETE_MS);
        setAnuncio(`A Janete moveu ${nome} para ${para}. Dá para desfazer por 10 segundos, no botão Mover para do card.`);
      } else {
        setAnuncio(`A Janete moveu ${nome} para ${para}.`);
      }
    },
    [depois, linhaDe, marcarPouso, nomeEtapaId],
  );
  const chegouPassagem = useCallback(
    (conversaId: string) => {
      const contato = linhasRef.current.find((l) => l.conversa.id === conversaId)?.contato;
      if (!contato) return;
      setVivo({ acao: "Chamou a equipe para", alvo: nomeDoContato(contato), falando: true, em: relogioRef.current() });
    },
    [],
  );
  useEffect(() => {
    if (!desde) return;
    const ids = [...desde.historico.map((h) => h.id), ...desde.passagens.map((p) => p.id)];
    if (!conhecidos.current) {
      conhecidos.current = new Set(ids);
      return;
    }
    const vistosAntes = conhecidos.current;
    const novosMov = desde.historico.filter((h) => !vistosAntes.has(h.id));
    const novasPass = desde.passagens.filter((p) => !vistosAntes.has(p.id));
    for (const id of ids) vistosAntes.add(id);
    const ultimoDaJanete = novosMov.filter((h) => h.ator === "janete").at(-1);
    if (ultimoDaJanete) chegouMovimento(ultimoDaJanete);
    const ultimaPassagem = novasPass.at(-1);
    if (ultimaPassagem && !ultimoDaJanete) chegouPassagem(ultimaPassagem.conversa_id);
  }, [desde, chegouMovimento, chegouPassagem]);

  const desfazerJanete = async (contatoId: string) => {
    const d = desfazJanete;
    if (!d || d.contatoId !== contatoId) return;
    setDesfazJanete(null);
    setMenuDe(null);
    const contato = linhaDe(contatoId)?.contato;
    if (!contato) return;
    if (contato.etapa_id !== d.para) {
      mostrarToast({ texto: `Não dá para desfazer: ${primeiro(nomeDoContato(contato))} já mudou de etapa.` });
      return;
    }
    prepararVoo(contatoId, 420);
    const r = await acoes.moverEtapa(contatoId, d.de);
    if (!r.ok) {
      voo.current = null;
      mostrarToast({ texto: ERRO_MOVER[r.erro] ?? "Não deu para desfazer esse movimento." });
      return;
    }
    const hora = horaCurta(relogioRef.current());
    setRastros((m) => ({ ...m, [contatoId]: `Você desfez o movimento da Janete às ${hora}` }));
    marcarPouso(contatoId);
    setAnuncio(`${nomeDoContato(contato)} voltou para ${nomeEtapaId(d.de)}.`);
    focar(idAbrirCard(contatoId), 80);
  };

  /* ---------- "Rever no quadro": o quadro volta ao horário escolhido ---------- */

  const marcasReplay = useMemo(
    () => desdeItens.map((d) => ({ em: d.em, tipo: d.tipo, contatoId: d.contatoId })).sort((a, b) => a.em - b.em),
    [desdeItens],
  );

  const irPara = useCallback(
    (tempo: number, tocando: boolean) => {
      const marca = marcasReplay.find((m) => m.em === tempo);
      setReplay({ tempo, tocando, marca: marca?.contatoId ?? null });
      if (marca) marcarPouso(marca.contatoId);
    },
    [marcasReplay, marcarPouso],
  );

  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pararTimerReplay = () => {
    if (replayTimer.current) clearTimeout(replayTimer.current);
    replayTimer.current = null;
  };
  useEffect(() => () => pararTimerReplay(), []);

  const saidaDia = diaDaSaida(saida, agora);
  const saidaFrase = `${saidaDia ? `${saidaDia}, ` : ""}às ${horaCurta(saida)}`;

  const voltarAoVivo = useCallback(
    (fimNatural = false) => {
      pararTimerReplay();
      setReplay(null);
      if (fimNatural) mostrarToast({ texto: `Pronto. Esse foi o trabalho da Janete desde ${saidaFrase}.` });
      focar("kb-btn-desde", 60);
    },
    [focar, mostrarToast, saidaFrase],
  );

  const tocarDe = useCallback(
    (desdeMs: number) => {
      pararTimerReplay();
      const passoMs = reduzMovimento() ? 1000 : 2000;
      const andar = (de: number) => {
        const prox = marcasReplay.find((m) => m.em > de);
        if (!prox) {
          setReplay((r) => (r ? { ...r, tempo: relogioRef.current(), tocando: false, marca: null } : r));
          replayTimer.current = setTimeout(() => voltarAoVivo(true), 900);
          return;
        }
        irPara(prox.em, true);
        replayTimer.current = setTimeout(() => andar(prox.em), passoMs);
      };
      setReplay((r) => (r ? { ...r, tocando: true } : r));
      replayTimer.current = setTimeout(() => andar(desdeMs), 300);
    },
    [irPara, marcasReplay, voltarAoVivo],
  );

  const rever = () => {
    if (voando || !desde) return;
    setVistos(desdeItens.length);
    setFiltro("todos");
    setBusca("");
    setMenuDe(null);
    setFocoEtapa(null);
    setAberto(null);
    fecharPreviaJa();
    setReplay({ tempo: saida, tocando: false, marca: null });
    tocarDe(saida);
    // o foco vai para o tocar e pausar (o anel do botão), não para a faixa inteira
    focar(ID_REPLAY_TOCAR, 80);
  };

  const pausarReplay = () => {
    pararTimerReplay();
    setReplay((r) => (r ? { ...r, tocando: false } : r));
  };

  const marcarVisto = () => {
    // Sem a leitura do período, marcar como visto perderia o que a Janete fez (o painel nem mostra o botão).
    if (!desde) return;
    setVistos(desdeItens.length);
    void acoes.marcarVisto("kanban");
  };

  /* ---------- a Janete ao vivo: o que a Janete real faz (sem roteiro simulado) ---------- */

  const aoVivo: JaneteAoVivo = (() => {
    if (replay) {
      const m = marcasReplay.find((x) => x.em === replay.tempo);
      const item = m ? desdeItens.find((d) => d.contatoId === m.contatoId && d.em === m.em) : undefined;
      return {
        olho: "Revendo o dia",
        acao: `Às ${horaCurta(replay.tempo)},`,
        alvo: item ? item.titulo.replace(/^Moveu/, "a Janete moveu").replace(/^Passou/, "a Janete passou") : "o quadro estava assim",
        falando: false,
      };
    }
    // O que ela acabou de fazer (mover, chamar a equipe) fica uns segundos; depois, o que ela faz agora.
    if (vivo && agora - vivo.em < VIVO_MS) return { olho: "Janete ao vivo", acao: vivo.acao, alvo: vivo.alvo, falando: vivo.falando };
    const emTrabalho = linhas.find((l) => l.conversa.modo === "janete" && trabalhando.includes(l.conversa.id));
    if (emTrabalho) return { olho: "Janete ao vivo", acao: "Escrevendo para", alvo: nomeDoContato(emTrabalho.contato), falando: true };
    const comJanete = cards.filter((c) => c.selo === "janete" && abertas.some((e) => e.id === c.etapaId)).length;
    return { olho: "Janete ao vivo", acao: "Acompanhando", alvo: `${comJanete} ${comJanete === 1 ? "conversa" : "conversas"}`, falando: false };
  })();
  // A frase do que ela acabou de fazer sai sozinha, sem esperar o próximo tique do relógio.
  useEffect(() => {
    if (!vivo) return;
    const t = setTimeout(() => setAgora(relogioRef.current()), VIVO_MS + 50);
    return () => clearTimeout(t);
  }, [vivo]);

  /* ---------- o que muda na tela ---------- */

  // A aba do celular: a escolhida, ou a primeira etapa.
  const abaAtual = aba && etapas.some((e) => e.id === aba) ? aba : (etapas[0]?.id ?? null);

  // No celular, o quadro é um carrossel (o `.quadro` com scroll-snap do protótipo): todas as etapas lado a
  // lado, uma por tela. Deslizar troca a aba ativa; tocar na aba rola até a etapa.
  const quadroRef = useRef<HTMLDivElement>(null);
  /** A etapa para onde a aba mandou rolar: até chegar lá, a rolagem não troca a aba (sem pisca-pisca). */
  const alvoAba = useRef<string | null>(null);
  const irAba = (id: string) => {
    setAba(id);
    alvoAba.current = id;
    depois(() => {
      if (alvoAba.current === id) alvoAba.current = null;
    }, 700);
    document
      .getElementById(idColuna(id))
      ?.scrollIntoView?.({ inline: "start", block: "nearest", behavior: reduzMovimento() ? "auto" : "smooth" });
  };
  const rolarQuadro = () => {
    const el = quadroRef.current;
    const col = el?.firstElementChild;
    if (!el || !col) return;
    const passo = col.getBoundingClientRect().width + 12;
    if (passo <= 12) return;
    const i = Math.max(0, Math.min(etapas.length - 1, Math.round(el.scrollLeft / passo)));
    const id = etapas[i]?.id;
    if (!id) return;
    if (alvoAba.current) {
      if (alvoAba.current === id) alvoAba.current = null;
      return;
    }
    if (id !== abaAtual) setAba(id);
  };

  // O "Ver no Kanban" dos Contatos (`?contato=`): a gaveta do lead abre ao chegar, uma vez por endereço,
  // depois que o quadro carrega. Para o card estar à vista atrás da gaveta e receber o foco ao fechar, o
  // trilho de Ganho ou Perdido abre e, no celular, o carrossel vai direto para a etapa do lead (sem a
  // rolagem suave e a trava do irAba: a gaveta cobre o quadro). O lead fora do quadro (em Ganho ou
  // Perdido há mais de 30 dias) abre na gaveta do mesmo jeito, que lê o contato do banco; um id que não
  // existe (contato apagado) só pede para a rota limpar o endereço. A guarda `tratadoDoEndereco` é para o
  // StrictMode, que no desenvolvimento roda o efeito duas vezes ao montar.
  const quadroPronto = !!quadroL.dados;
  const tratadoDoEndereco = useRef<string | null>(null);
  const fecharEndereco = useRef(aoFecharContatoDoEndereco);
  fecharEndereco.current = aoFecharContatoDoEndereco;
  useEffect(() => {
    if (!contatoDoEndereco) {
      tratadoDoEndereco.current = null;
      return;
    }
    if (tratadoDoEndereco.current === contatoDoEndereco || !quadroPronto) return;
    tratadoDoEndereco.current = contatoDoEndereco;
    const contato = linhaDe(contatoDoEndereco)?.contato;
    if (!contato) {
      if (modo === "banco" && ehUuid(contatoDoEndereco)) {
        setMenuDe(null);
        fecharPreviaJa();
        setAberto(contatoDoEndereco);
      } else {
        fecharEndereco.current?.();
      }
      return;
    }
    const etapa = etapaPorId(contato.etapa_id);
    if (estreito) {
      setAba(contato.etapa_id);
      document.getElementById(idColuna(contato.etapa_id))?.scrollIntoView?.({ inline: "start", block: "nearest" });
    } else if (etapa && etapa.tipo !== "aberta") {
      setFimAberto(etapa.id);
    }
    setMenuDe(null);
    fecharPreviaJa();
    setAberto(contato.id);
    // Só a troca do endereço (ou o quadro chegando) abre de novo: os dados e a largura mudando não (o
    // fecharPreviaJa é uma função da renderização, sem estado próprio).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contatoDoEndereco, quadroPronto]);

  // Ver como atendente fecha a caixa de etapas (só o admin edita).
  useEffect(() => {
    if (!admin) setEtapasAberto(false);
  }, [admin]);

  // Quantos leads cada etapa tem (arquivar só vazia): as abertas inteiras estão no quadro; Ganho e
  // Perdido, pelo total de todas as datas.
  const leadsPorEtapa = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of linhas) m[l.contato.etapa_id] = (m[l.contato.etapa_id] ?? 0) + 1;
    for (const [id, n] of Object.entries(totaisFim ?? {})) m[id] = Math.max(n, m[id] ?? 0);
    return m;
  }, [linhas, totaisFim]);

  const opcoes = etapas.map((e) => ({ id: e.id, nome: nomeDaEtapa(e), cor: corDaEtapa(e) }));

  const renderCard = (c: CardTela, compacto: boolean) => {
    const dn = desfazJanete?.contatoId === c.contatoId && !vendo ? desfazJanete : null;
    return (
      <Card
        key={c.contatoId}
        dados={c}
        compacto={compacto}
        rastro={rastros[c.contatoId] ?? null}
        // Decisão 5: na v1, sem a janela de veto ("Manter aqui"): a Janete real move na hora.
        decisao={null}
        menuAberto={menuDe === c.contatoId}
        aoAlternarMenu={() => {
          fecharPreviaJa();
          setMenuDe((m) => (m === c.contatoId ? null : c.contatoId));
        }}
        opcoes={opcoes}
        aoMover={(para) => void moverPorPessoa(c.contatoId, para, true)}
        desfazerPara={dn ? nomeEtapaId(dn.de) : null}
        aoDesfazer={dn ? () => void desfazerJanete(c.contatoId) : undefined}
        aoAbrir={() => {
          setMenuDe(null);
          fecharPreviaJa();
          setAberto(c.contatoId);
        }}
        arrastavel={!vendo && !estreito}
        aoComecarArraste={comecarArraste(c.contatoId)}
        aoTerminarArraste={terminarArraste}
        arrastando={arrastando === c.contatoId}
        pousou={pousou === c.contatoId}
        voando={voando === c.contatoId}
        aoEntrar={estreito ? undefined : () => pedirPrevia(c.contatoId)}
        aoSair={estreito ? undefined : fecharPrevia}
      />
    );
  };

  const coluna = (etapaId: string, fim: boolean) => {
    const e = etapaPorId(etapaId)!;
    const lista = daEtapa(e.id);
    const fechado = fim && !estreito && fimAberto !== e.id;
    const total = totalDaEtapa(e.id);
    // Ganho e Perdido: os últimos 30 dias, com o total de todas as datas ao lado (decisão 13).
    const totalFim = e.tipo !== "aberta" && totaisFim ? Math.max(totaisFim[e.id] ?? 0, total) : undefined;
    return (
      <Coluna
        key={e.id}
        etapa={e}
        mostrados={lista.length}
        total={total}
        totalGeral={vendo ? undefined : totalFim}
        filtrado={filtrado}
        fim={fim}
        fechado={fechado}
        aoAbrirTrilho={() => {
          setFimAberto(e.id);
          // O foco vai para "Recolher" sem rolar; depois da abertura (420 ms), a coluna aberta rola para
          // a vista, para o contador, as horas e os selos dos cards não ficarem cortados à direita.
          depois(() => document.getElementById(idRecolher(e.id))?.focus({ preventScroll: true }), 80);
          depois(
            () =>
              document
                .getElementById(idColuna(e.id))
                ?.scrollIntoView?.({ inline: "end", block: "nearest", behavior: reduzMovimento() ? "auto" : "smooth" }),
            440,
          );
        }}
        aoRecolher={
          fim && !estreito
            ? () => {
                setFimAberto(null);
                focar(idTrilho(e.id), 80);
              }
            : undefined
        }
        aoExpandir={() => {
          setMenuDe(null);
          fecharPreviaJa();
          setFocoEtapa(e.id);
          // o botão de expandir some junto com o quadro: o foco vai para "Voltar ao quadro"
          focar("kb-foco-voltar", 80);
        }}
        aoSoltar={vendo ? undefined : soltarEm(e.id)}
        arrastoAtivo={!!arrastando}
        aoCongelar={estreito ? undefined : congelar(e.id)}
      >
        {lista.map((c) => renderCard(c, fim))}
      </Coluna>
    );
  };

  const semResultado = filtrado && vistosCards.length === 0;
  const limpar = () => {
    setBusca("");
    setFiltro("todos");
    // o botão some junto com o aviso: o foco vai para a busca
    focar(ID_BUSCA, 40);
  };

  // A prévia: só no computador, sem nada aberto por cima, e com o card ainda à vista.
  semPreviaRef.current = (id: string) =>
    !!(arrasteRef.current || arrastando || menuDe === id || aberto || focoEtapa || estreito || etapasAberto);
  const cardDaPrevia = previa && !semPreviaRef.current(previa.contatoId) ? vistosCards.find((c) => c.contatoId === previa.contatoId) : undefined;
  const etapaDaPrevia = cardDaPrevia ? etapaPorId(cardDaPrevia.etapaId) : undefined;

  const assumirPelaPrevia = async (c: DadosCard) => {
    fecharPreviaJa();
    setAberto(c.contatoId);
    const r: Resultado = await acoes.assumir(c.conversaId);
    if (r.ok) setAnuncio(`Você assumiu a conversa com ${c.nome}.`);
    else mostrarToast({ texto: "Não deu para assumir essa conversa. Tente de novo pela conversa." });
  };

  // A barra fica também com a etapa aberta como chat (como no protótipo): a busca e o filtro valem para a
  // lista da etapa.
  const barra = (
    <BarraKanban
      busca={busca}
      aoBuscar={setBusca}
      filtro={filtro}
      itensFiltro={itensFiltro}
      aoFiltrar={(id) => setFiltro(id as IdFiltro)}
      estreito={estreito}
      aoVivo={aoVivo}
      desde={{
        saida: horaCurta(saida),
        saidaDia,
        itens: desdeItens,
        novos: Math.max(0, desdeItens.length - vistos),
        respostas: respostasDesde,
        movidos: desdeItens.filter((d) => d.tipo === "mover").length,
        passados: desdeItens.filter((d) => d.tipo === "passar").length,
        reverBloqueado: !!voando || !desde,
        // Sem os dados do período: o esqueleto ou o erro (com Tentar de novo), nunca os zeros.
        carregando: !desde && !desdeL.erro,
        erro: desde ? null : desdeL.erro,
        tentarDeNovo: desdeL.tentarDeNovo,
      }}
      aoAbrirLead={(id) => setAberto(id)}
      aoRever={rever}
      aoMarcarVisto={marcarVisto}
      ehAdmin={admin}
      aoEditarEtapas={() => {
        setMenuDe(null);
        fecharPreviaJa();
        setEtapasAberto(true);
      }}
    />
  );
  const visiveisNaEtapa = filtrado ? new Set(vistosCards.map((c) => c.contatoId)) : null;

  // Os 3 estados: carregando (o osso das colunas), erro (com Tentar de novo) e o quadro vazio.
  // Com o quadro na tela, a releitura que falha (o React Query guarda os dados) vira um aviso compacto
  // em cima, e os cards ficam; o erro que toma a tela é só o de quando ainda não há quadro.
  const erroQuadro = (etapasL.dados ? null : etapasL.erro) ?? (quadroL.dados ? null : quadroL.erro);
  const erroReleitura = erroQuadro ? null : (etapasL.erro ?? quadroL.erro);
  const carregandoQuadro = !erroQuadro && (etapasL.carregando || quadroL.carregando || !quadroL.dados);
  const quadroVazio = !erroQuadro && !carregandoQuadro && linhas.length === 0;
  const avisoReleitura = erroReleitura ? (
    <ErroLeitura
      titulo="Não deu para atualizar o quadro"
      erro={erroReleitura}
      tentarDeNovo={() => {
        if (etapasL.erro) etapasL.tentarDeNovo();
        if (quadroL.erro) quadroL.tentarDeNovo();
      }}
      compacto
    />
  ) : null;

  let conteudo;
  if (erroQuadro) {
    conteudo = (
      <ErroLeitura
        titulo="Não deu para carregar o quadro"
        erro={erroQuadro}
        tentarDeNovo={() => {
          if (etapasL.erro) etapasL.tentarDeNovo();
          quadroL.tentarDeNovo();
        }}
      />
    );
  } else if (carregandoQuadro) {
    conteudo = <Carregando forma="cartao" quantos={4} rotulo="Carregando o quadro" />;
  } else if (etapas.length === 0) {
    // As etapas vieram vazias (o remix sem os dados iniciais): sem colunas, um vazio que explica.
    conteudo = (
      <Vazio
        oQueFalta="Nenhuma etapa configurada"
        porQueImporta="Sem as etapas do funil, o quadro não tem colunas para mostrar os leads. Um admin precisa conferir as etapas."
        acao={null}
        compacto
      />
    );
  } else if (q && buscaL.erro) {
    conteudo = <ErroLeitura titulo="Não deu para buscar agora" erro={buscaL.erro} tentarDeNovo={buscaL.tentarDeNovo} compacto />;
  } else if (semResultado && !(q && buscaL.buscando && !buscaL.ids)) {
    conteudo = (
      <div className={s.kbVazio}>
        <Search className={s.kbVazioIcone} aria-hidden="true" size={22} strokeWidth={2} />
        <h2 className={s.kbVazioTitulo}>
          {q ? `Nenhuma conversa com “${curto(q, 40)}”` : "Nenhuma conversa neste filtro"}
        </h2>
        <p>Confira o nome ou tire o filtro. A busca olha o nome, a empresa e o texto das mensagens.</p>
        <button type="button" className={s.kbLimpar} onClick={limpar}>
          Limpar busca e filtros
        </button>
      </div>
    );
  } else {
    conteudo = (
      <>
        {quadroVazio ? (
          <Vazio
            oQueFalta="Nenhum lead no quadro ainda"
            porQueImporta="Quando um lead escrever no WhatsApp, a conversa aparece em Novo e a Janete começa a atender."
            acao={null}
            compacto
          />
        ) : null}
        {estreito ? (
          <div className={s.kbQuadro} data-carrossel="" ref={quadroRef} onScroll={rolarQuadro}>
            {etapas.map((e) => coluna(e.id, false))}
          </div>
        ) : (
          <div className={s.kbQuadro}>
            {abertas.map((e) => coluna(e.id, false))}
            {fins.length ? (
              <div className={s.kbFim} data-aberta={fimAberto && fins.some((e) => e.id === fimAberto) ? "" : undefined}>
                {fins.map((e) => coluna(e.id, true))}
              </div>
            ) : null}
          </div>
        )}
      </>
    );
  }

  return (
    // O h1 da área fica só para o leitor de tela (como no protótipo e no Chat): o quadro sobe ~100 px.
    <div className={s.kbRaiz}>
    <VistaArea area="kanban">
      <div className={s.kbTela} data-revendo={vendo || undefined} aria-busy={carregandoQuadro || undefined}>
        {focoEtapa ? (
          <>
            {barra}
            <EtapaChat
              etapaId={focoEtapa}
              mostrar={visiveisNaEtapa ? (id) => visiveisNaEtapa.has(id) : undefined}
              aoVoltar={() => {
                const id = focoEtapa;
                const e = etapaPorId(id);
                setFocoEtapa(null);
                // O foco volta para quem abriu: no celular, a aba da etapa passa a ser a dela; Ganho e
                // Perdido com o trilho fechado voltam para o trilho.
                if (estreito) {
                  setAba(id);
                  focar(idExpandir(id), 60);
                } else if (e && e.tipo !== "aberta" && fimAberto !== id) {
                  focar(idTrilho(id), 60);
                } else {
                  focar(idExpandir(id), 60);
                }
              }}
              aoTrocarEtapa={(id) => setFocoEtapa(id)}
            />
          </>
        ) : (
          <>
            {replay ? (
              // Sem tabIndex: o foco fica no tocar e pausar; o Esc sobe dos controles da régua até aqui.
              <div
                id="kb-replay"
                onKeyDown={(ev) => {
                  // Esc sai do "Rever no quadro" e volta ao vivo
                  if (ev.key === "Escape" && !ev.defaultPrevented) {
                    ev.preventDefault();
                    voltarAoVivo(false);
                  }
                }}
              >
                <ReplayKanban
                  hora={horaCurta(replay.tempo)}
                  texto={replay.tocando ? "Revendo as decisões da Janete" : "Arraste ou use as setas para andar de decisão em decisão"}
                  tocando={replay.tocando}
                  aoTocar={() => (replay.tocando ? pausarReplay() : tocarDe(replay.tempo))}
                  min={0}
                  max={Math.max(1, Math.round((agora - saida) / 60_000))}
                  valor={Math.round((replay.tempo - saida) / 60_000)}
                  marcas={marcasReplay.map((m) => ({ em: Math.round((m.em - saida) / 60_000), tipo: m.tipo }))}
                  aoMudar={(v) => {
                    pausarReplay();
                    irPara(saida + v * 60_000, false);
                  }}
                  aoPasso={(dir) => {
                    pausarReplay();
                    const alvo =
                      dir > 0 ? marcasReplay.find((m) => m.em > replay.tempo) : [...marcasReplay].reverse().find((m) => m.em < replay.tempo);
                    irPara(alvo ? alvo.em : dir > 0 ? relogioRef.current() : saida, false);
                  }}
                  aoVoltar={() => voltarAoVivo(false)}
                  pontas={[horaCurta(saida), "agora"]}
                />
              </div>
            ) : null}

            {barra}

            {avisoReleitura}

            {estreito && !erroQuadro && !carregandoQuadro ? (
              <div className={s.kbAbas} role="group" aria-label="Etapas">
                {etapas.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={s.kbAba}
                    aria-pressed={e.id === abaAtual}
                    onClick={() => irAba(e.id)}
                  >
                    {e.janete_pode_mover ? <IconeJaneteContorno /> : null}
                    <span>{nomeDaEtapa(e)}</span>
                    <span className={s.kbAbaConta}>{filtrado ? daEtapa(e.id).length : totalDaEtapa(e.id)}</span>
                    {e.janete_pode_mover ? <span className={s.kbSr}>, a Janete pode mover leads para cá</span> : null}
                  </button>
                ))}
              </div>
            ) : null}

            {conteudo}
          </>
        )}

        <GavetaLead
          contatoId={aberto}
          aoFechar={() => {
            const id = aberto;
            setAberto(null);
            // aberta pelo endereço (ou não), o `?contato` não fica para trás: recarregar não reabre
            if (contatoDoEndereco) aoFecharContatoDoEndereco?.();
            if (!id) return;
            // O card rola inteiro para a vista (o trilho de Ganho ou Perdido aberto pelo endereço fica cortado
            // à direita entre ~900 e ~1.500 px) e recebe o foco. Sem o card à vista (apagado, fora do filtro,
            // no trilho fechado, revendo o quadro ou com a etapa aberta como chat), o foco vai para a busca.
            depois(() => {
              document.getElementById(idCard(id))?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
              (document.getElementById(idAbrirCard(id)) ?? document.getElementById(ID_BUSCA))?.focus();
            }, 60);
          }}
        />

        {/* O que flutua vai para o body (NoCorpo): a `.vista` anima `transform` e prenderia o `fixed`. */}
        <NoCorpo>
          {etapasAberto && admin ? (
            <EditarEtapas
              etapas={etapasTodas}
              leadsPorEtapa={leadsPorEtapa}
              acoes={acoes}
              aoFechar={() => {
                setEtapasAberto(false);
                focar("kb-btn-etapas", 60);
              }}
            />
          ) : null}

          {toast ? (
            <div
              className={s.kbToast}
              role="status"
              onMouseEnter={segurarToast}
              onMouseLeave={soltarToast}
              onFocus={segurarToast}
              onBlur={soltarToast}
            >
              <CircleCheck aria-hidden="true" size={18} strokeWidth={2} />
              <span>{toast.texto}</span>
              {toast.desfazer ? (
                <button type="button" onClick={toast.desfazer}>
                  Desfazer
                </button>
              ) : null}
            </div>
          ) : null}

          {cardDaPrevia && previa ? (
            <PreviaComMensagens
              dados={cardDaPrevia}
              x={previa.x}
              y={previa.y}
              podeAssumir={cardDaPrevia.esperaS !== null && !vendo && etapaDaPrevia?.tipo === "aberta"}
              aoAbrir={() => {
                fecharPreviaJa();
                setAberto(cardDaPrevia.contatoId);
              }}
              aoAssumir={() => void assumirPelaPrevia(cardDaPrevia)}
              aoFicar={pararTimerPrevia}
              aoSair={fecharPrevia}
            />
          ) : null}
        </NoCorpo>

        <p className={s.kbSr} role="status" aria-live="polite">
          {anuncio}
        </p>
      </div>
    </VistaArea>
    </div>
  );
}
