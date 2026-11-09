import { describe, expect, it } from "vitest";

import { situacaoDe } from "@/features/plataforma/comum/LinhaConversa";
import {
  IDS,
  criarEstadoInicial,
  estaAguardando,
  idConversa,
  reduzir,
  seloDaConversa,
  type AcaoExemplo,
  type EstadoBase,
} from "@/features/plataforma/exemplo";

// A fundação da Equipe (docs/spec-equipe.md, F1 a F4): o convite do exemplo, as 6 ações da Equipe no
// reducer (só do admin, ninguém mexe em si mesmo) e o "Estava com" das conversas que voltam para a
// espera quando alguém é desativado. O `ultimo_admin` do reducer é só defesa (como o gatilho
// membros_ultimo_admin): com "só o admin mexe" e "ninguém mexe em si mesmo", quem mexe num admin já
// é outro admin ativo, então a equipe nunca fica sem admin por estas ações.

// Sexta-feira, 30/10/2026, 14:45 em São Paulo (17:45 UTC).
const AGORA = new Date("2026-10-30T17:45:00.000Z");
const DEPOIS = new Date(AGORA.getTime() + 60_000).toISOString();

const inicial = () => criarEstadoInicial(AGORA);

function rodar(estado: EstadoBase, acao: AcaoExemplo, eu: string = IDS.voce) {
  return reduzir(estado, { acao, euId: eu, agora: DEPOIS });
}

const comMarina = (estado: EstadoBase) =>
  estado.conversas.filter((c) => c.responsavel_id === IDS.marina).map((c) => c.id).sort();

describe("o convite do exemplo (F3)", () => {
  it("começa com um convite pendente, fictício, para atendente, enviado por você", () => {
    const e = inicial();
    expect(e.convites).toEqual([
      expect.objectContaining({ id: IDS.convite, email: "rodrigo@empresa.exemplo", papel: "atendente", convidado_por: IDS.voce }),
    ]);
    // ontem às 17:20 em São Paulo (20:20 UTC)
    expect(e.convites![0]!.enviado_em).toBe("2026-10-29T20:20:00.000Z");
  });
});

describe("convidarMembro", () => {
  it("o admin convida: e-mail aparado e minúsculo, quem convidou e quando; o id é o do convite", () => {
    const r = rodar(inicial(), { tipo: "convidarMembro", email: "  Lucia@Empresa.Exemplo ", papel: "admin" });
    expect(r.resultado).toEqual({ ok: true, id: "cn-n1" });
    expect(r.estado.convites!.at(-1)).toEqual({
      id: "cn-n1",
      email: "lucia@empresa.exemplo",
      papel: "admin",
      convidado_por: IDS.voce,
      enviado_em: DEPOIS,
    });
    const r2 = rodar(r.estado, { tipo: "convidarMembro", email: "bia@empresa.exemplo", papel: "atendente" });
    expect(r2.resultado).toEqual({ ok: true, id: "cn-n2" });
  });

  it("recusa e-mail sem o formato x@y.zz, e-mail de membro (ativo ou não) e e-mail que já tem convite", () => {
    const e = inicial();
    for (const email of ["", "lucia", "lucia@empresa", "lucia@empresa.e", "lu cia@empresa.exemplo"]) {
      expect(rodar(e, { tipo: "convidarMembro", email, papel: "atendente" }).resultado).toEqual({ ok: false, erro: "email_invalido" });
    }
    expect(rodar(e, { tipo: "convidarMembro", email: "MARINA@empresa.exemplo", papel: "atendente" }).resultado).toEqual({
      ok: false,
      erro: "email_em_uso",
    });
    expect(rodar(e, { tipo: "convidarMembro", email: "rodrigo@empresa.exemplo", papel: "admin" }).resultado).toEqual({
      ok: false,
      erro: "email_em_uso",
    });
    const semMarina = rodar(e, { tipo: "desativarMembro", membroId: IDS.marina }).estado;
    expect(rodar(semMarina, { tipo: "convidarMembro", email: "marina@empresa.exemplo", papel: "atendente" }).resultado).toEqual({
      ok: false,
      erro: "email_em_uso",
    });
  });

  it("o atendente não convida", () => {
    const r = rodar(inicial(), { tipo: "convidarMembro", email: "lucia@empresa.exemplo", papel: "atendente" }, IDS.marina);
    expect(r.resultado).toEqual({ ok: false, erro: "sem_permissao" });
  });

  it("funciona sem a lista de convites no estado (estado antigo)", () => {
    const { convites: _, ...semLista } = inicial();
    const r = rodar(semLista, { tipo: "convidarMembro", email: "lucia@empresa.exemplo", papel: "atendente" });
    expect(r.resultado.ok).toBe(true);
    expect(r.estado.convites).toHaveLength(1);
  });
});

