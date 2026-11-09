// Registro dos adaptadores. Cada workflow de gateway só mexe na própria pasta; este arquivo
// não muda (spec da mensageria, "Contratos").
import type { AdaptadorGateway, GatewayId } from "../nucleo/tipos";
import { adaptadorEvolution } from "./evolution";
import { adaptadorMeta } from "./meta";
import { adaptadorZapi } from "./zapi";
import { adaptadorZernio } from "./zernio";

export const ADAPTADORES: Record<GatewayId, AdaptadorGateway> = {
  meta: adaptadorMeta,
  zernio: adaptadorZernio,
  zapi: adaptadorZapi,
  evolution: adaptadorEvolution,
};

export function adaptadorDe(gateway: string): AdaptadorGateway | null {
  return (ADAPTADORES as Record<string, AdaptadorGateway | undefined>)[gateway] ?? null;
}
