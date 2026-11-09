import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/firebase/store.server", () => ({
  firestoreStore: { runTransaction: vi.fn(async () => { throw new Error("offline"); }) },
}));

import { INSTANCIA_PADRAO, nomeInstancia, validarConexaoLogica, type OpcoesConexao } from "@/features/servidor/conexao";
import type { Fetch } from "@/features/servidor/http";
import type { AdaptadorGateway } from "@/features/mensageria/nucleo/tipos";

// Criar a instância da Evolution pelo "Conectar" (spec-qr-whatsapp, seção 7).

const dubles = vi.hoisted(() => ({
  gravarConexao: vi.fn(),
  carregarConexaoPorExterno: vi.fn(),
  adaptadorDe: vi.fn(),
  real: null as null | ((g: string) => AdaptadorGateway | null),
}));

vi.mock("@/integrations/firebase/client.server", () => ({
  firebaseAdmin: new Proxy(
    {},
    {
      get: () => {
        throw new Error("banco real não pode ser usado");
      },
    },
  ),
}));

vi.mock("@/features/mensageria/nucleo/conexoes.server", () => ({
  gravarConexao: dubles.gravarConexao,
  gravarChaveIA: vi.fn(),
  carregarConexao: vi.fn(),
  carregarConexaoPorExterno: dubles.carregarConexaoPorExterno,
}));

vi.mock("@/features/mensageria/gateways", async (original) => {
  const real = await original<typeof import("@/features/mensageria/gateways")>();
  dubles.real = real.adaptadorDe;
  return { ...real, adaptadorDe: dubles.adaptadorDe };
});

import { camposParaGuardarEvolution } from "@/features/mensageria/gateways/evolution/chave.server";
import { salvarConexaoLogica, type ClienteUsuario, type ContextoUsuario } from "@/features/mensageria/configuracao.server";
import { tokenDaInstanciaEvolution } from "@/features/mensageria/nucleo/token-evolution.server";

const CHAVE_GLOBAL = "EVOchaveGLOBALteste5566778899aabbccEVO";
const SERVIDOR = "https://evolution.suaempresa.com.br";
const CHAVE_SERVICO = "segredo-estavel-ficticio-0123456789abcdef";
const TOKEN_FALSO = "token-proprio-da-janete-TESTE-0123456789";

type Chamada = { url: string; init: RequestInit };
type Resposta = { status: number; corpo?: unknown };

function fetchFalso(...respostas: Resposta[]): { fetch: Fetch; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  let i = 0;
  const fetch: Fetch = async (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    const r = respostas[Math.min(i, respostas.length - 1)];
    i += 1;
    if (!r) throw new Error("sem resposta configurada");
    const texto = r.corpo === undefined ? "" : typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo);
    return { status: r.status, text: async () => texto } as unknown as Response;
  };
  return { fetch, chamadas };
}

const NAO_EXISTE: Resposta = {
  status: 404,
  corpo: { status: 404, error: "Not Found", response: { message: ['The "janete" instance does not exist'] } },
};
const FECHADA: Resposta = { status: 200, corpo: { instance: { instanceName: "janete", state: "close" } } };
const ABERTA: Resposta = { status: 200, corpo: { instance: { instanceName: "janete", state: "open" } } };
const CRIADA: Resposta = {
  status: 201,
  corpo: { instance: { instanceName: "janete", status: "connecting" }, hash: TOKEN_FALSO, qrcode: { base64: "data:image/png;base64,AAAA" } },
};

function opcoesCriar(fetch: Fetch, token = vi.fn(async () => TOKEN_FALSO)): OpcoesConexao & { token: typeof token } {
  return { fetch, criarEvolution: { token }, token };
}

function validar(campos: Record<string, string>, opcoes: OpcoesConexao) {
  return validarConexaoLogica({ gateway: "evolution", campos }, opcoes);
}

// o número do WhatsApp é obrigatório no salvar (spec-qr-whatsapp, seção 8); a validação ignora
const CAMPOS = { numero: "11 98765-4321", serverUrl: `${SERVIDOR}/`, instanceName: "", apiKey: CHAVE_GLOBAL };
/** A resposta do fetchInstances sem o dono (o número fica desconhecido; seção 8). */
const SEM_DONO: Resposta = { status: 200, corpo: [] };

