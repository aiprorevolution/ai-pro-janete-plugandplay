import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

import { Botao } from "@/components/aipro/Botao";
import { type Classes } from "@/components/aipro/cx";

import { LinhaConversa, nomeDoContato, situacaoDe } from "../comum/LinhaConversa";
import { Carregando, ErroLeitura } from "../dados/estados";
import { useJaneteTrabalhando, useQuadro } from "../dados/kanban";
import { useDados } from "../dados/ProvedorDados";
import { estaAguardando, etapasVisiveis, nomeDoMembro } from "../exemplo/regras";
import { useTelaEstreita } from "../exemplo/telaEstreita";
import type { Membro } from "../exemplo/tipos";
import { corDaEtapa, nomeDaEtapa } from "./Coluna";
import { ConversaLead, GavetaLead, InfoLead, useLead, useRelogio } from "./GavetaLead";
import { NoCorpo } from "./NoCorpo";

import estilos from "./EtapaChat.module.css";
import gaveta from "./GavetaLead.module.css";

// A etapa que vira chat (a "etapa em tela cheia" do Kanban-2.dc.html, ideia b do equipe): a lista das
// conversas da etapa à esquerda, com a linha compacta do Chat; do outro lado, a conversa e o lead
// encaixados, como na tela de Chat. As setas trocam de etapa e "Voltar ao quadro" (ou Esc) sai.
// No celular (abaixo de 900 px), como no `.foco` do protótipo, a etapa cobre a tela por cima da moldura
// (vai para o `body` pelo NoCorpo), com as mesmas setas, mas fica embaixo do dock e do botão da Janete, que
// continuam valendo (decisão de 02/11/2026): por isso não é janela modal. A conversa abre na gaveta do
// lead, em tela cheia, por cima de tudo.

const s = estilos as Classes<
  | "ecRaiz"
  | "ecCab"
  | "ecTitulo"
  | "ecPonto"
  | "ecConta"
  | "ecSetas"
  | "ecSeta"
  | "ecLista"
  | "ecVazio"
  | "ecPainel"
  | "ecEscolha"
  | "ecVoltar"
>;
const g = gaveta as Classes<"glCorpo">;

type Props = {
  etapaId: string;
  aoVoltar: () => void;
  aoTrocarEtapa: (id: string) => void;
  /** A busca e o filtro da barra do quadro: só os contatos que passam aparecem na lista. Sem ele, todos. */
  mostrar?: ((contatoId: string) => boolean) | undefined;
};

