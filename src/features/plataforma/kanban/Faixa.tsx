import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, History, ListFilter, Pause, Play, Search, SlidersHorizontal, X } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { MenuSuspenso, type ItemMenu } from "../comum/MenuSuspenso";
import { Carregando, ErroLeitura } from "../dados/estados";
import type { AcoesDados } from "../dados/fonte";
import type { Erro, Resultado } from "../dados/tipos";
import { MAX_NOME_ETAPA } from "../exemplo/reducer";
import type { Etapa } from "../exemplo/tipos";
import { IconeJaneteContorno } from "./Card";
import { CORES_ETAPA, idCorDaEtapa, nomeDaEtapa } from "./Coluna";
import estilos from "./Faixa.module.css";

const s = estilos as Classes<
  | "kfBarra"
  | "kfBusca"
  | "kfBuscaIcone"
  | "kfFiltro"
  | "kfDir"
  | "kfVivo"
  | "kfVivoTexto"
  | "kfVivoAcao"
  | "kfVivoAlvo"
  | "kfAncora"
  | "kfBotao"
  | "kfBotaoTexto"
  | "kfBadge"
  | "kfDesde"
  | "kfDesdeCab"
  | "kfOlho"
  | "kfDesdeTitulo"
  | "kfFechar"
  | "kfResumo"
  | "kfLista"
  | "kfItem"
  | "kfItemHora"
  | "kfItemTitulo"
  | "kfItemMotivo"
  | "kfAcoes"
  | "kfPrimario"
  | "kfDiscreto"
  | "kfSemContorno"
  | "kfDica"
  | "kfReplay"
  | "kfPlay"
  | "kfReplayTit"
  | "kfReplayHora"
  | "kfReplayTexto"
  | "kfRegua"
  | "kfMarcas"
  | "kfMarca"
  | "kfPontas"
  | "kfVoltar"
  | "kfDlg"
  | "kfVeu"
  | "kfCaixa"
  | "kfDlgCab"
  | "kfDlgTitulo"
  | "kfApoio"
  | "kfEl"
  | "kfOrdem"
  | "kfSeta"
  | "kfNome"
  | "kfLinha2"
  | "kfCores"
  | "kfCor"
  | "kfTroca"
  | "kfTrocaTrilho"
  | "kfErro"
  | "kfPe"
  | "kfSr"
>;

// A linha de ferramentas do Kanban 2 (rodada 2): à esquerda a busca e UM botão de filtro; à direita a
// faixa fina "Janete ao vivo" (o que ela fez por último, com o símbolo), o "Desde que você saiu" (com o
// contador e o "Rever no quadro", que reencena o dia) e, só para o admin, "Editar etapas". Aqui também
// moram a régua do "Rever no quadro" e a caixa de editar etapas.

/* =========================================================================
   A barra
   ========================================================================= */

export interface ItemDesde {
  id: string;
  /** "09:47", no fuso de São Paulo. */
  hora: string;
  titulo: string;
  motivo: string;
  contatoId: string;
}

export interface JaneteAoVivo {
  /** "Janete ao vivo" ou "Revendo o dia" (só para o leitor de tela). */
  olho: string;
  acao: string;
  alvo: string;
  /** A Janete está agindo agora: o símbolo fala. */
  falando: boolean;
}

export interface ResumoDesde {
  /** "08:12". */
  saida: string;
  /** O dia da saída quando não é hoje ("ontem", "28/10"); vazio hoje. */
  saidaDia?: string | undefined;
  itens: readonly ItemDesde[];
  novos: number;
  respostas: number;
  movidos: number;
  passados: number;
  /** "Rever no quadro" bloqueado (a Janete está decidindo na tela). */
  reverBloqueado: boolean;
  /**
   * A leitura do período ainda não chegou (ou falhou): o painel mostra o esqueleto ou o erro com
   * "Tentar de novo", e não os zeros nem "a Janete ainda não mexeu em nada", que seriam falsos. Sem os
   * dados, o "Rever no quadro" e o "Marcar como visto" ficam escondidos (marcar sem ver perderia o período).
   */
  carregando?: boolean | undefined;
  erro?: Erro | null | undefined;
  tentarDeNovo?: (() => void) | undefined;
}

