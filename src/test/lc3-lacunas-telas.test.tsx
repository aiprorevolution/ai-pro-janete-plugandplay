import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Conversa } from "@/features/plataforma/chat/Conversa";
import { TelaContexto } from "@/features/plataforma/contexto";
import { versoesDeExemplo } from "@/features/plataforma/contexto/dados";
import { Ensinar } from "@/features/plataforma/contexto/Ensinar";
import { acoesContexto, lerContexto, ProvedorFonteContexto, reiniciarContexto, type FonteContexto } from "@/features/plataforma/contexto/loja";
import { Mapa, type PropsMapa } from "@/features/plataforma/contexto/Mapa";
import {
  avisoCamposFracos,
  camposFracos,
  juntarMudancas,
  MAX_ITENS_LIVRES,
  passaDoLimite,
  passaDoTeto,
  versaoAtual,
} from "@/features/plataforma/contexto/regras";
import { primeiroAlvo, Secao } from "@/features/plataforma/contexto/Secao";
import { AVISO_RELEITURA_CONTEXTO } from "@/features/plataforma/contexto/TelaContexto";
import type { Alvo, ChaveCampo, VersaoContexto } from "@/features/plataforma/contexto/tipos";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarEstadoInicial, idContato, idConversa, type EstadoBase } from "@/features/plataforma/exemplo";
import { MOTIVOS_FALHA, seloDaConversa } from "@/features/plataforma/exemplo/regras";
import { GavetaLead } from "@/features/plataforma/kanban/GavetaLead";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C3 das lacunas da mensageria (docs/spec-lacunas-mensageria.md, 2.3, onda A): o motivo
// envio_falhou no exemplo, no Chat e na Gaveta; e, no Contexto, o limite da pergunta livre, o teto
// de 50 perguntas e o aviso de campo fraco no cabeçalho. Tudo com os dados de exemplo em memória.

// O VooJanete simulado, como em t5-contexto-tela (o voo resolve na hora).
const controle = vi.hoisted(() => ({
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
}));
vi.mock("@/components/janete/VooJanete", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/janete/VooJanete")>();
  return { ...real, useVooJanete: () => controle, movimentoReduzido: () => false };
});

// A ficha e a conversa usam o roteador; aqui não há roteador montado.
const navegar = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navegar,
}));

// Quinta-feira, 30/10/2026, 14:45 em São Paulo.
const AGORA = new Date("2026-10-30T17:45:00.000Z");

const AVISO_ENVIO =
  "A mensagem da Janete pode não ter chegado ao lead. Confira no WhatsApp antes de devolver. Se o problema for a conexão do WhatsApp, a Janete volta a falhar até alguém resolver na Configuração.";
const TEXTO_TETO = "O Contexto já tem 50 perguntas livres. Apague uma para criar outra.";

beforeEach(() => {
  reiniciarContexto({ jaEntrou: true });
});

afterEach(() => {
  cleanup();
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  reiniciarContexto();
  document.getElementById("janete-gatilho")?.remove();
});

/* ---------- ajudantes ---------- */

/** O exemplo com a conversa da Juliana parada por envio que falhou (no lugar do sem_credito). */
function comEnvioFalhou(e: EstadoBase): EstadoBase {
  const id = idConversa("juliana");
  return { ...e, conversas: e.conversas.map((c) => (c.id === id ? { ...c, motivo_humano: "envio_falhou" } : c)) };
}

function Dados({ children, papel = "admin" }: { children: ReactNode; papel?: Papel }) {
  return (
    <ProvedorPapel inicial={papel}>
      <ProvedorDados exemplo={() => comEnvioFalhou(criarEstadoInicial(AGORA))} progredirEnvios={false} relogio={() => AGORA}>
        {children}
      </ProvedorDados>
    </ProvedorPapel>
  );
}

/** A atual do exemplo (v6) com `n` perguntas livres. */
function comItens(n: number): VersaoContexto[] {
  const [v6, ...resto] = versoesDeExemplo();
  const itens = Array.from({ length: n }, (_, i) => ({ pergunta: `Pergunta ${i + 1}?`, resposta: `Resposta ${i + 1}.` }));
  return [{ ...v6!, itens }, ...resto];
}

