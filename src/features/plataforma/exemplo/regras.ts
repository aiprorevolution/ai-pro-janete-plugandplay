import type {
  Contato,
  Conversa,
  EstadoBase,
  EstadoExemplo,
  Etapa,
  EventoPassagem,
  HistoricoEtapa,
  Membro,
  Mensagem,
  MotivoHumano,
  PapelMembro,
} from "./tipos";

// As leituras que as telas repetem (Chat, Kanban e Contatos), num lugar só, para as três contarem a
// mesma história. Todas puras: recebem o estado (e o "agora", quando o tempo conta) e devolvem.

const HORA_MS = 3_600_000;
/** Horas sem resposta do lead para o card esfriar (Kanban 2). */
const ESFRIA_H = 24;

/** As falhas que tiram a Janete da conversa (o "sino" de falha, diferente do "a Janete pediu ajuda"). */
export const MOTIVOS_FALHA: readonly MotivoHumano[] = [
  "chave_invalida",
  "sem_credito",
  "audio_sem_transcricao",
  "limite_passos",
  "erro_provedor",
  "envio_falhou",
];

/**
 * A situação da conversa, nos mesmos nomes do selo do avatar (`AvatarLead`), com a regra do banco
 * (0002: quem espera é quem tem `aguardando_humano_desde`):
 * - `janete`: a Janete atende;
 * - `membro`: uma pessoa assumiu (o responsável);
 * - `celular`: com a empresa, sem responsável e sem ninguém esperando (o celular respondeu);
 * - `falha`: a Janete saiu por uma falha (chave, crédito, áudio, limite, provedor) e ninguém assumiu;
 * - `aguardando`: a Janete passou para a equipe e ninguém assumiu.
 * O nome não é `situacaoDe` para não colidir com o de `comum/LinhaConversa`, que monta o texto da linha.
 */
export type SituacaoConversa = "janete" | "aguardando" | "falha" | "membro" | "celular";

export function seloDaConversa(
  c: Pick<Conversa, "modo" | "responsavel_id" | "motivo_humano" | "aguardando_humano_desde">,
): SituacaoConversa {
  if (c.modo === "janete") return "janete";
  if (c.responsavel_id) return "membro";
  if (!c.aguardando_humano_desde) return "celular";
  return c.motivo_humano && MOTIVOS_FALHA.includes(c.motivo_humano) ? "falha" : "aguardando";
}

/** Esperando alguém da equipe (Janete passou ou falhou, sem responsável). */
export function estaAguardando(
  conversa: Pick<Conversa, "modo" | "responsavel_id" | "motivo_humano" | "aguardando_humano_desde">,
): boolean {
  const s = seloDaConversa(conversa);
  return s === "aguardando" || s === "falha";
}

/**
 * O telefone para a tela. No banco ele é só dígitos, com o código do país (5511900000001);
 * `55` + DDD + 8 ou 9 dígitos vira "(11) 90000-0001". Qualquer outro formato volta como veio.
 */
export function telefoneLegivel(tel: string | null): string {
  if (!tel) return "";
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(tel);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : tel;
}

/** O admin é quem troca a conexão, a chave e o ritmo, e quem apaga contato (spec, blocos 1 e 2). */
export function ehAdmin(membro: Pick<Membro, "papel" | "ativo"> | null | undefined): boolean {
  return !!membro && membro.ativo && membro.papel === "admin";
}

/** O membro do exemplo que corresponde ao papel: admin = "Você", atendente = Marina. */
export function membroDoPapel(membros: readonly Membro[], papel: PapelMembro): Membro {
  return membros.find((m) => m.papel === papel && m.ativo) ?? membros[0]!;
}

/** O nome de um membro do ponto de vista de quem olha: "Você" quando é o próprio. */
export function nomeDoMembro(estado: Pick<EstadoExemplo, "membros" | "eu">, membroId: string | null): string {
  if (!membroId) return "";
  if (membroId === estado.eu.id) return "Você";
  return estado.membros.find((m) => m.id === membroId)?.nome ?? "Alguém da equipe";
}

/** A conexão que manda mensagens: existe, está ativa e conectada. */
export function conexaoAtiva(estado: Pick<EstadoBase, "conexao">): boolean {
  const c = estado.conexao;
  return !!c && c.ativa && c.status === "conectada";
}

