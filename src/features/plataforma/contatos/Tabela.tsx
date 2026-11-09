import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, ListFilter, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { type Classes } from "@/components/aipro/cx";

import { AREAS } from "../areas";
import { idTituloArea } from "../AreaVazia";
import { AvatarLead } from "../comum/AvatarLead";
import { erroDeReleitura, erroSemDados } from "../comum/releitura";
import { dataCurta, diaLocal, horaLista } from "../comum/tempo";
import {
  TAMANHO_PAGINA_CONTATOS,
  paginaDe,
  useContadoresContatos,
  useListaContatos,
} from "../dados/contatos";
import { Carregando, ErroLeitura } from "../dados/estados";
import { useDados, useModoDados } from "../dados/ProvedorDados";
import type { Etapa } from "../exemplo";
import { FILTROS_INICIAIS } from "./dados";
import { idLinhaContato } from "./ids";
import { Paginacao, PontoEtapa, TextoQuem, VazioContatos } from "./pecas";
import type { ColunaOrdem, FiltrosTabela, LinhaTabela, PeriodoEntrada, RecorteTabela } from "./tipos";
import estilos from "./Tabela.module.css";

// A tabela de Contatos (task C1 de docs/spec-contatos.md; decisões 8 e 9 do equipe): as abas de
// contador, a busca, o filtro, as colunas que ordenam e, abaixo de 1024 px, uma lista em 2 linhas.
// Nada de cartão ou pílula colorida (decisão 5): a cor fica só nas bolinhas da etapa e de "ao vivo".
// Os filtros moram na TelaContatos (eles sobrevivem à ida ao perfil); aqui só se lê e se pede a troca.

const s = estilos as Classes<
  | "tbRaiz"
  | "tbCab"
  | "tbTitulo"
  | "tbTotal"
  | "tbAbas"
  | "tbAba"
  | "tbAbaNum"
  | "tbBarra"
  | "tbBusca"
  | "tbBuscaIcone"
  | "tbFiltro"
  | "tbFiltroBotao"
  | "tbFiltroNum"
  | "tbFiltroSeta"
  | "tbPop"
  | "tbGrupo"
  | "tbGrupoTitulo"
  | "tbOpcao"
  | "tbLimpar"
  | "tbCaixa"
  | "tbTabela"
  | "tbColContato"
  | "tbColEtapa"
  | "tbColQuem"
  | "tbColUltima"
  | "tbColEntrada"
  | "tbOrdenar"
  | "tbOrdemIcone"
  | "tbLinha"
  | "tbContato"
  | "tbNomeBotao"
  | "tbNome"
  | "tbEmpresa"
  | "tbSemEmpresa"
  | "tbData"
  | "tbLista"
  | "tbItem"
  | "tbItemLinha1"
  | "tbItemLinha2"
  | "tbItemHora"
  | "tbItemEmpresa"
  | "tbItemSituacao"
  | "tbSep"
  | "tbSr"
>;

/* ---------- a leitura ---------- */

/** O atraso da busca no banco: curto o bastante para parecer na hora, longo para não consultar a cada letra. */
const ATRASO_BUSCA_MS = 300;

const SEM_LINHAS: readonly LinhaTabela[] = [];
const SEM_ETAPAS: readonly Etapa[] = [];

/** O valor, depois de `ms` sem mudar (0 = na hora). */
function useAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    if (ms <= 0) return;
    const t = window.setTimeout(() => setAtrasado(valor), ms);
    return () => window.clearTimeout(t);
  }, [valor, ms]);
  return ms <= 0 ? valor : atrasado;
}

/* ---------- textos ---------- */

const ABAS: readonly { id: RecorteTabela; nome: string }[] = [
  { id: "todos", nome: "Todos" },
  { id: "precisam", nome: "Precisam de você" },
  { id: "novos_hoje", nome: "Novos hoje" },
  { id: "com_janete", nome: "Com a Janete" },
  { id: "comigo", nome: "Comigo" },
];

