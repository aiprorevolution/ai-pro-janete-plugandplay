import "@testing-library/jest-dom/vitest";
import { afterAll } from "vitest";

import { limparTemporizadoresPendentes, vigiarTemporizadores } from "./temporizadores";

// Os testes do banco rodam com `// @vitest-environment node`, sem window: só imita o
// navegador quando ele existe.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: () => {},
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // Os temporizadores das telas que ninguém limpou não disparam depois de o jsdom do arquivo sair
  // (ver temporizadores.ts). O afterAll do setup roda depois dos afterAll do arquivo.
  vigiarTemporizadores();
  afterAll(() => {
    limparTemporizadoresPendentes();
  });
}
