// Copiar para a área de transferência um texto que ainda vai chegar do servidor (o link do convite,
// o verify token da Meta). O Safari (e todo navegador no iPhone) só deixa copiar dentro do clique:
// depois de esperar a resposta do servidor, a permissão já acabou e o writeText é recusado sempre.
// O jeito que ele aceita é chamar `navigator.clipboard.write` ainda dentro do clique, com um
// ClipboardItem cujo conteúdo é a promessa do texto. Por isso esta função tem de ser chamada de
// forma síncrona no clique, antes de qualquer `await`.

/** O resultado da cópia: `copiado` só quando o navegador confirmou. Sem o texto, `texto` é null. */
export type ResultadoCopia = { copiado: true; texto: string } | { copiado: false; texto: string | null };

type ComClipboard = Pick<Clipboard, "writeText"> & Partial<Pick<Clipboard, "write">>;

function areaDeTransferencia(): ComClipboard | null {
  if (typeof navigator === "undefined") return null;
  return (navigator.clipboard as ComClipboard | undefined) ?? null;
}

/**
 * Copia o texto da promessa. Chame dentro do clique, sem `await` antes. `texto` pode resolver com
 * null (o servidor recusou): aí nada é copiado e o resultado vem com `texto: null`. Nunca lança.
 */
export function copiarQuandoChegar(texto: Promise<string | null>): Promise<ResultadoCopia> {
  const area = areaDeTransferencia();
  // Para a promessa recusada não virar "unhandled rejection" enquanto ninguém espera por ela.
  const valor = texto.then(
    (t) => (t ? t : null),
    () => null,
  );
  const comItem =
    area && typeof area.write === "function" && typeof ClipboardItem !== "undefined"
      ? (() => {
          try {
            const blob = valor.then((t) => {
              if (!t) throw new Error("sem texto");
              return new Blob([t], { type: "text/plain" });
            });
            return area.write!([new ClipboardItem({ "text/plain": blob })]);
          } catch (e) {
            return Promise.reject(e);
          }
        })()
      : null;

  return (async (): Promise<ResultadoCopia> => {
    const t = await valor;
    if (comItem) {
      const ok = await comItem.then(
        () => true,
        () => false,
      );
      if (!t) return { copiado: false, texto: null };
      if (ok) return { copiado: true, texto: t };
    }
    if (!t) return { copiado: false, texto: null };
    // Sem ClipboardItem (ou ele recusou): o writeText, que o Chrome e o Firefox aceitam depois de esperar.
    if (!area) return { copiado: false, texto: t };
    try {
      await area.writeText(t);
      return { copiado: true, texto: t };
    } catch {
      return { copiado: false, texto: t };
    }
  })();
}
