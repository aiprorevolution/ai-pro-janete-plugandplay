import { useId, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Info, Link2, Mail, Send, Shield, UserCheck, UserRound, UserX, X } from "lucide-react";

import { Botao } from "@/components/aipro";
import { type Classes } from "@/components/aipro/cx";

import { AvatarLead } from "../comum/AvatarLead";
import type { Etapa } from "../exemplo/tipos";
import { MAX_NO_CARTAO, type Cartao, type CartaoConvite, type CartaoMembro, type ConversaNoCartao, type PedidoEquipe } from "./dados";
import estilos from "./CartaoPessoa.module.css";

// O cartão de cada pessoa da Equipe (o `.pc` do protótipo B): quem é, o papel e a situação, as
// conversas que estão com ela agora e os botões à vista (só para quem pode gerenciar). O convite
// pendente tem um cartão próprio, sem fundo e com uma linha fina por dentro. O cartão só pede
// (`aoPedir`): a tela confirma o que precisa e chama a ação da camada de dados. O convite tem
// Renovar (um link novo, decisão 15), Copiar link (decisão 1) e Cancelar.

const s = estilos as Classes<
  | "pcCartao"
  | "pcCab"
  | "pcAvatar"
  | "pcId"
  | "pcNome"
  | "pcEmail"
  | "pcSelos"
  | "pcPapel"
  | "pcSit"
  | "pcConv"
  | "pcRotulo"
  | "pcNumero"
  | "pcLista"
  | "pcLink"
  | "pcAvatarLead"
  | "pcLiNome"
  | "pcEtapa"
  | "pcEtapaBolinha"
  | "pcVerMais"
  | "pcVazio"
  | "pcTexto"
  | "pcAcoes"
  | "pcBotao"
  | "pcNota"
  | "pcNotaIcone"
>;

interface Props {
  cartao: Cartao;
  /** Admin: mostra os botões. O atendente vê o cartão sem eles. */
  podeGerenciar: boolean;
  aoPedir: (pedido: PedidoEquipe) => void;
  /** Realça o cartão (o convite que acabou de ser feito): o anel azul some em 2,6 s. */
  destaque?: boolean | undefined;
}

/** O id do DOM de cada botão do cartão: a tela usa para devolver o foco depois da confirmação. */
export function idDoBotao(pedido: PedidoEquipe): string {
  return `equipe-${pedido.tipo}-${pedido.id}`;
}

/* ---------- a cor da etapa ----------
   Cópia da regra de kanban/Coluna.tsx (a mesma de contatos/pecas.tsx), para a bolinha ter a cor do
   quadro sem importar de kanban/ nem de contatos/. Se o Kanban mudar a tabela de cores, mude aqui
   também. */

const CORES_ETAPA: Readonly<Record<string, string>> = {
  cinza: "var(--sb-linha)",
  azul: "var(--sb-azul-claro)",
  menta: "var(--sb-menta)",
  rosa: "var(--sb-rosa)",
  areia: "var(--sb-areia)",
};

/** A cor de cada etapa quando o banco ainda não tem uma (`cor` nula): a do protótipo. */
const COR_PADRAO: Readonly<Record<string, string>> = {
  novo: "cinza",
  em_qualificacao: "azul",
  qualificado: "menta",
  em_negociacao: "rosa",
  ganho: "menta",
  perdido: "cinza",
};

function corDaEtapa(etapa: Pick<Etapa, "cor" | "chave"> | null | undefined): string {
  const salva = etapa?.cor ? CORES_ETAPA[etapa.cor] : undefined;
  if (salva) return salva;
  const padrao = etapa?.chave ? COR_PADRAO[etapa.chave] : undefined;
  return (padrao && CORES_ETAPA[padrao]) || CORES_ETAPA["cinza"]!;
}

const nomeDaEtapa = (etapa: Etapa | undefined) => etapa?.nome.trim() || "Sem etapa";
const nomeDoPapel = (papel: string) => (papel === "admin" ? "Admin" : "Atendente");

export function CartaoPessoa({ cartao, podeGerenciar, aoPedir, destaque }: Props) {
  return cartao.tipo === "convite" ? (
    <CartaoDoConvite cartao={cartao} podeGerenciar={podeGerenciar} aoPedir={aoPedir} destaque={destaque} />
  ) : (
    <CartaoDoMembro cartao={cartao} podeGerenciar={podeGerenciar} aoPedir={aoPedir} destaque={destaque} />
  );
}

