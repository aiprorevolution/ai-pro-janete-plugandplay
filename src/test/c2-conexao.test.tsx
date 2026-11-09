import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_SESSION_STORAGE,
  ESTADO_INICIAL,
  gravarEstadoOnboarding,
  lerEstadoOnboarding,
  limparEstadoOnboarding,
} from "@/features/onboarding/estado";
import type { PontoJanete } from "@/components/janete/VooJanete";
import { EtapaConexao } from "@/features/onboarding/conexao";
import { MENSAGEM_SEM_RESPOSTA, consumirDesdobra, desdobraPedido } from "@/features/onboarding/lista";
import { AVISO_PREVIA } from "@/features/onboarding/conexao/EtapaConexao";
import { PalcoContexto } from "@/features/onboarding/palco";
import type { AvisoConexao, ResultadoSalvarConexao } from "@/features/mensageria/configuracao.functions";
import { ProvedorDadosOnboarding, criarDadosOnboardingMemoria } from "@/features/plataforma/dados/onboarding";
import type { ResultadoConexao } from "@/features/servidor/conexao";

// C8: o "Conectar" grava pela salvarConexao (dados do onboarding). Os testes de antes respondem no
// formato do validador (`rotulo`); o adaptador abaixo devolve no formato do salvar, com o que o
// teste pôr em `extra` (endereço, verify token, avisos).
const validarConexao = vi.fn<(arg: { data: { gateway: string; campos: Record<string, string> } }) => Promise<ResultadoConexao>>();
type SalvarTeste = ResultadoSalvarConexao | ResultadoConexao;
let extra: { url_webhook?: string; verifyToken?: string; avisos?: AvisoConexao[] } = {};
let salvarDireto: ((e: { gateway: string }) => Promise<SalvarTeste>) | null = null;
async function salvarConexao(e: { gateway: string; campos: Record<string, string> }): Promise<ResultadoSalvarConexao> {
  const r = salvarDireto ? await salvarDireto(e) : await validarConexao({ data: e });
  if (!r.ok) return r as ResultadoSalvarConexao;
  if ("conexao_id" in r) return r;
  return {
    ok: true,
    conexao_id: "conexao-teste",
    nome: r.rotulo,
    gateway: e.gateway as "meta",
    url_webhook: extra.url_webhook ?? "https://app.teste/api/public/whatsapp/meta/conexao-teste",
    ...(extra.verifyToken ? { verifyToken: extra.verifyToken } : {}),
    avisos: extra.avisos ?? [],
  };
}

const getSession = vi.fn();
vi.mock("@/integrations/firebase/client", () => ({ firebase: { auth: { getSession: () => getSession() } } }));

const voo = {
  ativo: false,
  pousar: vi.fn(),
  voar: vi.fn(() => Promise.resolve()),
  mudarEstado: vi.fn(),
  legenda: vi.fn(),
  soltar: vi.fn(),
};
/** Quando definido, simula a rolagem até a mira (rolarAteEMedir) em andamento; senão, a real. */
let rolagem: (() => Promise<PontoJanete | null>) | null = null;
vi.mock("@/components/janete/VooJanete", async (original) => {
  const real = await original<typeof import("@/components/janete/VooJanete")>();
  return {
    ...real,
    useVooJanete: () => voo,
    rolarAteEMedir: (...args: Parameters<typeof real.rolarAteEMedir>) => (rolagem ? rolagem() : real.rolarAteEMedir(...args)),
  };
});

const janeteNoPalco = vi.fn();
const anunciar = vi.fn();
const recolherBarra = vi.fn();

function montar(avancar = vi.fn()) {
  const dados = criarDadosOnboardingMemoria({ salvarConexao });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <ProvedorDadosOnboarding dados={dados}>
      <PalcoContexto.Provider value={{ janeteNoPalco, anunciar, recolherBarra }}>{children}</PalcoContexto.Provider>
    </ProvedorDadosOnboarding>
  );
  render(<EtapaConexao avancar={avancar} voltar={() => {}} />, { wrapper: envoltorio });
  return avancar;
}

