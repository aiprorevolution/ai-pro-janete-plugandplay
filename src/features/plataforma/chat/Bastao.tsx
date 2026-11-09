import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { Smartphone, UserCheck } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { esperaLonga } from "../comum/tempo";
import estilos from "./Bastao.module.css";

const s = estilos as Classes<
  "baBastao" | "baLado" | "baTxt" | "baLongo" | "baCurto" | "baMembro" | "baCel" | "baIcone"
>;

/**
 * Quem conduz a conversa, nos 4 estados do Chat:
 * - `janete`: a Janete atende;
 * - `espera`: a Janete passou e ninguém assumiu;
 * - `humano`: uma pessoa assumiu pela tela;
 * - `celular`: respondida pelo celular da empresa, sem responsável.
 */
export type EstadoBastao = "janete" | "espera" | "humano" | "celular";

type Props = {
  estado: EstadoBastao;
  /** No estado `humano`: quem atende é quem olha ("Você atendendo", desabilitado). */
  comigo: boolean;
  /** No estado `humano` com outra pessoa: o nome dela ("Assumir de Marina"). */
  responsavelNome?: string | undefined;
  /** As iniciais de quem atende (o avatar navy do lado da pessoa). */
  responsavelIniciais?: string | undefined;
  /** Há quantos segundos a conversa espera alguém: só entra no nome acessível do "Assumir". */
  esperaS?: number | undefined;
  aoAssumir: () => void;
  aoDevolver: () => void;
  className?: string | undefined;
};

type Lado = "janete" | "pessoa";

/** A curva e o tempo da troca de lugar (a mesma travessia do protótipo). */
const TROCA_MS = 250;
const TROCA_CURVA = "cubic-bezier(0.65, 0, 0.35, 1)";
/** Depois de uma troca, quanto tempo um clique de mouse é ignorado (o 2º clique de quem clicou duas vezes). */
const TRAVA_MS = 400;

