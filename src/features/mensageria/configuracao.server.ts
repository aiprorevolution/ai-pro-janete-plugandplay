// Lógica das funções de servidor da Configuração (configuracao.functions.ts): salvar a conexão
// de WhatsApp, salvar a chave de IA e ver de novo um segredo que nós geramos. Só o admin usa,
// conferido por eh_admin() com o cliente do próprio usuário. A chave e a credencial coladas
// nunca voltam na resposta; os erros são códigos fixos.
import type { FirebaseClient } from "@/integrations/firebase/client-contract";

import {
  mapearOpenRouterChave,
  requisicaoOpenRouterChave,
  validarChaveIALogica,
} from "@/features/servidor/chave-ia";
import { validarChaveElevenLabs } from "@/features/servidor/chave-elevenlabs";
import { formatarNumero, mesmoNumero, normalizarNumero } from "@/features/servidor/numero-whatsapp";
import {
  requisicaoZernio,
  validarConexaoLogica,
  type ErroConexao,
} from "@/features/servidor/conexao";
import {
  abrirPrazo,
  blindar,
  FalhaDeRede,
  ler,
  lerTexto,
  pedir,
  TempoEsgotado,
  type OpcoesValidacao,
  type Prazo,
} from "@/features/servidor/http";
import type { Database } from "@/integrations/firebase/types";

import { adaptadorDe } from "./gateways";
import { camposParaGuardarEvolution } from "./gateways/evolution/chave.server";
import { MODELO_ESCUTA_ELEVENLABS } from "./ia/fala";
import { gerarSegredo } from "./nucleo/cifra";
import { ehOrigemDePrevia } from "./nucleo/origem";
import { tokenDaInstanciaEvolution } from "./nucleo/token-evolution.server";
import {
  carregarConexao,
  carregarConexaoPorExterno,
  gravarChaveIA,
  gravarConexao,
  type ConexaoGravada,
  type TrocaIncompleta,
} from "./nucleo/conexoes.server";
import type { AvisoWebhook } from "./nucleo/desligar-webhook.server";
import { lerResumoChaveIA } from "./configuracao/banco.server";
import { segredosCompletos } from "./nucleo/segredos";
import {
  ErroGateway,
  NOMES_SEGREDOS,
  SEGREDOS_GERADOS,
  type ConexaoServidor,
  type GatewayId,
  type SegredoGerado,
} from "./nucleo/tipos";

export type ClienteUsuario = Pick<FirebaseClient<Database>, "from" | "rpc">;
export type ContextoUsuario = { firebase: ClienteUsuario; userId: string };

export type SemAcesso = { ok: false; erro: "sem_acesso" };
const SEM_ACESSO: SemAcesso = { ok: false, erro: "sem_acesso" };

// ---------- entradas ----------

export type EntradaSalvarConexao = { gateway: string; campos: Record<string, string> };

export type FinalidadeIA = "resposta" | "transcricao" | "voz";
export type ProvedorChave = "anthropic" | "openai" | "openrouter" | "gemini" | "groq" | "elevenlabs";
export type EntradaSalvarChaveIA = {
  finalidade: FinalidadeIA;
  provedor: ProvedorChave;
  modelo: string;
  chave: string;
  /**
   * Só Anthropic. Ausente = mantém o que está gravado, se o provedor for o mesmo; null = sem
   * workspace (apaga o gravado).
   */
  workspace_id?: string | null;
};

export type EntradaVerSegredo = { conexao_id: string; nome: SegredoGerado };

// ---------- respostas ----------

export type AvisoConexao = "url_de_previa" | "webhook_nao_configurado";

