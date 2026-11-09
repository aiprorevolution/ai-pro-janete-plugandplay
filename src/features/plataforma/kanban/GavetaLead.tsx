import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Building2, Clock, Phone, Settings2, Trash2, UserRound } from "lucide-react";

import { Botao } from "@/components/aipro/Botao";
import { type Classes } from "@/components/aipro/cx";
import { iniciais } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { AvatarLead, corDoLead } from "../comum/AvatarLead";
import { Bolha, LoteMidias, idUltimaEnviada, resumoBolha, type AutorBolha, type CitacaoBolha } from "../comum/Bolha";
import { CaixaEscrever, type CitandoCaixa, type FaixaCaixa, type NovaMensagem as NovaDaCaixa } from "../comum/CaixaEscrever";
import { EventoConversa, PassagemConversa, SeparadorDia } from "../comum/EventoConversa";
import { FecharGaveta, Gaveta } from "../comum/Gaveta";
import { MOTIVO_CURTO, MOTIVO_LONGO, MOTIVOS_FALHA, nomeDoContato } from "../comum/LinhaConversa";
import { entraNaLinha, inicioDaLinha } from "../comum/linhaDoTempo";
import { MenuSuspenso } from "../comum/MenuSuspenso";
import { dataCurta, diaLocal, diasEntre, esperaLonga, horaCurta, rotuloDia, segundosDesde, tempoRelativo } from "../comum/tempo";
import {
  useContato,
  useConversaDoContato,
  useCustoConversas,
  useEventos,
  useHistoricoContato,
  useMensagens,
} from "../dados/conversa";
import { Carregando, ErroLeitura, textoDoErro } from "../dados/estados";
import { frioNoQuadro, janeteAtivaNoQuadro, useJaneteTrabalhando } from "../dados/kanban";
import { useDados, useModoDados } from "../dados/ProvedorDados";
import type {
  ContatoDados,
  ConversaDados,
  Erro,
  EventoConversaDados,
  HistoricoContato,
  MensagemDados,
} from "../dados/tipos";
import { conexaoAtiva, etapasVisiveis, janelaFechada, nomeDoMembro, seloDaConversa, telefoneLegivel } from "../exemplo/regras";
import { useTelaEstreita } from "../exemplo/telaEstreita";
import type { Etapa, Membro, MotivoHumano } from "../exemplo/tipos";

import { Bastao, type EstadoBastao } from "../chat/Bastao";

import { corDaEtapa, nomeDaEtapa } from "./Coluna";
import estilos from "./GavetaLead.module.css";

// A gaveta do lead do Kanban 2 (o `.gaveta` do Kanban-2.dc.html): à esquerda, quem é o lead e o que
// a Janete descobriu; à direita, maior, a conversa com ele. As duas metades também servem à etapa
// que vira chat (EtapaChat), "encaixadas" ao lado da lista, com a conversa primeiro.
// Tudo vem da camada de dados (useDados e as leituras de conversa de dados/conversa.ts, as mesmas do
// Chat e dos Contatos): no modo banco, o banco de verdade; no exemplo (os testes), o estado em memória.

const s = estilos as Classes<
  | "glGaveta"
  | "glCorpo"
  | "glAbas"
  | "glVoltar"
  | "glSeg"
  | "glInfo"
  | "glId"
  | "glIdLinha"
  | "glIdTexto"
  | "glNome"
  | "glApoio"
  | "glContato"
  | "glMono"
  | "glDescobriu"
  | "glDescobriuCab"
  | "glResumo"
  | "glCampos"
  | "glCampo"
  | "glVazio"
  | "glBloco"
  | "glBlocoTit"
  | "glMeta"
  | "glEtapaMenu"
  | "glPonto"
  | "glSitu"
  | "glHist"
  | "glHistIc"
  | "glHistTxt"
  | "glObs"
  | "glCusto"
  | "glConfirma"
  | "glConfirmaBtns"
  | "glChat"
  | "glCab"
  | "glCabId"
  | "glCabNome"
  | "glEstado"
  | "glAcoes"
  | "glBastao"
  | "glFecharD"
  | "glRolo"
  | "glLista"
  | "glDigitando"
  | "glBase"
  | "glAviso"
  | "glLink"
  | "glDica"
  | "glVeu"
  | "glDialogo"
  | "glDialogoTitulo"
  | "glDialogoTexto"
  | "glDialogoAcoes"
  | "glMais"
  | "sr"
>;

/* =============================================================================
   Apoio
   ============================================================================= */

/** O relógio da tela: um intervalo só (30 s) para as horas e as esperas da gaveta e da lista. */
export function useRelogio(intervaloMs = 30_000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => window.clearInterval(id);
  }, [intervaloMs]);
  return agora;
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

const SEM_ETAPAS: readonly Etapa[] = [];
const SEM_IDS: readonly string[] = [];
const SEM_MENSAGENS: readonly MensagemDados[] = [];
const SEM_EVENTOS: readonly EventoConversaDados[] = [];
const SEM_HISTORICO: readonly HistoricoContato[] = [];

/** "hoje, 14:20", "ontem, 09:12" ou "26/10, 18:02", no fuso de São Paulo. */
function quandoCurto(iso: string, agora: number): string {
  const d = diasEntre(iso, agora);
  const dia = d <= 0 ? "hoje" : d === 1 ? "ontem" : dataCurta(iso);
  return `${dia}, ${horaCurta(iso)}`;
}

const moedaUSD = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

/* O texto da caixa vazia: o longo só quando cabe numa linha do campo (como no Chat da rodada 2). */

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
 * Mede o espaço livre do campo de texto a cada mudança de largura da conversa (a mesma medida do
 * Chat, que não exporta a dele). Observa a conversa e procura o campo a cada medida.
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

/** O anúncio entra um instante depois de apagado (para a mesma frase ser lida de novo) e some em ~4 s. */
const ANUNCIO_ESPERA_MS = 80;
const ANUNCIO_DURA_MS = 4000;

/**
 * Um aviso que dura ~4 s, como o anunciar do Chat: a mesma frase duas vezes seguidas (dois "Baixar"
 * no mesmo arquivo) é apagada e regravada, para o leitor de tela ler de novo. Devolve o texto, quem
 * avisa e quem para (apaga na hora, na troca de conversa).
 */
function useAnuncio(): readonly [string, (texto: string) => void, () => void] {
  const [texto, setTexto] = useState("");
  const timers = useRef<number[]>([]);
  const parar = useCallback(() => {
    for (const t of timers.current.splice(0)) window.clearTimeout(t);
    setTexto("");
  }, []);
  const anunciar = useCallback(
    (novo: string) => {
      parar();
      timers.current.push(
        window.setTimeout(() => setTexto(novo), ANUNCIO_ESPERA_MS),
        window.setTimeout(() => setTexto(""), ANUNCIO_ESPERA_MS + ANUNCIO_DURA_MS),
      );
    },
    [parar],
  );
  useEffect(() => {
    const lista = timers.current;
    return () => {
      for (const t of lista.splice(0)) window.clearTimeout(t);
    };
  }, []);
  return [texto, anunciar, parar] as const;
}

