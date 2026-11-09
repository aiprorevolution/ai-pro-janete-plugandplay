import type { TablesInsert } from "@/integrations/firebase/types";

import { dataCurta, diaLocal, horaCurta, mesmoDia, type Instante } from "../comum/tempo";
import { CAMPOS_TEXTO_CONTEXTO, LIMITE_LETRAS_CONTEXTO, lerItensContexto, type MudancasContexto } from "../dados/contexto";
import { contarLetras } from "../dados/tipos";
import type { Erro, VersaoContextoBanco } from "../dados/tipos";
import {
  CAMPOS,
  ehChaveCampo,
  infoCampo,
  type Alvo,
  type Anexo,
  type ChaveCampo,
  type DestinoEnsinar,
  type ErroContexto,
  type ItemLivre,
  type Rascunho,
  type Situacao,
  type VersaoContexto,
} from "./tipos";

// As regras puras da tela de Contexto (docs/spec-contexto.md, "Contratos"): nada aqui guarda estado
// nem lê o relógio sozinho. A loja (loja.ts) e as telas usam estas funções.

/** O estado da loja (loja.ts). Mora aqui para as regras puras lerem sem importar a loja. */
export interface EstadoContexto {
  /** Da mais nova para a mais velha (no modo banco, a atual e as páginas do histórico já lidas). */
  versoes: VersaoContexto[];
  /** O id da versão antiga na tela (só leitura) ou `null` na atual. */
  vendo: number | null;
  rascunhos: Partial<Record<Alvo, Rascunho>>;
  /** A entrada completa já rodou nesta sessão (as seguintes são curtas). */
  jaEntrou: boolean;
}

/* ---------- utilidades de texto (as do protótipo) ---------- */

/** "Tem período de teste?" fica; "Próximo e direto" vira "Próximo e direto.". */
export function comPonto(t: string): string {
  const p = t.trim();
  return !p || /[.!?…:]$/.test(p) ? p : `${p}.`;
}

