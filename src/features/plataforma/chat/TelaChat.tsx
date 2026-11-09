import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, CircleAlert, Trash2, UserCheck, X } from "lucide-react";

import { type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { VistaArea } from "../AreaVazia";
import { Gaveta } from "../comum/Gaveta";
import { useAbrirPorId } from "../dados/abrirPorId";
import { useBuscarConversaChat, useListaChat } from "../dados/chat";
import { useContato, useConversa } from "../dados/conversa";
import { Carregando, ErroLeitura } from "../dados/estados";
import { useDados } from "../dados/ProvedorDados";
import { Conversa } from "./Conversa";
import { Ficha } from "./Ficha";
import { Lista } from "./Lista";
import type { Avisar, TomAviso } from "./aviso";
import estilos from "./TelaChat.module.css";

const s = estilos as Classes<
  | "tcRaiz"
  | "tcTorre"
  | "tcColChat"
  | "tcColFicha"
  | "tcVazio"
  | "tcVazioTitulo"
  | "tcVazioTexto"
  | "tcCheia"
  | "tcFolha"
  | "tcAviso"
  | "tcAvisoTexto"
  | "tcAvisoFechar"
  | "tcSr"
>;

// A tela do Chat (Chat final): as 3 colunas da "torre de controle", lista | conversa | ficha.
// - A partir de 1280 px, as 3 juntas (a ficha fecha e abre pelo botão da conversa);
// - de 900 a 1279, a lista e a conversa; a ficha vira uma gaveta presa à torre, logo abaixo do
//   cabeçalho da conversa (como no protótipo, "para nunca cobrir o bastão"): sem véu e sem prender o foco;
// - abaixo de 900, a lista é a 1ª tela; a conversa abre em tela cheia com "voltar" e a ficha numa
//   folha que sobe de baixo.
// A conversa do meio é da task C2 (./Conversa). O h1 da área é o da VistaArea, escondido da vista:
// o tour e os atalhos da Janete focam nele; o título visível é o da lista, como no protótipo.

export type LarguraChat = "larga" | "media" | "estreita";

const LARGA = "(min-width: 1280px)";
const ESTREITA = "(max-width: 899px)";

function consulta(q: string): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : null;
  } catch {
    return null;
  }
}

function assinar(avisar: () => void): () => void {
  const listas = [consulta(LARGA), consulta(ESTREITA)].filter((x): x is MediaQueryList => !!x);
  for (const mq of listas) {
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", avisar);
    else mq.addListener(avisar);
  }
  return () => {
    for (const mq of listas) {
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", avisar);
      else mq.removeListener(avisar);
    }
  };
}

function larguraAgora(): LarguraChat {
  if (consulta(LARGA)?.matches) return "larga";
  if (consulta(ESTREITA)?.matches) return "estreita";
  return "media";
}

/** Em qual das 3 larguras do Chat a tela está. Fora do navegador, a média (só lista e conversa). */
export function useLarguraChat(): LarguraChat {
  return useSyncExternalStore(assinar, larguraAgora, () => "media");
}

/** A busca da rota /app/chat: `?conversa=<id>` abre o Chat com essa conversa (o "Abrir no Chat" dos Contatos). */
export type BuscaChat = { conversa?: string | undefined };

export function validarBuscaChat(busca: Record<string, unknown>): BuscaChat {
  const conversa = busca["conversa"];
  return { conversa: typeof conversa === "string" && conversa.trim() ? conversa.trim() : undefined };
}

/** O ícone do aviso curto, pelo tom (como o `.toast` do protótipo escolhe por mensagem). */
function IconeAviso({ tom }: { tom: TomAviso }) {
  const p = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;
  if (tom === "erro") return <CircleAlert {...p} />;
  if (tom === "pessoa") return <UserCheck {...p} />;
  if (tom === "lixo") return <Trash2 {...p} />;
  return <CheckCircle2 {...p} />;
}

/** Folga do tique, para ele cair logo depois da virada do minuto, e não logo antes. */
const FOLGA_TIQUE_MS = 50;

/**
 * Quantos ms faltam para o próximo tique: a próxima virada de minuto do relógio (o "Hoje", o "Ontem"
 * e a hora da lista) ou do tempo de espera de alguma conversa ("há 13 min", e a virada para vermelho
 * aos 10 min, que é múltiplo de 60 s), a que vier primeiro.
 */
