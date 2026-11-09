import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IDS,
  LIMITES_RITMO,
  ProvedorExemplo,
  conversaDoContato,
  criarEstadoInicial,
  custoDaConversa,
  estaAguardando,
  estaEsfriando,
  idContato,
  idConversa,
  janelaFechada,
  linhaDaConversa,
  mensagensDaConversa,
  janeteAtivaAgora,
  nivelFrio,
  nomeDoMembro,
  reduzir,
  seloDaConversa,
  telefoneLegivel,
  useExemplo,
  type AcaoExemplo,
  type EstadoBase,
  type ResultadoExemplo,
} from "@/features/plataforma/exemplo";
import { ProvedorPapel, usePapel } from "@/features/plataforma/papel";

// O modo exemplo (fundação F1 das telas da plataforma): os dados, o reducer puro com as regras do
// banco e da spec, e o provedor com useExemplo() e o papel (ProvedorPapel). O "Ver como" do topo saiu
// em 30/10: aqui o papel troca pelo setPapel do provedor, como fará a conta quando houver banco.

// Uma quinta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const ISO = AGORA.toISOString();
const DEPOIS = new Date(AGORA.getTime() + 60_000).toISOString();

const inicial = () => criarEstadoInicial(AGORA);

function rodar(estado: EstadoBase, acao: AcaoExemplo, eu: string = IDS.voce, agora = DEPOIS) {
  return reduzir(estado, { acao, euId: eu, agora });
}

const cv = (estado: EstadoBase, lead: string) => estado.conversas.find((c) => c.id === idConversa(lead))!;
const ct = (estado: EstadoBase, lead: string) => estado.contatos.find((c) => c.id === idContato(lead))!;
const recusou = (r: ResultadoExemplo, erro: string) => {
  expect(r).toEqual({ ok: false, erro });
};

describe("dados de exemplo", () => {
  const e = inicial();

  it("as 6 etapas da migration 0001, na ordem, com o que a Janete pode mover", () => {
    expect(e.etapas.map((x) => [x.chave, x.nome, x.ordem, x.tipo, x.janete_pode_mover])).toEqual([
      ["novo", "Novo", 10, "aberta", false],
      ["em_qualificacao", "Em qualificação", 20, "aberta", true],
      ["qualificado", "Qualificado", 30, "aberta", true],
      ["em_negociacao", "Em negociação", 40, "aberta", false],
      ["ganho", "Ganho", 50, "ganho", false],
      ["perdido", "Perdido", 60, "perdido", true],
    ]);
  });

  it("2 membros (admin e Marina, atendente), ~22 contatos em todas as etapas, uma conversa cada", () => {
    expect(e.membros.map((m) => [m.id, m.papel])).toEqual([
      [IDS.voce, "admin"],
      [IDS.marina, "atendente"],
    ]);
    expect(e.contatos.length).toBeGreaterThanOrEqual(20);
    expect(e.conversas).toHaveLength(e.contatos.length);
    for (const etapa of e.etapas) expect(e.contatos.some((c) => c.etapa_id === etapa.id)).toBe(true);
    for (const c of e.contatos) expect(conversaDoContato(e, c.id)).toBeDefined();
  });

  it("telefones só com dígitos e o 55, como no banco, visivelmente falsos; e-mails em .exemplo", () => {
    for (const c of e.contatos) {
      expect(c.telefone).toMatch(/^55\d{10,11}$/);
      expect(telefoneLegivel(c.telefone)).toMatch(/^\(\d{2}\) 90000-\d{4}$/);
      if (c.email) expect(c.email).toMatch(/\.exemplo$/);
    }
    expect(telefoneLegivel("5511900000001")).toBe("(11) 90000-0001");
    expect(telefoneLegivel("551133334444")).toBe("(11) 3333-4444");
    expect(telefoneLegivel("14155550100")).toBe("14155550100");
    expect(telefoneLegivel(null)).toBe("");
    // o rótulo da conexão é livre e continua formatado
    expect(e.conexao?.nome).toBe("(11) 90000-0000");
  });

  it("conversas em todos os estados: Janete, aguardando (janete_passou e sem_credito), Marina, celular, esfriando, não lidas", () => {
    const situacoes = new Set(e.conversas.map((c) => seloDaConversa(c)));
    expect([...situacoes].sort()).toEqual(["aguardando", "celular", "falha", "janete", "membro"]);
    expect(e.conversas.some((c) => c.motivo_humano === "janete_passou" && c.aguardando_humano_desde)).toBe(true);
    expect(e.conversas.some((c) => c.motivo_humano === "sem_credito" && c.aguardando_humano_desde)).toBe(true);
    expect(e.conversas.some((c) => c.responsavel_id === IDS.marina)).toBe(true);
    expect(e.conversas.some((c) => c.nao_lidas > 0)).toBe(true);
    expect(e.conversas.some((c) => estaEsfriando(e, c, AGORA))).toBe(true);
    expect(e.digitando).toEqual([idConversa("fernando")]);
    // Ganho e Perdido não esfriam
    const fim = new Set<string>([IDS.etapa.ganho, IDS.etapa.perdido]);
    for (const c of e.conversas) {
      const contato = e.contatos.find((x) => x.id === c.contato_id)!;
      if (fim.has(contato.etapa_id)) expect(estaEsfriando(e, c, AGORA)).toBe(false);
    }
  });

  it("as mensagens cobrem os 6 tipos, citação, reação, falha, apagada, editada e áudio com e sem transcrição", () => {
    const tipos = new Set(e.mensagens.map((m) => m.tipo));
    for (const t of ["texto", "audio", "imagem", "documento", "video", "figurinha"]) expect(tipos.has(t as never)).toBe(true);
    expect(e.mensagens.some((m) => m.citaId && e.mensagens.some((x) => x.id === m.citaId))).toBe(true);
    expect(e.mensagens.some((m) => m.reacao)).toBe(true);
    expect(e.mensagens.some((m) => m.status === "falhou" && m.erro)).toBe(true);
    expect(e.mensagens.some((m) => m.apagada_em && m.texto === null)).toBe(true);
    expect(e.mensagens.some((m) => m.editada)).toBe(true);
    expect(e.mensagens.some((m) => m.tipo === "audio" && m.transcricao && m.duracaoS)).toBe(true);
    expect(e.mensagens.some((m) => m.tipo === "audio" && m.transcricao === null)).toBe(true);
    expect(e.mensagens.some((m) => m.origem === "humano_celular")).toBe(true);
    // quem escreve pela tela tem autor (constraint mensagens_humano_tela_autor)
    for (const m of e.mensagens.filter((x) => x.origem === "humano_tela")) expect(m.autor_membro_id).not.toBeNull();
  });

  it("tudo acontece antes de agora, e a conversa guarda a prévia e a última do lead como o banco", () => {
    for (const m of e.mensagens) expect(new Date(m.momento).getTime()).toBeLessThan(AGORA.getTime());
    const r = cv(e, "ricardo");
    const msgs = mensagensDaConversa(e, r.id);
    expect(r.ultima_mensagem_preview).toBe("E à vista vocês fazem algum desconto?");
    expect(r.ultima_mensagem_em).toBe(msgs[msgs.length - 1]!.momento);
    expect(r.ultima_do_lead_em).toBe(msgs[msgs.length - 1]!.momento);
    // a prévia do banco: o texto ou "[tipo]"
    expect(cv(e, "aline").ultima_mensagem_preview).toBe("[audio]");
  });

  it("histórico de etapas com ator e a etapa atual igual à última mudança", () => {
    const h = e.historico.filter((x) => x.contato_id === idContato("patricia"));
    expect(h.map((x) => [x.ator, x.membro_id])).toEqual([
      ["sistema", null],
      ["janete", null],
      ["membro", IDS.marina],
    ]);
    expect(ct(e, "patricia").etapa_id).toBe(h[h.length - 1]!.para_etapa_id);
    expect(ct(e, "patricia").etapa_desde).toBe(h[h.length - 1]!.criado_em);
  });

  it("Z-API conectada, Claude Haiku 5.5 terminada em TSTE, sem chave de transcrição, ritmo 8 s e 60 s", () => {
    expect(e.conexao).toMatchObject({ gateway: "zapi", status: "conectada", ativa: true, oficial: false });
    expect(e.chaves).toHaveLength(1);
    expect(e.chaves[0]).toMatchObject({ finalidade: "resposta", provedor: "anthropic", modelo: "claude-haiku-5-5", ultimos4: "TSTE", status: "ativa" });
    expect(e.chaves.some((c) => c.finalidade === "transcricao")).toBe(false);
    expect(e.configuracao).toMatchObject({ espera_lote_s: 8, espera_lote_max_s: 60 });
    // nada de segredo na tela
    expect(JSON.stringify(e)).not.toMatch(/segredos|chave_cifrada/);
  });

  it("a linha do tempo junta mensagens, passagens e mudanças de etapa na ordem", () => {
    const linha = linhaDaConversa(e, idConversa("ricardo"));
    const tempos = linha.map((i) => new Date(i.em).getTime());
    expect([...tempos].sort((a, b) => a - b)).toEqual(tempos);
    expect(linha.filter((i) => i.k === "passagem").map((i) => (i.k === "passagem" ? i.evento.tipo : ""))).toEqual(["passou"]);
    // a entrada em Novo pelo sistema não aparece; as mudanças da Janete, sim
    expect(linha.filter((i) => i.k === "etapa")).toHaveLength(2);
  });

  it("custo de IA por conversa, em dólar", () => {
    expect(custoDaConversa(e, idConversa("ricardo"))).toBeGreaterThan(0);
  });

  // O "de" de uma passagem (de onde a conversa veio) não pode confundir o evento com uma mensagem: o
  // "assumiu" da Patrícia e o da Beatriz já viraram um balão vazio da Janete, com custo de IA (achado
  // nos prints do Chat, 30/10).
  it("passagem com origem continua passagem: nenhum balão vazio da Janete e custo só nas respostas dela", () => {
    const passagens = (lead: string) =>
      e.eventos.filter((x) => x.conversa_id === idConversa(lead)).map((x) => [x.tipo, x.de, x.membro_id]);
    expect(passagens("patricia")).toEqual([["assumiu", "janete", IDS.marina]]);
    expect(passagens("beatriz")).toEqual([
      ["assumiu", "janete", IDS.voce],
      ["devolveu", null, IDS.voce],
    ]);
    expect(e.mensagens.filter((m) => m.origem === "janete" && !m.texto && !m.midia_nome && !m.apagada_em)).toEqual([]);
    expect(e.custos).toHaveLength(e.mensagens.filter((m) => m.origem === "janete").length);
  });

  // Os extras dos Contatos (spec de Contatos, decisões 6 e 7, pedido da sessão dos Contatos em 30/10):
  // cada fato aponta para uma mensagem da conversa do próprio contato, nunca para uma passagem. O
  // índice na semente conta mensagens e passagens juntas: mudar a ordem dos itens quebra aqui.
  it("fatos da Janete apontam para mensagens do próprio contato; a Ana Clara fica sem nada e Perdido sem próximo passo", () => {
    const porId = new Map(e.mensagens.map((m) => [m.id, m]));
    for (const c of e.contatos) {
      const conversa = idConversa(c.id.replace(/^ct-/, ""));
      for (const f of c.fatosJanete ?? []) {
        if (f.mensagemId == null) continue;
        expect(porId.get(f.mensagemId)?.conversa_id, `${c.nome}: ${f.rotulo}`).toBe(conversa);
      }
    }
    expect(e.contatos.filter((c) => (c.fatosJanete ?? []).length > 0)).toHaveLength(22);
    expect(ct(e, "ana").fatosJanete).toEqual([]);
    expect(ct(e, "ana").proximoPasso).toBeNull();
    expect(e.contatos.filter((c) => c.etapa_id === IDS.etapa.perdido && c.proximoPasso).map((c) => c.nome)).toEqual([]);
  });
});

