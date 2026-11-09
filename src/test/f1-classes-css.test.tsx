import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * O `estilos as Classes<"a" | "b">` dos componentes esconde erro de digitação: se uma
 * classe declarada não existir no .module.css, `s.x` vira undefined em produção, e o
 * Vitest não pega porque não processa o CSS. Este teste lê o código e o CSS do disco e
 * confere que cada classe declarada existe como seletor no arquivo importado.
 */

const PASTAS = ["../components/aipro", "../components/janete"].map((p) => path.resolve(__dirname, p));

type Declaracao = { componente: string; css: string; classes: string[] };

function declaracoes(): Declaracao[] {
  const achadas: Declaracao[] = [];
  for (const pasta of PASTAS) {
    for (const arquivo of readdirSync(pasta).filter((a) => a.endsWith(".tsx"))) {
      const codigo = readFileSync(path.join(pasta, arquivo), "utf-8");
      const importes = new Map<string, string>();
      for (const m of codigo.matchAll(/import\s+(\w+)\s+from\s+["']\.\/([\w.-]+\.module\.css)["']/g)) {
        importes.set(m[1]!, m[2]!);
      }
      for (const m of codigo.matchAll(/\b(\w+)\s+as\s+Classes<([^>]+)>/g)) {
        const css = importes.get(m[1]!);
        const classes = [...m[2]!.matchAll(/["']([\w-]+)["']/g)].map((c) => c[1]!);
        achadas.push({
          componente: arquivo,
          css: css ? path.join(pasta, css) : `(sem import de ${m[1]})`,
          classes,
        });
      }
    }
  }
  return achadas;
}

describe("classes dos CSS Modules", () => {
  const todas = declaracoes();

  it("acha as declarações Classes<> dos componentes", () => {
    expect(todas.length).toBeGreaterThan(5);
    expect(todas.some((d) => d.componente === "JaneteSimbolo.tsx")).toBe(true);
  });

  it.each(todas.map((d) => [d.componente, d] as const))(
    "%s: cada classe declarada existe no .module.css importado",
    (_nome, d) => {
      expect(d.css.endsWith(".module.css")).toBe(true);
      const css = readFileSync(d.css, "utf-8");
      const faltando = d.classes.filter(
        (classe) => !new RegExp(`\\.${classe.replace(/-/g, "\\-")}(?![\\w-])`).test(css),
      );
      expect(faltando).toEqual([]);
    },
  );
});