export function proximoTique(agora: number, esperas: readonly (string | null)[]): number {
  let falta = 60_000 - (((agora % 60_000) + 60_000) % 60_000);
  for (const desde of esperas) {
    const d = desde ? Date.parse(desde) : Number.NaN;
    if (!Number.isFinite(d)) continue;
    const corrido = agora - d;
    // Espera que começa no futuro (relógios desencontrados): o tempo fica em 0 até lá.
    const f = corrido < 0 ? -corrido : 60_000 - (corrido % 60_000);
    if (f < falta) falta = f;
  }
  return falta + FOLGA_TIQUE_MS;
}

/**
 * O relógio comum da tela. Nada no Chat mostra segundos: ele só anda quando algum minuto vira (o do
 * relógio ou o da espera de alguma conversa), em vez de redesenhar a tela inteira a cada segundo.
 * `esperas` são os `aguardando_humano_desde` das conversas que esperam, juntados por "|".
 */
function useRelogio(esperas: string): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const lista = esperas ? esperas.split("|") : [];
    let id = 0;
    const agendar = () => {
      id = window.setTimeout(() => {
        setAgora(Date.now());
        agendar();
      }, proximoTique(Date.now(), lista));
    };
    setAgora(Date.now());
    agendar();
    return () => window.clearTimeout(id);
  }, [esperas]);
  return agora;
}

/**
 * O próximo foco em `el` é do programa, não de quem olha: a Conversa não o conta como interação na
 * conversa que abriu sozinha (o mesmo atributo do FOCO_DO_PROGRAMA dela). A marca sai no foco ou, se
 * ele não vier, um instante depois.
 */
function focoDoPrograma(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.setAttribute("data-foco-programa", "");
  window.setTimeout(() => el.removeAttribute("data-foco-programa"), 200);
}

type PropsTela = {
  /**
   * A conversa pedida pelo endereço (`?conversa=`). Na página carregada, abre na hora; fora dela, é
   * procurada no banco (useAbrirPorId). Um id que não existe é ignorado: abre a 1ª da lista.
   */
  conversaInicial?: string | undefined;
};