let envAntes: string | undefined;
beforeEach(() => {
  envAntes = process.env["JANETE_MASTER_SECRET"];
  process.env["JANETE_MASTER_SECRET"] = CHAVE_SERVICO;
  vi.clearAllMocks();
});
afterEach(() => {
  if (envAntes === undefined) delete process.env["JANETE_MASTER_SECRET"];
  else process.env["JANETE_MASTER_SECRET"] = envAntes;
});

describe("nome da instância", () => {
  it("vazio vira 'janete'; o digitado vale, sem espaço nas pontas", () => {
    expect(INSTANCIA_PADRAO).toBe("janete");
    expect(nomeInstancia("")).toBe("janete");
    expect(nomeInstancia(undefined)).toBe("janete");
    expect(nomeInstancia("  vendas ")).toBe("vendas");
  });
});

describe("validar a Evolution com a criação ligada (só o Conectar)", () => {
  it("nome vazio e a 'janete' não existe: cria com o corpo e o token certos e segue para o QR", async () => {
    const { fetch, chamadas } = fetchFalso(NAO_EXISTE, CRIADA);
    const o = opcoesCriar(fetch);
    const r = await validar(CAMPOS, o);

    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toBe("instancia_desconectada");
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.url).toBe(`${SERVIDOR}/instance/connectionState/janete`);
    expect(chamadas[1]!.url).toBe(`${SERVIDOR}/instance/create`);
    expect(chamadas[1]!.init.method).toBe("POST");
    expect((chamadas[1]!.init.headers as Record<string, string>)["apikey"]).toBe(CHAVE_GLOBAL);
    expect(JSON.parse(String(chamadas[1]!.init.body))).toEqual({
      instanceName: "janete",
      token: TOKEN_FALSO,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      groupsIgnore: true,
      rejectCall: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    });
    expect(o.token).toHaveBeenCalledWith(SERVIDOR, "janete");
    // nada da credencial nem do token volta
    expect(JSON.stringify(r)).not.toContain(CHAVE_GLOBAL);
    expect(JSON.stringify(r)).not.toContain(TOKEN_FALSO);
  });

  it("o nome digitado que não existe também é criado", async () => {
    const { fetch, chamadas } = fetchFalso(NAO_EXISTE, CRIADA);
    await validar({ ...CAMPOS, instanceName: "vendas-sp" }, opcoesCriar(fetch));
    expect(chamadas[0]!.url).toBe(`${SERVIDOR}/instance/connectionState/vendas-sp`);
    expect(JSON.parse(String(chamadas[1]!.init.body)).instanceName).toBe("vendas-sp");
  });

  it.each([
    ["existe e está fechada", FECHADA, "instancia_desconectada"],
    ["existe e está aberta", ABERTA, "ok"],
  ])("%s: nunca cria (criar um nome em uso apagaria a instância)", async (_n, situacao, esperado) => {
    const { fetch, chamadas } = fetchFalso(situacao);
    const o = opcoesCriar(fetch);
    const r = await validar(CAMPOS, o);
    expect(r.ok ? "ok" : r.erro).toBe(esperado);
    // aberta, a 2ª chamada é o fetchInstances, que lê o número (seção 8)
    expect(chamadas).toHaveLength(esperado === "ok" ? 2 : 1);
    expect(chamadas.some((c) => c.url.endsWith("/instance/create"))).toBe(false);
    expect(o.token).not.toHaveBeenCalled();
  });

  it("um 404 que não diz que a instância não existe (rota que falta) não cria", async () => {
    const { fetch, chamadas } = fetchFalso({ status: 404, corpo: "<html>Not Found</html>" });
    const r = await validar(CAMPOS, opcoesCriar(fetch));
    expect(!r.ok && r.erro).toBe("nao_encontrado");
    expect(chamadas).toHaveLength(1);
  });

  it("sem a opção de criar (QR, conserto, Conferir) nunca cria", async () => {
    const { fetch, chamadas } = fetchFalso(NAO_EXISTE, CRIADA);
    const r = await validar(CAMPOS, { fetch });
    expect(!r.ok && r.erro).toBe("nao_encontrado");
    expect(chamadas).toHaveLength(1);
  });

  it("a chave de uma instância (não a global) no create: a mensagem pede a chave global", async () => {
    const { fetch } = fetchFalso(NAO_EXISTE, { status: 401, corpo: { status: 401, error: "Unauthorized" } });
    const r = await validar(CAMPOS, opcoesCriar(fetch));
    expect(r).toMatchObject({ ok: false, erro: "credencial_invalida", campo: "apiKey" });
    expect(!r.ok && r.mensagem).toMatch(/^Para criar a instância, use a chave global do servidor\. É a AUTHENTICATION_API_KEY, no \.env da Evolution\./);
  });

  it.each([
    // 400: a falha de dentro da criação (a Evolution já desfez a instância)
    [400, "servidor_inacessivel", "serverUrl"],
    [500, "servidor_inacessivel", "serverUrl"],
    [404, "servidor_inacessivel", "serverUrl"],
  ])("create com %i dá %s no campo %s", async (status, erro, campo) => {
    const { fetch } = fetchFalso(NAO_EXISTE, { status, corpo: { status } });
    const r = await validar(CAMPOS, opcoesCriar(fetch));
    expect(r).toMatchObject({ ok: false, erro, campo });
  });

  it("create com 403 (o nome passou a existir): confere a instância e segue com ela, sem criar de novo", async () => {
    const emUso: Resposta = { status: 403, corpo: { status: 403, error: "Forbidden", response: { message: ['This name "janete" is already in use.'] } } };
    const { fetch, chamadas } = fetchFalso(NAO_EXISTE, emUso, FECHADA);
    const r = await validar(CAMPOS, opcoesCriar(fetch));
    expect(!r.ok && r.erro).toBe("instancia_desconectada");
    expect(chamadas.map((c) => c.url)).toEqual([
      `${SERVIDOR}/instance/connectionState/janete`,
      `${SERVIDOR}/instance/create`,
      `${SERVIDOR}/instance/connectionState/janete`,
    ]);
  });

  it("create com 403 e a conferência falhando: falha passageira, sem marcar a chave", async () => {
    const { fetch, chamadas } = fetchFalso(NAO_EXISTE, { status: 403, corpo: {} }, { status: 500 });
    const r = await validar(CAMPOS, opcoesCriar(fetch));
    expect(r).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
    expect(!r.ok && "campo" in r && r.campo).toBeFalsy();
    expect(chamadas).toHaveLength(3);
  });

  it("create com 403 e a conferência caindo por rede: falha passageira, sem marcar a URL", async () => {
    let n = 0;
    const fetch: Fetch = async () => {
      n += 1;
      if (n === 1) return { status: 404, text: async () => JSON.stringify(NAO_EXISTE.corpo) } as unknown as Response;
      if (n === 2) return { status: 403, text: async () => "{}" } as unknown as Response;
      throw new Error("rede");
    };
    const r = await validar(CAMPOS, opcoesCriar(fetch));
    expect(r).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
    expect(!r.ok && "campo" in r && r.campo).toBeFalsy();
    expect(!r.ok && r.mensagem).toMatch(/Já existe uma instância com esse nome/);
  });

  it("o create tem 20 s (e não os 10 s do resto): um create de 15 s ainda vale", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const fetch: Fetch = (_url, init) => {
        n += 1;
        if (n === 1) {
          return Promise.resolve({ status: 404, text: async () => JSON.stringify(NAO_EXISTE.corpo) } as unknown as Response);
        }
        return new Promise<Response>((ok, falhar) => {
          const t = setTimeout(() => ok({ status: 201, text: async () => JSON.stringify(CRIADA.corpo) } as unknown as Response), 15_000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            falhar(new Error("abortado"));
          });
        });
      };
      const pendente = validar(CAMPOS, { fetch, criarEvolution: { token: async () => TOKEN_FALSO } });
      await vi.advanceTimersByTimeAsync(15_000);
      const r = await pendente;
      expect(!r.ok && r.erro).toBe("instancia_desconectada");
      expect(!r.ok && r.mensagem).toMatch(/foi criada/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("licença da 2.4 pendente no create: a mensagem da licença", async () => {
    const { fetch } = fetchFalso(NAO_EXISTE, { status: 503, corpo: { code: "LICENSE_REQUIRED" } });
    const r = await validar(CAMPOS, opcoesCriar(fetch));
    expect(!r.ok && r.mensagem).toMatch(/licença/);
  });

  it("nome com espaço não é criado (a instância que já existe valeria com qualquer nome)", async () => {
    const { fetch, chamadas } = fetchFalso(NAO_EXISTE);
    const r = await validar({ ...CAMPOS, instanceName: "loja centro" }, opcoesCriar(fetch));
    expect(r).toMatchObject({ ok: false, erro: "nao_encontrado", campo: "instanceName" });
    expect(chamadas).toHaveLength(1);
  });

  it("sem o token (falta a variável da cifra): avisa o suporte e não chama o create", async () => {
    const { fetch, chamadas } = fetchFalso(NAO_EXISTE, CRIADA);
    const r = await validar(
      CAMPOS,
      opcoesCriar(
        fetch,
        vi.fn(async () => {
          throw new Error("cifra_indisponivel");
        }),
      ),
    );
    expect(!r.ok && r.mensagem).toMatch(/Avise o suporte/);
    expect(chamadas).toHaveLength(1);
  });

  it("create que não responde em 20 s: tempo esgotado com a frase própria", async () => {
    let n = 0;
    const fetch: Fetch = async (_url, init) => {
      n += 1;
      if (n === 1) return { status: 404, text: async () => JSON.stringify(NAO_EXISTE.corpo) } as unknown as Response;
      return new Promise<Response>((_ok, falhar) => {
        init?.signal?.addEventListener("abort", () => falhar(new Error("abortado")));
      });
    };
    const r = await validar(CAMPOS, { ...opcoesCriar(fetch), prazoMs: 30 });
    expect(r).toMatchObject({ ok: false, erro: "tempo_esgotado" });
    expect(!r.ok && r.mensagem).toMatch(/20 segundos/);
  });
});

