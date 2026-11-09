// O QR code da Z-API e da Evolution (os gateways não oficiais), para o passo "Leia o QR code" do
// onboarding e da Configuração. Lógica pura, como conexao.ts: monta o pedido de cada gateway e
// traduz a resposta. Spec: docs/spec-qr-whatsapp.md.
//
// - Z-API: GET https://api.z-api.io/instances/{instanceId}/token/{token}/qr-code com o cabeçalho
//   Client-Token. Devolve {value:"data:image/png;base64,…"}, ou {challenge:{…}} quando o celular
//   pede passkey (o app não consegue concluir). Sem imagem nem challenge, o mesmo pedido tenta
//   o .../qr-code/image (o teste real confirma qual dos dois vale).
// - Evolution: GET {serverUrl}/instance/connect/{instanceName} com o cabeçalho apikey. Devolve
//   {pairingCode, code, base64, count}; já conectada, {instance:{state:"open"}}; falha interna,
//   {error:true, message}.
//
// Cada pedido confere a situação primeiro (validarConexaoLogica) e só pede o QR com a instância
// desconectada. Nada aqui grava: quem grava é salvarConexao ou conferirConexao.

import {
  baseEvolution,
  CAMPOS_SECRETOS,
  lerEntradaConexao,
  mapearEvolution,
  mapearZapi,
  nomeInstancia,
  validarConexaoLogica,
  type BaseEvolution,
  type CamposEvolution,
  type CamposZapi,
  type ErroConexao,
  type Requisicao,
  type ResultadoConexao,
} from "./conexao";
import {
  abrirPrazo,
  blindar,
  corpoComoTexto,
  FalhaDeRede,
  ler,
  pedir,
  TempoEsgotado,
  type OpcoesValidacao,
  type Prazo,
  type RespostaHttp,
} from "./http";

export const GATEWAYS_QR = ["zapi", "evolution"] as const;
export type GatewayQr = (typeof GATEWAYS_QR)[number];

/** "qr" confere a situação e, sem conexão, pede um QR novo; "situacao" só confere a situação. */
export type PedidoQr = "qr" | "situacao";

export type EntradaQr = { gateway: GatewayQr; campos: Record<string, string>; pedir: PedidoQr };

export type ResultadoQr =
  | { ok: true; conectado: true; rotulo: string }
  | { ok: true; conectado: false; qr: string | null; passkey: boolean }
  | { ok: false; erro: ErroConexao; campo?: string; mensagem: string };

export function ehGatewayQr(g: string): g is GatewayQr {
  return (GATEWAYS_QR as readonly string[]).includes(g);
}

/**
 * Confere a forma da entrada vinda do navegador (os mesmos limites de lerEntradaConexao). Lança um
 * erro genérico, sem nenhum valor da entrada.
 */
export function lerEntradaQr(entrada: unknown): EntradaQr {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new Error("Pedido inválido.");
  }
  const e = entrada as Record<string, unknown>;
  const gateway = e["gateway"];
  const pedido = e["pedir"];
  if (typeof gateway !== "string" || !ehGatewayQr(gateway)) {
    throw new Error("Pedido inválido: gateway.");
  }
  if (pedido !== "qr" && pedido !== "situacao") throw new Error("Pedido inválido: pedir.");
  const { campos } = lerEntradaConexao({ gateway, campos: e["campos"] });
  return { gateway, campos, pedir: pedido };
}

// ---------- a imagem ----------

/** Tamanho máximo da imagem, já com o prefixo data:. */
const IMAGEM_MAX = 300 * 1024;
const PREFIXO_IMAGEM = /^data:image\/(png|jpeg);base64,/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * A imagem do QR como veio do provedor, se for um png ou jpeg em base64 de até 300 KB. Base64 sem
 * o prefixo vira png. Qualquer outra coisa vira null (a tela mostra "sem QR").
 */
export function lerImagemQr(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.replace(/[\r\n]/g, "").trim();
  if (limpo.length > IMAGEM_MAX) return null;
  const prefixo = PREFIXO_IMAGEM.exec(limpo);
  if (prefixo) return BASE64.test(limpo.slice(prefixo[0].length)) ? limpo : null;
  if (limpo.length < 100 || !BASE64.test(limpo)) return null;
  const imagem = `data:image/png;base64,${limpo}`;
  return imagem.length > IMAGEM_MAX ? null : imagem;
}

// ---------- mensagens (texto humano, sem nenhum dado da credencial) ----------

type FalhaQr = Extract<ResultadoQr, { ok: false }>;

