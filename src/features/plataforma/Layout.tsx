import { QueryClientContext } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import { Aviso, Botao, BotaoIcone, BotaoLink, Esqueleto } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";
import { iniciais as iniciaisDoNome } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import BrandLogo from "@/components/brand/BrandLogo";
import { ASSISTANT_NAME, PRODUCT_NAME, BRAND_AUTHOR } from "@/lib/brand";
import {
  DURACAO_VOO_LONGO_MS,
  esperarElemento,
  movimentoReduzido,
  rolarAteEMedir,
  useVooJanete,
} from "@/components/janete/VooJanete";
import {
  limparEstadoOnboarding,
  onboardingConcluido,
  useOnboarding,
  type Respostas,
} from "@/features/onboarding/estado";
import { firebase } from "@/integrations/firebase/client";

import { AREAS, GRUPOS, areaDoCaminho, areaPorId, areasDoPapel, areaVisivelPara, type Area, type AreaId } from "./areas";
import { atalhosDoPapel, type Atalho } from "./atalhos";
import { CarregandoArea, ESPERA_ESQUELETO_MS, VisitaDaArea, idTituloArea, novaVisita, type Visita } from "./AreaVazia";
import { esquecerRascunhos } from "./comum/CaixaEscrever";
import { ProvedorConta, useContaDoFirebase, type ContaPlataforma } from "./conta";
import { reiniciarContexto } from "./contexto/loja";
import {
  AssinanteTempoReal,
  ProvedorDados,
  useClienteDados,
  useDados,
  type ClienteFirebase,
  type ConfiguracaoDados,
  type ServidorDados,
  type VersaoContextoBanco,
} from "./dados";
import { esquecerLinks } from "./dados/midia";
import { servidorDaPlataforma } from "./dados/servidor.functions";
import { criarEstadoInicial } from "./exemplo/dados";
import { useExemplo } from "./exemplo/ProvedorExemplo";
import type { EstadoBase } from "./exemplo/tipos";
import { ID_PAINEL, PainelJanete, idAcao, idAtalho, type FasePainel, type MensagemPainel } from "./PainelJanete";
import { ProvedorPapel, usePapel, type Papel } from "./papel";
import estilos from "./Plataforma.module.css";
import { curto, iniciaisDe, nomeDaEmpresa, primeiroNome } from "./texto";
import {
  TOUR_POR_PESSOA,
  esquecerTour,
  marcadorDoTour,
  molduraDe,
  paradasDoTour,
  posGuia,
  type EstadoTour,
  type MarcadorTour,
} from "./tour";

export { AREAS, type Area, type AreaId } from "./areas";
export { AreaVazia, VistaArea } from "./AreaVazia";

const s = estilos as Classes<
  | "raiz"
  | "plat"
  | "rev0"
  | "revAbre"
  | "ic"
  | "sr"
  | "lado"
  | "ladoTopo"
  | "marca"
  | "ladoNome"
  | "ladoNav"
  | "ladoGrupo"
  | "ladoTitulo"
  | "ladoLista"
  | "item"
  | "itemIcone"
  | "itemNome"
  | "ladoPe"
  | "ladoStatus"
  | "platMain"
  | "platTopo"
  | "platTopoM"
  | "topoMAcoes"
  | "trilha"
  | "trilhaEmp"
  | "topoDir"
  | "pilula"
  | "contaTopo"
  | "contaTopoTexto"
  | "contaTopoNome"
  | "contaTopoOsso"
  | "meta"
  | "avatar"
  | "platConteudo"
  | "moldura"
  | "sumir"
  | "guia"
  | "guiaOculto"
  | "casa"
  | "guiaWrap"
  | "ey1"
  | "ey2"
  | "ex1"
  | "ex2"
  | "guiaPonto"
  | "balao"
  | "balaoOculto"
  | "fim"
  | "olho"
  | "balaoTexto"
  | "balaoAcoes"
  | "balaoBotoes"
  | "balaoConta"
  | "gatilho"
  | "gatilhoPonto"
>;

/* Ícones de traço do F. */
const IC = {
  seta: "m9 18 6-6-6-6",
  tour: "M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
  ok: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M9 12l2 2 4-4",
  pendente: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0",
  alerta: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 8v4M12 16h.01",
};

function Icone({ d, className }: { d: string; className?: string }) {
  return (
    <svg className={cx(s.ic, className)} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

type Revelacao = "0" | "abre" | "ok";

interface EstadoPlataforma {
  /** A plataforma abrindo a partir do canto: fechada ('0'), abrindo, aberta. */
  platRev: Revelacao;
  tour: EstadoTour;
  parada: number;
  /** A parada cujo texto está no balão (troca quando o guia chega). */
  paradaVisivel: number;
  /** O guia está (ou vai) para a casa dele, no canto. */
  saindo: boolean;
  viajando: boolean;
  estica: number;
  eixo: "ex" | "ey";
  guiaOculto: boolean;
  tourVisto: boolean;
  novidade: boolean;
  painel: FasePainel;
  telaCheia: boolean;
  mensagens: MensagemPainel[];
  digitando: boolean;
  falando: boolean;
}

const BASE: EstadoPlataforma = {
  platRev: "ok",
  tour: "fora",
  parada: 0,
  paradaVisivel: 0,
  saindo: false,
  viajando: false,
  estica: 0,
  eixo: "ex",
  guiaOculto: false,
  tourVisto: false,
  novidade: false,
  painel: "fechado",
  telaCheia: false,
  mensagens: [],
  digitando: false,
  falando: false,
};

/** O começo do tour: o guia sai da casa dele (o canto) para a 1ª parada. */
const TOUR_COMECO: Partial<EstadoPlataforma> = {
  parada: 0,
  paradaVisivel: 0,
  tour: "ativo",
  saindo: true,
  viajando: true,
  estica: 0,
  eixo: "ex",
};

function telaCheiaAgora(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 899px)").matches;
  } catch {
    return false;
  }
}

/**
 * A casca da plataforma (a t6 do F): o menu das 7 áreas, o topo, a área aberta (Outlet), o tour e o
 * botão da Janete no canto com o painel "Fale com a Janete".
 *
 * Chegada: vindo do preparo, há um símbolo da Janete em voo (`useVooJanete().ativo`). A plataforma
 * começa fechada no círculo do canto, o símbolo voa até o guia do tour, o guia aparece por baixo
 * dele, o símbolo sai e a plataforma abre a partir do canto; então o tour começa. Sem voo (página
 * recarregada, link direto), a plataforma já aparece aberta, e o tour começa sozinho uma vez por
 * pessoa (`membros.vistos.tour`, decisão 15); na casca do exemplo, uma vez por aba, depois do onboarding.
 *
 * Ligada ao banco (spec de ligar as telas ao banco, 2.2): o `Layout` da rota /app monta a camada de
 * dados no modo banco (ProvedorDados) e o assinante do tempo real; o papel vem do Eu (`membros.papel`),
 * o nome do topo de `membros.nome`, a empresa e o tom do Contexto atual, o contador do Chat de
 * `useAguardando` e o rodapé do WhatsApp de `useConexaoAtiva`. O Sair limpa o cache do React Query.
 * No modo banco não há exemplo em memória: todas as áreas leem pela camada de dados (`useDados()` e
 * os hooks de dados/<área>.ts, que só chamam `useExemplo()` no modo exemplo).
 *
 * `LayoutExemplo` é a mesma casca sobre o exemplo em memória (os testes): a conta do topo vem do
 * Firebase (user_metadata.nome), a empresa e o tom das respostas do onboarding, e o papel troca pelo
 * setPapel (como atendente, o topo mostra a Marina, o `eu` do exemplo).
 */
