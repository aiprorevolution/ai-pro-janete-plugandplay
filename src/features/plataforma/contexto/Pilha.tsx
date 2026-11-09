import { Plus } from "lucide-react";
import { useEffect, useState, type CSSProperties, type Ref } from "react";

import { cx } from "@/components/aipro/cx";

import { s } from "./pilha-estilos";
import { GRUPOS, type GrupoId } from "./tipos";

// A pilha da Janete (spec-contexto.md, "Contratos", e .ctx-pilha do Contexto 6): os 3 discos em CSS 3D,
// de cima para baixo "Sobre a oferta" (com o recorte e a peça azul), "Como conversar" e "Perguntas
// livres". Quem decide a fase é a tela (voo.ts na entrada); aqui só se desenha cada fase e a passagem
// de uma para a outra.

/**
 * plano: o símbolo montado, de frente (onde o voo pousa) · inclinada: os 3 encaixados, em
 * perspectiva, e a peça se solta · separada: o vão aberto, com mola (o mapa) · recolhida: inclinada
 * e encaixada, com a peça assentada (a volta da seção, antes de separar de novo).
 */
export type FasePilha = "plano" | "inclinada" | "separada" | "recolhida";

/** Do centro do disco do meio ao centro do de cima e ao do de baixo, em frações de `d`. */
export const G_SEP = 0.532;
export const G_SEP3 = 0.546;

/** Quanto a pilha separada passa da caixa, a partir do centro dela, em frações de `d`: a peça em cima e
 * o disco de baixo (com a sombra) embaixo. A tela reserva esse espaço e põe a legenda logo abaixo. */
export const PILHA_ALTURA = { acima: 1.235, abaixo: 0.84 } as const;

/** O tempo que a mola de separar leva até assentar (aí o destaque e o hover respondem rápido). */
const MS_ASSENTAR = 1000;

const ROTULO_PADRAO: Record<GrupoId, string> = {
  oferta: "Disco de cima, Sobre a oferta. Abrir a área.",
  conversa: "Disco do meio, Como conversar. Abrir a área.",
  livres: "Disco de baixo, Perguntas livres. Abrir a área.",
};

const CAMADA: Record<GrupoId, string> = { oferta: s.c1, conversa: s.c2, livres: s.c3 };

export interface PropsPilha {
  fase: FasePilha;
  /** O diâmetro dos discos, em px. A caixa (#ctx-pilha) tem esse lado. */
  d: number;
  /** Versão antiga na tela: tudo cinza. */
  dormindo?: boolean | undefined;
  /** O disco do grupo sobe um pouco e acende (o hover ou o foco num item do mapa). */
  destaque?: GrupoId | null | undefined;
  /** Com ela, cada disco ganha um botão (só na fase "separada"). */
  aoClicarDisco?: ((g: GrupoId) => void) | undefined;
  /** Só admin, na versão atual: sem ela, a peça não é botão. */
  aoClicarPeca?: (() => void) | undefined;
  /** O balão de ensinar aberto (aria-expanded da peça). */
  pecaAberta?: boolean | undefined;
  /** Os nomes acessíveis dos discos, com a contagem ("Disco de cima, Sobre a oferta: 4 de 4…"). */
  rotulos?: Partial<Record<GrupoId, string>> | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}

