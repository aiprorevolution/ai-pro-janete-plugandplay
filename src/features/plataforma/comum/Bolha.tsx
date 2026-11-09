import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleX,
  Clock,
  Download,
  File,
  ImageOff,
  Info,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Reply,
  SmilePlus,
  Smartphone,
  X,
} from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { iniciais } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import type { Enums, Tables } from "@/integrations/firebase/types";

import { caminhosProntos, situacaoDaMidia, useUrlMidia, type UrlsMidia } from "../dados/midia";
import { useClienteDados, useModoDados } from "../dados/ProvedorDados";
import { AvatarLead, type CorLead } from "./AvatarLead";
import estilos from "./Bolha.module.css";
import { horaCurta } from "./tempo";

const s = estilos as Classes<
  | "boMsg"
  | "boLinha"
  | "boQuem"
  | "boAvatarEsp"
  | "boCorpo"
  | "boBolha"
  | "boApagada"
  | "boOutro"
  | "boHora"
  | "boHoraNum"
  | "boVisto"
  | "boCita"
  | "boCitaDe"
  | "boCitaTxt"
  | "boMidia"
  | "boFoto"
  | "boCena"
  | "boAudio"
  | "boPlayer"
  | "boPlay"
  | "boAudioCol"
  | "boAudioPe"
  | "boOnda"
  | "boTempo"
  | "boTransc"
  | "boTranscBot"
  | "boTranscRot"
  | "boTranscSeta"
  | "boTranscTexto"
  | "boTranscSem"
  | "boVideo"
  | "boVideoPlay"
  | "boVideoDur"
  | "boDoc"
  | "boDocIc"
  | "boDocExt"
  | "boDocTxt"
  | "boDocNome"
  | "boDocLinha"
  | "boDocMeta"
  | "boDocBaixar"
  | "boFig"
  | "boReacao"
  | "boAcoes"
  | "boAcao"
  | "boReacoes"
  | "boStatus"
  | "boTentar"
  | "boVeu"
  | "boLuz"
  | "boLuzCab"
  | "boLuzTitulo"
  | "boLuzSub"
  | "boLuzFechar"
  | "boLuzImg"
  | "boLuzVideo"
  | "boLuzPlay"
  | "boLuzBarra"
  | "boMidiaEstado"
  | "boMidiaDeNovo"
  | "sr"
>;

/* =============================================================================
   Tipos. Os nomes são os das colunas de `mensagens`; só o mínimo é obrigatório,
   para a `Mensagem` dos dados de exemplo (um Pick das mesmas colunas) caber aqui
   sem conversão. `reacao`, `citaId` e `duracaoS` são os extras de tela do exemplo;
   `responde_a_id` (a citação) e `midia_duracao_s` (o tempo do áudio) são as colunas do banco.
   ============================================================================= */

type LinhaMensagem = Tables<"mensagens">;

export type MensagemBolha = Pick<LinhaMensagem, "id" | "origem" | "tipo" | "status" | "texto" | "momento"> &
  Partial<
    Pick<
      LinhaMensagem,
      | "editada"
      | "apagada_em"
      | "transcricao"
      | "midia_nome"
      | "midia_mime"
      | "midia_tamanho"
      | "midia_caminho"
      | "midia_status"
      | "erro"
      | "id_externo"
      | "id_gateway"
      | "responde_a_id"
      | "midia_duracao_s"
    >
  > & {
    reacao?: string | null | undefined;
    /** O extra do exemplo para a citação; no banco, vale `responde_a_id`. */
    citaId?: string | null | undefined;
    /** O extra do exemplo para a duração; no banco, vale `midia_duracao_s`. */
    duracaoS?: number | null | undefined;
  };

/**
 * Quem escreveu, já resolvido pela tela: o lead, a Janete, o membro da equipe (nome e
 * "Admin"/"Atendente") ou o celular da empresa. Sem `papel`, vale o da origem.
 *
 * No lead, a tela passa o primeiro nome em `nome` (o rótulo "Ricardo · Lead"), o nome inteiro em
 * `nomeCompleto` (as iniciais "RA" do avatar, as mesmas da lista) e `cor: corDoLead(contato.id)`,
 * para o avatar ter a mesma cor da lista. Sem `cor`, vale a do `AvatarLead` (derivada do nome).
 *
 * `iniciais` são as da bolinha da equipe pela tela ("VC" para quem olha); sem elas, saem do nome
 * pelo `iniciais()` do AI PRO (1ª letra das duas primeiras palavras, as mesmas do selo e da
 * passagem), e o nome "Você" vira "VC". O lead usa sempre as do `AvatarLead`.
 */
export type AutorBolha = {
  nome: string;
  nomeCompleto?: string | undefined;
  papel?: string | undefined;
  cor?: CorLead | null | undefined;
  iniciais?: string | undefined;
};

/** O trecho citado, já resolvido pela tela a partir do `citaId`. */
export type CitacaoBolha = { de: string; texto: string };

type Origem = Enums<"mensagem_origem">;
type Situacao = Enums<"mensagem_status">;

const PAPEL_PADRAO: Record<Origem, string> = {
  lead: "Lead",
  janete: "SDR de IA",
  humano_tela: "Equipe",
  humano_celular: "pelo WhatsApp",
};

/** As 6 reações do WhatsApp, com o nome lido pelo leitor de tela. */
export const REACOES: readonly (readonly [emoji: string, nome: string])[] = [
  ["👍", "joinha"],
  ["❤️", "coração"],
  ["😂", "risada"],
  ["😮", "surpresa"],
  ["🙏", "obrigado"],
  ["👏", "aplauso"],
];

/** A forma de onda fixa do áudio (o `BARRAS` do Chat final), em px de altura. */
const BARRAS = [
  8, 12, 18, 24, 16, 10, 20, 26, 22, 14, 9, 15, 21, 25, 19, 12, 8, 14, 22, 18, 11, 16, 23, 13, 9, 17, 24,
  20, 12, 8, 15, 21, 14, 9,
];

/** As que ficam numa linha embaixo do balão: o que não vai sair sem alguém agir. */
const SEM_ENVIO: readonly Situacao[] = ["falhou", "cancelada"];

/* =============================================================================
   Utilitários exportados (a lista, a citação da caixa e a ficha usam os mesmos textos)
   ============================================================================= */

/** "14:31", no fuso de São Paulo: é o `horaCurta` de `tempo.ts` (a fonte única do fuso). */
export const horaBolha = horaCurta;

