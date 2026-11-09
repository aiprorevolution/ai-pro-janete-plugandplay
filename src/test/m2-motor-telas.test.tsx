import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHAVES } from "@/features/plataforma/dados/chaves";
import {
  CONSERTAR_APOS_MS,
  CONSERTAR_A_CADA_MS,
  MOTOR_VALE_MS,
  lerPendencias,
  motorValido,
  opcoesMotor,
  quandoConsertar,
} from "@/features/plataforma/dados/motor";
import {
  criarAcoesOnboardingBanco,
  useDadosOnboardingBanco,
  type ServidorOnboarding,
} from "@/features/plataforma/dados/onboarding";
import {
  ProvedorDados,
  criarAcoesBanco,
  useDados,
} from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import { MOTOR_ATRASADO_APOS_MS } from "@/features/plataforma/dados/tipos";
import { criarEstadoInicial } from "@/features/plataforma/exemplo";

// C2 do motor acordado pelos acontecimentos (docs/spec-motor-acordado.md, "Telas"): a leitura do
// motor na camada de dados, o conserto sozinho (decisão 2) e o toque depois de devolver para a Janete
// e de concluir o onboarding. O cliente do Firebase e as funções de servidor são falsos: nada vai à
// rede nem ao banco. Os textos da Saúde e do Dashboard estão em c5 e d0.

const CV = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AGORA = new Date("2026-11-03T15:00:00-03:00").getTime();

afterEach(() => {
  vi.useRealTimers();
});

