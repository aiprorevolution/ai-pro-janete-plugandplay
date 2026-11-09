// Dados de tela da Configuração 3 ("O caminho da mensagem", docs/mockups/plataforma/Configuracao-3.dc.html).
// O que já existe no onboarding (logos, ícones, gateways, motores, dificuldade) vem de lá, só por
// import; aqui fica só o que a Configuração acrescenta: os erros de cada gateway na troca, a escuta
// de áudio (OpenAI, Groq ou ElevenLabs), as situações e os textos que dependem de artigo ("a Anthropic", "o
// OpenRouter").

import type { RespostaQr } from "@/features/onboarding/conexao/qr/useLeituraQr";
import { LOGO, PROVS, type Motor, type Provedor } from "@/features/onboarding/lista/dados";

import type { EstadoQr, ResultadoConfiguracao } from "../dados/configuracao";
import type { Gateway, ProvedorIA, StatusChave, StatusConexao } from "../exemplo";

/* ---------- gateways ---------- */

/** Os gateways que a Configuração oferece: o conector do Descontinuado saiu (decisão 14a). */
export type GatewayCfg = Exclude<Gateway, "descontinuado">;

/** Os gateways da troca, na ordem do protótipo (sem o conector do Descontinuado). */
export const ORDEM_GATEWAYS: readonly GatewayCfg[] = ["meta", "zernio", "zapi", "evolution"];

/** O gateway da tela (nulo para o "descontinuado", que o banco ainda aceita mas a tela não oferece). */
export function provDe(gateway: Gateway | null | undefined): Provedor | null {
  if (!gateway || gateway === "descontinuado") return null;
  return PROVS[gateway] ?? null;
}

/** Conectam pelo QR code: o conserto é "Mostrar o QR code" no cartão, com os dados guardados, sem colar nada. */
export const GATEWAY_QR: Partial<Record<Gateway, true>> = { zapi: true, evolution: true };

/** O botão do conserto do número caído na Z-API e na Evolution (cartão e Saúde). */
export const MOSTRAR_QR = "Mostrar o QR code";

/** A queda sem citar o botão: uma constatação, que a atendente também pode ler. */
export const LEIA_QR_DE_NOVO = "Falta ler o QR code de novo para a Janete voltar a atender.";

/** O que o admin lê abaixo do aviso, com o QR fechado: onde ler o QR code. */
export const APONTA_QR = `Use o botão "${MOSTRAR_QR}", aqui embaixo.`;

/** O resultado da camada de dados no formato do passo do QR (useLeituraQr). */
export function respostaQr(r: ResultadoConfiguracao<EstadoQr>): RespostaQr {
  if (r.ok) return { ok: true, conectado: r.conectado, qr: r.qr, passkey: r.passkey };
  return { ok: false, erro: r.erro, ...(r.mensagem ? { mensagem: r.mensagem } : {}), ...(r.campo ? { campo: r.campo } : {}) };
}

/** API oficial: quando cai, em geral é o token que venceu (o campo que se cola de novo). */
export const CAMPO_TOKEN: Partial<Record<Gateway, string>> = { meta: "token", zernio: "apiKey" };

export interface ErroGateway {
  /** O campo marcado quando a pessoa volta para corrigir. */
  campo: string;
  titulo: string;
  texto: string;
  campoTexto: string;
}

/** O erro simulado de cada gateway na troca (copiado do protótipo). */
export const ERRO_GATEWAY: Record<GatewayCfg, ErroGateway> = {
  meta: {
    campo: "token",
    titulo: "A Meta não aceitou o token.",
    texto:
      "Ele pode ter expirado ou estar sem permissão para enviar mensagens. Gere um token permanente no Gerenciador de Negócios e cole de novo.",
    campoTexto: "Este token foi recusado. Cole um token permanente novo.",
  },
  zernio: {
    campo: "apiKey",
    titulo: "A Zernio não reconheceu a chave.",
    texto:
      "Confira se você copiou a chave inteira, sem espaço no começo ou no fim, e se ela ainda está ativa no painel da Zernio.",
    campoTexto: "Chave recusada. Copie de novo do painel da Zernio.",
  },
  zapi: {
    campo: "clientToken",
    titulo: "A Z-API recusou o Client-Token.",
    texto:
      "Ele fica na aba Segurança da sua conta Z-API, separado do token da instância. Copie de lá e tente de novo.",
    campoTexto: "Este Client-Token não confere. Copie da aba Segurança.",
  },
  evolution: {
    campo: "apiKey",
    titulo: "O servidor respondeu, mas recusou a chave.",
    texto:
      "Confira se é a chave de API do servidor ou a da instância, copiada inteira. O endereço e o nome da instância estão certos.",
    campoTexto: "Chave recusada pelo servidor. Copie de novo.",
  },
};

/** O que a situação da conexão diz no cartão e no fio. */
export const NOME_SITUACAO_W: Record<StatusConexao, string> = {
  conectada: "Conectado",
  conectando: "Conectando…",
  desconectada: "Desconectado",
  erro: "Com erro",
};

/** O erro padrão quando a conexão caiu e o banco não guardou o motivo. */
export function erroPadraoW(gateway: Gateway, situacao: StatusConexao): string {
  const curto = provDe(gateway)?.curto ?? "provedora";
  if (situacao === "erro") return `A ${curto} respondeu com erro ao enviar. Os dados guardados podem ter mudado no painel da ${curto}.`;
  // sem citar o botão (a atendente também lê): o cartão do admin aponta para "Mostrar o QR code"
  if (GATEWAY_QR[gateway]) return `A ${curto} avisou que o número saiu do WhatsApp no celular. ${LEIA_QR_DE_NOVO}`;
  return `A ${curto} parou de aceitar os dados guardados. Cole o token novo.`;
}

