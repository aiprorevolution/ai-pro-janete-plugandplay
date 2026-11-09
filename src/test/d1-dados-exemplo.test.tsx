import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NOMES_ACOES, ProvedorDados, useDados, type FonteDados, type Resultado } from "@/features/plataforma/dados";
import {
  IDS,
  criarEstadoInicial,
  estaAguardando,
  reduzir,
  useExemplo,
  type AcaoExemplo,
  type EstadoBase,
} from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// F1: o modo exemplo do ProvedorDados embrulha o reducer do exemplo com ações assíncronas. Cada ação
// tem de devolver o mesmo resultado (e deixar o mesmo estado) que o reducer puro, agora numa Promise.

// Quinta, 30/10/2026, 14:45 em São Paulo.
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const ISO = AGORA.toISOString();
const inicial = () => criarEstadoInicial(AGORA);

let fonte: FonteDados;
let exemplo: ReturnType<typeof useExemplo>;

function Espiao() {
  fonte = useDados();
  exemplo = useExemplo();
  return null;
}

function montar(base: EstadoBase | (() => EstadoBase) = inicial, papel: "admin" | "atendente" = "admin") {
  render(
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={base} relogio={() => AGORA} progredirEnvios={false}>
        <Espiao />
      </ProvedorDados>
    </ProvedorPapel>,
  );
}

/** O que o reducer puro dá para a mesma ação, feita pelo admin ("Você") no mesmo instante. */
function doReducer(acao: AcaoExemplo, base: EstadoBase = inicial()) {
  return reduzir(base, { acao, euId: IDS.voce, agora: ISO });
}

async function rodar(fazer: () => Promise<Resultado<unknown>>): Promise<Resultado<unknown>> {
  let r: Resultado<unknown> | undefined;
  await act(async () => {
    r = await fazer();
  });
  return r!;
}

const semEstado = (e: EstadoBase) => ({
  conversas: e.conversas,
  mensagens: e.mensagens,
  contatos: e.contatos,
  etapas: e.etapas,
  eventos: e.eventos,
  historico: e.historico,
});

afterEach(cleanup);

