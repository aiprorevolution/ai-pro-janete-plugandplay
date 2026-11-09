import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { lerEscuta, lerVoz } from "@/features/plataforma/configuracao/leitura";
import { noDaVoz } from "@/features/plataforma/configuracao/Saude";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import {
  criarAcoesConfiguracaoBanco,
  modelosCurados,
  type ServidorConfiguracao,
} from "@/features/plataforma/dados/configuracao";
import type { ChaveIA } from "@/features/plataforma/exemplo";

// V1: a voz da Janete (ElevenLabs) na camada de dados da Configuração (docs/spec-voz-elevenlabs.md,
// seção 2, "Front, dados"). O servidor é falso: nada vai à rede nem ao banco.

/** O mesmo molde do servidorFalso de c5-configuracao-banco.test.tsx: toda ação responde ok. */
function servidorFalso(sobre: Partial<Record<keyof ServidorConfiguracao, unknown>> = {}) {
  const ok = (extra: Record<string, unknown> = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  const s = {
    salvarConexao: ok({ conexao_id: "cx-2", nome: "(11) 95555-0000", gateway: "meta", url_webhook: "", avisos: [] }),
    verSegredoGerado: ok({ valor: "verify-guardado-123" }),
    desconectarConexao: ok({ conexao_id: "cx-1" }),
    conferirConexao: ok({ conexao_id: "cx-1", gateway: "zapi", nome: "(11) 91234-5678", status: "conectada" }),
    consertarCampoConexao: ok({ conexao_id: "cx-1", gateway: "meta", nome: "(11) 91234-5678" }),
    salvarChaveIA: ok({ ultimos4: "ABCD", status: "ativa" }),
    revalidarChaveIA: ok({ status: "ativa", provedor: "anthropic", modelo: "claude-haiku-5-5" }),
    listarModelosDaChave: ok({ modelos: [], origem: "provedor" }),
    trocarModeloIA: ok({ modelo: "x", status: "ativa" }),
    removerChaveIA: ok(),
    salvarRitmo: ok({ espera: 9, teto: 60 }),
    listarModelos: ok({ modelos: [], origem: "provedor" }),
    listarVozes: ok({ vozes: [], atual: null }),
    escolherVoz: ok({ voz: { id: "voz-a", nome: "Ana" } }),
    salvarModoVoz: ok({ modo: "sempre" }),
    ...sobre,
  };
  return s as unknown as ServidorConfiguracao & Record<keyof ServidorConfiguracao, ReturnType<typeof vi.fn>>;
}

const CHAVE = "sk_teste_1234567890abcd";

/** As chaves relidas pela ação (o que o invalidateQueries recebeu). */
function relidas(espia: { mock: { calls: unknown[][] } }): unknown[] {
  return espia.mock.calls.map((args) => (args[0] as { queryKey: unknown }).queryKey);
}

describe("a voz em uso na camada de dados (spec-voz-uso, C3)", () => {
  it("listarVozes: devolve a lista e a atual, sem reler nada; voz fora do formato sai da lista", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso({
      listarVozes: vi.fn(async () => ({
        ok: true,
        vozes: [
          { id: "voz-a", nome: "Ana", detalhe: null, portugues: true, previa: null },
          { id: "../fora", nome: "Fora", detalhe: null, portugues: false, previa: null },
          { nome: "sem id" },
        ],
        atual: { id: "voz-a", nome: "Ana" },
      })),
    });
    const r = await criarAcoesConfiguracaoBanco(servidor, qc).listarVozes();
    expect(r).toEqual({
      ok: true,
      vozes: [{ id: "voz-a", nome: "Ana", detalhe: null, portugues: true, previa: null }],
      atual: { id: "voz-a", nome: "Ana" },
    });
    expect(servidor.listarVozes).toHaveBeenCalledTimes(1);
    expect(espia).not.toHaveBeenCalled();
  });

  it("listarVozes: recusa com a frase, resposta fora do formato e exceção viram falha sem o texto cru; sem_acesso relê o Eu", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso({ listarVozes: vi.fn(async () => ({ ok: false, erro: "sem_credito", mensagem: "Sem crédito." })) });
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.listarVozes()).toEqual({ ok: false, erro: "sem_credito", mensagem: "Sem crédito." });
    servidor.listarVozes.mockResolvedValueOnce({ ok: true, vozes: "x" });
    expect(await acoes.listarVozes()).toEqual({ ok: false, erro: "falha" });
    servidor.listarVozes.mockRejectedValueOnce(new Error(CHAVE));
    const r = await acoes.listarVozes();
    expect(r).toEqual({ ok: false, erro: "falha" });
    expect(JSON.stringify(r)).not.toContain(CHAVE);
    expect(espia).not.toHaveBeenCalled();
    servidor.listarVozes.mockResolvedValueOnce({ ok: false, erro: "sem_acesso" });
    await acoes.listarVozes();
    expect(espia).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
  });

  it("escolherVoz: chama o servidor uma vez com o id, relê a configuração e devolve o nome que veio de lá", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso({ escolherVoz: vi.fn(async () => ({ ok: true, voz: { id: "voz-a", nome: "Ana (ElevenLabs)" } })) });
    const r = await criarAcoesConfiguracaoBanco(servidor, qc).escolherVoz("voz-a");
    expect(r).toEqual({ ok: true, voz: { id: "voz-a", nome: "Ana (ElevenLabs)" } });
    expect(servidor.escolherVoz).toHaveBeenCalledTimes(1);
    expect(servidor.escolherVoz).toHaveBeenCalledWith({ vozId: "voz-a" });
    expect(relidas(espia)).toEqual(expect.arrayContaining([CHAVES.configuracao, CHAVES.auditoria]));
    // a recusa volta como veio (relê do mesmo jeito)
    servidor.escolherVoz.mockResolvedValueOnce({ ok: false, erro: "voz_nao_encontrada", mensagem: "A voz escolhida não existe mais na conta. Escolha outra voz." });
    expect(await criarAcoesConfiguracaoBanco(servidor, qc).escolherVoz("voz-z")).toMatchObject({ ok: false, erro: "voz_nao_encontrada" });
  });

  it("salvarModoVoz: chama o servidor uma vez com o modo e relê a configuração", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso();
    expect(await criarAcoesConfiguracaoBanco(servidor, qc).salvarModoVoz("sempre")).toEqual({ ok: true, modo: "sempre" });
    expect(servidor.salvarModoVoz).toHaveBeenCalledTimes(1);
    expect(servidor.salvarModoVoz).toHaveBeenCalledWith({ modo: "sempre" });
    expect(relidas(espia)).toEqual(expect.arrayContaining([CHAVES.configuracao, CHAVES.auditoria]));
  });

  it("revalidarChave('voz'): devolve o `voz` da conferência e relê também a configuração (o voz_erro)", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso({ revalidarChaveIA: vi.fn(async () => ({ ok: true, status: "ativa", voz: "nao_encontrada" })) });
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.revalidarChave("voz")).toEqual({ ok: true, voz: "nao_encontrada" });
    expect(servidor.revalidarChaveIA).toHaveBeenCalledWith({ finalidade: "voz" });
    expect(relidas(espia)).toEqual(expect.arrayContaining([CHAVES.chaves, CHAVES.configuracao, CHAVES.auditoria]));
    // um valor desconhecido não passa; as outras finalidades não releem a configuração
    servidor.revalidarChaveIA.mockResolvedValueOnce({ ok: true, voz: "talvez" });
    expect(await acoes.revalidarChave("voz")).toEqual({ ok: true });
    espia.mockClear();
    await acoes.revalidarChave("resposta");
    expect(relidas(espia)).not.toContainEqual(CHAVES.configuracao);
  });
});

