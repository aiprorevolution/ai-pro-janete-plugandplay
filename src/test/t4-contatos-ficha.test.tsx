import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbaFicha } from "@/features/plataforma/contatos/AbaFicha";
import { AbaMidias } from "@/features/plataforma/contatos/AbaMidias";
import { midiasDoContato } from "@/features/plataforma/contatos/dados";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import {
  criarEstadoInicial,
  idContato,
  telefoneLegivel,
  useExemplo,
  type EstadoBase,
  type EstadoExemplo,
} from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// Task C4 da spec de Contatos (docs/spec-contatos.md): as abas Mídias e Ficha do perfil.

const AGORA = new Date("2026-10-30T17:45:00.000Z");
const RICARDO = idContato("ricardo"); // áudio, imagem e documento
const ALINE = idContato("aline"); // vídeo, figurinha e áudio
const JULIANA = idContato("juliana");

const espiao = vi.hoisted(() => ({ estado: null as EstadoExemplo | null }));

function Espiao() {
  espiao.estado = useExemplo().estado;
  return null;
}

/** Salvar a ficha: a ação da camada de dados é assíncrona, então espera ela voltar. */
async function salvar() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  });
}

const props = (contatoId: string) => ({
  contatoId,
  agora: AGORA.getTime(),
  irParaAba: vi.fn(),
  verNaConversa: vi.fn(),
  avisar: vi.fn(),
});

function montar(ui: React.ReactNode, inicial: () => EstadoBase = () => criarEstadoInicial(AGORA)) {
  return render(
    <StrictMode>
      <ProvedorPapel inicial="admin">
        <ProvedorDados exemplo={inicial} progredirEnvios={false} relogio={() => AGORA}>
          <Espiao />
          {ui}
        </ProvedorDados>
      </ProvedorPapel>
    </StrictMode>,
  );
}

/** A Ficha com o `editando` guardado por fora, como o perfil faz. */
function FichaControlada({ p, inicial = false }: { p: ReturnType<typeof props>; inicial?: boolean }) {
  const [editando, setEditando] = useState(inicial);
  return <AbaFicha {...p} editando={editando} aoEditar={setEditando} />;
}

const contatoNoEstado = (id: string) => espiao.estado!.contatos.find((c) => c.id === id)!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  espiao.estado = null;
});