/** Corta em `n` letras, com reticências. */
export function curto(t: string, n: number): string {
  const s = t.trim().replace(/\s+/g, " ");
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "a", "a e b", "a, b e c". */
export function juntar(lista: readonly string[]): string {
  if (lista.length <= 1) return lista.join("");
  return `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
}

const SEM_ACENTO = /[̀-ͯ]/g;
function semAcento(s: string): string {
  return s.normalize("NFD").replace(SEM_ACENTO, "");
}

/** O texto salvo mais o que chegou pela caixa de mandar, separados por linha em branco. */
export function juntarTexto(base: string, extras: readonly string[] | undefined): string {
  return [base, ...(extras ?? [])]
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n\n");
}

/* ---------- versões e alvos ---------- */

/** As listas de anexos, todas vazias (na v1 os anexos ficam escondidos: decisão 11a). */
export function semAnexos(): Record<ChaveCampo, Anexo[]> {
  return {
    empresa_oferta: [],
    cliente_ideal: [],
    preco: [],
    diferenciais: [],
    tom_voz: [],
    quando_passar_humano: [],
    objecoes: [],
    horario: [],
  };
}

/**
 * O Contexto antes da 1ª versão ("Nenhuma versão ainda"): tudo vazio, id e número 0. A tela mostra
 * os campos vazios, e o 1º salvamento cria a versão 1 (`contexto_salvar` com `p_base` nulo).
 */
export const VERSAO_VAZIA: VersaoContexto = Object.freeze({
  id: 0,
  numero: 0,
  origem: "edicao",
  quem: "",
  criadoEm: "",
  resumo: "",
  campos: Object.freeze({
    empresa_oferta: "",
    cliente_ideal: "",
    preco: "",
    diferenciais: "",
    tom_voz: "",
    quando_passar_humano: "",
    objecoes: "",
    horario: "",
  }),
  itens: [],
  anexos: semAnexos(),
}) as VersaoContexto;

/** Ainda não há nenhuma versão gravada. */
export function semVersao(estado: EstadoContexto): boolean {
  return estado.versoes.length === 0;
}

/** A versão que a Janete usa: a de maior id. Sem nenhuma, a VERSAO_VAZIA. */
export function versaoAtual(estado: EstadoContexto): VersaoContexto {
  let atual = estado.versoes[0];
  for (const v of estado.versoes) if (!atual || v.id > atual.id) atual = v;
  return atual ?? VERSAO_VAZIA;
}

/** A versão de um id, se ela estiver entre as lidas. */
export function versaoPorId(estado: EstadoContexto, id: number): VersaoContexto | undefined {
  return estado.versoes.find((x) => x.id === id);
}

/** A versão na tela: a antiga que está sendo vista (`vendo` é o id dela), ou a atual. */
export function versaoNaTela(estado: EstadoContexto): VersaoContexto {
  if (estado.vendo !== null) {
    const v = versaoPorId(estado, estado.vendo);
    if (v) return v;
  }
  return versaoAtual(estado);
}

/** O número da próxima versão (a 1ª, sem nenhuma, é a 1). */
export function proximoNumero(estado: EstadoContexto): number {
  return versaoAtual(estado).numero + 1;
}

/** O número de um alvo `livre-n` (1, 2, …); `null` para campo, item novo ou alvo malformado. */
export function numeroDoItem(alvo: Alvo): number | null {
  if (!alvo.startsWith("livre-") || alvo === "livre-novo") return null;
  const n = Number(alvo.slice(6));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function alvoDoItem(n: number): `livre-${number}` {
  return `livre-${n}`;
}

/** O que um alvo guarda numa versão; `null` se o item não existe nela. */
export function dadosDoAlvo(versao: VersaoContexto, alvo: Alvo): { texto: string; pergunta: string; anexos: Anexo[] } | null {
  if (ehChaveCampo(alvo)) return { texto: versao.campos[alvo], pergunta: "", anexos: versao.anexos[alvo] };
  if (alvo === "livre-novo") return { texto: "", pergunta: "", anexos: [] };
  const n = numeroDoItem(alvo);
  const item = n === null ? undefined : versao.itens[n - 1];
  return item ? { texto: item.resposta, pergunta: item.pergunta, anexos: [] } : null;
}

/** O resultado de aplicar um rascunho ao que está salvo: o que a versão nova vai guardar. */
export function aplicarRascunho(
  salvo: { texto: string; pergunta: string; anexos: Anexo[] },
  r: Rascunho,
): { texto: string; pergunta: string; anexos: Anexo[] } {
  const base = r.texto ?? r.resposta ?? salvo.texto;
  const removidos = new Set(r.removidos ?? []);
  return {
    texto: juntarTexto(base, r.extras),
    pergunta: (r.pergunta ?? salvo.pergunta).trim(),
    anexos: [...salvo.anexos.filter((a) => !removidos.has(a.id)), ...(r.anexos ?? [])],
  };
}

function mesmosAnexos(a: readonly Anexo[], b: readonly Anexo[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i]?.id);
}

/** O rascunho muda alguma coisa em relação ao que está salvo na versão atual? */
export function rascunhoMuda(estado: EstadoContexto, alvo: Alvo): boolean {
  const r = estado.rascunhos[alvo];
  if (!r) return false;
  const salvo = dadosDoAlvo(versaoAtual(estado), alvo);
  if (!salvo) return false;
  const depois = aplicarRascunho(salvo, r);
  return depois.texto !== salvo.texto.trim() || depois.pergunta !== salvo.pergunta.trim() || !mesmosAnexos(depois.anexos, salvo.anexos);
}

/**
 * O que a tela mostra num alvo: o que está na versão na tela e, na atual, com o rascunho do admin por
 * cima. `verRascunho = false` é a visão do atendente (que nunca vê rascunho).
 */
export function conteudoDe(
  estado: EstadoContexto,
  alvo: Alvo,
  verRascunho = true,
): { texto: string; pergunta: string; anexos: Anexo[] } | null {
  const salvo = dadosDoAlvo(versaoNaTela(estado), alvo);
  if (!salvo) return null;
  const r = estado.rascunhos[alvo];
  return verRascunho && estado.vendo === null && r ? aplicarRascunho(salvo, r) : { ...salvo, texto: salvo.texto.trim() };
}

/**
 * A situação de um campo ou item: "sabe" (tem conteúdo salvo), "vazio" ou "nao_salvo" (o admin mudou
 * e ainda não salvou; se a mudança apagou tudo, conta como vazio, como no protótipo).
 */
export function situacao(estado: EstadoContexto, alvo: Alvo, verRascunho = true): Situacao {
  const c = conteudoDe(estado, alvo, verRascunho);
  if (!c) return "vazio";
  const cheio = alvo === "livre-novo" ? !!(c.pergunta || c.texto) : !!(c.texto || c.anexos.length);
  if (verRascunho && estado.vendo === null && rascunhoMuda(estado, alvo)) return cheio ? "nao_salvo" : "vazio";
  return cheio && alvo !== "livre-novo" ? "sabe" : "vazio";
}

/** Abaixo de quantas letras (sem contar espaços) um campo de texto conta como fraco (decisão 7; fora Horário, Preço e Tom de voz, decisão 12). */
export const LIMITE_CAMPO_FRACO = 20;

/** Os textos dos 8 campos, soltos como na linha de `contexto_versoes` (o que faltar ou vier nulo é vazio). */
export type TextosDosCampos = Partial<Record<ChaveCampo, string | null>>;

/**
 * Os campos curtos por natureza ("24h", "R$ 97", "Informal"): neles, só o vazio conta como fraco
 * (decisão 12).
 */
const FRACOS_SO_VAZIOS: ReadonlySet<ChaveCampo> = new Set<ChaveCampo>(["horario", "preco", "tom_voz"]);

/**
 * Os campos de texto (dos 8) em que a Janete sabe pouco, na ordem da tela (CAMPOS). Horário, Preço e
 * Tom de voz contam só quando estão vazios, sem contar espaços (decisão 12); os outros 5, quando têm
 * menos de LIMITE_CAMPO_FRACO letras, sem contar espaços (o emoji vale 1 letra, como no banco). Só
 * olha o que está salvo: rascunho e anexo não contam.
 *
 * Aceita a versão da tela (`{ campos }`, a VersaoContexto) ou a linha do banco direto (a
 * VersaoContextoBanco do `useContextoAtual().dados`, com as 8 colunas soltas), sem remontar nada.
 *   - `null`: o Contexto não tem versão; os 8 contam como fracos.
 *   - `undefined`: ainda não se sabe (carregando ou a leitura falhou); nenhum fraco, para o aviso
 *     não piscar no carregamento nem afirmar algo falso quando a leitura falha.
 */
export function camposFracos(versao: { campos: TextosDosCampos } | TextosDosCampos | null | undefined): ChaveCampo[] {
  if (versao === undefined) return [];
  const textos: TextosDosCampos = versao === null ? {} : "campos" in versao ? (versao.campos as TextosDosCampos) : versao;
  return CAMPOS.map((c) => c.chave).filter((chave) => {
    const letras = contarLetras((textos[chave] ?? "").replace(/\s+/g, ""));
    return FRACOS_SO_VAZIOS.has(chave) ? letras === 0 : letras < LIMITE_CAMPO_FRACO;
  });
}

/** "A Janete sabe pouco sobre: Preço, Diferenciais" (decisão 7), ou nada com todos os campos bons. */
export function avisoCamposFracos(fracos: readonly ChaveCampo[]): string | null {
  return fracos.length ? `A Janete sabe pouco sobre: ${fracos.map((c) => infoCampo(c).rotulo).join(", ")}` : null;
}

/** Os números do cabeçalho: "6 de 8 campos · 3 itens livres · 3 anexos". */
export function contagem(versao: VersaoContexto): { campos: number; itens: number; anexos: number } {
  let campos = 0;
  let anexos = 0;
  for (const c of CAMPOS) {
    const n = versao.anexos[c.chave].length;
    if (versao.campos[c.chave].trim() || n) campos += 1;
    anexos += n;
  }
  return { campos, itens: versao.itens.length, anexos };
}

/* ---------- o resumo do histórico ---------- */

/**
 * A linha do histórico de uma versão nova: "Preço, com 1 anexo novo.", "Pergunta livre nova: nota
 * fiscal.", "Empresa e oferta, Tom de voz e 2 perguntas livres." (as frases do protótipo).
 */
export function resumoDaVersao(antes: VersaoContexto, depois: VersaoContexto): string {
  const campos = CAMPOS.filter(
    (c) =>
      antes.campos[c.chave].trim() !== depois.campos[c.chave].trim() || !mesmosAnexos(antes.anexos[c.chave], depois.anexos[c.chave]),
  );
  const idsAntes = new Set(CAMPOS.flatMap((c) => antes.anexos[c.chave].map((a) => a.id)));
  const novosAnexos = CAMPOS.reduce((n, c) => n + depois.anexos[c.chave].filter((a) => !idsAntes.has(a.id)).length, 0);

  // itens: pela pergunta; o que trocou de pergunta no mesmo lugar conta como edição
  const perguntasAntes = new Map(antes.itens.map((i) => [i.pergunta.trim(), i]));
  const perguntasDepois = new Set(depois.itens.map((i) => i.pergunta.trim()));
  const novos = depois.itens.filter((i) => !perguntasAntes.has(i.pergunta.trim()));
  const removidos = antes.itens.filter((i) => !perguntasDepois.has(i.pergunta.trim()));
  const editados = depois.itens.filter((i) => {
    const a = perguntasAntes.get(i.pergunta.trim());
    return a !== undefined && a.resposta.trim() !== i.resposta.trim();
  });
  let trocados = 0;
  if (novos.length && novos.length === removidos.length && antes.itens.length === depois.itens.length) trocados = novos.length;
  const nItens = editados.length + (trocados || novos.length + removidos.length);

  if (!campos.length && nItens === 1) {
    if (trocados || editados.length) return comPonto(`Pergunta livre: ${curto((editados[0] ?? novos[0])!.pergunta, 40)}`);
    if (novos[0]) return comPonto(`Pergunta livre nova: ${curto(novos[0].pergunta, 40)}`);
    if (removidos[0]) return comPonto(`Pergunta livre removida: ${curto(removidos[0].pergunta, 40)}`);
  }
  const partes = campos.map((c) => c.rotulo);
  if (nItens) partes.push(plural(nItens, "pergunta livre", "perguntas livres"));
  if (!partes.length) return novosAnexos ? `${plural(novosAnexos, "anexo novo", "anexos novos")}.` : "Sem mudanças.";
  return `${juntar(partes)}${novosAnexos ? `, com ${plural(novosAnexos, "anexo novo", "anexos novos")}` : ""}.`;
}

/* ---------- "Ensinar algo novo": para qual campo vai (por palavras, como no protótipo) ---------- */

const ROTAS: readonly (readonly [ChaveCampo, RegExp])[] = [
  ["horario", /(horario|segunda|terca|quarta|quinta|sexta|sabado|domingo|feriado|\d{1,2}\s*h\b|\d{1,2}h\d{2}|expediente|plantao)/],
  ["preco", /(r\$|preco|valor|custa|plano|parcel|desconto|pagamento|boleto|pix|cartao|mensalidade)/],
  ["objecoes", /(objec|acha caro|acham caro|esta caro|vou pensar|desconfi|medo|receio|nao tenho tempo|resistencia)/],
  ["quando_passar_humano", /(humano|vendedor|passar para|transferir|chamar alguem|atendente|reuniao|ligacao|visita)/],
  ["tom_voz", /(tom de voz|\btom\b|linguagem|formal|giria|emoji|jeito de falar)/],
  ["diferenciais", /(diferencia|melhor que|garantia|exclusiv|\bunico|concorren)/],
  ["cliente_ideal", /(cliente ideal|publico|perfil|nicho|segmento|porte|funcionarios)/],
  ["empresa_oferta", /(empresa|oferta|vendemos|servico|produto|programa|fundad|anos de mercado)/],
];

/** O campo de um texto do "Ensinar"; "livre" se for uma pergunta sem campo; `null` se não souber. */
export function rotear(texto: string): DestinoEnsinar {
  const n = semAcento(texto.toLowerCase());
  for (const [chave, re] of ROTAS) if (re.test(n)) return chave;
  if (/\?\s*$/.test(texto)) return "livre";
  return null;
}

/* ---------- anexos e links ---------- */

const RE_LINK = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

/** O texto da caixa parece um link ("https://…" ou "www.…")? Então vai como link, não como texto. */
export function pareceLink(texto: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(texto.trim());
}

/** Um endereço que dá para abrir ("site.com.br", "https://site.com.br/x"). */
export function linkValido(texto: string): boolean {
  return RE_LINK.test(texto.trim());
}

export type TipoArquivo = "pdf" | "planilha" | "documento" | "imagem";

export function tipoDoNome(nome: string): TipoArquivo {
  const e = nome.toLowerCase().split(".").pop() ?? "";
  if (e === "pdf") return "pdf";
  if (["xls", "xlsx", "csv", "ods"].includes(e)) return "planilha";
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(e)) return "imagem";
  return "documento";
}

export const ROTULO_TIPO: Record<TipoArquivo, string> = {
  pdf: "PDF",
  planilha: "Planilha",
  documento: "Documento",
  imagem: "Imagem",
};

/** "248 KB", "3,2 MB". */
export function tamanhoTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;
}

/** O "A Janete aprendeu" simulado de um arquivo, fixo por tipo (não há IA de verdade nesta tela). */
export function aprendeuDoArquivo(nome: string, campo: ChaveCampo): string {
  const rot = infoCampo(campo).rotulo;
  switch (tipoDoNome(nome)) {
    case "pdf":
      return `Li o PDF ${nome}. Vou usar o que estiver nele quando o assunto for ${rot}.`;
    case "planilha":
      return `Li a planilha ${nome}. Vou usar o que estiver nela quando o assunto for ${rot}.`;
    case "imagem":
      return "Vi a imagem. Não tem texto para eu usar nas conversas.";
    default:
      return `Li o documento ${nome}. Vou usar o que estiver nele quando o assunto for ${rot}.`;
  }
}

/** O host de um link, sem "https://" nem "www.". */
export function hostDoLink(link: string): string {
  return link
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!;
}

export function aprendeuDoLink(link: string, campo: ChaveCampo): string {
  return `Li a página de ${hostDoLink(link)} e guardei o que fala de ${infoCampo(campo).rotulo}.`;
}

/* ---------- datas ---------- */

/** "Hoje, 18:20" ou "28/10, 18:20" (com o ano se for outro), sempre no relógio de São Paulo. */
export function quando(iso: Instante, agora: Instante): string {
  const hora = horaCurta(iso);
  if (!hora) return "";
  if (mesmoDia(iso, agora)) return `Hoje, ${hora}`;
  const outroAno = diaLocal(iso).slice(0, 4) !== diaLocal(agora).slice(0, 4);
  return `${dataCurta(iso, outroAno)}, ${hora}`;
}

/* ---------- banco: a linha de contexto_versoes e o contexto_salvar ---------- */

/** O limite de letras por campo e por pergunta ou resposta livre (decisão 11d). */
export const LIMITE_LETRAS = LIMITE_LETRAS_CONTEXTO;

/** O máximo de perguntas livres num Contexto (o mesmo `c_max_itens` do `contexto_salvar`, migration 0017). */
export const MAX_ITENS_LIVRES = 50;

/** O motivo do teto (o erro `limite_itens`, o "Novo item livre" desligado e o Ensinar). */
export const TEXTO_TETO_ITENS = `O Contexto já tem ${MAX_ITENS_LIVRES} perguntas livres. Apague uma para criar outra.`;

/** O erro do banco (traduzirErro) como a tela do Contexto escreve. */
export function erroDaTela(e: Erro): ErroContexto {
  switch (e) {
    case "sem_acesso":
    case "sem_permissao":
      return "sem_permissao";
    case "nao_encontrado":
    case "contexto_mudou":
    case "limite_tamanho":
    case "limite_itens":
      return e;
    default:
      return "falha";
  }
}

/** Quem é "Você" e o nome de cada membro (inclusive os inativos), para o "quem salvou". */
export interface QuemSalvou {
  euId: string | null;
  nomes: ReadonlyMap<string, string>;
}

/** "Você", o nome de quem salvou, ou "Alguém que saiu da equipe" (o membro apagado vira nulo). */
export function quemSalvou(criadoPor: string | null, quem: QuemSalvou): string {
  if (criadoPor && criadoPor === quem.euId) return "Você";
  const nome = criadoPor ? quem.nomes.get(criadoPor)?.trim() : undefined;
  return nome || "Alguém que saiu da equipe";
}

/** A linha do histórico de uma versão, a partir da anterior (sem ela: a 1ª, o onboarding ou a restauração). */
export function resumoDaNova(v: VersaoContexto, anterior: VersaoContexto | null | undefined): string {
  if (v.origem === "restauracao") return v.restauradaDe ? `Restaurada da versão ${v.restauradaDe}.` : "Restaurada de uma versão antiga.";
  if (anterior) return resumoDaVersao(anterior, v);
  const { campos } = contagem(v);
  if (v.origem === "onboarding") return `Montada no onboarding, com ${plural(campos, "campo", "campos")}.`;
  return v.numero <= 1 ? `Primeira versão, com ${plural(campos, "campo", "campos")}.` : "";
}

/**
 * Uma linha de `contexto_versoes` como a tela usa. `anterior` é a versão logo antes (para o resumo
 * "Preço e Tom de voz."); `numeros` dá o número da versão de onde a restauração veio.
 */
export function paraVersao(
  linha: VersaoContextoBanco,
  opcoes: { quem: QuemSalvou; anterior?: VersaoContexto | null | undefined; numeros?: Readonly<Record<number, number>> | undefined },
): VersaoContexto {
  const campos = {} as Record<ChaveCampo, string>;
  for (const c of CAMPOS_TEXTO_CONTEXTO) campos[c] = linha[c] ?? "";
  const restauradaDe = linha.restaurada_de !== null ? opcoes.numeros?.[linha.restaurada_de] : undefined;
  const v: VersaoContexto = {
    id: linha.id,
    numero: linha.numero ?? linha.id,
    origem: linha.origem,
    quem: quemSalvou(linha.criado_por, opcoes.quem),
    criadoEm: linha.criado_em,
    resumo: "",
    campos,
    itens: lerItensContexto(linha.itens),
    anexos: semAnexos(),
    ...(restauradaDe !== undefined ? { restauradaDe } : {}),
  };
  return { ...v, resumo: resumoDaNova(v, opcoes.anterior) };
}

/** O que salvar um alvo manda ao `contexto_salvar`: só aquele campo, ou a lista inteira de itens. */
export function mudancasDoAlvo(atual: VersaoContexto, alvo: Alvo, depois: { texto: string; pergunta: string }): MudancasContexto {
  if (ehChaveCampo(alvo)) return { [alvo]: depois.texto };
  const item = { pergunta: depois.pergunta, resposta: depois.texto };
  const n = numeroDoItem(alvo);
  const itens = atual.itens.map((i) => ({ pergunta: i.pergunta, resposta: i.resposta }));
  return { itens: n === null ? [...itens, item] : itens.map((it, i) => (i === n - 1 ? item : it)) };
}

/** Alguma mudança passa de 2.000 letras (um campo, ou a pergunta ou a resposta de um item livre)? */
export function passaDoLimite(mudancas: MudancasContexto): boolean {
  // contadas como o banco conta (char_length): o emoji vale 1 letra
  for (const c of CAMPOS_TEXTO_CONTEXTO) if (contarLetras(mudancas[c] ?? "") > LIMITE_LETRAS) return true;
  return (mudancas.itens ?? []).some((i) => contarLetras(i.pergunta) > LIMITE_LETRAS || contarLetras(i.resposta) > LIMITE_LETRAS);
}

/** As mudanças deixariam mais de MAX_ITENS_LIVRES perguntas livres (`limite_itens` do banco)? */
export function passaDoTeto(mudancas: MudancasContexto): boolean {
  return (mudancas.itens?.length ?? 0) > MAX_ITENS_LIVRES;
}

/** A versão já tem o máximo de perguntas livres: não se cria outra (o "Novo item livre" e o Ensinar). */
export function noTetoDeItens(versao: Pick<VersaoContexto, "itens">): boolean {
  return versao.itens.length >= MAX_ITENS_LIVRES;
}

type CamposEItens = Pick<VersaoContexto, "campos" | "itens">;

function mesmosItens(a: readonly ItemLivre[], b: readonly ItemLivre[]): boolean {
  return a.length === b.length && a.every((x, i) => x.pergunta === b[i]?.pergunta && x.resposta === b[i]?.resposta);
}

/**
 * O que `contexto_salvar` faz, para o modo em memória (drizzle/migrations/0009): parte da atual e
 * põe por cima o que mudou em relação à base. Um campo mudado que também mudou entre a base e a
 * atual dá `contexto_mudou`; campos diferentes se juntam. `igual` = nada diferente da atual.
 */
export function juntarMudancas(
  atual: VersaoContexto | null,
  base: VersaoContexto | null,
  mudancas: MudancasContexto,
): { ok: true; novo: CamposEItens; igual: boolean } | { ok: false; erro: "contexto_mudou" | "limite_tamanho" | "limite_itens" } {
  if (passaDoTeto(mudancas)) return { ok: false, erro: "limite_itens" };
  if (passaDoLimite(mudancas)) return { ok: false, erro: "limite_tamanho" };
  if (base === null && atual !== null) return { ok: false, erro: "contexto_mudou" };
  const de = atual ?? VERSAO_VAZIA;
  const novo: CamposEItens = { campos: { ...de.campos }, itens: de.itens.map((i) => ({ ...i })) };
  for (const c of CAMPOS_TEXTO_CONTEXTO) {
    const valor = mudancas[c];
    if (valor === undefined) continue;
    if (base && valor === base.campos[c]) continue;
    if (base && base.campos[c] !== de.campos[c]) return { ok: false, erro: "contexto_mudou" };
    novo.campos[c] = valor;
  }
  if (mudancas.itens !== undefined) {
    const itens = mudancas.itens.map((i) => ({ pergunta: i.pergunta, resposta: i.resposta }));
    if (!(base && mesmosItens(itens, base.itens))) {
      if (base && !mesmosItens(base.itens, de.itens)) return { ok: false, erro: "contexto_mudou" };
      novo.itens = itens;
    }
  }
  const igual = atual !== null && CAMPOS.every((c) => novo.campos[c.chave] === atual.campos[c.chave]) && mesmosItens(novo.itens, atual.itens);
  return { ok: true, novo, igual };
}

/** O texto de um alvo numa versão (o campo, ou "pergunta: resposta" do item), para o aviso de `contexto_mudou`. */
export function textoDoAlvo(versao: VersaoContexto, alvo: Alvo): string {
  if (ehChaveCampo(alvo)) return versao.campos[alvo].trim();
  const n = numeroDoItem(alvo);
  const item = n === null ? undefined : versao.itens[n - 1];
  return item ? `${item.pergunta.trim()} ${item.resposta.trim()}`.trim() : "";
}

/* ---------- a linha que a tela grava (o formato do banco) ---------- */

export type LinhaContexto = Pick<TablesInsert<"contexto_versoes">, ChaveCampo | "itens" | "origem">;

/** A linha de `contexto_versoes` de uma versão: itens no formato `{ pergunta, resposta }`. */
export function paraLinhaDoBanco(versao: VersaoContexto): LinhaContexto {
  const itens = versao.itens.map((i: ItemLivre) => ({ pergunta: i.pergunta, resposta: i.resposta }));
  const c = versao.campos;
  return {
    empresa_oferta: c.empresa_oferta,
    cliente_ideal: c.cliente_ideal,
    preco: c.preco,
    diferenciais: c.diferenciais,
    tom_voz: c.tom_voz,
    quando_passar_humano: c.quando_passar_humano,
    objecoes: c.objecoes,
    horario: c.horario,
    itens,
    origem: versao.origem,
  };
}
