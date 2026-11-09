import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup as cleanupTudo, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formaDoDisco } from "@/features/onboarding/conexao/qr/DiscoQr";
import {
  PassoQr,
  TEMPO_VOLTA_DISCO_MS,
  TEXTOS_QR,
  semQuebrarNumeros,
  tempoVoltaDisco,
  type DiferenteQr,
} from "@/features/onboarding/conexao/qr/PassoQr";
import type { EstadoLeituraQr } from "@/features/onboarding/conexao/qr/useLeituraQr";
import { PROVS } from "@/features/onboarding/lista/dados";

// Q8 (spec-qr-whatsapp, seção 8, task F2): o disco que vira o QR, o número no passo 1, o celular
// de outro número e o aviso do cartão.

vi.mock("@/features/onboarding/lista/sessao", () => ({
  sessaoTerminou: vi.fn(async () => false),
  irParaEntrar: vi.fn(),
}));

const IMG = "data:image/png;base64,AAAA";
const QR: EstadoLeituraQr = { tipo: "qr", imagem: IMG, rodada: 1, desde: 0 };
const ERRO: EstadoLeituraQr = { tipo: "erro", titulo: "A Z-API não aceitou os tokens.", texto: "Confira.", semSessao: false };

type Props = Parameters<typeof PassoQr>[0];

function props(extra: Partial<Props> = {}): Props {
  return {
    estado: { tipo: "carregando" },
    gateway: "zapi",
    variante: "palco",
    idTitulo: "qr-titulo",
    aoGerarOutro: vi.fn(),
    acoes: <button type="button">Corrigir os dados</button>,
    ...extra,
  };
}

function desenhar(extra: Partial<Props> = {}) {
  const p = props(extra);
  const r = render(<PassoQr {...p} />);
  return { ...r, p };
}

