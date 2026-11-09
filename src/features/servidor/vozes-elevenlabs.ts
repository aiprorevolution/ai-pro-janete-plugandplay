// As vozes da conta da ElevenLabs (a voz da Janete em uso). Lógica pura: monta os pedidos e traduz
// as respostas para o contrato F2 da spec (docs/spec-voz-uso.md, seção 2). Quem lista e quem
// grava a voz escolhida (servidor da Configuração e do onboarding) só chama estas duas funções.
//
// Endpoints, os dois grátis e com o cabeçalho xi-api-key (sem Authorization):
// - GET /v2/voices?page_size=100&include_total_count=false, com &next_page_token=<o da página
//   anterior> enquanto vier has_more. Até MAX_PAGINAS_VOZES páginas, todas no mesmo prazo.
// - GET /v1/voices/{voice_id}: confere a voz escolhida; o nome gravado vem daqui, nunca do
//   navegador. Voz que não existe volta 404, ou 400/422 com detail.status voice_not_found.
// - 401, 403, 429, outros status, tempo e rede seguem a tabela do validarChaveElevenLabs
//   (falhaDaResposta e falhaDoErro, em chave-elevenlabs.ts).
// - O voice_id é conferido por VOZ_ID antes de entrar numa URL ou numa lista.
//
// A chave nunca aparece no resultado: o pedir apaga o eco dela no corpo antes de ler, e o
// blindar é a última barreira, também em cada voz.

import { falhaDaResposta, falhaDoErro, msgElevenLabs } from "./chave-elevenlabs";
import { abrirPrazo, blindar, ler, lerTexto, pedir, type OpcoesValidacao } from "./http";
import {
  MAX_NOME_VOZ,
  VOZ_ID,
  type ErroVozes,
  type VozDaConta,
  type VozEscolhida,
} from "./vozes-tipos";

export const ELEVENLABS_VOZES = "https://api.elevenlabs.io/v2/voices";
export const ELEVENLABS_VOZ = "https://api.elevenlabs.io/v1/voices"; // + "/" + encodeURIComponent(id)
export const MAX_PAGINAS_VOZES = 3;

export type FalhaVozes = { ok: false; erro: ErroVozes; mensagem: string };

const vozNaoEncontrada = (): FalhaVozes => ({
  ok: false,
  erro: "voz_nao_encontrada",
  mensagem: "A voz escolhida não existe mais na conta. Escolha outra voz.",
});

// Rótulos da ElevenLabs traduzidos para a tela. Um valor fora daqui vai como veio.
const GENEROS: Record<string, string> = {
  female: "Feminina",
  male: "Masculina",
  neutral: "Neutra",
};

const SOTAQUES: Record<string, string> = {
  brazilian: "brasileira",
  portuguese: "portuguesa",
  american: "americana",
  british: "britânica",
  australian: "australiana",
  irish: "irlandesa",
  indian: "indiana",
  spanish: "espanhola",
  mexican: "mexicana",
  argentine: "argentina",
  french: "francesa",
  italian: "italiana",
  german: "alemã",
};

/** Corta em n caracteres contando os pontos de código (o char_length do banco). */
function cortar(texto: string, n: number): string {
  const letras = Array.from(texto);
  return letras.length > n ? letras.slice(0, n).join("").trimEnd() : texto;
}

function traduzir(valor: string | undefined, tabela: Record<string, string>): string | null {
  const v = valor?.trim();
  if (!v) return null;
  return tabela[v.toLowerCase()] ?? v;
}

/** Só endereço https: a prévia toca no navegador e não pode vir por http. */
function urlSegura(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  try {
    return new URL(valor.trim()).protocol === "https:" ? valor.trim() : null;
  } catch {
    return null;
  }
}

function ehPortugues(lingua: string | undefined): boolean {
  return (lingua ?? "").trim().toLowerCase().startsWith("pt");
}

/** Lê uma voz do /v2/voices; null quando falta um id válido ou o nome. */
function lerVoz(item: unknown): VozDaConta | null {
  const id = lerTexto(item, "voice_id");
  if (!id || !VOZ_ID.test(id)) return null;
  const nomeBruto = lerTexto(item, "name")?.trim();
  if (!nomeBruto) return null;

  const partes = [
    traduzir(lerTexto(item, "labels", "gender"), GENEROS),
    traduzir(lerTexto(item, "labels", "accent"), SOTAQUES),
  ].filter((p): p is string => p !== null);

  const verificadas = ler(item, "verified_languages");
  const linguas = Array.isArray(verificadas) ? verificadas : [];
  const emPortugues = linguas.filter((l) => ehPortugues(lerTexto(l, "language")));
  const portugues = emPortugues.length > 0 || ehPortugues(lerTexto(item, "labels", "language"));

  // Prévia: a do pt-BR, depois outra em português, depois a geral; só https.
  const ptBR = emPortugues.filter((l) => (lerTexto(l, "locale") ?? "").toLowerCase() === "pt-br");
  const candidatas = [
    ...ptBR.map((l) => ler(l, "preview_url")),
    ...emPortugues.map((l) => ler(l, "preview_url")),
    ler(item, "preview_url"),
  ];
  let previa: string | null = null;
  for (const c of candidatas) {
    previa = urlSegura(c);
    if (previa) break;
  }

  return {
    id,
    nome: cortar(nomeBruto, MAX_NOME_VOZ),
    detalhe: partes.length > 0 ? partes.join(" · ") : null,
    portugues,
    previa,
  };
}

