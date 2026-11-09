import { ArrowDown, ArrowDownRight, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";

import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { Esqueleto } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";

import {
  contagem,
  dias,
  DIAS_SEM_RESPOSTA,
  dinheiro,
  numero,
  porcentagem,
  tempoEtapa,
  type EtapaFunil,
  type Funil,
  type PainelDashboard,
} from "../../dados";
import { ETAPA_SAIRAM, proporcao } from "./apoio";
import { ComoContamos, SAIR_DA_DICA_MS } from "./comum";
import type { FaseB } from "./coreografia";
import { SoLeitor, TextoNumero } from "./pecas";
import estilos from "./Funil.module.css";

const s = estilos as Classes<
  | "dvbFpJanete"
  | "dvbFpChipFundo"
  | "dvbFpChipTrilho"
  | "dvbFpTitulo"
  | "dvbFpTitulo1"
  | "dvbFpH2"
  | "dvbFpTitulo2"
  | "dvbFpComo"
  | "dvbFpAncora"
  | "dvbFpDica"
  | "dvbDicaRolar"
  | "dvbDicaSeta"
  | "dvbFpColuna"
  | "dvbFpNome"
  | "dvbFpNumero"
  | "dvbFpN28"
  | "dvbFpN44"
  | "dvbFpN15"
  | "dvbFpConv"
  | "dvbFpBarra"
  | "dvbFpSegAinda"
  | "dvbFpSegPerdido"
  | "dvbFpSegSem"
  | "dvbFpPonte"
  | "dvbFpSeta"
  | "dvbFpQueda"
  | "dvbFpMetricas"
  | "dvbFpAlvo"
  | "dvbFpAlvoQueda"
  | "dvbFpDicaBalao"
  | "dvbFpPerdidosLista"
  | "dvbFpSairam"
  | "dvbFpVazio"
  | "dvbFaCabecalho"
  | "dvbFaTitulo"
  | "dvbFaAncora"
  | "dvbFaGrade"
  | "dvbFaColuna"
  | "dvbFaCabeca"
  | "dvbFaNome"
  | "dvbFaNumero"
  | "dvbFaConv"
  | "dvbFaArea"
  | "dvbFaBarra"
  | "dvbFaPonte"
  | "dvbFaQueda"
  | "dvbFaMetricas"
  | "dvbFaPergunte"
  | "dvbFaDica"
  | "dvbFaVazio"
  | "dvbFaPerdidos"
  | "dvbFlCabecalho"
  | "dvbFlLista"
  | "dvbFlEtapa"
  | "dvbFlTopo"
  | "dvbFlNome"
  | "dvbFlConv"
  | "dvbFlNumero"
  | "dvbFlFim"
  | "dvbFlBarra"
  | "dvbFlQueda"
  | "dvbQuedaNum"
  | "dvbQuedaLinha"
  | "dvbQuedaAmostra"
  | "dvbMetrica"
  | "dvbMetricaRotulo"
  | "dvbMetricaValor"
  | "dvbPergunte"
  | "dvbPergunteRotulo"
  | "dvbPergunteOpcoes"
  | "dvbPergunteOpcao"
  | "dvbResposta"
  | "dvbRespostaTexto"
  | "dvbSr"
>;

// O funil do período (spec 5.4 e 7). Três desenhos do mesmo conteúdo:
// - FunilPalco: o computador com movimento. Camadas soltas, todas em posição absoluta sobre as linhas
//   fixas do cartão aberto; as variáveis CSS do palco (escritas pelo motor a cada quadro) levam cada
//   camada do repouso ao aberto e do aberto à faixa do índice, só com transform, opacity e clip-path;
// - FunilAberto: o computador sem movimento (e o jsdom): o funil já expandido, em grade comum;
// - FunilLinhas: o celular, uma etapa por linha, com a barra deitada e a queda entre as linhas.
// Nada aqui calcula número: as proporções das barras são só desenho.

/* ---------- o modelo do desenho ---------- */

export interface ColunaFunil {
  i: number;
  etapa: EtapaFunil;
  anterior: EtapaFunil | null;
  proxima: EtapaFunil | null;
  /** A altura da barra: chegaram ÷ o maior (só desenho). */
  v: number;
  /** A altura da ponte até a próxima (a próxima barra), ou null na última. */
  vProx: number | null;
  /** As partes da barra (frações do que chegou): avançaram, ainda estão e os que saíram (perdidos e sem resposta). */
  fAvancaram: number;
  fAinda: number;
  fPerdido: number;
  fSem: number;
}

/** O desenho de quando não chegou nenhum lead: um funil fantasma, sem número. */
const FANTASMA = [1, 0.78, 0.56, 0.36, 0.2];

/** A altura do desenho da barra do Perdido (os perdidos sobre a maior etapa; só desenho). */
export function vDoPerdido(funil: Funil, vazio: boolean): number {
  const maior = funil.etapas.reduce((m, e) => Math.max(m, e.chegaram), 0);
  if (vazio || maior === 0) return 0.18;
  return Math.max(0.012, proporcao(funil.perdidos, maior));
}

export function montarColunas(funil: Funil, vazio: boolean): ColunaFunil[] {
  const maior = funil.etapas.reduce((m, e) => Math.max(m, e.chegaram), 0);
  const semDado = vazio || maior === 0;
  return funil.etapas.map((e, i) => {
    const v = semDado ? (FANTASMA[i] ?? 0.2) : Math.max(0.012, proporcao(e.chegaram, maior));
    const prox = funil.etapas[i + 1] ?? null;
    const vProx = prox ? (semDado ? (FANTASMA[i + 1] ?? 0.2) : Math.max(0.012, proporcao(prox.chegaram, maior))) : null;
    const base = e.chegaram > 0 ? e.chegaram : 1;
    return {
      i,
      etapa: e,
      anterior: funil.etapas[i - 1] ?? null,
      proxima: prox,
      v,
      vProx,
      fAvancaram: e.tipo === "ganho" ? 1 : proporcao(e.avancaram, base),
      fAinda: e.tipo === "ganho" ? 0 : proporcao(e.aindaEstao, base),
      fPerdido: e.tipo === "ganho" ? 0 : proporcao(e.abandonaram.perdido, base),
      fSem: e.tipo === "ganho" ? 0 : proporcao(e.abandonaram.semResposta, base),
    };
  });
}

/** A conversão a partir da etapa anterior (a da anterior para a próxima; só se reindexa). */
function conversaoDaAnterior(c: ColunaFunil): string {
  if (!c.anterior) return "entrada";
  return c.anterior.conversaoProxPct === null ? "" : porcentagem(c.anterior.conversaoProxPct);
}

/** A dica de uma etapa (spec 5.4): chegaram, conversão e abandono. */
function linhasDaDica(c: ColunaFunil, funil: Funil): string[] {
  const e = c.etapa;
  if (e.tipo === "ganho") {
    return [
      `${contagem(e.chegaram, "chegou", "chegaram")} ao Ganho`,
      funil.taxaGanhoPct !== null ? `${porcentagem(funil.taxaGanhoPct)} dos leads novos viraram venda` : "",
    ].filter(Boolean);
  }
  return [
    contagem(e.chegaram, "chegou", "chegaram"),
    c.proxima && e.conversaoProxPct !== null
      ? `${numero(e.avancaram)} ${e.avancaram === 1 ? "avançou" : "avançaram"} para ${c.proxima.nome} (${porcentagem(e.conversaoProxPct)})`
      : "",
    e.fraseQueda,
  ].filter(Boolean);
}

function rotuloDaEtapa(c: ColunaFunil): string {
  return `${c.etapa.nome}: ${contagem(c.etapa.chegaram, "chegou", "chegaram")}. Ver a etapa em detalhe`;
}

/** As métricas da etapa no funil aberto (spec 7.3, fase 2): conversão, tempo e custo (admin). */
function MetricasDaEtapa({ c, funil, admin }: { c: ColunaFunil; funil: Funil; admin: boolean }) {
  const e = c.etapa;
  const itens: { rotulo: string; valor: string }[] = [];
  if (e.tipo === "ganho") {
    itens.push({ rotulo: "Taxa de ganho", valor: funil.taxaGanhoPct === null ? "sem leads" : porcentagem(funil.taxaGanhoPct) });
    itens.push({ rotulo: "Ciclo até o ganho", valor: funil.cicloMedianoDias === null ? "sem vendas ainda" : dias(funil.cicloMedianoDias) });
  } else {
    itens.push({
      rotulo: "Avançaram",
      valor: e.conversaoProxPct === null ? numero(e.avancaram) : `${numero(e.avancaram)} · ${porcentagem(e.conversaoProxPct)}`,
    });
    itens.push({ rotulo: "Tempo na etapa", valor: e.tempoMedianoH === null ? "ninguém saiu ainda" : tempoEtapa(e.tempoMedianoH) });
  }
  if (admin && e.custoUsd !== undefined) itens.push({ rotulo: "Custo da Janete", valor: dinheiro(e.custoUsd) });
  return (
    <>
      {itens.map((it, k) => (
        <span key={it.rotulo} className={s.dvbMetrica} style={{ "--k": k } as CSSProperties}>
          <span className={s.dvbMetricaRotulo}>{it.rotulo}</span>
          <span className={s.dvbMetricaValor}>{it.valor}</span>
        </span>
      ))}
    </>
  );
}

/**
 * A queda depois da etapa, aberta: "31 saíram", "19 perdidos", "12 sem resposta" e "4 ainda estão",
 * cada parte com a amostra da cor dela na barra (a legenda do topo da barra, de cima para baixo).
 */
function QuedaAberta({ e }: { e: EtapaFunil }) {
  const { total, perdido, semResposta } = e.abandonaram;
  if (e.tipo === "ganho") return null;
  const ainda = e.aindaEstao ? (
    <span className={s.dvbQuedaLinha}>
      <span className={s.dvbQuedaAmostra} data-tom="ainda" aria-hidden="true" />
      {numero(e.aindaEstao)} ainda {e.aindaEstao === 1 ? "está" : "estão"}
    </span>
  ) : null;
  if (!total) {
    return (
      <>
        <span className={s.dvbQuedaLinha}>
          <span className={s.dvbQuedaNum}>Ninguém saiu</span>
        </span>
        {ainda}
      </>
    );
  }
  return (
    <>
      <span className={s.dvbQuedaLinha}>
        <span className={s.dvbQuedaNum}>{total === 1 ? "1 saiu" : `${numero(total)} saíram`}</span>
      </span>
      {perdido ? (
        <span className={s.dvbQuedaLinha}>
          <span className={s.dvbQuedaAmostra} data-tom="perdido" aria-hidden="true" />
          {contagem(perdido, "perdido", "perdidos")}
        </span>
      ) : null}
      {semResposta ? (
        <span className={s.dvbQuedaLinha}>
          <span className={s.dvbQuedaAmostra} data-tom="sem" aria-hidden="true" />
          {numero(semResposta)} sem resposta
        </span>
      ) : null}
      {ainda}
    </>
  );
}

/** As partes do topo da barra (fase 2 no palco; sempre no funil aberto): perdidos, sem resposta e ainda estão. */
function PartesDaBarra() {
  return (
    <>
      <span className={s.dvbFpSegAinda} />
      <span className={s.dvbFpSegPerdido} />
      <span className={s.dvbFpSegSem} />
    </>
  );
}

/** As variáveis das partes da barra. */
const VARIAVEIS_BARRA = (c: ColunaFunil): CSSProperties =>
  ({ "--v": c.v, "--vav": c.fAvancaram, "--vainda": c.fAinda, "--vperd": c.fPerdido, "--vsem": c.fSem }) as CSSProperties;

/** De onde saíram os perdidos (a coluna do Perdido, aberta): as 4 etapas, com a barrinha de cada uma. */
function ListaDosPerdidos({ funil }: { funil: Funil }) {
  const maior = funil.perdidosPorOrigem.reduce((m, p) => Math.max(m, p.perdido), 0);
  return (
    <span className={s.dvbFpPerdidosLista}>
      {funil.perdidosPorOrigem.map((o, k) => (
        <span key={o.etapaId} style={{ "--dvb-v": proporcao(o.perdido, maior), "--k": k } as CSSProperties}>
          <span>{o.nome}</span>
          <b>{numero(o.perdido)}</b>
        </span>
      ))}
    </span>
  );
}

/** A definição do funil no "como contamos" (o prazo do "sem resposta" vem da fundação). */
function ComoContamosFunil() {
  return (
    <>
      Pela coorte: os leads cuja 1ª mensagem caiu no período. Chegaram: passaram pela etapa ou por uma depois dela, sem contar
      Perdido. Saíram: foram para Perdido saindo da etapa, ou estão parados nela há mais de {DIAS_SEM_RESPOSTA} dias sem responder.
    </>
  );
}

/* ---------- o "Pergunte à Janete" ---------- */

/**
 * O "Pergunte à Janete" (spec 5.4): 3 perguntas sugeridas; ao escolher, a resposta montada pela fundação
 * a partir dos números aparece numa nota quieta (sem balão nem digitação). Com `titulo`, o rótulo vira
 * o h2 de um bloco próprio (o do fim dos capítulos, no palco). A região que anuncia a resposta fica
 * sempre na árvore (vazia e sem caixa enquanto não há resposta), para o leitor de tela anunciar.
 */
export function Pergunte({
  perguntas,
  className,
  titulo = false,
}: {
  perguntas: Funil["perguntas"];
  className?: string | undefined;
  titulo?: boolean | undefined;
}) {
  const [aberta, setAberta] = useState<number | null>(null);
  const base = useId();
  const resposta = aberta === null ? null : perguntas[aberta];
  const Rotulo = titulo ? "h2" : "p";
  return (
    <div className={cx(s.dvbPergunte, className)} data-titulo={titulo || undefined}>
      <Rotulo className={s.dvbPergunteRotulo} id={`${base}-rotulo`}>
        <JaneteSimbolo decorativo estado="acordada" tamanho={titulo ? 18 : 14} />
        Pergunte à Janete sobre o funil
      </Rotulo>
      <div className={s.dvbPergunteOpcoes} role="group" aria-labelledby={`${base}-rotulo`}>
        {perguntas.map((q, i) => (
          <button
            key={q.pergunta}
            type="button"
            className={s.dvbPergunteOpcao}
            aria-expanded={aberta === i}
            aria-controls={`${base}-resposta`}
            onClick={() => setAberta((a) => (a === i ? null : i))}
          >
            {q.pergunta}
          </button>
        ))}
      </div>
      <div id={`${base}-resposta`} className={s.dvbResposta} aria-live="polite">
        {resposta ? (
          <p className={s.dvbRespostaTexto}>
            <SoLeitor>A Janete responde: </SoLeitor>
            {resposta.resposta}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- o convite a rolar ---------- */

/**
 * "Role para ver cada etapa" (ajuste 4 do equipe): uma pílula com a seta que desce devagar (parada com o
 * movimento reduzido). É só um convite visual: o leitor de tela já lê os capítulos em sequência.
 */
export function DicaDeRolar({ className }: { className?: string | undefined }) {
  return (
    <p className={cx(s.dvbDicaRolar, className)} data-dash="dica-rolar" aria-hidden="true">
      <span>Role para ver cada etapa</span>
      <ArrowDown size={14} strokeWidth={2.4} className={s.dvbDicaSeta} />
    </p>
  );
}

/* ---------- o funil do palco (computador com movimento) ---------- */

type Foco = { tipo: "etapa" | "queda" | "perdidos"; i: number } | null;

export interface PropsFunil {
  painel: PainelDashboard;
  colunas: ColunaFunil[];
  carregando: boolean;
  idTitulo: string;
  aoIr: (etapa: string) => void;
}

/** Enquanto a vista rola, o hover não conta: o funil passa embaixo de um cursor parado. */
function rolando(ev: MouseEvent<HTMLElement>): boolean {
  return !!ev.currentTarget.closest("[data-rolando]");
}

/** O fundo dos chips e o "Para onde foram os que saíram" (desenhados aqui, embaixo do texto, na fase 3). */
function FundosDosChips() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={s.dvbFpChipFundo} data-sairam={i === 5 || undefined} style={{ "--i": i } as CSSProperties} aria-hidden="true">
          {i < 5 ? <span className={s.dvbFpChipTrilho} /> : null}
        </span>
      ))}
    </>
  );
}