export type ResultadoSalvarConexao =
  | {
      ok: true;
      conexao_id: string;
      /** o rótulo da conexão (número ou instância), o mesmo gravado em conexoes.nome */
      nome: string;
      gateway: GatewayId;
      url_webhook: string;
      verifyToken?: string;
      avisos: AvisoConexao[];
      /**
       * O Trocar (decisão 10 da spec-lacunas-mensageria): o webhook da conexão que saiu ficou no
       * provedor, como no Desconectar. Ausente = não havia outra ativa, ou desligou.
       */
      conexao_anterior?: { gateway: GatewayId; aviso: AvisoWebhook };
    }
  | SemAcesso
  | { ok: false; erro: ErroConexao; campo?: string; mensagem: string }
  | { ok: false; erro: "gateway_nao_implementado" | "conexao_invalida" | ErroGravacao }
  // o Trocar que parou no meio (TEXTOS_TROCA_INCOMPLETA)
  | { ok: false; erro: "erro_ao_gravar"; mensagem: string }
  // o número do WhatsApp da Z-API e da Evolution (spec-qr-whatsapp, seção 8)
  | { ok: false; erro: "numero_invalido"; campo: "numero"; mensagem: string }
  | {
      ok: false;
      erro: "numero_diferente";
      /** os dois formatados ("+55 11 98765-4321") */
      numero_conectado: string;
      numero_informado: string;
      mensagem: string;
    };

export type ErroGravacao = "cifra_indisponivel" | "erro_ao_gravar";

/**
 * O Trocar que parou depois de mexer na conexão anterior (gravarConexao): o salvar de novo
 * termina. Sem o texto, a tela diria só "tente de novo" e o admin não saberia que a Janete parou.
 */
export const TEXTOS_TROCA_INCOMPLETA: Record<TrocaIncompleta, string> = {
  troca_sem_desativar:
    "O webhook da conexão antiga já foi desligado no provedor, mas a troca não terminou. Salve de novo para terminar: até lá, a Janete não recebe mensagens.",
  troca_sem_ativar:
    "A conexão antiga já saiu, mas a nova não ficou ativa. Salve de novo para terminar: até lá, a Janete não recebe mensagens.",
  troca_sem_ativar_no_painel:
    "A conexão antiga já saiu, mas a nova não ficou ativa. Salve de novo para terminar: até lá, a Janete não recebe mensagens. Tire também o webhook da conexão antiga no painel do provedor.",
};

function textoDaTrocaIncompleta(falhou: unknown): string | null {
  if (!(falhou instanceof Error) || !Object.hasOwn(TEXTOS_TROCA_INCOMPLETA, falhou.message)) {
    return null;
  }
  return TEXTOS_TROCA_INCOMPLETA[falhou.message as TrocaIncompleta];
}

export type ErroSalvarChave =
  | "chave_invalida"
  | "sem_permissao"
  | "sem_credito"
  | "workspace_necessario"
  | "modelo_indisponivel"
  | "provedor_fora"
  | "tempo_esgotado"
  | "provedor_nao_permitido"
  | ErroGravacao;

export type ResultadoSalvarChaveIA =
  | { ok: true; ultimos4: string; status: "ativa" }
  | SemAcesso
  | { ok: false; erro: ErroSalvarChave; mensagem: string };

export type ResultadoVerSegredo =
  | { ok: true; valor: string }
  | SemAcesso
  | { ok: false; erro: "nao_encontrado" | "cifra_indisponivel" | "cifra_invalida" | "erro_ao_ler" };

// ---------- acesso ----------

/** id do membro admin ativo do usuário; null = sem acesso. */
export async function membroAdmin(ctx: ContextoUsuario): Promise<string | null> {
  const admin = await ctx.firebase.rpc("eh_admin");
  if (admin.error || admin.data !== true) return null;
  const membro = await ctx.firebase
    .from("membros")
    .select("id")
    .eq("user_id", ctx.userId)
    .eq("ativo", true)
    .maybeSingle();
  if (membro.error || !membro.data) return null;
  return membro.data.id;
}

export function erroDeGravacao(falhou: unknown): ErroGravacao {
  return falhou instanceof Error && falhou.message === "cifra_indisponivel"
    ? "cifra_indisponivel"
    : "erro_ao_gravar";
}