function falha(erro: ErroConexao, mensagem: string, nomeCampo?: string): FalhaQr {
  return nomeCampo
    ? { ok: false, erro, campo: nomeCampo, mensagem }
    : { ok: false, erro, mensagem };
}

const SEM_QR: ResultadoQr = { ok: true, conectado: false, qr: null, passkey: false };

const zapiMsg = {
  tempo: () =>
    falha(
      "tempo_esgotado",
      "A Z-API demorou mais de 10 segundos para responder. Tente de novo em instantes.",
    ),
  semRede: () =>
    falha(
      "servidor_inacessivel",
      "Não conseguimos falar com a Z-API agora. Tente de novo em alguns minutos.",
    ),
  fora: () =>
    falha(
      "servidor_inacessivel",
      "A Z-API não respondeu como esperado. Pode ser uma instabilidade passageira: tente de novo em alguns minutos.",
    ),
};

const evolutionMsg = {
  tempo: () =>
    falha(
      "tempo_esgotado",
      "O seu servidor Evolution demorou mais de 10 segundos para responder. Tente de novo em instantes.",
    ),
  naoAlcancou: () =>
    falha(
      "servidor_inacessivel",
      "Não conseguimos alcançar o servidor. Confira a URL e se ele está no ar e aberto para a internet.",
      "serverUrl",
    ),
  semQr: () =>
    falha(
      "servidor_inacessivel",
      "O servidor Evolution não conseguiu gerar o QR code. Confira se a instância está funcionando e tente de novo.",
      "serverUrl",
    ),
  urlInvalida: () =>
    falha(
      "servidor_inacessivel",
      "A URL do servidor precisa ser um endereço público com https://, por exemplo https://evolution.suaempresa.com.br.",
      "serverUrl",
    ),
  fora: () =>
    falha(
      "servidor_inacessivel",
      "O servidor Evolution respondeu com erro. Confira se ele está funcionando e tente de novo.",
      "serverUrl",
    ),
};

/** O resultado dos mapeadores de conexao.ts no formato do QR. */
function comoQr(r: ResultadoConexao): ResultadoQr {
  return r.ok ? { ok: true, conectado: true, rotulo: r.rotulo } : r;
}

function campo(campos: Record<string, string>, nome: string): string {
  return (campos[nome] ?? "").trim();
}

// ---------- Z-API ----------

export function requisicaoQrZapi(c: CamposZapi): Requisicao {
  return {
    url: `https://api.z-api.io/instances/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.instanceToken)}/qr-code`,
    init: { method: "GET", headers: { "Client-Token": c.clientToken } },
  };
}

/** O /qr-code/image (a doc: "imagem base64 para um componente de imagem"), tentado quando o /qr-code não traz imagem. */
export function requisicaoQrImagemZapi(c: CamposZapi): Requisicao {
  return {
    url: `https://api.z-api.io/instances/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.instanceToken)}/qr-code/image`,
    init: { method: "GET", headers: { "Client-Token": c.clientToken } },
  };
}

/** Vale para o /qr-code e para o /qr-code/image: a imagem vem em `value`. */
export function mapearQrZapi(r: RespostaHttp, c: CamposZapi): ResultadoQr {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) {
    const qr = lerImagemQr(ler(corpo, "value"));
    if (qr) return { ok: true, conectado: false, qr, passkey: false };
    const desafio = ler(corpo, "challenge");
    if (desafio !== null && typeof desafio === "object") {
      return { ok: true, conectado: false, qr: null, passkey: true };
    }
    return SEM_QR;
  }
  return comoQr(mapearZapi(r, c));
}

async function qrZapi(
  campos: Record<string, string>,
  o: OpcoesValidacao | undefined,
  prazo: Prazo,
): Promise<ResultadoQr> {
  const c: CamposZapi = {
    instanceId: campo(campos, "instanceId"),
    instanceToken: campo(campos, "instanceToken"),
    clientToken: campo(campos, "clientToken"),
  };
  const segredos = [c.instanceToken, c.clientToken];
  const req = requisicaoQrZapi(c);
  const resposta = await pedir(o, prazo, req.url, req.init, segredos);
  const primeiro = mapearQrZapi(resposta, c);
  // 2xx sem imagem e sem challenge: tenta o /qr-code/image, no mesmo prazo (achado 3 do R0)
  if (!primeiro.ok || primeiro.conectado || primeiro.qr || primeiro.passkey) return primeiro;
  // o número já conectou ({connected: true}): não há QR a pedir; a próxima consulta da situação confirma
  if (ler(resposta.corpo, "connected") === true) return SEM_QR;
  const img = requisicaoQrImagemZapi(c);
  return mapearQrZapi(await pedir(o, prazo, img.url, img.init, segredos), c);
}

