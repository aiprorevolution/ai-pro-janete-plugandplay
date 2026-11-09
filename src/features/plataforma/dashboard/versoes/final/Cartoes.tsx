import { Link } from "@tanstack/react-router";
import { ArrowRight, BrainCircuit, Kanban, MessageCircle, MessagesSquare, Mic, Settings, TriangleAlert, type LucideIcon } from "lucide-react";
import { memo, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { JaneteSimbolo, type EstadoJanete } from "@/components/janete/JaneteSimbolo";
import { Esqueleto } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";

import { AvatarLead } from "../../../comum/AvatarLead";
import { MOTIVO_CURTO } from "../../../comum/LinhaConversa";
import { dataCurta, horaCurta } from "../../../comum/tempo";
import {
  CONTEXTO_EXEMPLO,
  contagem,
  dinheiro,
  duracaoCurta,
  numero,
  porcentagem,
  usePainelDashboard,
  type Agora,
  type ItemSaude,
  type Tendencia,
} from "../../dados";
import { ComoContamos, Faixa, Num, Sr, useSaidaComEspera, Variacao } from "./comum";
import estilosResumo from "./Resumo.module.css";
import estilos from "./Topo.module.css";
import { abrirFaleComAJanete } from "./voo";

// Os cartões da dobra 1 da versão final (spec 5.3 e docs/spec-dashboard-final.md): o anel do "No
// Kanban agora" com a Janete no centro (o lugar dela na composição, 5.2) e os 4 números vêm da D; o
// "Precisa de você" (meia altura, no azul da Janete), o cartão do Contexto embaixo dele e a Saúde em
// medidor de meio círculo são as mudanças da final. Tudo lido de usePainelDashboard(); nenhum número
// nasce aqui (as proporções do anel, do medidor e da barrinha do Contexto são só a geometria do desenho).

const s = estilos as Classes<
  | "dvd-cartao"
  | "dvd-cartaoTopo"
  | "dvd-rotulo"
  | "dvd-rotuloGrupo"
  | "dvd-rotuloExtra"
  | "dvd-soLargo"
  | "dvd-soMuitoLargo"
  | "dvd-linkCompacto"
  | "dvd-pe"
  | "dvd-hub"
  | "dvd-hubCorpo"
  | "dvd-anel"
  | "dvd-anelSvg"
  | "dvd-anelTrilho"
  | "dvd-anelCentro"
  | "dvd-janete"
  | "dvd-janeteLugar"
  | "dvd-janeteSimbolo"
  | "dvd-hubLegenda"
  | "dvd-hubItem"
  | "dvd-hubPonto"
  | "dvd-hubNome"
  | "dvd-hubN"
  | "dvd-hubPe"
  | "dvd-hubPeJanete"
  | "dvd-frio"
  | "dvd-saudeLink"
  | "dvd-saudeBotao"
  | "dvd-problemas"
  | "dvd-problemasTopo"
  | "dvd-problema"
  | "dvd-numCartao"
  | "dvd-numCorpo"
  | "dvd-numValor"
  | "dvd-numDuplo"
  | "dvd-numApoio"
  | "dvd-numVazio"
  | "dvd-numGrafico"
  | "dvd-numBarra"
  | "dvd-ossoNumero"
  | "dvd-numeros"
>;

const r = estilosResumo as Classes<
  | "precisa"
  | "precisaTopo"
  | "precisaRotulo"
  | "precisaBotao"
  | "precisaCorpo"
  | "precisaFrase"
  | "precisaNum"
  | "precisaTexto"
  | "precisaCalmo"
  | "precisaIA"
  | "rostos"
  | "rosto"
  | "contexto"
  | "contextoTopo"
  | "contextoTitulo"
  | "contextoCorpo"
  | "contextoNum"
  | "contextoBarra"
  | "saudeConfig"
  | "saudeConfigDica"
  | "saude"
  | "medidor"
  | "medidorSvg"
  | "medidorTrilho"
  | "medidorFrase"
  | "saudeItens"
  | "saudeItem"
  | "saudeBotao"
  | "saudeIcone"
  | "saudePalavra"
  | "saudeDica"
>;

/**
 * A escala das etapas abertas, só por luminosidade (da mais clara à mais escura, seção 13; a mais
 * clara ainda se lê sobre o branco). No anel de agora, as fechadas são discretas (5.3.2): o Ganho num
 * verde mais claro (o verde da venda, como no funil, na faixa e nos capítulos; ~3:1 contra o branco) e
 * o Perdido no cinza que ainda tem 3:1 contra o branco (1.4.11).
 */
export const CORES_ETAPAS: readonly string[] = [
  "color-mix(in srgb, var(--sb-azul) 60%, var(--sb-branco))",
  "color-mix(in srgb, var(--sb-azul) 80%, var(--sb-branco))",
  "var(--sb-azul)",
  "var(--sb-azul-texto)",
];
export const COR_GANHO_AGORA = "color-mix(in srgb, var(--sb-sucesso) 70%, var(--sb-branco))";
export const COR_PERDIDO = "var(--sb-borda-campo)";

export function corDaEtapaAgora(tipo: "aberta" | "ganho" | "perdido", indiceAberta: number): string {
  if (tipo === "ganho") return COR_GANHO_AGORA;
  if (tipo === "perdido") return COR_PERDIDO;
  return CORES_ETAPAS[Math.min(indiceAberta, CORES_ETAPAS.length - 1)]!;
}

/** O texto do "como contamos" de cada métrica (as definições da seção 4). */
export const COMO_CONTAMOS = {
  kanban: "Os leads em cada etapa do Kanban agora, a mesma contagem do quadro. Não muda com o período.",
  conversas: "Leads com pelo menos 1 mensagem, de qualquer lado, no período, pela data da mensagem. É uma conversa por lead. \"Novas\" são os leads cuja 1ª mensagem caiu no período.",
  mensagens: "Recebidas: as mensagens do lead. Enviadas: a Janete, a equipe pela plataforma e o celular da empresa. As duas pela data da mensagem.",
  tempo: "1ª resposta: a mediana, nos leads novos, do 1º contato até a 1ª resposta enviada, de qualquer origem. A Janete: a mediana, por resposta dela, da última mensagem do lead até a 1ª bolha sair.",
  custo: "A soma do custo das chamadas de IA pela data do gasto, em US$. É um piso: a OpenRouter tem taxa à parte e há chamadas sem preço. Por conversa: o custo das respostas da Janete dividido pelas conversas que ela respondeu.",
  autonomia: "A porcentagem das conversas do período sem nenhuma mensagem humana e sem passagem para a equipe.",
} as const;

/**
 * O motivo curto que o atendente pode ler: ele não vê chave nem crédito (seções 3 e 19.6), então os
 * dois motivos da chave viram "Problema na IA". As outras falhas ("Mensagem não entregue", "Erro no
 * provedor") ele lê como no Chat. O admin lê o do Chat.
 */
export function rotuloMotivo(motivoCurto: string, admin: boolean): string {
  if (admin) return motivoCurto;
  return motivoCurto === MOTIVO_CURTO.sem_credito || motivoCurto === MOTIVO_CURTO.chave_invalida ? "Problema na IA" : motivoCurto;
}

/* ---------- o lugar da Janete ---------- */

export const ESTADO_TEXTO: Record<EstadoJanete, string> = {
  acordada: "Janete, atendendo",
  dormindo: "Janete, parada",
  carregando: "Janete, carregando",
  check: "Janete, tudo certo",
  fala: "Janete, falando",
};

/**
 * O símbolo da Janete na composição (spec 5.2): um botão de pelo menos 44 px, "Fale com a Janete" mais o
 * estado dela. O alvo do voo ([data-dash="janete"]) é um invólucro do tamanho EXATO do símbolo (o
 * botão pode ser maior, no celular), para o pouso não saltar. Clicar nela clica no botão do canto
 * (#janete-gatilho), que está escondido enquanto ela mora aqui; o painel é da casca. O símbolo só
 * aparece depois do pouso (`visivel`).
 */
export function LugarDaJanete({
  estado,
  visivel,
  pousou,
  tamanho,
}: {
  estado: EstadoJanete;
  visivel: boolean;
  pousou: boolean;
  tamanho: number;
}) {
  return (
    <button
      type="button"
      className={s["dvd-janete"]}
      data-pousou={pousou || undefined}
      aria-label={`Fale com a Janete · ${ESTADO_TEXTO[estado]}`}
      aria-haspopup="dialog"
      onClick={(ev) => abrirFaleComAJanete(ev.currentTarget)}
    >
      <span className={s["dvd-janeteLugar"]} data-dash="janete" style={{ width: tamanho, height: tamanho }}>
        <JaneteSimbolo
          decorativo
          estado={estado}
          tamanho={tamanho}
          className={s["dvd-janeteSimbolo"]}
          data-visivel={visivel ? "" : undefined}
          data-pousou={pousou ? "" : undefined}
        />
      </span>
    </button>
  );
}

/* ---------- Precisa de você (meia altura, no azul da Janete) ---------- */

/**
 * O atalho para o Chat, na metade de cima da coluna: "4 conversas esperando você", os 3 rostos que
 * esperam há mais tempo (pequenos, lado a lado, sem o selo) e o "Abrir no Chat". Com zero esperando,
 * "Ninguém esperando por você" e o mesmo botão. Com a Janete parada, a frase da fundação (a linha de
 * resumo, que para o atendente não fala de chave) numa linha embaixo.
 */
export const CartaoPrecisa = memo(function CartaoPrecisa({ entrada, ordem }: { entrada: boolean; ordem: number }) {
  const { painel } = usePainelDashboard();
  const { aguardando } = painel.agora;
  const parada = painel.estadoJanete === "dormindo";
  const tres = aguardando.itens.slice(0, 3);
  // Nada neste cartão sai com reticências: com a Janete parada, os rostos saem e a frase da fundação
  // ganha até 2 linhas; entre 900 e 1439 px, só 2 rostos, e o texto pode quebrar.
  return (
    <div
      className={cx(s["dvd-cartao"], r.precisa)}
      data-dash="cartao"
      data-cartao="precisa"
      data-parada={parada || undefined}
      data-entrada={entrada ? "" : undefined}
      style={{ "--sb-ordem": ordem } as CSSProperties}
    >
      <div className={r.precisaTopo}>
        <h2 id="dvf-precisa-titulo" className={r.precisaRotulo}>
          Precisa de você
        </h2>
        <Link to="/app/chat" className={r.precisaBotao} aria-label="Abrir no Chat">
          <span className={s["dvd-soLargo"]}>Abrir no </span>Chat
          <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
        </Link>
      </div>

      <div className={r.precisaCorpo}>
        {aguardando.total === 0 ? (
          <p className={cx(r.precisaFrase, r.precisaCalmo)}>Ninguém esperando por você</p>
        ) : (
          <>
            <p className={r.precisaFrase}>
              <Num valor={aguardando.total} formatar={numero} contar={entrada} className={r.precisaNum} />{" "}
              <span className={r.precisaTexto}>
                <span>{aguardando.total === 1 ? "conversa" : "conversas"}</span> <span>esperando você</span>
              </span>
            </p>
            <ul className={r.rostos} aria-label="As que esperam há mais tempo">
              {tres.map((item, k) => (
                <li key={item.conversaId} className={r.rosto} data-terceiro={k === 2 || undefined}>
                  <AvatarLead nome={item.nome} chave={item.contatoId} tamanho="p" />
                  <Sr>{item.nome}</Sr>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {parada ? <p className={r.precisaIA}>{painel.textos.resumo}</p> : null}
    </div>
  );
});

/* ---------- o Contexto (a outra metade da coluna) ---------- */

export interface ContextoCartao {
  preenchidos: number;
  total: number;
  /** Nula sem versão (o "· versão N" some). */
  versao: number | null;
}

/**
 * O cartão do Contexto da Janete: "Contexto da Janete · 6 de 8 campos", uma barrinha de progresso e o
 * "Completar o contexto". Completo, "Contexto completo · versão 6" e "Abrir o Contexto". O valor vem
 * do painel (`painel.contexto`: a versão atual no banco; no exemplo, `CONTEXTO_EXEMPLO`); a barrinha
 * só desenha a proporção entre os dois números.
 */
export const CartaoContexto = memo(function CartaoContexto({
  entrada,
  ordem,
  contexto = CONTEXTO_EXEMPLO,
}: {
  entrada: boolean;
  ordem: number;
  contexto?: ContextoCartao | undefined;
}) {
  const { preenchidos, total, versao } = contexto;
  const completo = preenchidos >= total;
  const fracao = total > 0 ? Math.min(1, preenchidos / total) : 0;
  // A mesma composição do "Precisa de você", para as duas metades rimarem: o título e o atalho em
  // cima; embaixo, o número grande ("6 de 8"), "campos" e a barrinha no resto da linha.
  return (
    <div
      className={cx(s["dvd-cartao"], r.contexto)}
      data-dash="cartao"
      data-cartao="contexto"
      data-completo={completo || undefined}
      data-entrada={entrada ? "" : undefined}
      style={{ "--sb-ordem": ordem } as CSSProperties}
    >
      <div className={r.contextoTopo}>
        <h2 id="dvf-contexto-titulo" className={r.contextoTitulo}>
          {completo ? (
            <>
              Contexto completo{versao !== null ? <span> · versão {numero(versao)}</span> : null}
            </>
          ) : (
            "Contexto da Janete"
          )}
        </h2>
        <Link to="/app/contexto" className={s["dvd-linkCompacto"]} aria-label={completo ? "Abrir o Contexto" : "Completar o contexto"}>
          {completo ? "Abrir" : "Completar"}
          <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
      <div className={r.contextoCorpo}>
        <p className={r.contextoNum}>
          <b>
            {numero(preenchidos)} de {numero(total)}
          </b>{" "}
          <span>campos</span>
        </p>
        <span
          className={r.contextoBarra}
          role="img"
          aria-label={`${numero(preenchidos)} de ${numero(total)} campos preenchidos`}
          style={{ "--f": fracao } as CSSProperties}
        >
          <span />
        </span>
      </div>
    </div>
  );
});

/* ---------- No Kanban agora: o anel em volta da Janete ---------- */

const RAIO = 72;
const CIRC = 2 * Math.PI * RAIO;

/** Quanto o cartão do anel espera o pouso da Janete antes de aparecer inteiro mesmo assim (o voo leva ~1 s). */
export const ESPERA_MAXIMA_DO_POUSO_MS = 2500;

function segmentos(kanban: Agora["kanban"]) {
  // só a geometria do desenho: a fração do anel de cada etapa (nenhum número daqui vai para a tela)
  const soma = kanban.reduce((acc, e) => acc + e.n, 0);
  let acumulado = 0;
  let abertas = 0;
  return kanban.map((e, k) => {
    const cor = corDaEtapaAgora(e.tipo, e.tipo === "aberta" ? abertas : 0);
    if (e.tipo === "aberta") abertas += 1;
    const comprimento = soma > 0 ? (e.n / soma) * CIRC : 0;
    // k: a ordem no anel (a chegada desenha as partes e acende a legenda nessa ordem)
    const fatia = { ...e, k, cor, comprimento, inicio: acumulado };
    acumulado += comprimento;
    return fatia;
  });
}

function LegendaDoAnel({ fatias, lado }: { fatias: ReturnType<typeof segmentos>; lado: "esq" | "dir" }) {
  return (
    <ul className={s["dvd-hubLegenda"]} data-lado={lado} aria-label={lado === "esq" ? "Leads por etapa agora (1 a 3)" : "Leads por etapa agora (6 a 4)"}>
      {fatias.map((f) => (
        <li key={f.etapaId} className={s["dvd-hubItem"]} data-discreto={f.tipo !== "aberta" || undefined} style={{ "--k": f.k } as CSSProperties}>
          <span className={s["dvd-hubPonto"]} style={{ "--cor": f.cor } as CSSProperties} aria-hidden="true" />
          <span className={s["dvd-hubN"]}>{numero(f.n)}</span>
          <span className={s["dvd-hubNome"]} title={f.nome}>
            {f.nome}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * O cartão do Kanban de agora com o anel em volta da Janete (da D): a barra empilhada das 6 etapas
 * curvada em volta dela, no centro exato da fileira, com a legenda em duas pilhas de 3, uma de cada
 * lado. O anel começa no topo e corre no sentido ANTI-horário (o CSS espelha o SVG): as 3 primeiras
 * etapas varrem o lado esquerdo, de cima para baixo, como a pilha da esquerda; as 3 últimas sobem pelo
 * lado direito, por isso a pilha da direita vem invertida. `janete` é o botão do lugar dela (no celular
 * ela vai para o herói, e o centro fica com o ícone do Kanban). O cartão não entra em fade: é o ponto
 * de pouso do voo, e o alvo é medido com ele parado.
 *
 * A chegada (ajuste 3 do equipe): enquanto a Janete voa (`chegada = "esperando"`), as partes do anel, as
 * etapas com os números e o rodapé ("esfriando", "a Janete está em N conversas") ficam invisíveis, só com
 * o trilho claro do anel marcando o lugar; quando ela pousa (`"entrando"`), o anel se desenha em volta
 * dela, parte por parte, e as etapas acendem na mesma ordem, com o rodapé por último (~0,8 s). Sem voo
 * (movimento reduzido, sem o botão do canto, o tour), `chegada` não vem e tudo já nasce no lugar. Os
 * textos ficam na árvore o tempo todo (só a opacidade muda), e se o pouso não chegar em 2,5 s o cartão
 * aparece inteiro do mesmo jeito.
 */
export const CartaoHub = memo(function CartaoHub({
  janete,
  ordem,
  chegada,
}: {
  janete: ReactNode;
  ordem: number;
  chegada?: "esperando" | "entrando" | undefined;
}) {
  const { painel } = usePainelDashboard();
  const { kanban, esfriando, janeteAtiva } = painel.agora;
  const fatias = segmentos(kanban);
  // a rede de segurança: um voo que não termina nunca prende o cartão vazio
  const [desistiu, setDesistiu] = useState(false);
  useEffect(() => {
    if (chegada !== "esperando") return;
    const id = setTimeout(() => setDesistiu(true), ESPERA_MAXIMA_DO_POUSO_MS);
    return () => clearTimeout(id);
  }, [chegada]);
  const estadoChegada = desistiu ? undefined : chegada;
  const descricao = `No Kanban agora: ${fatias.map((f) => `${f.nome} ${numero(f.n)}`).join(", ")}`;
  const textoJanete =
    janeteAtiva.conversas > 0
      ? `a Janete está em ${contagem(janeteAtiva.conversas, "conversa", "conversas")} agora${janeteAtiva.digitando ? `, respondendo ${janeteAtiva.digitando}` : ""}`
      : "";
  return (
    <div
      className={cx(s["dvd-cartao"], s["dvd-hub"])}
      data-dash="cartao"
      data-cartao="kanban"
      data-chegada={estadoChegada}
      style={{ "--sb-ordem": ordem } as CSSProperties}
    >
      <div className={s["dvd-cartaoTopo"]}>
        <h2 id="dvf-kanban-titulo" className={s["dvd-rotulo"]}>
          No Kanban agora
        </h2>
        <ComoContamos titulo="No Kanban agora" texto={COMO_CONTAMOS.kanban} />
      </div>
      <div className={s["dvd-hubCorpo"]}>
        <LegendaDoAnel fatias={fatias.slice(0, 3)} lado="esq" />
        <div className={s["dvd-anel"]}>
          <svg className={s["dvd-anelSvg"]} viewBox="0 0 160 160" role="img" aria-label={descricao}>
            <circle className={s["dvd-anelTrilho"]} cx="80" cy="80" r={RAIO} />
            {fatias.map((f) =>
              f.comprimento > 0 ? (
                <circle
                  key={f.etapaId}
                  cx="80"
                  cy="80"
                  r={RAIO}
                  data-parte=""
                  style={
                    {
                      stroke: f.cor,
                      "--k": f.k,
                      "--traco": `${Math.max(0, f.comprimento - 2.5)}px`,
                      "--vao": `${CIRC - Math.max(0, f.comprimento - 2.5)}px`,
                    } as CSSProperties
                  }
                  strokeDasharray={`${Math.max(0, f.comprimento - 2.5)} ${CIRC - Math.max(0, f.comprimento - 2.5)}`}
                  strokeDashoffset={-f.inicio}
                  strokeLinecap="butt"
                />
              ) : null,
            )}
          </svg>
          {janete ?? (
            <span className={s["dvd-anelCentro"]} aria-hidden="true">
              <Kanban size={22} strokeWidth={1.75} />
            </span>
          )}
        </div>
        <LegendaDoAnel fatias={fatias.slice(3).reverse()} lado="dir" />
      </div>
      {/* o rodapé em uma linha (o texto inteiro fica no title); "respondendo X" só a partir de 1440 */}
      <div className={s["dvd-pe"]}>
        <p className={s["dvd-hubPe"]}>
          {esfriando > 0 ? (
            <span>
              <i className={s["dvd-frio"]} aria-hidden="true" />
              {numero(esfriando)} esfriando
            </span>
          ) : null}
          {janeteAtiva.conversas > 0 ? (
            <span className={s["dvd-hubPeJanete"]} title={textoJanete}>
              a Janete está em {contagem(janeteAtiva.conversas, "conversa", "conversas")} agora
              {janeteAtiva.digitando ? <span className={s["dvd-soLargo"]}>{`, respondendo ${janeteAtiva.digitando}`}</span> : null}
            </span>
          ) : null}
        </p>
        <Link to="/app/kanban" className={s["dvd-linkCompacto"]}>
          Abrir o Kanban
          <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
});

/* ---------- Saúde: o medidor de meio círculo ---------- */

const ESTADO_SAUDE: Record<ItemSaude["estado"], string> = { ok: "ok", atencao: "atenção", parado: "parado" };

type IdItemMedidor = Exclude<ItemSaude["id"], "contexto">;

/** Um ícone e uma palavra por item (o detalhe inteiro fica na dica). */
const ICONE_SAUDE: Record<IdItemMedidor, { Icone: LucideIcon; palavra: string }> = {
  whatsapp: { Icone: MessageCircle, palavra: "WhatsApp" },
  motor: { Icone: MessagesSquare, palavra: "Janete" },
  cerebro: { Icone: BrainCircuit, palavra: "Modelo" },
  escuta: { Icone: Mic, palavra: "Áudio" },
  problemas: { Icone: TriangleAlert, palavra: "Problemas" },
};

/** O que o medidor mostra: o Contexto sai da Saúde (tem cartão próprio). */
function itensDoMedidor(itens: ItemSaude[]): (ItemSaude & { id: IdItemMedidor })[] {
  return itens.filter((i): i is ItemSaude & { id: IdItemMedidor } => i.id !== "contexto");
}

/* a geometria do meio círculo (só desenho): centro, raio e a folga em graus entre as partes */
const MED = { cx: 100, cy: 100, raio: 82, folga: 4 } as const;

function pontoDoArco(graus: number): string {
  const rad = (graus * Math.PI) / 180;
  return `${(MED.cx + MED.raio * Math.cos(rad)).toFixed(2)} ${(MED.cy - MED.raio * Math.sin(rad)).toFixed(2)}`;
}

/** O arco de `de` até `ate` graus (180 é a ponta da esquerda, 0 a da direita), no sentido horário da tela. */
function arco(de: number, ate: number): string {
  return `M ${pontoDoArco(de)} A ${MED.raio} ${MED.raio} 0 0 1 ${pontoDoArco(ate)}`;
}

/**
 * O medidor: um meio círculo dividido em uma parte por item, cada uma na cor do estado dele (ok,
 * atenção, parado), na mesma ordem dos ícones de baixo; no centro, a frase geral da fundação.
 */
function MedidorSaude({ itens, geral, frase }: { itens: (ItemSaude & { id: IdItemMedidor })[]; geral: ItemSaude["estado"]; frase: string }) {
  const n = Math.max(1, itens.length);
  const passo = 180 / n;
  const descricao = `Saúde da plataforma: ${frase}. ${itens.map((i) => `${ICONE_SAUDE[i.id].palavra}, ${ESTADO_SAUDE[i.estado]}`).join("; ")}.`;
  return (
    <div className={r.medidor}>
      <svg className={r.medidorSvg} viewBox="0 0 200 108" role="img" aria-label={descricao}>
        <path className={r.medidorTrilho} d={arco(180, 0)} />
        {itens.map((item, k) => {
          const de = 180 - k * passo - (k > 0 ? MED.folga / 2 : 0);
          const ate = 180 - (k + 1) * passo + (k < n - 1 ? MED.folga / 2 : 0);
          return <path key={item.id} d={arco(de, ate)} data-estado={item.estado} />;
        })}
      </svg>
      <p className={r.medidorFrase} data-estado={geral}>
        {frase}
      </p>
    </div>
  );
}

/**
 * Um item embaixo do medidor: o ícone na cor do estado e a palavra. O detalhe da fundação abre numa
 * dica no hover, no foco e no clique (no toque, o clique mostra), e fecha com Esc, ao sair o ponteiro
 * ou o foco. Nos Problemas com algo no período, o clique abre a lista dos problemas (a dica fecha).
 */
function ItemDoMedidor({
  item,
  pos,
  aoVerProblemas,
  problemasAbertos,
  idLista,
}: {
  item: ItemSaude & { id: IdItemMedidor };
  pos: "inicio" | "meio" | "fim";
  aoVerProblemas?: ((botao: HTMLButtonElement) => void) | undefined;
  problemasAbertos?: boolean | undefined;
  idLista?: string | undefined;
}) {
  const id = useId();
  const [passando, setPassando] = useState(false);
  const [fixa, setFixa] = useState(false);
  const [fechadaComEsc, setFechadaComEsc] = useState(false);
  const mostrar = (passando || fixa) && !fechadaComEsc && !problemasAbertos;
  // ao sair o ponteiro, a dica espera um pouco: dá para levar o ponteiro até ela (WCAG 1.4.13)
  const { cancelar, sairDepois } = useSaidaComEspera(() => setPassando(false));
  useEffect(() => {
    if (!mostrar || typeof document === "undefined") return;
    const aoTecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setFechadaComEsc(true);
        setFixa(false);
      }
    };
    document.addEventListener("keydown", aoTecla);
    return () => document.removeEventListener("keydown", aoTecla);
  }, [mostrar]);
  const abrir = () => {
    cancelar();
    setFechadaComEsc(false);
    setPassando(true);
  };
  const { Icone, palavra } = ICONE_SAUDE[item.id];
  return (
    <li className={r.saudeItem} data-pos={pos} onMouseEnter={abrir} onMouseLeave={sairDepois}>
      <button
        type="button"
        className={r.saudeBotao}
        data-estado={item.estado}
        aria-describedby={id}
        aria-expanded={aoVerProblemas ? (problemasAbertos ?? false) : undefined}
        aria-controls={aoVerProblemas ? idLista : undefined}
        onFocus={abrir}
        onBlur={() => {
          cancelar();
          setPassando(false);
          setFixa(false);
        }}
        onClick={(ev) => {
          if (aoVerProblemas) {
            setPassando(false);
            setFixa(false);
            aoVerProblemas(ev.currentTarget);
            return;
          }
          setFechadaComEsc(false);
          setFixa(true);
        }}
      >
        <span className={r.saudeIcone} data-estado={item.estado} aria-hidden="true">
          <Icone size={16} strokeWidth={2} />
        </span>
        <span className={r.saudePalavra}>{palavra}</span>
        <Sr>, {ESTADO_SAUDE[item.estado]}</Sr>
      </button>
      <span role="tooltip" id={id} className={r.saudeDica} data-aberta={mostrar || undefined}>
        <b>{item.titulo}</b>
        {item.detalhe}
      </span>
    </li>
  );
}

/**
 * A Saúde (spec 5.3.3, com a mudança 3 da final): o medidor de meio círculo com uma parte por item
 * (WhatsApp, a Janete respondendo, o modelo de IA, a escuta de áudio e os problemas; o atendente vê 3:
 * sem o modelo e sem a escuta, que a fundação já não entrega para ele), a frase geral no centro e,
 * embaixo, um ícone com uma palavra por item. "Abrir a Configuração" só para o admin.
 */
export const CartaoSaude = memo(function CartaoSaude({ entrada, ordem }: { entrada: boolean; ordem: number }) {
  const { painel } = usePainelDashboard();
  const { saude } = painel.agora;
  const problemas = painel.resumo.problemas;
  const admin = painel.papel === "admin";
  const itens = itensDoMedidor(saude.itens);
  const [verProblemas, setVerProblemas] = useState(false);
  const idLista = useId();
  const botaoVer = useRef<HTMLElement | null>(null);
  // o painel dos problemas fecha com Esc e devolve o foco ao botão "Problemas"
  useEffect(() => {
    if (!verProblemas || typeof document === "undefined") return;
    const aoTecla = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      setVerProblemas(false);
      botaoVer.current?.focus();
    };
    document.addEventListener("keydown", aoTecla);
    return () => document.removeEventListener("keydown", aoTecla);
  }, [verProblemas]);
  const fecharProblemas = () => {
    setVerProblemas(false);
    botaoVer.current?.focus();
  };
  return (
    <div
      className={cx(s["dvd-cartao"], r.saude)}
      data-dash="cartao"
      data-cartao="saude"
      data-entrada={entrada ? "" : undefined}
      style={{ "--sb-ordem": ordem } as CSSProperties}
    >
      <div className={s["dvd-cartaoTopo"]}>
        <h2 id="dvf-saude-titulo" className={s["dvd-rotulo"]}>
          Saúde da plataforma
        </h2>
        {/* no lugar do (i) dos outros cartões: a engrenagem (o título fica inteiro em toda largura) */}
        {admin ? (
          <span className={r.saudeConfig}>
            <Link to="/app/configuracao" aria-label="Abrir a Configuração">
              <Settings size={16} strokeWidth={1.9} aria-hidden="true" />
            </Link>
            <span className={r.saudeConfigDica} aria-hidden="true">
              Abrir a Configuração
            </span>
          </span>
        ) : null}
      </div>

      <MedidorSaude itens={itens} geral={saude.geral} frase={saude.frase} />

      <ul className={r.saudeItens} aria-label="Itens da saúde">
        {itens.map((item, k) => {
          const pos = k === 0 ? "inicio" : k === itens.length - 1 ? "fim" : "meio";
          const comLista = item.id === "problemas" && problemas.length > 0;
          return (
            <ItemDoMedidor
              key={item.id}
              item={item}
              pos={pos}
              problemasAbertos={comLista ? verProblemas : undefined}
              idLista={comLista ? idLista : undefined}
              aoVerProblemas={
                comLista
                  ? (botao) => {
                      botaoVer.current = botao;
                      setVerProblemas((v) => !v);
                    }
                  : undefined
              }
            />
          );
        })}
      </ul>

      {verProblemas && problemas.length ? (
        <div className={s["dvd-problemas"]} id={idLista} role="region" aria-label={`Problemas ${painel.periodo.rotulo}`}>
          <div className={s["dvd-problemasTopo"]}>
            <b>{contagem(problemas.length, "problema", "problemas")}</b>
            <button type="button" className={s["dvd-saudeBotao"]} onClick={fecharProblemas}>
              Fechar
            </button>
          </div>
          <ul>
            {problemas.map((p) => (
              <li key={p.id} className={s["dvd-problema"]}>
                <small>
                  {dataCurta(p.quando)} às {horaCurta(p.quando)}
                </small>
                <b>{p.titulo}</b>
                <p>{p.causa}</p>
                {p.acao && (admin || p.acao.para !== "/app/configuracao") ? (
                  <Link to={p.acao.para} className={s["dvd-saudeLink"]}>
                    {p.acao.rotulo}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
});

/* ---------- os 4 números do período ---------- */

type Cartao = "conversas" | "mensagens" | "tempo" | "custo" | "autonomia";

/**
 * Um dos 4 cartões do período. O mini gráfico mora à direita do número, na mesma linha de base
 * (88 × 28; encolhe quando o número é largo), ou, em Mensagens, embaixo das duas colunas, na largura
 * inteira; no celular, embaixo do número (spec 11: número, variação e mini gráfico). O rótulo pode
 * levar um complemento discreto (`extra`, o "89% pela Janete"), escondido no celular.
 */
function CartaoNumero({
  id,
  titulo,
  como,
  extra,
  grafico,
  graficoEmbaixo = false,
  entrada,
  ordem,
  carregando,
  vazio,
  children,
}: {
  id: Cartao;
  titulo: string;
  como: string;
  extra?: string | undefined;
  /** O mini gráfico (a faixa, ou a barra dividida da autonomia). */
  grafico?: ReactNode;
  graficoEmbaixo?: boolean | undefined;
  entrada: boolean;
  ordem: number;
  carregando: boolean;
  vazio: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(s["dvd-cartao"], s["dvd-numCartao"])}
      data-dash="cartao"
      data-cartao={id}
      data-entrada={entrada ? "" : undefined}
      style={{ "--sb-ordem": ordem } as CSSProperties}
      aria-busy={carregando || undefined}
    >
      <div className={s["dvd-cartaoTopo"]}>
        <h2 id={`dvf-num-${id}`} className={s["dvd-rotulo"]}>
          {titulo}
        </h2>
        {extra && !carregando && !vazio ? <span className={s["dvd-rotuloExtra"]}>{extra}</span> : null}
        <ComoContamos titulo={titulo} texto={como} />
      </div>
      {carregando ? (
        <div className={s["dvd-ossoNumero"]}>
          <Esqueleto forma="bloco" altura={30} largura="55%" raio="mini" rotulo={`Carregando ${titulo}`} />
          <Esqueleto forma="texto" largura="70%" />
        </div>
      ) : vazio ? (
        <p className={s["dvd-numVazio"]}>Nenhum lead chegou neste período</p>
      ) : (
        <div className={s["dvd-numCorpo"]} data-grafico-embaixo={graficoEmbaixo || undefined}>
          {children}
          {grafico ? <div className={s["dvd-numGrafico"]}>{grafico}</div> : null}
        </div>
      )}
    </div>
  );
}

/**
 * O mini gráfico de "Resolvidas só pela Janete": uma barra dividida desenhada só com o número já na
 * tela (a Janete = a porcentagem; o resto é da equipe). Nenhum número novo nasce aqui.
 */
function BarraJaneteEquipe({ pct }: { pct: number }) {
  return (
    <span className={s["dvd-numBarra"]} role="img" aria-label={`A Janete resolveu sozinha ${porcentagem(pct)} das conversas; nas outras a equipe entrou`}>
      <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}

function valorOuNulo(t: Tendencia): number | null {
  return t.atual;
}

export const CartoesNumeros = memo(function CartoesNumeros({ entrada, ordemBase }: { entrada: boolean; ordemBase: number }) {
  const { painel, carregando, idPeriodo } = usePainelDashboard();
  const { resumo, custo } = painel;
  const admin = painel.papel === "admin";
  const vazio = painel.vazio;
  const conversas = valorOuNulo(resumo.conversas);
  const recebidas = valorOuNulo(resumo.recebidas);
  const enviadas = valorOuNulo(resumo.enviadas);
  const primeira = valorOuNulo(resumo.primeiraRespostaS);
  const janete = valorOuNulo(resumo.respostaJaneteS);
  const autonomia = valorOuNulo(resumo.autonomiaPct);
  const comum = { entrada, carregando, vazio };
  const tempoTxt = (segundos: number) => duracaoCurta(segundos);
  // o p90 sai do cartão (jargão) e vai para o "como contamos", em palavras
  const comoTempo = resumo.respostaJaneteP90S !== null ? `${COMO_CONTAMOS.tempo} 9 em cada 10 respostas da Janete saem em até ${tempoTxt(resumo.respostaJaneteP90S)}.` : COMO_CONTAMOS.tempo;

  // a linha de apoio de cada cartão é UMA linha, com reticências como rede de segurança; o que só
  // cabe em tela larga fica em `dvd-soMuitoLargo` (a partir de 1600 px: a "previsão do mês", 5.3.4)
  return (
    <div className={s["dvd-numeros"]}>
      <CartaoNumero
        id="conversas"
        titulo="Conversas"
        como={COMO_CONTAMOS.conversas}
        ordem={ordemBase}
        grafico={<Faixa serie={resumo.series.conversas} rotulo="Conversas" formatar={numero} />}
        {...comum}
      >
        <div className={s["dvd-numValor"]}>{conversas !== null ? <Num valor={conversas} formatar={numero} contar={entrada} /> : null}</div>
        <p className={s["dvd-numApoio"]}>
          <Variacao tendencia={resumo.conversas} />
          <span>{resumo.leadsNovos.atual !== null ? `${numero(resumo.leadsNovos.atual)} novas` : ""}</span>
        </p>
      </CartaoNumero>

      <CartaoNumero
        id="mensagens"
        titulo="Mensagens"
        como={COMO_CONTAMOS.mensagens}
        extra={resumo.janetePctEnviadas !== null ? `${porcentagem(resumo.janetePctEnviadas)} pela Janete` : undefined}
        ordem={ordemBase + 1}
        grafico={<Faixa serie={resumo.series.enviadas} serie2={resumo.series.recebidas} rotulo="Enviadas" rotulo2="Recebidas" formatar={numero} />}
        graficoEmbaixo
        {...comum}
      >
        <div className={s["dvd-numDuplo"]}>
          <div>
            <small>recebidas</small>
            <div className={s["dvd-numValor"]} data-duplo="">
              {recebidas !== null ? <Num valor={recebidas} formatar={numero} contar={entrada} /> : null}
              <Variacao tendencia={resumo.recebidas} rotulo="recebidas contra o período anterior" />
            </div>
          </div>
          <div>
            <small>enviadas</small>
            <div className={s["dvd-numValor"]} data-duplo="">
              {enviadas !== null ? <Num valor={enviadas} formatar={numero} contar={entrada} /> : null}
              <Variacao tendencia={resumo.enviadas} rotulo="enviadas contra o período anterior" />
            </div>
          </div>
        </div>
      </CartaoNumero>

      <CartaoNumero
        id="tempo"
        titulo="Tempo de resposta"
        como={comoTempo}
        ordem={ordemBase + 2}
        grafico={<Faixa serie={resumo.series.respostaJaneteS} rotulo="Mediana da Janete, em segundos" formatar={tempoTxt} />}
        {...comum}
      >
        <div className={s["dvd-numValor"]}>
          {primeira !== null ? <Num valor={primeira} formatar={tempoTxt} contar={entrada} /> : <span className={s["dvd-numApoio"]}>sem 1ª resposta medida</span>}
        </div>
        <p className={s["dvd-numApoio"]}>
          <Variacao tendencia={resumo.primeiraRespostaS} />
          <span>{janete !== null ? `a Janete responde em ${tempoTxt(janete)}` : "a Janete ainda não respondeu"}</span>
        </p>
      </CartaoNumero>

      {admin && custo ? (
        <CartaoNumero
          id="custo"
          titulo="Custo de IA"
          como={COMO_CONTAMOS.custo}
          ordem={ordemBase + 3}
          grafico={resumo.series.custoUsd ? <Faixa serie={resumo.series.custoUsd} rotulo="Custo de IA, em dólar" formatar={dinheiro} /> : null}
          {...comum}
        >
          <div className={s["dvd-numValor"]}>{custo.total.atual !== null ? <Num valor={custo.total.atual} formatar={dinheiro} contar={entrada} /> : null}</div>
          <p className={s["dvd-numApoio"]}>
            <Variacao tendencia={custo.total} custo />
            <span>
              {custo.porConversaUsd !== null ? `${dinheiro(custo.porConversaUsd)} por conversa` : "sem resposta da Janete no período"}
              {idPeriodo === "30d" && custo.previsaoMesUsd !== null ? (
                <span className={s["dvd-soMuitoLargo"]}>{` · previsão do mês ${dinheiro(custo.previsaoMesUsd, { casas: 0 })}`}</span>
              ) : null}
            </span>
          </p>
        </CartaoNumero>
      ) : (
        <CartaoNumero
          id="autonomia"
          titulo="Resolvidas só pela Janete"
          como={COMO_CONTAMOS.autonomia}
          ordem={ordemBase + 3}
          grafico={autonomia !== null ? <BarraJaneteEquipe pct={autonomia} /> : null}
          {...comum}
        >
          <div className={s["dvd-numValor"]}>{autonomia !== null ? <Num valor={autonomia} formatar={porcentagem} contar={entrada} /> : null}</div>
          <p className={s["dvd-numApoio"]}>
            <Variacao tendencia={resumo.autonomiaPct} />
            <span>
              {`${numero(resumo.passados.janetePassou)} passadas à equipe`}
              {resumo.passados.falha > 0 ? ` · ${numero(resumo.passados.falha)} por falha` : null}
            </span>
          </p>
        </CartaoNumero>
      )}
    </div>
  );
});