// ---------- salvarConexao ----------

/** Segredos que nós geramos para o gateway (Meta: verifyToken; Zernio: webhookSecret; ...). */
export function nomesGerados(gateway: GatewayId): SegredoGerado[] {
  return SEGREDOS_GERADOS.filter((nome) => NOMES_SEGREDOS[gateway].includes(nome));
}

// ehOrigemDePrevia mora em nucleo/origem.ts (sem dependências, para o motor); reexportada aqui para
// quem já a importa deste módulo.
export { ehOrigemDePrevia };

export function montarUrlWebhook(
  origem: string,
  gateway: GatewayId,
  conexaoId: string,
  tokenUrl?: string,
): string {
  const base = `${origem.replace(/\/+$/, "")}/api/public/whatsapp/${gateway}/${conexaoId}`;
  return tokenUrl ? `${base}?t=${encodeURIComponent(tokenUrl)}` : base;
}

// ---------- Zernio sem accountId ----------

function contasDaZernio(corpo: unknown): unknown[] {
  if (Array.isArray(corpo)) return corpo;
  for (const chave of ["accounts", "data"]) {
    const v = ler(corpo, chave);
    if (Array.isArray(v)) return v;
    const dentro = ler(v, "accounts");
    if (Array.isArray(dentro)) return dentro;
  }
  return [];
}

/**
 * O formulário deixa o accountId opcional ("vazio usa o primeiro número"), e a validação do
 * onboarding aceita a primeira conta de WhatsApp. Aqui pega o id dessa mesma primeira conta
 * (GET /v1/accounts?platform=whatsapp, accounts[]._id). null = nenhuma conta ou falha.
 */
export async function primeiraContaZernio(
  apiKey: string,
  opcoes: OpcoesValidacao,
): Promise<string | null> {
  const req = requisicaoZernio({ apiKey });
  const prazo = abrirPrazo(opcoes.prazoMs);
  try {
    const r = await pedir(opcoes, prazo, `${req.url}?platform=whatsapp`, req.init, [apiKey]);
    if (r.status < 200 || r.status >= 300) return null;
    for (const conta of contasDaZernio(r.corpo)) {
      const plataforma =
        lerTexto(conta, "platform") ?? lerTexto(conta, "type") ?? lerTexto(conta, "channel");
      if (plataforma !== undefined && !/whatsapp/i.test(plataforma)) continue;
      const id = lerTexto(conta, "accountId") ?? lerTexto(conta, "_id") ?? lerTexto(conta, "id");
      if (id?.trim()) return id.trim();
    }
    return null;
  } catch {
    return null;
  } finally {
    prazo.encerrar();
  }
}

export type OpcoesSalvarConexao = OpcoesValidacao & {
  /** origem do pedido (ex.: https://app.exemplo.com), sem barra no fim */
  origem: string;
};

