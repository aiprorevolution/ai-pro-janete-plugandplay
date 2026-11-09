import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Botao } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";

import { ESPERA_LONGA_S } from "../comum/LinhaConversa";
import { esperaCompacta, esperaLonga, segundosDesde } from "../comum/tempo";
import { Carregando, ErroLeitura, type FormaCarregando } from "../dados/estados";
import type { Leitura } from "../dados/tipos";
import type { Etapa } from "../exemplo";
import type { QuemAtende } from "./tipos";
import estilos from "./pecas.module.css";

// Peças pequenas que a tabela e o perfil de Contatos repetem. Nenhuma tem fundo colorido (decisão 5
// do equipe): a cor fica só na bolinha da etapa e na de "ao vivo".

const s = estilos as Classes<
  | "ptEtapa"
  | "ptBolinha"
  | "ptNome"
  | "ptQuem"
  | "ptTexto"
  | "ptLongo"
  | "ptCurto"
  | "ptAlerta"
  | "ptVivo"
  | "ptSr"
  | "ptVazio"
  | "ptVazioTitulo"
  | "ptVazioTexto"
  | "ptPaginas"
  | "ptPaginasTexto"
  | "ptPaginasBotoes"
>;

/* ---------- a cor da etapa ----------
   Cópia da regra de kanban/Coluna.tsx (CORES_ETAPA, COR_PADRAO e corDaEtapa), para a bolinha ter a
   mesma cor do quadro sem importar de kanban/. Se o Kanban mudar a tabela de cores, mude aqui também. */

const CORES_ETAPA: Readonly<Record<string, string>> = {
  cinza: "var(--sb-linha)",
  azul: "var(--sb-azul-claro)",
  menta: "var(--sb-menta)",
  rosa: "var(--sb-rosa)",
  areia: "var(--sb-areia)",
};

/** A cor de cada etapa quando o banco ainda não tem uma (`cor` nula): a do protótipo. */
const COR_PADRAO: Readonly<Record<string, string>> = {
  novo: "cinza",
  em_qualificacao: "azul",
  qualificado: "menta",
  em_negociacao: "rosa",
  ganho: "menta",
  perdido: "cinza",
};

/** O que a bolinha precisa da etapa. A `chave` é opcional: sem ela e sem `cor`, a bolinha fica cinza. */
export type EtapaDoPonto = Pick<Etapa, "nome" | "cor"> & { chave?: string | null | undefined };

export function corDaEtapa(etapa: EtapaDoPonto | null | undefined): string {
  const salva = etapa?.cor ? CORES_ETAPA[etapa.cor] : undefined;
  if (salva) return salva;
  const padrao = etapa?.chave ? COR_PADRAO[etapa.chave] : undefined;
  return (padrao && CORES_ETAPA[padrao]) || CORES_ETAPA["cinza"]!;
}

/** A bolinha na cor da etapa e o nome dela. */
export function PontoEtapa({ etapa, className }: { etapa: EtapaDoPonto; className?: string | undefined }) {
  return (
    <span className={cx(s.ptEtapa, className)}>
      <i className={s.ptBolinha} style={{ background: corDaEtapa(etapa) } as CSSProperties} aria-hidden="true" />
      <span className={s.ptNome}>{etapa.nome.trim() || "Sem nome"}</span>
    </span>
  );
}

/* ---------- quem atende ---------- */

/** A conversa espera a equipe (inclusive quando a Janete parou por falha). */
export const estaEsperando = (quem: QuemAtende) => quem.tipo === "aguardando" || quem.tipo === "falha";

/**
 * A espera passou de 10 min (ESPERA_LONGA_S, a mesma régua do Chat): a bolinha e o ícone saem do
 * âmbar para o vermelho. Vale igual para a falha (como o sinalDaLinha do Chat).
 */
export function esperaEhLonga(quem: QuemAtende, agora: number): boolean {
  return estaEsperando(quem) && !!quem.esperaDesde && segundosDesde(quem.esperaDesde, agora) >= ESPERA_LONGA_S;
}

/** "4 min" e "1 h 05" sem quebrar entre o número e a unidade. */
const semQuebra = (texto: string) => texto.replace(/ /g, " ");

/**
 * O texto de quem atende: "A Janete" (com a bolinha verde quando ela está ao vivo), "Esperando a
 * equipe · 12 min", "Você", "Marina", "Celular da empresa". O leitor de tela ouve a espera por
 * extenso ("há 12 min") e o "ao vivo" em palavras.
 *
 * A espera não pinta o texto (decisão 5 do equipe): a cor fica numa bolinha de 7 px antes dele, âmbar
 * até 10 min e vermelha a partir daí (`data-longa`). `curto` troca "Esperando a equipe" por
 * "Esperando": "sempre" (a lista do celular) ou "estreito" (só de 1024 a 1279 px, a tabela apertada).
 */
