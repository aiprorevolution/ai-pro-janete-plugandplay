// Validação da conexão de WhatsApp colada no onboarding (etapa conexão). Lógica pura: monta o
// pedido de cada gateway e traduz a resposta para o contrato da spec. A função de servidor
// (validar-conexao.functions.ts) só chama validarConexaoLogica.
//
// Endpoints e cabeçalhos: docs/pesquisa-gateways-whatsapp.md (a conferência vale sobre a
// pesquisa).
// - Meta: Graph API v26.0, GET /{phone_number_id}?fields=display_phone_number,verified_name com
//   Authorization: Bearer <token>.
// - Zernio: GET https://zernio.com/api/v1/accounts com Authorization: Bearer <chave> (é onde o
//   accountId da conexão aparece; chamar zernio.com direto, sem o domínio antigo).
// - Z-API: GET https://api.z-api.io/instances/{instanceId}/token/{token}/status com o
//   cabeçalho Client-Token. Resposta {connected, error, smartphoneConnected}.
// - Evolution: GET {serverUrl}/instance/connectionState/{instanceName} com o cabeçalho apikey. O
//   nome vazio vale "janete"; com criarEvolution (só o "Conectar"), a instância que não existe é
//   criada por POST {serverUrl}/instance/create (spec-qr-whatsapp, seção 7).
// - Descontinuado: sem API documentada para o app; devolve nao_suportado sem chamar nada.
//
// Os nomes dos campos são os do formulário do F (F-Final.dc.html, PROVS).

import {
  abrirPrazo,
  blindar,
  corpoComoTexto,
  curto,
  FalhaDeRede,
  ler,
  lerNumero,
  lerTexto,
  pedir,
  TempoEsgotado,
  type OpcoesValidacao,
  type Prazo,
  type RespostaHttp,
} from "./http";
import { formatarNumero, numeroDoJid } from "./numero-whatsapp";

export const GATEWAYS = ["meta", "zernio", "descontinuado", "zapi", "evolution"] as const;
export type Gateway = (typeof GATEWAYS)[number];

export type ErroConexao =
  | "credencial_invalida"
  | "nao_encontrado"
  | "instancia_desconectada"
  | "servidor_inacessivel"
  | "tempo_esgotado"
  | "nao_suportado";

/** Campos do formulário de cada gateway (ids do F). */
export type CamposMeta = { phoneId: string; wabaId?: string; token: string; appSecret?: string };
export type CamposZernio = { apiKey: string; accountId?: string };
export type CamposZapi = { instanceId: string; instanceToken: string; clientToken: string };
export type CamposEvolution = { serverUrl: string; instanceName: string; apiKey: string };

export type EntradaConexao = {
  gateway: Gateway;
  campos: Record<string, string>;
};

export type ResultadoConexao =
  /** numero: os dígitos que o WhatsApp informa (Z-API e Evolution conectadas), quando der para ler */
  | { ok: true; rotulo: string; numero?: string }
  | { ok: false; erro: ErroConexao; campo?: string; mensagem: string };

/** Campos que são segredo em cada gateway: nunca aparecem em resposta, erro ou log. */
export const CAMPOS_SECRETOS: Record<Gateway, readonly string[]> = {
  meta: ["token", "appSecret"],
  zernio: ["apiKey"],
  descontinuado: [],
  zapi: ["instanceToken", "clientToken"],
  evolution: ["apiKey"],
};

/** Como cada gateway aparece no começo da frase e depois de "com". */
const SUJEITO: Record<Gateway, string> = {
  meta: "A Meta",
  zernio: "A Zernio",
  descontinuado: "O Descontinuado",
  zapi: "A Z-API",
  evolution: "O seu servidor Evolution",
};
const COM: Record<Gateway, string> = {
  meta: "com a Meta",
  zernio: "com a Zernio",
  descontinuado: "com o Descontinuado",
  zapi: "com a Z-API",
  evolution: "com o seu servidor Evolution",
};

export const META_GRAPH = "https://graph.facebook.com/v26.0";
const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZAPI_BASE = "https://api.z-api.io/instances";

export type Requisicao = { url: string; init: RequestInit };

/**
 * Confere a forma da entrada vinda do navegador. Lança um erro genérico (sem nenhum valor da
 * entrada) se não for o formato do contrato.
 */
