import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { COLUNAS_CONFIGURACAO, COLUNAS_CONTATO, COLUNAS_CONTEXTO, COLUNAS_CONVERSA, COLUNAS_MEMBRO, COLUNAS_MENSAGEM } from "@/features/plataforma/dados";

// Depois do pacote do banco (migrations 0004 a 0010 e o types.ts regerado), as pendências marcadas
// "M2" no front acabaram: nenhuma marca sobrando, nenhuma rpc sem tipo e as colunas novas nas listas.

const SRC = path.resolve(__dirname, "..");

function arquivosDe(pasta: string): string[] {
  const todos: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = path.join(pasta, nome);
    if (statSync(caminho).isDirectory()) todos.push(...arquivosDe(caminho));
    else if (/\.(ts|tsx)$/.test(nome)) todos.push(caminho);
  }
  return todos;
}

const ARQUIVOS = [
  ...arquivosDe(path.join(SRC, "features/plataforma/dados")),
  ...["Bolha", "EventoConversa", "CaixaEscrever"].map((n) => path.join(SRC, `features/plataforma/comum/${n}.tsx`)),
  ...["Layout.tsx", "tour.ts", "PainelJanete.tsx", "papel.tsx", "conta.tsx"].map((n) => path.join(SRC, `features/plataforma/${n}`)),
  ...["-sessao.ts", "index.tsx", "app.tsx", "onboarding.tsx", "sem-acesso.tsx"].map((n) => path.join(SRC, `routes/${n}`)),
];

describe("as pendências M2 do front", () => {
  it.each(ARQUIVOS.map((a) => [path.relative(SRC, a), a]))("%s: nenhuma marca M2 sobrando", (_nome, arquivo) => {
    const codigo = readFileSync(arquivo, "utf-8");
    // "M2 12a10..." é caminho de SVG (o ícone de status), não marca de pendência
    const marcas = codigo.split("\n").filter((linha) => /\bM2\b(?! \d)/.test(linha));
    expect(marcas).toEqual([]);
  });

  it("as rpcs do pacote vão tipadas, sem o atalho rpcM2 nem cast do cliente", () => {
    const provedor = readFileSync(path.join(SRC, "features/plataforma/dados/ProvedorDados.tsx"), "utf-8");
    expect(provedor).not.toMatch(/rpcM2|RpcSolta|rpc\.bind/);
    for (const nome of ["reenviar_mensagem", "reordenar_etapas", "marcar_visto"]) {
      expect(provedor).toContain(`cliente.rpc("${nome}"`);
    }
  });

  it("o tour é por pessoa e a guarda não lê mais o marcador da aba", () => {
    const tour = readFileSync(path.join(SRC, "features/plataforma/tour.ts"), "utf-8");
    expect(tour).toMatch(/export const TOUR_POR_PESSOA = true;/);
    const sessao = readFileSync(path.join(SRC, "routes/-sessao.ts"), "utf-8");
    expect(sessao).not.toMatch(/onboardingConcluido\(|features\/onboarding\/estado/);
  });

  it("as colunas novas estão nas listas", () => {
    const tem = (lista: string, colunas: string[]) => expect(lista.split(", ")).toEqual(expect.arrayContaining(colunas));
    tem(COLUNAS_MEMBRO, ["vistos"]);
    // e a voz em uso (spec-voz-uso, migration 0014): sem elas, a tela salva e nunca relê o salvo
    tem(COLUNAS_CONFIGURACAO, ["worker_visto_em", "voz_resposta", "voz_id", "voz_nome", "voz_erro"]);
    tem(COLUNAS_CONTEXTO, ["numero", "restaurada_de"]);
    tem(COLUNAS_CONVERSA, ["ultima_mensagem_id", "ultima_da_janete_em"]);
    tem(COLUNAS_MENSAGEM, ["responde_a_id", "midia_duracao_s", "id_externo", "id_gateway"]);
    tem(COLUNAS_CONTATO, ["resumo_janete_em", "anotacoes_janete"]);
  });
});
