import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  History,
  Lock,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Aviso, Botao } from "@/components/aipro";
import { cx } from "@/components/aipro/cx";

import { contarLetras } from "../dados/tipos";
import { usePapel } from "../papel";
import { e } from "./editor-estilos";
import { useContexto } from "./loja";
import {
  alvoDoItem,
  aplicarRascunho,
  dadosDoAlvo,
  LIMITE_LETRAS,
  noTetoDeItens,
  numeroDoItem,
  proximoNumero,
  quando,
  rascunhoMuda,
  situacao,
  TEXTO_TETO_ITENS,
  versaoAtual,
  versaoNaTela,
  versaoPorId,
  type EstadoContexto,
} from "./regras";
import { s } from "./secao-estilos";
import { ehChaveCampo, infoCampo, type Alvo, type ChaveCampo, type ErroContexto, type GrupoId, type ResultadoContexto } from "./tipos";

// O editor da seção (spec-contexto.md, task C2; .ctx-ed do Contexto 6): um item por vez, na 3ª coluna.
// Num campo: o que a Janete sabe e a caixa de mandar. Numa pergunta livre: a pergunta e a resposta, e
// "Remover". O atendente e a versão antiga só leem. Tudo passa pela loja (useContexto): o editor não
// guarda o conteúdo, só o que é da tela (a caixa, o modo de edição). Na v1 não há anexos nem links
// (decisão 11a), e cada campo, pergunta e resposta vão até 2.000 letras, com contador (11d).

/** Para onde o foco vai quando o editor troca de item (anterior e próximo mantêm o foco no botão). */
export type FocoEditor = "anterior" | "proximo" | "titulo" | null;

export interface PropsEditor {
  grupo: GrupoId;
  /** O item aberto; `null` quando a área não tem nenhum (Perguntas livres vazia). */
  alvo: Alvo | null;
  /** Os itens da área, na ordem da lista, para anterior e próximo (sem o "livre-novo"). */
  ids: readonly Alvo[];
  /** Troca o item do editor (`null`: nenhum, a área ficou vazia). */
  aoEscolher(alvo: Alvo | null, foco?: FocoEditor): void;
  /** Um aviso curto na tela ("Versão 7 salva"). */
  aoAvisar(texto: string): void;
  estreita: boolean;
  /** Celular: o "←" volta para a lista. */
  aoVoltarLista?: (() => void) | undefined;
  /** O foco ao montar o item (o editor remonta a cada troca). */
  focoInicial?: FocoEditor | undefined;
  /** O que o leitor de tela deve ouvir (a região viva da seção, que já existe na tela). */
  aoAnunciar?: ((texto: string) => void) | undefined;
}

/** O que dá para focar dentro de um elemento (para prender o Tab nas folhas do celular). */
export function focaveisEm(raiz: HTMLElement | null): HTMLElement[] {
  if (!raiz) return [];
  const sel = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
  return Array.from(raiz.querySelectorAll<HTMLElement>(sel)).filter((el) => !el.closest("[hidden], [inert]"));
}

/** Prende o Tab dentro de `raiz`: do último volta ao 1º, e vice-versa (como no ConfirmarRemover). */
export function prenderTab(ev: KeyboardEvent<HTMLElement>, raiz: HTMLElement | null): void {
  if (ev.key !== "Tab" || ev.defaultPrevented) return;
  const lista = focaveisEm(raiz);
  if (!lista.length) return;
  const ativo = document.activeElement as HTMLElement | null;
  const k = ativo ? lista.indexOf(ativo) : -1;
  const primeiro = lista[0]!;
  const ultimo = lista[lista.length - 1]!;
  if (ev.shiftKey ? k <= 0 : k === lista.length - 1 || k < 0) {
    ev.preventDefault();
    (ev.shiftKey ? ultimo : primeiro).focus();
  }
}

/* ---------- ajudantes que a lista da seção também usa ---------- */

