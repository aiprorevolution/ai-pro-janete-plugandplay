// Funções de servidor da Configuração da mensageria (só admin).
// Uso no navegador:
//   await salvarConexao({ data: { gateway, campos } })
//     → { ok: true, conexao_id, nome, gateway, url_webhook, verifyToken? (só Meta), avisos,
//         conexao_anterior? }
//     (conexao_anterior: { gateway, aviso } da conexão que saiu no Trocar, com o mesmo aviso do
//     desconectarConexao; ausente quando não havia outra ativa ou o webhook dela foi desligado)
//   await salvarChaveIA({ data: { finalidade, provedor, modelo, chave, workspace_id? } })
//     → { ok: true, ultimos4, status: "ativa" }
//     workspace_id ausente mantém o gravado (mesmo provedor); "" ou null apaga.
//     A voz da Janete: { finalidade: "voz", provedor: "elevenlabs", modelo: "", chave }.
//   await verSegredoGerado({ data: { conexao_id, nome } }) → { ok: true, valor }
// Com o que já está guardado (a lógica em configuracao/acoes.server.ts):
//   await desconectarConexao({ data: {} }) → { ok: true, conexao_id, aviso? }
//     (aviso: "webhook_no_painel" na Meta e na Z-API, que não desligam o webhook pela API;
//     "webhook_nao_desligado" quando o desligar falhou. Desconecta mesmo assim)
//   await conferirConexao({ data: {} }) → { ok: true, conexao_id, gateway, nome, status }
//   await consertarCampoConexao({ data: { campo, valor } }) → { ok: true, conexao_id, gateway, nome }
//     (só Meta: token, appSecret ou wabaId; o verifyToken continua o mesmo)
//   await revalidarChaveIA({ data: { finalidade } }) → { ok: true, status: "ativa", provedor, modelo }
//   await listarModelosDaChave({ data: { finalidade } }) → { ok: true, modelos, origem }
//   await trocarModeloIA({ data: { finalidade, modelo } }) → { ok: true, modelo, status: "ativa" }
//   await removerChaveIA({ data: { finalidade: "transcricao" | "voz" } }) → { ok: true }
//     (a de resposta não se remove; listar e trocar o modelo não valem para a voz)
//   await salvarRitmo({ data: { espera, teto } }) → { ok: true, espera, teto }
// A voz em uso (docs/spec-voz-uso.md, contrato C2; também a etapa Voz do onboarding):
//   await listarVozes({ data: {} }) → { ok: true, vozes, atual }
//   await escolherVoz({ data: { vozId } }) → { ok: true, voz: { id, nome } }
//   await salvarModoVoz({ data: { modo: "quando_audio" | "sempre" | "nunca" } }) → { ok: true, modo }
//   (o revalidarChaveIA da voz também confere a voz escolhida: voz: "ok" | "nao_encontrada" | "sem_voz")
// A chave da ElevenLabs nos dois cartões (docs/spec-escuta-elevenlabs.md, contrato S2):
//   await usarChaveElevenLabs({ data: { para: "voz" | "transcricao", seLivre? } })
//     → { ok: true, copiada: true, ultimos4, status: "ativa" } | { ok: true, copiada: false }
//     (copia no servidor a chave do outro cartão; seLivre, do onboarding, não troca a de outro provedor)
// Falha: { ok: false, erro, mensagem? }; sem admin, { ok: false, erro: "sem_acesso" }.
// A chave e a credencial coladas nunca voltam. A lógica fica em configuracao.server.ts, que
// entra por import() dentro do handler para não ir ao navegador.
import { createServerFn } from "@tanstack/react-start";

import { lerEntradaConexao } from "@/features/servidor/conexao";
import { MODOS_VOZ, VOZ_ID, type ModoVoz } from "@/features/servidor/vozes-tipos";
import { requireFirebaseAuth } from "@/integrations/firebase/auth-middleware";

import type {
  CampoConsertoMeta,
  EntradaConsertarCampo,
  EntradaEscolherVoz,
  EntradaFinalidade,
  EntradaModoVoz,
  EntradaRitmo,
  EntradaTrocarModelo,
  EntradaUsarChaveElevenLabs,
} from "./configuracao/acoes.server";
import type {
  EntradaSalvarChaveIA,
  EntradaSalvarConexao,
  EntradaVerSegredo,
  FinalidadeIA,
  ProvedorChave,
} from "./configuracao.server";
import { SEGREDOS_GERADOS, type SegredoGerado } from "./nucleo/tipos";

