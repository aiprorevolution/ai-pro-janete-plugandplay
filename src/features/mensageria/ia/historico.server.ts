// Histórico que a Janete lê: as últimas 30 mensagens da conversa, sem as canceladas e sem as
// apagadas, em ordem de momento. Lead = user; Janete e equipe = assistant (equipe marcada com
// "[equipe]"). Raciocínio de rodadas antigas nunca entra: o histórico sai só das mensagens.
// O texto do lead passa por neutralizar (não abre bloco do sistema nem finge "[equipe]").
import type { ModelMessage } from "ai";

import { firebaseAdmin } from "@/integrations/firebase/client.server";
import type { Database } from "@/integrations/firebase/types";

import { baixarArquivo } from "../nucleo/midia.server";
import { neutralizar } from "./instrucoes";

type Mensagem = Database["public"]["Tables"]["mensagens"]["Row"];

export type MensagemHistorico = Partial<Pick<Mensagem, "rodada_id">> &
  Pick<
    Mensagem,
    | "id"
    | "direcao"
    | "origem"
    | "tipo"
    | "texto"
    | "transcricao"
    | "midia_caminho"
    | "midia_mime"
    | "midia_nome"
    | "midia_status"
  >;

export const LIMITE_HISTORICO = 30;
const COLUNAS =
  "id, direcao, origem, tipo, texto, transcricao, " +
  "midia_caminho, midia_mime, midia_nome, midia_status, rodada_id, momento";
/** Tipos de imagem que os três provedores aceitam em base64. */
const IMAGENS_ACEITAS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
/** Acima disso a imagem vira marcador (limite de imagem da Anthropic em base64). */
const MAX_BYTES_IMAGEM = 5 * 1024 * 1024;
/**
 * Imagens que vão inteiras ao provedor: as desta rodada e, sem elas, as 2 mais recentes do
 * lead. As outras entram como "[imagem] <legenda>": baixar todas a cada rodada pesaria na
 * memória do Worker (3 rodadas em paralelo) e no tempo.
 */
export const MAX_IMAGENS_ANTIGAS = 2;
/** Teto da soma dos bytes das imagens mandadas numa rodada. */
export const MAX_BYTES_IMAGENS_RODADA = 8 * 1024 * 1024;

type LinhaHistorico = MensagemHistorico & Pick<Mensagem, "momento">;

