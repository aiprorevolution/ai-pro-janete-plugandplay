import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { CHAVES } from "./chaves";
import type { ClienteFirebase } from "./colunas";
import { RELER_SEM_TEMPO_REAL_MS, repetirSoFalha } from "./leituras";
import type { PendenciasMotor } from "./tipos";

// O motor acordado pelos acontecimentos, visto pelas telas (spec-motor-acordado, "Telas"):
// - a leitura: a rpc motor_pendencias (todo membro lê), relida a cada 60 s e no foco, como a
//   configuração. Só vale a leitura sem erro e com menos de 2 min (MOTOR_VALE_MS);
// - o conserto sozinho (decisão 2): com trabalho vencido há mais de 60 s, a tela aberta pede um
//   toque no motor (acordarMotor do ServidorDados), no máximo 1 vez por minuto, sem esperar a resposta.
// No modo exemplo não há motor: nada é lido e nada é pedido.

/** Por quanto tempo a leitura do motor vale (ela é relida a cada 60 s): mais velha, a tela não afirma nada. */
export const MOTOR_VALE_MS = 2 * 60_000;

/** Vencido há mais que isto, a tela aberta pede o toque (decisão 2). */
export const CONSERTAR_APOS_MS = 60_000;

/** O intervalo mínimo entre dois toques pedidos pela mesma tela. */
export const CONSERTAR_A_CADA_MS = 60_000;

/** Um instante do banco (timestamptz em texto) em ms; nulo, vazio ou inválido vira nulo. */
function instante(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A linha da rpc (uma só, sempre: são 3 agregados) no formato da tela. Sem linha, ou com uma linha
 * fora do formato (sem as 3 colunas), a resposta não serve: nulo, e a tela não afirma nada (sem
 * lançar, para não repetir a leitura à toa). Lida como "nada pendente", ela esconderia um atraso.
 */
export function lerPendencias(data: unknown): PendenciasMotor | null {
  const linha = Array.isArray(data) ? data[0] : data;
  if (!linha || typeof linha !== "object") return null;
  const o = linha as Record<string, unknown>;
  if (!("proximo_em" in o && "vencido_desde" in o && "atrasado_desde" in o)) return null;
  return {
    proximoEm: instante(o["proximo_em"]),
    vencidoDesde: instante(o["vencido_desde"]),
    atrasadoDesde: instante(o["atrasado_desde"]),
  };
}

export function opcoesMotor(cliente: ClienteFirebase | null) {
  return queryOptions({
    queryKey: [...CHAVES.motor, "pendencias"] as const,
    queryFn: async (): Promise<PendenciasMotor | null> => {
      if (!cliente) throw new Error("motor_pendencias sem cliente");
      const { data, error } = await cliente.rpc("motor_pendencias");
      if (error) throw error;
      return lerPendencias(data);
    },
    // só no banco: o exemplo não tem motor
    enabled: !!cliente,
    staleTime: 15_000,
    retry: repetirSoFalha,
    // as 5 tabelas que a rpc olha mudam sem avisar a tela (e o tempo passa sozinho): relida como a
    // configuração, a cada 60 s e no foco
    refetchInterval: RELER_SEM_TEMPO_REAL_MS,
    refetchOnWindowFocus: "always",
  });
}

/** O estado do React Query que conta para a validade. */
interface EstadoLeitura {
  data: PendenciasMotor | null | undefined;
  error: unknown;
  dataUpdatedAt: number;
}

/** A leitura só vale sem erro e com menos de 2 min; senão, undefined (a tela não afirma nada). */
export function motorValido(q: EstadoLeitura, agoraMs: number): PendenciasMotor | undefined {
  if (!q.data || q.error) return undefined;
  return agoraMs - q.dataUpdatedAt < MOTOR_VALE_MS ? q.data : undefined;
}

/**
 * Quando pedir o próximo toque: vencido há mais de 60 s e 1 min depois do último toque. Nulo = não
 * há o que consertar (nada vencido, ou leitura que não vale).
 */
export function quandoConsertar(
  p: PendenciasMotor | undefined,
  ultimoToque: number | null,
): number | null {
  if (!p || p.vencidoDesde === null) return null;
  const vencido = p.vencidoDesde + CONSERTAR_APOS_MS + 1;
  return ultimoToque === null ? vencido : Math.max(vencido, ultimoToque + CONSERTAR_A_CADA_MS);
}

/**
 * O conserto sozinho (decisão 2), no provedor de dados do banco: lê o motor e, com algo vencido há
 * mais de 60 s, chama `acordar` (sem esperar), no máximo 1 vez por minuto. Um toque que falha é
 * aceito: a próxima leitura (ou a próxima mensagem) tenta de novo.
 */
export function useConsertoDoMotor(
  cliente: ClienteFirebase,
  acordar: () => Promise<unknown> | undefined,
) {
  const { data, error, dataUpdatedAt } = useQuery(opcoesMotor(cliente));
  const acordarRef = useRef(acordar);
  acordarRef.current = acordar;
  const leituraRef = useRef<EstadoLeitura>({ data, error, dataUpdatedAt });
  leituraRef.current = { data, error, dataUpdatedAt };
  const ultimoToque = useRef<number | null>(null);

  useEffect(() => {
    const tocar = () => {
      // na hora do toque, a leitura ainda tem de valer e mostrar algo vencido há mais de 60 s
      const agora = Date.now();
      const quando = quandoConsertar(motorValido(leituraRef.current, agora), ultimoToque.current);
      if (quando === null || quando > agora) return;
      ultimoToque.current = agora;
      try {
        void Promise.resolve(acordarRef.current()).catch(() => {});
      } catch {
        // o toque é só um atalho: a próxima mensagem acorda o motor de qualquer jeito
      }
    };
    const quando = quandoConsertar(
      motorValido({ data, error, dataUpdatedAt }, Date.now()),
      ultimoToque.current,
    );
    if (quando === null) return;
    const espera = quando - Date.now();
    if (espera <= 0) {
      tocar();
      return;
    }
    // ainda não venceu os 60 s (ou o último toque foi há menos de 1 min): espera, sem nova leitura
    const t = setTimeout(tocar, espera);
    return () => clearTimeout(t);
  }, [data, error, dataUpdatedAt]);
}