describe("o token próprio da instância", () => {
  it("é sempre o mesmo para a mesma base e nome, e muda com qualquer um dos dois", async () => {
    const a = await tokenDaInstanciaEvolution(SERVIDOR, "janete");
    expect(await tokenDaInstanciaEvolution(SERVIDOR, "janete")).toBe(a);
    expect(await tokenDaInstanciaEvolution(SERVIDOR, "vendas")).not.toBe(a);
    expect(await tokenDaInstanciaEvolution("https://outro.servidor.com", "janete")).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toContain(CHAVE_SERVICO);
  });

  it("muda quando a JANETE_MASTER_SECRET muda", async () => {
    const a = await tokenDaInstanciaEvolution(SERVIDOR, "janete");
    process.env["JANETE_MASTER_SECRET"] = `${CHAVE_SERVICO}-outra`;
    expect(await tokenDaInstanciaEvolution(SERVIDOR, "janete")).not.toBe(a);
  });

  it("sem a variável: cifra_indisponivel, sem citar nada", async () => {
    delete process.env["JANETE_MASTER_SECRET"];
    await expect(tokenDaInstanciaEvolution(SERVIDOR, "janete")).rejects.toThrow("cifra_indisponivel");
  });
});

describe("a chave que fica guardada", () => {
  it("instância criada pela Janete (o token próprio abre): guarda o token, não a chave global", async () => {
    const token = await tokenDaInstanciaEvolution(SERVIDOR, "janete");
    const { fetch, chamadas } = fetchFalso(ABERTA);
    const c = await camposParaGuardarEvolution(CAMPOS, { fetch });
    expect(c).toEqual({ ok: true, campos: { ...CAMPOS, instanceName: "janete", apiKey: token } });
    expect((chamadas[0]!.init.headers as Record<string, string>)["apikey"]).toBe(token);
  });

  it.each([
    ["o token é recusado (401: instância de antes)", { status: 401, corpo: { error: "Unauthorized" } }],
    ["o token é recusado (403)", { status: 403, corpo: { error: "Forbidden" } }],
  ])("%s: guarda a chave colada, como antes", async (_n, r) => {
    const { fetch } = fetchFalso(r as Resposta);
    const c = await camposParaGuardarEvolution({ ...CAMPOS, instanceName: "vendas" }, { fetch });
    expect(c).toEqual({ ok: true, campos: { ...CAMPOS, instanceName: "vendas", apiKey: CHAVE_GLOBAL } });
  });

  it.each([
    ["5xx", { status: 502 }],
    ["429", { status: 429 }],
    ["404", { status: 404 }],
  ])("na dúvida (%s): nada é salvo, nem a chave global", async (_n, r) => {
    const { fetch } = fetchFalso(r as Resposta);
    const c = await camposParaGuardarEvolution(CAMPOS, { fetch });
    expect(c).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
    expect(JSON.stringify(c)).not.toContain(CHAVE_GLOBAL);
  });

  it("na dúvida (rede caiu): nada é salvo", async () => {
    const fetch: Fetch = async () => {
      throw new Error("rede");
    };
    const c = await camposParaGuardarEvolution(CAMPOS, { fetch });
    expect(c).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
  });

  it("sem a variável da cifra: fica a colada e o nome efetivo", async () => {
    delete process.env["JANETE_MASTER_SECRET"];
    const { fetch, chamadas } = fetchFalso(ABERTA);
    const c = await camposParaGuardarEvolution(CAMPOS, { fetch });
    expect(c).toEqual({ ok: true, campos: { ...CAMPOS, instanceName: "janete" } });
    expect(chamadas).toHaveLength(0);
  });
});