/** A coluna na faixa da final: as 3 primeiras ficam antes da Janete, as 3 últimas depois dela. */
export const DEPOIS_DA_JANETE = 3;

const VARIAVEIS_COLUNA = (i: number): CSSProperties =>
  ({
    "--i": i,
    "--depois": i >= DEPOIS_DA_JANETE ? 1 : 0,
    "--b": `var(--b${i})`,
    "--n": `var(--n${i})`,
    "--m": `var(--m${i})`,
    "--q": `var(--q${i})`,
    "--d": `var(--d${i})`,
    "--bp": `var(--b${Math.min(5, i + 1)})`,
  }) as CSSProperties;

export function FunilPalco({ painel, colunas, carregando, idTitulo, aoIr, fase }: PropsFunil & { fase: FaseB }) {
  const { funil, periodo } = painel;
  const admin = painel.papel === "admin";
  const vazio = painel.vazio || funil.leadsNovos === 0;
  const [foco, setFoco] = useState<Foco>(null);
  const vPerdidos = vDoPerdido(funil, vazio);
  const saida = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelarSaida = () => {
    if (saida.current) clearTimeout(saida.current);
    saida.current = null;
  };
  const sairDoFoco = () => {
    cancelarSaida();
    setFoco(null);
  };
  // O ponteiro saiu: a dica espera um pouco (dá para levar o ponteiro até ela, critério 1.4.13).
  const sairDepois = () => {
    cancelarSaida();
    saida.current = setTimeout(() => setFoco(null), SAIR_DA_DICA_MS);
  };
  const entrar = (f: NonNullable<Foco>) => (ev: MouseEvent<HTMLElement>) => {
    if (rolando(ev)) return;
    cancelarSaida();
    setFoco(f);
  };
  // A dica é do funil aberto: ao virar índice, o foco das colunas solta (nada de dica ou recuo presos).
  const emJogo = fase === "repouso" || fase === "crescer" || fase === "abrir";
  useEffect(() => {
    if (!emJogo) setFoco(null);
  }, [emJogo]);
  // A dica aberta pelo mouse também fecha com Esc (WCAG 1.4.13): o Esc é ouvido no documento.
  const temFoco = foco !== null;
  useEffect(() => {
    if (!temFoco || typeof document === "undefined") return;
    const aoTecla = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (saida.current) clearTimeout(saida.current);
      saida.current = null;
      setFoco(null);
    };
    document.addEventListener("keydown", aoTecla);
    return () => document.removeEventListener("keydown", aoTecla);
  }, [temFoco]);
  useEffect(
    () => () => {
      if (saida.current) clearTimeout(saida.current);
    },
    [],
  );
  const manterDica = { onMouseEnter: cancelarSaida, onMouseLeave: sairDepois };

  return (
    <div
      className={s.dvbFpColuna}
      data-foco={foco ? `${foco.tipo}-${foco.i}` : undefined}
      data-carregando={carregando || undefined}
      data-vazio={vazio || undefined}
      style={{ display: "contents" }}
    >
      <FundosDosChips />

      {/* a Janete no centro da faixa (o desenho; o botão de verdade é o da faixa real, na troca) */}
      {vazio ? null : (
        <span className={s.dvbFpJanete} aria-hidden="true">
          <JaneteSimbolo decorativo estado={painel.estadoJanete} tamanho={40} />
        </span>
      )}

      {/* o título e a âncora numa linha só ("Funil do período · dos 190 leads..."); na fase 2 os dois
          saem juntos e entra "O funil, etapa por etapa" */}
      <div className={s.dvbFpTitulo}>
        <div className={s.dvbFpTitulo1}>
          <h2 id={idTitulo} className={s.dvbFpH2}>
            Funil do período
          </h2>
          <p className={s.dvbFpAncora}>
            {carregando ? (
              <Esqueleto forma="texto" largura="12rem" />
            ) : vazio ? (
              `nenhum lead chegou ${periodo.rotulo}`
            ) : (
              `dos ${numero(funil.leadsNovos)} leads que chegaram ${periodo.rotulo}`
            )}
          </p>
        </div>
        <span className={s.dvbFpTitulo2} aria-hidden="true">
          O funil, etapa por etapa
        </span>
      </div>
      <div className={s.dvbFpComo}>
        <ComoContamos titulo="Funil do período" abaixo>
          <ComoContamosFunil />
        </ComoContamos>
      </div>
      {/* o convite a rolar (ajuste 4): uma pílula no pé do cartão (ou logo embaixo dele, ou no fim da
          tela na dobra), com a seta descendo devagar; some quando a faixa começa a se formar */}
      {vazio ? null : <DicaDeRolar className={s.dvbFpDica} />}

      {colunas.map((c) => {
        const e = c.etapa;
        const conv = conversaoDaAnterior(c);
        const idDica = `dvb-fp-dica-${c.i}`;
        const idDicaQueda = `dvb-fp-queda-${c.i}`;
        const ganho = e.tipo === "ganho";
        return (
          <div key={e.etapaId} style={{ display: "contents", ...VARIAVEIS_COLUNA(c.i) }}>
            <span className={s.dvbFpNome} aria-hidden="true">
              {e.nome}
            </span>
            <span className={s.dvbFpNumero} aria-hidden="true">
              {carregando ? (
                <Esqueleto forma="bloco" largura={64} altura={28} raio="mini" />
              ) : vazio ? null : (
                <>
                  <TextoNumero texto={numero(e.chegaram)} className={s.dvbFpN28} />
                  <TextoNumero texto={numero(e.chegaram)} className={s.dvbFpN44} />
                  <TextoNumero texto={numero(e.chegaram)} className={s.dvbFpN15} />
                </>
              )}
            </span>
            <span className={s.dvbFpConv} aria-hidden="true" data-primeira={!c.anterior || undefined}>
              {carregando || vazio ? "" : conv}
            </span>
            <span
              className={s.dvbFpBarra}
              data-ganho={ganho || undefined}
              data-col={c.i}
              aria-hidden="true"
              style={VARIAVEIS_BARRA(c)}
            >
              {!ganho && !vazio ? <PartesDaBarra /> : null}
            </span>
            {c.vProx !== null ? (
              <>
                <span className={s.dvbFpPonte} aria-hidden="true" style={{ "--vp": c.vProx } as CSSProperties} />
                {c.i === DEPOIS_DA_JANETE - 1 ? null : (
                  <span className={s.dvbFpSeta} aria-hidden="true">
                    <ChevronRight size={16} strokeWidth={2.2} />
                  </span>
                )}
                <span className={s.dvbFpQueda} aria-hidden="true">
                  {carregando || vazio ? null : <QuedaAberta e={e} />}
                </span>
              </>
            ) : null}
            <span className={s.dvbFpMetricas} aria-hidden="true">
              {carregando || vazio ? null : <MetricasDaEtapa c={c} funil={funil} admin={admin} />}
            </span>

            <button
              type="button"
              className={s.dvbFpAlvo}
              aria-label={rotuloDaEtapa(c)}
              aria-describedby={idDica}
              onMouseEnter={entrar({ tipo: "etapa", i: c.i })}
              onMouseLeave={sairDepois}
              onFocus={() => setFoco({ tipo: "etapa", i: c.i })}
              onBlur={sairDoFoco}
              onKeyDown={(ev) => {
                if (ev.key === "Escape") setFoco(null);
              }}
              onClick={() => aoIr(e.etapaId)}
            />
            <span
              id={idDica}
              role="tooltip"
              className={s.dvbFpDicaBalao}
              data-tipo="etapa"
              hidden={!(foco?.tipo === "etapa" && foco.i === c.i)}
              {...manterDica}
            >
              {linhasDaDica(c, funil).map((l, k) => (
                <span key={k}>{l}</span>
              ))}
            </span>

            {c.vProx !== null && !ganho ? (
              <>
                <button
                  type="button"
                  className={s.dvbFpAlvoQueda}
                  style={{ "--vp": c.vProx } as CSSProperties}
                  aria-label={`Entre ${e.nome} e ${c.proxima?.nome ?? "a próxima etapa"}: ${e.fraseQueda}. Ver para onde foram os que saíram`}
                  aria-describedby={idDicaQueda}
                  onMouseEnter={entrar({ tipo: "queda", i: c.i })}
                  onMouseLeave={sairDepois}
                  onFocus={() => setFoco({ tipo: "queda", i: c.i })}
                  onBlur={sairDoFoco}
                  onKeyDown={(ev) => {
                    if (ev.key === "Escape") setFoco(null);
                  }}
                  onClick={() => aoIr(ETAPA_SAIRAM)}
                />
                <span
                  id={idDicaQueda}
                  role="tooltip"
                  className={s.dvbFpDicaBalao}
                  data-tipo="queda"
                  style={{ "--vp": c.vProx } as CSSProperties}
                  hidden={!(foco?.tipo === "queda" && foco.i === c.i)}
                  {...manterDica}
                >
                  <span>{e.fraseQueda}</span>
                </span>
              </>
            ) : null}
          </div>
        );
      })}

      {/* A coluna do Perdido: o destino de quem sai (como a "entrada" do Novo, aqui é a "saída"); na
          faixa do índice, vira "Para onde foram os que saíram", no mesmo lugar. */}
      <div style={{ display: "contents", ...VARIAVEIS_COLUNA(5) }} data-perdidos="">
        <span className={s.dvbFpNome} data-perdidos="" aria-hidden="true">
          Perdido
        </span>
        <span className={s.dvbFpNumero} data-perdidos="" aria-hidden="true">
          {carregando ? (
            <Esqueleto forma="bloco" largura={48} altura={28} raio="mini" />
          ) : vazio ? null : (
            <>
              <TextoNumero texto={numero(funil.perdidos)} className={s.dvbFpN28} />
              <TextoNumero texto={numero(funil.perdidos)} className={s.dvbFpN44} />
            </>
          )}
        </span>
        <span className={s.dvbFpConv} data-perdidos="" aria-hidden="true">
          {carregando || vazio ? "" : "saída"}
        </span>
        <span className={s.dvbFpBarra} data-perdidos="" data-col={5} aria-hidden="true" style={{ "--v": vPerdidos } as CSSProperties} />
        <span className={s.dvbFpMetricas} data-perdidos="" aria-hidden="true">
          {carregando || vazio ? null : <ListaDosPerdidos funil={funil} />}
        </span>
        <button
          type="button"
          className={s.dvbFpAlvo}
          data-perdidos=""
          aria-label={`Perdido: ${contagem(funil.perdidos, "lead foi", "leads foram")} para Perdido. Ver para onde foram os que saíram`}
          aria-describedby="dvb-fp-dica-perdidos"
          onMouseEnter={entrar({ tipo: "perdidos", i: 5 })}
          onMouseLeave={sairDepois}
          onFocus={() => setFoco({ tipo: "perdidos", i: 5 })}
          onBlur={sairDoFoco}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") setFoco(null);
          }}
          onClick={() => aoIr(ETAPA_SAIRAM)}
        />
        <span
          id="dvb-fp-dica-perdidos"
          role="tooltip"
          className={s.dvbFpDicaBalao}
          data-tipo="perdidos"
          hidden={foco?.tipo !== "perdidos"}
          {...manterDica}
        >
          <span>{funil.fraseSaidas}</span>
        </span>
        <span className={s.dvbFpSairam} aria-hidden="true">
          Para onde foram
          <br />
          os que saíram
        </span>
      </div>

      {vazio && !carregando ? <p className={s.dvbFpVazio}>Nenhum lead chegou neste período</p> : null}
    </div>
  );
}

