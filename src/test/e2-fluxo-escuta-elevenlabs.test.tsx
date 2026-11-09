import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaConfiguracao } from "@/features/plataforma/configuracao";
import { AJUDA_CHAVE_ESCUTA_ELEVENLABS } from "@/features/plataforma/configuracao/dados";
import { textoFalhaAcao } from "@/features/plataforma/configuracao/textos";
import { ServidorConfiguracaoContexto, type ServidorConfiguracao } from "@/features/plataforma/dados/configuracao";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta } from "@/features/plataforma/dados/testes/clienteFalso";
import { criarEstadoInicial, type ChaveIA, type EstadoBase } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// E2: os fluxos da Configuração com a chave da ElevenLabs (docs/spec-escuta-elevenlabs.md, T6): a
// ElevenLabs na lista da escuta, a pergunta "usar também no outro cartão?" no "Chave aceita", o
// "Sim" (a cópia no servidor, depois a lista de vozes), o "Não", o "Escolher depois" e as 7
// mensagens de fim. No modo exemplo (a memória) e no modo banco (cliente e servidor falsos: nada vai
// à rede nem ao banco). A chave dos testes é inventada.

vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return { ...real, movimentoReduzido: () => true, rolarAteEMedir: () => Promise.resolve(null) };
});

const AGORA = new Date("2026-11-03T15:00:00-03:00");
const CHAVE = "sk_teste_1234567890abcd";

const cartao = (peca: "whats" | "cerebro" | "escuta" | "voz" | "ritmo") => document.getElementById(`cfg-card-${peca}`)!;
const fluxo = () => document.getElementById("cfg-fluxo");
const botao = (nome: string | RegExp, dentro: HTMLElement = document.body) => within(dentro).getByRole("button", { name: nome });
const anuncio = (f: HTMLElement) => within(f).getByRole("status", { hidden: true }).textContent ?? "";

async function andar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Anda em passos curtos: dentro de um act só, o React desenha no fim, e o foco marcado para 80 ms
 * depois do "Chave aceita" acharia o palco ainda sem o botão.
 */
async function andarAosPoucos(ms: number) {
  for (let t = 0; t < ms; t += 20) await andar(20);
}