export function Layout() {
  // As funções de servidor da F4 (dados/servidor.functions.ts): a passada de envio logo depois de
  // gravar (decisão 7), o bucket garantido antes do 1º upload, o "lido" no WhatsApp (decisão 6) e o
  // apagar contato.
  return <LayoutBanco servidor={servidorDaPlataforma} />;
}

export interface PropsLayoutBanco {
  /** O cliente do Firebase (testes passam um falso). Padrão: o do navegador. */
  cliente?: ClienteFirebase | undefined;
  /**
   * As funções de servidor (pedirEnvio, garantirBucketMidias, marcarLidaNoWhatsApp, apagarContato).
   * A rota passa `servidorDaPlataforma`; sem elas (testes), a camada usa os padrões seguros dela.
   */
  servidor?: ServidorDados | undefined;
  /** O tour uma vez por pessoa, por `vistos.tour` e `marcar_visto`. Padrão: TOUR_POR_PESSOA (sim). */
  tourPorPessoa?: boolean | undefined;
}

/** A casca ligada ao banco. O Eu já está no cache: a rota /app carregou antes (exigirAcesso). */
export function LayoutBanco({ cliente, servidor, tourPorPessoa = TOUR_POR_PESSOA }: PropsLayoutBanco) {
  const navigate = useNavigate();
  // A conta foi desativada (ou deixou de ser membro) no meio da sessão: o Eu relido vem vazio.
  const aoPerderAcesso = useCallback(() => void navigate({ to: "/sem-acesso", replace: true }), [navigate]);
  return (
    <ProvedorDados fonte="banco" cliente={cliente} servidor={servidor} aoPerderAcesso={aoPerderAcesso}>
      <AssinanteTempoReal />
      <CascaBanco tourPorPessoa={tourPorPessoa} />
    </ProvedorDados>
  );
}

/** O nome da empresa e o tom de voz do Contexto atual, no formato das respostas do onboarding. */
export function respostasDoContexto(contexto: VersaoContextoBanco | null | undefined): Respostas {
  const respostas: Respostas = {};
  if (contexto?.empresa_oferta) respostas.empresa_oferta = contexto.empresa_oferta;
  if (contexto?.tom_voz) respostas.tom_voz = contexto.tom_voz;
  return respostas;
}

/** O aviso do atendente enquanto o admin não conclui o onboarding (decisão 2): a Janete ainda não atende. */
export const AVISO_ONBOARDING_ABERTO = `O admin ainda está configurando a ${ASSISTANT_NAME}.`;

/**
 * O aviso do admin com o onboarding da empresa aberto (decisão 2). Ele chega a /app sem concluir: o
 * admin convidado (o /convite leva direto a /app) e quem abre /app/... pelo endereço ou por um
 * favorito (a rota /app só exige o Eu, spec 2.2).
 */
export const AVISO_ONBOARDING_ADMIN = `O onboarding ainda não foi concluído: a ${ASSISTANT_NAME} não atende.`;

/** O aviso do topo da área. `irParaOnboarding`: mostra o botão que leva ao /onboarding (só o admin). */
export interface AvisoCasca {
  texto: string;
  irParaOnboarding: boolean;
}

/**
 * O aviso do topo da área enquanto `configuracao.onboarding_concluido_em` for nulo (a Janete não
 * atende: o pegar_rodadas devolve vazio). O atendente vê `AVISO_ONBOARDING_ABERTO` (ele lê pela
 * policy configuracao_membro_le); o admin vê `AVISO_ONBOARDING_ADMIN`, com o botão para concluir.
 * Enquanto a configuração não chega, ou se a leitura falhar, não afirma nada.
 */
export function avisoDaCasca(
  papel: Papel,
  configuracao: Pick<ConfiguracaoDados, "onboarding_concluido_em"> | undefined,
): AvisoCasca | null {
  if (!configuracao || configuracao.onboarding_concluido_em !== null) return null;
  return papel === "admin"
    ? { texto: AVISO_ONBOARDING_ADMIN, irParaOnboarding: true }
    : { texto: AVISO_ONBOARDING_ABERTO, irParaOnboarding: false };
}

function CascaBanco({ tourPorPessoa }: { tourPorPessoa: boolean }) {
  const dados = useDados();
  const { membro } = dados.useEu();
  const contexto = dados.useContextoAtual();
  const configuracao = dados.useConfiguracao();
  const aviso = avisoDaCasca(membro.papel, configuracao.dados);
  const respostas = useMemo(() => respostasDoContexto(contexto.dados), [contexto.dados]);
  const conta = useMemo<ContaPlataforma>(
    () => ({ id: membro.user_id ?? "", nome: membro.nome, email: membro.email, carregada: true }),
    [membro.user_id, membro.nome, membro.email],
  );
  const acoes = dados.acoes;
  const tour = tourPorPessoa
    ? marcadorDoTour({ porPessoa: true, vistoEm: membro.vistos.tour, marcarNoBanco: () => void acoes.marcarVisto("tour") })
    : marcadorDoTour({ porPessoa: false, onboardingConcluido: onboardingConcluido() });
  const nome = membro.nome.trim();
  return (
    <ProvedorPapel papel={membro.papel}>
      <Casca
        identidade={{
          conta,
          nomeExibido: nome || "Você",
          iniciais: iniciaisDe(nome),
          nome,
          respostas,
          tour,
          aviso,
        }}
      />
    </ProvedorPapel>
  );
}

export interface PropsLayoutExemplo {
  /** O estado do exemplo. Padrão: o de hoje (criarEstadoInicial). */
  exemplo?: EstadoBase | (() => EstadoBase) | undefined;
  /** O papel do começo (o setPapel troca). Padrão: admin. */
  papelInicial?: Papel | undefined;
}

/** A casca sobre o exemplo em memória, sem banco (os testes). */
export function LayoutExemplo({ exemplo, papelInicial }: PropsLayoutExemplo = {}) {
  return (
    <ProvedorPapel inicial={papelInicial}>
      <ProvedorDados exemplo={exemplo ?? (() => criarEstadoInicial(new Date()))}>
        <CascaExemplo />
      </ProvedorDados>
    </ProvedorPapel>
  );
}

