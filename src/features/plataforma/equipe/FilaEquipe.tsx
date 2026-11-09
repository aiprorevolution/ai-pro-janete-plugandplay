import { useId } from "react";
import { Link } from "@tanstack/react-router";

import { type Classes } from "@/components/aipro/cx";

import { AvatarLead } from "../comum/AvatarLead";
import { tempoNaFila, tempoNaFilaPorExtenso, type ItemDaFila } from "./dados";
import estilos from "./FilaEquipe.module.css";

// A fila "Precisam de você" da Equipe (o `.fila` do protótipo B): as conversas que a Janete passou para
// a equipe e ninguém assumiu, a que espera há mais tempo em cima. Cada item abre a conversa no Chat.
// Os números e a ordem vêm de `filaDaEquipe`; aqui só se desenha.

const s = estilos as Classes<
  | "flFila"
  | "flCab"
  | "flTitulo"
  | "flContador"
  | "flApoio"
  | "flLista"
  | "flItem"
  | "flLink"
  | "flAvatar"
  | "flTexto"
  | "flNome"
  | "flMeta"
  | "flMotivo"
  | "flBolinha"
  | "flVazio"
>;

interface Props {
  itens: readonly ItemDaFila[];
  /** Os ids das conversas que acabaram de voltar para a fila: ganham o realce de 2,6 s. */
  destacados?: readonly string[] | undefined;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function FilaEquipe({ itens, destacados }: Props) {
  const idTitulo = useId();
  const n = itens.length;

  return (
    <section className={s.flFila} aria-labelledby={idTitulo}>
      <div className={s.flCab}>
        {/* O número aparece no contador; o leitor de tela ouve "Precisam de você, 4 conversas". */}
        <h2 className={s.flTitulo} id={idTitulo} aria-label={`Precisam de você, ${plural(n, "conversa", "conversas")}`}>
          <span>Precisam de você</span>
          <span className={s.flContador} data-zero={n === 0 || undefined} aria-hidden="true">
            {n}
          </span>
        </h2>
        <p className={s.flApoio}>A Janete passou estas conversas para a equipe e ninguém assumiu ainda.</p>
      </div>

      {n > 0 ? (
        <ul className={s.flLista}>
          {itens.map((item) => (
            <li
              key={item.conversaId}
              className={s.flItem}
              data-destaque={destacados?.includes(item.conversaId) || undefined}
            >
              <Link
                to="/app/chat"
                search={{ conversa: item.conversaId }}
                className={s.flLink}
                aria-label={`${item.nome}, ${item.motivo}, esperando ${tempoNaFilaPorExtenso(item.esperaS)}. Abrir no Chat`}
              >
                <AvatarLead nome={item.nome} chave={item.contatoId} tamanho="p" className={s.flAvatar} />
                <span className={s.flTexto}>
                  <b className={s.flNome}>{item.nome}</b>
                  <span className={s.flMeta}>
                    {/* Âmbar até 10 min; vermelha a partir daí (a régua do Chat). */}
                    <i className={s.flBolinha} data-longa={item.longa || undefined} aria-hidden="true" />
                    <span className={s.flMotivo}>
                      {item.motivo} · {tempoNaFila(item.esperaS)}
                    </span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.flVazio}>Ninguém esperando. A Janete está dando conta de todas as conversas agora.</p>
      )}
    </section>
  );
}
