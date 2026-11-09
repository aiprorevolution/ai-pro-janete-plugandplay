import { beforeEach, describe, expect, it, vi } from "vitest";

// createServerFn falso (o mesmo padrão de mensageria/configuracao.functions.test.ts): guarda o
// validator e o handler e devolve uma função que roda os dois com o contexto que o
// requireFirebaseAuth poria lá.
const estado = vi.hoisted(() => ({
  contexto: { firebase: { cliente: "do usuário" }, userId: "u-1" } as Record<string, unknown>,
  pedido: null as Request | null,
  logica: {
    garantirBucketMidiasLogica: vi.fn(),
    pedirEnvioLogica: vi.fn(),
    acordarMotorPelaTelaLogica: vi.fn(),
    marcarLidaNoWhatsAppLogica: vi.fn(),
    apagarContatoLogica: vi.fn(),
  },
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validar: (d: unknown) => unknown = (d) => d;
    const construtor = {
      middleware: () => construtor,
      validator: (v: (d: unknown) => unknown) => {
        validar = v;
        return construtor;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) => async (o: { data: unknown }) =>
          h({ data: validar(o.data), context: estado.contexto }),
    };
    return construtor;
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!estado.pedido) throw new Error("sem pedido");
    return estado.pedido;
  },
}));
vi.mock("@/integrations/firebase/auth-middleware", () => ({ requireFirebaseAuth: {} }));
vi.mock("./servidor.server", () => estado.logica);

import {
  acordarMotorPelaTela,
  apagarContato,
  garantirBucketMidias,
  lerEntradaApagarContato,
  lerEntradaMarcarLida,
  lerEntradaVazia,
  marcarLidaNoWhatsApp,
  pedirEnvio,
  servidorDaPlataforma,
} from "./servidor.functions";

const CTX = { firebase: { cliente: "do usuário" }, userId: "u-1" };
const ID = "c0000000-0000-4000-8000-0000000000c1";

const URL_DO_APP = "https://janete.exemplo.com/_serverFn/abc";
const ORIGEM_DO_APP = "https://janete.exemplo.com";

beforeEach(() => {
  for (const f of Object.values(estado.logica)) {
    f.mockReset();
    f.mockResolvedValue({ ok: true });
  }
  estado.pedido = new Request(URL_DO_APP, { method: "POST" });
});

describe("leitura das entradas", () => {
  it("vazia: aceita nada ou {} e recusa campo a mais", () => {
    expect(lerEntradaVazia(undefined)).toEqual({});
    expect(lerEntradaVazia({})).toEqual({});
    expect(() => lerEntradaVazia({ x: 1 })).toThrow("Pedido inválido.");
    expect(() => lerEntradaVazia("x")).toThrow();
  });

  it("conversaId e contatoId: só texto de até 100 letras", () => {
    expect(lerEntradaMarcarLida({ conversaId: ID })).toEqual({ conversaId: ID });
    expect(lerEntradaApagarContato({ contatoId: ` ${ID} ` })).toEqual({ contatoId: ID });
    expect(() => lerEntradaMarcarLida({})).toThrow("Pedido inválido: conversaId.");
    expect(() => lerEntradaApagarContato({ contatoId: 5 })).toThrow("Pedido inválido: contatoId.");
    expect(() => lerEntradaApagarContato({ contatoId: "x".repeat(101) })).toThrow();
    expect(() => lerEntradaApagarContato(null)).toThrow();
  });
});

describe("funções de servidor", () => {
  it("cada uma passa o cliente do usuário e o userId para a lógica", async () => {
    await garantirBucketMidias({ data: {} });
    await pedirEnvio({ data: {} });
    await marcarLidaNoWhatsApp({ data: { conversaId: ID } });
    await apagarContato({ data: { contatoId: ID } });
    expect(estado.logica.garantirBucketMidiasLogica).toHaveBeenCalledWith(CTX);
    expect(estado.logica.pedirEnvioLogica).toHaveBeenCalledWith(CTX, { origem: ORIGEM_DO_APP });
    expect(estado.logica.marcarLidaNoWhatsAppLogica).toHaveBeenCalledWith(CTX, { conversaId: ID });
    expect(estado.logica.apagarContatoLogica).toHaveBeenCalledWith(CTX, { contatoId: ID });
  });

  it("devolve o resultado da lógica como veio", async () => {
    estado.logica.apagarContatoLogica.mockResolvedValue({ ok: false, erro: "sem_acesso" });
    expect(await apagarContato({ data: { contatoId: ID } })).toEqual({ ok: false, erro: "sem_acesso" });
  });

  it("entrada inválida não chega à lógica", async () => {
    await expect(apagarContato({ data: { contatoId: 1 } as never })).rejects.toThrow();
    expect(estado.logica.apagarContatoLogica).not.toHaveBeenCalled();
  });
});

