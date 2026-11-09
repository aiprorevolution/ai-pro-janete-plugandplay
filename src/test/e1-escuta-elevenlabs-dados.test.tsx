import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  AJUDA_CHAVE_ESCUTA_ELEVENLABS,
  TRANSCRITORES,
  acharTranscritor,
} from "@/features/plataforma/configuracao/dados";
import { lerEscuta, lerVoz } from "@/features/plataforma/configuracao/leitura";
import { perguntaUsarNaEscuta, perguntaUsarNaVoz } from "@/features/plataforma/configuracao/tambem";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import {
  criarAcoesConfiguracaoBanco,
  useDadosConfiguracao,
  type ServidorConfiguracao,
} from "@/features/plataforma/dados/configuracao";
import {
  criarDadosOnboardingMemoria,
  escutaGravada,
  useDadosOnboardingBanco,
  type ServidorOnboarding,
} from "@/features/plataforma/dados/onboarding";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import { criarEstadoInicial, type ChaveIA, type ProvedorIA } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// E1: a chave da ElevenLabs também no cartão Escuta, na fundação de dados e leitura
// (docs/spec-escuta-elevenlabs.md, T1 a T5). O servidor e o banco são falsos: nada vai à rede.

function chave(
  finalidade: ChaveIA["finalidade"],
  provedor: ProvedorIA,
  ultimos4: string | null = "TSTE",
  status: ChaveIA["status"] = "ativa",
): ChaveIA {
  return {
    id: `k-${finalidade}`,
    finalidade,
    provedor,
    modelo: finalidade === "resposta" ? "gpt-x" : finalidade === "transcricao" ? "scribe_v2" : "",
    status,
    ultimos4,
    ultimo_erro: null,
    validada_em: "2026-11-03T11:00:00-03:00",
    atualizada_em: "2026-11-03T11:00:00-03:00",
    atualizada_por: null,
  } as ChaveIA;
}

const esc = (chaves: ChaveIA[]) => lerEscuta({ chaves }, true);
const voz = (chaves: ChaveIA[]) => lerVoz({ chaves, configuracao: {} }, true);

