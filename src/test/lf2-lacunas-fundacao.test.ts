import { describe, expect, expectTypeOf, it } from "vitest";

import { adaptadorMeta } from "@/features/mensageria/gateways/meta";
import { adaptadorZapi } from "@/features/mensageria/gateways/zapi";
import type { AdaptadorGateway, ConexaoServidor } from "@/features/mensageria/nucleo/tipos";
import { textoDoErro } from "@/features/plataforma/contexto/Editor";
import { camposFracos, erroDaTela, LIMITE_CAMPO_FRACO } from "@/features/plataforma/contexto/regras";
import { CAMPOS, type ChaveCampo, type VersaoContexto } from "@/features/plataforma/contexto/tipos";
import { CAMPOS_TEXTO_CONTEXTO } from "@/features/plataforma/dados/contexto";
import { CODIGOS_DO_BANCO, recusado, traduzirErro } from "@/features/plataforma/dados/erros";
import type { VersaoContextoBanco } from "@/features/plataforma/dados/tipos";

// F2 da spec das lacunas da mensageria (docs/spec-lacunas-mensageria.md, 2.2 e 2.3): os contratos
// da fundação. O desligarWebhook no adaptador, o código limite_itens do contexto_salvar e a regra
// pura camposFracos.

describe("AdaptadorGateway.desligarWebhook (2.2)", () => {
  it("é opcional e recebe só a conexão", () => {
    expectTypeOf<AdaptadorGateway["desligarWebhook"]>().toEqualTypeOf<((c: ConexaoServidor) => Promise<void>) | undefined>();
  });

  it("Meta e Z-API não têm (a API não permite; a tela lembra do painel)", () => {
    expect(adaptadorMeta.desligarWebhook).toBeUndefined();
    expect(adaptadorZapi.desligarWebhook).toBeUndefined();
  });
});

describe("limite_itens (2.3): do P0001 do contexto_salvar até a tela do Contexto", () => {
  const p0001 = { code: "P0001", message: "limite_itens", details: null, hint: null };

  it("está no mapa dos códigos do banco", () => {
    expect(CODIGOS_DO_BANCO["limite_itens"]).toBe("limite_itens");
  });

  it("o P0001 vira o Erro limite_itens, sem detalhe (não cai em falha)", () => {
    expect(traduzirErro(p0001)).toEqual({ erro: "limite_itens" });
    expect(recusado(p0001)).toEqual({ ok: false, erro: "limite_itens" });
  });

  it("com espaço em volta da mensagem, o mesmo código", () => {
    expect(traduzirErro({ ...p0001, message: " limite_itens " }).erro).toBe("limite_itens");
  });

  it("o resultado de função de servidor { ok: false, erro: 'limite_itens' } também é reconhecido", () => {
    expect(traduzirErro({ ok: false, erro: "limite_itens" }).erro).toBe("limite_itens");
  });

  it("a tela do Contexto recebe o mesmo código (como o limite_tamanho)", () => {
    expect(erroDaTela("limite_itens")).toBe("limite_itens");
    expect(erroDaTela("limite_tamanho")).toBe("limite_tamanho");
  });

  it("o texto é o da spec 2.3, diferente do limite_tamanho", () => {
    expect(textoDoErro("limite_itens")).toBe("O Contexto já tem 50 perguntas livres. Apague uma para criar outra.");
    expect(textoDoErro("limite_itens")).not.toBe(textoDoErro("limite_tamanho"));
  });
});

