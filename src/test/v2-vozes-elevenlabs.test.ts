import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  falhaDaResposta,
  falhaDoErro,
  msgElevenLabs,
} from "@/features/servidor/chave-elevenlabs";
import { FalhaDeRede, TempoEsgotado, type Fetch } from "@/features/servidor/http";
import {
  conferirVozElevenLabs,
  ELEVENLABS_VOZ,
  ELEVENLABS_VOZES,
  listarVozesElevenLabs,
  MAX_PAGINAS_VOZES,
} from "@/features/servidor/vozes-elevenlabs";
import type { ErroVozes } from "@/features/servidor/vozes-tipos";

// Chave falsa, longa e única, para provar que nunca aparece em nada que sai.
const CHAVE = "sk_teste_1234567890abcdTESTEelevenlabsZZZZ";
const PRIMEIRA = `${ELEVENLABS_VOZES}?page_size=100&include_total_count=false`;

type Chamada = { url: string; init: RequestInit };
type Resposta = { status: number; corpo?: unknown };

function resposta(r: Resposta): Response {
  const texto = r.corpo === undefined ? "" : typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo);
  return { status: r.status, text: async () => texto } as unknown as Response;
}

/** fetch falso: devolve as respostas em ordem e guarda cada chamada. */
function fetchFalso(...respostas: Resposta[]): { fetch: Fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  let i = 0;
  const fetch: Fetch = async (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (!r) throw new Error("sem resposta configurada");
    return resposta(r);
  };
  return { fetch, chamadas };
}

/** fetch que só termina quando o prazo aborta (e cita a chave no erro, de propósito). */
function fetchPendurado(chave: string): { fetch: Fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const fetch: Fetch = (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    return new Promise<Response>((_ok, falhar) => {
      init?.signal?.addEventListener("abort", () => falhar(new Error(`abortado ${chave}`)));
    });
  };
  return { fetch, chamadas };
}

function cabecalhos(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

/** Uma voz do /v2/voices, com os campos que a ElevenLabs manda. */
function voz(id: string, nome: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    voice_id: id,
    name: nome,
    description: "descrição",
    category: "premade",
    labels: {},
    verified_languages: [],
    preview_url: `https://storage.googleapis.com/previa/${id}.mp3`,
    ...extra,
  };
}

/** Uma página do /v2/voices. */
function pagina(voices: unknown[], proxima?: string): Resposta {
  return {
    status: 200,
    corpo: { voices, has_more: proxima !== undefined, total_count: 0, next_page_token: proxima ?? null },
  };
}

