// A lista de vozes da conta da ElevenLabs (spec-voz-uso, contrato F4): um componente comum, usado
// no Fluxo "vozes" da Configuração e na etapa Voz do onboarding. Quem usa passa o `carregar` (a
// função que busca a lista) e decide o que fazer com a escolha; aqui ficam os estados da lista, o
// grupo de opções com setas e a prévia de cada voz, que só toca depois de um clique.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Esqueleto, cx } from "@/components/aipro";
import type { Classes } from "@/components/aipro/cx";
import type { ResultadoListaVozes, VozDaConta, VozEscolhida } from "@/features/servidor/vozes-tipos";

import { IC, MENSAGEM_SEM_RESPOSTA, MENSAGEM_SEM_SESSAO, mensagemDoResultado, separarMensagem } from "./dados";
import { s as sl } from "./estilos";
import { AvisoErro, BotaoCompacto, Icone } from "./pecas";
import { irParaEntrar, sessaoTerminou } from "./sessao";
import estilos from "./SeletorVoz.module.css";

/** Classes do CSS Module da lista de vozes (o v3-seletor-voz confere que cada uma existe). */
const s = estilos as Classes<
  | "seletor"
  | "consultando"
  | "ossos"
  | "osso"
  | "vozes"
  | "grupo"
  | "ouvires"
  | "voz"
  | "ativo"
  | "sobre"
  | "semPrevia"
  | "opcao"
  | "radio"
  | "vozTexto"
  | "vozNome"
  | "vozDetalhe"
  | "selo"
  | "salvando"
  | "ouvir"
  | "mais"
  | "previaErro"
  | "acoes"
>;

/** A busca caiu ou voltou fora do formato (a MENSAGEM_SEM_RESPOSTA fala em "teste", que aqui não há). */
export const MENSAGEM_SEM_VOZES =
  "Não conseguimos buscar as vozes agora. Confira a sua internet e tente de novo em instantes.";

/** Quantas vozes aparecem de início, e quantas a mais a cada "Mostrar mais". */
export const VOZES_INICIAL = 6;
export const VOZES_PASSO = 6;

/** Ícones do botão de ouvir (viewBox 24, traço como os do F). */
const IC_OUVIR = "M7 4.5v15l12-7.5z";
const IC_PARAR = "M7 7h10v10H7z";

export type EstadoListaVozes =
  | { k: "parada" }
  | { k: "carregando" }
  | { k: "pronta"; vozes: VozDaConta[]; atual: VozEscolhida | null }
  | { k: "falhou"; titulo: string; texto: string; semSessao: boolean };

const falhou = (mensagem: string, semSessao = false): EstadoListaVozes => ({
  k: "falhou",
  ...separarMensagem(mensagem),
  semSessao,
});

/**
 * Busca a lista com o `carregar` de quem usa. Sem `carregar` (nulo), fica parada; quando ele
 * aparece (a chave foi aceita), busca uma vez. Trocar uma função por outra não busca de novo: quem
 * quer outra busca chama `recarregar` (assim uma função recriada a cada render não vira laço).
 *
 * Cada busca tem um número: a resposta de uma busca antiga (recarregou, ou a lista foi esquecida)
 * é ignorada. No modo estrito o React monta, desmonta e monta de novo os efeitos: o `montado` é
 * religado na remontagem (o padrão do Cérebro), e a busca não se repete, porque a chave da busca
 * feita fica guardada.
 */
