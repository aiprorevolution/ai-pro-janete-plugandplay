import { ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type KeyboardEvent } from "react";

import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { movimentoReduzido } from "@/components/janete/VooJanete";
import { Botao, BotaoIcone, cx } from "@/components/aipro";

import { usePapel } from "../papel";
import { s } from "./ensinar-estilos";
import { useContexto } from "./loja";
import { TEXTO_TETO_ITENS, versaoAtual } from "./regras";
import { CAMPOS, GRUPOS, infoCampo, type Alvo, type ChaveCampo, type ErroContexto } from "./tipos";

// O balão "Ensinar algo novo" do Contexto 6 (.ctx-ens): o admin conta algo solto, a Janete descobre o
// campo pelas palavras (regras.rotear) e põe o texto no rascunho dele. A tela que monta posiciona o
// balão (sobre a peça, no mapa) pelo className e pelo style; aqui fica só o miolo e a ponta.

export interface PropsEnsinar {
  aberto: boolean;
  aoFechar(): void;
  /** O campo (ou o item novo) que recebeu o texto: a tela usa para o raio pela curva e o foco. */
  aoDescobrir(alvo: Alvo): void;
  /** O "Abrir <Campo>" do resultado leva à seção daquele alvo. */
  aoAbrirAlvo(alvo: Alvo): void;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** A ponta do balão, virada para a peça (no celular, a tela tira). */
  ponta?: boolean | undefined;
  /** O tempo do "Lendo e procurando o campo certo…" (padrão 950 ms; 0 com movimento reduzido). */
  pensarMs?: number | undefined;
  /** O id de quem recebe o foco ao fechar; sem ele, volta para quem estava focado ao abrir. */
  devolverFocoPara?: string | undefined;
}

type Fase = "livre" | "pensando" | "feito" | "pergunta" | "escolher" | "ocupado" | "teto";

/** A pergunta livre nova ainda não salva: o "Ensinar" não a troca por outra (erro "ocupado" da loja). */
const TEXTO_OCUPADO = "Você já tem uma pergunta nova sem salvar. Abra, salve ou descarte antes.";

/** Foca um elemento por id, se existir, sem rolar a página. */
function focarId(id: string): void {
  document.getElementById(id)?.focus({ preventScroll: true });
}

export function Ensinar(props: PropsEnsinar) {
  const { papel } = usePapel();
  // só o admin ensina; o atendente nunca vê o balão
  if (!props.aberto || papel !== "admin") return null;
  return <Balao {...props} />;
}

