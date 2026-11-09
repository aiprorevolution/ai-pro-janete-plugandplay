import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ELEVENLABS_USUARIO,
  validarChaveElevenLabs,
  type ErroChaveVoz,
} from "@/features/servidor/chave-elevenlabs";
import type { Fetch } from "@/features/servidor/http";

// Chave falsa, longa e única, para provar que nunca aparece em nada que sai.
const CHAVE = "sk_teste_1234567890abcdTESTEelevenlabsZZZZ";

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

/** Corpo do GET /v1/user com o crédito em `subscription`. */
function usuario(subscription: Record<string, unknown>): Resposta {
  return { status: 200, corpo: { user_id: "usuario-teste", subscription } };
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

async function falhaCom(r: Resposta, erro: ErroChaveVoz, trecho: string) {
  const { fetch, chamadas } = fetchFalso(r);
  const res = await validarChaveElevenLabs(CHAVE, { fetch });
  expect(chamadas).toHaveLength(1);
  expect(res).toMatchObject({ ok: false, erro });
  expect(res?.mensagem).toContain(trecho);
  semChave(res);
  return res;
}

describe("validarChaveElevenLabs: o pedido", () => {
  it("faz GET em /v1/user com xi-api-key aparada, sem Authorization, com sinal e redirect manual", async () => {
    const { fetch, chamadas } = fetchFalso(usuario({ character_limit: 10_000, character_count: 120 }));
    const res = await validarChaveElevenLabs(`  ${CHAVE}\n`, { fetch });
    expect(res).toBeNull();
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0]!;
    expect(c.url).toBe(ELEVENLABS_USUARIO);
    expect(ELEVENLABS_USUARIO).toBe("https://api.elevenlabs.io/v1/user");
    expect(c.init.method).toBe("GET");
    const h = cabecalhos(c.init);
    expect(h["xi-api-key"]).toBe(CHAVE);
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    expect(c.init.redirect).toBe("manual");
  });

  it("chave vazia vira chave_invalida sem chamar a ElevenLabs", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 200, corpo: {} });
    for (const vazia of ["", "   ", "\n\t"]) {
      const res = await validarChaveElevenLabs(vazia, { fetch });
      expect(res).toMatchObject({ ok: false, erro: "chave_invalida" });
      expect(res?.mensagem).toContain("ElevenLabs");
    }
    expect(chamadas).toHaveLength(0);
  });
});

describe("validarChaveElevenLabs: 2xx e o crédito", () => {
  it("200 com crédito sobrando aceita (null)", async () => {
    const { fetch } = fetchFalso(
      usuario({ character_limit: 10_000, character_count: 9_999, can_extend_character_limit: false, max_credit_limit_extension: 0 }),
    );
    expect(await validarChaveElevenLabs(CHAVE, { fetch })).toBeNull();
  });

  it("200 sem subscription, ou sem limite ou contagem, aceita", async () => {
    for (const corpo of [
      { user_id: "usuario-teste" },
      { subscription: { character_count: 500 } },
      { subscription: { character_limit: 500 } },
      null,
    ]) {
      const { fetch } = fetchFalso({ status: 200, corpo: corpo ?? undefined });
      expect(await validarChaveElevenLabs(CHAVE, { fetch })).toBeNull();
    }
  });

  it("sem crédito e max_credit_limit_extension 0 vira sem_credito", async () => {
    await falhaCom(
      usuario({ character_limit: 10_000, character_count: 10_000, max_credit_limit_extension: 0, can_extend_character_limit: true }),
      "sem_credito",
      "A conta da ElevenLabs está sem créditos.",
    );
  });

  it("sem crédito, sem max_credit_limit_extension e can_extend_character_limit false vira sem_credito", async () => {
    const res = await falhaCom(
      usuario({ character_limit: 10_000, character_count: 12_000, can_extend_character_limit: false }),
      "sem_credito",
      "Recarregue a conta ou cole a chave de outra conta.",
    );
    expect(res?.mensagem).toBe(
      "A conta da ElevenLabs está sem créditos. Recarregue a conta ou cole a chave de outra conta.",
    );
  });

  it("sem crédito, mas com extensão \"unlimited\", aceita", async () => {
    const { fetch } = fetchFalso(
      usuario({ character_limit: 10_000, character_count: 10_000, max_credit_limit_extension: "unlimited", can_extend_character_limit: false }),
    );
    expect(await validarChaveElevenLabs(CHAVE, { fetch })).toBeNull();
  });

  it("sem crédito, mas com extensão numérica ou can_extend true, aceita", async () => {
    for (const sub of [
      { character_limit: 10_000, character_count: 10_000, max_credit_limit_extension: 5_000 },
      { character_limit: 10_000, character_count: 10_000, can_extend_character_limit: true },
    ]) {
      const { fetch } = fetchFalso(usuario(sub));
      expect(await validarChaveElevenLabs(CHAVE, { fetch })).toBeNull();
    }
  });

  it("sem crédito e sem nenhum campo de extensão aceita (campos ausentes aceitam)", async () => {
    const { fetch } = fetchFalso(usuario({ character_limit: 10_000, character_count: 10_000 }));
    expect(await validarChaveElevenLabs(CHAVE, { fetch })).toBeNull();
  });
});

