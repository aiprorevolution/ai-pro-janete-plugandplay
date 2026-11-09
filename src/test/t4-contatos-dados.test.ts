import { describe, expect, it } from "vitest";

import {
  FILTROS_INICIAIS,
  acontecimentos,
  contadores,
  fatosDoContato,
  linhasDaTabela,
  midiasDoContato,
  normalizarBusca,
  proximoPassoDoContato,
  quemAtende,
  ultimosAcontecimentos,
} from "@/features/plataforma/contatos/dados";
import type { ColunaOrdem, FiltrosTabela, LinhaTabela } from "@/features/plataforma/contatos/tipos";
import {
  IDS,
  conversaDoContato,
  criarEstadoInicial,
  estaAguardando,
  idContato,
  idConversa,
  type Contato,
  type Conversa,
  type EstadoExemplo,
  type EventoPassagem,
  type Mensagem,
} from "@/features/plataforma/exemplo";

// A fundação de Contatos (F1 da docs/spec-contatos.md): as leituras puras da tabela e do perfil.
// O "agora" é sempre fixo, para o dia de São Paulo não depender da hora em que o teste roda.

// Uma sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC): o "agora" dos protótipos.
const AGORA = new Date("2026-10-30T17:45:00.000Z");

function estadoDoExemplo(eu: string = IDS.voce, agora: Date = AGORA): EstadoExemplo {
  const base = criarEstadoInicial(agora);
  return { ...base, eu: base.membros.find((m) => m.id === eu)! };
}

const filtros = (mudar: Partial<FiltrosTabela> = {}): FiltrosTabela => ({ ...FILTROS_INICIAIS, ...mudar });
const ids = (linhas: readonly LinhaTabela[]) => linhas.map((l) => l.contatoId);

/* ---------- um estado montado à mão ---------- */

function contato(id: string, mudar: Partial<Contato> = {}): Contato {
  return {
    id,
    nome: id,
    nome_whatsapp: null,
    telefone: null,
    email: null,
    empresa: null,
    etapa_id: IDS.etapa.novo,
    etapa_desde: "2026-10-01T12:00:00.000Z",
    observacoes: null,
    resumo_janete: null,
    primeira_mensagem_em: "2026-10-01T12:00:00.000Z",
    criado_em: "2026-10-01T12:00:00.000Z",
    atualizado_em: "2026-10-01T12:00:00.000Z",
    ...mudar,
  };
}

function conversa(contatoId: string, mudar: Partial<Conversa> = {}): Conversa {
  return {
    id: `cv-${contatoId}`,
    contato_id: contatoId,
    conexao_id: IDS.conexao,
    modo: "janete",
    motivo_humano: null,
    responsavel_id: null,
    aguardando_humano_desde: null,
    devolvida_em: null,
    nao_lidas: 0,
    ultima_do_lead_em: null,
    ultima_mensagem_em: null,
    ultima_mensagem_preview: null,
    criado_em: "2026-10-01T12:00:00.000Z",
    atualizado_em: "2026-10-01T12:00:00.000Z",
    ...mudar,
  };
}

function estadoComContatos(contatos: Contato[], conversas: Conversa[], agora: Date = AGORA): EstadoExemplo {
  const base = estadoDoExemplo(IDS.voce, agora);
  return { ...base, contatos, conversas, mensagens: [], historico: [], eventos: [], digitando: [] };
}

/* ---------- normalizarBusca ---------- */

describe("normalizarBusca", () => {
  it("tira acento, maiúscula e junta os espaços", () => {
    expect(normalizarBusca("  Clínica   VALE  Verde ")).toBe("clinica vale verde");
    expect(normalizarBusca("Ótica Ponto Focal")).toBe("otica ponto focal");
    expect(normalizarBusca("")).toBe("");
  });
});

/* ---------- novos hoje e a virada do dia ---------- */