/** A atual do exemplo com os 8 campos bons (20 letras ou mais), salvo os `curtos`, que ficam com 19. */
function comCampos(curtos: readonly ChaveCampo[]): VersaoContexto[] {
  const [v6, ...resto] = versoesDeExemplo();
  const campos = { ...v6!.campos };
  for (const c of Object.keys(campos) as ChaveCampo[]) {
    // 20 letras sem contar espaços; o curto tem 19 (os espaços não contam). Em Horário, Preço e Tom
    // de voz só o vazio é fraco (decisão 12): ali o curto é vazio.
    const soVazio = c === "horario" || c === "preco" || c === "tom_voz";
    campos[c] = curtos.includes(c) ? (soVazio ? "" : "abcde fghij klmno pqrs") : "abcde fghij klmno pqrst";
  }
  return [{ ...v6!, campos }, ...resto];
}

/* ---------- o motivo envio_falhou ---------- */

describe("envio_falhou", () => {
  it("entra no MOTIVOS_FALHA do exemplo: a conversa ganha o selo de falha", () => {
    expect(MOTIVOS_FALHA).toContain("envio_falhou");
    expect(
      seloDaConversa({ modo: "humano", responsavel_id: null, motivo_humano: "envio_falhou", aguardando_humano_desde: AGORA.toISOString() }),
    ).toBe("falha");
  });

  it('Chat: o "Devolver mesmo assim?" explica o envio que falhou', () => {
    render(
      <Dados>
        <Conversa conversaId={idConversa("juliana")} fichaAberta={false} onAlternarFicha={vi.fn()} />
      </Dados>,
    );
    const bastao = screen.getByRole("group", { name: "Quem conduz a conversa" });
    fireEvent.click(within(bastao).getByRole("button", { name: /^Devolver à Janete/ }));
    const dlg = screen.getByRole("alertdialog", { name: "Devolver para a Janete mesmo assim?" });
    expect(dlg).toHaveAccessibleDescription(AVISO_ENVIO);
    // a faixa sobre a caixa usa o motivo curto
    expect(screen.getByText("Mensagem não entregue: a Janete parou. Ao responder, você assume.")).toBeInTheDocument();
  });

  it('Gaveta do Kanban: o mesmo aviso no "Devolver mesmo assim?"', () => {
    function ComGaveta() {
      const [aberto, setAberto] = useState<string | null>(null);
      return (
        <>
          <button type="button" onClick={() => setAberto(idContato("juliana"))}>
            Abrir
          </button>
          <GavetaLead contatoId={aberto} aoFechar={() => setAberto(null)} />
        </>
      );
    }
    render(
      <Dados>
        <ComGaveta />
      </Dados>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const g = screen.getByRole("dialog", { name: "Conversa com Juliana Prado" });
    fireEvent.click(within(g).getByRole("button", { name: /^Devolver à Janete/ }));
    const d = screen.getByRole("alertdialog", { name: "Devolver para a Janete mesmo assim?" });
    expect(d).toHaveAccessibleDescription(AVISO_ENVIO);
  });
});

/* ---------- a pergunta livre: 2.000 letras ---------- */

function SecaoLivres({ alvo }: { alvo: Alvo }) {
  const [a, setA] = useState<Alvo>(alvo);
  return <Secao grupo="livres" alvo={a} estreita={false} aoEscolher={setA} aoTrocarGrupo={vi.fn()} aoVoltar={vi.fn()} />;
}

function montarSecao(alvo: Alvo = primeiroAlvo("livres")) {
  return render(
    <ProvedorPapel inicial="admin">
      <SecaoLivres alvo={alvo} />
    </ProvedorPapel>,
  );
}

const editor = () => document.querySelector<HTMLElement>("#ctx-editor")!;

describe("a pergunta da pergunta livre (até 2.000 letras)", () => {
  it("o campo tem maxLength 2.000 e o contador, ligado pelo aria-describedby", () => {
    montarSecao("livre-1");
    const perg = screen.getByLabelText("Pergunta") as HTMLInputElement;
    expect(perg.maxLength).toBe(2000);
    const pergunta = versaoAtual(lerContexto()).itens[0]!.pergunta;
    const contador = document.getElementById(perg.getAttribute("aria-describedby")!)!;
    expect(contador).toHaveTextContent(`${pergunta.length} de 2.000 letras`);
    fireEvent.change(perg, { target: { value: "a".repeat(2000) } });
    expect(contador).toHaveTextContent("2.000 de 2.000 letras");
    expect(contador).not.toHaveAttribute("data-passou");
    expect(screen.getByRole("button", { name: "Salvar versão 7" })).toBeEnabled();
  });

  it("uma pergunta que já chega acima de 2.000 (pelo Ensinar) acende o contador e trava o salvar", () => {
    reiniciarContexto({ jaEntrou: true, rascunhos: { "livre-novo": { base: 6, pergunta: "a".repeat(2001), resposta: "Sim." } } });
    montarSecao("livre-novo");
    const perg = screen.getByLabelText("Pergunta");
    const contador = document.getElementById(perg.getAttribute("aria-describedby")!)!;
    expect(contador).toHaveTextContent("2.001 de 2.000 letras");
    expect(contador).toHaveAttribute("data-passou");
    expect(screen.getByRole("button", { name: "Salvar versão 7" })).toBeDisabled();
    expect(within(editor()).getByText("Passou de 2.000 letras. Corte um pouco para salvar.")).toBeInTheDocument();
  });

  it("passaDoLimite confere também a pergunta (o emoji vale 1 letra)", () => {
    expect(passaDoLimite({ itens: [{ pergunta: "a".repeat(2000), resposta: "r" }] })).toBe(false);
    expect(passaDoLimite({ itens: [{ pergunta: "a".repeat(2001), resposta: "r" }] })).toBe(true);
    expect(passaDoLimite({ itens: [{ pergunta: "a".repeat(1999) + "😀", resposta: "r" }] })).toBe(false);
    expect(passaDoLimite({ itens: [{ pergunta: "p", resposta: "a".repeat(2001) }] })).toBe(true);
    // o modo em memória recusa como o banco
    const atual = versaoAtual(lerContexto());
    expect(juntarMudancas(atual, atual, { itens: [{ pergunta: "a".repeat(2001), resposta: "r" }] })).toEqual({
      ok: false,
      erro: "limite_tamanho",
    });
  });

  it("salvar uma pergunta acima de 2.000 é recusado pela loja com limite_tamanho", async () => {
    reiniciarContexto({ jaEntrou: true, rascunhos: { "livre-1": { base: 6, pergunta: "a".repeat(2001) } } });
    const r = await acoesContexto("admin").salvar("livre-1");
    expect(r).toEqual({ ok: false, erro: "limite_tamanho" });
  });
});

/* ---------- o teto de 50 perguntas livres ---------- */

const propsMapa = (extra: Partial<PropsMapa> = {}): PropsMapa => ({
  fase: "pronto",
  pilhaRef: createRef<HTMLDivElement>(),
  aoAbrir: vi.fn(),
  aoAbrirEnsinar: vi.fn(),
  ensinarAberto: false,
  estreita: false,
  ...extra,
});

function montarEnsinar() {
  const aoDescobrir = vi.fn<(a: Alvo) => void>();
  const aoAbrirAlvo = vi.fn<(a: Alvo) => void>();
  render(
    <ProvedorPapel inicial="admin">
      <Ensinar aberto pensarMs={0} aoFechar={vi.fn()} aoDescobrir={aoDescobrir} aoAbrirAlvo={aoAbrirAlvo} />
    </ProvedorPapel>,
  );
  return { aoDescobrir, aoAbrirAlvo };
}

function escrever(texto: string) {
  const caixa = document.getElementById("ens-in") as HTMLTextAreaElement;
  fireEvent.change(caixa, { target: { value: texto } });
  fireEvent.keyDown(caixa, { key: "Enter" });
}

describe("o teto de 50 perguntas livres", () => {
  it("é uma constante só, a mesma do banco", () => {
    expect(MAX_ITENS_LIVRES).toBe(50);
    const itens = (n: number) => Array.from({ length: n }, () => ({ pergunta: "p", resposta: "r" }));
    expect(passaDoTeto({ itens: itens(50) })).toBe(false);
    expect(passaDoTeto({ itens: itens(51) })).toBe(true);
    const atual = versaoAtual(lerContexto());
    expect(juntarMudancas(atual, atual, { itens: itens(51) })).toEqual({ ok: false, erro: "limite_itens" });
  });

  it("Mapa: com 49, o cartão 'Novo item livre' abre; com 50, fica desligado e diz por quê", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comItens(49) });
    const p = propsMapa();
    const r = render(
      <ProvedorPapel inicial="admin">
        <Mapa {...p} />
      </ProvedorPapel>,
    );
    let card = document.getElementById("ctx-card-novo")!;
    expect(card).not.toHaveAttribute("aria-disabled");
    fireEvent.click(card);
    expect(p.aoAbrir).toHaveBeenCalledWith("livre-novo");
    r.unmount();

    reiniciarContexto({ jaEntrou: true, versoes: comItens(50) });
    const p2 = propsMapa();
    render(
      <ProvedorPapel inicial="admin">
        <Mapa {...p2} />
      </ProvedorPapel>,
    );
    card = document.getElementById("ctx-card-novo")!;
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(card).toHaveAttribute("data-desligado");
    // o motivo se vê no cartão e o leitor de tela ouve como descrição
    expect(card).toHaveTextContent(TEXTO_TETO);
    expect(card).toHaveAccessibleDescription(TEXTO_TETO);
    fireEvent.click(card);
    expect(p2.aoAbrir).not.toHaveBeenCalled();
  });

  it("Ensinar: uma pergunta com 50 já salvas não vira a 51ª; o balão diz o motivo", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comItens(50) });
    const { aoDescobrir } = montarEnsinar();
    escrever("Vocês fazem entrega?");
    expect(lerContexto().rascunhos["livre-novo"]).toBeUndefined();
    expect(aoDescobrir).not.toHaveBeenCalled();
    const balao = document.getElementById("ctx-ens")!;
    expect(balao).toHaveTextContent(TEXTO_TETO);
    expect(balao.querySelector("[aria-live='polite']")!).toHaveTextContent(TEXTO_TETO);
    expect(within(balao).queryByRole("button", { name: "Abrir a pergunta nova" })).toBeNull();
    // "Ensinar outra coisa" volta para a caixa, com a frase que não coube (I-12 da revisão)
    fireEvent.click(within(balao).getByRole("button", { name: "Ensinar outra coisa" }));
    expect(document.getElementById("ens-in")).toHaveValue("Vocês fazem entrega?");
  });

  it("Ensinar: o chip 'Pergunta livre' também para no teto", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comItens(50) });
    montarEnsinar();
    escrever("Gostamos muito de café");
    fireEvent.click(screen.getByRole("button", { name: "Pergunta livre" }));
    expect(lerContexto().rascunhos["livre-novo"]).toBeUndefined();
    expect(document.getElementById("ctx-ens")!).toHaveTextContent(TEXTO_TETO);
    fireEvent.click(screen.getByRole("button", { name: "Ensinar outra coisa" }));
    expect(document.getElementById("ens-in")).toHaveValue("Gostamos muito de café");
  });

  it("a loja fecha todo caminho: novoItem, ensinarEm, ensinar e salvar do item novo", async () => {
    reiniciarContexto({ jaEntrou: true, versoes: comItens(50) });
    const acoes = acoesContexto("admin");
    expect(acoes.novoItem()).toEqual({ ok: false, erro: "limite_itens" });
    expect(acoes.novoItem("Tem estacionamento?")).toEqual({ ok: false, erro: "limite_itens" });
    expect(acoes.ensinarEm("livre", "Tem estacionamento?")).toEqual({ ok: false, erro: "limite_itens" });
    expect(acoes.ensinar("Tem estacionamento?")).toEqual({ ok: false, erro: "limite_itens" });
    expect(lerContexto().rascunhos["livre-novo"]).toBeUndefined();
    // um campo continua recebendo o que se ensina
    expect(acoes.ensinar("atendemos sábado das 9h")).toEqual({ ok: true, alvo: "horario" });

    // um rascunho do item novo que sobrou de antes do teto não grava a 51ª
    reiniciarContexto({ jaEntrou: true, versoes: comItens(50), rascunhos: { "livre-novo": { base: 6, pergunta: "Nova?", resposta: "Sim." } } });
    expect(await acoesContexto("admin").salvar("livre-novo")).toEqual({ ok: false, erro: "limite_itens" });
    expect(versaoAtual(lerContexto()).itens).toHaveLength(50);

    // com 49, o item novo grava e vira o 50º
    reiniciarContexto({ jaEntrou: true, versoes: comItens(49), rascunhos: { "livre-novo": { base: 6, pergunta: "Nova?", resposta: "Sim." } } });
    expect(await acoesContexto("admin").salvar("livre-novo")).toEqual({ ok: true, versao: 7 });
    expect(versaoAtual(lerContexto()).itens).toHaveLength(50);
  });

  it("Seção: o 'Novo item livre' no teto mostra o motivo e não deixa salvar", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comItens(50), rascunhos: { "livre-novo": { base: 6, pergunta: "Nova?", resposta: "Sim." } } });
    montarSecao("livre-novo");
    expect(within(editor()).getByText(TEXTO_TETO)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar versão 7" })).toBeDisabled();
    // o rascunho que sobrou fica só de leitura, com o motivo ligado aos dois campos
    const perg = screen.getByLabelText("Pergunta") as HTMLInputElement;
    const resp = screen.getByLabelText("Resposta") as HTMLTextAreaElement;
    for (const campo of [perg, resp]) {
      expect(campo).toHaveAttribute("readonly");
      expect(campo).toHaveAccessibleDescription(expect.stringContaining(TEXTO_TETO));
    }
  });

  it("Seção: com 50, o 'Novo item livre' da lista fica desligado, diz por quê e não abre o editor", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comItens(50) });
    montarSecao("livre-1");
    const item = document.getElementById("ctx-it-livre-novo")!;
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("data-desligado");
    expect(item).toHaveTextContent(TEXTO_TETO);
    expect(item).toHaveAccessibleDescription(TEXTO_TETO);
    fireEvent.click(item);
    expect(editor().querySelector("[data-ed-alvo]")).toHaveAttribute("data-ed-alvo", "livre-1");
    expect(lerContexto().rascunhos["livre-novo"]).toBeUndefined();
  });

  it("Seção: com 49, o 'Novo item livre' da lista abre o editor do item novo", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comItens(49) });
    montarSecao("livre-1");
    const item = document.getElementById("ctx-it-livre-novo")!;
    expect(item).not.toHaveAttribute("aria-disabled");
    expect(item).not.toHaveAttribute("aria-describedby");
    fireEvent.click(item);
    expect(editor().querySelector("[data-ed-alvo]")).toHaveAttribute("data-ed-alvo", "livre-novo");
    expect(screen.getByLabelText("Pergunta")).not.toHaveAttribute("readonly");
  });

  it("a loja: no teto, editarItem do item novo é recusado (e o das perguntas salvas, não)", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comItens(50) });
    const acoes = acoesContexto("admin");
    expect(acoes.editarItem("livre-novo", { pergunta: "Nova?" })).toEqual({ ok: false, erro: "limite_itens" });
    expect(acoes.editarItem("livre-novo", { resposta: "Sim." })).toEqual({ ok: false, erro: "limite_itens" });
    expect(lerContexto().rascunhos["livre-novo"]).toBeUndefined();
    expect(acoes.editarItem("livre-1", { pergunta: "Outra?" })).toEqual({ ok: true });
  });
});

