import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Ensinar } from "@/features/plataforma/contexto/Ensinar";
import { FaixaVersaoAntiga, Historico } from "@/features/plataforma/contexto/Historico";
import { lerContexto, reiniciarContexto } from "@/features/plataforma/contexto/loja";
import { situacao } from "@/features/plataforma/contexto/regras";
import type { Alvo } from "@/features/plataforma/contexto/tipos";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C3 da spec do Contexto (docs/spec-contexto.md): o balão "Ensinar algo novo" e o histórico de
// versões (a gaveta, a faixa da versão antiga e a confirmação de restaurar), com os dados de exemplo.

/** O relógio do teste: a v6 foi salva hoje, às 18:20 (São Paulo). */
const AGORA = "2026-10-28T20:00:00-03:00";

beforeEach(() => {
  reiniciarContexto();
});

afterEach(() => {
  cleanup();
});

/* ---------- Ensinar ---------- */

/** Um botão que abre o balão (como o do cabeçalho), para conferir a volta do foco. */
function ComEnsinar({ aoDescobrir, aoAbrirAlvo, aoFechar }: { aoDescobrir(a: Alvo): void; aoAbrirAlvo(a: Alvo): void; aoFechar?(): void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" id="ctx-ensinar-btn" onClick={() => setAberto(true)}>
        Ensinar algo novo
      </button>
      <Ensinar
        aberto={aberto}
        pensarMs={0}
        aoFechar={() => {
          setAberto(false);
          aoFechar?.();
        }}
        aoDescobrir={aoDescobrir}
        aoAbrirAlvo={aoAbrirAlvo}
      />
    </>
  );
}

function montarEnsinar(papel: Papel = "admin") {
  const aoDescobrir = vi.fn<(a: Alvo) => void>();
  const aoAbrirAlvo = vi.fn<(a: Alvo) => void>();
  const aoFechar = vi.fn();
  const r = render(
    <ProvedorPapel inicial={papel}>
      <ComEnsinar aoDescobrir={aoDescobrir} aoAbrirAlvo={aoAbrirAlvo} aoFechar={aoFechar} />
    </ProvedorPapel>,
  );
  const abridor = r.container.querySelector<HTMLButtonElement>("#ctx-ensinar-btn")!;
  act(() => abridor.focus());
  fireEvent.click(abridor);
  return { ...r, aoDescobrir, aoAbrirAlvo, aoFechar, abridor };
}

function escrever(texto: string) {
  const caixa = document.getElementById("ens-in") as HTMLTextAreaElement;
  fireEvent.change(caixa, { target: { value: texto } });
  fireEvent.keyDown(caixa, { key: "Enter" });
}