describe("modo exemplo: as ações são as do reducer, assíncronas", () => {
  it("toda ação devolve uma Promise, e as ações são as de AcoesDados", async () => {
    montar();
    expect(Object.keys(fonte.acoes).sort()).toEqual([...NOMES_ACOES].sort());
    const cv = exemplo.estado.conversas[0]!;
    let p: unknown;
    await act(async () => {
      p = fonte.acoes.marcarLida(cv.id);
      await p;
    });
    expect(p).toBeInstanceOf(Promise);
  });

  it("enviar: o mesmo resultado (com o id) e a mesma conversa do reducer", async () => {
    const base = inicial();
    const cv = base.conversas.find((c) => c.modo === "janete")!;
    const esperado = doReducer({ tipo: "enviarMensagem", conversaId: cv.id, mensagem: { tipo: "texto", texto: "  Oi, tudo bem?  " } });
    montar();
    const r = await rodar(() => fonte.acoes.enviarMensagem(cv.id, { tipo: "texto", texto: "  Oi, tudo bem?  " }));
    expect(r).toEqual(esperado.resultado);
    expect(r.ok && r.id).toBeTruthy();
    expect(semEstado(exemplo.estado)).toEqual(semEstado(esperado.estado));
  });

  it("enviar com arquivo: vira o anexo do exemplo (nome, tipo e tamanho do arquivo)", async () => {
    const base = inicial();
    const cv = base.conversas.find((c) => c.modo === "janete")!;
    const midia = { nome: "proposta.pdf", mime: "application/pdf", tamanho: 4 };
    const esperado = doReducer({ tipo: "enviarMensagem", conversaId: cv.id, mensagem: { tipo: "documento", midia } });
    montar();
    const arquivo = new File(["%PDF"], "proposta.pdf", { type: "application/pdf" });
    const r = await rodar(() => fonte.acoes.enviarMensagem(cv.id, { tipo: "documento", arquivo }));
    expect(r).toEqual(esperado.resultado);
    expect(semEstado(exemplo.estado)).toEqual(semEstado(esperado.estado));
  });

  it("enviar sem WhatsApp: a mesma recusa (sem_conexao_ativa) e nada muda", async () => {
    const base = { ...inicial(), conexao: null };
    const cv = base.conversas[0]!;
    const esperado = doReducer({ tipo: "enviarMensagem", conversaId: cv.id, mensagem: { tipo: "texto", texto: "oi" } }, base);
    expect(esperado.resultado).toEqual({ ok: false, erro: "sem_conexao_ativa" });
    montar(base);
    const r = await rodar(() => fonte.acoes.enviarMensagem(cv.id, { tipo: "texto", texto: "oi" }));
    expect(r).toEqual(esperado.resultado);
    expect(exemplo.estado.mensagens).toEqual(base.mensagens);
  });

  it("assumir: o mesmo resultado (assumiu) e o mesmo estado", async () => {
    const base = inicial();
    const cv = base.conversas.find((c) => estaAguardando(c)) ?? base.conversas.find((c) => c.modo === "janete")!;
    const esperado = doReducer({ tipo: "assumir", conversaId: cv.id });
    montar();
    const r = await rodar(() => fonte.acoes.assumir(cv.id));
    expect(r).toEqual(esperado.resultado);
    expect(r).toMatchObject({ ok: true, assumiu: true });
    expect(semEstado(exemplo.estado)).toEqual(semEstado(esperado.estado));
  });

  it("devolver para a Janete: o mesmo resultado e o mesmo estado", async () => {
    const base = inicial();
    const cv = base.conversas.find((c) => c.modo === "humano")!;
    const esperado = doReducer({ tipo: "devolverParaJanete", conversaId: cv.id });
    montar();
    const r = await rodar(() => fonte.acoes.devolverParaJanete(cv.id));
    expect(r).toEqual(esperado.resultado);
    expect(semEstado(exemplo.estado)).toEqual(semEstado(esperado.estado));
  });

  it("mover: a pessoa move (ator membro), com o mesmo histórico do reducer", async () => {
    const base = inicial();
    const contato = base.contatos.find((c) => c.etapa_id === IDS.etapa.novo) ?? base.contatos[0]!;
    const esperado = doReducer({ tipo: "moverEtapa", contatoId: contato.id, etapaId: IDS.etapa.qualificado, ator: "membro" });
    montar();
    const r = await rodar(() => fonte.acoes.moverEtapa(contato.id, IDS.etapa.qualificado));
    expect(r).toEqual(esperado.resultado);
    expect(semEstado(exemplo.estado)).toEqual(semEstado(esperado.estado));
    expect(exemplo.estado.historico.at(-1)).toMatchObject({ ator: "membro", membro_id: IDS.voce });
  });

  it("mover um contato que não existe: nao_encontrado, como o reducer", async () => {
    const esperado = doReducer({ tipo: "moverEtapa", contatoId: "ct-nao-existe", etapaId: IDS.etapa.ganho, ator: "membro" });
    montar();
    const r = await rodar(() => fonte.acoes.moverEtapa("ct-nao-existe", IDS.etapa.ganho));
    expect(r).toEqual(esperado.resultado);
    expect(r).toEqual({ ok: false, erro: "nao_encontrado" });
  });

  it("editar contato: os mesmos campos aparados do reducer", async () => {
    const base = inicial();
    const contato = base.contatos[0]!;
    const campos = { nome: "  Ana Paula  ", empresa: "", observacoes: "Prefere tarde" };
    const esperado = doReducer({ tipo: "editarContato", contatoId: contato.id, campos });
    montar();
    const r = await rodar(() => fonte.acoes.editarContato(contato.id, campos));
    expect(r).toEqual(esperado.resultado);
    expect(exemplo.estado.contatos).toEqual(esperado.estado.contatos);
  });

  it("editar etapa: o mesmo resultado no nome válido e na recusa do nome vazio", async () => {
    const esperadoOk = doReducer({ tipo: "editarEtapa", etapaId: IDS.etapa.qualificado, campos: { nome: "  Quente  " } });
    const esperadoVazio = doReducer({ tipo: "editarEtapa", etapaId: IDS.etapa.qualificado, campos: { nome: "   " } });
    expect(esperadoVazio.resultado).toEqual({ ok: false, erro: "nome_vazio" });
    montar();
    expect(await rodar(() => fonte.acoes.editarEtapa(IDS.etapa.qualificado, { nome: "   " }))).toEqual(esperadoVazio.resultado);
    expect(await rodar(() => fonte.acoes.editarEtapa(IDS.etapa.qualificado, { nome: "  Quente  " }))).toEqual(esperadoOk.resultado);
    expect(exemplo.estado.etapas).toEqual(esperadoOk.estado.etapas);
  });

  it("as outras ações também passam pelo reducer (reordenar, tentar de novo, apagar)", async () => {
    const base = inicial();
    const ids = base.etapas.filter((e) => e.tipo === "aberta" && !e.arquivada).map((e) => e.id).reverse();
    const esperado = doReducer({ tipo: "reordenarEtapas", ids });
    montar();
    expect(await rodar(() => fonte.acoes.reordenarEtapas(ids))).toEqual(esperado.resultado);
    expect(exemplo.estado.etapas).toEqual(esperado.estado.etapas);
    expect(await rodar(() => fonte.acoes.tentarDeNovo("msg-nao-existe"))).toEqual({ ok: false, erro: "nao_encontrado" });
    const contato = base.contatos[0]!;
    expect(await rodar(() => fonte.acoes.apagarContato(contato.id))).toEqual({ ok: true });
    expect(exemplo.estado.contatos.some((c) => c.id === contato.id)).toBe(false);
  });

  it("marcarVisto guarda o visto da pessoa, e o useEu mostra", async () => {
    montar();
    expect(fonte.useEu).toBeTypeOf("function");
    let eu: ReturnType<FonteDados["useEu"]> | undefined;
    function Eu() {
      eu = useDados().useEu();
      return null;
    }
    cleanup();
    render(
      <ProvedorDados exemplo={inicial} relogio={() => AGORA} progredirEnvios={false}>
        <Espiao />
        <Eu />
      </ProvedorDados>,
    );
    expect(eu?.membro.vistos).toEqual({});
    const r = await rodar(() => fonte.acoes.marcarVisto("kanban"));
    expect(r).toEqual({ ok: true, valor: ISO });
    expect(eu?.membro.vistos).toEqual({ kanban: ISO });
    expect(eu?.ehAdmin).toBe(true);
  });
});