export async function salvarConexaoLogica(
  ctx: ContextoUsuario,
  entrada: EntradaSalvarConexao,
  opcoes: OpcoesSalvarConexao,
): Promise<ResultadoSalvarConexao> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;

  const { origem, ...opcoesValidacao } = opcoes;
  // Z-API e Evolution: o número do WhatsApp, conferido antes de falar com o gateway (seção 8)
  const pedeNumero = entrada.gateway === "zapi" || entrada.gateway === "evolution";
  const informado = pedeNumero ? normalizarNumero(entrada.campos["numero"] ?? "") : null;
  if (pedeNumero && !informado) {
    return {
      ok: false,
      erro: "numero_invalido",
      campo: "numero",
      mensagem:
        "Digite o número do WhatsApp com DDD, por exemplo 11 98765-4321. De outro país, comece com + e o código.",
    };
  }
  const validacao = await validarConexaoLogica(
    {
      gateway: entrada.gateway as Parameters<typeof validarConexaoLogica>[0]["gateway"],
      campos: entrada.campos,
    },
    // só o "Conectar" cria a instância da Evolution que não existe (spec-qr-whatsapp, seção 7)
    { ...opcoesValidacao, criarEvolution: { token: tokenDaInstanciaEvolution } },
  );
  if (!validacao.ok) return validacao;
  // o celular que leu o QR é de outro número: nada é gravado, e a tela pergunta o que fazer
  if (informado && validacao.numero && !mesmoNumero(validacao.numero, informado)) {
    const conectado = formatarNumero(validacao.numero);
    const digitado = formatarNumero(informado);
    return {
      ok: false,
      erro: "numero_diferente",
      numero_conectado: conectado,
      numero_informado: digitado,
      mensagem: `Este celular é do ${conectado}, não do ${digitado} que você informou.`,
    };
  }
  // o nome é o número como a pessoa digitou; o guardado é o que o WhatsApp informou, se informou
  const nomeConexao = informado ? formatarNumero(informado) : validacao.rotulo;

  const adaptador = adaptadorDe(entrada.gateway);
  if (!adaptador) return { ok: false, erro: "gateway_nao_implementado" };
  const gateway = adaptador.gateway;

  // Evolution: o nome efetivo ("janete" quando vazio) e, se a Janete criou a instância, o token próprio
  let campos = { ...entrada.campos };
  if (gateway === "evolution") {
    const guardar = await camposParaGuardarEvolution(entrada.campos, opcoesValidacao);
    if (!guardar.ok) return guardar;
    campos = guardar.campos;
  }
  if (gateway === "zernio" && !(campos["accountId"] ?? "").trim()) {
    const conta = await primeiraContaZernio((campos["apiKey"] ?? "").trim(), opcoesValidacao);
    if (!conta) {
      return {
        ok: false,
        erro: "nao_encontrado",
        campo: "accountId",
        mensagem:
          "Não achamos um número de WhatsApp nessa conta da Zernio. Informe o ID da conta e tente de novo.",
      };
    }
    campos["accountId"] = conta;
  }

  const gerados: Partial<Record<SegredoGerado, string>> = {};
  for (const nome of nomesGerados(gateway)) gerados[nome] = gerarSegredo();

  let montada: ReturnType<typeof adaptador.montarConexao>;
  try {
    montada = adaptador.montarConexao(campos, gerados);
  } catch (falhou) {
    if (falhou instanceof ErroGateway && falhou.codigo === "gateway_nao_implementado") {
      return { ok: false, erro: "gateway_nao_implementado" };
    }
    return { ok: false, erro: "conexao_invalida" };
  }
  // Zernio salva de novo (mesma conta): mantém o webhookSecret atual. Se o PUT do webhook
  // falhar, a Zernio continua assinando com ele e o webhook segue valendo.
  if (gateway === "zernio") {
    try {
      const atual = await carregarConexaoPorExterno(gateway, montada.id_externo);
      const segredoAtual = atual?.segredos["webhookSecret"];
      if (segredoAtual) gerados.webhookSecret = segredoAtual;
    } catch {
      // sem a atual, segue com o segredo novo
    }
  }
  // os gerados valem sobre o que o adaptador devolver, para a URL e o banco baterem
  const segredos: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(montada.segredos)) {
    if (typeof valor === "string") segredos[nome] = valor;
  }
  for (const [nome, valor] of Object.entries(gerados)) {
    if (valor !== undefined) segredos[nome] = valor;
  }
  // Conexão ativa com segredo vazio deixaria o webhook validar com chave vazia. Para os
  // adaptadores: montarConexao devolve todos os NOMES_SEGREDOS do gateway que não são gerados
  // (Meta: token e appSecret), senão o salvar responde conexao_invalida.
  if (!segredosCompletos(gateway, segredos)) return { ok: false, erro: "conexao_invalida" };

  let gravada: ConexaoGravada;
  try {
    gravada = await gravarConexao({
      gateway,
      nome: nomeConexao,
      id_externo: montada.id_externo,
      parametros: informado
        ? { ...montada.parametros, numero: validacao.numero ?? informado }
        : montada.parametros,
      segredos,
      membroId,
    });
  } catch (falhou) {
    const mensagem = textoDaTrocaIncompleta(falhou);
    if (mensagem) return { ok: false, erro: "erro_ao_gravar", mensagem };
    return { ok: false, erro: erroDeGravacao(falhou) };
  }
  const conexaoId = gravada.id;

  const url_webhook = montarUrlWebhook(origem, gateway, conexaoId, gerados.tokenUrl);
  const avisos: AvisoConexao[] = [];
  if (ehOrigemDePrevia(origem)) avisos.push("url_de_previa");

  if (adaptador.configurarWebhook && !ehOrigemDePrevia(origem)) {
    const conexao: ConexaoServidor = {
      id: conexaoId,
      gateway,
      id_externo: montada.id_externo,
      parametros: montada.parametros,
      segredos,
      oficial: gateway === "meta" || gateway === "zernio",
    };
    try {
      await adaptador.configurarWebhook(conexao, url_webhook);
    } catch {
      avisos.push("webhook_nao_configurado");
    }
  }

  const resultado: ResultadoSalvarConexao = {
    ok: true,
    conexao_id: conexaoId,
    nome: nomeConexao,
    gateway,
    url_webhook,
    avisos,
  };
  if (gateway === "meta" && gerados.verifyToken) resultado.verifyToken = gerados.verifyToken;
  if (gravada.anterior) resultado.conexao_anterior = gravada.anterior;
  return resultado;
}

