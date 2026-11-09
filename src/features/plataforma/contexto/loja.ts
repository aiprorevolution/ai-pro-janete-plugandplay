import { createContext, useContext, useMemo, useRef, useSyncExternalStore } from "react";

import type { MudancasContexto } from "../dados/contexto";
import type { Erro } from "../dados/tipos";
import { usePapel, type Papel } from "../papel";
import { versoesDeExemplo } from "./dados";
import {
  aplicarRascunho,
  comPonto,
  dadosDoAlvo,
  juntarMudancas,
  mudancasDoAlvo,
  noTetoDeItens,
  numeroDoItem,
  passaDoLimite,
  passaDoTeto,
  rascunhoMuda,
  resumoDaNova,
  rotear,
  semAnexos,
  textoDoAlvo,
  versaoAtual,
  versaoPorId,
  type EstadoContexto,
} from "./regras";
import {
  ehChaveCampo,
  type Alvo,
  type ChaveCampo,
  type DestinoEnsinar,
  type ErroContexto,
  type ResultadoContexto,
  type Rascunho,
  type VersaoContexto,
} from "./tipos";

export type { EstadoContexto } from "./regras";

// A loja do Contexto (task C6). Duas partes:
//   - o que é da tela (a versão antiga na tela, os rascunhos não salvos e a entrada já vista): fica no
//     nível do módulo, sobrevive à troca de área e some no recarregar;
//   - as versões e o que grava (salvar, remover um item, restaurar): vêm de uma FonteContexto. No
//     modo banco, a PonteContextoBanco (ponte.tsx) põe a fonte do banco (dados/contexto.ts); sem ela
//     (testes e modo exemplo), vale a fonte em memória daqui, que repete as regras do contexto_salvar.
// As telas só falam com useContexto(). Nenhuma ação lança: a recusada devolve o erro e não muda nada.

/** O que a fonte devolve ao gravar: a versão gravada, ou o erro (com a atual nova, em `contexto_mudou`). */
export type RespostaGravacao =
  | { ok: true; id: number; numero: number }
  | { ok: false; erro: ErroContexto; atual?: VersaoContexto | null | undefined };

/** Os 3 estados da leitura do histórico (a gaveta). */
export interface StatusHistorico {
  carregando: boolean;
  erro: Erro | null;
  tentarDeNovo(): void;
  temMaisAntigas: boolean;
  carregarMaisAntigas(): void;
  carregandoMaisAntigas: boolean;
}

/** De onde vêm as versões e por onde a tela grava. */
export interface FonteContexto {
  modo: "banco" | "memoria";
  /** Da mais nova para a mais velha: a atual e as versões já lidas. Vazia = nenhuma versão ainda. */
  versoes: VersaoContexto[];
  /** A versão atual (e quem salvou) ainda não chegou. */
  carregando: boolean;
  erro: Erro | null;
  /**
   * Os dados já chegaram (a versão atual e quem salvou). Com `erro` e `pronta`, a falha foi de uma
   * releitura em segundo plano: a tela continua, com um aviso compacto. Sem o campo, conta como não.
   */
  pronta?: boolean | undefined;
  tentarDeNovo(): void;
  historico: StatusHistorico;
  /** `contexto_salvar`: `base` é o id da versão aberta (nulo sem nenhuma versão). */
  gravar(base: number | null, mudancas: MudancasContexto): Promise<RespostaGravacao>;
  /** `contexto_restaurar`. */
  restaurar(id: number): Promise<RespostaGravacao>;
}

const FonteContextoCtx = createContext<FonteContexto | null>(null);

/** A PonteContextoBanco põe a fonte do banco por aqui. */
export const ProvedorFonteContexto = FonteContextoCtx.Provider;

export type ResultadoEnsinar = { ok: true; alvo: DestinoEnsinar } | { ok: false; erro: ErroContexto };

