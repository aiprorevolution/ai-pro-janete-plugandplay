import { useState, type DragEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";

import { type Classes } from "@/components/aipro/cx";

import type { Etapa } from "../exemplo";
import { IconeJaneteContorno } from "./Card";
import estilos from "./Coluna.module.css";

const s = estilos as Classes<
  | "kbCol"
  | "kbColCab"
  | "kbColTag"
  | "kbColTagBotao"
  | "kbColNome"
  | "kbColCor"
  | "kbColConta"
  | "kbColJanete"
  | "kbColExpandir"
  | "kbColLista"
  | "kbColSolta"
  | "kbColVazia"
  | "kbColRecorte"
  | "kbTrilho"
  | "kbTrilhoSeta"
  | "kbSr"
>;

/* ---------- as cores das etapas (o "Editar etapas" troca) ---------- */

export type IdCorEtapa = "cinza" | "azul" | "menta" | "rosa" | "areia";

/** As 5 cores do protótipo. O areia vem por último: lembra o âmbar de "aguardando humano". */
export const CORES_ETAPA: readonly { id: IdCorEtapa; nome: string; valor: string }[] = [
  { id: "cinza", nome: "Cinza", valor: "var(--sb-linha)" },
  { id: "azul", nome: "Azul", valor: "var(--sb-azul-claro)" },
  { id: "menta", nome: "Menta", valor: "var(--sb-menta)" },
  { id: "rosa", nome: "Rosa", valor: "var(--sb-rosa)" },
  { id: "areia", nome: "Areia", valor: "var(--sb-areia)" },
];

/** A cor de cada etapa quando o banco ainda não tem uma (`cor` nula): a do protótipo. */
const COR_PADRAO: Record<string, IdCorEtapa> = {
  novo: "cinza",
  em_qualificacao: "azul",
  qualificado: "menta",
  em_negociacao: "rosa",
  ganho: "menta",
  perdido: "cinza",
};

export function idCorDaEtapa(etapa: Pick<Etapa, "cor" | "chave">): IdCorEtapa {
  const salva = CORES_ETAPA.find((c) => c.id === etapa.cor);
  if (salva) return salva.id;
  return (etapa.chave && COR_PADRAO[etapa.chave]) || "cinza";
}

/** A cor da etapa (sem etapa, o cinza). A tabela é uma só: quadro, menus, gaveta e etapa em chat. */
export function corDaEtapa(etapa: Pick<Etapa, "cor" | "chave"> | null | undefined): string {
  if (!etapa) return CORES_ETAPA[0]!.valor;
  const id = idCorDaEtapa(etapa);
  return CORES_ETAPA.find((c) => c.id === id)!.valor;
}

/** O nome para a tela: o nome aparado, ou "Sem nome". */
export function nomeDaEtapa(etapa: Pick<Etapa, "nome"> | null | undefined): string {
  return etapa?.nome.trim() || "Sem nome";
}

/* ---------- a coluna ---------- */

export const idColuna = (etapaId: string) => `kb-col-${etapaId}`;
export const idTrilho = (etapaId: string) => `kb-trilho-${etapaId}`;
export const idRecolher = (etapaId: string) => `kb-recolher-${etapaId}`;
export const idExpandir = (etapaId: string) => `kb-exp-${etapaId}`;

type Props = {
  etapa: Etapa;
  /** Quantos cards a coluna mostra agora (com filtro) e quantos tem ao todo. */
  mostrados: number;
  total: number;
  /**
   * Ganho e Perdido mostram só quem entrou nos últimos 30 dias (decisão 13): aqui, quantos leads a
   * etapa tem de todas as datas, que a coluna mostra ao lado. Sem ele, a coluna é a etapa inteira.
   */
  totalGeral?: number | undefined;
  filtrado: boolean;
  /** Ganho e Perdido: no computador, um trilho vertical que abre. */
  fim?: boolean | undefined;
  fechado?: boolean | undefined;
  aoAbrirTrilho?: (() => void) | undefined;
  aoRecolher?: (() => void) | undefined;
  aoExpandir: () => void;
  /** Soltar um card arrastado nesta etapa. Sem ele, a coluna não recebe (revendo o dia). */
  aoSoltar?: ((contatoId: string | null) => void) | undefined;
  /** Há um card sendo arrastado (a coluna mostra "Solte aqui" quando o ponteiro está nela). */
  arrastoAtivo: boolean;
  /** O mouse entrou (true) ou saiu (false) da lista: a ordem dela fica parada, para o card não pular sob o cursor. */
  aoCongelar?: ((congelar: boolean) => void) | undefined;
  children?: ReactNode;
};

/**
 * Uma etapa do quadro: o cabeçalho enxuto (o ponto da cor, o nome, o contador, o ícone discreto de
 * "a Janete pode mover para cá" e o botão de abrir a etapa como chat) e a lista de cards. Recebe o card
 * arrastado (HTML5). Fechada (Ganho e Perdido no computador), vira um trilho vertical que também recebe.
 */
export function Coluna({
  etapa,
  mostrados,
  total,
  totalGeral,
  filtrado,
  fim = false,
  fechado = false,
  aoAbrirTrilho,
  aoRecolher,
  aoExpandir,
  aoSoltar,
  arrastoAtivo,
  aoCongelar,
  children,
}: Props) {
  const [sobre, setSobre] = useState(false);
  const nome = nomeDaEtapa(etapa);
  const cor = corDaEtapa(etapa);
  const titId = `kb-tit-${etapa.id}`;
  const plural = (n: number) => `${n} ${n === 1 ? "lead" : "leads"}`;
  // Ganho e Perdido: o recorte dos 30 dias e o total de todas as datas (decisão 13).
  const recorte = totalGeral !== undefined ? `nos últimos 30 dias, ${totalGeral} no total` : null;

  // Soltar: a coluna aceita o card enquanto há um arrasto. O id vem do dataTransfer (ou de quem arrasta).
  const recebe = !!aoSoltar && arrastoAtivo;
  const alvo = {
    onDragOver: (ev: DragEvent<HTMLElement>) => {
      if (!recebe) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      if (!sobre) setSobre(true);
    },
    onDragLeave: (ev: DragEvent<HTMLElement>) => {
      const para = ev.relatedTarget as Node | null;
      if (para && ev.currentTarget.contains(para)) return;
      setSobre(false);
    },
    onDrop: (ev: DragEvent<HTMLElement>) => {
      if (!recebe) return;
      ev.preventDefault();
      setSobre(false);
      const id = ev.dataTransfer?.getData("text/plain") || null;
      aoSoltar?.(id);
    },
  };
  const ativoSobre = sobre && recebe;

  if (fim && fechado) {
    return (
      <button
        id={idTrilho(etapa.id)}
        type="button"
        className={s.kbTrilho}
        data-sobre={ativoSobre || undefined}
        aria-label={`Abrir ${nome}: ${filtrado ? `${plural(mostrados)} de ${total} com o filtro` : plural(total)}${recorte ? ` ${recorte}` : ""}${etapa.janete_pode_mover ? ". A Janete pode mover leads para cá" : ""}`}
        onClick={aoAbrirTrilho}
        {...alvo}
      >
        <span className={s.kbColTag}>
          <i className={s.kbColCor} style={{ background: cor }} aria-hidden="true" />
          <span className={s.kbColNome}>{nome}</span>
        </span>
        <span className={s.kbColConta}>{filtrado ? `${mostrados} de ${total}` : total}</span>
        {etapa.janete_pode_mover ? <IconeJaneteContorno className={s.kbColJanete} /> : null}
        <ChevronRight className={s.kbTrilhoSeta} aria-hidden="true" size={16} strokeWidth={2} />
      </button>
    );
  }

  return (
    <section
      id={idColuna(etapa.id)}
      className={s.kbCol}
      aria-labelledby={titId}
      data-etapa={etapa.id}
      data-fim={fim || undefined}
      data-sobre={ativoSobre || undefined}
      {...alvo}
    >
      <header className={s.kbColCab}>
        {fim && aoRecolher ? (
          <h2 className={s.kbColTag}>
            <button
              id={idRecolher(etapa.id)}
              type="button"
              className={s.kbColTagBotao}
              aria-expanded="true"
              aria-label={`Recolher ${nome}`}
              title={`Recolher ${nome}`}
              onClick={aoRecolher}
            >
              <ChevronLeft aria-hidden="true" size={14} strokeWidth={2} />
              <i className={s.kbColCor} style={{ background: cor }} aria-hidden="true" />
              <span className={s.kbColNome} id={titId}>
                {nome}
              </span>
            </button>
          </h2>
        ) : (
          <h2 className={s.kbColTag} id={titId}>
            <i className={s.kbColCor} style={{ background: cor }} aria-hidden="true" />
            <span className={s.kbColNome}>{nome}</span>
          </h2>
        )}
        <span className={s.kbColConta} aria-label={plural(mostrados)}>
          {filtrado ? `${mostrados} de ${total}` : total}
        </span>
        {etapa.janete_pode_mover ? (
          <span className={s.kbColJanete} title="A Janete pode mover leads para cá">
            <IconeJaneteContorno />
            <span className={s.kbSr}>A Janete pode mover leads para cá</span>
          </span>
        ) : null}
        <button
          id={idExpandir(etapa.id)}
          type="button"
          className={s.kbColExpandir}
          aria-label={`Abrir ${nome} como chat`}
          title="Abrir a etapa como chat"
          onClick={aoExpandir}
        >
          <Maximize2 aria-hidden="true" size={16} strokeWidth={2} />
        </button>
      </header>
      {recorte ? (
        <p className={s.kbColRecorte}>
          Últimos 30 dias · {totalGeral} no total
        </p>
      ) : null}
      <div className={s.kbColLista} onMouseEnter={() => aoCongelar?.(true)} onMouseLeave={() => aoCongelar?.(false)}>
        {ativoSobre ? (
          <div className={s.kbColSolta} aria-hidden="true">
            Solte aqui
          </div>
        ) : null}
        {children}
        {mostrados === 0 && !ativoSobre ? (
          <p className={s.kbColVazia} data-leve={filtrado || undefined}>
            {filtrado ? "Nada com esse filtro" : "Nenhum lead aqui"}
          </p>
        ) : null}
      </div>
    </section>
  );
}