describe("validarChaveElevenLabs: recusas", () => {
  it("401 invalid_api_key vira chave_invalida com a mensagem fixa", async () => {
    const res = await falhaCom(
      { status: 401, corpo: { detail: { status: "invalid_api_key", message: "Invalid API key" } } },
      "chave_invalida",
      "A ElevenLabs não reconheceu a chave.",
    );
    expect(res?.mensagem).toBe(
      "A ElevenLabs não reconheceu a chave. Confira se copiou a chave inteira e se ela ainda está ativa na ElevenLabs.",
    );
  });

  it("401 sem detail.status (ou com corpo em texto) vira chave_invalida", async () => {
    await falhaCom({ status: 401 }, "chave_invalida", "não reconheceu a chave");
    await falhaCom({ status: 401, corpo: "Unauthorized" }, "chave_invalida", "não reconheceu a chave");
  });

  it("401 missing_permissions vira sem_permissao com os acessos a ligar", async () => {
    const res = await falhaCom(
      { status: 401, corpo: { detail: { status: "missing_permissions", message: "The API key is missing the permission user_read" } } },
      "sem_permissao",
      "A chave existe, mas não tem os acessos que a Janete usa.",
    );
    expect(res?.mensagem).toBe(
      "A chave existe, mas não tem os acessos que a Janete usa. Na ElevenLabs, edite a chave e ligue User, Text to Speech, Speech to Text e Voices.",
    );
  });

  it("401 quota_exceeded vira sem_credito", async () => {
    await falhaCom(
      { status: 401, corpo: { detail: { status: "quota_exceeded", message: "quota" } } },
      "sem_credito",
      "A conta da ElevenLabs está sem créditos.",
    );
  });

  it("403 vira sem_permissao com a mensagem do bloqueio", async () => {
    const res = await falhaCom({ status: 403, corpo: { detail: "Forbidden" } }, "sem_permissao", "recusou o acesso desta chave");
    expect(res?.mensagem).toBe(
      "A ElevenLabs recusou o acesso desta chave. Confira as permissões e a lista de endereços de IP da chave na ElevenLabs.",
    );
  });

  it("429 vira provedor_fora (chamadas demais)", async () => {
    await falhaCom({ status: 429, corpo: { detail: { status: "too_many_concurrent_requests" } } }, "provedor_fora", "chamadas demais");
  });

  it("500 e outros status viram provedor_fora", async () => {
    await falhaCom({ status: 500 }, "provedor_fora", "não respondeu como esperado");
    await falhaCom({ status: 502, corpo: "<html>Bad Gateway</html>" }, "provedor_fora", "não respondeu como esperado");
    await falhaCom({ status: 302 }, "provedor_fora", "não respondeu como esperado");
  });
});

describe("validarChaveElevenLabs: tempo e rede", () => {
  it("tempo esgotado vira tempo_esgotado", async () => {
    const { fetch, chamadas } = fetchPendurado(CHAVE);
    const res = await validarChaveElevenLabs(CHAVE, { fetch, prazoMs: 20 });
    expect(chamadas).toHaveLength(1);
    expect(res).toMatchObject({ ok: false, erro: "tempo_esgotado" });
    expect(res?.mensagem).toContain("demorou mais de 10 segundos");
    semChave(res);
  });

  it("falha de rede vira provedor_fora, sem a mensagem original", async () => {
    const fetch: Fetch = async () => {
      throw new TypeError(`fetch failed ${CHAVE}`);
    };
    const res = await validarChaveElevenLabs(CHAVE, { fetch });
    expect(res).toMatchObject({ ok: false, erro: "provedor_fora" });
    expect(res?.mensagem).toBe("Não conseguimos falar com a ElevenLabs agora. Tente de novo em alguns minutos.");
    expect(res?.mensagem).not.toContain("fetch failed");
    semChave(res);
  });
});

describe("validarChaveElevenLabs: a chave nunca volta", () => {
  it("nem quando o corpo ecoa a chave, em nenhum status", async () => {
    const eco = { detail: { status: "invalid_api_key", message: `Invalid API key: ${CHAVE}` } };
    for (const status of [200, 401, 403, 429, 500]) {
      const { fetch } = fetchFalso({ status, corpo: eco });
      const res = await validarChaveElevenLabs(CHAVE, { fetch });
      semChave(res);
    }
    // eco com a chave aparada vinda com espaços
    const { fetch } = fetchFalso({ status: 401, corpo: `{"detail":{"status":"invalid_api_key","message":"${CHAVE}"}}` });
    const res = await validarChaveElevenLabs(`  ${CHAVE}  `, { fetch });
    expect(res).toMatchObject({ ok: false, erro: "chave_invalida" });
    semChave(res);
  });
});