function CascaExemplo() {
  const { papel } = usePapel();
  const { estado: exemplo } = useExemplo();
  const { estado: onboarding } = useOnboarding();
  // O nome e o e-mail vêm da conta do Firebase (user_metadata.nome), buscados uma vez aqui; as áreas
  // (a Equipe) leem pelo ProvedorConta.
  const conta = useContaDoFirebase();
  // Como atendente, a conta do topo passa a ser a da Marina (o `eu` do exemplo), senão o "Com você"
  // das telas pareceria ser a conta real. Como admin, o topo mostra a conta real. Antes de a conta
  // chegar, o topo não afirma "Você"/"VC": osso no nome e avatar sem letras.
  const comoAtendente = papel === "atendente";
  const nomeExibido = comoAtendente ? exemplo.eu.nome : conta.carregada ? conta.nome || "Você" : null;
  const iniciais = comoAtendente ? iniciaisDoNome(exemplo.eu.nome) : conta.carregada ? iniciaisDe(conta.nome) : null;
  const tour = marcadorDoTour({ porPessoa: false, onboardingConcluido: onboardingConcluido() });
  return (
    <Casca
      identidade={{
        conta,
        nomeExibido,
        iniciais,
        nome: conta.nome,
        respostas: onboarding.conversa.respostas,
        tour,
      }}
    />
  );
}

/** Quem usa e o que a casca mostra dele (vem do banco ou do exemplo). */
interface IdentidadeCasca {
  /** A conta (o id compara com o da sessão para notar a troca feita em outra aba; as áreas leem). */
  conta: ContaPlataforma;
  /** O nome do topo; null enquanto carrega (osso no lugar). */
  nomeExibido: string | null;
  /** As iniciais do avatar; null enquanto carrega. */
  iniciais: string | null;
  /** O nome de quem usa, para o "Oi, equipe" da Janete. */
  nome: string;
  /** A empresa (empresa_oferta) e o tom de voz (tom_voz), para o topo e os atalhos da Janete. */
  respostas: Respostas;
  tour: MarcadorTour;
  /** Um aviso no topo da área (o do onboarding aberto). Nulo = nenhum. */
  aviso?: AvisoCasca | null | undefined;
}

/** O fluxo da Configuração em tela cheia (celular): um diálogo que vai por portal para o <body>. */
const SELETOR_FLUXO_MODAL = '#cfg-fluxo[aria-modal="true"]';

/**
 * Se o fluxo da Configuração em tela cheia está aberto. Ele vai por portal para o <body>, fora da
 * casca: um observador olha os filhos diretos do <body> (onde os portais entram) e o aria-modal.
 * Enquanto ele está aberto, o menu (o dock, no celular) e a área ficam inert e aria-hidden, como no
 * protótipo: o Tab já ficava preso no fluxo, mas o leitor de tela ainda alcançava a página de trás.
 */
function useFluxoModalAberto(): boolean {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const ler = () => setAberto(!!document.querySelector(SELETOR_FLUXO_MODAL));
    ler();
    // Dois observadores: um segundo observe() no mesmo alvo trocaria as opções do primeiro, e juntar
    // childList com subtree acordaria a cada mudança do DOM do app inteiro.
    const portais = new MutationObserver(ler);
    portais.observe(document.body, { childList: true });
    const modal = new MutationObserver(ler);
    modal.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
    return () => {
      portais.disconnect();
      modal.disconnect();
    };
  }, []);
  return aberto;
}

/**
 * Se a etapa do Kanban está aberta como chat no celular (o EtapaChat põe o data-tela-cheia só no
 * celular, num portal para o <body>). Ela fica embaixo do dock e do botão da Janete, como no protótipo
 * Kanban 2, então só o <main> fica inert e aria-hidden: sem isso, o Tab e o leitor de tela
 * alcançavam o topo e a barra do quadro, escondidos atrás dela.
 */
function useEtapaTelaCheia(): boolean {
  const [aberta, setAberta] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const ler = () => setAberta(!!document.querySelector("[data-tela-cheia]"));
    ler();
    // Como no useFluxoModalAberto: o portal entra e sai dos filhos do <body>, e o atributo pode trocar
    // sem o portal sair.
    const portais = new MutationObserver(ler);
    portais.observe(document.body, { childList: true });
    const atributo = new MutationObserver(ler);
    atributo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-tela-cheia"] });
    return () => {
      portais.disconnect();
      atributo.disconnect();
    };
  }, []);
  return aberta;
}

/**
 * Baixa em segundo plano o código das áreas do menu, uma por vez, quando o navegador fica livre. O
 * código de cada área é um arquivo à parte (a divisão do código do TanStack Start), que sem isto só
 * descia na 1ª visita: o topo e o menu já mostravam a área nova e o conteúdo continuava o da anterior
 * até o arquivo chegar (02/11: 620 a 800 ms com o código levando 600 ms). Com o código baixado, o
 * clique troca na hora; se vier antes, a rota mostra o esqueleto da área (CarregandoArea).
 *
 * Não disputa com o resto: espera a plataforma abrir (`ligado`), cede a vez enquanto houver leitura do
 * banco em andamento (as da área aberta vêm antes; no máximo ~6 s de adiamento), e não baixa nada com
 * a economia de dados ligada ou em rede 2G (aí a 1ª visita a cada área mostra o esqueleto).
 */
function usePrecarregarAreas(rotas: readonly Area["rota"][], ligado: boolean) {
  const router = useRouter();
  const queryClient = useContext(QueryClientContext) ?? null;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const rotasRef = useRef(rotas);
  rotasRef.current = rotas;
  const chave = rotas.join(" ");
  useEffect(() => {
    if (!ligado || redeEconomica()) return;
    let parado = false;
    let cancelar: (() => void) | undefined;
    let adiamentos = 0;
    const fila = [...rotasRef.current];
    const quandoLivre = (fn: () => void) => {
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(fn, { timeout: 2000 });
        cancelar = () => window.cancelIdleCallback(id);
      } else {
        const id = window.setTimeout(fn, 300);
        cancelar = () => window.clearTimeout(id);
      }
    };
    // Com leitura em andamento, tenta de novo em 300 ms: o ocioso do navegador voltaria quase na hora
    // (ele fica livre enquanto a leitura espera a rede), e os adiamentos acabariam em menos de 1 s.
    const adiar = () => {
      const id = window.setTimeout(proxima, 300);
      cancelar = () => window.clearTimeout(id);
    };
    const proxima = () => {
      if (parado) return;
      if ((queryClientRef.current?.isFetching() ?? 0) > 0 && adiamentos < 20) {
        adiamentos += 1;
        adiar();
        return;
      }
      const rota = fila.shift();
      if (!rota) return;
      const rotaDoRouter = router.routesById[rota];
      // Uma falha (rede) não para a fila: a 1ª visita àquela área tenta de novo.
      void Promise.resolve(rotaDoRouter ? router.loadRouteChunk(rotaDoRouter) : undefined)
        .catch(() => undefined)
        .then(() => {
          if (!parado) quandoLivre(proxima);
        });
    };
    quandoLivre(proxima);
    return () => {
      parado = true;
      cancelar?.();
    };
  }, [router, chave, ligado]);
}

/** Economia de dados ligada, ou rede 2G (a Network Information API; quem não tem conta como rede boa). */
function redeEconomica(): boolean {
  const conexao = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!conexao?.saveData || /2g$/.test(conexao?.effectiveType ?? "");
}