/** Momento da última entrada do lead que é desta rodada. null = a rodada não tem entrada. */
async function limiteDaRodada(conversaId: string, rodadaId: string): Promise<string | null> {
  const { data, error } = await firebaseAdmin
    .from("mensagens")
    .select("momento")
    .eq("conversa_id", conversaId)
    .eq("rodada_id", rodadaId)
    .eq("direcao", "entrada")
    .neq("status", "cancelada")
    .is("apagada_em", null)
    .order("momento", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("banco_historico");
  return (data as { momento?: string } | null)?.momento ?? null;
}

/**
 * Últimas mensagens da conversa. Com a rodada, as entradas do lead que chegaram depois da
 * última entrada desta rodada (sem rodada_id: vão para a rodada seguinte) ficam de fora, para
 * não serem respondidas duas vezes. O filtro roda no banco, antes do limite: uma rajada de
 * mensagens novas não encurta o histórico.
 */
export async function carregarHistorico(
  conversaId: string,
  rodadaId?: string,
): Promise<MensagemHistorico[]> {
  const limite = rodadaId ? await limiteDaRodada(conversaId, rodadaId) : null;
  // falhou: a bolha nunca chegou ao lead (a entrada nunca tem esse status)
  let consulta = firebaseAdmin
    .from("mensagens")
    .select(COLUNAS)
    .eq("conversa_id", conversaId)
    .not("status", "in", "(cancelada,falhou)")
    .is("apagada_em", null);
  if (rodadaId && limite) {
    // aspas: o momento tem ":" e "." e o id vem do banco
    consulta = consulta.or(
      `direcao.eq.saida,rodada_id.eq."${rodadaId}",momento.lte."${limite}"`,
    );
  }
  const { data, error } = await consulta
    .order("momento", { ascending: false })
    .order("criado_em", { ascending: false })
    .limit(LIMITE_HISTORICO);
  if (error) throw new Error("banco_historico");
  return ((data ?? []) as unknown as LinhaHistorico[]).slice().reverse();
}

type Parte = { type: "text"; text: string } | { type: "file"; data: Uint8Array; mediaType: string };

function textoDe(m: MensagemHistorico): string {
  return (m.texto ?? "").trim();
}

type Limpeza = (texto: string) => string;
const igual: Limpeza = (t) => t;

/** Nome de arquivo do lead dentro do marcador: sem colchetes nem quebra de linha. */
function nomeSeguro(nome: string): string {
  return neutralizar(nome.replace(/\s+/g, " "))
    .replace(/\[/g, "［")
    .replace(/\]/g, "］")
    .slice(0, 120);
}

/**
 * Texto que representa a mensagem (sem a imagem). Com `limpar`, o texto, a transcrição e o
 * nome do arquivo (o que veio do lead) passam por ela; os marcadores, não.
 */
export function marcadorDe(m: MensagemHistorico, limpar: Limpeza = igual): string {
  const texto = limpar(textoDe(m));
  const legenda = texto ? ` ${texto}` : "";
  switch (m.tipo) {
    case "texto":
      return texto;
    case "audio": {
      const t = limpar((m.transcricao ?? "").trim());
      return t ? `[áudio] ${t}` : "[áudio sem transcrição]";
    }
    case "imagem":
      return `[imagem]${legenda}`;
    case "documento": {
      const nome = (m.midia_nome ?? "").trim();
      const exibido = limpar === igual ? nome : nomeSeguro(nome);
      return `[documento: ${exibido || "sem nome"}]${legenda}`;
    }
    case "video":
      return `[vídeo]${legenda}`;
    case "figurinha":
      return "[figurinha]";
    default:
      return "[mensagem não suportada]";
  }
}

type Orcamento = { bytes: number };

function imagemCopiada(m: MensagemHistorico): boolean {
  return m.tipo === "imagem" && m.midia_status === "copiada" && Boolean(m.midia_caminho);
}

/** Ids das imagens que podem ir inteiras: as da rodada; sem elas, as 2 mais recentes. */
export function imagensParaMandar(mensagens: MensagemHistorico[], rodadaId?: string): Set<string> {
  const doLead = mensagens.filter((m) => m.direcao === "entrada" && imagemCopiada(m));
  const daRodada = rodadaId ? doLead.filter((m) => m.rodada_id === rodadaId) : [];
  const escolhidas = daRodada.length > 0 ? daRodada : doLead.slice(-MAX_IMAGENS_ANTIGAS);
  return new Set(escolhidas.map((m) => m.id));
}

async function partesDoLead(
  m: MensagemHistorico,
  mandar: Set<string>,
  orcamento: Orcamento,
): Promise<Parte[]> {
  if (imagemCopiada(m) && m.midia_caminho && mandar.has(m.id)) {
    try {
      const arquivo = await baixarArquivo(m.midia_caminho);
      const mime = (m.midia_mime || arquivo.mime || "").split(";")[0]?.trim().toLowerCase() ?? "";
      const tamanho = arquivo.bytes.byteLength;
      if (
        IMAGENS_ACEITAS.has(mime) &&
        tamanho <= MAX_BYTES_IMAGEM &&
        orcamento.bytes + tamanho <= MAX_BYTES_IMAGENS_RODADA
      ) {
        orcamento.bytes += tamanho;
        const partes: Parte[] = [{ type: "file", data: arquivo.bytes, mediaType: mime }];
        const legenda = neutralizar(textoDe(m));
        if (legenda) partes.push({ type: "text", text: legenda });
        return partes;
      }
    } catch {
      // sem a imagem, a Janete vê o marcador
    }
  }
  const texto = marcadorDe(m, neutralizar);
  return texto ? [{ type: "text", text: texto }] : [];
}

function textoDaEquipe(m: MensagemHistorico): string {
  // o áudio da Janete (a voz dela) entra como o texto falado, sem "[áudio]": o marcador descreve
  // o que o lead mandou (docs/spec-voz-uso.md, P6). O áudio da equipe continua com o marcador.
  if (m.origem === "janete" && m.tipo === "audio") return (m.transcricao ?? "").trim();
  const texto = marcadorDe(m);
  if (!texto) return "";
  return m.origem === "janete" ? texto : `[equipe] ${texto}`;
}

export type OpcoesHistorico = {
  /** Rodada atual: as imagens dela vão inteiras ao provedor; as outras, como marcador. */
  rodadaId?: string;
  /**
   * Linha "Agora:" e bloco <dados_do_contato>, que entram como 1ª parte da última mensagem do
   * lado do lead.
   */
  dadosContato?: string;
};

/**
 * Monta as mensagens do modelo. Mensagens seguidas do mesmo lado viram uma só (com várias
 * partes). A conversa sempre começa e termina com o lead, para nenhum provedor tratar a última
 * fala da Janete como começo de resposta. Os dados do contato vão no fim (e não nas instruções
 * nem no começo), para o começo do pedido ficar igual entre rodadas e aproveitar o cache.
 */
export async function montarHistorico(
  mensagens: MensagemHistorico[],
  opcoes: OpcoesHistorico = {},
): Promise<ModelMessage[]> {
  const blocos: { papel: "user" | "assistant"; partes: Parte[] }[] = [];
  const mandar = imagensParaMandar(mensagens, opcoes.rodadaId);
  const orcamento: Orcamento = { bytes: 0 };
  for (const m of mensagens) {
    const papel = m.direcao === "entrada" ? "user" : "assistant";
    const partes: Parte[] =
      papel === "user"
        ? await partesDoLead(m, mandar, orcamento)
        : (() => {
            const t = textoDaEquipe(m);
            return t ? [{ type: "text" as const, text: t }] : [];
          })();
    if (partes.length === 0) continue;
    const ultimo = blocos.at(-1);
    if (ultimo && ultimo.papel === papel) ultimo.partes.push(...partes);
    else blocos.push({ papel, partes });
  }

  if (blocos[0]?.papel !== "user") {
    blocos.unshift({ papel: "user", partes: [{ type: "text", text: "[início da conversa]" }] });
  }
  if (blocos.at(-1)?.papel !== "user") {
    blocos.push({ papel: "user", partes: [{ type: "text", text: "[sem mensagem nova do lead]" }] });
  }
  if (opcoes.dadosContato) {
    blocos.at(-1)?.partes.unshift({ type: "text", text: opcoes.dadosContato });
  }

  return blocos.map((b): ModelMessage => {
    if (b.papel === "user") return { role: "user", content: b.partes };
    const textos = b.partes.filter((p): p is { type: "text"; text: string } => p.type === "text");
    return { role: "assistant", content: textos };
  });
}
