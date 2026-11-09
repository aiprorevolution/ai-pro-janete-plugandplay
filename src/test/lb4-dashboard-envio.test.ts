import { MOTIVOS_FALHA_DASHBOARD } from "@/integrations/firebase/rpc-reads";

import { describe, expect, it } from "vitest";

import { MOTIVO_CURTO, MOTIVOS_FALHA } from "@/features/plataforma/comum/LinhaConversa";
// a lista que o `seloDaConversa` usa (Dashboard, Kanban e Contatos): tem de ser a mesma do Chat e do banco
import { MOTIVOS_FALHA as MOTIVOS_FALHA_DO_SELO } from "@/features/plataforma/exemplo";
import {
  montarPainelBanco,
  montarPeriodo,
  type EntradaPainelBanco,
  type Periodo,
} from "@/features/plataforma/dashboard/dados";
import { rotuloMotivo } from "@/features/plataforma/dashboard/versoes/final/Cartoes";
import {
  lerAgoraBanco,
  lerCustoBanco,
  lerFunilBanco,
  lerPeriodoBanco,
  lerProblemasBanco,
  type DashboardPeriodoBanco,
} from "@/features/plataforma/dados/dashboard";
import type { ConfiguracaoDados } from "@/features/plataforma/dados/tipos";
import type { ChaveIA, Conexao } from "@/features/plataforma/exemplo";

// B4 · o motivo envio_falhou no Dashboard (spec das lacunas da mensageria, decisão 2 e contrato 2.3):
// a bolha da Janete que não saiu leva a conversa para a equipe. Nos passados ela é falha (como no
// dashboard_periodo do Firestore), no "Agora" a conversa espera com o selo de falha e o atendente lê
// "Mensagem não entregue" (não é da chave, então não vira "Problema na IA"). Nos problemas, a bolha
// já conta no tipo "envio": não vira um problema a mais. Cliente nenhum: só a montagem do painel.

// 14:45 em São Paulo.
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const AGORA_MS = AGORA.getTime();
const MIN = 60_000;
const antes = (ms: number) => new Date(AGORA_MS - ms).toISOString();

function periodo(): Periodo {
  const r = montarPeriodo("30d", AGORA);
  if (!r.ok) throw new Error("período inválido");
  return r.periodo;
}

/* ---------- o que o banco devolve (o formato da 0008, com o envio_falhou da Firestore) ---------- */

const PASSADOS = {
  janetePassou: 2,
  falha: 2,
  porMotivo: { janete_passou: 2, envio_falhou: 1, erro_provedor: 1 },
};

const periodoJson = (passados: Record<string, unknown> = PASSADOS) => ({
  conversas: 40,
  leadsNovos: 20,
  recebidas: 300,
  enviadas: 280,
  enviadasPorOrigem: { janete: 250, humano_tela: 20, humano_celular: 10 },
  primeiraRespostaS: 30,
  respostaJaneteS: 12,
  respostaJaneteP90S: 40,
  conversasAutonomas: 30,
  autonomiaPct: 75,
  passados,
  series: { conversas: [{ dia: "2026-10-30", valor: 7 }] },
});

const funilJson = () => ({ leadsNovos: 20, ganhos: 2, cicloMedianoDias: 3.5, etapas: [] });

const custoJson = () => ({
  total: 1.5,
  porTipo: { resposta: 1.0, transcricao: 0.3, onboarding: 0.2 },
  semPreco: 0,
  porModelo: [],
  conversasComJanete: 10,
  porConversaUsd: 0.1,
  foraDaCoorteUsd: 0,
});

// a bolha da Janete que falhou no envio: o dashboard_problemas a devolve como "envio" (as mensagens
// que não saíram), sem motivo
const ENVIO = {
  id: "envio:m1",
  tipo: "envio",
  quando: antes(20 * MIN),
  fim: antes(20 * MIN),
  durMin: 0,
  motivo: null,
  quantidade: 1,
  conversasAfetadas: 1,
};

const agoraJson = (x: Record<string, unknown> = {}) => ({
  aguardando: {
    total: 2,
    maisAntigaDesde: antes(20 * MIN),
    itens: [
      {
        conversaId: "cv-1",
        contatoId: "ct-1",
        nome: "Bia",
        nomeWhatsapp: null,
        telefone: null,
        motivo: "janete_passou",
        aguardandoDesde: antes(10 * MIN),
      },
      {
        conversaId: "cv-2",
        contatoId: "ct-2",
        nome: "Caio",
        nomeWhatsapp: null,
        telefone: null,
        motivo: "envio_falhou",
        aguardandoDesde: antes(20 * MIN),
      },
    ],
  },
  naoLidas: { conversas: 0, mensagens: 0 },
  comQuem: { janete: 5, membros: [], celular: 0 },
  janeteAtiva: { conversas: 3, digitando: null },
  kanban: [],
  esfriando: 0,
  porEtapa: [],
  ultimaRecebidaEm: antes(2 * MIN),
  // a Janete respondeu antes da bolha falhar: se o envio_falhou contasse como a chave, a atendente
  // veria a Janete parada
  ultimaDaJaneteEm: antes(30 * MIN),
  ...x,
});

function passada(admin: boolean, problemas: unknown[] = [ENVIO]): DashboardPeriodoBanco<Periodo> {
  return {
    contexto: periodo(),
    calculadoEm: AGORA_MS,
    atual: {
      periodo: lerPeriodoBanco(periodoJson()),
      funil: lerFunilBanco(funilJson()),
      custo: admin ? lerCustoBanco(custoJson()) : null,
    },
    anterior: {
      periodo: lerPeriodoBanco(
        periodoJson({ janetePassou: 1, falha: 0, porMotivo: { janete_passou: 1 } }),
      ),
      funil: lerFunilBanco(funilJson()),
      custo: admin ? lerCustoBanco(custoJson()) : null,
    },
    problemas: lerProblemasBanco(problemas),
    desdeOntem: 9,
    mesAteHojeUsd: admin ? 3.0 : null,
  };
}