describe("reducer: conversa", () => {
  it("responder sem assumir: a mensagem tira a Janete, fica comigo, gera o evento e cancela a fila dela", () => {
    let e = inicial();
    // a Janete tinha uma resposta na fila do Fernando
    e = {
      ...e,
      mensagens: e.mensagens.map((m) => (m.id === "msg-fernando-2" ? { ...m, status: "na_fila" as const } : m)),
    };
    const r = rodar(e, { tipo: "enviarMensagem", conversaId: idConversa("fernando"), mensagem: { tipo: "texto", texto: "  Oi, Fernando!  " } }, IDS.marina);
    expect(r.resultado).toMatchObject({ ok: true, assumiu: true });
    const id = r.resultado.ok ? r.resultado.id : "";
    const conv = cv(r.estado, "fernando");
    expect(conv).toMatchObject({
      modo: "humano",
      responsavel_id: IDS.marina,
      motivo_humano: "humano_tela",
      aguardando_humano_desde: null,
      nao_lidas: 0,
      ultima_mensagem_em: DEPOIS,
      ultima_mensagem_preview: "Oi, Fernando!",
    });
    const m = r.estado.mensagens.find((x) => x.id === id)!;
    expect(m).toMatchObject({ origem: "humano_tela", direcao: "saida", status: "na_fila", autor_membro_id: IDS.marina, texto: "Oi, Fernando!" });
    expect(r.estado.mensagens.find((x) => x.id === "msg-fernando-2")!.status).toBe("cancelada");
    expect(r.estado.digitando).not.toContain(conv.id);
    const ev = r.estado.eventos[r.estado.eventos.length - 1]!;
    expect(ev).toMatchObject({ conversa_id: conv.id, tipo: "assumiu", membro_id: IDS.marina, de: "janete", por_envio: true });
  });

  it("na linha do tempo, o 'Você assumiu' do envio vem antes da mensagem que o causou (mesmo instante)", () => {
    const r = rodar(inicial(), { tipo: "enviarMensagem", conversaId: idConversa("fernando"), mensagem: { tipo: "texto", texto: "Oi" } });
    const id = r.resultado.ok ? r.resultado.id : "";
    const linha = linhaDaConversa(r.estado, idConversa("fernando"));
    const iPassagem = linha.findIndex((i) => i.k === "passagem" && i.evento.por_envio);
    const iMensagem = linha.findIndex((i) => i.k === "mensagem" && i.id === id);
    expect(iPassagem).toBeGreaterThanOrEqual(0);
    expect(iPassagem).toBe(iMensagem - 1);
  });

  it("responder uma conversa que espera: sai da espera e fica comigo, mantendo o motivo", () => {
    const r = rodar(inicial(), { tipo: "enviarMensagem", conversaId: idConversa("ricardo"), mensagem: { tipo: "texto", texto: "Oi" } });
    expect(cv(r.estado, "ricardo")).toMatchObject({ responsavel_id: IDS.voce, aguardando_humano_desde: null, motivo_humano: "janete_passou" });
    expect(r.estado.eventos[r.estado.eventos.length - 1]).toMatchObject({ tipo: "assumiu", de: "espera" });
  });

  it("responder uma conversa de outra pessoa não a tira dela (como o banco) e não gera evento", () => {
    const e = inicial();
    const r = rodar(e, { tipo: "enviarMensagem", conversaId: idConversa("patricia"), mensagem: { tipo: "texto", texto: "Oi" } });
    expect(r.resultado).toMatchObject({ ok: true, assumiu: false });
    expect(cv(r.estado, "patricia").responsavel_id).toBe(IDS.marina);
    expect(r.estado.eventos).toHaveLength(e.eventos.length);
  });

  it("texto vazio e sem anexo: nada sai e a Janete continua", () => {
    const e = inicial();
    const r = rodar(e, { tipo: "enviarMensagem", conversaId: idConversa("aline"), mensagem: { tipo: "texto", texto: "   " } });
    expect(r.resultado).toEqual({ ok: true });
    expect(r.estado).toBe(e);
    expect(cv(r.estado, "aline").modo).toBe("janete");
  });

  it("anexo e áudio: guarda o nome, o tipo, o tamanho, a duração e a citação", () => {
    const r = rodar(inicial(), {
      tipo: "enviarMensagem",
      conversaId: idConversa("ricardo"),
      mensagem: { tipo: "audio", midia: { nome: "gravacao.ogg", mime: "audio/ogg", tamanho: 1000, duracaoS: 7 }, citaId: "msg-ricardo-9" },
    });
    const id = r.resultado.ok ? r.resultado.id : "";
    expect(r.estado.mensagens.find((m) => m.id === id)).toMatchObject({
      tipo: "audio",
      texto: null,
      midia_nome: "gravacao.ogg",
      midia_tamanho: 1000,
      duracaoS: 7,
      citaId: "msg-ricardo-9",
    });
    expect(cv(r.estado, "ricardo").ultima_mensagem_preview).toBe("[audio]");
  });

  it("sem conexão ativa nada sai: sem_conexao_ativa, sem mudar o estado", () => {
    const e = rodar(inicial(), { tipo: "simularJanete", evento: { tipo: "conexao", status: "desconectada" } }).estado;
    const r = rodar(e, { tipo: "enviarMensagem", conversaId: idConversa("ricardo"), mensagem: { tipo: "texto", texto: "Oi" } });
    recusou(r.resultado, "sem_conexao_ativa");
    expect(r.estado).toBe(e);
    recusou(rodar(e, { tipo: "tentarDeNovo", mensagemId: "msg-ricardo-11" }).resultado, "sem_conexao_ativa");
  });

  it("janela de 24 h: só na API oficial, com o lead calado há 24 h ou mais", () => {
    const e = inicial();
    const marcos = cv(e, "marcos"); // o lead escreveu há 3 dias
    expect(janelaFechada(e, marcos, AGORA)).toBe(false); // Z-API: não há janela
    const meta = rodar(e, { tipo: "trocarConexao", nova: { gateway: "meta", nome: "(11) 90000-0000" } });
    expect(meta.estado.conexao?.oficial).toBe(true);
    const r = rodar(meta.estado, { tipo: "enviarMensagem", conversaId: marcos.id, mensagem: { tipo: "texto", texto: "Oi" } });
    recusou(r.resultado, "janela_fechada");
    expect(r.estado).toBe(meta.estado);
    // a Juliana escreveu há poucos minutos: a janela está aberta
    const ok = rodar(meta.estado, { tipo: "enviarMensagem", conversaId: idConversa("juliana"), mensagem: { tipo: "texto", texto: "Oi" } });
    expect(ok.resultado.ok).toBe(true);
  });

  it("assumir: fica comigo, sai da espera, e de outra pessoa também (cada um assume para si)", () => {
    const e = inicial();
    const a = rodar(e, { tipo: "assumir", conversaId: idConversa("juliana") }, IDS.marina);
    expect(a.resultado).toEqual({ ok: true, assumiu: true });
    expect(cv(a.estado, "juliana")).toMatchObject({ modo: "humano", responsavel_id: IDS.marina, aguardando_humano_desde: null, motivo_humano: "sem_credito" });
    expect(a.estado.eventos[a.estado.eventos.length - 1]).toMatchObject({ tipo: "assumiu", de: "espera", por_envio: false });

    const b = rodar(e, { tipo: "assumir", conversaId: idConversa("patricia") });
    expect(cv(b.estado, "patricia").responsavel_id).toBe(IDS.voce);
    expect(b.estado.eventos[b.estado.eventos.length - 1]).toMatchObject({ de: "outro", de_membro_id: IDS.marina });

    const c = rodar(e, { tipo: "assumir", conversaId: idConversa("aline") });
    expect(cv(c.estado, "aline")).toMatchObject({ modo: "humano", motivo_humano: "humano_tela", responsavel_id: IDS.voce });

    // assumir o que já é meu não muda nada
    const d = rodar(b.estado, { tipo: "assumir", conversaId: idConversa("patricia") });
    expect(d.estado).toBe(b.estado);
  });

  it("devolver para a Janete: qualquer membro; limpa o motivo, a espera e o responsável", () => {
    const e = inicial();
    const r = rodar(e, { tipo: "devolverParaJanete", conversaId: idConversa("patricia") }, IDS.marina);
    expect(r.resultado).toEqual({ ok: true });
    expect(cv(r.estado, "patricia")).toMatchObject({
      modo: "janete",
      motivo_humano: null,
      aguardando_humano_desde: null,
      responsavel_id: null,
      devolvida_em: DEPOIS,
    });
    expect(r.estado.eventos[r.estado.eventos.length - 1]).toMatchObject({ tipo: "devolveu", membro_id: IDS.marina });
    // devolver o que já está com a Janete não muda nada
    expect(rodar(e, { tipo: "devolverParaJanete", conversaId: idConversa("aline") }).estado).toBe(e);
  });

  it("marcar lida zera as não lidas; reagir põe e tira o emoji sem tirar a Janete", () => {
    const e = inicial();
    expect(cv(rodar(e, { tipo: "marcarLida", conversaId: idConversa("aline") }).estado, "aline").nao_lidas).toBe(0);
    const r = rodar(e, { tipo: "reagir", mensagemId: "msg-aline-1", emoji: "👍" });
    expect(r.estado.mensagens.find((m) => m.id === "msg-aline-1")!.reacao).toBe("👍");
    expect(cv(r.estado, "aline").modo).toBe("janete");
    const t = rodar(r.estado, { tipo: "reagir", mensagemId: "msg-aline-1", emoji: null });
    expect(t.estado.mensagens.find((m) => m.id === "msg-aline-1")!.reacao).toBeNull();
  });

  it("tentar de novo: a mensagem que falhou volta para a fila", () => {
    const r = rodar(inicial(), { tipo: "tentarDeNovo", mensagemId: "msg-ricardo-11" });
    expect(r.resultado).toEqual({ ok: true, id: "msg-ricardo-11" });
    expect(r.estado.mensagens.find((m) => m.id === "msg-ricardo-11")).toMatchObject({ status: "na_fila", erro: null });
  });

  it("id que não existe: nao_encontrado, sem lançar", () => {
    const e = inicial();
    recusou(rodar(e, { tipo: "assumir", conversaId: "cv-ninguem" }).resultado, "nao_encontrado");
    recusou(rodar(e, { tipo: "reagir", mensagemId: "x", emoji: "👍" }).resultado, "nao_encontrado");
    recusou(rodar(e, { tipo: "moverEtapa", contatoId: idContato("aline"), etapaId: "et-x", ator: "membro" }).resultado, "nao_encontrado");
  });

  it("membro desconhecido ou inativo não faz nada: sem_permissao", () => {
    const e = inicial();
    recusou(rodar(e, { tipo: "assumir", conversaId: idConversa("aline") }, "mb-ninguem").resultado, "sem_permissao");
    const inativa = { ...e, membros: e.membros.map((m) => (m.id === IDS.marina ? { ...m, ativo: false } : m)) };
    recusou(rodar(inativa, { tipo: "assumir", conversaId: idConversa("aline") }, IDS.marina).resultado, "sem_permissao");
  });
});

