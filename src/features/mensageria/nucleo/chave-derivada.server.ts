import { createHmac } from "node:crypto";

/**
 * Chaves internas do servidor, derivadas do segredo da instalação (o do cofre). Cada uso tem o próprio rótulo, então
 * uma chave não serve no lugar da outra. São lidas sempre com a identidade do serviço, nunca com a de quem está logado,
 * e não vão para o navegador nem para o log. Cada instância lembra as que já derivou.
 */
const lembradas = new Map<string, string>();

export async function chaveDerivada(rotulo: string): Promise<string> {
  const lembrada = lembradas.get(rotulo);
  if (lembrada) return lembrada;
  const [{ requestIdentity }, { segredoDaInstalacao }] = await Promise.all([
    import("@/integrations/firebase/identity.server"),
    import("./segredo-instalacao.server"),
  ]);
  const segredo = await requestIdentity.exit(() => segredoDaInstalacao());
  const chave = createHmac("sha256", segredo).update(rotulo).digest("hex");
  lembradas.set(rotulo, chave);
  return chave;
}

/** Só para testes. */
export function esquecerChavesDerivadas(): void {
  lembradas.clear();
}
