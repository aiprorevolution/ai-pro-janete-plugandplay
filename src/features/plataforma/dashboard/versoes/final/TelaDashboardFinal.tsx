import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { cx, type Classes } from "@/components/aipro/cx";

import { useTelaEstreita } from "../../../exemplo";
import { ID_TITULO_DASHBOARD, usePainelDashboard } from "../../dados";
import { acharRolador, ETAPA_SAIRAM, idCapitulo, idTituloCapitulo, LARGURA_DO_PALCO, rolarPara, useAmbienteDoPalco, useLarguraMinima, useMovimentoReduzido } from "./apoio";
import { Cabecalho } from "./Cabecalho";
import { Capitulos } from "./Capitulos";
import { CartaoContexto, CartaoHub, CartaoPrecisa, CartaoSaude, CartoesNumeros, LugarDaJanete } from "./Cartoes";
import type { FaseB } from "./coreografia";
import { montarColunas } from "./Funil";
import { Palco, type ItemIndice, type ModoPalco } from "./Palco";
import { Resultado } from "./Resultado";
import estilosResumo from "./Resumo.module.css";
import estilosFinal from "./TelaDashboardFinal.module.css";
import estilosTopo from "./Topo.module.css";
import { useVooDaJanete } from "./voo";

// A versão final do Dashboard (docs/spec-dashboard-final.md), uma página só, com os pedaços que o
// equipe escolheu das 4 versões:
//   1. o topo da D: o cabeçalho (saudação, resumo, período), o anel do "No Kanban agora" com a Janete
//      no centro (o lugar dela, com o voo da D) e os 4 números; com as mudanças 1 a 3 da final: o
//      "Precisa de você" em meia altura num azul claro da Janete (ajuste 3), o cartão do Contexto embaixo
//      dele e a Saúde em medidor de meio círculo; as informações do anel entram quando a Janete pousa;
//   2. o palco do funil da B: o MESMO cartão cresce, se abre etapa por etapa e vira a faixa das
//      etapas presa no topo, agora com a Janete no centro dela (mudança 5);
//   3. os capítulos de cada etapa (o corpo da A, o cabeçalho da D, mudança 4), dentro do palco;
//   4. o resultado do período da D.
// Esta tela só lê usePainelDashboard(): nenhum número nasce aqui.
//
// Modos do palco (os da B): `palco` (computador a partir de 1180 px, com movimento e com leads) liga
// o motor da rolagem, que escreve `--p` no palco a cada quadro e avisa o React só na troca de fase;
// `aberto` (movimento reduzido, janela menor, período vazio, jsdom) mostra o funil já aberto, a faixa
// presa em fluxo e os capítulos em fluxo normal; `celular` (abaixo de 900 px) as etapas em linhas e
// a fileira de chips presa no topo.

const t = estilosTopo as Classes<"dvd-raiz" | "dvd-grade2" | "dvd-grade4" | "dvd-vivo">;
const f = estilosFinal as Classes<"raiz">;
const r = estilosResumo as Classes<"pilha">;

function listaMedia(consulta: string): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(consulta) : null;
  } catch {
    return null;
  }
}

function useMedia(consulta: string): boolean {
  const assinar = useCallback(
    (avisar: () => void) => {
      const mq = listaMedia(consulta);
      if (!mq || typeof mq.addEventListener !== "function") return () => {};
      mq.addEventListener("change", avisar);
      return () => mq.removeEventListener("change", avisar);
    },
    [consulta],
  );
  return useSyncExternalStore(assinar, () => !!listaMedia(consulta)?.matches, () => false);
}

/**
 * O tamanho do símbolo da Janete no anel: 104 a partir de 1440 (anel de 144), 88 de 900 a 1439 (anel de
 * 116), 40 no herói do celular (5.2 e 11). O anel encolheu para os nomes das etapas caberem ao lado.
 */
function tamanhoDaJanete(estreito: boolean, largo: boolean): number {
  if (estreito) return 40;
  return largo ? 104 : 88;
}