// ---------- salvarChaveIA ----------

const GROQ_MODELOS = "https://api.groq.com/openai/v1/models";

export type FalhaChave = { ok: false; erro: ErroSalvarChave; mensagem: string };

export function falhaChave(erro: ErroSalvarChave, mensagem: string): FalhaChave {
  return { ok: false, erro, mensagem };
}

const msgGroq = {
  chaveVazia: () => falhaChave("chave_invalida", "Cole a chave de API da Groq para continuar."),
  modeloVazio: () =>
    falhaChave("modelo_indisponivel", "Escolha um modelo antes de testar a chave."),
  chaveInvalida: () =>
    falhaChave(
      "chave_invalida",
      "A Groq não reconheceu a chave. Confira se copiou a chave inteira e se ela ainda está ativa no console da Groq.",
    ),
  semPermissao: () =>
    falhaChave(
      "sem_permissao",
      "A chave da Groq existe, mas não tem permissão para listar os modelos.",
    ),
  modelo: (modelo: string) =>
    falhaChave(
      "modelo_indisponivel",
      `A chave funciona, mas o modelo ${modelo.trim()} não está disponível para ela na Groq. Escolha outro modelo.`,
    ),
  muitas: () =>
    falhaChave(
      "provedor_fora",
      "A Groq está recebendo chamadas demais agora. Espere um minuto e tente de novo.",
    ),
  fora: () =>
    falhaChave(
      "provedor_fora",
      "A Groq não respondeu como esperado. Pode ser uma instabilidade do lado dela: tente de novo em alguns minutos.",
    ),
  semRede: () =>
    falhaChave(
      "provedor_fora",
      "Não conseguimos falar com a Groq agora. Tente de novo em alguns minutos.",
    ),
  tempo: () =>
    falhaChave(
      "tempo_esgotado",
      "A Groq demorou mais de 10 segundos para responder. Tente de novo em instantes.",
    ),
};