/** O alvo está diferente na versão antiga que está na tela, em relação à atual? */
export function difereDaAtual(estado: EstadoContexto, alvo: Alvo): boolean {
  if (estado.vendo === null) return false;
  const a = dadosDoAlvo(versaoAtual(estado), alvo);
  const b = dadosDoAlvo(versaoNaTela(estado), alvo);
  if (!a || !b) return a !== b;
  return (
    a.texto.trim() !== b.texto.trim() ||
    a.pergunta.trim() !== b.pergunta.trim() ||
    a.anexos.length !== b.anexos.length ||
    a.anexos.some((x, i) => x.id !== b.anexos[i]?.id)
  );
}

/** A classe do círculo do ícone: o contorno conta a situação. */
export function classeIco(estado: EstadoContexto, alvo: Alvo, verRascunho: boolean): string {
  const sit = situacao(estado, alvo, verRascunho);
  if (sit === "vazio") return s.icoVazio;
  if (sit === "nao_salvo") return s.icoRasc;
  return estado.vendo !== null ? s.icoAntiga : "";
}

/** O ícone de um item da área. */
export function iconeDe(alvo: Alvo): LucideIcon {
  if (ehChaveCampo(alvo)) return infoCampo(alvo).icone;
  return alvo === "livre-novo" ? Plus : MessageSquareText;
}

/** O texto do erro que a loja devolveu, para o aviso na tela. */
export function textoDoErro(erro: ErroContexto): string {
  switch (erro) {
    case "sem_permissao":
      return "Só o admin pode mudar o que a Janete sabe.";
    case "versao_antiga":
      return "Você está vendo uma versão antiga. Volte para a atual para mudar algo.";
    case "nao_encontrado":
      return "Esse item não existe mais nesta versão.";
    case "vazio":
      return "Não há nada novo para salvar.";
    case "ocupado":
      return "Você já tem uma pergunta nova sem salvar. Abra, salve ou descarte antes.";
    case "contexto_mudou":
      return "O Contexto mudou enquanto você editava.";
    case "limite_tamanho":
      return `Passou de ${LIMITE_LETRAS.toLocaleString("pt-BR")} letras. Corte um pouco para salvar.`;
    case "limite_itens":
      return TEXTO_TETO_ITENS;
    case "falha":
      return "Não deu para salvar agora. Verifique a internet e tente de novo.";
  }
}

/** "1.234 de 2.000 letras". */
function contadorTexto(n: number): string {
  return `${n.toLocaleString("pt-BR")} de ${LIMITE_LETRAS.toLocaleString("pt-BR")} letras`;
}

/** O contador de letras (decisão 11d): fica vermelho acima do limite. */
function Contador({ n, id }: { n: number; id?: string | undefined }) {
  const passou = n > LIMITE_LETRAS;
  return (
    <p id={id} className={cx(e.contador, passou && e.contadorPassou)} data-contador="" data-passou={passou ? "" : undefined} aria-live={passou ? "polite" : undefined}>
      {contadorTexto(n)}
    </p>
  );
}

/** O texto do campo com o que chegou pela caixa, sem aparar o que o admin está digitando. */
function textoBruto(base: string, extras: readonly string[]): string {
  return extras.length ? [base, ...extras].filter((t) => t.trim()).join("\n\n") : base;
}

/** "Hoje, 18:20" vira "hoje, 18:20" no meio da frase. */
function minuscula(t: string): string {
  return t.charAt(0).toLowerCase() + t.slice(1);
}

function focar(el: HTMLElement | null | undefined): void {
  el?.focus({ preventScroll: true });
}

/** O símbolo da Janete, pequeno (o do app: disco navy e o ponto de fala azul). */
function JaneteSimbolo() {
  return (
    <img className={e.janeteSvg} width="20" height="20" src="/brand/aipro-icone.png" alt="" aria-hidden="true" />
  );
}

/* ---------- o editor ---------- */

