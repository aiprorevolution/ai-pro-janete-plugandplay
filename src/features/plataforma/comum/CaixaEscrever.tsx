import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  ArrowUp,
  Clock,
  FileText,
  Image as IconeImagem,
  Info,
  Lock,
  Mic,
  Paperclip,
  Pause,
  Play,
  Reply,
  Smartphone,
  Smile,
  Square,
  Trash2,
  TriangleAlert,
  User,
  UserCheck,
  WifiOff,
  X,
} from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import type { Enums } from "@/integrations/firebase/types";

import { extensaoArquivo, mmss, Onda, tamanhoArquivo } from "./Bolha";
import estilos from "./CaixaEscrever.module.css";

const s = estilos as Classes<
  | "ceRaiz"
  | "ceFaixa"
  | "ceFaixaTxt"
  | "ceFaixaIc"
  | "ceFaixaAcao"
  | "ceCaixa"
  | "ceAviso"
  | "ceCita"
  | "ceCitaTxt"
  | "ceAnexos"
  | "ceAnexo"
  | "ceAnexoMini"
  | "ceAnexoTxt"
  | "ceCampo"
  | "ceGrav"
  | "ceGravPonto"
  | "ceGravTempo"
  | "ceGravOndas"
  | "ceGravDica"
  | "cePlayer"
  | "cePlay"
  | "ceTempo"
  | "cePe"
  | "ceAncora"
  | "ceFerr"
  | "ceMic"
  | "cePeDir"
  | "ceEnviar"
  | "ceBotaoTexto"
  | "ceIconeX"
  | "cePop"
  | "cePopItem"
  | "ceEmojis"
  | "sr"
>;

/* =============================================================================
   Tipos
   ============================================================================= */

export type BloqueioCaixa = "sem_conexao" | "janela_fechada";

/**
 * O tom da faixa leve em cima da caixa (o `.faixa` do Chat final), que diz quem atende e o que
 * acontece ao enviar. Cada tom tem o seu ícone: `janete` (o símbolo), `pessoa`, `celular`,
 * `espera` (relógio, areia), `falha` (triângulo, vermelho claro), `sucesso` (menta) e `neutro`.
 */
export type TomFaixa = "janete" | "pessoa" | "celular" | "espera" | "falha" | "sucesso" | "neutro";

export type FaixaCaixa = {
  texto: string;
  tom?: TomFaixa | undefined;
  /** Um link curto no fim da faixa ("Ok", "Reconectar"). */
  acao?: { texto: string; aoClicar: () => void } | undefined;
};

/** O que se sabe do arquivo que vai junto: nome, tipo MIME, tamanho e, no áudio, a duração. */
export type MidiaEnvio = {
  nome: string;
  mime: string;
  tamanho: number;
  duracaoS?: number | undefined;
};

/**
 * Uma mensagem nova, no formato do `enviarMensagem(conversaId, …)` da camada de dados: o anexo ou o
 * áudio gravado levam o arquivo de verdade em `arquivo` (o `NovaMensagemDados` da F1).
 */
export type NovaMensagem = {
  tipo: Enums<"mensagem_tipo">;
  texto?: string | undefined;
  midia?: MidiaEnvio | undefined;
  citaId?: string | undefined;
  arquivo?: Blob | undefined;
};

/** A ação recusada devolve `{ ok: false }` e o rascunho fica na caixa. */
export type ResultadoEnvio = void | { readonly ok: boolean };

/** A mensagem que está sendo respondida (o chip "Respondendo a…" em cima do campo). */
export type CitandoCaixa = { id: string; de: string; texto: string };

type Props = {
  conversaId: string;
  bloqueio?: BloqueioCaixa | null | undefined;
  faixa?: FaixaCaixa | null | undefined;
  /**
   * Chamado uma vez por mensagem, na ordem: o áudio gravado, cada anexo e, por último, o texto.
   * A citação vai na primeira delas que for texto (ou na primeira, se não houver texto). Quando a
   * ação devolve uma promessa (a camada de dados), a caixa espera cada uma antes da próxima e para
   * na primeira recusa: o que não saiu continua na caixa.
   */
  aoEnviar: (
    conversaId: string,
    mensagem: NovaMensagem,
  ) => ResultadoEnvio | PromiseLike<ResultadoEnvio>;
  /** O primeiro nome do lead: "Escreva para Ricardo". */
  destinatario?: string | undefined;
  /**
   * O texto da caixa vazia, quando a tela quer trocar o padrão ("Escreva para Ricardo"): por exemplo
   * "Escreva para Rafael · você assume ao enviar". Com o envio bloqueado, vale "Envio bloqueado".
   */
  dica?: string | undefined;
  citando?: CitandoCaixa | null | undefined;
  /** Tirar a citação (o X do chip, Esc no campo e depois de enviar). */
  aoTirarCitacao?: (() => void) | undefined;
  /** O link "Reconectar" da faixa de sem conexão. Sem ele, a faixa só explica. */
  aoReconectar?: (() => void) | undefined;
  /**
   * Uma orientação depois da frase do bloqueio, quando a faixa não tem ação: o atendente sem conexão
   * lê "… até reconectar. Peça a um admin para reconectar." em vez de ficar sem saída.
   */
  complementoBloqueio?: string | undefined;
  className?: string | undefined;
};

/** Na v1, o anexo é imagem ou documento: o Vídeo fica fora do clipe (decisão 5). */
type TipoAnexo = "imagem" | "documento";
type Anexo = MidiaEnvio & { id: number; tipo: TipoAnexo; arquivo: File; previa: string | null };

type Gravacao =
  | { modo: "pedindo"; segurando: boolean }
  | { modo: "gravando"; inicio: number; segurando: boolean }
  | { modo: "ouvir"; dur: number; tocando: boolean; base: number; inicioPlay: number };

