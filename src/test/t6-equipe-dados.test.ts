import { describe, expect, it } from "vitest";

import {
  MAX_NO_CARTAO,
  TRAVA_PROPRIO,
  TRAVA_UNICO_ADMIN,
  cartoesDaEquipe,
  conversasDoMembro,
  erroDoConvite,
  filaDaEquipe,
  proximoTiqueDaFila,
  tempoNaFila,
  tempoNaFilaPorExtenso,
  type Cartao,
  type CartaoMembro,
} from "@/features/plataforma/equipe";
import {
  IDS,
  criarEstadoInicial,
  membroDoPapel,
  reduzir,
  type AcaoExemplo,
  type EstadoBase,
  type EstadoExemplo,
} from "@/features/plataforma/exemplo";
import type { PapelMembro } from "@/features/plataforma/exemplo";

// Task C1 da spec da Equipe (docs/spec-equipe.md): as leituras puras de equipe/dados.ts sobre o
// estado do exemplo. Os números esperados vêm do exemplo (conferidos), não de cálculo na hora.

// Sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");

/** O estado como o ProvedorExemplo monta: o admin vê os convites, o atendente não. */
function estadoDe(papel: PapelMembro): EstadoExemplo {
  const base = criarEstadoInicial(AGORA);
  const estado: EstadoExemplo = { ...base, eu: membroDoPapel(base.membros, papel) };
  return papel === "atendente" ? { ...estado, convites: [] } : estado;
}

/** O estado depois de uma ação feita por você (o admin). */
function depoisDe(estado: EstadoExemplo, acao: AcaoExemplo): EstadoExemplo {
  const r = reduzir(estado, { acao, euId: IDS.voce, agora: AGORA.toISOString() });
  expect(r.resultado.ok).toBe(true);
  return { ...(r.estado as EstadoBase), eu: estado.eu };
}

function membros(cartoes: Cartao[]): CartaoMembro[] {
  return cartoes.filter((c): c is CartaoMembro => c.tipo === "membro");
}

describe("filaDaEquipe", () => {
  it("tem 4 itens, a espera mais longa primeiro", () => {
    const fila = filaDaEquipe(estadoDe("admin"), AGORA);
    expect(fila.map((i) => [i.nome, i.motivo, tempoNaFila(i.esperaS), i.longa])).toEqual([
      ["Thiago Nunes", "Sem crédito de IA", "38 min", true],
      ["Rafael Albuquerque", "A Janete pediu ajuda", "24 min", true],
      ["Ricardo Menezes", "A Janete pediu ajuda", "13 min", true],
      ["Juliana Prado", "Sem crédito de IA", "4 min", false],
    ]);
  });

  it("depois de desativar a Marina, tem 7 itens e as 3 conversas dela voltam com 'Estava com Marina'", () => {
    const estado = depoisDe(estadoDe("admin"), { tipo: "desativarMembro", membroId: IDS.marina });
    const fila = filaDaEquipe(estado, AGORA);
    expect(fila).toHaveLength(7);
    const ultimas = fila.slice(-3);
    expect(ultimas.map((i) => i.nome)).toEqual(["Fernanda Rocha", "Helena Barros", "Patrícia Nogueira"]);
    for (const i of ultimas) {
      expect(i.motivo).toBe("Estava com Marina");
      expect(tempoNaFila(i.esperaS)).toBe("agora");
    }
  });
});

