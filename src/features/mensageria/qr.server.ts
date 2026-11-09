// Lógica das funções de servidor do QR code (qr.functions.ts), só para o admin (membroAdmin). Pede
// o QR da Z-API ou da Evolution com os campos colados na tela (onboarding e troca de WhatsApp) ou
// com os dados guardados da conexão ativa (conserto do número caído). Nada aqui grava no banco:
// quem grava continua sendo salvarConexao ou conferirConexao. Spec: docs/spec-qr-whatsapp.md.
import type { OpcoesValidacao } from "@/features/servidor/http";
import {
  desconectarCelularLogica,
  ehGatewayQr,
  pedirQrLogica,
  type EntradaDesconectarCelular,
  type EntradaQr,
  type PedidoQr,
  type ResultadoDesconectarCelular,
  type ResultadoQr,
} from "@/features/servidor/qr-conexao";

import { membroAdmin, type ContextoUsuario, type SemAcesso } from "./configuracao.server";
import { camposGuardados, type ErroLeitura } from "./configuracao/acoes.server";
import { conexaoAtiva } from "./nucleo/conexoes.server";
import type { ConexaoServidor } from "./nucleo/tipos";

const SEM_ACESSO: SemAcesso = { ok: false, erro: "sem_acesso" };

export type EntradaPedirQrGuardada = { pedir: PedidoQr };

export type ResultadoPedirQr = ResultadoQr | SemAcesso;
export type ResultadoPedirQrGuardada =
  ResultadoQr | SemAcesso | { ok: false; erro: "sem_conexao" | "nao_e_qr" | ErroLeitura };

/** O QR com os campos colados na tela. */
export async function pedirQrConexaoLogica(
  ctx: ContextoUsuario,
  entrada: EntradaQr,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoPedirQr> {
  if (!(await membroAdmin(ctx))) return SEM_ACESSO;
  return pedirQrLogica(entrada, opcoes);
}

/** O QR com os dados guardados da conexão ativa (sem colar nada). */
export async function pedirQrGuardadaLogica(
  ctx: ContextoUsuario,
  entrada: EntradaPedirQrGuardada,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoPedirQrGuardada> {
  if (!(await membroAdmin(ctx))) return SEM_ACESSO;
  let c: ConexaoServidor | null;
  try {
    c = await conexaoAtiva();
  } catch (falhou) {
    const msg = falhou instanceof Error ? falhou.message : "";
    return {
      ok: false,
      erro: msg === "cifra_indisponivel" || msg === "cifra_invalida" ? msg : "erro_ao_ler",
    };
  }
  if (!c) return { ok: false, erro: "sem_conexao" };
  if (!ehGatewayQr(c.gateway)) return { ok: false, erro: "nao_e_qr" };
  return pedirQrLogica(
    { gateway: c.gateway, campos: camposGuardados(c), pedir: entrada.pedir },
    opcoes,
  );
}

export type ResultadoDesconectarCelularConexao = ResultadoDesconectarCelular | SemAcesso;

/**
 * "Desconectar e ler de novo" (onboarding e troca, spec-qr-whatsapp seção 8): tira o celular da
 * instância com os campos colados na tela, sem apagar a instância. Nada é gravado no banco.
 */
export async function desconectarCelularConexaoLogica(
  ctx: ContextoUsuario,
  entrada: EntradaDesconectarCelular,
  opcoes?: OpcoesValidacao,
): Promise<ResultadoDesconectarCelularConexao> {
  if (!(await membroAdmin(ctx))) return SEM_ACESSO;
  return desconectarCelularLogica(entrada, opcoes);
}
