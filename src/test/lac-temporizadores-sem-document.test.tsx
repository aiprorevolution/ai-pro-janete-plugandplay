import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { esperarElemento } from "@/components/janete/VooJanete";
import { Ensinar } from "@/features/plataforma/contexto/Ensinar";
import { Historico } from "@/features/plataforma/contexto/Historico";
import { reiniciarContexto } from "@/features/plataforma/contexto/loja";
import { ProvedorPapel } from "@/features/plataforma/papel";

import { limparTemporizadoresPendentes } from "./temporizadores";

// Achado A1 da revisão da onda A (lacunas da mensageria): um temporizador que ninguém limpa disparava
// depois de o jsdom do teste sair e derrubava a suíte com "ReferenceError: document is not defined".
// O setup.ts limpa no fim de cada arquivo os temporizadores pendentes (temporizadores.ts). Aqui cada
// teste faz na hora a limpeza do fim do arquivo e depois tira o `document`, como na saída do jsdom: um
// temporizador que ainda disparasse viraria erro solto e reprovaria a suíte.

/** Espera de verdade, para dar tempo de um temporizador limpo disparar (se a limpeza falhasse). */
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanup();
});

describe("a limpeza dos temporizadores no fim do arquivo", () => {
  it("o setTimeout e o setInterval pendentes não disparam depois da limpeza", async () => {
    limparTemporizadoresPendentes();
    const espera = vi.fn();
    const intervalo = vi.fn();
    setTimeout(espera, 5);
    setInterval(intervalo, 5);
    expect(limparTemporizadoresPendentes()).toBe(2);
    await esperar(30);
    expect(espera).not.toHaveBeenCalled();
    expect(intervalo).not.toHaveBeenCalled();
  });

  it("não conta o que já disparou nem o que a tela limpou", async () => {
    limparTemporizadoresPendentes();
    const disparou = vi.fn();
    setTimeout(disparou, 0);
    clearTimeout(setTimeout(() => {}, 1000));
    clearInterval(setInterval(() => {}, 1000));
    await esperar(10);
    expect(disparou).toHaveBeenCalledTimes(1);
    expect(limparTemporizadoresPendentes()).toBe(0);
  });

  it("com o relógio falso os temporizadores ficam com ele, e a vigia volta com o relógio real", () => {
    limparTemporizadoresPendentes();
    vi.useFakeTimers();
    const falso = vi.fn();
    setTimeout(falso, 50);
    expect(limparTemporizadoresPendentes()).toBe(0);
    vi.advanceTimersByTime(50);
    expect(falso).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    setTimeout(() => {}, 1000);
    expect(limparTemporizadoresPendentes()).toBe(1);
  });

  it("o esperarElemento para de olhar quando o document some", async () => {
    limparTemporizadoresPendentes();
    const chegou = vi.fn();
    void esperarElemento("nao-existe", 2000).then(chegou);
    // olhou uma vez e marcou a próxima olhada com setTimeout
    expect(limparTemporizadoresPendentes()).toBe(1);
    vi.stubGlobal("document", undefined);
    await esperar(50);
    expect(chegou).not.toHaveBeenCalled();
  });

  it("o foco atrasado da gaveta do histórico não dispara quando o document some", async () => {
    reiniciarContexto();
    limparTemporizadoresPendentes();
    const { unmount } = render(
      <ProvedorPapel inicial="admin">
        <Historico aberto agora="2026-10-28T20:00:00-03:00" aoFechar={() => {}} />
      </ProvedorPapel>,
    );
    // a gaveta pediu o foco no título com setTimeout (focarId("gav-tit")), que ela não limpa ao fechar
    unmount();
    expect(limparTemporizadoresPendentes()).toBeGreaterThan(0);
    vi.stubGlobal("document", undefined);
    await esperar(50);
  });

  it("o temporizador do balão Ensinar não dispara quando o document some", async () => {
    reiniciarContexto();
    limparTemporizadoresPendentes();
    const { unmount } = render(
      <ProvedorPapel inicial="admin">
        <Ensinar
          aberto
          pensarMs={0}
          aoFechar={() => {}}
          aoDescobrir={() => {}}
          aoAbrirAlvo={() => {}}
        />
      </ProvedorPapel>,
    );
    const caixa = document.getElementById("ens-in") as HTMLTextAreaElement;
    fireEvent.change(caixa, { target: { value: "atendemos sábado das 9h" } });
    fireEvent.keyDown(caixa, { key: "Enter" });
    // a descoberta (e o foco que vem depois dela) segue marcada com setTimeout, que o balão não limpa
    unmount();
    expect(limparTemporizadoresPendentes()).toBeGreaterThan(0);
    vi.stubGlobal("document", undefined);
    await esperar(50);
  });
});
