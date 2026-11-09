import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { Building2, ChevronLeft, Clock, PanelRight, Smartphone, UserRound } from "lucide-react";

import { Botao } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";
import { iniciais } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { AvatarLead, corDoLead } from "../comum/AvatarLead";
import { Bolha, CITACAO_FORA, LoteMidias, idCitado, idUltimaEnviada, type AutorBolha, type CitacaoBolha } from "../comum/Bolha";
import { CaixaEscrever, type BloqueioCaixa, type CitandoCaixa, type FaixaCaixa, type NovaMensagem } from "../comum/CaixaEscrever";
import { PassagemConversa, SeparadorDia } from "../comum/EventoConversa";
import { ESPERA_LONGA_S, MOTIVO_CURTO, MOTIVOS_FALHA, nomeDoContato, resumoMensagem } from "../comum/LinhaConversa";
import { entraNaLinha, inicioDaLinha } from "../comum/linhaDoTempo";
import { erroDeReleitura, erroSemDados } from "../comum/releitura";
import { diaLocal, esperaLonga, rotuloDia, segundosDesde } from "../comum/tempo";
import { useDigitandoChat, useReconexaoDoExemplo } from "../dados/chat";
import { useContato, useConversa, useEventos, useMensagens } from "../dados/conversa";
import { Carregando, ErroLeitura } from "../dados/estados";
import { useDados, useModoDados } from "../dados/ProvedorDados";
import type { EventoConversaDados, MensagemDados, Resultado } from "../dados/tipos";
import { conexaoAtiva, janelaFechada, nomeDoMembro, seloDaConversa, type Membro, type MotivoHumano } from "../exemplo";
import { textoDoErroChat, type AcaoChat, type Avisar, type TomAviso } from "./aviso";
import { Bastao, type EstadoBastao } from "./Bastao";
import estilos from "./Conversa.module.css";

const s = estilos as Classes<
  | "cvRaiz"
  | "cvCab"
  | "cvId"
  | "cvVoltar"
  | "cvIdTxt"
  | "cvNome"
  | "cvEstado"
  | "cvEstA"
  | "cvEstB"
  | "cvAcoes"
  | "cvFicha"
  | "cvBastao"
  | "cvRolo"
  | "cvLista"
  | "cvDigita"
  | "cvDigitaQuem"
  | "cvDigitaEsp"
  | "cvDigitaBolha"
  | "cvEscrever"
  | "cvVazio"
  | "cvEstadoLeitura"
  | "cvMais"
  | "cvVeu"
  | "cvDialogo"
  | "cvDialogoTitulo"
  | "cvDialogoTexto"
  | "cvDialogoAcoes"
  | "sr"
>;

/* =============================================================================
   Contrato (plano das telas, task C2)
   ============================================================================= */

type Props = {
  conversaId: string;
  /** A ficha do lead está aberta (coluna ou gaveta): o botão do cabeçalho mostra o estado. */
  fichaAberta: boolean;
  onAlternarFicha(): void;
  /** Voltar para a lista (só no celular, onde a conversa ocupa a tela). */
  onVoltar?(): void;
  /**
   * O aviso curto da tela (o toast), para quem enxerga: só nos erros, no "Reconectado…" e no download
   * simulado. Sem ele, o aviso vai só para o leitor de tela. Usa um ou outro, nunca os dois: a tela
   * tem o próprio role=status.
   */
  avisar?: Avisar | undefined;
  /** O relógio da tela (ms). Sem ele, a conversa usa o próprio. */
  agora?: number;
  /**
   * A conversa abriu sozinha (a 1ª da lista, ao entrar no Chat, ou a próxima depois de apagar a aberta):
   * ninguém leu ainda. Ela só vira lida na 1ª interação dentro dela (clique, toque, roda do mouse, tecla
   * ou foco), e não ao montar. Abrir pela lista ou pelo endereço (?conversa=) é escolha de quem olha:
   * marca na hora. Quem passa adiarLida passa aoInteragir, que o desliga.
   */
  adiarLida?: boolean | undefined;
  /**
   * A 1ª interação dentro da conversa que abriu sozinha (só com adiarLida). Quem guarda é a tela, para
   * valer mesmo se a conversa sair da tela e voltar (o celular e de volta ao computador).
   */
  aoInteragir?: (() => void) | undefined;
};

/**
 * A marca do foco que a tela põe na conversa (fechar a ficha, a gaveta devolvendo o foco ao botão da
 * ficha): ele não conta como interação (adiarLida). Quem marca é o focoDoPrograma da TelaChat, com o
 * mesmo nome; a marca sai no foco.
 */
const FOCO_DO_PROGRAMA = "data-foco-programa";

/** A linha do tempo da conversa: as mensagens e as passagens. A etapa fica na ficha (a atual e o histórico). */
type ItemConversa =
  | { k: "mensagem"; id: string; em: string; mensagem: MensagemDados }
  | { k: "passagem"; id: string; em: string; evento: EventoConversaDados };

/**
 * As mensagens e as passagens (`conversa_eventos`) numa ordem só, pelo tempo. No mesmo instante, fica
 * a ordem de cima (mensagens, depois passagens), salvo a passagem causada por um envio ("Você assumiu a
 * conversa" ao responder sem assumir), que vem antes da mensagem que a causou: o gatilho grava as duas
 * na mesma transação, com o mesmo horário. Com mensagens mais antigas ainda por carregar, as passagens
 * de antes da mais antiga carregada ficam para depois (comum/linhaDoTempo, a regra das 3 telas).
 */
