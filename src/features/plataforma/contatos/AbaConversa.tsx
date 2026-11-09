import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { Smartphone, UserRound } from "lucide-react";

import { Botao } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";
import { iniciais } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { corDoLead } from "../comum/AvatarLead";
import { Bolha, CITACAO_FORA, LoteMidias, idUltimaEnviada, type AutorBolha, type CitacaoBolha } from "../comum/Bolha";
import { CaixaEscrever, type BloqueioCaixa, type CitandoCaixa, type FaixaCaixa, type NovaMensagem } from "../comum/CaixaEscrever";
import { EventoConversa, SeparadorDia } from "../comum/EventoConversa";
import { MOTIVO_CURTO, MOTIVO_LONGO, MOTIVOS_FALHA, nomeDoContato, resumoMensagem } from "../comum/LinhaConversa";
import { entraNaLinha, inicioDaLinha } from "../comum/linhaDoTempo";
import { diaLocal, horaCurta, rotuloDia } from "../comum/tempo";
import { usePerfilContato } from "../dados/contatos";
import { textoDoErro } from "../dados/estados";
import { useDados, useModoDados } from "../dados/ProvedorDados";
import type { Resultado } from "../dados/tipos";
import {
  conexaoAtiva,
  conversaDoContato,
  janelaFechada,
  nomeDoMembro,
  seloDaConversa,
  type HistoricoEtapa,
  type Mensagem,
} from "../exemplo";
import { quemAtende } from "./dados";
import { EstadoDaAba, TextoQuem } from "./pecas";
import { acharRolador } from "./rolagem";
import type { EstadoContatos, EventoContato, PropsAba } from "./tipos";
import estilos from "./AbaConversa.module.css";

// A aba Conversa do perfil (task C5 de docs/spec-contatos.md). Segue o comportamento atual do Chat
// (chat/Conversa.tsx e docs/plano-chat-rodada-2.md) com as peças de comum/, sem importar de chat/
// nem de kanban/: as mesmas regras de assumir, devolver, sem conexão e janela de 24 h; a faixa só
// com outra pessoa atendendo ou com a Janete parada por falha; sem aviso flutuante ao assumir ou
// devolver (decisão 11): quem enxerga vê a linha de passagem e o leitor de tela ouve a frase.

const s = estilos as Classes<
  | "acRaiz"
  | "acTopo"
  | "acQuem"
  | "acQuemRot"
  | "acCartao"
  | "acRolo"
  | "acLista"
  | "acDestaque"
  | "acDigita"
  | "acMais"
  | "acEscrever"
  | "acVazio"
  | "acPassagem"
  | "acRota"
  | "acSeta"
  | "acPessoa"
  | "acMembro"
  | "acPasTexto"
  | "acPasHora"
  | "sr"
>;

type Props = PropsAba & { mensagemAlvo: string | null; focarCaixa: boolean };

/** Quanto tempo a mensagem do "Ver na conversa" fica destacada. */
const DESTAQUE_MS = 2000;

/* A altura do cartão da conversa (ver o efeito que mede): o espaço que fica livre embaixo dele e o
   mínimo, para janela baixa, em que a página rola.
   - No celular, a margem deixa livre a bolinha da Janete (fixa a 100 px do pé da tela, com 52 px de
     altura) e uma folga de 8: a fileira de anexar e enviar não fica atrás dela.
   - Os mínimos cabem a caixa de escrever e umas 2 mensagens: no notebook de 1366 × 768 (uns 640 px
     úteis) e no celular, a caixa ainda aparece sem rolar a página. */
const MARGEM_COMPUTADOR = 24;
const MARGEM_CELULAR = 160;
const MINIMO_COMPUTADOR = 240;
const MINIMO_CELULAR = 220;

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

function curto(texto: string, n: number): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/** O id da mensagem na página: o "Ver na conversa" rola até ele. */
const idMsg = (mensagemId: string) => `contato-msg-${mensagemId}`;

/* ---------- quem escreveu ---------- */