describe("reducer: etapas e contatos", () => {
  it("mover etapa pelo membro: qualquer etapa (inclusive Ganho), com histórico e ator", () => {
    const e = inicial();
    const r = rodar(e, { tipo: "moverEtapa", contatoId: idContato("aline"), etapaId: IDS.etapa.ganho, ator: "membro" }, IDS.marina);
    expect(r.resultado).toEqual({ ok: true });
    expect(ct(r.estado, "aline")).toMatchObject({ etapa_id: IDS.etapa.ganho, etapa_desde: DEPOIS });
    expect(r.estado.historico[r.estado.historico.length - 1]).toMatchObject({
      contato_id: idContato("aline"),
      de_etapa_id: IDS.etapa.novo,
      para_etapa_id: IDS.etapa.ganho,
      ator: "membro",
      membro_id: IDS.marina,
      criado_em: DEPOIS,
    });
    // para a mesma etapa: nada muda
    expect(rodar(e, { tipo: "moverEtapa", contatoId: idContato("aline"), etapaId: IDS.etapa.novo, ator: "membro" }).estado).toBe(e);
  });

  it("mover pela Janete: só para as etapas que ela pode; o histórico fica com ator janete", () => {
    const e = inicial();
    const ok = rodar(e, { tipo: "moverEtapa", contatoId: idContato("aline"), etapaId: IDS.etapa.qualificado, ator: "janete" });
    expect(ok.estado.historico[ok.estado.historico.length - 1]).toMatchObject({ ator: "janete", membro_id: null });
    recusou(rodar(e, { tipo: "moverEtapa", contatoId: idContato("aline"), etapaId: IDS.etapa.ganho, ator: "janete" }).resultado, "sem_permissao");
    recusou(rodar(e, { tipo: "simularJanete", evento: { tipo: "janete_move", contatoId: idContato("aline"), etapaId: IDS.etapa.em_negociacao } }).resultado, "sem_permissao");
  });

  it("etapa arquivada não recebe ninguém", () => {
    const e = inicial();
    const arq = { ...e, etapas: e.etapas.map((x) => (x.id === IDS.etapa.ganho ? { ...x, arquivada: true } : x)) };
    recusou(rodar(arq, { tipo: "moverEtapa", contatoId: idContato("aline"), etapaId: IDS.etapa.ganho, ator: "membro" }).resultado, "sem_permissao");
  });

  it("editar etapa: só o admin; nome aparado e com até 32 caracteres, cor e 'Janete pode mover'", () => {
    const e = inicial();
    const negado = rodar(e, { tipo: "editarEtapa", etapaId: IDS.etapa.qualificado, campos: { nome: "Quente" } }, IDS.marina);
    recusou(negado.resultado, "sem_permissao");
    expect(negado.estado).toBe(e);

    const r = rodar(e, { tipo: "editarEtapa", etapaId: IDS.etapa.qualificado, campos: { nome: "  Lead quente  ", cor: "#ff8800", janete_pode_mover: false } });
    expect(r.resultado).toEqual({ ok: true });
    expect(r.estado.etapas.find((x) => x.id === IDS.etapa.qualificado)).toMatchObject({ nome: "Lead quente", cor: "#ff8800", janete_pode_mover: false });
    // a Janete deixa de poder mover para ela
    recusou(rodar(r.estado, { tipo: "moverEtapa", contatoId: idContato("aline"), etapaId: IDS.etapa.qualificado, ator: "janete" }).resultado, "sem_permissao");

    const longo = rodar(e, { tipo: "editarEtapa", etapaId: IDS.etapa.novo, campos: { nome: "x".repeat(40) } });
    expect(longo.estado.etapas.find((x) => x.id === IDS.etapa.novo)!.nome).toHaveLength(32);
    recusou(rodar(e, { tipo: "editarEtapa", etapaId: IDS.etapa.novo, campos: { nome: "   " } }).resultado, "nome_vazio");
    recusou(rodar(e, { tipo: "editarEtapa", etapaId: "et-x", campos: { nome: "A" } }).resultado, "nao_encontrado");
  });

  it("arquivar etapa: com contato não pode; a última aberta não pode; vazia arquiva e restaura", () => {
    const e = inicial();
    recusou(rodar(e, { tipo: "editarEtapa", etapaId: IDS.etapa.qualificado, campos: { arquivada: true } }).resultado, "etapa_com_leads");

    // só Novo aberta e sem ninguém nela: arquivar deixaria o lead novo sem entrada
    const abertas = [IDS.etapa.em_qualificacao, IDS.etapa.qualificado, IDS.etapa.em_negociacao] as string[];
    const so = {
      ...e,
      etapas: e.etapas.map((x) => (abertas.includes(x.id) ? { ...x, arquivada: true } : x)),
      contatos: e.contatos.filter((c) => c.etapa_id !== IDS.etapa.novo),
    };
    recusou(rodar(so, { tipo: "editarEtapa", etapaId: IDS.etapa.novo, campos: { arquivada: true } }).resultado, "sem_etapa_de_entrada");

    // vazia e com outra aberta: arquiva e restaura
    const vazia = { ...e, contatos: e.contatos.filter((c) => c.etapa_id !== IDS.etapa.em_negociacao) };
    const arq = rodar(vazia, { tipo: "editarEtapa", etapaId: IDS.etapa.em_negociacao, campos: { arquivada: true } });
    expect(arq.resultado).toEqual({ ok: true });
    expect(arq.estado.etapas.find((x) => x.id === IDS.etapa.em_negociacao)!.arquivada).toBe(true);
    const volta = rodar(arq.estado, { tipo: "editarEtapa", etapaId: IDS.etapa.em_negociacao, campos: { arquivada: false } });
    expect(volta.estado.etapas.find((x) => x.id === IDS.etapa.em_negociacao)!.arquivada).toBe(false);
  });

  it("reordenar etapas: só o admin, dentro de um grupo; Ganho e Perdido continuam no fim", () => {
    const e = inicial();
    const nova = [IDS.etapa.em_negociacao, IDS.etapa.novo, IDS.etapa.em_qualificacao, IDS.etapa.qualificado];
    recusou(rodar(e, { tipo: "reordenarEtapas", ids: nova }, IDS.marina).resultado, "sem_permissao");

    const r = rodar(e, { tipo: "reordenarEtapas", ids: nova });
    expect(r.resultado).toEqual({ ok: true });
    const ordem = (x: EstadoBase) => [...x.etapas].sort((a, b) => a.ordem - b.ordem).map((y) => [y.chave, y.ordem]);
    expect(ordem(r.estado)).toEqual([
      ["em_negociacao", 10],
      ["novo", 20],
      ["em_qualificacao", 30],
      ["qualificado", 40],
      ["ganho", 50],
      ["perdido", 60],
    ]);

    const fim = rodar(e, { tipo: "reordenarEtapas", ids: [IDS.etapa.perdido, IDS.etapa.ganho] });
    expect(ordem(fim.estado).slice(-2)).toEqual([
      ["perdido", 50],
      ["ganho", 60],
    ]);

    recusou(rodar(e, { tipo: "reordenarEtapas", ids: [IDS.etapa.ganho, IDS.etapa.novo] }).resultado, "sem_permissao");
    recusou(rodar(e, { tipo: "reordenarEtapas", ids: [IDS.etapa.novo, IDS.etapa.novo] }).resultado, "nao_encontrado");
    recusou(rodar(e, { tipo: "reordenarEtapas", ids: ["et-x"] }).resultado, "nao_encontrado");
    // a mesma ordem: nada muda
    expect(rodar(e, { tipo: "reordenarEtapas", ids: [IDS.etapa.novo, IDS.etapa.em_qualificacao] }).estado).toBe(e);
  });

  it("editar contato: qualquer membro; apara os espaços e vazio vira nulo", () => {
    const r = rodar(inicial(), { tipo: "editarContato", contatoId: idContato("aline"), campos: { observacoes: "  Liga à tarde ", email: "   " } }, IDS.marina);
    expect(r.resultado).toEqual({ ok: true });
    expect(ct(r.estado, "aline")).toMatchObject({ observacoes: "Liga à tarde", email: null, atualizado_em: DEPOIS });
  });

  it("apagar contato: só o admin; leva a conversa, as mensagens, o histórico, o custo e fica na auditoria", () => {
    const e = inicial();
    const negado = rodar(e, { tipo: "apagarContato", contatoId: idContato("ricardo") }, IDS.marina);
    recusou(negado.resultado, "sem_permissao");
    expect(negado.estado).toBe(e);

    const r = rodar(e, { tipo: "apagarContato", contatoId: idContato("ricardo") });
    expect(r.resultado).toEqual({ ok: true });
    const conv = idConversa("ricardo");
    expect(r.estado.contatos.some((c) => c.id === idContato("ricardo"))).toBe(false);
    expect(r.estado.conversas.some((c) => c.id === conv)).toBe(false);
    expect(r.estado.mensagens.some((m) => m.conversa_id === conv)).toBe(false);
    expect(r.estado.eventos.some((m) => m.conversa_id === conv)).toBe(false);
    expect(r.estado.custos.some((m) => m.conversa_id === conv)).toBe(false);
    expect(r.estado.historico.some((h) => h.contato_id === idContato("ricardo"))).toBe(false);
    expect(r.estado.auditoria).toEqual([
      expect.objectContaining({ acao: "contato_apagado", alvo: idContato("ricardo"), ator_membro_id: IDS.voce }),
    ]);
  });
});