describe("o toque no motor pela tela (acordarMotorPelaTela e o fim do pedirEnvio)", () => {
  it("passa o cliente do usuário e o host que recebeu o pedido", async () => {
    estado.logica.acordarMotorPelaTelaLogica.mockResolvedValue({ ok: true, toque: "tocado" });
    expect(await acordarMotorPelaTela({ data: {} })).toEqual({ ok: true, toque: "tocado" });
    expect(estado.logica.acordarMotorPelaTelaLogica).toHaveBeenCalledWith(CTX, {
      origem: ORIGEM_DO_APP,
    });
  });

  it("o cabeçalho Origin (que um membro pode forjar) não muda a origem", async () => {
    estado.pedido = new Request(URL_DO_APP, {
      method: "POST",
      headers: { origin: "https://outro.exemplo" },
    });
    await acordarMotorPelaTela({ data: {} });
    await pedirEnvio({ data: {} });
    expect(estado.logica.acordarMotorPelaTelaLogica).toHaveBeenCalledWith(CTX, {
      origem: ORIGEM_DO_APP,
    });
    expect(estado.logica.pedirEnvioLogica).toHaveBeenCalledWith(CTX, { origem: ORIGEM_DO_APP });
  });

  it("sem o pedido: origem null (o toque usa o endereço já gravado)", async () => {
    estado.pedido = null;
    await acordarMotorPelaTela({ data: {} });
    expect(estado.logica.acordarMotorPelaTelaLogica).toHaveBeenCalledWith(CTX, { origem: null });
  });

  it("entrada com campo a mais não chega à lógica", async () => {
    await expect(
      acordarMotorPelaTela({ data: { origem: "https://outro.exemplo" } as never }),
    ).rejects.toThrow();
    expect(estado.logica.acordarMotorPelaTelaLogica).not.toHaveBeenCalled();
  });
});

describe("servidorDaPlataforma (a prop `servidor` do ProvedorDados)", () => {
  it("liga as 5 funções no formato que a camada de dados chama", async () => {
    estado.logica.marcarLidaNoWhatsAppLogica.mockResolvedValue({ ok: true, marcada: true });
    await servidorDaPlataforma.acordarMotor?.();
    expect(estado.logica.acordarMotorPelaTelaLogica).toHaveBeenCalledTimes(1);
    await servidorDaPlataforma.pedirEnvio?.();
    await servidorDaPlataforma.garantirBucketMidias?.();
    expect(await servidorDaPlataforma.marcarLidaNoWhatsApp?.(ID)).toEqual({ ok: true, marcada: true });
    await servidorDaPlataforma.apagarContato?.(ID);
    expect(estado.logica.pedirEnvioLogica).toHaveBeenCalledTimes(1);
    expect(estado.logica.garantirBucketMidiasLogica).toHaveBeenCalledTimes(1);
    expect(estado.logica.marcarLidaNoWhatsAppLogica).toHaveBeenCalledWith(CTX, { conversaId: ID });
    expect(estado.logica.apagarContatoLogica).toHaveBeenCalledWith(CTX, { contatoId: ID });
  });

  it("pela camada de dados: o apagarContato recusado volta traduzido para a tela", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { criarAcoesBanco } = await import("./ProvedorDados");
    const acoes = criarAcoesBanco({} as never, new QueryClient(), servidorDaPlataforma);

    estado.logica.apagarContatoLogica.mockResolvedValue({ ok: false, erro: "sem_acesso" });
    expect(await acoes.apagarContato(ID)).toEqual({ ok: false, erro: "sem_acesso" });
    estado.logica.apagarContatoLogica.mockResolvedValue({ ok: false, erro: "nao_encontrado" });
    expect(await acoes.apagarContato(ID)).toEqual({ ok: false, erro: "nao_encontrado" });
    estado.logica.apagarContatoLogica.mockResolvedValue({ ok: true });
    expect(await acoes.apagarContato(ID)).toEqual({ ok: true });
  });
});
