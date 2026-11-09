import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Bolha,
  CITACAO_FORA,
  ERROS_PODE_TER_CHEGADO,
  LoteMidias,
  citacaoDaMensagem,
  citandoDaMensagem,
  duracaoDe,
  idCitado,
  podeTentarDeNovo,
  textoEstadoMidia,
  type AutorBolha,
  type MensagemBolha,
} from "@/features/plataforma/comum/Bolha";
import { ProvedorDados } from "@/features/plataforma/dados";
import { criarClienteFalso, type OpcoesFalso } from "@/features/plataforma/dados/testes/clienteFalso";
import type { Mensagem } from "@/features/plataforma/exemplo/tipos";

// F5 (ligar as telas ao banco): a bolha com a mídia pelo link assinado (e os estados pendente,
// falhou e expirada), a "cancelada", o "Tentar de novo" da decisão 8, o Reagir escondido (decisão 5)
// e a citação desenhada a partir de responde_a_id (no exemplo, citaId).

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

const LEAD: AutorBolha = { nome: "Ricardo", nomeCompleto: "Ricardo Alves" };
const JANETE: AutorBolha = { nome: "Janete" };
const MARINA: AutorBolha = { nome: "Marina", papel: "Atendente" };
const artigo = () => screen.getByRole("article");

/** O modo banco, com o cliente do Firebase falso da F1 (nada vai à rede). */
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
});

/* =============================================================================
   "Tentar de novo" (decisão 8)
   ============================================================================= */

describe("podeTentarDeNovo: a mesma regra do reenviar_mensagem", () => {
  const falhou = (campos: Partial<MensagemBolha> = {}) =>
    msg({ origem: "humano_tela", status: "falhou", erro: "http_400", ...campos });

  it("só a mensagem da equipe pela tela que falhou", () => {
    expect(podeTentarDeNovo(falhou())).toBe(true);
    expect(podeTentarDeNovo(falhou({ erro: null }))).toBe(true);
    expect(podeTentarDeNovo(falhou({ origem: "janete" }))).toBe(false);
    expect(podeTentarDeNovo(falhou({ origem: "humano_celular" }))).toBe(false);
    expect(podeTentarDeNovo(falhou({ status: "cancelada" }))).toBe(false);
    expect(podeTentarDeNovo(falhou({ status: "enviada" }))).toBe(false);
  });

  it("nunca quando o erro indica que ela pode ter chegado", () => {
    expect([...ERROS_PODE_TER_CHEGADO].sort()).toEqual(["falha_de_rede", "sem_resposta_do_envio", "tempo_esgotado"]);
    for (const erro of ERROS_PODE_TER_CHEGADO) expect(podeTentarDeNovo(falhou({ erro }))).toBe(false);
    for (const erro of ["http_500", "http:502", "meta_503", "zernio_http_504"]) {
      expect(podeTentarDeNovo(falhou({ erro }))).toBe(false);
    }
    // 4xx é recusa: o gateway não aceitou, pode sair de novo.
    expect(podeTentarDeNovo(falhou({ erro: "meta_400" }))).toBe(true);
    // O gateway devolveu o id: ela saiu.
    expect(podeTentarDeNovo(falhou({ id_externo: "wamid.1" }))).toBe(false);
    expect(podeTentarDeNovo(falhou({ id_gateway: "g-1" }))).toBe(false);
  });

  it("falha_no_gateway (o gateway avisou que não entregou) pode sair de novo, mesmo com o id", () => {
    expect(podeTentarDeNovo(falhou({ erro: "falha_no_gateway", id_externo: "wamid.1", id_gateway: "g-1" }))).toBe(true);
  });
});