/* ---------- o aviso de campo fraco no cabeçalho ---------- */

function montarTela(fonte?: FonteContexto) {
  const tela = fonte ? (
    <ProvedorFonteContexto value={fonte}>
      <TelaContexto />
    </ProvedorFonteContexto>
  ) : (
    <TelaContexto />
  );
  return render(<ProvedorPapel inicial="admin">{tela}</ProvedorPapel>);
}

/** Uma fonte de banco simulada, com as versões dadas e a leitura no estado pedido. */
function fonteSimulada(versoes: VersaoContexto[], leitura: Partial<Pick<FonteContexto, "carregando" | "erro" | "pronta">>): FonteContexto {
  return {
    modo: "banco",
    versoes,
    carregando: false,
    erro: null,
    pronta: true,
    tentarDeNovo: vi.fn(),
    historico: {
      carregando: false,
      erro: null,
      tentarDeNovo: vi.fn(),
      temMaisAntigas: false,
      carregarMaisAntigas: vi.fn(),
      carregandoMaisAntigas: false,
    },
    gravar: vi.fn(),
    restaurar: vi.fn(),
    ...leitura,
  };
}

const avisoFraco = () => document.querySelector("[data-aviso-fraco]");

describe("o aviso de campo fraco (decisão 7)", () => {
  it("avisoCamposFracos junta os rótulos na ordem da tela, por vírgula", () => {
    expect(avisoCamposFracos(["preco", "diferenciais"])).toBe("A Janete sabe pouco sobre: Preço, Diferenciais");
    expect(avisoCamposFracos([])).toBeNull();
  });

  it("aparece no cabeçalho com os rótulos dos fracos, na ordem da tela", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comCampos(["diferenciais", "preco"]) });
    montarTela();
    expect(avisoFraco()).toHaveTextContent(/^A Janete sabe pouco sobre: Preço, Diferenciais$/);
    // discreto: um parágrafo no cabeçalho, sem botão nem região de alerta
    expect(avisoFraco()!.tagName).toBe("P");
    expect(avisoFraco()).not.toHaveAttribute("role");
  });

  it("com o exemplo (Objeções e Horário vazios), aponta os dois", () => {
    montarTela();
    const fracos = camposFracos(versaoAtual(lerContexto()));
    expect(fracos).toEqual(expect.arrayContaining(["objecoes", "horario"]));
    expect(avisoFraco()).toHaveTextContent("Objeções");
    expect(avisoFraco()).toHaveTextContent("Horário");
  });

  it("some com todos os campos bons", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comCampos([]) });
    montarTela();
    expect(avisoFraco()).toBeNull();
    expect(screen.queryByText(/A Janete sabe pouco sobre/)).toBeNull();
  });

  it("Horário, Preço e Tom de voz curtos não entram; vazios, sim; os outros 5 curtos continuam (decisão 12)", () => {
    const [v6, ...resto] = comCampos(["diferenciais"]);
    const campos = { ...v6!.campos, horario: "24h", preco: "R$ 97", tom_voz: "Informal" };
    reiniciarContexto({ jaEntrou: true, versoes: [{ ...v6!, campos }, ...resto] });
    const r = montarTela();
    expect(avisoFraco()).toHaveTextContent(/^A Janete sabe pouco sobre: Diferenciais$/);
    r.unmount();

    reiniciarContexto({ jaEntrou: true, versoes: comCampos(["preco", "tom_voz", "horario"]) });
    montarTela();
    expect(avisoFraco()).toHaveTextContent(/^A Janete sabe pouco sobre: Preço, Tom de voz, Horário$/);
  });

  it("olha a versão salva atual, não o rascunho", () => {
    reiniciarContexto({ jaEntrou: true, versoes: comCampos(["preco"]), rascunhos: { preco: { base: 6, texto: "um preço bem explicado, com várias letras" } } });
    montarTela();
    expect(avisoFraco()).toHaveTextContent(/^A Janete sabe pouco sobre: Preço$/);
  });

  it("não aparece enquanto carrega", () => {
    montarTela(fonteSimulada([], { carregando: true, pronta: false }));
    expect(screen.getByRole("status", { name: "Carregando o Contexto" })).toBeInTheDocument();
    expect(avisoFraco()).toBeNull();
  });

  it("não aparece quando a leitura falhou (nem na 1ª, nem na releitura com a tela pronta)", async () => {
    const r = montarTela(fonteSimulada([], { erro: "falha", pronta: false }));
    expect(screen.getByText("Não deu para carregar o Contexto")).toBeInTheDocument();
    expect(avisoFraco()).toBeNull();
    r.unmount();

    await act(async () => {
      montarTela(fonteSimulada(comCampos(["preco"]), { erro: "falha", pronta: true }));
    });
    expect(screen.getByText(AVISO_RELEITURA_CONTEXTO)).toBeInTheDocument();
    expect(avisoFraco()).toBeNull();
  });

  it("com a fonte do banco pronta, aparece igual", async () => {
    await act(async () => {
      montarTela(fonteSimulada(comCampos(["preco", "diferenciais"]), {}));
    });
    expect(avisoFraco()).toHaveTextContent(/^A Janete sabe pouco sobre: Preço, Diferenciais$/);
  });
});
