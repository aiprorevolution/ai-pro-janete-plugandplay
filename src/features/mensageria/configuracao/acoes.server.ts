// Lógica das ações da Configuração que trabalham com o que já está guardado (spec
// docs/spec-ligar-telas-banco.md, 2.4): desconectar e conferir a conexão, consertar um campo da
// Meta, conferir de novo a chave de IA, listar os modelos e trocar o modelo sem colar a chave,
// remover a chave de áudio e salvar o ritmo; a voz em uso (docs/spec-voz-uso.md, C2): listar
// e escolher a voz e salvar quando a Janete fala; e usar a chave da ElevenLabs de um cartão no
// outro (docs/spec-escuta-elevenlabs.md, S2). Só o admin (membroAdmin). A chave e as
// credenciais guardadas nunca voltam na resposta; os erros são códigos fixos.
import {
  validarConexaoLogica,
  type ErroConexao,
  type ResultadoConexao,
} from "@/features/servidor/conexao";
import {
  abrirPrazo,
  blindar,
  FalhaDeRede,
  ler,
  lerTexto,
  pedir,
  PRAZO_MS,
  TempoEsgotado,
  type OpcoesValidacao,
} from "@/features/servidor/http";
import { msgElevenLabs, validarChaveElevenLabs } from "@/features/servidor/chave-elevenlabs";
import type { ModeloListado, ResultadoListarModelos } from "@/features/servidor/listar-modelos";
import { listarModelosLogica } from "@/features/servidor/listar-modelos-logica";
import {
  conferirVozElevenLabs,
  listarVozesElevenLabs,
  type FalhaVozes,
} from "@/features/servidor/vozes-elevenlabs";
import type { ModoVoz, VozDaConta, VozEscolhida } from "@/features/servidor/vozes-tipos";

import {
  erroDeGravacao,
  falhaChave,
  membroAdmin,
  validarChave,
  type ContextoUsuario,
  type ErroGravacao,
  type FalhaChave,
  type FinalidadeIA,
  type SemAcesso,
} from "../configuracao.server";
import { adaptadorDe } from "../gateways";
import { MODELO_ESCUTA_ELEVENLABS } from "../ia/fala";
import { MODELOS_TRANSCRICAO } from "../ia/transcrever.server";
import { conexaoAtiva, gravarChaveIA, lerChaveIA, type ChaveIA } from "../nucleo/conexoes.server";
import {
  AVISO_DO_WEBHOOK,
  desligarWebhookDaConexao,
  detalheDoWebhook,
  TETO_DESLIGAR_WEBHOOK_MS,
  type AvisoWebhook,
} from "../nucleo/desligar-webhook.server";
import { pararFilaDaConexao } from "../nucleo/parar-fila.server";
import { segredosCompletos } from "../nucleo/segredos";
import type { ConexaoServidor, GatewayId } from "../nucleo/tipos";
import {
  apagarChave,
  auditar,
  desativarConexao,
  gravarErroVoz,
  gravarModeloChave,
  gravarModoVoz,
  gravarRitmo,
  gravarStatusChave,
  gravarStatusConexao,
  gravarVoz,
  idConexaoAtiva,
  lerConfigVozTela,
  lerResumoChaveIA,
  regravarConexao,
  type ConfigVozTela,
} from "./banco.server";
import { conferirNumeroDaConexao, type RecusaNumeroDiferente } from "./numero.server";

const SEM_ACESSO: SemAcesso = { ok: false, erro: "sem_acesso" };

export type ErroLeitura = "cifra_indisponivel" | "cifra_invalida" | "erro_ao_ler";

function erroDeLeitura(falhou: unknown): ErroLeitura {
  const msg = falhou instanceof Error ? falhou.message : "";
  return msg === "cifra_indisponivel" || msg === "cifra_invalida" ? msg : "erro_ao_ler";
}

// ---------- entradas ----------

export type EntradaFinalidade = { finalidade: FinalidadeIA };
export type EntradaTrocarModelo = { finalidade: FinalidadeIA; modelo: string };

/** Campos da Meta que dá para consertar sozinhos. O Phone Number ID muda a conexão: não entra. */
export const CAMPOS_CONSERTO_META = ["token", "appSecret", "wabaId"] as const;
export type CampoConsertoMeta = (typeof CAMPOS_CONSERTO_META)[number];
export type EntradaConsertarCampo = { campo: CampoConsertoMeta; valor: string };

export type EntradaRitmo = { espera: number; teto: number };

/** Limites do ritmo, em segundos (os mesmos do check da tabela no pacote do banco). */
export const LIMITES_RITMO = {
  espera: { min: 2, max: 30 },
  teto: { min: 20, max: 120 },
  /** o teto fica pelo menos esta folga acima da espera */
  folga: 5,
} as const;

