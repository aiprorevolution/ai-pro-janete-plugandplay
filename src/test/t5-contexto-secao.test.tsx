import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerContexto, reiniciarContexto } from "@/features/plataforma/contexto/loja";
import { passaDoLimite, versaoAtual } from "@/features/plataforma/contexto/regras";
import { primeiroAlvo, Secao } from "@/features/plataforma/contexto/Secao";
import type { Alvo, GrupoId } from "@/features/plataforma/contexto/tipos";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C2 da spec do Contexto (docs/spec-contexto.md): a seção da área em 3 colunas, com o editor.

interface Espias {
  aoEscolher: ReturnType<typeof vi.fn<(a: Alvo) => void>>;
  aoTrocarGrupo: ReturnType<typeof vi.fn<(g: GrupoId) => void>>;
  aoVoltar: ReturnType<typeof vi.fn<() => void>>;
}

/** A tela de fora: guarda a área e o item, como a TelaContexto vai fazer. */
function Tela({
  grupo: g0,
  alvo: a0,
  espias,
  estreita = false,
  editorAberto,
}: {
  grupo: GrupoId;
  alvo?: Alvo | undefined;
  espias: Espias;
  estreita?: boolean | undefined;
  editorAberto?: boolean | undefined;
}) {
  const [grupo, setGrupo] = useState<GrupoId>(g0);
  const [alvo, setAlvo] = useState<Alvo>(a0 ?? primeiroAlvo(g0));
  return (
    <Secao
      grupo={grupo}
      alvo={alvo}
      estreita={estreita}
      editorAberto={editorAberto}
      aoEscolher={(a) => {
        espias.aoEscolher(a);
        setAlvo(a);
      }}
      aoTrocarGrupo={(g) => {
        espias.aoTrocarGrupo(g);
        setGrupo(g);
        setAlvo(primeiroAlvo(g));
      }}
      aoVoltar={espias.aoVoltar}
    />
  );
}

interface Montagem {
  grupo: GrupoId;
  alvo?: Alvo;
  papel?: Papel;
  estreita?: boolean;
  editorAberto?: boolean;
}

function montar(props: Montagem) {
  const espias: Espias = { aoEscolher: vi.fn(), aoTrocarGrupo: vi.fn(), aoVoltar: vi.fn() };
  const r = render(
    <ProvedorPapel inicial={props.papel ?? "admin"}>
      <Tela
        grupo={props.grupo}
        alvo={props.alvo}
        espias={espias}
        estreita={props.estreita}
        editorAberto={props.editorAberto}
      />
    </ProvedorPapel>,
  );
  return { ...r, espias };
}

const q = <T extends Element = HTMLElement>(sel: string) =>
  document.querySelector<T & HTMLElement>(sel);
const ids = () => Array.from(document.querySelectorAll("[data-item]")).map((b) => b.getAttribute("data-item"));
const editor = () => q("#ctx-editor")!;
const tituloEditor = () => q("#ctx-ed-tit")!.textContent;
const item = (a: string) => q<HTMLButtonElement>(`[data-item="${a}"]`)!;

beforeEach(() => {
  reiniciarContexto();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  reiniciarContexto();
});

