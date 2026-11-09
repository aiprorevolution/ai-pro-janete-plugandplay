import { readFileSync } from "node:fs";
import path from "node:path";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ListaDeVozes,
  MENSAGEM_SEM_RESPOSTA,
  MENSAGEM_SEM_SESSAO,
  MENSAGEM_SEM_VOZES,
  separarMensagem,
  useListaVozes,
  type EstadoListaVozes,
} from "@/features/onboarding/lista";
import type { ResultadoListaVozes, VozDaConta, VozEscolhida } from "@/features/servidor/vozes-tipos";

// F4 da spec do uso da voz (docs/spec-voz-uso.md): a lista de vozes comum à Configuração e ao
// onboarding. A prévia toca num <audio> só: o play e o pause do HTMLMediaElement são dublês.

const getSession = vi.fn();
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getSession: () => getSession() } } }));

const PASTA = path.resolve(__dirname, "../features/onboarding/lista");

function voz(id: string, extra: Partial<VozDaConta> = {}): VozDaConta {
  return { id, nome: `Voz ${id}`, detalhe: null, portugues: false, previa: null, ...extra };
}

const A = voz("a", { nome: "Ana", detalhe: "Feminina · brasileira", portugues: true, previa: "https://cdn.exemplo.test/a.mp3" });
const B = voz("b", { nome: "Bruno", detalhe: "Masculina", previa: "https://cdn.exemplo.test/b.mp3" });
const C = voz("c", { nome: "Clara" });
const TRES = [A, B, C];

const pronta = (vozes: VozDaConta[], atual: VozEscolhida | null = null): EstadoListaVozes => ({ k: "pronta", vozes, atual });

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as unknown as () => Promise<void>);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause as unknown as () => void);
  getSession.mockResolvedValue({ data: { session: { user: { id: "u" } } } });
});

afterEach(() => {
  // desmonta antes de tirar os dublês: a desmontagem para a prévia (e o jsdom não tem pause)
  cleanup();
  vi.restoreAllMocks();
});

type PropsLista = Partial<Parameters<typeof ListaDeVozes>[0]>;

/** A lista com o valor guardado como quem usa guarda (o aoMudar marca a voz). */
function ListaComValor({ inicial = null, aoMudar, ...props }: PropsLista & { inicial?: string | null }) {
  const [valor, setValor] = useState<string | null>(inicial);
  return (
    <ListaDeVozes
      estado={pronta(TRES)}
      aoRecarregar={() => {}}
      rotulo="Vozes da conta"
      idBase="voz"
      {...props}
      valor={valor}
      aoMudar={(id) => {
        aoMudar?.(id);
        setValor(id);
      }}
    />
  );
}

/** O hook e a lista juntos, com um botão de recarregar por fora (como o Fluxo faria). */
function ComBusca({ carregar, aoEntrarDeNovo }: { carregar: (() => Promise<ResultadoListaVozes>) | null; aoEntrarDeNovo?: () => void }) {
  const { estado, recarregar } = useListaVozes(carregar);
  const [valor, setValor] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={recarregar}>
        Recarregar por fora
      </button>
      <ListaDeVozes
        estado={estado}
        valor={valor}
        aoMudar={setValor}
        aoRecarregar={recarregar}
        {...(aoEntrarDeNovo ? { aoEntrarDeNovo } : {})}
        rotulo="Vozes da conta"
        idBase="voz"
      />
    </>
  );
}

function adiada<T>() {
  let resolver!: (v: T) => void;
  let recusar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    recusar = rej;
  });
  return { promessa, resolver, recusar };
}

const radios = () => screen.getAllByRole("radio");
const audio = () => document.querySelector("audio") as HTMLAudioElement;