describe("a leitura do motor (motor_pendencias)", () => {
  it("relida a cada 60 s e no foco, numa chave própria, fora da invalidação por tabela", () => {
    const o = opcoesMotor(criarClienteFalso().cliente);
    expect(o.queryKey).toEqual([...CHAVES.motor, "pendencias"]);
    expect(o.refetchInterval).toBe(60_000);
    expect(o.refetchOnWindowFocus).toBe("always");
    // no exemplo (sem cliente), nem pergunta
    expect(opcoesMotor(null).enabled).toBe(false);
  });

  it("a linha vira ms; sem linha, nula (a tela não afirma nada)", () => {
    expect(
      lerPendencias([
        { proximo_em: null, vencido_desde: "2026-11-03T17:58:00Z", atrasado_desde: null },
      ]),
    ).toEqual({
      proximoEm: null,
      vencidoDesde: Date.parse("2026-11-03T17:58:00Z"),
      atrasadoDesde: null,
    });
    expect(lerPendencias([])).toBeNull();
    expect(lerPendencias(null)).toBeNull();
  });

  it("só vale sem erro e com menos de 2 min; o limite do atraso é um só (3 min)", () => {
    const p = { proximoEm: null, vencidoDesde: null, atrasadoDesde: null };
    expect(
      motorValido({ data: p, error: null, dataUpdatedAt: AGORA - MOTOR_VALE_MS + 1 }, AGORA),
    ).toBe(p);
    expect(
      motorValido({ data: p, error: null, dataUpdatedAt: AGORA - MOTOR_VALE_MS }, AGORA),
    ).toBeUndefined();
    expect(
      motorValido({ data: p, error: new Error("x"), dataUpdatedAt: AGORA }, AGORA),
    ).toBeUndefined();
    expect(motorValido({ data: null, error: null, dataUpdatedAt: AGORA }, AGORA)).toBeUndefined();
    expect(MOTOR_ATRASADO_APOS_MS).toBe(3 * 60_000);
    // a regra dos 3 min não se repete em outro lugar das telas
    const raiz = path.resolve(__dirname, "../features/plataforma");
    for (const arq of [
      "configuracao/leitura.ts",
      "configuracao/Saude.tsx",
      "configuracao/TelaConfiguracao.tsx",
      "dashboard/dados/montar.ts",
    ]) {
      expect(readFileSync(path.join(raiz, arq), "utf-8"), arq).not.toMatch(/3 \* 60_000|180_000/);
    }
  });

  it("o conserto: vencido há mais de 60 s, e 1 min depois do último toque", () => {
    const p = (vencidoDesde: number | null) => ({
      proximoEm: null,
      vencidoDesde,
      atrasadoDesde: null,
    });
    expect(quandoConsertar(undefined, null)).toBeNull();
    expect(quandoConsertar(p(null), null)).toBeNull();
    expect(quandoConsertar(p(AGORA), null)).toBe(AGORA + CONSERTAR_APOS_MS + 1);
    expect(quandoConsertar(p(AGORA - 10 * 60_000), AGORA)).toBe(AGORA + CONSERTAR_A_CADA_MS);
  });

  it("no modo exemplo nada muda: sem leitura, sem pendências", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ProvedorDados exemplo={criarEstadoInicial()}>{children}</ProvedorDados>
    );
    const { result } = renderHook(() => useDados().useMotor(), { wrapper });
    expect(result.current).toBeUndefined();
  });

  it("no banco, a tela recebe as pendências; sem a função de servidor, nenhum toque é tentado", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = criarClienteFalso({
      uid: "u-1",
      rpc: (nome) =>
        nome === "motor_pendencias"
          ? {
              data: [
                {
                  proximo_em: null,
                  vencido_desde: new Date(Date.now() - 10 * 60_000).toISOString(),
                  atrasado_desde: null,
                },
              ],
              error: null,
            }
          : undefined,
    });
    // as outras funções de servidor, espionadas: sem o acordarMotor, nenhuma faz as vezes do toque
    const servidor = {
      pedirEnvio: vi.fn(async () => {}),
      garantirBucketMidias: vi.fn(async () => ({ ok: true as const })),
      marcarLidaNoWhatsApp: vi.fn(async () => {}),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <ProvedorDados fonte="banco" cliente={f.cliente} servidor={servidor}>
          {children}
        </ProvedorDados>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDados().useMotor(), { wrapper });
    await waitFor(() => expect(result.current?.vencidoDesde).toEqual(expect.any(Number)));
    // vencido há 10 min e 2 min de tela aberta: com o acordarMotor, já teria tocado
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }
    expect(servidor.pedirEnvio).not.toHaveBeenCalled();
    expect(servidor.garantirBucketMidias).not.toHaveBeenCalled();
    expect(servidor.marcarLidaNoWhatsApp).not.toHaveBeenCalled();
    // nada além da leitura saiu (relida a cada 60 s)
    expect(new Set(f.rpcs.map((r) => r.nome))).toEqual(new Set(["motor_pendencias"]));
  });

  it("a mesma tela, com o acordarMotor, toca depois de ver o vencido (o contraste do teste acima)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = criarClienteFalso({
      uid: "u-1",
      rpc: (nome) =>
        nome === "motor_pendencias"
          ? {
              data: [
                {
                  proximo_em: null,
                  vencido_desde: new Date(Date.now() - 10 * 60_000).toISOString(),
                  atrasado_desde: null,
                },
              ],
              error: null,
            }
          : undefined,
    });
    const acordarMotor = vi.fn(async () => ({ ok: true }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <ProvedorDados fonte="banco" cliente={f.cliente} servidor={{ acordarMotor }}>
          {children}
        </ProvedorDados>
      </QueryClientProvider>
    );
    renderHook(() => useDados().useMotor(), { wrapper });
    await waitFor(() => expect(acordarMotor).toHaveBeenCalledTimes(1));
  });

  it("a linha fora do formato (sem as 3 colunas) não vira 'nada pendente'", () => {
    expect(lerPendencias([{ ultimaDaJaneteEm: null }])).toBeNull();
    expect(lerPendencias({ proximo_em: null, vencido_desde: null })).toBeNull();
    expect(
      lerPendencias([{ proximo_em: null, vencido_desde: null, atrasado_desde: null }]),
    ).toEqual({ proximoEm: null, vencidoDesde: null, atrasadoDesde: null });
  });
});