describe("reenviarConvite e cancelarConvite", () => {
  it("reenviar grava o envio de agora; cancelar tira o convite da lista", () => {
    const e = inicial();
    const r = rodar(e, { tipo: "reenviarConvite", conviteId: IDS.convite });
    expect(r.resultado).toEqual({ ok: true });
    expect(r.estado.convites![0]!.enviado_em).toBe(DEPOIS);
    const c = rodar(e, { tipo: "cancelarConvite", conviteId: IDS.convite });
    expect(c.resultado).toEqual({ ok: true });
    expect(c.estado.convites).toEqual([]);
  });

  it("convite que não existe: nao_encontrado; atendente: sem_permissao", () => {
    const e = inicial();
    expect(rodar(e, { tipo: "reenviarConvite", conviteId: "cn-x" }).resultado).toEqual({ ok: false, erro: "nao_encontrado" });
    expect(rodar(e, { tipo: "cancelarConvite", conviteId: "cn-x" }).resultado).toEqual({ ok: false, erro: "nao_encontrado" });
    expect(rodar(e, { tipo: "reenviarConvite", conviteId: IDS.convite }, IDS.marina).resultado).toEqual({
      ok: false,
      erro: "sem_permissao",
    });
    expect(rodar(e, { tipo: "cancelarConvite", conviteId: IDS.convite }, IDS.marina).resultado).toEqual({
      ok: false,
      erro: "sem_permissao",
    });
  });
});

describe("trocarPapelMembro", () => {
  it("o admin troca o papel de outra pessoa, nos dois sentidos", () => {
    const admin = rodar(inicial(), { tipo: "trocarPapelMembro", membroId: IDS.marina, papel: "admin" });
    expect(admin.resultado).toEqual({ ok: true });
    expect(admin.estado.membros.find((m) => m.id === IDS.marina)!.papel).toBe("admin");
    const volta = rodar(admin.estado, { tipo: "trocarPapelMembro", membroId: IDS.marina, papel: "atendente" });
    expect(volta.resultado).toEqual({ ok: true });
    expect(volta.estado.membros.find((m) => m.id === IDS.marina)!.papel).toBe("atendente");
  });

  it("o mesmo papel não muda nada", () => {
    const e = inicial();
    const r = rodar(e, { tipo: "trocarPapelMembro", membroId: IDS.marina, papel: "atendente" });
    expect(r.resultado).toEqual({ ok: true });
    expect(r.estado).toBe(e);
  });

  it("ninguém troca o próprio papel, nem com outro admin na equipe", () => {
    const e = inicial();
    expect(rodar(e, { tipo: "trocarPapelMembro", membroId: IDS.voce, papel: "atendente" }).resultado).toEqual({
      ok: false,
      erro: "proprio_membro",
    });
    const doisAdmins = rodar(e, { tipo: "trocarPapelMembro", membroId: IDS.marina, papel: "admin" }).estado;
    expect(rodar(doisAdmins, { tipo: "trocarPapelMembro", membroId: IDS.voce, papel: "atendente" }).resultado).toEqual({
      ok: false,
      erro: "proprio_membro",
    });
    // com outro admin, a Marina tira o papel de admin de você
    const r = rodar(doisAdmins, { tipo: "trocarPapelMembro", membroId: IDS.voce, papel: "atendente" }, IDS.marina);
    expect(r.resultado).toEqual({ ok: true });
  });

  it("membro que não existe ou está desativado: nao_encontrado; atendente: sem_permissao", () => {
    const e = inicial();
    expect(rodar(e, { tipo: "trocarPapelMembro", membroId: "mb-x", papel: "admin" }).resultado).toEqual({ ok: false, erro: "nao_encontrado" });
    const semMarina = rodar(e, { tipo: "desativarMembro", membroId: IDS.marina }).estado;
    expect(rodar(semMarina, { tipo: "trocarPapelMembro", membroId: IDS.marina, papel: "admin" }).resultado).toEqual({
      ok: false,
      erro: "nao_encontrado",
    });
    expect(rodar(e, { tipo: "trocarPapelMembro", membroId: IDS.voce, papel: "atendente" }, IDS.marina).resultado).toEqual({
      ok: false,
      erro: "sem_permissao",
    });
  });
});