/** Uma linha de ia_chaves da ElevenLabs (escuta ou voz), ativa. */
function chaveEleven(finalidade: "transcricao" | "voz", ultimos4: string, extra: Partial<ChaveIA> = {}): ChaveIA {
  return {
    id: `ch-${finalidade}`,
    finalidade,
    provedor: "elevenlabs",
    modelo: finalidade === "transcricao" ? "scribe_v2" : "",
    status: "ativa",
    ultimos4,
    ultimo_erro: null,
    validada_em: AGORA.toISOString(),
    atualizada_em: AGORA.toISOString(),
    atualizada_por: null,
    ...extra,
  } as ChaveIA;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ---------- o modo exemplo ---------- */

/** A voz A escolhida (o voz_id da configuracao), uma das vozes da conta do exemplo. */
const VOZ_A = { voz_id: "exemplo-voz-a", voz_nome: "Voz de exemplo A" };

function montarExemplo(chaves: ChaveIA[] = [], configuracao: Partial<EstadoBase["configuracao"]> = {}) {
  const base = criarEstadoInicial(AGORA);
  const inicial: EstadoBase = {
    ...base,
    chaves: [...base.chaves, ...chaves],
    configuracao: { ...base.configuracao, ...configuracao },
  };
  return render(
    <ProvedorPapel inicial="admin">
      <ProvedorDados exemplo={inicial} progredirEnvios={false} relogio={() => new Date(AGORA)}>
        <TelaConfiguracao />
      </ProvedorDados>
    </ProvedorPapel>,
  );
}

/** Abre a escuta, escolhe a ElevenLabs, cola a chave e valida até o "Chave aceita". */
async function validarEscuta(): Promise<HTMLElement> {
  fireEvent.click(document.getElementById("cfg-conectar-escuta")!);
  const f = fluxo()!;
  // o foco da abertura (no título) chega antes da validação, como com uma pessoa
  await andar(200);
  fireEvent.click(within(f).getByRole("button", { name: /^ElevenLabs/ }));
  await andar(200);
  fireEvent.change(within(f).getByLabelText("Chave da ElevenLabs"), { target: { value: CHAVE } });
  fireEvent.click(botao("Validar a chave", f));
  await andarAosPoucos(1500);
  return f;
}

/** Abre a voz (conectar ou trocar), cola a chave e valida até o "Chave aceita". */
async function validarVoz(): Promise<HTMLElement> {
  const v = cartao("voz");
  const abrir = within(v).queryByRole("button", { name: "Conectar a ElevenLabs" }) ?? botao("Trocar a chave de voz", v);
  fireEvent.click(abrir);
  const f = fluxo()!;
  await andar(200);
  fireEvent.change(within(f).getByLabelText("Chave da ElevenLabs"), { target: { value: CHAVE } });
  fireEvent.click(botao("Validar a chave", f));
  await andarAosPoucos(1500);
  return f;
}

/** A lista de vozes (exemplo): marca a voz B e salva. */
async function salvarVozB(f: HTMLElement) {
  await andar(50);
  fireEvent.click(within(f).getByRole("radio", { name: /Voz de exemplo B/ }));
  fireEvent.click(botao("Salvar a voz", f));
  await andar(200);
}

describe("a escuta com a ElevenLabs (modo exemplo)", () => {
  it("a lista mostra os 3 provedores; a ElevenLabs usa a ajuda e os passos da voz", async () => {
    montarExemplo();
    fireEvent.click(document.getElementById("cfg-conectar-escuta")!);
    const f = fluxo()!;
    const nomes = within(f)
      .getAllByRole("button")
      .map((b) => b.id)
      .filter((id) => id.startsWith("cfg-it-"));
    expect(nomes).toEqual(["cfg-it-openai", "cfg-it-groq", "cfg-it-elevenlabs"]);
    expect(within(f).getByText("Transcreve com o Scribe. A mesma chave também pode dar a voz da Janete.")).toBeInTheDocument();
    fireEvent.click(within(f).getByRole("button", { name: /^ElevenLabs/ }));
    expect(within(f).getByText(AJUDA_CHAVE_ESCUTA_ELEVENLABS)).toBeInTheDocument();
    fireEvent.change(within(f).getByLabelText("Chave da ElevenLabs"), { target: { value: CHAVE } });
    fireEvent.click(botao("Validar a chave", f));
    await andar(100);
    // os passos da voz (a ElevenLabs), não o "Conferindo se a chave transcreve áudio"
    expect(f.textContent).toContain("Falando com a ElevenLabs");
    expect(f.textContent).not.toContain("Conferindo se a chave transcreve áudio");
    await andar(1500);
    expect(within(f).getByRole("heading", { name: "A Janete já entende áudios." })).toBeInTheDocument();
  });

  it("sem voz: a pergunta com o texto exato, o anúncio, o foco no 'Sim'; o 'Não' conclui", async () => {
    montarExemplo();
    const f = await validarEscuta();
    expect(within(f).getByText("Usar esta chave também na voz?")).toBeInTheDocument();
    expect(within(f).getByText("Com a mesma chave, a Janete também responde por áudio. Em seguida, você escolhe a voz.")).toBeInTheDocument();
    const sim = document.getElementById("val-pri")!;
    const nao = document.getElementById("val-sec")!;
    expect(sim).toHaveTextContent("Sim, usar na voz também");
    expect(nao).toHaveTextContent("Não, só na escuta");
    expect(anuncio(f)).toBe("A Janete já entende áudios. chave terminada em ABCD Usar esta chave também na voz?");
    await andar(300);
    expect(document.activeElement).toBe(sim);
    // a chave saiu do campo e não está em lugar nenhum da página
    expect(document.body.innerHTML).not.toContain(CHAVE);
    expect((document.getElementById("cfg-f-chave") as HTMLInputElement | null)?.value ?? "").toBe("");

    fireEvent.click(nao);
    await andar(300);
    expect(fluxo()).toBeNull();
    expect(screen.getAllByText("Escuta ligada. A Janete já entende os áudios.").length).toBeGreaterThan(0);
    // o "Não" não mexe na voz
    expect(within(cartao("voz")).getByRole("heading", { name: "Não configurada" })).toBeInTheDocument();
  });

  it("'Sim' e 'Salvar a voz': a lista aparece no próprio fluxo, sem Voltar; a voz fica com a mesma chave", async () => {
    montarExemplo();
    const f = await validarEscuta();
    fireEvent.click(botao("Sim, usar na voz também", f));
    await andar(900);
    expect(fluxo()).toBe(f);
    expect(f).toHaveAttribute("data-fluxo", "escuta");
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
    expect(within(f).getByText("Ouça e escolha a voz que a Janete usa nos áudios.")).toBeInTheDocument();
    expect(within(f).queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();
    expect(within(f).getByRole("radiogroup", { name: "Vozes da conta da ElevenLabs" })).toBeInTheDocument();
    const depois = document.getElementById("cfg-vozes-depois")!;
    expect(depois).toHaveTextContent("Escolher depois");
    expect(depois).toHaveAttribute("data-variante", "contorno");
    await salvarVozB(f);
    expect(fluxo()).toBeNull();
    expect(screen.getAllByText("Escuta ligada e voz salva. As duas usam a mesma chave.").length).toBeGreaterThan(0);
    const v = cartao("voz");
    expect(within(v).getByText("Voz de exemplo B")).toBeInTheDocument();
    expect(v.textContent).toContain("terminada em ABCD");
  });

  it("'Sim' e 'Escolher depois': fecha com a voz conectada e sem voz escolhida", async () => {
    montarExemplo();
    const f = await validarEscuta();
    fireEvent.click(botao("Sim, usar na voz também", f));
    await andar(900);
    fireEvent.click(document.getElementById("cfg-vozes-depois")!);
    await andar(300);
    expect(fluxo()).toBeNull();
    expect(
      screen.getAllByText("Escuta ligada, e a voz usa a mesma chave. Escolha a voz no cartão Voz da Janete.").length,
    ).toBeGreaterThan(0);
    const v = cartao("voz");
    expect(v.textContent).toContain("terminada em ABCD");
    expect(within(v).getByText("Nenhuma escolhida")).toBeInTheDocument();
  });

  it("'Sim' e 'Escolher depois' com a voz de antes ainda na conta: a mensagem diz que ela continua", async () => {
    montarExemplo([chaveEleven("voz", "VOZ1")], VOZ_A);
    const f = await validarEscuta();
    fireEvent.click(botao("Sim, usar na voz também", f));
    await andar(900);
    fireEvent.click(document.getElementById("cfg-vozes-depois")!);
    await andar(300);
    expect(fluxo()).toBeNull();
    expect(
      screen.getAllByText("Escuta ligada, e a voz usa a mesma chave. A Janete continua com a voz Voz de exemplo A.").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Escolha a voz no cartão Voz da Janete/)).not.toBeInTheDocument();
  });

  it("a voz já usa a mesma chave (P6): sem pergunta, a linha nova e o fim de sempre", async () => {
    montarExemplo([chaveEleven("voz", "ABCD")]);
    const f = await validarEscuta();
    expect(within(f).queryByText("Usar esta chave também na voz?")).not.toBeInTheDocument();
    expect(within(f).getByText("A Voz da Janete já usa esta chave.")).toBeInTheDocument();
    expect(document.getElementById("val-sec")).toBeNull();
    expect(anuncio(f)).toBe("A Janete já entende áudios. chave terminada em ABCD");
    fireEvent.click(botao("Voltar para a Configuração", f));
    await andar(300);
    expect(screen.getAllByText("Escuta ligada. A Janete já entende os áudios.").length).toBeGreaterThan(0);
  });

  it("a voz com outra chave: o detalhe diz qual chave a voz usa hoje", async () => {
    montarExemplo([chaveEleven("voz", "VOZ1")]);
    const f = await validarEscuta();
    expect(
      within(f).getByText("A voz hoje usa a chave terminada em VOZ1. No Sim, ela passa a usar esta, e você confere a voz em seguida."),
    ).toBeInTheDocument();
  });
});

describe("a voz com a pergunta da escuta (modo exemplo)", () => {
  it("'Sim' e 'Salvar a voz'", async () => {
    montarExemplo();
    const f = await validarVoz();
    expect(anuncio(f)).toBe("A voz da Janete está conectada. chave terminada em ABCD Usar esta chave na escuta também?");
    fireEvent.click(botao("Sim, usar na escuta também", f));
    await andar(900);
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
    await salvarVozB(f);
    expect(screen.getAllByText("Voz salva. A escuta também usa esta chave.").length).toBeGreaterThan(0);
    // a escuta ganhou a chave própria, a mesma da voz
    expect(cartao("escuta").textContent).toContain("terminada em ABCD");
  });

  it("'Sim' e 'Escolher depois'", async () => {
    montarExemplo();
    const f = await validarVoz();
    fireEvent.click(botao("Sim, usar na escuta também", f));
    await andar(900);
    fireEvent.click(document.getElementById("cfg-vozes-depois")!);
    await andar(300);
    expect(fluxo()).toBeNull();
    expect(
      screen.getAllByText("Voz conectada, e a escuta também usa esta chave. Escolha a voz quando quiser.").length,
    ).toBeGreaterThan(0);
  });

  it("'Não' e 'Escolher depois'; o 'Não' segue para a lista com o 'Escolher depois'", async () => {
    montarExemplo();
    const f = await validarVoz();
    fireEvent.click(botao("Não, só na voz", f));
    await andar(900);
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
    fireEvent.click(botao("Escolher depois", f));
    await andar(300);
    expect(screen.getAllByText("Voz conectada. Escolha a voz quando quiser.").length).toBeGreaterThan(0);
    // o "Não" não copia: a escuta continua sem chave própria (usa a da voz)
    expect(within(cartao("escuta")).getByRole("heading", { name: "Ativa, usando a chave da voz" })).toBeInTheDocument();
  });

  it.each([
    ["Não, só na voz", "Voz conectada. A Janete continua com a voz Voz de exemplo A."],
    ["Sim, usar na escuta também", "Voz conectada, e a escuta também usa esta chave. A Janete continua com a voz Voz de exemplo A."],
  ])("trocar a chave com a voz de antes ainda na conta, '%s' e 'Escolher depois': a voz continua", async (resposta, mensagem) => {
    montarExemplo([chaveEleven("voz", "VOZ1")], VOZ_A);
    const f = await validarVoz();
    fireEvent.click(botao(resposta, f));
    await andar(900);
    fireEvent.click(botao("Escolher depois", f));
    await andar(300);
    expect(fluxo()).toBeNull();
    expect(screen.getAllByText(mensagem).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Escolha a voz quando quiser/)).not.toBeInTheDocument();
  });

  it("a escuta já usa a mesma chave (P6): sem pergunta, a linha nova; 'Escolher a voz' e 'Salvar a voz'", async () => {
    montarExemplo([chaveEleven("transcricao", "ABCD")]);
    const f = await validarVoz();
    expect(within(f).queryByText("Usar esta chave na escuta também?")).not.toBeInTheDocument();
    expect(within(f).getByText("A Escuta de áudio já usa esta chave.")).toBeInTheDocument();
    expect(document.getElementById("val-sec")).toBeNull();
    fireEvent.click(botao("Escolher a voz", f));
    await andar(900);
    await salvarVozB(f);
    expect(screen.getAllByText("Voz salva.").length).toBeGreaterThan(0);
  });

  it("a escuta de outro provedor: o detalhe diz qual chave sai", async () => {
    montarExemplo([{ ...chaveEleven("transcricao", "GQ12"), provedor: "groq", modelo: "whisper-large-v3-turbo" } as ChaveIA]);
    const f = await validarVoz();
    expect(
      within(f).getByText("O cartão Escuta tem a chave da Groq, terminada em GQ12. No Sim, ela sai, e a escuta passa a usar esta."),
    ).toBeInTheDocument();
  });

  it("'Trocar a voz' (fluxo 'vozes') continua só com Cancelar, sem 'Escolher depois'", async () => {
    montarExemplo([chaveEleven("voz", "VOZ1")]);
    fireEvent.click(botao("Escolher a voz", cartao("voz")));
    const f = fluxo()!;
    expect(f).toHaveAttribute("data-fluxo", "vozes");
    await andar(50);
    expect(document.getElementById("cfg-vozes-depois")).toBeNull();
    expect(botao("Cancelar", f)).toBeInTheDocument();
  });
});