describe("reducer: configuração (só o admin)", () => {
  it("trocar a conexão, desconectar e a auditoria; a atendente não pode", () => {
    const e = inicial();
    recusou(rodar(e, { tipo: "trocarConexao", nova: null }, IDS.marina).resultado, "sem_permissao");

    const fora = rodar(e, { tipo: "trocarConexao", nova: null });
    expect(fora.estado.conexao).toMatchObject({ ativa: false, status: "desconectada" });
    recusou(rodar(fora.estado, { tipo: "enviarMensagem", conversaId: idConversa("aline"), mensagem: { tipo: "texto", texto: "Oi" } }).resultado, "sem_conexao_ativa");

    const nova = rodar(e, { tipo: "trocarConexao", nova: { gateway: "evolution", nome: "(11) 90000-0009" } });
    expect(nova.estado.conexao).toMatchObject({ gateway: "evolution", nome: "(11) 90000-0009", ativa: true, status: "conectada", oficial: false });
    expect(nova.estado.auditoria.map((a) => [a.id, a.acao])).toEqual([
      [1, "conexao_desativada"],
      [2, "conexao_criada"],
    ]);
    // sem conexão anterior: só a criada
    expect(rodar(fora.estado, { tipo: "trocarConexao", nova: { gateway: "zapi", nome: "x" } }).estado.auditoria.map((a) => a.acao)).toEqual([
      "conexao_desativada",
      "conexao_criada",
    ]);
  });

  it("Zernio também é API oficial: a janela de 24 h bloqueia o lead calado há 24 h", () => {
    const z = rodar(inicial(), { tipo: "trocarConexao", nova: { gateway: "zernio", nome: "(11) 90000-0000" } });
    expect(z.estado.conexao?.oficial).toBe(true);
    recusou(rodar(z.estado, { tipo: "enviarMensagem", conversaId: idConversa("marcos"), mensagem: { tipo: "texto", texto: "Oi" } }).resultado, "janela_fechada");
    // Z-API e Evolution não
    const ev = rodar(inicial(), { tipo: "trocarConexao", nova: { gateway: "evolution", nome: "x" } });
    expect(ev.estado.conexao?.oficial).toBe(false);
  });

  it("a simulação de conexão muda só o status: o número desconectado pelo admin não volta", () => {
    const fora = rodar(inicial(), { tipo: "trocarConexao", nova: null }).estado;
    const r = rodar(fora, { tipo: "simularJanete", evento: { tipo: "conexao", status: "conectada" } });
    recusou(r.resultado, "nao_encontrado");
    expect(r.estado).toBe(fora);
    // com o número ativo, a queda e a volta mudam só o status
    const caiu = rodar(inicial(), { tipo: "simularJanete", evento: { tipo: "conexao", status: "erro", ultimo_erro: "Sessão expirou" } }).estado;
    expect(caiu.conexao).toMatchObject({ status: "erro", ativa: true, ultimo_erro: "Sessão expirou" });
    expect(rodar(caiu, { tipo: "simularJanete", evento: { tipo: "conexao", status: "conectada" } }).estado.conexao).toMatchObject({
      status: "conectada",
      ativa: true,
      ultimo_erro: null,
    });
  });

  it("trocar e remover a chave de IA guarda só os 4 últimos; a atendente não pode", () => {
    const e = inicial();
    recusou(rodar(e, { tipo: "trocarChaveIA", finalidade: "resposta", nova: null }, IDS.marina).resultado, "sem_permissao");
    const r = rodar(e, { tipo: "trocarChaveIA", finalidade: "transcricao", nova: { provedor: "groq", modelo: "whisper-large-v3", ultimos4: "sk-exemplo-ABCD" } });
    expect(r.estado.chaves.find((c) => c.finalidade === "transcricao")).toMatchObject({ provedor: "groq", ultimos4: "ABCD", status: "ativa", validada_em: DEPOIS });
    expect(JSON.stringify(r.estado)).not.toContain("sk-exemplo");
    expect(r.estado.auditoria[0]).toMatchObject({ acao: "chave_cadastrada", ultimos4: "ABCD" });
    const sem = rodar(r.estado, { tipo: "trocarChaveIA", finalidade: "transcricao", nova: null });
    expect(sem.estado.chaves.some((c) => c.finalidade === "transcricao")).toBe(false);
    expect(sem.estado.auditoria[1]).toMatchObject({ acao: "chave_removida" });
  });

  it("trocar só o modelo, com a mesma chave ativa, mantém a última validação; chave nova valida agora", () => {
    const e = inicial();
    const antes = e.chaves.find((c) => c.finalidade === "resposta")!;
    const modelo = rodar(e, { tipo: "trocarChaveIA", finalidade: "resposta", nova: { provedor: antes.provedor, modelo: "outro-modelo", ultimos4: antes.ultimos4 ?? "" } });
    expect(modelo.estado.chaves.find((c) => c.finalidade === "resposta")).toMatchObject({ modelo: "outro-modelo", validada_em: antes.validada_em, atualizada_em: DEPOIS });
    const nova = rodar(e, { tipo: "trocarChaveIA", finalidade: "resposta", nova: { provedor: antes.provedor, modelo: antes.modelo, ultimos4: "sk-WXYZ" } });
    expect(nova.estado.chaves.find((c) => c.finalidade === "resposta")).toMatchObject({ ultimos4: "WXYZ", validada_em: DEPOIS });
  });

  it("salvar o ritmo: só o admin, preso aos limites (teto sempre 5 s acima da espera)", () => {
    const e = inicial();
    recusou(rodar(e, { tipo: "salvarRitmo", espera: 10, teto: 40 }, IDS.marina).resultado, "sem_permissao");
    expect(rodar(e, { tipo: "salvarRitmo", espera: 10, teto: 40 }).estado.configuracao).toMatchObject({ espera_lote_s: 10, espera_lote_max_s: 40 });
    const preso = rodar(e, { tipo: "salvarRitmo", espera: 99, teto: 1 }).estado.configuracao;
    expect(preso.espera_lote_s).toBe(LIMITES_RITMO.espera.max);
    expect(preso.espera_lote_max_s).toBe(LIMITES_RITMO.espera.max + LIMITES_RITMO.folga);
    // campo vazio (NaN): fica o valor que já estava
    expect(rodar(e, { tipo: "salvarRitmo", espera: Number.NaN, teto: Number.NaN }).estado.configuracao).toMatchObject({
      espera_lote_s: 8,
      espera_lote_max_s: 60,
    });
    expect(rodar(e, { tipo: "salvarRitmo", espera: 12, teto: Number.NaN }).estado.configuracao).toMatchObject({
      espera_lote_s: 12,
      espera_lote_max_s: 60,
    });
  });

  it("a voz em uso: o exemplo começa no 'quando o lead manda áudio', sem voz e sem erro", () => {
    expect(inicial().configuracao).toMatchObject({ voz_resposta: "quando_audio", voz_id: null, voz_nome: null, voz_erro: null });
  });

  it("escolher a voz: só o admin, grava id e nome, limpa o erro e audita voz_alterada sem dado pessoal", () => {
    const e = { ...inicial(), configuracao: { ...inicial().configuracao, voz_id: "voz-velha", voz_nome: "Velha", voz_erro: "voz_nao_encontrada" } };
    recusou(rodar(e, { tipo: "escolherVoz", voz: { id: "exemplo-voz-a", nome: "Voz de exemplo A" } }, IDS.marina).resultado, "sem_permissao");
    const r = rodar(e, { tipo: "escolherVoz", voz: { id: "exemplo-voz-a", nome: "  Voz de exemplo A  " } });
    expect(r.resultado).toEqual({ ok: true });
    expect(r.estado.configuracao).toMatchObject({ voz_id: "exemplo-voz-a", voz_nome: "Voz de exemplo A", voz_erro: null, atualizado_em: DEPOIS });
    expect(r.estado.auditoria.at(-1)).toMatchObject({
      acao: "voz_alterada",
      ator_membro_id: IDS.voce,
      detalhe: { voz_nome: "Voz de exemplo A", voz_nome_anterior: "Velha" },
    });
    // o id vai numa URL da ElevenLabs no servidor: fora do formato, recusa; o nome é cortado em 120
    recusou(rodar(e, { tipo: "escolherVoz", voz: { id: "../x", nome: "X" } }).resultado, "nao_encontrado");
    recusou(rodar(e, { tipo: "escolherVoz", voz: { id: "voz-b", nome: "   " } }).resultado, "nao_encontrado");
    expect([...(rodar(e, { tipo: "escolherVoz", voz: { id: "voz-b", nome: "😀".repeat(130) } }).estado.configuracao.voz_nome ?? "")]).toHaveLength(120);
  });

  it("salvar o modo da voz: só o admin, modo fora da lista recusado, o mesmo modo não audita", () => {
    const e = inicial();
    recusou(rodar(e, { tipo: "salvarModoVoz", modo: "sempre" }, IDS.marina).resultado, "sem_permissao");
    const r = rodar(e, { tipo: "salvarModoVoz", modo: "sempre" });
    expect(r.estado.configuracao).toMatchObject({ voz_resposta: "sempre", atualizado_em: DEPOIS });
    expect(r.estado.auditoria.at(-1)).toMatchObject({ acao: "voz_alterada", detalhe: { modo: "sempre", modo_anterior: "quando_audio" } });
    recusou(rodar(e, { tipo: "salvarModoVoz", modo: "talvez" as "sempre" }).resultado, "nao_encontrado");
    const igual = rodar(r.estado, { tipo: "salvarModoVoz", modo: "sempre" });
    expect(igual.resultado).toEqual({ ok: true });
    expect(igual.estado.auditoria).toHaveLength(r.estado.auditoria.length);
  });
});

