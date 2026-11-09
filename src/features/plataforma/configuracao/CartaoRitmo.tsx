import { Botao, cx } from "@/components/aipro";
import { s as lista } from "@/features/onboarding/lista";
import { IC } from "@/features/onboarding/lista/dados";

import { LIMITES_RITMO } from "../exemplo";
import { c } from "./estilos";
import { ICX, Ic, LinhaEstado } from "./pecas";

export interface Ritmo {
  espera: number;
  teto: number;
}

/** O passo de cada ajuste: a espera anda de 1 em 1 s, o teto de 5 em 5 s. */
export const PASSO_RITMO = { espera: 1, teto: 5 } as const;

/** Muda o rascunho dentro dos limites (o teto fica sempre 5 s acima da espera). */
export function mudarRitmo(r: Ritmo, campo: keyof Ritmo, delta: number): Ritmo {
  const { espera: E, teto: T, folga } = LIMITES_RITMO;
  if (campo === "espera") return { ...r, espera: Math.max(E.min, Math.min(Math.min(E.max, r.teto - folga), r.espera + delta)) };
  return { ...r, teto: Math.max(Math.max(T.min, r.espera + folga), Math.min(T.max, r.teto + delta)) };
}

/** O símbolo da Janete pequeno e parado (o da linha do tempo e da legenda). */
function JanetePequena({ tamanho }: { tamanho: number }) {
  return (
    <img width={tamanho} height={tamanho} src="/brand/aipro-icone.png" alt="" aria-hidden="true" style={{ display: "block", flex: "none", borderRadius: "22%" }} />
  );
}

/**
 * A linha do tempo do "Ver como funciona": o lead manda 3 mensagens em 5 s e a Janete responde
 * depois da espera (ou no teto). Eixo quebrado: os primeiros segundos em escala real, um corte
 * "…" e o teto no fim.
 */
function LinhaDoTempo({ r }: { r: Ritmo }) {
  const ultimo = 5;
  const resp = Math.min(ultimo + r.espera, r.teto);
  const L = Math.max(16, resp + 3);
  const ESCALA = 80;
  const corte = resp < r.teto && r.teto > L + 6;
  const pct = (x: number) =>
    corte ? (x >= r.teto ? 100 : Math.min(ESCALA, (x / L) * ESCALA)) : Math.max(0, Math.min(100, (x / r.teto) * 100));
  const f2 = (n: number) => n.toFixed(2);
  const pIni = pct(ultimo);
  const pResp = pct(resp);
  const legenda = `Exemplo: o lead manda 3 mensagens em 5 s. A Janete responde ${
    resp < r.teto ? `${resp} s depois da primeira.` : `no limite de ${r.teto} s.`
  }`;
  return (
    <figure className={c.cfTempo} id="cfg-tempo">
      <figcaption className={c.cfApoio}>{legenda}</figcaption>
      <div className={c.cfTempoTrilho} aria-hidden="true">
        <span className={c.cfTempoBase} />
        <span className={c.cfTgTeto} style={{ left: "100%" }} />
        {corte && (
          <span className={c.cfTgCorte} style={{ left: `${f2((ESCALA + 100) / 2)}%` }}>
            …
          </span>
        )}
        {[0, 3, 5].map((x) => (
          <span key={x} className={c.cfTgLead} style={{ left: `${f2(pct(x))}%` }} />
        ))}
        <span className={c.cfTgCapa} style={{ transform: `translateX(${f2(pIni)}%)` }}>
          <span className={c.cfTgEspLinha} style={{ transform: `scaleX(${((pResp - pIni) / 100).toFixed(4)})` }} />
          <span className={c.cfTgEspPe} />
          <span className={c.cfTgCapa} style={{ transform: `translateX(${f2(pResp - pIni)}%)` }}>
            <span className={c.cfTgEspPe} />
          </span>
          <span className={c.cfTgCapa} style={{ transform: `translateX(${f2((pResp - pIni) / 2)}%)` }}>
            <b className={c.cfTgEspRot}>{resp - ultimo} s</b>
          </span>
        </span>
        <span className={c.cfTgCapa} style={{ transform: `translateX(${f2(pResp)}%)` }}>
          <span className={c.cfTgJanete}>
            <JanetePequena tamanho={22} />
          </span>
        </span>
      </div>
      <div className={c.cfTempoEscala} aria-hidden="true">
        <span className={c.cfEIni}>0 s</span>
        <span className={c.cfEMeio} style={{ left: `${corte ? ESCALA : 50}%` }}>
          {corte ? `${L} s` : `${Math.round(r.teto / 2)} s`}
        </span>
        <span className={c.cfEFim}>{r.teto} s</span>
      </div>
      <div className={c.cfTempoLegenda} aria-hidden="true">
        <span>
          <i className={c.cfLgLead} />
          Mensagem do lead
        </span>
        <span>
          <JanetePequena tamanho={12} />
          Resposta da Janete
        </span>
        <span>
          <i className={c.cfLgTeto} />
          Tempo máximo
        </span>
      </div>
    </figure>
  );
}

interface Props {
  admin: boolean;
  salvo: Ritmo;
  rascunho: Ritmo;
  salvando: boolean;
  aoMudar: (campo: keyof Ritmo, delta: number) => void;
  aoDesfazer: () => void;
  aoSalvar: () => void;
  verTempo: boolean;
  aoAlternarTempo: () => void;
  realce: "flash" | "nasce" | null;
  oculto: boolean;
  /** A Janete está atendendo (a Saúde): sem isso, o estado sai do verde. */
  saudavel?: boolean | undefined;
  /** Só o atraso do motor (a Janete segue respondendo, com demora): "Atrasada agora", antes do `saudavel`. */
  atrasada?: boolean | undefined;
}