let espioes: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  espioes = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
  ];
});
afterEach(() => {
  // nada vai para log, nem a chave nem outra coisa
  for (const e of espioes) expect(e).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function semChave(resultado: unknown) {
  const json = JSON.stringify(resultado) ?? "";
  expect(json).not.toContain(CHAVE);
  // nem um pedaço do meio da chave
  expect(json).not.toContain(CHAVE.slice(8, -4));
}

function vozesDe(res: Awaited<ReturnType<typeof listarVozesElevenLabs>>) {
  if (!res.ok) throw new Error(`esperava ok, veio ${res.erro}`);
  return res.vozes;
}

describe("chave-elevenlabs: as peças exportadas", () => {
  it("falhaDaResposta: 2xx dá null e cada status segue a tabela", () => {
    expect(falhaDaResposta({ status: 200, corpo: {} })).toBeNull();
    expect(falhaDaResposta({ status: 204, corpo: null })).toBeNull();
    expect(falhaDaResposta({ status: 401, corpo: { detail: { status: "invalid_api_key" } } })).toEqual(
      msgElevenLabs.chaveInvalida(),
    );
    expect(falhaDaResposta({ status: 401, corpo: { detail: { status: "missing_permissions" } } })).toEqual(
      msgElevenLabs.semAcessos(),
    );
    expect(falhaDaResposta({ status: 401, corpo: { detail: { status: "quota_exceeded" } } })).toEqual(
      msgElevenLabs.semCredito(),
    );
    expect(falhaDaResposta({ status: 403, corpo: null })).toEqual(msgElevenLabs.bloqueada());
    expect(falhaDaResposta({ status: 429, corpo: null })).toEqual(msgElevenLabs.muitas());
    expect(falhaDaResposta({ status: 500, corpo: null })).toEqual(msgElevenLabs.fora());
    expect(falhaDaResposta({ status: 302, corpo: null })).toEqual(msgElevenLabs.fora());
  });

  it("falhaDoErro: tempo, rede e outro erro, sem a mensagem original", () => {
    expect(falhaDoErro(new TempoEsgotado())).toEqual(msgElevenLabs.tempo());
    expect(falhaDoErro(new FalhaDeRede())).toEqual(msgElevenLabs.semRede());
    const outro = falhaDoErro(new Error(`quebrou ${CHAVE}`));
    expect(outro).toEqual(msgElevenLabs.fora());
    semChave(outro);
  });
});

describe("listarVozesElevenLabs: o pedido", () => {
  it("1ª página: GET com page_size=100 e include_total_count=false, xi-api-key aparada, sem Authorization", async () => {
    const { fetch, chamadas } = fetchFalso(pagina([voz("voz1", "Ana")]));
    const res = await listarVozesElevenLabs(`  ${CHAVE}\n`, { fetch });
    expect(res.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0]!;
    expect(ELEVENLABS_VOZES).toBe("https://api.elevenlabs.io/v2/voices");
    expect(c.url).toBe("https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false");
    expect(c.url).not.toContain("next_page_token");
    expect(c.init.method).toBe("GET");
    const h = cabecalhos(c.init);
    expect(h["xi-api-key"]).toBe(CHAVE);
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    expect(c.init.redirect).toBe("manual");
  });

  it("2ª página leva o next_page_token da 1ª; as páginas dividem o mesmo prazo", async () => {
    const { fetch, chamadas } = fetchFalso(
      pagina([voz("voz1", "Ana")], "tok/en+1"),
      pagina([voz("voz2", "Bia")]),
    );
    const res = await listarVozesElevenLabs(CHAVE, { fetch });
    expect(vozesDe(res).map((v) => v.id)).toEqual(["voz1", "voz2"]);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.url).toBe(`${PRIMEIRA}&next_page_token=${encodeURIComponent("tok/en+1")}`);
    expect(cabecalhos(chamadas[1]!.init)["xi-api-key"]).toBe(CHAVE);
    // um prazo só (abrirPrazo uma vez): o mesmo sinal nas duas páginas
    expect(chamadas[1]!.init.signal).toBe(chamadas[0]!.init.signal);
  });

  it(`corta em ${MAX_PAGINAS_VOZES} páginas, mesmo com has_more`, async () => {
    expect(MAX_PAGINAS_VOZES).toBe(3);
    const { fetch, chamadas } = fetchFalso(
      pagina([voz("voz1", "Ana")], "t1"),
      pagina([voz("voz2", "Bia")], "t2"),
      pagina([voz("voz3", "Cris")], "t3"),
      pagina([voz("voz4", "Duda")], "t4"),
    );
    const res = await listarVozesElevenLabs(CHAVE, { fetch });
    expect(chamadas).toHaveLength(3);
    expect(chamadas[2]!.url).toContain("next_page_token=t2");
    expect(vozesDe(res).map((v) => v.id)).toEqual(["voz1", "voz2", "voz3"]);
  });

  it("para quando has_more é false ou falta o next_page_token", async () => {
    const semToken = fetchFalso(
      { status: 200, corpo: { voices: [voz("voz1", "Ana")], has_more: true, next_page_token: null } },
      pagina([voz("voz2", "Bia")]),
    );
    await listarVozesElevenLabs(CHAVE, { fetch: semToken.fetch });
    expect(semToken.chamadas).toHaveLength(1);

    const semMais = fetchFalso(
      { status: 200, corpo: { voices: [voz("voz1", "Ana")], has_more: false, next_page_token: "t1" } },
      pagina([voz("voz2", "Bia")]),
    );
    await listarVozesElevenLabs(CHAVE, { fetch: semMais.fetch });
    expect(semMais.chamadas).toHaveLength(1);
  });

  it("chave vazia vira chave_invalida sem chamar a ElevenLabs", async () => {
    const { fetch, chamadas } = fetchFalso(pagina([]));
    for (const vazia of ["", "   ", "\n\t"]) {
      const res = await listarVozesElevenLabs(vazia, { fetch });
      expect(res).toEqual(msgElevenLabs.chaveVazia());
      expect(res).toMatchObject({ ok: false, erro: "chave_invalida" });
    }
    expect(chamadas).toHaveLength(0);
  });
});

describe("listarVozesElevenLabs: cada voz", () => {
  it("pula a voz sem voice_id, com id fora do formato ou sem nome", async () => {
    const { fetch } = fetchFalso(
      pagina([
        voz("boa_1-A", "Boa"),
        { name: "Sem id" },
        voz("", "Id vazio"),
        voz("tem espaço", "Id com espaço"),
        voz("a/b", "Id com barra"),
        voz("x".repeat(65), "Id longo"),
        { voice_id: 123, name: "Id número" },
        voz("semnome", ""),
        voz("nomebranco", "   "),
        { voice_id: "nomenulo", name: null },
      ]),
    );
    const vozes = vozesDe(await listarVozesElevenLabs(CHAVE, { fetch }));
    expect(vozes.map((v) => v.id)).toEqual(["boa_1-A"]);
  });

  it("apara o nome e corta em 120 caracteres", async () => {
    const longo = "N".repeat(130);
    const { fetch } = fetchFalso(pagina([voz("voz1", "  Ana  "), voz("voz2", longo)]));
    const vozes = vozesDe(await listarVozesElevenLabs(CHAVE, { fetch }));
    expect(vozes.find((v) => v.id === "voz1")?.nome).toBe("Ana");
    expect(vozes.find((v) => v.id === "voz2")?.nome).toBe("N".repeat(120));
  });

  it("detalhe traduz gender e accent conhecidos, mantém o desconhecido e fica null sem rótulo", async () => {
    const { fetch } = fetchFalso(
      pagina([
        voz("v1", "A1", { labels: { gender: "female", accent: "brazilian" } }),
        voz("v2", "A2", { labels: { gender: "male", accent: "british" } }),
        voz("v3", "A3", { labels: { gender: "neutral", accent: "american" } }),
        voz("v4", "A4", { labels: { gender: "Female", accent: "portuguese" } }),
        voz("v5", "A5", { labels: { accent: "us southern" } }),
        voz("v6", "A6", { labels: {} }),
        voz("v7", "A7", { labels: null }),
      ]),
    );
    const vozes = vozesDe(await listarVozesElevenLabs(CHAVE, { fetch }));
    const detalhe = (id: string) => vozes.find((v) => v.id === id)?.detalhe;
    expect(detalhe("v1")).toBe("Feminina · brasileira");
    expect(detalhe("v2")).toBe("Masculina · britânica");
    expect(detalhe("v3")).toBe("Neutra · americana");
    expect(detalhe("v4")).toBe("Feminina · portuguesa");
    expect(detalhe("v5")).toBe("us southern");
    expect(detalhe("v6")).toBeNull();
    expect(detalhe("v7")).toBeNull();
  });

  it("portugues vem do verified_languages ou do labels.language", async () => {
    const { fetch } = fetchFalso(
      pagina([
        voz("v1", "A1", { verified_languages: [{ language: "en" }, { language: "pt", locale: "pt-BR" }] }),
        voz("v2", "A2", { labels: { language: "pt" } }),
        voz("v3", "A3", { verified_languages: [{ language: "en", locale: "en-US" }], labels: { language: "en" } }),
        voz("v4", "A4", { verified_languages: null }),
      ]),
    );
    const vozes = vozesDe(await listarVozesElevenLabs(CHAVE, { fetch }));
    const pt = (id: string) => vozes.find((v) => v.id === id)?.portugues;
    expect(pt("v1")).toBe(true);
    expect(pt("v2")).toBe(true);
    expect(pt("v3")).toBe(false);
    expect(pt("v4")).toBe(false);
  });

  it("prévia: a do pt-BR primeiro, depois outra em pt, depois a geral; só https", async () => {
    const { fetch } = fetchFalso(
      pagina([
        voz("v1", "A1", {
          preview_url: "https://geral/v1.mp3",
          verified_languages: [
            { language: "en", locale: "en-US", preview_url: "https://en/v1.mp3" },
            { language: "pt", locale: "pt-PT", preview_url: "https://ptpt/v1.mp3" },
            { language: "pt", locale: "pt-BR", preview_url: "https://ptbr/v1.mp3" },
          ],
        }),
        voz("v2", "A2", {
          preview_url: "https://geral/v2.mp3",
          verified_languages: [{ language: "pt", locale: "pt-PT", preview_url: "https://ptpt/v2.mp3" }],
        }),
        voz("v3", "A3", {
          preview_url: "https://geral/v3.mp3",
          verified_languages: [{ language: "pt", locale: "pt-BR", preview_url: null }],
        }),
        voz("v4", "A4", {
          preview_url: "https://geral/v4.mp3",
          verified_languages: [{ language: "pt", locale: "pt-BR", preview_url: "http://ptbr/v4.mp3" }],
        }),
        voz("v5", "A5", { preview_url: "http://geral/v5.mp3" }),
        voz("v6", "A6", { preview_url: "javascript:alert(1)" }),
        voz("v7", "A7", { preview_url: null }),
        voz("v8", "A8", { preview_url: "não é url" }),
      ]),
    );
    const vozes = vozesDe(await listarVozesElevenLabs(CHAVE, { fetch }));
    const previa = (id: string) => vozes.find((v) => v.id === id)?.previa;
    expect(previa("v1")).toBe("https://ptbr/v1.mp3");
    expect(previa("v2")).toBe("https://ptpt/v2.mp3");
    expect(previa("v3")).toBe("https://geral/v3.mp3");
    // a de pt é http: não vale, cai para a geral
    expect(previa("v4")).toBe("https://geral/v4.mp3");
    expect(previa("v5")).toBeNull();
    expect(previa("v6")).toBeNull();
    expect(previa("v7")).toBeNull();
    expect(previa("v8")).toBeNull();
  });

  it("ordem: português primeiro, depois o nome em pt-BR", async () => {
    const { fetch } = fetchFalso(
      pagina(
        [
          voz("v1", "Zeca"),
          voz("v2", "Ágata", { labels: { language: "pt" } }),
          voz("v3", "beto"),
          voz("v4", "Bruna", { verified_languages: [{ language: "pt" }] }),
        ],
        "t1",
      ),
      pagina([voz("v5", "Alice"), voz("v6", "Érica", { labels: { language: "pt-BR" } })]),
    );
    const vozes = vozesDe(await listarVozesElevenLabs(CHAVE, { fetch }));
    expect(vozes.map((v) => v.nome)).toEqual(["Ágata", "Bruna", "Érica", "Alice", "beto", "Zeca"]);
  });

  it("a mesma voz em duas páginas entra uma vez", async () => {
    const { fetch } = fetchFalso(pagina([voz("v1", "Ana")], "t1"), pagina([voz("v1", "Ana"), voz("v2", "Bia")]));
    const vozes = vozesDe(await listarVozesElevenLabs(CHAVE, { fetch }));
    expect(vozes.map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("devolve só os campos do contrato", async () => {
    const { fetch } = fetchFalso(pagina([voz("v1", "Ana", { labels: { gender: "female" } })]));
    const vozes = vozesDe(await listarVozesElevenLabs(CHAVE, { fetch }));
    expect(vozes).toEqual([
      { id: "v1", nome: "Ana", detalhe: "Feminina", portugues: false, previa: "https://storage.googleapis.com/previa/v1.mp3" },
    ]);
  });

  it("lista vazia é ok com vozes []", async () => {
    const { fetch } = fetchFalso(pagina([]));
    expect(await listarVozesElevenLabs(CHAVE, { fetch })).toEqual({ ok: true, vozes: [] });
  });
});

describe("listarVozesElevenLabs: recusas", () => {
  async function falhaCom(respostas: Resposta[], erro: ErroVozes, mensagem: string) {
    const { fetch } = fetchFalso(...respostas);
    const res = await listarVozesElevenLabs(CHAVE, { fetch });
    expect(res).toEqual({ ok: false, erro, mensagem });
    semChave(res);
  }

  it("401 missing_permissions (sem o acesso Voices) vira sem_permissao", async () => {
    await falhaCom(
      [{ status: 401, corpo: { detail: { status: "missing_permissions", message: "missing voices_read" } } }],
      "sem_permissao",
      msgElevenLabs.semAcessos().mensagem,
    );
  });

  it("401 invalid_api_key, 401 quota_exceeded, 403, 429 e 500 seguem a tabela", async () => {
    await falhaCom([{ status: 401, corpo: { detail: { status: "invalid_api_key" } } }], "chave_invalida", msgElevenLabs.chaveInvalida().mensagem);
    await falhaCom([{ status: 401, corpo: { detail: { status: "quota_exceeded" } } }], "sem_credito", msgElevenLabs.semCredito().mensagem);
    await falhaCom([{ status: 403 }], "sem_permissao", msgElevenLabs.bloqueada().mensagem);
    await falhaCom([{ status: 429 }], "provedor_fora", msgElevenLabs.muitas().mensagem);
    await falhaCom([{ status: 500, corpo: "<html>erro</html>" }], "provedor_fora", msgElevenLabs.fora().mensagem);
  });

  it("2xx sem a lista voices vira provedor_fora", async () => {
    await falhaCom([{ status: 200, corpo: { detail: "?" } }], "provedor_fora", msgElevenLabs.fora().mensagem);
    await falhaCom([{ status: 200, corpo: "texto" }], "provedor_fora", msgElevenLabs.fora().mensagem);
  });

  it("uma falha na 2ª página derruba a lista", async () => {
    await falhaCom([pagina([voz("v1", "Ana")], "t1"), { status: 429 }], "provedor_fora", msgElevenLabs.muitas().mensagem);
  });

  it("tempo esgotado vira tempo_esgotado", async () => {
    const { fetch, chamadas } = fetchPendurado(CHAVE);
    const res = await listarVozesElevenLabs(CHAVE, { fetch, prazoMs: 20 });
    expect(chamadas).toHaveLength(1);
    expect(res).toEqual(msgElevenLabs.tempo());
    semChave(res);
  });

  it("falha de rede vira provedor_fora, sem a mensagem original", async () => {
    const fetch: Fetch = async () => {
      throw new TypeError(`fetch failed ${CHAVE}`);
    };
    const res = await listarVozesElevenLabs(CHAVE, { fetch });
    expect(res).toEqual(msgElevenLabs.semRede());
    semChave(res);
  });
});

describe("conferirVozElevenLabs", () => {
  it("GET em /v1/voices/<id> com xi-api-key aparada, sem Authorization; o nome vem da resposta", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { voice_id: "abc_DEF-9", name: "  Ana Clara  " } });
    const res = await conferirVozElevenLabs(` ${CHAVE} `, "abc_DEF-9", { fetch });
    expect(res).toEqual({ ok: true, voz: { id: "abc_DEF-9", nome: "Ana Clara" } });
    expect(ELEVENLABS_VOZ).toBe("https://api.elevenlabs.io/v1/voices");
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0]!;
    expect(c.url).toBe("https://api.elevenlabs.io/v1/voices/abc_DEF-9");
    expect(c.init.method).toBe("GET");
    const h = cabecalhos(c.init);
    expect(h["xi-api-key"]).toBe(CHAVE);
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    expect(c.init.redirect).toBe("manual");
  });

  it("sem nome na resposta, o nome é o id; nome longo é cortado em 120", async () => {
    const semNome = fetchFalso({ status: 200, corpo: { voice_id: "v1", name: "  " } });
    expect(await conferirVozElevenLabs(CHAVE, "v1", { fetch: semNome.fetch })).toEqual({
      ok: true,
      voz: { id: "v1", nome: "v1" },
    });
    const longo = fetchFalso({ status: 200, corpo: { voice_id: "v1", name: "x".repeat(200) } });
    const res = await conferirVozElevenLabs(CHAVE, "v1", { fetch: longo.fetch });
    expect(res.ok && res.voz.nome).toBe("x".repeat(120));
  });

  it("2xx sem voice_id vira provedor_fora", async () => {
    const { fetch } = fetchFalso({ status: 200, corpo: { name: "Ana" } });
    expect(await conferirVozElevenLabs(CHAVE, "v1", { fetch })).toEqual(msgElevenLabs.fora());
  });

  it("id fora do formato vira voz_nao_encontrada sem pedido", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: { voice_id: "x", name: "x" } });
    for (const id of ["", "a b", "../user", "a/b", "x".repeat(65), "ação", "v1?x=1"]) {
      const res = await conferirVozElevenLabs(CHAVE, id, { fetch });
      expect(res).toMatchObject({ ok: false, erro: "voz_nao_encontrada" });
    }
    expect(chamadas).toHaveLength(0);
  });

  it("chave vazia vira chave_invalida sem pedido", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    expect(await conferirVozElevenLabs("  ", "v1", { fetch })).toEqual(msgElevenLabs.chaveVazia());
    expect(chamadas).toHaveLength(0);
  });

  it("404 vira voz_nao_encontrada com a mensagem fixa", async () => {
    const { fetch } = fetchFalso({ status: 404, corpo: { detail: { status: "not_found" } } });
    const res = await conferirVozElevenLabs(CHAVE, "v1", { fetch });
    expect(res).toEqual({
      ok: false,
      erro: "voz_nao_encontrada",
      mensagem: "A voz escolhida não existe mais na conta. Escolha outra voz.",
    });
  });

  it("400 e 422 com detail.status voice_not_found viram voz_nao_encontrada; sem ele, provedor_fora", async () => {
    for (const status of [400, 422]) {
      const { fetch } = fetchFalso({ status, corpo: { detail: { status: "voice_not_found", message: "x" } } });
      expect(await conferirVozElevenLabs(CHAVE, "v1", { fetch })).toMatchObject({ ok: false, erro: "voz_nao_encontrada" });
    }
    const { fetch } = fetchFalso({ status: 400, corpo: { detail: { status: "invalid_request" } } });
    expect(await conferirVozElevenLabs(CHAVE, "v1", { fetch })).toEqual(msgElevenLabs.fora());
  });

  it("401 sem permissão, 403, 429, tempo e rede seguem a tabela", async () => {
    const casos: [Resposta, ReturnType<typeof falhaDoErro>][] = [
      [{ status: 401, corpo: { detail: { status: "missing_permissions" } } }, msgElevenLabs.semAcessos()],
      [{ status: 401, corpo: { detail: { status: "invalid_api_key" } } }, msgElevenLabs.chaveInvalida()],
      [{ status: 403 }, msgElevenLabs.bloqueada()],
      [{ status: 429 }, msgElevenLabs.muitas()],
      [{ status: 503 }, msgElevenLabs.fora()],
    ];
    for (const [r, esperado] of casos) {
      const { fetch } = fetchFalso(r);
      expect(await conferirVozElevenLabs(CHAVE, "v1", { fetch })).toEqual(esperado);
    }
    const pendurado = fetchPendurado(CHAVE);
    expect(await conferirVozElevenLabs(CHAVE, "v1", { fetch: pendurado.fetch, prazoMs: 20 })).toEqual(msgElevenLabs.tempo());
    const semRede: Fetch = async () => {
      throw new TypeError(`fetch failed ${CHAVE}`);
    };
    const res = await conferirVozElevenLabs(CHAVE, "v1", { fetch: semRede });
    expect(res).toEqual(msgElevenLabs.semRede());
    semChave(res);
  });
});