describe("lerVoz (spec-voz-uso, C3)", () => {
  const voz = (extra: Partial<ChaveIA> = {}): ChaveIA => ({
    id: "k-voz",
    finalidade: "voz",
    provedor: "elevenlabs",
    modelo: "",
    status: "ativa",
    ultimos4: "VOZ1",
    ultimo_erro: null,
    validada_em: null,
    atualizada_em: "2026-11-02T12:00:00Z",
    atualizada_por: null,
    ...extra,
  });

  it("ok só com a chave ativa, a voz escolhida e sem voz_erro; o modo fora da lista vira o padrão", () => {
    const l = lerVoz({ chaves: [voz()], configuracao: { voz_resposta: "sempre", voz_id: "voz-a", voz_nome: "Ana", voz_erro: null } }, true);
    expect(l).toMatchObject({ modo: "sempre", voz: { id: "voz-a", nome: "Ana" }, aviso: null, ok: true });
    expect(lerVoz({ chaves: [voz()], configuracao: { voz_resposta: "talvez" } }, true)).toMatchObject({ modo: "quando_audio", voz: null, ok: false });
    // sem as colunas (leitura antiga): o padrão do banco
    expect(lerVoz({ chaves: [], configuracao: {} }, true)).toMatchObject({ modo: "quando_audio", voz: null, aviso: null, ok: false });
  });

  it("o aviso segue a prioridade: sem crédito, inválida, voz não encontrada, sem voz", () => {
    const cfgSumiu = { voz_id: "voz-a", voz_nome: "Ana", voz_erro: "voz_nao_encontrada" };
    expect(lerVoz({ chaves: [voz({ status: "sem_credito" })], configuracao: cfgSumiu }, true).aviso).toBe("sem_credito");
    expect(lerVoz({ chaves: [voz({ status: "invalida" })], configuracao: cfgSumiu }, true).aviso).toBe("invalida");
    // a chave sem um acesso (P7): o aviso próprio, só com a chave inválida
    expect(lerVoz({ chaves: [voz({ status: "invalida", ultimo_erro: "sem_permissao" })], configuracao: cfgSumiu }, true).aviso).toBe("sem_permissao");
    expect(lerVoz({ chaves: [voz({ status: "invalida", ultimo_erro: "http_401" })], configuracao: cfgSumiu }, true).aviso).toBe("invalida");
    expect(lerVoz({ chaves: [voz({ status: "ativa", ultimo_erro: "sem_permissao" })], configuracao: {} }, true).aviso).toBe("sem_voz");
    expect(noDaVoz(lerVoz({ chaves: [voz({ status: "invalida", ultimo_erro: "sem_permissao" })], configuracao: cfgSumiu }, true))).toBe("atencao");
    expect(lerVoz({ chaves: [voz()], configuracao: cfgSumiu }, true)).toMatchObject({ aviso: "voz_nao_encontrada", ok: false });
    expect(lerVoz({ chaves: [voz()], configuracao: {} }, true).aviso).toBe("sem_voz");
    // sem chave, nenhum aviso (o cartão mostra "Não configurada"); a escolha continua guardada
    expect(lerVoz({ chaves: [], configuracao: cfgSumiu }, true)).toMatchObject({ aviso: null, voz: { id: "voz-a", nome: "Ana" } });
  });

  it("o nó da voz na Saúde: neutro sem chave ou no 'Nunca', ok, ou atenção; nunca erro", () => {
    const cfg = { voz_id: "voz-a", voz_nome: "Ana", voz_erro: null };
    expect(noDaVoz(lerVoz({ chaves: [], configuracao: cfg }, true))).toBe("desconhecido");
    expect(noDaVoz(lerVoz({ chaves: [voz()], configuracao: { ...cfg, voz_resposta: "nunca" } }, true))).toBe("desconhecido");
    expect(noDaVoz(lerVoz({ chaves: [voz()], configuracao: cfg }, true))).toBe("ok");
    for (const status of ["sem_credito", "invalida"] as const) {
      expect(noDaVoz(lerVoz({ chaves: [voz({ status })], configuracao: cfg }, true))).toBe("atencao");
    }
    expect(noDaVoz(lerVoz({ chaves: [voz()], configuracao: {} }, true))).toBe("atencao");
    expect(noDaVoz(undefined)).toBe("desconhecido");
  });

  it("a escuta via voz: só sem chave de áudio e sem cérebro que transcreve em uso (P14)", () => {
    const cerebro = (provedor: ChaveIA["provedor"], status: ChaveIA["status"] = "ativa") =>
      voz({ id: "k-r", finalidade: "resposta", provedor, modelo: "m", status });
    expect(lerEscuta({ chaves: [cerebro("anthropic"), voz()] }, true)).toMatchObject({ viaVoz: true, ok: true });
    expect(lerEscuta({ chaves: [cerebro("openai"), voz()] }, true)).toMatchObject({ viaVoz: false, viaCerebro: true });
    // o cérebro que transcreve sem crédito ainda vem antes da voz no servidor
    expect(lerEscuta({ chaves: [cerebro("openai", "sem_credito"), voz()] }, true)).toMatchObject({ viaVoz: false, ok: false });
    expect(lerEscuta({ chaves: [cerebro("anthropic"), voz({ status: "sem_credito" })] }, true)).toMatchObject({ viaVoz: true, ok: false });
    expect(lerEscuta({ chaves: [cerebro("anthropic"), voz({ status: "invalida" })] }, true)).toMatchObject({ viaVoz: false, ok: false });
  });
});