/* ---------- membro ---------- */

function CartaoDoMembro({
  cartao,
  podeGerenciar,
  aoPedir,
  destaque,
}: Omit<Props, "cartao"> & { cartao: CartaoMembro }) {
  const base = useId();
  const idNome = `${base}-nome`;
  const idNota = `${base}-nota`;
  const { membro } = cartao;
  const ativo = membro.ativo;
  const tom = cartao.souEu ? "eu" : ativo ? "ativo" : "off";
  const travado = podeGerenciar && ativo ? cartao.travado : null;

  const pedir = (tipo: PedidoEquipe["tipo"]) => () => aoPedir({ tipo, id: membro.id });

  return (
    <article
      className={s.pcCartao}
      aria-labelledby={idNome}
      data-off={!ativo || undefined}
      data-destaque={destaque || undefined}
    >
      <div className={s.pcCab}>
        <span className={s.pcAvatar} data-tom={tom} aria-hidden="true">
          {cartao.iniciais}
        </span>
        <div className={s.pcId}>
          <h3 className={s.pcNome} id={idNome}>
            {cartao.nome}
          </h3>
          <p className={s.pcEmail}>{membro.email}</p>
          <p className={s.pcSelos}>
            <span className={s.pcPapel}>{nomeDoPapel(membro.papel)}</span>
            <span className={s.pcSit} data-sit={ativo ? "ativo" : "off"}>
              <i aria-hidden="true" />
              {ativo ? "Ativo" : "Desativado"}
            </span>
          </p>
        </div>
      </div>

      {ativo ? (
        <ConversasDoCartao conversas={cartao.conversas} />
      ) : (
        <p className={s.pcTexto}>
          Não entra mais na plataforma. As conversas que eram dessa pessoa voltaram para “Precisam de você”.
        </p>
      )}

      {podeGerenciar ? (
        <>
          <div className={s.pcAcoes}>
            {ativo ? (
              <>
                {membro.papel === "admin" ? (
                  <BotaoDoCartao
                    pedido={{ tipo: "atendente", id: membro.id }}
                    icone={<UserRound size={16} />}
                    travado={travado ? idNota : null}
                    aoClicar={pedir("atendente")}
                  >
                    Tornar atendente
                  </BotaoDoCartao>
                ) : (
                  <BotaoDoCartao
                    pedido={{ tipo: "admin", id: membro.id }}
                    icone={<Shield size={16} />}
                    travado={travado ? idNota : null}
                    aoClicar={pedir("admin")}
                  >
                    Tornar admin
                  </BotaoDoCartao>
                )}
                <BotaoDoCartao
                  pedido={{ tipo: "desativar", id: membro.id }}
                  icone={<UserX size={16} />}
                  perigo
                  travado={travado ? idNota : null}
                  aoClicar={pedir("desativar")}
                >
                  Desativar
                </BotaoDoCartao>
              </>
            ) : (
              <BotaoDoCartao
                pedido={{ tipo: "reativar", id: membro.id }}
                icone={<UserCheck size={16} />}
                aoClicar={pedir("reativar")}
              >
                Reativar
              </BotaoDoCartao>
            )}
          </div>
          {travado ? (
            <p className={s.pcNota} id={idNota}>
              <Info className={s.pcNotaIcone} size={14} aria-hidden="true" />
              <span>{travado}</span>
            </p>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

/** "Conversas agora": até 5, a de mensagem mais recente primeiro; "Ver mais N" abre o resto aqui. */
function ConversasDoCartao({ conversas }: { conversas: readonly ConversaNoCartao[] }) {
  const idLista = useId();
  const [aberto, setAberto] = useState(false);
  const sobra = conversas.length - MAX_NO_CARTAO;
  const visiveis = aberto || sobra <= 0 ? conversas : conversas.slice(0, MAX_NO_CARTAO);

  return (
    <div className={s.pcConv}>
      <p className={s.pcRotulo}>
        <span>Conversas agora</span>
        <b className={s.pcNumero}>{conversas.length}</b>
      </p>
      {conversas.length ? (
        <ul className={s.pcLista} id={idLista}>
          {visiveis.map((c) => (
            <li key={c.conversaId}>
              <Link
                to="/app/chat"
                search={{ conversa: c.conversaId }}
                className={s.pcLink}
                aria-label={`${c.nome}, ${nomeDaEtapa(c.etapa)}. Abrir no Chat`}
              >
                <AvatarLead nome={c.nome} chave={c.contatoId} tamanho="p" className={s.pcAvatarLead} />
                <span className={s.pcLiNome}>{c.nome}</span>
                <span className={s.pcEtapa}>
                  <i className={s.pcEtapaBolinha} style={{ background: corDaEtapa(c.etapa) }} aria-hidden="true" />
                  {nomeDaEtapa(c.etapa)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.pcVazio}>Nenhuma conversa agora.</p>
      )}
      {sobra > 0 ? (
        <button
          type="button"
          className={s.pcVerMais}
          aria-expanded={aberto}
          aria-controls={idLista}
          onClick={() => setAberto((a) => !a)}
        >
          {aberto ? "Mostrar menos" : `Ver mais ${sobra}`}
        </button>
      ) : null}
    </div>
  );
}

/* ---------- convite ---------- */

function CartaoDoConvite({
  cartao,
  podeGerenciar,
  aoPedir,
  destaque,
}: Omit<Props, "cartao"> & { cartao: CartaoConvite }) {
  const idNome = `${useId()}-nome`;
  const { convite } = cartao;

  return (
    <article className={s.pcCartao} aria-labelledby={idNome} data-convite="" data-destaque={destaque || undefined}>
      <div className={s.pcCab}>
        <span className={s.pcAvatar} data-tom="convite" aria-hidden="true">
          <Mail size={18} strokeWidth={1.75} />
        </span>
        <div className={s.pcId}>
          <h3 className={s.pcNome} id={idNome}>
            {convite.email}
          </h3>
          <p className={s.pcEmail}>Convidado para entrar na equipe</p>
          <p className={s.pcSelos}>
            <span className={s.pcPapel}>{nomeDoPapel(convite.papel)}</span>
            <span className={s.pcSit} data-sit="convite">
              <i aria-hidden="true" />
              {cartao.enviado}
            </span>
          </p>
        </div>
      </div>

      <p className={s.pcTexto}>Ainda não aceitou com Google. Começa a receber conversas depois de entrar.</p>
      {podeGerenciar ? (
        <p className={s.pcTexto}>
          O convite vale por 7 dias. Use Renovar para estender a validade e Copiar link para compartilhar.
        </p>
      ) : null}

      {podeGerenciar ? (
        <div className={s.pcAcoes}>
          <BotaoDoCartao
            pedido={{ tipo: "reenviar", id: convite.id }}
            icone={<Send size={16} />}
            aoClicar={() => aoPedir({ tipo: "reenviar", id: convite.id })}
          >
            Renovar
          </BotaoDoCartao>
          <BotaoDoCartao
            pedido={{ tipo: "copiar", id: convite.id }}
            icone={<Link2 size={16} />}
            aoClicar={() => aoPedir({ tipo: "copiar", id: convite.id })}
          >
            Copiar link
          </BotaoDoCartao>
          <BotaoDoCartao
            pedido={{ tipo: "cancelar", id: convite.id }}
            icone={<X size={16} />}
            perigo
            aoClicar={() => aoPedir({ tipo: "cancelar", id: convite.id })}
          >
            Cancelar convite
          </BotaoDoCartao>
        </div>
      ) : null}
    </article>
  );
}

/* ---------- o botão ---------- */

/** O botão compacto do cartão. `travado` é o id da nota que explica por que ele está bloqueado. */
function BotaoDoCartao({
  pedido,
  icone,
  perigo = false,
  travado = null,
  aoClicar,
  children,
}: {
  pedido: PedidoEquipe;
  icone: ReactNode;
  perigo?: boolean | undefined;
  travado?: string | null | undefined;
  aoClicar: () => void;
  children: ReactNode;
}) {
  return (
    <Botao
      id={idDoBotao(pedido)}
      className={s.pcBotao}
      variante={perigo ? "perigo" : "contorno"}
      tamanho="compacto"
      icone={icone}
      disabled={!!travado}
      aria-describedby={travado ?? undefined}
      // O 2º clique de um duplo clique não pede de novo: depois do 1º, o cartão pode ter mudado de lugar
      // (Reativar) e o clique cairia noutro botão. Teclado e toque mandam `detail` 0 ou 1.
      onClick={(ev) => {
        if (ev.detail > 1) return;
        aoClicar();
      }}
    >
      {children}
    </Botao>
  );
}
