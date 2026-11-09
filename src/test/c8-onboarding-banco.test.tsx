import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL, juntarComGravado } from "@/features/onboarding/estado";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import { opcoesConfiguracao } from "@/features/plataforma/dados/leituras";
import {
  NADA_GRAVADO,
  cerebroGravado,
  conexaoGravada,
  contextoGravado,
  criarAcoesOnboardingBanco,
  criarDadosOnboardingMemoria,
  useDadosOnboardingBanco,
  vozGravada,
  type GravadoOnboarding,
  type RespostasGravadas,
  type ServidorOnboarding,
} from "@/features/plataforma/dados/onboarding";
import { criarClienteFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import type { ConfiguracaoDados } from "@/features/plataforma/dados/tipos";
import { MENSAGEM_SEM_MEMBRO, exigirMembro } from "@/features/servidor/membro";

// C8: o onboarding ligado ao banco. Aqui, a camada de dados dele com o cliente falso (nada vai ao
// banco), a junção com o que já foi gravado (decisão 14d), a conferência de membro das funções de
// servidor da onda 1 e a regra "a área lê só pela camada de dados".

const RESPOSTAS: RespostasGravadas = {
  empresa_oferta: "  Loja Teste  ",
  cliente_ideal: "a",
  preco: "b",
  diferenciais: "c",
  objecoes: "d",
  quando_passar_humano: "e",
  tom_voz: "f",
  horario: "g",
};

function deps(cliente: ReturnType<typeof criarClienteFalso>["cliente"], base: number | null = null) {
  const queryClient = new QueryClient();
  const invalidar = vi.spyOn(queryClient, "invalidateQueries");
  const aoGravarContexto = vi.fn();
  return { queryClient, invalidar, aoGravarContexto, acoes: criarAcoesOnboardingBanco({ cliente, queryClient, base: () => base, aoGravarContexto }) };
}

describe("salvarContexto (contexto_salvar)", () => {
  it("grava as 8 respostas sem os espaços, com origem onboarding e a versão atual como base", async () => {
    const f = criarClienteFalso({ rpc: () => ({ data: { id: 9, numero: 4 }, error: null }) });
    const { acoes, aoGravarContexto, invalidar } = deps(f.cliente, 8);
    const r = await acoes.salvarContexto(RESPOSTAS);
    expect(r).toEqual({ ok: true, id: "9", valor: { id: 9, numero: 4 } });
    expect(f.rpcs).toEqual([
      { nome: "contexto_salvar", args: { p_base: 8, p_mudancas: { ...RESPOSTAS, empresa_oferta: "Loja Teste" }, p_origem: "onboarding" } },
    ]);
    expect(aoGravarContexto).toHaveBeenCalledWith({ id: 9, numero: 4 });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.contexto });
  });

  it("sem versão gravada, a base vai nula (o banco só aceita nula quando não há versão)", async () => {
    const f = criarClienteFalso({ rpc: () => ({ data: { id: 1, numero: 1 }, error: null }) });
    const { acoes } = deps(f.cliente, null);
    await acoes.salvarContexto(RESPOSTAS);
    expect(f.rpcs[0]!.args["p_base"]).toBeNull();
  });

  it.each([
    [{ code: "P0001", message: "contexto_mudou" }, "contexto_mudou"],
    [{ code: "P0001", message: "limite_tamanho" }, "limite_tamanho"],
    [{ code: "P0001", message: "sem_acesso" }, "sem_acesso"],
    [{ code: "P0001", message: "nao_encontrado" }, "nao_encontrado"],
    [{ code: "22023", message: "mudancas_invalidas" }, "falha"],
  ] as const)("a recusa %o vira o erro %s, sem lançar", async (error, erro) => {
    const f = criarClienteFalso({ rpc: () => ({ data: null, error }) });
    const { acoes, aoGravarContexto } = deps(f.cliente, 3);
    const r = await acoes.salvarContexto(RESPOSTAS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe(erro);
    expect(aoGravarContexto).not.toHaveBeenCalled();
  });

  it("sem_acesso faz o Eu ser relido (spec 2.2)", async () => {
    const f = criarClienteFalso({ rpc: () => ({ data: null, error: { code: "42501", message: "permission denied" } }) });
    const { acoes, invalidar } = deps(f.cliente, 3);
    const r = await acoes.salvarContexto(RESPOSTAS);
    expect(r).toMatchObject({ ok: false, erro: "sem_acesso" });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
  });

  it("a rede caiu: falha, sem lançar", async () => {
    const f = criarClienteFalso({ rpc: () => Promise.reject(new TypeError("Failed to fetch")) });
    const { acoes } = deps(f.cliente, 3);
    expect(await acoes.salvarContexto(RESPOSTAS)).toMatchObject({ ok: false, erro: "falha" });
  });
});