describe("ListaDeVozes: o grupo de opções", () => {
  it("é um radiogroup com o rótulo, e cada linha mostra o nome, o detalhe e o selo Português", () => {
    render(<ListaComValor />);
    const grupo = screen.getByRole("radiogroup", { name: "Vozes da conta" });
    expect(within(grupo).getAllByRole("radio")).toHaveLength(3);
    const ana = screen.getByRole("radio", { name: /Ana/ });
    expect(ana).toHaveTextContent("Feminina · brasileira");
    expect(ana).toHaveTextContent("Português");
    expect(screen.getByRole("radio", { name: /Bruno/ })).not.toHaveTextContent("Português");
    // sem valor: só a primeira entra no Tab
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it("as setas, Home e End mudam a voz marcada e levam o foco junto", () => {
    const aoMudar = vi.fn();
    render(<ListaComValor inicial="a" aoMudar={aoMudar} />);
    const [r0, r1, r2] = radios() as [HTMLElement, HTMLElement, HTMLElement];
    r0.focus();
    fireEvent.keyDown(r0, { key: "ArrowDown" });
    expect(aoMudar).toHaveBeenLastCalledWith("b");
    expect(r1).toHaveAttribute("aria-checked", "true");
    expect(r0).toHaveAttribute("aria-checked", "false");
    expect(document.activeElement).toBe(r1);
    expect(r1.tabIndex).toBe(0);

    fireEvent.keyDown(r1, { key: "End" });
    expect(aoMudar).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(r2);

    // da última, a seta para baixo volta para a primeira
    fireEvent.keyDown(r2, { key: "ArrowRight" });
    expect(aoMudar).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(r0);

    fireEvent.keyDown(r0, { key: "ArrowUp" });
    expect(aoMudar).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(r2);

    fireEvent.keyDown(r2, { key: "Home" });
    expect(aoMudar).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(r0);
    expect(aoMudar).toHaveBeenCalledTimes(5);
  });

  it("o clique chama aoMudar uma vez (e não chama de novo na voz já marcada)", () => {
    const aoMudar = vi.fn();
    render(<ListaComValor aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("radio", { name: /Bruno/ }));
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByRole("radio", { name: /Bruno/ }));
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("ocupada mostra Salvando… na linha e não aceita outra escolha", () => {
    const aoMudar = vi.fn();
    render(<ListaComValor inicial="a" ocupada="a" aoMudar={aoMudar} />);
    expect(screen.getByRole("radio", { name: /Ana/ })).toHaveTextContent("Salvando…");
    expect(screen.getByRole("radio", { name: /Bruno/ })).not.toHaveTextContent("Salvando…");
    for (const r of radios()) expect(r).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("radio", { name: /Bruno/ }));
    fireEvent.keyDown(radios()[0]!, { key: "ArrowDown" });
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("com a voz atual fora da lista, avisa para escolher outra", () => {
    render(<ListaComValor estado={pronta(TRES, { id: "zz", nome: "Rita" })} />);
    expect(screen.getByText("A voz Rita não está nesta conta. Escolha outra.")).toBeInTheDocument();
  });

  it("com a voz atual na lista, não avisa", () => {
    render(<ListaComValor estado={pronta(TRES, { id: "b", nome: "Bruno" })} />);
    expect(screen.queryByText(/não está nesta conta/)).toBeNull();
  });

  it("mostra 6 vozes, e o Mostrar mais acrescenta 6 de cada vez (o foco vai para a 1ª nova)", () => {
    const muitas = Array.from({ length: 14 }, (_, i) => voz(`v${i}`, { nome: `Voz ${String(i).padStart(2, "0")}` }));
    render(<ListaComValor estado={pronta(muitas)} />);
    expect(radios()).toHaveLength(6);
    expect(screen.getByText("Mostrando 6 de 14 vozes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais" }));
    expect(radios()).toHaveLength(12);
    expect(document.activeElement).toBe(radios()[6]);
    expect(screen.getByText("Mostrando 12 de 14 vozes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais" }));
    expect(radios()).toHaveLength(14);
    expect(screen.queryByRole("button", { name: "Mostrar mais" })).toBeNull();
  });

  it("a voz marcada além das 6 primeiras continua à vista", () => {
    const muitas = Array.from({ length: 10 }, (_, i) => voz(`v${i}`));
    render(<ListaComValor estado={pronta(muitas)} inicial="v8" />);
    expect(radios()).toHaveLength(7);
    expect(radios()[6]).toHaveAttribute("aria-checked", "true");
    expect(radios()[6]!.tabIndex).toBe(0);
  });
});

describe("ListaDeVozes: a prévia", () => {
  it("Ouvir toca a prévia, e tocar outra para a anterior", () => {
    render(<ListaComValor />);
    const ouvirA = screen.getByRole("button", { name: "Ouvir a voz Ana" });
    expect(ouvirA).toHaveAttribute("aria-pressed", "false");
    // a Clara não tem prévia: sem botão
    expect(screen.queryByRole("button", { name: "Ouvir a voz Clara" })).toBeNull();
    // um <audio> só, e nada carrega antes do clique
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    expect(audio().getAttribute("preload")).toBe("none");
    expect(play).not.toHaveBeenCalled();

    fireEvent.click(ouvirA);
    expect(play).toHaveBeenCalledTimes(1);
    expect(audio().src).toBe(A.previa);
    const pararA = screen.getByRole("button", { name: "Parar a voz Ana" });
    expect(pararA).toHaveAttribute("aria-pressed", "true");
    expect(pause).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ouvir a voz Bruno" }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(2);
    expect(audio().src).toBe(B.previa);
    expect(screen.getByRole("button", { name: "Ouvir a voz Ana" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Parar a voz Bruno" })).toHaveAttribute("aria-pressed", "true");

    // clicar de novo para
    fireEvent.click(screen.getByRole("button", { name: "Parar a voz Bruno" }));
    expect(pause).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Ouvir a voz Bruno" })).toHaveAttribute("aria-pressed", "false");
  });

  it("o Ouvir fica fora da opção e fora do grupo, numa coluna irmã, e ouvir não escolhe a voz", () => {
    const aoMudar = vi.fn();
    render(<ListaComValor aoMudar={aoMudar} />);
    const grupo = screen.getByRole("radiogroup", { name: "Vozes da conta" });
    const ouvir = screen.getByRole("button", { name: "Ouvir a voz Ana" });
    expect(ouvir.closest("[role='radio']")).toBeNull();
    expect(grupo).not.toContainElement(ouvir);
    // a coluna do Ouvir é irmã do grupo, na mesma grade
    expect(ouvir.parentElement?.parentElement).toBe(grupo.parentElement);
    expect(ouvir).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(ouvir);
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("o radiogroup só tem filhos com role radio (WAI-ARIA, aria-required-children)", () => {
    render(<ListaComValor />);
    const grupo = screen.getByRole("radiogroup", { name: "Vozes da conta" });
    const filhos = [...grupo.children];
    expect(filhos).toHaveLength(3);
    for (const f of filhos) expect(f).toHaveAttribute("role", "radio");
    // e nenhum outro controle dentro dele
    expect(within(grupo).queryAllByRole("button")).toHaveLength(0);
  });

  it("cada Ouvir fica na faixa da sua voz (a mesma linha da grade), também depois do Mostrar mais", () => {
    const muitas = Array.from({ length: 9 }, (_, i) =>
      voz(`v${i}`, { nome: `Voz ${i}`, previa: i % 3 === 2 ? null : `https://cdn.exemplo.test/${i}.mp3` }),
    );
    render(<ListaDeVozes estado={pronta(muitas)} valor={null} aoMudar={() => {}} aoRecarregar={() => {}} rotulo="Vozes da conta" idBase="voz" />);
    const confere = (n: number) => {
      const grupo = screen.getByRole("radiogroup", { name: "Vozes da conta" });
      expect(grupo.parentElement?.style.gridTemplateRows).toBe(`repeat(${n}, auto)`);
      expect(within(grupo).getAllByRole("radio")).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        const ouvir = screen.queryByRole("button", { name: `Ouvir a voz Voz ${i}` });
        if (i % 3 === 2) expect(ouvir).toBeNull();
        else expect(ouvir?.style.gridRow).toBe(`${i + 1}`);
      }
    };
    confere(6);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar mais" }));
    confere(9);
  });

  it("o fim da prévia volta o botão para Ouvir", () => {
    render(<ListaComValor />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvir a voz Ana" }));
    fireEvent(audio(), new Event("ended"));
    expect(screen.getByRole("button", { name: "Ouvir a voz Ana" })).toHaveAttribute("aria-pressed", "false");
  });

  it("desmontar para a prévia", () => {
    const { unmount } = render(<ListaComValor />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvir a voz Ana" }));
    expect(pause).not.toHaveBeenCalled();
    unmount();
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("o play recusado avisa sem quebrar a tela", async () => {
    play.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    render(<ListaComValor />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ouvir a voz Ana" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Não deu para tocar a prévia.");
    expect(screen.getByRole("button", { name: "Ouvir a voz Ana" })).toHaveAttribute("aria-pressed", "false");
    expect(radios()).toHaveLength(3);
    // a próxima tentativa limpa o aviso
    play.mockImplementation(() => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Ouvir a voz Bruno" }));
    expect(screen.queryByText("Não deu para tocar a prévia.")).toBeNull();
  });

  it("desligado desliga tudo e para a prévia", () => {
    const aoMudar = vi.fn();
    const muitas = [A, B, ...Array.from({ length: 8 }, (_, i) => voz(`v${i}`))];
    const { rerender } = render(<ListaComValor estado={pronta(muitas)} aoMudar={aoMudar} />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvir a voz Ana" }));
    expect(pause).not.toHaveBeenCalled();
    rerender(<ListaComValor estado={pronta(muitas)} aoMudar={aoMudar} desligado />);
    expect(pause).toHaveBeenCalledTimes(1);
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
    for (const r of radios()) expect(r).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ouvir a voz Ana" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("radio", { name: /Bruno/ }));
    expect(aoMudar).not.toHaveBeenCalled();
  });
});

describe("ListaDeVozes: os outros estados", () => {
  const base = { valor: null, aoMudar: () => {}, rotulo: "Vozes da conta", idBase: "voz" };

  it("parada não mostra nada", () => {
    const { container } = render(<ListaDeVozes {...base} estado={{ k: "parada" }} aoRecarregar={() => {}} />);
    expect(container.firstElementChild).not.toBeVisible();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("carregando mostra o texto e os ossos", () => {
    render(<ListaDeVozes {...base} estado={{ k: "carregando" }} aoRecarregar={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Buscando as vozes da conta…");
    expect(document.querySelector("[data-estado='carregando'] [aria-hidden='true']")).not.toBeNull();
  });

  it("a lista vazia ensina e tem Atualizar a lista", () => {
    const aoRecarregar = vi.fn();
    render(<ListaDeVozes {...base} estado={pronta([])} aoRecarregar={aoRecarregar} />);
    expect(
      screen.getByText(
        "A conta da ElevenLabs ainda não tem vozes. Adicione uma em My Voices, na ElevenLabs, e atualize a lista.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar a lista" }));
    expect(aoRecarregar).toHaveBeenCalledTimes(1);
  });

  it("falhou mostra o título, o texto e Tentar de novo", () => {
    const aoRecarregar = vi.fn();
    render(
      <ListaDeVozes {...base} estado={{ k: "falhou", titulo: "Sem crédito.", texto: "Recarregue a conta.", semSessao: false }} aoRecarregar={aoRecarregar} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Sem crédito. Recarregue a conta.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(aoRecarregar).toHaveBeenCalledTimes(1);
  });
});

describe("useListaVozes", () => {
  it("sem carregar, fica parada e não busca", () => {
    render(<ComBusca carregar={null} />, { reactStrictMode: true });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/Buscando/)).toBeNull();
  });

  it("busca uma vez no modo estrito, e ignora a resposta velha", async () => {
    const primeira = adiada<ResultadoListaVozes>();
    const segunda = adiada<ResultadoListaVozes>();
    const carregar = vi.fn().mockReturnValueOnce(primeira.promessa).mockReturnValueOnce(segunda.promessa);
    render(<ComBusca carregar={carregar} />, { reactStrictMode: true });
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Buscando as vozes da conta…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recarregar por fora" }));
    expect(carregar).toHaveBeenCalledTimes(2);

    await act(async () => {
      segunda.resolver({ ok: true, vozes: [B], atual: null });
    });
    expect(screen.getByRole("radio", { name: /Bruno/ })).toBeInTheDocument();
    // a primeira chega depois: é velha, fica de fora
    await act(async () => {
      primeira.resolver({ ok: true, vozes: [A, C], atual: null });
    });
    expect(radios()).toHaveLength(1);
    expect(screen.queryByRole("radio", { name: /Ana/ })).toBeNull();
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("a resposta do modo estrito chega (o montado religa na remontagem)", async () => {
    const carregar = vi.fn(() => Promise.resolve<ResultadoListaVozes>({ ok: true, vozes: TRES, atual: null }));
    render(<ComBusca carregar={carregar} />, { reactStrictMode: true });
    expect(await screen.findAllByRole("radio")).toHaveLength(3);
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it("sem_sessao mostra a mensagem da sessão e Entrar de novo", async () => {
    const aoEntrarDeNovo = vi.fn();
    const carregar = vi.fn(() => Promise.resolve<ResultadoListaVozes>({ ok: false, erro: "sem_sessao" }));
    render(<ComBusca carregar={carregar} aoEntrarDeNovo={aoEntrarDeNovo} />, { reactStrictMode: true });
    const { titulo, texto } = separarMensagem(MENSAGEM_SEM_SESSAO);
    expect(await screen.findByRole("alert")).toHaveTextContent(`${titulo} ${texto}`);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Entrar de novo" }));
    expect(aoEntrarDeNovo).toHaveBeenCalledTimes(1);
  });

  it("a mensagem do servidor vira título e texto, e Tentar de novo busca outra vez", async () => {
    const carregar = vi
      .fn<() => Promise<ResultadoListaVozes>>()
      .mockResolvedValueOnce({ ok: false, erro: "sem_credito", mensagem: "A conta está sem crédito. Recarregue na ElevenLabs." })
      .mockResolvedValueOnce({ ok: true, vozes: TRES, atual: null });
    render(<ComBusca carregar={carregar} />, { reactStrictMode: true });
    const alerta = await screen.findByRole("alert");
    expect(alerta.querySelector("b")).toHaveTextContent("A conta está sem crédito.");
    expect(alerta).toHaveTextContent("Recarregue na ElevenLabs.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findAllByRole("radio")).toHaveLength(3);
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it("uma exceção vira a mensagem própria da lista (não a do teste da chave)", async () => {
    const carregar = vi.fn(() => Promise.reject(new Error("rede")));
    render(<ComBusca carregar={carregar} />, { reactStrictMode: true });
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(separarMensagem(MENSAGEM_SEM_VOZES).titulo);
    expect(alerta).not.toHaveTextContent(separarMensagem(MENSAGEM_SEM_RESPOSTA).titulo);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });

  it("um erro sem mensagem conhecida também usa a mensagem da lista", async () => {
    const carregar = vi.fn(() => Promise.resolve({ ok: false as const, erro: "algo_novo" }));
    render(<ComBusca carregar={carregar} />, { reactStrictMode: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(separarMensagem(MENSAGEM_SEM_VOZES).titulo);
  });

  it("resposta fora do formato vira falha, nunca 'Buscando…' sem fim", async () => {
    const semNada = vi.fn(() => Promise.resolve(undefined as unknown as ResultadoListaVozes));
    const { unmount } = render(<ComBusca carregar={semNada} />, { reactStrictMode: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(separarMensagem(MENSAGEM_SEM_VOZES).titulo);
    expect(screen.queryByText(/Buscando/)).toBeNull();
    unmount();
    const semLista = vi.fn(() => Promise.resolve({ ok: true, atual: null } as unknown as ResultadoListaVozes));
    render(<ComBusca carregar={semLista} />, { reactStrictMode: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(separarMensagem(MENSAGEM_SEM_VOZES).titulo);
  });

  it("lista vazia com voz escolhida também avisa que a voz não está na conta", async () => {
    const carregar = vi.fn(() => Promise.resolve({ ok: true as const, vozes: [], atual: { id: "xyz", nome: "Antiga" } }));
    render(<ComBusca carregar={carregar} />, { reactStrictMode: true });
    expect(await screen.findByText("A voz Antiga não está nesta conta. Escolha outra.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar a lista" })).toBeInTheDocument();
  });

  it("uma exceção com a sessão terminada vira Entrar de novo", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const carregar = vi.fn(() => Promise.reject(new Error("401")));
    render(<ComBusca carregar={carregar} />, { reactStrictMode: true });
    expect(await screen.findByRole("button", { name: "Entrar de novo" })).toBeInTheDocument();
  });

  it("carregar que vira nulo esquece a lista, e a resposta que chega depois é ignorada", async () => {
    const pendente = adiada<ResultadoListaVozes>();
    const carregar = vi.fn(() => pendente.promessa);
    const { rerender } = render(<ComBusca carregar={carregar} />, { reactStrictMode: true });
    rerender(<ComBusca carregar={null} />);
    await act(async () => {
      pendente.resolver({ ok: true, vozes: TRES, atual: null });
    });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/Buscando/)).toBeNull();
    // volta a chave: busca de novo
    rerender(<ComBusca carregar={() => Promise.resolve({ ok: true, vozes: [C], atual: null })} />);
    expect(await screen.findAllByRole("radio")).toHaveLength(1);
  });
});

describe("SeletorVoz: código e CSS", () => {
  const codigo = readFileSync(path.join(PASTA, "SeletorVoz.tsx"), "utf-8");

  it("cada classe declarada existe no SeletorVoz.module.css", () => {
    const css = readFileSync(path.join(PASTA, "SeletorVoz.module.css"), "utf-8");
    const declaradas = [...(codigo.match(/Classes<([\s\S]+?)>/)?.[1] ?? "").matchAll(/"([\w-]+)"/g)].map((m) => m[1]!);
    expect(declaradas.length).toBeGreaterThan(10);
    const faltando = declaradas.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(faltando).toEqual([]);
  });

  it("os toques têm 44 px e não há cor fora dos tokens", () => {
    const css = readFileSync(path.join(PASTA, "SeletorVoz.module.css"), "utf-8");
    expect(css).toMatch(/\.ouvir \{[^}]*min-height: 44px/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("não usa o exemplo nem o banco direto", () => {
    expect(codigo).not.toMatch(/useExemplo|\.from\(|\.rpc\(/);
  });
});
