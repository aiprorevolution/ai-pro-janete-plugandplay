import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowRight, ArrowUp, Pencil } from "lucide-react";

import { AreaTexto, Aviso, Botao } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { medirJanete, movimentoReduzido, rolarAteEMedir, useVooJanete } from "@/components/janete/VooJanete";

import { useDadosOnboarding, type RespostasGravadas } from "@/features/plataforma/dados/onboarding";
import type { Erro } from "@/features/plataforma/dados/tipos";

import type { PropsEtapa } from "../Onboarding";
import { cortarLetras } from "@/features/plataforma/dados/tipos";

import { LIMITE_RESPOSTA_CONTEXTO, lerEstadoOnboarding, useOnboarding, type Respostas } from "../estado";
import { useJaneteNoPalco } from "../palco";
import { ROTEIRO, TOTAL_PERGUNTAS, type CampoContexto } from "../roteiro";
import {
  contarPreenchidas,
  falasDepoisDaResposta,
  proximaPendente,
  retomarConversa,
  type Fala,
  type Mensagem,
} from "./historico";
import { focarDepois, useTemporizadores } from "./temporizadores";
import estilos from "./Conversa.module.css";

const s = estilos as Classes<
  | "pagina"
  | "sr"
  | "grade"
  | "painel"
  | "cab"
  | "avatar"
  | "id"
  | "estado"
  | "contador"
  | "rolo"
  | "lista"
  | "msg"
  | "bolha"
  | "texto"
  | "resumo"
  | "resumoCab"
  | "resumoLista"
  | "resumoLinha"
  | "resumoBotao"
  | "resumoRotulo"
  | "resumoValor"
  | "resumoIcone"
  | "editor"
  | "editorAcoes"
  | "pontos"
  | "base"
  | "montar"
  | "ajuda"
  | "compositor"
  | "entrada"
  | "enviar"
  | "saber"
  | "saberTopo"
  | "saberConta"
  | "barra"
  | "saberUltimo"
  | "meta"
  | "saberUltimoValor"
  | "saberLista"
  | "saberLinha"
  | "passo"
  | "saberRotulo"
  | "saberValor"
  | "saberVazio"
>;

export const ID_AVATAR_CHAT = "chat-avatar";
export const ID_PAINEL_CHAT = "chat-painel";
export const ID_ENTRADA_CHAT = "chat-entrada";
export const ID_BOTAO_MONTAR = "btn-montar";

/** Tempos do F: mira 60 ms, voo até o avatar 860 ms, abertura do chat 660 ms, recolhimento 520 ms. */
export const TEMPOS_CONVERSA = { mira: 60, voo: 860, abre: 660, fecha: 520 } as const;

/** espera: o símbolo voa até o avatar · abrindo: o chat abre dele · fechando: recolhe antes do preparo. */
type FaseChat = "espera" | "abrindo" | "aberto" | "fechando";

const ERRO_VAZIO = "Escreva uma resposta. A Janete precisa dela para atender.";

/**
 * O mesmo limite de `estado.ts` (LIMITE_RESPOSTA) e do banco (contexto_salvar, 2.000 letras por
 * campo, decisão 11): o campo não aceita mais do que o banco guarda.
 */
export const LIMITE_RESPOSTA_CHAT = LIMITE_RESPOSTA_CONTEXTO;

/** O texto de cada recusa do contexto_salvar no "Pode montar". */
export function textoErroMontar(erro: Erro): string {
  switch (erro) {
    case "limite_tamanho":
      return "Uma das respostas passou de 2.000 letras. Encurte e tente de novo.";
    case "contexto_mudou":
      return "Outra pessoa da equipe mudou o Contexto agora há pouco. Recarregue a página para ver o que mudou e monte de novo.";
    case "sem_acesso":
    case "nao_encontrado":
      return "Sua conta não pode montar o Contexto. Só o admin da empresa faz esta etapa.";
    default:
      return "Não conseguimos guardar agora. Confira a sua internet e tente de novo.";
  }
}

/** A linha do resumo (botão) e a caixa de texto que entra no lugar dela ao clicar (decisão 3b). */
export const idLinhaResumo = (campo: CampoContexto) => `resumo-${campo}`;
export const idEditorResumo = (campo: CampoContexto) => `resumo-${campo}-editor`;

/** Posição do avatar dentro do painel: o centro do círculo que abre e fecha o chat. */
function origemNoPainel(): string | null {
  const a = medirJanete(ID_AVATAR_CHAT);
  const painel = typeof document !== "undefined" ? document.getElementById(ID_PAINEL_CHAT) : null;
  if (!a || !painel) return null;
  const r = painel.getBoundingClientRect();
  return `${Math.round(a.x - r.left)}px ${Math.round(a.y - r.top)}px`;
}

