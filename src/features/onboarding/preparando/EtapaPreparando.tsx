import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo, type EstadoJanete } from "@/components/janete/JaneteSimbolo";
import {
  DURACAO_VOO_LONGO_MS,
  esperarElemento,
  medirJanete,
  movimentoReduzido,
  rolarAteEMedir,
  useVooJanete,
} from "@/components/janete/VooJanete";
import { curto, nomeDaEmpresa, semPontoFinal } from "@/features/plataforma/texto";

import { useOnboarding } from "../estado";
import type { PropsEtapa } from "../Onboarding";
import { useJaneteNoPalco, usePalco } from "../palco";
import estilos from "./EtapaPreparando.module.css";
import { FALA_FINAL, PREPARO } from "./passos";

const s = estilos as Classes<
  | "prep"
  | "wrap"
  | "simbolo"
  | "oculto"
  | "pousa"
  | "titulo"
  | "sub"
  | "fala"
  | "palavra"
  | "escondido"
  | "corpo"
  | "agora"
  | "item"
  | "falaFinal"
  | "falaT"
  | "itemT"
  | "itemD"
  | "fio"
  | "trilho"
  | "fill"
  | "puxando"
  | "nos"
  | "no"
  | "ponto"
  | "conta"
  | "contaVoo"
  | "anda"
>;

/**
 * Fases da etapa:
 * chega (o símbolo em voo ainda não pousou: nada de texto) → fala (ela diz o título e o texto, palavra
 * por palavra) → preparo (os passos andam, um nó do fio por passo) → fim (check, e as contas do fio
 * voltam para ela) → despede (todo o resto some e ela diz a frase final, grande, logo abaixo do símbolo;
 * depois de uma pausa para ler, segue para a plataforma).
 */
export type FasePreparo = "chega" | "fala" | "preparo" | "fim" | "despede";

/** Tempos da coreografia (ms). Com movimento reduzido, os do `*Reduzido`. */
export const TEMPOS_PREPARO = {
  /** Um passo do preparo. */
  passo: 1250,
  passoReduzido: 380,
  /** Atraso antes da primeira palavra de uma fala. */
  falaInicio: 120,
  /** Intervalo entre uma palavra e a seguinte. */
  falaPalavra: 90,
  /** Quanto cada palavra leva para entrar (a animação do CSS). */
  falaEntrada: 500,
  /** Pausa entre o fim da fala de abertura e o primeiro passo. */
  depoisDaFala: 250,
  /** Pausa para ler a frase final antes de seguir para a plataforma. */
  leitura: 1400,
  leituraReduzida: 1200,
} as const;

const palavrasDe = (texto: string) => texto.split(/\s+/).filter(Boolean);

/** Quanto dura uma fala de `n` palavras, do começo até a última palavra assentar. */
export function duracaoFala(n: number): number {
  if (n <= 0) return 0;
  return TEMPOS_PREPARO.falaInicio + (n - 1) * TEMPOS_PREPARO.falaPalavra + TEMPOS_PREPARO.falaEntrada;
}

/**
 * Um texto dito pela Janete: as palavras entram uma a uma (como as letras do título do despertar).
 * `desde` é quantas palavras de outra fala vêm antes desta (para encadear título e texto).
 * Os espaços ficam como texto, então o nome acessível e o textContent continuam normais.
 */
function Fala({ texto, desde = 0, animar }: { texto: string; desde?: number; animar: boolean }) {
  if (!animar) return <>{texto}</>;
  const palavras = palavrasDe(texto);
  return (
    <>
      {palavras.map((p, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          <span
            className={s.palavra}
            style={{ animationDelay: `${TEMPOS_PREPARO.falaInicio + (desde + i) * TEMPOS_PREPARO.falaPalavra}ms` }}
          >
            {p}
          </span>
        </span>
      ))}
    </>
  );
}

interface ContaVoo {
  id: number;
  x: number;
  y: number;
  anda: boolean;
}