export function useListaVozes(carregar: (() => Promise<ResultadoListaVozes>) | null): {
  estado: EstadoListaVozes;
  recarregar: () => void;
} {
  const ativo = carregar !== null;
  const [estado, setEstado] = useState<EstadoListaVozes>(() => (ativo ? { k: "carregando" } : { k: "parada" }));
  const [vez, setVez] = useState(0);
  const funcao = useRef(carregar);
  funcao.current = carregar;
  const pedido = useRef(0);
  // a busca já feita: "<ativo>:<vez>" (a segunda passada do modo estrito não busca de novo)
  const feita = useRef<string | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    // Religa na (re)montagem: sem isto, no modo estrito o marcador ficava desligado para sempre e
    // toda resposta era ignorada ("Buscando…" sem fim).
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    const chave = `${ativo}:${vez}`;
    if (feita.current === chave) return;
    const primeira = feita.current === null;
    feita.current = chave;
    const n = ++pedido.current;
    const fn = funcao.current;
    if (!fn) {
      if (!primeira) setEstado({ k: "parada" });
      return;
    }
    if (!primeira) setEstado({ k: "carregando" });
    const vale = () => montado.current && n === pedido.current;
    let promessa: Promise<ResultadoListaVozes>;
    try {
      promessa = fn();
    } catch (e) {
      promessa = Promise.reject(e);
    }
    promessa.then(
      (r) => {
        if (!vale()) return;
        // resposta fora do formato (sem objeto ou sem a lista): falha, nunca "Buscando…" sem fim
        if (!r || typeof r !== "object") setEstado(falhou(MENSAGEM_SEM_VOZES));
        else if (r.ok) {
          if (Array.isArray(r.vozes)) setEstado({ k: "pronta", vozes: r.vozes, atual: r.atual ?? null });
          else setEstado(falhou(MENSAGEM_SEM_VOZES));
        } else if (r.erro === "sem_sessao") setEstado(falhou(MENSAGEM_SEM_SESSAO, true));
        else {
          const m = mensagemDoResultado(r);
          setEstado(falhou(m === MENSAGEM_SEM_RESPOSTA ? MENSAGEM_SEM_VOZES : m));
        }
      },
      async () => {
        // a função caiu antes de responder: a rede, ou a sessão que terminou (como no Cérebro)
        const semSessao = await sessaoTerminou();
        if (!vale()) return;
        setEstado(semSessao ? falhou(MENSAGEM_SEM_SESSAO, true) : falhou(MENSAGEM_SEM_VOZES));
      },
    );
  }, [ativo, vez]);

  const recarregar = useCallback(() => setVez((v) => v + 1), []);
  return { estado, recarregar };
}

export interface PropsListaDeVozes {
  /**
   * O estado do `useListaVozes`. A lista `vozes` precisa ser a mesma entre os renders (a do hook
   * é): uma lista nova volta o "Mostrar mais" para 6.
   */
  estado: EstadoListaVozes;
  /** O id da voz marcada (a escolhida, ou o rascunho de quem salva com botão). */
  valor: string | null;
  aoMudar: (id: string) => void;
  aoRecarregar: () => void;
  /** "Entrar de novo" quando a sessão terminou; sem ele, vai para o login. */
  aoEntrarDeNovo?: () => void;
  /** O id da voz que está sendo gravada: a linha mostra "Salvando…" e a lista não aceita outra escolha. */
  ocupada?: string | null;
  /** Desliga tudo (o "Conferir tudo" da Configuração, por exemplo) e para a prévia. */
  desligado?: boolean;
  /** O nome do grupo para o leitor de tela. */
  rotulo: string;
  /** O começo dos ids das opções (`<idBase>-0`, `<idBase>-1`…), para quem usa mandar o foco. */
  idBase: string;
}