const disco = () => screen.getByTestId("disco-qr");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiscoQr: a forma pelo estado", () => {
  it.each([
    ["carregando", { tipo: "carregando" } as EstadoLeituraQr, "quadro"],
    ["qr", QR, "quadro"],
    ["expirado", { tipo: "expirado" } as EstadoLeituraQr, "quadro"],
    ["passkey", { tipo: "passkey" } as EstadoLeituraQr, "disco"],
    ["erro", ERRO, "disco"],
    ["conectado", { tipo: "conectado" } as EstadoLeituraQr, "disco"],
  ])("%s → %s (no disco e na raiz do passo)", (_n, estado, forma) => {
    const { container } = desenhar({ estado });
    expect(disco()).toHaveAttribute("data-forma", forma);
    expect(container.firstElementChild).toHaveAttribute("data-forma", forma);
    expect(formaDoDisco(estado)).toBe(forma);
  });

  it("diferente → disco, mesmo com o estado da leitura em qr", () => {
    desenhar({
      estado: QR,
      diferente: { conectado: "+55 21 99999-0000", informado: "+55 11 98765-4321", aoDesconectar: vi.fn(), desconectando: false },
    });
    expect(disco()).toHaveAttribute("data-forma", "disco");
    expect(formaDoDisco({ tipo: "diferente" })).toBe("disco");
    // o estado da leitura é ignorado: nem QR, nem barra, nem as instruções
    expect(screen.queryByRole("img", { name: TEXTOS_QR.alt })).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("o primeiro desenho é o círculo parado (a forma do estado entra depois, para a transição partir do disco real)", () => {
    const html = renderToStaticMarkup(<PassoQr {...props({ estado: QR })} />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector('[data-testid="disco-qr"]')?.getAttribute("data-forma")).toBe("disco");
    // o espaço do texto já é o do quadro: o texto não desliza na entrada
    expect(doc.body.firstElementChild?.getAttribute("data-forma")).toBe("quadro");
  });

  it("vem depois do título na ordem do DOM (o foco passa pelo título antes do botão do quadro)", () => {
    desenhar({ estado: { tipo: "expirado" } });
    const titulo = screen.getByRole("heading", { level: 2 });
    expect(titulo.compareDocumentPosition(disco()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("o logo do gateway, decorativo: Z-API escura e larga; Evolution só larga", () => {
    desenhar({ estado: { tipo: "carregando" } });
    const logo = disco().querySelector("img")!;
    expect(logo).toHaveAttribute("src", PROVS.zapi.logo);
    expect(logo).toHaveAttribute("alt", "");
    expect(disco()).toHaveAttribute("data-escura");
    expect(disco()).toHaveAttribute("data-larga");
    // carregando: o lugar do QR vazio, com o logo no meio
    expect(disco()).toHaveAttribute("data-carregando");
    expect(disco()).toHaveAttribute("data-vazio");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("Evolution: fundo claro e logo largo", () => {
    desenhar({ estado: { tipo: "passkey" }, gateway: "evolution" });
    expect(disco().querySelector("img")).toHaveAttribute("src", PROVS.evolution.logo);
    expect(disco()).not.toHaveAttribute("data-escura");
    expect(disco()).toHaveAttribute("data-larga");
  });

  it("qr: o QR dentro do quadro, sem o fundo escuro, com a barra dos 20 s", () => {
    desenhar({ estado: QR });
    const img = within(disco()).getByRole("img", { name: TEXTOS_QR.alt });
    expect(img).toHaveAttribute("src", IMG);
    expect(disco()).not.toHaveAttribute("data-escura");
    expect(disco()).not.toHaveAttribute("data-vazio");
    expect(disco().querySelector('span[aria-hidden="true"]')).not.toBeNull();
    // o logo some atrás do QR
    expect(disco().querySelector('img[alt=""]')).toHaveAttribute("data-oculto");
  });

  it("expirado: o QR apagado e o 'Gerar outro QR code' por cima, dentro do quadro", () => {
    const { rerender, p } = desenhar({ estado: QR });
    rerender(<PassoQr {...p} estado={{ tipo: "expirado" }} />);
    const img = within(disco()).getByRole("img", { name: TEXTOS_QR.alt });
    expect(img.className).toMatch(/apagada/);
    fireEvent.click(within(disco()).getByRole("button", { name: TEXTOS_QR.gerarOutro }));
    expect(p.aoGerarOutro).toHaveBeenCalledTimes(1);
  });

  it("conectado: o círculo; o último QR sai do leitor de tela", () => {
    const { rerender, p } = desenhar({ estado: QR });
    rerender(<PassoQr {...p} estado={{ tipo: "conectado" }} />);
    expect(disco()).toHaveAttribute("data-forma", "disco");
    expect(screen.queryByRole("img", { name: TEXTOS_QR.alt })).toBeNull();
    // Z-API: o círculo volta ao grafite do disco real
    expect(disco()).toHaveAttribute("data-escura");
  });
});

describe("PassoQr: o número no passo 1", () => {
  it("palco: 'Abra o WhatsApp no celular do {numero}.'", () => {
    desenhar({ estado: QR, numero: "+55 11 98765-4321" });
    const itens = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(itens).toEqual([
      "Abra o WhatsApp no celular do +55 11 98765-4321.",
      TEXTOS_QR.passos[1],
      TEXTOS_QR.passos[2],
    ]);
  });

  it("sem número: o texto de sempre", () => {
    desenhar({ estado: QR });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(TEXTOS_QR.passos[0]);
  });

  it("cartão: o número também entra no passo 1", () => {
    desenhar({ estado: QR, variante: "cartao", idTitulo: "cfg-qr-titulo", numero: "+55 11 8765-4321" });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Abra o WhatsApp no celular do +55 11 8765-4321.");
  });

  it("as instruções ficam fora do disco", () => {
    desenhar({ estado: QR });
    expect(within(disco()).queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("PassoQr: o celular de outro número (diferente)", () => {
  function dif(extra: Partial<DiferenteQr> = {}): DiferenteQr {
    return {
      conectado: "+55 21 99999-0000",
      informado: "+55 11 98765-4321",
      aoUsar: vi.fn(),
      aoDesconectar: vi.fn(),
      desconectando: false,
      ...extra,
    };
  }

  it("título, texto anunciado e os 2 botões, mais as ações de sempre", () => {
    const d = dif();
    const { container } = desenhar({ estado: QR, diferente: d });
    const titulo = screen.getByRole("heading", { level: 2, name: "Outro número leu o QR code" });
    expect(titulo).toHaveAttribute("id", "qr-titulo");
    expect(titulo).toHaveAttribute("tabindex", "-1");
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      "Este celular é do +55 21 99999-0000, não do +55 11 98765-4321 que você informou.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Usar o +55 21 99999-0000" }));
    expect(d.aoUsar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Desconectar e ler de novo" }));
    expect(d.aoDesconectar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // o "Tentar de novo" do erro da leitura não aparece
    expect(screen.queryByRole("button", { name: TEXTOS_QR.tentarDeNovo })).toBeNull();
  });

  it("sem aoUsar: só o 'Desconectar e ler de novo'", () => {
    desenhar({ diferente: dif({ aoUsar: undefined }) });
    expect(screen.queryByRole("button", { name: /^Usar o/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Desconectar e ler de novo" })).toBeInTheDocument();
  });

  it("desconectando: 'Desconectando…' com o giro, e os dois botões travados", () => {
    const d = dif({ desconectando: true });
    desenhar({ diferente: d });
    const b = screen.getByRole("button", { name: /Desconectando…/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "Desconectar e ler de novo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Usar o +55 21 99999-0000" })).toBeDisabled();
  });

  it("a falha vem numa linha anunciada na hora", () => {
    desenhar({ diferente: dif({ erro: "Não deu para desconectar o celular agora." }) });
    expect(screen.getByRole("alert")).toHaveTextContent("Não deu para desconectar o celular agora.");
  });

  it("no cartão o diferente não vale (o conserto não aceita outro número)", () => {
    desenhar({ estado: QR, variante: "cartao", idTitulo: "cfg-qr-titulo", diferente: dif() });
    expect(screen.queryByText("Outro número leu o QR code")).toBeNull();
    expect(screen.getByRole("img", { name: TEXTOS_QR.alt })).toBeInTheDocument();
  });

  it("os textos novos estão em TEXTOS_QR", () => {
    expect(TEXTOS_QR.diferenteTitulo).toBe("Outro número leu o QR code");
    expect(TEXTOS_QR.diferenteTexto("A", "B")).toBe("Este celular é do A, não do B que você informou.");
    expect(TEXTOS_QR.usarConectado("A")).toBe("Usar o A");
    expect(TEXTOS_QR.desconectar).toBe("Desconectar e ler de novo");
    expect(TEXTOS_QR.desconectando).toBe("Desconectando…");
    expect(TEXTOS_QR.passo1ComNumero("A")).toBe("Abra o WhatsApp no celular do A.");
  });
});

describe("PassoQr: o cartão", () => {
  it("sem DiscoQr: o QR ao lado dos passos, como antes", () => {
    const { container } = desenhar({ estado: QR, variante: "cartao", idTitulo: "cfg-qr-titulo" });
    expect(screen.queryByTestId("disco-qr")).toBeNull();
    expect(container.firstElementChild).not.toHaveAttribute("data-forma");
    expect(screen.getByRole("img", { name: TEXTOS_QR.alt })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("o aviso: uma linha de atenção acima do QR", () => {
    desenhar({
      estado: QR,
      variante: "cartao",
      idTitulo: "cfg-qr-titulo",
      aviso: "Um celular de outro número leu o QR code, e a Janete desconectou ele.",
    });
    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent("Um celular de outro número leu o QR code, e a Janete desconectou ele.");
    const img = screen.getByRole("img", { name: TEXTOS_QR.alt });
    expect(aviso.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no palco o aviso não aparece", () => {
    desenhar({ estado: QR, aviso: "Qualquer coisa" });
    expect(screen.queryByText("Qualquer coisa")).toBeNull();
  });
});

describe("o tempo de volta do disco", () => {
  it("450 ms; 0 com movimento reduzido", () => {
    expect(TEMPO_VOLTA_DISCO_MS).toBe(450);
    expect(tempoVoltaDisco()).toBe(450);
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q }) as unknown as MediaQueryList,
    );
    expect(tempoVoltaDisco()).toBe(0);
  });

  it("o CSS segue o mesmo tempo e a mesma geometria do disco do palco", () => {
    const pasta = path.resolve(__dirname, "../features/onboarding");
    const discoCss = readFileSync(path.join(pasta, "conexao/qr/DiscoQr.module.css"), "utf-8");
    expect(discoCss).toMatch(/--disco-tempo:\s*0\.45s/);
    expect(discoCss).toMatch(/--disco-lado:\s*9\.5rem/);
    expect(discoCss).toMatch(/--quadro-lado:\s*15rem/);
    expect(discoCss).toMatch(/top:\s*-6\.5rem/);
    const listaCss = readFileSync(path.join(pasta, "lista/Lista.module.css"), "utf-8");
    const regra = listaCss.match(/\.val\[data-vis='qr'\] \.disco \{([^}]*)\}/);
    expect(regra?.[1]).toMatch(/visibility:\s*hidden/);
    expect(regra?.[1]).not.toMatch(/scale/);
    // a âncora do disco real: centro a 10,5rem, lado 9,5rem; o texto começa 6,5rem abaixo
    expect(listaCss).toMatch(/\.valAncora \{[^}]*top: 10\.5rem;[^}]*width: 9\.5rem;/);
    expect(listaCss).toMatch(/\.valTexto \{[^}]*top: calc\(10\.5rem \+ 6\.5rem\);/);
  });
});

describe("os números formatados nunca quebram no meio da linha", () => {
  /** Os trechos que não quebram (o span de cada número), pelo texto. */
  const inteiros = (el: Element) =>
    Array.from(el.querySelectorAll("span"))
      .filter((sp) => /^\+\d/.test(sp.textContent ?? ""))
      .map((sp) => sp.textContent);

  it("semQuebrarNumeros: cada número num trecho próprio, e o texto não muda", () => {
    const { container } = render(
      <p>{semQuebrarNumeros("Este celular é do +55 21 99999-0000, não do +55 11 8765-4321 que você informou.")}</p>,
    );
    const p = container.querySelector("p")!;
    expect(p.textContent).toBe("Este celular é do +55 21 99999-0000, não do +55 11 8765-4321 que você informou.");
    expect(inteiros(p)).toEqual(["+55 21 99999-0000", "+55 11 8765-4321"]);
    // fora do Brasil, "+" e os dígitos
    const outro = render(<p>{semQuebrarNumeros("Usar o +447911123456")}</p>).container.querySelector("p")!;
    expect(inteiros(outro)).toEqual(["+447911123456"]);
    // sem número, o próprio texto
    expect(semQuebrarNumeros("Desconectar e ler de novo")).toBe("Desconectar e ler de novo");
  });

  it("no passo 1 (palco e cartão), na frase do diferente, no 'Usar o …' e no aviso do cartão", () => {
    const { unmount } = desenhar({
      estado: QR,
      numero: "+55 11 98765-4321",
      diferente: {
        conectado: "+55 21 99999-0000",
        informado: "+55 11 98765-4321",
        aoUsar: vi.fn(),
        aoDesconectar: vi.fn(),
        desconectando: false,
      },
    });
    const viva = document.querySelector('[aria-live="polite"]')!;
    expect(inteiros(viva)).toEqual(["+55 21 99999-0000", "+55 11 98765-4321"]);
    expect(inteiros(screen.getByRole("button", { name: "Usar o +55 21 99999-0000" }))).toEqual(["+55 21 99999-0000"]);
    unmount();

    desenhar({ estado: QR, numero: "+55 11 98765-4321" });
    expect(inteiros(screen.getAllByRole("listitem")[0]!)).toEqual(["+55 11 98765-4321"]);
    cleanupTudo();

    desenhar({
      estado: QR,
      variante: "cartao",
      idTitulo: "cfg-qr-titulo",
      numero: "+55 11 98765-4321",
      aviso: "Este celular é do +55 21 99999-0000, não do +55 11 98765-4321 desta conexão.",
    });
    expect(inteiros(screen.getAllByRole("listitem")[0]!)).toEqual(["+55 11 98765-4321"]);
    expect(inteiros(screen.getByRole("alert"))).toEqual(["+55 21 99999-0000", "+55 11 98765-4321"]);
  });

  it("o CSS do trecho: white-space nowrap", () => {
    const css = readFileSync(path.resolve(__dirname, "../features/onboarding/conexao/qr/PassoQr.module.css"), "utf-8");
    expect(css).toMatch(/\.numero \{[^}]*white-space:\s*nowrap/);
  });
});