export function EtapaConversa({ avancar }: PropsEtapa) {
  const voo = useVooJanete();
  const vooRef = useRef(voo);
  vooRef.current = voo;
  const { estado, responder: gravar, definirRespostas, confirmarContexto } = useOnboarding();
  const dados = useDadosOnboarding();
  const respostas = estado.conversa.respostas;
  // "Pode montar" grava o Contexto no banco antes de a Janete partir (contexto_salvar, origem onboarding)
  const [gravando, setGravando] = useState(false);
  const [erroMontar, setErroMontar] = useState<string | null>(null);
  const t = useTemporizadores();
  useJaneteNoPalco(true);

  const [chat, setChat] = useState<FaseChat>(() => (voo.ativo ? "espera" : "aberto"));
  const [origem, setOrigem] = useState("40px 36px");
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [q, setQ] = useState(0);
  const [falando, setFalando] = useState(false);
  const [digitando, setDigitando] = useState(false);
  const [fim, setFim] = useState(false);
  const [ultimo, setUltimo] = useState<CampoContexto | null>(null);
  const [rascunho, setRascunho] = useState("");
  // edição no chat: a linha do resumo que virou caixa de texto, o texto dela e o erro (campo vazio)
  const [editando, setEditando] = useState<CampoContexto | null>(null);
  const [textoEdicao, setTextoEdicao] = useState("");
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const seq = useRef(0);

  // falar do F: cada fala espera um pouco, mostra "digitando" pelo tamanho do texto e entra.
  const falar = useCallback(
    (lista: Fala[], aoTerminar: () => void) => {
      const k = movimentoReduzido() ? 0.35 : 1;
      setFalando(true);
      let tempo = 0;
      lista.forEach((item, i) => {
        const tamanho = typeof item === "string" ? item.length : 140;
        tempo += Math.round((i === 0 ? 420 : 260) * k);
        t.depois(() => setDigitando(true), tempo);
        tempo += Math.round(Math.min(1500, 420 + tamanho * 13) * k);
        t.depois(() => {
          seq.current += 1;
          const m: Mensagem =
            typeof item === "string"
              ? { id: seq.current, de: "janete", texto: item }
              : { id: seq.current, de: "resumo", texto: "" };
          setDigitando(false);
          setMsgs((atual) => [...atual, m]);
        }, tempo);
      });
      t.depois(() => {
        setFalando(false);
        aoTerminar();
      }, tempo + 40);
    },
    [t],
  );

  // entrarConversa do F: retoma das respostas gravadas (ou abre com a INTRO) e a Janete segue falando.
  const entrarConversa = useCallback(() => {
    const r = retomarConversa(lerEstadoOnboarding().conversa.respostas);
    seq.current = r.mensagens.length;
    setMsgs(r.mensagens);
    setQ(r.q);
    setFim(r.fim);
    setUltimo(r.ultimo);
    if (r.falar.length) falar(r.falar, () => {});
  }, [falar]);

  // voarParaChat do F: o símbolo em trânsito pousa no avatar e o chat abre a partir dele.
  useEffect(() => {
    if (!vooRef.current.ativo) {
      entrarConversa();
      if (movimentoReduzido()) focarDepois(t, ID_ENTRADA_CHAT);
      return;
    }
    const rodada = t.geracao();
    t.depois(() => {
      void (async () => {
        // mede só depois de trazer o avatar para a vista e a rolagem parar (decisão 5b)
        const alvo = await rolarAteEMedir(ID_AVATAR_CHAT);
        if (t.geracao() !== rodada) return;
        if (!alvo) {
          vooRef.current.soltar();
          setChat("aberto");
          entrarConversa();
          return;
        }
        const o = origemNoPainel();
        if (o) setOrigem(o);
        await vooRef.current.voar(alvo, { duracaoMs: TEMPOS_CONVERSA.voo, estado: "acordada" });
        if (t.geracao() !== rodada) return;
        vooRef.current.soltar();
        setChat("abrindo");
        t.depois(() => {
          setChat("aberto");
          entrarConversa();
          focarDepois(t, ID_ENTRADA_CHAT);
        }, TEMPOS_CONVERSA.abre);
      })();
    }, TEMPOS_CONVERSA.mira);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const podeResponder = !falando && !fim && q < TOTAL_PERGUNTAS && chat === "aberto";

  const responder = (texto: string) => {
    const tx = cortarLetras(texto.trim(), LIMITE_RESPOSTA_CHAT);
    const pergunta = ROTEIRO[q];
    if (!tx || !podeResponder || !pergunta) return;
    seq.current += 1;
    const minha: Mensagem = { id: seq.current, de: "eu", texto: tx };
    setMsgs((atual) => [...atual, minha]);
    gravar(pergunta.campo, tx);
    const novas: Respostas = { ...lerEstadoOnboarding().conversa.respostas, [pergunta.campo]: tx };
    const proxima = proximaPendente(novas);
    setRascunho("");
    setUltimo(pergunta.campo);
    setQ(proxima);
    const terminou = proxima >= TOTAL_PERGUNTAS;
    falar(
      falasDepoisDaResposta(q, tx, novas),
      terminou
        ? () => {
            setFim(true);
            focarDepois(t, ID_BOTAO_MONTAR);
          }
        : () => {},
    );
  };

  const teclaChat = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      responder(rascunho);
    }
  };

  // 3b: clicar numa linha do resumo troca a linha por uma caixa de texto, no próprio chat
  const abrirEdicao = (campo: CampoContexto, erro: string | null = null) => {
    if (!fim || chat !== "aberto") return;
    setEditando(campo);
    setTextoEdicao(lerEstadoOnboarding().conversa.respostas[campo] ?? "");
    setErroEdicao(erro);
    focarDepois(t, idEditorResumo(campo), true);
  };

  const fecharEdicao = (campo: CampoContexto) => {
    setEditando(null);
    setErroEdicao(null);
    focarDepois(t, idLinhaResumo(campo));
  };

  const salvarEdicao = () => {
    if (!editando) return;
    const valor = cortarLetras(textoEdicao.trim(), LIMITE_RESPOSTA_CHAT);
    if (!valor) {
      // campo vazio não salva: a caixa continua aberta, com o erro
      setErroEdicao(ERRO_VAZIO);
      return;
    }
    gravar(editando, valor);
    setUltimo(editando);
    fecharEdicao(editando);
  };

  const teclaEdicao = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!editando || ev.nativeEvent.isComposing) return;
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      salvarEdicao();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      fecharEdicao(editando);
    }
  };

  // montar do F: confirma o Contexto, o chat se recolhe no avatar e a Janete parte, carregando, para o preparo.
  const saindo = useRef(false);
  const montar = async () => {
    if (!fim || chat === "fechando" || saindo.current) return;
    let atuais = lerEstadoOnboarding().conversa.respostas;
    if (editando) {
      // uma linha ainda aberta em edição vale como Salvar: o texto digitado não se perde
      const valor = cortarLetras(textoEdicao.trim(), LIMITE_RESPOSTA_CHAT);
      if (!valor) {
        setErroEdicao(ERRO_VAZIO);
        focarDepois(t, idEditorResumo(editando), true);
        return;
      }
      gravar(editando, valor);
      setUltimo(editando);
      atuais = { ...atuais, [editando]: valor };
    }
    const vazios = ROTEIRO.filter((p) => !atuais[p.campo]?.trim()).map((p) => p.campo);
    if (vazios.length) {
      // não deveria acontecer (vazio não salva), mas, se faltar algo, a linha abre no chat com o erro
      abrirEdicao(vazios[0]!, ERRO_VAZIO);
      return;
    }
    saindo.current = true;
    setEditando(null);
    setErroEdicao(null);
    setErroMontar(null);
    const limpas = {} as RespostasGravadas;
    for (const p of ROTEIRO) limpas[p.campo] = atuais[p.campo]!.trim();
    definirRespostas(limpas satisfies Respostas);
    // grava antes de seguir: sem o Contexto no banco, a Janete não teria o que usar
    setGravando(true);
    const r = await dados.salvarContexto(limpas);
    setGravando(false);
    if (!r.ok) {
      saindo.current = false;
      setErroMontar(textoErroMontar(r.erro));
      focarDepois(t, ID_BOTAO_MONTAR);
      return;
    }
    confirmarContexto();
    t.limpar();
    if (movimentoReduzido()) {
      avancar();
      return;
    }
    const rodada = t.geracao();
    // traz o avatar para a vista e espera a rolagem parar antes de medir (decisão 5b)
    await rolarAteEMedir(ID_AVATAR_CHAT);
    if (t.geracao() !== rodada) return;
    const o = origemNoPainel();
    if (o) setOrigem(o);
    setChat("fechando");
    t.depois(() => {
      // mede de novo na hora de pousar: se algo rolou durante o recolhimento, o ponto não fica velho
      const avatar = medirJanete(ID_AVATAR_CHAT);
      if (avatar) vooRef.current.pousar(avatar, "carregando");
      avancar();
    }, TEMPOS_CONVERSA.fecha);
  };

  /* ---------- valores da tela (renderVals do F) ---------- */

  const ultimaMsg = msgs.length ? msgs[msgs.length - 1]!.de : null;
  const preenchidas = contarPreenchidas(respostas);
  const ultimoValor = ultimo ? respostas[ultimo] : "";
  const ultimaPergunta = ultimo ? ROTEIRO.find((p) => p.campo === ultimo) : undefined;
  // Como no WhatsApp: as mensagens seguidas do mesmo autor formam um grupo, e só o primeiro
  // balão do grupo tem a pontinha (data-turno). O resumo conta como fala da Janete.
  let anterior: Mensagem["de"] | null = null;
  const mensagens = msgs.map((m) => {
    const daJanete = m.de !== "eu";
    const novoTurno = anterior === null || (anterior === "eu") !== (m.de === "eu");
    anterior = m.de;
    return { ...m, daJanete, novoTurno };
  });

  return (
    <section className={s.pagina} data-identidade="aipro" data-etapa="conversa" aria-labelledby="t4-titulo">
      <h1 id="t4-titulo" className={s.sr} tabIndex={-1}>
        Conversa com a Janete
      </h1>
      <div className={s.grade}>
        {/* O painel vem antes do chat no DOM: no celular ele fica em cima, e a ordem do Tab segue a
            da tela. No largo, o CSS o põe à direita. */}
        <aside
          className={s.saber}
          aria-labelledby="saber-titulo"
          data-oculto={chat !== "aberto" || undefined}
        >
          {/* Só leitura (decisão 3c): a edição é no chat, nas linhas do resumo. No fim, o painel
              não ganha campos nem botões, então não cresce. */}
          <div className={s.saberTopo}>
            <h2 id="saber-titulo">O que eu já sei</h2>
            <span className={s.saberConta}>
              {preenchidas} de {TOTAL_PERGUNTAS}
            </span>
          </div>
          <div className={s.barra} aria-hidden="true">
            <span style={{ transform: `scaleX(${(preenchidas / TOTAL_PERGUNTAS).toFixed(4)})` }} />
          </div>
          <div className={s.saberUltimo}>
            <span className={s.meta}>
              {ultimoValor && ultimaPergunta ? `Acabei de aprender · ${ultimaPergunta.rotulo}` : "Ainda não aprendi nada"}
            </span>
            <span className={s.saberUltimoValor}>{ultimoValor || "O que você responder aparece aqui."}</span>
          </div>
          <ol id="saber-lista" className={s.saberLista}>
            {ROTEIRO.map((p, i) => {
              const valor = respostas[p.campo] ?? "";
              const cheia = !!valor.trim();
              const atual = !cheia && i === q && !falando && !fim;
              const situacao = cheia ? "cheia" : atual ? "atual" : "vazia";
              return (
                <li
                  key={p.campo}
                  className={s.saberLinha}
                  data-situacao={situacao}
                  data-nova={(cheia && p.campo === ultimo) || undefined}
                >
                  <span className={s.passo} aria-hidden="true">
                    <span>{i + 1}</span>
                    <svg viewBox="0 0 24 24">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <span className={s.saberRotulo}>{p.rotulo}</span>
                  {cheia ? (
                    // a key troca com o valor: a linha pisca de novo quando uma edição no chat a muda
                    <span key={valor} className={s.saberValor}>
                      {valor}
                    </span>
                  ) : (
                    <span className={s.saberVazio}>{atual ? "Perguntando agora…" : "Ainda não sei"}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </aside>

        <div
          id={ID_PAINEL_CHAT}
          className={s.painel}
          data-chat={chat}
          style={{ "--o": origem } as CSSProperties}
        >
          <header className={s.cab} data-fim={fim || undefined}>
            <span id={ID_AVATAR_CHAT} className={s.avatar} data-oculto={chat === "espera" || undefined} aria-hidden="true">
              <JaneteSimbolo decorativo tamanho={40} estado={digitando ? "fala" : "acordada"} digitando={digitando} />
            </span>
            <div className={s.id}>
              <h2>Janete</h2>
              <p className={s.estado} data-ativo={digitando || undefined}>
                {digitando ? "digitando…" : fim ? "pronta para montar" : "online"}
              </p>
            </div>
            <span className={s.contador}>
              {q >= TOTAL_PERGUNTAS ? "Conversa completa" : `Pergunta ${q + 1} de ${TOTAL_PERGUNTAS}`}
            </span>
          </header>

          <div className={s.rolo}>
            <div className={s.lista} role="log" aria-live="polite" aria-label="Conversa com a Janete">
              {mensagens.map((m) => (
                <div key={m.id} className={s.msg} data-de={m.de} data-turno={m.novoTurno || undefined}>
                  {m.de === "resumo" ? (
                    <div className={s.bolha} data-resumo="">
                      <div className={s.resumo}>
                        <p className={s.resumoCab}>Meu jeito de trabalhar</p>
                        <ul className={s.resumoLista}>
                          {ROTEIRO.map((p) => {
                            const valor = respostas[p.campo] || "Ainda não sei";
                            if (editando === p.campo) {
                              return (
                                <li key={p.campo} className={s.resumoLinha} data-editando="">
                                  <div className={s.editor}>
                                    <AreaTexto
                                      id={idEditorResumo(p.campo)}
                                      rotulo={p.rotulo}
                                      linhas={2}
                                      value={textoEdicao}
                                      erro={erroEdicao ?? undefined}
                                      onChange={(ev) => {
                                        setTextoEdicao(cortarLetras(ev.target.value, LIMITE_RESPOSTA_CHAT));
                                        if (erroEdicao && ev.target.value.trim()) setErroEdicao(null);
                                      }}
                                      onKeyDown={teclaEdicao}
                                    />
                                    <div className={s.editorAcoes}>
                                      <Botao variante="discreto" onClick={() => fecharEdicao(p.campo)}>
                                        Cancelar
                                      </Botao>
                                      <Botao onClick={salvarEdicao}>Salvar</Botao>
                                    </div>
                                  </div>
                                </li>
                              );
                            }
                            return (
                              <li key={p.campo} className={s.resumoLinha}>
                                <button
                                  type="button"
                                  id={idLinhaResumo(p.campo)}
                                  className={s.resumoBotao}
                                  disabled={!fim || chat !== "aberto"}
                                  onClick={() => abrirEdicao(p.campo)}
                                >
                                  <span className={s.sr}>Alterar </span>
                                  <span className={s.resumoRotulo}>{p.rotulo}</span>
                                  <span className={s.resumoValor}>{valor}</span>
                                  <Pencil className={s.resumoIcone} size={14} strokeWidth={2} aria-hidden="true" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <p className={`${s.bolha} ${s.texto}`}>
                      <span className={s.sr}>{m.daJanete ? "Janete: " : "Você: "}</span>
                      {m.texto}
                    </p>
                  )}
                </div>
              ))}
              {digitando && (
                <div
                  className={s.msg}
                  data-de="janete"
                  data-turno={ultimaMsg === null || ultimaMsg === "eu" || undefined}
                >
                  <div className={s.bolha} data-digitando="">
                    <span className={s.pontos} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className={s.sr}>A Janete está digitando</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={s.base}>
            {fim ? (
              <div className={s.montar}>
                {erroMontar ? (
                  <Aviso tom="erro" titulo="Não deu para montar" compacto>
                    {erroMontar}
                  </Aviso>
                ) : null}
                <Botao
                  id={ID_BOTAO_MONTAR}
                  tamanho="grande"
                  largo
                  onClick={() => void montar()}
                  disabled={chat === "fechando"}
                  carregando={gravando}
                  iconeDepois={<ArrowRight size={18} strokeWidth={2} />}
                >
                  {gravando ? "Guardando…" : erroMontar ? "Tentar de novo" : "Pode montar"}
                </Botao>
                <p className={s.ajuda}>Dá para ajustar qualquer resposta depois, em Contexto.</p>
              </div>
            ) : (
              <div className={s.compositor}>
                <label htmlFor={ID_ENTRADA_CHAT} className={s.sr}>
                  Sua resposta para a Janete
                </label>
                <input
                  id={ID_ENTRADA_CHAT}
                  className={s.entrada}
                  type="text"
                  value={rascunho}
                  onChange={(ev) => setRascunho(ev.target.value)}
                  onKeyDown={teclaChat}
                  placeholder={falando ? "A Janete está escrevendo…" : "Escreva sua resposta e aperte Enter"}
                  maxLength={LIMITE_RESPOSTA_CHAT}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className={s.enviar}
                  aria-label="Enviar resposta"
                  disabled={!podeResponder || !rascunho.trim()}
                  // O clique ou toque não tira o foco do campo (o teclado do celular continua aberto)...
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    responder(rascunho);
                    // ...e quem chegou ao botão pelo Tab volta ao campo: o botão fica desabilitado.
                    document.getElementById(ID_ENTRADA_CHAT)?.focus({ preventScroll: true });
                  }}
                >
                  <ArrowUp size={20} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </section>
  );
}