describe("cartoesDaEquipe", () => {
  it("do admin: você, Marina e o convite do Rodrigo, nessa ordem", () => {
    const cartoes = cartoesDaEquipe(estadoDe("admin"));
    expect(cartoes.map((c) => (c.tipo === "membro" ? c.nome : c.convite.email))).toEqual([
      "Você",
      "Marina",
      "rodrigo@empresa.exemplo",
    ]);
    const [voce, marina, convite] = cartoes;
    expect(convite!.tipo).toBe("convite");

    const v = voce as CartaoMembro;
    expect(v.souEu).toBe(true);
    expect(v.iniciais).toBe("VC");
    expect(v.conversas.map((c) => c.nome)).toEqual(["Sérgio Ramos", "Vinícius Castro"]);

    const m = marina as CartaoMembro;
    expect(m.souEu).toBe(false);
    expect(m.iniciais).toBe("MA");
    expect(m.conversas.map((c) => c.nome)).toEqual(["Patrícia Nogueira", "Fernanda Rocha", "Helena Barros"]);
  });

  it("as duas travas têm o texto literal da spec", () => {
    // Conferidas contra o texto da spec (docs/spec-equipe.md, contrato E0), não só contra a constante:
    // trocar a frase quebra este teste.
    expect(TRAVA_UNICO_ADMIN).toBe(
      "Você é o único admin. A equipe precisa de pelo menos um: torne outra pessoa admin antes.",
    );
    expect(TRAVA_PROPRIO).toBe("Para mudar o seu papel ou desativar a sua conta, peça a outro admin.");
  });

  it("o seu cartão vem travado por ser o único admin; o da Marina, livre", () => {
    const [voce, marina] = membros(cartoesDaEquipe(estadoDe("admin")));
    expect(voce!.travado).toBe(TRAVA_UNICO_ADMIN);
    expect(marina!.travado).toBeNull();
  });

  it("com a Marina admin, o seu cartão fica travado com 'peça a outro admin'", () => {
    const estado = depoisDe(estadoDe("admin"), { tipo: "trocarPapelMembro", membroId: IDS.marina, papel: "admin" });
    const [voce, marina] = membros(cartoesDaEquipe(estado));
    expect(voce!.travado).toBe(TRAVA_PROPRIO);
    expect(marina!.travado).toBeNull();
  });

  it("depois de desativar, o cartão da Marina vai para o fim, sem conversas", () => {
    const estado = depoisDe(estadoDe("admin"), { tipo: "desativarMembro", membroId: IDS.marina });
    const cartoes = cartoesDaEquipe(estado);
    const ultimo = cartoes[cartoes.length - 1] as CartaoMembro;
    expect(ultimo.tipo).toBe("membro");
    expect(ultimo.membro.id).toBe(IDS.marina);
    expect(ultimo.conversas).toEqual([]);
    expect(cartoes[0]).toMatchObject({ tipo: "membro", souEu: true });
  });

  it("o atendente vê Você (com as 3 dela) e Admin (com 2), sem convite e sem travas", () => {
    const cartoes = cartoesDaEquipe(estadoDe("atendente"));
    expect(cartoes.every((c) => c.tipo === "membro")).toBe(true);
    const [voce, admin] = membros(cartoes);
    expect(cartoes).toHaveLength(2);
    expect([voce!.nome, voce!.iniciais, voce!.conversas.length]).toEqual(["Você", "VC", 3]);
    expect([admin!.nome, admin!.iniciais, admin!.conversas.length]).toEqual(["Admin", "AD", 2]);
    expect(voce!.travado).toBeNull();
    expect(admin!.travado).toBeNull();
  });
});

describe("conversasDoMembro", () => {
  it("devolve todas as conversas (o corte em 5 é da tela)", () => {
    const base = estadoDe("admin");
    const tem = new Set(conversasDoMembro(base, IDS.marina).map((c) => c.conversaId));
    // Mais 4 conversas de outras pessoas (ou da Janete) passam para a Marina: 3 + 4 = 7.
    const outras = base.conversas.filter((c) => !tem.has(c.id)).slice(0, 4);
    expect(outras).toHaveLength(4);
    const ids = new Set(outras.map((c) => c.id));
    const estado: EstadoExemplo = {
      ...base,
      conversas: base.conversas.map((c) =>
        ids.has(c.id) ? { ...c, modo: "humano", responsavel_id: IDS.marina } : c,
      ),
    };
    const lista = conversasDoMembro(estado, IDS.marina);
    expect(lista).toHaveLength(7);
    expect(lista.length).toBeGreaterThan(MAX_NO_CARTAO);
    expect(MAX_NO_CARTAO).toBe(5);
  });
});

