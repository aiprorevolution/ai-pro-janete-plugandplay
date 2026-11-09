/**
 * Iniciais a partir do NOME: derivação, não invenção. "Ana Ribeiro" vira "AR";
 * uma palavra só vira as duas primeiras letras.
 */
export function iniciais(nome: string): string {
  const palavras = nome.split(/[\s.-]+/).filter(Boolean);
  if (palavras.length === 0) return "?";
  if (palavras.length === 1) return palavras[0]!.slice(0, 2).toUpperCase();
  return (palavras[0]![0]! + palavras[1]![0]!).toUpperCase();
}