describe("camposFracos (decisão 7)", () => {
  const ORDEM = CAMPOS.map((c) => c.chave);
  const BOM = "Vendemos pão artesanal todo dia."; // bem mais de 20 letras

  function versao(campos: Partial<Record<ChaveCampo, string>> = {}): Pick<VersaoContexto, "campos"> {
    const todos = {} as Record<ChaveCampo, string>;
    for (const c of ORDEM) todos[c] = campos[c] ?? BOM;
    return { campos: todos };
  }

  it("o limite é 20 letras", () => {
    expect(LIMITE_CAMPO_FRACO).toBe(20);
  });

  it("todos bons: nenhum fraco", () => {
    expect(camposFracos(versao())).toEqual([]);
  });

  it("todos vazios: os 8, na ordem da tela", () => {
    const vazios = Object.fromEntries(ORDEM.map((c) => [c, ""])) as Record<ChaveCampo, string>;
    expect(camposFracos({ campos: vazios })).toEqual(ORDEM);
    expect(camposFracos({ campos: vazios })).toHaveLength(8);
  });

  it("sem versão (null, o Contexto não tem nenhuma): os 8", () => {
    expect(camposFracos(null)).toEqual(ORDEM);
  });

  it("ainda não se sabe (undefined, carregando ou leitura que falhou): nenhum", () => {
    expect(camposFracos(undefined)).toEqual([]);
  });

  it("aceita a linha do banco direto (VersaoContextoBanco), com campo nulo contando como vazio", () => {
    const linha: VersaoContextoBanco = {
      id: 7,
      numero: 3,
      empresa_oferta: BOM,
      cliente_ideal: BOM,
      preco: BOM,
      diferenciais: "curto",
      objecoes: BOM,
      quando_passar_humano: BOM,
      tom_voz: BOM,
      horario: BOM,
      itens: [],
      origem: "edicao",
      criado_por: null,
      criado_em: "2026-11-01T10:00:00-03:00",
      restaurada_de: null,
    };
    expect(camposFracos(linha)).toEqual(["diferenciais"]);
    // a coluna é string no types.ts, mas a regra aguenta nulo (como o paraVersao, com `?? ""`)
    const comNulo = { ...linha, horario: null } as unknown as VersaoContextoBanco;
    expect(camposFracos(comNulo)).toEqual(["diferenciais", "horario"]);
    // os textos soltos, sem o resto da linha, também servem
    expect(camposFracos({ ...Object.fromEntries(ORDEM.map((c) => [c, BOM])), tom_voz: null })).toEqual(["tom_voz"]);
  });

  it("a linha do banco e a versão da tela montada dela dão o mesmo resultado", () => {
    const textos = { empresa_oferta: "x", cliente_ideal: BOM, preco: BOM, diferenciais: "", objecoes: "", quando_passar_humano: "oi", tom_voz: "", horario: BOM };
    expect(camposFracos(textos)).toEqual(camposFracos({ campos: textos }));
    expect(camposFracos(textos)).toEqual(["empresa_oferta", "diferenciais", "tom_voz", "quando_passar_humano", "objecoes"]);
  });

  it("19 letras é fraco; 20 já não é", () => {
    expect(camposFracos(versao({ cliente_ideal: "a".repeat(19) }))).toEqual(["cliente_ideal"]);
    expect(camposFracos(versao({ cliente_ideal: "a".repeat(20) }))).toEqual([]);
  });

  it("espaços não contam: 19 letras espalhadas entre espaços e quebras de linha é fraco", () => {
    const espalhado = "  abc d\tfgh\n ijk lmn opq rst  "; // 19 letras, muitos espaços
    expect(espalhado.length).toBeGreaterThan(20);
    expect(camposFracos(versao({ objecoes: espalhado }))).toEqual(["objecoes"]);
    expect(camposFracos(versao({ objecoes: `${espalhado}u` }))).toEqual([]);
  });

  it("só espaços conta como vazio", () => {
    expect(camposFracos(versao({ tom_voz: "      \n\t   ".repeat(5) }))).toEqual(["tom_voz"]);
  });

  it("pontuação e números contam como letras (só o espaço sai)", () => {
    expect(camposFracos(versao({ empresa_oferta: "R$ 1.990,00 à vista!" }))).toEqual(["empresa_oferta"]); // 18 sem espaço
    expect(camposFracos(versao({ empresa_oferta: "R$ 1.990,00 à vista ou 12x" }))).toEqual([]);
  });

  describe("Horário, Preço e Tom de voz: só o vazio é fraco (decisão 12)", () => {
    it("curtos não são fracos: horário \"24h\", preço \"R$ 97\" e tom \"Informal\"", () => {
      expect(camposFracos(versao({ horario: "24h", preco: "R$ 97", tom_voz: "Informal" }))).toEqual([]);
      expect(camposFracos(versao({ horario: "x", preco: "1", tom_voz: "😀" }))).toEqual([]);
    });

    it("vazios, nulos, que faltam ou só com espaços são fracos", () => {
      expect(camposFracos(versao({ horario: "", preco: "", tom_voz: "" }))).toEqual(["preco", "tom_voz", "horario"]);
      expect(camposFracos(versao({ horario: " \n\t ", preco: "   ", tom_voz: "\n" }))).toEqual(["preco", "tom_voz", "horario"]);
      const v = versao();
      delete (v.campos as Partial<Record<ChaveCampo, string>>).preco;
      expect(camposFracos(v)).toEqual(["preco"]);
      expect(camposFracos({ ...Object.fromEntries(ORDEM.map((c) => [c, BOM])), horario: null })).toEqual(["horario"]);
    });

    it("os outros 5 continuam com as 20 letras, mesmo com o mesmo texto curto", () => {
      const curtos = { empresa_oferta: "24h", cliente_ideal: "R$ 97", diferenciais: "Informal", quando_passar_humano: "24h", objecoes: "R$ 97" };
      expect(camposFracos(versao(curtos))).toEqual(["empresa_oferta", "cliente_ideal", "diferenciais", "quando_passar_humano", "objecoes"]);
      // e os 3 com o mesmo texto curto, ao lado, não entram
      expect(camposFracos(versao({ ...curtos, horario: "24h", preco: "R$ 97", tom_voz: "Informal" }))).toHaveLength(5);
    });
  });

  it("o emoji vale 1 letra, como no banco (char_length)", () => {
    expect(camposFracos(versao({ diferenciais: "😀".repeat(19) }))).toEqual(["diferenciais"]);
    expect(camposFracos(versao({ diferenciais: "😀".repeat(20) }))).toEqual([]);
  });

  it("a ordem segue a tela (CAMPOS), não a ordem em que o objeto foi montado", () => {
    // tom_voz e objecoes trocam de ordem entre CAMPOS (tela: tom_voz antes) e CAMPOS_TEXTO_CONTEXTO
    // (banco e paraVersao: objecoes antes); o objeto é montado nas ordens que não são a da tela.
    const fraco = (c: ChaveCampo) => (c === "tom_voz" || c === "objecoes" || c === "cliente_ideal" ? "" : BOM);
    const naOrdemDoBanco = Object.fromEntries(CAMPOS_TEXTO_CONTEXTO.map((c) => [c, fraco(c)])) as Record<ChaveCampo, string>;
    const invertido = Object.fromEntries([...ORDEM].reverse().map((c) => [c, fraco(c)])) as Record<ChaveCampo, string>;
    expect(Object.keys(naOrdemDoBanco).indexOf("objecoes")).toBeLessThan(Object.keys(naOrdemDoBanco).indexOf("tom_voz"));
    expect(Object.keys(invertido)[0]).toBe("horario");

    const esperado: ChaveCampo[] = ["cliente_ideal", "tom_voz", "objecoes"];
    expect(camposFracos({ campos: naOrdemDoBanco })).toEqual(esperado);
    expect(camposFracos({ campos: invertido })).toEqual(esperado);
    expect(camposFracos(naOrdemDoBanco)).toEqual(esperado);
  });

  it("campo que falta no objeto conta como vazio", () => {
    const v = versao();
    delete (v.campos as Partial<Record<ChaveCampo, string>>).objecoes;
    expect(camposFracos(v)).toEqual(["objecoes"]);
  });
});
