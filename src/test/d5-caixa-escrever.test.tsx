import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CaixaEscrever,
  FORMATOS_AUDIO,
  MAX_BYTES_ANEXO,
  escolherFormatoAudio,
  podeGravarAudio,
  type NovaMensagem,
  type ResultadoEnvio,
} from "@/features/plataforma/comum/CaixaEscrever";
import type { AcoesDados } from "@/features/plataforma/dados";

// F5 (ligar as telas ao banco): a caixa de escrever de verdade. O anexo vem do seletor de arquivos
// do navegador, o áudio é gravado pelo microfone (MediaRecorder, OGG com Opus quando dá, senão WebM,
// com "ouvir antes de enviar"), o Vídeo fica fora do clipe (decisão 5) e o envio espera cada
// mensagem, parando na primeira recusa.

let conversaN = 0;
/** Cada teste numa conversa nova: o rascunho de cada conversa fica guardado no módulo. */
const novaConversa = () => `conv-d5-${++conversaN}`;
const campo = () => screen.getByRole("textbox", { name: /^Mensagem/ });
const seletor = (c: HTMLElement) => c.querySelector<HTMLInputElement>("input[type=file]")!;

function escolher(c: HTMLElement, qual: "Imagem" | "Documento", arquivos: File[]) {
  fireEvent.click(screen.getByRole("button", { name: "Anexar imagem ou documento" }));
  fireEvent.click(screen.getByRole("menuitem", { name: qual }));
  fireEvent.change(seletor(c), { target: { files: arquivos } });
}

const pdf = () =>
  new File(["%PDF-1.4 proposta"], "proposta-revisada.pdf", { type: "application/pdf" });
const jpg = () => new File(["jpg"], "fachada.jpg", { type: "image/jpeg" });

/** Uma promessa que o teste resolve quando quiser (a ação da camada de dados demorando). */
function adiada<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((ok, erro) => {
    resolver = ok;
    rejeitar = erro;
  });
  return { promessa, resolver, rejeitar };
}

/* ---------- o microfone falso ---------- */

const faixas: { stop: ReturnType<typeof vi.fn> }[] = [];
const gravadores: GravadorFalso[] = [];
let suportados: string[] = [];

