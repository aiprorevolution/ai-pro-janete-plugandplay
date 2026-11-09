// @vitest-environment node
// Medição isolada: executa o motor de produção, com banco em memória e IA/gateway falsos.
// Não carrega credenciais, não toca no banco local e não permite fetch de rede.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { banco, limparBanco, passoFerramenta } from "./__testes__/dubles";
import type { Rodada } from "./responder.server";

type Operacao = { tabela: string; operacao: string; linhas: number };
const medicao = vi.hoisted(() => ({
  operacoes: [] as Operacao[],
  fronteiras: {} as Record<string, number>,
  modelo: null as unknown,
  passosIA: 0,
  fetchBloqueados: 0,
  falhas: [] as string[],
}));

vi.mock("@/integrations/firebase/client.server", async () => {
  const { firebaseFalso } = await import("./__testes__/dubles");
  return { firebaseAdmin: {
    from(tabela: string) {
      const real = firebaseFalso.from(tabela);
      let op = "select";
      const proxy = new Proxy(real, {
        get(target, prop: string) {
          if (prop === "then") return (ok: (r: unknown) => unknown, erro: (e: unknown) => unknown) =>
            (target['then'] as Function)((r: { data: unknown }) => {
              const linhas = Array.isArray(r.data) ? r.data.length : r.data == null ? 0 : 1;
              medicao.operacoes.push({ tabela, operacao: op, linhas });
              return ok(r);
            }, erro);
          const value = target[prop];
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (["insert", "update", "delete"].includes(prop)) op = prop;
            const result = (value as Function)(...args);
            return result === target ? proxy : result;
          };
        },
      });
      return proxy;
    },
    rpc: firebaseFalso.rpc,
  }};
});
vi.mock("../nucleo/cifra", () => ({
  aadChave: () => "AAD_FICTICIO",
  aadConexao: () => "AAD_FICTICIO",
  cifrar: async () => "CIFRA_FICTICIA",
  decifrar: async () => {
    medicao.fronteiras['criptografiaFalsa'] = (medicao.fronteiras['criptografiaFalsa'] ?? 0) + 1;
    return "CHAVE_FICTICIA_SEM_VALIDADE";
  },
}));
vi.mock("../nucleo/banco.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("../nucleo/banco.server")>(),
  falharRodada: async (_id: string, motivo: string) => { medicao.falhas.push(motivo); },
}));
vi.mock("../nucleo/midia.server", () => ({
  baixarArquivo: async () => { throw new Error("Mídia excluída deste ensaio"); },
  caminhoMidia: () => "ficticio",
  enviarArquivo: async () => { throw new Error("Upload excluído deste ensaio"); },
}));
vi.mock("../gateways", () => ({
  adaptadorDe: () => ({
    marcarLidaEDigitando: async () => {
      medicao.fronteiras['gatewayFalso'] = (medicao.fronteiras['gatewayFalso'] ?? 0) + 1;
    },
  }),
}));
vi.mock("./modelo.server", () => ({ criarModelo: () => medicao.modelo, opcoesDoProvedor: () => ({}) }));

const { responderRodada } = await import("./responder.server");
const rodada = {
  id: "r1", conversa_id: "c1", status: "rodando", contexto_versao_id: 1,
  provedor: "anthropic", modelo: "modelo-ficticio", passos: 0, tentativa: 1,
} as unknown as Rodada;

function dados(mensagensDisponiveis: number) {
  const agora = Date.UTC(2026, 10, 8, 12);
  return {
    conversas: [{ id: "c1", contato_id: "k1", conexao_id: "x1", devolvida_em: null }],
    contatos: [{ id: "k1", nome: "Contato fictício", nome_whatsapp: "Contato fictício", telefone: null,
      email: null, empresa: null, resumo_janete: null, etapa_id: "e0" }],
    contexto_versoes: [{ id: 1, empresa_oferta: "Empresa fictícia do ensaio", cliente_ideal: "PMEs",
      preco: "Consultar equipe", diferenciais: "Atendimento", objecoes: "", quando_passar_humano: "Quando solicitado",
      tom_voz: "Direto", horario: "24 horas", itens: [] }],
    etapas: ["novo", "em_qualificacao", "qualificado", "em_negociacao", "ganho", "perdido"].map((chave, i) =>
      ({ id: `e${i}`, chave, nome: chave, ordem: i, janete_pode_mover: i === 1 || i === 2 || i === 5, arquivada: false })),
    mensagens: Array.from({ length: mensagensDisponiveis }, (_, i) => {
      const atual = i === mensagensDisponiveis - 1;
      const entrada = atual || i % 2 === 0;
      const momento = new Date(agora - (mensagensDisponiveis - 1 - i) * 60_000).toISOString();
      return { id: `m${i}`, conversa_id: "c1", direcao: entrada ? "entrada" : "saida", origem: entrada ? "lead" : "janete",
        tipo: "texto", texto: atual ? "Pode me ajudar?" : `Mensagem sintética ${i}`, transcricao: null,
        status: entrada ? "recebida" : "enviada", apagada_em: null, rodada_id: atual ? "r1" : "rodada-anterior",
        id_externo: `ficticio-${i}`, momento, criado_em: momento };
    }),
    ia_chaves: [{ id: "ch1", finalidade: "resposta", status: "ativa", provedor: "anthropic",
      modelo: "modelo-ficticio", workspace_id: null, chave_cifrada: "CIFRA_FICTICIA" }],
    conexoes: [{ id: "x1", gateway: "zapi", id_externo: "ficticio", parametros: {},
      segredos: { token: "CIFRA_FICTICIA" }, oficial: false, ativa: true }],
    contato_identificadores: [{ contato_id: "k1", tipo: "telefone", valor: "CONTATO_FICTICIO_SEM_TELEFONE", conexao_id: "x1" }],
    configuracao: [{ id: 1, voz_id: null, responder_audio: "nunca" }],
    ia_precos: [{ id: "preco-ficticio", provedor: "anthropic", modelo: "modelo-ficticio", vigente_desde: "2026-01-01",
      a_partir_de_tokens: 0, entrada: 0, saida: 0, cache_leitura: 0, cache_escrita: 0 }],
  };
}

