import type { ReactNode } from "react";

import { Botao, cx } from "@/components/aipro";
import { useBarraRecolhida } from "@/features/onboarding/palco";

import { FASES_FECHADAS, FASES_SOB, IC, type Fase } from "./dados";
import { s } from "./estilos";
import { Icone } from "./pecas";

/** Como o cartão está entrando: 'espera' (invisível, mas medido), 'nascendo' (do símbolo do
 *  login) ou 'desdobrando' (do check do WhatsApp). */
export type EntradaCartao = "espera" | "nascendo" | "desdobrando" | null;

export interface PropsCartaoLista {
  /** O que vai em cima do título: o selo do WhatsApp ou o olho "O cérebro da Janete". */
  topo: ReactNode;
  titulo: string;
  subtitulo: string;
  fase: Fase;
  /** A Janete está no palco (fechando, verificando, ok, erro): o cabeçalho sai de cena. */
  validando: boolean;
  entrada: EntradaCartao;
  /** O check virando a Janete, antes de ir para o despertar. */
  saindo?: boolean;
  /** A página está rolando até o disco antes de o cartão dobrar (useValidacao): a lista fica inert. */
  preparando?: boolean;
  /** O palco da validação (PalcoValidacao), por cima do cartão. */
  palco: ReactNode;
  /** As linhas do acordeão. */
  children: ReactNode;
  /** data-etapa da seção (conexao, cerebro). */
  etapa: string;
}

/**
 * O cartão da lista (seção "1 e 2 · A lista" do F), o mesmo no WhatsApp e no cérebro: cabeçalho
 * centrado, o cartão branco em acordeão e, por cima dele, o palco da validação. Quando valida, o
 * cartão dobra no disco do palco (clip-path) e o conteúdo fica no lugar, só invisível.
 */
export function CartaoLista({
  topo,
  titulo,
  subtitulo,
  fase,
  validando,
  entrada,
  saindo = false,
  preparando = false,
  palco,
  children,
  etapa,
}: PropsCartaoLista) {
  const fechada = FASES_FECHADAS.includes(fase);
  const sob = FASES_SOB.includes(fase);
  // Como no F: a barra de etapas se recolhe enquanto o cartão dobra e o logo gira.
  useBarraRecolhida(validando && (fase === "fechando" || fase === "verificando"));
  return (
    <section
      data-identidade="aipro"
      data-etapa={etapa}
      data-entrada={entrada ?? undefined}
      data-validando={validando || undefined}
      aria-labelledby="lista-titulo"
      className={cx(
        s.secao,
        entrada === "espera" && s.espera,
        entrada === "nascendo" && s.nascendo,
        entrada === "desdobrando" && s.desdobrando,
        validando && s.validando,
        saindo && s.saindo,
      )}
    >
      <div className={s.paginaLista}>
        <header className={s.listaCab}>
          {topo}
          <h1 id="lista-titulo" tabIndex={-1} className={s.hPagina}>
            {titulo}
          </h1>
          <p className={s.corpo2}>{subtitulo}</p>
        </header>

        <div className={s.listaPalco}>
          <span id="disco-mira" className={s.discoMira} aria-hidden="true" />
          <span id="nasce-mira" className={s.nasceMira} aria-hidden="true" />
          <div className={s.listaSombra}>
            <div
              id="lista-cartao"
              tabIndex={-1}
              data-fase={fase}
              className={cx(
                s.lista,
                fechada && s.fechada,
                sob && s.sob,
                entrada === "desdobrando" && s.desdobrando,
                entrada === "espera" && s.espera,
                entrada === "nascendo" && s.nascendo,
              )}
            >
              <div className={s.listaIn} aria-hidden={fechada || undefined} inert={fechada || preparando || undefined}>
                {children}
              </div>
            </div>
          </div>
          {palco}
        </div>
      </div>
    </section>
  );
}

export interface ErroPalco {
  /** "Não conectou", "Chave recusada" */
  estado: string;
  titulo: string;
  texto: string;
  corrigirTexto: string;
  aoCorrigir: () => void;
  aoTentarDeNovo: () => void;
}

export interface PropsPalco {
  fase: Fase;
  faseAntes: Fase | null;
  logo: string;
  logoAlt: string;
  escura?: boolean | undefined;
  larga?: boolean | undefined;
  /** As 3 linhas de status e a ativa (0 a 3). */
  passos: readonly string[];
  passo: number;
  /** A cena FusaoJanete está rodando por cima (cérebro, depois do "Próximo"): o disco e o texto saem. */
  fusao?: boolean;
  /** O bloco do sucesso (cada etapa tem o seu texto). */
  ok: ReactNode;
  erro: ErroPalco | null;
  /** O passo do QR code (PassoQr variante "palco"), na fase "qr": o disco fica com o logo parado. */
  qr?: ReactNode;
}

