import { useMemo } from "react";
import { ArrowRight, FileText, Film, Sticker } from "lucide-react";

import { type Classes } from "@/components/aipro/cx";

import {
  CenaFoto,
  CenaVideo,
  Onda,
  extensaoArquivo,
  linkDoLote,
  mmss,
  textoEstadoMidia,
  type EstadoLink,
} from "../comum/Bolha";
import { nomeDoContato } from "../comum/LinhaConversa";
import { diaLocal, horaCurta } from "../comum/tempo";
import { usePerfilContato } from "../dados/contatos";
import { situacaoDaMidia, useUrlMidia, type SituacaoMidia, type UrlsMidia } from "../dados/midia";
import { useModoDados } from "../dados/ProvedorDados";
import type { TipoMensagem } from "../exemplo";
import { midiasDoContato } from "./dados";
import { EstadoDaAba } from "./pecas";
import type { MidiaDoContato, PropsAba } from "./tipos";
import estilos from "./Ficha.module.css";

const s = estilos as Classes<
  | "fiAba"
  | "fiCab"
  | "fiTitulo"
  | "fiMeta"
  | "fiGrade"
  | "fiMidia"
  | "fiPrevia"
  | "fiCena"
  | "fiFoto"
  | "fiEstado"
  | "fiEstadoBotao"
  | "fiAudio"
  | "fiTempo"
  | "fiTempoVideo"
  | "fiDoc"
  | "fiDocExt"
  | "fiFigurinha"
  | "fiMidiaNome"
  | "fiVer"
  | "fiTransc"
  | "fiVazio"
  | "fiSr"
>;

// A aba Mídias do perfil (task C4 de docs/spec-contatos.md): as mídias trocadas com o contato, da mais
// antiga para a mais nova, em cartões brancos (decisão 5 do equipe: nada de fundo colorido). No
// exemplo, a prévia usa as mesmas cenas e a mesma onda do Chat (comum/Bolha); no banco, a imagem é a
// miniatura de verdade (link assinado, em lote) e a mídia que não está no bucket diz a situação. O
// arquivo abre pelo "Ver na conversa", na bolha. No banco, a lista vem inteira (dados/contatos.ts),
// não só das mensagens já carregadas.

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "14 out, 09:15", no dia de São Paulo (comum/tempo). "" se não for data. */
function dataMidia(iso: string): string {
  const dia = diaLocal(iso);
  if (!dia) return "";
  const [, mes, d] = dia.split("-");
  return `${Number(d)} ${MESES_CURTOS[Number(mes) - 1]}, ${horaCurta(iso)}`;
}

const primeiroNomeDe = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

/** O tipo da mídia por extenso, para a linha "Tipo · autor · data". */
const ROTULO_TIPO: Partial<Record<TipoMensagem, string>> = {
  audio: "Áudio",
  imagem: "Imagem",
  video: "Vídeo",
  documento: "Documento",
  figurinha: "Figurinha",
};

const SEM_LINKS: UrlsMidia = { urls: {}, carregando: false, buscando: false, erro: null, tentarDeNovo: () => {} };

/** No exemplo não há arquivo: nenhum link é pedido. */
function useSemLinks(_caminhos: readonly string[]): UrlsMidia {
  return SEM_LINKS;
}

/** Os tipos com miniatura de verdade no banco (a imagem do próprio arquivo). */
const COM_MINIATURA: readonly TipoMensagem[] = ["imagem", "figurinha"];

/** A situação da mídia no banco (o exemplo não tem arquivo: "sem", e a prévia é o desenho). */
function situacaoNoBanco(midia: MidiaDoContato): SituacaoMidia {
  return situacaoDaMidia({ midia_caminho: midia.caminho, midia_status: midia.status });
}

/**
 * A prévia no banco: a miniatura pelo link assinado (imagem e figurinha), um ícone neutro (vídeo) ou,
 * quando o arquivo não está no bucket, a frase da situação (pendente, falhou, expirada), visível. O
 * desenho de exemplo (o prédio, a cena do vídeo) fica só no modo exemplo: no banco, pareceria a foto
 * do lead.
 */