/** O mesmo molde do servidorFalso de v1-voz-dados.test.ts, com a cópia nova. */
function servidorFalso(sobre: Partial<Record<keyof ServidorConfiguracao, unknown>> = {}) {
  const ok = (extra: Record<string, unknown> = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  const s = {
    salvarChaveIA: ok({ ultimos4: "ABCD", status: "ativa" }),
    removerChaveIA: ok(),
    usarChaveElevenLabs: ok({ copiada: true, ultimos4: "ABCD", status: "ativa" }),
    ...sobre,
  };
  return s as unknown as ServidorConfiguracao & Record<keyof ServidorConfiguracao, ReturnType<typeof vi.fn>>;
}

/** As chaves relidas pela ação (o que o invalidateQueries recebeu). */
function relidas(espia: { mock: { calls: unknown[][] } }): unknown[] {
  return espia.mock.calls.map((args) => (args[0] as { queryKey: unknown }).queryKey);
}

describe("T4: os provedores da escuta", () => {
  it("são 3, nesta ordem, e o 3º é a ElevenLabs com o Scribe", () => {
    expect(TRANSCRITORES.map((t) => t.id)).toEqual(["openai", "groq", "elevenlabs"]);
    expect(TRANSCRITORES[2]).toEqual({
      id: "elevenlabs",
      nome: "ElevenLabs",
      artigo: "a",
      logo: expect.any(String),
      linha: "Transcreve com o Scribe. A mesma chave também pode dar a voz da Janete.",
      modelo: "scribe_v2",
    });
    expect(TRANSCRITORES[2]?.logo).toBeTruthy();
    expect(acharTranscritor("elevenlabs")?.nome).toBe("ElevenLabs");
  });

  it("a ajuda da chave da ElevenLabs na escuta", () => {
    expect(AJUDA_CHAVE_ESCUTA_ELEVENLABS).toBe(
      "Na ElevenLabs, crie a chave em Developers → API Keys e ligue os acessos User e Speech to Text. Para usar a mesma chave na voz, ligue também Text to Speech e Voices (leitura).",
    );
  });
});

describe("T3: a leitura com a escuta da ElevenLabs", () => {
  it("a chave própria da ElevenLabs transcreve, antes do cérebro OpenAI e da voz", () => {
    const l = esc([chave("resposta", "openai"), chave("transcricao", "elevenlabs"), chave("voz", "elevenlabs", "OUTR")]);
    expect(l.transcritor?.id).toBe("elevenlabs");
    expect(l).toMatchObject({ viaCerebro: false, viaVoz: false, cerebroTranscreve: true, ok: true });
    // sem crédito, ainda é ela (o servidor não pula para a voz)
    expect(esc([chave("transcricao", "elevenlabs", "TSTE", "sem_credito"), chave("voz", "elevenlabs")])).toMatchObject({
      viaVoz: false,
      ok: false,
    });
  });

  it("mesmaChave*: verdadeiro com as duas da ElevenLabs, com chave e o mesmo final", () => {
    const mesma = [chave("transcricao", "elevenlabs", "ABCD"), chave("voz", "elevenlabs", "ABCD")];
    expect(esc(mesma).mesmaChaveDaVoz).toBe(true);
    expect(voz(mesma).mesmaChaveDaEscuta).toBe(true);
    // a marca (sem crédito, inválida) não tira a chave da linha: continua a mesma
    const marcada = [chave("transcricao", "elevenlabs", "ABCD", "invalida"), chave("voz", "elevenlabs", "ABCD", "sem_credito")];
    expect(esc(marcada).mesmaChaveDaVoz).toBe(true);
    expect(voz(marcada).mesmaChaveDaEscuta).toBe(true);
  });

  it.each<[string, ChaveIA[]]>([
    ["os 4 últimos diferentes", [chave("transcricao", "elevenlabs", "ABCD"), chave("voz", "elevenlabs", "WXYZ")]],
    ["a escuta removida", [chave("transcricao", "elevenlabs", "ABCD", "removida"), chave("voz", "elevenlabs", "ABCD")]],
    ["a voz removida", [chave("transcricao", "elevenlabs", "ABCD"), chave("voz", "elevenlabs", "ABCD", "removida")]],
    ["a escuta de outro provedor", [chave("transcricao", "groq", "ABCD"), chave("voz", "elevenlabs", "ABCD")]],
    ["sem os 4 últimos", [chave("transcricao", "elevenlabs", null), chave("voz", "elevenlabs", null)]],
    ["só a voz", [chave("voz", "elevenlabs", "ABCD")]],
    ["nenhuma", []],
  ])("mesmaChave*: falso com %s", (_nome, chaves) => {
    expect(esc(chaves).mesmaChaveDaVoz).toBe(false);
    expect(voz(chaves).mesmaChaveDaEscuta).toBe(false);
  });
});

describe("T5: a pergunta do cartão Escuta para a voz", () => {
  const SIM_NAO = { titulo: "Usar esta chave também na voz?", sim: "Sim, usar na voz também", nao: "Não, só na escuta" };
  const SEM_CHAVE = "Com a mesma chave, a Janete também responde por áudio. Em seguida, você escolhe a voz.";

  it("null quando a voz já usa esta chave (ativa ou sem crédito)", () => {
    expect(perguntaUsarNaVoz(voz([chave("voz", "elevenlabs", "ABCD")]), "ABCD")).toBeNull();
    expect(perguntaUsarNaVoz(voz([chave("voz", "elevenlabs", "ABCD", "sem_credito")]), "ABCD")).toBeNull();
  });

  it.each<[string, ChaveIA[]]>([
    ["sem chave na voz", []],
    ["a voz removida", [chave("voz", "elevenlabs", "ABCD", "removida")]],
    ["a voz sem os 4 últimos", [chave("voz", "elevenlabs", null)]],
  ])("%s: a Janete passa a responder por áudio", (_nome, chaves) => {
    const p = perguntaUsarNaVoz(voz(chaves), "ABCD");
    expect(p).toEqual({ ...SIM_NAO, detalhe: SEM_CHAVE });
    expect(p?.detalhe).toBe(SEM_CHAVE);
  });

  it("com outra chave na voz: diz qual sai", () => {
    const p = perguntaUsarNaVoz(voz([chave("voz", "elevenlabs", "WXYZ")]), "ABCD");
    expect(p?.titulo).toBe(SIM_NAO.titulo);
    expect(p?.sim).toBe(SIM_NAO.sim);
    expect(p?.nao).toBe(SIM_NAO.nao);
    expect(p?.detalhe).toBe(
      "A voz hoje usa a chave terminada em WXYZ. No Sim, ela passa a usar esta, e você confere a voz em seguida.",
    );
  });

  it("a mesma chave, mas inválida na voz: pergunta (a voz não está em uso)", () => {
    const p = perguntaUsarNaVoz(voz([chave("voz", "elevenlabs", "ABCD", "invalida")]), "ABCD");
    expect(p?.detalhe).toBe(
      "A voz hoje usa a chave terminada em ABCD. No Sim, ela passa a usar esta, e você confere a voz em seguida.",
    );
  });
});

describe("T5: a pergunta do cartão Voz para a escuta", () => {
  const SIM_NAO = { titulo: "Usar esta chave na escuta também?", sim: "Sim, usar na escuta também", nao: "Não, só na voz" };
  const VIA_VOZ =
    "Hoje a Janete já ouve os áudios com a chave da voz, porque não há chave de escuta. No Sim, a chave fica também no cartão Escuta e continua lá se você tirar a voz.";
  const VIA_CEREBRO = "Hoje a Janete ouve os áudios com a chave do cérebro. No Sim, ela passa a ouvir com a ElevenLabs.";

  it("null quando a escuta já usa esta chave (ativa ou sem crédito)", () => {
    expect(perguntaUsarNaEscuta(esc([chave("transcricao", "elevenlabs", "ABCD")]), "ABCD")).toBeNull();
    expect(
      perguntaUsarNaEscuta(esc([chave("transcricao", "elevenlabs", "ABCD", "sem_credito")]), "ABCD"),
    ).toBeNull();
  });

  it.each<[ProvedorIA, string]>([
    ["openai", "OpenAI"],
    ["groq", "Groq"],
    ["openrouter", "OpenRouter"],
  ])("a escuta com a chave da %s: diz que ela sai", (provedor, nome) => {
    const p = perguntaUsarNaEscuta(esc([chave("transcricao", provedor, "GRQ1"), chave("resposta", "openai")]), "ABCD");
    expect(p?.titulo).toBe(SIM_NAO.titulo);
    expect(p?.sim).toBe(SIM_NAO.sim);
    expect(p?.nao).toBe(SIM_NAO.nao);
    expect(p?.detalhe).toBe(
      `O cartão Escuta tem a chave da ${nome}, terminada em GRQ1. No Sim, ela sai, e a escuta passa a usar esta.`,
    );
  });

  it("a escuta com outra chave da ElevenLabs", () => {
    const p = perguntaUsarNaEscuta(esc([chave("transcricao", "elevenlabs", "WXYZ")]), "ABCD");
    expect(p?.detalhe).toBe(
      "O cartão Escuta tem uma chave da ElevenLabs, terminada em WXYZ. No Sim, a escuta passa a usar esta.",
    );
  });

  it("a mesma chave, mas inválida na escuta: pergunta (P6), sem dizer que é outra", () => {
    const p = perguntaUsarNaEscuta(esc([chave("transcricao", "elevenlabs", "ABCD", "invalida")]), "ABCD");
    expect(p?.detalhe).toBe(
      "O cartão Escuta tem uma chave da ElevenLabs, terminada em ABCD. No Sim, a escuta passa a usar esta.",
    );
  });

  it("sem chave de escuta e com o cérebro que transcreve", () => {
    expect(perguntaUsarNaEscuta(esc([chave("resposta", "openai")]), "ABCD")?.detalhe).toBe(VIA_CEREBRO);
    // a escuta removida conta como sem chave
    expect(
      perguntaUsarNaEscuta(esc([chave("resposta", "openrouter"), chave("transcricao", "groq", "GRQ1", "removida")]), "ABCD")
        ?.detalhe,
    ).toBe(VIA_CEREBRO);
  });

  it("sem chave de escuta e sem cérebro que transcreve: a voz já ouve", () => {
    const p = perguntaUsarNaEscuta(esc([chave("resposta", "anthropic"), chave("voz", "elevenlabs", "ABCD")]), "ABCD");
    expect(p).toEqual({ ...SIM_NAO, detalhe: VIA_VOZ });
    expect(p?.detalhe).toBe(VIA_VOZ);
    expect(perguntaUsarNaEscuta(esc([]), "ABCD")?.detalhe).toBe(VIA_VOZ);
    expect(perguntaUsarNaEscuta(esc([chave("transcricao", "elevenlabs", null)]), "ABCD")?.detalhe).toBe(VIA_VOZ);
  });
});

describe("T1: usarChaveElevenLabs no banco", () => {
  it("chama o servidor com { para }, relê as chaves e devolve os 4 últimos", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso();
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.usarChaveElevenLabs("transcricao")).toEqual({ ok: true, ultimos4: "ABCD" });
    expect(servidor.usarChaveElevenLabs).toHaveBeenCalledTimes(1);
    expect(servidor.usarChaveElevenLabs).toHaveBeenCalledWith({ para: "transcricao" });
    expect(relidas(espia)).toEqual([CHAVES.chaves, CHAVES.auditoria]);
    servidor.usarChaveElevenLabs.mockClear();
    await acoes.usarChaveElevenLabs("voz");
    expect(servidor.usarChaveElevenLabs).toHaveBeenCalledWith({ para: "voz" });
  });

  it("nada copiado: ultimos4 nulo", async () => {
    const servidor = servidorFalso({ usarChaveElevenLabs: vi.fn(async () => ({ ok: true, copiada: false })) });
    const acoes = criarAcoesConfiguracaoBanco(servidor, new QueryClient());
    expect(await acoes.usarChaveElevenLabs("transcricao")).toEqual({ ok: true, ultimos4: null });
  });

  it("a recusa volta com a frase, relê as chaves; a exceção vira falha sem o texto cru; sem_acesso relê o Eu", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso({
      usarChaveElevenLabs: vi.fn(async () => ({ ok: false, erro: "sem_permissao", mensagem: "Falta um acesso." })),
    });
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.usarChaveElevenLabs("voz")).toEqual({ ok: false, erro: "sem_permissao", mensagem: "Falta um acesso." });
    expect(relidas(espia)).toEqual([CHAVES.chaves, CHAVES.auditoria]);
    servidor.usarChaveElevenLabs.mockRejectedValueOnce(new Error("sk_teste_1234567890abcd"));
    const r = await acoes.usarChaveElevenLabs("voz");
    expect(r).toEqual({ ok: false, erro: "falha" });
    expect(JSON.stringify(r)).not.toContain("sk_teste_1234567890abcd");
    espia.mockClear();
    servidor.usarChaveElevenLabs.mockResolvedValueOnce({ ok: false, erro: "sem_acesso" });
    expect(await acoes.usarChaveElevenLabs("voz")).toMatchObject({ ok: false, erro: "sem_acesso" });
    expect(relidas(espia)).toContainEqual(CHAVES.eu);
  });
});