describe("a seção em 3 colunas", () => {
  it("abrir pelo disco mostra o 1º item da área, com o disco grande, o nome e os outros 2 discos", () => {
    montar({ grupo: "oferta" });
    const secao = q("#ctx-secao")!;
    expect(secao).toBeInTheDocument();
    expect(q("#ctx-sd-face-oferta")).toBeInTheDocument();
    expect(q("#ctx-sec-tit")!.textContent).toBe("Sobre a oferta");
    expect(secao.textContent).toContain("4 de 4 com conteúdo");
    expect(document.querySelectorAll("[data-trocar]")).toHaveLength(2);
    expect(q('[data-trocar="oferta"]')).toBeNull();
    expect(q('[data-trocar="conversa"] #ctx-sd-face-conversa')).toBeInTheDocument();
    // a lista com os 4 campos, o 1º aberto
    expect(ids()).toEqual(["empresa_oferta", "cliente_ideal", "preco", "diferenciais"]);
    expect(tituloEditor()).toBe("Empresa e oferta");
    expect(item("empresa_oferta")).toHaveAttribute("aria-current", "true");
    expect(within(editor()).getByText("1 de 4")).toBeInTheDocument();
    // sem nenhuma linha ligando nada
    expect(secao.querySelector("svg path[data-alvo]")).toBeNull();
    // o foco começa no título da área
    expect(document.activeElement).toBe(q("#ctx-sec-tit"));
  });

  it("abrir pela linha mostra aquele item; o contorno do ícone conta a situação", () => {
    montar({ grupo: "conversa", alvo: "objecoes" });
    expect(tituloEditor()).toBe("Objeções");
    expect(item("objecoes")).toHaveAttribute("aria-current", "true");
    expect(item("objecoes").getAttribute("aria-label")).toContain("ainda vazio");
    expect(item("tom_voz").getAttribute("aria-label")).toContain("a Janete sabe");
    expect(within(editor()).getByText("Ainda vazio")).toBeInTheDocument();
    expect(within(editor()).getByText("A Janete ainda não sabe nada sobre Objeções.")).toBeInTheDocument();
  });

  it("um alvo de fora da área abre o 1º item", () => {
    montar({ grupo: "conversa", alvo: "preco" });
    expect(tituloEditor()).toBe("Tom de voz");
  });

  it("data-item troca o editor sem sair da seção e o foco vai para o item clicado", () => {
    const { espias } = montar({ grupo: "oferta" });
    fireEvent.click(item("preco"), { detail: 1 });
    expect(espias.aoEscolher).toHaveBeenCalledWith("preco");
    expect(tituloEditor()).toBe("Preço");
    expect(item("preco")).toHaveAttribute("aria-current", "true");
    expect(item("empresa_oferta")).not.toHaveAttribute("aria-current");
    expect(document.activeElement).toBe(item("preco"));
    expect(item("preco")).toHaveAttribute("data-sem-anel");
    // sem anexos nem links na v1 (decisão 11a)
    expect(within(editor()).queryByText("Anexos e links")).toBeNull();
    expect(within(editor()).queryByText("A Janete aprendeu:")).toBeNull();
    expect(q("#ctx-secao")).toBeInTheDocument();
  });

  it("data-trocar troca a área, com a lista e o editor da área nova", () => {
    const { espias } = montar({ grupo: "oferta", alvo: "preco" });
    fireEvent.click(q('[data-trocar="livres"]')!);
    expect(espias.aoTrocarGrupo).toHaveBeenCalledWith("livres");
    expect(q("#ctx-sec-tit")!.textContent).toBe("Perguntas livres");
    expect(q("#ctx-sd-face-livres")).toBeInTheDocument();
    expect(ids()).toEqual(["livre-1", "livre-2", "livre-3", "livre-novo"]);
    expect(tituloEditor()).toBe("Pergunta livre 1");
    expect(q('[data-trocar="oferta"]')).toBeInTheDocument();
    expect(q('[data-trocar="conversa"]')).toBeInTheDocument();
    expect(document.activeElement).toBe(q("#ctx-sec-tit"));
  });

  it("anterior e próximo andam pela área e ficam desligados nas pontas", () => {
    const { espias } = montar({ grupo: "oferta" });
    const ant = () => q<HTMLButtonElement>('[data-acao="anterior"]')!;
    const prox = () => q<HTMLButtonElement>('[data-acao="proximo"]')!;
    expect(ant()).toBeDisabled();
    expect(prox()).toBeEnabled();
    fireEvent.click(prox());
    expect(espias.aoEscolher).toHaveBeenLastCalledWith("cliente_ideal");
    expect(tituloEditor()).toBe("Cliente ideal");
    expect(within(editor()).getByText("2 de 4")).toBeInTheDocument();
    expect(document.activeElement).toBe(prox());
    fireEvent.click(prox());
    fireEvent.click(prox());
    expect(tituloEditor()).toBe("Diferenciais");
    expect(prox()).toBeDisabled();
    // na ponta, o foco vai para o título do editor
    expect(document.activeElement).toBe(q("#ctx-ed-tit"));
    fireEvent.click(ant());
    expect(espias.aoEscolher).toHaveBeenLastCalledWith("preco");
    expect(tituloEditor()).toBe("Preço");
  });

  it("no StrictMode, o foco fica no item clicado e no próximo (não pula para 'Editar texto')", () => {
    const espias: Espias = { aoEscolher: vi.fn(), aoTrocarGrupo: vi.fn(), aoVoltar: vi.fn() };
    render(
      <StrictMode>
        <ProvedorPapel inicial="admin">
          <Tela grupo="oferta" espias={espias} />
        </ProvedorPapel>
      </StrictMode>,
    );
    expect(q("#ctx-ed-editar")).not.toBeNull();
    fireEvent.click(item("preco"), { detail: 1 });
    expect(tituloEditor()).toBe("Preço");
    expect(document.activeElement).toBe(item("preco"));
    fireEvent.click(q('[data-acao="anterior"]')!);
    expect(tituloEditor()).toBe("Cliente ideal");
    expect(document.activeElement).toBe(q("#ctx-ed-ant"));
    fireEvent.click(q('[data-acao="proximo"]')!);
    expect(tituloEditor()).toBe("Preço");
    expect(document.activeElement).toBe(q("#ctx-ed-prox"));
    // entrar e sair do "Editar texto" continua levando o foco
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    expect(document.activeElement).toBe(q("#ctx-ta-preco"));
    fireEvent.click(screen.getByRole("button", { name: "Terminar edição" }));
    expect(document.activeElement).toBe(q("#ctx-ed-editar"));
  });

  it("os ganchos do mapa não se repetem na seção nem no editor", () => {
    montar({ grupo: "oferta", alvo: "preco" });
    expect(q("#ctx-secao")).toHaveAttribute("data-secao", "oferta");
    expect(document.querySelector("[data-grupo]")).toBeNull();
    expect(document.querySelector("[data-alvo]")).toBeNull();
    expect(q("#ctx-editor [data-ed-alvo='preco'][data-ed-grupo='oferta']")).not.toBeNull();
  });

  it("voltar e Esc chamam aoVoltar", () => {
    const { espias } = montar({ grupo: "oferta" });
    const voltar = q('[data-acao="voltar"]')!;
    expect(voltar.textContent).toContain("Esc");
    fireEvent.click(voltar);
    expect(espias.aoVoltar).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(item("preco"), { key: "Escape" });
    expect(espias.aoVoltar).toHaveBeenCalledTimes(2);
  });
});