export function linhaDoTempo(
  mensagens: readonly MensagemDados[],
  eventos: readonly EventoConversaDados[],
  temMaisAntigas = false,
): ItemConversa[] {
  const desde = inicioDaLinha(mensagens, temMaisAntigas);
  const itens: ItemConversa[] = [
    ...mensagens.map((m): ItemConversa => ({ k: "mensagem", id: m.id, em: m.momento, mensagem: m })),
    ...eventos
      .filter((e) => entraNaLinha(e.criado_em, desde))
      .map((e): ItemConversa => ({ k: "passagem", id: e.id, em: e.criado_em, evento: e })),
  ];
  const tempo = (iso: string) => Date.parse(iso);
  const peso = (i: ItemConversa) => (i.k === "passagem" && i.evento.por_envio ? -1 : 0);
  return itens.sort((a, b) => tempo(a.em) - tempo(b.em) || peso(a) - peso(b));
}

/** Quem a tela conhece: a equipe (com os desativados) e quem olha. */
type Pessoas = { membros: Membro[]; eu: Membro };

/* =============================================================================
   Textos
   ============================================================================= */

/** Por que devolver pode não adiantar: a falha que tirou a Janete (o diálogo "Devolver mesmo assim?"). */
const AVISO_FALHA: Partial<Record<MotivoHumano, string>> = {
  chave_invalida: "A chave de IA está inválida. A Janete volta a falhar até alguém trocar a chave na Configuração.",
  sem_credito: "A chave de IA está sem crédito. A Janete volta a falhar até alguém resolver na Configuração.",
  audio_sem_transcricao:
    "A Janete não conseguiu transcrever o último áudio. Se ele for importante, vale responder antes de devolver.",
  limite_passos: "A Janete chegou ao limite de passos nesta conversa e pode parar de novo.",
  erro_provedor: "O provedor de IA deu erro. Se ele continuar fora do ar, a Janete volta a falhar.",
  envio_falhou:
    "A mensagem da Janete pode não ter chegado ao lead. Confira no WhatsApp antes de devolver. Se o problema for a conexão do WhatsApp, a Janete volta a falhar até alguém resolver na Configuração.",
};

/** De onde a conversa vem quando alguém assume: muda a frase do anúncio. */
type DeOnde = "janete" | "espera" | "celular" | "outro" | "eu";

function textoAssumiu(de: DeOnde, nomeAntes: string): string {
  if (de === "espera") return "A conversa esperava atendimento e agora está com você.";
  if (de === "outro") return `A conversa passou de ${nomeAntes || "outra pessoa"} para você.`;
  if (de === "celular") return "Antes respondida pelo celular da empresa, agora segue pela plataforma com você.";
  return "A Janete saiu desta conversa e só volta se alguém devolver.";
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

/** O anúncio do leitor de tela: entra um instante depois de apagado (para repetir) e some depois de ~4 s. */
const ANUNCIO_ESPERA_MS = 80;
const ANUNCIO_DURA_MS = 4000;

function curto(texto: string, n: number): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/* =============================================================================
   O relógio próprio, só quando a tela não manda o dela: a espera anda a cada segundo; fora dela, a
   cada 30 s (o "Hoje" e o "Ontem"). Desligado (`ativo` falso), não arma intervalo nenhum.
   ============================================================================= */

function useAgora(ativo: boolean, rapido: boolean): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    setAgora(Date.now());
    const id = window.setInterval(() => setAgora(Date.now()), rapido ? 1000 : 30_000);
    return () => window.clearInterval(id);
  }, [ativo, rapido]);
  return agora;
}

/* =============================================================================
   O texto da caixa vazia: o longo só quando cabe numa linha do campo
   ============================================================================= */

/** O texto curto da caixa vazia, quando o longo não cabe: o aviso de que enviar troca de mãos fica. */
const DICA_CURTA = "Você assume ao enviar";

/** Largura e fonte do campo da caixa, medidas no navegador (sem ResizeObserver, fica `null`). */
type MedidaCampo = { livre: number; fonte: string };

const larguras = new Map<string, number>();

/** A largura do texto na fonte do campo, pelo canvas (guardada: o texto e a fonte quase não mudam). */
function larguraDoTexto(texto: string, fonte: string): number | null {
  const chave = `${fonte}|${texto}`;
  const guardada = larguras.get(chave);
  if (guardada != null) return guardada;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.font = fonte;
  const l = ctx.measureText(texto).width;
  larguras.set(chave, l);
  return l;
}

/**
 * Mede o espaço livre do campo de texto da conversa a cada mudança de largura da coluna. Observa a
 * coluna (e não o campo, que a caixa pode trocar ao gravar um áudio) e procura o campo a cada medida.
 */
