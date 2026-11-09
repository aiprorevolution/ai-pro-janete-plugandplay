import { ArrowLeft, CircleCheck } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { cx } from "@/components/aipro/cx";

import { usePapel } from "../papel";
import { classeIco, difereDaAtual, Editor, iconeDe, prenderTab, type FocoEditor } from "./Editor";
import { useContexto } from "./loja";
import { Disco } from "./Pilha";
import {
  alvoDoItem,
  conteudoDe,
  noTetoDeItens,
  plural,
  situacao,
  TEXTO_TETO_ITENS,
  versaoNaTela,
  type EstadoContexto,
} from "./regras";
import { s } from "./secao-estilos";
import { camposDoGrupo, ehChaveCampo, GRUPOS, infoCampo, type Alvo, type GrupoId, type VersaoContexto } from "./tipos";

// A seção da área (spec-contexto.md, task C2; .ctx-sec do Contexto 6): o palco troca o mapa por 3
// colunas, sem nenhuma linha ligando nada. Esquerda: o Voltar, o disco da área, o nome e os outros 2
// discos pequenos. Meio: a lista. Direita: o editor de um item por vez. No celular, só a lista com o
// disco pequeno no alto; tocar num item abre o editor em tela cheia, com "←" para voltar à lista.
// Quem decide a área e o item é a tela (TelaContexto): aqui só se pede a troca.

export interface PropsSecao {
  grupo: GrupoId;
  /** O item aberto no editor. Se não for da área (ou não existir), abre o 1º da lista. */
  alvo: Alvo;
  aoEscolher(alvo: Alvo): void;
  aoTrocarGrupo(g: GrupoId): void;
  /** Voltar (e Esc): de volta ao mapa. */
  aoVoltar(): void;
  /** Tela estreita (celular): a lista e o editor em tela cheia. */
  estreita: boolean;
  /** Celular: o alvo veio de fora (uma linha ou um cartão do mapa), então o editor abre direto. */
  editorAberto?: boolean | undefined;
  /** Põe o foco no título da área ao abrir (padrão: sim). */
  focarAoAbrir?: boolean | undefined;
}

/** O 1º item de uma área (entrando pelo disco ou pelo título do grupo). */
export function primeiroAlvo(grupo: GrupoId): Alvo {
  if (grupo === "livres") return alvoDoItem(1);
  return camposDoGrupo(grupo)[0]!.chave;
}

/** Os itens da área na versão da tela, na ordem da lista (sem o "livre-novo"). */
export function itensDaArea(versao: VersaoContexto, grupo: GrupoId): Alvo[] {
  if (grupo === "livres") return versao.itens.map((_, k) => alvoDoItem(k + 1));
  return camposDoGrupo(grupo).map((c) => c.chave);
}

/** "4 de 4 com conteúdo" ou "3 perguntas". */
function contagemCurta(versao: VersaoContexto, grupo: GrupoId, longa = false): string {
  if (grupo === "livres") return plural(versao.itens.length, "pergunta", "perguntas");
  const campos = camposDoGrupo(grupo);
  const cheios = campos.filter((c) => versao.campos[c.chave].trim() || versao.anexos[c.chave].length).length;
  return `${cheios} de ${campos.length} ${longa ? "campos " : ""}com conteúdo`;
}

function nomeDoItem(estado: EstadoContexto, alvo: Alvo, verRascunho: boolean): string {
  if (ehChaveCampo(alvo)) return infoCampo(alvo).rotulo;
  if (alvo === "livre-novo") return "Novo item livre";
  return conteudoDe(estado, alvo, verRascunho)?.pergunta || "Pergunta sem texto";
}