/** Testa a chave da Groq com GET /openai/v1/models. null = aceita. */
export async function validarGroq(
  chave: string,
  modelo: string,
  opcoes?: OpcoesValidacao,
): Promise<FalhaChave | null> {
  const limpa = chave.trim();
  if (!limpa) return msgGroq.chaveVazia();
  if (!modelo.trim()) return msgGroq.modeloVazio();
  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: FalhaChave | null;
  try {
    const r = await pedir(
      opcoes,
      prazo,
      GROQ_MODELOS,
      { method: "GET", headers: { Authorization: `Bearer ${limpa}` } },
      [chave],
    );
    if (r.status >= 200 && r.status < 300) {
      const lista = ler(r.corpo, "data");
      const achou =
        !Array.isArray(lista) || lista.some((item) => lerTexto(item, "id") === modelo.trim());
      resultado = achou ? null : msgGroq.modelo(modelo);
    } else if (r.status === 401) resultado = msgGroq.chaveInvalida();
    else if (r.status === 403) resultado = msgGroq.semPermissao();
    else if (r.status === 429) resultado = msgGroq.muitas();
    else resultado = msgGroq.fora();
  } catch (falhou) {
    if (falhou instanceof TempoEsgotado) resultado = msgGroq.tempo();
    else if (falhou instanceof FalhaDeRede) resultado = msgGroq.semRede();
    else resultado = msgGroq.fora();
  } finally {
    prazo.encerrar();
  }
  return resultado ? blindar(resultado, [chave]) : null;
}

/** Na transcrição, a OpenRouter só confere a chave e o saldo (whisper não usa ferramentas). */
async function validarOpenRouterSoChave(
  chave: string,
  opcoes: OpcoesValidacao | undefined,
): Promise<FalhaChave | null> {
  const prazo: Prazo = abrirPrazo(opcoes?.prazoMs);
  try {
    const req = requisicaoOpenRouterChave({ provedor: "openrouter", chave, modelo: "" });
    const erro = mapearOpenRouterChave(await pedir(opcoes, prazo, req.url, req.init, [chave]));
    return erro && !erro.ok ? blindar(erro, [chave]) : null;
  } catch (falhou) {
    if (falhou instanceof TempoEsgotado) {
      return falhaChave(
        "tempo_esgotado",
        "A OpenRouter demorou mais de 10 segundos para responder. Tente de novo em instantes.",
      );
    }
    return falhaChave(
      "provedor_fora",
      "Não conseguimos falar com a OpenRouter agora. Tente de novo em alguns minutos.",
    );
  } finally {
    prazo.encerrar();
  }
}

/**
 * A conferência grátis da chave (lista de modelos ou contagem de tokens, sem gerar resposta).
 * null = aceita.
 */
export async function validarChave(
  entrada: EntradaSalvarChaveIA,
  opcoes: OpcoesValidacao | undefined,
): Promise<FalhaChave | null> {
  const { provedor, finalidade, chave, modelo } = entrada;
  // a ElevenLabs não tem modelo a conferir (na voz e na escuta): só a chave e o crédito
  // (servidor/chave-elevenlabs.ts)
  if (provedor === "elevenlabs") return validarChaveElevenLabs(chave, opcoes);
  if (provedor === "groq") return validarGroq(chave, modelo, opcoes);
  if (provedor === "openrouter" && finalidade === "transcricao") {
    if (!chave.trim())
      return falhaChave("chave_invalida", "Cole a chave de API da OpenRouter para continuar.");
    if (!modelo.trim())
      return falhaChave("modelo_indisponivel", "Escolha um modelo antes de testar a chave.");
    return validarOpenRouterSoChave(chave, opcoes);
  }
  const r = await validarChaveIALogica(
    entrada.workspace_id
      ? { provedor, chave, modelo, workspaceId: entrada.workspace_id }
      : { provedor, chave, modelo },
    opcoes,
  );
  return r.ok ? null : r;
}

/**
 * O modelo que vai para o banco. A voz nasce sem modelo ("ainda não escolhido", P1 da spec da
 * voz) e a escuta pela ElevenLabs usa o Scribe, fixo (docs/spec-escuta-elevenlabs.md P3): nos
 * dois, o pedido não escolhe.
 */
function modeloGravado(entrada: EntradaSalvarChaveIA): string {
  if (entrada.finalidade === "voz") return "";
  if (entrada.provedor === "elevenlabs") return MODELO_ESCUTA_ELEVENLABS;
  return entrada.modelo.trim();
}

