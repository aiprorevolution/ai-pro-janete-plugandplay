import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaContexto } from "@/features/plataforma/contexto";
import { AVISO_RELEITURA_CONTEXTO } from "@/features/plataforma/contexto/TelaContexto";
import { Historico } from "@/features/plataforma/contexto/Historico";
import { reiniciarContexto } from "@/features/plataforma/contexto/loja";
import { PonteContextoBanco } from "@/features/plataforma/contexto/ponte";
import { erroDaTela } from "@/features/plataforma/contexto/regras";
import { Secao } from "@/features/plataforma/contexto/Secao";
import type { Alvo, GrupoId } from "@/features/plataforma/contexto/tipos";
import { CHAVES } from "@/features/plataforma/dados/chaves";
import { TAMANHO_PAGINA_CONTEXTO } from "@/features/plataforma/dados/contexto";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta, type OpcoesFalso, type Resposta } from "@/features/plataforma/dados/testes/clienteFalso";
import type { VersaoContextoBanco } from "@/features/plataforma/dados/tipos";
import { ProvedorPapel, type Papel } from "@/features/plataforma/papel";

// Task C6 da spec de ligar as telas ao banco: o Contexto no modo banco, com um cliente do Firebase
// falso (nada vai à rede). A atual vem de useContextoAtual (maior id); o histórico, de 30 em 30;
// salvar e restaurar pelas rpcs contexto_salvar e contexto_restaurar.

vi.mock("@/components/janete/VooJanete", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/janete/VooJanete")>();
  return {
    ...real,
    useVooJanete: () => ({ ativo: false, pousar: vi.fn(), voar: vi.fn(() => Promise.resolve()), mudarEstado: vi.fn(), legenda: vi.fn(), soltar: vi.fn() }),
    movimentoReduzido: () => true,
  };
});

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EU = "mb-eu";
const ANA = "mb-ana";

const membro = (papel: Papel) => ({
  id: EU,
  nome: "equipe",
  email: "operador@teste.com",
  papel,
  ativo: true,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
});
const MEMBROS = [
  membro("admin"),
  { id: ANA, nome: "Ana Lima", email: "ana@teste.com", papel: "admin", ativo: false, user_id: "u-ana", criado_em: "2026-10-02T12:00:00.000Z", vistos: {} },
];

function linha(id: number, extra: Partial<VersaoContextoBanco> = {}): VersaoContextoBanco {
  return {
    id,
    numero: id - 10,
    empresa_oferta: "Padaria do bairro",
    cliente_ideal: "",
    preco: `Preço da versão ${id - 10}`,
    diferenciais: "",
    objecoes: "",
    quando_passar_humano: "",
    tom_voz: "Próximo",
    horario: "",
    itens: [{ pergunta: "Abre domingo?", resposta: "Sim, até 12h." }],
    origem: "edicao",
    criado_por: EU,
    criado_em: "2026-11-01T10:00:00-03:00",
    restaurada_de: null,
    ...extra,
  };
}

interface Banco {
  /** Da mais nova para a mais velha (maior id primeiro). */
  linhas: VersaoContextoBanco[];
  erroAtual?: unknown;
}