interface EstadoPreparo {
  fase: FasePreparo;
  /** Passo atual, de 0 a 5 (5 = todos feitos). */
  prep: number;
  simbolo: EstadoJanete;
  /** O símbolo em voo ainda não pousou aqui: o deste palco fica escondido. */
  esconde: boolean;
  /** A Janete puxa o fio de volta (a ida para a plataforma). */
  puxando: boolean;
  soltos: number[];
  contas: ContaVoo[];
  pousa: boolean;
}

const TOTAL = PREPARO.length;

/**
 * Etapa 5 do onboarding: a Janete no meio, um passo grande por vez e um fio de cinco nós (E6).
 * O símbolo pousa no centro, ela fala o título e o texto, e só então o preparo anda. No fim, cada nó
 * solta a sua conta, que volta para a Janete; ela diz a frase final, fica em trânsito (VooJanete) e a
 * plataforma assume (o Layout faz o voo até o canto).
 */
export function EtapaPreparando({ avancar }: PropsEtapa) {
  const voo = useVooJanete();
  const vooRef = useRef(voo);
  vooRef.current = voo;
  const { estado } = useOnboarding();
  const { anunciar, recolherBarra } = usePalco();
  useJaneteNoPalco(true);

  const [st, setSt] = useState<EstadoPreparo>(() => ({
    fase: voo.ativo ? "chega" : "fala",
    prep: 0,
    simbolo: voo.ativo ? "carregando" : "fala",
    esconde: voo.ativo,
    puxando: false,
    soltos: [],
    contas: [],
    pousa: false,
  }));
  const set = (mudanca: Partial<EstadoPreparo> | ((a: EstadoPreparo) => Partial<EstadoPreparo>)) =>
    setSt((a) => ({ ...a, ...(typeof mudanca === "function" ? mudanca(a) : mudanca) }));

  const avancarRef = useRef(avancar);
  avancarRef.current = avancar;

  const montado = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  const limpar = () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  };

  const empresaBruta = nomeDaEmpresa(estado.conversa.respostas);
  const empresa = empresaBruta ? semPontoFinal(curto(empresaBruta, 28)) : "";
  const tituloAbertura = "Preparando a sua plataforma";
  const lead = empresa
    ? `Estou montando tudo para ${empresa}. Leva poucos segundos.`
    : "Estou juntando tudo o que você escolheu. Leva poucos segundos.";
  const nTitulo = palavrasDe(tituloAbertura).length;
  const nAbertura = nTitulo + palavrasDe(lead).length;

  /* ---------- 4c: ela diz a frase final; depois de ler, fica em trânsito para a plataforma ---------- */
  const despedir = (origem: { x: number; y: number; tamanho: number } | null) => {
    const mov = !movimentoReduzido();
    // 4d: fica só ela e a fala. A barra de cima também sai (no caminho com movimento ela já subiu
    // no puxarFio; com movimento reduzido, é aqui).
    recolherBarra(true);
    set({ fase: "despede", simbolo: mov ? "fala" : "acordada", contas: [] });
    const fala = mov ? duracaoFala(palavrasDe(FALA_FINAL).length) : 0;
    if (mov) later(() => set({ simbolo: "acordada" }), fala);
    later(
      () => {
        void (async () => {
          if (!mov || !origem) {
            avancarRef.current();
            return;
          }
          const ponto = await rolarAteEMedir("p-simbolo");
          if (!montado.current) return;
          vooRef.current.pousar(ponto ?? origem, "acordada");
          avancarRef.current();
        })();
      },
      fala + (mov ? TEMPOS_PREPARO.leitura : TEMPOS_PREPARO.leituraReduzida),
    );
  };

  /* ---------- 5 → 6 (E6): a Janete puxa o fio; cada conta volta para ela ---------- */
  const puxarFio = async () => {
    const src = movimentoReduzido() ? null : await rolarAteEMedir("p-simbolo");
    if (!montado.current) return;
    limpar();
    if (!src) {
      despedir(null);
      return;
    }
    // 1) cada nó do fio solta a sua conta, que volta para a Janete; o ponto gira como um carretel.
    // A plataforma não tem a barra do onboarding: ela sobe agora (o mesmo recolher da validação),
    // em vez de sumir num quadro só quando a rota muda.
    recolherBarra(true);
    set({ puxando: true, soltos: [], contas: [], simbolo: "carregando", pousa: false });
    [4, 3, 2, 1, 0].forEach((i, k) => {
      later(() => {
        const b = medirJanete(`pn-${i}`);
        if (!b) {
          set((a) => ({ soltos: [...a.soltos, i] }));
          return;
        }
        set((a) => ({ soltos: [...a.soltos, i], contas: [...a.contas, { id: i, x: b.x, y: b.y, anda: false }] }));
        later(
          () =>
            set((a) => ({
              contas: a.contas.map((c) => (c.id === i ? { ...c, x: src.x, y: src.y, anda: true } : c)),
            })),
          40,
        );
      }, k * 90);
    });
    const chega = 4 * 90 + 40 + 780;
    later(() => set({ contas: [], simbolo: "acordada", pousa: true }), chega);
    // 2) com tudo nela, ela fala a frase final
    later(() => despedir(src), chega + 300);
  };

  /* ---------- 5 preparo: um passo grande por vez, um nó do fio por passo ---------- */
  const iniciarPreparo = () => {
    const mov = !movimentoReduzido();
    const passo = mov ? TEMPOS_PREPARO.passo : TEMPOS_PREPARO.passoReduzido;
    set({ fase: "preparo", prep: 0, simbolo: "carregando", puxando: false, soltos: [], contas: [], pousa: false });
    for (let i = 1; i <= TOTAL; i++) later(() => set({ prep: i }), passo * i);
    const fim = passo * TOTAL;
    // pronto: o ponto gira para dentro e o check aparece; depois ela volta a ser a Janete
    later(() => set({ fase: "fim", simbolo: "check" }), fim + (mov ? 120 : 0));
    later(() => set({ simbolo: "acordada" }), fim + (mov ? 1100 : 40));
    later(() => void puxarFio(), fim + (mov ? 1700 : 120));
  };

  /* ---------- 4b: pousada no centro, ela fala o título e o texto; depois o preparo anda ---------- */
  const falarAbertura = () => {
    if (movimentoReduzido()) {
      iniciarPreparo();
      return;
    }
    set({ fase: "fala", simbolo: "fala" });
    later(iniciarPreparo, duracaoFala(nAbertura) + TEMPOS_PREPARO.depoisDaFala);
  };

  /* ---------- chegada: vindo do chat, o símbolo em voo pousa no meio ---------- */
  useEffect(() => {
    montado.current = true;
    // Um marcador por execução: na montagem dupla do React (StrictMode), a limpeza da 1ª execução
    // desliga o `vivo` dela, e a cadeia async da 1ª para no próximo await, mesmo com o `montado`
    // religado pela 2ª. Só uma chegada roda (um voar, um soltar, uma abertura).
    let vivo = true;
    (async () => {
      if (!vooRef.current.ativo) {
        falarAbertura();
        return;
      }
      const el = await esperarElemento("p-simbolo");
      if (!vivo) return;
      const alvo = el ? await rolarAteEMedir(el) : null;
      if (!vivo) return;
      if (alvo) await vooRef.current.voar(alvo, { duracaoMs: DURACAO_VOO_LONGO_MS, estado: "carregando" });
      if (!vivo) return;
      vooRef.current.soltar();
      set({ esconde: false });
      falarAbertura();
    })();
    return () => {
      vivo = false;
      montado.current = false;
      limpar();
      recolherBarra(false);
    };
    // Só na montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { fase } = st;
  const terminou = st.prep >= TOTAL;
  const passoAtual = PREPARO[st.prep];
  const mostraTexto = fase !== "chega";
  const mostraPassos = fase === "preparo" || fase === "fim" || fase === "despede";
  const animar = fase === "fala";
  /** 4d: na frase final, todo o resto some (sem sair do fluxo, para o símbolo não pular). */
  const some = fase === "despede" || undefined;

  const anuncio =
    fase === "despede"
      ? FALA_FINAL
      : terminou
        ? "Sua plataforma está pronta."
        : fase === "preparo" && passoAtual
          ? `${passoAtual.titulo}…`
          : "";
  useEffect(() => {
    if (anuncio) anunciar(anuncio);
  }, [anuncio, anunciar]);

  const titulo = terminou ? "Sua plataforma está pronta" : tituloAbertura;
  const passos = PREPARO.map((p) => ({ titulo: p.titulo, detalhe: p.detalhe(estado) }));
  const faseDo = (i: number) =>
    !mostraPassos ? undefined : i < st.prep ? "feito" : i === st.prep ? "ativo" : undefined;
  const escala = st.puxando || !mostraPassos ? 0 : Math.min(st.prep, TOTAL - 1) / (TOTAL - 1);

  return (
    <section className={s.prep} aria-labelledby="p-titulo" data-etapa="preparando" data-fase={fase}>
      <div className={s.wrap} aria-hidden="true">
        <span id="p-simbolo" className={cx(s.simbolo, st.esconde && s.oculto, st.pousa && s.pousa)}>
          <JaneteSimbolo decorativo tamanho={112} estado={st.simbolo} digitando={st.simbolo === "fala"} />
        </span>
      </div>
      <div className={s.corpo}>
        <h1 id="p-titulo" tabIndex={-1} className={cx(s.titulo, !mostraTexto && s.escondido)} data-some={some}>
          <Fala key={titulo} texto={titulo} animar={animar} />
        </h1>
        <p className={cx(s.sub, !mostraTexto && s.escondido)} data-some={some}>
          <Fala texto={lead} desde={nTitulo} animar={animar} />
        </p>
        <div
          className={cx(s.agora, !mostraPassos && s.escondido)}
          data-passos={mostraPassos || undefined}
          data-some={some}
        >
          {passos.map((p, i) => (
            <div key={p.titulo} className={s.item} data-fase={faseDo(i)} aria-hidden={faseDo(i) === "ativo" ? "false" : "true"}>
              <span className={s.itemT}>{p.titulo}</span>
              <span className={s.itemD}>{p.detalhe}</span>
            </div>
          ))}
        </div>
        <div className={cx(s.fio, !mostraPassos && s.escondido)} aria-hidden="true" data-some={some}>
          <div className={s.trilho}>
            <span className={cx(s.fill, st.puxando && s.puxando)} style={{ transform: `scaleX(${escala.toFixed(4)})` }} />
          </div>
          <ol className={s.nos}>
            {PREPARO.map((p, i) => (
              <li key={p.titulo} className={s.no} data-fase={faseDo(i)} data-solto={st.soltos.includes(i) || undefined}>
                <span id={`pn-${i}`} className={s.ponto}>
                  <svg viewBox="0 0 24 24">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className={cx(s.conta, !mostraPassos && s.escondido)} data-some={some}>
          {terminou ? `${TOTAL} de ${TOTAL} concluídos` : `Passo ${st.prep + 1} de ${TOTAL}`}
        </p>
        {/* 4d: a frase final, grande e logo abaixo do símbolo, como o "Oi! Eu sou a Janete." do despertar.
            Fica numa camada por cima do lugar do título: não muda a altura da coluna. */}
        <div
          className={s.falaFinal}
          data-fase={fase === "despede" ? "ativo" : undefined}
          data-fala-final=""
          aria-hidden={fase === "despede" ? "false" : "true"}
        >
          {fase === "despede" ? (
            <p className={s.falaT}>
              <Fala texto={FALA_FINAL} animar={!movimentoReduzido()} />
            </p>
          ) : null}
        </div>
      </div>
      {st.contas.length > 0 && typeof document !== "undefined"
        ? createPortal(
            st.contas.map((c) => (
              <span
                key={c.id}
                className={cx(s.contaVoo, c.anda && s.anda)}
                style={{ left: c.x, top: c.y }}
                aria-hidden="true"
              />
            )),
            document.body,
          )
        : null}
    </section>
  );
}