/**
 * A área do endereço que a casca está esperando há mais de ESPERA_ESQUELETO_MS (nula se nenhuma). Na
 * troca, o endereço (o topo e o menu) muda na hora, e o Outlet só muda quando o roteador termina: o
 * acesso de /app (exigirAcesso, cujo getSession pode renovar o login pela rede numa aba que volta
 * depois de horas parada; medido em 02/11: 2,9 s do conteúdo anterior sob o título novo) e o código da
 * área. O `pendingComponent` das rotas só cobre o código; isto cobre o resto. Depois de começar, a
 * espera segue a área do endereço sem esperar de novo (outro clique no meio troca o esqueleto na hora).
 */
function useEsperaDaTroca(doEndereco: AreaId | null, naTela: AreaId | null): AreaId | null {
  const diverge = doEndereco !== null && naTela !== null && doEndereco !== naTela;
  const [emEspera, setEmEspera] = useState(false);
  useEffect(() => {
    if (!diverge) {
      setEmEspera(false);
      return;
    }
    const t = window.setTimeout(() => setEmEspera(true), ESPERA_ESQUELETO_MS);
    return () => window.clearTimeout(t);
  }, [diverge]);
  return diverge && emEspera ? doEndereco : null;
}

/** Quanto a lista precisa andar numa direção, somando os passos, para o botão da Janete trocar (px). */
const LIMIAR_GATILHO = 8;

/**
 * No celular, o botão da Janete some enquanto uma lista desce e volta quando ela sobe ou chega ao topo
 * (decisão A44, 02/11): parado no canto, ele cobria a foto de uma conversa. Vale para qualquer rolagem
 * fora de diálogos (o painel da Janete, a gaveta do lead); no computador, nunca some. Trocar de área ou o
 * botão voltar à tela (fim do tour, painel fechado) mostra de novo.
 */
function useGatilhoEscondido(caminho: string, mostrar: boolean): boolean {
  const [escondido, setEscondido] = useState(false);
  useEffect(() => setEscondido(false), [caminho]);
  useEffect(() => {
    if (mostrar) setEscondido(false);
  }, [mostrar]);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const celular = window.matchMedia("(max-width: 899px)");
    // Por elemento: a última posição e a âncora, onde a direção atual começou. A distância conta da
    // âncora, não do evento anterior: quem rola devagar (menos de 1 px por quadro) também troca.
    const rastros = new WeakMap<object, { ultima: number; ancora: number }>();
    const aoRolar = (ev: Event) => {
      if (!celular.matches) return;
      const alvo = ev.target;
      if (alvo instanceof Element) {
        if (alvo.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return;
      } else if (document.querySelector('[aria-modal="true"]')) {
        // o documento rolando por trás de um painel em tela cheia não conta
        return;
      }
      const el = alvo instanceof Element ? alvo : document.scrollingElement;
      if (!el) return;
      // O rebote do iPhone passa do fim e volta: sem o limite, pareceria uma subida no fim da lista.
      const topo = Math.min(el.scrollTop, Math.max(0, el.scrollHeight - el.clientHeight));
      const r = rastros.get(el);
      if (!r) {
        rastros.set(el, { ultima: topo, ancora: topo });
        return;
      }
      // Rolagem só de lado (o carrossel de etapas, as abas): a posição vertical não muda e não conta.
      if (topo === r.ultima) return;
      const desce = topo > r.ultima;
      if (r.ultima !== r.ancora && desce !== r.ultima > r.ancora) r.ancora = r.ultima;
      r.ultima = topo;
      // No topo, aparece. Numa lista em column-reverse (as mensagens), o scrollTop nunca passa de 0, e
      // o botão fica sempre à vista.
      if (topo <= 0) {
        setEscondido(false);
        return;
      }
      if (topo - r.ancora > LIMIAR_GATILHO) setEscondido(true);
      else if (r.ancora - topo > LIMIAR_GATILHO) setEscondido(false);
    };
    const aoMudarLargura = () => {
      if (!celular.matches) setEscondido(false);
    };
    document.addEventListener("scroll", aoRolar, { capture: true, passive: true });
    celular.addEventListener?.("change", aoMudarLargura);
    return () => {
      document.removeEventListener("scroll", aoRolar, { capture: true });
      celular.removeEventListener?.("change", aoMudarLargura);
    };
  }, []);
  return escondido;
}

