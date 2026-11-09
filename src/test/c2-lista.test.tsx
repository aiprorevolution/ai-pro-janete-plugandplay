import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GIRO_IA_MS, GIRO_WHATSAPP_MS, camposLargos, esperaAteParada, separarMensagem } from "@/features/onboarding/lista";

const PASTA = path.resolve(__dirname, "../features/onboarding/lista");

describe("lista: classes do CSS Module", () => {
  it("cada classe declarada em estilos.ts existe no Lista.module.css", () => {
    const codigo = readFileSync(path.join(PASTA, "estilos.ts"), "utf-8");
    const css = readFileSync(path.join(PASTA, "Lista.module.css"), "utf-8");
    const declaradas = [...(codigo.match(/Classes<([\s\S]+?)>/)?.[1] ?? "").matchAll(/"([\w-]+)"/g)].map((m) => m[1]!);
    expect(declaradas.length).toBeGreaterThan(50);
    const faltando = declaradas.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(faltando).toEqual([]);
  });
});

describe("lista: celular (até 599 px), como o F", () => {
  it("o bloco de 599 px tem as regras do F para a linha de modelo, o cabeçalho do painel e o valor gerado", () => {
    const css = readFileSync(path.join(PASTA, "Lista.module.css"), "utf-8");
    const inicio = css.indexOf("@media (max-width: 599px)");
    expect(inicio).toBeGreaterThan(-1);
    const bloco = css.slice(inicio, css.indexOf("@media (prefers-reduced-motion", inicio));
    const compacto = bloco.replace(/\s+/g, " ");
    expect(compacto).toContain(".painelCab { grid-template-columns: auto minmax(0, 1fr); row-gap: 8px; }");
    expect(compacto).toContain(".painelCab .btnC { grid-column: 1 / -1; justify-self: start; }");
    expect(compacto).toContain(".gerado { grid-template-columns: minmax(0, 1fr); }");
    expect(compacto).toContain(".linhaResumo.pe .miniLogos { display: none; }");
  });
  it("o modelo tem o preço sob o nome em qualquer largura (cabe em 2 colunas e no celular)", () => {
    const css = readFileSync(path.join(PASTA, "Lista.module.css"), "utf-8").replace(/\s+/g, " ");
    expect(css).toMatch(/\.modelo \{ display: grid; grid-template-columns: 20px minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.mdPreco \{ grid-column: 2;/);
  });
  it("no desdobrar do cérebro a seção não reaparece do zero", () => {
    const css = readFileSync(path.join(PASTA, "Lista.module.css"), "utf-8").replace(/\s+/g, " ");
    expect(css).toContain(".secao.desdobrando { animation: none; }");
  });
});

describe("lista: 2 colunas quando o painel tem largura (1a e 2b)", () => {
  it("o painel é um contêiner e, largo, põe os campos e os modelos em 2 colunas", () => {
    const css = readFileSync(path.join(PASTA, "Lista.module.css"), "utf-8");
    expect(css.replace(/\s+/g, " ")).toMatch(/\.painel \{[^}]*container-type: inline-size;/);
    const inicio = css.indexOf("@container (min-width: 32rem)");
    expect(inicio).toBeGreaterThan(-1);
    const bloco = css.slice(inicio, css.indexOf("\n}\n", inicio)).replace(/\s+/g, " ");
    expect(bloco).toContain(".camposGrade { grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(bloco).toContain(".camposGrade > .campoLargo { grid-column: 1 / -1; }");
    expect(bloco).toContain(".modelos.duasColunas { grid-template-columns: repeat(2, minmax(0, 1fr));");
  });
});

describe("lista: placeholder longo em 2 colunas", () => {
  it("o campo da grade termina o placeholder em reticências, não no meio da palavra", () => {
    const css = readFileSync(path.join(PASTA, "Lista.module.css"), "utf-8").replace(/\s+/g, " ");
    expect(css).toContain(".camposGrade input { text-overflow: ellipsis; }");
  });
});

describe("lista: campos largos", () => {
  it("o largo e o último de cada trecho ímpar ocupam a linha inteira", () => {
    const c = (id: string, largo = false) => ({ id, label: id, ph: "", largo });
    expect([...camposLargos([c("a"), c("b"), c("c"), c("d")])]).toEqual([]);
    expect([...camposLargos([c("a"), c("b"), c("c")])]).toEqual(["c"]);
    expect([...camposLargos([c("url", true), c("b"), c("c")])]).toEqual(["url"]);
    expect([...camposLargos([c("a"), c("url", true), c("b"), c("c")])]).toEqual(["a", "url"]);
    expect([...camposLargos([c("a")])]).toEqual(["a"]);
  });
});

describe("lista: nada sai do lugar (5a e 5b)", () => {
  it("Mostrar e Ocultar têm a mesma largura; o disco do palco sai de cena durante a fusão", () => {
    const css = readFileSync(path.join(PASTA, "Lista.module.css"), "utf-8").replace(/\s+/g, " ");
    expect(css).toMatch(/\.olhar \{[^}]*min-width: 5\.5rem;/);
    expect(css).toContain(".val[data-fusao] .disco { visibility: hidden; }");
    // a mira cobre do topo do disco ao fim do texto, sem passar do fim do cartão; começa mais acima
    // pela altura da barra de etapas, para "inteira na tela" valer só com o disco abaixo da barra
    expect(css).toMatch(
      /\.discoMira \{[^}]*top: calc\(10\.5rem - 76px - var\(--onb-nav-h, 4\.5rem\)\); bottom: 0;[^}]*max-height: calc\(27rem \+ var\(--onb-nav-h, 4\.5rem\)\);/,
    );
    // o foco que rola até o cartão desconta a barra de etapas (mais alta no celular)
    expect(css).toMatch(/\.lista \{[^}]*scroll-margin-top: calc\(var\(--onb-nav-h, 4\.5rem\) \+ 16px\);/);
    // o círculo de onde o cartão da conexão nasce: 96 px, centro a 72 px do topo
    expect(css).toMatch(/\.nasceMira \{[^}]*top: 24px; width: 96px; height: 96px;/);
  });
});

describe("lista: tempo da moeda", () => {
  it("as durações mínimas do F terminam com a moeda parada de frente", () => {
    expect(esperaAteParada(GIRO_WHATSAPP_MS)).toBe(0);
    expect(esperaAteParada(GIRO_IA_MS)).toBe(0);
  });

  it("resposta atrasada espera o próximo trecho parado", () => {
    // 4000 ms = 3 voltas + 700: já parada
    expect(esperaAteParada(4000)).toBe(0);
    // 3500 ms = 3 voltas + 200: espera até 760 da volta
    expect(esperaAteParada(3500)).toBe(560);
    // 4280 = 3 voltas + 980 (parada); 4360 = + 1060 (parada); 4380 = + 1080 (parada)
    expect(esperaAteParada(4380)).toBe(0);
    // 4460 = 4 voltas + 60: espera 700
    expect(esperaAteParada(4460)).toBe(700);
  });
});

describe("lista: mensagem da função em título e texto", () => {
  it("separa a primeira frase", () => {
    expect(separarMensagem("A Meta não aceitou o token. Ele pode ter expirado.")).toEqual({
      titulo: "A Meta não aceitou o token.",
      texto: "Ele pode ter expirado.",
    });
  });
  it("frase única vira só título; ponto dentro de URL não corta", () => {
    expect(separarMensagem("Informe a URL do seu servidor Evolution.")).toEqual({
      titulo: "Informe a URL do seu servidor Evolution.",
      texto: "",
    });
    expect(separarMensagem("Use https://evolution.empresa.com.br como exemplo. Depois tente.").titulo).toBe(
      "Use https://evolution.empresa.com.br como exemplo.",
    );
  });
});