function semMovimento(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * O bastão do Chat: dois botões pequenos, lado a lado. Na frente (à esquerda), destacado, o lado de
 * quem está com a conversa; atrás (à direita), em contorno, o outro lado, como ação ("Assumir",
 * "Devolver à Janete"). Quando a conversa troca de mãos, os dois trocam de lugar deslizando (~250 ms;
 * sem animação com "reduzir movimento"). A ordem no DOM segue a da tela. Quando o cabeçalho fica
 * estreito, os rótulos encurtam ("Com a Janete", "Assumir", "Com você", "Com Marina", "Devolver"); o
 * nome acessível começa pelo rótulo que se vê e guarda o texto inteiro. Um duplo clique não desfaz
 * a troca: o 2º clique, que cairia no botão que acabou de chegar, é ignorado.
 */
export function Bastao({
  estado,
  comigo,
  responsavelNome,
  responsavelIniciais,
  esperaS,
  aoAssumir,
  aoDevolver,
  className,
}: Props) {
  const comJanete = estado === "janete";
  const comVoce = estado === "humano" && comigo;
  const deOutro = estado === "humano" && !comigo;
  const frente: Lado = comJanete ? "janete" : "pessoa";

  /* ---------- a troca de lugar (FLIP): mede antes e depois e anima o deslocamento ---------- */

  const botoes = useRef<Partial<Record<Lado, HTMLButtonElement | null>>>({});
  const frenteAntes = useRef<Lado>(frente);
  const posicoes = useRef<Partial<Record<Lado, number>>>({});
  /** Quando os dois trocaram de lugar pela última vez (ms): segura o 2º clique de um duplo clique. */
  const ultimaTroca = useRef(Number.NEGATIVE_INFINITY);

  // Antes de o React mexer no DOM: a posição de cada botão com a ordem antiga (só quando a frente muda).
  // É a posição que se vê: com uma troca ainda no meio, ela já inclui o deslocamento da animação.
  if (frenteAntes.current !== frente) {
    for (const lado of ["janete", "pessoa"] as const) {
      const el = botoes.current[lado];
      if (el) posicoes.current[lado] = el.getBoundingClientRect().left;
    }
  }

  useLayoutEffect(() => {
    if (frenteAntes.current === frente) return;
    frenteAntes.current = frente;
    ultimaTroca.current = Date.now();
    const antes = posicoes.current;
    posicoes.current = {};
    if (semMovimento()) return;
    for (const lado of ["janete", "pessoa"] as const) {
      const el = botoes.current[lado];
      const x0 = antes[lado];
      if (!el || x0 == null || typeof el.animate !== "function") continue;
      // Uma troca no meio: para a animação antes de medir o destino (senão ele sai deslocado).
      el.getAnimations?.().forEach((a) => a.cancel());
      const dx = x0 - el.getBoundingClientRect().left;
      if (Math.abs(dx) < 1) continue;
      el.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], {
        duration: TROCA_MS,
        easing: TROCA_CURVA,
      });
    }
  }, [frente]);

  /**
   * O clique só vale se não for o 2º de um duplo clique nem vier logo depois de uma troca: sem isso,
   * o 2º clique cai no outro botão, que acabou de chegar no lugar, e desfaz a escolha na hora. O
   * teclado (detail 0) passa sempre: o foco já foi para o campo.
   */
  const clique = (fazer: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail > 1) return;
    if (e.detail !== 0 && Date.now() - ultimaTroca.current < TRAVA_MS) return;
    fazer();
  };

  /* ---------- o lado da Janete ---------- */

  // O nome acessível começa pelo rótulo que se vê (o longo, que contém o curto): quem usa voz diz o
  // que lê no botão.
  const janeteLongo = comJanete ? "Janete atendendo" : "Devolver à Janete";
  const janeteCurto = comJanete ? "Com a Janete" : "Devolver";
  const janeteAria = comJanete
    ? "Janete atendendo. Esta conversa está com a Janete"
    : "Devolver à Janete. Ela volta a atender esta conversa";

  /* ---------- o lado da pessoa ---------- */

  let pessoaLongo = "Assumir";
  let pessoaCurto = "Assumir";
  let pessoaAria = "Assumir conversa. A Janete sai dela";
  let pessoaDica: string | undefined;
  let pessoaTom: "acao" | "voce" | "outro" | "espera" | "celular" = "acao";
  if (estado === "espera") {
    pessoaTom = "espera";
    pessoaAria =
      esperaS != null
        ? `Assumir conversa. Ela espera atendimento há ${esperaLonga(esperaS)}`
        : "Assumir conversa. Ela espera atendimento";
  } else if (comVoce) {
    pessoaTom = "voce";
    pessoaLongo = "Você atendendo";
    pessoaCurto = "Com você";
    pessoaAria = "Você atendendo. Esta conversa está com você";
  } else if (deOutro) {
    // Na frente, quem atende ("Com Marina"); a ação vem depois, no rótulo longo e no nome acessível.
    const nome = responsavelNome?.trim() || "outra pessoa";
    const primeiro = responsavelNome?.trim() ? (nome.split(/\s+/)[0] ?? nome) : nome;
    pessoaTom = "outro";
    pessoaLongo = `Com ${primeiro} · Assumir`;
    pessoaCurto = `Com ${primeiro}`;
    pessoaDica = `Assumir de ${nome}. A conversa passa para você`;
    pessoaAria = `Com ${primeiro} · ${pessoaDica}`;
  } else if (estado === "celular") {
    pessoaTom = "celular";
    pessoaLongo = "Assumir pela plataforma";
    pessoaAria = "Assumir pela plataforma. A conversa foi respondida pelo celular da empresa";
    pessoaDica = pessoaAria;
  }

  const iconePessoa: ReactNode =
    estado === "humano" ? (
      <span className={s.baMembro} aria-hidden="true">
        {responsavelIniciais || "?"}
      </span>
    ) : estado === "celular" ? (
      <span className={cx(s.baMembro, s.baCel)} aria-hidden="true">
        <Smartphone size={12} />
      </span>
    ) : (
      <UserCheck className={s.baIcone} size={15} aria-hidden="true" />
    );

  const texto = (longo: string, curto: string) => (
    <span className={s.baTxt}>
      <span className={s.baLongo}>{longo}</span>
      <span className={s.baCurto}>{curto}</span>
    </span>
  );

  const botaoJanete = (
    <button
      key="janete"
      ref={(el) => {
        botoes.current.janete = el;
      }}
      type="button"
      className={s.baLado}
      data-lado={comJanete ? "frente" : "tras"}
      data-tom={comJanete ? "janete" : "acao"}
      disabled={comJanete}
      aria-label={janeteAria}
      // No celular, com a frente numa ação, o "Devolver" fica só com o símbolo: a dica diz o que é.
      title={comJanete ? undefined : "Devolver à Janete"}
      onClick={clique(aoDevolver)}
    >
      <JaneteSimbolo tamanho={18} decorativo />
      {texto(janeteLongo, janeteCurto)}
    </button>
  );

  const botaoPessoa = (
    <button
      key="pessoa"
      ref={(el) => {
        botoes.current.pessoa = el;
      }}
      type="button"
      className={s.baLado}
      data-lado={comJanete ? "tras" : "frente"}
      data-tom={pessoaTom}
      disabled={comVoce}
      aria-label={pessoaAria}
      title={pessoaDica}
      onClick={clique(aoAssumir)}
    >
      {iconePessoa}
      {texto(pessoaLongo, pessoaCurto)}
    </button>
  );

  // A frente mostra um estado (a Janete ou você atendendo) ou uma ação (esperando, outra pessoa,
  // celular): só o estado pode encolher até o ícone; a ação mantém a palavra em qualquer largura.
  const frenteEstado = comJanete || comVoce;

  return (
    <div
      className={cx(s.baBastao, className)}
      data-estado={estado}
      data-frente={frenteEstado ? "estado" : "acao"}
      role="group"
      aria-label="Quem conduz a conversa"
    >
      {comJanete ? [botaoJanete, botaoPessoa] : [botaoPessoa, botaoJanete]}
    </div>
  );
}