describe("concluir (concluir_onboarding)", () => {
  it("chama a rpc, põe a data no cache da configuração (a guarda de / lê de lá) e relê do banco", async () => {
    const f = criarClienteFalso({ rpc: () => ({ data: "2026-11-02T15:00:00+00:00", error: null }) });
    const { acoes, queryClient, invalidar } = deps(f.cliente);
    const chave = opcoesConfiguracao(f.cliente).queryKey;
    queryClient.setQueryData<ConfiguracaoDados>(chave, {
      id: 1,
      espera_lote_s: 8,
      espera_lote_max_s: 40,
      onboarding_concluido_em: null,
      atualizado_em: "2026-11-01T10:00:00+00:00",
      worker_visto_em: null,
    });
    const r = await acoes.concluir();
    expect(r).toEqual({ ok: true, valor: "2026-11-02T15:00:00+00:00" });
    expect(f.rpcs.map((x) => x.nome)).toEqual(["concluir_onboarding"]);
    expect(queryClient.getQueryData<ConfiguracaoDados>(chave)?.onboarding_concluido_em).toBe("2026-11-02T15:00:00+00:00");
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.configuracao });
  });

  it("o atendente (ou conta sem acesso) recebe sem_acesso", async () => {
    const f = criarClienteFalso({ rpc: () => ({ data: null, error: { code: "P0001", message: "sem_acesso" } }) });
    const { acoes } = deps(f.cliente);
    expect(await acoes.concluir()).toMatchObject({ ok: false, erro: "sem_acesso" });
  });
});

