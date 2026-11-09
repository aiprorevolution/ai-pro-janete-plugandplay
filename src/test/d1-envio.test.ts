import { describe, expect, it, vi } from "vitest";

import { criarEnviador } from "@/features/plataforma/dados/envio";
import { criarClienteFalso, type Consulta, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";

// F1: as regras de envio da 2.1 (envio.ts): id do navegador, status 'na_fila' explícito, sem
// conexao_id, uma por vez e na ordem, o bucket garantido uma vez e a passada de envio no fim.

const CV = "11111111-1111-4111-8111-111111111111";

function idsEmSequencia() {
  let n = 0;
  return () => `00000000-0000-4000-8000-00000000000${++n}`;
}

/** Uma promessa que o teste resolve na hora que quiser. */
function adiada<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((r) => (resolver = r));
  return { promessa, resolver };
}

describe("envio.ts", () => {
  it("o insert vai com o id do navegador, status 'na_fila' explícito e sem conexao_id", async () => {
    const f = criarClienteFalso();
    const pedirEnvio = vi.fn(() => Promise.resolve());
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio, garantirBucketMidias: vi.fn(), gerarId: idsEmSequencia() });

    const r = await env.enviar(CV, { tipo: "texto", texto: "  Olá!  " });

    expect(r).toEqual({ ok: true, id: "00000000-0000-4000-8000-000000000001" });
    const insert = f.consultas.find((c) => c.op === "insert")!;
    expect(insert.tabela).toBe("mensagens");
    const linha = insert.valor as Record<string, unknown>;
    expect(linha).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      conversa_id: CV,
      direcao: "saida",
      origem: "humano_tela",
      tipo: "texto",
      texto: "Olá!",
      status: "na_fila",
      midia_caminho: null,
    });
    expect("conexao_id" in linha).toBe(false);
  });

  it("texto vazio e sem anexo: não grava nada", async () => {
    const f = criarClienteFalso();
    const pedirEnvio = vi.fn(() => Promise.resolve());
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio, garantirBucketMidias: vi.fn() });
    expect(await env.enviar(CV, { tipo: "texto", texto: "   " })).toEqual({ ok: true });
    expect(f.consultas).toHaveLength(0);
    expect(pedirEnvio).not.toHaveBeenCalled();
  });

  it("uma por vez, na ordem: o 2º insert só começa depois que o 1º respondeu", async () => {
    const pendentes: { c: Consulta; resposta: ReturnType<typeof adiada<Resposta>> }[] = [];
    const f = criarClienteFalso({
      insert: (c) => {
        const resposta = adiada<Resposta>();
        pendentes.push({ c, resposta });
        return resposta.promessa;
      },
    });
    const pedirEnvio = vi.fn(() => Promise.resolve());
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio, garantirBucketMidias: vi.fn(), gerarId: idsEmSequencia() });

    const p1 = env.enviar(CV, { tipo: "texto", texto: "primeira" });
    const p2 = env.enviar(CV, { tipo: "texto", texto: "segunda" });
    const p3 = env.enviar(CV, { tipo: "texto", texto: "terceira" });

    await vi.waitFor(() => expect(pendentes).toHaveLength(1));
    // a 2ª ainda não foi ao banco
    await Promise.resolve();
    expect(pendentes).toHaveLength(1);
    expect((pendentes[0]!.c.valor as { texto: string }).texto).toBe("primeira");

    pendentes[0]!.resposta.resolver({ data: null, error: null });
    await vi.waitFor(() => expect(pendentes).toHaveLength(2));
    expect((pendentes[1]!.c.valor as { texto: string }).texto).toBe("segunda");
    expect(pedirEnvio).not.toHaveBeenCalled();

    pendentes[1]!.resposta.resolver({ data: null, error: null });
    await vi.waitFor(() => expect(pendentes).toHaveLength(3));
    pendentes[2]!.resposta.resolver({ data: null, error: null });

    const rs = await Promise.all([p1, p2, p3]);
    expect(rs.map((r) => r.ok && r.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]);
    // depois do último insert, uma passada só
    expect(pedirEnvio).toHaveBeenCalledTimes(1);
  });

  it("a passada de envio não é esperada: a resposta volta mesmo com o servidor demorando", async () => {
    const f = criarClienteFalso();
    const pedirEnvio = vi.fn(() => new Promise<never>(() => {}));
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio, garantirBucketMidias: vi.fn() });
    const r = await env.enviar(CV, { tipo: "texto", texto: "oi" });
    expect(r.ok).toBe(true);
    expect(pedirEnvio).toHaveBeenCalledTimes(1);
  });

  it("a passada que falha não muda o resultado", async () => {
    const f = criarClienteFalso();
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio: () => Promise.reject(new Error("caiu")), garantirBucketMidias: vi.fn() });
    expect((await env.enviar(CV, { tipo: "texto", texto: "oi" })).ok).toBe(true);
  });

  it("a recusa do banco (sem conexão ativa) volta traduzida, e a fila segue", async () => {
    let n = 0;
    const f = criarClienteFalso({
      insert: () => (++n === 1 ? { data: null, error: { code: "P0001", message: "sem_conexao_ativa" } } : undefined),
    });
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio: vi.fn(() => Promise.resolve()), garantirBucketMidias: vi.fn() });
    const [a, b] = await Promise.all([
      env.enviar(CV, { tipo: "texto", texto: "1" }),
      env.enviar(CV, { tipo: "texto", texto: "2" }),
    ]);
    expect(a).toEqual({ ok: false, erro: "sem_conexao_ativa" });
    expect(b.ok).toBe(true);
  });

  it("anexo: o bucket é garantido uma vez, o arquivo sobe em {conversa_id}/{id} antes do insert", async () => {
    const f = criarClienteFalso();
    const garantirBucketMidias = vi.fn(() => Promise.resolve({ ok: true }));
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio: vi.fn(() => Promise.resolve()), garantirBucketMidias, gerarId: idsEmSequencia() });
    const arquivo = new File(["oi"], "foto.jpg", { type: "image/jpeg" });

    await env.enviar(CV, { tipo: "imagem", arquivo });
    await env.enviar(CV, { tipo: "imagem", arquivo, texto: "legenda" });

    expect(garantirBucketMidias).toHaveBeenCalledTimes(1);
    expect(f.uploads.map((u) => [u.bucket, u.caminho])).toEqual([
      ["midias", `${CV}/00000000-0000-4000-8000-000000000001`],
      ["midias", `${CV}/00000000-0000-4000-8000-000000000002`],
    ]);
    expect(f.uploads[0]!.opcoes).toMatchObject({ contentType: "image/jpeg", upsert: false });
    const linha = f.consultas.find((c) => c.op === "insert")!.valor as Record<string, unknown>;
    expect(linha).toMatchObject({
      tipo: "imagem",
      status: "na_fila",
      midia_caminho: `${CV}/00000000-0000-4000-8000-000000000001`,
      midia_nome: "foto.jpg",
      midia_mime: "image/jpeg",
      midia_tamanho: 2,
    });
  });

  it("o bucket que falhou é tentado de novo no próximo anexo, e nada é gravado", async () => {
    const f = criarClienteFalso();
    const garantirBucketMidias = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, erro: "sem_acesso" })
      .mockResolvedValue({ ok: true });
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio: vi.fn(() => Promise.resolve()), garantirBucketMidias });
    const arquivo = new Blob(["x"], { type: "audio/ogg" });

    expect(await env.enviar(CV, { tipo: "audio", arquivo })).toEqual({ ok: false, erro: "sem_acesso" });
    expect(f.uploads).toHaveLength(0);
    expect(f.consultas).toHaveLength(0);
    expect((await env.enviar(CV, { tipo: "audio", arquivo })).ok).toBe(true);
    expect(garantirBucketMidias).toHaveBeenCalledTimes(2);
  });

  it("o upload que falha não grava a mensagem; o insert que falha não tenta apagar o arquivo (a RLS não deixa)", async () => {
    const f = criarClienteFalso({ upload: () => ({ data: null, error: { message: "Payload too large", statusCode: "413" } }) });
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio: vi.fn(() => Promise.resolve()), garantirBucketMidias: vi.fn() });
    const r = await env.enviar(CV, { tipo: "documento", arquivo: new Blob(["x"]) });
    expect(r).toEqual({ ok: false, erro: "falha", detalhe: "Payload too large" });
    expect(f.consultas).toHaveLength(0);

    const g = criarClienteFalso({ insert: () => ({ data: null, error: { code: "P0001", message: "janela_fechada" } }) });
    const env2 = criarEnviador({ cliente: g.cliente, pedirEnvio: vi.fn(() => Promise.resolve()), garantirBucketMidias: vi.fn(), gerarId: () => "id-1" });
    expect(await env2.enviar(CV, { tipo: "documento", arquivo: new Blob(["x"]) })).toEqual({ ok: false, erro: "janela_fechada" });
    // storage.objects não tem regra de apagar para o authenticated: a remoção falharia em silêncio.
    expect(g.removidos).toEqual([]);
  });

  it("confere a conexão e a janela antes de subir o arquivo: a recusa volta sem upload nem insert", async () => {
    const f = criarClienteFalso();
    const garantir = vi.fn(() => Promise.resolve({ ok: true }));
    const conferir = vi.fn((): { ok: false; erro: "janela_fechada" } | null => ({ ok: false, erro: "janela_fechada" }));
    const env = criarEnviador({ cliente: f.cliente, pedirEnvio: vi.fn(() => Promise.resolve()), garantirBucketMidias: garantir, conferirAntesDoArquivo: conferir });
    expect(await env.enviar(CV, { tipo: "documento", arquivo: new Blob(["x"]) })).toEqual({ ok: false, erro: "janela_fechada" });
    expect(conferir).toHaveBeenCalledWith(CV);
    expect(f.uploads).toHaveLength(0);
    expect(f.consultas).toHaveLength(0);
    expect(garantir).not.toHaveBeenCalled();
    // Texto sem arquivo não passa pela conferência (o banco confere no insert).
    expect((await env.enviar(CV, { tipo: "texto", texto: "oi" })).ok).toBe(true);
    expect(conferir).toHaveBeenCalledTimes(1);
    // Sem recusa, sobe.
    conferir.mockReturnValueOnce(null);
    expect((await env.enviar(CV, { tipo: "documento", arquivo: new Blob(["x"]) })).ok).toBe(true);
    expect(f.uploads).toHaveLength(1);
  });
});