function Balao({ aoFechar, aoDescobrir, aoAbrirAlvo, className, style, ponta = true, pensarMs, devolverFocoPara }: PropsEnsinar) {
  const { estado, acoes } = useContexto();
  const [texto, setTexto] = useState("");
  const [fase, setFase] = useState<Fase>("livre");
  const [msg, setMsg] = useState("");
  const [destino, setDestino] = useState<ChaveCampo | null>(null);
  const [aviso, setAviso] = useState("");
  // o que o leitor de tela ouve: uma região viva que já existe desde a abertura do balão
  const [falado, setFalado] = useState("");
  // quem abriu o balão (o botão do cabeçalho ou a peça): recebe o foco de volta ao fechar
  const [quemAbriu] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vendo = estado.vendo;
  const atual = versaoAtual(estado).numero;

  // ao abrir, o foco vai para a caixa (ou para o X, numa versão antiga)
  const primeiroFoco = useRef(vendo === null ? "ens-in" : "ens-fechar");
  useEffect(() => {
    const t = setTimeout(() => focarId(primeiroFoco.current), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const fechar = () => {
    const alvo = devolverFocoPara ? document.getElementById(devolverFocoPara) : quemAbriu;
    if (alvo?.isConnected) alvo.focus({ preventScroll: true });
    aoFechar();
  };

  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    fechar();
  };

  /** O texto foi para um campo ou virou pergunta livre nova: mostra o resultado e avisa a tela. */
  const concluir = (alvo: ChaveCampo | "livre") => {
    if (alvo === "livre") {
      setDestino(null);
      setFase("pergunta");
      setFalado("Virou uma pergunta livre nova. Escreva a resposta e salve.");
      aoDescobrir("livre-novo");
    } else {
      setDestino(alvo);
      setFase("feito");
      setFalado(`Coloquei em ${infoCampo(alvo).rotulo}. Falta salvar.`);
      aoDescobrir(alvo);
    }
    setTimeout(() => focarId("ens-abrir"), 0);
  };

  const recusado = (erro: ErroContexto) => {
    // já são 50 perguntas livres: a frase não vira a 51ª, e o balão diz por quê
    if (erro === "limite_itens") {
      setDestino(null);
      setFase("teto");
      setFalado(TEXTO_TETO_ITENS);
      setTimeout(() => focarId("ens-outra"), 0);
      return;
    }
    if (erro === "ocupado") {
      setDestino(null);
      setFase("ocupado");
      setFalado(TEXTO_OCUPADO);
      setTimeout(() => focarId("ens-abrir"), 0);
      return;
    }
    const t = erro === "versao_antiga" ? "Volte para a versão atual para ensinar algo novo." : "Não deu para guardar isso agora.";
    setFase("livre");
    setAviso(t);
    setFalado(t);
  };

  const descobrir = (t: string) => {
    timer.current = null;
    const r = acoes.ensinar(t);
    if (!r.ok) return recusado(r.erro);
    if (r.alvo === null) {
      setFase("escolher");
      setFalado("Não tenho certeza de onde isso entra. Em qual campo eu guardo?");
      setTimeout(() => focarId("ens-op-0"), 0);
      return;
    }
    concluir(r.alvo);
  };

  const enviar = () => {
    const t = texto.trim();
    if (!t || fase === "pensando") return;
    setMsg(t);
    setTexto("");
    setAviso("");
    const espera = pensarMs ?? (movimentoReduzido() ? 0 : 950);
    if (espera <= 0) {
      descobrir(t);
      return;
    }
    setFase("pensando");
    setFalado("Lendo e procurando o campo certo…");
    timer.current = setTimeout(() => descobrir(t), espera);
  };

  const escolher = (dest: ChaveCampo | "livre") => {
    const r = acoes.ensinarEm(dest, msg);
    if (!r.ok) return recusado(r.erro);
    concluir(dest);
  };

  const outra = () => {
    // do teto, a frase que não coube volta para a caixa: quem apagar uma pergunta não a escreve de novo
    if (fase === "teto") setTexto(msg);
    setFase("livre");
    setMsg("");
    setDestino(null);
    setFalado("");
    setTimeout(() => focarId("ens-in"), 0);
  };

  const mudar = (ev: ChangeEvent<HTMLTextAreaElement>) => {
    setTexto(ev.target.value);
    // a caixa cresce com o texto, até o máximo do CSS
    const el = ev.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const teclaCaixa = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      enviar();
    }
  };

  const rotulo = destino ? infoCampo(destino).rotulo : "";
  const grupo = destino ? (GRUPOS.find((g) => g.id === infoCampo(destino).grupo)?.nome ?? "") : "";

  return (
    <section
      id="ctx-ens"
      className={cx(s.ens, !ponta && s.semPonta, className)}
      style={style}
      role="dialog"
      aria-modal="false"
      aria-labelledby="ctx-ens-tit"
      data-fase={fase}
      onKeyDown={tecla}
    >
      <div className={s.miolo}>
        <header className={s.cab}>
          <h2 id="ctx-ens-tit" className={s.titulo}>
            {vendo === null ? "Ensinar algo novo" : "Versão antiga"}
          </h2>
          <BotaoIcone id="ens-fechar" rotulo="Fechar (Esc)" variante="suave" semDica icone={<X size={20} />} onClick={fechar} />
        </header>

        {vendo !== null ? (
          <>
            <p className={s.apoio}>
              Você está vendo a versão {vendo}, só leitura. A Janete continua atendendo com a versão {atual}. Para ensinar algo novo,
              volte para a atual.
            </p>
            <div className={s.acoes}>
              <Botao variante="contorno" onClick={() => acoes.voltarParaAtual()}>
                Voltar para a atual
              </Botao>
            </div>
          </>
        ) : (
          <>
            {fase === "livre" && (
              <>
                <p className={s.apoio}>Conte algo solto sobre a empresa. Eu descubro em qual campo entra e levo até lá.</p>
                <div className={s.caixa}>
                  <label htmlFor="ens-in" className={s.sr}>
                    O que a Janete precisa saber
                  </label>
                  <textarea
                    id="ens-in"
                    className={s.entrada}
                    rows={1}
                    value={texto}
                    onChange={mudar}
                    onKeyDown={teclaCaixa}
                    placeholder="Ex.: Abrimos aos sábados"
                  />
                  <button type="button" className={s.enviar} aria-label="Mandar para a Janete" disabled={!texto.trim()} onClick={enviar}>
                    <ArrowUp size={20} aria-hidden="true" />
                  </button>
                </div>
                {aviso && <p className={s.aviso}>{aviso}</p>}
              </>
            )}

            {fase !== "livre" && msg && (
              <p className={s.eu}>
                <span className={s.sr}>Você: </span>
                {msg}
              </p>
            )}

            {fase === "pensando" && (
              <p className={s.janeteDiz}>
                <JaneteSimbolo estado="fala" digitando tamanho={20} decorativo />
                <span>Lendo e procurando o campo certo…</span>
              </p>
            )}

            {fase === "feito" && destino && (
              <>
                <p className={s.janeteDiz}>
                  <JaneteSimbolo tamanho={20} decorativo />
                  <span>
                    Coloquei em {rotulo}. Falta salvar.
                    <span className={s.janeteMais}> Fica em {grupo}, marcado como não salvo, até você conferir.</span>
                  </span>
                </p>
                <div className={s.acoes}>
                  <Botao id="ens-abrir" onClick={() => aoAbrirAlvo(destino)}>
                    Abrir {rotulo}
                  </Botao>
                  <Botao variante="discreto" onClick={outra}>
                    Ensinar outra coisa
                  </Botao>
                </div>
              </>
            )}

            {(fase === "pergunta" || fase === "ocupado") && (
              <>
                <p className={s.janeteDiz}>
                  <JaneteSimbolo tamanho={20} decorativo />
                  <span>{fase === "ocupado" ? TEXTO_OCUPADO : "Virou uma pergunta livre nova. Escreva a resposta e salve."}</span>
                </p>
                <div className={s.acoes}>
                  <Botao id="ens-abrir" onClick={() => aoAbrirAlvo("livre-novo")}>
                    Abrir a pergunta nova
                  </Botao>
                  <Botao variante="discreto" onClick={outra}>
                    Ensinar outra coisa
                  </Botao>
                </div>
              </>
            )}

            {fase === "teto" && (
              <>
                <p className={s.janeteDiz}>
                  <JaneteSimbolo tamanho={20} decorativo />
                  <span>{TEXTO_TETO_ITENS}</span>
                </p>
                <div className={s.acoes}>
                  <Botao id="ens-outra" variante="discreto" onClick={outra}>
                    Ensinar outra coisa
                  </Botao>
                </div>
              </>
            )}

            {fase === "escolher" && (
              <>
                <p className={s.janeteDiz}>
                  <JaneteSimbolo tamanho={20} decorativo />
                  <span>Não tenho certeza de onde isso entra. Em qual campo eu guardo?</span>
                </p>
                <div className={s.chips} role="group" aria-label="Escolher o campo">
                  {CAMPOS.map((c, k) => (
                    <button key={c.chave} type="button" id={`ens-op-${k}`} className={s.chip} data-opcao={c.chave} onClick={() => escolher(c.chave)}>
                      {c.rotulo}
                    </button>
                  ))}
                  <button type="button" id={`ens-op-${CAMPOS.length}`} className={s.chip} data-opcao="livre" onClick={() => escolher("livre")}>
                    Pergunta livre
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <p className={s.sr} aria-live="polite">
        {falado}
      </p>
    </section>
  );
}
