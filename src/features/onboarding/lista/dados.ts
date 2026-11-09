// Dados de tela das etapas conexão e cérebro, copiados do F (F-Final.dc.html: LOGO, IC, MODOS,
// PROVS, MOTORES, DISCO_TOPO, TOPO_NASCE, FASES_*). O que o F fazia de demonstração (erro
// simulado, número de exemplo, valores gerados de exemplo) não entra: o erro e o rótulo vêm das
// funções de servidor, e o que só existe quando o processamento for ligado aparece marcado.

import type { ProvedorIA } from "@/features/servidor/chave-ia";
import type { Gateway, ModoConexao } from "@/features/onboarding/estado";
import type { Gateway as GatewayServidor } from "@/features/servidor/conexao";

/** Logos reais em public/logos/ (qual é qual: regras/logos.md). */
export const LOGO = {
  whatsapp: "/logos/whatsapp.svg",
  meta: "/logos/meta.svg",
  zernio: "/logos/zernio-icone.svg",
  descontinuado: "/brand/aipro-icone.png",
  gemini: "/logos/gemini.svg",
  zapi: "/logos/zapi-logo.png",
  evolution: "/logos/evolution-logo-claro.webp",
  anthropic: "/logos/anthropic.svg",
  openai: "/logos/openai.svg",
  openrouter: "/logos/openrouter-icone.svg",
  /** O símbolo oficial do kit de marca (elevenlabs.io/brand); a marca não troca o ícone por "II". */
  elevenlabs: "/logos/elevenlabs-icone.svg",
} as const;

export const IC = {
  ok: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M9 12l2 2 4-4",
  pendente: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0",
  alerta: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 8v4M12 16h.01",
  triangulo: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01",
  seta: "M5 12h14M12 5l7 7-7 7",
  chevronDireita: "m9 18 6-6-6-6",
  chevronEsquerda: "m15 18-6-6 6-6",
  copiar: "M8 8h12v12H8zM4 16V4h12",
  feito: "M20 6 9 17l-5-5",
  lupa: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M21 21l-4.3-4.3",
  microfone: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3M19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  cadeado: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4",
} as const;

/** Centro do disco da validação dentro do cartão (10,5rem do topo): é ali que o cartão vira o logo. */
export const DISCO_TOPO = 168;
/** Centro do círculo de onde o cartão da conexão nasce no login (24 px de folga + raio de 48 px). */
export const TOPO_NASCE = 72;

/** Duração mínima da animação da validação (F): 2,86 e 1,86 voltas da moeda de 1,1 s. */
export const GIRO_WHATSAPP_MS = 3150;
export const GIRO_IA_MS = 2050;
/** Sem movimento, as linhas de status ainda andam, mas mais rápido (F). */
export const GIRO_REDUZIDO_MS = 1100;
/** Uma volta da moeda (keyframes `moeda`). */
export const VOLTA_MOEDA_MS = 1100;

/** "qr": o passo do QR code da Z-API e da Evolution, entre o "Conectar" e o "Conectado" (spec-qr-whatsapp). */
export type Fase = "form" | "fechando" | "verificando" | "ok" | "erro" | "qr" | "reabrindo";

export const FASES_FECHADAS: readonly Fase[] = ["fechando", "verificando", "ok", "erro", "qr", "reabrindo"];
export const FASES_SOB: readonly Fase[] = ["verificando", "ok", "erro", "qr", "reabrindo"];
export const FASES_PALCO: readonly Fase[] = ["fechando", "verificando", "ok", "erro", "qr"];

export interface Modo {
  id: ModoConexao;
  titulo: string;
  resumo: string;
  selo: string;
  estadoClasse: "ok" | "atencao";
  icone: string;
  estadoIcone: string;
  linha: string;
}

export const MODOS: readonly Modo[] = [
  {
    id: "oficial",
    titulo: "Oficial",
    resumo: "Oficial, pela API do WhatsApp",
    selo: "Sem risco de bloqueio",
    estadoClasse: "ok",
    icone:
      "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4",
    estadoIcone: IC.ok,
    linha: "API oficial do WhatsApp. Segue a janela de 24 horas e usa modelos de mensagem aprovados.",
  },
  {
    id: "naooficial",
    titulo: "Não oficial",
    resumo: "Não oficial, pelo QR code",
    selo: "Pode ser bloqueado",
    estadoClasse: "atencao",
    icone:
      "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h4v4H7zM13 13h4v4h-4z",
    estadoIcone: IC.triangulo,
    linha: "Conecta pelo QR code. Mais flexível, mas o número corre risco de bloqueio.",
  },
];