export type {
  AvisoDesconectar,
  CampoConsertoMeta,
  EntradaConsertarCampo,
  EntradaEscolherVoz,
  EntradaFinalidade,
  EntradaModoVoz,
  EntradaRitmo,
  EntradaTrocarModelo,
  EntradaUsarChaveElevenLabs,
  ResultadoConferirConexao,
  ResultadoConsertarCampo,
  ResultadoDesconectar,
  ResultadoEscolherVoz,
  ResultadoListarModelosDaChave,
  ResultadoListarVozes,
  ResultadoRemoverChave,
  ResultadoRevalidarChave,
  ResultadoSalvarModoVoz,
  ResultadoSalvarRitmo,
  ResultadoTrocarModelo,
  ResultadoUsarChaveElevenLabs,
  VozConferida,
} from "./configuracao/acoes.server";
export type {
  AvisoConexao,
  EntradaSalvarChaveIA,
  EntradaSalvarConexao,
  EntradaVerSegredo,
  ResultadoSalvarChaveIA,
  ResultadoSalvarConexao,
  ResultadoVerSegredo,
} from "./configuracao.server";

// ---------- leitura das entradas (erro genérico, sem nenhum valor da entrada) ----------

export function lerEntradaSalvarConexao(entrada: unknown): EntradaSalvarConexao {
  const lida = lerEntradaConexao(entrada);
  return { gateway: lida.gateway, campos: lida.campos };
}

const FINALIDADES: readonly FinalidadeIA[] = ["resposta", "transcricao", "voz"];
const PROVEDORES: readonly ProvedorChave[] = ["anthropic", "openai", "openrouter", "gemini", "groq", "elevenlabs"];