export function TextoQuem({
  quem,
  agora,
  curto,
}: {
  quem: QuemAtende;
  agora: number;
  curto?: "sempre" | "estreito" | undefined;
}) {
  if (quem.tipo === "janete") {
    return (
      <span className={s.ptQuem} data-tipo="janete">
        <span className={s.ptTexto}>{quem.nome}</span>
        {quem.aoVivo ? (
          <>
            <i className={s.ptVivo} aria-hidden="true" />
            <span className={s.ptSr}>, ao vivo</span>
          </>
        ) : null}
      </span>
    );
  }
  if (estaEsperando(quem)) {
    const seg = quem.esperaDesde ? segundosDesde(quem.esperaDesde, agora) : null;
    const tempo = seg === null ? "" : ` · ${semQuebra(esperaCompacta(seg))}`;
    return (
      <span className={s.ptQuem} data-tipo={quem.tipo} data-curto={curto}>
        <i className={s.ptAlerta} data-longa={esperaEhLonga(quem, agora) ? "" : undefined} aria-hidden="true" />
        <span className={cx(s.ptTexto, s.ptLongo)} aria-hidden="true">{`${quem.nome}${tempo}`}</span>
        {curto ? (
          <span className={cx(s.ptTexto, s.ptCurto)} aria-hidden="true">{`Esperando${tempo}`}</span>
        ) : null}
        <span className={s.ptSr}>{seg === null ? quem.nome : `${quem.nome} há ${esperaLonga(seg)}`}</span>
      </span>
    );
  }
  return (
    <span className={s.ptQuem} data-tipo={quem.tipo}>
      <span className={s.ptTexto}>{quem.nome}</span>
    </span>
  );
}

/* ---------- carregando e erro de leitura ---------- */

/**
 * O que a aba (ou o perfil) mostra enquanto a leitura não chegou: o esqueleto e, se ela falhou, o
 * aviso com "Tentar de novo" (as peças comuns de dados/estados.tsx).
 */
export function EstadoDaAba({
  leitura,
  forma = "texto",
}: {
  leitura: Pick<Leitura<unknown>, "erro" | "tentarDeNovo">;
  forma?: FormaCarregando | undefined;
}) {
  if (leitura.erro) return <ErroLeitura erro={leitura.erro} tentarDeNovo={leitura.tentarDeNovo} />;
  return <Carregando forma={forma} rotulo="Carregando o contato" />;
}

/* ---------- a paginação da tabela ---------- */

/**
 * "1–50 de 312" e os botões de página anterior e seguinte (decisão 12: páginas de 50). Só aparece
 * quando há mais de uma página. O total fica numa região viva: o leitor de tela ouve a troca.
 */
export function Paginacao({
  pagina,
  tamanho,
  total,
  aoMudar,
  ocupado = false,
}: {
  /** A página atual, a partir de 0. */
  pagina: number;
  tamanho: number;
  total: number;
  aoMudar(pagina: number): void;
  /** A próxima página está chegando (os botões esperam). */
  ocupado?: boolean | undefined;
}) {
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  if (paginas <= 1) return null;
  const atual = Math.min(Math.max(0, pagina), paginas - 1);
  const de = atual * tamanho + 1;
  const ate = Math.min(total, (atual + 1) * tamanho);
  return (
    <nav className={s.ptPaginas} aria-label="Páginas de contatos">
      <p className={s.ptPaginasTexto} aria-live="polite">
        {`${de}–${ate} de ${total}`}
      </p>
      <div className={s.ptPaginasBotoes}>
        <Botao
          variante="contorno"
          tamanho="compacto"
          icone={<ChevronLeft size={16} strokeWidth={2} />}
          disabled={atual === 0 || ocupado}
          onClick={() => aoMudar(atual - 1)}
        >
          Anterior
        </Botao>
        <Botao
          variante="contorno"
          tamanho="compacto"
          disabled={atual >= paginas - 1 || ocupado}
          onClick={() => aoMudar(atual + 1)}
        >
          Próxima
          <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
        </Botao>
      </div>
    </nav>
  );
}

/* ---------- o estado vazio ---------- */

/**
 * O vazio da tela (tabela sem contato, filtro sem resultado, aba sem dado), no estilo do vazio da
 * plataforma (AreaVazia): caixa tracejada, título, texto e, se houver, um botão.
 */
export function VazioContatos({
  titulo,
  texto,
  acao,
}: {
  titulo: string;
  texto: ReactNode;
  acao?: { rotulo: string; aoClicar: () => void } | undefined;
}) {
  return (
    <div className={s.ptVazio}>
      <h2 className={s.ptVazioTitulo}>{titulo}</h2>
      <p className={s.ptVazioTexto}>{texto}</p>
      {acao ? (
        <Botao variante="contorno" tamanho="compacto" onClick={acao.aoClicar}>
          {acao.rotulo}
        </Botao>
      ) : null}
    </div>
  );
}