function useMedidaCampo(raiz: RefObject<HTMLDivElement | null>, conversaId: string): MedidaCampo | null {
  const [medida, setMedida] = useState<MedidaCampo | null>(null);
  useEffect(() => {
    const col = raiz.current;
    if (!col || typeof ResizeObserver !== "function") return;
    const medir = () => {
      const campo = col.querySelector<HTMLTextAreaElement>("textarea");
      if (!campo) return;
      const cs = getComputedStyle(campo);
      const livre = campo.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const fonte = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      setMedida((m) => (m && m.livre === livre && m.fonte === fonte ? m : { livre, fonte }));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(col);
    return () => ro.disconnect();
  }, [raiz, conversaId]);
  return medida;
}

/* =============================================================================
   Quem escreveu cada mensagem
   ============================================================================= */

function iniciaisDoMembro(estado: Pessoas, id: string | null): string {
  // Quem está olhando aparece como "VC" (como na lista e no protótipo), não pelas iniciais do nome.
  if (id && id === estado.eu.id) return "VC";
  const m = id ? estado.membros.find((x) => x.id === id) : undefined;
  return m ? iniciais(m.nome) : "?";
}

function autorDa(m: MensagemDados, estado: Pessoas, nomeLead: string, contatoId: string): AutorBolha {
  switch (m.origem) {
    case "lead":
      return { nome: primeiroNome(nomeLead), nomeCompleto: nomeLead, cor: corDoLead(contatoId) };
    case "janete":
      return { nome: "Janete" };
    case "humano_celular":
      return { nome: "Celular da empresa" };
    default: {
      const nome = nomeDoMembro(estado, m.autor_membro_id) || "Equipe";
      const membro = estado.membros.find((x) => x.id === m.autor_membro_id);
      // O papel não repete o nome ("Admin · Equipe", não "Admin · Admin").
      const papel = !membro ? "Equipe" : membro.papel === "admin" ? (nome === "Admin" ? "Equipe" : "Admin") : "Atendente";
      // A bolinha do balão: "VC" para quem olha, como na lista e no bastão.
      return { nome, papel, iniciais: iniciaisDoMembro(estado, m.autor_membro_id) };
    }
  }
}

/* =============================================================================
   A conversa
   ============================================================================= */

/**
 * A coluna da conversa do Chat: o cabeçalho numa linha (avatar, nome e estado, o bastão e o botão
 * da ficha), as mensagens com os separadores de dia e as linhas de passagem, o "Janete digitando…" e a
 * caixa de escrever. A faixa sobre a caixa só aparece com outra pessoa atendendo ou com a Janete parada
 * por falha. Assumir e devolver não mostram toast: a linha de passagem diz e o leitor de tela ouve.
 * Abrir pela lista ou pelo endereço marca como lida na hora; a que a tela abre sozinha (adiarLida) só
 * na 1ª interação dentro dela.
 */
export const Conversa = memo(function Conversa({
  conversaId,
  fichaAberta,
  onAlternarFicha,
  onVoltar,
  avisar,
  agora: agoraTela,
  adiarLida = false,
  aoInteragir,
}: Props) {
  const dados = useDados();
  const { acoes } = dados;
  const modo = useModoDados();
  const { membro: eu, ehAdmin } = dados.useEu();
  const membrosL = dados.useMembros();
  const etapas = dados.useEtapas().dados;
  const conexao = dados.useConexaoAtiva().dados ?? null;
  const navigate = useNavigate();
  const convL = useConversa(conversaId);
  const conversa = convL.dados ?? undefined;
  const contatoL = useContato(conversa?.contato_id);
  const contato = contatoL.dados ?? undefined;
  const msgsL = useMensagens(conversaId);
  const eventosL = useEventos(conversaId);
  const digitandoAgora = useDigitandoChat(conversaId);
  const simularReconexao = useReconexaoDoExemplo();
  const membrosDados = membrosL.dados;
  const estado = useMemo<Pessoas>(() => ({ membros: [...(membrosDados ?? [])], eu }), [membrosDados, eu]);

  const [bloqueioAcao, setBloqueioAcao] = useState<{ conversaId: string; tipo: BloqueioCaixa } | null>(null);
  const [citandoId, setCitandoId] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  const [focoMsg, setFocoMsg] = useState<string | null>(null);

  const raiz = useRef<HTMLDivElement>(null);
  const medidaCampo = useMedidaCampo(raiz, conversaId);
  const dialogo = useRef<HTMLDivElement>(null);
  /** Quem abriu o diálogo de devolver: recebe o foco de volta ao cancelar. */
  const abriuDialogo = useRef<HTMLElement | null>(null);
  const idTitulo = useId();
  const idDialogoT = useId();
  const idDialogoD = useId();

  const selo = conversa ? seloDaConversa(conversa) : "janete";
  const estadoBastao: EstadoBastao =
    selo === "janete" ? "janete" : selo === "membro" ? "humano" : selo === "celular" ? "celular" : "espera";
  // O relógio próprio só anda sem o da tela (o hook é chamado sempre, pela regra dos hooks): com ele,
  // um relógio só para a lista, a ficha e o cabeçalho, que assim viram o minuto juntos.
  const agoraProprio = useAgora(agoraTela == null, estadoBastao === "espera");
  const agora = agoraTela ?? agoraProprio;

  /* O leitor de tela: o anúncio é apagado e regravado um instante depois, para a mesma frase ser lida
     de novo (dois "Reenviar" seguidos, ou a mesma frase em outra conversa). Some sozinho em ~4 s. */
  const timersAnuncio = useRef<number[]>([]);
  const pararAnuncio = useCallback(() => {
    for (const t of timersAnuncio.current) window.clearTimeout(t);
    timersAnuncio.current = [];
  }, []);
  const anunciar = useCallback(
    (texto: string) => {
      pararAnuncio();
      setAnuncio("");
      timersAnuncio.current.push(
        window.setTimeout(() => setAnuncio(texto), ANUNCIO_ESPERA_MS),
        window.setTimeout(() => setAnuncio(""), ANUNCIO_ESPERA_MS + ANUNCIO_DURA_MS),
      );
    },
    [pararAnuncio],
  );
  useEffect(() => pararAnuncio, [pararAnuncio]);

  /* Outra conversa: a citação, o diálogo e o anúncio ficam para trás. */
  useEffect(() => {
    setCitandoId(null);
    setConfirmar(false);
    setFocoMsg(null);
    pararAnuncio();
    setAnuncio("");
  }, [conversaId, pararAnuncio]);

  /* Conversa aberta é conversa lida: ao abrir e quando chega mensagem com ela aberta. A que abriu
     sozinha (adiarLida) espera a 1ª interação dentro dela: avisa a tela (aoInteragir), que guarda e
     desliga o adiarLida. O foco posto pelo programa (focoDoPrograma) não conta. */
  const interagiu = () => {
    if (adiarLida) aoInteragir?.();
  };
  const focou = (ev: FocusEvent<HTMLDivElement>) => {
    const alvo = ev.target;
    if (alvo instanceof HTMLElement && alvo.hasAttribute(FOCO_DO_PROGRAMA)) {
      alvo.removeAttribute(FOCO_DO_PROGRAMA);
      return;
    }
    interagiu();
  };
  const naoLidas = conversa?.nao_lidas ?? 0;
  useEffect(() => {
    if (!adiarLida && naoLidas > 0) void acoes.marcarLida(conversaId);
  }, [acoes, conversaId, naoLidas, adiarLida]);

  /* Depois de assumir, devolver ou reconectar: o foco vai para o campo. Com a caixa bloqueada (sem
     conexão ou janela de 24 h fechada), vai para o "Reconectar" da faixa, se houver; senão, para o
     botão do bastão que ficou habilitado. Nunca cai no body. */
  const focarCampo = useCallback(() => {
    window.setTimeout(() => {
      const r = raiz.current;
      if (!r) return;
      const campo = r.querySelector<HTMLTextAreaElement>("textarea:not([disabled])");
      if (campo) {
        campo.focus();
        return;
      }
      const reconectar = Array.from(r.querySelectorAll<HTMLButtonElement>("button:not([disabled])")).find(
        (b) => b.textContent?.trim() === "Reconectar",
      );
      if (reconectar) {
        reconectar.focus();
        return;
      }
      r.querySelector<HTMLButtonElement>('[role="group"] button:not([disabled])')?.focus();
    }, 0);
  }, []);

  /* O diálogo de devolver: foco nele ao abrir. */
  useEffect(() => {
    if (confirmar) dialogo.current?.focus();
  }, [confirmar]);

  const comigo = !!conversa && conversa.modo === "humano" && conversa.responsavel_id === estado.eu.id;
  const deOnde: DeOnde = !conversa
    ? "janete"
    : estadoBastao === "humano"
      ? comigo
        ? "eu"
        : "outro"
      : estadoBastao;
  const nomeResp = conversa?.responsavel_id ? nomeDoMembro(estado, conversa.responsavel_id) : "";

  /* ---------- a linha do tempo ---------- */

  // Sem as mudanças de etapa ("A Janete moveu para…"): elas já estão na ficha, e na conversa repetiam o
  // histórico e criavam dias sem nenhuma mensagem (rodada 2, A16). O separador de dia só sai nos dias
  // com uma mensagem ou uma passagem.
  const msgsDados = msgsL.dados;
  const eventosDados = eventosL.dados;
  const maisAntigas = msgsL.temMaisAntigas;
  const linha = useMemo(
    () => linhaDoTempo(msgsDados ?? [], eventosDados ?? [], maisAntigas),
    [msgsDados, eventosDados, maisAntigas],
  );
  const mensagens = useMemo(() => msgsDados ?? [], [msgsDados]);
  const idsMsgs = mensagens.map((m) => m.id);
  const alvoFoco = focoMsg && idsMsgs.includes(focoMsg) ? focoMsg : (idsMsgs[idsMsgs.length - 1] ?? null);
  const ultimaEnviada = idUltimaEnviada(mensagens);

  // Os 3 estados da conversa: carregando, erro (com "Tentar de novo") e a que não existe mais.
  if (convL.carregando || (conversa && contatoL.carregando)) {
    return (
      <div className={s.cvRaiz}>
        <div className={s.cvEstadoLeitura}>
          <Carregando forma="texto" quantos={5} rotulo="Carregando a conversa" />
        </div>
      </div>
    );
  }
  // Só sem os dados o erro toma a conversa: com ela na tela, a releitura que falhou vira um aviso no
  // alto (comum/releitura), e a caixa de escrever (com o anexo e o áudio gravado) fica.
  const erroLeitura = erroSemDados(convL) ?? (conversa ? erroSemDados(contatoL) : null);
  if (erroLeitura) {
    return (
      <div className={s.cvRaiz}>
        <div className={s.cvEstadoLeitura}>
          <ErroLeitura
            erro={erroLeitura}
            titulo="Não deu para carregar a conversa"
            tentarDeNovo={() => {
              convL.tentarDeNovo();
              contatoL.tentarDeNovo();
            }}
          />
        </div>
      </div>
    );
  }
  const erroReleitura =
    erroDeReleitura(convL) ?? erroDeReleitura(contatoL) ?? erroDeReleitura(msgsL) ?? erroDeReleitura(eventosL);
  if (!conversa || !contato) {
    return (
      <div className={s.cvRaiz}>
        <p className={s.cvVazio}>Esta conversa não existe mais. Ela pode ter sido apagada.</p>
      </div>
    );
  }

  const nomeLead = nomeDoContato(contato);
  const corLead = corDoLead(contato.id);
  const etapa = etapas?.find((e) => e.id === contato.etapa_id);
  const esperaS = segundosDesde(conversa.aguardando_humano_desde, agora);
  const digitando = conversa.modo === "janete" && digitandoAgora;

  /* ---------- ações ---------- */

  /**
   * O aviso vai para o toast da tela (quem enxerga e o leitor de tela) ou, sem ele, só para o leitor.
   * Só nos erros, no "Reconectado…" e no download simulado: assumir e devolver avisam pela linha de
   * passagem e pelo leitor de tela (anunciar), sem toast.
   */
  const dizer = (texto: string, tom?: TomAviso) => {
    if (avisar) avisar(texto, tom);
    else anunciar(texto);
  };

  /** A ação recusada: sem conexão e janela fechada bloqueiam a caixa; o resto vira o aviso com o texto do erro. */
  const recusa = (r: Resultado<unknown>, acao: AcaoChat = "geral"): boolean => {
    if (r.ok) return false;
    if (r.erro === "sem_conexao_ativa") setBloqueioAcao({ conversaId, tipo: "sem_conexao" });
    else if (r.erro === "janela_fechada") setBloqueioAcao({ conversaId, tipo: "janela_fechada" });
    else dizer(textoDoErroChat(r.erro, acao), "erro");
    return true;
  };

  const assumir = () => {
    if (deOnde === "eu") return;
    const antes = nomeResp;
    const de = deOnde;
    void acoes.assumir(conversaId).then((r) => {
      if (recusa(r)) return;
      // Sem toast: quem enxerga vê a linha "Você assumiu a conversa · hh:mm"; o leitor de tela ouve a frase.
      anunciar(`Você assumiu a conversa. ${textoAssumiu(de, antes)}`);
      focarCampo();
    });
  };

  const devolverAgora = () => {
    setConfirmar(false);
    abriuDialogo.current = null;
    void acoes.devolverParaJanete(conversaId).then((r) => {
      if (recusa(r)) return;
      anunciar(`A Janete voltou a atender ${primeiroNome(nomeLead)}.`);
      focarCampo();
    });
  };

  const devolver = () => {
    if (conversa.modo === "janete") return;
    // Esperando por uma falha: a Janete pode parar de novo pelo mesmo motivo. Confirma antes.
    if (estadoBastao === "espera" && conversa.motivo_humano && MOTIVOS_FALHA.includes(conversa.motivo_humano)) {
      abriuDialogo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmar(true);
      return;
    }
    devolverAgora();
  };

  const cancelarDevolver = () => {
    setConfirmar(false);
    // O foco volta para quem abriu o diálogo (o lado da Janete no bastão); sem ele, para o campo.
    const antes = abriuDialogo.current;
    abriuDialogo.current = null;
    if (antes) window.setTimeout(() => (antes.isConnected ? antes.focus() : focarCampo()), 0);
    else focarCampo();
  };

  // Uma por vez (a caixa espera cada uma): o anexo e o áudio levam o arquivo de verdade.
  const enviar = async (id: string, nova: NovaMensagem) => {
    const r = await acoes.enviarMensagem(id, {
      tipo: nova.tipo,
      texto: nova.texto ?? null,
      midia: nova.midia ?? null,
      citaId: nova.citaId ?? null,
      ...(nova.arquivo ? { arquivo: nova.arquivo } : {}),
    });
    if (recusa(r, "enviar")) return { ok: false };
    setBloqueioAcao(null);
    setCitandoId(null);
    // "Mensagem enviada." a caixa já anuncia; aqui, só a troca de mãos (quem enxerga vê a linha de passagem).
    if (r.ok && r.assumiu) anunciar("Você assumiu a conversa.");
    return { ok: true };
  };

  const reconectar = () => {
    if (simularReconexao?.()) {
      setBloqueioAcao(null);
      dizer(
        ehAdmin
          ? "Reconectado no exemplo. No app, a reconexão é feita na Configuração."
          : "Reconectado no exemplo. No app, quem reconecta é um admin.",
      );
      focarCampo();
    }
  };

  /* O "Reconectar" da faixa de sem conexão: com a conexão ativa caída, o exemplo simula a volta; no
     banco, e com ela desligada na Configuração (ou sem nenhuma), o admin vai para a Configuração
     reconectar. O atendente não reconecta: a faixa explica e pede para chamar um admin (o
     complementoBloqueio). */
  const aoReconectar =
    conexao && simularReconexao
      ? reconectar
      : ehAdmin
        ? () => void navigate({ to: "/app/configuracao" })
        : undefined;

  /* ---------- a caixa: bloqueio e faixa ---------- */

  const bloqueio: BloqueioCaixa | null = !conexaoAtiva({ conexao })
    ? "sem_conexao"
    : janelaFechada({ conexao }, conversa, new Date(agora))
      ? "janela_fechada"
      : bloqueioAcao?.conversaId === conversaId
        ? bloqueioAcao.tipo
        : null;

  // A faixa só aparece em 2 casos: outra pessoa atendendo e a Janete parada por falha. Nos outros, nada
  // (a linha de passagem e o cabeçalho já dizem quem atende).
  let faixa: FaixaCaixa | null = null;
  const motivo = conversa.motivo_humano;
  if (estadoBastao === "espera" && motivo && MOTIVOS_FALHA.includes(motivo)) {
    // Começa pelo motivo, curta: cabe numa linha e o motivo não some quando a passagem sai de vista.
    faixa = {
      tom: "falha",
      texto: `${MOTIVO_CURTO[motivo]}: a Janete parou. Ao responder, você assume.`,
    };
  } else if (estadoBastao === "humano" && !comigo) {
    // Como no banco, responder sem assumir mantém quem já estava com a conversa (só a Janete, a
    // espera e o celular passam para quem envia). Para ficar com ela, é o "Assumir de…".
    faixa = { tom: "pessoa", texto: `${nomeResp} está atendendo. Se você enviar, a conversa continua com ${nomeResp}.` };
  }

  // Sem a faixa, quem avisa que enviar troca de mãos é o texto da caixa vazia (com a Janete, esperando
  // sem falha e no celular). Com você, com outra pessoa e na falha, fica o texto padrão da caixa.
  // Quando o texto longo não cabe numa linha do campo (a coluna estreita, o celular), vai o curto,
  // que guarda o aviso: "Você assume ao enviar".
  const assumeAoEnviar = estadoBastao === "janete" || estadoBastao === "celular" || (estadoBastao === "espera" && !faixa);
  const dicaLonga = `Escreva para ${primeiroNome(nomeLead)} · você assume ao enviar`;
  const larguraDica = medidaCampo ? larguraDoTexto(dicaLonga, medidaCampo.fonte) : null;
  const dicaCabe = !medidaCampo || larguraDica == null || larguraDica <= medidaCampo.livre - 2;
  const dica = assumeAoEnviar ? (dicaCabe ? dicaLonga : DICA_CURTA) : undefined;

  /* ---------- cabeçalho ---------- */

  // A linha de estado em 2 pedaços: o 1º (a empresa, "Respondida pelo celular" ou "Aguardando")
  // encolhe primeiro; o 2º (a etapa ou o tempo da espera) só corta depois que o 1º sumiu. Na espera,
  // com o cabeçalho estreito, o "Aguardando" sai e fica "há 13 min" com o relógio: o tempo nunca some.
  let iconeEstado: ReactNode;
  let estadoA: string;
  let estadoB: string | null;
  const etapaEstado = etapa ? `· ${etapa.nome}` : null;
  if (estadoBastao === "espera") {
    // Uma linha curta: o motivo fica na linha de passagem e, na falha, na faixa. Âmbar; vermelho a partir de 10 min.
    iconeEstado = <Clock size={14} aria-hidden="true" />;
    estadoA = "Aguardando";
    estadoB = `há ${esperaLonga(esperaS)}`;
  } else if (estadoBastao === "celular") {
    iconeEstado = <Smartphone size={14} aria-hidden="true" />;
    estadoA = "Respondida pelo celular";
    estadoB = etapaEstado;
  } else {
    // Quem atende já está no bastão: sob o nome ficam a empresa e a etapa (como no protótipo).
    iconeEstado = <Building2 size={14} aria-hidden="true" />;
    estadoA = contato.empresa?.trim() || "Sem empresa";
    estadoB = etapaEstado;
  }
  const tomEstado = estadoBastao === "espera" ? "espera" : undefined;
  const esperaLongaCab = estadoBastao === "espera" && esperaS >= ESPERA_LONGA_S;

  /* ---------- as mensagens ---------- */

  const citacaoDe = (id: string | null | undefined): CitacaoBolha | null => {
    if (!id) return null;
    const m = mensagens.find((x) => x.id === id);
    if (!m) return null;
    return { de: autorDa(m, estado, nomeLead, contato.id).nome, texto: curto(resumoMensagem(m), 120) };
  };

  /** A citação de uma mensagem: a citada carregada ou, quando ela é mais antiga que as páginas lidas, o aviso. */
  const citacaoDaBolha = (m: MensagemDados): CitacaoBolha | null => {
    const id = idCitado(m);
    if (!id) return null;
    return citacaoDe(id) ?? CITACAO_FORA;
  };

  const citando: CitandoCaixa | null = (() => {
    const c = citacaoDe(citandoId);
    return c && citandoId ? { id: citandoId, ...c } : null;
  })();

  const teclaMsg = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (e.target !== e.currentTarget) return;
    const i = idsMsgs.indexOf(id);
    let j: number | null = null;
    if (e.key === "ArrowUp") j = Math.max(0, i - 1);
    else if (e.key === "ArrowDown") j = Math.min(idsMsgs.length - 1, i + 1);
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = idsMsgs.length - 1;
    if (j == null) return;
    e.preventDefault();
    const alvo = idsMsgs[j]!;
    setFocoMsg(alvo);
    document.getElementById(`cv-msg-${alvo}`)?.focus();
  };

  const itens: ReactNode[] = [];
  let diaAnterior = "";
  // Quem falou no item anterior ("origem:membro"): agrupa as mensagens seguidas da mesma pessoa. Um
  // separador de dia ou uma passagem zeram o grupo.
  let chaveAnterior: string | null = null;
  for (const item of linha) {
    const dia = diaLocal(item.em);
    if (dia !== diaAnterior) {
      diaAnterior = dia;
      chaveAnterior = null;
      itens.push(<SeparadorDia key={`dia-${dia}`} texto={rotuloDia(item.em, agora)} />);
    }
    if (item.k === "passagem") {
      chaveAnterior = null;
      const ev = item.evento;
      itens.push(
        <PassagemConversa
          key={item.id}
          evento={ev}
          nome={nomeDoMembro(estado, ev.membro_id) || "Alguém da equipe"}
          iniciais={iniciaisDoMembro(estado, ev.membro_id)}
          nomeDe={ev.de_membro_id ? nomeDoMembro(estado, ev.de_membro_id) : undefined}
          iniciaisDe={ev.de_membro_id ? iniciaisDoMembro(estado, ev.de_membro_id) : undefined}
        />,
      );
      continue;
    }
    const m = item.mensagem;
    const chave = `${m.origem}:${m.autor_membro_id ?? ""}`;
    const agrupada = chave === chaveAnterior;
    chaveAnterior = chave;
    itens.push(
      <Bolha
        key={m.id}
        id={`cv-msg-${m.id}`}
        mensagem={m}
        autor={autorDa(m, estado, nomeLead, contato.id)}
        agrupada={agrupada}
        citacao={citacaoDaBolha(m)}
        mostrarSituacao={m.id === ultimaEnviada}
        nomeLead={primeiroNome(nomeLead)}
        transcricaoFalhou={
          m.origem === "lead" && m.tipo === "audio" && !m.transcricao && conversa.motivo_humano === "audio_sem_transcricao"
        }
        aoResponder={(id) => setCitandoId(id)}
        // Na v1, sem o Reagir (decisão 5): a reação que já existe só aparece.
        // O "Tentar de novo" só na mensagem da equipe que não pode ter chegado (decisão 8, a regra do banco).
        regraDeReenvio
        aoTentarDeNovo={(id) => {
          void acoes.tentarDeNovo(id).then((r) => {
            if (!recusa(r, "reenviar")) anunciar("Reenviando a mensagem.");
          });
        }}
        // O documento com arquivo baixa pelo link assinado (a Bolha); só o exemplo, sem arquivo, simula.
        aoBaixar={modo === "exemplo" ? () => dizer(`Download simulado: ${m.midia_nome ?? "documento"}.`) : undefined}
        tabIndex={m.id === alvoFoco ? 0 : -1}
        onKeyDown={(e) => teclaMsg(e, m.id)}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setFocoMsg(m.id);
        }}
      />,
    );
  }
  // O "digitando" continua o grupo da Janete como uma mensagem dela: sem a bolinha se a última foi da Janete.
  const digitandoAgrupado = chaveAnterior === "janete:";

  return (
    <div
      ref={raiz}
      className={s.cvRaiz}
      data-ficha={fichaAberta ? "aberta" : "fechada"}
      // A 1ª interação dentro da conversa que abriu sozinha a marca como lida: o clique, o toque, a roda
      // do mouse, a tecla e o foco (menos o do programa). A rolagem não conta (a conversa já abre no fim
      // pelo column-reverse).
      onPointerDownCapture={interagiu}
      onKeyDownCapture={interagiu}
      onFocusCapture={focou}
      onWheelCapture={interagiu}
      onTouchStartCapture={interagiu}
    >
      {/* Uma linha: voltar (celular), avatar, nome e estado, o bastão e o botão da ficha. A gaveta da
          ficha (900 a 1279 px) mede o fim deste <header> para começar logo abaixo. */}
      <header className={s.cvCab}>
        <div className={s.cvId}>
          {onVoltar && (
            <button type="button" className={s.cvVoltar} aria-label="Voltar para a lista de conversas" onClick={onVoltar}>
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
          )}
          {/* No celular, sem a foto: o voltar e o nome bastam, e o nome fica com o espaço. */}
          {onVoltar ? null : <AvatarLead nome={nomeLead} cor={corLead} tamanho="p" />}
          <div className={s.cvIdTxt}>
            <h2 id={idTitulo} className={s.cvNome} title={nomeLead}>
              {nomeLead}
            </h2>
            <p className={s.cvEstado} data-tom={tomEstado} data-longa={esperaLongaCab || undefined}>
              {iconeEstado}
              <span className={s.cvEstA} data-sai-estreito={estadoBastao === "espera" || undefined}>
                {estadoA}
              </span>
              {/* O espaço é só para o texto (o leitor de tela e a cópia); na tela, quem separa é o gap. */}
              {estadoB ? " " : null}
              {estadoB ? <span className={s.cvEstB}>{estadoB}</span> : null}
            </p>
          </div>
        </div>
        {/* Uma por conversa: trocar de conversa não é trocar de mãos, e o bastão não anima. */}
        <Bastao
          key={conversaId}
          className={s.cvBastao}
          estado={estadoBastao}
          comigo={comigo}
          responsavelNome={nomeResp}
          responsavelIniciais={iniciaisDoMembro(estado, conversa.responsavel_id)}
          esperaS={esperaS}
          aoAssumir={assumir}
          aoDevolver={devolver}
        />
        <div className={s.cvAcoes}>
          <button
            type="button"
            className={s.cvFicha}
            aria-label="Ficha do lead"
            aria-expanded={fichaAberta}
            onClick={onAlternarFicha}
          >
            {onVoltar ? <UserRound size={18} aria-hidden="true" /> : <PanelRight size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className={s.cvRolo}>
        {/* Um log por conversa: reaproveitado, o leitor de tela leria o histórico novo como mensagens novas. */}
        <div
          key={conversaId}
          className={s.cvLista}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={`Conversa com ${nomeLead}`}
        >
          {msgsL.temMaisAntigas ? (
            <button
              type="button"
              className={s.cvMais}
              onClick={msgsL.carregarMaisAntigas}
              disabled={msgsL.carregandoMaisAntigas}
            >
              {msgsL.carregandoMaisAntigas ? "Carregando…" : "Carregar mensagens anteriores"}
            </button>
          ) : null}
          {msgsL.carregando || eventosL.carregando ? (
            <Carregando forma="texto" quantos={4} rotulo="Carregando as mensagens" />
          ) : erroSemDados(msgsL) || erroSemDados(eventosL) ? (
            <ErroLeitura
              erro={erroSemDados(msgsL) ?? erroSemDados(eventosL)}
              titulo="Não deu para carregar as mensagens"
              tentarDeNovo={() => {
                if (msgsL.erro) msgsL.tentarDeNovo();
                if (eventosL.erro) eventosL.tentarDeNovo();
              }}
              compacto
            />
          ) : (
            <>
              {/* A releitura que falhou com as mensagens na tela: um aviso, e elas ficam. */}
              {erroReleitura ? (
                <ErroLeitura
                  erro={erroReleitura}
                  titulo="Não deu para atualizar a conversa"
                  tentarDeNovo={() => {
                    if (convL.erro) convL.tentarDeNovo();
                    if (contatoL.erro) contatoL.tentarDeNovo();
                    if (msgsL.erro) msgsL.tentarDeNovo();
                    if (eventosL.erro) eventosL.tentarDeNovo();
                  }}
                  compacto
                />
              ) : null}
              {!itens.length ? (
                <p className={s.cvVazio}>Nenhuma mensagem nesta conversa ainda.</p>
              ) : (
                // Os links das mídias da conversa de uma vez (um pedido só ao Storage).
                <LoteMidias mensagens={mensagens}>{itens}</LoteMidias>
              )}
            </>
          )}
          {digitando && (
            // Na mesma linha de uma mensagem da Janete: a bolinha dela à direita (ou só o espaço, quando
            // continua o grupo dela) e o balão com os 3 pontos. Sem o nome em cima.
            <div className={s.cvDigita} data-agrupada={digitandoAgrupado || undefined}>
              {digitandoAgrupado ? (
                <span className={s.cvDigitaEsp} aria-hidden="true" />
              ) : (
                <span className={s.cvDigitaQuem} aria-hidden="true">
                  <JaneteSimbolo tamanho={36} estado="fala" digitando decorativo />
                </span>
              )}
              <div className={s.cvDigitaBolha}>
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <span className={s.sr}>A Janete está digitando</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <CaixaEscrever
        className={s.cvEscrever}
        conversaId={conversaId}
        bloqueio={bloqueio}
        faixa={faixa}
        aoEnviar={enviar}
        destinatario={primeiroNome(nomeLead)}
        dica={dica}
        citando={citando}
        aoTirarCitacao={() => setCitandoId(null)}
        aoReconectar={aoReconectar}
        complementoBloqueio={!aoReconectar ? "Peça a um admin para reconectar." : undefined}
      />

      <p className={s.sr} role="status" aria-live="polite">
        {anuncio}
      </p>

      {confirmar && typeof document !== "undefined" && createPortal(
        // O véu cobre o app inteiro (no body, como o diálogo de apagar da ficha); o wrapper leva os tokens.
        <div className={s.cvVeu} data-identidade="aipro" onClick={cancelarDevolver}>
          <div
            ref={dialogo}
            className={s.cvDialogo}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={idDialogoT}
            aria-describedby={idDialogoD}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelarDevolver();
              } else if (e.key === "Tab") {
                // Prende o Tab entre os dois botões.
                const botoes = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                const primeiro = botoes[0];
                const ultimo = botoes[botoes.length - 1];
                const ativo = document.activeElement;
                if (e.shiftKey && (ativo === primeiro || ativo === e.currentTarget)) {
                  e.preventDefault();
                  ultimo?.focus();
                } else if (!e.shiftKey && ativo === ultimo) {
                  e.preventDefault();
                  primeiro?.focus();
                }
              }
            }}
          >
            <h2 id={idDialogoT} className={s.cvDialogoTitulo}>
              Devolver para a Janete mesmo assim?
            </h2>
            <p id={idDialogoD} className={s.cvDialogoTexto}>
              {(conversa.motivo_humano && AVISO_FALHA[conversa.motivo_humano]) ||
                "A Janete pode parar de novo pelo mesmo motivo."}
            </p>
            <div className={s.cvDialogoAcoes}>
              <Botao variante="discreto" onClick={cancelarDevolver}>
                Cancelar
              </Botao>
              <Botao variante="principal" onClick={devolverAgora}>
                Devolver mesmo assim
              </Botao>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});