export interface AcoesContexto {
  /** O texto inteiro do campo (ou a resposta do item), pelo "Editar texto": substitui o que chegou pela caixa. */
  editarTexto(alvo: Alvo, texto: string): ResultadoContexto;
  /** A caixa de mandar: o texto vira um extra do rascunho (na v1 não há anexo nem link: decisão 11a). */
  mandar(alvo: Alvo, texto: string): ResultadoContexto;
  descartar(alvo: Alvo): ResultadoContexto;
  /** Grava só o que aquele alvo mudou (`contexto_salvar`) e devolve o número da versão nova. */
  salvar(alvo: Alvo): Promise<ResultadoContexto>;
  /** Abre o rascunho do "+ Novo item livre", com a pergunta se vier. */
  novoItem(pergunta?: string): ResultadoContexto;
  editarItem(alvo: `livre-${number}` | "livre-novo", mudanca: { pergunta?: string; resposta?: string }): ResultadoContexto;
  /** Tira o item `n` (1, 2, …) numa versão nova. */
  removerItem(n: number): Promise<ResultadoContexto>;
  /** Descobre o campo pelas palavras e põe o texto no rascunho; `alvo: null` pede para escolher. */
  ensinar(texto: string): ResultadoEnsinar;
  /** O admin escolheu o campo nos chips (o `rotear` não achou nada). */
  ensinarEm(destino: ChaveCampo | "livre", texto: string): ResultadoContexto;
  /** Põe na tela a versão de id `id` (só leitura); a atual volta ao normal. */
  verVersao(id: number): ResultadoContexto;
  voltarParaAtual(): void;
  /** Uma versão nova ("restauracao") igual à de id `id`; os rascunhos são descartados. Vale vendo a antiga. */
  restaurar(id: number): Promise<ResultadoContexto>;
  marcarEntrada(): void;
}

/* ---------- o estado no nível do módulo ---------- */

export function estadoInicialContexto(): EstadoContexto {
  return { versoes: versoesDeExemplo(), vendo: null, rascunhos: {}, jaEntrou: false };
}

let estado: EstadoContexto = estadoInicialContexto();
const ouvintes = new Set<() => void>();

function definir(novo: EstadoContexto): void {
  estado = novo;
  for (const f of ouvintes) f();
}