function iniciaisDoMembro(estado: Pick<EstadoContatos, "membros" | "eu">, id: string | null): string {
  // Quem está olhando aparece como "VC", como no Chat e na lista.
  if (id && id === estado.eu.id) return "VC";
  const m = id ? estado.membros.find((x) => x.id === id) : undefined;
  return m ? iniciais(m.nome) : "?";
}

function autorDa(m: Mensagem, estado: EstadoContatos, nomeLead: string, contatoId: string): AutorBolha {
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
      // O papel não repete o nome ("Admin · Equipe", não "Admin · Admin"), como no Chat.
      const papel = !membro ? "Equipe" : membro.papel === "admin" ? (nome === "Admin" ? "Equipe" : "Admin") : "Atendente";
      return { nome, papel, iniciais: iniciaisDoMembro(estado, m.autor_membro_id) };
    }
  }
}

/* ---------- a linha de passagem ----------
   O desenho da passagem do Chat (chat/Passagem.tsx), refeito aqui porque Contatos não importa de
   chat/: uma linha centrada e sem cartão, com a rota (quem passa → quem recebe), o texto curto e a
   hora. O nome acessível (role="note") traz a frase inteira. */

/* ---------- a linha da conversa ----------
   As mensagens, as passagens do bastão e as mudanças de etapa por pessoa ou pela Janete, na ordem do
   tempo: a regra de linhaDaConversa (exemplo/regras), com as passagens do banco (que têm também o
   "voltou para a fila"). */

type ItemConversa =
  | { k: "mensagem"; id: string; em: string; mensagem: Mensagem }
  | { k: "passagem"; id: string; em: string; evento: EventoContato }
  | { k: "etapa"; id: string; em: string; historico: HistoricoEtapa };

const tempoDe = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** Com mensagens mais antigas por carregar, as passagens e as etapas de antes da mais antiga carregada
    ficam para depois (comum/linhaDoTempo, a mesma regra do Chat e da gaveta do Kanban). */
export function linhaDaConversaContato(estado: EstadoContatos, conversaId: string, temMaisAntigas = false): ItemConversa[] {
  const conversa = estado.conversas.find((c) => c.id === conversaId);
  if (!conversa) return [];
  const mensagens = estado.mensagens.filter((m) => m.conversa_id === conversaId);
  const desde = inicioDaLinha(mensagens, temMaisAntigas);
  const itens: ItemConversa[] = [
    ...mensagens.map((m): ItemConversa => ({ k: "mensagem", id: m.id, em: m.momento, mensagem: m })),
    ...estado.eventos
      .filter((e) => e.conversa_id === conversaId && entraNaLinha(e.criado_em, desde))
      .map((e): ItemConversa => ({ k: "passagem", id: e.id, em: e.criado_em, evento: e })),
    ...estado.historico
      .filter((h) => h.contato_id === conversa.contato_id && h.ator !== "sistema" && entraNaLinha(h.criado_em, desde))
      .map((h): ItemConversa => ({ k: "etapa", id: h.id, em: h.criado_em, historico: h })),
  ];
  // sort estável; a passagem causada por um envio vem antes da mensagem que a causou.
  const peso = (i: ItemConversa) => (i.k === "passagem" && i.evento.por_envio ? -1 : 0);
  return itens.sort((a, b) => tempoDe(a.em) - tempoDe(b.em) || peso(a) - peso(b));
}

function textoDeOnde(evento: EventoContato, nomeDe: string | undefined): string {
  const ao = evento.por_envio ? "Ao enviar uma mensagem. " : "";
  switch (evento.de) {
    case "espera":
      return `${ao}A conversa esperava atendimento.`;
    case "outro":
      return `${ao}A conversa estava com ${nomeDe || "outra pessoa da equipe"}.`;
    case "celular":
      return `${ao}Antes, respondida pelo celular da empresa.`;
    default:
      return `${ao}A Janete saiu da conversa.`;
  }
}