describe("reducer: simulações", () => {
  it("o lead escreve: mensagem de entrada, mais uma não lida e a última do lead", () => {
    const e = inicial();
    const r = rodar(e, { tipo: "simularJanete", evento: { tipo: "lead_mensagem", conversaId: idConversa("fernando"), mensagem: { tipo: "texto", texto: "Mais para oficina." } } });
    expect(cv(r.estado, "fernando")).toMatchObject({ nao_lidas: 1, ultima_do_lead_em: DEPOIS, ultima_mensagem_preview: "Mais para oficina." });
  });

  it("a Janete responde só nas conversas dela", () => {
    const e = inicial();
    const ok = rodar(e, { tipo: "simularJanete", evento: { tipo: "janete_responde", conversaId: idConversa("fernando"), texto: "Perfeito." } });
    expect(ok.resultado.ok).toBe(true);
    expect(ok.estado.digitando).not.toContain(idConversa("fernando"));
    const negado = rodar(e, { tipo: "simularJanete", evento: { tipo: "janete_responde", conversaId: idConversa("patricia"), texto: "Oi" } });
    recusou(negado.resultado, "sem_permissao");
    expect(negado.estado).toBe(e);
  });

  it("a Janete passa para a equipe: aguardando desde agora, com o motivo e o evento", () => {
    const r = rodar(inicial(), { tipo: "simularJanete", evento: { tipo: "janete_passa", conversaId: idConversa("aline"), motivo: "audio_sem_transcricao" } });
    expect(cv(r.estado, "aline")).toMatchObject({ modo: "humano", motivo_humano: "audio_sem_transcricao", aguardando_humano_desde: DEPOIS, responsavel_id: null });
    expect(seloDaConversa(cv(r.estado, "aline"))).toBe("falha");
    expect(r.estado.eventos[r.estado.eventos.length - 1]).toMatchObject({ tipo: "passou", motivo: "audio_sem_transcricao" });
  });

  it("o celular da empresa responde: a Janete sai, sem responsável", () => {
    const r = rodar(inicial(), { tipo: "simularJanete", evento: { tipo: "celular_responde", conversaId: idConversa("aline"), texto: "Oi, Aline" } });
    expect(cv(r.estado, "aline")).toMatchObject({ modo: "humano", motivo_humano: "humano_celular", responsavel_id: null });
    expect(seloDaConversa(cv(r.estado, "aline"))).toBe("celular");
  });

  it("a Janete passou e o celular respondeu: o selo é 'celular' e ninguém mais espera (regra do banco)", () => {
    const e = inicial();
    expect(seloDaConversa(cv(e, "ricardo"))).toBe("aguardando");
    const r = rodar(e, { tipo: "simularJanete", evento: { tipo: "celular_responde", conversaId: idConversa("ricardo"), texto: "Oi, Ricardo" } });
    const c = cv(r.estado, "ricardo");
    expect(c).toMatchObject({ motivo_humano: "janete_passou", aguardando_humano_desde: null, responsavel_id: null });
    expect(seloDaConversa(c)).toBe("celular");
    expect(estaAguardando(c)).toBe(false);
    // quem assume depois vem do celular
    const a = rodar(r.estado, { tipo: "assumir", conversaId: c.id });
    expect(a.estado.eventos[a.estado.eventos.length - 1]).toMatchObject({ tipo: "assumiu", de: "celular" });
  });

  it("'ativa agora': a Janete falou nos últimos 5 minutos ou está digitando", () => {
    const e = inicial();
    expect(janeteAtivaAgora(e, idConversa("fernando"), AGORA)).toBe(true); // digitando
    expect(janeteAtivaAgora(e, idConversa("aline"), AGORA)).toBe(true); // falou às 14:43
    expect(janeteAtivaAgora(e, idConversa("vinicius"), AGORA)).toBe(false);
    // logo depois de assumir, deixa de ser da Janete
    const a = rodar(e, { tipo: "assumir", conversaId: idConversa("aline") }).estado;
    expect(janeteAtivaAgora(a, idConversa("aline"), AGORA)).toBe(false);
    // o lead que acabou de escrever para a Janete também conta; Ganho e Perdido, não
    const aberta = new Set(e.etapas.filter((x) => x.tipo === "aberta").map((x) => x.id));
    const quieta = e.conversas.find(
      (c) => c.modo === "janete" && aberta.has(e.contatos.find((x) => x.id === c.contato_id)!.etapa_id) && !janeteAtivaAgora(e, c.id, AGORA),
    )!;
    const lead = rodar(e, { tipo: "simularJanete", evento: { tipo: "lead_mensagem", conversaId: quieta.id, mensagem: { tipo: "texto", texto: "Oi" } } }, IDS.voce, ISO).estado;
    expect(janeteAtivaAgora(lead, quieta.id, AGORA)).toBe(true);
    const ganho = rodar(e, { tipo: "moverEtapa", contatoId: idContato("aline"), etapaId: IDS.etapa.ganho, ator: "membro" }).estado;
    expect(janeteAtivaAgora(ganho, idConversa("aline"), AGORA)).toBe(false);
    // mensagem da Janete que falhou ou foi cancelada não conta
    const falhou = { ...e, mensagens: e.mensagens.map((m) => (m.conversa_id === idConversa("aline") && m.origem === "janete" ? { ...m, status: "falhou" as const } : m)) };
    const semLead = { ...falhou, mensagens: falhou.mensagens.filter((m) => !(m.conversa_id === idConversa("aline") && m.origem === "lead")) };
    expect(janeteAtivaAgora(semLead, idConversa("aline"), AGORA)).toBe(false);
  });

  it("esfriando: 3 níveis a cada 24 h; quem espera a equipe não esfria", () => {
    const e = inicial();
    const fria = e.conversas.find((c) => estaEsfriando(e, c, AGORA))!;
    const lead = new Date(fria.ultima_do_lead_em!).getTime();
    const em = (h: number) => new Date(lead + h * 3_600_000);
    expect(nivelFrio(e, fria, em(23.9))).toBe(0);
    expect(nivelFrio(e, fria, em(24))).toBe(1);
    expect(nivelFrio(e, fria, em(48))).toBe(2);
    expect(nivelFrio(e, fria, em(72))).toBe(3);
    expect(nivelFrio(e, fria, em(500))).toBe(3);
    const esperando = { ...fria, modo: "humano" as const, responsavel_id: null, motivo_humano: "janete_passou" as const, aguardando_humano_desde: fria.ultima_do_lead_em };
    expect(nivelFrio(e, esperando, em(72))).toBe(0);
    expect(estaEsfriando(e, esperando, em(72))).toBe(false);
  });
});