export function lerEntradaConexao(entrada: unknown): EntradaConexao {
  if (entrada === null || typeof entrada !== "object") throw new Error("Pedido inválido.");
  const e = entrada as Record<string, unknown>;
  const gateway = e["gateway"];
  const campos = e["campos"];
  if (typeof gateway !== "string" || !(GATEWAYS as readonly string[]).includes(gateway)) {
    throw new Error("Pedido inválido: gateway desconhecido.");
  }
  if (campos === undefined || campos === null) return { gateway: gateway as Gateway, campos: {} };
  if (typeof campos !== "object" || Array.isArray(campos)) throw new Error("Pedido inválido: campos.");
  const lidos: Record<string, string> = {};
  const pares = Object.entries(campos as Record<string, unknown>);
  if (pares.length > 20) throw new Error("Pedido inválido: campos.");
  for (const [nome, valor] of pares) {
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== "string" || valor.length > 2000 || nome.length > 50) {
      throw new Error("Pedido inválido: campos.");
    }
    lidos[nome] = valor;
  }
  return { gateway: gateway as Gateway, campos: lidos };
}

function campo(campos: Record<string, string>, nome: string): string {
  return (campos[nome] ?? "").trim();
}

// ---------- mensagens (texto humano, sem nenhum dado da credencial) ----------

function falha(erro: ErroConexao, mensagem: string, nomeCampo?: string): ResultadoConexao {
  return nomeCampo ? { ok: false, erro, campo: nomeCampo, mensagem } : { ok: false, erro, mensagem };
}

const comum = {
  tempo: (g: Gateway) =>
    falha("tempo_esgotado", `${SUJEITO[g]} demorou mais de 10 segundos para responder. Tente de novo em instantes.`),
  semRede: (g: Gateway) =>
    falha("servidor_inacessivel", `Não conseguimos falar ${COM[g]} agora. Tente de novo em alguns minutos.`),
  muitasChamadas: (g: Gateway) =>
    falha("servidor_inacessivel", `${SUJEITO[g]} recebeu tentativas demais. Espere um minuto e tente de novo.`),
  fora: (g: Gateway) =>
    falha("servidor_inacessivel", `${SUJEITO[g]} não respondeu como esperado. Pode ser uma instabilidade passageira: tente de novo em alguns minutos.`),
};

// ---------- Meta ----------

export function requisicaoMeta(c: CamposMeta): Requisicao {
  const busca = new URLSearchParams({ fields: "display_phone_number,verified_name" });
  return {
    url: `${META_GRAPH}/${encodeURIComponent(c.phoneId)}?${busca.toString()}`,
    init: { method: "GET", headers: { Authorization: `Bearer ${c.token}` } },
  };
}

const metaMsg = {
  tokenVazio: () => falha("credencial_invalida", "Cole o token de acesso permanente da Meta.", "token"),
  idInvalido: () =>
    falha("nao_encontrado", "O Phone Number ID tem só números. Copie de WhatsApp > Configuração da API no app da Meta.", "phoneId"),
  tokenRecusado: () =>
    falha(
      "credencial_invalida",
      "A Meta não aceitou o token. Ele pode ter expirado ou estar sem permissão para enviar mensagens. Gere um token permanente no Gerenciador de Negócios e cole de novo.",
      "token",
    ),
  semPermissao: () =>
    falha(
      "credencial_invalida",
      "O token é válido, mas não tem permissão sobre esse número. Ao gerar o token do usuário do sistema, dê acesso ao app e à conta do WhatsApp Business (whatsapp_business_messaging e whatsapp_business_management).",
      "token",
    ),
  naoAchou: () =>
    falha(
      "nao_encontrado",
      "A Meta não encontrou esse Phone Number ID, ou o token não enxerga esse número. Confira o ID em WhatsApp > Configuração da API.",
      "phoneId",
    ),
};

export function mapearMeta(r: RespostaHttp, c: CamposMeta): ResultadoConexao {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) {
    const numero = lerTexto(corpo, "display_phone_number")?.trim();
    const nome = lerTexto(corpo, "verified_name")?.trim();
    const base = numero ? (/^\d/.test(numero) ? `+${curto(numero, 30)}` : curto(numero, 30)) : `ID ${curto(c.phoneId, 16)}`;
    return { ok: true, rotulo: nome ? `${base} · ${curto(nome, 40)}` : base };
  }
  // Graph API: {error:{message, type, code, error_subcode}}
  const codigo = lerNumero(corpo, "error", "code");
  if (codigo === 190) return metaMsg.tokenRecusado();
  if (codigo === 10 || (codigo !== undefined && codigo >= 200 && codigo < 300)) return metaMsg.semPermissao();
  if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613 || codigo === 80007) {
    return comum.muitasChamadas("meta");
  }
  if (status === 400) return codigo === 100 || codigo === undefined ? metaMsg.naoAchou() : metaMsg.tokenRecusado();
  if (status === 401) return metaMsg.tokenRecusado();
  if (status === 403) return metaMsg.semPermissao();
  if (status === 404) return metaMsg.naoAchou();
  if (status === 429) return comum.muitasChamadas("meta");
  return comum.fora("meta");
}

