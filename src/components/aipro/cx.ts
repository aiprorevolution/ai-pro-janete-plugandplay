/** Junta classes ignorando vazios. `className` do consumidor entra sempre por último. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Tipo das classes de um CSS Module. O `vite/client` declara o módulo como índice
 * (`{ [classe: string]: string }`) e o tsconfig deste projeto liga
 * `noPropertyAccessFromIndexSignature`; cada componente declara as classes que usa
 * e lê `s.botao` em vez de `s["botao"]`.
 */
export type Classes<K extends string> = Readonly<Record<K, string>>;
