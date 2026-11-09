import { CheckCircle2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type Classes } from "@/components/aipro/cx";

import { idTituloArea } from "../AreaVazia";
import { ehUuid, useAbrirPorId } from "../dados/abrirPorId";
import { useBuscarContato } from "../dados/contatos";
import { useContato } from "../dados/conversa";
import { useModoDados } from "../dados/ProvedorDados";
import { FILTROS_INICIAIS } from "./dados";
import { idLinhaContato, idTituloPerfil } from "./ids";
import { PerfilContato } from "./Perfil";
import { acharRolador } from "./rolagem";
import { TabelaContatos } from "./Tabela";
import type { FiltrosTabela } from "./tipos";
import estilos from "./TelaContatos.module.css";

// A tela de Contatos (docs/spec-contatos.md, "Premissas", Endereço): o endereço escolhe o que aparece.
// Sem `?contato=` (ou com um id que não existe), a tabela; com um contato válido, o perfil dele, que
// ocupa a área inteira (decisão 1 do equipe). A tela guarda o que precisa sobreviver à troca: os filtros
// da tabela, a rolagem e o contato aberto (para o foco voltar à linha dele) e o aviso curto.

const s = estilos as Classes<"tcoRaiz" | "tcoAviso" | "tcoAvisoTexto" | "tcoAvisoFechar" | "tcoSr">;

// Os ids de foco moram em ./ids (a tabela e o perfil também usam); reexportados aqui para quem já
// importava da tela.
export { idLinhaContato, idTituloPerfil };

/** O `validateSearch` da rota: só um texto não vazio de até 100 caracteres vale como `contato`. */
export interface BuscaContatos {
  contato?: string | undefined;
}

export function validarBuscaContatos(busca: Record<string, unknown>): BuscaContatos {
  const bruto = busca["contato"];
  const id = typeof bruto === "string" ? bruto.trim() : "";
  // O `contato: undefined` explícito importa: o roteador junta a busca validada com a crua (ver
  // kanban/endereco.ts), e sem ele um `?contato=42` passaria adiante.
  return { contato: id && id.length <= 100 ? id : undefined };
}

/** O relógio da tela: um intervalo só (30 s) para as horas e as esperas (cópia do de kanban/GavetaLead). */
function useRelogio(intervaloMs = 30_000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => window.clearInterval(id);
  }, [intervaloMs]);
  return agora;
}

function lerRolagem(rolador: HTMLElement | null): number {
  return rolador ? rolador.scrollTop : window.scrollY;
}

/** Rola na hora (sem a animação suave), para a troca de tela não "deslizar". */
function rolarPara(rolador: HTMLElement | null, topo: number) {
  if (rolador) rolador.scrollTop = topo;
  else if (typeof window.scrollTo === "function") window.scrollTo({ top: topo, left: 0, behavior: "instant" });
}

type TomAviso = "ok" | "lixo";

interface Props {
  /** O contato do endereço (`?contato=`), ou nulo para a tabela. */
  contatoId: string | null;
  /**
   * Troca o endereço: um id abre o perfil, `null` volta para a tabela. Por padrão cria um passo no
   * "voltar"; com `substituir`, troca o endereço sem criar passo (a tela usa quando sai sozinha de um
   * id que não existe ou de um contato apagado, para o "voltar" não cair de novo nele).
   */
  irPara(contatoId: string | null, opcoes?: { substituir?: boolean }): void;
}

