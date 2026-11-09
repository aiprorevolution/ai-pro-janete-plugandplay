import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Task C7 (spec 2.4): as funções de servidor da Equipe. createServerFn falso (o mesmo padrão de
// dados/servidor.functions.test.ts): guarda o validator e o handler e roda os dois com o contexto que
// o requireFirebaseAuth poria lá; a origem vem do cabeçalho Origin do pedido. E as regras da área
// conferidas no código: a Equipe lê só pela camada de dados (nenhum useExemplo) e o firebaseAdmin
// só entra dentro do handler.

const estado = vi.hoisted(() => ({
  contexto: {
    firebase: { cliente: "do usuário" },
    userId: "u-1",
    claims: { email: "bia@x.com", amr: [{ method: "otp", timestamp: 1 }] },
  } as Record<string, unknown>,
  pedido: null as null | { headers: Headers; url: string },
  logica: {
    convidarMembroLogica: vi.fn(),
    linkDoConviteLogica: vi.fn(),
    reenviarConviteLogica: vi.fn(),
    cancelarConviteLogica: vi.fn(),
    aceitarConviteLogica: vi.fn(),
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
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => estado.pedido }));
vi.mock("@/integrations/firebase/auth-middleware", () => ({ requireFirebaseAuth: {} }));
vi.mock("@/features/plataforma/equipe/equipe.server", () => estado.logica);

import {
  aceitarConvite,
  cancelarConvite,
  convidarMembro,
  lerEntradaAceitar,
  lerEntradaConvidar,
  lerEntradaConvite,
  linkDoConvite,
  reenviarConvite,
} from "@/features/plataforma/equipe/equipe.functions";

const CTX = { firebase: { cliente: "do usuário" }, userId: "u-1" };
const ID = "c0000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  for (const f of Object.values(estado.logica)) f.mockReset().mockResolvedValue({ ok: true });
  estado.pedido = { headers: new Headers({ origin: "https://janete.exemplo.app" }), url: "http://interno:3000/_server" };
});

describe("leitura das entradas", () => {
  it("convidar: e-mail em texto e papel admin ou atendente", () => {
    expect(lerEntradaConvidar({ email: "bia@x.com", papel: "admin" })).toEqual({ email: "bia@x.com", papel: "admin" });
    expect(() => lerEntradaConvidar({ email: "bia@x.com", papel: "dono" })).toThrow("Pedido inválido: papel.");
    expect(() => lerEntradaConvidar({ email: 1, papel: "admin" })).toThrow("Pedido inválido: email.");
    expect(() => lerEntradaConvidar(null)).toThrow("Pedido inválido.");
  });

  it("convite: o id em texto (aparado); aceitar: o nome em texto", () => {
    expect(lerEntradaConvite({ conviteId: ` ${ID} ` })).toEqual({ conviteId: ID });
    expect(() => lerEntradaConvite({ conviteId: "x".repeat(255) })).toThrow();
    expect(lerEntradaAceitar({ nome: "Bia" })).toEqual({ nome: "Bia" });
    expect(() => lerEntradaAceitar({ nome: "x".repeat(401) })).toThrow();
  });
});

describe("as funções", () => {
  it("convidar, link e reenviar levam a origem do pedido (cabeçalho Origin) para o redirectTo", async () => {
    await convidarMembro({ data: { email: "bia@x.com", papel: "atendente" } });
    expect(estado.logica.convidarMembroLogica).toHaveBeenCalledWith(
      { ...CTX, origem: "https://janete.exemplo.app" },
      { email: "bia@x.com", papel: "atendente" },
    );
    await linkDoConvite({ data: { conviteId: ID } });
    expect(estado.logica.linkDoConviteLogica).toHaveBeenCalledWith({ ...CTX, origem: "https://janete.exemplo.app" }, { conviteId: ID });
    estado.pedido = { headers: new Headers(), url: "https://outra.exemplo.app/_server/x" };
    await reenviarConvite({ data: { conviteId: ID } });
    expect(estado.logica.reenviarConviteLogica).toHaveBeenCalledWith({ ...CTX, origem: "https://outra.exemplo.app" }, { conviteId: ID });
  });

  it("cancelar e aceitar não precisam de origem; só o aceitar recebe as claims e o token do pedido", async () => {
    await cancelarConvite({ data: { conviteId: ID } });
    expect(estado.logica.cancelarConviteLogica).toHaveBeenCalledWith(CTX, { conviteId: ID });

    estado.pedido = { headers: new Headers({ authorization: "Bearer cabeca.corpo.assinatura" }), url: "https://x.app/_server" };
    await aceitarConvite({ data: { nome: "Bia" } });
    expect(estado.logica.aceitarConviteLogica).toHaveBeenCalledWith(
      { ...CTX, claims: { email: "bia@x.com", amr: [{ method: "otp", timestamp: 1 }] }, token: "cabeca.corpo.assinatura" },
      { nome: "Bia" },
    );

    // sem o cabeçalho (ou sem o "Bearer "), o token vai nulo, e o aceitar da conta que já existia recusa
    estado.pedido = { headers: new Headers(), url: "https://x.app/_server" };
    await aceitarConvite({ data: { nome: "Bia" } });
    expect(estado.logica.aceitarConviteLogica).toHaveBeenLastCalledWith(expect.objectContaining({ token: null }), { nome: "Bia" });
  });
});

/* ---------- as regras da área, no código ---------- */

const RAIZ = path.resolve(__dirname, "..");
function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const p = path.join(pasta, nome);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(nome) ? [p] : [];
  });
}
const daArea = [
  ...arquivos(path.join(RAIZ, "features/plataforma/equipe")),
  path.join(RAIZ, "routes/_conta/convite.tsx"),
];
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("as regras da área", () => {
  it("nenhum arquivo da Equipe usa useExemplo (lê só pela camada de dados)", () => {
    expect(daArea.length).toBeGreaterThan(5);
    for (const f of daArea) expect(semComentarios(readFileSync(f, "utf8")), f).not.toMatch(/useExemplo/);
  });

  it("o armazenamento e a identidade ficam em módulos exclusivos do servidor", () => {
    for (const f of daArea.filter(f => !f.endsWith('.server.ts'))) {
      expect(semComentarios(readFileSync(f, 'utf8')), f).not.toMatch(/store\.server|identity\.server|firebaseAdmin/);
    }
  });

  it("nenhuma leitura com select('*') na área", () => {
    for (const f of [...daArea, path.join(RAIZ, "features/plataforma/dados/equipe.ts")]) {
      const texto = semComentarios(readFileSync(f, "utf8"));
      expect(texto, f).not.toMatch(/select\(\s*["'`]\*["'`]/);
    }
  });
});
