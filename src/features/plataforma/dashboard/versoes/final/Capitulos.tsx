import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight } from "lucide-react";
import { memo, type CSSProperties, type ReactNode } from "react";

import { Esqueleto } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";

import { AvatarLead } from "../../../comum/AvatarLead";
import {
  DIAS_SEM_RESPOSTA,
  contagem,
  dias,
  dinheiro,
  duracaoCurta,
  numero,
  porcentagem,
  tempoEtapa,
  usePainelDashboard,
  type Agora,
  type EtapaFunil,
  type IdPeriodo,
  type PainelDashboard,
} from "../../dados";
import { ETAPA_SAIRAM, idCapitulo, idTituloCapitulo, plural } from "./apoio";
import { Pergunte } from "./Funil";
import { BarraDividida, BarrasDia } from "./Graficos";
import { ComUnidade } from "./Unidade";
import estilos from "./Capitulos.module.css";

const s = estilos as Classes<
  | "detalhe"
  | "detalheTitulo"
  | "capitulo"
  | "capCab"
  | "capTitulo"
  | "capSep"
  | "capFrase"
  | "capSelo"
  | "capGrade"
  | "bloco"
  | "blocoFluxo"
  | "blocoAgora"
  | "blocoNumeros"
  | "blocoSaidas"
  | "blocoRotulo"
  | "grande"
  | "grandeUnidade"
  | "apoio"
  | "faixa"
  | "faixaBarra"
  | "faixaTrilho"
  | "faixaPonta"
  | "legenda"
  | "celulas"
  | "celula"
  | "entradas"
  | "lista"
  | "listaNome"
  | "listaTempo"
  | "listaVazia"
  | "listaContexto"
  | "link"
  | "saidas"
  | "saida"
  | "saidaNome"
  | "saidaBarras"
  | "saidaNumeros"
  | "ossoCab"
  | "ossoGrade"
  | "moveu"
  | "pergunteFim"
  | "semLeads"
  | "semLeadsTitulo"
  | "semLeadsTexto"
  | "semLeadsAcoes"
  | "semLeadsBotao"
  | "sr"
>;

// O detalhamento da versão final (spec 8 e a mudança 4 da final): um capítulo por etapa, na ordem do
// funil, mais "Para onde foram os que saíram".
// - O cabeçalho é o da D: o nome e o número juntos ("Novo · 190 leads chegaram") e a frase de leitura
//   da fundação embaixo.
// - O corpo é o da A: o cartão grande do Fluxo (o número, a barra empilhada de avançaram, ainda
//   estão, perdidos e sem resposta, e as entradas por dia), o "Agora nesta etapa" ao lado e a faixa de
//   números embaixo. Os blocos alternam de lado de um capítulo para o outro.
// Nenhum número é calculado: as larguras só desenham.

/** Abaixo desta fração da barra, o número não cabe no pedaço: ele fica só na legenda (nunca cortado). */
const FRACAO_COM_NUMERO = 0.08;

/** O cabeçalho da D: o nome, "· N leads chegaram" mais leve (quando há), e a frase da fundação. */
function Cabecalho({ id, nome, quantos, frase, children }: { id: string; nome: string; quantos?: string | undefined; frase: string; children?: ReactNode }) {
  return (
    <header className={s.capCab}>
      <h2 id={id} className={s.capTitulo} tabIndex={-1}>
        {nome}
        {quantos ? (
          <>
            {" "}
            <em>
              <span className={s.capSep} aria-hidden="true">
                ·{" "}
              </span>
              {quantos}
            </em>
          </>
        ) : null}
      </h2>
      <p className={s.capFrase}>{frase}</p>
      {children}
    </header>
  );
}