/** O áudio gravado, pronto para ouvir e enviar. */
type AudioPronto = { blob: Blob; url: string | null; mime: string };

/** O gravador em andamento (MediaRecorder sobre o microfone). */
type Gravador = {
  rec: MediaRecorder;
  stream: MediaStream;
  partes: Blob[];
  formato: string;
  descartar: boolean;
};

/** O maior arquivo que vai: 20 MB, o limite da API oficial da Meta (o menor dos 4 gateways). */
export const MAX_BYTES_ANEXO = 20 * 1024 * 1024;

/** As imagens que o WhatsApp mostra como foto. Outra imagem, escolhida em Documento, vai como documento. */
const MIMES_FOTO: readonly string[] = ["image/jpeg", "image/png"];

/**
 * Os formatos da gravação, na ordem de preferência: o OGG com Opus (o do áudio do WhatsApp, que o
 * Firefox grava), o MP4 com AAC (o Chrome recente e o Safari) e, por último, o WebM com Opus. A API
 * oficial da Meta não aceita WebM, por isso ele fica só para o navegador que não grava os outros
 * (spec da ligação, 2.6). Sem nenhum, vale o padrão do navegador.
 */
export const FORMATOS_AUDIO: readonly string[] = [
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
];

/** O primeiro formato de `FORMATOS_AUDIO` que o navegador grava ("" = o padrão dele). */
export function escolherFormatoAudio(): string {
  const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== "function") return "";
  for (const f of FORMATOS_AUDIO) {
    try {
      if (MR.isTypeSupported(f)) return f;
    } catch {
      /* o navegador que recusa a pergunta fica com o padrão */
    }
  }
  return "";
}

/** Se o navegador grava áudio (MediaRecorder e acesso ao microfone). */
export function podeGravarAudio(): boolean {
  return (
    typeof (globalThis as { MediaRecorder?: unknown }).MediaRecorder === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** A extensão do arquivo gravado, pelo tipo MIME (sem os codecs). */
function extensaoAudio(mime: string): string {
  if (mime === "audio/ogg") return "ogg";
  if (mime === "audio/webm") return "webm";
  if (mime === "audio/mp4" || mime === "audio/x-m4a") return "m4a";
  return mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "audio";
}

function criarUrl(b: Blob): string | null {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(b) : null;
  } catch {
    return null;
  }
}

function soltarUrl(url: string | null | undefined) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* sem revogar: o navegador solta ao fechar a aba */
  }
}

function pararFaixas(stream: MediaStream | null | undefined) {
  try {
    for (const faixa of stream?.getTracks() ?? []) faixa.stop();
  } catch {
    /* faixa já parada */
  }
}

/** A promessa que a ação devolveu (a camada de dados), ou nada (a ação síncrona do exemplo). */
function ehPromessa(r: unknown): r is PromiseLike<ResultadoEnvio> {
  return !!r && typeof (r as { then?: unknown }).then === "function";
}

const EMOJIS: readonly (readonly [emoji: string, nome: string])[] = [
  ["😀", "sorriso"],
  ["😊", "sorriso tímido"],
  ["😉", "piscada"],
  ["🙂", "leve sorriso"],
  ["🤝", "aperto de mão"],
  ["👍", "joinha"],
  ["👏", "aplauso"],
  ["🙏", "obrigado"],
  ["✅", "certo"],
  ["📄", "documento"],
  ["📅", "calendário"],
  ["📍", "local"],
  ["💬", "conversa"],
  ["⏰", "despertador"],
  ["🎉", "festa"],
  ["❤️", "coração"],
];

/** Segurar o microfone menos que isto é um clique: a gravação continua até clicar de novo. */
const TOQUE_CURTO_MS = 350;
/** Arrastar para a esquerda mais que isto, segurando, cancela a gravação. */
const ARRASTO_CANCELA_PX = 100;
/** A gravação para sozinha aos 2 minutos e vai para o "ouvir antes de enviar". */
const GRAVACAO_MAX_MS = 120_000;

/* O rascunho de cada conversa fica guardado enquanto a aba está aberta: trocar de conversa e
   voltar não perde o que foi escrito (recarregar perde). O Sair esvazia (esquecerRascunhos): a
   próxima conta que entrar na mesma aba não vê o texto que a anterior deixou. */
const rascunhos = new Map<string, string>();

/** Esvazia os rascunhos de todas as conversas (o Sair chama, junto do queryClient.clear()). */
export function esquecerRascunhos(): void {
  rascunhos.clear();
}

/** O rascunho guardado de uma conversa ("" = nenhum). Para os testes e para quem precisar conferir. */
export function rascunhoGuardado(conversaId: string): string {
  return rascunhos.get(conversaId) ?? "";
}

const FAIXA_BLOQUEIO: Record<BloqueioCaixa, string> = {
  sem_conexao: "WhatsApp desconectado: nenhuma mensagem sai daqui até reconectar.",
  janela_fechada:
    "Janela de 24 h fechada: o lead não escreve há mais de 24 h. Pela API oficial da Meta, só dá para enviar um modelo aprovado.",
};

function IconeFaixa({ tom }: { tom: TomFaixa | BloqueioCaixa }) {
  const p = { size: 16, "aria-hidden": true } as const;
  switch (tom) {
    case "janete":
      return <JaneteSimbolo tamanho={16} decorativo />;
    case "pessoa":
      return <User {...p} />;
    case "celular":
      return <Smartphone {...p} />;
    case "espera":
      return <Clock {...p} />;
    case "falha":
      return <TriangleAlert {...p} />;
    case "sucesso":
      return <UserCheck {...p} />;
    case "sem_conexao":
      return <WifiOff {...p} />;
    case "janela_fechada":
      return <Lock {...p} />;
    default:
      return <Info {...p} />;
  }
}