describe("AbaMidias", () => {
  it("mostra o título, a contagem e as 5 formas de mídia", () => {
    const pr = props(RICARDO);
    const { unmount } = montar(<AbaMidias {...pr} />);
    const midiasRicardo = midiasDoContato(espiao.estado!, RICARDO);
    expect(screen.getByRole("heading", { name: "Mídias trocadas" })).toBeInTheDocument();
    expect(
      screen.getByText(`${midiasRicardo.length} mídias, da mais antiga para a mais nova`),
    ).toBeInTheDocument();

    const cartoes = screen.getAllByRole("listitem");
    expect(cartoes.map((c) => c.getAttribute("data-tipo"))).toEqual(midiasRicardo.map((m) => m.tipo));

    // áudio: a duração e a transcrição
    const audio = cartoes.find((c) => c.getAttribute("data-tipo") === "audio")!;
    expect(within(audio).getByText("0:42")).toBeInTheDocument();
    expect(within(audio).getByText(/É um prédio só, de três andares/)).toBeInTheDocument();
    expect(within(audio).getByText(/^Áudio · Ricardo · /)).toBeInTheDocument();
    // imagem: a cena e o nome
    const imagem = cartoes.find((c) => c.getAttribute("data-tipo") === "imagem")!;
    expect(within(imagem).getByText("fachada-frente.jpg")).toBeInTheDocument();
    expect(imagem.querySelector("svg")).not.toBeNull();
    // documento: a extensão
    const doc = cartoes.find((c) => c.getAttribute("data-tipo") === "documento")!;
    expect(within(doc).getByText("PDF")).toBeInTheDocument();
    expect(within(doc).getByText(/^Documento · Janete · /)).toBeInTheDocument();
    unmount();

    montar(<AbaMidias {...props(ALINE)} />);
    const daAline = screen.getAllByRole("listitem");
    const video = daAline.find((c) => c.getAttribute("data-tipo") === "video")!;
    expect(within(video).getByText("0:18")).toBeInTheDocument();
    expect(within(video).getByText("tour-da-loja.mp4")).toBeInTheDocument();
    const figurinha = daAline.find((c) => c.getAttribute("data-tipo") === "figurinha")!;
    expect(within(figurinha).getByText(/^Figurinha · Aline · /)).toBeInTheDocument();
  });

  it("Ver na conversa chama verNaConversa com o id da mensagem", () => {
    const pr = props(RICARDO);
    montar(<AbaMidias {...pr} />);
    const primeira = midiasDoContato(espiao.estado!, RICARDO)[0]!;
    fireEvent.click(screen.getAllByRole("button", { name: /Ver na conversa/ })[0]!);
    expect(pr.verNaConversa).toHaveBeenCalledWith(primeira.mensagemId);
  });

  it("sem mídia mostra o vazio com o primeiro nome", () => {
    // o estado completo (com o `eu`) vem do provedor: monta vazio, escolhe o contato e monta a aba
    montar(null);
    const estado = espiao.estado!;
    const sem = estado.contatos.find((c) => midiasDoContato(estado, c.id).length === 0)!;
    cleanup();
    montar(<AbaMidias {...props(sem.id)} />);
    const primeiro = (sem.nome ?? sem.nome_whatsapp ?? "").trim().split(/\s+/)[0]!;
    expect(screen.getByText(`Nenhuma mídia trocada com ${primeiro}.`)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("AbaFicha", () => {
  it("mostra os dados, as observações e as datas", () => {
    montar(<FichaControlada p={props(JULIANA)} />);
    const c = contatoNoEstado(JULIANA);
    const dados = screen.getByRole("heading", { name: "Dados do contato" }).closest("section")!;
    expect(within(dados).getByText(c.nome!)).toBeInTheDocument();
    expect(within(dados).getByText(telefoneLegivel(c.telefone))).toBeInTheDocument();
    expect(within(dados).getAllByText(/vem do WhatsApp/)).toHaveLength(2);
    if (c.email) expect(within(dados).getByText(c.email)).toBeInTheDocument();
    if (c.empresa) expect(within(dados).getByText(c.empresa)).toBeInTheDocument();

    const obs = screen.getByRole("heading", { name: "Observações da equipe" }).closest("section")!;
    expect(within(obs).getByText(c.observacoes?.trim() || "Nenhuma observação ainda.")).toBeInTheDocument();

    const datas = screen.getByRole("heading", { name: "Datas" }).closest("section")!;
    expect(within(datas).getByText("Primeira mensagem")).toBeInTheDocument();
    expect(within(datas).getByText(/de outubro de 2026, \d\d:\d\d$/)).toBeInTheDocument();
    expect(within(datas).getByText(/^Hoje, \d\d:\d\d$/)).toBeInTheDocument();
    // a Juliana entrou na etapa hoje (30/10)
    expect(within(datas).getByText("desde 30 out (hoje)")).toBeInTheDocument();
  });

  it("dias na etapa contam no calendário de São Paulo", () => {
    const pr = { ...props(RICARDO) };
    montar(<FichaControlada p={pr} />);
    const c = contatoNoEstado(RICARDO);
    const datas = screen.getByRole("heading", { name: "Datas" }).closest("section")!;
    // o Ricardo foi para Qualificado ontem às 18:11: 1 dia de calendário
    expect(c.etapa_desde).toBeTruthy();
    expect(within(datas).getByText("desde 29 out (1 dia)")).toBeInTheDocument();
  });

  it("a etapa atual diz desde quando, em dias de São Paulo", () => {
    montar(<FichaControlada p={props(JULIANA)} />);
    const c = contatoNoEstado(JULIANA);
    const etapa = espiao.estado!.etapas.find((e) => e.id === c.etapa_id)!;
    const datas = screen.getByRole("heading", { name: "Datas" }).closest("section")!;
    expect(within(datas).getByText(etapa.nome)).toBeInTheDocument();
  });

  it("Editar abre o formulário com o foco no Nome e Salvar grava pelo editarContato", async () => {
    const pr = props(JULIANA);
    montar(<FichaControlada p={pr} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar os dados de/ }));
    const nome = screen.getByLabelText("Nome");
    expect(nome).toHaveFocus();
    // telefone e nome no WhatsApp continuam texto
    expect(screen.queryByLabelText("Telefone")).toBeNull();
    expect(screen.getAllByText(/vem do WhatsApp/)).toHaveLength(2);

    fireEvent.change(nome, { target: { value: "  Juliana Prado Souza  " } });
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: " ju@clinica.com.br " } });
    fireEvent.change(screen.getByLabelText("Empresa"), { target: { value: "   " } });
    await salvar();

    const c = contatoNoEstado(JULIANA);
    expect(c.nome).toBe("Juliana Prado Souza");
    expect(c.email).toBe("ju@clinica.com.br");
    expect(c.empresa).toBeNull();
    expect(pr.avisar).toHaveBeenCalledWith("Dados de Juliana salvos");
    expect(screen.queryByLabelText("Nome")).toBeNull();
    expect(screen.getByText("Juliana Prado Souza")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editar os dados de/ })).toHaveFocus();
  });

  it("e-mail inválido não salva e mostra a frase no campo", () => {
    const pr = props(JULIANA);
    montar(<FichaControlada p={pr} />);
    const antes = contatoNoEstado(JULIANA).email;
    fireEvent.click(screen.getByRole("button", { name: /Editar os dados de/ }));
    const email = screen.getByLabelText("E-mail");
    fireEvent.change(email, { target: { value: "juliana@clinica" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const frase = "Esse e-mail parece incompleto. Confira e salve de novo.";
    expect(screen.getByText(frase)).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(email.getAttribute("aria-describedby")!)).toHaveTextContent(frase);
    expect(contatoNoEstado(JULIANA).email).toBe(antes);
    expect(pr.avisar).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome")).toBeInTheDocument();
  });

  it("apagar o nome de quem tinha nome não salva e diz por quê no campo (a regra do Chat)", () => {
    const pr = props(JULIANA);
    montar(<FichaControlada p={pr} />);
    const antes = contatoNoEstado(JULIANA).nome;
    expect(antes?.trim()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Editar os dados de/ }));
    const nome = screen.getByLabelText("Nome");
    fireEvent.change(nome, { target: { value: "   " } });
    screen.getByLabelText("E-mail").focus(); // tira o foco do Nome
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    const frase = "O nome não pode ficar vazio.";
    expect(screen.getByText(frase)).toBeInTheDocument();
    expect(nome).toHaveAttribute("aria-invalid", "true");
    expect(nome).toHaveFocus();
    expect(contatoNoEstado(JULIANA).nome).toBe(antes);
    expect(pr.avisar).not.toHaveBeenCalled();

    // escrever de novo tira o aviso
    fireEvent.change(nome, { target: { value: "Ju" } });
    expect(screen.queryByText(frase)).toBeNull();
  });

  it("um contato sem nome salva só uma observação", async () => {
    const pr = props(JULIANA);
    const inicial = (): EstadoBase => {
      const base = criarEstadoInicial(AGORA);
      return { ...base, contatos: base.contatos.map((c) => (c.id === JULIANA ? { ...c, nome: null } : c)) };
    };
    montar(<FichaControlada p={pr} />, inicial);
    fireEvent.click(screen.getByRole("button", { name: /Editar os dados de/ }));
    expect(screen.getByLabelText("Nome")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Observações da equipe"), { target: { value: "Ligar à tarde." } });
    await salvar();

    expect(screen.queryByText("O nome não pode ficar vazio.")).toBeNull();
    expect(contatoNoEstado(JULIANA).nome).toBeNull();
    expect(contatoNoEstado(JULIANA).observacoes).toBe("Ligar à tarde.");
    expect(pr.avisar).toHaveBeenCalledTimes(1);
  });

  it("Cancelar desfaz o que foi digitado e fecha o formulário", () => {
    montar(<FichaControlada p={props(JULIANA)} />);
    const antes = contatoNoEstado(JULIANA);
    fireEvent.click(screen.getByRole("button", { name: /Editar os dados de/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Outro nome" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByLabelText("Nome")).toBeNull();
    expect(contatoNoEstado(JULIANA).nome).toBe(antes.nome);
    expect(screen.queryByText("Outro nome")).toBeNull();

    // reabrir começa do que está salvo, não do rascunho desfeito
    fireEvent.click(screen.getByRole("button", { name: /Editar os dados de/ }));
    expect(screen.getByLabelText("Nome")).toHaveValue(antes.nome ?? "");
  });

  it("a observação salva e aparece no bloco", async () => {
    const pr = props(JULIANA);
    montar(<FichaControlada p={pr} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar os dados de/ }));
    fireEvent.change(screen.getByLabelText("Observações da equipe"), {
      target: { value: "  Prefere contato depois das 14h.  " },
    });
    await salvar();

    expect(contatoNoEstado(JULIANA).observacoes).toBe("Prefere contato depois das 14h.");
    const obs = screen.getByRole("heading", { name: "Observações da equipe" }).closest("section")!;
    expect(within(obs).getByText("Prefere contato depois das 14h.")).toBeInTheDocument();
  });

  it("editando = true vindo de fora abre o formulário com o foco no Nome", () => {
    montar(<FichaControlada p={props(JULIANA)} inicial />);
    expect(screen.getByLabelText("Nome")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("Esc no formulário cancela", () => {
    montar(<FichaControlada p={props(JULIANA)} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar os dados de/ }));
    fireEvent.keyDown(screen.getByLabelText("Nome"), { key: "Escape" });
    expect(screen.queryByLabelText("Nome")).toBeNull();
  });
});