// ---------- Evolution ----------

export function requisicaoQrEvolution(b: BaseEvolution, c: CamposEvolution): Requisicao {
  return {
    url: `${b.base}/instance/connect/${encodeURIComponent(c.instanceName)}`,
    init: { method: "GET", headers: { apikey: c.apiKey } },
  };
}

export function mapearQrEvolution(
  r: RespostaHttp,
  b: BaseEvolution,
  c: CamposEvolution,
): ResultadoQr {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) {
    const qr = lerImagemQr(ler(corpo, "base64"));
    if (qr) return { ok: true, conectado: false, qr, passkey: false };
    if (ler(corpo, "error") === true) return evolutionMsg.semQr();
    // já conectada ({instance:{state:"open"}}) ou sem QR ainda: a próxima consulta pega
    return SEM_QR;
  }
  return comoQr(mapearEvolution(r, b, c));
}

async function qrEvolution(
  campos: Record<string, string>,
  o: OpcoesValidacao | undefined,
  prazo: Prazo,
): Promise<ResultadoQr> {
  const c: CamposEvolution = {
    serverUrl: campo(campos, "serverUrl"),
    // vazio vale "janete", como na validação (o QR nunca cria instância)
    instanceName: nomeInstancia(campos["instanceName"]),
    apiKey: campo(campos, "apiKey"),
  };
  const base = baseEvolution(c.serverUrl);
  if (!base) return evolutionMsg.urlInvalida();
  const req = requisicaoQrEvolution(base, c);
  return mapearQrEvolution(await pedir(o, prazo, req.url, req.init, [c.apiKey]), base, c);
}

// ---------- fluxo ----------

/**
 * Confere a situação e, com a instância desconectada e o pedido "qr", pede o QR ao gateway (com
 * prazo próprio). A resposta traz só o rótulo ou a imagem, nunca a credencial. Nada é gravado.
 */
export async function pedirQrLogica(e: EntradaQr, opcoes?: OpcoesValidacao): Promise<ResultadoQr> {
  const { gateway, campos } = e;
  // 1. a situação (já blindada por validarConexaoLogica)
  const situacao = await validarConexaoLogica({ gateway, campos }, opcoes);
  if (situacao.ok) return { ok: true, conectado: true, rotulo: situacao.rotulo };
  if (situacao.erro !== "instancia_desconectada") return situacao;
  // 2. só a situação
  if (e.pedir === "situacao") return SEM_QR;

  // 3. o QR, com prazo próprio
  const segredos = CAMPOS_SECRETOS[gateway].map((nome) => campos[nome] ?? "");
  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: ResultadoQr;
  try {
    resultado =
      gateway === "zapi"
        ? await qrZapi(campos, opcoes, prazo)
        : await qrEvolution(campos, opcoes, prazo);
  } catch (falhou) {
    const msg = gateway === "zapi" ? zapiMsg : evolutionMsg;
    // rede: na Evolution, o servidor é do cliente e a falha aponta a URL
    const semRede = gateway === "zapi" ? zapiMsg.semRede : evolutionMsg.naoAlcancou;
    if (falhou instanceof TempoEsgotado) resultado = msg.tempo();
    else if (falhou instanceof FalhaDeRede) resultado = semRede();
    else resultado = msg.fora();
  } finally {
    prazo.encerrar();
  }
  // a imagem não passa pelo blindar: só a falha leva texto
  return resultado.ok ? resultado : blindar(resultado, segredos);
}

// ---------- desconectar o celular (spec-qr-whatsapp, seção 8) ----------
//
// "Desconectar e ler de novo" e o conserto com o celular de outro número: tira o celular da
// instância, sem apagar a instância. Depois vem um QR novo.
// - Z-API: GET …/disconnect com o Client-Token → {value:true}.
// - Evolution: DELETE {base}/instance/logout/{nome} com a apikey → {status:"SUCCESS"}; já fechada,
//   volta 400 "is not connected", que conta como sucesso.

export type EntradaDesconectarCelular = { gateway: GatewayQr; campos: Record<string, string> };

export type ResultadoDesconectarCelular =
  { ok: true } | { ok: false; erro: ErroConexao; campo?: string; mensagem: string };

type FalhaDesconectar = Extract<ResultadoDesconectarCelular, { ok: false }>;

export function requisicaoDesconectarZapi(c: CamposZapi): Requisicao {
  return {
    url: `https://api.z-api.io/instances/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.instanceToken)}/disconnect`,
    init: { method: "GET", headers: { "Client-Token": c.clientToken } },
  };
}

