import { type CSSProperties } from "react";

import { type Classes } from "@/components/aipro/cx";

import type { PontoDia } from "../../dados";
import { diaCurto } from "./apoio";
import estilos from "./Graficos.module.css";

const s = estilos as Classes<"dvaBarras" | "dvaDivisao" | "dvaDivisaoBarra" | "dvaDivisaoLegenda" | "dvaBarrasDia" | "dvaBarrasDiaEixo">;

// Os gráficos dos capítulos (vindos da versão A): a barra dividida (Janete × equipe) e as barras por dia
// (as entradas da etapa). Barras com cantos arredondados e uma cor de acento; todo gráfico tem
// `role="img"` com os números no rótulo (spec 12). Nenhum número novo: os rótulos só escolhem pontos da
// série (o primeiro, o último, o maior), e as alturas são só a proporção do desenho.

const css = (vars: Record<string, string | number>) => vars as CSSProperties;

function maior(pontos: readonly PontoDia[]): PontoDia | null {
  let m: PontoDia | null = null;
  for (const p of pontos) if (!m || p.valor > m.valor) m = p;
  return m;
}

/** "Entradas por dia em Novo, de 01/10 a 30/10: o maior dia teve 12 (07/10); o último, 4." */
function descrever(rotulo: string, pontos: readonly PontoDia[], formatar: (n: number) => string): string {
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  const m = maior(pontos);
  if (!primeiro || !ultimo || !m) return `${rotulo}: sem dados no período.`;
  if (pontos.length === 1) return `${rotulo}, ${diaCurto(primeiro.dia)}: ${formatar(primeiro.valor)}.`;
  return `${rotulo}, de ${diaCurto(primeiro.dia)} a ${diaCurto(ultimo.dia)}: o maior dia teve ${formatar(m.valor)} (${diaCurto(m.dia)}); o último, ${formatar(ultimo.valor)}.`;
}

/* ---------- barra dividida (Janete × equipe) ---------- */

export interface ParteDivisao {
  chave: string;
  rotulo: string;
  valor: number;
  /** O texto do número, já formatado ("2.146"). */
  texto: string;
  tom: "forte" | "escuro" | "fraco" | "neutro";
}

export function BarraDividida({ partes, rotulo, className }: { partes: readonly ParteDivisao[]; rotulo: string; className?: string | undefined }) {
  const visiveis = partes.filter((p) => p.valor > 0);
  const descricao = `${rotulo}: ${partes.map((p) => `${p.rotulo}, ${p.texto}`).join("; ")}.`;
  return (
    <div className={[s.dvaDivisao, className].filter(Boolean).join(" ")}>
      <div className={s.dvaDivisaoBarra} role="img" aria-label={descricao}>
        {visiveis.length ? (
          visiveis.map((p) => <span key={p.chave} data-tom={p.tom} style={{ flexGrow: p.valor }} />)
        ) : (
          <span data-tom="vazio" style={{ flexGrow: 1 }} />
        )}
      </div>
      <ul className={s.dvaDivisaoLegenda} aria-hidden="true">
        {partes.map((p) => (
          <li key={p.chave} data-tom={p.tom}>
            <i />
            <span>{p.rotulo}</span>
            <b>{p.texto}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- barras por dia (as entradas da etapa) ---------- */

export function BarrasDia({
  pontos,
  rotulo,
  formatar,
  className,
}: {
  pontos: readonly PontoDia[];
  rotulo: string;
  formatar: (n: number) => string;
  className?: string | undefined;
}) {
  const m = maior(pontos)?.valor ?? 0;
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  return (
    <figure className={[s.dvaBarrasDia, className].filter(Boolean).join(" ")}>
      <div className={s.dvaBarras} role="img" aria-label={descrever(rotulo, pontos, formatar)} data-densa={pontos.length > 45 || undefined}>
        {pontos.map((p) => (
          <span key={p.dia} style={css({ "--h": m > 0 ? p.valor / m : 0 })} data-maior={(m > 0 && p.valor === m) || undefined} />
        ))}
      </div>
      {primeiro && ultimo && pontos.length > 1 ? (
        <figcaption className={s.dvaBarrasDiaEixo} aria-hidden="true">
          <span>{diaCurto(primeiro.dia)}</span>
          <span>{diaCurto(ultimo.dia)}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