export interface CampoGateway {
  /** id do campo em conexao.ts (CamposMeta, CamposZernio, CamposZapi, CamposEvolution) */
  id: string;
  label: string;
  ph: string;
  segredo?: boolean;
  ajuda?: string;
  /** Sem ele o botão Conectar já libera (o F pede todos; o accountId da Zernio é opcional). */
  opcional?: boolean;
  /** Ocupa a linha inteira na grade de 2 colunas (a URL do servidor Evolution). */
  largo?: boolean;
  /** Telefone: type, inputMode e autocomplete "tel" (o número do WhatsApp, spec-qr-whatsapp seção 8). */
  tel?: boolean;
}

/** O 1º campo da Z-API e da Evolution: o número do celular que vai ler o QR code (seção 8). */
const CAMPO_NUMERO: CampoGateway = {
  id: "numero",
  label: "Número do WhatsApp",
  ph: "11 98765-4321",
  ajuda: "O do celular que vai ler o QR code, com DDD. De outro país, comece com + e o código.",
  tel: true,
};

/**
 * Valor que o app gera e a pessoa cola no painel do gateway (o endereço do webhook e o verify token
 * da Meta). Ele só existe depois do "Conectar" (salvarConexao): antes, o painel mostra um marcador,
 * nunca um valor inventado, e o valor de verdade aparece no quadro de sucesso (decisão 14b).
 */
export type Gerado = { id: string; label: string; pendente: true };

/** Selo de dificuldade de cada provedor (rodada 2, item 1b). */
export type Dificuldade = "facil" | "medio" | "dificil";

export const DIFICULDADE: Record<Dificuldade, { rotulo: string; tom: "menta" | "areia" | "rosa" }> = {
  facil: { rotulo: "Fácil", tom: "menta" },
  medio: { rotulo: "Médio", tom: "areia" },
  dificil: { rotulo: "Difícil", tom: "rosa" },
};

export interface Provedor {
  id: GatewayServidor;
  modo: ModoConexao;
  nome: string;
  curto: string;
  logo: string;
  logoAlt: string;
  /** "escura" (Z-API, nome branco: vai sobre grafite) e "larga" (logo com nome). */
  escura?: boolean;
  larga?: boolean;
  /** Fácil: Zernio e Z-API; Médio: Evolution (servidor próprio); Difícil: API oficial da Meta. */
  dificuldade: Dificuldade;
  linha: string;
  campos: readonly CampoGateway[];
  geradosTitulo?: string;
  gerados: readonly Gerado[];
  /** As 3 linhas de status da validação. */
  passos: readonly [string, string, string];
}

/**
 * Os provedores, por gateway. O onboarding só oferece os de ORDEM_PROVS (sem o Descontinuado, decisão
 * 14a); a entrada do Descontinuado fica só para a Configuração ler uma conexão antiga desse tipo.
 */
