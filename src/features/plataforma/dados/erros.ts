import type { Erro } from "./tipos";

// O tradutor de erros comum (spec 2.1, erros.ts): as recusas do banco, do PostgREST, do Storage e
// das funções de servidor viram um `Erro` da tela, que cada área já sabe escrever. Nunca lança.
//
//   P0001 (raise do banco)  → o código da mensagem (lista em CODIGOS_DO_BANCO)
//   42501 (sem permissão)   → sem_acesso
//   23505 (único repetido)  → email_em_uso
//   23514 (check)           → nome_vazio (o check do nome) ou limite_tamanho (os outros checks)
//   22P02 (uuid inválido)   → nao_encontrado
//   PGRST116 (.single vazio) e UPDATE com 0 linhas (SemLinhas) → nao_encontrado
//   rede ou desconhecido    → falha, com o texto cru no `detalhe`

/**
 * Os códigos que o banco levanta com P0001 (spec 2.3, "Códigos P0001") e o `Erro` de cada um.
 * Os que a tela não trata viram `falha`, com o código no `detalhe`.
 */
export const CODIGOS_DO_BANCO: Readonly<Record<string, Erro>> = {
  // novos do pacote do banco (migrations 0006 a 0009)
  etapa_travada: "sem_permissao", // só a Janete recebe; se chegar à tela, é uma recusa de permissão
  nao_reenviavel: "nao_reenviavel",
  proprio_membro: "proprio_membro",
  contexto_mudou: "contexto_mudou",
  limite_tamanho: "limite_tamanho",
  limite_itens: "limite_itens", // contexto_salvar com mais de 50 perguntas livres
  // os de hoje
  sem_acesso: "sem_acesso",
  etapa_arquivada: "etapa_arquivada",
  etapa_com_leads: "etapa_com_leads",
  sem_etapa_de_entrada: "sem_etapa_de_entrada",
  sem_conexao_ativa: "sem_conexao_ativa",
  janela_fechada: "janela_fechada",
  ultimo_admin: "ultimo_admin",
  conversa_nao_encontrada: "nao_encontrado",
  nao_encontrado: "nao_encontrado",
  // os que as funções novas também levantam
  sem_permissao: "sem_permissao",
  mensagem_nao_encontrada: "nao_encontrado",
  // os das funções de servidor (devolvidos em { ok: false, erro })
  email_invalido: "email_invalido",
  email_em_uso: "email_em_uso",
  nome_vazio: "nome_vazio",
};

/** O UPDATE (ou DELETE) que não atingiu nenhuma linha: sob RLS, não dá erro, mas é falha. */
export class SemLinhas extends Error {
  constructor(tabela?: string) {
    super(tabela ? `nenhuma linha alterada em ${tabela}` : "nenhuma linha alterada");
    this.name = "SemLinhas";
  }
}

/**
 * Confere a resposta de um UPDATE com `.select("id")`: erro do banco sobe como veio; 0 linhas sobe
 * como `SemLinhas`. Use dentro de um try/catch que passa por `traduzirErro`.
 */
export function exigirLinhas<T>(resposta: { data: T[] | null; error: unknown }, tabela?: string): T[] {
  if (resposta.error) throw resposta.error;
  if (!resposta.data || resposta.data.length === 0) throw new SemLinhas(tabela);
  return resposta.data;
}

const ERROS_CONHECIDOS = new Set<string>(Object.values(CODIGOS_DO_BANCO).concat(["falha"]));

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function textoCru(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const msg = texto(o["message"]) ?? texto(o["mensagem"]) ?? texto(o["details"]) ?? texto(o["erro"]);
    if (msg) return msg;
  }
  try {
    return String(e);
  } catch {
    return "erro desconhecido";
  }
}

/** Traduz qualquer erro (PostgrestError, StorageError, Error, resultado de função de servidor) num `Erro`. */
export function traduzirErro(e: unknown): { erro: Erro; detalhe?: string } {
  if (e instanceof SemLinhas) return { erro: "nao_encontrado", detalhe: e.message };
  if (e === null || e === undefined) return { erro: "falha", detalhe: "erro desconhecido" };

  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const codigo = texto(o["code"]);
    const mensagem = texto(o["message"]) ?? "";

    switch (codigo) {
      case "P0001": {
        const traduzido = CODIGOS_DO_BANCO[mensagem.trim()];
        return traduzido ? { erro: traduzido } : com("falha", mensagem || textoCru(e));
      }
      case "42501":
        return { erro: "sem_acesso" };
      case "23505":
        return { erro: "email_em_uso" };
      case "23514": {
        const onde = `${mensagem} ${texto(o["details"]) ?? ""}`;
        // O check do nome (`btrim(nome) <> ''`, ex.: etapas_nome_check) é o nome vazio; os outros
        // (ritmo, duração, tamanho) são um valor fora do limite.
        return /_nome_check|nome_vazio/.test(onde)
          ? { erro: "nome_vazio" }
          : com("limite_tamanho", mensagem);
      }
      case "22P02":
        return { erro: "nao_encontrado" };
      case "PGRST116":
        return { erro: "nao_encontrado" };
      default:
        break;
    }

    // O resultado de uma função de servidor: { ok: false, erro: "email_em_uso" }.
    const erro = texto(o["erro"]);
    if (erro && ERROS_CONHECIDOS.has(erro)) {
      return com(erro as Erro, texto(o["mensagem"]) ?? texto(o["detalhe"]));
    }
  }

  // Rede (TypeError: Failed to fetch), Storage, Error comum ou qualquer outra coisa.
  return com("falha", textoCru(e));
}

function com(erro: Erro, detalhe?: string): { erro: Erro; detalhe?: string } {
  return detalhe ? { erro, detalhe } : { erro };
}

/** Atalho para as ações: o `Resultado` recusado de um erro qualquer. */
export function recusado(e: unknown): { ok: false; erro: Erro; detalhe?: string } {
  const { erro, detalhe } = traduzirErro(e);
  return detalhe === undefined ? { ok: false, erro } : { ok: false, erro, detalhe };
}