/** Quanto tempo a 1ª vez fica ligada (os 600 ms da contagem mais os atrasos dos cartões). */
const JANELA_ENTRADA_MS = 1400;

export function TelaDashboardFinal() {
  const { painel, carregando, primeiraVez } = usePainelDashboard();
  const estreito = useTelaEstreita();
  const largo = useMedia("(min-width: 1440px)");
  const reduzido = useMovimentoReduzido();
  const temPalco = useAmbienteDoPalco();
  const largaParaPalco = useLarguraMinima(LARGURA_DO_PALCO, true);
  // No período sem leads não há história para contar: sem palco, sem faixa e sem capítulos (o convite
  // a escolher outro período fica no lugar deles).
  const semLeads = painel.vazio || painel.funil.leadsNovos === 0;
  const modo: ModoPalco = estreito ? "celular" : temPalco && largaParaPalco && !reduzido && !semLeads ? "palco" : "aberto";

  const [fase, setFase] = useState<FaseB>("repouso");
  const [ativo, setAtivo] = useState<string | null>(null);
  const raiz = useRef<HTMLElement>(null);
  const resultado = useRef<HTMLElement>(null);

  // O voo da Janete (spec 6, o da D): do botão do canto até o lugar dela no anel, toda vez que a página monta.
  const { visivel, pousou } = useVooDaJanete(painel.estadoJanete, reduzido);

  // A 1ª vez da aba: os cartões entram em fade e os números sobem contando; só na montagem (um cartão
  // que remonta depois, ao trocar o período, aparece já no valor).
  const [entrada, setEntrada] = useState(() => primeiraVez && !reduzido);
  useEffect(() => {
    if (!entrada) return;
    const id = setTimeout(() => setEntrada(false), JANELA_ENTRADA_MS);
    return () => clearTimeout(id);
  }, [entrada]);

  const colunas = useMemo(() => montarColunas(painel.funil, painel.vazio), [painel.funil, painel.vazio]);
  const itensIndice = useMemo<ItemIndice[]>(
    () => [
      ...colunas.map((c) => ({ id: c.etapa.etapaId, nome: c.etapa.nome, chegaram: c.etapa.chegaram, v: c.v, ganho: c.etapa.tipo === "ganho" })),
      { id: ETAPA_SAIRAM, nome: "Para onde foram os que saíram", chegaram: null, v: 0, ganho: false },
    ],
    [colunas],
  );

  /** Vai ao capítulo da etapa: rola até ele (abaixo da faixa presa) e põe o foco no título. */
  const aoIr = useCallback(
    (etapa: string) => {
      const capitulo = document.getElementById(idCapitulo(etapa));
      if (!capitulo) return;
      setAtivo(etapa);
      if (typeof capitulo.scrollIntoView === "function") capitulo.scrollIntoView({ block: "start", behavior: reduzido ? "auto" : "smooth" });
      document.getElementById(idTituloCapitulo(etapa))?.focus({ preventScroll: true });
    },
    [reduzido],
  );

  const voltarAoTopo = useCallback(() => {
    if (raiz.current) rolarPara(acharRolador(raiz.current), 0, !reduzido);
    document.getElementById(ID_TITULO_DASHBOARD)?.focus({ preventScroll: true });
  }, [reduzido]);

  const aoFase = useCallback((nova: FaseB) => setFase(nova), []);
  const aoCapitulo = useCallback((c: string | null) => setAtivo(c), []);

  /* ---------- a região viva: uma frase por mudança de estado, sempre regravada ---------- */
  const [anuncio, setAnuncio] = useState("");
  const anterior = useRef({ carregando, estadoJanete: painel.estadoJanete, aguardando: painel.agora.aguardando.total, papel: painel.papel });
  useEffect(() => {
    const a = anterior.current;
    let frase = "";
    if (a.papel !== painel.papel) {
      // trocar o "Ver como" muda os totais sem conversa nova: só zera a base
    } else if (a.carregando && !carregando) frase = `Período carregado: ${painel.periodo.rotulo}.`;
    else if (a.estadoJanete !== "dormindo" && painel.estadoJanete === "dormindo") frase = painel.textos.resumo;
    else if (a.estadoJanete === "dormindo" && painel.estadoJanete === "acordada") frase = "A Janete voltou a atender.";
    else if (painel.agora.aguardando.total > a.aguardando) frase = "Há conversa nova esperando por você.";
    anterior.current = { carregando, estadoJanete: painel.estadoJanete, aguardando: painel.agora.aguardando.total, papel: painel.papel };
    if (!frase) return;
    // limpa e regrava: a mesma frase duas vezes seguidas também é anunciada
    setAnuncio("");
    const id = setTimeout(() => setAnuncio(frase), 50);
    return () => clearTimeout(id);
  }, [carregando, painel.estadoJanete, painel.agora.aguardando.total, painel.periodo.rotulo, painel.textos.resumo, painel.papel]);

  // O elemento é o mesmo entre as renderizações: o memo dos cartões vale quando só a fase muda.
  const janete = useMemo(
    () => <LugarDaJanete estado={painel.estadoJanete} visivel={visivel} pousou={pousou} tamanho={tamanhoDaJanete(estreito, largo)} />,
    [painel.estadoJanete, visivel, pousou, estreito, largo],
  );

  // As informações do anel esperam a Janete pousar e entram com ela (ajuste 3 do equipe); sem voo, já no lugar.
  const chegadaDoAnel = !visivel ? "esperando" : pousou ? "entrando" : undefined;

  // No celular a ordem do DOM é a da seção 11, com o Contexto logo depois do "Precisa de você": o Tab
  // e a leitura seguem a tela. No computador, as duas grades da D (a 1ª coluna com as duas metades).
  const cartoes = estreito ? (
    <>
      <CartaoPrecisa entrada={entrada} ordem={0} />
      <CartaoContexto entrada={entrada} ordem={1} contexto={painel.contexto} />
      <div className={t["dvd-grade4"]}>
        <CartoesNumeros entrada={entrada} ordemBase={2} />
      </div>
      <CartaoHub janete={null} ordem={6} />
      <CartaoSaude entrada={entrada} ordem={7} />
    </>
  ) : (
    <>
      <div className={t["dvd-grade2"]}>
        <div className={r.pilha}>
          <CartaoPrecisa entrada={entrada} ordem={0} />
          <CartaoContexto entrada={entrada} ordem={1} contexto={painel.contexto} />
        </div>
        <CartaoHub janete={janete} ordem={2} chegada={chegadaDoAnel} />
        <CartaoSaude entrada={entrada} ordem={3} />
      </div>
      <div className={t["dvd-grade4"]}>
        <CartoesNumeros entrada={entrada} ordemBase={3} />
      </div>
    </>
  );

  return (
    <section
      ref={raiz}
      className={cx(t["dvd-raiz"], f.raiz)}
      data-identidade="aipro"
      data-area="dashboard"
      data-versao="final"
      data-dash="pagina"
      data-dash-fase={fase}
      data-dash-modo={modo}
      aria-labelledby={ID_TITULO_DASHBOARD}
    >
      <Cabecalho janeteCelular={estreito ? janete : null} />

      {cartoes}

      <Palco
        modo={modo}
        painel={painel}
        carregando={carregando}
        colunas={colunas}
        itensIndice={itensIndice}
        ativo={ativo}
        aoIr={aoIr}
        aoFase={aoFase}
        aoCapitulo={aoCapitulo}
        resultado={resultado}
        entra={entrada}
        fase={fase}
        reduzido={reduzido}
      >
        <Capitulos painel={painel} carregando={carregando} pergunteNoFim={modo === "palco"} />
      </Palco>

      <Resultado ref={resultado} aoVoltarAoTopo={voltarAoTopo} />

      <p className={t["dvd-vivo"]} role="status" aria-live="polite">
        {anuncio}
      </p>
    </section>
  );
}
