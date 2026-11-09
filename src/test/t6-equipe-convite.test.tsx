import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GavetaConvite } from "@/features/plataforma/equipe/GavetaConvite";
import type { PapelMembro } from "@/features/plataforma/exemplo/tipos";

// Task C3 da spec da Equipe (docs/spec-equipe.md): a gaveta "Convidar pessoa". A tela de verdade é
// da C4; aqui um componente de teste guarda o `aberta` e tem o botão que abre, para conferir que o
// foco volta para ele ao fechar.

type Enviar = (email: string, papel: PapelMembro) => string | null;

function Palco({ aoEnviar, aoFechar }: { aoEnviar: Enviar; aoFechar?: (() => void) | undefined }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberta(true)}>
        Convidar pessoa
      </button>
      <GavetaConvite
        aberta={aberta}
        aoFechar={() => {
          aoFechar?.();
          setAberta(false);
        }}
        aoEnviar={(email, papel) => {
          const erro = aoEnviar(email, papel);
          // Como a tela: o convite foi, a tela fecha.
          if (erro === null) setAberta(false);
          return erro;
        }}
      />
    </>
  );
}

function montar(aoEnviar: Enviar = () => null, aoFechar?: () => void) {
  render(
    <StrictMode>
      <Palco aoEnviar={aoEnviar} aoFechar={aoFechar} />
    </StrictMode>,
  );
  const abridor = screen.getByRole("button", { name: "Convidar pessoa" });
  return { abridor };
}

function abrir(abridor: HTMLElement) {
  abridor.focus();
  act(() => {
    fireEvent.click(abridor);
  });
  return screen.getByRole("dialog", { name: "Convidar pessoa" });
}

const campoEmail = () => screen.getByLabelText("E-mail") as HTMLInputElement;

afterEach(() => cleanup());

