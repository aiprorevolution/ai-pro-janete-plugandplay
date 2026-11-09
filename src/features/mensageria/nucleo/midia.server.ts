// Namespace "midias" no bucket privado criado pelo instalador Google.
// O contrato createBucket verifica a instalação; não cria infraestrutura durante uploads.
// A conferência bloqueia buckets públicos e configurações incompletas.
// Caminho = <conversa_id>/<mensagem_id>, sem extensão, com o tipo no contentType.
import { firebaseAdmin } from "@/integrations/firebase/client.server";

export const BUCKET_MIDIAS = "midias";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CAMINHO_VALIDO = new RegExp(`^${UUID}/${UUID}$`, "i");

export function caminhoMidia(conversaId: string, mensagemId: string): string {
  const caminho = `${conversaId}/${mensagemId}`;
  if (!CAMINHO_VALIDO.test(caminho)) throw new Error("caminho_invalido");
  return caminho;
}

function conferirCaminho(caminho: string): void {
  if (!CAMINHO_VALIDO.test(caminho)) throw new Error("caminho_invalido");
}

// Cache por isolate: depois da primeira conferência, não pergunta de novo.
let bucketPronto: Promise<void> | null = null;

function jaExiste(erro: unknown): boolean {
  const e = erro as { status?: number; statusCode?: string; code?: string; message?: string };
  return (
    e?.status === 409 ||
    e?.statusCode === "409" ||
    e?.code === "ResourceAlreadyExists" ||
    /already exists/i.test(e?.message ?? "")
  );
}

async function criarEConferir(): Promise<void> {
  const { error } = await firebaseAdmin.storage.createBucket(BUCKET_MIDIAS, { public: false });
  if (error && !jaExiste(error)) throw new Error("bucket_indisponivel");
  const { data, error: e2 } = await firebaseAdmin.storage.getBucket(BUCKET_MIDIAS);
  if (e2 || !data) throw new Error("bucket_indisponivel");
  if (data.public !== false) throw new Error("bucket_publico");
}

export function garantirBucket(): Promise<void> {
  if (!bucketPronto) {
    bucketPronto = criarEConferir().catch((erro) => {
      bucketPronto = null;
      throw erro;
    });
  }
  return bucketPronto;
}

/** Só para os testes: esquece o cache do bucket. */
export function esquecerBucket(): void {
  bucketPronto = null;
}

export async function enviarArquivo(
  caminho: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  conferirCaminho(caminho);
  await garantirBucket();
  // upsert: uma nova tentativa depois de uma cópia que não chegou a ser concluída não pode falhar
  // por "já existe". Só o servidor, com a identidade Google da instalação, grava assim.
  const { error } = await firebaseAdmin.storage
    .from(BUCKET_MIDIAS)
    .upload(caminho, bytes, { contentType: mime || "application/octet-stream", upsert: true });
  if (error) throw new Error("midia_envio_falhou");
}

export async function urlAssinada(caminho: string, segundos: number): Promise<string> {
  conferirCaminho(caminho);
  const { data, error } = await firebaseAdmin.storage
    .from(BUCKET_MIDIAS)
    .createSignedUrl(caminho, segundos);
  if (error || !data?.signedUrl) throw new Error("midia_url_falhou");
  return data.signedUrl;
}

export async function baixarArquivo(caminho: string): Promise<{ bytes: Uint8Array; mime: string }> {
  conferirCaminho(caminho);
  const { data, error } = await firebaseAdmin.storage.from(BUCKET_MIDIAS).download(caminho);
  if (error || !data) throw new Error("midia_download_falhou");
  const bytes = new Uint8Array(await data.arrayBuffer());
  return { bytes, mime: data.type || "application/octet-stream" };
}
