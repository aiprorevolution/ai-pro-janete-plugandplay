import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EtapaCerebro } from "@/features/onboarding/cerebro";
import { ESTADO_INICIAL, gravarEstadoOnboarding, limparEstadoOnboarding } from "@/features/onboarding/estado";
import { consumirDesdobra } from "@/features/onboarding/lista";
import { PalcoContexto } from "@/features/onboarding/palco";
import { CartaoCerebro } from "@/features/plataforma/configuracao/CartaoCerebro";
import { CartaoEscuta } from "@/features/plataforma/configuracao/CartaoEscuta";
import { AVISO_ANTHROPIC_SEM_ESCUTA, avisaSemEscuta, lerCerebro, lerEscuta, lerWhats } from "@/features/plataforma/configuracao/leitura";
import { provDe } from "@/features/plataforma/configuracao/dados";
import { SEM_TESTE, Saude, avisoContextoFraco, textosSaude } from "@/features/plataforma/configuracao/Saude";
import { avisoCamposFracos, camposFracos } from "@/features/plataforma/contexto/regras";
import { NADA_GRAVADO, ProvedorDadosOnboarding, criarDadosOnboardingMemoria, escutaGravada } from "@/features/plataforma/dados/onboarding";
import type { Leitura, VersaoContextoBanco } from "@/features/plataforma/dados/tipos";
import type { ChaveIA, ProvedorIA } from "@/features/plataforma/exemplo";

// B3 das lacunas da mensageria (decisões 1 e 7): o aviso do Contexto fraco na Saúde e o aviso do
// áudio sem escuta no cérebro (o cartão da Configuração e a etapa do onboarding).

/* ---------- a leitura do Contexto que a Saúde recebe (useDados().useContextoAtual()) ---------- */
let contextoAtual: Leitura<VersaoContextoBanco | null>;
vi.mock("@/features/plataforma/dados/ProvedorDados", async (original) => ({
  ...(await original<typeof import("@/features/plataforma/dados/ProvedorDados")>()),
  useDados: () => ({ useContextoAtual: () => contextoAtual }),
}));

/* ---------- o roteador do link "Completar o Contexto" (sem ele, o link navega pela página) ---------- */
let roteador: { navigate: ReturnType<typeof vi.fn> } | undefined;
vi.mock("@tanstack/react-router", async (original) => {
  const real = await original<typeof import("@tanstack/react-router")>();
  return { ...real, useRouter: (o?: Parameters<typeof real.useRouter>[0]) => roteador ?? real.useRouter(o) };
});

// a etapa do cérebro, como em c2-cerebro: sem rede, sem voo e sem a cena da fusão
vi.mock("@/features/servidor/listar-modelos.functions", () => ({ listarModelos: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getSession: vi.fn() } } }));
vi.mock("@/components/janete/VooJanete", async (original) => ({
  ...(await original<typeof import("@/components/janete/VooJanete")>()),
  useVooJanete: () => ({ ativo: false, pousar: vi.fn(), voar: vi.fn(() => Promise.resolve()), mudarEstado: vi.fn(), legenda: vi.fn(), soltar: vi.fn() }),
}));
vi.mock("@/features/onboarding/fusao", () => ({ FusaoJanete: () => <div data-testid="fusao" /> }));

const BOM = "Um texto com bem mais de vinte letras.";

/** Uma versão do Contexto com os 8 campos bons; `fracos` troca alguns. */
function versao(fracos: Partial<VersaoContextoBanco> = {}): VersaoContextoBanco {
  return {
    id: 7,
    empresa_oferta: BOM,
    cliente_ideal: BOM,
    preco: BOM,
    diferenciais: BOM,
    objecoes: BOM,
    quando_passar_humano: BOM,
    tom_voz: BOM,
    horario: BOM,
    itens: [],
    origem: "edicao",
    criado_por: null,
    criado_em: "2026-11-02T12:00:00-03:00",
    numero: 3,
    restaurada_de: null,
    ...fracos,
  } as VersaoContextoBanco;
}

