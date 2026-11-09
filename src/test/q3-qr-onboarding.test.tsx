import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EtapaConexao } from "@/features/onboarding/conexao";
import { TEMPO_VOLTA_DISCO_MS, TEXTOS_QR, tempoVoltaDisco } from "@/features/onboarding/conexao/qr/PassoQr";
import { limparEstadoOnboarding, lerEstadoOnboarding } from "@/features/onboarding/estado";
import { MENSAGEM_SEM_RESPOSTA, consumirDesdobra } from "@/features/onboarding/lista";
import { PalcoContexto } from "@/features/onboarding/palco";
import type { ResultadoSalvarConexao } from "@/features/mensageria/configuracao.functions";
import type {
  EntradaDesconectarCelular,
  EntradaQr,
  ResultadoDesconectarCelularConexao,
  ResultadoPedirQr,
} from "@/features/mensageria/qr.functions";
import { ProvedorDadosOnboarding, criarDadosOnboardingMemoria } from "@/features/plataforma/dados/onboarding";

// Q3 (spec-qr-whatsapp, task C1): o passo do QR code no onboarding (EtapaConexao), com a Z-API e a
// Evolution desconectadas. Mesmo molde do c2-conexao: dados em memória, palco e voo de mentira.

const getSession = vi.fn();

/**
 * O elemento cujo texto inteiro é este: os números formatados ficam num trecho próprio, que não
 * quebra no meio da linha, então o texto se divide em mais de um nó.
 */
const textoInteiro = (t: string) => (_: string, el: Element | null) =>
  !!el && el.textContent === t && !Array.from(el.children).some((f) => f.textContent === t);
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getSession: () => getSession() } } }));

const voo = {
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
};
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return { ...real, useVooJanete: () => voo };
});

const janeteNoPalco = vi.fn();
const anunciar = vi.fn();
const recolherBarra = vi.fn();

const salvarConexao = vi.fn<(e: { gateway: string; campos: Record<string, string> }) => Promise<ResultadoSalvarConexao>>();
const pedirQr = vi.fn<(e: EntradaQr) => Promise<ResultadoPedirQr>>();
const desconectarCelular = vi.fn<(e: EntradaDesconectarCelular) => Promise<ResultadoDesconectarCelularConexao>>();

const DESCONECTADA: ResultadoSalvarConexao = {
  ok: false,
  erro: "instancia_desconectada",
  mensagem: "A instância da Z-API não está conectada. Leia o QR code no painel da Z-API.",
};
const SALVA: ResultadoSalvarConexao = {
  ok: true,
  conexao_id: "conexao-teste",
  nome: "+55 11 91234-5678",
  gateway: "zapi",
  url_webhook: "https://app.teste/api/public/whatsapp/zapi/conexao-teste",
  avisos: [],
};
const ANUNCIO_QR = "Falta ler o QR code com o WhatsApp do celular.";

/** Um servidor de mentira para o pedirQr: cada "qr" devolve uma imagem nova; `conectado` vira quando o teste mandar. */
let conectado = false;
let passkey = false;
let nImagem = 0;
function pedirPadrao(e: EntradaQr): Promise<ResultadoPedirQr> {
  if (conectado) return Promise.resolve({ ok: true, conectado: true, rotulo: "+55 11 91234-5678" });
  if (e.pedir === "situacao") return Promise.resolve({ ok: true, conectado: false, qr: null, passkey: false });
  if (passkey) return Promise.resolve({ ok: true, conectado: false, qr: null, passkey: true });
  return Promise.resolve({ ok: true, conectado: false, qr: `data:image/png;base64,UVIx${++nImagem}`, passkey: false });
}

function montar() {
  const dados = criarDadosOnboardingMemoria({ salvarConexao, pedirQr, desconectarCelular });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <ProvedorDadosOnboarding dados={dados}>
      <PalcoContexto.Provider value={{ janeteNoPalco, anunciar, recolherBarra }}>{children}</PalcoContexto.Provider>
    </ProvedorDadosOnboarding>
  );
  return render(<EtapaConexao avancar={vi.fn()} voltar={() => {}} />, { wrapper: envoltorio });
}