export function Secao({
  grupo,
  alvo,
  aoEscolher,
  aoTrocarGrupo,
  aoVoltar,
  estreita,
  editorAberto = false,
  focarAoAbrir = true,
}: PropsSecao) {
  const { estado } = useContexto();
  const { papel } = usePapel();
  const admin = papel === "admin";
  const vendo = estado.vendo;
  const editavel = admin && vendo === null;
  const tela = versaoNaTela(estado);
  const g = GRUPOS.find((x) => x.id === grupo) ?? GRUPOS[0]!;

  const ids = itensDaArea(tela, grupo);
  const lista: Alvo[] = grupo === "livres" && editavel ? [...ids, "livre-novo"] : ids;
  // com 50 perguntas livres, o "Novo item livre" da lista fica desligado, com o motivo, como no mapa
  // (editavel: a tela é a atual)
  const noTeto = editavel && noTetoDeItens(tela);
  const efetivo: Alvo | null = lista.includes(alvo) ? alvo : (ids[0] ?? null);

  // celular: a lista ou o editor em tela cheia (trocar de área volta para a lista)
  const [edAberto, setEdAberto] = useState(editorAberto);
  const [visto, setVisto] = useState({ grupo, editorAberto });
  if (visto.grupo !== grupo || visto.editorAberto !== editorAberto) {
    setVisto({ grupo, editorAberto });
    setEdAberto(visto.grupo !== grupo ? editorAberto : editorAberto || edAberto);
  }
  const mostraEditor = !estreita || edAberto;

  const [focoEd, setFocoEd] = useState<FocoEditor>(estreita && editorAberto ? "titulo" : null);
  const [semAnel, setSemAnel] = useState<Alvo | null>(null);
  const [toast, setToast] = useState<{ id: number; texto: string } | null>(null);
  // a região viva fica sempre montada: um aviso que nasce já com o texto muitas vezes não é lido
  const [anuncio, setAnuncio] = useState("");
  const focoPendente = useRef<string | null>(null);
  const raiz = useRef<HTMLElement>(null);

  // o foco que um clique pediu, depois de a tela nova existir
  useEffect(() => {
    const id = focoPendente.current;
    if (!id) return;
    focoPendente.current = null;
    document.getElementById(id)?.focus({ preventScroll: true });
  });

  useEffect(() => {
    if (focarAoAbrir && !(estreita && editorAberto)) document.getElementById("ctx-sec-tit")?.focus({ preventScroll: true });
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const avisar = (texto: string) => {
    setToast((x) => ({ id: (x?.id ?? 0) + 1, texto }));
    setAnuncio(texto);
  };

  /** Troca o item do editor; `null` quando a área ficou sem item. */
  const escolher = (a: Alvo | null, foco: FocoEditor = null) => {
    setFocoEd(foco);
    if (a === null) {
      if (estreita) setEdAberto(false);
      aoEscolher(ids[0] ?? primeiroAlvo(grupo));
      return;
    }
    if (estreita) setEdAberto(true);
    aoEscolher(a);
  };

  const clicarItem = (a: Alvo, ev: MouseEvent<HTMLButtonElement>) => {
    // o item clicado recebe o foco; com mouse, sem anel
    setSemAnel(ev.detail > 0 ? a : null);
    if (!estreita) ev.currentTarget.focus({ preventScroll: true });
    escolher(a, estreita ? "titulo" : null);
  };

  const voltarLista = () => {
    setEdAberto(false);
    focoPendente.current = efetivo ? `ctx-it-${efetivo}` : "ctx-sec-tit";
  };

  const trocar = (outro: GrupoId) => {
    focoPendente.current = "ctx-sec-tit";
    setFocoEd(null);
    aoTrocarGrupo(outro);
  };

  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    // no celular, a seção é uma folha em tela cheia: o Tab fica dentro dela (o editor prende o dele antes)
    if (estreita && ev.key === "Tab") {
      prenderTab(ev, raiz.current);
      return;
    }
    if (ev.key !== "Escape" || ev.defaultPrevented) return;
    ev.preventDefault();
    if (estreita && edAberto) {
      voltarLista();
      return;
    }
    aoVoltar();
  };

  // setas para cima e para baixo andam pela lista
  const teclaLista = (ev: KeyboardEvent<HTMLElement>) => {
    setSemAnel(null);
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const botoes = Array.from(ev.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-item]"));
    const k = botoes.indexOf(document.activeElement as HTMLButtonElement);
    if (k < 0) return;
    ev.preventDefault();
    const j = Math.max(0, Math.min(botoes.length - 1, k + (ev.key === "ArrowDown" ? 1 : -1)));
    botoes[j]!.focus();
  };

  const dormindo = vendo !== null;

  return (
    <section
      ref={raiz}
      id="ctx-secao"
      className={s.secao}
      data-secao={grupo}
      data-estreita={estreita ? "" : undefined}
      data-antiga={dormindo ? "" : undefined}
      tabIndex={-1}
      role={estreita ? "dialog" : undefined}
      aria-modal={estreita ? "true" : undefined}
      aria-labelledby="ctx-sec-tit"
      onKeyDown={tecla}
    >
      <div className={s.esq}>
        {/* no celular, com o editor aberto, quem volta é o "←" do editor (um gancho só na tela) */}
        {!(estreita && edAberto) ? (
          <button
            type="button"
            id="ctx-sec-voltar"
            data-acao="voltar"
            className={s.voltar}
            aria-label={estreita ? "Voltar para o mapa" : "Voltar para o mapa (Esc)"}
            onClick={aoVoltar}
          >
            <ArrowLeft strokeWidth={1.75} aria-hidden="true" />
            <span>Voltar</span>
            {!estreita ? (
              <span className={s.kbd} aria-hidden="true">
                Esc
              </span>
            ) : null}
          </button>
        ) : null}

        <div className={s.atual}>
          <span className={s.discoCaixa} aria-hidden="true">
            <Disco grupo={grupo} d={estreita ? 92 : 180} idFace={`ctx-sd-face-${grupo}`} dormindo={dormindo} className={s.discoG} />
          </span>
          <div className={s.nome}>
            <div key={grupo} className={s.nomeIn}>
              <h2 id="ctx-sec-tit" className={s.titulo} tabIndex={-1}>
                {g.nome}
              </h2>
              <p className={s.meta}>{contagemCurta(tela, grupo)}</p>
            </div>
          </div>
        </div>

        <div className={s.outros} role="group" aria-label="Trocar de área">
          {GRUPOS.filter((x) => x.id !== grupo).map((o) => (
            <button
              key={o.id}
              type="button"
              id={`ctx-tr-${o.id}`}
              data-trocar={o.id}
              className={s.troca}
              aria-label={`Trocar para ${o.nome}: ${contagemCurta(tela, o.id, true)}.`}
              onClick={() => trocar(o.id)}
            >
              <span className={s.trocaCaixa} aria-hidden="true">
                <Disco grupo={o.id} d={estreita ? 46 : 60} idFace={`ctx-sd-face-${o.id}`} dormindo={dormindo} className={s.discoP} />
              </span>
              <span className={s.trocaRot} aria-hidden="true">
                {o.curto}
              </span>
            </button>
          ))}
        </div>
      </div>

      <nav className={s.lista} aria-label={grupo === "livres" ? "Perguntas livres" : `Campos de ${g.nome}`} onKeyDown={teclaLista}>
        <div key={grupo} className={s.listaIn}>
          {lista.map((a) => {
            const Icone = iconeDe(a);
            const novo = a === "livre-novo";
            const desligado = novo && noTeto;
            // no celular, só fica destacado o item com o editor aberto
            const aberto = a === efetivo && mostraEditor;
            const sit = situacao(estado, a, admin);
            const muda = dormindo && difereDaAtual(estado, a);
            const nome = nomeDoItem(estado, a, admin);
            const estAria =
              sit === "nao_salvo"
                ? "mudanças não salvas"
                : novo
                  ? "acrescentar uma pergunta e a resposta"
                  : sit === "sabe"
                    ? "a Janete sabe"
                    : "ainda vazio";
            const k = ids.indexOf(a) + 1;
            const rotulo = ehChaveCampo(a) || novo ? nome : `Pergunta livre ${k}: ${nome}`;
            return (
              <button
                key={a}
                type="button"
                id={`ctx-it-${a}`}
                data-item={a}
                className={cx(
                  s.li,
                  sit === "vazio" && !novo && s.liVazio,
                  novo && s.liNovo,
                  muda && s.liMuda,
                )}
                data-desligado={desligado ? "" : undefined}
                aria-current={aberto ? "true" : undefined}
                aria-label={`${rotulo}, ${estAria}${muda ? ", diferente da versão atual" : ""}${aberto ? ", no editor" : ""}.`}
                data-sem-anel={semAnel === a ? "" : undefined}
                // aria-disabled (e não disabled): o item segue no Tab e nas setas, e o leitor de tela lê o motivo
                aria-disabled={desligado ? "true" : undefined}
                aria-describedby={desligado ? "ctx-it-novo-motivo" : undefined}
                onClick={(ev) => {
                  if (!desligado) clicarItem(a, ev);
                }}
                onBlur={() => {
                  if (semAnel === a) setSemAnel(null);
                }}
              >
                <span className={cx(s.ico, s.g36, classeIco(estado, a, admin))} aria-hidden="true">
                  <Icone strokeWidth={1.75} />
                </span>
                <span className={s.liNome} aria-hidden="true">
                  {nome}
                </span>
                {desligado ? (
                  <span id="ctx-it-novo-motivo" className={s.liMotivo} data-motivo="">
                    {TEXTO_TETO_ITENS}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {mostraEditor ? (
        <Editor
          grupo={grupo}
          alvo={efetivo}
          ids={ids}
          aoEscolher={escolher}
          aoAvisar={avisar}
          estreita={estreita}
          aoVoltarLista={voltarLista}
          focoInicial={focoEd}
          aoAnunciar={setAnuncio}
        />
      ) : null}

      {toast ? (
        <p key={toast.id} className={s.toast} aria-hidden="true">
          <CircleCheck className={s.toastIc} strokeWidth={2} aria-hidden="true" />
          <span>{toast.texto}</span>
        </p>
      ) : null}

      <p className={s.sr} aria-live="polite" data-anuncio="">
        {anuncio}
      </p>
    </section>
  );
}