/* ---------- o funil aberto (computador sem movimento, e o jsdom) ---------- */

export function FunilAberto({ painel, colunas, carregando, idTitulo, aoIr }: PropsFunil) {
  const { funil, periodo } = painel;
  const admin = painel.papel === "admin";
  const vazio = painel.vazio || funil.leadsNovos === 0;
  return (
    <>
      <header className={s.dvbFaCabecalho}>
        <div>
          <h2 id={idTitulo} className={s.dvbFaTitulo}>
            Funil do período
          </h2>
          <p className={s.dvbFaAncora}>
            {carregando
              ? "carregando o período"
              : vazio
                ? `nenhum lead chegou ${periodo.rotulo}`
                : `dos ${numero(funil.leadsNovos)} leads que chegaram ${periodo.rotulo}`}
          </p>
        </div>
        <ComoContamos titulo="Funil do período">
          <ComoContamosFunil />
        </ComoContamos>
      </header>
      <ol className={s.dvbFaGrade} data-vazio={vazio || undefined} data-carregando={carregando || undefined}>
        {colunas.map((c) => {
          const e = c.etapa;
          return (
            <li key={e.etapaId} className={s.dvbFaColuna} data-etapa={e.etapaId}>
              <button type="button" className={s.dvbFaCabeca} aria-label={rotuloDaEtapa(c)} onClick={() => aoIr(e.etapaId)}>
                <span className={s.dvbFaNome}>{e.nome}</span>
                {carregando ? (
                  <Esqueleto forma="bloco" largura={72} altura={36} raio="mini" />
                ) : vazio ? null : (
                  <TextoNumero texto={numero(e.chegaram)} className={s.dvbFaNumero} />
                )}
                <span className={s.dvbFaConv}>{carregando || vazio ? "" : conversaoDaAnterior(c)}</span>
              </button>
              <span className={s.dvbFaArea} aria-hidden="true">
                <span className={s.dvbFaBarra} data-ganho={e.tipo === "ganho" || undefined} style={VARIAVEIS_BARRA(c)}>
                  {e.tipo !== "ganho" && !vazio ? <PartesDaBarra /> : null}
                </span>
                {c.vProx !== null ? <span className={s.dvbFaPonte} style={{ "--vp": c.vProx } as CSSProperties} /> : null}
              </span>
              <span className={s.dvbFaQueda}>{carregando || vazio ? null : <QuedaAberta e={e} />}</span>
              <span className={s.dvbFaMetricas}>{carregando || vazio ? null : <MetricasDaEtapa c={c} funil={funil} admin={admin} />}</span>
            </li>
          );
        })}
        {/* A coluna do Perdido, como no palco: o destino de quem sai, no cinza claro hachurado. */}
        <li className={s.dvbFaColuna} data-perdidos="">
          <button
            type="button"
            className={s.dvbFaCabeca}
            aria-label={`Perdido: ${contagem(funil.perdidos, "lead foi", "leads foram")} para Perdido. Ver para onde foram os que saíram`}
            onClick={() => aoIr(ETAPA_SAIRAM)}
          >
            <span className={s.dvbFaNome}>Perdido</span>
            {carregando ? (
              <Esqueleto forma="bloco" largura={56} altura={36} raio="mini" />
            ) : vazio ? null : (
              <TextoNumero texto={numero(funil.perdidos)} className={s.dvbFaNumero} />
            )}
            <span className={s.dvbFaConv}>{carregando || vazio ? "" : "saída"}</span>
          </button>
          <span className={s.dvbFaArea} aria-hidden="true">
            <span className={s.dvbFaBarra} data-perdidos="" style={{ "--v": vDoPerdido(funil, vazio) } as CSSProperties} />
          </span>
          <span className={s.dvbFaPerdidos}>{carregando || vazio ? null : <ListaDosPerdidos funil={funil} />}</span>
        </li>
      </ol>
      {vazio && !carregando ? <p className={s.dvbFaVazio}>Nenhum lead chegou neste período</p> : null}
      {/* no período vazio, as 3 perguntas só responderiam que não há o que responder */}
      {vazio ? null : <Pergunte perguntas={funil.perguntas} className={s.dvbFaPergunte} />}
      {/* sem palco (movimento reduzido, janela média): o mesmo convite, centralizado no pé do cartão,
          logo acima da faixa das etapas */}
      {vazio ? null : <DicaDeRolar className={s.dvbFaDica} />}
    </>
  );
}