export function EtapaChat({ etapaId, aoVoltar, aoTrocarEtapa, mostrar }: Props) {
  const dados = useDados();
  const eu = dados.useEu();
  const estreita = useTelaEstreita();
  const agora = useRelogio();
  const idTitulo = useId();

  const etapasL = dados.useEtapas();
  const etapasTodas = etapasL.dados;
  const quadroL = useQuadro(etapasTodas);
  const membros = dados.useMembros().dados;
  const trabalhando = useJaneteTrabalhando().dados;
  const pessoas = useMemo(() => ({ membros: [...(membros ?? [])], eu: eu.membro as Membro }), [membros, eu.membro]);

  const etapas = etapasVisiveis({ etapas: [...(etapasTodas ?? [])] });
  const etapa = etapasTodas?.find((e) => e.id === etapaId) ?? null;
  const i = etapas.findIndex((e) => e.id === etapaId);
  const anterior = i > 0 ? etapas[i - 1] : undefined;
  const proxima = i >= 0 && i < etapas.length - 1 ? etapas[i + 1] : undefined;

  // As conversas da etapa na ordem do quadro: quem espera a equipe primeiro, depois da mais recente
  // para a mais antiga (a `sort` é estável, então a recência fica dentro de cada grupo).
  const linhasDados = quadroL.dados?.linhas;
  const todas = useMemo(() => {
    const t = (iso: string | null, reserva: string) => new Date(iso ?? reserva).getTime();
    return (linhasDados ?? [])
      .filter((l) => l.contato.etapa_id === etapaId)
      .sort((a, b) => t(b.conversa.ultima_mensagem_em, b.conversa.criado_em) - t(a.conversa.ultima_mensagem_em, a.conversa.criado_em))
      .sort((a, b) => Number(estaAguardando(b.conversa)) - Number(estaAguardando(a.conversa)));
  }, [linhasDados, etapaId]);
  const lista = mostrar ? todas.filter((l) => mostrar(l.contato.id)) : todas;

  // O lead aberto. No computador, a etapa abre já no primeiro da lista; no celular, só pelo toque.
  // O que abriu sozinho só vira lido na 1ª interação dentro da conversa (a regra do Chat, decisão 6).
  const [aberto, setAberto] = useState<string | null>(null);
  const [abertoSozinho, setAbertoSozinho] = useState(false);
  const primeiro = lista[0]?.contato.id ?? null;
  const quadroPronto = !!quadroL.dados;
  useEffect(() => {
    setAberto(estreita ? null : primeiro);
    setAbertoSozinho(!estreita && !!primeiro);
    // Só a troca de etapa (ou de largura, ou o quadro chegando) escolhe de novo; a lista mudando de
    // ordem não.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapaId, estreita, quadroPronto]);
  const abrir = (contatoId: string | null) => {
    setAberto(contatoId);
    setAbertoSozinho(false);
  };

  // O aberto foi apagado: no computador, o primeiro que sobrou.
  const leitura = useLead(aberto);
  const lead = leitura.lead;
  const sumiu = !!aberto && !lead && !leitura.carregando && !leitura.erro;
  useEffect(() => {
    if (sumiu) {
      setAberto(estreita ? null : primeiro);
      setAbertoSozinho(!estreita && !!primeiro);
    }
  }, [sumiu, estreita, primeiro]);

  // No celular, a etapa não trava a rolagem da página: ela rola por dentro (com `overscroll-behavior`),
  // e quem trava o `overflow` do body é só a gaveta do lead, enquanto está aberta.

  const raizRef = useRef<HTMLElement>(null);
  const voltarRef = useRef(aoVoltar);
  useEffect(() => {
    voltarRef.current = aoVoltar;
  });

  // A gaveta fechou e não achou para onde devolver o foco (a conversa foi apagada ou mudou de etapa e
  // a linha sumiu da lista): o foco iria para o body, atrás da etapa. Vai para "Voltar ao quadro".
  // Roda depois da limpeza da Gaveta (o efeito do pai vem depois do dos filhos).
  useEffect(() => {
    if (estreita && !aberto && document.activeElement === document.body) {
      document.getElementById("kb-foco-voltar")?.focus({ preventScroll: true });
    }
  }, [estreita, aberto]);

  // Em tela cheia, com o foco fora da etapa (no body ou no dock, por exemplo), o Esc ainda sai. O Tab
  // segue a ordem da página: a etapa não prende o foco, porque o dock e o botão da Janete ficam por cima.
  // Com o foco dentro, quem cuida é o `tecla`; com a gaveta aberta, é ela (e o Esc não pode fechar a
  // etapa por baixo dela).
  useEffect(() => {
    if (!estreita || aberto) return;
    const ouvir = (ev: globalThis.KeyboardEvent) => {
      const raiz = raizRef.current;
      if (!raiz || ev.key !== "Escape") return;
      const alvo = ev.target instanceof Node ? ev.target : null;
      if (alvo && raiz.contains(alvo)) return;
      // Outro diálogo ou menu aberto por cima cuida das próprias teclas.
      if (alvo instanceof Element && alvo.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      // Uma janela modal aberta fora da etapa (o painel da Janete, aberto pelo botão por cima dela) com o
      // foco perdido no body: o Esc é dela, que só ouve o próprio teclado; a etapa por baixo fica.
      const modais = document.querySelectorAll('[aria-modal="true"]');
      if (Array.from(modais).some((m) => !raiz.contains(m))) return;
      if (ev.defaultPrevented) return;
      ev.preventDefault();
      voltarRef.current();
    };
    document.addEventListener("keydown", ouvir);
    return () => document.removeEventListener("keydown", ouvir);
  }, [estreita, aberto]);

  // As setas: chegando na primeira (ou na última) etapa, a seta apertada fica desabilitada com o foco
  // nela; o foco passa para a outra seta.
  const setaAnterior = useRef<HTMLButtonElement>(null);
  const setaProxima = useRef<HTMLButtonElement>(null);
  const irPara = (destinoId: string, outra: HTMLButtonElement | null) => {
    const j = etapas.findIndex((e) => e.id === destinoId);
    aoTrocarEtapa(destinoId);
    if (j === 0 || j === etapas.length - 1) {
      (outra ?? document.getElementById("kb-foco-voltar"))?.focus({ preventScroll: true });
    }
  };

  const tecla = (ev: KeyboardEvent<HTMLElement>) => {
    // O teclado de outro portal (a gaveta do lead, um menu) também sobe até aqui pela árvore do React:
    // só vale o que nasceu dentro da etapa.
    const raiz = ev.currentTarget;
    if (!(ev.target instanceof Node) || !raiz.contains(ev.target)) return;
    if (ev.key !== "Escape" || ev.defaultPrevented) return;
    ev.preventDefault();
    aoVoltar();
  };

  const nome = nomeDaEtapa(etapa);
  const n = lista.length;
  const filtrada = !!mostrar && n !== todas.length;

  const secao = (
    <section
      ref={raizRef}
      className={s.ecRaiz}
      aria-labelledby={idTitulo}
      onKeyDown={tecla}
      // Em tela cheia, a etapa é uma região comum (o dock e o botão da Janete, por cima, seguem
      // alcançáveis): o toque num espaço vazio deixa o foco nela, e o Esc dali continua valendo.
      {...(estreita ? { "data-tela-cheia": "", tabIndex: -1 } : {})}
    >
      <div className={s.ecCab}>
        <Botao
          id="kb-foco-voltar"
          className={s.ecVoltar}
          variante="contorno"
          tamanho="compacto"
          icone={<ArrowLeft size={16} strokeWidth={2} />}
          onClick={aoVoltar}
        >
          Voltar ao quadro
        </Botao>
        <h2 id={idTitulo} className={s.ecTitulo}>
          <i className={s.ecPonto} style={{ background: corDaEtapa(etapa) } as CSSProperties} aria-hidden="true" />
          <span>{nome}</span>
        </h2>
        <span className={s.ecConta}>
          {filtrada ? `${n} de ${todas.length}` : n} {(filtrada ? todas.length : n) === 1 ? "conversa" : "conversas"}
        </span>
        <div className={s.ecSetas}>
          <button
            ref={setaAnterior}
            type="button"
            className={s.ecSeta}
            aria-label={anterior ? `Etapa anterior: ${nomeDaEtapa(anterior)}` : "Etapa anterior"}
            disabled={!anterior}
            onClick={() => anterior && irPara(anterior.id, setaProxima.current)}
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            ref={setaProxima}
            type="button"
            className={s.ecSeta}
            aria-label={proxima ? `Próxima etapa: ${nomeDaEtapa(proxima)}` : "Próxima etapa"}
            disabled={!proxima}
            onClick={() => proxima && irPara(proxima.id, setaAnterior.current)}
          >
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <nav className={s.ecLista} aria-label="Conversas desta etapa">
        {quadroL.erro || etapasL.erro ? (
          <ErroLeitura
            compacto
            titulo="Não deu para carregar a etapa"
            erro={quadroL.erro ?? etapasL.erro}
            tentarDeNovo={() => {
              if (etapasL.erro) etapasL.tentarDeNovo();
              quadroL.tentarDeNovo();
            }}
          />
        ) : !quadroL.dados ? (
          <Carregando forma="lista" quantos={4} rotulo="Carregando as conversas da etapa" />
        ) : lista.length ? (
          lista.map(({ contato, conversa: cv, ultima }) => {
            const responsavel = cv.responsavel_id ? pessoas.membros.find((m) => m.id === cv.responsavel_id) : undefined;
            return (
              <LinhaConversa
                key={cv.id}
                conversa={cv}
                contato={contato}
                ultima={ultima}
                situacao={situacaoDe(cv, {
                  // a etapa já está no título: a linha não repete
                  etapa: null,
                  responsavel: responsavel ? { id: responsavel.id, nome: responsavel.nome } : null,
                  euId: eu.membro.id,
                  digitando: cv.modo === "janete" && !!trabalhando?.includes(cv.id),
                  // Só o exemplo guarda com quem a conversa estava quando voltou para a fila.
                  estavaCom: cv.estavaCom ? nomeDoMembro(pessoas, cv.estavaCom) || null : null,
                })}
                autorUltima={
                  ultima?.origem === "humano_tela" ? nomeDoMembro(pessoas, ultima.autor_membro_id) || undefined : undefined
                }
                selecionada={aberto === contato.id}
                aoAbrir={() => abrir(contato.id)}
                agora={agora}
                // a lista estreita do protótipo: 66 px por linha, sem a linha de situação
                compacta
              />
            );
          })
        ) : (
          <p className={s.ecVazio}>{filtrada ? "Nenhuma conversa desta etapa com essa busca ou filtro." : "Nenhuma conversa nesta etapa."}</p>
        )}
      </nav>

      {estreita ? (
        <GavetaLead contatoId={aberto} aoFechar={() => abrir(null)} />
      ) : (
        <div
          className={s.ecPainel}
          role="region"
          aria-label={lead ? `Conversa com ${nomeDoContato(lead.contato)}` : "Conversa"}
        >
          {lead && lead.conversa ? (
            <div className={g.glCorpo} data-encaixada="">
              {/* A conversa vem antes no código: o Tab segue a ordem que se vê (conversa, depois as infos). */}
              <ConversaLead
                contato={lead.contato}
                conversa={lead.conversa}
                agora={agora}
                adiarLida={abertoSozinho}
                aoInteragir={() => setAbertoSozinho(false)}
              />
              <InfoLead
                contato={lead.contato}
                conversa={lead.conversa}
                agora={agora}
                aoApagar={() => abrir(null)}
              />
            </div>
          ) : aberto && leitura.carregando ? (
            <Carregando forma="lista" quantos={4} rotulo="Carregando a conversa" />
          ) : aberto && leitura.erro ? (
            <ErroLeitura titulo="Não deu para abrir esta conversa" erro={leitura.erro} tentarDeNovo={leitura.tentarDeNovo} />
          ) : (
            <p className={s.ecEscolha}>
              {lista.length ? "Escolha uma conversa na lista." : `Quando um lead chegar em ${nome}, a conversa aparece aqui.`}
            </p>
          )}
        </div>
      )}
    </section>
  );

  return estreita ? <NoCorpo>{secao}</NoCorpo> : secao;
}
