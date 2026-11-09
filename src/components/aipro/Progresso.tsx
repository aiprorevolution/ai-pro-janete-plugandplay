import type { CSSProperties, ReactNode } from "react";
import { cx, type Classes } from "./cx";
import estilos from "./Progresso.module.css";

const s = estilos as Classes<
  "barra" | "casas" | "casa" | "preenchimento" | "anel" | "trilhoAnel" | "valorAnel" | "centro"
>;

const limitar = (valor: number) => Math.min(100, Math.max(0, Math.round(valor)));

type PropsBarra = {
  /** 0 a 100. */
  valor: number;
  /** Nome acessível: "Progresso do onboarding". */
  rotulo: string;
  /** Valor lido pelo leitor de tela ("2 de 5 etapas concluídas"); padrão "N%". */
  textoValor?: string | undefined;
  /** fina 6 · média 8. */
  espessura?: "fina" | "media" | undefined;
  /** Até 12: barra com casas (uma por etapa). Acima de 12, contínua. */
  segmentos?: number | undefined;
  /** Casas concluídas fora de ordem (comprimento = segmentos). */
  feitos?: boolean[] | undefined;
  sobrePalco?: boolean | undefined;
  className?: string | undefined;
};

/**
 * Progresso que preenche. Com casas, junta progresso e mapa: cada casa é uma etapa.
 * A barra entra preenchendo (`[data-preencher]`); com movimento reduzido, já cheia.
 */
export function BarraProgresso({
  valor,
  rotulo,
  textoValor,
  espessura = "fina",
  segmentos,
  feitos,
  sobrePalco = false,
  className,
}: PropsBarra) {
  const atual = limitar(valor);
  const casas = segmentos && segmentos > 1 && segmentos <= 12 ? segmentos : 0;
  const comum = {
    role: "progressbar",
    "aria-label": rotulo,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": atual,
    "aria-valuetext": textoValor ?? `${atual}%`,
    "data-espessura": espessura,
    "data-palco": sobrePalco || undefined,
  } as const;

  if (casas) {
    const preenchidas = Math.round((atual / 100) * casas);
    const marcadas = Array.from({ length: casas }, (_, i) => feitos?.[i] ?? i < preenchidas);
    return (
      <div className={cx(s.casas, className)} {...comum}>
        {marcadas.map((feita, indice) => (
          <span key={indice} className={s.casa} data-feita={feita || undefined}>
            {feita ? <span className={s.preenchimento} data-preencher /> : null}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={cx(s.barra, className)} {...comum}>
      <span
        className={s.preenchimento}
        data-preencher
        style={{ "--valor": `${atual}%` } as CSSProperties}
      />
    </div>
  );
}

type PropsAnel = {
  /** 0 a 100. */
  valor: number;
  /** 36 · 48. */
  tamanho?: 36 | 48 | undefined;
  /** Nome acessível: "Faltam 3 perguntas". */
  rotulo: string;
  /** Texto curto no centro (só no de 48): "3". */
  conteudo?: ReactNode;
  className?: string | undefined;
};

/** Anel de progresso. Trilho azul-claro, valor azul. */
export function AnelProgresso({ valor, tamanho = 48, rotulo, conteudo, className }: PropsAnel) {
  const atual = limitar(valor);
  const traco = tamanho === 36 ? 4 : 5;
  const raio = (tamanho - traco) / 2;
  const volta = 2 * Math.PI * raio;

  return (
    <span
      className={cx(s.anel, className)}
      data-tamanho={tamanho}
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={atual}
    >
      <svg
        width={tamanho}
        height={tamanho}
        viewBox={`0 0 ${tamanho} ${tamanho}`}
        aria-hidden="true"
      >
        <circle
          className={s.trilhoAnel}
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          strokeWidth={traco}
        />
        <circle
          className={s.valorAnel}
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          strokeWidth={traco}
          strokeDasharray={volta}
          strokeDashoffset={volta * (1 - atual / 100)}
        />
      </svg>
      {conteudo && tamanho === 48 ? <span className={s.centro}>{conteudo}</span> : null}
    </span>
  );
}