const PERIODOS: readonly { id: PeriodoEntrada; nome: string; frase: string }[] = [
  { id: "qualquer", nome: "Qualquer data", frase: "" },
  { id: "hoje", nome: "Hoje", frase: "que entrou hoje" },
  { id: "7", nome: "Últimos 7 dias", frase: "que entrou nos últimos 7 dias" },
  { id: "30", nome: "Últimos 30 dias", frase: "que entrou nos últimos 30 dias" },
];

const COLUNAS: Readonly<Record<ColunaOrdem, { nome: string; asc: string; desc: string; padrao: "asc" | "desc" }>> = {
  contato: { nome: "Contato", asc: "de A a Z", desc: "de Z a A", padrao: "asc" },
  etapa: { nome: "Etapa", asc: "na ordem do funil", desc: "do fim do funil para o começo", padrao: "asc" },
  ultima: { nome: "Última mensagem", asc: "da mais antiga para a mais nova", desc: "da mais nova para a mais antiga", padrao: "desc" },
  entrada: { nome: "Entrou em", asc: "do mais antigo para o mais novo", desc: "do mais novo para o mais antigo", padrao: "desc" },
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "a, b e c". */
function juntar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/** Quantos filtros do menu estão ligados: cada etapa marcada conta um, e o período conta um. */
function filtrosLigados(f: FiltrosTabela): number {
  return f.etapaIds.length + (f.entrada === "qualquer" ? 0 : 1);
}

/** Algo além da tabela inteira: busca, aba que não é "Todos" ou filtro do menu. */
function estaRecortado(f: FiltrosTabela): boolean {
  return f.busca.trim() !== "" || f.recorte !== "todos" || filtrosLigados(f) > 0;
}

/** O que foi buscado e filtrado, para o vazio dizer por que não achou nada. */
function descreverBusca(f: FiltrosTabela, etapas: readonly Etapa[]): string {
  const partes: string[] = [];
  const busca = f.busca.trim();
  if (busca) partes.push(`a busca “${busca}”`);
  if (f.recorte !== "todos") partes.push(`a aba ${ABAS.find((a) => a.id === f.recorte)?.nome ?? ""}`);
  if (f.etapaIds.length) {
    const nomes = f.etapaIds.map((id) => etapas.find((e) => e.id === id)?.nome.trim() || "Sem etapa");
    partes.push(`${nomes.length === 1 ? "a etapa" : "as etapas"} ${juntar(nomes)}`);
  }
  const periodo = PERIODOS.find((p) => p.id === f.entrada);
  if (periodo?.frase) partes.push(`quem ${periodo.frase.replace(/^que /, "")}`);
  return `Nenhum contato bate com ${juntar(partes)}. Tente outro termo ou limpe a busca e os filtros.`;
}

/** "26/10", com o ano quando não é o ano de hoje. */
function dataEntrada(iso: string, agora: number): string {
  return dataCurta(iso, diaLocal(iso).slice(0, 4) !== diaLocal(agora).slice(0, 4));
}

/* ---------- a largura: tabela a partir de 1024 px, lista abaixo ----------
   Decidido no JavaScript (e não só no CSS) para o botão do nome, que leva o id da linha, existir uma
   vez só na página. Mesmo molde do exemplo/telaEstreita.ts. */

const CONSULTA_LISTA = "(max-width: 1023px)";

function consulta(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(CONSULTA_LISTA)
      : null;
  } catch {
    return null;
  }
}

function assinarLargura(avisar: () => void): () => void {
  const mq = consulta();
  if (!mq) return () => {};
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", avisar);
    return () => mq.removeEventListener("change", avisar);
  }
  mq.addListener(avisar);
  return () => mq.removeListener(avisar);
}

/** Abaixo de 1024 px a tabela vira lista. Fora do navegador, tabela. */
function useEmLista(): boolean {
  return useSyncExternalStore(
    assinarLargura,
    () => !!consulta()?.matches,
    () => false,
  );
}

/* ---------- o filtro ---------- */

