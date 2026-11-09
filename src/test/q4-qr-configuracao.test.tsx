import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelaConfiguracao } from "@/features/plataforma/configuracao";
import { CartaoWhats } from "@/features/plataforma/configuracao/CartaoWhats";
import { erroPadraoW } from "@/features/plataforma/configuracao/dados";
import { lerCerebro, lerEscuta, lerWhats } from "@/features/plataforma/configuracao/leitura";
import { SEM_TESTE, textosSaude } from "@/features/plataforma/configuracao/Saude";
import { textoErroConexao, textoFalhaAcao } from "@/features/plataforma/configuracao/textos";
import { ServidorConfiguracaoContexto, type ServidorConfiguracao } from "@/features/plataforma/dados/configuracao";
import { ProvedorDados } from "@/features/plataforma/dados/ProvedorDados";
import { criarClienteFalso, type Consulta } from "@/features/plataforma/dados/testes/clienteFalso";
import type { ChaveIA, Conexao } from "@/features/plataforma/exemplo";
import { ProvedorPapel } from "@/features/plataforma/papel";

// Q4: o passo do QR code na Configuração (spec-qr-whatsapp, linha C2). A troca de WhatsApp (Fluxo)
// mostra o QR quando a Z-API ou a Evolution respondem "instancia_desconectada"; o número caído mostra
// "Mostrar o QR code" no cartão e na Saúde, e o QR aparece no próprio cartão, com os dados guardados.
// O cliente do Firebase e as funções de servidor são falsos: nada vai à rede nem ao banco.

vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return { ...real, movimentoReduzido: () => true, rolarAteEMedir: () => Promise.resolve(null) };
});

const AGORA = new Date("2026-11-02T15:00:00-03:00");
const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EU = {
  id: "mb-1",
  nome: "Ana",
  email: "ana@teste.com",
  papel: "admin",
  ativo: true,
  user_id: UID,
  criado_em: "2026-10-01T12:00:00.000Z",
  vistos: {},
};
const minAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();
const IMAGEM = "data:image/png;base64,QUJDRA==";
const ALT = "QR code para conectar o WhatsApp";
const TITULO_QR = "Leia o QR code com o WhatsApp do celular";

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
const CAIDA = { ...CONEXAO, status: "desconectada", ultimo_erro: "instancia_desconectada" };
const CHAVE_RESPOSTA = {
  id: "k-1",
  finalidade: "resposta",
  provedor: "anthropic",
  modelo: "claude-haiku-5-5",
  status: "ativa",
  ultimos4: "TSTE",
  ultimo_erro: null,
  validada_em: minAtras(60),
  atualizada_em: minAtras(60),
  atualizada_por: null,
} as ChaveIA;
const CONFIG = {
  id: 1,
  espera_lote_s: 8,
  espera_lote_max_s: 60,
  onboarding_concluido_em: "2026-10-21T12:00:00.000Z",
  atualizado_em: minAtras(1),
  worker_visto_em: minAtras(0.5),
};

/** O celular do teste: enquanto `leu` for falso, a situação é "desconectado". */
const celular = { leu: false };

function servidorFalso(sobre: Partial<Record<keyof ServidorConfiguracao, unknown>> = {}) {
  const ok = (extra: Record<string, unknown> = {}) => vi.fn(async () => ({ ok: true, ...extra }));
  const qr = vi.fn(async (d: { pedir: string }) =>
    celular.leu
      ? { ok: true, conectado: true, rotulo: "(11) 95555-0000" }
      : { ok: true, conectado: false, qr: d.pedir === "qr" ? IMAGEM : null, passkey: false },
  );
  const s = {
    salvarConexao: ok({ conexao_id: "cx-2", nome: "(11) 95555-0000", gateway: "zapi", url_webhook: "", avisos: [] }),
    verSegredoGerado: ok({ valor: "verify-guardado-123" }),
    desconectarConexao: ok({ conexao_id: "cx-1" }),
    conferirConexao: ok({ conexao_id: "cx-1", gateway: "zapi", nome: "(11) 91234-5678", status: "conectada" }),
    consertarCampoConexao: ok({ conexao_id: "cx-1", gateway: "meta", nome: "(11) 91234-5678" }),
    salvarChaveIA: ok({ ultimos4: "ABCD", status: "ativa" }),
    revalidarChaveIA: ok({ status: "ativa", provedor: "anthropic", modelo: "claude-haiku-5-5" }),
    listarModelosDaChave: ok({ modelos: [], origem: "provedor" }),
    trocarModeloIA: ok({ modelo: "x", status: "ativa" }),
    removerChaveIA: ok(),
    salvarRitmo: ok({ espera: 9, teto: 60 }),
    listarModelos: ok({ modelos: [], origem: "provedor" }),
    pedirQrConexao: vi.fn(async (d: { pedir: string }) => qr(d)),
    pedirQrConexaoGuardada: vi.fn(async (d: { pedir: string }) => qr(d)),
    ...sobre,
  };
  return s as unknown as ServidorConfiguracao & Record<keyof ServidorConfiguracao, ReturnType<typeof vi.fn>>;
}

function montar(conexao: Record<string, unknown> = CONEXAO, servidor = servidorFalso()) {
  const b = { conexao };
  const f = criarClienteFalso({
    uid: UID,
    consulta: (c: Consulta) => {
      switch (c.tabela) {
        case "membros":
          return { data: EU, error: null };
        case "conexoes":
          return { data: b.conexao, error: null };
        case "conexao_eventos":
          return { data: null, error: null };
        case "ia_chaves":
          return { data: [CHAVE_RESPOSTA], error: null };
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
  return { b, servidor, qc };
}

/** O relógio anda em passos de 100 ms: as promessas de cada passo (o servidor falso) resolvem antes do próximo. */
async function andar(ms: number) {
  for (let feito = 0; feito < ms; feito += 100) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(100, ms - feito));
    });
  }
}

async function carregar() {
  for (let i = 0; i < 6; i++) await andar(5);
}

const cartao = () => document.getElementById("cfg-card-whats")!;
const fluxo = () => document.getElementById("cfg-fluxo");
const botao = (nome: string | RegExp, dentro: HTMLElement = document.body) => within(dentro).getByRole("button", { name: nome });