function PreviaBanco({ midia, link }: { midia: MidiaDoContato; link: EstadoLink }) {
  const situacao = situacaoNoBanco(midia);
  if (situacao !== "pronta") {
    const k = situacao === "sem" ? "indisponivel" : situacao;
    return (
      <div className={s.fiPrevia} data-tipo={midia.tipo} data-situacao={k}>
        <p className={s.fiEstado}>{textoEstadoMidia(k, midia.tipo)}</p>
      </div>
    );
  }
  if (COM_MINIATURA.includes(midia.tipo)) {
    if (link && "url" in link) {
      return (
        <div className={s.fiPrevia} data-tipo={midia.tipo}>
          <img className={s.fiFoto} src={link.url} alt="" loading="lazy" />
        </div>
      );
    }
    if (link && "erro" in link) {
      return (
        <div className={s.fiPrevia} data-tipo={midia.tipo} data-situacao="erro_link">
          <div className={s.fiEstado}>
            <span>{textoEstadoMidia("erro_link", midia.tipo)}</span>
            <button type="button" className={s.fiEstadoBotao} onClick={link.tentarDeNovo}>
              Carregar de novo
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className={s.fiPrevia} data-tipo={midia.tipo} data-situacao="carregando">
        <p className={s.fiEstado}>{textoEstadoMidia("carregando", midia.tipo)}</p>
      </div>
    );
  }
  if (midia.tipo === "video") {
    return (
      <div className={s.fiPrevia} data-tipo="video" aria-hidden="true">
        <span className={s.fiFigurinha}>
          <Film size={28} strokeWidth={1.5} />
        </span>
        {midia.duracaoS != null ? <span className={s.fiTempoVideo}>{mmss(midia.duracaoS)}</span> : null}
      </div>
    );
  }
  // Áudio e documento: a onda e o ícone já não fingem ser o arquivo.
  return <Previa midia={midia} />;
}

/** A prévia de cada forma de mídia. Tudo decorativo: o nome e o tipo já estão no texto do cartão. */
function Previa({ midia }: { midia: MidiaDoContato }) {
  switch (midia.tipo) {
    case "audio":
      return (
        <div className={s.fiPrevia} data-tipo="audio" aria-hidden="true">
          <span className={s.fiAudio}>
            <Onda progresso={0} />
          </span>
          {midia.duracaoS != null ? <span className={s.fiTempo}>{mmss(midia.duracaoS)}</span> : null}
        </div>
      );
    case "imagem":
      return (
        <div className={s.fiPrevia} data-tipo="imagem" aria-hidden="true">
          <CenaFoto className={s.fiCena} />
        </div>
      );
    case "video":
      return (
        <div className={s.fiPrevia} data-tipo="video" aria-hidden="true">
          <CenaVideo className={s.fiCena} />
          {midia.duracaoS != null ? <span className={s.fiTempoVideo}>{mmss(midia.duracaoS)}</span> : null}
        </div>
      );
    case "figurinha":
      return (
        <div className={s.fiPrevia} data-tipo="figurinha" aria-hidden="true">
          <span className={s.fiFigurinha}>
            <Sticker size={28} strokeWidth={1.5} />
          </span>
        </div>
      );
    default:
      return (
        <div className={s.fiPrevia} data-tipo="documento" aria-hidden="true">
          <span className={s.fiDoc}>
            <FileText size={24} strokeWidth={1.75} />
            <span className={s.fiDocExt}>{extensaoArquivo(midia.nome) || "ARQ"}</span>
          </span>
        </div>
      );
  }
}

export function AbaMidias({ contatoId, verNaConversa }: PropsAba) {
  const perfil = usePerfilContato(contatoId);
  const estado = perfil.dados;
  const banco = useModoDados() === "banco";
  const midias = useMemo(() => (estado ? midiasDoContato(estado, contatoId) : []), [estado, contatoId]);
  // As mídias que a Janete mandou, pela origem da mensagem (não pelo nome do autor: um lead pode se
  // chamar "Janete"). O áudio dela leva "Texto falado: "; o dos outros, "Transcrição: ".
  const daJanete = useMemo(() => {
    const ids = new Set(midias.map((m) => m.mensagemId));
    return new Set((estado?.mensagens ?? []).filter((m) => m.origem === "janete" && ids.has(m.id)).map((m) => m.id));
  }, [estado, midias]);
  // No banco, as miniaturas (imagem e figurinha prontas) pedem o link assinado de uma vez, em lote.
  const caminhos = useMemo(
    () =>
      banco
        ? midias.filter((m) => COM_MINIATURA.includes(m.tipo) && situacaoNoBanco(m) === "pronta" && m.caminho).map((m) => m.caminho!)
        : [],
    [banco, midias],
  );
  // O modo não muda com a aba montada (vem do ProvedorDados), então o hook escolhido é sempre o mesmo;
  // o exemplo (os testes) não tem arquivo nem QueryClient.
  const usarLinks = banco ? useUrlMidia : useSemLinks;
  const links = usarLinks(caminhos);

  if (!estado) return <EstadoDaAba leitura={perfil} />;
  const contato = estado.contatos.find((c) => c.id === contatoId);
  if (!contato) return null;

  const primeiro = primeiroNomeDe(nomeDoContato(contato));

  return (
    <section className={s.fiAba} aria-labelledby={`midias-${contatoId}`}>
      <div className={s.fiCab}>
        <h2 id={`midias-${contatoId}`} className={s.fiTitulo}>
          Mídias trocadas
        </h2>
        {midias.length ? (
          <p className={s.fiMeta}>
            {midias.length === 1 ? "1 mídia" : `${midias.length} mídias`}, da mais antiga para a mais nova
          </p>
        ) : null}
      </div>

      {midias.length === 0 ? (
        <p className={s.fiVazio}>Nenhuma mídia trocada com {primeiro}.</p>
      ) : (
        <ul className={s.fiGrade}>
          {midias.map((m) => {
            const tipo = ROTULO_TIPO[m.tipo] ?? "Arquivo";
            return (
              <li key={m.mensagemId} className={s.fiMidia} data-tipo={m.tipo}>
                {banco ? (
                  <PreviaBanco midia={m} link={m.caminho ? linkDoLote(links, m.caminho) : null} />
                ) : (
                  <Previa midia={m} />
                )}
                <b className={s.fiMidiaNome} title={m.nome}>
                  {m.nome}
                </b>
                <span className={s.fiMeta}>{[tipo, m.autor, dataMidia(m.em)].filter(Boolean).join(" · ")}</span>
                {m.tipo === "audio" && m.transcricao?.trim() ? (
                  <p className={s.fiTransc}>
                    <span className={s.fiSr}>{daJanete.has(m.mensagemId) ? "Texto falado: " : "Transcrição: "}</span>
                    {m.transcricao.trim()}
                  </p>
                ) : null}
                <button type="button" className={s.fiVer} onClick={() => verNaConversa(m.mensagemId)}>
                  Ver na conversa
                  <span className={s.fiSr}>: {m.nome}</span>
                  <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