export function TelaChat({ conversaInicial }: PropsTela = {}) {
  const dados = useDados();
  const navigate = useNavigate();
  const largura = useLarguraChat();
  // A lista sem filtro (a mesma leitura da Lista com "Todas"): a 1ª conversa ao entrar e a próxima ao apagar.
  const listaTodas = useListaChat("todas", "");
  const linhasTodas = listaTodas.dados;
  const ordem = useMemo(() => (linhasTodas ?? []).map((l) => l.conversa.id), [linhasTodas]);
  const listaPronta = !!linhasTodas;
  const aguardando = dados.useAguardando().dados;
  const agora = useRelogio((aguardando ?? []).map((c) => c.aguardando_humano_desde ?? "").join("|"));
  const buscarConversa = useBuscarConversaChat();

  // O pedido do endereço: na página carregada, abre na hora; fora dela (a lista tem mais páginas), a
  // tela espera a busca no banco antes de abrir a 1ª da lista sozinha.
  const pedida = conversaInicial && ordem.includes(conversaInicial) ? conversaInicial : null;
  const [foraResolvido, setForaResolvido] = useState<string | null>(null);
  const esperandoPedido =
    !!conversaInicial && !pedida && (!listaPronta || (listaTodas.temMais && foraResolvido !== conversaInicial));

  // A conversa aberta: no começo, a pedida pelo endereço ou a primeira da lista (a da mensagem mais recente).
  const [selId, setSelId] = useState<string | null>(() => pedida ?? (esperandoPedido ? null : (ordem[0] ?? null)));
  // A conversa aberta foi escolhida pela tela (a 1ª da lista ao entrar, ou a próxima depois de apagar),
  // e não por quem olha: ela só vira lida na 1ª interação dentro dela (adiarLida da Conversa). Fica aqui,
  // e não na Conversa, para a interação valer mesmo se a conversa sair da tela e voltar.
  const [abertaSozinha, setAbertaSozinha] = useState(() => !pedida);
  // A Conversa só avisa com adiarLida ligado; o React ignora o false repetido.
  const aoInteragir = useCallback(() => setAbertaSozinha(false), []);
  // A ficha como coluna (computador): aberta por padrão. A gaveta e a folha começam fechadas.
  const [colunaAberta, setColunaAberta] = useState(true);
  const [gaveta, setGaveta] = useState(false);
  // No celular, a conversa em tela cheia por cima da lista.
  const [cheia, setCheia] = useState(false);
  const [aviso, setAviso] = useState<{ id: number; texto: string; tom: TomAviso } | null>(null);
  const idAviso = useRef(0);
  const colChat = useRef<HTMLDivElement>(null);
  const cheiaRef = useRef<HTMLDivElement>(null);
  const torre = useRef<HTMLDivElement>(null);

  const convSel = useConversa(selId);
  // Enquanto a conversa aberta carrega, ela conta como aberta (a Conversa mostra o próprio "carregando").
  const sumiu = !!selId && !convSel.carregando && !convSel.erro && convSel.dados === null;
  const selecionada = selId && !sumiu ? selId : null;
  const contatoSel = useContato(convSel.dados?.contato_id).dados;

  // Ao entrar (a lista chegou) sem conversa aberta, a 1ª da lista abre sozinha; a que sumiu (apagada
  // por outra pessoa, ou um id do endereço que não existe mais) dá lugar à 1ª que sobrou.
  useEffect(() => {
    if (!listaPronta || esperandoPedido) return;
    if (!selId) {
      if (ordem[0]) {
        setSelId(ordem[0]);
        setAbertaSozinha(true);
      }
      return;
    }
    if (sumiu) {
      setSelId(ordem.find((id) => id !== selId) ?? null);
      setAbertaSozinha(true);
    }
  }, [listaPronta, esperandoPedido, selId, sumiu, ordem]);

  // Marcar como lida é da Conversa: ela só monta quando está à vista (no celular, em tela cheia).

  // Fora do celular não há tela cheia; e a gaveta só existe abaixo de 1280.
  useEffect(() => {
    if (largura !== "estreita") setCheia(false);
    if (largura === "larga") setGaveta(false);
  }, [largura]);

  // A gaveta presa (900 a 1279 px) começa logo abaixo do cabeçalho da conversa, que muda de altura
  // (o bastão quebra linha, a faixa do exemplo): mede e passa em --gv-topo, direto no estilo da torre
  // (sem re-render). Sem ResizeObserver, fica o topo padrão do CSS. Mede antes da pintura, para a
  // ficha não aparecer um quadro com o topo padrão e pular (com "reduzir movimento" o pulo se veria).
  const gavetaPresa = largura === "media" && gaveta && !!selecionada;
  useLayoutEffect(() => {
    const el = torre.current;
    const cab = colChat.current?.querySelector<HTMLElement>("header");
    if (!gavetaPresa || !el || !cab) return;
    const medir = () => el.style.setProperty("--gv-topo", `${cab.offsetTop + cab.offsetHeight + 8}px`);
    medir();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(medir);
    ro.observe(cab);
    return () => ro.disconnect();
  }, [gavetaPresa, selId]);

  // A ficha presa cobre a direita da conversa (o enviar e o microfone da caixa de escrever ficam por
  // baixo) e não prende o Tab: se o foco cair em algo da conversa coberto por ela, a ficha recolhe e o
  // foco fica onde foi (a Gaveta ancorada não puxa o foco de volta quando ele está fora). O cabeçalho,
  // com o bastão e o botão da ficha, fica acima do topo da ficha e não é afetado.
  useEffect(() => {
    const col = colChat.current;
    if (!gavetaPresa || !col) return;
    const aoFocar = (ev: FocusEvent) => {
      const painel = torre.current?.querySelector<HTMLElement>("[data-ancorada]");
      if (!painel || !(ev.target instanceof HTMLElement)) return;
      const a = ev.target.getBoundingClientRect();
      const p = painel.getBoundingClientRect();
      if (a.right > p.left && a.left < p.right && a.bottom > p.top && a.top < p.bottom) setGaveta(false);
    };
    col.addEventListener("focusin", aoFocar);
    return () => col.removeEventListener("focusin", aoFocar);
  }, [gavetaPresa]);

  const avisar = useCallback<Avisar>((texto, tom = "ok") => {
    idAviso.current += 1;
    setAviso({ id: idAviso.current, texto, tom });
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso((a) => (a?.id === aviso.id ? null : a)), 4200);
    return () => window.clearTimeout(t);
  }, [aviso]);

  /**
   * Foca a linha da conversa na lista. Se ela não estiver à vista (saiu do filtro ou da busca), a 1ª
   * linha que estiver; sem nenhuma, a busca. O foco nunca cai no body.
   */
  const focarNaLista = (id: string | null) => {
    window.setTimeout(() => {
      const alvo =
        (id ? document.querySelector<HTMLElement>(`[data-chat-lista] [id$="-ci-${id}"]`) : null) ??
        document.querySelector<HTMLElement>("[data-chat-lista] button[id*='-ci-']") ??
        document.querySelector<HTMLElement>("[data-chat-lista] input");
      alvo?.focus();
    }, 0);
  };

  /** A lista fica por baixo da conversa em tela cheia: o foco vai para o "voltar". */
  const focarVoltar = () => {
    window.setTimeout(
      () =>
        cheiaRef.current?.querySelector<HTMLElement>('button[aria-label="Voltar para a lista de conversas"]')?.focus(),
      0,
    );
  };

  const abrir = (conversaId: string) => {
    setSelId(conversaId);
    setAbertaSozinha(false);
    if (largura === "estreita") {
      setCheia(true);
      focarVoltar();
    }
  };

  // O pedido pelo endereço vale uma vez por id: abre como um clique na lista (no celular, em tela cheia)
  // e rola a lista até a linha. A largura vem da media query na hora, porque no primeiro quadro a do
  // useLarguraChat ainda pode ser a do servidor (a média).
  const pedidoFeito = useRef<string | null>(null);
  const abrirPedido = useCallback((id: string) => {
    if (pedidoFeito.current === id) return;
    pedidoFeito.current = id;
    setSelId(id);
    setAbertaSozinha(false);
    if (larguraAgora() === "estreita") {
      setCheia(true);
      focarVoltar();
    }
    window.setTimeout(
      () =>
        document.querySelector<HTMLElement>(`[data-chat-lista] [id$="-ci-${id}"]`)?.scrollIntoView?.({ block: "nearest" }),
      0,
    );
  }, []);
  useEffect(() => {
    if (pedida) abrirPedido(pedida);
  }, [pedida, abrirPedido]);

  // O id do endereço: procura na página e, fora dela, no banco (uma leitura por id); depois tira o
  // `?conversa=` do endereço. Não achou (apagada, ou de outra empresa): avisa e abre a 1ª da lista.
  useAbrirPorId(
    conversaInicial,
    async (id) => (ordem.includes(id) ? { id } : await buscarConversa(id)),
    {
      pronto: listaPronta,
      abrir: (c) => {
        setForaResolvido(c.id);
        abrirPedido(c.id);
      },
      limpar: () => void navigate({ to: "/app/chat", search: {}, replace: true }),
      naoAchou: () => {
        if (conversaInicial) setForaResolvido(conversaInicial);
        avisar("Não achamos essa conversa. Ela pode ter sido apagada.", "erro");
      },
    },
  );

  const voltar = useCallback(() => {
    setCheia(false);
    setGaveta(false);
    // O foco volta para a linha da conversa na lista.
    if (selId) focarNaLista(selId);
  }, [selId]);

  const fichaComoColuna = largura === "larga";
  const fichaAberta = fichaComoColuna ? colunaAberta : gaveta;
  const alternarFicha = useCallback(() => {
    if (fichaComoColuna) setColunaAberta((v) => !v);
    else setGaveta((v) => !v);
  }, [fichaComoColuna]);
  /** O botão que abre a ficha, no cabeçalho da conversa (fora do celular). */
  const botaoFicha = () => colChat.current?.querySelector<HTMLButtonElement>("header button[aria-expanded]");
  /** Fecha a gaveta (900 a 1279 px). Ela devolve o foco ao botão da ficha: é do programa, não conta. */
  const fecharGaveta = () => {
    if (gaveta) focoDoPrograma(botaoFicha());
    setGaveta(false);
  };
  const fecharFicha = () => {
    if (fichaComoColuna) {
      setColunaAberta(false);
      // O X some com a coluna: o foco volta para o botão que abre a ficha (do programa: não conta como
      // interação na conversa que abriu sozinha).
      window.setTimeout(() => {
        const botao = botaoFicha();
        focoDoPrograma(botao);
        botao?.focus();
      }, 0);
    } else fecharGaveta();
  };

  const aoApagado = (nome: string) => {
    const resto = ordem.filter((id) => id !== selId);
    const prox = resto[0] ?? null;
    setSelId(prox);
    setAbertaSozinha(true);
    fecharGaveta();
    setCheia(false);
    avisar(`${nome} foi apagado, com a conversa e as mídias.`, "lixo");
    // A ficha remonta e, no celular, a conversa fecha: o foco vai para a próxima conversa ou a busca.
    focarNaLista(prox);
  };

  const nomeFicha = (() => {
    const contato = selecionada ? contatoSel : undefined;
    return contato ? `Ficha de ${contato.nome?.trim() || contato.nome_whatsapp || "lead sem nome"}` : "Ficha do lead";
  })();

  const temConversas = ordem.length > 0;
  const vazioChat =
    !listaPronta && listaTodas.erro ? (
      <div className={s.tcVazio}>
        <ErroLeitura erro={listaTodas.erro} titulo="Não deu para carregar as conversas" tentarDeNovo={listaTodas.tentarDeNovo} />
      </div>
    ) : !listaPronta || (esperandoPedido && !selecionada) ? (
      <div className={s.tcVazio}>
        <Carregando forma="texto" quantos={4} rotulo="Carregando a conversa" />
      </div>
    ) : (
      <div className={s.tcVazio}>
        <JaneteSimbolo estado="dormindo" tamanho={56} decorativo />
        <h2 className={s.tcVazioTitulo}>{temConversas ? "Escolha uma conversa" : "Nenhuma conversa ainda"}</h2>
        <p className={s.tcVazioTexto}>
          {temConversas
            ? "Abra uma conversa da lista para ver as mensagens e a ficha do lead."
            : "Quando um lead escrever, a Janete responde sozinha e a conversa aparece aqui. Você só entra quando ela chamar."}
        </p>
      </div>
    );

  const conversa = selecionada ? (
    <Conversa
      conversaId={selecionada}
      fichaAberta={fichaAberta}
      onAlternarFicha={alternarFicha}
      avisar={avisar}
      agora={agora}
      adiarLida={abertaSozinha}
      aoInteragir={aoInteragir}
      {...(largura === "estreita" ? { onVoltar: voltar } : {})}
    />
  ) : (
    vazioChat
  );

  const ficha = selecionada ? (
    <Ficha
      key={selecionada}
      conversaId={selecionada}
      modo={fichaComoColuna ? "coluna" : "gaveta"}
      aoFechar={fecharFicha}
      aoApagado={aoApagado}
      avisar={avisar}
      agora={agora}
    />
  ) : null;

  const mostraColunaFicha = fichaComoColuna && colunaAberta && !!selecionada;

  return (
    <div
      className={s.tcRaiz}
      data-cheia={cheia || undefined}
      data-folha={largura === "estreita" && gaveta ? "" : undefined}
    >
      <VistaArea area="chat">
        <div ref={torre} className={s.tcTorre} data-ficha={mostraColunaFicha ? "" : undefined} data-largura={largura}>
          {/* Com a conversa em tela cheia (celular), a lista por baixo sai do Tab e do leitor de tela. */}
          <div data-chat-lista="" style={{ display: "contents" }} inert={largura === "estreita" && cheia ? true : undefined}>
            <Lista selecionadaId={largura === "estreita" && !cheia ? null : selId} aoAbrir={abrir} agora={agora} />
          </div>

          {largura !== "estreita" ? (
            <div ref={colChat} className={s.tcColChat}>
              {conversa}
            </div>
          ) : cheia && selecionada ? (
            <div ref={cheiaRef} className={s.tcCheia}>
              {conversa}
            </div>
          ) : null}

          {mostraColunaFicha ? (
            <aside className={s.tcColFicha} aria-label={nomeFicha}>
              {ficha}
            </aside>
          ) : null}

          {/* 900 a 1279 px: a ficha presa à torre, abaixo do cabeçalho da conversa (o bastão fica livre). */}
          {largura === "media" ? (
            <Gaveta ancorada aberta={gavetaPresa} aoFechar={fecharGaveta} rotulo={nomeFicha} largura={340}>
              {ficha}
            </Gaveta>
          ) : null}
        </div>
      </VistaArea>

      {/* No celular, a folha que sobe de baixo (a gaveta modal, com véu). */}
      {largura === "estreita" ? (
        <Gaveta aberta={gaveta && !!selecionada} aoFechar={() => setGaveta(false)} rotulo={nomeFicha} largura={340} className={s.tcFolha}>
          {ficha}
        </Gaveta>
      ) : null}

      {aviso ? (
        <div key={aviso.id} className={s.tcAviso} data-tom={aviso.tom}>
          <IconeAviso tom={aviso.tom} />
          <p className={s.tcAvisoTexto}>{aviso.texto}</p>
          <button type="button" className={s.tcAvisoFechar} aria-label="Fechar o aviso" onClick={() => setAviso(null)}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <p className={s.tcSr} role="status" aria-live="polite">
        {aviso?.texto ?? ""}
      </p>
    </div>
  );
}