describe("T1: usarChaveElevenLabs no exemplo", () => {
  function montar(chaves: ChaveIA[]) {
    const inicial = criarEstadoInicial(new Date("2026-11-03T15:00:00-03:00"));
    const exemplo = { ...inicial, chaves: [...inicial.chaves, ...chaves] };
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ProvedorPapel, {
        inicial: "admin",
        children: createElement(ProvedorDados, { exemplo, progredirEnvios: false, children }),
      });
    return renderHook(() => useDadosConfiguracao(), { wrapper });
  }

  it("a escuta ganha os 4 últimos da voz, com o scribe_v2", async () => {
    const { result } = montar([chave("voz", "elevenlabs", "VZ12")]);
    await waitFor(() => expect(result.current.modo).toBe("exemplo"));
    expect(await result.current.acoes.usarChaveElevenLabs("transcricao")).toEqual({ ok: true, ultimos4: "VZ12" });
    await waitFor(() =>
      expect(result.current.chaves.dados?.find((k) => k.finalidade === "transcricao")).toMatchObject({
        provedor: "elevenlabs",
        modelo: "scribe_v2",
        ultimos4: "VZ12",
        status: "ativa",
      }),
    );
  });

  it("a voz ganha os 4 últimos da escuta, sem modelo", async () => {
    const { result } = montar([chave("transcricao", "elevenlabs", "ES34")]);
    await waitFor(() => expect(result.current.modo).toBe("exemplo"));
    expect(await result.current.acoes.usarChaveElevenLabs("voz")).toEqual({ ok: true, ultimos4: "ES34" });
    await waitFor(() =>
      expect(result.current.chaves.dados?.find((k) => k.finalidade === "voz")).toMatchObject({
        provedor: "elevenlabs",
        modelo: "",
        ultimos4: "ES34",
      }),
    );
  });

  it("a origem sem os 4 últimos: sem_chave, e o destino não ganha linha", async () => {
    const { result } = montar([chave("voz", "elevenlabs", null)]);
    await waitFor(() => expect(result.current.modo).toBe("exemplo"));
    expect(await result.current.acoes.usarChaveElevenLabs("transcricao")).toEqual({ ok: false, erro: "sem_chave" });
    expect(result.current.chaves.dados?.find((k) => k.finalidade === "transcricao")).toBeUndefined();
  });

  it.each<[string, ChaveIA[]]>([
    ["sem a origem", []],
    ["a origem removida", [chave("voz", "elevenlabs", "VZ12", "removida")]],
    ["a origem de outro provedor", [chave("transcricao", "groq", "GRQ1")]],
  ])("%s: sem_chave", async (_nome, chaves) => {
    const { result } = montar(chaves);
    await waitFor(() => expect(result.current.modo).toBe("exemplo"));
    const para = chaves[0]?.finalidade === "transcricao" ? "voz" : "transcricao";
    expect(await result.current.acoes.usarChaveElevenLabs(para)).toEqual({ ok: false, erro: "sem_chave" });
  });
});