class GravadorFalso {
  static isTypeSupported = vi.fn((t: string) => suportados.includes(t));
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  opcoes: unknown;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, opcoes?: { mimeType?: string }) {
    this.opcoes = opcoes;
    this.mimeType = opcoes?.mimeType ?? "audio/mp4";
    gravadores.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["opus"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function streamFalso() {
  const faixa = { stop: vi.fn() };
  faixas.push(faixa);
  return { getTracks: () => [faixa] } as unknown as MediaStream;
}

let getUserMedia: ReturnType<typeof vi.fn>;

function instalarMicrofone(resposta: "ok" | Error = "ok") {
  getUserMedia = vi.fn(() =>
    resposta === "ok" ? Promise.resolve(streamFalso()) : Promise.reject(resposta),
  );
  vi.stubGlobal("MediaRecorder", GravadorFalso);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
}

function tirarMicrofone() {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
}

/** Deixa as promessas do getUserMedia e das ações andarem. */
const esvaziar = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const urls: string[] = [];
const soltas: string[] = [];

beforeEach(() => {
  suportados = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"];
  faixas.length = 0;
  gravadores.length = 0;
  urls.length = 0;
  soltas.length = 0;
  URL.createObjectURL = vi.fn((b: Blob) => {
    const u = `blob:falso/${urls.length + 1}-${(b as File).name ?? "audio"}`;
    urls.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn((u: string) => void soltas.push(u));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  tirarMicrofone();
});

/* =============================================================================
   O formato da gravação
   ============================================================================= */

describe("CaixaEscrever: o formato do áudio", () => {
  it("OGG com Opus quando o navegador grava; senão MP4 (a Meta não aceita WebM); senão WebM; sem nenhum, o padrão dele", () => {
    instalarMicrofone();
    expect(FORMATOS_AUDIO[0]).toBe("audio/ogg;codecs=opus");
    expect(escolherFormatoAudio()).toBe("audio/ogg;codecs=opus");
    suportados = [
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    expect(escolherFormatoAudio()).toBe("audio/mp4;codecs=mp4a.40.2");
    suportados = ["audio/mp4", "audio/webm;codecs=opus"];
    expect(escolherFormatoAudio()).toBe("audio/mp4");
    suportados = ["audio/webm;codecs=opus", "audio/webm"];
    expect(escolherFormatoAudio()).toBe("audio/webm;codecs=opus");
    suportados = ["audio/webm"];
    expect(escolherFormatoAudio()).toBe("audio/webm");
    suportados = [];
    expect(escolherFormatoAudio()).toBe("");
    expect(podeGravarAudio()).toBe(true);
    tirarMicrofone();
    expect(podeGravarAudio()).toBe(false);
    expect(escolherFormatoAudio()).toBe("");
  });
});

/* =============================================================================
   Gravar pelo microfone
   ============================================================================= */

describe("CaixaEscrever: gravar áudio pelo microfone", () => {
  it("grava, para, ouve e envia o arquivo OGG com a duração", async () => {
    instalarMicrofone();
    vi.useFakeTimers();
    const aoEnviar = vi.fn<(c: string, m: NovaMensagem) => void>();
    const id = novaConversa();
    render(<CaixaEscrever conversaId={id} aoEnviar={aoEnviar} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Gravar áudio: segure e solte, ou clique para gravar" }),
    );
    // Primeiro o navegador pede o microfone.
    expect(screen.getByRole("status", { name: "Pedindo o microfone" })).toBeInTheDocument();
    await esvaziar();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(gravadores).toHaveLength(1);
    expect(gravadores[0]!.opcoes).toEqual({ mimeType: "audio/ogg;codecs=opus" });
    expect(gravadores[0]!.state).toBe("recording");
    expect(screen.getByRole("status", { name: "Gravando áudio, 0:00" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    // Enquanto grava não há enviar: primeiro para, depois ouve.
    expect(screen.queryByRole("button", { name: "Enviar mensagem" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("status", { name: "Gravando áudio, 0:03" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Parar a gravação e ouvir" }));
    expect(gravadores[0]!.state).toBe("inactive");
    // O microfone é solto assim que a gravação para.
    expect(faixas[0]!.stop).toHaveBeenCalled();
    const ouvir = screen.getByRole("button", { name: "Ouvir a gravação antes de enviar" });
    expect(ouvir).toHaveFocus();
    expect(screen.getByText("0:00 / 0:03")).toBeInTheDocument();
    // O "ouvir antes de enviar" toca o arquivo gravado.
    const audio = document.querySelector("audio")!;
    expect(audio).toHaveAttribute("src", urls[0]);
    const tocar = vi.spyOn(audio, "play").mockImplementation(() => Promise.resolve());
    const pausar = vi.spyOn(audio, "pause").mockImplementation(() => {});
    fireEvent.click(ouvir);
    expect(tocar).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("0:01 / 0:03")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2400);
    });
    // Chegou ao fim: volta ao começo, pronto para ouvir de novo.
    expect(
      screen.getByRole("button", { name: "Ouvir a gravação antes de enviar" }),
    ).toBeInTheDocument();
    expect(pausar).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Enviar o áudio" }));
    expect(aoEnviar).toHaveBeenCalledTimes(1);
    const [conv, nova] = aoEnviar.mock.calls[0]!;
    expect(conv).toBe(id);
    expect(nova).toMatchObject({
      tipo: "audio",
      midia: { nome: "audio-gravado.ogg", mime: "audio/ogg", tamanho: 4, duracaoS: 3 },
    });
    expect(nova.arquivo).toBeInstanceOf(Blob);
    expect(nova.arquivo!.type).toBe("audio/ogg;codecs=opus");
    expect(campo()).toBeInTheDocument();
    // O link local do áudio é solto depois de enviar.
    expect(soltas).toContain(urls[0]);
  });

  it("sem OGG no navegador (o Chrome), grava em WebM", async () => {
    instalarMicrofone();
    suportados = ["audio/webm;codecs=opus", "audio/webm"];
    const aoEnviar = vi.fn<(c: string, m: NovaMensagem) => void>();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await esvaziar();
    expect(gravadores[0]!.opcoes).toEqual({ mimeType: "audio/webm;codecs=opus" });
    fireEvent.click(screen.getByRole("button", { name: "Parar a gravação e ouvir" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar o áudio" }));
    expect(aoEnviar.mock.calls[0]![1].midia).toMatchObject({
      nome: "audio-gravado.webm",
      mime: "audio/webm",
    });
  });

  it("segurar e soltar grava; soltar enquanto o navegador pede o microfone segue gravando até clicar", async () => {
    instalarMicrofone();
    const aoEnviar = vi.fn();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    const mic = screen.getByRole("button", { name: /Gravar áudio/ });
    fireEvent.pointerDown(mic, { clientX: 100, pointerId: 1 });
    // Soltou antes do microfone ser liberado (a janela de permissão do navegador).
    fireEvent.pointerUp(screen.getByRole("button", { name: "Pedindo o microfone" }));
    await esvaziar();
    expect(screen.getByText("Clique no botão vermelho para parar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("o navegador não deixou usar o microfone: avisa na caixa e não grava", async () => {
    instalarMicrofone(Object.assign(new Error("negado"), { name: "NotAllowedError" }));
    const aoEnviar = vi.fn();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await esvaziar();
    expect(
      screen.getAllByText(
        "O navegador não deixou usar o microfone. Libere o microfone para este site e tente de novo.",
      ).length,
    ).toBeGreaterThan(0);
    expect(gravadores).toHaveLength(0);
    expect(campo()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fechar o aviso" }));
    expect(screen.queryByRole("button", { name: "Fechar o aviso" })).toBeNull();
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it("navegador sem gravação: avisa e indica o clipe", () => {
    tirarMicrofone();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    expect(screen.getAllByText(/Este navegador não grava áudio/).length).toBeGreaterThan(0);
    expect(campo()).toBeInTheDocument();
  });

  it("cancelar durante a gravação e descartar depois de ouvir não enviam nada e soltam o microfone", async () => {
    instalarMicrofone();
    const aoEnviar = vi.fn();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await esvaziar();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(gravadores[0]!.state).toBe("inactive");
    expect(faixas[0]!.stop).toHaveBeenCalled();
    expect(campo()).toBeInTheDocument();
    expect(screen.getByText("Gravação cancelada.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await esvaziar();
    fireEvent.click(screen.getByRole("button", { name: "Parar a gravação e ouvir" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(campo()).toBeInTheDocument();
    expect(aoEnviar).not.toHaveBeenCalled();
    expect(soltas).toContain(urls[0]);
  });

  it("cancelar enquanto o navegador pede o microfone: o microfone que chegar depois é solto", async () => {
    let liberar!: (s: MediaStream) => void;
    instalarMicrofone();
    getUserMedia.mockImplementation(() => new Promise<MediaStream>((ok) => (liberar = ok)));
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const s = streamFalso();
    liberar(s);
    await esvaziar();
    expect(gravadores).toHaveLength(0);
    expect(faixas.at(-1)!.stop).toHaveBeenCalled();
    expect(campo()).toBeInTheDocument();
  });

  it("aos 2 minutos a gravação para sozinha e vai para o ouvir", async () => {
    instalarMicrofone();
    vi.useFakeTimers();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await esvaziar();
    act(() => {
      vi.advanceTimersByTime(119_000);
    });
    expect(screen.getByRole("status", { name: /Gravando áudio, 1:59/ })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_400);
    });
    expect(screen.queryByRole("status", { name: /Gravando áudio/ })).toBeNull();
    expect(gravadores[0]!.state).toBe("inactive");
    expect(
      screen.getByRole("button", { name: "Ouvir a gravação antes de enviar" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0:00 / 2:00")).toBeInTheDocument();
  });

  it("o bloqueio no meio da gravação encerra a gravação e solta o microfone", async () => {
    instalarMicrofone();
    const id = novaConversa();
    const { rerender } = render(<CaixaEscrever conversaId={id} aoEnviar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await esvaziar();
    expect(screen.getByRole("status", { name: /Gravando áudio/ })).toBeInTheDocument();
    rerender(<CaixaEscrever conversaId={id} bloqueio="sem_conexao" aoEnviar={vi.fn()} />);
    expect(screen.queryByRole("status", { name: /Gravando áudio/ })).toBeNull();
    expect(faixas[0]!.stop).toHaveBeenCalled();
    expect(campo()).toBeDisabled();
  });

  it("trocar de conversa ou sair da tela no meio da gravação solta o microfone", async () => {
    instalarMicrofone();
    const { rerender, unmount } = render(
      <CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await esvaziar();
    rerender(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    expect(faixas[0]!.stop).toHaveBeenCalled();
    expect(campo()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Gravar áudio/ }));
    await esvaziar();
    unmount();
    expect(faixas[1]!.stop).toHaveBeenCalled();
  });
});

/* =============================================================================
   Anexos de verdade
   ============================================================================= */

describe("CaixaEscrever: anexos pelo seletor de arquivos", () => {
  it("o clipe tem Imagem e Documento; o Vídeo fica fora (decisão 5)", () => {
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Anexar imagem ou documento" }));
    const menu = screen.getByRole("menu", { name: "Anexar" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((b) => b.textContent),
    ).toEqual(["Imagem", "Documento"]);
    expect(within(menu).queryByRole("menuitem", { name: "Vídeo" })).toBeNull();
  });

  it("Documento abre o seletor sem filtro; Imagem, só JPEG e PNG", () => {
    const { container } = render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    const clique = vi.spyOn(seletor(container), "click");
    fireEvent.click(screen.getByRole("button", { name: "Anexar imagem ou documento" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Imagem" }));
    expect(clique).toHaveBeenCalledTimes(1);
    expect(seletor(container).accept).toBe("image/jpeg,image/png");
    fireEvent.click(screen.getByRole("button", { name: "Anexar imagem ou documento" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Documento" }));
    expect(clique).toHaveBeenCalledTimes(2);
    expect(seletor(container).accept).toBe("");
    expect(seletor(container).multiple).toBe(true);
  });

  it("o arquivo escolhido aparece, tirar remove, e o anexo vai antes do texto com o arquivo", () => {
    const aoEnviar = vi.fn();
    const id = novaConversa();
    const { container } = render(<CaixaEscrever conversaId={id} aoEnviar={aoEnviar} />);
    const doc = pdf();
    escolher(container, "Documento", [doc]);
    const lista = screen.getByRole("list", { name: "Anexos para enviar" });
    expect(within(lista).getByText("proposta-revisada.pdf")).toBeInTheDocument();
    expect(within(lista).getByText(`PDF · ${doc.size} B`)).toBeInTheDocument();
    // O seletor é limpo: escolher o mesmo arquivo de novo dispara outra vez.
    expect(seletor(container).value).toBe("");

    const foto = jpg();
    escolher(container, "Imagem", [foto]);
    // A foto ganha a prévia local, solta quando sai da caixa.
    const previa = urls.find((u) => u.includes("fachada.jpg"))!;
    expect(lista.querySelector(`img[src="${previa}"]`)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tirar o anexo fachada.jpg" }));
    expect(screen.queryByText("fachada.jpg")).toBeNull();
    expect(soltas).toContain(previa);

    // Só com anexo, o enviar já liga.
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();
    fireEvent.change(campo(), { target: { value: "Segue a proposta" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoEnviar).toHaveBeenCalledTimes(2);
    expect(aoEnviar.mock.calls[0]).toEqual([
      id,
      {
        tipo: "documento",
        midia: { nome: "proposta-revisada.pdf", mime: "application/pdf", tamanho: doc.size },
        arquivo: doc,
      },
    ]);
    expect(aoEnviar.mock.calls[0]![1].arquivo).toBe(doc);
    expect(aoEnviar.mock.calls[1]).toEqual([id, { tipo: "texto", texto: "Segue a proposta" }]);
    expect(screen.queryByRole("list", { name: "Anexos para enviar" })).toBeNull();
  });

  it("JPEG e PNG pela Imagem vão como foto; outra imagem, ou pelo Documento, vai como documento", () => {
    const aoEnviar = vi.fn();
    const { container } = render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    const png = new File(["png"], "planta.png", { type: "image/png" });
    const webp = new File(["webp"], "rascunho.webp", { type: "image/webp" });
    const outraJpg = new File(["jpg"], "obra.jpg", { type: "image/jpeg" });
    escolher(container, "Imagem", [png, webp]);
    expect(screen.getByText("2 anexos prontos para enviar.")).toBeInTheDocument();
    escolher(container, "Documento", [outraJpg]);
    expect(screen.getByText("Anexo obra.jpg pronto para enviar.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    expect(aoEnviar.mock.calls.map((c) => [c[1].tipo, c[1].midia.nome])).toEqual([
      ["imagem", "planta.png"],
      ["documento", "rascunho.webp"],
      ["documento", "obra.jpg"],
    ]);
  });

  it("arquivo acima de 20 MB ou vazio não entra, com o motivo na caixa", () => {
    const { container } = render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    const grande = new File(["x"], "video-da-obra.mp4", { type: "video/mp4" });
    Object.defineProperty(grande, "size", { value: MAX_BYTES_ANEXO + 1 });
    const vazio = new File([], "nada.txt", { type: "text/plain" });
    escolher(container, "Documento", [grande, vazio, pdf()]);
    expect(MAX_BYTES_ANEXO).toBe(20 * 1024 * 1024);
    const aviso = screen.getAllByText(/^Não deu para anexar:/)[0]!;
    expect(aviso).toHaveTextContent("video-da-obra.mp4 tem 20 MB, e o limite do WhatsApp é 20 MB");
    expect(aviso).toHaveTextContent("nada.txt está vazio");
    const lista = screen.getByRole("list", { name: "Anexos para enviar" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(1);
    expect(within(lista).getByText("proposta-revisada.pdf")).toBeInTheDocument();
  });
});

/* =============================================================================
   O envio pela camada de dados: uma por vez, esperando cada uma
   ============================================================================= */

describe("CaixaEscrever: envio que espera a resposta", () => {
  it("chama uma vez por mensagem, esperando a anterior; enquanto espera, não envia de novo", async () => {
    const respostas = [adiada<ResultadoEnvio>(), adiada<ResultadoEnvio>()];
    const aoEnviar = vi.fn(
      (_c: string, _m: NovaMensagem) => respostas[aoEnviar.mock.calls.length - 1]!.promessa,
    );
    const { container } = render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    escolher(container, "Documento", [pdf()]);
    fireEvent.change(campo(), { target: { value: "Segue" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoEnviar).toHaveBeenCalledTimes(1);
    expect(aoEnviar.mock.calls[0]![1].tipo).toBe("documento");
    // Esperando: o botão desliga e um segundo Enter não manda nada.
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeDisabled();
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoEnviar).toHaveBeenCalledTimes(1);

    await act(async () => respostas[0]!.resolver({ ok: true }));
    expect(aoEnviar).toHaveBeenCalledTimes(2);
    expect(aoEnviar.mock.calls[1]![1]).toEqual({ tipo: "texto", texto: "Segue" });
    await act(async () => respostas[1]!.resolver({ ok: true }));
    expect(campo()).toHaveValue("");
    expect(screen.queryByRole("list", { name: "Anexos para enviar" })).toBeNull();
    expect(screen.getByText("2 mensagens enviadas.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anexar imagem ou documento" })).toBeEnabled();
  });

  it("para na primeira recusa: nada mais é chamado e tudo fica na caixa", async () => {
    const aoEnviar = vi.fn(async () => ({ ok: false }) as const);
    const { container } = render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    escolher(container, "Documento", [pdf()]);
    fireEvent.change(campo(), { target: { value: "Segue" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    await esvaziar();
    expect(aoEnviar).toHaveBeenCalledTimes(1);
    expect(campo()).toHaveValue("Segue");
    expect(screen.getByText("proposta-revisada.pdf")).toBeInTheDocument();
    expect(
      screen.getByText("A mensagem não foi enviada. O rascunho continua na caixa."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();
  });

  it("recusa no meio: o que saiu sai da caixa; o texto e a citação ficam", async () => {
    const aoEnviar = vi.fn(async (_c: string, m: NovaMensagem) =>
      m.tipo === "texto" ? { ok: false } : { ok: true },
    );
    const aoTirarCitacao = vi.fn();
    const { container } = render(
      <CaixaEscrever
        conversaId={novaConversa()}
        aoEnviar={aoEnviar}
        citando={{ id: "m7", de: "Ricardo", texto: "Manda a proposta?" }}
        aoTirarCitacao={aoTirarCitacao}
      />,
    );
    escolher(container, "Documento", [pdf()]);
    fireEvent.change(campo(), { target: { value: "Segue" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    await esvaziar();
    await esvaziar();
    expect(aoEnviar).toHaveBeenCalledTimes(2);
    // A citação vai no texto, a 1ª mensagem de texto da leva.
    expect(aoEnviar.mock.calls[1]![1]).toEqual({ tipo: "texto", texto: "Segue", citaId: "m7" });
    expect(screen.queryByRole("list", { name: "Anexos para enviar" })).toBeNull();
    expect(campo()).toHaveValue("Segue");
    expect(aoTirarCitacao).not.toHaveBeenCalled();
    expect(
      screen.getByText("1 de 2 mensagens enviadas. O resto continua na caixa."),
    ).toBeInTheDocument();
  });

  it("a ação que falha (promessa rejeitada) conta como recusa", async () => {
    const aoEnviar = vi.fn(() => Promise.reject(new Error("rede")));
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    fireEvent.change(campo(), { target: { value: "Oi" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    await esvaziar();
    expect(campo()).toHaveValue("Oi");
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeEnabled();
  });

  it("o que a pessoa escreve enquanto espera não some quando o envio termina", async () => {
    const r = adiada<ResultadoEnvio>();
    const aoEnviar = vi.fn(() => r.promessa);
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    fireEvent.change(campo(), { target: { value: "Primeira" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    fireEvent.change(campo(), { target: { value: "Primeira e mais" } });
    await act(async () => r.resolver({ ok: true }));
    expect(campo()).toHaveValue("Primeira e mais");
  });

  it("a citação sai depois que a mensagem com ela foi aceita", async () => {
    const r = adiada<ResultadoEnvio>();
    const aoTirarCitacao = vi.fn();
    render(
      <CaixaEscrever
        conversaId={novaConversa()}
        aoEnviar={() => r.promessa}
        citando={{ id: "m9", de: "Ricardo", texto: "Tem horário?" }}
        aoTirarCitacao={aoTirarCitacao}
      />,
    );
    fireEvent.change(campo(), { target: { value: "Tenho" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoTirarCitacao).not.toHaveBeenCalled();
    await act(async () => r.resolver({ ok: true }));
    expect(aoTirarCitacao).toHaveBeenCalledTimes(1);
  });

  it("a ação da camada de dados entra direto no aoEnviar (o arquivo vai junto)", async () => {
    const enviarMensagem = vi.fn<AcoesDados["enviarMensagem"]>(async () => ({
      ok: true,
      id: "m-novo",
    }));
    const acoes = { enviarMensagem } as unknown as AcoesDados;
    const { container } = render(
      <CaixaEscrever conversaId="cv-1" aoEnviar={acoes.enviarMensagem} />,
    );
    const doc = pdf();
    escolher(container, "Documento", [doc]);
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await esvaziar();
    expect(enviarMensagem).toHaveBeenCalledWith(
      "cv-1",
      expect.objectContaining({ tipo: "documento", arquivo: doc }),
    );
    expect(screen.getByText("Mensagem enviada.")).toBeInTheDocument();
  });
});