// ---------- respostas ----------

/**
 * O webhook no provedor depois do Desconectar (decisão 4 da spec-lacunas-mensageria):
 * webhook_no_painel = o gateway não tem API para desligar (Meta e Z-API), a tela lembra de tirar no
 * painel; webhook_nao_desligado = tinha e falhou (ou estourou o tempo). Sem aviso = desligou.
 */
export type AvisoDesconectar = AvisoWebhook;

/** Teto do desligar do webhook no Desconectar; o mesmo do Trocar, no nucleo. */
export { TETO_DESLIGAR_WEBHOOK_MS };

export type ResultadoDesconectar =
  | { ok: true; conexao_id: string; aviso?: AvisoDesconectar }
  | SemAcesso
  | { ok: false; erro: "sem_conexao" | "erro_ao_ler" | "erro_ao_gravar"; mensagem?: string };

/**
 * O webhook já foi desligado no provedor e o desativar falhou: a conexão segue ativa, mas a Janete não
 * recebe mais nada. O Desconectar de novo desliga outra vez (sem efeito) e termina.
 */
export const TEXTO_WEBHOOK_DESLIGADO_SEM_DESCONECTAR =
  "O webhook já foi desligado no provedor, mas a conexão não. Desconecte de novo para terminar: até lá, a Janete não recebe mensagens.";

/** Status da conexão depois da conferência; ausente = a falha foi passageira e nada mudou. */
export type StatusConferido = "conectada" | "desconectada" | "erro";

export type ResultadoConferirConexao =
  | { ok: true; conexao_id: string; gateway: GatewayId; nome: string; status: "conectada" }
  | SemAcesso
  | {
      ok: false;
      erro: ErroConexao;
      campo?: string;
      mensagem: string;
      status?: Exclude<StatusConferido, "conectada">;
    }
  | { ok: false; erro: "sem_conexao" | "conexao_invalida" | ErroLeitura | "erro_ao_gravar" }
  | RecusaNumeroDiferente;

export type ResultadoConsertarCampo =
  | { ok: true; conexao_id: string; gateway: "meta"; nome: string }
  | SemAcesso
  | { ok: false; erro: ErroConexao; campo?: string; mensagem: string }
  | { ok: false; erro: "campo_vazio"; campo: CampoConsertoMeta }
  | {
      ok: false;
      erro: "sem_conexao" | "so_meta" | "conexao_invalida" | ErroLeitura | ErroGravacao;
    };

type FaltaChave = { ok: false; erro: "sem_chave" | ErroLeitura };

/**
 * Na voz, a conferência também olha a voz escolhida (P12 da spec do uso da voz): "ok" (existe na
 * conta), "nao_encontrada" (grava configuracao.voz_erro) ou "sem_voz" (nenhuma escolhida).
 */
export type VozConferida = "ok" | "nao_encontrada" | "sem_voz";

export type ResultadoRevalidarChave =
  | { ok: true; status: "ativa"; provedor: ChaveIA["provedor"]; modelo: string; voz?: VozConferida }
  | SemAcesso
  | FaltaChave
  | (FalhaChave & { status?: "invalida" | "sem_credito" });

export type ResultadoListarModelosDaChave =
  ResultadoListarModelos | SemAcesso | FaltaChave | { ok: false; erro: "provedor_nao_permitido" };

export type ResultadoTrocarModelo =
  { ok: true; modelo: string; status: "ativa" } | SemAcesso | FaltaChave | FalhaChave;

export type ResultadoRemoverChave =
  | { ok: true }
  | SemAcesso
  | { ok: false; erro: "nao_permitido" | "sem_chave" | "erro_ao_ler" | "erro_ao_gravar" };

export type ResultadoSalvarRitmo =
  | { ok: true; espera: number; teto: number }
  | SemAcesso
  | { ok: false; erro: "fora_do_limite"; campo: "espera" | "teto" }
  | { ok: false; erro: "erro_ao_gravar" };

// ---------- voz em uso: entradas e respostas (docs/spec-voz-uso.md, contrato C2) ----------

export type EntradaEscolherVoz = { vozId: string };
export type EntradaModoVoz = { modo: ModoVoz };

/** As vozes da conta da chave guardada e a voz escolhida hoje (configuracao). Não grava nada. */
export type ResultadoListarVozes =
  | { ok: true; vozes: VozDaConta[]; atual: VozEscolhida | null }
  | SemAcesso
  | FaltaChave
  | FalhaVozes;

export type ResultadoEscolherVoz =
  | { ok: true; voz: VozEscolhida }
  | SemAcesso
  | FaltaChave
  | FalhaVozes
  | { ok: false; erro: "erro_ao_gravar"; mensagem: string };