describe("virada do dia em São Paulo", () => {
  // 00:30 de 30/10 em São Paulo (03:30 UTC). A 1ª mensagem das 23:59 de 29/10 é de ontem; a das
  // 00:01 de 30/10 é de hoje, mesmo as duas sendo de 30/10 em UTC.
  const meiaNoite = new Date("2026-10-30T00:30:00-03:00");
  const ontem = contato("ct-ontem", { primeira_mensagem_em: "2026-10-29T23:59:00-03:00", criado_em: "2026-10-29T23:59:00-03:00" });
  const hoje = contato("ct-hoje", { primeira_mensagem_em: "2026-10-30T00:01:00-03:00", criado_em: "2026-10-30T00:01:00-03:00" });
  const estado = estadoComContatos([ontem, hoje], [conversa("ct-ontem"), conversa("ct-hoje")], meiaNoite);

  it("'Novos hoje' conta só a das 00:01", () => {
    expect(contadores(estado, meiaNoite).novos_hoje).toBe(1);
    expect(ids(linhasDaTabela(estado, filtros({ recorte: "novos_hoje" }), meiaNoite))).toEqual(["ct-hoje"]);
  });

  it("'Entrou em' hoje, 7 e 30 dias seguem o dia de São Paulo", () => {
    expect(ids(linhasDaTabela(estado, filtros({ entrada: "hoje" }), meiaNoite))).toEqual(["ct-hoje"]);
    expect(ids(linhasDaTabela(estado, filtros({ entrada: "7" }), meiaNoite)).sort()).toEqual(["ct-hoje", "ct-ontem"]);
  });

  it("'7' vai de 6 dias atrás até hoje; '30', de 29 dias atrás", () => {
    const seis = contato("ct-6", { primeira_mensagem_em: "2026-10-24T00:05:00-03:00" });
    const sete = contato("ct-7", { primeira_mensagem_em: "2026-10-23T23:55:00-03:00" });
    const vinteNove = contato("ct-29", { primeira_mensagem_em: "2026-10-01T00:05:00-03:00" });
    const trinta = contato("ct-30", { primeira_mensagem_em: "2026-09-30T23:55:00-03:00" });
    const e = estadoComContatos([seis, sete, vinteNove, trinta], [], meiaNoite);
    expect(ids(linhasDaTabela(e, filtros({ entrada: "7" }), meiaNoite))).toEqual(["ct-6"]);
    expect(ids(linhasDaTabela(e, filtros({ entrada: "30" }), meiaNoite)).sort()).toEqual(["ct-29", "ct-6", "ct-7"]);
    expect(linhasDaTabela(e, filtros({ entrada: "qualquer" }), meiaNoite)).toHaveLength(4);
  });

  it("sem primeira_mensagem_em, a entrada é o criado_em", () => {
    const semMsg = contato("ct-sem", { primeira_mensagem_em: null, criado_em: "2026-10-30T00:10:00-03:00" });
    const e = estadoComContatos([semMsg], [], meiaNoite);
    const [linha] = linhasDaTabela(e, filtros({ entrada: "hoje" }), meiaNoite);
    expect(linha?.entrouEm).toBe("2026-10-30T00:10:00-03:00");
    // 'Novos hoje' é só pela 1ª mensagem: sem ela, não conta
    expect(contadores(e, meiaNoite).novos_hoje).toBe(0);
  });
});

/* ---------- a busca ---------- */