/** Segundos em "m:ss" (o tempo do áudio e do vídeo). */
export function mmss(segundos: number): string {
  const t = Math.max(0, Math.floor(segundos));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** "640 KB", "1,8 MB": o tamanho do arquivo como o WhatsApp mostra. */
export function tamanhoArquivo(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** A extensão em maiúsculas ("PDF"), pelo nome do arquivo ou, sem ele, pelo tipo MIME. */
export function extensaoArquivo(nome: string | null | undefined, mime?: string | null): string {
  const pelo = nome?.includes(".") ? nome.split(".").pop() : mime?.split("/").pop();
  return (pelo ?? "").slice(0, 4).toUpperCase();
}

export function estaApagada(m: Pick<MensagemBolha, "apagada_em">): boolean {
  return m.apagada_em != null;
}

/** A duração do áudio ou do vídeo, em segundos: a coluna do banco ou o extra do exemplo. */
export function duracaoDe(m: Pick<MensagemBolha, "duracaoS" | "midia_duracao_s">): number {
  return m.midia_duracao_s ?? m.duracaoS ?? 0;
}

/** O id da mensagem citada: `responde_a_id` (o banco) ou `citaId` (o exemplo). */
export function idCitado(m: Pick<MensagemBolha, "responde_a_id" | "citaId">): string | null {
  return m.responde_a_id ?? m.citaId ?? null;
}

/**
 * Os erros de envio que indicam que o gateway pode ter aceitado a mensagem (o lead pode ter
 * recebido): os mesmos do `reenviar_mensagem` do pacote do banco (`banco2/sql/30-conversa.sql`), que
 * recusa com `nao_reenviavel`. Vêm dos adaptadores (`ErroGateway` em `mensageria/gateways/*`) e do
 * `pegar_envios` (`sem_resposta_do_envio`, a "enviando" sem eco depois de 2 min).
 */
export const ERROS_PODE_TER_CHEGADO: readonly string[] = ["sem_resposta_do_envio", "tempo_esgotado", "falha_de_rede"];

/** Um 5xx do gateway: ele pode ter recebido o pedido antes de cair (o mesmo regex do banco). */
const ERRO_5XX = /^(http_|http:|meta_|zernio_http_)5[0-9][0-9]/;

/**
 * Se a mensagem pode ir de novo pelo "Tentar de novo" (decisão 8): só a da equipe pela tela que
 * falhou, e nunca quando o erro indica que ela pode ter chegado. `falha_no_gateway` (o gateway
 * avisou que não entregou) pode sair de novo. A da Janete que falhou fica só com "Não enviada".
 * É a mesma regra do `reenviar_mensagem`: a tela não oferece o que o banco vai recusar.
 */
export function podeTentarDeNovo(
  m: Pick<MensagemBolha, "origem" | "status" | "erro" | "id_externo" | "id_gateway">,
): boolean {
  if (m.origem !== "humano_tela" || m.status !== "falhou") return false;
  const erro = m.erro ?? "";
  if (erro === "falha_no_gateway") return true;
  if (m.id_externo || m.id_gateway) return false;
  return !ERROS_PODE_TER_CHEGADO.includes(erro) && !ERRO_5XX.test(erro);
}

/**
 * O resumo da mensagem para o nome acessível da bolha: o texto, "Foto: legenda", "Áudio (0:42)",
 * o nome do documento... A prévia da lista e a citação usam o `resumoMensagem` da `LinhaConversa`.
 */
export function resumoBolha(m: MensagemBolha): string {
  if (estaApagada(m)) return "Mensagem apagada";
  switch (m.tipo) {
    case "texto":
      return m.texto ?? "";
    case "imagem":
      return m.texto ? `Foto: ${m.texto}` : "Foto";
    case "audio":
      return `Áudio (${mmss(duracaoDe(m))})`;
    case "video":
      return `Vídeo (${mmss(duracaoDe(m))})`;
    case "documento":
      return m.midia_nome ?? "Documento";
    case "figurinha":
      return "Figurinha";
    default:
      return "Mensagem";
  }
}

/**
 * A última mensagem que saiu e deu certo (não falhou nem foi cancelada). Era a única cujo nome
 * acessível dizia a situação (`mostrarSituacao`); desde a rodada 2 do Chat, toda enviada diz, como
 * os vistos na tela. Continua exportada para quem já a usa.
 */
export function idUltimaEnviada(mensagens: readonly MensagemBolha[]): string | null {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i]!;
    if (m.origem !== "lead" && m.status !== "falhou" && m.status !== "cancelada") return m.id;
  }
  return null;
}

/** A citação que a bolha desenha, a partir da mensagem citada (achada pela tela pelo `idCitado`). */
export function citacaoDaMensagem(citada: MensagemBolha, de: string): CitacaoBolha {
  return { de, texto: resumoBolha(citada) };
}

/**
 * O "Respondendo a…" da caixa de escrever, a partir da mensagem em que a pessoa clicou em
 * Responder (o mesmo formato do `CitandoCaixa`).
 */
export function citandoDaMensagem(m: MensagemBolha, de: string): { id: string; de: string; texto: string } {
  return { id: m.id, de, texto: resumoBolha(m) };
}

/* =============================================================================
   Tocador: com o link da mídia, toca o arquivo de verdade (um <audio> escondido); sem
   ele (o exemplo não tem arquivo), o tempo anda por timer
   ============================================================================= */

type PropsAudioReal = {
  ref: RefObject<HTMLAudioElement | null>;
  src: string;
  preload: "metadata";
  onTimeUpdate: (e: SyntheticEvent<HTMLAudioElement>) => void;
  onLoadedMetadata: (e: SyntheticEvent<HTMLAudioElement>) => void;
  onEnded: () => void;
  onPause: () => void;
};

function useTocador(duracaoS: number, url?: string | null) {
  const [tocando, setTocando] = useState(false);
  const [decorrido, setDecorrido] = useState(0);
  const [durReal, setDurReal] = useState<number | null>(null);
  const inicio = useRef(0);
  const base = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const real = !!url;
  const durS = duracaoS > 0 ? duracaoS : (durReal ?? 0);
  const total = Math.max(1, durS) * 1000;

  useEffect(() => {
    if (!tocando || real) return;
    const id = window.setInterval(() => {
      const agora = base.current + (Date.now() - inicio.current);
      if (agora >= total) {
        setTocando(false);
        setDecorrido(0);
        base.current = 0;
      } else setDecorrido(agora);
    }, 100);
    return () => window.clearInterval(id);
  }, [tocando, total, real]);

  const alternar = useCallback(() => {
    const el = audio.current;
    if (real && el) {
      if (tocando) {
        el.pause();
        setTocando(false);
        return;
      }
      setTocando(true);
      try {
        const p = el.play() as Promise<void> | undefined;
        if (p && typeof p.catch === "function") p.catch(() => setTocando(false));
      } catch {
        setTocando(false);
      }
      return;
    }
    if (tocando) {
      base.current += Date.now() - inicio.current;
      setDecorrido(base.current);
      setTocando(false);
    } else {
      inicio.current = Date.now();
      setTocando(true);
    }
  }, [tocando, real]);

  const propsAudio: PropsAudioReal | null = url
    ? {
        ref: audio,
        src: url,
        preload: "metadata",
        onTimeUpdate: (e) => setDecorrido(e.currentTarget.currentTime * 1000),
        onLoadedMetadata: (e) => {
          // O webm gravado no Chrome chega com duração Infinity até ser lido inteiro.
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDurReal(d);
        },
        onEnded: () => {
          setTocando(false);
          setDecorrido(0);
        },
        onPause: () => setTocando(false),
      }
    : null;

  const progresso = Math.min(1, decorrido / total);
  return { tocando, progresso, decorridoS: decorrido / 1000, durS, alternar, propsAudio };
}

