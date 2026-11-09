import { useEffect, useRef, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Camera,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  FileText,
  Mic,
  Sticker,
  Undo2,
  Video,
} from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { iniciais } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { AvatarLead, type SeloLead } from "../comum/AvatarLead";
import { MOTIVO_LONGO, nomeDoContato, resumoMensagem } from "../comum/LinhaConversa";
import { esperaCompacta, esperaLonga, horaLista, segundosDesde, tempoRelativo } from "../comum/tempo";
import { frioNoQuadro, janeteAtivaNoQuadro, type LinhaQuadro } from "../dados/kanban";
import { seloDaConversa } from "../exemplo/regras";
import type { Etapa, Membro, StatusMensagem, TipoMensagem } from "../exemplo/tipos";
import estilos from "./Card.module.css";

const s = estilos as Classes<
  | "kcCard"
  | "kcAbrir"
  | "kcAv"
  | "kcTxt"
  | "kcL1"
  | "kcNome"
  | "kcHora"
  | "kcSelo"
  | "kcL2"
  | "kcPrev"
  | "kcPrevTexto"
  | "kcIcone"
  | "kcNl"
  | "kcMover"
  | "kcMenu"
  | "kcMenuTitulo"
  | "kcMenuOpcao"
  | "kcMenuCor"
  | "kcDesfazer"
  | "kcDecisao"
  | "kcDecTitulo"
  | "kcDecNome"
  | "kcDecSeta"
  | "kcDecEtapa"
  | "kcDecMotivo"
  | "kcDecVeto"
  | "kcDecBarra"
  | "kcVooJanete"
  | "kcSr"
>;

// O card do Kanban 2 (rodada 2, a menos poluída): uma linha de conversa da mesma família da lista do
// Chat (LinhaConversa), em duas linhas. Linha 1: o nome e a hora (ou, esperando a equipe, o tempo de
// espera em âmbar; em falha, no tom de erro). Linha 2: a prévia de uma linha com os vistos e as não
// lidas. A situação mora no próprio avatar: o selo de quem atende, o anel azul de "ativa agora" e o
// cinza de "esfriando". O botão "Mover para…" só aparece no hover ou no foco (no toque, fica numa
// coluna própria), para não cortar o nome; o selo do avatar nunca cobre as iniciais (AvatarLead).

/* ---------- os dados de um card ---------- */

export interface DadosCard {
  contatoId: string;
  conversaId: string;
  etapaId: string;
  nome: string;
  empresa: string | null;
  selo: SeloLead;
  /** Selo "membro": as iniciais de quem atende. */
  iniciaisMembro: string | null;
  /** "14:32", "Ontem", "Seg."; vazio sem mensagem. */
  hora: string;
  /** Esperando a equipe: os segundos de espera (o selo âmbar, ou vermelho em falha). */
  esperaS: number | null;
  falha: boolean;
  previa: string;
  tomPrevia: "digita" | "falhou" | null;
  /** A situação de envio da última mensagem nossa (os vistos). */
  statusUltima: StatusMensagem | null;
  /** O tipo da última mensagem, quando não é texto (o ícone antes da prévia). */
  tipoUltima: TipoMensagem | "apagada" | null;
  naoLidas: number;
  /** A Janete trocou mensagem nos últimos 5 min ou está digitando: o anel azul. */
  ativo: boolean;
  digitando: boolean;
  /** 0 = não esfriou; 1 a 3 a cada 24 h sem o lead responder. */
  frio: number;
  /** A situação por extenso (leitor de tela e a etapa em chat). */
  situacao: string;
}

/** O nome curto de quem atende ("Você", "Marina"). */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** O que o card precisa além da linha do quadro: as etapas, a equipe, quem olha e onde a Janete trabalha agora. */
export interface ContextoCard {
  etapas: readonly Etapa[];
  membros: readonly Pick<Membro, "id" | "nome">[];
  euId: string;
  /** As conversas em que a Janete está trabalhando agora (as rodadas rodando; no exemplo, "digitando"). */
  trabalhando: readonly string[];
}

/**
 * Monta o card de uma linha do quadro (dados/kanban.ts). Pura: recebe o contexto e o relógio.
 * Ganho e Perdido não ficam "ativos" nem esfriam (as regras de `exemplo/regras.ts`).
 */