describe("busca", () => {
  const estado = estadoDoExemplo();
  const buscar = (busca: string) => ids(linhasDaTabela(estado, filtros({ busca }), AGORA));

  it("acha pelo telefone com e sem máscara", () => {
    expect(buscar("90000-0007")).toEqual([idContato("marcos")]);
    expect(buscar("(11) 90000-0007")).toEqual([idContato("marcos")]);
    expect(buscar("5511900000007")).toEqual([idContato("marcos")]);
    expect(buscar("900000007")).toEqual([idContato("marcos")]);
  });

  it("com menos de 4 dígitos, não compara com o telefone", () => {
    // "007" não está em nenhum nome, empresa ou e-mail; no telefone, estaria no do Marcos
    expect(buscar("007")).toEqual([]);
  });

  it("acha pela empresa sem acento e sem diferenciar maiúscula", () => {
    expect(buscar("clinica")).toContain(idContato("juliana"));
    expect(buscar("CLÍNICA   vale")).toEqual([idContato("juliana")]);
    expect(buscar("otica")).toEqual([idContato("beatriz")]);
  });

  it("acha pelo nome, pelo nome no WhatsApp e pelo e-mail", () => {
    expect(buscar("patricia nog")).toEqual([idContato("patricia")]);
    expect(buscar("cadu")).toEqual([idContato("carlos")]);
    expect(buscar("valeverde.exemplo")).toEqual([idContato("juliana")]);
  });

  it("busca vazia ou só espaços mostra todos", () => {
    expect(buscar("   ")).toHaveLength(estado.contatos.length);
  });

  it("combina com as etapas escolhidas", () => {
    const linhas = linhasDaTabela(estado, filtros({ etapaIds: [IDS.etapa.ganho, IDS.etapa.perdido] }), AGORA);
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((l) => l.etapa.id === IDS.etapa.ganho || l.etapa.id === IDS.etapa.perdido)).toBe(true);
    expect(ids(linhasDaTabela(estado, filtros({ etapaIds: [IDS.etapa.ganho], busca: "otica" }), AGORA))).toEqual([
      idContato("beatriz"),
    ]);
  });
});

/* ---------- os contadores ---------- */

describe("contadores", () => {
  for (const eu of [IDS.voce, IDS.marina]) {
    it(`batem com estaAguardando, modo e responsavel_id (vendo como ${eu})`, () => {
      const estado = estadoDoExemplo(eu);
      const c = contadores(estado, AGORA);
      expect(c.todos).toBe(estado.contatos.length);
      expect(c.precisam).toBe(estado.conversas.filter(estaAguardando).length);
      expect(c.com_janete).toBe(estado.conversas.filter((x) => x.modo === "janete").length);
      expect(c.comigo).toBe(estado.conversas.filter((x) => x.modo === "humano" && x.responsavel_id === eu).length);
      expect(c.precisam).toBeGreaterThan(0);
      expect(c.comigo).toBeGreaterThan(0);

      // o número da aba é o total de linhas que ela mostra
      for (const recorte of ["todos", "precisam", "novos_hoje", "com_janete", "comigo"] as const) {
        expect(linhasDaTabela(estado, filtros({ recorte }), AGORA)).toHaveLength(c[recorte]);
      }
    });
  }

  it("'Precisam de você' inclui a falha (Juliana, sem crédito) e a Janete que pediu ajuda (Ricardo)", () => {
    const estado = estadoDoExemplo();
    const precisam = ids(linhasDaTabela(estado, filtros({ recorte: "precisam" }), AGORA));
    expect(precisam).toContain(idContato("juliana"));
    expect(precisam).toContain(idContato("ricardo"));
    // a Patrícia está com a Marina, o Carlos com o celular: ninguém espera
    expect(precisam).not.toContain(idContato("patricia"));
    expect(precisam).not.toContain(idContato("carlos"));
  });

  it("'Comigo' muda com quem olha", () => {
    expect(ids(linhasDaTabela(estadoDoExemplo(IDS.marina), filtros({ recorte: "comigo" }), AGORA))).toContain(
      idContato("patricia"),
    );
    expect(ids(linhasDaTabela(estadoDoExemplo(IDS.voce), filtros({ recorte: "comigo" }), AGORA))).not.toContain(
      idContato("patricia"),
    );
  });
});

/* ---------- quem atende ---------- */

