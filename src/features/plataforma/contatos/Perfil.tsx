import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  Lightbulb,
  Mail,
  MessageCircle,
  MessageSquareText,
  Pencil,
  Phone,
  Smartphone,
  SquareKanban,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";
import { Botao, iniciais } from "@/components/aipro";
import { cx, type Classes } from "@/components/aipro/cx";

import { haQuanto } from "../chat/Ficha";
import { AvatarLead } from "../comum/AvatarLead";
import { nomeDoContato } from "../comum/LinhaConversa";
import { MenuSuspenso } from "../comum/MenuSuspenso";
import { esperaLonga, segundosDesde } from "../comum/tempo";
import { usePerfilContato } from "../dados/contatos";
import { useCustoConversas } from "../dados/conversa";
import { ErroLeitura } from "../dados/estados";
import { useDados } from "../dados/ProvedorDados";
import { conversaDoContato, etapasVisiveis, mensagensDaConversa, telefoneLegivel } from "../exemplo";
import { AbaConversa } from "./AbaConversa";
import { AbaFicha } from "./AbaFicha";
import { AbaLinha } from "./AbaLinha";
import { AbaMidias } from "./AbaMidias";
import { AbaResumo } from "./AbaResumo";
import { acontecimentos, midiasDoContato, proximoPassoDoContato, quemAtende } from "./dados";
import { DialogoApagar } from "./DialogoApagar";
import { idTituloPerfil } from "./ids";
import { EstadoDaAba, PontoEtapa, esperaEhLonga, estaEsperando, type EtapaDoPonto } from "./pecas";
import { textoDaRecusa } from "./recusas";
import type { AbaPerfil, EstadoContatos, PropsAba, QuemAtende } from "./tipos";
import estilos from "./Perfil.module.css";

// O perfil do contato (task C2 de docs/spec-contatos.md): o "← Contatos", o cabeçalho do Contatos 4
// (avatar, nome, dados e as 5 ações), a barra de abas e a coluna da direita (Quem atende e Próximo
// passo). O corpo de cada aba é de outro arquivo; aqui fica só a fiação entre elas (ir para a
// Conversa numa mensagem, abrir a Ficha em edição, o "Responder" com o cursor na caixa).
//
// Menos poluído que o 4 (decisão 5 do equipe): cartões brancos, as ações todas no mesmo tom neutro e a
// cor só na bolinha da etapa, na de "ao vivo" e num ícone. O foco vai para o h1 quando o perfil abre:
// quem foca é a TelaContatos.

const s = estilos as Classes<
  | "pfRaiz"
  | "pfVoltar"
  | "pfCab"
  | "pfFoto"
  | "pfId"
  | "pfNome"
  | "pfDados"
  | "pfDado"
  | "pfDadoTexto"
  | "pfVazio"
  | "pfIcone"
  | "pfAcoes"
  | "pfAcao"
  | "pfAcaoCirculo"
  | "pfAcaoRotulo"
  | "pfMover"
  | "pfAbas"
  | "pfAba"
  | "pfAbaN"
  | "pfCorpo"
  | "pfLado"
  | "pfCartao"
  | "pfQuem"
  | "pfQuemSimbolo"
  | "pfQuemTexto"
  | "pfCinza"
  | "pfQuemNome"
  | "pfVivo"
  | "pfVivoPonto"
  | "pfLinhaEtapa"
  | "pfCusto"
  | "pfCustoValor"
  | "pfCustoNada"
  | "pfPassoCab"
  | "pfPassoIcone"
  | "pfPassoTitulo"
  | "pfPassoTexto"
  | "pfSr"
>;

interface Props {
  contatoId: string;
  agora: number;
  aoVoltar(): void;
  aoApagado(nome: string): void;
  avisar(texto: string): void;
}

const ABAS: readonly { id: AbaPerfil; rotulo: string }[] = [
  { id: "resumo", rotulo: "Resumo" },
  { id: "conversa", rotulo: "Conversa" },
  { id: "linha", rotulo: "Linha do tempo" },
  { id: "midias", rotulo: "Mídias" },
  { id: "ficha", rotulo: "Ficha" },
];