/** Avança o relógio em passos curtos: cada passo pinta e roda os efeitos, como o navegador. */
async function passar(ms: number, passo = 20) {
  for (let feito = 0; feito < ms; feito += passo) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(passo, ms - feito));
    });
  }
}

function preencher(id: string, valor: string) {
  fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value: valor } });
}

async function abrirProvedor(modo: "Oficial" | "Não oficial", nome: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${modo}`) }));
  await passar(10);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${nome}`) }));
  await passar(500);
}

const conectar = (gateway: string) => document.getElementById(`btn-conectar-${gateway}`) as HTMLButtonElement;
const valor = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
const tituloQr = () => screen.queryByRole("heading", { level: 2, name: TEXTOS_QR.titulo });

// o número do WhatsApp é o 1º campo, obrigatório (spec-qr-whatsapp, seção 8)
const CAMPOS_ZAPI = { numero: "11 98765-4321", instanceId: "3C2A99", instanceToken: "tokenDaInstancia55", clientToken: "clienteToken44" };
const CAMPOS_EVOLUTION = { numero: "11 98765-4321", serverUrl: "https://evo.exemplo.com.br", instanceName: "vendas", apiKey: "evoChaveSecreta12" };

/** Abre a Z-API, cola os campos e clica em Conectar; a resposta é a de `salvarConexao` no momento. */
async function conectarZapi() {
  montar();
  await abrirProvedor("Não oficial", "Z-API");
  for (const [id, v] of Object.entries(CAMPOS_ZAPI)) preencher(`f-zapi-${id}`, v);
  fireEvent.click(conectar("zapi"));
  // a animação mínima do giro (como no c2) e o primeiro QR
  await passar(4500);
}

/** Um QR na tela: o src da imagem com o alt do passo. */
const imagemQr = () => screen.queryByRole("img", { name: TEXTOS_QR.alt }) as HTMLImageElement | null;

let matchMediaOriginal: typeof window.matchMedia;