describe("quemAtende", () => {
  const estado = estadoDoExemplo();
  const de = (lead: string, e: EstadoExemplo = estado) => quemAtende(e, conversaDoContato(e, idContato(lead)), AGORA);

  it("os 5 casos", () => {
    expect(de("juliana")).toMatchObject({ tipo: "falha", nome: "Esperando a equipe", aoVivo: false });
    expect(de("juliana").esperaDesde).not.toBeNull();
    expect(de("ricardo")).toMatchObject({ tipo: "aguardando", nome: "Esperando a equipe" });
    expect(de("patricia")).toMatchObject({ tipo: "membro", nome: "Marina", membroId: IDS.marina });
    expect(de("patricia", estadoDoExemplo(IDS.marina))).toMatchObject({ tipo: "membro", nome: "Você" });
    expect(de("carlos")).toMatchObject({ tipo: "celular", nome: "Celular da empresa", membroId: null });
    // o Fernando: a Janete está digitando agora
    expect(de("fernando")).toMatchObject({ tipo: "janete", nome: "A Janete", aoVivo: true });
    // o Marcos está em Perdido: a Janete não está ao vivo
    expect(de("marcos")).toMatchObject({ tipo: "janete", aoVivo: false });
  });

  it("sem conversa: a Janete, sem ao vivo", () => {
    expect(quemAtende(estado, undefined, AGORA)).toEqual({
      tipo: "janete",
      nome: "A Janete",
      membroId: null,
      esperaDesde: null,
      aoVivo: false,
    });
  });

  it("aceita o agora em milissegundos", () => {
    const c = conversaDoContato(estado, idContato("fernando"));
    expect(quemAtende(estado, c, AGORA.getTime()).aoVivo).toBe(true);
  });
});

/* ---------- a ordem ---------- */

describe("ordem da tabela", () => {
  const colador = new Intl.Collator("pt-BR", { sensitivity: "base" });
  const estadoBase = estadoDoExemplo();
  // um contato sem conversa (sem última mensagem), para conferir que a data nula vai para o fim
  const semConversa = contato("ct-zz-sem-conversa", { nome: "Ágata Sem Conversa" });
  const estado: EstadoExemplo = { ...estadoBase, contatos: [...estadoBase.contatos, semConversa] };
  const ordenar = (coluna: ColunaOrdem, direcao: "asc" | "desc") =>
    linhasDaTabela(estado, filtros({ ordem: { coluna, direcao } }), AGORA);

  it("o padrão é a última mensagem, a mais nova primeiro", () => {
    expect(FILTROS_INICIAIS.ordem).toEqual({ coluna: "ultima", direcao: "desc" });
    expect(FILTROS_INICIAIS).toEqual({
      busca: "",
      recorte: "todos",
      etapaIds: [],
      entrada: "qualquer",
      ordem: { coluna: "ultima", direcao: "desc" },
    });
  });

  it("contato: de A a Z sem diferenciar acento, e de Z a A", () => {
    const asc = ordenar("contato", "asc").map((l) => l.nome);
    const desc = ordenar("contato", "desc").map((l) => l.nome);
    expect(asc).toEqual([...asc].sort(colador.compare));
    // "Ágata" vem junto dos "A", não depois do Z
    expect(asc.indexOf("Ágata Sem Conversa")).toBeLessThan(asc.indexOf("Beatriz Santana"));
    expect(desc).toEqual([...asc].reverse());
  });

  it("etapa: pela ordem do funil, nos dois sentidos", () => {
    const asc = ordenar("etapa", "asc").map((l) => l.etapa.ordem);
    const desc = ordenar("etapa", "desc").map((l) => l.etapa.ordem);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    expect(asc[0]).toBe(10);
    expect(desc[0]).toBe(60);
  });

  it("etapa empatada: desempate pelo nome, de A a Z, nos dois sentidos", () => {
    for (const direcao of ["asc", "desc"] as const) {
      const linhas = ordenar("etapa", direcao);
      const novos = linhas.filter((l) => l.etapa.ordem === 10).map((l) => l.nome);
      expect(novos).toEqual([...novos].sort(colador.compare));
    }
  });

  for (const [coluna, campo] of [
    ["ultima", "ultimaMensagemEm"],
    ["entrada", "entrouEm"],
  ] as const) {
    it(`${coluna}: da mais antiga à mais nova e o contrário, com a nula no fim`, () => {
      const tempos = (d: "asc" | "desc") => ordenar(coluna, d).map((l) => (l[campo] ? Date.parse(l[campo]) : null));
      const asc = tempos("asc");
      const desc = tempos("desc");
      const datas = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
      expect(datas(asc)).toEqual([...datas(asc)].sort((a, b) => a - b));
      expect(datas(desc)).toEqual([...datas(desc)].sort((a, b) => b - a));
      if (coluna === "ultima") {
        expect(asc[asc.length - 1]).toBeNull();
        expect(desc[desc.length - 1]).toBeNull();
        expect(ordenar(coluna, "asc").at(-1)?.contatoId).toBe("ct-zz-sem-conversa");
      }
    });
  }

  it("a mais nova primeiro: Aline (14:44) abre a tabela", () => {
    expect(ordenar("ultima", "desc")[0]?.contatoId).toBe(idContato("aline"));
  });

  it("empate total: desempate pelo nome e depois pelo id", () => {
    const a = contato("ct-b", { nome: "Mesmo Nome" });
    const b = contato("ct-a", { nome: "Mesmo Nome" });
    const c = contato("ct-c", { nome: "Antes" });
    const e = estadoComContatos([a, b, c], []);
    for (const direcao of ["asc", "desc"] as const) {
      expect(ids(linhasDaTabela(e, filtros({ ordem: { coluna: "entrada", direcao } }), AGORA))).toEqual([
        "ct-c",
        "ct-a",
        "ct-b",
      ]);
    }
  });
});