function montar(
  banco: Banco,
  opcoes: {
    papel?: Papel;
    rpc?: OpcoesFalso["rpc"];
    filho?: "tela" | "historico" | "secao";
    secao?: { grupo: GrupoId; alvo: Alvo };
  } = {},
) {
  const { papel = "admin", filho = "tela", secao = { grupo: "oferta", alvo: "preco" } } = opcoes;
  const responder = (c: Consulta): Resposta | undefined => {
    if (c.tabela === "membros") return c.unica ? { data: membro(papel), error: null } : { data: MEMBROS, error: null };
    if (c.tabela !== "contexto_versoes") return undefined;
    const ordenadas = [...banco.linhas].sort((a, b) => b.id - a.id);
    const range = c.passos.find((p) => p[0] === "range");
    const eq = c.passos.find((p) => p[0] === "eq");
    const em = c.passos.find((p) => p[0] === "in");
    if (em) return { data: ordenadas.filter((l) => (em[2] as number[]).includes(l.id)).map((l) => ({ id: l.id, numero: l.numero })), error: null };
    if (eq) return { data: ordenadas.find((l) => l.id === eq[2]) ?? null, error: null };
    if (range) return { data: ordenadas.slice(range[1] as number, (range[2] as number) + 1), error: null };
    if (c.unica) return banco.erroAtual ? { data: null, error: banco.erroAtual } : { data: ordenadas[0] ?? null, error: null };
    return undefined;
  };
  const f = criarClienteFalso({ uid: UID, consulta: responder, ...(opcoes.rpc ? { rpc: opcoes.rpc } : {}) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(CHAVES.eu, membro(papel));
  const conteudo =
    filho === "tela" ? (
      <TelaContexto />
    ) : filho === "historico" ? (
      <PonteContextoBanco>
        <Historico aberto aoFechar={() => {}} agora="2026-11-02T12:00:00-03:00" />
      </PonteContextoBanco>
    ) : (
      <PonteContextoBanco>
        <Secao grupo={secao.grupo} alvo={secao.alvo} aoEscolher={() => {}} aoTrocarGrupo={() => {}} aoVoltar={() => {}} estreita={false} />
      </PonteContextoBanco>
    );
  const r = render(
    <QueryClientProvider client={qc}>
      <ProvedorDados fonte="banco" cliente={f.cliente}>
        <ProvedorPapel inicial={papel}>{conteudo}</ProvedorPapel>
      </ProvedorDados>
    </QueryClientProvider>,
  );
  return { ...r, f, qc };
}

beforeEach(() => {
  reiniciarContexto({ jaEntrou: true });
});

afterEach(() => {
  cleanup();
  reiniciarContexto();
  document.getElementById("janete-gatilho")?.remove();
});

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);

describe("os 3 estados", () => {
  it("carregando: o esqueleto, enquanto a versão atual não chega", () => {
    montar({ linhas: [linha(16)] });
    expect(screen.getByRole("status", { name: "Carregando o Contexto" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Contexto" })).toBeInTheDocument();
  });

  it("erro: 'Não deu para carregar o Contexto', com Tentar de novo que relê", async () => {
    const banco: Banco = { linhas: [linha(16)], erroAtual: { code: "42501", message: "permission denied" } };
    const { f } = montar(banco);
    await screen.findByText("Não deu para carregar o Contexto");
    expect(screen.getByText("Sua conta não tem acesso a isto.")).toBeInTheDocument();
    const antes = f.consultas.filter((c) => c.tabela === "contexto_versoes" && c.unica).length;
    banco.erroAtual = undefined;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    });
    await waitFor(() => expect($("#ctx-mapa")).not.toBeNull());
    expect(f.consultas.filter((c) => c.tabela === "contexto_versoes" && c.unica).length).toBeGreaterThan(antes);
  });

  it("a releitura que falha com a tela pronta não troca a tela: a TelaPronta fica montada e um aviso compacto oferece Tentar de novo", async () => {
    const banco: Banco = { linhas: [linha(16)] };
    const { qc } = montar(banco);
    await waitFor(() => expect($("#ctx-mapa")).not.toBeNull());
    const mapa = $("#ctx-mapa");
    banco.erroAtual = { code: "42501", message: "permission denied" };
    await act(async () => {
      await qc.invalidateQueries({ queryKey: CHAVES.contexto });
    });
    expect(await screen.findByText(AVISO_RELEITURA_CONTEXTO)).toBeInTheDocument();
    expect(screen.queryByText("Não deu para carregar o Contexto")).not.toBeInTheDocument();
    // o mesmo nó: a tela não desmontou (a seção aberta e o foco ficariam onde estavam)
    expect($("#ctx-mapa")).toBe(mapa);
    banco.erroAtual = undefined;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    });
    await waitFor(() => expect(screen.queryByText(AVISO_RELEITURA_CONTEXTO)).not.toBeInTheDocument());
    expect($("#ctx-mapa")).toBe(mapa);
  });

  it("vazio: 'Nenhuma versão ainda', e o 1º salvamento vai com p_base nulo e cria a versão 1", async () => {
    const banco: Banco = { linhas: [] };
    const { f } = montar(banco, {
      filho: "secao",
      rpc: (nome, args) => {
        if (nome !== "contexto_salvar") return undefined;
        banco.linhas.push(linha(11, { preco: (args["p_mudancas"] as { preco: string }).preco, empresa_oferta: "" }));
        return { data: { id: 11, numero: 1 }, error: null };
      },
    });
    // espera a leitura da atual (vazia) e do histórico voltarem
    await waitFor(() => expect(f.consultas.filter((c) => c.tabela === "contexto_versoes")).toHaveLength(2));
    await screen.findByText("A Janete ainda não sabe nada sobre Preço.");
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.change(screen.getByLabelText("O que a Janete sabe sobre Preço"), { target: { value: "R$ 5 o pão" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 1" }));
    });
    expect(f.rpcs).toEqual([{ nome: "contexto_salvar", args: { p_base: null, p_mudancas: { preco: "R$ 5 o pão" } } }]);
  });

  it("vazio na tela: o rodapé diz 'Nenhuma versão ainda' e o 1º salvamento cria a versão 1", async () => {
    montar({ linhas: [] });
    await waitFor(() => expect($("#ctx-mapa")).not.toBeNull());
    expect(document.body.textContent).toContain("Nenhuma versão ainda");
    expect(document.body.textContent).toContain("O 1º salvamento cria a versão 1.");
    expect(document.body.textContent).toContain("0 de 8 campos");
  });
});

describe("salvar (decisão 11b)", () => {
  it("manda p_base = id da versão aberta e só o campo mudado; depois relê a atual", async () => {
    const banco: Banco = { linhas: [linha(16), linha(15)] };
    const { f } = montar(banco, {
      filho: "secao",
      rpc: (nome, args) => {
        if (nome !== "contexto_salvar") return undefined;
        banco.linhas.push(linha(17, { preco: (args["p_mudancas"] as { preco: string }).preco }));
        return { data: { id: 17, numero: 7 }, error: null };
      },
    });
    await screen.findByText("Preço da versão 6");
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.change(screen.getByLabelText("O que a Janete sabe sobre Preço"), { target: { value: "Novo preço" } });
    const atuaisAntes = f.consultas.filter((c) => c.tabela === "contexto_versoes" && c.unica).length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 7" }));
    });
    expect(f.rpcs).toEqual([{ nome: "contexto_salvar", args: { p_base: 16, p_mudancas: { preco: "Novo preço" } } }]);
    expect(f.consultas.filter((c) => c.tabela === "contexto_versoes" && c.unica).length).toBeGreaterThan(atuaisAntes);
    await waitFor(() => expect(screen.getByText("A Janete sabe")).toBeInTheDocument());
    expect(screen.getByText("Novo preço")).toBeInTheDocument();
  });

  it("um item livre vai como a lista inteira de itens (a lista conta como um campo)", async () => {
    const { f } = montar(
      { linhas: [linha(16)] },
      {
        filho: "secao",
        secao: { grupo: "livres", alvo: "livre-1" },
        rpc: (nome) => (nome === "contexto_salvar" ? { data: { id: 17, numero: 7 }, error: null } : undefined),
      },
    );
    await screen.findByText("Pergunta livre 1", { selector: "#ctx-ed-tit" });
    fireEvent.change(screen.getByLabelText("Resposta"), { target: { value: "Não abrimos" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 7" }));
    });
    expect(f.rpcs).toEqual([
      { nome: "contexto_salvar", args: { p_base: 16, p_mudancas: { itens: [{ pergunta: "Abre domingo?", resposta: "Não abrimos" }] } } },
    ]);
  });

  it("com 'contexto_mudou', avisa e mostra o texto que o outro admin gravou", async () => {
    const banco: Banco = { linhas: [linha(16)] };
    montar(banco, {
      filho: "secao",
      rpc: (nome) => {
        if (nome !== "contexto_salvar") return undefined;
        // outro admin gravou o Preço enquanto este editava
        banco.linhas.push(linha(17, { preco: "Preço do outro admin" }));
        return { data: null, error: { code: "P0001", message: "contexto_mudou" } };
      },
    });
    await screen.findByText("Preço da versão 6");
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.change(screen.getByLabelText("O que a Janete sabe sobre Preço"), { target: { value: "O meu preço" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 7" }));
    });
    await screen.findByText(/O Contexto mudou enquanto você editava\./);
    expect($("[data-texto-novo]")!.textContent).toBe("Preço do outro admin");
    // o próximo salvar parte da versão nova
    expect((screen.getByLabelText("O que a Janete sabe sobre Preço") as HTMLTextAreaElement).value).toBe("O meu preço");
  });

  it("com 'limite_tamanho' do banco, o texto certo; com falha de rede, o da internet", async () => {
    let resposta: Resposta = { data: null, error: { code: "P0001", message: "limite_tamanho" } };
    montar({ linhas: [linha(16)] }, { filho: "secao", rpc: (nome) => (nome === "contexto_salvar" ? resposta : undefined) });
    await screen.findByText("Preço da versão 6");
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.change(screen.getByLabelText("O que a Janete sabe sobre Preço"), { target: { value: "curto" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 7" }));
    });
    expect(screen.getByText("Passou de 2.000 letras. Corte um pouco para salvar.")).toBeInTheDocument();
    resposta = { data: null, error: new TypeError("Failed to fetch") };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 7" }));
    });
    expect(screen.getByText("Não deu para salvar agora. Verifique a internet e tente de novo.")).toBeInTheDocument();
  });

  it("com 'limite_itens' do banco (mais de 50 perguntas livres), o código chega até a tela", async () => {
    const resposta: Resposta = { data: null, error: { code: "P0001", message: "limite_itens" } };
    montar({ linhas: [linha(16)] }, { filho: "secao", rpc: (nome) => (nome === "contexto_salvar" ? resposta : undefined) });
    await screen.findByText("Preço da versão 6");
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.change(screen.getByLabelText("O que a Janete sabe sobre Preço"), { target: { value: "curto" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 7" }));
    });
    expect(screen.getByText("O Contexto já tem 50 perguntas livres. Apague uma para criar outra.")).toBeInTheDocument();
  });

  it("salvar ou restaurar recusado com sem_acesso relê o Eu (spec 2.2)", async () => {
    const semAcesso: Resposta = { data: null, error: { code: "42501", message: "permission denied" } };
    const { qc } = montar({ linhas: [linha(16), linha(15)] }, { filho: "secao", rpc: (nome) => (nome.startsWith("contexto_") ? semAcesso : undefined) });
    const espia = vi.spyOn(qc, "invalidateQueries");
    await screen.findByText("Preço da versão 6");
    fireEvent.click(screen.getByRole("button", { name: "Editar texto" }));
    fireEvent.change(screen.getByLabelText("O que a Janete sabe sobre Preço"), { target: { value: "curto" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão 7" }));
    });
    expect(espia).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
  });

  it("restaurar recusado com sem_acesso também relê o Eu", async () => {
    const semAcesso: Resposta = { data: null, error: { code: "42501", message: "permission denied" } };
    const { qc } = montar({ linhas: [linha(16), linha(15), linha(14)] }, { filho: "historico", rpc: (nome) => (nome === "contexto_restaurar" ? semAcesso : undefined) });
    const espia = vi.spyOn(qc, "invalidateQueries");
    await screen.findByText("Versão 6");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar a versão 4" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restaurar versão 4" }));
    });
    expect(espia).toHaveBeenCalledWith({ queryKey: CHAVES.eu });
  });

  it("os erros do banco viram os da tela", () => {
    expect(erroDaTela("sem_acesso")).toBe("sem_permissao");
    expect(erroDaTela("nao_encontrado")).toBe("nao_encontrado");
    expect(erroDaTela("contexto_mudou")).toBe("contexto_mudou");
    expect(erroDaTela("limite_tamanho")).toBe("limite_tamanho");
    expect(erroDaTela("limite_itens")).toBe("limite_itens");
    expect(erroDaTela("falha")).toBe("falha");
  });
});