/**
 * 4 · Atendimento (o ritmo): 24 horas, todos os dias. A espera depois da última mensagem e o tempo
 * máximo, explicados em linguagem simples; o admin ajusta e salva, a atendente só vê.
 */
export function CartaoRitmo(props: Props) {
  const { admin, salvo, rascunho, salvando, realce, oculto } = props;
  const r = admin ? rascunho : salvo;
  const mudou = admin && (rascunho.espera !== salvo.espera || rascunho.teto !== salvo.teto);
  const { espera: E, teto: T, folga } = LIMITES_RITMO;
  const regs = [
    {
      campo: "espera" as const,
      rotulo: "Espera depois da última mensagem",
      valor: r.espera,
      ajuda: "Se o lead mandar outra mensagem nesse tempo, a Janete espera de novo.",
      noMinimo: salvando || r.espera <= E.min,
      noMaximo: salvando || r.espera >= Math.min(E.max, r.teto - folga),
      menosAria: "Esperar 1 segundo a menos",
      maisAria: "Esperar 1 segundo a mais",
    },
    {
      campo: "teto" as const,
      rotulo: "Tempo máximo de espera",
      valor: r.teto,
      ajuda: "Contado da primeira mensagem. Passou disso, ela responde mesmo que o lead continue escrevendo.",
      noMinimo: salvando || r.teto <= Math.max(T.min, r.espera + folga),
      noMaximo: salvando || r.teto >= T.max,
      menosAria: "Diminuir o tempo máximo em 5 segundos",
      maisAria: "Aumentar o tempo máximo em 5 segundos",
    },
  ];

  return (
    <section
      id="cfg-card-ritmo"
      className={cx(c.cfCartao, c.cfBlk, oculto && c.cfOculto)}
      data-realce={realce ?? undefined}
      aria-labelledby="cfg-m-ritmo cfg-h-ritmo"
    >
      <header className={c.cfBlkCab}>
        <span className={lista.linhaIcone} aria-hidden="true">
          <Ic d={ICX.relogio} tamanho="g" />
        </span>
        <div className={c.cfBlkTitulo}>
          <p className={c.cfMeta} id="cfg-m-ritmo">
            Atendimento
          </p>
          <h2 id="cfg-h-ritmo" tabIndex={-1} className={c.cfBlkH}>
            24 horas, todos os dias
          </h2>
        </div>
        {/* o verde depende da Saúde (decisão 10d): com a Janete parada, o "24 horas" não está valendo */}
        {props.atrasada ? (
          <LinhaEstado tom="atencao" icone={IC.triangulo}>
            Atrasada agora
          </LinhaEstado>
        ) : props.saudavel === false ? (
          <LinhaEstado tom="atencao" icone={IC.triangulo}>
            Parada agora
          </LinhaEstado>
        ) : (
          <LinhaEstado tom="ok" icone={IC.ok}>
            Sempre ligada
          </LinhaEstado>
        )}
      </header>
      <p className={c.cfApoio}>
        A Janete junta as mensagens que o lead manda em sequência e responde tudo de uma vez, como uma pessoa faria.
      </p>
      <div className={c.cfRegs}>
        {regs.map((g) => (
          <div key={g.campo} className={c.cfReg} role="group" aria-labelledby={`cfg-rot-${g.campo}`}>
            <p className={c.cfCampoRotulo} id={`cfg-rot-${g.campo}`}>
              {g.rotulo}
            </p>
            {/* aria-disabled, não disabled: no limite o botão continua focado (o foco não cai no body) */}
            <div className={c.cfRegLinha}>
              {admin && (
                <button
                  type="button"
                  className={c.cfBtnIcone}
                  aria-disabled={g.noMinimo || undefined}
                  aria-label={g.menosAria}
                  onClick={() => {
                    if (g.noMinimo) return;
                    props.aoMudar(g.campo, -PASSO_RITMO[g.campo]);
                  }}
                >
                  <Ic d={ICX.menos} tamanho="g" />
                </button>
              )}
              <p className={c.cfRegValor} aria-live="polite" data-testid={`cfg-valor-${g.campo}`}>
                <span className={c.cfRegNum}>{g.valor}</span>
                <span className={c.cfRegUn}>s</span>
              </p>
              {admin && (
                <button
                  type="button"
                  className={c.cfBtnIcone}
                  aria-disabled={g.noMaximo || undefined}
                  aria-label={g.maisAria}
                  onClick={() => {
                    if (g.noMaximo) return;
                    props.aoMudar(g.campo, PASSO_RITMO[g.campo]);
                  }}
                >
                  <Ic d={ICX.mais} tamanho="g" />
                </button>
              )}
            </div>
            <p className={c.cfAjuda}>{g.ajuda}</p>
          </div>
        ))}
      </div>
      <div className={c.cfAbre}>
        <button
          type="button"
          className={c.cfAbreBotao}
          aria-expanded={props.verTempo}
          aria-controls="cfg-tempo"
          onClick={props.aoAlternarTempo}
        >
          <Ic d={IC.chevronDireita} tamanho="p" />
          <span>{props.verTempo ? "Esconder o exemplo" : "Ver como funciona"}</span>
        </button>
        {props.verTempo && <LinhaDoTempo r={r} />}
      </div>
      {mudou && (
        <div className={c.cfBlkPe}>
          <p className={c.cfMeta}>Mudanças ainda não salvas</p>
          <div className={c.cfDir}>
            <Botao variante="discreto" disabled={salvando} onClick={props.aoDesfazer}>
              Desfazer
            </Botao>
            <Botao carregando={salvando} onClick={props.aoSalvar}>
              Salvar o ritmo
            </Botao>
          </div>
        </div>
      )}
    </section>
  );
}