export function montarCard(ctx: ContextoCard, linha: LinhaQuadro, agora: number): DadosCard {
  const { conversa, contato } = linha;
  const selo = seloDaConversa(conversa);
  const esperando = selo === "aguardando" || selo === "falha";
  const etapa = ctx.etapas.find((e) => e.id === contato.etapa_id);
  const digitando = selo === "janete" && ctx.trabalhando.includes(conversa.id);
  const ativo = digitando || janeteAtivaNoQuadro(linha, ctx.etapas, ctx.trabalhando, agora);
  const frio = frioNoQuadro(linha, ctx.etapas, agora);
  const ultima = linha.ultima;
  const responsavel = conversa.responsavel_id ? ctx.membros.find((m) => m.id === conversa.responsavel_id) : undefined;
  const estado = { eu: { id: ctx.euId } };

  const nossa = !!ultima && ultima.origem !== "lead";
  let previa: string;
  let tomPrevia: DadosCard["tomPrevia"] = null;
  if (digitando) {
    previa = "digitando…";
    tomPrevia = "digita";
  } else if (ultima) {
    previa = resumoMensagem(ultima);
    if (nossa && ultima.status === "falhou") tomPrevia = "falhou";
  } else {
    previa = conversa.ultima_mensagem_preview?.trim() || "Conversa começando";
  }

  const momento = ultima?.momento ?? conversa.ultima_mensagem_em ?? null;
  const esperaS = esperando ? segundosDesde(conversa.aguardando_humano_desde, agora) : null;
  const motivo = conversa.motivo_humano;

  let situacao: string;
  if (etapa?.tipo === "ganho") situacao = etapa.nome;
  else if (etapa?.tipo === "perdido") situacao = etapa.nome;
  else if (esperando)
    situacao = `Esperando a equipe há ${esperaLonga(esperaS ?? 0)}${motivo ? ` (${selo === "falha" ? "falha: " : ""}${MOTIVO_LONGO[motivo]})` : ""}`;
  else if (digitando) situacao = "Janete digitando…";
  else if (ativo) situacao = "Janete conversando agora";
  else if (frio > 0) situacao = `Lead sem responder ${tempoRelativo(conversa.ultima_do_lead_em ?? momento ?? agora, agora)}`;
  else if (selo === "janete") situacao = "Janete atendendo";
  else if (selo === "celular") situacao = "Respondida pelo celular da empresa";
  else situacao = conversa.responsavel_id === estado.eu.id ? "Com você" : `Com ${primeiroNome(responsavel?.nome ?? "a equipe")}`;

  return {
    contatoId: contato.id,
    conversaId: conversa.id,
    etapaId: contato.etapa_id,
    nome: nomeDoContato(contato),
    empresa: contato.empresa,
    selo,
    // Quando quem atende é você, o selo diz "VC" (como na situação da fundação).
    iniciaisMembro:
      selo === "membro" && responsavel ? (responsavel.id === estado.eu.id ? "VC" : iniciais(responsavel.nome)) : null,
    hora: momento ? horaLista(momento, agora) : "",
    esperaS,
    falha: selo === "falha",
    previa,
    tomPrevia,
    statusUltima: nossa && !digitando ? ultima.status : null,
    tipoUltima: !ultima || digitando ? null : ultima.apagada_em ? "apagada" : ultima.tipo === "texto" ? null : ultima.tipo,
    naoLidas: Math.max(0, conversa.nao_lidas),
    ativo,
    digitando,
    frio,
    situacao,
  };
}

/* ---------- ícones ---------- */

function IconeStatus({ status }: { status: StatusMensagem }) {
  const p = { className: s.kcIcone, "aria-hidden": true, strokeWidth: 2, "data-status": status } as const;
  switch (status) {
    case "na_fila":
    case "enviando":
      return <Clock {...p} />;
    case "enviada":
      return <Check {...p} />;
    case "entregue":
    case "lida":
      return <CheckCheck {...p} />;
    case "falhou":
      return <CircleAlert {...p} />;
    default:
      return null;
  }
}

function IconeTipo({ tipo }: { tipo: DadosCard["tipoUltima"] }) {
  const p = { className: s.kcIcone, "aria-hidden": true, strokeWidth: 2 } as const;
  switch (tipo) {
    case "apagada":
      return <Ban {...p} />;
    case "imagem":
      return <Camera {...p} />;
    case "audio":
      return <Mic {...p} />;
    case "video":
      return <Video {...p} />;
    case "documento":
      return <FileText {...p} />;
    case "figurinha":
      return <Sticker {...p} />;
    default:
      return null;
  }
}

/** "A Janete pode mover para cá": o símbolo da Janete só em contorno (o cheio fica para "quem atende"). */
export function IconeJaneteContorno({ className }: { className?: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5a4.5 4.5 0 1 1 0 9H7.5V12A4.5 4.5 0 0 1 12 7.5z" />
    </svg>
  );
}

/* ---------- o card ---------- */

export interface DecisaoCard {
  /** O nome da etapa para onde a Janete vai levar o lead. */
  paraNome: string;
  motivo: string;
  /** Quanto tempo a equipe tem para vetar (a barra esvazia). */
  duracaoMs: number;
}

export interface OpcaoMover {
  id: string;
  nome: string;
  cor: string;
}

