import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { type Classes } from "@/components/aipro/cx";

import { ID_TITULO_DASHBOARD, usePainelDashboard, type IdPeriodo } from "../../dados";
import estilos from "./Topo.module.css";

// O cabeçalho da versão final, vindo da D (spec 5.2): a saudação (o h1 que a casca foca) e a linha de resumo à
// esquerda; o seletor de período em segmentos, com o personalizado (duas datas validadas pela
// fundação) num painel sobreposto preso ao segmento, para a dobra não mudar de altura; e embaixo
// "comparado com..." e "atualizado às..." à direita. No celular, o lugar da Janete (40 px) fica aqui,
// ao lado da saudação.

const s = estilos as Classes<
  | "dvd-hero"
  | "dvd-heroTexto"
  | "dvd-heroJanete"
  | "dvd-h1"
  | "dvd-resumoLinha"
  | "dvd-periodo"
  | "dvd-segmentos"
  | "dvd-seg"
  | "dvd-periodoMeta"
  | "dvd-datas"
  | "dvd-datasCampos"
  | "dvd-datasErro"
>;

const PERIODOS: readonly { id: IdPeriodo; texto: string }[] = [
  { id: "hoje", texto: "Hoje" },
  { id: "7d", texto: "7 dias" },
  { id: "30d", texto: "30 dias" },
  { id: "90d", texto: "90 dias" },
  { id: "personalizado", texto: "Personalizado" },
];

const ERRO_DATAS = "Confira as datas: o início vem antes do fim, o fim não passa de hoje, e o período vai até 1 ano.";

export function Cabecalho({ janeteCelular }: { janeteCelular: ReactNode }) {
  const { painel, idPeriodo, setPeriodo } = usePainelDashboard();
  const idPainel = useId();
  const [personalizadoAberto, setPersonalizadoAberto] = useState(idPeriodo === "personalizado");
  const [inicio, setInicio] = useState(idPeriodo === "personalizado" ? painel.periodo.inicio : "");
  const [fim, setFim] = useState(idPeriodo === "personalizado" ? painel.periodo.fim : "");
  const [erro, setErro] = useState<string | null>(null);
  const segPersonalizado = useRef<HTMLInputElement>(null);
  // "hoje" para o `max` dos campos: o fim de um período pré-definido é sempre hoje
  const hoje = useRef(idPeriodo === "personalizado" ? "" : painel.periodo.fim);
  if (idPeriodo !== "personalizado") hoje.current = painel.periodo.fim;

  useEffect(() => {
    if (idPeriodo === "personalizado") setPersonalizadoAberto(true);
  }, [idPeriodo]);

  const marcado: IdPeriodo = personalizadoAberto ? "personalizado" : idPeriodo;

  const escolher = (id: IdPeriodo) => {
    setErro(null);
    if (id === "personalizado") {
      // começa com o período que já está na tela: a marcação concorda com os números, e a pessoa só ajusta
      const de = inicio || painel.periodo.inicio;
      const ate = fim || painel.periodo.fim;
      setInicio(de);
      setFim(ate);
      setPersonalizadoAberto(true);
      if (idPeriodo !== "personalizado") setPeriodo("personalizado", { inicio: de, fim: ate });
      return;
    }
    setPersonalizadoAberto(false);
    setPeriodo(id);
  };

  const aplicarDatas = (de: string, ate: string) => {
    if (!de || !ate) {
      setErro(null);
      return;
    }
    const r = setPeriodo("personalizado", { inicio: de, fim: ate });
    setErro(r.ok ? null : ERRO_DATAS);
  };

  const fecharPainel = () => {
    setPersonalizadoAberto(false);
    segPersonalizado.current?.focus();
  };

  const parada = painel.estadoJanete === "dormindo";

  return (
    <header className={s["dvd-hero"]}>
      <div className={s["dvd-heroTexto"]}>
        {janeteCelular ? <div className={s["dvd-heroJanete"]}>{janeteCelular}</div> : null}
        <div>
          <h1 id={ID_TITULO_DASHBOARD} tabIndex={-1} className={s["dvd-h1"]}>
            {painel.textos.saudacao}
          </h1>
          <p className={s["dvd-resumoLinha"]} data-tom={parada ? "parada" : undefined}>
            {painel.textos.resumo}
          </p>
        </div>
      </div>

      <div className={s["dvd-periodo"]}>
        <fieldset className={s["dvd-segmentos"]}>
          <legend>Período</legend>
          {PERIODOS.map((p) => (
            <label key={p.id} className={s["dvd-seg"]}>
              <input
                ref={p.id === "personalizado" ? segPersonalizado : undefined}
                type="radio"
                name="dvd-periodo"
                value={p.id}
                checked={marcado === p.id}
                // aria-expanded não é permitido num rádio: com o painel das datas aberto, ele descreve o rádio
                aria-describedby={p.id === "personalizado" && personalizadoAberto ? idPainel : undefined}
                onChange={() => escolher(p.id)}
                onClick={() => {
                  // já marcado: o clique reabre o painel das datas
                  if (p.id === "personalizado" && marcado === "personalizado" && !personalizadoAberto) setPersonalizadoAberto(true);
                }}
              />
              {p.texto}
            </label>
          ))}
          {personalizadoAberto ? (
            <div
              id={idPainel}
              className={s["dvd-datas"]}
              role="group"
              aria-label="Período personalizado"
              onKeyDown={(ev) => {
                if (ev.key === "Escape") {
                  ev.stopPropagation();
                  fecharPainel();
                }
              }}
            >
              <div className={s["dvd-datasCampos"]}>
                <label>
                  de
                  <input
                    type="date"
                    value={inicio}
                    max={fim || hoje.current || undefined}
                    aria-invalid={erro ? true : undefined}
                    onChange={(ev) => {
                      setInicio(ev.target.value);
                      aplicarDatas(ev.target.value, fim);
                    }}
                  />
                </label>
                <label>
                  até
                  <input
                    type="date"
                    value={fim}
                    min={inicio || undefined}
                    max={hoje.current || undefined}
                    aria-invalid={erro ? true : undefined}
                    onChange={(ev) => {
                      setFim(ev.target.value);
                      aplicarDatas(inicio, ev.target.value);
                    }}
                  />
                </label>
              </div>
              {erro ? (
                <p className={s["dvd-datasErro"]} role="alert">
                  {erro}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
        <p className={s["dvd-periodoMeta"]}>
          <span>{painel.periodo.rotuloComparacao}</span>
          <span>{painel.textos.atualizado}</span>
        </p>
      </div>
    </header>
  );
}