const leitura = (l: Partial<Leitura<VersaoContextoBanco | null>>): Leitura<VersaoContextoBanco | null> => ({
  dados: undefined,
  carregando: false,
  erro: null,
  tentarDeNovo: () => {},
  ...l,
});

function chave(finalidade: ChaveIA["finalidade"], provedor: ProvedorIA, status: ChaveIA["status"] = "ativa"): ChaveIA {
  return {
    id: `k-${finalidade}`,
    finalidade,
    provedor,
    modelo: finalidade === "resposta" ? "claude-haiku-5-5" : null,
    status,
    ultimos4: "TSTE",
    ultimo_erro: null,
    validada_em: "2026-11-02T11:00:00-03:00",
    atualizada_em: "2026-11-02T11:00:00-03:00",
    atualizada_por: null,
  } as ChaveIA;
}

function montarSaude(admin = true, chaves: ChaveIA[] = [chave("resposta", "anthropic")]) {
  render(
    <Saude
      oculto={false}
      admin={admin}
      w={lerWhats(null)}
      cer={lerCerebro({ chaves }, admin)}
      esc={lerEscuta({ chaves }, admin)}
      espera={8}
      teto={60}
      teste={SEM_TESTE}
      hero={null}
      conserto={null}
      testeBloqueado={false}
      aoTestarTudo={() => {}}
      aoIr={() => {}}
    />,
  );
}

const avisoFraco = () => screen.queryByTestId("cfg-contexto-fraco");