function assinar(f: () => void): () => void {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

function ler(): EstadoContexto {
  return estado;
}

function lerVendo(): number | null {
  return estado.vendo;
}

/** O estado agora, fora do React (testes). As versões são as da fonte em memória. */
export function lerContexto(): EstadoContexto {
  return estado;
}

/** Volta ao começo (os testes chamam antes de cada caso). */
export function reiniciarContexto(inicial?: Partial<EstadoContexto>): void {
  definir({ ...estadoInicialContexto(), ...inicial });
}

/** O id da versão antiga na tela (a ponte do banco usa para buscar uma versão fora das páginas lidas). */
export function useVendoContexto(): number | null {
  return useSyncExternalStore(assinar, lerVendo, lerVendo);
}

/* ---------- a fonte em memória (testes e modo exemplo) ---------- */

const HISTORICO_PRONTO: StatusHistorico = {
  carregando: false,
  erro: null,
  tentarDeNovo: () => {},
  temMaisAntigas: false,
  carregarMaisAntigas: () => {},
  carregandoMaisAntigas: false,
};

function novaVersaoMemoria(
  atual: VersaoContexto | null,
  conteudo: Pick<VersaoContexto, "campos" | "itens">,
  origem: VersaoContexto["origem"],
  restauradaDe?: number,
): VersaoContexto {
  const id = estado.versoes.reduce((m, v) => Math.max(m, v.id), 0) + 1;
  const numero = estado.versoes.reduce((m, v) => Math.max(m, v.numero), 0) + 1;
  const v: VersaoContexto = {
    id,
    numero,
    origem,
    quem: "Você",
    criadoEm: new Date(Date.now()).toISOString(),
    resumo: "",
    campos: { ...conteudo.campos },
    itens: conteudo.itens.map((i) => ({ ...i })),
    anexos: semAnexos(),
    ...(restauradaDe !== undefined ? { restauradaDe } : {}),
  };
  return { ...v, resumo: resumoDaNova(v, atual) };
}

const fonteMemoria: FonteContexto = {
  modo: "memoria",
  get versoes() {
    return estado.versoes;
  },
  carregando: false,
  erro: null,
  tentarDeNovo: () => {},
  historico: HISTORICO_PRONTO,
  async gravar(base, mudancas) {
    const atual = estado.versoes.length ? versaoAtual(estado) : null;
    const b = base === null ? null : (versaoPorId(estado, base) ?? null);
    if (base !== null && !b) return { ok: false, erro: "nao_encontrado" };
    const j = juntarMudancas(atual, b, mudancas);
    if (!j.ok) return j.erro === "contexto_mudou" ? { ok: false, erro: j.erro, atual } : { ok: false, erro: j.erro };
    if (j.igual && atual) return { ok: true, id: atual.id, numero: atual.numero };
    const v = novaVersaoMemoria(atual, j.novo, "edicao");
    definir({ ...estado, versoes: [v, ...estado.versoes] });
    return { ok: true, id: v.id, numero: v.numero };
  },
  async restaurar(id) {
    const alvo = versaoPorId(estado, id);
    if (!alvo) return { ok: false, erro: "nao_encontrado" };
    const atual = versaoAtual(estado);
    if (atual.id === id) return { ok: true, id: atual.id, numero: atual.numero };
    const v = novaVersaoMemoria(atual, alvo, "restauracao", alvo.numero);
    definir({ ...estado, versoes: [v, ...estado.versoes] });
    return { ok: true, id: v.id, numero: v.numero };
  },
};

/* ---------- ajudantes ---------- */

const OK: ResultadoContexto = { ok: true };
const erro = (e: ErroContexto): { ok: false; erro: ErroContexto } => ({ ok: false, erro: e });

function semRascunho(rascunhos: EstadoContexto["rascunhos"], alvo: Alvo): EstadoContexto["rascunhos"] {
  const r = { ...rascunhos };
  delete r[alvo];
  return r;
}

/* ---------- as ações ---------- */

/** As ações para um papel, sobre uma fonte (`useContexto` usa esta, com o papel de `usePapel()`). */
export function acoesContexto(papel: Papel, fonte: () => FonteContexto = () => fonteMemoria): AcoesContexto {
  /** O estado da tela com as versões da fonte. */
  const composto = (): EstadoContexto => {
    const f = fonte();
    return f === fonteMemoria ? estado : { ...estado, versoes: f.versoes };
  };

  // toda ação que grava: só admin, e só na versão atual
  const barrar = (): ErroContexto | null => {
    if (papel !== "admin") return "sem_permissao";
    if (estado.vendo !== null) return "versao_antiga";
    return null;
  };

  /** Muda o rascunho; o 1º toque guarda a versão aberta (a base do `contexto_salvar`). */
  const comRascunho = (alvo: Alvo, mudar: (r: Rascunho) => Rascunho): void => {
    const antes = estado.rascunhos[alvo];
    const base = antes?.base ?? versaoAtual(composto()).id;
    const r = mudar({ ...(antes ?? {}), base });
    definir({ ...estado, rascunhos: { ...estado.rascunhos, [alvo]: r } });
  };

  /** O item novo já tem algo escrito e não salvo (pergunta, resposta ou o que chegou pela caixa)? */
  const novoOcupado = (): boolean => {
    const r = estado.rascunhos["livre-novo"];
    if (!r) return false;
    return !!(r.pergunta?.trim() || r.resposta?.trim() || r.texto?.trim() || r.extras?.some((x) => x.trim()));
  };

  const alvoExiste = (alvo: Alvo): boolean => dadosDoAlvo(versaoAtual(composto()), alvo) !== null;

  /** A atual já tem as 50 perguntas livres: nenhum caminho abre ou grava a 51ª (`limite_itens`). */
  const noTeto = (): boolean => noTetoDeItens(versaoAtual(composto()));

  /** A recusa do banco como resultado da tela; em `contexto_mudou`, o rascunho passa a partir da atual nova. */
  const recusa = (alvo: Alvo | null, r: Extract<RespostaGravacao, { ok: false }>): ResultadoContexto => {
    if (r.erro !== "contexto_mudou") return erro(r.erro);
    const nova = r.atual ?? null;
    if (alvo && nova && estado.rascunhos[alvo]) {
      const atualizado = { ...estado.rascunhos[alvo], base: nova.id };
      definir({ ...estado, rascunhos: { ...estado.rascunhos, [alvo]: atualizado } });
    }
    const textoNovo = alvo && nova ? textoDoAlvo(nova, alvo) : "";
    return textoNovo ? { ok: false, erro: "contexto_mudou", textoNovo } : erro("contexto_mudou");
  };

  const ensinarEm = (destino: ChaveCampo | "livre", texto: string): ResultadoContexto => {
    const b = barrar();
    if (b) return erro(b);
    const t = texto.trim();
    if (!t) return erro("vazio");
    // a frase vira a pergunta do item novo; a resposta fica para o admin escrever. Se já há uma
    // pergunta nova sem salvar, ela não é trocada (a resposta dela ficaria com a pergunta errada).
    if (destino === "livre") {
      if (noTeto()) return erro("limite_itens");
      if (novoOcupado()) return erro("ocupado");
      comRascunho("livre-novo", (r) => ({ ...r, pergunta: t }));
    } else comRascunho(destino, (r) => ({ ...r, extras: [...(r.extras ?? []), comPonto(t)] }));
    return OK;
  };

  return {
    editarTexto(alvo, texto) {
      const b = barrar();
      if (b) return erro(b);
      if (!alvoExiste(alvo)) return erro("nao_encontrado");
      if (ehChaveCampo(alvo)) comRascunho(alvo, (r) => ({ ...r, texto, extras: [] }));
      else comRascunho(alvo, (r) => ({ ...r, resposta: texto, extras: [] }));
      return OK;
    },

    mandar(alvo, texto) {
      const b = barrar();
      if (b) return erro(b);
      if (!alvoExiste(alvo)) return erro("nao_encontrado");
      const t = texto.trim();
      if (!t) return erro("vazio");
      comRascunho(alvo, (r) => ({ ...r, extras: [...(r.extras ?? []), comPonto(t)] }));
      return OK;
    },

    descartar(alvo) {
      const b = barrar();
      if (b) return erro(b);
      if (!estado.rascunhos[alvo]) return OK;
      definir({ ...estado, rascunhos: semRascunho(estado.rascunhos, alvo) });
      return OK;
    },

    async salvar(alvo) {
      const b = barrar();
      if (b) return erro(b);
      const c = composto();
      const r = estado.rascunhos[alvo];
      const atual = versaoAtual(c);
      const salvo = dadosDoAlvo(atual, alvo);
      if (!salvo) return erro("nao_encontrado");
      if (!r || !rascunhoMuda(c, alvo)) return erro("vazio");
      const depois = aplicarRascunho(salvo, r);
      // item livre: precisa de pergunta e de resposta
      if (!ehChaveCampo(alvo) && (!depois.pergunta || !depois.texto)) return erro("vazio");
      const mudancas = mudancasDoAlvo(atual, alvo, depois);
      if (passaDoTeto(mudancas)) return erro("limite_itens");
      if (passaDoLimite(mudancas)) return erro("limite_tamanho");
      const base = r.base ?? atual.id;
      const g = await fonte().gravar(base > 0 ? base : null, mudancas);
      if (!g.ok) return recusa(alvo, g);
      // o rascunho sai; se o admin mexeu nele enquanto gravava, fica, partindo da versão nova
      const agora = estado.rascunhos[alvo];
      if (agora === r) definir({ ...estado, rascunhos: semRascunho(estado.rascunhos, alvo) });
      else if (agora) definir({ ...estado, rascunhos: { ...estado.rascunhos, [alvo]: { ...agora, base: g.id } } });
      return { ok: true, versao: g.numero };
    },

    novoItem(pergunta) {
      const b = barrar();
      if (b) return erro(b);
      if (noTeto()) return erro("limite_itens");
      if (pergunta === undefined) {
        comRascunho("livre-novo", (r) => r);
        return OK;
      }
      // com uma pergunta pronta, não troca a de um item novo que ainda não foi salvo
      if (novoOcupado()) return erro("ocupado");
      comRascunho("livre-novo", (r) => ({ ...r, pergunta }));
      return OK;
    },

    editarItem(alvo, mudanca) {
      const b = barrar();
      if (b) return erro(b);
      if (!alvoExiste(alvo)) return erro("nao_encontrado");
      // no teto, o item novo não ganha texto (nem o rascunho que sobrou de antes dele)
      if (alvo === "livre-novo" && noTeto()) return erro("limite_itens");
      comRascunho(alvo, (r) => ({
        ...r,
        ...(mudanca.pergunta !== undefined ? { pergunta: mudanca.pergunta } : {}),
        ...(mudanca.resposta !== undefined ? { resposta: mudanca.resposta, extras: [] } : {}),
      }));
      return OK;
    },

    async removerItem(n) {
      const b = barrar();
      if (b) return erro(b);
      const atual = versaoAtual(composto());
      const item = atual.itens[n - 1];
      if (!Number.isInteger(n) || !item) return erro("nao_encontrado");
      const itens = atual.itens.filter((_, i) => i !== n - 1).map((i) => ({ pergunta: i.pergunta, resposta: i.resposta }));
      const g = await fonte().gravar(atual.id, { itens });
      if (!g.ok) return recusa(null, g);
      // os rascunhos dos itens de depois sobem uma posição; o do removido some
      const rascunhos: EstadoContexto["rascunhos"] = {};
      for (const [alvo, r] of Object.entries(estado.rascunhos) as [Alvo, Rascunho | undefined][]) {
        if (!r) continue;
        const k = numeroDoItem(alvo);
        if (k === null) rascunhos[alvo] = r;
        else if (k < n) rascunhos[alvo] = r;
        else if (k > n) rascunhos[`livre-${k - 1}`] = r;
      }
      definir({ ...estado, rascunhos });
      return { ok: true, versao: g.numero };
    },

    ensinar(texto) {
      const b = barrar();
      if (b) return erro(b);
      if (!texto.trim()) return erro("vazio");
      const alvo = rotear(texto);
      if (alvo !== null) {
        const r = ensinarEm(alvo, texto);
        if (!r.ok) return r;
      }
      return { ok: true, alvo };
    },

    ensinarEm,

    verVersao(id) {
      const c = composto();
      const v = versaoPorId(c, id);
      if (!v) return erro("nao_encontrado");
      const vendo = id === versaoAtual(c).id ? null : id;
      if (vendo !== estado.vendo) definir({ ...estado, vendo });
      return OK;
    },

    voltarParaAtual() {
      if (estado.vendo !== null) definir({ ...estado, vendo: null });
    },

    async restaurar(id) {
      // a única ação que grava vendo uma versão antiga: o "Restaurar versão N" fica na faixa dela
      if (papel !== "admin") return erro("sem_permissao");
      const c = composto();
      if (!versaoPorId(c, id)) return erro("nao_encontrado");
      if (id === versaoAtual(c).id) return erro("vazio");
      const g = await fonte().restaurar(id);
      if (!g.ok) return recusa(null, g);
      definir({ ...estado, vendo: null, rascunhos: {} });
      return { ok: true, versao: g.numero };
    },

    marcarEntrada() {
      if (!estado.jaEntrou) definir({ ...estado, jaEntrou: true });
    },
  };
}

/**
 * O estado do Contexto, as ações (com o papel de quem usa, `usePapel`) e a leitura (carregando, erro,
 * histórico). As versões vêm da fonte posta pela PonteContextoBanco ou, sem ela, da memória.
 */
export function useContexto(): { estado: EstadoContexto; acoes: AcoesContexto; leitura: FonteContexto } {
  const { papel } = usePapel();
  const ctx = useContext(FonteContextoCtx);
  const ui = useSyncExternalStore(assinar, ler, ler);
  const fonte = ctx ?? fonteMemoria;
  const fonteRef = useRef(fonte);
  fonteRef.current = fonte;
  const versoes = ctx ? ctx.versoes : null;
  const composto = useMemo(() => (versoes ? { ...ui, versoes } : ui), [ui, versoes]);
  const acoes = useMemo(() => acoesContexto(papel, () => fonteRef.current), [papel]);
  return { estado: composto, acoes, leitura: fonte };
}
