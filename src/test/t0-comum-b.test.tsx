import { readFileSync } from "node:fs";
import path from "node:path";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Bolha,
  idUltimaEnviada,
  resumoBolha,
  tamanhoArquivo,
  type AutorBolha,
  type MensagemBolha,
} from "@/features/plataforma/comum/Bolha";
import { CaixaEscrever, type NovaMensagem } from "@/features/plataforma/comum/CaixaEscrever";
import { EventoConversa, SeparadorDia } from "@/features/plataforma/comum/EventoConversa";
import { Gaveta } from "@/features/plataforma/comum/Gaveta";

/* 17:31 em UTC é 14:31 em São Paulo (UTC-3). */
const MOMENTO = "2026-10-30T17:31:00.000Z";

function msg(campos: Partial<MensagemBolha> = {}): MensagemBolha {
  return {
    id: "m1",
    origem: "lead",
    tipo: "texto",
    status: "recebida",
    texto: "Oi, tudo bem?",
    momento: MOMENTO,
    ...campos,
  };
}

const LEAD: AutorBolha = { nome: "Ricardo Alves", cor: "areia" };
/* Como a tela passa o lead: o primeiro nome no rótulo e o nome inteiro nas iniciais do avatar. */
const LEAD_TELA: AutorBolha = { nome: "Ricardo", nomeCompleto: "Ricardo Alves", cor: "azul" };
const JANETE: AutorBolha = { nome: "Janete" };
const MARINA: AutorBolha = { nome: "Marina", papel: "Atendente" };
const CELULAR: AutorBolha = { nome: "Celular da empresa" };

const artigo = () => screen.getByRole("article");

afterEach(() => {
  vi.useRealTimers();
});

/* -----------------------------------------------------------------------------
   As classes declaradas em Classes<> existem no .module.css (o mesmo cuidado do f1-classes-css)
   ----------------------------------------------------------------------------- */