describe("Saúde: o aviso do Contexto fraco (decisão 7)", () => {
  it("aparece com os rótulos dos campos fracos, na ordem da tela, unidos por vírgula", () => {
    // o banco guarda na ordem das colunas; a tela mostra Preço antes de Diferenciais
    contextoAtual = leitura({ dados: versao({ diferenciais: "curto", preco: "" }) });
    montarSaude();
    expect(avisoFraco()).toHaveTextContent("A Janete sabe pouco sobre: Preço, Diferenciais.");
    // o link leva ao Contexto
    expect(within(avisoFraco()!).getByRole("link", { name: "Completar o Contexto" })).toHaveAttribute("href", "/app/contexto");
  });

  it("é discreto: o tom é o de informação e a cor da Saúde não muda", () => {
    contextoAtual = leitura({ dados: versao() });
    montarSaude();
    const nos = () => Array.from(document.querySelectorAll("[data-peca]")).map((b) => b.getAttribute("data-tom"));
    const antes = nos();
    const titulo = screen.getByRole("heading", { level: 2 }).textContent;
    cleanup();
    contextoAtual = leitura({ dados: versao({ tom_voz: "  " }) });
    montarSaude();
    expect(avisoFraco()).toHaveAttribute("data-tom", "info");
    expect(avisoFraco()).toHaveTextContent("A Janete sabe pouco sobre: Tom de voz.");
    expect(nos()).toEqual(antes);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(titulo!);
  });

  it("Horário, Preço e Tom de voz curtos não são fracos; vazios, sim (decisão 12)", () => {
    contextoAtual = leitura({ dados: versao({ horario: "24h", preco: "R$ 97", tom_voz: "Informal" }) });
    montarSaude();
    expect(avisoFraco()).not.toBeInTheDocument();
    cleanup();
    contextoAtual = leitura({ dados: versao({ horario: "", preco: "R$ 97", tom_voz: " ", objecoes: "R$ 97" }) });
    montarSaude();
    expect(avisoFraco()).toHaveTextContent("A Janete sabe pouco sobre: Tom de voz, Objeções, Horário.");
  });

  it("sem versão do Contexto, os 8 contam como fracos", () => {
    contextoAtual = leitura({ dados: null });
    montarSaude();
    expect(avisoFraco()).toHaveTextContent(
      "A Janete sabe pouco sobre: Empresa e oferta, Cliente ideal, Preço, Diferenciais, Tom de voz, Passar para humano, Objeções, Horário.",
    );
  });

  it("some com todos os campos bons", () => {
    contextoAtual = leitura({ dados: versao() });
    montarSaude();
    expect(avisoFraco()).not.toBeInTheDocument();
    expect(screen.queryByText(/A Janete sabe pouco sobre/)).not.toBeInTheDocument();
  });

  it("não aparece carregando", () => {
    contextoAtual = leitura({ carregando: true });
    montarSaude();
    expect(avisoFraco()).not.toBeInTheDocument();
  });

  it("não aparece com erro de leitura, nem com um dado antigo na memória", () => {
    contextoAtual = leitura({ erro: "falha" });
    montarSaude();
    expect(avisoFraco()).not.toBeInTheDocument();
    cleanup();
    contextoAtual = leitura({ dados: versao({ preco: "" }), erro: "falha" });
    montarSaude();
    expect(avisoFraco()).not.toBeInTheDocument();
  });

  it("o texto é o mesmo do cabeçalho do Contexto (avisoCamposFracos), com o ponto final", () => {
    for (const v of [versao({ preco: "" }), versao({ diferenciais: "curto", tom_voz: "" }), null]) {
      expect(avisoContextoFraco({ dados: v, erro: null })).toBe(`${avisoCamposFracos(camposFracos(v))}.`);
    }
    expect(avisoContextoFraco({ dados: versao(), erro: null })).toBeNull();
  });

  it("o link: o clique simples vai pelo roteador; com Ctrl, Cmd, Shift, Alt ou o botão do meio, o navegador decide", () => {
    roteador = { navigate: vi.fn(() => Promise.resolve()) };
    // o último a ouvir (depois do React) anota se o link cancelou o clique e cancela, porque o jsdom não navega
    const cancelados: boolean[] = [];
    const anotar = (ev: MouseEvent) => {
      cancelados.push(ev.defaultPrevented);
      ev.preventDefault();
    };
    window.addEventListener("click", anotar);
    try {
      contextoAtual = leitura({ dados: versao({ preco: "" }) });
      montarSaude();
      const link = within(avisoFraco()!).getByRole("link", { name: "Completar o Contexto" });
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) fireEvent.click(link, mod);
      expect(cancelados).toEqual([false, false, false, false, false]);
      expect(roteador.navigate).not.toHaveBeenCalled();
      fireEvent.click(link);
      expect(cancelados.at(-1)).toBe(true);
      expect(roteador.navigate).toHaveBeenCalledWith({ to: "/app/contexto" });
    } finally {
      window.removeEventListener("click", anotar);
      roteador = undefined;
    }
  });

  it("para a atendente: sem o link, com o aviso de chamar quem administra", () => {
    contextoAtual = leitura({ dados: versao({ preco: "" }) });
    montarSaude(false);
    expect(avisoFraco()).toHaveTextContent("A Janete sabe pouco sobre: Preço. Avise quem administra a conta: só essa pessoa muda o Contexto.");
    expect(within(avisoFraco()!).queryByRole("link")).not.toBeInTheDocument();
  });
});

/* ---------- o cartão do cérebro na Configuração ---------- */

function montarCartao(chaves: ChaveIA[]) {
  render(
    <CartaoCerebro
      admin
      cer={lerCerebro({ chaves }, true)}
      esc={lerEscuta({ chaves }, true)}
      agora={new Date("2026-11-02T12:00:00-03:00")}
      testando={false}
      bloqueado={false}
      erroTeste={null}
      realce={null}
      oculto={false}
      simular={false}
      aoSimular={() => {}}
      aoTestarChave={() => {}}
      aoTrocarChave={() => {}}
      aoTrocarModelo={() => {}}
      aoTrocarMotor={() => {}}
    />,
  );
}

const avisoAudio = () => screen.queryByText(AVISO_ANTHROPIC_SEM_ESCUTA);