/** O número de exemplo de uma conexão nova (no exemplo, o gateway não devolve número de verdade). */
export const NUMERO_EXEMPLO = "(11) 90000-0000";

/** O endereço do webhook (CLAUDE.md, "Depois do remix"): só a Meta precisa colar. */
export function urlWebhook(gateway: Gateway, conexao: string): string {
  const origem = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "[endereço da plataforma]";
  return `${origem}/api/public/whatsapp/${gateway}/${conexao}`;
}

/* ---------- cérebro e escuta ---------- */

export const NOME_SITUACAO_C: Record<StatusChave, string> = {
  ativa: "Chave ativa",
  sem_credito: "Sem crédito",
  invalida: "Chave inválida",
  removida: "Chave removida",
};

/** Quem transcreve os áudios: uma segunda chave, de finalidade "transcricao". */
export interface Transcritor {
  id: Extract<ProvedorIA, "openai" | "groq" | "elevenlabs">;
  nome: string;
  artigo: "a" | "o";
  /** Groq não tem logo enviado: monograma "G", com o nome escrito ao lado. */
  logo: string | null;
  linha: string;
  /**
   * O modelo de transcrição padrão do servidor (MODELOS_TRANSCRICAO em
   * src/features/mensageria/ia/transcrever.server.ts, copiado porque arquivo .server não vai ao navegador).
   */
  modelo: string;
}

export const TRANSCRITORES: readonly Transcritor[] = [
  {
    id: "openai",
    nome: "OpenAI",
    artigo: "a",
    logo: LOGO.openai,
    linha: "Transcreve os áudios com os modelos de voz da OpenAI.",
    modelo: "gpt-transcribe",
  },
  { id: "groq", nome: "Groq", artigo: "a", logo: null, linha: "Transcrição rápida, com uma chave da Groq.", modelo: "whisper-large-v3-turbo" },
  // o Scribe (MODELO_ESCUTA_ELEVENLABS, fixo: sem escolha de modelo; spec da escuta com a ElevenLabs, P3)
  {
    id: "elevenlabs",
    nome: "ElevenLabs",
    artigo: "a",
    logo: LOGO.elevenlabs,
    linha: "Transcreve com o Scribe. A mesma chave também pode dar a voz da Janete.",
    modelo: "scribe_v2",
  },
];

export function acharTranscritor(id: ProvedorIA | null | undefined): Transcritor | null {
  return TRANSCRITORES.find((t) => t.id === id) ?? null;
}

/* ---------- voz ---------- */

/** Quem dá a voz à Janete: um provedor só, a ElevenLabs (finalidade "voz"). */
export interface ProvedorVoz {
  id: Extract<ProvedorIA, "elevenlabs">;
  nome: string;
  artigo: "a" | "o";
  logo: string;
  linha: string;
}

export const PROVEDOR_VOZ: ProvedorVoz = {
  id: "elevenlabs",
  nome: "ElevenLabs",
  artigo: "a",
  logo: LOGO.elevenlabs,
  linha: "Vozes realistas e transcrição de áudio, com uma chave só.",
};

/** Os 3 passos da validação, os mesmos do onboarding (o servidor só confere a chave e o crédito). */
export const PASSOS_VOZ: readonly string[] = ["Falando com a ElevenLabs", "Conferindo a chave", "Conferindo os créditos da conta"];

/** A ajuda do campo da chave, a mesma do onboarding. */
export const AJUDA_CHAVE_VOZ =
  "Na ElevenLabs, crie a chave em Developers → API Keys e ligue os acessos User, Text to Speech, Speech to Text e Voices (leitura).";

/** A ajuda do campo da chave da ElevenLabs no cartão Escuta: a escuta pede só User e Speech to Text. */
export const AJUDA_CHAVE_ESCUTA_ELEVENLABS =
  "Na ElevenLabs, crie a chave em Developers → API Keys e ligue os acessos User e Speech to Text. Para usar a mesma chave na voz, ligue também Text to Speech e Voices (leitura).";

/* ---------- texto ---------- */

type ComArtigo = Pick<Motor, "nome" | "artigo"> | Pick<Transcritor, "nome" | "artigo"> | Pick<ProvedorVoz, "nome" | "artigo">;

/** "a Anthropic", "o OpenRouter". */
export function artigoNome(o: ComArtigo | null | undefined): string {
  if (!o) return "";
  return `${o.artigo === "o" ? "o" : "a"} ${o.nome}`;
}

/** "da Anthropic", "do OpenRouter". */
export function deNome(o: ComArtigo | null | undefined): string {
  if (!o) return "";
  return `${o.artigo === "o" ? "do" : "da"} ${o.nome}`;
}

export function maiuscula(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Os 4 últimos caracteres da chave colada (só letras e números, em maiúsculas). Sem inventar: vazio se não houver. */
export function ultimos4De(chave: string): string {
  return chave.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
}

/** A chave colada tem ao menos 4 letras ou números seguidos (o final que a tela mostra). */
export function chaveTemFinal(chave: string): boolean {
  return /[A-Za-z0-9]{4,}/.test(chave);
}

/** A chave colada vai dar erro na simulação: a caixa "Simular" marcada, ou "invalid"/"erro" no texto. */
export function vaiDarErro(simular: boolean, valores: readonly string[]): boolean {
  return simular || valores.some((v) => /invalid|erro/i.test(v));
}

/**
 * Devolve o resultado da ação depois de um tempo mínimo (o giro e a animação não somem num piscar),
 * o que vier depois. As ações da camada de dados nunca lançam.
 */
export function comMinimo<T>(acao: Promise<T>, ms: number): Promise<T> {
  return Promise.all([acao, new Promise((r) => setTimeout(r, ms))]).then(([v]) => v);
}
