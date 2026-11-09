import { createHash } from "node:crypto";
import { getInstallationConfig } from "./config.server";
import { getServerAccessToken } from "./identity.server";

type StorageError = { code: string; message: string; status?: number };
type Result<T> = { data: T | null; error: StorageError | null };
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const error = (code: string): StorageError => ({ code, message: code });
const objectName = (namespace: string, name: string) => {
  if (namespace !== "midias" || !/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(name)) throw new Error("caminho_midia_invalido");
  return `${namespace}/${name}`;
};

async function bucket() {
  const config = await getInstallationConfig();
  const name = process.env["JANETE_STORAGE_BUCKET"] || config.storageBucket;
  if (!name || !/^[a-z0-9][a-z0-9._-]+$/.test(name)) throw new Error("storage_nao_configurado");
  return name;
}
async function google(url: string, init: RequestInit = {}) {
  const token = await getServerAccessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`storage_http_${response.status}`);
  return response;
}
async function result<T>(run: () => Promise<T>): Promise<Result<T>> {
  try { return { data: await run(), error: null }; }
  catch (e) { const message = e instanceof Error && /^[a-z_]+(?:_[0-9]+)?$/.test(e.message) ? e.message : "storage_indisponivel";
    return { data: null, error: error(message) }; }
}

/** GCS V4 via IAM signBlob: nenhuma chave privada JSON ou URL permanente de download. */
export async function signedStorageUrl(namespace: string, name: string, seconds: number): Promise<string> {
  const bucketName = await bucket();
  const object = objectName(namespace, name);
  const config = await getInstallationConfig();
  const serviceAccount = process.env["JANETE_RUNTIME_SERVICE_ACCOUNT"] || "";
  if (!serviceAccount.endsWith(`@${config.projectId}.iam.gserviceaccount.com`)) throw new Error("storage_identidade_ausente");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const day = stamp.slice(0, 8);
  const scope = `${day}/auto/storage/goog4_request`;
  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${serviceAccount}/${scope}`,
    "X-Goog-Date": stamp,
    "X-Goog-Expires": String(Math.max(1, Math.min(3600, Math.floor(seconds)))),
    "X-Goog-SignedHeaders": "host",
  });
  const canonicalQuery = [...query.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${encode(k)}=${encode(v)}`).join("&");
  const canonicalPath = `/${encode(bucketName)}/${object.split("/").map(encode).join("/")}`;
  const canonical = `GET\n${canonicalPath}\n${canonicalQuery}\nhost:storage.googleapis.com\n\nhost\nUNSIGNED-PAYLOAD`;
  const toSign = `GOOG4-RSA-SHA256\n${stamp}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
  const signature = await (await google(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:signBlob`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: Buffer.from(toSign).toString("base64") }),
    })).json() as { signedBlob?: string };
  if (!signature.signedBlob) throw new Error("storage_assinatura_invalida");
  return `https://storage.googleapis.com${canonicalPath}?${canonicalQuery}&X-Goog-Signature=${Buffer.from(signature.signedBlob, "base64").toString("hex")}`;
}

/** Compatibilidade de contratos das telas; todas as operações atingem o bucket Google real. */
export const storageAdapter = {
  async getBucket(namespace: string) {
    return result(async () => {
      if (namespace !== "midias") throw new Error("bucket_invalido");
      const actual = await bucket();
      const metadata = await (await google(`https://storage.googleapis.com/storage/v1/b/${encode(actual)}`)).json() as {
        iamConfiguration?: { publicAccessPrevention?: string; uniformBucketLevelAccess?: { enabled?: boolean } };
      };
      if (metadata.iamConfiguration?.publicAccessPrevention !== "enforced" ||
          metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true) throw new Error("bucket_privado_nao_confirmado");
      return { id: namespace, name: actual, public: false };
    });
  },
  async createBucket(namespace: string, _options: { public: boolean }) {
    // Provisionamento é responsabilidade do instalador autorizado; requisição de mídia só verifica.
    return storageAdapter.getBucket(namespace);
  },
  from(namespace: string) {
    return {
      list(folder: string, options: { limit?: number; offset?: number; sortBy?: { column: string; order: string } } = {}) {
        return result(async () => {
          if (namespace !== "midias" || !/^[a-z0-9-]+$/i.test(folder)) throw new Error("caminho_midia_invalido");
          if (options.sortBy && (options.sortBy.column !== "name" || options.sortBy.order !== "asc")) throw new Error("ordenacao_midia_invalida");
          const actual = await bucket();
          const prefix = `${namespace}/${folder}/`;
          const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
          const offset = Math.max(0, options.offset ?? 0);
          let skipped = 0, page = "";
          const selected: { name: string; id: string }[] = [];
          do {
            const response = await google(`https://storage.googleapis.com/storage/v1/b/${encode(actual)}/o?prefix=${encode(prefix)}&maxResults=1000${page ? `&pageToken=${encode(page)}` : ""}`);
            const data = await response.json() as { items?: { name: string; id?: string }[]; nextPageToken?: string };
            for (const item of data.items ?? []) {
              if (!item.name.startsWith(prefix)) continue;
              if (skipped++ < offset) continue;
              selected.push({ name: item.name.slice(prefix.length), id: item.id || item.name });
              if (selected.length >= limit) return selected;
            }
            page = data.nextPageToken || "";
          } while (page);
          return selected;
        });
      },
      upload(name: string, bytes: Uint8Array | Blob, options: { contentType?: string; upsert?: boolean } = {}) {
        return result(async () => {
          const actual = await bucket();
          const object = objectName(namespace, name);
          const body = bytes instanceof Blob ? await bytes.arrayBuffer() : new Uint8Array(bytes).buffer;
          await google(`https://storage.googleapis.com/upload/storage/v1/b/${encode(actual)}/o?uploadType=media&name=${encode(object)}${options.upsert ? "" : "&ifGenerationMatch=0"}`, {
            method: "POST", headers: { "content-type": options.contentType || "application/octet-stream" }, body,
          });
          return { path: name };
        });
      },
      download(name: string) {
        return result(async () => {
          const actual = await bucket();
          const response = await google(`https://storage.googleapis.com/storage/v1/b/${encode(actual)}/o/${encode(objectName(namespace, name))}?alt=media`);
          return response.blob();
        });
      },
      createSignedUrl(name: string, seconds: number) {
        return result(async () => ({ signedUrl: await signedStorageUrl(namespace, name, seconds) }));
      },
      createSignedUrls(names: string[], seconds: number) {
        return result(async () => {
          if (names.length > 100) throw new Error("midias_limite_excedido");
          return Promise.all(names.map(async name => ({ path: name, signedUrl: await signedStorageUrl(namespace, name, seconds) })));
        });
      },
      remove(names: string[]) {
        return result(async () => {
          const actual = await bucket();
          for (const name of names) {
            try { await google(`https://storage.googleapis.com/storage/v1/b/${encode(actual)}/o/${encode(objectName(namespace, name))}`, { method: "DELETE" }); }
            catch (e) { if (!(e instanceof Error) || e.message !== "storage_http_404") throw e; }
          }
          return names.map(name => ({ name }));
        });
      },
    };
  },
};