export type ResultadoSalvarModoVoz =
  | { ok: true; modo: ModoVoz }
  | SemAcesso
  | { ok: false; erro: "erro_ao_gravar"; mensagem: string };

// ---------- a chave da ElevenLabs nos dois cartões (docs/spec-escuta-elevenlabs.md, contrato S2) ----------

/** O cartão que recebe a cópia; a origem é o outro (a voz ↔ a escuta). */
export type EntradaUsarChaveElevenLabs = {
  para: "voz" | "transcricao";
  /** Onboarding: só copia se o destino está vazio ou já é da ElevenLabs (a de outro provedor fica). */
  seLivre?: boolean;
};

/** copiada: false = nada gravado (seLivre, e o destino tem a chave de outro provedor ou já a mesma). */
export type ResultadoUsarChaveElevenLabs =
  | { ok: true; copiada: true; ultimos4: string; status: "ativa" }
  | { ok: true; copiada: false }
  | SemAcesso
  | FaltaChave
  | FalhaChave;

// ---------- conexão ----------

function textoDe(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Os campos do formulário do gateway, remontados a partir de parametros, id_externo e segredos
 * guardados (o caminho inverso do montarConexao de cada adaptador).
 */
export function camposGuardados(c: ConexaoServidor): Record<string, string> {
  const p = c.parametros;
  const s = c.segredos;
  if (c.gateway === "meta") {
    const wabaId = textoDe(p["wabaId"]);
    return {
      phoneId: textoDe(p["phoneId"]) || c.id_externo,
      token: s["token"] ?? "",
      appSecret: s["appSecret"] ?? "",
      ...(wabaId ? { wabaId } : {}),
    };
  }
  if (c.gateway === "zernio") return { apiKey: s["apiKey"] ?? "", accountId: c.id_externo };
  if (c.gateway === "zapi") {
    return {
      instanceId: textoDe(p["instanceId"]) || c.id_externo,
      instanceToken: s["instanceToken"] ?? "",
      clientToken: s["clientToken"] ?? "",
    };
  }
  return {
    serverUrl: textoDe(p["serverUrl"]),
    instanceName: c.id_externo,
    apiKey: s["apiKey"] ?? "",
  };
}

type ConexaoLida =
  { ok: true; conexao: ConexaoServidor } | { ok: false; erro: "sem_conexao" | ErroLeitura };

async function lerConexaoAtiva(): Promise<ConexaoLida> {
  try {
    const conexao = await conexaoAtiva();
    return conexao ? { ok: true, conexao } : { ok: false, erro: "sem_conexao" };
  } catch (falhou) {
    return { ok: false, erro: erroDeLeitura(falhou) };
  }
}

export async function desconectarConexaoLogica(
  ctx: ContextoUsuario,
  opcoes?: { tetoWebhookMs?: number },
): Promise<ResultadoDesconectar> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  let id: string | null;
  try {
    id = await idConexaoAtiva();
  } catch {
    return { ok: false, erro: "erro_ao_ler" };
  }
  if (!id) return { ok: false, erro: "sem_conexao" };
  // antes de desativar: o gatilho da 0000 apaga os segredos quando a conexão é desativada
  const webhook = await desligarWebhookDaConexao(
    conexaoAtiva,
    id,
    opcoes?.tetoWebhookMs ?? TETO_DESLIGAR_WEBHOOK_MS,
  );
  try {
    await desativarConexao(id);
  } catch {
    // sem auditoria: o enum não tem ação para o webhook sozinho, e conexao_desativada é lida pela
    // Configuração como quem desligou; o Desconectar de novo audita com o webhook
    return webhook.resultado === "desligado"
      ? { ok: false, erro: "erro_ao_gravar", mensagem: TEXTO_WEBHOOK_DESLIGADO_SEM_DESCONECTAR }
      : { ok: false, erro: "erro_ao_gravar" };
  }
  // decisão 11: a Janete para em silêncio. Melhor esforço: a falha fica na auditoria e não desfaz o
  // Desconectar
  const fila = await pararFilaDaConexao(id);
  await auditar({
    acao: "conexao_desativada",
    alvo: id,
    ator_membro_id: membroId,
    detalhe: {
      ...detalheDoWebhook(webhook),
      ...(fila.length > 0 ? { fila_causa: fila.join(",") } : {}),
    },
  });
  const aviso = AVISO_DO_WEBHOOK[webhook.resultado];
  return aviso ? { ok: true, conexao_id: id, aviso } : { ok: true, conexao_id: id };
}

/** Falha que não é da conexão (o gateway fora do ar ou lento): não muda o status gravado. */
const ERROS_PASSAGEIROS: readonly ErroConexao[] = ["servidor_inacessivel", "tempo_esgotado"];