async function validarMeta(campos: Record<string, string>, o: OpcoesValidacao | undefined, prazo: Prazo) {
  const c: CamposMeta = { phoneId: campo(campos, "phoneId"), token: campo(campos, "token") };
  if (!/^\d{5,30}$/.test(c.phoneId)) return metaMsg.idInvalido();
  if (!c.token) return metaMsg.tokenVazio();
  const req = requisicaoMeta(c);
  return mapearMeta(await pedir(o, prazo, req.url, req.init, [c.token, campo(campos, "appSecret")]), c);
}

// ---------- Zernio ----------

export function requisicaoZernio(c: CamposZernio): Requisicao {
  return {
    url: `${ZERNIO_BASE}/accounts`,
    init: { method: "GET", headers: { Authorization: `Bearer ${c.apiKey}` } },
  };
}

const zernioMsg = {
  chaveVazia: () => falha("credencial_invalida", "Cole a chave de API da Zernio.", "apiKey"),
  chaveRecusada: () =>
    falha(
      "credencial_invalida",
      "A Zernio não reconheceu a chave. Confira se você copiou a chave inteira, sem espaço no começo ou no fim, e se ela ainda está ativa no painel da Zernio.",
      "apiKey",
    ),
  chaveRestrita: () =>
    falha(
      "credencial_invalida",
      "A chave da Zernio existe, mas não tem acesso às contas. Use uma chave com acesso às contas conectadas ou crie uma nova no painel.",
      "apiKey",
    ),
  semNumero: () =>
    falha(
      "nao_encontrado",
      "A chave funciona, mas não há nenhum número de WhatsApp conectado nessa conta da Zernio. Conecte o número no painel da Zernio e tente de novo.",
    ),
  contaNaoAchada: () =>
    falha("nao_encontrado", "A chave funciona, mas essa conta não aparece entre as contas de WhatsApp da Zernio.", "accountId"),
};

function listaDeContas(corpo: unknown): unknown[] {
  if (Array.isArray(corpo)) return corpo;
  for (const chave of ["accounts", "data"]) {
    const v = ler(corpo, chave);
    if (Array.isArray(v)) return v;
    const dentro = ler(v, "accounts");
    if (Array.isArray(dentro)) return dentro;
  }
  return [];
}

function idDaConta(conta: unknown): string | undefined {
  return lerTexto(conta, "accountId") ?? lerTexto(conta, "_id") ?? lerTexto(conta, "id");
}

function ehWhatsApp(conta: unknown): boolean {
  const plataforma = lerTexto(conta, "platform") ?? lerTexto(conta, "type") ?? lerTexto(conta, "channel");
  return plataforma === undefined || /whatsapp/i.test(plataforma);
}

function rotuloZernio(conta: unknown): string {
  const telefone =
    lerTexto(conta, "phoneNumber") ??
    lerTexto(conta, "displayPhoneNumber") ??
    lerTexto(conta, "metadata", "phoneNumber");
  if (telefone?.trim()) {
    const t = telefone.trim();
    return /^\d/.test(t) ? `+${t}` : t;
  }
  const nome = lerTexto(conta, "displayName") ?? lerTexto(conta, "name") ?? lerTexto(conta, "username");
  if (nome?.trim()) return curto(nome, 40);
  const id = idDaConta(conta);
  return id ? `Conta ${curto(id, 24)}` : "Conta da Zernio";
}

export function mapearZernio(r: RespostaHttp, c: CamposZernio): ResultadoConexao {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) {
    const contas = listaDeContas(corpo).filter(ehWhatsApp);
    if (c.accountId) {
      const conta = contas.find((x) => idDaConta(x) === c.accountId);
      return conta ? { ok: true, rotulo: rotuloZernio(conta) } : zernioMsg.contaNaoAchada();
    }
    const primeira = contas[0];
    return primeira === undefined ? zernioMsg.semNumero() : { ok: true, rotulo: rotuloZernio(primeira) };
  }
  if (status === 401) return zernioMsg.chaveRecusada();
  if (status === 403) return zernioMsg.chaveRestrita();
  if (status === 404) return zernioMsg.semNumero();
  if (status === 429) return comum.muitasChamadas("zernio");
  return comum.fora("zernio");
}