/** A lista do "No Kanban agora": o nome e, pequeno, há quanto tempo (embaixo do nome na coluna estreita). */
function ListaAgora({ leads, prefixo }: { leads: Agora["porEtapa"][number]["leads"]; prefixo: string }) {
  return (
    <ul className={s.lista}>
      {leads.map((l) => (
        <li key={l.contatoId}>
          <AvatarLead nome={l.nome} chave={l.contatoId} tamanho="p" />
          <span className={s.listaNome}>{l.nome}</span>
          <span className={s.listaTempo}>
            <span className={s.sr}>{prefixo}</span>
            {duracaoCurta(l.desdeMin * 60)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Um bloco do capítulo: o h3 basta (div, e não section, para não encher a lista de regiões do leitor). */
function Bloco({ classe, rotulo, children }: { classe: string; rotulo: string; children: ReactNode }) {
  return (
    <div className={cx(s.bloco, classe)}>
      <h3 className={s.blocoRotulo}>{rotulo}</h3>
      {children}
    </div>
  );
}

function Capitulo({
  etapa: e,
  k,
  proxima,
  painel,
}: {
  etapa: EtapaFunil;
  k: number;
  proxima: EtapaFunil | undefined;
  painel: PainelDashboard;
}) {
  const ganho = e.tipo === "ganho";
  const admin = painel.papel === "admin";
  const { funil, agora } = painel;
  const agoraAqui = agora.porEtapa.find((x) => x.etapaId === e.etapaId);
  const kanbanAqui = agora.kanban.find((x) => x.etapaId === e.etapaId);
  const direita = k % 2 === 1;

  const partes = [
    { chave: "avancaram", texto: `${numero(e.avancaram)} avançaram`, valor: e.avancaram, tom: "forte" as const },
    // "do período": a coorte; o bloco ao lado é a foto do Kanban agora (duas fotos, dois números)
    { chave: "ainda", texto: `${numero(e.aindaEstao)} do período ainda aqui`, valor: e.aindaEstao, tom: "claro" as const },
    { chave: "perdido", texto: plural(e.abandonaram.perdido, "perdido", "perdidos", numero), valor: e.abandonaram.perdido, tom: "hachura" as const },
    { chave: "sem", texto: `${numero(e.abandonaram.semResposta)} sem resposta há +${DIAS_SEM_RESPOSTA} dias`, valor: e.abandonaram.semResposta, tom: "hachuraClara" as const },
  ];
  const descricaoFaixa = ganho
    ? `${plural(e.chegaram, "venda", "vendas", numero)} de ${plural(funil.leadsNovos, "lead que chegou", "leads que chegaram", numero)}.`
    : `${e.nome}: ${numero(e.chegaram)} chegaram. ${partes.map((p) => p.texto).join(", ")}.`;
  const base = Math.max(1, e.chegaram);
  // só desenho: a largura da barra das vendas sobre os leads que chegaram
  const larguraGanho = funil.leadsNovos > 0 ? Math.min(1, e.chegaram / funil.leadsNovos) : 0;

  const celulas: { rotulo: string; valor: string; apoio?: string }[] = [];
  if (ganho) {
    celulas.push({ rotulo: "Ciclo até o ganho", valor: funil.cicloMedianoDias !== null ? dias(funil.cicloMedianoDias) : "sem vendas", apoio: "mediana do 1º contato até o Ganho" });
  } else {
    celulas.push({ rotulo: "Tempo na etapa", valor: e.tempoMedianoH !== null ? tempoEtapa(e.tempoMedianoH) : "ninguém saiu", apoio: "mediana de quem já saiu" });
    if (agoraAqui) celulas.push({ rotulo: `Parados +${DIAS_SEM_RESPOSTA} dias`, valor: numero(agoraAqui.paradosMais7d), apoio: "agora, sem responder" });
  }
  celulas.push({ rotulo: "Recebidas", valor: numero(e.mensagens.recebidas), apoio: "mensagens do lead" });
  celulas.push({ rotulo: "Enviadas", valor: numero(e.mensagens.enviadas), apoio: "para o lead" });
  celulas.push({ rotulo: "Para a equipe", valor: numero(e.passadosParaEquipe), apoio: "conversas passadas" });
  if (admin && e.custoUsd !== undefined) celulas.push({ rotulo: "Custo da Janete", valor: dinheiro(e.custoUsd), apoio: "nas respostas" });

  return (
    <section
      id={idCapitulo(e.etapaId)}
      data-dash="capitulo"
      data-etapa={e.etapaId}
      data-lado={direita ? "direita" : "esquerda"}
      data-ganho={ganho || undefined}
      className={s.capitulo}
      aria-labelledby={idTituloCapitulo(e.etapaId)}
    >
      <Cabecalho id={idTituloCapitulo(e.etapaId)} nome={e.nome} quantos={contagem(e.chegaram, "lead chegou", "leads chegaram")} frase={e.frase}>
        {e.janetePodeMover ? (
          <p className={s.capSelo}>
            <i aria-hidden="true" />A Janete pode mover para cá
          </p>
        ) : null}
      </Cabecalho>

      <div className={s.capGrade}>
        <Bloco classe={s.blocoFluxo} rotulo={ganho ? "Vendas" : "Fluxo"}>
          <p className={s.grande}>
            {numero(e.chegaram)}
            <span className={s.grandeUnidade}>{ganho ? (e.chegaram === 1 ? "venda" : "vendas") : e.chegaram === 1 ? "chegou" : "chegaram"}</span>
          </p>
          {ganho ? (
            <div className={s.faixa} role="img" aria-label={descricaoFaixa}>
              <div className={s.faixaTrilho}>
                <span data-tom="ganho" style={{ width: `${larguraGanho * 100}%` }} />
              </div>
              <p className={s.faixaPonta}>
                de <b>{numero(funil.leadsNovos)}</b> que chegaram
              </p>
            </div>
          ) : (
            <div className={s.faixa} role="img" aria-label={descricaoFaixa}>
              <div className={s.faixaBarra}>
                {partes.some((p) => p.valor > 0) ? (
                  partes.map((p) =>
                    p.valor > 0 ? (
                      <span key={p.chave} data-tom={p.tom} style={{ flexGrow: p.valor }}>
                        {p.valor / base >= FRACAO_COM_NUMERO ? <b>{numero(p.valor)}</b> : null}
                      </span>
                    ) : null,
                  )
                ) : (
                  <span data-tom="vazio" style={{ flexGrow: 1 }} />
                )}
              </div>
              {proxima && e.conversaoProxPct !== null ? (
                <p className={s.faixaPonta}>
                  <ArrowRight size={14} strokeWidth={2.4} aria-hidden="true" />
                  {proxima.nome} <b>{porcentagem(e.conversaoProxPct)}</b>
                </p>
              ) : null}
            </div>
          )}
          {ganho ? null : (
            <ul className={s.legenda} aria-hidden="true">
              {partes.map((p) => (
                <li key={p.chave} data-tom={p.tom}>
                  <i />
                  {p.texto}
                </li>
              ))}
            </ul>
          )}
          {/* cada número num lugar só: a leitura fica na frase do cabeçalho; os números, na barra e na
              legenda (a frase de apoio que repetia os dois saiu) */}
          {ganho && funil.taxaGanhoPct !== null ? (
            <p className={s.apoio}>{`Taxa de ganho do período: ${porcentagem(funil.taxaGanhoPct)} dos ${plural(funil.leadsNovos, "lead que chegou", "leads que chegaram", numero)}.`}</p>
          ) : null}
          <div className={s.entradas}>
            <p className={s.apoio}>Entradas por dia</p>
            <BarrasDia pontos={e.entradasPorDia} rotulo={`Entradas por dia em ${e.nome}`} formatar={numero} />
          </div>
        </Bloco>

        {/* a foto do Kanban agora (outra fonte que a coorte do Fluxo): o título diz isso, com a contagem */}
        <Bloco classe={s.blocoAgora} rotulo={kanbanAqui ? `Agora nesta etapa · ${numero(kanbanAqui.n)}` : "Agora nesta etapa"}>
          {agoraAqui && agoraAqui.leads.length > 0 ? (
            <>
              <p className={s.listaContexto}>no Kanban, parados há mais tempo primeiro</p>
              <ListaAgora leads={agoraAqui.leads} prefixo="na etapa há " />
            </>
          ) : (
            <p className={s.listaVazia}>Ninguém nesta etapa agora.</p>
          )}
          <Link to="/app/kanban" className={s.link}>
            Ver todos no Kanban
            <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </Bloco>

        <div className={cx(s.bloco, s.blocoNumeros)}>
          <h3 className={s.sr}>Os números de {e.nome}</h3>
          <dl className={s.celulas}>
            {celulas.map((c) => (
              <div key={c.rotulo} className={s.celula}>
                <dt>{c.rotulo}</dt>
                <dd>
                  <ComUnidade texto={c.valor} />
                </dd>
                {c.apoio ? <dd className={s.apoio}>{c.apoio}</dd> : null}
              </div>
            ))}
          </dl>
          {!ganho && e.avancaram > 0 ? (
            <div className={s.moveu}>
              <p className={s.apoio}>Quem moveu para {proxima?.nome ?? "a próxima etapa"}</p>
              <BarraDividida
                rotulo={`Quem moveu para ${proxima?.nome ?? "a próxima etapa"}`}
                partes={[
                  { chave: "janete", rotulo: "a Janete", valor: e.movimentos.janete, texto: numero(e.movimentos.janete), tom: "forte" },
                  { chave: "equipe", rotulo: "a equipe", valor: e.movimentos.equipe, texto: numero(e.movimentos.equipe), tom: "escuro" },
                ]}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CapituloSaidas({ painel, direita }: { painel: PainelDashboard; direita: boolean }) {
  const { funil, agora } = painel;
  const origens = funil.perdidosPorOrigem;
  // a largura de cada barra é o total que a fundação já deu para a etapa (abandonaram.total); os dois
  // pedaços dividem a barra por flex-grow (nada somado aqui)
  const totalDe = (etapaId: string) => funil.etapas.find((e) => e.etapaId === etapaId)?.abandonaram.total ?? 0;
  const maior = Math.max(1, ...origens.map((o) => totalDe(o.etapaId)));
  const perdidoKanban = agora.kanban.find((x) => x.tipo === "perdido");
  const agoraPerdido = perdidoKanban ? agora.porEtapa.find((x) => x.etapaId === perdidoKanban.etapaId) : undefined;
  return (
    <section
      id={idCapitulo(ETAPA_SAIRAM)}
      data-dash="capitulo"
      data-etapa={ETAPA_SAIRAM}
      data-lado={direita ? "direita" : "esquerda"}
      className={s.capitulo}
      aria-labelledby={idTituloCapitulo(ETAPA_SAIRAM)}
    >
      {/* sem "· N" no título: a frase da fundação, logo embaixo, já traz os três números (os que
          saíram, os perdidos e os sem resposta), e somar aqui seria cálculo */}
      <Cabecalho id={idTituloCapitulo(ETAPA_SAIRAM)} nome="Para onde foram os que saíram" frase={funil.fraseSaidas} />
      <div className={s.capGrade}>
        <Bloco classe={cx(s.blocoFluxo, s.blocoSaidas)} rotulo="Por etapa de origem">
          <ul className={s.saidas}>
            {origens.map((o) => (
              <li key={o.etapaId} className={s.saida}>
                <span className={s.saidaNome}>{o.nome}</span>
                <span
                  className={s.saidaBarras}
                  role="img"
                  aria-label={`${o.nome}: ${plural(o.perdido, "perdido", "perdidos", numero)} e ${numero(o.semResposta)} sem resposta há mais de ${DIAS_SEM_RESPOSTA} dias`}
                >
                  <span style={{ "--k": totalDe(o.etapaId) / maior } as CSSProperties}>
                    {o.perdido > 0 ? <i data-tom="hachura" style={{ flexGrow: o.perdido }} /> : null}
                    {o.semResposta > 0 ? <i data-tom="hachuraClara" style={{ flexGrow: o.semResposta }} /> : null}
                  </span>
                </span>
                <span className={s.saidaNumeros} aria-hidden="true">
                  <b>{numero(o.perdido)}</b> {o.perdido === 1 ? "perdido" : "perdidos"} · <b>{numero(o.semResposta)}</b> sem resposta
                </span>
              </li>
            ))}
          </ul>
          <ul className={s.legenda} aria-hidden="true">
            <li data-tom="hachura">
              <i />
              Perdidos (saíram para Perdido)
            </li>
            <li data-tom="hachuraClara">
              <i />
              Sem resposta há mais de {DIAS_SEM_RESPOSTA} dias
            </li>
          </ul>
        </Bloco>
        <Bloco classe={s.blocoAgora} rotulo={perdidoKanban ? `Em Perdido agora · ${numero(perdidoKanban.n)}` : "Em Perdido agora"}>
          {agoraPerdido && agoraPerdido.leads.length > 0 ? (
            <>
              <p className={s.listaContexto}>no Kanban, há mais tempo primeiro</p>
              <ListaAgora leads={agoraPerdido.leads} prefixo="em Perdido há " />
            </>
          ) : (
            <p className={s.listaVazia}>Ninguém em Perdido agora.</p>
          )}
          <Link to="/app/kanban" className={s.link}>
            Ver todos no Kanban
            <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        </Bloco>
      </div>
    </section>
  );
}

/** O capítulo carregando: a mesma forma, em osso (a altura parecida não faz a página pular). */
function CapituloOsso({ chave, nome }: { chave: string; nome: string }) {
  return (
    <section id={idCapitulo(chave)} data-dash="capitulo" data-etapa={chave} className={s.capitulo} aria-labelledby={idTituloCapitulo(chave)} aria-busy="true">
      <header className={s.capCab}>
        <h2 id={idTituloCapitulo(chave)} className={s.capTitulo} tabIndex={-1}>
          {nome}
        </h2>
        <div className={s.ossoCab}>
          <Esqueleto forma="texto" linhas={2} largura="60%" />
        </div>
      </header>
      <div className={s.ossoGrade} aria-hidden="true">
        <Esqueleto forma="bloco" altura={260} raio="card" />
        <Esqueleto forma="bloco" altura={260} raio="card" />
      </div>
    </section>
  );
}

const OUTROS_PERIODOS: readonly { id: IdPeriodo; texto: string }[] = [
  { id: "7d", texto: "Ver os últimos 7 dias" },
  { id: "30d", texto: "Ver os últimos 30 dias" },
  { id: "90d", texto: "Ver os últimos 90 dias" },
];

/** O período sem leads (vindo da B): no lugar dos capítulos, um convite a escolher outro período. */
function SemLeads() {
  const { idPeriodo, setPeriodo } = usePainelDashboard();
  return (
    <section className={cx(s.bloco, s.semLeads)} aria-labelledby="dvf-sem-leads-titulo">
      <h2 id="dvf-sem-leads-titulo" className={s.semLeadsTitulo}>
        Nenhum lead chegou neste período
      </h2>
      <p className={s.semLeadsTexto}>Escolha outro período para ver o funil etapa por etapa.</p>
      <div className={s.semLeadsAcoes}>
        {OUTROS_PERIODOS.filter((o) => o.id !== idPeriodo).map((o) => (
          <button key={o.id} type="button" className={s.semLeadsBotao} onClick={() => setPeriodo(o.id)}>
            {o.texto}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Os capítulos. Com `pergunteNoFim` (o palco), o "Pergunte à Janete" fecha o detalhamento: no palco, o do
 * cartão do funil some assim que a rolagem começa, e aqui é onde a pessoa chega depois de ler as etapas.
 */
export const Capitulos = memo(function Capitulos({
  painel,
  carregando,
  pergunteNoFim,
}: {
  painel: PainelDashboard;
  carregando: boolean;
  pergunteNoFim: boolean;
}) {
  const etapas = painel.funil.etapas;
  if ((painel.vazio || painel.funil.leadsNovos === 0) && !carregando) {
    return (
      <div className={s.detalhe}>
        <SemLeads />
      </div>
    );
  }
  return (
    <div className={s.detalhe}>
      <h2 className={s.detalheTitulo}>O funil, etapa por etapa</h2>
      {etapas.map((e, k) =>
        carregando ? (
          <CapituloOsso key={e.etapaId} chave={e.etapaId} nome={e.nome} />
        ) : (
          <Capitulo key={e.etapaId} etapa={e} k={k} proxima={etapas[k + 1]} painel={painel} />
        ),
      )}
      {carregando ? (
        <CapituloOsso chave={ETAPA_SAIRAM} nome="Para onde foram os que saíram" />
      ) : (
        <CapituloSaidas painel={painel} direita={etapas.length % 2 === 1} />
      )}
      {pergunteNoFim && !carregando ? (
        <div className={cx(s.bloco, s.pergunteFim)}>
          <Pergunte perguntas={painel.funil.perguntas} titulo />
        </div>
      ) : null}
    </div>
  );
});