/** Setas, Home e End andam entre os botões do menu aberto. Devolve se tratou a tecla. */
function andarNoMenu(e: KeyboardEvent<HTMLElement>, colunas = 1): boolean {
  const itens = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
  );
  if (!itens.length) return false;
  const i = itens.indexOf(document.activeElement as HTMLButtonElement);
  let j: number | null = null;
  if (e.key === "Home") j = 0;
  else if (e.key === "End") j = itens.length - 1;
  else if (e.key === "ArrowRight") j = (i + 1) % itens.length;
  else if (e.key === "ArrowLeft") j = i <= 0 ? itens.length - 1 : i - 1;
  else if (e.key === "ArrowDown") j = Math.min(itens.length - 1, i + colunas);
  else if (e.key === "ArrowUp") j = Math.max(0, i - colunas);
  if (j == null) return false;
  e.preventDefault();
  e.stopPropagation();
  itens[j]?.focus();
  return true;
}

/**
 * A caixa de escrever do Chat final (desenho da opção A): a faixa leve em cima, que diz quem atende
 * e o que acontece ao enviar (ou por que o envio está bloqueado); o campo de várias linhas (Enter
 * envia, Shift+Enter quebra a linha); anexar imagem ou documento (o arquivo de verdade), emoji e
 * gravar áudio pelo microfone (com "ouvir antes de enviar"); e a citação da mensagem que está sendo
 * respondida (o Responder da bolha preenche).
 */
