// A lista de modelos como a tela do cérebro mostra (rodada 2, item 2b). A lista vem do provedor
// (listarModelos); a curada (src/features/ia/modelos.ts) só entra como reserva quando o OpenRouter
// não responde, e para o nome do modelo quando a lista ainda não veio (voltou já validada).

import { acharModelo, modelosDo } from "@/features/ia/modelos";
import type { ProvedorIA } from "@/features/servidor/chave-ia";
import type { ModeloListado } from "@/features/servidor/listar-modelos";

/** Uma opção da lista: um modelo do provedor, ou o id digitado na busca do OpenRouter. */
export interface OpcaoModelo {
  id: string;
  nome: string;
  /** a linha de baixo: o perfil (lista curada), o id (OpenRouter) ou "Digitado por você" */
  detalhe: string;
  /** o detalhe é um id: vai em mono */
  detalheId: boolean;
  /** "US$ 0,10 / 0,50", ou vazio quando o provedor não informa e o modelo não está na curada */
  preco: string;
  recomendado: boolean;
  digitado: boolean;
}

/** Quantos modelos aparecem de início, e quantos a mais a cada "Mostrar mais". */
export const LIMITE_INICIAL = 12;
export const LIMITE_PASSO = 24;

/** Número no formato brasileiro: "2", "0,10", "0,075" (o que o provedor informou, sem arredondar além de 6 casas). */
export function numeroBr(valor: number): string {
  if (Number.isInteger(valor)) return String(valor);
  let texto = valor.toFixed(6).replace(/0+$/, "");
  const [inteiro, fracao = ""] = texto.split(".");
  texto = `${inteiro},${fracao.padEnd(2, "0")}`;
  return texto;
}

/** Preço por 1M de tokens, entrada / saída. Vazio quando falta um dos dois. */
export function precoDe(m: Pick<ModeloListado, "precoEntrada" | "precoSaida">): string {
  if (typeof m.precoEntrada !== "number" || typeof m.precoSaida !== "number") return "";
  if (!Number.isFinite(m.precoEntrada) || !Number.isFinite(m.precoSaida)) return "";
  return `US$ ${numeroBr(m.precoEntrada)} / ${numeroBr(m.precoSaida)}`;
}

/** A lista curada no formato da listarModelos (reserva do OpenRouter fora do ar). */
export function listaDeReserva(provedor: ProvedorIA): ModeloListado[] {
  return modelosDo(provedor).map((m) => ({
    id: m.id,
    nome: m.nome,
    ...(provedor === "openrouter" ? { fabricante: m.perfil } : { perfil: m.perfil }),
    precoEntrada: m.precoEntrada,
    precoSaida: m.precoSaida,
    recomendado: m.recomendado,
  }));
}

/** Recomendado primeiro, depois os da lista curada (com perfil), depois o resto na ordem do provedor. */
export function ordenar(modelos: readonly ModeloListado[]): ModeloListado[] {
  const peso = (m: ModeloListado) => (m.recomendado ? 0 : m.perfil ? 1 : 2);
  return modelos
    .map((m, i) => ({ m, i }))
    .sort((a, b) => peso(a.m) - peso(b.m) || a.i - b.i)
    .map(({ m }) => m);
}

/** O modelo que a tela marca quando a lista chega: o atual, se está nela; senão o recomendado. */
export function modeloInicial(modelos: readonly ModeloListado[], atual: string | null, aceitaDigitado: boolean): string | null {
  if (atual && (aceitaDigitado || modelos.some((m) => m.id === atual))) return atual;
  return modelos.find((m) => m.recomendado)?.id ?? null;
}

function opcaoDe(m: ModeloListado, busca: boolean): OpcaoModelo {
  const temNome = !!m.nome && m.nome !== m.id;
  let detalhe: string;
  let detalheId = false;
  if (busca) {
    // OpenRouter: o nome do fabricante já vem no nome; embaixo vai o id, que é o que se digita
    detalhe = temNome ? m.id : (m.fabricante ?? "");
    detalheId = temNome;
  } else if (m.perfil) {
    detalhe = m.perfil;
  } else {
    detalhe = temNome ? m.id : "";
    detalheId = temNome;
  }
  return {
    id: m.id,
    nome: m.nome || m.id,
    detalhe,
    detalheId,
    preco: precoDe(m),
    recomendado: m.recomendado,
    digitado: false,
  };
}

/**
 * As opções da lista, já filtradas pela busca (OpenRouter: id, nome e fabricante). Na busca, um id
 * completo (fabricante/modelo) que não está na lista vira opção, e o modelo já escolhido que não
 * está na lista também continua aparecendo.
 */
export function opcoesDe(
  modelos: readonly ModeloListado[],
  { busca, termo, atual }: { busca: boolean; termo: string; atual: string | null },
): OpcaoModelo[] {
  const t = termo.trim();
  const filtro = busca ? t.toLowerCase() : "";
  const lista = ordenar(modelos)
    .filter(
      (m) =>
        !filtro ||
        m.id.toLowerCase().includes(filtro) ||
        m.nome.toLowerCase().includes(filtro) ||
        (m.fabricante ?? "").toLowerCase().includes(filtro),
    )
    .map((m) => opcaoDe(m, busca));
  if (!busca) return lista;
  const extra = t.includes("/") ? t : atual && !modelos.some((m) => m.id === atual) ? atual : null;
  if (extra && !lista.some((o) => o.id === extra)) {
    lista.push({ id: extra, nome: extra, detalhe: "Digitado por você", detalheId: false, preco: "", recomendado: false, digitado: true });
  }
  return lista;
}

/** As primeiras `limite` opções; o modelo escolhido aparece sempre, mesmo depois do limite. */
export function visiveisDe(opcoes: readonly OpcaoModelo[], limite: number, atual: string | null): OpcaoModelo[] {
  const primeiras = opcoes.slice(0, limite);
  if (atual && !primeiras.some((o) => o.id === atual)) {
    const escolhida = opcoes.find((o) => o.id === atual);
    if (escolhida) primeiras.push(escolhida);
  }
  return primeiras;
}

/** Sem o "Fabricante: " do começo, como o OpenRouter nomeia ("Anthropic: Claude Haiku 5.5"). */
export function semFabricante(nome: string): string {
  return nome.replace(/^[^:/]{1,40}:\s+/, "");
}

/** O nome do modelo para a tela: o da lista do provedor, senão o da curada, senão o id. */
export function nomeDoModelo(provedor: ProvedorIA, id: string, modelos: readonly ModeloListado[] = []): string {
  const daLista = modelos.find((m) => m.id === id);
  if (daLista?.nome) return daLista.nome;
  return acharModelo(provedor, id)?.nome ?? id;
}