export function requisicaoDesconectarEvolution(b: BaseEvolution, c: CamposEvolution): Requisicao {
  return {
    url: `${b.base}/instance/logout/${encodeURIComponent(c.instanceName)}`,
    init: { method: "DELETE", headers: { apikey: c.apiKey } },
  };
}

const desconectarMsg = {
  fora: (g: GatewayQr): FalhaDesconectar =>
    g === "zapi"
      ? falha(
          "servidor_inacessivel",
          "A Z-API não conseguiu desconectar o celular agora. Tente de novo em instantes.",
        )
      : falha(
          "servidor_inacessivel",
          "O servidor Evolution não conseguiu desconectar o celular agora. Tente de novo em instantes.",
          "serverUrl",
        ),
};

// os mapeadores de conexao.ts só leem os campos na resposta 2xx, que aqui não chega até eles
const ZAPI_VAZIA: CamposZapi = { instanceId: "", instanceToken: "", clientToken: "" };
const EVOLUTION_VAZIA: CamposEvolution = { serverUrl: "", instanceName: "", apiKey: "" };
const BASE_VAZIA: BaseEvolution = { base: "", host: "" };

/**
 * 2xx = desconectado; na Evolution, o 400 "not connected" também (já estava fechada). 401 e 403
 * são a credencial, 404 a instância e 429 tentativas demais (as frases de conexao.ts); o resto é o
 * gateway fora do ar.
 */
export function mapearDesconectar(
  r: RespostaHttp,
  gateway: GatewayQr,
): ResultadoDesconectarCelular {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) return { ok: true };
  if (gateway === "evolution" && status === 400 && /not connected/i.test(corpoComoTexto(corpo))) {
    return { ok: true };
  }
  if (status === 401 || status === 403 || status === 404 || status === 429) {
    const mapeado =
      gateway === "zapi"
        ? mapearZapi(r, ZAPI_VAZIA)
        : mapearEvolution(r, BASE_VAZIA, EVOLUTION_VAZIA);
    if (!mapeado.ok) return mapeado;
  }
  return desconectarMsg.fora(gateway);
}

/** Tira o celular da instância (sem apagar a instância). Nada é gravado; nenhum segredo volta. */
export async function desconectarCelularLogica(
  e: EntradaDesconectarCelular,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoDesconectarCelular> {
  const { gateway, campos } = e;
  const segredos = CAMPOS_SECRETOS[gateway].map((nome) => campos[nome] ?? "");
  let req: Requisicao;
  if (gateway === "zapi") {
    const c: CamposZapi = {
      instanceId: campo(campos, "instanceId"),
      instanceToken: campo(campos, "instanceToken"),
      clientToken: campo(campos, "clientToken"),
    };
    if (!c.instanceId)
      return falha("nao_encontrado", "Informe o ID da instância da Z-API.", "instanceId");
    if (!c.instanceToken)
      return falha("credencial_invalida", "Cole o token da instância da Z-API.", "instanceToken");
    if (!c.clientToken) {
      return falha(
        "credencial_invalida",
        "Cole o Client-Token. Ele fica na aba Segurança da sua conta Z-API.",
        "clientToken",
      );
    }
    req = requisicaoDesconectarZapi(c);
  } else {
    const c: CamposEvolution = {
      serverUrl: campo(campos, "serverUrl"),
      // vazio vale "janete", como na validação
      instanceName: nomeInstancia(campos["instanceName"]),
      apiKey: campo(campos, "apiKey"),
    };
    const base = baseEvolution(c.serverUrl);
    if (!base) return evolutionMsg.urlInvalida();
    if (!c.apiKey)
      return falha(
        "credencial_invalida",
        "Cole a chave de API do servidor ou da instância.",
        "apiKey",
      );
    req = requisicaoDesconectarEvolution(base, c);
  }

  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: ResultadoDesconectarCelular;
  try {
    resultado = mapearDesconectar(await pedir(opcoes, prazo, req.url, req.init, segredos), gateway);
  } catch (falhou) {
    const msg = gateway === "zapi" ? zapiMsg : evolutionMsg;
    const semRede = gateway === "zapi" ? zapiMsg.semRede : evolutionMsg.naoAlcancou;
    if (falhou instanceof TempoEsgotado) resultado = msg.tempo();
    else if (falhou instanceof FalhaDeRede) resultado = semRede();
    else resultado = desconectarMsg.fora(gateway);
  } finally {
    prazo.encerrar();
  }
  return resultado.ok ? resultado : blindar(resultado, segredos);
}