async function validarZernio(campos: Record<string, string>, o: OpcoesValidacao | undefined, prazo: Prazo) {
  const c: CamposZernio = { apiKey: campo(campos, "apiKey") };
  const accountId = campo(campos, "accountId");
  if (accountId) c.accountId = accountId;
  if (!c.apiKey) return zernioMsg.chaveVazia();
  const req = requisicaoZernio(c);
  return mapearZernio(await pedir(o, prazo, req.url, req.init, [c.apiKey]), c);
}

// ---------- Z-API ----------

export function requisicaoZapi(c: CamposZapi): Requisicao {
  return {
    url: `${ZAPI_BASE}/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.instanceToken)}/status`,
    init: { method: "GET", headers: { "Client-Token": c.clientToken } },
  };
}

const zapiMsg = {
  idVazio: () => falha("nao_encontrado", "Informe o ID da instância da Z-API.", "instanceId"),
  tokenVazio: () => falha("credencial_invalida", "Cole o token da instância da Z-API.", "instanceToken"),
  clientVazio: () =>
    falha("credencial_invalida", "Cole o Client-Token. Ele fica na aba Segurança da sua conta Z-API.", "clientToken"),
  clientRecusado: () =>
    falha(
      "credencial_invalida",
      "A Z-API recusou o Client-Token. Ele fica na aba Segurança da sua conta Z-API, separado do token da instância. Copie de lá e tente de novo.",
      "clientToken",
    ),
  tokenRecusado: () =>
    falha(
      "credencial_invalida",
      "A Z-API recusou o token da instância. Copie de novo em Instâncias > editar, no painel da Z-API.",
      "instanceToken",
    ),
  naoAchou: () =>
    falha("nao_encontrado", "A Z-API não encontrou essa instância. Confira o ID em Instâncias, no painel da Z-API.", "instanceId"),
  restaurar: () =>
    falha(
      "instancia_desconectada",
      "A instância existe, mas perdeu a sessão do WhatsApp. Abra o painel da Z-API, leia o QR code de novo e tente outra vez.",
    ),
  desconectada: () =>
    falha(
      "instancia_desconectada",
      "A instância existe, mas o WhatsApp não está conectado. Leia o QR code no painel da Z-API e tente de novo.",
    ),
};

function falaDeClientToken(corpo: unknown): boolean {
  return /client.?token|not allowed/i.test(corpoComoTexto(corpo));
}

export function mapearZapi(r: RespostaHttp, c: CamposZapi): ResultadoConexao {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) {
    const conectado = ler(corpo, "connected");
    if (conectado === true) return { ok: true, rotulo: `Instância ${curto(c.instanceId, 24)}` };
    if (falaDeClientToken(corpo)) return zapiMsg.clientRecusado();
    if (conectado === false) {
      return /restore/i.test(lerTexto(corpo, "error") ?? "") ? zapiMsg.restaurar() : zapiMsg.desconectada();
    }
    return comum.fora("zapi");
  }
  if (status === 400 || status === 401 || status === 403) {
    return falaDeClientToken(corpo) ? zapiMsg.clientRecusado() : zapiMsg.tokenRecusado();
  }
  if (status === 404) return zapiMsg.naoAchou();
  if (status === 429) return comum.muitasChamadas("zapi");
  return comum.fora("zapi");
}

/** O número do celular conectado: GET …/device, com o Client-Token (spec-qr-whatsapp, seção 8). */
export function requisicaoNumeroZapi(c: CamposZapi): Requisicao {
  return {
    url: `${ZAPI_BASE}/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.instanceToken)}/device`,
    init: { method: "GET", headers: { "Client-Token": c.clientToken } },
  };
}

/** Os dígitos do `phone` do /device ({phone, name, …}); null quando não vem. */
export function lerNumeroZapi(r: RespostaHttp): string | null {
  if (r.status < 200 || r.status >= 300) return null;
  const bruto = ler(r.corpo, "phone");
  const texto = typeof bruto === "number" && Number.isFinite(bruto) ? String(bruto) : typeof bruto === "string" ? bruto : "";
  const digitos = texto.replace(/\D/g, "");
  return /^\d{8,15}$/.test(digitos) ? digitos : null;
}

/**
 * Conectada, lê o número no mesmo prazo. A falha (rede, tempo, recusa, corpo estranho) nunca
 * derruba a validação: fica o rótulo de hoje, sem número.
 */