/* ---------- a linha da tabela ---------- */

describe("linha da tabela", () => {
  it("traz o nome, a empresa, a etapa, quem atende e as datas", () => {
    const estado = estadoDoExemplo();
    const juliana = linhasDaTabela(estado, filtros(), AGORA).find((l) => l.contatoId === idContato("juliana"))!;
    expect(juliana).toMatchObject({
      conversaId: idConversa("juliana"),
      nome: "Juliana Prado",
      empresa: "Clínica Vale Verde",
      etapa: { id: IDS.etapa.em_qualificacao, nome: "Em qualificação", ordem: 20, tipo: "aberta" },
      quem: { tipo: "falha" },
    });
    const ct = estado.contatos.find((c) => c.id === idContato("juliana"))!;
    expect(juliana.entrouEm).toBe(ct.primeira_mensagem_em);
    expect(juliana.ultimaMensagemEm).toBe(conversaDoContato(estado, ct.id)!.ultima_mensagem_em);
  });

  it("sem conversa: conversaId nulo e última mensagem nula", () => {
    const e = estadoComContatos([contato("ct-x")], []);
    expect(linhasDaTabela(e, filtros(), AGORA)[0]).toMatchObject({ conversaId: null, ultimaMensagemEm: null });
  });
});

/* ---------- a linha do tempo ---------- */

