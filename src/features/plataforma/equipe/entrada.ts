/** A UI lê claims somente para apresentar o formulário. O servidor valida o token real. */
export type ClaimsSessao = { email?: unknown; email_verified?: unknown; firebase?: { sign_in_provider?: string }; amr?: unknown };
export function entrouPorLinkDoEmail(claims: ClaimsSessao | null | undefined): boolean {
  return claims?.email_verified === true && typeof claims.email === 'string';
}
export function claimsDoToken(token: string | null | undefined): ClaimsSessao | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base = part.replace(/-/g, '+').replace(/_/g, '/');
    const text = atob(base + '='.repeat((4 - base.length % 4) % 4));
    const value: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(text, c => c.charCodeAt(0))));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ClaimsSessao : null;
  } catch { return null; }
}