beforeEach(() => {
  vi.useFakeTimers();
  limparEstadoOnboarding();
  salvarConexao.mockReset();
  pedirQr.mockReset();
  pedirQr.mockImplementation(pedirPadrao);
  desconectarCelular.mockReset();
  conectado = false;
  passkey = false;
  nImagem = 0;
  janeteNoPalco.mockReset();
  anunciar.mockReset();
  voo.ativo = false;
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
  consumirDesdobra();
  matchMediaOriginal = window.matchMedia;
});
afterEach(() => {
  window.matchMedia = matchMediaOriginal;
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("Onboarding: passo do QR code (Z-API)", () => {
  it("a Z-API desconectada mostra o QR, as instruções e a linha viva; o foco vai ao título e o anúncio sai uma vez", async () => {
    salvarConexao.mockResolvedValue(DESCONECTADA);
    await conectarZapi();

    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "qr");
    expect(tituloQr()).toBeInTheDocument();
    expect(tituloQr()).toHaveFocus();
    expect(screen.getByText(TEXTOS_QR.estadoPalco)).toBeInTheDocument();
    // a mensagem de erro da instância desconectada não aparece: o passo toma o lugar dela
    expect(screen.queryByText("Não conectou")).toBeNull();
    expect(imagemQr()?.src).toBe("data:image/png;base64,UVIx1");
    // o passo 1 leva o número informado, formatado (seção 8); os outros dois, como sempre
    expect(screen.getByText(textoInteiro(TEXTOS_QR.passo1ComNumero("+55 11 98765-4321")))).toBeInTheDocument();
    for (const t of TEXTOS_QR.passos.slice(1)) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS_QR.passos[0])).toBeNull();
    expect(screen.getByText(TEXTOS_QR.esperando)).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();

    // o pedido leva o gateway e os campos lidos no Conectar
    expect(pedirQr).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI, pedir: "qr" });
    expect(anunciar.mock.calls.filter(([t]) => t === ANUNCIO_QR)).toHaveLength(1);

    // consulta a situação a cada 3 s, sem anunciar de novo
    await passar(3100);
    expect(pedirQr).toHaveBeenLastCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI, pedir: "situacao" });
    expect(anunciar.mock.calls.filter(([t]) => t === ANUNCIO_QR)).toHaveLength(1);
    // nada foi gravado ainda
    expect(salvarConexao).toHaveBeenCalledTimes(1);
    expect(lerEstadoOnboarding().conexao.rotulo).toBeNull();
  });

  it("o celular conecta: chama a salvarConexao de novo com os mesmos campos e mostra o 'Tudo certo'", async () => {
    salvarConexao.mockResolvedValueOnce(DESCONECTADA).mockResolvedValue(SALVA);
    await conectarZapi();
    expect(tituloQr()).toBeInTheDocument();

    conectado = true;
    // a consulta (3 s) e a volta do quadro ao círculo
    await passar(3100 + TEMPO_VOLTA_DISCO_MS);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    expect(salvarConexao.mock.calls[1]![0]).toEqual({ gateway: "zapi", campos: CAMPOS_ZAPI });
    await passar(4500);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher o cérebro" })).toHaveFocus();
    expect(lerEstadoOnboarding().conexao).toEqual({ modo: "naooficial", gateway: "zapi", rotulo: "+55 11 91234-5678" });
    // as credenciais saíram da tela
    expect(valor("f-zapi-instanceToken")).toBe("");

    // a leitura parou: nenhum pedido novo depois do sucesso
    const pedidos = pedirQr.mock.calls.length;
    await passar(10_000, 500);
    expect(pedirQr).toHaveBeenCalledTimes(pedidos);
  });

  it("conecta, mas o Conectar volta 'desconectada' de novo: o passo do QR reaparece", async () => {
    salvarConexao.mockResolvedValue(DESCONECTADA);
    await conectarZapi();
    conectado = true;
    await passar(3100 + TEMPO_VOLTA_DISCO_MS);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    conectado = false;
    await passar(4500);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "qr");
    expect(imagemQr()).not.toBeNull();
  });

  it("'Corrigir os dados' volta aos campos ainda preenchidos, com o foco no Conectar, e para a leitura", async () => {
    salvarConexao.mockResolvedValue(DESCONECTADA);
    await conectarZapi();
    fireEvent.click(screen.getByRole("button", { name: "Corrigir os dados" }));
    await passar(400);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "form");
    expect(tituloQr()).toBeNull();
    for (const [id, v] of Object.entries(CAMPOS_ZAPI)) expect(valor(`f-zapi-${id}`)).toBe(v);
    expect(conectar("zapi")).toBeEnabled();
    expect(conectar("zapi")).toHaveFocus();

    const pedidos = pedirQr.mock.calls.length;
    await passar(10_000, 500);
    expect(pedirQr).toHaveBeenCalledTimes(pedidos);
  });

  it("'Corrigir os dados' com movimento reduzido (do qr direto ao form): o foco volta ao campo vazio", async () => {
    window.matchMedia = ((query: string) => ({
      ...matchMediaOriginal(query),
      matches: query.includes("reduce"),
    })) as typeof window.matchMedia;
    salvarConexao.mockResolvedValue(DESCONECTADA);
    await conectarZapi();
    expect(tituloQr()).toBeInTheDocument();
    // a pessoa apaga um campo pelo caminho: o foco tem de ir para ele
    preencher("f-zapi-clientToken", "");
    fireEvent.click(screen.getByRole("button", { name: "Corrigir os dados" }));
    await passar(200);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "form");
    expect(document.getElementById("f-zapi-clientToken")).toHaveFocus();
    expect(valor("f-zapi-instanceToken")).toBe(CAMPOS_ZAPI.instanceToken);
  });

  it("3 QRs sem leitura: 'O QR code expirou' e 'Gerar outro QR code' recomeça", async () => {
    salvarConexao.mockResolvedValue(DESCONECTADA);
    await conectarZapi();
    expect(imagemQr()?.src).toBe("data:image/png;base64,UVIx1");
    await passar(20_000, 250);
    expect(imagemQr()?.src).toBe("data:image/png;base64,UVIx2");
    await passar(20_000, 250);
    expect(imagemQr()?.src).toBe("data:image/png;base64,UVIx3");
    await passar(21_000, 250);
    expect(screen.getByText(TEXTOS_QR.expirado)).toBeInTheDocument();
    const pedidos = pedirQr.mock.calls.length;
    await passar(10_000, 500);
    expect(pedirQr).toHaveBeenCalledTimes(pedidos);
    expect(anunciar.mock.calls.filter(([t]) => t === ANUNCIO_QR)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_QR.gerarOutro }));
    await passar(100);
    expect(pedirQr).toHaveBeenLastCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI, pedir: "qr" });
    expect(imagemQr()?.src).toBe("data:image/png;base64,UVIx4");
    expect(screen.queryByText(TEXTOS_QR.expirado)).toBeNull();
  });

  it("passkey: mostra o aviso da chave de acesso e segue consultando até conectar", async () => {
    passkey = true;
    salvarConexao.mockResolvedValueOnce(DESCONECTADA).mockResolvedValue(SALVA);
    await conectarZapi();
    expect(screen.getByRole("heading", { level: 2, name: TEXTOS_QR.passkeyTitulo })).toBeInTheDocument();
    expect(screen.getByText(TEXTOS_QR.passkeyTexto)).toBeInTheDocument();
    expect(imagemQr()).toBeNull();

    await passar(3100);
    expect(pedirQr).toHaveBeenLastCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI, pedir: "situacao" });
    conectado = true;
    await passar(3100 + TEMPO_VOLTA_DISCO_MS);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    await passar(4500);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
  });

  it("depois do 'conectado', o salvar espera o quadro voltar ao círculo (tempoVoltaDisco)", async () => {
    salvarConexao.mockResolvedValueOnce(DESCONECTADA).mockResolvedValue(SALVA);
    await conectarZapi();
    expect(tempoVoltaDisco()).toBe(TEMPO_VOLTA_DISCO_MS);
    conectado = true;
    const antes = pedirQr.mock.calls.length;
    // anda até a consulta que vê o celular conectado
    for (let i = 0; i < 300 && pedirQr.mock.calls.length === antes; i++) await passar(10, 10);
    expect(pedirQr.mock.calls.length).toBe(antes + 1);
    expect(salvarConexao).toHaveBeenCalledTimes(1);
    await passar(TEMPO_VOLTA_DISCO_MS - 60);
    expect(salvarConexao).toHaveBeenCalledTimes(1);
    await passar(120);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
  });

  it("com movimento reduzido, o salvar sai logo depois do 'conectado'", async () => {
    window.matchMedia = ((query: string) => ({
      ...matchMediaOriginal(query),
      matches: query.includes("reduce"),
    })) as typeof window.matchMedia;
    salvarConexao.mockResolvedValueOnce(DESCONECTADA).mockResolvedValue(SALVA);
    await conectarZapi();
    expect(tempoVoltaDisco()).toBe(0);
    conectado = true;
    const antes = pedirQr.mock.calls.length;
    for (let i = 0; i < 300 && pedirQr.mock.calls.length === antes; i++) await passar(10, 10);
    await passar(20);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
  });

  it("a falha definitiva do pedido aparece no passo, com 'Tentar de novo'", async () => {
    salvarConexao.mockResolvedValue(DESCONECTADA);
    pedirQr.mockResolvedValue({ ok: false, erro: "sem_acesso" });
    await conectarZapi();
    expect(screen.getByRole("button", { name: TEXTOS_QR.tentarDeNovo })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();
    expect(imagemQr()).toBeNull();
  });
});

