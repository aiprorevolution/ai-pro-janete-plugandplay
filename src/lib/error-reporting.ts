/** Registro local mínimo; não transmite telemetria ou conteúdo para terceiros. */
export function reportAppError(_error: unknown, context: { boundary?: string } = {}) {
  if (typeof window !== 'undefined') console.warn('AI PRO Janete: falha na interface.', context.boundary ?? 'interface');
}
