import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Aviso, Botao, BotaoIcone, cx } from "@/components/aipro";

import type { Instante } from "../comum/tempo";
import { Carregando, ErroLeitura, Vazio } from "../dados/estados";
import { usePapel } from "../papel";
import { s } from "./historico-estilos";
import { useContexto } from "./loja";
import { quando, versaoAtual, versaoPorId } from "./regras";
import type { ErroContexto, VersaoContexto } from "./tipos";

/** O texto de um restauro recusado. */
function textoDoErroRestaurar(erro: ErroContexto): string {
  switch (erro) {
    case "sem_permissao":
      return "Só o admin pode restaurar uma versão.";
    case "nao_encontrado":
      return "Essa versão não existe mais.";
    default:
      return "Não deu para restaurar agora. Verifique a internet e tente de novo.";
  }
}

// O histórico de versões do Contexto 6: a gaveta à direita (.ctx-gaveta), a faixa da versão antiga
// (.vendo) e a confirmação de restaurar (.dlg). A gaveta e o véu vão para o <body> por portal: a vista
// anima transform, e um `fixed` dentro dela ficaria preso à vista.

/** "Edição", "Onboarding" ou "Restauração da versão 3". */
export function origemDaVersao(v: VersaoContexto): string {
  if (v.origem === "onboarding") return "Onboarding";
  if (v.origem === "restauracao") return v.restauradaDe ? `Restauração da versão ${v.restauradaDe}` : "Restauração";
  return "Edição";
}

function focarId(id: string, depois = 0): void {
  setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }), depois);
}

