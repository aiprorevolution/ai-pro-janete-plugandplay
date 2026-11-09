// O número do WhatsApp no conserto e no "Testar" da Configuração (spec-qr-whatsapp, seção 8,
// decisão 4). Quem chama é o conferirConexaoLogica, com a conexão ativa e a validação que deu ok.
// - Z-API e Evolution com o número informado pelo WhatsApp:
//   - outro número que o salvo: tira o celular da instância (sem apagar a instância), grava
//     'desconectada' com ultimo_erro 'numero_diferente' e devolve a recusa. Trocar de número é pelo
//     "Trocar de WhatsApp";
//   - sem número salvo (conexão de antes da seção 8): regrava o nome e parametros.numero.
// - O resto (outro gateway, número que não veio, o mesmo número) segue a conferência de sempre.
import type { ResultadoConexao } from "@/features/servidor/conexao";
import type { OpcoesValidacao } from "@/features/servidor/http";
import { formatarNumero, mesmoNumero } from "@/features/servidor/numero-whatsapp";
import { desconectarCelularLogica, ehGatewayQr } from "@/features/servidor/qr-conexao";

import type { ConexaoServidor } from "../nucleo/tipos";
import { camposGuardados } from "./acoes.server";
import { gravarStatusConexao, regravarConexao } from "./banco.server";

export type RecusaNumeroDiferente = {
  ok: false;
  erro: "numero_diferente";
  /** os dois formatados ("+55 11 98765-4321") */
  numero_conectado: string;
  numero_salvo: string;
  /** o celular saiu da instância (o logout deu certo) */
  desconectado: boolean;
  status: "desconectada";
  mensagem: string;
};

const MSG_DESCONECTOU =
  "Um celular de outro número leu o QR code, e a Janete desconectou ele. Leia o QR code com o celular do número desta conexão.";
const MSG_NAO_DESCONECTOU =
  "Um celular de outro número leu o QR code, e a Janete não conseguiu desconectar ele agora. Tente de novo e leia o QR code com o celular do número desta conexão.";

/** Só os dígitos guardados em parametros.numero ("" quando não há). */
function numeroSalvo(c: ConexaoServidor): string {
  const v = c.parametros["numero"];
  return typeof v === "string" ? v.replace(/\D/g, "") : "";
}

/**
 * null = a conferência segue como sempre (grava 'conectada'). Senão, a recusa do número diferente
 * ou a falha de gravação.
 */
export async function conferirNumeroDaConexao(
  c: ConexaoServidor,
  validacao: Extract<ResultadoConexao, { ok: true }>,
  opcoes?: OpcoesValidacao,
): Promise<RecusaNumeroDiferente | { ok: false; erro: "erro_ao_gravar" } | null> {
  if (!ehGatewayQr(c.gateway) || !validacao.numero) return null;
  const salvo = numeroSalvo(c);

  if (!salvo) {
    try {
      await regravarConexao(c.id, {
        nome: formatarNumero(validacao.numero),
        parametros: { ...c.parametros, numero: validacao.numero },
        segredos: c.segredos,
      });
    } catch {
      return { ok: false, erro: "erro_ao_gravar" };
    }
    return null;
  }
  if (mesmoNumero(salvo, validacao.numero)) return null;

  const desconectar = await desconectarCelularLogica(
    { gateway: c.gateway, campos: camposGuardados(c) },
    opcoes,
  );
  try {
    await gravarStatusConexao(c.id, "desconectada", "numero_diferente");
  } catch {
    return { ok: false, erro: "erro_ao_gravar" };
  }
  return {
    ok: false,
    erro: "numero_diferente",
    numero_conectado: formatarNumero(validacao.numero),
    numero_salvo: formatarNumero(salvo),
    desconectado: desconectar.ok,
    status: "desconectada",
    mensagem: desconectar.ok ? MSG_DESCONECTOU : MSG_NAO_DESCONECTOU,
  };
}
