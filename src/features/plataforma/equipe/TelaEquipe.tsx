import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, Plus, X } from "lucide-react";

import { Aviso, Botao, Campo } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";

import { idTituloArea, useEntradaUnica } from "../AreaVazia";
import { areaPorId } from "../areas";
import { useAcoesEquipe, useEquipe, type AvisoConvite } from "../dados/equipe";
import { Carregando, ErroLeitura } from "../dados/estados";
import type { Erro } from "../dados/tipos";
import { ehAdmin, estaAguardando } from "../exemplo/regras";
import type { PapelMembro } from "../exemplo/tipos";
import { CartaoPessoa, idDoBotao } from "./CartaoPessoa";
import { ConfirmarEquipe } from "./ConfirmarEquipe";
import { copiarQuandoChegar } from "./copiar";
import {
  TRAVA_PROPRIO,
  TRAVA_UNICO_ADMIN,
  cartoesDaEquipe,
  erroDoConvite,
  filaDaEquipe,
  nomeNaEquipe,
  proximoTiqueDaFila,
  type BaseEquipe,
  type PedidoEquipe,
} from "./dados";
import { FilaEquipe } from "./FilaEquipe";
import { GavetaConvite } from "./GavetaConvite";
import estilos from "./TelaEquipe.module.css";

// A tela da Equipe (o `.eq` do protótipo B, docs/spec-equipe.md): o cabeçalho com "Convidar pessoa"
// (só do admin), a fila "Precisam de você" à esquerda e um cartão por pessoa à direita. Lê e age só
// pela camada de dados (dados/equipe.ts: o banco, ou o exemplo nos testes), com os 3 estados. Os
// cartões só pedem; a tela confirma o que precisa (ConfirmarEquipe), chama a ação, mostra o aviso
// curto, realça o que mudou e devolve o foco a quem pediu.

const s = estilos as Classes<
  | "eqTela"
  | "eqCab"
  | "eqCabTexto"
  | "eqTitulo"
  | "eqDesc"
  | "eqConvidar"
  | "eqNota"
  | "eqNotaIcone"
  | "eqGrade"
  | "eqPessoas"
  | "eqCartoes"
  | "eqAviso"
  | "eqAvisoTexto"
  | "eqAvisoFechar"
  | "eqLinkManual"
  | "eqLinkManualTexto"
  | "eqSr"
>;

/** Quanto dura o realce do cartão novo e das conversas que voltaram para a fila (o do protótipo). */
const REALCE_MS = 2600;
/** Quanto o aviso curto fica na tela (o do protótipo). */
const AVISO_MS = 4600;

/** O id do "Convidar pessoa": o foco volta para ele quando a gaveta fecha (o `eq-convidar` do protótipo). */
const ID_CONVIDAR = "equipe-convidar";

/** O aviso do convite gravado cujo e-mail não saiu (o admin manda o link à mão). */
export function textoEmailNaoEnviado(email: string): string {
  return `O convite para ${email} está criado, mas o e-mail não saiu. Use Copiar link no cartão e mande o link para a pessoa.`;
}

/**
 * O relógio da fila, como o `useRelogio` do Chat: só anda quando o minuto da espera de alguma
 * conversa vira ("agora" → "1 min", e o vermelho aos 10 min no mesmo instante que o Chat), em vez de
 * redesenhar a tela num intervalo fixo. `esperas` são os `aguardando_humano_desde` da fila, juntados
 * por "|"; quando a fila muda, o relógio acerta na hora.
 */
function useAgora(esperas: string): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const lista = esperas ? esperas.split("|") : [];
    let id = 0;
    const agendar = () => {
      const falta = proximoTiqueDaFila(Date.now(), lista);
      if (falta === null) return;
      id = window.setTimeout(() => {
        setAgora(Date.now());
        agendar();
      }, falta);
    };
    setAgora(Date.now());
    agendar();
    return () => window.clearTimeout(id);
  }, [esperas]);
  return agora;
}

/**
 * O motivo de uma ação recusada, em texto simples. `sobre` diz de quem é o `nao_encontrado` (a
 * pessoa ou o convite); `detalhe` separa o `email_em_uso` de quando o e-mail do convite passou a ser
 * de outra conta (a conta que o convite criou foi apagada e outra nasceu com o mesmo e-mail).
 */