async function comNumero(
  ok: Extract<ResultadoConexao, { ok: true }>,
  lerDoGateway: () => Promise<string | null>,
): Promise<ResultadoConexao> {
  let numero: string | null = null;
  try {
    numero = await lerDoGateway();
  } catch {
    numero = null;
  }
  return numero ? { ok: true, rotulo: formatarNumero(numero), numero } : ok;
}

async function validarZapi(campos: Record<string, string>, o: OpcoesValidacao | undefined, prazo: Prazo) {
  const c: CamposZapi = {
    instanceId: campo(campos, "instanceId"),
    instanceToken: campo(campos, "instanceToken"),
    clientToken: campo(campos, "clientToken"),
  };
  if (!c.instanceId) return zapiMsg.idVazio();
  if (!c.instanceToken) return zapiMsg.tokenVazio();
  if (!c.clientToken) return zapiMsg.clientVazio();
  const req = requisicaoZapi(c);
  const segredos = [c.instanceToken, c.clientToken];
  const r = mapearZapi(await pedir(o, prazo, req.url, req.init, segredos), c);
  if (!r.ok) return r;
  const dev = requisicaoNumeroZapi(c);
  return comNumero(r, async () => lerNumeroZapi(await pedir(o, prazo, dev.url, dev.init, segredos)));
}

// ---------- Evolution ----------

const evolutionMsg = {
  urlVazia: () => falha("servidor_inacessivel", "Informe a URL do seu servidor Evolution.", "serverUrl"),
  urlInvalida: () =>
    falha(
      "servidor_inacessivel",
      "A URL do servidor precisa ser um endereço público com https://, por exemplo https://evolution.suaempresa.com.br.",
      "serverUrl",
    ),
  chaveVazia: () => falha("credencial_invalida", "Cole a chave de API do servidor ou da instância.", "apiKey"),
  // criar a instância (spec-qr-whatsapp, seção 7)
  criada: (nome: string) =>
    falha(
      "instancia_desconectada",
      `A instância “${curto(nome, 20)}” foi criada no seu servidor. Leia o QR code para conectar o número.`,
    ),
  chaveNaoGlobal: () =>
    falha(
      "credencial_invalida",
      "Para criar a instância, use a chave global do servidor. É a AUTHENTICATION_API_KEY, no .env da Evolution. Se a instância já existe, informe o nome dela.",
      "apiKey",
    ),
  nomeInvalido: () =>
    falha(
      "nao_encontrado",
      "Para a Janete criar a instância, use no nome só letras, números, hífen e sublinhado, sem espaço.",
      "instanceName",
    ),
  nomeEmUso: () =>
    falha(
      "servidor_inacessivel",
      "Já existe uma instância com esse nome no seu servidor, mas não deu para conferir ela agora. Tente conectar de novo em instantes.",
    ),
  criarDemorou: () =>
    falha(
      "tempo_esgotado",
      "O seu servidor Evolution demorou mais de 20 segundos para criar a instância. Tente de novo: se ela já tiver sido criada, a Janete usa ela.",
    ),
  semToken: () =>
    falha("servidor_inacessivel", "O servidor do app não está pronto para criar a instância agora. Avise o suporte."),
  naoCriou: () =>
    falha(
      "servidor_inacessivel",
      "O servidor Evolution não conseguiu criar a instância. Confira se ele está funcionando e tente de novo.",
      "serverUrl",
    ),
  chaveRecusada: () =>
    falha(
      "credencial_invalida",
      "O servidor respondeu, mas recusou a chave. Confira se é a chave de API do servidor ou a da instância, copiada inteira.",
      "apiKey",
    ),
  naoAchou: () =>
    falha(
      "nao_encontrado",
      "O servidor respondeu, mas não encontrou essa instância. Confira o nome (maiúsculas e minúsculas contam).",
      "instanceName",
    ),
  desconectada: () =>
    falha(
      "instancia_desconectada",
      "A instância existe, mas o WhatsApp não está conectado nela. Leia o QR code no seu servidor Evolution e tente de novo.",
    ),
  naoAlcancou: () =>
    falha(
      "servidor_inacessivel",
      "Não conseguimos alcançar o servidor. Confira a URL e se ele está no ar e aberto para a internet.",
      "serverUrl",
    ),
  licenca: () =>
    falha(
      "servidor_inacessivel",
      "O servidor Evolution pede a ativação da licença antes de responder. Ative a licença no servidor e tente de novo.",
      "serverUrl",
    ),
  naoEhEvolution: () =>
    falha(
      "servidor_inacessivel",
      "O endereço respondeu, mas não parece um servidor Evolution. Confira a URL do servidor.",
      "serverUrl",
    ),
  fora: () =>
    falha(
      "servidor_inacessivel",
      "O servidor Evolution respondeu com erro. Confira se ele está funcionando e tente de novo.",
      "serverUrl",
    ),
};