/** O custo de IA em dólar, como o Chat e o Kanban mostram ("US$ 1,86"). */
const DOLAR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

/** O primeiro nome, para os textos curtos ("Juliana foi para Qualificado"). */
const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

/** Mensagens que contam para a aba e para o diálogo: as canceladas nunca saíram, então não entram. */
function quantasMensagens(estado: EstadoContatos, conversaId: string | undefined): number {
  if (!conversaId) return 0;
  return mensagensDaConversa(estado, conversaId).filter((m) => m.status !== "cancelada").length;
}

export function PerfilContato({ contatoId, agora, aoVoltar, aoApagado, avisar }: Props) {
  const perfil = usePerfilContato(contatoId);
  const estado = perfil.dados;
  const { useEu, acoes } = useDados();
  const { ehAdmin: admin } = useEu();
  const navigate = useNavigate();
  const base = useId();
  // O custo de IA da conversa, só para o admin (o atendente recebe {} sem ir ao banco).
  const conversaDoCusto = estado ? conversaDoContato(estado, contatoId) : undefined;
  const custos = useCustoConversas(admin && conversaDoCusto ? [conversaDoCusto.id] : []);
  const [apagandoAgora, setApagandoAgora] = useState(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const [aba, setAba] = useState<AbaPerfil>("resumo");
  const [mensagemAlvo, setMensagemAlvo] = useState<string | null>(null);
  const [focarCaixa, setFocarCaixa] = useState(false);
  const [editando, setEditando] = useState(false);
  const [apagando, setApagando] = useState(false);

  // A aba começa em Resumo a cada contato aberto. A TelaContatos já remonta o perfil por contato
  // (key); isto cobre quem trocar o contatoId sem remontar.
  const [abertoPara, setAbertoPara] = useState(contatoId);
  if (abertoPara !== contatoId) {
    setAbertoPara(contatoId);
    setAba("resumo");
    setMensagemAlvo(null);
    setFocarCaixa(false);
    setEditando(false);
    setApagando(false);
  }

  const refsAbas = useRef(new Map<AbaPerfil, HTMLButtonElement>());
  const refBarra = useRef<HTMLDivElement>(null);
  const botaoApagar = useRef<HTMLButtonElement>(null);

  // A cada troca de aba, a barra de abas rola para o lado até a ativa, quando ela não cabe inteira (no
  // celular, Mídias e Ficha ficavam fora da vista, por exemplo pelo "Editar" do cabeçalho). Só na
  // horizontal: a página não se mexe ao trocar de aba (o equipe pediu, em 31/10, para tirar a âncora
  // que levava a página até a Conversa; quem faz a conversa caber na janela é a própria AbaConversa).
  useEffect(() => {
    const barra = refBarra.current;
    const el = refsAbas.current.get(aba);
    if (barra && el && barra.scrollWidth > barra.clientWidth) {
      barra.scrollLeft += el.getBoundingClientRect().left - barra.getBoundingClientRect().left - 16;
    }
  }, [aba]);
  // Fechar o diálogo devolve o foco ao "Apagar contato" (depois do render que o tira da tela).
  const voltarFocoApagar = useRef(false);
  useEffect(() => {
    if (apagando || !voltarFocoApagar.current) return;
    voltarFocoApagar.current = false;
    botaoApagar.current?.focus();
  }, [apagando]);

  // Carregando ou com erro de leitura: o "← Contatos" e o estado (o esqueleto, ou o aviso com
  // "Tentar de novo").
  if (!estado) {
    return (
      <article className={s.pfRaiz} aria-busy={perfil.carregando || undefined} aria-labelledby={idTituloPerfil(contatoId)}>
        <button type="button" className={s.pfVoltar} onClick={aoVoltar}>
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
          <span>
            <span className={s.pfSr}>Voltar para </span>
            Contatos
          </span>
        </button>
        <h1 id={idTituloPerfil(contatoId)} tabIndex={-1} className={s.pfSr}>
          Contato
        </h1>
        <EstadoDaAba leitura={perfil} />
      </article>
    );
  }

  const contato = estado.contatos.find((c) => c.id === contatoId);
  // Apagado agora há pouco: a TelaContatos já está voltando para a tabela.
  if (!contato) return null;

  const nome = nomeDoContato(contato);
  const primeiro = primeiroNome(nome);
  const conversa = conversaDoContato(estado, contatoId);
  const quem = quemAtende(estado, conversa, agora);
  const etapas = etapasVisiveis(estado);
  const etapa = estado.etapas.find((e) => e.id === contato.etapa_id);
  const passo = proximoPassoDoContato(contato);
  // No banco, o total vem contado (as páginas de mensagens só trazem as mais recentes).
  const nMensagens = perfil.totalMensagens ?? quantasMensagens(estado, conversa?.id);
  const custoUsd = conversa ? custos.dados?.[conversa.id] : undefined;
  const nAcontecimentos = acontecimentos(estado, contatoId).length;
  const nMidias = midiasDoContato(estado, contatoId).length;
  const contagem: Partial<Record<AbaPerfil, { n: number; sr: string }>> = {
    conversa: { n: nMensagens, sr: nMensagens === 1 ? "mensagem" : "mensagens" },
    linha: { n: nAcontecimentos, sr: nAcontecimentos === 1 ? "acontecimento" : "acontecimentos" },
    midias: { n: nMidias, sr: nMidias === 1 ? "mídia" : "mídias" },
  };

  /* ---------- as abas ---------- */

  // Trocar de aba pela barra (ou por outra aba) começa limpo: sem mensagem destacada, sem o foco na
  // caixa e sem a Ficha em edição, que só o "Editar" abre.
  const irParaAba = (destino: AbaPerfil) => {
    setAba(destino);
    setMensagemAlvo(null);
    setFocarCaixa(false);
    setEditando(false);
  };

  const verNaConversa = (mensagemId: string) => {
    irParaAba("conversa");
    setMensagemAlvo(mensagemId);
  };

  // Com a Conversa já aberta (a partir de 1200 px o "Responder" segue à vista), o focarCaixa não muda
  // de valor e o efeito da AbaConversa não roda de novo: aí o foco vai direto para a caixa.
  const responder = () => {
    if (aba === "conversa") {
      document.getElementById(idPainel)?.querySelector("textarea")?.focus();
      return;
    }
    irParaAba("conversa");
    setFocarCaixa(true);
  };

  const editar = () => {
    irParaAba("ficha");
    setEditando(true);
  };

  // As setas andam em círculo pela barra, Home e End vão às pontas (padrão "tabs" do WAI-ARIA, com a
  // aba ativando ao receber o foco).
  const teclaAbas = (ev: KeyboardEvent<HTMLDivElement>) => {
    const i = ABAS.findIndex((a) => a.id === aba);
    let j: number;
    if (ev.key === "ArrowRight") j = (i + 1) % ABAS.length;
    else if (ev.key === "ArrowLeft") j = (i - 1 + ABAS.length) % ABAS.length;
    else if (ev.key === "Home") j = 0;
    else if (ev.key === "End") j = ABAS.length - 1;
    else return;
    ev.preventDefault();
    const destino = ABAS[j]!.id;
    irParaAba(destino);
    refsAbas.current.get(destino)?.focus();
  };

  const props: PropsAba = { contatoId, agora, irParaAba, verNaConversa, avisar };
  const idAba = (a: AbaPerfil) => `${base}-aba-${a}`;
  const idPainel = `${base}-painel`;

  /* ---------- as ações ---------- */

  const abrirNoChat = () => {
    if (!conversa) return;
    void navigate({ to: "/app/chat", search: { conversa: conversa.id } });
  };

  const verNoKanban = () => {
    void navigate({ to: "/app/kanban", search: { contato: contatoId } });
  };

  const mover = (etapaId: string) => {
    // A etapa atual está marcada no menu e não faz nada.
    if (etapaId === contato.etapa_id) return;
    const destino = etapas.find((e) => e.id === etapaId);
    void acoes.moverEtapa(contatoId, etapaId).then((r) => {
      if (!vivo.current) return;
      if (r.ok && destino) avisar(`${primeiro} foi para ${destino.nome}`);
      else if (!r.ok) avisar(textoDaRecusa(r.erro, "mover"));
    });
  };

  const cancelarApagar = () => {
    if (apagandoAgora) return;
    voltarFocoApagar.current = true;
    setApagando(false);
  };

  // Apagar vai ao servidor (apaga as mídias do bucket e depois o contato, e grava na auditoria o nome
  // dele, decisão 12). Enquanto isso, o diálogo espera, com os botões travados.
  const confirmarApagar = async () => {
    if (apagandoAgora) return;
    setApagandoAgora(true);
    const r = await acoes.apagarContato(contatoId);
    if (!vivo.current) return;
    setApagandoAgora(false);
    if (r.ok) {
      setApagando(false);
      aoApagado(nome);
      return;
    }
    voltarFocoApagar.current = true;
    setApagando(false);
    avisar(textoDaRecusa(r.erro, "apagar"));
  };

  /* ---------- o desenho ---------- */

  const empresa = contato.empresa?.trim() ?? "";
  const email = contato.email?.trim() ?? "";
  const telefone = telefoneLegivel(contato.telefone);
  const nomeWhatsapp = contato.nome_whatsapp?.trim() ?? "";

  return (
    <article className={s.pfRaiz} data-aba={aba} aria-labelledby={idTituloPerfil(contatoId)}>
      <button type="button" className={s.pfVoltar} onClick={aoVoltar}>
        <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
        {/* "Voltar para Contatos" para o leitor de tela: o link Contatos do menu tem o mesmo nome. */}
        <span>
          <span className={s.pfSr}>Voltar para </span>
          Contatos
        </span>
      </button>

      {/* Com o perfil na tela, a releitura que falhou (qualquer uma das leituras) vira um aviso, e ele fica. */}
      {perfil.erro ? (
        <ErroLeitura erro={perfil.erro} tentarDeNovo={perfil.tentarDeNovo} titulo="Não deu para atualizar o contato" compacto />
      ) : null}

      <header className={s.pfCab}>
        <AvatarLead nome={nome} chave={contato.id} tamanho="g" className={s.pfFoto} />
        <div className={s.pfId}>
          <h1 id={idTituloPerfil(contatoId)} tabIndex={-1} className={s.pfNome} title={nome}>
            {nome}
          </h1>
          <p className={s.pfDados}>
            <Dado icone={<Building2 size={15} strokeWidth={2} />} rotulo="Empresa" vazio="Empresa não informada">
              {empresa}
            </Dado>
            <Dado icone={<Phone size={15} strokeWidth={2} />} rotulo="Telefone" vazio="Telefone não informado">
              {telefone}
            </Dado>
            <Dado icone={<Mail size={15} strokeWidth={2} />} rotulo="E-mail" vazio="E-mail não informado">
              {email}
            </Dado>
          </p>
          {nomeWhatsapp ? (
            <p className={s.pfDados}>
              <span className={s.pfDado}>
                <MessageCircle className={s.pfIcone} size={15} strokeWidth={2} aria-hidden="true" />
                <span className={s.pfDadoTexto}>{`No WhatsApp: ${nomeWhatsapp}`}</span>
              </span>
            </p>
          ) : null}
        </div>

        <div className={s.pfAcoes} role="group" aria-label={`Ações para ${nome}`}>
          <Acao icone={<MessageSquareText size={16} strokeWidth={2} />} rotulo="Abrir no Chat" onClick={abrirNoChat} desabilitado={!conversa} />
          <Acao icone={<SquareKanban size={16} strokeWidth={2} />} rotulo="Ver no Kanban" onClick={verNoKanban} />
          <MenuSuspenso
            rotulo="Mover para…"
            titulo="Mover para"
            // Só o nome, como no Chat e no Kanban: o ✓ e o aria-checked já marcam a atual.
            itens={etapas.map((e) => ({ id: e.id, texto: e.nome }))}
            valor={contato.etapa_id}
            aoEscolher={mover}
            iconeTexto={<ArrowRight size={16} strokeWidth={2} />}
            className={s.pfMover}
          />
          <Acao icone={<Pencil size={16} strokeWidth={2} />} rotulo="Editar" onClick={editar} />
          {admin ? (
            <Acao
              ref={botaoApagar}
              icone={<Trash2 size={16} strokeWidth={2} />}
              rotulo="Apagar contato"
              onClick={() => setApagando(true)}
            />
          ) : null}
        </div>
      </header>

      <div ref={refBarra} className={s.pfAbas} role="tablist" aria-label="Partes do perfil" onKeyDown={teclaAbas}>
        {ABAS.map((a) => {
          const ativa = aba === a.id;
          const c = contagem[a.id];
          return (
            <button
              key={a.id}
              ref={(el) => {
                if (el) refsAbas.current.set(a.id, el);
                else refsAbas.current.delete(a.id);
              }}
              id={idAba(a.id)}
              type="button"
              role="tab"
              className={s.pfAba}
              aria-selected={ativa}
              aria-controls={idPainel}
              tabIndex={ativa ? 0 : -1}
              onClick={() => irParaAba(a.id)}
            >
              {a.rotulo}
              {c ? (
                <>
                  <span className={s.pfAbaN} aria-hidden="true">
                    {c.n}
                  </span>
                  <span className={s.pfSr}>{`, ${c.n} ${c.sr}`}</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>

      <div id={idPainel} className={s.pfCorpo} role="tabpanel" aria-labelledby={idAba(aba)}>
        {aba === "resumo" ? <AbaResumo {...props} /> : null}
        {aba === "conversa" ? <AbaConversa {...props} mensagemAlvo={mensagemAlvo} focarCaixa={focarCaixa} /> : null}
        {aba === "linha" ? <AbaLinha {...props} /> : null}
        {aba === "midias" ? <AbaMidias {...props} /> : null}
        {aba === "ficha" ? <AbaFicha {...props} editando={editando} aoEditar={setEditando} /> : null}
      </div>

      {/* A coluna da direita (a partir de 1200 px); abaixo disso, o CSS a põe no alto do Resumo. */}
      <aside className={s.pfLado} aria-label={`Atendimento de ${primeiro}`}>
        <CartaoQuem
          quem={quem}
          estado={estado}
          etapa={etapa}
          desde={contato.etapa_desde}
          agora={agora}
          // O banco devolve 0 para a conversa sem gasto: "Nenhum gasto registrado", como no exemplo.
          custo={admin && conversa ? { valor: custoUsd && custoUsd > 0 ? custoUsd : null, carregando: custos.carregando } : null}
        />
        {passo ? (
          <section className={s.pfCartao} aria-labelledby={`${base}-passo`}>
            <p className={s.pfPassoCab}>
              <Lightbulb className={s.pfPassoIcone} size={16} strokeWidth={2} aria-hidden="true" />
              <span id={`${base}-passo`}>Próximo passo</span>
              <span className={s.pfCinza}>sugestão da Janete</span>
            </p>
            <h2 className={s.pfPassoTitulo}>{passo.titulo}</h2>
            <p className={s.pfPassoTexto}>{passo.texto}</p>
            <Botao variante="contorno" tamanho="compacto" largo onClick={responder}>
              Responder
            </Botao>
          </section>
        ) : null}
      </aside>

      {apagando && admin ? (
        <DialogoApagar
          nome={nome}
          mensagens={nMensagens}
          midias={nMidias}
          aoCancelar={cancelarApagar}
          aoConfirmar={() => void confirmarApagar()}
          apagando={apagandoAgora}
        />
      ) : null}
    </article>
  );
}

/* ---------- peças do cabeçalho ---------- */

/** Um dado do cabeçalho (empresa, telefone, e-mail): ícone pequeno e o valor; vazio vira o aviso em cinza. */
function Dado({ icone, rotulo, vazio, children }: { icone: ReactNode; rotulo: string; vazio: string; children: string }) {
  const tem = children !== "";
  return (
    <span className={s.pfDado}>
      <span className={s.pfIcone} aria-hidden="true">
        {icone}
      </span>
      <span className={s.pfSr}>{`${rotulo}: `}</span>
      <span className={cx(s.pfDadoTexto, !tem && s.pfVazio)} title={tem ? children : undefined}>
        {tem ? children : vazio}
      </span>
    </span>
  );
}

/** Uma ação do cabeçalho: a bolinha com o ícone e o rótulo embaixo, todas no mesmo tom. */
function Acao({
  icone,
  rotulo,
  onClick,
  desabilitado = false,
  ref,
}: {
  icone: ReactNode;
  rotulo: string;
  onClick: () => void;
  desabilitado?: boolean | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}) {
  return (
    <button ref={ref} type="button" className={s.pfAcao} onClick={onClick} disabled={desabilitado}>
      <span className={s.pfAcaoCirculo} aria-hidden="true">
        {icone}
      </span>
      <span className={s.pfAcaoRotulo}>{rotulo}</span>
    </button>
  );
}

/* ---------- a coluna da direita ---------- */

/** O ícone de quem atende quando não é a Janete nem uma pessoa da equipe. */
function IconeQuem({ tipo }: { tipo: QuemAtende["tipo"] }) {
  if (tipo === "celular") return <Smartphone size={16} strokeWidth={2} />;
  if (tipo === "falha") return <TriangleAlert size={16} strokeWidth={2} />;
  return <Bell size={16} strokeWidth={2} />;
}

/**
 * O "Quem atende", pequeno e sem botão (assumir e devolver ficam na aba Conversa): o símbolo da Janete
 * ou as iniciais de quem atende, o nome, a bolinha de ao vivo no canto, a etapa e, só para o admin, o
 * custo de IA da conversa.
 */
function CartaoQuem({
  quem,
  estado,
  etapa,
  desde,
  agora,
  custo,
}: {
  quem: QuemAtende;
  estado: EstadoContatos;
  etapa: EtapaDoPonto | undefined;
  desde: string | null;
  agora: number;
  custo: { valor: number | null; carregando?: boolean | undefined } | null;
}) {
  const membro = quem.membroId ? estado.membros.find((m) => m.id === quem.membroId) : undefined;
  // Quem olha é "VC", como no Chat, no Kanban e na aba Conversa.
  const sigla = quem.membroId && quem.membroId === estado.eu.id ? "VC" : iniciais(membro?.nome ?? quem.nome);
  // Na espera, o tempo vai numa linha cinza embaixo do nome (a linha da aba Conversa some a partir de
  // 1200 px, e o tempo não pode sumir junto). A cor fica só no ícone, com a régua dos 10 min.
  const esperando = estaEsperando(quem);
  const espera = esperando && quem.esperaDesde ? esperaLonga(segundosDesde(quem.esperaDesde, agora)) : "";
  return (
    <section className={s.pfCartao} aria-label="Quem atende">
      {quem.aoVivo ? (
        <span className={s.pfVivo} title="Ao vivo: a Janete está conversando agora">
          <i className={s.pfVivoPonto} aria-hidden="true" />
          <span className={s.pfSr}>Ao vivo: a Janete está conversando agora</span>
        </span>
      ) : null}
      <div className={s.pfQuem}>
        <span
          className={s.pfQuemSimbolo}
          data-tipo={quem.tipo}
          data-longa={esperaEhLonga(quem, agora) ? "" : undefined}
          aria-hidden="true"
        >
          {quem.tipo === "janete" ? (
            <JaneteSimbolo estado="acordada" tamanho={36} decorativo />
          ) : quem.tipo === "membro" ? (
            sigla
          ) : (
            <IconeQuem tipo={quem.tipo} />
          )}
        </span>
        <span className={s.pfQuemTexto}>
          <span className={s.pfCinza}>Quem atende</span>
          <b className={s.pfQuemNome} data-tipo={quem.tipo}>
            {quem.nome}
          </b>
          {espera ? <span className={s.pfCinza}>{`há ${espera}`}</span> : null}
        </span>
      </div>
      {etapa ? (
        <p className={s.pfLinhaEtapa}>
          <PontoEtapa etapa={etapa} />
          {desde ? <span className={s.pfCinza}>{haQuanto(desde, agora)}</span> : null}
        </p>
      ) : null}
      {custo ? (
        <p className={s.pfCusto}>
          <span>Custo de IA</span>
          {custo.carregando ? (
            <span className={s.pfCustoNada}>Carregando…</span>
          ) : custo.valor === null ? (
            <span className={s.pfCustoNada}>Nenhum gasto registrado</span>
          ) : (
            <b className={s.pfCustoValor}>{DOLAR.format(custo.valor)}</b>
          )}
        </p>
      ) : null}
    </section>
  );
}