describe("modo exemplo: as leituras comuns", () => {
  type Lidas = {
    membros: ReturnType<FonteDados["useMembros"]>;
    etapas: ReturnType<FonteDados["useEtapas"]>;
    conexao: ReturnType<FonteDados["useConexaoAtiva"]>;
    configuracao: ReturnType<FonteDados["useConfiguracao"]>;
    contexto: ReturnType<FonteDados["useContextoAtual"]>;
    aguardando: ReturnType<FonteDados["useAguardando"]>;
    chaves: ReturnType<FonteDados["useChaves"]>;
    eu: ReturnType<FonteDados["useEu"]>;
  };
  let lidas: Lidas;
  function Leitor() {
    const d = useDados();
    lidas = {
      membros: d.useMembros(),
      etapas: d.useEtapas(),
      conexao: d.useConexaoAtiva(),
      configuracao: d.useConfiguracao(),
      contexto: d.useContextoAtual(),
      aguardando: d.useAguardando(),
      chaves: d.useChaves(),
      eu: d.useEu(),
    };
    return null;
  }

  function montarLeitor(papel: "admin" | "atendente", base: () => EstadoBase = inicial) {
    render(
      <ProvedorPapel inicial={papel}>
        <ProvedorDados exemplo={base} relogio={() => AGORA} progredirEnvios={false}>
          <Leitor />
        </ProvedorDados>
      </ProvedorPapel>,
    );
  }

  it("leem o estado do exemplo, prontas (sem carregar nem erro)", () => {
    const base = inicial();
    montarLeitor("admin");
    expect(lidas.membros).toMatchObject({ dados: base.membros, carregando: false, erro: null });
    expect(lidas.etapas.dados?.map((e) => e.ordem)).toEqual([...base.etapas].map((e) => e.ordem).sort((a, b) => a - b));
    expect(lidas.etapas.dados).toHaveLength(base.etapas.length);
    expect(lidas.conexao.dados).toEqual(base.conexao);
    expect(lidas.configuracao.dados).toEqual({ ...base.configuracao, worker_visto_em: null });
    expect(lidas.contexto.dados).toBeNull();
    expect(lidas.chaves.dados).toEqual(base.chaves);
    expect(lidas.eu.membro.id).toBe(IDS.voce);
  });

  it("Precisam de você: a regra de estaAguardando, quem espera há mais tempo primeiro", () => {
    const base = inicial();
    montarLeitor("admin");
    const esperadas = base.conversas.filter((c) => estaAguardando(c));
    expect(lidas.aguardando.dados?.map((c) => c.id).sort()).toEqual(esperadas.map((c) => c.id).sort());
    const desde = lidas.aguardando.dados!.map((c) => Date.parse(c.aguardando_humano_desde!));
    expect(desde).toEqual([...desde].sort((a, b) => a - b));
  });

  it("a conexão desligada (ativa = false) conta como nenhuma, como no banco", () => {
    const base = inicial();
    montarLeitor("admin", () => ({ ...base, conexao: { ...base.conexao!, ativa: false } }));
    expect(lidas.conexao.dados).toBeNull();
  });

  it("o atendente: sem chaves e sem admin", () => {
    montarLeitor("atendente");
    expect(lidas.chaves.dados).toEqual([]);
    expect(lidas.eu.ehAdmin).toBe(false);
    expect(lidas.eu.membro.id).toBe(IDS.marina);
  });
});