function Casca({ identidade }: { identidade: IdentidadeCasca }) {
  const voo = useVooJanete();
  const navigate = useNavigate();
  const caminho = useRouterState({ select: (r) => r.location.pathname });
  const caminhoRef = useRef(caminho);
  caminhoRef.current = caminho;
  const { papel } = usePapel();
  const dados = useDados();
  // O cliente do modo banco (no exemplo, o do navegador): o Sair e a troca de conta usam o auth dele.
  const auth = (useClienteDados() ?? firebase).auth;
  // O cache do React Query (sem provedor em volta, num teste do exemplo, não há o que limpar).
  const queryClient = useContext(QueryClientContext) ?? null;
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const tourRef = useRef(identidade.tour);
  tourRef.current = identidade.tour;
  const marcarTourVisto = () => tourRef.current.marcar();
  // O atendente não vê a Configuração (spec, bloco 1, item 4): ela sai do menu, do dock, dos atalhos
  // da Janete e do tour dele. As paradas vão por ref: o tour lê dentro dos timers.
  const areasVisiveis = areasDoPapel(papel);
  const paradas = paradasDoTour(papel);
  const paradasRef = useRef(paradas);
  paradasRef.current = paradas;

  const [st, setSt] = useState<EstadoPlataforma>(() => {
    const visto = identidade.tour.visto;
    if (voo.ativo) {
      return { ...BASE, ...TOUR_COMECO, platRev: "0", guiaOculto: true, tourVisto: visto };
    }
    return { ...BASE, tourVisto: visto };
  });
  // Decidido uma vez, ao abrir: o tour começa sozinho na primeira visita (por pessoa, com o banco;
  // na regra de hoje, depois do onboarding, nesta aba). Não dá para reler o marcador no efeito:
  // iniciarTour() grava o marcador, e se o efeito rodar de novo (o React monta duas vezes em
  // desenvolvimento) o tour ficaria preso no começo.
  const [tourNaChegada] = useState(
    () => !voo.ativo && !identidade.tour.visto && identidade.tour.podeComecarSozinho,
  );
  const atual = useRef(st);
  const set = (mudanca: Partial<EstadoPlataforma> | ((a: EstadoPlataforma) => Partial<EstadoPlataforma>)) =>
    setSt((a) => {
      const novo = { ...a, ...(typeof mudanca === "function" ? mudanca(a) : mudanca) };
      atual.current = novo;
      return novo;
    });

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  const limpar = () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  };
  const focar = (id: string, ms = 60) =>
    later(() => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }, ms);
  const mov = () => !movimentoReduzido();
  const seq = useRef(0);

  const respostas = identidade.respostas;
  const respostasRef = useRef(respostas);
  respostasRef.current = respostas;

  /* ---------- quem está usando (do Eu, com o banco; da conta do Firebase, no exemplo) ---------- */
  const conta = identidade.conta;
  const nome = identidade.nome;

  // O estado do onboarding, o marcador do tour e o cache do React Query (o Eu, as conversas...)
  // ficam na aba sem dizer de qual conta são: ao sair, apagar os três, senão a próxima conta que
  // entrar nesta aba herda os da anterior. Como na casca do onboarding, navega antes de limpar:
  // limpar primeiro esvaziaria as áreas que leem a sessão (Contexto, Configuração, o topo) enquanto
  // o signOut não volta, e o Eu sumido do cache suspenderia a casca. A limpeza roda quando o Layout
  // desmonta, já em /entrar.
  const [saindo, setSaindo] = useState(false);
  const saindoRef = useRef(false);
  const limparAoDesmontar = useRef(false);
  const contaIdRef = useRef(conta.id);
  contaIdRef.current = conta.id;

  useEffect(
    () => () => {
      if (!limparAoDesmontar.current) return;
      limparAoDesmontar.current = false;
      limparAoSair();
    },
    [],
  );

  // O que fica na aba sem dizer de qual conta é: o onboarding, o tour, o cache do React Query, o
  // Contexto (os rascunhos não salvos, a versão aberta e o jaEntrou ficam no nível do módulo, e o
  // Sair navega sem recarregar: o próximo admin desta aba veria o texto do anterior como dele), os
  // rascunhos da caixa de escrever e os links assinados das mídias.
  const limparAoSair = () => {
    limparEstadoOnboarding();
    esquecerTour();
    reiniciarContexto();
    esquecerRascunhos();
    const qc = queryClientRef.current;
    if (qc) {
      esquecerLinks(qc);
      qc.clear();
    }
  };

  const irParaEntrar = async () => {
    limparAoDesmontar.current = true;
    try {
      await navigate({ to: "/entrar", replace: true });
    } catch {
      limparAoDesmontar.current = false;
      limparAoSair();
      window.location.assign("/entrar");
    }
  };

  const sair = async () => {
    if (saindoRef.current) return;
    saindoRef.current = true;
    setSaindo(true);
    try {
      await auth.signOut();
    } catch {
      // mesmo com falha de rede, a tela volta para o login
    }
    await irParaEntrar();
  };

  // Saída ou troca de conta feita em outra aba: o firebase-js avisa esta aba, e as chamadas daqui
  // passam a usar a sessão nova. Faz o mesmo que o Sair, para esta aba não continuar mostrando o
  // nome, o e-mail e o onboarding da conta anterior.
  useEffect(() => {
    let adiado: ReturnType<typeof setTimeout> | undefined;
    let assinatura: { unsubscribe: () => void } | undefined;
    try {
      const { data } = auth.onAuthStateChange((evento, sessao) => {
        if (saindoRef.current) return;
        const idSessao = sessao?.user?.id ?? "";
        const idConta = contaIdRef.current;
        const trocou = evento === "SIGNED_OUT" || (!!idConta && !!idSessao && idSessao !== idConta);
        if (!trocou) return;
        saindoRef.current = true;
        // Fora do callback: o firebase-js pede que ele não espere outras chamadas.
        adiado = setTimeout(() => void irParaEntrar(), 0);
      });
      assinatura = data.subscription;
    } catch {
      // cliente sem eventos de sessão: a troca só é notada na próxima chamada ao banco
    }
    return () => {
      if (adiado) clearTimeout(adiado);
      assinatura?.unsubscribe();
    };
    // Só na montagem: irParaEntrar e a conta são lidos por ref e pelo navigate do roteador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirArea = (area: AreaId) => navigate({ to: areaPorId(area).rota });

  /* ---------- tour (iniciarTour, irParada, encerrarTour do F) ---------- */

  const iniciarTour = () => {
    limpar();
    marcarTourVisto();
    set({
      ...TOUR_COMECO,
      painel: "fechado",
      falando: false,
      digitando: false,
      guiaOculto: false,
      platRev: "ok",
    });
    abrirArea("chat");
    const m = mov();
    later(() => set((a) => ({ saindo: false, estica: a.estica + 1, eixo: "ex" })), m ? 380 : 0);
    later(() => {
      set({ viajando: false });
      focar("tour-proximo");
    }, m ? 1180 : 60);
  };

  const irParada = (n: number) => {
    const a = atual.current;
    const lista = paradasRef.current;
    const ultima = lista.length - 1;
    if (a.tour !== "ativo" || n === a.parada || n < 0 || n > ultima) return;
    limpar();
    const eixo = n === ultima || a.parada >= ultima ? "ex" : "ey";
    const destino = lista[n]!.area ?? lista[n]!.vista;
    set((x) => ({ parada: n, saindo: false, viajando: true, estica: x.estica + 1, eixo, guiaOculto: false, platRev: "ok" }));
    if (destino) abrirArea(destino);
    later(() => {
      set({ viajando: false, paradaVisivel: n });
      focar("tour-proximo");
    }, mov() ? 800 : 60);
  };

  const encerrarTour = () => {
    if (atual.current.tour !== "ativo") return;
    limpar();
    set((x) => ({ tour: "casa", saindo: false, viajando: true, estica: x.estica + 1, eixo: "ex", guiaOculto: false, platRev: "ok" }));
    later(() => {
      set({ tour: "fora", viajando: false, tourVisto: true, novidade: true });
      focar("janete-gatilho");
    }, mov() ? 900 : 60);
  };

  // O papel mudar no meio do tour (hoje nada na casca o troca; com o banco, virá da conta): a parada
  // fica presa ao fim da lista nova e a rota vai junto, senão o balão de uma área ficaria sobre a tela
  // de outra. A 1ª execução (a montagem) não conta.
  const primeiraDoPapel = useRef(true);
  useEffect(() => {
    if (primeiraDoPapel.current) {
      primeiraDoPapel.current = false;
      return;
    }
    if (atual.current.tour !== "ativo") return;
    const lista = paradasRef.current;
    const n = Math.min(atual.current.parada, lista.length - 1);
    set({ parada: n, paradaVisivel: n });
    const destino = lista[n]!.area ?? lista[n]!.vista;
    if (destino) abrirArea(destino);
    // Só quando o papel muda: o resto é lido pelos refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papel]);

  /* ---------- Fale com a Janete (abrirJanete, abrirPainel, minimizarJanete, fecharJanete) ---------- */

  const abrirPainel = () => {
    set({ painel: "abrindo", novidade: false, telaCheia: telaCheiaAgora() });
    later(() => {
      if (atual.current.painel === "abrindo") set({ painel: "aberto" });
    }, mov() ? 540 : 0);
    // Enquanto a Janete responde, os atalhos não estão na tela: o foco fica no próprio painel.
    focar(atual.current.falando ? ID_PAINEL : idAtalho(0));
  };

  const abrirJanete = () => {
    const a = atual.current;
    if (a.painel === "aberto" || a.painel === "abrindo") return;
    if (a.tour === "casa" || a.platRev !== "ok") return;
    if (a.tour === "ativo") {
      limpar();
      if (mov()) {
        set((x) => ({ tour: "casa", saindo: false, viajando: true, estica: x.estica + 1, eixo: "ex", guiaOculto: false }));
        abrirArea("chat");
        later(() => {
          set({ tour: "fora", viajando: false, tourVisto: true });
          abrirPainel();
        }, 900);
        return;
      }
      set({ tour: "fora", viajando: false, tourVisto: true, guiaOculto: false });
      abrirArea("chat");
    }
    abrirPainel();
  };

  const fecharPainelE = (depois: () => void) => {
    const a = atual.current;
    if (a.painel === "fechado" || a.painel === "fechando") return;
    if (!mov()) {
      set({ painel: "fechado" });
      depois();
      return;
    }
    set({ painel: "fechando" });
    later(() => {
      if (atual.current.painel === "fechando") {
        set({ painel: "fechado" });
        depois();
      }
    }, 360);
  };

  const minimizarJanete = () => fecharPainelE(() => focar("janete-gatilho"));

  // Fechar interrompe a resposta em curso e fecha como o minimizar; as mensagens continuam ao
  // reabrir (o fecharJanete do F só zera o modo e minimiza).
  const fecharJanete = () => {
    limpar();
    set({ falando: false, digitando: false });
    fecharPainelE(() => focar("janete-gatilho"));
  };

  const responderAtalho = (atalho: Atalho) => {
    if (atual.current.falando) return;
    seq.current += 1;
    const eu: MensagemPainel = { id: seq.current, de: "eu", texto: atalho.pergunta };
    // Os atalhos saem da tela enquanto a Janete fala: o foco vai antes para o painel, senão cairia
    // no body (e o Esc e o Tab preso do celular deixariam de responder).
    document.getElementById(ID_PAINEL)?.focus({ preventScroll: true });
    set((x) => ({ mensagens: [...x.mensagens, eu], falando: true }));
    const texto = atalho.resposta(respostasRef.current);
    const k = mov() ? 1 : 0.35;
    let t = Math.round(380 * k);
    later(() => set({ digitando: true }), t);
    t += Math.round(Math.min(1400, 380 + texto.length * 11) * k);
    later(() => {
      seq.current += 1;
      const id = seq.current;
      const resposta: MensagemPainel = { id, de: "janete", texto, area: atalho.area, botao: atalho.botao };
      set((x) => ({
        digitando: false,
        mensagens: [...x.mensagens, resposta],
        novidade: x.painel === "fechado" ? true : x.novidade,
      }));
      focar(idAcao(id));
    }, t);
    later(() => set({ falando: false }), t + 40);
  };

  // O foco no título da área assim que ele aparece: a área pode ainda estar chegando (o esqueleto da
  // troca não tem o id do título). Não tira o foco de quem focou outra coisa no meio, a não ser de
  // `podeTirarDe` (o painel da Janete que está fechando, no atalho que abriu a área).
  // Até 8 s: a troca pode esperar o login renovar pela rede (2,9 s medidos numa aba que voltou).
  const focarTituloDaArea = (area: AreaId, podeTirarDe?: string) =>
    void esperarElemento(idTituloArea(area), 8000).then((el) => {
      const ativo = document.activeElement;
      const livre =
        !ativo ||
        ativo === document.body ||
        ativo === document.documentElement ||
        !ativo.isConnected ||
        (!!podeTirarDe && !!ativo.closest(podeTirarDe));
      if (el && livre) el.focus({ preventScroll: true });
    });

  // O botão da resposta abre a área e fecha o painel; o foco vai para o título da área.
  const irParaAreaDoPainel = (area: AreaId) => {
    abrirArea(area);
    fecharPainelE(() => focarTituloDaArea(area, `#${ID_PAINEL}`));
  };

  /* ---------- chegada (o fim do irParaPlataforma do F) ---------- */
  useEffect(() => {
    let cancelado = false;
    const chegar = async () => {
      if (!voo.ativo) {
        if (tourNaChegada) {
          iniciarTour();
          return;
        }
        // Sem tour (recarregar, link direto, depois do Entrar): o foco estaria no body; vai para o
        // título da área aberta quando ele aparecer, se ninguém tiver focado outra coisa.
        later(() => focarTituloDaArea((areaDoCaminho(caminhoRef.current) ?? AREAS[0]!).id), 100);
        return;
      }
      marcarTourVisto();
      // o guia já está no canto (a casa dela), escondido: é para ele que o símbolo voa
      const el = await esperarElemento("tour-ponto");
      if (cancelado) return;
      // mede só com o guia na vista e a rolagem parada (a página pode chegar rolada do preparo)
      const alvo = el ? await rolarAteEMedir(el, { bloco: "nearest" }) : null;
      if (cancelado) return;
      if (!alvo || !mov()) {
        voo.soltar();
        iniciarTour();
        return;
      }
      // o botão aparece por baixo do símbolo em voo antes de ele sumir: a troca não pisca
      later(() => set({ guiaOculto: false }), 840);
      await voo.voar(alvo, { duracaoMs: DURACAO_VOO_LONGO_MS, estado: "acordada" });
      if (cancelado) return;
      later(() => {
        voo.soltar();
        set({ guiaOculto: false, platRev: "abre" });
        later(() => set({ platRev: "ok" }), 1100);
        later(() => set((x) => ({ saindo: false, estica: x.estica + 1, eixo: "ex" })), 1200);
        later(() => {
          set({ viajando: false });
          focar("tour-proximo");
        }, 2000);
      }, 60);
    };
    void chegar();
    return () => {
      cancelado = true;
      limpar();
    };
    // Só na montagem: as funções acima leem o estado pelo ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- valores da tela ---------- */

  // A área do endereço: o topo (o caminho) e o menu seguem ela, e mudam na hora do clique.
  const areaDoEndereco = areaDoCaminho(caminho)?.id ?? null;
  const areaAtual = areaPorId(areaDoEndereco ?? AREAS[0]!.id);
  // A área que o Outlet mostra (o último match na tela; o esqueleto do pendingComponent já conta como
  // a área nova). Durante a troca ela fica para trás do endereço até o roteador terminar.
  const areaNaTela = useRouterState({ select: (r) => areaDoCaminho(r.matches[r.matches.length - 1]?.routeId ?? "")?.id ?? null });
  const esperando = useEsperaDaTroca(areaDoEndereco, areaNaTela);
  // O data-area-aberta do <main> ajusta a largura pela área (o Kanban, o Chat e os Contatos ocupam a
  // largura inteira; as outras ficam no limite de 1.344 px). Ele segue o que está na tela: a área
  // anterior enquanto ela fica, e a nova (ou o esqueleto dela) quando entra. Antes ele seguia o
  // endereço, e a área anterior se esticava na largura da nova durante a troca.
  const areaDaLargura = esperando ?? areaNaTela ?? areaAtual.id;
  // A visita de agora: um número novo a cada troca de área. As vistas das áreas usam o número para a
  // animação de entrada rodar uma vez por troca (VisitaDaArea, em AreaVazia.tsx). Um endereço fora
  // das áreas (o Sair indo para /entrar) não abre visita nova.
  const visitaRef = useRef<Visita | null>(null);
  const areaDaVisita = areaDoEndereco ?? visitaRef.current?.area ?? areaAtual.id;
  if (visitaRef.current?.area !== areaDaVisita) visitaRef.current = { area: areaDaVisita, n: novaVisita() };
  const visita = visitaRef.current;
  usePrecarregarAreas(areasVisiveis.map((a) => a.rota), st.platRev === "ok");
  const empresaBruta = nomeDaEmpresa(respostas);
  const empresa = empresaBruta ? curto(empresaBruta, 26) : null;
  // O WhatsApp do rodapé é a conexão ativa (useConexaoAtiva), a mesma da Configuração e da caixa do
  // Chat. Como no protótipo, o que não está conectado fica em vermelho. Enquanto a 1ª leitura não
  // volta, o rodapé não afirma nada.
  const conexaoLida = dados.useConexaoAtiva();
  const conexao = conexaoLida.dados ?? null;
  const lendoConexao = conexaoLida.dados === undefined && conexaoLida.carregando;
  const conexaoIlegivel = conexaoLida.dados === undefined && !conexaoLida.carregando && conexaoLida.erro !== null;
  const conectado = !!conexao && conexao.ativa && conexao.status === "conectada";
  const conectando = !conectado && (lendoConexao || conexao?.status === "conectando");
  const textoStatus = lendoConexao
    ? "Conferindo o WhatsApp"
    : conexaoIlegivel
      ? "Não deu para conferir o WhatsApp"
      : conectado
        ? "WhatsApp conectado"
        : conectando
          ? "Conectando o WhatsApp"
          : conexao?.status === "erro"
            ? "WhatsApp com erro"
            : "WhatsApp desconectado";
  // O contador do item Chat: as conversas do bloco "Precisam de você" (useAguardando).
  const precisamDeVoce = dados.useAguardando().dados?.length ?? 0;
  const { nomeExibido, iniciais } = identidade;
  const metaConta = `${papel === "atendente" ? "Atendente" : "Admin"}${empresa ? ` · ${empresa}` : ""}`;

  const tourAtivo = st.tour === "ativo";
  // O papel mudar no meio do tour encurta a lista: a parada fica presa ao fim da lista nova.
  const ultimaDoPapel = paradas.length - 1;
  const paradaAgora = Math.min(st.parada, ultimaDoPapel);
  const paradaArea = tourAtivo ? (paradas[paradaAgora]?.area ?? null) : null;
  const pos = posGuia(paradaAgora, st.tour, st.saindo, paradas);
  const pv = Math.min(st.paradaVisivel, ultimaDoPapel);
  const paradaVis = paradas[pv]!;
  const ultimaParada = pv === ultimaDoPapel;
  const idxSeta = paradaVis.area ? AREAS.findIndex((a) => a.id === paradaVis.area) : 3;
  const estica = st.estica === 0 ? "" : s[`${st.eixo}${st.estica % 2 ? "1" : "2"}` as "ex1" | "ex2" | "ey1" | "ey2"];
  const guiaFala = !st.viajando && tourAtivo;
  const podeReverTour = st.tour === "fora" && st.tourVisto;

  // Respostas antigas da Janete com botão para uma área que o papel atual não vê (ex.: "Abrir a
  // Configuração" pedido como admin, e depois o papel virou atendente): o texto fica, o botão sai.
  const mensagensDoPapel = st.mensagens.map((m): MensagemPainel => {
    if (!m.area || areaVisivelPara(m.area, papel)) return m;
    const { area: _area, botao: _botao, ...resto } = m;
    return resto;
  });

  const mostraGatilho = st.tour === "fora" && st.painel === "fechado";
  const mostraPainel = st.painel !== "fechado";
  const fluxoModal = useFluxoModalAberto();
  const fundoOculto = (mostraPainel && st.telaCheia) || fluxoModal ? true : undefined;
  // A etapa aberta como chat no celular esconde só a área: o dock e o botão da Janete continuam valendo.
  const etapaTelaCheia = useEtapaTelaCheia();
  const areaOculta = fundoOculto || (etapaTelaCheia ? true : undefined);
  const gatilhoEscondido = useGatilhoEscondido(caminho, mostraGatilho);

  let anuncio = "";
  if (st.platRev !== "ok") anuncio = "A sua plataforma está pronta.";
  else if (st.novidade && st.painel === "fechado")
    anuncio = `A ${ASSISTANT_NAME} está no canto inferior esquerdo. Clique no símbolo dela para conversar.`;

  const clicarItem = (ev: MouseEvent<HTMLAnchorElement>, indice: number) => {
    if (atual.current.tour !== "ativo") return;
    ev.preventDefault();
    irParada(indice + 1);
  };

  const proximo = () => {
    const a = atual.current;
    if (a.paradaVisivel >= paradasRef.current.length - 1) encerrarTour();
    else irParada(a.parada + 1);
  };

  return (
    <div data-identidade="aipro" className={s.raiz}>
      <section className={cx(s.plat, st.platRev === "0" && s.rev0, st.platRev === "abre" && s.revAbre)} aria-label={`Plataforma ${PRODUCT_NAME}`}>
        <aside className={s.lado} aria-label="Menu" aria-hidden={fundoOculto} inert={fundoOculto}>
          <div className={s.ladoTopo}>
            <BrandLogo withName height={36} />
          </div>
          {/* data-dock: o marcador estável do menu (no celular, o dock), para quem precisa escondê-lo
              sem depender do texto do aria-label (o fluxo da Configuração em tela cheia). */}
          <nav
            className={s.ladoNav}
            aria-label="Áreas da plataforma"
            data-dock=""
            data-realce={(tourAtivo && paradaAgora === 0) || undefined}
          >
            {GRUPOS.map((g) => (
              <div key={g.id} className={s.ladoGrupo}>
                <p className={s.ladoTitulo} id={`grupo-${g.id}`}>
                  {g.titulo}
                </p>
                <ul className={s.ladoLista} aria-labelledby={`grupo-${g.id}`}>
                  {areasVisiveis.filter((a) => a.grupo === g.id).map((a) => {
                    // o índice no menu do papel: a parada do tour de cada item é ele + 1
                    const i = areasVisiveis.indexOf(a);
                    return (
                      <li key={a.id}>
                        <Link
                          to={a.rota}
                          // Passar o mouse (ou focar) já baixa o código da área, se ainda não desceu.
                          preload="intent"
                          className={s.item}
                          style={{ animationDelay: `${140 + i * 35}ms` }}
                          aria-label={a.nome}
                          data-curto={a.curto}
                          // O contador navy do Chat (o `.item-conta` do protótipo) sai pelo CSS, no
                          // computador: fica fora do texto do link, que continua só o nome da área.
                          data-conta={a.id === "chat" && precisamDeVoce > 0 ? precisamDeVoce : undefined}
                          data-realce={paradaArea === a.id || undefined}
                          onClick={(ev) => clicarItem(ev, i)}
                        >
                          <span className={s.itemIcone}>
                            <Icone d={a.icone} />
                          </span>
                          <span className={s.itemNome}>{a.nome}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className={s.ladoPe}>
            <p style={{ fontSize: 11, opacity: .65, margin: '0 0 8px' }}>{BRAND_AUTHOR}</p>
            <p className={s.ladoStatus} data-ok={conectado || undefined} data-erro={(!conectado && !conectando) || undefined}>
              <Icone d={conectado ? IC.ok : conectando ? IC.pendente : IC.alerta} />
              <span>{textoStatus}</span>
            </p>
          </div>
        </aside>

        <main className={s.platMain} data-area-aberta={areaDaLargura} aria-hidden={areaOculta} inert={areaOculta}>
          <div className={s.platTopo}>
            <p className={s.trilha}>
              {empresa ? (
                <>
                  <span className={s.trilhaEmp}>{empresa}</span>
                  <Icone d={IC.seta} />
                </>
              ) : null}
              <b>{areaAtual.nome}</b>
            </p>
            <div className={s.topoDir}>
              {podeReverTour ? (
                // Abaixo de 1440 px a pílula fica só com o ícone (o texto continua no nome do botão
                // e na dica `title`), para o topo caber numa linha.
                <button type="button" className={s.pilula} onClick={iniciarTour} title="Ver o tour de novo">
                  <Icone d={IC.tour} />
                  <span>Ver o tour de novo</span>
                </button>
              ) : null}
              <div className={s.contaTopo}>
                <div className={s.contaTopoTexto}>
                  {nomeExibido !== null ? (
                    <span className={s.contaTopoNome}>{nomeExibido}</span>
                  ) : (
                    <Esqueleto largura="6rem" altura="1em" className={s.contaTopoOsso} />
                  )}
                  <span className={s.meta}>{metaConta}</span>
                </div>
                <span className={s.avatar} aria-hidden="true">
                  {iniciais}
                </span>
                <BotaoIcone
                  rotulo="Sair"
                  variante="discreto"
                  icone={<LogOut size={20} strokeWidth={1.75} />}
                  onClick={() => void sair()}
                  carregando={saindo}
                  alinharDica="fim"
                />
              </div>
            </div>
          </div>
          <div className={s.platTopoM}>
            <BrandLogo withName height={30} />
            {empresa ? <span className={s.trilhaEmp}>{empresa}</span> : null}
            <div className={s.topoMAcoes}>
              {podeReverTour ? (
                <BotaoIcone rotulo="Ver o tour de novo" icone={<Icone d={IC.tour} />} onClick={iniciarTour} alinharDica="fim" />
              ) : null}
              <BotaoIcone
                rotulo="Sair"
                variante="discreto"
                icone={<LogOut size={20} strokeWidth={1.75} />}
                onClick={() => void sair()}
                carregando={saindo}
                alinharDica="fim"
              />
            </div>
          </div>

          {/* data-esperando: a troca passou de ESPERA_ESQUELETO_MS; o CSS esconde a área anterior (que
              continua montada) e fica o esqueleto da área do endereço (useEsperaDaTroca). */}
          <div className={s.platConteudo} data-esperando={esperando ? "" : undefined}>
            {identidade.aviso ? (
              <div style={{ marginBottom: 16 }} data-aviso-casca="">
                <Aviso
                  tom={identidade.aviso.irParaOnboarding ? "atencao" : "info"}
                  compacto
                  acao={
                    identidade.aviso.irParaOnboarding ? (
                      <BotaoLink to="/onboarding" variante="contorno" tamanho="compacto">
                        Concluir o onboarding
                      </BotaoLink>
                    ) : undefined
                  }
                >
                  {identidade.aviso.texto}
                </Aviso>
              </div>
            ) : null}
            <ProvedorConta value={conta}>
              <VisitaDaArea.Provider value={visita}>
                {esperando ? <CarregandoArea area={esperando} /> : null}
                <Outlet />
              </VisitaDaArea.Provider>
            </ProvedorConta>
          </div>
        </main>

        {st.tour !== "fora" ? (
          <div className={cx(s.moldura, !(tourAtivo && !st.saindo) && s.sumir)} style={molduraDe(paradaAgora, paradas)} aria-hidden="true" />
        ) : null}
        {st.tour !== "fora" ? (
          <div
            className={cx(s.guia, (st.tour === "casa" || st.saindo) && s.casa, st.guiaOculto && s.guiaOculto)}
            style={{ left: pos.l, top: pos.t }}
          >
            <div className={cx(s.guiaWrap, estica)}>
              <button
                type="button"
                id="tour-ponto"
                className={s.guiaPonto}
                onClick={abrirJanete}
                aria-label={`Encerrar o tour e falar com a ${ASSISTANT_NAME}`}
              >
                <JaneteSimbolo decorativo tamanho={44} estado={guiaFala ? "fala" : "acordada"} />
              </button>
            </div>
            <div
              className={cx(s.balao, (st.viajando || !tourAtivo) && s.balaoOculto, ultimaParada && s.fim)}
              style={{ "--i": idxSeta } as CSSProperties}
              role="region"
              aria-label={`Tour da ${ASSISTANT_NAME}`}
            >
              <p className={s.olho}>{paradaVis.rotulo}</p>
              <p className={s.balaoTexto} aria-live="polite">
                {paradaVis.texto}
              </p>
              <div className={s.balaoAcoes}>
                <span className={s.balaoConta}>
                  {pv + 1} de {paradas.length}
                </span>
                <div className={s.balaoBotoes}>
                  {!ultimaParada ? (
                    <Botao variante="discreto" onClick={encerrarTour}>
                      Pular tour
                    </Botao>
                  ) : null}
                  <Botao id="tour-proximo" variante="principal" onClick={proximo}>
                    {ultimaParada ? "Começar a usar" : "Próximo"}
                  </Botao>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {mostraGatilho ? (
          <button
            type="button"
            id="janete-gatilho"
            data-janete-gatilho=""
            data-escondido={gatilhoEscondido ? "" : undefined}
            className={s.gatilho}
            onClick={abrirJanete}
            aria-label={st.novidade ? `Fale com a ${ASSISTANT_NAME} (ela tem novidade)` : `Fale com a ${ASSISTANT_NAME}`}
            aria-haspopup="dialog"
          >
            <JaneteSimbolo decorativo tamanho={52} estado="acordada" />
            {st.novidade ? <span className={s.gatilhoPonto} aria-hidden="true" /> : null}
          </button>
        ) : null}

        {st.painel !== "fechado" ? (
          <PainelJanete
            fase={st.painel}
            telaCheia={st.telaCheia}
            mensagens={mensagensDoPapel}
            digitando={st.digitando}
            falando={st.falando}
            atalhos={atalhosDoPapel(papel)}
            primeiroNome={primeiroNome(nome)}
            empresa={empresaBruta ? curto(empresaBruta, 30) : null}
            aoAtalho={responderAtalho}
            aoAbrirArea={irParaAreaDoPainel}
            aoMinimizar={minimizarJanete}
            aoFechar={fecharJanete}
          />
        ) : null}
      </section>
      <p className={s.sr} role="status" aria-live="polite">
        {anuncio}
      </p>
    </div>
  );
}