describe("Onboarding: o celular de outro número leu o QR (seção 8)", () => {
  const CONECTADO = "+55 21 99876-5432";
  const INFORMADO = "+55 11 98765-4321";
  const DIFERENTE: ResultadoSalvarConexao = {
    ok: false,
    erro: "numero_diferente",
    numero_conectado: CONECTADO,
    numero_informado: INFORMADO,
    mensagem: `Este celular é do ${CONECTADO}, não do ${INFORMADO} que você informou.`,
  };
  const ANUNCIO_DIFERENTE = "O celular conectado é de outro número.";
  const tituloDiferente = () => screen.queryByRole("heading", { level: 2, name: TEXTOS_QR.diferenteTitulo });
  const botaoUsar = () => screen.queryByRole("button", { name: TEXTOS_QR.usarConectado(CONECTADO) });
  const botaoDesconectar = () => screen.queryByRole("button", { name: TEXTOS_QR.desconectar });

  /** Do QR ao "outro número": o celular lê, e o Conectar volta numero_diferente. */
  async function chegarAoDiferente() {
    salvarConexao.mockResolvedValueOnce(DESCONECTADA).mockResolvedValueOnce(DIFERENTE).mockResolvedValue(SALVA);
    await conectarZapi();
    conectado = true;
    await passar(3100 + TEMPO_VOLTA_DISCO_MS);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    // a instância segue conectada (com o outro celular) até alguém desconectar
    await passar(4500);
  }

  it("mostra o passo com a frase e os 2 botões; o foco vai ao título, o anúncio sai uma vez e a leitura para", async () => {
    await chegarAoDiferente();
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "qr");
    expect(tituloDiferente()).toBeInTheDocument();
    expect(tituloDiferente()).toHaveFocus();
    expect(screen.getByText(textoInteiro(TEXTOS_QR.diferenteTexto(CONECTADO, INFORMADO)))).toHaveAttribute("aria-live", "polite");
    expect(botaoUsar()).toBeEnabled();
    expect(botaoDesconectar()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();
    expect(screen.queryByText("Não conectou")).toBeNull();
    expect(imagemQr()).toBeNull();
    expect(anunciar.mock.calls.filter(([t]) => t === ANUNCIO_DIFERENTE)).toHaveLength(1);
    // o anúncio do QR saiu só na primeira entrada
    expect(anunciar.mock.calls.filter(([t]) => t === ANUNCIO_QR)).toHaveLength(1);
    // nada foi gravado
    expect(lerEstadoOnboarding().conexao.rotulo).toBeNull();

    // com o outro número, ninguém consulta a situação (o aoConectar chamaria o salvar de novo)
    const pedidos = pedirQr.mock.calls.length;
    await passar(10_000, 500);
    expect(pedirQr).toHaveBeenCalledTimes(pedidos);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    expect(anunciar.mock.calls.filter(([t]) => t === ANUNCIO_DIFERENTE)).toHaveLength(1);
  });

  it("'Usar o +55 21 …' salva de novo com o número conectado no campo do número", async () => {
    await chegarAoDiferente();
    fireEvent.click(botaoUsar()!);
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(3);
    expect(salvarConexao.mock.calls[2]![0]).toEqual({ gateway: "zapi", campos: { ...CAMPOS_ZAPI, numero: CONECTADO } });
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
    expect(tituloDiferente()).toBeNull();
    expect(desconectarCelular).not.toHaveBeenCalled();
  });

  it("'Desconectar e ler de novo' chama o desconectarCelular com os campos do alvo e volta a pedir o QR", async () => {
    await chegarAoDiferente();
    let soltar: (r: ResultadoDesconectarCelularConexao) => void = () => {};
    desconectarCelular.mockImplementation(() => new Promise((r) => (soltar = r)));
    conectado = false;
    const pedidos = pedirQr.mock.calls.length;
    fireEvent.click(botaoDesconectar()!);
    await passar(20);
    expect(desconectarCelular).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI });
    // enquanto desconecta: o botão diz "Desconectando…" e o "Usar" fica desligado
    expect(screen.getByRole("button", { name: TEXTOS_QR.desconectando })).toBeInTheDocument();
    expect(botaoUsar()).toBeDisabled();

    await act(async () => soltar({ ok: true }));
    await passar(200);
    expect(tituloDiferente()).toBeNull();
    expect(tituloQr()).toBeInTheDocument();
    expect(pedirQr.mock.calls.length).toBeGreaterThan(pedidos);
    expect(pedirQr).toHaveBeenLastCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI, pedir: "qr" });
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "qr");
    expect(imagemQr()).not.toBeNull();
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
  });

  it("a recusa do desconectar aparece no passo; os botões continuam", async () => {
    await chegarAoDiferente();
    desconectarCelular.mockResolvedValue({ ok: false, erro: "servidor_inacessivel", mensagem: "Não conseguimos falar com a Z-API." });
    fireEvent.click(botaoDesconectar()!);
    await passar(100);
    expect(screen.getByRole("alert")).toHaveTextContent("Não conseguimos falar com a Z-API.");
    expect(tituloDiferente()).toBeInTheDocument();
    expect(botaoDesconectar()).toBeEnabled();
    expect(botaoUsar()).toBeEnabled();
    // o "Desconectando…" travado tirou o foco do botão: ele volta para lá, e não para o body
    expect(botaoDesconectar()).toHaveFocus();
  });

  it("a rejeição do desconectar mostra a mensagem de sem resposta", async () => {
    await chegarAoDiferente();
    desconectarCelular.mockRejectedValue(new Error("rede"));
    fireEvent.click(botaoDesconectar()!);
    await passar(100);
    expect(screen.getByRole("alert")).toHaveTextContent(MENSAGEM_SEM_RESPOSTA);
    expect(tituloDiferente()).toBeInTheDocument();
    expect(botaoDesconectar()).toHaveFocus();
  });

  it("a rejeição do desconectar com a sessão encerrada: o erro da sessão, com 'Entrar de novo'", async () => {
    await chegarAoDiferente();
    desconectarCelular.mockRejectedValue(new Error("sem sessão"));
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    fireEvent.click(botaoDesconectar()!);
    await passar(300);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "erro");
    expect(screen.getByRole("button", { name: "Entrar de novo" })).toBeInTheDocument();
    expect(tituloDiferente()).toBeNull();
    expect(screen.queryByText(MENSAGEM_SEM_RESPOSTA)).toBeNull();
  });

  it("sem acesso no desconectar: o erro da sessão encerrada, com 'Entrar de novo'", async () => {
    await chegarAoDiferente();
    desconectarCelular.mockResolvedValue({ ok: false, erro: "sem_acesso" });
    fireEvent.click(botaoDesconectar()!);
    await passar(300);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "erro");
    expect(screen.getByRole("button", { name: "Entrar de novo" })).toBeInTheDocument();
    expect(tituloDiferente()).toBeNull();
  });

  it("'Corrigir os dados' sai do outro número e volta aos campos", async () => {
    await chegarAoDiferente();
    fireEvent.click(screen.getByRole("button", { name: "Corrigir os dados" }));
    await passar(400);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "form");
    expect(tituloDiferente()).toBeNull();
    expect(valor("f-zapi-numero")).toBe(CAMPOS_ZAPI.numero);
  });

  // sair do aviso sem escolher desconecta o celular errado que leu o QR desta tela (seção 8, decisão 5)
  const corrigirDados = () => fireEvent.click(screen.getByRole("button", { name: "Corrigir os dados" }));

  it("'Corrigir os dados' desconecta sozinho o celular que leu o QR desta tela, e o próximo Conectar espera o desconectar", async () => {
    await chegarAoDiferente();
    let soltar: (r: ResultadoDesconectarCelularConexao) => void = () => {};
    desconectarCelular.mockImplementation(() => new Promise((r) => (soltar = r)));
    corrigirDados();
    await passar(400);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "form");
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
    expect(desconectarCelular).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI });

    // o Conectar de novo só salva depois que o celular errado saiu da instância
    fireEvent.click(conectar("zapi"));
    await passar(1000);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    await act(async () => soltar({ ok: true }));
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
  });

  it("a falha do desconectar na saída não aparece e não trava o próximo Conectar", async () => {
    await chegarAoDiferente();
    desconectarCelular.mockRejectedValue(new Error("rede"));
    corrigirDados();
    await passar(400);
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(conectar("zapi"));
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
  });

  it("a instância já estava conectada com outro número (o Conectar volta numero_diferente direto): 'Corrigir os dados' não desconecta", async () => {
    salvarConexao.mockResolvedValueOnce(DIFERENTE).mockResolvedValue(SALVA);
    await conectarZapi();
    expect(tituloDiferente()).toBeInTheDocument();
    corrigirDados();
    await passar(400);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "form");
    expect(desconectarCelular).not.toHaveBeenCalled();
  });

  it("depois do 'Desconectar e ler de novo', o celular errado que ler o QR desta tela sai sozinho no 'Corrigir os dados'", async () => {
    // a instância já estava conectada com outro número; o botão tira ele, e outro celular errado lê
    salvarConexao.mockResolvedValueOnce(DIFERENTE).mockResolvedValueOnce(DIFERENTE).mockResolvedValue(SALVA);
    await conectarZapi();
    desconectarCelular.mockResolvedValue({ ok: true });
    fireEvent.click(botaoDesconectar()!);
    await passar(200);
    expect(tituloQr()).toBeInTheDocument();
    conectado = true;
    await passar(3100 + TEMPO_VOLTA_DISCO_MS);
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    expect(tituloDiferente()).toBeInTheDocument();
    corrigirDados();
    await passar(400);
    expect(desconectarCelular).toHaveBeenCalledTimes(2);
  });

  it("com o 'Desconectar e ler de novo' em curso, 'Corrigir os dados' não chama de novo, e o próximo Conectar espera o do botão", async () => {
    await chegarAoDiferente();
    let soltar: (r: ResultadoDesconectarCelularConexao) => void = () => {};
    desconectarCelular.mockImplementation(() => new Promise((r) => (soltar = r)));
    fireEvent.click(botaoDesconectar()!);
    await passar(20);
    corrigirDados();
    await passar(400);
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
    fireEvent.click(conectar("zapi"));
    await passar(1000);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    await act(async () => soltar({ ok: true }));
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(3);
  });

  it("'Usar o …' não desconecta nada, nem ao sair da etapa", async () => {
    await chegarAoDiferente();
    fireEvent.click(botaoUsar()!);
    await passar(4500);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
    cleanup();
    await passar(20);
    expect(desconectarCelular).not.toHaveBeenCalled();
  });

  it("sair da etapa com o aviso aberto desconecta o celular errado", async () => {
    await chegarAoDiferente();
    desconectarCelular.mockResolvedValue({ ok: true });
    cleanup();
    await passar(20);
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
    expect(desconectarCelular).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI });
  });

  it("sair da etapa enquanto o 'Usar o …' salva não desconecta o celular escolhido", async () => {
    await chegarAoDiferente();
    // o salvar do "Usar" fica sem resposta
    salvarConexao.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(botaoUsar()!);
    await passar(100);
    expect(salvarConexao).toHaveBeenCalledTimes(3);
    cleanup();
    await passar(20);
    expect(desconectarCelular).not.toHaveBeenCalled();
  });

  it("o aviso que veio direto do Conectar e a saída da etapa: não desconecta", async () => {
    salvarConexao.mockResolvedValueOnce(DIFERENTE).mockResolvedValue(SALVA);
    await conectarZapi();
    expect(tituloDiferente()).toBeInTheDocument();
    cleanup();
    await passar(20);
    expect(desconectarCelular).not.toHaveBeenCalled();
  });

  it("uma falha síncrona do desconectar na saída não corta o 'Corrigir os dados'", async () => {
    await chegarAoDiferente();
    desconectarCelular.mockImplementation(() => {
      throw new Error("quebrou");
    });
    corrigirDados();
    await passar(400);
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "form");
    expect(tituloDiferente()).toBeNull();
    fireEvent.click(conectar("zapi"));
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
  });

  /** O QR desta tela é lido, e o salvar automático falha: o palco do erro. */
  async function leituraComFalhaNoSalvar() {
    salvarConexao
      .mockResolvedValueOnce(DESCONECTADA)
      .mockResolvedValueOnce({ ok: false, erro: "servidor_inacessivel", mensagem: "Não conseguimos falar com a Z-API agora." })
      .mockResolvedValueOnce(DIFERENTE)
      .mockResolvedValue(SALVA);
    await conectarZapi();
    conectado = true;
    await passar(3100 + TEMPO_VOLTA_DISCO_MS);
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(2);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "erro");
  }

  it("o salvar depois da leitura falha e o 'Tentar de novo' acha o outro número: 'Corrigir os dados' desconecta", async () => {
    await leituraComFalhaNoSalvar();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(3);
    expect(tituloDiferente()).toBeInTheDocument();
    desconectarCelular.mockResolvedValue({ ok: true });
    corrigirDados();
    await passar(400);
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
    expect(desconectarCelular).toHaveBeenCalledWith({ gateway: "zapi", campos: CAMPOS_ZAPI });
  });

  it("depois da falha, voltar ao formulário recomeça a conta: o aviso do próximo Conectar não desconecta", async () => {
    await leituraComFalhaNoSalvar();
    fireEvent.click(document.getElementById("val-pri")!);
    await passar(400);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "form");
    fireEvent.click(conectar("zapi"));
    await passar(4500);
    expect(tituloDiferente()).toBeInTheDocument();
    corrigirDados();
    await passar(400);
    expect(desconectarCelular).not.toHaveBeenCalled();
  });

  it("a sessão cai no salvar depois da leitura e volta: o 'Tentar de novo' acha o outro número, e 'Corrigir os dados' desconecta", async () => {
    salvarConexao
      .mockResolvedValueOnce(DESCONECTADA)
      .mockRejectedValueOnce(new Error("sem sessão"))
      .mockResolvedValueOnce(DIFERENTE)
      .mockResolvedValue(SALVA);
    await conectarZapi();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    conectado = true;
    await passar(3100 + TEMPO_VOLTA_DISCO_MS);
    await passar(4500);
    expect(screen.getByRole("button", { name: "Entrar de novo" })).toBeInTheDocument();
    // a sessão voltou (a pessoa entrou de novo em outra aba)
    getSession.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await passar(4500);
    expect(salvarConexao).toHaveBeenCalledTimes(3);
    expect(tituloDiferente()).toBeInTheDocument();
    desconectarCelular.mockResolvedValue({ ok: true });
    corrigirDados();
    await passar(400);
    expect(desconectarCelular).toHaveBeenCalledTimes(1);
  });
});