describe("GavetaConvite", () => {
  it("abre com o foco no e-mail, os textos do protótipo e Atendente marcado", () => {
    const { abridor } = montar();
    const dialogo = abrir(abridor);

    const email = campoEmail();
    expect(document.activeElement).toBe(email);
    expect(email.type).toBe("email");
    expect(email.inputMode).toBe("email");
    expect(email.getAttribute("autocomplete")).toBe("off");
    expect(email.getAttribute("spellcheck")).toBe("false");
    expect(email.getAttribute("autocapitalize")).toBe("off");
    expect(email.placeholder).toBe("nome@empresa.com.br");

    expect(within(dialogo).getByRole("heading", { level: 2, name: "Convidar pessoa" })).toBeTruthy();
    expect(
      within(dialogo).getByText("Crie o convite, copie o link e compartilhe com a pessoa. Ela entra com a conta Google desse e-mail."),
    ).toBeTruthy();

    const grupo = within(dialogo).getByRole("radiogroup", { name: "Papel" });
    const atendente = within(grupo).getByRole("radio", { name: /^Atendente/ }) as HTMLInputElement;
    const admin = within(grupo).getByRole("radio", { name: /^Admin/ }) as HTMLInputElement;
    expect(atendente.checked).toBe(true);
    expect(admin.checked).toBe(false);
    expect(atendente.name).toBe(admin.name);
    expect(atendente.name).not.toBe("");
    expect(
      within(grupo).getByText(
        "Atende as conversas que a Janete passa para a equipe, responde e move os leads. Não vê a Configuração.",
      ),
    ).toBeTruthy();
    expect(
      within(grupo).getByText(
        "Atende como todo mundo e também convida e desativa pessoas, troca papéis e mexe na Configuração.",
      ),
    ).toBeTruthy();

    expect(
      within(dialogo).getByText(
        "Até aceitar com Google, a pessoa aparece aqui como “Convite criado”, com Renovar, Copiar link e Cancelar. Ela só recebe conversas depois de entrar.",
      ),
    ).toBeTruthy();
    expect(within(dialogo).getByRole("button", { name: "Criar convite" })).toBeTruthy();
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(within(dialogo).getByRole("button", { name: "Fechar" })).toBeTruthy();
  });

  it("não tem <form> nem botão de submit no DOM", () => {
    const { abridor } = montar();
    abrir(abridor);
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector('[type="submit"]')).toBeNull();
  });

  it("Enter no e-mail envia com Atendente e, quando o convite vai, a tela fecha e o foco volta", () => {
    const aoEnviar = vi.fn<Enviar>(() => null);
    const { abridor } = montar(aoEnviar);
    abrir(abridor);

    fireEvent.change(campoEmail(), { target: { value: "bruna@empresa.com.br" } });
    act(() => {
      fireEvent.keyDown(campoEmail(), { key: "Enter" });
    });

    expect(aoEnviar).toHaveBeenCalledTimes(1);
    expect(aoEnviar).toHaveBeenCalledWith("bruna@empresa.com.br", "atendente");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(abridor);
  });

  it("clicar em Admin e em Criar convite manda o papel admin", () => {
    const aoEnviar = vi.fn<Enviar>(() => null);
    const { abridor } = montar(aoEnviar);
    const dialogo = abrir(abridor);

    fireEvent.change(campoEmail(), { target: { value: "lia@empresa.com.br" } });
    fireEvent.click(within(dialogo).getByRole("radio", { name: /^Admin/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar convite" }));

    expect(aoEnviar).toHaveBeenCalledWith("lia@empresa.com.br", "admin");
  });

  it("o erro aparece no campo, a gaveta fica aberta, o foco volta ao e-mail e digitar apaga o erro", () => {
    const erro = "Esse e-mail parece incompleto. Confira se tem @ e o domínio.";
    const aoEnviar = vi.fn<Enviar>(() => erro);
    const { abridor } = montar(aoEnviar);
    const dialogo = abrir(abridor);

    fireEvent.change(campoEmail(), { target: { value: "bruna@" } });
    const enviar = within(dialogo).getByRole("button", { name: "Criar convite" });
    enviar.focus();
    act(() => {
      fireEvent.click(enviar);
    });

    expect(screen.getByRole("dialog", { name: "Convidar pessoa" })).toBeTruthy();
    const email = campoEmail();
    expect(email.getAttribute("aria-invalid")).toBe("true");
    const descrito = email.getAttribute("aria-describedby");
    expect(descrito).toBeTruthy();
    expect(document.getElementById(descrito!)?.textContent).toBe(erro);
    expect(document.activeElement).toBe(email);

    fireEvent.change(email, { target: { value: "bruna@e" } });
    expect(email.getAttribute("aria-invalid")).toBeNull();
    expect(email.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(erro)).toBeNull();
  });

  it("o erro do Enter é anunciado na região de alerta, de novo a cada recusa, e sai ao digitar", () => {
    const erro = "Marina já está na equipe.";
    const { abridor } = montar(() => erro);
    const dialogo = abrir(abridor);
    const alerta = within(dialogo).getByRole("alert");
    expect(alerta.textContent).toBe("");

    fireEvent.change(campoEmail(), { target: { value: "marina@empresa.exemplo" } });
    act(() => {
      fireEvent.keyDown(campoEmail(), { key: "Enter" });
    });
    expect(alerta.textContent).toBe(erro);
    const primeiro = alerta.firstElementChild;

    // O mesmo erro de novo entra como nó novo (o leitor de tela lê outra vez).
    act(() => {
      fireEvent.keyDown(campoEmail(), { key: "Enter" });
    });
    expect(alerta.textContent).toBe(erro);
    expect(alerta.firstElementChild).not.toBe(primeiro);

    fireEvent.change(campoEmail(), { target: { value: "marina@empresa.exemplo2" } });
    expect(alerta.textContent).toBe("");
  });

  it("Esc, Cancelar e o X chamam aoFechar e o foco volta para Convidar pessoa", () => {
    const aoFechar = vi.fn();
    const { abridor } = montar(() => null, aoFechar);

    abrir(abridor);
    act(() => {
      fireEvent.keyDown(campoEmail(), { key: "Escape" });
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(abridor);

    let dialogo = abrir(abridor);
    act(() => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    });
    expect(aoFechar).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(abridor);

    dialogo = abrir(abridor);
    act(() => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Fechar" }));
    });
    expect(aoFechar).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(abridor);
  });

  it("reabrir traz o e-mail vazio, Atendente marcado e nenhum erro", () => {
    const { abridor } = montar(() => "Esse é o seu e-mail.");
    let dialogo = abrir(abridor);

    fireEvent.change(campoEmail(), { target: { value: "marina@empresa.exemplo" } });
    fireEvent.click(within(dialogo).getByRole("radio", { name: /^Admin/ }));
    act(() => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Criar convite" }));
    });
    expect(campoEmail().getAttribute("aria-invalid")).toBe("true");

    act(() => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    });
    dialogo = abrir(abridor);

    expect(campoEmail().value).toBe("");
    expect(campoEmail().getAttribute("aria-invalid")).toBeNull();
    expect((within(dialogo).getByRole("radio", { name: /^Atendente/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialogo).getByRole("radio", { name: /^Admin/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText("Esse é o seu e-mail.")).toBeNull();
  });
});