/* ---------- o funil do celular ---------- */

export function FunilLinhas({ painel, colunas, carregando, idTitulo, aoIr }: PropsFunil) {
  const { funil, periodo } = painel;
  const vazio = painel.vazio || funil.leadsNovos === 0;
  return (
    <>
      <header className={s.dvbFlCabecalho}>
        <div>
          <h2 id={idTitulo} className={s.dvbFaTitulo}>
            Funil do período
          </h2>
          <p className={s.dvbFaAncora}>
            {carregando ? "carregando o período" : vazio ? `nenhum lead chegou ${periodo.rotulo}` : `dos ${numero(funil.leadsNovos)} leads que chegaram ${periodo.rotulo}`}
          </p>
        </div>
      </header>
      <ol className={s.dvbFlLista} data-vazio={vazio || undefined}>
        {colunas.map((c) => {
          const e = c.etapa;
          return (
            <Fragment key={e.etapaId}>
              <li className={s.dvbFlEtapa} data-ganho={e.tipo === "ganho" || undefined}>
                <button type="button" className={s.dvbFlTopo} aria-label={rotuloDaEtapa(c)} onClick={() => aoIr(e.etapaId)}>
                  <span className={s.dvbFlNome}>{e.nome}</span>
                  <span className={s.dvbFlFim}>
                    {carregando ? (
                      <Esqueleto forma="bloco" largura={44} altura={22} raio="mini" />
                    ) : vazio ? null : (
                      <TextoNumero texto={numero(e.chegaram)} className={s.dvbFlNumero} />
                    )}
                    {/* a conversão depois do número, com a seta (no Novo, nada: ele é a entrada) */}
                    {carregando || vazio || !c.anterior || !conversaoDaAnterior(c) ? null : (
                      <span className={s.dvbFlConv}>{conversaoDaAnterior(c)}</span>
                    )}
                  </span>
                </button>
                <span className={s.dvbFlBarra} aria-hidden="true" style={{ "--dvb-v": c.v } as CSSProperties}>
                  <span />
                </span>
                {c.vProx !== null && !carregando && !vazio ? (
                  <p className={s.dvbFlQueda}>
                    <ArrowDownRight size={14} strokeWidth={2.2} aria-hidden="true" />
                    {e.fraseQueda}
                  </p>
                ) : null}
              </li>
            </Fragment>
          );
        })}
      </ol>
      {vazio && !carregando ? <p className={s.dvbFaVazio}>Nenhum lead chegou neste período</p> : null}
      {vazio ? null : <Pergunte perguntas={funil.perguntas} className={s.dvbFaPergunte} />}
    </>
  );
}

