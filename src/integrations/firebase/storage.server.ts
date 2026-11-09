import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { enderecoPublicoDoAmbiente, getInstallationConfig } from "./config.server";
import { getServerAccessToken } from "./identity.server";

type StorageError = { code: string; message: string; status?: number };
type Result<T> = { data: T | null; error: StorageError | null };
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const error = (code: string): StorageError => ({ code, message: code });
const objectName = (namespace: string, name: string) => {
  if (namespace !== "midias" || !/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(name)) throw new Error("caminho_midia_invalido");
  return `${namespace}/${name}`;
};

/** Os arquivos de mídia são apagados sozinhos pelo Google depois deste prazo; a transcrição fica no banco. */
export const DIAS_VALIDADE_MIDIA = 30;
/** Caminho público das mídias servidas pelo próprio app, com link temporário assinado. */
export const CAMINHO_MIDIA_PUBLICA = "/api/public/midia/";

/**
 * O bucket das mídias. Com o instalador, é o que ele criou (JANETE_STORAGE_BUCKET). Sem ele, o app publicado usa um
 * bucket próprio, que ele mesmo cria: o nome que o AI Studio grava na configuração (storageBucket) não corresponde a
 * um bucket existente.
 */
async function bucket() {
  const config = await getInstallationConfig();
  const name = process.env["JANETE_STORAGE_BUCKET"] || `janete-midias-${config.projectId}`;
  if (!name || name.length > 63 || !/^[a-z0-9][a-z0-9._-]+$/.test(name)) throw new Error("storage_nao_configurado");
  return name;
}
/** Número do projeto, tirado do appId público (1:<número>:web:...). */
async function numeroDoProjeto(): Promise<string | null> {
  return /^\d+:(\d+):/.exec((await getInstallationConfig()).appId ?? "")?.[1] ?? null;
}
/** Região do serviço publicado (do endereço *.run.app), para o bucket ficar junto do app. */
function regiaoDoServico(): string {
  return /\.([a-z]+-[a-z]+\d+)\.run\.app$/.exec(new URL(enderecoPublicoDoAmbiente() ?? "https://local.invalid").hostname)?.[1]?.toUpperCase() ?? "US";
}async function google(url: string, init: RequestInit = {}) {
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
  // Sem o instalador não há permissão de assinatura do Google: o próprio app publicado serve o arquivo.
  if (!serviceAccount) return linkDoProprioApp(name, seconds);
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

// ---------- mídia servida pelo próprio app publicado (sem o instalador) ----------

const CAMINHO_UUIDS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Tipos que o navegador pode abrir direto; o resto sai como download, sem interpretar. */
const TIPO_ABERTO = /^(image\/(png|jpeg|webp|gif)|audio\/[a-z0-9.+-]+|video\/(mp4|webm|3gpp|quicktime)|application\/pdf)(\s*;.*)?$/i;
/** Folga do relógio entre quem assina e quem confere, e teto de validade de um link. */
const VALIDADE_MAXIMA_S = 3600 + 120;

async function assinaturaDoLink(caminho: string, expiraEm: number): Promise<string> {
  const { chaveDerivada } = await import("@/features/mensageria/nucleo/chave-derivada.server");
  return createHmac("sha256", await chaveDerivada("janete-midia-link-v1")).update(`${caminho.toLowerCase()}\n${expiraEm}`).digest("hex");
}

/** Link temporário para um arquivo do bucket, servido pelo endereço publicado do app e assinado com a chave da instalação. */
async function linkDoProprioApp(name: string, seconds: number): Promise<string> {
  const origem = enderecoPublicoDoAmbiente();
  if (!origem) throw new Error("storage_identidade_ausente");
  if (!CAMINHO_UUIDS.test(name)) throw new Error("caminho_midia_invalido");
  const expiraEm = Math.floor(Date.now() / 1000) + Math.max(1, Math.min(3600, Math.floor(seconds)));
  return `${origem}${CAMINHO_MIDIA_PUBLICA}${name}?e=${expiraEm}&s=${await assinaturaDoLink(name, expiraEm)}`;
}

const midiaNaoEncontrada = () => new Response("nao_encontrado", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * Entrega um arquivo do bucket a quem tem um link válido (o chat da equipe e o gateway de WhatsApp, que baixa o anexo).
 * Link vencido, adulterado ou de arquivo que não existe: sempre o mesmo 404, sem dizer o motivo.
 */
export async function servirMidiaPublica(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return midiaNaoEncontrada();
    if (!url.pathname.startsWith(CAMINHO_MIDIA_PUBLICA)) return midiaNaoEncontrada();
    const caminho = url.pathname.slice(CAMINHO_MIDIA_PUBLICA.length);
    const expiraEm = Number(url.searchParams.get("e"));
    const assinatura = url.searchParams.get("s") ?? "";
    const agora = Math.floor(Date.now() / 1000);
    if (!CAMINHO_UUIDS.test(caminho) || !Number.isInteger(expiraEm) || expiraEm < agora || expiraEm > agora + VALIDADE_MAXIMA_S ||
        !/^[0-9a-f]{64}$/.test(assinatura)) return midiaNaoEncontrada();
    if (!timingSafeEqual(Buffer.from(assinatura), Buffer.from(await assinaturaDoLink(caminho, expiraEm)))) return midiaNaoEncontrada();
    const faixa = request.headers.get("range");
    const arquivo = await fetch(`https://storage.googleapis.com/storage/v1/b/${encode(await bucket())}/o/${encode(objectName("midias", caminho))}?alt=media`, {
      headers: { authorization: `Bearer ${await getServerAccessToken()}`, ...(faixa && /^bytes=\d*-\d*$/.test(faixa) ? { range: faixa } : {}) },
      signal: AbortSignal.timeout(120_000),
    });
    if (!arquivo.ok) { void arquivo.body?.cancel().catch(() => {}); return midiaNaoEncontrada(); }
    const tipo = arquivo.headers.get("content-type") ?? "";
    const aberto = TIPO_ABERTO.test(tipo);
    const headers = new Headers({
      "content-type": aberto ? tipo : "application/octet-stream",
      "content-disposition": aberto ? "inline" : "attachment",
      "cache-control": "private, max-age=600",
      "x-content-type-options": "nosniff",
      "accept-ranges": "bytes",
    });
    for (const nome of ["content-length", "content-range"]) { const valor = arquivo.headers.get(nome); if (valor) headers.set(nome, valor); }
    if (request.method === "HEAD") { void arquivo.body?.cancel().catch(() => {}); return new Response(null, { status: arquivo.status, headers }); }
    return new Response(arquivo.body, { status: arquivo.status, headers });
  } catch {
    console.error("midia_publica_falhou");
    return midiaNaoEncontrada();
  }
}

/** Compatibilidade de contratos das telas; todas as operações atingem o bucket Google real. */
export const storageAdapter = {
  async getBucket(namespace: string) {
    return result(async () => {
      if (namespace !== "midias") throw new Error("bucket_invalido");
      const actual = await bucket();
      const metadata = await (await google(`https://storage.googleapis.com/storage/v1/b/${encode(actual)}`)).json() as {
        projectNumber?: string | number;
        iamConfiguration?: { publicAccessPrevention?: string; uniformBucketLevelAccess?: { enabled?: boolean } };
      };
      if (metadata.iamConfiguration?.publicAccessPrevention !== "enforced" ||
          metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true) throw new Error("bucket_privado_nao_confirmado");
      // O nome do bucket próprio é previsível: só vale o que está neste projeto, nunca um de mesmo nome criado por outro.
      const numero = await numeroDoProjeto();
      if (!process.env["JANETE_STORAGE_BUCKET"] && (!numero || String(metadata.projectNumber ?? "") !== numero)) throw new Error("bucket_de_outro_projeto");
      return { id: namespace, name: actual, public: false };
    });
  },
  /**
   * Com o instalador, só confere o bucket que ele criou. Sem ele, o app publicado cria o próprio bucket na primeira
   * mídia: privado (acesso público bloqueado, acesso uniforme) e com os arquivos apagados sozinhos depois de
   * DIAS_VALIDADE_MIDIA dias. "Já existe" segue para a conferência.
   */
  async createBucket(namespace: string, _options: { public: boolean }) {
    const existente = await storageAdapter.getBucket(namespace);
    if (!existente.error || existente.error.code !== "storage_http_404" || process.env["JANETE_STORAGE_BUCKET"]) return existente;
    const criado = await result(async () => {
      const config = await getInstallationConfig();
      await google(`https://storage.googleapis.com/storage/v1/b?project=${encode(config.projectId)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: await bucket(), location: regiaoDoServico(), storageClass: "STANDARD",
          iamConfiguration: { publicAccessPrevention: "enforced", uniformBucketLevelAccess: { enabled: true } },
          lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: DIAS_VALIDADE_MIDIA } }] },
        }),
      });
      return true;
    });
    if (criado.error && criado.error.code !== "storage_http_409") return { data: null, error: criado.error };
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