function hostPrivado(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 literal: laço local, sem endereço, rede interna (fc00::/7), link local e IPv4 mapeado
  if (h.includes(":")) return h === "::1" || h === "::" || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith("::ffff:");
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export type BaseEvolution = {
  /** origem mais o caminho, sem barra no fim (ex.: https://api.empresa.com/evolution) */
  base: string;
  host: string;
};

/** Base do servidor ou null se a URL não servir. */
export function baseEvolution(serverUrl: string): BaseEvolution | null {
  let url: URL;
  try {
    url = new URL(serverUrl.trim());
  } catch {
    return null;
  }
  // só https (a chave vai no cabeçalho), sem usuário e senha na URL e sem rede interna
  if (url.protocol !== "https:" || url.username || url.password || hostPrivado(url.hostname)) return null;
  return { base: url.origin + url.pathname.replace(/\/+$/, ""), host: url.host };
}

/** O nome da instância quando o campo fica vazio (spec-qr-whatsapp, seção 7). */
export const INSTANCIA_PADRAO = "janete";

/** Nome que a Janete aceita criar (instância que já existe vale com qualquer nome). */
const NOME_CRIAVEL = /^[A-Za-z0-9_-]{1,40}$/;

/** A criação espera ~5 s pelo primeiro QR (instance.controller da Evolution): prazo próprio. */
export const PRAZO_CRIAR_MS = 20_000;

/** O nome efetivo da instância: o digitado, ou "janete" quando vazio. */
export function nomeInstancia(bruto: string | undefined): string {
  return (bruto ?? "").trim() || INSTANCIA_PADRAO;
}

/**
 * Opções da validação da conexão. `criarEvolution` só vem do "Conectar" (salvarConexao): com ele,
 * a instância da Evolution que não existe é criada, com o token próprio que `token` devolve.
 * Sem ele (QR, conserto, "Conferir"), nada é criado.
 */
export type OpcoesConexao = OpcoesValidacao & {
  criarEvolution?: { token: (base: string, nome: string) => Promise<string> };
};

export function requisicaoEvolution(b: BaseEvolution, c: CamposEvolution): Requisicao {
  return {
    url: `${b.base}/instance/connectionState/${encodeURIComponent(c.instanceName)}`,
    init: { method: "GET", headers: { apikey: c.apiKey } },
  };
}

/** O número do celular conectado: GET {base}/instance/fetchInstances?instanceName=X, com a apikey. */
export function requisicaoNumeroEvolution(b: BaseEvolution, c: CamposEvolution): Requisicao {
  const busca = new URLSearchParams({ instanceName: c.instanceName });
  return {
    url: `${b.base}/instance/fetchInstances?${busca.toString()}`,
    init: { method: "GET", headers: { apikey: c.apiKey } },
  };
}

/**
 * O dono da instância `nome` no fetchInstances. A v2 marca "open" na memória (o connectionState)
 * antes de gravar o dono no banco, que é de onde o fetchInstances lê; o ownerJid e o
 * connectionStatus "open" são gravados juntos. Até lá, o item ainda traz o dono antigo (ou nenhum):
 * `esperando` diz que vale ler de novo daqui a pouco.
 */
function donoEvolution(r: RespostaHttp, nome: string): { numero: string | null; esperando: boolean } {
  if (r.status < 200 || r.status >= 300) return { numero: null, esperando: false };
  const itens = Array.isArray(r.corpo) ? r.corpo : r.corpo !== null && typeof r.corpo === "object" ? [r.corpo] : [];
  for (const item of itens) {
    const ehV2 = lerTexto(item, "name") === nome;
    const ehV1 = lerTexto(item, "instance", "instanceName") === nome;
    if (!ehV2 && !ehV1) continue;
    const situacao = ehV2 ? lerTexto(item, "connectionStatus") : lerTexto(item, "instance", "status");
    if (situacao !== undefined && situacao !== "open") return { numero: null, esperando: true };
    const jid = ehV2 ? lerTexto(item, "ownerJid") : lerTexto(item, "instance", "owner");
    if (jid !== undefined) return { numero: numeroDoJid(jid), esperando: false };
  }
  return { numero: null, esperando: false };
}

/**
 * Os dígitos do dono da instância `nome`: na v2, o item com `name` e `ownerJid`; na v1,
 * `[{instance:{instanceName, owner}}]`. null quando não vem (401 sem banco na Evolution, lista
 * vazia, @lid) e quando o item ainda não está "open" (o dono pode ser o antigo).
 */
export function lerNumeroEvolution(r: RespostaHttp, nome: string): string | null {
  return donoEvolution(r, nome).numero;
}

/** Espera `ms` dentro do prazo: o fim do prazo corta a espera com TempoEsgotado. */
function esperarNoPrazo(ms: number, prazo: Prazo): Promise<void> {
  return new Promise((resolve, reject) => {
    if (prazo.sinal.aborted) {
      reject(new TempoEsgotado());
      return;
    }
    const parar = () => {
      clearTimeout(relogio);
      reject(new TempoEsgotado());
    };
    const relogio = setTimeout(() => {
      prazo.sinal.removeEventListener("abort", parar);
      resolve();
    }, ms);
    prazo.sinal.addEventListener("abort", parar, { once: true });
  });
}

/** Quanto esperar para ler o dono de novo, quando a v2 ainda não gravou o "open". */
export const ESPERA_DONO_EVOLUTION_MS = 1_000;

export function mapearEvolution(r: RespostaHttp, base: BaseEvolution, c: CamposEvolution): ResultadoConexao {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) {
    const estado = lerTexto(corpo, "instance", "state") ?? lerTexto(corpo, "state");
    if (estado === undefined) return evolutionMsg.naoEhEvolution();
    if (estado === "open") {
      return { ok: true, rotulo: `Instância “${curto(c.instanceName, 20)}” em ${curto(base.host, 30)}` };
    }
    return evolutionMsg.desconectada();
  }
  if (status === 401 || status === 403) return evolutionMsg.chaveRecusada();
  if (status === 404) return evolutionMsg.naoAchou();
  if (status === 429) return comum.muitasChamadas("evolution");
  if (/LICENSE_REQUIRED/.test(corpoComoTexto(corpo))) return evolutionMsg.licenca();
  if (status >= 300 && status < 400) return evolutionMsg.naoEhEvolution();
  return evolutionMsg.fora();
}