export async function conferirConexaoLogica(
  ctx: ContextoUsuario,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoConferirConexao> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  const lida = await lerConexaoAtiva();
  if (!lida.ok) return lida;
  const c = lida.conexao;
  if (!segredosCompletos(c.gateway, c.segredos)) return { ok: false, erro: "conexao_invalida" };

  const validacao = await validarConexaoLogica(
    { gateway: c.gateway, campos: camposGuardados(c) },
    opcoes,
  );
  if (validacao.ok) {
    // o número do WhatsApp (spec-qr-whatsapp, seção 8): outro número desconecta; sem número salvo, grava
    const numero = await conferirNumeroDaConexao(c, validacao, opcoes);
    if (numero) return numero;
    try {
      await gravarStatusConexao(c.id, "conectada", null);
    } catch {
      return { ok: false, erro: "erro_ao_gravar" };
    }
    return {
      ok: true,
      conexao_id: c.id,
      gateway: c.gateway,
      nome: validacao.rotulo,
      status: "conectada",
    };
  }
  if (ERROS_PASSAGEIROS.includes(validacao.erro)) return validacao;
  const status = validacao.erro === "instancia_desconectada" ? "desconectada" : "erro";
  try {
    await gravarStatusConexao(c.id, status, validacao.erro);
  } catch {
    return { ok: false, erro: "erro_ao_gravar" };
  }
  return { ...validacao, status };
}

export async function consertarCampoConexaoLogica(
  ctx: ContextoUsuario,
  entrada: EntradaConsertarCampo,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoConsertarCampo> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  const lida = await lerConexaoAtiva();
  if (!lida.ok) return lida;
  const c = lida.conexao;
  if (c.gateway !== "meta") return { ok: false, erro: "so_meta" };

  const valor = entrada.valor.trim();
  if (!valor && entrada.campo !== "wabaId") {
    return { ok: false, erro: "campo_vazio", campo: entrada.campo };
  }
  const campos = camposGuardados(c);
  if (valor) campos[entrada.campo] = valor;
  else delete campos[entrada.campo];

  const validacao: ResultadoConexao = await validarConexaoLogica(
    { gateway: "meta", campos },
    opcoes,
  );
  if (!validacao.ok) return validacao;

  const adaptador = adaptadorDe("meta");
  if (!adaptador) return { ok: false, erro: "conexao_invalida" };
  // o verifyToken é o guardado: o painel da Meta continua valendo, sem colar de novo
  const verifyToken = c.segredos["verifyToken"];
  let montada: ReturnType<typeof adaptador.montarConexao>;
  try {
    montada = adaptador.montarConexao(campos, verifyToken ? { verifyToken } : {});
  } catch {
    return { ok: false, erro: "conexao_invalida" };
  }
  const segredos: Record<string, string> = {};
  for (const [nome, v] of Object.entries(montada.segredos)) {
    if (typeof v === "string") segredos[nome] = v;
  }
  if (
    montada.id_externo !== c.id_externo ||
    segredos["verifyToken"] !== verifyToken ||
    !segredosCompletos("meta", segredos)
  ) {
    return { ok: false, erro: "conexao_invalida" };
  }
  try {
    await regravarConexao(c.id, {
      nome: validacao.rotulo,
      parametros: montada.parametros,
      segredos,
    });
  } catch (falhou) {
    return { ok: false, erro: erroDeGravacao(falhou) };
  }
  return { ok: true, conexao_id: c.id, gateway: "meta", nome: validacao.rotulo };
}

// ---------- chave de IA ----------

type ChaveLida = { ok: true; chave: ChaveIA } | FaltaChave;

async function lerChaveGuardada(finalidade: FinalidadeIA): Promise<ChaveLida> {
  try {
    const chave = await lerChaveIA(finalidade);
    return chave && chave.chave.trim() ? { ok: true, chave } : { ok: false, erro: "sem_chave" };
  } catch (falhou) {
    return { ok: false, erro: erroDeLeitura(falhou) };
  }
}

/**
 * Status que a falha da conferência deixa na chave; null = não muda nada. Como no núcleo, só a
 * chave recusada (401) vira 'invalida', que faz o lerChaveUtilizavel deixar de usar a chave (e a
 * Janete parar de responder). sem_permissao, workspace_necessario e modelo_indisponivel podem ser
 * só de configuração: voltam como erro, sem mudar o status.
 */
function statusDaFalha(erro: FalhaChave["erro"]): "invalida" | "sem_credito" | null {
  if (erro === "sem_credito") return "sem_credito";
  if (erro === "chave_invalida") return "invalida";
  return null;
}