describe("removerChaveVoz", () => {
  it("chama removerChaveIA com a finalidade voz, só uma vez, e relê as chaves", async () => {
    const qc = new QueryClient();
    const espia = vi.spyOn(qc, "invalidateQueries");
    const servidor = servidorFalso();
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.removerChaveVoz()).toEqual({ ok: true });
    expect(servidor.removerChaveIA).toHaveBeenCalledTimes(1);
    expect(servidor.removerChaveIA).toHaveBeenCalledWith({ finalidade: "voz" });
    expect(espia).toHaveBeenCalledWith({ queryKey: CHAVES.chaves });
    // a de áudio continua com a sua finalidade
    servidor.removerChaveIA.mockClear();
    await acoes.removerChaveAudio();
    expect(servidor.removerChaveIA).toHaveBeenCalledWith({ finalidade: "transcricao" });
  });

  it("a recusa do servidor volta como veio, e uma exceção vira falha sem o texto cru", async () => {
    const qc = new QueryClient();
    const servidor = servidorFalso({ removerChaveIA: vi.fn(async () => ({ ok: false, erro: "sem_chave" })) });
    const acoes = criarAcoesConfiguracaoBanco(servidor, qc);
    expect(await acoes.removerChaveVoz()).toMatchObject({ ok: false, erro: "sem_chave" });
    servidor.removerChaveIA.mockRejectedValueOnce(new Error("sk_teste_1234567890abcd"));
    const r = await acoes.removerChaveVoz();
    expect(r).toMatchObject({ ok: false, erro: "falha" });
    expect(JSON.stringify(r)).not.toContain("sk_teste_1234567890abcd");
  });
});

describe("a ElevenLabs não tem lista de modelos", () => {
  it("modelosCurados('elevenlabs') é uma lista vazia", () => {
    expect(modelosCurados("elevenlabs")).toEqual([]);
    // um motor de texto continua com a lista curada (o vazio não é por acaso)
    expect(modelosCurados("openai").length).toBeGreaterThan(0);
  });

  it("conferirChaveNova('elevenlabs') dá provedor_nao_permitido sem chamar o servidor", async () => {
    const servidor = servidorFalso();
    const acoes = criarAcoesConfiguracaoBanco(servidor, new QueryClient());
    const r = await acoes.conferirChaveNova("elevenlabs", "sk_teste_1234567890abcd");
    expect(r).toMatchObject({ ok: false, erro: "provedor_nao_permitido" });
    expect(servidor.listarModelos).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("sk_teste_1234567890abcd");
    // um motor de texto vai ao servidor
    await acoes.conferirChaveNova("openai", "sk-teste-openai-falsa");
    expect(servidor.listarModelos).toHaveBeenCalledTimes(1);
  });
});
