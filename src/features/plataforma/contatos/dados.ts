import { MOTIVO_LONGO, nomeDoContato, resumoMensagem } from "../comum/LinhaConversa";
import { diaLocal, diasEntre, duracao, mesmoDia, type Instante } from "../comum/tempo";
import {
  MOTIVOS_FALHA,
  conversaDoContato,
  estaAguardando,
  historicoDoContato,
  mensagensDaConversa,
  janeteAtivaAgora,
  nomeDoMembro,
  seloDaConversa,
  type Contato,
  type Conversa,
  type Etapa,
  type HistoricoEtapa,
  type Mensagem,
  type MotivoHumano,
  type TipoMensagem,
} from "../exemplo";
import type {
  Acontecimento,
  Contadores,
  ConversaDaLinhaBanco,
  EstadoContatos,
  EventoContato,
  FatoJanete,
  FiltrosTabela,
  LinhaContatoBanco,
  LinhaTabela,
  MidiaDoContato,
  PeriodoEntrada,
  ProximoPasso,
  QuemAtende,
  RecorteTabela,
} from "./tipos";

// As leituras da tela de Contatos (docs/spec-contatos.md, "Contratos"). Todas puras: recebem o estado
// e o "agora" de fora (nada de relógio próprio, para o teste fixar a hora) e nunca lançam. O dia é
// sempre o de São Paulo (comum/tempo), e as regras de quem atende são as de exemplo/regras, para a
// tabela contar a mesma história do Chat e do Kanban.

export const FILTROS_INICIAIS: FiltrosTabela = {
  busca: "",
  recorte: "todos",
  etapaIds: [],
  entrada: "qualquer",
  ordem: { coluna: "ultima", direcao: "desc" },
};

/** Minúsculas, sem acento e com os espaços juntos: "  Clínica   VALE " vira "clinica vale". */
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- quem atende ---------- */

const SEM_CONVERSA: QuemAtende = { tipo: "janete", nome: "A Janete", membroId: null, esperaDesde: null, aoVivo: false };

/**
 * Quem está com o contato, na regra do selo (seloDaConversa). Sem conversa (o contato ainda não
 * escreveu), conta como a Janete, sem "ao vivo".
 */
export function quemAtende(estado: EstadoContatos, conversa: Conversa | undefined, agora: Instante): QuemAtende {
  if (!conversa) return { ...SEM_CONVERSA };
  const tipo = seloDaConversa(conversa);
  const base = { tipo, membroId: null, esperaDesde: conversa.aguardando_humano_desde, aoVivo: false };
  switch (tipo) {
    case "janete":
      return { ...base, nome: "A Janete", aoVivo: janeteAtivaAgora(estado, conversa.id, comoData(agora)) };
    case "membro":
      return { ...base, nome: nomeDoMembro(estado, conversa.responsavel_id), membroId: conversa.responsavel_id };
    case "celular":
      return { ...base, nome: "Celular da empresa" };
    case "aguardando":
    case "falha":
      return { ...base, nome: "Esperando a equipe" };
  }
}

/* ---------- os contadores e a tabela ---------- */

const RECORTES: readonly RecorteTabela[] = ["todos", "precisam", "novos_hoje", "com_janete", "comigo"];

/**
 * A regra de cada aba de contador, a mesma para o número e para o filtro da tabela (o número da aba
 * é sempre o total de linhas que ela mostra sem busca).
 */
function noRecorte(
  estado: EstadoContatos,
  contato: Contato,
  conversa: Conversa | undefined,
  recorte: RecorteTabela,
  agora: Instante,
): boolean {
  switch (recorte) {
    case "todos":
      return true;
    case "precisam":
      // inclui quem a Janete deixou por falha (estaAguardando cobre "aguardando" e "falha")
      return !!conversa && estaAguardando(conversa);
    case "novos_hoje":
      return !!contato.primeira_mensagem_em && mesmoDia(contato.primeira_mensagem_em, agora);
    case "com_janete":
      return conversa?.modo === "janete";
    case "comigo":
      return conversa?.modo === "humano" && conversa.responsavel_id === estado.eu.id;
  }
}