const resultados: Record<string, unknown>[] = [];
const cenarios = [
  ...[5, 15, 30, 60].flatMap((mensagens) => [1, 3].map((bolhas) => ({ mensagens, bolhas, acao: "responder" }))),
  { mensagens: 30, bolhas: 1, acao: "mover_etapa" },
  { mensagens: 30, bolhas: 1, acao: "passar_para_humano" },
];

beforeEach(() => {
  medicao.operacoes = []; medicao.fronteiras = {}; medicao.passosIA = 0; medicao.fetchBloqueados = 0; medicao.falhas = [];
  vi.stubGlobal("fetch", async () => { medicao.fetchBloqueados++; throw new Error("REDE_BLOQUEADA_ENSAIO_LOCAL"); });
});
afterEach(() => vi.unstubAllGlobals());

describe("Medição isolada do custo de dados da Janete", () => {
  for (const c of cenarios) it(`${c.mensagens} mensagens disponíveis / ${c.bolhas} bolha(s) / ${c.acao}`, async () => {
    limparBanco(dados(c.mensagens));
    const passos: ReturnType<typeof passoFerramenta>[] = [];
    if (c.acao === "mover_etapa") passos.push(passoFerramenta("mover_etapa", { etapa: "em_qualificacao", motivo: "Critério fictício" }));
    if (c.acao === "passar_para_humano") passos.push(passoFerramenta("passar_para_humano", { motivo: "Pedido fictício" }));
    passos.push(passoFerramenta("responder", { bolhas: Array.from({ length: c.bolhas }, (_, i) => `Resposta fictícia ${i + 1}`) }));
    medicao.modelo = new MockLanguageModelV4({ doGenerate: async () => passos[Math.min(medicao.passosIA++, passos.length - 1)] as never });
    await responderRodada(rodada, { agora: Date.UTC(2026, 10, 8, 12) });
    expect(medicao.fetchBloqueados).toBe(0);
    expect(medicao.falhas).toEqual([]);
    expect(medicao.fronteiras['gatewayFalso']).toBe(1);
    const fim = banco.rpcs.find((r) => r.nome === "concluir_rodada");
    expect(fim).toBeTruthy();
    expect(fim?.args['p_respostas']).toHaveLength(c.bolhas);
    const selects = medicao.operacoes.filter((o) => o.operacao === "select");
    const writes = medicao.operacoes.filter((o) => o.operacao !== "select");
    expect(selects).toHaveLength(15);
    expect(selects.reduce((n, o) => n + o.linhas, 0)).toBe(Math.min(c.mensagens, 30) + 18);
    expect(writes.reduce((n, o) => n + o.linhas, 0)).toBe(c.acao === "responder" ? 1 : 2);
    const porTabela: Record<string, { consultas: number; linhas: number }> = {};
    for (const o of selects) {
      const registro = porTabela[o.tabela] ??= { consultas: 0, linhas: 0 };
      registro.consultas++; registro.linhas += o.linhas;
    }
    resultados.push({
      cenario: c,
      execucao: "motor real responderRodada com banco em memória, IA e gateways determinísticos",
      selects_diretos: selects.length,
      linhas_retornadas_selects_diretos: selects.reduce((n, o) => n + o.linhas, 0),
      selects_vazios: selects.filter((o) => o.linhas === 0).length,
      chamadas_gravacao_direta: writes.length,
      linhas_gravadas_diretamente: writes.reduce((n, o) => n + o.linhas, 0),
      respostas_enfileiradas_no_contrato_rpc: c.bolhas,
      rpcs_executadas_no_duble: banco.rpcs.map((r) => r.nome),
      efeitos_internos_das_rpcs_medidos: false,
      chamadas_modelo_falso: medicao.passosIA,
      tentativas_fetch_rede: medicao.fetchBloqueados,
      fronteiras_substituidas: { ...medicao.fronteiras },
      por_tabela: porTabela,
      operacoes: [...medicao.operacoes],
    });
  });
});

afterAll(() => {
  const pasta = resolve(process.cwd(), "validacao/custos-firestore/backend");
  mkdirSync(pasta, { recursive: true });
  writeFileSync(resolve(pasta, "rodadas-medidas.json"), JSON.stringify({
    data_local: "2026-11-08", metodo: "Execução isolada da função de produção; não é medição do Firestore nem do PostgreSQL real",
    guardas: { fetch_bloqueado: true, cliente_banco_em_memoria: true, modelo_ia_falso: true, gateway_whatsapp_falso: true },
    limitacoes: ["Consultas de chave/conexão/destino usam suas implementações reais; somente criptografia e integrações externas são substituídas.",
      "RPCs são contadas mas seus efeitos SQL internos não são executados; escritas diretas são um piso, não o total do atendimento.",
      "O ensaio começa numa rodada pronta: não inclui webhook, criação/enfileiramento da rodada, worker ocioso, envio físico, recibos ou consultas da interface.",
      "Dados são sintéticos, sem cliente real; saída não contém chaves reais, texto real de contatos ou cabeçalhos.",
      "Linhas SQL retornadas não equivalem automaticamente a leituras faturáveis do Firestore."],
    resultados,
  }, null, 2));
});