/** As barras da onda: as que já tocaram ficam acesas. */
export function Onda({ progresso }: { progresso: number }) {
  return (
    <span className={s.boOnda} aria-hidden="true">
      {BARRAS.map((altura, k) => (
        <i
          key={k}
          style={{ height: altura }}
          data-on={progresso > 0 && (k + 0.5) / BARRAS.length <= progresso ? "" : undefined}
        />
      ))}
    </span>
  );
}

/* =============================================================================
   Cenas de exemplo (o exemplo não tem arquivos): as mesmas ilustrações do Chat final
   ============================================================================= */

export function CenaFoto({ className }: { className?: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 260 190" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="260" height="190" fill="#dfe9f5" />
      <rect y="154" width="260" height="36" fill="#c9d1dc" />
      <rect x="38" y="26" width="184" height="130" fill="#c8b8a4" />
      <rect x="38" y="26" width="184" height="6" fill="#b3a28d" />
      {[54, 96, 138, 180].map((x) => (
        <g key={x}>
          <rect x={x} y="42" width="30" height="22" rx="2" fill="#8fa6bf" />
          <rect x={x} y="76" width="30" height="22" rx="2" fill="#8fa6bf" />
        </g>
      ))}
      <rect x="46" y="106" width="168" height="10" rx="2" fill="#1c2750" />
      <rect x="52" y="116" width="156" height="40" fill="#5b6f88" />
      <rect x="118" y="122" width="24" height="34" fill="#3d4d63" />
      <rect x="88" y="66" width="8" height="6" fill="#e9e1d6" />
      <rect x="160" y="30" width="10" height="7" fill="#e9e1d6" />
      <rect x="196" y="100" width="9" height="6" fill="#e9e1d6" />
    </svg>
  );
}

export function CenaVideo({ className }: { className?: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="320" height="200" fill="#e6e1d8" />
      <rect x="196" y="22" width="96" height="70" rx="4" fill="#d9e7f5" />
      <path d="M244 22v70M196 57h96" stroke="#c4ccd6" strokeWidth="3" />
      <rect y="150" width="320" height="50" fill="#d3cabb" />
      <rect x="28" y="34" width="120" height="116" rx="6" fill="#c9d0da" />
      <path d="M28 72h120M28 110h120" stroke="#aab4c2" strokeWidth="3" />
      <rect x="40" y="48" width="18" height="22" rx="3" fill="#8fa6bf" />
      <rect x="64" y="52" width="22" height="18" rx="3" fill="#e9e1d6" />
      <rect x="92" y="46" width="16" height="24" rx="3" fill="#5b6f88" />
      <rect x="44" y="86" width="26" height="22" rx="3" fill="#e9e1d6" />
      <rect x="78" y="90" width="18" height="18" rx="3" fill="#8fa6bf" />
      <rect x="104" y="84" width="20" height="24" rx="3" fill="#c8b8a4" />
      <rect x="172" y="104" width="124" height="46" rx="6" fill="#5b6f88" />
      <rect x="168" y="98" width="132" height="10" rx="3" fill="#1c2750" />
    </svg>
  );
}

function Figurinha() {
  return (
    <svg viewBox="0 0 112 112" aria-hidden="true">
      <circle cx="56" cy="56" r="52" fill="#ffffff" />
      <circle cx="56" cy="56" r="46" fill="#e2f2fe" />
      <ellipse cx="56" cy="67" rx="18" ry="15" fill="#0e1531" />
      <ellipse cx="33" cy="49" rx="7" ry="9" fill="#0e1531" />
      <ellipse cx="46" cy="35" rx="7" ry="9" fill="#0e1531" />
      <ellipse cx="66" cy="35" rx="7" ry="9" fill="#0e1531" />
      <ellipse cx="79" cy="49" rx="7" ry="9" fill="#0e1531" />
      <circle cx="86" cy="24" r="6" fill="#0b91f8" />
    </svg>
  );
}

/* =============================================================================
   A foto ou o vídeo ampliados (a "luz" do Chat final): janela modal no palco escuro
   ============================================================================= */

