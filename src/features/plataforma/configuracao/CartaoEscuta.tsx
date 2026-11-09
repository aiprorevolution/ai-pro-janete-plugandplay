import { Botao, cx } from "@/components/aipro";
import { s as lista } from "@/features/onboarding/lista";
import { IC } from "@/features/onboarding/lista/dados";

import { NOME_SITUACAO_C, TRANSCRITORES, artigoNome } from "./dados";
import { c } from "./estilos";
import { quandoValidada, type LeituraE } from "./leitura";
import { Ic, LinhaDl, LinhaEstado, LogoTranscritor } from "./pecas";

interface Props {
  admin: boolean;
  esc: LeituraE;
  agora: Date;
  /** Uma conferência em andamento (o "Conferir tudo"): trocar fica desligado. */
  bloqueado: boolean;
  realce: "flash" | "nasce" | null;
  oculto: boolean;
  aoConectar: () => void;
  /** Remove a chave só de áudio (a transcrição volta para a chave do cérebro, quando ela transcreve). */
  aoRemover?: (() => void) | undefined;
  removendo?: boolean | undefined;
}

const ALTURAS_ONDA = [10, 22, 34, 18, 28, 12, 24, 8];

/**
 * 3 · Escuta de áudio: "Não configurada" com o esboço do que falta (o áudio virando texto) e
 * "Conectar uma chave" (OpenAI, Groq ou ElevenLabs), ou quem transcreve, a chave e a última validação. Sem
 * chave só de áudio, com o cérebro da OpenAI ou da OpenRouter, a escuta já funciona com a chave do
 * cérebro (decisão 10a): "Ativa, usando a chave do cérebro". Sem nenhuma das duas, a chave da voz
 * (ElevenLabs) transcreve: "Ativa, usando a chave da voz" (P14 do uso da voz).
 */