/* ---------- provedor ---------- */

function Sonda() {
  const { estado, acoes } = useExemplo();
  const { setPapel } = usePapel();
  const aline = estado.conversas.find((c) => c.id === idConversa("aline"));
  const ultima = estado.mensagens[estado.mensagens.length - 1];
  return (
    <div>
      <p data-testid="eu">{estado.eu.nome}</p>
      <p data-testid="nome-admin">{nomeDoMembro(estado, IDS.voce)}</p>
      <p data-testid="aline">{aline ? `${aline.modo}:${aline.responsavel_id ?? "-"}` : "apagada"}</p>
      <p data-testid="ultima">{ultima ? `${ultima.texto}:${ultima.status}` : ""}</p>
      <button type="button" onClick={() => setPapel("atendente")}>
        virar atendente
      </button>
      <button type="button" onClick={() => setPapel("admin")}>
        virar admin
      </button>
      <p data-testid="simulacao">{estado.simulacaoPausada ? "pausada" : "rodando"}</p>
      {acoes.alternarSimulacao ? (
        <button type="button" onClick={acoes.alternarSimulacao}>
          alternar simulação
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          const r = acoes.apagarContato(idContato("aline"));
          document.body.dataset["resultado"] = r.ok ? "ok" : r.erro;
        }}
      >
        apagar
      </button>
      <button type="button" onClick={() => acoes.enviarMensagem(idConversa("aline"), { tipo: "texto", texto: "Olá" })}>
        enviar
      </button>
      <button type="button" onClick={() => acoes.recomecar()}>
        recomeçar
      </button>
    </div>
  );
}