describe("erroDoConvite", () => {
  const estado = estadoDe("admin");

  it("devolve os 6 textos da spec", () => {
    expect(erroDoConvite(estado, "")).toBe("Escreva o e-mail da pessoa.");
    expect(erroDoConvite(estado, "   ")).toBe("Escreva o e-mail da pessoa.");
    expect(erroDoConvite(estado, "marina")).toBe("Esse e-mail parece incompleto. Confira se tem @ e o domínio.");
    expect(erroDoConvite(estado, estado.eu.email)).toBe("Esse é o seu e-mail.");
    const marina = estado.membros.find((m) => m.id === IDS.marina)!;
    expect(erroDoConvite(estado, marina.email)).toBe("Marina já está na equipe.");
    const desativado = depoisDe(estado, { tipo: "desativarMembro", membroId: IDS.marina });
    expect(erroDoConvite(desativado, marina.email)).toBe(
      "Marina já está na equipe, com a conta desativada. Para trazer de volta, use Reativar no cartão.",
    );
    expect(erroDoConvite(estado, "rodrigo@empresa.exemplo")).toBe(
      "Já existe um convite para esse e-mail. Para renovar, use Renovar no cartão do convite.",
    );
  });

  it("devolve null para um e-mail novo", () => {
    expect(erroDoConvite(estado, "novo@empresa.exemplo")).toBeNull();
  });

  it("aceita maiúsculas e espaços em volta", () => {
    expect(erroDoConvite(estado, "  Novo@Empresa.Exemplo ")).toBeNull();
    expect(erroDoConvite(estado, "  RODRIGO@Empresa.Exemplo ")).toBe(
      "Já existe um convite para esse e-mail. Para renovar, use Renovar no cartão do convite.",
    );
    expect(erroDoConvite(estado, ` ${estado.eu.email.toUpperCase()} `)).toBe("Esse é o seu e-mail.");
  });
});

describe("o tempo na fila", () => {
  it("'agora' no primeiro minuto e depois o tempo compacto", () => {
    expect(tempoNaFila(0)).toBe("agora");
    expect(tempoNaFila(59)).toBe("agora");
    expect(tempoNaFila(60)).toBe("1 min");
    expect(tempoNaFila(3900)).toBe("1 h 05");
  });

  it("por extenso, para o leitor de tela", () => {
    expect(tempoNaFilaPorExtenso(780)).toBe("há 13 min");
  });
});

describe("bordas", () => {
  it("estado sem a chave convites: o admin fica sem cartão de convite", () => {
    const { convites: _fora, ...resto } = estadoDe("admin");
    const estado = resto as EstadoExemplo;
    expect("convites" in estado).toBe(false);
    const cartoes = cartoesDaEquipe(estado);
    expect(cartoes.map((c) => c.tipo)).toEqual(["membro", "membro"]);
    expect(erroDoConvite(estado, "novo@empresa.exemplo")).toBeNull();
  });

  it("contato com nome vazio usa o nome do WhatsApp", () => {
    const base = estadoDe("admin");
    const conv = conversasDoMembro(base, IDS.marina)[0]!;
    const estado: EstadoExemplo = {
      ...base,
      contatos: base.contatos.map((c) =>
        c.id === conv.contatoId ? { ...c, nome: "", nome_whatsapp: "Pat do Zap" } : c,
      ),
    };
    expect(conversasDoMembro(estado, IDS.marina)[0]!.nome).toBe("Pat do Zap");
  });

  it("conversa sem ultima_mensagem_em vai para o fim do cartão", () => {
    const base = estadoDe("admin");
    const primeira = conversasDoMembro(base, IDS.marina)[0]!;
    const estado: EstadoExemplo = {
      ...base,
      conversas: base.conversas.map((c) => (c.id === primeira.conversaId ? { ...c, ultima_mensagem_em: null } : c)),
    };
    const lista = conversasDoMembro(estado, IDS.marina);
    expect(lista).toHaveLength(3);
    expect(lista[lista.length - 1]!.conversaId).toBe(primeira.conversaId);
    expect(lista[lista.length - 1]!.ultimaEm).toBeNull();
  });
});

describe("proximoTiqueDaFila", () => {
  const t0 = AGORA.getTime();

  it("cai logo depois da próxima virada de minuto da espera mais próxima de virar", () => {
    // 9 min 50 s e 30 s: a de 9 min 50 s vira primeiro (em 10 s), para "10 min" e a bolinha vermelha,
    // no mesmo instante que o Chat.
    const longa = new Date(t0 - (9 * 60 + 50) * 1000).toISOString();
    const curta = new Date(t0 - 30 * 1000).toISOString();
    expect(proximoTiqueDaFila(t0, [longa, curta])).toBe(10_000 + 50);
  });

  it("a espera que acabou de começar anda em 1 min (de 'agora' para '1 min')", () => {
    expect(proximoTiqueDaFila(t0, [AGORA.toISOString()])).toBe(60_000 + 50);
  });

  it("a espera no futuro anda quando começa; sem espera (ou só datas ruins), não há tique", () => {
    expect(proximoTiqueDaFila(t0, [new Date(t0 + 5_000).toISOString()])).toBe(5_000 + 50);
    expect(proximoTiqueDaFila(t0, [])).toBeNull();
    expect(proximoTiqueDaFila(t0, [null, "", "não é data"])).toBeNull();
  });
});