describe("salvar a conexão da Evolution (Conectar depois do QR)", () => {
  function contexto(): ContextoUsuario {
    const consulta = {
      select: () => consulta,
      eq: () => consulta,
      maybeSingle: async () => ({ data: { id: "9d1c7a20-0000-4000-8000-000000000001" }, error: null }),
    };
    const firebase = {
      rpc: vi.fn(async () => ({ data: true, error: null })),
      from: () => consulta,
    } as unknown as ClienteUsuario;
    return { firebase, userId: "00000000-0000-4000-8000-000000000001" };
  }

  beforeEach(() => {
    const configurarWebhook = vi.fn(async () => {});
    dubles.adaptadorDe.mockImplementation((g: string) => {
      const real = dubles.real?.(g) ?? null;
      return real ? { ...real, configurarWebhook } : null;
    });
    dubles.gravarConexao.mockResolvedValue({ id: "c0ffee00-0000-4000-8000-0000000000aa" });
  });

  it("nome vazio, instância criada pela Janete: grava id_externo 'janete' e o token próprio no lugar da global", async () => {
    const token = await tokenDaInstanciaEvolution(SERVIDOR, "janete");
    // validação (aberta), o número (fetchInstances) e a conferência do token próprio (abre)
    const { fetch } = fetchFalso(ABERTA, SEM_DONO, ABERTA);
    const r = await salvarConexaoLogica(
      contexto(),
      { gateway: "evolution", campos: CAMPOS },
      { origem: "https://janete.exemplo.com.br", fetch },
    );
    expect(r.ok).toBe(true);
    const gravada = dubles.gravarConexao.mock.calls[0]![0] as { id_externo: string; segredos: Record<string, string> };
    expect(gravada.id_externo).toBe("janete");
    expect(gravada.segredos["apiKey"]).toBe(token);
    expect(JSON.stringify(gravada)).not.toContain(CHAVE_GLOBAL);
    expect(JSON.stringify(r)).not.toContain(token);
  });

  it("instância de antes (o token próprio não abre): grava a chave colada", async () => {
    const { fetch } = fetchFalso(ABERTA, SEM_DONO, { status: 401, corpo: { error: "Unauthorized" } });
    const r = await salvarConexaoLogica(
      contexto(),
      { gateway: "evolution", campos: { ...CAMPOS, instanceName: "vendas" } },
      { origem: "https://janete.exemplo.com.br", fetch },
    );
    expect(r.ok).toBe(true);
    const gravada = dubles.gravarConexao.mock.calls[0]![0] as { id_externo: string; segredos: Record<string, string> };
    expect(gravada.id_externo).toBe("vendas");
    expect(gravada.segredos["apiKey"]).toBe(CHAVE_GLOBAL);
  });

  it("a conferência do token falha de forma passageira: nada é gravado e a tela pode tentar de novo", async () => {
    const { fetch } = fetchFalso(ABERTA, SEM_DONO, { status: 502 });
    const r = await salvarConexaoLogica(
      contexto(),
      { gateway: "evolution", campos: CAMPOS },
      { origem: "https://janete.exemplo.com.br", fetch },
    );
    expect(r).toMatchObject({ ok: false, erro: "servidor_inacessivel" });
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain(CHAVE_GLOBAL);
  });

  it("o Conectar com a instância que não existe cria com o mesmo token que o salvar confere depois", async () => {
    const { fetch, chamadas } = fetchFalso(NAO_EXISTE, CRIADA);
    const r = await salvarConexaoLogica(
      contexto(),
      { gateway: "evolution", campos: CAMPOS },
      { origem: "https://janete.exemplo.com.br", fetch },
    );
    expect(r).toMatchObject({ ok: false, erro: "instancia_desconectada" });
    expect(chamadas.map((c) => c.url)).toEqual([
      `${SERVIDOR}/instance/connectionState/janete`,
      `${SERVIDOR}/instance/create`,
    ]);
    expect(JSON.parse(String(chamadas[1]!.init.body)).token).toBe(await tokenDaInstanciaEvolution(SERVIDOR, "janete"));
    expect(dubles.gravarConexao).not.toHaveBeenCalled();
  });
});