/**
 * Criar a instância: integração Baileys com QR, ignorando grupos (a Janete já ignora mensagem de
 * grupo), sem rejeitar ligação e sem importar o histórico. O token é o próprio da Janete.
 */
export function requisicaoCriarEvolution(b: BaseEvolution, nome: string, apiKey: string, token: string): Requisicao {
  return {
    url: `${b.base}/instance/create`,
    init: {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        instanceName: nome,
        token,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        groupsIgnore: true,
        rejectCall: false,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
      }),
    },
  };
}

/**
 * Criada, a instância espera o QR: o "Conectar" segue para o passo do QR (instancia_desconectada;
 * a tela não mostra esta frase). Na Evolution, o 401 é a chave que não é a global (auth.guard), o
 * 403 é o nome em uso (instanceLoggedGuard, antes de criar) e o 400 é a falha de dentro da criação.
 */
export function mapearCriarEvolution(r: RespostaHttp, c: CamposEvolution): ResultadoConexao {
  const { status, corpo } = r;
  if (status >= 200 && status < 300) return evolutionMsg.criada(c.instanceName);
  if (status === 401) return evolutionMsg.chaveNaoGlobal();
  if (status === 403) return evolutionMsg.nomeEmUso();
  if (status === 429) return comum.muitasChamadas("evolution");
  if (/LICENSE_REQUIRED/.test(corpoComoTexto(corpo))) return evolutionMsg.licenca();
  if (status === 404 || status === 405 || (status >= 300 && status < 400)) return evolutionMsg.naoEhEvolution();
  return evolutionMsg.naoCriou();
}

/** O 404 do connectionState que diz que a instância não existe (e não uma rota que falta). */
function instanciaNaoExiste(r: RespostaHttp): boolean {
  return r.status === 404 && /does not exist/i.test(corpoComoTexto(r.corpo));
}