export function lerEntradaSalvarChaveIA(entrada: unknown): EntradaSalvarChaveIA {
  if (entrada === null || typeof entrada !== "object") throw new Error("Pedido inválido.");
  const e = entrada as Record<string, unknown>;
  const finalidade = e["finalidade"];
  const provedor = e["provedor"];
  const modelo = e["modelo"];
  const chave = e["chave"];
  const workspace = e["workspace_id"];
  if (typeof finalidade !== "string" || !(FINALIDADES as readonly string[]).includes(finalidade)) {
    throw new Error("Pedido inválido: finalidade.");
  }
  if (typeof provedor !== "string" || !(PROVEDORES as readonly string[]).includes(provedor)) {
    throw new Error("Pedido inválido: provedor desconhecido.");
  }
  if (typeof chave !== "string" || chave.length > 1000) throw new Error("Pedido inválido: chave.");
  if (typeof modelo !== "string" || modelo.length > 200)
    throw new Error("Pedido inválido: modelo.");
  if (
    workspace !== undefined &&
    workspace !== null &&
    (typeof workspace !== "string" || workspace.length > 200)
  ) {
    throw new Error("Pedido inválido: workspace.");
  }
  const lida: EntradaSalvarChaveIA = {
    finalidade: finalidade as FinalidadeIA,
    provedor: provedor as ProvedorChave,
    modelo,
    chave,
  };
  // ausente = mantém o gravado (mesmo provedor); vazio ou null = sem workspace
  if (typeof workspace === "string") lida.workspace_id = workspace.trim() || null;
  else if (workspace === null) lida.workspace_id = null;
  return lida;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerEntradaVerSegredo(entrada: unknown): EntradaVerSegredo {
  if (entrada === null || typeof entrada !== "object") throw new Error("Pedido inválido.");
  const e = entrada as Record<string, unknown>;
  const id = e["conexao_id"];
  const nome = e["nome"];
  if (typeof id !== "string" || !UUID.test(id)) throw new Error("Pedido inválido: conexão.");
  if (typeof nome !== "string" || !(SEGREDOS_GERADOS as readonly string[]).includes(nome)) {
    throw new Error("Pedido inválido: nome.");
  }
  return { conexao_id: id, nome: nome as SegredoGerado };
}

function lerFinalidade(e: Record<string, unknown>): FinalidadeIA {
  const finalidade = e["finalidade"];
  if (typeof finalidade !== "string" || !(FINALIDADES as readonly string[]).includes(finalidade)) {
    throw new Error("Pedido inválido: finalidade.");
  }
  return finalidade as FinalidadeIA;
}

function objeto(entrada: unknown): Record<string, unknown> {
  if (entrada === null || typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new Error("Pedido inválido.");
  }
  return entrada as Record<string, unknown>;
}

/** Ações sem entrada: aceita só nada ou um objeto vazio. */
export function lerEntradaVazia(entrada: unknown): Record<string, never> {
  if (entrada === undefined || entrada === null) return {};
  if (Object.keys(objeto(entrada)).length > 0) throw new Error("Pedido inválido.");
  return {};
}

export function lerEntradaFinalidade(entrada: unknown): EntradaFinalidade {
  return { finalidade: lerFinalidade(objeto(entrada)) };
}

export function lerEntradaTrocarModelo(entrada: unknown): EntradaTrocarModelo {
  const e = objeto(entrada);
  const modelo = e["modelo"];
  if (typeof modelo !== "string" || modelo.length > 200)
    throw new Error("Pedido inválido: modelo.");
  return { finalidade: lerFinalidade(e), modelo };
}

const CAMPOS_CONSERTO: readonly CampoConsertoMeta[] = ["token", "appSecret", "wabaId"];

export function lerEntradaConsertarCampo(entrada: unknown): EntradaConsertarCampo {
  const e = objeto(entrada);
  const campo = e["campo"];
  const valor = e["valor"];
  if (typeof campo !== "string" || !(CAMPOS_CONSERTO as readonly string[]).includes(campo)) {
    throw new Error("Pedido inválido: campo.");
  }
  if (typeof valor !== "string" || valor.length > 2000) throw new Error("Pedido inválido: valor.");
  return { campo: campo as CampoConsertoMeta, valor };
}

/** Só a forma (inteiros); os limites são conferidos na lógica, que responde fora_do_limite. */
export function lerEntradaRitmo(entrada: unknown): EntradaRitmo {
  const e = objeto(entrada);
  const espera = e["espera"];
  const teto = e["teto"];
  if (typeof espera !== "number" || !Number.isInteger(espera)) {
    throw new Error("Pedido inválido: espera.");
  }
  if (typeof teto !== "number" || !Number.isInteger(teto))
    throw new Error("Pedido inválido: teto.");
  return { espera, teto };
}

/** O id da voz vai num caminho de URL da ElevenLabs: só a forma de VOZ_ID (o mesmo check do banco). */
export function lerEntradaEscolherVoz(entrada: unknown): EntradaEscolherVoz {
  const vozId = objeto(entrada)["vozId"];
  if (typeof vozId !== "string" || !VOZ_ID.test(vozId)) throw new Error("Pedido inválido: voz.");
  return { vozId };
}

export function lerEntradaModoVoz(entrada: unknown): EntradaModoVoz {
  const modo = objeto(entrada)["modo"];
  if (typeof modo !== "string" || !(MODOS_VOZ as readonly string[]).includes(modo)) {
    throw new Error("Pedido inválido: modo.");
  }
  return { modo: modo as ModoVoz };
}

/** O cartão que recebe a cópia da chave da ElevenLabs (S2): só a voz ou a escuta. */
export function lerEntradaUsarChaveElevenLabs(entrada: unknown): EntradaUsarChaveElevenLabs {
  const e = objeto(entrada);
  const para = e["para"];
  if (para !== "voz" && para !== "transcricao") throw new Error("Pedido inválido: cartão.");
  const seLivre = e["seLivre"];
  if (seLivre !== undefined && typeof seLivre !== "boolean") throw new Error("Pedido inválido: seLivre.");
  return seLivre === undefined ? { para } : { para, seLivre };
}

/**
 * Origem de onde o admin salvou: o cabeçalho Origin (o navegador manda em todo POST) ou, sem
 * ele, a da URL do pedido. É a base da URL do webhook.
 */
export function origemDoPedido(req: Request): string {
  const cabecalho = req.headers.get("origin");
  if (cabecalho) {
    try {
      const url = new URL(cabecalho);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // cai para a URL do pedido
    }
  }
  return new URL(req.url).origin;
}

// ---------- funções ----------

export const salvarConexao = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaSalvarConexao) => lerEntradaSalvarConexao(entrada))
  .handler(async ({ data, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { salvarConexaoLogica } = await import("./configuracao.server");
    const { getInstallationConfig } = await import("@/integrations/firebase/config.server");
    const ctx = { firebase: context.firebase, userId: context.userId };
    const pedido = getRequest();
    const installation = await getInstallationConfig();
    const resultado = await salvarConexaoLogica(ctx, data, { origem: installation.publicUrl || origemDoPedido(pedido) });
    // conexão ativa: pede um toque no motor (docs/spec-motor-acordado.md), com o host que recebeu
    // o pedido, nunca o cabeçalho Origin (que o origemDoPedido prefere); nunca muda a resposta
    if (resultado.ok) {
      try {
        const { acordarMotor } = await import("./nucleo/motor.server");
        await acordarMotor(new URL(pedido.url).origin);
      } catch {
        // o motor acorda na próxima mensagem
      }
    }
    return resultado;
  });

export const salvarChaveIA = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaSalvarChaveIA) => lerEntradaSalvarChaveIA(entrada))
  .handler(async ({ data, context }) => {
    const { salvarChaveIALogica } = await import("./configuracao.server");
    return salvarChaveIALogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const verSegredoGerado = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaVerSegredo) => lerEntradaVerSegredo(entrada))
  .handler(async ({ data, context }) => {
    const { verSegredoGeradoLogica } = await import("./configuracao.server");
    return verSegredoGeradoLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

// ---------- ações com o que já está guardado (spec-ligar-telas-banco, 2.4) ----------

export const desconectarConexao = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada?: Record<string, never>) => lerEntradaVazia(entrada))
  .handler(async ({ context }) => {
    const { desconectarConexaoLogica } = await import("./configuracao/acoes.server");
    return desconectarConexaoLogica({ firebase: context.firebase, userId: context.userId });
  });