/**
 * O elemento cujo texto inteiro é este (ou casa com a regex): os números formatados ficam num trecho
 * próprio, que não quebra no meio da linha, então o texto se divide em mais de um nó.
 */
const textoInteiro = (t: string | RegExp) => {
  const casa = (x: string | null) => (typeof t === "string" ? x === t : t.test(x ?? ""));
  return (_: string, el: Element | null) => !!el && casa(el.textContent) && !Array.from(el.children).some((f) => casa(f.textContent));
};

/** Abre a troca, escolhe a Z-API e cola os 3 campos. */
function trocarParaZapi(): HTMLElement {
  fireEvent.click(botao("Trocar de WhatsApp", cartao()));
  const f = fluxo()!;
  fireEvent.click(within(f).getByRole("button", { name: /^Não oficial/ }));
  fireEvent.click(within(f).getByRole("button", { name: /^Z-API/ }));
  // o número do WhatsApp, obrigatório (spec-qr-whatsapp, seção 8)
  fireEvent.change(within(f).getByLabelText("Número do WhatsApp"), { target: { value: "11 98765-4321" } });
  fireEvent.change(within(f).getByLabelText("ID da instância"), { target: { value: "inst-1" } });
  fireEvent.change(within(f).getByLabelText("Token da instância"), { target: { value: "tok-1" } });
  fireEvent.change(within(f).getByLabelText("Client-Token"), { target: { value: "cli-1" } });
  return f;
}

