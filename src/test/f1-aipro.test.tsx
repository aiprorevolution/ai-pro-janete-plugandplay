import { QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  AncoraBotao,
  AnelProgresso,
  AreaTexto,
  Avatar,
  Aviso,
  BarraProgresso,
  Botao,
  BotaoIcone,
  BotaoLink,
  Campo,
  CampoSenha,
  Cartao,
  CartaoLink,
  CartaoTopo,
  Chip,
  Dica,
  Esqueleto,
  Estado,
  EstadoVazio,
  Giro,
  Pagina,
  Recolhivel,
  Selo,
  cx,
  iniciais,
} from "@/components/aipro";
import { readFileSync } from "node:fs";
import path from "node:path";

// Lidos do disco: no Vitest o CSS não é processado e o `?raw` volta vazio.
const cssAiPro = readFileSync(path.resolve(__dirname, "../styles/aipro.css"), "utf-8");
const cssApp = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");

/** Monta um roteador de memória só para os componentes que usam o `Link` do TanStack. */
async function renderComRoteador(conteudo: ReactNode) {
  const raiz = createRootRoute({ component: () => <>{conteudo}</> });
  const roteador = createRouter({
    routeTree: raiz,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: new QueryClient() },
  });
  render(<RouterProvider router={roteador as never} />);
  await screen.findByTestId("pronto");
}

describe("tokens AI PRO", () => {
  it("o styles.css importa os tokens depois do Tailwind, sem tirar o shadcn", () => {
    const tailwind = cssApp.indexOf('@import "tailwindcss"');
    const aipro = cssApp.indexOf('@import "./styles/aipro.css"');
    expect(tailwind).toBeGreaterThanOrEqual(0);
    expect(aipro).toBeGreaterThan(tailwind);
    expect(cssApp).toContain("--color-primary: var(--primary)");
  });

  it("declara as cores, a fonte do Google Fonts e a ponte de movimento que os componentes leem", () => {
    for (const token of [
      "--sb-azul: #0b91f8",
      "--sb-navy: #0e1531",
      "--sb-canvas: #f5f7fa",
      "--sb-fonte: 'Poppins'",
      "--sb-fonte-mono: 'Geist Mono'",
      "--app-t-state:",
      "--app-t-touch:",
      "--app-motion-reveal:",
      "--via-ease-out:",
      "--via-z-tooltip:",
    ]) {
      expect(cssAiPro).toContain(token);
    }
    expect(cssAiPro).not.toContain("--font-poppins");
  });
});

