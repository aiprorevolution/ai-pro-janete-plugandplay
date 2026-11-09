import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cx, type Classes } from "@/components/aipro/cx";
import { movimentoReduzido } from "@/components/janete/VooJanete";

import { variacaoDe, type PontoDia, type Sentido, type Tendencia } from "../../dados";
import estilos from "./Topo.module.css";

// Peças pequenas da página (vindas da versão D; uma de cada na final): o número que sobe contando, a
// variação com seta e cor pelo sentido, o "como contamos" (dica que abre no foco, no hover e no clique e
// fecha com Esc) e a faixa (sparkline) dos 4 números.
// Nenhuma delas calcula número de negócio: recebem o valor pronto da fundação e só formatam ou desenham.

const s = estilos as Classes<
  | "dvd-num"
  | "dvd-var"
  | "dvd-varSeta"
  | "dvd-info"
  | "dvd-infoBotao"
  | "dvd-infoBalao"
  | "dvd-faixa"
  | "dvd-faixaArea"
  | "dvd-faixaLinha"
  | "dvd-faixaLinha2"
  | "dvd-faixaPonto"
  | "dvd-sr"
>;

const CONTAGEM_MS = 600;

/** Só para o leitor de tela. */
export function Sr({ children }: { children: ReactNode }) {
  return <span className={s["dvd-sr"]}>{children}</span>;
}

/**
 * O número grande de um cartão. Na 1ª vez da aba (`contar`), sobe de 0 até o valor em 600 ms
 * (ease-out), escrevendo direto no texto do nó (nada de setState por quadro). Nas outras vezes, e
 * com movimento reduzido, aparece já no valor. Quando o valor muda, a contagem em curso para e o
 * texto final entra (a troca de período não conta do zero: só a entrada curta do CSS).
 *
 * No StrictMode o React roda o efeito, limpa e roda de novo: se a contagem não chegou ao fim na
 * limpeza, a marca de "primeira" volta, para a remontagem contar de novo (senão os números nunca
 * subiriam contando no servidor de desenvolvimento).
 */
export function Num({
  valor,
  formatar,
  contar = false,
  className,
}: {
  valor: number;
  formatar: (n: number) => string;
  contar?: boolean | undefined;
  className?: string | undefined;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const texto = formatar(valor);
  const primeira = useRef(true);
  useEffect(() => {
    const el = ref.current;
    const ehPrimeira = primeira.current;
    primeira.current = false;
    if (!el || !ehPrimeira || !contar || valor === 0 || movimentoReduzido() || typeof requestAnimationFrame !== "function") {
      if (!el) return;
      el.textContent = texto;
      // a troca de período: uma passagem curta (opacidade e 4 px), sem contar do zero
      if (!ehPrimeira && typeof el.animate === "function" && !movimentoReduzido()) {
        el.animate([{ opacity: 0.2, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }], {
          duration: 260,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        });
      }
      return;
    }
    let quadro = 0;
    let concluiu = false;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - inicio) / CONTAGEM_MS);
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      el.textContent = t >= 1 ? texto : formatar(valor * e);
      if (t < 1) quadro = requestAnimationFrame(passo);
      else concluiu = true;
    };
    quadro = requestAnimationFrame(passo);
    return () => {
      cancelAnimationFrame(quadro);
      // a contagem não terminou (o StrictMode remontou): a próxima montagem conta de novo
      if (!concluiu) primeira.current = true;
      el.textContent = texto;
    };
    // `texto` acompanha `valor` e `formatar`; o efeito só precisa correr quando o valor muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <span ref={ref} className={cx(s["dvd-num"], className)}>
      {texto}
    </span>
  );
}

const SETA: Record<"sobe" | "desce" | "igual", string> = { sobe: "↑", desce: "↓", igual: "→" };

/**
 * A variação contra o período anterior, com seta e cor pelo sentido (verde melhora, âmbar ou
 * vermelho piora; `custo` nunca fica vermelho). O texto vem de `variacaoDe` (pontos ou porcentagem).
 */
export function Variacao({
  tendencia,
  custo = false,
  rotulo = "contra o período anterior",
  className,
}: {
  tendencia: Tendencia & { variacaoPp?: number | null };
  custo?: boolean | undefined;
  rotulo?: string | undefined;
  className?: string | undefined;
}) {
  const texto = variacaoDe(tendencia);
  if (!texto) return null;
  const direcao: "sobe" | "desce" | "igual" = texto.startsWith("+") ? "sobe" : texto.startsWith("−") ? "desce" : "igual";
  const tom: Sentido | "custo" = tendencia.sentido === "pior" && custo ? "custo" : tendencia.sentido;
  return (
    <span className={cx(s["dvd-var"], className)} data-tom={tom}>
      <span className={s["dvd-varSeta"]} aria-hidden="true">
        {SETA[direcao]}
      </span>
      {texto}
      <Sr> {rotulo}</Sr>
    </span>
  );
}

/** O tempo que uma dica espera antes de fechar quando o ponteiro sai (dá para levar o ponteiro até ela). */
export const SAIR_DA_DICA_MS = 140;

/**
 * Abrir e fechar uma dica pelo ponteiro com a espera do WCAG 1.4.13: ao sair, ela espera
 * SAIR_DA_DICA_MS antes de fechar, e entrar de novo (no alvo ou na própria dica) cancela.
 */
export function useSaidaComEspera(fechar: () => void): { cancelar: () => void; sairDepois: () => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const cancelar = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const sairDepois = () => {
    cancelar();
    timer.current = setTimeout(() => {
      timer.current = null;
      fecharRef.current();
    }, SAIR_DA_DICA_MS);
  };
  return { cancelar, sairDepois };
}