export async function revalidarChaveIALogica(
  ctx: ContextoUsuario,
  entrada: EntradaFinalidade,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoRevalidarChave> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  const lida = await lerChaveGuardada(entrada.finalidade);
  if (!lida.ok) return lida;
  const k = lida.chave;
  // na voz, a conferência da voz escolhida usa o que sobra do mesmo prazo
  const inicio = Date.now();
  const falhou = await validarChave(
    {
      finalidade: entrada.finalidade,
      provedor: k.provedor,
      modelo: k.modelo,
      chave: k.chave,
      workspace_id: k.workspace_id,
    },
    opcoes,
  );
  if (!falhou) {
    // a chave da ElevenLabs sem um acesso (Text to Speech ou Speech to Text) passa no GET
    // /v1/user, que não confere esses acessos: voltar para ativa faria o cartão alternar a cada
    // áudio (P7). Só a chave salva de novo (Trocar a chave) volta a valer. Vale na voz e na
    // escuta (docs/spec-escuta-elevenlabs.md P11).
    if (k.provedor === "elevenlabs") {
      let resumo: Awaited<ReturnType<typeof lerResumoChaveIA>>;
      try {
        resumo = await lerResumoChaveIA(entrada.finalidade);
      } catch {
        return { ok: false, erro: "erro_ao_ler" };
      }
      if (resumo?.status === "invalida" && resumo.ultimo_erro === "sem_permissao") {
        return { ...msgElevenLabs.semAcessos(), status: "invalida" };
      }
    }
    try {
      await gravarStatusChave(k.id, "ativa", null);
    } catch {
      return falhaChave(
        "erro_ao_gravar",
        "A chave funciona, mas não conseguimos atualizar o status agora. Tente de novo em instantes.",
      );
    }
    const ok = { ok: true, status: "ativa", provedor: k.provedor, modelo: k.modelo } as const;
    if (entrada.finalidade !== "voz") return ok;
    const voz = await conferirVozGuardada(k.chave, inicio, opcoes);
    return voz ? { ...ok, voz } : ok;
  }
  const status = statusDaFalha(falhou.erro);
  if (!status) return falhou;
  try {
    await gravarStatusChave(k.id, status, falhou.erro);
  } catch {
    // a resposta da conferência vale mesmo sem o status gravado
    return falhou;
  }
  return { ...falhou, status };
}

/**
 * A voz escolhida ainda existe na conta (P12 da spec do uso da voz)? GET /v1/voices/{id}, grátis,
 * no que sobra dos 10 s depois do GET /v1/user. Grava ou limpa o configuracao.voz_erro.
 * null = não deu para saber (a leitura da configuração falhou, ou a ElevenLabs não respondeu
 * como esperado): nada muda e a resposta sai sem o campo voz.
 */
async function conferirVozGuardada(
  chave: string,
  inicio: number,
  opcoes?: OpcoesValidacao,
): Promise<VozConferida | null> {
  let config: ConfigVozTela;
  try {
    config = await lerConfigVozTela();
  } catch {
    return null;
  }
  if (!config.voz) return "sem_voz";
  const sobra = Math.max(1, (opcoes?.prazoMs ?? PRAZO_MS) - (Date.now() - inicio));
  const r = await conferirVozElevenLabs(chave, config.voz.id, { ...opcoes, prazoMs: sobra });
  if (!r.ok && r.erro !== "voz_nao_encontrada") return null;
  const erro = r.ok ? null : "voz_nao_encontrada";
  if (config.erro !== erro) {
    try {
      await gravarErroVoz(config.voz.id, erro);
    } catch {
      // a resposta da conferência vale mesmo sem o erro gravado (ou se a voz mudou no meio)
    }
  }
  return r.ok ? "ok" : "nao_encontrada";
}

const URL_MODELOS_TRANSCRICAO = {
  openai: "https://api.openai.com/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
} as const;

const NOME_TRANSCRITOR = { openai: "OpenAI", groq: "Groq" } as const;