describe("a chave nunca volta", () => {
  it("lista: nem quando o corpo ecoa a chave nos nomes, nos rótulos e nas prévias", async () => {
    const { fetch } = fetchFalso(
      pagina(
        [
          voz("v1", `Ana ${CHAVE}`, {
            labels: { gender: CHAVE, accent: `sotaque ${CHAVE}` },
            preview_url: `https://previa/${CHAVE}.mp3`,
          }),
          voz(CHAVE, "Id é a chave"),
        ],
        `tok${CHAVE}`,
      ),
      pagina([voz("v2", CHAVE, { verified_languages: [{ language: "pt", locale: "pt-BR", preview_url: `https://pt/${CHAVE}` }] })]),
    );
    const res = await listarVozesElevenLabs(CHAVE, { fetch });
    const vozes = vozesDe(res);
    expect(vozes.length).toBeGreaterThan(0);
    semChave(res);
    for (const v of vozes) semChave(v);
  });

  it("lista: nem nas falhas que ecoam a chave, em nenhum status", async () => {
    const eco = { detail: { status: "invalid_api_key", message: `Invalid API key: ${CHAVE}` } };
    for (const status of [200, 401, 403, 429, 500]) {
      const { fetch } = fetchFalso({ status, corpo: eco });
      semChave(await listarVozesElevenLabs(CHAVE, { fetch }));
    }
    const pendurado = fetchPendurado(CHAVE);
    semChave(await listarVozesElevenLabs(CHAVE, { fetch: pendurado.fetch, prazoMs: 20 }));
  });

  it("conferir: nem no nome ecoado nem nas falhas", async () => {
    const ok = fetchFalso({ status: 200, corpo: { voice_id: "v1", name: `Ana ${CHAVE}` } });
    const res = await conferirVozElevenLabs(` ${CHAVE} `, "v1", { fetch: ok.fetch });
    expect(res.ok).toBe(true);
    semChave(res);
    for (const status of [400, 401, 403, 404, 429, 500]) {
      const { fetch } = fetchFalso({ status, corpo: { detail: { status: "voice_not_found", message: CHAVE } } });
      semChave(await conferirVozElevenLabs(CHAVE, "v1", { fetch }));
    }
  });
});