describe("componentes AI PRO", () => {
  it("cx junta classes e iniciais deriva do nome", () => {
    expect(cx("a", false, undefined, "b")).toBe("a b");
    expect(iniciais("Ana Ribeiro")).toBe("AR");
    expect(iniciais("Janete")).toBe("JA");
    expect(iniciais("")).toBe("?");
  });

  it("Botao: variante, tamanho e carregando", () => {
    const aoClicar = vi.fn();
    const { rerender } = render(
      <Botao variante="contorno" tamanho="grande" onClick={aoClicar}>
        Testar conexão
      </Botao>,
    );
    const botao = screen.getByRole("button", { name: "Testar conexão" });
    expect(botao).toHaveAttribute("type", "button");
    expect(botao).toHaveAttribute("data-variante", "contorno");
    expect(botao).toHaveAttribute("data-tamanho", "grande");
    fireEvent.click(botao);
    expect(aoClicar).toHaveBeenCalledTimes(1);

    rerender(<Botao carregando>Testar conexão</Botao>);
    const ocupado = screen.getByRole("button", { name: "Testar conexão" });
    expect(ocupado).toBeDisabled();
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    expect(ocupado).toHaveAttribute("data-variante", "principal");
  });

  it("BotaoIcone: nome acessível, dica e ponto", () => {
    const { container } = render(
      <BotaoIcone rotulo="Fechar" icone={<svg />} ponto pressionado={false} />,
    );
    const botao = screen.getByRole("button", { name: "Fechar" });
    expect(botao).toHaveAttribute("aria-pressed", "false");
    expect(container).toHaveTextContent("Fechar");
  });

  it("BotaoLink e CartaoLink navegam pelo TanStack Router; AncoraBotao abre fora em nova aba", async () => {
    await renderComRoteador(
      <div data-testid="pronto">
        <BotaoLink to="/" variante="suave">
          Ir para o início
        </BotaoLink>
        <CartaoLink to="/" aria-label="Abrir o chat">
          <CartaoTopo titulo="Chat" />
        </CartaoLink>
        <AncoraBotao href="https://exemplo.invalid/docs" externo variante="contorno">
          Ver documentação
        </AncoraBotao>
      </div>,
    );

    const link = screen.getByRole("link", { name: "Ir para o início" });
    expect(link).toHaveAttribute("href", "/");
    expect(link).toHaveAttribute("data-variante", "suave");

    const cartao = screen.getByRole("link", { name: "Abrir o chat" });
    expect(cartao).toHaveAttribute("href", "/");
    expect(cartao).toHaveAttribute("data-interativo", "true");

    const externo = screen.getByRole("link", { name: "Ver documentação" });
    expect(externo).toHaveAttribute("target", "_blank");
    expect(externo).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("Campo: rótulo ligado, dica e erro descritos", () => {
    const { rerender } = render(<Campo id="numero" rotulo="Número" dica="Com DDD" />);
    const campo = screen.getByLabelText("Número");
    expect(campo).toHaveAttribute("aria-describedby", "numero-dica");
    expect(screen.getByText("Com DDD")).toBeInTheDocument();

    rerender(<Campo id="numero" rotulo="Número" erro="Número não encontrado" />);
    const invalido = screen.getByLabelText("Número");
    expect(invalido).toHaveAttribute("aria-invalid", "true");
    expect(invalido).toHaveAttribute("aria-describedby", "numero-erro");
    expect(screen.getByText("Número não encontrado")).toBeInTheDocument();
  });

  it("CampoSenha: mostra e esconde o que foi digitado", () => {
    render(<CampoSenha id="chave" rotulo="Chave de API" rotuloMostrar="Mostrar chave" />);
    const entrada = screen.getByLabelText("Chave de API");
    expect(entrada).toHaveAttribute("type", "password");

    const alternar = screen.getByRole("button", { name: "Mostrar chave" });
    fireEvent.click(alternar);
    expect(entrada).toHaveAttribute("type", "text");
    expect(alternar).toHaveAttribute("aria-pressed", "true");
  });

  it("AreaTexto: rótulo e contador quando o valor é controlado", () => {
    render(
      <AreaTexto id="oferta" rotulo="O que a empresa vende" value="abc" onChange={() => {}} maxCaracteres={10} />,
    );
    const area = screen.getByLabelText("O que a empresa vende");
    expect(area.tagName).toBe("TEXTAREA");
    expect(area).toHaveAttribute("rows", "4");
    expect(screen.getByText("3/10")).toBeInTheDocument();
    expect(area).toHaveAttribute("aria-describedby", "oferta-contador");
  });

  it("Cartao e CartaoTopo: superfície, título, passo e ação", () => {
    render(
      <Cartao ariaLabelledby="t" tom="azul" data-testid="cartao">
        <CartaoTopo
          id="t"
          titulo="Conecte o WhatsApp"
          meta="Passo 1 de 3"
          apoio="Escolha como a Janete recebe as mensagens."
          passo={{ numero: 1, estado: "atual" }}
          acao={<Botao tamanho="compacto">Começar</Botao>}
        />
      </Cartao>,
    );
    const cartao = screen.getByRole("region", { name: "Conecte o WhatsApp" });
    expect(cartao).toHaveAttribute("data-tom", "azul");
    expect(screen.getByTestId("cartao")).toBe(cartao);
    expect(screen.getByText("Passo 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Começar" })).toBeInTheDocument();
  });

  it("Chip: alternância e remoção", () => {
    const aoClicar = vi.fn();
    const aoRemover = vi.fn();
    render(<Chip rotulo="Vendas" selecionado aoClicar={aoClicar} aoRemover={aoRemover} total={3} />);
    const alvo = screen.getByRole("button", { pressed: true });
    expect(alvo).toHaveTextContent("Vendas3");
    expect(alvo).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(alvo);
    fireEvent.click(screen.getByRole("button", { name: "Remover Vendas" }));
    expect(aoClicar).toHaveBeenCalledTimes(1);
    expect(aoRemover).toHaveBeenCalledTimes(1);
  });

  it("Aviso: erro é alerta, info é status, e pode ser dispensado", () => {
    const aoFechar = vi.fn();
    const { rerender } = render(<Aviso tom="erro" titulo="A chave não foi aceita">Confira se copiou inteira.</Aviso>);
    expect(screen.getByRole("alert")).toHaveTextContent("A chave não foi aceitaConfira se copiou inteira.");

    rerender(
      <Aviso tom="info" aoFechar={aoFechar}>
        A URL do webhook fica ativa quando o processamento for ligado.
      </Aviso>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("data-tom", "info");
    fireEvent.click(screen.getByRole("button", { name: "Dispensar aviso" }));
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("BarraProgresso e AnelProgresso: valor acessível e casas", () => {
    render(
      <>
        <BarraProgresso valor={140} rotulo="Progresso do onboarding" />
        <BarraProgresso valor={40} rotulo="Etapas" segmentos={5} textoValor="2 de 5 etapas" />
        <AnelProgresso valor={50} rotulo="Metade" conteudo="4" />
      </>,
    );
    expect(screen.getByRole("progressbar", { name: "Progresso do onboarding" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    const casas = screen.getByRole("progressbar", { name: "Etapas" });
    expect(casas).toHaveAttribute("aria-valuetext", "2 de 5 etapas");
    expect(casas.children).toHaveLength(5);
    expect(casas.querySelectorAll("[data-feita]")).toHaveLength(2);
    expect(screen.getByRole("progressbar", { name: "Metade" })).toHaveTextContent("4");
  });

  it("Giro: decorativo sem rótulo, status com rótulo", () => {
    const { container, rerender } = render(<Giro />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    rerender(<Giro rotulo="Testando a conexão" tamanho={24} />);
    expect(screen.getByRole("status")).toHaveTextContent("Testando a conexão");
  });

  it("Avatar: iniciais e nome acessível quando não é decorativo", () => {
    const { rerender, container } = render(<Avatar nome="Operador Teste" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container).toHaveTextContent("OT");
    rerender(<Avatar nome="Operador Teste" decorativo={false} tamanho="g" tom="navy" />);
    expect(screen.getByRole("img", { name: "Operador Teste" })).toHaveAttribute("data-tom", "navy");
  });

  it("Dica: com id vira tooltip ligado ao filho", () => {
    render(
      <Dica rotulo="Copiar a URL" id="dica-url">
        <button type="button">Copiar</button>
      </Dica>,
    );
    expect(screen.getByRole("button", { name: "Copiar" })).toHaveAttribute(
      "aria-describedby",
      "dica-url",
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("Copiar a URL");
  });

  it("EstadoVazio: o que falta, por que importa e a ação, nas formas", () => {
    const { rerender, container } = render(
      <EstadoVazio
        oQueFalta="Nenhum contato ainda"
        porQueImporta="Os contatos aparecem quando o WhatsApp receber a primeira mensagem."
        acao={<Botao>Ver a conexão</Botao>}
        forma="tabela"
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Nenhum contato ainda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver a conexão" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-forma", "tabela");

    for (const forma of ["lista", "cartao", "quadro", "linha"] as const) {
      rerender(<EstadoVazio oQueFalta="Kanban vazio" porQueImporta="Motivo." acao={null} forma={forma} nivelTitulo={3} />);
      expect(screen.getByRole("heading", { level: 3, name: "Kanban vazio" })).toBeInTheDocument();
    }
  });

  it("Recolhivel: details nativo com título, contagem e corpo", () => {
    const { container } = render(
      <Recolhivel titulo="O que eu já sei" contagem="8 campos" aberto data-testid="rec">
        <p>Conteúdo</p>
      </Recolhivel>,
    );
    const detalhes = screen.getByTestId("rec");
    expect(detalhes.tagName).toBe("DETAILS");
    expect(detalhes).toHaveAttribute("open");
    const resumo = container.querySelector("summary")!;
    expect(within(resumo as HTMLElement).getByText("O que eu já sei")).toBeInTheDocument();
    expect(within(resumo as HTMLElement).getByText("8 campos")).toBeInTheDocument();
    expect(screen.getByText("Conteúdo")).toBeInTheDocument();
  });

  it("Selo, Estado, Esqueleto e Pagina", () => {
    render(
      <Pagina largura="leitura">
        <Selo tom="menta">Recomendado</Selo>
        <Selo variante="fato">Mais barato</Selo>
        <Estado tom="sucesso" rotulo="Conectado" />
        <Esqueleto forma="texto" linhas={3} rotulo="Carregando os modelos" />
        <Esqueleto forma="bloco" altura={120} raio="card" />
      </Pagina>,
    );
    expect(screen.getByText("Recomendado")).toHaveAttribute("data-tom", "menta");
    expect(screen.getByText("Mais barato")).toHaveAttribute("data-variante", "fato");
    expect(screen.getByText("Conectado")).toHaveAttribute("data-tom", "sucesso");
    const carregando = screen.getByRole("status", { name: "Carregando os modelos" });
    expect(carregando.children).toHaveLength(3);
    const pagina = screen.getByText("Recomendado").closest("[data-identidade]");
    expect(pagina).toHaveAttribute("data-identidade", "aipro");
    expect(pagina).toHaveAttribute("data-largura", "leitura");
  });
});

describe("nada se mexe ao clicar (item 5a da spec r2)", () => {
  const ler = (arquivo: string) =>
    readFileSync(path.resolve(__dirname, "../components/aipro", arquivo), "utf-8");
  /** Corpo de cada regra cujo seletor tem `:active` ou `:hover` (sem os blocos de @media). */
  function regras(css: string, estado: ":active" | ":hover") {
    const corpos: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1]!.includes(estado)) corpos.push(m[2]!);
    }
    return corpos;
  }

  it.each(["Botao.module.css", "BotaoIcone.module.css", "Cartao.module.css"])(
    "%s marca o clique sem transform e não anima transform no próprio controle",
    (arquivo) => {
      const css = ler(arquivo);
      const ativos = regras(css, ":active");
      expect(ativos.length).toBeGreaterThan(0);
      for (const corpo of ativos) expect(corpo).not.toMatch(/transform/);
      expect(css).not.toMatch(/scale\(/);
    },
  );

  it("o cartão interativo não sobe no hover", () => {
    for (const corpo of regras(ler("Cartao.module.css"), ":hover")) expect(corpo).not.toMatch(/transform/);
  });

  it("a rolagem até um elemento desconta a barra de etapas presa no topo", () => {
    expect(cssAiPro).toMatch(/html:has\(#onb-nav:not\(\[data-recolhe\]\)\)\s*\{\s*scroll-padding-top: 4\.5rem/);
    expect(cssAiPro).toMatch(/scroll-padding-top: 7\.25rem/);
  });
});
