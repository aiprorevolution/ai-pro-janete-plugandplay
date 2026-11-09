/** Prévia e loopback servem para configuração; o webhook usa a URL estável publicada. */
export function ehOrigemDePrevia(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "[::1]" || /^127\./.test(hostname) ||
      /^ais-dev-/.test(hostname) || hostname.endsWith(".cloudworkstations.dev") ||
      hostname.endsWith(".googleusercontent.com");
  } catch { return true; }
}