/** Avança o relógio em passos curtos: cada passo pinta e roda os efeitos, como o navegador. */
async function passar(ms: number) {
  for (let feito = 0; feito < ms; feito += 20) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(20, ms - feito));
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

beforeEach(() => {
  vi.useFakeTimers();
  limparEstadoOnboarding();
  validarConexao.mockReset();
  extra = {};
  salvarDireto = null;
  janeteNoPalco.mockReset();
  anunciar.mockReset();
  voo.ativo = false;
  voo.voar.mockClear();
  voo.legenda.mockClear();
  voo.soltar.mockClear();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
  consumirDesdobra();
  rolagem = null;
});
afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("Etapa conexão: escolhas", () => {
  it("mostra o título, os dois modos e, no modo escolhido, só os provedores dele", async () => {
    montar();
    expect(screen.getByRole("heading", { level: 1, name: "Conecte o WhatsApp da empresa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Oficial/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Não oficial/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Oficial/ }));
    await passar(100);
    expect(lerEstadoOnboarding().conexao.modo).toBe("oficial");
    expect(screen.getByRole("heading", { name: "Escolha o provedor oficial" })).toHaveFocus();
    expect(screen.getByRole("button", { name: /^API oficial da Meta/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Zernio/ })).toBeInTheDocument();
    // decisão 14a: o conector do Descontinuado saiu
    expect(screen.queryByRole("button", { name: /Descontinuado/ })).toBeNull();
    expect(screen.queryByText(/Descontinuado/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Z-API/ })).toBeNull();
    // as linhas dos modos se recolhem no resumo
    expect(screen.queryByRole("button", { name: /^Não oficial/ })).toBeNull();
    expect(screen.getByText("Oficial, pela API do WhatsApp")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trocar modo" }));
    await passar(100);
    expect(screen.getByRole("button", { name: /^Oficial/ })).toHaveFocus();
    expect(lerEstadoOnboarding().conexao.modo).toBeNull();
  });
});

describe("Etapa conexão: selo de dificuldade (1b)", () => {
  it("cada provedor mostra o selo: Zernio e Z-API fáceis, Evolution médio, Meta difícil", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: /^Oficial/ }));
    await passar(100);
    const linha = (nome: RegExp) => screen.getByRole("button", { name: nome });
    expect(linha(/^API oficial da Meta/)).toHaveAccessibleName(/Dificuldade: Difícil$/);
    expect(linha(/^Zernio/)).toHaveAccessibleName(/Dificuldade: Fácil$/);
    expect(within(linha(/^API oficial da Meta/)).getByText("Difícil")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Trocar modo" }));
    await passar(100);
    fireEvent.click(screen.getByRole("button", { name: /^Não oficial/ }));
    await passar(100);
    expect(linha(/^Z-API/)).toHaveAccessibleName(/Dificuldade: Fácil$/);
    expect(linha(/^Evolution/)).toHaveAccessibleName(/Dificuldade: Médio$/);
  });
});

