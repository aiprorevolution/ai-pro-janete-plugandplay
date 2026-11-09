import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

import { Botao } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { medirJanete, movimentoReduzido, rolarAteEMedir, useVooJanete } from "@/components/janete/VooJanete";

import type { PropsEtapa } from "../Onboarding";
import { useOnboarding } from "../estado";
import { useJaneteNoPalco } from "../palco";
import { focarDepois, useTemporizadores } from "../conversa/temporizadores";
import estilos from "./Despertar.module.css";

const s = estilos as Classes<
  | "despertar"
  | "grupo"
  | "wrap"
  | "halo"
  | "simbolo"
  | "texto"
  | "titulo"
  | "palavras"
  | "palavra"
  | "letra"
  | "sub"
  | "acoes"
  | "pular"
>;

/**
 * Id do símbolo de 144: o alvo do voo que chega do cérebro e o ponto de partida do voo seguinte,
 * até o topo do cartão da Voz (sem chave de voz) ou até o avatar do chat (quem já tem a chave).
 */
export const ID_SIMBOLO_DESPERTAR = "d-simbolo";
export const ID_BOTAO_CONVERSAR = "btn-conversar";

/**
 * As fases do F (`dz`): chega (o símbolo em voo ainda não pousou) → acende (o halo acende) →
 * fala (o título entra letra por letra, a Janete "digita") → fim (texto e botão) → sai (o texto
 * some antes do voo até a Voz ou até o chat).
 */
export type FaseDespertar = "chega" | "acende" | "fala" | "fim" | "sai";

/** Atrasos do F: o título entra aos 750 ms e o fim chega aos 2400 ms (com movimento reduzido, 0 e 40). */
export const TEMPOS_DESPERTAR = { fala: 750, fim: 2400, sai: 180, mira: 60 } as const;

const PALAVRAS = ["Oi!", "Eu", "sou", "a", "Janete."];

/** As letras do título, cada uma com o atraso do F (120 ms + 38 ms por letra). */
function letrasDoTitulo() {
  let idx = 0;
  return PALAVRAS.map((palavra, wi) => ({
    palavra,
    nome: wi === PALAVRAS.length - 1,
    letras: palavra.split("").map((ch) => ({ ch, atraso: 120 + idx++ * 38 })),
  }));
}
const TITULO = letrasDoTitulo();

/** Sem chave de voz (P5 da spec da voz): a Janete avisa que ainda não fala e leva à etapa Voz. */
const SUB_SEM_VOZ = "Ainda não consigo falar nem escutar áudios. Vamos configurar a chave da ElevenLabs agora.";
/** Sem chave de voz, com o cérebro da OpenAI: a chave da OpenAI já transcreve os áudios. */
const SUB_SEM_VOZ_OPENAI =
  "Já consigo escutar áudios, mas ainda não consigo falar. Vamos configurar a chave da ElevenLabs agora.";
/** Com chave de voz (quem voltou): o texto de antes da Voz, e o botão vai direto à conversa. */
const SUB_COM_VOZ =
  "Vou atender os leads da sua empresa no WhatsApp. Antes, quero entender o seu negócio com algumas perguntas rápidas.";