/** Por que devolver pode não adiantar: a falha que tirou a Janete (o diálogo "Devolver mesmo assim?").
    O mesmo texto do Chat (chat/Conversa.tsx), que não o exporta. */
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

/** De onde a conversa vem quando alguém assume: muda a frase do anúncio (como no Chat). */
type DeOnde = "janete" | "espera" | "celular" | "outro";

function textoAssumiu(de: DeOnde, nomeAntes: string): string {
  if (de === "espera") return "A conversa esperava atendimento e agora está com você.";
  if (de === "outro") return `A conversa passou de ${nomeAntes || "outra pessoa"} para você.`;
  if (de === "celular") return "Antes respondida pelo celular da empresa, agora segue pela plataforma com você.";
  return "A Janete saiu desta conversa e só volta se alguém devolver.";
}

/** O símbolo da Janete, estático e pequeno (rótulos, histórico, "O que a Janete descobriu"). */
function MarcaJanete({ tamanho }: { tamanho: number }) {
  return <JaneteSimbolo tamanho={tamanho} decorativo />;
}

/** O lead aberto: o contato, a conversa dele (nula = ainda não tem) e a etapa. */
export interface Lead {
  contato: ContatoDados;
  conversa: ConversaDados | null;
  etapa: Etapa | null;
}

/** A leitura do lead: `lead` nulo e sem carregar nem erro = o contato não existe mais (apagado). */
export interface LeituraLead {
  lead: Lead | null;
  carregando: boolean;
  erro: Erro | null;
  tentarDeNovo: () => void;
}

/** O lead, a conversa e a etapa de um contato (dados/conversa.ts), nos dois modos. */
export function useLead(contatoId: string | null): LeituraLead {
  const dados = useDados();
  const contato = useContato(contatoId);
  const conversa = useConversaDoContato(contatoId);
  const etapas = dados.useEtapas();
  const etapasDados = etapas.dados;
  const lead = useMemo<Lead | null>(() => {
    if (!contatoId || !contato.dados || conversa.dados === undefined) return null;
    const etapa = etapasDados?.find((e) => e.id === contato.dados!.etapa_id) ?? null;
    return { contato: contato.dados, conversa: conversa.dados, etapa };
  }, [contatoId, contato.dados, conversa.dados, etapasDados]);
  if (!contatoId) return { lead: null, carregando: false, erro: null, tentarDeNovo: () => {} };
  const erro = contato.erro ?? conversa.erro;
  return {
    lead,
    carregando: !lead && !erro && (contato.carregando || conversa.carregando),
    erro: lead ? null : erro,
    tentarDeNovo: () => {
      if (contato.erro) contato.tentarDeNovo();
      if (conversa.erro) conversa.tentarDeNovo();
    },
  };
}

/** Quem olha e a equipe, para os nomes ("Você", "Marina"): o formato de `nomeDoMembro`. */
type Pessoas = { membros: readonly Membro[]; eu: Pick<Membro, "id"> };

function nomeDe(pessoas: Pessoas, membroId: string | null): string {
  return nomeDoMembro({ membros: [...pessoas.membros], eu: pessoas.eu as Membro }, membroId);
}

/** A equipe e quem olha, pela camada de dados (a equipe que não carregou fica sem nomes). */
function usePessoas(): Pessoas {
  const dados = useDados();
  const eu = dados.useEu();
  const membros = dados.useMembros().dados;
  return useMemo(() => ({ membros: membros ?? [], eu: eu.membro }), [membros, eu.membro]);
}

/** A última mensagem que não foi cancelada (a do card e do topo). */
function ultimaDe(mensagens: readonly MensagemDados[] | undefined): MensagemDados | null {
  if (!mensagens) return null;
  for (let i = mensagens.length - 1; i >= 0; i -= 1) if (mensagens[i]!.status !== "cancelada") return mensagens[i]!;
  return null;
}

/** O texto de uma ação que não deu certo, para a pessoa (sem código). */
function textoFalhou(acao: string, erro: Erro): string {
  switch (erro) {
    case "sem_conexao_ativa":
      return `Não deu para ${acao}: o WhatsApp não está conectado.`;
    case "janela_fechada":
      return `Não deu para ${acao}. ${textoDoErro(erro)}`;
    case "sem_acesso":
    case "sem_permissao":
      return `Não deu para ${acao}: sua conta não tem acesso.`;
    case "nao_encontrado":
      return `Não deu para ${acao}: esta conversa não existe mais.`;
    default:
      return `Não deu para ${acao}. Verifique a internet e tente de novo.`;
  }
}

/* =============================================================================
   As infos do lead (à esquerda na gaveta; à direita na etapa que vira chat)
   ============================================================================= */

type PropsInfo = {
  contato: ContatoDados;
  conversa: ConversaDados | null;
  agora: number;
  /** O contato foi apagado: quem monta fecha a gaveta ou escolhe outro lead. */
  aoApagar: () => void;
  /** O id do título (o nome), para o nome acessível da região. */
  idNome?: string | undefined;
};

/** Quem moveu, como no histórico do protótipo: "pela Janete", "por Marina", "na chegada, pelo sistema". */
function quemMoveu(pessoas: Pessoas, h: HistoricoContato): string {
  if (h.ator === "janete") return "pela Janete";
  if (h.ator === "sistema") return "na chegada, pelo sistema";
  const nome = nomeDe(pessoas, h.membro_id);
  return nome === "Você" ? "por você" : `por ${nome || "alguém da equipe"}`;
}

function textoSituacao(
  pessoas: Pessoas,
  contato: ContatoDados,
  conversa: ConversaDados,
  ultima: MensagemDados | null,
  etapas: readonly Etapa[],
  agora: number,
) {
  const selo = seloDaConversa(conversa);
  if (selo === "aguardando" || selo === "falha") {
    const espera = esperaLonga(segundosDesde(conversa.aguardando_humano_desde, agora));
    const motivo = conversa.motivo_humano;
    const texto =
      motivo && MOTIVOS_FALHA.includes(motivo)
        ? `Falha: ${MOTIVO_LONGO[motivo]}. Assuma a conversa, ou devolva para a Janete depois de resolver.`
        : motivo === "janete_passou" || !motivo
          ? "A Janete pediu ajuda da equipe nesta conversa."
          : `A Janete passou a vez: ${MOTIVO_LONGO[motivo]}.`;
    return { titulo: `Esperando a equipe há ${espera}`, texto, alerta: true };
  }
  if (selo === "janete") {
    const texto = !ultima
      ? "A Janete ainda não trocou mensagem com este lead."
      : ultima.origem === "lead"
        ? `O lead falou por último, ${tempoRelativo(ultima.momento, agora)}.`
        : frioNoQuadro({ contato, conversa, ultima }, etapas, agora) > 0 && conversa.ultima_do_lead_em
          ? `O lead não responde desde ${quandoCurto(conversa.ultima_do_lead_em, agora)}.`
          : `Última mensagem ${tempoRelativo(ultima.momento, agora)}.`;
    return { titulo: "A Janete está atendendo", texto, alerta: false };
  }
  if (selo === "celular") {
    return {
      titulo: "Com o celular da empresa",
      texto: "Alguém respondeu pelo WhatsApp do celular, e a Janete saiu da conversa.",
      alerta: false,
    };
  }
  const nome = nomeDe(pessoas, conversa.responsavel_id);
  return {
    titulo: nome === "Você" ? "Com você" : `Com ${nome}`,
    texto: "A Janete não responde enquanto alguém da equipe estiver com a conversa.",
    alerta: false,
  };
}

