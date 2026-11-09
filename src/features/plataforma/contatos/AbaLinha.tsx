import { useId, useMemo, useState, type ComponentType } from "react";
import {
  ArrowRightLeft,
  Columns3,
  MessageCircle,
  Paperclip,
  Settings,
  Smartphone,
  Undo2,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";

import type { Classes } from "@/components/aipro/cx";
import { iniciais } from "@/components/aipro/iniciais";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { nomeDoContato } from "../comum/LinhaConversa";
import { FUSO, dataCurta, diaLocal, horaCurta } from "../comum/tempo";
import { usePerfilContato } from "../dados/contatos";
import type { Contato } from "../exemplo";
import { acontecimentos } from "./dados";
import { EstadoDaAba, PontoEtapa } from "./pecas";
import type { Acontecimento, EstadoContatos, GrupoAcontecimento, PropsAba } from "./tipos";
import estilos from "./Abas.module.css";

// A aba "Linha do tempo" do perfil (task C3 da spec de Contatos): tudo o que aconteceu com o
// contato, do mais antigo ao mais novo, com os filtros do Contatos 4. Sem cartão colorido nem selo
// de etapa (decisão 5 do equipe): a cor fica só na bolinha da etapa e no ícone.

const s = estilos as Classes<
  | "abAba"
  | "abCab"
  | "abTitulo"
  | "abFiltros"
  | "abFiltro"
  | "abFrase"
  | "abVazioTexto"
  | "abEventos"
  | "abEvento"
  | "abTrilho"
  | "abIcone"
  | "abData"
  | "abCorpo"
  | "abEvTopo"
  | "abEvTitulo"
  | "abEvDesc"
  | "abEvPe"
  | "abEtapa"
  | "abQuem"
  | "abQuemNome"
  | "abSigla"
  | "abLink"
  | "abSr"
>;

/* ---------- peças que o Resumo também usa ---------- */

/** O ícone pequeno de cada tipo de acontecimento (decorativo: o título já diz o que foi). */
export const ICONE_ACONTECIMENTO: Readonly<Record<Acontecimento["tipo"], ComponentType<{ size?: number; "aria-hidden"?: boolean }>>> = {
  criado: UserPlus,
  primeira_mensagem: MessageCircle,
  etapa: Columns3,
  passou: ArrowRightLeft,
  assumiu: UserCheck,
  devolveu: Undo2,
  celular: Smartphone,
  voltou_para_fila: UserX,
  midia: Paperclip,
};

/** O primeiro nome do contato, para as frases ("A Janete ainda não escreveu um resumo de Juliana."). */
export function primeiroNomeDe(contato: Contato | undefined): string {
  if (!contato) return "este contato";
  return nomeDoContato(contato).trim().split(/\s+/)[0] || "este contato";
}

/**
 * Quem fez: o símbolo da Janete, as iniciais da pessoa (membro ou lead), o ícone do celular ou da
 * engrenagem ("Sistema"). O nome fica sempre numa linha, com reticências.
 */
export function QuemFez({ quem }: { quem: Acontecimento["quem"] }) {
  let marca;
  switch (quem.tipo) {
    case "janete":
      marca = <JaneteSimbolo tamanho={16} decorativo />;
      break;
    case "sistema":
      marca = <Settings size={14} aria-hidden />;
      break;
    case "celular":
      marca = <Smartphone size={14} aria-hidden />;
      break;
    default:
      marca = (
        <span className={s.abSigla} aria-hidden="true">
          {iniciais(quem.nome)}
        </span>
      );
  }
  return (
    <span className={s.abQuem}>
      {marca}
      <span className={s.abQuemNome}>{quem.nome}</span>
    </span>
  );
}

/* ---------- a aba ---------- */

type Filtro = "tudo" | GrupoAcontecimento;

const FILTROS: readonly { id: Filtro; rotulo: string }[] = [
  { id: "tudo", rotulo: "Tudo" },
  { id: "etapas", rotulo: "Etapas" },
  { id: "atendimento", rotulo: "Atendimento" },
  { id: "mensagens", rotulo: "Mensagens e mídias" },
];

const DIA_MES = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "numeric", month: "long" });