/**
 * Janela de 24 h fechada: só vale na API oficial (`oficial`: Meta e Zernio), como no banco
 * (tg_mensagens_antes_inserir). O lead não escreve há 24 h ou mais, ou nunca escreveu.
 */
export function janelaFechada(
  estado: Pick<EstadoBase, "conexao">,
  conversa: Pick<Conversa, "ultima_do_lead_em">,
  agora: Date | string,
): boolean {
  if (!estado.conexao?.oficial) return false;
  if (!conversa.ultima_do_lead_em) return true;
  return new Date(conversa.ultima_do_lead_em).getTime() + 24 * HORA_MS <= new Date(agora).getTime();
}

/**
 * Quanto o card esfriou (Kanban 2, `nivelFrio`): a última palavra foi da empresa e o lead está
 * calado há 24 h ou mais. 0 = não esfriou; 1, 2 e 3 a cada 24 h. Ganho, Perdido e quem está
 * esperando a equipe não esfriam.
 */
export function nivelFrio(estado: Pick<EstadoBase, "etapas" | "contatos">, conversa: Conversa, agora: Date | string): number {
  if (estaAguardando(conversa)) return 0;
  const etapa = etapaDoContato(estado, conversa.contato_id);
  if (etapa && etapa.tipo !== "aberta") return 0;
  const lead = conversa.ultima_do_lead_em ? new Date(conversa.ultima_do_lead_em).getTime() : null;
  const ultima = conversa.ultima_mensagem_em ? new Date(conversa.ultima_mensagem_em).getTime() : null;
  if (lead === null || ultima === null || ultima <= lead) return 0;
  const h = (new Date(agora).getTime() - lead) / HORA_MS;
  if (h < ESFRIA_H) return 0;
  return Math.min(3, 1 + Math.floor((h - ESFRIA_H) / ESFRIA_H));
}

/** O card esfria (Kanban 2): `nivelFrio` acima de 0. */
export function estaEsfriando(estado: Pick<EstadoBase, "etapas" | "contatos">, conversa: Conversa, agora: Date | string): boolean {
  return nivelFrio(estado, conversa, agora) > 0;
}

/**
 * "Ativa agora" (Kanban 2): a conversa está com a Janete, numa etapa aberta, e a Janete está digitando
 * ou houve troca (do lead ou da Janete) nos últimos 5 minutos. Mensagem cancelada ou que falhou não conta.
 */
export function janeteAtivaAgora(
  estado: Pick<EstadoBase, "mensagens" | "digitando" | "conversas" | "etapas" | "contatos">,
  conversaId: string,
  agora: Date | string,
): boolean {
  const conversa = estado.conversas.find((c) => c.id === conversaId);
  if (!conversa || conversa.modo !== "janete") return false;
  const etapa = etapaDoContato(estado, conversa.contato_id);
  if (etapa && etapa.tipo !== "aberta") return false;
  if (estado.digitando.includes(conversaId)) return true;
  const limite = new Date(agora).getTime() - 5 * 60_000;
  return estado.mensagens.some(
    (m) =>
      m.conversa_id === conversaId &&
      (m.origem === "janete" || m.origem === "lead") &&
      m.status !== "cancelada" &&
      m.status !== "falhou" &&
      new Date(m.momento).getTime() >= limite,
  );
}

/* ---------- buscas ---------- */

export function etapasVisiveis(estado: Pick<EstadoBase, "etapas">): Etapa[] {
  return estado.etapas.filter((e) => !e.arquivada).sort((a, b) => a.ordem - b.ordem);
}

export function contatoPorId(estado: Pick<EstadoBase, "contatos">, contatoId: string): Contato | undefined {
  return estado.contatos.find((c) => c.id === contatoId);
}

export function conversaDoContato(estado: Pick<EstadoBase, "conversas">, contatoId: string): Conversa | undefined {
  return estado.conversas.find((c) => c.contato_id === contatoId);
}

export function etapaDoContato(estado: Pick<EstadoBase, "etapas" | "contatos">, contatoId: string): Etapa | undefined {
  const c = contatoPorId(estado, contatoId);
  return c ? estado.etapas.find((e) => e.id === c.etapa_id) : undefined;
}