const FOCAVEIS = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function LuzMidia({
  tipo,
  nome,
  sub,
  url,
  duracaoS,
  aoFechar,
}: {
  tipo: "imagem" | "video";
  nome: string;
  sub: string;
  url: string | null;
  duracaoS: number;
  aoFechar: () => void;
}) {
  const idTitulo = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const tocador = useTocador(duracaoS);

  useEffect(() => {
    fechar.current?.focus();
  }, []);

  function tecla(e: KeyboardEvent<HTMLDivElement>) {
    // A janela é modal e vai para o body por portal, mas no React as teclas ainda sobem até quem
    // envolve a Bolha (a Gaveta, o foco móvel da conversa). Nenhuma tecla daqui sai da janela.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      aoFechar();
      return;
    }
    if (e.key !== "Tab" || !caixa.current) return;
    // Prende o Tab dentro da janela: do último volta ao primeiro, e vice-versa.
    const itens = Array.from(caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS));
    if (!itens.length) return;
    const primeiro = itens[0]!;
    const ultimo = itens[itens.length - 1]!;
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  return createPortal(
    <div
      className={s.boVeu}
      data-identidade="aipro"
      onClick={(e) => {
        e.stopPropagation();
        aoFechar();
      }}
    >
      <div
        ref={caixa}
        className={s.boLuz}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onKeyDown={tecla}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.boLuzCab}>
          <div>
            <p id={idTitulo} className={s.boLuzTitulo}>
              {nome}
            </p>
            <span className={s.boLuzSub}>{sub}</span>
          </div>
          <button ref={fechar} type="button" className={s.boLuzFechar} aria-label="Fechar" onClick={aoFechar}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {tipo === "imagem" ? (
          <div className={s.boLuzImg}>
            {url ? <img src={url} alt={nome} /> : <CenaFoto />}
          </div>
        ) : url ? (
          <div className={s.boLuzVideo} data-real="">
            <video src={url} controls autoPlay playsInline aria-label={nome} />
          </div>
        ) : (
          <div className={s.boLuzVideo}>
            <button
              type="button"
              className={s.boLuzPlay}
              aria-label={tocador.tocando ? "Pausar o vídeo" : "Reproduzir o vídeo"}
              onClick={tocador.alternar}
            >
              {tocador.tocando ? <Pause aria-hidden="true" size={20} fill="currentColor" /> : <Play aria-hidden="true" size={20} fill="currentColor" />}
            </button>
            <span className={s.boLuzBarra} aria-hidden="true">
              <span style={{ transform: `scaleX(${tocador.progresso})` }} />
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* =============================================================================
   Partes da bolha
   ============================================================================= */

/**
 * "Não enviada · Tentar de novo" ou "Envio cancelado", embaixo do balão. As outras situações viram
 * os vistos ao lado da hora, dentro do balão (`HoraBolha`).
 */
function LinhaSituacao({
  status,
  aoTentarDeNovo,
}: {
  status: Situacao;
  aoTentarDeNovo: (() => void) | undefined;
}) {
  const icone = { size: 15, "aria-hidden": true } as const;
  let conteudo: ReactNode;
  switch (status) {
    case "falhou":
      conteudo = (
        <>
          <CircleAlert {...icone} />
          <span>Não enviada</span>
          {aoTentarDeNovo && (
            <button type="button" className={s.boTentar} onClick={aoTentarDeNovo}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>Tentar de novo</span>
            </button>
          )}
        </>
      );
      break;
    case "cancelada":
      conteudo = (
        <>
          <CircleX {...icone} />
          <span>Envio cancelado</span>
        </>
      );
      break;
    default:
      return null;
  }
  return (
    <p className={s.boStatus} data-situacao={status}>
      {conteudo}
    </p>
  );
}

function textoSituacao(status: Situacao, nomeLead: string | undefined): string {
  switch (status) {
    case "na_fila":
      return "Na fila";
    case "enviando":
      return "Enviando";
    case "enviada":
      return "Enviada";
    case "entregue":
      return "Entregue";
    case "lida":
      return nomeLead ? `Lida por ${nomeLead}` : "Lida";
    case "falhou":
      return "Não enviada";
    case "cancelada":
      return "Envio cancelado";
    default:
      return "";
  }
}

/** Os vistos do WhatsApp: relógio (na fila, enviando), ✓ enviada, ✓✓ entregue, ✓✓ azul lida. */
function Vistos({ status, nomeLead }: { status: Situacao; nomeLead: string | undefined }) {
  const p = { size: 16, strokeWidth: 2.25, "aria-hidden": true } as const;
  let icone: ReactNode;
  switch (status) {
    case "na_fila":
    case "enviando":
      icone = <Clock {...p} size={13} />;
      break;
    case "enviada":
      icone = <Check {...p} />;
      break;
    case "entregue":
    case "lida":
      icone = <CheckCheck {...p} />;
      break;
    default:
      return null;
  }
  return (
    <span className={s.boVisto} data-vistos={status} title={textoSituacao(status, nomeLead)}>
      {icone}
    </span>
  );
}

/**
 * A hora no canto de baixo do balão, com "editada" antes e os vistos depois (só nas enviadas).
 * `sobre`: por cima da mídia (foto sem legenda, vídeo e figurinha), com fundo escuro translúcido.
 * Fica fora do nome acessível: a bolha já diz hora, "editada" e situação no `aria-label`.
 */
function HoraBolha({
  hora,
  editada,
  status,
  nomeLead,
  sobre = false,
}: {
  hora: string;
  editada: boolean;
  status: Situacao | null;
  nomeLead: string | undefined;
  sobre?: boolean;
}) {
  if (!hora && !editada && !status) return null;
  return (
    <span className={s.boHora} data-sobre={sobre || undefined} aria-hidden="true">
      {editada && <span>editada</span>}
      {hora && <span className={s.boHoraNum}>{hora}</span>}
      {status && <Vistos status={status} nomeLead={nomeLead} />}
    </span>
  );
}

/**
 * A bolinha de quem falou, na 1ª mensagem de cada grupo: o lead à esquerda (o AvatarLead, na cor
 * dele); à direita, a Janete (o símbolo), a equipe (as iniciais em navy) e o celular da empresa (o
 * ícone, no branco com contorno do balão dele). Decorativa: o nome está no `aria-label` da bolha.
 */
function QuemFalou({ origem, autor }: { origem: Origem; autor: AutorBolha }) {
  switch (origem) {
    case "lead":
      return <AvatarLead nome={autor.nomeCompleto ?? autor.nome} cor={autor.cor ?? undefined} tamanho="p" />;
    case "janete":
      return (
        <span className={s.boQuem} data-quem="janete" aria-hidden="true">
          <JaneteSimbolo tamanho={36} decorativo />
        </span>
      );
    case "humano_tela": {
      /* As mesmas iniciais do selo de quem atende e da passagem: "VC" para quem olha. */
      const ini = autor.iniciais?.trim()
        ? autor.iniciais.trim().slice(0, 2).toUpperCase()
        : autor.nome.trim() === "Você"
          ? "VC"
          : iniciais(autor.nome);
      return (
        <span className={s.boQuem} data-quem="equipe" aria-hidden="true">
          {ini}
        </span>
      );
    }
    case "humano_celular":
      return (
        <span className={s.boQuem} data-quem="celular" aria-hidden="true">
          <Smartphone size={17} strokeWidth={1.9} data-glifo="celular" />
        </span>
      );
    default:
      return <span className={s.boAvatarEsp} aria-hidden="true" />;
  }
}

/* =============================================================================
   A mídia pelo link assinado (spec 2.1, midia.ts): o bucket `midias` é privado, e cada arquivo
   abre por um link de 1 h. Enquanto o servidor copia do WhatsApp, a mídia está `pendente`; se não
   deu para copiar, `falhou`; se o WhatsApp já não guardava o arquivo, `expirada`.
   ============================================================================= */

/** O link de uma mídia pronta: o endereço, carregando, ou o erro com "Carregar de novo". Nulo = sem link (o exemplo). */
export type EstadoLink = { url: string } | { carregando: true } | { erro: true; tentarDeNovo: () => void } | null;

/**
 * Em que pé está a mídia que a bolha desenha:
 * - `link`: o arquivo abre (`url`);
 * - `sem`: não há arquivo, e a tela desenha a ilustração (o exemplo);
 * - `pendente`, `falhou`, `expirada`: o `midia_status` do banco;
 * - `carregando`: o link assinado está sendo pedido;
 * - `erro_link`: o pedido do link falhou (com "Carregar de novo");
 * - `indisponivel`: no banco, a mensagem de mídia chegou sem arquivo nem situação.
 */
type EstadoMidia =
  | { k: "link"; url: string }
  | { k: "sem" }
  | { k: "pendente" | "falhou" | "expirada" | "carregando" | "indisponivel" }
  | { k: "erro_link"; tentarDeNovo: () => void };

const TIPOS_COM_MIDIA: readonly Enums<"mensagem_tipo">[] = ["imagem", "audio", "video", "documento", "figurinha"];

const NOME_DA_MIDIA: Partial<Record<Enums<"mensagem_tipo">, readonly [artigo: "a" | "o", nome: string]>> = {
  imagem: ["a", "foto"],
  audio: ["o", "áudio"],
  video: ["o", "vídeo"],
  documento: ["o", "arquivo"],
  figurinha: ["a", "figurinha"],
};

/** A frase de cada estado da mídia ("Baixando a foto do WhatsApp…"). Vazia em `link` e `sem`. */
export function textoEstadoMidia(k: EstadoMidia["k"], tipo: Enums<"mensagem_tipo">): string {
  const [a, nome] = NOME_DA_MIDIA[tipo] ?? (["a", "mídia"] as const);
  const A = a.toUpperCase();
  switch (k) {
    case "pendente":
      return `Baixando ${a} ${nome} do WhatsApp…`;
    case "carregando":
      return `Carregando ${a} ${nome}…`;
    case "falhou":
      return `Não deu para baixar ${a} ${nome} do WhatsApp.`;
    case "expirada":
      return `${A} ${nome} não está mais disponível no WhatsApp.`;
    case "indisponivel":
      return `${A} ${nome} não está disponível.`;
    case "erro_link":
      return `Não deu para abrir ${a} ${nome}.`;
    default:
      return "";
  }
}

/**
 * O aviso no lugar da mídia que não abre. `bloco`: a caixa do tamanho da mídia (foto, vídeo,
 * figurinha); sem ele, uma linha (documento, áudio). Em `erro_link`, "Carregar de novo".
 */
function AvisoMidia({
  estado,
  tipo,
  bloco = false,
  tabIndex,
  children,
}: {
  estado: EstadoMidia;
  tipo: Enums<"mensagem_tipo">;
  bloco?: boolean;
  tabIndex?: number | undefined;
  children?: ReactNode;
}) {
  const esperando = estado.k === "pendente" || estado.k === "carregando";
  const icone = { size: bloco ? 20 : 15, "aria-hidden": true } as const;
  return (
    <span className={s.boMidiaEstado} data-estado={estado.k} data-bloco={bloco || undefined}>
      {esperando ? (
        <LoaderCircle {...icone} data-girando="" />
      ) : estado.k === "erro_link" ? (
        <CircleAlert {...icone} />
      ) : (
        <ImageOff {...icone} />
      )}
      <span>{textoEstadoMidia(estado.k, tipo)}</span>
      {estado.k === "erro_link" && (
        <button type="button" className={s.boMidiaDeNovo} tabIndex={tabIndex} onClick={estado.tentarDeNovo}>
          <RefreshCw size={14} aria-hidden="true" />
          <span>Carregar de novo</span>
        </button>
      )}
      {children}
    </span>
  );
}

function Audio({
  mensagem,
  transcricaoFalhou,
  hora,
  estado,
  tabIndex,
}: {
  mensagem: MensagemBolha;
  transcricaoFalhou: boolean;
  /** A hora com os vistos, à direita, embaixo da onda (dentro da pílula). */
  hora: ReactNode;
  estado: EstadoMidia;
  tabIndex?: number | undefined;
}) {
  const url = estado.k === "link" ? estado.url : null;
  const tocador = useTocador(duracaoDe(mensagem), url);
  const dur = tocador.durS;
  const [aberta, setAberta] = useState(false);
  const idTransc = useId();
  const transcricao = mensagem.transcricao?.trim();
  /* No áudio que a Janete gerou (voz), o texto guardado não é transcrição: é o que ela falou. */
  const daJanete = mensagem.origem === "janete";
  /* Sem o arquivo (baixando, falhou, expirado), o player dá lugar ao aviso; a transcrição continua. */
  const toca = estado.k === "link" || estado.k === "sem";

  return (
    <div className={cx(s.boBolha, s.boAudio)} data-origem={mensagem.origem}>
      {tocador.propsAudio && <audio {...tocador.propsAudio} hidden />}
      <div className={s.boPlayer}>
        {toca ? (
          <button
            type="button"
            className={s.boPlay}
            aria-label={tocador.tocando ? "Pausar o áudio" : `Ouvir o áudio de ${mmss(dur)}`}
            onClick={tocador.alternar}
          >
            {tocador.tocando ? (
              <Pause aria-hidden="true" size={16} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play aria-hidden="true" size={16} fill="currentColor" strokeWidth={0} />
            )}
          </button>
        ) : null}
        <div className={s.boAudioCol}>
          {toca ? <Onda progresso={tocador.progresso} /> : <AvisoMidia estado={estado} tipo="audio" tabIndex={tabIndex} />}
          <div className={s.boAudioPe}>
            <span className={s.boTempo} aria-hidden="true">
              {tocador.tocando || tocador.progresso > 0 ? `${mmss(tocador.decorridoS)} / ${mmss(dur)}` : mmss(dur)}
            </span>
            {hora}
          </div>
        </div>
      </div>
      {transcricao ? (
        <div className={s.boTransc}>
          <button
            type="button"
            className={s.boTranscBot}
            aria-expanded={aberta}
            aria-controls={aberta ? idTransc : undefined}
            onClick={() => setAberta((a) => !a)}
          >
            <JaneteSimbolo tamanho={16} decorativo />
            <span className={s.boTranscRot}>{daJanete ? "O que a Janete falou" : "Transcrição da Janete"}</span>
            <ChevronDown className={s.boTranscSeta} size={16} aria-hidden="true" />
          </button>
          {aberta && (
            <p id={idTransc} className={s.boTranscTexto}>
              <span className={s.sr}>{daJanete ? "Texto falado: " : "Transcrição: "}</span>
              {transcricao}
            </p>
          )}
        </div>
      ) : transcricaoFalhou ? (
        <p className={s.boTranscSem}>
          <CircleAlert size={16} aria-hidden="true" />
          <span>A Janete não conseguiu transcrever este áudio</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * A escolha de reação, presa à linha da mensagem (não às ações, que flutuam no canto do balão).
 * Setas, Home e End andam; Esc fecha. O clique fora dela fecha, menos no próprio botão Reagir
 * (`ancora`), que abre e fecha pelo clique dele.
 */
function EscolhaReacao({
  atual,
  ancora,
  aoEscolher,
  aoFechar,
}: {
  atual: string | null;
  ancora: RefObject<HTMLButtonElement | null>;
  aoEscolher: (emoji: string) => void;
  aoFechar: (devolverFoco: boolean) => void;
}) {
  const grupo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    grupo.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function fora(e: PointerEvent) {
      const alvo = e.target as Node | null;
      if (alvo && (grupo.current?.contains(alvo) || ancora.current?.contains(alvo))) return;
      aoFechar(false);
    }
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aoFechar, ancora]);

  function tecla(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      aoFechar(true);
      return;
    }
    if (e.key === "Tab") {
      aoFechar(false);
      return;
    }
    const itens = Array.from(grupo.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    let j: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % itens.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = i <= 0 ? itens.length - 1 : i - 1;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = itens.length - 1;
    if (j == null) return;
    e.preventDefault();
    e.stopPropagation();
    itens[j]?.focus();
  }

  return (
    <div ref={grupo} className={s.boReacoes} role="group" aria-label="Escolher uma reação" onKeyDown={tecla}>
      {REACOES.map(([emoji, nome]) => (
        <button
          key={emoji}
          type="button"
          aria-label={`Reagir com ${nome}`}
          aria-pressed={atual === emoji}
          onClick={() => aoEscolher(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/* =============================================================================
   A bolha
   ============================================================================= */

type Props = {
  mensagem: MensagemBolha;
  autor: AutorBolha;
  /** Continuação do mesmo autor: sem a bolinha de quem falou (fica só o espaço dela, para alinhar). */
  agrupada?: boolean | undefined;
  /** Responder citando esta mensagem. Sem ele, o botão não aparece. */
  aoResponder?: ((mensagemId: string) => void) | undefined;
  /**
   * Reagir (emoji) ou tirar a reação (null). Só vale com `comReagir`: na v1 o Reagir fica escondido
   * (decisão 5) e a reação que já existe só aparece, sem botão.
   */
  aoReagir?: ((mensagemId: string, emoji: string | null) => void) | undefined;
  /** Mostra o Reagir (2ª rodada, decisão 5). Padrão: escondido. */
  comReagir?: boolean | undefined;
  /**
   * Reenviar a mensagem que falhou. Sem ele, "Não enviada" aparece sem o botão. Com a regra da
   * decisão 8 (`regraDeReenvio`), o botão só aparece onde `podeTentarDeNovo` deixa.
   */
  aoTentarDeNovo?: ((mensagemId: string) => void) | undefined;
  /**
   * Aplica a decisão 8 ao "Tentar de novo" (só a mensagem da equipe pela tela, e nunca a que pode
   * ter chegado). Padrão: ligada no modo banco (`useModoDados()`), desligada no exemplo, que aceita
   * reenviar qualquer mensagem (transição: o Chat do exemplo reenvia a da Janete).
   */
  regraDeReenvio?: boolean | undefined;
  /** O trecho que esta mensagem cita, já resolvido pela tela. Ganha de `resolverCitacao`. */
  citacao?: CitacaoBolha | null | undefined;
  /**
   * Acha a citação pelo id citado (`responde_a_id` no banco, `citaId` no exemplo), quando a tela não
   * passa `citacao`. Devolve null quando a mensagem citada não está carregada: a bolha diz
   * "Respondendo a uma mensagem anterior".
   */
  resolverCitacao?: ((mensagemId: string) => CitacaoBolha | null | undefined) | undefined;
  /**
   * Sem efeito desde a rodada 2 do Chat (30/10), mas continua aceita para não quebrar quem passa.
   * Os vistos aparecem em toda mensagem enviada, e o nome acessível diz a situação ("Na fila",
   * "Entregue", "Lida por…", "Não enviada"…) em todas elas, para o leitor de tela saber o mesmo
   * que quem vê.
   */
  mostrarSituacao?: boolean | undefined;
  /** O primeiro nome do lead, para "Lida por Ricardo". */
  nomeLead?: string | undefined;
  /** Áudio do lead que a Janete não conseguiu transcrever (o motivo `audio_sem_transcricao`). */
  transcricaoFalhou?: boolean | undefined;
  /**
   * Endereço do arquivo, quando a tela já tem. Sem ele, a bolha pede o link assinado da mídia pronta
   * (`useUrlMidia`), de uma vez para a conversa quando ela está dentro de um `<LoteMidias>`. O
   * exemplo não tem arquivo: mostra a ilustração.
   */
  urlMidia?: string | null | undefined;
  /** Baixar o documento (no exemplo, simulado pela tela). */
  aoBaixar?: ((mensagemId: string) => void) | undefined;
  /** Foco móvel entre as mensagens: a tela controla qual delas é parada de Tab. */
  tabIndex?: number | undefined;
  onKeyDown?: ((e: KeyboardEvent<HTMLElement>) => void) | undefined;
  onFocus?: ((e: FocusEvent<HTMLElement>) => void) | undefined;
  id?: string | undefined;
  className?: string | undefined;
};

/**
 * Uma mensagem da conversa, no desenho da rodada 2 do Chat (30/10). As 4 origens se distinguem de
 * relance (lado, cor e a bolinha de quem falou, na 1ª mensagem de cada grupo): o lead em cinza à
 * esquerda, com o avatar; a Janete em azul-claro, com o símbolo dela; a equipe pela tela em navy, com as
 * iniciais; o celular da empresa em branco, com contorno e o ícone do celular. O nome e o papel não
 * aparecem escritos: ficam no nome acessível. A hora vai no canto de baixo do balão (por cima da
 * mídia na foto, no vídeo e na figurinha), com "editada" antes e os vistos depois; "Não enviada ·
 * Tentar de novo" fica embaixo; no canto de baixo, a reação; no canto de cima, responder (e reagir,
 * na 2ª rodada; no celular, embaixo do balão).
 *
 * A mídia pronta abre pelo link assinado; enquanto ele vem, ou quando a mídia está baixando, falhou
 * ou expirou no WhatsApp, a bolha mostra o aviso no lugar dela.
 */
export function Bolha(props: Props) {
  const lote = useContext(LoteContexto);
  const cliente = useClienteDados();
  const m = props.mensagem;
  const caminho = m.midia_caminho ?? null;
  const precisaLink =
    props.urlMidia === undefined &&
    !!caminho &&
    TIPOS_COM_MIDIA.includes(m.tipo) &&
    !estaApagada(m) &&
    situacaoDaMidia({ midia_caminho: caminho, midia_status: m.midia_status ?? null }) === "pronta";
  if (precisaLink && lote?.caminhos.has(caminho)) return <BolhaBase {...props} link={linkDoLote(lote, caminho)} />;
  if (precisaLink && cliente) return <BolhaComLink {...props} caminho={caminho} />;
  return <BolhaBase {...props} link={null} />;
}

/** A mídia fora de um `<LoteMidias>`: a bolha pede o próprio link. */
function BolhaComLink({ caminho, ...props }: Props & { caminho: string }) {
  const lista = useMemo(() => [caminho], [caminho]);
  const r = useUrlMidia(lista);
  return <BolhaBase {...props} link={linkDoLote(r, caminho)} />;
}

/**
 * O estado de um caminho dentro do lote: o link, se já veio (mesmo enquanto o lote novo é pedido, a
 * mídia que já abria continua abrindo); sem link e com busca em andamento, carregando; sem link e
 * com a busca terminada, o erro com "Carregar de novo".
 */
export function linkDoLote(r: Pick<UrlsMidia, "urls" | "buscando" | "tentarDeNovo">, caminho: string): EstadoLink {
  const url = r.urls[caminho];
  if (url) return { url };
  if (r.buscando) return { carregando: true };
  return { erro: true, tentarDeNovo: r.tentarDeNovo };
}

/** A citação de uma mensagem que não está carregada (mais antiga que a página, ou apagada do banco). */
export const CITACAO_FORA: CitacaoBolha = { de: "Mensagem anterior", texto: "Ela não está entre as mensagens carregadas." };

type ValorLote = UrlsMidia & { caminhos: ReadonlySet<string> };

const LoteContexto = createContext<ValorLote | null>(null);

/**
 * Os links das mídias de uma conversa, pedidos de uma vez (um `createSignedUrls` para todas): a tela
 * embrulha a lista de bolhas com ele. No modo exemplo (sem cliente do Firebase), não faz nada.
 */
export function LoteMidias({ mensagens, children }: { mensagens: readonly MensagemBolha[]; children: ReactNode }) {
  const cliente = useClienteDados();
  if (!cliente) return <>{children}</>;
  return <LoteComCliente mensagens={mensagens}>{children}</LoteComCliente>;
}

function LoteComCliente({ mensagens, children }: { mensagens: readonly MensagemBolha[]; children: ReactNode }) {
  const caminhos = useMemo(
    () =>
      caminhosProntos(
        mensagens
          .filter((m) => TIPOS_COM_MIDIA.includes(m.tipo) && !estaApagada(m))
          .map((m) => ({ midia_caminho: m.midia_caminho ?? null, midia_status: m.midia_status ?? null })),
      ),
    [mensagens],
  );
  const r = useUrlMidia(caminhos);
  const valor: ValorLote = { ...r, caminhos: new Set(caminhos) };
  return <LoteContexto.Provider value={valor}>{children}</LoteContexto.Provider>;
}

function BolhaBase({
  mensagem: m,
  autor,
  agrupada = false,
  aoResponder,
  aoReagir,
  comReagir = false,
  aoTentarDeNovo,
  regraDeReenvio,
  citacao: citacaoProp,
  resolverCitacao,
  nomeLead,
  transcricaoFalhou = false,
  urlMidia,
  aoBaixar,
  tabIndex,
  onKeyDown,
  onFocus,
  id,
  className,
  link,
}: Props & { link: EstadoLink }) {
  const [reagindo, setReagindo] = useState(false);
  const [luz, setLuz] = useState(false);
  const botaoReagir = useRef<HTMLButtonElement>(null);
  const abridor = useRef<HTMLButtonElement>(null);
  const artigo = useRef<HTMLElement>(null);
  const modo = useModoDados();

  const doLead = m.origem === "lead";
  const apagada = estaApagada(m);
  const papel = autor.papel ?? PAPEL_PADRAO[m.origem];
  const h = horaBolha(m.momento);
  const reacao = m.reacao ?? null;
  const nomeMidia = m.midia_nome ?? (m.tipo === "imagem" ? "Foto" : m.tipo === "video" ? "Vídeo" : "Documento");
  const dur = duracaoDe(m);
  /* Só no Reagir de verdade (2ª rodada): na v1 ele fica escondido (decisão 5). */
  const reagir = comReagir ? aoReagir : undefined;

  /* A citação: a que a tela passou ou a achada pelo id citado (responde_a_id no banco, citaId no exemplo). */
  const citado = idCitado(m);
  const citacao: CitacaoBolha | null =
    citacaoProp !== undefined
      ? citacaoProp
      : citado && resolverCitacao
        ? (resolverCitacao(citado) ?? CITACAO_FORA)
        : null;

  /* A mídia: o link da tela, o link assinado, a situação do banco ou a ilustração do exemplo. */
  const comMidia = TIPOS_COM_MIDIA.includes(m.tipo) && !apagada;
  const situacao = situacaoDaMidia({ midia_caminho: m.midia_caminho ?? null, midia_status: m.midia_status ?? null });
  const estadoMidia: EstadoMidia = urlMidia
    ? { k: "link", url: urlMidia }
    : !comMidia
      ? { k: "sem" }
      : situacao === "pendente" || situacao === "falhou" || situacao === "expirada"
        ? { k: situacao }
        : link && "url" in link
          ? { k: "link", url: link.url }
          : link && "carregando" in link
            ? { k: "carregando" }
            : link && "erro" in link
              ? { k: "erro_link", tentarDeNovo: link.tentarDeNovo }
              : modo === "banco"
                ? { k: "indisponivel" }
                : { k: "sem" };
  const url = estadoMidia.k === "link" ? estadoMidia.url : null;
  /* A mídia que não abre (baixando, falhou, expirou, link pedido ou com erro) mostra o aviso no lugar. */
  const avisoMidia = estadoMidia.k !== "link" && estadoMidia.k !== "sem";

  const semEnvio = !doLead && SEM_ENVIO.includes(m.status);
  /* Decisão 8: no banco, só a mensagem da equipe que falhou e não pode ter chegado volta a sair. */
  const aplicarRegra = regraDeReenvio ?? modo === "banco";
  const reenviar = aoTentarDeNovo && (!aplicarRegra || podeTentarDeNovo(m)) ? aoTentarDeNovo : undefined;
  /* Os vistos vão em toda mensagem que a empresa mandou (não na do lead, na apagada nem na que não saiu). */
  const statusVistos = doLead || apagada || m.status === "recebida" || semEnvio ? null : m.status;
  /* O nome acessível diz a situação sempre que a tela mostra vistos ou "Não enviada"/"Envio cancelado". */
  const situacaoVisivel = statusVistos !== null || semEnvio;
  const temAcoes = !apagada && (!!aoResponder || !!reagir);
  const editada = !!m.editada && !apagada;
  const hora = (sobre = false) => (
    <HoraBolha hora={h} editada={editada} status={statusVistos} nomeLead={nomeLead} sobre={sobre} />
  );

  /* A citação numa caixa com a barra colorida: dentro do balão de texto; nas mídias, em cima delas. */
  const caixaCita = citacao ? (
    <span className={s.boCita} data-solta={m.tipo === "texto" && !apagada ? undefined : ""}>
      <b className={s.boCitaDe}>{citacao.de}</b>
      <span className={s.boCitaTxt}>{citacao.texto}</span>
    </span>
  ) : null;
  const citaDentro = m.tipo === "texto" && !apagada;
  /* No foco móvel, a mensagem fora da vez também tira os botões dela da ordem do Tab. */
  const tabAcoes = tabIndex === -1 ? -1 : undefined;

  const fecharReacao = useCallback((devolver: boolean) => {
    setReagindo(false);
    if (devolver) botaoReagir.current?.focus();
  }, []);

  function fecharLuz() {
    setLuz(false);
    abridor.current?.focus();
  }

  /* O resumo vai cortado em 140 caracteres: o leitor de tela lê o nome a cada passo do foco. */
  const resumo = resumoBolha(m);
  const resumoCurto = resumo.length > 140 ? `${resumo.slice(0, 139)}…` : resumo;
  const aria = [
    `${autor.nome}, ${papel}${h ? `, ${h}` : ""}: `,
    citacao ? `respondendo a ${citacao.de}. ` : "",
    resumoCurto,
    m.editada && !apagada ? ", editada" : "",
    situacaoVisivel ? `, ${textoSituacao(m.status, nomeLead)}` : "",
    reacao ? `, com reação ${reacao}` : "",
    avisoMidia ? `. ${textoEstadoMidia(estadoMidia.k, m.tipo)}` : "",
  ].join("");

  let conteudo: ReactNode;
  if (apagada) {
    conteudo = (
      <p className={cx(s.boBolha, s.boApagada)}>
        <Ban size={16} aria-hidden="true" />
        <span>{doLead ? "O lead apagou esta mensagem" : "Mensagem apagada"}</span>
        {hora()}
      </p>
    );
  } else {
    switch (m.tipo) {
      case "texto":
        conteudo = (
          <p className={s.boBolha} data-origem={m.origem} data-cita={citacao ? "" : undefined}>
            {caixaCita}
            {m.texto}
            {hora()}
          </p>
        );
        break;
      case "imagem":
        /* Sem legenda, a hora vai por cima da foto; com legenda, no canto do balão dela. */
        conteudo = (
          <>
            {avisoMidia ? (
              <div className={s.boMidia} data-aviso="">
                <AvisoMidia estado={estadoMidia} tipo="imagem" bloco tabIndex={tabAcoes}>
                  {!m.texto && hora()}
                </AvisoMidia>
              </div>
            ) : (
              <div className={s.boMidia}>
                <button
                  ref={abridor}
                  type="button"
                  className={s.boFoto}
                  aria-label={`Ampliar a foto ${nomeMidia}`}
                  onClick={() => setLuz(true)}
                >
                  {url ? <img src={url} alt="" className={s.boCena} /> : <CenaFoto className={s.boCena} />}
                </button>
                {!m.texto && hora(true)}
              </div>
            )}
            {m.texto && (
              <p className={s.boBolha} data-origem={m.origem}>
                {m.texto}
                {hora()}
              </p>
            )}
          </>
        );
        break;
      case "audio":
        conteudo = (
          <Audio
            mensagem={m}
            transcricaoFalhou={doLead && transcricaoFalhou}
            hora={hora()}
            estado={estadoMidia}
            tabIndex={tabAcoes}
          />
        );
        break;
      case "video":
        conteudo = avisoMidia ? (
          <div className={s.boMidia} data-aviso="">
            <AvisoMidia estado={estadoMidia} tipo="video" bloco tabIndex={tabAcoes}>
              {hora()}
            </AvisoMidia>
          </div>
        ) : (
          <div className={s.boVideo}>
            {url ? (
              // A miniatura é o 1º quadro do próprio vídeo (o #t=0.1 faz o Safari desenhar o quadro).
              <video className={s.boCena} src={`${url}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" />
            ) : (
              <CenaVideo className={s.boCena} />
            )}
            <button
              ref={abridor}
              type="button"
              className={s.boVideoPlay}
              aria-label={`Assistir ao vídeo ${nomeMidia}, ${mmss(dur)}`}
              onClick={() => setLuz(true)}
            >
              <Play aria-hidden="true" size={20} fill="currentColor" strokeWidth={0} />
            </button>
            <span className={s.boVideoDur} aria-hidden="true">
              {mmss(dur)}
            </span>
            {hora(true)}
          </div>
        );
        break;
      case "documento": {
        const ext = extensaoArquivo(m.midia_nome, m.midia_mime);
        const tam = tamanhoArquivo(m.midia_tamanho);
        const rotuloBaixar = `Baixar ${nomeMidia}`;
        conteudo = (
          <div
            className={s.boDoc}
            data-falhou={m.status === "falhou" || undefined}
            data-baixar={url || (aoBaixar && !avisoMidia) ? "" : undefined}
          >
            <span className={s.boDocIc} aria-hidden="true">
              <File size={16} />
              {ext && <span className={s.boDocExt}>{ext}</span>}
            </span>
            <span className={s.boDocTxt}>
              <span className={s.boDocNome} title={nomeMidia}>
                {nomeMidia}
              </span>
              <span className={s.boDocLinha}>
                <span className={s.boDocMeta}>{[ext, tam].filter(Boolean).join(" · ")}</span>
                {hora()}
              </span>
              {avisoMidia && <AvisoMidia estado={estadoMidia} tipo="documento" tabIndex={tabAcoes} />}
            </span>
            {url ? (
              <a className={s.boDocBaixar} href={url} download={nomeMidia} aria-label={rotuloBaixar}>
                <Download size={18} aria-hidden="true" />
              </a>
            ) : aoBaixar && !avisoMidia ? (
              <button
                type="button"
                className={s.boDocBaixar}
                aria-label={rotuloBaixar}
                onClick={() => aoBaixar(m.id)}
              >
                <Download size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
        break;
      }
      case "figurinha":
        conteudo = avisoMidia ? (
          <span className={s.boMidia} data-aviso="">
            <AvisoMidia estado={estadoMidia} tipo="figurinha" bloco tabIndex={tabAcoes}>
              {hora()}
            </AvisoMidia>
          </span>
        ) : (
          <span className={s.boMidia} data-fig="">
            <span className={s.boFig} role="img" aria-label="Figurinha">
              {url ? <img src={url} alt="" /> : <Figurinha />}
            </span>
            {hora(true)}
          </span>
        );
        break;
      default:
        conteudo = (
          <p className={cx(s.boBolha, s.boOutro)} data-origem={m.origem}>
            <Info size={16} aria-hidden="true" />
            <span>Mensagem de um tipo que a plataforma ainda não mostra</span>
            {hora()}
          </p>
        );
    }
  }

  return (
    <article
      ref={artigo}
      id={id}
      className={cx(s.boMsg, className)}
      data-origem={m.origem}
      data-lado={doLead ? "esq" : "dir"}
      data-agrupada={agrupada || undefined}
      data-reagindo={reagindo || undefined}
      aria-label={aria}
      /* Sem foco móvel (a gaveta do Kanban), a mensagem com ações ainda recebe o foco pelo toque
         (-1: fora da ordem do Tab), para Responder e Reagir aparecerem no celular. */
      tabIndex={tabIndex ?? (temAcoes ? -1 : undefined)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <div className={s.boLinha}>
        {agrupada ? (
          <span className={s.boAvatarEsp} aria-hidden="true" />
        ) : (
          <QuemFalou origem={m.origem} autor={autor} />
        )}
        <div className={s.boCorpo} data-reacao={reacao ? "" : undefined}>
          {!citaDentro && caixaCita}
          {conteudo}
          {reacao &&
            (reagir ? (
              <button
                type="button"
                className={s.boReacao}
                aria-label={`Reação ${reacao}. Clique para tirar`}
                onClick={() => reagir(m.id, null)}
              >
                {reacao}
              </button>
            ) : (
              <span className={s.boReacao} role="img" aria-label={`Reação ${reacao}`}>
                {reacao}
              </span>
            ))}
          {/* Responder e Reagir: no computador, uma pílula que flutua no canto de cima do balão, fora
              do fluxo (não toma largura do balão); no celular, uma linha embaixo dele, no foco. Ficam
              depois do balão, para o Tab passar pelo balão antes. */}
          {temAcoes && (
            <div className={s.boAcoes}>
              {aoResponder && (
                <button
                  type="button"
                  className={s.boAcao}
                  tabIndex={tabAcoes}
                  aria-label="Responder citando esta mensagem"
                  onClick={() => aoResponder(m.id)}
                >
                  <Reply size={17} aria-hidden="true" />
                </button>
              )}
              {reagir && (
                <button
                  ref={botaoReagir}
                  type="button"
                  className={s.boAcao}
                  tabIndex={tabAcoes}
                  aria-label="Reagir a esta mensagem"
                  aria-expanded={reagindo}
                  onClick={() => setReagindo((r) => !r)}
                >
                  <SmilePlus size={17} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
        {/* Presa à linha, e não à pílula: assim os 6 emojis cabem sempre na coluna da conversa. */}
        {temAcoes && reagir && reagindo && (
          <EscolhaReacao
            atual={reacao}
            ancora={botaoReagir}
            aoFechar={fecharReacao}
            aoEscolher={(emoji) => {
              reagir(m.id, emoji === reacao ? null : emoji);
              fecharReacao(true);
            }}
          />
        )}
      </div>
      {semEnvio && (
        <LinhaSituacao
          status={m.status}
          aoTentarDeNovo={
            reenviar
              ? () => {
                  reenviar(m.id);
                  /* O botão some com a linha: no foco móvel, o foco fica na própria mensagem. */
                  if (tabIndex !== undefined) artigo.current?.focus();
                }
              : undefined
          }
        />
      )}
      {luz && (m.tipo === "imagem" || m.tipo === "video") && (
        <LuzMidia
          tipo={m.tipo}
          nome={nomeMidia}
          sub={`Enviado por ${autor.nome}${h ? ` às ${h}` : ""}${m.tipo === "video" && dur ? ` · ${mmss(dur)}` : ""}`}
          url={url}
          duracaoS={dur}
          aoFechar={fecharLuz}
        />
      )}
    </article>
  );
}