describe("classes dos CSS Modules das peças", () => {
  const pasta = path.resolve(__dirname, "../features/plataforma/comum");
  it.each(["Bolha", "EventoConversa", "CaixaEscrever"])("%s: cada classe declarada existe no CSS", (nome) => {
    const codigo = readFileSync(path.join(pasta, `${nome}.tsx`), "utf-8");
    const css = readFileSync(path.join(pasta, `${nome}.module.css`), "utf-8");
    const bloco = /as Classes<([^>]+)>/.exec(codigo);
    expect(bloco).not.toBeNull();
    const classes = [...bloco![1]!.matchAll(/["']([\w-]+)["']/g)].map((c) => c[1]!);
    expect(classes.length).toBeGreaterThan(2);
    const faltando = classes.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(faltando).toEqual([]);
  });
});

/* -----------------------------------------------------------------------------
   Bolha: as 4 origens
   ----------------------------------------------------------------------------- */

/** A hora dentro do balão (o canto de baixo), com "editada" antes e os vistos depois. */
const horaDa = (a: HTMLElement) => within(a).getByText("14:31").parentElement!;

describe("Bolha: as 4 origens se distinguem", () => {
  it("lead: à esquerda, com avatar nas iniciais e cor do lead; sem a linha de cima e a hora no balão", () => {
    render(<Bolha mensagem={msg()} autor={LEAD} />);
    const a = artigo();
    expect(a).toHaveAttribute("data-origem", "lead");
    expect(a).toHaveAttribute("data-lado", "esq");
    const avatar = within(a).getByText("RA").closest("[data-cor]");
    expect(avatar).toHaveAttribute("data-cor", "areia");
    // Nome e papel não aparecem escritos: ficam só no nome acessível.
    expect(within(a).queryByText("Ricardo Alves")).toBeNull();
    expect(within(a).queryByText(/Lead/)).toBeNull();
    // A hora fica dentro do balão, escondida do leitor de tela (que já a ouve no nome).
    const balao = within(a).getByText("Oi, tudo bem?");
    expect(balao).toContainElement(horaDa(a));
    expect(horaDa(a)).toHaveAttribute("aria-hidden", "true");
    // Mensagem do lead não tem vistos.
    expect(a.querySelector("[data-vistos]")).toBeNull();
    expect(a).toHaveAccessibleName("Ricardo Alves, Lead, 14:31: Oi, tudo bem?");
  });

  it("lead pela tela: iniciais do nome inteiro, a cor que a tela passou e o primeiro nome no nome acessível", () => {
    render(<Bolha mensagem={msg()} autor={LEAD_TELA} />);
    const a = artigo();
    expect(within(a).getByText("RA").closest("[data-cor]")).toHaveAttribute("data-cor", "azul");
    expect(a).toHaveAccessibleName("Ricardo, Lead, 14:31: Oi, tudo bem?");
  });

  it("Janete: à direita, balão azul-claro e a bolinha com o símbolo dela", () => {
    render(<Bolha mensagem={msg({ origem: "janete", status: "enviada" })} autor={JANETE} />);
    const a = artigo();
    expect(a).toHaveAttribute("data-lado", "dir");
    expect(within(a).getByText("Oi, tudo bem?")).toHaveAttribute("data-origem", "janete");
    // O JaneteSimbolo é o disco com data-estado, dentro da bolinha de quem falou.
    expect(a.querySelector("[data-quem='janete'] [data-estado='acordada']")).not.toBeNull();
    expect(within(a).queryByText(/SDR de IA/)).toBeNull();
    expect(within(a).queryByText("NI")).toBeNull();
    expect(a).toHaveAccessibleName(/^Janete, SDR de IA, 14:31: /);
  });

  it("equipe pela tela: navy, com as iniciais do nome na bolinha", () => {
    render(<Bolha mensagem={msg({ origem: "humano_tela", status: "enviada" })} autor={MARINA} />);
    const a = artigo();
    expect(a).toHaveAttribute("data-lado", "dir");
    expect(within(a).getByText("Oi, tudo bem?")).toHaveAttribute("data-origem", "humano_tela");
    // "Marina" (uma palavra só): as 2 primeiras letras.
    expect(within(a).getByText("MA")).toHaveAttribute("data-quem", "equipe");
    expect(within(a).queryByText(/Atendente/)).toBeNull();
    expect(a).toHaveAccessibleName(/^Marina, Atendente, 14:31: /);
  });

  it("equipe pela tela: as iniciais que a tela passou valem no lugar das do nome", () => {
    const { rerender } = render(
      <Bolha mensagem={msg({ origem: "humano_tela", status: "enviada" })} autor={{ nome: "Você", iniciais: "vc" }} />,
    );
    expect(screen.getByText("VC")).toHaveAttribute("data-quem", "equipe");
    // Sem iniciais, as mesmas do selo e da passagem (o iniciais() do AI PRO: as duas primeiras palavras).
    rerender(<Bolha mensagem={msg({ origem: "humano_tela", status: "enviada" })} autor={{ nome: "Rafael Souza Lima" }} />);
    expect(screen.getByText("RS")).toHaveAttribute("data-quem", "equipe");
    // Quem olha vem como "Você" (nomeDoMembro): "VC", como no selo de quem atende.
    rerender(<Bolha mensagem={msg({ origem: "humano_tela", status: "enviada" })} autor={{ nome: "Você" }} />);
    expect(screen.getByText("VC")).toHaveAttribute("data-quem", "equipe");
  });

  it("celular da empresa: branco com contorno e o ícone do celular na bolinha", () => {
    render(<Bolha mensagem={msg({ origem: "humano_celular", status: "enviada" })} autor={CELULAR} />);
    const a = artigo();
    expect(within(a).getByText("Oi, tudo bem?")).toHaveAttribute("data-origem", "humano_celular");
    expect(a.querySelector("[data-quem='celular'] [data-glifo='celular']")).not.toBeNull();
    expect(within(a).queryByText(/pelo WhatsApp/)).toBeNull();
    expect(a).toHaveAccessibleName(/^Celular da empresa, pelo WhatsApp, 14:31: /);
  });

  it("agrupada: sem a bolinha de quem falou; o espaço dela fica para alinhar, nos dois lados", () => {
    const { rerender } = render(<Bolha mensagem={msg()} autor={LEAD} agrupada />);
    let a = artigo();
    expect(a).toHaveAttribute("data-agrupada");
    expect(within(a).queryByText("RA")).toBeNull();
    expect(a.querySelector("[data-quem]")).toBeNull();
    // O espaço vazio (decorativo) fica no lugar da bolinha.
    expect(a.querySelector("[class*='boAvatarEsp']")).not.toBeNull();
    // O nome acessível continua completo, e a hora continua no balão.
    expect(a).toHaveAccessibleName(/^Ricardo Alves, Lead, 14:31/);
    expect(within(a).getByText("14:31")).toBeInTheDocument();

    rerender(<Bolha mensagem={msg({ origem: "janete", status: "enviada" })} autor={JANETE} agrupada />);
    a = artigo();
    expect(a.querySelector("[data-quem='janete']")).toBeNull();
    expect(a.querySelector("[class*='boAvatarEsp']")).not.toBeNull();
  });
});

/* -----------------------------------------------------------------------------
   Bolha: os 6 tipos
   ----------------------------------------------------------------------------- */

describe("Bolha: os 6 tipos", () => {
  it("texto: quebra de linha preservada no balão, com a hora no fim", () => {
    render(<Bolha mensagem={msg({ texto: "linha 1\nlinha 2" })} autor={LEAD} />);
    const balao = screen.getByText(/linha 1/);
    // O texto continua um nó só (o pre-line do balão quebra a linha); a hora vem depois dele.
    expect(balao.firstChild?.textContent).toBe("linha 1\nlinha 2");
    expect(balao.textContent).toBe("linha 1\nlinha 214:31");
  });

  it("áudio: a hora fica dentro da pílula, à direita da duração", () => {
    render(<Bolha mensagem={msg({ origem: "janete", tipo: "audio", texto: null, duracaoS: 42, status: "lida" })} autor={JANETE} />);
    const a = artigo();
    const pe = within(a).getByText("0:42").parentElement!;
    expect(pe).toContainElement(horaDa(a));
    expect(within(horaDa(a)).queryByTitle("Lida")).not.toBeNull();
  });

  it("imagem sem legenda, vídeo e figurinha: a hora vai por cima da mídia; com legenda, no balão dela", () => {
    const { rerender } = render(<Bolha mensagem={msg({ tipo: "imagem", texto: null })} autor={LEAD} />);
    expect(horaDa(artigo())).toHaveAttribute("data-sobre");
    rerender(<Bolha mensagem={msg({ tipo: "video", texto: null, duracaoS: 24 })} autor={LEAD} />);
    expect(horaDa(artigo())).toHaveAttribute("data-sobre");
    rerender(<Bolha mensagem={msg({ tipo: "figurinha", texto: null })} autor={LEAD} />);
    expect(horaDa(artigo())).toHaveAttribute("data-sobre");
    rerender(<Bolha mensagem={msg({ tipo: "imagem", texto: "A fachada" })} autor={LEAD} />);
    const hora = horaDa(artigo());
    expect(hora).not.toHaveAttribute("data-sobre");
    expect(screen.getByText("A fachada")).toContainElement(hora);
  });

  it("documento: a hora fica na linha do tamanho", () => {
    render(
      <Bolha
        mensagem={msg({ tipo: "documento", texto: null, midia_nome: "a.pdf", midia_tamanho: 655_360 })}
        autor={LEAD}
      />,
    );
    const a = artigo();
    expect(within(a).getByText("PDF · 640 KB").parentElement).toContainElement(horaDa(a));
  });

  it("áudio: o player toca, o tempo anda e para no fim", () => {
    vi.useFakeTimers();
    render(<Bolha mensagem={msg({ tipo: "audio", texto: null, duracaoS: 3 })} autor={LEAD} />);
    expect(screen.getByText("0:03")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ouvir o áudio de 0:03" }));
    expect(screen.getByRole("button", { name: "Pausar o áudio" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByText("0:01 / 0:03")).toBeInTheDocument();
    // A onda acende as barras já tocadas.
    expect(artigo().querySelectorAll("i[data-on]").length).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByRole("button", { name: "Ouvir o áudio de 0:03" })).toBeInTheDocument();
    expect(screen.getByText("0:03")).toBeInTheDocument();
  });

  it("áudio: a transcrição da Janete abre e fecha", () => {
    render(
      <Bolha
        mensagem={msg({ tipo: "audio", texto: null, duracaoS: 42, transcricao: "Quero o orçamento até sexta." })}
        autor={LEAD}
      />,
    );
    const botao = screen.getByRole("button", { name: "Transcrição da Janete" });
    // O rótulo tem classe própria (corta com reticências no balão estreito, em vez de quebrar).
    expect(within(botao).getByText("Transcrição da Janete").className).toMatch(/boTranscRot/);
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Quero o orçamento até sexta.")).toBeNull();
    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Quero o orçamento até sexta.")).toBeInTheDocument();
    fireEvent.click(botao);
    expect(screen.queryByText("Quero o orçamento até sexta.")).toBeNull();
  });

  it("áudio do lead sem transcrição: o aviso só aparece quando a tela diz que falhou", () => {
    const { rerender } = render(<Bolha mensagem={msg({ tipo: "audio", duracaoS: 5 })} autor={LEAD} />);
    expect(screen.queryByText("A Janete não conseguiu transcrever este áudio")).toBeNull();
    rerender(<Bolha mensagem={msg({ tipo: "audio", duracaoS: 5 })} autor={LEAD} transcricaoFalhou />);
    expect(screen.getByText("A Janete não conseguiu transcrever este áudio")).toBeInTheDocument();
  });

  it("imagem: amplia numa janela, fecha com Esc e devolve o foco", () => {
    render(<Bolha mensagem={msg({ tipo: "imagem", texto: null, midia_nome: "fachada.jpg" })} autor={LEAD} />);
    const abrir = screen.getByRole("button", { name: "Ampliar a foto fachada.jpg" });
    fireEvent.click(abrir);
    const janela = screen.getByRole("dialog", { name: "fachada.jpg" });
    expect(janela).toHaveAttribute("aria-modal", "true");
    expect(within(janela).getByRole("button", { name: "Fechar" })).toHaveFocus();
    fireEvent.keyDown(janela, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(abrir).toHaveFocus();
  });

  it("imagem dentro da Gaveta: o Tab fica na janela da foto, sem a Gaveta puxar o foco", () => {
    render(
      <Gaveta aberta aoFechar={vi.fn()} rotulo="Ficha">
        <Bolha mensagem={msg({ tipo: "imagem", texto: null, midia_nome: "fachada.jpg" })} autor={LEAD} />
      </Gaveta>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ampliar a foto fachada.jpg" }));
    const janela = screen.getByRole("dialog", { name: "fachada.jpg" });
    const fechar = within(janela).getByRole("button", { name: "Fechar" });
    expect(fechar).toHaveFocus();
    fireEvent.keyDown(fechar, { key: "Tab" });
    expect(fechar).toHaveFocus();
    fireEvent.keyDown(fechar, { key: "Tab", shiftKey: true });
    expect(fechar).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "fachada.jpg" })).toBeInTheDocument();
  });

  it("documento sem endereço nem aoBaixar: sem o botão Baixar", () => {
    render(<Bolha mensagem={msg({ tipo: "documento", texto: null, midia_nome: "a.pdf" })} autor={LEAD} />);
    expect(screen.queryByRole("button", { name: /Baixar/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Baixar/ })).toBeNull();
  });

  it("documento: cartão com nome, extensão, tamanho e baixar", () => {
    const aoBaixar = vi.fn();
    render(
      <Bolha
        mensagem={msg({
          tipo: "documento",
          texto: null,
          midia_nome: "proposta-revisada.pdf",
          midia_mime: "application/pdf",
          midia_tamanho: 655_360,
        })}
        autor={LEAD}
        aoBaixar={aoBaixar}
      />,
    );
    expect(screen.getByText("proposta-revisada.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF · 640 KB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Baixar proposta-revisada.pdf" }));
    expect(aoBaixar).toHaveBeenCalledWith("m1");
  });

  it("vídeo: duração na miniatura e o play abre o vídeo ampliado", () => {
    vi.useFakeTimers();
    render(<Bolha mensagem={msg({ tipo: "video", texto: null, midia_nome: "obra.mp4", duracaoS: 24 })} autor={LEAD} />);
    fireEvent.click(screen.getByRole("button", { name: "Assistir ao vídeo obra.mp4, 0:24" }));
    const janela = screen.getByRole("dialog", { name: "obra.mp4" });
    fireEvent.click(within(janela).getByRole("button", { name: "Reproduzir o vídeo" }));
    expect(within(janela).getByRole("button", { name: "Pausar o vídeo" })).toBeInTheDocument();
    fireEvent.click(within(janela).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("figurinha: imagem com nome", () => {
    render(<Bolha mensagem={msg({ tipo: "figurinha", texto: null })} autor={LEAD} />);
    expect(screen.getByRole("img", { name: "Figurinha" })).toBeInTheDocument();
  });

  it("tipo que a tela não mostra: aviso no balão", () => {
    render(<Bolha mensagem={msg({ tipo: "outro", texto: null })} autor={LEAD} />);
    expect(screen.getByText("Mensagem de um tipo que a plataforma ainda não mostra")).toBeInTheDocument();
  });

  it("resumoBolha e tamanhoArquivo", () => {
    expect(resumoBolha(msg({ tipo: "audio", duracaoS: 42 }))).toBe("Áudio (0:42)");
    expect(resumoBolha(msg({ tipo: "imagem", texto: null }))).toBe("Foto");
    expect(resumoBolha(msg({ tipo: "documento", midia_nome: "a.pdf" }))).toBe("a.pdf");
    expect(resumoBolha(msg({ apagada_em: MOMENTO }))).toBe("Mensagem apagada");
    expect(tamanhoArquivo(1_887_437)).toBe("1,8 MB");
    expect(tamanhoArquivo(512)).toBe("512 B");
  });
});

/* -----------------------------------------------------------------------------
   Bolha: situação, editada, apagada, reação e citação
   ----------------------------------------------------------------------------- */

describe("Bolha: a situação de envio", () => {
  const saida = (status: MensagemBolha["status"]) => msg({ origem: "humano_tela", status });

  it.each([
    ["na_fila", "Na fila"],
    ["enviando", "Enviando"],
    ["enviada", "Enviada"],
    ["entregue", "Entregue"],
    ["lida", "Lida por Ricardo"],
  ] as const)("%s: os vistos ao lado da hora (\"%s\") e nenhuma linha embaixo", (status, texto) => {
    render(<Bolha mensagem={saida(status)} autor={MARINA} nomeLead="Ricardo" />);
    const a = artigo();
    const visto = a.querySelector<HTMLElement>(`[data-vistos='${status}']`);
    expect(visto).not.toBeNull();
    expect(horaDa(a)).toContainElement(visto);
    expect(visto).toHaveAttribute("title", texto);
    // O texto da situação não aparece escrito: sai a linha "Enviada / Entregue / Lida por…".
    expect(screen.queryByText(texto)).toBeNull();
    expect(a.querySelector("[data-situacao]")).toBeNull();
    expect(a).toHaveAccessibleName(new RegExp(`, ${texto}$`));
  });

  it.each([
    ["falhou", "Não enviada"],
    ["cancelada", "Envio cancelado"],
  ] as const)("%s: \"%s\" continua embaixo do balão, sem vistos", (status, texto) => {
    render(<Bolha mensagem={saida(status)} autor={MARINA} nomeLead="Ricardo" />);
    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(artigo().querySelector("[data-vistos]")).toBeNull();
    expect(artigo()).toHaveAccessibleName(new RegExp(`, ${texto}$`));
  });

  it("a lida pinta os vistos; a entregue, não (o azul é só da lida)", () => {
    const { rerender } = render(<Bolha mensagem={saida("lida")} autor={MARINA} />);
    expect(artigo().querySelector("[data-vistos='lida']")).toHaveAttribute("title", "Lida");
    rerender(<Bolha mensagem={saida("entregue")} autor={MARINA} />);
    expect(artigo().querySelector("[data-vistos='lida']")).toBeNull();
  });

  it("falhou: Tentar de novo chama o reenvio com o id", () => {
    const aoTentarDeNovo = vi.fn();
    render(<Bolha mensagem={saida("falhou")} autor={MARINA} aoTentarDeNovo={aoTentarDeNovo} />);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(aoTentarDeNovo).toHaveBeenCalledWith("m1");
  });

  it("falhou: no foco móvel, Tentar de novo deixa o foco na própria mensagem", () => {
    render(<Bolha mensagem={saida("falhou")} autor={MARINA} aoTentarDeNovo={vi.fn()} tabIndex={0} />);
    const botao = screen.getByRole("button", { name: "Tentar de novo" });
    botao.focus();
    fireEvent.click(botao);
    expect(artigo()).toHaveFocus();
  });

  it("mostrarSituacao não muda nada: os vistos e a situação no nome acessível valem em toda enviada", () => {
    const { rerender } = render(<Bolha mensagem={saida("lida")} autor={MARINA} mostrarSituacao={false} />);
    expect(artigo().querySelector("[data-vistos='lida']")).not.toBeNull();
    expect(artigo()).toHaveAccessibleName(/, Lida$/);
    rerender(<Bolha mensagem={saida("entregue")} autor={MARINA} mostrarSituacao={false} />);
    expect(artigo()).toHaveAccessibleName(/, Entregue$/);
    rerender(<Bolha mensagem={saida("na_fila")} autor={MARINA} mostrarSituacao={false} />);
    expect(artigo().querySelector("[data-vistos='na_fila']")).not.toBeNull();
    expect(artigo()).toHaveAccessibleName(/, Na fila$/);
  });

  it("mensagem do lead não tem situação", () => {
    render(<Bolha mensagem={msg({ status: "recebida" })} autor={LEAD} />);
    expect(artigo().querySelector("[data-situacao]")).toBeNull();
  });

  it("idUltimaEnviada pula as que falharam, as canceladas e as do lead", () => {
    const lista = [
      msg({ id: "a", origem: "janete", status: "lida" }),
      msg({ id: "b", origem: "humano_tela", status: "entregue" }),
      msg({ id: "c", origem: "humano_tela", status: "falhou" }),
      msg({ id: "d", origem: "lead", status: "recebida" }),
    ];
    expect(idUltimaEnviada(lista)).toBe("b");
    expect(idUltimaEnviada([msg()])).toBeNull();
  });
});

describe("Bolha: editada, apagada, reação e citação", () => {
  it("editada aparece antes da hora, dentro do balão, agrupada ou não", () => {
    const { rerender } = render(<Bolha mensagem={msg({ editada: true })} autor={LEAD} />);
    const hora = horaDa(artigo());
    expect(hora.firstChild).toHaveTextContent(/^editada$/);
    expect(within(hora).getByText("editada")).toBeInTheDocument();
    expect(artigo()).toHaveAccessibleName(/, editada$/);
    rerender(<Bolha mensagem={msg({ editada: true })} autor={LEAD} agrupada />);
    expect(within(horaDa(artigo())).getByText("editada")).toBeInTheDocument();
    expect(screen.getAllByText("editada")).toHaveLength(1);
  });

  it("apagada: aviso no lugar do conteúdo e sem ações", () => {
    render(
      <Bolha mensagem={msg({ apagada_em: MOMENTO })} autor={LEAD} aoResponder={vi.fn()} comReagir aoReagir={vi.fn()} />,
    );
    expect(screen.getByText("O lead apagou esta mensagem")).toBeInTheDocument();
    expect(screen.queryByText("Oi, tudo bem?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Responder citando esta mensagem" })).toBeNull();
  });

  it("a reação fica no canto e o clique tira", () => {
    const aoReagir = vi.fn();
    render(<Bolha mensagem={msg({ reacao: "👍" })} autor={LEAD} comReagir aoReagir={aoReagir} />);
    expect(artigo()).toHaveAccessibleName(/com reação 👍$/);
    fireEvent.click(screen.getByRole("button", { name: "Reação 👍. Clique para tirar" }));
    expect(aoReagir).toHaveBeenCalledWith("m1", null);
  });

  it("reagir: o menu abre no 1º emoji, anda pelas setas e Esc devolve o foco", () => {
    const aoReagir = vi.fn();
    render(<Bolha mensagem={msg()} autor={LEAD} comReagir aoReagir={aoReagir} />);
    const botao = screen.getByRole("button", { name: "Reagir a esta mensagem" });
    fireEvent.click(botao);
    expect(botao).toHaveAttribute("aria-expanded", "true");
    const grupo = screen.getByRole("group", { name: "Escolher uma reação" });
    const joinha = within(grupo).getByRole("button", { name: "Reagir com joinha" });
    expect(joinha).toHaveFocus();
    fireEvent.keyDown(joinha, { key: "ArrowRight" });
    expect(within(grupo).getByRole("button", { name: "Reagir com coração" })).toHaveFocus();
    fireEvent.keyDown(grupo, { key: "End" });
    expect(within(grupo).getByRole("button", { name: "Reagir com aplauso" })).toHaveFocus();
    fireEvent.keyDown(grupo, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Escolher uma reação" })).toBeNull();
    expect(botao).toHaveFocus();
    expect(aoReagir).not.toHaveBeenCalled();
  });

  it("reagir: escolher manda o emoji; escolher o mesmo tira", () => {
    const aoReagir = vi.fn();
    const { rerender } = render(<Bolha mensagem={msg()} autor={LEAD} comReagir aoReagir={aoReagir} />);
    fireEvent.click(screen.getByRole("button", { name: "Reagir a esta mensagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Reagir com risada" }));
    expect(aoReagir).toHaveBeenLastCalledWith("m1", "😂");
    rerender(<Bolha mensagem={msg({ reacao: "😂" })} autor={LEAD} comReagir aoReagir={aoReagir} />);
    fireEvent.click(screen.getByRole("button", { name: "Reagir a esta mensagem" }));
    const risada = screen.getByRole("button", { name: "Reagir com risada" });
    expect(risada).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(risada);
    expect(aoReagir).toHaveBeenLastCalledWith("m1", null);
  });

  it("clicar fora fecha o menu de reações", () => {
    render(<Bolha mensagem={msg()} autor={LEAD} comReagir aoReagir={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reagir a esta mensagem" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "Escolher uma reação" })).toBeNull();
  });

  it("clicar no balão fecha o menu de reações; o botão Reagir abre e fecha pelo clique dele", () => {
    render(<Bolha mensagem={msg()} autor={LEAD} comReagir aoReagir={vi.fn()} />);
    const reagir = screen.getByRole("button", { name: "Reagir a esta mensagem" });
    fireEvent.click(reagir);
    // A escolha mora na linha da mensagem, mas o balão (na mesma linha) conta como "fora".
    fireEvent.pointerDown(screen.getByText("Oi, tudo bem?"));
    expect(screen.queryByRole("group", { name: "Escolher uma reação" })).toBeNull();
    fireEvent.pointerDown(reagir);
    fireEvent.click(reagir);
    expect(screen.getByRole("group", { name: "Escolher uma reação" })).toBeInTheDocument();
    fireEvent.pointerDown(reagir);
    fireEvent.click(reagir);
    expect(screen.queryByRole("group", { name: "Escolher uma reação" })).toBeNull();
    expect(reagir).toHaveAttribute("aria-expanded", "false");
  });

  it("Responder e Reagir: no corpo, depois do balão e da reação; a escolha de reação fica na linha, fora da pílula", () => {
    render(<Bolha mensagem={msg({ reacao: "👍" })} autor={LEAD} aoResponder={vi.fn()} comReagir aoReagir={vi.fn()} />);
    const balao = screen.getByText("Oi, tudo bem?");
    const reacao = screen.getByRole("button", { name: "Reação 👍. Clique para tirar" });
    const responder = screen.getByRole("button", { name: "Responder citando esta mensagem" });
    const reagir = screen.getByRole("button", { name: "Reagir a esta mensagem" });
    const pilula = responder.parentElement!;
    expect(pilula.className).toMatch(/boAcoes/);
    expect(pilula).toContainElement(reagir);
    // A pílula é a última filha do corpo (o pai do balão): sai do fluxo da linha, e o Tab passa
    // pelo balão e pela reação antes dos botões.
    const corpo = balao.parentElement!;
    expect(corpo.className).toMatch(/boCorpo/);
    expect(corpo.lastElementChild).toBe(pilula);
    expect(balao.compareDocumentPosition(responder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reacao.compareDocumentPosition(responder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(responder.compareDocumentPosition(reagir) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A escolha de reação é filha direta da linha (ancorada nela), e não da pílula.
    fireEvent.click(reagir);
    const grupo = screen.getByRole("group", { name: "Escolher uma reação" });
    expect(pilula).not.toContainElement(grupo);
    const linha = corpo.parentElement!;
    expect(linha.className).toMatch(/boLinha/);
    expect(grupo.parentElement).toBe(linha);
    expect(reagir.compareDocumentPosition(grupo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sem foco móvel (a gaveta do Kanban), a mensagem com ações recebe o foco pelo toque, fora da ordem do Tab", () => {
    const { rerender } = render(<Bolha mensagem={msg()} autor={LEAD} aoResponder={vi.fn()} comReagir aoReagir={vi.fn()} />);
    expect(artigo()).toHaveAttribute("tabindex", "-1");
    // Os botões continuam na ordem do Tab.
    expect(screen.getByRole("button", { name: "Responder citando esta mensagem" })).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("button", { name: "Reagir a esta mensagem" })).not.toHaveAttribute("tabindex");
    // Sem ações (sem callbacks, ou apagada), a mensagem não recebe foco.
    rerender(<Bolha mensagem={msg()} autor={LEAD} />);
    expect(artigo()).not.toHaveAttribute("tabindex");
    rerender(<Bolha mensagem={msg({ apagada_em: MOMENTO })} autor={LEAD} aoResponder={vi.fn()} />);
    expect(artigo()).not.toHaveAttribute("tabindex");
  });

  it("responder chama com o id; a citação fica numa caixa dentro do balão, com o nome em negrito", () => {
    const aoResponder = vi.fn();
    render(
      <Bolha
        mensagem={msg({ origem: "janete", status: "enviada", citaId: "m0" })}
        autor={JANETE}
        citacao={{ de: "Ricardo", texto: "Vocês começam no dia 10?" }}
        aoResponder={aoResponder}
      />,
    );
    // Saem o "Respondendo a" escrito e a linha curva.
    expect(screen.queryByText(/Respondendo a/)).toBeNull();
    expect(artigo().querySelector("[class*='boCitaLinha']")).toBeNull();
    const de = screen.getByText("Ricardo");
    expect(de.tagName).toBe("B");
    const caixa = de.parentElement!;
    expect(caixa).toContainElement(screen.getByText("Vocês começam no dia 10?"));
    expect(screen.getByText("Oi, tudo bem?")).toContainElement(caixa);
    expect(artigo()).toHaveAccessibleName(/respondendo a Ricardo\. Oi, tudo bem\?/);
    fireEvent.click(screen.getByRole("button", { name: "Responder citando esta mensagem" }));
    expect(aoResponder).toHaveBeenCalledWith("m1");
  });

  it("citação numa mídia: a caixa vem solta, em cima dela", () => {
    render(
      <Bolha
        mensagem={msg({ tipo: "audio", texto: null, duracaoS: 5, citaId: "m0" })}
        autor={LEAD}
        citacao={{ de: "Janete", texto: "Me manda o áudio" }}
      />,
    );
    const caixa = screen.getByText("Janete").parentElement!;
    expect(caixa).toHaveAttribute("data-solta");
  });

  it("foco móvel: com tabIndex -1, Responder e Reagir também saem da ordem do Tab", () => {
    const { rerender } = render(
      <Bolha mensagem={msg()} autor={LEAD} aoResponder={vi.fn()} comReagir aoReagir={vi.fn()} tabIndex={-1} />,
    );
    expect(artigo()).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Responder citando esta mensagem" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Reagir a esta mensagem" })).toHaveAttribute("tabindex", "-1");
    rerender(<Bolha mensagem={msg()} autor={LEAD} aoResponder={vi.fn()} comReagir aoReagir={vi.fn()} tabIndex={0} />);
    expect(screen.getByRole("button", { name: "Reagir a esta mensagem" })).not.toHaveAttribute("tabindex");
  });

  it("mensagem longa: o nome acessível corta o texto em 140 caracteres", () => {
    render(<Bolha mensagem={msg({ texto: "a".repeat(300) })} autor={LEAD} />);
    expect(artigo()).toHaveAccessibleName(`Ricardo Alves, Lead, 14:31: ${"a".repeat(139)}…`);
  });

  it("sem callbacks, não há botões de ação", () => {
    render(<Bolha mensagem={msg()} autor={LEAD} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

/* -----------------------------------------------------------------------------
   EventoConversa
   ----------------------------------------------------------------------------- */

describe("EventoConversa", () => {
  it("a linha central com a hora de São Paulo", () => {
    render(<EventoConversa texto="A Janete moveu para Qualificado" momento={MOMENTO} />);
    const nota = screen.getByRole("note");
    expect(nota).toHaveTextContent("A Janete moveu para Qualificado · 14:31");
  });

  it("sem momento, só a frase; o separador de dia tem nome", () => {
    render(
      <>
        <EventoConversa texto="Contato editado" />
        <SeparadorDia texto="Ontem" />
      </>,
    );
    expect(screen.getByRole("note")).toHaveTextContent(/^Contato editado$/);
    expect(screen.getByRole("separator", { name: "Ontem" })).toBeInTheDocument();
  });
});

/* -----------------------------------------------------------------------------
   CaixaEscrever
   ----------------------------------------------------------------------------- */

let conversaN = 0;
/** Cada teste numa conversa nova: o rascunho de cada conversa fica guardado no módulo. */
const novaConversa = () => `conv-teste-${++conversaN}`;
const campo = () => screen.getByRole("textbox", { name: /^Mensagem/ });

describe("CaixaEscrever: texto", () => {
  it("Enter envia o texto aparado e limpa; Shift+Enter não envia", () => {
    const aoEnviar = vi.fn();
    const id = novaConversa();
    render(<CaixaEscrever conversaId={id} aoEnviar={aoEnviar} destinatario="Ricardo" />);
    const c = campo();
    expect(c).toHaveAccessibleName("Mensagem para Ricardo. Enter envia; Shift e Enter quebram a linha.");
    expect(c).toHaveAttribute("placeholder", "Escreva para Ricardo");

    fireEvent.change(c, { target: { value: "linha 1" } });
    fireEvent.keyDown(c, { key: "Enter", shiftKey: true });
    expect(aoEnviar).not.toHaveBeenCalled();

    fireEvent.change(c, { target: { value: "  linha 1\nlinha 2  " } });
    expect(c).toHaveAttribute("rows", "2");
    fireEvent.keyDown(c, { key: "Enter" });
    expect(aoEnviar).toHaveBeenCalledTimes(1);
    expect(aoEnviar).toHaveBeenCalledWith(id, { tipo: "texto", texto: "linha 1\nlinha 2" });
    expect(c).toHaveValue("");
    expect(screen.getByText("Mensagem enviada.")).toBeInTheDocument();
  });

  it("sem a dica de teclado na tela: ela fica só no rótulo do leitor de tela", () => {
    const { container } = render(
      <CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} destinatario="Ricardo" />,
    );
    expect(container.querySelector("kbd")).toBeNull();
    expect(screen.queryByText(/nova linha/)).toBeNull();
    expect(container.querySelector("[class*='ceDica']")).toBeNull();
    expect(campo()).toHaveAccessibleName(/Enter envia; Shift e Enter quebram a linha\.$/);
  });

  it("dica troca o texto da caixa vazia; com o envio bloqueado, vale o do bloqueio", () => {
    const id = novaConversa();
    const dica = "Escreva para Rafael · você assume ao enviar";
    const { rerender } = render(
      <CaixaEscrever conversaId={id} aoEnviar={vi.fn()} destinatario="Rafael" dica={dica} />,
    );
    expect(campo()).toHaveAttribute("placeholder", dica);
    // O nome acessível não muda com a dica; ela vai na descrição (o placeholder some ao digitar).
    expect(campo()).toHaveAccessibleName("Mensagem para Rafael. Enter envia; Shift e Enter quebram a linha.");
    expect(campo()).toHaveAccessibleDescription(dica);
    rerender(<CaixaEscrever conversaId={id} aoEnviar={vi.fn()} destinatario="Rafael" />);
    expect(campo()).toHaveAttribute("placeholder", "Escreva para Rafael");
    expect(campo()).not.toHaveAttribute("aria-describedby");
    // Com faixa, quem descreve o envio é a faixa, e a dica não entra.
    rerender(
      <CaixaEscrever
        conversaId={id}
        aoEnviar={vi.fn()}
        destinatario="Rafael"
        dica={dica}
        faixa={{ texto: "Marina está atendendo." }}
      />,
    );
    expect(campo()).toHaveAccessibleDescription("Marina está atendendo.");
    rerender(
      <CaixaEscrever conversaId={id} aoEnviar={vi.fn()} destinatario="Rafael" dica={dica} bloqueio="sem_conexao" />,
    );
    expect(campo()).toHaveAttribute("placeholder", "Envio bloqueado");
    expect(campo()).not.toHaveAccessibleDescription(/você assume/);
  });

  it("vazio não envia, e o botão fica desligado até ter texto", () => {
    const aoEnviar = vi.fn();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    const enviar = screen.getByRole("button", { name: "Enviar mensagem" });
    expect(enviar).toBeDisabled();
    fireEvent.change(campo(), { target: { value: "   " } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoEnviar).not.toHaveBeenCalled();
    fireEvent.change(campo(), { target: { value: "Oi" } });
    expect(enviar).toBeEnabled();
    fireEvent.click(enviar);
    expect(aoEnviar).toHaveBeenCalledTimes(1);
  });

  it("Enter durante a composição (acento, IME) não envia", () => {
    const aoEnviar = vi.fn();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    fireEvent.change(campo(), { target: { value: "olá" } });
    fireEvent.keyDown(campo(), { key: "Enter", isComposing: true });
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it("envio recusado ({ ok: false }) deixa o rascunho na caixa", () => {
    const aoEnviar = vi.fn(() => ({ ok: false }));
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    fireEvent.change(campo(), { target: { value: "Não pode sumir" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoEnviar).toHaveBeenCalledTimes(1);
    expect(campo()).toHaveValue("Não pode sumir");
  });

  it("o rascunho de cada conversa volta quando a conversa volta", () => {
    const a = novaConversa();
    const b = novaConversa();
    const { rerender } = render(<CaixaEscrever conversaId={a} aoEnviar={vi.fn()} />);
    fireEvent.change(campo(), { target: { value: "rascunho da A" } });
    rerender(<CaixaEscrever conversaId={b} aoEnviar={vi.fn()} />);
    expect(campo()).toHaveValue("");
    rerender(<CaixaEscrever conversaId={a} aoEnviar={vi.fn()} />);
    expect(campo()).toHaveValue("rascunho da A");
  });

  it("emoji entra onde está o cursor e o menu fecha", () => {
    vi.useFakeTimers();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    fireEvent.change(campo(), { target: { value: "Até amanhã" } });
    (campo() as HTMLTextAreaElement).setSelectionRange(3, 3);
    const botao = screen.getByRole("button", { name: "Inserir emoji" });
    fireEvent.click(botao);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    const grupo = screen.getByRole("group", { name: "Emojis" });
    expect(within(grupo).getByRole("button", { name: "Inserir sorriso" })).toHaveFocus();
    fireEvent.keyDown(grupo, { key: "ArrowDown" });
    // A grade tem 6 colunas: a seta para baixo pula uma linha inteira.
    expect(within(grupo).getByRole("button", { name: "Inserir aplauso" })).toHaveFocus();
    fireEvent.click(within(grupo).getByRole("button", { name: "Inserir joinha" }));
    expect(campo()).toHaveValue("Até👍 amanhã");
    expect(screen.queryByRole("group", { name: "Emojis" })).toBeNull();
  });

  it("Esc no menu fecha e devolve o foco ao botão", () => {
    vi.useFakeTimers();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={vi.fn()} />);
    const botao = screen.getByRole("button", { name: "Inserir emoji" });
    fireEvent.click(botao);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    fireEvent.keyDown(screen.getByRole("group", { name: "Emojis" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Emojis" })).toBeNull();
    expect(botao).toHaveFocus();
  });
});

describe("CaixaEscrever: anexos, citação e faixa", () => {
  /* Os anexos de verdade (o seletor de arquivos) e a gravação pelo microfone estão em
     d5-caixa-escrever.test.tsx (F5 de ligar as telas ao banco). */

  it("citação: o chip aparece, o citaId vai no texto e a citação sai depois de enviar", () => {
    const aoEnviar = vi.fn();
    const aoTirarCitacao = vi.fn();
    render(
      <CaixaEscrever
        conversaId={novaConversa()}
        aoEnviar={aoEnviar}
        citando={{ id: "m7", de: "Ricardo", texto: "Vocês começam no dia 10?" }}
        aoTirarCitacao={aoTirarCitacao}
      />,
    );
    expect(screen.getByText("Respondendo a Ricardo")).toBeInTheDocument();
    fireEvent.change(campo(), { target: { value: "Sim!" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoEnviar).toHaveBeenCalledWith(expect.any(String), { tipo: "texto", texto: "Sim!", citaId: "m7" });
    expect(aoTirarCitacao).toHaveBeenCalledTimes(1);
  });

  it("citação nova põe o foco no campo e o descreve", () => {
    const id = novaConversa();
    const { rerender } = render(<CaixaEscrever conversaId={id} aoEnviar={vi.fn()} />);
    screen.getByRole("button", { name: "Inserir emoji" }).focus();
    rerender(
      <CaixaEscrever
        conversaId={id}
        aoEnviar={vi.fn()}
        citando={{ id: "m9", de: "Ricardo", texto: "Tem horário amanhã?" }}
        aoTirarCitacao={vi.fn()}
      />,
    );
    expect(campo()).toHaveFocus();
    expect(campo()).toHaveAccessibleDescription(/Respondendo a Ricardo/);
  });

  it("recusa no meio: o que saiu sai da caixa e o resto continua", () => {
    const aoEnviar = vi.fn((_c: string, m: NovaMensagem) => (m.tipo === "texto" ? { ok: false } : undefined));
    const aoTirarCitacao = vi.fn();
    const { container } = render(
      <CaixaEscrever
        conversaId={novaConversa()}
        aoEnviar={aoEnviar}
        citando={{ id: "m7", de: "Ricardo", texto: "Manda a proposta?" }}
        aoTirarCitacao={aoTirarCitacao}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Anexar imagem ou documento" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Documento" }));
    const pdf = new File(["%PDF-1.4"], "proposta-revisada.pdf", { type: "application/pdf" });
    fireEvent.change(container.querySelector<HTMLInputElement>("input[type=file]")!, { target: { files: [pdf] } });
    fireEvent.change(campo(), { target: { value: "Segue" } });
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoEnviar).toHaveBeenCalledTimes(2);
    // O documento saiu; o texto (com a citação) ficou.
    expect(screen.queryByRole("list", { name: "Anexos para enviar" })).toBeNull();
    expect(campo()).toHaveValue("Segue");
    expect(aoTirarCitacao).not.toHaveBeenCalled();
    expect(screen.getByText("1 de 2 mensagens enviadas. O resto continua na caixa.")).toBeInTheDocument();
  });

  it("Enter com keyCode 229 (confirmação do teclado no Safari) não envia", () => {
    const aoEnviar = vi.fn();
    render(<CaixaEscrever conversaId={novaConversa()} aoEnviar={aoEnviar} />);
    fireEvent.change(campo(), { target: { value: "olá" } });
    fireEvent.keyDown(campo(), { key: "Enter", keyCode: 229 });
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it("citação: o X e o Esc tiram", () => {
    const aoTirarCitacao = vi.fn();
    render(
      <CaixaEscrever
        conversaId={novaConversa()}
        aoEnviar={vi.fn()}
        citando={{ id: "m7", de: "Janete", texto: "Posso te ajudar?" }}
        aoTirarCitacao={aoTirarCitacao}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Não responder citando" }));
    fireEvent.keyDown(campo(), { key: "Escape" });
    expect(aoTirarCitacao).toHaveBeenCalledTimes(2);
  });

  it("a faixa diz quem atende, com a ação dela", () => {
    const aoClicar = vi.fn();
    render(
      <CaixaEscrever
        conversaId={novaConversa()}
        aoEnviar={vi.fn()}
        faixa={{ tom: "sucesso", texto: "Você assumiu a conversa.", acao: { texto: "Ok", aoClicar } }}
      />,
    );
    // A frase fica dentro da faixa junto com o ícone (que anda com a 1ª linha): procura a faixa acima.
    expect(screen.getByText("Você assumiu a conversa.").closest("[data-tom]")).toHaveAttribute("data-tom", "sucesso");
    expect(campo()).toHaveAccessibleDescription("Você assumiu a conversa.");
    fireEvent.click(screen.getByRole("button", { name: "Ok" }));
    expect(aoClicar).toHaveBeenCalled();
  });
});

describe("CaixaEscrever: os bloqueios", () => {
  it("sem_conexao: explica, desliga tudo e oferece Reconectar", () => {
    const aoEnviar = vi.fn();
    const aoReconectar = vi.fn();
    render(
      <CaixaEscrever
        conversaId={novaConversa()}
        bloqueio="sem_conexao"
        faixa={{ tom: "janete", texto: "Com a Janete." }}
        aoEnviar={aoEnviar}
        aoReconectar={aoReconectar}
      />,
    );
    const texto = "WhatsApp desconectado: nenhuma mensagem sai daqui até reconectar.";
    expect(screen.getByText(texto)).toBeInTheDocument();
    // O bloqueio passa na frente da faixa normal.
    expect(screen.queryByText("Com a Janete.")).toBeNull();
    expect(campo()).toBeDisabled();
    expect(campo()).toHaveAttribute("placeholder", "Envio bloqueado");
    expect(campo()).toHaveAccessibleDescription(texto);
    expect(screen.getByRole("button", { name: "Anexar imagem ou documento" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Inserir emoji" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Gravar áudio/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeDisabled();
    fireEvent.keyDown(campo(), { key: "Enter" });
    expect(aoEnviar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    expect(aoReconectar).toHaveBeenCalled();
  });

  it("sem_conexao para quem não reconecta (atendente): o complemento orienta e não há link", () => {
    render(
      <CaixaEscrever
        conversaId={novaConversa()}
        bloqueio="sem_conexao"
        aoEnviar={vi.fn()}
        complementoBloqueio="Peça a um admin para reconectar."
      />,
    );
    const texto = "WhatsApp desconectado: nenhuma mensagem sai daqui até reconectar. Peça a um admin para reconectar.";
    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(campo()).toHaveAccessibleDescription(texto);
    expect(screen.queryByRole("button", { name: "Reconectar" })).toBeNull();
  });

  it("com o link Reconectar, o complemento não entra (a ação já orienta)", () => {
    render(
      <CaixaEscrever
        conversaId={novaConversa()}
        bloqueio="sem_conexao"
        aoEnviar={vi.fn()}
        aoReconectar={vi.fn()}
        complementoBloqueio="Peça a um admin para reconectar."
      />,
    );
    expect(screen.getByText("WhatsApp desconectado: nenhuma mensagem sai daqui até reconectar.")).toBeInTheDocument();
    expect(screen.queryByText(/Peça a um admin/)).toBeNull();
    expect(screen.getByRole("button", { name: "Reconectar" })).toBeInTheDocument();
  });

  it("janela_fechada: explica a janela de 24 h e não envia", () => {
    const aoEnviar = vi.fn();
    render(<CaixaEscrever conversaId={novaConversa()} bloqueio="janela_fechada" aoEnviar={aoEnviar} />);
    expect(screen.getByText(/Janela de 24 h fechada/)).toBeInTheDocument();
    expect(screen.getByText(/só dá para enviar um modelo aprovado/)).toBeInTheDocument();
    expect(campo()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Reconectar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it("o rascunho continua guardado enquanto está bloqueado", () => {
    const id = novaConversa();
    const { rerender } = render(<CaixaEscrever conversaId={id} aoEnviar={vi.fn()} />);
    fireEvent.change(campo(), { target: { value: "Espera a conexão" } });
    rerender(<CaixaEscrever conversaId={id} bloqueio="sem_conexao" aoEnviar={vi.fn()} />);
    expect(campo()).toHaveValue("Espera a conexão");
    rerender(<CaixaEscrever conversaId={id} aoEnviar={vi.fn()} />);
    expect(campo()).toBeEnabled();
    expect(campo()).toHaveValue("Espera a conexão");
  });
});

/* A gravação de áudio deixou de ser simulada (F5 de ligar as telas ao banco): ela usa o microfone
   (MediaRecorder) e os testes dela, com o microfone falso, estão em d5-caixa-escrever.test.tsx. */
