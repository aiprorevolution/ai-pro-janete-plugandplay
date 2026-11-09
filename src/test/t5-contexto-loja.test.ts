import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { versoesDeExemplo } from "@/features/plataforma/contexto/dados";
import { lerContexto, reiniciarContexto, useContexto } from "@/features/plataforma/contexto/loja";
import {
  contagem,
  juntarMudancas,
  LIMITE_LETRAS,
  mudancasDoAlvo,
  paraLinhaDoBanco,
  paraVersao,
  quando,
  quemSalvou,
  resumoDaVersao,
  rotear,
  situacao,
  versaoAtual,
  VERSAO_VAZIA,
} from "@/features/plataforma/contexto/regras";
import type { VersaoContextoBanco } from "@/features/plataforma/dados/tipos";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task F1 da spec do Contexto (docs/spec-contexto.md) e task C6 da spec de ligar as telas ao banco:
// as regras puras, os dados de exemplo e a loja (com a fonte em memória, que repete o contexto_salvar).

function montar(papel: Papel = "admin") {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(ProvedorPapel, { inicial: papel, children });
  return renderHook(() => useContexto(), { wrapper });
}

beforeEach(() => {
  reiniciarContexto();
});

afterEach(() => {
  vi.useRealTimers();
  reiniciarContexto();
});