async function criarEvolution(
  b: BaseEvolution,
  c: CamposEvolution,
  o: OpcoesConexao,
  criar: NonNullable<OpcoesConexao["criarEvolution"]>,
): Promise<ResultadoConexao> {
  if (!NOME_CRIAVEL.test(c.instanceName)) return evolutionMsg.nomeInvalido();
  let token: string;
  try {
    token = await criar.token(b.base, c.instanceName);
  } catch {
    return evolutionMsg.semToken();
  }
  const req = requisicaoCriarEvolution(b, c.instanceName, c.apiKey, token);
  const prazo = abrirPrazo(o.prazoMs ?? PRAZO_CRIAR_MS);
  try {
    const r = await pedir(o, prazo, req.url, req.init, [c.apiKey, token]);
    // 403: o nome passou a existir (outro "Conectar" criou antes). Nunca cria de novo: confere a
    // instância que existe e segue com ela, como se ela já estivesse lá.
    if (r.status === 403) {
      const conferir = requisicaoEvolution(b, c);
      try {
        const r2 = await pedir(o, prazo, conferir.url, conferir.init, [c.apiKey]);
        return r2.status >= 200 && r2.status < 300 ? mapearEvolution(r2, b, c) : evolutionMsg.nomeEmUso();
      } catch {
        // a conferência caiu (rede ou tempo): a instância existe, então é só tentar de novo
        return evolutionMsg.nomeEmUso();
      }
    }
    return mapearCriarEvolution(r, c);
  } catch (falhou) {
    if (falhou instanceof TempoEsgotado) return evolutionMsg.criarDemorou();
    if (falhou instanceof FalhaDeRede) return evolutionMsg.naoAlcancou();
    throw falhou;
  } finally {
    prazo.encerrar();
  }
}

async function validarEvolution(campos: Record<string, string>, o: OpcoesConexao | undefined, prazo: Prazo) {
  const c: CamposEvolution = {
    serverUrl: campo(campos, "serverUrl"),
    instanceName: nomeInstancia(campos["instanceName"]),
    apiKey: campo(campos, "apiKey"),
  };
  if (!c.serverUrl) return evolutionMsg.urlVazia();
  const base = baseEvolution(c.serverUrl);
  if (!base) return evolutionMsg.urlInvalida();
  if (!c.apiKey) return evolutionMsg.chaveVazia();
  const req = requisicaoEvolution(base, c);
  try {
    const r = await pedir(o, prazo, req.url, req.init, [c.apiKey]);
    // só cria depois do 404 de "não existe": criar um nome em uso faz a Evolution apagar a instância
    const resultado =
      o?.criarEvolution && instanciaNaoExiste(r)
        ? await criarEvolution(base, c, o, o.criarEvolution)
        : mapearEvolution(r, base, c);
    if (!resultado.ok) return resultado;
    const num = requisicaoNumeroEvolution(base, c);
    return await comNumero(resultado, async () => {
      let dono = donoEvolution(await pedir(o, prazo, num.url, num.init, [c.apiKey]), c.instanceName);
      // o dono ainda não foi gravado: lê de novo uma vez, no mesmo prazo
      if (dono.esperando) {
        await esperarNoPrazo(ESPERA_DONO_EVOLUTION_MS, prazo);
        dono = donoEvolution(await pedir(o, prazo, num.url, num.init, [c.apiKey]), c.instanceName);
      }
      return dono.numero;
    });
  } catch (falhou) {
    // servidor próprio fora do ar ou URL errada: aponta o campo da URL
    if (falhou instanceof FalhaDeRede) return evolutionMsg.naoAlcancou();
    throw falhou;
  }
}

// ---------- Descontinuado ----------

const descontinuadoNaoSuportado = () =>
  falha(
    "nao_suportado",
    "O conector do Descontinuado não tem uma forma de o app testar a conexão. Conecte o WhatsApp Business no painel do Descontinuado, em Connectors, escolha este projeto em “Incoming messages” e siga em frente.",
  );

// ---------- fluxo ----------

/**
 * Testa a credencial no gateway, sem gravar nada. A resposta traz só o rótulo (número ou
 * instância), nunca a credencial.
 */
export async function validarConexaoLogica(
  entrada: EntradaConexao,
  opcoes?: OpcoesConexao,
): Promise<ResultadoConexao> {
  const { gateway, campos } = entrada;
  if (gateway === "descontinuado") return descontinuadoNaoSuportado();
  const segredos = CAMPOS_SECRETOS[gateway].map((nome) => campos[nome] ?? "");

  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: ResultadoConexao;
  try {
    resultado =
      gateway === "meta"
        ? await validarMeta(campos, opcoes, prazo)
        : gateway === "zernio"
          ? await validarZernio(campos, opcoes, prazo)
          : gateway === "zapi"
            ? await validarZapi(campos, opcoes, prazo)
            : await validarEvolution(campos, opcoes, prazo);
  } catch (falhou) {
    if (falhou instanceof TempoEsgotado) resultado = comum.tempo(gateway);
    else if (falhou instanceof FalhaDeRede) resultado = comum.semRede(gateway);
    else resultado = comum.fora(gateway);
  } finally {
    prazo.encerrar();
  }
  return blindar(resultado, segredos);
}
