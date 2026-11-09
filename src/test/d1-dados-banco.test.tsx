import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHAVES, INVALIDA, ProvedorDados, criarAcoesBanco, useDados, type FonteDados } from "@/features/plataforma/dados";
import { criarClienteFalso, type Consulta, type OpcoesFalso, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";

// F1: o modo banco do ProvedorDados, com um cliente do Firebase falso (nada vai à rede): as ações
// chamam as rpcs e tabelas do banco (as do pacote inclusive), tratam 0 linhas, invalidam pela
// tabela INVALIDA; as leituras listam as colunas (nunca '*') e leem tudo de 1.000 em 1.000.

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CV = "11111111-1111-4111-8111-111111111111";
const CT = "22222222-2222-4222-8222-222222222222";
const ET = "33333333-3333-4333-8333-333333333333";

const membro = (papel: "admin" | "atendente", ativo = true) => ({
  id: "mb-1",
  nome: "Ana",
  email: "ana@teste.com",
  papel,
  ativo,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
});

function novoQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(cleanup);

describe("ações do modo banco", () => {
  function preparar(opcoes: OpcoesFalso = {}) {
    const f = criarClienteFalso({ uid: UID, ...opcoes });
    const qc = novoQueryClient();
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    const servidor = {
      pedirEnvio: vi.fn(() => Promise.resolve()),
      garantirBucketMidias: vi.fn(() => Promise.resolve({ ok: true })),
      marcarLidaNoWhatsApp: vi.fn(() => Promise.resolve()),
      apagarContato: vi.fn(() => Promise.resolve({ ok: true })),
    };
    const acoes = criarAcoesBanco(f.cliente, qc, servidor);
    const raizesInvalidadas = () => invalidar.mock.calls.map((c) => (c[0] as { queryKey: readonly string[] }).queryKey[0]);
    return { f, qc, acoes, servidor, raizesInvalidadas };
  }

  it("assumir, devolver e marcar como lida chamam as rpcs de hoje", async () => {
    const { f, acoes, servidor } = preparar();
    expect(await acoes.assumir(CV)).toEqual({ ok: true, assumiu: true });
    expect(await acoes.devolverParaJanete(CV)).toEqual({ ok: true });
    expect(await acoes.marcarLida(CV)).toEqual({ ok: true });
    expect(f.rpcs).toEqual([
      { nome: "assumir_conversa", args: { p_conversa: CV } },
      { nome: "devolver_para_janete", args: { p_conversa: CV } },
      { nome: "marcar_lida", args: { p_conversa: CV } },
    ]);
    // o "lido" no WhatsApp vai junto (decisão 6)
    expect(servidor.marcarLidaNoWhatsApp).toHaveBeenCalledWith(CV);
  });

  it("toda ação que deu certo invalida as raízes da tabela INVALIDA", async () => {
    const { acoes, raizesInvalidadas } = preparar({ consulta: () => ({ data: [{ id: CT }], error: null }) });
    await acoes.assumir(CV);
    expect(raizesInvalidadas().sort()).toEqual([...INVALIDA.assumir].sort());

    const outro = preparar({ consulta: () => ({ data: [{ id: CT }], error: null }) });
    await outro.acoes.moverEtapa(CT, ET);
    expect(outro.raizesInvalidadas().sort()).toEqual([...INVALIDA.moverEtapa].sort());
  });

  it("a recusa do banco volta traduzida e não invalida nada; sem_acesso relê o Eu", async () => {
    const { acoes, raizesInvalidadas } = preparar({
      rpc: (nome) =>
        nome === "assumir_conversa"
          ? { data: null, error: { code: "P0001", message: "conversa_nao_encontrada" } }
          : { data: null, error: { code: "P0001", message: "sem_acesso" } },
    });
    expect(await acoes.assumir(CV)).toEqual({ ok: false, erro: "nao_encontrado" });
    expect(raizesInvalidadas()).toEqual([]);
    expect(await acoes.devolverParaJanete(CV)).toEqual({ ok: false, erro: "sem_acesso" });
    expect(raizesInvalidadas()).toEqual([CHAVES.eu[0]]);
  });

  it("mover e editar: update com .select('id'); 0 linhas é nao_encontrado", async () => {
    let linhas: unknown[] = [];
    const { f, acoes } = preparar({ consulta: () => ({ data: linhas, error: null }) });
    expect(await acoes.moverEtapa(CT, ET)).toEqual({ ok: false, erro: "nao_encontrado", detalhe: "nenhuma linha alterada em contatos" });
    const upd = f.consultas.at(-1)!;
    expect(upd).toMatchObject({ tabela: "contatos", op: "update", valor: { etapa_id: ET }, comSelect: "id" });
    expect(upd.passos).toContainEqual(["eq", "id", CT]);

    linhas = [{ id: CT }];
    expect(await acoes.moverEtapa(CT, ET)).toEqual({ ok: true });
    expect(await acoes.editarContato(CT, { nome: "  Ana  ", empresa: "" })).toEqual({ ok: true });
    expect(f.consultas.at(-1)).toMatchObject({ tabela: "contatos", op: "update", valor: { nome: "Ana", empresa: null }, comSelect: "id" });

    expect(await acoes.editarEtapa(ET, { nome: "  Quente  ", cor: " " })).toEqual({ ok: true });
    expect(f.consultas.at(-1)).toMatchObject({ tabela: "etapas", op: "update", valor: { nome: "Quente", cor: null }, comSelect: "id" });
  });

  it("editar etapa com nome vazio é recusado antes de ir ao banco; o check do banco também vira nome_vazio", async () => {
    const { f, acoes } = preparar({
      consulta: () => ({ data: null, error: { code: "23514", message: 'violates check constraint "etapas_nome_check"' } }),
    });
    expect(await acoes.editarEtapa(ET, { nome: "   " })).toEqual({ ok: false, erro: "nome_vazio" });
    expect(f.consultas).toHaveLength(0);
    expect(await acoes.editarEtapa(ET, { nome: "ok" })).toEqual({ ok: false, erro: "nome_vazio" });
  });

  it("tentar de novo, reordenar e marcar visto chamam as funções do pacote do banco, tipadas (sem atalho)", async () => {
    const { f, acoes, servidor } = preparar({
      rpc: (nome) => (nome === "marcar_visto" ? { data: "2026-11-02T12:00:00.000Z", error: null } : undefined),
    });
    expect(await acoes.tentarDeNovo("msg-1")).toEqual({ ok: true, id: "msg-1" });
    expect(servidor.pedirEnvio).toHaveBeenCalledTimes(1);
    expect(await acoes.reordenarEtapas([ET, CT])).toEqual({ ok: true });
    expect(await acoes.marcarVisto("kanban")).toEqual({ ok: true, valor: "2026-11-02T12:00:00.000Z" });
    expect(f.rpcs).toEqual([
      { nome: "reenviar_mensagem", args: { p_msg: "msg-1" } },
      { nome: "reordenar_etapas", args: { p_ids: [ET, CT] } },
      { nome: "marcar_visto", args: { p_onde: "kanban" } },
    ]);
  });

  it("tentar de novo recusado (nao_reenviavel) não pede passada", async () => {
    const { acoes, servidor } = preparar({ rpc: () => ({ data: null, error: { code: "P0001", message: "nao_reenviavel" } }) });
    expect(await acoes.tentarDeNovo("msg-1")).toEqual({ ok: false, erro: "nao_reenviavel" });
    expect(servidor.pedirEnvio).not.toHaveBeenCalled();
  });

  it("apagar contato vai pela função de servidor (F4); a recusa dela volta traduzida", async () => {
    const { acoes, servidor } = preparar();
    expect(await acoes.apagarContato(CT)).toEqual({ ok: true });
    expect(servidor.apagarContato).toHaveBeenCalledWith(CT);
    servidor.apagarContato.mockResolvedValueOnce({ ok: false, erro: "sem_acesso" } as never);
    expect(await acoes.apagarContato(CT)).toEqual({ ok: false, erro: "sem_acesso" });
  });

  it("sem a função de servidor, apagar contato devolve falha (não quebra)", async () => {
    const f = criarClienteFalso({ uid: UID });
    const acoes = criarAcoesBanco(f.cliente, novoQueryClient());
    const r = await acoes.apagarContato(CT);
    expect(r).toMatchObject({ ok: false, erro: "falha" });
  });

  it("enviar: insert na_fila sem conexao_id e, depois, a passada de envio", async () => {
    const { f, acoes, servidor, raizesInvalidadas } = preparar();
    const r = await acoes.enviarMensagem(CV, { tipo: "texto", texto: "oi" });
    expect(r.ok && r.id).toMatch(/^[0-9a-f-]{36}$/);
    const linha = f.consultas.find((c) => c.op === "insert")!.valor as Record<string, unknown>;
    expect(linha).toMatchObject({ status: "na_fila", conversa_id: CV });
    expect("conexao_id" in linha).toBe(false);
    expect(servidor.pedirEnvio).toHaveBeenCalledTimes(1);
    expect(raizesInvalidadas().sort()).toEqual([...INVALIDA.enviarMensagem].sort());
  });

  it("enviar grava a citação (responde_a_id) e a duração do áudio (midia_duracao_s)", async () => {
    const { f, acoes } = preparar();
    await acoes.enviarMensagem(CV, { tipo: "texto", texto: "respondendo", citaId: "msg-citada" });
    const texto = f.consultas.filter((c) => c.op === "insert").at(-1)!.valor as Record<string, unknown>;
    expect(texto).toMatchObject({ responde_a_id: "msg-citada", midia_duracao_s: null });

    const audio = new Blob(["a"], { type: "audio/mp4" });
    await acoes.enviarMensagem(CV, { tipo: "audio", arquivo: audio, midia: { nome: "audio.m4a", mime: "audio/mp4", duracaoS: 12.4 } });
    const gravado = f.consultas.filter((c) => c.op === "insert").at(-1)!.valor as Record<string, unknown>;
    expect(gravado).toMatchObject({ tipo: "audio", responde_a_id: null, midia_duracao_s: 12 });
  });

  describe("o assumiu exato, pelo estado da conversa antes da ação (como o gatilho)", () => {
    const EU = membro("admin");
    function comConversa(antes: { modo: "janete" | "humano"; responsavel_id: string | null } | null) {
      const p = preparar({
        consulta: (c) =>
          c.tabela === "conversas" && c.op === "select" ? { data: antes ? { id: CV, ...antes } : null, error: null } : undefined,
      });
      p.qc.setQueryData(CHAVES.eu, { ...EU, vistos: {} });
      return p;
    }

    it.each([
      ["com a Janete", { modo: "janete", responsavel_id: null }, true],
      ["na espera (ninguém responsável)", { modo: "humano", responsavel_id: null }, true],
      ["com outra pessoa", { modo: "humano", responsavel_id: "mb-outra" }, false],
      ["já comigo", { modo: "humano", responsavel_id: EU.id }, false],
    ] as const)("enviar numa conversa %s: assumiu = %s", async (_nome, antes, assumiu) => {
      const { f, acoes } = comConversa(antes);
      const r = await acoes.enviarMensagem(CV, { tipo: "texto", texto: "oi" });
      expect(r).toMatchObject({ ok: true, assumiu });
      // o estado foi lido antes do insert, só com o modo e o responsável
      const ops = f.consultas.map((c) => `${c.tabela}:${c.op}`);
      expect(ops.indexOf("conversas:select")).toBeLessThan(ops.indexOf("mensagens:insert"));
      expect(f.consultas.find((c) => c.tabela === "conversas")).toMatchObject({ valor: "modo, responsavel_id" });
    });

    it("enviar sem conseguir ler a conversa não afirma assumiu (e envia do mesmo jeito)", async () => {
      const { f, acoes } = comConversa(null);
      const r = await acoes.enviarMensagem(CV, { tipo: "texto", texto: "oi" });
      expect(r.ok).toBe(true);
      expect("assumiu" in r).toBe(false);
      expect(f.consultas.some((c) => c.op === "insert")).toBe(true);
    });

    it("duas mensagens seguidas: cada uma lê o estado depois de a anterior gravar", async () => {
      let modo: "janete" | "humano" = "janete";
      let responsavel: string | null = null;
      const f = criarClienteFalso({
        uid: UID,
        consulta: (c) => (c.tabela === "conversas" ? { data: { modo, responsavel_id: responsavel }, error: null } : undefined),
        insert: () => {
          // o gatilho: a mensagem da tela tira a Janete e põe quem mandou
          modo = "humano";
          responsavel = EU.id;
          return { data: null, error: null };
        },
      });
      const qc = novoQueryClient();
      const acoes = criarAcoesBanco(f.cliente, qc, { pedirEnvio: () => Promise.resolve() });
      const [a, b] = await Promise.all([
        acoes.enviarMensagem(CV, { tipo: "texto", texto: "1" }),
        acoes.enviarMensagem(CV, { tipo: "texto", texto: "2" }),
      ]);
      expect(a).toMatchObject({ ok: true, assumiu: true });
      expect(b).toMatchObject({ ok: true, assumiu: false });
    });

    it.each([
      ["com a Janete", { modo: "janete", responsavel_id: null }, { ok: true, assumiu: true }],
      ["na espera", { modo: "humano", responsavel_id: null }, { ok: true, assumiu: true }],
      ["com o celular (humano sem responsável)", { modo: "humano", responsavel_id: null }, { ok: true, assumiu: true }],
      ["com outra pessoa", { modo: "humano", responsavel_id: "mb-outra" }, { ok: true, assumiu: true }],
      ["já comigo (o banco não grava evento)", { modo: "humano", responsavel_id: EU.id }, { ok: true }],
    ] as const)("assumir uma conversa %s", async (_nome, antes, esperado) => {
      const { f, acoes } = comConversa(antes);
      expect(await acoes.assumir(CV)).toEqual(esperado);
      expect(f.rpcs).toEqual([{ nome: "assumir_conversa", args: { p_conversa: CV } }]);
    });

    it("assumir recusado volta o erro, sem assumiu", async () => {
      const p = preparar({ rpc: () => ({ data: null, error: { code: "P0001", message: "sem_acesso" } }) });
      expect(await p.acoes.assumir(CV)).toEqual({ ok: false, erro: "sem_acesso" });
    });
  });

  it("nunca lança: a exceção do cliente vira falha", async () => {
    const { acoes } = preparar({
      rpc: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await acoes.assumir(CV)).toEqual({ ok: false, erro: "falha", detalhe: "Failed to fetch" });
  });
});

describe("leituras do modo banco", () => {
  type Lidas = Partial<{
    membros: ReturnType<FonteDados["useMembros"]>;
    etapas: ReturnType<FonteDados["useEtapas"]>;
    conexao: ReturnType<FonteDados["useConexaoAtiva"]>;
    configuracao: ReturnType<FonteDados["useConfiguracao"]>;
    contexto: ReturnType<FonteDados["useContextoAtual"]>;
    aguardando: ReturnType<FonteDados["useAguardando"]>;
    chaves: ReturnType<FonteDados["useChaves"]>;
    eu: ReturnType<FonteDados["useEu"]>;
  }>;

  function montar(responder: (c: Consulta) => Resposta | undefined, filho: (l: Lidas) => ReactNode = () => null) {
    const f = criarClienteFalso({ uid: UID, consulta: responder });
    const qc = novoQueryClient();
    const lidas: Lidas = {};
    function Leitor() {
      const d = useDados();
      lidas.membros = d.useMembros();
      lidas.etapas = d.useEtapas();
      lidas.conexao = d.useConexaoAtiva();
      lidas.configuracao = d.useConfiguracao();
      lidas.contexto = d.useContextoAtual();
      lidas.aguardando = d.useAguardando();
      lidas.chaves = d.useChaves();
      lidas.eu = d.useEu();
      return <>{filho(lidas)}</>;
    }
    const aoPerderAcesso = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ProvedorDados fonte="banco" cliente={f.cliente} aoPerderAcesso={aoPerderAcesso}>
          <Suspense fallback={null}>
            <Leitor />
          </Suspense>
        </ProvedorDados>
      </QueryClientProvider>,
    );
    return { f, qc, lidas, aoPerderAcesso };
  }

  const responderPadrao =
    (papel: "admin" | "atendente", extra?: (c: Consulta) => Resposta | undefined) =>
    (c: Consulta): Resposta | undefined => {
      const r = extra?.(c);
      if (r) return r;
      if (c.tabela === "membros" && c.unica) return { data: membro(papel), error: null };
      if (c.tabela === "configuracao")
        return {
          data: { id: 1, espera_lote_s: 8, espera_lote_max_s: 45, onboarding_concluido_em: null, atualizado_em: "x" },
          error: null,
        };
      if (c.tabela === "contexto_versoes") return { data: { id: 7, tom_voz: "leve" }, error: null };
      return undefined;
    };

  it("as colunas vão listadas, uma a uma, nunca '*'", async () => {
    const { f, lidas } = montar(responderPadrao("admin"));
    await waitFor(() => expect(lidas.chaves?.carregando).toBe(false));
    const selects = f.consultas.filter((c) => c.op === "select");
    expect(selects.map((c) => c.tabela).sort()).toEqual(
      ["conexoes", "configuracao", "contexto_versoes", "conversas", "etapas", "ia_chaves", "membros", "membros"].sort(),
    );
    for (const c of selects) {
      expect(c.valor).not.toContain("*");
      expect(String(c.valor).split(",").length).toBeGreaterThan(3);
    }
    const conexao = selects.find((c) => c.tabela === "conexoes")!;
    expect(conexao.valor).not.toMatch(/segredos|parametros/);
    expect(conexao.passos).toContainEqual(["eq", "ativa", true]);
    expect(selects.find((c) => c.tabela === "ia_chaves")!.valor).not.toMatch(/chave_cifrada/);
  });

  it("o Eu vem da linha de membros da conta logada, com vistos; a configuração traz worker_visto_em e o Contexto, o número", async () => {
    const vistos = { kanban: "2026-11-01T10:00:00.000Z", tour: "2026-11-01T11:00:00.000Z", outro: 5 };
    const { f, lidas } = montar(
      responderPadrao("admin", (c) => {
        if (c.tabela === "membros" && c.unica) return { data: { ...membro("admin"), vistos }, error: null };
        if (c.tabela === "configuracao")
          return {
            data: {
              id: 1,
              espera_lote_s: 8,
              espera_lote_max_s: 45,
              onboarding_concluido_em: null,
              atualizado_em: "x",
              worker_visto_em: "2026-11-02T12:00:00.000Z",
            },
            error: null,
          };
        if (c.tabela === "contexto_versoes") return { data: { id: 7, tom_voz: "leve", numero: 3, restaurada_de: 5 }, error: null };
        return undefined;
      }),
    );
    await waitFor(() => expect(lidas.eu?.membro.id).toBe("mb-1"));
    // só as chaves conhecidas, com texto, chegam à tela
    expect(lidas.eu).toEqual({
      membro: { ...membro("admin"), vistos: { kanban: vistos.kanban, tour: vistos.tour } },
      ehAdmin: true,
    });
    const doEu = f.consultas.find((c) => c.tabela === "membros" && c.unica)!;
    expect(doEu.passos).toContainEqual(["eq", "user_id", UID]);
    expect(String(doEu.valor).split(", ")).toContain("vistos");
    await waitFor(() =>
      expect(lidas.configuracao?.dados).toMatchObject({ espera_lote_s: 8, worker_visto_em: "2026-11-02T12:00:00.000Z" }),
    );
    expect(String(f.consultas.find((c) => c.tabela === "configuracao")!.valor).split(", ")).toContain("worker_visto_em");
    await waitFor(() => expect(lidas.contexto?.dados).toMatchObject({ id: 7, numero: 3, restaurada_de: 5 }));
    expect(String(f.consultas.find((c) => c.tabela === "contexto_versoes")!.valor).split(", ")).toEqual(
      expect.arrayContaining(["numero", "restaurada_de"]),
    );
  });

  it("vistos que não são objeto (ou sem a coluna) chegam vazios", async () => {
    const { lidas } = montar(
      responderPadrao("admin", (c) => (c.tabela === "membros" && c.unica ? { data: { ...membro("admin"), vistos: [1] }, error: null } : undefined)),
    );
    await waitFor(() => expect(lidas.eu?.membro.vistos).toEqual({}));
  });

  it("o atendente não pergunta pelas chaves e recebe []", async () => {
    const { f, lidas } = montar(responderPadrao("atendente"));
    await waitFor(() => expect(lidas.eu?.ehAdmin).toBe(false));
    await waitFor(() => expect(lidas.chaves).toMatchObject({ dados: [], carregando: false, erro: null }));
    expect(f.consultas.some((c) => c.tabela === "ia_chaves")).toBe(false);
  });

  it("Precisam de você: lê de 1.000 em 1.000 até acabar, com a regra de estaAguardando", async () => {
    const conversa = (i: number) => ({
      id: `cv-${String(i).padStart(5, "0")}`,
      contato_id: `ct-${i}`,
      conexao_id: "cx",
      modo: "humano",
      motivo_humano: "janete_passou",
      responsavel_id: null,
      aguardando_humano_desde: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(),
      devolvida_em: null,
      nao_lidas: 0,
      ultima_do_lead_em: null,
      ultima_mensagem_em: null,
      ultima_mensagem_preview: null,
      criado_em: "x",
      atualizado_em: "x",
    });
    const todas = Array.from({ length: 1500 }, (_, i) => conversa(i));
    const { f, lidas } = montar(
      responderPadrao("admin", (c) => {
        if (c.tabela !== "conversas") return undefined;
        const range = c.passos.find((p) => p[0] === "range")!;
        const [de, ate] = [range[1] as number, range[2] as number];
        return { data: todas.slice(de, ate + 1), error: null };
      }),
    );
    await waitFor(() => expect(lidas.aguardando?.dados).toHaveLength(1500));
    const paginas = f.consultas.filter((c) => c.tabela === "conversas");
    expect(paginas.map((c) => c.passos.find((p) => p[0] === "range"))).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
    ]);
    expect(paginas[0]!.passos).toEqual(
      expect.arrayContaining([
        ["eq", "modo", "humano"],
        ["is", "responsavel_id", null],
        ["not", "aguardando_humano_desde", "is", null],
      ]),
    );
  });

  it("o erro da leitura vem traduzido, e o Tentar de novo relê", async () => {
    let falhar = true;
    const { f, lidas } = montar(
      responderPadrao("admin", (c) =>
        c.tabela === "etapas" ? (falhar ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: [], error: null }) : undefined,
      ),
    );
    await waitFor(() => expect(lidas.etapas?.erro).toBe("sem_acesso"));
    expect(lidas.etapas?.dados).toBeUndefined();
    falhar = false;
    await act(async () => lidas.etapas!.tentarDeNovo());
    await waitFor(() => expect(lidas.etapas).toMatchObject({ dados: [], erro: null, carregando: false }));
    expect(f.consultas.filter((c) => c.tabela === "etapas")).toHaveLength(2);
  });

  it("sem membro ativo, avisa a casca (aoPerderAcesso) para levar a /sem-acesso", async () => {
    const f = criarClienteFalso({
      uid: UID,
      consulta: (c) => (c.tabela === "membros" && c.unica ? { data: membro("admin", false), error: null } : undefined),
    });
    const qc = novoQueryClient();
    const aoPerderAcesso = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ProvedorDados fonte="banco" cliente={f.cliente} aoPerderAcesso={aoPerderAcesso}>
          <span>casca</span>
        </ProvedorDados>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(aoPerderAcesso).toHaveBeenCalledTimes(1));
    expect(qc.getQueryData(CHAVES.eu)).toBeNull();
  });
});
