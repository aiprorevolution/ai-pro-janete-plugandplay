import type { ComponentProps } from "react";

import { Aviso, Botao, Esqueleto, EstadoVazio } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";

import estilos from "./estados.module.css";
import type { Erro } from "./tipos";

// Os 3 estados iguais em todas as telas (spec 2.1, estados.tsx; plano, "Peças comuns", item 4):
// carregando (o Esqueleto do AI PRO, na forma do conteúdo), vazio (o EstadoVazio do AI PRO) e erro
// de leitura, com "Tentar de novo".

const s = estilos as Classes<"carregando" | "linhaLista" | "textoLista" | "cartoes">;

export type FormaCarregando = "lista" | "cartao" | "texto";

interface PropsCarregando {
  forma?: FormaCarregando | undefined;
  /** Quantas linhas ou cartões de osso (repita a contagem do conteúdo real). */
  quantos?: number | undefined;
  /** O que o leitor de tela anuncia. */
  rotulo?: string | undefined;
  className?: string | undefined;
}

export function Carregando({ forma = "lista", quantos, rotulo = "Carregando", className }: PropsCarregando) {
  const n = quantos ?? (forma === "cartao" ? 2 : 3);
  return (
    <div className={cx(s.carregando, className)} role="status" aria-label={rotulo} aria-busy="true" data-forma={forma}>
      {forma === "texto" ? (
        <Esqueleto forma="texto" linhas={n} />
      ) : forma === "cartao" ? (
        <div className={s.cartoes}>
          {Array.from({ length: n }, (_, i) => (
            <Esqueleto key={i} forma="bloco" altura={96} raio="card" />
          ))}
        </div>
      ) : (
        Array.from({ length: n }, (_, i) => (
          <div key={i} className={s.linhaLista}>
            <Esqueleto forma="circulo" largura={36} altura={36} />
            <span className={s.textoLista}>
              <Esqueleto forma="texto" linhas={2} />
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/** O vazio que ensina (o EstadoVazio do AI PRO, com as mesmas props). */
export function Vazio(props: ComponentProps<typeof EstadoVazio>) {
  return <EstadoVazio {...props} />;
}

/** O texto curto de cada erro de leitura, para quem lê (sem código). */
export function textoDoErro(erro: Erro | null | undefined): string {
  switch (erro) {
    case "sem_acesso":
      return "Sua conta não tem acesso a isto.";
    case "nao_encontrado":
      return "Não achamos o que você procurou. Pode ter sido apagado.";
    case "sem_conexao_ativa":
      return "O WhatsApp não está conectado.";
    case "janela_fechada":
      return "O lead não escreve há mais de 24 horas: o WhatsApp só deixa responder depois que ele escrever.";
    default:
      return "Verifique a internet e tente de novo.";
  }
}

interface PropsErroLeitura {
  tentarDeNovo: () => void;
  erro?: Erro | null | undefined;
  /** O título do aviso. Padrão: "Não deu para carregar". */
  titulo?: string | undefined;
  compacto?: boolean | undefined;
  className?: string | undefined;
}

export function ErroLeitura({ tentarDeNovo, erro, titulo = "Não deu para carregar", compacto, className }: PropsErroLeitura) {
  return (
    <Aviso
      tom="erro"
      titulo={titulo}
      compacto={compacto}
      className={className}
      acao={
        <Botao variante="contorno" tamanho="compacto" onClick={tentarDeNovo}>
          Tentar de novo
        </Botao>
      }
    >
      {textoDoErro(erro)}
    </Aviso>
  );
}