const DESCONECTADA = {
  ok: false,
  erro: "instancia_desconectada",
  mensagem: "A instância existe, mas o WhatsApp não está conectado. Leia o QR code no painel da Z-API e tente de novo.",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  celular.leu = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("troca de WhatsApp: o passo do QR no palco do Fluxo", () => {
  it("Z-API desconectada mostra o QR; o celular lê, a troca salva e fecha com 'WhatsApp trocado…'", async () => {
    const servidor = servidorFalso();
    servidor.salvarConexao.mockResolvedValueOnce(DESCONECTADA);
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaZapi();
    // o foco da abertura do fluxo (no título) já passou, como numa pessoa de verdade
    await andar(400);
    fireEvent.click(botao("Conectar", f));
    await andar(1600);

    // o passo: título no palco (h3, abaixo do "Trocar de WhatsApp"), a imagem e as instruções;
    // nada mandando ao painel da Z-API
    const titulo = within(f).getByRole("heading", { level: 3, name: TITULO_QR });
    expect(titulo).toHaveAttribute("id", "cfg-qr-titulo-fluxo");
    expect(within(f).getByRole("img", { name: ALT })).toHaveAttribute("src", IMAGEM);
    expect(within(f).getByText(/Toque em Conectar dispositivo/)).toBeInTheDocument();
    expect(f.textContent).not.toMatch(/painel da Z-API/);
    expect(screen.getByText("Falta ler o QR code com o WhatsApp do celular.")).toBeInTheDocument();
    expect(document.activeElement).toBe(titulo);
    expect(servidor.pedirQrConexao).toHaveBeenCalledWith({
      gateway: "zapi",
      campos: { numero: "11 98765-4321", instanceId: "inst-1", instanceToken: "tok-1", clientToken: "cli-1" },
      pedir: "qr",
    });
    // nada gravado ainda: o salvarConexao só foi chamado no "Conectar"
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(1);
    // o herói continua conferindo durante o passo
    expect(screen.getByRole("img", { name: "Janete, conferindo" })).toBeInTheDocument();

    // o celular lê: a próxima consulta pega a conexão, e a troca salva de novo
    celular.leu = true;
    await andar(3000);
    await andar(1500);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(2);
    expect(within(f).getByRole("heading", { name: "Tudo certo, WhatsApp conectado." })).toBeInTheDocument();
    expect(within(f).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();

    fireEvent.click(botao("Voltar para a Configuração", f));
    await andar(100);
    expect(fluxo()).toBeNull();
    expect(screen.getAllByText("WhatsApp trocado. A conexão anterior foi desativada.").length).toBeGreaterThan(0);
  });

  it("a Evolution também abre o QR", async () => {
    const servidor = servidorFalso();
    servidor.salvarConexao.mockResolvedValueOnce({ ...DESCONECTADA, mensagem: "" });
    montar(CONEXAO, servidor);
    await carregar();
    fireEvent.click(botao("Trocar de WhatsApp", cartao()));
    const f = fluxo()!;
    fireEvent.click(within(f).getByRole("button", { name: /^Não oficial/ }));
    fireEvent.click(within(f).getByRole("button", { name: /^Evolution/ }));
    fireEvent.change(within(f).getByLabelText("Número do WhatsApp"), { target: { value: "11 98765-4321" } });
    fireEvent.change(within(f).getByLabelText("URL do servidor"), { target: { value: "https://evo.teste.com" } });
    fireEvent.change(within(f).getByLabelText("Nome da instância (opcional)"), { target: { value: "vendas" } });
    fireEvent.change(within(f).getByLabelText("Chave de API"), { target: { value: "chave-evo" } });
    fireEvent.click(botao("Conectar", f));
    await andar(1500);
    expect(within(f).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    expect(servidor.pedirQrConexao).toHaveBeenCalledWith(expect.objectContaining({ gateway: "evolution", pedir: "qr" }));
  });

  it("'Corrigir os dados' volta ao formulário com os campos preenchidos", async () => {
    const servidor = servidorFalso();
    servidor.salvarConexao.mockResolvedValueOnce(DESCONECTADA);
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaZapi();
    fireEvent.click(botao("Conectar", f));
    await andar(1500);
    fireEvent.click(botao("Corrigir os dados", f));
    await andar(400);
    expect(within(f).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    expect(within(f).getByLabelText("ID da instância")).toHaveValue("inst-1");
    expect(within(f).getByLabelText("Client-Token")).toHaveValue("cli-1");
    expect(document.activeElement).toBe(document.getElementById("cfg-acao-painel"));
    // o QR parou de ser pedido
    const pedidos = servidor.pedirQrConexao.mock.calls.length;
    await andar(10_000);
    expect(servidor.pedirQrConexao.mock.calls.length).toBe(pedidos);
  });

  it("'Cancelar' e Esc fecham a troca durante o QR, sem gravar nada", async () => {
    const servidor = servidorFalso();
    servidor.salvarConexao.mockResolvedValue(DESCONECTADA);
    montar(CONEXAO, servidor);
    await carregar();
    let f = trocarParaZapi();
    fireEvent.click(botao("Conectar", f));
    await andar(1500);
    expect(botao("Cancelar", f)).toBeEnabled();
    fireEvent.click(botao("Cancelar", f));
    await andar(100);
    expect(fluxo()).toBeNull();
    expect(screen.getByRole("img", { name: /^Janete, (parada|atendendo)/ })).toBeInTheDocument();

    f = trocarParaZapi();
    fireEvent.click(botao("Conectar", f));
    await andar(1500);
    expect(within(f).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    fireEvent.keyDown(f, { key: "Escape" });
    await andar(100);
    expect(fluxo()).toBeNull();
    expect(servidor.conferirConexao).not.toHaveBeenCalled();
  });

  it("a Meta com 'instancia_desconectada' não abre o QR: cai no erro", async () => {
    const servidor = servidorFalso();
    servidor.salvarConexao.mockResolvedValueOnce({ ok: false, erro: "instancia_desconectada", mensagem: "" });
    montar(CONEXAO, servidor);
    await carregar();
    fireEvent.click(botao("Trocar de WhatsApp", cartao()));
    const f = fluxo()!;
    fireEvent.click(within(f).getByRole("button", { name: /^Oficial/ }));
    fireEvent.click(within(f).getByRole("button", { name: /^API oficial da Meta/ }));
    fireEvent.change(within(f).getByLabelText("Phone Number ID"), { target: { value: "123" } });
    fireEvent.change(within(f).getByLabelText("ID da conta do WhatsApp Business"), { target: { value: "456" } });
    fireEvent.change(within(f).getByLabelText("Token de acesso permanente"), { target: { value: "EAAG-token" } });
    fireEvent.change(within(f).getByLabelText("App Secret"), { target: { value: "segredo-app" } });
    fireEvent.click(botao("Conectar", f));
    await andar(1500);
    expect(within(f).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    expect(within(f).getByRole("heading", { name: "Não deu para conectar." })).toBeInTheDocument();
    expect(servidor.pedirQrConexao).not.toHaveBeenCalled();
  });
});

describe("número caído: 'Mostrar o QR code' no cartão", () => {
  it("o botão aparece no cartão e na Saúde, e o aviso aponta para ele (nunca para o painel)", async () => {
    montar(CAIDA);
    await carregar();
    expect(screen.getAllByRole("button", { name: "Mostrar o QR code" })).toHaveLength(2);
    // a frase que aponta o botão fica fora do alerta, num parágrafo comum
    const alerta = within(cartao()).getByRole("alert");
    expect(alerta).toHaveTextContent("Falta ler o QR code de novo para a Janete voltar a atender.");
    expect(alerta.textContent).not.toMatch(/Mostrar o QR code/);
    expect(within(cartao()).getByText('Use o botão "Mostrar o QR code", aqui embaixo.').closest('[role="alert"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/painel da Z-API|Já li o QR code/);

    // com o QR aberto, o alerta não muda, a frase do botão some e a Saúde não repete o botão
    const antes = alerta.textContent;
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    expect(within(cartao()).getByRole("alert").textContent).toBe(antes);
    expect(screen.queryByText('Use o botão "Mostrar o QR code", aqui embaixo.')).not.toBeInTheDocument();
    expect(within(screen.getByTestId("cfg-saude")).queryByRole("button", { name: "Mostrar o QR code" })).not.toBeInTheDocument();
  });

  it("o QR aparece no cartão, conecta e mostra 'Conectado'", async () => {
    const { b, servidor } = montar(CAIDA);
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    const titulo = within(cartao()).getByRole("heading", { level: 3, name: TITULO_QR });
    expect(titulo).toHaveAttribute("id", "cfg-qr-titulo");
    expect(document.activeElement).toBe(titulo);
    expect(within(cartao()).getByRole("img", { name: ALT })).toHaveAttribute("src", IMAGEM);
    expect(servidor.pedirQrConexaoGuardada).toHaveBeenCalledWith({ pedir: "qr" });
    // durante o QR, o pé do cartão some (o "Cancelar" fica no passo)
    expect(within(cartao()).queryByRole("button", { name: "Trocar de WhatsApp" })).not.toBeInTheDocument();
    expect(within(cartao()).queryByRole("button", { name: "Colar os dados de novo" })).not.toBeInTheDocument();
    expect(within(cartao()).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();

    // o celular lê: a conexão volta e a conferência mostra o check
    celular.leu = true;
    b.conexao = CONEXAO;
    await andar(3000);
    await andar(400);
    await carregar();
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(1);
    expect(within(cartao()).getByText("Conectado · testado agora")).toBeInTheDocument();
    expect(within(cartao()).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    expect(screen.getAllByText("WhatsApp conectado. A Janete voltou a atender.").length).toBeGreaterThan(0);
  });

  it("o botão da Saúde abre o mesmo QR no cartão; 'Cancelar' fecha e para de pedir", async () => {
    const { servidor } = montar(CAIDA);
    await carregar();
    const saude = screen.getByTestId("cfg-saude");
    fireEvent.click(botao("Mostrar o QR code", saude));
    await andar(400);
    expect(within(cartao()).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    fireEvent.click(botao("Cancelar", cartao()));
    await andar(100);
    expect(within(cartao()).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById("cfg-conserto-w"));
    const pedidos = servidor.pedirQrConexaoGuardada.mock.calls.length;
    await andar(10_000);
    expect(servidor.pedirQrConexaoGuardada.mock.calls.length).toBe(pedidos);
    expect(servidor.conferirConexao).not.toHaveBeenCalled();
  });

  it("fecha sozinho quando a conexão volta pelo tempo real, e confere o número", async () => {
    const { b, qc, servidor } = montar(CAIDA);
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    expect(within(cartao()).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    b.conexao = CONEXAO;
    await act(async () => {
      await qc.invalidateQueries();
    });
    await carregar();
    expect(within(cartao()).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    // o mesmo caminho do aoConectar: a conferência (que confere o número), depois o check, o aviso
    // e o foco no número
    await andar(400);
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("WhatsApp conectado. A Janete voltou a atender.").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "Janete, tudo certo" })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById("cfg-h-whats"));
  });

  it("fecha sozinho quando a situação vira 'erro': só o foco vai para o número, sem aviso de conectado", async () => {
    const { b, qc } = montar(CAIDA);
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    expect(within(cartao()).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    b.conexao = { ...CAIDA, status: "erro" };
    await act(async () => {
      await qc.invalidateQueries();
    });
    await carregar();
    await andar(100);
    expect(within(cartao()).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById("cfg-h-whats"));
    expect(screen.queryByText("WhatsApp conectado. A Janete voltou a atender.")).not.toBeInTheDocument();
  });

  it("conectando: o aviso não muda ao abrir o QR, a Saúde aponta para o cartão, e o QR fecha quando um fluxo de troca abre", async () => {
    const { servidor } = montar({ ...CAIDA, status: "conectando", ultimo_erro: null });
    await carregar();
    expect(within(cartao()).getByText('Use o botão "Mostrar o QR code", aqui embaixo.')).toBeInTheDocument();
    const status = within(cartao()).getByText(/^Falta ler o QR code com o celular do número\.$/);
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    expect(within(cartao()).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    // o texto do aviso (role="status") é o mesmo; nada é acrescentado com o QR aberto
    expect(status.textContent).toBe("Falta ler o QR code com o celular do número.");
    expect(within(cartao()).queryByText(/aqui embaixo|logo abaixo/)).not.toBeInTheDocument();
    const saude = screen.getByTestId("cfg-saude");
    expect(within(saude).getByText(/Leia o QR code no cartão do WhatsApp\./)).toBeInTheDocument();
    expect(within(saude).queryByRole("button", { name: "Mostrar o QR code" })).not.toBeInTheDocument();
    // outra troca (a chave do cérebro) abre o fluxo: o QR do cartão fecha e para de pedir
    fireEvent.click(botao("Trocar a chave", document.getElementById("cfg-card-cerebro")!));
    await andar(100);
    expect(fluxo()).not.toBeNull();
    expect(within(cartao()).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    const pedidos = servidor.pedirQrConexaoGuardada.mock.calls.length;
    await andar(10_000);
    expect(servidor.pedirQrConexaoGuardada.mock.calls.length).toBe(pedidos);
  });
});

describe("a atendente e os textos", () => {
  const caida = { ...CAIDA, ultimo_erro: null } as unknown as Conexao;

  it("a atendente não vê o botão: o aviso manda avisar quem administra", () => {
    const w = lerWhats(caida, false);
    render(
      <CartaoWhats
        admin={false}
        w={w}
        teste="idle"
        bloqueado={false}
        realce={null}
        oculto={false}
        conserto={null}
        verWebhook={false}
        aoAlternarWebhook={() => {}}
        verVerify={false}
        aoAlternarVerify={() => {}}
        copiado={null}
        aoCopiar={() => {}}
        simular={false}
        aoSimular={() => {}}
        aoTestar={() => {}}
        aoTrocar={() => {}}
        aoDesconectar={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Mostrar o QR code" })).not.toBeInTheDocument();
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Avise quem administra a conta.");
    expect(alerta.textContent).not.toMatch(/Mostrar o QR code|painel/);

    const conectando = lerWhats({ ...caida, status: "conectando" } as Conexao, false);
    const t = textosSaude({ w: conectando, cer: lerCerebro({ chaves: [] }, false), esc: lerEscuta({ chaves: [] }, false), teste: SEM_TESTE, admin: false });
    expect(t.sub).not.toMatch(/Mostrar o QR code|painel/);
  });

  it("nenhum texto manda ao painel do provedor para ler o QR", () => {
    for (const g of ["zapi", "evolution"] as const) {
      expect(erroPadraoW(g, "desconectada")).not.toMatch(/painel/);
      expect(textoErroConexao("instancia_desconectada", g, "desconectada")).not.toMatch(/painel/);
      const conectando = lerWhats({ ...caida, gateway: g, status: "conectando" } as Conexao);
      const t = textosSaude({ w: conectando, cer: lerCerebro({ chaves: [] }, true), esc: lerEscuta({ chaves: [] }, true), teste: SEM_TESTE, admin: true });
      expect(t.sub).toMatch(/Leia o QR code em "Mostrar o QR code"\./);
      expect(t.sub).not.toMatch(/painel/);
    }
    expect(textoFalhaAcao("instancia_desconectada", DESCONECTADA.mensagem)).toBe(
      'O número ainda não está conectado no WhatsApp. Leia o QR code em "Mostrar o QR code".',
    );
  });
});

describe("Evolution na Configuração: criar a instância (spec-qr-whatsapp, seção 7)", () => {
  const CHAVE_GLOBAL_MSG =
    "Para criar a instância, use a chave global do servidor. É a AUTHENTICATION_API_KEY, no .env da Evolution. Se a instância já existe, informe o nome dela.";

  /** Abre a troca, escolhe a Evolution e cola a URL e a chave (o nome fica vazio: "janete"). */
  function trocarParaEvolution(): HTMLElement {
    fireEvent.click(botao("Trocar de WhatsApp", cartao()));
    const f = fluxo()!;
    fireEvent.click(within(f).getByRole("button", { name: /^Não oficial/ }));
    fireEvent.click(within(f).getByRole("button", { name: /^Evolution/ }));
    fireEvent.change(within(f).getByLabelText("Número do WhatsApp"), { target: { value: "11 98765-4321" } });
    fireEvent.change(within(f).getByLabelText("URL do servidor"), { target: { value: "https://evo.teste.com" } });
    fireEvent.change(within(f).getByLabelText("Chave de API"), { target: { value: "chave-de-instancia" } });
    return f;
  }

  it("o nome vazio libera o Conectar; o erro da chave mostra a frase do servidor, não o 'recusou a chave'", async () => {
    const servidor = servidorFalso();
    servidor.salvarConexao.mockResolvedValueOnce({ ok: false, erro: "credencial_invalida", campo: "apiKey", mensagem: CHAVE_GLOBAL_MSG });
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaEvolution();
    expect(botao("Conectar", f)).toBeEnabled();
    fireEvent.click(botao("Conectar", f));
    await andar(4000);
    expect(within(f).getByRole("heading", { name: "Para criar a instância, use a chave global do servidor." })).toBeInTheDocument();
    expect(f.textContent).not.toMatch(/recusou a chave/);

    fireEvent.click(botao("Corrigir os dados", f));
    await andar(400);
    expect(f.textContent).toContain("Para criar a instância, use a chave global do servidor.");
    expect(f.textContent).toContain("É a AUTHENTICATION_API_KEY, no .env da Evolution. Se a instância já existe, informe o nome dela.");
    expect(f.textContent).not.toMatch(/Chave recusada pelo servidor/);
    expect(within(f).getByLabelText("Chave de API")).toHaveAttribute("aria-invalid", "true");
  });

  it("o erro do nome marca o campo do nome com a frase do servidor", async () => {
    const servidor = servidorFalso();
    servidor.salvarConexao.mockResolvedValueOnce({
      ok: false,
      erro: "nao_encontrado",
      campo: "instanceName",
      mensagem: "Para a Janete criar a instância, use no nome só letras, números, hífen e sublinhado, sem espaço.",
    });
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaEvolution();
    fireEvent.change(within(f).getByLabelText("Nome da instância (opcional)"), { target: { value: "loja centro" } });
    fireEvent.click(botao("Conectar", f));
    await andar(4000);
    fireEvent.click(botao("Corrigir os dados", f));
    await andar(400);
    expect(within(f).getByLabelText("Nome da instância (opcional)")).toHaveAttribute("aria-invalid", "true");
    expect(f.textContent).toContain("Para a Janete criar a instância, use no nome só letras, números, hífen e sublinhado, sem espaço.");
  });

  it("'Colar os dados de novo' numa Evolution caída já vem com o nome da instância atual", async () => {
    montar({ ...CAIDA, gateway: "evolution", id_externo: "vendas", nome: "Instância “vendas” em evo.teste.com" });
    await carregar();
    fireEvent.click(botao("Colar os dados de novo", cartao()));
    await andar(400);
    const f = fluxo()!;
    expect(within(f).getByLabelText("Nome da instância (opcional)")).toHaveValue("vendas");
    expect(within(f).getByLabelText("Chave de API")).toHaveValue("");
  });

  it("'Trocar de WhatsApp' para a Evolution não preenche o nome (é outra conexão)", async () => {
    montar({ ...CONEXAO, gateway: "evolution", id_externo: "vendas", nome: "Instância “vendas” em evo.teste.com" });
    await carregar();
    const f = trocarParaEvolution();
    expect(within(f).getByLabelText("Nome da instância (opcional)")).toHaveValue("");
  });
});

describe("o número do WhatsApp na Configuração (spec-qr-whatsapp, seção 8, C2)", () => {
  const CONECTADO = "+55 21 99999-8888";
  const INFORMADO = "+55 11 98765-4321";
  const SALVO = "+55 11 91234-5678";
  const TITULO_DIFERENTE = "Outro número leu o QR code";
  const FRASE_DIFERENTE = `Este celular é do ${CONECTADO}, não do ${INFORMADO} que você informou.`;
  const DIFERENTE_SALVAR = {
    ok: false,
    erro: "numero_diferente",
    numero_conectado: CONECTADO,
    numero_informado: INFORMADO,
    mensagem: FRASE_DIFERENTE,
  };
  const MSG_CONSERTO =
    "Um celular de outro número leu o QR code, e a Janete desconectou ele. Leia o QR code com o celular do número desta conexão.";
  const DIFERENTE_CONSERTO = {
    ok: false,
    erro: "numero_diferente",
    numero_conectado: CONECTADO,
    numero_salvo: SALVO,
    desconectado: true,
    status: "desconectada",
    mensagem: MSG_CONSERTO,
  };
  const COM_NUMERO = { ...CONEXAO, nome: SALVO };
  const CAIDA_COM_NUMERO = { ...CAIDA, nome: SALVO };

  it("troca: o celular de outro número mostra o passo com os 2 botões, sem pedir QR; 'Usar' valida com o número conectado", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(async () => ({ ok: true })) });
    servidor.salvarConexao.mockResolvedValueOnce(DIFERENTE_SALVAR);
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaZapi();
    await andar(400);
    fireEvent.click(botao("Conectar", f));
    await andar(1600);

    const titulo = within(f).getByRole("heading", { level: 3, name: TITULO_DIFERENTE });
    expect(titulo).toHaveAttribute("id", "cfg-qr-titulo-fluxo");
    expect(document.activeElement).toBe(titulo);
    expect(within(f).getByText(textoInteiro(FRASE_DIFERENTE))).toBeInTheDocument();
    // o anúncio da casca diz o mesmo que a tela (e não "Falta ler o QR code")
    const status = Array.from(f.querySelectorAll('[role="status"]')).map((el) => el.textContent);
    expect(status).toContain("O celular conectado é de outro número.");
    expect(status).not.toContain("Falta ler o QR code com o WhatsApp do celular.");
    expect(botao(`Usar o ${CONECTADO}`, f)).toBeEnabled();
    expect(botao("Desconectar e ler de novo", f)).toBeEnabled();
    expect(botao("Corrigir os dados", f)).toBeInTheDocument();
    // a leitura fica parada: nenhum QR é pedido enquanto o aviso vale
    await andar(6000);
    expect(servidor.pedirQrConexao).not.toHaveBeenCalled();
    // o herói continua conferindo, como no passo do QR
    expect(screen.getByRole("img", { name: "Janete, conferindo" })).toBeInTheDocument();

    fireEvent.click(botao(`Usar o ${CONECTADO}`, f));
    await andar(1600);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(2);
    expect(servidor.salvarConexao).toHaveBeenLastCalledWith({
      gateway: "zapi",
      campos: { numero: CONECTADO, instanceId: "inst-1", instanceToken: "tok-1", clientToken: "cli-1" },
    });
    expect(within(f).getByRole("heading", { name: "Tudo certo, WhatsApp conectado." })).toBeInTheDocument();
    expect(servidor.desconectarCelular).not.toHaveBeenCalled();
  });

  it("troca: 'Desconectar e ler de novo' chama o desconectarCelular e volta ao QR, que pede uma imagem nova", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(async () => ({ ok: true })) });
    servidor.salvarConexao.mockResolvedValueOnce(DIFERENTE_SALVAR);
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaZapi();
    fireEvent.click(botao("Conectar", f));
    await andar(1600);
    fireEvent.click(botao("Desconectar e ler de novo", f));
    await andar(400);
    expect(servidor.desconectarCelular).toHaveBeenCalledWith({
      gateway: "zapi",
      campos: { numero: "11 98765-4321", instanceId: "inst-1", instanceToken: "tok-1", clientToken: "cli-1" },
    });
    expect(within(f).queryByRole("heading", { name: TITULO_DIFERENTE })).not.toBeInTheDocument();
    expect(within(f).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    expect(servidor.pedirQrConexao).toHaveBeenCalledWith(expect.objectContaining({ gateway: "zapi", pedir: "qr" }));
    expect(within(f).getByRole("img", { name: ALT })).toHaveAttribute("src", IMAGEM);
    // o passo 1 leva o número informado, formatado
    expect(within(f).getByText(textoInteiro(`Abra o WhatsApp no celular do ${INFORMADO}.`))).toBeInTheDocument();

    // o celular certo lê: a troca salva de novo
    celular.leu = true;
    await andar(3000);
    await andar(1500);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(2);
    expect(within(f).getByRole("heading", { name: "Tudo certo, WhatsApp conectado." })).toBeInTheDocument();
  });

  it("troca: o desconectar recusado mostra o erro e mantém os 2 botões; 'Corrigir os dados' limpa o aviso", async () => {
    const servidor = servidorFalso({
      desconectarCelular: vi.fn(async () => ({ ok: false, erro: "servidor_inacessivel", mensagem: "" })),
    });
    servidor.salvarConexao.mockResolvedValueOnce(DIFERENTE_SALVAR);
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaZapi();
    fireEvent.click(botao("Conectar", f));
    await andar(1600);
    fireEvent.click(botao("Desconectar e ler de novo", f));
    // a resposta chega e a tela redesenha (o act fecha) antes do foco, como no navegador
    await andar(50);
    await andar(350);
    expect(within(f).getByRole("alert")).toHaveTextContent(textoFalhaAcao("servidor_inacessivel"));
    expect(within(f).getByRole("heading", { name: TITULO_DIFERENTE })).toBeInTheDocument();
    expect(botao("Desconectar e ler de novo", f)).toBeEnabled();
    // o foco volta ao botão (o "Desconectando…" travado tirou o foco dele)
    expect(document.activeElement).toBe(botao("Desconectar e ler de novo", f));
    expect(servidor.pedirQrConexao).not.toHaveBeenCalled();

    fireEvent.click(botao("Corrigir os dados", f));
    await andar(400);
    expect(within(f).queryByRole("heading", { name: TITULO_DIFERENTE })).not.toBeInTheDocument();
    expect(within(f).getByLabelText("Número do WhatsApp")).toHaveValue("11 98765-4321");
  });

  // sair do aviso sem escolher desconecta o celular errado que leu o QR desta troca (seção 8, decisão 5)
  const CAMPOS_TROCA = { numero: "11 98765-4321", instanceId: "inst-1", instanceToken: "tok-1", clientToken: "cli-1" };
  const cancelar = () => fireEvent.click(document.getElementById("cfg-fluxo-cancelar")!);

  /** A troca mostra o QR, e o celular que lê é de outro número. */
  async function trocaComOutroNumeroLido(servidor: ReturnType<typeof servidorFalso>): Promise<HTMLElement> {
    servidor.salvarConexao.mockResolvedValueOnce(DESCONECTADA).mockResolvedValueOnce(DIFERENTE_SALVAR);
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaZapi();
    await andar(400);
    fireEvent.click(botao("Conectar", f));
    await andar(1600);
    expect(within(f).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    celular.leu = true;
    await andar(3000);
    await andar(1500);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(2);
    expect(within(f).getByRole("heading", { name: TITULO_DIFERENTE })).toBeInTheDocument();
    return f;
  }

  it("troca: o celular que leu o QR desta troca é de outro número; 'Cancelar' desconecta ele sozinho e fecha", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(async () => ({ ok: true })) });
    await trocaComOutroNumeroLido(servidor);
    cancelar();
    await andar(100);
    expect(fluxo()).toBeNull();
    expect(servidor.desconectarCelular).toHaveBeenCalledTimes(1);
    expect(servidor.desconectarCelular).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS_TROCA });
    // nada foi gravado: a conexão no ar continua a mesma
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(2);
  });

  it("troca: o Esc com o aviso aberto também desconecta o celular errado", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(async () => ({ ok: true })) });
    const f = await trocaComOutroNumeroLido(servidor);
    fireEvent.keyDown(f, { key: "Escape" });
    await andar(100);
    expect(fluxo()).toBeNull();
    expect(servidor.desconectarCelular).toHaveBeenCalledTimes(1);
  });

  it("troca: 'Corrigir os dados' desconecta o celular errado, e o próximo Conectar espera o desconectar", async () => {
    let soltar: (r: { ok: true }) => void = () => {};
    const servidor = servidorFalso({ desconectarCelular: vi.fn(() => new Promise((r) => (soltar = r))) });
    const f = await trocaComOutroNumeroLido(servidor);
    fireEvent.click(botao("Corrigir os dados", f));
    await andar(400);
    expect(within(f).getByLabelText("Número do WhatsApp")).toHaveValue("11 98765-4321");
    expect(servidor.desconectarCelular).toHaveBeenCalledTimes(1);
    expect(servidor.desconectarCelular).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS_TROCA });

    // o Conectar de novo só salva depois que o celular errado saiu da instância
    fireEvent.click(botao("Conectar", f));
    await andar(1600);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(2);
    await act(async () => soltar({ ok: true }));
    await andar(1600);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(3);
    expect(within(f).getByRole("heading", { name: "Tudo certo, WhatsApp conectado." })).toBeInTheDocument();
    expect(servidor.desconectarCelular).toHaveBeenCalledTimes(1);
  });

  it("troca: sair da Configuração com o aviso aberto desconecta o celular errado", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(async () => ({ ok: true })) });
    await trocaComOutroNumeroLido(servidor);
    cleanup();
    await act(async () => {});
    expect(servidor.desconectarCelular).toHaveBeenCalledTimes(1);
  });

  it("troca: a instância já estava conectada com outro número (numero_diferente direto); sair do aviso não desconecta", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(async () => ({ ok: true })) });
    servidor.salvarConexao.mockResolvedValueOnce(DIFERENTE_SALVAR).mockResolvedValueOnce(DIFERENTE_SALVAR);
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaZapi();
    fireEvent.click(botao("Conectar", f));
    await andar(1600);
    expect(within(f).getByRole("heading", { name: TITULO_DIFERENTE })).toBeInTheDocument();
    fireEvent.click(botao("Corrigir os dados", f));
    await andar(400);
    fireEvent.click(botao("Conectar", f));
    await andar(1600);
    expect(within(f).getByRole("heading", { name: TITULO_DIFERENTE })).toBeInTheDocument();
    cancelar();
    await andar(100);
    expect(fluxo()).toBeNull();
    cleanup();
    await act(async () => {});
    expect(servidor.desconectarCelular).not.toHaveBeenCalled();
  });

  it("troca: sair enquanto o 'Usar o …' salva não desconecta o celular escolhido", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(async () => ({ ok: true })) });
    const f = await trocaComOutroNumeroLido(servidor);
    // o salvar do "Usar" fica sem resposta
    servidor.salvarConexao.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(botao(`Usar o ${CONECTADO}`, f));
    await andar(100);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(3);
    cleanup();
    await act(async () => {});
    expect(servidor.desconectarCelular).not.toHaveBeenCalled();
  });

  it("troca: Cancelar com o 'Desconectar e ler de novo' em curso não chama de novo", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(() => new Promise(() => {})) });
    const f = await trocaComOutroNumeroLido(servidor);
    fireEvent.click(botao("Desconectar e ler de novo", f));
    await andar(100);
    cancelar();
    await andar(100);
    expect(fluxo()).toBeNull();
    cleanup();
    await act(async () => {});
    expect(servidor.desconectarCelular).toHaveBeenCalledTimes(1);
  });

  it("troca: o salvar depois da leitura falha e o 'Tentar de novo' acha o outro número: Cancelar desconecta", async () => {
    const servidor = servidorFalso({ desconectarCelular: vi.fn(async () => ({ ok: true })) });
    servidor.salvarConexao
      .mockResolvedValueOnce(DESCONECTADA)
      .mockResolvedValueOnce({ ok: false, erro: "servidor_inacessivel", mensagem: "" })
      .mockResolvedValueOnce(DIFERENTE_SALVAR);
    montar(CONEXAO, servidor);
    await carregar();
    const f = trocarParaZapi();
    await andar(400);
    fireEvent.click(botao("Conectar", f));
    await andar(1600);
    celular.leu = true;
    await andar(3000);
    await andar(1500);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(2);
    fireEvent.click(botao("Tentar de novo", f));
    await andar(1600);
    expect(servidor.salvarConexao).toHaveBeenCalledTimes(3);
    expect(within(f).getByRole("heading", { name: TITULO_DIFERENTE })).toBeInTheDocument();
    cancelar();
    await andar(100);
    expect(servidor.desconectarCelular).toHaveBeenCalledTimes(1);
    expect(servidor.desconectarCelular).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS_TROCA });
  });

  it("conserto: o número salvo entra no passo 1 do QR do cartão", async () => {
    montar(CAIDA_COM_NUMERO);
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    expect(within(cartao()).getByText(textoInteiro(`Abra o WhatsApp no celular do ${SALVO}.`))).toBeInTheDocument();
  });

  it("conserto: o celular de outro número reabre o QR no cartão, com o aviso, e pede um QR novo", async () => {
    const servidor = servidorFalso();
    // a conferência desconecta o celular errado: a próxima consulta já não vê ele
    servidor.conferirConexao.mockImplementation(async () => {
      celular.leu = false;
      return DIFERENTE_CONSERTO;
    });
    montar(CAIDA_COM_NUMERO, servidor);
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    expect(within(cartao()).queryByText(MSG_CONSERTO)).not.toBeInTheDocument();
    const pedidos = servidor.pedirQrConexaoGuardada.mock.calls.length;

    celular.leu = true;
    await andar(3000);
    await andar(400);
    await carregar();
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(1);
    const titulo = within(cartao()).getByRole("heading", { level: 3, name: TITULO_QR });
    expect(titulo).toHaveAttribute("id", "cfg-qr-titulo");
    expect(document.activeElement).toBe(titulo);
    expect(within(cartao()).getByText(MSG_CONSERTO)).toBeInTheDocument();
    expect(servidor.pedirQrConexaoGuardada.mock.calls.length).toBeGreaterThan(pedidos + 1);
    expect(within(cartao()).getByRole("img", { name: ALT })).toHaveAttribute("src", IMAGEM);
    // nada de "conectado"
    expect(screen.queryByText("WhatsApp conectado. A Janete voltou a atender.")).not.toBeInTheDocument();

    // "Cancelar" fecha o QR e o aviso some; abrir de novo vem sem ele
    fireEvent.click(botao("Cancelar", cartao()));
    await andar(100);
    expect(screen.queryByText(MSG_CONSERTO)).not.toBeInTheDocument();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    expect(within(cartao()).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();
    expect(within(cartao()).queryByText(MSG_CONSERTO)).not.toBeInTheDocument();
  });

  it("conserto: sem como reabrir o QR (a releitura não traz o número caído), a frase vai pelo aviso rápido", async () => {
    const servidor = servidorFalso();
    servidor.conferirConexao.mockResolvedValue(DIFERENTE_CONSERTO);
    montar({ ...CAIDA_COM_NUMERO, status: "erro", ultimo_erro: "credencial_invalida" }, servidor);
    await carregar();
    fireEvent.click(botao("Conferir de novo", cartao()));
    await andar(400);
    await carregar();
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(1);
    // espera a releitura trazer o "desconectada" que o servidor gravou; aqui ela não traz
    expect(screen.queryByText(MSG_CONSERTO)).not.toBeInTheDocument();
    await andar(8000);
    expect(screen.getAllByText(MSG_CONSERTO).length).toBeGreaterThan(0);
    expect(within(cartao()).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById("cfg-h-whats"));
  });

  it("conserto: o QR fecha porque a conexão voltou (tempo real), e a conferência acha outro número: o QR reabre com o aviso", async () => {
    const servidor = servidorFalso();
    const banco: { b: { conexao: Record<string, unknown> } | null } = { b: null };
    // o servidor desconecta o celular errado e grava "desconectada"
    servidor.conferirConexao.mockImplementation(async () => {
      celular.leu = false;
      banco.b!.conexao = CAIDA_COM_NUMERO;
      return DIFERENTE_CONSERTO;
    });
    const { b, qc } = montar(CAIDA_COM_NUMERO, servidor);
    banco.b = b;
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    expect(within(cartao()).getByRole("heading", { name: TITULO_QR })).toBeInTheDocument();

    // o webhook grava "conectada" (o celular errado leu) antes da próxima consulta do QR
    b.conexao = COM_NUMERO;
    await act(async () => {
      await qc.invalidateQueries();
    });
    await carregar();
    await andar(400);
    await carregar();
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(1);
    const titulo = within(cartao()).getByRole("heading", { level: 3, name: TITULO_QR });
    expect(within(cartao()).getByText(MSG_CONSERTO)).toBeInTheDocument();
    await andar(400);
    expect(document.activeElement).toBe(titulo);
    expect(screen.queryByText("WhatsApp conectado. A Janete voltou a atender.")).not.toBeInTheDocument();
  });

  it("conserto: o celular errado não saiu (desconectado false): o QR não reabre, e nada entra em laço", async () => {
    const MSG_NAO_SAIU =
      "Um celular de outro número leu o QR code, e a Janete não conseguiu desconectar ele. Desconecte pelo celular e leia o QR code de novo.";
    const servidor = servidorFalso();
    servidor.conferirConexao.mockResolvedValue({ ...DIFERENTE_CONSERTO, desconectado: false, mensagem: MSG_NAO_SAIU });
    montar(CAIDA_COM_NUMERO, servidor);
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    // o celular errado lê, e continua lá
    celular.leu = true;
    await andar(3000);
    await andar(400);
    await carregar();
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(MSG_NAO_SAIU).length).toBeGreaterThan(0);
    expect(within(cartao()).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.getElementById("cfg-conserto-w"));
    await andar(10_000);
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(1);

    // pedir o QR de novo à mão confere uma vez só
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(3400);
    await carregar();
    await andar(10_000);
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(2);
    expect(within(cartao()).queryByRole("heading", { name: TITULO_QR })).not.toBeInTheDocument();
  });

  it("conserto: o alerta do cartão já diz o motivo: o QR reaberto não repete o aviso", async () => {
    const servidor = servidorFalso();
    const banco: { b: { conexao: Record<string, unknown> } | null } = { b: null };
    servidor.conferirConexao.mockImplementation(async () => {
      celular.leu = false;
      banco.b!.conexao = { ...CAIDA_COM_NUMERO, ultimo_erro: "numero_diferente" };
      return DIFERENTE_CONSERTO;
    });
    const { b } = montar(CAIDA_COM_NUMERO, servidor);
    banco.b = b;
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    celular.leu = true;
    await andar(3000);
    await andar(400);
    await carregar();
    expect(within(cartao()).getByRole("heading", { level: 3, name: TITULO_QR })).toBeInTheDocument();
    expect(within(cartao()).getAllByRole("alert")).toHaveLength(1);
    expect(within(cartao()).getByRole("alert")).toHaveTextContent(textoFalhaAcao("numero_diferente"));
    expect(within(cartao()).queryByText(MSG_CONSERTO)).not.toBeInTheDocument();
  });

  it("conserto sem a frase do servidor: o aviso cita os 2 números", async () => {
    const servidor = servidorFalso();
    servidor.conferirConexao.mockImplementation(async () => {
      celular.leu = false;
      return { ...DIFERENTE_CONSERTO, mensagem: "" };
    });
    montar(CAIDA_COM_NUMERO, servidor);
    await carregar();
    fireEvent.click(botao("Mostrar o QR code", cartao()));
    await andar(400);
    celular.leu = true;
    await andar(3000);
    await andar(400);
    await carregar();
    expect(
      within(cartao()).getByText(textoInteiro(new RegExp(`^Este celular é do \\${CONECTADO}, não do \\${SALVO} desta conexão`))),
    ).toBeInTheDocument();
  });

  it("'Testar a conexão agora' com o celular de outro número mostra a frase do servidor", async () => {
    const servidor = servidorFalso();
    servidor.conferirConexao.mockResolvedValueOnce(DIFERENTE_CONSERTO);
    montar(COM_NUMERO, servidor);
    await carregar();
    fireEvent.click(botao("Testar a conexão agora", cartao()));
    await andar(400);
    expect(servidor.conferirConexao).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(MSG_CONSERTO).length).toBeGreaterThan(0);
    expect(screen.queryByText(/não confirmou a conexão/)).not.toBeInTheDocument();
    expect(textoFalhaAcao("numero_diferente", MSG_CONSERTO)).toBe(MSG_CONSERTO);
  });

  it("'Colar os dados de novo' na Z-API e na Evolution traz o número salvo; a troca para outra conexão não", async () => {
    montar(CAIDA_COM_NUMERO);
    await carregar();
    fireEvent.click(botao("Colar os dados de novo", cartao()));
    await andar(400);
    let f = fluxo()!;
    expect(within(f).getByLabelText("Número do WhatsApp")).toHaveValue(SALVO);
    expect(within(f).getByLabelText("ID da instância")).toHaveValue("");
    cleanup();

    montar({ ...CAIDA_COM_NUMERO, gateway: "evolution", id_externo: "vendas" });
    await carregar();
    fireEvent.click(botao("Colar os dados de novo", cartao()));
    await andar(400);
    f = fluxo()!;
    expect(within(f).getByLabelText("Número do WhatsApp")).toHaveValue(SALVO);
    expect(within(f).getByLabelText("Nome da instância (opcional)")).toHaveValue("vendas");
    cleanup();

    // nome antigo (sem o número formatado): nada a preencher
    montar(CAIDA);
    await carregar();
    fireEvent.click(botao("Colar os dados de novo", cartao()));
    await andar(400);
    expect(within(fluxo()!).getByLabelText("Número do WhatsApp")).toHaveValue("");
    cleanup();

    montar(COM_NUMERO);
    await carregar();
    fireEvent.click(botao("Trocar de WhatsApp", cartao()));
    f = fluxo()!;
    fireEvent.click(within(f).getByRole("button", { name: /^Não oficial/ }));
    fireEvent.click(within(f).getByRole("button", { name: /^Z-API/ }));
    expect(within(f).getByLabelText("Número do WhatsApp")).toHaveValue("");
  });
});