export function EtapaDespertar({ avancar }: PropsEtapa) {
  const { estado, irPara } = useOnboarding();
  // O modo se decide na montagem, pelo estado da aba: a chave de voz não muda nesta etapa.
  const inicial = useRef({ comVoz: !!estado.voz.ultimos4, openai: estado.cerebro.provedor === "openai" }).current;
  const voo = useVooJanete();
  const vooRef = useRef(voo);
  vooRef.current = voo;
  const t = useTemporizadores();
  // Chegou com o símbolo em voo (vindo do check da IA): o daqui fica escondido até ele pousar.
  const [fase, setFase] = useState<FaseDespertar>(() => (voo.ativo ? "chega" : "acende"));
  useJaneteNoPalco(true);

  const despertar = useCallback(() => {
    const mov = !movimentoReduzido();
    setFase("acende");
    t.depois(() => setFase("fala"), mov ? TEMPOS_DESPERTAR.fala : 0);
    t.depois(() => {
      setFase("fim");
      focarDepois(t, ID_BOTAO_CONVERSAR);
    }, mov ? TEMPOS_DESPERTAR.fim : 40);
  }, [t]);

  // irParaDespertar do F: mede o próprio símbolo, o viajante voa até ele, e só então acende.
  // A medida passa por rolarAteEMedir: com a página rolada (o cérebro era longo), o símbolo daqui
  // vem para a vista e só é medido com a rolagem parada; senão o viajante pousaria fora do lugar.
  useEffect(() => {
    if (!vooRef.current.ativo) {
      despertar();
      return;
    }
    const rodada = t.geracao();
    t.depois(() => {
      void (async () => {
        const alvo = await rolarAteEMedir(ID_SIMBOLO_DESPERTAR);
        // "Pular animação" durante a rolagem: o pulo já soltou o símbolo e foi ao fim.
        if (t.geracao() !== rodada) return;
        if (alvo) await vooRef.current.voar(alvo, { estado: "acordada" });
        if (t.geracao() !== rodada) return;
        vooRef.current.soltar();
        despertar();
      })();
    }, TEMPOS_DESPERTAR.mira);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pular = () => {
    t.limpar();
    vooRef.current.soltar();
    setFase("fim");
    focarDepois(t, ID_BOTAO_CONVERSAR);
  };

  // conversar do F: o texto sai e o símbolo fica em trânsito no lugar do daqui. Sem chave de voz,
  // a etapa Voz o leva ao topo do cartão dela (que nasce dele); com a chave, a conversa o leva ao avatar.
  // O ref guarda o clique: um segundo clique (inclusive com movimento reduzido, que segue na hora)
  // avançaria de novo e pularia a etapa seguinte.
  const saiu = useRef(false);
  const seguir = () => {
    if (inicial.comVoz) irPara("conversa");
    else avancar();
  };
  const conversar = () => {
    if (saiu.current || fase === "sai") return;
    saiu.current = true;
    if (movimentoReduzido()) {
      seguir();
      return;
    }
    t.limpar();
    setFase("sai");
    t.depois(() => {
      const ponto = medirJanete(ID_SIMBOLO_DESPERTAR);
      if (ponto) vooRef.current.pousar(ponto, "acordada");
      seguir();
    }, TEMPOS_DESPERTAR.sai);
  };

  const subtitulo = inicial.comVoz ? SUB_COM_VOZ : inicial.openai ? SUB_SEM_VOZ_OPENAI : SUB_SEM_VOZ;

  const mostraTitulo = fase === "fala" || fase === "fim" || fase === "sai";
  const fim = fase === "fim" || fase === "sai";

  return (
    <section
      className={s.despertar}
      data-identidade="aipro"
      data-etapa="despertar"
      data-fase={fase}
      aria-labelledby="d-titulo"
    >
      <div className={s.grupo}>
        <div
          className={s.wrap}
          data-acesa={fase !== "chega" || undefined}
          data-apaga={fase === "sai" || undefined}
        >
          <span className={s.halo} aria-hidden="true" />
          <span
            id={ID_SIMBOLO_DESPERTAR}
            className={s.simbolo}
            data-oculto={fase === "chega" || undefined}
            aria-hidden="true"
          >
            <JaneteSimbolo
              decorativo
              tamanho={144}
              estado={fase === "fala" ? "fala" : "acordada"}
              digitando={fase === "fala"}
            />
          </span>
        </div>
        <div className={s.texto} data-sai={fase === "sai" || undefined}>
          <h1 id="d-titulo" className={s.titulo} aria-label="Oi! Eu sou a Janete." tabIndex={-1}>
            {mostraTitulo && (
              <span className={s.palavras} aria-hidden="true">
                {TITULO.map((w) => (
                  <span key={w.palavra} className={s.palavra} data-nome={w.nome || undefined}>
                    {w.letras.map((l, i) => (
                      <span key={i} className={s.letra} style={{ animationDelay: `${l.atraso}ms` }}>
                        {l.ch}
                      </span>
                    ))}
                  </span>
                ))}
              </span>
            )}
          </h1>
          {fim && (
            <>
              <p className={s.sub}>{subtitulo}</p>
              <div className={s.acoes}>
                <Botao
                  id={ID_BOTAO_CONVERSAR}
                  tamanho="grande"
                  onClick={conversar}
                  iconeDepois={<ArrowRight size={18} strokeWidth={2} />}
                >
                  {inicial.comVoz ? "Conversar com a Janete" : "Configurar a ElevenLabs"}
                </Botao>
              </div>
            </>
          )}
        </div>
      </div>
      {!fim && (
        <Botao variante="discreto" className={cx(s.pular)} onClick={pular}>
          Pular animação
        </Botao>
      )}
    </section>
  );
}