/* ---------- o modo banco ---------- */

const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EU = { id: "mb-1", nome: "Ana", email: "ana@teste.com", papel: "admin", ativo: true, user_id: UID, criado_em: "2026-10-01T12:00:00.000Z", vistos: {} };
const CONEXAO = {
  id: "cx-1",
  nome: "(11) 91234-5678",
  gateway: "zapi",
  status: "conectada",
  ativa: true,
  oficial: false,
  id_externo: null,
  ultimo_erro: null,
  criado_em: "2026-10-20T12:00:00.000Z",
  atualizado_em: "2026-10-20T12:00:00.000Z",
};
const CHAVE_RESPOSTA = {
  ...chaveEleven("transcricao", "TSTE"),
  id: "k-1",
  finalidade: "resposta",
  provedor: "anthropic",
  modelo: "claude-haiku-5-5",
} as ChaveIA;
const CONFIG = {
  id: 1,
  espera_lote_s: 8,
  espera_lote_max_s: 60,
  onboarding_concluido_em: "2026-10-21T12:00:00.000Z",
  atualizado_em: AGORA.toISOString(),
  worker_visto_em: AGORA.toISOString(),
};
const VOZES = [
  { id: "voz-a", nome: "Ana", detalhe: null, portugues: true, previa: null },
  { id: "voz-b", nome: "Bruna", detalhe: null, portugues: true, previa: null },
];