function LinhaPassagem({
  evento,
  nome,
  sigla,
  nomeDe,
}: {
  evento: EventoContato;
  nome: string;
  sigla: string;
  nomeDe: string | undefined;
}) {
  const h = horaCurta(evento.criado_em);
  const as = h ? ` às ${h}` : "";

  const janete = <JaneteSimbolo tamanho={18} decorativo />;
  const membro = (x: string) => (
    <span className={s.acMembro} aria-hidden="true">
      {x}
    </span>
  );
  const esperando = (
    <span className={s.acPessoa}>
      <UserRound size={11} strokeWidth={2.2} />
    </span>
  );
  const celular = (
    <span className={s.acPessoa} data-celular="">
      <Smartphone size={11} strokeWidth={2.2} />
    </span>
  );

  let texto: string;
  let frase: string;
  let falha = false;
  let de: ReactNode = janete;
  let para: ReactNode = membro(sigla);

  switch (evento.tipo) {
    case "passou": {
      const motivo = evento.motivo ?? "janete_passou";
      falha = MOTIVOS_FALHA.includes(motivo);
      texto = MOTIVO_CURTO[motivo];
      frase = `A Janete passou para um humano${as}. Motivo: ${MOTIVO_LONGO[motivo]}.`;
      para = esperando;
      break;
    }
    case "celular":
      texto = "Respondida pelo celular";
      frase = `A conversa foi respondida pelo celular da empresa${as}. A Janete saiu da conversa.`;
      para = celular;
      break;
    case "assumiu":
      texto = `${nome} assumiu a conversa`;
      frase = `${nome} assumiu a conversa${as}. ${textoDeOnde(evento, nomeDe)}`;
      de =
        evento.de === "espera"
          ? esperando
          : evento.de === "celular"
            ? celular
            : evento.de === "outro"
              ? membro(nomeDe ? iniciais(nomeDe) : "?")
              : janete;
      break;
    case "voltou_para_fila": {
      // Quem atendia foi desativado (desativar_membro): a conversa voltou para a fila.
      const quem = nomeDe || "quem atendia";
      texto = "Voltou para a fila";
      frase = `A conversa voltou para a fila${as}. A conta de ${quem} foi desativada, e a conversa espera atendimento.`;
      de = membro(nomeDe ? iniciais(nomeDe) : "?");
      para = esperando;
      break;
    }
    default:
      texto = `${nome} devolveu para a Janete`;
      frase = `${nome} devolveu para a Janete${as}. A Janete voltou a atender.`;
      de = membro(sigla);
      para = janete;
  }

  return (
    <div
      className={s.acPassagem}
      data-tom={falha ? "falha" : undefined}
      data-para-janete={evento.tipo === "devolveu" || undefined}
      role="note"
      aria-label={frase}
    >
      <span className={s.acRota} aria-hidden="true">
        {de}
        <span className={s.acSeta} />
        {para}
      </span>
      <span className={s.acPasTexto}>{texto}</span>
      {h && <span className={s.acPasHora}>· {h}</span>}
    </div>
  );
}

/* =============================================================================
   A aba
   ============================================================================= */

/**
 * A conversa do contato no perfil: no alto, quem atende e a ação (Assumir, "Assumir de <nome>" ou
 * "Devolver para a Janete"); embaixo, um cartão branco com as mensagens, que rolam por dentro e abrem
 * no fim, e a caixa de escrever sempre à vista. Abrir a aba marca a conversa como lida.
 */