/** O id do card no DOM (o voo e o foco usam). */
export const idCard = (contatoId: string) => `kb-card-${contatoId}`;
export const idAbrirCard = (contatoId: string) => `kb-abrir-${contatoId}`;
export const idMoverCard = (contatoId: string) => `kb-mover-${contatoId}`;

type Props = {
  dados: DadosCard;
  /** Ganho e Perdido: a mesma linha, menor. */
  compacto?: boolean | undefined;
  /** Quem moveu por último ("A Janete moveu para cá às 14:46"): só no rótulo do leitor de tela. O card
      visível fica em 2 linhas (rodada 2); o resto está no histórico da gaveta e no "Desde que você saiu". */
  rastro?: string | null | undefined;
  decisao?: DecisaoCard | null | undefined;
  aoVetar?: (() => void) | undefined;
  menuAberto: boolean;
  aoAlternarMenu: () => void;
  opcoes: readonly OpcaoMover[];
  aoMover: (etapaId: string) => void;
  /** A Janete acabou de mover: o "Desfazer" fica no menu por 10 s. */
  desfazerPara?: string | null | undefined;
  aoDesfazer?: (() => void) | undefined;
  aoAbrir: () => void;
  /** Arrastar com o mouse (HTML5). Sem ele, o card não arrasta (revendo o dia). */
  arrastavel: boolean;
  aoComecarArraste?: ((ev: DragEvent<HTMLElement>) => void) | undefined;
  aoTerminarArraste?: (() => void) | undefined;
  arrastando?: boolean | undefined;
  /** Destaque do pouso (acabou de chegar à coluna). */
  pousou?: boolean | undefined;
  /** O card está voando nas mãos da Janete: o símbolo dela no canto. */
  voando?: boolean | undefined;
  /** O mouse parou no card ou saiu dele (a prévia flutuante da conversa). */
  aoEntrar?: (() => void) | undefined;
  aoSair?: (() => void) | undefined;
};