describe("dados de exemplo", () => {
  it("tem 6 versões, da mais nova para a mais velha, e a v6 com 6 de 8 campos, 3 itens e nenhum anexo (11a)", () => {
    const vs = versoesDeExemplo();
    expect(vs.map((v) => v.numero)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(vs.map((v) => v.id)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(vs.map((v) => v.origem)).toEqual(["edicao", "restauracao", "edicao", "edicao", "edicao", "onboarding"]);
    expect(vs[1]!.restauradaDe).toBe(3);
    const v6 = vs[0]!;
    expect(contagem(v6)).toEqual({ campos: 6, itens: 3, anexos: 0 });
    expect(v6.campos.objecoes).toBe("");
    expect(v6.campos.horario).toBe("");
    expect(v6.itens.map((i) => i.pergunta)).toEqual([
      "Vocês emitem nota fiscal?",
      "Atendem empresas fora de São Paulo?",
      "Tem período de teste?",
    ]);
    // instantes de 26 a 28/10/2026, lidos no relógio de São Paulo
    expect(vs.map((v) => quando(v.criadoEm, "2026-10-30T12:00:00-03:00"))).toEqual([
      "28/10, 18:20",
      "28/10, 10:02",
      "27/10, 15:12",
      "27/10, 09:30",
      "26/10, 17:05",
      "26/10, 16:40",
    ]);
  });
});

describe("salvar", () => {
  it("cria a v7 'edicao' só com o rascunho daquele campo, com os extras separados por linha em branco, e limpa o rascunho", async () => {
    const { result } = montar();
    const preco6 = result.current.estado.versoes[0]!.campos.preco;
    act(() => {
      expect(result.current.acoes.mandar("preco", "Aceitamos Pix")).toEqual({ ok: true });
      result.current.acoes.mandar("tom_voz", "Sempre com emoji");
    });
    expect(situacao(result.current.estado, "preco")).toBe("nao_salvo");
    // o rascunho guarda a versão aberta: é o p_base do contexto_salvar
    expect(result.current.estado.rascunhos.preco?.base).toBe(6);

    let r;
    await act(async () => {
      r = await result.current.acoes.salvar("preco");
    });
    expect(r).toEqual({ ok: true, versao: 7 });
    const v7 = result.current.estado.versoes[0]!;
    expect(v7.numero).toBe(7);
    expect(v7.origem).toBe("edicao");
    expect(v7.campos.preco).toBe(`${preco6}\n\nAceitamos Pix.`);
    expect(v7.campos.tom_voz).toBe(result.current.estado.versoes[1]!.campos.tom_voz);
    expect(v7.resumo).toBe("Preço.");
    expect(result.current.estado.versoes).toHaveLength(7);
    expect(result.current.estado.rascunhos.preco).toBeUndefined();
    expect(result.current.estado.rascunhos.tom_voz).toBeDefined();
    expect(situacao(result.current.estado, "preco")).toBe("sabe");
  });

  it("salvar sem mudança devolve 'vazio' e não muda nada", async () => {
    const { result } = montar();
    const antes = lerContexto();
    expect(await result.current.acoes.salvar("preco")).toEqual({ ok: false, erro: "vazio" });
    act(() => {
      result.current.acoes.editarTexto("preco", antes.versoes[0]!.campos.preco);
    });
    const comRascunho = lerContexto();
    expect(await result.current.acoes.salvar("preco")).toEqual({ ok: false, erro: "vazio" });
    expect(lerContexto()).toBe(comRascunho);
    expect(lerContexto().versoes).toHaveLength(6);
  });

  it("o atendente recebe 'sem_permissao' em toda ação que grava, e nada muda", async () => {
    const { result } = montar("atendente");
    const antes = lerContexto();
    const a = result.current.acoes;
    const negado = { ok: false, erro: "sem_permissao" };
    expect(a.editarTexto("preco", "x")).toEqual(negado);
    expect(a.mandar("preco", "x")).toEqual(negado);
    expect(a.descartar("preco")).toEqual(negado);
    expect(await a.salvar("preco")).toEqual(negado);
    expect(a.novoItem("Vocês têm estacionamento?")).toEqual(negado);
    expect(a.editarItem("livre-1", { resposta: "x" })).toEqual(negado);
    expect(await a.removerItem(1)).toEqual(negado);
    expect(a.ensinar("atendemos sábado das 9h")).toEqual(negado);
    expect(a.ensinarEm("horario", "x")).toEqual(negado);
    expect(await a.restaurar(3)).toEqual(negado);
    expect(lerContexto()).toBe(antes);
    expect(result.current.estado.versoes).toHaveLength(6);
  });

  it("numa versão antiga, só lê: 'versao_antiga' e nada muda", async () => {
    const { result } = montar();
    act(() => {
      expect(result.current.acoes.verVersao(4)).toEqual({ ok: true });
    });
    expect(result.current.estado.vendo).toBe(4);
    const antes = lerContexto();
    expect(result.current.acoes.editarTexto("preco", "x")).toEqual({ ok: false, erro: "versao_antiga" });
    expect(await result.current.acoes.salvar("preco")).toEqual({ ok: false, erro: "versao_antiga" });
    expect(await result.current.acoes.removerItem(1)).toEqual({ ok: false, erro: "versao_antiga" });
    expect(lerContexto()).toBe(antes);
    act(() => result.current.acoes.voltarParaAtual());
    expect(result.current.estado.vendo).toBeNull();
    expect(result.current.acoes.verVersao(99)).toEqual({ ok: false, erro: "nao_encontrado" });
  });

  it("acima de 2.000 letras no campo dá 'limite_tamanho' e não grava (11d)", async () => {
    const { result } = montar();
    act(() => {
      result.current.acoes.editarTexto("preco", "a".repeat(LIMITE_LETRAS + 1));
    });
    expect(await result.current.acoes.salvar("preco")).toEqual({ ok: false, erro: "limite_tamanho" });
    expect(lerContexto().versoes).toHaveLength(6);
    // exatamente 2.000 passa
    act(() => {
      result.current.acoes.editarTexto("preco", "a".repeat(LIMITE_LETRAS));
    });
    expect(await result.current.acoes.salvar("preco")).toEqual({ ok: true, versao: 7 });
  });

  it("a resposta livre também tem o limite de 2.000 letras", async () => {
    const { result } = montar();
    act(() => {
      result.current.acoes.editarItem("livre-1", { resposta: "b".repeat(LIMITE_LETRAS + 1) });
    });
    expect(await result.current.acoes.salvar("livre-1")).toEqual({ ok: false, erro: "limite_tamanho" });
  });
});

describe("dois admins ao mesmo tempo (decisão 11b)", () => {
  it("campos diferentes se juntam: o 2º admin salva o Preço sem perder o Horário que o 1º gravou", async () => {
    const { result } = montar();
    act(() => {
      result.current.acoes.editarTexto("preco", "Preço novo do admin 2");
    });
    // outro admin grava o Horário a partir da mesma v6 (direto na fonte, como outra aba)
    reiniciarContexto({
      ...lerContexto(),
      versoes: [{ ...versoesDeExemplo()[0]!, id: 7, numero: 7, campos: { ...versoesDeExemplo()[0]!.campos, horario: "Das 9h às 18h" } }, ...versoesDeExemplo()],
    });
    let r;
    await act(async () => {
      r = await result.current.acoes.salvar("preco");
    });
    expect(r).toEqual({ ok: true, versao: 8 });
    const v8 = result.current.estado.versoes[0]!;
    expect(v8.campos.preco).toBe("Preço novo do admin 2");
    expect(v8.campos.horario).toBe("Das 9h às 18h");
  });

  it("no mesmo campo, o 2º recebe 'contexto_mudou' com o texto novo; o rascunho fica e o próximo salvar passa", async () => {
    const { result } = montar();
    act(() => {
      result.current.acoes.editarTexto("preco", "O meu preço");
    });
    const v6 = versoesDeExemplo()[0]!;
    reiniciarContexto({
      ...lerContexto(),
      versoes: [{ ...v6, id: 7, numero: 7, campos: { ...v6.campos, preco: "O preço do outro admin" } }, ...versoesDeExemplo()],
    });
    let r;
    await act(async () => {
      r = await result.current.acoes.salvar("preco");
    });
    expect(r).toEqual({ ok: false, erro: "contexto_mudou", textoNovo: "O preço do outro admin" });
    expect(lerContexto().versoes).toHaveLength(7);
    // o rascunho continua, agora a partir da versão que o outro gravou
    expect(result.current.estado.rascunhos.preco).toMatchObject({ texto: "O meu preço", base: 7 });
    await act(async () => {
      r = await result.current.acoes.salvar("preco");
    });
    expect(r).toEqual({ ok: true, versao: 8 });
    expect(result.current.estado.versoes[0]!.campos.preco).toBe("O meu preço");
  });

  it("juntarMudancas repete o contexto_salvar: base nula com versão já gravada, igual à atual e itens como um campo", () => {
    const [v6, v5] = versoesDeExemplo();
    expect(juntarMudancas(v6!, null, { preco: "x" })).toEqual({ ok: false, erro: "contexto_mudou" });
    const igual = juntarMudancas(v6!, v6!, { preco: v6!.campos.preco });
    expect(igual).toMatchObject({ ok: true, igual: true });
    // os itens mudaram entre a v5 e a v6: mexer na lista a partir da v5 dá conflito
    expect(juntarMudancas(v6!, v5!, { itens: [] })).toEqual({ ok: false, erro: "contexto_mudou" });
    // o Preço não mudou entre a v5 e a v6: passa
    expect(juntarMudancas(v6!, v5!, { preco: "novo" })).toMatchObject({ ok: true, igual: false });
    expect(mudancasDoAlvo(v6!, "livre-2", { pergunta: "P?", texto: "R" })).toEqual({
      itens: [v6!.itens[0], { pergunta: "P?", resposta: "R" }, v6!.itens[2]],
    });
    expect(mudancasDoAlvo(v6!, "tom_voz", { pergunta: "", texto: "Sério" })).toEqual({ tom_voz: "Sério" });
  });
});

describe("nenhuma versão ainda", () => {
  it("a versão vazia tem número 0 e o 1º salvamento cria a versão 1, sem base", async () => {
    reiniciarContexto({ versoes: [] });
    const { result } = montar();
    expect(versaoAtual(result.current.estado)).toBe(VERSAO_VAZIA);
    act(() => {
      result.current.acoes.mandar("empresa_oferta", "Uma padaria de bairro");
    });
    expect(result.current.estado.rascunhos.empresa_oferta?.base).toBe(0);
    let r;
    await act(async () => {
      r = await result.current.acoes.salvar("empresa_oferta");
    });
    expect(r).toEqual({ ok: true, versao: 1 });
    const v1 = result.current.estado.versoes[0]!;
    expect(v1).toMatchObject({ id: 1, numero: 1, origem: "edicao", quem: "Você", resumo: "Primeira versão, com 1 campo." });
    expect(v1.campos.empresa_oferta).toBe("Uma padaria de bairro.");
  });
});

describe("restaurar", () => {
  it("restaurar a 3 cria a v7 'restauracao', com restauradaDe 3 e o conteúdo da 3, e volta para a atual", async () => {
    const { result } = montar();
    act(() => {
      result.current.acoes.mandar("preco", "rascunho que vai sumir");
      result.current.acoes.verVersao(3);
    });
    let r;
    await act(async () => {
      r = await result.current.acoes.restaurar(3);
    });
    expect(r).toEqual({ ok: true, versao: 7 });
    const { versoes, vendo, rascunhos } = result.current.estado;
    const v7 = versoes[0]!;
    const v3 = versoes.find((v) => v.numero === 3)!;
    expect(v7.origem).toBe("restauracao");
    expect(v7.restauradaDe).toBe(3);
    expect(v7.resumo).toBe("Restaurada da versão 3.");
    expect(v7.campos).toEqual(v3.campos);
    expect(v7.itens).toEqual(v3.itens);
    expect(vendo).toBeNull();
    expect(rascunhos).toEqual({});
    // restaurar a atual não tem efeito
    expect(await result.current.acoes.restaurar(7)).toEqual({ ok: false, erro: "vazio" });
    expect(await result.current.acoes.restaurar(99)).toEqual({ ok: false, erro: "nao_encontrado" });
  });
});

describe("itens livres", () => {
  it("o 'livre-novo' cria o item, o 'livre-n' edita e o removerItem cria versão", async () => {
    const { result } = montar();
    act(() => {
      result.current.acoes.novoItem("Vocês têm estacionamento?");
    });
    expect(await result.current.acoes.salvar("livre-novo")).toEqual({ ok: false, erro: "vazio" });
    act(() => {
      result.current.acoes.editarItem("livre-novo", { resposta: "Sim, na rua de trás." });
    });
    await act(async () => {
      expect(await result.current.acoes.salvar("livre-novo")).toEqual({ ok: true, versao: 7 });
    });
    expect(result.current.estado.versoes[0]!.itens[3]).toEqual({ pergunta: "Vocês têm estacionamento?", resposta: "Sim, na rua de trás." });
    expect(result.current.estado.versoes[0]!.resumo).toBe("Pergunta livre nova: Vocês têm estacionamento?");

    act(() => {
      result.current.acoes.editarItem("livre-1", { resposta: "Sim, para todas as vendas, com NF-e." });
    });
    await act(async () => {
      expect(await result.current.acoes.salvar("livre-1")).toEqual({ ok: true, versao: 8 });
    });
    expect(result.current.estado.versoes[0]!.itens[0]!.resposta).toBe("Sim, para todas as vendas, com NF-e.");

    await act(async () => {
      expect(await result.current.acoes.removerItem(2)).toEqual({ ok: true, versao: 9 });
    });
    const v9 = result.current.estado.versoes[0]!;
    expect(v9.itens.map((i) => i.pergunta)).toEqual(["Vocês emitem nota fiscal?", "Tem período de teste?", "Vocês têm estacionamento?"]);
    expect(v9.resumo).toBe("Pergunta livre removida: Atendem empresas fora de São Paulo?");
    expect(await result.current.acoes.removerItem(9)).toEqual({ ok: false, erro: "nao_encontrado" });
  });
});

describe("ensinar e rotear", () => {
  it("rotear acerta os exemplos do protótipo; '…?' sem campo vira livre; sem casamento, null", () => {
    expect(rotear("atendemos sábado das 9h")).toBe("horario");
    expect(rotear("Abrimos aos sábados")).toBe("horario");
    expect(rotear("Vocês atendem aos sábados?")).toBe("horario");
    expect(rotear("O plano custa R$ 99 no Pix")).toBe("preco");
    expect(rotear("Muita gente acha caro e diz que vai pensar")).toBe("objecoes");
    expect(rotear("Passar para um vendedor quando pedir reunião")).toBe("quando_passar_humano");
    expect(rotear("Sem gírias e sem emoji")).toBe("tom_voz");
    expect(rotear("Somos os únicos com garantia")).toBe("diferenciais");
    expect(rotear("Nosso público são clínicas com 20 funcionários")).toBe("cliente_ideal");
    expect(rotear("Vendemos um programa de consultoria")).toBe("empresa_oferta");
    expect(rotear("Vocês têm estacionamento?")).toBe("livre");
    expect(rotear("Vocês têm estacionamento? ")).toBe("livre");
    expect(rotear("blá blá blá")).toBeNull();
  });

  it("ensinar põe o texto no rascunho do campo certo, ou abre o item novo, ou pede para escolher", () => {
    const { result } = montar();
    act(() => {
      expect(result.current.acoes.ensinar("atendemos sábado das 9h")).toEqual({ ok: true, alvo: "horario" });
    });
    expect(situacao(result.current.estado, "horario")).toBe("nao_salvo");
    expect(situacao(result.current.estado, "horario", false)).toBe("vazio");
    expect(result.current.estado.rascunhos.horario?.extras).toEqual(["atendemos sábado das 9h."]);

    act(() => {
      expect(result.current.acoes.ensinar("Vocês têm estacionamento?")).toEqual({ ok: true, alvo: "livre" });
    });
    expect(result.current.estado.rascunhos["livre-novo"]?.pergunta).toBe("Vocês têm estacionamento?");
    expect(situacao(result.current.estado, "livre-novo")).toBe("nao_salvo");

    const antes = lerContexto();
    expect(result.current.acoes.ensinar("blá blá blá")).toEqual({ ok: true, alvo: null });
    expect(lerContexto()).toBe(antes);
    act(() => {
      expect(result.current.acoes.ensinarEm("objecoes", "blá blá blá")).toEqual({ ok: true });
    });
    expect(situacao(result.current.estado, "objecoes")).toBe("nao_salvo");
    expect(result.current.acoes.ensinar("   ")).toEqual({ ok: false, erro: "vazio" });
  });

  it("com uma pergunta nova sem salvar, ensinar outra pergunta devolve 'ocupado' e não troca nada", () => {
    const { result } = montar();
    act(() => {
      result.current.acoes.novoItem("Tem estacionamento?");
      result.current.acoes.editarItem("livre-novo", { resposta: "Sim, na rua de trás." });
    });
    const antes = lerContexto();
    expect(result.current.acoes.ensinar("Fazem entrega em domicílio?")).toEqual({ ok: false, erro: "ocupado" });
    expect(result.current.acoes.ensinarEm("livre", "Fazem entrega em domicílio?")).toEqual({ ok: false, erro: "ocupado" });
    expect(result.current.acoes.novoItem("Fazem entrega em domicílio?")).toEqual({ ok: false, erro: "ocupado" });
    expect(lerContexto()).toBe(antes);
    expect(result.current.estado.rascunhos["livre-novo"]).toEqual({
      pergunta: "Tem estacionamento?",
      resposta: "Sim, na rua de trás.",
      extras: [],
      base: 6,
    });
    // abrir o item novo sem pergunta continua valendo, e um campo continua recebendo o ensinar
    expect(result.current.acoes.novoItem()).toEqual({ ok: true });
    act(() => {
      expect(result.current.acoes.ensinar("atendemos sábado das 9h")).toEqual({ ok: true, alvo: "horario" });
    });
    // descartado o item novo, a pergunta entra
    act(() => {
      result.current.acoes.descartar("livre-novo");
    });
    act(() => {
      expect(result.current.acoes.ensinar("Fazem entrega em domicílio?")).toEqual({ ok: true, alvo: "livre" });
    });
    expect(result.current.estado.rascunhos["livre-novo"]?.pergunta).toBe("Fazem entrega em domicílio?");
  });

  it("um link na caixa vira texto comum: não há anexo nem link na v1 (11a)", () => {
    const { result } = montar();
    act(() => {
      expect(result.current.acoes.mandar("horario", "https://exemplo.com.br/horarios")).toEqual({ ok: true });
    });
    expect(result.current.estado.rascunhos.horario).toMatchObject({ extras: ["https://exemplo.com.br/horarios."] });
    expect(result.current.estado.rascunhos.horario?.anexos).toBeUndefined();
  });
});

describe("quando (America/Sao_Paulo)", () => {
  it("23:30 de 29/10 em São Paulo continua sendo 29/10, mesmo já sendo 30/10 em UTC", () => {
    const iso = "2026-10-29T23:30:00-03:00"; // 2026-10-30T02:30Z
    expect(quando(iso, "2026-10-30T09:00:00-03:00")).toBe("29/10, 23:30");
    expect(quando(iso, "2026-10-29T23:50:00-03:00")).toBe("Hoje, 23:30");
    expect(quando("2025-10-29T10:00:00-03:00", "2026-10-30T09:00:00-03:00")).toBe("29/10/2025, 10:00");
  });

  it("a versão salva às 23:30 de São Paulo aparece no dia 29/10", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T23:30:00-03:00"));
    const { result } = montar();
    act(() => {
      result.current.acoes.mandar("horario", "Abrimos aos sábados");
    });
    await act(async () => {
      await result.current.acoes.salvar("horario");
    });
    const v7 = result.current.estado.versoes[0]!;
    expect(quando(v7.criadoEm, "2026-10-29T23:45:00-03:00")).toBe("Hoje, 23:30");
    expect(quando(v7.criadoEm, "2026-10-30T08:00:00-03:00")).toBe("29/10, 23:30");
  });
});

describe("a linha do banco, o resumo e quem salvou", () => {
  it("gera a linha de contexto_versoes com itens { pergunta, resposta }", () => {
    const v6 = versoesDeExemplo()[0]!;
    const linha = paraLinhaDoBanco(v6);
    expect(Object.keys(linha).sort()).toEqual(
      [
        "empresa_oferta",
        "cliente_ideal",
        "preco",
        "diferenciais",
        "tom_voz",
        "quando_passar_humano",
        "objecoes",
        "horario",
        "itens",
        "origem",
      ].sort(),
    );
    expect(linha.origem).toBe("edicao");
    expect(linha.preco).toBe(v6.campos.preco);
    const itens = linha.itens as unknown as { pergunta: string; resposta: string }[];
    expect(itens).toEqual(v6.itens);
    for (const i of itens) expect(Object.keys(i)).toEqual(["pergunta", "resposta"]);
    expect(JSON.stringify(linha.itens)).not.toMatch(/"p"|"r"/);
  });

  it("resumoDaVersao conta campos e itens", () => {
    const [v6, v5] = versoesDeExemplo();
    expect(resumoDaVersao(v5!, v6!)).toBe("Empresa e oferta, Tom de voz e 2 perguntas livres.");
    expect(resumoDaVersao(v6!, v6!)).toBe("Sem mudanças.");
  });

  it("quem salvou: 'Você', o nome (mesmo de quem está inativo) ou 'Alguém que saiu da equipe'", () => {
    const quem = { euId: "m-eu", nomes: new Map([["m-ana", "Ana Lima"]]) };
    expect(quemSalvou("m-eu", quem)).toBe("Você");
    expect(quemSalvou("m-ana", quem)).toBe("Ana Lima");
    expect(quemSalvou(null, quem)).toBe("Alguém que saiu da equipe");
    expect(quemSalvou("m-sumiu", quem)).toBe("Alguém que saiu da equipe");
  });

  it("paraVersao lê a linha: número, itens, sem anexos e 'Restauração da versão N' pelo restaurada_de", () => {
    const linha: VersaoContextoBanco = {
      id: 41,
      numero: 9,
      empresa_oferta: "Padaria",
      cliente_ideal: "",
      preco: "R$ 10",
      diferenciais: "",
      objecoes: "",
      quando_passar_humano: "",
      tom_voz: "",
      horario: "",
      itens: [{ pergunta: "Abre domingo?", resposta: "Sim" }, { p: "formato velho" }],
      origem: "restauracao",
      criado_por: null,
      criado_em: "2026-11-01T10:00:00-03:00",
      restaurada_de: 17,
    };
    const v = paraVersao(linha, { quem: { euId: null, nomes: new Map() }, numeros: { 17: 4 } });
    expect(v).toMatchObject({ id: 41, numero: 9, restauradaDe: 4, quem: "Alguém que saiu da equipe", resumo: "Restaurada da versão 4." });
    expect(v.itens).toEqual([{ pergunta: "Abre domingo?", resposta: "Sim" }]);
    expect(contagem(v).anexos).toBe(0);
  });
});

describe("volume", () => {
  it("1.000 salvamentos seguidos em menos de 1 s", async () => {
    const { result } = montar();
    const inicio = performance.now();
    await act(async () => {
      for (let i = 0; i < 1000; i++) {
        result.current.acoes.editarTexto("preco", `Preço ${i}`);
        await result.current.acoes.salvar("preco");
      }
    });
    const ms = performance.now() - inicio;
    expect(ms).toBeLessThan(1000);
    expect(result.current.estado.versoes).toHaveLength(1006);
    expect(versaoAtual(result.current.estado)).toMatchObject({ numero: 1006, origem: "edicao" });
    expect(result.current.estado.versoes[0]!.campos.preco).toBe("Preço 999");
    expect(result.current.estado.rascunhos).toEqual({});
  });
});

describe("entrada", () => {
  it("marcarEntrada vale para a sessão (a loja sobrevive à desmontagem)", () => {
    const primeiro = montar();
    expect(primeiro.result.current.estado.jaEntrou).toBe(false);
    act(() => primeiro.result.current.acoes.marcarEntrada());
    primeiro.unmount();
    const segundo = montar();
    expect(segundo.result.current.estado.jaEntrou).toBe(true);
  });
});