/** Português primeiro, depois o nome; o id desempata para a ordem não variar. */
function ordenar(a: VozDaConta, b: VozDaConta): number {
  if (a.portugues !== b.portugues) return a.portugues ? -1 : 1;
  return a.nome.localeCompare(b.nome, "pt-BR") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function urlDaPagina(token: string | null): string {
  const base = `${ELEVENLABS_VOZES}?page_size=100&include_total_count=false`;
  return token ? `${base}&next_page_token=${encodeURIComponent(token)}` : base;
}

/** As vozes da conta, em até MAX_PAGINAS_VOZES páginas. Uma página que falha derruba a lista. */
export async function listarVozesElevenLabs(
  chave: string,
  opcoes?: OpcoesValidacao,
): Promise<{ ok: true; vozes: VozDaConta[] } | FalhaVozes> {
  const limpa = chave.trim();
  if (!limpa) return msgElevenLabs.chaveVazia();
  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: { ok: true; vozes: VozDaConta[] } | FalhaVozes;
  try {
    const vozes: VozDaConta[] = [];
    const vistas = new Set<string>();
    let token: string | null = null;
    let falha: FalhaVozes | null = null;
    for (let pagina = 0; pagina < MAX_PAGINAS_VOZES; pagina += 1) {
      const r = await pedir(
        opcoes,
        prazo,
        urlDaPagina(token),
        { method: "GET", headers: { "xi-api-key": limpa } },
        [chave],
      );
      falha = falhaDaResposta(r);
      if (falha) break;
      const lista = ler(r.corpo, "voices");
      if (!Array.isArray(lista)) {
        falha = msgElevenLabs.fora();
        break;
      }
      for (const item of lista) {
        const voz = lerVoz(item);
        // a mesma voz em duas páginas entra uma vez só
        if (!voz || vistas.has(voz.id)) continue;
        vistas.add(voz.id);
        vozes.push(voz);
      }
      const proximo = lerTexto(r.corpo, "next_page_token")?.trim();
      if (ler(r.corpo, "has_more") !== true || !proximo) break;
      token = proximo;
    }
    resultado = falha ?? { ok: true, vozes: vozes.sort(ordenar).map((v) => blindar(v, [chave])) };
  } catch (falhou) {
    resultado = falhaDoErro(falhou);
  } finally {
    prazo.encerrar();
  }
  return resultado.ok ? resultado : blindar(resultado, [chave]);
}

/** Confere que a voz existe na conta e devolve o nome que a ElevenLabs dá a ela. */
export async function conferirVozElevenLabs(
  chave: string,
  vozId: string,
  opcoes?: OpcoesValidacao,
): Promise<{ ok: true; voz: VozEscolhida } | FalhaVozes> {
  const limpa = chave.trim();
  if (!limpa) return msgElevenLabs.chaveVazia();
  if (!VOZ_ID.test(vozId)) return vozNaoEncontrada();
  const prazo = abrirPrazo(opcoes?.prazoMs);
  let resultado: { ok: true; voz: VozEscolhida } | FalhaVozes;
  try {
    const r = await pedir(
      opcoes,
      prazo,
      `${ELEVENLABS_VOZ}/${encodeURIComponent(vozId)}`,
      { method: "GET", headers: { "xi-api-key": limpa } },
      [chave],
    );
    const status = (lerTexto(r.corpo, "detail", "status") ?? "").toLowerCase();
    if (r.status === 404 || ((r.status === 400 || r.status === 422) && status.includes("voice_not_found"))) {
      resultado = vozNaoEncontrada();
    } else {
      const falha = falhaDaResposta(r);
      if (falha) resultado = falha;
      else if (!lerTexto(r.corpo, "voice_id")) resultado = msgElevenLabs.fora();
      else {
        const nome = lerTexto(r.corpo, "name")?.trim();
        // o id é o pedido (já conferido por VOZ_ID); o nome é o da ElevenLabs
        const voz = blindar({ id: vozId, nome: nome ? cortar(nome, MAX_NOME_VOZ) : vozId }, [chave]);
        resultado = { ok: true, voz };
      }
    }
  } catch (falhou) {
    resultado = falhaDoErro(falhou);
  } finally {
    prazo.encerrar();
  }
  return resultado.ok ? resultado : blindar(resultado, [chave]);
}