/** Modelos de voz da chave de transcrição (whisper e transcribe), pela lista do provedor. */
export async function listarModelosTranscricao(
  provedor: "openai" | "groq",
  chave: string,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoListarModelos> {
  const nome = NOME_TRANSCRITOR[provedor];
  const falha = (erro: FalhaChave["erro"], mensagem: string) =>
    ({ ok: false, erro, mensagem }) as ResultadoListarModelos;
  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: ResultadoListarModelos;
  try {
    const r = await pedir(
      opcoes,
      prazo,
      URL_MODELOS_TRANSCRICAO[provedor],
      { method: "GET", headers: { Authorization: `Bearer ${chave.trim()}` } },
      [chave],
    );
    const lista = ler(r.corpo, "data");
    if (r.status >= 200 && r.status < 300 && Array.isArray(lista)) {
      const modelos: ModeloListado[] = [];
      for (const item of lista) {
        const id = lerTexto(item, "id");
        if (!id || !/whisper|transcribe/i.test(id)) continue;
        modelos.push({ id, nome: id, recomendado: id === MODELOS_TRANSCRICAO[provedor] });
      }
      resultado = { ok: true, modelos, origem: "provedor" };
    } else if (r.status === 401) {
      resultado = falha(
        "chave_invalida",
        `A ${nome} não reconheceu a chave guardada. Cole uma chave nova.`,
      );
    } else if (r.status === 403) {
      resultado = falha(
        "sem_permissao",
        `A chave da ${nome} não tem permissão para listar os modelos.`,
      );
    } else {
      resultado = falha(
        "provedor_fora",
        `A ${nome} não respondeu como esperado. Tente de novo em alguns minutos.`,
      );
    }
  } catch (erro) {
    resultado =
      erro instanceof TempoEsgotado
        ? falha(
            "tempo_esgotado",
            `A ${nome} demorou mais de 10 segundos para responder. Tente de novo em instantes.`,
          )
        : erro instanceof FalhaDeRede
          ? falha(
              "provedor_fora",
              `Não conseguimos falar com a ${nome} agora. Tente de novo em alguns minutos.`,
            )
          : falha(
              "provedor_fora",
              `A ${nome} não respondeu como esperado. Tente de novo em alguns minutos.`,
            );
  } finally {
    prazo.encerrar();
  }
  return resultado.ok ? resultado : blindar(resultado, [chave]);
}

export async function listarModelosDaChaveLogica(
  ctx: ContextoUsuario,
  entrada: EntradaFinalidade,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoListarModelosDaChave> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  // a voz não tem lista de modelos: a ElevenLabs só confere a chave
  if (entrada.finalidade === "voz") return { ok: false, erro: "provedor_nao_permitido" };
  const lida = await lerChaveGuardada(entrada.finalidade);
  if (!lida.ok) return lida;
  const k = lida.chave;
  if (entrada.finalidade === "resposta") {
    // groq e elevenlabs não respondem (os checks do banco já impedem nesta finalidade)
    if (k.provedor === "groq" || k.provedor === "elevenlabs") {
      return { ok: false, erro: "provedor_nao_permitido" };
    }
    return listarModelosLogica(
      k.workspace_id
        ? { provedor: k.provedor, chave: k.chave, workspaceId: k.workspace_id }
        : { provedor: k.provedor, chave: k.chave },
      opcoes,
    );
  }
  // a Anthropic não transcreve; a ElevenLabs na escuta usa o Scribe, fixo, sem lista de modelos
  // (docs/spec-escuta-elevenlabs.md P3)
  if (k.provedor === "anthropic" || k.provedor === "elevenlabs" || k.provedor === "gemini") {
    return { ok: false, erro: "provedor_nao_permitido" };
  }
  // a OpenRouter não tem uma lista de modelos de voz: só o que a transcrição usa
  if (k.provedor === "openrouter") {
    const id = MODELOS_TRANSCRICAO.openrouter;
    return { ok: true, modelos: [{ id, nome: id, recomendado: true }], origem: "lista_curada" };
  }
  return listarModelosTranscricao(k.provedor, k.chave, opcoes);
}

export async function trocarModeloIALogica(
  ctx: ContextoUsuario,
  entrada: EntradaTrocarModelo,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoTrocarModelo> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  if (entrada.finalidade === "voz") {
    return falhaChave("provedor_nao_permitido", "A voz da Janete não tem modelo para trocar.");
  }
  const modelo = entrada.modelo.trim();
  if (!modelo) return falhaChave("modelo_indisponivel", "Escolha um modelo antes de salvar.");
  const lida = await lerChaveGuardada(entrada.finalidade);
  if (!lida.ok) return lida;
  const k = lida.chave;
  // a escuta pela ElevenLabs usa o Scribe, fixo (docs/spec-escuta-elevenlabs.md P3)
  if (entrada.finalidade === "transcricao" && k.provedor === "elevenlabs") {
    return falhaChave(
      "provedor_nao_permitido",
      "A escuta pela ElevenLabs não tem modelo para trocar.",
    );
  }
  // Transcrição pela OpenRouter: a conferência olha só a chave, e o transcrever usa o modelo
  // gravado. Só o modelo que a transcrição sabe usar (o mesmo que listarModelosDaChave oferece).
  if (
    entrada.finalidade === "transcricao" &&
    k.provedor === "openrouter" &&
    modelo !== MODELOS_TRANSCRICAO.openrouter
  ) {
    return falhaChave(
      "modelo_indisponivel",
      `Na transcrição pela OpenRouter, só o modelo ${MODELOS_TRANSCRICAO.openrouter} funciona.`,
    );
  }
  // a conferência com o modelo novo; se falhar, o modelo de antes continua valendo
  const falhou = await validarChave(
    {
      finalidade: entrada.finalidade,
      provedor: k.provedor,
      modelo,
      chave: k.chave,
      workspace_id: k.workspace_id,
    },
    opcoes,
  );
  if (falhou) return falhou;
  try {
    await gravarModeloChave(k.id, modelo, membroId);
  } catch {
    return falhaChave(
      "erro_ao_gravar",
      "Não conseguimos trocar o modelo agora. Tente de novo em instantes.",
    );
  }
  await auditar({
    acao: "chave_trocada",
    alvo: k.id,
    ator_membro_id: membroId,
    ultimos4: k.chave.trim().slice(-4),
    detalhe: {
      finalidade: entrada.finalidade,
      provedor: k.provedor,
      modelo,
      modelo_anterior: k.modelo,
      so_modelo: true,
    },
  });
  return { ok: true, modelo, status: "ativa" };
}

/**
 * Só a chave de áudio e a da voz, cada uma na sua linha: com a mesma chave da ElevenLabs nas
 * duas, remover uma não toca a outra (docs/spec-escuta-elevenlabs.md E2). Sem a de áudio, a
 * transcrição volta a usar a chave do cérebro (quando ela transcreve) ou, por último, a da voz;
 * sem a da voz, a Janete fica sem voz. A chave do cérebro só se troca, para a Janete nunca ficar
 * sem resposta.
 */
export async function removerChaveIALogica(
  ctx: ContextoUsuario,
  entrada: EntradaFinalidade,
): Promise<ResultadoRemoverChave> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  if (entrada.finalidade === "resposta") return { ok: false, erro: "nao_permitido" };
  let resumo: Awaited<ReturnType<typeof lerResumoChaveIA>>;
  try {
    resumo = await lerResumoChaveIA(entrada.finalidade);
  } catch {
    return { ok: false, erro: "erro_ao_ler" };
  }
  if (!resumo || !resumo.temChave) return { ok: false, erro: "sem_chave" };
  try {
    await apagarChave(resumo.id, membroId);
  } catch {
    return { ok: false, erro: "erro_ao_gravar" };
  }
  await auditar({
    acao: "chave_removida",
    alvo: resumo.id,
    ator_membro_id: membroId,
    ultimos4: resumo.ultimos4,
    detalhe: { finalidade: entrada.finalidade, provedor: resumo.provedor, modelo: resumo.modelo },
  });
  return { ok: true };
}