function servidorFalso(sobre: Partial<Record<keyof ServidorConfiguracao, unknown>> = {}) {
  const ok = (extra: Record<string, unknown> = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  const s = {
    salvarConexao: ok(),
    verSegredoGerado: ok({ valor: "" }),
    desconectarConexao: ok(),
    conferirConexao: ok(),
    consertarCampoConexao: ok(),
    salvarChaveIA: ok({ ultimos4: "ABCD", status: "ativa" }),
    revalidarChaveIA: ok({ status: "ativa", provedor: "anthropic", modelo: "claude-haiku-5-5" }),
    listarModelosDaChave: ok({ modelos: [], origem: "provedor" }),
    trocarModeloIA: ok(),
    removerChaveIA: ok(),
    salvarRitmo: ok(),
    listarModelos: ok({ modelos: [], origem: "provedor" }),
    listarVozes: ok({ vozes: VOZES, atual: null }),
    escolherVoz: ok({ voz: { id: "voz-b", nome: "Bruna" } }),
    salvarModoVoz: ok({ modo: "sempre" }),
    pedirQr: ok(),
    desconectarCelular: ok(),
    usarChaveElevenLabs: ok({ copiada: true, ultimos4: "ABCD", status: "ativa" }),
    ...sobre,
  };
  return s as unknown as ServidorConfiguracao & Record<keyof ServidorConfiguracao, ReturnType<typeof vi.fn>>;
}

function montarBanco(chaves: ChaveIA[], servidor = servidorFalso()) {
  const b = { chaves: [CHAVE_RESPOSTA, ...chaves] };
  const f = criarClienteFalso({
    uid: UID,
    consulta: (c: Consulta) => {
      switch (c.tabela) {
        case "membros":
          return { data: EU, error: null };
        case "conexoes":
          return { data: CONEXAO, error: null };
        case "conexao_eventos":
          return { data: null, error: null };
        case "ia_chaves":
          return { data: b.chaves, error: null };
        case "configuracao":
          return { data: CONFIG, error: null };
        case "auditoria":
          return { data: null, error: null };
        default:
          return undefined;
      }
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProvedorPapel papel="admin">
        <Suspense fallback={<p>suspenso</p>}>
          <ProvedorDados fonte="banco" cliente={f.cliente}>
            <ServidorConfiguracaoContexto.Provider value={servidor}>
              <TelaConfiguracao />
            </ServidorConfiguracaoContexto.Provider>
          </ProvedorDados>
        </Suspense>
      </ProvedorPapel>
    </QueryClientProvider>,
  );
  return { b, servidor };
}

async function carregar() {
  for (let i = 0; i < 6; i++) await andar(5);
}

describe("a escuta com a ElevenLabs (modo banco)", () => {
  it("grava a transcrição com o scribe_v2; o 'Sim' copia para a voz no servidor e abre a lista; a chave nunca no DOM", async () => {
    const servidor = servidorFalso();
    const { b } = montarBanco([], servidor);
    // a releitura depois de gravar traz a escuta nova (e, de propósito, uma voz com a mesma chave):
    // a pergunta foi calculada no aceite e não muda na tela
    servidor.salvarChaveIA.mockImplementationOnce(async () => {
      b.chaves = [CHAVE_RESPOSTA, chaveEleven("transcricao", "ABCD"), chaveEleven("voz", "ABCD")];
      return { ok: true, ultimos4: "ABCD", status: "ativa" };
    });
    await carregar();
    const f = await validarEscuta();
    await carregar();
    expect(servidor.salvarChaveIA).toHaveBeenCalledWith({ finalidade: "transcricao", provedor: "elevenlabs", modelo: "scribe_v2", chave: CHAVE });
    expect(within(f).getByText("Usar esta chave também na voz?")).toBeInTheDocument();
    expect(within(f).queryByText("A Voz da Janete já usa esta chave.")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CHAVE);
    expect(document.body.textContent).not.toContain(CHAVE);
    expect((document.getElementById("cfg-f-chave") as HTMLInputElement | null)?.value ?? "").toBe("");

    fireEvent.click(botao("Sim, usar na voz também", f));
    await carregar();
    await andar(900);
    expect(servidor.usarChaveElevenLabs).toHaveBeenCalledTimes(1);
    expect(servidor.usarChaveElevenLabs).toHaveBeenCalledWith({ para: "voz" });
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
    await carregar();
    expect(servidor.listarVozes).toHaveBeenCalled();
    fireEvent.click(within(f).getByRole("radio", { name: /Bruna/ }));
    fireEvent.click(botao("Salvar a voz", f));
    await andar(200);
    expect(servidor.escolherVoz).toHaveBeenCalledWith({ vozId: "voz-b" });
    expect(screen.getAllByText("Escuta ligada e voz salva. As duas usam a mesma chave.").length).toBeGreaterThan(0);
    expect(document.body.innerHTML).not.toContain(CHAVE);
  });

  it("o 'Sim' carregando desliga os dois botões; a falha mostra o alerta, e os botões continuam", async () => {
    let soltar: (v: unknown) => void = () => {};
    const servidor = servidorFalso({
      usarChaveElevenLabs: vi
        .fn()
        .mockImplementationOnce(() => new Promise((r) => (soltar = r)))
        .mockResolvedValueOnce({ ok: true, copiada: true, ultimos4: "ABCD", status: "ativa" }),
    });
    montarBanco([], servidor);
    await carregar();
    const f = await validarEscuta();
    fireEvent.click(botao("Sim, usar na voz também", f));
    await andar(20);
    expect(document.getElementById("val-pri")).toBeDisabled();
    expect(document.getElementById("val-sec")).toBeDisabled();
    // durante a cópia, o Cancelar fica travado
    expect(botao("Cancelar", f)).toBeDisabled();
    await act(async () => {
      soltar({ ok: false, erro: "chave_invalida", mensagem: "A ElevenLabs recusou a chave do outro cartão." });
    });
    await carregar();
    const alerta = within(f).getAllByRole("alert").find((a) => a.tagName === "P")!;
    expect(alerta.textContent).toBe(textoFalhaAcao("chave_invalida", "A ElevenLabs recusou a chave do outro cartão."));
    expect(document.getElementById("val-pri")).toBeEnabled();
    expect(document.getElementById("val-sec")).toBeEnabled();
    expect(within(f).getByText("Usar esta chave também na voz?")).toBeInTheDocument();
    // o "Sim" tenta de novo (P9)
    fireEvent.click(botao("Sim, usar na voz também", f));
    await carregar();
    await andar(900);
    expect(servidor.usarChaveElevenLabs).toHaveBeenCalledTimes(2);
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
  });

  it("a voz já usa a mesma chave, com o final em minúsculas no banco (P6): sem pergunta, a linha nova", async () => {
    const servidor = servidorFalso({ salvarChaveIA: vi.fn(async () => ({ ok: true, ultimos4: "9fa3", status: "ativa" })) });
    montarBanco([chaveEleven("voz", "9fa3")], servidor);
    await carregar();
    const f = await validarEscuta();
    await carregar();
    expect(within(f).queryByText("Usar esta chave também na voz?")).not.toBeInTheDocument();
    expect(within(f).getByText("A Voz da Janete já usa esta chave.")).toBeInTheDocument();
    expect(document.getElementById("val-sec")).toBeNull();
  });

  it("sem os acessos (sem_permissao): a recusa segue a da voz, com a frase do servidor", async () => {
    const mensagem = "A chave existe, mas não tem os acessos que a Janete usa. Na ElevenLabs, edite a chave e ligue User e Speech to Text.";
    const servidor = servidorFalso();
    servidor.salvarChaveIA.mockResolvedValueOnce({ ok: false, erro: "sem_permissao", mensagem });
    montarBanco([], servidor);
    await carregar();
    const f = await validarEscuta();
    const alerta = within(f).getByRole("alert");
    expect(within(alerta).getByText("Chave recusada")).toBeInTheDocument();
    expect(within(alerta).getByRole("heading", { name: "A chave existe, mas não tem os acessos que a Janete usa." })).toBeInTheDocument();
    fireEvent.click(botao("Corrigir a chave", f));
    await andar(1500);
    expect(f.textContent).not.toContain("Copie de novo, inteira");
    expect(servidor.usarChaveElevenLabs).not.toHaveBeenCalled();
  });
});

describe("a voz com a pergunta da escuta (modo banco)", () => {
  it("o 'Sim' copia para a transcrição e segue para a lista", async () => {
    const servidor = servidorFalso();
    montarBanco([], servidor);
    await carregar();
    const f = await validarVoz();
    expect(servidor.salvarChaveIA).toHaveBeenCalledWith({ finalidade: "voz", provedor: "elevenlabs", modelo: "", chave: CHAVE });
    fireEvent.click(botao("Sim, usar na escuta também", f));
    await carregar();
    await andar(900);
    expect(servidor.usarChaveElevenLabs).toHaveBeenCalledWith({ para: "transcricao" });
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
    fireEvent.click(botao("Escolher depois", f));
    await andar(300);
    expect(fluxo()).toBeNull();
    expect(
      screen.getAllByText("Voz conectada, e a escuta também usa esta chave. Escolha a voz quando quiser.").length,
    ).toBeGreaterThan(0);
  });

  it("a escuta já usa a mesma chave, com o final em minúsculas no banco (P6): sem pergunta, a linha nova", async () => {
    const servidor = servidorFalso({ salvarChaveIA: vi.fn(async () => ({ ok: true, ultimos4: "x7qa", status: "ativa" })) });
    montarBanco([chaveEleven("transcricao", "x7qa")], servidor);
    await carregar();
    const f = await validarVoz();
    await carregar();
    expect(within(f).queryByText("Usar esta chave na escuta também?")).not.toBeInTheDocument();
    expect(within(f).getByText("A Escuta de áudio já usa esta chave.")).toBeInTheDocument();
    expect(document.getElementById("val-sec")).toBeNull();
  });

  it("o 'Não' não chama a cópia", async () => {
    const servidor = servidorFalso();
    montarBanco([], servidor);
    await carregar();
    const f = await validarVoz();
    fireEvent.click(botao("Não, só na voz", f));
    await carregar();
    await andar(900);
    expect(servidor.usarChaveElevenLabs).not.toHaveBeenCalled();
    expect(within(f).getByRole("heading", { level: 2, name: "Escolher a voz da Janete" })).toBeInTheDocument();
  });
});