export function InfoLead({ contato, conversa, agora, aoApagar, idNome }: PropsInfo) {
  const dados = useDados();
  const { acoes } = dados;
  const eu = dados.useEu();
  const admin = eu.ehAdmin;
  const pessoas = usePessoas();
  const nome = nomeDoContato(contato);
  const etapasTodas = dados.useEtapas().dados ?? SEM_ETAPAS;
  const etapas = etapasVisiveis({ etapas: [...etapasTodas] });
  const historicoL = useHistoricoContato(contato.id);
  const historico = (historicoL.dados ?? []).slice().reverse();
  // O custo de IA (só o admin; o atendente recebe {} sem ir ao banco). Sem gasto, a conversa vem com 0.
  const idsCusto = useMemo(() => (conversa ? [conversa.id] : []), [conversa]);
  const custoL = useCustoConversas(idsCusto);
  const custoValor = conversa ? custoL.dados?.[conversa.id] : undefined;
  const custo = custoValor ? custoValor : null;
  const ultima = ultimaDe(useMensagens(conversa?.id ?? null).dados);
  const situ = conversa ? textoSituacao(pessoas, contato, conversa, ultima, etapasTodas, agora) : null;
  const responsavel = conversa?.responsavel_id ? pessoas.membros.find((m) => m.id === conversa.responsavel_id) : undefined;

  const [obs, setObs] = useState(contato.observacoes ?? "");
  const [confirmar, setConfirmar] = useState(false);
  const [aviso, setAviso] = useState("");
  const [apagandoTela, setApagandoTela] = useState(false);
  const apagando = useRef(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);
  const idObs = useId();
  const idConf = useId();

  // Outro lead: o rascunho das observações e a confirmação de apagar ficam para trás.
  useEffect(() => {
    setObs(contato.observacoes ?? "");
    setConfirmar(false);
    setAviso("");
    // Só a troca de lead reinicia (o texto salvo pelo próprio campo não deve apagar o que se digita).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contato.id]);

  // A pessoa deixou de ser admin ("Ver como" mudou): a confirmação some junto com o botão.
  useEffect(() => {
    if (!admin) setConfirmar(false);
  }, [admin]);

  const salvarObs = async () => {
    const novo = obs.trim() ? obs : null;
    if ((contato.observacoes ?? null) === novo) return;
    const r = await acoes.editarContato(contato.id, { observacoes: novo });
    if (!r.ok) setAviso(textoFalhou("salvar as observações", r.erro));
  };

  const mover = async (etapaId: string) => {
    if (etapaId === contato.etapa_id) return;
    const r = await acoes.moverEtapa(contato.id, etapaId);
    const destino = etapasTodas.find((e) => e.id === etapaId);
    setAviso(
      r.ok
        ? `${nome} foi para ${nomeDaEtapa(destino)}.`
        : r.erro === "sem_permissao" || r.erro === "etapa_arquivada"
          ? "Não deu para mover: essa etapa está arquivada."
          : "Não deu para mover este lead.",
    );
  };

  // Trava enquanto espera o servidor: um 2º clique mandaria outro apagarContato, que voltaria
  // nao_encontrado ("Não deu para apagar") depois de o contato já ter sumido.
  const apagar = async () => {
    if (apagando.current) return;
    apagando.current = true;
    setApagandoTela(true);
    const r = await acoes.apagarContato(contato.id);
    apagando.current = false;
    if (!vivo.current) return;
    setApagandoTela(false);
    if (r.ok) {
      aoApagar();
      return;
    }
    setConfirmar(false);
    setAviso(r.erro === "sem_permissao" || r.erro === "sem_acesso" ? "Só o admin apaga contato." : "Não deu para apagar este contato.");
  };

  const quandoPrimeira = contato.primeira_mensagem_em
    ? (() => {
        const d = diasEntre(contato.primeira_mensagem_em, agora);
        return d <= 0 ? "hoje" : d === 1 ? "ontem" : `em ${dataCurta(contato.primeira_mensagem_em)}`;
      })()
    : null;

  // O que a Janete coletou do lead: as colunas que ela preenche no contato (o banco ainda não tem
  // campos livres). Vazio = ela ainda não descobriu.
  const email = contato.email?.trim() || null;
  const arroba = email ? email.indexOf("@") : -1;
  const campos: readonly (readonly [string, ReactNode])[] = [
    ["Nome", contato.nome?.trim() || null],
    ["Empresa", contato.empresa?.trim() || null],
    // O e-mail pode quebrar depois do @ e antes de cada ponto do domínio (o <wbr>), e não no meio da palavra.
    [
      "E-mail",
      email && arroba >= 0 ? (
        <>
          {email.slice(0, arroba + 1)}
          <wbr />
          {email
            .slice(arroba + 1)
            .split(".")
            .map((parte, i) =>
              i === 0 ? (
                <Fragment key={i}>{parte}</Fragment>
              ) : (
                <Fragment key={i}>
                  <wbr />
                  {`.${parte}`}
                </Fragment>
              ),
            )}
        </>
      ) : (
        email
      ),
    ],
  ];

  const etapaAtual = etapasTodas.find((e) => e.id === contato.etapa_id);

  return (
    <aside className={s.glInfo} aria-label="Informações do lead">
      <div className={s.glId}>
        {/* O nome ao lado da bolinha (o equipe, em 30/10); o telefone e a 1ª mensagem embaixo dos dois. */}
        <div className={s.glIdLinha}>
          <AvatarLead
            nome={nome}
            chave={contato.id}
            selo={conversa ? seloDaConversa(conversa) : null}
            iniciaisMembro={
              // Quando quem atende é você, o selo diz "VC" (como na situação da fundação).
              responsavel ? (responsavel.id === eu.membro.id ? "VC" : iniciais(responsavel.nome)) : null
            }
          />
          <div className={s.glIdTexto}>
            <h2 id={idNome} className={s.glNome}>
              {nome}
            </h2>
            {contato.nome_whatsapp ? <p className={s.glApoio}>No WhatsApp: {contato.nome_whatsapp}</p> : null}
          </div>
        </div>
        <div className={s.glContato}>
          {contato.telefone ? (
            <p>
              <Phone aria-hidden="true" size={16} strokeWidth={1.75} />
              <span className={s.sr}>Telefone: </span>
              <span className={s.glMono}>{telefoneLegivel(contato.telefone)}</span>
            </p>
          ) : null}
          {quandoPrimeira ? (
            <p>
              <Clock aria-hidden="true" size={16} strokeWidth={1.75} />
              <span>Primeira mensagem {quandoPrimeira}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* A etapa logo abaixo do nome: o menu abre para baixo dentro da coluna, que rola, e aqui em cima
          as 6 etapas cabem à vista mesmo em tela baixa (mais abaixo, Ganho e Perdido ficavam escondidos). */}
      <section className={s.glBloco} aria-label="Etapa">
        <h3 className={s.glBlocoTit}>Etapa</h3>
        {/* Um menu só, com a etapa atual no botão (o equipe, em 30/10), no lugar de um botão por etapa. */}
        <MenuSuspenso
          className={s.glEtapaMenu}
          rotulo="Etapa do lead"
          textoBotao={nomeDaEtapa(etapaAtual)}
          iconeTexto={<i className={s.glPonto} style={{ background: corDaEtapa(etapaAtual) } as CSSProperties} />}
          itens={etapas.map((e) => ({ id: e.id, texto: nomeDaEtapa(e) }))}
          valor={contato.etapa_id}
          aoEscolher={(id) => void mover(id)}
          alinhar="largura"
        />
        {contato.etapa_desde ? (
          <p className={s.glMeta}>
            Nesta etapa desde {quandoCurto(contato.etapa_desde, agora)}
          </p>
        ) : null}
        <p className={s.sr} role="status" aria-live="polite">
          {aviso}
        </p>
      </section>

      <section className={s.glDescobriu} aria-label="O que a Janete descobriu">
        <div className={s.glDescobriuCab}>
          <MarcaJanete tamanho={28} />
          <h3>O que a Janete descobriu</h3>
        </div>
        <p className={s.glResumo}>{contato.resumo_janete?.trim() || "A Janete ainda está conhecendo este lead."}</p>
        <dl className={s.glCampos}>
          {campos.map(([rotulo, valor]) => (
            <div key={rotulo} className={s.glCampo}>
              <dt>{rotulo}</dt>
              <dd className={valor ? undefined : s.glVazio}>{valor ?? "Ainda não sabe"}</dd>
            </div>
          ))}
        </dl>
      </section>

      {situ ? (
        <section className={s.glBloco} aria-label="Atendimento">
          <h3 className={s.glBlocoTit}>Atendimento</h3>
          <div className={s.glSitu} data-alerta={situ.alerta ? "" : undefined}>
            <b>{situ.titulo}</b>
            <span>{situ.texto}</span>
          </div>
        </section>
      ) : null}

      <section className={s.glBloco} aria-label="Histórico de etapas">
        <h3 className={s.glBlocoTit}>Histórico de etapas</h3>
        {historicoL.erro ? (
          <ErroLeitura compacto titulo="Não deu para carregar o histórico" erro={historicoL.erro} tentarDeNovo={historicoL.tentarDeNovo} />
        ) : historicoL.carregando ? (
          <Carregando forma="texto" quantos={2} rotulo="Carregando o histórico de etapas" />
        ) : historico.length ? (
          <ol className={s.glHist}>
            {historico.map((h, i) => (
              <li key={h.id}>
                <span className={s.glHistIc} aria-hidden="true">
                  {h.ator === "janete" ? (
                    <MarcaJanete tamanho={20} />
                  ) : h.ator === "sistema" ? (
                    <Settings2 size={12} strokeWidth={2} />
                  ) : (
                    <UserRound size={12} strokeWidth={2} />
                  )}
                </span>
                <div className={s.glHistTxt}>
                  <b>{nomeDaEtapa(etapasTodas.find((e) => e.id === h.para_etapa_id))}</b>
                  <span>
                    {quemMoveu(pessoas, h)} · {quandoCurto(h.criado_em, agora)}
                  </span>
                  {/* O movimento mais recente, se foi da Janete e o lead ainda está lá, dá para desfazer. */}
                  {i === 0 && h.ator === "janete" && h.de_etapa_id && contato.etapa_id === h.para_etapa_id ? (
                    <button type="button" className={s.glLink} onClick={() => void mover(h.de_etapa_id!)}>
                      Desfazer: voltar para {nomeDaEtapa(etapasTodas.find((e) => e.id === h.de_etapa_id))}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={s.glMeta}>Ainda não mudou de etapa.</p>
        )}
      </section>

      <section className={s.glBloco}>
        <label htmlFor={idObs} className={s.glBlocoTit}>
          Observações da equipe
        </label>
        <textarea
          id={idObs}
          className={s.glObs}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => void salvarObs()}
          placeholder="Anote o que a equipe precisa saber deste lead"
        />
      </section>

      {admin ? (
        <section className={s.glBloco} aria-label="Custo de IA">
          <h3 className={s.glBlocoTit}>Custo de IA</h3>
          <p className={s.glCusto}>
            {/* Como a ficha do Chat: o "nenhum gasto" só depois de o custo chegar. */}
            {custoL.carregando && custoValor === undefined ? (
              "Calculando…"
            ) : custoL.erro && custoValor === undefined ? (
              "Não deu para calcular agora"
            ) : custo === null ? (
              "Nenhum gasto de IA nesta conversa ainda."
            ) : (
              <>
                <span className={s.glMono}>{moedaUSD.format(custo)}</span> nesta conversa
              </>
            )}
          </p>
          <p className={s.glMeta}>Só o admin vê.</p>
        </section>
      ) : null}

      {admin ? (
        <section className={s.glBloco}>
          {confirmar ? (
            <div className={s.glConfirma} role="alertdialog" aria-labelledby={idConf}>
              <p id={idConf}>
                <b>Apagar {nome}?</b> A conversa e as mídias vão junto. Não dá para desfazer. Se ele escrever
                de novo, volta como lead novo.
              </p>
              <div className={s.glConfirmaBtns}>
                <Botao
                  variante="perigo"
                  tamanho="compacto"
                  onClick={() => void apagar()}
                  // carregando: o Botao trava e põe o aria-busy (a prop dele manda no aria-busy)
                  carregando={apagandoTela}
                  autoFocus
                >
                  {apagandoTela ? "Apagando…" : "Apagar contato"}
                </Botao>
                <Botao variante="discreto" tamanho="compacto" onClick={() => setConfirmar(false)} disabled={apagandoTela}>
                  Cancelar
                </Botao>
              </div>
            </div>
          ) : (
            <Botao
              variante="perigo"
              tamanho="compacto"
              icone={<Trash2 size={16} strokeWidth={1.75} />}
              onClick={() => setConfirmar(true)}
            >
              Apagar contato
            </Botao>
          )}
        </section>
      ) : null}
    </aside>
  );
}

/* =============================================================================
   A conversa com o lead (à direita na gaveta; primeiro na etapa que vira chat)
   ============================================================================= */

function textoEtapa(pessoas: Pessoas, etapas: readonly Etapa[], h: HistoricoContato): string {
  const para = nomeDaEtapa(etapas.find((e) => e.id === h.para_etapa_id));
  if (h.ator === "janete") return `A Janete moveu para ${para}`;
  const quem = nomeDe(pessoas, h.membro_id) || "Alguém da equipe";
  return `${quem} moveu para ${para}`;
}

function autorDe(pessoas: Pessoas, contato: ContatoDados, m: MensagemDados): AutorBolha {
  if (m.origem === "lead") {
    const nome = nomeDoContato(contato);
    return { nome: primeiroNome(nome), nomeCompleto: nome, cor: corDoLead(contato.id) };
  }
  if (m.origem === "janete") return { nome: "Janete" };
  if (m.origem === "humano_celular") return { nome: "Celular da empresa" };
  const membro = pessoas.membros.find((x) => x.id === m.autor_membro_id);
  return {
    nome: nomeDe(pessoas, m.autor_membro_id) || "Equipe",
    papel: membro ? (membro.papel === "admin" ? "Admin" : "Atendente") : undefined,
  };
}

/** Um item da linha do tempo: uma mensagem, uma passagem do bastão (conversa_eventos) ou uma mudança de etapa. */
type ItemLinha =
  | { k: "mensagem"; id: string; em: string; mensagem: MensagemDados }
  | { k: "passagem"; id: string; em: string; evento: EventoConversaDados }
  | { k: "etapa"; id: string; em: string; historico: HistoricoContato };

/**
 * A linha do tempo da conversa (a mesma regra de `linhaDaConversa`): as mensagens carregadas, as
 * passagens e as mudanças de etapa (sem a entrada em Novo pelo sistema). Com mensagens mais antigas
 * ainda por carregar, as passagens e as etapas de antes da mais antiga carregada ficam para depois.
 */
function montarLinha(
  mensagens: readonly MensagemDados[],
  eventos: readonly EventoConversaDados[],
  historico: readonly HistoricoContato[],
  temMaisAntigas: boolean,
): ItemLinha[] {
  const desde = inicioDaLinha(mensagens, temMaisAntigas);
  const itens: ItemLinha[] = [
    ...mensagens.map((m): ItemLinha => ({ k: "mensagem", id: m.id, em: m.momento, mensagem: m })),
    ...eventos
      .filter((e) => entraNaLinha(e.criado_em, desde))
      .map((e): ItemLinha => ({ k: "passagem", id: e.id, em: e.criado_em, evento: e })),
    ...historico
      .filter((h) => h.ator !== "sistema" && entraNaLinha(h.criado_em, desde))
      .map((h): ItemLinha => ({ k: "etapa", id: h.id, em: h.criado_em, historico: h })),
  ];
  // sort estável: no mesmo instante, fica a ordem de cima, salvo a passagem causada por um envio
  // ("Você assumiu a conversa" ao responder sem assumir), que vem antes da mensagem que a causou.
  const peso = (i: ItemLinha) => (i.k === "passagem" && i.evento.por_envio ? -1 : 0);
  return itens.sort((a, b) => Date.parse(a.em) - Date.parse(b.em) || peso(a) - peso(b));
}

type PropsConversa = {
  contato: ContatoDados;
  conversa: ConversaDados;
  agora: number;
  /**
   * A conversa abriu sozinha (a primeira da etapa como chat): só vira lida na 1ª interação dentro
   * dela (a regra do Chat, decisão 6). Quem abre pelo clique, pelo card ou pelo endereço marca na hora.
   */
  adiarLida?: boolean | undefined;
  /** A 1ª interação na conversa que abriu sozinha (só com `adiarLida`): quem monta desliga o adiar. */
  aoInteragir?: (() => void) | undefined;
  /** Na gaveta: o X do cabeçalho. Na etapa que vira chat (encaixada), não há X. */
  aoFechar?: (() => void) | undefined;
  /** A bolinha e o nome no topo. Só no celular, onde as infos ficam na outra aba; no computador elas
      estão ao lado e o topo não repete (o equipe, em 30/10). */
  mostrarNome?: boolean | undefined;
};

export function ConversaLead({ contato, conversa, agora, aoFechar, mostrarNome = false, adiarLida = false, aoInteragir }: PropsConversa) {
  const dados = useDados();
  const { acoes } = dados;
  const modo = useModoDados();
  const pessoas = usePessoas();
  const etapasTodas = dados.useEtapas().dados ?? SEM_ETAPAS;
  const conexaoL = dados.useConexaoAtiva();
  const trabalhando = useJaneteTrabalhando().dados ?? SEM_IDS;
  const mensagensL = useMensagens(conversa.id);
  const eventosL = useEventos(conversa.id);
  const historicoL = useHistoricoContato(contato.id);
  const nome = nomeDoContato(contato);
  const primeiro = primeiroNome(nome);
  const [citando, setCitando] = useState<CitandoCaixa | null>(null);
  const [assumidas, setAssumidas] = useState<ReadonlySet<string>>(() => new Set());
  // O que o leitor de tela ouve (assumir, devolver, baixar) e o aviso à vista do download simulado.
  const [anuncio, anunciar, pararAnuncio] = useAnuncio();
  const [nota, mostrarNota, pararNota] = useAnuncio();
  const raiz = useRef<HTMLDivElement>(null);
  const medidaCampo = useMedidaCampo(raiz, conversa.id);
  // A confirmação de devolver depois de uma falha (a mesma do Chat).
  const [confirmar, setConfirmar] = useState(false);
  const dialogo = useRef<HTMLDivElement>(null);
  /** Quem abriu o diálogo de devolver: recebe o foco de volta ao cancelar. */
  const abriuDialogo = useRef<HTMLElement | null>(null);
  const idDialogoT = useId();
  const idDialogoD = useId();

  // Trocar de conversa tira a citação e os avisos.
  useEffect(() => {
    setCitando(null);
    setConfirmar(false);
    abriuDialogo.current = null;
    pararAnuncio();
    pararNota();
  }, [conversa.id, pararAnuncio, pararNota]);

  /* Conversa aberta é conversa lida (a regra do Chat, decisão 6): ao abrir e quando chega mensagem com
     ela aberta, e é aí que o lead vê o azul no WhatsApp. A que abriu sozinha (adiarLida) espera a 1ª
     interação dentro dela: o clique, o toque, a roda do mouse, a tecla ou o foco. */
  const naoLidas = conversa.nao_lidas;
  useEffect(() => {
    if (!adiarLida && naoLidas > 0) void acoes.marcarLida(conversa.id);
  }, [acoes, conversa.id, naoLidas, adiarLida]);
  const interagiu = () => {
    if (adiarLida) aoInteragir?.();
  };

  /* O diálogo de devolver: foco nele ao abrir. */
  useEffect(() => {
    if (confirmar) dialogo.current?.focus();
  }, [confirmar]);

  const eu = pessoas.eu;
  const selo = seloDaConversa(conversa);
  // A Janete trabalhando nesta conversa (a rodada rodando; no exemplo, "digitando").
  const digitando = conversa.modo === "janete" && trabalhando.includes(conversa.id);
  const comVoce = conversa.modo === "humano" && conversa.responsavel_id === eu.id;
  // Quem conduz, nos 4 estados do bastão do Chat (o mesmo componente, no topo da conversa).
  const estadoBastao: EstadoBastao =
    selo === "janete" ? "janete" : selo === "membro" ? "humano" : selo === "celular" ? "celular" : "espera";
  const responsavel = conversa.responsavel_id ? pessoas.membros.find((m) => m.id === conversa.responsavel_id) : undefined;
  const nomeResp = conversa.responsavel_id ? nomeDe(pessoas, conversa.responsavel_id) : "";
  const avisoAssumiu = assumidas.has(conversa.id) && comVoce;
  const mensagens = mensagensL.dados ?? SEM_MENSAGENS;
  const ultima = ultimaDe(mensagens);

  // Quem atende já está no bastão: o texto de estado fica só com o que ele não diz. Quando sobraria
  // só quem atende, vão a empresa e a etapa do lead (como no cabeçalho do Chat).
  const etapaLead = etapasTodas.find((e) => e.id === contato.etapa_id);
  const empresaEtapa = [contato.empresa?.trim() || "Sem empresa", etapaLead ? nomeDaEtapa(etapaLead) : null]
    .filter(Boolean)
    .join(" · ");
  let estadoTexto: string;
  let tom: "ativo" | "alerta" | undefined;
  let comEmpresa = false;
  if (digitando) {
    estadoTexto = "Janete digitando…";
    tom = "ativo";
  } else if (selo === "janete") {
    const ativa = janeteAtivaNoQuadro({ contato, conversa, ultima }, etapasTodas, trabalhando, agora);
    estadoTexto = ativa ? "A Janete está conversando agora" : empresaEtapa;
    comEmpresa = !ativa;
    tom = ativa ? "ativo" : undefined;
  } else if (selo === "aguardando" || selo === "falha") {
    estadoTexto = `Esperando a equipe há ${esperaLonga(segundosDesde(conversa.aguardando_humano_desde, agora))}`;
    tom = "alerta";
  } else if (selo === "celular") {
    estadoTexto = "Respondida pelo celular da empresa";
  } else {
    estadoTexto = empresaEtapa;
    comEmpresa = true;
  }

  // A caixa bloqueia quando a conexão ativa não está conectada, ou com a janela de 24 h fechada na API
  // oficial (regras.ts). Enquanto a conexão carrega (ou não deu para ler), não bloqueia: o banco confere.
  const conexao = conexaoL.dados;
  const bloqueio =
    conexao === undefined
      ? null
      : !conexaoAtiva({ conexao })
        ? ("sem_conexao" as const)
        : janelaFechada({ conexao }, conversa, new Date(agora))
          ? ("janela_fechada" as const)
          : null;
  // A regra do Chat da rodada 2: a faixa só aparece com outra pessoa atendendo e com a Janete parada
  // por falha. Nos outros casos, quem avisa que enviar troca de mãos é o texto do campo (a dica).
  let faixa: FaixaCaixa | null = null;
  const motivo = conversa.motivo_humano;
  if (estadoBastao === "espera" && motivo && MOTIVOS_FALHA.includes(motivo)) {
    faixa = { tom: "falha", texto: `${MOTIVO_CURTO[motivo]}: a Janete parou. Ao responder, você assume.` };
  } else if (estadoBastao === "humano" && !comVoce) {
    // Responder sem assumir mantém quem já estava com a conversa: para ficar com ela, é o "Assumir de…".
    faixa = { tom: "pessoa", texto: `${nomeResp} está atendendo. Se você enviar, a conversa continua com ${nomeResp}.` };
  }

  // Com a Janete, esperando sem falha e no celular, enviar passa a conversa para você: o campo avisa.
  // O texto longo só quando cabe numa linha do campo; senão vai o curto, que guarda o aviso.
  const assumeAoEnviar = estadoBastao === "janete" || estadoBastao === "celular" || (estadoBastao === "espera" && !faixa);
  const dicaLonga = `Escreva para ${primeiro} · você assume ao enviar`;
  const larguraDica = medidaCampo ? larguraDoTexto(dicaLonga, medidaCampo.fonte) : null;
  const dicaCabe = !medidaCampo || larguraDica == null || larguraDica <= medidaCampo.livre - 2;
  const dica = assumeAoEnviar ? (dicaCabe ? dicaLonga : DICA_CURTA) : undefined;

  /* Depois de assumir ou devolver, o foco vai para o campo, como no Chat (o Bastao conta com isso).
     Com a caixa bloqueada, vai para o botão do bastão que ficou habilitado. Nunca cai fora da gaveta. */
  const focarCampo = () => {
    window.setTimeout(() => {
      const r = raiz.current;
      if (!r) return;
      const campo = r.querySelector<HTMLTextAreaElement>("textarea:not([disabled])");
      if (campo) {
        campo.focus();
        return;
      }
      r.querySelector<HTMLButtonElement>('[role="group"] button:not([disabled])')?.focus();
    }, 0);
  };

  /** O que não deu certo: à vista (o aviso de cima da caixa) e para o leitor de tela. */
  const avisarFalha = (texto: string) => {
    mostrarNota(texto);
    anunciar(texto);
  };

  const assumir = async () => {
    if (estadoBastao === "humano" && comVoce) return;
    // De onde ela vem, guardado antes de trocar de mãos: muda a frase (como o textoAssumiu do Chat).
    const de: DeOnde = estadoBastao === "humano" ? "outro" : estadoBastao;
    const antes = nomeResp;
    const r = await acoes.assumir(conversa.id);
    if (!r.ok) {
      avisarFalha(textoFalhou("assumir a conversa", r.erro));
      return;
    }
    anunciar(`Você assumiu a conversa. ${textoAssumiu(de, antes)}`);
    focarCampo();
  };
  const devolverAgora = async () => {
    setConfirmar(false);
    abriuDialogo.current = null;
    const r = await acoes.devolverParaJanete(conversa.id);
    if (r.ok) {
      setAssumidas((a) => {
        const n = new Set(a);
        n.delete(conversa.id);
        return n;
      });
      anunciar(`A conversa com ${nome} voltou para a Janete.`);
      focarCampo();
    } else {
      avisarFalha(textoFalhou("devolver para a Janete", r.erro));
    }
  };
  const devolver = () => {
    // Esperando por uma falha: a Janete pode parar de novo pelo mesmo motivo. Confirma antes (como no Chat).
    if (estadoBastao === "espera" && motivo && MOTIVOS_FALHA.includes(motivo)) {
      abriuDialogo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmar(true);
      return;
    }
    void devolverAgora();
  };
  const cancelarDevolver = () => {
    setConfirmar(false);
    // O foco volta para quem abriu o diálogo (o lado da Janete no bastão); sem ele, para o campo.
    const antes = abriuDialogo.current;
    abriuDialogo.current = null;
    if (antes) window.setTimeout(() => (antes.isConnected ? antes.focus() : focarCampo()), 0);
    else focarCampo();
  };

  /* O download simulado: quem enxerga vê o aviso por ~4 s, e o leitor de tela ouve pelo anúncio. */
  const baixar = (arquivo: string) => {
    const texto = `Download simulado: ${arquivo}.`;
    mostrarNota(texto);
    anunciar(texto);
  };

  // A mensagem sai na hora (decisão 7: a camada pede a passada de envio depois do insert); a caixa
  // espera cada uma e para na primeira recusa, com o que não saiu ainda nela.
  const enviar = async (conversaId: string, m: NovaDaCaixa) => {
    const r = await acoes.enviarMensagem(conversaId, {
      tipo: m.tipo,
      texto: m.texto ?? null,
      midia: m.midia ?? null,
      citaId: m.citaId ?? null,
      arquivo: m.arquivo,
    });
    if (r.ok) {
      setCitando(null);
      if (r.assumiu) setAssumidas((a) => new Set(a).add(conversaId));
    } else {
      avisarFalha(textoFalhou("enviar a mensagem", r.erro));
    }
    return { ok: r.ok };
  };

  // "Tentar de novo" só na mensagem da equipe que pode sair de novo (decisão 8; a Bolha confere).
  const tentarDeNovo = async (mensagemId: string) => {
    const r = await acoes.tentarDeNovo(mensagemId);
    if (!r.ok) {
      avisarFalha(
        r.erro === "nao_reenviavel"
          ? "Essa mensagem pode ter chegado ao lead: não dá para enviar de novo. Confira no WhatsApp."
          : textoFalhou("enviar de novo", r.erro),
      );
    }
  };

  /* ---------- a linha do tempo ---------- */
  const itens = montarLinha(mensagens, eventosL.dados ?? SEM_EVENTOS, historicoL.dados ?? SEM_HISTORICO, mensagensL.temMaisAntigas);
  const ultimaEnviada = idUltimaEnviada(mensagens);
  const porId = new Map(mensagens.map((m) => [m.id, m]));
  const transcricaoFalhou = conversa.motivo_humano === "audio_sem_transcricao";
  // A citação que não está entre as carregadas: a Bolha diz "Respondendo a uma mensagem anterior".
  const resolverCitacao = (id: string): CitacaoBolha | null => {
    const citada = porId.get(id);
    return citada ? { de: autorDe(pessoas, contato, citada).nome, texto: resumoBolha(citada) } : null;
  };

  const nos: ReactNode[] = [];
  let diaAnterior = "";
  let grupoAnterior = "";
  for (const item of itens) {
    const dia = diaLocal(item.em);
    if (dia !== diaAnterior) {
      diaAnterior = dia;
      grupoAnterior = "";
      nos.push(<SeparadorDia key={`dia-${dia}`} texto={rotuloDia(item.em, agora)} />);
    }
    if (item.k === "mensagem") {
      const m = item.mensagem;
      const grupo = `${m.origem}|${m.autor_membro_id ?? ""}`;
      const agrupada = grupo === grupoAnterior;
      grupoAnterior = grupo;
      nos.push(
        <Bolha
          key={m.id}
          mensagem={m}
          autor={autorDe(pessoas, contato, m)}
          agrupada={agrupada}
          resolverCitacao={resolverCitacao}
          mostrarSituacao={m.id === ultimaEnviada}
          nomeLead={primeiro}
          transcricaoFalhou={transcricaoFalhou && m.origem === "lead" && m.tipo === "audio" && !m.transcricao}
          aoResponder={
            bloqueio
              ? undefined
              : (id) => {
                  const alvo = porId.get(id);
                  if (alvo) setCitando({ id, de: autorDe(pessoas, contato, alvo).nome, texto: resumoBolha(alvo) });
                }
          }
          // Decisão 5: na v1, sem o Reagir (a Bolha já esconde).
          aoTentarDeNovo={(id) => void tentarDeNovo(id)}
          // No banco, o documento baixa pelo link assinado; o exemplo não tem arquivo e simula.
          aoBaixar={modo === "exemplo" ? () => baixar(m.midia_nome ?? "documento") : undefined}
        />,
      );
      continue;
    }
    grupoAnterior = "";
    if (item.k === "passagem") {
      // As passagens do bastão (conversa_eventos, decisão 8), na frase da linha do tempo do Kanban.
      const ev = item.evento;
      nos.push(
        <PassagemConversa
          key={item.id}
          evento={ev}
          nome={nomeDe(pessoas, ev.membro_id) || undefined}
          nomeDe={nomeDe(pessoas, ev.de_membro_id) || undefined}
          forma="texto"
        />,
      );
      continue;
    }
    nos.push(<EventoConversa key={item.id} texto={textoEtapa(pessoas, etapasTodas, item.historico)} momento={item.em} />);
  }

  return (
    <div
      ref={raiz}
      className={s.glChat}
      // A 1ª interação dentro da conversa que abriu sozinha a marca como lida (decisão 6).
      onPointerDownCapture={interagiu}
      onKeyDownCapture={interagiu}
      onFocusCapture={interagiu}
      onWheelCapture={interagiu}
      onTouchStartCapture={interagiu}
    >
      <header className={s.glCab}>
        {mostrarNome ? <AvatarLead nome={nome} chave={contato.id} tamanho="p" /> : null}
        <div className={s.glCabId}>
          {mostrarNome ? <b className={s.glCabNome}>{nome}</b> : null}
          <span className={s.glEstado} data-tom={tom}>
            {comEmpresa ? (
              <Building2 size={14} aria-hidden="true" />
            ) : conversa.modo === "janete" ? (
              <JaneteSimbolo tamanho={16} estado={digitando || tom === "ativo" ? "fala" : "acordada"} digitando={digitando} decorativo />
            ) : null}
            <span>{estadoTexto}</span>
          </span>
        </div>
        <div className={s.glAcoes}>
          {/* O bastão do Chat: com outra pessoa atendendo, o "Assumir de <nome>". Uma por conversa:
              trocar de conversa não é trocar de mãos, e o bastão não anima. */}
          <Bastao
            key={conversa.id}
            className={s.glBastao}
            estado={estadoBastao}
            comigo={comVoce}
            responsavelNome={nomeResp}
            responsavelIniciais={responsavel ? (responsavel.id === eu.id ? "VC" : iniciais(responsavel.nome)) : undefined}
            esperaS={segundosDesde(conversa.aguardando_humano_desde, agora)}
            aoAssumir={() => void assumir()}
            aoDevolver={devolver}
          />
          {aoFechar ? <FecharGaveta aoFechar={aoFechar} rotulo="Fechar a conversa (Esc)" className={s.glFecharD} /> : null}
        </div>
      </header>

      <div className={s.glRolo}>
        <div className={s.glLista} role="log" aria-live="polite" aria-label={`Mensagens com ${nome}`}>
          {mensagensL.temMaisAntigas ? (
            <div className={s.glMais}>
              <button
                type="button"
                className={s.glLink}
                disabled={mensagensL.carregandoMaisAntigas}
                onClick={mensagensL.carregarMaisAntigas}
              >
                {mensagensL.carregandoMaisAntigas ? "Carregando…" : "Ver mensagens mais antigas"}
              </button>
            </div>
          ) : null}
          {mensagensL.erro ? (
            <ErroLeitura titulo="Não deu para carregar a conversa" erro={mensagensL.erro} tentarDeNovo={mensagensL.tentarDeNovo} compacto />
          ) : mensagensL.carregando ? (
            <Carregando forma="lista" quantos={3} rotulo="Carregando as mensagens" />
          ) : (
            <LoteMidias mensagens={mensagens}>
              {nos.length ? nos : <EventoConversa texto="Nenhuma mensagem ainda." />}
            </LoteMidias>
          )}
          {digitando ? (
            <div className={s.glDigitando}>
              <JaneteSimbolo tamanho={28} estado="fala" digitando rotulo="A Janete está digitando" />
            </div>
          ) : null}
        </div>
      </div>

      <div className={s.glBase}>
        {avisoAssumiu ? (
          <div className={s.glAviso} role="status">
            <div>
              <b>Você assumiu a conversa.</b> A Janete parou de responder este lead.{" "}
              <button type="button" className={s.glLink} onClick={devolver}>
                Devolver para a Janete
              </button>
            </div>
          </div>
        ) : null}
        {/* À vista, com o desenho do aviso acima; o leitor de tela ouve a mesma frase pelo anúncio. */}
        {nota ? (
          <div className={s.glAviso} aria-hidden="true">
            <div>{nota}</div>
          </div>
        ) : null}
        <CaixaEscrever
          conversaId={conversa.id}
          bloqueio={bloqueio}
          faixa={faixa}
          dica={dica}
          aoEnviar={enviar}
          destinatario={primeiro}
          citando={citando}
          aoTirarCitacao={() => setCitando(null)}
        />
        <p className={s.sr} role="status" aria-live="polite">
          {anuncio}
        </p>
      </div>

      {confirmar && typeof document !== "undefined" && createPortal(
        // A mesma confirmação do Chat: o véu cobre o app inteiro (no body, por cima da gaveta).
        <div className={s.glVeu} data-identidade="aipro" onClick={cancelarDevolver}>
          <div
            ref={dialogo}
            className={s.glDialogo}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={idDialogoT}
            aria-describedby={idDialogoD}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // O diálogo cuida das próprias teclas: pela árvore do React, elas subiriam até a gaveta
              // (o Esc a fecharia e o Tab puxaria o foco de volta para ela).
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelarDevolver();
              } else if (e.key === "Tab") {
                e.stopPropagation();
                // Prende o Tab entre os dois botões.
                const botoes = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                const primeiroB = botoes[0];
                const ultimoB = botoes[botoes.length - 1];
                const ativo = document.activeElement;
                if (e.shiftKey && (ativo === primeiroB || ativo === e.currentTarget)) {
                  e.preventDefault();
                  ultimoB?.focus();
                } else if (!e.shiftKey && ativo === ultimoB) {
                  e.preventDefault();
                  primeiroB?.focus();
                }
              }
            }}
          >
            <h2 id={idDialogoT} className={s.glDialogoTitulo}>
              Devolver para a Janete mesmo assim?
            </h2>
            <p id={idDialogoD} className={s.glDialogoTexto}>
              {(motivo && AVISO_FALHA[motivo]) || "A Janete pode parar de novo pelo mesmo motivo."}
            </p>
            <div className={s.glDialogoAcoes}>
              <Botao variante="discreto" onClick={cancelarDevolver}>
                Cancelar
              </Botao>
              <Botao variante="principal" onClick={() => void devolverAgora()}>
                Devolver mesmo assim
              </Botao>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* =============================================================================
   A gaveta
   ============================================================================= */

/**
 * A gaveta vai até o menu lateral (o equipe, em 30/10): cobre o quadro e deixa o menu à vista, com a mesma
 * folga de 12 px que ela tem da borda da tela. Os 240 px são a coluna do menu da casca
 * (`Plataforma.module.css`). Abaixo de 1.384 px de janela, fica nos 1.120 px de antes (a Gaveta ainda
 * limita à janela menos 24 px).
 */
const LARGURA_GAVETA = "max(1120px, calc(100% - 240px - 2 * var(--sb-esp-3)))";

type Props = {
  /** O contato aberto; `null` fecha a gaveta. */
  contatoId: string | null;
  aoFechar: () => void;
};

/**
 * A gaveta do lead: fecha com Esc, no X e clicando fora (o véu). No celular ocupa a tela cheia,
 * com "Conversa" e "Sobre o lead" em abas. Se o contato for apagado, a gaveta fecha sozinha.
 */
export function GavetaLead({ contatoId, aoFechar }: Props) {
  const leitura = useLead(contatoId);
  const { lead } = leitura;
  const estreita = useTelaEstreita();
  const agora = useRelogio();
  const [aba, setAba] = useState<"chat" | "info">("chat");
  const idNome = useId();

  // Outro lead abre sempre na conversa.
  useEffect(() => {
    setAba("chat");
  }, [contatoId]);

  // O contato sumiu (apagado aqui ou em outra tela, ou o id do endereço não existe) com a gaveta
  // aberta: fecha. Enquanto carrega ou com erro de leitura, não é sumir.
  const sumiu = !!contatoId && !lead && !leitura.carregando && !leitura.erro;
  useEffect(() => {
    if (sumiu) aoFechar();
  }, [sumiu, aoFechar]);
  const esperando = !!contatoId && !lead && (leitura.carregando || !!leitura.erro);

  const nome = lead ? nomeDoContato(lead.contato) : "";
  const info = lead ? (
    <InfoLead contato={lead.contato} conversa={lead.conversa} agora={agora} aoApagar={aoFechar} idNome={idNome} />
  ) : null;
  const chat =
    lead && lead.conversa ? (
      <ConversaLead
        contato={lead.contato}
        conversa={lead.conversa}
        agora={agora}
        aoFechar={estreita ? undefined : aoFechar}
        mostrarNome={estreita}
      />
    ) : null;

  return (
    <Gaveta
      aberta={!!lead || esperando}
      aoFechar={aoFechar}
      rotulo={lead ? `Conversa com ${nome}` : "Conversa com o lead"}
      largura={LARGURA_GAVETA}
      className={s.glGaveta}
    >
      {esperando ? (
        <div className={s.glCorpo}>
          <div className={s.glChat}>
            <div className={s.glRolo}>
              {leitura.erro ? (
                <ErroLeitura titulo="Não deu para abrir este lead" erro={leitura.erro} tentarDeNovo={leitura.tentarDeNovo} />
              ) : (
                <Carregando forma="lista" quantos={4} rotulo="Carregando o lead" />
              )}
            </div>
          </div>
        </div>
      ) : lead ? (
        estreita ? (
          <div className={s.glCorpo} data-estreita="">
            <div className={s.glAbas}>
              <button type="button" className={s.glVoltar} aria-label="Voltar" onClick={aoFechar}>
                <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <div className={s.glSeg} role="group" aria-label="Mostrar">
                <button type="button" aria-pressed={aba === "chat"} onClick={() => setAba("chat")}>
                  Conversa
                </button>
                <button type="button" aria-pressed={aba === "info"} onClick={() => setAba("info")}>
                  Sobre o lead
                </button>
              </div>
            </div>
            {aba === "chat" ? (chat ?? info) : info}
          </div>
        ) : (
          <div className={s.glCorpo}>
            {info}
            {chat ?? <SemConversa empresa={lead.contato.empresa} />}
          </div>
        )
      ) : null}
    </Gaveta>
  );
}

/** Contato sem conversa (não acontece no exemplo, mas o banco permite). */
function SemConversa({ empresa }: { empresa: string | null }) {
  return (
    <div className={s.glChat}>
      <div className={s.glRolo}>
        <div className={s.glLista}>
          <EventoConversa
            texto={
              <>
                <Building2 aria-hidden="true" size={14} /> Nenhuma conversa com este contato{empresa ? ` (${empresa})` : ""}.
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