type PropsBarra = {
  busca: string;
  aoBuscar: (texto: string) => void;
  filtro: string;
  itensFiltro: readonly ItemMenu[];
  aoFiltrar: (id: string) => void;
  estreito: boolean;
  aoVivo: JaneteAoVivo;
  desde: ResumoDesde;
  aoAbrirLead: (contatoId: string) => void;
  aoRever: () => void;
  aoMarcarVisto: () => void;
  ehAdmin: boolean;
  aoEditarEtapas: () => void;
};

/** O id da busca: a tela limpa os filtros e devolve o foco para ela. */
export const ID_BUSCA = "kb-busca";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function BarraKanban({
  busca,
  aoBuscar,
  filtro,
  itensFiltro,
  aoFiltrar,
  estreito,
  aoVivo,
  desde,
  aoAbrirLead,
  aoRever,
  aoMarcarVisto,
  ehAdmin,
  aoEditarEtapas,
}: PropsBarra) {
  const idDesde = useId();
  const [desdeAberto, setDesdeAberto] = useState(false);
  const ancora = useRef<HTMLDivElement>(null);
  const botaoDesde = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const botaoRever = useRef<HTMLButtonElement>(null);

  const atual = itensFiltro.find((i) => i.id === filtro) ?? itensFiltro[0];
  const comFiltro = filtro !== "todos";

  // Ao abrir, o foco vai para "Rever no quadro" (como no protótipo); sem decisões para rever (o botão
  // desligado não recebe foco), vai para o painel. Clique fora fecha o "Desde que você saiu".
  useEffect(() => {
    if (!desdeAberto) return;
    const rever = botaoRever.current;
    if (rever && !rever.disabled) rever.focus({ preventScroll: true });
    else caixa.current?.focus({ preventScroll: true });
    const fora = (ev: PointerEvent | MouseEvent) => {
      if (ancora.current && ev.target instanceof Node && !ancora.current.contains(ev.target)) setDesdeAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [desdeAberto]);

  const fecharDesde = () => {
    setDesdeAberto(false);
    botaoDesde.current?.focus();
  };

  const teclaDesde = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      fecharDesde();
    }
  };

  const rotuloDesde = `Desde que você saiu${desde.novos > 0 ? `: ${plural(desde.novos, "novidade", "novidades")}` : ""}`;

  return (
    <div className={s.kfBarra}>
      <div className={s.kfBusca}>
        <Search className={s.kfBuscaIcone} aria-hidden="true" size={18} strokeWidth={2} />
        <label htmlFor={ID_BUSCA} className={s.kfSr}>
          Buscar conversa por nome, empresa ou mensagem
        </label>
        <input
          id={ID_BUSCA}
          type="search"
          value={busca}
          placeholder={estreito ? "Buscar" : "Buscar conversa"}
          autoComplete="off"
          onChange={(ev) => aoBuscar(ev.target.value)}
        />
      </div>

      <MenuSuspenso
        className={s.kfFiltro}
        rotulo="Filtrar conversas"
        textoBotao={comFiltro && atual ? `${atual.texto} · ${atual.contador ?? 0}` : "Filtro"}
        icone={estreito ? <ListFilter aria-hidden="true" size={18} strokeWidth={2} /> : undefined}
        iconeTexto={estreito ? undefined : <ListFilter aria-hidden="true" size={16} strokeWidth={2} />}
        contadorEmPilula
        destaque={comFiltro}
        itens={itensFiltro}
        valor={filtro}
        aoEscolher={aoFiltrar}
        alinhar={estreito ? "fim" : "inicio"}
      />

      <div className={s.kfDir}>
        {/* Um parágrafo comum: a frase muda a cada passo da Janete e não deve ser lida sozinha. Os avisos que
            importam saem pelo anúncio da tela e pela decisão no card. */}
        <p className={s.kfVivo} title={`${aoVivo.olho}: ${aoVivo.acao} ${aoVivo.alvo}`}>
          <JaneteSimbolo estado={aoVivo.falando ? "fala" : "acordada"} digitando={aoVivo.falando} tamanho={20} decorativo />
          {/* O verbo e o nome em dois pedaços: apertada a barra, o verbo encolhe primeiro e o nome fica. */}
          <span className={s.kfVivoTexto}>
            <span className={s.kfSr}>{aoVivo.olho}: </span>
            {/* O espaço fica dentro do verbo (com white-space: pre, não some no fim da linha): solto no
                contêiner flex, ele não era desenhado e o texto da tela virava "Escrevendo paraAna". */}
            <span className={s.kfVivoAcao}>
              {aoVivo.acao}
              {" "}
            </span>
            <b className={s.kfVivoAlvo}>{aoVivo.alvo}</b>
          </span>
        </p>

        <div className={s.kfAncora} ref={ancora}>
          <button
            ref={botaoDesde}
            id="kb-btn-desde"
            type="button"
            className={s.kfBotao}
            data-desde=""
            aria-label={rotuloDesde}
            aria-expanded={desdeAberto}
            aria-controls={desdeAberto ? idDesde : undefined}
            onClick={() => (desdeAberto ? fecharDesde() : setDesdeAberto(true))}
          >
            <History aria-hidden="true" size={16} strokeWidth={2} />
            <span className={s.kfBotaoTexto}>Desde que você saiu</span>
            {desde.novos > 0 ? (
              <span className={s.kfBadge} aria-hidden="true">
                {desde.novos}
              </span>
            ) : null}
          </button>

          {desdeAberto ? (
            <div
              ref={caixa}
              id={idDesde}
              className={s.kfDesde}
              role="dialog"
              aria-labelledby={`${idDesde}-tit`}
              tabIndex={-1}
              onKeyDown={teclaDesde}
            >
              <div className={s.kfDesdeCab}>
                <JaneteSimbolo tamanho={40} decorativo />
                <div>
                  <p className={s.kfOlho}>
                    Desde {desde.saidaDia ? `${desde.saidaDia}, ` : ""}as {desde.saida}, quando você saiu
                  </p>
                  <h2 className={s.kfDesdeTitulo} id={`${idDesde}-tit`}>
                    O que a Janete fez por você
                  </h2>
                </div>
                <button type="button" className={s.kfFechar} aria-label="Fechar" onClick={fecharDesde}>
                  <X aria-hidden="true" size={18} strokeWidth={2} />
                </button>
              </div>
              {desde.erro ? (
                <ErroLeitura
                  titulo="Não deu para ver o que a Janete fez"
                  erro={desde.erro}
                  tentarDeNovo={() => desde.tentarDeNovo?.()}
                  compacto
                />
              ) : desde.carregando ? (
                <Carregando forma="texto" quantos={3} rotulo="Carregando o que a Janete fez" />
              ) : (
                <>
              <p className={s.kfResumo}>
                <b>{desde.respostas}</b> {desde.respostas === 1 ? "resposta" : "respostas"} · <b>{desde.movidos}</b>{" "}
                {desde.movidos === 1 ? "lead mudado de etapa" : "leads mudados de etapa"} · <b>{desde.passados}</b>{" "}
                {desde.passados === 1 ? "conversa passada para a equipe" : "conversas passadas para a equipe"}
              </p>
              <div className={s.kfLista}>
                {desde.itens.length ? (
                  desde.itens.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={s.kfItem}
                      onClick={() => {
                        setDesdeAberto(false);
                        aoAbrirLead(d.contatoId);
                      }}
                    >
                      <span className={s.kfItemHora}>{d.hora}</span>
                      <b className={s.kfItemTitulo}>{d.titulo}</b>
                      <span className={s.kfItemMotivo}>{d.motivo}</span>
                    </button>
                  ))
                ) : (
                  <p className={s.kfDica}>A Janete ainda não mexeu em nada desde que você saiu.</p>
                )}
              </div>
              <div className={s.kfAcoes}>
                <button
                  ref={botaoRever}
                  id="kb-desde-rever"
                  type="button"
                  className={s.kfPrimario}
                  disabled={desde.reverBloqueado || !desde.itens.length}
                  aria-describedby={`${idDesde}-dica`}
                  onClick={() => {
                    setDesdeAberto(false);
                    aoRever();
                  }}
                >
                  <Play aria-hidden="true" size={16} strokeWidth={2} />
                  Rever no quadro
                </button>
                <button
                  type="button"
                  className={s.kfDiscreto}
                  onClick={() => {
                    aoMarcarVisto();
                    fecharDesde();
                  }}
                >
                  Marcar como visto
                </button>
              </div>
              <p className={s.kfDica} id={`${idDesde}-dica`}>
                {desde.reverBloqueado
                  ? "Espere o movimento que está na tela terminar para rever o dia."
                  : `O quadro volta ${desde.saidaDia ? `a ${desde.saidaDia}, ` : ""}às ${desde.saida} e anda até agora, decisão por decisão.`}
              </p>
                </>
              )}
            </div>
          ) : null}
        </div>

        {ehAdmin ? (
          <button id="kb-btn-etapas" type="button" className={s.kfBotao} data-etapas="" aria-label="Editar etapas" title="Editar etapas" onClick={aoEditarEtapas}>
            <SlidersHorizontal aria-hidden="true" size={16} strokeWidth={2} />
            <span className={s.kfBotaoTexto}>Editar etapas</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* =========================================================================
   "Rever no quadro": a régua do dia
   ========================================================================= */

type PropsReplay = {
  /** O horário mostrado ("09:47"). */
  hora: string;
  texto: string;
  tocando: boolean;
  aoTocar: () => void;
  min: number;
  max: number;
  valor: number;
  /** As decisões da Janete na régua (minutos, no mesmo eixo de `min` e `max`). */
  marcas: readonly { em: number; tipo: "mover" | "passar" }[];
  /** As setas pulam de uma decisão para a outra. */
  aoPasso: (direcao: 1 | -1) => void;
  aoMudar: (valor: number) => void;
  aoVoltar: () => void;
  /** "08:12" e "agora". */
  pontas: readonly [string, string];
};

/** O botão de tocar e pausar: o foco vai para ele ao entrar no "Rever no quadro". */
export const ID_REPLAY_TOCAR = "kb-replay-tocar";

export function ReplayKanban({ hora, texto, tocando, aoTocar, min, max, valor, marcas, aoPasso, aoMudar, aoVoltar, pontas }: PropsReplay) {
  const idRegua = useId();
  const faixa = Math.max(1, max - min);
  const tecla = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    aoPasso(ev.key === "ArrowRight" ? 1 : -1);
  };
  return (
    <section className={s.kfReplay} aria-label="Linha do tempo desde que você saiu">
      <button
        id={ID_REPLAY_TOCAR}
        type="button"
        className={s.kfPlay}
        data-replay-tocar=""
        aria-label={tocando ? "Pausar a reprodução" : "Reproduzir o dia a partir daqui"}
        onClick={aoTocar}
      >
        {tocando ? <Pause aria-hidden="true" size={18} strokeWidth={2} /> : <Play aria-hidden="true" size={18} strokeWidth={2} />}
      </button>
      <div className={s.kfReplayTit} role="status">
        <b className={s.kfReplayHora}>{hora}</b>
        <span className={s.kfReplayTexto}>{texto}</span>
      </div>
      <div className={s.kfRegua}>
        <div className={s.kfMarcas} aria-hidden="true">
          {marcas.map((m, i) => (
            <i key={i} className={s.kfMarca} data-tipo={m.tipo} style={{ left: `${((m.em - min) / faixa) * 100}%` }} />
          ))}
        </div>
        <label htmlFor={idRegua} className={s.kfSr}>
          Horário mostrado no quadro. As setas pulam de uma decisão da Janete para a outra.
        </label>
        <input
          id={idRegua}
          type="range"
          min={min}
          max={max}
          step={1}
          value={valor}
          aria-valuetext={hora}
          onChange={(ev) => aoMudar(Number(ev.target.value))}
          onKeyDown={tecla}
        />
        <div className={s.kfPontas} aria-hidden="true">
          <span>{pontas[0]}</span>
          <span>{pontas[1]}</span>
        </div>
      </div>
      <button type="button" className={s.kfVoltar} onClick={aoVoltar}>
        Voltar ao vivo
      </button>
    </section>
  );
}

/* =========================================================================
   Editar etapas (só o admin)
   ========================================================================= */

type PropsEtapas = {
  etapas: readonly Etapa[];
  /** Quantos leads cada etapa tem (arquivar só vazia). */
  leadsPorEtapa: Readonly<Record<string, number>>;
  acoes: Pick<AcoesDados, "editarEtapa" | "reordenarEtapas">;
  aoFechar: () => void;
};

/**
 * O que a caixa diz em cada recusa. Sem permissão, o banco devolve `sem_acesso` (reordenar_etapas) ou
 * `nao_encontrado` (o UPDATE do atendente não atinge nenhuma linha, pela RLS): o mesmo texto (spec 2.6).
 */
export const ERRO_ETAPA: Record<string, string> = {
  nome_vazio: "O nome da etapa não pode ficar vazio.",
  etapa_com_leads: "Mova os leads desta etapa antes de arquivar.",
  sem_etapa_de_entrada: "Deixe pelo menos uma etapa aberta para o lead novo entrar.",
  sem_permissao: "Só o admin edita as etapas.",
  sem_acesso: "Só o admin edita as etapas.",
  nao_encontrado: "Só o admin edita as etapas.",
  limite_tamanho: "O nome da etapa ficou longo demais.",
  falha: "Não deu para salvar essa mudança. Verifique a internet e tente de novo.",
};

/** As etapas na ordem do quadro: as abertas e, depois, Ganho e Perdido. */
function emOrdem(etapas: readonly Etapa[]): Etapa[] {
  const grupo = (e: Etapa) => (e.tipo === "aberta" ? 0 : 1);
  return [...etapas].sort((a, b) => grupo(a) - grupo(b) || a.ordem - b.ordem);
}

export function EditarEtapas({ etapas, leadsPorEtapa, acoes, aoFechar }: PropsEtapas) {
  const idTit = useId();
  const caixa = useRef<HTMLElement>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<{ etapaId: string; texto: string } | null>(null);
  const lista = emOrdem(etapas);

  useEffect(() => {
    caixa.current?.focus();
  }, []);

  const resultado = async (etapaId: string, pedido: Promise<Resultado>) => {
    const r = await pedido;
    if (r.ok) {
      setErro((e) => (e?.etapaId === etapaId ? null : e));
      return true;
    }
    setErro({ etapaId, texto: ERRO_ETAPA[r.erro] ?? "Não deu para salvar essa mudança." });
    return false;
  };

  const salvarNome = async (e: Etapa) => {
    const valor = rascunho[e.id];
    if (valor === undefined) return;
    // O nome que não mudou não vai ao banco.
    if (valor.trim() === e.nome.trim()) {
      setRascunho((r) => {
        const { [e.id]: _, ...resto } = r;
        return resto;
      });
      return;
    }
    const ok = await resultado(e.id, acoes.editarEtapa(e.id, { nome: valor }));
    if (ok || valor.trim() === "") {
      setRascunho((r) => {
        // só tira o rascunho que ainda é o salvo (a pessoa pode ter voltado a digitar)
        if (r[e.id] !== valor) return r;
        const { [e.id]: _, ...resto } = r;
        return resto;
      });
    }
  };

  // A ordem muda num grupo só (as abertas, ou Ganho e Perdido), tudo de uma vez (reordenar_etapas).
  const mover = (e: Etapa, passo: 1 | -1) => {
    const grupo = lista.filter((x) => (x.tipo === "aberta") === (e.tipo === "aberta"));
    const i = grupo.findIndex((x) => x.id === e.id);
    const j = i + passo;
    if (j < 0 || j >= grupo.length) return;
    const ids = grupo.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void resultado(e.id, acoes.reordenarEtapas(ids));
  };

  // Esc fecha; o Tab fica preso dentro da caixa.
  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.key === "Escape" && !ev.defaultPrevented) {
      ev.preventDefault();
      aoFechar();
      return;
    }
    if (ev.key !== "Tab" || !caixa.current) return;
    const focaveis = Array.from(
      caixa.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"),
    );
    if (!focaveis.length) return;
    const primeiro = focaveis[0]!;
    const ultimo = focaveis[focaveis.length - 1]!;
    if (ev.shiftKey && (document.activeElement === primeiro || document.activeElement === caixa.current)) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  };

  return (
    <div className={s.kfDlg}>
      <button type="button" className={s.kfVeu} aria-label="Fechar" tabIndex={-1} onClick={aoFechar} />
      <section
        ref={caixa}
        className={s.kfCaixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTit}
        tabIndex={-1}
        onKeyDown={tecla}
      >
        <div className={s.kfDlgCab}>
          <div>
            <p className={s.kfOlho}>Só o admin vê esta opção</p>
            <h2 className={s.kfDlgTitulo} id={idTit}>
              Editar etapas
            </h2>
            <p className={s.kfApoio}>Renomeie, troque a cor, mude a ordem, arquive e diga para onde a Janete pode mover.</p>
          </div>
          <button type="button" className={s.kfFechar} aria-label="Fechar" onClick={aoFechar}>
            <X aria-hidden="true" size={20} strokeWidth={2} />
          </button>
        </div>

        <div>
          {lista.map((e) => {
            const nome = nomeDaEtapa(e);
            const n = leadsPorEtapa[e.id] ?? 0;
            const grupo = lista.filter((x) => (x.tipo === "aberta") === (e.tipo === "aberta"));
            const gi = grupo.findIndex((x) => x.id === e.id);
            const corAtual = idCorDaEtapa(e);
            const dica = e.arquivada
              ? "Arquivada: não aparece no quadro"
              : n > 0
                ? n === 1
                  ? "Mova o lead desta etapa antes de arquivar"
                  : `Mova os ${n} leads desta etapa antes de arquivar`
                : "";
            const idNome = `${idTit}-nome-${e.id}`;
            return (
              <div key={e.id} className={s.kfEl} data-arquivada={e.arquivada || undefined} data-etapa={e.id}>
                <div className={s.kfOrdem}>
                  <button
                    type="button"
                    className={s.kfSeta}
                    aria-label={`Subir ${nome}`}
                    disabled={gi <= 0}
                    onClick={() => mover(e, -1)}
                  >
                    <ChevronUp aria-hidden="true" size={16} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className={s.kfSeta}
                    aria-label={`Descer ${nome}`}
                    disabled={gi >= grupo.length - 1}
                    onClick={() => mover(e, 1)}
                  >
                    <ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
                  </button>
                </div>
                <div className={s.kfNome}>
                  <label htmlFor={idNome} className={s.kfSr}>
                    Nome da etapa {nome}
                  </label>
                  <input
                    id={idNome}
                    type="text"
                    maxLength={MAX_NOME_ETAPA}
                    value={rascunho[e.id] ?? e.nome}
                    disabled={e.arquivada}
                    aria-invalid={erro?.etapaId === e.id || undefined}
                    onChange={(ev) => setRascunho((r) => ({ ...r, [e.id]: ev.target.value }))}
                    onBlur={() => salvarNome(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        ev.preventDefault();
                        salvarNome(e);
                      }
                    }}
                  />
                </div>
                {e.arquivada ? (
                  <button
                    type="button"
                    className={cx(s.kfDiscreto, s.kfSemContorno)}
                    onClick={() => resultado(e.id, acoes.editarEtapa(e.id, { arquivada: false }))}
                  >
                    Restaurar
                  </button>
                ) : (
                  <button
                    type="button"
                    className={cx(s.kfDiscreto, s.kfSemContorno)}
                    disabled={n > 0}
                    onClick={() => resultado(e.id, acoes.editarEtapa(e.id, { arquivada: true }))}
                  >
                    Arquivar
                  </button>
                )}
                <div className={s.kfLinha2}>
                  <div className={s.kfCores} role="group" aria-label={`Cor de ${nome}`}>
                    {CORES_ETAPA.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        className={s.kfCor}
                        style={{ background: k.valor }}
                        aria-label={k.nome}
                        aria-pressed={corAtual === k.id}
                        onClick={() => resultado(e.id, acoes.editarEtapa(e.id, { cor: k.id }))}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className={s.kfTroca}
                    role="switch"
                    aria-checked={e.janete_pode_mover}
                    onClick={() => resultado(e.id, acoes.editarEtapa(e.id, { janete_pode_mover: !e.janete_pode_mover }))}
                  >
                    <span className={s.kfTrocaTrilho} aria-hidden="true" />
                    <IconeJaneteContorno />
                    <span>A Janete pode mover para cá</span>
                  </button>
                  {dica ? <span className={s.kfDica}>{dica}</span> : null}
                  {erro?.etapaId === e.id ? (
                    <span className={s.kfErro} role="alert">
                      {erro.texto}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className={s.kfPe}>
          <button type="button" className={cx(s.kfPrimario)} onClick={aoFechar}>
            Pronto
          </button>
        </div>
      </section>
    </div>
  );
}
