import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Bolha, LoteMidias, linkDoLote, type AutorBolha, type MensagemBolha } from "@/features/plataforma/comum/Bolha";
import {
  CHAVES,
  COLUNAS_MENSAGEM,
  INVALIDA,
  ProvedorDados,
  REPETIR_LEITURA_VEZES,
  SemLinhas,
  conferirAntesDoArquivo,
  conversaEmCache,
  criarAcoesBanco,
  opcoesEtapas,
  repetirSoFalha,
  useDados,
  useUrlMidia,
  type FonteDados,
  type Resultado,
  type UrlsMidia,
} from "@/features/plataforma/dados";
import { criarClienteFalso, type OpcoesFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import { IDS, criarEstadoInicial } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// Correções da fundação do front (revisão da F1, F2, F4 e F5): as colunas da mensagem para o
// "Tentar de novo" (decisão 8), os links das mídias sem piscar quando a lista muda, as ações só de
// admin com o mesmo erro nos dois modos, o marcar como lida sem pedido à toa, a conferência antes
// do upload e o retry das leituras só para o que pode passar.

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CV = "11111111-1111-4111-8111-111111111111";
const CT = "22222222-2222-4222-8222-222222222222";
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const MOMENTO = "2026-10-30T17:31:00.000Z";
const LEAD: AutorBolha = { nome: "Ricardo", nomeCompleto: "Ricardo Alves" };
const EQUIPE: AutorBolha = { nome: "Ana", papel: "Admin" };

const membro = (papel: "admin" | "atendente") => ({
  id: "mb-1",
  nome: "Ana",
  email: "ana@teste.com",
  papel,
  ativo: true,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
});

function novoQc(opcoes: { semRetry?: boolean } = { semRetry: true }) {
  return new QueryClient(opcoes.semRetry ? { defaultOptions: { queries: { retry: false } } } : {});
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function banco(filho: ReactNode, opcoes: OpcoesFalso = {}) {
  const f = criarClienteFalso({
    ...opcoes,
    consulta: (c) => (c.tabela === "membros" && c.unica ? { data: null, error: null } : undefined),
  });
  const qc = novoQc();
  const embrulho = (x: ReactNode) => (
    <QueryClientProvider client={qc}>
      <ProvedorDados fonte="banco" cliente={f.cliente}>
        {x}
      </ProvedorDados>
    </QueryClientProvider>
  );
  const vista = render(embrulho(filho));
  return { f, qc, vista, rerender: (x: ReactNode) => vista.rerender(embrulho(x)) };
}

/* ---------- decisão 8: as colunas que o "Tentar de novo" precisa ---------- */

describe("COLUNAS_MENSAGEM e o Tentar de novo no banco", () => {
  it("lê id_externo e id_gateway (o grant de select vale para a tabela inteira)", () => {
    const colunas = COLUNAS_MENSAGEM.split(", ");
    expect(colunas).toContain("id_externo");
    expect(colunas).toContain("id_gateway");
    expect(colunas).toContain("erro");
  });

  it("a mensagem da equipe que falhou com o id do gateway preenchido não mostra o botão no modo banco", () => {
    // A linha como o banco devolve só as colunas pedidas em COLUNAS_MENSAGEM.
    const noBanco: Record<string, unknown> = {
      id: "m1",
      conversa_id: CV,
      origem: "humano_tela",
      direcao: "saida",
      tipo: "texto",
      status: "falhou",
      texto: "Segue a proposta",
      momento: MOMENTO,
      erro: "http_400",
      id_externo: null,
      id_gateway: "gw-123",
    };
    const linha = Object.fromEntries(COLUNAS_MENSAGEM.split(", ").map((c) => [c, noBanco[c] ?? null])) as unknown as MensagemBolha;
    expect(linha.id_gateway).toBe("gw-123");
    const aoTentarDeNovo = vi.fn();
    banco(<Bolha mensagem={linha} autor={EQUIPE} aoTentarDeNovo={aoTentarDeNovo} />);
    expect(screen.getByText(/Não enviada/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    cleanup();
    // A mesma mensagem sem id do gateway pode sair de novo.
    banco(<Bolha mensagem={{ ...linha, id_gateway: null }} autor={EQUIPE} aoTentarDeNovo={aoTentarDeNovo} />);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });
});

/* ---------- mídias: a lista muda e o que já abria continua abrindo ---------- */

describe("useUrlMidia e LoteMidias quando a lista muda", () => {
  const pronta = (id: string, caminho: string): MensagemBolha => ({
    id,
    origem: "lead",
    tipo: "imagem",
    status: "recebida",
    texto: null,
    momento: MOMENTO,
    midia_status: "copiada",
    midia_caminho: caminho,
    midia_nome: `${id}.jpg`,
  });
  const lista = (ms: MensagemBolha[]) => (
    <LoteMidias mensagens={ms}>
      {ms.map((m) => (
        <Bolha key={m.id} mensagem={m} autor={LEAD} />
      ))}
    </LoteMidias>
  );

  it("com o lote [a] pronto, acrescentar b mantém o link de a sem 'carregando'; b fica carregando até vir", async () => {
    const a = pronta("a", "cv-1/a");
    const b = pronta("b", "cv-1/b");
    const { f, rerender } = banco(lista([a]));
    const fotoA = await screen.findByRole("button", { name: "Ampliar a foto a.jpg" });
    expect(fotoA.querySelector("img")).toHaveAttribute("src", "https://falso/cv-1/a?v=3600");

    rerender(lista([a, b]));
    // Logo depois da troca, antes de o lote novo voltar: a continua aberta e só b espera.
    expect(screen.getByRole("button", { name: "Ampliar a foto a.jpg" }).querySelector("img")).toHaveAttribute(
      "src",
      "https://falso/cv-1/a?v=3600",
    );
    expect(screen.getAllByText("Carregando a foto…")).toHaveLength(1);

    const fotoB = await screen.findByRole("button", { name: "Ampliar a foto b.jpg" });
    expect(fotoB.querySelector("img")).toHaveAttribute("src", "https://falso/cv-1/b?v=3600");
    expect(screen.queryByText("Carregando a foto…")).toBeNull();
    // Só o que faltava foi pedido no 2º lote.
    expect(f.assinaturas.map((x) => x.caminhos)).toEqual([["cv-1/a"], ["cv-1/b"]]);
  });

  it("o caminho novo que o Storage recusa só vira erro quando a busca termina; o antigo continua", async () => {
    const a = pronta("a", "cv-1/a");
    const b = pronta("b", "cv-1/b");
    const { rerender } = banco(lista([a]), {
      assinar: (caminhos) => ({
        data: caminhos.map((p) => (p === "cv-1/b" ? { path: p, signedUrl: null, error: "Object not found" } : { path: p, signedUrl: `u:${p}`, error: null })),
        error: null,
      }),
    });
    await screen.findByRole("button", { name: "Ampliar a foto a.jpg" });
    rerender(lista([a, b]));
    expect(screen.queryByText("Não deu para abrir a foto.")).toBeNull();
    expect(await screen.findByText("Não deu para abrir a foto.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ampliar a foto a.jpg" }).querySelector("img")).toHaveAttribute("src", "u:cv-1/a");
  });

  it("useUrlMidia: durante a busca da lista nova, os links já conhecidos ficam e buscando é true", async () => {
    let lido: UrlsMidia | undefined;
    function Links({ caminhos }: { caminhos: string[] }) {
      lido = useUrlMidia(caminhos);
      return null;
    }
    const { rerender } = banco(<Links caminhos={["x/1"]} />);
    await waitFor(() => expect(lido?.urls["x/1"]).toBeDefined());
    expect(lido).toMatchObject({ carregando: false, buscando: false });
    rerender(<Links caminhos={["x/1", "x/2"]} />);
    expect(lido!.urls["x/1"]).toBe("https://falso/x/1?v=3600");
    expect(lido).toMatchObject({ carregando: false, buscando: true });
    await waitFor(() => expect(lido?.urls["x/2"]).toBeDefined());
    expect(lido!.buscando).toBe(false);
  });

  it("linkDoLote: link quando há; carregando enquanto busca; erro só quando a busca terminou sem ele", () => {
    const tentarDeNovo = () => {};
    expect(linkDoLote({ urls: { a: "u" }, buscando: true, tentarDeNovo }, "a")).toEqual({ url: "u" });
    expect(linkDoLote({ urls: { a: "u" }, buscando: true, tentarDeNovo }, "b")).toEqual({ carregando: true });
    expect(linkDoLote({ urls: { a: "u" }, buscando: false, tentarDeNovo }, "b")).toEqual({ erro: true, tentarDeNovo });
  });
});

/* ---------- ações só de admin: o mesmo erro nos dois modos ---------- */

describe("o atendente recebe o mesmo erro nos dois modos", () => {
  async function doExemplo(fazer: (f: FonteDados) => Promise<Resultado>): Promise<Resultado> {
    let fonte: FonteDados | undefined;
    function Espiao() {
      fonte = useDados();
      return null;
    }
    render(
      <ProvedorPapel inicial="atendente">
        <ProvedorDados exemplo={() => criarEstadoInicial(AGORA)} relogio={() => AGORA} progredirEnvios={false}>
          <Espiao />
        </ProvedorDados>
      </ProvedorPapel>,
    );
    let r: Resultado | undefined;
    await act(async () => {
      r = await fazer(fonte!);
    });
    cleanup();
    return r!;
  }

  function doBanco() {
    const f = criarClienteFalso({
      uid: UID,
      // Se fosse ao banco, a RLS daria outro erro: 0 linhas no UPDATE e sem_acesso nas funções.
      consulta: () => ({ data: [], error: null }),
      rpc: () => ({ data: null, error: { code: "P0001", message: "sem_acesso" } }),
    });
    const qc = novoQc();
    qc.setQueryData(CHAVES.eu, membro("atendente"));
    const servidor = { apagarContato: vi.fn(() => Promise.resolve({ ok: false, erro: "sem_acesso" })) };
    return { f, acoes: criarAcoesBanco(f.cliente, qc, servidor), servidor };
  }

  it.each([
    ["editarEtapa", (f: Pick<FonteDados, "acoes">) => f.acoes.editarEtapa(IDS.etapa.qualificado, { nome: "Quente" })],
    ["reordenarEtapas", (f: Pick<FonteDados, "acoes">) => f.acoes.reordenarEtapas([IDS.etapa.novo, IDS.etapa.qualificado])],
    ["apagarContato", (f: Pick<FonteDados, "acoes">) => f.acoes.apagarContato("ct-ricardo")],
  ] as const)("%s: sem_permissao, sem ir ao banco", async (_nome, fazer) => {
    const noExemplo = await doExemplo((fonte) => fazer(fonte));
    const b = doBanco();
    const noBanco = await fazer({ acoes: b.acoes });
    expect(noExemplo).toEqual({ ok: false, erro: "sem_permissao" });
    expect(noBanco).toEqual(noExemplo);
    expect(b.f.consultas).toHaveLength(0);
    expect(b.f.rpcs).toHaveLength(0);
    expect(b.servidor.apagarContato).not.toHaveBeenCalled();
  });

  it("o admin segue para o banco (a recusa é só do atendente)", async () => {
    const f = criarClienteFalso({ uid: UID, consulta: () => ({ data: [{ id: "x" }], error: null }) });
    const qc = novoQc();
    qc.setQueryData(CHAVES.eu, membro("admin"));
    const acoes = criarAcoesBanco(f.cliente, qc, { apagarContato: () => Promise.resolve({ ok: true }) });
    expect(await acoes.editarEtapa(IDS.etapa.qualificado, { nome: "Quente" })).toEqual({ ok: true });
    expect(await acoes.reordenarEtapas([IDS.etapa.novo])).toEqual({ ok: true });
    expect(await acoes.apagarContato(CT)).toEqual({ ok: true });
    expect(f.rpcs.map((r) => r.nome)).toEqual(["reordenar_etapas"]);
  });
});

/* ---------- marcar como lida: a conversa já lida não vira pedido ---------- */

describe("marcarLida no banco", () => {
  function preparar() {
    const f = criarClienteFalso({ uid: UID });
    const qc = novoQc();
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    const servidor = { marcarLidaNoWhatsApp: vi.fn(() => Promise.resolve()) };
    return { f, qc, invalidar, servidor, acoes: criarAcoesBanco(f.cliente, qc, servidor) };
  }

  it("não decide pelo cache: com 0 não lidas numa cópia que pode estar velha, marca no banco do mesmo jeito (decisão 6)", async () => {
    const p = preparar();
    // a cópia de outra tela diz 0, mas quem chamou foi a tela que leu não lidas agora
    p.qc.setQueryData([...CHAVES.quadro, "todas"], [{ id: CV, nao_lidas: 0 }]);
    expect(await p.acoes.marcarLida(CV)).toEqual({ ok: true });
    expect(p.f.rpcs.map((r) => r.args["p_conversa"])).toEqual([CV]);
    expect(p.servidor.marcarLidaNoWhatsApp).toHaveBeenCalledTimes(1);
  });

  it("com a mesma conversa em dois caches, conversaEmCache usa a leitura mais recente", async () => {
    const p = preparar();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
      p.qc.setQueryData([...CHAVES.quadro, "todas"], [{ id: CV, nao_lidas: 0, ultima_do_lead_em: null }]);
      vi.setSystemTime(new Date("2026-11-02T10:05:00Z"));
      p.qc.setQueryData([...CHAVES.conversas, "lista"], {
        linhas: [{ id: CV, nao_lidas: 3, ultima_do_lead_em: "2026-11-02T10:04:00Z" }],
        total: 1,
      });
      expect(conversaEmCache(p.qc, CV)).toMatchObject({ nao_lidas: 3, ultima_do_lead_em: "2026-11-02T10:04:00Z" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("com não lidas (ou sem a conversa em cache), marca no banco e pede o 'lido' no WhatsApp", async () => {
    const p = preparar();
    p.qc.setQueryData([...CHAVES.aguardando, "todas"], [{ id: CV, nao_lidas: 2 }]);
    expect(await p.acoes.marcarLida(CV)).toEqual({ ok: true });
    expect(await p.acoes.marcarLida("outra")).toEqual({ ok: true });
    expect(p.f.rpcs.map((r) => r.args["p_conversa"])).toEqual([CV, "outra"]);
    expect(p.servidor.marcarLidaNoWhatsApp).toHaveBeenCalledTimes(2);
    const raizes = p.invalidar.mock.calls.map((c) => (c[0] as { queryKey: readonly string[] }).queryKey[0]);
    expect(raizes).toEqual([...INVALIDA.marcarLida, ...INVALIDA.marcarLida]);
  });
});

/* ---------- envio com arquivo: a conferência antes do upload ---------- */

describe("conferirAntesDoArquivo (antes de subir o arquivo)", () => {
  const conexao = (extra: Record<string, unknown> = {}) => ({
    id: "cx-1",
    nome: "Comercial",
    gateway: "meta",
    status: "conectada",
    ativa: true,
    oficial: true,
    id_externo: null,
    ultimo_erro: null,
    criado_em: "2026-10-01T12:00:00.000Z",
    atualizado_em: "2026-10-01T12:00:00.000Z",
    ...extra,
  });
  const chaveConexao = [...CHAVES.conexao, "ativa"];

  it("sem conexão ativa em cache (null) ou desconectada: sem_conexao_ativa", () => {
    const qc = novoQc();
    qc.setQueryData(chaveConexao, null);
    expect(conferirAntesDoArquivo(qc, CV)).toEqual({ ok: false, erro: "sem_conexao_ativa" });
    qc.setQueryData(chaveConexao, conexao({ status: "desconectada" }));
    expect(conferirAntesDoArquivo(qc, CV)).toEqual({ ok: false, erro: "sem_conexao_ativa" });
  });

  it("na API oficial, com a janela de 24 h fechada: janela_fechada; aberta ou sem a conversa em cache: segue", () => {
    const qc = novoQc();
    qc.setQueryData(chaveConexao, conexao());
    expect(conferirAntesDoArquivo(qc, CV)).toBeNull();
    const ha25h = new Date(Date.now() - 25 * 3600_000).toISOString();
    qc.setQueryData([...CHAVES.conversas, "lista"], [{ id: CV, nao_lidas: 0, ultima_do_lead_em: ha25h }]);
    expect(conferirAntesDoArquivo(qc, CV)).toEqual({ ok: false, erro: "janela_fechada" });
    const ha1h = new Date(Date.now() - 3600_000).toISOString();
    qc.setQueryData([...CHAVES.conversas, "lista"], [{ id: CV, nao_lidas: 0, ultima_do_lead_em: ha1h }]);
    expect(conferirAntesDoArquivo(qc, CV)).toBeNull();
    // Fora da API oficial, a janela não vale.
    qc.setQueryData(chaveConexao, conexao({ oficial: false, gateway: "zapi" }));
    qc.setQueryData([...CHAVES.conversas, "lista"], [{ id: CV, nao_lidas: 0, ultima_do_lead_em: ha25h }]);
    expect(conferirAntesDoArquivo(qc, CV)).toBeNull();
  });

  it("o enviar com arquivo recusado pela conferência não sobe nada nem grava", async () => {
    const f = criarClienteFalso({ uid: UID });
    const qc = novoQc();
    qc.setQueryData(chaveConexao, null);
    const garantirBucketMidias = vi.fn(() => Promise.resolve({ ok: true }));
    const acoes = criarAcoesBanco(f.cliente, qc, { garantirBucketMidias, pedirEnvio: () => Promise.resolve() });
    expect(await acoes.enviarMensagem(CV, { tipo: "documento", arquivo: new Blob(["x"]) })).toEqual({
      ok: false,
      erro: "sem_conexao_ativa",
    });
    expect(f.uploads).toHaveLength(0);
    expect(f.consultas).toHaveLength(0);
    expect(garantirBucketMidias).not.toHaveBeenCalled();
  });
});

/* ---------- leituras: retry só do que pode passar ---------- */

describe("repetirSoFalha (o retry das leituras)", () => {
  it("repete a falha de rede até 3 vezes; sem_acesso, nao_encontrado e o SemLinhas, nunca", () => {
    const rede = new TypeError("Failed to fetch");
    expect(REPETIR_LEITURA_VEZES).toBe(3);
    expect([0, 1, 2].map((n) => repetirSoFalha(n, rede))).toEqual([true, true, true]);
    expect(repetirSoFalha(3, rede)).toBe(false);
    const semAcesso = Object.assign(new Error("permission denied"), { code: "42501" });
    expect(repetirSoFalha(0, semAcesso)).toBe(false);
    expect(repetirSoFalha(0, Object.assign(new Error("x"), { code: "22P02" }))).toBe(false);
    expect(repetirSoFalha(0, new SemLinhas("configuracao"))).toBe(false);
  });

  it("vale mesmo com o retry padrão do React Query: o sem_acesso aparece na 1ª resposta", async () => {
    const f = criarClienteFalso({
      uid: UID,
      consulta: (c) => (c.tabela === "etapas" ? { data: null, error: { code: "42501", message: "permission denied" } } : undefined),
    });
    const qc = novoQc({ semRetry: false });
    await expect(qc.fetchQuery(opcoesEtapas(f.cliente))).rejects.toMatchObject({ code: "42501" });
    expect(f.consultas.filter((c) => c.tabela === "etapas")).toHaveLength(1);
    expect(opcoesEtapas(f.cliente).retry).toBe(repetirSoFalha);
  });
});