export function Pilha({
  fase,
  d,
  dormindo = false,
  destaque = null,
  aoClicarDisco,
  aoClicarPeca,
  pecaAberta,
  rotulos,
  className,
  ref,
}: PropsPilha) {
  // a fase de onde veio (a passagem depende dela) e se a mola de separar já assentou
  const [trilha, setTrilha] = useState({ atual: fase, anterior: fase });
  const [assentada, setAssentada] = useState(fase === "separada");
  if (trilha.atual !== fase) {
    setTrilha({ atual: fase, anterior: trilha.atual });
    setAssentada(false);
  }

  useEffect(() => {
    if (fase !== "separada" || assentada) return;
    const t = setTimeout(() => setAssentada(true), MS_ASSENTAR);
    return () => clearTimeout(t);
  }, [fase, assentada]);

  const solta = fase === "separada";

  return (
    <div
      ref={ref}
      id="ctx-pilha"
      className={cx(s.pilha, className)}
      data-fase={fase}
      data-de={trilha.anterior !== fase ? trilha.anterior : undefined}
      data-assentada={solta && assentada ? "" : undefined}
      data-dormindo={dormindo ? "" : undefined}
      data-destaque={destaque ?? undefined}
      style={{ "--d": `${d}px` } as CSSProperties}
    >
      <span className={s.chao} aria-hidden="true" />
      <div className={s.cena} aria-hidden="true">
        <div className={s.tresD}>
          {/* de baixo para cima: no DOM, o de cima vem por último */}
          <div className={cx(s.camada, CAMADA.livres)} data-disco="livres">
            <Fatias />
            <span className={s.face}>
              <span className={s.sombra} />
            </span>
          </div>
          <div className={cx(s.camada, CAMADA.conversa)} data-disco="conversa">
            <Fatias />
            <span className={s.face}>
              <span className={s.sombra} />
            </span>
          </div>
          <div className={cx(s.camada, CAMADA.oferta)} data-disco="oferta">
            <Fatias />
            <span className={s.face}>
              <span className={s.furo} data-parte="recorte" />
            </span>
            <Peca />
          </div>
        </div>
      </div>

      {/* os hubs: o mapa mede estes pontos e liga as curvas neles */}
      <span id="ctx-hub-oferta" data-hub="oferta" className={s.hub} aria-hidden="true" />
      <span id="ctx-hub-conversa" data-hub="conversa" className={s.hub} aria-hidden="true" />
      <span id="ctx-hub-livres" data-hub="livres" className={s.hub} aria-hidden="true" />

      {solta && aoClicarDisco
        ? GRUPOS.map((g) => (
            <button
              key={g.id}
              type="button"
              id={`ctx-disco-${g.id}`}
              data-camada={g.id}
              className={s.alvo}
              aria-label={rotulos?.[g.id] ?? ROTULO_PADRAO[g.id]}
              onClick={() => aoClicarDisco(g.id)}
            />
          ))
        : null}
      {solta && aoClicarPeca ? (
        <button
          type="button"
          id="ctx-peca-btn"
          data-acao="peca"
          className={s.pecaAlvo}
          aria-label="Ensinar algo novo à Janete"
          aria-expanded={pecaAberta === undefined ? undefined : pecaAberta}
          onClick={aoClicarPeca}
        >
          <span className={s.pecaDica} aria-hidden="true">
            <Plus className={s.pecaDicaIc} strokeWidth={2.4} />
            Ensinar algo novo
          </span>
        </button>
      ) : null}
    </div>
  );
}

export interface PropsDisco {
  grupo: GrupoId;
  /** O diâmetro, em px. A caixa tem `d` de largura e 0,98 d de altura. */
  d: number;
  /** O recorte e a peça azul. Padrão: só no disco de cima ("oferta"). */
  comPeca?: boolean | undefined;
  dormindo?: boolean | undefined;
  /** O id da face (a passagem entre o mapa e a seção mede por ele). */
  idFace?: string | undefined;
  className?: string | undefined;
}

/** Um disco sozinho, inclinado como na pilha: o grande da seção e os pequenos de trocar de área. */
export function Disco({ grupo, d, comPeca, dormindo = false, idFace, className }: PropsDisco) {
  const peca = comPeca ?? grupo === "oferta";
  return (
    <span
      className={cx(s.disco, className)}
      data-disco={grupo}
      data-com-peca={peca ? "" : undefined}
      data-dormindo={dormindo ? "" : undefined}
      aria-hidden="true"
      style={{ "--d": `${d}px` } as CSSProperties}
    >
      <span className={s.discoCena}>
        <span className={s.disco3d}>
          <Fatias />
          <span id={idFace} className={s.face}>
            {peca ? <span className={s.furo} data-parte="recorte" /> : null}
          </span>
          {peca ? <Peca /> : null}
        </span>
      </span>
    </span>
  );
}

/** A espessura: 3 fatias logo abaixo da face. */
function Fatias() {
  return (
    <>
      <i className={s.fatia} style={{ "--z": "calc(var(--t) * -1)" } as CSSProperties} />
      <i className={s.fatia} style={{ "--z": "calc(var(--t) * -0.66)" } as CSSProperties} />
      <i className={s.fatia} style={{ "--z": "calc(var(--t) * -0.33)" } as CSSProperties} />
    </>
  );
}

/** A peça azul: o mini balão, com 4 lâminas para ter um pouco de volume. */
function Peca() {
  return (
    <span className={s.peca} data-parte="peca">
      <span className={s.pecaBob}>
        <i className={s.pecaF} style={{ "--z": "calc(var(--d) * -0.014)" } as CSSProperties} />
        <i className={s.pecaF} style={{ "--z": "calc(var(--d) * -0.009)" } as CSSProperties} />
        <i className={s.pecaF} style={{ "--z": "calc(var(--d) * -0.004)" } as CSSProperties} />
        <i className={cx(s.pecaF, s.pecaTopo)} style={{ "--z": "0px" } as CSSProperties} />
      </span>
    </span>
  );
}