/** "14 de outubro" (com o ano, "14 de outubro de 2025", quando não é o ano de agora). */
function desdeQuando(iso: string, agora: number): string {
  const dia = diaLocal(iso);
  if (!dia) return "";
  const t = Date.parse(iso);
  const texto = DIA_MES.format(t);
  return dia.slice(0, 4) === diaLocal(agora).slice(0, 4) ? texto : `${texto} de ${dia.slice(0, 4)}`;
}

/** A data à esquerda do acontecimento: "14/10" (com o ano se não for o de agora). */
function dataDoEvento(iso: string, agora: number): string {
  return dataCurta(iso, diaLocal(iso).slice(0, 4) !== diaLocal(agora).slice(0, 4));
}

export function AbaLinha({ contatoId, agora, verNaConversa }: PropsAba) {
  const perfil = usePerfilContato(contatoId);
  const estado = perfil.dados;
  const contato = estado?.contatos.find((c) => c.id === contatoId);
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const idTitulo = useId();

  const todos = useMemo(() => (estado ? acontecimentos(estado, contatoId) : []), [estado, contatoId]);
  if (!estado) return <EstadoDaAba leitura={perfil} />;
  const lista = filtro === "tudo" ? todos : todos.filter((a) => a.grupo === filtro);
  const nome = primeiroNomeDe(contato);
  const primeiro = lista[0];

  return (
    <section className={s.abAba} aria-labelledby={idTitulo}>
      <div className={s.abCab}>
        <h2 id={idTitulo} className={s.abTitulo}>
          Linha do tempo
        </h2>
        <div className={s.abFiltros} role="group" aria-label="Mostrar na linha do tempo">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={s.abFiltro}
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      {primeiro ? (
        <>
          <p className={s.abFrase} aria-live="polite">
            {`${lista.length} ${lista.length === 1 ? "acontecimento" : "acontecimentos"} desde ${desdeQuando(primeiro.em, agora)}, do mais antigo para o mais novo.`}
          </p>
          <ol className={s.abEventos}>
            {lista.map((a) => (
              <ItemLinha key={a.id} item={a} agora={agora} estado={estado} verNaConversa={verNaConversa} />
            ))}
          </ol>
        </>
      ) : (
        <p className={s.abVazioTexto} aria-live="polite">
          {filtro === "tudo"
            ? `Ainda não há nada na linha do tempo de ${nome}.`
            : `Nada deste tipo na linha do tempo de ${nome}.`}
        </p>
      )}
    </section>
  );
}

function ItemLinha({
  item,
  agora,
  estado,
  verNaConversa,
}: {
  item: Acontecimento;
  agora: number;
  estado: EstadoContatos;
  verNaConversa(mensagemId: string): void;
}) {
  const Icone = ICONE_ACONTECIMENTO[item.tipo];
  const idTitulo = useId();
  // No contato criado e na troca de etapa, o título já diz a etapa: o rodapé não a repete.
  const etapaNoTitulo = item.tipo === "criado" || item.tipo === "etapa";
  const etapa = item.etapaId && !etapaNoTitulo ? estado.etapas.find((e) => e.id === item.etapaId) : undefined;
  const mensagemId = item.mensagemId;
  return (
    <li className={s.abEvento} data-tipo={item.tipo}>
      <div className={s.abTrilho}>
        <span className={s.abIcone}>
          <Icone size={16} aria-hidden />
        </span>
        <time className={s.abData} dateTime={item.em}>
          <span>{dataDoEvento(item.em, agora)}</span>
          <span>{horaCurta(item.em)}</span>
        </time>
      </div>
      <div className={s.abCorpo}>
        <div className={s.abEvTopo}>
          <h3 id={idTitulo} className={s.abEvTitulo}>
            {item.titulo}
          </h3>
          <QuemFez quem={item.quem} />
        </div>
        {item.descricao ? <p className={s.abEvDesc}>{item.descricao}</p> : null}
        {etapa || mensagemId ? (
          <div className={s.abEvPe}>
            {etapa ? (
              <span className={s.abEtapa}>
                <span className={s.abSr}>Etapa: </span>
                <PontoEtapa etapa={etapa} />
              </span>
            ) : (
              <span />
            )}
            {mensagemId ? (
              <button
                type="button"
                className={s.abLink}
                aria-describedby={idTitulo}
                onClick={() => verNaConversa(mensagemId)}
              >
                Ver na conversa
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