export function AbaConversa({ contatoId, agora, mensagemAlvo, focarCaixa, avisar }: Props) {
  const perfil = usePerfilContato(contatoId);
  const estado = perfil.dados;
  const { useEu, acoes } = useDados();
  const { ehAdmin } = useEu();
  const modo = useModoDados();
  const navigate = useNavigate();
  const contato = estado?.contatos.find((c) => c.id === contatoId);
  const conversa = estado ? conversaDoContato(estado, contatoId) : undefined;
  const conversaId = conversa?.id ?? "";
  // A aba pode sair da tela no meio de uma ação: a resposta que chega depois não mexe em nada.
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const [bloqueioAcao, setBloqueioAcao] = useState<{ conversaId: string; tipo: BloqueioCaixa } | null>(null);
  const [citandoId, setCitandoId] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [focoMsg, setFocoMsg] = useState<string | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);

  const raiz = useRef<HTMLElement>(null);
  const cartao = useRef<HTMLDivElement>(null);
  const rolo = useRef<HTMLDivElement>(null);
  const idTitulo = useId();

  /* A altura do cartão: o que sobra da janela abaixo dele, contando a página no alto. Abrir a aba não
     rola a página (o equipe pediu, em 31/10, para tirar a âncora), então é o cartão que se ajusta para a
     caixa de escrever caber na janela. Recalcula quando a janela muda. */
  const temConversa = !!conversa;
  useLayoutEffect(() => {
    const el = cartao.current;
    if (!el) return;
    const medir = () => {
      const rolador = acharRolador(el);
      const topo = el.getBoundingClientRect().top + (rolador ? rolador.scrollTop - rolador.getBoundingClientRect().top : window.scrollY);
      const celular = window.matchMedia?.("(max-width: 899px)").matches ?? false;
      const sobra = window.innerHeight - topo - (celular ? MARGEM_CELULAR : MARGEM_COMPUTADOR);
      el.style.setProperty("--ac-altura", `${Math.max(celular ? MINIMO_CELULAR : MINIMO_COMPUTADOR, Math.round(sobra))}px`);
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
    // Sem conversa, o cartão não existe; quando ela aparece com a aba aberta, mede de novo.
  }, [temConversa]);

  /* A regra do Chat (decisão 6): abrir a aba Conversa é abrir a conversa de propósito, então ela vira
     lida (e o lead vê o azul no WhatsApp); o perfil aberto em outra aba não conta. Também quando
     chega mensagem com ela aberta. */
  const naoLidas = conversa?.nao_lidas ?? 0;
  useEffect(() => {
    if (conversaId && naoLidas > 0) void acoes.marcarLida(conversaId);
  }, [acoes, conversaId, naoLidas]);

  /* O "Ver na conversa" de uma mensagem antiga (no banco, fora das páginas já lidas): busca as páginas
     de antes até ela aparecer. */
  const ids = perfil.idsDaConversa;
  const alvoCarregado = !mensagemAlvo || !ids || ids.has(mensagemAlvo);
  const { temMaisAntigas, carregandoMaisAntigas, carregarMaisAntigas } = perfil;
  useEffect(() => {
    if (!alvoCarregado && temMaisAntigas && !carregandoMaisAntigas) carregarMaisAntigas();
  }, [alvoCarregado, temMaisAntigas, carregandoMaisAntigas, carregarMaisAntigas]);

  const campo = useCallback(() => raiz.current?.querySelector<HTMLTextAreaElement>("textarea") ?? null, []);
  const focarCampo = useCallback(() => {
    window.setTimeout(() => campo()?.focus(), 0);
  }, [campo]);

  /* O "Responder" do perfil: o foco vai direto para a caixa de escrever. */
  useEffect(() => {
    if (focarCaixa) campo()?.focus();
  }, [focarCaixa, campo]);

  /* O "Ver na conversa": rola até a mensagem, põe o foco nela e a destaca por 2 s. Rola só a lista
     de mensagens (scrollBy no rolo, pela distância): o scrollIntoView mexeria também na página. */
  useEffect(() => {
    if (!mensagemAlvo) return;
    const el = document.getElementById(idMsg(mensagemAlvo));
    if (!el) return;
    const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const caixa = rolo.current;
    if (caixa) {
      const distancia =
        el.getBoundingClientRect().top - caixa.getBoundingClientRect().top - (caixa.clientHeight - el.offsetHeight) / 2;
      caixa.scrollBy?.({ top: distancia, behavior: reduzir ? "auto" : "smooth" });
    }
    setFocoMsg(mensagemAlvo);
    setDestaque(mensagemAlvo);
    if (!focarCaixa) el.focus({ preventScroll: true });
    const id = window.setTimeout(() => setDestaque(null), DESTAQUE_MS);
    return () => window.clearTimeout(id);
    // O foco da caixa manda quando os dois vêm juntos; a mensagem (e a chegada dela, quando estava
    // numa página antiga) dispara o efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagemAlvo, alvoCarregado]);

  // Só as mensagens das páginas já lidas (sem buraco no meio); no exemplo, todas.
  const linha = useMemo(() => {
    if (!estado || !conversaId) return [];
    const visiveis = ids ? { ...estado, mensagens: estado.mensagens.filter((m) => ids.has(m.id)) } : estado;
    return linhaDaConversaContato(visiveis, conversaId, temMaisAntigas);
  }, [estado, conversaId, ids, temMaisAntigas]);
  const mensagens = useMemo(() => linha.flatMap((i) => (i.k === "mensagem" ? [i.mensagem] : [])), [linha]);
  const idsMsgs = mensagens.map((m) => m.id);
  const alvoFoco = focoMsg && idsMsgs.includes(focoMsg) ? focoMsg : (idsMsgs[idsMsgs.length - 1] ?? null);
  const ultimaEnviada = idUltimaEnviada(mensagens);

  if (!estado) return <EstadoDaAba leitura={perfil} forma="lista" />;

  if (!contato || !conversa) {
    return (
      <section className={s.acRaiz} aria-labelledby={idTitulo}>
        <h2 id={idTitulo} className={s.sr}>
          Conversa
        </h2>
        <p className={s.acVazio}>Este contato ainda não tem conversa.</p>
      </section>
    );
  }

  const nomeLead = nomeDoContato(contato);
  const primeiro = primeiroNome(nomeLead);
  const quem = quemAtende(estado, conversa, agora);
  const selo = seloDaConversa(conversa);
  const comigo = conversa.modo === "humano" && conversa.responsavel_id === estado.eu.id;
  const comOutro = selo === "membro" && !comigo;
  const nomeResp = conversa.responsavel_id ? nomeDoMembro(estado, conversa.responsavel_id) : "";
  const digitando = conversa.modo === "janete" && estado.digitando.includes(conversa.id);

  /* ---------- ações ---------- */

  // As recusas que travam a caixa (sem conexão, janela fechada) aparecem nela; as outras vão para o
  // aviso da tela (o avisar do perfil, que quem enxerga vê e o leitor de tela ouve), como o toast do
  // Chat e a nota do Kanban: só no leitor de tela, quem enxerga não via nada quando o envio falhava.
  const recusa = (r: Resultado): boolean => {
    if (r.ok) return false;
    if (r.erro === "sem_conexao_ativa") setBloqueioAcao({ conversaId, tipo: "sem_conexao" });
    else if (r.erro === "janela_fechada") setBloqueioAcao({ conversaId, tipo: "janela_fechada" });
    else if (r.erro === "sem_acesso" || r.erro === "nao_encontrado") avisar(textoDoErro(r.erro));
    else if (r.erro === "nao_reenviavel")
      avisar("Essa mensagem pode ter chegado ao lead: não dá para tentar de novo. Escreva outra, se precisar.");
    else avisar("Não deu para fazer isso agora. Tente de novo.");
    return true;
  };

  const assumir = async () => {
    if (comigo) return;
    const r = await acoes.assumir(conversaId);
    if (!vivo.current || recusa(r)) return;
    // Sem aviso flutuante: a linha "Você assumiu a conversa · hh:mm" entra na conversa.
    setAnuncio(comOutro ? `Você assumiu a conversa. Ela estava com ${nomeResp}.` : "Você assumiu a conversa.");
    focarCampo();
  };

  // "Devolver para a Janete" só aparece com a conversa com você. O Chat só pede confirmação ao devolver
  // uma conversa parada por falha (esperando a equipe); aqui, esperando, a ação é Assumir, então
  // devolver é direto.
  const devolver = async () => {
    if (!comigo) return;
    const r = await acoes.devolverParaJanete(conversaId);
    if (!vivo.current || recusa(r)) return;
    setAnuncio(`A Janete voltou a atender ${primeiro}.`);
    focarCampo();
  };

  // A mensagem sai pela camada de dados (o arquivo de verdade sobe antes; depois do insert, a tela pede
  // uma passada de envio, decisão 7). A caixa espera cada uma antes da próxima.
  const enviar = async (id: string, nova: NovaMensagem) => {
    const r = await acoes.enviarMensagem(id, {
      tipo: nova.tipo,
      texto: nova.texto ?? null,
      midia: nova.midia ?? null,
      citaId: nova.citaId ?? null,
      arquivo: nova.arquivo,
    });
    if (!vivo.current) return { ok: r.ok };
    if (recusa(r)) return { ok: false };
    setBloqueioAcao(null);
    setCitandoId(null);
    // A caixa já anuncia "Mensagem enviada."; aqui, só a troca de mãos (a linha de passagem mostra).
    if (r.ok && r.assumiu) setAnuncio("Você assumiu a conversa.");
    return { ok: true };
  };

  /* O "Reconectar" da faixa, como no Chat: quem reconecta o WhatsApp é um admin, na Configuração; o
     atendente lê que precisa de um admin. */
  const aoReconectar = ehAdmin ? () => void navigate({ to: "/app/configuracao" }) : undefined;

  /* ---------- a caixa: bloqueio, faixa e o texto da caixa vazia ---------- */

  const bloqueio: BloqueioCaixa | null = !conexaoAtiva(estado)
    ? "sem_conexao"
    : janelaFechada(estado, conversa, new Date(agora))
      ? "janela_fechada"
      : bloqueioAcao?.conversaId === conversaId
        ? bloqueioAcao.tipo
        : null;

  // A faixa só em 2 casos: a Janete parada por falha e outra pessoa atendendo.
  let faixa: FaixaCaixa | null = null;
  const motivo = conversa.motivo_humano;
  if ((selo === "falha" || selo === "aguardando") && motivo && MOTIVOS_FALHA.includes(motivo)) {
    const c = MOTIVO_CURTO[motivo];
    faixa = {
      tom: "falha",
      texto: `A Janete parou: ${c.charAt(0).toLowerCase()}${c.slice(1)}. Ao responder, você assume a conversa.`,
    };
  } else if (comOutro) {
    // Responder sem assumir mantém quem estava com a conversa; para ficar com ela, é o "Assumir de…".
    faixa = { tom: "pessoa", texto: `${nomeResp} está atendendo. Se você enviar, a conversa continua com ${nomeResp}.` };
  }
  // Sem a faixa, quem avisa que enviar troca de mãos é o texto da caixa vazia.
  const assumeAoEnviar = selo === "janete" || selo === "celular" || (selo === "aguardando" && !faixa);
  const dica = assumeAoEnviar ? `Escreva para ${primeiro} · você assume ao enviar` : undefined;

  /* ---------- a ação do alto ---------- */

  let acao: ReactNode;
  if (comigo) {
    acao = (
      <Botao variante="contorno" tamanho="compacto" icone={<JaneteSimbolo tamanho={16} decorativo />} onClick={devolver}>
        Devolver para a Janete
      </Botao>
    );
  } else {
    acao = (
      <Botao tamanho="compacto" onClick={assumir}>
        {comOutro ? `Assumir de ${primeiroNome(nomeResp)}` : "Assumir"}
      </Botao>
    );
  }

  /* ---------- as mensagens ---------- */

  const citacaoDe = (id: string | null | undefined): CitacaoBolha | null => {
    if (!id) return null;
    const m = mensagens.find((x) => x.id === id) ?? estado.mensagens.find((x) => x.id === id);
    if (!m) return null;
    return { de: autorDa(m, estado, nomeLead, contato.id).nome, texto: curto(resumoMensagem(m), 120) };
  };
  const citando: CitandoCaixa | null = (() => {
    const c = citacaoDe(citandoId);
    return c && citandoId ? { id: citandoId, ...c } : null;
  })();

  // As setas andam entre as mensagens; só uma é parada de Tab (como no Chat).
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
    document.getElementById(idMsg(alvo))?.focus();
  };

  const itens: ReactNode[] = [];
  let diaAnterior = "";
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
        <LinhaPassagem
          key={item.id}
          evento={ev}
          nome={nomeDoMembro(estado, ev.membro_id) || "Alguém da equipe"}
          sigla={iniciaisDoMembro(estado, ev.membro_id)}
          nomeDe={ev.de_membro_id ? nomeDoMembro(estado, ev.de_membro_id) : undefined}
        />,
      );
      continue;
    }
    if (item.k === "etapa") {
      chaveAnterior = null;
      const h = item.historico;
      const para = estado.etapas.find((e) => e.id === h.para_etapa_id);
      const quemMoveu = h.ator === "janete" ? "A Janete" : nomeDoMembro(estado, h.membro_id) || "Alguém da equipe";
      itens.push(
        <EventoConversa key={item.id} texto={`${quemMoveu} moveu para ${para?.nome ?? "outra etapa"}`} momento={h.criado_em} />,
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
        id={idMsg(m.id)}
        className={destaque === m.id ? s.acDestaque : undefined}
        mensagem={m}
        autor={autorDa(m, estado, nomeLead, contato.id)}
        agrupada={agrupada}
        // A citada fora das páginas lidas (mais antiga): "Mensagem anterior", sem inventar o texto.
        citacao={m.citaId ? (citacaoDe(m.citaId) ?? CITACAO_FORA) : null}
        mostrarSituacao={m.id === ultimaEnviada}
        nomeLead={primeiro}
        transcricaoFalhou={
          m.origem === "lead" && m.tipo === "audio" && !m.transcricao && conversa.motivo_humano === "audio_sem_transcricao"
        }
        aoResponder={bloqueio ? undefined : (id) => setCitandoId(id)}
        // Sem Reagir na v1 (decisão 5): a Bolha esconde por padrão. "Tentar de novo" só onde a
        // decisão 8 deixa (a Bolha aplica a regra no banco).
        aoTentarDeNovo={(id) => {
          void acoes.tentarDeNovo(id).then((r) => {
            if (vivo.current && !recusa(r)) setAnuncio("Reenviando a mensagem.");
          });
        }}
        // No banco, o documento abre pelo link assinado da própria bolha; o exemplo não tem arquivo.
        aoBaixar={modo === "exemplo" ? () => setAnuncio(`Download simulado: ${m.midia_nome ?? "documento"}.`) : undefined}
        tabIndex={m.id === alvoFoco ? 0 : -1}
        onKeyDown={(e) => teclaMsg(e, m.id)}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setFocoMsg(m.id);
        }}
      />,
    );
  }

  return (
    <section ref={raiz} className={s.acRaiz} aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className={s.sr}>
        Conversa com {nomeLead}
      </h2>

      {/* Uma linha curta: quem atende e a ação. */}
      <div className={s.acTopo}>
        <p className={s.acQuem}>
          <span className={s.acQuemRot}>Quem atende</span>
          <TextoQuem quem={quem} agora={agora} />
        </p>
        {acao}
      </div>

      <div ref={cartao} className={s.acCartao}>
        <div ref={rolo} className={s.acRolo}>
          <div className={s.acLista} role="log" aria-live="polite" aria-relevant="additions" aria-label={`Mensagens com ${nomeLead}`}>
            {temMaisAntigas ? (
              <div className={s.acMais}>
                <Botao
                  variante="discreto"
                  tamanho="compacto"
                  disabled={carregandoMaisAntigas}
                  aria-busy={carregandoMaisAntigas || undefined}
                  onClick={carregarMaisAntigas}
                >
                  {carregandoMaisAntigas ? "Carregando…" : "Carregar mensagens mais antigas"}
                </Botao>
              </div>
            ) : null}
            {/* Os links assinados das mídias, pedidos de uma vez para a conversa (no exemplo, nada). */}
            <LoteMidias mensagens={mensagens}>
              {itens.length ? itens : <EventoConversa texto="Nenhuma mensagem ainda." />}
            </LoteMidias>
            {digitando ? (
              <p className={s.acDigita}>
                <JaneteSimbolo tamanho={16} estado="fala" digitando decorativo />
                <span>A Janete está digitando…</span>
              </p>
            ) : null}
          </div>
        </div>

        <CaixaEscrever
          className={s.acEscrever}
          conversaId={conversaId}
          bloqueio={bloqueio}
          faixa={faixa}
          aoEnviar={enviar}
          destinatario={primeiro}
          dica={dica}
          citando={citando}
          aoTirarCitacao={() => setCitandoId(null)}
          aoReconectar={aoReconectar}
          complementoBloqueio={!aoReconectar ? "Peça a um admin para reconectar." : undefined}
        />
      </div>

      <p className={s.sr} role="status" aria-live="polite">
        {anuncio}
      </p>

    </section>
  );
}