export const conferirConexao = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada?: Record<string, never>) => lerEntradaVazia(entrada))
  .handler(async ({ context }) => {
    const { conferirConexaoLogica } = await import("./configuracao/acoes.server");
    return conferirConexaoLogica({ firebase: context.firebase, userId: context.userId });
  });

export const consertarCampoConexao = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaConsertarCampo) => lerEntradaConsertarCampo(entrada))
  .handler(async ({ data, context }) => {
    const { consertarCampoConexaoLogica } = await import("./configuracao/acoes.server");
    return consertarCampoConexaoLogica(
      { firebase: context.firebase, userId: context.userId },
      data,
    );
  });

export const revalidarChaveIA = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaFinalidade) => lerEntradaFinalidade(entrada))
  .handler(async ({ data, context }) => {
    const { revalidarChaveIALogica } = await import("./configuracao/acoes.server");
    return revalidarChaveIALogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const listarModelosDaChave = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaFinalidade) => lerEntradaFinalidade(entrada))
  .handler(async ({ data, context }) => {
    const { listarModelosDaChaveLogica } = await import("./configuracao/acoes.server");
    return listarModelosDaChaveLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const trocarModeloIA = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaTrocarModelo) => lerEntradaTrocarModelo(entrada))
  .handler(async ({ data, context }) => {
    const { trocarModeloIALogica } = await import("./configuracao/acoes.server");
    return trocarModeloIALogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const removerChaveIA = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaFinalidade) => lerEntradaFinalidade(entrada))
  .handler(async ({ data, context }) => {
    const { removerChaveIALogica } = await import("./configuracao/acoes.server");
    return removerChaveIALogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const salvarRitmo = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaRitmo) => lerEntradaRitmo(entrada))
  .handler(async ({ data, context }) => {
    const { salvarRitmoLogica } = await import("./configuracao/acoes.server");
    return salvarRitmoLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

// ---------- voz em uso (docs/spec-voz-uso.md, contrato C2) ----------

export const listarVozes = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada?: Record<string, never>) => lerEntradaVazia(entrada))
  .handler(async ({ context }) => {
    const { listarVozesLogica } = await import("./configuracao/acoes.server");
    return listarVozesLogica({ firebase: context.firebase, userId: context.userId });
  });

export const escolherVoz = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaEscolherVoz) => lerEntradaEscolherVoz(entrada))
  .handler(async ({ data, context }) => {
    const { escolherVozLogica } = await import("./configuracao/acoes.server");
    return escolherVozLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const salvarModoVoz = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaModoVoz) => lerEntradaModoVoz(entrada))
  .handler(async ({ data, context }) => {
    const { salvarModoVozLogica } = await import("./configuracao/acoes.server");
    return salvarModoVozLogica({ firebase: context.firebase, userId: context.userId }, data);
  });

export const usarChaveElevenLabs = createServerFn({ method: "POST" })
  .middleware([requireFirebaseAuth])
  .validator((entrada: EntradaUsarChaveElevenLabs) => lerEntradaUsarChaveElevenLabs(entrada))
  .handler(async ({ data, context }) => {
    const { usarChaveElevenLabsLogica } = await import("./configuracao/acoes.server");
    return usarChaveElevenLabsLogica({ firebase: context.firebase, userId: context.userId }, data);
  });