/** A lista de vozes em cada estado: carregando, falhou, vazia e pronta. */
export function ListaDeVozes({
  estado,
  valor,
  aoMudar,
  aoRecarregar,
  aoEntrarDeNovo,
  ocupada = null,
  desligado = false,
  rotulo,
  idBase,
}: PropsListaDeVozes) {
  const vozes = estado.k === "pronta" ? estado.vozes : null;
  // o limite vale para a lista em que foi aumentado: uma lista nova volta a mostrar 6
  const [limite, setLimite] = useState<{ de: VozDaConta[] | null; n: number }>({ de: vozes, n: VOZES_INICIAL });
  const n = limite.de === vozes ? limite.n : VOZES_INICIAL;
  // a prévia: um <audio> só, e o id da voz que está tocando
  const audio = useRef<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState<string | null>(null);
  const tocandoRef = useRef<string | null>(null);
  // o elemento que está tocando: o ref do <audio> já vem nulo quando a limpeza da desmontagem roda
  const tocador = useRef<HTMLAudioElement | null>(null);
  const [erroPrevia, setErroPrevia] = useState(false);
  // a voz com o ponteiro sobre o "Ouvir": a linha acende como no hover da opção (o "Ouvir" fica
  // fora da opção, numa coluna à parte)
  const [sobre, setSobre] = useState<string | null>(null);
  // depois do "Mostrar mais", o foco vai para a primeira voz que apareceu
  const focoPendente = useRef<string | null>(null);

  const marcar = (id: string | null) => {
    tocandoRef.current = id;
    setTocando(id);
  };
  const parar = () => {
    if (tocandoRef.current === null) return;
    pausar(tocador.current);
    marcar(null);
  };

  // para ao desmontar (um <audio> fora da página continua tocando)
  useEffect(
    () => () => {
      if (tocandoRef.current !== null) pausar(tocador.current);
      tocandoRef.current = null;
    },
    [],
  );

  // para ao desligar e quando a lista muda (recarregou, falhou ou foi esquecida)
  useEffect(() => {
    if (desligado || estado.k !== "pronta") parar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desligado, estado]);

  useEffect(() => {
    const id = focoPendente.current;
    if (!id) return;
    focoPendente.current = null;
    document.getElementById(id)?.focus({ preventScroll: true });
  });

  const ouvir = (v: VozDaConta) => {
    const el = audio.current;
    if (!el || !v.previa || desligado) return;
    if (tocandoRef.current === v.id) {
      parar();
      return;
    }
    if (tocandoRef.current !== null) pausar(tocador.current);
    setErroPrevia(false);
    el.src = v.previa;
    tocador.current = el;
    marcar(v.id);
    const falhouPrevia = () => {
      if (tocandoRef.current !== v.id) return;
      marcar(null);
      setErroPrevia(true);
    };
    try {
      const p = el.play() as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(falhouPrevia);
    } catch {
      falhouPrevia();
    }
  };

  const elementoAudio = (
    <audio
      ref={audio}
      preload="none"
      hidden
      onEnded={() => marcar(null)}
      onError={() => {
        if (tocandoRef.current === null) return;
        marcar(null);
        setErroPrevia(true);
      }}
    />
  );

  if (estado.k === "parada") {
    return (
      <div className={s.seletor} data-estado="parada" hidden>
        {elementoAudio}
      </div>
    );
  }

  if (estado.k === "carregando") {
    return (
      <div className={s.seletor} data-estado="carregando">
        {elementoAudio}
        <p className={s.consultando} role="status">
          Buscando as vozes da conta…
        </p>
        {/* os ossos repetem a forma das linhas: o rádio, o nome e o detalhe */}
        <div className={s.ossos} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className={s.osso}>
              <Esqueleto forma="circulo" largura={20} altura={20} />
              <Esqueleto forma="texto" linhas={2} />
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (estado.k === "falhou") {
    return (
      <div className={s.seletor} data-estado="falhou">
        {elementoAudio}
        <AvisoErro titulo={estado.titulo} texto={estado.texto} />
        <div className={s.acoes}>
          {estado.semSessao ? (
            <BotaoCompacto variante="contorno" aoClicar={aoEntrarDeNovo ?? irParaEntrar} disabled={desligado}>
              Entrar de novo
            </BotaoCompacto>
          ) : (
            <BotaoCompacto variante="contorno" aoClicar={aoRecarregar} disabled={desligado}>
              Tentar de novo
            </BotaoCompacto>
          )}
        </div>
      </div>
    );
  }

  const lista = estado.vozes;
  if (lista.length === 0) {
    return (
      <div className={s.seletor} data-estado="vazia">
        {elementoAudio}
        {/* a chave trocada para uma conta sem vozes: a voz escolhida também não está nela */}
        {estado.atual && (
          <p className={cx(sl.aviso, sl.avisoInfo)}>
            <Icone d={IC.alerta} />
            <span>A voz {estado.atual.nome} não está nesta conta. Escolha outra.</span>
          </p>
        )}
        <p className={cx(sl.aviso, sl.avisoInfo)} role="status">
          <Icone d={IC.alerta} />
          <span>
            A conta da ElevenLabs ainda não tem vozes. Adicione uma em My Voices, na ElevenLabs, e atualize a lista.
          </span>
        </p>
        <div className={s.acoes}>
          <BotaoCompacto variante="contorno" aoClicar={aoRecarregar} disabled={desligado}>
            Atualizar a lista
          </BotaoCompacto>
        </div>
      </div>
    );
  }

  // as primeiras `n`, e a marcada no fim quando ela ficou além do limite (como nos modelos)
  const visiveis = lista.slice(0, n);
  if (valor && !visiveis.some((v) => v.id === valor)) {
    const marcada = lista.find((v) => v.id === valor);
    if (marcada) visiveis.push(marcada);
  }
  const restantes = lista.length - visiveis.length;
  const temMarcada = visiveis.some((v) => v.id === valor);
  const fora = estado.atual && !lista.some((v) => v.id === estado.atual?.id) ? estado.atual : null;
  const travada = desligado || !!ocupada;

  const escolher = (id: string) => {
    if (travada || id === valor) return;
    aoMudar(id);
  };
  const tecla = (i: number) => (ev: KeyboardEvent<HTMLButtonElement>) => {
    let j: number;
    if (ev.key === "ArrowDown" || ev.key === "ArrowRight") j = (i + 1) % visiveis.length;
    else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") j = (i - 1 + visiveis.length) % visiveis.length;
    else if (ev.key === "Home") j = 0;
    else if (ev.key === "End") j = visiveis.length - 1;
    else return;
    ev.preventDefault();
    const alvo = visiveis[j];
    if (!alvo || travada) return;
    escolher(alvo.id);
    document.getElementById(`${idBase}-${j}`)?.focus({ preventScroll: true });
  };
  const mostrarMais = () => {
    focoPendente.current = `${idBase}-${n}`;
    setLimite({ de: lista, n: n + VOZES_PASSO });
  };

  return (
    <div className={s.seletor} data-estado="pronta">
      {elementoAudio}
      {fora && (
        <p className={cx(sl.aviso, sl.avisoInfo)} role="status">
          <Icone d={IC.alerta} />
          <span>A voz {fora.nome} não está nesta conta. Escolha outra.</span>
        </p>
      )}
      {/* Pelo WAI-ARIA, o radiogroup só tem radios: os "Ouvir" ficam numa coluna irmã, na mesma
          grade. Cada linha é uma faixa da grade (uma por voz), e os dois lados a dividem por
          subgrid: o "Ouvir" fica alinhado à direita da sua voz, como se estivesse na linha. */}
      <div className={s.vozes} style={{ gridTemplateRows: `repeat(${visiveis.length}, auto)` }}>
        <div className={s.grupo} role="radiogroup" aria-label={rotulo} aria-disabled={travada || undefined}>
          {visiveis.map((v, i) => {
            const ativa = v.id === valor;
            const salvando = ocupada === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                id={`${idBase}-${i}`}
                className={cx(s.voz, ativa && s.ativo, sobre === v.id && s.sobre, !v.previa && s.semPrevia)}
                aria-checked={ativa}
                // ocupada: aria-disabled (e não disabled) para o foco não cair no corpo da página
                aria-disabled={(!desligado && !!ocupada) || undefined}
                disabled={desligado}
                tabIndex={ativa || (!temMarcada && i === 0) ? 0 : -1}
                onClick={() => escolher(v.id)}
                onKeyDown={tecla(i)}
              >
                <span className={s.opcao}>
                  <span className={s.radio} aria-hidden="true" />
                  <span className={s.vozTexto}>
                    <span className={s.vozNome}>
                      <span>{v.nome}</span>
                      {v.portugues && <span className={s.selo}>Português</span>}
                    </span>
                    {v.detalhe && <span className={s.vozDetalhe}>{v.detalhe}</span>}
                    {salvando && <span className={s.salvando}>Salvando…</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className={s.ouvires}>
          {visiveis.map((v, i) => {
            if (!v.previa) return null;
            const tocandoEsta = tocando === v.id;
            return (
              <button
                key={v.id}
                type="button"
                className={s.ouvir}
                style={{ gridRow: i + 1 }}
                aria-pressed={tocandoEsta}
                aria-label={`${tocandoEsta ? "Parar" : "Ouvir"} a voz ${v.nome}`}
                disabled={desligado}
                onClick={() => ouvir(v)}
                onMouseEnter={() => setSobre(v.id)}
                onMouseLeave={() => setSobre((atual) => (atual === v.id ? null : atual))}
              >
                <Icone d={tocandoEsta ? IC_PARAR : IC_OUVIR} tamanho="p" />
                <span aria-hidden="true">{tocandoEsta ? "Parar" : "Ouvir"}</span>
              </button>
            );
          })}
        </div>
      </div>
      {erroPrevia && (
        <p className={s.previaErro} role="alert">
          Não deu para tocar a prévia.
        </p>
      )}
      {restantes > 0 && (
        <div className={s.mais}>
          <span>
            Mostrando {visiveis.length} de {lista.length} vozes.
          </span>
          <BotaoCompacto aoClicar={mostrarMais} disabled={desligado}>
            Mostrar mais
          </BotaoCompacto>
        </div>
      )}
    </div>
  );
}

/** A lista com a busca junto, para quem não precisa do estado por fora. */
export function SeletorVoz({
  carregar,
  ...props
}: Omit<PropsListaDeVozes, "estado" | "aoRecarregar"> & { carregar: (() => Promise<ResultadoListaVozes>) | null }) {
  const { estado, recarregar } = useListaVozes(carregar);
  return <ListaDeVozes estado={estado} aoRecarregar={recarregar} {...props} />;
}

function pausar(el: HTMLAudioElement | null) {
  if (!el) return;
  try {
    el.pause();
  } catch {
    // sem o que parar
  }
}
