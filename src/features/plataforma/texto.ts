import type { Respostas } from "@/features/onboarding/estado";

// Auxiliares de texto do F (curto, minusc) e o que a plataforma e o preparo derivam das respostas
// do onboarding. Nada aqui inventa dado: sem resposta, devolve vazio e a tela não mostra.

/** Corta em `n` caracteres com reticências, como o `curto` do F. */
export function curto(texto: string | null | undefined, n: number): string {
  const s = String(texto ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** Primeira letra minúscula, como o `minusc` do F. */
export function minusc(texto: string | null | undefined): string {
  const s = String(texto ?? "").trim();
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** Tira a pontuação e os espaços do fim ("Próximo e direto." vira "Próximo e direto"). */
export function semPontoFinal(texto: string): string {
  return texto.replace(/[.!?…\s]+$/, "");
}

const LIMITE_NOME_EMPRESA = 40;

/**
 * O nome da empresa, tirado da 1ª resposta do roteiro ("como se chama a sua empresa e o que vocês
 * vendem?"): o trecho antes do primeiro ponto, vírgula, dois-pontos ou travessão. Se a resposta não
 * tiver um trecho curto assim (mais de 40 caracteres), devolve null e a tela não mostra empresa.
 */
export function nomeDaEmpresa(respostas: Respostas): string | null {
  const bruto = (respostas.empresa_oferta ?? "").trim();
  if (!bruto) return null;
  const primeiro = bruto.split(/[.,;:!?](?:\s|$)|\s[-–—]\s|\n/)[0] ?? "";
  const nome = semPontoFinal(primeiro.trim());
  if (!nome || nome.length > LIMITE_NOME_EMPRESA) return null;
  return nome;
}

/** "Operador Teste" → "equipe". Vazio quando não há nome. */
export function primeiroNome(nome: string): string {
  const limpo = nome.trim();
  return limpo ? (limpo.split(/\s+/)[0] ?? "") : "";
}

/** Iniciais como no F: duas primeiras palavras; sem nome, "VC" (de "Você"). */
export function iniciaisDe(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) return "VC";
  return limpo
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}