export const PROVS: Record<Gateway, Provedor> & Record<GatewayServidor, Provedor> = {
  meta: {
    id: "meta",
    dificuldade: "dificil",
    modo: "oficial",
    nome: "API oficial da Meta",
    curto: "Meta",
    logo: LOGO.meta,
    logoAlt: "Meta",
    linha: "Direto na Meta, com o app do seu WhatsApp Business.",
    campos: [
      { id: "phoneId", label: "Phone Number ID", ph: "Só números", ajuda: "No app da Meta, em WhatsApp > Configuração da API." },
      { id: "wabaId", label: "ID da conta do WhatsApp Business", ph: "Só números" },
      { id: "token", label: "Token de acesso permanente", segredo: true, ph: "Cole o token aqui" },
      { id: "appSecret", label: "App Secret", segredo: true, ph: "Cole o App Secret aqui" },
    ],
    geradosTitulo: "Gerado por nós. Depois de conectar, cole no painel da Meta.",
    gerados: [
      { id: "url", label: "URL do webhook", pendente: true },
      { id: "verify", label: "Verify token", pendente: true },
    ],
    passos: ["Falando com a Meta", "Conferindo token e App Secret", "Lendo o número da conta"],
  },
  zernio: {
    id: "zernio",
    dificuldade: "facil",
    modo: "oficial",
    nome: "Zernio",
    curto: "Zernio",
    logo: LOGO.zernio,
    logoAlt: "Zernio",
    linha: "Pela API oficial, via Zernio. Você só cola uma chave.",
    campos: [
      { id: "apiKey", label: "Chave de API", segredo: true, ph: "Cole a chave da Zernio" },
      {
        id: "accountId",
        label: "ID da conta (opcional)",
        ph: "Deixe vazio para usar o primeiro número",
        ajuda: "Só se a sua chave tiver mais de um número de WhatsApp.",
        opcional: true,
        // o placeholder é longo: ocupa a linha inteira (e a chave, que sobra sozinha, também)
        largo: true,
      },
    ],
    // a Zernio recebe o endereço do webhook sozinha, no "Conectar"
    gerados: [],
    passos: ["Falando com a Zernio", "Conferindo a chave de API", "Lendo o número conectado"],
  },
  descontinuado: {
    id: "descontinuado",
    dificuldade: "facil",
    modo: "oficial",
    nome: "Integração indisponível",
    curto: "Indisponível",
    logo: LOGO.descontinuado,
    logoAlt: "AI PRO Janete",
    linha: "Selecione uma das integrações disponíveis.",
    campos: [],
    gerados: [],
    passos: ["Integração indisponível", "Selecione outra integração", "Conecte seu número"],
  },
  zapi: {
    id: "zapi",
    dificuldade: "facil",
    modo: "naooficial",
    nome: "Z-API",
    curto: "Z-API",
    logo: LOGO.zapi,
    logoAlt: "Z-API",
    escura: true,
    larga: true,
    linha: "Instância pronta, conectada pelo QR code.",
    campos: [
      CAMPO_NUMERO,
      { id: "instanceId", label: "ID da instância", ph: "Ex.: 3C2A…" },
      { id: "instanceToken", label: "Token da instância", segredo: true, ph: "Cole o token" },
      {
        id: "clientToken",
        label: "Client-Token",
        segredo: true,
        ph: "Cole o Client-Token",
        ajuda: "Fica na aba Segurança da sua conta Z-API.",
      },
    ],
    gerados: [],
    passos: ["Falando com a Z-API", "Conferindo a instância e os tokens", "Lendo o número conectado"],
  },
  evolution: {
    id: "evolution",
    dificuldade: "medio",
    modo: "naooficial",
    nome: "Evolution",
    curto: "Evolution",
    logo: LOGO.evolution,
    logoAlt: "Evolution",
    larga: true,
    linha: "O seu próprio servidor Evolution.",
    campos: [
      CAMPO_NUMERO,
      { id: "serverUrl", label: "URL do servidor", ph: "https://evolution.suaempresa.com.br", largo: true },
      // vazio usa a "janete"; a instância que não existe, a Janete cria (spec-qr-whatsapp, seção 7)
      {
        id: "instanceName",
        label: "Nome da instância (opcional)",
        ph: "janete",
        ajuda: "Vazio usa a “janete”. Se a instância não existir no servidor, a Janete cria (com a chave global).",
        opcional: true,
      },
      {
        id: "apiKey",
        label: "Chave de API",
        segredo: true,
        ph: "Cole a chave global do servidor",
        ajuda: "A chave global do servidor (AUTHENTICATION_API_KEY, no .env da Evolution). Para uma instância que já existe, a chave dela também serve.",
      },
    ],
    gerados: [],
    passos: ["Alcançando o seu servidor", "Conferindo ou criando a instância", "Lendo o número conectado"],
  },
};

/**
 * Os campos que ocupam a linha inteira quando o painel está em 2 colunas: os marcados `largo` e,
 * em cada trecho entre eles, o último quando o trecho é ímpar (para nenhum campo ficar sozinho
 * com meia linha vazia ao lado).
 */
export function camposLargos(campos: readonly CampoGateway[]): Set<string> {
  const largos = new Set<string>();
  let trecho: string[] = [];
  const fechar = () => {
    if (trecho.length % 2 === 1) largos.add(trecho[trecho.length - 1]!);
    trecho = [];
  };
  for (const c of campos) {
    if (c.largo) {
      fechar();
      largos.add(c.id);
    } else trecho.push(c.id);
  }
  fechar();
  return largos;
}