export function mensagensDaConversa(estado: Pick<EstadoBase, "mensagens">, conversaId: string): Mensagem[] {
  return estado.mensagens.filter((m) => m.conversa_id === conversaId).sort(porMomento((m) => m.momento));
}

/** A última mensagem que não foi cancelada (a da linha da lista e do card). */
export function ultimaMensagem(estado: Pick<EstadoBase, "mensagens">, conversaId: string): Mensagem | undefined {
  const lista = mensagensDaConversa(estado, conversaId).filter((m) => m.status !== "cancelada");
  return lista[lista.length - 1];
}

export function historicoDoContato(estado: Pick<EstadoBase, "historico">, contatoId: string): HistoricoEtapa[] {
  return estado.historico.filter((h) => h.contato_id === contatoId).sort(porMomento((h) => h.criado_em));
}

/** O gasto de IA da conversa, em dólar (só o admin vê). `null` quando não há nenhum gasto registrado. */
export function custoDaConversa(estado: Pick<EstadoBase, "custos">, conversaId: string): number | null {
  const linhas = estado.custos.filter((c) => c.conversa_id === conversaId && c.custo_usd !== null);
  if (!linhas.length) return null;
  return linhas.reduce((t, c) => t + (c.custo_usd ?? 0), 0);
}

/**
 * Um item da linha do tempo da conversa: uma mensagem, uma passagem do bastão ou uma mudança de
 * etapa (do histórico; a entrada em Novo pelo sistema fica de fora, como no Chat final).
 */
export type ItemLinha =
  | { k: "mensagem"; id: string; em: string; mensagem: Mensagem }
  | { k: "passagem"; id: string; em: string; evento: EventoPassagem }
  | { k: "etapa"; id: string; em: string; historico: HistoricoEtapa };

export function linhaDaConversa(
  estado: Pick<EstadoBase, "mensagens" | "eventos" | "historico" | "conversas">,
  conversaId: string,
): ItemLinha[] {
  const conversa = estado.conversas.find((c) => c.id === conversaId);
  if (!conversa) return [];
  const itens: ItemLinha[] = [
    ...estado.mensagens
      .filter((m) => m.conversa_id === conversaId)
      .map((m): ItemLinha => ({ k: "mensagem", id: m.id, em: m.momento, mensagem: m })),
    ...estado.eventos
      .filter((e) => e.conversa_id === conversaId)
      .map((e): ItemLinha => ({ k: "passagem", id: e.id, em: e.criado_em, evento: e })),
    ...estado.historico
      .filter((h) => h.contato_id === conversa.contato_id && h.ator !== "sistema")
      .map((h): ItemLinha => ({ k: "etapa", id: h.id, em: h.criado_em, historico: h })),
  ];
  // sort estável: no mesmo instante, fica a ordem de cima (mensagens, passagens, etapas), salvo a
  // passagem causada por um envio ("Você assumiu a conversa" ao responder sem assumir), que vem antes
  // da mensagem que a causou, como no protótipo.
  const peso = (i: ItemLinha) => (i.k === "passagem" && i.evento.por_envio ? -1 : 0);
  return itens.sort((a, b) => tempo(a.em) - tempo(b.em) || peso(a) - peso(b));
}

/** As conversas da lista, da mais recente para a mais antiga (pela última mensagem). */
export function conversasPorRecencia(estado: Pick<EstadoBase, "conversas">): Conversa[] {
  return [...estado.conversas].sort((a, b) => tempo(b.ultima_mensagem_em ?? b.criado_em) - tempo(a.ultima_mensagem_em ?? a.criado_em));
}

/* ---------- avatar ---------- */

export type CorAvatar = "azul" | "menta" | "areia" | "rosa";
const CORES: readonly CorAvatar[] = ["azul", "menta", "areia", "rosa"];

/** A cor do avatar de um contato: fixa pelo id, a mesma na lista, no card, na conversa e no perfil. */
export function corDoContato(contatoId: string): CorAvatar {
  let soma = 0;
  for (let i = 0; i < contatoId.length; i += 1) soma = (soma * 31 + contatoId.charCodeAt(i)) % 9973;
  return CORES[soma % CORES.length]!;
}

/* ---------- apoio ---------- */

function tempo(iso: string): number {
  return new Date(iso).getTime();
}

function porMomento<T>(de: (x: T) => string) {
  return (a: T, b: T) => tempo(de(a)) - tempo(de(b));
}