describe("Bolha: o Tentar de novo com a regra da decisão 8", () => {
  it("a da Janete que falhou mostra só 'Não enviada'", () => {
    const aoTentarDeNovo = vi.fn();
    render(
      <Bolha
        mensagem={msg({ origem: "janete", status: "falhou" })}
        autor={JANETE}
        aoTentarDeNovo={aoTentarDeNovo}
        regraDeReenvio
      />,
    );
    expect(screen.getByText("Não enviada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    expect(artigo()).toHaveAccessibleName(/, Não enviada$/);
  });

  it("a da equipe que falhou e não chegou tem o botão; a que pode ter chegado, não", () => {
    const aoTentarDeNovo = vi.fn();
    const { rerender } = render(
      <Bolha
        mensagem={msg({ origem: "humano_tela", status: "falhou", erro: "janela_fechada" })}
        autor={MARINA}
        aoTentarDeNovo={aoTentarDeNovo}
        regraDeReenvio
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(aoTentarDeNovo).toHaveBeenCalledWith("m1");
    rerender(
      <Bolha
        mensagem={msg({ origem: "humano_tela", status: "falhou", erro: "tempo_esgotado" })}
        autor={MARINA}
        aoTentarDeNovo={aoTentarDeNovo}
        regraDeReenvio
      />,
    );
    expect(screen.getByText("Não enviada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("no modo banco a regra vale sozinha; no exemplo (transição) o reenvio continua livre", () => {
    const janete = msg({ origem: "janete", status: "falhou" });
    banco(<Bolha mensagem={janete} autor={JANETE} aoTentarDeNovo={vi.fn()} />);
    expect(screen.getByText("Não enviada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    cleanup();
    render(<Bolha mensagem={janete} autor={JANETE} aoTentarDeNovo={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    cleanup();
    // A tela pode desligar a regra no banco, ou ligar no exemplo, de propósito.
    render(<Bolha mensagem={janete} autor={JANETE} aoTentarDeNovo={vi.fn()} regraDeReenvio />);
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });
});

describe("Bolha: cancelada", () => {
  it("'Envio cancelado' embaixo, sem vistos nem Tentar de novo", () => {
    render(
      <Bolha mensagem={msg({ origem: "humano_tela", status: "cancelada" })} autor={MARINA} aoTentarDeNovo={vi.fn()} />,
    );
    const linha = screen.getByText("Envio cancelado").closest("p")!;
    expect(linha).toHaveAttribute("data-situacao", "cancelada");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
    expect(artigo().querySelector("[data-vistos]")).toBeNull();
    expect(artigo()).toHaveAccessibleName(/, Envio cancelado$/);
  });
});

/* =============================================================================
   Reagir escondido (decisão 5)
   ============================================================================= */

describe("Bolha: o Reagir fica escondido na v1", () => {
  it("com aoReagir e sem comReagir: só o Responder; a reação que existe aparece, sem botão", () => {
    const aoReagir = vi.fn();
    render(<Bolha mensagem={msg({ reacao: "👍" })} autor={LEAD} aoResponder={vi.fn()} aoReagir={aoReagir} />);
    expect(screen.queryByRole("button", { name: "Reagir a esta mensagem" })).toBeNull();
    expect(screen.getByRole("button", { name: "Responder citando esta mensagem" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Reação 👍" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reação 👍/ })).toBeNull();
  });

  it("só com aoReagir, a mensagem não tem ações (nem recebe foco)", () => {
    render(<Bolha mensagem={msg()} autor={LEAD} aoReagir={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(artigo()).not.toHaveAttribute("tabindex");
  });
});

/* =============================================================================
   Citação a partir de responde_a_id
   ============================================================================= */

describe("Bolha: a citação pelo id citado", () => {
  const citada = msg({ id: "m0", texto: "Vocês começam no dia 10?" });

  it("idCitado: responde_a_id (o banco) ou citaId (o exemplo)", () => {
    expect(idCitado({ responde_a_id: "a", citaId: "b" })).toBe("a");
    expect(idCitado({ citaId: "b" })).toBe("b");
    expect(idCitado({})).toBeNull();
    expect(duracaoDe({ midia_duracao_s: 12, duracaoS: 3 })).toBe(12);
    expect(duracaoDe({ duracaoS: 3 })).toBe(3);
  });

  it("responde_a_id: a bolha pede a citação à tela e desenha", () => {
    const resolver = vi.fn((id: string) => (id === "m0" ? citacaoDaMensagem(citada, "Ricardo") : null));
    render(
      <Bolha
        mensagem={msg({ id: "m2", origem: "humano_tela", status: "enviada", texto: "Sim!", responde_a_id: "m0" })}
        autor={MARINA}
        resolverCitacao={resolver}
      />,
    );
    expect(resolver).toHaveBeenCalledWith("m0");
    const de = screen.getByText("Ricardo");
    expect(de.tagName).toBe("B");
    expect(de.parentElement).toContainElement(screen.getByText("Vocês começam no dia 10?"));
    expect(artigo()).toHaveAccessibleName(/respondendo a Ricardo\. Sim!/);
  });

  it("citaId do exemplo também; a citada fora da página vira 'Mensagem anterior'", () => {
    const { rerender } = render(
      <Bolha mensagem={msg({ id: "m2", citaId: "m0" })} autor={LEAD} resolverCitacao={() => ({ de: "Janete", texto: "Oi" })} />,
    );
    expect(screen.getByText("Janete")).toBeInTheDocument();
    rerender(<Bolha mensagem={msg({ id: "m2", responde_a_id: "sumiu" })} autor={LEAD} resolverCitacao={() => null} />);
    expect(screen.getByText(CITACAO_FORA.de)).toBeInTheDocument();
    expect(screen.getByText(CITACAO_FORA.texto)).toBeInTheDocument();
  });

  it("a citacao da tela ganha do resolver; sem id citado, nada", () => {
    const resolver = vi.fn(() => ({ de: "X", texto: "Y" }));
    const { rerender } = render(
      <Bolha
        mensagem={msg({ responde_a_id: "m0" })}
        autor={LEAD}
        citacao={{ de: "Da tela", texto: "Z" }}
        resolverCitacao={resolver}
      />,
    );
    expect(screen.getByText("Da tela")).toBeInTheDocument();
    expect(resolver).not.toHaveBeenCalled();
    rerender(<Bolha mensagem={msg()} autor={LEAD} resolverCitacao={resolver} />);
    expect(resolver).not.toHaveBeenCalled();
    expect(artigo().querySelector("[class*='boCita']")).toBeNull();
  });

  it("citandoDaMensagem: o que o Responder põe na caixa", () => {
    expect(citandoDaMensagem(msg({ id: "m5", tipo: "audio", texto: null, duracaoS: 42 }), "Ricardo")).toEqual({
      id: "m5",
      de: "Ricardo",
      texto: "Áudio (0:42)",
    });
  });
});

/* =============================================================================
   A mídia nos estados do banco (pendente, falhou, expirada)
   ============================================================================= */

describe("Bolha: a mídia que ainda não abre", () => {
  const foto = (campos: Partial<MensagemBolha> = {}) =>
    msg({ tipo: "imagem", texto: null, midia_nome: "fachada.jpg", midia_mime: "image/jpeg", ...campos });

  it("textoEstadoMidia", () => {
    expect(textoEstadoMidia("pendente", "imagem")).toBe("Baixando a foto do WhatsApp…");
    expect(textoEstadoMidia("falhou", "audio")).toBe("Não deu para baixar o áudio do WhatsApp.");
    expect(textoEstadoMidia("expirada", "documento")).toBe("O arquivo não está mais disponível no WhatsApp.");
    expect(textoEstadoMidia("carregando", "video")).toBe("Carregando o vídeo…");
    expect(textoEstadoMidia("erro_link", "figurinha")).toBe("Não deu para abrir a figurinha.");
    expect(textoEstadoMidia("link", "imagem")).toBe("");
  });

  it.each([
    ["pendente", "Baixando a foto do WhatsApp…"],
    ["falhou", "Não deu para baixar a foto do WhatsApp."],
    ["expirada", "A foto não está mais disponível no WhatsApp."],
  ] as const)("foto %s: o aviso no lugar dela, sem o Ampliar", (status, texto) => {
    render(<Bolha mensagem={foto({ midia_status: status })} autor={LEAD} />);
    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ampliar a foto/ })).toBeNull();
    expect(artigo()).toHaveAccessibleName(new RegExp(`${texto.replace(/[.…]/g, "\\$&")}$`));
    expect(screen.getByText(texto).closest("[data-estado]")).toHaveAttribute("data-estado", status);
  });

  it("áudio baixando: sem o player, com a transcrição", () => {
    render(
      <Bolha
        mensagem={msg({ tipo: "audio", texto: null, duracaoS: 42, midia_status: "pendente", transcricao: "Oi, tudo bem" })}
        autor={LEAD}
      />,
    );
    expect(screen.getByText("Baixando o áudio do WhatsApp…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ouvir o áudio/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Transcrição da Janete/ })).toBeInTheDocument();
  });

  it("documento expirado: o cartão fica, sem o Baixar, com o aviso", () => {
    render(
      <Bolha
        mensagem={msg({ tipo: "documento", texto: null, midia_nome: "proposta.pdf", midia_status: "expirada" })}
        autor={LEAD}
        aoBaixar={vi.fn()}
      />,
    );
    expect(screen.getByText("proposta.pdf")).toBeInTheDocument();
    expect(screen.getByText("O arquivo não está mais disponível no WhatsApp.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Baixar proposta.pdf" })).toBeNull();
  });

  it("vídeo e figurinha que falharam: a caixa do aviso", () => {
    const { rerender } = render(
      <Bolha mensagem={msg({ tipo: "video", texto: null, duracaoS: 9, midia_status: "falhou" })} autor={LEAD} />,
    );
    expect(screen.getByText("Não deu para baixar o vídeo do WhatsApp.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Assistir ao vídeo/ })).toBeNull();
    rerender(<Bolha mensagem={msg({ tipo: "figurinha", texto: null, midia_status: "expirada" })} autor={LEAD} />);
    expect(screen.getByText("A figurinha não está mais disponível no WhatsApp.")).toBeInTheDocument();
  });

  it("no exemplo (sem arquivo), a ilustração de sempre", () => {
    render(<Bolha mensagem={foto({ midia_status: "copiada", midia_caminho: null })} autor={LEAD} />);
    expect(screen.getByRole("button", { name: "Ampliar a foto fachada.jpg" })).toBeInTheDocument();
    expect(artigo().querySelector("[data-estado]")).toBeNull();
  });

  it("a Mensagem do exemplo cabe na bolha sem conversão", () => {
    const m: Mensagem = {
      id: "m1",
      conversa_id: "cv",
      conexao_id: "cx",
      direcao: "saida",
      origem: "humano_tela",
      tipo: "texto",
      status: "falhou",
      texto: "Oi",
      transcricao: null,
      momento: MOMENTO,
      autor_membro_id: null,
      midia_nome: null,
      midia_mime: null,
      midia_tamanho: null,
      midia_caminho: null,
      midia_status: null,
      editada: false,
      apagada_em: null,
      erro: "O WhatsApp não confirmou o envio.",
      criado_em: MOMENTO,
    };
    render(<Bolha mensagem={m} autor={MARINA} aoTentarDeNovo={vi.fn()} regraDeReenvio />);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });
});

/* =============================================================================
   O link assinado (modo banco)
   ============================================================================= */

describe("Bolha: a mídia pelo link assinado", () => {
  const pronta = (campos: Partial<MensagemBolha>) =>
    msg({ texto: null, midia_status: "copiada", ...campos }) as MensagemBolha;

  it("foto: 'Carregando a foto…' e depois a imagem do link", async () => {
    const { f } = banco(
      <Bolha mensagem={pronta({ tipo: "imagem", midia_nome: "fachada.jpg", midia_caminho: "cv-1/m1" })} autor={LEAD} />,
    );
    expect(screen.getByText("Carregando a foto…")).toBeInTheDocument();
    const botao = await screen.findByRole("button", { name: "Ampliar a foto fachada.jpg" });
    expect(botao.querySelector("img")).toHaveAttribute("src", "https://falso/cv-1/m1?v=3600");
    expect(f.assinaturas).toEqual([{ caminhos: ["cv-1/m1"], validade: 3600 }]);
    // Ampliada, a mesma imagem.
    fireEvent.click(botao);
    const janela = screen.getByRole("dialog");
    expect(within(janela).getByRole("img", { name: "fachada.jpg" })).toHaveAttribute("src", "https://falso/cv-1/m1?v=3600");
  });

  it("dentro de um LoteMidias, a conversa inteira pede os links de uma vez", async () => {
    const mensagens: MensagemBolha[] = [
      pronta({ id: "a", tipo: "imagem", midia_caminho: "cv-1/a" }),
      pronta({ id: "b", tipo: "documento", midia_nome: "proposta.pdf", midia_caminho: "cv-1/b" }),
      pronta({ id: "c", tipo: "audio", duracaoS: 7, midia_caminho: "cv-1/c" }),
      pronta({ id: "d", tipo: "video", duracaoS: 9, midia_caminho: "cv-1/d" }),
      msg({ id: "e", tipo: "imagem", texto: null, midia_status: "pendente", midia_caminho: null }),
      msg({ id: "f" }),
    ];
    const { f } = banco(
      <LoteMidias mensagens={mensagens}>
        {mensagens.map((m) => (
          <Bolha key={m.id} mensagem={m} autor={LEAD} />
        ))}
      </LoteMidias>,
    );
    const baixar = await screen.findByRole("link", { name: "Baixar proposta.pdf" });
    expect(baixar).toHaveAttribute("href", "https://falso/cv-1/b?v=3600");
    expect(f.assinaturas).toEqual([{ caminhos: ["cv-1/a", "cv-1/b", "cv-1/c", "cv-1/d"], validade: 3600 }]);
    // O áudio toca o arquivo do link.
    expect(document.querySelector("audio")).toHaveAttribute("src", "https://falso/cv-1/c?v=3600");
    // O vídeo mostra o 1º quadro do próprio arquivo, e ampliado toca com os controles.
    expect(document.querySelector("video")).toHaveAttribute("src", "https://falso/cv-1/d?v=3600#t=0.1");
    fireEvent.click(screen.getByRole("button", { name: /Assistir ao vídeo/ }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Vídeo")).toHaveAttribute("src", "https://falso/cv-1/d?v=3600");
    // A pendente não entra no lote.
    expect(screen.getByText("Baixando a foto do WhatsApp…")).toBeInTheDocument();
  });

  it("o link não veio: 'Não deu para abrir' e Carregar de novo pede outra vez", async () => {
    let falhar = true;
    const { f } = banco(<Bolha mensagem={pronta({ tipo: "imagem", midia_caminho: "cv-1/m1" })} autor={LEAD} />, {
      assinar: (caminhos) =>
        falhar
          ? { data: caminhos.map((p) => ({ path: p, signedUrl: null, error: "Object not found" })), error: null }
          : undefined,
    });
    expect(await screen.findByText("Não deu para abrir a foto.")).toBeInTheDocument();
    falhar = false;
    fireEvent.click(screen.getByRole("button", { name: "Carregar de novo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Ampliar a foto/ })).toBeInTheDocument());
    expect(f.assinaturas).toHaveLength(2);
  });

  it("o pedido do link deu erro: o mesmo aviso", async () => {
    banco(<Bolha mensagem={pronta({ tipo: "documento", midia_nome: "x.pdf", midia_caminho: "cv-1/x" })} autor={LEAD} />, {
      assinar: () => ({ data: null, error: { message: "rede" } }),
    });
    expect(await screen.findByText("Não deu para abrir o arquivo.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Baixar x.pdf" })).toBeNull();
  });

  it("no banco, a mídia sem arquivo nem situação não mostra a ilustração do exemplo", () => {
    banco(<Bolha mensagem={msg({ tipo: "imagem", texto: null, midia_status: null, midia_caminho: null })} autor={LEAD} />);
    expect(screen.getByText("A foto não está disponível.")).toBeInTheDocument();
  });

  it("o urlMidia da tela ganha: nada é pedido", () => {
    const { f } = banco(
      <Bolha
        mensagem={pronta({ tipo: "imagem", midia_caminho: "cv-1/m1" })}
        autor={LEAD}
        urlMidia="https://da-tela/foto.jpg"
      />,
    );
    expect(screen.getByRole("button", { name: /Ampliar a foto/ }).querySelector("img")).toHaveAttribute(
      "src",
      "https://da-tela/foto.jpg",
    );
    expect(f.assinaturas).toEqual([]);
  });

  it("fora do modo banco (sem QueryClient), a bolha com caminho não pede nada nem quebra", () => {
    render(<Bolha mensagem={pronta({ tipo: "imagem", midia_caminho: "cv-1/m1" })} autor={LEAD} />);
    expect(screen.getByRole("button", { name: /Ampliar a foto/ })).toBeInTheDocument();
    render(
      <LoteMidias mensagens={[pronta({ tipo: "imagem", midia_caminho: "cv-1/m1" })]}>
        <p>lista</p>
      </LoteMidias>,
    );
    expect(screen.getByText("lista")).toBeInTheDocument();
  });
});