export function Card({
  dados: d,
  compacto = false,
  rastro,
  decisao,
  aoVetar,
  menuAberto,
  aoAlternarMenu,
  opcoes,
  aoMover,
  desfazerPara,
  aoDesfazer,
  aoAbrir,
  arrastavel,
  aoComecarArraste,
  aoTerminarArraste,
  arrastando = false,
  pousou = false,
  voando = false,
  aoEntrar,
  aoSair,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const esperando = d.esperaS !== null;

  // Ao abrir o menu, o foco vai para o "Desfazer" (se houver) ou para a primeira etapa possível. O menu
  // inteiro rola para a vista (no celular ele abre perto da dobra, embaixo da barra e do botão da Janete).
  useEffect(() => {
    if (!menuAberto) return;
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    menu?.scrollIntoView?.({ block: "nearest" });
  }, [menuAberto]);

  const teclaMenu = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      aoAlternarMenu();
      document.getElementById(idMoverCard(d.contatoId))?.focus();
      return;
    }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const botoes = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!botoes.length) return;
    ev.preventDefault();
    const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
    const prox = ev.key === "ArrowDown" ? (i + 1) % botoes.length : (i - 1 + botoes.length) % botoes.length;
    botoes[prox]?.focus();
  };

  const nl = d.naoLidas;
  const rotuloAbrir = [
    `Abrir a conversa com ${d.nome}${d.empresa ? `, ${d.empresa}` : ""}.`,
    `${d.situacao}.`,
    d.previa ? `Última: ${d.previa.length > 80 ? `${d.previa.slice(0, 79).trimEnd()}…` : d.previa}${d.hora ? `, ${d.hora}` : ""}.` : "",
    nl ? `${nl} ${nl > 1 ? "não lidas" : "não lida"}.` : "",
    rastro ? `${rastro}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Esfriando: o card ganha um tom só e o avatar fica cinza; o anel do selo acompanha o fundo.
  // No compacto, o avatar fica nos 36 px do tamanho "p" (o selo foi medido para ele e não encosta nas
  // iniciais); no card normal, 40 px.
  const estiloAvatar: CSSProperties = {
    ...(compacto ? {} : { ["--al-d" as string]: "40px" }),
    ...(d.frio > 0 ? { background: "var(--sb-linha)", color: "var(--sb-tinta-2)" } : {}),
  };

  return (
    <article
      id={idCard(d.contatoId)}
      className={s.kcCard}
      aria-label={`${d.nome}${d.empresa ? `, ${d.empresa}` : ""}`}
      data-compacto={compacto || undefined}
      data-ativo={d.ativo || undefined}
      data-frio={d.frio > 0 ? d.frio : undefined}
      data-nova={nl > 0 || undefined}
      data-espera={esperando || undefined}
      data-falha={d.falha || undefined}
      data-arrastando={arrastando || undefined}
      data-pousou={pousou || undefined}
      data-voando={voando || undefined}
      data-decisao={decisao ? "" : undefined}
      data-menu={menuAberto || undefined}
      draggable={arrastavel && !decisao}
      onDragStart={arrastavel ? aoComecarArraste : undefined}
      onDragEnd={aoTerminarArraste}
      onMouseEnter={aoEntrar}
      onMouseLeave={aoSair}
      onClick={(ev) => {
        // Arrastável, o botão de abrir não recebe o ponteiro (o arrasto começa no próprio card, e não num
        // botão, que o Firefox não deixa arrastar): o clique no card abre a conversa. O teclado continua
        // pelo botão.
        if (ev.target === ev.currentTarget) aoAbrir();
      }}
    >
      <button id={idAbrirCard(d.contatoId)} type="button" className={s.kcAbrir} aria-label={rotuloAbrir} onClick={aoAbrir} />

      {decisao ? (
        <div className={s.kcDecisao} role="status" style={{ ["--kc-dur" as string]: `${decisao.duracaoMs}ms` }}>
          <p className={s.kcDecTitulo}>
            <JaneteSimbolo estado="fala" tamanho={20} decorativo />
            <span className={s.kcDecNome} aria-hidden="true">
              {primeiroNome(d.nome)}
            </span>
            <ArrowRight className={s.kcDecSeta} aria-hidden="true" strokeWidth={2.2} />
            <span className={s.kcDecEtapa}>
              <span className={s.kcSr}>A Janete vai mover {d.nome} para </span>
              {decisao.paraNome}
            </span>
          </p>
          <span className={s.kcDecMotivo}>{decisao.motivo}</span>
          {aoVetar ? (
            <>
              <button type="button" className={s.kcDecVeto} onClick={aoVetar}>
                Manter aqui
              </button>
              <span className={s.kcDecBarra} aria-hidden="true" />
            </>
          ) : null}
        </div>
      ) : (
        <>
          <span className={s.kcAv} aria-hidden="true">
            <AvatarLead
              nome={d.nome}
              chave={d.contatoId}
              selo={d.selo}
              iniciaisMembro={d.iniciaisMembro}
              tamanho="p"
              style={estiloAvatar}
            />
          </span>
          <span className={s.kcTxt} aria-hidden="true">
            <span className={s.kcL1}>
              <span className={s.kcNome}>{d.nome}</span>
              {esperando ? (
                <span className={s.kcSelo} data-falha={d.falha || undefined}>
                  {esperaCompacta(d.esperaS ?? 0)}
                </span>
              ) : d.hora ? (
                <span className={s.kcHora}>{d.hora}</span>
              ) : null}
            </span>
            <span className={s.kcL2}>
              <span className={s.kcPrev} data-tom={d.tomPrevia ?? undefined}>
                {d.statusUltima && d.tomPrevia !== "falhou" ? <IconeStatus status={d.statusUltima} /> : null}
                {d.tomPrevia === "falhou" ? <CircleAlert className={s.kcIcone} aria-hidden="true" strokeWidth={2} /> : null}
                <IconeTipo tipo={d.tipoUltima} />
                <span className={s.kcPrevTexto}>{d.previa}</span>
              </span>
              {nl > 0 ? <span className={s.kcNl}>{nl > 99 ? "99+" : nl}</span> : null}
            </span>
          </span>
          <button
            id={idMoverCard(d.contatoId)}
            type="button"
            className={s.kcMover}
            aria-label={`Mover ${d.nome} para outra etapa`}
            aria-expanded={menuAberto}
            onClick={aoAlternarMenu}
          >
            <ArrowLeftRight aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        </>
      )}

      {voando ? <JaneteSimbolo className={s.kcVooJanete} estado="fala" tamanho={24} decorativo /> : null}

      {menuAberto && !decisao ? (
        <div ref={menuRef} className={s.kcMenu} role="group" aria-label={`Mover ${d.nome} para`} onKeyDown={teclaMenu}>
          {desfazerPara && aoDesfazer ? (
            <button type="button" className={s.kcDesfazer} onClick={aoDesfazer}>
              <Undo2 aria-hidden="true" size={14} strokeWidth={2} />
              <span>Desfazer: voltar para {desfazerPara}</span>
            </button>
          ) : null}
          <p className={s.kcMenuTitulo}>Mover para</p>
          {opcoes.map((o) => (
            <button
              key={o.id}
              type="button"
              className={s.kcMenuOpcao}
              disabled={o.id === d.etapaId}
              aria-current={o.id === d.etapaId ? "true" : undefined}
              onClick={() => aoMover(o.id)}
            >
              <i className={s.kcMenuCor} style={{ background: o.cor }} aria-hidden="true" />
              <span>{o.nome}</span>
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
