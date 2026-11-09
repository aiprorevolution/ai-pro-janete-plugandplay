import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ListFilter, Search, X } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";

import { ESPERA_LONGA_S, nomeDoContato, resumoMensagem } from "../comum/LinhaConversa";
import { MenuSuspenso, type ItemMenu } from "../comum/MenuSuspenso";
import { segundosDesde } from "../comum/tempo";
import {
  FILTROS_CHAT,
  normalizarBuscaChat,
  useContadoresChat,
  useDigitandoChat,
  useLinhaChat,
  useListaChat,
  type FiltroChat,
  type LinhaChatDados,
} from "../dados/chat";
import { Carregando, ErroLeitura } from "../dados/estados";
import { useDados } from "../dados/ProvedorDados";
import { conversasPorRecencia, nomeDoMembro, type EstadoBase, type Etapa, type Membro } from "../exemplo";
import { LinhaChat, type PreviaBusca } from "./LinhaChat";
import estilos from "./Lista.module.css";

const s = estilos as Classes<
  | "liCol"
  | "liCab"
  | "liChipLinha"
  | "liChip"
  | "liChipNome"
  | "liChipConta"
  | "liChipX"
  | "liAncora"
  | "liBusca"
  | "liBuscaIcone"
  | "liBuscaCampo"
  | "liLimpar"
  | "liDiv"
  | "liFiltro"
  | "liAlerta"
  | "liRolo"
  | "liLinhas"
  | "liVazio"
  | "liEsboco"
  | "liCurto"
  | "liVazioTitulo"
  | "liVazioTexto"
  | "liVazioAcao"
  | "liEstado"
  | "liMais"
  | "liSr"
>;

// A coluna 1 do Chat (rodada 2): a busca com UM botão de filtro dentro dela e uma lista só, pela
// mensagem mais recente. Os antigos blocos ("Precisam de você", "Com a equipe", "Com a Janete") viraram
// opções do filtro. Quando alguém espera, o botão do filtro ganha um ponto amarelo (menos de 10 min)
// ou vermelho (10 min ou mais). Sem título visível: a seção leva o h2 "Conversas" para o leitor de tela.
//
// Os dados vêm da camada de dados (dados/chat.ts): a lista paginada do filtro e da busca, os
// contadores dos filtros e "Precisam de você" (useAguardando), igual no banco e no exemplo.

/* ---------- filtros ---------- */

export type FiltroLista = FiltroChat;

const NOME_FILTRO: Record<FiltroLista, string> = {
  todas: "Todas",
  aguardando: "Precisam de você",
  nao_lidas: "Não lidas",
  comigo: "Comigo",
  equipe: "Com a equipe",
  janete: "Com a Janete",
};

const VAZIO_FILTRO: Record<FiltroLista, readonly [string, string]> = {
  todas: ["Nenhuma conversa", "As conversas aparecem aqui quando os leads escreverem."],
  aguardando: ["Ninguém esperando", "A Janete está dando conta de todas as conversas agora."],
  nao_lidas: ["Tudo lido", "Nenhuma conversa com mensagem nova agora."],
  comigo: ["Nenhuma conversa com você", "Quando você assumir ou responder uma conversa, ela aparece aqui."],
  equipe: ["Ninguém da equipe atendendo agora", "As conversas com uma pessoa da equipe aparecem aqui."],
  janete: ["A Janete não está em nenhuma conversa", "Todas as conversas estão com a equipe."],
};

/** A ordem das conversas na lista, sem busca nem filtro: a mais recente primeiro (só o exemplo e os testes usam). */
export function ordemDaLista(estado: Pick<EstadoBase, "conversas">): string[] {
  return conversasPorRecencia(estado).map((c) => c.id);
}

/* ---------- busca ---------- */

/**
 * Por que a conversa apareceu na busca, quando não é pelo que a linha já mostra: o termo não está no
 * nome nem na última mensagem, mas está na empresa ou no nome do WhatsApp. A ordem é nome, mensagem,
 * empresa e WhatsApp, para não esconder a mensagem quando ela também casa. No banco, a busca também
 * olha as mensagens antigas: a que casou só numa delas fica com a prévia de sempre. Sem busca: `null`.
 */