describe("Onboarding: quem abre o passo do QR", () => {
  it("a Meta com 'instancia_desconectada' não abre o QR: mostra o erro de sempre", async () => {
    salvarConexao.mockResolvedValue({ ok: false, erro: "instancia_desconectada", mensagem: "O número não está conectado. Confira na Meta." });
    montar();
    await abrirProvedor("Oficial", "API oficial da Meta");
    preencher("f-meta-phoneId", "123456789012");
    preencher("f-meta-wabaId", "998877");
    preencher("f-meta-token", "EAAtokenSecreto123");
    preencher("f-meta-appSecret", "segredoDoApp99");
    fireEvent.click(conectar("meta"));
    await passar(4500);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "erro");
    expect(screen.getByText("Não conectou")).toBeInTheDocument();
    expect(tituloQr()).toBeNull();
    await passar(5000, 250);
    expect(pedirQr).not.toHaveBeenCalled();
  });

  it("a Evolution desconectada também abre o QR, com os campos dela", async () => {
    salvarConexao.mockResolvedValue({ ...DESCONECTADA, mensagem: "A instância da Evolution não está conectada." });
    montar();
    await abrirProvedor("Não oficial", "Evolution");
    for (const [id, v] of Object.entries(CAMPOS_EVOLUTION)) preencher(`f-evolution-${id}`, v);
    fireEvent.click(conectar("evolution"));
    await passar(4500);
    expect(tituloQr()).toHaveFocus();
    expect(imagemQr()).not.toBeNull();
    expect(pedirQr).toHaveBeenCalledWith({ gateway: "evolution", campos: CAMPOS_EVOLUTION, pedir: "qr" });
    expect(document.querySelector("[data-gateway='evolution']")).not.toBeNull();
  });
});