export function CartaoEscuta({ admin, esc, agora, bloqueado, realce, oculto, aoConectar, aoRemover, removendo }: Props) {
  const t = esc.transcritor;
  const comChave = esc.conhecida && !!esc.chave;
  const viaCerebro = esc.conhecida && !esc.chave && esc.viaCerebro;
  // sem chave só de áudio e sem cérebro que transcreve, a chave da voz (ElevenLabs) transcreve (P14)
  const viaVoz = esc.conhecida && !esc.chave && !viaCerebro && esc.viaVoz;
  // a chave só de áudio guardada que não está ativa; inválida, o servidor transcreve pelo cérebro ou pela voz, se der
  const chaveParada = comChave && esc.chave!.status !== "ativa";
  const titulo = !esc.conhecida
    ? "Áudios dos leads"
    : comChave
      ? !chaveParada
        ? `Ativa, com ${artigoNome(t) || esc.chave!.provedor}`
        : `Com ${artigoNome(t) || esc.chave!.provedor}`
      : viaCerebro
        ? "Ativa, usando a chave do cérebro"
        : viaVoz
          ? esc.ok
            ? "Ativa, usando a chave da voz"
            : "Usando a chave da voz"
          : "Não configurada";
  // sem escuta, a Janete pede para o lead escrever (decisão 1 das lacunas); o áudio de novo vai para a equipe
  const estado = !esc.conhecida
    ? "Só quem administra vê"
    : chaveParada
      ? `${NOME_SITUACAO_C[esc.chave!.status]} · ${
          !esc.ok ? "a Janete pede texto" : esc.viaCerebro ? "transcreve com a chave do cérebro" : "transcreve com a chave da voz"
        }`
      : esc.ok
        ? "Entende áudios"
        : "Sem escuta · a Janete pede texto";

  return (
    <section
      id="cfg-card-escuta"
      className={cx(c.cfCartao, c.cfBlk, oculto && c.cfOculto)}
      data-realce={realce ?? undefined}
      aria-labelledby="cfg-m-escuta cfg-h-escuta"
    >
      <header className={c.cfBlkCab}>
        {comChave && t ? (
          <LogoTranscritor t={t} />
        ) : (
          <span className={lista.linhaIcone} aria-hidden="true">
            <Ic d={IC.microfone} tamanho="g" />
          </span>
        )}
        <div className={c.cfBlkTitulo}>
          <p className={c.cfMeta} id="cfg-m-escuta">
            Escuta de áudio
          </p>
          <h2 id="cfg-h-escuta" tabIndex={-1} className={c.cfBlkH}>
            {titulo}
          </h2>
        </div>
        <LinhaEstado
          tom={!esc.conhecida ? undefined : esc.ok && !chaveParada ? "ok" : "atencao"}
          icone={!esc.conhecida ? IC.cadeado : esc.ok && !chaveParada ? IC.ok : IC.triangulo}
        >
          {estado}
        </LinhaEstado>
      </header>

      {!esc.conhecida && <p className={c.cfApoio}>A chave de transcrição fica com quem administra a conta.</p>}

      {viaCerebro && (
        <>
          <p className={c.cfApoio}>
            Sem uma chave só para áudio, a Janete transcreve com a chave do cérebro ({esc.nomeViaCerebro}). Os áudios dos leads
            já viram texto.
          </p>
          <dl className={c.cfBlkDl}>
            <LinhaDl rotulo="Quem transcreve">{esc.nomeViaCerebro}, com a chave do cérebro</LinhaDl>
          </dl>
          {admin && (
            <div className={c.cfBlkPe}>
              <div className={c.cfDir}>
                <Botao id="cfg-conectar-escuta" variante="contorno" disabled={bloqueado} onClick={aoConectar}>
                  Usar uma chave só para áudio
                </Botao>
              </div>
            </div>
          )}
        </>
      )}

      {viaVoz && (
        <>
          <p className={c.cfApoio}>
            {esc.ok
              ? "Sem uma chave só para áudio, a Janete transcreve com a chave da voz (ElevenLabs). Os áudios dos leads já viram texto."
              : "Sem uma chave só para áudio, a Janete transcreve com a chave da voz (ElevenLabs), que está parada: a Janete pede para o lead escrever. Veja o cartão Voz da Janete."}
          </p>
          <dl className={c.cfBlkDl}>
            <LinhaDl rotulo="Quem transcreve">ElevenLabs, com a chave da voz</LinhaDl>
          </dl>
          {admin && (
            <div className={c.cfBlkPe}>
              <div className={c.cfDir}>
                <Botao id="cfg-conectar-escuta" variante="contorno" disabled={bloqueado} onClick={aoConectar}>
                  Usar uma chave só para áudio
                </Botao>
              </div>
            </div>
          )}
        </>
      )}

      {esc.conhecida && !comChave && !viaCerebro && !viaVoz && (
        <div className={c.cfVazioEsc}>
          <div className={c.cfEsbocoOnda} aria-hidden="true">
            <span className={c.cfOnda}>
              {ALTURAS_ONDA.map((h, i) => (
                <span key={i} style={{ height: h }} />
              ))}
            </span>
            <Ic d={IC.seta} className={c.cfEsbocoSeta} />
            <span className={c.cfEsbocoLinhas}>
              <span />
              <span />
              <span />
            </span>
          </div>
          <div className={c.cfVazioTxt}>
            <h3 className={c.cfHCartao}>Os áudios dos leads ainda não viram texto</h3>
            <p className={c.cfApoio}>
              Quando um lead manda só áudio, a Janete não entende e pede para ele escrever. Se ele mandar áudio de novo, a conversa
              vai para a equipe. Com uma chave da OpenAI, da Groq ou da ElevenLabs, ela ouve e responde sozinha.
            </p>
            {admin ? (
              <div className={c.cfVazioAcoes}>
                <Botao id="cfg-conectar-escuta" disabled={bloqueado} onClick={aoConectar} iconeDepois={<Ic d={IC.seta} />}>
                  Conectar uma chave
                </Botao>
                <span className={lista.miniLogos} aria-hidden="true">
                  {TRANSCRITORES.map((x) => (
                    <LogoTranscritor key={x.id} t={x} mini />
                  ))}
                </span>
              </div>
            ) : (
              <p className={c.cfMeta}>Só quem administra a conta conecta a chave.</p>
            )}
          </div>
        </div>
      )}

      {comChave && (
        <>
          <dl className={c.cfBlkDl}>
            <LinhaDl rotulo="Quem transcreve">{t?.nome ?? esc.chave!.provedor}</LinhaDl>
            {admin && (
              <LinhaDl rotulo="Chave">
                <Ic d={IC.cadeado} tamanho="p" />
                <span>
                  terminada em <span className={c.cfMono}>{esc.chave!.ultimos4}</span>
                  {/* a mesma chave da ElevenLabs nos dois cartões (E2): cada um guarda a sua */}
                  {esc.mesmaChaveDaVoz && " · Mesma chave da Voz da Janete"}
                </span>
              </LinhaDl>
            )}
            {esc.chave!.validada_em && (
              <LinhaDl rotulo="Última validação">{quandoValidada(esc.chave!.validada_em, agora)}</LinhaDl>
            )}
          </dl>
          {admin && (
            <div className={c.cfBlkPe}>
              {aoRemover && (
                <Botao
                  id="cfg-remover-escuta"
                  variante="perigo"
                  className={cx(c.cfBtnC, c.cfPerigoLeve)}
                  carregando={removendo}
                  disabled={bloqueado || removendo}
                  onClick={aoRemover}
                >
                  Remover a chave de áudio
                </Botao>
              )}
              <div className={c.cfDir}>
                <Botao variante="contorno" disabled={bloqueado || removendo} onClick={aoConectar}>
                  Trocar a escuta
                </Botao>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