describe("acontecimentos", () => {
  const estado = estadoDoExemplo();

  it("Juliana: criado, 1ª mensagem, a Janete move e a Janete para por falta de crédito", () => {
    const lista = acontecimentos(estado, idContato("juliana"));
    expect(lista.map((a) => [a.tipo, a.grupo])).toEqual([
      ["criado", "etapas"],
      ["primeira_mensagem", "mensagens"],
      ["etapa", "etapas"],
      ["passou", "atendimento"],
    ]);
    const [criado, primeira, etapa, passou] = lista;
    expect(criado).toMatchObject({ titulo: "Contato criado em Novo", quem: { tipo: "sistema" }, etapaId: IDS.etapa.novo });
    expect(primeira).toMatchObject({
      titulo: "1ª mensagem de Juliana",
      descricao: "Olá. Queria saber o valor do plano para clínica com duas salas.",
      quem: { tipo: "lead", nome: "Juliana" },
      mensagemId: "msg-juliana-1",
    });
    expect(etapa).toMatchObject({
      titulo: "A Janete moveu para Em qualificação",
      descricao: "De Novo para Em qualificação",
      quem: { tipo: "janete" },
      etapaId: IDS.etapa.em_qualificacao,
    });
    expect(passou?.quem.tipo).toBe("janete");
    expect(passou?.descricao).toContain("Acabou o crédito da chave de IA");
    expect(passou?.etapaId).toBe(IDS.etapa.em_qualificacao);
    // do mais antigo ao mais novo
    const tempos = lista.map((a) => Date.parse(a.em));
    expect(tempos).toEqual([...tempos].sort((a, b) => a - b));
  });

  it("Ricardo: as mídias entram na hora certa, com o autor e a etapa daquele momento", () => {
    const lista = acontecimentos(estado, idContato("ricardo"));
    expect(lista.map((a) => a.tipo)).toEqual([
      "criado",
      "primeira_mensagem",
      "etapa", // Em qualificação, 18:03
      "midia", // áudio, 18:05
      "midia", // foto da fachada, 18:09
      "etapa", // Qualificado, 18:11
      "midia", // PDF da Janete, 18:12
      "passou", // hoje, 14:32
    ]);
    const midias = lista.filter((a) => a.tipo === "midia");
    expect(midias.map((m) => m.titulo)).toEqual([
      "Ricardo mandou um áudio",
      "Ricardo mandou uma imagem",
      "A Janete mandou um documento",
    ]);
    expect(midias[0]?.descricao).toContain("É um prédio só, de três andares");
    expect(midias[0]?.etapaId).toBe(IDS.etapa.em_qualificacao);
    expect(midias[1]?.descricao).toBe("fachada-frente.jpg");
    expect(midias[2]).toMatchObject({ descricao: "obras-comerciais.pdf", quem: { tipo: "janete" }, etapaId: IDS.etapa.qualificado });
    expect(midias.every((m) => m.grupo === "mensagens" && !!m.mensagemId)).toBe(true);
    expect(lista.at(-1)).toMatchObject({ titulo: "A Janete passou para a equipe", descricao: "Motivo: a Janete decidiu passar." });
  });

  it("passagens: assumiu, devolveu e celular, com quem visto por quem olha", () => {
    // Os "assumiu" reais do exemplo: o da Beatriz (você, ontem às 10:02, vindo da Janete) e o da
    // Patrícia (Marina, ontem às 16:30, vindo da Janete). O caso "estava com outra pessoa" e
    // "respondeu pela tela" o exemplo não tem: esse vai num evento montado à mão.
    const base = estadoDoExemplo();
    const passagem: EventoPassagem = {
      id: "ev-t2",
      conversa_id: idConversa("patricia"),
      tipo: "assumiu",
      membro_id: IDS.marina,
      motivo: null,
      de: "outro",
      de_membro_id: IDS.voce,
      por_envio: true,
      criado_em: "2026-10-29T19:31:00.000Z",
    };
    const comoVoce: EstadoExemplo = { ...base, eventos: [...base.eventos, passagem] };
    const comoMarina: EstadoExemplo = { ...comoVoce, eu: base.membros.find((m) => m.id === IDS.marina)! };

    const patriciaReal = acontecimentos(base, idContato("patricia")).filter((a) => a.tipo === "assumiu");
    expect(patriciaReal).toHaveLength(1);
    expect(patriciaReal[0]).toMatchObject({
      id: "assumiu-ev-patricia-1",
      titulo: "Marina assumiu a conversa",
      descricao: "A Janete saiu da conversa.",
      quem: { tipo: "membro", nome: "Marina" },
      em: "2026-10-29T19:30:00.000Z",
    });
    expect(
      acontecimentos(estadoDoExemplo(IDS.marina), idContato("patricia")).find((a) => a.id === "assumiu-ev-patricia-1"),
    ).toMatchObject({ titulo: "Você assumiu a conversa" });

    const beatriz = acontecimentos(base, idContato("beatriz"));
    expect(beatriz.filter((a) => a.tipo === "assumiu")).toHaveLength(1);
    expect(beatriz.find((a) => a.tipo === "assumiu")).toMatchObject({
      id: "assumiu-ev-beatriz-1",
      titulo: "Você assumiu a conversa",
      descricao: "A Janete saiu da conversa.",
      grupo: "atendimento",
      quem: { tipo: "membro", nome: "Você" },
      etapaId: IDS.etapa.em_negociacao,
    });
    expect(beatriz.find((a) => a.tipo === "devolveu")).toMatchObject({
      titulo: "Você devolveu para a Janete",
      grupo: "atendimento",
      etapaId: IDS.etapa.ganho,
    });
    expect(beatriz.filter((a) => a.tipo === "etapa").at(-1)?.titulo).toBe("Você moveu para Ganho");

    expect(acontecimentos(comoVoce, idContato("patricia")).find((a) => a.id === "assumiu-ev-t2")).toMatchObject({
      titulo: "Marina assumiu a conversa",
      descricao: "Respondeu pela tela. A conversa estava com você.",
    });
    expect(acontecimentos(comoMarina, idContato("patricia")).find((a) => a.id === "assumiu-ev-t2")).toMatchObject({
      titulo: "Você assumiu a conversa",
      descricao: "Respondeu pela tela. A conversa estava com Admin.",
    });

    const carlos = acontecimentos(base, idContato("carlos"));
    expect(carlos.find((a) => a.tipo === "celular")).toMatchObject({
      titulo: "Respondida pelo celular da empresa",
      grupo: "atendimento",
      quem: { tipo: "celular", nome: "Celular da empresa" },
    });
  });

  it("a mensagem apagada não vira mídia nem 1ª mensagem", () => {
    const e = estadoDoExemplo();
    const cv = idConversa("juliana");
    const apagada: Mensagem = {
      ...e.mensagens.find((m) => m.id === "msg-juliana-1")!,
      id: "msg-apagada",
      tipo: "imagem",
      momento: "2026-10-30T17:00:00.000Z",
      midia_nome: "foto.jpg",
      apagada_em: "2026-10-30T17:01:00.000Z",
      conversa_id: cv,
    };
    const com = { ...e, mensagens: [...e.mensagens, apagada] };
    expect(acontecimentos(com, idContato("juliana")).some((a) => a.mensagemId === "msg-apagada")).toBe(false);
    expect(midiasDoContato(com, idContato("juliana"))).toEqual([]);
  });

  it("ids únicos e contato que não existe dá lista vazia", () => {
    for (const ct of estado.contatos) {
      const lista = acontecimentos(estado, ct.id);
      expect(new Set(lista.map((a) => a.id)).size).toBe(lista.length);
    }
    expect(acontecimentos(estado, "ct-nao-existe")).toEqual([]);
  });

  it("ultimosAcontecimentos: os 5 mais novos, do mais novo para o mais antigo", () => {
    const todos = acontecimentos(estado, idContato("ricardo"));
    const ultimos = ultimosAcontecimentos(estado, idContato("ricardo"));
    expect(ultimos).toHaveLength(5);
    expect(ultimos).toEqual(todos.slice(-5).reverse());
    expect(ultimosAcontecimentos(estado, idContato("juliana"), 2).map((a) => a.tipo)).toEqual(["passou", "etapa"]);
  });
});