export async function salvarChaveIALogica(
  ctx: ContextoUsuario,
  entrada: EntradaSalvarChaveIA,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoSalvarChaveIA> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;

  if (entrada.provedor === "groq" && entrada.finalidade !== "transcricao") {
    return falhaChave(
      "provedor_nao_permitido",
      "A Groq só pode ser usada na transcrição de áudio.",
    );
  }
  // a ElevenLabs na voz e na escuta, e a voz só com a ElevenLabs (os checks do banco: a 0012 e a
  // da escuta, docs/spec-escuta-elevenlabs.md B1)
  if (entrada.provedor === "elevenlabs" && entrada.finalidade === "resposta") {
    return falhaChave(
      "provedor_nao_permitido",
      "A ElevenLabs não responde às mensagens: ela fica na voz e na escuta.",
    );
  }
  if (entrada.finalidade === "voz" && entrada.provedor !== "elevenlabs") {
    return falhaChave("provedor_nao_permitido", "A voz da Janete usa uma chave da ElevenLabs.");
  }
  if ((entrada.provedor === "anthropic" || entrada.provedor === "gemini") && entrada.finalidade === "transcricao") {
    return falhaChave(
      "provedor_nao_permitido",
      "Este provedor responde às mensagens. Para a transcrição, use uma chave da OpenAI, da OpenRouter, da Groq ou da ElevenLabs.",
    );
  }

  // workspace ausente = o gravado, se a chave guardada é do mesmo provedor (a tela de trocar a
  // chave não pede o workspace de novo); null = sem workspace
  let workspace = entrada.workspace_id;
  if (workspace === undefined && entrada.provedor === "anthropic") {
    try {
      const atual = await lerResumoChaveIA(entrada.finalidade);
      workspace = atual?.provedor === entrada.provedor ? atual.workspace_id : null;
    } catch {
      return falhaChave(
        "erro_ao_gravar",
        "Não conseguimos ler a chave guardada agora. Tente de novo em instantes.",
      );
    }
  }
  const comWorkspace: EntradaSalvarChaveIA = { ...entrada, workspace_id: workspace ?? null };

  const falhou = await validarChave(comWorkspace, opcoes);
  if (falhou) return falhou;

  try {
    const { ultimos4 } = await gravarChaveIA({
      finalidade: entrada.finalidade,
      provedor: entrada.provedor,
      modelo: modeloGravado(entrada),
      workspace_id: entrada.provedor === "anthropic" && workspace ? workspace : null,
      chave: entrada.chave,
      membroId,
    });
    return { ok: true, ultimos4, status: "ativa" };
  } catch (erro) {
    const codigo = erroDeGravacao(erro);
    return falhaChave(
      codigo,
      codigo === "cifra_indisponivel"
        ? "O servidor não está pronto para guardar chaves agora. Avise o suporte."
        : "Não conseguimos guardar a chave agora. Tente de novo em instantes.",
    );
  }
}

// ---------- verSegredoGerado ----------

export async function verSegredoGeradoLogica(
  ctx: ContextoUsuario,
  entrada: EntradaVerSegredo,
): Promise<ResultadoVerSegredo> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  if (!(SEGREDOS_GERADOS as readonly string[]).includes(entrada.nome)) {
    return { ok: false, erro: "nao_encontrado" };
  }
  let conexao: ConexaoServidor | null;
  try {
    conexao = await carregarConexao(entrada.conexao_id);
  } catch (falhou) {
    const msg = falhou instanceof Error ? falhou.message : "";
    if (msg === "cifra_indisponivel" || msg === "cifra_invalida") return { ok: false, erro: msg };
    return { ok: false, erro: "erro_ao_ler" };
  }
  const valor = conexao?.segredos[entrada.nome];
  if (!conexao || typeof valor !== "string") return { ok: false, erro: "nao_encontrado" };
  return { ok: true, valor };
}