describe("o histórico", () => {
  it("mostra o número, a data, a origem e quem: Você, o nome, ou 'Alguém que saiu da equipe'", async () => {
    montar(
      {
        linhas: [
          linha(16, { origem: "restauracao", restaurada_de: 12, criado_por: ANA }),
          linha(15, { criado_por: null }),
          linha(14),
          linha(12, { numero: 2, origem: "onboarding" }),
        ],
      },
      { filho: "historico" },
    );
    await screen.findByText("Versão 6");
    const gaveta = $("#ctx-gaveta")!;
    const v6 = gaveta.querySelector<HTMLElement>('[data-versao="6"]')!;
    expect(v6.textContent).toContain("Restauração da versão 2 · Ana Lima");
    expect(v6.textContent).toContain("Em uso");
    expect(gaveta.querySelector('[data-versao="5"]')!.textContent).toContain("Edição · Alguém que saiu da equipe");
    expect(gaveta.querySelector('[data-versao="4"]')!.textContent).toContain("Edição · Você");
    expect(gaveta.querySelector('[data-versao="2"]')!.textContent).toContain("Onboarding · Você");
  });

  it("traz 30 de cada vez e 'Ver mais antigas' busca a página seguinte", async () => {
    const linhas = Array.from({ length: 45 }, (_, i) => linha(100 - i, { numero: 45 - i }));
    const { f } = montar({ linhas }, { filho: "historico" });
    await screen.findByText("Versão 45");
    const gaveta = $("#ctx-gaveta")!;
    expect(gaveta.querySelectorAll("li[data-versao]")).toHaveLength(TAMANHO_PAGINA_CONTEXTO);
    const primeira = f.consultas.find((c) => c.tabela === "contexto_versoes" && c.passos.some((p) => p[0] === "range"))!;
    expect(primeira.passos).toContainEqual(["order", "id", { ascending: false }]);
    expect(primeira.passos).toContainEqual(["range", 0, 30]);
    await act(async () => {
      fireEvent.click(within(gaveta).getByRole("button", { name: "Ver mais antigas" }));
    });
    await waitFor(() => expect(gaveta.querySelectorAll("li[data-versao]")).toHaveLength(45));
    expect(f.consultas.some((c) => c.passos.some((p) => p[0] === "range" && p[1] === 30 && p[2] === 60))).toBe(true);
    expect(within(gaveta).queryByRole("button", { name: "Ver mais antigas" })).toBeNull();
    // o select lista as colunas, nunca '*'
    expect(primeira.valor).not.toBe("*");
  });

  it("restaurar chama contexto_restaurar com o id da versão (não o número)", async () => {
    const banco: Banco = { linhas: [linha(16), linha(15), linha(14)] };
    const { f } = montar(banco, {
      filho: "historico",
      rpc: (nome) => {
        if (nome !== "contexto_restaurar") return undefined;
        banco.linhas.push(linha(17, { origem: "restauracao", restaurada_de: 14 }));
        return { data: { id: 17, numero: 7 }, error: null };
      },
    });
    await screen.findByText("Versão 6");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar a versão 4" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restaurar versão 4" }));
    });
    expect(f.rpcs).toEqual([{ nome: "contexto_restaurar", args: { p_versao: 14 } }]);
  });

  it("histórico vazio: 'Nenhuma versão ainda'", async () => {
    montar({ linhas: [] }, { filho: "historico" });
    await screen.findByText("Nenhuma versão ainda");
  });
});

describe("a área lê só pela camada de dados", () => {
  it("nenhum arquivo de contexto/ usa useExemplo nem o ProvedorExemplo", () => {
    const pasta = join(process.cwd(), "src/features/plataforma/contexto");
    const arquivos = readdirSync(pasta).filter((n) => statSync(join(pasta, n)).isFile() && /\.(ts|tsx)$/.test(n));
    expect(arquivos.length).toBeGreaterThan(5);
    for (const n of arquivos) {
      const texto = readFileSync(join(pasta, n), "utf8");
      expect(texto, n).not.toMatch(/useExemplo|ProvedorExemplo/);
    }
  });
});
