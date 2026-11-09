import { randomBytes } from "node:crypto";
import { firestoreStore } from "@/integrations/firebase/store.server";

/** Segredo aleatório estável da instalação, independente de login, tokens e revisões do servidor.
 * A coleção não é exposta pelas APIs do app; as regras limitam o acesso ao dono da instalação.
 * Não usar cache global: cada operação conserva a autorização da requisição que a originou.
 */
export async function segredoDaInstalacao(): Promise<string> {
  // Override é destinado a testes isolados e instalações com segredo montado no servidor.
  // Ao adotar Secret Manager, conservar o mesmo valor: rotação exige recifrar os registros.
  const configured = process.env["JANETE_MASTER_SECRET"];
  if (configured) {
    if (configured.length < 32) throw new Error("cifra_indisponivel");
    return configured;
  }
  try {
    return await firestoreStore.runTransaction(async (tx) => {
      const saved = await tx.get("cofre_config", "master");
      if (saved) {
        if (typeof saved["secret"] !== "string" || saved["secret"].length < 32)
          throw new Error("cifra_indisponivel");
        return saved["secret"];
      }
      const secret = randomBytes(32).toString("base64url");
      await tx.set("cofre_config", "master", {
        secret,
        version: 1,
        createdAt: new Date().toISOString(),
      });
      return secret;
    });
  } catch {
    throw new Error("cifra_indisponivel");
  }
}