describe("Etapa conexão: campos em 2 colunas (1a)", () => {
  const largos = (gateway: string) =>
    [...document.querySelectorAll(`[data-colunas='2'] > [data-campo]`)]
      .filter((el) => /campoLargo/.test(el.className))
      .map((el) => el.querySelector("input")!.id.replace(`f-${gateway}-`, ""));

  it("a grade é de 2 colunas; a URL do Evolution e o campo que sobra sozinho ocupam a linha inteira", async () => {
    montar();
    await abrirProvedor("Não oficial", "Evolution");
    expect(screen.getByRole("group", { name: "Evolution" }).querySelector("[data-colunas='2']")).not.toBeNull();
    // o número (1º campo, seção 8) sobra sozinho antes da URL
    expect(largos("evolution")).toEqual(["numero", "serverUrl"]);
  });

  it("Z-API: 4 campos (com o número, seção 8), 2 por linha; Meta: 4 campos, 2 por linha", async () => {
    montar();
    await abrirProvedor("Não oficial", "Z-API");
    expect(largos("zapi")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await passar(600);
    fireEvent.click(screen.getByRole("button", { name: "Trocar modo" }));
    await passar(100);
    await abrirProvedor("Oficial", "API oficial da Meta");
    expect(largos("meta")).toEqual([]);
  });

  it("Zernio: o ID da conta (placeholder longo) e a chave ocupam a linha inteira", async () => {
    montar();
    await abrirProvedor("Oficial", "Zernio");
    expect(largos("zernio")).toEqual(["apiKey", "accountId"]);
  });
});

const CASOS: Array<{
  gateway: string;
  modo: "Oficial" | "Não oficial";
  nome: string;
  campos: Record<string, string>;
  /** campos sem os quais o Conectar não libera */
  obrigatorios: string[];
  rotulos: string[];
}> = [
  {
    gateway: "meta",
    modo: "Oficial",
    nome: "API oficial da Meta",
    campos: { phoneId: "123456789012", wabaId: "998877", token: "EAAtokenSecreto123", appSecret: "segredoDoApp99" },
    obrigatorios: ["phoneId", "wabaId", "token", "appSecret"],
    rotulos: ["Phone Number ID", "ID da conta do WhatsApp Business", "Token de acesso permanente", "App Secret"],
  },
  {
    gateway: "zernio",
    modo: "Oficial",
    nome: "Zernio",
    campos: { apiKey: "zn_chave_secreta_777", accountId: "acc_1" },
    obrigatorios: ["apiKey"],
    rotulos: ["Chave de API", "ID da conta (opcional)"],
  },
  {
    gateway: "zapi",
    modo: "Não oficial",
    nome: "Z-API",
    campos: { numero: "11 98765-4321", instanceId: "3C2A99", instanceToken: "tokenDaInstancia55", clientToken: "clienteToken44" },
    obrigatorios: ["numero", "instanceId", "instanceToken", "clientToken"],
    rotulos: ["Número do WhatsApp", "ID da instância", "Token da instância", "Client-Token"],
  },
  {
    gateway: "evolution",
    modo: "Não oficial",
    nome: "Evolution",
    campos: { numero: "11 98765-4321", serverUrl: "https://evo.exemplo.com.br", instanceName: "vendas", apiKey: "evoChaveSecreta12" },
    // o nome é opcional: vazio usa a "janete" (spec-qr-whatsapp, seção 7); o número é obrigatório (seção 8)
    obrigatorios: ["numero", "serverUrl", "apiKey"],
    rotulos: ["Número do WhatsApp", "URL do servidor", "Nome da instância (opcional)", "Chave de API"],
  },
];

describe.each(CASOS)("Formulário do gateway $gateway", ({ gateway, modo, nome, campos, obrigatorios, rotulos }) => {
  it("tem os campos de conexao.ts, libera o Conectar só com os obrigatórios e manda os valores certos", async () => {
    validarConexao.mockResolvedValue({ ok: true, rotulo: "+55 11 91234-5678" });
    montar();
    await abrirProvedor(modo, nome);

    const painel = screen.getByRole("group", { name: nome });
    for (const rotulo of rotulos) expect(within(painel).getByLabelText(rotulo)).toBeInTheDocument();
    for (const id of Object.keys(campos)) expect(document.getElementById(`f-${gateway}-${id}`)).not.toBeNull();
    // o primeiro campo recebe o foco quando o painel abre
    expect(document.getElementById(`f-${gateway}-${Object.keys(campos)[0]}`)).toHaveFocus();

    expect(conectar(gateway)).toBeDisabled();
    for (const id of obrigatorios) preencher(`f-${gateway}-${id}`, campos[id]!);
    expect(conectar(gateway)).toBeEnabled();
    for (const [id, valor] of Object.entries(campos)) preencher(`f-${gateway}-${id}`, valor);

    // os segredos não vão para o atributo value do HTML (campo não controlado)
    for (const [id, valor] of Object.entries(campos)) {
      expect(document.getElementById(`f-${gateway}-${id}`)?.getAttribute("value") ?? "").not.toContain(valor);
    }

    fireEvent.click(conectar(gateway));
    expect(validarConexao).toHaveBeenCalledWith({ data: { gateway, campos } });
  });
});

describe("Etapa conexão: credenciais de um gateway abandonado", () => {
  it("Voltar apaga o que foi digitado: o painel reabre vazio e o Conectar volta desabilitado", async () => {
    montar();
    await abrirProvedor("Oficial", "API oficial da Meta");
    preencher("f-meta-phoneId", "123456789012");
    preencher("f-meta-wabaId", "998877");
    preencher("f-meta-token", "EAAtokenSecreto123");
    preencher("f-meta-appSecret", "segredoDoApp99");
    expect(conectar("meta")).toBeEnabled();
    fireEvent.click(within(screen.getByRole("group", { name: "API oficial da Meta" })).getByRole("button", { name: "Voltar" }));
    await passar(600);
    fireEvent.click(screen.getByRole("button", { name: /^API oficial da Meta/ }));
    await passar(500);
    expect((document.getElementById("f-meta-token") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("f-meta-appSecret") as HTMLInputElement).value).toBe("");
    expect(conectar("meta")).toBeDisabled();
  });
});

describe("Etapa conexão: a página rolando até o disco antes de dobrar", () => {
  it("a lista fica inert e Voltar não troca o provedor; quando a rolagem para, o cartão dobra com o palco", async () => {
    let parou: (p: PontoJanete | null) => void = () => {};
    validarConexao.mockResolvedValue({ ok: true, rotulo: "+55 11 91234-5678" });
    montar();
    await abrirProvedor("Não oficial", "Z-API");
    preencher("f-zapi-numero", "11 98765-4321");
    preencher("f-zapi-instanceId", "3C2A99");
    preencher("f-zapi-instanceToken", "tokenDaInstancia55");
    preencher("f-zapi-clientToken", "clienteToken44");
    rolagem = () => new Promise((r) => (parou = r));
    fireEvent.click(conectar("zapi"));
    await passar(100);
    const listaIn = document.getElementById("lista-cartao")!.firstElementChild!;
    expect(listaIn).toHaveAttribute("inert");
    fireEvent.click(within(screen.getByRole("group", { name: "Z-API" })).getByRole("button", { name: "Voltar" }));
    await passar(100);
    expect(lerEstadoOnboarding().conexao.gateway).toBe("zapi");
    await act(async () => parou(null));
    await passar(20);
    expect(document.getElementById("lista-cartao")).toHaveAttribute("data-fase", "fechando");
    expect(screen.getByTestId("val-disco")).toBeInTheDocument();
  });
});

describe("Etapa conexão: validação", () => {
  async function validarMeta(resposta: Promise<ResultadoConexao>) {
    validarConexao.mockReturnValue(resposta);
    return validarMetaSemMock();
  }
  async function validarMetaSemMock() {
    const avancar = montar();
    await abrirProvedor("Oficial", "API oficial da Meta");
    preencher("f-meta-phoneId", "123456789012");
    preencher("f-meta-wabaId", "998877");
    preencher("f-meta-token", "EAAtokenSecreto123");
    preencher("f-meta-appSecret", "segredoDoApp99");
    fireEvent.click(conectar("meta"));
    return avancar;
  }

  it("sucesso: o resultado só aparece depois da animação mínima, guarda só o rótulo e apaga as credenciais", async () => {
    const avancar = await validarMeta(Promise.resolve({ ok: true, rotulo: "+55 11 91234-5678 · Loja" }));
    // o cartão só dobra depois de a página parar de rolar (aqui não rola: o disco já está na vista)
    await passar(20);
    expect(janeteNoPalco).toHaveBeenLastCalledWith(true);
    await passar(3000);
    expect(screen.queryByText("Tudo certo, WhatsApp conectado.")).toBeNull();
    expect(screen.getByText("Lendo o número da conta")).toBeInTheDocument();
    await passar(1200);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
    expect(screen.getByText("+55 11 91234-5678 · Loja")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escolher o cérebro" })).toHaveFocus();

    expect(lerEstadoOnboarding().conexao).toEqual({ modo: "oficial", gateway: "meta", rotulo: "+55 11 91234-5678 · Loja" });
    const gravado = window.sessionStorage.getItem(CHAVE_SESSION_STORAGE) ?? "";
    expect(gravado).not.toContain("EAAtokenSecreto123");
    expect(gravado).not.toContain("segredoDoApp99");
    expect(anunciar).toHaveBeenCalledWith("WhatsApp conectado. +55 11 91234-5678 · Loja");

    // trocar a conexão reabre o formulário vazio: as credenciais não ficaram na memória
    fireEvent.click(screen.getByRole("button", { name: "Trocar conexão" }));
    await passar(400);
    expect((document.getElementById("f-meta-token") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("f-meta-phoneId") as HTMLInputElement).value).toBe("");
    expect(lerEstadoOnboarding().conexao.rotulo).toBeNull();
    expect(avancar).not.toHaveBeenCalled();
  });

  it("resposta que demora mais que a animação: o resultado espera a resposta", async () => {
    let responder: (r: ResultadoConexao) => void = () => {};
    await validarMeta(new Promise((r) => (responder = r)));
    await passar(6000);
    expect(screen.queryByText("Tudo certo, WhatsApp conectado.")).toBeNull();
    expect(screen.getByText("Falando com a Meta")).toBeInTheDocument();
    await act(async () => responder({ ok: true, rotulo: "+55 11 90000-1111" }));
    await passar(1200);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
  });

  it("Escolher o cérebro pede o desdobrar e avança", async () => {
    const avancar = await validarMeta(Promise.resolve({ ok: true, rotulo: "+55 11 91234-5678" }));
    await passar(4500);
    fireEvent.click(screen.getByRole("button", { name: "Escolher o cérebro" }));
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(desdobraPedido()).toBe(true);
  });

  it("erro com campo: mostra a mensagem da função, Corrigir reabre com o campo marcado e focado", async () => {
    await validarMeta(
      Promise.resolve({
        ok: false,
        erro: "credencial_invalida",
        campo: "token",
        mensagem: "A Meta não aceitou o token. Ele pode ter expirado ou estar sem permissão para enviar mensagens.",
      }),
    );
    await passar(4500);
    expect(screen.getByText("Não conectou")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "A Meta não aceitou o token." })).toBeInTheDocument();
    expect(screen.getByText("Ele pode ter expirado ou estar sem permissão para enviar mensagens.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toHaveFocus();
    expect(lerEstadoOnboarding().conexao.rotulo).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Corrigir os dados" }));
    await passar(400);
    const token = document.getElementById("f-meta-token") as HTMLInputElement;
    expect(token).toHaveAttribute("aria-invalid", "true");
    // o campo traz a instrução (2ª parte da mensagem); o título já está no aviso do topo
    expect(document.getElementById(token.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "Ele pode ter expirado ou estar sem permissão para enviar mensagens.",
    );
    expect(token).toHaveFocus();
    // os valores digitados continuam (só o sucesso apaga)
    expect(token.value).toBe("EAAtokenSecreto123");
    expect(screen.getByRole("alert")).toHaveTextContent("Corrija o campo marcado e tente de novo.");
    // digitar no campo tira a marca
    preencher("f-meta-token", "EAAnovo999");
    expect(token).not.toHaveAttribute("aria-invalid");
  });

  it("erro: Tentar de novo chama a função outra vez com os mesmos dados", async () => {
    await validarMeta(Promise.resolve({ ok: false, erro: "tempo_esgotado", mensagem: "A Meta demorou mais de 10 segundos para responder. Tente de novo em instantes." }));
    await passar(4500);
    expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
    validarConexao.mockResolvedValue({ ok: true, rotulo: "+55 11 91234-5678" });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(validarConexao).toHaveBeenCalledTimes(2);
    expect(validarConexao.mock.calls[1]![0].data.campos["token"]).toBe("EAAtokenSecreto123");
    await passar(4000);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
  });

  it("a chamada falhou (sem rede, sessão): mostra a mensagem de falha, sem erro inventado", async () => {
    validarConexao.mockRejectedValue(new Error("rede"));
    await validarMetaSemMock();
    await passar(4500);
    const [titulo] = MENSAGEM_SEM_RESPOSTA.split(". ");
    expect(screen.getByRole("heading", { level: 2, name: `${titulo}.` })).toBeInTheDocument();
  });

  it("a chamada foi recusada porque a sessão terminou: pede para entrar de novo, em vez de culpar a internet", async () => {
    validarConexao.mockRejectedValue(new Error("Unauthorized"));
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await validarMetaSemMock();
    await passar(4500);
    expect(screen.getByRole("heading", { level: 2, name: "Sua sessão terminou." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar de novo" })).toHaveFocus();
    expect(screen.queryByText(/Confira a sua internet/)).toBeNull();
  });
});

describe("Etapa conexão: webhook", () => {
  it("o estado guardado com o conector do Descontinuado (de antes da C8) volta vazio", async () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, conexao: { modo: "oficial", gateway: "descontinuado" as never, rotulo: null } });
    expect(lerEstadoOnboarding().conexao).toEqual({ modo: "oficial", gateway: null, rotulo: null });
  });

  it("Zernio: o webhook é configurado sozinho, sem nada para colar; se não deu, o endereço aparece com Copiar", async () => {
    salvarDireto = async () => ({
      ok: true,
      conexao_id: "c-zn",
      nome: "+55 11 95555-0000",
      gateway: "zernio",
      url_webhook: "https://app.teste/api/public/whatsapp/zernio/c-zn",
      avisos: ["webhook_nao_configurado"],
    });
    montar();
    await abrirProvedor("Oficial", "Zernio");
    expect(screen.queryByText("Gerado ao conectar")).toBeNull();
    preencher("f-zernio-apiKey", "zn_chave_secreta_777");
    fireEvent.click(conectar("zernio"));
    await passar(4500);
    expect(screen.getByRole("group", { name: "Falta 1 passo: cole no painel da Zernio" })).toBeInTheDocument();
    expect(screen.getByText("https://app.teste/api/public/whatsapp/zernio/c-zn")).toBeInTheDocument();
    expect(screen.queryByText("Verify token")).toBeNull();
  });
});

describe("Etapa conexão: gravar a conexão (C8)", () => {
  async function conectarMeta() {
    const avancar = montar();
    await abrirProvedor("Oficial", "API oficial da Meta");
    preencher("f-meta-phoneId", "123456789012");
    preencher("f-meta-wabaId", "998877");
    preencher("f-meta-token", "EAAtokenSecreto123");
    preencher("f-meta-appSecret", "segredoDoApp99");
    fireEvent.click(conectar("meta"));
    await passar(4500);
    return avancar;
  }

  it("o Conectar chama a salvarConexao com o gateway e os campos, e guarda o nome que ela devolveu", async () => {
    const chamado = vi.fn(async () => ({
      ok: true as const,
      conexao_id: "c1",
      nome: "+55 11 91234-5678",
      gateway: "meta" as const,
      url_webhook: "https://app.teste/api/public/whatsapp/meta/c1",
      verifyToken: "vt-gerado-no-servidor",
      avisos: [],
    }));
    salvarDireto = chamado;
    await conectarMeta();
    expect(chamado).toHaveBeenCalledWith({
      gateway: "meta",
      campos: { phoneId: "123456789012", wabaId: "998877", token: "EAAtokenSecreto123", appSecret: "segredoDoApp99" },
    });
    expect(lerEstadoOnboarding().conexao).toEqual({ modo: "oficial", gateway: "meta", rotulo: "+55 11 91234-5678" });
    // o verify token não vai para a aba
    expect(window.sessionStorage.getItem(CHAVE_SESSION_STORAGE) ?? "").not.toContain("vt-gerado-no-servidor");
  });

  it("Meta: o quadro de sucesso mostra o endereço e o token com Copiar e o 'Falta 1 passo' (decisão 14b)", async () => {
    validarConexao.mockResolvedValue({ ok: true, rotulo: "+55 11 91234-5678" });
    extra = { url_webhook: "https://app.teste/api/public/whatsapp/meta/c1", verifyToken: "vt-123" };
    await conectarMeta();
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
    const quadro = screen.getByRole("group", { name: "Falta 1 passo: cole no painel da Meta" });
    expect(within(quadro).getByText("https://app.teste/api/public/whatsapp/meta/c1")).toBeInTheDocument();
    expect(within(quadro).getByText("vt-123")).toBeInTheDocument();
    const writeText = vi.fn((_t: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      fireEvent.click(within(quadro).getByRole("button", { name: "Copiar Verify token" }));
      await passar(20);
      expect(writeText).toHaveBeenCalledWith("vt-123");
      expect(within(quadro).getByRole("button", { name: "Copiado: Verify token" })).toBeInTheDocument();
      expect(anunciar).toHaveBeenCalledWith("Verify token copiada.");
      fireEvent.click(within(quadro).getByRole("button", { name: "Copiar URL do webhook" }));
      await passar(20);
      expect(within(quadro).getByRole("button", { name: "Copiado: URL do webhook" })).toBeInTheDocument();
      // sem prévia, sem o aviso de salvar de novo
      expect(screen.queryByText(AVISO_PREVIA)).toBeNull();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("Meta: com a cópia recusada pelo navegador, nunca diz 'Copiado' e o token continua à mostra", async () => {
    validarConexao.mockResolvedValue({ ok: true, rotulo: "+55 11 91234-5678" });
    extra = { url_webhook: "https://app.teste/api/public/whatsapp/meta/c1", verifyToken: "vt-123" };
    await conectarMeta();
    const quadro = screen.getByRole("group", { name: "Falta 1 passo: cole no painel da Meta" });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.reject(new Error("negado"))) },
      configurable: true,
    });
    try {
      fireEvent.click(within(quadro).getByRole("button", { name: "Copiar Verify token" }));
      await passar(20);
      expect(within(quadro).queryByRole("button", { name: "Copiado: Verify token" })).toBeNull();
      expect(anunciar).not.toHaveBeenCalledWith("Verify token copiada.");
      expect(within(quadro).getByText("vt-123")).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("antes do Conectar, a Meta mostra só o marcador do que vai ser gerado (nunca um valor inventado)", async () => {
    montar();
    await abrirProvedor("Oficial", "API oficial da Meta");
    expect(screen.getByText("Gerado por nós. Depois de conectar, cole no painel da Meta.")).toBeInTheDocument();
    expect(screen.getAllByText("Gerado ao conectar")).toHaveLength(2);
    expect(screen.queryByText(/\/webhook\/meta/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copiar/ })).toBeNull();
  });

  it("feito na prévia: o sucesso avisa para salvar a conexão de novo depois de publicar (decisão 14c)", async () => {
    validarConexao.mockResolvedValue({ ok: true, rotulo: "+55 11 91234-5678" });
    extra = { verifyToken: "vt-123", avisos: ["url_de_previa"] };
    await conectarMeta();
    expect(screen.getByText(AVISO_PREVIA)).toBeInTheDocument();
  });

  it("voltou com a conexão já gravada: o sucesso aparece sem o token, e diz que ele fica em Configuração", async () => {
    gravarEstadoOnboarding({ ...ESTADO_INICIAL, conexao: { modo: "oficial", gateway: "meta", rotulo: "+55 11 91234-5678" } });
    montar();
    await passar(100);
    expect(screen.getByText("Tudo certo, WhatsApp conectado.")).toBeInTheDocument();
    expect(screen.getByText("O endereço e o token do webhook ficam em Configuração.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Falta 1 passo/ })).toBeNull();
  });

  it.each([
    ["sem_acesso", "Sua conta não pode configurar a Janete."],
    ["erro_ao_gravar", "Não conseguimos guardar agora."],
    ["cifra_indisponivel", "O servidor não está pronto para guardar credenciais agora."],
    ["conexao_invalida", "Os dados desta conexão não fecharam."],
  ] as const)("recusa %s sem mensagem: mostra o texto certo e não guarda nada", async (erro, titulo) => {
    salvarDireto = async () => ({ ok: false, erro }) as ResultadoSalvarConexao;
    await conectarMeta();
    expect(screen.getByText("Não conectou")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: titulo })).toBeInTheDocument();
    expect(lerEstadoOnboarding().conexao.rotulo).toBeNull();
  });

  it("a mensagem da função vale sobre a da tabela (o nao_encontrado da Zernio, com o campo)", async () => {
    salvarDireto = async () => ({
      ok: false,
      erro: "nao_encontrado",
      campo: "accountId",
      mensagem: "Não achamos um número de WhatsApp nessa conta da Zernio. Informe o ID da conta e tente de novo.",
    });
    montar();
    await abrirProvedor("Oficial", "Zernio");
    preencher("f-zernio-apiKey", "zn_chave_secreta_777");
    fireEvent.click(conectar("zernio"));
    await passar(4500);
    expect(screen.getByRole("heading", { level: 2, name: "Não achamos um número de WhatsApp nessa conta da Zernio." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Corrigir os dados" })).toBeInTheDocument();
  });
});

describe("Etapa conexão: chegada do login", () => {
  it("com o símbolo em trânsito: o cartão espera, o símbolo voa até o topo dele e o cartão nasce", async () => {
    voo.ativo = true;
    // o cartão a 200 px do topo: o círculo de onde ele nasce (#nasce-mira, 96 px) fica a 24 px dele
    const medida = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.id === "nasce-mira"
        ? ({ left: 352, top: 224, width: 96, height: 96, right: 448, bottom: 320, x: 352, y: 224, toJSON: () => ({}) } as DOMRect)
        : ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    });
    montar();
    const secao = document.querySelector("section[data-etapa='conexao']")!;
    expect(secao).toHaveAttribute("data-entrada", "espera");
    await passar(70);
    expect(voo.voar).toHaveBeenCalledTimes(1);
    const [ponto, opcoes] = voo.voar.mock.calls[0] as unknown as [{ x: number; y: number; tamanho: number }, { duracaoMs: number }];
    // centro do cartão e topo + TOPO_NASCE (72)
    expect(ponto).toEqual({ x: 400, y: 272, tamanho: 96 });
    expect(opcoes).toEqual({ duracaoMs: 900 });
    await passar(900);
    expect(voo.legenda).toHaveBeenCalledWith(null);
    await passar(200);
    expect(voo.soltar).toHaveBeenCalledWith({ desvanecer: true });
    expect(secao).toHaveAttribute("data-entrada", "nascendo");
    // enquanto o cartão nasce do símbolo, a marca da barra continua fora (uma Janete só)
    expect(janeteNoPalco).toHaveBeenLastCalledWith(true);
    await passar(800);
    expect(secao).not.toHaveAttribute("data-entrada");
    expect(janeteNoPalco).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: /^Oficial/ })).toHaveFocus();
    medida.mockRestore();
  });

  it("com a página rolada: traz o cartão para a vista, espera a rolagem parar e só então mede o alvo do voo", async () => {
    voo.ativo = true;
    let rolou = false;
    const rolar = vi.fn(() => {
      rolou = true;
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: rolar });
    const medida = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id !== "nasce-mira") return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      // antes de rolar o círculo está acima da tela; depois, a 224 px do topo
      const top = rolou ? 224 : -400;
      return { left: 352, top, width: 96, height: 96, right: 448, bottom: top + 96, x: 352, y: top, toJSON: () => ({}) } as DOMRect;
    });
    try {
      montar();
      await passar(1200);
      expect(rolar).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
      expect(voo.voar).toHaveBeenCalledTimes(1);
      // o ponto é o de depois da rolagem, não o de antes (-400 + 48)
      expect(voo.voar.mock.calls[0]).toEqual([{ x: 400, y: 272, tamanho: 96 }, { duracaoMs: 900 }]);
    } finally {
      medida.mockRestore();
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("sem símbolo em trânsito: entrada normal, sem voo, e o foco na primeira opção", async () => {
    montar();
    expect(document.querySelector("section[data-etapa='conexao']")).not.toHaveAttribute("data-entrada");
    expect(janeteNoPalco).toHaveBeenLastCalledWith(false);
    await passar(100);
    expect(screen.getByRole("button", { name: /^Oficial/ })).toHaveFocus();
    await passar(1900);
    expect(voo.voar).not.toHaveBeenCalled();
  });

  it("sem símbolo em trânsito, com o foco já no título (a casca trocou de etapa): o foco fica lá", async () => {
    montar();
    const titulo = screen.getByRole("heading", { level: 1 });
    titulo.focus();
    await passar(200);
    expect(titulo).toHaveFocus();
  });
});