/* ---------- as mídias ---------- */

describe("midiasDoContato", () => {
  const estado = estadoDoExemplo();

  it("Aline: vídeo, figurinha e áudio, da mais antiga à mais nova", () => {
    const lista = midiasDoContato(estado, idContato("aline"));
    expect(lista.map((m) => [m.tipo, m.nome, m.autor])).toEqual([
      ["video", "tour-da-loja.mp4", "Aline"],
      ["figurinha", "figurinha.webp", "Aline"],
      ["audio", "audio-aline.ogg", "Aline"],
    ]);
    expect(lista[0]?.duracaoS).toBe(18);
    expect(lista[2]?.transcricao).toBe("É mais ou menos isso aí, umas 60 por semana.");
    expect(lista[0]?.tamanho).toBeGreaterThan(0);
  });

  it("autor: Janete e o membro visto por quem olha", () => {
    expect(midiasDoContato(estado, idContato("ricardo")).map((m) => m.autor)).toEqual(["Ricardo", "Ricardo", "Janete"]);
    expect(midiasDoContato(estado, idContato("patricia")).map((m) => m.autor)).toEqual(["Patrícia", "Marina"]);
    expect(midiasDoContato(estadoDoExemplo(IDS.marina), idContato("patricia")).at(-1)?.autor).toBe("Você");
  });

  it("sem nome de arquivo: 'Áudio de m:ss', 'Imagem', 'Vídeo', 'Figurinha'", () => {
    const e = estadoDoExemplo();
    const semNome = e.mensagens.map((m) => (m.conversa_id === idConversa("aline") ? { ...m, midia_nome: null } : m));
    const lista = midiasDoContato({ ...e, mensagens: semNome }, idContato("aline"));
    expect(lista.map((m) => m.nome)).toEqual(["Vídeo", "Figurinha", "Áudio de 0:09"]);
  });

  it("contato sem conversa ou que não existe: lista vazia", () => {
    expect(midiasDoContato(estado, "ct-nao-existe")).toEqual([]);
  });
});

