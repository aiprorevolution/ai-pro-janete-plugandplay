import { beforeEach, describe, expect, it, vi } from "vitest";

// O toque pela tela de ponta a ponta (spec-motor-acordado, "Funções de servidor"): a função de
// servidor, a lógica e o motor de verdade, sobre um firebaseAdmin falso que guarda o endereço
// gravado como o motor_endereco faria. O cabeçalho Origin, que um membro pode forjar, nunca vira
// o endereço do motor (revisão da fundação, achado 3).
const estado = vi.hoisted(() => ({
  pedido: null as Request | null,
  membro: true,
  url: null as string | null,
  rpcs: [] as { nome: string; args: unknown }[],
  schedule: vi.fn(),
}));
vi.mock("@/integrations/firebase/config.server", () => ({
  getInstallationConfig: async () => ({ publicUrl: estado.url }),
}));
vi.mock("@/features/mensageria/nucleo/tasks.server", async actual => ({
  ...(await actual<any>()), agendarProcessamento: estado.schedule,
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
          h({
            data: validar(o.data),
            context: {
              userId: "u-1",
              firebase: {
                rpc: async (nome: string) =>
                  nome === "eh_membro"
                    ? { data: estado.membro, error: null }
                    : { data: null, error: { message: "rpc desconhecida" } },
              },
            },
          }),
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
vi.mock("@/integrations/firebase/client.server", () => ({
  firebaseAdmin: {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ nome, args });
      if (nome === "motor_endereco") {
        const p = String(args["p_url"]);
        const gravou = /^https:\/\/[a-z0-9.-]+$/.test(p) && p !== estado.url;
        if (gravou) estado.url = p;
        return { data: gravou, error: null };
      }
      if (nome === "acordar_motor") {
        return { data: estado.url ? "tocado" : "sem_endereco", error: null };
      }
      return { data: null, error: { code: "42883", message: "x" } };
    },
  },
}));

const { acordarMotorPelaTela } = await import("./servidor.functions");

beforeEach(() => {
  estado.membro = true;
  estado.url = "https://janete.exemplo.com";
  estado.rpcs = [];
  estado.schedule.mockReset().mockResolvedValue("task-created");
});

describe("acordarMotorPelaTela de ponta a ponta", () => {
  it("Origin: https://outro.exemplo não muda o endereço do motor", async () => {
    estado.pedido = new Request("https://janete.exemplo.com/_serverFn/abc", {
      method: "POST",
      headers: { origin: "https://outro.exemplo" },
    });
    expect(await acordarMotorPelaTela({ data: {} })).toEqual({ ok: true, toque: "tocado" });
    expect(estado.url).toBe("https://janete.exemplo.com");
    expect(JSON.stringify(estado.rpcs)).not.toContain("outro.exemplo");
  });

  it("o host recebido não substitui uma publicação ainda não configurada", async () => {
    estado.url = null;
    estado.pedido = new Request("https://janete-nova.exemplo.com/_serverFn/abc", {
      method: "POST",
      headers: { origin: "https://outro.exemplo" },
    });
    expect(await acordarMotorPelaTela({ data: {} })).toEqual({ ok: true, toque: "sem_endereco" });
    expect(estado.url).toBeNull();
    expect(estado.schedule).not.toHaveBeenCalled();
  });

  it("pedido da prévia usa a configuração publicada e não grava nova origem", async () => {
    estado.pedido = new Request("https://ais-dev-abc123.us-east1.run.app/_serverFn/abc", {
      method: "POST",
    });
    expect(await acordarMotorPelaTela({ data: {} })).toEqual({ ok: true, toque: "tocado" });
    expect(estado.url).toBe("https://janete.exemplo.com");
    expect(estado.rpcs).toEqual([]);
    expect(estado.schedule).toHaveBeenCalledTimes(1);
  });

  it("quem não é membro não toca nem grava", async () => {
    estado.membro = false;
    estado.pedido = new Request("https://janete-nova.exemplo.com/_serverFn/abc", { method: "POST" });
    expect(await acordarMotorPelaTela({ data: {} })).toEqual({ ok: false, erro: "sem_acesso" });
    expect(estado.rpcs).toEqual([]);
  });
});