function montarSonda(papel: "admin" | "atendente" = "admin") {
  render(
    <ProvedorPapel inicial={papel}>
      <ProvedorExemplo relogio={() => AGORA}>
        <Sonda />
      </ProvedorExemplo>
    </ProvedorPapel>,
  );
}

describe("ProvedorExemplo e o papel", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete document.body.dataset["resultado"];
  });

  it("o eu segue o papel: admin é 'Você'; como atendente é a Marina, e o admin vira 'Admin'", () => {
    montarSonda();
    expect(screen.getByTestId("eu")).toHaveTextContent("Admin");
    expect(screen.getByTestId("nome-admin")).toHaveTextContent("Você");
    fireEvent.click(screen.getByRole("button", { name: "virar atendente" }));
    expect(screen.getByTestId("eu")).toHaveTextContent("Marina");
    expect(screen.getByTestId("nome-admin")).toHaveTextContent("Admin");
  });

  it("sem o provedor do papel, o exemplo fica como admin ('Você')", () => {
    render(
      <ProvedorExemplo relogio={() => AGORA}>
        <Sonda />
      </ProvedorExemplo>,
    );
    expect(screen.getByTestId("nome-admin")).toHaveTextContent("Você");
    // sem provedor, trocar o papel não faz nada
    fireEvent.click(screen.getByRole("button", { name: "virar atendente" }));
    expect(screen.getByTestId("nome-admin")).toHaveTextContent("Você");
  });

  it("a simulação (o Kanban usa; o botão do topo saiu em 30/10): começa rodando, alterna no provedor e não se perde ao trocar o papel", () => {
    montarSonda();
    expect(screen.getByTestId("simulacao")).toHaveTextContent("rodando");
    fireEvent.click(screen.getByRole("button", { name: "alternar simulação" }));
    expect(screen.getByTestId("simulacao")).toHaveTextContent("pausada");
    fireEvent.click(screen.getByRole("button", { name: "virar atendente" }));
    expect(screen.getByTestId("simulacao")).toHaveTextContent("pausada");
    fireEvent.click(screen.getByRole("button", { name: "alternar simulação" }));
    expect(screen.getByTestId("simulacao")).toHaveTextContent("rodando");
  });

  it("a ação devolve o resultado na hora: a atendente não apaga; o admin apaga", () => {
    montarSonda("atendente");
    fireEvent.click(screen.getByRole("button", { name: "apagar" }));
    expect(document.body.dataset["resultado"]).toBe("sem_permissao");
    expect(screen.getByTestId("aline")).toHaveTextContent("janete:-");

    fireEvent.click(screen.getByRole("button", { name: "virar admin" }));
    fireEvent.click(screen.getByRole("button", { name: "apagar" }));
    expect(document.body.dataset["resultado"]).toBe("ok");
    expect(screen.getByTestId("aline")).toHaveTextContent("apagada");
  });

  it("a mensagem enviada assume a conversa e anda sozinha até 'lida'; recomeçar volta ao começo", async () => {
    vi.useFakeTimers();
    montarSonda("atendente");
    fireEvent.click(screen.getByRole("button", { name: "enviar" }));
    expect(screen.getByTestId("aline")).toHaveTextContent(`humano:${IDS.marina}`);
    expect(screen.getByTestId("ultima")).toHaveTextContent("Olá:na_fila");
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(screen.getByTestId("ultima")).toHaveTextContent("Olá:enviando");
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByTestId("ultima")).toHaveTextContent("Olá:entregue");
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(screen.getByTestId("ultima")).toHaveTextContent("Olá:lida");

    fireEvent.click(screen.getByRole("button", { name: "recomeçar" }));
    expect(screen.getByTestId("aline")).toHaveTextContent("janete:-");
  });

  it("a atendente não recebe as chaves de IA, os custos nem a auditoria (como as policies do banco)", () => {
    function Listas() {
      const { estado } = useExemplo();
      return <p data-testid="listas">{`${estado.chaves.length}:${estado.custos.length}:${estado.auditoria.length}`}</p>;
    }
    const base = criarEstadoInicial(AGORA);
    const comAuditoria = rodar(base, { tipo: "trocarConexao", nova: null }).estado;
    const tela = (papel: "admin" | "atendente") => (
      <ProvedorPapel inicial={papel}>
        <ProvedorExemplo inicial={comAuditoria} relogio={() => AGORA}>
          <Listas />
        </ProvedorExemplo>
      </ProvedorPapel>
    );
    render(tela("atendente"));
    expect(screen.getByTestId("listas")).toHaveTextContent("0:0:0");
    cleanup();
    render(tela("admin"));
    const [chaves, custos, auditoria] = screen.getByTestId("listas").textContent!.split(":").map(Number);
    expect(chaves).toBeGreaterThan(0);
    expect(custos).toBeGreaterThan(0);
    expect(auditoria).toBe(1);
  });

  it("'Tentar de novo' no meio do envio: os passos do envio anterior deixam de valer", async () => {
    vi.useFakeTimers();
    const ref: { acoes: ReturnType<typeof useExemplo>["acoes"] | null; id: string } = { acoes: null, id: "" };
    function Envio() {
      const { estado, acoes } = useExemplo();
      ref.acoes = acoes;
      const m = estado.mensagens.find((x) => x.id === ref.id);
      return <p data-testid="status">{m?.status ?? ""}</p>;
    }
    render(
      <ProvedorPapel>
        <ProvedorExemplo relogio={() => AGORA}>
          <Envio />
        </ProvedorExemplo>
      </ProvedorPapel>,
    );
    act(() => {
      const r = ref.acoes!.enviarMensagem(idConversa("aline"), { tipo: "texto", texto: "Olá" });
      ref.id = r.ok ? r.id! : "";
    });
    await act(() => vi.advanceTimersByTimeAsync(1100)); // enviada
    expect(screen.getByTestId("status")).toHaveTextContent("enviada");
    act(() => {
      ref.acoes!.simularJanete({ tipo: "status_mensagem", mensagemId: ref.id, status: "falhou", erro: "Caiu" });
      ref.acoes!.tentarDeNovo(ref.id);
    });
    expect(screen.getByTestId("status")).toHaveTextContent("na_fila");
    // o passo "entregue" do 1º envio (em 1900 ms) não vale mais: fica "enviando", do 2º
    await act(() => vi.advanceTimersByTimeAsync(850));
    expect(screen.getByTestId("status")).toHaveTextContent("enviando");
    await act(() => vi.advanceTimersByTimeAsync(5200));
    expect(screen.getByTestId("status")).toHaveTextContent("lida");
  });

  it("useExemplo fora do provedor avisa o que falta", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Sonda />)).toThrow(/ProvedorExemplo/);
    erro.mockRestore();
  });
});

it("o exemplo é o mesmo em qualquer hora: o momento inicial não depende do relógio da máquina", () => {
  const a = criarEstadoInicial(AGORA);
  const b = criarEstadoInicial(AGORA);
  expect(a).toEqual(b);
  expect(ISO).toBe("2026-10-30T17:45:00.000Z");
});

// O selo "Exemplo" saiu de todas as telas em 30/10 (primeiro do topo, depois do Chat): o papel.tsx
// ficou só com o provedor e o usePapel, sem CSS próprio.
it("papel.tsx exporta só o provedor e o usePapel", async () => {
  const modulo = await import("@/features/plataforma/papel");
  expect(Object.keys(modulo).sort()).toEqual(["ProvedorPapel", "usePapel"]);
});