export function contadores(estado: EstadoContatos, agora: Instante): Contadores {
  const total: Contadores = { todos: 0, precisam: 0, novos_hoje: 0, com_janete: 0, comigo: 0 };
  for (const contato of estado.contatos) {
    const conversa = conversaDoContato(estado, contato.id);
    for (const r of RECORTES) if (noRecorte(estado, contato, conversa, r, agora)) total[r] += 1;
  }
  return total;
}

/** Os dias de São Paulo que cada período cobre, contando hoje (7 = de 6 dias atrás até hoje). */
const DIAS_DO_PERIODO = { hoje: 1, "7": 7, "30": 30 } as const;

function noPeriodo(entrouEm: string, filtros: FiltrosTabela, agora: Instante): boolean {
  if (filtros.entrada === "qualquer") return true;
  const dias = diasEntre(entrouEm, agora);
  return Number.isFinite(dias) && dias >= 0 && dias < DIAS_DO_PERIODO[filtros.entrada];
}

/**
 * A busca: o texto normalizado contra o nome, o nome no WhatsApp, a empresa e o e-mail. Com 4
 * dígitos ou mais, compara também só os dígitos com o telefone, que o banco guarda como 55 + DDD +
 * número: "(11) 90000-0007" e "90000-0007" acham 5511900000007.
 */
function casaBusca(contato: Contato, busca: string): boolean {
  const q = normalizarBusca(busca);
  if (!q) return true;
  const campos = [contato.nome, contato.nome_whatsapp, contato.empresa, contato.email];
  if (campos.some((c) => !!c && normalizarBusca(c).includes(q))) return true;
  const digitos = busca.replace(/\D/g, "");
  return digitos.length >= 4 && !!contato.telefone && contato.telefone.replace(/\D/g, "").includes(digitos);
}

/** Etapa que sumiu do estado (não deveria acontecer): a linha aparece no fim do funil, em cinza. */
function etapaDaLinha(estado: Pick<EstadoContatos, "etapas">, etapaId: string): LinhaTabela["etapa"] {
  // Devolve a etapa inteira (com `chave`), não só o Pick: o PontoEtapa usa a chave para a cor padrão.
  return (
    estado.etapas.find((e) => e.id === etapaId) ?? {
      id: etapaId,
      chave: "",
      nome: "Sem etapa",
      cor: null,
      ordem: Number.MAX_SAFE_INTEGER,
      tipo: "aberta",
    }
  );
}