const CONEXAO: Conexao = {
  id: "cx-1",
  nome: "+55 11 90000-0000",
  gateway: "zapi",
  status: "conectada",
  ativa: true,
  oficial: false,
  id_externo: "inst-1",
  ultimo_erro: null,
  criado_em: "2026-10-01T12:00:00.000Z",
  atualizado_em: "2026-10-01T12:00:00.000Z",
};

const CHAVE: ChaveIA = {
  id: "k-1",
  finalidade: "resposta",
  provedor: "openai",
  modelo: "gpt-4.1-mini",
  status: "ativa",
  ultimos4: "abcd",
  ultimo_erro: null,
  validada_em: "2026-10-01T12:00:00.000Z",
  atualizada_em: "2026-10-01T12:00:00.000Z",
  atualizada_por: null,
};

const CONFIGURACAO: ConfiguracaoDados = {
  id: 1,
  espera_lote_s: 8,
  espera_lote_max_s: 45,
  onboarding_concluido_em: "2026-10-01T12:00:00.000Z",
  atualizado_em: "2026-10-01T12:00:00.000Z",
  worker_visto_em: antes(1 * MIN),
};

function painel(papel: "admin" | "atendente", x: Partial<EntradaPainelBanco> = {}) {
  const admin = papel === "admin";
  return montarPainelBanco({
    papel,
    nomeConta: "equipe Teste",
    agora: AGORA,
    periodo: x.periodo ?? passada(admin),
    agoraBanco: x.agoraBanco ?? lerAgoraBanco(agoraJson()),
    conexao: CONEXAO,
    chaves: admin ? [CHAVE] : [],
    configuracao: CONFIGURACAO,
    contexto: null,
    carregando: false,
  });
}


/* ---------- os passados para a equipe ---------- */

describe("B4 · envio_falhou nos passados para a equipe", () => {
  it("é falha, com a mesma lista do banco (Firestore): a tela e o dashboard_periodo não discordam", () => {
    const listas = [MOTIVOS_FALHA_DASHBOARD];
    for (const l of listas) {
      expect(l).toContain("envio_falhou");
      expect([...l].sort()).toEqual([...MOTIVOS_FALHA].sort());
      expect([...l].sort()).toEqual([...MOTIVOS_FALHA_DO_SELO].sort());
    }
  });

  it("o painel leva o número do banco: o envio_falhou fica na falha, não no 'a Janete decidiu passar'", () => {
    const p = painel("admin");
    expect(p.resumo.passados).toEqual(PASSADOS);
    expect(p.resumo.passados.porMotivo.envio_falhou).toBe(1);
  });

  it("o rótulo do motivo é o MOTIVO_CURTO, para o admin e para o atendente", () => {
    expect(MOTIVO_CURTO.envio_falhou).toBe("Mensagem não entregue");
    expect(rotuloMotivo(MOTIVO_CURTO.envio_falhou, true)).toBe("Mensagem não entregue");
    expect(rotuloMotivo(MOTIVO_CURTO.envio_falhou, false)).toBe("Mensagem não entregue");
    // os da chave continuam neutros para o atendente
    expect(rotuloMotivo(MOTIVO_CURTO.sem_credito, false)).toBe("Problema na IA");
  });
});

/* ---------- o "Agora" ---------- */

describe("B4 · envio_falhou no 'Agora'", () => {
  it("a conversa esperando conta como parada por falha (selo de falha), com 'Mensagem não entregue'", () => {
    for (const papel of ["admin", "atendente"] as const) {
      const itens = painel(papel).agora.aguardando.itens;
      expect(itens.map((i) => [i.nome, i.motivoCurto, i.selo])).toEqual([
        ["Caio", "Mensagem não entregue", "falha"],
        ["Bia", MOTIVO_CURTO.janete_passou, "aguardando"],
      ]);
    }
  });

  it("não é da chave: para o atendente, a Janete não fica parada nem aparece 'Problema na IA'", () => {
    const p = painel("atendente");
    expect(p.estadoJanete).toBe("acordada");
    const motor = p.agora.saude.itens.find((i) => i.id === "motor");
    expect(motor?.estado).not.toBe("parado");
    expect(motor?.detalhe ?? "").not.toContain("Problema na IA");
    expect(p.textos.resumo).not.toContain("problema técnico");
  });
});

/* ---------- os problemas ---------- */

describe("B4 · envio_falhou nos problemas, sem contagem dupla", () => {
  it("a bolha que não saiu é um problema só, o de envio; a passagem para a equipe não cria outro", () => {
    for (const papel of ["admin", "atendente"] as const) {
      const p = painel(papel);
      expect(p.resumo.problemas).toHaveLength(1);
      expect(p.resumo.problemas[0]).toMatchObject({
        tipo: "envio",
        titulo: "1 mensagem não saiu",
        causa: "O WhatsApp não aceitou o envio. Abra a conversa para ver o erro.",
        acao: { para: "/app/chat" },
      });
      expect(p.agora.saude.itens.find((i) => i.id === "problemas")?.detalhe).toBe(
        "1 problema nos últimos 30 dias",
      );
    }
  });

  it("sem o envio nos problemas, o envio_falhou dos passados não inventa problema", () => {
    const p = painel("admin", { periodo: passada(true, []) });
    expect(p.resumo.passados.porMotivo.envio_falhou).toBe(1);
    expect(p.resumo.problemas).toEqual([]);
  });
});
