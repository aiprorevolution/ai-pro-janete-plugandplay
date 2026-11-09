import { useLayoutEffect, useRef, useState } from "react";

import { Botao, cx } from "@/components/aipro";
import type { Classes } from "@/components/aipro/cx";
import { movimentoReduzido } from "@/components/janete/VooJanete";
import type { GatewayQr } from "@/features/servidor/qr-conexao";

import { PROVS } from "../../lista/dados";
import type { EstadoLeituraQr } from "./useLeituraQr";
import estilos from "./DiscoQr.module.css";

const s = estilos as Classes<"disco" | "logo" | "imagem" | "apagada" | "barra" | "sobreposto">;

/**
 * Quanto o quadro leva para encolher de volta no círculo (a transição de tamanho do DiscoQr, em
 * DiscoQr.module.css). Depois do `conectado`, quem usa o passo espera esse tempo antes de salvar,
 * para o disco real (que volta no "verificando") aparecer exatamente onde o círculo parou.
 */
export const TEMPO_VOLTA_DISCO_MS = 450;

/** O tempo de volta que vale agora: 0 com movimento reduzido (sem transição, nada a esperar). */
export function tempoVoltaDisco(): number {
  return movimentoReduzido() ? 0 : TEMPO_VOLTA_DISCO_MS;
}

export type FormaDisco = "disco" | "quadro";

/** "diferente": o celular de outro número leu o QR (o estado da leitura não conta). */
export type EstadoDisco = EstadoLeituraQr | { tipo: "diferente" };

/** Quadro enquanto há QR a mostrar (ou a caminho); círculo com o logo no resto. */
export function formaDoDisco(estado: EstadoDisco): FormaDisco {
  return estado.tipo === "carregando" || estado.tipo === "qr" || estado.tipo === "expirado" ? "quadro" : "disco";
}

/**
 * O disco do palco que vira o quadro do QR (spec-qr-whatsapp, seção 8, decisão 3). Fica por cima
 * do disco real da validação (que some com `.val[data-vis='qr'] .disco`) e nasce igual a ele: o
 * mesmo círculo, o mesmo fundo, a mesma sombra e o logo do mesmo tamanho. No quadro seguinte ele
 * cresce para a forma do estado.
 */
export function DiscoQr(p: {
  estado: EstadoDisco;
  gateway: GatewayQr;
  /** O QR a mostrar (o atual, ou o último, apagado, no expirado). */
  imagem: string | null;
  alt: string;
  textoGerarOutro: string;
  aoGerarOutro: () => void;
}) {
  const { estado, gateway, imagem, alt, textoGerarOutro, aoGerarOutro } = p;
  const prov = PROVS[gateway];
  const alvo = formaDoDisco(estado);

  // o primeiro desenho é o círculo parado; o estilo dele é calculado (getBoundingClientRect) e só
  // então a forma do estado entra, para a transição partir do disco real
  const ref = useRef<HTMLDivElement>(null);
  const [pousado, setPousado] = useState(false);
  useLayoutEffect(() => {
    ref.current?.getBoundingClientRect();
    setPousado(true);
  }, []);
  const forma: FormaDisco = pousado ? alvo : "disco";

  const comImagem = forma === "quadro" && !!imagem;
  const expirado = estado.tipo === "expirado";

  return (
    <div
      ref={ref}
      className={s.disco}
      data-disco-qr=""
      data-testid="disco-qr"
      data-forma={forma}
      data-escura={(prov.escura && !comImagem) || undefined}
      data-larga={prov.larga || undefined}
      data-vazio={!imagem || undefined}
      data-carregando={estado.tipo === "carregando" || undefined}
    >
      <img
        className={cx(s.logo, expirado && s.apagada)}
        src={prov.logo}
        alt=""
        aria-hidden="true"
        data-oculto={comImagem || undefined}
      />
      {imagem && (
        <img
          src={imagem}
          // fora do quadro a imagem só some (encolhendo junto): sai do leitor de tela
          alt={comImagem ? alt : ""}
          aria-hidden={comImagem ? undefined : true}
          width={232}
          height={232}
          className={cx(s.imagem, expirado && s.apagada)}
          data-oculto={!comImagem || undefined}
        />
      )}
      {estado.tipo === "qr" && forma === "quadro" && (
        // a barra dos 20 s recomeça a cada QR novo (a key muda)
        <span key={`${estado.rodada}-${estado.desde}`} className={s.barra} aria-hidden="true" />
      )}
      {expirado && (
        <div className={s.sobreposto}>
          <Botao tamanho="compacto" onClick={aoGerarOutro}>
            {textoGerarOutro}
          </Botao>
        </div>
      )}
    </div>
  );
}