const colador = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Datas: nula vai para o fim nos dois sentidos (a direção só vale entre as que existem). */
function compararDatas(a: string | null, b: string | null, sinal: number): number {
  const ta = ms(a);
  const tb = ms(b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return (ta - tb) * sinal;
}

/** As linhas da tabela: o recorte, a busca, as etapas e o período de entrada, já na ordem pedida. */
export function linhasDaTabela(estado: EstadoContatos, filtros: FiltrosTabela, agora: Instante): LinhaTabela[] {
  const linhas: LinhaTabela[] = [];
  for (const contato of estado.contatos) {
    const conversa = conversaDoContato(estado, contato.id);
    if (!noRecorte(estado, contato, conversa, filtros.recorte, agora)) continue;
    if (filtros.etapaIds.length > 0 && !filtros.etapaIds.includes(contato.etapa_id)) continue;
    const entrouEm = contato.primeira_mensagem_em ?? contato.criado_em;
    if (!noPeriodo(entrouEm, filtros, agora)) continue;
    if (!casaBusca(contato, filtros.busca)) continue;
    linhas.push({
      contatoId: contato.id,
      conversaId: conversa?.id ?? null,
      nome: nomeDoContato(contato),
      empresa: contato.empresa,
      etapa: etapaDaLinha(estado, contato.etapa_id),
      quem: quemAtende(estado, conversa, agora),
      ultimaMensagemEm: conversa?.ultima_mensagem_em ?? null,
      entrouEm,
    });
  }

  const { coluna, direcao } = filtros.ordem;
  const sinal = direcao === "asc" ? 1 : -1;
  const principal = (a: LinhaTabela, b: LinhaTabela): number => {
    switch (coluna) {
      case "contato":
        return colador.compare(a.nome, b.nome) * sinal;
      case "etapa":
        return (a.etapa.ordem - b.etapa.ordem) * sinal;
      case "ultima":
        return compararDatas(a.ultimaMensagemEm, b.ultimaMensagemEm, sinal);
      case "entrada":
        return compararDatas(a.entrouEm, b.entrouEm, sinal);
    }
  };
  // Desempate sempre de A a Z pelo nome e depois pelo id: a ordem não pula quando o estado muda.
  return linhas.sort(
    (a, b) => principal(a, b) || colador.compare(a.nome, b.nome) || (a.contatoId < b.contatoId ? -1 : a.contatoId > b.contatoId ? 1 : 0),
  );
}

/* ---------- a linha do tempo ---------- */

const TIPOS_MIDIA: readonly TipoMensagem[] = ["audio", "imagem", "video", "documento", "figurinha"];

const ARTIGO_MIDIA: Partial<Record<TipoMensagem, string>> = {
  audio: "um áudio",
  imagem: "uma imagem",
  video: "um vídeo",
  documento: "um documento",
  figurinha: "uma figurinha",
};

/** Mídia que conta (aba Mídias e linha do tempo): não apagada e não cancelada (essa nunca saiu). */
function ehMidiaValida(m: Mensagem): boolean {
  return TIPOS_MIDIA.includes(m.tipo) && !m.apagada_em && m.status !== "cancelada";
}

function primeiroNome(contato: Contato): string {
  return nomeDoContato(contato).split(" ")[0] || "Contato";
}

const maiuscula = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** O nome da etapa pelo id ("Sem etapa" se ela sumiu). */
function nomeEtapa(etapas: readonly Etapa[], id: string | null): string {
  return (id && etapas.find((e) => e.id === id)?.nome.trim()) || "Sem etapa";
}

/** Quem mandou a mensagem, como a linha do tempo e a aba Mídias mostram. */
function autorDaMensagem(
  estado: EstadoContatos,
  contato: Contato,
  m: Mensagem,
): { quem: Acontecimento["quem"]; sujeito: string } {
  switch (m.origem) {
    case "lead": {
      const nome = primeiroNome(contato);
      return { quem: { tipo: "lead", nome }, sujeito: nome };
    }
    case "janete":
      return { quem: { tipo: "janete", nome: "Janete" }, sujeito: "A Janete" };
    case "humano_tela": {
      const nome = nomeDoMembro(estado, m.autor_membro_id) || "Alguém da equipe";
      return { quem: { tipo: "membro", nome }, sujeito: nome };
    }
    case "humano_celular":
      return { quem: { tipo: "celular", nome: "Celular da empresa" }, sujeito: "O celular da empresa" };
  }
}

/** Quem mudou a etapa: a Janete, o membro (visto por quem olha) ou o sistema. */
function autorDoHistorico(estado: EstadoContatos, h: HistoricoEtapa): { quem: Acontecimento["quem"]; sujeito: string } {
  if (h.ator === "janete") return { quem: { tipo: "janete", nome: "Janete" }, sujeito: "A Janete" };
  if (h.ator === "membro") {
    const nome = nomeDoMembro(estado, h.membro_id) || "Alguém da equipe";
    return { quem: { tipo: "membro", nome }, sujeito: nome };
  }
  return { quem: { tipo: "sistema", nome: "Sistema" }, sujeito: "O sistema" };
}

const ehFalha = (motivo: MotivoHumano | null) => !!motivo && MOTIVOS_FALHA.includes(motivo);

/** O cartão de uma passagem do bastão (os mesmos fatos do Chat, em frase de linha do tempo). */
function daPassagem(
  estado: EstadoContatos,
  ev: EventoContato,
): Pick<Acontecimento, "titulo" | "descricao" | "quem"> {
  const membro = nomeDoMembro(estado, ev.membro_id) || "Alguém da equipe";
  switch (ev.tipo) {
    case "voltou_para_fila": {
      // Quem atendia foi desativado (decisão 15 e desativar_membro): a conversa voltou para a fila.
      const quem = ev.de_membro_id ? nomeDoMembro(estado, ev.de_membro_id) || "quem atendia" : "quem atendia";
      return {
        titulo: "A conversa voltou para a fila",
        descricao: `A conta de ${quem} foi desativada. A conversa espera alguém da equipe.`,
        quem: { tipo: "sistema", nome: "Sistema" },
      };
    }
    case "passou":
      if (ehFalha(ev.motivo))
        return {
          titulo: "A Janete parou por um problema",
          descricao: `${maiuscula(MOTIVO_LONGO[ev.motivo!])}. Não foi decisão dela: a conversa espera alguém da equipe.`,
          quem: { tipo: "janete", nome: "Janete" },
        };
      return {
        titulo: "A Janete passou para a equipe",
        descricao: ev.motivo ? `Motivo: ${MOTIVO_LONGO[ev.motivo]}.` : null,
        quem: { tipo: "janete", nome: "Janete" },
      };
    case "assumiu": {
      const origem =
        ev.de === "janete"
          ? "A Janete saiu da conversa."
          : ev.de === "espera"
            ? "A conversa estava esperando a equipe."
            : ev.de === "outro"
              ? `A conversa estava com ${ev.de_membro_id === estado.eu.id ? "você" : nomeDoMembro(estado, ev.de_membro_id) || "outra pessoa"}.`
              : ev.de === "celular"
                ? "A conversa estava com o celular da empresa."
                : null;
      const descricao = ev.por_envio ? ["Respondeu pela tela.", origem].filter(Boolean).join(" ") : origem;
      return { titulo: `${membro} assumiu a conversa`, descricao, quem: { tipo: "membro", nome: membro } };
    }
    case "devolveu":
      return {
        titulo: `${membro} devolveu para a Janete`,
        descricao: "A Janete voltou a atender a conversa.",
        quem: { tipo: "membro", nome: membro },
      };
    case "celular":
      return {
        titulo: "Respondida pelo celular da empresa",
        descricao: `${maiuscula(MOTIVO_LONGO.humano_celular)}, e a Janete saiu da conversa.`,
        quem: { tipo: "celular", nome: "Celular da empresa" },
      };
  }
}

/**
 * No mesmo instante, a ordem conta a história: o contato nasce, chega a 1ª mensagem, depois o resto
 * e por último a mudança de etapa (a Janete move depois de ler). O histórico grava o minuto cheio e a
 * mensagem do mesmo minuto cai no mesmo instante, daí o peso.
 */
const PESO: Record<Acontecimento["tipo"], number> = {
  criado: 0,
  primeira_mensagem: 1,
  midia: 2,
  passou: 2,
  assumiu: 2,
  devolveu: 2,
  celular: 2,
  voltou_para_fila: 2,
  etapa: 3,
};

/**
 * A linha do tempo do contato, do mais antigo ao mais novo: a criação, a 1ª mensagem do lead, as
 * mudanças de etapa, as passagens do bastão e as mídias. A 1ª mensagem do lead, mesmo sendo uma
 * mídia, vira só "1ª mensagem" (como no protótipo Contatos 4), para não repetir o mesmo fato.
 */
export function acontecimentos(estado: EstadoContatos, contatoId: string): Acontecimento[] {
  const contato = estado.contatos.find((c) => c.id === contatoId);
  if (!contato) return [];
  const historico = historicoDoContato(estado, contatoId);
  const conversa = conversaDoContato(estado, contatoId);
  const mensagens = conversa ? mensagensDaConversa(estado, conversa.id) : [];
  const eventos = conversa ? estado.eventos.filter((e) => e.conversa_id === conversa.id) : [];

  // A etapa num instante: a do último registro do histórico até ali.
  const etapaEm = (em: string): string | null => {
    const t = Date.parse(em);
    let atual: string | null = null;
    for (const h of historico) if (Date.parse(h.criado_em) <= t) atual = h.para_etapa_id;
    return atual;
  };

  const itens: Acontecimento[] = [];

  historico.forEach((h, i) => {
    if (i === 0 && !h.de_etapa_id) {
      itens.push({
        id: `criado-${h.id}`,
        tipo: "criado",
        grupo: "etapas",
        em: h.criado_em,
        titulo: `Contato criado em ${nomeEtapa(estado.etapas, h.para_etapa_id)}`,
        descricao: null,
        quem: { tipo: "sistema", nome: "Sistema" },
        etapaId: h.para_etapa_id,
        mensagemId: null,
      });
      return;
    }
    const { quem, sujeito } = autorDoHistorico(estado, h);
    const para = nomeEtapa(estado.etapas, h.para_etapa_id);
    itens.push({
      id: `etapa-${h.id}`,
      tipo: "etapa",
      grupo: "etapas",
      em: h.criado_em,
      titulo: `${sujeito} moveu para ${para}`,
      descricao: h.de_etapa_id ? `De ${nomeEtapa(estado.etapas, h.de_etapa_id)} para ${para}` : null,
      quem,
      etapaId: h.para_etapa_id,
      mensagemId: null,
    });
  });

  const primeira = mensagens.find((m) => m.origem === "lead" && !m.apagada_em && m.status !== "cancelada");
  if (primeira) {
    const nome = primeiroNome(contato);
    itens.push({
      id: `primeira-${primeira.id}`,
      tipo: "primeira_mensagem",
      grupo: "mensagens",
      em: primeira.momento,
      titulo: `1ª mensagem de ${nome}`,
      descricao: primeira.texto?.trim() || resumoMensagem(primeira),
      quem: { tipo: "lead", nome },
      etapaId: etapaEm(primeira.momento),
      mensagemId: primeira.id,
    });
  }

  for (const m of mensagens) {
    if (m === primeira || !ehMidiaValida(m)) continue;
    const { quem, sujeito } = autorDaMensagem(estado, contato, m);
    const descricao = m.tipo === "audio" ? m.transcricao?.trim() || m.midia_nome : m.midia_nome;
    itens.push({
      id: `midia-${m.id}`,
      tipo: "midia",
      grupo: "mensagens",
      em: m.momento,
      titulo: `${sujeito} mandou ${ARTIGO_MIDIA[m.tipo] ?? "um arquivo"}`,
      descricao: descricao || null,
      quem,
      etapaId: etapaEm(m.momento),
      mensagemId: m.id,
    });
  }

  for (const ev of eventos) {
    itens.push({
      id: `${ev.tipo}-${ev.id}`,
      tipo: ev.tipo,
      grupo: "atendimento",
      em: ev.criado_em,
      ...daPassagem(estado, ev),
      etapaId: etapaEm(ev.criado_em),
      mensagemId: null,
    });
  }

  // sort estável: no mesmo instante, vale o PESO e, depois, a ordem em que entraram
  return itens.sort((a, b) => (ms(a.em) ?? 0) - (ms(b.em) ?? 0) || PESO[a.tipo] - PESO[b.tipo]);
}

/** Os `n` acontecimentos mais recentes (padrão 5), do mais novo para o mais antigo. */
export function ultimosAcontecimentos(estado: EstadoContatos, contatoId: string, n = 5): Acontecimento[] {
  const quantos = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 5;
  return acontecimentos(estado, contatoId).reverse().slice(0, quantos);
}

/* ---------- as mídias ---------- */

/** O nome da mídia sem arquivo: "Áudio de 0:42", "Imagem", "Vídeo", "Figurinha". */
function nomeSemArquivo(m: Mensagem): string {
  switch (m.tipo) {
    case "audio":
      return m.duracaoS != null ? `Áudio de ${duracao(m.duracaoS)}` : "Áudio";
    case "imagem":
      return "Imagem";
    case "video":
      return "Vídeo";
    case "figurinha":
      return "Figurinha";
    default:
      return "Documento";
  }
}

/** As mídias da conversa do contato (não apagadas), da mais antiga à mais nova. */
export function midiasDoContato(estado: EstadoContatos, contatoId: string): MidiaDoContato[] {
  const contato = estado.contatos.find((c) => c.id === contatoId);
  const conversa = conversaDoContato(estado, contatoId);
  if (!contato || !conversa) return [];
  return mensagensDaConversa(estado, conversa.id)
    .filter(ehMidiaValida)
    .map((m) => {
      const { quem } = autorDaMensagem(estado, contato, m);
      return {
        mensagemId: m.id,
        tipo: m.tipo,
        nome: m.midia_nome?.trim() || nomeSemArquivo(m),
        autor: quem.nome,
        em: m.momento,
        duracaoS: m.duracaoS ?? null,
        tamanho: m.midia_tamanho,
        transcricao: m.transcricao,
        caminho: m.midia_caminho ?? null,
        status: m.midia_status ?? null,
      };
    });
}

/* ---------- os extras que o banco ainda não guarda ---------- */

/**
 * Lê um campo extra opcional do contato (fatosJanete, proximoPasso). O tipo Contato pode ainda não
 * ter o campo (o patch do exemplo chega depois), então a leitura é por chave e o valor sai `unknown`.
 */
function extraDoContato(contato: Contato, chave: string): unknown {
  const registro: Readonly<Record<string, unknown>> = contato;
  return registro[chave];
}

function ehObjeto(x: unknown): x is Readonly<Record<string, unknown>> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const textoCheio = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";

/** Os fatos que a Janete anotou. Sem o extra, ou com item de formato errado: o item fica de fora. */
export function fatosDoContato(contato: Contato): readonly FatoJanete[] {
  const bruto = extraDoContato(contato, "fatosJanete");
  if (!Array.isArray(bruto)) return [];
  const fatos: FatoJanete[] = [];
  for (const item of bruto as readonly unknown[]) {
    if (!ehObjeto(item)) continue;
    const { rotulo, valor, mensagemId } = item;
    if (!textoCheio(rotulo) || !textoCheio(valor)) continue;
    if (mensagemId !== undefined && mensagemId !== null && typeof mensagemId !== "string") continue;
    fatos.push({ rotulo, valor, mensagemId: mensagemId ?? null });
  }
  return fatos;
}

/**
 * Quando a Janete atualizou o resumo (`contatos.resumo_janete_em`, gravado junto com o resumo pelo
 * janete_atualizar_contato). O exemplo não guarda: `null`, e o "Atualizado" não aparece.
 */
export function resumoAtualizadoEm(contato: Contato): string | null {
  const bruto = extraDoContato(contato, "resumo_janete_em");
  return textoCheio(bruto) && Number.isFinite(Date.parse(bruto)) ? bruto : null;
}

/** A sugestão de próximo passo da Janete. Sem o extra, ou com formato errado: `null`. */
export function proximoPassoDoContato(contato: Contato): ProximoPasso | null {
  const bruto = extraDoContato(contato, "proximoPasso");
  if (!ehObjeto(bruto)) return null;
  const { titulo, texto } = bruto;
  return textoCheio(titulo) && textoCheio(texto) ? { titulo, texto } : null;
}

/* ---------- a tabela pelo banco (contatos_lista, drizzle/migrations/0007) ---------- */

/** Um dia de São Paulo ("AAAA-MM-DD") mais `n` dias, no calendário (sem relógio nem fuso). */
function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
  const dois = (x: number) => String(x).padStart(2, "0");
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`;
}

/**
 * O "Entrou em" do filtro como as datas de São Paulo que o `contatos_lista` recebe (inclusivas dos
 * dois lados): hoje = [hoje, hoje]; 7 dias = [hoje − 6, hoje]; 30 dias = [hoje − 29, hoje]. É a mesma
 * régua do `noPeriodo` do exemplo (dias de calendário, contando hoje). "Qualquer data" = sem limite.
 */
export function periodoDeEntrada(entrada: PeriodoEntrada, agora: Instante): { de: string | null; ate: string | null } {
  if (entrada === "qualquer") return { de: null, ate: null };
  const hoje = diaLocal(agora);
  if (!hoje) return { de: null, ate: null };
  return { de: somarDias(hoje, -(DIAS_DO_PERIODO[entrada] - 1)), ate: hoje };
}

/**
 * O "ao vivo" de uma linha do banco, sem as mensagens: a regra de `janeteAtivaAgora` pelas datas da
 * conversa. Com a Janete, numa etapa aberta, e o lead ou a Janete falou nos últimos 5 minutos
 * (`ultima_do_lead_em` e `ultima_da_janete_em`, que o banco grava quando a mensagem da Janete sai).
 */
export function aoVivoNaLinha(
  conversa: Pick<ConversaDaLinhaBanco, "modo" | "ultima_do_lead_em" | "ultima_da_janete_em">,
  etapa: Pick<Etapa, "tipo"> | undefined,
  agora: Instante,
): boolean {
  if (conversa.modo !== "janete") return false;
  if (etapa && etapa.tipo !== "aberta") return false;
  const limite = comoData(agora).getTime() - 5 * 60_000;
  return [conversa.ultima_do_lead_em, conversa.ultima_da_janete_em].some((iso) => {
    const t = ms(iso);
    return t !== null && t >= limite;
  });
}

/** Quem atende numa linha do banco: a mesma regra do selo (`quemAtende`), com o "ao vivo" pelas datas. */
export function quemAtendeNaLinha(
  estado: Pick<EstadoContatos, "membros" | "eu" | "etapas">,
  conversa: ConversaDaLinhaBanco | null,
  etapaId: string,
  agora: Instante,
): QuemAtende {
  if (!conversa) return { ...SEM_CONVERSA };
  const tipo = seloDaConversa(conversa);
  const base = { tipo, membroId: null, esperaDesde: conversa.aguardando_humano_desde, aoVivo: false };
  switch (tipo) {
    case "janete":
      return { ...base, nome: "A Janete", aoVivo: aoVivoNaLinha(conversa, estado.etapas.find((e) => e.id === etapaId), agora) };
    case "membro":
      return { ...base, nome: nomeDoMembro(estado, conversa.responsavel_id), membroId: conversa.responsavel_id };
    case "celular":
      return { ...base, nome: "Celular da empresa" };
    case "aguardando":
    case "falha":
      return { ...base, nome: "Esperando a equipe" };
  }
}

/** Uma linha de `contatos_lista` no formato da tabela (o mesmo de `linhasDaTabela`). */
export function linhaDoBanco(
  l: LinhaContatoBanco,
  estado: Pick<EstadoContatos, "membros" | "eu" | "etapas">,
  agora: Instante,
): LinhaTabela {
  return {
    contatoId: l.contato_id,
    conversaId: l.conversa?.id ?? null,
    nome: nomeDoContato(l),
    empresa: l.empresa,
    etapa: etapaDaLinha(estado, l.etapa_id),
    quem: quemAtendeNaLinha(estado, l.conversa, l.etapa_id, agora),
    ultimaMensagemEm: l.ultima_mensagem_em,
    entrouEm: l.entrou_em || l.primeira_mensagem_em || l.criado_em,
  };
}

/* ---------- apoio ---------- */

/** As regras do exemplo aceitam Date ou ISO; o "agora" da tela pode vir em milissegundos. */
function comoData(agora: Instante): Date {
  return agora instanceof Date ? agora : new Date(agora);
}