/**
 * O palco da validação (E4): grande e no centro, sem cabeçalho em cima. O cartão vira o logo real,
 * a moeda gira, pousa reta e vira o check (ou o alerta). No cérebro, o check ainda vira a Janete.
 * O disco tem o id `val-disco` (de onde o símbolo sai para o despertar).
 */
export function PalcoValidacao({
  fase,
  faseAntes,
  logo,
  logoAlt,
  escura,
  larga,
  passos,
  passo,
  fusao = false,
  ok,
  erro,
  qr,
}: PropsPalco) {
  const sob = FASES_SOB.includes(fase);
  if (!sob && fase !== "fechando") return null;
  const vis: Fase = fase === "reabrindo" ? (faseAntes ?? "erro") : fase;
  const face = cx(s.face, escura && s.escura, larga && s.larga);
  return (
    <div
      className={s.val}
      data-fase={fase}
      data-vis={vis}
      data-gira={fase === "verificando" || undefined}
      data-reabrindo={fase === "reabrindo" || undefined}
      data-fusao={fusao || undefined}
    >
      <div className={s.valAncora}>
        <div id="val-disco" className={s.disco} data-testid="val-disco">
          <div className={s.moeda}>
            <div className={face}>
              <img src={logo} alt={logoAlt} />
            </div>
            <div className={cx(face, s.verso)} aria-hidden="true">
              <img src={logo} alt="" />
            </div>
          </div>
          <svg className={s.discoCheck} viewBox="0 0 112 112" aria-hidden="true">
            <path d="M37 57l13 13 26-28" />
          </svg>
          <svg className={s.discoAlerta} viewBox="0 0 112 112" aria-hidden="true">
            <path d="M56 36v26" />
            <circle cx="56" cy="76" r="4" />
          </svg>
        </div>
      </div>
      {/* durante a cena os botões do resultado somem e saem também do teclado */}
      <div className={s.valTexto} inert={fusao || undefined}>
        {fase === "verificando" && (
          <ol className={s.verif} aria-hidden="true">
            {passos.map((texto, i) => (
              <li
                key={texto}
                className={s.verifItem}
                data-estado={i < passo ? "feito" : i === passo ? "ativo" : "pendente"}
              >
                <span className={s.verifGlifo} />
                <span>{texto}</span>
              </li>
            ))}
          </ol>
        )}
        {vis === "ok" && ok}
        {vis === "qr" && qr}
        {vis === "erro" && erro && (
          <div className={cx(s.okBloco, s.erroBloco)}>
            <p className={cx(s.estadoLinha, s.sobe)} data-tom="erro">
              <Icone d={IC.triangulo} tamanho="p" />
              <span>{erro.estado}</span>
            </p>
            <h2 className={cx(s.hDestaque, s.sobe, s.d1)}>{erro.titulo}</h2>
            {erro.texto && <p className={cx(s.okSub, s.sobe, s.d2)}>{erro.texto}</p>}
            <div className={cx(s.okAcoes, s.sobe, s.d3)}>
              <Botao id="val-pri" onClick={erro.aoCorrigir}>
                {erro.corrigirTexto}
              </Botao>
              <Botao variante="contorno" onClick={erro.aoTentarDeNovo}>
                Tentar de novo
              </Botao>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Bloco do sucesso: estado, título, detalhe (em mono, salvo `mono={false}`), uma linha, o `extra`
 * opcional (a lista de vozes da etapa Voz) e as duas ações.
 */
export function BlocoOk({
  estado,
  titulo,
  detalhe,
  mono = true,
  linha,
  extra,
  acaoPrincipal,
  aoPrincipal,
  acaoSecundaria,
  aoSecundaria,
}: {
  estado: string;
  titulo: string;
  detalhe: ReactNode;
  /** O detalhe é um dado (o número do WhatsApp): mono. No cérebro é uma frase: texto comum. */
  mono?: boolean;
  linha: ReactNode;
  /** Um bloco entre a linha e as ações. Sem ele, nada muda. */
  extra?: ReactNode;
  acaoPrincipal: string;
  aoPrincipal: () => void;
  acaoSecundaria: string;
  aoSecundaria: () => void;
}) {
  return (
    <div className={s.okBloco}>
      <p className={cx(s.estadoLinha, s.sobe)} data-tom="ok">
        <Icone d={IC.ok} tamanho="p" />
        <span>{estado}</span>
      </p>
      <h2 className={cx(s.hDestaque, s.sobe, s.d1)}>{titulo}</h2>
      <p className={cx(mono ? s.okDetalhe : s.okSub, mono && s.mono, s.sobe, s.d2)}>{detalhe}</p>
      {linha}
      {extra}
      <div className={cx(s.okAcoes, s.sobe, s.d4)}>
        <Botao id="val-pri" tamanho="grande" onClick={aoPrincipal} iconeDepois={<Icone d={IC.seta} />}>
          {acaoPrincipal}
        </Botao>
        <Botao variante="discreto" onClick={aoSecundaria}>
          {acaoSecundaria}
        </Botao>
      </div>
    </div>
  );
}
