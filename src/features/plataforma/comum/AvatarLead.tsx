import type { CSSProperties } from "react";
import { Bell, Smartphone, TriangleAlert, UserRound } from "lucide-react";

import { cx, type Classes } from "@/components/aipro/cx";

import estilos from "./AvatarLead.module.css";

const s = estilos as Classes<"alAvatar" | "alIniciais" | "alIconeSemNome" | "alSelo" | "alSeloJanete">;

/** As 4 tintas de categoria do AI PRO: a mesma cor do lead na lista, no cabeçalho, nas mensagens e na ficha. */
export type CorLead = "azul" | "menta" | "areia" | "rosa";
export const CORES_LEAD: readonly CorLead[] = ["azul", "menta", "areia", "rosa"];

/** Quem está com a conversa, no canto do avatar. */
export type SeloLead = "janete" | "membro" | "celular" | "aguardando" | "falha";

/** p 36 (cabeçalho, mensagens) · m 48 (lista, card) · g 64 (ficha, perfil). */
export type TamanhoAvatarLead = "p" | "m" | "g";

const DESCRICAO_SELO: Record<SeloLead, string> = {
  janete: "com a Janete",
  membro: "com a equipe",
  celular: "respondida pelo celular da empresa",
  aguardando: "aguardando alguém",
  falha: "a Janete parou por uma falha",
};

/**
 * A cor de um lead quando o dado não traz uma: derivada da chave (o id do contato, de preferência),
 * sempre a mesma para a mesma chave, em todas as telas. É derivação, não sorteio.
 * A conta e a ordem das cores são as do `corDoContato` de `exemplo/regras.ts`: as duas dão a mesma cor
 * para o mesmo id (o t0-comum-a confere).
 */
export function corDoLead(chave: string): CorLead {
  let h = 0;
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) % 9973;
  return CORES_LEAD[h % CORES_LEAD.length]!;
}

type Props = {
  nome: string;
  /** A cor do lead. Padrão: `corDoLead(chave ?? nome)`. */
  cor?: CorLead | undefined;
  /**
   * O id do contato, de onde sai a cor quando `cor` não vem. Quem monta passa sempre `chave` ou `cor`:
   * sem os dois, a cor sai do nome e pode não bater com a da lista.
   */
  chave?: string | undefined;
  selo?: SeloLead | null | undefined;
  /** Só no selo "membro": as iniciais de quem atende. Sem elas, o ícone de pessoa. */
  iniciaisMembro?: string | null | undefined;
  tamanho?: TamanhoAvatarLead | undefined;
  /** Decorativo quando o nome já está escrito ao lado (padrão). */
  decorativo?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
};

/** O símbolo da Janete, estático (a arte-mestre do F), para o selo. */
function MarcaJanete() {
  return (
    <img className={s.alSeloJanete} src="/brand/aipro-icone.png" alt="" aria-hidden="true" />
  );
}

/**
 * As iniciais do lead como no Chat final: a 1ª letra do primeiro e do último nome ("Carlos Eduardo
 * Lima" → "CL"); uma palavra só, as duas primeiras letras. Regra local: o `iniciais` de
 * components/aipro (1ª e 2ª palavras) é o do onboarding e continua como está.
 */
function iniciaisDoLead(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  const primeira = p[0]!;
  const segunda = p.length > 1 ? (p[p.length - 1]![0] ?? "") : (primeira[1] ?? "");
  return (primeira[0]! + segunda).toUpperCase();
}

/**
 * O avatar do lead (desenho da opção A do Chat final): círculo na tinta do lead, com as iniciais, e
 * o selo de quem atende no canto.
 *
 * O selo nunca cobre as iniciais: ele fica para fora do círculo, no canto de baixo à direita, e as
 * iniciais sobem 2 px para a esquerda quando há selo. Os tamanhos de letra, selo e folga de cada
 * tamanho foram medidos para que nem o anel branco do selo encoste na última letra (ver o CSS).
 * O selo transborda o quadrado do avatar em `--al-fora`: quem usa reserva esse espaço.
 */
export function AvatarLead({
  nome,
  cor,
  chave,
  selo,
  iniciaisMembro,
  tamanho = "m",
  decorativo = true,
  className,
  style,
}: Props) {
  const acessivel = decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": selo ? `${nome}, ${DESCRICAO_SELO[selo]}` : nome } as const);

  return (
    <span
      className={cx(s.alAvatar, className)}
      data-tamanho={tamanho}
      data-cor={cor ?? corDoLead(chave ?? nome)}
      data-com-selo={selo ? "" : undefined}
      style={style}
      {...acessivel}
    >
      {/* Sem letra no nome (só o telefone), o ícone de pessoa: "+55 11…" não vira "+1". */}
      {/\p{L}/u.test(nome) ? (
        <span className={s.alIniciais}>{iniciaisDoLead(nome)}</span>
      ) : (
        <span className={s.alIniciais} data-testid="avatar-sem-nome">
          <UserRound className={s.alIconeSemNome} aria-hidden="true" />
        </span>
      )}
      {selo ? (
        <span className={s.alSelo} data-selo={selo} data-testid="avatar-selo">
          {selo === "janete" ? (
            <MarcaJanete />
          ) : selo === "membro" ? (
            iniciaisMembro ? (
              iniciaisMembro.slice(0, 2).toUpperCase()
            ) : (
              <UserRound aria-hidden="true" />
            )
          ) : selo === "celular" ? (
            <Smartphone aria-hidden="true" />
          ) : selo === "aguardando" ? (
            <Bell aria-hidden="true" />
          ) : (
            <TriangleAlert aria-hidden="true" />
          )}
        </span>
      ) : null}
    </span>
  );
}
