import { iniciais } from "@/components/aipro/iniciais";

import { ESPERA_LONGA_S, MOTIVO_CURTO, nomeDoContato } from "../comum/LinhaConversa";
import { diasEntre, esperaCompacta, esperaLonga, segundosDesde, type Instante } from "../comum/tempo";
import { ehAdmin, estaAguardando } from "../exemplo/regras";
import type { Contato, Conversa, Convite, Etapa, Membro } from "../exemplo/tipos";

// As leituras da tela da Equipe (docs/spec-equipe.md, E0): puras, sobre a base da Equipe, que vem do
// banco (dados/equipe.ts, modo banco) ou do estado do exemplo (os testes). A tela (opção B do
// protótipo) mostra a fila "Precisam de você" e um cartão por pessoa, com as conversas que estão com
// ela; os números saem daqui, nunca da tela.

/** Quantas conversas o cartão mostra antes do "Ver mais N" (decisão 4 da spec). */
export const MAX_NO_CARTAO = 5;

/** A explicação dos botões travados no seu cartão quando você é o único admin. */
export const TRAVA_UNICO_ADMIN = "Você é o único admin. A equipe precisa de pelo menos um: torne outra pessoa admin antes.";
/** A explicação dos botões travados no seu cartão quando há outro admin (decisão 3 da spec). */
export const TRAVA_PROPRIO = "Para mudar o seu papel ou desativar a sua conta, peça a outro admin.";

/** O formato mínimo de um e-mail (x@y.zz), o mesmo do reducer do exemplo e do servidor. */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** O que a Equipe precisa do contato: o nome (como no Chat) e a etapa. */
export type ContatoEquipe = Pick<Contato, "id" | "nome" | "nome_whatsapp" | "telefone" | "etapa_id">;

/**
 * Tudo o que a tela da Equipe lê, igual nos dois modos (o estado do exemplo serve como está):
 * - `membros`: inclusive os desativados;
 * - `convites`: os pendentes (só o admin; ausente = nenhum);
 * - `conversas`: as da fila ("Precisam de você", com `estavaCom` quando voltaram de alguém
 *   desativado) e as que estão com alguém da equipe;
 * - `contatos`: os dessas conversas.
 */
export interface BaseEquipe {
  eu: Membro;
  membros: readonly Membro[];
  convites?: readonly Convite[] | undefined;
  conversas: readonly Conversa[];
  contatos: readonly ContatoEquipe[];
  etapas: readonly Etapa[];
}

/** Uma conversa no cartão de quem está com ela. */
export interface ConversaNoCartao {
  conversaId: string;
  contatoId: string;
  /** O nome do lead, como no Chat. */
  nome: string;
  etapa: Etapa | undefined;
  ultimaEm: string | null;
}

/** Uma conversa na fila "Precisam de você". */
export interface ItemDaFila {
  conversaId: string;
  contatoId: string;
  nome: string;
  /** "Estava com Marina" (voltou de alguém desativado), o motivo curto do Chat ou "Aguardando alguém". */
  motivo: string;
  /** Segundos esperando alguém da equipe. */
  esperaS: number;
  /** 10 min ou mais (a régua do Chat): a bolinha fica vermelha. */
  longa: boolean;
}

export interface CartaoMembro {
  tipo: "membro";
  membro: Membro;
  /** É o cartão de quem olha. */
  souEu: boolean;
  /** "Você" para quem olha; o nome para os outros. */
  nome: string;
  /** "VC" para quem olha; as iniciais do nome para os outros ("MA"). */
  iniciais: string;
  /** As conversas com a pessoa agora, a de mensagem mais recente primeiro (todas: o cartão corta em 5). */
  conversas: ConversaNoCartao[];
  /** Por que os botões do cartão estão travados (null = livres). Só para quem pode gerenciar. */
  travado: string | null;
}

export interface CartaoConvite {
  tipo: "convite";
  convite: Convite;
  /** "Convite criado hoje", "Convite criado há 1 dia", "Convite criado há 3 dias" (dias de São Paulo). */
  enviado: string;
}

export type Cartao = CartaoMembro | CartaoConvite;

