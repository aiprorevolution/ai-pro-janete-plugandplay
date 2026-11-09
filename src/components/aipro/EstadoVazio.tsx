import type { ReactNode } from "react";
import { cx, type Classes } from "./cx";
import estilos from "./EstadoVazio.module.css";

const s = estilos as Classes<
  | "vazio"
  | "corpo"
  | "textos"
  | "titulo"
  | "motivo"
  | "acao"
  | "icone"
  | "esboco"
  | "osso"
  | "linhaLista"
  | "quadrado"
  | "cartaoOsso"
  | "coluna"
  | "linhaTabela"
  | "compacto"
>;

type Forma = "lista" | "cartao" | "tabela" | "quadro" | "linha";

type Props = {
  /** O que ainda não existe: "Nenhum contato ainda". */
  oQueFalta: string;
  /** Por que importa: "Os contatos chegam quando o WhatsApp recebe a primeira mensagem." */
  porQueImporta: string;
  /** Botao/BotaoLink principal que leva ao primeiro item. `null` quando não há ação
      possível ainda (área que só existe na próxima onda). */
  acao: ReactNode;
  /** `oQueFalta` é sempre heading: h2 (padrão), h3 dentro de seção com h2, h4. */
  nivelTitulo?: 2 | 3 | 4 | undefined;
  /** id do heading, para `aria-labelledby` da seção. */
  idTitulo?: string | undefined;
  /** Esboço do que vai existir aqui, em osso cinza, sem animação. */
  forma?: Forma | undefined;
  /** Ícone da área. */
  icone?: ReactNode;
  /** Dentro de card ou de lista: uma linha, sem o contorno grande. */
  compacto?: boolean | undefined;
  /** Vazio por filtro: diz o filtro e oferece limpar no lugar de criar. */
  filtrado?: { texto: string; aoLimpar: ReactNode } | undefined;
  className?: string | undefined;
};

function Esboco({ forma }: { forma: Forma }) {
  if (forma === "quadro") {
    return (
      <span className={s.esboco} data-forma="quadro" aria-hidden="true">
        {[0, 1].map((coluna) => (
          <span key={coluna} className={s.coluna}>
            <span className={s.osso} data-largura="curta" />
            <span className={s.cartaoOsso} />
            {coluna === 0 ? <span className={s.cartaoOsso} /> : null}
          </span>
        ))}
      </span>
    );
  }
  if (forma === "tabela") {
    return (
      <span className={s.esboco} data-forma="tabela" aria-hidden="true">
        <span className={s.linhaTabela} data-cabecalho>
          <span className={s.osso} />
          <span className={s.osso} />
          <span className={s.osso} />
        </span>
        {[0, 1].map((linha) => (
          <span key={linha} className={s.linhaTabela}>
            <span className={s.osso} />
            <span className={s.osso} />
            <span className={s.osso} />
          </span>
        ))}
      </span>
    );
  }
  if (forma === "cartao") {
    return (
      <span className={s.esboco} data-forma="cartao" aria-hidden="true">
        {[0, 1].map((cartao) => (
          <span key={cartao} className={s.cartaoOsso}>
            <span className={s.osso} data-largura="curta" />
            <span className={s.osso} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={s.esboco} data-forma="lista" aria-hidden="true">
      {[0, 1, 2].map((linha) => (
        <span key={linha} className={s.linhaLista}>
          <span className={s.quadrado} />
          <span className={s.osso} data-largura={linha === 1 ? "media" : undefined} />
        </span>
      ))}
    </span>
  );
}

/**
 * Vazio que ensina: o que falta, por que importa e a ação que cria o primeiro item,
 * dentro do contorno tracejado do que vai existir. Sem ilustração, sem "Nada por
 * aqui". Erro não é vazio: erro é `Aviso`.
 */
export function EstadoVazio({
  oQueFalta,
  porQueImporta,
  acao,
  forma = "lista",
  icone,
  compacto = false,
  filtrado,
  nivelTitulo = 2,
  idTitulo,
  className,
}: Props) {
  const Titulo = nivelTitulo === 4 ? "h4" : nivelTitulo === 3 ? "h3" : "h2";
  const titulo = (
    <Titulo id={idTitulo} className={s.titulo}>
      {filtrado ? filtrado.texto : oQueFalta}
    </Titulo>
  );
  const acaoFinal = filtrado ? filtrado.aoLimpar : acao;
  const blocoAcao = acaoFinal ? <div className={s.acao}>{acaoFinal}</div> : null;

  if (compacto || forma === "linha") {
    return (
      <div className={cx(s.vazio, s.compacto, className)}>
        {icone ? <span className={s.icone}>{icone}</span> : null}
        <div className={s.textos}>
          {titulo}
          <p className={s.motivo}>{porQueImporta}</p>
        </div>
        {blocoAcao}
      </div>
    );
  }

  return (
    <div className={cx(s.vazio, className)} data-forma={forma}>
      {!filtrado ? <Esboco forma={forma} /> : null}
      <div className={s.corpo}>
        {icone ? <span className={s.icone}>{icone}</span> : null}
        <div className={s.textos}>
          {titulo}
          <p className={s.motivo}>{porQueImporta}</p>
        </div>
        {blocoAcao}
      </div>
    </div>
  );
}