describe("devolver para a Janete pede o toque, sem esperar", () => {
  it("deu certo: chama acordarMotor uma vez, e a ação volta sem esperar a resposta", async () => {
    const f = criarClienteFalso();
    const acordarMotor = vi.fn(() => new Promise<unknown>(() => {}));
    const acoes = criarAcoesBanco(f.cliente, new QueryClient(), { acordarMotor });
    expect(await acoes.devolverParaJanete(CV)).toEqual({ ok: true });
    expect(f.rpcs).toEqual([{ nome: "devolver_para_janete", args: { p_conversa: CV } }]);
    expect(acordarMotor).toHaveBeenCalledTimes(1);
  });

  it("recusado, não toca; o toque que falha não muda o resultado", async () => {
    const recusa = criarClienteFalso({
      rpc: () => ({ data: null, error: { code: "P0001", message: "sem_acesso" } }),
    });
    const acordarMotor = vi.fn(async () => {
      throw new Error("rede");
    });
    expect(
      await criarAcoesBanco(recusa.cliente, new QueryClient(), { acordarMotor }).devolverParaJanete(
        CV,
      ),
    ).toMatchObject({ ok: false });
    expect(acordarMotor).not.toHaveBeenCalled();
    const ok = criarClienteFalso();
    expect(
      await criarAcoesBanco(ok.cliente, new QueryClient(), { acordarMotor }).devolverParaJanete(CV),
    ).toEqual({ ok: true });
    expect(acordarMotor).toHaveBeenCalledTimes(1);
    // sem a função, devolve igual
    expect(await criarAcoesBanco(ok.cliente, new QueryClient()).devolverParaJanete(CV)).toEqual({
      ok: true,
    });
  });

  it("pelo provedor: o ServidorDados recebido é quem toca", async () => {
    const f = criarClienteFalso({ uid: "u-1" });
    const acordarMotor = vi.fn(async () => ({ ok: true }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <ProvedorDados fonte="banco" cliente={f.cliente} servidor={{ acordarMotor }}>
          {children}
        </ProvedorDados>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDados().acoes, { wrapper });
    await act(async () => {
      expect(await result.current.devolverParaJanete(CV)).toEqual({ ok: true });
    });
    expect(acordarMotor).toHaveBeenCalledTimes(1);
  });
});

describe("concluir o onboarding pede o toque, sem esperar", () => {
  it("deu certo: toca uma vez; recusado, não toca", async () => {
    const acordarMotor = vi.fn(() => new Promise<unknown>(() => {}));
    const ok = criarClienteFalso({
      rpc: () => ({ data: "2026-11-03T18:00:00+00:00", error: null }),
    });
    const acoes = criarAcoesOnboardingBanco({
      cliente: ok.cliente,
      queryClient: new QueryClient(),
      base: () => null,
      aoGravarContexto: () => {},
      acordarMotor,
    });
    expect(await acoes.concluir()).toEqual({ ok: true, valor: "2026-11-03T18:00:00+00:00" });
    expect(acordarMotor).toHaveBeenCalledTimes(1);

    acordarMotor.mockClear();
    const recusa = criarClienteFalso({
      rpc: () => ({ data: null, error: { code: "P0001", message: "sem_acesso" } }),
    });
    const r = await criarAcoesOnboardingBanco({
      cliente: recusa.cliente,
      queryClient: new QueryClient(),
      base: () => null,
      aoGravarContexto: () => {},
      acordarMotor,
    }).concluir();
    expect(r).toMatchObject({ ok: false, erro: "sem_acesso" });
    expect(acordarMotor).not.toHaveBeenCalled();
  });

  it("pelo hook do onboarding: o acordarMotor do servidor é quem toca, e o que falha não muda o resultado", async () => {
    const f = criarClienteFalso({
      rpc: (nome) =>
        nome === "concluir_onboarding"
          ? { data: "2026-11-03T18:00:00+00:00", error: null }
          : undefined,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const acordarMotor = vi.fn(() => Promise.reject(new Error("rede")));
    const servidor: ServidorOnboarding = {
      salvarConexao: vi.fn(),
      salvarChaveIA: vi.fn(),
      pedirQr: vi.fn(),
      listarVozes: vi.fn(),
      escolherVoz: vi.fn(),
      desconectarCelular: vi.fn(),
      usarChaveElevenLabs: vi.fn(),
      acordarMotor,
    };
    const { result } = renderHook(() => useDadosOnboardingBanco(f.cliente, servidor), { wrapper });
    await act(async () => {
      expect(await result.current.concluir()).toEqual({
        ok: true,
        valor: "2026-11-03T18:00:00+00:00",
      });
    });
    expect(acordarMotor).toHaveBeenCalledTimes(1);
  });

  it("o Onboarding de verdade liga o toque ao ServidorDados da plataforma", () => {
    const texto = readFileSync(
      path.resolve(__dirname, "../features/onboarding/Onboarding.tsx"),
      "utf-8",
    );
    expect(texto).toMatch(/acordarMotor: \(\) => servidorDaPlataforma\.acordarMotor\?\.\(\)/);
  });
});