export function ondeCasou(linha: Pick<LinhaChatDados, "conversa" | "contato" | "ultima">, q: string): PreviaBusca | null {
  if (!q) return null;
  const { contato, conversa: c, ultima } = linha;
  if (normalizarBuscaChat(nomeDoContato(contato)).includes(q)) return null;
  const msg = ultima ? resumoMensagem(ultima) : c.ultima_mensagem_preview;
  if (msg && normalizarBuscaChat(msg).includes(q)) return null;
  const empresa = contato.empresa?.trim();
  if (empresa && normalizarBuscaChat(empresa).includes(q)) return { texto: `Empresa: ${empresa}`, aria: "Encontrada pela empresa." };
  const zap = contato.nome_whatsapp?.trim();
  if (zap && normalizarBuscaChat(zap).includes(q)) {
    return { texto: `No WhatsApp: ${zap}`, aria: "Encontrada pelo nome no WhatsApp." };
  }
  return null;
}

const curto = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const conversas = (n: number) => `${n} ${n === 1 ? "conversa" : "conversas"}`;

/** A posição da conversa na ordem da lista (a mensagem mais recente primeiro). */
function recencia(l: LinhaChatDados): number {
  const t = Date.parse(l.conversa.ultima_mensagem_em ?? l.conversa.criado_em);
  return Number.isFinite(t) ? t : 0;
}

/* ---------- a lista ---------- */

type Props = {
  /** A conversa aberta (fica em cinza suave). */
  selecionadaId: string | null;
  aoAbrir: (conversaId: string) => void;
  /** O relógio comum das linhas (um intervalo só, na TelaChat). */
  agora: number;
  className?: string | undefined;
};