/** O elemento focado agora (para devolver o foco ao fechar). */
function focadoAgora(): HTMLElement | null {
  return typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

/* ---------- a gaveta ---------- */

export interface PropsHistorico {
  aberto: boolean;
  aoFechar(): void;
  /** O relógio para "Hoje, 18:20" (os testes fixam; padrão: agora). */
  agora?: Instante | undefined;
  /** Uma versão nova nasceu da restauração (a tela mostra o aviso "Versão 7 salva…"). */
  aoRestaurar?: ((versao: number, de: number) => void) | undefined;
  className?: string | undefined;
}

export function Historico(props: PropsHistorico) {
  if (!props.aberto || typeof document === "undefined") return null;
  return createPortal(
    // fora do [data-identidade] da página: o contêiner leva a identidade para herdar a fonte e os tokens
    <div data-identidade="aipro">
      <Gaveta {...props} />
    </div>,
    document.body,
  );
}

function Gaveta({ aoFechar, agora, aoRestaurar, className }: PropsHistorico) {
  const { estado, acoes, leitura } = useContexto();
  const { papel } = usePapel();
  const admin = papel === "admin";
  const [quemAbriu] = useState(focadoAgora);
  const [pedido, setPedido] = useState<{ id: number; n: number; volta: string } | null>(null);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const atual = versaoAtual(estado);
  const vendo = estado.vendo;
  const relogio = agora ?? Date.now();
  const hist = leitura.historico;

  useEffect(() => {
    focarId("gav-tit");
  }, []);

  const devolverFoco = () => {
    if (quemAbriu?.isConnected) quemAbriu.focus({ preventScroll: true });
  };

  const fechar = () => {
    devolverFoco();
    aoFechar();
  };

  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    fechar();
  };

  const ver = (id: number) => {
    const r = acoes.verVersao(id);
    if (!r.ok) return;
    aoFechar();
    // vendo a antiga, o foco vai para o título da faixa; de volta à atual, para quem abriu
    if (id === atual.id) devolverFoco();
    else focarId("vendo-tit", 60);
  };

  const confirmar = async () => {
    if (!pedido || gravando) return;
    const { id, n: de, volta } = pedido;
    setGravando(true);
    const r = await acoes.restaurar(id);
    setGravando(false);
    setPedido(null);
    if (!r.ok) {
      setErro(textoDoErroRestaurar(r.erro));
      focarId(volta);
      return;
    }
    setErro(null);
    if (r.versao !== undefined) aoRestaurar?.(r.versao, de);
    devolverFoco();
    aoFechar();
  };

  let lista: ReactNode;
  if (hist.carregando) lista = <Carregando forma="texto" quantos={4} rotulo="Carregando o histórico" />;
  else if (hist.erro) lista = <ErroLeitura compacto erro={hist.erro} tentarDeNovo={hist.tentarDeNovo} titulo="Não deu para carregar o histórico" />;
  else if (!estado.versoes.length)
    lista = (
      <Vazio
        compacto
        nivelTitulo={3}
        oQueFalta="Nenhuma versão ainda"
        porQueImporta={admin ? "O 1º salvamento cria a versão 1." : "Quando o admin salvar o Contexto, a versão 1 aparece aqui."}
        acao={null}
      />
    );
  else lista = null;

  return (
    <>
      <aside id="ctx-gaveta" className={cx(s.gaveta, className)} role="dialog" aria-modal="false" aria-labelledby="gav-tit" onKeyDown={tecla}>
        <header className={s.cab}>
          <div>
            <h2 id="gav-tit" className={s.titulo} tabIndex={-1}>
              Histórico de versões
            </h2>
            <p className={s.sub}>Cada alteração salva cria uma nova versão.</p>
          </div>
          <BotaoIcone id="gav-fechar" rotulo="Fechar o histórico (Esc)" variante="suave" semDica icone={<X size={20} />} onClick={fechar} />
        </header>
        <div className={s.rolo}>
          {erro ? (
            <Aviso tom="erro" compacto aoFechar={() => setErro(null)}>
              {erro}
            </Aviso>
          ) : null}
          {lista}
          <ol className={s.versoes} hidden={lista !== null}>
            {(lista === null ? estado.versoes : []).map((v) => {
              const emUso = v.id === atual.id;
              const naTela = vendo === null ? emUso : vendo === v.id;
              const data = quando(v.criadoEm, relogio);
              return (
                <li
                  key={v.id}
                  className={cx(s.ver, emUso && s.uso, v.origem === "restauracao" && s.restauracao, naTela && s.naTela)}
                  data-versao={v.numero}
                  aria-current={naTela || undefined}
                >
                  <span className={s.ponto} aria-hidden="true" />
                  <p className={s.n}>
                    <span>Versão {v.numero}</span>
                    {emUso && <span className={s.pilulaUso}>Em uso</span>}
                    {vendo !== null && vendo === v.id && <span className={s.pilulaVendo}>Na tela</span>}
                  </p>
                  <p className={s.meta}>
                    {data} · {origemDaVersao(v)} · {v.quem}
                  </p>
                  <p className={s.resumo}>{v.resumo}</p>
                  {(!naTela || (admin && !emUso)) && (
                    <div className={s.acoes}>
                      {!naTela && (
                        <Botao
                          id={`ver-${v.numero}`}
                          variante="contorno"
                          tamanho="compacto"
                          aria-label={emUso ? `Voltar para a versão ${v.numero}, a atual` : `Ver a versão ${v.numero}, de ${data}`}
                          onClick={() => ver(v.id)}
                        >
                          {emUso ? "Voltar para a atual" : "Ver esta versão"}
                        </Botao>
                      )}
                      {admin && !emUso && (
                        <Botao
                          id={`restaurar-${v.numero}`}
                          variante="discreto"
                          tamanho="compacto"
                          aria-label={`Restaurar a versão ${v.numero}`}
                          onClick={() => setPedido({ id: v.id, n: v.numero, volta: `restaurar-${v.numero}` })}
                        >
                          Restaurar
                        </Botao>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {lista === null && hist.temMaisAntigas ? (
            <div className={s.acoes}>
              <Botao
                id="gav-mais"
                variante="contorno"
                tamanho="compacto"
                disabled={hist.carregandoMaisAntigas}
                onClick={hist.carregarMaisAntigas}
              >
                {hist.carregandoMaisAntigas ? "Carregando…" : "Ver mais antigas"}
              </Botao>
            </div>
          ) : null}
        </div>
      </aside>
      {pedido && (
        <ConfirmarRestauro
          id={pedido.id}
          n={pedido.n}
          gravando={gravando}
          agora={relogio}
          aoCancelar={() => {
            setPedido(null);
            focarId(pedido.volta);
          }}
          aoConfirmar={confirmar}
        />
      )}
    </>
  );
}

/* ---------- a faixa da versão antiga ---------- */

export interface PropsFaixaVersaoAntiga {
  agora?: Instante | undefined;
  aoRestaurar?: ((versao: number, de: number) => void) | undefined;
  /** Para onde vai o foco ao voltar para a atual ou restaurar (padrão: o "Ver histórico"). */
  devolverFocoPara?: string | undefined;
  className?: string | undefined;
}

export function FaixaVersaoAntiga({ agora, aoRestaurar, devolverFocoPara = "ctx-historico-btn", className }: PropsFaixaVersaoAntiga = {}) {
  const { estado, acoes } = useContexto();
  const { papel } = usePapel();
  const [pedindo, setPedindo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const atual = versaoAtual(estado);
  const v = estado.vendo === null ? undefined : versaoPorId(estado, estado.vendo);
  if (!v) return null;
  const relogio = agora ?? Date.now();
  const data = quando(v.criadoEm, relogio);

  const voltar = () => {
    acoes.voltarParaAtual();
    focarId(devolverFocoPara, 30);
  };

  const confirmar = async () => {
    if (gravando) return;
    setGravando(true);
    const r = await acoes.restaurar(v.id);
    setGravando(false);
    setPedindo(false);
    if (!r.ok) {
      setErro(textoDoErroRestaurar(r.erro));
      focarId("btn-restaurar");
      return;
    }
    setErro(null);
    if (r.versao !== undefined) aoRestaurar?.(r.versao, v.numero);
    focarId(devolverFocoPara, 30);
  };

  return (
    <div className={cx(s.faixa, className)} role="region" aria-label="Versão antiga" data-vendo={v.numero}>
      <span className={s.faixaIc} aria-hidden="true">
        <History size={18} />
      </span>
      <div className={s.faixaTxt}>
        <b id="vendo-tit" tabIndex={-1}>
          Você está vendo a versão {v.numero}, de {data}
        </b>
        <span>
          {origemDaVersao(v)}, por {v.quem}. {v.resumo}
        </span>
        <span>Só leitura. A Janete continua usando a versão {atual.numero}.</span>
        {erro ? <span role="alert">{erro}</span> : null}
      </div>
      <div className={s.faixaAcoes}>
        <Botao variante="contorno" tamanho="compacto" onClick={voltar}>
          Voltar para a atual
        </Botao>
        {papel === "admin" && (
          <Botao id="btn-restaurar" tamanho="compacto" icone={<RotateCcw size={16} />} onClick={() => setPedindo(true)}>
            Restaurar esta versão
          </Botao>
        )}
      </div>
      {pedindo && (
        <ConfirmarRestauro
          id={v.id}
          n={v.numero}
          gravando={gravando}
          agora={relogio}
          aoCancelar={() => {
            setPedindo(false);
            focarId("btn-restaurar");
          }}
          aoConfirmar={confirmar}
        />
      )}
    </div>
  );
}

/* ---------- a confirmação ---------- */

/** "Restaurar a versão N?": o foco fica preso entre Cancelar e Restaurar; Esc e o véu cancelam. */
function ConfirmarRestauro({
  id,
  n,
  gravando,
  agora,
  aoCancelar,
  aoConfirmar,
}: {
  id: number;
  n: number;
  gravando: boolean;
  agora: Instante;
  aoCancelar(): void;
  aoConfirmar(): void;
}) {
  const { estado } = useContexto();
  const caixa = useRef<HTMLElement>(null);
  const atual = versaoAtual(estado);
  const alvo = versaoPorId(estado, id);
  const temRascunho = Object.values(estado.rascunhos).some(Boolean);

  useEffect(() => {
    focarId("dlg-nao", 30);
  }, []);

  if (typeof document === "undefined") return null;

  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    // a confirmação mora dentro da gaveta (ou da faixa) na árvore do React: o Esc para aqui
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      aoCancelar();
      return;
    }
    if (ev.key !== "Tab" || !caixa.current) return;
    const bts = caixa.current.querySelectorAll<HTMLButtonElement>("button");
    const primeiro = bts[0];
    const ultimo = bts[bts.length - 1];
    if (!primeiro || !ultimo) return;
    if (ev.shiftKey && document.activeElement === primeiro) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  };

  return createPortal(
    <div className={s.veu} data-identidade="aipro" onClick={aoCancelar}>
      <section
        ref={caixa}
        className={s.dlg}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-tit"
        aria-describedby="dlg-txt"
        onKeyDown={tecla}
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="dlg-tit" className={s.dlgTit}>
          Restaurar a versão {n}?
        </h2>
        <p id="dlg-txt" className={s.dlgTxt}>
          A Janete passa a usar o Contexto de {alvo ? quando(alvo.criadoEm, agora) : ""}. Nada se perde: nasce a versão {atual.numero + 1}, igual à{" "}
          {n}, e a versão {atual.numero} continua no histórico.
          {temRascunho ? " As mudanças ainda não salvas serão descartadas." : ""}
        </p>
        <div className={s.dlgAcoes}>
          <Botao id="dlg-nao" variante="contorno" onClick={aoCancelar}>
            Cancelar
          </Botao>
          <Botao id="dlg-sim" disabled={gravando} onClick={aoConfirmar}>
            {gravando ? "Restaurando…" : `Restaurar versão ${n}`}
          </Botao>
        </div>
      </section>
    </div>,
    document.body,
  );
}