/* ---------- os extras que o banco ainda não guarda ---------- */

/** Um contato com extras de qualquer formato, para testar a leitura defensiva dos campos. */
function comExtrasBrutos(base: Contato, extras: Record<string, unknown>): Contato {
  return { ...base, ...extras } as unknown as Contato;
}

describe("fatos e próximo passo", () => {
  const base = contato("ct-extra");

  it("sem o extra: [] e null", () => {
    expect(fatosDoContato(base)).toEqual([]);
    expect(proximoPassoDoContato(base)).toBeNull();
    // A Ana Clara, que acabou de chegar, fica sem fatos e sem próximo passo antes e depois do patch
    // do exemplo (docs/spec-contatos.md, F3).
    const ana = estadoDoExemplo().contatos.find((c) => c.id === idContato("ana"))!;
    expect(fatosDoContato(ana)).toEqual([]);
    expect(proximoPassoDoContato(ana)).toBeNull();
  });

  it("com o extra: lê os fatos e o próximo passo", () => {
    const comExtra = {
      ...base,
      fatosJanete: [
        { rotulo: "Interesse", valor: "Plano para duas salas", mensagemId: "msg-juliana-1" },
        { rotulo: "Prazo", valor: "Ainda este mês" },
      ],
      proximoPasso: { titulo: "Marcar a demonstração", texto: "Ela pediu uma demonstração." },
    };
    expect(fatosDoContato(comExtra)).toEqual([
      { rotulo: "Interesse", valor: "Plano para duas salas", mensagemId: "msg-juliana-1" },
      { rotulo: "Prazo", valor: "Ainda este mês", mensagemId: null },
    ]);
    expect(proximoPassoDoContato(comExtra)).toEqual({ titulo: "Marcar a demonstração", texto: "Ela pediu uma demonstração." });
  });

  it("item com formato errado fica de fora, e o extra que não é lista nem objeto vira vazio", () => {
    // Dados de formato errado de propósito (como viriam de um jsonb torto): a conversão explícita
    // deixa o teste valer com ou sem os extras declarados no tipo Contato.
    const torto = comExtrasBrutos(base, {
      fatosJanete: [
        { rotulo: "Orçamento", valor: "R$ 2 mil" },
        { rotulo: "", valor: "vazio" },
        { rotulo: "Sem valor" },
        { rotulo: "Quem decide", valor: 3 },
        { rotulo: "Id errado", valor: "x", mensagemId: 7 },
        "texto solto",
        null,
      ],
      proximoPasso: { titulo: "Só título" },
    });
    expect(fatosDoContato(torto)).toEqual([{ rotulo: "Orçamento", valor: "R$ 2 mil", mensagemId: null }]);
    expect(proximoPassoDoContato(torto)).toBeNull();
    const naoLista = comExtrasBrutos(base, { fatosJanete: "não é lista", proximoPasso: ["lista"] });
    expect(fatosDoContato(naoLista)).toEqual([]);
    expect(proximoPassoDoContato(naoLista)).toBeNull();
  });
});
