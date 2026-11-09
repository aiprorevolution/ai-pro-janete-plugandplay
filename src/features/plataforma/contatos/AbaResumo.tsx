import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cx, type Classes } from "@/components/aipro/cx";
import { JaneteSimbolo } from "@/components/janete/JaneteSimbolo";

import { dataLonga, tempoRelativo } from "../comum/tempo";
import { usePerfilContato } from "../dados/contatos";
import { ICONE_ACONTECIMENTO, QuemFez, primeiroNomeDe } from "./AbaLinha";
import { fatosDoContato, resumoAtualizadoEm, ultimosAcontecimentos } from "./dados";
import { EstadoDaAba } from "./pecas";
import type { PropsAba } from "./tipos";
import estilos from "./Abas.module.css";

// A aba "Resumo" do perfil (task C3 da spec de Contatos; decisões 2 e 6 do equipe): o resumo da Janete,
// os fatos que ela anotou e os 5 últimos acontecimentos. A conversa fica só na aba Conversa, e as
// observações da equipe, na Ficha. Cartões brancos, sem fundo colorido (decisão 5).

const s = estilos as Classes<
  | "abAba"
  | "abCartao"
  | "abResumoCab"
  | "abAtualizado"
  | "abSubtitulo"
  | "abResumoTexto"
  | "abCortado"
  | "abLink"
  | "abVazioTexto"
  | "abFatos"
  | "abFato"
  | "abFatoRotulo"
  | "abFatoValor"
  | "abUltimos"
  | "abUltimo"
  | "abUltIcone"
  | "abUltCorpo"
  | "abUltTitulo"
  | "abUltMeta"
  | "abUltQuando"
  | "abRodape"
>;

/** Acima disso, sem medida da tela (o teste não desenha), o resumo conta como maior que 6 linhas. */
const LIMITE_SEM_MEDIDA = 280;

export function AbaResumo({ contatoId, agora, irParaAba, verNaConversa }: PropsAba) {
  const perfil = usePerfilContato(contatoId);
  const estado = perfil.dados;
  const contato = estado?.contatos.find((c) => c.id === contatoId);
  const nome = primeiroNomeDe(contato);
  const resumo = contato?.resumo_janete?.trim() ?? "";
  // Os fatos e o próximo passo são só para ler (decisão 12): vêm de contatos.anotacoes_janete.
  const fatos = contato ? fatosDoContato(contato) : [];
  const atualizadoEm = contato && resumo ? resumoAtualizadoEm(contato) : null;
  const ultimos = useMemo(() => (estado ? ultimosAcontecimentos(estado, contatoId, 5) : []), [estado, contatoId]);

  const idResumo = useId();
  const idTexto = useId();
  const idUltimos = useId();

  if (!estado) return <EstadoDaAba leitura={perfil} />;

  return (
    <div className={s.abAba}>
      <section className={s.abCartao} aria-labelledby={idResumo}>
        <div className={s.abResumoCab}>
          <JaneteSimbolo tamanho={20} decorativo />
          <h2 id={idResumo} className={s.abSubtitulo}>
            O resumo da Janete
          </h2>
          {atualizadoEm ? (
            <time className={s.abAtualizado} dateTime={atualizadoEm} title={`Atualizado em ${dataLonga(atualizadoEm)}`}>
              {`Atualizado ${tempoRelativo(atualizadoEm, agora)}`}
            </time>
          ) : null}
        </div>
        {resumo ? (
          <TextoResumo key={contatoId} id={idTexto} texto={resumo} />
        ) : (
          <p className={s.abVazioTexto}>{`A Janete ainda não escreveu um resumo de ${nome}.`}</p>
        )}

        {fatos.length > 0 ? (
          <dl className={s.abFatos} aria-label={`O que a Janete anotou sobre ${nome}`}>
            {fatos.map((f, i) => {
              const mensagemId = f.mensagemId;
              return (
                <div key={`${f.rotulo}-${i}`} className={s.abFato}>
                  <dt className={s.abFatoRotulo}>{f.rotulo}</dt>
                  <dd className={s.abFatoValor}>
                    {f.valor}
                    {mensagemId ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className={s.abLink}
                          aria-label={`Ver na conversa onde a Janete anotou: ${f.rotulo}`}
                          onClick={() => verNaConversa(mensagemId)}
                        >
                          ver
                        </button>
                      </>
                    ) : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className={s.abVazioTexto}>{`A Janete ainda não anotou nenhum fato sobre ${nome}.`}</p>
        )}
      </section>

      <section className={s.abCartao} aria-labelledby={idUltimos}>
        <h2 id={idUltimos} className={s.abSubtitulo}>
          Últimos acontecimentos
        </h2>
        {ultimos.length > 0 ? (
          <ol className={s.abUltimos}>
            {ultimos.map((a) => {
              const Icone = ICONE_ACONTECIMENTO[a.tipo];
              const mensagemId = a.mensagemId;
              return (
                <li key={a.id} className={s.abUltimo} data-tipo={a.tipo}>
                  <span className={s.abUltIcone}>
                    <Icone size={14} aria-hidden />
                  </span>
                  <div className={s.abUltCorpo}>
                    <p className={s.abUltTitulo}>{a.titulo}</p>
                    <p className={s.abUltMeta}>
                      <QuemFez quem={a.quem} />
                      <span aria-hidden="true">·</span>
                      <time className={s.abUltQuando} dateTime={a.em}>
                        {tempoRelativo(a.em, agora)}
                      </time>
                    </p>
                  </div>
                  {mensagemId ? (
                    <button
                      type="button"
                      className={s.abLink}
                      aria-label={`Ver na conversa: ${a.titulo}`}
                      onClick={() => verNaConversa(mensagemId)}
                    >
                      Ver na conversa
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={s.abVazioTexto}>{`Ainda não aconteceu nada com ${nome}.`}</p>
        )}
        <div className={s.abRodape}>
          <button type="button" className={s.abLink} onClick={() => irParaAba("linha")}>
            Ver a linha do tempo inteira
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * O texto do resumo, cortado em 6 linhas pelo CSS. O "Ler o resumo inteiro" só aparece quando o texto
 * passa das 6 linhas: na tela, pela medida; sem medida (teste, primeira pintura), pelo tamanho.
 */
function TextoResumo({ id, texto }: { id: string; texto: string }) {
  const [aberto, setAberto] = useState(false);
  const [passa, setPassa] = useState(texto.length > LIMITE_SEM_MEDIDA);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || aberto || el.clientHeight === 0) return;
    setPassa(el.scrollHeight > el.clientHeight + 1);
  }, [texto, aberto]);

  return (
    <>
      <p ref={ref} id={id} className={cx(s.abResumoTexto, !aberto && s.abCortado)}>
        {texto}
      </p>
      {passa || aberto ? (
        <button type="button" className={s.abLink} aria-expanded={aberto} aria-controls={id} onClick={() => setAberto((a) => !a)}>
          {aberto ? "Mostrar menos" : "Ler o resumo inteiro"}
        </button>
      ) : null}
    </>
  );
}