describe("o que já foi gravado (decisão 14d)", () => {
  const conexao = {
    id: "c1",
    nome: "+55 11 91234-5678",
    gateway: "meta" as const,
    status: "conectada" as const,
    ativa: true,
    oficial: true,
    id_externo: "123",
    ultimo_erro: null,
    criado_em: "2026-11-02T10:00:00Z",
    atualizado_em: "2026-11-02T10:00:00Z",
  };

  it("a conexão conta só ativa, não desconectada, de um gateway do onboarding e com nome", () => {
    expect(conexaoGravada(conexao)).toEqual({ gateway: "meta", nome: "+55 11 91234-5678" });
    expect(conexaoGravada({ ...conexao, status: "erro" })).toEqual({ gateway: "meta", nome: "+55 11 91234-5678" });
    expect(conexaoGravada({ ...conexao, ativa: false })).toBeNull();
    expect(conexaoGravada({ ...conexao, status: "desconectada" })).toBeNull();
    expect(conexaoGravada({ ...conexao, gateway: "descontinuado" })).toBeNull();
    expect(conexaoGravada({ ...conexao, nome: "  " })).toBeNull();
    expect(conexaoGravada(null)).toBeNull();
  });

  const chave = {
    id: "k1",
    finalidade: "resposta" as const,
    provedor: "anthropic" as const,
    modelo: "claude-haiku-5-5",
    status: "ativa" as const,
    ultimos4: "abcd",
    ultimo_erro: null,
    validada_em: null,
    atualizada_em: "2026-11-02T10:00:00Z",
    atualizada_por: null,
  };

  it("a chave conta só a de resposta, ativa, de um motor do onboarding", () => {
    expect(cerebroGravado([chave])).toEqual({ provedor: "anthropic", modelo: "claude-haiku-5-5", ultimos4: "abcd" });
    expect(cerebroGravado([{ ...chave, finalidade: "transcricao" }])).toBeNull();
    expect(cerebroGravado([{ ...chave, status: "invalida" }])).toBeNull();
    expect(cerebroGravado([{ ...chave, provedor: "groq" }])).toBeNull();
    expect(cerebroGravado([])).toBeNull();
  });

  it("a chave de voz conta só a da ElevenLabs, ativa e com os 4 últimos, sem exigir modelo", () => {
    const voz = { ...chave, finalidade: "voz" as const, provedor: "elevenlabs" as const, modelo: "", ultimos4: "wxyz" };
    expect(vozGravada([voz])).toEqual({ ultimos4: "wxyz" });
    // a linha de voz no meio das outras
    expect(vozGravada([chave, voz])).toEqual({ ultimos4: "wxyz" });
    expect(vozGravada([{ ...voz, status: "removida" }])).toBeNull();
    expect(vozGravada([{ ...voz, status: "invalida" }])).toBeNull();
    expect(vozGravada([{ ...voz, finalidade: "transcricao" }])).toBeNull();
    expect(vozGravada([{ ...voz, provedor: "openai" }])).toBeNull();
    expect(vozGravada([{ ...voz, ultimos4: "" }])).toBeNull();
    expect(vozGravada([{ ...voz, ultimos4: "   " }])).toBeNull();
    expect(vozGravada([chave])).toBeNull();
    expect(vozGravada([])).toBeNull();
    expect(vozGravada(null)).toBeNull();
    // a linha de voz nunca vira cérebro
    expect(cerebroGravado([voz])).toBeNull();
    expect(cerebroGravado([{ ...voz, modelo: "eleven_multilingual_v2" }])).toBeNull();
    expect(cerebroGravado([voz, chave])).toEqual({ provedor: "anthropic", modelo: "claude-haiku-5-5", ultimos4: "abcd" });
  });

  it("o Contexto traz o id (a base) e as 8 respostas", () => {
    const v = {
      id: 5,
      empresa_oferta: "Loja",
      cliente_ideal: "a",
      preco: "b",
      diferenciais: "c",
      objecoes: "d",
      quando_passar_humano: "e",
      tom_voz: "f",
      horario: "g",
      itens: [],
      origem: "onboarding" as const,
      criado_por: null,
      criado_em: "2026-11-02T10:00:00Z",
      numero: 2,
      restaurada_de: null,
    };
    expect(contextoGravado(v)).toEqual({
      id: 5,
      respostas: { empresa_oferta: "Loja", cliente_ideal: "a", preco: "b", diferenciais: "c", objecoes: "d", quando_passar_humano: "e", tom_voz: "f", horario: "g" },
    });
    expect(contextoGravado(null)).toBeNull();
  });

  const tudo: GravadoOnboarding = {
    conexao: { gateway: "evolution", nome: "vendas" },
    cerebro: { provedor: "openrouter", modelo: "anthropic/claude-haiku-5.5", ultimos4: "wxyz" },
    voz: null,
    escuta: false,
    contexto: null,
  };

  it("aba nova: começa na primeira etapa que falta (sem Contexto, pelo despertar)", () => {
    expect(juntarComGravado(ESTADO_INICIAL, false, NADA_GRAVADO).etapa).toBe("conexao");
    expect(juntarComGravado(ESTADO_INICIAL, false, { ...NADA_GRAVADO, conexao: tudo.conexao }).etapa).toBe("cerebro");
    const j = juntarComGravado(ESTADO_INICIAL, false, tudo);
    expect(j.etapa).toBe("despertar");
    expect(j.conexao).toEqual({ modo: "naooficial", gateway: "evolution", rotulo: "vendas" });
    expect(j.cerebro).toEqual({ provedor: "openrouter", modelo: "anthropic/claude-haiku-5.5", ultimos4: "wxyz" });
  });

  it("aba com estado: a etapa da aba vale se for antes do que falta; senão, o que falta", () => {
    const naConversa = { ...ESTADO_INICIAL, etapa: "conversa" as const, conversa: { respostas: { preco: "100" }, confirmado: false } };
    const j = juntarComGravado(naConversa, true, tudo);
    expect(j.etapa).toBe("conversa");
    // a conversa em andamento (ainda não gravada) continua
    expect(j.conversa).toEqual({ respostas: { preco: "100" }, confirmado: false });
    expect(juntarComGravado({ ...ESTADO_INICIAL, etapa: "preparando" }, true, tudo).etapa).toBe("conversa");
    expect(juntarComGravado({ ...ESTADO_INICIAL, etapa: "conexao" }, true, tudo).etapa).toBe("conexao");
  });

  it("com o Contexto gravado: as respostas são as do banco, já confirmadas, e a etapa é o preparo", () => {
    const respostas = { ...RESPOSTAS, empresa_oferta: "Loja Teste" };
    const j = juntarComGravado({ ...ESTADO_INICIAL, conversa: { respostas: { preco: "velho" }, confirmado: false } }, false, {
      ...tudo,
      contexto: { id: 4, respostas },
    });
    expect(j.etapa).toBe("preparando");
    expect(j.conversa).toEqual({ respostas, confirmado: true });
  });

  it("o banco vale sobre a aba: conexão e chave que a aba tinha, mas o banco não, somem", () => {
    const aba = {
      ...ESTADO_INICIAL,
      etapa: "despertar" as const,
      conexao: { modo: "oficial" as const, gateway: "meta" as const, rotulo: "+55 velho" },
      cerebro: { provedor: "openai" as const, modelo: "gpt", ultimos4: "1234" },
    };
    const j = juntarComGravado(aba, true, NADA_GRAVADO);
    expect(j.etapa).toBe("conexao");
    expect(j.conexao).toEqual({ modo: null, gateway: null, rotulo: null });
    expect(j.cerebro).toEqual({ provedor: null, modelo: null, ultimos4: null });
    expect(j.concluidoEm).toBeNull();
  });

  it("a voz nunca entra no que falta: uma aba na voz continua na voz", () => {
    const naVoz = { ...ESTADO_INICIAL, etapa: "voz" as const };
    expect(juntarComGravado(naVoz, true, tudo).etapa).toBe("voz");
    // com o Contexto gravado (falta só o preparo), a voz ainda vem antes: fica nela
    expect(juntarComGravado(naVoz, true, { ...tudo, contexto: { id: 4, respostas: RESPOSTAS } }).etapa).toBe("voz");
    // sem a chave do cérebro no banco, volta para o cérebro, como as outras etapas
    expect(juntarComGravado(naVoz, true, { ...tudo, cerebro: null }).etapa).toBe("cerebro");
  });

  it("a voz nunca entra no que falta: uma aba nova sem Contexto abre no despertar, com ou sem voz gravada", () => {
    expect(juntarComGravado(ESTADO_INICIAL, false, tudo).etapa).toBe("despertar");
    expect(juntarComGravado(ESTADO_INICIAL, false, { ...tudo, voz: { ultimos4: "abcd" } }).etapa).toBe("despertar");
  });

  it("a chave de voz do banco preenche o ultimos4 e zera o pulou", () => {
    const aba = { ...ESTADO_INICIAL, etapa: "voz" as const, voz: { ultimos4: null, pulou: true } };
    const j = juntarComGravado(aba, true, { ...tudo, voz: { ultimos4: "abcd" } });
    expect(j.voz).toEqual({ ultimos4: "abcd", pulou: false });
    // numa aba nova, também
    expect(juntarComGravado(ESTADO_INICIAL, false, { ...tudo, voz: { ultimos4: "abcd" } }).voz).toEqual({
      ultimos4: "abcd",
      pulou: false,
    });
  });

  it("sem chave de voz no banco: o pulou vem da aba e o ultimos4 fica null", () => {
    const pulou = { ...ESTADO_INICIAL, etapa: "conversa" as const, voz: { ultimos4: null, pulou: true } };
    expect(juntarComGravado(pulou, true, tudo).voz).toEqual({ ultimos4: null, pulou: true });
    // um ultimos4 que a aba tinha, mas o banco não, some (o banco vale sobre a aba)
    const comChave = { ...ESTADO_INICIAL, etapa: "voz" as const, voz: { ultimos4: "wxyz", pulou: false } };
    expect(juntarComGravado(comChave, true, tudo).voz).toEqual({ ultimos4: null, pulou: false });
    expect(juntarComGravado(ESTADO_INICIAL, false, NADA_GRAVADO).voz).toEqual({ ultimos4: null, pulou: false });
  });
});

