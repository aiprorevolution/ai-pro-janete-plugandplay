// Um cliente do Firebase falso, só para os testes da camada de dados (src/test/d1-*): grava cada
// consulta, rpc, upload e canal, e responde o que o teste mandar. Nada vai à rede nem ao banco.
import type { ClienteFirebase } from "../colunas";

export type Resposta = { data: unknown; error: unknown; count?: number | null };

export interface Consulta {
  tabela: string;
  /** select, insert, update, delete (o primeiro verbo chamado). */
  op: string;
  /** O argumento do verbo (as colunas do select, a linha do insert, os campos do update). */
  valor: unknown;
  /** Os filtros e modificadores, na ordem: ["eq", "id", "x"], ["range", 0, 999]... */
  passos: unknown[][];
  /** Pediu `.select()` depois do update/insert. */
  comSelect: string | null;
  unica: boolean;
}

export interface CanalFalso {
  nome: string;
  avisos: { filtro: Record<string, unknown>; aoMudar: (aviso: unknown) => void }[];
  aoStatus: ((status: string) => void) | null;
  removido: boolean;
  /** Dispara um aviso do banco para quem escuta aquela tabela. */
  emitir(aviso: { table: string; eventType: string; old?: unknown; new?: unknown }): void;
  status(s: string): void;
}

export interface OpcoesFalso {
  consulta?: (c: Consulta) => Resposta | undefined;
  rpc?: (nome: string, args: Record<string, unknown>) => Resposta | Promise<Resposta> | undefined;
  upload?: (caminho: string, arquivo: unknown, opcoes: unknown) => Resposta | Promise<Resposta> | undefined;
  remove?: (caminhos: string[]) => Resposta | undefined;
  assinar?: (caminhos: string[], validade: number) => Resposta | undefined;
  /** O insert responde por aqui (padrão: sucesso). Pode demorar (Promise) para testar a ordem. */
  insert?: (c: Consulta) => Resposta | Promise<Resposta> | undefined;
  uid?: string | null;
}

export function criarClienteFalso(opcoes: OpcoesFalso = {}) {
  const consultas: Consulta[] = [];
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  const uploads: { bucket: string; caminho: string; arquivo: unknown; opcoes: unknown }[] = [];
  const removidos: string[][] = [];
  const assinaturas: { caminhos: string[]; validade: number }[] = [];
  const canais: CanalFalso[] = [];

  const ok = (data: unknown = null): Resposta => ({ data, error: null });

  function construtor(tabela: string) {
    const c: Consulta = { tabela, op: "", valor: undefined, passos: [], comSelect: null, unica: false };
    consultas.push(c);
    const verbo = (op: string) => (valor?: unknown) => {
      if (!c.op) {
        c.op = op;
        c.valor = valor;
      } else if (op === "select") {
        c.comSelect = typeof valor === "string" ? valor : "*";
      }
      return q;
    };
    const passo =
      (nome: string) =>
      (...args: unknown[]) => {
        c.passos.push([nome, ...args]);
        return q;
      };
    const responder = async (): Promise<Resposta> => {
      if (c.op === "insert" && opcoes.insert) return (await opcoes.insert(c)) ?? ok();
      return opcoes.consulta?.(c) ?? ok(c.unica ? null : []);
    };
    const q: Record<string, unknown> = {
      select: verbo("select"),
      insert: verbo("insert"),
      update: verbo("update"),
      delete: verbo("delete"),
      eq: passo("eq"),
      neq: passo("neq"),
      is: passo("is"),
      not: passo("not"),
      in: passo("in"),
      order: passo("order"),
      limit: passo("limit"),
      range: passo("range"),
      maybeSingle: () => {
        c.unica = true;
        return q;
      },
      single: () => {
        c.unica = true;
        return q;
      },
      then: (res: (r: Resposta) => unknown, rej?: (e: unknown) => unknown) => responder().then(res, rej),
    };
    return q;
  }

  const cliente = {
    from: (tabela: string) => construtor(tabela),
    rpc: (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      return Promise.resolve(opcoes.rpc?.(nome, args)).then((r) => r ?? ok());
    },
    auth: {
      getSession: async () => ({
        data: { session: opcoes.uid === null ? null : { user: { id: opcoes.uid ?? "u-1" } } },
        error: null,
      }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: (caminho: string, arquivo: unknown, op: unknown) => {
          uploads.push({ bucket, caminho, arquivo, opcoes: op });
          return Promise.resolve(opcoes.upload?.(caminho, arquivo, op)).then((r) => r ?? ok({ path: caminho }));
        },
        remove: (caminhos: string[]) => {
          removidos.push(caminhos);
          return Promise.resolve(opcoes.remove?.(caminhos) ?? ok([]));
        },
        createSignedUrls: (caminhos: string[], validade: number) => {
          assinaturas.push({ caminhos: [...caminhos], validade });
          return Promise.resolve(
            opcoes.assinar?.(caminhos, validade) ??
              ok(caminhos.map((p) => ({ path: p, signedUrl: `https://falso/${p}?v=${validade}`, error: null }))),
          );
        },
      }),
    },
    channel: (nome: string) => {
      const canal: CanalFalso & { on: unknown; subscribe: unknown } = {
        nome,
        avisos: [],
        aoStatus: null,
        removido: false,
        emitir(aviso) {
          for (const a of canal.avisos) if (a.filtro["table"] === aviso.table) a.aoMudar(aviso);
        },
        status(s) {
          canal.aoStatus?.(s);
        },
        on: (_tipo: string, filtro: Record<string, unknown>, aoMudar: (aviso: unknown) => void) => {
          canal.avisos.push({ filtro, aoMudar });
          return canal;
        },
        subscribe: (aoStatus: (s: string) => void) => {
          canal.aoStatus = aoStatus;
          return canal;
        },
      };
      canais.push(canal);
      return canal;
    },
    removeChannel: async (canal: CanalFalso) => {
      canal.removido = true;
      return "ok";
    },
  };

  return {
    cliente: cliente as unknown as ClienteFirebase,
    consultas,
    rpcs,
    uploads,
    removidos,
    assinaturas,
    canais,
  };
}