describe("Ensinar algo novo", () => {
  it("mostra o título, a ajuda e a caixa com exemplo curto", () => {
    montarEnsinar();
    const balao = document.getElementById("ctx-ens")!;
    expect(within(balao).getByRole("heading", { name: "Ensinar algo novo" })).toBeTruthy();
    expect(balao.textContent).toContain("Eu descubro em qual campo entra");
    const caixa = document.getElementById("ens-in") as HTMLTextAreaElement;
    expect(caixa.placeholder).toBe("Ex.: Abrimos aos sábados");
    expect((screen.getByRole("button", { name: "Mandar para a Janete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('"atendemos sábado das 9h" vai para Horário, que fica "nao_salvo"', () => {
    const { aoDescobrir, aoAbrirAlvo } = montarEnsinar();
    expect(situacao(lerContexto(), "horario")).toBe("vazio");
    escrever("atendemos sábado das 9h");
    expect(situacao(lerContexto(), "horario")).toBe("nao_salvo");
    expect(aoDescobrir).toHaveBeenCalledWith("horario");
    const balao = document.getElementById("ctx-ens")!;
    expect(balao.textContent).toContain("Coloquei em Horário. Falta salvar.");
    expect(balao.textContent).toContain("atendemos sábado das 9h");
    fireEvent.click(screen.getByRole("button", { name: "Abrir Horário" }));
    expect(aoAbrirAlvo).toHaveBeenCalledWith("horario");
    // "Ensinar outra coisa" volta para a caixa
    fireEvent.click(screen.getByRole("button", { name: "Ensinar outra coisa" }));
    expect(document.getElementById("ens-in")).toBeTruthy();
  });

  it('uma pergunta ("…?") vira a pergunta livre nova e oferece abri-la', () => {
    const { aoDescobrir, aoAbrirAlvo } = montarEnsinar();
    escrever("A Janete pode mandar áudio?");
    expect(lerContexto().rascunhos["livre-novo"]?.pergunta).toBe("A Janete pode mandar áudio?");
    expect(aoDescobrir).toHaveBeenCalledWith("livre-novo");
    expect(document.getElementById("ctx-ens")!.textContent).toContain("Virou uma pergunta livre nova");
    fireEvent.click(screen.getByRole("button", { name: "Abrir a pergunta nova" }));
    expect(aoAbrirAlvo).toHaveBeenCalledWith("livre-novo");
  });

  it("texto sem casamento mostra os 8 campos e a pergunta livre para escolher", () => {
    const { aoDescobrir } = montarEnsinar();
    escrever("Gostamos muito de café");
    expect(aoDescobrir).not.toHaveBeenCalled();
    const grupo = screen.getByRole("group", { name: "Escolher o campo" });
    const chips = within(grupo).getAllByRole("button");
    expect(chips.map((b) => b.textContent)).toEqual([
      "Empresa e oferta",
      "Cliente ideal",
      "Preço",
      "Diferenciais",
      "Tom de voz",
      "Passar para humano",
      "Objeções",
      "Horário",
      "Pergunta livre",
    ]);
    // nenhum gancho do mapa duplicado dentro do balão
    expect(grupo.querySelector("[data-campo], [data-livre]")).toBeNull();
    fireEvent.click(within(grupo).getByRole("button", { name: "Diferenciais" }));
    expect(situacao(lerContexto(), "diferenciais")).toBe("nao_salvo");
    expect(aoDescobrir).toHaveBeenCalledWith("diferenciais");
    expect(document.getElementById("ctx-ens")!.textContent).toContain("Coloquei em Diferenciais. Falta salvar.");
  });

  it("com uma pergunta nova sem salvar, outra pergunta não a troca: avisa e oferece abrir a que existe", () => {
    reiniciarContexto({ rascunhos: { "livre-novo": { pergunta: "Tem estacionamento?", resposta: "Sim, na rua de trás." } } });
    const { aoDescobrir, aoAbrirAlvo } = montarEnsinar();
    escrever("Fazem entrega em domicílio?");
    expect(lerContexto().rascunhos["livre-novo"]).toEqual({ pergunta: "Tem estacionamento?", resposta: "Sim, na rua de trás." });
    expect(aoDescobrir).not.toHaveBeenCalled();
    const balao = document.getElementById("ctx-ens")!;
    expect(balao.textContent).toContain("Você já tem uma pergunta nova sem salvar. Abra, salve ou descarte antes.");
    // a região viva, que já existia, leva o mesmo aviso
    expect(balao.querySelector("[aria-live='polite']")!.textContent).toContain("Você já tem uma pergunta nova sem salvar");
    fireEvent.click(screen.getByRole("button", { name: "Abrir a pergunta nova" }));
    expect(aoAbrirAlvo).toHaveBeenCalledWith("livre-novo");
  });

  it("escolher a pergunta livre nos chips abre o rascunho do item novo", () => {
    const { aoDescobrir } = montarEnsinar();
    escrever("Gostamos muito de café");
    fireEvent.click(screen.getByRole("button", { name: "Pergunta livre" }));
    expect(lerContexto().rascunhos["livre-novo"]?.pergunta).toBe("Gostamos muito de café");
    expect(aoDescobrir).toHaveBeenCalledWith("livre-novo");
  });

  it("Esc fecha e devolve o foco a quem abriu", () => {
    const { aoFechar, abridor } = montarEnsinar();
    fireEvent.keyDown(document.getElementById("ens-in")!, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ctx-ens")).toBeNull();
    expect(document.activeElement).toBe(abridor);
  });

  it("o X fecha e devolve o foco a quem abriu", () => {
    const { aoFechar, abridor } = montarEnsinar();
    fireEvent.click(screen.getByRole("button", { name: "Fechar (Esc)" }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(abridor);
  });

  it("o atendente não vê o balão", () => {
    montarEnsinar("atendente");
    expect(document.getElementById("ctx-ens")).toBeNull();
  });

  it("vendo uma versão antiga, o balão só oferece voltar para a atual", () => {
    reiniciarContexto({ vendo: 3 });
    montarEnsinar();
    const balao = document.getElementById("ctx-ens")!;
    expect(document.getElementById("ens-in")).toBeNull();
    expect(balao.textContent).toContain("Você está vendo a versão 3");
    fireEvent.click(within(balao).getByRole("button", { name: "Voltar para a atual" }));
    expect(lerContexto().vendo).toBeNull();
  });
});

/* ---------- Histórico ---------- */

function montarHistorico(papel: Papel = "admin") {
  const aoFechar = vi.fn();
  const aoRestaurar = vi.fn<(v: number, de: number) => void>();
  const r = render(
    <ProvedorPapel inicial={papel}>
      <FaixaVersaoAntiga agora={AGORA} aoRestaurar={aoRestaurar} />
      <Historico aberto agora={AGORA} aoFechar={aoFechar} aoRestaurar={aoRestaurar} />
    </ProvedorPapel>,
  );
  const gaveta = document.getElementById("ctx-gaveta")!;
  return { ...r, aoFechar, aoRestaurar, gaveta };
}

function versao(gaveta: HTMLElement, n: number): HTMLElement {
  return gaveta.querySelector<HTMLElement>(`[data-versao="${n}"]`)!;
}

describe("Histórico de versões", () => {
  it("lista as 6 versões, da mais nova para a mais velha, num portal com a identidade", () => {
    const { gaveta, container } = montarHistorico();
    expect(container.contains(gaveta)).toBe(false);
    expect(gaveta.closest('[data-identidade="aipro"]')).toBeTruthy();
    const itens = gaveta.querySelectorAll("li");
    expect(itens).toHaveLength(6);
    expect([...itens].map((li) => li.getAttribute("data-versao"))).toEqual(["6", "5", "4", "3", "2", "1"]);

    const v6 = versao(gaveta, 6);
    expect(v6.textContent).toContain("Em uso");
    expect(v6.textContent).toContain("Hoje, 18:20 · Edição · Você");
    expect(within(v6).queryByRole("button", { name: /Restaurar/ })).toBeNull();
    expect(within(v6).queryByRole("button", { name: /Ver/ })).toBeNull();

    expect(versao(gaveta, 5).textContent).toContain("Hoje, 10:02 · Restauração da versão 3 · Você");
    expect(versao(gaveta, 4).textContent).toContain("27/10, 15:12 · Edição · Você");
    expect(versao(gaveta, 1).textContent).toContain("26/10, 16:40 · Onboarding · Você");
    expect(gaveta.textContent?.match(/Em uso/g)).toHaveLength(1);
    expect(within(versao(gaveta, 4)).getByRole("button", { name: "Ver a versão 4, de 27/10, 15:12" })).toBeTruthy();
    for (const n of [5, 4, 3, 2, 1]) {
      expect(within(versao(gaveta, n)).getByText("Ver esta versão")).toBeTruthy();
      expect(within(versao(gaveta, n)).getByRole("button", { name: `Restaurar a versão ${n}` })).toBeTruthy();
    }
  });

  it('"Ver esta versão" põe a tela na versão antiga e a faixa aparece', () => {
    const { gaveta, aoFechar, container } = montarHistorico();
    expect(container.querySelector('[aria-label="Versão antiga"]')).toBeNull();
    fireEvent.click(within(versao(gaveta, 4)).getByText("Ver esta versão"));
    expect(lerContexto().vendo).toBe(4);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    const faixa = container.querySelector<HTMLElement>('[aria-label="Versão antiga"]')!;
    expect(faixa.textContent).toContain("Você está vendo a versão 4, de 27/10, 15:12");
    expect(faixa.textContent).toContain("Só leitura. A Janete continua usando a versão 6.");
    // a v4 fica "Na tela" e a atual oferece voltar
    expect(versao(gaveta, 4).textContent).toContain("Na tela");
    fireEvent.click(within(versao(gaveta, 6)).getByText("Voltar para a atual"));
    expect(lerContexto().vendo).toBeNull();
  });

  it('"Restaurar" pede confirmação; cancelar não muda nada; confirmar cria a v7', async () => {
    const { gaveta, aoRestaurar, aoFechar } = montarHistorico();
    fireEvent.click(within(versao(gaveta, 3)).getByRole("button", { name: "Restaurar a versão 3" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg.textContent).toContain("Restaurar a versão 3?");
    expect(dlg.textContent).toContain("nasce a versão 7, igual à 3, e a versão 6 continua no histórico");
    expect(lerContexto().versoes).toHaveLength(6);

    fireEvent.click(within(dlg).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(lerContexto().versoes).toHaveLength(6);
    expect(aoFechar).not.toHaveBeenCalled();

    // Esc na confirmação cancela só ela, sem fechar a gaveta
    fireEvent.click(within(versao(gaveta, 3)).getByRole("button", { name: "Restaurar a versão 3" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(aoFechar).not.toHaveBeenCalled();

    fireEvent.click(within(versao(gaveta, 3)).getByRole("button", { name: "Restaurar a versão 3" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restaurar versão 3" }));
    });
    const [v7] = lerContexto().versoes;
    expect(v7?.numero).toBe(7);
    expect(v7?.origem).toBe("restauracao");
    expect(v7?.restauradaDe).toBe(3);
    expect(aoRestaurar).toHaveBeenCalledWith(7, 3);
    expect(aoFechar).toHaveBeenCalledTimes(1);
    // a gaveta (ainda montada pelo teste) já mostra a v7 em uso
    expect(versao(document.getElementById("ctx-gaveta")!, 7).textContent).toContain("Restauração da versão 3");
  });

  it("Esc fecha a gaveta", () => {
    const { gaveta, aoFechar } = montarHistorico();
    fireEvent.keyDown(gaveta, { key: "Escape" });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("o atendente vê as versões e pode ver uma antiga, mas não restaurar", () => {
    const { gaveta, container } = montarHistorico("atendente");
    expect(gaveta.querySelectorAll("li")).toHaveLength(6);
    expect(within(gaveta).queryByRole("button", { name: /Restaurar/ })).toBeNull();
    fireEvent.click(within(versao(gaveta, 2)).getByText("Ver esta versão"));
    expect(lerContexto().vendo).toBe(2);
    const faixa = container.querySelector<HTMLElement>('[aria-label="Versão antiga"]')!;
    expect(within(faixa).queryByRole("button", { name: /Restaurar/ })).toBeNull();
    expect(within(faixa).getByRole("button", { name: "Voltar para a atual" })).toBeTruthy();
  });
});

describe("Faixa da versão antiga", () => {
  it("não aparece na versão atual", () => {
    const { container } = render(
      <ProvedorPapel>
        <FaixaVersaoAntiga agora={AGORA} />
      </ProvedorPapel>,
    );
    expect(container.innerHTML).toBe("");
  });

  it('"Restaurar esta versão" pede confirmação e cria a versão nova', async () => {
    reiniciarContexto({ vendo: 2 });
    const aoRestaurar = vi.fn();
    render(
      <ProvedorPapel>
        <FaixaVersaoAntiga agora={AGORA} aoRestaurar={aoRestaurar} />
      </ProvedorPapel>,
    );
    expect(screen.getByText("Você está vendo a versão 2, de 26/10, 17:05")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar esta versão" }));
    expect(lerContexto().versoes).toHaveLength(6);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restaurar versão 2" }));
    });
    const [v7] = lerContexto().versoes;
    expect(v7?.numero).toBe(7);
    expect(v7?.restauradaDe).toBe(2);
    expect(lerContexto().vendo).toBeNull();
    expect(aoRestaurar).toHaveBeenCalledWith(7, 2);
    expect(screen.queryByRole("region", { name: "Versão antiga" })).toBeNull();
  });

  it('"Voltar para a atual" sai da versão antiga', () => {
    reiniciarContexto({ vendo: 5 });
    render(
      <ProvedorPapel>
        <FaixaVersaoAntiga agora={AGORA} />
      </ProvedorPapel>,
    );
    expect(screen.getByText(/Restauração da versão 3, por Você\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar para a atual" }));
    expect(lerContexto().vendo).toBeNull();
  });
});