/**
 * O "como contamos" (o único da página): um botão de informação com a definição da métrica numa dica
 * que abre no hover, no foco e no clique (o clique só abre: no toque, o 1º toque já mostra) e fecha no
 * blur, ao sair o ponteiro (com uma espera curta: dá para levar o ponteiro até a dica, que recebe o
 * ponteiro) e com Esc, ouvido no documento enquanto a dica está aberta (WCAG 1.4.13). A dica é
 * `role="tooltip"` ligada ao botão por aria-describedby; o nome do botão diz de qual métrica é. Com
 * `abaixo`, a dica abre embaixo do botão (no cartão do funil, que sobe até o topo da tela).
 */
export function ComoContamos({
  titulo,
  texto,
  children,
  abaixo = false,
  className,
}: {
  titulo: string;
  texto?: string | undefined;
  children?: ReactNode;
  abaixo?: boolean | undefined;
  className?: string | undefined;
}) {
  const id = useId();
  const [aberta, setAberta] = useState(false);
  const [fechadaComEsc, setFechadaComEsc] = useState(false);
  const mostrar = aberta && !fechadaComEsc;
  const { cancelar, sairDepois } = useSaidaComEspera(() => setAberta(false));
  useEffect(() => {
    if (!mostrar || typeof document === "undefined") return;
    const aoTecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setFechadaComEsc(true);
    };
    document.addEventListener("keydown", aoTecla);
    return () => document.removeEventListener("keydown", aoTecla);
  }, [mostrar]);
  const abrir = () => {
    cancelar();
    setFechadaComEsc(false);
    setAberta(true);
  };
  return (
    <span className={cx(s["dvd-info"], className)} data-abaixo={abaixo || undefined} onMouseEnter={abrir} onMouseLeave={sairDepois}>
      <button
        type="button"
        className={s["dvd-infoBotao"]}
        aria-label={`Como contamos: ${titulo}`}
        aria-describedby={id}
        aria-expanded={mostrar}
        onFocus={abrir}
        onBlur={() => {
          cancelar();
          setAberta(false);
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Escape" && mostrar) {
            ev.stopPropagation();
            setFechadaComEsc(true);
          }
        }}
        onClick={abrir}
      >
        <Info size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <span role="tooltip" id={id} className={s["dvd-infoBalao"]} data-aberta={mostrar || undefined}>
        {children ?? texto}
      </span>
    </span>
  );
}

/* ---------- mini gráficos (SVG à mão, só com os tokens) ---------- */

function escala(pontos: PontoDia[], largura: number, altura: number, max: number): string {
  if (!pontos.length) return "";
  const n = pontos.length;
  const passo = n > 1 ? largura / (n - 1) : 0;
  return pontos
    .map((p, i) => {
      const x = n > 1 ? i * passo : largura / 2;
      const y = altura - (max > 0 ? (p.valor / max) * (altura - 3) : 0) - 1.5;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function resumoSerie(pontos: PontoDia[], formatar: (n: number) => string): string {
  if (!pontos.length) return "sem dados";
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const p of pontos) {
    if (p.valor < min) min = p.valor;
    if (p.valor > max) max = p.valor;
  }
  const ultimo = pontos[pontos.length - 1]!.valor;
  if (pontos.length === 1) return `1 dia, com ${formatar(ultimo)}`;
  return `${pontos.length} dias, do menor ${formatar(min)} ao maior ${formatar(max)}; o último dia com ${formatar(ultimo)}`;
}

/**
 * A faixa (sparkline) do período: uma linha com a área por baixo, e opcionalmente uma 2ª série mais
 * escura (recebidas × enviadas). Ocupa a largura que o CSS der (preserveAspectRatio="none", com o
 * traço sem escala). Com 1 ponto só ("Hoje"), desenha só o ponto. Todo gráfico tem o texto
 * alternativo com os números.
 */
export function Faixa({
  serie,
  serie2,
  rotulo,
  rotulo2,
  formatar,
  largura = 96,
  altura = 22,
  className,
}: {
  serie: PontoDia[];
  serie2?: PontoDia[] | undefined;
  rotulo: string;
  rotulo2?: string | undefined;
  formatar: (n: number) => string;
  largura?: number | undefined;
  altura?: number | undefined;
  className?: string | undefined;
}) {
  const max = Math.max(0, ...serie.map((p) => p.valor), ...(serie2 ?? []).map((p) => p.valor));
  const umPonto = serie.length < 2;
  const d1 = umPonto ? "" : escala(serie, largura, altura, max);
  const d2 = serie2 && !umPonto ? escala(serie2, largura, altura, max) : "";
  const area = d1 ? `${d1} L${largura} ${altura} L0 ${altura} Z` : "";
  const ultimo = serie[serie.length - 1];
  const px = umPonto ? largura / 2 : largura;
  const py = ultimo ? altura - (max > 0 ? (ultimo.valor / max) * (altura - 3) : 0) - 1.5 : altura;
  const descricao = `${rotulo} por dia: ${resumoSerie(serie, formatar)}${serie2 && rotulo2 ? `. ${rotulo2} por dia: ${resumoSerie(serie2, formatar)}` : ""}`;
  return (
    <svg
      className={cx(s["dvd-faixa"], className)}
      height={altura}
      viewBox={`0 0 ${largura} ${altura}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={descricao}
    >
      {area ? <path className={s["dvd-faixaArea"]} d={area} /> : null}
      {d2 ? <path className={s["dvd-faixaLinha2"]} d={d2} vectorEffect="non-scaling-stroke" /> : null}
      {d1 ? <path className={s["dvd-faixaLinha"]} d={d1} vectorEffect="non-scaling-stroke" /> : null}
      {ultimo ? <circle className={s["dvd-faixaPonto"]} cx={px} cy={py} r={2.2} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}