export function Editor({ grupo, alvo, ids, aoEscolher, aoAvisar, estreita, aoVoltarLista, focoInicial = null, aoAnunciar }: PropsEditor) {
  const raiz = useRef<HTMLDivElement>(null);
  // no celular, o editor é uma folha em tela cheia por cima da seção: um diálogo, com o Tab preso nele
  return (
    <div
      ref={raiz}
      id="ctx-editor"
      className={e.ed}
      role={estreita ? "dialog" : "region"}
      aria-modal={estreita ? "true" : undefined}
      aria-labelledby="ctx-ed-tit"
      data-estreita={estreita ? "" : undefined}
      onKeyDown={estreita ? (ev) => prenderTab(ev, raiz.current) : undefined}
    >
      <Miolo
        aoAnunciar={aoAnunciar}
        key={alvo ?? "nenhum"}
        grupo={grupo}
        alvo={alvo}
        ids={ids}
        aoEscolher={aoEscolher}
        aoAvisar={aoAvisar}
        estreita={estreita}
        aoVoltarLista={aoVoltarLista}
        focoInicial={focoInicial}
      />
    </div>
  );
}

/** O miolo de um item: remonta a cada troca (a caixa, o menu e o modo de edição são do item). */
function Miolo({ grupo, alvo, ids, aoEscolher, aoAvisar, estreita, aoVoltarLista, focoInicial, aoAnunciar }: PropsEditor) {
  const { estado, acoes } = useContexto();
  const { papel } = usePapel();
  const admin = papel === "admin";
  const vendo = estado.vendo;
  const leitura = !admin || vendo !== null;
  const atual = versaoAtual(estado);
  const tela = versaoNaTela(estado);
  const proxima = proximoNumero(estado);

  const [editando, setEditando] = useState(false);
  const [comp, setComp] = useState("");
  const [janeteDiz, setJaneteDiz] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Com "contexto_mudou": o que o outro admin deixou neste item (decisão 11b). */
  const [textoNovo, setTextoNovo] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  /** Salvando ou removendo: os botões esperam a resposta do banco. */
  const [gravando, setGravando] = useState(false);

  const titulo = useRef<HTMLHeadingElement>(null);
  const ant = useRef<HTMLButtonElement>(null);
  const prox = useRef<HTMLButtonElement>(null);
  const corpo = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);
  const btnEditar = useRef<HTMLButtonElement>(null);
  const btnRemover = useRef<HTMLButtonElement>(null);
  // o "editando" do último efeito: no StrictMode o efeito roda 2 vezes ao montar, e só a troca de
  // verdade leva o foco (um ref de "já montou" moveria o foco para "Editar texto" na 2ª rodada)
  const editandoAntes = useRef(editando);

  // o foco ao trocar de item: o botão que andou, ou o título (nas pontas e no celular)
  useEffect(() => {
    if (focoInicial === "anterior") focar(ant.current?.disabled ? titulo.current : ant.current);
    else if (focoInicial === "proximo") focar(prox.current?.disabled ? titulo.current : prox.current);
    else if (focoInicial === "titulo") focar(titulo.current);
    // só na montagem: cada item monta de novo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // entrar e sair do "Editar texto" leva o foco junto (não na montagem)
  useEffect(() => {
    if (editandoAntes.current === editando) return;
    editandoAntes.current = editando;
    focar(editando ? area.current : btnEditar.current);
  }, [editando]);

  // o que a Janete diz no pé (o "Anotei em…") vai para a região viva da seção
  useEffect(() => {
    if (janeteDiz) aoAnunciar?.(janeteDiz);
    // só quando a frase muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [janeteDiz]);

  /* ---------- o cabeçalho ---------- */

  const novo = alvo === "livre-novo";
  const campo: ChaveCampo | null = alvo && ehChaveCampo(alvo) ? alvo : null;
  const n = alvo ? numeroDoItem(alvo) : null;
  const Icone = alvo ? iconeDe(alvo) : MessageSquareText;

  const nome = !alvo ? "Perguntas livres" : campo ? infoCampo(campo).rotulo : novo ? "Nova pergunta livre" : `Pergunta livre ${n}`;

  let estadoTxt = "Nenhuma pergunta ainda";
  let estadoClasse = "";
  let EstadoIcone: LucideIcon = Circle;
  if (alvo) {
    if (vendo !== null) {
      const muda = difereDaAtual(estado, alvo);
      estadoTxt = muda ? "Diferente da versão atual" : "Igual à versão atual";
      estadoClasse = muda ? e.estadoMuda : "";
      EstadoIcone = History;
    } else if (novo) {
      estadoTxt = `Nasce na versão ${proxima}`;
      estadoClasse = e.estadoAzul;
    } else {
      const sit = situacao(estado, alvo, admin);
      if (sit === "nao_salvo") {
        estadoTxt = "Não salvo";
        estadoClasse = e.estadoAzul;
      } else if (sit === "sabe") {
        estadoTxt = "A Janete sabe";
        estadoClasse = e.estadoSabe;
        EstadoIcone = CircleCheck;
      } else estadoTxt = "Ainda vazio";
    }
  }

  const i = !alvo ? -1 : novo ? ids.length : ids.indexOf(alvo);
  const temNav = !!alvo && i >= 0;
  const rotuloDe = (a: Alvo): string => {
    if (ehChaveCampo(a)) return infoCampo(a).rotulo;
    const k = numeroDoItem(a);
    const item = k === null ? undefined : tela.itens[k - 1];
    return item ? item.pergunta : "Pergunta livre";
  };
  const navegar = (delta: number) => {
    const j = i + delta;
    const destino = ids[j];
    if (!destino) return;
    const ponta = delta < 0 ? j === 0 : j === ids.length - 1;
    aoEscolher(destino, ponta ? "titulo" : delta < 0 ? "anterior" : "proximo");
  };

  let aviso: string | null = null;
  if (vendo !== null) {
    const v = versaoPorId(estado, vendo);
    const q = v ? quando(v.criadoEm, Date.now()) : "";
    aviso = `Versão ${v?.numero ?? ""}${q ? `, de ${minuscula(q)}` : ""}: só leitura. Para mudar algo, volte para a atual.`;
  } else if (!admin) aviso = "Como atendente, você lê tudo, sem editar.";

  /* ---------- as ações ---------- */

  const mostrarErro = (r: Extract<ResultadoContexto, { ok: false }>) => {
    setErro(textoDoErro(r.erro));
    setTextoNovo(r.erro === "contexto_mudou" ? (r.textoNovo ?? "") : null);
  };

  const tratar = (r: ResultadoContexto): boolean => {
    if (r.ok) {
      setErro(null);
      setTextoNovo(null);
      return true;
    }
    mostrarErro(r);
    return false;
  };

  const salvar = async () => {
    if (!alvo || gravando) return;
    // a pergunta nova vira a última da lista
    const novoN = atual.itens.length + 1;
    setGravando(true);
    const r = await acoes.salvar(alvo);
    setGravando(false);
    if (!r.ok) {
      mostrarErro(r);
      return;
    }
    setErro(null);
    setTextoNovo(null);
    setJaneteDiz(null);
    setEditando(false);
    aoAvisar(r.versao ? `Versão ${r.versao} salva` : "Salvo");
    if (novo) aoEscolher(alvoDoItem(novoN), "titulo");
    else focar(titulo.current);
  };

  const descartar = () => {
    if (!alvo) return;
    if (!tratar(acoes.descartar(alvo))) return;
    setJaneteDiz(null);
    setEditando(false);
    if (novo) {
      aoEscolher(ids[0] ?? null, null);
      return;
    }
    aoAvisar("Mudanças descartadas");
    focar(titulo.current);
  };

  const remover = async () => {
    if (n === null || gravando) return;
    // o editor passa para a pergunta seguinte (que sobe para o lugar dela) ou a anterior
    const c = atual.itens.length - 1;
    setGravando(true);
    const r = await acoes.removerItem(n);
    setGravando(false);
    setConfirmar(false);
    if (!r.ok) {
      mostrarErro(r);
      return;
    }
    aoAvisar(`Pergunta removida. Versão ${r.versao ?? proxima} salva`);
    aoEscolher(n <= c ? alvoDoItem(n) : c > 0 ? alvoDoItem(c) : null, "titulo");
  };

  const mandarCaixa = () => {
    if (!campo) return;
    const t = comp.trim();
    if (!t) return;
    if (!tratar(acoes.mandar(campo, t))) return;
    setJaneteDiz(`Anotei em ${infoCampo(campo).rotulo}. Salve para eu começar a usar.`);
    setComp("");
    focar(caixa.current);
  };

  /* ---------- o corpo de cada tipo de item ---------- */

  let conteudoCorpo: ReactNode = null;
  let pe: ReactNode = null;

  if (!alvo) {
    conteudoCorpo = (
      <div className={e.vazio}>
        <b>Nenhuma pergunta livre ainda.</b>
        <span>
          {admin && vendo === null
            ? "Use “Novo item livre”, na lista, para criar a primeira: uma pergunta que os leads fazem e a resposta que a Janete deve dar."
            : "Quando o admin criar uma, ela aparece aqui."}
        </span>
      </div>
    );
  } else if (campo) {
    const info = infoCampo(campo);
    const r = leitura ? undefined : estado.rascunhos[campo];
    const salvo = dadosDoAlvo(tela, campo);
    const base = r?.texto ?? salvo?.texto ?? "";
    const extras = r?.extras ?? [];
    const temTexto = !!(base.trim() || extras.length);
    const sujo = !leitura && rascunhoMuda(estado, campo);
    // o que vai ser salvo: o texto com o que chegou pela caixa (o limite vale para o total), contado
    // como o banco conta (o emoji vale 1 letra)
    const letras = salvo && r ? contarLetras(aplicarRascunho(salvo, r).texto) : contarLetras(salvo?.texto.trim() ?? "");
    const passou = letras > LIMITE_LETRAS;
    const vazioTxt =
      vendo !== null
        ? "Nesta versão, este campo estava vazio."
        : !admin
          ? "Só o admin pode preencher."
          : `${info.ajuda} Escreva na caixa abaixo.`;

    conteudoCorpo = (
      <>
        <div className={e.sec}>
          <div className={e.rot}>
            <span>O que a Janete sabe</span>
            {!leitura ? (
              <Botao
                ref={btnEditar}
                id="ctx-ed-editar"
                variante="discreto"
                tamanho="compacto"
                icone={<Pencil size={16} strokeWidth={2} />}
                onClick={() => setEditando((x) => !x)}
              >
                {editando ? "Terminar edição" : "Editar texto"}
              </Botao>
            ) : null}
          </div>
          {editando ? (
            <div className={e.fCampo}>
              <label className={e.sr} htmlFor={`ctx-ta-${campo}`}>
                O que a Janete sabe sobre {info.rotulo}
              </label>
              <textarea
                ref={area}
                id={`ctx-ta-${campo}`}
                className={e.area}
                rows={5}
                value={textoBruto(base, extras)}
                placeholder={info.ajuda}
                aria-describedby={`ctx-cont-${campo}`}
                onChange={(ev) => tratar(acoes.editarTexto(campo, ev.target.value))}
              />
              <Contador id={`ctx-cont-${campo}`} n={letras} />
            </div>
          ) : temTexto ? (
            <p className={e.texto}>
              {base.trim()}
              {extras.map((x, k) => (
                <span key={k}>
                  {base.trim() || k > 0 ? " " : ""}
                  <span className={e.extra}>{x}</span>
                </span>
              ))}
            </p>
          ) : (
            <div className={e.vazio}>
              <b>A Janete ainda não sabe nada sobre {info.rotulo}.</b>
              <span>{vazioTxt}</span>
            </div>
          )}
        </div>

      </>
    );

    if (!leitura) {
      pe = (
        <div className={e.pe}>
          {janeteDiz ? (
            <p className={e.janeteDiz}>
              <JaneteSimbolo />
              <span>{janeteDiz}</span>
            </p>
          ) : null}
          <div className={e.comp}>
            <label className={e.sr} htmlFor={`ctx-comp-${campo}`}>
              {`Mandar para a Janete sobre ${info.rotulo}`}
            </label>
            <textarea
              ref={caixa}
              id={`ctx-comp-${campo}`}
              className={e.compIn}
              rows={1}
              value={comp}
              placeholder="Conte algo novo"
              onChange={(ev) => setComp(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !ev.shiftKey) {
                  ev.preventDefault();
                  mandarCaixa();
                }
              }}
            />
            <button type="button" className={e.enviar} aria-label="Mandar para a Janete" disabled={!comp.trim()} onClick={mandarCaixa}>
              <ArrowUp strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {sujo ? (
            <div className={e.barra}>
              <p className={e.barraTxt}>
                <i className={e.barraPonto} aria-hidden="true" />
                <span>{passou ? textoDoErro("limite_tamanho") : `Mudanças não salvas em ${info.rotulo}`}</span>
              </p>
              {editando ? null : <Contador n={letras} />}
              <div className={e.barraAcoes}>
                <Botao variante="discreto" disabled={gravando} onClick={descartar}>
                  Descartar
                </Botao>
                <Botao id={`ctx-sv-${campo}`} data-acao="salvar" disabled={passou || gravando} onClick={() => void salvar()}>
                  {gravando ? "Salvando…" : `Salvar versão ${proxima}`}
                </Botao>
              </div>
            </div>
          ) : null}
        </div>
      );
    }
  } else {
    // uma pergunta livre (ou a nova)
    const item = alvo as Exclude<Alvo, ChaveCampo>;
    const r = leitura ? undefined : estado.rascunhos[item];
    const salvo = dadosDoAlvo(tela, item);
    const fPerg = r?.pergunta ?? salvo?.pergunta ?? "";
    const fResp = textoBruto(r?.texto ?? r?.resposta ?? salvo?.texto ?? "", r?.extras ?? []);
    const faltaQR = !fPerg.trim() || !fResp.trim();
    const sujo = !leitura && (novo || rascunhoMuda(estado, item));
    const letras = salvo && r ? contarLetras(aplicarRascunho(salvo, r).texto) : contarLetras(salvo?.texto.trim() ?? "");
    // a pergunta conta como o salvar manda (aparada); a do Ensinar pode chegar já acima do limite
    const letrasPerg = contarLetras(fPerg.trim());
    const passou = letras > LIMITE_LETRAS || letrasPerg > LIMITE_LETRAS;
    // a 51ª pergunta não nasce: os campos ficam só de leitura (com o rascunho que sobrou, se houver),
    // o salvar trava e o motivo fica na barra, ligado aos campos
    const teto = novo && noTetoDeItens(atual);
    const idTeto = `ctx-teto-${item}`;

    conteudoCorpo = leitura ? (
      <>
        <div className={e.sec}>
          <p className={e.rot}>Pergunta</p>
          <p className={e.livreP}>{salvo?.pergunta}</p>
        </div>
        <div className={e.sec}>
          <p className={e.rot}>Resposta</p>
          <p className={e.texto}>{salvo?.texto.trim() || "Sem resposta ainda."}</p>
        </div>
      </>
    ) : (
      <>
        <div className={e.fCampo}>
          <label className={e.campoRotulo} htmlFor={`ctx-perg-${item}`}>
            Pergunta
          </label>
          <input
            id={`ctx-perg-${item}`}
            className={e.entrada}
            type="text"
            autoComplete="off"
            value={fPerg}
            maxLength={LIMITE_LETRAS}
            placeholder="Ex.: Vocês atendem aos sábados?"
            readOnly={teto}
            aria-describedby={teto ? `${idTeto} ctx-cont-perg-${item}` : `ctx-cont-perg-${item}`}
            onChange={(ev) => tratar(acoes.editarItem(item, { pergunta: ev.target.value }))}
          />
          <Contador id={`ctx-cont-perg-${item}`} n={letrasPerg} />
        </div>
        <div className={e.fCampo}>
          <label className={e.campoRotulo} htmlFor={`ctx-ta-${item}`}>
            Resposta
          </label>
          <textarea
            id={`ctx-ta-${item}`}
            className={e.area}
            rows={4}
            value={fResp}
            placeholder="Ex.: Sim, das 9h às 13h."
            readOnly={teto}
            aria-describedby={teto ? `${idTeto} ctx-cont-${item}` : `ctx-cont-${item}`}
            onChange={(ev) => tratar(acoes.editarItem(item, { resposta: ev.target.value }))}
          />
          <Contador id={`ctx-cont-${item}`} n={letras} />
        </div>
        {!novo ? (
          <div className={e.rem}>
            <Botao
              ref={btnRemover}
              id={`ctx-rem-${item}`}
              variante="discreto"
              tamanho="compacto"
              className={e.remover}
              icone={<Trash2 size={16} strokeWidth={2} />}
              onClick={() => setConfirmar(true)}
            >
              Remover pergunta
            </Botao>
          </div>
        ) : null}
      </>
    );

    if (sujo) {
      pe = (
        <div className={e.pe}>
          <div className={e.barra}>
            <p className={e.barraTxt}>
              <i className={e.barraPonto} aria-hidden="true" />
              <span id={teto ? idTeto : undefined}>
                {teto
                  ? TEXTO_TETO_ITENS
                  : faltaQR
                  ? "Escreva a pergunta e a resposta para salvar"
                  : passou
                    ? textoDoErro("limite_tamanho")
                    : novo
                      ? "Pergunta nova, ainda não salva"
                      : "Mudanças não salvas nesta pergunta"}
              </span>
            </p>
            <div className={e.barraAcoes}>
              <Botao variante="discreto" disabled={gravando} onClick={descartar}>
                {novo ? "Cancelar" : "Descartar"}
              </Botao>
              <Botao id={`ctx-sv-${item}`} data-acao="salvar" disabled={teto || faltaQR || passou || gravando} onClick={() => void salvar()}>
                {gravando ? "Salvando…" : `Salvar versão ${proxima}`}
              </Botao>
            </div>
          </div>
        </div>
      );
    }
  }

  const perguntaRemover = n !== null ? (tela.itens[n - 1]?.pergunta ?? "") : "";

  return (
    <div className={e.edIn} data-ed-alvo={alvo ?? undefined} data-ed-grupo={grupo} aria-busy={gravando || undefined}>
      <header className={e.cab}>
        {estreita ? (
          <button
            type="button"
            id="ctx-ed-volta"
            data-acao="voltar"
            className={e.volta}
            aria-label="Voltar para a lista"
            onClick={aoVoltarLista}
          >
            <ArrowLeft strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        <span className={cx(s.ico, s.g40, alvo ? classeIco(estado, alvo, admin) : s.icoVazio)} aria-hidden="true">
          <Icone strokeWidth={1.75} />
        </span>
        <div className={e.id}>
          <h3 ref={titulo} id="ctx-ed-tit" className={e.tit} tabIndex={-1}>
            {nome}
          </h3>
          <p className={cx(e.estado, estadoClasse)}>
            <EstadoIcone strokeWidth={2} aria-hidden="true" />
            <span>{estadoTxt}</span>
          </p>
        </div>
        {temNav ? (
          <div className={e.nav} role="group" aria-label="Anterior e próximo">
            <button
              ref={ant}
              type="button"
              id="ctx-ed-ant"
              data-acao="anterior"
              className={e.navBtn}
              disabled={i <= 0}
              aria-label={i > 0 ? `Anterior: ${rotuloDe(ids[i - 1]!)}` : "Anterior (este é o primeiro)"}
              onClick={() => navegar(-1)}
            >
              <ChevronUp strokeWidth={1.75} aria-hidden="true" />
            </button>
            <span className={e.pos} aria-hidden="true">
              {novo ? "Nova" : `${i + 1} de ${ids.length}`}
            </span>
            <button
              ref={prox}
              type="button"
              id="ctx-ed-prox"
              data-acao="proximo"
              className={e.navBtn}
              disabled={i >= ids.length - 1}
              aria-label={i < ids.length - 1 ? `Próximo: ${rotuloDe(ids[i + 1]!)}` : "Próximo (este é o último)"}
              onClick={() => navegar(1)}
            >
              <ChevronDown strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </header>

      {aviso ? (
        <Aviso tom="info" compacto className={e.aviso} icone={<Lock size={18} strokeWidth={1.9} aria-hidden="true" />}>
          {aviso}
        </Aviso>
      ) : null}
      {erro ? (
        <Aviso
          tom="erro"
          compacto
          className={e.aviso}
          aoFechar={() => {
            setErro(null);
            setTextoNovo(null);
          }}
        >
          {erro}
          {textoNovo !== null ? (
            <>
              {textoNovo ? (
                <>
                  {" "}
                  Agora está assim:
                  <span className={e.textoNovo} data-texto-novo="">
                    {textoNovo}
                  </span>
                </>
              ) : (
                " Agora este item está vazio."
              )}{" "}
              Confira e salve de novo para ficar com o seu texto.
            </>
          ) : null}
        </Aviso>
      ) : null}

      <div ref={corpo} id="ctx-ed-corpo" className={e.corpo}>
        {conteudoCorpo}
      </div>

      {pe}

      {confirmar ? (
        <ConfirmarRemover
          pergunta={perguntaRemover}
          nova={proxima}
          atual={atual.numero}
          aoCancelar={() => {
            setConfirmar(false);
            focar(btnRemover.current);
          }}
          gravando={gravando}
          aoConfirmar={() => void remover()}
        />
      ) : null}
    </div>
  );
}

/* ---------- a confirmação de remover uma pergunta ---------- */

function ConfirmarRemover({
  pergunta,
  nova,
  atual,
  gravando,
  aoCancelar,
  aoConfirmar,
}: {
  pergunta: string;
  nova: number;
  atual: number;
  gravando: boolean;
  aoCancelar(): void;
  aoConfirmar(): void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    focar(cancelar.current);
  }, []);

  const tecla = (ev: KeyboardEvent<HTMLDivElement>) => {
    // o diálogo fica no portal, mas o evento sobe pela árvore do React: não deixa o Esc voltar ao mapa
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      aoCancelar();
      return;
    }
    if (ev.key !== "Tab") return;
    const botoes = Array.from(caixa.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!botoes.length) return;
    const k = botoes.indexOf(document.activeElement as HTMLButtonElement);
    const j = ev.shiftKey ? (k <= 0 ? botoes.length - 1 : k - 1) : (k + 1) % botoes.length;
    ev.preventDefault();
    botoes[j]!.focus();
  };

  const cliqueFora = (ev: MouseEvent<HTMLDivElement>) => {
    if (ev.target === ev.currentTarget) aoCancelar();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={e.veu} data-identidade="aipro" onMouseDown={cliqueFora}>
      <div
        ref={caixa}
        className={e.dlg}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ctx-dlg-tit"
        aria-describedby="ctx-dlg-txt"
        onKeyDown={tecla}
      >
        <h2 id="ctx-dlg-tit" className={e.dlgTit}>
          Remover esta pergunta livre?
        </h2>
        <p id="ctx-dlg-txt" className={e.dlgTexto}>
          A Janete deixa de usar “{pergunta}”. Nasce a versão {nova} sem ela, e a versão {atual} continua no histórico.
        </p>
        <div className={e.dlgAcoes}>
          <Botao ref={cancelar} id="dlg-nao" variante="contorno" onClick={aoCancelar}>
            Cancelar
          </Botao>
          <Botao id="dlg-sim" variante="perigo" disabled={gravando} onClick={aoConfirmar}>
            {gravando ? "Removendo…" : "Remover pergunta"}
          </Botao>
        </div>
      </div>
    </div>,
    document.body,
  );
}