describe("desativarMembro", () => {
  it("as conversas com a pessoa voltam para a espera, marcadas com quem estava com elas", () => {
    const e = inicial();
    const dela = comMarina(e);
    expect(dela).toEqual([idConversa("fernanda"), idConversa("helena"), idConversa("patricia")]);
    const r = rodar(e, { tipo: "desativarMembro", membroId: IDS.marina });
    expect(r.resultado).toEqual({ ok: true });
    expect(r.estado.membros.find((m) => m.id === IDS.marina)!.ativo).toBe(false);
    for (const id of dela) {
      const antes = e.conversas.find((c) => c.id === id)!;
      const depois = r.estado.conversas.find((c) => c.id === id)!;
      expect(depois).toEqual({
        ...antes,
        responsavel_id: null,
        aguardando_humano_desde: DEPOIS,
        estavaCom: IDS.marina,
        atualizado_em: DEPOIS,
      });
      expect(estaAguardando(depois)).toBe(true);
      expect(seloDaConversa(depois)).toBe("aguardando");
    }
    // a espera foi de 4 para 7; as outras conversas não mudaram
    expect(e.conversas.filter(estaAguardando)).toHaveLength(4);
    expect(r.estado.conversas.filter(estaAguardando)).toHaveLength(7);
    const outras = (x: EstadoBase) => x.conversas.filter((c) => !dela.includes(c.id));
    expect(outras(r.estado)).toEqual(outras(e));
  });

  it("membro que não existe: nao_encontrado", () => {
    expect(rodar(inicial(), { tipo: "desativarMembro", membroId: "mb-x" }).resultado).toEqual({ ok: false, erro: "nao_encontrado" });
  });

  it("ninguém se desativa; o atendente não desativa; com outro admin, um desativa o outro", () => {
    const e = inicial();
    expect(rodar(e, { tipo: "desativarMembro", membroId: IDS.voce }).resultado).toEqual({ ok: false, erro: "proprio_membro" });
    expect(rodar(e, { tipo: "desativarMembro", membroId: IDS.voce }, IDS.marina).resultado).toEqual({
      ok: false,
      erro: "sem_permissao",
    });
    // com a Marina admin, ela desativa você; já desativado, não dá de novo
    const doisAdmins = rodar(e, { tipo: "trocarPapelMembro", membroId: IDS.marina, papel: "admin" }).estado;
    const r = rodar(doisAdmins, { tipo: "desativarMembro", membroId: IDS.voce }, IDS.marina);
    expect(r.resultado).toEqual({ ok: true });
    expect(rodar(r.estado, { tipo: "desativarMembro", membroId: IDS.voce }, IDS.marina).resultado).toEqual({
      ok: false,
      erro: "nao_encontrado",
    });
  });
});

describe("reativarMembro", () => {
  it("a pessoa volta a entrar, e as conversas continuam na espera", () => {
    const desativada = rodar(inicial(), { tipo: "desativarMembro", membroId: IDS.marina }).estado;
    const r = rodar(desativada, { tipo: "reativarMembro", membroId: IDS.marina });
    expect(r.resultado).toEqual({ ok: true });
    expect(r.estado.membros.find((m) => m.id === IDS.marina)!.ativo).toBe(true);
    expect(r.estado.conversas).toEqual(desativada.conversas);
    expect(comMarina(r.estado)).toEqual([]);
  });

  it("ativo: nada muda; não existe: nao_encontrado; atendente: sem_permissao", () => {
    const e = inicial();
    const r = rodar(e, { tipo: "reativarMembro", membroId: IDS.marina });
    expect(r.resultado).toEqual({ ok: true });
    expect(r.estado).toBe(e);
    expect(rodar(e, { tipo: "reativarMembro", membroId: "mb-x" }).resultado).toEqual({ ok: false, erro: "nao_encontrado" });
    expect(rodar(e, { tipo: "reativarMembro", membroId: IDS.marina }, IDS.marina).resultado).toEqual({
      ok: false,
      erro: "sem_permissao",
    });
  });
});

