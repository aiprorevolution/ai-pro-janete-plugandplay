import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Generator, getConfig } from "@tanstack/router-generator";
import { describe, expect, it } from "vitest";

// O vitest não carrega o plugin do TanStack (ele só roda no `vite dev` e no `vite build`), então
// um src/routeTree.gen.ts velho passaria despercebido nos testes. Aqui rodamos o MESMO gerador com
// a MESMA configuração do build (a padrão, com o rodapé que o TanStack Start acrescenta) e só
// COMPARAMOS: o teste não grava nada no repositório. O gerador trabalha num sistema de arquivos de
// mentira (lê do disco, nenhuma escrita sai dele), e a pasta temporária que ele pede é apagada no fim.
// Se falhar, a árvore está desatualizada: rode o build (ou o dev) para o plugin regenerá-la.
const raiz = path.resolve(__dirname, "../..");
const arquivoArvore = path.join(raiz, "src/routeTree.gen.ts");

// Igual ao que o TanStack Start monta (start-plugin-core, route-tree-footer) para src/router.tsx e src/start.ts.
const rodapeDoStart = [
  [
    "import type { getRouter } from './router.tsx'",
    "import type { startInstance } from './start.ts'",
    "declare module '@tanstack/react-start' {",
    "  interface Register {",
    "    ssr: true",
    "    router: Awaited<ReturnType<typeof getRouter>>",
    "    config: Awaited<ReturnType<typeof startInstance.getOptions>>",
    "  }",
    "}",
  ].join("\n"),
];

async function gerarArvore() {
  const escritas = new Map<string, string>();
  const statReal = (caminho: string) => {
    const s = statSync(caminho, { bigint: true });
    return { mtimeMs: s.mtimeMs, mode: Number(s.mode), uid: Number(s.uid), gid: Number(s.gid) };
  };
  const pastaTemporaria = mkdtempSync(path.join(tmpdir(), "f3-arvore-"));
  try {
    return await gerarArvoreEm(pastaTemporaria, escritas, statReal);
  } finally {
    rmSync(pastaTemporaria, { recursive: true, force: true });
  }
}

async function gerarArvoreEm(
  pastaTemporaria: string,
  escritas: Map<string, string>,
  statReal: (caminho: string) => { mtimeMs: bigint; mode: number; uid: number; gid: number },
) {
  const config = getConfig(
    {
      target: "react",
      routeTreeFileFooter: rodapeDoStart,
      tmpDir: pastaTemporaria,
    },
    raiz,
  );
  const generator = new Generator({
    config,
    root: raiz,
    fs: {
      stat: async (caminho) => (escritas.has(caminho) ? { ...statReal(arquivoArvore) } : statReal(caminho)),
      readFile: async (caminho) => {
        try {
          return {
            stat: { mtimeMs: statSync(caminho, { bigint: true }).mtimeMs },
            fileContent: readFileSync(caminho, "utf8"),
          };
        } catch {
          return "file-not-existing";
        }
      },
      writeFile: async (caminho, conteudo) => {
        escritas.set(caminho, conteudo);
      },
      rename: async (de, para) => {
        const conteudo = escritas.get(de);
        escritas.delete(de);
        if (conteudo !== undefined) escritas.set(para, conteudo);
      },
      chmod: async () => {},
      chown: async () => {},
    },
  });
  await generator.run();
  const arvoreNova = escritas.get(arquivoArvore) ?? null;
  escritas.delete(arquivoArvore);
  return { arvoreNova, outrasEscritas: [...escritas.keys()] };
}

describe("Árvore de rotas gerada", () => {
  it("o routeTree.gen.ts do repositório é o que o gerador do TanStack produz hoje (só compara, não grava)", async () => {
    const { arvoreNova, outrasEscritas } = await gerarArvore();
    const arvore = readFileSync(arquivoArvore, "utf8");

    // O gerador só reescreve um arquivo de rota quando o caminho em createFileRoute() não bate com o nome do arquivo.
    expect(outrasEscritas).toEqual([]);

    // null = o gerador achou o arquivo em dia e não quis escrever; senão, o que ele escreveria tem de ser igual.
    if (arvoreNova !== null) {
      expect(arvoreNova, "src/routeTree.gen.ts desatualizado: rode o build ou o dev para regenerar").toBe(arvore);
    }

    for (const id of [
      "/",
      "/_conta",
      "/_conta/entrar",
      "/_conta/criar-conta",
      "/onboarding",
      "/app",
      "/app/",
      "/app/chat",
      "/app/contatos",
      "/app/kanban",
      "/app/dashboard",
      "/app/equipe",
      "/app/contexto",
      "/app/configuracao",
    ]) {
      expect(arvore).toContain(`id: '${id}'`);
    }
  });
});