/**
 * O botão Filtro e o painel dele: Etapa (várias, caixas de marcar com a bolinha da cor) e Entrou em
 * (uma, botões de rádio). O MenuSuspenso de comum/ só escolhe uma opção e fecha a cada escolha; aqui
 * a pessoa marca várias etapas seguidas, então o painel é um "mostrar e esconder" com campos nativos
 * (o leitor de tela já conhece caixa de marcar e rádio). Esc ou clique fora fecham; Esc devolve o
 * foco ao botão. O desenho é o do MenuSuspenso.
 */
function MenuFiltro({
  filtros,
  etapas,
  aoMudar,
}: {
  filtros: FiltrosTabela;
  etapas: readonly Etapa[];
  aoMudar(f: FiltrosTabela): void;
}) {
  const base = useId();
  const idPainel = `${base}-painel`;
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const ligados = filtrosLigados(filtros);

  useEffect(() => {
    if (!aberto) return;
    const fora = (ev: Event) => {
      if (raiz.current && ev.target instanceof Node && !raiz.current.contains(ev.target)) setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("mousedown", fora);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("mousedown", fora);
    };
  }, [aberto]);

  const tecla = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Escape" && aberto) {
      ev.preventDefault();
      ev.stopPropagation();
      setAberto(false);
      botao.current?.focus();
    }
  };

  const alternarEtapa = (id: string) => {
    const marcadas = filtros.etapaIds.includes(id)
      ? filtros.etapaIds.filter((e) => e !== id)
      : [...filtros.etapaIds, id];
    aoMudar({ ...filtros, etapaIds: marcadas });
  };

  return (
    <div ref={raiz} className={s.tbFiltro} onKeyDown={tecla}>
      <button
        ref={botao}
        type="button"
        className={s.tbFiltroBotao}
        aria-expanded={aberto}
        aria-controls={aberto ? idPainel : undefined}
        aria-label={ligados ? `Filtro, ${plural(ligados, "ligado", "ligados")}` : "Filtro"}
        data-ligado={ligados ? "" : undefined}
        onClick={() => setAberto((a) => !a)}
      >
        <ListFilter size={16} strokeWidth={2} aria-hidden="true" />
        <span>Filtro</span>
        {ligados ? (
          <span className={s.tbFiltroNum} aria-hidden="true">
            {ligados}
          </span>
        ) : null}
        <ChevronDown className={s.tbFiltroSeta} size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      {aberto ? (
        <div id={idPainel} className={s.tbPop} role="group" aria-label="Filtrar contatos">
          <fieldset className={s.tbGrupo}>
            <legend className={s.tbGrupoTitulo}>Etapa</legend>
            {etapas.map((e) => (
              <label key={e.id} className={s.tbOpcao}>
                <input
                  type="checkbox"
                  checked={filtros.etapaIds.includes(e.id)}
                  onChange={() => alternarEtapa(e.id)}
                />
                <PontoEtapa etapa={e} />
              </label>
            ))}
          </fieldset>
          <fieldset className={s.tbGrupo}>
            <legend className={s.tbGrupoTitulo}>Entrou em</legend>
            {PERIODOS.map((p) => (
              <label key={p.id} className={s.tbOpcao}>
                <input
                  type="radio"
                  name={`${base}-entrada`}
                  checked={filtros.entrada === p.id}
                  onChange={() => aoMudar({ ...filtros, entrada: p.id })}
                />
                <span>{p.nome}</span>
              </label>
            ))}
          </fieldset>
          {ligados ? (
            <button
              type="button"
              className={s.tbLimpar}
              onClick={() => {
                aoMudar({ ...filtros, etapaIds: [], entrada: "qualquer" });
                botao.current?.focus();
              }}
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- a tabela ---------- */

interface Props {
  filtros: FiltrosTabela;
  aoMudarFiltros(f: FiltrosTabela): void;
  aoAbrir(contatoId: string): void;
  agora: number;
  focoContatoId: string | null;
}

export function TabelaContatos({ filtros, aoMudarFiltros: mudarFiltros, aoAbrir, agora, focoContatoId }: Props) {
  const emLista = useEmLista();
  const idBusca = useId();
  const modo = useModoDados();

  // A busca vai ao banco com um atraso curto (cada letra não vira uma consulta); o campo mostra o
  // texto na hora. No exemplo, em memória, sem atraso.
  const buscaAtrasada = useAtrasado(filtros.busca, modo === "banco" ? ATRASO_BUSCA_MS : 0);
  const filtrosDaLeitura = useMemo(() => ({ ...filtros, busca: buscaAtrasada }), [filtros, buscaAtrasada]);

  const lista = useListaContatos(filtrosDaLeitura, agora);
  const contagem = useContadoresContatos(agora);
  const leituraEtapas = useDados().useEtapas();
  const todasEtapas = leituraEtapas.dados ?? SEM_ETAPAS;
  const etapas = useMemo(
    () => todasEtapas.filter((e) => !e.arquivada).sort((a, b) => a.ordem - b.ordem),
    [todasEtapas],
  );
  const linhas = lista.dados?.linhas ?? SEM_LINHAS;
  const totalFiltro = lista.dados?.total ?? 0;
  const numeros = contagem.dados;

  // Mudar a busca, a aba, o filtro ou a ordem volta para a 1ª página; só a paginação troca a página.
  const aoMudarFiltros = (f: FiltrosTabela) => mudarFiltros(paginaDe(f) ? { ...f, pagina: 0 } : f);
  const irParaPagina = (pagina: number) => {
    mudarFiltros({ ...filtros, pagina });
    document.getElementById(idTituloArea("contatos"))?.focus({ preventScroll: false });
  };

  // A volta do perfil: o foco vai para o botão do contato que estava aberto. A TelaContatos também
  // tenta; aqui garante quando a linha só aparece depois do primeiro desenho. Sem rolar: a rolagem
  // de antes é a TelaContatos que devolve.
  useEffect(() => {
    if (!focoContatoId) return;
    document.getElementById(idLinhaContato(focoContatoId))?.focus({ preventScroll: true });
  }, [focoContatoId]);

  // O total da casa ("312 contatos") vem dos contadores; com busca ou filtro, "12 de 312" (o 12 é o
  // total do filtro, de todas as páginas). Enquanto os contadores não chegam, vale o da lista.
  const recortado = estaRecortado(filtrosDaLeitura);
  const total = numeros?.todos ?? (recortado ? null : lista.dados ? totalFiltro : null);
  const textoTotal = !lista.dados
    ? ""
    : recortado
      ? total === null
        ? plural(totalFiltro, "contato", "contatos")
        : `${totalFiltro} de ${total}`
      : plural(total ?? totalFiltro, "contato", "contatos");

  const ordenar = (coluna: ColunaOrdem) => {
    const { ordem } = filtros;
    const direcao =
      ordem.coluna === coluna ? (ordem.direcao === "asc" ? "desc" : "asc") : COLUNAS[coluna].padrao;
    aoMudarFiltros({ ...filtros, ordem: { coluna, direcao } });
  };

  const limparTudo = () => aoMudarFiltros({ ...FILTROS_INICIAIS, ordem: filtros.ordem });

  // A linha inteira abre o contato com o mouse; o teclado e o leitor de tela usam o botão do nome.
  // Quem arrasta para selecionar um texto da linha não abre o perfil sem querer.
  const cliqueNaLinha = (ev: MouseEvent, contatoId: string) => {
    if (ev.defaultPrevented) return;
    if (typeof window.getSelection === "function" && window.getSelection()?.toString()) return;
    aoAbrir(contatoId);
  };

  const abrirPeloBotao = (ev: MouseEvent, contatoId: string) => {
    ev.stopPropagation();
    aoAbrir(contatoId);
  };

  // Nenhum contato na empresa: pelos contadores, ou pela lista sem nenhum recorte.
  const vazioDeVez = numeros ? numeros.todos === 0 : !!lista.dados && !recortado && totalFiltro === 0;
  const area = AREAS.find((a) => a.id === "contatos");

  // Só sem as linhas o erro toma a tabela; com elas na tela, a releitura que falhou vira um aviso em cima.
  const erroTabela = erroSemDados(lista);
  const erroReleitura = erroDeReleitura(lista);

  let conteudo;
  if (erroTabela) {
    conteudo = <ErroLeitura erro={erroTabela} tentarDeNovo={lista.tentarDeNovo} titulo="Não deu para carregar os contatos" />;
  } else if (!lista.dados) {
    conteudo = <Carregando forma="lista" quantos={6} rotulo="Carregando os contatos" />;
  } else if (vazioDeVez) {
    conteudo = (
      <VazioContatos titulo={area?.vazio.titulo ?? "Nenhum contato ainda"} texto={area?.vazio.texto ?? ""} />
    );
  } else if (linhas.length === 0) {
    conteudo = (
      <VazioContatos
        titulo="Nenhum contato encontrado"
        texto={descreverBusca(filtrosDaLeitura, todasEtapas)}
        acao={{ rotulo: "Limpar busca e filtros", aoClicar: limparTudo }}
      />
    );
  } else if (emLista) {
    conteudo = (
      <ul className={s.tbLista} aria-label="Contatos">
        {linhas.map((l) => (
          <li key={l.contatoId}>
            <button
              type="button"
              id={idLinhaContato(l.contatoId)}
              className={s.tbItem}
              onClick={(ev) => abrirPeloBotao(ev, l.contatoId)}
            >
              <AvatarLead nome={l.nome} chave={l.contatoId} tamanho="p" />
              <span className={s.tbItemLinha1}>
                <span className={s.tbNome}>{l.nome}</span>
                <span className={s.tbItemHora}>
                  {l.ultimaMensagemEm ? (
                    <>
                      <span className={s.tbSr}>, última mensagem </span>
                      {horaLista(l.ultimaMensagemEm, agora)}
                    </>
                  ) : null}
                </span>
              </span>
              {/* A empresa encolhe sozinha; a etapa e quem atende andam juntos e, se não couberem ao
                  lado dela, descem inteiros para a linha de baixo. */}
              <span className={s.tbItemLinha2}>
                <span className={s.tbItemEmpresa}>{l.empresa?.trim() || "Sem empresa"}</span>
                <span className={s.tbItemSituacao}>
                  <PontoEtapa etapa={l.etapa} />
                  <span className={s.tbSep} aria-hidden="true">
                    ·
                  </span>
                  <TextoQuem quem={l.quem} agora={agora} curto="sempre" />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  } else {
    const { coluna, direcao } = filtros.ordem;
    const cabecalho = (c: ColunaOrdem, classe: string | undefined) => {
      const ativa = coluna === c;
      const Icone = !ativa ? ChevronsUpDown : direcao === "asc" ? ArrowUp : ArrowDown;
      return (
        <th scope="col" className={classe} aria-sort={ativa ? (direcao === "asc" ? "ascending" : "descending") : "none"}>
          <button type="button" className={s.tbOrdenar} data-ativa={ativa ? "" : undefined} onClick={() => ordenar(c)}>
            {COLUNAS[c].nome}
            <Icone className={s.tbOrdemIcone} size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </th>
      );
    };
    conteudo = (
      <div className={s.tbCaixa}>
        <table className={s.tbTabela}>
          <caption className={s.tbSr}>
            {`Contatos, ordenados por ${COLUNAS[coluna].nome}, ${COLUNAS[coluna][direcao]}. Abra um contato pelo nome.`}
          </caption>
          <thead>
            <tr>
              {cabecalho("contato", s.tbColContato)}
              {cabecalho("etapa", s.tbColEtapa)}
              <th scope="col" className={s.tbColQuem}>
                Quem atende
              </th>
              {cabecalho("ultima", s.tbColUltima)}
              {cabecalho("entrada", s.tbColEntrada)}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <LinhaDaTabela
                key={l.contatoId}
                linha={l}
                agora={agora}
                aoClicarLinha={cliqueNaLinha}
                aoClicarNome={abrirPeloBotao}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className={s.tbRaiz} aria-labelledby={idTituloArea("contatos")}>
      <header className={s.tbCab}>
        <h1 id={idTituloArea("contatos")} className={s.tbTitulo} tabIndex={-1}>
          Contatos
        </h1>
        {/* Avisa o leitor de tela quando a busca ou o filtro mudam o número. */}
        <p className={s.tbTotal} aria-live="polite">
          {textoTotal}
        </p>
      </header>

      {vazioDeVez ? null : (
        <>
          <div className={s.tbAbas} role="group" aria-label="Mostrar">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={s.tbAba}
                aria-pressed={filtros.recorte === a.id}
                onClick={() => aoMudarFiltros({ ...filtros, recorte: a.id })}
              >
                {a.nome}
                {/* Sem os contadores (carregando ou falhou), a aba fica só com o nome. */}
                {numeros ? <span className={s.tbAbaNum}>{numeros[a.id]}</span> : null}
              </button>
            ))}
          </div>

          <div className={s.tbBarra}>
            <div className={s.tbBusca}>
              <Search className={s.tbBuscaIcone} size={18} strokeWidth={2} aria-hidden="true" />
              <label htmlFor={idBusca} className={s.tbSr}>
                Buscar contato
              </label>
              <input
                id={idBusca}
                type="search"
                value={filtros.busca}
                placeholder={emLista ? "Buscar contato" : "Buscar por nome, telefone, empresa ou e-mail"}
                autoComplete="off"
                onChange={(ev) => aoMudarFiltros({ ...filtros, busca: ev.target.value })}
              />
            </div>
            <MenuFiltro filtros={filtros} etapas={etapas} aoMudar={aoMudarFiltros} />
          </div>
        </>
      )}

      {erroReleitura ? (
        <ErroLeitura erro={erroReleitura} tentarDeNovo={lista.tentarDeNovo} titulo="Não deu para atualizar os contatos" compacto />
      ) : null}

      <div aria-busy={lista.atualizando || undefined}>{conteudo}</div>

      {lista.dados && !vazioDeVez ? (
        <Paginacao
          pagina={paginaDe(filtros)}
          tamanho={TAMANHO_PAGINA_CONTATOS}
          total={totalFiltro}
          aoMudar={irParaPagina}
          ocupado={lista.atualizando}
        />
      ) : null}
    </section>
  );
}

/** Uma linha da tabela (computador): a linha toda abre com o mouse; o nome é o botão do teclado. */
function LinhaDaTabela({
  linha: l,
  agora,
  aoClicarLinha,
  aoClicarNome,
}: {
  linha: LinhaTabela;
  agora: number;
  aoClicarLinha(ev: MouseEvent, contatoId: string): void;
  aoClicarNome(ev: MouseEvent, contatoId: string): void;
}) {
  const empresa = l.empresa?.trim();
  return (
    <tr className={s.tbLinha} onClick={(ev) => aoClicarLinha(ev, l.contatoId)}>
      <td>
        <div className={s.tbContato}>
          <AvatarLead nome={l.nome} chave={l.contatoId} tamanho="p" />
          <div className={s.tbNome}>
            <button
              type="button"
              id={idLinhaContato(l.contatoId)}
              className={s.tbNomeBotao}
              title={l.nome}
              onClick={(ev) => aoClicarNome(ev, l.contatoId)}
            >
              {l.nome}
            </button>
            <span className={empresa ? s.tbEmpresa : s.tbSemEmpresa}>{empresa || "Sem empresa"}</span>
          </div>
        </div>
      </td>
      <td>
        <PontoEtapa etapa={l.etapa} />
      </td>
      <td>
        <TextoQuem quem={l.quem} agora={agora} curto="estreito" />
      </td>
      <td className={s.tbData}>
        {l.ultimaMensagemEm ? (
          horaLista(l.ultimaMensagemEm, agora)
        ) : (
          <>
            <span aria-hidden="true">—</span>
            <span className={s.tbSr}>Sem mensagem</span>
          </>
        )}
      </td>
      <td className={s.tbData}>{dataEntrada(l.entrouEm, agora)}</td>
    </tr>
  );
}