describe("useDadosOnboardingBanco: as leituras comuns da camada", () => {
  it("lê a conexão ativa, as chaves e o Contexto atual pelas colunas listadas, e junta no gravado", async () => {
    const f = criarClienteFalso({
      consulta: (c) => {
        if (c.tabela === "conexoes")
          return { data: { id: "c1", nome: "+55 11 90000-0000", gateway: "zapi", status: "conectada", ativa: true }, error: null };
        if (c.tabela === "ia_chaves")
          return {
            data: [
              { finalidade: "voz", provedor: "elevenlabs", modelo: "", status: "ativa", ultimos4: "vvvv" },
              { finalidade: "resposta", provedor: "openai", modelo: "gpt-x", status: "ativa", ultimos4: "abcd" },
            ],
            error: null,
          };
        if (c.tabela === "contexto_versoes") return { data: null, error: null };
        return undefined;
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const servidor: ServidorOnboarding = {
      salvarConexao: vi.fn(),
      salvarChaveIA: vi.fn(),
      pedirQr: vi.fn(),
      listarVozes: vi.fn(),
      escolherVoz: vi.fn(),
      desconectarCelular: vi.fn(),
      usarChaveElevenLabs: vi.fn(),
    };
    const { result } = renderHook(() => useDadosOnboardingBanco(f.cliente, servidor), { wrapper });
    expect(result.current.gravado.carregando).toBe(true);
    await waitFor(() => expect(result.current.gravado.dados).toBeDefined());
    expect(result.current.gravado.dados).toEqual({
      conexao: { gateway: "zapi", nome: "+55 11 90000-0000" },
      cerebro: { provedor: "openai", modelo: "gpt-x", ultimos4: "abcd" },
      // a linha "voz" vira a voz gravada, e nunca o cérebro
      voz: { ultimos4: "vvvv" },
      // a chave da voz também transcreve: o aviso do áudio da Anthropic não aparece
      escuta: true,
      contexto: null,
    });
    // nunca select('*') em conexoes nem em ia_chaves
    for (const c of f.consultas.filter((x) => x.tabela === "conexoes" || x.tabela === "ia_chaves")) {
      expect(c.valor).not.toBe("*");
      expect(String(c.valor)).not.toMatch(/segredos|chave_cifrada/);
    }
    queryClient.clear();
  });

  it("a leitura que falha dá o erro traduzido e o Tentar de novo relê", async () => {
    let falhar = true;
    const f = criarClienteFalso({
      consulta: (c) => (c.tabela === "contexto_versoes" && falhar ? { data: null, error: { code: "42501", message: "x" } } : undefined),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const servidor: ServidorOnboarding = {
      salvarConexao: vi.fn(),
      salvarChaveIA: vi.fn(),
      pedirQr: vi.fn(),
      listarVozes: vi.fn(),
      escolherVoz: vi.fn(),
      desconectarCelular: vi.fn(),
      usarChaveElevenLabs: vi.fn(),
    };
    const { result } = renderHook(() => useDadosOnboardingBanco(f.cliente, servidor), { wrapper });
    await waitFor(() => expect(result.current.gravado.erro).toBe("sem_acesso"));
    expect(result.current.gravado.dados).toBeUndefined();
    falhar = false;
    result.current.gravado.tentarDeNovo();
    await waitFor(() => expect(result.current.gravado.dados).toEqual(NADA_GRAVADO));
    queryClient.clear();
  });

  it("salvarConexao e salvarChaveIA vão à função de servidor; o sucesso deixa a leitura velha", async () => {
    const f = criarClienteFalso();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const servidor: ServidorOnboarding = {
      salvarConexao: vi.fn(async () => ({
        ok: true as const,
        conexao_id: "c1",
        nome: "+55",
        gateway: "zapi" as const,
        url_webhook: "https://x",
        avisos: [],
      })),
      salvarChaveIA: vi.fn(async () => ({ ok: false as const, erro: "sem_acesso" as const })),
      pedirQr: vi.fn(),
      listarVozes: vi.fn(),
      escolherVoz: vi.fn(),
      desconectarCelular: vi.fn(),
      usarChaveElevenLabs: vi.fn(),
    };
    const { result } = renderHook(() => useDadosOnboardingBanco(f.cliente, servidor), { wrapper });
    await result.current.salvarConexao({ gateway: "zapi", campos: { instanceId: "1" } });
    expect(servidor.salvarConexao).toHaveBeenCalledWith({ gateway: "zapi", campos: { instanceId: "1" } });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.conexao });
    await result.current.salvarChaveIA({ finalidade: "resposta", provedor: "openai", modelo: "m", chave: "k" });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
    expect(invalidar).not.toHaveBeenCalledWith({ queryKey: CHAVES.chaves });
    queryClient.clear();
  });

  it("listarVozes vai direto ao servidor sem reler; escolherVoz relê a configuracao no ok e o eu no sem_acesso", async () => {
    const f = criarClienteFalso();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidar = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const lista = { ok: true as const, vozes: [], atual: null };
    const escolherVoz = vi
      .fn<ServidorOnboarding["escolherVoz"]>()
      .mockResolvedValueOnce({ ok: true, voz: { id: "v1", nome: "Ana" } })
      .mockResolvedValueOnce({ ok: false, erro: "sem_acesso" })
      .mockRejectedValueOnce(new Error("rede"));
    const servidor: ServidorOnboarding = {
      salvarConexao: vi.fn(),
      salvarChaveIA: vi.fn(),
      pedirQr: vi.fn(),
      listarVozes: vi.fn(async () => lista),
      escolherVoz,
      desconectarCelular: vi.fn(),
      usarChaveElevenLabs: vi.fn(),
    };
    const { result } = renderHook(() => useDadosOnboardingBanco(f.cliente, servidor), { wrapper });
    await waitFor(() => expect(result.current.gravado.dados).toBeDefined());
    invalidar.mockClear();

    expect(await result.current.listarVozes()).toEqual(lista);
    expect(servidor.listarVozes).toHaveBeenCalledTimes(1);
    expect(invalidar).not.toHaveBeenCalled();

    expect(await result.current.escolherVoz({ vozId: "v1" })).toEqual({ ok: true, voz: { id: "v1", nome: "Ana" } });
    expect(escolherVoz).toHaveBeenCalledWith({ vozId: "v1" });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.configuracao });

    invalidar.mockClear();
    expect(await result.current.escolherVoz({ vozId: "v2" })).toEqual({ ok: false, erro: "sem_acesso" });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
    expect(invalidar).not.toHaveBeenCalledWith({ queryKey: CHAVES.configuracao });

    await expect(result.current.escolherVoz({ vozId: "v3" })).rejects.toThrow("rede");
    queryClient.clear();
  });

  it("no modo de teste, listarVozes e escolherVoz não passados rejeitam", async () => {
    const dados = criarDadosOnboardingMemoria();
    await expect(dados.listarVozes()).rejects.toThrow("listarVozes não foi passado ao modo de teste");
    await expect(dados.escolherVoz({ vozId: "v1" })).rejects.toThrow("escolherVoz não foi passado ao modo de teste");
  });
});

describe("validadores da onda 1 exigem membro (exigirMembro)", () => {
  it("membro ativo: segue (null)", async () => {
    const f = criarClienteFalso({ rpc: (nome) => (nome === "eh_membro" ? { data: true, error: null } : undefined) });
    expect(await exigirMembro(f.cliente)).toBeNull();
    expect(f.rpcs.map((r) => r.nome)).toEqual(["eh_membro"]);
  });

  it.each([
    ["não é membro", { data: false, error: null }],
    ["erro do banco", { data: null, error: { code: "42501", message: "x" } }],
  ])("%s: recusa com sem_acesso e a mensagem", async (_nome, resposta) => {
    const f = criarClienteFalso({ rpc: () => resposta });
    expect(await exigirMembro(f.cliente)).toEqual({ ok: false, erro: "sem_acesso", mensagem: MENSAGEM_SEM_MEMBRO });
  });

  it("a pergunta falhou (rede): recusa, sem falar com o provedor", async () => {
    const f = criarClienteFalso({ rpc: () => Promise.reject(new Error("rede")) });
    expect(await exigirMembro(f.cliente)).toMatchObject({ ok: false, erro: "sem_acesso" });
  });

  it("os três handlers chamam exigirMembro antes da lógica", () => {
    for (const arquivo of ["validar-conexao.functions.ts", "validar-chave-ia.functions.ts", "listar-modelos.functions.ts"]) {
      const texto = readFileSync(join(process.cwd(), "src/features/servidor", arquivo), "utf8");
      const handler = texto.slice(texto.indexOf(".handler("));
      expect(handler.indexOf("exigirMembro(context.firebase)")).toBeGreaterThan(-1);
      expect(handler.indexOf("exigirMembro(")).toBeLessThan(handler.indexOf("Logica(data)"));
    }
  });
});

describe("a área lê só pela camada de dados", () => {
  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((nome) => {
      const caminho = join(pasta, nome);
      return statSync(caminho).isDirectory() ? arquivos(caminho) : /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
    });
  }
  const daArea = [...arquivos(join(process.cwd(), "src/features/onboarding")), join(process.cwd(), "src/features/plataforma/dados/onboarding.ts")];

  it("nenhum useExemplo nem ProvedorExemplo no onboarding", () => {
    for (const f of daArea) expect(readFileSync(f, "utf8"), f).not.toMatch(/useExemplo|ProvedorExemplo/);
  });

  it("o onboarding não chama mais o validador da conexão nem o da chave (grava pela salvarConexao e salvarChaveIA)", () => {
    for (const f of daArea) expect(readFileSync(f, "utf8"), f).not.toMatch(/validarConexao\(|validarChaveIA\(|validar-(conexao|chave-ia)\.functions/);
  });

  it("nenhuma consulta direta ao banco nas etapas: só pela camada (dados/onboarding.ts)", () => {
    for (const f of daArea.filter((x) => x.includes("features/onboarding/"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\.from\(["']|\.rpc\(/);
    }
  });
});
