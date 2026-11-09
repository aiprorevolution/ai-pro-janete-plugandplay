import { firebaseAdmin } from "@/integrations/firebase/client.server";
import { getInstallationConfig } from "@/integrations/firebase/config.server";
import { adaptadorDe } from "../gateways";
import { conexaoAtiva } from "./conexoes.server";
import { conferirOrigemPublicada } from "./tasks.server";

/** Depois de publicar, a própria identidade do serviço substitui a URL da prévia.
 * Provedores sem API de configuração continuam mostrando a URL para configuração no painel.
 */
export async function sincronizarWebhookPublicado(): Promise<void> {
  const config = await getInstallationConfig();
  const origin = conferirOrigemPublicada(process.env["JANETE_PUBLIC_URL"] || config.publicUrl || "");
  const connection = await conexaoAtiva();
  if (!connection) return;
  const adapter = adaptadorDe(connection.gateway);
  if (!adapter?.configurarWebhook) return;
  let url = `${origin}/api/public/whatsapp/${connection.gateway}/${connection.id}`;
  const token = connection.segredos["tokenUrl"];
  if ((connection.gateway === "evolution" || connection.gateway === "zapi") && token) url += `?t=${encodeURIComponent(token)}`;
  // Comparação só de origem, sem duplicar tokens de webhook em metadados consultados pelo painel.
  if (connection.parametros["webhook_public_origin"] === origin) return;
  await adapter.configurarWebhook(connection, url);
  const { error } = await firebaseAdmin.from("conexoes").update({
    parametros: { ...connection.parametros, webhook_public_origin: origin },
  }).eq("id", connection.id);
  if (error) throw new Error("webhook_publicado_nao_registrado");
}
