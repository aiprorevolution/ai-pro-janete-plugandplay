import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_LINK_MS,
  Carregando,
  ErroLeitura,
  ProvedorDados,
  VALIDADE_LINK_S,
  Vazio,
  caminhosProntos,
  ehUuid,
  situacaoDaMidia,
  useAbrirPorId,
  useUrlMidia,
  type UrlsMidia,
} from "@/features/plataforma/dados";
import { criarClienteFalso, type OpcoesFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import { criarEstadoInicial } from "@/features/plataforma/exemplo";

// F1: os links assinados das mídias (em lote, 1 h, cache de 50 min, e as situações pendente,
// falhou e expirada), os 3 estados comuns e o abrir pelo id do endereço.

const AGORA = new Date("2026-10-30T17:45:00.000Z");

function banco(filho: ReactNode, opcoes: OpcoesFalso = {}) {
  const f = criarClienteFalso({
    ...opcoes,
    consulta: (c) => (c.tabela === "membros" && c.unica ? { data: null, error: null } : undefined),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const vista = render(
    <QueryClientProvider client={qc}>
      <ProvedorDados fonte="banco" cliente={f.cliente}>
        {filho}
      </ProvedorDados>
    </QueryClientProvider>,
  );
  return { f, qc, vista };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useUrlMidia", () => {
  let lido: UrlsMidia;
  function Links({ caminhos }: { caminhos: string[] }) {
    lido = useUrlMidia(caminhos);
    return null;
  }

  it("pede os links de uma vez (um createSignedUrls), com validade de 1 h", async () => {
    const { f } = banco(<Links caminhos={["cv-1/m-2", "cv-1/m-1", "cv-1/m-2"]} />);
    await waitFor(() => expect(Object.keys(lido.urls)).toHaveLength(2));
    expect(f.assinaturas).toEqual([{ caminhos: ["cv-1/m-1", "cv-1/m-2"], validade: 3600 }]);
    expect(VALIDADE_LINK_S).toBe(3600);
    expect(lido.urls["cv-1/m-1"]).toBe("https://falso/cv-1/m-1?v=3600");
    expect(lido).toMatchObject({ carregando: false, erro: null });
  });

  it("uma mídia nova na tela pede só o link que falta; o que tem menos de 50 min fica", async () => {
    const { f, vista, qc } = banco(<Links caminhos={["a/1", "a/2"]} />);
    await waitFor(() => expect(Object.keys(lido.urls)).toHaveLength(2));
    vista.rerender(
      <QueryClientProvider client={qc}>
        <ProvedorDados fonte="banco" cliente={f.cliente}>
          <Links caminhos={["a/1", "a/2", "a/3"]} />
        </ProvedorDados>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(Object.keys(lido.urls)).toHaveLength(3));
    expect(f.assinaturas.map((a) => a.caminhos)).toEqual([["a/1", "a/2"], ["a/3"]]);
    expect(CACHE_LINK_MS).toBe(50 * 60_000);
  });

  it("depois de 50 min, o link guardado é pedido de novo", async () => {
    const agora = vi.spyOn(Date, "now");
    agora.mockReturnValue(AGORA.getTime());
    const { f, vista, qc } = banco(<Links caminhos={["b/1"]} />);
    await waitFor(() => expect(lido.urls["b/1"]).toBeDefined());
    agora.mockReturnValue(AGORA.getTime() + CACHE_LINK_MS + 1);
    vista.rerender(
      <QueryClientProvider client={qc}>
        <ProvedorDados fonte="banco" cliente={f.cliente}>
          <Links caminhos={["b/1", "b/2"]} />
        </ProvedorDados>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(f.assinaturas).toHaveLength(2));
    expect(f.assinaturas[1]!.caminhos).toEqual(["b/1", "b/2"]);
    agora.mockRestore();
  });

  it("o caminho que o Storage recusa fica sem link; o erro do lote vem traduzido", async () => {
    const { f } = banco(<Links caminhos={["c/1", "c/2"]} />, {
      assinar: (caminhos) => ({
        data: caminhos.map((p) => (p === "c/2" ? { path: p, signedUrl: "", error: "Object not found" } : { path: p, signedUrl: `u:${p}`, error: null })),
        error: null,
      }),
    });
    await waitFor(() => expect(lido.urls).toEqual({ "c/1": "u:c/1" }));
    expect(f.assinaturas).toHaveLength(1);
    cleanup();
    banco(<Links caminhos={["d/1"]} />, { assinar: () => ({ data: null, error: { message: "Failed to fetch" } }) });
    await waitFor(() => expect(lido.erro).toBe("falha"));
  });

  it("nada para pedir (lista vazia, ou modo exemplo): nenhuma chamada", async () => {
    const { f } = banco(<Links caminhos={[]} />);
    expect(lido).toMatchObject({ urls: {}, carregando: false });
    expect(f.assinaturas).toHaveLength(0);
    cleanup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProvedorDados exemplo={() => criarEstadoInicial(AGORA)} progredirEnvios={false}>
          <Links caminhos={["x/1"]} />
        </ProvedorDados>
      </QueryClientProvider>,
    );
    expect(lido).toMatchObject({ urls: {}, carregando: false });
  });

  it("situacaoDaMidia: pendente, falhou, expirada, pronta e sem; só as prontas vão para o lote", () => {
    expect(situacaoDaMidia({ midia_status: "pendente", midia_caminho: null })).toBe("pendente");
    expect(situacaoDaMidia({ midia_status: "falhou", midia_caminho: null })).toBe("falhou");
    expect(situacaoDaMidia({ midia_status: "expirada", midia_caminho: null })).toBe("expirada");
    expect(situacaoDaMidia({ midia_status: "copiada", midia_caminho: "a/1" })).toBe("pronta");
    expect(situacaoDaMidia({ midia_status: null, midia_caminho: null })).toBe("sem");
    expect(
      caminhosProntos([
        { midia_status: "copiada", midia_caminho: "a/1" },
        { midia_status: "pendente", midia_caminho: null },
        { midia_status: "expirada", midia_caminho: "a/3" },
        { midia_status: null, midia_caminho: null },
      ]),
    ).toEqual(["a/1"]);
  });
});

describe("os 3 estados", () => {
  it("Carregando anuncia e repete a forma (lista, cartão, texto)", () => {
    const { container } = render(
      <>
        <Carregando forma="lista" rotulo="Carregando as conversas" />
        <Carregando forma="cartao" quantos={4} />
        <Carregando forma="texto" />
      </>,
    );
    expect(screen.getByRole("status", { name: "Carregando as conversas" })).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector('[data-forma="cartao"]')!.querySelectorAll('[data-forma="bloco"]')).toHaveLength(4);
    expect(container.querySelector('[data-forma="lista"]')!.querySelectorAll('[data-forma="circulo"]')).toHaveLength(3);
  });

  it("Vazio é o EstadoVazio do AI PRO", () => {
    render(<Vazio oQueFalta="Nenhum contato ainda" porQueImporta="Eles chegam pelo WhatsApp." acao={null} />);
    expect(screen.getByRole("heading", { name: "Nenhum contato ainda" })).toBeInTheDocument();
  });

  it("ErroLeitura mostra o aviso e o Tentar de novo chama a leitura de novo", () => {
    const tentar = vi.fn();
    render(<ErroLeitura tentarDeNovo={tentar} erro="falha" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não deu para carregar");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(tentar).toHaveBeenCalledTimes(1);
  });
});

describe("useAbrirPorId", () => {
  const ID = "44444444-4444-4444-8444-444444444444";

  function Abrir(props: {
    valor: string | null;
    pronto: boolean;
    buscar: (id: string) => unknown;
    abrir: (x: unknown) => void;
    limpar: () => void;
    naoAchou?: () => void;
  }) {
    const situacao = useAbrirPorId(props.valor, props.buscar, {
      pronto: props.pronto,
      abrir: props.abrir,
      limpar: props.limpar,
      naoAchou: props.naoAchou,
    });
    return <span data-testid="situacao">{situacao}</span>;
  }

  it("espera a lista carregar, busca (fora da página também), abre e limpa o endereço", async () => {
    const buscar = vi.fn(async (id: string) => ({ id }));
    const abrir = vi.fn();
    const limpar = vi.fn();
    const props = { valor: ID, buscar, abrir, limpar };
    const { f, qc, vista } = banco(<Abrir {...props} pronto={false} />);
    expect(screen.getByTestId("situacao")).toHaveTextContent("esperando");
    expect(buscar).not.toHaveBeenCalled();
    vista.rerender(
      <QueryClientProvider client={qc}>
        <ProvedorDados fonte="banco" cliente={f.cliente}>
          <Abrir {...props} pronto />
        </ProvedorDados>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(abrir).toHaveBeenCalledWith({ id: ID }));
    expect(buscar).toHaveBeenCalledWith(ID);
    expect(limpar).toHaveBeenCalledTimes(1);
  });

  it("no banco, o id que não é uuid nem vai à busca: limpa e avisa", async () => {
    const buscar = vi.fn();
    const limpar = vi.fn();
    const naoAchou = vi.fn();
    banco(<Abrir valor="cv-1'; drop" pronto buscar={buscar} abrir={vi.fn()} limpar={limpar} naoAchou={naoAchou} />);
    await waitFor(() => expect(limpar).toHaveBeenCalledTimes(1));
    expect(buscar).not.toHaveBeenCalled();
    expect(naoAchou).toHaveBeenCalledTimes(1);
    expect(ehUuid(ID)).toBe(true);
    expect(ehUuid("cv-1")).toBe(false);
  });

  it("não achou (apagado, ou a RLS esconde): avisa e limpa", async () => {
    const abrir = vi.fn();
    const limpar = vi.fn();
    const naoAchou = vi.fn();
    banco(<Abrir valor={ID} pronto buscar={async () => null} abrir={abrir} limpar={limpar} naoAchou={naoAchou} />);
    await waitFor(() => expect(naoAchou).toHaveBeenCalledTimes(1));
    expect(abrir).not.toHaveBeenCalled();
    expect(limpar).toHaveBeenCalledTimes(1);
  });

  it("no modo exemplo, aceita os ids do exemplo (cv-...)", async () => {
    const abrir = vi.fn();
    render(
      <ProvedorDados exemplo={() => criarEstadoInicial(AGORA)} progredirEnvios={false}>
        <Abrir valor="cv-ricardo" pronto buscar={(id) => ({ id })} abrir={abrir} limpar={vi.fn()} />
      </ProvedorDados>,
    );
    await waitFor(() => expect(abrir).toHaveBeenCalledWith({ id: "cv-ricardo" }));
    await act(async () => {});
  });
});