// ---------- ritmo ----------

/** null = dentro dos limites; senão, o campo que saiu deles. */
export function foraDoRitmo(r: EntradaRitmo): "espera" | "teto" | null {
  const { espera: E, teto: T, folga } = LIMITES_RITMO;
  if (!Number.isInteger(r.espera) || r.espera < E.min || r.espera > E.max) return "espera";
  if (!Number.isInteger(r.teto) || r.teto < T.min || r.teto > T.max) return "teto";
  if (r.teto < r.espera + folga) return "teto";
  return null;
}

export async function salvarRitmoLogica(
  ctx: ContextoUsuario,
  entrada: EntradaRitmo,
): Promise<ResultadoSalvarRitmo> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  const campo = foraDoRitmo(entrada);
  if (campo) return { ok: false, erro: "fora_do_limite", campo };
  let anterior: Awaited<ReturnType<typeof gravarRitmo>>;
  try {
    anterior = await gravarRitmo(entrada.espera, entrada.teto);
  } catch {
    return { ok: false, erro: "erro_ao_gravar" };
  }
  await auditar({
    acao: "ritmo_alterado",
    ator_membro_id: membroId,
    detalhe: {
      espera: entrada.espera,
      teto: entrada.teto,
      espera_anterior: anterior?.espera ?? null,
      teto_anterior: anterior?.teto ?? null,
    },
  });
  return { ok: true, espera: entrada.espera, teto: entrada.teto };
}

// ---------- voz em uso (docs/spec-voz-uso.md, contrato C2) ----------

/** Lista as vozes da conta da chave guardada, com a voz escolhida hoje. Só admin; não grava. */
export async function listarVozesLogica(
  ctx: ContextoUsuario,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoListarVozes> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  const lida = await lerChaveGuardada("voz");
  if (!lida.ok) return lida;
  // a voz de hoje vem antes do pedido: sem ela, nem chama a ElevenLabs
  let config: ConfigVozTela;
  try {
    config = await lerConfigVozTela();
  } catch {
    return { ok: false, erro: "erro_ao_ler" };
  }
  const lista = await listarVozesElevenLabs(lida.chave.chave, opcoes);
  if (!lista.ok) return lista;
  return { ok: true, vozes: lista.vozes, atual: config.voz };
}