export function Lista({ selecionadaId, aoAbrir, agora, className }: Props) {
  const dados = useDados();
  const { membro: eu } = dados.useEu();
  const membros = dados.useMembros().dados;
  const etapas = dados.useEtapas().dados;
  const aguardando = dados.useAguardando().dados;
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroLista>("todas");
  const [anuncio, setAnuncio] = useState("");
  const base = useId();
  const idTitulo = `${base}-titulo`;
  const idBusca = `${base}-busca`;
  const campo = useRef<HTMLInputElement>(null);
  const euId = eu.id;

  const q = normalizarBuscaChat(busca);
  const lista = useListaChat(filtro, busca);
  const contadores = useContadoresChat();

  // A linha aberta a partir da lista filtrada fica à vista enquanto o filtro não muda, mesmo que saia
  // dele (abrir marca como lida e tira de "Não lidas"; assumir tira de "Precisam de você"): a
  // conversa não some debaixo de quem está nela, e o foco não cai no body. Trocar de filtro, limpar o
  // filtro ou abrir outra conversa solta a linha.
  const [fixadaId, setFixadaId] = useState<string | null>(null);
  useEffect(() => {
    if (fixadaId && selecionadaId && selecionadaId !== fixadaId) setFixadaId(null);
  }, [selecionadaId, fixadaId]);

  const doFiltro = lista.dados;
  const fixadaFora = !!fixadaId && !!doFiltro && !doFiltro.some((l) => l.conversa.id === fixadaId);
  const fixada = useLinhaChat(fixadaFora ? fixadaId : null).dados;

  const visiveis = useMemo(() => {
    const linhas = doFiltro ?? [];
    // A fixada que saiu do filtro volta no lugar dela na ordem (com a busca, só se ainda casar com ela).
    if (!fixadaFora || !fixada || (q && !ondeCasaComBusca(fixada, q))) return linhas;
    const t = recencia(fixada);
    const i = linhas.findIndex((l) => recencia(l) < t);
    return i < 0 ? [...linhas, fixada] : [...linhas.slice(0, i), fixada, ...linhas.slice(i)];
  }, [doFiltro, fixada, fixadaFora, q]);
  const ordem = visiveis.map((l) => l.conversa.id);
  // A etiqueta conta só as do filtro, como o menu (a linha fixada não entra). Com busca, as achadas.
  const nNoFiltro = q ? (doFiltro?.length ?? 0) : (contadores.dados?.[filtro] ?? doFiltro?.length ?? 0);
  const idLinha = (conversaId: string) => `${base}-ci-${conversaId}`;

  // Uma parada de Tab só na lista: a última linha focada (as setas andam entre elas), senão a aberta,
  // senão a 1ª. As outras ficam com tabIndex -1 e recebem o foco pelas setas.
  const [focadaId, setFocadaId] = useState<string | null>(null);
  const tabId =
    (focadaId && ordem.includes(focadaId) ? focadaId : null) ??
    (selecionadaId && ordem.includes(selecionadaId) ? selecionadaId : null) ??
    ordem[0] ??
    null;

  // Quem espera alguém: o contador do filtro e o ponto no botão (vermelho se alguém espera há 10 min ou mais).
  const esperando = aguardando ?? [];
  const aguardandoN = esperando.length;
  const atrasadasN = esperando.filter((c) => segundosDesde(c.aguardando_humano_desde, agora) >= ESPERA_LONGA_S).length;
  const corAlerta: "amarelo" | "vermelho" | null = !aguardandoN ? null : atrasadasN > 0 ? "vermelho" : "amarelo";

  const itensMenu: ItemMenu[] = FILTROS_CHAT.map((f) => ({
    id: f,
    texto: NOME_FILTRO[f],
    contador: f === "aguardando" ? aguardandoN : contadores.dados?.[f],
    tom: f === "aguardando" && aguardandoN > 0 ? "atencao" : undefined,
  }));

  const ligado = filtro !== "todas";
  const rotuloFiltro = [
    "Filtrar conversas",
    ligado ? `Filtro ligado: ${NOME_FILTRO[filtro]}` : "",
    aguardandoN ? `${conversas(aguardandoN)} ${aguardandoN === 1 ? "precisa" : "precisam"} de você` : "",
    // o ponto vermelho, em palavras
    atrasadasN ? `${atrasadasN === 1 ? "1 espera" : `${atrasadasN} esperam`} há 10 min ou mais` : "",
  ]
    .filter(Boolean)
    .join(". ");

  // O anúncio do filtro novo espera a lista dele chegar (no banco, ela vem depois): "N conversas".
  const [anunciarFiltro, setAnunciarFiltro] = useState<FiltroLista | null>(null);
  useEffect(() => {
    if (!anunciarFiltro || anunciarFiltro !== filtro || lista.carregando) return;
    setAnunciarFiltro(null);
    if (lista.erro) return;
    const n = lista.dados?.length ?? 0;
    setAnuncio(filtro === "todas" ? "Mostrando todas as conversas." : `Filtro ligado: ${NOME_FILTRO[filtro]}. ${conversas(n)}.`);
  }, [anunciarFiltro, filtro, lista.carregando, lista.erro, lista.dados]);

  const escolherFiltro = (id: string) => {
    const f = id as FiltroLista;
    setFiltro(f);
    setFixadaId(null);
    setAnunciarFiltro(f);
  };

  const limparFiltro = () => {
    setFiltro("todas");
    setFixadaId(null);
    setAnunciarFiltro(null);
    setAnuncio("Filtro desligado. Mostrando todas as conversas.");
    campo.current?.focus();
  };

  const limparBusca = () => {
    setBusca("");
    campo.current?.focus();
  };

  // Abrir pela linha com o filtro ligado fixa a linha (ver fixadaId).
  const abrirLinha = (conversaId: string) => {
    setFixadaId(filtro !== "todas" ? conversaId : null);
    aoAbrir(conversaId);
  };

  // O leitor de tela ouve quantas conversas sobraram, ~500 ms depois da última tecla (cada tecla
  // cancela a anterior). Com o filtro ligado, cita o filtro. Busca apagada: "Mostrando todas".
  const nVisiveis = useRef(0);
  nVisiveis.current = visiveis.length;
  const prontaAgora = useRef(false);
  prontaAgora.current = !lista.carregando && !lista.erro;
  const filtroAgora = useRef(filtro);
  filtroAgora.current = filtro;
  const qAntes = useRef(q);
  useEffect(() => {
    if (q === qAntes.current) return;
    const tinha = qAntes.current;
    qAntes.current = q;
    if (!q) {
      // Sem filtro, todas voltam; com ele, só limpa (o filtro continua valendo).
      if (tinha) setAnuncio(filtroAgora.current === "todas" ? "Mostrando todas as conversas." : "");
      return;
    }
    let t = 0;
    const falar = () => {
      // No banco, a busca pode ainda estar a caminho: espera mais um pouco.
      if (!prontaAgora.current) {
        t = window.setTimeout(falar, 250);
        return;
      }
      const n = nVisiveis.current;
      const f = filtroAgora.current;
      const onde = f !== "todas" ? ` em ${NOME_FILTRO[f]}` : "";
      setAnuncio(n ? `${conversas(n)}${onde}.` : `Nada encontrado${onde}.`);
    };
    t = window.setTimeout(falar, 500);
    return () => window.clearTimeout(t);
  }, [q]);

  const focarLinha = (conversaId: string | undefined) => {
    if (conversaId) document.getElementById(idLinha(conversaId))?.focus();
  };

  const teclaBusca = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Escape" && busca) {
      ev.preventDefault();
      setBusca("");
    } else if (ev.key === "ArrowDown" && ordem[0]) {
      ev.preventDefault();
      focarLinha(ordem[0]);
    }
  };

  // Setas, Home e End andam entre as linhas; seta para cima na 1ª volta para a busca.
  const teclaLinha = (conversaId: string) => (ev: KeyboardEvent<HTMLButtonElement>) => {
    const i = ordem.indexOf(conversaId);
    let alvo: string | undefined;
    if (ev.key === "ArrowDown") alvo = ordem[Math.min(ordem.length - 1, i + 1)];
    else if (ev.key === "ArrowUp") alvo = i === 0 ? undefined : ordem[Math.max(0, i - 1)];
    else if (ev.key === "Home") alvo = ordem[0];
    else if (ev.key === "End") alvo = ordem[ordem.length - 1];
    if (ev.key === "ArrowUp" && i === 0) {
      ev.preventDefault();
      campo.current?.focus();
      return;
    }
    if (alvo) {
      ev.preventDefault();
      focarLinha(alvo);
    }
  };

  // O estado vazio: sem conversa nenhuma, nada na busca, ou nada no filtro.
  const nenhumaAinda = contadores.dados ? contadores.dados.todas === 0 : !q && filtro === "todas" && !!doFiltro && !doFiltro.length;
  let vazio: { titulo: string; texto: string; acao?: { texto: string; fazer: () => void } | undefined } | null = null;
  if (lista.carregando || lista.erro) {
    vazio = null;
  } else if (nenhumaAinda && !visiveis.length) {
    vazio = {
      titulo: "Nenhuma conversa ainda",
      texto: "Quando um lead mandar mensagem para o número conectado, a conversa aparece aqui na hora.",
    };
  } else if (q && !visiveis.length) {
    vazio = {
      titulo: `Nada encontrado para “${curto(busca.trim(), 24)}”`,
      texto: "Confira o nome ou busque pela empresa do lead.",
      acao: { texto: "Limpar a busca", fazer: limparBusca },
    };
  } else if (!visiveis.length) {
    const [titulo, texto] = VAZIO_FILTRO[filtro];
    vazio = { titulo, texto, acao: ligado ? { texto: "Ver todas", fazer: limparFiltro } : undefined };
  }

  let corpo;
  if (lista.carregando && !visiveis.length) {
    corpo = <Carregando forma="lista" quantos={6} rotulo="Carregando as conversas" className={s.liEstado} />;
  } else if (lista.erro && !visiveis.length) {
    corpo = (
      <div className={s.liEstado}>
        <ErroLeitura erro={lista.erro} titulo="Não deu para carregar as conversas" tentarDeNovo={lista.tentarDeNovo} compacto />
      </div>
    );
  } else if (vazio) {
    corpo = (
      <div className={s.liVazio}>
        <div className={s.liEsboco} aria-hidden="true">
          <span className={s.liCurto} />
          <span />
          <span className={s.liCurto} />
        </div>
        <h3 className={s.liVazioTitulo}>{vazio.titulo}</h3>
        <p className={s.liVazioTexto}>{vazio.texto}</p>
        {vazio.acao ? (
          <button type="button" className={s.liVazioAcao} onClick={vazio.acao.fazer}>
            {vazio.acao.texto}
          </button>
        ) : null}
      </div>
    );
  } else {
    corpo = (
      <>
        <div className={s.liLinhas} role="list" aria-label="Conversas">
          {visiveis.map((l) => (
            <LinhaDaLista
              key={l.conversa.id}
              linha={l}
              membros={membros}
              eu={eu}
              etapas={etapas}
              id={idLinha(l.conversa.id)}
              selecionada={l.conversa.id === selecionadaId}
              aoAbrir={abrirLinha}
              agora={agora}
              tabIndex={l.conversa.id === tabId ? 0 : -1}
              previaBusca={ondeCasou(l, q)}
              aoFocar={setFocadaId}
              onKeyDown={teclaLinha(l.conversa.id)}
            />
          ))}
        </div>
        {lista.temMais ? (
          <button type="button" className={s.liMais} onClick={lista.carregarMais} disabled={lista.carregandoMais}>
            {lista.carregandoMais ? "Carregando…" : "Carregar mais conversas"}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section className={cx(s.liCol, className)} aria-labelledby={idTitulo}>
      {/* O h1 da área é o da VistaArea (o tour e os atalhos da Janete focam nele); este dá nome à coluna. */}
      <h2 id={idTitulo} className={s.liSr}>
        Conversas
      </h2>
      <div className={s.liCab}>
        <div className={s.liAncora}>
          <div className={s.liBusca}>
            <Search className={s.liBuscaIcone} size={17} strokeWidth={1.75} aria-hidden="true" />
            <label htmlFor={idBusca} className={s.liSr}>
              Buscar por nome, empresa ou mensagem
            </label>
            <input
              ref={campo}
              id={idBusca}
              type="text"
              className={s.liBuscaCampo}
              placeholder="Buscar conversa"
              autoComplete="off"
              value={busca}
              onChange={(ev) => setBusca(ev.target.value)}
              onKeyDown={teclaBusca}
            />
            {busca ? (
              <button type="button" className={s.liLimpar} aria-label="Limpar a busca" onClick={limparBusca}>
                <X size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
            <span className={s.liDiv} aria-hidden="true" />
            <MenuSuspenso
              rotulo={rotuloFiltro}
              titulo="Mostrar"
              itens={itensMenu}
              valor={filtro}
              aoEscolher={escolherFiltro}
              icone={<ListFilter size={20} strokeWidth={1.75} aria-hidden="true" />}
              // Sem o destaque de "filtro ligado": a etiqueta embaixo da busca já diz o filtro, e o canto
              // do botão fica só para o ponto de quem espera (antes eram 2 pontos no mesmo canto).
              alinhar="largura"
              className={s.liFiltro}
            />
            {/* O ponto de quem espera, no canto do botão do filtro (o MenuSuspenso é comum: o ponto fica aqui). */}
            {corAlerta ? <span className={s.liAlerta} data-cor={corAlerta} aria-hidden="true" /> : null}
          </div>
        </div>
        {ligado ? (
          <div className={s.liChipLinha}>
            <button
              type="button"
              className={s.liChip}
              aria-label={`${NOME_FILTRO[filtro]}, ${conversas(nNoFiltro)}. Limpar o filtro e mostrar todas`}
              onClick={limparFiltro}
            >
              <span className={s.liChipNome}>{NOME_FILTRO[filtro]}</span>
              <span className={s.liChipConta}>{nNoFiltro}</span>
              <span className={s.liChipX} aria-hidden="true">
                <X size={14} strokeWidth={2.2} />
              </span>
            </button>
          </div>
        ) : null}
      </div>

      <div className={s.liRolo}>{corpo}</div>
      <p className={s.liSr} role="status" aria-live="polite">
        {anuncio}
      </p>
    </section>
  );
}

/** A fixada ainda casa com a busca (o mesmo texto que a busca do exemplo olha). */
function ondeCasaComBusca(l: LinhaChatDados, q: string): boolean {
  const { contato, conversa: c, ultima } = l;
  return normalizarBuscaChat(
    [contato.nome, contato.nome_whatsapp, contato.empresa, ultima ? resumoMensagem(ultima) : c.ultima_mensagem_preview]
      .filter(Boolean)
      .join(" "),
  ).includes(q);
}

/** Uma linha: junta o contato, a última mensagem, quem atende e a etapa para a LinhaChat. */
function LinhaDaLista({
  linha,
  membros,
  eu,
  etapas,
  id,
  selecionada,
  aoAbrir,
  agora,
  tabIndex,
  previaBusca,
  aoFocar,
  onKeyDown,
}: {
  linha: LinhaChatDados;
  membros: readonly Membro[] | undefined;
  eu: Membro;
  etapas: readonly Etapa[] | undefined;
  id: string;
  selecionada: boolean;
  aoAbrir: (conversaId: string) => void;
  agora: number;
  tabIndex: 0 | -1;
  previaBusca: PreviaBusca | null;
  aoFocar: (conversaId: string) => void;
  onKeyDown: (ev: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { conversa, contato, ultima } = linha;
  const digitando = useDigitandoChat(conversa.id);
  const pessoas = { membros: [...(membros ?? [])], eu };
  const etapa = etapas?.find((e) => e.id === contato.etapa_id);
  const responsavel = conversa.responsavel_id ? pessoas.membros.find((m) => m.id === conversa.responsavel_id) : undefined;
  const autorUltima = ultima?.origem === "humano_tela" ? nomeDoMembro(pessoas, ultima.autor_membro_id) : undefined;
  const estavaCom = conversa.estavaCom ? nomeDoMembro(pessoas, conversa.estavaCom) || null : null;
  return (
    <LinhaChat
      id={id}
      conversa={conversa}
      contato={contato}
      ultima={ultima}
      autorUltima={autorUltima || undefined}
      digitando={digitando}
      responsavel={responsavel ? { id: responsavel.id, nome: responsavel.nome } : null}
      estavaCom={estavaCom}
      etapa={etapa ? { nome: etapa.nome, tipo: etapa.tipo } : null}
      euId={eu.id}
      selecionada={selecionada}
      agora={agora}
      aoAbrir={aoAbrir}
      tabIndex={tabIndex}
      previaBusca={previaBusca ?? undefined}
      onFocus={() => aoFocar(conversa.id)}
      onKeyDown={onKeyDown}
    />
  );
}