export function CaixaEscrever({
  conversaId,
  bloqueio,
  faixa,
  aoEnviar,
  destinatario,
  dica,
  citando,
  aoTirarCitacao,
  aoReconectar,
  complementoBloqueio,
  className,
}: Props) {
  const [rascunho, setRascunhoEstado] = useState(() => rascunhos.get(conversaId) ?? "");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [grav, setGrav] = useState<Gravacao | null>(null);
  const [audioPronto, setAudioPronto] = useState<AudioPronto | null>(null);
  const [menu, setMenu] = useState<"anexo" | "emoji" | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [arrasto, setArrasto] = useState(0);
  const [anuncio, setAnuncio] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  /* Pedido de foco depois do próximo render (o campo some e volta ao gravar). */
  const [foco, setFoco] = useState<{
    alvo: "campo" | "anexo" | "emoji" | "ouvir";
    n: number;
  } | null>(null);

  const campo = useRef<HTMLTextAreaElement>(null);
  const botaoAnexo = useRef<HTMLButtonElement>(null);
  const botaoEmoji = useRef<HTMLButtonElement>(null);
  const botaoOuvir = useRef<HTMLButtonElement>(null);
  const ancoraAnexo = useRef<HTMLDivElement>(null);
  const ancoraEmoji = useRef<HTMLDivElement>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const tipoEscolhido = useRef<TipoAnexo>("documento");
  const audioOuvir = useRef<HTMLAudioElement>(null);
  const toque = useRef<{ x: number; t: number } | null>(null);
  const ignorarCliqueAte = useRef(0);
  const proximoId = useRef(1);
  const conversaAnterior = useRef(conversaId);
  const gravador = useRef<Gravador | null>(null);
  const pedidoMic = useRef(0);
  const enviandoRef = useRef(false);
  const rascunhoRef = useRef(rascunho);
  const anexosRef = useRef(anexos);
  const audioProntoRef = useRef(audioPronto);
  const montado = useRef(true);
  anexosRef.current = anexos;
  audioProntoRef.current = audioPronto;

  const idCampo = useId();
  const idFaixa = useId();
  const idCita = useId();
  const idDica = useId();
  const bloqueado = !!bloqueio;
  const pedindo = grav?.modo === "pedindo" ? grav : null;
  const gravando = grav?.modo === "gravando" ? grav : null;
  const ouvindo = grav?.modo === "ouvir" ? grav : null;

  const focar = useCallback((alvo: "campo" | "anexo" | "emoji" | "ouvir") => {
    setFoco((f) => ({ alvo, n: (f?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!foco) return;
    const el = { campo, anexo: botaoAnexo, emoji: botaoEmoji, ouvir: botaoOuvir }[foco.alvo]
      .current;
    el?.focus();
  }, [foco]);

  const setRascunho = useCallback(
    (texto: string) => {
      rascunhoRef.current = texto;
      setRascunhoEstado(texto);
      if (texto) rascunhos.set(conversaId, texto);
      else rascunhos.delete(conversaId);
    },
    [conversaId],
  );

  function avisar(texto: string) {
    setAviso(texto);
    setAnuncio(texto);
  }

  /* Para o microfone e solta o áudio gravado (trocar de conversa, bloquear, sair da tela). */
  const encerrarGravacao = useCallback(() => {
    pedidoMic.current++;
    const g = gravador.current;
    gravador.current = null;
    if (g) {
      g.descartar = true;
      try {
        if (g.rec.state !== "inactive") g.rec.stop();
      } catch {
        /* já parado */
      }
      pararFaixas(g.stream);
    }
    soltarUrl(audioProntoRef.current?.url);
    audioProntoRef.current = null;
    setAudioPronto(null);
  }, []);

  const soltarAnexos = useCallback((lista: readonly Anexo[]) => {
    for (const a of lista) soltarUrl(a.previa);
  }, []);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      encerrarGravacao();
      soltarAnexos(anexosRef.current);
    };
  }, [encerrarGravacao, soltarAnexos]);

  /* Outra conversa: o rascunho dela volta; anexos, gravação e menus ficam para trás. O envio que
     estava em andamento continua (as mensagens já foram pedidas), mas a caixa nova já escreve. */
  useEffect(() => {
    if (conversaAnterior.current === conversaId) return;
    conversaAnterior.current = conversaId;
    const texto = rascunhos.get(conversaId) ?? "";
    rascunhoRef.current = texto;
    setRascunhoEstado(texto);
    soltarAnexos(anexosRef.current);
    setAnexos([]);
    encerrarGravacao();
    setGrav(null);
    setMenu(null);
    setAviso(null);
    enviandoRef.current = false;
    setEnviando(false);
  }, [conversaId, encerrarGravacao, soltarAnexos]);

  /* "Responder" numa mensagem: o foco vem para o campo, pronto para escrever a resposta. */
  useEffect(() => {
    if (citando?.id && !bloqueado) focar("campo");
    // Só a chegada de uma citação nova move o foco (não o desbloqueio nem outra mudança).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citando?.id]);

  /* O envio ficou bloqueado no meio do caminho: a gravação e os menus fecham. */
  useEffect(() => {
    if (!bloqueado) return;
    encerrarGravacao();
    setGrav(null);
    setMenu(null);
  }, [bloqueado, encerrarGravacao]);

  /* O relógio da gravação e do "ouvir antes de enviar". Aos 2 minutos, a gravação para sozinha
     (pelo ref, para chamar a versão atual de `pararGravacao`). */
  const pararGravacaoRef = useRef<() => void>(() => {});
  useEffect(() => {
    pararGravacaoRef.current = pararGravacao;
  });
  useEffect(() => {
    if (!gravando && !ouvindo?.tocando) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setAgora(t);
      if (gravando && t - gravando.inicio >= GRAVACAO_MAX_MS) pararGravacaoRef.current();
    }, 200);
    return () => window.clearInterval(id);
  }, [gravando, ouvindo?.tocando]);

  const progressoOuvir = ouvindo
    ? Math.min(
        1,
        (ouvindo.base + (ouvindo.tocando ? agora - ouvindo.inicioPlay : 0)) / (ouvindo.dur * 1000),
      )
    : 0;

  /* A prévia chegou ao fim: para e volta ao começo. */
  useEffect(() => {
    if (ouvindo?.tocando && progressoOuvir >= 1) {
      const el = audioOuvir.current;
      if (el) {
        try {
          el.pause();
          el.currentTime = 0;
        } catch {
          /* sem áudio de verdade (o navegador não toca) */
        }
      }
      setGrav({ ...ouvindo, tocando: false, base: 0, inicioPlay: 0 });
    }
  }, [ouvindo, progressoOuvir]);

  /* Clicar fora do menu aberto fecha (sem roubar o foco de onde a pessoa clicou). */
  useEffect(() => {
    if (!menu) return;
    const ancora = menu === "anexo" ? ancoraAnexo : ancoraEmoji;
    function fora(e: globalThis.PointerEvent) {
      const alvo = e.target as Node | null;
      if (alvo && ancora.current?.contains(alvo)) return;
      setMenu(null);
    }
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [menu]);

  function fecharMenu(devolverFoco: boolean) {
    const qual = menu;
    setMenu(null);
    if (devolverFoco && qual) focar(qual);
  }

  function teclaMenu(e: KeyboardEvent<HTMLElement>, colunas = 1) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      fecharMenu(true);
      return;
    }
    if (e.key === "Tab") {
      setMenu(null);
      return;
    }
    andarNoMenu(e, colunas);
  }

  function abrirMenu(qual: "anexo" | "emoji") {
    const abre = menu !== qual;
    setMenu(abre ? qual : null);
    if (abre) {
      // O foco vai ao primeiro item depois que o menu aparece.
      window.setTimeout(() => {
        const ancora = qual === "anexo" ? ancoraAnexo : ancoraEmoji;
        ancora.current?.querySelector<HTMLButtonElement>("[data-item]")?.focus();
      }, 0);
    }
  }

  /* ---------- anexos (o arquivo de verdade, pelo seletor do navegador) ---------- */

  function escolherArquivo(tipo: TipoAnexo) {
    tipoEscolhido.current = tipo;
    setMenu(null);
    const el = inputArquivo.current;
    if (!el) return;
    el.accept = tipo === "imagem" ? MIMES_FOTO.join(",") : "";
    el.click();
  }

  function arquivosEscolhidos(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.currentTarget.files ?? []);
    // Limpa o seletor: escolher o mesmo arquivo de novo dispara outra vez.
    e.currentTarget.value = "";
    if (!arquivos.length || bloqueado) return;
    const pedido = tipoEscolhido.current;
    const novos: Anexo[] = [];
    const recusados: string[] = [];
    for (const f of arquivos) {
      if (f.size === 0) {
        recusados.push(`${f.name} está vazio`);
        continue;
      }
      if (f.size > MAX_BYTES_ANEXO) {
        recusados.push(`${f.name} tem ${tamanhoArquivo(f.size)}, e o limite do WhatsApp é 20 MB`);
        continue;
      }
      const mime = f.type || "application/octet-stream";
      const tipo: TipoAnexo =
        pedido === "imagem" && MIMES_FOTO.includes(mime) ? "imagem" : "documento";
      novos.push({
        id: proximoId.current++,
        tipo,
        nome: f.name,
        mime,
        tamanho: f.size,
        arquivo: f,
        previa: tipo === "imagem" ? criarUrl(f) : null,
      });
    }
    if (novos.length) setAnexos((lista) => [...lista, ...novos]);
    if (recusados.length) {
      avisar(`Não deu para anexar: ${recusados.join("; ")}.`);
    } else {
      setAviso(null);
      setAnuncio(
        novos.length === 1
          ? `Anexo ${novos[0]!.nome} pronto para enviar.`
          : `${novos.length} anexos prontos para enviar.`,
      );
    }
    focar("campo");
  }

  function tirarAnexo(id: number) {
    const tirado = anexos.find((a) => a.id === id);
    if (tirado) soltarUrl(tirado.previa);
    setAnexos((lista) => lista.filter((a) => a.id !== id));
    if (tirado) setAnuncio(`Anexo ${tirado.nome} tirado.`);
    focar("campo");
  }

  function inserirEmoji(emoji: string) {
    const el = campo.current;
    const ini = el?.selectionStart ?? rascunho.length;
    const fim = el?.selectionEnd ?? rascunho.length;
    const novo = rascunho.slice(0, ini) + emoji + rascunho.slice(fim);
    setRascunho(novo);
    setMenu(null);
    focar("campo");
    // O cursor fica logo depois do emoji.
    window.setTimeout(() => {
      const pos = ini + emoji.length;
      campo.current?.setSelectionRange(pos, pos);
    }, 0);
  }

  /* ---------- enviar: uma mensagem por vez, esperando cada uma ---------- */

  function enviar() {
    if (bloqueado || gravando || pedindo || enviandoRef.current) return;
    // O áudio ainda está virando arquivo (o gravador acabou de parar): espera.
    if (ouvindo && !audioPronto) return;
    const texto = rascunho.trim();
    /* Cada mensagem guarda de onde veio (o áudio, um anexo pelo id ou o texto), para o que não
       sair continuar na caixa. */
    const fila: { m: NovaMensagem; de: "audio" | "texto" | number }[] = [];
    if (ouvindo && audioPronto) {
      fila.push({
        m: {
          tipo: "audio",
          midia: {
            nome: `audio-gravado.${extensaoAudio(audioPronto.mime)}`,
            mime: audioPronto.mime,
            tamanho: audioPronto.blob.size,
            duracaoS: ouvindo.dur,
          },
          arquivo: audioPronto.blob,
        },
        de: "audio",
      });
    }
    for (const a of anexos) {
      fila.push({
        m: {
          tipo: a.tipo,
          midia: { nome: a.nome, mime: a.mime, tamanho: a.tamanho },
          arquivo: a.arquivo,
        },
        de: a.id,
      });
    }
    if (texto) fila.push({ m: { tipo: "texto", texto }, de: "texto" });
    if (!fila.length) return;

    let iCita = -1;
    if (citando) {
      iCita = fila.findIndex((f) => f.m.tipo === "texto");
      if (iCita < 0) iCita = 0;
      fila[iCita]!.m.citaId = citando.id;
    }

    const conv = conversaId;
    const rascunhoEnviado = rascunho;
    const audioEnviado = audioPronto;
    const citou = !!citando;

    const terminar = (enviadas: number) => {
      const sobra = fila.slice(enviadas);
      const foiTexto = !sobra.some((f) => f.de === "texto");
      /* A pessoa trocou de conversa no meio: só o rascunho guardado da antiga sai, se não mudou. */
      if (conversaAnterior.current !== conv || !montado.current) {
        if (foiTexto && rascunhos.get(conv) === rascunhoEnviado) rascunhos.delete(conv);
        return;
      }
      enviandoRef.current = false;
      setEnviando(false);
      if (!enviadas) {
        setAnuncio("A mensagem não foi enviada. O rascunho continua na caixa.");
        return;
      }
      /* Recusa no meio: o que saiu sai da caixa; o resto (texto, anexos, áudio) fica para tentar de
         novo. O texto só sai se a pessoa não escreveu outra coisa enquanto esperava. */
      if (foiTexto && rascunhoRef.current === rascunhoEnviado) setRascunho("");
      const saiu = new Set(fila.slice(0, enviadas).map((f) => f.de));
      setAnexos((lista) => {
        soltarAnexos(lista.filter((a) => saiu.has(a.id)));
        return lista.filter((a) => !saiu.has(a.id));
      });
      if (saiu.has("audio") && audioEnviado) {
        soltarUrl(audioEnviado.url);
        if (audioProntoRef.current === audioEnviado) {
          audioProntoRef.current = null;
          setAudioPronto(null);
          setGrav((g) => (g?.modo === "ouvir" ? null : g));
        }
      }
      setMenu(null);
      setAviso(null);
      if (citou && iCita < enviadas) aoTirarCitacao?.();
      setAnuncio(
        sobra.length
          ? `${enviadas} de ${fila.length} mensagens enviadas. O resto continua na caixa.`
          : enviadas > 1
            ? `${enviadas} mensagens enviadas.`
            : "Mensagem enviada.",
      );
      focar("campo");
    };

    /* A ação síncrona (o exemplo) anda direto; a que devolve promessa é esperada antes da próxima. */
    const seguir = (i: number): void => {
      for (; i < fila.length; i++) {
        let r: ResultadoEnvio | PromiseLike<ResultadoEnvio>;
        try {
          r = aoEnviar(conv, fila[i]!.m);
        } catch {
          terminar(i);
          return;
        }
        if (ehPromessa(r)) {
          if (!enviandoRef.current) {
            enviandoRef.current = true;
            setEnviando(true);
          }
          const atual = i;
          r.then(
            (res) => (res && res.ok === false ? terminar(atual) : seguir(atual + 1)),
            () => terminar(atual),
          );
          return;
        }
        if (r && r.ok === false) {
          terminar(i);
          return;
        }
      }
      terminar(fila.length);
    };
    seguir(0);
  }

  function teclaCampo(e: KeyboardEvent<HTMLTextAreaElement>) {
    // No Safari, o Enter que confirma um acento ou uma sugestão chega com isComposing falso e keyCode 229.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      e.nativeEvent.keyCode !== 229
    ) {
      e.preventDefault();
      enviar();
      return;
    }
    if (e.key === "Escape") {
      if (menu) {
        e.preventDefault();
        setMenu(null);
      } else if (citando && aoTirarCitacao) {
        e.preventDefault();
        aoTirarCitacao();
      }
    }
  }

  /* ---------- gravação de áudio (MediaRecorder sobre o microfone) ---------- */

  function iniciarGravacao(segurando: boolean): boolean {
    if (!podeGravarAudio()) {
      avisar(
        "Este navegador não grava áudio. Dá para mandar um arquivo de áudio pelo clipe, em Documento.",
      );
      return false;
    }
    setAviso(null);
    soltarUrl(audioProntoRef.current?.url);
    audioProntoRef.current = null;
    setAudioPronto(null);
    const pedido = ++pedidoMic.current;
    setGrav({ modo: "pedindo", segurando });
    setArrasto(0);
    setMenu(null);
    setAnuncio("Pedindo o microfone.");

    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (stream) => {
        if (pedido !== pedidoMic.current || !montado.current) {
          pararFaixas(stream);
          return;
        }
        const formato = escolherFormatoAudio();
        let rec: MediaRecorder;
        try {
          rec = formato
            ? new MediaRecorder(stream, { mimeType: formato })
            : new MediaRecorder(stream);
        } catch {
          pararFaixas(stream);
          setGrav(null);
          avisar("Não deu para gravar áudio neste navegador.");
          return;
        }
        const g: Gravador = { rec, stream, partes: [], formato, descartar: false };
        gravador.current = g;
        rec.ondataavailable = (ev: BlobEvent) => {
          if (ev.data && ev.data.size > 0) g.partes.push(ev.data);
        };
        rec.onstop = () => {
          pararFaixas(g.stream);
          if (gravador.current === g) gravador.current = null;
          if (g.descartar || !montado.current) return;
          const tipo = rec.mimeType || g.formato || "audio/webm";
          const blob = new Blob(g.partes, { type: tipo });
          if (blob.size === 0) {
            setGrav((atual) => (atual?.modo === "ouvir" ? null : atual));
            avisar("A gravação ficou vazia. Tente gravar de novo.");
            return;
          }
          const pronto: AudioPronto = {
            blob,
            url: criarUrl(blob),
            mime: tipo.split(";")[0]!.trim(),
          };
          audioProntoRef.current = pronto;
          setAudioPronto(pronto);
        };
        try {
          rec.start();
        } catch {
          pararFaixas(stream);
          gravador.current = null;
          setGrav(null);
          avisar("Não deu para gravar áudio neste navegador.");
          return;
        }
        const t = Date.now();
        setGrav((atual) => ({
          modo: "gravando",
          inicio: t,
          segurando: atual?.modo === "pedindo" ? atual.segurando : false,
        }));
        setAgora(t);
        setAnuncio("Gravando áudio.");
      },
      (erro: unknown) => {
        if (pedido !== pedidoMic.current || !montado.current) return;
        setGrav(null);
        const nome = (erro as { name?: string } | null)?.name;
        avisar(
          nome === "NotAllowedError" || nome === "SecurityError"
            ? "O navegador não deixou usar o microfone. Libere o microfone para este site e tente de novo."
            : nome === "NotFoundError"
              ? "Nenhum microfone encontrado neste aparelho."
              : "Não deu para usar o microfone.",
        );
        focar("campo");
      },
    );
    return true;
  }

  function pararGravacao() {
    if (!gravando) return;
    const dur = Math.max(1, Math.round((Date.now() - gravando.inicio) / 1000));
    const g = gravador.current;
    if (g) {
      try {
        if (g.rec.state !== "inactive") g.rec.stop();
      } catch {
        /* já parado */
      }
    }
    setGrav({ modo: "ouvir", dur, tocando: false, base: 0, inicioPlay: 0 });
    setArrasto(0);
    setAnuncio("Gravação pronta. Ouça antes de enviar.");
    focar("ouvir");
  }

  function cancelarGravacao() {
    encerrarGravacao();
    setGrav(null);
    setArrasto(0);
    setAnuncio("Gravação cancelada.");
    focar("campo");
  }

  function descartarGravacao() {
    encerrarGravacao();
    setGrav(null);
    setAnuncio("Gravação descartada.");
    focar("campo");
  }

  function alternarOuvir() {
    if (!ouvindo) return;
    const t = Date.now();
    setAgora(t);
    const el = audioOuvir.current;
    if (ouvindo.tocando) {
      try {
        el?.pause();
      } catch {
        /* sem áudio de verdade */
      }
      setGrav({ ...ouvindo, tocando: false, base: ouvindo.base + (t - ouvindo.inicioPlay) });
    } else {
      if (el) {
        try {
          el.currentTime = ouvindo.base / 1000;
          const p = el.play() as Promise<void> | undefined;
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch {
          /* o navegador não toca: o tempo anda assim mesmo */
        }
      }
      setGrav({ ...ouvindo, tocando: true, inicioPlay: t });
    }
  }

  /* Segurar e soltar grava como no WhatsApp; um clique curto grava até clicar de novo. */
  function micAbaixa(e: PointerEvent<HTMLButtonElement>) {
    if (bloqueado || grav) {
      toque.current = null;
      return;
    }
    toque.current = { x: e.clientX, t: Date.now() };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* sem captura: o arrasto só vale dentro do botão */
    }
    if (!iniciarGravacao(true)) toque.current = null;
  }

  function micMove(e: PointerEvent<HTMLButtonElement>) {
    if (!toque.current || !gravando?.segurando) return;
    const dx = Math.min(0, e.clientX - toque.current.x);
    if (dx < -ARRASTO_CANCELA_PX) {
      toque.current = null;
      ignorarCliqueAte.current = Date.now() + 700;
      cancelarGravacao();
      return;
    }
    if (Math.abs(dx - arrasto) > 4) setArrasto(dx);
  }

  function micSobe() {
    if (!toque.current) return;
    const segurou = Date.now() - toque.current.t;
    toque.current = null;
    ignorarCliqueAte.current = Date.now() + 700;
    /* Soltou enquanto o navegador pedia o microfone: segue gravando até clicar de novo. */
    if (pedindo) {
      setGrav({ ...pedindo, segurando: false });
      return;
    }
    if (!gravando) return;
    if (segurou < TOQUE_CURTO_MS) {
      setGrav({ ...gravando, segurando: false });
      setArrasto(0);
    } else pararGravacao();
  }

  function micClique() {
    if (Date.now() < ignorarCliqueAte.current) return;
    // Enquanto o navegador pede o microfone, o clique não faz nada (o Cancelar desiste).
    if (!grav) iniciarGravacao(false);
    else if (gravando) pararGravacao();
  }

  /* ---------- render ---------- */

  const acaoBloqueio =
    bloqueio === "sem_conexao" && aoReconectar
      ? { texto: "Reconectar", aoClicar: aoReconectar }
      : undefined;
  const complemento = !acaoBloqueio ? complementoBloqueio?.trim() : undefined;
  const faixaFinal: {
    tom: TomFaixa | BloqueioCaixa;
    texto: string;
    acao?: FaixaCaixa["acao"];
  } | null = bloqueio
    ? {
        tom: bloqueio,
        texto: complemento
          ? `${FAIXA_BLOQUEIO[bloqueio]} ${complemento}`
          : FAIXA_BLOQUEIO[bloqueio],
        acao: acaoBloqueio,
      }
    : faixa
      ? { tom: faixa.tom ?? "neutro", texto: faixa.texto, acao: faixa.acao }
      : null;
  /* A dica vale quando não há faixa nem bloqueio (com eles, a faixa é que explica o envio). */
  const comDica = !!dica?.trim() && !bloqueado && !faixaFinal;

  const vazio = !rascunho.trim() && !anexos.length;
  const linhas = Math.min(6, Math.max(1, rascunho.split("\n").length));
  const tempoGravando = gravando ? mmss((agora - gravando.inicio) / 1000) : "0:00";

  return (
    <div className={cx(s.ceRaiz, className)} data-bloqueio={bloqueio ?? undefined}>
      {faixaFinal && (
        <div className={s.ceFaixa} data-tom={faixaFinal.tom}>
          {/* O ícone vai dentro da frase: no computador anda junto com a 1ª linha quando ela quebra
              (como item do flex, ficava sozinho na ponta). Só a frase descreve o campo (o link da
              faixa é outro controle). */}
          <span className={s.ceFaixaTxt}>
            <span className={s.ceFaixaIc}>
              <IconeFaixa tom={faixaFinal.tom} />
            </span>
            <span id={idFaixa}>{faixaFinal.texto}</span>
          </span>
          {faixaFinal.acao && (
            <button type="button" className={s.ceFaixaAcao} onClick={faixaFinal.acao.aoClicar}>
              {faixaFinal.acao.texto}
            </button>
          )}
        </div>
      )}

      <div
        className={s.ceCaixa}
        data-estado={bloqueado ? "bloqueado" : gravando ? "gravando" : undefined}
        data-com-faixa={faixaFinal ? "" : undefined}
        aria-busy={enviando || undefined}
      >
        {aviso && !bloqueado && (
          <p className={s.ceAviso}>
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{aviso}</span>
            <button
              type="button"
              className={s.ceIconeX}
              aria-label="Fechar o aviso"
              onClick={() => setAviso(null)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </p>
        )}

        {citando && !bloqueado && (
          <div className={s.ceCita}>
            <Reply size={18} aria-hidden="true" />
            <span id={idCita} className={s.ceCitaTxt}>
              <b>Respondendo a {citando.de}</b>
              <span>{citando.texto}</span>
            </span>
            {aoTirarCitacao && (
              <button
                type="button"
                className={s.ceIconeX}
                aria-label="Não responder citando"
                onClick={() => {
                  aoTirarCitacao();
                  focar("campo");
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {anexos.length > 0 && !bloqueado && (
          <ul className={s.ceAnexos} aria-label="Anexos para enviar">
            {anexos.map((a) => (
              <li key={a.id} className={s.ceAnexo}>
                <span
                  className={s.ceAnexoMini}
                  data-tipo={a.tipo}
                  data-sem-previa={a.tipo === "imagem" && !a.previa ? "" : undefined}
                  aria-hidden="true"
                >
                  {a.tipo === "imagem" &&
                    (a.previa ? <img src={a.previa} alt="" /> : <IconeImagem size={22} />)}
                  {a.tipo === "documento" && <FileText size={20} />}
                </span>
                <span className={s.ceAnexoTxt}>
                  <b title={a.nome}>{a.nome}</b>
                  <span>
                    {[extensaoArquivo(a.nome, a.mime), tamanhoArquivo(a.tamanho)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <button
                  type="button"
                  className={s.ceIconeX}
                  aria-label={`Tirar o anexo ${a.nome}`}
                  disabled={enviando}
                  onClick={() => tirarAnexo(a.id)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!grav && (
          <>
            <label htmlFor={idCampo} className={s.sr}>
              {`Mensagem${destinatario ? ` para ${destinatario}` : ""}. Enter envia; Shift e Enter quebram a linha.`}
            </label>
            {/* A dica ("você assume ao enviar") só está no placeholder, que nem todo leitor de tela
                lê e que some na 1ª letra: vai também na descrição do campo. */}
            {comDica && (
              <span id={idDica} className={s.sr}>
                {dica}
              </span>
            )}
            <textarea
              ref={campo}
              id={idCampo}
              className={s.ceCampo}
              rows={linhas}
              value={rascunho}
              placeholder={
                bloqueado
                  ? "Envio bloqueado"
                  : dica?.trim()
                    ? dica
                    : destinatario
                      ? `Escreva para ${destinatario}`
                      : "Escreva uma mensagem"
              }
              disabled={bloqueado}
              aria-describedby={
                [
                  faixaFinal ? idFaixa : null,
                  comDica ? idDica : null,
                  citando && !bloqueado ? idCita : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={teclaCampo}
            />
          </>
        )}

        {pedindo && (
          <div className={s.ceGrav} role="status" aria-label="Pedindo o microfone">
            <span className={s.ceGravPonto} aria-hidden="true" />
            <span className={s.ceGravDica}>Liberando o microfone…</span>
          </div>
        )}

        {gravando && (
          <div className={s.ceGrav} role="status" aria-label={`Gravando áudio, ${tempoGravando}`}>
            <span className={s.ceGravPonto} aria-hidden="true" />
            <span className={s.ceGravTempo} aria-hidden="true">
              {tempoGravando}
            </span>
            <span className={s.ceGravOndas} aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            <span className={s.ceGravDica} style={{ transform: `translateX(${arrasto}px)` }}>
              {gravando.segurando
                ? "‹ Deslize para cancelar"
                : "Clique no botão vermelho para parar"}
            </span>
          </div>
        )}

        {ouvindo && (
          <div className={s.ceGrav}>
            {audioPronto?.url && (
              <audio ref={audioOuvir} src={audioPronto.url} preload="auto" hidden />
            )}
            <div className={s.cePlayer}>
              <button
                ref={botaoOuvir}
                type="button"
                className={s.cePlay}
                aria-label={ouvindo.tocando ? "Pausar" : "Ouvir a gravação antes de enviar"}
                onClick={alternarOuvir}
              >
                {ouvindo.tocando ? (
                  <Pause size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                ) : (
                  <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                )}
              </button>
              <Onda progresso={progressoOuvir} />
              <span className={s.ceTempo}>
                {mmss(progressoOuvir * ouvindo.dur)} / {mmss(ouvindo.dur)}
              </span>
            </div>
          </div>
        )}

        {/* O seletor de arquivos do navegador: o menu do clipe abre, com o filtro de Imagem ou Documento. */}
        <input
          ref={inputArquivo}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          aria-hidden="true"
          data-arquivo=""
          onChange={arquivosEscolhidos}
        />

        <div className={s.cePe}>
          {!grav && (
            <>
              <div ref={ancoraAnexo} className={s.ceAncora}>
                <button
                  ref={botaoAnexo}
                  type="button"
                  className={s.ceFerr}
                  aria-label="Anexar imagem ou documento"
                  aria-haspopup="menu"
                  aria-expanded={menu === "anexo"}
                  disabled={bloqueado || enviando}
                  onClick={() => abrirMenu("anexo")}
                >
                  <Paperclip size={20} aria-hidden="true" />
                </button>
                {menu === "anexo" && (
                  <div
                    className={s.cePop}
                    role="menu"
                    aria-label="Anexar"
                    onKeyDown={(e) => teclaMenu(e)}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-item=""
                      className={s.cePopItem}
                      onClick={() => escolherArquivo("imagem")}
                    >
                      <IconeImagem size={18} aria-hidden="true" />
                      <span>Imagem</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-item=""
                      className={s.cePopItem}
                      onClick={() => escolherArquivo("documento")}
                    >
                      <FileText size={18} aria-hidden="true" />
                      <span>Documento</span>
                    </button>
                  </div>
                )}
              </div>
              <div ref={ancoraEmoji} className={s.ceAncora}>
                <button
                  ref={botaoEmoji}
                  type="button"
                  className={s.ceFerr}
                  aria-label="Inserir emoji"
                  aria-expanded={menu === "emoji"}
                  disabled={bloqueado}
                  onClick={() => abrirMenu("emoji")}
                >
                  <Smile size={20} aria-hidden="true" />
                </button>
                {menu === "emoji" && (
                  <div
                    className={s.cePop}
                    data-emoji=""
                    role="group"
                    aria-label="Emojis"
                    onKeyDown={(e) => teclaMenu(e, 6)}
                  >
                    <div className={s.ceEmojis}>
                      {EMOJIS.map(([emoji, nome]) => (
                        <button
                          key={emoji}
                          type="button"
                          data-item=""
                          aria-label={`Inserir ${nome}`}
                          onClick={() => inserirEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {((gravando && !gravando.segurando) || (pedindo && !pedindo.segurando)) && (
            <button type="button" className={s.ceBotaoTexto} onClick={cancelarGravacao}>
              <Trash2 size={18} aria-hidden="true" />
              <span>Cancelar</span>
            </button>
          )}
          {ouvindo && (
            <button type="button" className={s.ceBotaoTexto} onClick={descartarGravacao}>
              <Trash2 size={18} aria-hidden="true" />
              <span>Descartar</span>
            </button>
          )}

          <div className={s.cePeDir}>
            {(!grav || gravando || pedindo) && (
              <button
                type="button"
                className={cx(s.ceFerr, s.ceMic)}
                data-gravando={gravando || pedindo ? "" : undefined}
                aria-label={
                  pedindo
                    ? "Pedindo o microfone"
                    : gravando
                      ? "Parar a gravação e ouvir"
                      : "Gravar áudio: segure e solte, ou clique para gravar"
                }
                disabled={bloqueado || enviando}
                onPointerDown={micAbaixa}
                onPointerMove={micMove}
                onPointerUp={micSobe}
                onPointerCancel={micSobe}
                onClick={micClique}
              >
                {gravando || pedindo ? (
                  <Square size={18} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                ) : (
                  <Mic size={20} aria-hidden="true" />
                )}
              </button>
            )}
            {(!grav || ouvindo) && (
              <button
                type="button"
                className={s.ceEnviar}
                aria-label={ouvindo ? "Enviar o áudio" : "Enviar mensagem"}
                disabled={bloqueado || enviando || (ouvindo ? !audioPronto : vazio)}
                onClick={enviar}
              >
                <ArrowUp size={20} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className={s.sr} role="status" aria-live="polite">
        {anuncio}
      </p>
    </div>
  );
}