describe("CartaoCerebro: o aviso do áudio sem escuta (decisão 1)", () => {
  it("o texto é o da decisão", () => {
    expect(AVISO_ANTHROPIC_SEM_ESCUTA).toBe(
      "Com a Anthropic, a Janete não entende áudio. Adicione uma chave de Escuta (OpenAI, Groq ou ElevenLabs) ou a da voz (ElevenLabs).",
    );
  });

  it("Anthropic sem escuta nenhuma: aparece", () => {
    montarCartao([chave("resposta", "anthropic")]);
    expect(avisoAudio()).toBeInTheDocument();
  });

  it("Anthropic com chave de escuta (Groq): não aparece", () => {
    montarCartao([chave("resposta", "anthropic"), chave("transcricao", "groq")]);
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("Anthropic com a chave da voz (ElevenLabs), que transcreve: não aparece", () => {
    montarCartao([chave("resposta", "anthropic"), chave("voz", "elevenlabs")]);
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("via cérebro (OpenAI, que transcreve com a mesma chave): não aparece", () => {
    montarCartao([chave("resposta", "openai")]);
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("OpenRouter, mesmo sem chave ativa para transcrever: não aparece (o aviso é só da Anthropic)", () => {
    montarCartao([chave("resposta", "openrouter", "sem_credito")]);
    expect(avisoAudio()).not.toBeInTheDocument();
    cleanup();
    montarCartao([chave("resposta", "openrouter")]);
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("OpenAI sem crédito (sem via cérebro) e sem escuta: não aparece", () => {
    montarCartao([chave("resposta", "openai", "sem_credito")]);
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("Anthropic, Groq recusada e sem voz: aparece (o servidor pula a chave inválida)", () => {
    montarCartao([chave("resposta", "anthropic"), chave("transcricao", "groq", "invalida")]);
    expect(avisoAudio()).toBeInTheDocument();
  });

  it("Anthropic e Groq sem crédito: não aparece (a chave está em uso; o cartão Escuta diz o crédito)", () => {
    montarCartao([chave("resposta", "anthropic"), chave("transcricao", "groq", "sem_credito")]);
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("Anthropic, Groq recusada e a voz ativa: não aparece, a voz transcreve", () => {
    montarCartao([chave("resposta", "anthropic"), chave("transcricao", "groq", "invalida"), chave("voz", "elevenlabs")]);
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("sem chave de IA (removida): não aparece, o cartão já diz que a Janete não responde", () => {
    montarCartao([chave("resposta", "anthropic", "removida")]);
    expect(screen.getByText("A Janete está sem chave de IA")).toBeInTheDocument();
    expect(avisoAudio()).not.toBeInTheDocument();
  });
});

/* ---------- a leitura da Escuta na ordem do servidor (I-6 da revisão) ---------- */

describe("lerEscuta: a ordem do servidor (transcrever.server.ts)", () => {
  it("a chave só de áudio inválida é pulada: a voz em uso transcreve", () => {
    const chaves = [chave("resposta", "anthropic"), chave("transcricao", "groq", "invalida"), chave("voz", "elevenlabs")];
    const esc = lerEscuta({ chaves }, true);
    expect(esc).toMatchObject({ viaCerebro: false, viaVoz: true, ok: true });
    expect(esc.chave?.status).toBe("invalida");
    expect(avisaSemEscuta(lerCerebro({ chaves }, true), esc)).toBe(false);
  });

  it("a chave só de áudio inválida é pulada: o cérebro da OpenAI transcreve, antes da voz", () => {
    const chaves = [chave("resposta", "openai"), chave("transcricao", "groq", "invalida"), chave("voz", "elevenlabs")];
    expect(lerEscuta({ chaves }, true)).toMatchObject({ viaCerebro: true, nomeViaCerebro: "OpenAI", viaVoz: false, ok: true });
  });

  it("inválida e sem mais nada: não transcreve", () => {
    const chaves = [chave("resposta", "anthropic"), chave("transcricao", "groq", "invalida")];
    expect(lerEscuta({ chaves }, true)).toMatchObject({ viaCerebro: false, viaVoz: false, ok: false });
  });

  it("a chave só de áudio em uso vem primeiro, até sem crédito (o servidor a usa e não passa para a voz)", () => {
    const chaves = [chave("resposta", "openai"), chave("transcricao", "groq", "sem_credito"), chave("voz", "elevenlabs")];
    expect(lerEscuta({ chaves }, true)).toMatchObject({ viaCerebro: false, viaVoz: false, ok: false });
  });

  it("Saúde: Groq recusada e a voz ativa diz 'Ativa · chave da voz', e não que a Janete pede texto", () => {
    contextoAtual = leitura({ dados: versao() });
    montarSaude(true, [chave("resposta", "anthropic"), chave("transcricao", "groq", "invalida"), chave("voz", "elevenlabs")]);
    const escuta = document.querySelector("[data-peca='escuta']")!;
    expect(escuta).toHaveAttribute("aria-label", "Escuta, Áudios em texto: Ativa · chave da voz (ElevenLabs). Ver os detalhes.");
  });

  it("Cartão Escuta: a Groq recusada aparece como recusada, e diz quem transcreve no lugar", () => {
    const chaves = [chave("resposta", "anthropic"), chave("transcricao", "groq", "invalida"), chave("voz", "elevenlabs")];
    render(
      <CartaoEscuta admin esc={lerEscuta({ chaves }, true)} agora={new Date("2026-11-02T12:00:00-03:00")} bloqueado={false} realce={null} oculto={false} aoConectar={() => {}} />,
    );
    const cartao = document.getElementById("cfg-card-escuta")!;
    expect(within(cartao).getByRole("heading", { level: 2 })).not.toHaveTextContent(/^Ativa/);
    expect(cartao).toHaveTextContent("Chave inválida · transcreve com a chave da voz");
    cleanup();
    render(
      <CartaoEscuta
        admin
        esc={lerEscuta({ chaves: chaves.slice(0, 2) }, true)}
        agora={new Date("2026-11-02T12:00:00-03:00")}
        bloqueado={false}
        realce={null}
        oculto={false}
        aoConectar={() => {}}
      />,
    );
    expect(document.getElementById("cfg-card-escuta")!).toHaveTextContent("Chave inválida · a Janete pede texto");
  });
});

describe("Configuração sem escuta: os textos dizem o que a Janete faz (decisão 1; T1 da revisão)", () => {
  it("o cartão Escuta vazio: a Janete pede texto, e o áudio de novo vai para a equipe", () => {
    render(
      <CartaoEscuta
        admin
        esc={lerEscuta({ chaves: [chave("resposta", "anthropic")] }, true)}
        agora={new Date("2026-11-02T12:00:00-03:00")}
        bloqueado={false}
        realce={null}
        oculto={false}
        aoConectar={() => {}}
      />,
    );
    const cartao = document.getElementById("cfg-card-escuta")!;
    expect(cartao).toHaveTextContent("Sem escuta · a Janete pede texto");
    expect(cartao).toHaveTextContent(
      "Quando um lead manda só áudio, a Janete não entende e pede para ele escrever. Se ele mandar áudio de novo, a conversa vai para a equipe.",
    );
    // a ElevenLabs também entra no cartão Escuta (spec da escuta com a ElevenLabs, T7): uma frase só
    expect(cartao).toHaveTextContent(
      "vai para a equipe. Com uma chave da OpenAI, da Groq ou da ElevenLabs, ela ouve e responde sozinha.",
    );
    expect(cartao.textContent).not.toMatch(/Áudios vão para a equipe/);
  });

  function montarEscutaVazia(chaves: ChaveIA[]) {
    const esc = lerEscuta({ chaves }, true);
    render(
      <CartaoEscuta
        admin
        esc={esc}
        agora={new Date("2026-11-02T12:00:00-03:00")}
        bloqueado={false}
        realce={null}
        oculto={false}
        aoConectar={() => {}}
      />,
    );
    return { esc, cartao: document.getElementById("cfg-card-escuta")! };
  }

  const FRASE_VAZIA = "vai para a equipe. Com uma chave da OpenAI, da Groq ou da ElevenLabs, ela ouve e responde sozinha.";

  it("a chave da voz inválida: o cartão vazio mostra a frase única", () => {
    const { esc, cartao } = montarEscutaVazia([chave("resposta", "anthropic"), chave("voz", "elevenlabs", "invalida")]);
    expect(esc).toMatchObject({ viaVoz: false, cerebroTranscreve: false });
    expect(screen.getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
    expect(cartao).toHaveTextContent(FRASE_VAZIA);
    expect(cartao.textContent).not.toMatch(/no cartão Voz da Janete/);
  });

  it.each(["openai", "openrouter"] as const)(
    "o cérebro da %s sem crédito: o cartão vazio mostra a mesma frase única (sem variante pelo cérebro)",
    (provedor) => {
      const { esc, cartao } = montarEscutaVazia([chave("resposta", provedor, "sem_credito"), chave("voz", "elevenlabs")]);
      expect(esc).toMatchObject({ viaCerebro: false, viaVoz: false, cerebroTranscreve: true });
      expect(screen.getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
      expect(cartao).toHaveTextContent(FRASE_VAZIA);
      expect(cartao.textContent).not.toMatch(/no cartão Voz da Janete/);
    },
  );

  it("a Saúde: o detalhe da escuta não diz mais que o áudio vai direto para a equipe (a frase, em t3)", () => {
    contextoAtual = leitura({ dados: versao() });
    montarSaude();
    const saude = screen.getByTestId("cfg-saude");
    expect(document.querySelector("[data-peca='escuta']")).toHaveAttribute(
      "aria-label",
      "Escuta, Áudios em texto: Não configurada · a Janete pede texto. Ver os detalhes.",
    );
    expect(saude.textContent).not.toMatch(/vão para a equipe/);
    // atendendo, sem escuta: a frase do topo
    const chaves = [chave("resposta", "anthropic")];
    const w = { ...lerWhats(null), prov: provDe("zapi"), situacao: "conectada" as const, ok: true };
    const { sub } = textosSaude({ w, cer: lerCerebro({ chaves }, true), esc: lerEscuta({ chaves }, true), teste: SEM_TESTE });
    expect(sub).toContain("Os áudios ainda não viram texto: a Janete pede para o lead escrever.");
  });
});

/* ---------- a etapa do cérebro no onboarding ---------- */

function montarEtapa(escuta = false) {
  const dados = criarDadosOnboardingMemoria({ gravado: { ...NADA_GRAVADO, escuta } });
  const anunciar = vi.fn();
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <ProvedorDadosOnboarding dados={dados}>
      <PalcoContexto.Provider value={{ janeteNoPalco: vi.fn(), anunciar, recolherBarra: vi.fn() }}>{children}</PalcoContexto.Provider>
    </ProvedorDadosOnboarding>
  );
  render(<EtapaCerebro avancar={vi.fn()} voltar={vi.fn()} />, { wrapper: envoltorio });
  return { anunciar };
}

function abrirMotor(nome: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${nome}`) }));
}

describe("EtapaCerebro: o aviso do áudio sem escuta (decisão 1)", () => {
  beforeEach(() => {
    limparEstadoOnboarding();
    consumirDesdobra();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("Anthropic: aparece no painel do motor", () => {
    montarEtapa();
    expect(avisoAudio()).not.toBeInTheDocument();
    abrirMotor("Anthropic");
    expect(within(screen.getByRole("group", { name: "Anthropic" })).getByText(AVISO_ANTHROPIC_SEM_ESCUTA)).toBeInTheDocument();
  });

  it("OpenAI: não aparece", () => {
    montarEtapa();
    abrirMotor("OpenAI");
    expect(screen.getByRole("group", { name: "OpenAI" })).toBeInTheDocument();
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("OpenRouter: não aparece", () => {
    montarEtapa();
    abrirMotor("OpenRouter");
    expect(screen.getByRole("group", { name: "OpenRouter" })).toBeInTheDocument();
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("com a voz já configurada (quem volta ao passo): não aparece", () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro", voz: { ultimos4: "VOZ1", pulou: false } });
    montarEtapa();
    abrirMotor("Anthropic");
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("voltou já validada na Anthropic: aparece no resultado; com a voz, não", () => {
    const cerebro = { provedor: "anthropic" as const, modelo: "claude-haiku-5-5", ultimos4: "wxyz" };
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro", cerebro });
    montarEtapa();
    expect(screen.getByText("A Janete já tem cérebro.")).toBeInTheDocument();
    // no bloco do resultado (o "Próximo" e o "Trocar chave" ficam nele)
    const resultado = screen.getByText("A Janete já tem cérebro.").parentElement!;
    expect(within(resultado).getByText(AVISO_ANTHROPIC_SEM_ESCUTA)).toBeInTheDocument();
    cleanup();
    window.sessionStorage.clear();
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro", cerebro, voz: { ultimos4: "VOZ1", pulou: false } });
    montarEtapa();
    expect(screen.getByText("A Janete já tem cérebro.")).toBeInTheDocument();
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("com uma chave de Escuta ou de voz já gravada no banco (I-5 da revisão): não aparece", () => {
    montarEtapa(true);
    abrirMotor("Anthropic");
    expect(screen.getByRole("group", { name: "Anthropic" })).toBeInTheDocument();
    expect(avisoAudio()).not.toBeInTheDocument();
  });

  it("escutaGravada: a chave só de áudio ou a da voz em uso; inválida, removida ou só o cérebro, não", () => {
    expect(NADA_GRAVADO.escuta).toBe(false);
    expect(escutaGravada([chave("transcricao", "groq")])).toBe(true);
    expect(escutaGravada([chave("transcricao", "openai", "sem_credito")])).toBe(true);
    expect(escutaGravada([chave("voz", "elevenlabs")])).toBe(true);
    expect(escutaGravada([chave("voz", "elevenlabs", "sem_credito")])).toBe(true);
    expect(escutaGravada([chave("transcricao", "groq", "invalida"), chave("voz", "elevenlabs", "removida")])).toBe(false);
    expect(escutaGravada([chave("resposta", "openai")])).toBe(false);
    expect(escutaGravada(null)).toBe(false);
  });

  it("voltou já validada na Anthropic: o anúncio da chave aceita leva o aviso (I-11 da revisão)", () => {
    const cerebro = { provedor: "anthropic" as const, modelo: "claude-haiku-5-5", ultimos4: "wxyz" };
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro", cerebro });
    const { anunciar } = montarEtapa();
    expect(anunciar).toHaveBeenCalledWith(expect.stringMatching(/^Chave aceita\. .*Com a Anthropic, a Janete não entende áudio\./));
    expect(anunciar.mock.calls.at(-1)![0]).toContain(AVISO_ANTHROPIC_SEM_ESCUTA);
    cleanup();
    window.sessionStorage.clear();
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro", cerebro });
    const outro = montarEtapa(true);
    expect(outro.anunciar).toHaveBeenCalledWith(expect.stringMatching(/^Chave aceita\./));
    for (const [texto] of outro.anunciar.mock.calls) expect(texto).not.toContain(AVISO_ANTHROPIC_SEM_ESCUTA);
  });

  it("voltou já validada na OpenAI: não aparece", () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, etapa: "cerebro", cerebro: { provedor: "openai", modelo: "gpt-6-luna", ultimos4: "wxyz" } });
    montarEtapa();
    expect(screen.getByText("A Janete já tem cérebro.")).toBeInTheDocument();
    expect(avisoAudio()).not.toBeInTheDocument();
  });
});
