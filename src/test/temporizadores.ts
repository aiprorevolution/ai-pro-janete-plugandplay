// Os temporizadores (setTimeout e setInterval) que um arquivo de teste deixa pendentes. Telas como o
// Historico, o Ensinar e o esperarElemento do VooJanete pedem foco com setTimeout e não limpam ao
// fechar: no navegador isso não faz mal, mas no teste o temporizador disparava depois de o jsdom do
// arquivo sair e derrubava a suíte com "ReferenceError: document is not defined" (mesmo com todos os
// testes passando). O setup.ts liga a vigia e limpa o que sobrou no fim de cada arquivo.
// Com vi.useFakeTimers os temporizadores vão para o relógio falso e não passam por aqui; ao voltar
// (vi.useRealTimers) o relógio falso devolve as funções vigiadas.

type Alca = ReturnType<typeof setTimeout>;
type Tipo = "espera" | "intervalo";
type Agendar = (fn: unknown, ms?: number, ...args: unknown[]) => Alca;
type Limpar = (alca?: Alca) => void;

interface Vigia {
  pendentes: Map<Alca, Tipo>;
  limparEspera: Limpar;
  limparIntervalo: Limpar;
}

// Fica no globalThis: se o mesmo processo rodar outro arquivo, a vigia não é ligada duas vezes.
const MARCA = Symbol.for("janete.testes.temporizadores");
type Global = typeof globalThis & { [MARCA]?: Vigia };

/** Passa a anotar os setTimeout e setInterval criados daqui em diante, até dispararem ou serem limpos. */
export function vigiarTemporizadores(): void {
  const g = globalThis as Global;
  if (g[MARCA]) return;
  const real = {
    setTimeout: g.setTimeout as unknown as Agendar,
    setInterval: g.setInterval as unknown as Agendar,
    clearTimeout: g.clearTimeout as unknown as Limpar,
    clearInterval: g.clearInterval as unknown as Limpar,
  };
  const pendentes = new Map<Alca, Tipo>();

  const setTimeoutVigiado: Agendar = (fn, ms, ...args) => {
    if (typeof fn !== "function") return real.setTimeout(fn, ms, ...args);
    const alca = real.setTimeout(
      (...a: unknown[]) => {
        pendentes.delete(alca);
        fn(...a);
      },
      ms,
      ...args,
    );
    pendentes.set(alca, "espera");
    return alca;
  };
  const setIntervalVigiado: Agendar = (fn, ms, ...args) => {
    const alca = real.setInterval(fn, ms, ...args);
    if (typeof fn === "function") pendentes.set(alca, "intervalo");
    return alca;
  };
  const clearTimeoutVigiado: Limpar = (alca) => {
    if (alca !== undefined) pendentes.delete(alca);
    real.clearTimeout(alca);
  };
  const clearIntervalVigiado: Limpar = (alca) => {
    if (alca !== undefined) pendentes.delete(alca);
    real.clearInterval(alca);
  };
  // o util.promisify(setTimeout) do Node continua valendo
  for (const k of Object.getOwnPropertySymbols(real.setTimeout)) {
    const descritor = Object.getOwnPropertyDescriptor(real.setTimeout, k);
    if (descritor) Object.defineProperty(setTimeoutVigiado, k, descritor);
  }

  g.setTimeout = setTimeoutVigiado as unknown as typeof setTimeout;
  g.setInterval = setIntervalVigiado as unknown as typeof setInterval;
  g.clearTimeout = clearTimeoutVigiado as unknown as typeof clearTimeout;
  g.clearInterval = clearIntervalVigiado as unknown as typeof clearInterval;
  g[MARCA] = { pendentes, limparEspera: real.clearTimeout, limparIntervalo: real.clearInterval };
}

/** Limpa os temporizadores vigiados que ainda não dispararam; devolve quantos eram. */
export function limparTemporizadoresPendentes(): number {
  const vigia = (globalThis as Global)[MARCA];
  if (!vigia) return 0;
  const quantos = vigia.pendentes.size;
  for (const [alca, tipo] of vigia.pendentes) {
    if (tipo === "intervalo") vigia.limparIntervalo(alca);
    else vigia.limparEspera(alca);
  }
  vigia.pendentes.clear();
  return quantos;
}