/** O que um botão de cartão pede à tela (a tela confirma o que precisa e chama a ação). */
export type PedidoEquipe = {
  tipo: "admin" | "atendente" | "desativar" | "reativar" | "reenviar" | "copiar" | "cancelar";
  /** O id do membro, ou o do convite em "reenviar", "copiar" e "cancelar". */
  id: string;
};

/** O tempo de espera curto do item da fila: "agora" no 1º minuto, depois "4 min", "1 h 05". */
export function tempoNaFila(esperaS: number): string {
  return esperaS < 60 ? "agora" : esperaCompacta(esperaS);
}

/** O mesmo tempo por extenso, para o leitor de tela ("há menos de 1 min", "há 13 min"). */
export function tempoNaFilaPorExtenso(esperaS: number): string {
  return `há ${esperaLonga(esperaS)}`;
}

/** Há quanto tempo o convite saiu (o último envio), em dias de calendário de São Paulo. */
export function textoDoEnvio(enviadoEm: Instante, agora: Instante): string {
  const n = diasEntre(enviadoEm, agora);
  if (!Number.isFinite(n)) return "Convite criado";
  if (n <= 0) return "Convite criado hoje";
  return `Convite criado há ${n} ${n === 1 ? "dia" : "dias"}`;
}

/** O nome do membro para a tela: "Você" para quem olha, o nome para os outros. */
export function nomeNaEquipe(base: Pick<BaseEquipe, "membros" | "eu">, membroId: string | null): string {
  if (!membroId) return "";
  if (membroId === base.eu.id) return "Você";
  return base.membros.find((m) => m.id === membroId)?.nome ?? "Alguém da equipe";
}

function mapaContatos(base: Pick<BaseEquipe, "contatos">): Map<string, ContatoEquipe> {
  return new Map(base.contatos.map((c) => [c.id, c]));
}

/**
 * A fila "Precisam de você": as conversas que esperam alguém da equipe (`estaAguardando`), a que
 * espera há mais tempo primeiro; no empate, pelo nome do lead.
 */