/**
 * Confere a voz na ElevenLabs e grava a escolha em configuracao (com auditoria). Só admin. O
 * nome gravado é o que a ElevenLabs devolveu, nunca o do navegador; a gravação limpa o voz_erro.
 */
export async function escolherVozLogica(
  ctx: ContextoUsuario,
  entrada: EntradaEscolherVoz,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoEscolherVoz> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  const lida = await lerChaveGuardada("voz");
  if (!lida.ok) return lida;
  const conferida = await conferirVozElevenLabs(lida.chave.chave, entrada.vozId, opcoes);
  if (!conferida.ok) return conferida;
  const voz = conferida.voz;
  let anterior: VozEscolhida | null;
  try {
    anterior = await gravarVoz(voz);
  } catch {
    return {
      ok: false,
      erro: "erro_ao_gravar",
      mensagem: "Não conseguimos salvar a voz agora. Tente de novo em instantes.",
    };
  }
  await auditar({
    acao: "voz_alterada",
    ator_membro_id: membroId,
    detalhe: { voz_nome: voz.nome, voz_nome_anterior: anterior?.nome ?? null },
  });
  return { ok: true, voz };
}

/** Grava quando a Janete responde em áudio (configuracao.voz_resposta), com auditoria. Só admin. */
export async function salvarModoVozLogica(
  ctx: ContextoUsuario,
  entrada: EntradaModoVoz,
): Promise<ResultadoSalvarModoVoz> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  let anterior: ModoVoz | null;
  try {
    anterior = await gravarModoVoz(entrada.modo);
  } catch {
    return {
      ok: false,
      erro: "erro_ao_gravar",
      mensagem: "Não conseguimos salvar a escolha agora. Tente de novo em instantes.",
    };
  }
  await auditar({
    acao: "voz_alterada",
    ator_membro_id: membroId,
    detalhe: { modo: entrada.modo, modo_anterior: anterior },
  });
  return { ok: true, modo: entrada.modo };
}

// ---------- a chave da ElevenLabs nos dois cartões (docs/spec-escuta-elevenlabs.md, contrato S2) ----------

/** Copia a chave da ElevenLabs de um cartão para o outro, no servidor: a chave nunca volta. Só admin. */
export async function usarChaveElevenLabsLogica(
  ctx: ContextoUsuario,
  entrada: EntradaUsarChaveElevenLabs,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoUsarChaveElevenLabs> {
  const membroId = await membroAdmin(ctx);
  if (!membroId) return SEM_ACESSO;
  const para = entrada.para;
  const de: FinalidadeIA = para === "voz" ? "transcricao" : "voz";

  // seLivre (onboarding, P8): a chave de outro provedor no destino fica
  let destino: Awaited<ReturnType<typeof lerResumoChaveIA>> = null;
  if (entrada.seLivre) {
    try {
      destino = await lerResumoChaveIA(para);
    } catch {
      return { ok: false, erro: "erro_ao_ler" };
    }
    if (destino?.temChave && destino.provedor !== "elevenlabs") return { ok: true, copiada: false };
  }

  // a cópia abre a chave e grava de novo: o texto cifrado amarra o id da linha (aadChave, P2)
  const lida = await lerChaveGuardada(de);
  if (!lida.ok) return lida;
  const k = lida.chave;
  if (k.provedor !== "elevenlabs") {
    return falhaChave("provedor_nao_permitido", "A chave do outro cartão não é da ElevenLabs.");
  }
  // seLivre e o destino já tem a mesma chave em uso (os 4 últimos, como o gravarChaveIA guarda; P6).
  // Marcada como inválida, ela é conferida e gravada de novo: o "Trocar chave" do onboarding a reativa.
  if (
    destino?.temChave &&
    (destino.status === "ativa" || destino.status === "sem_credito") &&
    destino.ultimos4 === k.chave.trim().slice(-4)
  ) {
    return { ok: true, copiada: false };
  }

  // a conferência grátis de novo (GET /v1/user); recusada, nada é gravado
  const falhou = await validarChaveElevenLabs(k.chave, opcoes);
  if (falhou) return falhou;

  try {
    const { ultimos4 } = await gravarChaveIA({
      finalidade: para,
      provedor: "elevenlabs",
      modelo: para === "transcricao" ? MODELO_ESCUTA_ELEVENLABS : "",
      workspace_id: null,
      chave: k.chave,
      membroId,
    });
    return { ok: true, copiada: true, ultimos4, status: "ativa" };
  } catch (e) {
    return falhaChave(
      erroDeGravacao(e),
      "Não conseguimos usar a chave agora. Tente de novo em instantes.",
    );
  }
}