describe("T2: usarChaveElevenLabs no onboarding", () => {
  function servidorOnboarding(usar: ServidorOnboarding["usarChaveElevenLabs"]): ServidorOnboarding {
    return {
      salvarConexao: vi.fn(),
      salvarChaveIA: vi.fn(),
      pedirQr: vi.fn(),
      listarVozes: vi.fn(),
      escolherVoz: vi.fn(),
      desconectarCelular: vi.fn(),
      usarChaveElevenLabs: usar,
    };
  }

  it("no banco: vai ao servidor com a entrada; o ok relê as chaves e o sem_acesso, o Eu", async () => {
    const f = criarClienteFalso();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const usar = vi
      .fn<ServidorOnboarding["usarChaveElevenLabs"]>()
      .mockResolvedValueOnce({ ok: true, copiada: true, ultimos4: "VZ12", status: "ativa" })
      .mockResolvedValueOnce({ ok: false, erro: "sem_acesso" });
    const { result } = renderHook(() => useDadosOnboardingBanco(f.cliente, servidorOnboarding(usar)), { wrapper });
    await waitFor(() => expect(result.current.gravado.dados).toBeDefined());
    invalidar.mockClear();

    expect(await result.current.usarChaveElevenLabs({ para: "transcricao", seLivre: true })).toEqual({
      ok: true,
      copiada: true,
      ultimos4: "VZ12",
      status: "ativa",
    });
    expect(usar).toHaveBeenCalledWith({ para: "transcricao", seLivre: true });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.chaves });

    invalidar.mockClear();
    expect(await result.current.usarChaveElevenLabs({ para: "transcricao", seLivre: true })).toEqual({
      ok: false,
      erro: "sem_acesso",
    });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
    expect(invalidar).not.toHaveBeenCalledWith({ queryKey: CHAVES.chaves });
    queryClient.clear();
  });

  it("no modo de teste: a passada é a usada, e a não passada rejeita", async () => {
    await expect(criarDadosOnboardingMemoria().usarChaveElevenLabs({ para: "transcricao" })).rejects.toThrow(
      "usarChaveElevenLabs não foi passado ao modo de teste",
    );
    const usar = vi.fn(async () => ({ ok: true as const, copiada: false as const }));
    const dados = criarDadosOnboardingMemoria({ usarChaveElevenLabs: usar });
    expect(await dados.usarChaveElevenLabs({ para: "transcricao", seLivre: true })).toEqual({ ok: true, copiada: false });
    expect(usar).toHaveBeenCalledWith({ para: "transcricao", seLivre: true });
  });

  it("escutaGravada: a escuta da ElevenLabs em uso conta; removida ou inválida, não", () => {
    expect(escutaGravada([chave("transcricao", "elevenlabs")])).toBe(true);
    expect(escutaGravada([chave("transcricao", "elevenlabs", "TSTE", "sem_credito")])).toBe(true);
    expect(escutaGravada([chave("transcricao", "elevenlabs", "TSTE", "removida")])).toBe(false);
    expect(escutaGravada([chave("transcricao", "elevenlabs", "TSTE", "invalida")])).toBe(false);
  });
});