describe("o editor de um campo (admin)", () => {
  it("mandar um texto põe 'Não salvo', e 'Salvar versão 7' cria a v7", async () => {
    montar({ grupo: "conversa", alvo: "horario" });
    expect(q("[data-acao=salvar]")).toBeNull();
    const caixa = screen.getByLabelText("Mandar para a Janete sobre Horário");
    fireEvent.change(caixa, { target: { value: "Atendemos de segunda a sexta, das 9h às 18h" } });
    fireEvent.keyDown(caixa, { key: "Enter" });
    expect(within(editor()).getByText("Atendemos de segunda a sexta, das 9h às 18h.")).toBeInTheDocument();
    expect(within(editor()).getByText("Não salvo")).toBeInTheDocument();
    expect(item("horario").getAttribute("aria-label")).toContain("mudanças não salvas");
    const salvar = screen.getByRole("button", { name: "Salvar versão 7" });
    await act(async () => {
      fireEvent.click(salvar);
    });
    const v = versaoAtual(lerContexto());
    expect(v.numero).toBe(7);
    expect(v.origem).toBe("edicao");
    expect(v.campos.horario).toBe("Atendemos de segunda a sexta, das 9h às 18h.");
    // o aviso visual não é região viva; quem fala é a região que já existia na seção
    expect(q("#ctx-secao [aria-live='polite']")!.textContent).toBe("Versão 7 salva");
    expect(q("#ctx-secao [role=status]")).toBeNull();
    expect(within(editor()).getByText("A Janete sabe")).toBeInTheDocument();
    expect(q("[data-acao=salvar]")).toBeNull();
  });

  it("o 'Anotei em…' vai para a região viva da seção; não há botão de anexo nem de link (11a)", () => {
    montar({ grupo: "conversa", alvo: "objecoes" });
    const viva = q("#ctx-secao [aria-live='polite']")!;
    expect(viva.textContent).toBe("");
    const caixa = screen.getByLabelText("Mandar para a Janete sobre Objeções");
    fireEvent.change(caixa, { target: { value: "Quando acham caro, falamos do parcelamento" } });
    fireEvent.keyDown(caixa, { key: "Enter" });
    expect(viva.textContent).toBe("Anotei em Objeções. Salve para eu começar a usar.");
    expect(screen.queryByRole("button", { name: "Anexar um arquivo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mandar um link" })).toBeNull();
    expect(q('input[type="file"]')).toBeNull();
  });

  it("o contador mostra as letras do campo; acima de 2.000, Salvar trava e o aviso diz para cortar (11d)", () => {
    montar({ grupo: "oferta", alvo: "cliente_ideal" });
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    const area = screen.getByLabelText("O que a Janete sabe sobre Cliente ideal");
    fireEvent.change(area, { target: { value: "a".repeat(2000) } });
    expect(within(editor()).getByText("2.000 de 2.000 letras")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar versão 7" })).toBeEnabled();
    fireEvent.change(area, { target: { value: "a".repeat(2001) } });
    const contador = within(editor()).getByText("2.001 de 2.000 letras");
    expect(contador).toHaveAttribute("data-passou");
    expect(screen.getByRole("button", { name: "Salvar versão 7" })).toBeDisabled();
    expect(within(editor()).getByText("Passou de 2.000 letras. Corte um pouco para salvar.")).toBeInTheDocument();
  });

  it("o contador e o limite contam o emoji como 1 letra, como o banco (char_length)", () => {
    montar({ grupo: "oferta", alvo: "cliente_ideal" });
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    const area = screen.getByLabelText("O que a Janete sabe sobre Cliente ideal");
    // 1.990 letras e 10 emojis: 2.010 no .length, 2.000 no banco
    const texto = "a".repeat(1990) + "😀".repeat(10);
    expect(texto.length).toBe(2010);
    fireEvent.change(area, { target: { value: texto } });
    expect(within(editor()).getByText("2.000 de 2.000 letras")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar versão 7" })).toBeEnabled();
    expect(passaDoLimite({ cliente_ideal: texto })).toBe(false);
    expect(passaDoLimite({ cliente_ideal: texto + "😀" })).toBe(true);
    expect(passaDoLimite({ itens: [{ pergunta: "p", resposta: texto }] })).toBe(false);
  });

  it("'O Contexto mudou enquanto você editava': mostra o texto do outro admin e deixa salvar de novo (11b)", async () => {
    montar({ grupo: "oferta", alvo: "preco" });
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.change(screen.getByLabelText("O que a Janete sabe sobre Preço"), { target: { value: "O meu preço" } });
    // outro admin grava o Preço a partir da mesma v6
    const atual = versaoAtual(lerContexto());
    act(() => {
      reiniciarContexto({
        ...lerContexto(),
        versoes: [{ ...atual, id: 7, numero: 7, campos: { ...atual.campos, preco: "O preço do outro admin" } }, ...lerContexto().versoes],
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 8" }));
    });
    expect(within(editor()).getByText(/O Contexto mudou enquanto você editava\./)).toBeInTheDocument();
    expect(q("[data-texto-novo]")!.textContent).toBe("O preço do outro admin");
    expect(versaoAtual(lerContexto()).numero).toBe(7);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 8" }));
    });
    expect(versaoAtual(lerContexto()).campos.preco).toBe("O meu preço");
    expect(q("[data-texto-novo]")).toBeNull();
  });

  it("'Editar texto' não tem aria-pressed: só o rótulo troca", () => {
    montar({ grupo: "oferta", alvo: "cliente_ideal" });
    const btn = screen.getByRole("button", { name: "Editar texto" });
    expect(btn).not.toHaveAttribute("aria-pressed");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Terminar edição" })).not.toHaveAttribute("aria-pressed");
  });

  it("'Editar texto' troca o texto inteiro, e Descartar volta ao salvo", () => {
    montar({ grupo: "oferta", alvo: "cliente_ideal" });
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    const area = screen.getByLabelText("O que a Janete sabe sobre Cliente ideal") as HTMLTextAreaElement;
    expect(area.value).toContain("Donos de empresas");
    fireEvent.change(area, { target: { value: "Clínicas pequenas " } });
    // o que o admin digita não é aparado
    expect((screen.getByLabelText("O que a Janete sabe sobre Cliente ideal") as HTMLTextAreaElement).value).toBe("Clínicas pequenas ");
    expect(screen.getByRole("button", { name: "Salvar versão 7" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(lerContexto().rascunhos.cliente_ideal).toBeUndefined();
    expect(versaoAtual(lerContexto()).numero).toBe(6);
  });

});

describe("as perguntas livres (admin)", () => {
  it("o item novo nasce vazio, com Cancelar; ao salvar, vira a pergunta 4", async () => {
    const { espias } = montar({ grupo: "livres" });
    fireEvent.click(item("livre-novo"));
    expect(tituloEditor()).toBe("Nova pergunta livre");
    expect(within(editor()).getByText("Nasce na versão 7")).toBeInTheDocument();
    const salvar = screen.getByRole("button", { name: "Salvar versão 7" });
    expect(salvar).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pergunta"), { target: { value: "Tem estacionamento?" } });
    fireEvent.change(screen.getByLabelText("Resposta"), { target: { value: "Sim, gratuito." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 7" }));
    });
    const v = versaoAtual(lerContexto());
    expect(v.itens).toHaveLength(4);
    expect(v.itens[3]).toEqual({ pergunta: "Tem estacionamento?", resposta: "Sim, gratuito." });
    expect(espias.aoEscolher).toHaveBeenLastCalledWith("livre-4");
    expect(tituloEditor()).toBe("Pergunta livre 4");
  });

  it("Cancelar no item novo volta para a 1ª pergunta", () => {
    montar({ grupo: "livres", alvo: "livre-novo" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(tituloEditor()).toBe("Pergunta livre 1");
  });

  it("'Remover pergunta' pede confirmação e cria a versão sem ela", async () => {
    montar({ grupo: "livres", alvo: "livre-2" });
    fireEvent.click(screen.getByRole("button", { name: "Remover pergunta" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg.textContent).toContain("Nasce a versão 7");
    // Esc no diálogo cancela sem voltar ao mapa
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(versaoAtual(lerContexto()).numero).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "Remover pergunta" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remover pergunta" }));
    });
    const v = versaoAtual(lerContexto());
    expect(v.numero).toBe(7);
    expect(v.itens).toHaveLength(2);
    // a seguinte sobe para o lugar dela
    expect(tituloEditor()).toBe("Pergunta livre 2");
    expect(document.querySelectorAll('[data-item^="livre-"]:not([data-item="livre-novo"])')).toHaveLength(2);
  });
});

describe("atendente e versão antiga: só leitura", () => {
  it("o atendente não vê Editar texto, a caixa, Salvar nem Novo item livre, e vê o aviso uma vez", () => {
    montar({ grupo: "oferta", alvo: "preco", papel: "atendente" });
    expect(screen.queryByRole("button", { name: "Editar texto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Anexar um arquivo" })).toBeNull();
    expect(q("textarea")).toBeNull();
    expect(screen.queryByRole("button", { name: /Salvar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remover/ })).toBeNull();
    expect(within(editor()).getAllByText(/Como atendente/)).toHaveLength(1);
    fireEvent.click(q('[data-trocar="livres"]')!);
    expect(q('[data-item="livre-novo"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Remover pergunta" })).toBeNull();
    expect(q("input")).toBeNull();
    expect(within(editor()).getByText("Pergunta")).toBeInTheDocument();
    expect(within(editor()).getAllByText(/Como atendente/)).toHaveLength(1);
  });

  it("o atendente não vê o rascunho do admin", () => {
    reiniciarContexto({ rascunhos: { horario: { extras: ["Sábado das 9h às 13h."] } } });
    montar({ grupo: "conversa", alvo: "horario", papel: "atendente" });
    expect(within(editor()).queryByText("Sábado das 9h às 13h.")).toBeNull();
    expect(within(editor()).getByText("Ainda vazio")).toBeInTheDocument();
  });

  it("numa versão antiga, o admin só lê, com o aviso da versão", () => {
    reiniciarContexto({ vendo: 3 });
    montar({ grupo: "livres" });
    expect(q('[data-item="livre-novo"]')).toBeNull();
    expect(document.querySelectorAll("[data-item]")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Salvar/ })).toBeNull();
    expect(within(editor()).getByText(/Versão 3, de .*: só leitura/)).toBeInTheDocument();
    fireEvent.click(q('[data-trocar="oferta"]')!);
    expect(screen.queryByRole("button", { name: "Editar texto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Anexar um arquivo" })).toBeNull();
    expect(within(editor()).getByText(/Diferente da versão atual|Igual à versão atual/)).toBeInTheDocument();
  });
});

describe("celular", () => {
  it("mostra só a lista; tocar num item abre o editor em tela cheia, e o ← volta à lista", () => {
    const { espias } = montar({ grupo: "oferta", estreita: true });
    expect(q("#ctx-editor")).toBeNull();
    expect(q('[data-acao="voltar"]')!.textContent).not.toContain("Esc");
    expect(item("empresa_oferta")).not.toHaveAttribute("aria-current");
    fireEvent.click(item("cliente_ideal"));
    expect(espias.aoEscolher).toHaveBeenCalledWith("cliente_ideal");
    expect(editor()).toHaveAttribute("data-estreita");
    expect(tituloEditor()).toBe("Cliente ideal");
    // um gancho de voltar só na tela: o "←" do editor
    const voltas = document.querySelectorAll('[data-acao="voltar"]');
    expect(voltas).toHaveLength(1);
    expect(voltas[0]!.id).toBe("ctx-ed-volta");
    // Esc com o editor aberto volta para a lista, não para o mapa
    fireEvent.keyDown(q("#ctx-ed-tit")!, { key: "Escape" });
    expect(q("#ctx-editor")).toBeNull();
    expect(espias.aoVoltar).not.toHaveBeenCalled();
    fireEvent.click(item("preco"));
    fireEvent.click(q("#ctx-ed-volta")!);
    expect(q("#ctx-editor")).toBeNull();
    expect(document.activeElement).toBe(item("preco"));
    fireEvent.click(q('[data-acao="voltar"]')!);
    expect(espias.aoVoltar).toHaveBeenCalledTimes(1);
  });

  it("a folha da seção e a do editor são diálogos modais, com o Tab preso dentro; no computador, não", () => {
    montar({ grupo: "oferta", estreita: true });
    const secao = q("#ctx-secao")!;
    expect(secao).toHaveAttribute("role", "dialog");
    expect(secao).toHaveAttribute("aria-modal", "true");
    expect(secao).toHaveAttribute("aria-labelledby", "ctx-sec-tit");
    // do último focável da folha, o Tab volta ao 1º (o Voltar); do 1º, o Shift+Tab vai ao último
    const ultimo = item("diferenciais");
    act(() => ultimo.focus());
    fireEvent.keyDown(ultimo, { key: "Tab" });
    expect(document.activeElement).toBe(q("#ctx-sec-voltar"));
    fireEvent.keyDown(q("#ctx-sec-voltar")!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ultimo);

    fireEvent.click(item("preco"));
    const ed = editor();
    expect(ed).toHaveAttribute("role", "dialog");
    expect(ed).toHaveAttribute("aria-modal", "true");
    expect(ed).toHaveAttribute("aria-labelledby", "ctx-ed-tit");
    // com o editor aberto, o Tab não sai dele para a lista que está por baixo
    const btns = Array.from(ed.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, input"));
    const fim = btns[btns.length - 1]!;
    act(() => fim.focus());
    fireEvent.keyDown(fim, { key: "Tab" });
    expect(ed.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(q("#ctx-ed-volta"));
  });

  it("no computador, a seção e o editor não são diálogos", () => {
    montar({ grupo: "oferta" });
    expect(q("#ctx-secao")).not.toHaveAttribute("role");
    expect(q("#ctx-secao")).not.toHaveAttribute("aria-modal");
    expect(editor()).toHaveAttribute("role", "region");
    expect(editor()).not.toHaveAttribute("aria-modal");
  });

  it("com o alvo vindo de fora já aberto, mostra o editor direto", () => {
    montar({ grupo: "livres", alvo: "livre-3", estreita: true, editorAberto: true });
    expect(tituloEditor()).toBe("Pergunta livre 3");
    expect(document.activeElement).toBe(q("#ctx-ed-tit"));
  });
});