export function TelaContatos({ contatoId, irPara }: Props) {
  const modo = useModoDados();
  const agora = useRelogio();
  const raiz = useRef<HTMLDivElement>(null);

  // Os filtros ficam aqui, e não na tabela: a tabela sai da tela quando o perfil abre, e a busca, o
  // filtro, a ordem e a página precisam voltar iguais.
  const [filtros, setFiltros] = useState<FiltrosTabela>(FILTROS_INICIAIS);

  // O contato do endereço (?contato=). No banco, o id que não é uuid nem vai à consulta (o
  // useAbrirPorId recusa); a leitura é a mesma do perfil (dados/conversa.ts), que fica no cache.
  const idValido = !!contatoId && (modo !== "banco" || ehUuid(contatoId.trim()));
  const lido = useContato(idValido ? contatoId : null);
  const buscar = useBuscarContato();

  // Um id que não existe (contato apagado, endereço antigo) mostra a tabela, sem erro. Enquanto o
  // contato carrega, o perfil já abre com o esqueleto; se a leitura falha, ele mostra o erro com
  // "Tentar de novo" (as leituras do perfil incluem a do contato).
  const naoExiste = !!contatoId && (!idValido || (!lido.carregando && !lido.erro && lido.dados === null));
  const perfilId = contatoId && !naoExiste ? contatoId : null;

  // O último contato aberto: ao voltar para a tabela, o foco vai para a linha dele.
  const [focoContatoId, setFocoContatoId] = useState<string | null>(null);
  if (perfilId && perfilId !== focoContatoId) setFocoContatoId(perfilId);

  // O id de que a tela já saiu sozinha (o inexistente, ou o que acabou de ser apagado): o efeito
  // abaixo não navega de novo por ele.
  const jaSaiu = useRef<string | null>(null);
  // O irPara mais novo, sem fazer os efeitos e os callbacks rodarem de novo quando a rota o recria.
  const irParaRef = useRef(irPara);
  useLayoutEffect(() => {
    irParaRef.current = irPara;
  });

  const sair = useCallback((id: string | null) => {
    if (!id || jaSaiu.current === id) return;
    jaSaiu.current = id;
    // Substitui: o endereço com o id inválido não fica no histórico.
    irParaRef.current(null, { substituir: true });
  }, []);

  // O contato que não existe (ou sumiu com o perfil aberto: apagado por outra pessoa, pelo tempo real).
  useEffect(() => {
    if (naoExiste) sair(contatoId);
  }, [contatoId, naoExiste, sair]);

  // Abrir pelo endereço (dados/abrirPorId.ts): confere o id (no banco, só uuid), procura (no cache ou
  // numa leitura) e, se não achar, volta para a tabela. O parâmetro fica no endereço, porque é ele que
  // mostra o perfil: abrir e limpar não fazem nada aqui.
  useAbrirPorId(contatoId, buscar, {
    pronto: true,
    abrir: () => {},
    limpar: () => {},
    naoAchou: () => sair(contatoId),
  });

  /* ---------- a rolagem e o foco na troca de tela ---------- */

  // A rolagem da tabela, guardada enquanto ela está na tela. Quem escuta o rolador ignora os eventos
  // depois que o perfil entrou (o navegador rola sozinho quando a página encurta).
  const rolagemDaTabela = useRef(0);
  const naTabela = useRef(!perfilId);

  useEffect(() => {
    if (perfilId) return;
    const rolador = acharRolador(raiz.current);
    const alvo: HTMLElement | Window = rolador ?? window;
    const aoRolar = () => {
      if (naTabela.current) rolagemDaTabela.current = lerRolagem(rolador);
    };
    alvo.addEventListener("scroll", aoRolar, { passive: true });
    return () => alvo.removeEventListener("scroll", aoRolar);
  }, [perfilId]);

  // O que estava na tela no render anterior (null = a tabela), para saber de onde a pessoa veio.
  const anterior = useRef<string | null | undefined>(undefined);

  useLayoutEffect(() => {
    const veioDe = anterior.current;
    anterior.current = perfilId;
    naTabela.current = !perfilId;
    if (veioDe === perfilId) return;
    const rolador = acharRolador(raiz.current);

    if (perfilId) {
      // Abriu um perfil (vindo da tabela, de outro perfil ou direto pelo endereço): começa do alto,
      // com o foco no nome.
      rolarPara(rolador, 0);
      document.getElementById(idTituloPerfil(perfilId))?.focus({ preventScroll: true });
      return;
    }
    // Primeira vez na tabela: o foco é do Layout (ele foca o título da área quando um atalho a abre).
    if (veioDe === undefined) return;
    // Voltou do perfil: a rolagem de antes e o foco na linha do contato; sem a linha (o contato foi
    // apagado ou saiu do filtro), o título da área.
    rolarPara(rolador, rolagemDaTabela.current);
    const linha = focoContatoId ? document.getElementById(idLinhaContato(focoContatoId)) : null;
    (linha ?? document.getElementById(idTituloArea("contatos")))?.focus({ preventScroll: true });
  }, [perfilId, focoContatoId]);

  const aoAbrir = useCallback((id: string) => {
    // Guarda a rolagem antes de trocar: o evento de rolagem pode não ter chegado ainda.
    if (naTabela.current) rolagemDaTabela.current = lerRolagem(acharRolador(raiz.current));
    irParaRef.current(id);
  }, []);

  const aoVoltar = useCallback(() => irParaRef.current(null), []);

  /* ---------- o aviso curto ---------- */

  const [aviso, setAviso] = useState<{ id: number; texto: string; tom: TomAviso } | null>(null);
  const idAviso = useRef(0);

  const mostrarAviso = useCallback((texto: string, tom: TomAviso) => {
    idAviso.current += 1;
    setAviso({ id: idAviso.current, texto, tom });
  }, []);

  const avisar = useCallback((texto: string) => mostrarAviso(texto, "ok"), [mostrarAviso]);

  // Um aviso por vez: o novo troca o anterior, e cada um some sozinho em 4 s.
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso((a) => (a?.id === aviso.id ? null : a)), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const aoApagado = useCallback(
    (nome: string) => {
      // O contato sumiu do estado: o efeito do id inexistente não precisa navegar de novo, e o foco
      // não tem mais a linha dele para voltar.
      if (contatoId) jaSaiu.current = contatoId;
      setFocoContatoId(null);
      // Substitui: o "voltar" não deve levar ao perfil de um contato que não existe mais.
      irParaRef.current(null, { substituir: true });
      mostrarAviso(`Contato apagado: ${nome}`, "lixo");
    },
    [contatoId, mostrarAviso],
  );

  return (
    <div ref={raiz} className={s.tcoRaiz}>
      {perfilId ? (
        <PerfilContato
          key={perfilId}
          contatoId={perfilId}
          agora={agora}
          aoVoltar={aoVoltar}
          aoApagado={aoApagado}
          avisar={avisar}
        />
      ) : (
        <TabelaContatos
          filtros={filtros}
          aoMudarFiltros={setFiltros}
          aoAbrir={aoAbrir}
          agora={agora}
          focoContatoId={focoContatoId}
        />
      )}

      {aviso ? (
        <div key={aviso.id} className={s.tcoAviso} data-tom={aviso.tom}>
          {aviso.tom === "lixo" ? (
            <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={18} strokeWidth={1.75} aria-hidden="true" />
          )}
          <p className={s.tcoAvisoTexto}>{aviso.texto}</p>
          <button type="button" className={s.tcoAvisoFechar} aria-label="Fechar o aviso" onClick={() => setAviso(null)}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {/* O leitor de tela ouve o aviso por aqui (o desenho acima não é uma região viva). */}
      <p className={s.tcoSr} role="status" aria-live="polite">
        {aviso?.texto ?? ""}
      </p>
    </div>
  );
}