export function filaDaEquipe(base: BaseEquipe, agora: Instante): ItemDaFila[] {
  const contatos = mapaContatos(base);
  return base.conversas
    .filter((c) => estaAguardando(c))
    .map((c) => {
      const contato = contatos.get(c.contato_id);
      const esperaS = segundosDesde(c.aguardando_humano_desde, agora);
      return {
        conversaId: c.id,
        contatoId: c.contato_id,
        nome: contato ? nomeDoContato(contato) : "Sem nome",
        motivo: motivoDaEspera(base, c),
        esperaS,
        longa: esperaS >= ESPERA_LONGA_S,
      };
    })
    .sort((a, b) => b.esperaS - a.esperaS || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Folga do tique, para ele cair logo depois da virada do minuto, e não logo antes (a do Chat). */
const FOLGA_TIQUE_MS = 50;

/**
 * Quantos ms faltam para o próximo tique do relógio da fila: a próxima virada de minuto da espera de
 * alguma conversa ("agora" → "1 min", "9 min" → "10 min" e a bolinha vermelha, já que 10 min é
 * múltiplo de 60 s), a que vier primeiro. A mesma conta do `proximoTique` do Chat, só com as esperas
 * (a Equipe não mostra a hora do relógio). `null` = nenhuma espera, nada a andar.
 */
export function proximoTiqueDaFila(agora: number, esperas: readonly (string | null)[]): number | null {
  let falta = Number.POSITIVE_INFINITY;
  for (const desde of esperas) {
    const d = desde ? Date.parse(desde) : Number.NaN;
    if (!Number.isFinite(d)) continue;
    const corrido = agora - d;
    // Espera que começa no futuro (relógios desencontrados): o tempo fica em "agora" até lá.
    const f = corrido < 0 ? -corrido : 60_000 - (corrido % 60_000);
    if (f < falta) falta = f;
  }
  return Number.isFinite(falta) ? falta + FOLGA_TIQUE_MS : null;
}

function motivoDaEspera(base: BaseEquipe, c: Conversa): string {
  if (c.estavaCom) return `Estava com ${nomeNaEquipe(base, c.estavaCom)}`;
  return c.motivo_humano ? MOTIVO_CURTO[c.motivo_humano] : "Aguardando alguém";
}

/**
 * Os cartões, na ordem da tela: você, as outras pessoas ativas (pelo nome), os convites (só para o
 * admin, na ordem em que foram feitos) e, por último, quem está desativado.
 */
export function cartoesDaEquipe(base: BaseEquipe, agora: Instante = Date.now()): Cartao[] {
  const gerencia = ehAdmin(base.eu);
  const admins = base.membros.filter((m) => m.ativo && m.papel === "admin").length;
  const porNome = (a: Membro, b: Membro) => a.nome.localeCompare(b.nome, "pt-BR");
  const eu = base.membros.filter((m) => m.id === base.eu.id);
  const ativos = base.membros.filter((m) => m.ativo && m.id !== base.eu.id).sort(porNome);
  const desativados = base.membros.filter((m) => !m.ativo && m.id !== base.eu.id).sort(porNome);

  const cartao = (m: Membro): CartaoMembro => {
    const souEu = m.id === base.eu.id;
    let travado: string | null = null;
    if (gerencia && souEu) travado = m.papel === "admin" && admins === 1 ? TRAVA_UNICO_ADMIN : TRAVA_PROPRIO;
    return {
      tipo: "membro",
      membro: m,
      souEu,
      nome: souEu ? "Você" : m.nome,
      iniciais: souEu ? "VC" : iniciais(m.nome),
      conversas: conversasDoMembro(base, m.id),
      travado,
    };
  };

  const convites: CartaoConvite[] = gerencia
    ? (base.convites ?? []).map((c) => ({ tipo: "convite", convite: c, enviado: textoDoEnvio(c.enviado_em, agora) }))
    : [];
  return [...eu.map(cartao), ...ativos.map(cartao), ...convites, ...desativados.map(cartao)];
}

/** As conversas com a pessoa agora (ela é a responsável), a de mensagem mais recente primeiro. */
export function conversasDoMembro(base: BaseEquipe, membroId: string): ConversaNoCartao[] {
  const contatos = mapaContatos(base);
  const etapas = new Map(base.etapas.map((e) => [e.id, e]));
  const quando = (c: Conversa) => (c.ultima_mensagem_em ? Date.parse(c.ultima_mensagem_em) : -Infinity);
  return base.conversas
    .filter((c) => c.modo === "humano" && c.responsavel_id === membroId)
    .sort((a, b) => quando(b) - quando(a))
    .map((c) => {
      const contato = contatos.get(c.contato_id);
      return {
        conversaId: c.id,
        contatoId: c.contato_id,
        nome: contato ? nomeDoContato(contato) : "Sem nome",
        etapa: contato?.etapa_id ? etapas.get(contato.etapa_id) : undefined,
        ultimaEm: c.ultima_mensagem_em,
      };
    });
}

/**
 * O erro do convite em texto, antes de mandar (os mesmos casos do reducer e do servidor:
 * `email_invalido` e `email_em_uso`, este separado em membro ativo, desativado, você e convite).
 * Null = pode mandar (o servidor ainda confere a conta do Auth).
 */
export function erroDoConvite(base: Pick<BaseEquipe, "membros" | "eu" | "convites">, email: string): string | null {
  const limpo = email.trim().toLowerCase();
  if (!limpo) return "Escreva o e-mail da pessoa.";
  if (!RE_EMAIL.test(limpo)) return "Esse e-mail parece incompleto. Confira se tem @ e o domínio.";
  const m = base.membros.find((x) => x.email === limpo);
  if (m) {
    if (m.id === base.eu.id) return "Esse é o seu e-mail.";
    return m.ativo
      ? `${m.nome} já está na equipe.`
      : `${m.nome} já está na equipe, com a conta desativada. Para trazer de volta, use Reativar no cartão.`;
  }
  if ((base.convites ?? []).some((c) => c.email === limpo)) {
    return "Já existe um convite para esse e-mail. Para renovar, use Renovar no cartão do convite.";
  }
  return null;
}
