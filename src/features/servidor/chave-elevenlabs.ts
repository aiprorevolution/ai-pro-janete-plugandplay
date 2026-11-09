// Validação da chave da ElevenLabs (a voz da Janete). Lógica pura: monta o pedido e traduz a
// resposta para o contrato da spec (docs/spec-voz-elevenlabs.md, seção 2). Quem salva a chave
// (salvarChaveIALogica, em mensageria/configuracao.server.ts) só chama validarChaveElevenLabs.
//
// Endpoint: GET /v1/user com o cabeçalho xi-api-key (sem Authorization). É grátis e precisa do
// acesso User da chave. A resposta traz o crédito da conta em `subscription`
// (character_limit − character_count), que serve para recusar uma conta sem crédito.
// - 401 traz `detail.status`: invalid_api_key (chave inválida), missing_permissions (sem o
//   acesso User) ou quota_exceeded (sem crédito). 403 vem de um bloqueio da chave (lista de IP).
// - Text to Speech e Speech to Text não se conferem sem gastar crédito: por isso a tela diz
//   quais acessos ligar, e um erro de permissão neles só aparece no uso.
// - Só o endereço padrão: contas com residência de dados (Enterprise) ficam fora.
//
// Este arquivo não importa nada de src/features/mensageria: FalhaVoz tem a mesma forma da
// FalhaChave de lá, e o despacho (validarChave) a devolve como veio.
//
// msgElevenLabs, falhaDaResposta e falhaDoErro são exportadas para os outros pedidos à
// ElevenLabs (a lista e a conferência das vozes, em vozes-elevenlabs.ts), que seguem a mesma
// tabela de status.

import {
  abrirPrazo,
  blindar,
  FalhaDeRede,
  ler,
  lerNumero,
  lerTexto,
  pedir,
  TempoEsgotado,
  type OpcoesValidacao,
  type RespostaHttp,
} from "./http";

export const ELEVENLABS_USUARIO = "https://api.elevenlabs.io/v1/user";

export type ErroChaveVoz =
  | "chave_invalida"
  | "sem_permissao"
  | "sem_credito"
  | "provedor_fora"
  | "tempo_esgotado";

export type FalhaVoz = { ok: false; erro: ErroChaveVoz; mensagem: string };

function falhaVoz(erro: ErroChaveVoz, mensagem: string): FalhaVoz {
  return { ok: false, erro, mensagem };
}

// Mensagens fixas em pt-BR; a primeira frase vira o título na tela.
export const msgElevenLabs = {
  chaveVazia: () =>
    falhaVoz("chave_invalida", "Cole a chave de API da ElevenLabs para continuar."),
  chaveInvalida: () =>
    falhaVoz(
      "chave_invalida",
      "A ElevenLabs não reconheceu a chave. Confira se copiou a chave inteira e se ela ainda está ativa na ElevenLabs.",
    ),
  semAcessos: () =>
    falhaVoz(
      "sem_permissao",
      "A chave existe, mas não tem os acessos que a Janete usa. Na ElevenLabs, edite a chave e ligue User, Text to Speech, Speech to Text e Voices.",
    ),
  bloqueada: () =>
    falhaVoz(
      "sem_permissao",
      "A ElevenLabs recusou o acesso desta chave. Confira as permissões e a lista de endereços de IP da chave na ElevenLabs.",
    ),
  semCredito: () =>
    falhaVoz(
      "sem_credito",
      "A conta da ElevenLabs está sem créditos. Recarregue a conta ou cole a chave de outra conta.",
    ),
  muitas: () =>
    falhaVoz(
      "provedor_fora",
      "A ElevenLabs está recebendo chamadas demais agora. Espere um minuto e tente de novo.",
    ),
  fora: () =>
    falhaVoz(
      "provedor_fora",
      "A ElevenLabs não respondeu como esperado. Pode ser uma instabilidade do lado dela: tente de novo em alguns minutos.",
    ),
  semRede: () =>
    falhaVoz(
      "provedor_fora",
      "Não conseguimos falar com a ElevenLabs agora. Tente de novo em alguns minutos.",
    ),
  tempo: () =>
    falhaVoz(
      "tempo_esgotado",
      "A ElevenLabs demorou mais de 10 segundos para responder. Tente de novo em instantes.",
    ),
};

/**
 * true quando a conta acabou o crédito e não pode passar do limite. Campos ausentes aceitam a
 * chave: sem limite ou sem contagem, não dá para dizer que acabou.
 */
function semCreditoNaConta(corpo: unknown): boolean {
  const limite = lerNumero(corpo, "subscription", "character_limit");
  const usado = lerNumero(corpo, "subscription", "character_count");
  if (limite === undefined || usado === undefined) return false;
  if (limite - usado > 0) return false;
  // Sem extensão: max_credit_limit_extension === 0 ou, sem esse campo,
  // can_extend_character_limit === false. Um "unlimited" (ou outro valor) conta como extensão.
  const extensao = ler(corpo, "subscription", "max_credit_limit_extension");
  if (extensao !== undefined && extensao !== null) {
    return lerNumero(corpo, "subscription", "max_credit_limit_extension") === 0;
  }
  return ler(corpo, "subscription", "can_extend_character_limit") === false;
}

/** Traduz o 401: o `detail.status` diz se é chave, permissão ou crédito. */
function falhaDo401(corpo: unknown): FalhaVoz {
  const status = (lerTexto(corpo, "detail", "status") ?? "").toLowerCase();
  if (status.includes("permission")) return msgElevenLabs.semAcessos();
  if (status.includes("quota")) return msgElevenLabs.semCredito();
  return msgElevenLabs.chaveInvalida();
}

/**
 * Traduz o status de uma resposta da ElevenLabs: 2xx dá null (quem chama lê o corpo); 401 pelo
 * `detail.status`; 403 é bloqueio da chave; 429 é chamada demais; o resto, provedor fora.
 */
export function falhaDaResposta(r: RespostaHttp): FalhaVoz | null {
  if (r.status >= 200 && r.status < 300) return null;
  if (r.status === 401) return falhaDo401(r.corpo);
  if (r.status === 403) return msgElevenLabs.bloqueada();
  if (r.status === 429) return msgElevenLabs.muitas();
  return msgElevenLabs.fora();
}

/** Traduz o erro lançado pelo pedir (tempo, rede ou outro), sem a mensagem original. */
export function falhaDoErro(e: unknown): FalhaVoz {
  if (e instanceof TempoEsgotado) return msgElevenLabs.tempo();
  if (e instanceof FalhaDeRede) return msgElevenLabs.semRede();
  return msgElevenLabs.fora();
}

/** Testa a chave da ElevenLabs com GET /v1/user. null = aceita. */
export async function validarChaveElevenLabs(
  chave: string,
  opcoes?: OpcoesValidacao,
): Promise<FalhaVoz | null> {
  const limpa = chave.trim();
  if (!limpa) return msgElevenLabs.chaveVazia();
  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: FalhaVoz | null;
  try {
    const r = await pedir(
      opcoes,
      prazo,
      ELEVENLABS_USUARIO,
      { method: "GET", headers: { "xi-api-key": limpa } },
      [chave],
    );
    resultado = falhaDaResposta(r);
    if (!resultado && semCreditoNaConta(r.corpo)) resultado = msgElevenLabs.semCredito();
  } catch (falhou) {
    resultado = falhaDoErro(falhou);
  } finally {
    prazo.encerrar();
  }
  return resultado ? blindar(resultado, [chave]) : null;
}