export function textoDaRecusa(erro: Erro, sobre: "membro" | "convite" = "membro", detalhe?: string): string {
  switch (erro) {
    case "sem_permissao":
    case "sem_acesso":
      return "Só um admin pode fazer isso.";
    case "proprio_membro":
      return sobre === "convite" ? "Esse é o seu e-mail." : TRAVA_PROPRIO;
    case "ultimo_admin":
      return TRAVA_UNICO_ADMIN;
    case "nao_encontrado":
      return sobre === "convite"
        ? "Esse convite não existe mais: a pessoa já entrou ou o convite foi cancelado."
        : "Essa pessoa não está mais na lista.";
    case "email_invalido":
      return "Esse e-mail parece incompleto. Confira se tem @ e o domínio.";
    case "email_em_uso":
      return detalhe === "conta"
        ? "Esse e-mail passou a ser de outra conta. Cancele este convite e convide de novo."
        : "Esse e-mail já está na equipe ou num convite.";
    default:
      return "Não deu para fazer isso agora. Confira a internet e tente de novo.";
  }
}

const papelOposto = (papel: PapelMembro): "admin" | "atendente" => (papel === "admin" ? "atendente" : "admin");

/** O cabeçalho da área (o h1 existe nos 3 estados: o foco da casca vai para ele). */
function Cabecalho({ podeGerenciar, aoConvidar }: { podeGerenciar: boolean; aoConvidar: () => void }) {
  const area = areaPorId("equipe");
  return (
    <div className={s.eqCab}>
      <div className={s.eqCabTexto}>
        <h1 id={idTituloArea("equipe")} className={s.eqTitulo} tabIndex={-1}>
          {area.nome}
        </h1>
        <p className={s.eqDesc}>{area.descricao}</p>
      </div>
      {podeGerenciar ? (
        <Botao id={ID_CONVIDAR} className={s.eqConvidar} icone={<Plus size={18} />} aria-haspopup="dialog" onClick={aoConvidar}>
          Convidar pessoa
        </Botao>
      ) : null}
    </div>
  );
}

export function TelaEquipe() {
  const leitura = useEquipe();
  const base = leitura.dados;

  // A tela de erro só enquanto não há dados: uma releitura que falha em segundo plano (com a tela
  // pronta) vira um aviso compacto, e a gaveta, o diálogo e o foco ficam onde estavam.
  if (!base) return <EsperaEquipe erro={leitura.erro} tentarDeNovo={leitura.tentarDeNovo} />;
  return <ConteudoEquipe base={base} erroReleitura={leitura.erro} tentarDeNovo={leitura.tentarDeNovo} />;
}

/**
 * A Equipe antes dos dados: o cabeçalho e o osso dos cartões, ou o erro. A entrada roda uma vez por
 * troca de área (useEntradaUnica, decidido quando esta tela monta): a pronta, que monta depois dela na
 * mesma visita, e esta de novo, se os dados sumirem, entram sem animação.
 */
function EsperaEquipe({ erro, tentarDeNovo }: { erro: Erro | null; tentarDeNovo: () => void }) {
  const anima = useEntradaUnica("equipe");
  return (
    <section className={s.eqTela} aria-labelledby={idTituloArea("equipe")} data-sem-entrada={anima ? undefined : ""}>
      <Cabecalho podeGerenciar={false} aoConvidar={() => {}} />
      {erro ? (
        <ErroLeitura erro={erro} tentarDeNovo={tentarDeNovo} titulo="Não deu para carregar a equipe" />
      ) : (
        <Carregando forma="cartao" quantos={3} rotulo="Carregando a equipe" />
      )}
    </section>
  );
}

/** O aviso compacto da releitura que falhou com a tela já pronta (os dados na tela são os da última leitura). */
export const AVISO_RELEITURA_EQUIPE = "Não deu para atualizar a equipe. O que está na tela pode estar desatualizado.";