describe("o estavaCom só vale enquanto a conversa espera", () => {
  const voltou = () => rodar(inicial(), { tipo: "desativarMembro", membroId: IDS.marina }).estado;
  const patricia = idConversa("patricia");
  const dela = (e: EstadoBase) => e.conversas.find((c) => c.id === patricia)!;

  it("assumir apaga a marca", () => {
    const r = rodar(voltou(), { tipo: "assumir", conversaId: patricia });
    expect(dela(r.estado).estavaCom).toBeNull();
    expect(dela(r.estado).responsavel_id).toBe(IDS.voce);
  });

  it("devolver para a Janete apaga a marca", () => {
    const r = rodar(voltou(), { tipo: "devolverParaJanete", conversaId: patricia });
    expect(dela(r.estado).estavaCom).toBeNull();
  });

  it("responder pela tela apaga a marca", () => {
    const r = rodar(voltou(), { tipo: "enviarMensagem", conversaId: patricia, mensagem: { tipo: "texto", texto: "Oi, Patrícia!" } });
    expect(r.resultado.ok).toBe(true);
    expect(dela(r.estado).estavaCom).toBeNull();
  });

  it("o celular da empresa respondendo apaga a marca", () => {
    const r = rodar(voltou(), { tipo: "simularJanete", evento: { tipo: "celular_responde", conversaId: patricia, texto: "Oi!" } });
    expect(dela(r.estado).estavaCom).toBeNull();
  });

  it("o lead escrevendo de novo não mexe na marca: a conversa continua esperando", () => {
    const r = rodar(voltou(), {
      tipo: "simularJanete",
      evento: { tipo: "lead_mensagem", conversaId: patricia, mensagem: { tipo: "texto", texto: "Alguém pode me responder?" } },
    });
    expect(r.resultado.ok).toBe(true);
    expect(dela(r.estado).estavaCom).toBe(IDS.marina);
    expect(estaAguardando(dela(r.estado))).toBe(true);
  });

  it("marcar como lida não mexe na marca, e conversa sem a marca não ganha o campo", () => {
    const r = rodar(voltou(), { tipo: "marcarLida", conversaId: patricia });
    expect(dela(r.estado).estavaCom).toBe(IDS.marina);
    const outra = rodar(inicial(), { tipo: "assumir", conversaId: idConversa("ricardo") });
    expect(outra.estado.conversas.find((c) => c.id === idConversa("ricardo"))).not.toHaveProperty("estavaCom");
  });
});

describe("o 'Estava com' na situação da conversa (F4)", () => {
  const espera = { modo: "humano" as const, responsavel_id: null, aguardando_humano_desde: DEPOIS, motivo_humano: "sem_credito" as const };

  it("com o nome, a espera diz com quem estava; a cor (falha ou não) continua pelo motivo", () => {
    expect(situacaoDe(espera, { estavaCom: "Marina" })).toEqual({
      quem: "falha",
      texto: "Estava com Marina",
      descricao: "Aguardando alguém: estava com Marina",
    });
    expect(situacaoDe({ ...espera, motivo_humano: "humano_tela" }, { estavaCom: "Marina" })).toEqual({
      quem: "aguardando",
      texto: "Estava com Marina",
      descricao: "Aguardando alguém: estava com Marina",
    });
  });

  it("sem o nome, igual a antes", () => {
    expect(situacaoDe(espera)).toEqual({
      quem: "falha",
      texto: "Sem crédito de IA",
      descricao: expect.stringMatching(/^Aguardando alguém: /),
    });
    expect(seloDaConversa(espera)).toBe("falha");
  });
});

describe("toda recusa devolve o mesmo estado, sem mudar nada", () => {
  it("convite inválido, e-mail em uso, mexer em si mesmo, atendente e id que não existe", () => {
    const e = inicial();
    const recusas: [AcaoExemplo, string][] = [
      [{ tipo: "convidarMembro", email: "lucia", papel: "atendente" }, IDS.voce],
      [{ tipo: "convidarMembro", email: "marina@empresa.exemplo", papel: "atendente" }, IDS.voce],
      [{ tipo: "convidarMembro", email: "lucia@empresa.exemplo", papel: "atendente" }, IDS.marina],
      [{ tipo: "reenviarConvite", conviteId: "cn-x" }, IDS.voce],
      [{ tipo: "cancelarConvite", conviteId: IDS.convite }, IDS.marina],
      [{ tipo: "trocarPapelMembro", membroId: IDS.voce, papel: "atendente" }, IDS.voce],
      [{ tipo: "trocarPapelMembro", membroId: IDS.marina, papel: "admin" }, IDS.marina],
      [{ tipo: "desativarMembro", membroId: IDS.voce }, IDS.voce],
      [{ tipo: "desativarMembro", membroId: IDS.voce }, IDS.marina],
      [{ tipo: "reativarMembro", membroId: "mb-x" }, IDS.voce],
    ];
    for (const [acao, eu] of recusas) {
      const r = rodar(e, acao, eu);
      expect(r.resultado.ok, JSON.stringify(acao)).toBe(false);
      expect(r.estado).toBe(e);
    }
  });
});