/** Sem o conector do Descontinuado (decisão 14a): ele não grava a conexão nem recebe as mensagens. */
export const ORDEM_PROVS: readonly Gateway[] = ["meta", "zernio", "zapi", "evolution"];

export function provsDoModo(modo: ModoConexao): Gateway[] {
  return ORDEM_PROVS.filter((id) => PROVS[id].modo === modo);
}

export interface Motor {
  id: ProvedorIA;
  nome: string;
  /** artigo do nome: "a Anthropic", "o OpenRouter" */
  artigo: "a" | "o";
  logo: string;
  linha: string;
  /**
   * OpenRouter: a lista é pública (abre sem chave, com a busca) e a chave vem depois dela. Nos
   * outros, a chave vem antes: buscar a lista no provedor já confere a chave.
   */
  busca?: boolean;
}

export const MOTORES: readonly Motor[] = [
  { id: "gemini", nome: "Google Gemini", artigo: "o", logo: LOGO.gemini, linha: "Use sua chave do Google AI Studio e escolha um modelo disponível na sua conta." },
  { id: "anthropic", nome: "Anthropic", artigo: "a", logo: LOGO.anthropic, linha: "Os modelos Claude, como Haiku, Sonnet e Opus." },
  { id: "openai", nome: "OpenAI", artigo: "a", logo: LOGO.openai, linha: "Os modelos GPT, da OpenAI." },
  {
    id: "openrouter",
    nome: "OpenRouter",
    artigo: "o",
    logo: LOGO.openrouter,
    linha: "Modelos de vários fabricantes, como Claude, GPT e Gemini, com uma chave só.",
    busca: true,
  },
];

export function acharMotor(id: ProvedorIA | null | undefined): Motor | null {
  return MOTORES.find((m) => m.id === id) ?? null;
}

/* ---------- texto ---------- */

export function curto(t: string, n: number): string {
  const s = String(t || "").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export function juntar(lista: readonly string[]): string {
  if (lista.length <= 1) return lista.join("");
  return lista.slice(0, -1).join(", ") + " e " + lista[lista.length - 1];
}

/**
 * Separa a mensagem da função em título (a primeira frase) e texto (o resto), como o F mostra o
 * erro: "A Meta não aceitou o token." + "Ele pode ter expirado...".
 */
export function separarMensagem(mensagem: string): { titulo: string; texto: string } {
  const limpa = mensagem.trim();
  const fim = /[.!?](\s|$)/.exec(limpa);
  if (!fim) return { titulo: limpa, texto: "" };
  const corte = fim.index + 1;
  return { titulo: limpa.slice(0, corte).trim(), texto: limpa.slice(corte).trim() };
}

/** Texto quando a chamada à função falhou antes de responder (sem rede, sessão caída). */
export const MENSAGEM_SEM_RESPOSTA =
  "Não conseguimos fazer o teste agora. Confira a sua internet e tente de novo em instantes.";

/** Texto quando a chamada foi recusada porque a sessão terminou (saiu em outra aba, por exemplo). */
export const MENSAGEM_SEM_SESSAO = "Sua sessão terminou. Entre de novo para continuar.";

/**
 * O texto das recusas que as funções de gravar (salvarConexao, salvarChaveIA) devolvem sem
 * `mensagem`: a conta não é admin, ou o servidor não conseguiu guardar.
 */
export const MENSAGEM_DO_ERRO: Readonly<Record<string, string>> = {
  sem_acesso: "Sua conta não pode configurar a Janete. Só o admin da empresa faz esta etapa.",
  cifra_indisponivel: "O servidor não está pronto para guardar credenciais agora. Avise o suporte.",
  erro_ao_gravar: "Não conseguimos guardar agora. Tente de novo em instantes.",
  conexao_invalida: "Os dados desta conexão não fecharam. Confira os campos e tente de novo.",
  gateway_nao_implementado: "Este provedor ainda não está disponível. Escolha outro.",
};

/** A mensagem de uma recusa: a que a função mandou, ou a da tabela acima pelo código. */
export function mensagemDoResultado(r: { erro: string; mensagem?: string }): string {
  const propria = typeof r.mensagem === "string" ? r.mensagem.trim() : "";
  return propria || MENSAGEM_DO_ERRO[r.erro] || MENSAGEM_SEM_RESPOSTA;
}