/** A tabela escondida com os números do funil (o texto alternativo do gráfico, spec 12). */
export function TabelaDoFunil({ funil, vazio, carregando }: { funil: Funil; vazio: boolean; carregando: boolean }): ReactNode {
  // carregando, a tela mostra esqueletos: o leitor de tela também não lê os números ainda
  if (vazio || carregando) return null;
  // A classe de "só para o leitor" vai num bloco em volta: numa tabela, width: 1px é só o mínimo e o
  // overflow não corta, e as frases longas alargavam a página inteira no celular.
  return (
    <div className={s.dvbSr}>
      <table>
        <caption>Funil do período, por etapa</caption>
        <thead>
          <tr>
            <th scope="col">Etapa</th>
            <th scope="col">Chegaram</th>
            <th scope="col">Avançaram</th>
            <th scope="col">Conversão para a próxima</th>
            <th scope="col">Ainda estão</th>
            <th scope="col">Saíram</th>
          </tr>
        </thead>
        <tbody>
          {funil.etapas.map((e) => (
            <tr key={e.etapaId}>
              <th scope="row">{e.nome}</th>
              <td>{numero(e.chegaram)}</td>
              <td>{e.tipo === "ganho" ? "não se aplica" : numero(e.avancaram)}</td>
              <td>{e.conversaoProxPct === null ? "não se aplica" : porcentagem(e.conversaoProxPct)}</td>
              <td>{numero(e.aindaEstao)}</td>
              <td>{e.tipo === "ganho" ? "não se aplica" : e.fraseQueda}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
