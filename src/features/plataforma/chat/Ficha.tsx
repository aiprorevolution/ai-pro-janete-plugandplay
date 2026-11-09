import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { Building2, MessageCircle, SquareKanban, Mail, Pencil, Phone, Trash2, UserRound, X } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { nomeDoContato } from "../comum/LinhaConversa";
import { MenuSuspenso } from "../comum/MenuSuspenso";
import { erroDeReleitura, erroSemDados } from "../comum/releitura";
import { dataCurta, diasEntre, horaCurta, rotuloDia, segundosDesde, type Instante } from "../comum/tempo";
import { useContato, useConversa, useCustoConversas, useHistoricoContato } from "../dados/conversa";
import { Carregando, ErroLeitura } from "../dados/estados";
import { useDados } from "../dados/ProvedorDados";
import {
  etapasVisiveis,
  nomeDoMembro,
  telefoneLegivel,
  type CamposContato,
  type HistoricoEtapa,
  type Membro,
} from "../exemplo";
import { textoDoErroChat, type Avisar } from "./aviso";
import estilos from "./Ficha.module.css";

const s = estilos as Classes<
  | "fcFicha"
  | "fcCab"
  | "fcCabTit"
  | "fcFechar"
  | "fcRolo"
  | "fcMeta"
  | "fcLapis"
  | "fcResumo"
  | "fcRnCab"
  | "fcRnTit"
  | "fcRnTexto"
  | "fcRnVazio"
  | "fcSec"
  | "fcSecTit"
  | "fcSit"
  | "fcEtapaAtual"
  | "fcEtapaNome"
  | "fcBarra"
  | "fcBarraCheia"
  | "fcMover"
  | "fcMoverMenu"
  | "fcCampos"
  | "fcCampo"
  | "fcCampoIcone"
  | "fcCampoV"
  | "fcCampoRot"
  | "fcCampoValor"
  | "fcEd"
  | "fcEdRot"
  | "fcEdCampo"
  | "fcEdErro"
  | "fcEdAcoes"
  | "fcBtn"
  | "fcBtnPri"
  | "fcBtnDisc"
  | "fcBtnCont"
  | "fcBtnPerigo"
  | "fcBtnPerigoCheio"
  | "fcObs"
  | "fcObsPe"
  | "fcHist"
  | "fcHistPonto"
  | "fcHistEtapa"
  | "fcHistPor"
  | "fcAcoes"
  | "fcVeu"
  | "fcDialogo"
  | "fcDialogoTit"
  | "fcDialogoTexto"
  | "fcDialogoAcoes"
  | "fcSr"
>;

// A coluna 3 do Chat: a ficha do lead. De cima para baixo (rodada 2, sem a foto e o nome no topo: o nome
// já está no cabeçalho da conversa): o que a Janete já descobriu, em destaque; o atendimento (primeira
// mensagem, devolução à Janete e, só para o admin, o custo de IA); a etapa numa linha, com a barra e
// "Mover para…"; o contato (nome editável, nome no WhatsApp, telefone, empresa e e-mail); as
// observações; o histórico de etapas; e as ações (Ver no Kanban e, só para o admin, Apagar contato).
// Lê e muda pela camada de dados (useDados e dados/conversa.ts): o contato, a etapa, o histórico e,
// só para o admin, o custo de IA da conversa (custo_das_conversas, com a transcrição e a fala).

/* ---------- tempo, no fuso de São Paulo (comum/tempo) ---------- */

/** "hoje, 14:28", "ontem, 18:11", "segunda, 11:20" (até 6 dias) ou "26/10, 11:20". */
export function quandoCurto(iso: Instante, agora: Instante): string {
  const dias = diasEntre(iso, agora);
  if (Number.isNaN(dias)) return "";
  const hora = horaCurta(iso);
  if (dias <= 0) return `hoje, ${hora}`;
  if (dias === 1) return `ontem, ${hora}`;
  if (dias < 7) return `${rotuloDia(iso, agora).split(",")[0]!.toLowerCase()}, ${hora}`;
  return `${dataCurta(iso)}, ${hora}`;
}