function ConteudoEquipe({
  base,
  erroReleitura,
  tentarDeNovo,
}: {
  base: BaseEquipe;
  erroReleitura: Erro | null;
  tentarDeNovo: () => void;
}) {
  const acoes = useAcoesEquipe();
  const anima = useEntradaUnica("equipe");
  const agora = useAgora(
    base.conversas
      .filter((c) => estaAguardando(c))
      .map((c) => c.aguardando_humano_desde ?? "")
      .join("|"),
  );
  const idPessoas = useId();
  const podeGerenciar = ehAdmin(base.eu);
  const cartoes = cartoesDaEquipe(base, agora);
  const fila = filaDaEquipe(base, agora);
  const baseRef = useRef(base);
  baseRef.current = base;

  const [pedido, setPedido] = useState<PedidoEquipe | null>(null);
  const [convidando, setConvidando] = useState(false);
  // O link do convite que o navegador não deixou copiar: fica à mostra para copiar à mão.
  const [linkManual, setLinkManual] = useState<{ id: string; email: string; link: string } | null>(null);

  // As ações em andamento ("tipo-id"): o 2º clique no mesmo botão, antes da resposta, não pede de novo.
  const emAndamento = useRef(new Set<string>());
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  /* ---------- o realce ---------- */

  // O convite que acabou de ser feito e as conversas que voltaram de quem foi desativado.
  const [novo, setNovo] = useState<string | null>(null);
  const [voltaram, setVoltaram] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!novo) return;
    const t = window.setTimeout(() => setNovo(null), REALCE_MS);
    return () => window.clearTimeout(t);
  }, [novo]);

  useEffect(() => {
    if (!voltaram.length) return;
    const t = window.setTimeout(() => setVoltaram([]), REALCE_MS);
    return () => window.clearTimeout(t);
  }, [voltaram]);

  /* ---------- o aviso curto ---------- */

  const [aviso, setAviso] = useState<{ id: number; texto: string; recusa: boolean } | null>(null);
  const idAviso = useRef(0);

  const avisar = useCallback((texto: string, recusa = false) => {
    if (!montado.current) return;
    idAviso.current += 1;
    setAviso({ id: idAviso.current, texto, recusa });
  }, []);

  // Um aviso por vez: o novo troca o anterior, e cada um some sozinho.
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso((a) => (a?.id === aviso.id ? null : a)), AVISO_MS);
    return () => window.clearTimeout(t);
  }, [aviso]);

  /* ---------- o foco ---------- */

  // Depois de uma ação, o foco vai ao 1º destes ids que ainda existe na tela (e não está travado);
  // senão, ao h1. Fica num efeito para achar os botões já pintados com o estado novo.
  const [foco, setFoco] = useState<{ ids: readonly string[]; em: number } | null>(null);
  const focoTratado = useRef<typeof foco>(null);

  // No banco, a lista pode chegar num desenho depois do aviso (o React Query avisa os leitores em
  // seguida): se o botão focado sumiu nesse desenho e o foco caiu no body, tenta de novo com a base
  // nova, por até 3 s. Fora disso, uma releitura (tempo real) nunca mexe no foco.
  useEffect(() => {
    if (!foco) return;
    if (focoTratado.current === foco) {
      const perdido = !document.activeElement || document.activeElement === document.body;
      if (!perdido || Date.now() - foco.em > 3000) return;
    }
    focoTratado.current = foco;
    for (const id of foco.ids) {
      const el = document.getElementById(id);
      if (el && !(el instanceof HTMLButtonElement && el.disabled)) {
        el.focus();
        return;
      }
    }
    document.getElementById(idTituloArea("equipe"))?.focus();
  }, [foco, base]);

  const focar = (...ids: string[]) => {
    if (montado.current) setFoco({ ids, em: Date.now() });
  };

  /** Roda a ação uma vez por botão: enquanto a resposta não chega, o mesmo pedido não sai de novo. */
  const umaVez = async (p: PedidoEquipe, fazer: () => Promise<void>) => {
    const chave = `${p.tipo}-${p.id}`;
    if (emAndamento.current.has(chave)) return;
    emAndamento.current.add(chave);
    try {
      await fazer();
    } finally {
      emAndamento.current.delete(chave);
    }
  };

  const emailDoConvite = (id: string) => (baseRef.current.convites ?? []).find((c) => c.id === id)?.email ?? "a pessoa";

  /* ---------- os pedidos dos cartões ---------- */

  const aoPedir = (p: PedidoEquipe) => {
    if (p.tipo === "reenviar") {
      const email = emailDoConvite(p.id);
      void umaVez(p, async () => {
        const r = await acoes.reenviarConvite(p.id);
        if (!r.ok) avisar(textoDaRecusa(r.erro, "convite", r.detalhe), true);
        else if (r.aviso) avisar(textoEmailNaoEnviado(email), true);
        else avisar(`Convite renovado para ${email}.`);
      });
      return;
    }
    if (p.tipo === "copiar") {
      const email = emailDoConvite(p.id);
      void umaVez(p, async () => {
        // Tudo até o copiarQuandoChegar roda ainda dentro do clique (sem await antes): é o que o
        // Safari exige para deixar copiar o link que ainda vai chegar do servidor.
        const pedidoLink = acoes.linkDoConvite(p.id);
        const copia = copiarQuandoChegar(pedidoLink.then((r) => (r.ok && r.valor ? r.valor : null)));
        const r = await pedidoLink;
        const c = await copia;
        if (!r.ok || !r.valor) {
          avisar(r.ok ? textoDaRecusa("falha") : textoDaRecusa(r.erro, "convite", r.detalhe), true);
          return;
        }
        if (c.copiado) {
          if (montado.current) setLinkManual(null);
          avisar(`Link do convite de ${email} copiado. Mande para a pessoa: ela entra por ele com a conta Google convidada.`);
          return;
        }
        // O navegador recusou a cópia: o link fica à mostra, num campo já selecionado.
        if (montado.current) setLinkManual({ id: p.id, email, link: r.valor });
      });
      return;
    }
    if (p.tipo === "reativar") {
      const membro = baseRef.current.membros.find((m) => m.id === p.id);
      const nome = nomeNaEquipe(baseRef.current, p.id);
      void umaVez(p, async () => {
        const r = await acoes.reativar(p.id);
        if (!r.ok) {
          avisar(textoDaRecusa(r.erro), true);
          return;
        }
        avisar(`${nome} pode entrar de novo na plataforma.`);
        // O "Reativar" sai do cartão: o foco vai para o botão de papel que aparece no lugar.
        if (membro) focar(idDoBotao({ tipo: papelOposto(membro.papel), id: p.id }));
      });
      return;
    }
    setPedido(p);
  };

  const aoCancelar = () => {
    const p = pedido;
    setPedido(null);
    if (p) focar(idDoBotao(p));
  };

  const aoConfirmar = () => {
    const p = pedido;
    if (!p) return;
    setPedido(null);
    const origem = idDoBotao(p);

    if (p.tipo === "cancelar") {
      const email = emailDoConvite(p.id);
      void umaVez(p, async () => {
        const r = await acoes.cancelarConvite(p.id);
        if (r.ok) avisar(`Convite para ${email} cancelado. O link do e-mail não leva mais para a equipe.`);
        else avisar(textoDaRecusa(r.erro, "convite", r.detalhe), true);
        // O cartão do convite sai: sem o botão, o foco vai para o h1.
        focar(origem);
      });
      return;
    }

    const nome = nomeNaEquipe(baseRef.current, p.id);
    if (p.tipo === "desativar") {
      void umaVez(p, async () => {
        const r = await acoes.desativar(p.id);
        if (!r.ok) {
          avisar(textoDaRecusa(r.erro), true);
          focar(origem);
          return;
        }
        const voltam = r.valor ?? [];
        const n = voltam.length;
        const conversas = n
          ? ` ${n === 1 ? "1 conversa voltou" : `${n} conversas voltaram`} para “Precisam de você”.`
          : "";
        avisar(`${nome} não entra mais na plataforma.${conversas}`);
        if (montado.current) setVoltaram(voltam);
        // O "Desativar" sai do cartão: o foco vai para o "Reativar" que tomou o lugar dele.
        focar(origem, idDoBotao({ tipo: "reativar", id: p.id }));
      });
      return;
    }

    if (p.tipo === "admin" || p.tipo === "atendente") {
      const papel = p.tipo;
      void umaVez(p, async () => {
        const r = await acoes.trocarPapel(p.id, papel);
        if (r.ok) avisar(`${nome} agora é ${papel}.`);
        else avisar(textoDaRecusa(r.erro), true);
        // "Tornar admin" vira "Tornar atendente" (e vice-versa): o foco fica no botão de papel.
        focar(origem, idDoBotao({ tipo: papelOposto(papel), id: p.id }));
      });
    }
  };

  /* ---------- o convite ---------- */

  const aoEnviarConvite = async (email: string, papel: PapelMembro): Promise<string | null> => {
    const erro = erroDoConvite(baseRef.current, email);
    if (erro) return erro;
    const r = await acoes.convidar(email, papel);
    if (!r.ok) return textoDaRecusa(r.erro, "convite", r.detalhe);
    const limpo = email.trim().toLowerCase();
    if (!montado.current) return null;
    setConvidando(false);
    // Como no protótipo, o foco volta ao "Convidar pessoa" pelo id: no Safari, clicar num botão não
    // dá foco a ele, e a Gaveta sozinha devolveria o foco ao body.
    focar(ID_CONVIDAR);
    if (r.id) setNovo(r.id);
    const semEmail: AvisoConvite | undefined = r.aviso;
    if (semEmail) avisar(textoEmailNaoEnviado(limpo), true);
    else avisar(`Convite criado para ${limpo}. Use Copiar link e compartilhe com a pessoa.`);
    return null;
  };

  const aoFecharConvite = () => {
    setConvidando(false);
    focar(ID_CONVIDAR);
  };

  return (
    <section className={s.eqTela} aria-labelledby={idTituloArea("equipe")} data-sem-entrada={anima ? undefined : ""}>
      <Cabecalho podeGerenciar={podeGerenciar} aoConvidar={() => setConvidando(true)} />
      {podeGerenciar ? null : (
        <p className={s.eqNota}>
          <Info className={s.eqNotaIcone} size={16} aria-hidden="true" />
          <span>Só um admin convida pessoas, troca o papel e desativa.</span>
        </p>
      )}

      {erroReleitura ? (
        <Aviso
          tom="atencao"
          compacto
          acao={
            <Botao variante="contorno" tamanho="compacto" onClick={tentarDeNovo}>
              Tentar de novo
            </Botao>
          }
        >
          {AVISO_RELEITURA_EQUIPE}
        </Aviso>
      ) : null}

      {podeGerenciar && linkManual ? (
        <LinkParaCopiar
          {...linkManual}
          aoFechar={() => {
            const id = linkManual.id;
            setLinkManual(null);
            focar(idDoBotao({ tipo: "copiar", id }));
          }}
        />
      ) : null}

      <div className={s.eqGrade}>
        <FilaEquipe itens={fila} destacados={voltaram} />
        <section className={s.eqPessoas} aria-labelledby={idPessoas}>
          <h2 className={s.eqSr} id={idPessoas}>
            Quem atende
          </h2>
          <div className={s.eqCartoes}>
            {cartoes.map((c) => {
              const id = c.tipo === "membro" ? c.membro.id : c.convite.id;
              return (
                <CartaoPessoa
                  key={id}
                  cartao={c}
                  podeGerenciar={podeGerenciar}
                  aoPedir={aoPedir}
                  destaque={c.tipo === "convite" && novo === id}
                />
              );
            })}
          </div>
        </section>
      </div>

      {podeGerenciar ? (
        <GavetaConvite aberta={convidando} aoFechar={aoFecharConvite} aoEnviar={aoEnviarConvite} />
      ) : null}
      <ConfirmarEquipe base={base} pedido={pedido} aoConfirmar={aoConfirmar} aoCancelar={aoCancelar} />

      {aviso ? (
        <div key={aviso.id} className={s.eqAviso} data-recusa={aviso.recusa || undefined}>
          {aviso.recusa ? (
            <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={18} strokeWidth={1.75} aria-hidden="true" />
          )}
          <p className={s.eqAvisoTexto}>{aviso.texto}</p>
          <button type="button" className={s.eqAvisoFechar} aria-label="Fechar o aviso" onClick={() => setAviso(null)}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {/* O leitor de tela ouve o aviso por aqui (o desenho acima não é uma região viva). O span leva a
          chave do aviso: o mesmo texto de novo (Renovar duas vezes) entra como nó novo e é lido de novo. */}
      <p className={s.eqSr} role="status" aria-live="polite">
        {aviso ? <span key={aviso.id}>{aviso.texto}</span> : null}
      </p>
    </section>
  );
}

/** O id do campo com o link do convite que o navegador não deixou copiar. */
export const ID_LINK_MANUAL = "equipe-link-manual";

/**
 * O "Copiar link" que o navegador recusou (o Safari sem o ClipboardItem, ou a permissão negada): o
 * link fica à mostra num campo só de leitura, já selecionado, para a pessoa copiar à mão.
 */
function LinkParaCopiar({ email, link, aoFechar }: { email: string; link: string; aoFechar: () => void }) {
  useEffect(() => {
    const campo = document.getElementById(ID_LINK_MANUAL);
    if (campo instanceof HTMLInputElement) {
      campo.focus();
      campo.select();
    }
  }, [link]);
  return (
    <div className={s.eqLinkManual} data-link-manual="">
      <Aviso tom="atencao" titulo="Copie o link abaixo" aoFechar={aoFechar}>
        <p className={s.eqLinkManualTexto}>
          {`Este navegador não deixou copiar sozinho. Copie o link e mande para ${email}: a pessoa entra por ele com a conta Google convidada.`}
        </p>
        <Campo
          id={ID_LINK_MANUAL}
          rotulo={`Link do convite de ${email}`}
          rotuloOculto
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
      </Aviso>
    </div>
  );
}