/** Há quanto tempo, pelo relógio: "agora", "há 16 min", "há 3 h", "há 1 dia", "há 3 dias". */
export function haQuanto(iso: Instante, agora: Instante): string {
  const seg = segundosDesde(iso, agora);
  if (seg < 60) return "agora";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

const DOLAR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

/** O e-mail com um ponto de quebra preferido logo depois do "@" (a quebra em qualquer ponto fica de reserva). */
function comQuebraNoArroba(email: string): ReactNode {
  const i = email.indexOf("@");
  if (i < 0) return email;
  return (
    <>
      {email.slice(0, i + 1)}
      <wbr />
      {email.slice(i + 1)}
    </>
  );
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Quem moveu, do ponto de vista de quem olha: "pela Janete", "pelo sistema", "por você", "por Marina". */
function quemMoveu(estado: { membros: Membro[]; eu: Membro }, h: HistoricoEtapa): string {
  if (h.ator === "janete") return "pela Janete";
  if (h.ator === "sistema") return "pelo sistema";
  if (h.membro_id === estado.eu.id) return "por você";
  return `por ${nomeDoMembro(estado, h.membro_id) || "alguém da equipe"}`;
}

/* ---------- a ficha ---------- */

type CampoEditavel = "nome" | "empresa" | "email";

type Props = {
  conversaId: string;
  /** Coluna da grade (computador) ou dentro da gaveta e da folha (tela média e celular). */
  modo: "coluna" | "gaveta";
  aoFechar: () => void;
  /** O contato foi apagado (a TelaChat abre a próxima conversa e avisa). */
  aoApagado: (nome: string) => void;
  /** O aviso curto da tela ("Dados do lead salvos."). */
  avisar: Avisar;
  /** O relógio comum da tela. */
  agora: number;
  className?: string | undefined;
};

export function Ficha({ conversaId, modo, aoFechar, aoApagado, avisar, agora, className }: Props) {
  const dados = useDados();
  const { acoes } = dados;
  const { membro: eu, ehAdmin: admin } = dados.useEu();
  const membrosDados = dados.useMembros().dados;
  const etapasL = dados.useEtapas();
  const convL = useConversa(conversaId);
  const conversa = convL.dados ?? undefined;
  const contatoL = useContato(conversa?.contato_id);
  const contato = contatoL.dados ?? undefined;
  const historicoL = useHistoricoContato(conversa?.contato_id);
  const idsCusto = useMemo(() => [conversaId], [conversaId]);
  // O custo é só do admin: para o atendente, a leitura nem vai ao banco.
  const custoL = useCustoConversas(idsCusto);
  const navigate = useNavigate();
  const base = useId();
  const idTitulo = `${base}-titulo`;

  const [editando, setEditando] = useState<CampoEditavel | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState("");
  const [obs, setObs] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [apagando, setApagando] = useState(false);
  const focoDepois = useRef<string | null>(null);

  // Depois de salvar ou cancelar, o foco volta ao lápis do campo (o elemento só existe no render seguinte).
  useEffect(() => {
    if (!focoDepois.current) return;
    document.getElementById(focoDepois.current)?.focus();
    focoDepois.current = null;
  });

  const cabecalho = (
    <div className={s.fcCab}>
      <h2 className={s.fcCabTit} id={idTitulo}>
        Ficha do lead
      </h2>
      <button type="button" className={s.fcFechar} aria-label="Fechar a ficha do lead" onClick={aoFechar} data-autofocus="">
        <X size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );

  // Os 3 estados: carregando, erro com "Tentar de novo" e a conversa que não existe mais (nada).
  if (convL.carregando || (conversa && contatoL.carregando)) {
    return (
      <div className={cx(s.fcFicha, className)} data-modo={modo}>
        {cabecalho}
        <div className={s.fcRolo}>
          <Carregando forma="texto" quantos={6} rotulo="Carregando a ficha do lead" />
        </div>
      </div>
    );
  }
  // Só sem os dados o erro toma a ficha; com ela na tela, a releitura que falhou vira um aviso no alto.
  const erroLeitura = erroSemDados(convL) ?? (conversa ? erroSemDados(contatoL) : null);
  const erroReleitura = erroDeReleitura(convL) ?? erroDeReleitura(contatoL);
  if (erroLeitura) {
    return (
      <div className={cx(s.fcFicha, className)} data-modo={modo}>
        {cabecalho}
        <div className={s.fcRolo}>
          <ErroLeitura
            erro={erroLeitura}
            titulo="Não deu para carregar a ficha"
            tentarDeNovo={() => {
              convL.tentarDeNovo();
              contatoL.tentarDeNovo();
            }}
            compacto
          />
        </div>
      </div>
    );
  }
  if (!conversa || !contato) return null;

  const estado = { membros: [...(membrosDados ?? [])], eu };
  const todasEtapas = etapasL.dados ?? [];
  const nome = nomeDoContato(contato);
  const etapas = etapasVisiveis({ etapas: todasEtapas });
  const etapa = etapas.find((e) => e.id === contato.etapa_id) ?? todasEtapas.find((e) => e.id === contato.etapa_id);
  const idLapis = (campo: CampoEditavel) => `${base}-editar-${campo}`;
  const idEd = `${base}-campo-ed`;

  /* ---- edição dos campos ---- */

  const editar = (campo: CampoEditavel) => {
    setEditando(campo);
    setRascunho((campo === "nome" ? contato.nome : contato[campo]) ?? "");
    setErro("");
  };

  const cancelar = () => {
    if (editando) focoDepois.current = idLapis(editando);
    setEditando(null);
    setErro("");
  };

  const salvar = () => {
    if (!editando) return;
    const v = rascunho.trim();
    if (editando === "nome" && !v) {
      setErro("O nome não pode ficar vazio.");
      return;
    }
    if (editando === "email" && v && !EMAIL.test(v)) {
      setErro("Esse e-mail parece incompleto. Confira e salve de novo.");
      return;
    }
    const campo = editando;
    const campos: CamposContato = { [campo]: v };
    void acoes.editarContato(contato.id, campos).then((r) => {
      if (!r.ok) {
        setErro(textoDoErroChat(r.erro, "salvar"));
        return;
      }
      focoDepois.current = idLapis(campo);
      setEditando((atual) => (atual === campo ? null : atual));
      setErro("");
      avisar("Dados do lead salvos.");
    });
  };

  const teclaCampo = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      salvar();
    } else if (ev.key === "Escape") {
      // Não deixa a gaveta fechar junto: o Esc aqui só cancela a edição.
      ev.preventDefault();
      ev.stopPropagation();
      cancelar();
    }
  };

  const editor = (rotulo: string, tipo: "text" | "email", extra?: ReactNode) => (
    <div className={s.fcEd}>
      <label htmlFor={idEd} className={s.fcEdRot}>
        {rotulo}
      </label>
      <input
        id={idEd}
        type={tipo}
        className={s.fcEdCampo}
        value={rascunho}
        autoComplete="off"
        autoFocus
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${idEd}-erro` : undefined}
        onChange={(ev) => {
          setRascunho(ev.target.value);
          if (erro) setErro("");
        }}
        onKeyDown={teclaCampo}
      />
      {erro ? (
        <p id={`${idEd}-erro`} className={s.fcEdErro} role="alert">
          {erro}
        </p>
      ) : null}
      {extra}
      <div className={s.fcEdAcoes}>
        <button type="button" className={cx(s.fcBtn, s.fcBtnDisc)} onClick={cancelar}>
          Cancelar
        </button>
        <button type="button" className={cx(s.fcBtn, s.fcBtnPri)} onClick={salvar}>
          Salvar
        </button>
      </div>
    </div>
  );

  /* ---- atendimento ---- */

  const linhas: { rot: string; valor: string }[] = [];
  if (contato.primeira_mensagem_em) {
    const p = contato.primeira_mensagem_em;
    linhas.push({ rot: "Primeira mensagem", valor: `${dataCurta(p, true)} às ${horaCurta(p)}` });
  }
  if (conversa.devolvida_em && conversa.modo === "janete") {
    linhas.push({ rot: "Devolvida à Janete", valor: quandoCurto(conversa.devolvida_em, agora) });
  }
  if (admin) {
    // custo_das_conversas soma as respostas da Janete, as transcrições e a fala; a conversa sem gasto vem com 0.
    const custo = custoL.dados?.[conversa.id];
    linhas.push({
      rot: "Custo de IA",
      valor: custoL.carregando
        ? "Calculando…"
        : custoL.erro
          ? "Não deu para calcular agora"
          : !custo
            ? "Nenhum gasto registrado"
            : `${DOLAR.format(custo)} nesta conversa`,
    });
  }

  /* ---- etapa ---- */

  const abertas = etapas.filter((e) => e.tipo === "aberta");
  const finais = etapas.filter((e) => e.tipo !== "aberta");
  const fechado = !!etapa && etapa.tipo !== "aberta";
  const indice = etapa ? abertas.findIndex((e) => e.id === etapa.id) : -1;
  const segmentos = abertas.length + (finais.length ? 1 : 0);
  const desdeEtapa = contato.etapa_desde;
  const haEtapa = desdeEtapa ? haQuanto(desdeEtapa, agora) : "";

  const mover = (etapaId: string) => {
    if (etapaId === contato.etapa_id) return;
    const destino = etapas.find((e) => e.id === etapaId);
    void acoes.moverEtapa(contato.id, etapaId).then((r) => {
      if (r.ok && destino) avisar(`${primeiroNome(nome)} foi para ${destino.nome}.`);
      else if (!r.ok) avisar(textoDoErroChat(r.erro, "mover"), "erro");
    });
  };

  /* ---- contato ---- */

  // O nome no WhatsApp e o telefone vêm do WhatsApp: o banco não deixa a equipe trocar (CamposContato).
  const campos: {
    campo: CampoEditavel | null;
    rot: string;
    icone: ReactNode;
    valor: string;
    tipo: "text" | "email";
    /** Para o leitor de tela, nos campos só de leitura. */
    nota?: string;
    /** Valor que pode ser longo (empresa, e-mail): quebra em até 2 linhas antes das reticências. */
    quebra?: boolean;
  }[] = [
    { campo: "nome", rot: "Nome", icone: <UserRound size={16} strokeWidth={2} />, valor: contato.nome?.trim() ?? "", tipo: "text" },
    {
      campo: null,
      rot: "Nome no WhatsApp",
      icone: <MessageCircle size={16} strokeWidth={2} />,
      valor: contato.nome_whatsapp?.trim() ?? "",
      tipo: "text",
      nota: "vem do WhatsApp, só leitura",
    },
    {
      campo: null,
      rot: "Telefone",
      icone: <Phone size={16} strokeWidth={2} />,
      valor: telefoneLegivel(contato.telefone),
      tipo: "text",
      nota: "vem do WhatsApp, só leitura",
    },
    {
      campo: "empresa",
      rot: "Empresa",
      icone: <Building2 size={16} strokeWidth={2} />,
      valor: contato.empresa ?? "",
      tipo: "text",
      quebra: true,
    },
    {
      campo: "email",
      rot: "E-mail",
      icone: <Mail size={16} strokeWidth={2} />,
      valor: contato.email ?? "",
      tipo: "email",
      quebra: true,
    },
  ];

  /* ---- observações ---- */

  const obsSalva = contato.observacoes ?? "";
  const obsTexto = obs ?? obsSalva;
  const obsMudou = obs !== null && obs !== obsSalva;
  const salvarObs = () => {
    const texto = obs ?? "";
    void acoes.editarContato(contato.id, { observacoes: texto }).then((r) => {
      if (!r.ok) {
        avisar(textoDoErroChat(r.erro, "observacao"), "erro");
        return;
      }
      // Só limpa o rascunho se ninguém escreveu mais nada enquanto salvava.
      setObs((atual) => (atual === null || atual === texto ? null : atual));
      avisar("Observação salva para a equipe.");
    });
  };

  /* ---- histórico, do mais novo para o mais antigo ---- */

  const historico = [...(historicoL.dados ?? [])].reverse();
  const nomeEtapa = (id: string) => todasEtapas.find((e) => e.id === id)?.nome ?? "Etapa apagada";

  /* ---- apagar ---- */

  // Pelo servidor (apagarContato): primeiro as mídias do Storage, depois o contato (a cascata leva o resto).
  const apagar = () => {
    if (apagando) return;
    setApagando(true);
    void acoes.apagarContato(contato.id).then((r) => {
      setApagando(false);
      setConfirmar(false);
      if (r.ok) aoApagado(nome);
      else avisar(textoDoErroChat(r.erro, "apagar"), "erro");
    });
  };

  return (
    <div className={cx(s.fcFicha, className)} data-modo={modo}>
      {cabecalho}

      <div className={s.fcRolo}>
        {erroReleitura ? (
          <ErroLeitura
            erro={erroReleitura}
            titulo="Não deu para atualizar a ficha"
            tentarDeNovo={() => {
              if (convL.erro) convL.tentarDeNovo();
              if (contatoL.erro) contatoL.tentarDeNovo();
            }}
            compacto
          />
        ) : null}
        {/* Os títulos (h2 da ficha e h3 das partes) guiam o leitor de tela; sem regiões aninhadas: o
            marco é o da coluna (aside) ou o da gaveta, que vêm da TelaChat. */}
        <div className={s.fcResumo}>
          <div className={s.fcRnCab}>
            <JaneteSimbolo tamanho={36} decorativo />
            <h3 className={s.fcRnTit}>O que a Janete já descobriu</h3>
          </div>
          {contato.resumo_janete?.trim() ? (
            <p className={s.fcRnTexto}>{contato.resumo_janete}</p>
          ) : (
            <p className={cx(s.fcRnTexto, s.fcRnVazio)}>A Janete ainda não resumiu esta conversa.</p>
          )}
        </div>

        {linhas.length ? (
          <div className={s.fcSec}>
            <h3 className={s.fcSecTit}>Atendimento</h3>
            <dl className={s.fcSit}>
              {linhas.map((l) => (
                <div key={l.rot}>
                  <dt>{l.rot}</dt>
                  <dd>{l.valor}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        <div className={s.fcSec}>
          <h3 className={s.fcSecTit}>Etapa no funil</h3>
          <p className={s.fcEtapaAtual}>
            <b className={s.fcEtapaNome}>{etapa?.nome ?? "Sem etapa"}</b>
            {haEtapa ? <span className={s.fcMeta}>· {haEtapa}</span> : null}
          </p>
          {segmentos > 0 ? (
            <div
              className={s.fcBarra}
              data-desfecho={fechado ? etapa?.tipo : undefined}
              aria-hidden="true"
              style={{ gridTemplateColumns: `repeat(${segmentos}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: segmentos }, (_, i) => (
                <i key={i} className={fechado || i <= indice ? s.fcBarraCheia : undefined} />
              ))}
            </div>
          ) : null}
          <div className={s.fcMover}>
            <MenuSuspenso
              rotulo="Mover o lead para a etapa"
              textoBotao="Mover para…"
              itens={etapas.map((e) => ({ id: e.id, texto: e.nome }))}
              valor={contato.etapa_id}
              aoEscolher={mover}
              alinhar="largura"
              className={s.fcMoverMenu}
            />
          </div>
        </div>

        <div className={s.fcSec}>
          <h3 className={s.fcSecTit}>Contato</h3>
          <div className={s.fcCampos}>
            {campos.map((c) =>
              c.campo && editando === c.campo ? (
                <div key={c.rot}>{editor(c.rot, c.tipo)}</div>
              ) : (
                <div key={c.rot} className={s.fcCampo}>
                  <span className={s.fcCampoIcone} aria-hidden="true">
                    {c.icone}
                  </span>
                  <div className={s.fcCampoV}>
                    <span className={s.fcCampoRot}>
                      {c.rot}
                      {c.nota ? <span className={s.fcSr}> ({c.nota})</span> : null}
                    </span>
                    <b
                      className={s.fcCampoValor}
                      data-vazio={c.valor ? undefined : ""}
                      data-quebra={c.quebra && c.valor ? "" : undefined}
                      title={c.valor || undefined}
                    >
                      {c.valor ? (c.tipo === "email" ? comQuebraNoArroba(c.valor) : c.valor) : "Não informado"}
                    </b>
                  </div>
                  {c.campo ? (
                    <button
                      type="button"
                      id={idLapis(c.campo)}
                      className={s.fcLapis}
                      aria-label={c.campo === "nome" ? "Editar o nome" : `${c.valor ? "Editar" : "Adicionar"} ${c.rot.toLowerCase()}`}
                      onClick={() => editar(c.campo!)}
                    >
                      <Pencil size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ),
            )}
          </div>
        </div>

        <div className={s.fcSec}>
          <h3 className={s.fcSecTit}>
            <label htmlFor={`${base}-obs`}>Observações da equipe</label>
          </h3>
          <textarea
            id={`${base}-obs`}
            className={s.fcObs}
            placeholder="Anote o que a equipe precisa saber sobre este lead"
            value={obsTexto}
            onChange={(ev) => setObs(ev.target.value)}
          />
          <div className={s.fcObsPe}>
            <span className={s.fcMeta}>
              {obsMudou ? "Alteração ainda não salva" : obsSalva ? "Visível para toda a equipe" : "Nenhuma observação ainda"}
            </span>
            {obsMudou ? (
              <button type="button" className={cx(s.fcBtn, s.fcBtnPri)} onClick={salvarObs}>
                Salvar
              </button>
            ) : null}
          </div>
        </div>

        <div className={s.fcSec}>
          <h3 className={s.fcSecTit}>Histórico de etapas</h3>
          {/* Como a gaveta do Kanban: o "nenhuma mudança" só depois de o histórico chegar. */}
          {erroSemDados(historicoL) ? (
            <ErroLeitura
              compacto
              titulo="Não deu para carregar o histórico"
              erro={historicoL.erro}
              tentarDeNovo={historicoL.tentarDeNovo}
            />
          ) : historicoL.carregando ? (
            <Carregando forma="texto" quantos={2} rotulo="Carregando o histórico de etapas" />
          ) : historico.length ? (
            <ol className={s.fcHist}>
              {historico.map((h) => (
                <li key={h.id}>
                  <span className={s.fcHistPonto} aria-hidden="true" />
                  <b className={s.fcHistEtapa}>{nomeEtapa(h.para_etapa_id)}</b>
                  <span className={s.fcHistPor}>
                    {quemMoveu(estado, h)} · {dataCurta(h.criado_em)}, {horaCurta(h.criado_em)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={s.fcMeta}>Nenhuma mudança de etapa ainda.</p>
          )}
        </div>

        <div className={s.fcAcoes}>
          <button type="button" className={cx(s.fcBtn, s.fcBtnCont)} onClick={() => void navigate({ to: "/app/kanban" })}>
            <SquareKanban size={16} strokeWidth={2} aria-hidden="true" />
            <span>Ver no Kanban</span>
          </button>
          {admin ? (
            <button type="button" className={cx(s.fcBtn, s.fcBtnPerigo)} onClick={() => setConfirmar(true)} id={`${base}-apagar`}>
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              <span>Apagar contato</span>
            </button>
          ) : null}
        </div>
      </div>

      {confirmar && admin ? (
        <ConfirmarApagar
          nome={nome}
          apagando={apagando}
          aoCancelar={() => {
            focoDepois.current = `${base}-apagar`;
            setConfirmar(false);
          }}
          aoApagar={apagar}
        />
      ) : null}
    </div>
  );
}

/**
 * O diálogo de confirmação de "Apagar contato" (o `#dlg-apagar` do protótipo): véu, título com o nome,
 * o que vai junto e os dois botões. O foco entra em Cancelar (o caminho seguro), fica preso entre os
 * botões e Esc cancela. Vai para o `body` por portal; as teclas não sobem para a gaveta por trás.
 */
function ConfirmarApagar({
  nome,
  apagando,
  aoCancelar,
  aoApagar,
}: {
  nome: string;
  apagando: boolean;
  aoCancelar: () => void;
  aoApagar: () => void;
}) {
  const base = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelarRef.current?.focus();
  }, []);

  const tecla = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      aoCancelar();
      return;
    }
    if (ev.key !== "Tab") return;
    ev.stopPropagation();
    const botoes = Array.from(caixa.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (!botoes.length) return;
    const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
    const j = ev.shiftKey ? (i <= 0 ? botoes.length - 1 : i - 1) : (i + 1) % botoes.length;
    ev.preventDefault();
    botoes[j]!.focus();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={s.fcVeu} data-identidade="aipro">
      <div
        ref={caixa}
        className={s.fcDialogo}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${base}-t`}
        aria-describedby={`${base}-d`}
        onKeyDown={tecla}
      >
        <h2 id={`${base}-t`} className={s.fcDialogoTit}>
          Apagar {nome}?
        </h2>
        <p id={`${base}-d`} className={s.fcDialogoTexto}>
          O contato sai da plataforma junto com a conversa inteira e as mídias. Não dá para desfazer. Se ele
          escrever de novo, volta como lead novo.
        </p>
        <div className={s.fcDialogoAcoes}>
          <button ref={cancelarRef} type="button" className={cx(s.fcBtn, s.fcBtnDisc)} onClick={aoCancelar} disabled={apagando}>
            Cancelar
          </button>
          <button
            type="button"
            className={cx(s.fcBtn, s.fcBtnPerigoCheio)}
            onClick={aoApagar}
            disabled={apagando}
            aria-busy={apagando || undefined}
          >
            {apagando ? "Apagando…" : "Apagar contato"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
